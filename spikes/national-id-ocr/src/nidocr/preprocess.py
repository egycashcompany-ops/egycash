"""Image preprocessing — the stage that decides whether recognition has a chance.

Order matters and is not arbitrary:

  1. `rectify`      — find the card and warp it to a canonical rectangle. Everything downstream
                      (the whole field-box approach) depends on this; without it the crops land
                      on the wrong pixels and no amount of recognizer quality saves you.
  2. `deskew`       — residual rotation after rectification. Text recognizers are markedly worse
                      on lines that are even a few degrees off horizontal.
  3. `denoise`      — phone captures carry sensor noise that adaptive thresholding will happily
                      amplify into speckle that looks like diacritics.
  4. `enhance`      — CLAHE on the luminance channel only. Global histogram equalisation wrecks
                      cards with glare on one side; CLAHE is local, so a bright corner does not
                      drag the rest of the card down.
  5. `binarize`     — OPTIONAL and applied per field, not to the page. See `prepare_field`.

Every step is individually callable and individually timed, because when a real card fails the
first question is always "which stage lost it?" — and a monolithic `preprocess()` cannot answer.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import cv2
import numpy as np

from .layout import CANONICAL_SIZE


@dataclass
class StageTimings:
    """Wall-clock per stage, in milliseconds. Feeds the measurement harness directly."""

    stages: dict[str, float] = field(default_factory=dict)

    def record(self, name: str, started: float) -> None:
        self.stages[name] = (time.perf_counter() - started) * 1000.0

    @property
    def total_ms(self) -> float:
        return sum(self.stages.values())


def load_bgr(path: str) -> np.ndarray:
    """Read an image as BGR. Raises rather than returning None — a missing fixture is a bug."""
    image = cv2.imread(path, cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(f"could not read image: {path}")
    return image


def _order_quad(points: np.ndarray) -> np.ndarray:
    """Order 4 points as top-left, top-right, bottom-right, bottom-left.

    Uses coordinate sums/differences rather than angles: it is branch-free and stable when the
    card is photographed at an angle steep enough that "topmost point" stops meaning "top-left".
    """
    ordered = np.zeros((4, 2), dtype=np.float32)
    s = points.sum(axis=1)
    d = np.diff(points, axis=1).ravel()
    ordered[0] = points[np.argmin(s)]  # top-left  — smallest x+y
    ordered[2] = points[np.argmax(s)]  # bottom-right — largest x+y
    ordered[1] = points[np.argmin(d)]  # top-right — smallest y−x
    ordered[3] = points[np.argmax(d)]  # bottom-left — largest y−x
    return ordered


def find_card_quad(image: np.ndarray) -> np.ndarray | None:
    """The card's four corners, or None when no plausible quadrilateral is found.

    Returning None rather than a guess is deliberate: falling back to "use the whole frame" is
    correct when the caller already cropped to the card, and a wrong quad is far worse than none
    because it silently warps every field box off target.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, 40, 140)
    # Close small gaps so a card edge broken by glare still forms a single contour.
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    frame_area = image.shape[0] * image.shape[1]
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:8]:
        area = cv2.contourArea(contour)
        # A card that fills less than a fifth of the frame is more likely a label or a shadow.
        if area < frame_area * 0.20:
            break
        approx = cv2.approxPolyDP(contour, 0.02 * cv2.arcLength(contour, True), True)
        if len(approx) == 4 and cv2.isContourConvex(approx):
            return _order_quad(approx.reshape(4, 2).astype(np.float32))
    return None


def rectify(image: np.ndarray, size: tuple[int, int] = CANONICAL_SIZE) -> np.ndarray:
    """Perspective-correct the card to the canonical rectangle.

    When no quad is found the frame is simply resized: many captures are already cropped to the
    card, and resizing keeps those working instead of failing them.
    """
    width, height = size
    quad = find_card_quad(image)
    if quad is None:
        return cv2.resize(image, (width, height), interpolation=cv2.INTER_CUBIC)

    target = np.array(
        [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype=np.float32
    )
    matrix = cv2.getPerspectiveTransform(quad, target)
    return cv2.warpPerspective(image, matrix, (width, height), flags=cv2.INTER_CUBIC)


def deskew(image: np.ndarray, *, max_angle: float = 15.0) -> np.ndarray:
    """Rotate out residual skew, estimated from the dominant text-line angle.

    `max_angle` guards against the pathological case where the estimator locks onto the card's
    border or the dense printed block and proposes a 40° rotation that ruins a fine image.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    inverted = cv2.bitwise_not(gray)
    _, mask = cv2.threshold(inverted, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    coords = cv2.findNonZero(mask)
    if coords is None:
        return image

    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle += 90
    elif angle > 45:
        angle -= 90
    if abs(angle) < 0.25 or abs(angle) > max_angle:
        return image  # already straight, or an implausible estimate — leave it alone

    height, width = image.shape[:2]
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), angle, 1.0)
    return cv2.warpAffine(
        image, matrix, (width, height), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
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


def prepare_card(image: np.ndarray, timings: StageTimings | None = None) -> np.ndarray:
    """The full page-level chain: rectify → deskew → denoise → enhance.

    Binarization is deliberately NOT here. It is destructive, and whether it helps depends on the
    field: it lifts the digit rows nicely and can hollow out Arabic text. So it is applied per
    field in `prepare_field`, where the decision can differ per box.
    """
    timings = timings or StageTimings()

    started = time.perf_counter()
    out = rectify(image)
    timings.record("rectify", started)

    started = time.perf_counter()
    out = deskew(out)
    timings.record("deskew", started)

    started = time.perf_counter()
    out = denoise(out)
    timings.record("denoise", started)

    started = time.perf_counter()
    out = enhance(out)
    timings.record("enhance", started)

    return out


def prepare_field(crop: np.ndarray, kind: str, *, upscale: int = 2) -> np.ndarray:
    """Per-field finishing: upscale, and binarize only where it is known to help.

    Upscaling matters more than it looks. PP-OCR recognition resizes its input to a fixed height;
    feeding it a 40 px-tall crop means it interpolates UP internally from an image that already
    lost detail. Doing the upscale here, with a good kernel, consistently beats letting the
    recognizer do it.
    """
    scaled = cv2.resize(crop, None, fx=upscale, fy=upscale, interpolation=cv2.INTER_CUBIC)
    # Digit rows are high-contrast and short — thresholding sharpens them. Arabic prose is left in
    # greyscale, where the recognizer's own normalization does better than a hard cut.
    return binarize(scaled) if kind == "digits" else scaled
