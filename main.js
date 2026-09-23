// Response data is untrusted. Never evaluate scripts or retain account objects,
// response bodies, cookies or authorization headers in resources or logs.
var MAX_BODY = 4194304;
var MAX_NODES = 50000;
var MAX_RESOURCES = 100;

function text(value, limit) {
  return typeof value === "string" ? value.slice(0, limit || 1024) : "";
}

function dimension(value) {
  return typeof value === "number" && isFinite(value) && value > 0 && value <= 32768
    ? Math.floor(value) : 0;
}

function cdnURL(value, video) {
  if (typeof value !== "string" || value.length > 16384 || /[\s\\\x00-\x1f\x7f]/.test(value)) return "";
  // HTTPS CDN subdomains only; allow the explicit default port used by the
  // proxy, but reject credentials, other ports and encoded authority.
  var match = /^https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*\.cdninstagram\.com)(?::443)?(\/[^?#]*)(?:\?[^#]*)?$/i.exec(value);
  if (!match || (video && !/\.mp4$/i.test(match[2]))) return "";
  return value;
}

function parseJSON(body) {
  var source = body.trim().replace(/^for\s*\(;;\);\s*/, "");
  try { return JSON.parse(source); } catch (_) { return null; }
}

function payloads(body, html) {
  if (!html) {
    var parsed = parseJSON(body);
    if (parsed) return [parsed];
    // GraphQL can deliver one complete JSON envelope per line.
    var lines = body.split(/\r?\n/);
    if (lines.length > 256) return [];
    return lines.map(parseJSON).filter(function (value) { return value !== null; });
  }
  var result = [];
  var expression = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  var match;
  var count = 0;
  while ((match = expression.exec(body)) && count++ < 1024) {
    if (!/\btype\s*=\s*(["'])application\/json\1/i.test(match[1])) continue;
    // JSON script contents are raw text, not HTML entity decoded text.
    var value = parseJSON(match[2]);
    if (value) result.push(value);
  }
  return result;
}

function bestVersion(versions) {
  var best = null;
  for (var index = 0; index < versions.length && index < 32; index++) {
    var item = versions[index];
    if (!item || typeof item !== "object") continue;
    var url = cdnURL(item.url, true);
    if (!url) continue;
    var width = dimension(item.width), height = dimension(item.height);
    var candidate = {url: url, width: width, height: height};
    // Do not interpret type 101/102/103 as resolutions. The observed target
    // returns the SAME URL for all three, without dimensions.
    if (!best || width * height > best.width * best.height) best = candidate;
  }
  return best;
}

function coverURL(media) {
  var candidates = media.image_versions2 && media.image_versions2.candidates;
  if (!Array.isArray(candidates)) return "";
  var best = null;
  for (var index = 0; index < candidates.length && index < 32; index++) {
    var item = candidates[index];
    if (!item || !cdnURL(item.url, false)) continue;
    var area = dimension(item.width) * dimension(item.height);
    if (!best || area > best.area) best = {url: item.url, area: area};
  }
  return best ? best.url : "";
}

function resourceFromMedia(media) {
  var code = text(media.code, 65);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(code) || !Array.isArray(media.video_versions)) return null;
  var selected = bestVersion(media.video_versions);
  if (!selected) return null;
  var metadata = {"instagram.shortcode": code, "instagram.pageUrl": "https://www.instagram.com/reels/" + code + "/"};
  var username = text(media.user && media.user.username, 31);
  if (/^[A-Za-z0-9_.]{1,30}$/.test(username)) metadata.author = username;
  // taken_at is publication time in seconds. Do not substitute caption or
  // capture time, and do not invent a separate creation timestamp.
  if (typeof media.taken_at === "number" && isFinite(media.taken_at) &&
      media.taken_at > 0 && Math.floor(media.taken_at) === media.taken_at && media.taken_at <= 253402300799) {
    metadata.publishedAt = media.taken_at * 1000;
  }
  var track = {
    id: "video-primary", role: "video", executor: "http-file", url: selected.url,
    mime: "video/mp4", extension: ".mp4", quality: "MP4", headers: {Referer: "https://www.instagram.com/"}
  };
  if (selected.width && selected.height) {
    track.width = selected.width;
    track.height = selected.height;
    track.quality = selected.width + " × " + selected.height;
  }
  return {
    groupKey: "instagram:" + code, kind: "media.video", primaryType: "video",
    title: text(media.caption && media.caption.text, 500).trim() || "Instagram " + code,
    coverUrl: coverURL(media), tracks: [track], requiredTracks: ["video"],
    capabilities: ["download", "preview", "open", "copy"],
    preview: {renderer: "video", mode: "proxy", mime: "video/mp4", trackId: track.id},
    technical: {mime: "video/mp4", container: "mp4"}, metadata: metadata
  };
}

function collectResources(roots) {
  var resources = [];
  var groups = Object.create(null);
  var visited = 0;
  function visit(value, depth) {
    if (!value || typeof value !== "object" || depth > 48 || visited++ >= MAX_NODES || resources.length >= MAX_RESOURCES) return;
    if (!Array.isArray(value)) {
      var resource = resourceFromMedia(value);
      if (resource && !groups[resource.groupKey]) {
        groups[resource.groupKey] = true;
        resources.push(resource);
      }
    }
    var keys = Object.keys(value);
    for (var index = 0; index < keys.length && visited < MAX_NODES && resources.length < MAX_RESOURCES; index++) {
      visit(value[keys[index]], depth + 1);
    }
  }
  for (var index = 0; index < roots.length && visited < MAX_NODES; index++) visit(roots[index], 0);
  return resources;
}

function onObservation(observation, api) {
  var response = observation.response || {}, request = observation.request || {};
  var result = {decision: "continue", handled: false};
  if (observation.stage !== "response") return result;
  var type = text(response.contentType).split(";")[0].trim().toLowerCase();
  // Player DASH tracks and byte-range URLs need not appear in video_versions,
  // and can arrive before the metadata. Claim successful CDN MP4 responses
  // without emitting a resource, so the generic detector cannot list fragments
  // or preload variants as standalone videos. Metadata remains the source of
  // complete, titled resources; no response or playback behavior is modified.
  if (cdnURL(request.url, true)) {
    result.handled = (response.statusCode === 200 || response.statusCode === 206) && type === "video/mp4";
    return result;
  }
  if (request.host !== "www.instagram.com" || response.statusCode !== 200 || response.truncated ||
      typeof response.body !== "string" || !response.body || response.body.length > MAX_BODY) return result;
  var html = type === "text/html";
  if (html ? !/^\/(?:reels|reel|p)\//.test(request.path || "") :
    (type !== "application/json" || !/^\/(?:api\/graphql|graphql\/query)$/.test(request.path || ""))) return result;
  var resources = collectResources(payloads(response.body, html));
  if (resources.length) api.log("Instagram: extracted " + resources.length + " video resource(s).");
  result.resources = resources;
  result.handled = resources.length > 0;
  return result;
}

function createDownloadPlan(input) {
  var tracks = input.resource && input.resource.tracks || [];
  var track = null;
  for (var index = 0; index < tracks.length; index++) {
    if (tracks[index].id === "video-primary" && cdnURL(tracks[index].url, true)) track = tracks[index];
  }
  if (!track) throw new Error("Instagram MP4 unavailable; reopen the Reel and capture it again.");
  return {
    inputs: [{id: "video-primary", executor: "http-file", url: track.url,
      headers: {Referer: "https://www.instagram.com/"}, extension: ".mp4"}],
    output: {input: "video-primary", extension: ".mp4"}
  };
}

function refreshResource(input) {
  return {status: "recaptureRequired", resource: input.resource,
    message: "Instagram 视频地址可能已过期，请在已登录的浏览器中重新打开对应 Reels 并重新抓取。 / Reopen the Reel in your signed-in browser and capture it again."};
}
