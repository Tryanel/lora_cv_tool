from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utc_now() -> datetime:
    return datetime.utcnow()


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    file_name: Mapped[str] = mapped_column(String(255), index=True)
    original_path: Mapped[str] = mapped_column(Text)
    stored_path: Mapped[str] = mapped_column(Text)
    mime_type: Mapped[str] = mapped_column(String(80), default="image")
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    perceptual_hash: Mapped[str] = mapped_column(String(32), index=True)
    width: Mapped[int] = mapped_column(Integer, default=0)
    height: Mapped[int] = mapped_column(Integer, default=0)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    batch: Mapped[str] = mapped_column(String(120), default="default", index=True)
    tags_json: Mapped[str] = mapped_column(Text, default="[]")
    quality_score: Mapped[float] = mapped_column(Float, default=0.0)
    duplicate_of: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("assets.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    annotation: Mapped["Annotation"] = relationship(back_populates="asset", uselist=False, cascade="all, delete-orphan")


class Annotation(Base):
    __tablename__ = "annotations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    asset_id: Mapped[int] = mapped_column(Integer, ForeignKey("assets.id"), unique=True, index=True)
    messages_json: Mapped[str] = mapped_column(Text, default="[]")
    status: Mapped[str] = mapped_column(String(32), default="raw", index=True)
    provenance_json: Mapped[str] = mapped_column(Text, default="{}")
    is_golden: Mapped[int] = mapped_column(Integer, default=0, index=True)
    rework_reason: Mapped[str] = mapped_column(Text, default="")
    quality_notes: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)

    asset: Mapped[Asset] = relationship(back_populates="annotation")


class AnnotationJob(Base):
    __tablename__ = "annotation_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(160), index=True)
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    source_json: Mapped[str] = mapped_column(Text, default="{}")
    config_json: Mapped[str] = mapped_column(Text, default="{}")
    total_count: Mapped[int] = mapped_column(Integer, default=0)
    completed_count: Mapped[int] = mapped_column(Integer, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, default=0)
    export_path: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    items: Mapped[list["AnnotationJobItem"]] = relationship(back_populates="job", cascade="all, delete-orphan")


class AnnotationJobItem(Base):
    __tablename__ = "annotation_job_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[str] = mapped_column(String(36), ForeignKey("annotation_jobs.id"), index=True)
    asset_id: Mapped[int] = mapped_column(Integer, ForeignKey("assets.id"), index=True)
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    provider: Mapped[str] = mapped_column(String(160), default="")
    error: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)

    job: Mapped[AnnotationJob] = relationship(back_populates="items")
    asset: Mapped[Asset] = relationship()


class PromptScene(Base):
    __tablename__ = "prompt_scenes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)

    versions: Mapped[list["PromptVersion"]] = relationship(back_populates="scene", cascade="all, delete-orphan")


class PromptVersion(Base):
    __tablename__ = "prompt_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scene_id: Mapped[int] = mapped_column(Integer, ForeignKey("prompt_scenes.id"), index=True)
    version: Mapped[str] = mapped_column(String(80), index=True)
    prompt_text: Mapped[str] = mapped_column(Text)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    scene: Mapped[PromptScene] = relationship(back_populates="versions")


class DatasetVersion(Base):
    __tablename__ = "dataset_versions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(160), index=True)
    export_path: Mapped[str] = mapped_column(Text)
    manifest_json: Mapped[str] = mapped_column(Text)
    train_count: Mapped[int] = mapped_column(Integer, default=0)
    val_count: Mapped[int] = mapped_column(Integer, default=0)
    golden_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class TrainingRun(Base):
    __tablename__ = "training_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    dataset_version_id: Mapped[str] = mapped_column(String(36), index=True)
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    command_json: Mapped[str] = mapped_column(Text)
    env_json: Mapped[str] = mapped_column(Text, default="{}")
    log_path: Mapped[str] = mapped_column(Text)
    output_dir: Mapped[str] = mapped_column(Text)
    adapter_path: Mapped[str] = mapped_column(Text, default="")
    return_code: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class EvalRun(Base):
    __tablename__ = "eval_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    dataset_version_id: Mapped[str] = mapped_column(String(36), index=True)
    training_run_id: Mapped[str] = mapped_column(String(36), default="", index=True)
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    command_json: Mapped[str] = mapped_column(Text)
    metrics_json: Mapped[str] = mapped_column(Text, default="{}")
    samples_json: Mapped[str] = mapped_column(Text, default="[]")
    log_path: Mapped[str] = mapped_column(Text)
    return_code: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value_json: Mapped[str] = mapped_column(Text, default="{}")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
