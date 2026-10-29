"""Download one VLM's weights at BUILD time, pinned and verified. Never runs in a served image.

    python scripts/fetch_vlm.py paddleocr_vl   # → /vlm/PaddleOCR-VL-1.6  ($PADDLEOCR_VL_REVISION)
    python scripts/fetch_vlm.py qwen           # → /vlm/qwen               ($QWEN_GGUF_REVISION)

Same reasoning as `bake_models.py`: a container that downloads on first use is not offline, and
an unpinned download is not reproducible. The GGUF files are additionally checked against the
SHA-256 the repository publishes for them at the pinned commit, so a truncated or substituted file
fails the build rather than loading — or half-loading — at runtime.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import sys
from pathlib import Path

PADDLEOCR_VL_REPO = "PaddlePaddle/PaddleOCR-VL-1.6"
QWEN_REPO = "unsloth/Qwen3.5-4B-GGUF"

#: SHA-256 of each GGUF at QWEN_GGUF_REVISION, from the repository's LFS metadata.
QWEN_FILES = {
    "Qwen3.5-4B-Q4_K_M.gguf": "00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4",
    "mmproj-F16.gguf": "cd88edcf8d031894960bb0c9c5b9b7e1fea6ebee02b9f7ce925a00d12891f864",
}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 24), b""):
            digest.update(block)
    return digest.hexdigest()


def fetch_paddleocr_vl() -> None:
    from huggingface_hub import snapshot_download

    target = Path("/vlm/PaddleOCR-VL-1.6")
    snapshot_download(
        PADDLEOCR_VL_REPO,
        revision=os.environ["PADDLEOCR_VL_REVISION"],
        local_dir=str(target),
        allow_patterns=["*.json", "*.py", "*.jinja", "*.model", "*.safetensors", "*.yml", "LICENSE"],
    )
    shutil.rmtree(target / ".cache", ignore_errors=True)
    if not (target / "model.safetensors").is_file():
        raise SystemExit("FATAL: PaddleOCR-VL weights did not land")
    print("fetched", PADDLEOCR_VL_REPO)


def fetch_qwen() -> None:
    from huggingface_hub import hf_hub_download

    target = Path("/vlm/qwen")
    for name, expected in QWEN_FILES.items():
        path = Path(
            hf_hub_download(
                QWEN_REPO,
                name,
                revision=os.environ["QWEN_GGUF_REVISION"],
                local_dir=str(target),
            )
        )
        actual = _sha256(path)
        if actual != expected:
            raise SystemExit(f"FATAL: {name} sha256 {actual} != {expected}")
        print("verified", name)
    shutil.rmtree(target / ".cache", ignore_errors=True)


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else ""
    if which == "paddleocr_vl":
        fetch_paddleocr_vl()
    elif which == "qwen":
        fetch_qwen()
    else:
        raise SystemExit("usage: fetch_vlm.py paddleocr_vl|qwen")
