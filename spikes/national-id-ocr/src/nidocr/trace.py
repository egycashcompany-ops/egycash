"""Every intermediate the pipeline produces, captured and rendered as one page.

WHY THIS EXISTS. Four rounds of this OCR work were spent fixing causes inferred from a final
string: a name came back short, a mechanism was proposed that would produce that symptom, the
mechanism was removed, and the symptom came back. Two of those inferences were wrong, and the
third was only identified because a word pattern happened to rule the others out — which is not a
method, it is luck.

The pipeline has plenty of places to lose information and no way to see any of them. A field can be
cropped short, a line can be split wrongly, a word can fail detection, a variant can misread a
digit, and post-processing can drop something that was read correctly. All five produce the same
observable: a wrong value in the review dialog. Distinguishing them by reasoning is what has been
failing.

So this records the artefacts instead, in the order the pipeline makes them, using the SAME code
path the real extraction uses — `extract()` takes the trace object and fills it as it goes. A trace
assembled by re-implementing the pipeline would show what the trace does, not what production does,
and that distinction is the entire value here.

The output is one self-contained HTML file with every image inlined, because the hard part of a
diagnostic is not producing it but getting it out of a container and in front of someone.

PRIVACY. Unlike `/diagnose`, which is deliberately coordinates-only and safe to paste anywhere,
THIS CONTAINS THE WHOLE CARD: the photograph, the name, the number, every crop. It is a debugging
tool for a card whose holder has consented, not something to attach to an issue. The page says so
at the top, and `OCR_TRACE_DISABLED=1` turns the endpoint off entirely.
"""

from __future__ import annotations

import base64
import html
import json
from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np


@dataclass(frozen=True)
class Entry:
    """One recorded artefact. `label` is a ' / '-separated path: side / field / stage."""

    kind: str  # 'image' | 'text' | 'data'
    label: str
    payload: Any


@dataclass
class Trace:
    """Collects artefacts. Disabled by default so production pays nothing for its existence."""

    enabled: bool = True
    entries: list[Entry] = field(default_factory=list)

    def image(self, label: str, image: np.ndarray | None) -> None:
        if not self.enabled or image is None or getattr(image, "size", 0) == 0:
            return
        ok, buffer = cv2.imencode(".png", image)
        if ok:
            self.entries.append(Entry("image", label, bytes(buffer)))

    def text(self, label: str, value: str) -> None:
        """A raw string exactly as some stage produced it — never cleaned, never normalized.

        Quoted and escaped when rendered, so trailing spaces and empty results are visible as
        themselves rather than as nothing.
        """
        if self.enabled:
            self.entries.append(Entry("text", label, value))

    def data(self, label: str, payload: Any) -> None:
        if self.enabled:
            self.entries.append(Entry("data", label, payload))


#: Shared no-op. Passing this rather than None keeps the call sites in `extract` unconditional,
#: which matters: a trace that is only filled in on some branches is a trace that misleads.
NO_TRACE = Trace(enabled=False)


def _section_of(label: str) -> str:
    parts = [part.strip() for part in label.split("/")]
    return " / ".join(parts[:2]) if len(parts) > 1 else parts[0]


def _leaf_of(label: str) -> str:
    parts = [part.strip() for part in label.split("/")]
    return parts[-1] if len(parts) > 2 else (parts[1] if len(parts) > 1 else "")


_STYLE = """
:root { color-scheme: light dark; }
body { font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 2rem; }
h1 { font-size: 1.4rem; margin: 0 0 .25rem; }
h2 { font-size: 1.05rem; margin: 2.5rem 0 .75rem; padding-bottom: .35rem;
     border-bottom: 1px solid color-mix(in srgb, currentColor 20%, transparent); }
.warn { border: 1px solid #b45309; background: color-mix(in srgb, #b45309 12%, transparent);
        padding: .75rem 1rem; border-radius: .5rem; margin: 1rem 0 0; }
.item { margin: 1rem 0; }
.item .name { font-weight: 600; font-size: .82rem; letter-spacing: .02em;
              text-transform: uppercase; opacity: .65; margin-bottom: .35rem; }
img { max-width: 100%; border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
      border-radius: .25rem; display: block; background: #fff; }
pre { margin: 0; padding: .6rem .8rem; overflow-x: auto; border-radius: .35rem;
      background: color-mix(in srgb, currentColor 8%, transparent); white-space: pre-wrap; }
.raw { font-size: 1.15rem; direction: rtl; text-align: right; unicode-bidi: plaintext; }
.empty { opacity: .55; font-style: italic; direction: ltr; text-align: left; }
"""

_WARNING = (
    "This page contains the complete contents of an identity card — the photograph, the name, the "
    "address and the number, in full. It is a debugging artefact for a card whose holder has "
    "consented to it. Do not attach it to an issue, a ticket or a chat. "
    "<code>/diagnose</code> is the one that is safe to share: coordinates and counts, no content."
)


def render_html(trace: Trace, *, title: str = "OCR trace") -> str:
    """One self-contained page. Images are inlined, so it survives being downloaded and emailed."""
    sections: dict[str, list[Entry]] = {}
    for entry in trace.entries:
        sections.setdefault(_section_of(entry.label), []).append(entry)

    parts = [
        "<!doctype html><meta charset='utf-8'>",
        f"<title>{html.escape(title)}</title>",
        f"<style>{_STYLE}</style>",
        f"<h1>{html.escape(title)}</h1>",
        f"<div class='warn'>{_WARNING}</div>",
    ]
    for section, entries in sections.items():
        parts.append(f"<h2>{html.escape(section)}</h2>")
        for entry in entries:
            name = html.escape(_leaf_of(entry.label) or entry.label)
            parts.append(f"<div class='item'><div class='name'>{name}</div>")
            if entry.kind == "image":
                encoded = base64.b64encode(entry.payload).decode("ascii")
                parts.append(f"<img src='data:image/png;base64,{encoded}' alt=''>")
            elif entry.kind == "text":
                value = entry.payload
                if value.strip():
                    parts.append(f"<pre class='raw'>{html.escape(value)}</pre>")
                else:
                    parts.append("<pre class='empty'>(empty — the recognizer returned nothing)</pre>")
            else:
                rendered = json.dumps(entry.payload, ensure_ascii=False, indent=2, default=str)
                parts.append(f"<pre>{html.escape(rendered)}</pre>")
            parts.append("</div>")
    return "".join(parts)


def main(argv: list[str] | None = None) -> int:
    """`python -m nidocr.trace --front a.jpg --back b.jpg --out report.html`

    The local half of the same tool the `/trace` endpoint exposes. Both run the real `extract()`
    with a collector attached, so what the page shows is what production did.
    """
    import argparse

    from .engine import PaddleRecognizer
    from .extract import extract

    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--front")
    parser.add_argument("--back")
    parser.add_argument("--out", default="trace.html")
    args = parser.parse_args(argv)
    if not args.front and not args.back:
        parser.error("give --front, --back, or both")

    recognizer = PaddleRecognizer()
    recognizer.keep_line_images = True
    trace = Trace()
    extract(args.front, args.back, recognizer, trace)

    from pathlib import Path

    Path(args.out).write_text(render_html(trace), encoding="utf-8")
    print(f"{len(trace.entries)} artefacts → {args.out}")
    return 0


if __name__ == "__main__":  # pragma: no cover — CLI entry
    raise SystemExit(main())
