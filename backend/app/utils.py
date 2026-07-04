from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import shutil
from pathlib import Path
from typing import Any

from PIL import Image, UnidentifiedImageError


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff"}


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def json_loads(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def perceptual_hash(path: Path) -> str:
    with Image.open(path) as image:
        small = image.convert("L").resize((8, 8), Image.Resampling.LANCZOS)
        pixels = list(small.getdata())
    avg = sum(pixels) / len(pixels)
    bits = "".join("1" if pixel >= avg else "0" for pixel in pixels)
    return f"{int(bits, 2):016x}"


def image_info(path: Path) -> dict[str, Any]:
    with Image.open(path) as image:
        width, height = image.size
        exif = {}
        try:
            raw_exif = image.getexif()
            exif = {str(key): str(value) for key, value in raw_exif.items()}
        except Exception:
            exif = {}
    return {
        "width": width,
        "height": height,
        "size_bytes": path.stat().st_size,
        "exif": exif,
        "mime_type": mimetypes.guess_type(path.name)[0] or "image",
    }


def safe_copy_asset(source: Path, target_dir: Path, digest: str) -> Path:
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{digest[:16]}{source.suffix.lower()}"
    if not target.exists():
        shutil.copy2(source, target)
    return target


def image_to_data_url(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def validate_image(path: Path) -> tuple[bool, str]:
    try:
        with Image.open(path) as image:
            image.verify()
        return True, ""
    except (UnidentifiedImageError, OSError) as exc:
        return False, str(exc)


def estimate_tokens(messages: list[dict[str, str]]) -> int:
    chars = sum(len(message.get("content", "")) for message in messages)
    return max(1, chars // 2)
