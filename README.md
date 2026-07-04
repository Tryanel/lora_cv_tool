# 图文 SFT 标注提效工具

面向智能驾驶图文数据生产的本地优先 Web 工作台。当前版本聚焦标注阶段：直接选择本地图片目录，调用内网 Teacher/VLM 批量生成标注，人工复核修改后，通过浏览器下载可读 JSON 数据。

## 核心功能

- 标注任务：直接对本地图片目录创建任务，不需要先导入素材。
- 标注等级：支持实例级单帧标注，以及行为级多帧标注。行为级会按文件名排序，将 1 到 10 帧图片组成一个样本。
- Teacher 配置：支持 OpenAI-compatible 内网接口、API Key、模型名和超时。
- 任务提示词：提示词与场景强相关，创建任务时必须选择提示词版本或手动输入任务提示词。
- 固定输出约束：后端会向 Teacher 强制追加 JSON 输出格式要求，要求只返回 `messages`，且只包含 `user` 和 `assistant`。
- 人工复核：实时查看任务结果，编辑 `messages`，标记通过或返修。
- 浏览器下载：导出为可读的 `.json` 文件，顶层是数组，每条记录包含 `images` 和 `messages`。

下载 JSON 示例：

```json
[
  {
    "images": [
      "/data/driving/scene_001/frame_001.jpg",
      "/data/driving/scene_001/frame_002.jpg"
    ],
    "messages": [
      {
        "role": "user",
        "content": "请判断前车是否存在变道意图。"
      },
      {
        "role": "assistant",
        "content": "前车靠近车道线且相对位置持续向左偏移，存在变道意图。"
      }
    ]
  }
]
```

## 技术栈

- 前端：React + TypeScript + Vite + Ant Design
- 后端：FastAPI + SQLAlchemy + SQLite
- 图片与导出：本地文件系统
- Teacher：OpenAI-compatible Chat Completions 接口

## 数据目录

默认运行数据保存在 `backend/data/`：

- `app.db`：SQLite 数据库
- `assets/`：复制到工作区的图片副本
- `exports/`：导出文件
- `runs/`：训练/评测阶段预留

可以用环境变量修改数据目录：

```bash
LORA_TOOL_DATA=/data/lora_cv_tool_data
```

Windows PowerShell：

```powershell
$env:LORA_TOOL_DATA = "D:\lora_cv_tool_data"
```

## Windows 部署

### 1. 安装依赖

建议版本：

- Python 3.10+
- Node.js 18+ 或 20+
- pnpm

安装 pnpm：

```powershell
corepack enable
corepack prepare pnpm@latest --activate
```

如果 `corepack` 不可用：

```powershell
npm install -g pnpm
```

### 2. 获取代码

```powershell
git clone https://github.com/Tryanel/lora_cv_tool.git
cd lora_cv_tool
```

### 3. 启动后端

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

后端 API 文档：

```text
http://127.0.0.1:8000/docs
```

### 4. 启动前端

另开一个 PowerShell：

```powershell
cd frontend
pnpm install
pnpm dev --host 127.0.0.1 --port 5173
```

访问：

```text
http://127.0.0.1:5173
```

开发模式下，Vite 会把 `/annotation-jobs`、`/settings`、`/assets` 等接口代理到 `127.0.0.1:8000`。

### 5. Windows 路径示例

创建标注任务时，本地图片目录可以填写：

```text
D:\datasets\driving_frames\scene_001
```

后端进程必须有权限读取该目录。如果勾选“复制图片到工作区”，还需要能写入 `backend\data\` 或 `LORA_TOOL_DATA`。

## Linux / Ubuntu 部署

以下以 Ubuntu 22.04+ 为例。

### 1. 安装系统依赖

```bash
sudo apt update
sudo apt install -y git python3 python3-venv python3-pip curl
```

安装 Node.js 20 和 pnpm：

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
corepack enable
corepack prepare pnpm@latest --activate
```

### 2. 获取代码

```bash
git clone https://github.com/Tryanel/lora_cv_tool.git
cd lora_cv_tool
```

### 3. 配置数据目录

建议把运行数据放到代码目录外：

```bash
sudo mkdir -p /data/lora_cv_tool_data
sudo chown -R "$USER":"$USER" /data/lora_cv_tool_data
export LORA_TOOL_DATA=/data/lora_cv_tool_data
```

如果要长期生效，可以写入 `~/.bashrc` 或 systemd service 的 `Environment`。

### 4. 启动后端

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000
```

API 文档：

```text
http://<server-ip>:8000/docs
```

### 5. 启动前端

开发模式：

```bash
cd frontend
pnpm install
pnpm dev --host 0.0.0.0 --port 5173
```

访问：

```text
http://<server-ip>:5173
```

### 6. Linux 路径示例

创建标注任务时，本地图片目录可以填写：

```text
/data/driving_frames/scene_001
```

后端进程必须有权限读取该目录：

```bash
ls -lah /data/driving_frames/scene_001
```

## Linux 生产部署建议

简单生产部署可以使用 systemd 托管后端，前端用 Vite build 后交给 Nginx。

### 后端 systemd 示例

创建 `/etc/systemd/system/lora-cv-backend.service`：

```ini
[Unit]
Description=Lora CV Tool Backend
After=network.target

[Service]
WorkingDirectory=/opt/lora_cv_tool
Environment=LORA_TOOL_DATA=/data/lora_cv_tool_data
ExecStart=/opt/lora_cv_tool/.venv/bin/uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
Restart=always
RestartSec=3
User=ubuntu

[Install]
WantedBy=multi-user.target
```

启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now lora-cv-backend
sudo systemctl status lora-cv-backend
```

### 前端构建

如果前端和后端不同源访问，需要在构建时指定 API 地址：

```bash
cd frontend
VITE_API_BASE=http://<server-ip>:8000 pnpm build
```

如果用 Nginx 把前端和后端反代到同一个域名，可以不设置 `VITE_API_BASE`，由 Nginx 转发 API 路径。

### Nginx 示例

```nginx
server {
    listen 80;
    server_name _;

    root /opt/lora_cv_tool/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /assets/ {
        proxy_pass http://127.0.0.1:8000/assets/;
    }

    location /annotations/ {
        proxy_pass http://127.0.0.1:8000/annotations/;
    }

    location /annotation-jobs/ {
        proxy_pass http://127.0.0.1:8000/annotation-jobs/;
    }

    location /prompt-scenes {
        proxy_pass http://127.0.0.1:8000/prompt-scenes;
    }

    location /prompt-versions {
        proxy_pass http://127.0.0.1:8000/prompt-versions;
    }

    location /settings {
        proxy_pass http://127.0.0.1:8000/settings;
    }

    location /health {
        proxy_pass http://127.0.0.1:8000/health;
    }
}
```

## 使用流程

1. 进入 `Teacher`，填写内网 endpoint、API Key、model 和 timeout。
2. 进入 `提示词库`，维护场景和提示词版本，也可以在创建任务时直接输入任务提示词。
3. 进入 `标注任务`，填写本地图片目录，选择实例级或行为级。
4. 启动任务，Teacher 会按任务提示词生成 `user/assistant` 标注。
5. 进入 `人工审核`，检查图片、多帧行为、messages 内容，保存、通过或返修。
6. 点击 `导出`，浏览器会下载 `.json` 文件到默认下载目录。

## Teacher 接口要求

Teacher endpoint 需要兼容 OpenAI Chat Completions：

```text
POST /chat/completions
```

如果配置的 endpoint 不是以 `/chat/completions` 结尾，后端会自动拼接。

后端会固定追加输出格式要求，Teacher 应只返回：

```json
{
  "messages": [
    {
      "role": "user",
      "content": "..."
    },
    {
      "role": "assistant",
      "content": "..."
    }
  ]
}
```

## 常见问题

### 1. 前端页面能打开，但接口失败

确认后端正在运行：

```bash
curl http://127.0.0.1:8000/health
```

如果跨机器访问，确认防火墙放行 `8000` 和 `5173`，或者使用 Nginx 反代。

### 2. 创建任务提示图片目录不存在

目录路径是后端机器上的路径，不是浏览器所在电脑的路径。部署到 Ubuntu 后，应填写 Ubuntu 机器上的路径，例如 `/data/driving_frames/scene_001`。

### 3. Teacher 调用失败

确认后端机器能访问内网 Teacher：

```bash
curl http://teacher.internal/v1/models
```

同时检查 API Key、model 名称和超时时间。

### 4. 下载文件在哪里

导出通过浏览器下载，文件会保存到浏览器默认下载目录，通常是 Windows 的 `Downloads` 或 Linux 桌面环境的 `Downloads`。
