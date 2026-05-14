# Vue 3 + Cesium Vite Project

A basic Cesium environment using Vue 3, Vite, and TypeScript.

## Features
- Vue 3 (Composition API)
- CesiumJS integration using `vite-plugin-cesium`
- TypeScript support

## Prerequisites
- Node.js installed

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

3. Open your browser and navigate to the displayed URL.

## Disaster Subsystem Template (已接入但默认不启用)

为避免影响现有功能与界面，已将“灾害子系统模板”的前端代码以**隔离目录**方式引入：

- 代码位置：`src/disaster-template/`
- 模板入口组件：`src/disaster-template/TemplateApp.vue`

当前工程入口已改为“模板壳 + 现有 App 内核”的包裹方式（不改变现有界面与功能）：

- 壳组件：`src/TemplateShell.vue`
- 默认行为：只渲染现有 `src/App.vue`，模板 TopBar/面板等不会加载、也不会影响样式。

如需开启模板壳叠加层（用于后续联调/逐步接入），在项目根目录新增 `.env.local`：

```bash
VITE_ENABLE_TEMPLATE_SHELL=true
VITE_SYSTEM_TITLE=洪水动态模拟与三维可视化系统
```

开启后默认是“仅展示，不影响交互”的模式：模板会显示在最上层，但不会拦截鼠标/键盘事件，现有 App 可正常操作。

如需让模板本身可点击交互（谨慎开启）：

```bash
VITE_TEMPLATE_OVERLAY_INTERACTIVE=true
```

如需显示模板 LoadingScreen（会遮挡画面，但仍不拦截事件，取决于交互开关）：

```bash
VITE_TEMPLATE_SHOW_LOADING=true
```
