import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from palette import TEAMS, shade
from textures import CREW_ATLAS, atlas_pen

LIGHT_SUIT = 0.55
DEEP = 0.6


def lightness(colour):
    return float(np.dot([int(colour[i : i + 2], 16) / 255 for i in (1, 3, 5)], [0.2126, 0.7152, 0.0722]))


def race_suit(team):
    primary = team["colours"]["primary"]
    secondary = team["colours"]["secondary"]
    brand = team["brand"]
    ink = "#14161a" if lightness(primary) > LIGHT_SUIT else "#f1f2f4"
    deep = shade(primary, DEEP)
    width, height = CREW_ATLAS
    image = Image.new("RGB", CREW_ATLAS, primary)
    draw = ImageDraw.Draw(image)
    _, band, label = atlas_pen(draw)

    def patch(side, x, z, w, h, colour, text, size, text_colour):
        band(side, x - w / 2, x + w / 2, z - h / 2, z + h / 2, colour)
        label(side, x, z, text, size, text_colour)

    sponsors = team["sponsors"]
    for side in (0, 1):
        band(side, -1.0, 1.0, 0.0, 0.14, "#0c0d10")
        for sign in (1, -1):
            band(side, sign * 0.17, sign * 0.235, 0.95, 1.4, secondary)
            band(side, sign * 0.1, sign * 0.125, 0.16, 0.95, secondary)
            band(side, sign * 0.24, sign * 0.62, 1.445, 1.475, secondary)
            band(side, sign * 0.6, sign * 0.69, 1.2, 1.7, "#0c0d10")
            band(side, sign * 0.075, sign * 0.3, 1.43, 1.62, deep)
        band(side, -0.25, 0.25, 0.98, 1.02, deep)
        band(side, -0.1, 0.1, 1.47, 1.56, "#0c0d10")
        band(side, -0.1, 0.1, 1.465, 1.472, brand)
        label(side, 0, 1.0, team["name"].upper(), 14, brand)
    label(0, 0, 1.31, sponsors[0], 30, ink)
    patch(0, 0, 1.13, 0.22, 0.05, brand, sponsors[1], 15, "#0c0d10")
    patch(0, 0.085, 1.395, 0.075, 0.04, brand, team["name"][:3].upper(), 11, "#0c0d10")
    patch(0, -0.085, 1.395, 0.075, 0.04, "#f1f2f4", sponsors[3][:6], 9, "#14161a")
    for sign, name in ((1, sponsors[2]), (-1, sponsors[3])):
        label(0, sign * 0.43, 1.41, name, 12, ink)
        label(1, sign * 0.43, 1.41, name, 12, ink)
        label(0, sign * 0.2, 0.86, sponsors[1], 10, ink)
    label(1, 0, 1.3, team["name"].upper(), 34, ink)
    label(1, 0, 1.15, sponsors[0], 18, ink)
    top = round(height * 0.14)
    draw.rectangle([0, 0, width, top], fill=primary)
    return image


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "build/portraits/suits")
    out.mkdir(parents=True, exist_ok=True)
    for team in TEAMS:
        race_suit(team).save(out / f"{team['id']}.png")
    print(f"{len(TEAMS)} suits -> {out}")


if __name__ == "__main__":
    main()
