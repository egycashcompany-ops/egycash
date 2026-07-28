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
    PaddleOCR(
        lang=LANG,
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

    total_mb = sum(p.stat().st_size for p in weights) / (1024 * 1024)
    print(f"baked {len(weights)} weight files, {total_mb:.1f} MB total")
    for path in sorted(weights)[:20]:
        print(f"  {path.relative_to(MODEL_HOME)}  {path.stat().st_size / (1024 * 1024):.1f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
