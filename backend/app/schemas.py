from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


Role = Literal["system", "user", "assistant"]
Status = Literal["raw", "prelabelled", "annotated", "accepted", "rework"]
AnnotationLevel = Literal["instance", "behavior"]


class Message(BaseModel):
    role: Role
    content: str = ""


class ImportRequest(BaseModel):
    folder_path: str
    batch: str = "default"
    copy_assets: bool = True


class AnnotationJobCreateRequest(BaseModel):
    name: str = "teacher_annotation"
    folder_path: str = ""
    annotation_level: AnnotationLevel = "instance"
    frame_count: int = Field(default=1, ge=1, le=10)
    copy_assets: bool = True
    batch: str = ""
    status: str = "raw"
    asset_ids: list[int] = Field(default_factory=list)
    concurrency: int = Field(default=3, ge=1, le=16)
    overwrite_existing: bool = False
    prompt_scene_id: Optional[int] = None
    prompt_version_id: Optional[int] = None
    custom_prompt: str = ""


class AnnotationJobExportRequest(BaseModel):
    accepted_only: bool = False


class PromptSceneCreateRequest(BaseModel):
    name: str
    description: str = ""


class PromptVersionCreateRequest(BaseModel):
    scene_id: int
    version: str
    prompt_text: str
    notes: str = ""


class AnnotationSaveRequest(BaseModel):
    messages: list[Message]
    status: Optional[Status] = None
    is_golden: Optional[bool] = None
    quality_notes: str = ""
    tags: list[str] = Field(default_factory=list)
    quality_score: float = 0


class ReworkRequest(BaseModel):
    reason: str = ""


class DatasetExportRequest(BaseModel):
    name: str = "dataset"
    val_ratio: float = Field(default=0.1, ge=0, le=0.5)
    seed: int = 42
    include_rework: bool = False
    swift_template: dict[str, Any] = Field(default_factory=dict)


class SwiftSettings(BaseModel):
    swift_bin: str = "swift"
    working_dir: str = ""
    default_cuda_visible_devices: str = "0"


class VlmSettings(BaseModel):
    endpoint: str = ""
    api_key: str = ""
    model: str = ""
    timeout_seconds: int = Field(default=60, ge=1, le=600)


class TeacherConfig(VlmSettings):
    id: str = ""
    name: str = "默认 Teacher"


class TeacherConfigUpsertRequest(VlmSettings):
    id: Optional[str] = None
    name: str = "默认 Teacher"


class TeacherConnectionTestResult(BaseModel):
    ok: bool
    message: str
    status_code: Optional[int] = None
    latency_ms: Optional[int] = None
    endpoint: str = ""
    model: str = ""


class TrainRequest(BaseModel):
    dataset_version_id: str
    model: str
    cuda_visible_devices: str = ""
    output_dir: str = ""
    torch_dtype: str = "bfloat16"
    num_train_epochs: float = 1
    per_device_train_batch_size: int = 1
    gradient_accumulation_steps: int = 16
    learning_rate: str = "1e-4"
    lora_rank: int = 8
    lora_alpha: int = 32
    target_modules: str = "all-linear"
    max_pixels: Optional[int] = None
    extra_args: list[str] = Field(default_factory=list)


class EvalRequest(BaseModel):
    dataset_version_id: str
    model: str
    training_run_id: str = ""
    adapters: str = ""
    cuda_visible_devices: str = ""
    infer_backend: str = "transformers"
    eval_backend: str = "Native"
    eval_limit: Optional[int] = None
    extra_args: list[str] = Field(default_factory=list)
