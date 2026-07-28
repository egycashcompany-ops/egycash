"""Orchestration: two card images in, one `RawOcrResult`-shaped dict out.

The output shape is not incidental — it is deliberately the `RawOcrResult` interface from
`apps/api/src/modules/hr/recruitment/applicants/national-id-ocr.ts`, field for field. That is what
makes the eventual production step small: the provider becomes an HTTP call to this pipeline and a
direct hand-off, with no translation layer to get wrong.

Two things this module refuses to do, both on purpose:

* It never derives birth date, gender or governorate. Those come from `parseNationalId` in
  TypeScript. The seam's own header says so, and a second implementation would be a second
  source of truth for a value that must be identical everywhere.
* It never decides. Every field carries a confidence band and goes to a human in the review
  dialog. Nothing here is authoritative.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field as _field
from typing import Any

import numpy as np

from .engine import MockRecognizer, Recognizer
from .layout import BACK_FIELDS, FRONT_FIELDS, FieldBox
from .preprocess import StageTimings, load_bgr, prepare_card, prepare_field
from .postprocess import (
    band,
    clean_expiry,
    clean_marital_status,
    clean_national_id,
    clean_religion,
    clean_text,
)


@dataclass
class ExtractionResult:
    """Everything the harness needs: the values, plus how long each part took."""

    fields: dict[str, dict[str, Any]] = _field(default_factory=dict)
    timings: StageTimings = _field(default_factory=StageTimings)
    #: Per-side page preparation time, kept separate from per-field recognition.
    total_ms: float = 0.0

    def as_raw_ocr_result(self) -> dict[str, dict[str, str]]:
        """The `RawOcrResult` payload — only fields that produced a value."""
        return {
            name: {"value": data["value"], "confidence": data["confidence"]}
            for name, data in self.fields.items()
            if data["value"]
        }


def _recognize_box(
    card: np.ndarray, box: FieldBox, recognizer: Recognizer
) -> tuple[str, float]:
    left, top, right, bottom = box.to_pixels((card.shape[1], card.shape[0]))
    if right <= left or bottom <= top:
        return "", 0.0
    crop = prepare_field(card[top:bottom, left:right], box.kind)
    # The mock replays by field name; real recognizers only ever see pixels.
    if isinstance(recognizer, MockRecognizer):
        recognizer.bind(box.name)
    # The national ID and the expiry are numbers: their spaced groups read left to right even
    # on an otherwise right-to-left card. Ordering them as Arabic would reverse the value
    # while keeping every digit correct — a failure that looks entirely plausible.
    out = recognizer.recognize(crop, rtl=box.kind != "digits")
    return out.text, out.score


def _finalize(name: str, raw: str, score: float) -> dict[str, Any]:
    """Apply the field's cleanup and decide its confidence band."""
    if name == "nationalId":
        value, valid = clean_national_id(raw)
        return {"value": value, "confidence": band(score, structurally_valid=valid), "raw": raw}
    if name == "nationalIdExpiry":
        value, parsed = clean_expiry(raw)
        return {"value": value, "confidence": band(score, structurally_valid=parsed), "raw": raw}
    if name == "religion":
        value, snapped = clean_religion(raw)
        # A snap is corroboration, not proof — it can lift a borderline read to 'medium' but
        # never to 'high', which stays reserved for the model being confident on its own.
        return {
            "value": value,
            "confidence": band(max(score, 0.75) if snapped else score),
            "raw": raw,
        }
    if name == "maritalStatus":
        value, snapped = clean_marital_status(raw)
        return {
            "value": value,
            "confidence": band(max(score, 0.75) if snapped else score),
            "raw": raw,
        }
    return {"value": clean_text(raw), "confidence": band(score), "raw": raw}


def extract(
    front_path: str | None,
    back_path: str | None,
    recognizer: Recognizer,
) -> ExtractionResult:
    """Run the pipeline over one card. Either side may be absent."""
    result = ExtractionResult()
    started_all = time.perf_counter()

    for path, boxes, side in (
        (front_path, FRONT_FIELDS, "front"),
        (back_path, BACK_FIELDS, "back"),
    ):
        if path is None:
            continue
        card = prepare_card(load_bgr(path), result.timings)
        for box in boxes:
            started = time.perf_counter()
            raw, score = _recognize_box(card, box, recognizer)
            result.timings.record(f"recognize:{side}:{box.name}", started)
            result.fields[box.name] = _finalize(box.name, raw, score)

    result.total_ms = (time.perf_counter() - started_all) * 1000.0
    return result
