// Deterministic offline contract checks; no browser, network or application.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const fixture = name => JSON.parse(fs.readFileSync(path.join(root, 'fixtures', name + '.json'), 'utf8'));
const logs = [];
const api = {log: message => logs.push(message)};
function call(hook, input) {
  // Match the host's fresh global environment on every invocation.
  const context = vm.createContext({input, api});
  vm.runInContext(source, context, {timeout: 1000});
  return JSON.parse(JSON.stringify(vm.runInContext(hook + '(input, api)', context, {timeout: 1000})));
}
const observation = fixture('initial-page').observation;
const result = call('onObservation', observation);
assert.equal(result.handled, true);
assert.equal(result.resources.length, 1);
const resource = result.resources[0];
assert.equal(resource.title, '示例视频 & 标题');
assert.equal(resource.metadata.author, 'example_creator');
assert.equal(resource.metadata.publishedAt, 1756684800000);
assert.equal(resource.metadata.createdAt, undefined);
assert.equal(resource.metadata['instagram.pageUrl'], 'https://www.instagram.com/reels/ExampleReel01/');
assert.match(resource.coverUrl, /\/cover\.jpg$/);
assert.equal(resource.tracks.length, 1);
assert.equal(resource.tracks[0].quality, 'MP4');
assert.equal(resource.tracks[0].width, undefined, 'original dimensions must not describe a variant');
assert.equal(resource.preview.trackId, resource.tracks[0].id);
assert.deepEqual(Object.keys(resource.metadata).sort(), ['author', 'instagram.pageUrl', 'instagram.shortcode', 'publishedAt']);
const plan = call('createDownloadPlan', {resource});
assert.equal(plan.inputs.length, 1);
assert.equal(plan.inputs[0].url, resource.tracks[0].url);
assert.equal(plan.inputs[0].executor, 'http-file');
assert.deepEqual(plan.inputs[0].headers, {Referer: 'https://www.instagram.com/'});
assert.equal(plan.output.input, plan.inputs[0].id);
assert.equal(call('refreshResource', {resource}).status, 'recaptureRequired');
const sequence = fixture('recapture-dedupe').observations;
assert.equal(call('onObservation', sequence[2]).handled, true);
const unknown = structuredClone(sequence[2]);
unknown.request.url = unknown.request.url.replace('reel.mp4', 'unknown.mp4');
assert.equal(call('onObservation', unknown).handled, true);
// Regression: no metadata/aliases are available for independently requested
// DASH/Range variants. All are claimed without emitting a generic fragment.
for (const observation of fixture('cdn-range-segments').observations) {
  const result = call('onObservation', observation);
  assert.equal(result.handled, true);
  assert.equal(result.decision, 'continue');
  assert.equal((result.resources || []).length, 0);
  assert.equal(result.patch, undefined);
  assert.equal(result.captures, undefined);
}
for (const observation of fixture('cdn-ignored-responses').observations) {
  assert.equal(call('onObservation', observation).handled, false);
}
// Out-of-manifest observations cannot be CLI replay inputs. Check the hook's
// defensive behavior here without broadening production match permissions.
for (const url of [
  'https://scontent-nrt1-2.cdninstagram.com.example.invalid/example/player.mp4',
  'https://scontent-nrt1-2.cdninstagram.com@example.invalid/example/player.mp4',
  'https://scontent-nrt1-2.cdninstagram.com/example/cover.jpg'
]) {
  const observation = structuredClone(unknown);
  observation.request.url = url;
  observation.request.host = new URL(url).host;
  observation.request.path = new URL(url).pathname;
  assert.equal(call('onObservation', observation).handled, false);
}
const nonVideo = structuredClone(unknown);
nonVideo.response.contentType = 'text/html';
assert.equal(call('onObservation', nonVideo).handled, false);
const requestOnly = structuredClone(unknown);
requestOnly.stage = 'request';
delete requestOnly.response;
assert.equal(call('onObservation', requestOnly).handled, false);
const updated = call('onObservation', sequence[3]).resources[0];
assert.equal(updated.groupKey, resource.groupKey);
assert.equal(updated.tracks[0].id, resource.tracks[0].id);
assert.notEqual(updated.tracks[0].url, resource.tracks[0].url);
const graph = fixture('graphql').observation;
const payload = JSON.parse(graph.response.body);
const media = payload.data.xdt_api__v1__clips__home__connection_v2.edges[0].node.media;
media.caption.text = '';
media.taken_at = '1756684800';
media.user = {username: 'bad/name'};
graph.request.headers = {Cookie: ['fixture-only-cookie'], Authorization: ['fixture-only-auth']};
// A synthetic query tests URL preservation without persisting a live signature.
media.video_versions[0].url += '?example=one%2Btwo&part=whole';
media.video_versions[0].url = media.video_versions[0].url.replace('.com/', '.com:443/');
graph.response.body = JSON.stringify(payload);
const guarded = call('onObservation', graph).resources[0];
assert.equal(guarded.title, 'Instagram ExampleReel01');
assert.equal(guarded.metadata.publishedAt, undefined);
assert.equal(guarded.metadata.author, undefined);
assert.equal(guarded.tracks[0].url, media.video_versions[0].url);
assert.ok(!JSON.stringify(guarded).includes('fixture-only'));
for (const name of ['truncated', 'malformed', 'login', 'http-error', 'unsafe-media', 'dash-only', 'non-json-script']) {
  const ignored = call('onObservation', fixture(name).observation);
  assert.equal((ignored.resources || []).length, 0, name);
  assert.equal(ignored.handled, false, name);
}
for (const invalid of [null, [], {}, 1, true]) {
  const bad = structuredClone(graph);
  bad.response.body = JSON.stringify({data: {code: 'Example', video_versions: [invalid]}});
  assert.equal(call('onObservation', bad).resources.length, 0);
}
const wrongType = structuredClone(graph);
wrongType.response.contentType = 'text/plain';
assert.equal((call('onObservation', wrongType).resources || []).length, 0);
const oversized = structuredClone(graph);
oversized.response.body = ' '.repeat(4194305);
assert.equal((call('onObservation', oversized).resources || []).length, 0);
assert.throws(() => call('createDownloadPlan', {resource: {tracks: []}}), /MP4 unavailable/);
assert.ok(logs.every(message => /^Instagram: extracted \d+ video resource\(s\)\.$/.test(message)));
console.log('Instagram offline contracts passed: metadata, selection, plans, CDN suppression, recapture, input safety.');
