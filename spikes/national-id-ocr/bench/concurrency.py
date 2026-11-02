"""G5: three reads at once, one per document type, against a running service.

    python bench/concurrency.py --url http://127.0.0.1:8099 --real fixtures/real

Each read is first timed alone, then all three are sent together. Passes when every concurrent read
finishes, each answer is for the type it was asked for (no result mixed between types), and the
total is under 1.5x the slowest single read. Prints timings and types only, never a value.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import threading
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from verdicts import collect  # noqa: E402


def _post(url: str, body: dict) -> tuple[float, dict]:
    started = time.perf_counter()
    request = urllib.request.Request(url + "/extract", data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=600) as response:  # noqa: S310 - local service
        answer = json.loads(response.read())
    return time.perf_counter() - started, answer


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8099")
    parser.add_argument("--real", default="fixtures/real")
    args = parser.parse_args()

    items = collect(Path(args.real), 5)
    pick = {}
    for item in items:
        if item["cls"] in ("national_id", "egycash_id") and item["cls"] not in pick and item["front"]:
            pick[item["cls"]] = item
    pick.setdefault("army_exemption", pick["national_id"])  # no samples yet: any photo exercises it
    bodies = {
        kind: {"documentType": kind, "imageBase64": base64.b64encode(Path(item["front"]).read_bytes()).decode()}
        for kind, item in pick.items()
    }

    _post(args.url, bodies["egycash_id"])  # warm up, not counted
    single = {}
    for kind, body in bodies.items():
        single[kind], _ = _post(args.url, body)

    results: dict[str, tuple[float, dict]] = {}

    def one(kind: str) -> None:
        results[kind] = _post(args.url, bodies[kind])

    threads = [threading.Thread(target=one, args=(kind,)) for kind in bodies]
    started = time.perf_counter()
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    total = time.perf_counter() - started

    mixed = [kind for kind, (_, answer) in results.items() if answer.get("documentType") != kind]
    slowest = max(single.values())
    report = {
        "singleSeconds": {kind: round(value, 2) for kind, value in single.items()},
        "concurrentSeconds": {kind: round(value, 2) for kind, (value, _) in results.items()},
        "totalConcurrentSeconds": round(total, 2),
        "slowestSingleSeconds": round(slowest, 2),
        "ratio": round(total / slowest, 2),
        "allFinished": len(results) == len(bodies),
        "mixedTypes": mixed,
        "verdicts": {kind: answer.get("verdict", {}).get("status") for kind, (_, answer) in results.items()},
        "G5": "PASS" if len(results) == len(bodies) and not mixed and total < 1.5 * slowest else "FAIL",
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
