import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from brands import NAME, font, rgb

PANEL = (2048, 256)
GUTTER = 8
ROW = PANEL[1] + 2 * GUTTER
HEIGHT = 8192
STORED = 1024
SEAM = 1024
GAP = 512
FIXING = 128
CAPPING = 8
DIRT = 0.2
SEED = 53
WORD = NAME
TITLE = "Revracers"
LOWER = NAME.lower()
CENTRE = 1024
ROOM = 1760


def blank(colour):
    return Image.new("RGB", PANEL, colour)


def rendered(text, face, fill, height, stretch=1.0, tracking=0, room=None):
    layer = Image.new("RGBA", (PANEL[0] * 2, PANEL[1] * 2), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    x = 40
    for c in text:
        draw.text((x, 40), c, font=face, fill=fill)
        x += draw.textbbox((0, 0), c, font=face)[2] + tracking
    crop = layer.crop(layer.getbbox())
    scale = height / crop.height
    width = crop.width * scale * stretch
    if room is not None and width > room:
        scale *= room / width
        width = room
    return crop.resize((max(1, int(width)), max(1, int(crop.height * scale))), Image.LANCZOS)


def word(image, text, face, fill, centre, height, stretch=1.0, tracking=0, room=None):
    crop = rendered(text, face, fill, height, stretch, tracking, room)
    image.paste(crop, (int(centre[0] - crop.width / 2), int(centre[1] - crop.height / 2)), crop)
    return crop.width


def star(draw, centre, outer, inner, points, fill, turn=-np.pi / 2):
    corners = []
    for k in range(points * 2):
        radius = outer if k % 2 == 0 else inner
        angle = turn + k * np.pi / points
        corners.append((centre[0] + radius * np.cos(angle), centre[1] + radius * np.sin(angle)))
    draw.polygon(corners, fill=fill)


def rose(draw, centre, size, ink, ground):
    x, y = centre
    draw.ellipse([x - size * 0.62, y - size * 0.62, x + size * 0.62, y + size * 0.62], outline=ink, width=max(2, int(size * 0.06)))
    star(draw, centre, size, size * 0.2, 8, ink)
    star(draw, centre, size * 0.58, size * 0.16, 8, ink, -np.pi / 2 + np.pi / 8)
    draw.ellipse([x - size * 0.4, y - size * 0.4, x + size * 0.4, y + size * 0.4], fill=ground, outline=ink, width=max(2, int(size * 0.05)))
    draw.ellipse([x - size * 0.3, y - size * 0.3, x + size * 0.3, y + size * 0.3], outline=ink, width=max(1, int(size * 0.03)))


def paste(image, crop, left, y):
    image.paste(crop, (int(left), int(y - crop.height / 2)), crop)
    return left + crop.width


def harbour_lockup(image, fonts, centre, height, ink, ground):
    draw = ImageDraw.Draw(image)
    x, y = centre
    text = rendered(WORD, font(fonts, "cinzel", 200, 700), ink, height * 0.5, 1.0, 6, height * 6)
    radius = height * 0.42
    gap = height * 0.22
    left = x - (2 * radius + gap + text.width) / 2
    rose(draw, (left + radius, y), radius * 1.45, ink, ground)
    start = left + 2 * radius + gap
    paste(image, text, start, y - height * 0.1)
    for k in range(9):
        dot = start + (k + 0.5) * text.width / 9
        draw.rectangle([dot - height * 0.045, y + height * 0.3, dot + height * 0.045, y + height * 0.35], fill=ink)


def harbour(fonts):
    image = blank("#1e2852")
    harbour_lockup(image, fonts, (CENTRE, 128), 236, "#f2f3f6", "#1e2852")
    return image


def harbour_gantry(fonts):
    image = blank("#161a2b")
    harbour_lockup(image, fonts, (CENTRE, 128), 236, "#a9d8c8", "#161a2b")
    return image


def shield(draw, centre, size):
    x, y = centre
    w, h = size * 0.8, size
    draw.rectangle([x - w / 2, y - h / 2, x + w / 2, y + h / 2], fill="#f4f4f4")
    draw.rectangle([x - w / 2 + 4, y - h / 2 + 4, x + w / 2 - 4, y], fill="#d8102a")
    draw.rectangle([x - w / 2 + 4, y, x + w / 2 - 4, y + h / 2 - 4], fill="#0b7a3e")
    draw.rectangle([x - w * 0.3, y - h * 0.08, x + w * 0.3, y + h * 0.08], fill="#f4f4f4")


def chrono(fonts):
    image = blank("#0c0c0e")
    draw = ImageDraw.Draw(image)
    for x in (CENTRE,):
        text = rendered(WORD, font(fonts, "montserrat", 200, 600), "#f2f2f2", 140, 1.0, 6, ROOM)
        size = 176
        gap = 70
        left = x - (text.width + 2 * (size * 0.8 + gap)) / 2
        shield(draw, (left + size * 0.4, 128), size)
        end = paste(image, text, left + size * 0.8 + gap, 128)
        shield(draw, (end + gap + size * 0.4, 128), size)
    return image


def event(fonts):
    image = blank("#0b0b0d")
    draw = ImageDraw.Draw(image)
    word(image, WORD, font(fonts, "montserrat", 200, 300), "#f4f4f4", (330, 128), 62, 1.0, 10, 560)
    word(image, TITLE, font(fonts, "greatvibes", 260), "#e1c15a", (1010, 134), 146, 1.0, 0, 560)
    draw.polygon([(1490, 168), (1700, 168), (1780, 88), (1570, 88)], fill="#e10600")
    draw.polygon([(1724, 168), (1782, 168), (1862, 88), (1804, 88)], fill="#e10600")
    return image


def pasta(fonts):
    image = blank("#3c4aa8")
    draw = ImageDraw.Draw(image)
    for x in (512, 1536):
        draw.ellipse([x - 400, 28, x + 400, 228], fill="#f1e6d0")
        draw.ellipse([x - 388, 38, x + 388, 218], fill="#d1202c")
        word(image, TITLE, font(fonts, "pacifico", 220), "#fbf4e6", (x, 122), 112, 1.0, 0, 600)
    return image


def pasta_deep(fonts):
    image = blank("#3264aa")
    draw = ImageDraw.Draw(image)
    for x in (341, 1024, 1707):
        draw.ellipse([x - 290, 34, x + 290, 236], fill="#f1e6d0")
        draw.ellipse([x - 280, 42, x + 280, 228], fill="#d1202c")
        word(image, TITLE, font(fonts, "pacifico", 220), "#fbf4e6", (x, 132), 104, 1.0, 0, 430)
    return image


def arrow_mark(draw, centre, size, ink):
    x, y = centre
    draw.polygon([(x, y - size), (x + size * 0.42, y + size * 0.55), (x, y + size * 0.25), (x - size * 0.42, y + size * 0.55)], fill=ink)


def archer(fonts):
    image = blank("#24377a")
    draw = ImageDraw.Draw(image)
    for x in (CENTRE,):
        text = rendered(WORD, font(fonts, "montserrat", 200, 600), "#f4f4f6", 118, 1.15, 40, ROOM - 300)
        left = x - text.width / 2
        arrow_mark(draw, (left - 130, 128), 100, "#f4f4f6")
        end = paste(image, text, left, 128)
        arrow_mark(draw, (end + 130, 128), 100, "#f4f4f6")
    return image


def lager(fonts):
    image = blank("#1f6a35")
    draw = ImageDraw.Draw(image)
    for x in (CENTRE,):
        text = rendered(TITLE, font(fonts, "oswald", 220, 600), "#ffffff", 172, 0.95, 4, ROOM - 360)
        left = x - (text.width + 340) / 2
        end = paste(image, text, left, 124)
        star(draw, (end + 96, 104), 66, 27, 5, "#e2141c")
        draw.ellipse([end + 190, 50, end + 340, 200], fill="#ffffff")
        draw.ellipse([end + 205, 65, end + 325, 185], fill="#1c5fb0")
    return image


def lottery(fonts):
    image = blank("#1f8f9e")
    word(image, LOWER, font(fonts, "nunito", 240, 900), "#f4f8fa", (CENTRE, 122), 176, 1.0, 4, ROOM)
    return image


def plate(image, left, label, fonts, matrix=True):
    draw = ImageDraw.Draw(image)
    width = 512
    draw.rectangle([left + 6, 10, left + width - 6, 246], fill="#0c0c0e", outline="#26272b", width=4)
    if label:
        word(image, label, font(fonts, "montserrat", 220, 700), "#f2f2f2", (left + 120, 128), 150, 1.0, 2, 180)
    if matrix:
        for x in range(left + 250, left + width - 30, 24):
            for y in range(52, 210, 24):
                draw.ellipse([x - 6, y - 6, x + 6, y + 6], fill="#1d1e22")


def pylon_cells(labels, fonts, crest=False):
    image = blank("#0a0a0c")
    for cell, label in enumerate(labels):
        left = cell * 512
        if crest and cell == 0:
            draw = ImageDraw.Draw(image)
            draw.rectangle([left + 6, 10, left + 506, 246], fill="#101012")
            shield(draw, (left + 70, 128), 104)
            word(image, WORD, font(fonts, "montserrat", 200, 600), "#f2f2f2", (left + 315, 128), 58, 1.0, 2, 300)
            continue
        plate(image, left, label, fonts)
    return image


def pylon_a(fonts):
    return pylon_cells(["", "LAP", "1", "2"], fonts, crest=True)


def pylon_b(fonts):
    return pylon_cells(["3", "4", "5", "6"], fonts)


def pylon_c(fonts):
    return pylon_cells(["7", "8", "9", "10"], fonts)


def lottery_sign(fonts):
    image = blank("#1f8f9e")
    word(image, LOWER, font(fonts, "nunito", 240, 900), "#f4f8fa", (CENTRE, 122), 170, 1.0, 4, 1150)
    return image


def stream(fonts):
    image = blank("#1158d6")
    draw = ImageDraw.Draw(image)
    word(image, TITLE + "+", font(fonts, "pacifico", 220), "#ffffff", (512, 142), 108, 1.0, 0, 720)
    for k in range(9):
        angle = np.pi * (0.15 + 0.7 * k / 8)
        star(draw, (512 - 250 * np.cos(angle), 120 - 70 * np.sin(angle)), 10, 4, 5, "#ffffff")
    draw.rectangle([1024, 0, 2048, 256], fill="#b51721")
    draw.rectangle([1024, 0, 1032, 256], fill="#2a2b30")
    word(image, WORD, font(fonts, "anton", 220), "#6d0a10", (1536, 128), 126, 1.05, 6, 760)
    return image


def energy(fonts):
    width, height = PANEL
    ramp = np.linspace(0, 1, width, dtype=np.float32)[None, :, None]
    ramp = 0.5 - 0.5 * np.cos(ramp * 2 * np.pi)
    green, blue = rgb("#14a84a"), rgb("#0e7ec2")
    field = green * (1 - ramp) + blue * ramp
    image = Image.fromarray(np.uint8(np.broadcast_to(field, (height, width, 3)) * 255), "RGB")
    word(image, LOWER, font(fonts, "nunito", 240, 800), "#ffffff", (CENTRE, 126), 168, 1.05, 4, ROOM)
    return image


def smile(draw, centre, width, ink):
    x, y = centre
    draw.arc([x - width / 2, y - 70, x + width / 2, y + 16], 25, 155, fill=ink, width=16)
    tip = (x + width * 0.45, y - 10)
    draw.polygon([(tip[0] - 26, tip[1] - 22), (tip[0] + 28, tip[1] - 6), (tip[0] - 6, tip[1] + 32)], fill=ink)


def cloud(fonts):
    image = blank("#232f3e")
    draw = ImageDraw.Draw(image)
    width = word(image, LOWER, font(fonts, "montserrat", 220, 700), "#ffffff", (CENTRE, 100), 128, 1.0, 4, ROOM - 200)
    smile(draw, (CENTRE, 214), width * 0.9, "#ff9900")
    return image


def hexagon(draw, centre, size, ink, ground):
    x, y = centre
    corners = [(x + size * np.cos(a), y + size * np.sin(a)) for a in np.linspace(-np.pi / 2, 3 * np.pi / 2, 7)[:-1]]
    draw.polygon(corners, fill=ink)
    inner = [(x + size * 0.8 * np.cos(a), y + size * 0.8 * np.sin(a)) for a in np.linspace(-np.pi / 2, 3 * np.pi / 2, 7)[:-1]]
    draw.polygon(inner, fill=ground)
    draw.polygon([(x - size * 0.42, y - size * 0.28), (x + size * 0.42, y - size * 0.28), (x + size * 0.22, y + size * 0.42), (x - size * 0.22, y + size * 0.42)], fill=ink)
    draw.polygon([(x - size * 0.18, y - size * 0.08), (x + size * 0.18, y - size * 0.08), (x, y + size * 0.22)], fill=ground)


def hex_(fonts):
    image = blank("#172f7a")
    draw = ImageDraw.Draw(image)
    for x in (CENTRE,):
        text = rendered(LOWER, font(fonts, "montserrat", 220, 600), "#ffffff", 142, 1.0, 2, ROOM - 300)
        left = x - (text.width + 290) / 2
        hexagon(draw, (left + 106, 128), 106, "#ffffff", "#172f7a")
        paste(image, text, left + 290, 122)
    return image


def scarlet(fonts):
    image = blank("#cf3552")
    word(image, TITLE, font(fonts, "montserrat", 220, 500), "#ffffff", (CENTRE, 124), 176, 1.0, -2, ROOM)
    return image


def tyre(fonts):
    image = blank("#fdd20a")
    draw = ImageDraw.Draw(image)
    for x in (CENTRE,):
        text = rendered(WORD, font(fonts, "barlow", 260), "#d4111b", 150, 1.45, 4, ROOM)
        left = x - text.width / 2
        paste(image, text, left, 152)
        draw.polygon([(left + 30, 80), (left + 84, 80), (left + 120, 30), (left + 66, 30)], fill="#d4111b")
        draw.rectangle([left + 66, 30, left + text.width * 0.55, 52], fill="#d4111b")
    return image


def card(fonts):
    image = blank("#0a6fcf")
    word(image, WORD, font(fonts, "archivo", 220), "#ffffff", (CENTRE, 128), 128, 1.1, 14, ROOM)
    return image


def airline(fonts):
    image = blank("#7a1a48")
    draw = ImageDraw.Draw(image)
    width = word(image, WORD, font(fonts, "playfair", 220, 600), "#f6eef2", (CENTRE, 118), 138, 1.0, 30, ROOM)
    draw.rectangle([CENTRE - width / 2, 204, CENTRE + width / 2, 210], fill="#b98aa1")
    return image


def flame(draw, centre, size, ink, ground):
    x, y = centre
    draw.ellipse([x - size, y - size * 0.25, x + size, y + size * 0.9], fill=ink)
    draw.ellipse([x - size * 0.8, y - size * 0.05, x + size * 0.8, y + size * 0.82], fill=ground)
    draw.polygon([(x - size * 0.1, y - size * 1.1), (x + size * 0.28, y - size * 0.4), (x + size * 0.1, y + size * 0.45), (x - size * 0.3, y - size * 0.25)], fill=ink)


def bank(fonts):
    image = blank("#e60000")
    draw = ImageDraw.Draw(image)
    for x in (CENTRE,):
        text = rendered(TITLE, font(fonts, "montserrat", 220, 500), "#ffffff", 164, 1.0, -2, ROOM - 240)
        left = x - (text.width + 230) / 2
        flame(draw, (left + 82, 120), 80, "#ffffff", "#e60000")
        paste(image, text, left + 230, 126)
    return image


def monogram(fonts):
    image = blank("#2c2a29")
    draw = ImageDraw.Draw(image)
    for x in range(64, 2048, 128):
        for y in (40, 216):
            star(draw, (x, y), 16, 7, 4, "#3a3735")
    word(image, WORD, font(fonts, "cinzel", 220, 500), "#a7a29c", (CENTRE, 128), 132, 1.0, 44, ROOM)
    return image


def concrete(fonts):
    rng = np.random.default_rng(SEED + 1)
    width, height = PANEL
    base = np.full((height, width, 3), rgb("#a4a19b"), np.float32)
    for k in range(0, width, SEAM):
        base[:, k : k + SEAM] *= 0.93 + 0.1 * rng.random()
    cloud = np.asarray(Image.fromarray(np.uint8(rng.random((height // 32 + 1, width // 32 + 1)) * 255)).resize((width, height), Image.BICUBIC), np.float32) / 255.0
    base *= (0.92 + 0.12 * cloud)[..., None]
    runs = np.asarray(Image.fromarray(np.uint8(rng.random((2, width // 6)) * 255)).resize((width, height), Image.BICUBIC), np.float32) / 255.0
    base *= (1 - 0.1 * np.clip(runs - 0.55, 0, 1) * np.linspace(0.3, 1, height)[:, None])[..., None]
    speck = rng.normal(0, 0.03, (height, width))[..., None]
    pores = (rng.random((height, width)) > 0.994)[..., None] * -0.3
    image = np.clip(base * (1 + speck + pores), 0, 1)
    panel = Image.fromarray(np.uint8(image * 255), "RGB")
    draw = ImageDraw.Draw(panel, "RGBA")
    for k in range(0, width + 1, SEAM):
        draw.rectangle([k - 4, 0, k + 3, height], fill=(52, 50, 47, 230))
        for y in range(0, height, 9):
            chip = int(rng.integers(0, 4))
            draw.rectangle([k - 4 - chip, y, k + 3 + chip, y + 5], fill=(70, 67, 63, 120))
    for k in range(SEAM // 4, width, SEAM // 2):
        for y in (70, 186):
            draw.ellipse([k - 5, y - 5, k + 5, y + 5], fill=(60, 58, 55, 200))
    scuffs(panel, rng, 6)
    return panel


def scuffs(panel, rng, count):
    width, height = panel.size
    layer = Image.new("RGBA", panel.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for _ in range(count):
        x = float(rng.uniform(0, width))
        y = float(rng.uniform(height * 0.5, height * 0.92))
        run = float(rng.uniform(140, 520))
        tilt = float(rng.uniform(-0.08, 0.03))
        for _ in range(int(rng.integers(2, 5))):
            off = float(rng.uniform(-8, 8))
            draw.line([(x, y + off), (x + run, y + off + run * tilt)], fill=(14, 13, 12, int(rng.integers(20, 60))), width=int(rng.integers(3, 9)))
    for _ in range(count * 3):
        x = float(rng.uniform(0, width))
        y = float(rng.uniform(height * 0.2, height * 0.95))
        draw.line([(x, y), (x + float(rng.uniform(20, 90)), y + float(rng.uniform(-6, 6)))], fill=(235, 232, 226, 70), width=1)
    panel.paste(layer.filter(ImageFilter.GaussianBlur(1.6)), (0, 0), layer.filter(ImageFilter.GaussianBlur(1.6)))


def led(text, size, fonts):
    layer = Image.new("L", (512, 128), 0)
    draw = ImageDraw.Draw(layer)
    face = font(fonts, "montserrat", size, 700)
    box = draw.textbbox((0, 0), text, font=face)
    draw.text(((512 - box[2] - box[0]) / 2, (128 - box[3] - box[1]) / 2), text, font=face, fill=255)
    lit = np.asarray(layer, np.float32) / 255.0
    y, x = np.mgrid[0:128, 0:512].astype(np.float32)
    dots = (np.hypot((x % 8) - 4, (y % 8) - 4) < 3.0).astype(np.float32)
    return np.clip(lit * 1.6, 0, 1) * dots


def timing(fonts):
    image = np.zeros((256, 2048, 3), np.float32) + rgb("#0b0b0d")
    amber = rgb("#ffb21a")
    for cell, (top, bottom) in enumerate((("LAP", "01/56"), ("TIME", "1:34.0"))):
        for row, (text, size) in enumerate(((top, 72), (bottom, 96))):
            glow = led(text, size, fonts)
            image[row * 128 : row * 128 + 128, cell * 512 : cell * 512 + 512] += glow[..., None] * amber
    for cell, colour in ((2, "#ff2a1a"), (3, "#2aff6a")):
        y, x = np.mgrid[0:256, 0:512].astype(np.float32)
        r = np.hypot((x - 256) / 2, y - 128)
        image[:, cell * 512 : cell * 512 + 512] += (np.clip(1.15 - r / 100, 0, 1) ** 1.5)[..., None] * rgb(colour)
        image[:, cell * 512 : cell * 512 + 512] *= (r < 112)[..., None] * 1.0 + (r >= 112)[..., None] * 0.35
        image[:, cell * 512 : cell * 512 + 512] += ((r > 112) & (r < 120))[..., None] * 0.12
    return Image.fromarray(np.uint8(np.clip(image, 0, 1) * 255), "RGB")


def cells(ground, ink, labels, fonts, border):
    image = blank(ground)
    draw = ImageDraw.Draw(image)
    width = PANEL[0] // len(labels)
    for k, label in enumerate(labels):
        left = k * width
        draw.rectangle([left + 6, 6, left + width - 6, 250], outline=border, width=6)
        lines = label.split("\n")
        for row, text in enumerate(lines):
            y = 128 + (row - (len(lines) - 1) / 2) * 104
            word(image, text, font(fonts, "montserrat", 220, 800), ink, (left + width / 2, y), 178 if len(lines) == 1 else 92, 0.86 if len(lines) == 1 else 1.0, 6, width - 40)
    return image


def distance_white(fonts):
    return cells("#f6f6f4", "#121214", ["200", "150", "100", "50"], fonts, "#121214")


def distance_navy(fonts):
    return cells("#1a3d8f", "#ffffff", ["200", "150", "100", "50"], fonts, "#ffffff")


def markers(fonts):
    return cells("#f6f6f4", "#121214", ["SM", "OT", "S\nM", "O\nT"], fonts, "#f6f6f4")


def lights(fonts):
    width, height = PANEL
    image = np.zeros((height, width, 3), np.float32) + rgb("#0a0b0d")
    y, x = np.mgrid[0:height, 0:width].astype(np.float32)
    cell = width / 8
    local = x % cell
    inside = (local > 18) & (local < cell - 18) & (y > 18) & (y < height - 18)
    dots = (np.hypot((local % 14) - 7, (y % 14) - 7) < 3.6) & inside
    bezel = ~((local > 10) & (local < cell - 10) & (y > 10) & (y < height - 10))
    lit = (x >= cell) & (x < 2 * cell)
    image += dots[..., None] * np.where(lit[..., None], rgb("#ffcc22"), rgb("#1b1d21"))
    image = np.where(bezel[..., None], rgb("#3a3c40"), image)
    return Image.fromarray(np.uint8(np.clip(image, 0, 1) * 255), "RGB")


def impact(fonts):
    image = blank("#f2b200")
    draw = ImageDraw.Draw(image)
    for k in range(5):
        top = k * 52 + 4
        draw.rectangle([0, top, 2048, top + 40], fill="#f5b60c" if k % 2 == 0 else "#e98a0a")
        draw.rectangle([0, top + 40, 2048, top + 52], fill="#3a2a12")
    for x in range(0, 2048, 512):
        draw.rectangle([x, 0, x + 6, 256], fill="#3a2a12")
    return image


DESIGNS = (
    ("harbour", harbour),
    ("harbour gantry", harbour_gantry),
    ("chrono", chrono),
    ("event", event),
    ("pasta", pasta),
    ("archer", archer),
    ("lager", lager),
    ("lottery", lottery),
    ("stream", stream),
    ("energy", energy),
    ("cloud", cloud),
    ("hex", hex_),
    ("scarlet", scarlet),
    ("tyre", tyre),
    ("card", card),
    ("airline", airline),
    ("bank", bank),
    ("monogram", monogram),
    ("concrete", concrete),
    ("distance", distance_white),
    ("distance navy", distance_navy),
    ("markers", markers),
    ("impact", impact),
    ("timing", timing),
    ("lottery sign", lottery_sign),
    ("pylon a", pylon_a),
    ("pylon b", pylon_b),
    ("pylon c", pylon_c),
    ("pasta deep", pasta_deep),
    ("lights", lights),
)
PRINTED = {"concrete", "distance", "distance navy", "markers", "impact", "timing", "lights", "pylon a", "pylon b", "pylon c"}


def fixings(image, rng):
    width, height = PANEL
    panel = Image.fromarray(np.uint8(np.clip(image, 0, 1) * 255), "RGB")
    draw = ImageDraw.Draw(panel, "RGBA")
    draw.rectangle([0, 0, width, CAPPING], fill=(158, 163, 168, 255))
    draw.rectangle([0, CAPPING, width, CAPPING + 3], fill=(20, 20, 22, 150))
    for x in range(0, width + 1, GAP):
        draw.rectangle([x - 3, 0, x + 2, height], fill=(10, 10, 12, 210))
        draw.rectangle([x + 3, 0, x + 4, height], fill=(255, 255, 255, 40))
    for x in range(FIXING // 2, width, FIXING):
        for y in (CAPPING + 14, height - 16):
            draw.ellipse([x - 5, y - 5, x + 5, y + 5], fill=(186, 188, 192, 255), outline=(40, 40, 44, 255), width=2)
            draw.line([(x - 3, y), (x + 3, y)], fill=(60, 60, 64, 255), width=1)
    scuffs(panel, rng, 3)
    draw = ImageDraw.Draw(panel, "RGBA")
    for _ in range(260):
        x = float(rng.uniform(0, width))
        y = float(rng.uniform(height * 0.7, height))
        r = float(rng.uniform(1, 4))
        draw.ellipse([x - r, y - r, x + r, y + r], fill=(96, 82, 64, int(rng.integers(60, 150))))
    return np.asarray(panel, np.float32) / 255.0


def finish(panel, rng, printed):
    width, height = PANEL
    image = np.asarray(panel.filter(ImageFilter.GaussianBlur(0.5)), np.float32) / 255.0
    blotch = np.asarray(Image.fromarray(np.uint8(rng.random((height // 16 + 1, width // 16 + 1)) * 255)).resize((width, height), Image.BICUBIC), np.float32) / 255.0
    grain = rng.normal(0, 0.01, (height, width))
    image = image * (0.975 + 0.05 * blotch)[..., None] + grain[..., None]
    ramp = np.clip((np.arange(height) / height - (1 - DIRT)) / DIRT, 0, 1)[:, None, None]
    image = image * (1 - 0.28 * ramp) + np.array([0.24, 0.21, 0.17], np.float32) * 0.28 * ramp
    if printed:
        return np.clip(image, 0, 1)
    sheen = np.exp(-(((np.arange(height) / height) - 0.25) / 0.12) ** 2)[:, None, None]
    return fixings(np.clip(image + sheen * 0.04, 0, 1), rng)


def atlas(fonts):
    rng = np.random.default_rng(SEED)
    width, height = PANEL
    sheet = np.zeros((HEIGHT, width, 3), np.float32)
    for index, (name, art) in enumerate(DESIGNS):
        image = finish(art(fonts), rng, name in PRINTED)
        top = index * ROW
        sheet[top : top + GUTTER] = image[:1]
        sheet[top + GUTTER : top + GUTTER + height] = image
        sheet[top + GUTTER + height : top + ROW] = image[-1:]
    return Image.fromarray(np.uint8(sheet * 255), "RGB").resize((STORED, HEIGHT), Image.LANCZOS)


def main():
    fonts = Path(sys.argv[1])
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    atlas(fonts).save(out / "boards.webp", quality=90, method=6)
    layout = {"rows": [name for name, _ in DESIGNS], "row": ROW, "gutter": GUTTER, "panel": list(PANEL), "height": HEIGHT}
    text = re.sub(r"\[\s+(\d+),\s+(\d+)\s+\]", r"[\1, \2]", json.dumps(layout, indent=2))
    (out / "boards.json").write_text(text + "\n")


if __name__ == "__main__":
    main()
