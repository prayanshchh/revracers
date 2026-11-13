import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from design import teams

FONT = Path("apps/client/node_modules/@fontsource-variable/saira/files/saira-latin-wght-normal.woff2")
FACE = (2048, 1386)
FACE_WIDTH = 0.17
FACE_HEIGHT = 0.115
GLOVE = (640, 820)
GLOVE_CUFF = 600
FINGER_SEAMS = (127, 201, 275)
FINGER_ROWS = (90, 164, 238, 311)
PAD = (26, 27, 31)
PAD_RIB = (44, 46, 52)
EMBER = (168, 40, 26)
EMBER_DEEP = (120, 24, 12)
INK = (14, 15, 18)
BUTTONS = [
    (0.086, 0.058, "N", (226, 226, 200), (40, 170, 70)),
    (0.100, 0.026, "OV", (46, 150, 190), (60, 200, 90)),
    (0.090, -0.006, "", (232, 216, 180), (232, 216, 180)),
    (0.092, -0.040, "+10", (240, 150, 70), (240, 150, 70)),
    (0.074, -0.074, "RCH", (170, 120, 210), (235, 235, 235)),
    (-0.086, 0.058, "PIT", (230, 196, 60), (50, 120, 210)),
    (-0.100, 0.026, "R", (200, 40, 40), (200, 40, 40)),
    (-0.090, -0.006, "OK", (235, 230, 215), (235, 230, 215)),
    (-0.092, -0.040, "+1", (70, 190, 90), (240, 140, 60)),
    (-0.074, -0.074, "BO", (210, 90, 170), (210, 90, 170)),
]
ROTARIES = [(0.050, -0.066, 0.0165, "SOC"), (-0.050, -0.066, 0.0165, "TORQUE")]
DIAL = (0.0, -0.075, 0.0235)
DIAL_COLOURS = [
    ((60, 130, 220), "SLIP"),
    ((230, 225, 215), "SHIFT"),
    ((226, 190, 60), "FAIL A"),
    ((240, 150, 60), "TYRE"),
    ((240, 110, 60), "FAIL B"),
    ((70, 190, 110), "FUEL"),
    ((90, 200, 180), "TORQ"),
    ((200, 60, 60), "LAP"),
]


def rgb(colour, gain=1.0):
    return tuple(min(255, int(int(colour[i : i + 2], 16) * gain)) for i in (1, 3, 5))


def font(size, weight=700):
    face = ImageFont.truetype(str(FONT), size)
    face.set_variation_by_axes([weight])
    return face


def to_px(y, z):
    return ((FACE_WIDTH - y) / (2 * FACE_WIDTH) * FACE[0], (FACE_HEIGHT - z) / (2 * FACE_HEIGHT) * FACE[1])


def circle(draw, y, z, radius, **options):
    x, v = to_px(y, z)
    r = radius / (2 * FACE_WIDTH) * FACE[0]
    draw.ellipse((x - r, v - r, x + r, v + r), **options)


def centred(draw, x, y, text, face, fill):
    box = draw.textbbox((0, 0), text, font=face)
    draw.text((x - (box[0] + box[2]) / 2, y - (box[1] + box[3]) / 2), text, font=face, fill=fill)


def wheel_face(out, team):
    image = Image.new("RGB", FACE, (6, 6, 7))
    draw = ImageDraw.Draw(image)
    small = font(24, 700)
    label = font(30, 800)
    for y, z, text, cap, ring in BUTTONS:
        circle(draw, y, z, 0.0086, fill=tuple(int(c * 0.72) for c in cap))
        if text:
            x, v = to_px(y, z)
            centred(draw, x, v, text, label if len(text) < 3 else small, INK if sum(cap) > 300 else (240, 240, 240))
        x, v = to_px(y, z)
        r = 0.0122 / (2 * FACE_WIDTH) * FACE[0]
        draw.arc((x - r, v - r, x + r, v + r), 0, 360, fill=ring, width=7)
    number = font(26, 700)
    for y, z, radius, text in ROTARIES:
        x, v = to_px(y, z)
        r = (radius + 0.0055) / (2 * FACE_WIDTH) * FACE[0]
        for k in range(12):
            angle = np.radians(120 + k * (300 / 11))
            centred(draw, x + r * np.cos(angle), v + r * np.sin(angle), str(k + 1), number, (222, 222, 222))
        centred(draw, x, v + r + 30, text, small, (222, 222, 222))
    y, z, radius = DIAL
    x, v = to_px(y, z)
    outer = (radius + 0.0065) / (2 * FACE_WIDTH) * FACE[0]
    inner = radius * 0.72 / (2 * FACE_WIDTH) * FACE[0]
    count = len(DIAL_COLOURS)
    for k, (colour, _) in enumerate(DIAL_COLOURS):
        start = 180 + k * 180 / count - 90
        draw.pieslice((x - outer, v - outer, x + outer, v + outer), start, start + 180 / count - 1, fill=colour)
    draw.ellipse((x - inner, v - inner, x + inner, v + inner), fill=(6, 6, 7))
    tiny = font(20, 800)
    for k, (colour, text) in enumerate(DIAL_COLOURS):
        angle = np.radians(180 + (k + 0.5) * 180 / count - 90)
        centred(draw, x + (outer + inner) / 2 * np.cos(angle), v + (outer + inner) / 2 * np.sin(angle), text, tiny, INK)
    for y, z, _text, _cap, _ring in BUTTONS:
        x, v = to_px(y, z)
        r = 0.0162 / (2 * FACE_WIDTH) * FACE[0]
        draw.arc((x - r, v - r, x + r, v + r), 55, 125, fill=(62, 62, 66), width=5)
    screw = (72, 72, 76)
    for y, z in ((0.124, 0.040), (0.124, 0.012), (0.128, -0.040), (0.112, -0.078), (-0.124, 0.040), (-0.124, 0.012), (-0.128, -0.040), (-0.112, -0.078), (0.060, 0.088), (-0.060, 0.088), (0.030, -0.100), (-0.030, -0.100), (0.0725, -0.022), (-0.0725, -0.022)):
        circle(draw, y, z, 0.0030, fill=screw)
        circle(draw, y, z, 0.0013, fill=(20, 20, 22))
    dot = (208, 208, 212)
    for y, z in ((0.112, 0.056), (0.112, 0.048), (0.112, 0.040), (-0.112, 0.056), (-0.112, 0.048), (-0.112, 0.040), (0.0735, 0.040), (0.0735, 0.032), (-0.0735, 0.040), (-0.0735, 0.032)):
        circle(draw, y, z, 0.0018, fill=dot)
    centred(draw, *to_px(0.0, 0.094), team["name"].upper(), font(40, 900), (230, 230, 232))
    image.save(out / "wheel-face.jpg", quality=92, subsampling=0)


def shade(colour, gain):
    return tuple(min(255, int(channel * gain)) for channel in colour)


def glove(out, team):
    width, height = GLOVE
    cloth = rgb(team["colours"]["primary"], 1.5)
    if sum(cloth) < 120:
        cloth = (46, 48, 54)
    accent = rgb(team["colours"]["accent"])
    seam = shade(cloth, 0.42)
    image = Image.new("RGB", GLOVE, cloth)
    draw = ImageDraw.Draw(image)
    for y in range(0, FINGER_ROWS[-1] + 60, 3):
        fold = 0.94 + 0.06 * np.cos(y * 0.21)
        draw.line((0, y, width, y), fill=shade(cloth, fold), width=3)
    for edge, toward in ((0, 1), (width, -1)):
        def px(u, v, edge=edge, toward=toward):
            return (edge + toward * u, v)
        draw.polygon([px(0, 0), px(34, 0), px(40, 330), px(52, GLOVE_CUFF), px(0, GLOVE_CUFF)], fill=INK)
        draw.line([px(34, 0), px(40, 330), px(52, GLOVE_CUFF)], fill=shade(cloth, 0.6), width=3)
        draw.rounded_rectangle((*px(30, 296), *px(300, 372))[:4] if toward > 0 else (*px(300, 296), *px(30, 372)), radius=26, fill=PAD)
        for k in range(4):
            x0 = 62 + k * 60
            box = (*px(x0, 308), *px(x0 + 44, 360)) if toward > 0 else (*px(x0 + 44, 308), *px(x0, 360))
            draw.rounded_rectangle(box, radius=14, fill=PAD_RIB)
        draw.line([px(118, 430), px(168, 486), px(118, 542)], fill=accent, width=16, joint="curve")
        draw.line([px(176, 430), px(226, 486), px(176, 542)], fill=shade(accent, 0.72), width=16, joint="curve")
        for y in range(392, GLOVE_CUFF - 16, 20):
            draw.line([px(70, y), px(71, y + 10)], fill=shade(cloth, 1.35), width=2)
    for y in FINGER_SEAMS:
        draw.line((0, y, width, y), fill=seam, width=7)
        for x in range(8, width, 18):
            draw.line((x, y - 9, x + 8, y - 9), fill=shade(cloth, 1.3), width=2)
            draw.line((x, y + 9, x + 8, y + 9), fill=shade(cloth, 1.3), width=2)
    draw.rectangle((0, GLOVE_CUFF, width, height), fill=INK)
    draw.rectangle((0, GLOVE_CUFF, width, GLOVE_CUFF + 10), fill=shade(cloth, 0.6))
    draw.rectangle((0, GLOVE_CUFF + 26, width, GLOVE_CUFF + 60), fill=accent)
    draw.rectangle((0, GLOVE_CUFF + 60, width, GLOVE_CUFF + 66), fill=(226, 226, 226))
    draw.rounded_rectangle((width // 2 - 150, GLOVE_CUFF + 84, width // 2 + 150, GLOVE_CUFF + 150), radius=10, fill=(40, 41, 46))
    for x in range(width // 2 - 140, width // 2 + 140, 9):
        draw.line((x, GLOVE_CUFF + 90, x, GLOVE_CUFF + 144), fill=(30, 31, 35), width=2)
    image.save(out / "glove.jpg", quality=92, subsampling=0)


def main():
    root = Path("content/cars")
    for team in teams():
        (root / team["id"]).mkdir(parents=True, exist_ok=True)
        wheel_face(root / team["id"], team)
        glove(root / team["id"], team)
    print("art: wheel faces and gloves")


if __name__ == "__main__":
    main()
