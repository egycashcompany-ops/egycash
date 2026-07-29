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
capture → locate → dewarp → assess → deskew/denoise/enhance
        → detect lines → anchor boxes → crop per field → recognize → repair → reconcile → band
```

* **Offline.** PP-OCR weights are baked into the image at build time. The runtime container makes
  no network calls; `docker-compose.yml` runs it with `network_mode: none` to prove it.
* **Field-based, not full-page.** The card has fixed geometry, so each field is cropped and
  recognized on its own. That improves accuracy, removes the guesswork of mapping a bag of strings
  back onto fields, and gives each field its own confidence — which is what `OcrFieldDto` needs.
* **Output matches the seam.** `extract()` returns the `RawOcrResult` shape from
  `apps/api/src/modules/hr/recruitment/applicants/national-id-ocr.ts`, field for field, so the
  production step is a thin call rather than a translation layer.

### Why the pipeline grew

The first version handled one case well — a card that fills the frame, flat and square — and failed
in a way that looked random from outside: some cards read correctly, some came back as nonsense,
and nothing in the output said which had happened or why. Four things caused that, and each has a
stage now.

**The card was often never found.** One fixed-threshold edge pass looked for a convex quadrilateral
and, failing, resized the whole frame. For an already-cropped scan that fallback is correct. For a
photograph of a card lying on a desk it is catastrophic — every field box lands on background — and
both went down the same silent code path. `geometry.py` now runs four detectors (edges, brightness
in both polarities, gradient, texture), scores their candidates against the ID-1 aspect ratio, and
reports which one won or that none did. It also distinguishes *precropped* (the frame is itself
card-shaped, nothing to find, all is well) from *frame* (a card was in there and we missed it).

**A bent card is not a plane.** A homography maps a plane to a plane, so a card that bowed in
someone's wallet stays bowed: its text lines curve, the boxes drift toward the middle, and the
recognizer is handed curved baselines. `dewarp` traces where the card's top and bottom edges really
run and remaps each column onto the canonical height. Flat cards skip it — resampling costs
sharpness and buys nothing.

**Nothing said when a capture was hopeless.** A 200 px-wide photo still produces fourteen confident
digits; they are simply not the right fourteen, and a reviewer does not re-derive a plausible number
from a blurred photograph. `quality.py` measures the card's real resolution, sharpness, glare and
contrast, and returns reason codes — `too_small`, `blurred`, `glare` — that let the UI say what to
change. It does not skip the read: fields still come back, capped at `low`, because some survive a
poor capture and the thresholds are still untuned priors.

**The geometry was calibrated from one card.** Print tolerance varies, rectification is good rather
than exact, and Egypt has issued more than one layout — 2007-era cards are still in circulation.
`anchor.py` uses the profile as a prior and snaps each box onto the text detection actually found
near it, then overrides that entirely for the two fields whose content identifies them: a line of
exactly fourteen digits is the national ID wherever it is printed, and a full year/month/day is the
expiry.

**A field crop is never detected inside.** Handing a located crop to a full OCR pipeline runs text
detection on it again, and detection returns the words it is *confident about* — so a word it is
not confident about is simply absent, and the field arrives missing a word from the middle of a
line with everything around it correct, correctly read and correctly ordered. Nothing downstream
can see that: no low score, no gap in the string, no structural check. A card printing a six-part
name came back with three, and the missing three were the first, the third and the last — a pattern
no crop can produce. Detection is the wrong tool at that point anyway: its job is finding text on a
page, and the field box has already done that. `preprocess.split_text_lines` cuts the crop into
printed lines from its ink profile, and the recognition model reads each strip whole, so every
glyph on the line reaches it with no per-word threshold anywhere in the path. Nothing re-orders
anything either — one strip is one line, emitted by the model in logical order — which removes the
last place RTL handling could drop or resequence part of a name.

**Snapping tightens vertically and never horizontally**, and the asymmetry is load-bearing. Fields
are stacked a line apart, so a crop that spans too many rows picks up its neighbour's text —
vertical tightening is the whole point. Nothing is printed *beside* the name, the address or the
number, so horizontal tightening excludes no neighbour and costs something real: any part of the
line **detection itself missed**. A short word at the end of a right-aligned line is exactly what a
detector drops, and snapping used to rewrite the generous nominal box into one that stopped where
detection stopped — putting the word outside the pixels recognition was given, where no amount of
re-reading could reach it. The horizontal extent is now the union with the nominal box: anchoring
may move a crop and may grow one, but it may not trim one.

**The front text boxes are deliberately generous, and the card's own words are removed by content.**
A box drawn tightly around one card's name is drawn tightly around *that* card's name: the next
card's given name sat above the box's top edge and the last word of its family chain ran past its
left edge, so the field came back missing a word at each end with every word it did return correct.
The two errors are not worth the same — text the box lets in is removable, because everything
printed around these fields is the card's own furniture and identical on every card ever issued,
while text the box cuts off is gone and nothing downstream can tell. So the boxes span the printed
text column and `boilerplate.py` strips the furniture by phrase, matching whole token sequences on
the rasm-folded text so that a district like `مصر الجديدة` can never be confused with the
`جمهورية مصر العربية` printed across the top.

### The national ID gets five independent checks

It is the field where a single wrong digit is most expensive — it does not give a slightly wrong
answer, it gives a different, valid-looking person — so it is the field with the most corroboration.

| Check | Reaches | What it does |
| --- | --- | --- |
| Read ensemble | all 14 | The crop is read under several preprocessing variants chosen to **fail differently** — adaptive threshold, greyscale, Otsu, CLAHE, inverted. Identical readings corroborate each other; disagreeing ones are voted position by position. Reading stops as soon as three agree on a valid number, so an ordinary card pays for three reads and only a contested one pays for five. |
| Structural repair | digits 1-9 | Century, calendar date and governorate constrain these. A read that cannot be a national ID is searched outward by edit distance over known Indic confusions; a **unique** valid result at the nearest distance is accepted at `medium`, a tie is refused as ambiguous. |
| Both sides | all 14 | The number is printed on the front AND the back. Two crops sharing no pixels have independent errors, so agreement is stronger evidence than any model score → `high`. Two different valid numbers → `low`. |
| Gender parity | digit 13 | The parity digit is otherwise unconstrained. The back states the same fact in words, and words and digits do not fail the same way. Disagreement demotes the number — it never populates a field, because `parseNationalId` owns gender. |
| Length | — | 13 or 15 digits is refused rather than guessed, except where the extra digit is a repeat — an insertion leaves one behind, and removing it is unique where blind deletion is not. |

**Why the ensemble is not redundant with validation.** A card came back as `…203408` where it
printed `…202408`: one digit, inside the sequence. *Both strings are valid national IDs* — same
century, same birth date, same governorate — so `is_structurally_valid` accepts each and
`parseNationalId` decodes each into a consistent person. Validation cannot separate them and no
amount of tightening it will, because the information that would is not in the number. It is in the
pixels, and the only way to use it is to look at them more than once.

Digits 10-12 are reachable by no *structural* check, and the repair search deliberately never edits
them: there, "repair" could only turn one valid-looking identity into another. The ensemble and the
both-sides comparison are the only two things that reach them, which is why both exist.

Confidence follows the evidence: a number several variants read identically keeps the model's own
band; one assembled position-by-position out of reads that disagreed is capped at `medium`, because
assembling is a deduction; and if no variant and no combination of them yields a valid number, the
field is `low` and the best-effort string still goes to the reviewer rather than being dropped.

### Arabic is matched by letter skeleton, not by string

Dots are the smallest marks on the card and the first thing a reflection or a JPEG artefact
destroys. A recognizer that reads مسلمه for مسلمة got the shape exactly right and one dot wrong, and
plain comparison scores that as a miss — so the reviewer retypes a field the model effectively got
right. `arabic.rasm_fold` folds ب ت ث ن ي onto one skeleton, ج ح خ onto another, and so on, which
ignores exactly the information that was lost.

It is used only against closed vocabularies, because it deliberately conflates distinct words.
`ة` folds onto `ه` rather than being dropped, so مسلم and مسلمة stay apart — the masculine/feminine
distinction is the meaning, not the noise. `governorates.py` applies the same idea to the address's
last token, and refuses approximate matching for البحيرة and الجيزة, which are one edit apart after
folding and three hundred kilometres apart in fact.

The governorate list is **not** cross-checked against the number. Digits 8-9 encode the governorate
of birth *registration*; the address is *residence*. Those disagree for a large share of the
population, so the check would fire constantly on correct reads.

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

### Seeing where a card actually went wrong

```bash
curl -s -X POST https://<service>/trace \
  -H 'content-type: application/json' \
  -d "{\"frontImageBase64\":\"$(base64 -w0 front.jpg)\",\"backImageBase64\":\"$(base64 -w0 back.jpg)\"}" \
  > trace.html && open trace.html
```

`POST /trace` takes the same body as `/extract` and returns **one self-contained HTML page** with
every intermediate the pipeline produced, in order: the original image, the rectified card, the
quality metrics, the detected lines, the anchored boxes drawn on the card, and then per field — the
crop, the preprocessed variants, each line strip handed to the recognizer, the **raw text that came
back before any post-processing**, the ensemble's per-variant readings and vote, and the final
value. Locally: `python -m nidocr.trace --front a.jpg --back b.jpg --out trace.html`.

It runs the real `extract()` with a collector attached rather than a re-implementation of it, so
what the page shows is what production did.

This is the tool for the question that repeatedly could not be answered from a final string: **if
the raw read already misses a word, the recognizer is the problem; if the raw read is complete and
the final value is not, the processing is.** Those have opposite fixes and look identical from
outside.

> ⚠️ **The trace contains the whole card** — photograph, name, address, number. Unlike `/diagnose`,
> which is coordinates-only and safe to paste anywhere, this is for a card whose holder has
> consented, and should not be attached to an issue or a chat. `OCR_TRACE_DISABLED=1` turns the
> endpoint off.

---

## Wiring it to the API

```yaml
services:
  nid-ocr: { build: ./spikes/national-id-ocr, networks: [ecms] }
  api:
    environment:
      NATIONAL_ID_OCR_URL: http://nid-ocr:8099
```

`/extract` returns two additional keys alongside `fields`, both additive — a caller that ignores
them behaves exactly as before:

* **`quality`** — per side, the verdict (`ok` / `degraded` / `reject`), the reason codes, and the
  raw metrics. This is the actionable half: it is what lets the UI say "move closer" instead of
  "could not read the card", which is the difference between a good second attempt and the same bad
  photograph taken twice.
* **`diagnostics`** — which detector located the card, whether it was dewarped or read upside down,
  how many text lines detection found (`linesDetected`, plus `detectionFailed` when it raised) and
  how many boxes had to be moved onto the text. It answers "why was this read poor?" without
  anyone having to send someone's identity document to a developer. Counts and method names only;
  like `/diagnose`, it carries no card content.

  `linesDetected: 0` with every box reported as `nominal` is the one distinction worth knowing by
  heart: it means the card was read purely on profile geometry, so a misplaced field is a geometry
  problem. Lines found and boxes `snapped`, with a field still wrong, means the opposite. The two
  look identical in the output, and telling them apart from a screenshot is impossible.

The quality thresholds are reasoned priors, not measurements, and every one is settable —
`OCR_QUALITY_MIN_CARD_WIDTH`, `OCR_QUALITY_MIN_SHARPNESS`, `OCR_QUALITY_MAX_GLARE`,
`OCR_QUALITY_MIN_CONTRAST`, and their `GOOD_` counterparts — so the first person to run this against
real cards can tune the gate without a rebuild.

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
  arabic.py       Arabic fold (mirrors the API's) + Indic→ASCII digits + rasm fold
  governorates.py Arabic governorate names — address repair only, never an ID cross-check
  nid.py          structural validation + confusion-aware repair + gender parity check
  layout.py       normalized field boxes; the nominal card geometry
  geometry.py     locating the card in a photograph, and flattening it (incl. curl dewarp)
  quality.py      is this capture readable? reason codes + the confidence ceiling
  anchor.py       moving the boxes onto the text detection actually found
  boilerplate.py  the words printed on every card, which belong to nobody
  ensemble.py     combining several readings of the number into one answer
  trace.py        every intermediate the pipeline produces, as one HTML page
  preprocess.py   deskew / denoise / enhance / sharpen / binarize, individually timed
  engine.py       Recognizer protocol; PaddleRecognizer (lazy import) + MockRecognizer
  postprocess.py  field-typed cleanup, vocabulary snapping, confidence bands
  extract.py      orchestration → RawOcrResult shape
  scoring.py      exact / normalized / CER
  service.py      the offline HTTP surface the API's provider calls
bench/            measure.py (the harness) + report.py (Markdown view of the JSON)
tools/            generate_synthetic.py, calibrate.py
tests/            150 model-free tests; scenes.py composes cards into photographed scenes
```

`tests/scenes.py` is worth knowing about. The synthetic fixtures are pictures *of* a card — the one
case that always worked. `scenes.py` pastes a card into a photographed scene at a known
quadrilateral, on sand, wood, a dark desk or a pale one, at an angle, bent, with a shadow. Because
the corners are known, the localizer's answer is checked against where the card actually is rather
than eyeballed, which is the difference between "detection returned something" and "detection
returned the card".

`MockRecognizer` replays known text through the **real** preprocessing and geometry. That is what
lets the whole pipeline be tested and regression-guarded without weights — and it is why an
accuracy number from this harness can be trusted to be about recognition rather than about
plumbing.

---

## Calibration workflow

Real card stock will not share the synthetic geometry, and re-calibrating must not mean rebuilding
the image — so geometry is data:

The container already starts with `profiles/egypt-nid.json` — geometry measured from a real card —
because the built-in boxes in `layout.py` come from the synthetic fixtures and sit too high on real
stock: the name box catches the `بطاقة تحقيق الشخصية` header and the address box reaches into the
second name line. Those defaults remain the LIBRARY default, since `make check` and the fixture
harness are built around them; the image overrides them, because the image only ever sees real cards.

To calibrate your own:

```bash
python3 tools/calibrate.py --overlay real-001 --fixtures fixtures/real   # see where boxes fall
make profile                                                             # → build/profile.json
# mount it and point the sidecar at the path you mounted it to:
#   OCR_LAYOUT_PROFILE=/profiles/egypt-2027.json
```

A profile that fails to load raises at start rather than falling back silently — a service running
geometry the operator believes they replaced would produce empty reads that get blamed on the
model. `/health` reports the active profile, so what is live is always visible.

---

## Status

Built and verified in a sandbox with no access to the PaddleOCR model host or Docker Hub:

* **Verified by execution** — synthetic fixture generation (Arabic shapes and joins correctly),
  card localization against composed scenes on four surfaces at five angles including a bent card,
  the curl dewarp, the quality gate's verdicts and reason codes, national-ID repair and its
  refusals, rasm folding and governorate snapping, box anchoring, both-sides reconciliation, the
  full preprocessing chain on degraded images, field geometry across all 8 fixtures, scoring, the
  harness end to end, the live HTTP contract the TypeScript provider consumes — **150 Python
  tests**, plus the 15 TypeScript tests covering the provider mapping and every degradation path.
* **NOT executed** — PaddleOCR recognition itself, the Docker build, and therefore the real
  accuracy, latency and image-size numbers. Those need the model host, and no code change makes
  them reachable from here. Run `make build && make measure-real` in a normal environment.

Two known limits, stated rather than buried:

* A card that is **both curled and lying on a near-contrastless pale surface** can still be located
  badly — the texture detector wins with a poor quadrilateral. It fails safe: the quality gate
  rejects the result rather than passing wrong fields on. Worth revisiting with real captures.
* Every threshold in `quality.py` and every weight in `nid.DIGIT_CONFUSIONS` is a prior derived from
  the card's print geometry and the shapes of the numerals — **not** fitted to a corpus. They are
  structured to be replaced: the thresholds are environment-settable, and the confusion weights only
  affect search order, never which answer is accepted.

Until `make measure-real` has run against real anonymized cards, the accuracy question is
**unanswered**. The pipeline is complete and testable; "good enough" is still unmeasured.
