import math

import numpy as np

from landmark_mesh import UP, srgb

SPAN = (-2.0, 197.0)
BAYS = 12
FRONT = -26.0
REAR = -60.0
FRONT_TOP = 23.6
REAR_TOP = 20.6
FRONT_SAG = 3.2
REAR_SAG = 0.5
APEX_AT = -40.0
LEG_REACH = 5.2
GRID = (9, 11)
SUITE = (-48.0, -60.0)
SUITE_FLOOR = 16.6
SUITE_GLASS = (16.8, 19.4)
SOFFIT = (19.4, 20.0)
SUITE_MULLION = 2.6
OVERHANG = 0.9
TERRACE = 1.1
WALL_PROFILE = ((-19.5, -1.0), (-19.5, 3.4), (-33.7, 12.2), (-35.6, 12.9), (-46.9, 17.7), (-47.2, 20.0), (-62.0, 20.0), (-62.0, -1.0))
WALL_THICK = 0.6
SCREEN = (6.0, 20.0, 12.0, 17.4)
CONCOURSE = (-60.0, -70.0, 8.6)
RAKER_EVERY = 8.25

WHITE = srgb("#f1f0ea")
FABRIC = srgb("#eef1ee")
CONCRETE = srgb("#a9a9a5")
LIGHT_WALL = srgb("#c7c8c4")
GLASS = srgb("#1d252d")
MAROON = srgb("#6e2430")
SCREEN_FRAME = srgb("#16171a")
SCREEN_FACE = srgb("#26303c")
LAMP = srgb("#fff6dd")


def section(v):
    return REAR + (FRONT - REAR) * v, REAR_TOP + (FRONT_TOP - REAR_TOP) * v


def fabric_height(u, v):
    _, top = section(v)
    sag = REAR_SAG + (FRONT_SAG - REAR_SAG) * v**1.6
    return top - sag * math.sin(math.pi * u) ** 0.7 + 0.9 * math.sin(math.pi * v) * (1 - 0.4 * math.sin(math.pi * u))


def canopy(line, parts):
    cloth = parts("grandstand", "fabric")
    steel = parts("grandstand", "paint")
    rows, columns = GRID
    width = (SPAN[1] - SPAN[0]) / BAYS
    for bay in range(BAYS):
        s0 = SPAN[0] + bay * width
        grid = np.zeros((rows, columns, 3))
        for i, v in enumerate(np.linspace(0, 1, rows)):
            lateral, _ = section(v)
            for j, u in enumerate(np.linspace(0, 1, columns)):
                grid[i, j] = line.at(s0 + width * u, lateral, fabric_height(u, v))
        cloth.sheet(grid, FABRIC)
        edge = [grid[-1, j] for j in range(columns)]
        for a, b in zip(edge, edge[1:]):
            steel.rod(a, b, 0.05, WHITE, 4)
    for truss in range(BAYS + 1):
        s = SPAN[0] + truss * width
        ridge = [line.at(s, section(v)[0], fabric_height(0.0, v) - 0.25) for v in np.linspace(0, 1, 8)]
        steel.tube(ridge, 0.22, WHITE, 6)
        v_apex = (APEX_AT - REAR) / (FRONT - REAR)
        apex = line.at(s, APEX_AT, fabric_height(0.0, v_apex) - 0.6)
        for reach in (-LEG_REACH, LEG_REACH):
            foot = line.at(s + reach, SUITE[0] - 2.0, SOFFIT[1])
            if SPAN[0] <= s + reach <= SPAN[1]:
                steel.tube([foot, apex], 0.2, WHITE, 6)
        steel.tube([line.at(s, SUITE[0] - 4.0, SOFFIT[1]), apex], 0.16, WHITE, 6)
        for v in np.linspace(0.15, 0.95, 5):
            low = line.at(s, section(v)[0], fabric_height(0.0, v) - 1.6 * math.sin(math.pi * min(1.0, v / 0.95)))
            steel.rod(low, line.at(s, section(v)[0], fabric_height(0.0, v) - 0.25), 0.06, WHITE, 4)
        steel.tube([line.at(s, section(v)[0], fabric_height(0.0, v) - 1.6 * math.sin(math.pi * min(1.0, v / 0.95))) for v in np.linspace(0.15, 0.95, 5)], 0.1, WHITE, 5)
        parts("grandstand", "lamp").box(apex - UP * 0.4, np.array([0.5, 0, 0]), np.array([0, 0.5, 0]), UP * 0.3, LAMP)


def suites(line, parts):
    paint = parts("grandstand", "paint")
    glass = parts("grandstand", "glass")
    lamp = parts("grandstand", "lamp")
    front, back = SUITE
    s0, s1 = SPAN[0] + 3.0, SPAN[1] - 6.0
    steps = np.linspace(s0, s1, int((s1 - s0) / SUITE_MULLION) + 1)
    for a, b in zip(steps, steps[1:]):
        g0, g1 = SUITE_GLASS
        glass.poly([line.at(a, front, g0), line.at(b, front, g0), line.at(b, front, g1), line.at(a, front, g1)], GLASS)
        paint.poly([line.at(a, front + OVERHANG, SOFFIT[0]), line.at(b, front + OVERHANG, SOFFIT[0]), line.at(b, front + OVERHANG, SOFFIT[1]), line.at(a, front + OVERHANG, SOFFIT[1])], WHITE)
        paint.poly([line.at(a, front, SOFFIT[0]), line.at(b, front, SOFFIT[0]), line.at(b, front + OVERHANG, SOFFIT[0]), line.at(a, front + OVERHANG, SOFFIT[0])], WHITE)
        middle = line.at((a + b) / 2, front + OVERHANG / 2, SOFFIT[0] - 0.03)
        along = line.direction((a + b) / 2)
        lamp.box(middle, along * 0.45, np.cross(UP, along) * 0.09, UP * 0.03, LAMP)
        paint.poly([line.at(a, front + TERRACE, SUITE_FLOOR), line.at(b, front + TERRACE, SUITE_FLOOR), line.at(b, front + TERRACE, g0), line.at(a, front + TERRACE, g0)], MAROON)
        paint.poly([line.at(a, front + TERRACE, g0), line.at(b, front + TERRACE, g0), line.at(b, front, g0), line.at(a, front, g0)], CONCRETE)
        paint.poly([line.at(a, front + 0.2, SOFFIT[0]), line.at(b, front + 0.2, SOFFIT[0]), line.at(b, back, SOFFIT[0]), line.at(a, back, SOFFIT[0])], WHITE)
        paint.box((line.at(a, front, g0) + line.at(a, front, g1)) / 2, np.array([0.06, 0, 0]), np.array([0, 0.06, 0]), UP * (g1 - g0) / 2, SCREEN_FRAME)
        glass.poly([line.at(a, front + TERRACE - 0.05, g0), line.at(b, front + TERRACE - 0.05, g0), line.at(b, front + TERRACE - 0.05, g0 + 1.05), line.at(a, front + TERRACE - 0.05, g0 + 1.05)], srgb("#7e8c93"))
    paint.poly([line.at(s0, back, -1.0), line.at(s1, back, -1.0), line.at(s1, back, REAR_TOP), line.at(s0, back, REAR_TOP)], LIGHT_WALL)
    paint.poly([line.at(s1, front, SOFFIT[1]), line.at(s0, front, SOFFIT[1]), line.at(s0, back, SOFFIT[1]), line.at(s1, back, SOFFIT[1])], CONCRETE)
    for s in np.arange(s0, s1, RAKER_EVERY):
        paint.slab(line.at(s - 0.4, back + 0.6, -1.0), line.direction(s) * 0.8, np.cross(UP, line.direction(s)) * -1.2, SUITE_FLOOR + 1.0, CONCRETE)


def end_walls(line, parts):
    paint = parts("grandstand", "paint")
    for s in (SPAN[0] + 3.0, SPAN[1] - 6.0):
        for offset in (0.0, WALL_THICK):
            outline = [line.at(s + offset, lateral, z) for lateral, z in WALL_PROFILE]
            paint.poly(outline if offset else outline[::-1], LIGHT_WALL)
        for (l0, z0), (l1, z1) in zip(WALL_PROFILE, WALL_PROFILE[1:]):
            paint.poly([line.at(s, l0, z0), line.at(s + WALL_THICK, l0, z0), line.at(s + WALL_THICK, l1, z1), line.at(s, l1, z1)], LIGHT_WALL)
    a, b, low, high = SCREEN
    frame = parts("grandstand", "paint")
    frame.poly([line.at(a - 0.5, SUITE[0] + 1.6, low - 0.5), line.at(b + 0.5, SUITE[0] + 1.6, low - 0.5), line.at(b + 0.5, SUITE[0] + 1.6, high + 0.5), line.at(a - 0.5, SUITE[0] + 1.6, high + 0.5)], SCREEN_FRAME)
    parts("grandstand", "glass").poly([line.at(a, SUITE[0] + 1.65, low), line.at(b, SUITE[0] + 1.65, low), line.at(b, SUITE[0] + 1.65, high), line.at(a, SUITE[0] + 1.65, high)], SCREEN_FACE)


def concourse(line, parts):
    paint = parts("grandstand", "paint")
    glass = parts("grandstand", "glass")
    near, far, top = CONCOURSE
    s0, s1 = SPAN[0] + 3.0, SPAN[1] - 6.0
    origin = line.at(s0, far, -1.0)
    along = line.at(s1, far, -1.0) - origin
    across = line.at(s0, near, -1.0) - origin
    paint.slab(origin, along, across, top + 1.0, LIGHT_WALL)
    parts.footprint("grandstand concourse", [(origin + along * a + across * b)[:2] for a, b in ((0, 0), (1, 0), (1, 1), (0, 1))])
    for a, b in zip(np.arange(s0, s1, 6.0), np.arange(s0 + 6.0, s1 + 6.0, 6.0)):
        glass.poly([line.at(b - 1.0, far - 0.05, 3.2), line.at(a + 1.0, far - 0.05, 3.2), line.at(a + 1.0, far - 0.05, 6.6), line.at(b - 1.0, far - 0.05, 6.6)], GLASS)
    for s in np.arange(s0 + 8.0, s1 - 8.0, 24.0):
        paint.box(line.at(s, (near + far) / 2, top + 0.8), line.direction(s) * 3.0, np.cross(UP, line.direction(s)) * 2.0, UP * 0.8, CONCRETE)


def build(parts, site):
    for piece in (canopy, suites, end_walls, concourse):
        piece(site.line, parts)
