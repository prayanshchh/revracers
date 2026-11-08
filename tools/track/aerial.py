import json

import numpy as np
from PIL import Image
from pyproj import Transformer
from scipy.ndimage import binary_closing, binary_fill_holes, binary_opening, distance_transform_edt, gaussian_filter, gaussian_filter1d, label, map_coordinates, median_filter

from geo import DEM_ORIGIN, Osm

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
TERRAIN_DOWNSAMPLE = 2
TERRAIN_QUALITY = 90
GRASS_GRADE = np.array([0.88, 1.02, 0.72], np.float32)
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


def shape_field(mask, row_metres):
    clean = median_filter(mask.astype(np.uint8), size=3, mode="nearest").astype(np.float32)
    shape = gaussian_filter(clean, SHAPE_SIGMA, mode=("wrap", "nearest")) > 0.5
    sampling = (row_metres, LATERAL_STEP)
    distance = distance_transform_edt(shape, sampling=sampling) - distance_transform_edt(~shape, sampling=sampling)
    field = gaussian_filter(distance.astype(np.float32), FIELD_SMOOTHING, mode=("wrap", "nearest"))
    return np.clip(0.5 + field / (2 * FIELD_REACH), 0, 1)


def write_masks(sample, lateral, half, walls, row_metres, directory):
    rgb = sample[..., :3]
    found = classes(rgb)
    fill_to_edge(found, lateral, half)
    beds = gravel_beds(sample, found, lateral, half, walls, row_metres)
    sealed = np.zeros(beds.shape, bool)
    for name in ("red", "teal", "blue", "white", "asphalt", "concrete"):
        sealed |= shape_field(found[name], row_metres) > 0.5
    sealed &= (np.abs(lateral)[None, :] > half[:, None]) & ~beds
    luminance = stretch(rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32))
    field = lambda name: shape_field(found[name], row_metres)
    first = np.stack([field(name) for name in ("red", "teal", "blue", "white")], -1)
    second = np.stack([field("concrete"), field("asphalt"), gaussian_filter1d(luminance, 1.0, axis=0, mode="wrap"), shape_field(beds, row_metres)], -1)
    for name, data in (("apron_a.png", first), ("apron_b.png", second)):
        Image.fromarray(np.round(data * 255).astype(np.uint8), "RGBA").save(directory / name)
    return gravel_spans(beds, lateral, row_metres), gravel_spans(sealed, lateral, row_metres)


def write_terrain(air, directory):
    image = air.image
    stride = TERRAIN_DOWNSAMPLE
    rows, columns = image.shape[0] // stride * stride, image.shape[1] // stride * stride
    small = image[:rows, :columns].reshape(rows // stride, stride, columns // stride, stride, 3).mean(axis=(1, 3))
    graded = stretch(small)
    hue, saturation, _ = hsv(small)
    grass = (hue > 12) & (hue < 62) & (saturation > 0.1)
    graded[grass] = np.clip(graded[grass] * GRASS_GRADE, 0, 1)
    Image.fromarray(np.round(graded * 255).astype(np.uint8), "RGB").save(directory / "terrain_albedo.jpg", quality=TERRAIN_QUALITY, subsampling=0)


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
    gravel, sealed = write_masks(fine_sample, fine_lateral, fine_half, fine_walls, row_metres, textures)
    write_terrain(air, textures)
    (build / "aerial.json").write_text(json.dumps({**fit_affine(air), "reach": LATERAL_REACH}))
    return spans, gravel, sealed
