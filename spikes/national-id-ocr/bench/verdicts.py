"""Cross-type gates: every reader against every fixture → a confusion matrix of verdicts.

    python bench/verdicts.py --real fixtures/real [--limit-stress 20] [--json build/verdicts.json]

Classes are taken from the folders: `badge/` is EGY CASH ID, `exemption/` is Army Exemption
Certificate, `other/` is neither (faces, licences, other cards), and the national ID photos are
`user/`, `stress/` and the loose photos at the top. Each photo is shown to all three readers.

G2: a photo of the wrong type must come back `not_match` (reported: how many did).
G3: a photo of the right type must come back `match`, or `unreadable` with a reason.
G4: among fields marked `high`, how many are wrong, on photos that have a truth in a manifest.

Prints counts and reason codes only. No value read from a card is printed or written, ever.
"""

from __future__ import annotations

import argparse
import collections
import json
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from nidocr import registry  # noqa: E402
from nidocr.arabic import normalize_arabic, rasm_fold  # noqa: E402

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
READERS = ("national_id", "egycash_id", "army_exemption")


def _same(name: str, got: str, want: str) -> bool:
    if name in ("employeeCode", "nationalId"):
        return "".join(ch for ch in got if ch.isdigit()) == "".join(ch for ch in want if ch.isdigit())
    return rasm_fold(normalize_arabic(got)) == rasm_fold(normalize_arabic(want))


def _manifest(folder: Path) -> list[dict]:
    path = folder / "manifest.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else []


def collect(real: Path, limit_stress: int | None) -> list[dict]:
    """→ [{cls, front, back, truth}] with paths. `cls` is the document type, or 'other'."""
    items: list[dict] = []
    seen: set[Path] = set()

    def add(cls: str, folder: Path, entry: dict) -> None:
        front = folder / entry["front"] if entry.get("front") else None
        back = folder / entry["back"] if entry.get("back") else None
        for path in (front, back):
            if path is not None:
                seen.add(path.resolve())
        if (front and front.is_file()) or (back and back.is_file()):
            items.append({"cls": cls, "front": front, "back": back, "truth": entry.get("truth") or {}, "folder": folder.name})

    for name, cls in (("badge", "egycash_id"), ("user", "national_id"), ("exemption", "army_exemption")):
        for entry in _manifest(real / name):
            add(cls, real / name, entry)
    stress = _manifest(real / "stress")
    for entry in stress[: limit_stress or None]:
        add("national_id", real / "stress", entry)

    # Photos with no manifest entry: classed by folder, no truth.
    folders = {"badge": "egycash_id", "user": "national_id", "exemption": "army_exemption", "other": "other", ".": "national_id"}
    for name, cls in folders.items():
        folder = real / name
        if not folder.is_dir():
            continue
        for path in sorted(folder.iterdir()):
            if path.suffix.lower() in IMAGE_SUFFIXES and path.resolve() not in seen:
                side = "back" if "back" in path.stem.lower() else "front"
                items.append({"cls": cls, "front": path if side == "front" else None,
                              "back": path if side == "back" else None, "truth": {}, "folder": folder.name})
                seen.add(path.resolve())
    return items


def run(items: list[dict], recognizer, only_positive: bool = False) -> dict:
    matrix: dict[str, dict[str, collections.Counter]] = {
        reader: collections.defaultdict(collections.Counter) for reader in READERS
    }
    reasons: dict[str, collections.Counter] = {reader: collections.Counter() for reader in READERS}
    bands: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    timings: dict[str, list[float]] = collections.defaultdict(list)
    failures = 0
    #: Which (fixture index, field) were wrong at 'high'. Index into the run's own list: no file
    #: name (some are people's names) and no value is ever reported.
    wrong_high: list[dict] = []

    for index, item in enumerate(items, 1):
        for reader in READERS:
            if only_positive and reader != item["cls"]:
                continue
            kind = registry.get(reader)
            front = str(item["front"]) if item["front"] else None
            back = str(item["back"]) if item["back"] else None
            started = time.perf_counter()
            try:
                result = kind.reader()(front, back, recognizer)
                verdict = kind.verdict()(result)
            except Exception as error:  # noqa: BLE001 - counted, the run goes on
                failures += 1
                print(f"  [{index}] {reader}: failed ({type(error).__name__})", file=sys.stderr)
                continue
            timings[reader].append((time.perf_counter() - started) * 1000.0)
            matrix[reader][item["cls"]][verdict.status] += 1
            if verdict.status != "match":
                reasons[reader].update(f"{item['cls']}:{code}" for code in verdict.reasons)
            # G4: field correctness by band, only where this reader reads this class.
            if reader == item["cls"] and item["truth"]:
                for name, want in item["truth"].items():
                    data = result.fields.get(name)
                    if not data or not data.get("value") or not want:
                        continue
                    ok = _same(name, str(data["value"]), str(want))
                    bands[f"{reader}:{data['confidence']}"]["right" if ok else "wrong"] += 1
                    if not ok and data["confidence"] == "high":
                        got, expect = str(data["value"]), str(want)
                        wrong_high.append({
                            "fixture": index, "folder": item["folder"], "reader": reader, "field": name,
                            # Shape of the error only: lengths and how many positions differ.
                            "lenGot": len(got), "lenWant": len(expect),
                            "positionsDiffer": sum(a != b for a, b in zip(got, expect)) + abs(len(got) - len(expect)),
                            "notes": {k: v for k, v in data.items() if k in ("agreement", "repaired", "corroborated", "valid", "reads", "genderCorrected")},
                        })
        print(f"  [{index}/{len(items)}] done", file=sys.stderr)

    def p95(values: list[float]) -> float | None:
        if not values:
            return None
        ordered = sorted(values)
        return round(ordered[min(len(ordered) - 1, int(round(0.95 * (len(ordered) - 1))))], 1)

    classes = collections.Counter(item["cls"] for item in items)
    gates = {}
    for reader in READERS:
        negatives = {cls: count for cls, count in classes.items() if cls != reader}
        rejected = sum(matrix[reader][cls]["not_match"] for cls in negatives)
        total_negative = sum(negatives.values())
        positives = classes.get(reader, 0)
        accepted = matrix[reader][reader]["match"] + matrix[reader][reader]["unreadable"]
        gates[reader] = {
            "G2_negatives_rejected": f"{rejected}/{total_negative}",
            "G3_positives_match_or_unreadable": f"{accepted}/{positives}",
            "G3_positives_match": f"{matrix[reader][reader]['match']}/{positives}",
        }
    high_wrong = {key: counts["wrong"] for key, counts in bands.items() if key.endswith(":high")}
    return {
        "fixtures": dict(classes),
        "matrix": {reader: {cls: dict(counts) for cls, counts in by.items()} for reader, by in matrix.items()},
        "reasons": {reader: dict(counts.most_common()) for reader, counts in reasons.items()},
        "fieldsByBand": {key: dict(counts) for key, counts in sorted(bands.items())},
        "G4_wrong_at_high": high_wrong,
        "gates": gates,
        "p95Ms": {reader: p95(values) for reader, values in timings.items()},
        "medianMs": {reader: round(statistics.median(values), 1) for reader, values in timings.items() if values},
        "failures": failures,
        "wrongAtHigh": wrong_high,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--real", default="fixtures/real")
    parser.add_argument("--limit-stress", type=int, default=None)
    parser.add_argument("--recognizer", default="paddle", choices=("paddle", "mock"))
    parser.add_argument("--json", default=None)
    parser.add_argument("--only-positive", action="store_true", help="each photo to its own reader only")
    parser.add_argument("--with-truth", action="store_true", help="only photos that have a truth")
    args = parser.parse_args()

    items = collect(Path(args.real), args.limit_stress)
    if args.with_truth:
        items = [item for item in items if item["truth"]]
    if args.recognizer == "mock":
        from nidocr.engine import MockRecognizer  # noqa: PLC0415

        recognizer = MockRecognizer({})
    else:
        from nidocr.engine import PaddleRecognizer  # noqa: PLC0415

        recognizer = PaddleRecognizer()
    report = run(items, recognizer, only_positive=args.only_positive)
    text = json.dumps(report, ensure_ascii=False, indent=2)
    print(text)
    if args.json:
        Path(args.json).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json).write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
