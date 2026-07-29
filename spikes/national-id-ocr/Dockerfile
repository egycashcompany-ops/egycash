# Local, offline National-ID OCR spike.
#
# Two stages for one reason: the weights must be IN the image, but the pip cache, build toolchain
# and PaddleOCR's own scratch files must not be. A single-stage build of this stack routinely
# ships 1 GB of things nobody needs, and image size is one of the numbers this spike reports — so
# an inflated one would be a misleading result, not just untidy packaging.
#
# Runtime does no network I/O. `PADDLE_OCR_MODEL_DIR` points at baked weights, and the recognizer
# is constructed with explicit paths so PaddleOCR has no reason to reach for a download.

# ── builder: install deps, fetch weights ─────────────────────────────────────
FROM python:3.11-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PADDLE_HOME=/models \
    PADDLE_PDX_CACHE_HOME=/models

# libgl/libglib: OpenCV's runtime deps even in the headless wheel.
# libraqm: complex-text shaping, required to render Arabic correctly in the fixture generator.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 libgomp1 libraqm0 fonts-freefont-ttf \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN pip install --prefix=/install -r /tmp/requirements.txt

# Bake the weights. Fails the build if nothing lands — see the script's closing assertion.
ENV PYTHONPATH=/install/lib/python3.11/site-packages
COPY scripts/bake_models.py /tmp/bake_models.py
RUN python /tmp/bake_models.py

# ── runtime ──────────────────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PADDLE_HOME=/models \
    PADDLE_OCR_MODEL_DIR=/models \
    PADDLE_PDX_CACHE_HOME=/models \
    PYTHONPATH=/app/src

RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 libgomp1 libraqm0 fonts-freefont-ttf \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /install /usr/local
COPY --from=builder /models /models

WORKDIR /app
COPY src/ /app/src/
COPY bench/ /app/bench/
COPY tools/ /app/tools/
COPY fixtures/ /app/fixtures/
# Calibrated geometry, shipped with the image and — importantly — ACTIVE BY DEFAULT.
#
# Shipping it as opt-in was a mistake with a visible cost. The built-in boxes in `layout.py` are
# derived from the synthetic fixtures, and on a real Egyptian card they sit too high: the name box
# catches the 'بطاقة تحقيق الشخصية' header and the address box reaches into the second name line.
# `egypt-nid.json` was measured from a real card precisely to fix that, then never switched on,
# because `OCR_LAYOUT_PROFILE` was documented as optional and left unset. So every deployment quietly
# ran geometry that was known not to fit the cards it was reading, and the resulting field soup got
# blamed on the recognizer.
#
# A default that is wrong for every real input is not a default. The synthetic geometry stays as the
# LIBRARY default — `make check` and the fixture harness are built around it — but the CONTAINER,
# which only ever sees real cards, now starts with the real-card profile. Override the variable to
# point at your own calibration; `tools/calibrate.py --emit-profile` writes one.
COPY profiles/ /app/profiles/
ENV OCR_LAYOUT_PROFILE=/app/profiles/egypt-nid.json

# Record the image's own size so `measure.py` can report it as a real number rather than an
# estimate. Approximated from the filesystem at build time — `docker images` remains the
# authority, and `make measure` passes its value through OCR_IMAGE_SIZE_MB when available.
RUN du -sm / --exclude=/proc --exclude=/sys 2>/dev/null | cut -f1 > /image-size-mb || true

# Single-threaded by default: the spike measures per-card latency, and letting BLAS spawn one
# thread per core makes CPU-time numbers meaningless across machines.
ENV OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1

# Prove offline operation at start: if the weights are missing the container fails immediately
# rather than at the first request.
RUN test -d /models && echo "models present"

EXPOSE 8099

# Default: serve. The API's provider talks to this. Measurement is the same image with a
# different command — `docker run <image> bench/measure.py --fixtures …` — so the thing being
# measured is byte-for-byte the thing that runs in production.
ENTRYPOINT ["python"]
CMD ["-m", "nidocr.service"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD python -c "import urllib.request,os;urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('OCR_PORT','8099')+'/health').read()" || exit 1
