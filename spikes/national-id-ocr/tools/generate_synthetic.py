"""Generate synthetic National-ID fixtures + their ground-truth manifest.

READ THIS BEFORE TRUSTING ANY NUMBER PRODUCED FROM SYNTHETIC FIXTURES.

These cards are rendered from fonts. A real card is printed on polycarbonate with a guilloche
background, a hologram, an ink profile the renderer cannot imitate, and it reaches the pipeline
through a phone camera. Recognition accuracy measured on synthetic cards is therefore an UPPER
BOUND — it tells you the pipeline is wired correctly and the geometry lands, and it tells you
nothing reliable about field-day accuracy.

What they are genuinely for:
  * building and regression-testing the pipeline with no real PII anywhere near the repository;
  * catching structural breakage (a field box drifting, a post-processor regressing);
  * giving the harness something to run in CI.

The degradations below (rotation, perspective, blur, noise, JPEG, glare) exist to stop the
fixtures being trivially clean, not to simulate a real card. When real anonymized cards arrive,
drop them into `fixtures/real/` with a manifest of the same shape and re-run — no code changes.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from nidocr.layout import BACK_FIELDS, CANONICAL_SIZE, FRONT_FIELDS, FieldBox  # noqa: E402

# GNU FreeFont carries Arabic coverage and ships in most base images. Pillow must be built with
# raqm for correct joining/RTL shaping — verified in `check_font()` below, because silently
# rendering disjoint letterforms would produce fixtures that are unreadable by design.
FONT_CANDIDATES = (
    "/usr/share/fonts/truetype/freefont/FreeSerif.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
)

CARD_W, CARD_H = CANONICAL_SIZE

FIRST_NAMES = ("ندى", "أحمد", "سلمى", "محمود", "هالة", "كريم", "منى", "طارق")
NAME_CHAIN = ("محمد رضوان الحديدى عبده", "سامح بدوى محمد", "علي حسن إبراهيم", "فؤاد سمير عطية")
STREETS = ("برج الشروق - ش أحمد ماهر", "١٢ ش الجلاء", "٧ ش النيل - المعمورة", "٣٤ ش الجمهورية")
CITIES = ("المنصورة أول - الدقهلية", "قسم أول - القاهرة", "سموحة - الإسكندرية", "طنطا - الغربية")
OCCUPATIONS = ("معيدة بقسم الصحة العامة", "مهندس مدني", "محاسب", "أخصائي موارد بشرية")
RELIGIONS = ("مسلم", "مسلمة", "مسيحي", "مسيحية")
MARITAL = ("أعزب", "عزباء", "متزوج", "متزوجة", "مطلق", "مطلقة")

# Governorate codes the contracts package accepts — keeping fixtures structurally valid means the
# confidence-banding path is exercised for real rather than always vetoing.
GOV_CODES = ("01", "02", "03", "12", "13", "21", "26", "88")

WESTERN_TO_INDIC = str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩")


def to_indic(value: str) -> str:
    """Cards print every numeral in Eastern Arabic-Indic form."""
    return value.translate(WESTERN_TO_INDIC)


def check_font() -> str:
    """Pick an Arabic-capable font and fail loudly if shaping is unavailable."""
    from PIL import features

    if not features.check("raqm"):
        raise RuntimeError(
            "Pillow lacks raqm; Arabic would render unshaped (disjoint letters). "
            "Install libraqm, or use a Pillow wheel built with it."
        )
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return path
    raise RuntimeError(f"no Arabic-capable font found; tried: {FONT_CANDIDATES}")


def make_national_id(rng: random.Random) -> str:
    """A structurally valid 14-digit ID: C YYMMDD GG SSSS K, birth date always in the past."""
    century = rng.choice("23")
    base = 1900 if century == "2" else 2000
    year = rng.randint(base + 60 if century == "2" else base + 1, base + 99 if century == "2" else base + 6)
    month = rng.randint(1, 12)
    day = rng.randint(1, 28)  # 28 keeps every month valid without a calendar lookup
    return (
        f"{century}{year % 100:02d}{month:02d}{day:02d}"
        f"{rng.choice(GOV_CODES)}{rng.randint(0, 9999):04d}{rng.randint(0, 9)}"
    )


def _rtl(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, font, fill=(20, 20, 30)) -> None:
    """Draw right-anchored Arabic. `direction='rtl'` needs raqm — verified in check_font()."""
    draw.text(xy, text, font=font, fill=fill, direction="rtl", language="ar", anchor="rm")


def _in_box(
    draw: ImageDraw.ImageDraw, box: FieldBox, lines: list[str], font, fill=(20, 20, 30)
) -> None:
    """Render `lines` inside `box`, right-aligned and vertically distributed.

    Positions are DERIVED from `layout.py` rather than hardcoded here. That makes the geometry
    single-sourced: a box moves, the fixture text moves with it, and the synthetic set keeps
    testing the layout module instead of silently drifting away from it. (Real cards still need a
    calibration pass — see the note in layout.py — but that is a separate, explicit step.)
    """
    left, top, right, bottom = box.to_pixels((CARD_W, CARD_H))
    # Inset so glyph overhang (descenders, the tail of ي) stays inside the crop the pipeline takes.
    right -= 12
    slot = (bottom - top) / (len(lines) + 1)
    for index, line in enumerate(lines, start=1):
        _rtl(draw, (right, int(top + slot * index)), line, font, fill)


def render_front(record: dict, font_path: str) -> Image.Image:
    img = Image.new("RGB", (CARD_W, CARD_H), (238, 240, 246))
    draw = ImageDraw.Draw(img)

    # A faint lattice stands in for the guilloche — enough to stop the background being pure flat
    # white, which would make thresholding unrealistically easy.
    for x in range(0, CARD_W, 16):
        draw.line([(x, 0), (x - 120, CARD_H)], fill=(228, 232, 240), width=1)

    big = ImageFont.truetype(font_path, 38)
    mid = ImageFont.truetype(font_path, 28)
    mono = ImageFont.truetype(font_path, 44)

    draw.rectangle([28, 90, 250, 400], fill=(206, 212, 224), outline=(170, 178, 195))
    draw.text((139, 245), "PHOTO", font=mid, fill=(140, 148, 165), anchor="mm")
    draw.text(
        (CARD_W - 40, 40),
        "جمهورية مصر العربية",
        font=ImageFont.truetype(font_path, 30),
        fill=(25, 90, 60),
        direction="rtl",
        language="ar",
        anchor="ra",
    )

    boxes = {box.name: box for box in FRONT_FIELDS}
    _in_box(draw, boxes["fullNameAr"], [record["given_name"], record["name_chain"]], big)
    _in_box(draw, boxes["address"], [record["street"], record["city"]], mid)
    _in_box(draw, boxes["nationalId"], [to_indic(record["nationalId"])], mono)
    return img


def render_back(record: dict, font_path: str) -> Image.Image:
    img = Image.new("RGB", (CARD_W, CARD_H), (240, 236, 228))
    draw = ImageDraw.Draw(img)
    mid = ImageFont.truetype(font_path, 30)

    boxes = {box.name: box for box in BACK_FIELDS}
    _in_box(draw, boxes["occupation"], [record["occupation"]], mid)
    _in_box(draw, boxes["religion"], [record["religion"]], mid)
    _in_box(draw, boxes["maritalStatus"], [record["maritalStatus"]], mid)
    _in_box(draw, boxes["nationalIdExpiry"], [to_indic(record["expiry_printed"])], mid)

    # A dense high-contrast block, as printed across the lower back of the card. Included only so
    # the deskew estimator meets the same strong-gradient distraction it meets on a real card;
    # nothing in this pipeline reads it.
    rng = random.Random(record["nationalId"])
    for i in range(120):
        x = 40 + i * 7
        draw.rectangle([x, 440, x + rng.randint(1, 4), 600], fill=(20, 20, 20))
    return img


def degrade(img: Image.Image, rng: random.Random, level: str) -> np.ndarray:
    """Apply capture-like damage. `level` selects how hostile the sample is."""
    arr = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
    if level == "clean":
        return arr

    height, width = arr.shape[:2]
    jitter = 0.02 if level == "light" else 0.05
    src = np.float32([[0, 0], [width, 0], [width, height], [0, height]])
    dst = src + np.float32(
        [[rng.uniform(-jitter, jitter) * width, rng.uniform(-jitter, jitter) * height] for _ in range(4)]
    )
    arr = cv2.warpPerspective(
        arr, cv2.getPerspectiveTransform(src, dst), (width, height), borderMode=cv2.BORDER_REPLICATE
    )

    angle = rng.uniform(-3, 3) if level == "light" else rng.uniform(-8, 8)
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), angle, 1.0)
    arr = cv2.warpAffine(arr, matrix, (width, height), borderMode=cv2.BORDER_REPLICATE)

    if level == "harsh":
        # An off-centre bright blob — the glare case that defeats global thresholding.
        overlay = np.zeros_like(arr, dtype=np.float32)
        cv2.circle(
            overlay,
            (rng.randint(0, width), rng.randint(0, height)),
            rng.randint(120, 260),
            (255, 255, 255),
            -1,
        )
        overlay = cv2.GaussianBlur(overlay, (151, 151), 0)
        arr = np.clip(arr.astype(np.float32) + overlay * 0.45, 0, 255).astype(np.uint8)

    blur = 3 if level == "light" else 5
    arr = cv2.GaussianBlur(arr, (blur, blur), 0)
    noise = rng.uniform(2, 5) if level == "light" else rng.uniform(6, 12)
    arr = np.clip(
        arr.astype(np.float32) + np.random.default_rng(rng.randint(0, 10**6)).normal(0, noise, arr.shape),
        0,
        255,
    ).astype(np.uint8)

    quality = 85 if level == "light" else 55
    _, encoded = cv2.imencode(".jpg", arr, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    return cv2.imdecode(encoded, cv2.IMREAD_COLOR)


def build(count: int, out_dir: Path, seed: int) -> list[dict]:
    rng = random.Random(seed)
    font_path = check_font()
    out_dir.mkdir(parents=True, exist_ok=True)
    levels = ("clean", "light", "light", "harsh")
    manifest: list[dict] = []

    for index in range(count):
        national_id = make_national_id(rng)
        expiry = f"{rng.randint(2027, 2033)}/{rng.randint(1, 12):02d}/{rng.randint(1, 28):02d}"
        record = {
            "given_name": rng.choice(FIRST_NAMES),
            "name_chain": rng.choice(NAME_CHAIN),
            "street": rng.choice(STREETS),
            "city": rng.choice(CITIES),
            "occupation": rng.choice(OCCUPATIONS),
            "religion": rng.choice(RELIGIONS),
            "maritalStatus": rng.choice(MARITAL),
            "nationalId": national_id,
            "expiry_printed": expiry,
        }
        level = levels[index % len(levels)]
        front_name, back_name = f"synthetic-{index:03d}-front.jpg", f"synthetic-{index:03d}-back.jpg"
        cv2.imwrite(str(out_dir / front_name), degrade(render_front(record, font_path), rng, level))
        cv2.imwrite(str(out_dir / back_name), degrade(render_back(record, font_path), rng, level))

        manifest.append(
            {
                "id": f"synthetic-{index:03d}",
                "front": front_name,
                "back": back_name,
                "quality": level,
                "source": "synthetic",
                "truth": {
                    "fullNameAr": f"{record['given_name']} {record['name_chain']}",
                    "address": f"{record['street']} {record['city']}",
                    "nationalId": national_id,
                    "occupation": record["occupation"],
                    "religion": record["religion"],
                    "maritalStatus": record["maritalStatus"],
                    "nationalIdExpiry": expiry.replace("/", "-"),
                },
            }
        )

    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic National-ID fixtures.")
    parser.add_argument("--count", type=int, default=8)
    parser.add_argument("--out", default=str(Path(__file__).resolve().parents[1] / "fixtures" / "synthetic"))
    parser.add_argument("--seed", type=int, default=20260728)
    args = parser.parse_args()

    manifest = build(args.count, Path(args.out), args.seed)
    print(f"wrote {len(manifest)} fixtures + manifest.json → {args.out}")


if __name__ == "__main__":
    main()
