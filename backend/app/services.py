from __future__ import annotations

import random
import shutil
import threading
import uuid
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .database import ASSET_DIR, EXPORT_DIR, SessionLocal
from .models import Annotation, AnnotationJob, AnnotationJobItem, Asset, DatasetVersion, PromptScene, PromptVersion, Setting
from .schemas import (
    AnnotationJobCreateRequest,
    AnnotationJobExportRequest,
    DatasetExportRequest,
    PromptSceneCreateRequest,
    PromptVersionCreateRequest,
    VlmSettings,
)
from .utils import (
    IMAGE_EXTENSIONS,
    estimate_tokens,
    image_info,
    image_to_data_url,
    json_dumps,
    json_loads,
    perceptual_hash,
    safe_copy_asset,
    sha256_file,
    validate_image,
)

TEACHER_OUTPUT_FORMAT_PROMPT = """
硬性输出格式要求：
1. 只能返回一个可被 json.loads 解析的 JSON 对象，禁止 Markdown、代码块、解释文字或额外字段。
2. JSON 对象必须且只能包含 messages 字段。
3. messages 必须是数组，且只能包含两类 role：user 和 assistant，禁止输出 system role。
4. messages 至少包含一条 user 和一条 assistant。
5. 格式示例：
{"messages":[{"role":"user","content":"用户问题或任务指令"},{"role":"assistant","content":"模型应学习的回答"}]}
""".strip()


def asset_payload(asset: Asset, annotation: Annotation | None = None) -> dict[str, Any]:
    ann = annotation or asset.annotation
    return {
        "id": asset.id,
        "file_name": asset.file_name,
        "original_path": asset.original_path,
        "stored_path": asset.stored_path,
        "image_url": f"/assets/{asset.id}/image",
        "sha256": asset.sha256,
        "perceptual_hash": asset.perceptual_hash,
        "width": asset.width,
        "height": asset.height,
        "size_bytes": asset.size_bytes,
        "batch": asset.batch,
        "tags": json_loads(asset.tags_json, []),
        "quality_score": asset.quality_score,
        "duplicate_of": asset.duplicate_of,
        "created_at": asset.created_at.isoformat(),
        "annotation": annotation_payload(ann) if ann else None,
    }


def annotation_payload(annotation: Annotation) -> dict[str, Any]:
    return {
        "id": annotation.id,
        "asset_id": annotation.asset_id,
        "messages": json_loads(annotation.messages_json, []),
        "status": annotation.status,
        "provenance": json_loads(annotation.provenance_json, {}),
        "is_golden": bool(annotation.is_golden),
        "rework_reason": annotation.rework_reason,
        "quality_notes": annotation.quality_notes,
        "updated_at": annotation.updated_at.isoformat(),
    }


def annotation_job_item_payload(item: AnnotationJobItem) -> dict[str, Any]:
    return {
        "id": item.id,
        "job_id": item.job_id,
        "asset_id": item.asset_id,
        "status": item.status,
        "provider": item.provider,
        "error": item.error,
        "sample": json_loads(item.sample_json, {}),
        "updated_at": item.updated_at.isoformat(),
        "asset": asset_payload(item.asset) if item.asset else None,
    }


def annotation_job_payload(job: AnnotationJob, include_items: bool = False) -> dict[str, Any]:
    payload = {
        "id": job.id,
        "name": job.name,
        "status": job.status,
        "source": json_loads(job.source_json, {}),
        "config": json_loads(job.config_json, {}),
        "total_count": job.total_count,
        "completed_count": job.completed_count,
        "failed_count": job.failed_count,
        "export_path": job.export_path,
        "error": job.error,
        "created_at": job.created_at.isoformat(),
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
    }
    if include_items:
        payload["items"] = [annotation_job_item_payload(item) for item in sorted(job.items, key=lambda row: row.id)]
    return payload


def prompt_version_payload(version: PromptVersion) -> dict[str, Any]:
    return {
        "id": version.id,
        "scene_id": version.scene_id,
        "version": version.version,
        "prompt_text": version.prompt_text,
        "notes": version.notes,
        "created_at": version.created_at.isoformat(),
    }


def prompt_scene_payload(scene: PromptScene, include_versions: bool = True) -> dict[str, Any]:
    payload = {
        "id": scene.id,
        "name": scene.name,
        "description": scene.description,
        "created_at": scene.created_at.isoformat(),
        "updated_at": scene.updated_at.isoformat(),
    }
    if include_versions:
        payload["versions"] = [prompt_version_payload(version) for version in sorted(scene.versions, key=lambda row: row.created_at, reverse=True)]
    return payload


def create_prompt_scene(db: Session, request: PromptSceneCreateRequest) -> dict[str, Any]:
    name = request.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="场景名称不能为空")
    existing = db.scalar(select(PromptScene).where(PromptScene.name == name))
    if existing:
        raise HTTPException(status_code=400, detail="场景名称已存在")
    scene = PromptScene(name=name, description=request.description)
    db.add(scene)
    db.commit()
    db.refresh(scene)
    return prompt_scene_payload(scene)


def create_prompt_version(db: Session, request: PromptVersionCreateRequest) -> dict[str, Any]:
    scene = db.get(PromptScene, request.scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="提示词场景不存在")
    version = request.version.strip()
    prompt_text = request.prompt_text.strip()
    if not version:
        raise HTTPException(status_code=400, detail="版本号不能为空")
    if not prompt_text:
        raise HTTPException(status_code=400, detail="提示词不能为空")
    prompt_version = PromptVersion(scene_id=scene.id, version=version, prompt_text=prompt_text, notes=request.notes)
    db.add(prompt_version)
    db.commit()
    db.refresh(prompt_version)
    return prompt_version_payload(prompt_version)


def get_setting(db: Session, key: str, default: dict[str, Any]) -> dict[str, Any]:
    setting = db.get(Setting, key)
    if not setting:
        return default
    merged = default.copy()
    merged.update(json_loads(setting.value_json, {}))
    return merged


def put_setting(db: Session, key: str, value: dict[str, Any]) -> dict[str, Any]:
    setting = db.get(Setting, key)
    if setting:
        setting.value_json = json_dumps(value)
    else:
        setting = Setting(key=key, value_json=json_dumps(value))
        db.add(setting)
    db.commit()
    return value


def _scan_image_files(folder_path: str) -> list[Path]:
    folder = Path(folder_path).expanduser().resolve()
    if not folder.exists() or not folder.is_dir():
        raise HTTPException(status_code=400, detail="导入路径不存在或不是文件夹")
    return sorted((path for path in folder.rglob("*") if path.suffix.lower() in IMAGE_EXTENSIONS), key=lambda path: path.as_posix())


def _create_asset_from_source(db: Session, source: Path, batch: str, copy_assets: bool, provenance: dict[str, Any] | None = None) -> Asset:
    ok, reason = validate_image(source)
    if not ok:
        raise ValueError(reason)

    digest = sha256_file(source)
    existing = db.scalar(select(Asset).where(Asset.sha256 == digest))
    meta = image_info(source)
    phash = perceptual_hash(source)
    stored = safe_copy_asset(source, ASSET_DIR, digest) if copy_assets else source

    asset = Asset(
        file_name=source.name,
        original_path=str(source),
        stored_path=str(stored),
        mime_type=meta["mime_type"],
        sha256=digest,
        perceptual_hash=phash,
        width=meta["width"],
        height=meta["height"],
        size_bytes=meta["size_bytes"],
        batch=batch or "default",
        duplicate_of=existing.id if existing else None,
    )
    db.add(asset)
    db.flush()
    annotation_provenance = {"exif": meta["exif"], **(provenance or {})}
    db.add(Annotation(asset_id=asset.id, status="raw", provenance_json=json_dumps(annotation_provenance)))
    return asset


def import_folder(db: Session, folder_path: str, batch: str, copy_assets: bool) -> dict[str, Any]:
    imported = 0
    duplicates = 0
    failed: list[dict[str, str]] = []
    files = _scan_image_files(folder_path)

    for source in files:
        try:
            asset = _create_asset_from_source(db, source, batch, copy_assets)
            imported += 1
            if asset.duplicate_of:
                duplicates += 1
        except Exception as exc:
            failed.append({"path": str(source), "reason": str(exc)})

    db.commit()
    return {"imported": imported, "duplicates": duplicates, "failed": failed, "scanned": len(files)}


def validate_annotation(asset: Asset, messages: list[dict[str, str]]) -> dict[str, list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    image_path = Path(asset.stored_path)

    if not image_path.exists():
        errors.append("图片文件不存在")
    if asset.duplicate_of:
        warnings.append(f"疑似重复素材，原素材 ID: {asset.duplicate_of}")
    if asset.width > 4096 or asset.height > 4096:
        warnings.append("图片边长超过 4096，训练前建议设置 max_pixels")
    if not messages:
        errors.append("messages 不能为空")

    roles = [message.get("role") for message in messages]
    if any(role not in {"system", "user", "assistant"} for role in roles):
        errors.append("messages 只能包含 system/user/assistant")
    if "user" not in roles:
        errors.append("至少需要一条 user 消息")
    if "assistant" not in roles:
        errors.append("至少需要一条 assistant 消息")
    for index, message in enumerate(messages, start=1):
        if not message.get("content", "").strip():
            errors.append(f"第 {index} 条消息内容为空")
    if estimate_tokens(messages) > 4096:
        warnings.append("文本粗略估算超过 4096 tokens，请确认模型上下文长度")

    return {"errors": errors, "warnings": warnings}


def _teacher_endpoint(endpoint: str) -> str:
    cleaned = endpoint.rstrip("/")
    if cleaned.endswith("/chat/completions"):
        return cleaned
    return cleaned + "/chat/completions"


def _fallback_messages(asset: Asset, sample: dict[str, Any] | None = None) -> list[dict[str, str]]:
    sample = sample or {}
    level = sample.get("annotation_level", "instance")
    frame_count = int(sample.get("frame_count", 1) or 1)
    if level == "behavior":
        return [
            {"role": "user", "content": "请基于连续道路驾驶帧，推理交通参与者、车道/信号、车辆行为与潜在风险，生成一条适合 SFT 训练的问答样本。"},
            {
                "role": "assistant",
                "content": f"该样本包含 {frame_count} 帧连续道路图像，请人工补充车辆/行人/车道线/信号灯变化、主车或目标车行为、风险判断与推理依据。",
            },
        ]
    return [
        {"role": "user", "content": "请观察道路驾驶图片，围绕交通参与者、车道、信号灯、可行驶区域、目标实例属性或风险点生成一条适合 SFT 训练的问答样本。"},
        {
            "role": "assistant",
            "content": f"这张道路图像尺寸为 {asset.width}x{asset.height}，请人工补充实例主体、位置关系、可见属性、交通语义与判断依据。",
        },
    ]


def _strip_json_fence(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        return "\n".join(lines).strip()
    return stripped


def _coerce_teacher_messages(text: str) -> list[dict[str, str]]:
    cleaned = _strip_json_fence(text)
    data = json_loads(cleaned, None)
    messages: list[Any] = []
    if isinstance(data, dict) and isinstance(data.get("messages"), list):
        messages = data["messages"]
    elif isinstance(data, dict) and {"user", "assistant"} <= data.keys():
        messages = [
            {"role": "user", "content": str(data["user"])},
            {"role": "assistant", "content": str(data["assistant"])},
        ]

    normalized = [
        {"role": str(item.get("role", "")).strip(), "content": str(item.get("content", "")).strip()}
        for item in messages
        if isinstance(item, dict) and item.get("role") in {"user", "assistant"}
    ]
    roles = {item["role"] for item in normalized}
    if normalized and {"user", "assistant"} <= roles:
        return normalized
    return [
        {"role": "user", "content": "请基于图片回答问题，并优先描述可见事实。"},
        {"role": "assistant", "content": text.strip()},
    ]


def _sample_image_paths(asset: Asset, sample: dict[str, Any] | None = None) -> list[Path]:
    frames = (sample or {}).get("frames", [])
    paths = [
        Path(str(frame.get("stored_path", "")))
        for frame in frames
        if isinstance(frame, dict) and frame.get("stored_path")
    ]
    return paths or [Path(asset.stored_path)]


def _augment_prompt_for_driving(prompt: str, sample: dict[str, Any] | None = None) -> str:
    sample = sample or {}
    level = sample.get("annotation_level", "instance")
    if level == "behavior":
        return (
            f"{prompt}\n\n"
            "当前任务是智能驾驶行为级标注。请综合 1~10 帧连续道路驾驶图片进行推理，"
            "重点关注主车/目标车/行人/骑行者行为、车道线、交通信号、可行驶区域、时序变化、潜在风险和判断依据。"
            f"\n\n{TEACHER_OUTPUT_FORMAT_PROMPT}"
        )
    return (
        f"{prompt}\n\n"
        "当前任务是智能驾驶实例级标注。请围绕单帧道路图像中的车辆、行人、骑行者、车道线、交通标志/信号灯、"
        f"可行驶区域或关键目标实例生成高质量问答。\n\n{TEACHER_OUTPUT_FORMAT_PROMPT}"
    )


def label_asset_with_teacher(settings: VlmSettings, asset: Asset, sample: dict[str, Any] | None = None, task_prompt: str = "") -> dict[str, Any]:
    if not settings.endpoint or not settings.model:
        return {"messages": _fallback_messages(asset, sample), "provider": "template", "raw": None}

    prompt = task_prompt.strip()
    if not prompt:
        raise ValueError("标注任务缺少场景提示词")
    content = [{"type": "text", "text": _augment_prompt_for_driving(prompt, sample)}]
    image_paths = _sample_image_paths(asset, sample)
    for index, image_path in enumerate(image_paths, start=1):
        if len(image_paths) > 1:
            content.append({"type": "text", "text": f"frame_{index}"})
        content.append({"type": "image_url", "image_url": {"url": image_to_data_url(image_path)}})
    headers = {"Content-Type": "application/json"}
    if settings.api_key:
        headers["Authorization"] = f"Bearer {settings.api_key}"
    payload = {
        "model": settings.model,
        "messages": [{"role": "user", "content": content}],
        "temperature": 0.2,
    }

    with httpx.Client(timeout=settings.timeout_seconds) as client:
        response = client.post(_teacher_endpoint(settings.endpoint), json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()

    text = data["choices"][0]["message"]["content"]
    return {"messages": _coerce_teacher_messages(text), "provider": settings.model, "raw": data}


async def prelabel_asset(db: Session, asset: Asset) -> dict[str, Any]:
    settings = VlmSettings(**get_setting(db, "vlm", VlmSettings().model_dump()))
    try:
        return label_asset_with_teacher(settings, asset)
    except Exception as exc:
        return {"messages": _fallback_messages(asset), "provider": "template-fallback", "raw": {"error": str(exc)}}


def _refresh_job_counts(db: Session, job_id: str) -> None:
    job = db.get(AnnotationJob, job_id)
    if not job:
        return
    rows = db.execute(
        select(AnnotationJobItem.status, func.count(AnnotationJobItem.id))
        .where(AnnotationJobItem.job_id == job_id)
        .group_by(AnnotationJobItem.status)
    ).all()
    counts = {status: count for status, count in rows}
    job.completed_count = counts.get("completed", 0)
    job.failed_count = counts.get("failed", 0)
    if job.completed_count + job.failed_count >= job.total_count and job.status not in {"cancelled", "failed"}:
        job.status = "completed" if job.failed_count == 0 else "completed_with_errors"
        job.finished_at = datetime.utcnow()


def _process_job_item(item_id: int, settings_data: dict[str, Any]) -> None:
    with SessionLocal() as db:
        item = db.get(AnnotationJobItem, item_id)
        if not item:
            return
        item.status = "running"
        db.commit()

        asset = item.asset
        sample = json_loads(item.sample_json, {})
        settings = VlmSettings(**settings_data)
        task_prompt = str(settings_data.get("task_prompt", ""))
        try:
            suggestion = label_asset_with_teacher(settings, asset, sample, task_prompt=task_prompt)
            annotation = asset.annotation
            annotation.messages_json = json_dumps(suggestion["messages"])
            annotation.status = "prelabelled"
            provenance = json_loads(annotation.provenance_json, {})
            provenance.update({"teacher_provider": suggestion["provider"], "annotation_job_id": item.job_id, "sample": sample, "raw": suggestion["raw"]})
            annotation.provenance_json = json_dumps(provenance)
            item.status = "completed"
            item.provider = suggestion["provider"]
            item.error = ""
        except Exception as exc:
            item.status = "failed"
            item.error = str(exc)
        _refresh_job_counts(db, item.job_id)
        db.commit()


def _run_annotation_job(job_id: str) -> None:
    with SessionLocal() as db:
        job = db.get(AnnotationJob, job_id)
        if not job:
            return
        job.status = "running"
        job.started_at = datetime.utcnow()
        settings_data = get_setting(db, "vlm", VlmSettings().model_dump())
        config = json_loads(job.config_json, {})
        settings_data["task_prompt"] = config.get("prompt_template", "")
        item_ids = [row[0] for row in db.execute(select(AnnotationJobItem.id).where(AnnotationJobItem.job_id == job_id)).all()]
        db.commit()

    concurrency = max(1, min(int(config.get("concurrency", 3)), 16))
    try:
        with ThreadPoolExecutor(max_workers=concurrency) as executor:
            futures = [executor.submit(_process_job_item, item_id, settings_data) for item_id in item_ids]
            for future in as_completed(futures):
                future.result()
    except Exception as exc:
        with SessionLocal() as db:
            job = db.get(AnnotationJob, job_id)
            if job:
                job.status = "failed"
                job.error = str(exc)
                job.finished_at = datetime.utcnow()
                db.commit()
    finally:
        with SessionLocal() as db:
            _refresh_job_counts(db, job_id)
            db.commit()


def _frame_payload(asset: Asset, index: int) -> dict[str, Any]:
    return {
        "index": index,
        "asset_id": asset.id,
        "file_name": asset.file_name,
        "original_path": asset.original_path,
        "stored_path": asset.stored_path,
        "width": asset.width,
        "height": asset.height,
        "sha256": asset.sha256,
    }


def _sample_from_assets(assets: list[Asset], annotation_level: str, source_dir: str, sample_index: int) -> dict[str, Any]:
    return {
        "sample_id": f"{annotation_level}_{sample_index:06d}",
        "annotation_level": annotation_level,
        "frame_count": len(assets),
        "source_dir": source_dir,
        "primary_asset_id": assets[0].id,
        "frames": [_frame_payload(asset, index) for index, asset in enumerate(assets, start=1)],
    }


def _build_job_samples(assets: list[Asset], annotation_level: str, frame_count: int, source_dir: str) -> list[dict[str, Any]]:
    if annotation_level == "behavior":
        group_size = max(1, min(frame_count, 10))
        groups = [assets[index:index + group_size] for index in range(0, len(assets), group_size)]
        return [_sample_from_assets(group, annotation_level, source_dir, index) for index, group in enumerate(groups, start=1) if group]
    return [_sample_from_assets([asset], "instance", source_dir, index) for index, asset in enumerate(assets, start=1)]


def _create_assets_for_job(db: Session, request: AnnotationJobCreateRequest) -> tuple[list[Asset], list[dict[str, str]]]:
    failed: list[dict[str, str]] = []
    files = _scan_image_files(request.folder_path)
    if not files:
        raise HTTPException(status_code=400, detail="目录中没有可标注的图片")

    batch = request.name.strip() or Path(request.folder_path).expanduser().resolve().name
    assets: list[Asset] = []
    for source in files:
        try:
            asset = _create_asset_from_source(
                db,
                source,
                batch=batch,
                copy_assets=request.copy_assets,
                provenance={"source": "annotation_job", "annotation_level": request.annotation_level},
            )
            assets.append(asset)
        except Exception as exc:
            failed.append({"path": str(source), "reason": str(exc)})

    if not assets:
        raise HTTPException(status_code=400, detail={"message": "目录中没有可用图片", "failed": failed})
    return assets, failed


def create_annotation_job(db: Session, request: AnnotationJobCreateRequest) -> dict[str, Any]:
    prompt_config = resolve_job_prompt(db, request)
    source_dir = ""
    failed_imports: list[dict[str, str]] = []
    if request.folder_path.strip():
        source_dir = str(Path(request.folder_path).expanduser().resolve())
        assets, failed_imports = _create_assets_for_job(db, request)
    else:
        statement = select(Asset).join(Annotation).order_by(Asset.created_at)
        if request.asset_ids:
            statement = statement.where(Asset.id.in_(request.asset_ids))
        else:
            if request.batch:
                statement = statement.where(Asset.batch == request.batch)
            if request.status and request.status != "all":
                statement = statement.where(Annotation.status == request.status)
            if not request.overwrite_existing:
                statement = statement.where(Annotation.status.in_(["raw", "rework"]))

        assets = db.scalars(statement).all()
        source_dir = request.batch or "asset_pool"
        if not assets:
            raise HTTPException(status_code=400, detail="没有可标注的素材")

    samples = _build_job_samples(assets, request.annotation_level, request.frame_count, source_dir)

    job_id = str(uuid.uuid4())
    job = AnnotationJob(
        id=job_id,
        name=request.name,
        status="queued",
        source_json=json_dumps(
            {
                "folder_path": source_dir,
                "batch": request.batch,
                "status": request.status,
                "asset_ids": request.asset_ids,
                "failed_imports": failed_imports,
            }
        ),
        config_json=json_dumps(
            {
                "concurrency": request.concurrency,
                "overwrite_existing": request.overwrite_existing,
                "copy_assets": request.copy_assets,
                "annotation_level": request.annotation_level,
                "frame_count": max(1, min(request.frame_count, 10)) if request.annotation_level == "behavior" else 1,
                **prompt_config,
            }
        ),
        total_count=len(samples),
    )
    db.add(job)
    db.flush()
    for sample in samples:
        db.add(AnnotationJobItem(job_id=job_id, asset_id=sample["primary_asset_id"], status="queued", sample_json=json_dumps(sample)))
    db.commit()

    thread = threading.Thread(target=_run_annotation_job, args=(job_id,), daemon=True)
    thread.start()
    db.refresh(job)
    return annotation_job_payload(job, include_items=True)


def resolve_job_prompt(db: Session, request: AnnotationJobCreateRequest) -> dict[str, Any]:
    custom_prompt = request.custom_prompt.strip()
    if custom_prompt:
        return {
            "prompt_mode": "custom",
            "prompt_template": custom_prompt,
            "prompt_scene_id": request.prompt_scene_id,
            "prompt_version_id": request.prompt_version_id,
            "prompt_label": "临时录入",
        }

    version: PromptVersion | None = None
    if request.prompt_version_id:
        version = db.get(PromptVersion, request.prompt_version_id)
        if not version:
            raise HTTPException(status_code=404, detail="提示词版本不存在")
        if request.prompt_scene_id and version.scene_id != request.prompt_scene_id:
            raise HTTPException(status_code=400, detail="提示词版本不属于所选场景")
    elif request.prompt_scene_id:
        version = db.scalar(
            select(PromptVersion)
            .where(PromptVersion.scene_id == request.prompt_scene_id)
            .order_by(PromptVersion.created_at.desc())
        )
        if not version:
            raise HTTPException(status_code=400, detail="所选场景还没有提示词版本")

    if version:
        scene = version.scene
        return {
            "prompt_mode": "version",
            "prompt_template": version.prompt_text,
            "prompt_scene_id": scene.id,
            "prompt_scene_name": scene.name,
            "prompt_version_id": version.id,
            "prompt_version": version.version,
            "prompt_label": f"{scene.name} / {version.version}",
        }

    raise HTTPException(status_code=400, detail="请在标注任务中输入任务提示词，或选择一个提示词场景/版本")


def _download_messages(messages: list[dict[str, str]]) -> list[dict[str, str]]:
    return [
        {"role": message.get("role", ""), "content": message.get("content", "")}
        for message in messages
        if message.get("role") in {"user", "assistant"}
    ]


def export_annotation_job(
    db: Session,
    job_id: str,
    request: AnnotationJobExportRequest,
    include_images: bool = True,
    json_array: bool = False,
) -> dict[str, Any]:
    job = db.get(AnnotationJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="标注任务不存在")

    safe_name = "".join(char if char.isalnum() or char in "-_" else "_" for char in job.name)[:80] or "annotation_job"
    export_root = EXPORT_DIR / f"{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{safe_name}_{job.id[:8]}"
    image_dir = export_root / "images"
    export_root.mkdir(parents=True, exist_ok=True)
    if include_images:
        image_dir.mkdir(parents=True, exist_ok=True)

    rows: list[dict[str, Any]] = []
    validation_errors: list[dict[str, Any]] = []
    for item in sorted(job.items, key=lambda row: row.id):
        asset = item.asset
        annotation = asset.annotation
        sample = json_loads(item.sample_json, {})
        if item.status != "completed":
            continue
        if request.accepted_only and annotation.status != "accepted":
            continue
        messages = json_loads(annotation.messages_json, [])
        result = validate_annotation(asset, messages)
        if result["errors"]:
            validation_errors.append({"asset_id": asset.id, "errors": result["errors"]})
            continue

        frames = sample.get("frames") if isinstance(sample.get("frames"), list) else []
        if not frames:
            frames = [_frame_payload(asset, 1)]
        image_paths: list[str] = []
        frame_errors: list[str] = []
        for index, frame in enumerate(frames, start=1):
            if not isinstance(frame, dict):
                continue
            source = Path(str(frame.get("stored_path") or asset.stored_path))
            if not source.exists():
                frame_errors.append(f"第 {index} 帧图片不存在: {source}")
                continue
            if include_images:
                digest = str(frame.get("sha256") or asset.sha256)
                target_name = f"{item.id}_{index:02d}_{digest[:16]}{source.suffix.lower()}"
                shutil.copy2(source, image_dir / target_name)
                image_paths.append(f"images/{target_name}")
            else:
                original = Path(str(frame.get("original_path") or ""))
                image_paths.append(str(original if original.exists() else source))

        if frame_errors or not image_paths:
            validation_errors.append({"asset_id": asset.id, "job_item_id": item.id, "errors": frame_errors or ["样本图片为空"]})
            continue

        if json_array:
            rows.append({"images": image_paths, "messages": _download_messages(messages)})
        else:
            rows.append(
                {
                    "messages": messages,
                    "images": image_paths,
                    "meta": {
                        "asset_id": asset.id,
                        "annotation_id": annotation.id,
                        "annotation_job_id": job.id,
                        "annotation_level": sample.get("annotation_level", "instance"),
                        "frame_count": len(image_paths),
                        "sample_id": sample.get("sample_id", str(item.id)),
                        "source": asset.original_path,
                        "sources": [frame.get("original_path") for frame in frames if isinstance(frame, dict)],
                        "batch": asset.batch,
                    },
                }
            )

    if not rows:
        raise HTTPException(status_code=400, detail={"message": "没有可导出的合格样本", "validation_errors": validation_errors})

    data_path = export_root / ("data.json" if json_array else "data.jsonl")
    with data_path.open("w", encoding="utf-8") as handle:
        if json_array:
            handle.write(json.dumps(rows, ensure_ascii=False, indent=2))
        else:
            for row in rows:
                handle.write(json_dumps(row) + "\n")
    manifest = {
        "id": str(uuid.uuid4()),
        "annotation_job_id": job.id,
        "name": job.name,
        "created_at": datetime.utcnow().isoformat(),
        "format": "json-array-multimodal" if json_array else "ms-swift-jsonl-multimodal",
        "path": data_path.name,
        "count": len(rows),
        "annotation_level": json_loads(job.config_json, {}).get("annotation_level", "instance"),
        "include_images": include_images,
        "json_array": json_array,
        "validation_errors": validation_errors,
    }
    (export_root / "manifest.json").write_text(json_dumps(manifest), encoding="utf-8")
    job.export_path = str(export_root)
    db.commit()
    return {
        "export_path": str(export_root),
        "jsonl_path": str(data_path),
        "json_path": str(data_path),
        "count": len(rows),
        "validation_errors": validation_errors,
    }


def export_dataset(db: Session, request: DatasetExportRequest) -> dict[str, Any]:
    statuses = ["accepted"] if not request.include_rework else ["accepted", "rework"]
    annotations = db.scalars(select(Annotation).where(Annotation.status.in_(statuses)).order_by(Annotation.updated_at)).all()
    valid_rows: list[tuple[Asset, Annotation, list[dict[str, str]]]] = []
    validation_errors: list[dict[str, Any]] = []

    for annotation in annotations:
        asset = annotation.asset
        messages = json_loads(annotation.messages_json, [])
        result = validate_annotation(asset, messages)
        if result["errors"]:
            validation_errors.append({"asset_id": asset.id, "errors": result["errors"]})
        else:
            valid_rows.append((asset, annotation, messages))

    if not valid_rows:
        raise HTTPException(status_code=400, detail={"message": "没有可导出的合格 accepted 样本", "validation_errors": validation_errors})

    random.Random(request.seed).shuffle(valid_rows)
    golden_rows = [row for row in valid_rows if row[1].is_golden]
    train_val_rows = [row for row in valid_rows if not row[1].is_golden]
    val_count = int(len(train_val_rows) * request.val_ratio)
    val_rows = train_val_rows[:val_count]
    train_rows = train_val_rows[val_count:]

    version_id = str(uuid.uuid4())
    safe_name = "".join(char if char.isalnum() or char in "-_" else "_" for char in request.name)[:80] or "dataset"
    export_root = EXPORT_DIR / f"{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{safe_name}_{version_id[:8]}"
    image_dir = export_root / "images"
    export_root.mkdir(parents=True, exist_ok=True)
    image_dir.mkdir(parents=True, exist_ok=True)

    def write_split(name: str, rows: list[tuple[Asset, Annotation, list[dict[str, str]]]]) -> None:
        with (export_root / f"{name}.jsonl").open("w", encoding="utf-8") as handle:
            for asset, annotation, messages in rows:
                source = Path(asset.stored_path)
                target_name = f"{asset.sha256[:16]}{source.suffix.lower()}"
                shutil.copy2(source, image_dir / target_name)
                record = {
                    "messages": messages,
                    "images": [f"images/{target_name}"],
                    "meta": {
                        "asset_id": asset.id,
                        "annotation_id": annotation.id,
                        "source": asset.original_path,
                        "batch": asset.batch,
                    },
                }
                handle.write(json_dumps(record) + "\n")

    write_split("train", train_rows)
    write_split("val", val_rows)
    write_split("golden", golden_rows)

    manifest = {
        "id": version_id,
        "name": request.name,
        "created_at": datetime.utcnow().isoformat(),
        "format": "ms-swift-jsonl-multimodal",
        "splits": {
            "train": {"path": "train.jsonl", "count": len(train_rows)},
            "val": {"path": "val.jsonl", "count": len(val_rows)},
            "golden": {"path": "golden.jsonl", "count": len(golden_rows)},
        },
        "swift_template": request.swift_template,
        "validation_errors": validation_errors,
    }
    (export_root / "manifest.json").write_text(json_dumps(manifest), encoding="utf-8")
    (export_root / "dataset_info.json").write_text(
        json_dumps(
            [
                {"dataset_path": str(export_root / "train.jsonl"), "columns": {"messages": "messages", "images": "images"}},
                {"dataset_path": str(export_root / "val.jsonl"), "columns": {"messages": "messages", "images": "images"}},
            ]
        ),
        encoding="utf-8",
    )

    dataset = DatasetVersion(
        id=version_id,
        name=request.name,
        export_path=str(export_root),
        manifest_json=json_dumps(manifest),
        train_count=len(train_rows),
        val_count=len(val_rows),
        golden_count=len(golden_rows),
    )
    db.add(dataset)
    db.commit()
    return dataset_payload(dataset)


def dataset_payload(dataset: DatasetVersion) -> dict[str, Any]:
    return {
        "id": dataset.id,
        "name": dataset.name,
        "export_path": dataset.export_path,
        "manifest": json_loads(dataset.manifest_json, {}),
        "train_count": dataset.train_count,
        "val_count": dataset.val_count,
        "golden_count": dataset.golden_count,
        "created_at": dataset.created_at.isoformat(),
    }


def status_counts(db: Session) -> dict[str, int]:
    rows = db.execute(select(Annotation.status, func.count(Annotation.id)).group_by(Annotation.status)).all()
    counts = {status: count for status, count in rows}
    for status in ["raw", "prelabelled", "annotated", "accepted", "rework"]:
        counts.setdefault(status, 0)
    return counts
