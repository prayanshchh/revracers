import json
import sys
from itertools import zip_longest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from brands import BRANDS, font, lockup, rgb, text_at

FONTS = Path("build/hill-country/fonts")
WRAP = (2048, 256)
MARK_HEIGHT = 0.62
MARK_WIDTH = 0.42
EVENT_ROWS = (
    ("#NEONBOULEVARD", "#0a0a0c", "#ffffff", "montserrat", 800),
    ("REVRACERS", "#f4f4f6", "#101014", "anton", None),
    ("NEON BOULEVARD GRAND PRIX", "#2a0f6e", "#ff3db8", "oswald", 700),
    ("REVRACERS 26", "#e10600", "#ffffff", "anton", None),
    ("#HILLCOUNTRYGP", "#0a0a0c", "#ffffff", "montserrat", 800),
    ("HILL COUNTRY GRAND PRIX", "#12296b", "#ffffff", "oswald", 700),
)
BACKDROPS = {
    "NORTHWIND": "#141f5c",
    "VOLTARA": "#ffd21f",
    "AURENNE": "#161d47",
    "KESTREL": "#d0141e",
    "MARLOWE": "#6a1638",
    "TORQUA": "#1673c9",
    "CORDAVE": "#5a1e96",
    "VERDALE": ("#1fb4dc", "#3fbf58"),
    "ALBAREN": "#13a9e6",
    "NIMBARA": "#f2f4f8",
    "MAISON": "#101012",
    "HALDEN": "#e8600f",
}
INKS = {"VOLTARA": "#d2101a", "AURENNE": "#ffffff", "MARLOWE": "#f3e9d2", "VERDALE": "#ffffff"}
DISTANCES = (200, 150, 100, 50)
PANEL_GAP = 6
SEED = 11
FROND = (512, 128)
SCREEN_TILE = (448, 252)
SCREEN_GRID = (4, 4)
SCREEN_GUTTER = 8
SCREEN_DRIVERS = (("corvus", 0), ("velza", 0), ("meridian", 1), ("halden", 0), ("azura", 1))
SCREEN_BRANDS = ("KESTREL", "VOLTARA", "NORTHWIND")
SCREEN_CAPTIONS = ("LIGHTS OUT", "TURN 1", "THE BOULEVARD", "PIT STRAIGHT", "ONBOARD")
PORTRAIT_CROP = (60, 20, 540, 470)


def backdrop(background):
    if isinstance(background, str):
        return Image.new("RGB", WRAP, background)
    width, height = WRAP
    first, last = (rgb(colour) for colour in background)
    ramp = (np.arange(width) % (width // 2)) / (width // 2 - 1)
    row = first[None, :] + (last - first)[None, :] * ramp[:, None]
    return Image.fromarray(np.uint8(np.repeat(row[None], height, 0) * 255), "RGB")


def inked(mark, ink):
    if ink is None:
        return mark
    flat = Image.new("RGBA", mark.size, ink)
    flat.putalpha(mark.getchannel("A"))
    return flat


def mark_tile(art, background, ink, fonts):
    width, height = WRAP
    tile = backdrop(background)
    mark = inked(lockup(art, fonts), ink)
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


def number_tile(fonts):
    width, height = WRAP
    tile = Image.new("RGB", WRAP, "#f4f4f2")
    draw = ImageDraw.Draw(tile)
    typeface = font(fonts, "anton", 190)
    cell = width // len(DISTANCES)
    for index, value in enumerate(DISTANCES):
        draw.rectangle([index * cell + 6, 6, (index + 1) * cell - 7, height - 7], outline="#101012", width=8)
        text_at(draw, str(value), typeface, "#101012", (index * cell + cell // 2, height // 2 - 4))
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
    tiles = [mark_tile(art, BACKDROPS.get(name, background), INKS.get(name), fonts) for name, background, _, art in BRANDS]
    tiles += [word_tile(text, bg, ink, face, weight, fonts) for text, bg, ink, face, weight in EVENT_ROWS]
    tiles.append(number_tile(fonts))
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


def gradient(top, bottom):
    width, height = SCREEN_TILE
    ramp = np.linspace(0, 1, height, dtype=np.float32)[:, None, None]
    slant = np.linspace(-0.12, 0.12, width, dtype=np.float32)[None, :, None]
    blend = np.clip(ramp + slant, 0, 1)
    image = np.array(rgb(top), np.float32) * (1 - blend) + np.array(rgb(bottom), np.float32) * blend
    return Image.fromarray(np.uint8(np.clip(image, 0, 1) * 255), "RGB")


def slashes(tile, ink, start, step, count):
    draw = ImageDraw.Draw(tile, "RGBA")
    width, height = tile.size
    for k in range(count):
        x = start + k * step
        draw.polygon([(x, height), (x + 26, height), (x + 26 + height * 0.45, 0), (x + height * 0.45, 0)], fill=ink)


def driver_card(team, seat, place, cars, fonts):
    width, height = SCREEN_TILE
    colours = team["colours"]
    tile = gradient(colours["deep"], colours["primary"])
    slashes(tile, (*[int(c * 255) for c in rgb(colours["accent"])], 70), -40, 54, 4)
    portrait = Image.open(cars / team["id"] / f"portrait-{seat}.webp").convert("RGBA").crop(PORTRAIT_CROP)
    scale = height * 1.08 / portrait.height
    portrait = portrait.resize((int(portrait.width * scale), int(portrait.height * scale)), Image.LANCZOS)
    tile.paste(portrait, (width - portrait.width + 18, height - portrait.height + 6), portrait)
    draw = ImageDraw.Draw(tile)
    driver = team["drivers"][seat]
    draw.rectangle((0, height - 64, width * 0.56, height), fill=(8, 8, 10))
    draw.rectangle((0, height - 64, 7, height), fill=tuple(int(c * 255) for c in rgb(colours["accent"])))
    text_at(draw, f"P{place}", font(fonts, "anton", 64), "#ffffff", (62, 58))
    text_at(draw, driver["code"], font(fonts, "anton", 84), "#ffffff", (120, 138))
    text_at(draw, driver["last"].upper(), font(fonts, "oswald", 30, 700), "#ffffff", (132, height - 42), 2)
    text_at(draw, team["name"].upper(), font(fonts, "montserrat", 14, 700), "#c9ccd2", (132, height - 16), 3)
    return tile


def footage_card(source, caption, fonts):
    width, height = SCREEN_TILE
    still = Image.open(source).convert("RGB")
    scale = max(width / still.width, height / still.height)
    still = still.resize((int(still.width * scale) + 1, int(still.height * scale) + 1), Image.LANCZOS)
    left, top = (still.width - width) // 2, (still.height - height) // 2
    tile = still.crop((left, top, left + width, top + height))
    draw = ImageDraw.Draw(tile)
    draw.rectangle((0, height - 40, width * 0.5, height - 10), fill=(225, 6, 0))
    text_at(draw, caption, font(fonts, "oswald", 20, 700), "#ffffff", (width * 0.25, height - 25), 2)
    draw.rectangle((width - 96, 12, width - 12, 40), fill=(8, 8, 10))
    text_at(draw, "LIVE", font(fonts, "montserrat", 16, 800), "#ff3b30", (width - 54, 26), 2)
    return tile


def brand_card(name, fonts):
    width, height = SCREEN_TILE
    art = next(art for brand, _, _, art in BRANDS if brand == name)
    tile = Image.new("RGB", SCREEN_TILE, BACKDROPS.get(name, "#101014"))
    mark = lockup(art, fonts)
    scale = min(height * 0.5 / mark.height, width * 0.72 / mark.width)
    mark = mark.resize((int(mark.width * scale), int(mark.height * scale)), Image.LANCZOS)
    tile.paste(mark, ((width - mark.width) // 2, (height - mark.height) // 2), mark)
    return tile


def map_card(track, fonts):
    width, height = SCREEN_TILE
    tile = gradient("#07070b", "#1b0d3a")
    points = np.array([[p["x"], p["z"]] for p in track["centerline"]])
    span = np.ptp(points, 0)
    scale = min(width * 0.52 / span[0], height * 0.8 / span[1])
    centre = (points.min(0) + points.max(0)) / 2
    line = [(width * 0.68 + (x - centre[0]) * scale, height * 0.5 + (z - centre[1]) * scale) for x, z in points]
    glow = Image.new("RGB", SCREEN_TILE, 0)
    ImageDraw.Draw(glow).line(line + line[:1], fill=(255, 40, 170), width=9)
    tile = Image.fromarray(np.uint8(np.clip(np.asarray(tile, np.float32) + np.asarray(glow.filter(ImageFilter.GaussianBlur(7)), np.float32) * 0.8, 0, 255)))
    draw = ImageDraw.Draw(tile)
    draw.line(line + line[:1], fill=(255, 255, 255), width=3)
    x, y = line[0]
    draw.rectangle((x - 5, y - 5, x + 5, y + 5), fill=(225, 6, 0))
    text_at(draw, "NEON", font(fonts, "anton", 44), "#ffffff", (92, 70))
    text_at(draw, "BOULEVARD", font(fonts, "anton", 34), "#ff3db8", (92, 114))
    text_at(draw, f"{track['length'] / 1000:.2f} KM", font(fonts, "oswald", 24, 700), "#ffffff", (92, 168), 2)
    text_at(draw, "17 TURNS", font(fonts, "montserrat", 14, 700), "#c9ccd2", (92, 198), 3)
    return tile


def tower_card(teams, fonts):
    width, height = SCREEN_TILE
    tile = gradient("#0b0b10", "#16161d")
    draw = ImageDraw.Draw(tile)
    draw.rectangle((0, 0, width, 34), fill=(225, 6, 0))
    text_at(draw, "LAP 23 / 50", font(fonts, "oswald", 22, 700), "#ffffff", (width / 2, 17), 3)
    rng = np.random.default_rng(SEED + 3)
    gap = 0.0
    by_id = {team["id"]: team for team in teams}
    field = [(by_id[name], seat) for name, seat in SCREEN_DRIVERS]
    field += [(team, 0) for team in teams if all(team is not other for other, _ in field)]
    for row, (team, seat) in enumerate(field[:7]):
        y = 52 + row * 28
        driver = team["drivers"][seat]
        draw.rectangle((36, y - 11, 42, y + 11), fill=tuple(int(c * 255) for c in rgb(team["colours"]["accent"])))
        text_at(draw, str(row + 1), font(fonts, "oswald", 20, 700), "#ffffff", (20, y))
        text_at(draw, driver["code"], font(fonts, "oswald", 22, 700), "#ffffff", (78, y), 2)
        text_at(draw, team["name"].upper(), font(fonts, "montserrat", 13, 600), "#9da2ab", (210, y), 2)
        text_at(draw, "LEADER" if row == 0 else f"+{gap:.3f}", font(fonts, "oswald", 20, 500), "#ffffff", (width - 70, y))
        gap += float(rng.uniform(0.4, 3.2))
    return tile


def title_card(fonts):
    width, height = SCREEN_TILE
    tile = gradient("#2a0f6e", "#090512")
    slashes(tile, (255, 61, 184, 60), 250, 46, 5)
    draw = ImageDraw.Draw(tile)
    text_at(draw, "REVRACERS 26", font(fonts, "anton", 30), "#ffffff", (width / 2, 58), 3)
    text_at(draw, "NEON BOULEVARD", font(fonts, "anton", 58), "#ffffff", (width / 2, 122))
    text_at(draw, "GRAND PRIX", font(fonts, "oswald", 40, 700), "#ff3db8", (width / 2, 184), 6)
    return tile


def screens(root, fonts):
    cars = root.parents[1] / "cars"
    teams = json.loads((cars / "teams.json").read_text())
    by_id = {team["id"]: team for team in teams}
    track = json.loads((root / "track.json").read_text())
    stills = sorted((root / "source" / "footage").glob("*.jpg"))
    cards = [driver_card(by_id[name], seat, place, cars, fonts) for place, (name, seat) in enumerate(SCREEN_DRIVERS, 1)]
    footage = [footage_card(still, caption, fonts) for still, caption in zip(stills, SCREEN_CAPTIONS)]
    brands = [brand_card(name, fonts) for name in SCREEN_BRANDS]
    extras = [map_card(track, fonts), tower_card(teams, fonts), title_card(fonts)]
    order = [tile for row in zip_longest(cards, footage, brands, extras) for tile in row if tile is not None]
    tiles = [order[index % len(order)] for index in range(SCREEN_GRID[0] * SCREEN_GRID[1])]
    width, height = SCREEN_TILE
    cell = (width + 2 * SCREEN_GUTTER, height + 2 * SCREEN_GUTTER)
    atlas = Image.new("RGB", (cell[0] * SCREEN_GRID[0], cell[1] * SCREEN_GRID[1]), 0)
    for index, tile in enumerate(tiles):
        left = (index % SCREEN_GRID[0]) * cell[0]
        top = (index // SCREEN_GRID[0]) * cell[1]
        padded = tile.resize(cell, Image.NEAREST)
        atlas.paste(padded, (left, top))
        atlas.paste(tile, (left + SCREEN_GUTTER, top + SCREEN_GUTTER))
    return atlas


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "content/tracks/neon-boulevard/textures")
    out.mkdir(parents=True, exist_ok=True)
    atlas, rows, row = wraps(FONTS)
    atlas.save(out / "wraps.webp", quality=88, method=6)
    fence().save(out / "fence.webp", lossless=True)
    screens(out.parent, FONTS).save(out / "screens.webp", quality=84, method=6)
    print(f"wraps {atlas.width}x{atlas.height}, {rows} rows of {row} px")


if __name__ == "__main__":
    main()
