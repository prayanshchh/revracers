import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import gaussian_filter

import brands
from palette import PALETTE, PALETTE_CELLS, TEAMS, shade
from pitlane import FACADE_SIZE, FACADE_TILE, NUMBER_COLUMNS, NUMBER_TILE, TEAM_BAYS, bay_count

GRASS_HUE = 0.25
GRASS_SATURATION = 1.5
GRASS_VALUE = 0.7
STREAKS = (2048, 512)
STREAK_LAYERS = ((1.4, 60.0, 1.0), (3.5, 140.0, 0.8), (0.8, 18.0, 0.5))
KERB_SIZE = (512, 1024)
FONT = Path("apps/client/node_modules/@fontsource-variable/saira/files/saira-latin-wght-normal.woff2")
CHAINLINK = 256
CHAINLINK_WIRE = 14
CHAINLINK_COLOUR = (165, 168, 172)
DISTANCES = ("300", "200", "100")
PALETTE_SIZE = 256
FASCIA_GRID = (4, 7)
FASCIA_TILE = (1024, 96)
FASCIA_BOARD = 215
GARAGE_BACK = (1024, 512)
GARAGE_GRID = (4, 3)
CLADDING_TONE = (154, 158, 164)
CLADDING_JOINT = (100, 104, 110)
NUMBER_INK = "#22262c"
CLADDING_PANEL = (3, 6)
SHUTTER_TONE = (146, 150, 156)
SHUTTER_SLAT = 11
GLASS_TONES = ((66, 88, 112), (34, 46, 60))
GLASS_FRAME = (124, 128, 134)
CARBON_CELL = 16
FACADE_SEED = 61
PIT_DECAL = (1024, 1024)
PIT_TEXT = ("80", "PIT")
DISTANCE_BOARD = 512
FACADE = (2048, 896)
FACADE_METRES = (32.0, 14.0)
TECPRO = (1024, 256)
FENCE_METAL = (108, 112, 118)
TURF_PIXELS = 2048
TURF_SUPERSAMPLE = 2
TURF_LAYERS = (
    (0.0, 110000, (5, 11), (62, 76, 32), (84, 100, 40)),
    (0.35, 140000, (7, 16), (92, 114, 42), (128, 144, 56)),
    (0.7, 90000, (8, 19), (130, 148, 58), (176, 180, 84)),
)
TURF_STRAW = (0.07, (170, 158, 104), (198, 186, 128))
TURF_SOIL = (58, 62, 34)
TURF_CLUMP_PERIODS = (8, 16)
TURF_CLUMP_SHARE = 0.35
TURF_SEED = 41
TURF_QUALITY = 88
GRAVEL_CAVITY_RADIUS = 5.0
GRAVEL_CAVITY_GAIN = 6.0
GRAVEL_CAVITY_RANGE = (0.42, 1.08)
GRAVEL_QUALITY = 90


def load(path, mode="RGB"):
    return np.asarray(Image.open(path).convert(mode), np.float32) / 255.0


def save(array, path):
    Image.fromarray(np.clip(np.round(array * 255.0), 0, 255).astype(np.uint8)).save(path, quality=92)


def grass(source):
    hsv = load(source / "withered_grass_base_color.jpg", "RGB")
    image = Image.fromarray((hsv * 255).astype(np.uint8)).convert("HSV")
    h, s, v = [np.asarray(c, np.float32) / 255.0 for c in image.split()]
    h = np.mod(h - h.mean() + GRASS_HUE, 1.0)
    s = np.clip(s * GRASS_SATURATION, 0, 1)
    v = np.clip(v * GRASS_VALUE, 0, 1)
    merged = Image.merge("HSV", [Image.fromarray(np.round(c * 255).astype(np.uint8)) for c in (h, s, v)])
    return np.asarray(merged.convert("RGB"), np.float32) / 255.0


def kerb(source):
    width, height = KERB_SIZE
    red = load(source / "circuit_paint_red.jpg")
    white = load(source / "circuit_paint_white.jpg")
    out = np.empty((height, width, 3), np.float32)
    half = height // 2
    out[:half] = red[:half, :width]
    out[half:] = white[:half, :width]
    rubber = np.asarray(Image.open(source / "rubber_streaks.png").convert("RGBA").resize((width, height)), np.float32) / 255.0
    alpha = rubber[..., 3:4] * np.linspace(1.0, 0.25, width)[None, :, None]
    return out * (1 - alpha * 0.9) + rubber[..., :3] * alpha * 0.9


def tileable_noise(rng, size, periods):
    out = np.zeros((size, size), np.float32)
    for period in periods:
        coarse = rng.normal(0, 1, (period, period)).astype(np.float32)
        tiled = np.tile(coarse, (3, 3))
        image = Image.fromarray(tiled).resize((size * 3, size * 3), Image.BICUBIC)
        out += np.asarray(image, np.float32)[size : 2 * size, size : 2 * size]
    return out / out.std()


def turf():
    rng = np.random.default_rng(TURF_SEED)
    size = TURF_PIXELS * TURF_SUPERSAMPLE
    colour = Image.new("RGB", (size, size), TURF_SOIL)
    paint = ImageDraw.Draw(colour)
    clumps = tileable_noise(rng, TURF_PIXELS, TURF_CLUMP_PERIODS)
    for base, count, length, low, high in TURF_LAYERS:
        x, y = rng.uniform(0, size, count), rng.uniform(0, size, count)
        angle = rng.uniform(0, np.pi, count)
        reach = rng.uniform(*length, count) * TURF_SUPERSAMPLE
        cell = clumps[(y / TURF_SUPERSAMPLE).astype(int) % TURF_PIXELS, (x / TURF_SUPERSAMPLE).astype(int) % TURF_PIXELS]
        shade = np.clip(rng.uniform(0, 1, count) * (1 - TURF_CLUMP_SHARE) + (cell * 0.5 + 0.5) * TURF_CLUMP_SHARE, 0, 1)
        straw = rng.uniform(0, 1, count) < TURF_STRAW[0]
        lo, hi = np.array(low, np.float32), np.array(high, np.float32)
        tones = lo[None] + (hi - lo)[None] * shade[:, None]
        dead = np.array(TURF_STRAW[1], np.float32) + (np.array(TURF_STRAW[2], np.float32) - np.array(TURF_STRAW[1], np.float32)) * rng.uniform(0, 1, (count, 1))
        tones = np.where(straw[:, None], dead, tones)
        widths = rng.integers(2, 4, count)
        for k in range(count):
            dx, dy = np.cos(angle[k]) * reach[k], np.sin(angle[k]) * reach[k]
            tone = tuple(int(v * (0.82 + 0.18 * base)) for v in tones[k])
            for ox in (0, -size, size) if x[k] < reach[k] or x[k] > size - reach[k] else (0,):
                for oy in (0, -size, size) if y[k] < reach[k] or y[k] > size - reach[k] else (0,):
                    a = (x[k] + ox - dx / 2, y[k] + oy - dy / 2)
                    b = (x[k] + ox + dx / 2, y[k] + oy + dy / 2)
                    paint.line([a, b], fill=tone, width=int(widths[k]))
    return colour.resize((TURF_PIXELS, TURF_PIXELS), Image.LANCZOS)


def gravel(source):
    colour = load(source / "gravel_floor_base_color.jpg")
    height = load(source / "gravel_floor_height.jpg", "L")
    surround = gaussian_filter(height, GRAVEL_CAVITY_RADIUS, mode="wrap")
    cavity = np.clip(1 + (height - surround) * GRAVEL_CAVITY_GAIN, *GRAVEL_CAVITY_RANGE)
    return colour * cavity[..., None]


def streaks():
    rng = np.random.default_rng(23)
    height, width = STREAKS
    out = np.zeros((height, width), np.float32)
    for across, along, gain in STREAK_LAYERS:
        spectrum = np.fft.fft2(rng.normal(0, 1, (height, width)))
        fy = np.fft.fftfreq(height)[:, None]
        fx = np.fft.fftfreq(width)[None, :]
        spectrum *= np.exp(-2 * np.pi**2 * ((fy * along) ** 2 + (fx * across) ** 2))
        layer = np.real(np.fft.ifft2(spectrum))
        out += layer / layer.std() * gain
    out = np.clip(0.5 + out * 0.18, 0, 1)
    return Image.fromarray(np.round(out * 255).astype(np.uint8), "L")


def font(size, weight):
    face = ImageFont.truetype(str(FONT), size)
    face.set_variation_by_axes([weight])
    return face


def tecpro():
    rng = np.random.default_rng(13)
    width, height = TECPRO
    base = np.full((height, width, 3), 0.62, np.float32) * np.array([1.0, 0.99, 0.96], np.float32)
    streak = np.asarray(Image.fromarray(np.uint8(rng.random((8, width // 8)) * 255)).resize((width, height), Image.BICUBIC), np.float32) / 255.0
    base *= (0.94 + 0.09 * streak)[..., None]
    ramp = np.linspace(0, 1, height)[:, None, None] ** 2
    base = base * (1 - 0.5 * ramp) + np.array([0.24, 0.21, 0.18], np.float32) * 0.5 * ramp
    base[:, :6] *= 0.45
    base[:, -6:] *= 0.45
    base[:10] *= 0.8
    return np.clip(base + rng.normal(0, 0.012, (height, width, 1)), 0, 1)


def chainlink():
    size = CHAINLINK
    image = Image.new("RGBA", (size, size), (*CHAINLINK_COLOUR, 0))
    draw = ImageDraw.Draw(image)
    for shift in (-size, 0, size):
        draw.line([(shift, 0), (shift + size, size)], fill=(*CHAINLINK_COLOUR, 255), width=CHAINLINK_WIRE)
        draw.line([(shift + size, 0), (shift, size)], fill=(*CHAINLINK_COLOUR, 255), width=CHAINLINK_WIRE)
    return image


def pit_decals():
    atlas = Image.new("L", PIT_DECAL, 0)
    draw = ImageDraw.Draw(atlas)
    width, height = PIT_DECAL
    for index, text in enumerate(PIT_TEXT):
        top = index * height // len(PIT_TEXT)
        size = height // len(PIT_TEXT) - 40
        face = font(size, 900)
        while draw.textbbox((0, 0), text, font=face)[2] > width * 0.9:
            size -= 8
            face = font(size, 900)
        box = draw.textbbox((0, 0), text, font=face)
        draw.text(((width - box[2] - box[0]) // 2, top + (height // len(PIT_TEXT) - box[3] - box[1]) // 2), text, font=face, fill=255)
    alpha = np.asarray(atlas, np.float32) / 255.0
    rgba = np.ones(alpha.shape + (4,), np.float32) * 0.94
    rgba[..., 3] = alpha * 0.92
    return Image.fromarray(np.round(rgba * 255).astype(np.uint8), "RGBA")


def palette():
    cell = PALETTE_SIZE // PALETTE_CELLS
    image = Image.new("RGB", (PALETTE_SIZE, PALETTE_SIZE), "#808080")
    draw = ImageDraw.Draw(image)
    for index, colour in enumerate(PALETTE.values()):
        x, y = index % PALETTE_CELLS * cell, index // PALETTE_CELLS * cell
        draw.rectangle([x, y, x + cell - 1, y + cell - 1], fill=colour)
    return image


def fitted(draw, text, size, weight, limit):
    face = font(size, weight)
    while size > 10 and draw.textlength(text, font=face) > limit:
        size -= 2
        face = font(size, weight)
    return face


def fascia(bays):
    columns, rows = FASCIA_GRID
    width, height = FASCIA_TILE
    atlas = Image.new("RGB", (width * columns, height * rows), "#0d1118")
    draw = ImageDraw.Draw(atlas)
    first = (bays - TEAM_BAYS * len(TEAMS)) // 2
    number = font(62, 800)
    code = font(20, 700)
    for index in range(columns * rows):
        x, y = index % columns * width, index // columns * height
        draw.rectangle([x, y + height - 4, x + width - 1, y + height - 1], fill="#1f2633")
        team = (index - first) // TEAM_BAYS
        if not 0 <= team < len(TEAMS) or index >= bays:
            continue
        data = TEAMS[team]
        driver = data["drivers"][(index - first) % TEAM_BAYS]
        left, right = x + width // 2 - FASCIA_BOARD, x + width // 2 + FASCIA_BOARD
        draw.rectangle([left, y + 6, left + 104, y + height - 12], fill=data["colours"]["primary"])
        draw.polygon([(left + 104, y + 6), (left + 132, y + 6), (left + 104, y + height - 12)], fill=data["colours"]["primary"])
        draw.rectangle([left, y + height - 10, right, y + height - 5], fill=data["brand"])
        box = draw.textbbox((0, 0), str(driver["number"]), font=number)
        draw.text((left + 54 - (box[2] + box[0]) / 2, y + 40 - (box[3] + box[1]) / 2), str(driver["number"]), font=number, fill="#ffffff")
        start = left + 148
        given = font(28, 500)
        draw.text((start, y + 42), driver["first"], font=given, fill="#c3cad6", anchor="ls")
        reach = start + draw.textlength(driver["first"] + " ", font=given)
        family = fitted(draw, driver["last"].upper(), 32, 800, right - 64 - reach)
        draw.text((reach, y + 42), driver["last"].upper(), font=family, fill="#ffffff", anchor="ls")
        draw.text((start, y + 54), data["fullName"].upper(), font=fitted(draw, data["fullName"].upper(), 18, 600, right - 64 - start), fill="#8f98a8")
        draw.rounded_rectangle([right - 52, y + 14, right, y + 46], 5, outline="#8f98a8", width=2)
        box = draw.textbbox((0, 0), driver["nationality"], font=code)
        draw.text((right - 26 - (box[2] + box[0]) / 2, y + 30 - (box[3] + box[1]) / 2), driver["nationality"], font=code, fill="#e6e9ee")
    return atlas


def wall_screen(draw, x, y, chart):
    draw.rectangle([x, y, x + 170, y + 100], fill="#0b0d11")
    draw.rectangle([x + 5, y + 5, x + 165, y + 95], fill="#0f1826")
    if chart:
        points = [(x + 22, y + 70), (x + 40, y + 34), (x + 74, y + 26), (x + 96, y + 44), (x + 132, y + 30), (x + 146, y + 62), (x + 104, y + 78), (x + 60, y + 66), (x + 22, y + 70)]
        draw.line(points, fill="#43c6e8", width=3)
        draw.ellipse([x + 92, y + 40, x + 100, y + 48], fill="#f2c418")
        return
    for row in range(7):
        top = y + 11 + row * 12
        draw.rectangle([x + 11, top, x + 15, top + 7], fill=TEAMS[row % len(TEAMS)]["brand"])
        draw.rectangle([x + 20, top + 1, x + 70 + (row * 13) % 22, top + 6], fill="#aab4c4")
        draw.rectangle([x + 112, top + 1, x + 156, top + 6], fill="#6fd08c" if row % 3 else "#c084fc")


def garage_panel(team):
    width, height = GARAGE_BACK
    deep = team["colours"]["primary"] if team else "#1b2230"
    brand = team["brand"] if team else "#3a4252"
    image = Image.new("RGB", GARAGE_BACK, "#d4d6d9")
    draw = ImageDraw.Draw(image)
    for x in range(0, width, 113):
        draw.line([x, 0, x, height], fill="#c1c4c8", width=2)
    draw.rectangle([0, 0, width, 64], fill=deep)
    draw.rectangle([0, 64, width, 70], fill=brand)
    draw.rectangle([0, 400, width, height], fill="#2b2e34")
    draw.rectangle([0, 400, width, 405], fill="#3a3e45")
    for x in (0, width - 10):
        draw.rectangle([x, 70, x + 10, 400], fill=brand)
    if not team:
        return image
    sponsors = team["sponsors"]
    small = font(24, 700)
    for k, name in enumerate(sponsors):
        centre = width * (k + 0.5) / len(sponsors)
        draw.text((centre - draw.textlength(name, font=small) / 2, 17), name, font=small, fill="#ffffff")
    title = fitted(draw, team["name"].upper(), 132, 800, width * 0.36)
    box = draw.textbbox((0, 0), team["name"].upper(), font=title)
    draw.text(((width - box[2] - box[0]) / 2, 205 - (box[3] + box[1]) / 2), team["name"].upper(), font=title, fill=deep)
    draw.rectangle([width / 2 - 70, 272, width / 2 + 70, 277], fill=brand)
    line = fitted(draw, team["fullName"].upper(), 22, 600, width * 0.4)
    draw.text(((width - draw.textlength(team["fullName"].upper(), font=line)) / 2, 290), team["fullName"].upper(), font=line, fill="#5c6370")
    wall_screen(draw, 115, 150, False)
    wall_screen(draw, width - 285, 150, True)
    return image


def garage_back():
    columns, rows = GARAGE_GRID
    width, height = GARAGE_BACK
    atlas = Image.new("RGB", (width * columns, height * rows))
    for index in range(columns * rows):
        team = TEAMS[index] if index < len(TEAMS) else None
        atlas.paste(garage_panel(team), (index % columns * width, index // columns * height))
    return atlas


def cladding_tile(rng):
    size = FACADE_TILE
    across, down = CLADDING_PANEL
    tone = np.empty((size, size, 3), np.float32)
    tone[:] = CLADDING_TONE
    xs, ys = np.arange(size) * across // size, np.arange(size) * down // size
    tone += rng.uniform(-4, 4, (down, across))[ys][:, xs][..., None]
    tone += rng.normal(0, 1.2, (size, size, 1))
    for k in range(across):
        x = k * size // across
        tone[:, x : x + 2] = CLADDING_JOINT
        tone[:, x + 2 : x + 3] += 12
    for k in range(down):
        y = k * size // down
        tone[y : y + 2] = CLADDING_JOINT
        tone[y + 2 : y + 3] += 12
    return tone


def shutter_tile():
    size = FACADE_TILE
    rows = np.arange(size) % SHUTTER_SLAT / SHUTTER_SLAT
    tone = np.empty((size, size, 3), np.float32)
    tone[:] = SHUTTER_TONE
    tone += (14 - 32 * rows)[:, None, None]
    tone[:, :12] = (70, 73, 78)
    tone[:, -12:] = (70, 73, 78)
    tone[-14:] = (58, 61, 66)
    for k in range(5):
        x = 86 + k * 72
        tone[276:338, x - 3 : x + 55] = (92, 96, 102)
        tone[280:334, x : x + 52] = (24, 30, 38)
    return tone


def glazing_tile():
    size = FACADE_TILE
    fade = np.linspace(0, 1, size)[:, None, None]
    top, bottom = (np.array(v, np.float32) for v in GLASS_TONES)
    tone = np.broadcast_to(top + (bottom - top) * fade, (size, size, 3)).copy()
    y, x = np.mgrid[0:size, 0:size]
    tone += (12 * np.exp(-(((x + y) - 430) / 60.0) ** 2))[..., None]
    tone[40:250, 270:500] += 9
    tone[-80:] = (30, 33, 38)
    tone[-84:-80] = GLASS_FRAME
    tone[268:273] = GLASS_FRAME
    for a, b in ((0, 7), (size - 7, size), (253, 259)):
        tone[:, a:b] = GLASS_FRAME
    tone[:7] = GLASS_FRAME
    return tone


def carbon_tile():
    size, cell = FACADE_TILE, CARBON_CELL
    y, x = np.mgrid[0:size, 0:size]
    over = ((x // cell + y // cell) % 4) < 2
    along = np.where(over, x % cell, y % cell) / cell
    sheen = np.sin(np.pi * along) * np.where(over, 13, 7)
    tone = 24 + np.where(over, 8, 0) + sheen
    return np.stack([tone, tone, tone + 2], -1).astype(np.float32)


def pit_facade():
    rng = np.random.default_rng(FACADE_SEED)
    width, height = FACADE_SIZE
    tone = np.empty((height, width, 3), np.float32)
    tone[:] = CLADDING_TONE
    for index, tile in enumerate((cladding_tile(rng), shutter_tile(), glazing_tile(), carbon_tile())):
        tone[:FACADE_TILE, index * FACADE_TILE : (index + 1) * FACADE_TILE] = tile
    image = Image.fromarray(np.clip(np.round(tone), 0, 255).astype(np.uint8))
    draw = ImageDraw.Draw(image)
    face = font(84, 700)
    for number in range(1, NUMBER_COLUMNS * ((height - FACADE_TILE) // NUMBER_TILE) + 1):
        x, y = (number - 1) % NUMBER_COLUMNS * NUMBER_TILE, FACADE_TILE + (number - 1) // NUMBER_COLUMNS * NUMBER_TILE
        box = draw.textbbox((0, 0), str(number), font=face)
        draw.text((x + NUMBER_TILE / 2 - (box[2] + box[0]) / 2, y + NUMBER_TILE / 2 - (box[3] + box[1]) / 2), str(number), font=face, fill=NUMBER_INK)
    return image


def pit_signs():
    size = 512
    atlas = Image.new("RGB", (size, size * 2), "#ffffff")
    draw = ImageDraw.Draw(atlas)
    draw.ellipse([60, 60, size - 60, size - 60], fill="#ffffff", outline="#d01020", width=46)
    face = font(190, 800)
    box = draw.textbbox((0, 0), "80", font=face)
    draw.text(((size - box[2] - box[0]) // 2, (size - box[3] - box[1]) // 2), "80", font=face, fill="#101010")
    draw.rectangle([0, size, size, size * 2], fill="#101412")
    for top in (size + 70, size + 240):
        draw.polygon([(size // 2, top), (size - 70, top + 170), (size - 170, top + 170), (size // 2, top + 70), (170, top + 170), (70, top + 170)], fill="#38d27a")
    return atlas


CREW_ATLAS = (2048, 1408)
CREW_WIDTH = 2.0
CREW_HEIGHT = 2.2
CREW_KIT = {"suit": "#1b4fa8", "dark": "#0d2a66", "trim": "#f28a12", "accent": "#f4c43f", "white": "#eef0f2", "black": "#0c0d10", "back": "STEALTH", "full": "STEALTH RACING", "chest": "NORTHWIND", "legs": "VOLTARA", "arm": "KESTREL", "collar": "AURENNE"}
CREW_DARKEN = 0.55
CREW_LIGHT_SUIT = 0.55


def crew_kit(team):
    primary = team["colours"]["primary"]
    light = np.dot([int(primary[i : i + 2], 16) / 255 for i in (1, 3, 5)], [0.2126, 0.7152, 0.0722]) > CREW_LIGHT_SUIT
    return {
        "suit": primary,
        "dark": shade(primary, CREW_DARKEN),
        "trim": team["brand"],
        "accent": team["colours"]["accent"],
        "white": "#15171b" if light else "#eef0f2",
        "black": "#0c0d10",
        "back": team["name"].upper(),
        "full": team["fullName"].upper(),
        "chest": team["sponsors"][0],
        "legs": team["sponsors"][1],
        "arm": team["sponsors"][2],
        "collar": team["sponsors"][3],
    }


def crew_suit(kit=CREW_KIT):
    width, height = CREW_ATLAS
    half = width // 2
    image = Image.new("RGB", CREW_ATLAS, kit["suit"])
    draw = ImageDraw.Draw(image)

    def to(side, x, z):
        return (side * half + half / 2 + x / CREW_WIDTH * half, height - z / CREW_HEIGHT * height)

    def band(side, x0, x1, z0, z1, colour):
        (ax, ay), (bx, by) = to(side, x0, z1), to(side, x1, z0)
        draw.rectangle([min(ax, bx), ay, max(ax, bx), by], fill=colour)

    def label(side, x, z, text, size, colour, weight=800):
        face = font(size, weight)
        cx, cy = to(side, x, z)
        box = draw.textbbox((0, 0), text, font=face)
        draw.text((cx - (box[2] + box[0]) / 2, cy - (box[3] + box[1]) / 2), text, font=face, fill=colour)

    def upright(side, x, z, text, size, colour, turn):
        face = font(size, 760)
        box = draw.textbbox((0, 0), text, font=face)
        layer = Image.new("RGBA", (box[2] + 8, box[3] + 8), (0, 0, 0, 0))
        ImageDraw.Draw(layer).text((4 - box[0], 4 - box[1] + box[1]), text, font=face, fill=colour)
        layer = layer.rotate(turn, expand=True)
        cx, cy = to(side, x, z)
        image.paste(layer, (round(cx - layer.width / 2), round(cy - layer.height / 2)), layer)

    def disc(side, x, z, radius, fill, text, ink, size):
        cx, cy = to(side, x, z)
        r = radius / CREW_WIDTH * half
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill, outline=kit["white"], width=2)
        label(side, x, z, text, size, ink)

    def badge(side, x, z, size):
        cx, cy = to(side, x, z)
        w = size / CREW_WIDTH * half
        shape = [(cx - w, cy - w * 1.1), (cx + w, cy - w * 1.1), (cx + w, cy + w * 0.2), (cx, cy + w * 1.25), (cx - w, cy + w * 0.2)]
        draw.polygon(shape, fill=kit["accent"], outline=kit["white"])
        draw.polygon([(px, py + w * 0.18) for px, py in shape[:2]] + [(cx + w * 0.62, cy + w * 0.12), (cx, cy + w * 0.9), (cx - w * 0.62, cy + w * 0.12)], fill=kit["black"])
        label(side, x, z - 0.004, kit["back"][:1], 15, kit["accent"])

    def patch(side, x, z, text, size, ink, fill):
        face = font(size, 800)
        box = draw.textbbox((0, 0), text, font=face)
        cx, cy = to(side, x, z)
        w, h = (box[2] - box[0]) / 2 + 6, (box[3] - box[1]) / 2 + 4
        draw.rounded_rectangle([cx - w, cy - h, cx + w, cy + h], radius=4, fill=fill)
        label(side, x, z, text, size, ink)

    for side in (0, 1):
        band(side, -1.0, 1.0, 0.0, 0.03, kit["black"])
        band(side, -1.0, 1.0, 0.03, 0.14, kit["suit"])
        for sign in (1, -1):
            draw.polygon([to(side, sign * 0.04, 0.05), to(side, sign * 0.2, 0.085), to(side, sign * 0.2, 0.1), to(side, sign * 0.04, 0.068)], fill=kit["white"])
        band(side, -1.0, 1.0, 0.14, 0.16, kit["dark"])
        for sign in (1, -1):
            band(side, sign * 0.69, sign * 1.0, 1.2, 1.7, kit["black"])
            band(side, sign * 0.66, sign * 0.69, 1.2, 1.7, kit["dark"])
            band(side, sign * 0.13, sign * 0.66, 1.44, 1.478, kit["white"])
            band(side, sign * 0.17, sign * 0.185, 1.02, 1.36, kit["white"])
            band(side, sign * 0.205, sign * 0.22, 1.0, 1.4, kit["dark"])
        band(side, -0.2, 0.2, 0.985, 1.01, kit["dark"])
        band(side, -0.11, 0.11, 1.5, 1.53, kit["white"])
        band(side, -0.11, 0.11, 1.53, 1.62, kit["suit"])
    badge(0, 0.085, 1.33, 0.032)
    disc(0, -0.09, 1.335, 0.034, kit["trim"], kit["chest"][:2].lower(), "#ffffff", 17)
    label(0, 0.0, 1.18, kit["legs"], 19, kit["white"])
    band(0, -0.06, 0.06, 1.162, 1.166, kit["trim"])
    label(0, 0.0, 1.07, kit["arm"], 12, kit["white"], 700)
    label(0, 0.0, 1.512, kit["collar"], 9, kit["suit"], 700)
    for sign in (1, -1):
        patch(0, sign * 0.36, 1.41, kit["chest"], 10, kit["suit"], kit["white"])
        patch(1, sign * 0.36, 1.41, kit["arm"], 10, kit["suit"], kit["white"])
        label(0, sign * 0.5, 1.405, kit["collar"], 9, kit["white"], 700)
        upright(0, sign * 0.13, 0.6, kit["full"], 15, kit["white"], 90 * sign)
        upright(1, sign * 0.13, 0.6, kit["full"], 15, kit["white"], -90 * sign)
        label(0, sign * 0.1, 0.92, kit["arm"], 11, kit["white"], 700)
    disc(1, 0.0, 1.33, 0.06, kit["trim"], kit["chest"][:2].lower(), "#ffffff", 30)
    label(1, 0, 1.19, kit["back"], 30, kit["white"])
    label(1, 0, 1.1, kit["legs"], 16, kit["white"])
    label(1, 0, 0.99, kit["chest"], 12, kit["white"], 700)
    helmet(draw, width, round(height * 0.14), kit)
    return image


def helmet(draw, width, top, kit):
    draw.rectangle([0, 0, width, top], fill=kit["suit"])
    stripe, radius, crown = 0.035, 0.11, 0.116
    for y in range(top):
        z = 0.13 - 0.27 * y / top
        ring = radius * math.sqrt(max(1e-4, 1 - min(1.0, (z / crown) ** 2)))
        reach = min(0.5, stripe / (2 * math.pi * ring)) * width
        for centre, floor in ((0.5, 0.025), (0.0, -0.09), (1.0, -0.09)):
            if z > floor:
                draw.line([centre * width - reach, y, centre * width + reach, y], fill=kit["white"])
    draw.rectangle([0, top * 0.88, width, top], fill=kit["black"])
    face = font(20, 800)
    for side in (0.25, 0.75):
        cx, cy = side * width, top * (0.13 - 0.0) / 0.27
        box = draw.textbbox((0, 0), kit["chest"], font=face)
        w, h = (box[2] - box[0]) / 2 + 8, (box[3] - box[1]) / 2 + 5
        draw.rounded_rectangle([cx - w, cy - h, cx + w, cy + h], radius=6, fill=kit["white"])
        draw.text((cx - (box[2] + box[0]) / 2, cy - (box[3] + box[1]) / 2), kit["chest"], font=face, fill=kit["suit"])


STATIC_TILE = (512, 352)
STATIC_GRID = (4, 3)


def crew_polo(team_colour, trim=None, overalls=False):
    width, height = CREW_ATLAS
    half = width // 2
    shirt = team_colour
    trousers = team_colour if overalls else "#17191f"
    image = Image.new("RGB", CREW_ATLAS, trousers)
    draw = ImageDraw.Draw(image)

    def box(side, x0, x1, z0, z1, colour):
        y0, y1 = height - z1 / CREW_HEIGHT * height, height - z0 / CREW_HEIGHT * height
        ax = side * half + half / 2 + x0 / CREW_WIDTH * half
        bx = side * half + half / 2 + x1 / CREW_WIDTH * half
        draw.rectangle([min(ax, bx), y0, max(ax, bx), y1], fill=colour)

    for side in (0, 1):
        box(side, -1.0, 1.0, 0.0, 0.14, "#0c0d10")
        box(side, -1.0, 1.0, 1.02, 1.7, shirt)
        if not overalls:
            box(side, -0.08, 0.08, 1.42, 1.56, "#17191f")
            box(side, -0.24, 0.24, 0.98, 1.03, "#0c0d10")
            for sign in (1, -1):
                box(side, sign * 0.3, sign * 0.46, 1.2, 1.7, trim)
                box(side, sign * 0.13, sign * 0.17, 1.03, 1.4, trim)
        else:
            for sign in (1, -1):
                box(side, sign * 0.03, sign * 0.21, 0.72, 0.76, "#d9dcde")
                box(side, sign * 0.03, sign * 0.17, 1.22, 1.26, "#d9dcde")
    return image


def crew_static_atlas():
    tile_w, tile_h = STATIC_TILE
    columns, rows = STATIC_GRID
    atlas = Image.new("RGB", (tile_w * columns, tile_h * rows))
    tiles = [crew_polo(team["colours"]["primary"], team["brand"]) for team in TEAMS] + [crew_polo("#e8701a", overalls=True)]
    for index, tile in enumerate(tiles):
        atlas.paste(tile.resize(STATIC_TILE), (index % columns * tile_w, index // columns * tile_h))
    return atlas


MARKS = (1024, 192)
MARK_ROWS = (0.32, 0.5, 0.82)


def track_marks():
    width, height = MARKS
    row_height = height // len(MARK_ROWS)
    rng = np.random.default_rng(41)
    alpha = np.zeros((height, width), np.float32)
    across = np.linspace(-1, 1, row_height)
    edge = np.clip((1 - np.abs(across)) / 0.35, 0, 1)
    for row, strength in enumerate(MARK_ROWS):
        streaks = np.repeat(rng.random((row_height // 4 + 1, width // 16 + 1)), 4, axis=0)[:row_height]
        streaks = np.repeat(streaks, 16, axis=1)[:, :width]
        grain = rng.random((row_height, width))
        along = 0.75 + 0.25 * np.sin(np.linspace(0, 12 * np.pi, width) + row)
        alpha[row * row_height : (row + 1) * row_height] = strength * edge[:, None] * (0.55 + 0.3 * streaks + 0.15 * grain) * along
    rgba = np.zeros((height, width, 4), np.float32)
    rgba[..., :3] = 0.015
    rgba[..., 3] = np.clip(alpha, 0, 1)
    return Image.fromarray(np.round(rgba * 255).astype(np.uint8), "RGBA")


def crew_normal():
    width, height = CREW_ATLAS[0] // 2, CREW_ATLAS[1] // 2
    rng = np.random.default_rng(31)
    fine = rng.normal(0, 1, (height, width))
    blur = lambda values, sx, sy: np.real(np.fft.ifft2(np.fft.fft2(values) * np.exp(-2 * np.pi**2 * ((np.fft.fftfreq(height)[:, None] * sy) ** 2 + (np.fft.fftfreq(width)[None, :] * sx) ** 2))))
    folds = blur(rng.normal(0, 1, (height, width)), 2.4, 7)
    folds = folds / folds.std()
    weave = blur(fine, 0.8, 0.8)
    weave = weave / weave.std()
    relief = folds * 1.4 + weave * 0.18
    dx = np.roll(relief, -1, 1) - np.roll(relief, 1, 1)
    dy = np.roll(relief, -1, 0) - np.roll(relief, 1, 0)
    normal = np.stack([-dx * 0.14, dy * 0.14, np.ones_like(relief)], -1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    return Image.fromarray(np.round((normal * 0.5 + 0.5) * 255).astype(np.uint8), "RGB")


def distance_boards():
    size = DISTANCE_BOARD
    atlas = Image.new("RGB", (size, size * len(DISTANCES)))
    for index, label in enumerate(DISTANCES):
        panel = Image.new("RGB", (size, size), "#0b1d45")
        draw = ImageDraw.Draw(panel)
        draw.rectangle([0, 0, size - 1, size - 1], outline="#ffffff", width=28)
        face = font(int(size * 0.42), 800)
        box = draw.textbbox((0, 0), label, font=face)
        draw.text(((size - box[2] - box[0]) // 2, (size - box[3] - box[1]) // 2), label, font=face, fill="#ffffff")
        atlas.paste(panel, (0, index * size))
    return np.asarray(atlas, np.float32) / 255.0


def facade():
    width, height = FACADE
    px = width / FACADE_METRES[0]
    image = Image.new("RGB", FACADE, "#e6e6e2")
    draw = ImageDraw.Draw(image)
    y = lambda metres: height - int(metres * px)
    for bay in range(4):
        left = int((bay * 8 + 1) * px)
        draw.rectangle([left, y(4.2), left + int(6 * px), y(0)], fill="#1c1f24")
        draw.rectangle([left, y(4.2), left + int(6 * px), y(4.2) + 10], fill="#3a3f47")
    draw.rectangle([0, y(12), width, y(6)], fill="#2a3a4a")
    for pane in range(17):
        x = int(pane * 2 * px)
        draw.rectangle([x, y(12), x + 6, y(6)], fill="#9aa3ad")
    draw.rectangle([0, y(9.05), width, y(8.95)], fill="#9aa3ad")
    out = np.asarray(image, np.float32) / 255.0
    sheen = np.linspace(1.08, 0.92, height)[:, None, None]
    return np.clip(out * sheen, 0, 1)


def build_fonts(out):
    return out.parent / "fonts"


def main():
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "content/tracks/hill-country")
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "build/hill-country/textures")
    out.mkdir(parents=True, exist_ok=True)
    source = root / "textures" / "source"
    save(grass(source), out / "grass_base_color.jpg")
    save(kerb(source), out / "kerb_base_color.png")
    streaks().save(root / "textures" / "baked" / "asphalt_streaks.png")
    turf().save(root / "textures" / "baked" / "turf_base_color.jpg", quality=TURF_QUALITY, subsampling=0)
    Image.fromarray(np.clip(np.round(gravel(source) * 255.0), 0, 255).astype(np.uint8)).save(
        root / "textures" / "baked" / "gravel_base_color.jpg", quality=GRAVEL_QUALITY, subsampling=0
    )
    save(brands.boards(build_fonts(out)), out / "boards_base_color.png")
    save(tecpro(), out / "tecpro_base_color.png")
    chainlink().save(out / "chainlink_base_color.png")
    save(distance_boards(), out / "distance_base_color.png")
    save(facade(), out / "facade_base_color.png")
    pit_decals().save(out / "pit_decals_base_color.png")
    palette().save(out / "palette_base_color.png")
    track = json.loads((root / "track.json").read_text())
    fascia(bay_count(track["pitLane"], track["length"])).save(out / "fascia_base_color.png")
    garage_back().save(out / "garage_back_base_color.png")
    pit_facade().save(out / "pit_facade_base_color.png")
    pit_signs().save(out / "pit_signs_base_color.png")
    crew_suit().save(out / "crew_suit_base_color.png")
    for team in TEAMS:
        crew_suit(crew_kit(team)).save(root.parent.parent / "cars" / team["id"] / "crew.jpg", quality=88)
    crew_normal().save(out / "crew_suit_normal.png")
    track_marks().save(out / "track_marks_base_color.png")
    crew_static_atlas().save(out / "crew_static_base_color.png")


if __name__ == "__main__":
    main()
