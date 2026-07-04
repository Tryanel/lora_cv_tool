from __future__ import annotations

import sys
import time
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_teacher_annotation_job_and_swift_json_export(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("LORA_TOOL_DATA", str(tmp_path / "data"))

    from app.main import app

    image_dir = tmp_path / "images"
    image_dir.mkdir()
    Image.new("RGB", (64, 48), color=(120, 40, 80)).save(image_dir / "sample_a.jpg")
    Image.new("RGB", (64, 48), color=(20, 120, 80)).save(image_dir / "sample_b.jpg")

    client = TestClient(app)
    response = client.post("/assets/import", json={"folder_path": str(image_dir), "batch": "unit"})
    assert response.status_code == 200
    assert response.json()["imported"] == 2

    response = client.post("/prompt-scenes", json={"name": "cot_scene", "description": "produce cot annotations"})
    assert response.status_code == 200
    scene_id = response.json()["id"]
    response = client.post(
        "/prompt-versions",
        json={
            "scene_id": scene_id,
            "version": "v1",
            "prompt_text": "请为图片生产带推理过程的 COT 标注，并返回 messages JSON。",
            "notes": "initial cot prompt",
        },
    )
    assert response.status_code == 200
    prompt_version_id = response.json()["id"]

    response = client.post(
        "/annotation-jobs",
        json={
            "name": "unit_teacher",
            "batch": "unit",
            "status": "raw",
            "concurrency": 2,
            "overwrite_existing": False,
            "prompt_scene_id": scene_id,
            "prompt_version_id": prompt_version_id,
        },
    )
    assert response.status_code == 200
    job_id = response.json()["id"]
    assert response.json()["config"]["prompt_scene_id"] == scene_id
    assert response.json()["config"]["prompt_version_id"] == prompt_version_id
    assert response.json()["config"]["prompt_label"] == "cot_scene / v1"

    job = None
    for _ in range(50):
        response = client.get(f"/annotation-jobs/{job_id}")
        assert response.status_code == 200
        job = response.json()
        if job["status"] in {"completed", "completed_with_errors", "failed"}:
            break
        time.sleep(0.1)
    assert job is not None
    assert job["status"] == "completed"
    assert job["completed_count"] == 2
    assert len(job["items"]) == 2

    first_asset_id = job["items"][0]["asset_id"]
    response = client.get(f"/annotations/{first_asset_id}")
    assert response.status_code == 200
    assert response.json()["asset"]["annotation"]["status"] == "prelabelled"

    response = client.post(f"/annotations/{first_asset_id}/accept")
    assert response.status_code == 200

    response = client.post(f"/annotation-jobs/{job_id}/export", json={"accepted_only": False})
    assert response.status_code == 200
    export_payload = response.json()
    jsonl_path = Path(export_payload["jsonl_path"])
    assert jsonl_path.exists()
    assert export_payload["count"] == 2
    assert '"messages"' in jsonl_path.read_text(encoding="utf-8")
    assert '"images"' in jsonl_path.read_text(encoding="utf-8")
