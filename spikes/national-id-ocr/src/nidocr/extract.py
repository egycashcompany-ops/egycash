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
from collections import Counter
from dataclasses import dataclass, field as _field
from typing import Any

import cv2
import numpy as np

from .anchor import Anchoring, Line, anchor, structural
from .arabic import rasm_fold
from .engine import MockRecognizer, Recognizer
from .ensemble import ENOUGH_AGREEMENT, Candidate, Consensus, combine
from .geometry import Rectification
from .layout import BACK_FIELDS, FRONT_FIELDS, FieldBox
from .nid import Repair, gender_agrees, salvage_digits
from .preprocess import DIGIT_VARIANTS, StageTimings, field_variant, load_bgr, prepare
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
    #: True when detection RAISED rather than returning nothing. See `_detect_lines`.
    detection_failed: bool = False

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


def _recognize_box(
    card: np.ndarray, box: FieldBox, recognizer: Recognizer
) -> tuple[str, float, Consensus | None]:
    left, top, right, bottom = box.to_pixels((card.shape[1], card.shape[0]))
    if right <= left or bottom <= top:
        return "", 0.0, None
    region = card[top:bottom, left:right]
    # The mock replays by field name; real recognizers only ever see pixels.
    if isinstance(recognizer, MockRecognizer):
        recognizer.bind(box.name)

    # The national ID and the expiry are numbers: their spaced groups read left to right even
    # on an otherwise right-to-left card. Ordering them as Arabic would reverse the value
    # while keeping every digit correct — a failure that looks entirely plausible.
    if box.kind != "digits":
        return (*_read_text(recognizer, region), None)
    # The full ensemble is spent on the national ID alone. It is the field where a single wrong
    # digit yields a different, valid-looking person, and the only one whose fourteen-digit shape
    # makes several reads combinable at all — an expiry that comes back as two different dates
    # cannot be voted on position by position.
    return _read_digits(recognizer, region, ensemble=box.name == "nationalId")


def _read_text(recognizer: Recognizer, region: np.ndarray) -> tuple[str, float]:
    """A prose field, read once — and once more differently if the first read came back empty.

    The retry is not an ensemble. For free text there is nothing to vote on: two reads that
    disagree cannot be adjudicated, because unlike the national ID a name has no structure to check
    a candidate against. But "nothing at all" is unambiguous, and it is worth one more attempt with
    the contrast raised before a field is reported empty.
    """
    text, score = _read(recognizer, field_variant(region, "grey"), rtl=True)
    if text.strip():
        return text, score
    return _read(recognizer, field_variant(region, "clahe"), rtl=True)


def _read_digits(
    recognizer: Recognizer, region: np.ndarray, *, ensemble: bool
) -> tuple[str, float, Consensus | None]:
    """Read a digits field under several preprocessing variants and combine what they say.

    ONE READ IS NOT ENOUGH FOR THIS FIELD, and the reason is specific rather than general caution.
    A real card came back as 28709011203408 where it printed 28709011202408 — ٢ read as ٣ at
    position eleven, inside the sequence. Both strings are valid national IDs, so no structural
    check, no `parseNationalId` call and no confidence score can tell them apart: the evidence that
    separates them exists only in the pixels, and the only way to use it is to look more than once.

    The variants are chosen to fail differently (see `preprocess.DIGIT_VARIANTS`), so a digit that
    survives all of them is corroborated rather than merely repeated. Reading stops as soon as
    enough of them agree on a structurally valid number, which keeps the ordinary card at two or
    three reads and spends the full set only where there is genuine disagreement to resolve.
    """
    #: Without the ensemble, the two variants this field has always used: thresholded and not.
    #:
    #: Binarizing digit crops was a reasonable default derived from synthetic fixtures, where the
    #: number sits on clean card stock. On a real card it is printed over the pyramid watermark and
    #: adaptive thresholding fragments the glyphs against it — which is how a fourteen-digit number
    #: came back as four. But the opposite holds on a clean scan, where thresholding sharpens the
    #: row. Running both and keeping whichever recovered more digits is the older, cheaper answer,
    #: and it stays in place for the expiry.
    variants = DIGIT_VARIANTS if ensemble else DIGIT_VARIANTS[:2]

    best: tuple[str, float] = ("", 0.0)
    candidates: list[Candidate] = []
    for variant in variants:
        text, score = _read(recognizer, field_variant(region, variant), rtl=False)
        # "More digits recovered" is a real quality signal on a field of known shape, not a
        # heuristic — so it orders the fallback, and the model's score only breaks ties.
        if (len(salvage_digits(text)), score) > (len(salvage_digits(best[0])), best[1]):
            best = (text, score)
        if not ensemble:
            continue

        candidates.append(Candidate(variant=variant, digits=clean_national_id(text).value, score=score))
        agreed = Counter(c.digits for c in candidates if len(c.digits) == 14)
        if agreed and agreed.most_common(1)[0][1] >= ENOUGH_AGREEMENT:
            settled = combine(candidates)
            if settled is not None and settled.valid:
                return settled.value, settled.score, settled

    settled = combine(candidates) if ensemble else None
    if settled is None:
        return (*best, None)
    return settled.value, settled.score, settled


def _read(recognizer: Recognizer, crop: np.ndarray, rtl: bool) -> tuple[str, float]:
    """One recognizer call, with a failure costing the field rather than the card.

    The recognizer is native code and can raise from inside C++ with no Python-level cause. Letting
    that propagate turns one unreadable crop into a 500 for a card whose other five fields read
    perfectly — the same trade `_detect_lines` already makes, which its docstring wrongly claimed
    was being made here too.
    """
    try:
        out = recognizer.recognize(crop, rtl=rtl)
    except Exception:  # noqa: BLE001 — anything can come out of the native predictor
        LOG.warning("recognition failed on a field crop; leaving it empty", exc_info=True)
        return "", 0.0
    return out.text, out.score


def _finalize(
    name: str, raw: str, score: float, consensus: Consensus | None = None
) -> dict[str, Any]:
    """Apply the field's cleanup and decide its confidence band."""
    if name == "nationalId":
        fixed: Repair = clean_national_id(raw)
        # A repair is a deduction from structure, not the model having read the digits, so it can
        # rescue a field but must never present it as certainly read. Ambiguity floors the band
        # outright: several different people's numbers were equally close to this read.
        confidence = (
            "low"
            if (fixed.ambiguous or not fixed.valid)
            else cap(band(score), "medium")
            if fixed.repaired
            else band(score)
        )
        data = {
            "value": fixed.value,
            "confidence": confidence,
            "raw": raw,
            "score": score,
            "repaired": fixed.repaired,
            "ambiguous": fixed.ambiguous,
            "valid": fixed.valid,
        }
        if consensus is not None:
            data["agreement"] = consensus.agreement
            data["reads"] = consensus.total
            if not consensus.valid:
                # Every variant, and every combination of them, produced something that cannot be
                # a national ID. That is not a number to present as read.
                data["confidence"] = "low"
            elif consensus.deduced or consensus.agreement == "single":
                # Assembled position-by-position out of reads that disagreed, or produced by one
                # variant while the others produced nothing usable. Both are worth keeping and
                # worth flagging, and the way to flag them is to refuse the top band.
                data["confidence"] = cap(data["confidence"], "medium")
        return data
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


def _detect_lines(card: np.ndarray, recognizer: Recognizer, side: str) -> tuple[list[Line], bool]:
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

    Returns (lines, failed). The flag is reported in the diagnostics because the two ways of ending
    up with no lines are indistinguishable in the output and have opposite fixes: detection raising
    is a runtime problem in the recognizer, and detection returning nothing on a card that clearly
    has text on it is a capture problem. Both present as "every field came from the nominal box",
    and telling them apart from a screenshot is impossible — which cost several rounds of tuning
    geometry that was never the thing at fault.
    """
    try:
        return list(recognizer.detect_lines(card)), False
    except Exception:  # noqa: BLE001 — the recognizer is native code; anything can come out of it
        LOG.warning("%s: line detection failed; falling back to nominal boxes", side, exc_info=True)
        return [], True


def _process_side(
    image: np.ndarray, side: str, recognizer: Recognizer, timings: StageTimings
) -> SideResult:
    """Prepare one face, anchor its boxes to the text found on it, and read every field."""
    prepared = prepare(image, timings, side=side)
    result = SideResult(quality=prepared.quality, rectification=prepared.rectification)
    boxes = _side_boxes(side)
    size = (prepared.image.shape[1], prepared.image.shape[0])

    started = time.perf_counter()
    result.lines, result.detection_failed = _detect_lines(prepared.image, recognizer, side)
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
        raw, score, consensus = _recognize_box(prepared.image, box, recognizer)
        timings.record(f"recognize:{side}:{name}", started)
        data = _finalize(name, raw, score, consensus)
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
        # How much the boxes had to work with. A side reporting zero lines but a full set of
        # 'nominal' box sources is a card read entirely on profile geometry, which is the state
        # every field-placement symptom traces back to — worth one integer in the diagnostics.
        notes["linesDetected"] = len(side_result.lines)
        if side_result.detection_failed:
            notes["detectionFailed"] = True
        # How much the number was corroborated on THIS side, before the two sides are compared.
        # 'unanimous' over four reads and 'voted' over four disagreeing ones are very different
        # states behind the same fourteen digits, and only one of them is worth trusting.
        number = side_result.fields.get("nationalId", {})
        if number.get("agreement"):
            notes["nationalIdReads"] = number.get("reads", 0)
            notes["nationalIdAgreement"] = number["agreement"]
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
