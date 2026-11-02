"""Image preprocessing, the stage that decides whether recognition has a chance."""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import cv2
import numpy as np

from .geometry import Rectification, locate_card
from .geometry import rectify as _rectify_card
from .layout import CANONICAL_SIZE
from .quality import GOOD_SHARPNESS, QualityReport, assess


@dataclass
class StageTimings:
    """Wall-clock per stage, in milliseconds. Feeds the measurement harness directly."""

    stages: dict[str, float] = field(default_factory=dict)

    def record(self, name: str, started: float) -> None:
        self.stages[name] = (time.perf_counter() - started) * 1000.0

    @property
    def total_ms(self) -> float:
        return sum(self.stages.values())


@dataclass(frozen=True)
class PreparedCard:
    """A card ready for cropping, plus the evidence for how much to trust what comes off it."""

    image: np.ndarray
    rectification: Rectification
    quality: QualityReport


def load_bgr(path: str) -> np.ndarray:
    """Read an image as BGR. Raises rather than returning None, a missing fixture is a bug."""
    image = cv2.imread(path, cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(f"could not read image: {path}")
    return image


def find_card_quad(image: np.ndarray) -> np.ndarray | None:
    """The card's four corners, or None when no plausible quadrilateral is found."""
    located = locate_card(image)
    return None if located is None else located[0]


def rectify(image: np.ndarray, size: tuple[int, int] = CANONICAL_SIZE) -> np.ndarray:
    """Perspective-correct and flatten the card to the canonical rectangle."""
    return _rectify_card(image, size).image


def deskew(image: np.ndarray, *, max_angle: float = 12.0, step: float = 0.25) -> np.ndarray:
    """Rotate out residual skew, estimated by maximizing horizontal projection contrast."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    scale = min(1.0, 480.0 / max(gray.shape))
    if scale < 1.0:
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    _, mask = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)

    height, width = mask.shape
    centre = (width / 2.0, height / 2.0)
    best_angle, best_energy = 0.0, -1.0
    for angle in np.arange(-max_angle, max_angle + step, step):
        matrix = cv2.getRotationMatrix2D(centre, float(angle), 1.0)
        rotated = cv2.warpAffine(mask, matrix, (width, height), flags=cv2.INTER_NEAREST)
        profile = rotated.sum(axis=1, dtype=np.float64)
        energy = float(np.sum(np.diff(profile) ** 2))
        if energy > best_energy:
            best_angle, best_energy = float(angle), energy

    if abs(best_angle) < step:
        return image  # already straight, do not pay a resample for nothing

    full_height, full_width = image.shape[:2]
    matrix = cv2.getRotationMatrix2D((full_width / 2.0, full_height / 2.0), best_angle, 1.0)
    return cv2.warpAffine(
        image,
        matrix,
        (full_width, full_height),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )


def denoise(image: np.ndarray) -> np.ndarray:
    """Edge-preserving denoise."""
    return cv2.bilateralFilter(image, d=7, sigmaColor=45, sigmaSpace=45)


def enhance(image: np.ndarray) -> np.ndarray:
    """CLAHE on L in LAB, local contrast, so glare on one corner does not flatten the rest."""
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    merged = cv2.merge((clahe.apply(l_channel), a_channel, b_channel))
    return cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)


def sharpen(image: np.ndarray, *, amount: float = 0.6) -> np.ndarray:
    """Unsharp mask, recovers stroke definition on a soft capture."""
    blurred = cv2.GaussianBlur(image, (0, 0), sigmaX=1.6)
    return cv2.addWeighted(image, 1.0 + amount, blurred, -amount, 0)


def prepare(
    image: np.ndarray, timings: StageTimings | None = None, *, side: str = "", framed: bool = False
) -> PreparedCard:
    """The full page-level chain, with the rectification and quality evidence kept."""
    timings = timings or StageTimings()
    prefix = f"{side}:" if side else ""

    started = time.perf_counter()
    rectification = _rectify_card(image, CANONICAL_SIZE, framed=framed)
    timings.record(f"{prefix}rectify", started)

    started = time.perf_counter()
    report = assess(rectification)
    timings.record(f"{prefix}quality", started)

    out = rectification.image

    started = time.perf_counter()
    out = deskew(out)
    timings.record(f"{prefix}deskew", started)

    started = time.perf_counter()
    out = denoise(out)
    timings.record(f"{prefix}denoise", started)

    started = time.perf_counter()
    out = enhance(out)
    timings.record(f"{prefix}enhance", started)

    if report.metrics.get("sharpness", GOOD_SHARPNESS) < GOOD_SHARPNESS:
        started = time.perf_counter()
        out = sharpen(out)
        timings.record(f"{prefix}sharpen", started)

    return PreparedCard(image=out, rectification=rectification, quality=report)


def prepare_card(image: np.ndarray, timings: StageTimings | None = None) -> np.ndarray:
    """The prepared card image alone, for callers that do not need the evidence."""
    return prepare(image, timings).image


def binarize(image: np.ndarray) -> np.ndarray:
    """Adaptive threshold to a 3-channel image (recognizers expect BGR)."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    binary = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, blockSize=25, C=11
    )
    return cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)


#: PP-OCR's recognition head resizes its input to a fixed 48 px height.
TARGET_FIELD_HEIGHT = 64


#: A row carrying at least this fraction of the crop's width in ink counts as part of a text line.
_INK_ROW = 0.006

#: Bands closer together than this fraction of the tallest band's height are one line.
_SAME_LINE_GAP = 0.15


#: Smallest local contrast, in grey levels, that counts as ink. Keeps a blank strip blank: with
#: nothing printed, Otsu would still split pure noise into "ink" and "paper".
_MIN_INK_CONTRAST = 25


def text_ink(gray: np.ndarray) -> np.ndarray:
    """1 where there is printed text, 0 elsewhere, text, not merely dark."""
    height = gray.shape[0]
    size = max(9, (height // 4) | 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (size, size))
    contrast = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel)
    threshold, _ = cv2.threshold(contrast, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    return (contrast > max(threshold, _MIN_INK_CONTRAST)).astype(np.uint8)


def split_text_lines(crop: np.ndarray, *, max_lines: int = 6) -> list[np.ndarray]:
    """Cut a field crop into one strip per printed line, by horizontal projection."""
    height, width = crop.shape[:2]
    if height < 8 or width < 8:
        return [crop]

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop
    ink = text_ink(gray)
    rows = ink.sum(axis=1) >= max(2.0, _INK_ROW * width)

    # Contiguous runs of inked rows, before any judgement about which runs belong together.
    runs: list[list[int]] = []
    for index, inked in enumerate(rows):
        if not inked:
            continue
        if runs and index - runs[-1][1] <= 1:
            runs[-1][1] = index
        else:
            runs.append([index, index])
    if not runs:
        return [crop]

    # Merge runs separated by less than a fraction of a line's height: what remains between them
    # is the gap under a descender or above a dot, not the gap between two printed lines.
    merge_gap = max(2, int(_SAME_LINE_GAP * max(bottom - top + 1 for top, bottom in runs)))
    bands: list[list[int]] = [list(runs[0])]
    for top, bottom in runs[1:]:
        if top - bands[-1][1] - 1 < merge_gap:
            bands[-1][1] = bottom
        else:
            bands.append([top, bottom])

    if len(bands) < 2 or len(bands) > max_lines:
        return [crop]

    # A band far thinner than its neighbours is a stray mark, not a line of print. It is joined to
    # the nearest band rather than dropped: the splitter may discard blank rows, never ink.
    tallest = max(bottom - top for top, bottom in bands)
    while len(bands) > 1:
        small = next(
            (i for i, (top, bottom) in enumerate(bands) if (bottom - top) < tallest * 0.35), None
        )
        if small is None:
            break
        gap_above = bands[small][0] - bands[small - 1][1] if small > 0 else None
        gap_below = bands[small + 1][0] - bands[small][1] if small < len(bands) - 1 else None
        if gap_below is None or (gap_above is not None and gap_above <= gap_below):
            bands[small - 1][1] = bands[small][1]
        else:
            bands[small + 1][0] = bands[small][0]
        del bands[small]
    if len(bands) < 2:
        return [crop]

    # Pad each strip by half the narrowest gap between lines, so rows below the ink bar (the faint
    # edge of a dot, the tail of a descender) still land in a strip without reaching the next line.
    gaps = [bands[i + 1][0] - bands[i][1] - 1 for i in range(len(bands) - 1)]
    pad = max(1, min(gaps) // 2)
    return [
        crop[max(0, top - pad) : min(height, bottom + pad + 1)]
        for top, bottom in bands
    ]


def trim_to_ink(strip: np.ndarray) -> np.ndarray:
    """Drop the blank card on either side of a line strip, keeping a margin of one line height."""
    height, width = strip.shape[:2]
    if height < 8 or width < 8:
        return strip
    gray = cv2.cvtColor(strip, cv2.COLOR_BGR2GRAY) if strip.ndim == 3 else strip
    ink = text_ink(gray)
    columns = np.flatnonzero(ink.sum(axis=0) >= 2)
    if columns.size == 0:
        return strip
    left = max(0, int(columns[0]) - height)
    right = min(width, int(columns[-1]) + height + 1)
    return strip[:, left:right]


def _upscaled(crop: np.ndarray, max_upscale: float) -> np.ndarray:
    """Bring a crop up to the recognizer's working height."""
    height = max(crop.shape[0], 1)
    scale = float(np.clip(TARGET_FIELD_HEIGHT / height, 1.0, max_upscale))
    if scale <= 1.0:
        return crop
    return cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)


def _otsu(image: np.ndarray) -> np.ndarray:
    """Global threshold. The opposite failure mode to the adaptive one, which is the point."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    return cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)


def _inverted(image: np.ndarray) -> np.ndarray:
    """Otsu, inverted. Rescues a crop whose polarity the threshold got backwards."""
    return cv2.bitwise_not(_otsu(image))


#: Preprocessing variants for a digits field, cheapest and most-often-right first.
DIGIT_VARIANTS: tuple[str, ...] = ("binary", "grey", "thick", "otsu", "clahe", "invert")


def _thick(image: np.ndarray) -> np.ndarray:
    """The ink grown by a few pixels, so the Arabic-Indic zero survives."""
    grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    size = max(2, round(grey.shape[0] / 30))
    thick = cv2.erode(grey, np.ones((size, size), np.uint8))
    return cv2.cvtColor(thick, cv2.COLOR_GRAY2BGR) if image.ndim == 3 else thick

_VARIANTS = {
    "grey": lambda image: image,
    "binary": binarize,
    "otsu": _otsu,
    "clahe": enhance,
    "invert": _inverted,
    "thick": _thick,
}

#: How much card to take around each variant's crop, as a fraction of the field box.
VARIANT_MARGIN: dict[str, float] = {
    "grey": 0.03,
    "binary": 0.03,
    "otsu": 0.10,
    "clahe": 0.10,
    "invert": 0.03,
    "thick": 0.06,
}

#: Prose fields get the margin and nothing else, see the first reason above.
TEXT_MARGIN = 0.03


def field_variant(crop: np.ndarray, variant: str, *, max_upscale: float = 4.0) -> np.ndarray:
    """One preprocessing variant of a field crop, upscaled to the recognizer's working height."""
    try:
        transform = _VARIANTS[variant]
    except KeyError:
        raise ValueError(f"unknown field variant: {variant}") from None
    return transform(_upscaled(crop, max_upscale))


def prepare_field(crop: np.ndarray, kind: str, *, max_upscale: float = 4.0) -> np.ndarray:
    """Per-field finishing: upscale to the recognizer's working height, and binarize where it helps.
    """
    return field_variant(crop, "binary" if kind == "digits" else "grey", max_upscale=max_upscale)
