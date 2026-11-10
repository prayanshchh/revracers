import json
import sys
from pathlib import Path

import numpy as np
from scipy.ndimage import binary_opening, distance_transform_edt, gaussian_filter, map_coordinates
from scipy.spatial import cKDTree
from shapely import contains_xy
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "track"))

from noise import value_noise

STRIDE = 8
SPECIES = ("oak", "elm", "ash", "shrub")
SEED = 20261110


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


def canopy(root, track, rules, rng):
    import aerial

    air = aerial.Aerial(root / "source")
    scale = rules["pixel"]
    red, infrared = air.image[..., 0], air.infrared
    cut = lambda a: a[: a.shape[0] // scale * scale, : a.shape[1] // scale * scale].reshape(a.shape[0] // scale, scale, a.shape[1] // scale, scale).mean((1, 3))
    green = cut((infrared - red) / np.maximum(infrared + red, 1e-3))
    light = cut(air.image.mean(-1))
    mask = (gaussian_filter(green, 1.0) > rules["ndvi"]) & (gaussian_filter(light, 1.5) < rules["luminance"])
    mask = binary_opening(mask, np.ones((3, 3)))
    metres = scale * aerial.METRES_PER_PIXEL
    depth = distance_transform_edt(mask) * metres
    rows, columns = np.nonzero(mask)
    world = air.local(rows * scale + (scale - 1) / 2, columns * scale + (scale - 1) / 2)
    _, _, _, gap = track.locate(world)
    spacing = np.interp(gap, rules["spacingAt"], rules["spacing"])
    cell = np.floor(world / spacing[:, None]).astype(np.int64)
    key = cell[:, 0] * 1000003 + cell[:, 1] + (spacing * 10).astype(np.int64) * 7919
    order = rng.permutation(len(key))
    _, first = np.unique(key[order], return_index=True)
    chosen = order[first]
    crown = depth[rows[chosen], columns[chosen]]
    height = np.clip(rules["heightBase"] + crown * rules["heightPerDepth"], rules["heightMin"], rules["heightMax"])
    height *= np.interp(gap[chosen], rules["spacingAt"], rules["heightScale"])
    return world[chosen] + rng.uniform(-0.4, 0.4, (len(chosen), 2)) * spacing[chosen][:, None], height


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


def thin(points, radius):
    tree = cKDTree(points)
    keep = np.ones(len(points), bool)
    for a, b in tree.query_pairs(radius):
        if keep[a] and keep[b]:
            keep[b] = False
    return keep


def species_of(height, kind, rng, shares):
    roll = rng.random(len(height))
    tall = np.clip((height - shares["tallFrom"]) / (shares["tallTo"] - shares["tallFrom"]), 0, 1)
    elm = roll < shares["elm"] * tall
    ash = ~elm & (roll > 1 - shares["ash"])
    result = np.where(elm, SPECIES.index("elm"), np.where(ash, SPECIES.index("ash"), SPECIES.index("oak")))
    result = np.where(height < shares["shrubBelow"], SPECIES.index("shrub"), result)
    return np.where(kind >= 0, kind, result)


def main():
    root = Path(sys.argv[1])
    build = Path(sys.argv[2])
    config = json.loads((root / "source" / "scenery.json").read_text())["trees"]
    rng = np.random.default_rng(SEED)
    track = Track(root)
    heights = Heights(build, track)
    rules = config["clearance"]
    wild, wild_height = canopy(root, track, config["canopy"], rng) if "canopy" in config else (np.zeros((0, 2)), np.zeros(0))
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
    points, height, kind, art = points[keep], height[keep], kind[keep], art[keep]
    keep = thin(points, rules["spacing"])
    points, height, kind, art = points[keep], height[keep], kind[keep], art[keep]
    species = species_of(height, kind, rng, config["species"])
    up = heights(points) - config.get("sink", 0.15)
    _, _, _, gap = track.locate(points)
    casts = (gap < config["shadowReach"]).astype(np.float32)
    out = np.stack([points[:, 0], points[:, 1], up, height, species, rng.random(len(points)), casts, np.zeros(len(points))], 1).astype(np.float32)
    assert out.shape[1] == STRIDE
    (root / "trees.bin").write_bytes(out.tobytes())
    counts = {name: int((species == i).sum()) for i, name in enumerate(SPECIES)}
    print(
        f"trees {len(out)} ({int(art.sum())} planted, {int((~art).sum())} from the aerial photo, {int(casts.sum())} casting shadows) "
        f"{counts} height {height.min():.1f}..{height.max():.1f} m"
    )


if __name__ == "__main__":
    main()
