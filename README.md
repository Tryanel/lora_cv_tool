# 图文 SFT 标注提效工具

一阶段只聚焦标注：导入本地图片，调用内网 teacher 模型批量生成图文问答标注，实时查看任务结果，人工修改后，一键导出为可用于 ms-swift 训练的多模态 JSONL。

## 核心功能

- 首页功能入口：手动选择 Teacher 设置、素材导入、并发标注任务、人工审核、JSON 导出。
- Teacher 标注：支持 OpenAI-compatible 内网接口、API Key、模型名、超时和提示词配置。
- 并发任务：一个任务可按批次/状态选择素材，设置并发数；多个标注任务可同时运行。
- 实时查看：任务列表自动刷新进度，审核页可查看每条样本结果并人工修改 `messages`。
- Swift 导出：任务完成后导出 `data.jsonl`，每条样本包含 `messages` 和 `images`，图片复制到导出目录的 `images/` 下。

## 启动

```powershell
pip install -r backend\requirements.txt
python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

```powershell
cd frontend
pnpm install
pnpm dev --host 127.0.0.1 --port 5173
```

访问：

- 前端：http://127.0.0.1:5173
- API 文档：http://127.0.0.1:8000/docs

## 使用流程

1. 在首页进入 `配置 Teacher 模型`，填写内网 endpoint、API Key 和 model。
2. 进入 `导入图文素材`，选择图片文件夹和批次名。
3. 进入 `创建并发标注任务`，选择批次、状态和并发数，启动 teacher 标注。
4. 在任务列表点击 `查看`，实时查看结果并人工修改。
5. 点击任务的 `导出`，生成可用于 ms-swift 的 JSONL。

## 数据目录

默认运行数据保存在 `backend/data/`：

- `app.db`：SQLite 数据库
- `assets/`：导入图片副本
- `exports/`：Swift JSONL 导出
- `runs/`：后续训练/评测阶段预留
