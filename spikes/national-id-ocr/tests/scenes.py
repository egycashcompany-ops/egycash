"""Compose a card into a photographed scene, on purpose badly.

The synthetic fixtures are pictures OF a card — the card fills the frame, flat and square. That is
the one case the pipeline already handled, and testing against it proves very little. What broke on
real captures is everything around the card: it lies on a surface, at an angle, under a light, and
sometimes it is bent. Those are the conditions `geometry` exists for, so they have to be
constructible in a test rather than described in a comment.

Each scene is built from a known quadrilateral, which makes the assertions exact: the localizer's
answer is compared against the corners the card was actually pasted at, not eyeballed. That is the
difference between "detection returned something" and "detection returned the card".

Deliberately not per-pixel noise. A real desk is smooth, a real card casts a shadow, and a real
photograph of a matte surface has structure rather than static. Testing against uniform noise
would defeat the texture detector for a reason that never occurs in the field, and would say
nothing about whether it works.
"""

from __future__ import annotations

import cv2
import numpy as np

#: Where the card is pasted, and what it is lying on. Chosen to cover the failure modes seen on
#: real captures rather than to span a grid: a card on sand (low contrast, warm background), on a
#: dark desk, on a pale desk (where the card is the DARKER region — the polarity that a single
#: brightness threshold gets backwards), on wood, and bent.
SURFACES = ("sand", "dark", "white", "wood")


def surface(kind: str, width: int, height: int, *, seed: int = 0) -> np.ndarray:
    """A plausible background. Smooth, because real surfaces are."""
    rng = np.random.default_rng(seed)
    if kind == "sand":
        base = rng.normal(150, 14, (height, width, 3)).astype(np.float32)
        base[..., 0] *= 0.72
        base[..., 1] *= 0.92
    elif kind == "dark":
        base = rng.normal(45, 8, (height, width, 3)).astype(np.float32)
    elif kind == "white":
        base = rng.normal(240, 2, (height, width, 3)).astype(np.float32)
        rows, columns = np.mgrid[0:height, 0:width]
        vignette = np.hypot(columns - width / 2, rows - height / 2) / max(width, height) * 22
        base -= vignette[..., None]
    else:  # wood
        base = rng.normal(120, 6, (height, width, 3)).astype(np.float32)
        base[..., 0] *= 0.55
        base[..., 1] *= 0.78
        base += (12 * np.sin(np.mgrid[0:height, 0:width][1] / 7.0))[..., None]
    return np.clip(base, 0, 255).astype(np.uint8)


def compose(
    card: np.ndarray,
    quad: list[list[int]],
    *,
    background: str = "sand",
    size: tuple[int, int] = (1400, 1000),
    shadow: bool = True,
    curl: float = 0.0,
    seed: int = 0,
) -> np.ndarray:
    """Paste `card` into a scene at `quad`, optionally bent and casting a shadow.

    `curl` bows the card about its long axis, which is how a card carried in a wallet actually
    deforms — it bends one way, it does not crumple. The bow is applied to the card and its mask
    together so the silhouette bends with the content, as it would in a photograph.
    """
    width, height = size
    base = surface(background, width, height, seed=seed)
    card_height, card_width = card.shape[:2]

    source = np.float32(
        [[0, 0], [card_width - 1, 0], [card_width - 1, card_height - 1], [0, card_height - 1]]
    )
    target = np.float32(quad)
    matrix = cv2.getPerspectiveTransform(source, target)
    warped = cv2.warpPerspective(card, matrix, (width, height))
    mask = cv2.warpPerspective(np.full((card_height, card_width), 255, np.uint8), matrix, (width, height))

    if curl:
        rows, columns = np.mgrid[0:height, 0:width].astype(np.float32)
        across = np.clip((columns - target[:, 0].min()) / max(np.ptp(target[:, 0]), 1), 0, 1)
        offset = (curl * np.ptp(target[:, 1])) * np.sin(np.pi * across)
        bent = (rows + offset).astype(np.float32)
        warped = cv2.remap(warped, columns, bent, cv2.INTER_CUBIC)
        mask = cv2.remap(mask, columns, bent, cv2.INTER_NEAREST)

    scene = base
    if shadow:
        softness = cv2.GaussianBlur(mask, (61, 61), 0).astype(np.float32) / 255.0
        scene = (scene * (1 - 0.28 * softness[..., None])).astype(np.uint8)
    scene = scene.copy()
    scene[mask > 0] = warped[mask > 0]
    return scene


def corner_error(found: np.ndarray, truth: list[list[int]]) -> float:
    """Mean distance, in pixels, between the located corners and where the card really is."""
    return float(
        np.mean(np.linalg.norm(np.asarray(found, np.float32) - np.asarray(truth, np.float32), axis=1))
    )


#: A flat, well-framed card. The baseline every other scene is a degradation of.
FLAT = [[300, 250], [1100, 250], [1100, 755], [300, 755]]
#: Photographed from an angle — the ordinary hand-held capture.
ANGLED = [[330, 300], [1120, 215], [1150, 700], [360, 790]]
#: Steeply off-normal, the point at which perspective starts compressing the aspect ratio.
STEEP = [[260, 330], [1090, 190], [1180, 660], [340, 840]]
#: Rotated far enough that "topmost corner" stops meaning "top-left".
ROTATED = [[420, 200], [1150, 380], [1010, 880], [280, 700]]
#: Held too far from the camera. Locatable, but not readable — the distinction the gate exists for.
DISTANT = [[560, 430], [900, 430], [900, 645], [560, 645]]
