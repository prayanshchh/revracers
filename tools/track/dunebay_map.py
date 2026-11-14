import json
import sys
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

from circuit_map import MAJOR_ROADS, MINOR_ROADS, ROUND, TRACK_STRIDE, flat, line, tag_height
from dunebay_geo import Osm

BUILDING_HEIGHT = 8.0
STAND_HEIGHT = 18.0


def frame_points(osm, way):
    return osm.local(way["geometry"]) * np.array([1.0, -1.0])


def classify(osm):
    layers = {"roads": [], "lanes": [], "aisles": [], "parking": [], "water": [], "buildings": []}
    for way in osm.shapes.values():
        tags = way.get("tags", {})
        points = frame_points(osm, way)
        if len(points) < 2:
            continue
        highway = tags.get("highway")
        closed = np.linalg.norm(points[0] - points[-1]) < 0.01 and len(points) >= 4
        if highway in MAJOR_ROADS:
            layers["roads"].append(line(points))
        elif tags.get("service") == "parking_aisle":
            layers["aisles"].append(line(points))
        elif highway in MINOR_ROADS:
            layers["lanes"].append(line(points))
        elif closed and ("building" in tags or tags.get("leisure") == "bleachers"):
            stand = tags.get("building") == "grandstand" or tags.get("leisure") == "bleachers"
            height = tag_height(tags, STAND_HEIGHT if stand else BUILDING_HEIGHT)
            layers["buildings"].append({"height": round(height, 1), "footprint": flat(points[:-1])})
        elif closed and tags.get("amenity") == "parking":
            layers["parking"].append(flat(points[:-1]))
    return layers


SCENERY_REACH = 900.0
SCENERY_CLEAR = 24.0
ARENA = 322578389
TOWER = 1316236404
ARENA_HEIGHT = 68.0
ARENA_SCALE = 1.2
TOWER_FLOORS = 4
MODELLED = (152483596, 1567982803, 1037707301, ARENA, TOWER)
MARQUEES = (1442338650,)
MARQUEE_EAVE = 4.0


def scenery(osm, track):
    centre = np.array([[p["x"], p["z"]] for p in track["centerline"]])
    out = []
    for way in osm.shapes.values():
        tags = way.get("tags", {})
        if "building" not in tags or way["id"] in MODELLED:
            continue
        points = frame_points(osm, way)
        if len(points) < 4 or np.linalg.norm(points[0] - points[-1]) > 0.01:
            continue
        ring = points[:-1]
        gaps = np.sqrt(((ring[:, None, :] - centre[None, ::4, :]) ** 2).sum(-1)).min(1)
        if gaps.min() > SCENERY_REACH or gaps.min() < SCENERY_CLEAR:
            continue
        area = 0.5 * abs(float(np.dot(ring[:, 0], np.roll(ring[:, 1], 1)) - np.dot(ring[:, 1], np.roll(ring[:, 0], 1))))
        carport = tags.get("building") == "carport"
        if way["id"] in MARQUEES:
            out.append({"height": MARQUEE_EAVE, "ring": flat(ring), "kind": "marquee"})
            continue
        fallback = 3.5 if carport else 16.0 if area > 5000 else 12.0 if area > 1500 else BUILDING_HEIGHT
        height = tag_height(tags, fallback)
        out.append({"height": round(height, 1), "ring": flat(ring), **({"kind": "carport"} if carport else {})})
    return out


SERVICE_EVERY = 62.0
SERVICE_BACK = (4.0, 16.0)
SERVICE_CLEAR = 14.0
SERVICE_SEED = 20261114
SERVICE_SETS = (
    ("cabin", "van"),
    ("cabin", "generator", "tower"),
    ("truck", "van"),
    ("container", "container", "cabin"),
    ("cabin", "cabin", "generator"),
    ("van", "tower"),
    ("cabin", "van", "van"),
    ("tower", "cabin"),
    ("cabin",),
    ("cabin", "tower", "van"),
    ("tower",),
    ("cabin", "cabin"),
)


def on_arc(s, start, end, length):
    return (s - start) % length <= (end - start) % length


def service(osm, track, venue):
    rng = np.random.default_rng(SERVICE_SEED)
    length = track["length"]
    points = track["centerline"]
    centre = np.array([[p["x"], p["z"]] for p in points])
    blocked = [
        (stand["from"] - 20, stand["to"] + 20, stand["side"]) for stand in venue["stands"]
    ]
    pit = track["pitLane"]
    pit_side = -1 if pit.get("side") == "right" else 1
    blocked.append((pit["entry"] - 40, pit["exit"] + 60, pit_side))
    rings = [np.array(b["ring"]).reshape(-1, 2) for b in venue["buildings"]]
    out = []
    count = int(length // SERVICE_EVERY)
    for k in range(count):
        at = (k + 0.5) * SERVICE_EVERY + rng.uniform(-25, 25)
        side = 1 if k % 2 == 0 else -1
        if any(on_arc(at, a, b, length) and side == sd for a, b, sd in blocked):
            side = -side
        if any(on_arc(at, a, b, length) and side == sd for a, b, sd in blocked):
            continue
        i = int(at / length * len(points)) % len(points)
        tangent = centre[(i + 1) % len(centre)] - centre[i]
        tangent /= np.linalg.norm(tangent)
        left = np.array([tangent[1], -tangent[0]])
        wall = points[i]["wallLeft" if side > 0 else "wallRight"]
        back = float(rng.uniform(*SERVICE_BACK))
        spot = centre[i] + left * side * (wall + back + 2)
        if any(np.min(np.linalg.norm(r - spot, axis=1)) < SERVICE_CLEAR for r in rings):
            continue
        kinds = list(SERVICE_SETS[int(rng.integers(len(SERVICE_SETS)))])
        out.append({"at": round(at, 1), "side": side, "back": round(back, 1), "kinds": kinds})
    return out


LOT_REACH = 1300.0
LOT_CLEAR = 30.0


def lots(osm, track):
    centre = np.array([[p["x"], p["z"]] for p in track["centerline"]])
    out = []
    for way in osm.shapes.values():
        tags = way.get("tags", {})
        if tags.get("amenity") != "parking" or "building" in tags:
            continue
        points = frame_points(osm, way)
        if len(points) < 4 or np.linalg.norm(points[0] - points[-1]) > 0.01:
            continue
        ring = points[:-1]
        gaps = np.sqrt(((ring[:, None, :] - centre[None, ::4, :]) ** 2).sum(-1)).min(1)
        if gaps.min() > LOT_REACH or gaps.min() < LOT_CLEAR:
            continue
        out.append({"ring": flat(ring)})
    return out


ROAD_WIDTHS = {
    "motorway": 14.0, "motorway_link": 8.0, "trunk": 12.0, "primary": 10.0, "secondary": 9.0, "tertiary": 8.0,
    "residential": 7.0, "unclassified": 7.0, "service": 5.5,
}
ROAD_REACH = 900.0
ROAD_CLEAR = 9.0
ROAD_STEP = 6.0
LAWN_KEYS = (("leisure", "garden"), ("landuse", "grass"), ("landuse", "greenery"))
LAWN_CLEAR = 6.0


def clearance(track):
    centre = np.array([[p["x"], p["z"]] for p in track["centerline"]])
    walls = np.array([max(p["wallLeft"], p["wallRight"]) for p in track["centerline"]])
    tree = cKDTree(centre)

    def gap(points):
        distance, nearest = tree.query(points)
        return distance - walls[nearest]

    return gap, tree


def dense(points, step):
    out = [points[0]]
    for a, b in zip(points, points[1:]):
        count = max(1, int(np.ceil(np.linalg.norm(b - a) / step)))
        out += [a + (b - a) * (k / count) for k in range(1, count + 1)]
    return np.array(out)


def roads(osm, track):
    gap, tree = clearance(track)
    out = []
    for way in osm.shapes.values():
        tags = way.get("tags", {})
        width = ROAD_WIDTHS.get(tags.get("highway"))
        if width is None or tags.get("service") == "parking_aisle" or tags.get("area") == "yes":
            continue
        points = frame_points(osm, way)
        if len(points) < 2:
            continue
        points = dense(points, ROAD_STEP)
        keep = (gap(points) > ROAD_CLEAR + width / 2) & (tree.query(points)[0] < ROAD_REACH)
        run = []
        for point, ok in zip(points, keep):
            if ok:
                run.append(point)
                continue
            if len(run) >= 2:
                out.append({"width": width, "line": flat(run)})
            run = []
        if len(run) >= 2:
            out.append({"width": width, "line": flat(run)})
    return out


def lawns(osm, track):
    gap, tree = clearance(track)
    out = []
    for way in osm.shapes.values():
        tags = way.get("tags", {})
        if not any(tags.get(k) == v for k, v in LAWN_KEYS):
            continue
        points = frame_points(osm, way)
        if len(points) < 4 or np.linalg.norm(points[0] - points[-1]) > 0.01:
            continue
        ring = points[:-1]
        if gap(ring).min() < LAWN_CLEAR or tree.query(ring)[0].min() > ROAD_REACH:
            continue
        out.append({"ring": flat(ring)})
    return out


def landmarks(osm):
    def ring(way_id, scale=1.0):
        points = frame_points(osm, osm.shapes[way_id])[:-1]
        centre = points.mean(axis=0)
        return flat(centre + (points - centre) * scale)

    return {
        "arena": {"ring": ring(ARENA, ARENA_SCALE), "height": ARENA_HEIGHT},
        "tower": {"ring": ring(TOWER), "floors": TOWER_FLOORS},
    }


def main():
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "content/tracks/dune-bay")
    osm = Osm(root / "source" / "osm.json")
    track = json.loads((root / "track.json").read_text())
    points = track["centerline"][::TRACK_STRIDE]
    output = {
        **classify(osm),
        "track": {
            "length": track["length"],
            "points": [v for p in points for v in (round(p["x"], ROUND), round(p["y"], ROUND), round(p["z"], ROUND))],
        },
        "turns": track["turns"],
        "sectors": track["sectors"],
        "straights": track["straights"],
        "speedTrap": track["speedTrap"],
    }
    (root / "circuit-map.json").write_text(json.dumps(output, separators=(",", ":")) + "\n")
    venue_path = root / "venue.json"
    venue = json.loads(venue_path.read_text())
    venue["buildings"] = scenery(osm, track)
    venue["landmarks"] = landmarks(osm)
    venue["service"] = service(osm, track, venue)
    venue["lots"] = lots(osm, track)
    venue["roads"] = roads(osm, track)
    venue["lawns"] = lawns(osm, track)
    venue_path.write_text(json.dumps(venue, indent=1) + "\n")
    print({k: len(v) for k, v in output.items() if isinstance(v, list)})


if __name__ == "__main__":
    main()
