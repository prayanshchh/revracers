import math

import numpy as np

from landmark_mesh import UP, band, flat, heading, railing, srgb, unit

BREAKER_CENTRE = (-263.35, -46.65)
BREAKER_AXIS = 142.5
BREAKER_PATH = (
    (-56, -24, 1.6), (-34, -24, 1.6), (-24, -24, 3.0), (-6, -24, 21.0), (12, -24, 39.0), (18, -24, 40.5), (30, -24, 40.5),
    (36, -24, 33.0), (42, -22, 12.0), (50, -16, 3.5), (60, -4, 6.0), (60, 12, 12.0), (50, 22, 8.0), (36, 24, 3.0),
    (24, 24, 10.0), (16, 22, 22.0), (8, 20, 12.0), (2, 18, 3.5), (-10, 18, 14.0), (-24, 16, 28.0), (-38, 14, 14.0),
    (-50, 10, 4.0), (-62, 0, 8.0), (-64, -14, 4.0), (-58, -22, 1.8),
)
BREAKER_TOWER = (24.0, -24.0, 12.0, 8.0, 40.0)
STATION = (-45.0, -24.0, 26.0, 11.0, 6.5)
PALINDROME_CENTRE = (138.2, 432.5)
PALINDROME_AXIS = 127.7
PALINDROME_PATH = ((-34, 0, 34.0), (-27, 0, 18.0), (-18, 0, 5.0), (-6, 0, 2.5), (8, 0, 2.5), (18, 2, 6.0), (24, 8, 16.0), (20, 14, 22.0), (12, 12, 16.0), (14, 4, 8.0), (24, 0, 5.0), (31, 0, 17.0), (36, 0, 36.0))
WHEEL_CENTRE = (130.0, 352.0)
WHEEL_AXIS = 20.0
WHEEL_RADIUS = 17.0
WHEEL_HUB = 19.5
WHEEL_GONDOLAS = 24
DROP_TOWER = (-196.0, 18.0, 58.0)
SWING_TOWER = (96.5, 371.5, 46.0)
SWING_CHAIRS = 16
TOWN = ((4985, 48, 16, 10, 5.6), (5022, 52, 18, 11, 5.8), (5040, 46, 12, 9, 5.0), (5058, 44, 16, 10, 6.0))
FENCE = (4960, 5110, 5.0, 3.2)
TRACK_RADIUS = 0.13
GAUGE = 1.1

WHITE = srgb("#eff0ee")
TRACK_GREY = srgb("#3a3c40")
RUST = srgb("#7a3f24")
RUST_TRACK = srgb("#2e2a29")
CHECK_BLACK = srgb("#151517")
CHECK_WHITE = srgb("#e9e9e6")
RED = srgb("#b8222b")
GREEN = srgb("#3d9a45")
YELLOW = srgb("#e3b51c")
BLUE = srgb("#2a63b3")
TIMBER = srgb("#8e6240")
TIMBER_DARK = srgb("#5a3c27")
ROOF = srgb("#3f2d22")
FENCE_WOOD = srgb("#9c7454")
CONCRETE = srgb("#9a968f")
GONDOLA_COLOURS = (RED, BLUE, YELLOW, GREEN, srgb("#e0662a"), srgb("#7a3fa0"))


class Ride:
    def __init__(self, ground, centre, axis):
        self.u = heading(axis)
        self.v = np.array([-self.u[1], self.u[0], 0.0])
        self.origin = flat(centre)
        self.ground = ground
        self.base = ground(*centre)

    def at(self, u, v, z):
        return self.origin + self.u * u + self.v * v + UP * (self.base + z)

    def floor(self, point):
        return self.ground(point[0], point[1])


def catmull(points, samples):
    points = [np.asarray(p, float) for p in points]
    padded = [points[0] * 2 - points[1], *points, points[-1] * 2 - points[-2]]
    out = []
    for k in range(1, len(padded) - 2):
        p0, p1, p2, p3 = padded[k - 1 : k + 3]
        for t in np.linspace(0, 1, samples, endpoint=False):
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t**3))
    out.append(points[-1])
    return out


def coaster(ride, parts, name, path, rail, support, closed=False):
    controls = [ride.at(*p) for p in path]
    if closed:
        controls.append(controls[0])
    spine = catmull(controls, 8)
    track = parts(name, "metal")
    frame = parts(name, "paint")
    lefts, rights = [], []
    for k, point in enumerate(spine):
        ahead = unit(spine[min(k + 1, len(spine) - 1)] - spine[max(k - 1, 0)])
        side = unit(np.cross(ahead, UP)) if abs(ahead[2]) < 0.97 else ride.v
        lefts.append(point + side * GAUGE / 2)
        rights.append(point - side * GAUGE / 2)
    track.tube(lefts, TRACK_RADIUS, rail, 5)
    track.tube(rights, TRACK_RADIUS, rail, 5)
    track.tube([p - UP * 0.45 for p in spine], 0.28, rail, 6)
    walked = 0.0
    for k in range(1, len(spine)):
        walked += np.linalg.norm(spine[k] - spine[k - 1])
        if walked < 1.6:
            continue
        walked = 0.0
        track.beam(lefts[k] - UP * 0.1, rights[k] - UP * 0.1, 0.12, rail)
    walked = 0.0
    for k in range(1, len(spine)):
        walked += np.linalg.norm(spine[k] - spine[k - 1])
        point = spine[k]
        floor = ride.floor(point)
        if walked < 9.0 or floor is None or point[2] - floor < 3.0:
            continue
        walked = 0.0
        tall = point[2] - floor
        ahead = unit(spine[min(k + 1, len(spine) - 1)] - spine[k - 1])
        side = unit(np.cross(ahead, UP)) if abs(ahead[2]) < 0.97 else ride.v
        spread = 0.0 if tall < 12.0 else tall * 0.14
        legs = [point + side * spread * sign for sign in ((-1, 1) if spread else (0,))]
        for leg in legs:
            foot = leg.copy()
            foot[2] = floor - 0.5
            frame.tube([foot, point - UP * 0.6], 0.34 if spread else 0.4, support, 10)
            frame.box(foot + UP * 0.5, ride.u * 0.9, ride.v * 0.9, UP * 0.4, CONCRETE)
        if spread:
            for z in (0.35, 0.65):
                a, b = (point - UP * 0.6) * (1 - z) + legs[0] * z, (point - UP * 0.6) * (1 - z) + legs[1] * z
                a[2] = b[2] = point[2] - 0.6 - tall * z
                frame.rod(a, b, 0.16, support, 6)


def lattice_tower(part, ride, u, v, wide, deep, height, colour, levels=None):
    corners = [(u - wide / 2, v - deep / 2), (u + wide / 2, v - deep / 2), (u + wide / 2, v + deep / 2), (u - wide / 2, v + deep / 2)]
    for cu, cv in corners:
        part.tube([ride.at(cu, cv, -0.5), ride.at(cu, cv, height)], 0.35, colour, 8)
    step = levels or 5.0
    for z in np.arange(0.0, height, step):
        ring = [ride.at(cu, cv, z) for cu, cv in corners]
        for a, b in zip(ring, ring[1:] + ring[:1]):
            part.beam(a, b, 0.25, colour)
        top = [ride.at(cu, cv, min(z + step, height)) for cu, cv in corners]
        for k in range(4):
            part.rod(ring[k], top[(k + 1) % 4], 0.12, colour, 5)


def breaker(parts, ground):
    ride = Ride(ground, BREAKER_CENTRE, BREAKER_AXIS)
    coaster(ride, parts, "breaker", BREAKER_PATH, TRACK_GREY, WHITE, closed=True)
    tu, tv, wide, deep, height = BREAKER_TOWER
    frame = parts("breaker", "paint")
    lattice_tower(frame, ride, tu, tv, wide, deep, height - 2.0, WHITE)
    frame.slab(ride.at(tu - wide / 2 - 1.0, tv - deep / 2 - 1.0, height - 6.0), ride.u * (wide + 2.0), ride.v * (deep + 2.0), 3.0, WHITE)
    su, sv, length, width, tall = STATION
    origin = ride.at(su - length / 2, sv - width / 2, -1.0)
    parts.footprint("circuit breaker station", [(origin + ride.u * a + ride.v * b)[:2] for a, b in ((0, 0), (length, 0), (length, width), (0, width))])
    cells = 10
    for i in range(cells):
        for j in range(3):
            colour = CHECK_BLACK if (i + j) % 2 == 0 else CHECK_WHITE
            z0, z1 = j * (tall + 1.0) / 3, (j + 1) * (tall + 1.0) / 3
            a = origin + ride.u * length * i / cells
            b = origin + ride.u * length * (i + 1) / cells
            frame.poly([a + UP * z0, b + UP * z0, b + UP * z1, a + UP * z1], colour)
            far = ride.v * width
            frame.poly([b + far + UP * z0, a + far + UP * z0, a + far + UP * z1, b + far + UP * z1], colour)
    frame.slab(origin + UP * (tall + 1.0), ride.u * length, ride.v * width, 0.6, RED)
    for end in (0.0, length):
        frame.poly([origin + ride.u * end, origin + ride.u * end + ride.v * width, origin + ride.u * end + ride.v * width + UP * (tall + 1.0), origin + ride.u * end + UP * (tall + 1.0)], CHECK_BLACK)


def palindrome(parts, ground):
    ride = Ride(ground, PALINDROME_CENTRE, PALINDROME_AXIS)
    coaster(ride, parts, "palindrome", PALINDROME_PATH, RUST_TRACK, RUST)
    frame = parts("palindrome", "paint")
    for u, top in ((-34.0, 34.0), (36.0, 36.0)):
        lattice_tower(frame, ride, u, 0.0, 3.0, 3.0, top - 1.0, RUST, 4.0)
    hub = ride.at(0.0, 9.0, 9.0)
    for k in range(12):
        angle = k * math.pi / 6
        rim = hub + (ride.u * math.cos(angle) + UP * math.sin(angle)) * 7.0
        frame.rod(hub, rim, 0.15, TIMBER_DARK, 5)
    frame.tube([hub + (ride.u * math.cos(t) + UP * math.sin(t)) * 7.0 for t in np.linspace(0, 2 * math.pi, 33)], 0.35, TIMBER_DARK, 6)
    frame.beam(ride.at(0.0, 9.0, -0.5), hub, 0.6, TIMBER_DARK)
    frame.slab(ride.at(-8.0, -6.0, -0.5), ride.u * 16.0, ride.v * 5.0, 4.0, TIMBER)
    frame.slab(ride.at(-9.0, -6.5, 3.5), ride.u * 18.0, ride.v * 6.0, 0.4, ROOF)


def wheel(parts, ground):
    ride = Ride(ground, WHEEL_CENTRE, WHEEL_AXIS)
    steel = parts("wheel", "paint")
    cars = parts("wheel", "gloss")
    glass = parts("wheel", "glass")
    hub = ride.at(0.0, 0.0, WHEEL_HUB)
    for side in (-1.4, 1.4):
        centre = hub + ride.v * side
        rim = [centre + (ride.u * math.cos(t) + UP * math.sin(t)) * WHEEL_RADIUS for t in np.linspace(0, 2 * math.pi, 73)]
        steel.tube(rim, 0.3, WHITE, 6)
        inner = [centre + (ride.u * math.cos(t) + UP * math.sin(t)) * (WHEEL_RADIUS - 2.4) for t in np.linspace(0, 2 * math.pi, 49)]
        steel.tube(inner, 0.18, WHITE, 5)
        for k in range(WHEEL_GONDOLAS):
            t = 2 * math.pi * k / WHEEL_GONDOLAS
            steel.rod(centre, centre + (ride.u * math.cos(t) + UP * math.sin(t)) * WHEEL_RADIUS, 0.06, WHITE, 4)
            steel.rod(centre + (ride.u * math.cos(t) + UP * math.sin(t)) * (WHEEL_RADIUS - 2.4), centre + (ride.u * math.cos(t + math.pi / WHEEL_GONDOLAS) + UP * math.sin(t + math.pi / WHEEL_GONDOLAS)) * WHEEL_RADIUS, 0.08, WHITE, 4)
    steel.tube([hub - ride.v * 2.2, hub + ride.v * 2.2], 0.9, WHITE, 12)
    for k in range(WHEEL_GONDOLAS):
        t = 2 * math.pi * k / WHEEL_GONDOLAS
        pivot = hub + (ride.u * math.cos(t) + UP * math.sin(t)) * WHEEL_RADIUS
        body = pivot - UP * 1.9
        colour = GONDOLA_COLOURS[k % len(GONDOLA_COLOURS)]
        rings = [[body + UP * z + (ride.u * math.cos(a) * 1.1 + ride.v * math.sin(a) * 1.0) * k for a in np.linspace(0, 2 * math.pi, 8, endpoint=False) + math.pi / 8] for z, k in ((-0.95, 0.7), (-0.8, 1.0), (0.1, 1.0), (1.0, 1.0), (1.2, 0.85), (1.35, 0.45))]
        cars.poly(rings[0][::-1], colour)
        for j, (lower, upper) in enumerate(zip(rings, rings[1:])):
            band(glass if j == 2 else cars, lower, upper, srgb("#26323b") if j == 2 else colour)
        cars.poly(rings[-1], colour)
        for p, q in zip(rings[2], rings[3]):
            cars.beam(p, q, 0.07, colour)
        cars.box(body + UP * 1.47, ride.u * 0.28, ride.v * 0.28, UP * 0.12, srgb("#d8dadb"), open_bottom=False)
        steel.rod(pivot - ride.v * 1.05, pivot + ride.v * 1.05, 0.07, WHITE, 5)
        for side in (-1, 1):
            steel.rod(pivot + ride.v * side * 0.95, body + UP * 1.2 + ride.v * side * 0.9, 0.05, WHITE, 4)
    for side in (-1, 1):
        for lean in (-1, 1):
            foot = ride.at(lean * 13.0, side * 6.5, -0.5)
            steel.tube([foot, hub + ride.v * side * 2.0], 0.55, WHITE, 8)
        steel.beam(ride.at(-13.0, side * 6.5, 6.0), ride.at(13.0, side * 6.5, 6.0), 0.4, WHITE)
    steel.slab(ride.at(-6.0, -9.0, -0.6), ride.u * 12.0, ride.v * 18.0, 1.6, CONCRETE)
    deck = 1.0
    for k in range(5):
        step = ride.at(-6.0 - 0.32 * (k + 1), -2.0, -0.6)
        steel.slab(step, ride.u * 0.32, ride.v * 4.0, deck + 0.6 - 0.2 * (k + 1), CONCRETE)
    edge = [ride.at(a, b, deck) for a, b in ((-6.0, -9.0), (6.0, -9.0), (6.0, 9.0), (-6.0, 9.0), (-6.0, 2.0))]
    railing(steel, edge, 1.05, srgb("#5f6266"), 1.5, 0.035)
    railing(steel, [ride.at(-6.0, -9.0, deck), ride.at(-6.0, -2.0, deck)], 1.05, srgb("#5f6266"), 1.5, 0.035)


def drop_tower(parts, ground):
    x, y, height = DROP_TOWER
    ride = Ride(ground, (x, y), 0.0)
    frame = parts("droptower", "paint")
    bands = (YELLOW, GREEN)
    for k, z in enumerate(np.arange(0.0, height, 6.0)):
        frame.box(ride.at(0.0, 0.0, z + 3.0), ride.u * 1.3, ride.v * 1.3, UP * 3.0, bands[k % 2])
    frame.tube([ride.at(0.0, 0.0, height), ride.at(0.0, 0.0, height + 4.0)], [1.8, 1.0], GREEN, 12, caps=True)
    frame.tube([ride.at(0.0, 0.0, height + 4.0), ride.at(0.0, 0.0, height + 7.0)], [0.2, 0.2], WHITE, 6)
    ring = ride.at(0.0, 0.0, 9.0)
    frame.tube([ring + (ride.u * math.cos(t) + ride.v * math.sin(t)) * 3.4 for t in np.linspace(0, 2 * math.pi, 25)], 0.55, GREEN, 8)
    for k in range(4):
        t = k * math.pi / 2 + math.pi / 4
        frame.beam(ring + (ride.u * math.cos(t) + ride.v * math.sin(t)) * 1.2, ring + (ride.u * math.cos(t) + ride.v * math.sin(t)) * 3.2, 0.5, GREEN)
    for k in range(16):
        t = 2 * math.pi * k / 16
        seat = ring + (ride.u * math.cos(t) + ride.v * math.sin(t)) * 3.6
        frame.box(seat - UP * 0.3, ride.u * 0.35, ride.v * 0.35, UP * 0.5, RED)
    frame.slab(ride.at(-5.0, -5.0, -0.6), ride.u * 10.0, ride.v * 10.0, 1.0, CONCRETE)


def swing_tower(parts, ground):
    x, y, height = SWING_TOWER
    ride = Ride(ground, (x, y), 0.0)
    frame = parts("swing", "paint")
    for k, z in enumerate(np.arange(0.0, height, 3.0)):
        frame.tube([ride.at(0.0, 0.0, z - 0.5 * (k == 0)), ride.at(0.0, 0.0, min(z + 3.0, height))], [1.4 - 0.5 * z / height, 1.4 - 0.5 * min(z + 3.0, height) / height], RED if k % 2 == 0 else WHITE, 14)
    top = ride.at(0.0, 0.0, 36.0)
    frame.tube([top - UP * 1.0, top + UP * 1.0], 4.2, BLUE, 16, caps=True)
    frame.tube([ride.at(0.0, 0.0, height), ride.at(0.0, 0.0, height + 3.0)], [1.4, 0.2], YELLOW, 12)
    for k in range(SWING_CHAIRS):
        t = 2 * math.pi * k / SWING_CHAIRS
        out = ride.u * math.cos(t) + ride.v * math.sin(t)
        arm = top + out * 5.0
        frame.beam(top, arm, 0.25, BLUE)
        seat = arm + out * 5.5 - UP * 9.0
        frame.rod(arm, seat, 0.04, WHITE, 3)
        frame.box(seat, out * 0.35, np.cross(UP, out) * 0.3, UP * 0.3, GONDOLA_COLOURS[k % len(GONDOLA_COLOURS)])
    frame.slab(ride.at(-7.0, -7.0, -0.6), ride.u * 14.0, ride.v * 14.0, 1.0, CONCRETE)


def window(part, glass, origin, along, out, width, height, frame_colour):
    glass.poly([origin, origin + along * width, origin + along * width + UP * height, origin + UP * height], srgb("#1f2326"))
    for a, b in ((origin, origin + along * width), (origin + UP * height, origin + along * width + UP * height), (origin, origin + UP * height), (origin + along * width, origin + along * width + UP * height)):
        part.beam(a + out * 0.05, b + out * 0.05, 0.14, frame_colour)


def storefront(parts, write, base, along, across, length, eave, colour, word):
    wood, glass, trim = parts("town", "timber"), parts("town", "glass"), parts("town", "paint")
    front = base + across * 0.02
    crown = eave + 2.6
    steps = [(0.0, crown - 0.9), (0.18, crown - 0.4), (0.36, crown), (0.64, crown), (0.82, crown - 0.4), (1.0, crown - 0.9)]
    outline = [front + along * length * t + UP * z for t, z in steps]
    wood.poly([front, front + along * length, *outline[::-1]][::-1], colour)
    for (t0, z0), (t1, z1) in zip(steps, steps[1:]):
        trim.beam(front + along * length * t0 + UP * z0 + across * 0.08, front + along * length * t1 + UP * z1 + across * 0.08, 0.22, srgb("#f0e8d8"))
    board = front + along * length * 0.15 + UP * (eave + 0.2) + across * 0.1
    trim.slab(board - across * 0.05, along * length * 0.7, across * 0.12, 1.3, srgb("#efe4c9"))
    write(trim, word, "playfair", 0.85, board + across * 0.09 + along * (length * 0.7 - 0.4) + UP * 0.2, -along, UP, across, srgb("#5a2a1c"))
    doors = max(1, int(length / 6))
    for k in range(doors):
        centre = length * (k + 0.5) / doors
        window(trim, glass, front + along * (centre - 0.75) + across * 0.03, along, across, 1.5, 2.4, srgb("#f0e8d8"))
        for side in (-1, 1):
            window(trim, glass, front + along * (centre + side * 2.2 - 0.6) + UP * 0.9 + across * 0.03, along, across, 1.2, 1.6, srgb("#f0e8d8"))
    for t in np.linspace(0.12, 0.88, max(2, int(length / 4))):
        window(trim, glass, front + along * (length * t - 0.55) + UP * (eave - 2.3) + across * 0.03, along, across, 1.1, 1.6, srgb("#f0e8d8"))


def town(parts, ground, line, write):
    wood, roofing, trim = parts("town", "timber"), parts("town", "metal"), parts("town", "paint")
    colours = (srgb("#b98a5e"), srgb("#8c4a32"), srgb("#c7b48e"), srgb("#6f7d6a"), srgb("#a0673f"))
    words = ("SALOON", "MERCANTILE", "HOTEL", "BAR", "LIVERY")
    for k, (s, gap, length, depth, eave) in enumerate(TOWN):
        centre = line.at(s, -(line.wall(s, -1) + gap + depth / 2))
        along = line.direction(s)
        across = np.array([-along[1], along[0], 0.0])
        floor = ground(*centre[:2])
        if floor is None:
            continue
        base = centre - along * length / 2 - across * depth / 2
        parts.footprint("western town", [(base + along * a + across * b)[:2] for a, b in ((0, 0), (length, 0), (length, depth), (0, depth))])
        base[2] = floor - 0.6
        colour = colours[k % len(colours)]
        wood.slab(base, along * length, across * depth, eave + 0.6, colour)
        ridge = eave + depth * 0.3
        top = base + UP * (eave + 0.6)
        peak = top + across * depth / 2 + UP * (ridge - eave)
        roofing.poly([top - across * 0.5, top + along * length - across * 0.5, peak + along * length, peak], ROOF)
        roofing.poly([top + along * length + across * (depth + 0.5), top + across * (depth + 0.5), peak, peak + along * length], ROOF)
        for end in (top, top + along * length):
            wood.poly([end, end + across * depth, end + (peak - top)], colour)
        storefront(parts, write, base + UP * 0.6 + across * depth, along, across, length, eave, colour, words[k % len(words)])
        deck = base + UP * 0.6 + across * depth
        wood.slab(deck - UP * 0.25, along * length, across * 2.8, 0.25, TIMBER_DARK)
        posts = [deck + across * 2.7 + along * t for t in np.linspace(0.3, length - 0.3, 6)]
        for post in posts:
            trim.beam(post, post + UP * 3.3, 0.2, srgb("#f0e8d8"))
        railing(trim, [posts[0], posts[2]], 0.95, srgb("#f0e8d8"), 1.2, 0.05)
        railing(trim, [posts[3], posts[-1]], 0.95, srgb("#f0e8d8"), 1.2, 0.05)
        roofing.poly([deck + UP * 3.6, deck + along * length + UP * 3.6, deck + along * length + across * 3.0 + UP * 3.2, deck + across * 3.0 + UP * 3.2], ROOF)
        for post in posts[1:-1:2]:
            trim.tube([post + UP * 3.1 - across * 0.3, post + UP * 2.8 - across * 0.3], [0.12, 0.18], srgb("#2b2b2b"), 6, caps=True)
    s0, s1, gap, tall = FENCE
    previous = None
    for s in np.arange(s0, s1, 2.5):
        point = line.at(s, -(line.wall(s, -1) + gap))
        floor = ground(*point[:2])
        if floor is None:
            previous = None
            continue
        point[2] = floor - 0.3
        if previous is not None:
            wood.poly([previous, point, point + UP * tall, previous + UP * tall], FENCE_WOOD)
            trim.beam(point, point + UP * (tall + 0.2), 0.16, TIMBER_DARK)
        previous = point


def build(parts, site):
    breaker(parts, site.ground)
    palindrome(parts, site.ground)
    wheel(parts, site.ground)
    drop_tower(parts, site.ground)
    swing_tower(parts, site.ground)
    town(parts, site.ground, site.line, site.write)
