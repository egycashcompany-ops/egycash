"""Turning a photo upright before anything else looks at it.

People photograph a card, or a receipt, however it happens to lie: sideways, upside down. Every
later stage assumes upright text — the field boxes, the line splitter, the recognizer — and a
turned card does not fail cleanly: it produces confident nonsense. So orientation is settled once,
on the whole photo, and nothing downstream ever sees a turned image.

WHY NOT PADDLEOCR'S ORIENTATION CLASSIFIER. It was tried first (`PP-LCNet_x1_0_doc_ori`) and
called every upright synthetic card "180" and every upside-down one "0". It was trained on
left-to-right pages, and a right-aligned Arabic card with its photo on the left looks exactly like
one of those turned over. A rule that depends on the script is no use for a system meant to read
any paper.

So the photo is judged by READING it, which is script-agnostic as long as the recognizer knows the
script: an upside-down line reads as low-confidence garbage, an upright one reads cleanly.

  1. Detect lines once, as given. Their boxes say which AXIS the text runs along: mostly tall boxes
     mean the photo is on its side. Box shape cannot tell 0 from 180 (or 90 from 270) — a line is
     the same rectangle either way up — so this only halves the question.
  2. Read the photo at the two remaining angles and keep the one that reads better, by a clear
     margin. An upright, confidently-read photo skips the second read entirely.

Small tilts are not this module's job: `geometry.rectify` and `preprocess.deskew` handle those.
The 180-degree retry in `extract` stays as a second line of defence.
"""

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
    """How well a reading went: characters, weighted steeply by how confidently they were read.

    Steeply, because counting characters alone is fooled by digits: Arabic-Indic numerals turned
    upside down still read as numerals, so an inverted card's date line came back as eleven
    "digits" at 0.75 and outweighed the upright reading. Upright lines read at 0.9 and above,
    inverted ones at 0.75 and below, and the fourth power turns that gap into a 2-3x margin.
    """
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


def upright(image: np.ndarray, recognizer: object) -> tuple[np.ndarray, int]:
    """→ (the photo turned upright, the clockwise turn applied; 0 when left as given).

    Needs a recognizer that can read a whole page (`detect_lines`); anything else leaves the photo
    as given, which is exactly the behaviour before this existed.
    """
    read: Callable[[np.ndarray], Lines] | None = getattr(recognizer, "detect_lines", None)
    if read is None:
        return image, 0
    try:
        as_given = read(image)
    except Exception:  # noqa: BLE001 — orientation is an improvement, never a reason to fail
        return image, 0
    if not as_given:
        return image, 0

    if _sideways(as_given):
        candidates = (90, 270)
        scores = {}
    else:
        if _mean_score(as_given) >= CONFIDENT:
            return image, 0
        # Box shape said "not sideways", but it is only a vote, and it can be outvoted by things
        # that are not text: the back of the card is half PDF417 barcode, and turned on its side
        # the barcode's bars come back as a crowd of wide "lines" that outnumber the real, tall
        # ones. A real back photographed sideways was then turned 180 instead of 90 and read as
        # nonsense. A photo that did not read cleanly as given has earned the full check.
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
