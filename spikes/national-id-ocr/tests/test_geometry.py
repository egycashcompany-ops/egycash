"""Locating and flattening the card — the stage everything else depends on.

These tests exist because of a specific, observed failure: some cards read correctly and some came
back as nonsense, with nothing in the output explaining the difference. The cause was that a single
edge-based detector silently fell back to "use the whole frame", which is correct for an
already-cropped scan and catastrophic for a photograph of a card on a desk. Both went down the same
code path and produced the same shaped result.

So the assertions here are about the two things that were actually wrong: that a card in a
photographed scene is FOUND (against several backgrounds, angles, and a bend), and that when it is
not found the caller can tell — because "already cropped" and "failed to locate" must stop being
indistinguishable.
"""

from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from nidocr.geometry import (  # noqa: E402
    ID1_ASPECT,
    MIN_SCORE,  # noqa: F401 — imported to keep the floor visible alongside the score tests
    _orient_landscape,
    _score,
    locate_card,
    order_quad,
    rectify,
)
from scenes import (  # noqa: E402
    ANGLED,
    DISTANT,
    FLAT,
    ROTATED,
    STEEP,
    compose,
    corner_error,
)

FIXTURES = ROOT / "fixtures" / "synthetic"
CANONICAL = (1024, 646)

pytestmark = pytest.mark.skipif(
    not (FIXTURES / "synthetic-000-front.jpg").exists(), reason="run `make fixtures` first"
)


def _card() -> np.ndarray:
    return cv2.imread(str(FIXTURES / "synthetic-000-front.jpg"))


# ── Locating a card in a scene ──


@pytest.mark.parametrize(
    ("quad", "background", "name"),
    [
        (FLAT, "sand", "flat on sand"),
        (ANGLED, "sand", "hand-held angle"),
        (STEEP, "dark", "steeply off-normal, dark desk"),
        (ROTATED, "white", "rotated on a pale desk"),
        (FLAT, "wood", "flat on wood"),
    ],
)
def test_card_is_located_in_a_photographed_scene(quad, background, name):
    """The corners come back within a few percent of where the card actually is.

    Tolerance is expressed against the card's own width rather than in absolute pixels, because
    what matters downstream is proportional: a field box is placed as a fraction of the card, so
    an error of 2% of card width shifts every crop by 2% regardless of the capture's resolution.
    """
    located = locate_card(compose(_card(), quad, background=background))
    assert located is not None, f"{name}: no card found"

    found, _ = located
    card_width = float(np.linalg.norm(np.asarray(quad[1]) - np.asarray(quad[0])))
    assert corner_error(found, quad) < card_width * 0.05, f"{name}: corners too far off"


def test_a_bent_card_is_located_and_straightened():
    """A curled card is not a plane, so a homography alone cannot flatten it.

    The bow has to be measured and removed, and — equally important — a flat card must NOT be
    resampled for nothing, which the second half of this asserts.
    """
    bent = rectify(compose(_card(), FLAT, background="sand", curl=0.10), CANONICAL)
    assert bent.dewarped, "a visibly bent card was not straightened"
    assert bent.bow > 0.05, "the bow was not measured"

    flat = rectify(compose(_card(), FLAT, background="sand"), CANONICAL)
    assert not flat.dewarped, "a flat card should not pay for a resample"


def test_a_distant_card_is_located_rather_than_dismissed():
    """Small in frame is a quality problem, not a detection problem.

    Reporting "no card found" for a card that is plainly there tells the user nothing they can act
    on. Locating it and letting `quality` say `too_small` tells them to move closer.
    """
    located = locate_card(compose(_card(), DISTANT, background="sand"))
    assert located is not None
    assert corner_error(located[0], DISTANT) < 40


# ── Refusing to find things that are not cards ──


def test_proportions_unlike_a_credential_are_rejected():
    """The aspect filter is the cheapest false-positive defence available, so it must hold.

    Note what it does NOT reject: A4 paper, at 1.414, sits inside the tolerance. That is a
    deliberate consequence of setting the window wide enough for perspective — a card photographed
    steeply really does measure near 1.4 — and it is why aspect is a filter rather than the whole
    decision. Size, the strategy prior and the score floor are what separate a sheet of paper from
    the card lying on it.
    """
    frame_area = 1000.0 * 1000.0
    square = np.float32([[0, 0], [500, 0], [500, 500], [0, 500]])
    long_thin = np.float32([[0, 0], [800, 0], [800, 200], [0, 200]])  # 4:1, a strip, not a card

    assert _score(square, frame_area) is None
    assert _score(long_thin, frame_area) is None


def test_the_card_outscores_a_correctly_proportioned_scrap_inside_it():
    """A printed block that happens to be ID-1-shaped must not beat the card it is printed on.

    This is a regression guard with a real history. Printed regions on the card are often close to
    1.59:1, and while an additive score was in use a 167 px-wide one beat the 1024 px card
    containing it — which is how an image already cropped to a card ended up being 'located' as a
    fragment of itself. Making size multiplicative is what fixed it, so the property under test is
    the comparison, not either score alone.
    """
    frame_area = 1024.0 * 646.0
    scrap = np.float32([[100, 100], [267, 100], [267, 205], [100, 205]])  # perfect ratio, tiny
    # A card filling most of the frame, but not all of it — anything above 99.5% coverage is
    # rejected outright as the photograph's own border rather than an object inside it.
    card = np.float32([[40, 25], [983, 25], [983, 620], [40, 620]])

    scrap_score, card_score = _score(scrap, frame_area), _score(card, frame_area)
    assert scrap_score is not None and card_score is not None
    assert card_score > scrap_score * 2, "size must dominate a merely well-proportioned fragment"


def test_precropped_is_distinguished_from_not_located():
    """The two no-detection outcomes are not the same event and must not report the same way.

    An image already cropped to the card is the ordinary path and warrants no warning. A card
    somewhere inside a frame of a different shape that no detector found means every box is about
    to land on the wrong pixels, and that DOES warrant one.
    """
    precropped = rectify(_card(), CANONICAL)
    assert precropped.method == "precropped"
    assert precropped.located, "an already-cropped card is addressable; nothing is wrong with it"

    # 4:3 — an ordinary phone frame, nowhere near card-shaped, with nothing in it to find.
    blank = np.full((900, 1200, 3), 128, np.uint8)
    missed = rectify(blank, CANONICAL)
    assert missed.method == "frame"
    assert not missed.located


# ── Corner bookkeeping ──


def test_corners_are_ordered_consistently_regardless_of_input_order():
    corners = [[10, 10], [110, 10], [110, 73], [10, 73]]
    for start in range(4):
        rolled = np.float32(corners[start:] + corners[:start])
        assert np.allclose(order_quad(rolled), np.float32(corners))


def test_a_portrait_card_is_relabelled_landscape():
    """A card held upright is still a card; only the corner labels rotate.

    Relabelling rather than rotating pixels keeps this free and lossless. It settles 90 degrees
    only — the 180-degree case is genuinely indistinguishable from geometry and is resolved in
    `extract` by trying both.
    """
    portrait = np.float32([[0, 0], [54, 0], [54, 86], [0, 86]])
    oriented = _orient_landscape(portrait)
    width = np.linalg.norm(oriented[1] - oriented[0])
    height = np.linalg.norm(oriented[3] - oriented[0])
    assert width > height
    assert abs(width / height - ID1_ASPECT) < 0.05
