"""Orchestration: two card images in, one `RawOcrResult`-shaped dict out.

The output shape is not incidental — it is deliberately the `RawOcrResult` interface from
`apps/api/src/modules/hr/recruitment/applicants/national-id-ocr.ts`, field for field. That is what
keeps the production step small: the provider is an HTTP call to this pipeline and a direct
hand-off, with no translation layer to get wrong.

Two things this module refuses to do, both on purpose:

* It never derives birth date, gender or governorate. Those come from `parseNationalId` in
  TypeScript. The seam's own header says so, and a second implementation would be a second source
  of truth for a value that must be identical everywhere. The gender word printed on the back is
  read here for exactly one purpose — checking the number against itself — and is never returned.
* It never decides. Every field carries a confidence band and goes to a human in the review
  dialog. Nothing here is authoritative.

The per-side sequence is: prepare (rectify, dewarp, assess) → detect lines once → anchor the boxes
onto them → crop and recognize each field. The single page-level detection pass is what pays for
anchoring, and it is worth its latency: without it every field depends on the profile geometry
being right for this particular card, which is the assumption real cards break most often.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field as _field
from typing import Any

import cv2
import numpy as np

from .anchor import Anchoring, Line, anchor, structural
from .arabic import rasm_fold
from .engine import MockRecognizer, Recognizer
from .geometry import Rectification
from .layout import BACK_FIELDS, FRONT_FIELDS, FieldBox
from .nid import Repair, gender_agrees, salvage_digits
from .preprocess import StageTimings, load_bgr, prepare, prepare_field
from .postprocess import (
    band,
    cap,
    clean_address,
    clean_expiry,
    clean_marital_status,
    clean_national_id,
    clean_religion,
    clean_text,
)
from .quality import QualityReport

LOG = logging.getLogger("nidocr.extract")


@dataclass
class SideResult:
    """Everything one face of the card produced, including why it produced it."""

    fields: dict[str, dict[str, Any]] = _field(default_factory=dict)
    quality: QualityReport | None = None
    rectification: Rectification | None = None
    anchoring: Anchoring | None = None
    lines: list[Line] = _field(default_factory=list)

    def filled(self) -> int:
        return sum(1 for data in self.fields.values() if data.get("value"))

    def mean_score(self) -> float:
        scores = [data.get("score", 0.0) for data in self.fields.values() if data.get("value")]
        return float(np.mean(scores)) if scores else 0.0


@dataclass
class ExtractionResult:
    """Everything the harness needs: the values, plus how long each part took."""

    fields: dict[str, dict[str, Any]] = _field(default_factory=dict)
    timings: StageTimings = _field(default_factory=StageTimings)
    total_ms: float = 0.0
    #: Per-side capture assessment. The caller surfaces this so a user who submitted an unreadable
    #: photo is told what to change instead of being handed a plausible wrong number.
    quality: dict[str, QualityReport] = _field(default_factory=dict)
    #: Per-side notes on how the read was obtained — rectification method, where the boxes came
    #: from, whether a side was retried upside down. Diagnostic only; carries no card content.
    diagnostics: dict[str, Any] = _field(default_factory=dict)

    def as_raw_ocr_result(self) -> dict[str, dict[str, str]]:
        """The `RawOcrResult` payload — only fields that produced a value."""
        return {
            name: {"value": data["value"], "confidence": data["confidence"]}
            for name, data in self.fields.items()
            if data["value"]
        }

    def readable(self) -> bool:
        """False only when every supplied side was refused by the quality gate."""
        return not self.quality or any(report.readable for report in self.quality.values())


def _recognize_box(card: np.ndarray, box: FieldBox, recognizer: Recognizer) -> tuple[str, float]:
    left, top, right, bottom = box.to_pixels((card.shape[1], card.shape[0]))
    if right <= left or bottom <= top:
        return "", 0.0
    region = card[top:bottom, left:right]
    # The mock replays by field name; real recognizers only ever see pixels.
    if isinstance(recognizer, MockRecognizer):
        recognizer.bind(box.name)

    # The national ID and the expiry are numbers: their spaced groups read left to right even
    # on an otherwise right-to-left card. Ordering them as Arabic would reverse the value
    # while keeping every digit correct — a failure that looks entirely plausible.
    rtl = box.kind != "digits"
    if box.kind != "digits":
        return _read(recognizer, prepare_field(region, box.kind), rtl)

    # Digits get read twice, thresholded and not, and the better read wins.
    #
    # Binarizing digit crops was a reasonable default derived from synthetic fixtures, where the
    # number sits on clean card stock. On a real Egyptian ID it is printed over the pyramid
    # watermark, and adaptive thresholding fragments the glyphs against it — which is how a
    # 14-digit number came back as four digits. But the opposite is true on a clean scan, where
    # thresholding genuinely sharpens the row.
    #
    # Rather than pick one and be wrong for half the inputs, run both and choose by the property
    # that actually matters: how many digits survived. A digit field has a known shape, so "more
    # digits recovered" is a real quality signal rather than a heuristic, and confidence only
    # breaks ties.
    candidates = [
        _read(recognizer, prepare_field(region, "digits"), rtl),
        _read(recognizer, prepare_field(region, "text"), rtl),
    ]
    return max(candidates, key=lambda out: (len(salvage_digits(out[0])), out[1]))


def _read(recognizer: Recognizer, crop: np.ndarray, rtl: bool) -> tuple[str, float]:
    out = recognizer.recognize(crop, rtl=rtl)
    return out.text, out.score


def _finalize(name: str, raw: str, score: float) -> dict[str, Any]:
    """Apply the field's cleanup and decide its confidence band."""
    if name == "nationalId":
        fixed: Repair = clean_national_id(raw)
        return {
            "value": fixed.value,
            # A repair is a deduction from structure, not the model having read the digits, so it
            # can rescue a field but must never present it as certainly read. Ambiguity floors the
            # band outright: several different people's numbers were equally close to this read.
            "confidence": "low"
            if (fixed.ambiguous or not fixed.valid)
            else cap(band(score), "medium")
            if fixed.repaired
            else band(score),
            "raw": raw,
            "score": score,
            "repaired": fixed.repaired,
            "ambiguous": fixed.ambiguous,
            "valid": fixed.valid,
        }
    if name == "nationalIdExpiry":
        value, parsed = clean_expiry(raw)
        return {
            "value": value,
            "confidence": band(score, structurally_valid=parsed),
            "raw": raw,
            "score": score,
        }
    if name == "religion":
        value, snapped = clean_religion(raw)
        # A snap is corroboration, not proof — it can lift a borderline read to 'medium' but
        # never to 'high', which stays reserved for the model being confident on its own.
        return {
            "value": value,
            "confidence": band(max(score, 0.75) if snapped else score),
            "raw": raw,
            "score": score,
        }
    if name == "maritalStatus":
        value, snapped = clean_marital_status(raw)
        return {
            "value": value,
            "confidence": band(max(score, 0.75) if snapped else score),
            "raw": raw,
            "score": score,
        }
    if name == "address":
        value, snapped = clean_address(raw)
        return {
            "value": value,
            "confidence": band(max(score, 0.75) if snapped else score),
            "raw": raw,
            "score": score,
        }
    return {"value": clean_text(raw), "confidence": band(score), "raw": raw, "score": score}


#: Fields the back carries but has no nominal box for. The national ID is printed on BOTH sides of
#: an Egyptian card, and reading it twice is the cheapest accuracy this pipeline can buy: two
#: independent looks at the one field where a single wrong digit yields a different, valid-looking
#: person. It has no box because its position on the back varies more than the front's, so it is
#: found structurally — by being the only fourteen-digit line — rather than geometrically.
_BACK_STRUCTURAL_EXTRA = ("nationalId",)


def _side_boxes(side: str) -> tuple[FieldBox, ...]:
    return FRONT_FIELDS if side == "front" else BACK_FIELDS


def _detect_lines(card: np.ndarray, recognizer: Recognizer, side: str) -> list[Line]:
    """Full-page detection, downgraded to 'no lines' if it fails rather than losing the card.

    Detection feeds anchoring, and anchoring is an IMPROVEMENT on the nominal geometry — without it
    the boxes simply stay where the profile put them, which is where they were before anchoring
    existed. So a detection failure should cost the correction, not the read.

    It was costing the read. The exception propagated out of `extract`, the service caught it at the
    top and returned 500, and a card that would have yielded six perfectly good fields yielded
    nothing. Recognition failures are already tolerated field-by-field for exactly this reason;
    detection was the one call that could still take the whole request down with it.

    The exception is logged rather than swallowed silently — a run where every card loses its
    anchoring is a real problem, just not one that should reach the user as a failed scan.
    """
    try:
        return list(recognizer.detect_lines(card))
    except Exception:  # noqa: BLE001 — the recognizer is native code; anything can come out of it
        LOG.warning("%s: line detection failed; falling back to nominal boxes", side, exc_info=True)
        return []


def _process_side(
    image: np.ndarray, side: str, recognizer: Recognizer, timings: StageTimings
) -> SideResult:
    """Prepare one face, anchor its boxes to the text found on it, and read every field."""
    prepared = prepare(image, timings, side=side)
    result = SideResult(quality=prepared.quality, rectification=prepared.rectification)
    boxes = _side_boxes(side)
    size = (prepared.image.shape[1], prepared.image.shape[0])

    started = time.perf_counter()
    result.lines = _detect_lines(prepared.image, recognizer, side)
    timings.record(f"{side}:detect", started)

    wanted = {box.name for box in boxes} | set(_BACK_STRUCTURAL_EXTRA if side == "back" else ())
    result.anchoring = anchor(boxes, result.lines, size)
    if side == "back":
        for name, box in structural(result.lines, size, wanted=wanted).items():
            result.anchoring.boxes.setdefault(name, box)
            result.anchoring.sources.setdefault(name, "structural")

    ceiling = prepared.quality.confidence_ceiling
    for name, box in result.anchoring.boxes.items():
        started = time.perf_counter()
        raw, score = _recognize_box(prepared.image, box, recognizer)
        timings.record(f"recognize:{side}:{name}", started)
        data = _finalize(name, raw, score)
        # The capture's own quality bounds every field it produced. A model score describes how
        # cleanly the recognizer read what it was given; it says nothing about whether the pixels
        # carried the information. On a blurred crop those come apart badly — fewer competing
        # hypotheses can make recognition MORE confident, not less — so the capture gets the
        # final word, and only ever downward.
        data["confidence"] = cap(data["confidence"], ceiling)
        result.fields[name] = data

    return result


def _printed_gender(lines: list[Line]) -> str | None:
    """The sex word printed on the back, read ONLY to check the number's parity digit.

    Taken from the detected lines rather than from a field box, because there is deliberately no
    gender field: `parseNationalId` owns gender, and adding a box would invite something downstream
    to start populating from it. Nothing returned from here reaches the output.
    """
    targets = {rasm_fold(word) for word in ("ذكر", "أنثى")}
    for _, text, _ in lines:
        for token in text.split():
            if rasm_fold(token) in targets:
                return token
    return None


#: Words that appear on the back of an Egyptian card and nowhere on the front. Rasm-folded, so a
#: dropped dot does not turn a present marker into a missing one.
_BACK_MARKERS = frozenset(
    rasm_fold(word)
    for word in ("ذكر", "أنثى", "مسلم", "مسلمة", "مسيحي", "مسيحية", "أعزب", "عزباء", "متزوج",
                 "متزوجة", "مطلق", "مطلقة", "أرمل", "أرملة", "سارية", "الرقم")
)


def _looks_like_the_back(lines: list[Line]) -> bool | None:
    """Does this image carry any of the words only the back of the card has? None if unreadable.

    The commonest mistake anyone makes with a two-sided capture is photographing the same side
    twice, and the pipeline's response to that is uniquely unhelpful: the back's field boxes are
    applied to a front image, so they land on whatever happens to sit at those coordinates and
    return confident fragments of the address as a religion. Nothing about that reads as "wrong
    image" — it reads as bad OCR, and the next hour goes into the recognizer.

    The back states sex, religion and marital status in words drawn from a tiny closed vocabulary.
    If a whole side yielded text and none of those words is anywhere in it, the image is almost
    certainly not a back. Reported, never acted on: the fields are still returned and the reviewer
    still decides. A wrong guess here would suppress a legitimately odd card.
    """
    if not lines:
        return None
    folded = " ".join(rasm_fold(text) for _, text, _ in lines)
    if not folded.strip():
        return None
    return any(marker in folded for marker in _BACK_MARKERS)


def _rotate_180(image: np.ndarray) -> np.ndarray:
    return cv2.rotate(image, cv2.ROTATE_180)


def _needs_retry(side: str, result: SideResult) -> bool:
    """Should this face be tried upside down?

    Geometry cannot tell a card from the same card rotated 180 degrees — the quadrilateral is
    identical — so orientation is settled the same way this pipeline settles every other ambiguity:
    try both and keep the better result. The trigger has to be cheap and reliable, and "the fields
    came back empty" is both: an inverted card puts every box on the wrong text, so it fails
    wholesale rather than subtly.
    """
    expected = len(_side_boxes(side))
    if result.filled() * 2 < expected:
        return True
    return side == "front" and not result.fields.get("nationalId", {}).get("valid", False)


def _better(first: SideResult, second: SideResult) -> SideResult:
    """Pick between an upright and an inverted read. More fields wins; confidence breaks ties."""
    first_valid = first.fields.get("nationalId", {}).get("valid", False)
    second_valid = second.fields.get("nationalId", {}).get("valid", False)
    if first_valid != second_valid:
        return first if first_valid else second
    if first.filled() != second.filled():
        return first if first.filled() > second.filled() else second
    return first if first.mean_score() >= second.mean_score() else second


def _reconcile_national_id(sides: dict[str, SideResult]) -> dict[str, Any] | None:
    """Combine the number read from the front with the one read from the back.

    Agreement between two independent reads is the strongest evidence available anywhere in this
    pipeline — far stronger than either model score, because the two crops share no pixels and
    their errors are uncorrelated. Disagreement is equally informative and is handled by refusing
    to choose: the structurally valid one is preferred only when the other is not valid at all, and
    two valid but different numbers drop to `low` so the reviewer resolves it against the card.
    """
    readings = {
        side: result.fields["nationalId"]
        for side, result in sides.items()
        if result.fields.get("nationalId", {}).get("value")
    }
    if not readings:
        return None
    if len(readings) == 1:
        return next(iter(readings.values()))

    front, back = readings.get("front"), readings.get("back")
    if front["value"] == back["value"]:
        agreed = dict(front)
        # Two independent reads landing on the same fourteen digits is worth more than either
        # score, but not more than a structural failure — a number that cannot be a national ID is
        # still wrong when read twice.
        agreed["confidence"] = "high" if front.get("valid") else "low"
        agreed["agreement"] = "both-sides"
        return agreed

    if front.get("valid") != back.get("valid"):
        chosen = dict(front if front.get("valid") else back)
        chosen["confidence"] = cap(chosen["confidence"], "medium")
        chosen["agreement"] = "one-side-invalid"
        return chosen

    disputed = dict(front)
    disputed["confidence"] = "low"
    disputed["agreement"] = "conflict"
    return disputed


def extract(
    front_path: str | None,
    back_path: str | None,
    recognizer: Recognizer,
) -> ExtractionResult:
    """Run the pipeline over one card. Either side may be absent."""
    result = ExtractionResult()
    started_all = time.perf_counter()

    sides: dict[str, SideResult] = {}
    for path, side in ((front_path, "front"), (back_path, "back")):
        if path is None:
            continue
        image = load_bgr(path)
        side_result = _process_side(image, side, recognizer, result.timings)
        if _needs_retry(side, side_result):
            inverted = _process_side(_rotate_180(image), side, recognizer, result.timings)
            chosen = _better(side_result, inverted)
            if chosen is inverted:
                result.diagnostics.setdefault(side, {})["rotated180"] = True
            side_result = chosen
        sides[side] = side_result

    for side, side_result in sides.items():
        if side_result.quality is not None:
            result.quality[side] = side_result.quality
        notes = result.diagnostics.setdefault(side, {})
        notes["quality"] = side_result.quality.verdict if side_result.quality else "unknown"
        if side_result.rectification is not None:
            notes["rectification"] = side_result.rectification.method
            notes["dewarped"] = side_result.rectification.dewarped
        if side_result.anchoring is not None:
            notes["boxSources"] = side_result.anchoring.source_counts()
        if side == "back":
            # See `_looks_like_the_back`. Surfaced so "you photographed the front twice" stops
            # being indistinguishable from "the recognizer is bad at Arabic".
            looks_right = _looks_like_the_back(side_result.lines)
            if looks_right is False:
                notes["sideMismatch"] = True
        for name, data in side_result.fields.items():
            if name != "nationalId":
                result.fields[name] = data

    reconciled = _reconcile_national_id(sides)
    if reconciled is not None:
        result.fields["nationalId"] = reconciled

        back = sides.get("back")
        printed = _printed_gender(back.lines) if back is not None else None
        if printed is not None:
            agrees = gender_agrees(reconciled["value"], printed)
            if agrees is False:
                # The number's parity digit and the word on the card disagree. One of them is
                # misread and nothing here can say which, so the number is demoted rather than
                # altered — this reaches a digit no structural check covers, which is the whole
                # reason the comparison is worth making.
                reconciled["confidence"] = "low"
                result.diagnostics.setdefault("back", {})["genderMismatch"] = True

    result.total_ms = (time.perf_counter() - started_all) * 1000.0
    return result
