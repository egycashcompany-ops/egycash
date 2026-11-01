"""The readers' colours pass WCAG AA in every theme, light and dark, including the invalid state."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

TOKENS = Path(__file__).resolve().parents[1] / "tools" / "ui" / "tokens.css"
THEMES = ("nid", "egyid", "army")
#: (foreground, background) pairs that carry text, and the minimum ratio for each.
PAIRS = [
    ("--text", "--bg", 4.5), ("--text", "--surface", 4.5), ("--text", "--surface-2", 4.5),
    ("--muted", "--bg", 4.5), ("--muted", "--surface", 4.5), ("--muted", "--surface-2", 4.5),
    ("--accent-text", "--bg", 4.5), ("--accent-text", "--surface", 4.5), ("--accent-text", "--surface-2", 4.5),
    ("--on-accent", "--accent", 4.5),
    ("--band-high", "--surface-2", 4.5), ("--band-medium", "--surface-2", 4.5), ("--band-low", "--surface-2", 4.5),
    ("--band-high", "--surface", 4.5), ("--band-medium", "--surface", 4.5), ("--band-low", "--surface", 4.5),
]


def _blocks(css: str) -> dict[str, dict[str, str]]:
    """Selector text → its custom properties. Media wrappers are flattened into the selector."""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    out: dict[str, dict[str, str]] = {}
    media = ""
    depth_media = None
    position = 0
    for match in re.finditer(r"([^{}]+)\{([^{}]*)\}|@media([^{]+)\{|\}", css):
        if match.group(3) is not None:
            media = match.group(3).strip()
            continue
        if match.group(0) == "}":
            media = ""
            continue
        selector = " ".join(match.group(1).split())
        props = dict(re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", match.group(2)))
        key = f"{media}|{selector}" if media else selector
        out.setdefault(key, {}).update(props)
    del depth_media, position
    return out


def _palette(blocks: dict[str, dict[str, str]], theme: str, dark: bool, invalid: bool) -> dict[str, str]:
    palette: dict[str, str] = {}
    palette.update(blocks[":root"])
    palette.update(blocks[':root, [data-theme]'])
    if not dark:
        palette.update(blocks.get(f'[data-theme="{theme}"]', {}))
        if invalid:
            palette.update(blocks['[data-theme][data-state="invalid"]'])
        return palette
    palette.update(blocks[':root[data-color="dark"], :root[data-color="dark"] [data-theme]'])
    palette.update(blocks.get(f':root[data-color="dark"] [data-theme="{theme}"]', {}))
    if invalid:
        palette.update(blocks[':root[data-color="dark"] [data-theme][data-state="invalid"]'])
    return palette


def _luminance(colour: str) -> float:
    colour = colour.strip()
    hexes = re.fullmatch(r"#([0-9a-fA-F]{6})", colour)
    assert hexes, f"text colours must be opaque hex, got {colour}"
    channels = [int(hexes.group(1)[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    linear = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def _ratio(a: str, b: str) -> float:
    high, low = sorted((_luminance(a), _luminance(b)), reverse=True)
    return (high + 0.05) / (low + 0.05)


@pytest.mark.parametrize("theme", THEMES)
@pytest.mark.parametrize("dark", [False, True])
@pytest.mark.parametrize("invalid", [False, True])
def test_text_pairs_meet_aa(theme, dark, invalid):
    palette = _palette(_blocks(TOKENS.read_text(encoding="utf-8")), theme, dark, invalid)
    failures = []
    for fg, bg, minimum in PAIRS:
        ratio = _ratio(palette[fg], palette[bg])
        if ratio < minimum:
            failures.append(f"{fg} on {bg}: {ratio:.2f} < {minimum}")
    assert not failures, f"{theme} {'dark' if dark else 'light'}{' invalid' if invalid else ''}: {failures}"


def test_the_dark_media_query_matches_the_dark_toggle():
    """The two dark definitions (system setting, page toggle) must not drift apart."""
    blocks = _blocks(TOKENS.read_text(encoding="utf-8"))
    media = "(prefers-color-scheme: dark)"
    for theme in THEMES:
        system = blocks.get(f'{media}|:root:not([data-color="light"]) [data-theme="{theme}"]', {})
        toggle = blocks.get(f':root[data-color="dark"] [data-theme="{theme}"]', {})
        for name, value in toggle.items():
            assert system.get(name) == value, f"{theme} {name}: system {system.get(name)} vs toggle {value}"
