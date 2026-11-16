# 🎄 NOËL · 雪夜粒子圣诞树

> React 18 + Vite + Three.js (R3F) + MediaPipe 手势识别的交互式雪夜圣诞树。
> **纯粒子主体**：整棵树与雪地、飘雪全部由粒子构成（树顶金星沿用原来的立体金色星星设计），
> 强调「**下雪 + 圣诞树**」的冬夜氛围。

## ✨ 场景特性

* **约 11.5 万粒子**：
  * 分层冷杉针叶（底部深绿、顶部亮绿，穿插金色亮片）；
  * 7 条彩色螺旋彩灯 + 3 条暖金珠链，形成层次；
  * 190 颗挂饰光球、1600 粒树体内金色浮尘、枝头积雪、树干；
  * 雪地倒影（粒子镜像叠加）。
* **起伏波状雪地（纯粒子）**：树附近平坦，向远处逐渐隆起成雪丘；灯光在雪面晕开、雪晶闪烁。
  雪地属于环境，**不随手势旋转/形变**。
* **三层景深降雪**：远/中/近三层，近处是柔焦雪花，带全局阵风与独立飘摆（`S` 暴雪）。
* **主体呼吸感**：整棵树有极轻微的缩放呼吸 + 每个粒子的呼吸摆动。
* **树顶金星**：沿用原来的立体五角星（切面 + 光晕 + 十字星芒 + 点光源）。
* **4 种树形**：冷杉 FIR / 尖塔 SPIRE / 螺旋 HELIX / 星芒 STAR。
* **5 套配色**：祖母绿 / 极光 / 红金 / 冰蓝 / 糖果，树、灯、雪、天空、地面光晕同步变化。
* **后期**：ACES Filmic 色调映射 + Bloom + Vignette。
* **自动恢复**：WebGL 上下文丢失 / 渲染异常时自动重建 3D 场景（约 1 秒恢复），不容易黑屏。
* **资源全本地**：MediaPipe wasm/模型、HDRI 都在 `public/`，不依赖境外 CDN。

## 🚀 快速开始

```bash
npm install     # Node.js 18+
npm run dev     # 默认 http://localhost:5173/
npm run build   # 生产构建
```

## 🎮 交互

### 手势（需要允许摄像头）

| 手势 | 动作 |
| --- | --- |
| ✊ 握拳 Closed Fist | 聚合圣诞树 |
| 🖐 张开手掌 Open Palm | 粒子散开 |
| ✌️ 剪刀手 Victory | 换配色（5 套循环） |
| 👍 点赞 Thumb Up | 换树形（4 种循环） |

视角旋转用**鼠标拖拽**（最稳），聚合状态下相机会自动缓慢环绕；手势不再参与旋转，圣诞树永远保持直立。

手势被识别时，右侧「手势 · 交互」面板中对应条目会**高亮加粗**，画面中央不弹提示。
识别循环稳定在约 30–34fps、单帧推理 5–20ms（GPU 优先，自动回退 CPU）。

> 没有摄像头 / 拒绝授权也能玩：界面会显示错误原因，所有效果都可用键盘、鼠标、按钮完成。

### 键盘

| 按键 | 动作 |
| --- | --- |
| `空格` | 聚合 / 散开 |
| `1`–`5` | 换配色 |
| `F` | 换树形 |
| `B` | 爆裂（粒子冲击波） |
| `V` | 涡旋 |
| `S` | 暴雪 |
| `R` | 重置 |
| `D` | 摄像头 + 手势分数调试面板 |
| `H` | 隐藏 / 显示界面 |

### 鼠标

* 拖拽：环视 · 滚轮：缩放 · 单击画面：爆裂

## 🎨 自定义

* 配色：`src/scene/palettes.ts`
* 树形：`src/scene/shapes.ts` + `TreeScene.tsx` 的 `shapeRadius()`
* 粒子数量 / 雪地起伏：`TreeScene.tsx` 顶部常量（`NEEDLES`、`SNOW_CAPS`、`LIGHT_STRANDS`、`GARLAND_STRANDS`、`DUST_COUNT`、`SNOW_COUNT`、`TERRAIN_COUNT`、`TREE_HEIGHT`、`TREE_RADIUS`、`duneHeight()`）
* 效果强度：同文件 Bloom 参数、`TREE_VERT` / `SNOW_VERT` / `TERRAIN_VERT` 中的系数

## 🛠 技术栈

React 18 · Vite 5 · @react-three/fiber / drei · @react-three/postprocessing · three.js · MediaPipe Tasks Vision · TypeScript 5.9

## 📄 License

MIT License. Merry Christmas! 🎄✨
