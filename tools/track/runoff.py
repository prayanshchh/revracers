import json
import math

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt

from brands import font

LAYERS = 2
INDEX_STEP = 16
SUPERSAMPLE = 3
WORD_PIXELS = 360
WALL_CLEAR = 0.3
STAR_INNER = 0.382
FACES = {
    "serif": ("playfair", 800),
    "sans": ("montserrat", 800),
    "condensed": ("oswald", 700),
    "italic": ("barlow", None),
    "block": ("anton", None),
}


def load(source):
    path = source / "runoff.json"
    if not path.exists():
        return None
    return json.loads(path.read_text())


class Space:
    def __init__(self, rows, lateral, half, walls, row_metres):
        self.rows = rows
        self.lateral = lateral
        self.half = half
        self.walls = walls
        self.row_metres = row_metres
        self.step = float(lateral[1] - lateral[0])
        self.length = rows * row_metres

    def row(self, s):
        return np.asarray(s, float) / self.row_metres

    def column(self, l):
        return (np.asarray(l, float) - self.lateral[0]) / self.step

    def edge(self, s, side):
        rows = np.clip(np.round(self.row(s)).astype(int) % self.rows, 0, self.rows - 1)
        return self.half[rows] * side

    def wall(self, s, side):
        rows = np.clip(np.round(self.row(s)).astype(int) % self.rows, 0, self.rows - 1)
        return (self.walls[rows, 0 if side > 0 else 1] - WALL_CLEAR) * side


def lateral_of(space, s, side, value):
    if value == "wall":
        return space.wall(s, side)
    return space.edge(s, side) + side * float(value)


def anchor(space, design, s):
    lane = design.get("lane")
    if lane is None:
        return float(design["at"][1])
    side = 1 if lane[0] == "left" else -1
    return float(lateral_of(space, s, side, lane[1]))


def band_outline(space, design):
    side = 1 if design["side"] == "left" else -1
    s0, s1 = design["from"], design["to"]
    if s1 < s0:
        s1 += space.length
    taper = design.get("taper", [0.0, 0.0])
    count = max(2, int((s1 - s0) / 0.5) + 1)
    s = np.linspace(s0, s1, count)
    near = np.array([lateral_of(space, x, side, design["near"]) for x in s])
    far = np.array([lateral_of(space, x, side, design["far"]) for x in s])
    grow = np.ones(count)
    if taper[0] > 0:
        grow = np.minimum(grow, np.clip((s - s0) / taper[0], 0, 1))
    if taper[1] > 0:
        grow = np.minimum(grow, np.clip((s1 - s) / taper[1], 0, 1))
    far = near + (far - near) * grow
    return list(zip(s, near)) + list(zip(s[::-1], far[::-1]))


def stripe_mask(space, design):
    region = polygon_mask(space, band_outline(space, design))
    side = 1 if design["side"] == "left" else -1
    s0, s1 = design["from"], design["to"]
    if s1 < s0:
        s1 += space.length
    slope = math.tan(math.radians(design.get("angle", 45.0)))
    out = np.zeros_like(region)
    s = s0
    while s < s1:
        near = lateral_of(space, s, side, design["near"])
        far = lateral_of(space, s, side, design["far"])
        shift = abs(far - near) * slope
        out |= polygon_mask(space, [(s, near), (s + design["width"], near), (s + design["width"] + shift, far), (s + shift, far)])
        s += design["every"]
    return out & region


def star_outline(space, design):
    s = design["at"][0]
    l = anchor(space, design, s)
    radius = design["radius"]
    turn = math.radians(design.get("turn", 0.0))
    points = []
    for k in range(10):
        r = radius if k % 2 == 0 else radius * STAR_INNER
        a = turn + k * math.pi / 5
        points.append((s + r * math.cos(a), l + r * math.sin(a)))
    return points


def polygon_mask(space, outline):
    out = np.zeros((space.rows, len(space.lateral)), bool)
    rows = space.row([p[0] for p in outline])
    columns = space.column([p[1] for p in outline])
    for shift in (-space.rows, 0, space.rows):
        r = rows + shift
        if r.max() < 0 or r.min() >= space.rows:
            continue
        top = int(max(0, math.floor(r.min())))
        bottom = int(min(space.rows, math.ceil(r.max()) + 1))
        canvas = Image.new("L", (len(space.lateral) * SUPERSAMPLE, (bottom - top) * SUPERSAMPLE), 0)
        ImageDraw.Draw(canvas).polygon([((c + 0.5) * SUPERSAMPLE, (y - top + 0.5) * SUPERSAMPLE) for c, y in zip(columns, r)], fill=255)
        small = np.asarray(canvas.resize((len(space.lateral), bottom - top), Image.BOX)) > 127
        out[top:bottom] |= small
    return out


def word_image(design, fonts):
    name, weight = FACES[design.get("style", "sans")]
    face = font(fonts, name, WORD_PIXELS, weight)
    text = design["text"]
    tracking = design.get("tracking", 0.0) * WORD_PIXELS
    probe = ImageDraw.Draw(Image.new("L", (8, 8)))
    widths = [probe.textbbox((0, 0), c, font=face)[2] for c in text]
    width = int(sum(widths) + tracking * (len(text) - 1) + WORD_PIXELS)
    canvas = Image.new("L", (width, WORD_PIXELS * 2), 0)
    draw = ImageDraw.Draw(canvas)
    x = WORD_PIXELS / 2
    slant = design.get("slant", 0.0)
    for c, w in zip(text, widths):
        draw.text((x, WORD_PIXELS / 3), c, font=face, fill=255)
        x += w + tracking
    if slant:
        canvas = canvas.transform(canvas.size, Image.AFFINE, (1, slant, -slant * WORD_PIXELS, 0, 1, 0), Image.BILINEAR)
    box = canvas.getbbox()
    art = np.asarray(canvas.crop(box), np.float32) / 255.0
    emblem = design.get("emblem")
    if emblem == "compass":
        art = np.concatenate([compass(art.shape[0] * 1.35, art.shape[0]), np.zeros((art.shape[0], int(art.shape[0] * 0.35)), np.float32), art], 1)
    return art


def compass(size, rows):
    size = int(size)
    big = size * 4
    canvas = Image.new("L", (big, big), 0)
    draw = ImageDraw.Draw(canvas)
    c = big / 2
    ring = big * 0.3
    draw.ellipse([c - ring, c - ring, c + ring, c + ring], outline=255, width=int(big * 0.05))
    for k in range(16):
        a = k * math.pi / 8
        reach = big * (0.5 if k % 4 == 0 else 0.42 if k % 2 == 0 else 0.36)
        side = a + math.pi / 2
        w = big * (0.055 if k % 2 == 0 else 0.035)
        tip = (c + reach * math.cos(a), c + reach * math.sin(a))
        draw.polygon([tip, (c + w * math.cos(side), c + w * math.sin(side)), (c - w * math.cos(side), c - w * math.sin(side))], fill=255)
    small = np.asarray(canvas.resize((size, size), Image.LANCZOS), np.float32) / 255.0
    top = (size - rows) // 2
    if top >= 0:
        return small[top : top + rows]
    return np.pad(small, ((-top, rows - size + top), (0, 0)))


def word_mask(space, design, fonts):
    art = word_image(design, fonts)
    height = design["height"]
    scale = height / art.shape[0]
    length = art.shape[1] * scale
    turn = math.radians(design.get("turn", 0.0))
    along = np.array([math.cos(turn), math.sin(turn)])
    up = np.array([-math.sin(turn), math.cos(turn)])
    out = np.zeros((space.rows, len(space.lateral)), bool)
    repeat = design.get("repeat")
    starts = [design["at"][0]]
    if repeat:
        s = design["at"][0] + repeat["every"]
        while s <= repeat["to"]:
            starts.append(s)
            s += repeat["every"]
    for start in starts:
        centre = np.array([start, anchor(space, design, start)], float)
        corners = [centre + along * a * length / 2 + up * b * height / 2 for a in (-1, 1) for b in (-1, 1)]
        corners = np.array(corners)
        r0 = int(math.floor(space.row(corners[:, 0].min()))) - 1
        r1 = int(math.ceil(space.row(corners[:, 0].max()))) + 2
        c0 = max(0, int(math.floor(space.column(corners[:, 1].min()))) - 1)
        c1 = min(len(space.lateral), int(math.ceil(space.column(corners[:, 1].max()))) + 2)
        if c1 <= c0:
            continue
        sub = (np.arange(SUPERSAMPLE) + 0.5) / SUPERSAMPLE - 0.5
        rows = np.arange(r0, r1)
        cols = np.arange(c0, c1)
        rr = (rows[:, None, None, None] + sub[None, None, :, None]) * space.row_metres
        cc = space.lateral[0] + (cols[None, :, None, None] + sub[None, None, None, :]) * space.step
        ds = rr - centre[0]
        dl = cc - centre[1]
        x = (ds * along[0] + dl * along[1]) / scale + art.shape[1] / 2
        y = art.shape[0] / 2 - (ds * up[0] + dl * up[1]) / scale
        inside = (x >= 0) & (x < art.shape[1] - 1) & (y >= 0) & (y < art.shape[0] - 1)
        xi = np.clip(x.astype(int), 0, art.shape[1] - 1)
        yi = np.clip(y.astype(int), 0, art.shape[0] - 1)
        cover = np.where(inside, art[yi, xi], 0).mean(axis=(2, 3)) > 0.5
        target = out[rows % space.rows]
        target[:, c0:c1] |= cover
        out[rows % space.rows] = target
    return out


def shape(space, design, fonts):
    kind = design["kind"]
    if kind == "band":
        return polygon_mask(space, band_outline(space, design))
    if kind == "area":
        return polygon_mask(space, [tuple(p) for p in design["points"]])
    if kind == "star":
        return polygon_mask(space, star_outline(space, design))
    if kind == "word":
        return word_mask(space, design, fonts)
    if kind == "stripes":
        return stripe_mask(space, design)
    raise ValueError(f"unknown run-off design {kind}")


def recolour(source, rows, lateral, half, walls, row_metres, shown):
    data = load(source)
    if data is None:
        return
    space = Space(rows, lateral, half, walls, row_metres)
    for design in data["designs"]:
        if design["kind"] != "recolour":
            continue
        mask = polygon_mask(space, band_outline(space, {**design, "near": -1.0, "far": "wall"}))
        moved = shown[design["paint"]] & mask
        shown[design["paint"]] &= ~moved
        shown[design["colour"]] |= moved
    for name, target in data.get("aerial", {}).items():
        shown[target] |= shown[name]
        shown[name][:] = False


CHANNELS = ("red", "green", "blue", "white")
REACH = 1.2
CHUNK = 2048


def polygon_sdf(space, outline):
    points = np.asarray(outline, float)
    first = int(math.floor((points[:, 0].min() - REACH) / space.row_metres))
    last = int(math.ceil((points[:, 0].max() + REACH) / space.row_metres)) + 1
    columns = np.flatnonzero((space.lateral >= points[:, 1].min() - REACH) & (space.lateral <= points[:, 1].max() + REACH))
    if len(columns) == 0:
        return np.arange(0), columns, np.zeros((0, 0))
    rows = np.arange(first, last)
    centres = np.stack(np.broadcast_arrays((rows * space.row_metres)[:, None], space.lateral[columns][None, :]), -1).reshape(-1, 2)
    start, end = points, np.roll(points, -1, 0)
    edge = end - start
    length = np.maximum((edge * edge).sum(1), 1e-12)
    out = np.empty(len(centres))
    for k in range(0, len(centres), CHUNK):
        p = centres[k : k + CHUNK, None, :]
        t = np.clip(((p - start) * edge).sum(-1) / length, 0, 1)
        gap = p - (start + t[..., None] * edge)
        distance = np.sqrt((gap * gap).sum(-1).min(1))
        crossing = (start[:, 1] > p[..., 1]) != (end[:, 1] > p[..., 1])
        at = start[:, 0] + (p[..., 1] - start[:, 1]) * edge[:, 0] / np.where(edge[:, 1] == 0, 1e-12, edge[:, 1])
        inside = (crossing & (p[..., 0] < at)).sum(1) % 2 == 1
        out[k : k + CHUNK] = np.where(inside, distance, -distance)
    return rows % space.rows, columns, out.reshape(len(rows), len(columns))


def outlines(space, design):
    kind = design["kind"]
    if kind == "band":
        return [band_outline(space, design)], None
    if kind == "area":
        return [[tuple(p) for p in design["points"]]], None
    if kind == "star":
        return [star_outline(space, design)], None
    if kind == "stripes":
        return stripe_outlines(space, design), band_outline(space, design)
    return [], None


def stripe_outlines(space, design):
    side = 1 if design["side"] == "left" else -1
    s0, s1 = design["from"], design["to"]
    if s1 < s0:
        s1 += space.length
    slope = math.tan(math.radians(design.get("angle", 45.0)))
    shapes, s = [], s0
    while s < s1:
        near = float(lateral_of(space, s, side, design["near"]))
        far = float(lateral_of(space, s, side, design["far"]))
        shift = abs(far - near) * slope
        shapes.append([(s, near), (s + design["width"], near), (s + design["width"] + shift, far), (s + shift, far)])
        s += design["every"]
    return shapes


def design_field(space, design, offroad, sealed_field):
    shapes, within = outlines(space, design)
    field = np.zeros((space.rows, len(space.lateral)), np.float32)
    for outline in shapes:
        rows, columns, sdf = polygon_sdf(space, outline)
        if len(columns) == 0:
            continue
        block = field[np.ix_(rows, columns)]
        field[np.ix_(rows, columns)] = np.maximum(block, np.clip(0.5 + sdf / (2 * REACH), 0, 1))
    if within is not None:
        rows, columns, sdf = polygon_sdf(space, within)
        limit = np.zeros_like(field)
        limit[np.ix_(rows, columns)] = np.clip(0.5 + sdf / (2 * REACH), 0, 1)
        field = np.minimum(field, limit)
    field = np.minimum(field, offroad)
    if design.get("clip", "paved") == "paved":
        field = np.minimum(field, sealed_field)
    return field


def clearing(source, rows, lateral, half, walls, row_metres, fonts, sealed):
    data = load(source)
    shape_ = (rows, len(lateral))
    clears = np.zeros(shape_, bool)
    grounds = np.zeros(shape_, bool)
    if data is None:
        return clears, grounds
    space = Space(rows, lateral, half, walls, row_metres)
    road = np.abs(lateral)[None, :] <= half[:, None]
    for design in data["designs"]:
        if design["kind"] in ("recolour", "stain") or design["colour"] not in ("clear", "ground"):
            continue
        mask = shape(space, design, fonts) & ~road
        if design.get("clip", "paved") == "paved":
            mask &= sealed
        (clears if design["colour"] == "clear" else grounds)[mask] = True
    return clears, grounds


def paint(source, rows, lateral, half, walls, row_metres, sealed_field):
    data = load(source)
    shape_ = (rows, len(lateral))
    fields = np.zeros((LAYERS,) + shape_, np.float32)
    index = np.zeros((LAYERS,) + shape_, np.int16)
    channels = {name: np.zeros(shape_, np.float32) for name in CHANNELS}
    hidden = {name: np.zeros(shape_, np.float32) for name in CHANNELS}
    if data is None:
        return fields, index, channels, hidden
    names = [entry["name"] for entry in data["palette"]]
    space = Space(rows, lateral, half, walls, row_metres)
    offroad = np.clip(0.5 + (np.abs(lateral)[None, :] - half[:, None]) / (2 * REACH), 0, 1).astype(np.float32)
    for design in data["designs"]:
        if design["kind"] in ("recolour", "word", "stain") or design["colour"] in ("clear", "ground"):
            continue
        field = design_field(space, design, offroad, sealed_field)
        layer = design.get("layer", 1) - 1
        if layer == 0 and design["colour"] in CHANNELS:
            for name in CHANNELS:
                if name == design["colour"]:
                    channels[name] = np.maximum(channels[name], field)
                    hidden[name] = np.minimum(hidden[name], 1 - field)
                else:
                    channels[name] = np.minimum(channels[name], 1 - field)
                    hidden[name] = np.maximum(hidden[name], field)
            continue
        covered = field >= 0.5
        fields[layer] = np.maximum(fields[layer], field)
        index[layer][covered] = names.index(design["colour"])
    filled = np.zeros_like(index)
    for layer in range(LAYERS):
        covered = fields[layer] >= 0.5
        if covered.any():
            _, (near_rows, near_columns) = distance_transform_edt(~covered, return_indices=True)
            filled[layer] = index[layer][near_rows, near_columns]
    return fields, filled, channels, hidden


ATLAS_WIDTH = 2048
ATLAS_ROW = 256
ATLAS_PAD = 8


def word_key(design):
    return "|".join(str(design.get(k, "")) for k in ("style", "emblem", "tracking", "slant", "colour"))


def word_atlas(source, fonts):
    data = load(source)
    if data is None:
        return None, {}
    albedo = {entry["name"]: entry["albedo"] for entry in data["palette"]}
    entries = {}
    for design in data["designs"]:
        if design["kind"] == "word":
            entries.setdefault(word_key(design), design)
    atlas = Image.new("RGBA", (ATLAS_WIDTH, ATLAS_ROW * max(1, len(entries))), (0, 0, 0, 0))
    layout = {}
    for row, (key, design) in enumerate(entries.items()):
        art = word_image(design, fonts)
        inner = ATLAS_ROW - 2 * ATLAS_PAD
        width = min(ATLAS_WIDTH - 2 * ATLAS_PAD, int(round(art.shape[1] * inner / art.shape[0])))
        alpha = Image.fromarray(np.round(art * 255).astype(np.uint8)).resize((width, inner), Image.LANCZOS)
        colour = tuple(int(round(255 * (c ** (1 / 2.4) * 1.055 - 0.055 if c > 0.0031308 else c * 12.92))) for c in albedo[design["colour"]])
        tile = Image.new("RGBA", (width, inner), colour + (0,))
        tile.putalpha(alpha)
        top = row * ATLAS_ROW + ATLAS_PAD
        atlas.paste(tile, (ATLAS_PAD, top))
        layout[key] = {"u": [ATLAS_PAD / ATLAS_WIDTH, (ATLAS_PAD + width) / ATLAS_WIDTH], "v": [1 - (top + inner) / atlas.height, 1 - top / atlas.height], "aspect": width / inner}
    return atlas, layout


def encode_index(index):
    return (index * INDEX_STEP + INDEX_STEP // 2).astype(np.float32) / 255.0
