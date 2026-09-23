# resd-plugin-instagram

[中文](README.md) | [English](README-EN.md)

An Instagram Reels video plugin for `res-downloader`.

## Features

- Detects Reels videos with their titles, authors, covers, and publication times.
- Supports previewing, downloading as MP4, opening, and copying resources.
- Merges duplicate posts and updates download URLs when captured again.

## Installation

Once published, the plugin can be installed from Plugin Management in `res-downloader`. You can also download the source ZIP for the desired version and import it using the option to install from an archive.

## Settings

- **Enable logging**: Disabled by default. Enable it to troubleshoot capture issues.

## Notes

- Only MP4 files provided by the page are supported. Separate DASH tracks, live streams, Stories, and image collections are not supported. FFmpeg is not required.
- If a URL expires or a download fails, reopen the post to capture it again.
- Preloaded recommendations may also be captured. Untitled video entries created before an update need to be removed manually.

## Development and Validation

Run these commands from the `res-downloader` project root:

```bash
go run main.go plugin lint ./plugins/resd-plugin-instagram
for fixture in ./plugins/resd-plugin-instagram/fixtures/*.json; do
  go run main.go plugin replay ./plugins/resd-plugin-instagram "$fixture" || break
done
node ./plugins/resd-plugin-instagram/tests/main.test.js
go run main.go plugin pack ./plugins/resd-plugin-instagram
```

Fixtures contain only sanitized, fictional data. Offline validation does not replace testing actual capture, preview, and downloads.
