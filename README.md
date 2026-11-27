# eHunter Local

基于 [eHunter](https://github.com/hanFengSan/eHunter) v3.1.0 改造的本地漫画阅读器：用 eHunter 的阅读界面，在浏览器里读本机的图片文件夹 / CBZ / ZIP 漫画，全程离线。

A local comic reader built on eHunter v3.1.0: read image folders / CBZ / ZIP archives on your own machine with the eHunter reader UI, fully offline.

## 功能

- 书库首页：封面、页数、阅读进度，再次打开自动回到上次读到的页
- 滚动模式 / 书页模式，左侧缩略图栏（书页模式默认从左往右，适合欧漫）
- 页面比例下拉：适合高度、40%–100%、自定义；Cmd + / Cmd - 按档位切换
- 按键：↑↓←→ 上一页 / 下一页，空格 / Shift+空格 滚动一屏，Home / End 首页 / 末页，单按 Shift 打开更多设置
- 读到最后一页时提示进入下一卷
- 本地服务只监听 `127.0.0.1`，阅读时不访问网络

## 环境要求

- Node.js 18+
- Chrome
- macOS 上用系统自带的 `sips` 生成缩略图；其他系统没有 `sips` 时直接用原图当缩略图

## 使用

1. 把 [`start.command`](start.command) 第一行的 `LIBRARY` 改成你的书库目录，或者设置环境变量 `EHUNTER_LIBRARY`。
2. 双击 `start.command`：第一次运行会安装依赖并构建，之后启动本地服务，并在 Chrome 中打开 `http://127.0.0.1:5177`。

命令行方式：

```bash
npm install
npm run build-only
npm run serve -- ~/Comics            # 可以传多个目录或单个 CBZ 文件
```

停止服务：`kill $(lsof -ti tcp:5177 -sTCP:LISTEN)`；换端口：`PORT=5180 npm run serve -- ~/Comics`。

### 书库怎么识别

- 书库目录下的每个 `.cbz` / `.zip` 文件、每个直接包含图片的子文件夹，各算一本；书库目录本身直接放着图片时也算一本
- 页面按文件名自然排序（`2.jpg` 排在 `10.jpg` 前面）
- 压缩包或文件夹里有 `ComicInfo.xml` 时，读取其中的标题、系列和卷号；同系列的书在首页归为一组
- 缓存（页面尺寸、缩略图）放在 `~/Library/Caches/ehunter-local`，可以随时删除

### 开发

```bash
npm run serve -- ~/Comics   # 启动书库服务（5177 端口）
npm run dev                 # Vite 开发服务器，/api /img /thumb 会代理到 5177
```

本地版新增代码在 [`server/index.mjs`](server/index.mjs)（书库服务，无第三方依赖）和 [`src/local/`](src/local)（入口、书库首页、本地数据源）。

---

以下为原版 eHunter 说明。

[中文版](https://github.com/hanFengSan/eHunter/blob/master/README_CN.md)

# eHunter
Provide scroll mode and book mode for a better reading experience.

# Preview
<img src="https://raw.githubusercontent.com/hanFengSan/eHunter/master/github_image/github_preview_4.png" style="width: 800px; display: block; padding: 10px;"/>
<img src="https://raw.githubusercontent.com/hanFengSan/eHunter/master/github_image/github_preview_5_1.png" style="width: 800px; display: block; padding: 10px;"/>
<img src="https://raw.githubusercontent.com/hanFengSan/eHunter/master/github_image/github_preview_3.jpg" style="width: 800px; display: block; padding: 10px;"/>

# Use on iPhone and iPad
eHunter can run on iPhone and iPad. See the guides below:

CN: [Link](https://github.com/hanFengSan/eHunter/blob/master/misc/iphone_ipad_cn.md)
EN: [Link](https://github.com/hanFengSan/eHunter/blob/master/misc/iphone_ipad_en.md)
JP: [Link](https://github.com/hanFengSan/eHunter/blob/master/misc/iphone_ipad_jp.md)

## Implementation Overview
eHunter creates a new node on the original page and mounts Vue to that node.
Content crawling/parsing is handled by fetch-based logic.
The architecture isolates platform-specific behavior from reader UI logic, making migration to other comic platforms easier.

## Install
Tampermonkey/userscript: [openuserjs](https://openuserjs.org/scripts/alexchen/eHunter)

## Run
1. Run `npm install`, then `npm run dev` for development mode.
2. Run `npm run build-prod` to generate the userscript build.

## Project Architecture
The current project is based on `Vite + Vue 3 + TypeScript`, with two main goals:
1. Inject a reader UI into target site pages.
2. Keep platform parsing logic and reader rendering logic layered for maintainability and extension.

Main directory responsibilities:

```
|-eHunter
  |-src
  |  |-main.ts               // Entry: initialize and mount app (currently test mounting by default)
  |  |-config.ts             // Runtime config
  |  |-platform/             // Platform layer (site detection, initialization, service factory)
  |     |-detector.ts        // Host/environment detection
  |     |-initializer.ts     // Platform initialization flow
  |     |-factory.ts         // Platform service creation
  |     |-eh/                // EH/EXH implementation
  |     |-nh/                // NH implementation
  |     |-base/              // Cross-platform base capabilities (request, queue, retry)
  |
  |-core
  |  |-App.vue               // Reader root component
  |  |-components/           // View layer: book mode, scroll mode, thumbnails, top bar, dialogs
  |  |-service/              // Business services (album data, download, retry policy)
  |  |-store/                // State management (app state, event bus, i18n, layout preference)
  |  |-model/                // Domain models (layout, book spread, thumb expand)
  |  |-utils/                // Utilities
  |  |-style/                // Global styles and theme variables
  |
  |-public/                  // Static assets
  |-dist/                    // Build output
  |-specs/                   // Feature/design specs
  |-misc/                    // Docs and supporting materials
```

Simplified call flow:
`main.ts -> platform initialization (detect site + create platform services) -> core reader mount -> component rendering/interaction -> service/store coordinate data loading and state updates`.
