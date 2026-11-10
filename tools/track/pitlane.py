import numpy as np

from palette import BRAND_ROWS, TEAMS, palette_uv
from trackside import UNIT, Batch

BAY_SPACING = 14.0
PIER = 1.3
PIER_DEPTH = 0.5
DOOR_HEIGHT = 4.2
SHUTTER_INSET = 0.16
OPENING_HEIGHT = 4.6
INTERIOR_DEPTH = 9.0
FASCIA_HEIGHT = 5.8
CANOPY_HEIGHT = 6.0
CANOPY_REACH = 3.2
CANOPY_THICKNESS = 0.35
BANNER_TILE = 9.6
BANNER_STRIP = 1.2
BANNER_BRAND = 5
BALCONIES = (7.2, 10.7)
BALCONY_REACH = 1.2
BALCONY_RECESS = 1.6
BALCONY_THICKNESS = 0.4
BUILDING_DEPTH = 24.0
ROOF_HEIGHT = 14.0
ROOF_LIP_REACH = 9.0
ROOF_LIP_RISE = 2.6
ROOF_EDGE = 0.45
STRUT_SPACING = 28.0
STRUT_SIZE = 0.22
LIGHT_STRIP = 0.5
FASCIA_COLUMNS = 4
FASCIA_ROWS = 7
BOOM_REACH = 7.0
BOOM_OFFSET = 3.2
BEAM_OVERHANG = 0.3
BEAM_BRAND = 10
BEAM_PANEL = (0.45, 3.6)
HOSE_ANCHOR = 4.25
ARCH_INSET = 0.5
ARCH_ELBOW = 0.9
ARCH_TOP = 4.72
ARCH_BEAM = 0.2
ARCH_HALF = 0.19
ARCH_FOOT = (0.34, 0.3)
ARCH_SLEEVE = 1.5
ARCH_BAND = 0.12
ARCH_STEPS = 7
FACADE_SIZE = (2048, 1024)
FACADE_TILE = 512
CLADDING, SHUTTER, GLAZING, CARBON = range(4)
CLADDING_METRES = 4.5
GLAZING_METRES = 3.5
CARBON_METRES = 0.8
NUMBER_TILE = 128
NUMBER_COLUMNS = 16
NUMBER_SIZE = 0.7
NUMBER_HEIGHT = 3.05
POD_HALF = 1.55
POD_SPAN = (1.9, 7.1)
POD_HEIGHT = (3.3, 3.48)
POD_BEAM = 0.18
ISLAND_HALF = 2.1
ISLAND_SPAN = (4.0, 4.9)
CABINET = (0.65, 1.0, 1.05)
WING_HALF = 0.95
SIDE_TRIM = 0.085
NUMBER_SHIFT = 0.24
LOCKER_HEIGHT = 2.1
ISLAND_MONITORS = 5
ISLAND_STOOLS = 4
SPARE_JACK = (1.65, 2.5)
TEAM_COUNT = len(TEAMS)
TEAM_BAYS = 2
STATION_LENGTH = 7.0
RAIL_HEIGHT = 1.05
RAIL_POST_SPACING = 3.0
RAIL_SIZE = 0.05
STEP_COUNT = 5
TYRE_WIDTH = 0.36
BOTTLE_RADIUS = 0.115
BOTTLE_HEIGHT = 1.4
BRIDGE_HEIGHT = 10.0
BRIDGE_DEPTH = 1.0
BRIDGE_BANNER = 3.0
V_SPREAD = 5.0
V_SIZE = 0.55
MARSHAL_COUNT = 34
TOWER_WIDTH = 1.6
TOWER_LEVEL = 1.8
TOWER_POST = 0.11
TOWER_BRACE = 0.05
SEED = 25
GARAGE_GRID = (4, 3)
BLANKET_RADIUS = 0.37
BAND_HEIGHT = 0.07
COMPOUNDS = ("soft", "medium", "hard")
MONITORS = 7
CHAIRS = 6
CALM = ("arms_folded", "hands_hips", "talking")
STAND_ROOF = 3.55
STAND_DECK = 1.0
MAST_HEIGHT = 2.4


class Frame:
    def __init__(self, track):
        self.track = track

    def local(self, s):
        track = self.track
        f = (s % track.length) / track.length * track.count
        i = int(f) % track.count
        j = (i + 1) % track.count
        t = f - int(f)
        position = track.position[i] * (1 - t) + track.position[j] * t
        camber = track.camber[i] * (1 - t) + track.camber[j] * t
        tangent = track.tangent[i] * (1 - t) + track.tangent[j] * t
        normal = track.normal[i] * (1 - t) + track.normal[j] * t
        return position, camber, tangent, normal

    def at(self, s, lateral, height=0.0):
        position, camber, _, normal = self.local(s)
        xy = position[:2] + normal * lateral
        return np.array([xy[0], xy[1], position[2] + camber * lateral + height])

    def basis(self, s):
        _, _, tangent, normal = self.local(s)
        return tangent, normal


def box(batch, frame, s0, s1, l0, l1, h0, h1, uv=UNIT, under=False):
    p = lambda s, l, h: frame.at(s, l, h)
    faces = [
        (p(s0, l0, h0), p(s1, l0, h0), p(s1, l0, h1), p(s0, l0, h1)),
        (p(s0, l1, h0), p(s1, l1, h0), p(s1, l1, h1), p(s0, l1, h1)),
        (p(s0, l0, h0), p(s0, l1, h0), p(s0, l1, h1), p(s0, l0, h1)),
        (p(s1, l0, h0), p(s1, l1, h0), p(s1, l1, h1), p(s1, l0, h1)),
        (p(s0, l0, h1), p(s1, l0, h1), p(s1, l1, h1), p(s0, l1, h1)),
    ]
    if under:
        faces.append((p(s0, l0, h0), p(s1, l0, h0), p(s1, l1, h0), p(s0, l1, h0)))
    for corners in faces:
        batch.add(corners, uv)


def facade_uv(x0, y0, x1, y1):
    width, height = FACADE_SIZE
    return [(x0 / width, 1 - y1 / height), (x1 / width, 1 - y1 / height), (x1 / width, 1 - y0 / height), (x0 / width, 1 - y0 / height)]


def tile_uv(tile, across=1.0, up=1.0):
    x, size = tile * FACADE_TILE + 1, FACADE_TILE - 2
    return facade_uv(x, 1 + size * (1 - up), x + size * across, 1 + size)


def wall(batch, frame, a, b, h0, h1, tile, metres):
    length = float(np.hypot(b[0] - a[0], b[1] - a[1]))
    up = min(1.0, (h1 - h0) / metres)
    for k in range(max(1, int(np.ceil(length / metres - 1e-6)))):
        t0, t1 = k * metres / length, min(1.0, (k + 1) * metres / length)
        p0, p1 = ((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) for t in (t0, t1))
        batch.add([frame.at(*p0, h0), frame.at(*p1, h0), frame.at(*p1, h1), frame.at(*p0, h1)], tile_uv(tile, (t1 - t0) * length / metres, up))


def flat(colour):
    return [palette_uv(colour)] * 4


def cylinder(batch, centre, axis, radius, length, uv, segments=10, caps=True):
    axis = np.asarray(axis, float) / np.linalg.norm(axis)
    helper = np.array([0.0, 0.0, 1.0]) if abs(axis[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    u = np.cross(axis, helper)
    u /= np.linalg.norm(u)
    v = np.cross(axis, u)
    ring = [np.cos(a) * u + np.sin(a) * v for a in np.linspace(0, 2 * np.pi, segments, endpoint=False)]
    top = centre + axis * length
    for a, b in zip(ring, ring[1:] + ring[:1]):
        batch.add([centre + a * radius, centre + b * radius, top + b * radius, top + a * radius], uv)
    if caps:
        batch.add([top + a * radius for a in ring], [uv[0]] * segments)
        batch.add([centre + a * radius for a in ring], [uv[0]] * segments)


def limb(batch, start, end, r0, r1, uv, segments=8):
    start, end = np.asarray(start, float), np.asarray(end, float)
    axis = end - start
    length = np.linalg.norm(axis)
    axis /= length
    helper = np.array([1.0, 0.0, 0.0]) if abs(axis[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
    u = np.cross(axis, helper)
    u /= np.linalg.norm(u)
    v = np.cross(axis, u)
    ring = [np.cos(a) * u + np.sin(a) * v for a in np.linspace(0, 2 * np.pi, segments, endpoint=False)]
    for a, b in zip(ring, ring[1:] + ring[:1]):
        batch.add([start + a * r0, start + b * r0, end + b * r1, end + a * r1], uv)
    batch.add([end + a * r1 for a in ring], [uv[0]] * segments)
    batch.add([start + a * r0 for a in ring], [uv[0]] * segments)


class Figures:
    def __init__(self, path):
        self.data = np.load(path)

    def add(self, parts, origin, heading, tile, tone, pose):
        gender = "Female" if tone % 3 == 2 else "Male"
        forward = np.array([np.cos(heading), np.sin(heading)])
        left = np.array([-forward[1], forward[0]])
        columns, rows = 4, 3
        tile_u, tile_v = tile % columns, rows - 1 - tile // columns
        for tag in ("cloth", "skin", "hair", "eyes"):
            key = f"{gender}_{pose}_{tag}"
            batch = parts[f"people {tag}"] if tag != "skin" else parts[f"people skin {gender} {tone % 2}"]
            for corners, coords in zip(self.data[f"{key}_tri"], self.data[f"{key}_uv"]):
                world = [
                    (origin[0] + c[0] * left[0] - c[1] * forward[0], origin[1] + c[0] * left[1] - c[1] * forward[1], origin[2] + c[2])
                    for c in corners
                ]
                if tag == "cloth":
                    mapped = [((tile_u + c[0]) / columns, (tile_v + c[1]) / rows) for c in coords]
                else:
                    mapped = [tuple(c) for c in coords]
                batch.add(world, mapped)


MARSHAL_TILE = len(TEAMS)


def bay_count(pit, length):
    return int(((pit["garageEnd"] - pit["garageStart"]) % length) // BAY_SPACING)


def bays(track):
    pit = track.pit
    span = (pit["garageEnd"] - pit["garageStart"]) % track.length
    count = bay_count(pit, track.length)
    spacing = span / count
    return [(pit["garageStart"] + index * spacing, spacing) for index in range(count)]


def team_of(index, count):
    first = (count - TEAM_COUNT * TEAM_BAYS) // 2
    team = (index - first) // TEAM_BAYS
    return team if 0 <= team < TEAM_COUNT else None


def garage_cell(team):
    columns, rows = GARAGE_GRID
    index = team if team is not None else columns * rows - 1
    u0, u1 = index % columns / columns, (index % columns + 1) / columns
    v0, v1 = 1 - (index // columns + 1) / rows, 1 - index // columns / rows
    return [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]


def tyre_stack(batch, base, count, compound):
    cylinder(batch, base, (0, 0, 1), BLANKET_RADIUS, count * TYRE_WIDTH - 0.015, flat("blanket"), 14)
    for layer in range(count):
        band = base + np.array([0, 0, layer * TYRE_WIDTH + (TYRE_WIDTH - BAND_HEIGHT) / 2])
        cylinder(batch, band, (0, 0, 1), BLANKET_RADIUS + 0.006, BAND_HEIGHT, flat(compound), 14, caps=False)


def door_team(door, count):
    if door % 2:
        return team_of(door // 2, count)
    left, right = team_of(door // 2 - 1, count), team_of(door // 2, count)
    return left if left == right else None


def pier(batch, frame, centre, front):
    a, b, inner = centre - PIER / 2, centre + PIER / 2, front + PIER_DEPTH
    wall(batch, frame, (a, front), (b, front), -0.5, DOOR_HEIGHT, CLADDING, CLADDING_METRES)
    wall(batch, frame, (a, inner), (b, inner), 0.0, DOOR_HEIGHT, CLADDING, CLADDING_METRES)
    for edge in (a, b):
        wall(batch, frame, (edge, front), (edge, inner), 0.0, DOOR_HEIGHT, CLADDING, CLADDING_METRES)


def door_number(batch, frame, s, front, number):
    x, y = (number - 1) % NUMBER_COLUMNS * NUMBER_TILE, FACADE_TILE + (number - 1) // NUMBER_COLUMNS * NUMBER_TILE
    a, b, face = s - NUMBER_SIZE / 2, s + NUMBER_SIZE / 2, front - 0.012
    low, high = NUMBER_HEIGHT, NUMBER_HEIGHT + NUMBER_SIZE
    batch.add([frame.at(a, face, low), frame.at(b, face, low), frame.at(b, face, high), frame.at(a, face, high)], facade_uv(x + 1, y + 1, x + NUMBER_TILE - 1, y + NUMBER_TILE - 1))


def garage_shell(frame, parts, team, left, right, front):
    deep = front + INTERIOR_DEPTH
    back, inner = parts["back"], parts["inner"]
    cell = garage_cell(team)
    (u0, v0), (u1, v1) = cell[0], cell[2]
    middle = (left + right) / 2
    for a, b in ((left, middle), (middle, right)):
        back.add([frame.at(a, deep, 0), frame.at(b, deep, 0), frame.at(b, deep, OPENING_HEIGHT), frame.at(a, deep, OPENING_HEIGHT)], cell)
    trim = (u1 - u0) * SIDE_TRIM
    side = [(u0 + trim, v0), (u1 - trim, v0), (u1 - trim, v1), (u0 + trim, v1)]
    for edge, near, far in ((left, front, deep), (right, deep, front)):
        back.add([frame.at(edge, near, 0), frame.at(edge, far, 0), frame.at(edge, far, OPENING_HEIGHT), frame.at(edge, near, OPENING_HEIGHT)], side)
    tiles = (right - left) / 3
    parts["floor"].add([frame.at(left, front, 0.02), frame.at(right, front, 0.02), frame.at(right, deep, 0.02), frame.at(left, deep, 0.02)], [(0, 0), (tiles, 0), (tiles, 3), (0, 3)])
    inner.add([frame.at(left, front, OPENING_HEIGHT), frame.at(right, front, OPENING_HEIGHT), frame.at(right, deep, OPENING_HEIGHT), frame.at(left, deep, OPENING_HEIGHT)], UNIT)
    lip = front + PIER_DEPTH
    inner.add([frame.at(left, front, DOOR_HEIGHT), frame.at(right, front, DOOR_HEIGHT), frame.at(right, lip, DOOR_HEIGHT), frame.at(left, lip, DOOR_HEIGHT)], UNIT)
    inner.add([frame.at(left, lip, DOOR_HEIGHT), frame.at(right, lip, DOOR_HEIGHT), frame.at(right, lip, OPENING_HEIGHT), frame.at(left, lip, OPENING_HEIGHT)], UNIT)


def garage_floor(frame, parts, team, left, right, front, cars):
    team_parts = parts["team"]
    near, deep = front + PIER_DEPTH + 0.1, front + INTERIOR_DEPTH - 0.1
    box(team_parts, frame, left + 0.1, right - 0.1, near, deep, 0.0, 0.03, flat("garage floor"))
    box(team_parts, frame, left + 0.1, right - 0.1, near, near + 0.14, 0.0, 0.034, flat(f"team {team}"))
    line = flat(f"team deep {team}")
    for c in cars:
        a, b, l0, l1 = c - 1.3, c + 1.3, front + 1.7, front + 7.3
        for edges in ((a, b, l0, l0 + 0.07), (a, b, l1 - 0.07, l1), (a, a + 0.07, l0, l1), (b - 0.07, b, l0, l1)):
            box(team_parts, frame, *edges, 0.0, 0.034, line)


def car_pod(frame, parts, team, c, front):
    team_parts, dark = parts["team"], flat("dark")
    a, b = c - POD_HALF, c + POD_HALF
    near, far = front + POD_SPAN[0], front + POD_SPAN[1]
    low, high = POD_HEIGHT
    for edges in ((a, b, near, near + POD_BEAM), (a, b, far - POD_BEAM, far), (a, a + POD_BEAM, near, far), (b - POD_BEAM, b, near, far)):
        box(team_parts, frame, *edges, low, high, dark, under=True)
    box(team_parts, frame, a - 0.01, b + 0.01, near - 0.015, near, low + 0.03, high - 0.03, flat(f"team {team}"))
    for edge in (a + POD_BEAM + 0.08, b - POD_BEAM - 0.48):
        parts["lights"].add([frame.at(edge, near + 0.4, low + 0.02), frame.at(edge + 0.4, near + 0.4, low + 0.02), frame.at(edge + 0.4, far - 0.4, low + 0.02), frame.at(edge, far - 0.4, low + 0.02)], UNIT)
    for s in (a + POD_BEAM / 2, b - POD_BEAM / 2):
        for lateral in (near + POD_BEAM / 2, far - POD_BEAM / 2):
            limb(parts["steel"], frame.at(s, lateral, high), frame.at(s, lateral, OPENING_HEIGHT), 0.02, 0.02, UNIT, 4)
    face = near + POD_BEAM + 0.12
    for offset in (-0.62, 0.62):
        m0, m1 = c + offset - 0.55, c + offset + 0.55
        box(team_parts, frame, m0, m1, face, face + 0.06, 2.56, 3.22, flat("monitor"), under=True)
        parts["screens"].add([frame.at(m0 + 0.04, face + 0.065, 2.6), frame.at(m1 - 0.04, face + 0.065, 2.6), frame.at(m1 - 0.04, face + 0.065, 3.18), frame.at(m0 + 0.04, face + 0.065, 3.18)], UNIT)


def cabinets(frame, parts, team, run, place):
    team_parts = parts["team"]
    depth, height, module = CABINET
    count = max(1, round((run[1] - run[0]) / module))
    width = (run[1] - run[0]) / count
    box(team_parts, frame, *place(run[0], run[1], 0.02, depth), 0.08, height, flat("dark"))
    box(team_parts, frame, *place(run[0] - 0.01, run[1] + 0.01, 0.0, depth + 0.02), height, height + 0.04, flat(f"team {team}"))
    for k in range(count):
        u = run[0] + k * width
        for level in (0.32, 0.56, 0.8):
            box(team_parts, frame, *place(u + width * 0.25, u + width * 0.75, depth, depth + 0.015), level, level + 0.025, flat("jack"))


def locker(frame, parts, team, edges):
    team_parts = parts["team"]
    s0, s1, l0, l1 = edges
    box(team_parts, frame, s0, s1, l0, l1, 0.05, LOCKER_HEIGHT, flat("dark"))
    box(team_parts, frame, s0 - 0.01, s1 + 0.01, l0 - 0.01, l1 + 0.01, LOCKER_HEIGHT - 0.22, LOCKER_HEIGHT - 0.1, flat(f"team {team}"))


def island(frame, parts, team, c, front):
    team_parts = parts["team"]
    a, b = c - ISLAND_HALF, c + ISLAND_HALF
    near, far = front + ISLAND_SPAN[0], front + ISLAND_SPAN[1]
    box(team_parts, frame, a, b, near, far, 0.0, 1.0, flat("dark"))
    box(team_parts, frame, a - 0.02, b + 0.02, near - 0.02, far + 0.02, 1.0, 1.04, flat(f"team {team}"))
    box(team_parts, frame, a, b, near - 0.012, near, 0.46, 0.6, flat("white"))
    width = (b - a) / ISLAND_MONITORS
    for k in range(ISLAND_MONITORS):
        m0, m1 = a + k * width + 0.05, a + (k + 1) * width - 0.05
        box(team_parts, frame, m0, m1, near + 0.1, near + 0.15, 1.1, 1.58, flat("monitor"))
        parts["screens"].add([frame.at(m0 + 0.03, near + 0.155, 1.13), frame.at(m1 - 0.03, near + 0.155, 1.13), frame.at(m1 - 0.03, near + 0.155, 1.55), frame.at(m0 + 0.03, near + 0.155, 1.55)], UNIT)
    for k in range(ISLAND_STOOLS):
        seat = a + (k + 0.5) * (b - a) / ISLAND_STOOLS
        limb(parts["steel"], frame.at(seat, far + 0.45, 0.02), frame.at(seat, far + 0.45, 0.66), 0.025, 0.025, UNIT, 6)
        cylinder(team_parts, frame.at(seat, far + 0.45, 0.66), (0, 0, 1), 0.17, 0.05, flat("chair"), 10)


def spare_wing(frame, parts, team, s, front):
    team_parts, steel = parts["team"], parts["steel"]
    tip, tail = front + 1.0, front + 2.45
    body, dark = flat(f"team deep {team}"), flat("black")
    for side in (-0.32, 0.32):
        for lateral in (tip + 0.25, tail - 0.2):
            limb(steel, frame.at(s + side, lateral, 0.02), frame.at(s + side, lateral, 0.84), 0.018, 0.018, UNIT, 4)
        limb(steel, frame.at(s + side, tip + 0.2, 0.84), frame.at(s + side, tail - 0.15, 0.84), 0.018, 0.018, UNIT, 4)
    box(team_parts, frame, s - WING_HALF, s + WING_HALF, tip, tip + 0.46, 0.86, 0.9, dark, under=True)
    box(team_parts, frame, s - WING_HALF, s + WING_HALF, tip + 0.3, tip + 0.62, 0.94, 0.975, body, under=True)
    for edge in (s - WING_HALF - 0.02, s + WING_HALF):
        box(team_parts, frame, edge, edge + 0.02, tip - 0.02, tip + 0.66, 0.84, 1.13, body, under=True)
    solid(
        team_parts,
        frame,
        [(s - 0.09, tip + 0.1, 0.9), (s + 0.09, tip + 0.1, 0.9), (s + 0.09, tip + 0.1, 1.0), (s - 0.09, tip + 0.1, 1.0)],
        [(s - 0.24, tail, 0.88), (s + 0.24, tail, 0.88), (s + 0.24, tail, 1.24), (s - 0.24, tail, 1.24)],
        body,
    )


def tyre_bank(frame, parts, s, laterals, shift):
    for k, lateral in enumerate(laterals):
        tyre_stack(parts["tyres"], frame.at(s, lateral, 0.03), 4, COMPOUNDS[(k + shift) % len(COMPOUNDS)])


def garage_interior(frame, pit, parts, team, left, right):
    front = pit["garageFront"]
    deep = front + INTERIOR_DEPTH
    third = (right - left) / 3
    cars = (left + third / 2, right - third / 2)
    middle = (left + right) / 2
    garage_shell(frame, parts, team, left, right, front)
    garage_floor(frame, parts, team, left, right, front, cars)
    for c in cars:
        car_pod(frame, parts, team, c, front)
    for c in (*cars, middle):
        parts["lights"].add([frame.at(c - 2.4, deep - 2.6, OPENING_HEIGHT - 0.02), frame.at(c + 2.4, deep - 2.6, OPENING_HEIGHT - 0.02), frame.at(c + 2.4, deep - 2.6 + LIGHT_STRIP, OPENING_HEIGHT - 0.02), frame.at(c - 2.4, deep - 2.6 + LIGHT_STRIP, OPENING_HEIGHT - 0.02)], UNIT)
    island(frame, parts, team, middle, front)
    for side in (-1, 1):
        spare_wing(frame, parts, team, middle + side * 1.75, front)
        tyre_bank(frame, parts, middle + side * third / 2, (front + 1.0, front + 1.85), side > 0)
    cabinets(frame, parts, team, (left + 1.5, right - 1.5), lambda u0, u1, d0, d1: (u0, u1, deep - d1, deep - d0))
    locker(frame, parts, team, (left + 0.15, left + 1.4, deep - 0.75, deep - 0.05))
    locker(frame, parts, team, (right - 1.4, right - 0.15, deep - 0.75, deep - 0.05))
    cabinets(frame, parts, team, (front + 4.0, deep - 1.0), lambda u0, u1, d0, d1: (left + d0, left + d1, u0, u1))
    cabinets(frame, parts, team, (front + 4.0, deep - 1.0), lambda u0, u1, d0, d1: (right - d1, right - d0, u0, u1))
    tyre_bank(frame, parts, left + 0.5, (front + 1.2, front + 2.05, front + 2.9), 0)
    tyre_bank(frame, parts, right - 0.5, (front + 1.2, front + 2.05, front + 2.9), 1)


def upper_floors(frame, parts, front, start, span):
    panels, canopy, steel, banner, facade = (parts[name] for name in ("panels", "canopy", "steel", "banner", "facade"))
    samples = np.arange(0.0, span, 7.0).tolist() + [span]
    v0, v1 = 1 - (BANNER_BRAND + 1) / BRAND_ROWS, 1 - BANNER_BRAND / BRAND_ROWS
    glass = front + BALCONY_RECESS
    storeys = list(zip(BALCONIES, BALCONIES[1:] + (ROOF_HEIGHT,)))
    for a, b in zip(samples, samples[1:]):
        sa, sb = start + a, start + b
        panels.add([frame.at(sa, glass, FASCIA_HEIGHT), frame.at(sb, glass, FASCIA_HEIGHT), frame.at(sb, glass, BALCONIES[0]), frame.at(sa, glass, BALCONIES[0])], UNIT)
        for low, high in storeys:
            wall(facade, frame, (sa, glass), (sb, glass), low, high, GLAZING, GLAZING_METRES)
        canopy.add([frame.at(sa, front, FASCIA_HEIGHT), frame.at(sb, front, FASCIA_HEIGHT), frame.at(sb, glass, FASCIA_HEIGHT), frame.at(sa, glass, FASCIA_HEIGHT)], UNIT)
        canopy.add([frame.at(sa, front, CANOPY_HEIGHT), frame.at(sb, front, CANOPY_HEIGHT), frame.at(sb, front - CANOPY_REACH, CANOPY_HEIGHT - 0.3), frame.at(sa, front - CANOPY_REACH, CANOPY_HEIGHT - 0.3)], UNIT)
        canopy.add([frame.at(sa, front - CANOPY_REACH, CANOPY_HEIGHT - 0.3), frame.at(sb, front - CANOPY_REACH, CANOPY_HEIGHT - 0.3), frame.at(sb, front - CANOPY_REACH, CANOPY_HEIGHT - 0.3 + CANOPY_THICKNESS), frame.at(sa, front - CANOPY_REACH, CANOPY_HEIGHT - 0.3 + CANOPY_THICKNESS)], UNIT)
        for level in BALCONIES:
            lip = front - BALCONY_REACH
            canopy.add([frame.at(sa, lip, level), frame.at(sb, lip, level), frame.at(sb, glass, level), frame.at(sa, glass, level)], UNIT)
            canopy.add([frame.at(sa, lip, level - BALCONY_THICKNESS), frame.at(sb, lip, level - BALCONY_THICKNESS), frame.at(sb, lip, level), frame.at(sa, lip, level)], UNIT)
            limb(steel, frame.at(sa, lip + 0.1, level + RAIL_HEIGHT), frame.at(sb, lip + 0.1, level + RAIL_HEIGHT), RAIL_SIZE, RAIL_SIZE, UNIT, 4)
        roof_lip = front - ROOF_LIP_REACH
        canopy.add([frame.at(sa, glass, ROOF_HEIGHT), frame.at(sb, glass, ROOF_HEIGHT), frame.at(sb, roof_lip, ROOF_HEIGHT + ROOF_LIP_RISE), frame.at(sa, roof_lip, ROOF_HEIGHT + ROOF_LIP_RISE)], UNIT)
        canopy.add([frame.at(sa, roof_lip, ROOF_HEIGHT + ROOF_LIP_RISE - ROOF_EDGE), frame.at(sb, roof_lip, ROOF_HEIGHT + ROOF_LIP_RISE - ROOF_EDGE), frame.at(sb, roof_lip, ROOF_HEIGHT + ROOF_LIP_RISE), frame.at(sa, roof_lip, ROOF_HEIGHT + ROOF_LIP_RISE)], UNIT)
        canopy.add([frame.at(sa, glass, ROOF_HEIGHT), frame.at(sb, glass, ROOF_HEIGHT), frame.at(sb, front + BUILDING_DEPTH, ROOF_HEIGHT), frame.at(sa, front + BUILDING_DEPTH, ROOF_HEIGHT)], UNIT)
        panels.add([frame.at(sa, front + BUILDING_DEPTH, -0.5), frame.at(sb, front + BUILDING_DEPTH, -0.5), frame.at(sb, front + BUILDING_DEPTH, ROOF_HEIGHT), frame.at(sa, front + BUILDING_DEPTH, ROOF_HEIGHT)], UNIT)
        ua, ub = a / BANNER_TILE, b / BANNER_TILE
        level = BALCONIES[0]
        banner.add([frame.at(sa, front - BALCONY_REACH - 0.04, level - BANNER_STRIP), frame.at(sb, front - BALCONY_REACH - 0.04, level - BANNER_STRIP), frame.at(sb, front - BALCONY_REACH - 0.04, level), frame.at(sa, front - BALCONY_REACH - 0.04, level)], [(ua, v0), (ub, v0), (ub, v1), (ua, v1)])
    for s in (start, start + span):
        canopy.add([frame.at(s, front, -0.5), frame.at(s, front + BUILDING_DEPTH, -0.5), frame.at(s, front + BUILDING_DEPTH, ROOF_HEIGHT), frame.at(s, front, ROOF_HEIGHT)], UNIT)
    strut = 0.0
    while strut < span:
        s = start + strut
        foot = frame.at(s, front + BALCONY_RECESS - 0.2, BALCONIES[-1] + 0.2)
        for offset in (-2.2, 2.2):
            tip = frame.at(s + offset, front - ROOF_LIP_REACH + 0.3, ROOF_HEIGHT + ROOF_LIP_RISE - 0.2)
            limb(steel, foot, tip, STRUT_SIZE / 2, STRUT_SIZE / 2, UNIT, 6)
        strut += STRUT_SPACING


def garage_front(frame, pit, parts):
    front = pit["garageFront"]
    facade, fascia = parts["facade"], parts["fascia"]
    all_bays = bays(frame.track)
    count = len(all_bays)
    start, spacing = all_bays[0]
    half = spacing / 2
    span = spacing * count
    clear = (half - PIER) / 2
    wall(facade, frame, (start, front), (start + clear, front), -0.5, DOOR_HEIGHT, CLADDING, CLADDING_METRES)
    wall(facade, frame, (start + span - clear, front), (start + span, front), -0.5, DOOR_HEIGHT, CLADDING, CLADDING_METRES)
    wall(facade, frame, (start, front), (start + span, front), DOOR_HEIGHT, OPENING_HEIGHT, CLADDING, CLADDING_METRES)
    for index in range(2 * count):
        pier(facade, frame, start + (index + 0.5) * half, front)
    for door in range(1, 2 * count):
        centre = start + door * half
        team = door_team(door, count)
        own = door % 2 == 1 and team is not None
        beside = door % 2 == 0 and team_of(door // 2, count) is not None
        door_number(facade, frame, centre + half / 2 + NUMBER_SHIFT * (own - beside), front, door)
        if team is not None:
            continue
        a, b, inset = centre - clear, centre + clear, front + SHUTTER_INSET
        facade.add([frame.at(a, inset, -0.1), frame.at(b, inset, -0.1), frame.at(b, inset, DOOR_HEIGHT), frame.at(a, inset, DOOR_HEIGHT)], tile_uv(SHUTTER))
    first = (count - TEAM_COUNT * TEAM_BAYS) // 2
    for team in range(TEAM_COUNT):
        left = start + (first + team * TEAM_BAYS) * spacing + half / 2
        garage_interior(frame, pit, parts, team, left, left + 3 * half)
    for index, (s, _) in enumerate(all_bays):
        column, row = index % FASCIA_COLUMNS, index // FASCIA_COLUMNS % FASCIA_ROWS
        u0, u1 = column / FASCIA_COLUMNS, (column + 1) / FASCIA_COLUMNS
        v0, v1 = 1 - (row + 1) / FASCIA_ROWS, 1 - row / FASCIA_ROWS
        fascia.add(
            [frame.at(s, front - 0.05, OPENING_HEIGHT), frame.at(s + spacing, front - 0.05, OPENING_HEIGHT), frame.at(s + spacing, front - 0.05, FASCIA_HEIGHT), frame.at(s, front - 0.05, FASCIA_HEIGHT)],
            [(u0, v0), (u1, v0), (u1, v1), (u0, v1)],
        )
    upper_floors(frame, parts, front, start, (all_bays[-1][0] + spacing - start) % frame.track.length)


def solid(batch, frame, base, top, uv):
    a = [frame.at(*point) for point in base]
    b = [frame.at(*point) for point in top]
    for i in range(4):
        j = (i + 1) % 4
        batch.add([a[i], a[j], b[j], b[i]], uv)
    batch.add(b, uv)
    batch.add(a[::-1], uv)


def ring(frame, s, point, normal, half, depth):
    low = (point[0] - normal[0] * depth, point[1] - normal[1] * depth)
    high = (point[0] + normal[0] * depth, point[1] + normal[1] * depth)
    return [frame.at(s - half, *low), frame.at(s + half, *low), frame.at(s + half, *high), frame.at(s - half, *high)]


def arch_path(front):
    leg, top = front - ARCH_INSET, ARCH_TOP - ARCH_BEAM
    tip = front - BOOM_REACH - BEAM_OVERHANG
    spring = top - ARCH_ELBOW
    foot, beam = ARCH_FOOT, (ARCH_HALF, ARCH_BEAM)
    up = (1.0, 0.0)
    path = [
        ((leg, 0.0), up, foot, "accent"),
        ((leg, ARCH_BAND), up, foot, "sleeve"),
        ((leg, ARCH_SLEEVE), up, beam, "white"),
        ((leg, ARCH_SLEEVE + ARCH_BAND), up, beam, "sleeve"),
        ((leg, spring), up, beam, None),
    ]
    for k in range(1, ARCH_STEPS + 1):
        angle = np.pi / 2 * k / ARCH_STEPS
        path.append(((leg - ARCH_ELBOW + ARCH_ELBOW * np.cos(angle), spring + ARCH_ELBOW * np.sin(angle)), (np.cos(angle), np.sin(angle)), beam, None))
    reach = leg - ARCH_ELBOW - tip
    pieces = int(np.ceil(reach / CARBON_METRES))
    for k in range(1, pieces + 1):
        path.append(((leg - ARCH_ELBOW - reach * k / pieces, top), (0.0, 1.0), beam, None))
    return path


def arch(parts, frame, s, front, team):
    team_parts, facade = parts["team"], parts["facade"]
    skins = {"accent": flat(f"team {team}"), "sleeve": flat(f"team deep {team}"), "white": flat("white")}
    path = arch_path(front)
    rings = [ring(frame, s, point, normal, *size) for point, normal, size, _ in path]
    for (a, b), (start, _, size, skin), (end, _, _, _) in zip(zip(rings, rings[1:]), path, path[1:]):
        length = float(np.hypot(end[0] - start[0], end[1] - start[1]))
        for i in range(4):
            j = (i + 1) % 4
            width = 2 * size[i % 2]
            uv = skins[skin] if skin else tile_uv(CARBON, min(1.0, width / CARBON_METRES), min(1.0, length / CARBON_METRES))
            (team_parts if skin else facade).add([a[i], a[j], b[j], b[i]], uv)
    facade.add(rings[-1], tile_uv(CARBON, 0.5, 0.5))
    top = ARCH_TOP - ARCH_BEAM
    tip = front - BOOM_REACH - BEAM_OVERHANG
    near, far = tip + BEAM_PANEL[0], tip + BEAM_PANEL[1]
    v0, v1 = 1 - (BEAM_BRAND + 0.86) / BRAND_ROWS, 1 - (BEAM_BRAND + 0.14) / BRAND_ROWS
    low, high = top - ARCH_BEAM + 0.05, top + ARCH_BEAM - 0.05
    for side, (a, b) in ((-1, (far, near)), (1, (near, far))):
        edge = s + side * (ARCH_HALF + 0.004)
        parts["banner"].add([frame.at(edge, a, low), frame.at(edge, b, low), frame.at(edge, b, high), frame.at(edge, a, high)], [(0.02, v0), (0.48, v0), (0.48, v1), (0.02, v1)])
    anchor = front - BOOM_REACH
    for spread in (-0.14, 0.14):
        limb(team_parts, frame.at(s, anchor + spread, top - ARCH_BEAM + 0.02), frame.at(s, anchor + spread, HOSE_ANCHOR), 0.025, 0.025, flat("black"), 6)


def spare_jack(batch, frame, s, lateral):
    limb(batch, frame.at(s - 0.25, lateral, 0.05), frame.at(s + 1.45, lateral + 0.1, 0.06), 0.03, 0.03, flat("jack"), 8)
    box(batch, frame, s - 0.45, s - 0.05, lateral - 0.2, lateral + 0.2, 0.0, 0.14, flat("black"))
    box(batch, frame, s - 0.5, s - 0.42, lateral - 0.3, lateral + 0.3, 0.04, 0.1, flat("jack"))
    limb(batch, frame.at(s + 1.3, lateral - 0.18, 0.07), frame.at(s + 1.3, lateral + 0.38, 0.07), 0.03, 0.03, flat("rubber"), 8)


def equipment(frame, pit, parts):
    front = pit["garageFront"]
    team_parts, metal = parts["team"], parts["metal"]
    all_bays = bays(frame.track)
    first = (len(all_bays) - TEAM_COUNT * TEAM_BAYS) // 2
    for index, (s, spacing) in enumerate(all_bays):
        team = team_of(index, len(all_bays))
        if team is None:
            continue
        middle = s + spacing / 2
        for side in (-1, 1):
            arch(parts, frame, middle + side * BOOM_OFFSET, front, team)
        spare_jack(team_parts, frame, middle + SPARE_JACK[0], pit["boxLateral"] + SPARE_JACK[1])
        outer = -1 if (index - first) % TEAM_BAYS == 0 else 1
        rack = middle + outer * (spacing / 4 + 0.32)
        box(team_parts, frame, rack - 0.42, rack + 0.42, front - 0.52, front - 0.1, 0.0, 0.12, flat("dark"))
        for bottle in (-0.2, 0.2):
            cylinder(metal, frame.at(rack + bottle, front - 0.31, 0.12), (0, 0, 1), BOTTLE_RADIUS, BOTTLE_HEIGHT, flat("blanket"), 10)
            cylinder(metal, frame.at(rack + bottle, front - 0.31, 0.12 + BOTTLE_HEIGHT), (0, 0, 1), BOTTLE_RADIUS * 0.4, 0.14, flat("jack"), 8)


def crew(frame, pit, parts, rng, figures):
    front = pit["garageFront"]
    all_bays = bays(frame.track)
    count = len(all_bays)
    start, spacing = all_bays[0]
    half = spacing / 2
    first = (count - TEAM_COUNT * TEAM_BAYS) // 2
    tangent, normal = frame.basis(start)
    lane = np.arctan2(-normal[1], -normal[0])
    along = np.arctan2(tangent[1], tangent[0])
    desk = front + ISLAND_SPAN[1] + 0.6
    for team in range(TEAM_COUNT):
        left = start + (first + team * TEAM_BAYS) * spacing + half / 2
        middle, right = left + 1.5 * half, left + 3 * half
        spots = [
            (middle - 1.05, desk, lane, "interact"),
            (middle + 1.05, desk, lane, "arms_folded"),
            (left + 1.5, front + 5.4, along, "hands_hips"),
            (right - 2.3, front + 6.7, along, "talking"),
            (right - 1.45, front + 6.5, along + np.pi, "arms_folded"),
        ]
        for s, lateral, heading, pose in spots:
            if rng.random() < 0.15:
                continue
            place = frame.at(s + rng.uniform(-0.15, 0.15), lateral + rng.uniform(-0.1, 0.1), 0.03)
            figures.add(parts, place, heading + rng.uniform(-0.25, 0.25), team, int(rng.integers(0, 6)), pose)


def marshals(frame, pit, parts, rng, figures):
    length = frame.track.length
    deck = pit["pitWall"] + pit["pitWallDeck"] / 2
    span = (pit["garageEnd"] - pit["garageStart"]) % length
    tangent_heading = np.arctan2(*frame.basis(pit["garageStart"])[0][::-1])
    for _ in range(MARSHAL_COUNT):
        s = pit["garageStart"] + rng.uniform(5.0, span - 5.0)
        figures.add(parts, frame.at(s, deck + rng.uniform(-0.6, 0.6), 1.02), tangent_heading - np.pi / 2 + rng.uniform(-0.8, 0.8), MARSHAL_TILE, int(rng.integers(0, 6)), str(rng.choice(CALM)))


def pit_stand(frame, parts, rng, figures, team, centre, front, deck):
    team_parts, steel, screens = parts["team"], parts["steel"], parts["screens"]
    brand, base = flat(f"team {team}"), flat(f"team deep {team}")
    s0, s1 = centre - STATION_LENGTH / 2, centre + STATION_LENGTH / 2
    l0, l1 = front + 0.45, front + deck - 0.15
    floor = STAND_DECK + 0.15
    box(team_parts, frame, s0, s1, l0, l1, STAND_DECK, floor, flat("dark"))
    box(team_parts, frame, s0, s1, l0 + 0.05, l0 + 0.75, floor, 2.0, base)
    box(team_parts, frame, s0 - 0.01, s1 + 0.01, l0 + 0.04, l0 + 0.76, 2.0, 2.05, flat("dark"))
    box(team_parts, frame, s0 - 0.01, s1 + 0.01, l0 + 0.03, l0 + 0.05, 1.45, 1.6, brand)
    width = STATION_LENGTH / MONITORS
    for row, (bottom, top) in enumerate(((2.1, 2.55), (2.6, 3.05))):
        for k in range(MONITORS):
            a, b = s0 + k * width + 0.04, s0 + (k + 1) * width - 0.04
            lean = 0.05 * row
            box(team_parts, frame, a, b, l0 + 0.3 - lean, l0 + 0.36 - lean, bottom, top, flat("monitor"))
            screens.add([frame.at(a + 0.03, l0 + 0.365 - lean, bottom + 0.03), frame.at(b - 0.03, l0 + 0.365 - lean, bottom + 0.03), frame.at(b - 0.03, l0 + 0.365 - lean, top - 0.03), frame.at(a + 0.03, l0 + 0.365 - lean, top - 0.03)], UNIT)
    for k in range(CHAIRS):
        seat_s = s0 + (k + 0.5) * STATION_LENGTH / CHAIRS
        seat_l = l0 + 1.15
        limb(steel, frame.at(seat_s, seat_l, floor), frame.at(seat_s, seat_l, 1.72), 0.03, 0.03, UNIT, 6)
        box(team_parts, frame, seat_s - 0.24, seat_s + 0.24, seat_l - 0.22, seat_l + 0.22, 1.72, 1.8, flat("chair"))
        box(team_parts, frame, seat_s - 0.23, seat_s + 0.23, seat_l + 0.2, seat_l + 0.26, 1.8, 2.35, flat("chair"))
        box(team_parts, frame, seat_s - 0.235, seat_s + 0.235, seat_l + 0.195, seat_l + 0.265, 2.22, 2.35, brand)
    roof_l0, roof_l1 = l0 - 0.6, l1 + 0.5
    box(team_parts, frame, s0 - 0.5, s1 + 0.5, roof_l0, roof_l1, STAND_ROOF, STAND_ROOF + 0.16, base)
    for lateral in (roof_l0 - 0.03, roof_l1 - 0.01):
        box(team_parts, frame, s0 - 0.52, s1 + 0.52, lateral, lateral + 0.04, STAND_ROOF - 0.28, STAND_ROOF + 0.18, brand)
    parts["lights"].add([frame.at(s0, l0 + 0.2, STAND_ROOF - 0.01), frame.at(s1, l0 + 0.2, STAND_ROOF - 0.01), frame.at(s1, l0 + 0.45, STAND_ROOF - 0.01), frame.at(s0, l0 + 0.45, STAND_ROOF - 0.01)], UNIT)
    for post_s in (s0 + 0.1, centre, s1 - 0.1):
        for post_l in (l0 + 0.1, l1 - 0.1):
            limb(steel, frame.at(post_s, post_l, floor), frame.at(post_s, post_l, STAND_ROOF), 0.045, 0.045, UNIT, 6)
    for edge in (s0 - 0.02, s1 - 0.02):
        box(team_parts, frame, edge, edge + 0.04, l0 + 0.05, l0 + 0.95, 2.05, STAND_ROOF, base)
    mast = frame.at(s1 + 0.2, l1, STAND_ROOF + 0.16)
    top = mast + np.array([0, 0, MAST_HEIGHT])
    limb(steel, mast, top, 0.035, 0.025, UNIT, 6)
    for lift, reach in ((0.6, 0.45), (1.5, 0.3)):
        a, b = frame.at(s1 + 0.2 - reach, l1, STAND_ROOF + 0.16 + lift), frame.at(s1 + 0.2 + reach, l1, STAND_ROOF + 0.16 + lift)
        limb(steel, a, b, 0.015, 0.015, UNIT, 4)
    dish = frame.at(s0 + 0.6, l0 + 0.6, STAND_ROOF + 0.45)
    cylinder(steel, dish, frame.at(s0 + 0.6, l0 + 0.1, STAND_ROOF + 0.7) - frame.at(s0 + 0.6, l0 + 0.6, STAND_ROOF + 0.45), 0.32, 0.05, UNIT, 16)
    limb(steel, frame.at(s0 + 0.6, l0 + 0.6, STAND_ROOF + 0.16), dish, 0.03, 0.03, UNIT, 6)
    heading = np.arctan2(*frame.basis(s0)[1][::-1])
    for seat in (1, 3, 4):
        seat_s = s0 + (seat + 0.5) * STATION_LENGTH / CHAIRS
        figures.add(parts, frame.at(seat_s, l0 + 1.6, floor), heading + np.pi, team, int(rng.integers(0, 6)), str(rng.choice(CALM)))


def pit_wall(frame, pit, parts, rng, figures):
    length = frame.track.length
    front = pit["pitWall"]
    deck = pit["pitWallDeck"]
    back = front + deck
    start = pit["garageStart"]
    span = (pit["garageEnd"] - start) % length
    steel = parts["steel"]
    margin = 24.0
    post = margin
    while post < span - margin:
        s = start + post
        limb(steel, frame.at(s, back - 0.08, 1.0), frame.at(s, back - 0.08, 1.0 + RAIL_HEIGHT), RAIL_SIZE, RAIL_SIZE, UNIT, 6)
        limb(steel, frame.at(s, back - 0.08, 1.0 + RAIL_HEIGHT), frame.at(s + RAIL_POST_SPACING, back - 0.08, 1.0 + RAIL_HEIGHT), RAIL_SIZE, RAIL_SIZE, UNIT, 6)
        limb(steel, frame.at(s, back - 0.08, 1.0 + RAIL_HEIGHT / 2), frame.at(s + RAIL_POST_SPACING, back - 0.08, 1.0 + RAIL_HEIGHT / 2), RAIL_SIZE * 0.7, RAIL_SIZE * 0.7, UNIT, 6)
        post += RAIL_POST_SPACING
    all_bays = bays(frame.track)
    for team in range(TEAM_COUNT):
        first = (len(all_bays) - TEAM_COUNT * TEAM_BAYS) // 2 + team * TEAM_BAYS
        s, spacing = all_bays[first]
        pit_stand(frame, parts, rng, figures, team, s + spacing, front, deck)
    for stairs in (0.2, 0.5, 0.8):
        s = start + span * stairs
        step_depth = 0.2
        for step in range(STEP_COUNT):
            lift = 1.0 * (STEP_COUNT - step) / STEP_COUNT
            box(parts["concrete"], frame, s, s + 1.6, back + step * step_depth, back + (step + 1) * step_depth, 0.0, lift)


def lattice(batch, frame, s, lateral, top):
    half = TOWER_WIDTH / 2
    corners = [(s - half, lateral - half), (s + half, lateral - half), (s + half, lateral + half), (s - half, lateral + half)]
    for a, l in corners:
        limb(batch, frame.at(a, l, -1.0), frame.at(a, l, top), TOWER_POST, TOWER_POST, UNIT, 6)
    level = 0.0
    while level < top:
        for (a0, l0), (a1, l1) in zip(corners, corners[1:] + corners[:1]):
            limb(batch, frame.at(a0, l0, level), frame.at(a1, l1, level), TOWER_BRACE, TOWER_BRACE, UNIT, 5)
            limb(batch, frame.at(a0, l0, level), frame.at(a1, l1, level + TOWER_LEVEL), TOWER_BRACE, TOWER_BRACE, UNIT, 5)
        level += TOWER_LEVEL


def v_bridge(frame, pit, parts, s, right_reach):
    deck_lat = pit["pitWall"] + pit["pitWallDeck"] / 2
    front = pit["garageFront"]
    steel, white, banner = parts["steel"], parts["white"], parts["banner"]
    for sign in (1, -1):
        limb(white, frame.at(s, deck_lat, 1.0), frame.at(s + sign * V_SPREAD, deck_lat, BRIDGE_HEIGHT), V_SIZE * 0.55, V_SIZE, flat("white"), 10)
    limb(white, frame.at(s - V_SPREAD, deck_lat, BRIDGE_HEIGHT), frame.at(s + V_SPREAD, deck_lat, BRIDGE_HEIGHT), V_SIZE, V_SIZE, flat("white"), 10)
    far = -right_reach
    box(steel, frame, s - BRIDGE_DEPTH / 2, s + BRIDGE_DEPTH / 2, far, front, BRIDGE_HEIGHT - 0.25, BRIDGE_HEIGHT + 0.25, UNIT)
    if right_reach > 0:
        lattice(parts["tower"], frame, s, far, BRIDGE_HEIGHT + 1.0)
    for brand, l0, l1 in ((2, deck_lat + 1.0, front - 2.0), (3, far + 2.0, deck_lat - 1.0)):
        run = l1 - l0
        if run < BRIDGE_BANNER:
            continue
        tiles = run / (BRIDGE_BANNER * 4)
        v0, v1 = 1 - (brand + 1) / BRAND_ROWS, 1 - brand / BRAND_ROWS
        for shift, reading in ((-BRIDGE_DEPTH / 2, (l1, l0)), (BRIDGE_DEPTH / 2, (l0, l1))):
            a, b = reading
            banner.add(
                [frame.at(s + shift, a, BRIDGE_HEIGHT - 0.25 - BRIDGE_BANNER), frame.at(s + shift, b, BRIDGE_HEIGHT - 0.25 - BRIDGE_BANNER), frame.at(s + shift, b, BRIDGE_HEIGHT - 0.25), frame.at(s + shift, a, BRIDGE_HEIGHT - 0.25)],
                [(0, v0), (tiles, v0), (tiles, v1), (0, v1)],
            )


def entry_signs(frame, pit, parts):
    signs = parts["signs"]
    start = pit["wallStart"]
    wall = pit["pitWall"]
    for lateral in (wall + 1.0, pit["pitLaneSign"]):
        s = start + 1.0
        box(parts["white"], frame, s, s + 0.2, lateral, lateral + 1.0, 0.0, 1.5, flat("white"))
        signs.add([frame.at(s - 0.02, lateral + 1.0, 0.25), frame.at(s - 0.02, lateral, 0.25), frame.at(s - 0.02, lateral, 1.25), frame.at(s - 0.02, lateral + 1.0, 1.25)], [(0, 0.5), (1, 0.5), (1, 1), (0, 1)])
    arrow_s = start - 1.0
    limb(parts["steel"], frame.at(arrow_s, wall + 0.2, 0.0), frame.at(arrow_s, wall + 0.2, 3.2), 0.06, 0.06, UNIT, 6)
    signs.add([frame.at(arrow_s, wall + 0.85, 2.0), frame.at(arrow_s, wall - 0.45, 2.0), frame.at(arrow_s, wall - 0.45, 3.3), frame.at(arrow_s, wall + 0.85, 3.3)], [(0, 0), (1, 0), (1, 0.5), (0, 0.5)])


def build(track, figure_path):
    frame = Frame(track)
    figures = Figures(figure_path)
    pit = track.pit
    names = ("panels", "facade", "fascia", "banner", "canopy", "floor", "inner", "back", "lights", "steel", "team", "tyres", "metal", "screens", "people cloth", "people hair", "people eyes", "people skin Male 0", "people skin Male 1", "people skin Female 0", "people skin Female 1", "white", "signs", "concrete", "tower")
    parts = {name: Batch() for name in names}
    rng = np.random.default_rng(SEED)
    garage_front(frame, pit, parts)
    equipment(frame, pit, parts)
    crew(frame, pit, parts, rng, figures)
    marshals(frame, pit, parts, rng, figures)
    pit_wall(frame, pit, parts, rng, figures)
    start = pit["garageStart"]
    span = (pit["garageEnd"] - start) % track.length
    for position, reach in ((0.25, float(track.walls[0, 1]) + 2.0), (0.68, None)):
        v_bridge(frame, pit, parts, start + span * position, reach if reach is not None else -pit["pitWall"])
    entry_signs(frame, pit, parts)
    return parts
