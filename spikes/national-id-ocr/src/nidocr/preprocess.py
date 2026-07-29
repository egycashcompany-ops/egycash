"""Image preprocessing — the stage that decides whether recognition has a chance.

Order matters and is not arbitrary:

  1. `rectify`      — find the card and warp it flat. Lives in `geometry.py`, because locating a
                      card in a photograph turned out to be a whole problem rather than a step.
                      Everything downstream depends on it; without it the crops land on the wrong
                      pixels and no amount of recognizer quality saves you.
  2. `assess`       — decide whether the capture is worth reading at all, and record why not. See
                      `quality.py`. Runs here rather than later so a hopeless image costs one
                      measurement instead of a full recognition pass.
  3. `deskew`       — residual rotation after rectification. Text recognizers are markedly worse
                      on lines that are even a few degrees off horizontal.
  4. `denoise`      — phone captures carry sensor noise that adaptive thresholding will happily
                      amplify into speckle that looks like diacritics.
  5. `enhance`      — CLAHE on the luminance channel only. Global histogram equalisation wrecks
                      cards with glare on one side; CLAHE is local, so a bright corner does not
                      drag the rest of the card down.
  6. `sharpen`      — CONDITIONAL. Applied only to captures the quality gate called soft. Unsharp
                      masking a already-crisp scan manufactures halos around Arabic strokes, which
                      costs accuracy rather than adding it.
  7. `binarize`     — OPTIONAL and applied per field, not to the page. See `prepare_field`.

Every step is individually callable and individually timed, because when a real card fails the
first question is always "which stage lost it?" — and a monolithic `preprocess()` cannot answer.
"""

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
    """Read an image as BGR. Raises rather than returning None — a missing fixture is a bug."""
    image = cv2.imread(path, cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(f"could not read image: {path}")
    return image


def find_card_quad(image: np.ndarray) -> np.ndarray | None:
    """The card's four corners, or None when no plausible quadrilateral is found.

    Thin wrapper over `geometry.locate_card` for callers that only need the corners — `diagnose`
    uses it to report whether the card was located at all.
    """
    located = locate_card(image)
    return None if located is None else located[0]


def rectify(image: np.ndarray, size: tuple[int, int] = CANONICAL_SIZE) -> np.ndarray:
    """Perspective-correct and flatten the card to the canonical rectangle."""
    return _rectify_card(image, size).image


def deskew(image: np.ndarray, *, max_angle: float = 12.0, step: float = 0.25) -> np.ndarray:
    """Rotate out residual skew, estimated by maximizing horizontal projection contrast.

    The previous estimator took `minAreaRect` over every dark pixel. On a rectified card that
    fills the frame, the dominant dark shape is the card's own printed border and the photograph
    on the front — so it measured the border's angle, not the text's, and on a card whose text is
    skewed relative to its edges (a genuinely common print tolerance) it corrected nothing.

    Projection profiling measures the text directly. Rotate a small binarized copy through a range
    of angles; when the lines are horizontal, each text row lands in one histogram bin and the
    row-sum profile becomes spiky. Summing the squared differences between adjacent rows peaks at
    exactly that angle. It is the standard document-deskew method for the same reason it is used
    here: it keys on line structure, which is the thing being straightened.
    """
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
        return image  # already straight — do not pay a resample for nothing

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
    """Edge-preserving denoise.

    Bilateral rather than Gaussian: Arabic letterforms live or die by their strokes, and a plain
    blur that removes sensor noise also removes the gap between ب and ن.
    """
    return cv2.bilateralFilter(image, d=7, sigmaColor=45, sigmaSpace=45)


def enhance(image: np.ndarray) -> np.ndarray:
    """CLAHE on L in LAB — local contrast, so glare on one corner does not flatten the rest."""
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    merged = cv2.merge((clahe.apply(l_channel), a_channel, b_channel))
    return cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)


def sharpen(image: np.ndarray, *, amount: float = 0.6) -> np.ndarray:
    """Unsharp mask — recovers stroke definition on a soft capture.

    Deliberately mild and deliberately conditional. Arabic script is dense with thin connecting
    strokes and closely-spaced dots; oversharpening rings them into each other and turns ثـ into
    something no recognizer has a class for. Applied only where the quality gate measured the
    capture as soft, where the alternative is a read that fails anyway.
    """
    blurred = cv2.GaussianBlur(image, (0, 0), sigmaX=1.6)
    return cv2.addWeighted(image, 1.0 + amount, blurred, -amount, 0)


def prepare(
    image: np.ndarray, timings: StageTimings | None = None, *, side: str = ""
) -> PreparedCard:
    """The full page-level chain, with the rectification and quality evidence kept.

    Binarization is deliberately NOT here. It is destructive, and whether it helps depends on the
    field: it lifts the digit rows nicely and can hollow out Arabic text. So it is applied per
    field in `prepare_field`, where the decision can differ per box.
    """
    timings = timings or StageTimings()
    prefix = f"{side}:" if side else ""

    started = time.perf_counter()
    rectification = _rectify_card(image, CANONICAL_SIZE)
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
    """The prepared card image alone — for callers that do not need the evidence.

    Kept because `tools/calibrate.py` and `diagnose` want pixels and nothing else.
    """
    return prepare(image, timings).image


def binarize(image: np.ndarray) -> np.ndarray:
    """Adaptive threshold to a 3-channel image (recognizers expect BGR).

    Adaptive, not Otsu: the card's printed background shades across its width, and a single global
    threshold turns one end of a line into a solid block.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    binary = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, blockSize=25, C=11
    )
    return cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)


#: PP-OCR's recognition head resizes its input to a fixed 48 px height. Feeding it a crop shorter
#: than that means it interpolates up from an image that has already lost the detail, so the upscale
#: is done here, once, with a good kernel. Overshooting the target slightly is deliberate — a
#: little headroom beats landing just under it.
TARGET_FIELD_HEIGHT = 64


def _upscaled(crop: np.ndarray, max_upscale: float) -> np.ndarray:
    """Bring a crop up to the recognizer's working height.

    The scale factor is derived from the crop rather than fixed at 2x. A fixed factor is wrong at
    both ends: it leaves a short crop from a distant capture below the recognition input height,
    and it needlessly quadruples the pixels of a crop that was already tall enough, which costs
    latency on every single field of every single card.
    """
    height = max(crop.shape[0], 1)
    scale = float(np.clip(TARGET_FIELD_HEIGHT / height, 1.0, max_upscale))
    if scale <= 1.0:
        return crop
    return cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)


def _otsu(image: np.ndarray) -> np.ndarray:
    """Global threshold. The opposite failure mode to the adaptive one, which is the point.

    Adaptive thresholding fragments glyphs printed over the card's pyramid watermark, because the
    watermark moves the local mean. Otsu picks one cut for the whole crop, so it survives the
    watermark and instead fails where the crop's own illumination shades across it. Two ways of
    being wrong that do not coincide is exactly what an ensemble needs.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    return cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)


def _inverted(image: np.ndarray) -> np.ndarray:
    """Otsu, inverted. Rescues a crop whose polarity the threshold got backwards.

    A digit row sitting on a dark security tint, or a card photographed against strong backlight,
    binarizes to white glyphs on black — which a recognizer trained on printed documents reads far
    worse than the same image the right way round.
    """
    return cv2.bitwise_not(_otsu(image))


#: Preprocessing variants for a digits field, cheapest and most-often-right first.
#:
#: The order matters because reading stops early once enough of them agree, so the common case
#: costs the first two or three and only a contested field pays for all five. They are chosen to
#: FAIL DIFFERENTLY rather than to be individually best: an ensemble whose members make the same
#: mistake is one read wearing five hats, and the whole value here is that the variant which turns
#: ٢ into ٣ against the watermark is not the variant that loses a digit to a shadow.
DIGIT_VARIANTS: tuple[str, ...] = ("binary", "grey", "otsu", "clahe", "invert")

_VARIANTS = {
    "grey": lambda image: image,
    "binary": binarize,
    "otsu": _otsu,
    "clahe": enhance,
    "invert": _inverted,
}

#: How much card to take around each variant's crop, as a fraction of the field box.
#:
#: Two jobs, and the second is the reason these differ from one another rather than being one
#: constant. First, a glyph flush against the edge of an image is one a detector drops: the
#: probability map it thresholds needs background on both sides to close a contour, and the last
#: word of a right-aligned line is exactly what ends up against the border. Every crop therefore
#: carries a little card around its text.
#:
#: Second, changing the margin changes the SEGMENTATION, not just the pixels. Detection inside a
#: wider crop splits the row differently, so its errors are less correlated with the narrow crop's
#: than another colour transform on identical pixels would be. An ensemble is worth exactly as much
#: as its members' independence, and geometry is the cheapest independence available here.
VARIANT_MARGIN: dict[str, float] = {
    "grey": 0.03,
    "binary": 0.03,
    "otsu": 0.10,
    "clahe": 0.10,
    "invert": 0.03,
}

#: Prose fields get the margin and nothing else — see the first reason above.
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

    Digit rows are high-contrast and short — thresholding sharpens them. Arabic prose is left in
    greyscale, where the recognizer's own normalization does better than a hard cut.
    """
    return field_variant(crop, "binary" if kind == "digits" else "grey", max_upscale=max_upscale)
