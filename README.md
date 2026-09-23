# resd-plugin-instagram

[中文](README.md) | [English](README-EN.md)

`res-downloader` 的 Instagram Reels 视频插件。

## 功能

- 识别 Reels 视频，保留标题、作者、封面和发布时间。
- 支持预览、下载为 MP4、打开和复制。
- 自动合并重复作品，重新抓取时更新下载地址。

## 安装

发布后可在 `res-downloader` 的“插件管理”页面安装。也可以下载对应版本的源码 ZIP，通过“从压缩包安装”导入。

## 设置

- **启用日志**：默认关闭，排查抓取问题时开启。

## 注意事项

- 仅支持页面提供的 MP4，不支持 DASH 分轨、直播、Stories 和图片合集；无需 FFmpeg。
- 地址过期或下载失败时，请重新打开作品抓取。
- 页面预加载的推荐作品也可能被收录；更新前已有的无标题视频记录需手动清理。

## 开发与校验

在 `res-downloader` 项目根目录执行：

```bash
go run main.go plugin lint ./plugins/resd-plugin-instagram
for fixture in ./plugins/resd-plugin-instagram/fixtures/*.json; do
  go run main.go plugin replay ./plugins/resd-plugin-instagram "$fixture" || break
done
node ./plugins/resd-plugin-instagram/tests/main.test.js
go run main.go plugin pack ./plugins/resd-plugin-instagram
```

Fixture 仅包含脱敏后的虚构数据。离线校验不能替代实际抓取、预览和下载验证。
