"""Render a measurement report as Markdown — paste-ready into the spike write-up.

Kept separate from `measure.py` so the JSON is the artefact of record and the prose is a view of
it. Re-rendering an old JSON must never change the numbers.
"""

from __future__ import annotations


def _bar(passes: bool | None) -> str:
    if passes is None:
        return "—"
    return "PASS" if passes else "**FAIL**"


def render_markdown(report: dict) -> str:
    lines: list[str] = []
    add = lines.append

    add("# National-ID OCR spike — measurement report")
    add("")
    add(f"- Fixture set: `{report['fixtureSet']}`")
    add(f"- Fixture sources: {', '.join(report['fixtureSources'])}")
    add(f"- Recognizer: `{report['recognizer']}`")
    add(f"- Cards: {report['images']}")
    add("")

    if report.get("syntheticOnly"):
        add(
            "> **These numbers are an upper bound.** Every fixture is synthetic — rendered from "
            "fonts, not photographed from a printed card. Recognition on real cards will be "
            "worse, and by an amount this run cannot predict. Treat the accuracy table as proof "
            "the pipeline is wired correctly, not as evidence about field performance."
        )
        add("")

    add("## Per-field accuracy")
    add("")
    add("| Field | n | Exact % | Normalized % | Mean CER | Missing | Threshold | Verdict |")
    add("| --- | ---: | ---: | ---: | ---: | ---: | ---: | :---: |")
    for name, data in report["fields"].items():
        threshold = data["threshold"]
        add(
            f"| `{name}` | {data['n']} | {data['exactPct']} | {data['normalizedPct']} | "
            f"{data['meanCer']} | {data['missing']} | "
            f"{'—' if threshold is None else f'{threshold * 100:.0f}%'} | {_bar(data['passes'])} |"
        )
    add("")
    add(
        "*Normalized* applies the same Arabic fold the API uses for search, so a hamza variant is "
        "not counted as a recognition error. *CER* is the character error rate against the truth "
        "length — it separates \"one letter off\" from \"unusable\"."
    )
    add("")

    timing = report["timing"]
    add("## Processing time")
    add("")
    add(f"- Mean per card (front + back): **{timing['perCardMsMean']} ms**")
    add(f"- Worst card: {timing['perCardMsMax']} ms")
    add("")
    add("| Stage | Mean ms/card |")
    add("| --- | ---: |")
    for stage, ms in timing["stageMsMean"].items():
        add(f"| `{stage}` | {ms} |")
    add("")

    resources = report["resources"]
    add("## Resources")
    add("")
    add(f"- Peak RSS: **{resources['peakRssMb']} MB**")
    add(f"- CPU: {resources['cpuSecondsPerCard']} s/card ({resources['cpuSecondsTotal']} s total)")
    size = resources.get("dockerImageMb")
    add(
        f"- Docker image: **{size} MB**"
        if size
        else "- Docker image: not measured (run inside the built image, or set `OCR_IMAGE_SIZE_MB`)"
    )
    add("")

    add("## Major failure cases")
    add("")
    failures = report["failures"]
    if not failures:
        add("None above the 25% CER bar on this fixture set.")
    else:
        add("| Fixture | Quality | Field | CER | Truth | Read as |")
        add("| --- | --- | --- | ---: | --- | --- |")
        for failure in failures:
            add(
                f"| {failure['fixture']} | {failure['quality']} | `{failure['field']}` | "
                f"{failure['cer']} | {failure['truth']} | {failure['predicted'] or '—'} |"
            )
    add("")

    add("## Recommendation")
    add("")
    add(report["verdict"]["recommendation"])
    below = report["verdict"]["fieldsBelowThreshold"]
    if below:
        add("")
        add(f"Fields below threshold: {', '.join(f'`{name}`' for name in below)}")
    return "\n".join(lines)
