# National ID OCR service. Two stages so the pip cache and build tools don't end up in the image.
# The PaddleOCR models are downloaded at build time; the running container needs no network.

# Build stage: install packages and download the models
FROM python:3.11-slim AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=120 \
    PIP_RETRIES=10 \
    PADDLE_HOME=/models \
    PADDLE_PDX_CACHE_HOME=/models

# OpenCV needs libgl/libglib; libraqm is for drawing Arabic in the sample-card generator.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 libgomp1 libraqm0 fonts-freefont-ttf \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
# No BuildKit cache mount: Railway rejects one without its own id, and a rejected build keeps the
# OLD service running silently. --no-cache-dir keeps the wheels out of the layer instead.
RUN pip install --no-cache-dir --prefix=/install -r /tmp/requirements.txt

# Download the models into /models (the build fails if they're missing).
ENV PYTHONPATH=/install/lib/python3.11/site-packages
COPY scripts/bake_models.py /tmp/bake_models.py
RUN python /tmp/bake_models.py

# Runtime stage
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
# Field positions measured on a real card.
COPY profiles/ /app/profiles/
ENV OCR_LAYOUT_PROFILE=/app/profiles/egypt-nid.json

# Image size, used by bench/measure.py.
RUN du -sm / --exclude=/proc --exclude=/sys 2>/dev/null | cut -f1 > /image-size-mb || true

# Keep BLAS single-threaded so timings are comparable between machines.
ENV OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1

# Fail the build early if the models are missing.
RUN test -d /models && echo "models present"

EXPOSE 8099

# Start the service by default. The same image can run bench/measure.py instead.
ENTRYPOINT ["python"]
CMD ["-m", "nidocr.service"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD python -c "import urllib.request,os;urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('OCR_PORT','8099')+'/health').read()" || exit 1

# Default target
FROM runtime AS default
