# Spike entry points. `make measure` is the deliverable — everything else supports it.
IMAGE ?= ecms/nid-ocr-spike:latest
FIXTURES ?= fixtures/synthetic

.PHONY: help fixtures check test build serve measure measure-real profile shell clean

help:
	@grep -E '^[a-z-]+:.*?##' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-14s %s\n", $$1, $$2}'

fixtures: ## Regenerate the synthetic fixture set + manifest
	python3 tools/generate_synthetic.py --count 8

check: ## Verify every field box lands on its text (catches box drift, not bad OCR)
	python3 tools/calibrate.py --check --fixtures $(FIXTURES)

test: ## Model-free unit tests — run anywhere, no weights, no network
	python3 -m pytest tests -q

build: ## Build the offline image (downloads + bakes the PP-OCR weights)
	docker build -t $(IMAGE) .
	@echo "image size:"; docker images --format '{{.Size}}' $(IMAGE)

serve: ## Run the sidecar — what the API provider talks to
	docker run --rm -p 127.0.0.1:8099:8099 $(IMAGE)

profile: ## Emit the active field geometry as a calibration profile
	python3 tools/calibrate.py --emit-profile build/profile.json

measure: ## Run the full measurement inside the image, against the synthetic set
	docker run --rm \
	  -e OCR_IMAGE_SIZE_MB="$$(docker image inspect $(IMAGE) --format '{{.Size}}' | awk '{printf "%.0f", $$1/1048576}')" \
	  $(IMAGE) bench/measure.py --fixtures fixtures/synthetic --recognizer paddle

measure-real: ## Same, against real anonymized fixtures mounted from the host (never committed)
	docker run --rm -v $(PWD)/fixtures/real:/app/fixtures/real:ro \
	  -e OCR_IMAGE_SIZE_MB="$$(docker image inspect $(IMAGE) --format '{{.Size}}' | awk '{printf "%.0f", $$1/1048576}')" \
	  $(IMAGE) bench/measure.py --fixtures fixtures/real --recognizer paddle

shell: ## Interactive shell in the image (debugging a bad read)
	docker run --rm -it --entrypoint /bin/bash $(IMAGE)

clean:
	rm -rf build fixtures/synthetic/*.jpg fixtures/synthetic/manifest.json
