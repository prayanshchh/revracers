import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import Transformer
from scipy.ndimage import binary_closing, binary_opening, label
from scipy.spatial import cKDTree
from shapely.geometry import Polygon

from geo import DEM_ORIGIN, DEM_SIZE, Osm

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scenery"))

from trees import Heights, Track

OVERPASS = "https://overpass-api.de/api/interpreter"
DOWNTOWN = (30.250, -97.765, 30.290, -97.725)
REGION = (30.02, -97.82, 30.30, -97.46)
LOWEST = 15.0
LEVEL = 3.6
TANK_HEIGHT = 42.0
TANK_REACH = 22000.0
GRID = (30.105, -97.680, 30.165, -97.590)
PYLON_HEIGHT = 22.0
GRID_VOLTAGE = 69000
GRID_REACH = 18000.0
SIMPLEST = 1.5
SINK = 4.0
PYLON_SINK = 3.0
SINK_SEED = 20261118
FAR = (30.03, -97.76, 30.24, -97.52)
FAR_PERIMETER = 300.0
FAR_SINK = 2.0
FAR_HEIGHTS = {"warehouse": 10.0, "industrial": 10.0, "school": 9.0, "apartments": 13.0, "retail": 8.0, "office": 14.0, "hotel": 20.0}
FAR_HEIGHT = 9.0
FAR_TONES = {"warehouse": 0.6, "industrial": 0.62, "retail": 0.8, "school": 0.82, "apartments": 0.7}
REGION_CENTRE = (631483.0, 3334446.0)
REGION_SIZE = 44000.0
WOOD_FROM = 1500.0
WOOD_TO = 6500.0
WOOD_COARSE = 2
WOOD_SINK = 2.0
WOOD_TAPER = 0.75
WOOD_RIPPLE = 0.15
WOOD_CROWN = (0.4, 1.6)
WOOD_STRIDE = 12
WOOD_HEIGHT = (9.0, 12.5)
WOOD_RUN = 4
WOOD_SMALLEST = 6
LUM_STEPS = np.linspace(0.08, 0.4, 33)
GREEN_STEPS = np.linspace(-0.04, 0.06, 11)


def fetch(path):
    south, west, north, east = DOWNTOWN
    box = f"({south},{west},{north},{east})"
    region = "({},{},{},{})".format(*REGION)
    query = (
        "[out:json][timeout:300];("
        f'way["building"]["height"]{box};way["building"]["building:levels"]{box};way["building:part"]["height"]{box};'
        f'node["man_made"="water_tower"]{region};'
        'way["power"="line"]({},{},{},{});'.format(*GRID)
        + 'way["building"]({},{},{},{})(if:length()>{});'.format(*FAR, int(FAR_PERIMETER))
        + ");out geom tags;"
    )
    request = urllib.request.Request(OVERPASS, data=urllib.parse.urlencode({"data": query}).encode(), headers={"User-Agent": "track-tools"})
    with urllib.request.urlopen(request, timeout=400) as response:
        data = json.loads(response.read())
    keep = []
    for element in data["elements"]:
        tags = element.get("tags", {})
        if element["type"] == "node":
            keep.append({"type": "node", "id": element["id"], "lat": element["lat"], "lon": element["lon"], "tags": {"man_made": tags.get("man_made")}})
        elif tags.get("power") == "line":
            keep.append({"type": "way", "id": element["id"], "geometry": element["geometry"], "tags": {key: tags[key] for key in ("power", "voltage", "cables") if key in tags}})
        elif height_of(tags) >= LOWEST or far_enough(element):
            names = ("building", "building:part", "height", "building:levels", "min_height", "building:material", "building:colour", "roof:shape", "name")
            keep.append({"type": "way", "id": element["id"], "geometry": element["geometry"], "tags": {key: tags[key] for key in names if key in tags}})
    path.write_text(json.dumps({"elements": keep}, separators=(",", ":")) + "\n")
    print(f"skyline source: {sum(e['type'] == 'way' for e in keep)} buildings, {sum(e['type'] == 'node' for e in keep)} water towers -> {path}")


def far_enough(element):
    south, west, north, east = DOWNTOWN
    lat = np.mean([p["lat"] for p in element["geometry"]])
    lon = np.mean([p["lon"] for p in element["geometry"]])
    if south < lat < north and west < lon < east:
        return False
    points = np.array([[p["lon"], p["lat"]] for p in element["geometry"]])
    metres = (points - points.mean(0)) * np.array([111320.0 * np.cos(np.radians(lat)), 110540.0])
    return float(np.linalg.norm(np.diff(metres, axis=0), axis=1).sum()) > FAR_PERIMETER


def inside_dem(x, y):
    return DEM_ORIGIN[0] < x < DEM_ORIGIN[0] + DEM_SIZE[0] and DEM_ORIGIN[1] - DEM_SIZE[1] < y < DEM_ORIGIN[1]


def region_frame():
    pixels = Image.open(Path(__file__).resolve().parents[2] / "content" / "tracks" / "hill-country" / "source" / "region-aerial.jpg").size[0]
    metres = REGION_SIZE / pixels
    left = REGION_CENTRE[0] - REGION_SIZE / 2
    top = REGION_CENTRE[1] + REGION_SIZE / 2
    return pixels, metres, left, top


def woodland_fit(colour, root, metres, left, top):
    canopy = np.asarray(Image.open(root / "source" / "canopy.png")) > 0
    cell = DEM_SIZE[0] / canopy.shape[1]
    rows, columns = np.mgrid[0 : colour.shape[0], 0 : colour.shape[1]]
    x = left + (columns + 0.5) * metres
    y = top - (rows + 0.5) * metres
    inside = (x > DEM_ORIGIN[0] + metres) & (x < DEM_ORIGIN[0] + DEM_SIZE[0] - metres) & (y < DEM_ORIGIN[1] - metres) & (y > DEM_ORIGIN[1] - DEM_SIZE[1] + metres)
    near_row = ((DEM_ORIGIN[1] - y[inside]) / cell).astype(int).clip(0, canopy.shape[0] - 1)
    near_column = ((x[inside] - DEM_ORIGIN[0]) / cell).astype(int).clip(0, canopy.shape[1] - 1)
    reach = max(1, int(metres / cell / 2))
    share = np.zeros(len(near_row))
    for dr in range(-reach, reach + 1):
        for dc in range(-reach, reach + 1):
            share += canopy[(near_row + dr).clip(0, canopy.shape[0] - 1), (near_column + dc).clip(0, canopy.shape[1] - 1)]
    truth = share / (2 * reach + 1) ** 2 > 0.5
    pixels = colour[inside]
    light = pixels.mean(-1)
    green = pixels[:, 1] - np.maximum(pixels[:, 0], pixels[:, 2])
    best = (-1.0, 0.0, 0.0)
    for dark in LUM_STEPS:
        for leafy in GREEN_STEPS:
            guess = (light < dark) & (green > leafy)
            hit = (guess & truth).sum()
            score = 2 * hit / max(guess.sum() + truth.sum(), 1)
            if score > best[0]:
                best = (score, dark, leafy)
    return best


def woodland_walls(root, osm, near):
    pixels, metres, left, top = region_frame()
    colour = np.asarray(Image.open(Path(__file__).resolve().parents[2] / "content" / "tracks" / "hill-country" / "source" / "region-aerial.jpg").convert("RGB"), np.float32) / 255.0
    score, dark, leafy = woodland_fit(colour, root, metres, left, top)
    wood = (colour.mean(-1) < dark) & (colour[..., 1] - np.maximum(colour[..., 0], colour[..., 2]) > leafy)
    size = wood.shape[0] // WOOD_COARSE * WOOD_COARSE
    wood = wood[:size, :size].reshape(size // WOOD_COARSE, WOOD_COARSE, size // WOOD_COARSE, WOOD_COARSE).mean((1, 3)) > 0.5
    metres *= WOOD_COARSE
    wood = binary_opening(binary_closing(wood), np.ones((2, 2)))
    parts, count = label(wood)
    sizes = np.bincount(parts.ravel())
    wood &= sizes[parts] >= WOOD_SMALLEST
    to_latlon = Transformer.from_crs(32614, 4326, always_xy=True)
    rng = np.random.default_rng(SINK_SEED)
    walls = []

    def emit(x0, y0, x1, y1, rise):
        lon, lat = to_latlon.transform(np.array([x0, (x0 + x1) / 2, x1]), np.array([y0, (y0 + y1) / 2, y1]))
        ends = osm.local(np.stack([lat, lon], 1))
        reach = np.hypot(*ends[1])
        if reach < WOOD_FROM or reach > WOOD_TO or inside_dem((x0 + x1) / 2, (y0 + y1) / 2):
            return
        base = near(ends) - WOOD_SINK
        corners = np.stack([ends[:, 0], base, -ends[:, 1]], 1)
        walls.extend(int(round(float(v))) for v in (*corners.ravel(), *rise))

    def run(start, stop, line, vertical):
        pieces = max(1, int(np.ceil((stop - start) / WOOD_RUN)))
        joints = np.linspace(start, stop, 2 * pieces + 1)
        level = rng.uniform(*WOOD_HEIGHT)
        heights = level * rng.uniform(1 - WOOD_RIPPLE, 1 + WOOD_RIPPLE, len(joints))
        heights[1::2] = (heights[:-1:2] + heights[2::2]) / 2 + rng.uniform(*WOOD_CROWN, pieces)
        heights[0] *= WOOD_TAPER
        heights[-1] *= WOOD_TAPER
        for k in range(0, 2 * pieces, 2):
            a, b = joints[k], joints[k + 2]
            rise = (heights[k], heights[k + 1], heights[k + 2])
            if vertical:
                x = left + (line + 1) * metres
                emit(x, top - a * metres, x, top - b * metres, rise)
            else:
                y = top - (line + 1) * metres
                emit(left + a * metres, y, left + b * metres, y, rise)

    for vertical in (False, True):
        grid = wood.T if vertical else wood
        edges = grid[1:] != grid[:-1]
        for line in range(edges.shape[0]):
            runs = np.flatnonzero(np.diff(np.concatenate([[0], edges[line].astype(int), [0]])))
            for start, stop in zip(runs[::2], runs[1::2]):
                run(start, stop, line, vertical)
    print(f"woodland from the region aerial: light < {dark:.2f}, green > {leafy:.2f}, fit {score:.2f} against the lidar canopy, {len(walls) // WOOD_STRIDE} edge walls")
    return walls


def number(text):
    try:
        return float(str(text).lower().replace("m", "").strip())
    except ValueError:
        return 0.0


def height_of(tags):
    if "height" in tags:
        return number(tags["height"])
    return number(tags.get("building:levels", 0)) * LEVEL


def voltage(tags):
    return max((number(part) for part in str(tags.get("voltage", "0")).split(";")), default=0.0)


def grid_lines(data, osm, near):
    lines = []
    for element in data["elements"]:
        if element["type"] != "way" or element["tags"].get("power") != "line" or voltage(element["tags"]) < GRID_VOLTAGE:
            continue
        points = osm.local([[p["lat"], p["lon"]] for p in element["geometry"]])
        points = points[np.hypot(points[:, 0], points[:, 1]) < GRID_REACH]
        if len(points) < 2:
            continue
        up = near(points)
        lines.append({"points": [round(float(v), 1) for v in np.stack([points[:, 0], up, -points[:, 1]], 1).ravel()], "height": PYLON_HEIGHT})
    return lines


def ground(build):
    far = np.load(build / "horizon.npz")
    points = np.stack([far["x"].ravel(), far["y"].ravel()], 1)
    tree = cKDTree(points)
    heights = far["z"].ravel()

    def at(xy):
        gap, index = tree.query(xy, k=4)
        weight = 1 / np.maximum(gap, 1e-3) ** 2
        return (weight * heights[index]).sum(-1) / weight.sum(-1)

    return at


def tone(element):
    return round(float(np.random.default_rng(element["id"] % (2**32)).random()), 3)


def main():
    root = Path(sys.argv[1])
    build = Path(sys.argv[2])
    source = root / "source" / "skyline.json"
    if "--fetch" in sys.argv or not source.exists():
        fetch(source)
    data = json.loads(source.read_text())
    osm = Osm(root / "source" / "osm.json")
    at = ground(build)
    towers, tanks = [], []
    utm = Transformer.from_crs(4326, 32614, always_xy=True)
    shapes = {}
    for element in data["elements"]:
        if element["type"] == "way" and element["tags"].get("power") != "line":
            shape = Polygon(osm.local([[p["lat"], p["lon"]] for p in element["geometry"]])).buffer(0)
            if shape.area > 0:
                shapes[element["id"]] = shape
    parts = [e for e in data["elements"] if e["type"] == "way" and "building:part" in e["tags"] and e["id"] in shapes]
    split = {
        e["id"]
        for e in data["elements"]
        if e["type"] == "way" and "building:part" not in e["tags"] and e["id"] in shapes and any(shapes[e["id"]].contains(shapes[part["id"]].representative_point()) for part in parts)
    }
    for element in data["elements"]:
        if element["type"] == "way" and (element["id"] in split or element["tags"].get("power") == "line"):
            continue
        if element["type"] == "node":
            [[x, y]] = osm.local([[element["lat"], element["lon"]]])
            if np.hypot(x, y) < TANK_REACH:
                tanks.append({"at": [round(float(x), 1), round(float(-y), 1)], "base": round(float(at(np.array([[x, y]]))[0]) - SINK, 1), "height": TANK_HEIGHT})
            continue
        ring = osm.local([[p["lat"], p["lon"]] for p in element["geometry"]])
        shape = Polygon(ring).simplify(SIMPLEST)
        if not shape.is_valid or shape.area < 60:
            continue
        outline = np.asarray(shape.exterior.coords)[:-1]
        if Polygon(outline).exterior.is_ccw:
            outline = outline[::-1]
        tags = element["tags"]
        under = at(outline)
        far = far_enough(element)
        if far:
            centre = utm.transform(np.mean([p["lon"] for p in element["geometry"]]), np.mean([p["lat"] for p in element["geometry"]]))
            if inside_dem(*centre):
                continue
        height = height_of(tags) or FAR_HEIGHTS.get(tags.get("building", ""), FAR_HEIGHT)
        sink = FAR_SINK if far else SINK
        if height - (under.max() - under.min()) - sink < (height / 2 if far else LOWEST / 2):
            continue
        towers.append(
            {
                "outline": [round(float(v), 1) for v in (outline * np.array([1.0, -1.0])).ravel()],
                "base": round(float(under.min()) - sink, 1),
                "low": round(number(tags.get("min_height", 0)), 1),
                "height": round(height, 1),
                "tone": FAR_TONES.get(tags.get("building", ""), tone(element)) if far else tone(element),
            }
        )
    towers.sort(key=lambda tower: -tower["height"])
    near = Heights(build, Track(root))
    out = {"towers": towers, "tanks": tanks, "lines": grid_lines(data, osm, lambda xy: near(xy) - PYLON_SINK), "woods": woodland_walls(root, osm, near)}
    (root / "skyline.json").write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"skyline: {len(towers)} buildings and parts ({len(split)} buildings split into parts, tallest {towers[0]['height']} m), {len(tanks)} water towers, {len(out['lines'])} power lines with {sum(len(line['points']) // 3 for line in out['lines'])} pylons -> {root / 'skyline.json'}")


if __name__ == "__main__":
    main()
