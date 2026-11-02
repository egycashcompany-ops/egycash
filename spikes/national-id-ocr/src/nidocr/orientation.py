"""Turning a photo upright before anything else looks at it."""

from __future__ import annotations

from collections.abc import Callable

import cv2
import numpy as np

#: Clockwise turn applied to the photo → the OpenCV rotation that performs it.
_TURN = {
    90: cv2.ROTATE_90_CLOCKWISE,
    180: cv2.ROTATE_180,
    270: cv2.ROTATE_90_COUNTERCLOCKWISE,
}

#: Mean line confidence at or above which an upright-looking photo is accepted without reading it
#: the other way up. Upright synthetic cards read at 0.89-0.97; upside-down ones at 0.41-0.65.
CONFIDENT = 0.85

#: How much better the other angle must read to win. A turn is only worth making on clear
#: evidence: turning an upright photo loses everything, leaving a turned one gets the 180 retry.
MARGIN = 1.5

Lines = list[tuple[object, str, float]]


def turn(image: np.ndarray, degrees: int) -> np.ndarray:
    """Rotate clockwise by 0, 90, 180 or 270 degrees."""
    return image if degrees == 0 else cv2.rotate(image, _TURN[degrees])


def _evidence(lines: Lines) -> float:
    """How well a reading went: characters, weighted steeply by how confidently they were read."""
    return sum(score**4 * len(text.strip()) for _, text, score in lines)


def _mean_score(lines: Lines) -> float:
    return float(np.mean([score for _, _, score in lines])) if lines else 0.0


def _sideways(lines: Lines) -> bool:
    """Do the detected text boxes run vertically? Then the photo is lying on its side."""
    tall = wide = 0
    for poly, _, _ in lines:
        try:
            points = np.asarray(poly, dtype=float).reshape(-1, 2)
        except (TypeError, ValueError):
            continue
        width = float(points[:, 0].max() - points[:, 0].min())
        height = float(points[:, 1].max() - points[:, 1].min())
        if height > 1.5 * width:
            tall += 1
        elif width > 1.5 * height:
            wide += 1
    return tall > wide


# ── What the card itself says about which way is up ─────────────────────────────────────────────
# Text is a poor witness on this card: its digits read almost as well upside down (١ ٠ ٨ ٧ are
# symmetric or mirror one another), half the back is barcode, and a confident wrong read beat the
# MARGIN often enough that a photo was turned the wrong way, or not at all. The card's layout is a
# far better witness, and needs no model: the front carries a face, which a frontal-face detector
# only finds the right way up, and the back carries a PDF417 barcode along its bottom, below
# everything else printed. Each is checked first; reading text decides only when neither speaks.

_FACES: cv2.CascadeClassifier | None = None

#: Long side the layout checks run at: the portrait is still ~100 px tall, and it takes ~50 ms.
LAYOUT_LONG_SIDE = 900
#: Detector confidence the best turn's face needs, and its lead over the next turn's.
FACE_MIN = 3.0
FACE_LEAD = 2.0
#: Smallest face looked for, as a share of the photo's short side. The card's portrait is about
#: half the card's height; turned the wrong way, the detector's false faces are small ones (the
#: pyramids, the eagle), and at a fifth of the height none survived on the stress set
#: (bench/stress_make.py) while every real portrait did. A card that is only a small part of the
#: photo finds no face at this size and falls back to reading, which is the safe way to miss.
FACE_MIN_SHARE = 0.2
#: A second turn's face counts as a rival from this weight, or above this share of the best's.
FACE_RIVAL = 3.0
FACE_RIVAL_SHARE = 0.45
#: Where the portrait's centre can be on an upright card crop, as shares of its width and height
#: (measured at x 0.15-0.18, y 0.27-0.35; wider here for the margin the crop carries).
PORTRAIT_X = (0.04, 0.36)
PORTRAIT_Y = (0.12, 0.55)
#: How much longer than wide the barcode blob must be to be one, and its smallest share of the
#: photo (a quarter of the card, the card at a fifth of the photo).
BARCODE_ELONGATION = 1.6
BARCODE_MIN_SHARE = 0.004


def _faces() -> cv2.CascadeClassifier:
    global _FACES  # noqa: PLW0603 - loaded once, read-only afterwards
    if _FACES is None:
        _FACES = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    return _FACES


def _small_grey(image: np.ndarray) -> np.ndarray:
    grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    scale = min(1.0, LAYOUT_LONG_SIDE / max(grey.shape[:2]))
    if scale < 1.0:
        grey = cv2.resize(grey, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    return grey


def face_turn(
    image: np.ndarray,
    turns: tuple[int, ...] = (0, 90, 180, 270),
    x_range: tuple[float, float] | None = None,
    y_range: tuple[float, float] | None = None,
) -> int | None:
    """The turn under which a face stands upright, when one turn clearly wins. None otherwise.

    `x_range` / `y_range`: where the face's centre may be in the upright picture (default: where the
    national ID's portrait is). Another card, another place: the company badge's photo is at the left.
    """
    x_range, y_range = x_range or PORTRAIT_X, y_range or PORTRAIT_Y
    grey = cv2.equalizeHist(_small_grey(image))
    weights = {}
    for degrees in turns:
        view = turn(grey, degrees)
        smallest = max(20, int(min(view.shape[:2]) * FACE_MIN_SHARE))
        try:
            found, _, levels = _faces().detectMultiScale3(
                view, scaleFactor=1.08, minNeighbors=5, minSize=(smallest, smallest),
                outputRejectLevels=True,
            )
        except cv2.error:
            return None
        view_h, view_w = view.shape[:2]
        # Only a face where the card's portrait is: a false face in a lace tablecloth scored 10.5
        # against the real, small, blurred portrait's 5.3, and turned an upright card upside down.
        weights[degrees] = max(
            (
                float(level)
                for (x, y, w, h), level in zip(found, levels)
                if x_range[0] <= (x + w / 2) / view_w <= x_range[1]
                and y_range[0] <= (y + h / 2) / view_h <= y_range[1]
            ),
            default=0.0,
        )
    ranked = sorted(weights.values(), reverse=True)
    best = max(weights, key=weights.get)
    runner_up = ranked[1] if len(ranked) > 1 else 0.0
    # A face in two turns is two readings of a pattern, not one of a face: the loser is not far
    # enough behind (a real, blurred portrait 5.3 against a false 10.5 in a lace cloth).
    if weights[best] >= FACE_MIN and weights[best] - runner_up >= FACE_LEAD and (
        runner_up < FACE_RIVAL or runner_up <= FACE_RIVAL_SHARE * weights[best]
    ):
        return best
    return None


def barcode_turn(image: np.ndarray) -> int | None:
    """The turn that puts the back's barcode below the rest of the card. None when there is none.
    """
    found = _barcode(image)
    return None if found is None else found[0]


#: The barcode's length as a share of the card's long side, and its depth as a share of the short
#: side, on every real back here (0.79-0.82 and 0.37-0.39). A front's bottom strip (serial number,
#: guilloche) runs the whole width, 1.0, and was taken for a barcode.
BARCODE_LENGTH = (0.55, 0.94)
BARCODE_DEPTH = (0.22, 0.56)


def looks_like_back(image: np.ndarray) -> bool:
    """Does this card crop carry the back's barcode: dense in both directions, most of the width,
    a third of the height? A front does not, and a photo of a front used to say it did."""
    found = _barcode(image)
    if found is None:
        return False
    _, length, depth = found
    return BARCODE_LENGTH[0] <= length <= BARCODE_LENGTH[1] and BARCODE_DEPTH[0] <= depth <= BARCODE_DEPTH[1]


def _barcode(image: np.ndarray) -> tuple[int, float, float] | None:
    """(turn, length share, depth share) of the barcode-like blob in a card crop, or None."""
    grey = _small_grey(image)
    values = grey.astype(np.float32)
    # Bars in both directions at once: a PDF417 is dense in x and in y, text and the guilloche
    # mostly in one, so the smaller of the two gradients singles the barcode out.
    both = np.minimum(
        np.abs(cv2.Sobel(values, cv2.CV_32F, 1, 0)), np.abs(cv2.Sobel(values, cv2.CV_32F, 0, 1))
    )
    window = max(9, int(min(grey.shape[:2]) * 0.04)) | 1
    density = cv2.blur(both, (window, window))
    mask = (density > max(float(np.percentile(density, 97)) * 0.6, 25.0)).astype(np.uint8)
    count, labels, stats, centres = cv2.connectedComponentsWithStats(mask)
    if count < 2:
        return None
    index = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    _, _, width, height, area = stats[index]
    if area < BARCODE_MIN_SHARE * grey.size or max(width, height) < BARCODE_ELONGATION * min(width, height):
        return None
    edges = cv2.Canny(grey, 60, 160) > 0
    edges[labels == index] = False
    ys, xs = np.nonzero(edges)
    if len(xs) < 50:
        return None
    # From the barcode towards the rest of the print is "up" on the card.
    up_x, up_y = xs.mean() - centres[index][0], ys.mean() - centres[index][1]
    if abs(up_x) < 1.0 and abs(up_y) < 1.0:
        return None
    # A barcode lying along the vertical means the card is on its side, and vice versa: the
    # direction must agree with the blob's own shape, or something else was found.
    sideways = height > width
    if sideways != (abs(up_x) > abs(up_y)):
        return None
    long_side, short_side = max(grey.shape[:2]), min(grey.shape[:2])
    length, depth = max(width, height) / long_side, min(width, height) / short_side
    if sideways:
        # The card's top facing right is a card turned a quarter clockwise: three more undo it.
        return (270 if up_x > 0 else 90), length, depth
    return (0 if up_y < 0 else 180), length, depth


def layout_turn(image: np.ndarray, side: str = "") -> int | None:
    """The turn the card's own layout calls for: its face on the front, its barcode on the back.

    Each check only on the side it belongs to: the front's guilloche and serial strip look enough
    like a barcode to point the wrong way, while a back has no face to be fooled by.
    """
    checks = (barcode_turn,) if side == "back" else (face_turn,)
    for check in checks:
        try:
            degrees = check(image)
        except Exception:  # noqa: BLE001 - a layout check is evidence, never a reason to fail
            degrees = None
        if degrees is not None:
            return degrees
    return None


def upright(
    image: np.ndarray,
    recognizer: object,
    *,
    turns: tuple[int, ...] | None = None,
    side: str = "",
    card_only: bool = False,
) -> tuple[np.ndarray, int]:
    """→ (the photo turned upright, the clockwise turn applied; 0 when left as given).

    `card_only`: the image is the card cut out of its photo. Only then is the layout asked: in a
    whole photo the card's portrait can be too small to find while a larger false face elsewhere
    is found (one was, in the stress set), so the layout is trusted on the card alone.
    """
    by_layout = layout_turn(image, side) if card_only else None
    if by_layout is not None:
        # Over the outline's say too: an outline found around the portrait, not the card, is
        # upright-shaped and allowed only the two sideways turns.
        return turn(image, by_layout), by_layout
    return upright_by_text(image, recognizer, turns=turns)


def upright_by_text(
    image: np.ndarray, recognizer: object, *, turns: tuple[int, ...] | None = None
) -> tuple[np.ndarray, int]:
    """Which way up reads best, when the layout said nothing (see `layout_turn`)."""
    read: Callable[[np.ndarray], Lines] | None = getattr(recognizer, "detect_lines", None)
    if read is None:
        return image, 0
    try:
        as_given = read(image)
    except Exception:  # noqa: BLE001 - orientation is an improvement, never a reason to fail
        return image, 0
    if not as_given:
        return image, 0

    if turns is not None:
        if 0 in turns and _mean_score(as_given) >= CONFIDENT:
            return image, 0
        candidates = tuple(degrees for degrees in turns if degrees)
        scores = {0: _evidence(as_given)} if 0 in turns else {}
        if 0 not in turns:
            # Standing on its side: one of the two turns is right, so the better one is taken.
            for degrees in candidates:
                try:
                    scores[degrees] = _evidence(read(turn(image, degrees)))
                except Exception:  # noqa: BLE001
                    scores[degrees] = 0.0
            best = max(scores, key=scores.get)
            return turn(image, best), best
    elif _sideways(as_given):
        candidates = (90, 270)
        scores = {}
    else:
        if _mean_score(as_given) >= CONFIDENT:
            return image, 0
        # Box shape said "not sideways", but it is only a vote, and it can be outvoted by things
        # that are not text: the back of the card is half PDF417 barcode, and turned on its side
        # the barcode's bars come back as a crowd of wide "lines" that outnumber the real, tall
        candidates = (90, 180, 270)
        scores = {0: _evidence(as_given)}

    for degrees in candidates:
        try:
            scores[degrees] = _evidence(read(turn(image, degrees)))
        except Exception:  # noqa: BLE001
            scores[degrees] = 0.0

    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    (best, best_score), (_, runner_up) = ranked[0], ranked[1]
    if best == 0 or best_score < MARGIN * runner_up or best_score <= 0:
        return image, 0
    return turn(image, best), best
