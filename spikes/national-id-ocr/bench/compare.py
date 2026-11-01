"""One comparison table for several `measure.py` runs — the Step 2 deliverable.

    python bench/compare.py build/measure-paddle.json build/measure-paddleocr_vl.json \\
        build/measure-qwen.json > build/comparison.md

Each configuration lives in its own image (the VLM images are gigabytes the PaddleOCR-only image
must not carry), so each is measured by its own `measure.py --json-out` run and the JSON reports
are joined here. The thresholds are the ones each report carries (`measure.THRESHOLDS`, unchanged),
read from the JSON so this runs on any host — `measure.py` itself imports the POSIX-only
`resource` module and does not load on Windows.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

#: Prose fields first — the only ones a VLM reads — then the PaddleOCR-only fields as a control.
FIELD_ORDER = (
    "fullNameAr",
    "address",
    "occupation",
    "nationalId",
    "nationalIdExpiry",
    "religion",
    "maritalStatus",
)


def _cell(field: dict | None) -> str:
    if not field:
        return "—"
    verdict = "" if field.get("passes") is None else (" ✓" if field["passes"] else " ✗")
    return (
        f"{field['exactPct']} / {field['normalizedPct']}{verdict} / "
        f"{field['meanCer']} / {field['missing']}"
    )


def _number(value: float | None, digits: int = 1) -> str:
    return "—" if value is None else f"{value:.{digits}f}"


def render(reports: list[dict]) -> str:
    names = [report["recognizer"] for report in reports]
    synthetic = all(report.get("syntheticOnly") for report in reports)
    lines: list[str] = []
    add = lines.append

    add("# Recognizer comparison")
    add("")
    add(f"- Fixture set: `{reports[0]['fixtureSet']}` ({reports[0]['images']} cards)")
    if synthetic:
        add(
            "- **INCONCLUSIVE — synthetic fixtures only.** Rendered cards are an easier target "
            "than photographed ones; these numbers rank the configurations, they do not "
            "predict field accuracy."
        )
    add(
        "- VLMs read only `fullNameAr`, `address`, `occupation`; every other field is PaddleOCR "
        "in all three configurations, so those rows are a control."
    )
    add("")
    add("Cells: exact % / normalized % (✓ meets threshold) / mean CER / missing.")
    add("")
    add("| Field | Threshold | " + " | ".join(f"`{name}`" for name in names) + " |")
    add("| --- | ---: | " + " | ".join("---" for _ in names) + " |")
    for field in FIELD_ORDER:
        threshold = next(
            (
                report["fields"][field].get("threshold")
                for report in reports
                if field in report["fields"]
            ),
            None,
        )
        bar = "—" if threshold is None else f"{threshold * 100:.0f}%"
        cells = " | ".join(_cell(report["fields"].get(field)) for report in reports)
        add(f"| `{field}` | {bar} | {cells} |")

    def resource_row(label: str, key: str, digits: int) -> None:
        values = " | ".join(_number(report["resources"].get(key), digits) for report in reports)
        add(f"| {label} | | {values} |")

    resource_row("Image size (MB)", "dockerImageMb", 0)
    resource_row("Peak RAM (MB)", "peakRssMb", 0)
    resource_row("CPU seconds / card", "cpuSecondsPerCard", 2)
    resource_row("Wall seconds / card", "wallSecondsPerCard", 2)
    add("")
    for report in reports:
        below = report["verdict"]["fieldsBelowThreshold"]
        listed = ", ".join(f"`{name}`" for name in below) if below else "none"
        add(f"- `{report['recognizer']}` below threshold: {listed}")
    return "\n".join(lines) + "\n"


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__, file=sys.stderr)
        return 2
    reports = [json.loads(Path(path).read_text(encoding="utf-8")) for path in argv]
    # Arabic and ✓/✗ in the table: never let a Windows console code page decide the encoding.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    sys.stdout.write(render(reports))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
