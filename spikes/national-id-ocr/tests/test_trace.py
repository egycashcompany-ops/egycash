"""The trace has to show the whole chain, and has to be the chain production runs.

Four rounds of this work were spent fixing causes inferred from a final string, and two of those
inferences were wrong. The pipeline has five places it can lose information — a crop cut short, a
line split wrongly, a word that failed detection, a variant that misread a digit, post-processing
that dropped something read correctly — and all five produce the same observable. Reasoning could
not separate them.

Two properties make a trace worth having, and both are asserted here.

**It must be the real path.** A trace assembled by re-implementing the pipeline shows what the
trace does, not what production does. `extract()` takes the collector and fills it as it goes, so
there is one code path and the artefacts come off it.

**It must not lose the link between what was shown and what came back.** The question that has been
unanswerable is "did the recognizer even see this word?", and answering it needs the strip image
and the raw text it produced sitting next to each other, before any cleanup touched the string.
"""

from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from nidocr.engine import MockRecognizer  # noqa: E402
from nidocr.extract import extract  # noqa: E402
from nidocr.trace import NO_TRACE, Trace, render_html  # noqa: E402
from scenes import compose  # noqa: E402

#: A card-shaped quadrilateral in the middle of the scene, roughly ID-1 proportioned.
QUAD = [[300, 250], [1100, 250], [1100, 755], [300, 755]]


def _scene(path: Path) -> str:
    """A photographed card: the pipeline's real input, so rectification runs for real."""
    card = np.full((646, 1024, 3), 232, np.uint8)
    cv2.rectangle(card, (30, 60), (300, 400), (170, 170, 170), -1)  # the photograph
    for top in (140, 230, 320, 500):
        cv2.rectangle(card, (380, top), (980, top + 40), (55, 55, 55), -1)  # printed lines
    cv2.imwrite(str(path), compose(card, QUAD))
    return str(path)


def _labels(trace: Trace) -> list[str]:
    return [entry.label for entry in trace.entries]


def _run(tmp_path, values=None):
    front = _scene(tmp_path / "front.png")
    trace = Trace()
    extract(
        front,
        None,
        MockRecognizer(values or {"fullNameAr": "سلمى إبراهيم", "nationalId": "29503141234567"}),
        trace,
    )
    return trace


# ── Coverage of the chain ──


def test_the_trace_records_every_stage_from_the_original_image_to_the_final_value(tmp_path):
    trace = _run(tmp_path)
    labels = " | ".join(_labels(trace))

    for stage in (
        "00 original",
        "01 rectified",
        "02 quality",
        "03 detected lines",
        "04 anchored boxes",
        "05 boxes drawn",
    ):
        assert stage in labels, f"the trace never recorded {stage}"

    assert "front / fullNameAr / box" in labels
    assert "front / fullNameAr / crop" in labels
    assert "front / fullNameAr / final" in labels
    assert "result / fields" in labels
    assert "result / payload sent to the API" in labels


def test_the_raw_text_is_recorded_before_any_post_processing(tmp_path):
    """The one distinction the whole exercise turns on.

    If the raw read already misses a word, the recognizer is the problem. If the raw read is
    complete and the final value is not, the processing is. A trace that only showed the final
    value could not tell those apart — which is exactly the position four rounds of this were
    argued from.
    """
    trace = _run(tmp_path, {"fullNameAr": "  سلمى   إبراهيم  "})
    raw = [e for e in trace.entries if e.kind == "text" and "fullNameAr" in e.label]
    final = [e for e in trace.entries if e.label == "front / fullNameAr / final"]

    assert raw, "no raw recognizer output was recorded"
    assert "  سلمى   إبراهيم  " in [entry.payload for entry in raw], "the raw text was cleaned first"
    assert final and final[0].payload["value"] == "سلمى إبراهيم", "the final value was not recorded"


def test_the_ensemble_records_every_variant_and_what_it_chose(tmp_path):
    """For the number: each variant's own reading, and the vote that combined them."""
    trace = _run(tmp_path)
    ensemble = [e for e in trace.entries if e.label.endswith("nationalId / ensemble")]
    assert ensemble, "the ensemble never recorded its candidates"

    payload = ensemble[0].payload
    assert payload["candidates"], "no per-variant readings"
    assert {"variant", "digits", "score"} <= set(payload["candidates"][0])
    assert payload["chosen"] is None or {"value", "agreement", "support"} <= set(payload["chosen"])


def test_each_variant_records_the_pixels_it_was_actually_given(tmp_path):
    """Preprocessing is where a digit row is fragmented against the watermark. Seeing the image
    each variant read is what distinguishes 'the crop was wrong' from 'the crop was unreadable'."""
    trace = _run(tmp_path)
    prepared = [e for e in trace.entries if e.kind == "image" and "prepared" in e.label]
    assert len({e.label for e in prepared}) >= 2, "the variants' own inputs were not recorded"


# ── Being off by default ──


def test_a_disabled_trace_records_nothing_and_costs_nothing(tmp_path):
    """Production runs with `NO_TRACE`. Encoding a card's worth of PNGs for nobody is not free."""
    front = _scene(tmp_path / "front.png")
    before = len(NO_TRACE.entries)
    extract(front, None, MockRecognizer({"fullNameAr": "سلمى"}))
    assert len(NO_TRACE.entries) == before


def test_extract_behaves_identically_with_and_without_a_trace(tmp_path):
    """Observation must not change what it observes."""
    front = _scene(tmp_path / "front.png")
    values = {"fullNameAr": "سلمى إبراهيم", "nationalId": "29503141234567"}

    plain = extract(front, None, MockRecognizer(values))
    traced = extract(front, None, MockRecognizer(values), Trace())
    assert plain.as_raw_ocr_result() == traced.as_raw_ocr_result()


# ── The rendered page ──


def test_the_page_is_self_contained_and_carries_its_warning(tmp_path):
    """It has to survive being downloaded out of a container and opened somewhere else."""
    page = render_html(_run(tmp_path))

    assert page.startswith("<!doctype html>")
    assert "data:image/png;base64," in page, "images must be inlined, not linked"
    assert "identity card" in page, "the page must say what it contains"
    assert "Do not attach it" in page


def test_an_empty_read_renders_as_visibly_empty_rather_than_as_nothing():
    """'The recognizer returned nothing' and 'this stage was never reached' look identical when a
    blank string renders as blank. They are different findings."""
    trace = Trace()
    trace.text("front / fullNameAr / raw", "")
    assert "returned nothing" in render_html(trace)


def test_arabic_is_rendered_without_the_browser_reordering_it():
    """A right-to-left string laid out by a left-to-right container reads as a different word
    order, which on this page would look exactly like the bug being investigated."""
    trace = Trace()
    trace.text("front / fullNameAr / raw", "سلمى إبراهيم")
    page = render_html(trace)
    assert "unicode-bidi: plaintext" in page and "class='raw'" in page


def test_text_is_escaped_rather_than_interpolated():
    trace = Trace()
    trace.text("front / fullNameAr / raw", "<script>alert(1)</script>")
    assert "<script>alert(1)</script>" not in render_html(trace)


def test_an_image_that_never_existed_is_skipped_rather_than_breaking_the_page():
    trace = Trace()
    trace.image("front / fullNameAr / crop", None)
    trace.image("front / fullNameAr / strip", np.zeros((0, 0, 3), np.uint8))
    assert trace.entries == []


# ── The artefact the whole exercise turns on ──


class _LineByLine:
    """A recognizer that reports per-line reads, the way `PaddleRecognizer` does."""

    id = "line-by-line"

    def __init__(self, *lines: str) -> None:
        self.lines = lines

    def recognize(self, crop: np.ndarray, *, rtl: bool = True):  # noqa: ARG002
        from nidocr.engine import LineRead, Recognition

        reads = tuple(
            LineRead(text=text, score=0.9, image=np.full((20, 200, 3), 200, np.uint8))
            for text in self.lines
        )
        return Recognition(
            text=" ".join(read.text for read in reads), score=0.9, lines=reads
        )

    def detect_lines(self, image: np.ndarray):  # noqa: ARG002
        return []


def test_each_line_shown_to_the_recognizer_is_recorded_beside_what_it_returned(tmp_path):
    """The question four rounds of inference could not settle: did the recognizer SEE this word?

    A field that comes back short is either a line the recognizer never received or a line it
    received and misread, and those have opposite fixes — but from the final string they are
    identical. The strip image and the raw text it produced have to sit next to each other, or the
    trace answers the same question the final value already did.
    """
    front = _scene(tmp_path / "front.png")
    trace = Trace()
    extract(front, None, _LineByLine("هدى محمد رمضان", "رضوان الحديدي عبده"), trace)

    strips = [e for e in trace.entries if e.kind == "image" and "line 0 (image)" in e.label]
    raw = [e for e in trace.entries if e.kind == "text" and "line 0 (raw" in e.label]

    assert strips, "the strips handed to the recognizer were never recorded"
    assert raw, "the per-line raw text was never recorded"
    assert "هدى محمد رمضان" in [entry.payload for entry in raw]

    joined = [e for e in trace.entries if "raw (joined" in e.label]
    assert "هدى محمد رمضان رضوان الحديدي عبده" in [entry.payload for entry in joined]
