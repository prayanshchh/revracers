import json
import math

import numpy as np

from landmark_mesh import UP, srgb

EARTH_RADIUS = 6378137.0
TIMING_LINE = 13826373967
STYLES = {
    "media": {"wall": "#b9b4a6", "trim": "#e6e7e4", "roof": "#c9cac7", "bands": True, "plant": 6, "parapet": 0.9},
    "office": {"wall": "#d9dbd8", "trim": "#f0f0ed", "roof": "#b7b8b5", "bands": True, "plant": 2, "parapet": 0.7},
    "medical": {"wall": "#e4e5e2", "trim": "#c23a33", "roof": "#bcbdba", "bands": True, "plant": 2, "parapet": 0.6},
    "hall": {"wall": "#d6d8d6", "trim": "#eeeeea", "roof": "#e9eae7", "bands": False, "plant": 2, "parapet": 0.5},
    "shed": {"wall": "#c4c7c9", "trim": "#9da2a6", "roof": "#dfe1e1", "bands": False, "plant": 0, "parapet": 0.0, "pitch": 1.2},
    "concession": {"wall": "#cbbfa8", "trim": "#7a2d2a", "roof": "#d3d1cb", "bands": True, "plant": 1, "parapet": 0.4},
    "pavilion": {"wall": "#ece9e1", "trim": "#2c4d7a", "roof": "#f2f2ef", "bands": True, "plant": 0, "parapet": 0.3, "eave": 1.6},
    "timber": {"wall": "#8e6240", "trim": "#5a3c27", "roof": "#3f2d22", "bands": False, "plant": 0, "parapet": 0.0, "pitch": 2.6},
    "dining": {"wall": "#3b3f45", "trim": "#c9a646", "roof": "#cfcfcb", "bands": True, "plant": 2, "parapet": 0.8, "eave": 2.4},
    "station": {"wall": "#e9e9e6", "trim": "#151517", "roof": "#b8222b", "bands": True, "plant": 0, "parapet": 0.6},
}
BUILDINGS = {
    460658887: ("office", 7.6),
    460658886: ("medical", 4.0),
    460683362: ("hall", 6.6),
    460683363: ("hall", 6.6),
    820304942: ("hall", 6.3),
    1216518884: ("concession", 4.2),
    1216518885: ("concession", 4.2),
    820304940: ("concession", 4.2),
    1216518886: ("concession", 3.6),
    1216518887: ("hall", 6.0),
    847730369: ("pavilion", 3.6),
    998801550: ("pavilion", 3.4),
    847784654: ("pavilion", 3.4),
    998803425: ("pavilion", 3.4),
    1183793496: ("hall", 9.0),
    1183793499: ("shed", 7.0),
    1183793502: ("shed", 6.0),
    1183793501: ("shed", 4.0),
    820304944: ("shed", 5.0),
    847709729: ("shed", 4.4),
    1227207779: ("hall", 5.0),
    1227207781: ("office", 3.4),
    847728917: ("pavilion", 3.0),
    847728920: ("pavilion", 3.0),
    884805721: ("office", 4.4),
    847709730: ("office", 3.2),
    1528618067: ("station", 6.0),
    1528618072: ("timber", 6.0),
    1528624093: ("station", 7.0),
}
CLEARED = (376713393, 847781223, 1183793498)
MEDIA = 376713392
MEDIA_CUT = (5420.0, 69.0)
MEDIA_HEIGHT = 7.8
MEDIA_WING = 5.6
DINING = ((-94.3, 183.3), (-84.7, 162.0), (-161.1, 127.7), (-170.7, 149.0))
GARAGE = ((263.5, 640.0), 145.0, 100.0, 58.0, 6)
GARAGE_TIER = 3.0
BAND = (1.3, 2.7)
STOREY = 3.6
SKIRT = 0.6
PLANT_SEED = 7
GLASS = srgb("#232b33")
PLANT = srgb("#a9adb0")


def outlines(root):
    data = json.loads((root / "source" / "osm.json").read_text())
    nodes = {e["id"]: (e["lat"], e["lon"]) for e in data["elements"] if e["type"] == "node"}
    lat0, lon0 = nodes[TIMING_LINE]

    def local(node):
        lat, lon = nodes[node]
        return (math.radians(lon - lon0) * math.cos(math.radians(lat0)) * EARTH_RADIUS, math.radians(lat - lat0) * EARTH_RADIUS)

    ways = {e["id"]: e for e in data["elements"] if e["type"] == "way"}
    found = {}
    for way in (*BUILDINGS, *CLEARED, MEDIA):
        points = [local(n) for n in ways[way]["nodes"][:-1]]
        area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(points, points[1:] + points[:1])) / 2
        found[way] = points if area > 0 else points[::-1]
    return found


def walls(part, ring, low, high, colour):
    for a, b in zip(ring, ring[1:] + ring[:1]):
        part.poly([np.array([*a, low]), np.array([*b, low]), np.array([*b, high]), np.array([*a, high])], colour)


def bands(glass, ring, floor, height):
    for a, b in zip(ring, ring[1:] + ring[:1]):
        a, b = np.asarray(a), np.asarray(b)
        length = np.linalg.norm(b - a)
        if length < 4.0:
            continue
        along = (b - a) / length
        out = np.array([along[1], -along[0]]) * 0.04
        for z in np.arange(0.0, height - BAND[1] + 0.2, STOREY):
            p, q = a + along * 0.8 + out, b - along * 0.8 + out
            glass.poly([np.array([*p, floor + z + BAND[0]]), np.array([*q, floor + z + BAND[0]]), np.array([*q, floor + z + BAND[1]]), np.array([*p, floor + z + BAND[1]])], GLASS)


def building(parts, ground, style, height, ring, rng, label):
    look = STYLES[style]
    paint, glass = parts("buildings", "paint"), parts("buildings", "glass")
    floors = [ground(x, y) for x, y in ring]
    floors = [z for z in floors if z is not None]
    if not floors:
        return
    floor, low = max(floors), min(floors) - SKIRT
    wall, trim, roof = srgb(look["wall"]), srgb(look["trim"]), srgb(look["roof"])
    walls(paint, ring, low, floor + height, wall)
    parapet = look["parapet"]
    if parapet:
        walls(paint, ring, floor + height, floor + height + parapet, trim)
    pitch = look.get("pitch", 0.0)
    centre = np.mean(np.asarray(ring), axis=0)
    if pitch:
        apex = np.array([*centre, floor + height + pitch])
        for a, b in zip(ring, ring[1:] + ring[:1]):
            paint.poly([np.array([*a, floor + height]), np.array([*b, floor + height]), apex], roof)
    else:
        paint.poly([np.array([x, y, floor + height + 0.05]) for x, y in ring], roof)
    eave = look.get("eave", 0.0)
    if eave:
        grown = [np.asarray(p) + (np.asarray(p) - centre) / max(np.linalg.norm(np.asarray(p) - centre), 1e-6) * eave for p in ring]
        lip = floor + height + parapet
        paint.poly([np.array([x, y, lip]) for x, y in grown], roof)
        walls(paint, [tuple(p) for p in grown], lip - 0.35, lip, trim)
    if look["bands"]:
        bands(glass, ring, floor, height)
    for _ in range(look["plant"]):
        spot = centre + rng.uniform(-0.25, 0.25, 2) * np.ptp(np.asarray(ring), axis=0)
        size = rng.uniform(1.2, 2.6, 2)
        paint.box(np.array([*spot, floor + height + 0.8]), np.array([size[0], 0, 0]), np.array([0, size[1], 0]), UP * 0.8, PLANT)
    parts.footprint(label, ring)


def clip(ring, point, normal):
    out = []
    for a, b in zip(ring, ring[1:] + ring[:1]):
        da, db = (np.asarray(a) - point) @ normal, (np.asarray(b) - point) @ normal
        if da <= 0:
            out.append(tuple(a))
        if (da < 0) != (db < 0):
            t = da / (da - db)
            out.append(tuple(np.asarray(a) + (np.asarray(b) - np.asarray(a)) * t))
    return out


def media(parts, site, ring, rng):
    cut = site.line.at(MEDIA_CUT[0], MEDIA_CUT[1])[:2]
    along = site.line.direction(MEDIA_CUT[0])[:2]
    normal = np.array([-along[1], along[0]])
    building(parts, site.ground, "media", MEDIA_WING, ring, rng, "media centre wing")
    upper = clip(ring, cut, normal)
    if len(upper) >= 3:
        building(parts, site.ground, "media", MEDIA_HEIGHT, upper, rng, "media centre")


def box_ring(centre, axis, length, width):
    u = np.array([math.cos(math.radians(axis)), math.sin(math.radians(axis))])
    v = np.array([-u[1], u[0]])
    c = np.asarray(centre, float)
    return [tuple(c + u * a * length / 2 + v * b * width / 2) for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))]


def garage(parts, ground, rng):
    centre, axis, length, width, tiers = GARAGE
    ring = box_ring(centre, axis, length, width)
    concrete, paint = parts("garage", "concrete"), parts("garage", "paint")
    floors = [ground(x, y) for x, y in ring]
    floor = max(z for z in floors if z is not None)
    low = min(z for z in floors if z is not None) - SKIRT
    parts.footprint("lot c garage", ring)
    u = np.array([math.cos(math.radians(axis)), math.sin(math.radians(axis)), 0.0])
    v = np.array([-u[1], u[0], 0.0])
    c = np.array([*centre, floor])
    top = (tiers - 1) * GARAGE_TIER
    for k in range(tiers):
        z = k * GARAGE_TIER
        concrete.slab(c - u * length / 2 - v * width / 2 + UP * (z - 0.35 if k else low - floor), u * length, v * width, 0.35 if k else floor - low + 0.1, srgb("#a4a19b"))
        if k:
            for a, b in zip(ring, ring[1:] + ring[:1]):
                concrete.poly([np.array([*a, floor + z]), np.array([*b, floor + z]), np.array([*b, floor + z + 1.1]), np.array([*a, floor + z + 1.1])], srgb("#b7b3ab"))
    for a in np.linspace(-length / 2 + 4, length / 2 - 4, 12):
        for b in np.linspace(-width / 2 + 4, width / 2 - 4, 5):
            concrete.box(c + u * a + v * b + UP * top / 2, u * 0.3, v * 0.3, UP * top / 2, srgb("#9a978f"))
    for a in (-length / 2 + 5, length / 2 - 5):
        concrete.slab(c + u * (a - 3) + v * (width / 2 - 7) - UP * 0.5, u * 6, v * 6, top + 3.6, srgb("#8c8880"))
    for a in np.linspace(-length / 2 + 6, length / 2 - 6, 6):
        for b in (-width / 2 + 6, width / 2 - 6):
            pole = c + u * a + v * b + UP * top
            paint.rod(pole, pole + UP * 9.0, 0.12, srgb("#6b6e72"), 5)
            paint.box(pole + UP * 9.1, u * 0.6, v * 0.3, UP * 0.15, srgb("#3a3c40"))
    for k in range(int(tiers * 1.5)):
        spot = c + u * rng.uniform(-length / 2 + 6, length / 2 - 6) + v * rng.uniform(-width / 2 + 6, width / 2 - 6) + UP * top
        paint.box(spot + UP * 0.7, u * 2.2, v * 0.9, UP * 0.7, (srgb("#e9e9e6"), srgb("#1d1e20"), srgb("#8f9296"))[k % 3])


def build(parts, site):
    found = outlines(site.root)
    rng = np.random.default_rng(PLANT_SEED)
    for way, (style, height) in BUILDINGS.items():
        building(parts, site.ground, style, height, found[way], rng, f"{style} {way}")
    for way in CLEARED:
        parts.footprint(f"cleared {way}", found[way], solid=False)
    media(parts, site, found[MEDIA], rng)
    building(parts, site.ground, "dining", 7.0, list(DINING), rng, "t20 dining")
    garage(parts, site.ground, rng)
