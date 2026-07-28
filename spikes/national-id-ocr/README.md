# National-ID OCR — Stage 1 technical spike

A fully local, offline OCR pipeline for Egyptian National ID cards, built to answer **one
question**:

> Is a fully local OCR solution good enough for Egyptian National IDs?

This is a spike, not production code. Nothing here is wired into the API:
`NationalIdOcrProvider` is untouched, `parseNationalId` is untouched, and the existing
registration workflow is unchanged. Stage 2 — a real provider behind that seam — happens only if
the numbers justify it.

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
| Decode the barcode | Excluded by explicit instruction. Not investigated, not implemented. |
| Decide anything | Every field carries a confidence band and goes to a human in the review dialog. |
| Read gender from the back | It is derived from the number. A second, weaker source for a deterministic value is a liability. |

---

## Running it

```bash
make fixtures   # regenerate the synthetic set
make check      # verify every field box lands on its text
make test       # 31 model-free unit tests (no weights, no network)
make build      # build the offline image — downloads and bakes the weights
make measure    # the deliverable: accuracy, timing, image size, CPU/memory, failures, verdict
```

`make test` and `make check` need only `numpy`, `opencv-python-headless`, `Pillow`, `pytest`.
`make build` and `make measure` need Docker and, for the build only, network access to PyPI and
the PaddleOCR model host.

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

* **All thresholds met on real fixtures** → proceed to Stage 2: a real provider behind
  `NationalIdOcrProvider`.
* **Below threshold** → evaluate a local vision-language model before considering any cloud OCR.
  The `Recognizer` protocol in `src/nidocr/engine.py` is the only thing that changes; preprocessing,
  geometry, post-processing, scoring and the harness all stay.

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
bench/            measure.py (the harness) + report.py (Markdown view of the JSON)
tools/            generate_synthetic.py, calibrate.py
tests/            31 model-free tests
```

`MockRecognizer` replays known text through the **real** preprocessing and geometry. That is what
lets the whole pipeline be tested and regression-guarded without weights — and it is why an
accuracy number from this harness can be trusted to be about recognition rather than about
plumbing.

---

## Status

Built and verified in a sandbox without access to the PaddleOCR model host, so:

* **Verified by execution** — synthetic fixture generation (Arabic shapes and joins correctly),
  the full preprocessing chain on degraded images, field-box geometry across all 8 fixtures, the
  post-processors, the scoring, the harness end to end, and 31 unit tests.
* **Not yet executed** — PaddleOCR recognition itself, the Docker build, and therefore the real
  accuracy / image-size numbers. Those require the model host and Docker Hub. Run `make build &&
  make measure` in a normal environment to produce them.
