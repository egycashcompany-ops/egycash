"""Run the stress set and score what matters for it: the number, which way up, where the card is.

    python bench/stress_run.py --out results.jsonl [--shard 0/3]
    python bench/stress_run.py --summarize results*.jsonl

Runs inside the image (it needs PaddleOCR). Per scene it records:

- the ID number read, its band, and whether it is right, missing, or wrong but presented as read
  ('high'/'medium'), the hallucination that matters, since a reviewer trusts those;
- whether the turn applied undoes the turn the scene was given;
- how much of the true card the reader cut out (IoU of the card the pipeline reports with the
  truth), so "zoomed on the face" shows up as a number.
"""

from __future__ import annotations

import argparse
import glob
import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))


# ── The judge of "is it shown upright" ──────────────────────────────────────────────────────────
# A frozen copy of the layout check (src/nidocr/orientation.py, October 2026), kept here so the
# bench can judge any version of the reader, including ones that have no such check of their own.

_CASCADE = None


def _judge_turn(image: np.ndarray, side: str) -> int | None:
    """The turn that would make the card upright, by its portrait (front) or barcode (back)."""
    global _CASCADE  # noqa: PLW0603
    grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    scale = min(1.0, 900 / max(grey.shape[:2]))
    if scale < 1.0:
        grey = cv2.resize(grey, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    rotations = {90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}
    if side == "front":
        if _CASCADE is None:
            _CASCADE = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
        equal = cv2.equalizeHist(grey)
        weights = {}
        for degrees in (0, 90, 180, 270):
            view = equal if degrees == 0 else cv2.rotate(equal, rotations[degrees])
            smallest = max(20, int(min(view.shape[:2]) * 0.2))
            found, _, levels = _CASCADE.detectMultiScale3(
                view, scaleFactor=1.08, minNeighbors=5, minSize=(smallest, smallest), outputRejectLevels=True)
            weights[degrees] = max((float(v) for v in levels), default=0.0) if len(found) else 0.0
        ranked = sorted(weights.values(), reverse=True)
        best = max(weights, key=weights.get)
        return best if weights[best] >= 3.0 and weights[best] - ranked[1] >= 2.0 else None
    values = grey.astype(np.float32)
    both = np.minimum(np.abs(cv2.Sobel(values, cv2.CV_32F, 1, 0)), np.abs(cv2.Sobel(values, cv2.CV_32F, 0, 1)))
    density = cv2.blur(both, (max(9, int(min(grey.shape[:2]) * 0.04)) | 1,) * 2)
    mask = (density > max(float(np.percentile(density, 97)) * 0.6, 25.0)).astype(np.uint8)
    count, labels, stats, centres = cv2.connectedComponentsWithStats(mask)
    if count < 2:
        return None
    index = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    _, _, width, height, area = stats[index]
    if area < 0.004 * grey.size or max(width, height) < 1.6 * min(width, height):
        return None
    edges = cv2.Canny(grey, 60, 160) > 0
    edges[labels == index] = False
    ys, xs = np.nonzero(edges)
    if len(xs) < 50:
        return None
    up_x, up_y = xs.mean() - centres[index][0], ys.mean() - centres[index][1]
    sideways = height > width
    if sideways != (abs(up_x) > abs(up_y)):
        return None
    if sideways:
        return 270 if up_x > 0 else 90
    return 0 if up_y < 0 else 180


def _iou(first: np.ndarray, second: np.ndarray) -> float:
    a = first.astype(np.float32)
    b = second.astype(np.float32)
    inter, _ = cv2.intersectConvexConvex(cv2.convexHull(a), cv2.convexHull(b))
    union = cv2.contourArea(cv2.convexHull(a)) + cv2.contourArea(cv2.convexHull(b)) - inter
    return float(inter / union) if union > 0 else 0.0


def _found_card(notes: dict) -> np.ndarray | None:
    if notes.get("cardCorners"):
        return np.asarray(notes["cardCorners"], float)
    if notes.get("cardBox"):
        l, t, r, b = notes["cardBox"]
        return np.asarray([[l, t], [r, t], [r, b], [l, b]], float)
    return None


def score(entry: dict, result) -> dict:
    side = entry["side"]
    notes = result.diagnostics.get(side, {})
    truth = entry["truth"]["nationalId"]
    nid = result.fields.get("nationalId", {})
    value, band = nid.get("value", ""), nid.get("confidence", "")
    turned = (notes.get("rotated", 0) + (180 if notes.get("rotated180") else 0)) % 360
    found = _found_card(notes)
    truth_card = np.asarray(entry["card"], float)
    # A photo the card fills is its own crop: "no crop" is then the right answer.
    fills = cv2.contourArea(truth_card.astype(np.float32)) > 0.8
    iou = _iou(found, truth_card) if found is not None else (1.0 if fills else 0.0)
    # What the test page shows: the card as the reader turned it. Judged by the card's own layout
    # (its portrait or barcode standing upright), independently of what the reader reported.
    shown = result.oriented.get(side)
    shown_turn = _judge_turn(shown, side) if shown is not None else None
    return {
        "id": entry["id"],
        "shownUpright": shown_turn == 0 if shown_turn is not None else None,
        "kind": entry["kind"],
        "side": side,
        "nid": value,
        "band": band,
        "nidOk": value == truth,
        "nidMissing": not value,
        "nidWrongConfident": bool(value) and value != truth and band in ("high", "medium"),
        "turnOk": turned == (360 - entry["turned"]) % 360,
        "turnApplied": turned,
        "cropIou": round(iou, 3),
        "filled": sum(1 for d in result.fields.values() if d.get("value")),
        "quality": notes.get("quality"),
        "tooFar": bool(notes.get("tooFarToRead")),
        "ms": round(result.total_ms),
    }


def run(manifest_path: Path, out: Path, shard: tuple[int, int], only: str | None) -> None:
    from nidocr.engine import PaddleRecognizer
    from nidocr.extract import extract

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entries = [e for i, e in enumerate(manifest) if i % shard[1] == shard[0]]
    if only == "turned":
        entries = [e for e in entries if e["turned"]]
    elif only:
        entries = [e for e in entries if only in e["id"]]
    recognizer = PaddleRecognizer(model_dir="/models")
    with out.open("a", encoding="utf-8") as handle:
        for entry in entries:
            path = str(manifest_path.parent / entry[entry["side"]])
            started = time.perf_counter()
            try:
                result = extract(path if entry["side"] == "front" else None,
                                 path if entry["side"] == "back" else None, recognizer)
                row = score(entry, result)
            except Exception as error:  # noqa: BLE001 - one broken scene must not end the run
                row = {"id": entry["id"], "kind": entry["kind"], "error": repr(error)}
            row["wall"] = round(time.perf_counter() - started, 1)
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
            handle.flush()
            print(json.dumps(row, ensure_ascii=False), flush=True)


def summarize(paths: list[str]) -> str:
    rows = [json.loads(line) for p in paths for f in glob.glob(p) for line in open(f, encoding="utf-8")]
    rows = [r for r in rows if "error" not in r]
    groups: dict[str, list[dict]] = {}
    for row in rows:
        groups.setdefault(row["kind"], []).append(row)
    groups["ALL"] = rows
    lines = ["| scenes | n | ID right | ID missing | ID wrong but trusted | turn right | shown upright | card found (IoU≥0.6) | mean s |",
             "|---|---|---|---|---|---|---|---|---|"]
    for kind, items in groups.items():
        n = len(items)
        if not n:
            continue
        pct = lambda key: f"{100 * sum(1 for r in items if r[key]) / n:.0f}%"  # noqa: E731
        crop = f"{100 * sum(1 for r in items if r['cropIou'] >= 0.6) / n:.0f}%"
        secs = sum(r["ms"] for r in items) / n / 1000
        judged = [r for r in items if r.get("shownUpright") is not None]
        shown = f"{100 * sum(1 for r in judged if r['shownUpright']) / len(judged):.0f}%" if judged else "n/a"
        lines.append(f"| {kind} | {n} | {pct('nidOk')} | {pct('nidMissing')} | {pct('nidWrongConfident')} "
                     f"| {pct('turnOk')} | {shown} | {crop} | {secs:.1f} |")
    bad = [r for r in rows if not (r["nidOk"] and r["turnOk"] and r["cropIou"] >= 0.6 and r.get("shownUpright") is not False)]
    lines.append("")
    lines.append("Misses: " + ", ".join(
        f"{r['id']} ({'id ' + (r['nid'] or 'none') + '/' + r['band'] if not r['nidOk'] else ''}"
        f"{' turn ' + str(r['turnApplied']) if not r['turnOk'] else ''}"
        f"{' crop ' + str(r['cropIou']) if r['cropIou'] < 0.6 else ''}"
        f"{' shown-turned' if r.get('shownUpright') is False else ''})"
        for r in sorted(bad, key=lambda r: r["id"])))
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default=str(ROOT / "fixtures" / "real" / "stress" / "manifest.json"))
    parser.add_argument("--out", default="stress.jsonl")
    parser.add_argument("--shard", default="0/1")
    parser.add_argument("--only", default=None)
    parser.add_argument("--summarize", nargs="*")
    args = parser.parse_args()
    if args.summarize:
        print(summarize(args.summarize))
        return
    index, count = (int(x) for x in args.shard.split("/"))
    run(Path(args.manifest), Path(args.out), (index, count), args.only)


if __name__ == "__main__":
    main()
