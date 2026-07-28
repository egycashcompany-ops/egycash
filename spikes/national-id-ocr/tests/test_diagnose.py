"""The calibration report — and the promise that it carries no card text.

The privacy property is the reason this endpoint can exist at all: correcting the field boxes
needs a real card, and a real card belongs to a real person. Returning geometry instead of
content is what lets the numbers be shared while the card's contents never leave the container.
That is a property worth a test rather than a comment, because it is the kind of thing a later
"just add the text, it's useful for debugging" change would quietly undo.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr.diagnose import diagnose  # noqa: E402
from nidocr.engine import MockRecognizer  # noqa: E402

FIXTURES = ROOT / "fixtures" / "synthetic"

#: Stand-in detections: one Arabic name line, one Arabic-Indic digit line.
SECRETS = ("محمد احمد على", "٢٩٩٠١٠١٢٣٤٥٦٧٨")
LINES = [
    ([[340, 140], [960, 140], [960, 200], [340, 200]], SECRETS[0], 0.94),
    ([[300, 470], [900, 470], [900, 530], [300, 530]], SECRETS[1], 0.88),
]


@pytest.fixture()
def report():
    front = FIXTURES / "synthetic-000-front.jpg"
    if not front.exists():
        pytest.skip("run `make fixtures` first")
    return diagnose(str(front), MockRecognizer({}, lines=LINES))


def test_carries_no_card_text(report):
    """The whole point: coordinates may be shared, contents may not."""
    blob = json.dumps(report, ensure_ascii=False)
    for secret in (*SECRETS, "29901012345678"):
        assert secret not in blob, f"card text leaked into the diagnose payload: {secret!r}"


def test_regions_are_normalized_fractions(report):
    assert report["regionCount"] == len(LINES)
    for region in report["regions"]:
        assert 0.0 <= region["x"] < 1.0 and 0.0 <= region["y"] < 1.0
        assert 0.0 < region["w"] <= 1.0 and 0.0 < region["h"] <= 1.0
        assert region["x"] + region["w"] <= 1.0001


def test_digit_lines_are_flagged_through_the_arabic_fold(report):
    """The ID prints Arabic-Indic numerals; without folding, `isdigit` would miss them and the
    one region that identifies itself unambiguously would look like ordinary text."""
    digit_regions = [r for r in report["regions"] if r["digits"]]
    assert len(digit_regions) == 1
    assert digit_regions[0]["chars"] == 14  # the national ID's length is its signature


def test_reports_whether_the_card_was_located(report):
    """`rectify` silently resizes the frame when no quad is found. Without this bit, a card that
    was never located is indistinguishable from boxes that are simply misplaced."""
    assert isinstance(report["cardDetected"], bool)


def test_includes_the_current_boxes_for_comparison(report):
    current = report["currentBoxes"]
    assert {b["name"] for b in current["front"]} >= {"fullNameAr", "address", "nationalId"}
    assert current["canonicalSize"] == report["canonicalSize"]
