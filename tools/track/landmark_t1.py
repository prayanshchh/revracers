import math

import numpy as np

from landmark_mesh import UP, band, fan, flat, heading, louvres, railing, srgb, truss, unit

CLUBHOUSE_CENTRE = (595.1, -443.7)
CLUBHOUSE_AXIS = 60.4
CLUBHOUSE_WIDTH = 60.0
CLUBHOUSE_DEPTH = 20.0
LEVELS = (5.6, 10.4, 15.2, 17.6, 21.2, 22.2)
SPANDRELS = ((5.6, 6.4), (10.0, 10.8), (15.2, 17.6), (21.2, 22.2))
RIBBONS = ((6.4, 10.0), (10.8, 15.2), (17.6, 21.2))
LOBBY = (-8.0, 30.0)
LOBBY_SET = 3.0
PILOTI_EVERY = 10.0
FIN_EVERY = 3.0
BAND_REACH = 0.35
RIBBON_SET = 0.6
STATION_BAY = (16.0, 29.4)
STATION_HEIGHT = (5.6, 15.2)
FINS = 3
FIN_SPACING = 2.0
FIN_DEPTH = 2.4
FIN_THICKNESS = 0.45
PLINTH_SINK = 1.5
DECK_RAIL = 1.15
POOLS = ((-26.0, -7.5, 12.0, 4.0), (-9.0, -7.5, 10.0, 4.0))
PERGOLAS = (-34.0, 4.0, 14.0)
SIGN_WORDS = (("HILL COUNTRY", "white"), ("CIRCUIT", "red"))
SIGN_HEIGHT = 2.0
SIGN_GAP = 1.4
GONDOLA_LINE = ((300.6, -195.0), (414.1, -275.9), (483.6, -325.5), (590.4, -401.8), (606.3, -413.1))
GONDOLA_MASTS = (15.5, 21.0, 14.0)
GONDOLA_STATION_LIFT = 11.0
GONDOLA_STATION_SHIFT = 12.0
GONDOLA_GAUGE = 5.6
GONDOLA_SAG = 0.02
GONDOLA_CABIN_SPACING = 42.0
CABIN_SIZE = (2.0, 1.9, 2.25)
CABIN_DROP = 3.0
ROPE_RADIUS = 0.05
MAST_RADIUS = (0.8, 0.45)
FLAG_POLE = (562.9, -472.3)
FLAG_POLE_HEIGHT = 56.0
FLAG_SIZE = (10.0, 17.0)
FLAG_WIND = 35.0
FLAG_GRID = (11, 24)

CHARCOAL = srgb("#2b2d31")
CLADDING = srgb("#3a3c41")
GLASS = srgb("#1c242c")
GLASS_TOP = srgb("#7d8c94")
WATER = srgb("#3f8fa6")
TEAK = srgb("#a07850")
FIN_RED = srgb("#b3262c")
WHITE = srgb("#ecebe6")
CONCRETE = srgb("#8b8a86")
STEEL = srgb("#b8bbbe")
DARK_STEEL = srgb("#3d4045")
CABIN_RED = srgb("#c4252b")
GREEN = srgb("#4f6b3a")
SIGN_RED = srgb("#d63a2c")


def frame(centre, axis):
    u = heading(axis)
    n = np.array([-u[1], u[0], 0.0])
    origin = flat(centre)

    def at(a, d, z):
        return origin + u * a + n * d + UP * z

    return at, u, n


def ribbon(parts, at, u, n, a0, a1, low, high):
    glass, paint = parts("clubhouse", "glass"), parts("clubhouse", "paint")
    back = -RIBBON_SET
    glass.poly([at(a0, back, low), at(a1, back, low), at(a1, back, high), at(a0, back, high)], GLASS)
    paint.poly([at(a0, 0.0, low), at(a1, 0.0, low), at(a1, back, low), at(a0, back, low)], CLADDING)
    paint.poly([at(a1, 0.0, high), at(a0, 0.0, high), at(a0, back, high), at(a1, back, high)], CLADDING)
    count = max(1, int(abs(a1 - a0) / FIN_EVERY))
    for k in range(count + 1):
        a = a0 + (a1 - a0) * k / count
        paint.box(at(a, back / 2, (low + high) / 2), u * 0.06, n * abs(back) / 2, UP * (high - low) / 2, CHARCOAL)


def clubhouse(parts, ground, write):
    at0, u, n = frame(CLUBHOUSE_CENTRE, CLUBHOUSE_AXIS)
    half = CLUBHOUSE_WIDTH / 2
    depth = CLUBHOUSE_DEPTH
    floor = ground(*CLUBHOUSE_CENTRE)
    low = ground.under(flat(CLUBHOUSE_CENTRE) - n * depth / 2, u, n, half, depth / 2) - PLINTH_SINK
    parts.footprint("clubhouse", [at0(a, d, 0)[:2] for a, d in ((-half, 0), (half, 0), (half, -depth), (-half, -depth))])

    def front(a, d, z):
        return at0(a, d, floor + z)

    paint, concrete, glass = parts("clubhouse", "paint"), parts("clubhouse", "concrete"), parts("clubhouse", "glass")
    concrete.slab(at0(-half - 4, -depth - 4, low), u * (CLUBHOUSE_WIDTH + 8), n * (depth + 8), floor - low + 0.25, CONCRETE)
    l0, l1 = LOBBY
    lobby = [(l0, -LOBBY_SET), (l1, -LOBBY_SET), (l1, -depth + 2), (l0, -depth + 2)]
    for (a0, d0), (a1, d1) in zip(lobby, lobby[1:] + lobby[:1]):
        glass.poly([front(a0, d0, 0.3), front(a1, d1, 0.3), front(a1, d1, LEVELS[0]), front(a0, d0, LEVELS[0])], GLASS)
    for a in np.arange(l0, l1 + 0.1, 6.0):
        paint.box(front(a, -LOBBY_SET, LEVELS[0] / 2), u * 0.2, n * 0.2, UP * LEVELS[0] / 2, CHARCOAL)
    paint.slab(front(l0, -depth + 2, LEVELS[0] - 0.5), u * (l1 - l0), n * (depth - 2 - LOBBY_SET), 0.5, CHARCOAL)
    for a in np.arange(-half + 4.0, l0 - 1.0, PILOTI_EVERY):
        for d in (-4.0, -depth + 4.0):
            foot = front(a, d, 0.25)
            for lean in (-2.4, 2.4):
                paint.tube([foot, front(a + lean, d, LEVELS[0])], 0.32, CHARCOAL, 8)
    soffit = [front(a, d, LEVELS[0]) for a, d in ((-half, 0), (half, 0), (half, -depth), (-half, -depth))]
    paint.poly(soffit[::-1], srgb("#4a4c51"))
    lamp = parts("clubhouse", "lamp")
    for a in np.arange(-half + 2.0, l0 - 1.0, 3.0):
        for d in np.arange(-1.5, -depth + 1.0, -3.0):
            lamp.box(front(a, d, LEVELS[0] - 0.03), u * 0.3, n * 0.3, UP * 0.03, srgb("#fff3dc"))
    shell = [(-half, 0.0), (half, 0.0), (half, -depth), (-half, -depth)]
    for (a0, d0), (a1, d1) in zip(shell[1:], shell[2:] + shell[:1]):
        for z0, z1 in SPANDRELS:
            paint.poly([front(a0, d0, z0), front(a1, d1, z0), front(a1, d1, z1), front(a0, d0, z1)], CLADDING)
        for z0, z1 in RIBBONS:
            glass.poly([front(a0, d0, z0), front(a1, d1, z0), front(a1, d1, z1), front(a0, d0, z1)], GLASS)
    for z0, z1 in SPANDRELS:
        paint.slab(front(-half - BAND_REACH, -0.4, z0), u * (CLUBHOUSE_WIDTH + 2 * BAND_REACH), n * (0.4 + BAND_REACH), z1 - z0, CLADDING)
    b0, b1 = STATION_BAY
    for z0, z1 in RIBBONS:
        if z1 <= STATION_HEIGHT[1] + 0.1:
            ribbon(parts, front, u, n, -half + 0.5, b0, z0, z1)
        else:
            ribbon(parts, front, u, n, -half + 0.5, half - 0.5, z0, z1)
    paint.slab(front(b0, -depth + 1.0, STATION_HEIGHT[0]), u * (b1 - b0), n * (depth - 1.6), 0.3, CONCRETE)
    paint.poly([front(b0, -depth + 1.5, STATION_HEIGHT[0]), front(b1, -depth + 1.5, STATION_HEIGHT[0]), front(b1, -depth + 1.5, STATION_HEIGHT[1]), front(b0, -depth + 1.5, STATION_HEIGHT[1])], srgb("#1d1f22"))
    wheel = front((b0 + b1) / 2, -depth / 2, STATION_HEIGHT[0] + 3.6)
    paint.tube([wheel - UP * 0.25, wheel + UP * 0.25], [3.2, 3.2], DARK_STEEL, 24, caps=True)
    paint.tube([wheel + UP * 0.25, wheel + UP * 3.0], [0.6, 0.6], DARK_STEEL, 10)
    paint.rod(front(b0 + 1.0, -depth / 2 - GONDOLA_GAUGE / 2, STATION_HEIGHT[0] + 5.4), front(b1 - 1.0, -depth / 2 - GONDOLA_GAUGE / 2, STATION_HEIGHT[0] + 5.4), 0.12, STEEL, 6)
    for k in range(FINS):
        a = half - 0.4 - k * FIN_SPACING
        paint.slab(front(a - FIN_THICKNESS / 2, -0.2, 0.0), u * FIN_THICKNESS, n * FIN_DEPTH, LEVELS[-1] + 0.4, FIN_RED)
    top = LEVELS[-1]
    deck = parts("clubhouse", "timber")
    deck.slab(front(-half + 0.6, -depth + 0.6, top - 0.95), u * (CLUBHOUSE_WIDTH - 1.2), n * (depth - 1.2), 0.08, TEAK)
    edge = [front(-half, 0, top), front(half, 0, top), front(half, -depth, top), front(-half, -depth, top), front(-half, 0, top)]
    for a, b in zip(edge, edge[1:]):
        parts("clubhouse", "glass").poly([a, b, b + UP * DECK_RAIL, a + UP * DECK_RAIL], GLASS_TOP)
        paint.rod(a + UP * DECK_RAIL, b + UP * DECK_RAIL, 0.05, STEEL, 4)
    for a0, d0, length, width in POOLS:
        corner = front(a0, d0 - width / 2, top - 0.85)
        concrete.slab(corner - u * 0.6 - n * 0.6, u * (length + 1.2), n * (width + 1.2), 0.25, WHITE)
        paint.poly([corner + UP * 0.26, corner + u * length + UP * 0.26, corner + u * length + n * width + UP * 0.26, corner + n * width + UP * 0.26], WATER)
        for k in range(int(length / 2.2)):
            lounger = corner + u * (1.1 + k * 2.2) - n * 1.6 + UP * 0.25
            paint.box(lounger + UP * 0.2, u * 0.35, n * 0.95, UP * 0.2, WHITE)
    for a0 in PERGOLAS:
        base = front(a0, -depth + 3.0, top - 0.87)
        for du in (0.0, 9.0):
            for dn in (0.0, 5.0):
                paint.beam(base + u * du + n * dn, base + u * du + n * dn + UP * 2.8, 0.18, WHITE)
        for k in range(16):
            slat = base + u * (k * 0.6) + UP * 2.85
            deck.box(slat + n * 2.5, u * 0.05, n * 2.7, UP * 0.1, TEAK)
    for k, a in enumerate(np.linspace(-half + 3, half - 20, 9)):
        planter = front(a, -2.0, top - 0.87)
        concrete.box(planter + UP * 0.3, u * 1.4, n * 0.5, UP * 0.3, CHARCOAL)
        parts("clubhouse", "paint").tube([planter + UP * 0.6, planter + UP * (1.6 + 0.3 * (k % 3))], [0.7, 0.05], GREEN, 7)
    plant = front(-half + 3, -depth + 1.5, top - 0.9)
    paint.slab(plant, u * 7.0, n * 5.0, 3.2, CLADDING)
    louvres(paint, plant - n * 0.02, u * 7.0, UP * 2.6, -n, 9, DARK_STEEL)
    for k in range(3):
        fan(paint, plant + u * (1.4 + k * 2.2) + n * 2.5 + UP * 3.2, 0.8, STEEL, DARK_STEEL)
    sign_at = front(16.0, BAND_REACH + 0.05, (SPANDRELS[2][0] + SPANDRELS[2][1]) / 2 - SIGN_HEIGHT / 2)
    lift = UP * SIGN_HEIGHT
    paint.poly([sign_at + u * 3.6, sign_at + u * 4.4 + lift * 0.9, sign_at + u * 1.6 + lift * 1.15, sign_at + u * 1.0 + lift * 0.15], SIGN_RED)
    offset = 0.0
    for word, tone in SIGN_WORDS:
        width = write(paint, word, "montserrat", SIGN_HEIGHT, sign_at - u * offset, -u, UP, n, WHITE if tone == "white" else SIGN_RED)
        offset += width + SIGN_GAP
    return floor


def station_point(floor):
    at0, u, n = frame(CLUBHOUSE_CENTRE, CLUBHOUSE_AXIS)
    middle = (STATION_BAY[0] + STATION_BAY[1]) / 2
    return at0(middle, -CLUBHOUSE_DEPTH / 2, floor + STATION_HEIGHT[0] + 5.4)


def rope(a, b, steps=12):
    span = np.linalg.norm((b - a)[:2])
    points = []
    for t in np.linspace(0, 1, steps):
        p = a + (b - a) * t
        points.append(p - UP * 4 * GONDOLA_SAG * span * t * (1 - t))
    return points


def cabin(part, glass, centre, along, colour):
    side = unit(np.cross(UP, along))
    lx, ly, lz = CABIN_SIZE
    floor = centre - UP * lz / 2

    def ring(z, shrink):
        return [floor + UP * z + (along * math.cos(t) * lx / 2 + side * math.sin(t) * ly / 2) * shrink for t in np.linspace(0, 2 * math.pi, 8, endpoint=False) + math.pi / 8]

    levels = [(0.0, 0.82), (0.12, 0.97), (0.95, 1.0), (1.0, 1.0), (1.85, 0.96), (1.92, 0.96), (2.1, 0.82), (2.25, 0.5)]
    rings = [ring(z, k) for z, k in levels]
    part.poly(rings[0][::-1], colour)
    for k, (lower, upper) in enumerate(zip(rings, rings[1:])):
        band(glass if k == 3 else part, lower, upper, GLASS if k == 3 else colour)
    part.poly(rings[-1], colour)
    for corner in rings[3][::2]:
        part.rod(corner, corner + UP * 0.85, 0.05, colour, 4)
    for sign in (-1, 1):
        seam = floor + side * sign * ly / 2 * 1.005
        part.poly([seam - along * 0.45 + UP * 0.15, seam + along * 0.45 + UP * 0.15, seam + along * 0.45 + UP * 1.9, seam - along * 0.45 + UP * 1.9], srgb("#8e1a1f"))
    hook = centre + UP * CABIN_DROP
    arm = [floor + UP * 2.25, floor + UP * 2.6 + side * 0.25, floor + UP * 3.2 + side * 0.55, hook - UP * 0.6 + side * 0.35, hook - UP * 0.2]
    part.tube(arm, 0.07, DARK_STEEL, 6)
    part.box(hook, along * 0.45, side * 0.18, UP * 0.16, DARK_STEEL)
    for k in (-1, 1):
        part.tube([hook + along * k * 0.3 + side * 0.19, hook + along * k * 0.3 + side * 0.26], [0.12, 0.12], STEEL, 8, caps=True)


def mast(part, foot, top, across, along):
    part.box(foot + UP * 0.4, across * 1.8, along * 1.8, UP * 0.7, CONCRETE)
    part.tube([foot, top], np.linspace(MAST_RADIUS[0], MAST_RADIUS[1], 2), STEEL, 14)
    head = top + UP * 0.6
    reach = GONDOLA_GAUGE / 2 + 1.4
    for z in (0.0, 1.6):
        part.box(head + UP * z, across * reach, along * 0.28, UP * 0.2, STEEL)
    for k in np.linspace(-reach, reach, 7):
        part.rod(head + across * k, head + across * k + UP * 1.6, 0.05, STEEL, 4)
    for sign in (-1, 1):
        sheave = head + across * sign * GONDOLA_GAUGE / 2 - UP * 0.6
        part.box(sheave + UP * 0.25, across * 0.12, along * 2.6, UP * 0.12, DARK_STEEL)
        for k in np.linspace(-2.2, 2.2, 6):
            wheel = sheave + along * k
            part.tube([wheel - across * 0.08, wheel + across * 0.08], [0.24, 0.24], DARK_STEEL, 10, caps=True)
        part.beam(head + across * sign * GONDOLA_GAUGE / 2, sheave + UP * 0.25, 0.16, STEEL)
    platform = head + UP * 1.8
    part.box(platform, across * (reach + 0.4), along * 1.3, UP * 0.05, DARK_STEEL)
    ring = [platform + across * a + along * b for a, b in ((-reach, -1.2), (reach, -1.2), (reach, 1.2), (-reach, 1.2), (-reach, -1.2))]
    railing(part, ring, 1.0, STEEL, 1.6, 0.035)
    for sign in (-0.25, 0.25):
        part.rod(foot + UP * 1.1 + along * MAST_RADIUS[0] + across * sign, top + along * MAST_RADIUS[1] + across * sign, 0.03, DARK_STEEL, 3)


def station(parts, ground, start, along, across):
    frame_part, glass = parts("gondola", "paint"), parts("gondola", "glass")
    base = start.copy()
    base[2] = ground(*start[:2]) - 0.4
    deck = start - UP * 1.6
    for da in (-8.0, 0.0, 8.0):
        for dc in (-5.0, 5.0):
            foot = base + along * da + across * dc
            frame_part.beam(foot, foot + UP * (GONDOLA_STATION_LIFT + 2.6), 0.5, WHITE)
        frame_part.beam(base + along * da - across * 5.0 + UP * (GONDOLA_STATION_LIFT + 2.6), base + along * da + across * 5.0 + UP * (GONDOLA_STATION_LIFT + 2.6), 0.5, WHITE)
    frame_part.slab(deck - along * 9.0 - across * 5.4, along * 18.0, across * 10.8, 0.3, CONCRETE)
    hood = []
    for t in np.linspace(0, math.pi, 9):
        hood.append([start + along * a + UP * (2.6 + math.sin(t) * 2.2) + across * math.cos(t) * 5.6 for a in np.linspace(-9.0, 9.0, 7)])
    frame_part.sheet(np.array(hood), WHITE, True)
    wheel = start + along * 6.0 + UP * 0.4
    frame_part.tube([wheel - UP * 0.2, wheel + UP * 0.2], [GONDOLA_GAUGE / 2 + 0.3] * 2, DARK_STEEL, 24, caps=True)
    for dc in (-1, 1):
        a, b = deck - along * 9.0 + across * dc * 5.4, deck + along * 9.0 + across * dc * 5.4
        glass.poly([a + UP * 0.3, b + UP * 0.3, b + UP * 3.4, a + UP * 3.4], GLASS)
        railing(frame_part, [a + UP * 0.3, b + UP * 0.3], 1.1, STEEL)
    stair = deck - along * 9.0 - across * 3.0
    steps = 14
    for k in range(steps):
        tread = stair - along * (k * 0.9) - UP * (k * (deck[2] - base[2] - 0.4) / steps)
        frame_part.box(tread, along * 0.45, across * 1.0, UP * 0.06, DARK_STEEL)
    frame_part.beam(stair, stair - along * steps * 0.9 - UP * (deck[2] - base[2]), 0.25, WHITE)
    parts.footprint("gondola station", [(start + along * a + across * c)[:2] for a, c in ((-9, -5.4), (9, -5.4), (9, 5.4), (-9, 5.4))])


def gondola(parts, ground, end):
    line = [flat(p) for p in GONDOLA_LINE]
    along = unit(line[-1] - line[0])
    across = unit(np.cross(UP, along))
    start = line[0] + along * GONDOLA_STATION_SHIFT
    start[2] = ground(*start[:2]) + GONDOLA_STATION_LIFT
    tops = []
    steel = parts("gondola", "metal")
    for point, height in zip(line[1:4], GONDOLA_MASTS):
        foot = point.copy()
        foot[2] = ground(*point[:2]) - 0.3
        top = foot + UP * (height + 0.3)
        mast(steel, foot, top, across, along)
        tops.append(top - UP * 0.3)
    nodes = [start, *tops, end]
    wire = parts("rope", "metal")
    cabins, glass = parts("gondola", "gloss"), parts("gondola", "glass")
    for sign, phase in ((-1, 0.0), (1, GONDOLA_CABIN_SPACING / 2)):
        offset = across * sign * GONDOLA_GAUGE / 2
        path = []
        for a, b in zip(nodes, nodes[1:]):
            path += rope(a + offset, b + offset)[:-1]
        path.append(nodes[-1] + offset)
        wire.tube(path, ROPE_RADIUS, DARK_STEEL, 4)
        lengths = np.concatenate([[0.0], np.cumsum([np.linalg.norm(b - a) for a, b in zip(path, path[1:])])])
        for distance in np.arange(phase + 14.0, lengths[-1] - 14.0, GONDOLA_CABIN_SPACING):
            k = int(np.searchsorted(lengths, distance)) - 1
            t = (distance - lengths[k]) / (lengths[k + 1] - lengths[k])
            hook = path[k] + (path[k + 1] - path[k]) * t
            cabin(cabins, glass, hook - UP * CABIN_DROP, along * -sign, CABIN_RED)
    station(parts, ground, start, along, across)


def flag(parts, ground):
    foot = flat(FLAG_POLE, ground(*FLAG_POLE) - 0.5)
    top = foot + UP * (FLAG_POLE_HEIGHT + 0.5)
    pole = parts("flagpole", "metal")
    pole.box(foot + UP * 0.6, np.array([1.6, 0, 0]), np.array([0, 1.6, 0]), UP * 0.6, CONCRETE)
    pole.tube([foot, foot + UP * (FLAG_POLE_HEIGHT * 0.5), top], [0.62, 0.45, 0.24], STEEL, 16)
    pole.tube([top, top + UP * 0.6], [0.3, 0.3], srgb("#c9a646"), 10, caps=True)
    hoist, fly = FLAG_SIZE
    wind = heading(FLAG_WIND)
    rows, columns = FLAG_GRID
    grid = np.zeros((rows, columns, 3))
    uvs = np.zeros((rows, columns, 2))
    for i in range(rows):
        for j in range(columns):
            u, v = j / (columns - 1), i / (rows - 1)
            grid[i, j] = top - UP * (0.4 + hoist * (1 - v)) + wind * (0.3 + fly * u) - UP * (0.9 * u * u)
            uvs[i, j] = (u, v)
    parts("flag", "flag").sheet(grid, WHITE, True, uvs)
    pole.box(top - UP * 0.4 + wind * 0.15, wind * 0.25, np.cross(UP, wind) * 0.12, UP * 0.15, STEEL)


def star_polygon(cx, cy, radius):
    points = []
    for k in range(10):
        r = radius if k % 2 == 0 else radius * 0.382
        angle = math.pi / 2 + k * math.pi / 5
        points.append((cx + r * math.cos(angle), cy - r * math.sin(angle)))
    return points


def inside(xs, ys, polygon):
    result = np.zeros(xs.shape, bool)
    for (x0, y0), (x1, y1) in zip(polygon, polygon[1:] + polygon[:1]):
        crosses = (y0 > ys) != (y1 > ys)
        at = x0 + (ys - y0) * (x1 - x0) / np.where(y1 == y0, 1e-9, y1 - y0)
        result ^= crosses & (xs < at)
    return result


def bytes_of(code):
    value = code.lstrip("#")
    return [int(value[i : i + 2], 16) / 255 for i in (0, 2, 4)]


def flag_image(height, width):
    image = np.ones((height, width, 3))
    stripe = height / 13
    red = (np.floor(np.arange(height) / stripe) % 2 == 0)
    image[red] = bytes_of("#b22234")
    canton_h, canton_w = int(round(stripe * 7)), int(round(width * 0.4))
    image[:canton_h, :canton_w] = bytes_of("#3c3b6e")
    ys, xs = np.mgrid[0:canton_h, 0:canton_w] + 0.5
    radius = canton_h / 10 * 0.8
    canton = image[:canton_h, :canton_w]
    for row in range(9):
        count, first = (6, 1) if row % 2 == 0 else (5, 2)
        for k in range(count):
            star = star_polygon((first + 2 * k) * canton_w / 12, (row + 1) * canton_h / 10, radius)
            canton[inside(xs, ys, star)] = 1.0
    return image


def build(parts, site):
    floor = clubhouse(parts, site.ground, site.write)
    gondola(parts, site.ground, station_point(floor))
    flag(parts, site.ground)
