"""The measurement harness — the whole point of the spike.

Produces exactly the six numbers the evaluation asks for:

  1. per-field accuracy (exact / normalized / mean CER / missing)
  2. processing time per image, broken down by stage
  3. Docker image size          — read from the environment, see `--image-size-mb`
  4. CPU and memory             — peak RSS and CPU time of this process
  5. major failure cases        — the worst reads, listed with their truth
  6. a recommendation           — a mechanical verdict against stated thresholds, not a vibe

Run against any fixture directory containing `manifest.json`. Synthetic and real sets use the same
manifest shape, which is what lets real anonymized cards be dropped in without touching code.

The report ALWAYS states which fixture set produced it. A number from synthetic fixtures is an
upper bound and is labelled as such in the output — an unlabelled accuracy figure from rendered
cards is the single most misleading artefact this spike could produce.
"""

from __future__ import annotations

import argparse
import json
import os
import resource
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from nidocr.extract import extract  # noqa: E402
from nidocr.scoring import FieldAggregate, score_field  # noqa: E402

# The bar for "production-ready", stated up front so the verdict is mechanical rather than a
# judgement call made after seeing the numbers.
#
# `nationalId` is held to a far higher bar than the prose fields on purpose: it is the only field
# that is machine-validated downstream and the only one where a single wrong character silently
# yields a *different valid-looking person*. Names and addresses are reviewed by a human who can
# see the card, so a rough read that saves typing still earns its place.
THRESHOLDS = {
    "nationalId": 0.95,
    "nationalIdExpiry": 0.85,
    "religion": 0.85,
    "maritalStatus": 0.85,
    "fullNameAr": 0.80,
    "address": 0.70,
    "occupation": 0.70,
}


def build_recognizer(kind: str, model_dir: str | None):
    """`paddle` for the real thing; `mock` exercises the pipeline with no weights and no network."""
    if kind == "paddle":
        from nidocr.engine import PaddleRecognizer

        return PaddleRecognizer(model_dir=model_dir)
    if kind == "mock":
        from nidocr.engine import MockRecognizer

        return MockRecognizer({})
    raise SystemExit(f"unknown recognizer: {kind}")


def run(fixtures_dir: Path, recognizer_kind: str, model_dir: str | None) -> dict:
    manifest_path = fixtures_dir / "manifest.json"
    if not manifest_path.exists():
        raise SystemExit(f"no manifest.json in {fixtures_dir}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not manifest:
        raise SystemExit(f"{manifest_path} is empty")

    recognizer = build_recognizer(recognizer_kind, model_dir)
    aggregates: dict[str, FieldAggregate] = {}
    per_image_ms: list[float] = []
    stage_totals: dict[str, float] = {}
    failures: list[dict] = []
    sources = {entry.get("source", "unknown") for entry in manifest}

    cpu_before = time.process_time()

    for entry in manifest:
        truth: dict[str, str] = entry["truth"]
        # The mock replays ground truth, so the pipeline runs end to end while recognition is
        # held constant — isolating geometry, preprocessing and post-processing from model quality.
        if recognizer_kind == "mock":
            recognizer._values = dict(truth)  # noqa: SLF001 — harness-internal by design

        front = str(fixtures_dir / entry["front"]) if entry.get("front") else None
        back = str(fixtures_dir / entry["back"]) if entry.get("back") else None
        result = extract(front, back, recognizer)

        per_image_ms.append(result.total_ms)
        for stage, ms in result.timings.stages.items():
            stage_totals[stage] = stage_totals.get(stage, 0.0) + ms

        for field_name, expected in truth.items():
            predicted = result.fields.get(field_name, {}).get("value", "")
            score = score_field(field_name, predicted, expected)
            aggregates.setdefault(field_name, FieldAggregate(field_name)).add(score)
            # "Major failure" = more than a quarter of the characters wrong. Below that a human
            # is correcting a word; above it they are retyping the field.
            if score.cer > 0.25:
                failures.append(
                    {
                        "fixture": entry["id"],
                        "quality": entry.get("quality", "unknown"),
                        "field": field_name,
                        "truth": expected,
                        "predicted": predicted,
                        "cer": round(score.cer, 3),
                    }
                )

    cpu_seconds = time.process_time() - cpu_before
    # ru_maxrss is KiB on Linux, bytes on macOS. Normalizing on platform keeps the number honest.
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    peak_rss_mb = rss / 1024 if sys.platform != "darwin" else rss / (1024 * 1024)

    return {
        "fixtureSet": str(fixtures_dir),
        "fixtureSources": sorted(sources),
        "syntheticOnly": sources == {"synthetic"},
        "recognizer": recognizer_kind,
        "images": len(manifest),
        "fields": {
            name: {
                "n": agg.total,
                "exactPct": round(agg.exact_pct, 1),
                "normalizedPct": round(agg.normalized_pct, 1),
                "meanCer": round(agg.mean_cer, 3),
                "missing": agg.missing,
                "threshold": THRESHOLDS.get(name),
                "passes": (
                    None
                    if THRESHOLDS.get(name) is None
                    else agg.normalized_pct / 100.0 >= THRESHOLDS[name]
                ),
            }
            for name, agg in sorted(aggregates.items())
        },
        "timing": {
            "perCardMsMean": round(sum(per_image_ms) / len(per_image_ms), 1),
            "perCardMsMax": round(max(per_image_ms), 1),
            "stageMsMean": {
                stage: round(total / len(manifest), 2)
                for stage, total in sorted(stage_totals.items())
            },
        },
        "resources": {
            "peakRssMb": round(peak_rss_mb, 1),
            "cpuSecondsTotal": round(cpu_seconds, 2),
            "cpuSecondsPerCard": round(cpu_seconds / len(manifest), 3),
            "dockerImageMb": _image_size_mb(),
        },
        "failures": sorted(failures, key=lambda f: -f["cer"])[:25],
        "verdict": _verdict(aggregates, sources),
    }


def _image_size_mb() -> float | None:
    """Docker image size, when the harness runs inside the built image.

    The Dockerfile writes the size to `/image-size-mb` at build time, so the number reported is
    the real artefact's size rather than something reconstructed from `pip list`.
    """
    override = os.environ.get("OCR_IMAGE_SIZE_MB")
    if override:
        return float(override)
    marker = Path("/image-size-mb")
    if marker.exists():
        try:
            return float(marker.read_text().strip())
        except ValueError:
            return None
    return None


def _verdict(aggregates: dict[str, FieldAggregate], sources: set[str]) -> dict:
    """Mechanical pass/fail against THRESHOLDS, with the synthetic caveat attached."""
    failed = [
        name
        for name, agg in aggregates.items()
        if name in THRESHOLDS and agg.normalized_pct / 100.0 < THRESHOLDS[name]
    ]
    if sources == {"synthetic"}:
        recommendation = (
            "INCONCLUSIVE — synthetic fixtures only. These cards are rendered from fonts and are a "
            "strictly easier target than printed cards seen through a camera; the numbers above "
            "are an upper bound. Re-run against real anonymized fixtures before deciding."
        )
    elif failed:
        recommendation = (
            f"NOT production-ready — below threshold on: {', '.join(sorted(failed))}. "
            "Evaluate a local vision-language model before considering cloud OCR."
        )
    else:
        recommendation = "Meets every stated threshold on this fixture set."
    return {"fieldsBelowThreshold": sorted(failed), "recommendation": recommendation}


def main() -> None:
    parser = argparse.ArgumentParser(description="Measure the local National-ID OCR pipeline.")
    root = Path(__file__).resolve().parents[1]
    parser.add_argument("--fixtures", default=str(root / "fixtures" / "synthetic"))
    parser.add_argument("--recognizer", choices=("paddle", "mock"), default="paddle")
    parser.add_argument("--model-dir", default=os.environ.get("PADDLE_OCR_MODEL_DIR"))
    parser.add_argument("--json-out", default=None)
    args = parser.parse_args()

    report = run(Path(args.fixtures), args.recognizer, args.model_dir)
    if args.json_out:
        Path(args.json_out).write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    from report import render_markdown  # noqa: PLC0415 — sibling module, CLI-only

    print(render_markdown(report))


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    main()
