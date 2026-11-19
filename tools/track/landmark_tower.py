import math

import numpy as np

from landmark_mesh import UP, flat, heading, railing, srgb

TOWER_CENTRE = (421.71, 78.83)
TOWER_AXIS = 119.6
TOWER_DEPTH = 9.6
TOWER_SHIFT = -2.6
TOWER_WIDTH = 10.8
TOWER_DECK = 70.0
FLIGHT_RISE = 3.5
FLIGHT_WIDTH = 1.3
CORE_HALF = 1.7
CORNER_RADIUS = 0.28
POST_RADIUS = 0.16
DECK_BACK = 3.0
DECK_FRONT = 0.6
DECK_SIDE = 0.8
DECK_ROOM = 3.8
RAIL = 1.15
VEIL_TUBES = 18
VEIL_RADIUS = 0.15
VEIL_OUT = 4.8
VEIL_CURVE = 4.5
VEIL_TOP = 76.5
TRUSS_FROM = 2.8
TRUSS_PITCH = 1.6
VISOR_TIP = 6.5
VISOR_FLICK = 1.1
VEIL_BEND = 3.0
J_RADIUS = 10.0
J_LOW = 12.0
CANOPY_RUN = 50.0
CANOPY_RISE = 7.5
CANOPY_SPREAD = 4.4
CANOPY_FLARE = 2.2
STRUT_EVERY = 7.0
V_ROWS = (9.0, 24.0, 40.0)
V_SPLAY = 2.8
ROOF_FROM = 16.0
ROOF_TO = 47.0
ROOF_DROP = 0.55
STAGE_CENTRE = (383.32, 126.53)
STAGE_AXIS = 36.1
STAGE_SIZE = (34.0, 14.0)
STAGE_DECK = 1.6
STAGE_TOWER = 15.5
TRUSS = 0.9
BOWL_ANGLES = (84.0, 162.0)
BOWL_RINGS = ((30.0, 46.0, 5.0), (52.0, 70.0, 7.6))
BOWL_ROW = 0.95
BOWL_RISE = 0.16
BOWL_SECTIONS = 6
BOWL_AISLE = 0.7
BOWL_BOOTH = (49.0, 122.0)
BOWL_CLEAR = (66.0, 178.0)
BOWL_CLEAR_RADII = (22.0, 84.0)

WHITE = srgb("#f2f0ea")
RED = srgb("#ae1f2a")
GLASS = srgb("#c6ccd0")
DECK_GLASS = srgb("#8ea3ad")
CONCRETE = srgb("#9a9690")
SCRIM = srgb("#2e2f34")
STONE = srgb("#b9a88f")
SEAT_RED = srgb("#9c1d25")
SEAT_DARK = srgb("#4a1015")
AISLE = srgb("#8f8d88")


class Tower:
    def __init__(self, ground):
        self.f = heading(TOWER_AXIS)
        self.a = np.array([-self.f[1], self.f[0], 0.0])
        self.origin = flat(TOWER_CENTRE) + self.f * TOWER_SHIFT
        self.base = ground(*TOWER_CENTRE)
        self.ground = ground

    def at(self, f, a, z):
        return self.origin + self.f * f + self.a * a + UP * (self.base + z)


def lattice(tower, parts):
    steel = parts("tower", "paint")
    half_f, half_a = TOWER_DEPTH / 2, TOWER_WIDTH / 2
    parts.footprint("tower", [tower.at(f, a, 0)[:2] for f, a in ((-half_f, -half_a), (half_f, -half_a), (half_f, half_a), (-half_f, half_a))])
    for sf in (-1, 1):
        for sa in (-1, 1):
            steel.tube([tower.at(sf * half_f, sa * half_a, -1.0), tower.at(sf * half_f, sa * half_a, TOWER_DECK)], CORNER_RADIUS, WHITE, 8)
        for f in (-half_f / 3, half_f / 3):
            steel.tube([tower.at(f, sf * half_a, -1.0), tower.at(f, sf * half_a, TOWER_DECK)], POST_RADIUS, WHITE, 6)
    flights = int(TOWER_DECK / FLIGHT_RISE)
    for side in (-1, 1):
        inner = side * (half_a - FLIGHT_WIDTH)
        outer = side * half_a
        for k in range(flights):
            z0, z1 = k * FLIGHT_RISE, (k + 1) * FLIGHT_RISE
            rising = 1 if (k + (side > 0)) % 2 == 0 else -1
            f0, f1 = -rising * (half_f - 1.2), rising * (half_f - 1.2)
            steel.poly([tower.at(f0, inner, z0), tower.at(f1, inner, z1), tower.at(f1, outer, z1), tower.at(f0, outer, z0)], WHITE)
            steel.poly([tower.at(f0, outer, z0), tower.at(f1, outer, z1), tower.at(f1, outer, z1 - 0.75), tower.at(f0, outer, z0 - 0.75)], WHITE)
            steel.poly([tower.at(f0, inner, z0 - 0.75), tower.at(f1, inner, z1 - 0.75), tower.at(f1, inner, z1), tower.at(f0, inner, z0)], WHITE)
            steel.rod(tower.at(f0, outer, z0 + RAIL), tower.at(f1, outer, z1 + RAIL), 0.04, WHITE, 4)
            landing = min(f1, np.sign(f1) * half_f)
            steel.slab(tower.at(landing - 0.7 + 0.7 * np.sign(f1), inner, z1 - 0.2), tower.f * 1.4, tower.a * (outer - inner), 0.2, WHITE)
    for k in range(0, flights + 1, 2):
        z = k * FLIGHT_RISE
        ring = [tower.at(sf * half_f, sa * half_a, z) for sf, sa in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        for p, q in zip(ring, ring[1:] + ring[:1]):
            steel.beam(p, q, 0.22, WHITE)
    for side in (-1, 1):
        for k in range(flights):
            z0, z1 = k * FLIGHT_RISE, (k + 1) * FLIGHT_RISE
            steel.rod(tower.at(-half_f, side * half_a, z0), tower.at(half_f, side * half_a, z1), 0.08, WHITE, 5)
            steel.rod(tower.at(half_f, side * half_a, z0), tower.at(-half_f, side * half_a, z1), 0.08, WHITE, 5)
    for sf in (-1, 1):
        for k in range(0, flights, 2):
            z0, z1 = k * FLIGHT_RISE, (k + 2) * FLIGHT_RISE
            steel.rod(tower.at(sf * half_f, -half_a, z0), tower.at(sf * half_f, half_a, z1), 0.09, WHITE, 5)
            steel.rod(tower.at(sf * half_f, half_a, z0), tower.at(sf * half_f, -half_a, z1), 0.09, WHITE, 5)
    glass = parts("tower", "paint")
    corners = [(-CORE_HALF, -CORE_HALF), (CORE_HALF, -CORE_HALF), (CORE_HALF, CORE_HALF), (-CORE_HALF, CORE_HALF)]
    for (f0, a0), (f1, a1) in zip(corners, corners[1:] + corners[:1]):
        glass.poly([tower.at(f0, a0, -0.5), tower.at(f1, a1, -0.5), tower.at(f1, a1, TOWER_DECK + DECK_ROOM), tower.at(f0, a0, TOWER_DECK + DECK_ROOM)], GLASS)
    for k in range(0, flights + 1, 2):
        z = k * FLIGHT_RISE
        for (f0, a0), (f1, a1) in zip(corners, corners[1:] + corners[:1]):
            steel.beam(tower.at(f0, a0, z), tower.at(f1, a1, z), 0.14, WHITE)
    steel.slab(tower.at(-half_f - 1.5, -half_a - 1.5, -1.2), tower.f * (TOWER_DEPTH + 3.0), tower.a * (TOWER_WIDTH + 3.0), 1.4, CONCRETE)


def deck(tower, parts):
    steel, glass = parts("tower", "paint"), parts("tower", "glass")
    half_f, half_a = TOWER_DEPTH / 2, TOWER_WIDTH / 2
    back, front, side = -half_f - DECK_BACK, half_f + DECK_FRONT, half_a + DECK_SIDE
    steel.slab(tower.at(back, -side, TOWER_DECK - 0.7), tower.f * (front - back), tower.a * 2 * side, 0.7, WHITE)
    outline = [(back + 1.2, -side), (front, -side), (front, side), (back + 1.2, side), (back, side - 1.2), (back, -side + 1.2)]
    for (f0, a0), (f1, a1) in zip(outline, outline[1:] + outline[:1]):
        glass.poly([tower.at(f0, a0, TOWER_DECK), tower.at(f1, a1, TOWER_DECK), tower.at(f1, a1, TOWER_DECK + RAIL), tower.at(f0, a0, TOWER_DECK + RAIL)], DECK_GLASS)
        steel.rod(tower.at(f0, a0, TOWER_DECK + RAIL), tower.at(f1, a1, TOWER_DECK + RAIL), 0.05, WHITE, 4)
    glass.poly([tower.at(back + 0.3, -side + 1.0, TOWER_DECK + 0.02), tower.at(-half_f, -side + 1.0, TOWER_DECK + 0.02), tower.at(-half_f, side - 1.0, TOWER_DECK + 0.02), tower.at(back + 0.3, side - 1.0, TOWER_DECK + 0.02)], DECK_GLASS)
    steel.slab(tower.at(-half_f + 1.0, -half_a + 1.0, TOWER_DECK), tower.f * 6.0, tower.a * (TOWER_WIDTH - 2.0), DECK_ROOM, WHITE)
    for f in (back + 1.5, -half_f, half_f):
        for a in (-side + 0.5, side - 0.5):
            steel.beam(tower.at(f, a, TOWER_DECK), tower.at(f, a, TOWER_DECK + DECK_ROOM + 1.0), 0.2, WHITE)
    low, high = TOWER_DECK + TRUSS_FROM, VEIL_TOP - VEIL_RADIUS
    reach = front + VEIL_OUT - 0.5
    stations = np.arange(back + 0.3, reach, TRUSS_PITCH).tolist() + [reach]
    for a in (-side + 0.3, side - 0.3):
        steel.beam(tower.at(back + 0.3, a, low), tower.at(reach, a, low), 0.16, WHITE)
        steel.beam(tower.at(back + 0.3, a, high), tower.at(reach, a, high), 0.16, WHITE)
        for k, (f0, f1) in enumerate(zip(stations, stations[1:])):
            z0, z1 = (low, high) if k % 2 == 0 else (high, low)
            steel.beam(tower.at(f0, a, z0), tower.at(f1, a, z1), 0.1, WHITE)
    for f in stations[::2]:
        steel.beam(tower.at(f, -side + 0.3, high), tower.at(f, side - 0.3, high), 0.12, WHITE)


def arc(centre, radius, start, stop, steps):
    return [centre + np.array([math.cos(t), math.sin(t)]) * radius for t in np.linspace(start, stop, steps)]


def veil_profile(bulge):
    half_f = TOWER_DEPTH / 2
    plane = half_f + VEIL_OUT + bulge
    tip = -half_f - DECK_BACK - VISOR_TIP
    points = [np.array([tip, VEIL_TOP + VISOR_FLICK]), np.array([tip + 2.5, VEIL_TOP + 0.35])]
    points += [np.array([f, VEIL_TOP]) for f in np.linspace(tip + 5.0, plane - VEIL_BEND, 8)]
    points += arc(np.array([plane - VEIL_BEND, VEIL_TOP - VEIL_BEND]), VEIL_BEND, math.pi / 2, 0.0, 6)[1:]
    low = J_LOW + J_RADIUS
    points += [np.array([plane, z]) for z in np.linspace(VEIL_TOP - VEIL_BEND - 4.0, low, 10)]
    points += arc(np.array([plane + J_RADIUS, low]), J_RADIUS, math.pi, 1.5 * math.pi, 10)[1:]
    start = TOWER_DEPTH / 2 + VEIL_OUT + J_RADIUS
    run = []
    for t in np.linspace(0, 1, 14)[1:]:
        run.append((np.array([start + bulge * (1 - t) + CANOPY_RUN * t, J_LOW + CANOPY_RISE * t**1.3]), t))
    return points, run


def veil(tower, parts):
    tubes = parts("tower", "gloss")
    steel = parts("tower", "paint")
    spacing = (TOWER_WIDTH - 0.6) / (VEIL_TUBES - 1)
    ends = []
    for k in range(VEIL_TUBES):
        a = (k - (VEIL_TUBES - 1) / 2) * spacing
        points, run = veil_profile(VEIL_CURVE * (1 - (2 * a / TOWER_WIDTH) ** 2))
        path = [tower.at(f, a, z) for f, z in points]
        for (f, z), t in run:
            spread = 1 + (CANOPY_SPREAD - 1) * t**1.2
            flare = CANOPY_FLARE * max(0.0, (t - 0.8) / 0.2) ** 2
            path.append(tower.at(f, a * spread, z + flare))
        tubes.tube(path, VEIL_RADIUS, RED, 6)
        ends.append(path)
    plane = TOWER_DEPTH / 2 + VEIL_OUT
    for z in np.arange(J_LOW + J_RADIUS + 2.0, VEIL_TOP - 4.0, STRUT_EVERY):
        steel.beam(tower.at(TOWER_DEPTH / 2, 0.0, z), tower.at(plane + VEIL_CURVE, 0.0, z), 0.16, WHITE)
        steel.beam(tower.at(TOWER_DEPTH / 2, -TOWER_WIDTH / 2, z), tower.at(plane, -TOWER_WIDTH / 2 + 0.3, z), 0.16, WHITE)
        steel.beam(tower.at(TOWER_DEPTH / 2, TOWER_WIDTH / 2, z), tower.at(plane, TOWER_WIDTH / 2 - 0.3, z), 0.16, WHITE)
        tubes.rod(tower.at(plane - 0.15, -TOWER_WIDTH / 2 + 0.3, z), tower.at(plane - 0.15, TOWER_WIDTH / 2 - 0.3, z), 0.06, WHITE, 4)
    start = plane + J_RADIUS
    for row in V_ROWS:
        t = row / CANOPY_RUN
        z = J_LOW + CANOPY_RISE * t**1.3 - 0.35
        width = (TOWER_WIDTH / 2) * (1 + (CANOPY_SPREAD - 1) * t**1.2)
        steel.beam(tower.at(start + row, -width, z), tower.at(start + row, width, z), 0.35, WHITE)
        for a in np.linspace(-width * 0.7, width * 0.7, 3):
            foot = tower.at(start + row, a, 0.0)
            foot[2] = tower.ground(*foot[:2]) - 0.3
            for side in (-1, 1):
                steel.tube([foot, tower.at(start + row, a + side * V_SPLAY, z)], 0.16, WHITE, 6)
    roof = parts("tower", "fabric")
    rows, columns = 10, 9
    grid = np.zeros((rows, columns, 3))
    for i, d in enumerate(np.linspace(ROOF_FROM, ROOF_TO, rows)):
        t = d / CANOPY_RUN
        z = J_LOW + CANOPY_RISE * t**1.3 - ROOF_DROP
        width = (TOWER_WIDTH / 2) * (1 + (CANOPY_SPREAD - 1) * t**1.2) * 0.92
        for j, s in enumerate(np.linspace(-1, 1, columns)):
            grid[i, j] = tower.at(start + d, s * width, z - 0.25 * (1 - s * s))
    roof.sheet(grid, WHITE)


def stage(tower, parts):
    u = heading(STAGE_AXIS)
    n = np.array([-u[1], u[0], 0.0])
    centre = flat(STAGE_CENTRE)
    floor = tower.ground(*STAGE_CENTRE)
    length, depth = STAGE_SIZE
    steel, scrim = parts("stage", "paint"), parts("stage", "paint")
    base = centre - u * length / 2 - n * depth / 2
    parts.footprint("stage", [(base + u * a + n * b)[:2] for a, b in ((0, 0), (length, 0), (length, depth), (0, depth))])
    steel.slab(base + UP * (floor - 1.0), u * length, n * depth, STAGE_DECK + 1.0, srgb("#3a3a3d"))
    top = floor + STAGE_TOWER
    for su in (0, 1):
        for sn in (0, 1):
            foot = base + u * length * su + n * depth * sn + UP * floor
            for du in (-TRUSS / 2, TRUSS / 2):
                for dn in (-TRUSS / 2, TRUSS / 2):
                    steel.rod(foot + u * du + n * dn, foot + u * du + n * dn + UP * STAGE_TOWER, 0.07, WHITE, 4)
            for z in np.arange(0.0, STAGE_TOWER, 2.0):
                steel.rod(foot + UP * z - u * TRUSS / 2, foot + UP * (z + 2.0) + u * TRUSS / 2, 0.04, WHITE, 4)
    for a, b in ((base, base + u * length), (base + n * depth, base + u * length + n * depth), (base, base + n * depth), (base + u * length, base + u * length + n * depth)):
        steel.beam(a + UP * top, b + UP * top, TRUSS, WHITE)
    back = base
    scrim.poly([back + UP * (floor + STAGE_DECK), back + u * length + UP * (floor + STAGE_DECK), back + u * length + UP * (top - 0.5), back + UP * (top - 0.5)], SCRIM)
    for edge in (base, base + u * length):
        scrim.poly([edge + UP * (floor + STAGE_DECK), edge + n * depth + UP * (floor + STAGE_DECK), edge + n * depth + UP * (top - 0.5), edge + UP * (top - 0.5)], SCRIM)
    lip = base + n * depth
    scrim.poly([lip + UP * (top - 3.2), lip + u * length + UP * (top - 3.2), lip + u * length + UP * (top - 0.5), lip + UP * (top - 0.5)], SCRIM)
    wall = parts("stage", "paint")
    wall.slab(base + n * depth + UP * (floor - 1.0), u * length, n * 1.2, STAGE_DECK + 1.0, STONE)


def bowl(tower, parts):
    concrete, seats, stone = parts("amphitheatre", "concrete"), parts("amphitheatre", "gloss"), parts("amphitheatre", "paint")
    centre = flat(STAGE_CENTRE)
    a0, a1 = (math.radians(a) for a in BOWL_ANGLES)

    def at(r, angle, z):
        return centre + np.array([math.cos(angle), math.sin(angle), 0.0]) * r + UP * z

    outline = []
    seating = {}
    for r0, r1, base in BOWL_RINGS:
        rows = int((r1 - r0) / BOWL_ROW)
        sections = np.linspace(a0, a1, BOWL_SECTIONS + 1)
        for k in range(rows):
            r = r0 + k * BOWL_ROW
            z = base + k * BOWL_RISE
            for index, (b0, b1) in enumerate(zip(sections, sections[1:])):
                c0, c1 = b0 + BOWL_AISLE / r, b1 - BOWL_AISLE / r
                seating.setdefault((r0, index), []).append({"radius": round(r + 0.4, 2), "height": round(z + 0.45, 2), "from": round(c0, 4), "to": round(c1, 4)})
                arc = np.linspace(c0, c1, 5)
                for t0, t1 in zip(arc, arc[1:]):
                    concrete.poly([at(r, t0, z), at(r, t1, z), at(r + BOWL_ROW, t1, z), at(r + BOWL_ROW, t0, z)], CONCRETE)
                    concrete.poly([at(r, t1, z - BOWL_RISE), at(r, t0, z - BOWL_RISE), at(r, t0, z), at(r, t1, z)], CONCRETE)
                    seats.poly([at(r + 0.2, t0, z + 0.45), at(r + 0.2, t1, z + 0.45), at(r + 0.6, t1, z + 0.45), at(r + 0.6, t0, z + 0.45)], SEAT_RED)
                    seats.poly([at(r + 0.6, t0, z + 0.2), at(r + 0.6, t1, z + 0.2), at(r + 0.68, t1, z + 0.95), at(r + 0.68, t0, z + 0.95)], SEAT_RED)
                    seats.poly([at(r + 0.2, t1, z + 0.45), at(r + 0.2, t0, z + 0.45), at(r + 0.2, t0, z), at(r + 0.2, t1, z)], SEAT_DARK)
            for b in sections:
                aisle = [at(r, b - BOWL_AISLE / r, z), at(r, b + BOWL_AISLE / r, z), at(r + BOWL_ROW, b + BOWL_AISLE / r, z), at(r + BOWL_ROW, b - BOWL_AISLE / r, z)]
                concrete.poly(aisle, AISLE)
        top = base + rows * BOWL_RISE
        wall = [at(r1, t, top) for t in np.linspace(a0, a1, 25)]
        for p, q in zip(wall, wall[1:]):
            stone.poly([p - UP * (top - base + 1.5), q - UP * (top - base + 1.5), q + UP * 0.9, p + UP * 0.9], STONE)
        railing(stone, [p + UP * 0.9 for p in wall[::3]], 1.0, srgb("#5a5c5f"), 2.0, 0.04)
    w0, w1 = (math.radians(a) for a in BOWL_CLEAR)
    outline = [at(BOWL_CLEAR_RADII[0], t, 0)[:2] for t in np.linspace(w0, w1, 9)]
    outline += [at(BOWL_CLEAR_RADII[1], t, 0)[:2] for t in np.linspace(w1, w0, 13)]
    parts.footprint("amphitheatre bowl", outline, solid=False)
    focus = [round(float(centre[0]), 2), round(float(-centre[1]), 2)]
    for (r0, index), rows in sorted(seating.items()):
        r1 = rows[-1]["radius"] + BOWL_ROW
        b0, b1 = rows[0]["from"], rows[0]["to"]
        ring = [at(r0, t, 0)[:2] for t in np.linspace(b0, b1, 5)] + [at(r1, t, 0)[:2] for t in np.linspace(b1, b0, 5)]
        parts.footprint("amphitheatre seats", ring, solid=False, focus=focus, rows=rows)
    booth = at(BOWL_BOOTH[0], math.radians(BOWL_BOOTH[1]), BOWL_RINGS[0][2] + 4.2)
    for du, dv in ((-3, -3), (3, -3), (3, 3), (-3, 3)):
        stone.beam(booth + np.array([du, dv, 0]) - UP * 4.4, booth + np.array([du, dv, 0]) + UP * 0.4, 0.22, WHITE)
    stone.slab(booth - np.array([3.6, 3.6, 0]) + UP * 0.4, np.array([7.2, 0, 0]), np.array([0, 7.2, 0]), 0.3, WHITE)
    stone.slab(booth - np.array([3.0, 3.0, 0]) - UP * 2.4, np.array([6.0, 0, 0]), np.array([0, 6.0, 0]), 0.25, CONCRETE)


def build(parts, site):
    tower = Tower(site.ground)
    lattice(tower, parts)
    deck(tower, parts)
    veil(tower, parts)
    stage(tower, parts)
    bowl(tower, parts)
