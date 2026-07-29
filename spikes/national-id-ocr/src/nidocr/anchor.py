"""Move the field boxes onto the text that is actually there.

The field-box approach assumes the card's print geometry is fixed, and it is — but only for one
card design, rectified perfectly. Neither assumption survives contact with real captures:

  * Rectification is good, not exact. A few pixels of corner error, a residual degree of skew, or a
    card whose curl the dewarp only partly removed, and every box sits slightly off its line.
  * Egypt has issued more than one card design. The 2007-era cards still in circulation put their
    fields in different places from current stock, and a profile calibrated on one lands on blank
    laminate on the other.
  * A profile is calibrated from a handful of cards. Print tolerance across issuing offices and
    across a decade is wider than that sample.

A box that misses returns an empty string, which in an accuracy table is indistinguishable from
"the model cannot read Arabic" — and the two have completely different fixes. So rather than
trusting the geometry, this module uses it as a *prior* and corrects it against what detection
actually found on the card.

Two mechanisms, in increasing order of independence from the layout:

  1. **Snapping** keeps the nominal box's identity but takes its extent from the detected lines
     near it. This absorbs the small errors — a few percent of drift — that are otherwise fatal.
  2. **Structural assignment** ignores geometry altogether for the two fields whose content
     identifies them: a line of exactly fourteen digits is the national ID wherever it is printed,
     and a full year/month/day is the expiry. This is what lets an unfamiliar card design still
     yield its most important field.

Both refuse to act when the evidence is ambiguous, for the same reason the rest of the pipeline
does: a field left visibly rough gets re-read by the reviewer, and a field confidently filled with
the wrong value does not.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

import numpy as np

from .arabic import rasm_fold, to_western_digits
from .boilerplate import is_boilerplate
from .layout import FieldBox
from .postprocess import MARITAL_TERMS as _MARITAL_TERMS
from .postprocess import RELIGION_TERMS as _RELIGION_TERMS

#: A detected line as the recognizers report it: (polygon, text, score).
Line = tuple[Any, str, float]

#: A normalized (x, y, w, h).
Rect = tuple[float, float, float, float]


@dataclass(frozen=True)
class Anchoring:
    """Where each field will actually be cropped from, and on what evidence."""

    boxes: dict[str, FieldBox]
    #: field → 'nominal' | 'snapped' | 'structural'. Reported so a card that needed heavy
    #: correction is visible as such rather than looking like a clean read.
    sources: dict[str, str]

    def source_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for source in self.sources.values():
            counts[source] = counts.get(source, 0) + 1
        return counts


def _rect(poly: Any, size: tuple[int, int]) -> tuple[float, float, float, float] | None:
    """A detection polygon as a normalized (x, y, w, h), or None if it cannot be read."""
    try:
        points = np.asarray(poly, dtype=float).reshape(-1, 2)
    except (TypeError, ValueError):
        return None
    if points.size == 0:
        return None
    width, height = size
    xs, ys = points[:, 0] / width, points[:, 1] / height
    left, right = float(xs.min()), float(xs.max())
    top, bottom = float(ys.min()), float(ys.max())
    if right <= left or bottom <= top:
        return None
    return left, top, right - left, bottom - top


@dataclass(frozen=True)
class _Region:
    """One line of text as this module wants it: a rectangle and what is written in it."""

    rect: Rect
    text: str


#: Two fragments closer than this many line-heights apart, horizontally, are words of one line.
#: A word gap on printed text is a fraction of the line's height; the gap between two *fields* on
#: one row is several times it. Anything in between is rare enough that erring toward merging is
#: safe — a merged region is still one region, whereas a fragment left alone can be lost entirely.
MERGE_GAP_LINES = 1.2


def _merge_rows(regions: list[_Region], size: tuple[int, int]) -> list[_Region]:
    """Join detection fragments that are words of the same printed line.

    Detection returns text REGIONS; anchoring wants LINES, and on Arabic they are not the same
    thing. A four-word name comes back as one region on one card and as two or three on the next,
    depending on how wide the word gaps happen to be — and a fragment is not merely a smaller box,
    it is a box in a different PLACE. `عبده` at the far left end of a name line has its centre
    nowhere near the centre of the line it belongs to, so a field box that comfortably contains the
    line rejects the fragment, and the name comes back with its last word missing. That is not a
    recognition failure and no amount of confidence banding reveals it: every word returned is
    correct, and the one that was dropped was never read.

    Merging first makes the rest of the module see the line the way the card prints it. Fragments
    are grouped into rows by vertical centre — within half a line, the same tolerance drift uses —
    and then merged along the row while the gaps stay word-sized.
    """
    if len(regions) < 2:
        return regions

    line_height = _median_line_height([region.rect for region in regions])
    # Heights are fractions of the card's HEIGHT and gaps are fractions of its WIDTH, so the
    # threshold has to cross between the two axes or it means something different on every card.
    gap_limit = line_height * MERGE_GAP_LINES * size[1] / max(size[0], 1)

    rows: list[list[_Region]] = []
    for region in sorted(regions, key=lambda item: item.rect[1]):
        centre = region.rect[1] + region.rect[3] / 2.0
        for row in rows:
            row_centre = float(np.mean([r.rect[1] + r.rect[3] / 2.0 for r in row]))
            if abs(centre - row_centre) <= line_height / 2.0:
                row.append(region)
                break
        else:
            rows.append([region])

    merged: list[_Region] = []
    for row in rows:
        row.sort(key=lambda item: item.rect[0])
        group = [row[0]]
        for region in row[1:]:
            previous = group[-1]
            gap = region.rect[0] - (previous.rect[0] + previous.rect[2])
            if gap <= gap_limit:
                group.append(region)
            else:
                merged.append(_join(group))
                group = [region]
        merged.append(_join(group))
    return merged


def _join(group: list[_Region]) -> _Region:
    """One region from several. Text runs right to left, as the card is printed.

    The joined text is only ever read by predicates that do not care about word order — a digit
    count, a date pattern, a vocabulary term — so the order is chosen for legibility in a log rather
    than for correctness. Field VALUES never come from here: they are recognized again from the
    crop, by `extract`.
    """
    if len(group) == 1:
        return group[0]
    return _Region(_union([region.rect for region in group]), " ".join(
        region.text for region in sorted(group, key=lambda item: item.rect[0], reverse=True)
    ))


def _prepare(lines: list[Line], size: tuple[int, int]) -> list[_Region]:
    """Detected lines → the regions anchoring reasons about.

    Three steps, and the middle one is the one that changes behaviour: lines that hold nothing but
    printed card furniture are DROPPED. 'بطاقة تحقيق الشخصية' sits directly above the name on every
    Egyptian card, and a name box generous enough not to clip a long name is generous enough to
    reach it. Since the phrase belongs to the card rather than to the holder, the cheapest correct
    answer is to stop treating it as text at all — then the box can be as generous as the name
    needs without the header ever being able to pull it upward.

    A label that PRECEDES a value — 'البطاقة سارية حتى ٢٠٢٢/٠٧/٠٤' — is not furniture and stays,
    because dropping it would take the expiry with it. `boilerplate.is_boilerplate` draws that line.
    """
    regions = [
        _Region(rect, text)
        for rect, text in ((_rect(poly, size), text) for poly, text, _ in lines)
        if rect is not None
    ]
    regions = [region for region in regions if not is_boilerplate(region.text)]
    return _merge_rows(regions, size)


def _overlaps(
    rect: tuple[float, float, float, float], box: FieldBox, margin: float, line_height: float
) -> bool:
    """Is this line's centre inside the box, allowing for a little drift?

    Centre containment rather than rectangle intersection: a long address line legitimately extends
    past a conservatively-drawn box, and intersection would then also catch the neighbouring line
    that merely grazes the box's edge. The centre is where the line *is*.

    VERTICAL SLACK IS MEASURED IN TEXT LINES, NOT IN BOX HEIGHTS, and that distinction is the whole
    correctness of this function. Scaling the slack to the box made the search area grow with the
    box: the two-line name box is 0.20 of the card tall, so a 35% margin reached 0.07 beyond it —
    and a line of print on this card is about 0.07 tall. The box was therefore reaching exactly one
    full line too far in each direction, so it swallowed the 'بطاقة تحقيق الشخصية' header above it
    and the address line below. Anchoring, added to correct small drift, was re-assigning whole
    lines instead.

    Half a line is the right unit because it is what "drift" means here: a box that has slipped by
    less than half a line still belongs to its own text, and one that has slipped by more than that
    is pointing at its neighbour's.
    """
    x, y, w, h = rect
    centre_x, centre_y = x + w / 2.0, y + h / 2.0
    slack_y = min(box.h * margin, line_height * 0.5)
    return (
        box.x - box.w * margin <= centre_x <= box.x + box.w * (1.0 + margin)
        and box.y - slack_y <= centre_y <= box.y + box.h + slack_y
    )


def _clamp_to(
    rect: tuple[float, float, float, float], box: FieldBox, line_height: float
) -> tuple[float, float, float, float]:
    """Fit the crop to the detected lines VERTICALLY, and never narrow it horizontally.

    The two axes are not symmetric on this card, and treating them as if they were is what cost a
    name its last word.

    VERTICALLY, tightening is the entire point. Fields are stacked one above another a line apart,
    so a crop that spans more rows than it should picks up the neighbouring field's text — and a
    detection polygon that runs tall (a stray mark, a piece of the guilloche) would drag it there.
    So the vertical extent comes from the detected lines, bounded to within one line of where the
    profile said the field is: the box may move, but it may not travel to a different line.

    HORIZONTALLY, tightening buys nothing and costs words. Nothing is printed beside the name, the
    address or the number — the space to their left is blank card — so a narrower crop excludes no
    neighbour. What it does exclude is any part of the line DETECTION ITSELF MISSED, and that is not
    hypothetical: a short word at the end of a right-aligned line is exactly what a detector drops,
    and snapping then rewrote the generous nominal box into a tight one that made the word
    unrecoverable. The crop stopped where detection stopped, so recognition never saw the pixels
    and no amount of re-reading could help. Anchoring exists to correct drift, not to trim, and a
    horizontal union with the nominal box keeps it to that.
    """
    x, y, w, h = rect
    top = max(y, box.y - line_height)
    bottom = min(y + h, box.y + box.h + line_height)
    if bottom <= top:
        top, bottom = y, y + h
    left = min(x, box.x)
    right = max(x + w, box.x + box.w)
    return left, top, right - left, bottom - top


def _union(rects: list[tuple[float, float, float, float]]) -> tuple[float, float, float, float]:
    left = min(r[0] for r in rects)
    top = min(r[1] for r in rects)
    right = max(r[0] + r[2] for r in rects)
    bottom = max(r[1] + r[3] for r in rects)
    return left, top, right - left, bottom - top


def _pad(
    rect: tuple[float, float, float, float], amount: float = 0.04
) -> tuple[float, float, float, float]:
    """Grow a rect slightly. Detection polygons hug the ink, and a crop taken exactly on that
    boundary shaves the ascenders and the dots off the top line — which is the same information
    loss the whole pipeline is trying to avoid."""
    x, y, w, h = rect
    grow_x, grow_y = w * amount, h * amount
    return (
        max(0.0, x - grow_x),
        max(0.0, y - grow_y),
        min(1.0 - max(0.0, x - grow_x), w + 2 * grow_x),
        min(1.0 - max(0.0, y - grow_y), h + 2 * grow_y),
    )


#: A crop that grew past this multiple of its nominal area has almost certainly swallowed the
#: neighbouring field. Recognizing two fields as one produces a confident string that is wrong in a
#: way no confidence score reflects, so the snap is abandoned and the nominal box kept.
MAX_GROWTH = 2.5

_FULL_DATE = re.compile(r"\d{4}\s*[/\-.]\s*\d{1,2}\s*[/\-.]\s*\d{1,2}")

#: Structurally-found fields keep their nominal recognition kind; the two digit ones are digits.
_KIND = {"nationalId": "digits", "nationalIdExpiry": "digits"}


def _mentions(text: str, terms: tuple[str, ...]) -> bool:
    """Does this line carry one of a closed vocabulary's terms, allowing for dropped dots?"""
    folded = rasm_fold(text)
    return any(rasm_fold(term) in folded for term in terms)


def _carries_a_national_id(folded: str) -> bool:
    """Does this line hold the fourteen-digit number — in either of the two forms it appears in?

    The two sides print it differently, and a rule written for one misses the other:

      * The FRONT spaces it into groups — `٢٩٢ ٠٨ ١٥ ١٢ ٠٣٤ ٥٧` — so the line has no unbroken run
        of fourteen, but its digits total fourteen and nothing else is on the line.
      * The BACK puts it beside the issue date — `٢٠١٥/٠٧    ٢٩٢٠٨١٥١٢٠٣٤٥٧` — which detection
        returns as one region totalling twenty digits, but with the number intact as a single run.

    So either signal counts. Requiring only the total missed the back, which is not a cosmetic
    loss: the number is printed on BOTH sides, and reading it twice is the only check in this
    pipeline that can catch a wrong digit in positions 10-14, where the structure constrains
    nothing and a misread yields a different, valid-looking person. A real card came back with ٢
    read as ٣ at position 11 — birth date, gender and governorate all decoded correctly, and the
    number belonged to somebody else. The back would have disagreed, had it been read.

    Runs are bounded by non-digits on purpose, so a fourteen-digit window inside a longer number
    does not match.
    """
    runs = re.findall(r"\d+", folded)
    return sum(len(run) for run in runs) == 14 or any(len(run) == 14 for run in runs)

#: Fallback when detection found nothing to measure — roughly one printed line on an ID-1 card.
DEFAULT_LINE_HEIGHT = 0.07


def _median_line_height(rects: list[tuple[float, float, float, float]]) -> float:
    """How tall a line of print is on THIS card, as a fraction of its height.

    Measured rather than assumed, because it is the unit every tolerance in this module is
    expressed in, and it genuinely varies — between card generations, and with how much of the
    frame the card occupies. The median ignores the outliers that matter here: a single detection
    that merged two lines, or one that caught a stray mark.
    """
    heights = [h for _, _, _, h in rects if h > 0]
    return float(np.median(heights)) if heights else DEFAULT_LINE_HEIGHT


def snap(
    boxes: tuple[FieldBox, ...], lines: list[Line], size: tuple[int, int], *, margin: float = 0.35
) -> tuple[dict[str, FieldBox], dict[str, str]]:
    """Fit each nominal box to the detected lines around it."""
    rects = [region.rect for region in _prepare(lines, size)]
    line_height = _median_line_height(rects)

    fitted: dict[str, FieldBox] = {}
    sources: dict[str, str] = {}
    for box in boxes:
        near = [rect for rect in rects if _overlaps(rect, box, margin, line_height)]
        if not near:
            fitted[box.name], sources[box.name] = box, "nominal"
            continue
        x, y, w, h = _pad(_clamp_to(_union(near), box, line_height))
        if w * h > box.w * box.h * MAX_GROWTH:
            fitted[box.name], sources[box.name] = box, "nominal"
            continue
        fitted[box.name] = FieldBox(box.name, x=x, y=y, w=w, h=h, kind=box.kind)
        sources[box.name] = "snapped"
    return fitted, sources


def structural(lines: list[Line], size: tuple[int, int], *, wanted: set[str]) -> dict[str, FieldBox]:
    """Locate fields by what they contain rather than by where they sit.

    Only two fields on the card can be identified this way, and both are identified by shape alone
    rather than by any word that would have to be recognized correctly first:

      * `nationalId` — the only line on either side that folds to exactly fourteen digits.
      * `nationalIdExpiry` — the only line carrying a full year/month/day. The issue date printed
        beside it is year and month only, which is what keeps the two apart without reading the
        Arabic label next to either.

    A pattern matching more than one line yields nothing. Two fourteen-digit lines on one side means
    something has been misdetected, and choosing between them by position would reintroduce exactly
    the geometric assumption this function exists to avoid.
    """
    found: dict[str, list[tuple[float, float, float, float]]] = {}
    for region in _prepare(lines, size):
        rect, text = region.rect, region.text
        folded = to_western_digits(text)
        if "nationalId" in wanted and _carries_a_national_id(folded):
            found.setdefault("nationalId", []).append(rect)
        if "nationalIdExpiry" in wanted and _FULL_DATE.search(folded):
            found.setdefault("nationalIdExpiry", []).append(rect)
        for name, terms in (("religion", _RELIGION_TERMS), ("maritalStatus", _MARITAL_TERMS)):
            if name in wanted and _mentions(text, terms):
                found.setdefault(name, []).append(rect)

    return {
        name: FieldBox(name, *_pad(rects[0]), kind=_KIND.get(name, "text"))
        for name, rects in found.items()
        if len(rects) == 1
    }


def anchor(
    boxes: tuple[FieldBox, ...], lines: list[Line], size: tuple[int, int]
) -> Anchoring:
    """Snap every box, then let structural identification override where it applies.

    Structural wins over snapping deliberately. Snapping still assumes the nominal box was roughly
    right — it only corrects drift — whereas a fourteen-digit line is the national ID no matter
    what the profile believed, which is precisely the case where the profile is most wrong.
    """
    if not lines:
        return Anchoring({box.name: box for box in boxes}, {box.name: "nominal" for box in boxes})

    fitted, sources = snap(boxes, lines, size)
    for name, box in structural(lines, size, wanted={box.name for box in boxes}).items():
        fitted[name], sources[name] = box, "structural"
    return Anchoring(fitted, sources)
