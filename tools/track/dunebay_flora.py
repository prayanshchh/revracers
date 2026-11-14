import json
import sys
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree
from shapely import contains_xy
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union

from dunebay_geo import Osm

SEED = 20261114
STRIDE = 8
SPECIES = ("oak", "elm", "ash", "shrub", "palm")
PALM_SPACING = 8.5
PALM_HEIGHT = (6.5, 10.5)
GARDEN_AREA = 45.0
GARDEN_HEIGHT = (1.4, 3.2)
SCRUB_AREA = 9000.0
SCRUB_REACH = 650.0
SCRUB_HEIGHT = (0.7, 1.7)
WALL_CLEAR = 5.0
PIT_CLEAR = 45.0
BUILDING_CLEAR = 3.0
ROAD_CLEAR = 4.5
THIN = 2.2
GARDENS = {("leisure", "garden"), ("landuse", "greenery"), ("landuse", "grass"), ("natural", "shrubbery")}
ROADS = {"motorway", "motorway_link", "trunk", "primary", "secondary", "tertiary", "unclassified", "service", "residential"}


def frame_points(osm, way):
    return osm.local(way["geometry"]) * np.array([1.0, -1.0])


def closed(points):
    return len(points) >= 4 and np.linalg.norm(points[0] - points[-1]) < 0.01


VERGE_ROAD_CLEAR = 1.8


def shapes(osm):
    rows, gardens, blocked, lanes = [], [], [], []
    for way in osm.shapes.values():
        tags = way.get("tags", {})
        points = frame_points(osm, way)
        if len(points) < 2:
            continue
        if tags.get("natural") == "tree_row":
            rows.append(LineString(points))
        elif closed(points) and any(tags.get(k) == v for k, v in GARDENS):
            gardens.append(Polygon(points).buffer(0))
        elif closed(points) and ("building" in tags or tags.get("amenity") == "parking"):
            blocked.append(Polygon(points).buffer(BUILDING_CLEAR))
        elif tags.get("highway") in ROADS:
            blocked.append(LineString(points).buffer(ROAD_CLEAR))
            lanes.append(LineString(points).buffer(VERGE_ROAD_CLEAR))
    return rows, gardens, unary_union(blocked), unary_union(lanes)


def along(rows, rng):
    out = []
    for row in rows:
        count = max(1, int(row.length / PALM_SPACING))
        for k in range(count):
            p = row.interpolate((k + 0.5 + rng.uniform(-0.15, 0.15)) * row.length / count)
            out.append((p.x, p.y))
    return np.array(out).reshape(-1, 2)


def scattered(polygon, per_area, rng):
    count = rng.poisson(polygon.area / per_area)
    if count == 0:
        return np.zeros((0, 2))
    x0, z0, x1, z1 = polygon.bounds
    points = np.stack([rng.uniform(x0, x1, count * 3), rng.uniform(z0, z1, count * 3)], 1)
    inside = contains_xy(polygon, points[:, 0], points[:, 1])
    return points[inside][:count]


def clear_of_track(points, track):
    centre = np.array([[p["x"], p["z"]] for p in track["centerline"]])
    left_wall = np.array([p["wallLeft"] for p in track["centerline"]])
    right_wall = np.array([p["wallRight"] for p in track["centerline"]])
    tangent = np.roll(centre, -1, axis=0) - centre
    tangent /= np.linalg.norm(tangent, axis=1)[:, None]
    left = np.stack([tangent[:, 1], -tangent[:, 0]], 1)
    gap, nearest = cKDTree(centre).query(points)
    lateral = np.einsum("ij,ij->i", points - centre[nearest], left[nearest])
    walls = np.where(lateral > 0, left_wall[nearest], right_wall[nearest])
    keep = np.abs(lateral) > walls + WALL_CLEAR
    pit = np.array([[p["x"], p["z"]] for p in track["pitLane"]["centerline"]])
    keep &= cKDTree(pit).query(points)[0] > PIT_CLEAR
    return keep, gap


def thin(points):
    keep = np.ones(len(points), bool)
    for a, b in cKDTree(points).query_pairs(THIN):
        if keep[a] and keep[b]:
            keep[b] = False
    return keep


ARENA_COLUMNS = 448
ARENA_SMOOTHING = 3
ARENA_DECK = 1.09
GARDEN_ROWS = (6.0, 14.0, 27.0, 37.0, 53.0, 63.0)
GARDEN_ROW_EVERY = 10.0
MEDALLION_EVERY = 92.0
MEDALLION_AT = 45.0
MEDALLION_RING = 11.6
MEDALLION_PALMS = 12


def arena_ring(venue):
    arena = venue.get("landmarks", {}).get("arena")
    if not arena:
        return None
    ring = np.array(arena["ring"]).reshape(-1, 2)
    area = 0.5 * (ring[:, 0] * np.roll(ring[:, 1], -1) - np.roll(ring[:, 0], -1) * ring[:, 1]).sum()
    if area < 0:
        ring = ring[::-1]
    closed = np.vstack([ring, ring[:1]])
    lengths = np.linalg.norm(np.diff(closed, axis=0), axis=1)
    walked = np.concatenate([[0], np.cumsum(lengths)])
    goals = np.arange(ARENA_COLUMNS) * walked[-1] / ARENA_COLUMNS
    points = np.stack([np.interp(goals, walked, closed[:, k]) for k in range(2)], 1)
    for _ in range(ARENA_SMOOTHING):
        points = (2 * points + np.roll(points, 1, 0) + np.roll(points, -1, 0)) / 4
    a = points[:, 0] * np.roll(points[:, 1], -1) - np.roll(points[:, 0], -1) * points[:, 1]
    centre = np.array([((points[:, 0] + np.roll(points[:, 0], -1)) * a).sum(), ((points[:, 1] + np.roll(points[:, 1], -1)) * a).sum()]) / (3 * a.sum())
    return points, centre


def garden_point(points, centre, along, outward, perimeter, radius):
    k = along / perimeter * ARENA_COLUMNS
    i = int(np.floor(k)) % ARENA_COLUMNS
    t = k - np.floor(k)
    rim = points[i] * (1 - t) + points[(i + 1) % ARENA_COLUMNS] * t
    share = ARENA_DECK + outward / radius
    return centre + (rim - centre) * share


def plaza_palms(venue):
    found = arena_ring(venue)
    if found is None:
        return np.zeros((0, 2))
    points, centre = found
    radius = np.linalg.norm(points - centre, axis=1).mean()
    perimeter = np.linalg.norm(np.roll(points, -1, 0) - points, axis=1).sum() * ARENA_DECK
    out = []
    for outward in GARDEN_ROWS:
        for along in np.arange(GARDEN_ROW_EVERY / 2, perimeter, GARDEN_ROW_EVERY):
            out.append(garden_point(points, centre, along, outward, perimeter, radius))
    for along in np.arange(MEDALLION_EVERY, perimeter, MEDALLION_EVERY):
        middle = garden_point(points, centre, along, MEDALLION_AT, perimeter, radius)
        for k in range(MEDALLION_PALMS):
            angle = 2 * np.pi * k / MEDALLION_PALMS
            out.append(middle + MEDALLION_RING * np.array([np.cos(angle), np.sin(angle)]))
    return np.array(out).reshape(-1, 2)


VERGE_EVERY = 15.0
VERGE_BACK = (5.6, 8.2)
VERGE_KEEP = 0.72
VERGE_HEIGHT = (4.2, 6.4)
VERGE_CLEAR = 18.0


def on_arc(s, start, end, length):
    return (s - start) % length <= (end - start) % length


def verge_trees(track, venue, rng):
    length = track["length"]
    points = track["centerline"]
    centre = np.array([[p["x"], p["z"]] for p in points])
    blocked = [(stand["from"] - 20, stand["to"] + 20, stand["side"]) for stand in venue["stands"]]
    pit = track["pitLane"]
    blocked.append((pit["entry"] - 40, pit["exit"] + 60, -1 if pit.get("side") == "right" else 1))
    service = [(c["at"] - 5, c["at"] + 9 * len(c["kinds"]), c["side"]) for c in venue.get("service", [])]
    out = []
    for k in range(int(length // VERGE_EVERY)):
        at = k * VERGE_EVERY
        i = int(at / length * len(points)) % len(points)
        tangent = centre[(i + 1) % len(centre)] - centre[i]
        tangent /= np.linalg.norm(tangent)
        left = np.array([tangent[1], -tangent[0]])
        for side in (1, -1):
            if rng.random() > VERGE_KEEP:
                continue
            if any(on_arc(at, a, b, length) and side == sd for a, b, sd in blocked + service):
                continue
            wall = points[i]["wallLeft" if side > 0 else "wallRight"]
            out.append(centre[i] + left * side * (wall + rng.uniform(*VERGE_BACK)))
    return np.array(out).reshape(-1, 2)


def flora(osm, track, venue, rng):
    rows, gardens, blocked, lanes = shapes(osm)
    centre = np.array([[p["x"], p["z"]] for p in track["centerline"]])
    reach = LineString(np.vstack([centre, centre[:1]])).buffer(SCRUB_REACH)
    palms = np.vstack([along(rows, rng), plaza_palms(venue)])
    shrubs = np.vstack([scattered(g, GARDEN_AREA, rng) for g in gardens] or [np.zeros((0, 2))])
    scrub = scattered(reach, SCRUB_AREA, rng)
    verge = verge_trees(track, venue, rng)
    points = np.vstack([palms, shrubs, scrub, verge])
    kind = np.concatenate([np.full(len(palms), SPECIES.index("palm")), np.full(len(shrubs) + len(scrub) + len(verge), SPECIES.index("shrub"))])
    sizes = ((palms, PALM_HEIGHT), (shrubs, GARDEN_HEIGHT), (scrub, SCRUB_HEIGHT), (verge, VERGE_HEIGHT))
    low = np.concatenate([np.full(len(group), size[0]) for group, size in sizes])
    high = np.concatenate([np.full(len(group), size[1]) for group, size in sizes])
    keep, _ = clear_of_track(points, track)
    lined = np.arange(len(points)) >= len(points) - len(verge)
    exempt = (kind == SPECIES.index("palm")) | lined
    keep &= ~contains_xy(blocked, points[:, 0], points[:, 1]) | exempt
    keep &= ~(lined & contains_xy(lanes, points[:, 0], points[:, 1]))
    points, kind, low, high = points[keep], kind[keep], low[keep], high[keep]
    keep = thin(points)
    points, kind, low, high = points[keep], kind[keep], low[keep], high[keep]
    height = low + (high - low) * rng.random(len(points))
    zeros = np.zeros(len(points))
    out = np.stack([points[:, 0], -points[:, 1], zeros - 0.1, height, kind, rng.random(len(points)), zeros, zeros], 1)
    return out.astype(np.float32), {name: int((kind == i).sum()) for i, name in enumerate(SPECIES) if (kind == i).any()}


def main():
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "content/tracks/dune-bay")
    osm = Osm(root / "source" / "osm.json")
    track = json.loads((root / "track.json").read_text())
    venue = json.loads((root / "venue.json").read_text())
    out, counts = flora(osm, track, venue, np.random.default_rng(SEED))
    assert out.shape[1] == STRIDE
    (root / "trees.bin").write_bytes(out.tobytes())
    print(f"flora {len(out)} {counts}")


if __name__ == "__main__":
    main()
