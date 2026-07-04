from __future__ import annotations

import json
import sys
import time
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_directory_annotation_job_and_behavior_swift_json_export(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("LORA_TOOL_DATA", str(tmp_path / "data"))

    from app.main import app

    image_dir = tmp_path / "images"
    image_dir.mkdir()
    for index, color in enumerate([(120, 40, 80), (20, 120, 80), (40, 80, 180), (180, 160, 40)], start=1):
        Image.new("RGB", (64, 48), color=color).save(image_dir / f"road_frame_{index:03d}.jpg")

    client = TestClient(app)

    response = client.get("/settings")
    assert response.status_code == 200
    assert "prompt_template" not in response.json()["vlm"]

    response = client.post(
        "/annotation-jobs",
        json={
            "name": "missing_prompt",
            "folder_path": str(image_dir),
            "annotation_level": "instance",
            "concurrency": 1,
        },
    )
    assert response.status_code == 400
    assert "提示词" in response.json()["detail"]

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
            "folder_path": str(image_dir),
            "annotation_level": "behavior",
            "frame_count": 2,
            "concurrency": 2,
            "copy_assets": True,
            "prompt_scene_id": scene_id,
            "prompt_version_id": prompt_version_id,
        },
    )
    assert response.status_code == 200
    job_id = response.json()["id"]
    assert response.json()["config"]["prompt_scene_id"] == scene_id
    assert response.json()["config"]["prompt_version_id"] == prompt_version_id
    assert response.json()["config"]["prompt_label"] == "cot_scene / v1"
    assert response.json()["config"]["annotation_level"] == "behavior"
    assert response.json()["total_count"] == 2

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
    assert job["items"][0]["sample"]["annotation_level"] == "behavior"
    assert job["items"][0]["sample"]["frame_count"] == 2
    assert len(job["items"][0]["sample"]["frames"]) == 2

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
    lines = [line for line in jsonl_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert '"messages"' in lines[0]
    assert '"images"' in lines[0]
    assert lines[0].count("images/") == 2
    assert '"annotation_level":"behavior"' in lines[0]

    response = client.get(f"/annotation-jobs/{job_id}/export/download?accepted_only=false")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert "attachment" in response.headers["content-disposition"]
    assert response.headers["content-disposition"].endswith(".json\"")
    downloaded_rows = json.loads(response.content.decode("utf-8"))
    assert isinstance(downloaded_rows, list)
    downloaded_row = downloaded_rows[0]
    assert set(downloaded_row.keys()) == {"images", "messages"}
    assert str(image_dir) in downloaded_row["images"][0]
    assert {message["role"] for message in downloaded_row["messages"]} == {"user", "assistant"}
