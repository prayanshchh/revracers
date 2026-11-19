import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

WIDTH = 4096
ROW = 256
GAP = 16
RED = (206, 58, 56)
WHITE = (244, 242, 240)
NAVY = (36, 52, 96)
FLAG_RED = (178, 34, 52)
FLAG_NAVY = (52, 50, 104)
SEED = 53
SIGNS = [
    ("main", "MAIN GRANDSTAND", "plain"),
    ("turn1", "TURN 1 GRANDSTAND", "stars"),
    ("turn4", "TURN 4 GRANDSTAND", "stars"),
    ("turn9", "TURN 9 GRANDSTAND", "stars"),
    ("turn12", "TURN 12 GRANDSTAND", "stars"),
    ("turn15", "TURN 15 GRANDSTAND", "ribbon"),
    ("turn19", "TURN 19 GRANDSTAND", "stars"),
    ("flag", "", "flag"),
]
TEXT_SHARE = 0.5
STRETCH = 1.18
SHEAR = 0.16
REPEATS = 1


def star_points(cx, cy, outer, inner, turn=-np.pi / 2):
    angles = turn + np.arange(10) * np.pi / 5
    radii = np.where(np.arange(10) % 2 == 0, outer, inner)
    return [(cx + r * np.cos(a), cy + r * np.sin(a)) for a, r in zip(angles, radii)]


def lettering(text, height, fonts):
    face = ImageFont.truetype(str(Path(fonts) / "montserrat.ttf"), int(height * 1.38))
    face.set_variation_by_axes([800])
    probe = ImageDraw.Draw(Image.new("L", (8, 8)))
    box = probe.textbbox((0, 0), text, font=face)
    width, tall = box[2] - box[0], box[3] - box[1]
    mask = Image.new("L", (width + 8, tall + 8), 0)
    ImageDraw.Draw(mask).text((4 - box[0], 4 - box[1]), text, font=face, fill=255)
    mask = mask.resize((int(mask.width * STRETCH), mask.height), Image.LANCZOS)
    pad = int(mask.height * SHEAR)
    return mask.transform((mask.width + pad, mask.height), Image.AFFINE, (1, SHEAR, -pad, 0, 1, 0), Image.BICUBIC)


def ribbon(draw, x0, x1, y0, y1):
    band = (y1 - y0) / 5
    for k, colour in enumerate([WHITE, NAVY, WHITE, NAVY, WHITE]):
        draw.polygon([(x0, y0 + k * band), (x1, y0 + k * band - 18), (x1, y0 + (k + 1) * band - 18), (x0, y0 + (k + 1) * band)], fill=colour)
    rng = np.random.default_rng(SEED)
    for _ in range(9):
        cx = rng.uniform(x0 + 20, x1 - 20)
        cy = rng.uniform(y0 + 10, y1 - 10)
        size = rng.uniform(14, 30)
        draw.polygon(star_points(cx, cy, size, size * 0.42), fill=RED if rng.random() < 0.5 else WHITE)


def flag(tall):
    wide = int(tall * 1.625)
    image = Image.new("RGB", (WIDTH, tall), RED)
    draw = ImageDraw.Draw(image)
    stripe = tall / 13
    for k in range(13):
        draw.rectangle([0, k * stripe, wide, (k + 1) * stripe], fill=FLAG_RED if k % 2 == 0 else WHITE)
    canton = (wide * 0.4, stripe * 7)
    draw.rectangle([0, 0, canton[0], canton[1]], fill=FLAG_NAVY)
    for row in range(9):
        for column in range(6 if row % 2 == 0 else 5):
            cx = canton[0] * (column + (0.5 if row % 2 == 0 else 1.0)) / 6
            cy = canton[1] * (row + 0.5) / 9
            draw.polygon(star_points(cx, cy, stripe * 0.36, stripe * 0.15), fill=WHITE)
    return image


def panel(text, style, fonts):
    tall = ROW - 2 * GAP
    if style == "flag":
        return flag(tall)
    image = Image.new("RGB", (WIDTH, tall), RED)
    draw = ImageDraw.Draw(image)
    mask = lettering(text, tall * TEXT_SHARE, fonts)
    cell = WIDTH // REPEATS
    for k in range(REPEATS):
        centre = cell * k + cell // 2
        image.paste(WHITE, (centre - mask.width // 2, (tall - mask.height) // 2), mask)
        if style == "stars":
            for side in (-1, 1):
                cx = centre + side * (mask.width // 2 + tall * 0.42)
                draw.polygon(star_points(cx, tall / 2, tall * 0.2, tall * 0.085), fill=WHITE)
        if style == "ribbon":
            for side in (-1, 1):
                inner = centre + side * (mask.width // 2 + 70)
                outer = inner + side * 640
                ribbon(draw, min(inner, outer), max(inner, outer), tall * 0.3, tall * 0.7)
    pixels = np.asarray(image, np.float32)
    folds = 1 + 0.035 * np.sin(np.arange(WIDTH) / 37.0)[None, :, None]
    return Image.fromarray(np.clip(pixels * folds, 0, 255).astype(np.uint8))


def atlas(fonts):
    image = Image.new("RGB", (WIDTH, ROW * len(SIGNS)), RED)
    for row, (_, text, style) in enumerate(SIGNS):
        image.paste(panel(text, style, fonts), (0, row * ROW + GAP))
    return image


def main():
    fonts, out = sys.argv[1], Path(sys.argv[2])
    atlas(fonts).save(out, "WEBP", quality=88, method=6)


if __name__ == "__main__":
    main()
