"""Measure the EGY CASH ID reader on a folder of EGY CASH ID photos with a manifest.

    python bench/egycash_id_measure.py --fixtures fixtures/real/badge

The manifest is the usual list of {id, front, truth: {companyName, fullNameAr, jobTitle,
employeeCode, nationalId}}. Prints, per field, how many were read exactly (after the Arabic fold
the API uses for search) and the verdict `badgeCheck` gave each card. Runs inside the image.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from nidocr.arabic import normalize_arabic, rasm_fold  # noqa: E402
from nidocr.extract import extract_badge  # noqa: E402

FIELDS = ("companyName", "fullNameAr", "jobTitle", "employeeCode", "nationalId")


def _same(name: str, got: str, want: str) -> bool:
    if name in ("employeeCode", "nationalId"):
        return got == want
    return rasm_fold(normalize_arabic(got)) == rasm_fold(normalize_arabic(want))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixtures", required=True)
    args = parser.parse_args()
    folder = Path(args.fixtures)
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))

    from nidocr.engine import PaddleRecognizer  # noqa: PLC0415 - the models are heavy

    recognizer = PaddleRecognizer(model_dir="/models")
    right = {name: 0 for name in FIELDS}
    asked = {name: 0 for name in FIELDS}
    started = time.perf_counter()
    for entry in manifest:
        result = extract_badge(str(folder / entry["front"]), recognizer)
        check = result.diagnostics.get("badgeCheck", {})
        row = []
        for name in FIELDS:
            want = entry["truth"].get(name)
            if want is None:
                continue
            got = result.fields.get(name, {}).get("value", "")
            asked[name] += 1
            ok = _same(name, got, want)
            right[name] += ok
            row.append(f"{name}={'ok' if ok else 'WRONG ' + repr(got) + ' vs ' + repr(want)}")
        print(entry["id"], check.get("verdict"), "; ".join(row), flush=True)
    print()
    for name in FIELDS:
        if asked[name]:
            print(f"{name:14s} {right[name]}/{asked[name]}")
    print(f"{(time.perf_counter() - started) / len(manifest):.1f} s per card")


if __name__ == "__main__":
    main()
