"""Reading any paper — a receipt, a letter, a form — as plain text in reading order.

The National-ID path knows the card: where each field is, what each may contain, how to check it.
None of that applies to an arbitrary document, so this path keeps only the parts that do: turn the
photo upright, find every line of text, read it, and put the lines in the order a person reads
them. No fields, no repair, no confidence bands — every line carries the model's own score, and a
person reads the result.

Arabic and Latin are both read (the recognizer's dictionary carries both), and the order within a
row follows the script that dominates the page: right to left for Arabic, left to right otherwise.
"""

from __future__ import annotations

import re
import time
from typing import Any

import numpy as np

from .orientation import upright

_ARABIC = re.compile(r"[؀-ۿ]")
_LATIN = re.compile(r"[A-Za-z]")


def _bounds(poly: object) -> tuple[float, float, float, float]:
    points = np.asarray(poly, dtype=float).reshape(-1, 2)
    return (
        float(points[:, 0].min()),
        float(points[:, 1].min()),
        float(points[:, 0].max()),
        float(points[:, 1].max()),
    )


def _rows(lines: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """Group lines into printed rows by vertical overlap, top to bottom.

    Half the median line height is the tolerance: wide enough to absorb a slightly skewed photo,
    narrow enough that two printed rows never merge.
    """
    if not lines:
        return []
    heights = [line["box"][3] - line["box"][1] for line in lines]
    tolerance = max(float(np.median(heights)) / 2.0, 1.0)
    rows: list[list[dict[str, Any]]] = []
    for line in sorted(lines, key=lambda item: (item["box"][1] + item["box"][3]) / 2.0):
        centre = (line["box"][1] + line["box"][3]) / 2.0
        if rows:
            row = rows[-1]
            row_centre = float(np.mean([(item["box"][1] + item["box"][3]) / 2.0 for item in row]))
            if abs(centre - row_centre) <= tolerance:
                row.append(line)
                continue
        rows.append([line])
    return rows


def read_document(image: np.ndarray, recognizer: object) -> dict[str, Any]:
    """→ {text, lines: [{text, score, box}], rtl, rotated, elapsedMs}.

    `box` is [left, top, right, bottom] in the pixels of the UPRIGHT image.
    """
    started = time.perf_counter()
    image, turned = upright(image, recognizer)

    read = getattr(recognizer, "read_page", None) or recognizer.detect_lines
    lines = [
        {
            "text": text.strip(),
            "score": round(float(score), 3),
            "box": [round(value, 1) for value in _bounds(poly)],
        }
        for poly, text, score in read(image)
        if text.strip()
    ]

    joined = " ".join(line["text"] for line in lines)
    rtl = len(_ARABIC.findall(joined)) >= len(_LATIN.findall(joined))

    ordered: list[dict[str, Any]] = []
    text_rows: list[str] = []
    for row in _rows(lines):
        row.sort(key=lambda item: item["box"][2] if rtl else item["box"][0], reverse=rtl)
        ordered.extend(row)
        text_rows.append("   ".join(item["text"] for item in row))

    return {
        "text": "\n".join(text_rows),
        "lines": ordered,
        "rtl": rtl,
        "rotated": turned,
        "elapsedMs": round((time.perf_counter() - started) * 1000.0, 1),
        # The page as it was read. Not JSON — the service turns it into a preview only when the
        # caller asks for one, and drops it otherwise.
        "uprightImage": image,
    }
