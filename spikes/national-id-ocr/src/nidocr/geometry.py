"""Finding the card in a photograph, and flattening it."""

from __future__ import annotations

import threading
from dataclasses import dataclass

import cv2
import numpy as np

#: ISO/IEC 7810 ID-1, the format every national ID card in Egypt is issued in.
ID1_ASPECT = 85.60 / 53.98  # 1.5858…

#: How far a candidate may stray from ID-1 and still be considered, as a ratio either way.
ASPECT_TOLERANCE = 1.45

#: How close an uncropped frame's own proportions must be to ID-1 before it is treated as an image
#: already cropped to the card.
PRECROP_TOLERANCE = 1.10

#: Smallest share of a card-shaped frame a located quad must cover to be believed over "the frame
#: is the card".
PRECROP_MIN_COVERAGE = 0.5

#: Detection runs on a downscaled copy: contour finding is O(pixels), the corners it produces are
#: no more accurate at 4000 px than at 1200, and the final warp samples the original anyway.
DETECT_LONG_SIDE = 1200

#: Smallest fraction of the frame a candidate may cover.
MIN_COVERAGE = 0.002

#: Below this score, a candidate is not a card and "not located" is the better answer.
MIN_SCORE = 0.15


@dataclass(frozen=True)
class Rectification:
    """A located, flattened card plus everything needed to judge how much to trust it."""

    image: np.ndarray
    #: Which detector won: 'edges' | 'brightness' | 'gradient' | 'texture', or one of the two no-
    #: detection outcomes, 'precropped' (the frame is already card-shaped, nothing to find) and
    #: 'frame' (a card should have been in there somewhere and was not located).
    method: str
    #: Corners in the original image, ordered TL, TR, BR, BL. None when the card was not located.
    quad: np.ndarray | None
    #: Measured width/height of the found quad. None when not located.
    aspect: float | None
    #: The card's width in original-image pixels, the true resolution budget for recognition.
    #: Measured on the source, not the canonical output, which is always 1024 px wide by definition.
    card_width_px: float
    #: Peak deviation of the card's border from a straight line, as a fraction of card height.
    bow: float = 0.0
    #: Whether the curl correction was actually applied (it is skipped on flat cards).
    dewarped: bool = False

    @property
    def located(self) -> bool:
        """Whether the geometry can be trusted."""
        return self.method != "frame"


def order_quad(points: np.ndarray) -> np.ndarray:
    """Order 4 points as top-left, top-right, bottom-right, bottom-left."""
    ordered = np.zeros((4, 2), dtype=np.float32)
    s = points.sum(axis=1)
    d = np.diff(points, axis=1).ravel()
    ordered[0] = points[np.argmin(s)]  # top-left, smallest x+y
    ordered[2] = points[np.argmax(s)]  # bottom-right, largest x+y
    ordered[1] = points[np.argmin(d)]  # top-right, smallest y−x
    ordered[3] = points[np.argmax(d)]  # bottom-left, largest y−x
    return ordered


def _edge_lengths(quad: np.ndarray) -> tuple[float, float]:
    """Mean horizontal and mean vertical edge length of an ordered quad."""
    top = float(np.linalg.norm(quad[1] - quad[0]))
    bottom = float(np.linalg.norm(quad[2] - quad[3]))
    left = float(np.linalg.norm(quad[3] - quad[0]))
    right = float(np.linalg.norm(quad[2] - quad[1]))
    return (top + bottom) / 2.0, (left + right) / 2.0


def _orient_landscape(quad: np.ndarray) -> np.ndarray:
    """Re-label the corners so the card's long side is horizontal."""
    width, height = _edge_lengths(quad)
    if height > width:
        return np.roll(quad, -1, axis=0)
    return quad


def _auto_canny(gray: np.ndarray, sigma: float = 0.33) -> np.ndarray:
    """Canny with thresholds derived from the image's own median intensity."""
    median = float(np.median(gray))
    lower = int(max(0, (1.0 - sigma) * median))
    upper = int(min(255, (1.0 + sigma) * median))
    return cv2.Canny(gray, lower, max(upper, lower + 1))


def _mask_edges(bgr: np.ndarray) -> np.ndarray:
    """Edge map, closed so a border broken by glare still forms one contour."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = _auto_canny(gray)
    kernel = np.ones((5, 5), np.uint8)
    return cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)


def _cardness(bgr: np.ndarray) -> np.ndarray:
    """'Bright and unsaturated' as a single channel, what card stock is and most surfaces are not.
    """
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    saturation, value = hsv[..., 1], hsv[..., 2]
    cardness = value.astype(np.float32) * (255 - saturation).astype(np.float32) / 255.0
    return np.clip(cardness, 0, 255).astype(np.uint8)


def _clean(mask: np.ndarray) -> np.ndarray:
    kernel = np.ones((7, 7), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    return cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)


def _masks_brightness(bgr: np.ndarray) -> tuple[np.ndarray, ...]:
    """Segment on brightness, in both polarities."""
    _, mask = cv2.threshold(_cardness(bgr), 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    return _clean(mask), _clean(cv2.bitwise_not(mask))


def _masks_edges(bgr: np.ndarray) -> tuple[np.ndarray, ...]:
    return (_mask_edges(bgr),)


def _masks_gradient(bgr: np.ndarray) -> tuple[np.ndarray, ...]:
    return (_mask_gradient(bgr),)


def _masks_texture(bgr: np.ndarray) -> tuple[np.ndarray, ...]:
    """Segment on local texture: the card is printed, and the surface under it usually is not."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    window = 9
    mean = cv2.boxFilter(gray, -1, (window, window))
    mean_square = cv2.boxFilter(gray * gray, -1, (window, window))
    deviation = np.sqrt(np.clip(mean_square - mean * mean, 0, None))
    deviation = cv2.normalize(deviation, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)

    _, mask = cv2.threshold(deviation, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    bridge = max(15, int(max(bgr.shape[:2]) * 0.03)) | 1
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((bridge, bridge), np.uint8))
    return (cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8)),)


def _mask_gradient(bgr: np.ndarray) -> np.ndarray:
    """Otsu over Scharr gradient magnitude, a softer edge detector than Canny."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    magnitude = np.hypot(
        cv2.Scharr(gray, cv2.CV_32F, 1, 0), cv2.Scharr(gray, cv2.CV_32F, 0, 1)
    )
    magnitude = cv2.normalize(magnitude, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    _, mask = cv2.threshold(magnitude, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    kernel = np.ones((5, 5), np.uint8)
    return cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)


def _quads_from_mask(mask: np.ndarray, frame_area: float) -> list[np.ndarray]:
    """Every plausible quadrilateral in a binary mask, largest contours first."""
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    quads: list[np.ndarray] = []
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:6]:
        if cv2.contourArea(contour) < frame_area * MIN_COVERAGE:
            break  # contours are sorted, so everything after this is smaller still
        perimeter = cv2.arcLength(contour, True)
        for epsilon in (0.01, 0.02, 0.04):
            approx = cv2.approxPolyDP(contour, epsilon * perimeter, True)
            if len(approx) == 4 and cv2.isContourConvex(approx):
                quads.append(_orient_landscape(order_quad(approx.reshape(4, 2).astype(np.float32))))
        quads.append(
            _orient_landscape(order_quad(cv2.boxPoints(cv2.minAreaRect(contour)).astype(np.float32)))
        )
    return quads


#: How far each detector's verdict is trusted when several produce a candidate.
_STRATEGY_PRIOR = {"edges": 1.0, "gradient": 1.0, "brightness": 0.95, "texture": 0.7}


def _score(quad: np.ndarray, frame_area: float) -> float | None:
    """How much this quadrilateral looks like a card, in [0, 1]. None means 'rejected outright'."""
    width, height = _edge_lengths(quad)
    if width < 1.0 or height < 1.0:
        return None

    area = float(cv2.contourArea(quad.astype(np.float32)))
    coverage = area / frame_area
    if coverage < MIN_COVERAGE or coverage > 0.995:
        return None

    aspect = width / height
    # Log-ratio so that being 1.4x too wide and 1.4x too narrow are penalised identically.
    aspect_error = abs(float(np.log(aspect / ID1_ASPECT)))
    limit = float(np.log(ASPECT_TOLERANCE))
    if aspect_error > limit:
        return None

    proportion = 1.0 - aspect_error / limit
    size = float(np.sqrt(min(coverage / 0.35, 1.0)))
    return proportion * size


def locate_card(image: np.ndarray) -> tuple[np.ndarray, str] | None:
    """The card's four corners in `image`, with the detector that found them. None if not found."""
    height, width = image.shape[:2]
    scale = min(1.0, DETECT_LONG_SIDE / max(height, width))
    small = (
        cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        if scale < 1.0
        else image
    )
    frame_area = float(small.shape[0] * small.shape[1])

    best: tuple[float, np.ndarray, str] | None = None
    for method, builder in (
        ("edges", _masks_edges),
        ("brightness", _masks_brightness),
        ("gradient", _masks_gradient),
        ("texture", _masks_texture),
    ):
        prior = _STRATEGY_PRIOR[method]
        for mask in builder(small):
            for quad in _quads_from_mask(mask, frame_area):
                score = _score(quad, frame_area)
                if score is None:
                    continue
                score *= prior
                if best is None or score > best[0]:
                    best = (score, quad, method)

    if best is None or best[0] < MIN_SCORE:
        return None
    _, quad, method = best
    return _orient_landscape(quad / scale).astype(np.float32), method


#: `refine_quad` works on a copy this size: GrabCut's cost grows with pixels, and an edge 2 px off
#: at this scale is under 0.5 % of the card.
REFINE_LONG_SIDE = 900
#: How far either side of a located edge the true edge is looked for, as a share of the card's
#: long side. The detectors land within 2-3 % on real photos; 5 % covers that with room.
REFINE_BAND = 0.05


def _line_through(points: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """A robust straight line through `points` → (a point on it, its unit direction)."""
    vx, vy, x0, y0 = cv2.fitLine(points.astype(np.float32), cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
    return np.array([x0, y0]), np.array([vx, vy])


def _meet(
    first: tuple[np.ndarray, np.ndarray], second: tuple[np.ndarray, np.ndarray]
) -> np.ndarray | None:
    (p, d), (q, e) = first, second
    cross = d[0] * e[1] - d[1] * e[0]
    if abs(cross) < 1e-6:
        return None
    t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / cross
    return p + t * d


def refine_quad(image: np.ndarray, quad: np.ndarray) -> np.ndarray:
    """Snap a located quad onto the card's own four edges. → the refined quad, or `quad` as given.
    """
    height, width = image.shape[:2]
    scale = min(1.0, REFINE_LONG_SIDE / max(height, width))
    small = (
        cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        if scale < 1.0
        else image
    )
    located = quad.astype(np.float64) * scale
    long_side = max(_edge_lengths(located))
    band = max(3, int(REFINE_BAND * long_side))

    outline = np.zeros(small.shape[:2], np.uint8)
    cv2.fillPoly(outline, [np.round(located).astype(np.int32)], 255)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * band + 1, 2 * band + 1))
    sure_card = cv2.erode(outline, kernel)
    maybe_card = cv2.dilate(outline, kernel)
    seeds = np.full(small.shape[:2], cv2.GC_BGD, np.uint8)
    seeds[maybe_card > 0] = cv2.GC_PR_BGD
    seeds[outline > 0] = cv2.GC_PR_FGD
    seeds[sure_card > 0] = cv2.GC_FGD
    cv2.setRNGSeed(0)  # GrabCut seeds its colour models at random; the same photo, the same outline
    try:
        cv2.grabCut(
            small, seeds, None, np.zeros((1, 65)), np.zeros((1, 65)), 3, cv2.GC_INIT_WITH_MASK
        )
    except cv2.error:
        return quad
    card = np.where((seeds == cv2.GC_FGD) | (seeds == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    card = cv2.morphologyEx(card, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    contours, _ = cv2.findContours(card, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return quad
    boundary = cv2.convexHull(max(contours, key=cv2.contourArea)).reshape(-1, 2).astype(np.float64)
    # The hull of a clean card is four points; resample it every pixel so every edge has points.
    samples = []
    for i in range(len(boundary)):
        start, end = boundary[i], boundary[(i + 1) % len(boundary)]
        steps = max(1, int(np.linalg.norm(end - start)))
        samples.extend(start + t * (end - start) for t in np.linspace(0.0, 1.0, steps, endpoint=False))
    points = np.asarray(samples)

    lines = []
    for index in range(4):
        start, end = located[index], located[(index + 1) % 4]
        along = end - start
        length = max(float(np.linalg.norm(along)), 1e-6)
        direction = along / length
        normal = np.array([-direction[1], direction[0]])
        offset = points - start
        t = offset @ direction / length
        distance = np.abs(offset @ normal)
        # The middle of each edge only: the rounded corners bend away from the straight edge.
        chosen = points[(t > 0.12) & (t < 0.88) & (distance < 1.5 * band)]
        if len(chosen) < 10:
            return quad
        lines.append(_line_through(chosen))

    corners = [_meet(lines[(index - 1) % 4], lines[index]) for index in range(4)]
    if any(corner is None for corner in corners):
        return quad
    refined = np.asarray(corners)
    moved = float(np.linalg.norm(refined - located, axis=1).max())
    across, down = _edge_lengths(refined)
    aspect = max(across, down) / max(min(across, down), 1.0)
    if (
        moved > 2 * band
        or not cv2.isContourConvex(refined.astype(np.float32))
        or not ID1_ASPECT / ASPECT_TOLERANCE <= aspect <= ID1_ASPECT * ASPECT_TOLERANCE
    ):
        return quad
    return (refined / scale).astype(np.float32)


_VIEWS: dict[tuple[int, str, int], tuple[np.ndarray, object]] = {}
_VIEWS_LOCK = threading.Lock()


def _view(image: np.ndarray, kind: str, long_side: int) -> tuple[np.ndarray, float]:
    """A shrunk Lab or gradient copy of `image`, made once per photo and reused by every candidate.
    """
    key = (id(image), kind, long_side)
    with _VIEWS_LOCK:
        hit = _VIEWS.get(key)
        if hit is not None and hit[0] is image:
            return hit[1]  # type: ignore[return-value]
    small, scale = _small(image, long_side)
    if kind == "lab3":
        view = cv2.cvtColor(cv2.GaussianBlur(small, (3, 3), 0), cv2.COLOR_BGR2LAB).astype(np.float32)
    elif kind == "lab5":
        view = cv2.cvtColor(cv2.GaussianBlur(small, (5, 5), 0), cv2.COLOR_BGR2LAB).astype(np.float32)
    else:
        grey = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        view = cv2.magnitude(cv2.Sobel(grey, cv2.CV_32F, 1, 0), cv2.Sobel(grey, cv2.CV_32F, 0, 1))
    with _VIEWS_LOCK:
        if len(_VIEWS) >= 12:
            _VIEWS.pop(next(iter(_VIEWS)))
        _VIEWS[key] = (image, (view, scale))
    return view, scale


def _small(image: np.ndarray, long_side: int) -> tuple[np.ndarray, float]:
    height, width = image.shape[:2]
    scale = min(1.0, long_side / max(height, width))
    if scale >= 1.0:
        return image, 1.0
    return cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA), scale


def _hull_to_quad(hull: np.ndarray) -> np.ndarray | None:
    """Four corners for a card-like blob: its hull simplified until four points remain."""
    perimeter = cv2.arcLength(hull, True)
    for share in (0.01, 0.02, 0.03, 0.05, 0.08):
        approx = cv2.approxPolyDP(hull, share * perimeter, True)
        if len(approx) == 4:
            return order_quad(approx.reshape(4, 2).astype(np.float32))
    return order_quad(cv2.boxPoints(cv2.minAreaRect(hull)).astype(np.float32))


def _grabcut_outline(image: np.ndarray) -> np.ndarray | None:
    """The card as the main object of the photo, when the edge detectors found nothing card-shaped.
    """
    small, scale = _small(image, 360)
    height, width = small.shape[:2]
    rim = max(3, int(0.02 * min(height, width)))
    seeds = np.zeros((height, width), np.uint8)
    cv2.setRNGSeed(0)  # GrabCut seeds its colour models at random; the same photo, the same outline
    try:
        cv2.grabCut(
            small, seeds, (rim, rim, width - 2 * rim, height - 2 * rim),
            np.zeros((1, 65)), np.zeros((1, 65)), 2, cv2.GC_INIT_WITH_RECT,
        )
    except cv2.error:
        return None
    card = np.where((seeds == cv2.GC_FGD) | (seeds == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    card = cv2.morphologyEx(card, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8))
    contours, _ = cv2.findContours(card, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    blob = max(contours, key=cv2.contourArea)
    if cv2.contourArea(blob) < 0.08 * width * height:
        return None
    quad = _hull_to_quad(cv2.convexHull(blob))
    if quad is None or cv2.contourArea(blob) < 0.85 * cv2.contourArea(quad):
        return None  # not a rectangle: a hand, a bag, a shadow joined to the card
    return _orient_landscape(quad / scale).astype(np.float32)


def border_contrast(image: np.ndarray, quad: np.ndarray) -> float:
    """How clearly the photo changes across each of the quad's four sides, the weakest side's."""
    lab, scale = _view(image, "lab5", 600)
    height, width = lab.shape[:2]
    located = quad.astype(np.float64) * scale
    centre = located.mean(axis=0)
    step = max(2.0, 0.02 * max(_edge_lengths(located)))
    sides = []
    for index in range(4):
        start, end = located[index], located[(index + 1) % 4]
        direction = (end - start) / max(float(np.linalg.norm(end - start)), 1e-6)
        normal = np.array([-direction[1], direction[0]])
        if np.dot(normal, centre - (start + end) / 2) < 0:
            normal = -normal  # pointing into the card
        differences = []
        off_photo = 0
        for t in np.linspace(0.15, 0.85, 24):
            point = start + t * (end - start)
            inside, outside = point + step * normal, point - step * normal
            if not (0 <= outside[0] < width and 0 <= outside[1] < height):
                off_photo += 1  # the card runs off the photo here; nothing outside to compare
                continue
            a = lab[int(np.clip(inside[1], 0, height - 1)), int(np.clip(inside[0], 0, width - 1))]
            b = lab[int(outside[1]), int(outside[0])]
            differences.append(float(np.linalg.norm(a - b)))
        if off_photo >= 18:
            # Along the photo's own edge: the card continues past the frame, which is as much an
            # end of what can be shown as a table edge is.
            sides.append(FRAME_EDGE_CONTRAST)
        elif len(differences) >= 6:
            sides.append(float(np.median(differences)))
    return min(sides) if len(sides) >= 2 else 0.0


#: What a side lying along the photo's own edge counts as: a clear edge, not the clearest.
FRAME_EDGE_CONTRAST = 20.0
#: Weakest-side contrast (Lab units) an outline needs to be shown as the card's.
MIN_BORDER_CONTRAST = 7.0


def snap_to_edges(image: np.ndarray, quad: np.ndarray, band: float = REFINE_BAND) -> np.ndarray:
    """Move each side of `quad` onto the strongest colour edge near it. → the snapped quad."""
    lab, scale = _view(image, "lab3", REFINE_LONG_SIDE)
    located = quad.astype(np.float64) * scale
    centre = located.mean(axis=0)
    reach = max(3, int(band * max(_edge_lengths(located))))
    offsets = np.arange(-reach, reach + 1, dtype=np.float64)
    lines = []
    for index in range(4):
        start, end = located[index], located[(index + 1) % 4]
        direction = (end - start) / max(float(np.linalg.norm(end - start)), 1e-6)
        normal = np.array([-direction[1], direction[0]])
        if np.dot(normal, centre - (start + end) / 2) > 0:
            normal = -normal  # pointing out of the card
        bases = start + np.linspace(0.12, 0.88, 40)[:, None] * (end - start)
        samples = bases[:, None, :] + offsets[None, :, None] * normal
        colours = cv2.remap(
            lab, samples[..., 0].astype(np.float32), samples[..., 1].astype(np.float32),
            cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE,
        )
        change = np.linalg.norm(colours[:, 2:] - colours[:, :-2], axis=2)
        strongest = change.argmax(axis=1)
        keep = change[np.arange(len(bases)), strongest] > 6.0
        if keep.sum() < 8:
            return quad
        points = samples[np.arange(len(bases)), strongest + 1][keep]
        lines.append(_line_through(points))
    corners = [_meet(lines[(index - 1) % 4], lines[index]) for index in range(4)]
    if any(corner is None for corner in corners):
        return quad
    snapped = np.asarray(corners)
    if np.linalg.norm(snapped - located, axis=1).max() > 2.5 * reach or not cv2.isContourConvex(
        snapped.astype(np.float32)
    ):
        return quad
    return (snapped / scale).astype(np.float32)


def _detail_inside(image: np.ndarray, quad: np.ndarray) -> float:
    """Mean edge strength inside the quad's inner 80 %: a card is print, a coloured block is flat."""
    magnitude, scale = _view(image, "gradient", 600)
    located = quad.astype(np.float64) * scale
    centre = located.mean(axis=0)
    inner = centre + 0.8 * (located - centre)
    mask = np.zeros(magnitude.shape, np.uint8)
    cv2.fillPoly(mask, [np.round(inner).astype(np.int32)], 255)
    return float(magnitude[mask > 0].mean()) if mask.any() else 0.0


#: Outline score at which the edge detectors' find is clear enough to skip GrabCut.
CLEAR_OUTLINE = 30.0
#: How much smaller than its holder an outline must be to count as a part of the card.
PART_SHARE = 0.6
#: How clear, relative to the clearest outline, a larger outline holding it must be to replace it.
HOLDER_SHARE = 0.3
#: Mean inner edge strength at which an outline counts fully as print rather than a flat block.
CARD_DETAIL = 25.0


#: How much more an outline counts when what is inside it is recognisably the card's.
CONTENT_BOOST = 3.0
#: Size the inside of an outline is checked at (ID-1 proportions).
CONTENT_SIZE = (480, 303)
#: Where the front's portrait sits on an upright card, as shares of its width and height: measured
#: on every real card here at centre (0.15-0.18, 0.27-0.35), width 0.19-0.23.
PORTRAIT_CENTRE_X = (0.08, 0.28)
PORTRAIT_CENTRE_Y = (0.18, 0.48)
PORTRAIT_WIDTH = (0.14, 0.30)
#: A face this wide is not on a card, it is what the outline is: the portrait, or a head.
FACE_IS_OUTLINE = 0.45
#: ...or fills this share of the outline's area: a card's face fills about 0.06 of it (measured on
#: every real card here), the portrait's own box several times that.
FACE_AREA_IS_OUTLINE = 0.14
#: Where the back's barcode sits on an upright card (left, top, width, height): measured at
#: (0.09-0.11, 0.56-0.59, 0.79-0.82, 0.37-0.39).
BARCODE_LEFT = (0.03, 0.2)
BARCODE_TOP = (0.48, 0.66)
BARCODE_WIDTH = (0.65, 0.92)
BARCODE_HEIGHT = (0.28, 0.48)


def _within(value: float, bounds: tuple[float, float]) -> bool:
    return bounds[0] <= value <= bounds[1]


def card_content(image: np.ndarray, quad: np.ndarray) -> str | None:
    """What the inside of `quad` shows: 'front' (the portrait where a card front has it), 'back'
    (the barcode where a back has it), 'portrait' (mostly one face: the printed photo or a head,
    not a card), or None (nothing to tell)."""
    from .orientation import _faces  # noqa: PLC0415 - orientation needs nothing from geometry

    width, height = CONTENT_SIZE
    target = np.float32([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]])
    corners = _orient_landscape(order_quad(quad.astype(np.float32)))
    flat = cv2.warpPerspective(
        image, cv2.getPerspectiveTransform(corners, target), (width, height), flags=cv2.INTER_AREA
    )
    grey = cv2.equalizeHist(cv2.cvtColor(flat, cv2.COLOR_BGR2GRAY))
    # A landscape card is upright or upside down; an outline that is really a portrait standing up
    # was laid on its side, so the quarter turns are looked at for that alone.
    views = {
        0: grey, 180: cv2.rotate(grey, cv2.ROTATE_180),
        90: cv2.rotate(grey, cv2.ROTATE_90_CLOCKWISE), 270: cv2.rotate(grey, cv2.ROTATE_90_COUNTERCLOCKWISE),
    }
    front = False
    for degrees, view in views.items():
        view_h, view_w = view.shape[:2]
        smallest = max(24, int(min(view_h, view_w) * 0.2))
        for x, y, w, h in _faces().detectMultiScale(view, scaleFactor=1.08, minNeighbors=5, minSize=(smallest, smallest)):
            if (w / view_w > FACE_IS_OUTLINE and h / view_h > FACE_IS_OUTLINE) or (
                w * h / (view_w * view_h) > FACE_AREA_IS_OUTLINE
            ):
                return "portrait"
            if degrees in (0, 180) and _within((x + w / 2) / view_w, PORTRAIT_CENTRE_X)                     and _within((y + h / 2) / view_h, PORTRAIT_CENTRE_Y) and _within(w / view_w, PORTRAIT_WIDTH):
                front = True
    if front:
        return "front"
    values = grey.astype(np.float32)
    both = np.minimum(np.abs(cv2.Sobel(values, cv2.CV_32F, 1, 0)), np.abs(cv2.Sobel(values, cv2.CV_32F, 0, 1)))
    density = cv2.blur(both, (13, 13))
    mask = (density > max(float(np.percentile(density, 97)) * 0.6, 25.0)).astype(np.uint8)
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask)
    if count > 1:
        left, top, w, h, _ = stats[1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))]
        left, top, w, h = left / width, top / height, w / width, h / height
        flipped_left, flipped_top = 1 - left - w, 1 - top - h
        if _within(w, BARCODE_WIDTH) and _within(h, BARCODE_HEIGHT) and (
            (_within(left, BARCODE_LEFT) and _within(top, BARCODE_TOP))
            or (_within(flipped_left, BARCODE_LEFT) and _within(flipped_top, BARCODE_TOP))
        ):
            return "back"
    return None


#: Where the card's portrait sits on it, as shares of its width and height: the face's width is
#: 0.19-0.23 of the card's, its centre (0.15-0.18, 0.27-0.35). Measured on every real card here.
FACE_WIDTH_SHARE = 0.205
FACE_CENTRE_X = 0.165
FACE_CENTRE_Y = 0.33
#: Detector confidence a face needs to anchor a card.
ANCHOR_MIN_WEIGHT = 4.0
#: Long side the anchor search runs at, and the smallest face it looks for (share of the short side).
ANCHOR_LONG_SIDE = 900
ANCHOR_MIN_FACE = 0.05


def face_anchors(image: np.ndarray) -> list[tuple[np.ndarray, float]]:
    """Where a card would be, if each face in the photo were its portrait. → [(corners, weight)].

    The card's printed portrait is the one thing on it a detector finds reliably whatever lies
    around it, and it fixes the card's size, position and which way up it is. This finds a card
    whose own border is too soft to find (a pale card on a pale-blue surface had no edge at all),
    and tells a card from its portrait.
    """
    from .orientation import _faces  # noqa: PLC0415 - orientation needs nothing from geometry

    grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    scale = min(1.0, ANCHOR_LONG_SIDE / max(grey.shape[:2]))
    if scale < 1.0:
        grey = cv2.resize(grey, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    grey = cv2.equalizeHist(grey)
    height, width = grey.shape[:2]
    rotations = {0: None, 90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}
    anchors: list[tuple[np.ndarray, float]] = []
    for degrees, code in rotations.items():
        view = grey if code is None else cv2.rotate(grey, code)
        smallest = max(24, int(min(view.shape[:2]) * ANCHOR_MIN_FACE))
        try:
            found, _, levels = _faces().detectMultiScale3(
                view, scaleFactor=1.08, minNeighbors=5, minSize=(smallest, smallest), outputRejectLevels=True
            )
        except cv2.error:
            return []
        for (x, y, w, h), weight in zip(found, levels):
            if weight < ANCHOR_MIN_WEIGHT:
                continue
            card_w = w / FACE_WIDTH_SHARE
            card_h = card_w / ID1_ASPECT
            centre_x = x + w / 2 + (0.5 - FACE_CENTRE_X) * card_w
            centre_y = y + h / 2 + (0.5 - FACE_CENTRE_Y) * card_h
            corners = np.float32(
                [[centre_x - card_w / 2, centre_y - card_h / 2], [centre_x + card_w / 2, centre_y - card_h / 2],
                 [centre_x + card_w / 2, centre_y + card_h / 2], [centre_x - card_w / 2, centre_y + card_h / 2]]
            )
            # Back from the turned view to the photo.
            if degrees == 90:
                corners = np.stack([corners[:, 1], height - 1 - corners[:, 0]], axis=1)
            elif degrees == 180:
                corners = np.stack([width - 1 - corners[:, 0], height - 1 - corners[:, 1]], axis=1)
            elif degrees == 270:
                corners = np.stack([width - 1 - corners[:, 1], corners[:, 0]], axis=1)
            anchors.append((orient_landscape(corners / scale), float(weight)))
    return sorted(anchors, key=lambda item: -item[1])


def _agrees(quad: np.ndarray, anchor: np.ndarray) -> bool:
    """Is `quad` about where and how big `anchor` says the card is?"""
    across, down = _edge_lengths(anchor)
    size = max(across, down)
    shift = float(np.linalg.norm(quad.mean(axis=0) - anchor.mean(axis=0)))
    ratio = max(_edge_lengths(quad)) / max(size, 1.0)
    return shift <= 0.25 * size and 0.65 <= ratio <= 1.5


#: How far outside the photo a face-anchored card may reach (share of the photo): a card cut off
#: by the edge of the frame is real, a card 20 % out of it is a false face.
ANCHOR_OVERHANG = 0.08
#: A face-anchored card must be at least this share of the size of the outline found along edges:
#: a "face" far smaller than that is something on the card, or on the table, not its portrait.
ANCHOR_MIN_SHARE = 0.3


def _credible(image: np.ndarray, anchors: list[tuple[np.ndarray, float]], edge: np.ndarray | None):
    """The face-anchored cards worth believing, strongest face first."""
    height, width = image.shape[:2]
    kept = []
    for quad, weight in anchors:
        over = max(
            float(np.max(-quad[:, 0])), float(np.max(quad[:, 0] - width)),
            float(np.max(-quad[:, 1])), float(np.max(quad[:, 1] - height)), 0.0,
        )
        if over > ANCHOR_OVERHANG * max(width, height):
            continue
        if edge is not None:
            ratio = cv2.contourArea(quad.astype(np.float32)) / max(cv2.contourArea(edge.astype(np.float32)), 1.0)
            if ratio < ANCHOR_MIN_SHARE:
                continue
        kept.append((quad, weight))
    return kept


def find_card_outline(
    image: np.ndarray, located: np.ndarray | None = None, side: str = ""
) -> np.ndarray | None:
    """The card's four corners on its own edges, for showing it. None when no outline is clear.

    `side`: 'back' stops the face search, a back has no portrait and its emblem is not a face.
    """
    try:
        found = candidate_quads(image)
    except Exception:  # noqa: BLE001
        found = []
    if located is not None:
        found.insert(0, located)
    scored: list[tuple[float, float, np.ndarray]] = []
    #: id of each scored outline → whether its inside was recognisably the card's.
    verified: dict[int, bool] = {}

    def judge(quads: list[np.ndarray]) -> None:
        for quad in quads:
            snapped = snap_to_edges(image, quad)
            across, down = _edge_lengths(snapped)
            aspect = max(across, down) / max(min(across, down), 1.0)
            if not ID1_ASPECT / ASPECT_TOLERANCE <= aspect <= ID1_ASPECT * ASPECT_TOLERANCE:
                continue
            detail = min(1.0, _detail_inside(image, snapped) / CARD_DETAIL)
            score = border_contrast(image, snapped) * detail
            if score < MIN_BORDER_CONTRAST:
                continue
            content = card_content(image, snapped)
            if content == "portrait":
                continue  # the printed photo, or the holder's own head: a face, not a card
            if content is not None:
                score *= CONTENT_BOOST
            verified[id(snapped)] = content is not None
            scored.append((score, cv2.contourArea(snapped.astype(np.float32)), snapped))

    judge(found)
    try:
        anchors = face_anchors(image) if side != "back" else []
    except Exception:  # noqa: BLE001 - an extra witness, never a reason to fail
        anchors = []
    # GrabCut is the slowest finder and is there for what the edge detectors miss; a clear outline
    # that is also the largest found makes it redundant.
    frame = float(image.shape[0] * image.shape[1])
    largest = max(scored, key=lambda item: item[1], default=None)
    clear = largest is not None and largest[0] >= CLEAR_OUTLINE and largest[1] >= 0.1 * frame
    if not clear:
        grabbed = _grabcut_outline(image)
        if grabbed is not None:
            judge([grabbed])
    if any(verified.values()):
        # Some outline had the card's own face or barcode inside it: the others, a bigger box with
        # two cards in it, a pile of papers, the whole table, are not the card.
        scored = [item for item in scored if verified.get(id(item[2]))]
    if not scored:
        usable = _credible(image, anchors, None)
        return _anchored(image, _best_anchor(image, usable)) if usable else None
    # The card's parts, the portrait, the barcode, have sharper outlines than a pale card on a
    # pale table, on one, the portrait scored 24 and the card 10, but they are inside it.
    top_score, top_area, card = max(scored, key=lambda item: item[0])
    for score, area, quad in sorted(scored, key=lambda item: item[1], reverse=True):
        # Only a part is given up: the clearest outline must be much smaller than its holder, or a
        # card framed tightly would give way to the whole photo, slivers of table included.
        if area < top_area / PART_SHARE or score < HOLDER_SHARE * top_score:
            continue
        if verified.get(id(card)) and not verified.get(id(quad)):
            continue  # the card's own face or barcode was seen inside: a bigger box is the table
        shared, _ = cv2.intersectConvexConvex(quad.astype(np.float32), card.astype(np.float32))
        if shared >= 0.8 * top_area:
            card = quad
            break
    # The careful GrabCut refinement is kept only where it makes the outline clearer: on a pale
    # card on a pale table it can drift, and the snapped outline was already on the edges.
    refined = refine_quad(image, card)
    if border_contrast(image, refined) >= border_contrast(image, card):
        card = refined
    usable = _credible(image, anchors, card)
    if usable and not verified.get(id(card)) and not any(_agrees(card, anchor) for anchor, _ in usable[:3]):
        # Nothing found along an edge is where a card with that face would be: a table edge, a
        # glare, the whole photo. The face is the better witness. (An outline with the card's own
        # face or barcode inside it, where they belong, is never overruled.)
        return _anchored(image, _best_anchor(image, usable))
    return card


def _best_anchor(image: np.ndarray, usable: list[tuple[np.ndarray, float]]) -> np.ndarray:
    """Which face-anchored card to believe: the one that looks like a card front.

    The face detector's own weight is not enough. On a card photographed on its side the printed
    portrait is found in more than one turn of the photo, and the strongest find came from the
    WRONG turn: a landscape card laid across the portrait and the table beside it, while the card
    itself stood upright in the photo. Each anchor's inside rules some out — 'portrait' (mostly one
    face) is the printed photo, not a card — but 'front' alone is not enough either: an anchor is
    built AROUND a face, so any face, a false one found in the address text included, sits where a
    front's portrait goes. On one photo four anchors were 'front', and the small one around a false
    face was taken.

    What only the real card has is its own border: laid on the photo, the true anchor runs along
    the card's edges (border contrast 4.7-5.1 on every turn of that photo) while a false one runs
    across the print (at most 3.2). So among the fronts — or, without one, among what is not just
    a face — the anchor that best meets an edge wins; the strongest face is the last resort.
    """
    contents: list[str | None] = []
    for anchor, _ in usable:
        try:
            contents.append(card_content(image, anchor))
        except Exception:  # noqa: BLE001 - a tie-breaker, never a reason to fail
            contents.append(None)

    def edge(anchor: np.ndarray) -> float:
        try:
            return border_contrast(image, _anchored(image, anchor))
        except Exception:  # noqa: BLE001
            return 0.0

    for keep in (lambda content: content == "front", lambda content: content != "portrait"):
        group = [anchor for (anchor, _), content in zip(usable, contents) if keep(content)]
        if group:
            return max(group, key=edge)
    return usable[0][0]


def _anchored(image: np.ndarray, anchor: np.ndarray) -> np.ndarray:
    """The face-anchored card, moved onto the card's own edges where those are clear."""
    snapped = snap_to_edges(image, anchor)
    across, down = _edge_lengths(snapped)
    aspect = max(across, down) / max(min(across, down), 1.0)
    if (
        ID1_ASPECT / ASPECT_TOLERANCE <= aspect <= ID1_ASPECT * ASPECT_TOLERANCE
        and _agrees(snapped, anchor)
        and border_contrast(image, snapped) > border_contrast(image, anchor)
    ):
        return snapped
    return anchor


def candidate_quads(image: np.ndarray, limit: int = 5) -> list[np.ndarray]:
    """The best few card-like quads every detector found, best first and without near-duplicates.
    """
    small, scale = _small(image, DETECT_LONG_SIDE)
    frame_area = float(small.shape[0] * small.shape[1])
    scored: list[tuple[float, np.ndarray]] = []
    for method, builder in (
        ("edges", _masks_edges),
        ("brightness", _masks_brightness),
        ("gradient", _masks_gradient),
        ("texture", _masks_texture),
    ):
        for mask in builder(small):
            for quad in _quads_from_mask(mask, frame_area):
                score = _score(quad, frame_area)
                if score is not None and score >= MIN_SCORE:
                    scored.append((score * _STRATEGY_PRIOR[method], quad))
    kept: list[np.ndarray] = []
    tolerance = 0.03 * max(small.shape[:2])
    for _, quad in sorted(scored, key=lambda item: item[0], reverse=True):
        if all(np.abs(quad - other).max() > tolerance for other in kept):
            kept.append(quad)
        if len(kept) == limit:
            break
    found = [(quad / scale).astype(np.float32) for quad in kept]
    # The contour finders need the card's outline closed all the way round; on a busy table its
    # border runs into whatever touches it and no contour is the card. Its four straight sides are
    # still there to be found one by one.
    lines_tolerance = 0.03 * max(image.shape[:2])
    for quad in line_quads(image):
        if all(np.abs(quad - other).max() > lines_tolerance for other in found):
            found.append(quad)
    return found


# ── The card as four straight lines ─────────────────────────────────────────────────────────────

#: Long side the line search runs at.
LINES_LONG_SIDE = 1000
#: Shortest segment kept, as a share of the long side: a side of a card at a fifth of the photo.
LINE_MIN_SHARE = 0.08
#: Most quads returned, best first.
LINE_QUADS = 4
#: Most distinct lines combined into quads (pairs of pairs: the cost grows with the 4th power).
LINE_LIMIT = 30
#: Share of each side's length that must lie on an edge.
LINE_SUPPORT = 0.55


def _normal_form(segment: np.ndarray) -> tuple[float, float, float]:
    """A segment → (theta in [0, pi), rho, length) of the infinite line through it."""
    x1, y1, x2, y2 = (float(v) for v in segment)
    theta = (np.arctan2(y2 - y1, x2 - x1) + np.pi / 2) % np.pi
    if theta > np.deg2rad(170):
        theta -= np.pi  # near-vertical lines tilted either way stay side by side, not 180 apart
    rho = x1 * np.cos(theta) + y1 * np.sin(theta)
    return theta, rho, float(np.hypot(x2 - x1, y2 - y1))


def _cross(first: tuple[float, float], second: tuple[float, float]) -> np.ndarray | None:
    (t1, r1), (t2, r2) = first, second
    matrix = np.array([[np.cos(t1), np.sin(t1)], [np.cos(t2), np.sin(t2)]])
    if abs(np.linalg.det(matrix)) < 1e-3:
        return None
    return np.linalg.solve(matrix, np.array([r1, r2]))


def _support(edges: np.ndarray, start: np.ndarray, end: np.ndarray) -> float:
    """Share of the segment's middle that runs along an edge pixel."""
    height, width = edges.shape
    points = start + np.linspace(0.1, 0.9, 40)[:, None] * (end - start)
    xs = np.clip(points[:, 0].round().astype(int), 0, width - 1)
    ys = np.clip(points[:, 1].round().astype(int), 0, height - 1)
    return float(edges[ys, xs].mean())


def line_quads(image: np.ndarray) -> list[np.ndarray]:
    """Card-shaped quads made of four long straight edges, best supported first."""
    small, scale = _small(image, LINES_LONG_SIDE)
    grey = cv2.GaussianBlur(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), (5, 5), 0)
    edges = _auto_canny(grey)
    long_side = max(small.shape[:2])
    found = cv2.HoughLinesP(
        edges, 1, np.pi / 180, threshold=60,
        minLineLength=int(LINE_MIN_SHARE * long_side), maxLineGap=int(0.015 * long_side),
    )
    if found is None:
        return []
    # One line per side: segments of the same line merged, the longest kept.
    lines: list[tuple[float, float, float]] = []
    for theta, rho, length in sorted(
        (_normal_form(segment) for segment in found[:, 0]), key=lambda item: -item[2]
    ):
        same = next(
            (i for i, (t, r, _) in enumerate(lines)
             if abs(t - theta) < np.deg2rad(3) and abs(r - rho) < 0.01 * long_side),
            None,
        )
        if same is None:
            lines.append((theta, rho, length))
        if len(lines) == LINE_LIMIT:
            break
    # Pairs of near-parallel lines a card's width or height apart.
    pairs = []
    for i in range(len(lines)):
        for j in range(i + 1, len(lines)):
            (t1, r1, _), (t2, r2, _) = lines[i], lines[j]
            if abs(t1 - t2) <= np.deg2rad(8) and abs(r1 - r2) > 0.04 * long_side:
                pairs.append((lines[i], lines[j]))
    dilated = cv2.dilate(edges, np.ones((5, 5), np.uint8)) > 0
    height, width = small.shape[:2]
    frame_area = float(height * width)
    scored: list[tuple[float, np.ndarray]] = []
    for a in range(len(pairs)):
        for b in range(a + 1, len(pairs)):
            (p1, p2), (q1, q2) = pairs[a], pairs[b]
            angle = abs(p1[0] - q1[0])
            if abs(np.pi / 2 - min(angle, np.pi - angle)) > np.deg2rad(20):
                continue
            corners = [_cross(p[:2], q[:2]) for p, q in ((p1, q1), (p1, q2), (p2, q2), (p2, q1))]
            if any(corner is None for corner in corners):
                continue
            quad = np.asarray(corners, dtype=np.float32)
            outside = (
                (quad[:, 0] < -0.02 * width) | (quad[:, 0] > 1.02 * width)
                | (quad[:, 1] < -0.02 * height) | (quad[:, 1] > 1.02 * height)
            )
            if outside.any():
                continue
            quad = _orient_landscape(order_quad(quad))
            if not cv2.isContourConvex(quad):
                continue
            score = _score(quad, frame_area)
            if score is None:
                continue
            support = min(_support(dilated, quad[k], quad[(k + 1) % 4]) for k in range(4))
            if support < LINE_SUPPORT:
                continue
            # Well-supported sides first; among those the card's proportions, then size, decide.
            scored.append((support * score, quad))
    kept: list[np.ndarray] = []
    for _, quad in sorted(scored, key=lambda item: -item[0]):
        if all(np.abs(quad - other).max() > 0.03 * long_side for other in kept):
            kept.append(quad)
        if len(kept) == LINE_QUADS:
            break
    return [(quad / scale).astype(np.float32) for quad in kept]


def orient_landscape(quad: np.ndarray) -> np.ndarray:
    """Corners labelled along the card's long side: TL, TR, BR, BL of the card lying landscape."""
    return _orient_landscape(order_quad(np.asarray(quad, np.float32)))


def _card_mask_for_borders(bgr: np.ndarray) -> np.ndarray:
    """Binary card-vs-background mask used to trace the border curves during dewarping."""
    mask = _masks_brightness(bgr)[0]
    # Keep only the largest blob: reflections on the surface beside the card also read as
    # 'bright and unsaturated', and tracing a border into one of those bends the correction.
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return mask
    largest = max(contours, key=cv2.contourArea)
    isolated = np.zeros_like(mask)
    cv2.drawContours(isolated, [largest], -1, 255, thickness=cv2.FILLED)
    return isolated


def _fit_border(values: np.ndarray, valid: np.ndarray, degree: int = 2) -> np.ndarray | None:
    """Fit a low-order curve through per-column border samples, discarding outliers once."""
    columns = np.nonzero(valid)[0]
    if columns.size < max(degree + 1, valid.size // 3):
        return None  # too little of the border was visible to trust a fit

    samples = values[columns].astype(np.float64)
    coefficients = np.polyfit(columns, samples, degree)
    residual = samples - np.polyval(coefficients, columns)
    spread = float(np.std(residual))
    if spread > 0:
        keep = np.abs(residual) <= 2.0 * spread
        if keep.sum() >= degree + 1:
            coefficients = np.polyfit(columns[keep], samples[keep], degree)
    return np.polyval(coefficients, np.arange(valid.size))


def _border_curves(mask: np.ndarray) -> tuple[np.ndarray, np.ndarray] | None:
    """Where the card's top and bottom edges actually run, column by column."""
    height, width = mask.shape[:2]
    tops = np.zeros(width, dtype=np.float64)
    bottoms = np.zeros(width, dtype=np.float64)
    valid = np.zeros(width, dtype=bool)

    for x in range(width):
        rows = np.nonzero(mask[:, x])[0]
        # Require the column to carry a real slice of card, not a speck of noise.
        if rows.size < height * 0.25:
            continue
        tops[x], bottoms[x], valid[x] = float(rows[0]), float(rows[-1]), True

    top_curve = _fit_border(tops, valid)
    bottom_curve = _fit_border(bottoms, valid)
    if top_curve is None or bottom_curve is None:
        return None
    return top_curve, bottom_curve


def _bow_of(curve: np.ndarray) -> float:
    """Peak deviation of a curve from the straight line joining its endpoints, in pixels."""
    straight = np.linspace(curve[0], curve[-1], curve.size)
    return float(np.max(np.abs(curve - straight)))


def dewarp(
    padded: np.ndarray, size: tuple[int, int], *, min_bow: float = 0.012
) -> tuple[np.ndarray, float, bool]:
    """Straighten a card that is curled, and leave a flat one alone."""
    width, height = size
    curves = _border_curves(_card_mask_for_borders(padded))
    if curves is None:
        return cv2.resize(padded, (width, height), interpolation=cv2.INTER_CUBIC), 0.0, False

    top_curve, bottom_curve = curves
    span = float(np.mean(bottom_curve - top_curve))
    if span <= 1.0:
        return cv2.resize(padded, (width, height), interpolation=cv2.INTER_CUBIC), 0.0, False

    bow = max(_bow_of(top_curve), _bow_of(bottom_curve)) / span
    if bow < min_bow:
        return cv2.resize(padded, (width, height), interpolation=cv2.INTER_CUBIC), bow, False

    # Resample the traced curves onto the output width, then walk each output column from its
    # true top to its true bottom.
    source_x = np.linspace(0, padded.shape[1] - 1, width)
    top = np.interp(source_x, np.arange(top_curve.size), top_curve)
    bottom = np.interp(source_x, np.arange(bottom_curve.size), bottom_curve)

    v = np.linspace(0.0, 1.0, height, dtype=np.float32).reshape(-1, 1)
    map_x = np.repeat(source_x.astype(np.float32).reshape(1, -1), height, axis=0)
    map_y = (top.reshape(1, -1) + v * (bottom - top).reshape(1, -1)).astype(np.float32)
    corrected = cv2.remap(
        padded, map_x, map_y, interpolation=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
    )
    return corrected, bow, True


def rectify(
    image: np.ndarray, size: tuple[int, int], *, allow_dewarp: bool = True, framed: bool = False
) -> Rectification:
    """Locate the card and flatten it to the canonical rectangle.

    `framed`: the caller already cut the photo down to the card's own outline, so the frame is the
    card. A smaller "card" found inside it is something printed on it (the pyramids, the portrait),
    and trusting it made a sharp, close photo read as "too small" and capped everything it gave.
    """
    width, height = size
    located = locate_card(image)

    frame_height, frame_width = image.shape[:2]
    frame_is_card_shaped = framed or abs(
        float(np.log(frame_width / max(frame_height, 1) / ID1_ASPECT))
    ) <= (float(np.log(PRECROP_TOLERANCE)))
    if located is not None and frame_is_card_shaped:
        # In a frame that is already card-shaped, a "card" covering a minority of it is something
        # printed on the card, in practice the photo, which on a slightly tilted crop measures
        # ~1.4:1 once rolled to landscape and clears MIN_SCORE.
        coverage = float(cv2.contourArea(located[0])) / float(frame_width * frame_height)
        if coverage < PRECROP_MIN_COVERAGE:
            located = None

    if located is None:
        # No card found, but that has two very different meanings, and conflating them is what
        # made the fallback misleading.
        frame_aspect = image.shape[1] / max(image.shape[0], 1)
        precropped = framed or abs(float(np.log(frame_aspect / ID1_ASPECT))) <= float(
            np.log(PRECROP_TOLERANCE)
        )
        return Rectification(
            image=cv2.resize(image, (width, height), interpolation=cv2.INTER_CUBIC),
            method="precropped" if precropped else "frame",
            quad=None,
            aspect=frame_aspect if precropped else None,
            card_width_px=float(image.shape[1]),
        )

    quad, method = located
    card_width, card_height = _edge_lengths(quad)

    if not allow_dewarp:
        target = np.array(
            [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype=np.float32
        )
        warped = cv2.warpPerspective(
            image, cv2.getPerspectiveTransform(quad, target), (width, height), flags=cv2.INTER_CUBIC
        )
        return Rectification(
            image=warped,
            method=method,
            quad=quad,
            aspect=card_width / max(card_height, 1e-6),
            card_width_px=card_width,
        )

    # Warp into a canvas with a margin of background on every side. The margin is what makes the
    # border traceable: an edge is only findable where there is something on its other side.
    margin = 0.08
    pad_x, pad_y = int(width * margin), int(height * margin)
    padded_size = (width + 2 * pad_x, height + 2 * pad_y)
    target = np.array(
        [
            [pad_x, pad_y],
            [pad_x + width - 1, pad_y],
            [pad_x + width - 1, pad_y + height - 1],
            [pad_x, pad_y + height - 1],
        ],
        dtype=np.float32,
    )
    padded = cv2.warpPerspective(
        image, cv2.getPerspectiveTransform(quad, target), padded_size, flags=cv2.INTER_CUBIC
    )
    corrected, bow, applied = dewarp(padded, size)
    return Rectification(
        image=corrected,
        method=method,
        quad=quad,
        aspect=card_width / max(card_height, 1e-6),
        card_width_px=card_width,
        bow=bow,
        dewarped=applied,
    )
