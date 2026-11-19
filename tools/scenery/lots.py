import json
import sys
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree
from shapely import contains_xy, distance, points as shapely_points
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parent))

from trees import Heights, Track

STRIDE = 6
KINDS = ("car", "truck", "bus")
SEED = 20261118


def rings(flat_list):
    return [np.asarray(flat, float).reshape(-1, 2) * np.array([1.0, -1.0]) for flat in flat_list]


def along(line, step):
    length = line.length
    if length < step:
        return np.zeros((0, 2)), np.zeros((0, 2))
    distance = np.arange(step / 2, length, step)
    points = np.array([line.interpolate(d).coords[0] for d in distance])
    ahead = np.array([line.interpolate(min(d + 0.5, length)).coords[0] for d in distance])
    behind = np.array([line.interpolate(max(d - 0.5, 0)).coords[0] for d in distance])
    tangent = ahead - behind
    tangent /= np.maximum(np.linalg.norm(tangent, axis=1, keepdims=True), 1e-6)
    return points, tangent


def aisle_rows(lot, aisles, rules):
    points, headings = [], []
    for aisle in aisles:
        inside = aisle.intersection(lot)
        parts = getattr(inside, "geoms", [inside])
        for part in parts:
            if part.geom_type != "LineString" or part.length < rules["bay"]:
                continue
            centre, tangent = along(part, rules["bay"])
            normal = np.stack([-tangent[:, 1], tangent[:, 0]], 1)
            for sign in (-1.0, 1.0):
                for row, reach in enumerate(rules["rows"]):
                    points.append(centre + normal * sign * reach)
                    flip = (sign > 0) == (row % 2 == 0)
                    headings.append(np.arctan2(normal[:, 1], normal[:, 0]) + (0 if flip else np.pi))
    if not points:
        return np.zeros((0, 2)), np.zeros(0)
    return np.concatenate(points), np.concatenate(headings)


def field_rows(lot, rules):
    box = lot.minimum_rotated_rectangle
    corners = np.asarray(box.exterior.coords)[:4]
    edges = np.roll(corners, -1, 0) - corners
    longest = edges[np.argmax(np.linalg.norm(edges, axis=1))]
    axis = longest / np.linalg.norm(longest)
    across = np.array([-axis[1], axis[0]])
    centre = np.asarray(lot.centroid.coords[0])
    reach = np.linalg.norm(edges, axis=1).max()
    lines = []
    for offset in np.arange(-reach, reach, rules["module"]):
        start = centre + across * offset - axis * reach
        lines.append(LineString([start, start + axis * reach * 2]))
    return aisle_rows(lot, lines, rules)


def landmarks(root, margin):
    path = root / "landmarks.json"
    if not path.exists():
        return []
    items = json.loads(path.read_text())
    return [Polygon(np.asarray(item["outline"], float) * np.array([1.0, -1.0])).buffer(margin) for item in items if item["solid"] and len(item["outline"]) > 2]


def blocked(root, layers, rules):
    shapes = landmarks(root, rules["building"]) + [Polygon(ring).buffer(rules["building"]) for ring in rings([b["footprint"] for b in layers["buildings"]]) if len(ring) > 2]
    shapes += [LineString(ring).buffer(rules["road"]) for ring in rings(layers["roads"]) if len(ring) > 1]
    shapes += [LineString(ring).buffer(rules["lane"]) for ring in rings(layers["lanes"]) if len(ring) > 1]
    return unary_union([shape for shape in shapes if shape.is_valid])


def main():
    root = Path(sys.argv[1])
    build = Path(sys.argv[2])
    rules = json.loads((root / "source" / "scenery.json").read_text())["lots"]
    layers = json.loads((root / "circuit-map.json").read_text())
    rng = np.random.default_rng(SEED)
    track = Track(root)
    heights = Heights(build, track)
    aisles = [LineString(ring) for ring in rings(layers["aisles"]) if len(ring) > 1]
    points, headings, lot_of = [], [], []
    for index, ring in enumerate(rings(layers["parking"])):
        lot = Polygon(ring)
        if not lot.is_valid or lot.area < rules["smallest"]:
            continue
        mapped = [aisle for aisle in aisles if aisle.intersects(lot)]
        spots, turns = aisle_rows(lot, mapped, rules) if mapped else field_rows(lot, rules)
        inner = lot.buffer(-rules["edge"])
        keep = contains_xy(inner, spots[:, 0], spots[:, 1]) if len(spots) else np.zeros(0, bool)
        if mapped and len(spots):
            keep &= distance(unary_union(mapped), shapely_points(spots)) > rules["aisleClear"]
        points.append(spots[keep])
        headings.append(turns[keep])
        lot_of.append(np.full(keep.sum(), index))
    points = np.concatenate(points)
    heading = np.concatenate(headings)
    lot_of = np.concatenate(lot_of)
    area = blocked(root, layers, rules)
    keep = ~contains_xy(area, points[:, 0], points[:, 1])
    _, _, beyond, _ = track.locate(points)
    keep &= beyond > rules["wall"]
    keep &= rng.random(len(points)) < rules["fill"]
    points, heading, lot_of = points[keep], heading[keep], lot_of[keep]
    order = np.argsort(rng.random(len(points)))
    tree = cKDTree(points)
    taken = np.zeros(len(points), bool)
    chosen = []
    for i in order:
        if taken[i]:
            continue
        chosen.append(i)
        for j in tree.query_ball_point(points[i], rules["spacing"]):
            taken[j] = True
    chosen = np.array(sorted(chosen))
    points, heading, lot_of = points[chosen], heading[chosen], lot_of[chosen]
    kind = np.where(rng.random(len(points)) < rules["trucks"], 1, 0)
    stadium = track.at(np.array(rules["buses"]["at"]), np.zeros(len(rules["buses"]["at"])))[0]
    near = cKDTree(stadium).query(points)[0]
    candidates = np.unique(lot_of[near < rules["buses"]["reach"]])
    if len(candidates):
        sizes = [(lot_of == lot).sum() for lot in candidates]
        bus_lot = candidates[int(np.argmax(sizes))]
        inside = lot_of == bus_lot
        closest = np.argsort(np.where(inside, near, np.inf))[: rules["buses"]["count"]]
        kind[closest] = 2
    shares = np.array(rules["colours"], float)
    colour = np.searchsorted(np.cumsum(shares) / shares.sum(), rng.random(len(points)))
    colour = np.where(kind == 2, len(shares), colour)
    heading = heading + rng.normal(0, np.radians(rules["jitter"]), len(points))
    up = heights(points) - rules["sink"]
    out = np.stack([points[:, 0], points[:, 1], up, heading, kind, colour], 1).astype(np.float32)
    assert out.shape[1] == STRIDE
    (root / "cars.bin").write_bytes(out.tobytes())
    print(f"cars {len(out)}: {int((kind == 0).sum())} cars, {int((kind == 1).sum())} pickups and SUVs, {int((kind == 2).sum())} school buses in {len(np.unique(lot_of))} lots")


if __name__ == "__main__":
    main()
