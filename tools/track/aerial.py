import json

import numpy as np
from PIL import Image
from pyproj import Transformer
from scipy.spatial import cKDTree
from scipy.ndimage import binary_closing, binary_fill_holes, binary_opening, distance_transform_edt, gaussian_filter, gaussian_filter1d, label, map_coordinates, median_filter

from geo import DEM_ORIGIN, Osm
import runoff

Image.MAX_IMAGE_PIXELS = None
METRES_PER_PIXEL = 0.3
_utm = Transformer.from_crs(4326, 32614, always_xy=True)


class Aerial:
    def __init__(self, source):
        self.osm = Osm(source / "osm.json")
        self.image = np.asarray(Image.open(source / "aerial.jpg").convert("RGB"), np.float32) / 255.0
        self.infrared = np.asarray(Image.open(source / "aerial-nir.png").convert("L"), np.float32) / 255.0

    def pixels(self, points):
        lat, lon = self.osm.latlon(points)
        x, y = _utm.transform(lon, lat)
        rows = (DEM_ORIGIN[1] - np.asarray(y)) / METRES_PER_PIXEL - 0.5
        columns = (np.asarray(x) - DEM_ORIGIN[0]) / METRES_PER_PIXEL - 0.5
        return rows, columns

    def local(self, rows, columns):
        x = DEM_ORIGIN[0] + (np.asarray(columns) + 0.5) * METRES_PER_PIXEL
        y = DEM_ORIGIN[1] - (np.asarray(rows) + 0.5) * METRES_PER_PIXEL
        lon, lat = _utm.transform(x, y, direction="INVERSE")
        return self.osm.local(np.stack([lat, lon], 1))

    def sample(self, points):
        shape = points.shape[:-1]
        rows, columns = self.pixels(points.reshape(-1, 2))
        channels = [map_coordinates(self.image[..., c], [rows, columns], order=1, mode="nearest") for c in range(3)]
        channels.append(map_coordinates(self.infrared, [rows, columns], order=1, mode="nearest"))
        return np.stack(channels, -1).reshape(shape + (4,))

    def newer(self, source, points):
        if not hasattr(self, "recent"):
            self.recent = np.asarray(Image.open(source / TERRAIN_SOURCE[0]).convert("L"), np.float32) / 255.0
        shape = points.shape[:-1]
        rows, columns = self.pixels(points.reshape(-1, 2))
        scale = self.image.shape[0] / self.recent.shape[0]
        values = map_coordinates(self.recent, [(rows + 0.5) / scale - 0.5, (columns + 0.5) / scale - 0.5], order=1, mode="nearest")
        return values.reshape(shape)


LATERAL_REACH = 60.0
LATERAL_STEP = 0.3
MASK_ROWS = 16384
SHAPE_SIGMA = (1.6, 0.7)
CONCRETE_VALUE = 0.7
CONCRETE_SATURATION = 0.06
FIELD_REACH = 1.2
FIELD_SMOOTHING = 0.8
EDGE_FILL = 1.6
KERB_BAND = (0.3, 1.2)
KERB_FINE = 0.6
KERB_COARSE = 2.0
KERB_RMS = 3.5
KERB_THRESHOLD = 0.03
KERB_GAP = 6
KERB_MIN_LENGTH = 18
KERB_WIDTH = 1.5
PHOTO_BLACK = 0.38
PHOTO_WHITE = 0.92
PAINT_PANEL_CLEAR = 0.3
PAINT_BLUE = (0.17, 0.42)
PAINTED_KERB_WIDTH = 1.3
PAINTED_KERB_BLOCK = 2.4
PAINTED_KERB_RED = 0.7
PAINTED_KERB_LENGTH = 8.0
PAVING_VEGETATION = -0.08
PAVING_SATURATION = 0.11
PAVING_VALUE = (0.55, 0.82)
HOLE_AREA = 300.0
REPAIR_REACH = 60.0
REPAIR_RANGE = (0.72, 1.12)
REPAIR_EDGE = 0.6
REPAIR_SOFTEN = 0.5
REPAIR_GAIN = 1.25
STAIN_SEED = 29
STAIN_DROP = 8.0
STAIN_LOOK = 60
STAIN_SIZE = ((1.6, 4.2), (0.8, 2.0))
STAIN_DEPTH = (0.74, 0.86)
STAIN_EDGE = 0.25
STAIN_SPREAD = 0.7
PALE_VALUE = 0.72
PALE_SATURATION = 0.14
PAVED_PANELS = (
    (140.0, -1, 7.6, 12.6, 400.0),
    (2053.0, -1, 10.2, 27.0, 106.0),
    (2684.0, -1, 9.6, 17.6, 68.0),
    (2915.0, -1, 10.5, 18.5, 60.0),
)
TERRAIN_SOURCE = ("aerial-2024.jpg", "aerial-2024-nir.png")
TERRAIN_QUALITY = 90
TERRAIN_STRAW = np.array([1.24, 0.99, 0.36], np.float32)
TERRAIN_OLIVE = np.array([1.08, 1.03, 0.32], np.float32)
TERRAIN_LEAF = np.array([0.8, 1.07, 0.5], np.float32)
TERRAIN_VEGETATION = (0.03, 0.09)
TERRAIN_GREENING = (0.08, 0.22)
TERRAIN_LEAFY = (0.24, 0.42)
TERRAIN_CHROMA = (0.06, 0.14)
TERRAIN_HUE = (25.0, 150.0)
TERRAIN_GRASS_GAIN = 0.8
TERRAIN_BARE_GAIN = 0.7
TERRAIN_CLUTTER = (3, 5)
TERRAIN_LEAF_GAIN = 1.0
LUMINANCE = np.array([0.2126, 0.7152, 0.0722], np.float32)
GRAVEL_VEGETATION = -0.105
GRAVEL_SATURATION = (0.085, 0.14)
GRAVEL_VALUE = 0.7
GRAVEL_HUE = (15, 55)
GRAVEL_BLUR = 1.2
GRAVEL_OPEN = 5
GRAVEL_CLOSE = 7
GRAVEL_MIN_AREA = 36.0
GRAVEL_HOLE_AREA = 250.0
GRAVEL_WALL_MARGIN = 0.5
GRAVEL_SPAN_ROW = 1.0
GRAVEL_SPAN_MIN = 0.6


def hsv(rgb):
    peak = rgb.max(-1)
    low = rgb.min(-1)
    delta = np.maximum(peak - low, 1e-5)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    hue = np.where(peak == r, ((g - b) / delta) % 6, np.where(peak == g, (b - r) / delta + 2, (r - g) / delta + 4)) * 60.0
    return hue, delta / np.maximum(peak, 1e-5), peak


def classes(rgb):
    hue, saturation, value = hsv(rgb)
    red = ((hue < 24) | (hue > 340)) & (saturation > 0.3)
    teal = (hue > 120) & (hue < 205) & (saturation > 0.07) & (value < 0.72)
    blue = (hue > 205) & (hue < 290) & (saturation > 0.12)
    white = (value > 0.8) & (saturation < 0.14)
    grey = saturation < 0.125
    asphalt = (value < 0.645) & grey & ~teal & ~blue
    concrete = (value >= CONCRETE_VALUE) & (saturation < CONCRETE_SATURATION) & ~white
    return {"red": red, "teal": teal, "blue": blue, "white": white, "asphalt": asphalt, "concrete": concrete}


def road_space(air, points, normal):
    lateral = np.arange(-LATERAL_REACH, LATERAL_REACH + 1e-3, LATERAL_STEP)
    grid = points[:, None, :] + normal[:, None, :] * lateral[None, :, None]
    return lateral, air.sample(grid)


def vegetation(sample):
    red, infrared = sample[..., 0], sample[..., 3]
    return (infrared - red) / np.maximum(infrared + red, 1e-3)


def gravel_beds(sample, found, lateral, half, walls, row_metres):
    hue, saturation, value = hsv(gaussian_filter(sample[..., :3], (GRAVEL_BLUR, GRAVEL_BLUR, 0)))
    green = gaussian_filter(vegetation(sample), GRAVEL_BLUR)
    paved = np.zeros(green.shape, bool)
    for name in ("red", "teal", "blue", "white", "asphalt", "concrete"):
        paved |= found[name]
    paved = gaussian_filter(paved.astype(np.float32), 1.0) > 0.3
    bare = (green < GRAVEL_VEGETATION) & (saturation > GRAVEL_SATURATION[0]) & (saturation < GRAVEL_SATURATION[1])
    bare &= (value > GRAVEL_VALUE) & (hue > GRAVEL_HUE[0]) & (hue < GRAVEL_HUE[1]) & ~paved
    bare = binary_closing(binary_opening(bare, np.ones((GRAVEL_OPEN, GRAVEL_OPEN))), np.ones((GRAVEL_CLOSE, GRAVEL_CLOSE)))
    regions, _ = label(bare)
    sizes = np.bincount(regions.ravel()) * row_metres * LATERAL_STEP
    sizes[0] = 0
    bare = (sizes > GRAVEL_MIN_AREA)[regions]
    holes, _ = label(binary_fill_holes(bare) & ~bare)
    hole_sizes = np.bincount(holes.ravel()) * row_metres * LATERAL_STEP
    hole_sizes[0] = np.inf
    bare |= (hole_sizes < GRAVEL_HOLE_AREA)[holes]
    left, right = walls[:, 0], walls[:, 1]
    beside = np.abs(lateral)[None, :] > half[:, None]
    within = (lateral[None, :] < left[:, None] - GRAVEL_WALL_MARGIN) & (lateral[None, :] > -right[:, None] + GRAVEL_WALL_MARGIN)
    return bare & beside & within


def gravel_spans(beds, lateral, row_metres):
    owner = ((np.arange(beds.shape[0]) + 0.5) * row_metres / GRAVEL_SPAN_ROW).astype(int)
    starts = np.flatnonzero(np.diff(owner, prepend=-1))
    coarse = np.add.reduceat(beds.astype(np.float32), starts, axis=0) > 0.5 * np.diff(np.append(starts, len(owner)))[:, None]
    spans = []
    for row, line in zip(owner[starts], coarse):
        edges = np.flatnonzero(np.diff(np.concatenate([[0], line.astype(np.int8), [0]])))
        for start, end in zip(edges[::2], edges[1::2]):
            near, far = lateral[start] - LATERAL_STEP / 2, lateral[end - 1] + LATERAL_STEP / 2
            if far - near >= GRAVEL_SPAN_MIN:
                spans.append([round((row + 0.5) * GRAVEL_SPAN_ROW, 2), round(float(near), 2), round(float(far), 2)])
    return spans


def resample(points, normal, half, rows):
    count = len(points)
    position = np.arange(rows) * count / rows
    base = np.floor(position).astype(int)
    following = (base + 1) % count
    t = position - base
    fine_points = points[base] * (1 - t[:, None]) + points[following] * t[:, None]
    fine_normal = normal[base] * (1 - t[:, None]) + normal[following] * t[:, None]
    fine_normal /= np.linalg.norm(fine_normal, axis=1, keepdims=True)
    return fine_points, fine_normal, half[base] * (1 - t) + half[following] * t


def band_mean(values, lateral, half, sign, near, far):
    rows = values.shape[0]
    out = np.zeros(rows, np.float32)
    for row in range(rows):
        offset = sign * lateral
        inside = (offset > half[row] + near) & (offset < half[row] + far)
        out[row] = values[row, inside].mean() if inside.any() else 0.0
    return out


def kerb_spans(rgb, lateral, half, step, blocked):
    redness = rgb[..., 0] - (rgb[..., 1] + rgb[..., 2]) / 2
    spans = []
    for sign, name in ((1, "left"), (-1, "right")):
        line = band_mean(redness, lateral, half, sign, *KERB_BAND)
        fine = gaussian_filter1d(line, KERB_FINE, mode="wrap") - gaussian_filter1d(line, KERB_COARSE, mode="wrap")
        rms = np.sqrt(gaussian_filter1d(fine * fine, KERB_RMS, mode="wrap"))
        on = (rms > KERB_THRESHOLD) & ~blocked
        rows = len(on)
        closed = on.copy()
        gap_start = None
        for row in range(rows):
            if not on[row]:
                gap_start = row if gap_start is None else gap_start
                continue
            if gap_start is not None and row - gap_start <= KERB_GAP:
                closed[gap_start:row] = True
            gap_start = None
        closed &= ~blocked
        row = 0
        while row < rows:
            if not closed[row]:
                row += 1
                continue
            end = row
            while end < rows and closed[end]:
                end += 1
            if end - row >= KERB_MIN_LENGTH:
                spans.append({"kind": "kerb", "side": name, "from": round(row * step, 3), "to": round(end * step, 3), "width": KERB_WIDTH})
            row = end
    return spans


def stretch(values):
    return np.clip((values - PHOTO_BLACK) / (PHOTO_WHITE - PHOTO_BLACK), 0, 1)


def fill_to_edge(found, lateral, half):
    for sign in (1, -1):
        offset = sign * lateral
        for row in range(len(half)):
            near = (offset >= half[row] - LATERAL_STEP) & (offset <= half[row] + EDGE_FILL)
            for name in ("red", "teal", "blue"):
                if found[name][row, near].any():
                    first = offset[near & found[name][row]].min()
                    span = near & (offset <= first)
                    found[name][row, span] = True
                    for other in ("asphalt", "concrete", "white"):
                        found[other][row, span] = False
                    break


def shape_field(mask, row_metres, sharp=None):
    clean = median_filter(mask.astype(np.uint8), size=3, mode="nearest").astype(np.float32)
    shape = gaussian_filter(clean, SHAPE_SIGMA, mode=("wrap", "nearest")) > 0.5
    if sharp is not None:
        shape = np.where(sharp, mask, shape)
    sampling = (row_metres, LATERAL_STEP)
    distance = distance_transform_edt(shape, sampling=sampling) - distance_transform_edt(~shape, sampling=sampling)
    field = gaussian_filter(distance.astype(np.float32), FIELD_SMOOTHING, mode=("wrap", "nearest"))
    return np.clip(0.5 + field / (2 * FIELD_REACH), 0, 1)


def panel_ground(rows, lateral, walls, row_metres, panel):
    centre, side, near, far, length = panel
    first = int(round((centre - length / 2) / row_metres))
    index = (first + np.arange(int(round(length / row_metres)))) % rows
    columns = np.nonzero((side * lateral >= near) & (side * lateral <= far))[0]
    limit = walls[index, 0 if side > 0 else 1] - PAINT_PANEL_CLEAR
    return index, columns, (side * lateral[columns])[None, :] < limit[:, None]


def panel_cells(shape, lateral, walls, row_metres):
    cells = np.zeros(shape, bool)
    for panel in PAVED_PANELS:
        index, columns, open_ground = panel_ground(shape[0], lateral, walls, row_metres, panel)
        cells[np.ix_(index, columns)] |= open_ground
    return cells


def fill_holes(shown, beds, row_metres):
    names = ("red", "teal", "blue", "white", "concrete", "asphalt")
    covered = np.logical_or.reduce([shown[name] for name in names])
    holes, count = label(binary_fill_holes(covered) & ~covered & ~beds)
    if count == 0:
        return
    area = np.bincount(holes.ravel(), minlength=count + 1) * row_metres * LATERAL_STEP
    area[0] = np.inf
    small = (area < HOLE_AREA)[holes]
    owner = np.zeros(covered.shape, np.int8)
    for k, name in enumerate(names):
        owner[shown[name]] = k + 1
    _, (near_rows, near_columns) = distance_transform_edt(owner == 0, return_indices=True)
    nearest = owner[near_rows, near_columns]
    for k, name in enumerate(names):
        shown[name] |= small & (nearest == k + 1)


def painted_kerbs(shown, lateral, half, row_metres, spans):
    rows = len(half)
    beside = np.abs(lateral)[None, :] - half[:, None]
    along = np.arange(rows) * row_metres
    phase = np.abs(np.mod(along, 2 * PAINTED_KERB_BLOCK) - 1.5 * PAINTED_KERB_BLOCK) - PAINTED_KERB_BLOCK / 2
    white = np.full((rows, len(lateral)), -np.inf, np.float32)
    red = np.full((rows, len(lateral)), -np.inf, np.float32)
    for sign, name in ((1, "left"), (-1, "right")):
        physical = np.zeros(rows, bool)
        for span in spans:
            if span["side"] == name:
                first, last = int(span["from"] / row_metres), int(np.ceil(span["to"] / row_metres))
                physical[np.arange(first, last + 1) % rows] = True
        band = ((lateral * sign) > 0)[None, :] & (beside >= 0) & (beside <= PAINTED_KERB_WIDTH)
        share = (shown["red"] & band).sum(axis=1) / np.maximum(band.sum(axis=1), 1)
        runs, count = label((share >= PAINTED_KERB_RED) & ~physical)
        lengths = np.bincount(runs, minlength=count + 1) * row_metres
        lengths[0] = 0
        painted = (lengths >= PAINTED_KERB_LENGTH)[runs]
        across = np.minimum(beside, PAINTED_KERB_WIDTH - beside)
        side = ((lateral * sign) > 0)[None, :] & painted[:, None]
        strip = np.where(side, across, -np.inf)
        red = np.maximum(red, strip)
        white = np.maximum(white, np.where(side, np.minimum(across, phase[:, None]), -np.inf))
        shown["red"] &= ~(side & (beside <= PAINTED_KERB_WIDTH + 0.3))
    to_field = lambda distance: np.clip(0.5 + distance / (2 * runoff.REACH), 0, 1).astype(np.float32)
    return to_field(red), to_field(white)


def racing_line(source, points, normal):
    line = json.loads((source.parent / "racing-line.json").read_text())
    path = np.stack([np.array(line["x"]), -np.array(line["z"])], 1)
    speed = np.array(line["profile"]["speed"])
    nearest = cKDTree(points).query(path)[1]
    offset = ((path - points[nearest]) * normal[nearest]).sum(1)
    return nearest, offset, speed


def stains(source, points, normal, lateral, row_metres):
    rows = len(points)
    nearest, offset, speed = racing_line(source, points, normal)
    order = np.argsort(nearest)
    nearest, offset, speed = nearest[order], offset[order], speed[order]
    count = len(speed)
    window = np.arange(1, STAIN_LOOK)
    drops = []
    for k in range(count):
        ahead = speed[(k + window) % count]
        if speed[k] >= speed[(k + np.arange(-6, 7)) % count].max() and speed[k] - ahead.min() > STAIN_DROP:
            drops.append((k, int(np.argmin(ahead)) + 1))
    factor = np.ones((rows, len(lateral)), np.float32)
    rng = np.random.default_rng(STAIN_SEED)

    def blot(row, centre, length, width, depth):
        span = int(length / row_metres)
        band = (row + np.arange(-span, span + 1)) % rows
        along = np.arange(-span, span + 1)[:, None] * row_metres / length
        across = (lateral[None, :] - centre) / width
        angle = np.arctan2(across, along)
        wobble = 1 + 0.16 * np.sin(rng.uniform(0, 6.3) + 3 * angle) + 0.08 * np.sin(rng.uniform(0, 6.3) + 7 * angle)
        inside = np.clip((1 - np.hypot(along, across) / wobble) / STAIN_EDGE, 0, 1)
        factor[band] = np.minimum(factor[band], 1 - (1 - depth) * inside)

    for k, reach in drops:
        for _ in range(rng.integers(1, 4)):
            at = (k + int(reach * rng.uniform(0.3, 0.9))) % count
            blot(nearest[at], offset[at] + rng.normal(0, STAIN_SPREAD), rng.uniform(*STAIN_SIZE[0]), rng.uniform(*STAIN_SIZE[1]), rng.uniform(*STAIN_DEPTH))
    for design in (runoff.load(source) or {"designs": []})["designs"]:
        if design["kind"] == "stain":
            blot(int(round(design["at"][0] / row_metres)) % rows, design["at"][1], design["length"], design["width"], design["depth"])
    return factor


def repairs(recent, lateral, half, row_metres, stained=None):
    beside = half[:, None] - np.abs(lateral)[None, :]
    road = (beside > 0).astype(np.float32)
    along = REPAIR_REACH / row_metres
    total = gaussian_filter(recent * road, (along, 30.0), mode=("wrap", "nearest"))
    weight = gaussian_filter(road, (along, 30.0), mode=("wrap", "nearest"))
    ratio = recent / np.maximum(total / np.maximum(weight, 1e-3), 1e-3)
    ratio = gaussian_filter(np.clip(ratio, *REPAIR_RANGE), (REPAIR_SOFTEN / row_metres, REPAIR_SOFTEN / LATERAL_STEP), mode=("wrap", "nearest"))
    fade = np.clip(beside / REPAIR_EDGE, 0, 1)
    if stained is not None:
        ratio = ratio * stained
    ratio = 1 + (ratio - 1) * fade
    return np.clip(0.5 + (ratio - 1) * REPAIR_GAIN, 0, 1)


def write_masks(sample, lateral, half, walls, row_metres, directory, source, fonts, kerbs=(), recent=None, stained=None):
    rgb = sample[..., :3]
    found = classes(rgb)
    fill_to_edge(found, lateral, half)
    paved = panel_cells(found["red"].shape, lateral, walls, row_metres)
    beds = gravel_beds(sample, found, lateral, half, walls, row_metres) & ~paved
    sealed = paved.copy()
    for name in ("red", "teal", "blue", "white", "asphalt", "concrete"):
        sealed |= shape_field(found[name], row_metres) > 0.5
    sealed &= (np.abs(lateral)[None, :] > half[:, None]) & ~beds
    luminance = stretch(rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32))
    shown = {name: mask.copy() for name, mask in found.items()}
    _, saturation, value = hsv(gaussian_filter(rgb, (1.0, 1.0, 0)))
    dull = shown["blue"] & ((saturation < PAINT_BLUE[0]) | (value < PAINT_BLUE[1]))
    dull = binary_opening(dull, np.ones((3, 3)))
    shown["blue"] &= ~dull
    shown["asphalt"] |= dull
    fill_holes(shown, beds, row_metres)
    kerb_red, kerb_white = painted_kerbs(shown, lateral, half, row_metres, kerbs)
    shown["aerial teal"] = shown["teal"].copy()
    shown["teal"][:] = False
    runoff.recolour(source, len(half), lateral, half, walls, row_metres, shown)
    painted = shown["red"] | shown["teal"] | shown["blue"] | shown["white"] | shown["concrete"]
    shown["asphalt"] |= paved & ~painted
    paving = (gaussian_filter(vegetation(sample), 1.0) < PAVING_VEGETATION) & (saturation < PAVING_SATURATION)
    paving &= (value > PAVING_VALUE[0]) & (value < PAVING_VALUE[1]) & ~beds & ~painted & ~shown["asphalt"]
    paving |= (value > PALE_VALUE) & (saturation < PALE_SATURATION) & ~beds & ~painted & ~shown["asphalt"]
    paving = shape_field(paving, row_metres) > 0.5
    paving &= np.abs(lateral)[None, :] > half[:, None]
    shown["concrete"] |= paving
    clears, grounds = runoff.clearing(source, len(half), lateral, half, walls, row_metres, fonts, sealed | paving)
    for name in ("red", "teal", "blue", "white", "concrete"):
        shown[name] &= ~(clears | grounds)
    shown["asphalt"] &= ~grounds
    shown["asphalt"] |= clears
    for name in ("red", "teal", "blue", "white"):
        shown[name] &= ~beds
    fields, index, channels, hidden = runoff.paint(source, len(half), lateral, half, walls, row_metres, shape_field(sealed | paving, row_metres))
    aerial_red = np.maximum(shape_field(shown["red"], row_metres), kerb_red)
    aerial_white = np.maximum(np.minimum(shape_field(shown["white"], row_metres), 1 - kerb_red), kerb_white)
    aerial = {"red": aerial_red, "teal": shape_field(shown["teal"], row_metres), "blue": shape_field(shown["blue"], row_metres), "white": aerial_white}
    first = np.stack([np.maximum(np.minimum(aerial[name], 1 - hidden[key]), channels[key]) for name, key in (("red", "red"), ("teal", "green"), ("blue", "blue"), ("white", "white"))], -1)
    second = np.stack([shape_field(shown["concrete"], row_metres), shape_field(shown["asphalt"], row_metres), gaussian_filter1d(luminance, 1.0, axis=0, mode="wrap") if recent is None else repairs(recent, lateral, half, row_metres, stained), shape_field(beds, row_metres)], -1)
    third = np.stack([fields[0], runoff.encode_index(index[0]), fields[1], runoff.encode_index(index[1])], -1)
    for name, data in (("apron_a.png", first), ("apron_b.png", second), ("apron_c.png", third)):
        Image.fromarray(np.round(data * 255).astype(np.uint8), "RGBA").save(directory / name)
    return gravel_spans(beds, lateral, row_metres), gravel_spans(sealed, lateral, row_metres)


def linear(srgb):
    return np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)


def encoded(values):
    values = np.clip(values, 0, 1)
    return np.where(values <= 0.0031308, values * 12.92, 1.055 * values ** (1 / 2.4) - 0.055)


def ramp(values, edges):
    t = np.clip((values - edges[0]) / (edges[1] - edges[0]), 0, 1)
    return t * t * (3 - 2 * t)


def write_terrain(source, directory):
    photo = np.asarray(Image.open(source / TERRAIN_SOURCE[0]).convert("RGB"), np.float32) / 255.0
    infrared = np.asarray(Image.open(source / TERRAIN_SOURCE[1]).convert("L"), np.float32) / 255.0
    ndvi = (infrared - photo[..., 0]) / np.maximum(infrared + photo[..., 0], 1e-3)
    hue, saturation, _ = hsv(photo)
    plant = ramp(saturation, TERRAIN_CHROMA) * ((hue > TERRAIN_HUE[0]) & (hue < TERRAIN_HUE[1]))
    colour = linear(photo)
    luminance = (colour @ LUMINANCE)[..., None]
    grass = TERRAIN_STRAW + (TERRAIN_OLIVE - TERRAIN_STRAW) * ramp(ndvi, TERRAIN_GREENING)[..., None]
    leafy = ramp(ndvi, TERRAIN_LEAFY)[..., None]
    living = luminance * (grass * TERRAIN_GRASS_GAIN * (1 - leafy) + TERRAIN_LEAF * TERRAIN_LEAF_GAIN * leafy)
    vegetated = (ramp(ndvi, TERRAIN_VEGETATION) * plant)[..., None]
    step, size = TERRAIN_CLUTTER
    small = colour[::step, ::step]
    calm = np.stack([median_filter(small[..., c], size=size, mode="nearest") for c in range(3)], -1)
    calm = np.repeat(np.repeat(calm, step, 0), step, 1)[: colour.shape[0], : colour.shape[1]]
    graded = calm * TERRAIN_BARE_GAIN * (1 - vegetated) + living * vegetated
    Image.fromarray(np.round(encoded(graded) * 255).astype(np.uint8), "RGB").save(directory / "terrain_albedo.jpg", quality=TERRAIN_QUALITY, subsampling=0)


def fit_affine(air, reach=1600.0):
    grid = np.array([[x, y] for x in (-reach, 0, reach) for y in (-reach, 0, reach)], float)
    rows, columns = air.pixels(grid)
    height, width = air.image.shape[:2]
    design = np.column_stack([grid, np.ones(len(grid))])
    u, *_ = np.linalg.lstsq(design, (columns + 0.5) / width, rcond=None)
    v, *_ = np.linalg.lstsq(design, 1.0 - (rows + 0.5) / height, rcond=None)
    return {"u": [float(c) for c in u], "v": [float(c) for c in v]}


def bake(source, points, normal, half, walls, step, blocked, textures, build):
    air = Aerial(source)
    lateral, sample = road_space(air, points, normal)
    spans = kerb_spans(sample[..., :3], lateral, half, step, blocked)
    textures.mkdir(parents=True, exist_ok=True)
    build.mkdir(parents=True, exist_ok=True)
    fine_points, fine_normal, fine_half = resample(points, normal, half, MASK_ROWS)
    position = np.arange(MASK_ROWS) * len(points) / MASK_ROWS
    fine_walls = np.stack([np.interp(position, np.arange(len(points) + 1), np.append(w, w[0])) for w in walls.T], 1)
    fine_lateral, fine_sample = road_space(air, fine_points, fine_normal)
    row_metres = step * len(points) / MASK_ROWS
    recent = air.newer(source, fine_points[:, None, :] + fine_normal[:, None, :] * fine_lateral[None, :, None])
    stained = stains(source, fine_points, fine_normal, fine_lateral, row_metres)
    gravel, sealed = write_masks(fine_sample, fine_lateral, fine_half, fine_walls, row_metres, textures, source, build / "fonts", spans, recent, stained)
    write_terrain(source, textures)
    (build / "aerial.json").write_text(json.dumps({**fit_affine(air), "reach": LATERAL_REACH}))
    return spans, gravel, sealed
