# 洪水动态模拟与三维可视化系统

本仓库用于维护洪水子系统的前端代码与 Python 后端代码。
团队协作时请以本仓库 `main` 分支的目录结构和 `.gitignore` 为准。

## 1. 推荐目录结构

```text
floodsimulation/
  backend/              # Python 后端代码，上传 GitHub
  src/                  # Vue + Cesium 前端源码，上传 GitHub
  public/               # 前端静态资源，上传 GitHub
  docs/                 # 项目文档，上传 GitHub
  data_showcase/        # 案例演示本地元数据/数据，不上传 GitHub
  测试数据/              # 本地测试数据，不上传 GitHub
  FloodTest_parallel/   # C++ 后端工程，不上传 GitHub
  .env.example          # 团队配置模板，上传 GitHub
  .env                  # 个人本机配置，不上传 GitHub
  .gitignore
  package.json
  vite.config.ts
```

代码中不应写死个人电脑绝对路径，例如带盘符的本机路径。
如需适配个人电脑目录，请复制 `.env.example` 为 `.env` 后修改 `.env`。

## 2. 本地配置

第一次拉取仓库后，在项目根目录复制配置模板：

```powershell
Copy-Item .env.example .env
```

默认配置如下：

```env
VITE_FRONTEND_PORT=5174
VITE_PY_API_TARGET=http://127.0.0.1:5000
VITE_CPP_API_TARGET=http://127.0.0.1:18080

HOST=0.0.0.0
PORT=5000
WAITRESS_THREADS=8
SHOWCASE_ROOT=data_showcase
SHOWCASE_CDN_BASE_URL=https://flood-data.disaster.website/showcase
FLOOD_UPLOAD_FOLDER=backend/uploads
FLOOD_OUTPUT_FOLDER=backend/outputs
GTT_WORKSPACE=output/grid_to_tin
```

如果某位成员的 Python 后端、C++ 后端端口不同，优先修改自己的 `.env`，不要直接改 `vite.config.ts`。

## 3. 前端启动

```powershell
npm install
npm run dev
```

默认访问地址：

```text
http://127.0.0.1:5174
```

前端代理关系：

```text
/py-api        -> VITE_PY_API_TARGET，默认 http://127.0.0.1:5000
/api           -> VITE_CPP_API_TARGET，默认 http://127.0.0.1:18080
/external-sim  -> VITE_CPP_API_TARGET，默认 http://127.0.0.1:18080
```

## 4. Python 后端启动

进入 Python 后端目录：

```powershell
cd backend
pip install -r requirements.txt
python serve.py
```

`serve.py` 使用 Waitress 启动服务，适合本地演示和 Cloudflare Tunnel 演示部署。
默认监听：

```text
http://0.0.0.0:5000
```

如果只是临时调试，也可以：

```powershell
python app.py
```

但正式演示建议使用：

```powershell
python serve.py
```

## 5. C++ 后端要求

C++ 洪水计算后端当前不上传 GitHub。
如果需要完整使用仿真模拟功能，请在本机准备 C++ 后端，并保证它默认监听：

```text
http://127.0.0.1:18080
```

如果端口不同，请修改个人 `.env`：

```env
VITE_CPP_API_TARGET=http://127.0.0.1:你的端口
```

## 6. 案例演示数据

三个主要案例：

```text
金沙江
永川
肖家桥
```

大体量洪水帧数据已经放在 Cloudflare R2/CDN：

```text
https://flood-data.disaster.website/showcase
```

本地仍建议保留 `data_showcase/`，用于 Python 后端生成案例清单、读取空间范围、ASC/XML 元数据等。默认路径：

```text
floodsimulation/data_showcase/
```

如果本机案例数据放在其他位置，请不要改代码，直接在 `.env` 中配置：

```env
SHOWCASE_ROOT=../your-local-data/data_showcase
```

也可以使用相对路径：

```env
SHOWCASE_ROOT=data_showcase
```

JSON 转 Mesh / GridToTin 工具如果没有手动选择路径，默认会使用：

```env
GTT_WORKSPACE=output/grid_to_tin
```

对应默认结构：

```text
output/grid_to_tin/
  TXT/
    dem.asc
    1.txt
    2.txt
  JSON/
```

## 7. Git 协作规范

建议：

- `.gitignore` 以仓库 main 分支为准，不要每个人维护一份不同的 `.gitignore`。
- 个人临时文件不想提交时，优先写入本机：

```text
.git/info/exclude
```

- 不要提交：

```text
node_modules/
dist/
data_showcase/
测试数据/
FloodTest_parallel/
backend/uploads/
backend/outputs/
.env
```

- 需要团队共享的配置模板写到 `.env.example`，个人真实配置写到 `.env`。

## 8. 推荐启动顺序

完整功能演示时，建议按顺序启动：

```text
1. C++ 后端：默认 18080
2. Python 后端：backend/python serve.py，默认 5000
3. 前端：npm run dev，默认 5174
```

然后访问：

```text
http://127.0.0.1:5174
```

## 9. 灾害子系统模板开关

如需启用灾害子系统模板壳层，可在 `.env` 中配置：

```env
VITE_ENABLE_TEMPLATE_SHELL=true
VITE_SYSTEM_TITLE=洪水动态模拟与三维可视化系统
VITE_TEMPLATE_OVERLAY_INTERACTIVE=false
VITE_TEMPLATE_SHOW_LOADING=false
```

默认情况下模板壳层关闭，不影响现有洪水系统功能。
