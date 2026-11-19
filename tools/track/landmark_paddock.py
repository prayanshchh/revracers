import json
import math

import numpy as np

from landmark_mesh import UP, flat, heading, railing, srgb, truss, unit

UNITS = (90.0, 18.0, 72.0, 13.0, 7.6)
TRUCK_ROWS = ((92.0, 300.0, 112.0), (92.0, 300.0, 124.0))
TRUCK_PITCH = 4.2
TV_COMPOUND = (3610.0, 3700.0, 30.0, 2)
HELIPADS = ((401.3, 78.4), (431.7, 78.5))
BOOM_LIFT = (2745.0, -23.0)
TERRACE = ((932.0, 340.0), 2.0, 70.0, 13.0, 1571.0)
TERRACE_LIFT = 1.2
TERRACE_TIER = (2.2, 0.45, 4)
TERRACE_EAVES = (5.4, 7.0)
TERRACE_POSTS = 7.0
TERRACE_FOCUS = 5000.0
SUITES = ((651.0, 181.0), 18.0, 120.0, 12.0, 4003.0, False)
SUITES_LEVELS = (1.2, 4.4, 5.2, 8.6)
SUITES_BAY = 8.0
SUITES_MULLION = 2.0
SETTLE_LIMIT = 8.0
PLATFORM = ((703.0, 425.0), 3608.0, 9.0, 6.0)
PLATFORM_LEVELS = (1.5, 4.5, 5.6, 7.4)
PLATFORM_STEP = 0.3
SETTLE_STEP = 0.5
SUITES_WORD_EVERY = 40.0
HAIRPIN = ((488.5, -345.5), 15.0, 12.0, 8.0, 607.0, True)
T1_EXIT = ((515.0, -243.0), 110.0, 14.0, 8.0, 790.0, True)
PAVILION = ((619.0, 115.0), 135.0, 20.0, 12.0, 4.6)
ZIP_TOWER = (290.0, -82.0, 38.0)
ZIP_LANDING = (205.0, -235.0)
PLAZA_CANOPY = ((300.0, 372.0), 20.0, 8, 9.0, 14.0, 10.0)
POOL = ((225.0, 395.0), 20.0, 36.0, 18.0)
PAVILIONS = ((180.0, 410.0, 110.0), (205.0, 445.0, 160.0), (255.0, 440.0, 200.0), (268.0, 405.0, 250.0))

WHITE = srgb("#f3f3f0")
FRAME = srgb("#c9ccce")
WINDOW = srgb("#2a3238")
DECK = srgb("#7c7a76")
TYRE = srgb("#1b1b1d")
YELLOW = srgb("#e3b51c")
STEEL = srgb("#4b4f55")
RED = srgb("#b8222b")


def settled(line, points):
    middle = np.mean(points, axis=0)
    k = int(np.argmin(((line.points[:, :2] - middle[:2]) ** 2).sum(1)))
    away = np.array([*(middle[:2] - line.points[k, :2]), 0.0])
    away /= max(np.linalg.norm(away), 1e-6)
    for step in np.arange(0.0, SETTLE_LIMIT + 0.01, SETTLE_STEP):
        if all(line.clear(p + away * step, 1.0) for p in points):
            return away * step
    return None


def framed(paint, glass, a, b, low, high, out, spacing, frame):
    length = np.linalg.norm(b - a)
    along = (b - a) / max(length, 1e-6)
    glass.poly([a + UP * low, b + UP * low, b + UP * high, a + UP * high], WINDOW)
    for t in np.linspace(0, length, max(2, int(length / spacing) + 1)):
        p = a + along * t + out * 0.05
        paint.box(p + UP * (low + high) / 2, along * 0.05, out * 0.06, UP * (high - low) / 2, frame)
    for z in (low, high):
        paint.box((a + b) / 2 + out * 0.05 + UP * z, along * length / 2, out * 0.07, UP * 0.06, frame)


def umbrella(paint, foot, radius, colour):
    paint.rod(foot, foot + UP * 2.4, 0.04, FRAME, 4)
    rim = [foot + UP * 2.1 + np.array([math.cos(t), math.sin(t), 0.0]) * radius for t in np.linspace(0, 2 * math.pi, 9)]
    for p, q in zip(rim, rim[1:]):
        paint.poly([p, q, foot + UP * 2.55], colour)
    paint.box(foot + UP * 0.37, np.array([0.45, 0, 0]), np.array([0, 0.45, 0]), UP * 0.37, WHITE)


def team_units(parts, line, ground, write, teams):
    lateral, pitch, start, depth, tall = UNITS
    paint, glass = parts("paddock", "paint"), parts("paddock", "glass")
    for k, team in enumerate(teams):
        s = start + k * pitch
        along = line.direction(s)
        across = np.array([-along[1], along[0], 0.0])
        front = line.at(s, lateral)
        floor = ground(*front[:2])
        if floor is None:
            continue
        front[2] = floor
        width = pitch - 2.0
        origin = front - along * width / 2
        out = -across
        parts.footprint(f"hospitality {team['id']}", [(origin + along * a + across * b)[:2] for a, b in ((0, 0), (width, 0), (width, depth), (0, depth))])
        primary, deep, secondary = srgb(team["colours"]["primary"]), srgb(team["colours"]["deep"]), srgb(team["colours"]["secondary"])
        paint.slab(origin - UP * 0.4, along * width, across * depth, 0.6, DECK)
        recess = origin + across * 0.6 + UP * 0.2
        framed(paint, glass, recess, recess + along * width, 0.0, 3.2, out, 1.5, FRAME)
        paint.slab(origin + across * 1.0 + UP * 0.2, along * width, across * (depth - 1.0), 3.4, deep)
        paint.slab(origin - across * 0.3 + UP * 3.6, along * width, across * (depth + 0.3), tall - 3.6, primary)
        band = origin - across * 0.32
        framed(paint, glass, band + along * 0.8, band + along * (width - 0.8), 4.4, 6.2, out, 1.8, deep)
        paint.slab(origin - across * 0.42 + UP * (tall - 0.9), along * width, across * 0.12, 0.7, secondary)
        write(paint, team["name"].upper(), "montserrat", 0.5, origin + along * (width - 1.0) - across * 0.43 + UP * (tall - 0.8), -along, UP, out, deep)
        paint.slab(origin - across * 2.4 + UP * 3.4, along * width, across * 2.4, 0.2, WHITE)
        for t in (0.6, width - 0.6):
            paint.rod(origin + along * t - across * 2.3, origin + along * t - across * 2.3 + UP * 3.4, 0.06, FRAME, 4)
        edge = [origin - across * 0.3 + UP * tall, origin + along * width - across * 0.3 + UP * tall, origin + along * width + across * depth + UP * tall]
        for p, q in zip(edge, edge[1:]):
            glass.poly([p, q, q + UP * 1.05, p + UP * 1.05], srgb("#9aa8ae"))
        railing(paint, edge, 1.05, FRAME, 2.4, 0.04)
        for t in (0.25, 0.55, 0.85):
            umbrella(paint, origin + along * width * t + across * depth * 0.35 + UP * tall, 1.5, secondary if t != 0.55 else primary)
        stair = origin + along * (width + 0.2) + across * (depth - 1.0)
        steps = 14
        for j in range(steps):
            tread = stair - across * (j * (depth - 2.5) / steps) + UP * (j + 1) * tall / steps
            paint.box(tread, along * 0.5, across * 0.16, UP * 0.04, FRAME)
        paint.beam(stair + UP * 0.1, stair - across * (depth - 2.5) + UP * tall, 0.14, FRAME)
        for t in (0.0, width):
            paint.box(origin + along * t - across * 3.2 + UP * 0.45, along * 0.5, across * 0.5, UP * 0.45, srgb("#3d3f40"))
            paint.tube([origin + along * t - across * 3.2 + UP * 0.9, origin + along * t - across * 3.2 + UP * 1.8], [0.55, 0.15], srgb("#4f6b3a"), 6)
        flag = origin + along * (width / 2) - across * 4.2
        paint.rod(flag, flag + UP * 4.0, 0.03, FRAME, 3)
        paint.poly([flag + UP * 1.2, flag + UP * 1.2 + along * 0.7, flag + UP * 3.8 + along * 0.5, flag + UP * 3.9], primary)


def truck(paint, glass, base, along, across, livery, line=None, stripe=None):
    if line is not None and not all(line.clear(base + along * a + across * c, 2.0) for a in (-8.5, 11.5) for c in (-1.5, 1.5)):
        return False
    body = base + along * 3.0
    paint.box(body + UP * 2.55, along * 8.2, across * 1.27, UP * 1.35, WHITE if stripe is not None else livery, open_bottom=False)
    if stripe is not None:
        for sign in (-1, 1):
            side = body + across * sign * 1.28
            paint.poly([side - along * 8.1 + UP * 1.3, side + along * 8.1 + UP * 1.3, side + along * 8.1 + UP * 2.3, side - along * 8.1 + UP * 2.3], livery)
            paint.poly([side - along * 8.1 + UP * 2.35, side + along * 8.1 + UP * 2.35, side + along * 7.0 + UP * 2.6, side - along * 7.0 + UP * 2.6], stripe)
    paint.box(body + UP * 0.95, along * 7.8, across * 1.2, UP * 0.25, TYRE)
    rear = body + along * 8.21
    paint.poly([rear - across * 0.02 + UP * 1.3, rear + across * 0.02 + UP * 1.3, rear + across * 0.02 + UP * 3.8, rear - across * 0.02 + UP * 3.8], srgb("#2b2c2e"))
    for sign in (-1, 1):
        paint.box(rear + across * sign * 1.0 + UP * 1.4, along * 0.04, across * 0.12, UP * 0.06, RED)
    cab = base + along * -6.6
    paint.box(cab + UP * 2.0, along * 1.4, across * 1.25, UP * 1.5, WHITE, open_bottom=False)
    glass.poly([cab - along * 1.41 - across * 1.15 + UP * 2.4, cab - along * 1.41 + across * 1.15 + UP * 2.4, cab - along * 1.41 + across * 1.1 + UP * 3.3, cab - along * 1.41 - across * 1.1 + UP * 3.3], WINDOW)
    paint.poly([cab - along * 1.42 - across * 0.9 + UP * 1.0, cab - along * 1.42 + across * 0.9 + UP * 1.0, cab - along * 1.42 + across * 0.9 + UP * 2.0, cab - along * 1.42 - across * 0.9 + UP * 2.0], srgb("#26272a"))
    for sign in (-1, 1):
        glass.poly([cab - along * 1.2 + across * sign * 1.26 + UP * 2.4, cab + along * 0.2 + across * sign * 1.26 + UP * 2.4, cab + along * 0.2 + across * sign * 1.26 + UP * 3.2, cab - along * 1.2 + across * sign * 1.26 + UP * 3.2], WINDOW)
        paint.rod(cab + along * 1.45 + across * sign * 1.0 + UP * 1.2, cab + along * 1.45 + across * sign * 1.0 + UP * 4.3, 0.08, FRAME, 5)
    for a0, a1 in ((-7.4, -6.4), (-4.1, -3.1), (6.5, 10.3)):
        paint.box(base + along * (a0 + a1) / 2 + UP * 0.5, along * (a1 - a0) / 2, across * 1.25, UP * 0.5, TYRE)
    return True


def clutter(parts, line, ground, teams):
    paint = parts("paddock", "paint")
    lateral = UNITS[0]
    for k, s in enumerate(np.arange(UNITS[2] - 6.0, UNITS[2] + UNITS[1] * len(teams), 9.0)):
        along = line.direction(s)
        across = np.array([-along[1], along[0], 0.0])
        spot = line.at(s, lateral - 9.0)
        floor = ground(*spot[:2])
        if floor is None:
            continue
        spot[2] = floor
        if k % 3 == 0:
            paint.box(spot + UP * 0.55, along * 1.2, across * 0.6, UP * 0.35, WHITE)
            for t in (-0.9, 0.9):
                paint.rod(spot + along * t * 0.8 + UP * 0.9, spot + along * t * 0.8 + UP * 1.9, 0.03, FRAME, 3)
            paint.box(spot + UP * 1.95, along * 1.25, across * 0.65, UP * 0.05, srgb(teams[k % len(teams)]["colours"]["primary"]))
            for t in (-0.8, 0.8):
                paint.box(spot + along * t + UP * 0.25, along * 0.18, across * 0.62, UP * 0.25, TYRE)
        else:
            barrier = spot + across * -1.5
            paint.rod(barrier, barrier + along * 2.4, 0.03, FRAME, 3)
            paint.rod(barrier + UP * 1.1, barrier + along * 2.4 + UP * 1.1, 0.03, FRAME, 3)
            for t in np.linspace(0, 2.4, 7):
                paint.rod(barrier + along * t, barrier + along * t + UP * 1.1, 0.012, FRAME, 3)
            for t in (0.2, 2.2):
                paint.rod(barrier + along * t + across * -0.3, barrier + along * t, 0.03, FRAME, 3)


def trucks(parts, line, ground, teams):
    paint, glass = parts("paddock", "paint"), parts("paddock", "glass")
    index = 0
    for s0, s1, lateral in TRUCK_ROWS:
        for s in np.arange(s0, s1, TRUCK_PITCH):
            along = np.array([-line.direction(s)[1], line.direction(s)[0], 0.0])
            across = line.direction(s)
            base = line.at(s, lateral)
            floor = ground(*base[:2])
            if floor is None:
                continue
            base[2] = floor
            team = teams[index % len(teams)]
            livery, stripe = srgb(team["colours"]["primary"]), srgb(team["colours"]["secondary"])
            if truck(paint, glass, base, along, across, livery, line, stripe if index % 2 == 0 else None):
                index += 1


def tv_compound(parts, line, ground):
    paint, glass, metal = parts("paddock", "paint"), parts("paddock", "glass"), parts("paddock", "metal")
    s0, s1, gap, rows = TV_COMPOUND
    for row in range(rows):
        for s in np.arange(s0, s1, 4.6):
            lateral = line.wall(s, 1) + gap + row * 22.0
            base = line.at(s, lateral)
            floor = ground(*base[:2])
            if floor is None:
                continue
            base[2] = floor
            along = np.array([-line.direction(s)[1], line.direction(s)[0], 0.0])
            if truck(paint, glass, base, along, line.direction(s), WHITE, line):
                metal.beam(base + along * -2.0 + UP * 3.95, base + along * 10.0 + UP * 3.95, 0.5, FRAME, depth=0.35)
        parts.footprint("tv compound", [line.at(s, line.wall(s, 1) + gap + row * 22.0 + c)[:2] for s, c in ((s0 - 9, -2), (s1 + 9, -2), (s1 + 9, 18), (s0 - 9, 18))])


def helipads(parts, line, ground):
    pad = parts("paddock", "concrete")
    paint = parts("paddock", "paint")
    for s, lateral in HELIPADS:
        along = line.direction(s)
        across = np.array([-along[1], along[0], 0.0])
        centre = line.at(s, lateral)
        floor = ground(*centre[:2])
        if floor is None:
            continue
        centre[2] = floor
        pad.slab(centre - along * 9 - across * 9 - UP * 0.3, along * 18, across * 18, 0.42, srgb("#8d8b86"))
        top = centre + UP * 0.13
        ring = [top + (along * math.cos(t) + across * math.sin(t)) * 7.0 for t in np.linspace(0, 2 * math.pi, 33)]
        inner = [top + (along * math.cos(t) + across * math.sin(t)) * 6.4 for t in np.linspace(0, 2 * math.pi, 33)]
        for k in range(32):
            paint.poly([inner[k], inner[k + 1], ring[k + 1], ring[k]], YELLOW)
        for a0, a1, c0, c1 in ((-2.6, 2.6, -2.2, -1.5), (-2.6, 2.6, 1.5, 2.2), (-0.35, 0.35, -1.5, 1.5)):
            p = top + UP * 0.005
            paint.poly([p + along * a0 + across * c0, p + along * a1 + across * c0, p + along * a1 + across * c1, p + along * a0 + across * c1], WHITE)


def zip_tower(parts, line, ground):
    steel, paint = parts("speedcity", "metal"), parts("speedcity", "paint")
    s, lateral, height = ZIP_TOWER
    base = line.at(s, lateral)
    floor = ground(*base[:2])
    base[2] = floor
    along = line.direction(s)
    across = np.array([-along[1], along[0], 0.0])
    half = 2.2
    corners = [base + along * a * half + across * b * half for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    parts.footprint("zip line tower", [c[:2] for c in corners])
    for c in corners:
        steel.tube([c - UP * 0.5, c + UP * height], 0.22, STEEL, 8)
    for z in np.arange(0.0, height, 3.2):
        ring = [c + UP * z for c in corners]
        for k in range(4):
            steel.beam(ring[k], ring[(k + 1) % 4], 0.16, STEEL)
            steel.rod(ring[k], corners[(k + 1) % 4] + UP * min(z + 3.2, height), 0.06, STEEL, 4)
        paint.slab(corners[0] + UP * z - UP * 0.1, along * half * 2, across * half * 2, 0.1, DECK)
    top = base + UP * height
    paint.slab(top - along * 4 - across * 4, along * 8, across * 8, 0.3, STEEL)
    railing(steel, [top - along * 4 - across * 4 + UP * 0.3, top + along * 4 - across * 4 + UP * 0.3, top + along * 4 + across * 4 + UP * 0.3, top - along * 4 + across * 4 + UP * 0.3, top - along * 4 - across * 4 + UP * 0.3], 1.1, STEEL, 1.5, 0.04)
    for c in corners:
        steel.beam(c + UP * height, c + UP * (height + 3.6), 0.14, STEEL)
    paint.slab(top - along * 4.4 - across * 4.4 + UP * 3.6, along * 8.8, across * 8.8, 0.25, RED)
    landing = flat(ZIP_LANDING)
    landing[2] = ground(*ZIP_LANDING) + 6.0
    steel.tube([landing - UP * 6.5, landing], 0.3, STEEL, 8)
    for k in (-1.5, -0.5, 0.5, 1.5):
        start = top + UP * 2.4 + across * k
        end = landing + across * k * 0.4
        sag = [start + (end - start) * t - UP * 3.0 * t * (1 - t) for t in np.linspace(0, 1, 16)]
        steel.tube(sag, 0.03, STEEL, 4)


def plaza_canopy(parts, ground):
    (cx, cy), axis, bays, bay, depth, rise = PLAZA_CANOPY
    cloth, frame = parts("plaza", "fabric"), parts("plaza", "paint")
    u = heading(axis)
    n = np.array([-u[1], u[0], 0.0])
    centre = flat((cx, cy))
    floor = ground(cx, cy)
    centre[2] = floor
    length = bays * bay
    origin = centre - u * length / 2 - n * depth / 2
    parts.footprint("plaza canopy", [(origin + u * a + n * b)[:2] for a, b in ((0, 0), (length, 0), (length, depth), (0, depth))], solid=False)
    for k in range(bays + 1):
        for d in (0.0, depth):
            foot = origin + u * k * bay + n * d
            frame.tube([foot - UP * 0.3, foot + UP * (rise - 1.6)], 0.2, WHITE, 8)
        frame.tube([origin + u * k * bay + UP * (rise - 1.6), origin + u * k * bay + n * depth + UP * (rise - 1.6)], 0.16, WHITE, 6)
    for d in (0.0, depth):
        frame.tube([origin + n * d + UP * (rise - 1.6), origin + u * length + n * d + UP * (rise - 1.6)], 0.14, WHITE, 6)
    for k in range(bays):
        grid = np.zeros((7, 9, 3))
        for i, t in enumerate(np.linspace(0, 1, 7)):
            for j, v in enumerate(np.linspace(0, 1, 9)):
                arch = math.sin(math.pi * t) * 1.6
                sag = math.sin(math.pi * v) * 0.6
                grid[i, j] = origin + u * (k + t) * bay + n * v * depth + UP * (rise - 1.6 + arch - sag * (1 - math.sin(math.pi * t)))
        cloth.sheet(grid, WHITE)
        truss(frame, origin + u * (k + 0.5) * bay + UP * (rise - 1.6), origin + u * (k + 0.5) * bay + n * depth + UP * (rise - 1.6), 0.6, WHITE, 0.05, 6)


def plaza(parts, ground):
    (cx, cy), axis, length, width = POOL
    water, coping, paint = parts("plaza", "gloss"), parts("plaza", "concrete"), parts("plaza", "paint")
    u = heading(axis)
    v = np.array([-u[1], u[0], 0.0])
    centre = flat((cx, cy), ground(cx, cy) + 0.05)
    rim = [centre + u * math.cos(t) * length / 2 + v * math.sin(t) * width / 2 for t in np.linspace(0, 2 * math.pi, 33)]
    outer = [centre + u * math.cos(t) * (length / 2 + 1.2) + v * math.sin(t) * (width / 2 + 1.2) for t in np.linspace(0, 2 * math.pi, 33)]
    water.poly(rim[:-1], srgb("#22394a"))
    for k in range(32):
        coping.poly([rim[k], rim[k + 1], outer[k + 1] + UP * 0.3, outer[k] + UP * 0.3], srgb("#c9c4b8"))
        coping.poly([outer[k] + UP * 0.3, outer[k + 1] + UP * 0.3, outer[k + 1] - UP * 0.4, outer[k] - UP * 0.4], srgb("#c9c4b8"))
    for x, y, angle in PAVILIONS:
        pu = heading(angle)
        pv = np.array([-pu[1], pu[0], 0.0])
        base = flat((x, y), ground(x, y))
        parts.footprint("plaza pavilion", [(base + pu * a * 5 + pv * b * 3)[:2] for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
        paint.box(base + UP * 1.6, pu * 5.0, pv * 3.0, UP * 1.8, srgb("#ece9e1"), open_bottom=False)
        paint.poly([base + pu * 5.02 + pv * -2.6 + UP * 0.4, base + pu * 5.02 + pv * 2.6 + UP * 0.4, base + pu * 5.02 + pv * 2.6 + UP * 2.6, base + pu * 5.02 + pv * -2.6 + UP * 2.6], srgb("#2a3238"))
        cloth = parts("plaza", "fabric")
        for sign in (-1, 1):
            mast = base + pu * sign * 6.5 + pv * 4.5
            paint.rod(mast - UP * 0.3, mast + UP * 6.0, 0.08, srgb("#c9ccce"), 5)
        cloth.poly([base + pu * -6.5 + pv * 4.5 + UP * 6.0, base + pu * 6.5 + pv * 4.5 + UP * 5.2, base + pu * 5.0 + pv * -3.0 + UP * 3.6, base + pu * -5.0 + pv * -3.0 + UP * 4.4], WHITE)


def crane(parts, line, ground, spec):
    body, glass, dark = parts("cranes", "paint"), parts("cranes", "glass"), parts("cranes", "metal")
    side = spec["side"]
    s = spec["at"]
    base = line.at(s, side * (line.wall(s, side) + spec["back"]))
    floor = ground(*base[:2])
    if floor is None:
        return
    base[2] = floor
    along = line.direction(s)
    across = np.array([-along[1], along[0], 0.0])
    yellow, black = srgb("#e2b21b"), srgb("#1e1f21")
    body.box(base + UP * 1.55, along * 6.2, across * 1.35, UP * 0.45, yellow, open_bottom=False)
    for k in np.linspace(-4.6, 3.8, 4):
        body.box(base + along * k + UP * 0.6, along * 0.6, across * 1.3, UP * 0.6, TYRE)
    cab = base + along * 5.0
    body.box(cab + UP * 2.6, along * 1.0, across * 0.6 - across * 0.0, UP * 0.9, yellow, open_bottom=False)
    glass.poly([cab + along * 1.01 - across * 0.55 + UP * 2.4, cab + along * 1.01 + across * 0.55 + UP * 2.4, cab + along * 1.01 + across * 0.55 + UP * 3.3, cab + along * 1.01 - across * 0.55 + UP * 3.3], WINDOW)
    for a in (-4.0, 3.6):
        for sign in (-1, 1):
            foot = base + along * a + across * sign * 3.6
            dark.beam(base + along * a + across * sign * 1.3 + UP * 1.2, foot + UP * 0.9, 0.35, yellow)
            dark.beam(foot + UP * 0.9, foot + UP * 0.1, 0.3, yellow)
            dark.box(foot + UP * 0.05, along * 0.5, across * 0.5, UP * 0.05, black)
    turn = base - along * 1.5 + UP * 2.0
    dark.tube([turn, turn + UP * 0.5], [1.3, 1.3], black, 12, caps=True)
    slew = (spec.get("turn", 0.5)) * -side * math.pi
    boom_dir = along * math.cos(slew) + across * math.sin(slew)
    boom_side = np.cross(UP, boom_dir)
    body.box(turn + UP * 1.4 - boom_dir * 2.2, boom_dir * 1.3, boom_side * 1.2, UP * 0.9, yellow, open_bottom=False)
    for k in range(5):
        stripe = turn + UP * 1.4 - boom_dir * 3.51 + boom_side * (-1.0 + k * 0.5)
        body.poly([stripe - boom_side * 0.12 + UP * -0.8, stripe + boom_side * 0.12 + UP * -0.8, stripe + boom_side * 0.3 + UP * 0.8, stripe + boom_side * 0.06 + UP * 0.8], black if k % 2 == 0 else WHITE)
    body.box(turn + UP * 1.3 + boom_side * 1.0 + boom_dir * 0.8, boom_dir * 0.9, boom_side * 0.45, UP * 0.7, yellow, open_bottom=False)
    glass.poly([turn + UP * 1.0 + boom_side * 1.46 + boom_dir * -0.1, turn + UP * 1.0 + boom_side * 1.46 + boom_dir * 1.7, turn + UP * 1.8 + boom_side * 1.46 + boom_dir * 1.7, turn + UP * 1.8 + boom_side * 1.46 + boom_dir * -0.1], WINDOW)
    pivot = turn + UP * 1.6 - boom_dir * 0.8
    rise = math.radians(spec.get("rise", 38.0))
    reach = boom_dir * math.cos(rise) + UP * math.sin(rise)
    sections = ((0.0, 9.0, 0.75), (8.6, 16.5, 0.6), (16.1, 23.0, 0.46))
    for a, b, w in sections:
        body.beam(pivot + reach * a, pivot + reach * b, w * 1.2, yellow, depth=w * 1.6)
    tip = pivot + reach * 23.0
    body.tube([tip - boom_side * 0.4, tip + boom_side * 0.4], [0.45, 0.45], black, 10, caps=True)
    hook = tip - UP * 7.0
    dark.rod(tip, hook, 0.03, black, 3)
    dark.box(hook - UP * 0.5, boom_dir * 0.35, boom_side * 0.25, UP * 0.5, yellow)
    dark.beam(base + along * -5.0 + UP * 1.2, turn - boom_dir * 0.2 + UP * 1.5, 0.3, yellow)
    parts.footprint("crane", [(base + along * a + across * c)[:2] for a, c in ((-6.5, -1.5), (6.5, -1.5), (6.5, 1.5), (-6.5, 1.5))])


def boom_lift(parts, line, ground):
    body, dark = parts("cranes", "paint"), parts("cranes", "metal")
    s, lateral = BOOM_LIFT
    base = line.at(s, lateral)
    floor = ground(*base[:2])
    if floor is None:
        return
    base[2] = floor
    along = line.direction(s)
    across = np.array([-along[1], along[0], 0.0])
    reach = across * math.copysign(1.0, -lateral)
    tan, black = srgb("#c9a43c"), srgb("#1e1f21")
    body.box(base + UP * 0.75, along * 1.25, across * 0.62, UP * 0.4, tan, open_bottom=False)
    for a in (-0.85, 0.85):
        for b in (-0.62, 0.62):
            hub = base + along * a + across * b + UP * 0.32
            dark.tube([hub - across * 0.14, hub + across * 0.14], 0.32, black, 8)
    turret = base + UP * 1.15
    body.box(turret + UP * 0.35, along * 0.65, across * 0.55, UP * 0.35, tan, open_bottom=False)
    knee = turret + UP * 4.6 - reach * 0.6
    tip = knee + UP * 3.2 + reach * 3.4
    body.beam(turret + UP * 0.7, knee, 0.42, tan, depth=0.36)
    body.beam(knee, tip, 0.34, tan, depth=0.3)
    dark.tube([knee - along * 0.3, knee + along * 0.3], 0.16, black, 6)
    basket = tip + reach * 0.5
    body.box(basket - UP * 0.05, along * 0.9, across * 0.45, UP * 0.05, tan, open_bottom=False)
    ring = [basket + along * a + across * b for a, b in ((-0.9, -0.45), (0.9, -0.45), (0.9, 0.45), (-0.9, 0.45), (-0.9, -0.45))]
    railing(dark, ring, 1.0, black, 0.9, 0.03)
    camera = basket + UP * 1.35 + reach * 0.2
    dark.box(camera, along * 0.25, across * 0.4, UP * 0.18, black, open_bottom=False)
    dark.rod(basket, camera - UP * 0.18, 0.04, black, 4)


def terrace(parts, line, ground, write):
    paint, cloth, glass, steel = parts("terrace", "paint"), parts("terrace", "fabric"), parts("terrace", "glass"), parts("terrace", "metal")
    (cx, cy), axis, length, depth, facing = TERRACE
    u = np.array([math.cos(math.radians(axis)), math.sin(math.radians(axis)), 0.0])
    n = np.array([-u[1], u[0], 0.0])
    centre = np.array([cx, cy, 0.0])
    if np.dot(line.at(facing, 0.0)[:2] - centre[:2], n[:2]) < 0:
        n = -n
    corners = [centre + u * a * length / 2 + n * b * depth / 2 for a in (-1, 1) for b in (-1, 1)]
    heights = [ground(*c[:2]) for c in corners]
    if any(h is None for h in heights):
        return
    base = max(heights) + TERRACE_LIFT
    low = min(heights) - 0.4
    centre[2] = base

    def at(a, b, z):
        return centre + u * a + n * b + UP * (z - base)

    half, front = length / 2, depth / 2
    dark, deck, white = srgb("#2c3034"), srgb("#8d8f91"), srgb("#f1f1ee")
    ring = [(-half, -front), (half, -front), (half, front), (-half, front), (-half, -front)]
    for (a0, b0), (a1, b1) in zip(ring, ring[1:]):
        paint.poly([at(a0, b0, low), at(a1, b1, low), at(a1, b1, base), at(a0, b0, base)], dark)
    tread, rise, count = TERRACE_TIER
    for k in range(count):
        b1 = front - k * tread
        b0 = b1 - tread if k < count - 1 else -front
        z = base + k * rise
        paint.poly([at(-half, b0, z), at(half, b0, z), at(half, b1, z), at(-half, b1, z)], deck)
        if k:
            paint.poly([at(-half, b1, z - rise), at(half, b1, z - rise), at(half, b1, z), at(-half, b1, z)], dark)
    glass.poly([at(-half, front, base), at(half, front, base), at(half, front, base + 1.1), at(-half, front, base + 1.1)], srgb("#8fa0a8"))
    steel.beam(at(-half, front, base + 1.1), at(half, front, base + 1.1), 0.06, srgb("#3a3d41"))
    eave_front, eave_back = base + TERRACE_EAVES[0], base + TERRACE_EAVES[1]
    top = base + (count - 1) * rise
    for a in np.linspace(-half + 0.3, half - 0.3, int(length / TERRACE_POSTS) + 1):
        steel.beam(at(a, front - 0.3, base), at(a, front - 0.3, eave_front), 0.2, srgb("#d9dadb"))
        steel.beam(at(a, -front + 0.3, top), at(a, -front + 0.3, eave_back), 0.2, srgb("#d9dadb"))
        steel.beam(at(a, front - 0.3, eave_front), at(a, -front + 0.3, eave_back), 0.16, srgb("#d9dadb"))
    over = 1.2
    cloth.poly([at(-half - 0.5, front + over, eave_front - 0.15), at(half + 0.5, front + over, eave_front - 0.15), at(half + 0.5, -front - 0.2, eave_back + 0.2), at(-half - 0.5, -front - 0.2, eave_back + 0.2)], white)
    cloth.poly([at(-half - 0.5, -front - 0.2, eave_back + 0.2), at(half + 0.5, -front - 0.2, eave_back + 0.2), at(half + 0.5, front + over, eave_front - 0.15), at(-half - 0.5, front + over, eave_front - 0.15)], white)
    paint.poly([at(-half - 0.5, front + over, eave_front - 0.95), at(half + 0.5, front + over, eave_front - 0.95), at(half + 0.5, front + over, eave_front - 0.15), at(-half - 0.5, front + over, eave_front - 0.15)], white)
    paint.poly([at(half, -front, top), at(-half, -front, top), at(-half, -front, eave_back), at(half, -front, eave_back)], white)
    for a in (-half, half):
        paint.poly([at(a, -front, top), at(a, -front + 3.0, top), at(a, -front + 3.0, eave_back - 0.3), at(a, -front, eave_back)], white)
    right = np.cross(-n, UP)
    for a in (-length / 4, length / 4):
        write(paint, "REVRACERS", "barlow", 0.55, at(a, front + over + 0.03, eave_front - 0.85) - right * 2.0, right, UP, n, srgb("#c8102e"))
    outline = [at(a, b, base)[:2] for a, b in ring[:-1]]
    parts.footprint("terrace", outline)
    focus = centre[:2] - n[:2] * TERRACE_FOCUS
    middle = math.atan2(n[1], n[0])
    rows = []
    for k in range(count):
        b = front - (k + 0.5) * tread if k < count - 1 else -front + 2.0
        radius = TERRACE_FOCUS + b
        span = (half - 1.5) / radius
        rows.append({"radius": round(radius, 2), "height": round(float(base + k * rise + 0.45), 2), "from": round(middle - span, 6), "to": round(middle + span, 6)})
    seats = [at(a, b, base)[:2] for a, b in ((-half + 1, -front + 1), (half - 1, -front + 1), (half - 1, front - 0.2), (-half + 1, front - 0.2))]
    parts.footprint("terrace seats", seats, solid=False, focus=[round(float(focus[0]), 2), round(float(-focus[1]), 2)], rows=rows)


def trackside_suites(parts, line, ground, write, spec, label):
    paint, cloth, glass, steel = parts(label, "paint"), parts(label, "fabric"), parts(label, "glass"), parts(label, "metal")
    (cx, cy), axis, length, depth, facing, open_ground = spec
    u = np.array([math.cos(math.radians(axis)), math.sin(math.radians(axis)), 0.0])
    n = np.array([-u[1], u[0], 0.0])
    centre = np.array([cx, cy, 0.0])
    if np.dot(line.at(facing, 0.0)[:2] - centre[:2], n[:2]) < 0:
        n = -n
    half, front = length / 2, depth / 2
    shift = settled(line, [centre + u * a + n * b for a in np.linspace(-half, half, 25) for b in (-front, front + 1.0)])
    if shift is None:
        return
    centre = centre + shift
    corners = [centre + u * a * half + n * b * front for a in (-1, 1) for b in (-1, 1)]
    heights = [ground(*c[:2]) for c in corners]
    if any(h is None for h in heights):
        return
    base = max(heights)
    low = min(heights) - 0.4
    centre[2] = base

    def at(a, b, z):
        return centre + u * a + n * b + UP * z

    floor, spandrel, terrace, roof = SUITES_LEVELS
    dark, white, deck = srgb("#25292d"), srgb("#eeeeeb"), srgb("#9a9c9e")
    ring = [(-half, -front), (half, -front), (half, front), (-half, front), (-half, -front)]
    for (a0, b0), (a1, b1) in zip(ring, ring[1:]):
        paint.poly([at(a0, b0, low - base), at(a1, b1, low - base), at(a1, b1, floor), at(a0, b0, floor)], white if open_ground else dark)
        paint.poly([at(a0, b0, spandrel), at(a1, b1, spandrel), at(a1, b1, terrace), at(a0, b0, terrace)], white)
    for (a0, b0), (a1, b1) in zip(ring[:2] + ring[3:4], ring[1:3] + ring[4:5]):
        paint.poly([at(a0, b0, floor), at(a1, b1, floor), at(a1, b1, spandrel), at(a0, b0, spandrel)], white)
    if open_ground:
        paint.poly([at(-half, -front, floor), at(half, -front, floor), at(half, front, floor), at(-half, front, floor)], deck)
        glass.poly([at(-half, front, floor), at(half, front, floor), at(half, front, floor + 1.1), at(-half, front, floor + 1.1)], srgb("#8fa0a8"))
        for a in np.linspace(-half + 0.3, half - 0.3, int(length / SUITES_BAY) + 1):
            steel.beam(at(a, front - 0.3, floor), at(a, front - 0.3, spandrel), 0.18, white)
    else:
        glass.poly([at(-half, front + 0.02, floor + 0.2), at(half, front + 0.02, floor + 0.2), at(half, front + 0.02, spandrel - 0.15), at(-half, front + 0.02, spandrel - 0.15)], srgb("#2b3640"))
        for a in np.arange(-half, half + 0.01, SUITES_MULLION):
            bay = abs(((a + half) / SUITES_BAY) - round((a + half) / SUITES_BAY)) < 1e-6
            steel.box(at(a, front + 0.08, (floor + spandrel) / 2), u * (0.22 if bay else 0.05), n * 0.08, UP * (spandrel - floor) / 2, white if bay else srgb("#c9cbcc"), open_bottom=False)
    paint.poly([at(-half, -front, terrace), at(half, -front, terrace), at(half, front, terrace), at(-half, front, terrace)], deck)
    glass.poly([at(-half, front, terrace), at(half, front, terrace), at(half, front, terrace + 1.1), at(-half, front, terrace + 1.1)], srgb("#8fa0a8"))
    steel.beam(at(-half, front, terrace + 1.1), at(half, front, terrace + 1.1), 0.06, srgb("#d9dadb"))
    for a in np.linspace(-half + 0.3, half - 0.3, int(length / SUITES_BAY) + 1):
        for b in (front - 0.4, -front + 0.4):
            steel.beam(at(a, b, terrace), at(a, b, roof + (0.0 if b > 0 else 0.6)), 0.14, white)
        steel.beam(at(a, front - 0.4, roof), at(a, -front + 0.4, roof + 0.6), 0.12, white)
    over = 0.8
    cloth.poly([at(-half - 0.3, front + over, roof), at(half + 0.3, front + over, roof), at(half + 0.3, -front - 0.2, roof + 0.65), at(-half - 0.3, -front - 0.2, roof + 0.65)], white)
    cloth.poly([at(-half - 0.3, -front - 0.2, roof + 0.65), at(half + 0.3, -front - 0.2, roof + 0.65), at(half + 0.3, front + over, roof), at(-half - 0.3, front + over, roof)], white)
    paint.poly([at(half, -front, terrace), at(-half, -front, terrace), at(-half, -front, roof + 0.6), at(half, -front, roof + 0.6)], white)
    right = np.cross(-n, UP)
    words = max(1, round(length / SUITES_WORD_EVERY))
    for a in np.linspace(-half, half, words + 2)[1:-1]:
        write(paint, "REVRACERS", "barlow", 0.5, at(a, front + 0.04, spandrel + 0.15) - right * 1.8, right, UP, n, srgb("#c8102e"))
    parts.footprint(label, [at(a, b, 0.0)[:2] for a, b in ring[:-1]])
    focus = centre[:2] - n[:2] * TERRACE_FOCUS
    middle = math.atan2(n[1], n[0])
    rows = []
    for level in ([floor] if open_ground else []) + [terrace]:
        for b in (front - 1.0, front - 2.2, front - 3.4):
            radius = TERRACE_FOCUS + b
            span = (half - 1.0) / radius
            rows.append({"radius": round(radius, 2), "height": round(float(base + level + 0.45), 2), "from": round(middle - span, 6), "to": round(middle + span, 6)})
    seats = [at(a, b, terrace)[:2] for a, b in ((-half + 1, front - 4.0), (half - 1, front - 4.0), (half - 1, front - 0.3), (-half + 1, front - 0.3))]
    parts.footprint(f"{label} terrace", seats, solid=False, focus=[round(float(focus[0]), 2), round(float(-focus[1]), 2)], rows=rows)


def pavilion(parts, ground):
    paint, glass = parts("pavilion", "paint"), parts("pavilion", "glass")
    (cx, cy), axis, length, depth, tall = PAVILION
    u = np.array([math.cos(math.radians(axis)), math.sin(math.radians(axis)), 0.0])
    n = np.array([-u[1], u[0], 0.0])
    centre = np.array([cx, cy, 0.0])
    ring = [centre + u * a * length / 2 + n * b * depth / 2 for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    heights = [ground(*p[:2]) for p in ring]
    if any(h is None for h in heights):
        return
    base, low = max(heights), min(heights) - 0.3
    white, dark = srgb("#efefec"), srgb("#2a2f34")
    for p, q in zip(ring, ring[1:] + ring[:1]):
        a, b = np.array([*p[:2], 0.0]), np.array([*q[:2], 0.0])
        paint.poly([a + UP * low, b + UP * low, b + UP * (base + 0.6), a + UP * (base + 0.6)], dark)
        glass.poly([a + UP * (base + 0.6), b + UP * (base + 0.6), b + UP * (base + 3.4), a + UP * (base + 3.4)], srgb("#3a4650"))
        paint.poly([a + UP * (base + 3.4), b + UP * (base + 3.4), b + UP * (base + tall), a + UP * (base + tall)], white)
    paint.poly([np.array([*p[:2], base + tall]) for p in ring], white)
    parts.footprint("support pavilion", [p[:2] for p in ring])


def platform(parts, line, ground):
    paint, glass, steel = parts("platform", "paint"), parts("platform", "glass"), parts("platform", "metal")
    (cx, cy), facing, length, depth = PLATFORM
    u = line.direction(facing)
    n = np.array([-u[1], u[0], 0.0])
    centre = np.array([cx, cy, 0.0])
    if np.dot(line.at(facing, 0.0)[:2] - centre[:2], n[:2]) < 0:
        n = -n
    half, front = length / 2, depth / 2
    shift = settled(line, [centre + u * a + n * b for a in (-half - 3.0, half) for b in (-front, front)])
    if shift is None:
        return
    centre = centre + shift
    corners = [centre + u * a + n * b for a, b in ((-half, -front), (half, -front), (half, front), (-half, front))]
    heights = [ground(*c[:2]) for c in corners]
    if any(h is None for h in heights):
        return
    base = min(heights)
    legs, box, deck, roof = PLATFORM_LEVELS
    grey, white, dark = srgb("#8f9294"), srgb("#eceeec"), srgb("#3b3f43")

    def at(a, b, z):
        return centre + u * a + n * b + UP * (base + z)

    for a, b in ((-half, -front), (half, -front), (half, front), (-half, front)):
        steel.beam(at(a * 0.95, b * 0.9, -0.4), at(a * 0.95, b * 0.9, legs), 0.3, dark)
    ring = [(-half, -front), (half, -front), (half, front), (-half, front), (-half, -front)]
    for (a0, b0), (a1, b1) in zip(ring, ring[1:]):
        paint.poly([at(a0, b0, legs), at(a1, b1, legs), at(a1, b1, box), at(a0, b0, box)], grey)
        paint.poly([at(a1, b1, legs), at(a0, b0, legs), at(a0, b0, box), at(a1, b1, box)], grey)
    paint.poly([at(a, b, legs) for a, b in ring[:-1]][::-1], grey)
    paint.poly([at(a, b, box) for a, b in ring[:-1]], white)
    glass.poly([at(-half + 0.8, front + 0.02, legs + 1.0), at(half - 0.8, front + 0.02, legs + 1.0), at(half - 0.8, front + 0.02, box - 0.6), at(-half + 0.8, front + 0.02, box - 0.6)], srgb("#2b3640"))
    glass.poly([at(-half, front, box), at(half, front, box), at(half, front, deck), at(-half, front, deck)], srgb("#8fa0a8"))
    for a, b in ((-half, front), (half, front), (half, -front), (-half, -front)):
        steel.beam(at(a * 0.97, b * 0.9, box), at(a * 0.97, b * 0.9, roof), 0.16, white)
    paint.poly([at(-half - 0.4, front + 0.6, roof), at(half + 0.4, front + 0.6, roof), at(half + 0.4, -front - 0.3, roof + 0.3), at(-half - 0.4, -front - 0.3, roof + 0.3)], white)
    paint.poly([at(-half - 0.4, -front - 0.3, roof + 0.3), at(half + 0.4, -front - 0.3, roof + 0.3), at(half + 0.4, front + 0.6, roof), at(-half - 0.4, front + 0.6, roof)], white)
    steps = int(box / PLATFORM_STEP)
    for k in range(steps):
        a = -half - 3.0 + 3.0 * k / steps
        steel.box(at(a, -front + 0.6, (k + 0.5) * PLATFORM_STEP), u * 3.0 / steps / 2, n * 0.55, UP * PLATFORM_STEP / 2, grey, open_bottom=False)
    railing(steel, [at(-half - 3.0, -front + 1.2, 0.0), at(-half, -front + 1.2, box)], 1.0, dark, 1.5, 0.03)
    parts.footprint("viewing platform", [c[:2] for c in corners])
    focus = centre[:2] - n[:2] * TERRACE_FOCUS
    middle = math.atan2(n[1], n[0])
    rows = []
    for b in (front - 0.8, front - 2.0):
        radius = TERRACE_FOCUS + b
        span = (half - 0.6) / radius
        rows.append({"radius": round(radius, 2), "height": round(float(base + box + 0.45), 2), "from": round(middle - span, 6), "to": round(middle + span, 6)})
    seats = [(centre + u * a + n * b)[:2] for a, b in ((-half + 0.5, front - 2.6), (half - 0.5, front - 2.6), (half - 0.5, front - 0.2), (-half + 0.5, front - 0.2))]
    parts.footprint("viewing platform terrace", seats, solid=False, focus=[round(float(focus[0]), 2), round(float(-focus[1]), 2)], rows=rows)


def build(parts, site):
    teams = json.loads((site.root.parent.parent / "cars" / "teams.json").read_text())
    team_units(parts, site.line, site.ground, site.write, teams)
    trucks(parts, site.line, site.ground, teams)
    clutter(parts, site.line, site.ground, teams)
    tv_compound(parts, site.line, site.ground)
    helipads(parts, site.line, site.ground)
    zip_tower(parts, site.line, site.ground)
    plaza_canopy(parts, site.ground)
    plaza(parts, site.ground)
    dressing = json.loads((site.root / "dressing.json").read_text())
    for spec in dressing["cranes"]:
        crane(parts, site.line, site.ground, spec)
    boom_lift(parts, site.line, site.ground)
    terrace(parts, site.line, site.ground, site.write)
    trackside_suites(parts, site.line, site.ground, site.write, SUITES, "trackside suites")
    trackside_suites(parts, site.line, site.ground, site.write, HAIRPIN, "hairpin hospitality")
    trackside_suites(parts, site.line, site.ground, site.write, T1_EXIT, "t1 exit hospitality")
    pavilion(parts, site.ground)
    platform(parts, site.line, site.ground)
