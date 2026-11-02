"""Download the PP-OCR weights at build time so the runtime image never needs the network."""

from __future__ import annotations

import os
import sys
from pathlib import Path

MODEL_HOME = Path(os.environ.get("PADDLE_HOME", "/models"))
LANG = os.environ.get("PADDLE_OCR_LANG", "ar")


def main() -> int:
    MODEL_HOME.mkdir(parents=True, exist_ok=True)
    # PaddleOCR 3.x delegates model management to PaddleX, and PaddleX caches under
    # `PADDLE_PDX_CACHE_HOME` (paddlex/utils/cache.py), not `PADDLE_HOME`, which is a PaddlePaddle
    # variable that has no bearing on where weights land.
    os.environ["PADDLE_PDX_CACHE_HOME"] = str(MODEL_HOME)

    print(f"baking PP-OCR weights (lang={LANG}) into {MODEL_HOME} …", flush=True)
    from paddleocr import PaddleOCR

    # Constructing it is what triggers the fetch.
    detection = os.environ.get("PADDLE_DET_MODEL", "PP-OCRv5_mobile_det")
    recognition = os.environ.get("PADDLE_REC_MODEL", "arabic_PP-OCRv5_mobile_rec")
    print(f"  detection:   {detection}", flush=True)
    print(f"  recognition: {recognition}", flush=True)

    PaddleOCR(
        lang=LANG,
        text_detection_model_name=detection,
        text_recognition_model_name=recognition,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
    )

    weights = [p for p in MODEL_HOME.rglob("*") if p.is_file() and p.stat().st_size > 100_000]
    if not weights:
        print(
            f"FATAL: no model files under {MODEL_HOME}. The build must not proceed — the image "
            "would start fine and then read nothing at runtime.",
            file=sys.stderr,
        )
        return 1

    # Check the models by name, not just that some weights arrived.
    for role, name in (("detection", detection), ("recognition", recognition)):
        if not (MODEL_HOME / "official_models" / name).is_dir():
            print(
                f"FATAL: {role} model '{name}' is not under {MODEL_HOME}. PaddleOCR resolved "
                f"something else — check the 'Creating model' lines above. Present: "
                f"{sorted(p.name for p in (MODEL_HOME / 'official_models').glob('*'))}",
                file=sys.stderr,
            )
            return 1

    total_mb = sum(p.stat().st_size for p in weights) / (1024 * 1024)
    print(f"baked {len(weights)} weight files, {total_mb:.1f} MB total")
    for path in sorted(weights)[:20]:
        print(f"  {path.relative_to(MODEL_HOME)}  {path.stat().st_size / (1024 * 1024):.1f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
