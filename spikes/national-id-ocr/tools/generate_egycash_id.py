"""Make synthetic EGY CASH IDs (employee cards), to test the EGY CASH ID reader without a real card.

    python tools/generate_egycash_id.py OUT_DIR [--face portrait.jpg]

Three layouts (labelled with the labels at the right, unlabelled, labels above the values), each
with the photograph at the left and the company's logo (English) on a white band, white on a
coloured band, or small on the card. The rest is Arabic, and every number is made
up: a structurally valid national ID number and a seven-digit employee code. `--face` is a photo
to paste where the holder's photograph goes (a real card's portrait, kept local: never commit one).
Run it inside the image, which has the fonts and libraqm that shape Arabic.
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

FONTS = (
    "/usr/share/fonts/truetype/freefont/FreeSerifBold.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSerif.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
)
W, H = 1011, 638  # ID-1 at 300 dpi
LOGO = Path(__file__).resolve().parents[1] / "profiles" / "egycash-logo.png"

NAMES = ("محمد احمد حسن", "كريم محمود عبدالله", "سلمى طارق ابراهيم", "حازم عادل منصور")
JOBS = ("محاسب", "مدير فرع", "أمين خزينة", "أخصائي موارد بشرية")
LABELS = {"name": "الاسم", "job": "الوظيفة", "code": "كود الموظف", "nid": "الرقم القومي"}


def _font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONTS:
        if Path(path).is_file():
            return ImageFont.truetype(path, size, layout_engine=ImageFont.Layout.RAQM)
    raise SystemExit("no Arabic font found; run this inside the image")


def _arabic(draw: ImageDraw.ImageDraw, right: int, y: int, text: str, size: int, fill=(20, 20, 20)) -> None:
    """Right-aligned Arabic text whose right edge is at `right`."""
    font = _font(size)
    width = draw.textlength(text, font=font, direction="rtl", language="ar")
    draw.text((right - width, y), text, font=font, fill=fill, direction="rtl", language="ar", features=["-kern"])


def _digits(draw: ImageDraw.ImageDraw, right: int, y: int, text: str, size: int, fill=(20, 20, 20)) -> None:
    font = _font(size)
    width = draw.textlength(text, font=font)
    draw.text((right - width, y), text, font=font, fill=fill)


def egycash_id_card(layout: str, face: Image.Image | None, rng: random.Random) -> tuple[Image.Image, dict[str, str]]:
    image = Image.new("RGB", (W, H), (250, 250, 247))
    draw = ImageDraw.Draw(image)
    # The company's logo, as on its website: English, the mark and the name and the tagline. Three
    # ways an EGY CASH ID may carry it: on a white band, white on a coloured band, or small on the card.
    logo = Image.open(LOGO).convert("RGBA")
    if layout == "labelled":
        draw.rectangle((0, 0, W, 110), fill=(255, 255, 255))
        draw.line((0, 110, W, 110), fill=(24, 62, 120), width=4)
        tall = 84
    elif layout == "unlabelled":
        draw.rectangle((0, 0, W, 110), fill=(24, 62, 120))
        white = Image.new("RGBA", logo.size, (255, 255, 255, 255))
        white.putalpha(logo.getchannel("A"))
        logo = white
        tall = 84
    else:
        tall = 62
    logo = logo.resize((int(logo.width * tall / logo.height), tall))
    image.paste(logo, (W - logo.width - 36, 12 if layout != "stacked" else 24), logo)
    if face is not None:
        image.paste(face.resize((250, 320)), (40, 160))
    else:
        draw.rectangle((40, 160, 290, 480), fill=(150, 150, 155))
    name, job = rng.choice(NAMES), rng.choice(JOBS)
    code = f"010{rng.randint(1, 9999):04d}"
    nid = f"2{rng.randint(80, 99)}{rng.randint(1, 12):02d}{rng.randint(1, 28):02d}01{rng.randint(0, 9999):04d}{rng.randint(0, 9)}"
    right = W - 50
    if layout == "labelled":
        for i, (key, value) in enumerate((("name", name), ("job", job), ("code", code), ("nid", nid))):
            y = 150 + i * 105
            _arabic(draw, right, y, LABELS[key], 36, fill=(90, 90, 90))
            if key in ("code", "nid"):
                _digits(draw, right - 230, y - 4, value, 44)
            else:
                _arabic(draw, right - 230, y - 6, value, 46)
    elif layout == "unlabelled":
        _arabic(draw, right, 150, name, 56)
        _arabic(draw, right, 245, job, 44, fill=(60, 60, 60))
        _digits(draw, right, 345, code, 52)
        _digits(draw, right, 445, nid, 52)
    else:  # "stacked": each label above its value
        for i, (key, value) in enumerate((("name", name), ("job", job), ("code", code), ("nid", nid))):
            y = 135 + i * 115
            _arabic(draw, right, y, LABELS[key], 30, fill=(110, 110, 110))
            if key in ("code", "nid"):
                _digits(draw, right, y + 40, value, 46)
            else:
                _arabic(draw, right, y + 34, value, 46)
    return image, {"companyName": "EGY CASH", "fullNameAr": name, "jobTitle": job, "employeeCode": code, "nationalId": nid}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("out")
    parser.add_argument("--face", default=None)
    parser.add_argument("--seed", type=int, default=3)
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(args.seed)
    face = Image.open(args.face).convert("RGB") if args.face else None
    manifest = []
    for layout in ("labelled", "unlabelled", "stacked"):
        image, truth = egycash_id_card(layout, face, rng)
        # A photograph of it: a little tilt, a table under it, a soft shadow and sensor noise.
        frame = np.full((1500, 2000, 3), (70, 95, 130), np.uint8)
        card = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)
        angle = rng.uniform(-4, 4)
        matrix = cv2.getRotationMatrix2D((W / 2, H / 2), angle, 1.0)
        card = cv2.warpAffine(card, matrix, (W, H), borderValue=(70, 95, 130))
        x, y = (2000 - W) // 2, (1500 - H) // 2
        frame[y + 14 : y + 14 + H, x + 14 : x + 14 + W] = (frame[y + 14 : y + 14 + H, x + 14 : x + 14 + W] * 0.6).astype(np.uint8)
        frame[y : y + H, x : x + W] = card
        frame = np.clip(frame.astype(np.float32) + np.random.default_rng(1).normal(0, 3, frame.shape), 0, 255).astype(np.uint8)
        name = f"egycash-id-{layout}.jpg"
        cv2.imwrite(str(out / name), frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
        manifest.append({"id": f"egycash-id-{layout}", "front": name, "source": "synthetic", "truth": truth})
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(manifest)} EGY CASH IDs in {out}")


if __name__ == "__main__":
    main()
