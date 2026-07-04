from __future__ import annotations

import os
import subprocess
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from .database import RUN_DIR, SessionLocal
from .models import DatasetVersion, EvalRun, TrainingRun
from .schemas import EvalRequest, SwiftSettings, TrainRequest
from .services import get_setting
from .utils import json_dumps, json_loads


processes: dict[str, subprocess.Popen[str]] = {}


def run_payload(run: TrainingRun | EvalRun) -> dict[str, Any]:
    payload = {
        "id": run.id,
        "status": run.status,
        "dataset_version_id": run.dataset_version_id,
        "command": json_loads(run.command_json, []),
        "log_path": run.log_path,
        "return_code": run.return_code,
        "error": run.error,
        "created_at": run.created_at.isoformat(),
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
    }
    if isinstance(run, TrainingRun):
        payload.update({"output_dir": run.output_dir, "adapter_path": run.adapter_path})
    else:
        payload.update(
            {
                "training_run_id": run.training_run_id,
                "metrics": json_loads(run.metrics_json, {}),
                "samples": json_loads(run.samples_json, []),
            }
        )
    return payload


def build_train_command(settings: SwiftSettings, dataset: DatasetVersion, request: TrainRequest, run_id: str) -> tuple[list[str], dict[str, str], Path]:
    root = Path(dataset.export_path)
    output_dir = Path(request.output_dir).expanduser().resolve() if request.output_dir else RUN_DIR / "train" / run_id / "output"
    output_dir.mkdir(parents=True, exist_ok=True)
    argv = [
        settings.swift_bin,
        "sft",
        "--model",
        request.model,
        "--tuner_type",
        "lora",
        "--dataset",
        str(root / "train.jsonl"),
        "--val_dataset",
        str(root / "val.jsonl"),
        "--torch_dtype",
        request.torch_dtype,
        "--num_train_epochs",
        str(request.num_train_epochs),
        "--per_device_train_batch_size",
        str(request.per_device_train_batch_size),
        "--gradient_accumulation_steps",
        str(request.gradient_accumulation_steps),
        "--learning_rate",
        request.learning_rate,
        "--lora_rank",
        str(request.lora_rank),
        "--lora_alpha",
        str(request.lora_alpha),
        "--target_modules",
        request.target_modules,
        "--output_dir",
        str(output_dir),
    ]
    if request.max_pixels:
        argv.extend(["--max_pixels", str(request.max_pixels)])
    argv.extend(request.extra_args)
    env = {}
    cuda = request.cuda_visible_devices or settings.default_cuda_visible_devices
    if cuda:
        env["CUDA_VISIBLE_DEVICES"] = cuda
    return argv, env, output_dir


def build_eval_command(settings: SwiftSettings, dataset: DatasetVersion, request: EvalRequest) -> tuple[list[str], dict[str, str]]:
    root = Path(dataset.export_path)
    adapter_path = request.adapters
    if request.training_run_id and not adapter_path:
        with SessionLocal() as db:
            train = db.get(TrainingRun, request.training_run_id)
            if train:
                adapter_path = train.adapter_path or train.output_dir
    eval_args = {"general_qa": {"local_path": str(root), "subset_list": ["golden"]}}
    argv = [
        settings.swift_bin,
        "eval",
        "--model",
        request.model,
        "--eval_backend",
        request.eval_backend,
        "--infer_backend",
        request.infer_backend,
        "--eval_dataset",
        "general_qa",
        "--eval_dataset_args",
        json_dumps(eval_args),
    ]
    if adapter_path:
        argv.extend(["--adapters", adapter_path])
    if request.eval_limit:
        argv.extend(["--eval_limit", str(request.eval_limit)])
    argv.extend(request.extra_args)
    env = {}
    cuda = request.cuda_visible_devices or settings.default_cuda_visible_devices
    if cuda:
        env["CUDA_VISIBLE_DEVICES"] = cuda
    return argv, env


def _execute(run_id: str, kind: str, argv: list[str], env_delta: dict[str, str], cwd: str, log_path: Path) -> None:
    model_cls = TrainingRun if kind == "train" else EvalRun
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with SessionLocal() as db:
        run = db.get(model_cls, run_id)
        if run:
            run.status = "running"
            run.started_at = datetime.utcnow()
            db.commit()

    env = os.environ.copy()
    env.update(env_delta)
    try:
        with log_path.open("a", encoding="utf-8", errors="replace") as log:
            log.write("$ " + " ".join(argv) + "\n\n")
            process = subprocess.Popen(
                argv,
                cwd=cwd or None,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
            )
            processes[run_id] = process
            assert process.stdout is not None
            for line in process.stdout:
                log.write(line)
                log.flush()
            return_code = process.wait()
    except FileNotFoundError as exc:
        return_code = 127
        error = f"无法启动命令：{exc}"
    except Exception as exc:
        return_code = 1
        error = str(exc)
    else:
        error = ""
    finally:
        processes.pop(run_id, None)

    with SessionLocal() as db:
        run = db.get(model_cls, run_id)
        if run:
            run.return_code = return_code
            run.error = error
            run.status = "succeeded" if return_code == 0 else "failed"
            run.finished_at = datetime.utcnow()
            if isinstance(run, TrainingRun):
                run.adapter_path = run.output_dir
            db.commit()


def start_train_run(request: TrainRequest) -> dict[str, Any]:
    with SessionLocal() as db:
        dataset = db.get(DatasetVersion, request.dataset_version_id)
        if not dataset:
            raise ValueError("数据集版本不存在")
        settings = SwiftSettings(**get_setting(db, "swift", SwiftSettings().model_dump()))
        run_id = str(uuid.uuid4())
        argv, env, output_dir = build_train_command(settings, dataset, request, run_id)
        run_dir = RUN_DIR / "train" / run_id
        log_path = run_dir / "train.log"
        run = TrainingRun(
            id=run_id,
            dataset_version_id=dataset.id,
            command_json=json_dumps(argv),
            env_json=json_dumps(env),
            log_path=str(log_path),
            output_dir=str(output_dir),
        )
        db.add(run)
        db.commit()
        payload = run_payload(run)
        cwd = settings.working_dir
    thread = threading.Thread(target=_execute, args=(run_id, "train", argv, env, cwd, log_path), daemon=True)
    thread.start()
    return payload


def start_eval_run(request: EvalRequest) -> dict[str, Any]:
    with SessionLocal() as db:
        dataset = db.get(DatasetVersion, request.dataset_version_id)
        if not dataset:
            raise ValueError("数据集版本不存在")
        settings = SwiftSettings(**get_setting(db, "swift", SwiftSettings().model_dump()))
        run_id = str(uuid.uuid4())
        argv, env = build_eval_command(settings, dataset, request)
        run_dir = RUN_DIR / "eval" / run_id
        log_path = run_dir / "eval.log"
        run = EvalRun(
            id=run_id,
            dataset_version_id=dataset.id,
            training_run_id=request.training_run_id,
            command_json=json_dumps(argv),
            log_path=str(log_path),
        )
        db.add(run)
        db.commit()
        payload = run_payload(run)
        cwd = settings.working_dir
    thread = threading.Thread(target=_execute, args=(run_id, "eval", argv, env, cwd, log_path), daemon=True)
    thread.start()
    return payload


def kill_run(run_id: str) -> bool:
    process = processes.get(run_id)
    if not process:
        return False
    process.terminate()
    return True
