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
