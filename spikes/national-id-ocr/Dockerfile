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

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=120 \
    PIP_RETRIES=10 \
    PADDLE_HOME=/models \
    PADDLE_PDX_CACHE_HOME=/models

# libgl/libglib: OpenCV's runtime deps even in the headless wheel.
# libraqm: complex-text shaping, required to render Arabic correctly in the fixture generator.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 libgomp1 libraqm0 fonts-freefont-ttf \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
# The wheel cache is a BuildKit cache mount, so it never reaches a layer (image size is unchanged)
# but survives a failed build: ~400 MB of wheels over a slow or flaky link is not re-downloaded
# from zero every time one connection drops, which is how the first real build of this died.
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --prefix=/install -r /tmp/requirements.txt

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

# ══ Vision-language readers (Step 2) ═════════════════════════════════════════
# Each VLM gets its OWN target, built FROM `runtime`, so the PaddleOCR-only image stays exactly as
# small as it was and the gigabytes of VLM weights exist only in the images that use them:
#
#   docker build --target runtime      → PaddleOCR only (also the default: see the last stage)
#   docker build --target paddleocr-vl → + PaddleOCR-VL-1.6, transformers, torch (CPU)
#   docker build --target qwen         → + Qwen3.5-4B Q4_K_M + mmproj, llama-server
#
# Every artefact is pinned: model repos by commit, the llama.cpp image by digest, Python packages
# by version, and the GGUF files by SHA-256. All weights are baked in; the containers run with
# `--network none`.

# ── weights, fetched in throwaway stages so download tooling never ships ────
# One stage per model, so building one target never downloads the other's weights. Based on the
# installed packages only, NOT on `runtime`: built from `runtime`, every edit under src/ invalidated
# these stages and re-downloaded gigabytes of pinned, unchanged weights on each rebuild.
FROM python:3.11-slim AS vlm-fetch
COPY --from=builder /install /usr/local

FROM vlm-fetch AS paddleocr-vl-weights
ARG PADDLEOCR_VL_REVISION=c5630abae1d940eafe0697512a0325494b02ab42
COPY scripts/fetch_vlm.py /tmp/fetch_vlm.py
RUN python /tmp/fetch_vlm.py paddleocr_vl

FROM vlm-fetch AS qwen-weights
ARG QWEN_GGUF_REVISION=e87f176479d0855a907a41277aca2f8ee7a09523
COPY scripts/fetch_vlm.py /tmp/fetch_vlm.py
RUN python /tmp/fetch_vlm.py qwen

# ── PaddleOCR-VL-1.6 (0.9B) via transformers, CPU ────────────────────────────
FROM runtime AS paddleocr-vl
# CPU-only torch from PyTorch's own index (the default wheel bundles CUDA: gigabytes of nothing on
# a CPU host). The base requirements are passed as constraints, so nothing PaddleOCR depends on —
# numpy, Pillow, OpenCV — is upgraded underneath it.
COPY requirements.txt requirements-vlm.txt /tmp/
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --index-url https://download.pytorch.org/whl/cpu torch==2.14.1 \
 && pip install -c /tmp/requirements.txt -r /tmp/requirements-vlm.txt
COPY --from=paddleocr-vl-weights /vlm/PaddleOCR-VL-1.6 /models/vlm/PaddleOCR-VL-1.6
ENV OCR_TEXT_RECOGNIZER=paddleocr_vl \
    PADDLEOCR_VL_DIR=/models/vlm/PaddleOCR-VL-1.6 \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1

# ── Qwen3.5-4B (Q4_K_M GGUF + vision projector) via llama-server ─────────────
# The official llama.cpp CPU server image, pinned by digest (build 11515, commit 3d65c90d0). Its
# binaries and ggml backends are copied in as-is; they need only libstdc++, libgomp and libssl,
# all already in the runtime base.
FROM ghcr.io/ggml-org/llama.cpp@sha256:f8f71e3be397e868cdddfb9c404e3a263d9697f82fd7205f4737ac981feea4b8 AS llama-cpp

FROM runtime AS qwen
COPY --from=llama-cpp /app /opt/llama
COPY --from=qwen-weights /vlm/qwen /models/vlm/qwen
ENV OCR_TEXT_RECOGNIZER=qwen \
    LLAMA_SERVER=/opt/llama/llama-server \
    LD_LIBRARY_PATH=/opt/llama \
    QWEN_GGUF=/models/vlm/qwen/Qwen3.5-4B-Q4_K_M.gguf \
    QWEN_MMPROJ=/models/vlm/qwen/mmproj-F16.gguf
RUN /opt/llama/llama-server --version

# ── default: a plain `docker build .` is still the PaddleOCR-only image ──────
FROM runtime AS default
