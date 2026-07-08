from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


def app_data_dir() -> Path:
    root = os.getenv("LORA_TOOL_DATA")
    if root:
        return Path(root).expanduser().resolve()
    return (Path(__file__).resolve().parents[1] / "data").resolve()


DATA_DIR = app_data_dir()
ASSET_DIR = DATA_DIR / "assets"
EXPORT_DIR = DATA_DIR / "exports"
RUN_DIR = DATA_DIR / "runs"
DB_PATH = DATA_DIR / "app.db"


class Base(DeclarativeBase):
    pass


def init_storage() -> None:
    for path in (DATA_DIR, ASSET_DIR, EXPORT_DIR, RUN_DIR):
        path.mkdir(parents=True, exist_ok=True)


init_storage()

engine = create_engine(
    f"sqlite:///{DB_PATH.as_posix()}",
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_schema_compat() -> None:
    """Keep local SQLite data compatible across small v1 schema changes."""
    with engine.begin() as connection:
        columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(annotation_job_items)").all()}
        if "sample_json" not in columns:
            connection.exec_driver_sql("ALTER TABLE annotation_job_items ADD COLUMN sample_json TEXT DEFAULT '{}'")

        prompt_scene_columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(prompt_scenes)").all()}
        if prompt_scene_columns and "annotation_level" not in prompt_scene_columns:
            connection.exec_driver_sql("ALTER TABLE prompt_scenes ADD COLUMN annotation_level VARCHAR(32) DEFAULT 'instance'")
            connection.exec_driver_sql("UPDATE prompt_scenes SET annotation_level = 'instance' WHERE annotation_level IS NULL OR annotation_level = ''")

        prompt_scene_columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(prompt_scenes)").all()}
        indexes = connection.exec_driver_sql("PRAGMA index_list(prompt_scenes)").all()
        has_name_level_unique = False
        has_name_only_unique = False
        for index in indexes:
            index_name = index[1]
            is_unique = bool(index[2])
            if not is_unique:
                continue
            index_columns = [row[2] for row in connection.exec_driver_sql(f'PRAGMA index_info("{index_name}")').all()]
            if index_columns == ["name", "annotation_level"]:
                has_name_level_unique = True
            if index_columns == ["name"]:
                has_name_only_unique = True

        if prompt_scene_columns and has_name_only_unique and not has_name_level_unique:
            connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
            connection.exec_driver_sql("ALTER TABLE prompt_scenes RENAME TO prompt_scenes_legacy")
            connection.exec_driver_sql(
                """
                CREATE TABLE prompt_scenes (
                    id INTEGER NOT NULL,
                    name VARCHAR(160) NOT NULL,
                    annotation_level VARCHAR(32) NOT NULL DEFAULT 'instance',
                    description TEXT NOT NULL,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    PRIMARY KEY (id),
                    CONSTRAINT uq_prompt_scene_name_level UNIQUE (name, annotation_level)
                )
                """
            )
            connection.exec_driver_sql(
                """
                INSERT INTO prompt_scenes (id, name, annotation_level, description, created_at, updated_at)
                SELECT id, name, COALESCE(NULLIF(annotation_level, ''), 'instance'), description, created_at, updated_at
                FROM prompt_scenes_legacy
                """
            )
            connection.exec_driver_sql("DROP TABLE prompt_scenes_legacy")
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")

        if prompt_scene_columns:
            connection.exec_driver_sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_prompt_scene_name_level "
                "ON prompt_scenes(name, annotation_level)"
            )
            connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_prompt_scenes_name ON prompt_scenes(name)")
            connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_prompt_scenes_annotation_level ON prompt_scenes(annotation_level)")
