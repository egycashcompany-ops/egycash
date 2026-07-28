"""Field-box calibration: overlay the boxes on a rectified card, and measure whether they hit ink.

Two modes, and the second is the one that matters.

`--overlay` writes an annotated image so a human can see where the boxes fall. That is how the
boxes get adjusted for REAL cards, which will not share the synthetic geometry (see the
calibration note in `layout.py`).

`--check` is mechanical: it rectifies each fixture, crops every field box, and measures ink
coverage inside it. A box that has drifted off its text produces a near-blank crop, and the
recognizer would return an empty string — which in an accuracy report looks exactly like "the
model could not read Arabic". Distinguishing "wrong box" from "bad recognition" is the single most
useful thing this tool does, because those two failures have completely different fixes.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from nidocr.layout import BACK_FIELDS, FRONT_FIELDS, FieldBox  # noqa: E402
from nidocr.preprocess import load_bgr, prepare_card  # noqa: E402

#: Minimum ink density of the DENSEST text row for a box to count as "contains text".
#: Calibrated against the synthetic set: an empty region sits at ~0.00, a line of Arabic at >0.15.
MIN_ROW_INK = 0.05


def text_presence(crop: np.ndarray) -> float:
    """Ink density of the densest horizontal band in the crop.

    Deliberately NOT ink-over-area. A short value ("عزباء") inside a box sized for the longest
    plausible value covers only a few percent of it, so a coverage metric flags a perfectly
    aligned box as empty — which is how this check first reported false failures. What actually
    distinguishes "box is on the text" from "box is on blank stock" is whether ANY row is dense:
    an empty region has a flat, near-zero row profile whatever its size.

    The background level is taken per crop, because the card's two faces differ in tone (pale blue
    front, warm beige back) and a fixed grey cut would call one of them ink.
    """
    if crop.size == 0:
        return 0.0
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    background = float(np.percentile(gray, 85))  # the paper, ignoring the darkest text pixels
    ink = (gray < background - 40).astype(np.float32)
    row_density = ink.mean(axis=1)
    if row_density.size == 0:
        return 0.0
    # Smooth over 5 rows so a single speckled scanline cannot pass as a text line.
    if row_density.size >= 5:
        row_density = np.convolve(row_density, np.ones(5) / 5, mode="valid")
    return float(row_density.max())


def check(fixtures_dir: Path) -> int:
    manifest = json.loads((fixtures_dir / "manifest.json").read_text(encoding="utf-8"))
    problems = 0

    for entry in manifest:
        for key, boxes in (("front", FRONT_FIELDS), ("back", BACK_FIELDS)):
            name = entry.get(key)
            if not name:
                continue
            card = prepare_card(load_bgr(str(fixtures_dir / name)))
            for box in boxes:
                left, top, right, bottom = box.to_pixels((card.shape[1], card.shape[0]))
                density = text_presence(card[top:bottom, left:right])
                if density < MIN_ROW_INK:
                    problems += 1
                    print(
                        f"EMPTY  {entry['id']:>16} {key:<5} {box.name:<18} "
                        f"rowInk={density:.4f} (< {MIN_ROW_INK}) — box likely off target"
                    )
    if problems == 0:
        print(f"OK — every field box contains text across {len(manifest)} fixtures")
    return problems


def overlay(fixtures_dir: Path, fixture_id: str, out_dir: Path) -> None:
    manifest = json.loads((fixtures_dir / "manifest.json").read_text(encoding="utf-8"))
    entry = next((e for e in manifest if e["id"] == fixture_id), manifest[0])
    out_dir.mkdir(parents=True, exist_ok=True)

    for key, boxes in (("front", FRONT_FIELDS), ("back", BACK_FIELDS)):
        name = entry.get(key)
        if not name:
            continue
        card = prepare_card(load_bgr(str(fixtures_dir / name)))
        annotated = card.copy()
        for box in boxes:
            left, top, right, bottom = box.to_pixels((card.shape[1], card.shape[0]))
            colour = (0, 0, 220) if box.kind == "digits" else (0, 160, 0)
            cv2.rectangle(annotated, (left, top), (right, bottom), colour, 2)
            cv2.putText(
                annotated, box.name, (left + 4, max(14, top - 6)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, colour, 1, cv2.LINE_AA,
            )
        target = out_dir / f"{entry['id']}-{key}-boxes.png"
        cv2.imwrite(str(target), annotated)
        print(f"wrote {target}")


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="Calibrate / verify National-ID field boxes.")
    parser.add_argument("--fixtures", default=str(root / "fixtures" / "synthetic"))
    parser.add_argument("--check", action="store_true", help="fail if any box misses its text")
    parser.add_argument("--overlay", metavar="FIXTURE_ID", help="write an annotated card")
    parser.add_argument("--out", default=str(root / "build" / "calibration"))
    args = parser.parse_args()

    if args.overlay:
        overlay(Path(args.fixtures), args.overlay, Path(args.out))
    if args.check or not args.overlay:
        raise SystemExit(1 if check(Path(args.fixtures)) else 0)


if __name__ == "__main__":
    main()
