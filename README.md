# 🎄 NOËL · 雪夜粒子圣诞树

**在线预览：** https://mulunmu.github.io/noel-christmas-tree/

纯粒子 3D 圣诞树：约 11.5 万粒子（针叶 / 彩灯 / 金链 / 挂饰光球 / 浮尘 / 三层飘雪 / 起伏雪地），
支持 AI 手势（MediaPipe，本地推理、不调用任何云端 API）、键盘、鼠标交互。

## 仓库结构

| 分支 | 内容 |
| --- | --- |
| `main` | 构建后的静态站点（GitHub Pages 直接发布：`index.html` + `assets/` + `hdri/` + `mediapipe/`） |
| `source` | 完整源码（React 18 + Vite 5 + Three.js + MediaPipe）+ `使用教程.md` + `start.bat` 一键启动 |

## 本地运行

```bash
git clone -b source https://github.com/mulunmu/noel-christmas-tree.git noel-christmas-tree
cd noel-christmas-tree
npm install
npm run dev
```

详细说明见源码分支里的 `使用教程.md`、`部署说明.md`。