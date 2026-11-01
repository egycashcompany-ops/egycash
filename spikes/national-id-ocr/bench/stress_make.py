"""Build the stress set: real cards turned, tilted, placed far and among distractors.

Reads the real photos in `fixtures/real/` and writes `fixtures/real/stress/` plus its manifest.
Everything stays under `fixtures/real/`, which git and Docker both ignore: these are real cards.

Every scene records what was done to it, so the bench can check the answer to "which way up?"
and "where is the card?" mechanically, not only the text that came out.

    python bench/stress_make.py            # writes fixtures/real/stress/
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
REAL = ROOT / "fixtures" / "real"
OUT = REAL / "stress"

#: The real photos the scenes are made from, read from a private file beside them (it names real
#: photos and their ID numbers, so it lives in fixtures/real/, which is never shared):
#: fixtures/real/stress-sources.json = {"sources": {name: {file, corners, nationalId, side}}, "compose": [...]}.
#: `corners` (TL, TR, BR, BL) is null when the card fills the photo; the others were traced once and checked.
_SOURCES_FILE = REAL / "stress-sources.json"


def _load_sources() -> tuple[dict, tuple]:
    if not _SOURCES_FILE.is_file():
        raise SystemExit(f"{_SOURCES_FILE} is missing: list the real photos there first (see the comment above)")
    data = json.loads(_SOURCES_FILE.read_text(encoding="utf-8"))
    sources = {name: (entry["file"], entry["corners"], entry["nationalId"], entry["side"])
               for name, entry in data["sources"].items()}
    #: Card-only sources for the composed scenes (the far photos are the same cards, smaller).
    return sources, tuple(data["compose"])


SOURCES: dict = {}
COMPOSE: tuple = ()

FRAME = (3000, 2250)  # a 4:3 phone photo, landscape


def _corners(name: str, image: np.ndarray) -> np.ndarray:
    _, corners, _, _ = SOURCES[name]
    if corners is None:
        h, w = image.shape[:2]
        return np.float32([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]])
    return np.float32(corners)


def _flat(name: str) -> np.ndarray:
    """The card alone, laid flat at ID-1 proportions."""
    image = cv2.imread(str(REAL / SOURCES[name][0]))
    quad = _corners(name, image)
    width = int(round(np.linalg.norm(quad[1] - quad[0])))
    height = int(round(width / 1.5858))
    target = np.float32([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]])
    return cv2.warpPerspective(image, cv2.getPerspectiveTransform(quad, target), (width, height))


def _rotate(image: np.ndarray, quad: np.ndarray, degrees: int) -> tuple[np.ndarray, np.ndarray]:
    """Turn clockwise by a multiple of 90, carrying the card's corners along."""
    h, w = image.shape[:2]
    if degrees == 0:
        return image, quad
    codes = {90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}
    x, y = quad[:, 0], quad[:, 1]
    moved = {
        90: np.stack([h - 1 - y, x], axis=1),
        180: np.stack([w - 1 - x, h - 1 - y], axis=1),
        270: np.stack([y, w - 1 - x], axis=1),
    }[degrees]
    return cv2.rotate(image, codes[degrees]), moved.astype(np.float32)


def _background(kind: str, rng: np.random.Generator) -> np.ndarray:
    w, h = FRAME
    if kind == "pale":
        # A white desk: the hardest edge to find, a pale card on a pale surface.
        base = np.full((h, w, 3), (226, 230, 233), np.float32)
        base += rng.normal(0, 4, (h, w, 1))
        gradient = np.linspace(-12, 12, w, dtype=np.float32)[None, :, None]
        return np.clip(base + gradient, 0, 255).astype(np.uint8)
    if kind == "dark":
        base = np.full((h, w, 3), (38, 34, 32), np.float32) + rng.normal(0, 5, (h, w, 1))
        return np.clip(base, 0, 255).astype(np.uint8)
    if kind == "wood":
        x = np.arange(w, dtype=np.float32)[None, :]
        y = np.arange(h, dtype=np.float32)[:, None]
        grain = 18 * np.sin(x / 23.0 + 6 * np.sin(y / 180.0)) + rng.normal(0, 6, (h, w))
        base = np.stack([60 + grain * 0.5, 105 + grain * 0.8, 150 + grain], axis=2)
        return np.clip(base, 0, 255).astype(np.uint8)
    # "busy": papers, print and coloured blocks, the scene that pulls a locator off the card.
    base = np.full((h, w, 3), 200, np.uint8)
    for _ in range(40):
        x0, y0 = int(rng.integers(0, w)), int(rng.integers(0, h))
        x1, y1 = x0 + int(rng.integers(150, 900)), y0 + int(rng.integers(100, 600))
        colour = tuple(int(c) for c in rng.integers(30, 255, 3))
        cv2.rectangle(base, (x0, y0), (x1, y1), colour, -1)
    for _ in range(120):
        x0, y0 = int(rng.integers(0, w)), int(rng.integers(0, h))
        cv2.putText(base, "".join(rng.choice(list("ABCDEFGH0123456789"), 6)), (x0, y0),
                    cv2.FONT_HERSHEY_SIMPLEX, float(rng.uniform(1, 3)), (20, 20, 20), 3)
    return base


def _place(
    card: np.ndarray, background: np.ndarray, share: float, tilt: float, perspective: float,
    centre: tuple[float, float], rng: np.random.Generator,
) -> tuple[np.ndarray, np.ndarray]:
    """Lay `card` on `background`: `share` of the frame wide, turned `tilt` degrees, foreshortened."""
    h, w = background.shape[:2]
    cw = share * w
    ch = cw / 1.5858
    cx, cy = centre[0] * w, centre[1] * h
    half = np.float32([[-cw / 2, -ch / 2], [cw / 2, -ch / 2], [cw / 2, ch / 2], [-cw / 2, ch / 2]])
    # Foreshortening: the top edge a little narrower than the bottom, as when the phone leans back.
    half[0, 0] *= 1 - perspective
    half[1, 0] *= 1 - perspective
    angle = np.deg2rad(tilt)
    rotation = np.float32([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]])
    quad = (half @ rotation.T + np.float32([cx, cy])).astype(np.float32)
    ch_, cw_ = card.shape[:2]
    source = np.float32([[0, 0], [cw_ - 1, 0], [cw_ - 1, ch_ - 1], [0, ch_ - 1]])
    matrix = cv2.getPerspectiveTransform(source, quad)
    warped = cv2.warpPerspective(card, matrix, (w, h))
    mask = cv2.warpPerspective(np.full(card.shape[:2], 255, np.uint8), matrix, (w, h))
    # A soft shadow, as a card on a table casts.
    shadow = cv2.GaussianBlur(cv2.warpAffine(mask, np.float32([[1, 0, 12], [0, 1, 16]]), (w, h)), (41, 41), 0)
    scene = background.astype(np.float32) * (1 - 0.35 * shadow[..., None] / 255.0)
    scene = np.where(mask[..., None] > 0, warped.astype(np.float32), scene)
    # The camera: a touch of blur and sensor noise over everything.
    scene = cv2.GaussianBlur(scene, (3, 3), 0) + rng.normal(0, 2.5, scene.shape)
    return np.clip(scene, 0, 255).astype(np.uint8), quad


def _distractor_face(scene: np.ndarray, card: np.ndarray, at: tuple[float, float], size: float) -> None:
    """Paste a large face beside the card: the holder's own head in a hand-held photo."""
    h, w = card.shape[:2]
    face = card[int(0.12 * h): int(0.78 * h), int(0.03 * w): int(0.30 * w)]
    fh = int(size * scene.shape[0])
    fw = int(fh * face.shape[1] / face.shape[0])
    face = cv2.resize(face, (fw, fh))
    x, y = int(at[0] * scene.shape[1]), int(at[1] * scene.shape[0])
    scene[y: y + fh, x: x + fw] = face[: scene.shape[0] - y, : scene.shape[1] - x]


def main() -> None:
    global SOURCES, COMPOSE  # noqa: PLW0603 - read once, from the private list
    SOURCES, COMPOSE = _load_sources()
    OUT.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(7)
    manifest = []

    def save(scene_id: str, image: np.ndarray, quad: np.ndarray, turned: int, src: str, kind: str):
        path = OUT / f"{scene_id}.jpg"
        cv2.imwrite(str(path), image, [cv2.IMWRITE_JPEG_QUALITY, 90])
        _, _, nid, side = SOURCES[src]
        h, w = image.shape[:2]
        manifest.append({
            "id": scene_id,
            side: f"{scene_id}.jpg",
            "side": side,
            "source": "real-stress",
            "kind": kind,
            "source_photo": src,
            # Clockwise turn applied to an upright photo: the reader must undo exactly this.
            "turned": turned,
            "card": [[round(float(x) / w, 4), round(float(y) / h, 4)] for x, y in quad],
            "truth": {"nationalId": nid},
        })

    # 1. Every real photo, as taken and turned each of the four ways.
    for name, (filename, _, _, _) in SOURCES.items():
        image = cv2.imread(str(REAL / filename))
        quad = _corners(name, image)
        for degrees in (0, 90, 180, 270):
            turned, moved = _rotate(image, quad, degrees)
            save(f"{name}-r{degrees}", turned, moved, degrees, name, "rotation")

    # 2. Composed scenes: the card at ordinary distances, with what pulls a locator off it.
    plans = [
        # (tag, background, share, tilt, perspective, centre, turned, face)
        ("pale", "pale", 0.55, 4.0, 0.03, (0.5, 0.5), 0, False),
        ("busy", "busy", 0.45, -6.0, 0.05, (0.45, 0.55), 0, False),
        ("face", "wood", 0.42, 3.0, 0.04, (0.62, 0.55), 0, True),
        ("mid", "dark", 0.33, 8.0, 0.06, (0.5, 0.45), 0, False),
        ("side", "wood", 0.5, 2.0, 0.03, (0.5, 0.5), 90, False),
        ("flip", "pale", 0.5, -3.0, 0.04, (0.5, 0.5), 180, False),
    ]
    for name in COMPOSE:
        card = _flat(name)
        for tag, kind, share, tilt, perspective, centre, degrees, face in plans:
            scene, quad = _place(card, _background(kind, rng), share, tilt, perspective, centre, rng)
            if face:
                _distractor_face(scene, card, (0.04, 0.12), 0.7)
            scene, quad = _rotate(scene, quad, degrees)
            save(f"{name}-{tag}", scene, quad, degrees, name, tag)

    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(manifest)} scenes in {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
