"""Orchestration: two card images in, one `RawOcrResult`-shaped dict out."""

from __future__ import annotations

import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from collections import Counter
from dataclasses import dataclass, field as _field, replace
from typing import Any

import cv2
import numpy as np

from .anchor import Anchoring, Line, anchor, structural
from .arabic import rasm_fold, to_western_digits
from .egycash_id import (
    COMPANY_VALUE,
    badge_verdict,
    clean_employee_code,
    widen_code_box,
    employee_code_valid,
    _is_company,
    find_logo,
    read_badge_lines,
)
from .engine import Recognition, Recognizer
from .portrait import face_fills_frame
from .ensemble import (
    ENOUGH_AGREEMENT,
    MIN_BACKING_DIGITS,
    Candidate,
    Consensus,
    backers,
    combine,
    fits_inside,
)
from .geometry import (
    ID1_ASPECT,
    card_content,
    Rectification,
    find_card_outline,
    locate_card,
    orient_landscape,
)
from .orientation import face_turn, layout_turn, looks_like_back, turn, upright
from .layout import BACK_FIELDS, FRONT_FIELDS, FieldBox
from .nid import Repair, gender_agrees, is_structurally_valid, salvage_digits
from .preprocess import (
    DIGIT_VARIANTS,
    TEXT_MARGIN,
    VARIANT_MARGIN,
    StageTimings,
    field_variant,
    load_bgr,
    prepare,
)
from .postprocess import (
    agree_with_sex,
    band,
    cap,
    clean_address,
    clean_expiry,
    clean_marital_status,
    clean_national_id,
    clean_religion,
    clean_text,
)
from .quality import QualityReport, assess
from .crosscheck import cross_check
from .lexicon import correct as lexicon_correct
from .lexicon import near_miss as lexicon_near_miss
from .rows import read_by_rows
from .trace import NO_TRACE, Trace

LOG = logging.getLogger("nidocr.extract")


@dataclass
class SideResult:
    """Everything one face of the card produced, including why it produced it."""

    fields: dict[str, dict[str, Any]] = _field(default_factory=dict)
    quality: QualityReport | None = None
    rectification: Rectification | None = None
    anchoring: Anchoring | None = None
    lines: list[Line] = _field(default_factory=list)
    #: Lines of the row reader's other reads (zoomed, enhanced): their words only. See RowRead.
    pass_lines: list[Line] = _field(default_factory=list)
    #: True when detection raised rather than returning nothing. See `_detect_lines`.
    detection_failed: bool = False
    #: The back's issue year, for the cross-checks only. Never returned.
    issue_year: int | None = None
    #: The front's printed birth date (YYYYMMDD), to check the number's digits 1-7 against.
    birth: str | None = None
    #: Which reads the row reader made: 'photo', then 'zoomed xN' and 'enhanced' on weak photos.
    row_passes: list[str] = _field(default_factory=list)
    #: Every reading this side produced of the national ID, kept for the cross-side vote.
    nid_candidates: list[Candidate] = _field(default_factory=list)

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
    #: Per-side notes on how the read was obtained, rectification method, where the boxes came
    #: from, whether a side was retried upside down. Diagnostic only; carries no card content.
    diagnostics: dict[str, Any] = _field(default_factory=dict)
    #: Each side as it was finally read: after the turn upright and any 180 retry. Kept so the
    #: test page can show the rotation instead of only reporting it. Never logged or stored.
    oriented: dict[str, np.ndarray] = _field(default_factory=dict)

    def as_raw_ocr_result(self) -> dict[str, dict[str, str]]:
        """The `RawOcrResult` payload, only fields that produced a value."""
        return {
            name: {"value": data["value"], "confidence": data["confidence"]}
            for name, data in self.fields.items()
            if data["value"]
        }

    def scores(self) -> dict[str, int]:
        """Each returned field's confidence as a percentage, kept inside its band."""
        bands = {"high": (0.90, 1.00), "medium": (0.70, 0.89), "low": (0.00, 0.69)}
        out: dict[str, int] = {}
        for name, data in self.fields.items():
            if not data.get("value"):
                continue
            low, high = bands.get(data.get("confidence"), (0.0, 0.69))
            score = float(data.get("score") or 0.0)
            out[name] = round(100 * min(high, max(low, score)))
        return out

    def readable(self) -> bool:
        """False only when every supplied side was refused by the quality gate."""
        return not self.quality or any(report.readable for report in self.quality.values())


@dataclass(frozen=True)
class Read:
    """What one field's recognition produced, and the evidence behind it."""

    text: str
    score: float
    #: Present for the national ID only, several readings combined into one answer.
    consensus: Consensus | None = None
    #: The individual readings.
    candidates: tuple[Candidate, ...] = ()


def _trace_lines(trace: Trace, label: str, out: Recognition) -> None:
    """Record what the recognizer was shown and what it said, per printed line."""
    for index, line in enumerate(out.lines):
        trace.image(f"{label} / line {index} (image)", line.image)
        trace.text(f"{label} / line {index} (raw, score {line.score:.3f})", line.text)
    trace.text(f"{label} / raw (joined, score {out.score:.3f})", out.text)


def _crop(card: np.ndarray, box: FieldBox, margin: float) -> np.ndarray | None:
    """The field's pixels, with a little of the card around them."""
    height, width = card.shape[0], card.shape[1]
    left, top, right, bottom = box.to_pixels((width, height))
    grow_x, grow_y = int(box.w * width * margin), int(box.h * height * margin)
    left, top = max(0, left - grow_x), max(0, top - grow_y)
    right, bottom = min(width, right + grow_x), min(height, bottom + grow_y)
    if right <= left or bottom <= top:
        return None
    return card[top:bottom, left:right]


def _recognize_box(
    card: np.ndarray,
    box: FieldBox,
    recognizer: Recognizer,
    trace: Trace = NO_TRACE,
    side: str = "",
) -> Read:
    label = f"{side} / {box.name}"
    trace.data(
        f"{label} / box",
        {"x": box.x, "y": box.y, "w": box.w, "h": box.h, "kind": box.kind},
    )
    # Recognizers that care which field they are reading say so with `bind`: the test mock replays
    # by field name. PaddleOCR has no `bind` and only ever sees pixels.
    bind = getattr(recognizer, "bind", None)
    if bind is not None:
        bind(box.name)

    # The national ID and the expiry are numbers: their spaced groups read left to right even on an
    # otherwise right-to-left card.
    if box.kind != "digits":
        region = _crop(card, box, TEXT_MARGIN)
        if region is None:
            return Read("", 0.0)
        trace.image(f"{label} / crop", region)
        return Read(*_read_text(recognizer, region, trace, label))
    # The full ensemble is spent on the national ID alone.
    return _read_digits(
        card, box, recognizer, ensemble=box.name == "nationalId", trace=trace, label=label
    )


def _read_text(
    recognizer: Recognizer, region: np.ndarray, trace: Trace = NO_TRACE, label: str = ""
) -> tuple[str, float]:
    """A prose field, read once, and once more differently if the first read came back empty."""
    for variant in ("grey", "clahe"):
        prepared = field_variant(region, variant)
        trace.image(f"{label} / prepared ({variant})", prepared)
        out = _read(recognizer, prepared, rtl=True)
        _trace_lines(trace, f"{label} / {variant}", out)
        if out.text.strip():
            return out.text, out.score
    return "", 0.0


def _read_digits(
    card: np.ndarray,
    box: FieldBox,
    recognizer: Recognizer,
    *,
    ensemble: bool,
    trace: Trace = NO_TRACE,
    label: str = "",
) -> Read:
    """Read a digits field under several preprocessing variants and combine what they say."""
    #: Without the ensemble, the two variants this field has always used: thresholded and not.
    variants = DIGIT_VARIANTS if ensemble else DIGIT_VARIANTS[:2]

    best: tuple[str, float] = ("", 0.0)
    candidates: list[Candidate] = []
    for variant in variants:
        # Each variant reads its own crop.
        region = _crop(card, box, VARIANT_MARGIN[variant])
        if region is None:
            continue
        prepared = field_variant(region, variant)
        trace.image(f"{label} / crop ({variant}, margin {VARIANT_MARGIN[variant]})", region)
        trace.image(f"{label} / prepared ({variant})", prepared)
        out = _read(recognizer, prepared, rtl=False)
        _trace_lines(trace, f"{label} / {variant}", out)
        text, score = out.text, out.score
        # "More digits recovered" is a real quality signal on a field of known shape, not a
        # heuristic, so it orders the fallback, and the model's score only breaks ties.
        if (len(salvage_digits(text)), score) > (len(salvage_digits(best[0])), best[1]):
            best = (text, score)
        if not ensemble:
            continue

        # The digits as read, not as repaired.
        candidates.append(Candidate(variant=variant, digits=salvage_digits(text), score=score))
        agreed = Counter(c.digits for c in candidates if len(c.digits) == 14)
        if agreed and agreed.most_common(1)[0][1] >= ENOUGH_AGREEMENT:
            settled = combine(candidates)
            if settled is not None and settled.valid:
                break

    settled = combine(candidates) if ensemble else None
    if candidates:
        trace.data(
            f"{label} / ensemble",
            {
                "candidates": [
                    {"variant": c.variant, "digits": c.digits, "score": round(c.score, 4)}
                    for c in candidates
                ],
                "chosen": None
                if settled is None
                else {
                    "value": settled.value,
                    "agreement": settled.agreement,
                    "support": settled.support,
                    "reads": settled.total,
                    "valid": settled.valid,
                },
            },
        )
    if settled is None:
        return Read(*best, candidates=tuple(candidates))
    return Read(settled.value, settled.score, settled, tuple(candidates))


def _read(recognizer: Recognizer, crop: np.ndarray, rtl: bool) -> Recognition:
    """One recognizer call, with a failure costing the field rather than the card."""
    try:
        return recognizer.recognize(crop, rtl=rtl)
    except Exception:  # noqa: BLE001 - anything can come out of the native predictor
        LOG.warning("recognition failed on a field crop; leaving it empty", exc_info=True)
        return Recognition(text="", score=0.0)


#: A vocabulary snap lifts a borderline read to 'medium' only when the read itself scored at least
#: this much.
SNAP_LIFT_FLOOR = 0.65


def _finalize(
    name: str, raw: str, score: float, consensus: Consensus | None = None
) -> dict[str, Any]:
    """Apply the field's cleanup and decide its confidence band."""
    if name == "nationalId":
        fixed: Repair = clean_national_id(raw)
        # A repair is a deduction from structure, not the model having read the digits, so it can
        # rescue a field but must never present it as certainly read.
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
                # variant while the others produced nothing usable.
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
        # A snap is corroboration, not proof, it can lift a borderline read to 'medium' but
        # never to 'high', which stays reserved for the model being confident on its own.
        return {
            "value": value,
            "confidence": band(max(score, 0.75) if snapped and score >= SNAP_LIFT_FLOOR else score),
            "raw": raw,
            "score": score,
        }
    if name == "maritalStatus":
        value, snapped = clean_marital_status(raw)
        return {
            "value": value,
            "confidence": band(max(score, 0.75) if snapped and score >= SNAP_LIFT_FLOOR else score),
            "raw": raw,
            "score": score,
        }
    if name == "address":
        value, snapped = clean_address(raw)
        value, corrected = lexicon_correct(value, "address")
        confidence = band(max(score, 0.75) if snapped and score >= SNAP_LIFT_FLOOR else score)
        return {
            "value": value,
            # A letter changed from a word list is a deduction: never presented as certainly read.
            "confidence": cap(confidence, "medium") if corrected else confidence,
            "raw": raw,
            "score": score,
        }
    value = clean_text(raw)
    corrected = False
    if name == "fullNameAr":
        value, corrected = lexicon_correct(value, "name")
    if name in ("fullNameAr", "occupation"):
        # A name or a job is Arabic words only. A digit or a Latin letter is something printed
        # beside the card, a keyboard's '6' came back as '6 طالب', and is dropped, flagged.
        words = value.split()
        kept = [word for word in words if not _FOREIGN.search(word)]
        if kept and len(kept) < len(words):
            value, corrected = " ".join(kept), True
    confidence = band(score)
    data = {
        "value": value,
        "confidence": cap(confidence, "medium") if corrected else confidence,
        "raw": raw,
        "score": score,
    }
    if name == "fullNameAr" and lexicon_near_miss(value, "name"):
        # A word one letter from a common name is how a misread looks; the model's score cannot
        # tell (a lost letter scored 0.91 on a real card). A person confirms it.
        data["confidence"] = cap(data["confidence"], "medium")
        data["nearLexicon"] = True
    return data


#: Fields the back carries but has no nominal box for.
_BACK_STRUCTURAL_EXTRA = ("nationalId",)


def _side_boxes(side: str) -> tuple[FieldBox, ...]:
    return FRONT_FIELDS if side == "front" else BACK_FIELDS


def _detect_lines(card: np.ndarray, recognizer: Recognizer, side: str) -> tuple[list[Line], bool]:
    """Full-page detection, downgraded to 'no lines' if it fails rather than losing the card."""
    try:
        return list(recognizer.detect_lines(card)), False
    except Exception:  # noqa: BLE001 - the recognizer is native code; anything can come out of it
        LOG.warning("%s: line detection failed; falling back to nominal boxes", side, exc_info=True)
        return [], True


def _process_side(
    image: np.ndarray,
    side: str,
    recognizer: Recognizer,
    timings: StageTimings,
    trace: Trace = NO_TRACE,
    framed: bool = False,
) -> SideResult:
    """Prepare one face, anchor its boxes to the text found on it, and read every field."""
    prepared = prepare(image, timings, side=side, framed=framed)
    trace.image(f"{side} / card / 00 original", image)
    trace.image(f"{side} / card / 01 rectified and enhanced", prepared.image)
    trace.data(
        f"{side} / card / 02 quality",
        {
            "verdict": prepared.quality.verdict,
            "reasons": list(prepared.quality.reasons),
            "metrics": {k: round(v, 4) for k, v in prepared.quality.metrics.items()},
            "rectification": prepared.rectification.method,
            "dewarped": prepared.rectification.dewarped,
        },
    )
    result = SideResult(quality=prepared.quality, rectification=prepared.rectification)
    ceiling = prepared.quality.confidence_ceiling

    # Read first, assign second (see rows.py).
    started = time.perf_counter()
    rows = read_by_rows(image, side, recognizer)
    timings.record(f"{side}:rows", started)
    if rows is not None:
        result.lines = list(rows.lines)
        result.pass_lines = list(rows.pass_lines)
        trace.data(f"{side} / rows / 00 printed rows", rows.rows)
        result.row_passes = list(rows.passes)
        result.issue_year = rows.issue_year
        result.birth = rows.birth
        trace.data(
            f"{side} / rows / 01 assigned",
            {name: {"raw": raw, "score": round(score, 3)} for name, (raw, score, _) in rows.fields.items()},
        )
        for name, (raw, score, bounds) in rows.fields.items():
            started = time.perf_counter()
            source = rows.images.get(name, image)
            data = _row_field(
                source, name, raw, score, bounds, recognizer, result, trace, side,
                fence=rows.fences.get(name, (None, None)),
            )
            _unbind(recognizer)
            timings.record(f"recognize:{side}:{name}", started)
            trace.data(f"{side} / {name} / final", {k: v for k, v in data.items() if k != "score"})
            data["confidence"] = cap(data["confidence"], ceiling)
            result.fields[name] = data

    if side == "front" and result.birth and "nationalId" in result.fields:
        _check_birth(result.fields["nationalId"], result.birth, result.nid_candidates, ceiling)

    placed = set(result.fields)
    boxes = tuple(box for box in _side_boxes(side) if box.name not in placed)
    extra = tuple(n for n in (_BACK_STRUCTURAL_EXTRA if side == "back" else ()) if n not in placed)
    if not boxes and not extra:
        return result
    size = (prepared.image.shape[1], prepared.image.shape[0])

    started = time.perf_counter()
    detected, result.detection_failed = _detect_lines(prepared.image, recognizer, side)
    if rows is None:
        result.lines = detected
    timings.record(f"{side}:detect", started)
    trace.data(
        f"{side} / card / 03 detected lines",
        {
            "failed": result.detection_failed,
            "count": len(detected),
            "lines": [text for _, text, _ in detected],
        },
    )

    wanted = {box.name for box in boxes} | set(extra)
    result.anchoring = anchor(boxes, detected, size)
    if side == "back":
        for name, box in structural(detected, size, wanted=wanted).items():
            result.anchoring.boxes.setdefault(name, box)
            result.anchoring.sources.setdefault(name, "structural")

    trace.data(
        f"{side} / card / 04 anchored boxes",
        {
            name: {
                "x": round(box.x, 4),
                "y": round(box.y, 4),
                "w": round(box.w, 4),
                "h": round(box.h, 4),
                "source": result.anchoring.sources.get(name, "nominal"),
            }
            for name, box in result.anchoring.boxes.items()
        },
    )
    trace.image(f"{side} / card / 05 boxes drawn", _draw_boxes(prepared.image, result.anchoring))

    for name, box in result.anchoring.boxes.items():
        if name in placed:
            continue
        started = time.perf_counter()
        read = _recognize_box(prepared.image, box, recognizer, trace, side)
        _unbind(recognizer)
        timings.record(f"recognize:{side}:{name}", started)
        if name == "nationalId":
            result.nid_candidates = list(read.candidates)
        data = _finalize(name, read.text, read.score, read.consensus)
        trace.data(
            f"{side} / {name} / final",
            {k: v for k, v in data.items() if k not in ("score",)},
        )
        # The capture's own quality bounds every field it produced.
        data["confidence"] = cap(data["confidence"], ceiling)
        result.fields[name] = data

    return result


def _row_field(
    image: np.ndarray,
    name: str,
    raw: str,
    score: float,
    bounds: tuple[float, float, float, float],
    recognizer: Recognizer,
    result: SideResult,
    trace: Trace,
    side: str,
    fence: tuple[float | None, float | None] = (None, None),
) -> dict[str, Any]:
    """Finalize a field the row reader placed. Where it was read stays the row reader's answer."""
    height, width = image.shape[:2]
    left, top, right, bottom = bounds
    box = FieldBox(
        name=name,
        x=left / width,
        y=top / height,
        w=(right - left) / width,
        h=(bottom - top) / height,
        kind="digits" if name in ("nationalId", "nationalIdExpiry") else "text",
    )
    label = f"{side} / {name}"
    if name == "nationalId":
        page = Candidate(variant="page", digits=_digits_only(raw), score=score)
        bind = getattr(recognizer, "bind", None)
        if bind is not None:
            bind(name)
        read = _read_digits(image, box, recognizer, ensemble=True, trace=trace, label=label)
        candidates = [page, *read.candidates]
        settled = combine(candidates)
        # Fourteen digits or keep looking.
        for widen in (2.0, 4.0, 7.0, 10.0):
            if settled is not None and settled.valid:
                break
            candidates.extend(
                _read_widened(image, bounds, raw, widen, recognizer, trace, label, fence=fence)
            )
            settled = combine(candidates)
        result.nid_candidates = candidates
        if settled is None:
            best = raw if len(_digits_only(raw)) >= len(_digits_only(read.text)) else read.text
            return _finalize(name, best, score if best == raw else read.score)
        data = _finalize(name, settled.value, settled.score, settled)
        if side == "back" and not any(
            c.digits == settled.value for c in candidates if not c.variant.startswith("widened")
        ):
            # Only the widened re-reads produced this number: the digits they added came from
            # beside the row as read, and beside the ID on the back is the issue date.
            data["confidence"] = cap(data["confidence"], "medium")
            data["widened"] = True
        return data
    bind = getattr(recognizer, "bind", None)
    if bind is not None and name in ("fullNameAr", "address", "occupation"):
        bind(name)
        region = _crop(image, box, TEXT_MARGIN)
        if region is not None:
            text, text_score = _read_text(recognizer, region, trace, label)
            if text.strip():
                return _finalize(name, text, text_score)
    return _finalize(name, raw, score)


def _birth_prefix(birth: str) -> str:
    """The number's first seven digits for a YYYYMMDD birth date: century, then YYMMDD."""
    return ("2" if birth.startswith("19") else "3") + birth[2:]


def _not_a_number(data: dict[str, Any]) -> bool:
    """Is this "national ID" too far from fourteen digits to be a misread of one?"""
    digits = _digits_only(data.get("value", ""))
    return not data.get("valid") and not 12 <= len(digits) <= 15


#: Agreement between the number's own reads that, with the printed birth date agreeing, marks the
#: number `corroborated` (evidence for the reviewer, never a lift past the capture): two witnesses, the
#: filters on the number and the date printed beside it.
CORROBORATED = ("unanimous", "majority")


def _corroborated(data: dict[str, Any]) -> bool:
    return bool(
        data.get("birthDateAgrees") and data.get("valid") and data.get("agreement") in CORROBORATED
        and not data.get("repaired") and not data.get("widened")
    )


def _apply_capture_ceilings(data: dict[str, Any], ceilings: list[str]) -> None:
    """Cap the reconciled number by the captures it was read from. Only ever lowers.

    Read on one side: the lowest ceiling. Read alike on both sides: the better side's ceiling,
    since that side alone would have returned the number at that band. Corroboration (the printed
    birth date agreeing) is evidence, never a lift past a ceiling.
    """
    if not ceilings:
        return
    if data.get("agreement") in AGREED_BY_BOTH:
        ceilings = [max(ceilings, key=lambda band_name: _RANK.get(band_name, 0))]
    for ceiling in ceilings:
        data["confidence"] = cap(data["confidence"], ceiling)


def _check_birth(
    data: dict[str, Any], birth: str, candidates: list[Candidate], ceiling: str = "high"
) -> None:
    """Hold the number up against the birth date printed beside it on the front.

    The date is printed separately and read separately, so agreement is a second read of seven
    of the fourteen digits; disagreement means one of the two was misread, and a number whose
    birth date does not match the card's is never handed back as certainly read.
    """
    prefix = _birth_prefix(birth)
    if not is_structurally_valid(prefix + "0100000"):
        return  # the date itself read as no possible holder's: it can say nothing
    value = data.get("value") or ""
    if len(value) == 14 and value.startswith(prefix):
        data["birthDateAgrees"] = True
        if _corroborated(data):
            # Most filters read the number the same way and the printed date says the same of its
            # first seven digits. Recorded as evidence for the reviewer, but it never lifts the
            # field past the capture's ceiling: the capture only ever lowers confidence.
            data["corroborated"] = True
            data["confidence"] = cap(data.get("confidence", "low"), ceiling)
        return
    # A read of the number that agrees with the printed date beats one that does not.
    agreeing = [
        c for c in candidates if len(c.digits) == 14 and c.digits.startswith(prefix)
        and is_structurally_valid(c.digits)
    ]
    if agreeing:
        best = max(agreeing, key=lambda c: (sum(o.digits == c.digits for o in candidates), c.score))
        data.update(value=best.digits, valid=True, score=best.score, birthDateAgrees=True)
        data["confidence"] = cap(band(best.score), "medium")
        return
    data["birthDateMismatch"] = True
    # The printed date is the faint one, partly under the emblem, and was misread more often than
    # the number in the photos tried: it is held against the number, not above it. A number read
    # the same way by most filters stands; one read once, or assembled, is not trusted past medium.
    if data.get("agreement") not in ("unanimous", "majority", "both-sides") or not data.get("valid"):
        data["confidence"] = cap(data.get("confidence", "low"), "medium" if data.get("valid") else "low")


#: How much a widened ID row is enlarged before the ensemble reads it.
ID_RETRY_ZOOM = 2.0


def _read_widened(
    image: np.ndarray,
    bounds: tuple[float, float, float, float],
    raw: str,
    widen: float,
    recognizer: Recognizer,
    trace: Trace,
    label: str,
    fence: tuple[float | None, float | None] = (None, None),
) -> list[Candidate]:
    """The ID row again, `widen` digit-widths wider on each side and enlarged. → its readings."""
    left, top, right, bottom = bounds
    found = max(len(_digits_only(raw)), 1)
    digit = (right - left) / found
    height, width = image.shape[:2]
    pad_y = (bottom - top) * 0.3
    x0, x1 = max(0, int(left - widen * digit)), min(width, int(right + widen * digit))
    lower, upper = fence
    if lower is not None:
        x0 = max(x0, int(lower + 0.3 * digit))
    if upper is not None:
        x1 = min(x1, int(upper - 0.3 * digit))
    y0, y1 = max(0, int(top - pad_y)), min(height, int(bottom + pad_y))
    region = image[y0:y1, x0:x1]
    if region.size == 0:
        return []
    region = cv2.resize(
        region,
        (round(region.shape[1] * ID_RETRY_ZOOM), round(region.shape[0] * ID_RETRY_ZOOM)),
        interpolation=cv2.INTER_CUBIC,
    )
    whole = FieldBox(name="nationalId", x=0.0, y=0.0, w=1.0, h=1.0, kind="digits")
    read = _read_digits(
        region, whole, recognizer, ensemble=True, trace=trace, label=f"{label} / widened x{widen:g}"
    )
    return [
        Candidate(variant=f"widened{widen:g}:{c.variant}", digits=c.digits, score=c.score)
        for c in read.candidates
    ]


def _unbind(recognizer: Recognizer) -> None:
    """Release a field binding, so a read nobody bound is never treated as that field's."""
    unbind = getattr(recognizer, "unbind", None)
    if unbind is not None:
        unbind()


def _digits_only(text: str) -> str:
    return "".join(character for character in to_western_digits(text) if character.isdigit())


def _holder_is_female(printed: str | None, number: dict[str, Any] | None) -> bool | None:
    """The holder's sex from the printed word, else from a trusted number's digit 13 (even = female).

    None when neither says, or when they disagree (that is a mismatch to review, not a fact to use).
    """
    from_word = None
    if printed is not None:
        folded = rasm_fold(printed)
        if folded in {rasm_fold(word) for word in ("أنثى", "انثى", "أنثي", "انثي")}:
            from_word = True
        elif folded == rasm_fold("ذكر"):
            from_word = False
    from_number = None
    if number and number.get("valid") and number.get("confidence") in ("high", "medium"):
        digits = _digits_only(number.get("value", ""))
        if len(digits) == 14:
            from_number = int(digits[12]) % 2 == 0
    if from_word is not None and from_number is not None and from_word != from_number:
        return None
    return from_word if from_word is not None else from_number


def _side_text_lines(side: SideResult) -> list[Line]:
    """Every line any read of this side found, for checks on its words (not its geometry)."""
    return list(side.lines) + list(side.pass_lines)


def _printed_gender(lines: list[Line]) -> str | None:
    """The sex word printed on the back, read only to check the number's parity digit."""
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


#: The words the front's title prints, rasm-folded.
_TITLE_WORDS = frozenset(rasm_fold(word) for word in ("بطاقة", "تحقيق", "الشخصية", "جمهورية", "العربية"))
#: Fewest lines a read must have found before "no title among them" says anything: a real card's
#: title is among the largest print on it, so a read of this many lines with none of it is another
#: document (a driving licence read 14 lines, a Philippine one 37, a real card with a blurred photo
#: still found 2 of the title's words).
MIN_LINES_FOR_NO = 8
#: At most this many lines read, and a face filling the photo: a picture of a person, not a card.
FACE_MAX_LINES = 2


def _title_hits(lines: list[Line]) -> int:
    """How many different words of the front's title were read on this side."""
    found = {
        folded
        for _, text, _ in lines
        for token in text.split()
        if (folded := rasm_fold(token.strip("-–—:.,،"))) in _TITLE_WORDS
    }
    return len(found)


def _back_marker_hits(lines: list[Line]) -> int:
    """How many of the words only the back prints were read: sex, religion, marital status, validity."""
    folded = " ".join(rasm_fold(text) for _, text, _ in lines)
    return sum(1 for marker in _BACK_MARKERS if marker in folded)


def _side_verdict(side: str, evidence: dict[str, Any]) -> str:
    """'yes' (looks like that side of an Egyptian national ID), 'no', or 'unsure'.

    The card is judged by what it prints and where, never by who it names. The front always prints
    its title; the back always prints the barcode and the words for sex, religion and marital
    status. Something that reads clearly and has none of that is another document: a driving
    licence, a student card, a bank card. (This says what the card looks like, not whether it is
    genuine: a good copy of a real card looks real, and only the issuer can say it is not.)
    """
    if evidence.get("faceFillsFrame"):
        # A face filling the photo and next to no text: a picture of a person, not of the card.
        return "no"
    if evidence.get("companyName") and not evidence.get("titleWords"):
        # The company's name with none of the card's title: an EGY CASH ID, whatever else it has (it
        # prints a valid national ID number and a portrait too).
        return "no"
    if side == "front":
        title = evidence["titleWords"]
        if title >= 2 or (title == 1 and (evidence["validNumber"] or evidence["portrait"])):
            return "yes"
        if evidence["lines"] >= MIN_LINES_FOR_NO and title == 0:
            return "no"
        return "unsure"
    markers = evidence["markerWords"]
    if markers >= 2 or (markers == 1 and evidence["barcode"]):
        return "yes"
    if evidence["lines"] >= MIN_LINES_FOR_NO and markers == 0 and not evidence["barcode"]:
        return "no"
    return "unsure"


def _card_verdict(sides: dict[str, str]) -> str:
    """The whole submission: 'national_id', 'not_national_id' (any side clearly is not), 'unsure'."""
    if any(verdict == "no" for verdict in sides.values()):
        return "not_national_id"
    if sides and all(verdict == "yes" for verdict in sides.values()):
        return "national_id"
    return "unsure"


def _looks_like_the_back(lines: list[Line]) -> bool | None:
    """Does this image carry any of the words only the back of the card has? None if unreadable."""
    if not lines:
        return None
    folded = " ".join(rasm_fold(text) for _, text, _ in lines)
    if not folded.strip():
        return None
    return any(marker in folded for marker in _BACK_MARKERS)


#: Card width, in pixels, that a far-away card is enlarged to: about what a close-up phone photo
#: of a card gives, where every field was measured reading correctly.
CARD_TARGET_WIDTH = 2400
#: A card narrower than this share of the photo is "far away" and gets zoomed to.
FAR_CARD_SHARE = 0.6
MAX_CARD_ZOOM = 16.0
LANCZOS_FROM_ZOOM = 5.0


def _zoom_to_card(
    image: np.ndarray, recognizer: Recognizer
) -> tuple[np.ndarray, float, tuple[float, float, float, float] | None, np.ndarray | None]:
    """Crop the card out of its photo, enlarging it if far. → (image, zoom, box, card)."""
    try:
        found = locate_card(image)
        if found is not None and card_content(image, found[0]) == "portrait":
            # Card-shaped, but a face fills it: the printed photo, or the holder's head beside the
            # card. Zooming to it is the "zoomed on the face" failure.
            found = None
    except Exception:  # noqa: BLE001 - zooming is an improvement, never a reason to fail
        found = None
    quad = found[0] if found is not None else _detail_region(image)
    if quad is None:
        return image, 0.0, None, None
    height, width = image.shape[:2]
    left, top = float(quad[:, 0].min()), float(quad[:, 1].min())
    right, bottom = float(quad[:, 0].max()), float(quad[:, 1].max())
    card_width = max(right - left, bottom - top)
    # A located quad with the card's own proportions (ID-1, 85.6 x 54 mm = 1.59) is the card, and
    # everything outside it is background: a table, a hand, other papers whose text would be read
    # as rows of the card.
    card_shaped = found is not None and CARD_ASPECT_RANGE[0] <= _aspect(quad) <= CARD_ASPECT_RANGE[1]
    fills_frame = (right - left) * (bottom - top) >= 0.92 * width * height
    card = quad if card_shaped else None
    if card_width >= FAR_CARD_SHARE * max(width, height) and (not card_shaped or fills_frame):
        return image, 0.0, None, card
    pad = 0.06 * card_width
    left, top = max(0, int(left - pad)), max(0, int(top - pad))
    right, bottom = min(width, int(right + pad)), min(height, int(bottom + pad))
    # The locator can mistake something card-shaped on the card for the card, the printed
    # portrait, most often, and zooming to that throws the name and the number away.
    try:
        lines = list(recognizer.detect_lines(image))
    except Exception:  # noqa: BLE001
        lines = []
    centres = [np.asarray(poly, dtype=float).reshape(-1, 2).mean(axis=0) for poly, _, _ in lines]
    if centres:
        inside = sum(left <= x <= right and top <= y <= bottom for x, y in centres)
        # A card-shaped find only has to hold a good share of the text, because text outside it is
        # exactly the background this crop exists to remove.
        if inside < (0.4 if card_shaped else 0.8) * len(centres):
            return image, 0.0, None, None
    crop = image[top:bottom, left:right]
    # Enlarged only when far: a card that already fills a good share of the photo is cropped and
    # nothing more.
    far = card_width < FAR_CARD_SHARE * max(width, height)
    zoom = min(MAX_CARD_ZOOM, max(1.0, CARD_TARGET_WIDTH / card_width)) if far else 1.0
    if zoom > 1.0:
        size = (round(crop.shape[1] * zoom), round(crop.shape[0] * zoom))
        # Lanczos for the big zooms only.
        method = cv2.INTER_LANCZOS4 if zoom >= LANCZOS_FROM_ZOOM else cv2.INTER_CUBIC
        crop = cv2.resize(crop, size, interpolation=method)
    return crop, zoom, (left / width, top / height, right / width, bottom / height), card


#: The flattened card shown on the test page is at most this wide; it is a picture, not a read.
SURFACE_MAX_WIDTH = 1200
#: The picture is cut this share inside the card's outline on every side.
SURFACE_INSET = 0.0075
#: Read the card cut out along its own edges (`find_card_outline`) rather than a box around it.
READ_FLAT_CARD = os.environ.get("NIDOCR_READ_FLAT", "0") == "1"
#: Longest side a close-up card is read at.
READ_LONG_SIDE = int(os.environ.get("NIDOCR_READ_LONG_SIDE", "2400"))
#: A card whose longest side is under this is enlarged to `SMALL_CARD_TARGET` before reading.
#: Not larger cards: enlarging a sharp 1,100 px card 2x lost a digit of its ID.
SMALL_CARD_SIDE = 800
SMALL_CARD_TARGET = 1600
#: The fields each side carries; one missing there sends the flattened card to be read.
SIDE_FIELDS = {
    "front": ("fullNameAr", "nationalId", "address"),
    "back": ("nationalId", "occupation", "religion", "maritalStatus", "nationalIdExpiry"),
}
_RANK = {"low": 0, "medium": 1, "high": 2}
#: Reconciled IDs that both sides read: their quality limit is the sharper photo's.
AGREED_BY_BOTH = ("both-sides", "both-sides-direct", "cross-side-consistent")
#: Photo kept around the card when it is cut out for reading, as a share of its size: nothing
#: printed near an edge can be lost to an outline a pixel or two inside it.
READ_MARGIN = 0.02


def _laid_turn(outline: np.ndarray) -> int:
    """The clockwise turn of the photo that laying the card flat along `outline` amounts to."""
    dx, dy = (outline[1] - outline[0]).astype(float)
    # The card's top edge runs along this direction in the photo; flat, it runs left to right.
    along = round(float(np.degrees(np.arctan2(dy, dx))) / 90.0) % 4 * 90
    return (360 - along) % 360


def _inset(outline: np.ndarray, share: float) -> np.ndarray:
    """`outline` pulled in by `share` of the card's size on every side."""
    centre = outline.mean(axis=0)
    return (centre + (1.0 - 2.0 * share) * (outline - centre)).astype(np.float32)


def _cap_size(image: np.ndarray, long_side: int) -> np.ndarray:
    """`image` shrunk so its longest side is at most `long_side` (see `READ_LONG_SIDE`)."""
    scale = long_side / max(image.shape[:2])
    if scale >= 1.0:
        return image
    return cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)


def _allowed_turns(outline: np.ndarray | None, flat: bool) -> tuple[int, ...] | None:
    """The turns the card's outline leaves possible, or None (no outline: anything goes)."""
    if outline is None:
        return None
    if flat:
        return (0, 180)
    dx, dy = np.abs(outline[1] - outline[0])
    return (0, 180) if dx >= dy else (90, 270)


def _weak(side: str, result: SideResult) -> bool:
    """A field this side carries came back missing."""
    return any(not result.fields.get(name, {}).get("value") for name in SIDE_FIELDS.get(side, ()))


def _fill_from_flat(
    photo: np.ndarray,
    outline: np.ndarray,
    side: str,
    result: SideResult,
    recognizer: Recognizer,
    timings: StageTimings,
    trace: Trace,
) -> list[str]:
    """Read the card again, cut out and laid flat, for the fields the first read missed."""
    flat, zoom = _flat_for_reading(photo, outline)
    if zoom <= 1.0:
        flat = _cap_size(flat, READ_LONG_SIDE)
    flat, _ = upright(flat, recognizer, turns=(0, 180), side=side, card_only=True)
    second = _process_side(flat, side, recognizer, timings, trace, framed=True)
    taken = []
    for name in SIDE_FIELDS.get(side, ()):
        mine, theirs = result.fields.get(name), second.fields.get(name)
        if not theirs or not theirs.get("value"):
            continue
        mine_rank = _RANK.get(mine.get("confidence"), -1) if mine and mine.get("value") else -1
        if mine_rank <= 0 and _RANK.get(theirs.get("confidence"), 0) > mine_rank:
            result.fields[name] = theirs
            if name == "nationalId":
                result.nid_candidates = list(second.nid_candidates)
            taken.append(name)
    return taken


def _outline(photo: np.ndarray, side: str = "") -> np.ndarray | None:
    """The card's corners on its own edges, labelled along its long side (TL, TR, BR, BL)."""
    try:
        outline = find_card_outline(photo, side=side)
    except Exception:  # noqa: BLE001 - finding the card is an improvement, never a reason to fail
        return None
    return None if outline is None else orient_landscape(outline)


def _lay_flat(
    photo: np.ndarray,
    outline: np.ndarray,
    *,
    zoom: float = 1.0,
    margin: float = 0.0,
    max_width: int | None = None,
) -> tuple[np.ndarray, float]:
    """The card cut out along `outline` and laid flat at ID-1 proportions. → (card, zoom used)."""
    across = float(np.linalg.norm(outline[1] - outline[0]) + np.linalg.norm(outline[2] - outline[3])) / 2
    width = round(across * zoom)
    if max_width is not None and width > max_width:
        width, zoom = max_width, max_width / across
    height = round(width / ID1_ASPECT)
    left, top = round(margin * width), round(margin * height)
    target = np.float32(
        [[left, top], [left + width, top], [left + width, top + height], [left, top + height]]
    )
    method = (
        cv2.INTER_AREA if zoom < 1.0
        else cv2.INTER_LANCZOS4 if zoom >= LANCZOS_FROM_ZOOM
        else cv2.INTER_CUBIC
    )
    card = cv2.warpPerspective(
        photo,
        cv2.getPerspectiveTransform(outline.astype(np.float32), target),
        (width + 2 * left, height + 2 * top),
        flags=method,
        borderMode=cv2.BORDER_REPLICATE,
    )
    return card, zoom


#: Photo kept around the card's outline when it is cut out as a box for reading, as a share of the
#: card's size.
CROP_MARGIN = 0.02


#: Any digit (Latin or Arabic-Indic) or Latin letter: never part of a name or an occupation.
_FOREIGN = re.compile(r"[0-9٠-٩A-Za-z]")


def _crop_to_outline(
    photo: np.ndarray, outline: np.ndarray, margin: float = CROP_MARGIN
) -> tuple[np.ndarray, float, tuple[float, float, float, float]]:
    """The photo cut to a box around the card's outline, enlarged if the card was far."""
    height, width = photo.shape[:2]
    left, top = float(outline[:, 0].min()), float(outline[:, 1].min())
    right, bottom = float(outline[:, 0].max()), float(outline[:, 1].max())
    card_width = max(right - left, bottom - top)
    pad = margin * card_width
    left, top = max(0, int(left - pad)), max(0, int(top - pad))
    right, bottom = min(width, int(right + pad)), min(height, int(bottom + pad))
    crop = photo[top:bottom, left:right]
    far = card_width < FAR_CARD_SHARE * max(width, height)
    zoom = min(MAX_CARD_ZOOM, max(1.0, CARD_TARGET_WIDTH / card_width)) if far else 1.0
    if zoom > 1.0:
        method = cv2.INTER_LANCZOS4 if zoom >= LANCZOS_FROM_ZOOM else cv2.INTER_CUBIC
        crop = cv2.resize(crop, (round(crop.shape[1] * zoom), round(crop.shape[0] * zoom)), interpolation=method)
    return crop, zoom, (left / width, top / height, right / width, bottom / height)


def _flat_for_reading(photo: np.ndarray, outline: np.ndarray) -> tuple[np.ndarray, float]:
    """The card laid flat for the reader, with a thin margin, enlarged when it was far away."""
    across = float(np.linalg.norm(outline[1] - outline[0]) + np.linalg.norm(outline[2] - outline[3])) / 2
    far = across < FAR_CARD_SHARE * max(photo.shape[:2])
    zoom = min(MAX_CARD_ZOOM, max(1.0, CARD_TARGET_WIDTH / across)) if far else 1.0
    return _lay_flat(photo, outline, zoom=zoom, margin=READ_MARGIN)


#: Width-to-height range that counts as the card itself (ID-1 is 1.586), allowing for perspective.
CARD_ASPECT_RANGE = (1.40, 1.80)


def _aspect(quad: np.ndarray) -> float:
    """Long side over short side of an ordered quad (TL, TR, BR, BL)."""
    top = float(np.linalg.norm(quad[1] - quad[0]))
    bottom = float(np.linalg.norm(quad[2] - quad[3]))
    left = float(np.linalg.norm(quad[3] - quad[0]))
    right = float(np.linalg.norm(quad[2] - quad[1]))
    across, down = (top + bottom) / 2, (left + right) / 2
    return max(across, down) / max(min(across, down), 1.0)


def _too_far_to_read(side: SideResult, zoom: float) -> bool:
    # Not by size alone: a sharp 160 px card (a screenshot, a good camera far away) still reads
    # once zoomed, while a blurred one twice that size may not.
    quality = side.quality
    return (
        quality is not None
        and quality.verdict == "reject"
        and side.filled() <= 1
        and all(data.get("confidence") == "low" for data in side.fields.values())
    )


def _detail_region(image: np.ndarray) -> np.ndarray | None:
    """Where a tiny card is, when the card locator cannot see it. → its corners, or None."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    edges = cv2.Canny(gray, 50, 150)
    if edges.mean() > 25:  # a busy scene: detail everywhere, nothing singles a card out
        return None
    blobs = cv2.dilate(edges, np.ones((15, 15), np.uint8))
    contours, _ = cv2.findContours(blobs, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    x, y, w, h = cv2.boundingRect(max(contours, key=cv2.contourArea))
    height, width = image.shape[:2]
    aspect = max(w, h) / max(min(w, h), 1)
    if not 1.2 <= aspect <= 2.1 or w * h > 0.4 * width * height or max(w, h) < 60:
        return None
    return np.array([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], dtype=np.float32)


def _judge_at_source_size(side: SideResult, zoom: float) -> None:
    """Re-run the quality gate on the card's size in the photo, not after it was enlarged."""
    rect = side.rectification
    side.quality = assess(replace(rect, card_width_px=rect.card_width_px / zoom))
    ceiling = side.quality.confidence_ceiling
    for data in side.fields.values():
        data["confidence"] = cap(data["confidence"], ceiling)


def _rotate_180(image: np.ndarray) -> np.ndarray:
    return cv2.rotate(image, cv2.ROTATE_180)


def _needs_retry(side: str, result: SideResult) -> bool:
    """Should this face be tried upside down?"""
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
    """Combine everything both sides read of the number into one answer."""
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
        # score, but not more than a structural failure, a number that cannot be a national ID is
        # still wrong when read twice.
        agreed["confidence"] = "high" if front.get("valid") else "low"
        if front.get("repaired") or back.get("repaired"):
            # Agreement between two repairs is agreement between two deductions, not two reads.
            agreed["confidence"] = cap(agreed["confidence"], "medium")
        agreed["agreement"] = "both-sides"
        return agreed

    borrowed = _borrowed_disagreement(sides, front, back)
    if borrowed is not None:
        return borrowed

    if front.get("valid") != back.get("valid"):
        chosen = dict(front if front.get("valid") else back)
        chosen["confidence"] = cap(chosen["confidence"], "medium")
        chosen["agreement"] = "one-side-invalid"
        return chosen

    # Two different numbers, both of which could be real.
    return _vote_across_sides(sides, front)


#: A direct read this confident or more can witness the other side's number.
WITNESS_SCORE = 0.8


def _fits_loosely(digits: str, value: str) -> bool:
    """`digits` fits inside `value`, allowing one stray digit at either edge of the read."""
    if fits_inside(digits, value):
        return True
    return len(digits) > MIN_BACKING_DIGITS and (
        fits_inside(digits[1:], value) or fits_inside(digits[:-1], value)
    )


def _borrowed_disagreement(
    sides: dict[str, SideResult], front: dict[str, Any], back: dict[str, Any]
) -> dict[str, Any] | None:
    """The two sides agreeing, under a disagreement made only of digits borrowed from beside a row.
    """
    for mine, theirs, my_side, their_side in (
        (front, back, "front", "back"),
        (back, front, "back", "front"),
    ):
        doubtful = theirs.get("widened") or not theirs.get("valid")
        if not doubtful or mine.get("widened") or not mine.get("valid"):
            continue
        # The number itself must have been read whole on its own side, by reads from several
        # filters: the other side only confirms the digits it saw.
        own = sides[my_side].nid_candidates
        if not any(c.digits == mine["value"] for c in own):
            continue
        if len(backers(own, mine["value"])) < CLEAR_WIN_SOURCES:
            continue
        # Confident direct reads only: the weak thresholded ones turn ٥ into ٠, and one did exactly
        # that into a match for the borrowed number.
        direct = [
            c
            for c in sides[their_side].nid_candidates
            if not c.variant.startswith("widened")
            and len(c.digits) >= MIN_BACKING_DIGITS
            and c.score >= WITNESS_SCORE
        ]
        total = sum(c.score for c in direct)
        fits_mine = sum(c.score for c in direct if _fits_loosely(c.digits, mine["value"]))
        # The doubtful number is judged strictly, and a number that cannot be an ID is no rival.
        fits_theirs = (
            sum(c.score for c in direct if fits_inside(c.digits, theirs["value"]))
            if theirs.get("valid")
            else 0.0
        )
        if direct and fits_mine >= fits_theirs and fits_mine >= 0.5 * total:
            agreed = dict(mine)
            agreed["confidence"] = "medium" if mine.get("repaired") else "high"
            agreed["agreement"] = "both-sides-direct"
            return agreed
    return None


#: How much more of the pooled reads must back the winner than its rival to settle a disagreement.
CROSS_SIDE_MARGIN = 1.5
#: ...and how much more for the settled number to keep the top band rather than 'medium', from at
#: least this many separate sources.
CLEAR_WIN_MARGIN = 3.0
CLEAR_WIN_SOURCES = 3


def _vote_across_sides(sides: dict[str, SideResult], fallback: dict[str, Any]) -> dict[str, Any]:
    """Resolve a front/back disagreement by pooling every reading of both crops into one vote."""
    pooled = [
        Candidate(
            variant=f"{side}:{candidate.variant}",
            digits=candidate.digits,
            score=candidate.score,
        )
        for side, result in sides.items()
        for candidate in result.nid_candidates
    ]
    settled = combine(pooled)

    disputed = dict(fallback)
    # A clear majority of the full reads, or of everything read once partial reads are counted
    # (see `ensemble.backing`): the sharp reads that lost a leading zero are most of the evidence.
    clear = settled is not None and (
        settled.support * 2 > settled.total or settled.margin >= CROSS_SIDE_MARGIN
    )
    if settled is not None and settled.valid and clear:
        disputed["value"] = settled.value
        disputed["score"] = settled.score
        disputed["valid"] = True
        disputed["reads"] = settled.total
        disputed["confidence"] = cap(band(settled.score), "medium")
        disputed["agreement"] = "cross-side-majority"
        if settled.margin >= CLEAR_WIN_MARGIN and settled.sources >= CLEAR_WIN_SOURCES:
            # Hardly a disagreement: backed by several separate filters (a sharp read that only
            # lost the dot-sized leading zero counts), and the evidence that tells it apart from
            # every rival backs it several times over.
            disputed["confidence"] = band(settled.score)
            disputed["agreement"] = "cross-side-consistent"
        return disputed

    disputed["confidence"] = "low"
    disputed["agreement"] = "conflict"
    return disputed


def _kind_of(photo: np.ndarray, outline: np.ndarray | None) -> str | None:
    """Which side of the card this photo shows, by what is printed on it: 'front', 'back' or None.

    The front has the holder's portrait; the back has a barcode across most of its width. Neither
    needs the text read, so a photo can be put in its right place before anything is read.
    """
    crop = _crop_to_outline(photo, outline)[0] if outline is not None else photo
    try:
        if face_turn(crop) is not None:
            return "front"
        if looks_like_back(crop):
            return "back"
    except Exception:  # noqa: BLE001 - a check on the side is evidence, never a reason to fail
        pass
    return None


def _assign_sides(kinds: dict[str, str | None]) -> dict[str, str]:
    """Which side each submitted photo really is. → {slot it was sent in: the side it shows}.

    A photo sent as the front that shows the back (and the other way round) is read as what it is.
    With two photos the swap needs more evidence for it than against it: a photo no check could
    place says nothing.
    """
    slots = list(kinds)
    if len(slots) == 2:
        swapped = (kinds["front"] == "back") + (kinds["back"] == "front")
        straight = (kinds["front"] == "front") + (kinds["back"] == "back")
        if swapped > straight:
            return {"front": "back", "back": "front"}
    elif len(slots) == 1 and kinds[slots[0]] in ("front", "back"):
        return {slots[0]: kinds[slots[0]]}
    return {slot: slot for slot in slots}


def extract(
    front_path: str | None,
    back_path: str | None,
    recognizer: Recognizer,
    trace: Trace = NO_TRACE,
) -> ExtractionResult:
    """Run the pipeline over one card. Either side may be absent."""
    result = ExtractionResult()
    started_all = time.perf_counter()

    sides: dict[str, SideResult] = {}
    photos = {
        side: load_bgr(path)
        for path, side in ((front_path, "front"), (back_path, "back"))
        if path is not None
    }
    # Finding each card's outline is OpenCV work that runs beside the reading: the back's is ready
    # by the time the front has been read, instead of adding its second or so after it.
    outlines_pool = ThreadPoolExecutor(max_workers=2)
    pending = {side: outlines_pool.submit(_outline, photo, side) for side, photo in photos.items()}
    outlines_pool.shutdown(wait=False)
    outlines = {side: future.result() for side, future in pending.items()}

    # Put each photo where it belongs: someone will send the back as the front, or the front twice.
    kinds = {slot: _kind_of(photo, outlines[slot]) for slot, photo in photos.items()}
    for slot, photo in photos.items():
        if kinds[slot] is None and slot == "back":
            # Not found by its outline: a front the card finder lost is found by its face.
            kinds[slot] = _kind_of(photo, _outline(photo, "front"))
    if len(photos) == 2 and kinds["front"] == kinds["back"] and kinds["front"] is not None:
        # Both photos show the same side. The one sent in its own box is read; the other would only
        # be read as a side it is not, and came back as a few fields of noise.
        same = kinds["front"]
        ignored = "back" if same == "front" else "front"
        result.diagnostics["sameSide"] = same
        result.diagnostics["ignoredPhoto"] = ignored
        for table in (photos, outlines, kinds):
            del table[ignored]
    assigned = _assign_sides(kinds)
    if any(slot != side for slot, side in assigned.items()):
        result.diagnostics["sidesSwapped"] = True
        result.diagnostics["submittedAs"] = {side: slot for slot, side in assigned.items()}
        photos = {assigned[slot]: photo for slot, photo in photos.items()}
        outlines = {assigned[slot]: _outline(photos[assigned[slot]], assigned[slot]) for slot in assigned}
    for side, photo in photos.items():
        notes = result.diagnostics.setdefault(side, {})
        outline = outlines[side]
        if outline is not None and READ_FLAT_CARD:
            # Cut out along its own edges, laid flat, enlarged if far: the reader sees the card and
            # nothing else, and the card is landscape, so it is upright or upside down, never on
            # its side (see `upright`).
            image, zoom = _flat_for_reading(photo, outline)
            notes["croppedToCard"] = True
            if zoom > 1.0:
                notes["zoomedToCard"] = round(zoom, 2)
        elif outline is not None:
            # Cut to the card's own outline, as a plain box with a margin: everything printed
            # beside the card, a keyboard's letters were read as rows of the back, and its '6 ٦'
            # key landed in the occupation, is gone, and the card's pixels are not resampled.
            image, zoom, box = _crop_to_outline(photo, outline)
            notes["croppedToCard"] = True
            notes["cardBox"] = [round(value, 4) for value in box]
            if zoom > 1.0:
                notes["zoomedToCard"] = round(zoom, 2)
        else:
            image, zoom, box, _ = _zoom_to_card(photo, recognizer)
            if zoom:
                notes["croppedToCard"] = True
                # Where the card was cut from, as fractions of the photo: geometry, never content.
                notes["cardBox"] = [round(value, 4) for value in box]
                if zoom > 1.0:
                    notes["zoomedToCard"] = round(zoom, 2)
        if zoom <= 1.0:
            image = _cap_size(image, READ_LONG_SIDE)
            if max(image.shape[:2]) < SMALL_CARD_SIDE:
                # At this size each letter is only a few pixels: a short first name on its own row
                # was missed entirely on a 465 px photo.
                zoom = SMALL_CARD_TARGET / max(image.shape[:2])
                image = cv2.resize(image, None, fx=zoom, fy=zoom, interpolation=cv2.INTER_CUBIC)
                notes["zoomedToCard"] = round(zoom, 2)
        image, turned = upright(
            image, recognizer, turns=_allowed_turns(outline, READ_FLAT_CARD), side=side,
            card_only=bool(notes.get("croppedToCard")),
        )
        # The face or the barcode, seen standing upright after the turn, settles which way up the
        # card is: the 180 retry below is then not a second opinion but a way to be talked out of a
        # right answer by a confident misread of the inverted card.
        settled_by_layout = bool(notes.get("croppedToCard")) and layout_turn(image, side) == 0
        if settled_by_layout:
            notes["orientedBy"] = "layout"
        if turned:
            result.diagnostics.setdefault(side, {})["rotated"] = turned
            trace.image(f"{side} / turned upright ({turned} degrees)", image)
        framed = bool(notes.get("croppedToCard")) and outline is not None
        side_result = _process_side(image, side, recognizer, result.timings, trace, framed=framed)
        if not settled_by_layout and _needs_retry(side, side_result):
            inverted = _process_side(
                _rotate_180(image), side, recognizer, result.timings, trace, framed=framed
            )
            chosen = _better(side_result, inverted)
            if chosen is inverted:
                result.diagnostics.setdefault(side, {})["rotated180"] = True
                image = _rotate_180(image)
            side_result = chosen
        if outline is not None and not READ_FLAT_CARD and _weak(side, side_result):
            filled = _fill_from_flat(photo, outline, side, side_result, recognizer, result.timings, trace)
            if filled:
                notes["filledFromFlatCard"] = filled
        if zoom and side_result.quality is not None and side_result.rectification is not None:
            _judge_at_source_size(side_result, zoom)
        if _too_far_to_read(side_result, zoom):
            # Nothing is returned rather than noise: see `_too_far_to_read`.
            side_result.fields = {}
            result.diagnostics.setdefault(side, {})["tooFarToRead"] = True
        sides[side] = side_result
        result.oriented[side] = image
        if outline is not None:
            # What is shown is the card cut along its edges, turned exactly as the reader turned it.
            height, width = photo.shape[:2]
            flat, _ = _lay_flat(photo, _inset(outline, SURFACE_INSET), max_width=SURFACE_MAX_WIDTH)
            total = (notes.get("rotated", 0) + (180 if notes.get("rotated180") else 0)) % 360
            # The flat card is not the photo: laying it landscape already turned a card that stood
            # on its side by a quarter. Only the rest of the reader's turn is left to apply, or a
            # sideways photo, read the right way up, was shown on its side.
            shown = (total - _laid_turn(outline)) % 360
            result.oriented[side] = turn(flat, shown) if shown else flat
            notes["cardCorners"] = [
                [round(float(x) / width, 4), round(float(y) / height, 4)] for x, y in outline
            ]

    checks: dict[str, str] = {}
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
        # How much the boxes had to work with.
        notes["linesDetected"] = len(side_result.lines)
        if len(side_result.row_passes) > 1:
            notes["readPasses"] = side_result.row_passes
        if side_result.detection_failed:
            notes["detectionFailed"] = True
        # How much the number was corroborated on this side, before the two sides are compared.
        number = side_result.fields.get("nationalId", {})
        for flag in ("birthDateAgrees", "birthDateMismatch"):
            if number.get(flag):
                notes[flag] = True
        if number.get("agreement"):
            notes["nationalIdReads"] = number.get("reads", 0)
            notes["nationalIdAgreement"] = number["agreement"]
        if side == "back":
            # See `_looks_like_the_back`. Reported so "the front was sent twice" can be told apart
            # from a poor read.
            looks_right = _looks_like_the_back(side_result.lines)
            if looks_right is False:
                notes["sideMismatch"] = True
        elif _looks_like_the_back(side_result.lines):
            notes["sideMismatch"] = True  # the "front" has the words only a back has
        for name, data in side_result.fields.items():
            if name != "nationalId":
                result.fields[name] = data

        # Is this an Egyptian national ID at all, or another card? See `_side_verdict`.
        shown = result.oriented.get(side)
        number = side_result.fields.get("nationalId", {})
        evidence: dict[str, Any] = {
            "lines": len(side_result.lines),
            "readable": side_result.quality is not None and side_result.quality.verdict != "reject",
            "titleWords": 0, "validNumber": False, "portrait": False, "markerWords": 0, "barcode": False,
            "companyName": False, "faceFillsFrame": False,
        }
        try:
            evidence["companyName"] = any(_is_company(text) for _, text, _ in side_result.lines)
            if side == "front" and not evidence["companyName"] and shown is not None and len(side_result.lines) < MIN_LINES_FOR_NO * 3:
                # The logo's stylised letters are often not read as text; its picture is decisive.
                evidence["companyName"] = find_logo(shown) is not None
            if len(side_result.lines) <= FACE_MAX_LINES:
                evidence["faceFillsFrame"] = face_fills_frame(photos.get(side, shown)) if shown is not None else False
            if side == "front":
                evidence["titleWords"] = _title_hits(side_result.lines)
                evidence["validNumber"] = bool(number.get("valid"))
                evidence["portrait"] = shown is not None and face_turn(shown) is not None
            else:
                evidence["markerWords"] = _back_marker_hits(side_result.lines)
                evidence["barcode"] = shown is not None and looks_like_back(shown)
        except Exception:  # noqa: BLE001 - a check on the card is evidence, never a reason to fail
            pass
        checks[side] = _side_verdict(side, evidence)
        notes["cardEvidence"] = {key: (value if isinstance(value, bool) else int(value)) for key, value in evidence.items()}

    if checks:
        result.diagnostics["cardCheck"] = {"verdict": _card_verdict(checks), "sides": checks}

    reconciled = _reconcile_national_id(sides)
    if reconciled is not None:
        # Whatever the two sides agreed on, a capture the quality gate refused cannot hand back a
        # 'high' number. The caps are applied again here because promoting agreement to 'high'
        # (or a vote to 'medium') happens after each side's own cap.
        _apply_capture_ceilings(
            reconciled, [r.quality.confidence_ceiling for r in sides.values() if r.quality is not None]
        )
        result.fields["nationalId"] = reconciled

        # A "number" that is not even the length of one is a few digits of something else, a date,
        # a serial, a smudge, and handing it back as the number is the hallucination. Nothing is
        # returned, and the page says the number was not visible.
        if _not_a_number(reconciled):
            del result.fields["nationalId"]
            result.diagnostics["numberNotVisible"] = True

        back = sides.get("back")
        # Every read of the back: a sex word only the zoomed or enhanced read found still counts.
        printed = _printed_gender(_side_text_lines(back)) if back is not None else None
        if printed is not None:
            agrees = gender_agrees(reconciled["value"], printed)
            if agrees is False:
                # The number's parity digit and the word on the card disagree.
                reconciled["confidence"] = "low"
                result.diagnostics.setdefault("back", {})["genderMismatch"] = True

    # Religion and marital status in the holder's grammatical gender (a dropped ة made a woman's
    # card read متزوج). See postprocess.agree_with_sex.
    back = sides.get("back")
    printed = _printed_gender(_side_text_lines(back)) if back is not None else None
    agree_with_sex(result.fields, _holder_is_female(printed, result.fields.get("nationalId")))

    failed = cross_check(result.fields, back.issue_year if back is not None else None)
    if failed:
        result.diagnostics["crossChecksFailed"] = failed

    trace.data("result / fields", result.fields)
    trace.data("result / diagnostics", result.diagnostics)
    trace.data("result / payload sent to the API", result.as_raw_ocr_result())

    result.total_ms = (time.perf_counter() - started_all) * 1000.0
    return result


def _draw_boxes(card: np.ndarray, anchoring: Anchoring) -> np.ndarray:
    """The card with every field box drawn on it, labelled by where the box came from."""
    canvas = card.copy()
    for name, box in anchoring.boxes.items():
        source = anchoring.sources.get(name, "nominal")
        colour = (80, 200, 80) if source == "snapped" else (60, 170, 240)
        left, top, right, bottom = box.to_pixels((canvas.shape[1], canvas.shape[0]))
        cv2.rectangle(canvas, (left, top), (right, bottom), colour, 2)
        cv2.putText(
            canvas,
            f"{name}:{source}",
            (left + 4, max(14, top - 6)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            colour,
            1,
            cv2.LINE_AA,
        )
    return canvas


# ── The company badge ────────────────────────────────────────────────────────────────────────────

#: Where the badge's photograph's centre may be on the upright badge: at the left, anywhere down it.
BADGE_PHOTO_X = (0.03, 0.5)
BADGE_PHOTO_Y = (0.1, 0.92)
#: How much of the photo around the badge's outline goes into the read, as a share of its size.
BADGE_CROP_MARGIN = 0.12


def extract_badge(
    photo_path: str, recognizer: Recognizer, trace: Trace = NO_TRACE
) -> ExtractionResult:
    """Read an EGY CASH employee badge: company, name, job position, employee code, national ID.

    The same chain as a national ID card: find the badge in the photo, cut it out, turn it upright
    (by its photograph, at the left), read every line. Then `badge.read_badge_lines` says which
    line is which from what each says, and the number fields are read again, filter by filter,
    like the national ID's.
    """
    result = ExtractionResult()
    started_all = time.perf_counter()
    photo = load_bgr(photo_path)
    notes = result.diagnostics.setdefault("front", {})

    # No national-ID face anchors ("back" turns them off): they place a card by where the national
    # ID's portrait is, and the badge's is elsewhere.
    outline = _outline(photo, "back")
    if outline is not None:
        # A wide margin: a badge's coloured header can be the colour of what it lies on, and then
        # the outline stops below it; the header (the company's name) is within this margin.
        image, zoom, box = _crop_to_outline(photo, outline, margin=BADGE_CROP_MARGIN)
        notes["croppedToCard"] = True
        notes["cardBox"] = [round(value, 4) for value in box]
    else:
        image, zoom, box, _ = _zoom_to_card(photo, recognizer)
        if zoom:
            notes["croppedToCard"] = True
            notes["cardBox"] = [round(value, 4) for value in box]
    if zoom <= 1.0:
        image = _cap_size(image, READ_LONG_SIDE)
        if max(image.shape[:2]) < SMALL_CARD_SIDE:
            image = cv2.resize(
                image, None, fx=SMALL_CARD_TARGET / max(image.shape[:2]),
                fy=SMALL_CARD_TARGET / max(image.shape[:2]), interpolation=cv2.INTER_CUBIC,
            )
    elif zoom > 1.0:
        notes["zoomedToCard"] = round(zoom, 2)

    # Upright: the photograph is at the left. Failing that, the text's own reading of the badge.
    try:
        degrees = face_turn(image, x_range=BADGE_PHOTO_X, y_range=BADGE_PHOTO_Y)
    except Exception:  # noqa: BLE001 - a check on the badge is evidence, never a reason to fail
        degrees = None
    if degrees is not None:
        image = turn(image, degrees)
        if degrees:
            notes["rotated"] = degrees
        notes["orientedBy"] = "photo"
    else:
        image, turned = upright(image, recognizer)
        if turned:
            notes["rotated"] = turned

    framed = bool(notes.get("croppedToCard")) and outline is not None
    prepared = prepare(image, result.timings, side="front", framed=framed)
    result.quality["front"] = prepared.quality
    notes["quality"] = prepared.quality.verdict

    def lines_of(picture: np.ndarray) -> list[dict[str, Any]]:
        read = getattr(recognizer, "read_page", None) or recognizer.detect_lines
        try:
            found = list(read(picture))
        except Exception:  # noqa: BLE001
            LOG.warning("badge: reading the page failed", exc_info=True)
            return []
        from .document import _bounds  # noqa: PLC0415

        return [
            {"text": text.strip(), "score": float(score), "box": _bounds(poly)}
            for poly, text, score in found
            if text and text.strip()
        ]

    started = time.perf_counter()
    lines = lines_of(image)
    badge = read_badge_lines(lines)
    if not badge.company_found:
        # A company's name is often white on a coloured band, which the reader, made for dark print,
        # skips: the top of the badge is read again with its colours reversed.
        band_height = int(0.3 * image.shape[0])
        top = image[:band_height]
        extra = lines_of(cv2.bitwise_not(top))
        def overlaps(a: dict[str, Any], b: dict[str, Any]) -> bool:
            left, top = max(a["box"][0], b["box"][0]), max(a["box"][1], b["box"][1])
            right, bottom = min(a["box"][2], b["box"][2]), min(a["box"][3], b["box"][3])
            shared = max(0.0, right - left) * max(0.0, bottom - top)
            smaller = min((a["box"][2] - a["box"][0]) * (a["box"][3] - a["box"][1]),
                          (b["box"][2] - b["box"][0]) * (b["box"][3] - b["box"][1]))
            return smaller > 0 and shared / smaller > 0.3

        added = [line for line in extra if not any(overlaps(line, known) for known in lines)]
        if added:
            lines = lines + added
            badge = read_badge_lines(lines)
            notes["companyFromInvertedBand"] = badge.company_found
    if not badge.company_found:
        # The logo's letters are stylised and its wording is often not read: look for the picture.
        try:
            logo = find_logo(image)
        except Exception:  # noqa: BLE001 - a witness, never a reason to fail
            logo = None
        if logo is not None:
            strength, logo_box = logo
            badge.company_found = True
            badge.fields["companyName"] = (COMPANY_VALUE, min(0.95, 0.5 + strength / 2), logo_box)
            notes["companyBy"] = "logo"
    if degrees is None and len(badge.fields) < 2:
        # Upright by text only, and little came of it: the other way up, if it reads better.
        flipped = _rotate_180(image)
        flipped_lines = lines_of(flipped)
        other = read_badge_lines(flipped_lines)
        if len(other.fields) > len(badge.fields):
            image, badge, lines = flipped, other, flipped_lines
            notes["rotated180"] = True
    result.timings.record("front:badge", started)
    notes["linesDetected"] = len(lines)
    result.oriented["front"] = image

    height, width = image.shape[:2]

    def field_box(name: str) -> FieldBox:
        left, top, right, bottom = badge.fields[name][2]
        return FieldBox(
            name=name, x=left / width, y=top / height, w=(right - left) / width, h=(bottom - top) / height,
            kind="digits",
        )

    # The national ID number: read again under the filters, like the card's own (see `_row_field`).
    number = None
    if "nationalId" in badge.fields:
        raw, score, bounds = badge.fields["nationalId"]
        number = _row_field(image, "nationalId", raw, score, bounds, recognizer, SideResult(), trace, "front")
        number["confidence"] = cap(number["confidence"], prepared.quality.confidence_ceiling)

    for name in ("companyName", "fullNameAr", "jobTitle"):
        if name not in badge.fields:
            continue
        raw, score, _ = badge.fields[name]
        data = _finalize("fullNameAr" if name == "fullNameAr" else "occupation", raw, score)
        data["confidence"] = cap(data["confidence"], prepared.quality.confidence_ceiling)
        if name == "companyName":
            data["confidence"] = cap(band(max(score, 0.75) if badge.company_found else score), "high")
        result.fields[name] = data

    code_valid = False
    if "employeeCode" in badge.fields:
        raw, score, bounds = badge.fields["employeeCode"]
        digits, code_valid = clean_employee_code(raw)
        if not code_valid:
            # Read the digits again with the filters; a digit the first read lost may be there.
            reread = _read_digits(image, field_box("employeeCode"), recognizer, ensemble=False)
            again, again_valid = clean_employee_code(reread.text)
            if again_valid or len(again) > len(digits):
                digits, code_valid, score = again, again_valid, reread.score
        if not code_valid:
            # The detector can cut the row short (the label and two of seven digits): read the row
            # again, widened to where the national ID number's row starts. See `widen_code_box`.
            national = badge.fields.get("nationalId")
            # The code's own line: the rightmost line with digits inside the field's box (that box
            # can span other lines of the row, such as a signature's caption).
            inside = [
                line for line in lines
                if any(ch.isdigit() for ch in to_western_digits(line["text"]))
                and line["box"][0] >= bounds[0] - 1 and line["box"][2] <= bounds[2] + 1
                and line["box"][1] < bounds[3] and line["box"][3] > bounds[1]
            ]
            own = max(inside, key=lambda line: line["box"][2])["box"] if inside else bounds
            wide = widen_code_box(
                tuple(own), national[2] if national else None, width,
                neighbours=[tuple(line["box"]) for line in lines if tuple(line["box"]) != tuple(own)],
            )
            left, top, right, bottom = wide
            strip = FieldBox(name="employeeCode", x=left / width, y=top / height, w=(right - left) / width,
                             h=(bottom - top) / height, kind="digits")
            # Every filter: the code's zeros are printed as Arabic zeros, small dots one pass drops.
            reread = _read_digits(image, strip, recognizer, ensemble=True)
            again, again_valid = clean_employee_code(reread.text)
            if again_valid:
                digits, code_valid, score = again, again_valid, reread.score
        result.fields["employeeCode"] = {
            "value": digits,
            "confidence": cap(band(score, structurally_valid=code_valid), prepared.quality.confidence_ceiling),
            "raw": raw,
            "score": score,
            "valid": code_valid,
        }
    if number is not None:
        result.fields["nationalId"] = number

    national_valid = bool(number and number.get("valid"))
    verdict = badge_verdict(badge.company_found, code_valid, national_valid)
    result.diagnostics["badgeCheck"] = {
        "verdict": verdict,
        "companyFound": badge.company_found,
        "employeeCodeValid": code_valid,
        "nationalIdValid": national_valid,
        "labelled": sorted(badge.labelled),
        # The national ID card's title words: a card that prints them is the other reader's document.
        "nationalIdTitleWords": _title_hits([(None, line["text"], line["score"]) for line in lines]),
        "faceFillsFrame": len(lines) <= FACE_MAX_LINES and face_fills_frame(photo),
    }
    trace.data("badge / result", {k: {kk: vv for kk, vv in v.items() if kk != "score"} for k, v in result.fields.items()})
    result.total_ms = (time.perf_counter() - started_all) * 1000.0
    return result
