import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import Transformer
from scipy.ndimage import distance_transform_edt, gaussian_filter, map_coordinates, maximum_filter
from scipy.spatial import cKDTree
from shapely import contains_xy
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "track"))

from geo import DEM_ORIGIN, Osm
from noise import value_noise

STRIDE = 8
SPECIES = ("oak", "elm", "ash", "shrub", "palm", "liveoak", "juniper", "mesquite", "cedarelm")
SEED = 20261110
UNMEASURED = 251
TABLE = Path(__file__).resolve().parents[2] / "content" / "scenery" / "trees" / "trees.json"


class Track:
    def __init__(self, root):
        data = json.loads((root / "track.json").read_text())
        line = data["centerline"]
        self.length = data["length"]
        self.points = np.array([[p["x"], -p["z"]] for p in line])
        self.height = np.array([p["y"] for p in line])
        self.width = np.array([p["width"] for p in line])
        self.walls = np.array([[p["wallLeft"], p["wallRight"]] for p in line])
        ahead = np.roll(self.points, -1, 0) - np.roll(self.points, 1, 0)
        tangent = ahead / np.linalg.norm(ahead, axis=1, keepdims=True)
        self.normal = np.stack([-tangent[:, 1], tangent[:, 0]], 1)
        self.rows = cKDTree(self.points)
        self.loop = Polygon(self.points)
        self.step = self.length / len(line)
        pit = data.get("pitLane")
        self.pit = np.array([[p["x"], -p["z"]] for p in pit["centerline"]]) if pit else np.zeros((0, 2))

    def locate(self, xy):
        gap, index = self.rows.query(xy)
        lateral = np.einsum("ij,ij->i", xy - self.points[index], self.normal[index])
        wall = np.where(lateral >= 0, self.walls[index, 0], self.walls[index, 1])
        return index, lateral, np.abs(lateral) - wall, gap

    def side(self, name, index):
        if name in ("left", "right"):
            return np.full(len(index), 1.0 if name == "left" else -1.0)
        probe = self.points[index] + self.normal[index] * 4.0
        within = contains_xy(self.loop, probe[:, 0], probe[:, 1])
        left_is_inside = np.where(within, 1.0, -1.0)
        return left_is_inside if name == "inside" else -left_is_inside

    def at(self, distance, lateral):
        index = np.round(np.asarray(distance) / self.step).astype(int) % len(self.points)
        return self.points[index] + self.normal[index] * np.asarray(lateral)[:, None], index


class Heights:
    def __init__(self, build, track):
        self.track = track
        self.near = np.load(build / "terrain.npz") if (build / "terrain.npz").exists() else None
        self.far = None
        if (build / "horizon.npz").exists():
            far = np.load(build / "horizon.npz")
            self.far = cKDTree(np.stack([far["x"].ravel(), far["y"].ravel()], 1))
            self.far_z = far["z"].ravel()

    def road(self, xy):
        return self.track.height[self.track.rows.query(xy)[1]]

    def beyond(self, xy):
        if self.far is None:
            return self.road(xy)
        gap, index = self.far.query(xy, k=4)
        weight = 1 / np.maximum(gap, 1e-3) ** 2
        return (weight * self.far_z[index]).sum(1) / weight.sum(1)

    def __call__(self, xy):
        if self.near is None:
            return self.beyond(xy)
        x, y, z = self.near["x"], self.near["y"], self.near["heights"]
        column = (xy[:, 0] - x[0]) / (x[1] - x[0])
        row = (xy[:, 1] - y[0]) / (y[1] - y[0])
        inside = (xy[:, 0] > x[0]) & (xy[:, 0] < x[-1]) & (xy[:, 1] > y[0]) & (xy[:, 1] < y[-1])
        return np.where(inside, map_coordinates(z, [row, column], order=1, mode="nearest"), self.beyond(xy))


def blocked_area(root, build, rules):
    layers = json.loads((root / "circuit-map.json").read_text())
    venue = json.loads((build / "venue.json").read_text()) if (build / "venue.json").exists() else None
    ring = lambda flat: np.asarray(flat, float).reshape(-1, 2) * np.array([1.0, -1.0])
    shapes = []
    for building in layers["buildings"]:
        shapes.append(Polygon(ring(building["footprint"])).buffer(rules["building"]))
    for name in ("parking", "water"):
        for flat in layers[name]:
            shapes.append(Polygon(ring(flat)).buffer(rules[name]))
    for name in ("roads", "lanes", "aisles"):
        for flat in layers[name]:
            shapes.append(LineString(ring(flat)).buffer(rules[name]))
    if venue:
        for stand in venue["stands"]:
            shapes.append(Polygon(stand["outline"]).buffer(rules["stand"]))
        for building in venue["buildings"] + [venue["pit"]]:
            shapes.append(Polygon(building["outline"]).buffer(rules["building"]))
        corners = np.array([[-1, -1], [1, -1], [1, 1], [-1, 1]]) * rules["tower"]
        shapes.append(Polygon(np.asarray(venue["tower"]["position"]) + corners))
    return unary_union([shape for shape in shapes if shape.is_valid])


def crowd_points(root):
    path = root / "crowd.bin"
    if not path.exists():
        return None
    people = np.fromfile(path, np.float32).reshape(-1, 8)[:, :2]
    return cKDTree(people.astype(np.float64))


def raster_points(root, rows, columns, cell):
    utm = Transformer.from_crs(32614, 4326, always_xy=True)
    x = DEM_ORIGIN[0] + (np.asarray(columns) + 0.5) * cell
    y = DEM_ORIGIN[1] - (np.asarray(rows) + 0.5) * cell
    lon, lat = utm.transform(x, y)
    return Osm(root / "source" / "osm.json").local(np.stack([lat, lon], 1))


def spaced(points, height, track, rules):
    _, _, _, gap = track.locate(points)
    spacing = np.interp(gap, rules["spacingAt"], rules["spacing"])
    cell = np.floor(points / spacing[:, None]).astype(np.int64)
    key = cell[:, 0] * 1000003 + cell[:, 1] + (spacing * 10).astype(np.int64) * 7919
    order = np.argsort(-height, kind="stable")
    _, first = np.unique(key[order], return_index=True)
    return order[first]


def canopy(root, track, rules, rng):
    raster = np.asarray(Image.open(root / "source" / rules["raster"]), np.uint8)
    cell = rules["cell"]
    tall = np.where(raster < UNMEASURED, raster / 10.0, 0.0)
    measured = tall > 0
    smooth = gaussian_filter(tall, rules["smooth"])
    peaks = measured & (smooth >= maximum_filter(smooth, size=rules["crown"])) & (tall >= rules["heightMin"])
    rows, columns = np.nonzero(peaks)
    top = maximum_filter(tall, size=rules["crown"])[rows, columns]
    depth = distance_transform_edt(measured)[rows, columns] * cell
    slope, base = np.polyfit(np.minimum(depth, rules["depthCap"]), top, 1)
    low, high = rules["growth"]
    measured_height = top * low + high
    guessed = raster == UNMEASURED
    guess_rows, guess_columns = np.nonzero(guessed)
    guess_depth = distance_transform_edt(guessed)[guess_rows, guess_columns] * cell
    guess_height = (base + slope * np.minimum(guess_depth, rules["depthCap"])) * rng.uniform(0.75, 1.25, len(guess_rows)) * low + high
    points = raster_points(root, np.concatenate([rows, guess_rows]), np.concatenate([columns, guess_columns]), cell)
    height = np.clip(np.concatenate([measured_height, guess_height]), rules["heightMin"], rules["heightMax"])
    chosen = spaced(points, height, track, rules)
    jitter = rng.uniform(-0.5, 0.5, (len(chosen), 2)) * cell
    return points[chosen] + jitter, height[chosen], points


def widths(points, height, species, cells, track, rules):
    table = json.loads(TABLE.read_text())["species"]
    spread = np.array([table[name]["spread"] if name in table else 0.5 for name in SPECIES])[species]
    crown = np.pi * (spread * height) ** 2
    _, _, _, gap = track.locate(points)
    reach = np.interp(gap, rules["spacingAt"], rules["spacing"])
    distance, owner = cKDTree(points).query(cells, distance_upper_bound=reach.max())
    found = np.isfinite(distance)
    owner, distance = owner[found], distance[found]
    mine = distance <= reach[owner]
    area = np.bincount(owner[mine], minlength=len(points)) * rules["cell"] ** 2
    return np.clip(np.sqrt(area / crown), 1.0, rules["widest"])


def groves(track, specs, rng):
    points, heights, kinds = [], [], []
    for spec in specs:
        span = (spec["to"] - spec["from"]) % track.length
        depth = spec["far"] - spec["near"]
        count = int(span * depth * spec["density"] / 100)
        distance = spec["from"] + rng.uniform(0, span, count)
        _, index = track.at(distance, np.zeros(count))
        sign = track.side(spec["side"], index)
        wall = np.where(sign > 0, track.walls[index, 0], track.walls[index, 1])
        lateral = sign * (wall + spec["near"] + rng.uniform(0, 1, count) ** spec.get("bias", 1.0) * depth)
        world, _ = track.at(distance, lateral)
        clump = value_noise(world, 1 / spec.get("clump", 35.0), spec.get("seed", 1))
        keep = clump > spec.get("gaps", 0.35)
        low, high = spec["height"]
        points.append(world[keep])
        heights.append(rng.uniform(low, high, keep.sum()) * (0.75 + 0.5 * clump[keep]))
        kinds.append(np.full(keep.sum(), -1 if "species" not in spec else SPECIES.index(spec["species"])))
    if not points:
        return np.zeros((0, 2)), np.zeros(0), np.zeros(0, int)
    return np.concatenate(points), np.concatenate(heights), np.concatenate(kinds)


def cleared(root, track, points, zones):
    index, lateral, beyond, _ = track.locate(points)
    distance = index * track.step
    out = np.zeros(len(points), bool)
    osm = Osm(root / "source" / "osm.json")
    for zone in zones:
        if "osm" in zone:
            way = osm.ways[zone["osm"]]
            ring = osm.local([osm.nodes[node] for node in way["nodes"]])
            area = Polygon(ring).buffer(zone["buffer"])
            out |= contains_xy(area, points[:, 0], points[:, 1])
            continue
        span = (zone["to"] - zone["from"]) % track.length
        along = (distance - zone["from"]) % track.length <= span
        side = {"left": lateral > 0, "right": lateral < 0, "both": np.ones(len(points), bool)}[zone["side"]]
        out |= along & side & (beyond < zone["far"])
    return out


def occupied(root, track, points, rules):
    index, lateral, beyond, _ = track.locate(points)
    distance = index * track.step
    sign = np.sign(lateral)
    margin = rules["occupied"]
    out = np.zeros(len(points), bool)
    shapes = []
    landmarks = root / "landmarks.json"
    if landmarks.exists():
        for item in json.loads(landmarks.read_text()):
            if item["solid"] and len(item["outline"]) > 2:
                shapes.append(Polygon(np.asarray(item["outline"], float) * np.array([1.0, -1.0])).buffer(margin))
    structures = json.loads((root / "structures.json").read_text())
    for stand in structures.get("stands", []):
        front = np.asarray(stand["front"], float)
        back = np.asarray(stand["back"], float) * stand["depth"]
        shapes.append(Polygon(np.array([front[0], front[1], front[1] + back, front[0] + back]) * np.array([1.0, -1.0])).buffer(margin))
    area = unary_union([shape for shape in shapes if shape.is_valid])
    out |= contains_xy(area, points[:, 0], points[:, 1])
    dressing = json.loads((root / "dressing.json").read_text())
    along = lambda spec: (distance - spec["from"] + margin) % track.length <= (spec["to"] - spec["from"]) % track.length + 2 * margin
    for stand in dressing.get("stands", []):
        reach = stand.get("gap", 0) + stand["rows"] * rules["standRow"]
        out |= along(stand) & (sign == stand["side"]) & (beyond > stand.get("gap", 0) - margin) & (beyond < reach + margin)
    for bank in dressing.get("banks", []):
        out |= along(bank) & (sign == bank["side"]) & (beyond > bank["near"] - margin) & (beyond < bank["far"] + margin)
    for zone in dressing.get("clear", []):
        if zone.get("trees"):
            out |= along(zone) & (sign == zone["side"]) & (np.abs(lateral) >= zone["near"]) & (np.abs(lateral) <= zone["far"])
    return out


def thin(points, radius):
    tree = cKDTree(points)
    keep = np.ones(len(points), bool)
    for a, b in tree.query_pairs(radius):
        if keep[a] and keep[b]:
            keep[b] = False
    return keep


def species_of(points, height, kind, rng, rules):
    noise = value_noise(points, 1 / rules["clump"], rules["seed"])
    blend = noise * rules["grouping"] + rng.random(len(points)) * (1 - rules["grouping"])
    roll = np.argsort(np.argsort(blend)) / max(len(points) - 1, 1)
    result = np.zeros(len(points), int)
    for band in reversed(rules["bands"]):
        names = list(band["shares"])
        edges = np.cumsum([band["shares"][name] for name in names])
        pick = np.minimum(np.searchsorted(edges / edges[-1], roll), len(names) - 1)
        chosen = np.array([SPECIES.index(name) for name in names])[pick]
        result = np.where(height < band["below"], chosen, result)
    return np.where(kind >= 0, kind, result)


def main():
    root = Path(sys.argv[1])
    build = Path(sys.argv[2])
    config = json.loads((root / "source" / "scenery.json").read_text())["trees"]
    rng = np.random.default_rng(SEED)
    track = Track(root)
    heights = Heights(build, track)
    rules = config["clearance"]
    wild, wild_height, cells = canopy(root, track, config["canopy"], rng) if "canopy" in config else (np.zeros((0, 2)), np.zeros(0), np.zeros((0, 2)))
    planted, planted_height, planted_kind = groves(track, config.get("groves", []), rng)
    points = np.concatenate([planted, wild])
    height = np.concatenate([planted_height, wild_height])
    kind = np.concatenate([planted_kind, np.full(len(wild), -1)])
    art = np.arange(len(points)) < len(planted)
    _, lateral, beyond, gap = track.locate(points)
    keep = (beyond > rules["wall"] + height * rules["crownShare"]) & (np.abs(points - track.points.mean(0)).max(1) < rules["reach"])
    if len(track.pit):
        keep &= cKDTree(track.pit).query(points)[0] > rules["pit"]
    area = blocked_area(root, build, rules)
    keep &= ~contains_xy(area, points[:, 0], points[:, 1])
    people = crowd_points(root)
    if people is not None:
        keep &= people.query(points)[0] > rules["crowd"]
    keep &= ~cleared(root, track, points, config.get("clear", []))
    keep &= ~occupied(root, track, points, rules)
    points, height, kind, art = points[keep], height[keep], kind[keep], art[keep]
    keep = thin(points, rules["spacing"])
    points, height, kind, art = points[keep], height[keep], kind[keep], art[keep]
    species = species_of(points, height, kind, rng, config["species"])
    up = heights(points) - config.get("sink", 0.15)
    _, _, _, gap = track.locate(points)
    casts = (gap < config["shadowReach"]).astype(np.float32)
    width = widths(points, height, species, cells, track, config["canopy"]) if "canopy" in config else np.ones(len(points))
    out = np.stack([points[:, 0], points[:, 1], up, height, species, rng.random(len(points)), casts, width], 1).astype(np.float32)
    assert out.shape[1] == STRIDE
    (root / "trees.bin").write_bytes(out.tobytes())
    counts = {name: int((species == i).sum()) for i, name in enumerate(SPECIES) if (species == i).any()}
    print(
        f"trees {len(out)} ({int(art.sum())} planted, {int((~art).sum())} from lidar and aerial photos, {int(casts.sum())} casting shadows) "
        f"{counts} height {height.min():.1f}..{height.max():.1f} m, crowns widened {np.mean(width > 1.05) * 100:.0f}% (median {np.median(width):.2f})"
    )


if __name__ == "__main__":
    main()
