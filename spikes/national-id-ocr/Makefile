# Spike entry points. `make measure` is the deliverable — everything else supports it.
IMAGE ?= ecms/nid-ocr-spike:latest
FIXTURES ?= fixtures/synthetic

.PHONY: help fixtures check test build build-vl build-qwen compare serve ui measure measure-real profile shell clean

help:
	@grep -E '^[a-z-]+:.*?##' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-14s %s\n", $$1, $$2}'

fixtures: ## Regenerate the synthetic fixture set + manifest
	python3 tools/generate_synthetic.py --count 8

check: ## Verify every field box lands on its text (catches box drift, not bad OCR)
	python3 tools/calibrate.py --check --fixtures $(FIXTURES)

test: ## Model-free unit tests — run anywhere, no weights, no network
	python3 -m pytest tests -q

build: ## Build the offline image (downloads + bakes the PP-OCR weights)
	docker build --target runtime -t $(IMAGE) .
	@echo "image size:"; docker images --format '{{.Size}}' $(IMAGE)

serve: ## Run the sidecar — what the API provider talks to
	docker run --rm -p 127.0.0.1:8099:8099 $(IMAGE)

ui: ## Local test page on http://127.0.0.1:8098 (front photo, back photo, extracted form); needs `make serve`
	python3 tools/test_ui.py

profile: ## Emit the active field geometry as a calibration profile
	python3 tools/calibrate.py --emit-profile build/profile.json

# Both measurement runs are offline (`--network none`), which is what proves the weights are baked.
#
# The synthetic run clears OCR_LAYOUT_PROFILE. The image defaults it to the real-card profile, but
# the synthetic cards are drawn with the LIBRARY geometry — measuring them through the real-card
# boxes put the name box on the header and the expiry box on the religion row, and reported that
# geometry mismatch as recognition error. Real cards keep the image's profile.
measure: ## Run the full measurement inside the image, against the synthetic set
	docker run --rm --network none -e OCR_LAYOUT_PROFILE= \
	  -e OCR_IMAGE_SIZE_MB="$$(docker image inspect $(IMAGE) --format '{{.Size}}' | awk '{printf "%.0f", $$1/1048576}')" \
	  $(IMAGE) bench/measure.py --fixtures fixtures/synthetic --recognizer paddle

measure-real: ## Same, against real anonymized fixtures mounted from the host (never committed)
	docker run --rm --network none -v $(PWD)/fixtures/real:/app/fixtures/real:ro \
	  -e OCR_IMAGE_SIZE_MB="$$(docker image inspect $(IMAGE) --format '{{.Size}}' | awk '{printf "%.0f", $$1/1048576}')" \
	  $(IMAGE) bench/measure.py --fixtures fixtures/real --recognizer paddle

# ── Step 2: vision-language readers ──────────────────────────────────────────
# Each VLM is its own image (see the Dockerfile targets), so the PaddleOCR-only image above is
# unchanged. Every measurement is offline and uses the same synthetic geometry as `make measure`.
IMAGE_VL ?= ecms/nid-ocr-spike:paddleocr-vl
IMAGE_QWEN ?= ecms/nid-ocr-spike:qwen
size_mb = $$(docker image inspect $(1) --format '{{.Size}}' | awk '{printf "%.0f", $$1/1048576}')

build-vl: ## Build the PaddleOCR-VL-1.6 image (downloads ~2 GB of weights + CPU torch)
	docker build --target paddleocr-vl -t $(IMAGE_VL) .

build-qwen: ## Build the Qwen3.5-4B image (downloads ~3.4 GB of GGUF weights)
	docker build --target qwen -t $(IMAGE_QWEN) .

compare: ## Measure all three configurations offline and print ONE comparison table
	mkdir -p build
	docker run --rm --network none -e OCR_LAYOUT_PROFILE= -v $(PWD)/build:/out \
	  -e OCR_IMAGE_SIZE_MB="$(call size_mb,$(IMAGE))" $(IMAGE) \
	  bench/measure.py --fixtures fixtures/synthetic --recognizer paddle --json-out /out/measure-paddle.json
	docker run --rm --network none -e OCR_LAYOUT_PROFILE= -v $(PWD)/build:/out \
	  -e OCR_IMAGE_SIZE_MB="$(call size_mb,$(IMAGE_VL))" $(IMAGE_VL) \
	  bench/measure.py --fixtures fixtures/synthetic --recognizer paddleocr_vl --json-out /out/measure-paddleocr_vl.json
	docker run --rm --network none -e OCR_LAYOUT_PROFILE= -v $(PWD)/build:/out \
	  -e OCR_IMAGE_SIZE_MB="$(call size_mb,$(IMAGE_QWEN))" $(IMAGE_QWEN) \
	  bench/measure.py --fixtures fixtures/synthetic --recognizer qwen --json-out /out/measure-qwen.json
	python3 bench/compare.py build/measure-paddle.json build/measure-paddleocr_vl.json \
	  build/measure-qwen.json | tee build/comparison.md

shell: ## Interactive shell in the image (debugging a bad read)
	docker run --rm -it --entrypoint /bin/bash $(IMAGE)

clean:
	rm -rf build fixtures/synthetic/*.jpg fixtures/synthetic/manifest.json
