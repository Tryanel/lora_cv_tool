from __future__ import annotations

import time
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import Base, SessionLocal, engine, ensure_schema_compat, get_db
from .models import Annotation, AnnotationJob, Asset, DatasetVersion, EvalRun, PromptScene, TrainingRun
from .run_manager import build_eval_command, build_train_command, kill_run, run_payload, start_eval_run, start_train_run
from .schemas import (
    AnnotationJobCreateRequest,
    AnnotationJobExportRequest,
    AnnotationSaveRequest,
    DatasetExportRequest,
    EvalRequest,
    ImportRequest,
    PromptSceneCreateRequest,
    PromptVersionCreateRequest,
    ReworkRequest,
    SwiftSettings,
    TeacherConfigUpsertRequest,
    TrainRequest,
    VlmSettings,
)
from .services import (
    activate_teacher_config,
    active_teacher_settings,
    annotation_job_payload,
    asset_payload,
    create_annotation_job,
    create_prompt_scene,
    create_prompt_version,
    dataset_payload,
    delete_teacher_config,
    export_annotation_job,
    export_dataset,
    get_setting,
    import_folder,
    prelabel_asset,
    prompt_scene_payload,
    put_setting,
    save_teacher_config,
    status_counts,
    teacher_config_store,
    test_teacher_connection,
    validate_annotation,
)
from .utils import json_dumps, json_loads


Base.metadata.create_all(bind=engine)
ensure_schema_compat()

app = FastAPI(title="图文 SFT LoRA 标注提效工具", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/assets/import")
def import_assets(request: ImportRequest, db: Session = Depends(get_db)) -> dict:
    return import_folder(db, request.folder_path, request.batch, request.copy_assets)


@app.get("/assets")
def list_assets(
    status: Optional[str] = None,
    batch: Optional[str] = None,
    q: str = "",
    limit: int = Query(default=80, ge=1, le=300),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> dict:
    statement = select(Asset).join(Annotation).order_by(Asset.created_at.desc())
    if status:
        statement = statement.where(Annotation.status == status)
    if batch:
        statement = statement.where(Asset.batch == batch)
    if q:
        statement = statement.where(Asset.file_name.contains(q))
    assets = db.scalars(statement.limit(limit).offset(offset)).all()
    batches = [row[0] for row in db.execute(select(Asset.batch).distinct().order_by(Asset.batch)).all()]
    return {"items": [asset_payload(asset) for asset in assets], "counts": status_counts(db), "batches": batches}


@app.get("/assets/{asset_id}/image")
def get_asset_image(asset_id: int, db: Session = Depends(get_db)) -> FileResponse:
    asset = db.get(Asset, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="素材不存在")
    path = Path(asset.stored_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="图片文件不存在")
    return FileResponse(path)


@app.post("/prompt-scenes")
def create_scene(request: PromptSceneCreateRequest, db: Session = Depends(get_db)) -> dict:
    return create_prompt_scene(db, request)


@app.get("/prompt-scenes")
def list_scenes(db: Session = Depends(get_db)) -> dict:
    scenes = db.scalars(select(PromptScene).order_by(PromptScene.updated_at.desc())).all()
    return {"items": [prompt_scene_payload(scene) for scene in scenes]}


@app.post("/prompt-versions")
def create_version(request: PromptVersionCreateRequest, db: Session = Depends(get_db)) -> dict:
    return create_prompt_version(db, request)


@app.post("/annotation-jobs")
def create_teacher_annotation_job(request: AnnotationJobCreateRequest, db: Session = Depends(get_db)) -> dict:
    return create_annotation_job(db, request)


@app.get("/annotation-jobs")
def list_annotation_jobs(db: Session = Depends(get_db)) -> dict:
    jobs = db.scalars(select(AnnotationJob).order_by(AnnotationJob.created_at.desc())).all()
    return {"items": [annotation_job_payload(job) for job in jobs]}


@app.get("/annotation-jobs/{job_id}")
def get_annotation_job(job_id: str, db: Session = Depends(get_db)) -> dict:
    job = db.get(AnnotationJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="标注任务不存在")
    return annotation_job_payload(job, include_items=True)


@app.post("/annotation-jobs/{job_id}/export")
def export_teacher_annotation_job(job_id: str, request: AnnotationJobExportRequest, db: Session = Depends(get_db)) -> dict:
    return export_annotation_job(db, job_id, request)


@app.get("/annotation-jobs/{job_id}/export/download")
def download_teacher_annotation_job(
    job_id: str,
    accepted_only: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> FileResponse:
    payload = export_annotation_job(
        db,
        job_id,
        AnnotationJobExportRequest(accepted_only=accepted_only),
        include_images=False,
        json_array=True,
    )
    json_path = Path(payload["json_path"])
    return FileResponse(
        json_path,
        media_type="application/json",
        filename=f"{json_path.parent.name}.json",
    )


def _stream_annotation_job(job_id: str):
    while True:
        with SessionLocal() as db:
            job = db.get(AnnotationJob, job_id)
            if not job:
                yield f"data: {json_dumps({'error': 'not_found'})}\n\n"
                return
            payload = annotation_job_payload(job, include_items=True)
            yield f"data: {json_dumps(payload)}\n\n"
            if job.status in {"completed", "completed_with_errors", "failed", "cancelled"}:
                return
        time.sleep(1)


@app.get("/annotation-jobs/{job_id}/stream")
def stream_annotation_job(job_id: str) -> StreamingResponse:
    return StreamingResponse(_stream_annotation_job(job_id), media_type="text/event-stream")


@app.get("/annotations/next")
def next_annotation(
    status: str = "raw",
    batch: Optional[str] = None,
    db: Session = Depends(get_db),
) -> dict:
    statement = select(Asset).join(Annotation).where(Annotation.status == status).order_by(Asset.created_at)
    if batch:
        statement = statement.where(Asset.batch == batch)
    asset = db.scalars(statement.limit(1)).first()
    if not asset:
        raise HTTPException(status_code=404, detail="没有匹配的下一条样本")
    return asset_payload(asset)


@app.get("/annotations/{asset_id}")
def get_annotation(asset_id: int, db: Session = Depends(get_db)) -> dict:
    asset = db.get(Asset, asset_id)
    if not asset or not asset.annotation:
        raise HTTPException(status_code=404, detail="标注不存在")
    messages = json_loads(asset.annotation.messages_json, [])
    return {"asset": asset_payload(asset), "validation": validate_annotation(asset, messages)}


@app.post("/annotations/{asset_id}/save")
def save_annotation(asset_id: int, request: AnnotationSaveRequest, db: Session = Depends(get_db)) -> dict:
    asset = db.get(Asset, asset_id)
    if not asset or not asset.annotation:
        raise HTTPException(status_code=404, detail="标注不存在")
    annotation = asset.annotation
    messages = [message.model_dump() for message in request.messages]
    annotation.messages_json = json_dumps(messages)
    if request.status:
        annotation.status = request.status
    elif annotation.status in {"raw", "prelabelled", "rework"}:
        annotation.status = "annotated"
    if request.is_golden is not None:
        annotation.is_golden = 1 if request.is_golden else 0
    annotation.quality_notes = request.quality_notes
    asset.tags_json = json_dumps(request.tags)
    asset.quality_score = request.quality_score
    db.commit()
    return {"asset": asset_payload(asset), "validation": validate_annotation(asset, messages)}


@app.post("/annotations/{asset_id}/accept")
def accept_annotation(asset_id: int, db: Session = Depends(get_db)) -> dict:
    asset = db.get(Asset, asset_id)
    if not asset or not asset.annotation:
        raise HTTPException(status_code=404, detail="标注不存在")
    messages = json_loads(asset.annotation.messages_json, [])
    validation = validate_annotation(asset, messages)
    if validation["errors"]:
        raise HTTPException(status_code=400, detail={"message": "标注未通过校验", "validation": validation})
    asset.annotation.status = "accepted"
    db.commit()
    return {"asset": asset_payload(asset), "validation": validation}


@app.post("/annotations/{asset_id}/rework")
def rework_annotation(asset_id: int, request: ReworkRequest, db: Session = Depends(get_db)) -> dict:
    asset = db.get(Asset, asset_id)
    if not asset or not asset.annotation:
        raise HTTPException(status_code=404, detail="标注不存在")
    asset.annotation.status = "rework"
    asset.annotation.rework_reason = request.reason
    db.commit()
    return asset_payload(asset)


@app.post("/annotations/{asset_id}/prelabel")
async def prelabel_annotation(asset_id: int, db: Session = Depends(get_db)) -> dict:
    asset = db.get(Asset, asset_id)
    if not asset or not asset.annotation:
        raise HTTPException(status_code=404, detail="标注不存在")
    suggestion = await prelabel_asset(db, asset)
    asset.annotation.messages_json = json_dumps(suggestion["messages"])
    asset.annotation.status = "prelabelled"
    asset.annotation.provenance_json = json_dumps({"prelabel_provider": suggestion["provider"], "raw": suggestion["raw"]})
    db.commit()
    return {"asset": asset_payload(asset), "suggestion": suggestion, "validation": validate_annotation(asset, suggestion["messages"])}


@app.post("/datasets/export")
def export_dataset_version(request: DatasetExportRequest, db: Session = Depends(get_db)) -> dict:
    return export_dataset(db, request)


@app.get("/datasets")
def list_datasets(db: Session = Depends(get_db)) -> dict:
    datasets = db.scalars(select(DatasetVersion).order_by(DatasetVersion.created_at.desc())).all()
    return {"items": [dataset_payload(dataset) for dataset in datasets]}


@app.get("/datasets/{dataset_id}/manifest")
def get_dataset_manifest(dataset_id: str, db: Session = Depends(get_db)) -> dict:
    dataset = db.get(DatasetVersion, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="数据集版本不存在")
    return json_loads(dataset.manifest_json, {})


@app.get("/settings")
def read_settings(db: Session = Depends(get_db)) -> dict:
    teachers = teacher_config_store(db)
    return {
        "swift": get_setting(db, "swift", SwiftSettings().model_dump()),
        "vlm": active_teacher_settings(db).model_dump(),
        "teachers": teachers,
    }


@app.post("/settings/swift")
def save_swift_settings(request: SwiftSettings, db: Session = Depends(get_db)) -> dict:
    return put_setting(db, "swift", request.model_dump())


@app.post("/settings/vlm")
def save_vlm_settings(request: VlmSettings, db: Session = Depends(get_db)) -> dict:
    store = teacher_config_store(db)
    active_id = store["active_id"] or "default"
    active = next((item for item in store["items"] if item["id"] == active_id), None)
    name = active["name"] if active else "默认 Teacher"
    save_teacher_config(
        db,
        TeacherConfigUpsertRequest(
            id=active_id,
            name=name,
            endpoint=request.endpoint,
            api_key=request.api_key,
            model=request.model,
            timeout_seconds=request.timeout_seconds,
        ),
    )
    activate_teacher_config(db, active_id)
    return request.model_dump()


@app.get("/settings/teachers")
def list_teacher_settings(db: Session = Depends(get_db)) -> dict:
    return teacher_config_store(db)


@app.post("/settings/teachers")
def save_teacher_settings(request: TeacherConfigUpsertRequest, db: Session = Depends(get_db)) -> dict:
    return save_teacher_config(db, request)


@app.post("/settings/teachers/{config_id}/activate")
def activate_teacher_settings(config_id: str, db: Session = Depends(get_db)) -> dict:
    return activate_teacher_config(db, config_id)


@app.delete("/settings/teachers/{config_id}")
def delete_teacher_settings(config_id: str, db: Session = Depends(get_db)) -> dict:
    return delete_teacher_config(db, config_id)


@app.post("/settings/teachers/test")
def test_teacher_settings(request: TeacherConfigUpsertRequest) -> dict:
    return test_teacher_connection(request)


@app.post("/settings/teachers/{config_id}/test")
def test_saved_teacher_settings(config_id: str, db: Session = Depends(get_db)) -> dict:
    store = teacher_config_store(db)
    config = next((item for item in store["items"] if item["id"] == config_id), None)
    if not config:
        raise HTTPException(status_code=404, detail="Teacher 配置不存在")
    return test_teacher_connection(TeacherConfigUpsertRequest(**config))


@app.post("/runs/train/preview")
def preview_train(request: TrainRequest, db: Session = Depends(get_db)) -> dict:
    dataset = db.get(DatasetVersion, request.dataset_version_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="数据集版本不存在")
    settings = SwiftSettings(**get_setting(db, "swift", SwiftSettings().model_dump()))
    argv, env, output_dir = build_train_command(settings, dataset, request, "preview")
    return {"command": argv, "env": env, "output_dir": str(output_dir)}


@app.post("/runs/train/start")
def train_start(request: TrainRequest) -> dict:
    try:
        return start_train_run(request)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/runs/train")
def list_train_runs(db: Session = Depends(get_db)) -> dict:
    runs = db.scalars(select(TrainingRun).order_by(TrainingRun.created_at.desc())).all()
    return {"items": [run_payload(run) for run in runs]}


@app.get("/runs/train/{run_id}/status")
def train_status(run_id: str, db: Session = Depends(get_db)) -> dict:
    run = db.get(TrainingRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="训练任务不存在")
    return run_payload(run)


@app.post("/runs/train/{run_id}/kill")
def train_kill(run_id: str, db: Session = Depends(get_db)) -> dict:
    run = db.get(TrainingRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="训练任务不存在")
    killed = kill_run(run_id)
    if killed:
        run.status = "killed"
        db.commit()
    return {"killed": killed}


@app.post("/runs/eval/start")
def eval_start(request: EvalRequest) -> dict:
    try:
        return start_eval_run(request)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/runs/eval/preview")
def preview_eval(request: EvalRequest, db: Session = Depends(get_db)) -> dict:
    dataset = db.get(DatasetVersion, request.dataset_version_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="数据集版本不存在")
    settings = SwiftSettings(**get_setting(db, "swift", SwiftSettings().model_dump()))
    argv, env = build_eval_command(settings, dataset, request)
    return {"command": argv, "env": env}


@app.get("/runs/eval")
def list_eval_runs(db: Session = Depends(get_db)) -> dict:
    runs = db.scalars(select(EvalRun).order_by(EvalRun.created_at.desc())).all()
    return {"items": [run_payload(run) for run in runs]}


@app.get("/runs/eval/{run_id}/status")
def eval_status(run_id: str, db: Session = Depends(get_db)) -> dict:
    run = db.get(EvalRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="评测任务不存在")
    return run_payload(run)


@app.get("/runs/eval/compare")
def compare_eval_runs(db: Session = Depends(get_db)) -> dict:
    runs = db.scalars(select(EvalRun).order_by(EvalRun.created_at.desc())).all()
    return {"items": [run_payload(run) for run in runs]}


def _read_log(path: str) -> str:
    log_path = Path(path)
    if not log_path.exists():
        return ""
    return log_path.read_text(encoding="utf-8", errors="replace")


@app.get("/runs/train/{run_id}/logs", response_class=PlainTextResponse)
def train_logs(run_id: str, db: Session = Depends(get_db)) -> str:
    run = db.get(TrainingRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="训练任务不存在")
    return _read_log(run.log_path)


@app.get("/runs/eval/{run_id}/logs", response_class=PlainTextResponse)
def eval_logs(run_id: str, db: Session = Depends(get_db)) -> str:
    run = db.get(EvalRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="评测任务不存在")
    return _read_log(run.log_path)


def _stream_log(path: str):
    log_path = Path(path)
    position = 0
    while True:
        if log_path.exists():
            with log_path.open("r", encoding="utf-8", errors="replace") as handle:
                handle.seek(position)
                chunk = handle.read()
                position = handle.tell()
            if chunk:
                for line in chunk.splitlines():
                    yield f"data: {line}\n\n"
        time.sleep(1)


@app.get("/runs/train/{run_id}/logs/stream")
def train_log_stream(run_id: str, db: Session = Depends(get_db)) -> StreamingResponse:
    run = db.get(TrainingRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="训练任务不存在")
    return StreamingResponse(_stream_log(run.log_path), media_type="text/event-stream")


@app.get("/runs/eval/{run_id}/logs/stream")
def eval_log_stream(run_id: str, db: Session = Depends(get_db)) -> StreamingResponse:
    run = db.get(EvalRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="评测任务不存在")
    return StreamingResponse(_stream_log(run.log_path), media_type="text/event-stream")
