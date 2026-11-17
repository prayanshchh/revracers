from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

TILE = (4096, 512)
SEAM_SPACING = 1024
DIRT_HEIGHT = 0.22
SEED = 37
FONTS = {
    "anton": "ofl/anton/Anton-Regular.ttf",
    "oswald": "ofl/oswald/Oswald%5Bwght%5D.ttf",
    "playfair": "ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf",
    "montserrat": "ofl/montserrat/Montserrat%5Bwght%5D.ttf",
    "cinzel": "ofl/cinzel/Cinzel%5Bwght%5D.ttf",
    "barlow": "ofl/barlowcondensed/BarlowCondensed-BoldItalic.ttf",
}


def font(directory, name, size, weight=None):
    path = Path(directory) / f"{name}.ttf"
    face = ImageFont.truetype(str(path), size)
    if weight is not None:
        face.set_variation_by_axes([weight])
    return face


def text_at(draw, text, face, fill, centre, tracking=0):
    if tracking == 0:
        box = draw.textbbox((0, 0), text, font=face)
        draw.text((centre[0] - (box[0] + box[2]) / 2, centre[1] - (box[1] + box[3]) / 2), text, font=face, fill=fill)
        return box[2] - box[0]
    widths = [draw.textbbox((0, 0), c, font=face)[2] for c in text]
    total = sum(widths) + tracking * (len(text) - 1)
    box = draw.textbbox((0, 0), text, font=face)
    x = centre[0] - total / 2
    for c, w in zip(text, widths):
        draw.text((x, centre[1] - (box[1] + box[3]) / 2), c, font=face, fill=fill)
        x += w + tracking
    return total


NAME = "REVRACERS"
NAME_GAP = 100


def measure(draw, text, face, tracking=0):
    if tracking == 0:
        box = draw.textbbox((0, 0), text, font=face)
        return box[2] - box[0]
    widths = [draw.textbbox((0, 0), c, font=face)[2] for c in text]
    return sum(widths) + tracking * (len(text) - 1)


def name_after(draw, face, fill, left, height, tracking):
    width = measure(draw, NAME, face, tracking)
    text_at(draw, NAME, face, fill, (left + NAME_GAP + width / 2, height), tracking)


def northwind(draw, fonts):
    draw.ellipse([1040, 150, 1240, 350], outline="#58b4f2", width=30)
    name_after(draw, font(fonts, "montserrat", 200, 800), "#ffffff", 1240, 250, 14)


def voltara(draw, fonts):
    draw.polygon([(1290, 110), (1230, 270), (1290, 270), (1250, 400), (1370, 220), (1310, 220), (1360, 110)], fill="#ffd400")
    name_after(draw, font(fonts, "anton", 300), "#ffd400", 1370, 245, 18)


def aurenne(draw, fonts):
    width = text_at(draw, NAME, font(fonts, "cinzel", 230, 700), "#ffffff", (2048, 245), 20)
    draw.rectangle([2048 - width * 0.45, 390, 2048 + width * 0.45, 400], fill="#9be3d6")


def kestrel(draw, fonts):
    draw.polygon([(1250, 150), (1490, 240), (1340, 240), (1290, 370), (1250, 240), (1130, 210)], fill="#ffffff")
    name_after(draw, font(fonts, "barlow", 340), "#ffffff", 1490, 240, 8)


def marlowe(draw, fonts):
    draw.polygon([(1000, 380), (1140, 130), (1210, 250), (1260, 190), (1380, 380)], fill="#efe6cf")
    name_after(draw, font(fonts, "oswald", 290, 700), "#efe6cf", 1380, 238, 22)


def torqua(draw, fonts):
    for x in (1040, 1150, 1260):
        draw.polygon([(x, 130), (x + 70, 130), (x + 150, 256), (x + 70, 382), (x, 382), (x + 80, 256)], fill="#9be03a")
    name_after(draw, font(fonts, "barlow", 360), "#ffffff", 1410, 236, 12)


def cordave(draw, fonts):
    width = text_at(draw, NAME, font(fonts, "anton", 260), "#ffffff", (2048, 230), 14)
    for top in (400, 432):
        draw.rectangle([2048 - width / 2, top, 2048 + width / 2, top + 14], fill="#e23b3b")


def verdale(draw, fonts):
    draw.ellipse([1020, 130, 1260, 370], fill="#f4f1e4")
    draw.polygon([(1140, 160), (1220, 250), (1140, 340), (1060, 250)], fill="#3d6b2a")
    name_after(draw, font(fonts, "oswald", 300, 600), "#f4f1e4", 1260, 240, 26)


def albaren(draw, fonts):
    draw.ellipse([820, 116, 1100, 396], fill="#ffb347")
    draw.rectangle([760, 290, 1160, 306], fill="#2a8fd6")
    draw.rectangle([760, 330, 1160, 346], fill="#2a8fd6")
    name_after(draw, font(fonts, "montserrat", 220, 800), "#ffffff", 1160, 245, 6)


def nimbara(draw, fonts):
    for row, width in enumerate((260, 200, 140)):
        top = 150 + row * 80
        draw.rounded_rectangle([860, top, 860 + width, top + 52], radius=26, fill="#2f6fe0")
    name_after(draw, font(fonts, "montserrat", 190, 700), "#14213d", 1120, 240, 4)


def maison(draw, fonts):
    width = text_at(draw, NAME, font(fonts, "cinzel", 220, 600), "#f2f2f2", (2048, 245), 22)
    for sign in (-1, 1):
        edge = 2048 + sign * (width / 2 + 90)
        draw.rectangle([min(edge, edge + sign * 420), 252, max(edge, edge + sign * 420), 258], fill="#f2f2f2")


def halden(draw, fonts):
    text_at(draw, NAME, font(fonts, "oswald", 300, 700), "#ffffff", (2048, 238), 16)


BRANDS = [
    ("NORTHWIND", "#0b1d45", "#58b4f2", northwind),
    ("VOLTARA", "#111214", "#ffd400", voltara),
    ("AURENNE", "#0d6b6e", "#9be3d6", aurenne),
    ("KESTREL", "#a80f1a", "#ffffff", kestrel),
    ("MARLOWE", "#22402f", "#c9b98f", marlowe),
    ("TORQUA", "#18191b", "#9be03a", torqua),
    ("CORDAVE", "#34373d", "#e23b3b", cordave),
    ("VERDALE", "#3d6b2a", "#f4f1e4", verdale),
    ("ALBAREN", "#2a8fd6", "#ffb347", albaren),
    ("NIMBARA", "#eef1f5", "#2f6fe0", nimbara),
    ("MAISON", "#111113", "#f2f2f2", maison),
    ("HALDEN", "#de5410", "#ffe2cc", halden),
]
STYLES = {
    "NORTHWIND": "waves",
    "VOLTARA": "chevrons",
    "AURENNE": "guilloche",
    "KESTREL": "slashes",
    "MARLOWE": "contours",
    "TORQUA": "chevrons",
    "CORDAVE": "rails",
    "VERDALE": "dots",
    "ALBAREN": "slashes",
    "NIMBARA": "grid",
    "MAISON": "guilloche",
    "HALDEN": "rails",
}
LOCKUP_CENTRES = (1024, 3072)
LOCKUP_HEIGHT = 290
LOCKUP_WIDTH = 1650
PATTERN_GAIN = 0.07
GLOSS = 0.06
EYELET_SPACING = 256


def weather(panel, rng):
    width, height = TILE
    image = np.asarray(panel, np.float32) / 255.0
    blotch = np.asarray(Image.fromarray(np.uint8(rng.random((height // 16 + 1, width // 16 + 1)) * 255)).resize((width, height), Image.BICUBIC), np.float32) / 255.0
    grain = rng.normal(0, 0.012, (height, width))
    image = image * (0.975 + 0.05 * blotch)[..., None] + grain[..., None]
    ramp = np.clip((np.arange(height) / height - (1 - DIRT_HEIGHT)) / DIRT_HEIGHT, 0, 1)[:, None, None]
    image = image * (1 - 0.3 * ramp) + np.array([0.22, 0.2, 0.17], np.float32) * 0.3 * ramp
    for x in range(0, width, SEAM_SPACING):
        image[:, max(0, x - 2) : x + 2] *= 0.72
    return np.clip(image, 0, 1)


def rgb(colour):
    return np.array([int(colour[i : i + 2], 16) for i in (1, 3, 5)], np.float32) / 255.0


def pattern(style):
    width, height = TILE
    y, x = np.mgrid[0:height, 0:width].astype(np.float32)
    if style == "waves":
        field = np.sin(x / 90 + 2.2 * np.sin(y / 70)) > 0.92
    elif style == "chevrons":
        field = ((np.abs((y - height / 2)) * 0.9 + x) % 180) < 26
    elif style == "guilloche":
        field = np.abs(np.sin(x / 38 + 3 * np.sin(y / 45)) * np.sin(y / 23 + 2 * np.cos(x / 61))) > 0.9
    elif style == "slashes":
        field = ((x + y * 0.7) % 140) < 16
    elif style == "contours":
        field = (np.sin(np.hypot(x % 900 - 450, y - 600) / 22) > 0.93)
    elif style == "rails":
        field = ((y % 64) < 5) & ((x % 1024) > 120)
    elif style == "dots":
        field = np.hypot((x % 64) - 32, (y % 64) - 32) < 7
    else:
        field = ((x % 96) < 3) | ((y % 96) < 3)
    return field.astype(np.float32)


def lockup(art, fonts):
    layer = Image.new("RGBA", TILE, (0, 0, 0, 0))
    art(ImageDraw.Draw(layer), fonts)
    crop = layer.crop(layer.getbbox())
    scale = min(LOCKUP_HEIGHT / crop.height, LOCKUP_WIDTH / crop.width)
    return crop.resize((int(crop.width * scale), int(crop.height * scale)), Image.LANCZOS)


def compose(name, background, accent, art, fonts):
    width, height = TILE
    style = STYLES[name]
    base = rgb(background)
    shade = np.linspace(1.08, 0.9, height, dtype=np.float32)[:, None, None]
    luminance = base @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    ink = np.ones(3, np.float32) if luminance < 0.5 else np.zeros(3, np.float32)
    image = base[None, None, :] * shade
    image = image + (ink - image) * pattern(style)[..., None] * PATTERN_GAIN
    panel = Image.fromarray(np.uint8(np.clip(image, 0, 1) * 255), "RGB")
    mark = lockup(art, fonts)
    for centre in LOCKUP_CENTRES:
        panel.paste(mark, (centre - mark.width // 2, (height - mark.height) // 2 - 18), mark)
    draw = ImageDraw.Draw(panel)
    for centre in LOCKUP_CENTRES:
        divider = centre + 1024
        if divider < width:
            draw.rectangle([divider - 3, 70, divider + 3, height - 70], fill=accent)
    draw.rectangle([0, 0, width, 16], fill=accent)
    draw.rectangle([0, height - 16, width, height], fill=accent)
    draw.rectangle([0, 16, width, 22], fill="#0b0b0c")
    draw.rectangle([0, height - 22, width, height - 16], fill="#0b0b0c")
    for x in range(EYELET_SPACING // 2, width, EYELET_SPACING):
        for y in (34, height - 34):
            draw.ellipse([x - 7, y - 7, x + 7, y + 7], fill="#c8ccd2", outline="#2a2b2e", width=3)
    return panel.filter(ImageFilter.GaussianBlur(0.6))


def gloss(image):
    height = image.shape[0]
    sheen = np.exp(-(((np.arange(height) / height) - 0.28) / 0.12) ** 2)[:, None, None]
    return np.clip(image + sheen * GLOSS, 0, 1)


def boards(fonts):
    rng = np.random.default_rng(SEED)
    width, height = TILE
    atlas = np.empty((height * len(BRANDS), width, 3), np.float32)
    for index, (name, background, accent, art) in enumerate(BRANDS):
        panel = compose(name, background, accent, art, fonts)
        atlas[index * height : (index + 1) * height] = gloss(weather(panel, rng))
    return atlas
