"""Reading any paper, a receipt, a letter, a form, as plain text in reading order."""

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
    """Group lines into printed rows by vertical overlap, top to bottom."""
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


def read_document(
    image: np.ndarray, recognizer: object, *, read_lines: list | None = None, turned: int | None = None
) -> dict[str, Any]:
    """→ {text, lines: [{text, score, box}], rtl, rotated, elapsedMs}.

    `read_lines` / `turned`: the page already turned upright and read by the caller (a document with
    its own way of telling which way is up), so neither is done again here."""
    started = time.perf_counter()
    if read_lines is None:
        image, turned = upright(image, recognizer)
        read = getattr(recognizer, "read_page", None) or recognizer.detect_lines
        raw = read(image)
    else:
        raw, turned = read_lines, turned or 0
    lines = [
        {
            "text": text.strip(),
            "score": round(float(score), 3),
            "box": [round(value, 1) for value in _bounds(poly)],
        }
        for poly, text, score in raw
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
        # The page as it was read. Not JSON, the service turns it into a preview only when the
        # caller asks for one, and drops it otherwise.
        "uprightImage": image,
    }
