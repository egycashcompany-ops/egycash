"""Field geometry of the Egyptian national ID card.

WHY field-based rather than full-page OCR: the card is an ID-1 credential with fixed print
geometry. Once the photo is rectified to a canonical size, every field sits in the same place on
every card. Cropping to a known box and recognizing that crop alone beats OCRing the whole card in
three separate ways:

  1. Accuracy — the recognizer sees one line of one script instead of a page mixing Arabic text,
     Indic digits, a photograph and decorative guilloche.
  2. Attribution — a full-page pass returns a bag of strings that then has to be *guessed* back
     onto fields by position or regex. Cropping removes the guess entirely.
  3. Per-field confidence — `OcrFieldDto` requires a confidence band per field. That is natural
     when each field is its own inference and awkward when it is a slice of one big result.

Boxes are NORMALIZED (fractions of card width/height), so they survive any rendering resolution
and any future change to `CANONICAL_SIZE`.

CALIBRATION NOTE — read before trusting these numbers. The boxes below are calibrated against the
synthetic fixtures this spike generates. Real Egyptian cards will differ, and the boxes are
expected to need one calibration pass against real anonymized samples. `tools/calibrate.py`
prints an overlay so the adjustment is a five-minute visual task, not guesswork. This is exactly
the kind of thing the spike exists to discover, so treat these as a starting point.
"""

from __future__ import annotations

from dataclasses import dataclass

# ID-1 credential ratio (85.6 × 54 mm ≈ 1.585). ~12 px/mm gives a crop tall enough for the
# recognizer's 48 px input height without upscaling artefacts.
CANONICAL_SIZE = (1024, 646)  # (width, height) in px


@dataclass(frozen=True)
class FieldBox:
    """A named region, as fractions of the rectified card."""

    name: str
    x: float
    y: float
    w: float
    h: float
    #: Recognition hint. 'digits' fields are folded to ASCII and stripped of non-digits;
    #: 'text' fields keep their Arabic orthography.
    kind: str = "text"

    def to_pixels(self, size: tuple[int, int] = CANONICAL_SIZE) -> tuple[int, int, int, int]:
        """(left, top, right, bottom) in pixels, clamped to the image."""
        width, height = size
        left = max(0, int(self.x * width))
        top = max(0, int(self.y * height))
        right = min(width, int((self.x + self.w) * width))
        bottom = min(height, int((self.y + self.h) * height))
        return left, top, right, bottom


# ── Front ────────────────────────────────────────────────────────────────────
# Layout: photo on the reading start side; name on two lines (given name, then the father/
# grandfather/family chain); address on two lines; the 14-digit number along the bottom.
FRONT_FIELDS: tuple[FieldBox, ...] = (
    FieldBox("fullNameAr", x=0.34, y=0.20, w=0.62, h=0.20),
    FieldBox("address", x=0.34, y=0.42, w=0.62, h=0.22),
    FieldBox("nationalId", x=0.34, y=0.72, w=0.62, h=0.14, kind="digits"),
)

# ── Back ─────────────────────────────────────────────────────────────────────
# Layout: occupation (may wrap to two lines), then a row carrying gender / religion / marital
# status, then the expiry line. Gender is intentionally absent from the extracted set — it is
# derived from the number, so reading it here would create a second, weaker source for a value
# the contract already computes deterministically.
BACK_FIELDS: tuple[FieldBox, ...] = (
    FieldBox("occupation", x=0.06, y=0.14, w=0.72, h=0.22),
    FieldBox("religion", x=0.40, y=0.38, w=0.22, h=0.12),
    FieldBox("maritalStatus", x=0.06, y=0.38, w=0.30, h=0.12),
    FieldBox("nationalIdExpiry", x=0.06, y=0.54, w=0.72, h=0.12, kind="digits"),
)

ALL_FIELD_NAMES: tuple[str, ...] = tuple(
    box.name for box in (*FRONT_FIELDS, *BACK_FIELDS)
)
