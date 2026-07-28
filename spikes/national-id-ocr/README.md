# National-ID OCR — local, offline PaddleOCR provider

A fully local, offline OCR pipeline for Egyptian National ID cards, now **integrated with the
production seam**. It runs as a sidecar container carrying the PP-OCR weights; the API's
`PaddleNationalIdOcrProvider` calls it. No third-party service and no external API at runtime.

The pipeline began as a Stage-1 spike and is the implementation foundation for the provider. The
measurement harness stays, because the accuracy question is open until real anonymized cards have
been measured.

**What did NOT change, by design:** `parseNationalId` still owns every number-derived field, the
contracts in `packages/contracts` are untouched, the recruitment workflow is untouched, and the
review dialog and its confidence model are unchanged.

---

## What it does

```
capture → rectify → deskew → denoise → enhance → crop per field → recognize → post-process → band
```

* **Offline.** PP-OCR weights are baked into the image at build time. The runtime container makes
  no network calls; `docker-compose.yml` runs it with `network_mode: none` to prove it.
* **Field-based, not full-page.** The card has fixed geometry, so each field is cropped and
  recognized on its own. That improves accuracy, removes the guesswork of mapping a bag of strings
  back onto fields, and gives each field its own confidence — which is what `OcrFieldDto` needs.
* **Output matches the seam.** `extract()` returns the `RawOcrResult` shape from
  `apps/api/src/modules/hr/recruitment/applicants/national-id-ocr.ts`, field for field, so the
  production step is a thin call rather than a translation layer.

### What it deliberately does not do

| Not done | Why |
| --- | --- |
| Derive birth date / age / gender / governorate | `parseNationalId` owns these. They come from the number deterministically, in TypeScript, exactly once. |
| Decide anything | Every field carries a confidence band and goes to a human in the review dialog. |
| Read gender from the back | It is derived from the number. A second, weaker source for a deterministic value is a liability. |

---

## Running it

```bash
make fixtures   # regenerate the synthetic set
make check      # verify every field box lands on its text
make test       # 39 model-free unit tests (no weights, no network)
make build      # build the offline image — downloads and bakes the weights
make measure    # the deliverable: accuracy, timing, image size, CPU/memory, failures, verdict
```

`make serve` runs the sidecar. `make test` and `make check` need only `numpy`,
`opencv-python-headless`, `Pillow`, `pytest`. `make build` needs Docker and — for the build only —
network access to PyPI and the PaddleOCR model host; the resulting image needs neither.

---

## Wiring it to the API

```yaml
services:
  nid-ocr: { build: ./spikes/national-id-ocr, networks: [ecms] }
  api:
    environment:
      NATIONAL_ID_OCR_URL: http://nid-ocr:8099
```

`NATIONAL_ID_OCR_URL` is the whole switch. Unset — the default everywhere today — the API keeps the
null stub and `/hr/applicants/ocr/national-id` answers `available: false`, exactly as before. That
is what makes this safe to ship before the sidecar is deployed anywhere.

The provider reads the card images through the Files service **using the caller's own context**, so
OCR cannot widen who can see a card: a user who could not download the image cannot have it read on
their behalf. The sidecar holds no credentials and has no database access — it receives bytes and
returns text.

When the sidecar is unreachable, slow, or returns something malformed, the provider returns no
fields. The review dialog opens empty and the user types the card in. Recruitment never stops
because OCR is down.

---

## The evaluation process

This is the part that matters once real anonymized fixtures exist.

### 1. Prepare the fixtures

Follow `fixtures/README.md`. In short: keep the card photographically real, replace the person.
Same substrate, same wear, same glare, same angle — different name, different address, a
structurally valid but unissued ID number, photo masked. Ten cards weighted toward the messy cases
beat fifty clean scans.

Real cards are **never committed**. They are mounted read-only at run time.

### 2. Calibrate the field boxes — before measuring anything

```bash
make check FIXTURES=fixtures/real
python3 tools/calibrate.py --overlay real-001 --fixtures fixtures/real
```

The boxes in `src/nidocr/layout.py` are calibrated against the synthetic set and **will need
adjusting** for real cards. Do this first. A misplaced box returns an empty string, which in an
accuracy table is indistinguishable from "the model cannot read Arabic" — and the two have
completely different fixes. `--overlay` makes the adjustment a visual five-minute task.

### 3. Measure

```bash
make measure-real
```

Produces per-field accuracy (exact / normalized / mean CER / missing), per-stage timing, peak RSS,
CPU seconds per card, the image size, the worst reads with their ground truth, and a verdict.

### 4. Read the report honestly

* **`normalized` is the headline** for names, addresses and occupations — it applies the same
  Arabic fold the API already uses for search, so a hamza variant is not counted as an error a
  recruiter would care about.
* **`exact` is the headline for `nationalId`.** One wrong digit does not give you a slightly wrong
  ID; it gives you a different, valid-looking person.
* **`meanCer`** separates "one letter off" (a human fixes it in two seconds) from "unusable" (they
  retype the field). A field can have low exact-match and still be worth shipping if CER is small.
* **`missing`** counts empty reads. A spike in `missing` for one field almost always means a
  misplaced box, not a model failure — go back to step 2.

### 5. Apply the bar

`bench/measure.py` states thresholds up front so the verdict is mechanical rather than a judgement
made after seeing the numbers:

| Field | Threshold (normalized) | Why this bar |
| --- | ---: | --- |
| `nationalId` | 95% | Machine-validated downstream; a wrong digit is silently plausible. |
| `nationalIdExpiry` | 85% | Structured, short, high contrast — little excuse for error. |
| `religion`, `maritalStatus` | 85% | Tiny closed vocabulary; the post-processor can snap near-misses. |
| `fullNameAr` | 80% | Reviewed by a human against the card in front of them. |
| `address`, `occupation` | 70% | Longest and most variable; rough text still saves typing. |

The bar is deliberately not 100%. The review dialog means OCR does not need to be *right* — it
needs to be **faster than typing from scratch**, with honest confidence bands so the reviewer
knows where to look. `confidence` is what carries that, and a structural failure forces `low`
regardless of how sure the model claims to be.

### 6. Decide

* **All thresholds met on real fixtures** → the provider is production-ready; enable it by setting
  `NATIONAL_ID_OCR_URL` in the target environment.
* **Below threshold** → evaluate a local vision-language model before considering any cloud OCR.
  The `Recognizer` protocol in `src/nidocr/engine.py` is the only thing that changes; preprocessing,
  geometry, post-processing, scoring, the harness and the whole API-side integration all stay.

A run containing only synthetic fixtures reports **INCONCLUSIVE** by design, however good the
numbers look.

---

## Layout

```
src/nidocr/
  arabic.py       Arabic fold (mirrors the API's) + Indic→ASCII digits
  nid.py          structural ID validation — confidence banding ONLY, no derivation
  layout.py       normalized field boxes; the single source of card geometry
  preprocess.py   rectify / deskew / denoise / enhance / binarize, individually timed
  engine.py       Recognizer protocol; PaddleRecognizer (lazy import) + MockRecognizer
  postprocess.py  field-typed cleanup, vocabulary snapping, confidence bands
  extract.py      orchestration → RawOcrResult shape
  scoring.py      exact / normalized / CER
  service.py      the offline HTTP surface the API's provider calls
bench/            measure.py (the harness) + report.py (Markdown view of the JSON)
tools/            generate_synthetic.py, calibrate.py
tests/            39 model-free tests (pipeline + HTTP contract)
```

`MockRecognizer` replays known text through the **real** preprocessing and geometry. That is what
lets the whole pipeline be tested and regression-guarded without weights — and it is why an
accuracy number from this harness can be trusted to be about recognition rather than about
plumbing.

---

## Calibration workflow

Real card stock will not share the synthetic geometry, and re-calibrating must not mean rebuilding
the image — so geometry is data:

```bash
python3 tools/calibrate.py --overlay real-001 --fixtures fixtures/real   # see where boxes fall
make profile                                                             # → build/profile.json
# tune the JSON, then point the sidecar at it:
#   OCR_LAYOUT_PROFILE=/profiles/egypt-2026.json
```

A profile that fails to load raises at start rather than falling back silently — a service running
geometry the operator believes they replaced would produce empty reads that get blamed on the
model. `/health` reports the active profile, so what is live is always visible.

---

## Status

Built and verified in a sandbox with no access to the PaddleOCR model host or Docker Hub:

* **Verified by execution** — synthetic fixture generation (Arabic shapes and joins correctly), the
  preprocessing chain on degraded images, field-box geometry across all 8 fixtures, the
  post-processors, scoring, the harness end to end, the live HTTP contract the TypeScript provider
  consumes, 39 Python tests, and 15 TypeScript tests covering the provider mapping and every
  degradation path.
* **NOT executed** — PaddleOCR recognition itself, the Docker build, and therefore the real
  accuracy, latency and image-size numbers. Those need the model host, and no code change makes
  them reachable from here. Run `make build && make measure-real` in a normal environment.

Until `make measure-real` has run against real anonymized cards, the accuracy question is
**unanswered**. The integration is complete and testable; "good enough" is still unmeasured.
