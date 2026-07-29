"""Finding the card in a photograph, and flattening it.

Everything downstream — the whole field-box approach — rests on this module. If the card is not
located, or is located as the wrong rectangle, then every crop lands on the wrong pixels and no
recognizer quality recovers it. So this is where the accuracy budget is actually spent.

WHY THIS REPLACES THE SINGLE-STRATEGY FINDER. The original `find_card_quad` ran one fixed-threshold
Canny pass and looked for a convex 4-gon. On tightly-cropped scans it found nothing, fell back to
"resize the whole frame", and worked — because for an already-cropped scan the frame *is* the card.
On a photograph of a card lying on a desk or on sand it also found nothing, fell back the same way,
and produced garbage. Two very different outcomes from one silent code path, which is exactly the
"some cards read fine and some do not" pattern. Three things change here:

  1. **Several detectors, scored against each other.** Edges fail on low-contrast backgrounds;
     brightness/saturation fails on a white desk; neither fails on the same inputs. Running all of
     them and picking a winner by score is strictly better than picking one and hoping.
  2. **The ID-1 aspect ratio is a hard filter.** A credential is 85.6 x 53.98 mm. Any quadrilateral
     whose proportions are not close to that — the desk, a sheet of paper, a shadow, the phone
     frame — is rejected outright, however large and rectangular it is. This is the single most
     effective false-positive filter available, and it costs one division.
  3. **The fallback is reported, not hidden.** `Rectification.method` says which detector won, or
     `frame` when none did. A caller that knows the card was never located can say "hold the card
     inside the guides" instead of returning a confidently wrong national ID.

Curl is handled separately, in `dewarp`, because a bent card is not a perspective problem: a
homography maps a plane to a plane, and a card that bows across its width is not one.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

#: ISO/IEC 7810 ID-1, the format every national ID card in Egypt is issued in.
ID1_ASPECT = 85.60 / 53.98  # 1.5858…

#: How far a candidate may stray from ID-1 and still be considered, as a ratio either way.
#: Generous on purpose — perspective foreshortening compresses one axis, and a card photographed
#: from 40 degrees off-normal genuinely measures nearer 1.2 than 1.59. Tighter than this starts
#: rejecting real cards; looser starts admitting A4 paper (1.41) and phone frames (1.33).
ASPECT_TOLERANCE = 1.45

#: How close an UNCROPPED frame's own proportions must be to ID-1 before it is treated as an image
#: already cropped to the card.
#:
#: Much tighter than `ASPECT_TOLERANCE`, and for a concrete reason: that tolerance is generous
#: because perspective genuinely distorts a card's measured shape, but nothing distorts the shape of
#: a deliberate crop. If someone cropped to the card, the result is card-shaped to within a few
#: percent. At the detection tolerance, a 16:9 photograph and a 4:3 photograph both qualify as
#: "already cropped", which would mean a failure to locate the card in an ordinary phone photo gets
#: reported as a success and every field box lands wherever it likes.
PRECROP_TOLERANCE = 1.10

#: Detection runs on a downscaled copy: contour finding is O(pixels), the corners it produces are
#: no more accurate at 4000 px than at 1200, and the final warp samples the ORIGINAL anyway.
DETECT_LONG_SIDE = 1200

#: Smallest fraction of the frame a candidate may cover. Deliberately low. A card occupying 2% of
#: the photograph is far too small to read — but the right answer for it is "we found your card and
#: it is too small, move closer", which `quality.assess` produces from the located card's width.
#: Refusing to locate it instead reports "no card found", which tells the user nothing about what
#: to change. Detection should locate; judging whether it is usable belongs to the quality gate.
MIN_COVERAGE = 0.015

#: Below this score, a candidate is not a card and "not located" is the better answer.
#:
#: Some detector almost always produces *something* — a printed block, a photo, a shadow — and
#: without a floor the best of a bad field wins by default. That is worse than finding nothing:
#: falling back to the frame is correct for an already-cropped scan, whereas warping to a scrap
#: puts every field box on the wrong pixels while reporting a successful detection.
#:
#: Measured, not guessed. On card-in-scene captures the winning candidate scores 0.73-0.94, and on
#: pre-cropped card images where the only candidates are printed elements inside the card it scores
#: 0.02-0.03. The gap is wide, and 0.15 sits in it — far enough above the noise to exclude it, far
#: enough below the real cards to keep even a small, badly-angled one (which the quality gate then
#: judges on its own terms).
MIN_SCORE = 0.15


@dataclass(frozen=True)
class Rectification:
    """A located, flattened card plus everything needed to judge how much to trust it."""

    image: np.ndarray
    #: Which detector won: 'edges' | 'brightness' | 'gradient' | 'texture', or one of the two
    #: no-detection outcomes — 'precropped' (the frame is already card-shaped, nothing to find) and
    #: 'frame' (a card should have been in there somewhere and was not located).
    method: str
    #: Corners in the ORIGINAL image, ordered TL, TR, BR, BL. None when the card was not located.
    quad: np.ndarray | None
    #: Measured width/height of the found quad. None when not located.
    aspect: float | None
    #: The card's width in original-image pixels — the true resolution budget for recognition.
    #: Measured on the source, not the canonical output, which is always 1024 px wide by definition.
    card_width_px: float
    #: Peak deviation of the card's border from a straight line, as a fraction of card height.
    bow: float = 0.0
    #: Whether the curl correction was actually applied (it is skipped on flat cards).
    dewarped: bool = False

    @property
    def located(self) -> bool:
        """Whether the geometry can be trusted.

        True for a detected card and for an already-cropped frame alike: in both cases the field
        boxes are addressing the card. Only the genuine failure — a card somewhere in a larger
        scene that no detector found — is False.
        """
        return self.method != "frame"


def order_quad(points: np.ndarray) -> np.ndarray:
    """Order 4 points as top-left, top-right, bottom-right, bottom-left.

    Uses coordinate sums/differences rather than angles: it is branch-free and stable when the
    card is photographed at an angle steep enough that "topmost point" stops meaning "top-left".
    """
    ordered = np.zeros((4, 2), dtype=np.float32)
    s = points.sum(axis=1)
    d = np.diff(points, axis=1).ravel()
    ordered[0] = points[np.argmin(s)]  # top-left — smallest x+y
    ordered[2] = points[np.argmax(s)]  # bottom-right — largest x+y
    ordered[1] = points[np.argmin(d)]  # top-right — smallest y−x
    ordered[3] = points[np.argmax(d)]  # bottom-left — largest y−x
    return ordered


def _edge_lengths(quad: np.ndarray) -> tuple[float, float]:
    """Mean horizontal and mean vertical edge length of an ordered quad.

    Averaging the opposing pair absorbs perspective: in a photograph the near edge is longer than
    the far one, and their mean is a far better estimate of the true dimension than either.
    """
    top = float(np.linalg.norm(quad[1] - quad[0]))
    bottom = float(np.linalg.norm(quad[2] - quad[3]))
    left = float(np.linalg.norm(quad[3] - quad[0]))
    right = float(np.linalg.norm(quad[2] - quad[1]))
    return (top + bottom) / 2.0, (left + right) / 2.0


def _orient_landscape(quad: np.ndarray) -> np.ndarray:
    """Re-label the corners so the card's long side is horizontal.

    A card photographed portrait is still a card; only the corner *labels* are rotated. Rolling the
    ordering by one turns the left edge into the top edge, which is a relabelling rather than a
    resample and therefore free and lossless.

    Applied to every candidate BEFORE scoring, not just to the winner. Scoring compares a quad's
    proportions against ID-1, and a portrait card measures 0.63 against a target of 1.59 — so an
    unoriented candidate is rejected as not-a-card, and a card held upright is never located at
    all. Orienting first makes the aspect test measure the card's shape rather than the
    photographer's grip.

    This settles 90-degree rotation only. A card that is upside down produces the same quad, and
    geometry alone cannot tell the difference — that is resolved in `extract` by trying both and
    keeping whichever read produces a structurally valid national ID.
    """
    width, height = _edge_lengths(quad)
    if height > width:
        return np.roll(quad, -1, axis=0)
    return quad


def _auto_canny(gray: np.ndarray, sigma: float = 0.33) -> np.ndarray:
    """Canny with thresholds derived from the image's own median intensity.

    The fixed 40/140 pair this replaces was tuned on synthetic fixtures rendered at a known
    exposure. A phone photo in shade, or a card on bright sand, has a completely different
    intensity distribution, and fixed thresholds there produce either a blank edge map or a solid
    one. Anchoring to the median makes the operator exposure-invariant, which is the whole problem.
    """
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
    """'Bright and unsaturated' as a single channel — what card stock is and most surfaces are not.

    Egyptian ID stock is pale — cream and light blue — and laminated, so it reflects. Desks, hands,
    sand and cloth are all either darker, more saturated, or both. Multiplying value by inverse
    saturation makes that one number, and Otsu then finds the split without a hand-set threshold.
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
    """Segment on brightness, in BOTH polarities.

    Otsu splits the image into two regions; which one is the card depends entirely on what it is
    lying on. On a desk or on sand the card is the brighter region. On a sheet of white paper — or
    a light table, or a phone screenshot on a white page — the card is the *darker* region, and
    the bright region is the background with a card-shaped hole in it. Taking only one polarity
    means the second case returns the whole frame as its largest external contour, which the
    coverage check then rejects, and the card is reported as not found on a perfectly good capture.

    Both polarities cost one bitwise NOT, and the scorer picks whichever produced something
    card-shaped, so there is no need to decide up front which case we are in.
    """
    _, mask = cv2.threshold(_cardness(bgr), 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    return _clean(mask), _clean(cv2.bitwise_not(mask))


def _masks_edges(bgr: np.ndarray) -> tuple[np.ndarray, ...]:
    return (_mask_edges(bgr),)


def _masks_gradient(bgr: np.ndarray) -> tuple[np.ndarray, ...]:
    return (_mask_gradient(bgr),)


def _masks_texture(bgr: np.ndarray) -> tuple[np.ndarray, ...]:
    """Segment on local texture: the card is printed, and the surface under it usually is not.

    This is the detector of last resort, and it keys on a property none of the others use. A card
    lying on a pale desk under flat light can be almost the same brightness as the desk and have
    almost no border gradient — brightness and edges both come back empty. But the card carries
    text, a photograph, and a guilloche pattern, while the desk carries none, and local standard
    deviation separates those cleanly no matter how close the two are in tone.

    The closing kernel is large on purpose: it has to bridge the blank card stock *between* printed
    lines so the scattered high-variance regions merge into one card-shaped blob rather than
    staying a constellation of word-sized ones.

    Its corners are the least precise of the four, because the printed area is inset from the card
    edge — so it is offered as a candidate rather than trusted, and the scorer prefers a
    better-proportioned quad from another detector whenever one exists.
    """
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
    """Otsu over Scharr gradient magnitude — a softer edge detector than Canny.

    Canny's non-maximum suppression discards a border that fades gradually, which is exactly what a
    rounded, worn card corner looks like under diffuse light. Gradient magnitude keeps it.
    """
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
    """Every plausible quadrilateral in a binary mask, largest contours first.

    Each contour is offered at several polygon-approximation tolerances and, failing all of them,
    as its minimum-area rotated rectangle. One epsilon is not enough: a clean scan simplifies to
    exactly 4 points at 0.02, while a card with a rounded corner or a nicked edge needs 0.04, and
    a card whose border is partly occluded never reduces to 4 points at all — which is what
    `minAreaRect` is for. Offering all of them and letting the scorer choose costs microseconds.
    """
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


#: How far each detector's verdict is trusted when several produce a candidate. Not all evidence is
#: equal: an explicit border found by `edges` or `gradient` IS the card's outline, while `texture`
#: infers the outline from where the printing is and therefore reports the printed area, which is
#: inset and can be badly wrong when the printing is sparse. Demoting it means it still rescues the
#: captures nothing else can find, without outvoting a detector that actually saw the border.
_STRATEGY_PRIOR = {"edges": 1.0, "gradient": 1.0, "brightness": 0.95, "texture": 0.7}


def _score(quad: np.ndarray, frame_area: float) -> float | None:
    """How much this quadrilateral looks like a card, in [0, 1]. None means 'rejected outright'.

    Proportion and size are combined MULTIPLICATIVELY, and that is the important part. An additive
    score lets a beautifully ID-1-proportioned scrap outrank the actual card: the printed photo on
    the card front, a logo, or a block of text is often close to 1.59:1, and adding a small
    coverage term to a perfect aspect term still beats a frame-filling card whose aspect the
    perspective skewed. That is not hypothetical — it is what put a 167 px-wide 'card' inside a
    1024 px image already cropped to one.

    Multiplying requires both to hold. Coverage saturates at about a third of the frame, because
    past that point more is not better — a user who framed the card deliberately and one who
    filled the viewfinder with it should score alike — but below it the penalty climbs steeply,
    which is exactly where the small false positives live.
    """
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
    """The card's four corners in `image`, with the detector that found them. None if not found.

    Returning None rather than a guess is deliberate. Falling back to "use the whole frame" is
    correct when the caller already cropped to the card, and a wrong quad is far worse than none
    because it silently warps every field box off target — so the caller is told which happened.
    """
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
    """Fit a low-order curve through per-column border samples, discarding outliers once.

    Degree 2 because a card curls; it does not ripple. A higher order would happily fit the noise
    from a nicked edge or a finger over the border and bend the image around it, which looks like
    successful dewarping and is not. The single refit pass removes the columns the first fit could
    not explain — typically a thumb or a shadow — and then re-solves on what is left.
    """
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
    """Straighten a card that is curled, and leave a flat one alone.

    A perspective warp maps a plane onto a plane. A card bent across its width is not a plane, so
    even with perfect corners its middle bows and its text lines curve — the boxes drift toward
    the centre of the card and the recognizer is handed curved baselines, which is the failure the
    user sees as "it works when the card is flat".

    The correction is a column-wise stretch: trace where the top and bottom edges really run, then
    map each column's span onto the full canonical height. That is the right model for this
    deformation, because a card bends about one axis — it curls, it does not crumple — so every
    column stays a straight segment and only its endpoints move.

    Input is expected to carry a margin of background around the card, since a border can only be
    traced where there is something on the other side of it to contrast against.

    Returns (image, bow, applied). Below `min_bow` nothing is applied: resampling a flat card
    costs a little sharpness and buys nothing, and this runs on every capture.
    """
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
    image: np.ndarray, size: tuple[int, int], *, allow_dewarp: bool = True
) -> Rectification:
    """Locate the card and flatten it to the canonical rectangle.

    When no card is found the frame is resized instead — many captures arrive already cropped to
    the card, and failing those would be worse than proceeding. The difference is recorded in
    `method` rather than swallowed, so a caller can tell "the boxes are misaligned" from "the card
    was never located", which look identical in the output and have completely different fixes.
    """
    width, height = size
    located = locate_card(image)

    if located is None:
        # No card found — but that has two very different meanings, and conflating them is what
        # made the fallback misleading. If the frame ITSELF is card-shaped, the caller handed us an
        # image already cropped to the card (a scan, or a capture cropped in the UI), detection had
        # nothing to find, and resizing is exactly right. If the frame is some other shape, there
        # really is a card somewhere in a larger scene and we failed to locate it, which means every
        # field box is about to land on the wrong pixels. Only the second deserves a warning.
        frame_aspect = image.shape[1] / max(image.shape[0], 1)
        precropped = abs(float(np.log(frame_aspect / ID1_ASPECT))) <= float(
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
