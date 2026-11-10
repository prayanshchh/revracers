import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from brands import BRANDS, font, lockup, text_at

FONTS = Path("build/hill-country/fonts")
WRAP = (2048, 256)
MARK_HEIGHT = 0.62
MARK_WIDTH = 0.42
EVENT_ROWS = (
    ("#NEONBOULEVARD", "#0a0a0c", "#ffffff", "montserrat", 800),
    ("REVRACERS", "#f4f4f6", "#101014", "anton", None),
    ("NEON BOULEVARD GRAND PRIX", "#2a0f6e", "#ff3db8", "oswald", 700),
    ("REVRACERS 26", "#e10600", "#ffffff", "anton", None),
)
BACKDROPS = {
    "NORTHWIND": "#1b2f86",
    "VOLTARA": "#3a1f8f",
    "AURENNE": "#0f8f93",
    "KESTREL": "#c8101c",
    "MARLOWE": "#1d7a44",
    "TORQUA": "#1673c9",
    "CORDAVE": "#6b1fa0",
    "VERDALE": "#2f9a45",
    "ALBAREN": "#13a9e6",
    "NIMBARA": "#f2f4f8",
    "MAISON": "#101012",
    "HALDEN": "#e8600f",
}
PANEL_GAP = 6
SEED = 11
FROND = (512, 128)


def mark_tile(art, background, fonts):
    width, height = WRAP
    tile = Image.new("RGB", WRAP, background)
    mark = lockup(art, fonts)
    scale = min(height * MARK_HEIGHT / mark.height, width * MARK_WIDTH / mark.width)
    mark = mark.resize((max(1, int(mark.width * scale)), max(1, int(mark.height * scale))), Image.LANCZOS)
    for centre in (width // 4, 3 * width // 4):
        tile.paste(mark, (centre - mark.width // 2, (height - mark.height) // 2), mark)
    return tile


def word_tile(text, background, ink, face, weight, fonts):
    width, height = WRAP
    tile = Image.new("RGB", WRAP, background)
    draw = ImageDraw.Draw(tile)
    size = 160
    typeface = font(fonts, face, size, weight)
    box = draw.textbbox((0, 0), text, font=typeface)
    scale = min(height * MARK_HEIGHT / (box[3] - box[1]), width * 0.44 / (box[2] - box[0]))
    typeface = font(fonts, face, int(size * scale), weight)
    for centre in (width // 4, 3 * width // 4):
        text_at(draw, text, typeface, ink, (centre, height // 2))
    return tile


def finish(tile, rng):
    width, height = WRAP
    image = np.asarray(tile, np.float32) / 255.0
    grain = rng.normal(0, 0.01, (height, width))[..., None]
    shade = np.linspace(1.04, 0.92, height, dtype=np.float32)[:, None, None]
    ramp = np.clip((np.arange(height) / height - 0.86) / 0.14, 0, 1)[:, None, None]
    image = image * shade * (1 - 0.25 * ramp) + 0.18 * 0.25 * ramp + grain
    for x in range(0, width, width // 2):
        image[:, max(0, x - 1) : x + 2] *= 0.8
    return np.clip(image, 0, 1)


def wraps(fonts):
    rng = np.random.default_rng(SEED)
    tiles = [mark_tile(art, BACKDROPS.get(name, background), fonts) for name, background, _, art in BRANDS]
    tiles += [word_tile(text, bg, ink, face, weight, fonts) for text, bg, ink, face, weight in EVENT_ROWS]
    width, height = WRAP
    row = height + 2 * PANEL_GAP
    atlas = np.zeros((row * len(tiles), width, 3), np.float32)
    for index, tile in enumerate(tiles):
        image = finish(tile, rng)
        top = index * row
        atlas[top : top + PANEL_GAP] = image[:1]
        atlas[top + PANEL_GAP : top + PANEL_GAP + height] = image
        atlas[top + PANEL_GAP + height : top + row] = image[-1:]
    return Image.fromarray(np.uint8(atlas * 255), "RGB"), len(tiles), row


def frond():
    width, height = FROND
    rng = np.random.default_rng(SEED)
    image = Image.new("RGBA", FROND, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    spine = height / 2
    draw.line([(0, spine), (width, spine)], fill=(92, 84, 52, 255), width=5)
    for x in range(8, width - 6, 4):
        t = x / width
        reach = (height / 2 - 6) * np.sin(np.pi * min(1.0, t * 1.15)) ** 0.7
        droop = 0.55 + 0.25 * rng.random()
        for sign in (-1, 1):
            tip = (x + reach * 0.55, spine + sign * reach * droop)
            shade = int(115 + 50 * rng.random())
            draw.line([(x, spine), tip], fill=(int(shade * 0.55), shade, int(shade * 0.3), 255), width=3)
    return image.filter(ImageFilter.GaussianBlur(0.5))


FENCE = 256
FENCE_CELLS = 4
FENCE_WIRE = 0.28


def fence():
    size = FENCE
    y, x = np.mgrid[0:size, 0:size].astype(np.float32) + 0.5
    cell = size / FENCE_CELLS
    a = ((x + y) / cell) % 1.0
    b = ((x - y) / cell) % 1.0
    distance = np.minimum(np.minimum(a, 1 - a), np.minimum(b, 1 - b)) * cell
    half = FENCE_WIRE * cell / 2
    alpha = np.clip(half + 0.75 - distance, 0, 1)
    shade = 0.75 + 0.25 * np.clip(1 - distance / max(half, 1), 0, 1)
    rgb = np.stack([shade * 0.86, shade * 0.88, shade * 0.9], -1)
    image = np.concatenate([rgb, alpha[..., None]], -1)
    return Image.fromarray(np.uint8(np.clip(image, 0, 1) * 255), "RGBA")


LEAVES = 256


def leaves():
    rng = np.random.default_rng(SEED + 5)
    size = LEAVES
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    centre = size / 2
    for _ in range(900):
        r = centre * np.sqrt(rng.random()) * 0.92
        a = rng.random() * np.pi * 2
        x, y = centre + r * np.cos(a), centre + r * np.sin(a)
        length = rng.uniform(9, 17)
        width = length * rng.uniform(0.35, 0.5)
        angle = rng.random() * np.pi
        dx, dy = np.cos(angle) * length / 2, np.sin(angle) * length / 2
        nx, ny = -np.sin(angle) * width / 2, np.cos(angle) * width / 2
        g = rng.uniform(0.72, 1.0)
        warm = rng.uniform(0.0, 1.0)
        colour = (int((62 + 40 * warm) * g), int((118 + 22 * warm) * g), int((36 + 6 * warm) * g), 255)
        draw.polygon([(x - dx, y - dy), (x + nx, y + ny), (x + dx, y + dy), (x - nx, y - ny)], fill=colour)
    return image.filter(ImageFilter.GaussianBlur(0.4))


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "content/tracks/neon-boulevard/textures")
    out.mkdir(parents=True, exist_ok=True)
    atlas, rows, row = wraps(FONTS)
    atlas.save(out / "wraps.webp", quality=88, method=6)
    frond().save(out / "frond.webp", lossless=True)
    fence().save(out / "fence.webp", lossless=True)
    leaves().save(out / "leaves.webp", lossless=True)
    print(f"wraps {atlas.width}x{atlas.height}, {rows} rows of {row} px")


if __name__ == "__main__":
    main()
