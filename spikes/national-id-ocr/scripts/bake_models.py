"""Download the PP-OCR weights at BUILD time so the runtime image never needs the network.

This runs once, inside the Docker build. It instantiates PaddleOCR with the Arabic recognition
model, which triggers the one-off download into `PADDLE_HOME`, then asserts the files landed.

Why a build step rather than a lazy first-request download:

  * A container that fetches weights on first use is not an offline deployment. It works on the
    developer's laptop and fails in the environment that matters — usually at the worst moment,
    and usually looking like a timeout rather than a missing dependency.
  * It makes the image size honest. The weights are part of the artefact, so `docker images`
    reports what you will actually ship.
  * It pins behaviour. Weights fetched at runtime can change under you; weights baked at build
    time are immutable for the life of the tag.

The assertion at the end is the point: a silent partial download would otherwise surface much
later as "the model reads nothing", which is indistinguishable from bad accuracy.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

MODEL_HOME = Path(os.environ.get("PADDLE_HOME", "/models"))
LANG = os.environ.get("PADDLE_OCR_LANG", "ar")


def main() -> int:
    MODEL_HOME.mkdir(parents=True, exist_ok=True)
    # PaddleOCR 3.x delegates model management to PaddleX, and PaddleX caches under
    # `PADDLE_PDX_CACHE_HOME` (paddlex/utils/cache.py) — NOT `PADDLE_HOME`, which is a
    # PaddlePaddle variable that has no bearing on where weights land. Setting the wrong one is
    # silent: the download succeeds into `~/.paddlex`, the assertion below finds nothing here, and
    # the build fails with weights sitting in a directory the runtime image never copies.
    # This must be set before paddleocr is imported.
    os.environ["PADDLE_PDX_CACHE_HOME"] = str(MODEL_HOME)

    print(f"baking PP-OCR weights (lang={LANG}) into {MODEL_HOME} …", flush=True)
    from paddleocr import PaddleOCR

    # Constructing it is what triggers the fetch. All three optional stages are disabled so that
    # only the two models production actually loads — detection and Arabic recognition — are
    # pulled. Leaving them on downloads document-orientation and unwarping models as well, which
    # this pipeline never runs: crops come from a card that preprocess.py has already rectified
    # and deskewed.
    # These must match what the runtime asks for, or the offline container starts fine and then
    # cannot load a model that was never downloaded — a failure that appears only on the first real
    # request. Both sides read the same variables and the same defaults; `test_engine.py` asserts
    # the two files agree, because this script cannot import from src/ (the builder stage copies
    # only this file, by design — src/ has no business in the layer that fetches weights).
    #
    # BOTH must be named. PaddleOCR discards `lang` the moment any model name is given, so naming
    # only the detector replaced the Arabic recognizer with a generic one — a change that would
    # have shipped a pipeline unable to read Arabic at all. It failed the build instead, which is
    # the only reason it was caught, and is why the assertion below now checks for the recognizer
    # by name rather than trusting that some weights landed.
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

    # Check the models by NAME, not just that some weights arrived. "Weights are present" was
    # true while PaddleOCR was quietly substituting a generic recognizer for the Arabic one; the
    # build only failed because that substitute happened to be incompatible with the installed
    # paddle. Had it been compatible, the image would have shipped and simply stopped reading
    # Arabic — with a full /models directory and nothing to point at.
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
