"""Local, offline National-ID OCR spike.

Stage-1 proof of concept answering one question: is a fully local OCR pipeline good enough for
Egyptian National ID cards? Nothing here is wired into the production API — the seam
(`NationalIdOcrProvider`) is untouched, and `parseNationalId` remains the single owner of every
number-derived field.

Import surface is kept small on purpose; `paddleocr` is imported lazily inside `PaddleRecognizer`
so that preprocessing, layout, scoring and the mock path all work without model weights.
"""

from .extract import ExtractionResult, extract
from .layout import ALL_FIELD_NAMES, BACK_FIELDS, CANONICAL_SIZE, FRONT_FIELDS
from .scoring import FieldAggregate, FieldScore, score_field

__all__ = [
    "ALL_FIELD_NAMES",
    "BACK_FIELDS",
    "CANONICAL_SIZE",
    "FRONT_FIELDS",
    "ExtractionResult",
    "FieldAggregate",
    "FieldScore",
    "extract",
    "score_field",
]
