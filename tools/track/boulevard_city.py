import json
import re
import sys
from pathlib import Path

import numpy as np
from scipy.ndimage import maximum_filter1d, uniform_filter1d
from scipy.spatial import cKDTree
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import linemerge, unary_union
from shapely.strtree import STRtree

from boulevard_geo import Osm, Terrain

LANDMARKS = frozenset((
    8086330, 27831699, 27858544, 29709970, 114697074, 114977810, 115647489,
    115661793, 135457469, 364846544, 567108265, 976405284, 1198427833,
))
GARAGES = frozenset((33957718,))
LEVEL = 3.4
SMALL_HEIGHT = 6.0
PODIUM_HEIGHT = 16.0
PODIUM_AREA = 6000.0
TRACK_CLEARANCE = 4.0
PADDOCK_DEPTH = 42.0
PADDOCK_ROWS = 60
SIMPLIFY = 0.6
REACH = 2600.0
NEAR = 900.0
FAR_HEIGHT = 40.0
MONORAIL_HEIGHT = 10.5
MONORAIL_DEPTH = 1.7
MONORAIL_CLEAR = 1.6
MONORAIL_ALIGN = 0.85
MONORAIL_EASE = 36.0
MONORAIL_REACH = 45.0
MONORAIL_FAR = 80.0
MONORAIL_STEP = 2.0
MONORAIL_SPACING = 32.0
MONORAIL_SLIDE = 18.0
MONORAIL_FOOT = 2.2
MONORAIL_PAIR = 9.0
MONORAIL_BEAM = 0.9
TREE_SPACING = 16.0
TREE_MEDIAN_GAP = 9.0
BRIDGE_REACH = 30.0
ROUND = 1
GROUND_STEP = 25.0
GROUND_MARGIN = 1500.0
GROUND_SINK = 0.35
GLOBE = (976405284, 78.5, 112.0)
PLAZA = (1198427833, 19.5)
PLAZA_EDGE = 3.0
TOWER = (27831699, 165.0)
BALLOON = (364846544, 46.0)
WHEEL = ("big_wheel", 158.5, 167.6)
STANDS = (
    (6110, 285, -1, 24),
    (300, 470, -1, 14),
    (1440, 1590, -1, 12),
    (1880, 2010, 1, 12),
    (2400, 2560, 1, 14),
    (3720, 3900, -1, 16),
    (4330, 4560, -1, 18),
    (5340, 5500, 1, 14),
    (5880, 6040, -1, 16),
)
TREE_ZONES = (
    (3330, 5120, 0.55, 9.0),
    (2640, 3250, 0.7, 11.0),
    (780, 1550, 0.8, 13.0),
    (2290, 2590, 0.7, 12.0),
    (5330, 5990, 0.75, 11.0),
    (430, 760, 0.9, 12.0),
)
TREE_SETBACK = (3.2, 7.5)
SIGN_ZONE = (3330, 5100)
SIGN_SPACING = 105.0
SIGN_SETBACK = (9.0, 14.0)
SIGN_TURN = 0.6
FRONTAGE_ZONES = ((3330, 5120),)
FRONTAGE_LENGTH = (35.0, 90.0)
FRONTAGE_SETBACK = (13.0, 22.0)
FRONTAGE_DEPTH = (18.0, 34.0)
FRONTAGE_HEIGHT = (9.0, 26.0)
FRONTAGE_TALL = (30.0, 44.0)
FRONTAGE_TALL_SHARE = 0.18
FRONTAGE_GAP_SHARE = 0.12
FRONTAGE_STEP = 8.0
FRONTAGE_TRIES = 6
STAND_ROW_DEPTH = 0.85
STAND_CLEARANCE = 9.0
SEED = 23
ROADS = {"primary", "secondary", "tertiary", "primary_link", "secondary_link", "unclassified", "residential", "motorway", "motorway_link"}


def number(text):
    found = re.findall(r"[\d.]+", str(text or ""))
    try:
        return float(found[0]) if found else None
    except ValueError:
        return None


def height_of(tags, area):
    height = number(tags.get("height"))
    if height:
        return height
    levels = number(tags.get("building:levels"))
    if levels:
        return levels * LEVEL + 2.0
    return PODIUM_HEIGHT if area > PODIUM_AREA else SMALL_HEIGHT


def frame(points):
    return np.asarray(points) * np.array([1.0, -1.0])


def ring_of(osm, geometry):
    local = osm.local(geometry)
    if len(local) < 4:
        return None
    polygon = Polygon(local)
    if not polygon.is_valid:
        polygon = polygon.buffer(0)
    if polygon.is_empty or polygon.geom_type != "Polygon":
        return None
    return polygon.simplify(SIMPLIFY, preserve_topology=True)


def relation_rings(osm, relation):
    lines = [
        LineString(osm.local(m["geometry"]))
        for m in relation.get("members", [])
        if m["type"] == "way" and m.get("role") == "outer" and len(m.get("geometry", [])) >= 2
    ]
    if not lines:
        return []
    merged = linemerge(lines)
    parts = [merged] if merged.geom_type == "LineString" else list(merged.geoms)
    out = []
    for line in parts:
        if line.is_ring and len(line.coords) >= 4:
            polygon = Polygon(line.coords).buffer(0)
            if polygon.geom_type == "Polygon":
                out.append(polygon.simplify(SIMPLIFY, preserve_topology=True))
    return out


def footprints(osm):
    outlines, parts = [], []
    for element in osm.elements:
        tags = element.get("tags", {})
        if "building" not in tags and "building:part" not in tags:
            continue
        if element["id"] in LANDMARKS:
            continue
        if element["type"] == "way" and "geometry" in element:
            polygons = [ring_of(osm, element["geometry"])]
        elif element["type"] == "relation":
            polygons = relation_rings(osm, element)
        else:
            continue
        for polygon in polygons:
            if polygon is None or polygon.area < 20:
                continue
            item = {
                "polygon": polygon,
                "height": height_of(tags, polygon.area),
                "base": number(tags.get("min_height")) or 0.0,
                "tags": tags,
                "id": element["id"],
            }
            (parts if "building:part" in tags else outlines).append(item)
    tree = STRtree([p["polygon"] for p in parts]) if parts else None
    kept = []
    for outline in outlines:
        if tree is not None:
            hits = tree.query(outline["polygon"])
            if any(outline["polygon"].contains(parts[i]["polygon"].representative_point()) for i in hits):
                continue
        kept.append(outline)
    return kept + parts


def kind_of(item):
    tags = item["tags"]
    if tags.get("building") == "parking" or tags.get("amenity") == "parking" or item["id"] in GARAGES:
        return "parking"
    if item["height"] >= 45:
        return "tower"
    if item["polygon"].area > PODIUM_AREA:
        return "podium"
    return "low"


def side_frame(track):
    centre = np.array([[p["x"], -p["z"]] for p in track["centerline"]])
    forward = np.roll(centre, -1, 0) - np.roll(centre, 1, 0)
    forward /= np.linalg.norm(forward, axis=1)[:, None]
    left = np.stack([-forward[:, 1], forward[:, 0]], 1)
    walls = np.array([[p["wallLeft"], p["wallRight"]] for p in track["centerline"]])
    return centre, left, walls


def track_lookup(track):
    centre, left, walls = side_frame(track)
    tree = cKDTree(centre)

    def near(points):
        _, index = tree.query(points)
        lateral = np.einsum("ij,ij->i", points - centre[index], left[index])
        return index, lateral

    return centre, left, walls, near


def densify(line, step):
    out = [line[0]]
    for a, b in zip(line, line[1:]):
        parts = max(1, int(np.ceil(np.linalg.norm(b - a) / step)))
        out += [a + (b - a) * k / parts for k in range(1, parts + 1)]
    return np.array(out)


def monorail_shift(lines, track):
    centre, left, walls, near = track_lookup(track)
    forward = np.stack([left[:, 1], -left[:, 0]], 1)
    count = len(centre)
    window = int(round(MONORAIL_EASE / (track["length"] / count)))
    need = {1: np.zeros(count), -1: np.zeros(count)}
    for line in lines:
        index, lateral = near(line)
        heading = np.gradient(line, axis=0)
        heading /= np.linalg.norm(heading, axis=1)[:, None] + 1e-9
        align = np.abs(np.einsum("ij,ij->i", heading, forward[index]))
        for side in (1, -1):
            wall = walls[index, 0 if side > 0 else 1]
            gap = wall + MONORAIL_CLEAR - lateral * side
            hit = (align > MONORAIL_ALIGN) & (lateral * side >= 0) & (gap > 0)
            np.maximum.at(need[side], index[hit], gap[hit])
    shift = np.zeros(count)
    for side in (1, -1):
        grown = maximum_filter1d(need[side], size=2 * window + 1, mode="wrap")
        shift += side * uniform_filter1d(grown, size=2 * window + 1, mode="wrap")
    moved = []
    for line in lines:
        index, lateral = near(line)
        weight = np.clip((MONORAIL_FAR - np.abs(lateral)) / (MONORAIL_FAR - MONORAIL_REACH), 0, 1)
        moved.append(line + left[index] * (shift[index] * weight)[:, None])
    return moved


def monorail_columns(lines, track, terrain_at):
    _, _, walls, near = track_lookup(track)
    slide = int(MONORAIL_SLIDE / MONORAIL_STEP)
    trees = [cKDTree(line) for line in lines]

    def free(points):
        index, lateral = near(points)
        wall = np.where(lateral >= 0, walls[index, 0], walls[index, 1])
        return np.abs(lateral) > wall + MONORAIL_FOOT

    columns = []
    for k, line in enumerate(lines):
        arc = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(line, axis=0), axis=1))])
        target = MONORAIL_SPACING / 2
        while target < arc[-1]:
            j = int(np.searchsorted(arc, target))
            options = [j + o for o in sorted(range(-slide, slide + 1), key=abs) if 0 <= j + o < len(line)]
            choice = None
            for option in options:
                point = line[option]
                mates = []
                for other, tree in enumerate(trees):
                    if other == k:
                        continue
                    distance, at = tree.query(point)
                    if distance < MONORAIL_PAIR:
                        mates.append(lines[other][at])
                ends = [point] + mates
                centre = np.mean(ends, 0)
                if not free(centre[None]).all():
                    continue
                if any(np.linalg.norm(c[0] - centre) < MONORAIL_SPACING * 0.5 for c in columns):
                    choice = option
                    centre = None
                    break
                ahead = line[min(option + 1, len(line) - 1)] - line[max(option - 1, 0)]
                arm = max(np.linalg.norm(e - centre) for e in ends) * 2 + MONORAIL_BEAM * 2
                columns.append((centre, ahead / (np.linalg.norm(ahead) + 1e-9), float(arm)))
                choice = option
                break
            target = (arc[choice] if choice is not None else target + MONORAIL_STEP * slide) + MONORAIL_SPACING
    points = np.array([c[0] for c in columns]) if columns else np.zeros((0, 2))
    ground = terrain_at(points) if len(points) else np.zeros(0)
    out = []
    for (point, ahead, arm), g in zip(columns, ground):
        heading = float(np.arctan2(-ahead[1], ahead[0]))
        out += [point[0], g, -point[1], g + MONORAIL_HEIGHT - MONORAIL_DEPTH, heading, arm]
    return [round(float(v), 2) for v in out]


def shape_of(osm, way_id):
    element = osm.shapes.get(way_id)
    return None if element is None else ring_of(osm, element["geometry"])


def attraction(osm, kind):
    path = osm.path.parent / "attractions.json"
    if not path.exists():
        return None
    for element in json.loads(path.read_text())["elements"]:
        if element.get("tags", {}).get("attraction") == kind and "geometry" in element:
            polygon = ring_of(osm, element["geometry"])
            if polygon is not None:
                return polygon
    return None


def long_axis(polygon):
    corners = np.array(polygon.minimum_rotated_rectangle.exterior.coords)[:4]
    edges = [corners[(k + 1) % 4] - corners[k] for k in range(2)]
    edge = max(edges, key=np.linalg.norm)
    return float(np.arctan2(-edge[1], edge[0]))


def landmarks(osm, track, terrain_at):
    centre, _, _, _ = track_lookup(track)
    out = {}

    def placed(polygon):
        point = np.array(polygon.centroid.coords[0])
        ground = float(terrain_at(point[None])[0])
        return point, {"x": round(float(point[0]), ROUND), "y": round(ground, ROUND), "z": round(float(-point[1]), ROUND)}

    globe = shape_of(osm, GLOBE[0])
    if globe is not None:
        point, at = placed(globe)
        nearest = centre[int(np.argmin(np.sum((centre - point) ** 2, 1)))]
        toward = nearest - point
        out["globe"] = {**at, "radius": GLOBE[1], "height": GLOBE[2], "facing": round(float(np.arctan2(-toward[1], toward[0])), 3)}
    tower = shape_of(osm, TOWER[0])
    if tower is not None:
        _, at = placed(tower)
        out["tower"] = {**at, "height": TOWER[1], "base": round(float(np.sqrt(tower.area)), 1), "turn": round(long_axis(tower), 3)}
    balloon = shape_of(osm, BALLOON[0])
    if balloon is not None:
        _, at = placed(balloon)
        out["balloon"] = {**at, "height": BALLOON[1]}
    wheel = attraction(osm, WHEEL[0])
    if wheel is not None:
        _, at = placed(wheel)
        out["wheel"] = {**at, "diameter": WHEEL[1], "height": WHEEL[2], "turn": round(long_axis(wheel), 3)}
    return out


def in_stand(distance, side, length):
    for a, b, stand_side, _ in STANDS:
        if stand_side != side:
            continue
        span = (b - a) % length
        if (distance - a) % length <= span + 6:
            return True
    return False


def street_trees(track, footprints_tree, polygons, terrain_at):
    rng = np.random.default_rng(SEED)
    centre, left, walls = side_frame(track)
    length = track["length"]
    count = len(centre)
    out = []
    for begin, end, palm_share, spacing in TREE_ZONES:
        for side in (1, -1):
            d = begin + rng.random() * spacing
            while d < end:
                i = int(d / length * count) % count
                wall = walls[i, 0 if side > 0 else 1]
                lateral = wall + rng.uniform(*TREE_SETBACK)
                point = centre[i] + left[i] * lateral * side
                blocked = in_stand(d, side, length) or any(
                    polygons[k].distance(Point(point)) < 1.5 for k in footprints_tree.query(Point(point).buffer(2))
                )
                if not blocked:
                    kind = 0 if rng.random() < palm_share else 1
                    out.append((point, kind))
                d += spacing * rng.uniform(0.75, 1.25)
    points = np.array([p for p, _ in out]) if out else np.zeros((0, 2))
    ground = terrain_at(points) if len(points) else np.zeros(0)
    return [
        round(float(v), ROUND)
        for (p, kind), g in zip(out, ground)
        for v in (p[0], g, -p[1], kind)
    ]


def paddock_extent(osm, track):
    pit = track["pitLane"]
    length = track["length"]
    polygon = shape_of(osm, PLAZA[0])
    if polygon is None:
        return pit["garageEnd"], PADDOCK_DEPTH - 4, PLAZA[1]
    centre, _, _, near = track_lookup(track)
    ring = np.array(polygon.exterior.coords)
    index, lateral = near(ring)
    s = index * length / len(centre)
    ahead = (s - pit["garageStart"]) % length
    span = (pit["garageEnd"] - pit["garageStart"]) % length
    front = np.abs(lateral - pit["garageFront"]) < PLAZA_EDGE
    beyond = ahead[front & (ahead > span)]
    end = (pit["garageStart"] + (beyond.min() if len(beyond) else span)) % length
    back = lateral[lateral > pit["garageFront"] + PLAZA_EDGE * 3]
    depth = (float(np.median(back)) if len(back) else pit["garageFront"] + PADDOCK_DEPTH - 4) - pit["garageFront"]
    height = number(osm.shapes[PLAZA[0]].get("tags", {}).get("height")) or PLAZA[1]
    return round(float(end), 1), round(depth, 1), round(float(height), 1)


def paddock_strip(track, end):
    centre, left, _ = side_frame(track)
    pit = track["pitLane"]
    length = track["length"]
    span = (end - pit["garageStart"]) % length
    rows = [
        int(((pit["garageStart"] + span * k / PADDOCK_ROWS) % length) / length * len(centre)) % len(centre)
        for k in range(PADDOCK_ROWS + 1)
    ]
    front = [centre[i] + left[i] * pit["garageFront"] for i in rows]
    back = [centre[i] + left[i] * (pit["garageFront"] + PADDOCK_DEPTH) for i in rows]
    return Polygon(front + back[::-1]).buffer(0)


def stand_depth(distance, side, length):
    for a, b, stand_side, rows in STANDS:
        span = (b - a) % length
        if stand_side == side and (distance - a) % length <= span + 6:
            return rows * STAND_ROW_DEPTH + STAND_CLEARANCE
    return 0.0


def frontages(track, footprints_tree, polygons, roads, terrain_at):
    rng = np.random.default_rng(SEED + 2)
    centre, left, walls = side_frame(track)
    length = track["length"]
    count = len(centre)
    index = lambda d: int(d / length * count) % count
    out = []
    for begin, end in FRONTAGE_ZONES:
        for side in (1, -1):
            d = begin
            while d < end:
                span = rng.uniform(*FRONTAGE_LENGTH)
                a, b = d, min(end, d + span)
                d = b + rng.uniform(4, 12)
                if rng.random() < FRONTAGE_GAP_SHARE or b - a < 20:
                    continue
                nearest = rng.uniform(*FRONTAGE_SETBACK) + max(stand_depth(a, side, length), stand_depth(b, side, length))
                depth = rng.uniform(*FRONTAGE_DEPTH)
                stations = [index(x) for x in np.linspace(a, b, 6)]
                polygon = None
                for setback in nearest + FRONTAGE_STEP * np.arange(FRONTAGE_TRIES):
                    front = [centre[i] + left[i] * side * (walls[i, 0 if side > 0 else 1] + setback) for i in stations]
                    back = [centre[i] + left[i] * side * (walls[i, 0 if side > 0 else 1] + setback + depth) for i in stations]
                    candidate = Polygon(front + back[::-1])
                    if not candidate.is_valid or candidate.area < 300 or roads.intersects(candidate):
                        continue
                    if any(polygons[k].intersects(candidate) for k in footprints_tree.query(candidate)):
                        break
                    polygon = candidate
                    break
                if polygon is None:
                    continue
                tall = rng.random() < FRONTAGE_TALL_SHARE
                height = rng.uniform(*(FRONTAGE_TALL if tall else FRONTAGE_HEIGHT))
                ring = np.array(polygon.exterior.coords)[:-1]
                base = float(terrain_at(polygon.representative_point().coords[:1])[0])
                out.append({
                    "kind": "podium",
                    "base": round(base, ROUND),
                    "height": round(height, ROUND),
                    "ring": [round(float(v), ROUND) for v in frame(ring).ravel()],
                })
    return out


def street_signs(track, terrain_at):
    rng = np.random.default_rng(SEED + 1)
    centre, left, walls = side_frame(track)
    length = track["length"]
    count = len(centre)
    out = []
    d = SIGN_ZONE[0] + 40
    side = -1
    while d < SIGN_ZONE[1]:
        if not in_stand(d, side, length):
            i = int(d / length * count) % count
            wall = walls[i, 0 if side > 0 else 1]
            lateral = wall + rng.uniform(*SIGN_SETBACK)
            point = centre[i] + left[i] * lateral * side
            forward = np.array([left[i, 1], -left[i, 0]])
            normal = -left[i] * side * np.cos(SIGN_TURN) - forward * np.sin(SIGN_TURN)
            facing = float(np.arctan2(normal[1], normal[0]))
            ground = float(terrain_at(point[None])[0])
            out.append({
                "x": round(float(point[0]), ROUND),
                "y": round(ground, ROUND),
                "z": round(float(-point[1]), ROUND),
                "facing": round(facing + float(rng.uniform(-0.2, 0.2)), 3),
                "width": round(float(rng.uniform(10, 18)), 1),
                "height": round(float(rng.uniform(9, 18)), 1),
                "lift": round(float(rng.uniform(3, 9)), 1),
                "seed": round(float(rng.random()), 3),
            })
        d += SIGN_SPACING * rng.uniform(0.7, 1.3)
        side = -side
    return out


def build(root):
    osm = Osm(root / "source" / "osm.json")
    terrain = Terrain(root / "source" / "dem.png", osm)
    track = json.loads((root / "track.json").read_text())
    centre = np.array([[p["x"], -p["z"]] for p in track["centerline"]])
    origin_height = float(terrain(np.zeros((1, 2)))[0])
    walls = np.array([max(p["wallLeft"], p["wallRight"]) for p in track["centerline"]])
    plaza_end, plaza_depth, plaza_height = paddock_extent(osm, track)
    paddock = paddock_strip(track, plaza_end)
    corridor = unary_union(
        [Point(c).buffer(w + TRACK_CLEARANCE, 8) for c, w in zip(centre[::3], walls[::3])] + [paddock]
    )
    middle = centre.mean(0)
    buildings = []
    for item in footprints(osm):
        polygon = item["polygon"]
        distance = Point(middle).distance(polygon)
        if distance > REACH:
            continue
        if distance > NEAR and item["height"] < FAR_HEIGHT:
            continue
        if polygon.intersects(corridor):
            polygon = polygon.difference(corridor)
            if polygon.is_empty:
                continue
            if polygon.geom_type == "MultiPolygon":
                polygon = max(polygon.geoms, key=lambda g: g.area)
            if polygon.area < 40:
                continue
        ring = np.array(polygon.exterior.coords)[:-1]
        base = float(terrain(polygon.representative_point().coords[:1])[0]) - origin_height
        buildings.append({
            "kind": kind_of(item),
            "base": round(base + item["base"], ROUND),
            "height": round(item["height"] - item["base"], ROUND),
            "ring": [round(float(v), ROUND) for v in frame(ring).ravel()],
        })
    rails = monorail_shift([densify(osm.local(way["geometry"]), MONORAIL_STEP) for way in osm.tagged("railway", "monorail")], track)
    monorail = []
    for line in rails:
        kept = np.array(LineString(line).simplify(0.15).coords)
        ground = terrain(kept) - origin_height
        monorail.append([round(float(v), ROUND) for p, g in zip(frame(kept), ground) for v in (p[0], g + MONORAIL_HEIGHT, p[1])])
    rail_columns = monorail_columns(rails, track, lambda points: terrain(points) - origin_height)
    trees = []
    for element in osm.elements:
        if element["type"] == "node" and element.get("tags", {}).get("natural") == "tree":
            p = osm.local([[element["lat"], element["lon"]]])[0]
            if Point(p).distance(Point(middle)) < NEAR and not corridor.contains(Point(p)):
                trees.append(p)
    for way in osm.tagged("natural", "tree_row"):
        line = LineString(osm.local(way["geometry"]))
        for d in np.arange(0, line.length, TREE_SPACING):
            p = np.array(line.interpolate(d).coords[0])
            if not corridor.contains(Point(p)):
                trees.append(p)
    trees = np.array(trees) if trees else np.zeros((0, 2))
    tree_ground = terrain(trees) - origin_height if len(trees) else np.zeros(0)
    roads = []
    track_line = LineString(centre)
    for way in osm.shapes.values():
        tags = way.get("tags", {})
        if tags.get("highway") not in ROADS or tags.get("area") == "yes":
            continue
        line = osm.local(way["geometry"])
        if Point(line.mean(0)).distance(Point(middle)) > REACH:
            continue
        lanes = number(tags.get("lanes")) or (2 if tags.get("oneway") == "yes" else 4)
        roads.append({
            "width": round(min(lanes, 7) * 3.5, 1),
            "line": [round(float(v), ROUND) for v in frame(line).ravel()],
        })
    bridges = []
    for way in osm.shapes.values():
        tags = way.get("tags", {})
        if tags.get("bridge") not in ("yes", "viaduct") or tags.get("highway") not in ("footway", "pedestrian", "steps", "corridor"):
            continue
        line = LineString(osm.local(way["geometry"]))
        if not line.intersects(track_line):
            continue
        cross = line.intersection(track_line)
        point = np.array(cross.coords[0] if cross.geom_type == "Point" else cross.geoms[0].coords[0])
        index = int(np.argmin(np.sum((centre - point) ** 2, 1)))
        bridges.append({"distance": round(index * track["length"] / len(centre), 1)})
    water = []
    for way in osm.tagged("natural", "water"):
        polygon = ring_of(osm, way["geometry"])
        if polygon is None or Point(middle).distance(polygon) > NEAR or polygon.area < 200:
            continue
        ring = np.array(polygon.exterior.coords)[:-1]
        water.append([round(float(v), ROUND) for v in frame(ring).ravel()])
    polygons = [Polygon(np.array(b["ring"]).reshape(-1, 2) * np.array([1.0, -1.0])) for b in buildings]
    footprints_tree = STRtree(polygons)
    terrain_at = lambda points: terrain(points) - origin_height
    crossing = unary_union([
        LineString(np.array(r["line"]).reshape(-1, 2) * np.array([1.0, -1.0])).buffer(r["width"] / 2 + 3)
        for r in roads
    ]).difference(corridor)
    added = frontages(track, footprints_tree, polygons, crossing.union(paddock), terrain_at)
    buildings += added
    polygons = [Polygon(np.array(b["ring"]).reshape(-1, 2) * np.array([1.0, -1.0])) for b in buildings]
    footprints_tree = STRtree(polygons)
    planted = street_trees(track, footprints_tree, polygons, terrain_at)
    signs = street_signs(track, terrain_at)
    low = centre.min(0) - GROUND_MARGIN
    high = centre.max(0) + GROUND_MARGIN
    columns = int(np.ceil((high[0] - low[0]) / GROUND_STEP)) + 1
    rows = int(np.ceil((high[1] - low[1]) / GROUND_STEP)) + 1
    gx, gy = np.meshgrid(low[0] + np.arange(columns) * GROUND_STEP, low[1] + np.arange(rows) * GROUND_STEP)
    grid = np.stack([gx.ravel(), gy.ravel()], 1)
    heights = terrain(grid) - origin_height
    track_heights = np.array([p["y"] for p in track["centerline"]])
    tree_of_track = STRtree([Point(c) for c in centre[::4]])
    for k, point in enumerate(grid):
        nearest = tree_of_track.nearest(Point(point))
        d = Point(point).distance(Point(centre[nearest * 4]))
        if d < walls[nearest * 4] + GROUND_STEP:
            heights[k] = min(heights[k], track_heights[nearest * 4] - GROUND_SINK)
    city = {
        "ground": {
            "x": round(float(low[0]), 1),
            "z": round(float(-low[1]), 1),
            "step": GROUND_STEP,
            "columns": columns,
            "rows": rows,
            "heights": [round(float(h), 2) for h in heights],
        },
        "buildings": buildings,
        "monorail": monorail,
        "monorailColumns": rail_columns,
        "landmarks": landmarks(osm, track, lambda points: terrain(points) - origin_height),
        "trees": [round(float(v), ROUND) for p, g in zip(frame(trees), tree_ground) for v in (p[0], g, p[1])],
        "roads": roads,
        "bridges": sorted(bridges, key=lambda b: b["distance"]),
        "water": water,
        "streetTrees": planted,
        "signs": signs,
        "venue": {
            "stands": [{"from": a, "to": b, "side": side, "rows": rows} for a, b, side, rows in STANDS],
            "paddock": {
                "from": track["pitLane"]["garageStart"],
                "to": track["pitLane"]["garageEnd"],
                "front": track["pitLane"]["garageFront"],
                "bay": track["pitLane"]["baySpacing"],
                "end": plaza_end,
                "depth": plaza_depth,
                "height": plaza_height,
            },
        },
    }
    return city


MAP_SIMPLIFY = 1.5
MAP_ROADS = {"primary", "secondary", "motorway", "trunk"}
MAP_LANES = {"tertiary", "primary_link", "secondary_link", "motorway_link", "unclassified"}
MAP_REACH = 1400.0


def circuit_map(root):
    osm = Osm(root / "source" / "osm.json")
    track = json.loads((root / "track.json").read_text())
    centre = np.array([[p["x"], -p["z"]] for p in track["centerline"]])
    middle = Point(centre.mean(0))
    layers = {"roads": [], "lanes": [], "aisles": [], "parking": [], "water": [], "buildings": []}
    flat = lambda points: [round(float(v), ROUND) for p in frame(points) for v in p]
    for way in osm.shapes.values():
        tags = way.get("tags", {})
        points = osm.local(way["geometry"])
        if len(points) < 2 or middle.distance(Point(points.mean(0))) > MAP_REACH:
            continue
        highway = tags.get("highway")
        if highway in MAP_ROADS:
            layers["roads"].append(flat(LineString(points).simplify(MAP_SIMPLIFY).coords))
        elif highway in MAP_LANES:
            layers["lanes"].append(flat(LineString(points).simplify(MAP_SIMPLIFY).coords))
        elif highway in ROADS or tags.get("service") == "parking_aisle":
            layers["aisles"].append(flat(LineString(points).simplify(MAP_SIMPLIFY).coords))
        elif way["geometry"][0] == way["geometry"][-1] and len(points) >= 4:
            ring = points[:-1]
            if "building" in tags and way["id"] not in LANDMARKS:
                polygon = Polygon(ring)
                layers["buildings"].append({"height": round(height_of(tags, polygon.area), 1), "footprint": flat(ring)})
            elif tags.get("amenity") == "parking":
                layers["parking"].append(flat(ring))
            elif tags.get("natural") == "water":
                layers["water"].append(flat(ring))
    points = track["centerline"][::2]
    return {
        **layers,
        "track": {
            "length": track["length"],
            "points": [v for p in points for v in (round(p["x"], 4), round(p["y"], 4), round(p["z"], 4))],
        },
        "turns": track["turns"],
        "sectors": track["sectors"],
        "straights": track["straights"],
        "speedTrap": track["speedTrap"],
    }


def main():
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "content/tracks/neon-boulevard")
    city = build(root)
    (root / "city.json").write_text(json.dumps(city, separators=(",", ":")) + "\n")
    (root / "circuit-map.json").write_text(json.dumps(circuit_map(root), separators=(",", ":")) + "\n")
    kinds = {}
    for b in city["buildings"]:
        kinds[b["kind"]] = kinds.get(b["kind"], 0) + 1
    print(
        f"{len(city['buildings'])} buildings {kinds}, {len(city['monorail'])} monorail lines, "
        f"{len(city['trees']) // 3} trees, {len(city['roads'])} roads, bridges {city['bridges']}, {len(city['water'])} ponds"
    )


if __name__ == "__main__":
    main()
