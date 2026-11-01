"""Locating and flattening the card, the stage everything else depends on."""

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
    find_card_outline,
    MIN_SCORE,  # noqa: F401 - imported to keep the floor visible alongside the score tests
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
    """The corners come back within a few percent of where the card actually is."""
    located = locate_card(compose(_card(), quad, background=background))
    assert located is not None, f"{name}: no card found"

    found, _ = located
    card_width = float(np.linalg.norm(np.asarray(quad[1]) - np.asarray(quad[0])))
    assert corner_error(found, quad) < card_width * 0.05, f"{name}: corners too far off"


def test_a_bent_card_is_located_and_straightened():
    """A curled card is not a plane, so a homography alone cannot flatten it."""
    bent = rectify(compose(_card(), FLAT, background="sand", curl=0.10), CANONICAL)
    assert bent.dewarped, "a visibly bent card was not straightened"
    assert bent.bow > 0.05, "the bow was not measured"

    flat = rectify(compose(_card(), FLAT, background="sand"), CANONICAL)
    assert not flat.dewarped, "a flat card should not pay for a resample"


def test_a_distant_card_is_located_rather_than_dismissed():
    """Small in frame is a quality problem, not a detection problem."""
    located = locate_card(compose(_card(), DISTANT, background="sand"))
    assert located is not None
    assert corner_error(located[0], DISTANT) < 40


# ── Refusing to find things that are not cards ──


def test_proportions_unlike_a_credential_are_rejected():
    """The aspect filter is the cheapest false-positive defence available, so it must hold."""
    frame_area = 1000.0 * 1000.0
    square = np.float32([[0, 0], [500, 0], [500, 500], [0, 500]])
    long_thin = np.float32([[0, 0], [800, 0], [800, 200], [0, 200]])  # 4:1, a strip, not a card

    assert _score(square, frame_area) is None
    assert _score(long_thin, frame_area) is None


def test_the_card_outscores_a_correctly_proportioned_scrap_inside_it():
    """A printed block that happens to be ID-1-shaped must not beat the card it is printed on."""
    frame_area = 1024.0 * 646.0
    scrap = np.float32([[100, 100], [267, 100], [267, 205], [100, 205]])  # perfect ratio, tiny
    # A card filling most of the frame, but not all of it, anything above 99.5% coverage is
    # rejected outright as the photograph's own border rather than an object inside it.
    card = np.float32([[40, 25], [983, 25], [983, 620], [40, 620]])

    scrap_score, card_score = _score(scrap, frame_area), _score(card, frame_area)
    assert scrap_score is not None and card_score is not None
    assert card_score > scrap_score * 2, "size must dominate a merely well-proportioned fragment"


def test_precropped_is_distinguished_from_not_located():
    """The two no-detection outcomes are not the same event and must not report the same way."""
    precropped = rectify(_card(), CANONICAL)
    assert precropped.method == "precropped"
    assert precropped.located, "an already-cropped card is addressable; nothing is wrong with it"

    # 4:3, an ordinary phone frame, nowhere near card-shaped, with nothing in it to find.
    blank = np.full((900, 1200, 3), 128, np.uint8)
    missed = rectify(blank, CANONICAL)
    assert missed.method == "frame"
    assert not missed.located


@pytest.mark.parametrize("path", sorted(FIXTURES.glob("synthetic-*-front.jpg")), ids=lambda p: p.stem)
def test_printed_photo_on_a_tilted_crop_is_not_taken_for_the_card(path):
    """A slightly tilted card-shaped crop: the printed photo clears MIN_SCORE, the card does not.
    """
    result = rectify(cv2.imread(str(path)), CANONICAL)
    assert result.method == "precropped", f"located {result.method} quad {result.quad}"


# ── Corner bookkeeping ──


def test_corners_are_ordered_consistently_regardless_of_input_order():
    corners = [[10, 10], [110, 10], [110, 73], [10, 73]]
    for start in range(4):
        rolled = np.float32(corners[start:] + corners[:start])
        assert np.allclose(order_quad(rolled), np.float32(corners))


def test_a_portrait_card_is_relabelled_landscape():
    """A card held upright is still a card; only the corner labels rotate."""
    portrait = np.float32([[0, 0], [54, 0], [54, 86], [0, 86]])
    oriented = _orient_landscape(portrait)
    width = np.linalg.norm(oriented[1] - oriented[0])
    height = np.linalg.norm(oriented[3] - oriented[0])
    assert width > height
    assert abs(width / height - ID1_ASPECT) < 0.05


# ── The outline shown on the test page ──
#
# Shown, not read: the outline the page draws must sit on the card's own edges, because a few
# percent off shows as a strip of table or a sliver of card cut away.


@pytest.mark.parametrize(
    ("quad", "background"),
    [(FLAT, "sand"), (ANGLED, "sand"), (STEEP, "dark"), (ROTATED, "white"), (FLAT, "wood")],
)
def test_the_outline_sits_on_the_cards_edges(quad, background):
    outline = find_card_outline(compose(_card(), quad, background=background))
    assert outline is not None
    # Within 1.5 % of the scene's width at every corner.
    assert corner_error(order_quad(outline), quad) < 0.015 * 1400


def test_a_card_running_off_the_photo_is_outlined_whole():
    """Cut by the frame, the card's outline is the frame there, never a line through the card."""
    card = _card()
    height, width = card.shape[:2]
    photo = cv2.copyMakeBorder(card[: int(height * 0.95)], 0, 40, 30, 30, cv2.BORDER_CONSTANT, value=(40, 90, 200))
    outline = find_card_outline(photo)
    assert outline is not None
    top = min(outline[:, 1])
    assert top < 0.01 * photo.shape[0]


def test_a_photo_without_a_card_has_no_outline():
    plain = np.full((900, 1200, 3), (70, 120, 160), np.uint8)
    assert find_card_outline(plain) is None


def test_a_face_anchor_that_looks_like_a_card_front_beats_a_stronger_one_that_is_just_a_face(monkeypatch):
    # A card photographed on its side: the face detector's strongest find came from the wrong turn
    # and laid a landscape card across the portrait and the table; a weaker find was the card.
    import numpy as np
    from nidocr import geometry

    wrong, right, other = (np.full((4, 2), v, np.float32) for v in (1.0, 2.0, 3.0))
    seen = {1.0: "portrait", 2.0: "front", 3.0: None}
    monkeypatch.setattr(geometry, "card_content", lambda image, quad: seen[float(quad[0, 0])])
    monkeypatch.setattr(geometry, "_anchored", lambda image, anchor: anchor)
    monkeypatch.setattr(geometry, "border_contrast", lambda image, quad: 1.0)
    image = np.zeros((10, 10, 3), np.uint8)
    assert geometry._best_anchor(image, [(wrong, 6.5), (other, 5.0), (right, 4.6)]) is right
    # No front among them: anything but a bare face, then the strongest as before.
    assert geometry._best_anchor(image, [(wrong, 6.5), (other, 5.0)]) is other
    assert geometry._best_anchor(image, [(wrong, 6.5)]) is wrong


def test_among_card_fronts_the_one_on_the_cards_own_edges_wins(monkeypatch):
    # Every anchor is built around a face, so a false face in the address text also looks like a
    # 'front'. The real card is the one whose outline meets the card's border.
    import numpy as np
    from nidocr import geometry

    false_face, card = (np.full((4, 2), v, np.float32) for v in (1.0, 2.0))
    monkeypatch.setattr(geometry, "card_content", lambda image, quad: "front")
    monkeypatch.setattr(geometry, "_anchored", lambda image, anchor: anchor)
    monkeypatch.setattr(geometry, "border_contrast", lambda image, quad: {1.0: 3.2, 2.0: 5.1}[float(quad[0, 0])])
    image = np.zeros((10, 10, 3), np.uint8)
    assert geometry._best_anchor(image, [(false_face, 5.5), (card, 4.6)]) is card
