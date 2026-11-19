import numpy as np

from landmark_mesh import UP, Part, fan, louvres, railing, srgb

LAP = 5477.877
GARAGES = (5473.877, 357.992)
FRONT = 29.125
BANNER_LATERAL = FRONT - 3.2 - 0.06
BANNER = (5.6, 7.2)
BANNER_DECK = FRONT - 1.2
BANNER_LIP = 0.6
WORD_EVERY = 7.2
WORD_HEIGHT = 0.95
STREAK = (0.9, 0.11, 0.28)
ROOF = 14.0
ROOF_SPAN = (FRONT + 1.6, FRONT + 24.0)
PLANT_EVERY = 26.0
PLANT_SKIP = 0.5
PLANT_SEED = 41
PLINTH = 0.3
RACK_LATERAL = ROOF_SPAN[0] + 12.8
RACK_EVERY = 6.0
RACK_PIPES = ((0.45, 0.11), (0.68, 0.08))
CLUB = (334.0, 362.5)
CLUB_TOP = 19.0
CLUB_BACK = FRONT + 26.0
CLUB_ROUND = 7.0
CLUB_BANDS = ((15.2, 16.0), (18.4, 19.0))
CLUB_GLASS = (16.0, 18.4)
CLUB_SIGN = 1.2
CLUB_STOREY_FROM = 0.6
CLUB_STOREY = 3.5
CLUB_PANE = 2.5
END_BOARD = (10.5, 18.7, 4.3, 5.6)
END_FRAME = 0.25
END_BEAM = 0.3
END_ANCHOR = FRONT + 0.5
END_WORD = 0.8

YELLOW = srgb("#f2c500")
RED = srgb("#d40511")
WHITE = srgb("#eceeec")
BLACK = srgb("#141516")
PLANT = srgb("#e2e4e3")
PLANT_DARK = srgb("#a9adb0")
PLINTH_GREY = srgb("#9d9b96")
PIPE = srgb("#d4d6d6")
GLASS = srgb("#28323a")


def span():
    a, b = GARAGES
    return a, b + LAP if b < a else b


def banner(line, parts, write):
    paint = parts("pit", "paint")
    s0, s1 = span()
    low, high = BANNER
    steps = np.arange(s0, s1, 4.0).tolist() + [s1]
    for a, b in zip(steps, steps[1:]):
        paint.poly([line.at(a, BANNER_LATERAL, low, True), line.at(b, BANNER_LATERAL, low, True), line.at(b, BANNER_LATERAL, high, True), line.at(a, BANNER_LATERAL, high, True)], YELLOW)
        paint.poly([line.at(b, BANNER_LATERAL, high, True), line.at(a, BANNER_LATERAL, high, True), line.at(a, BANNER_LATERAL + BANNER_LIP, high, True), line.at(b, BANNER_LATERAL + BANNER_LIP, high, True)], YELLOW)
        paint.poly([line.at(b, BANNER_LATERAL + BANNER_LIP, high, True), line.at(a, BANNER_LATERAL + BANNER_LIP, high, True), line.at(a, BANNER_DECK, high, True), line.at(b, BANNER_DECK, high, True)], WHITE)
    out = BANNER_LATERAL - 0.03
    for s in np.arange(s0 + 2.0, s1 - WORD_EVERY, WORD_EVERY):
        base = line.at(s, out, (low + high) / 2 - WORD_HEIGHT / 2, True)
        along = line.direction(s)
        facing = np.array([along[1], -along[0], 0.0])
        length, thick, gap = STREAK
        for k in range(3):
            z = WORD_HEIGHT * (0.2 + 0.28 * k)
            corner = base + UP * z + along * (k * 0.12)
            paint.poly([corner, corner + along * length, corner + along * length + UP * thick + along * 0.1, corner + UP * thick + along * 0.1], RED)
        write(paint, "REVRACERS", "barlow", WORD_HEIGHT, base + along * (length + gap + 0.3), along, UP, facing, RED)


def unit_plant(paint, metal, centre, along, across, length, width, tall):
    paint.box(centre + UP * tall / 2, along * length / 2, across * width / 2, UP * tall / 2, PLANT, open_bottom=False)
    for sign in (-1, 1):
        face = centre + across * sign * width / 2 - along * (length / 2 - 0.4)
        louvres(metal, face + UP * 0.3, along * (length - 0.8), UP * (tall - 0.6), across * sign, max(4, int(tall / 0.25)), PLANT_DARK)
    for k in range(max(1, int(length / 2.2))):
        fan(metal, centre + along * (-length / 2 + 1.1 + k * 2.2) + UP * tall, min(0.8, width * 0.35), PLANT, PLANT_DARK)


def roof(line, parts):
    paint, metal, concrete = parts("pit", "paint"), parts("pit", "metal"), parts("pit", "concrete")
    rng = np.random.default_rng(PLANT_SEED)
    s0, s1 = span()
    near, far = ROOF_SPAN
    for s in np.arange(s0 + 8.0, CLUB[0] + LAP - 6.0, PLANT_EVERY):
        for lateral in (near + 9.0, far - 6.0):
            if rng.random() < PLANT_SKIP:
                continue
            length, width, tall = rng.uniform(3.0, 7.0), rng.uniform(2.0, 3.2), rng.uniform(1.4, 2.4)
            at = s + rng.uniform(-2.0, 2.0)
            centre = line.at(at, lateral, ROOF, True)
            along = line.direction(at)
            across = np.array([-along[1], along[0], 0.0])
            concrete.box(centre + UP * PLINTH / 2, along * (length / 2 + 0.3), across * (width / 2 + 0.3), UP * PLINTH / 2, PLINTH_GREY, open_bottom=False)
            centre = centre + UP * PLINTH
            unit_plant(paint, metal, centre, along, across, length, width, tall)
    stations = np.arange(s0 + 6.0, CLUB[0] + LAP - 10.0, RACK_EVERY)
    for z, radius in RACK_PIPES:
        metal.tube([line.at(s, RACK_LATERAL, ROOF + z, True) for s in stations], radius, PIPE, 6)
    for s in stations:
        foot = line.at(s, RACK_LATERAL, ROOF, True)
        along = line.direction(s)
        across = np.array([-along[1], along[0], 0.0])
        concrete.box(foot + UP * 0.1, along * 0.25, across * 0.4, UP * 0.1, PLINTH_GREY, open_bottom=False)
        metal.box(foot + UP * (RACK_PIPES[-1][0] + 0.1) / 2, along * 0.04, across * 0.04, UP * (RACK_PIPES[-1][0] + 0.1) / 2, PLANT_DARK)
        metal.box(foot + UP * (RACK_PIPES[0][0] - RACK_PIPES[0][1]), along * 0.04, across * 0.25, UP * 0.03, PLANT_DARK)
    for lateral in (near + 0.3, far - 0.3):
        points = [line.at(s, lateral, ROOF, True) for s in np.arange(s0, CLUB[0] + LAP, 6.0)]
        railing(metal, points, 1.05, PLANT_DARK, 2.0, 0.035)
    for s in np.arange(s0 + 40.0, CLUB[0] + LAP - 20.0, 90.0):
        centre = line.at(s, far - 4.0, ROOF, True)
        along = line.direction(s)
        across = np.array([-along[1], along[0], 0.0])
        paint.box(centre + UP * 1.6, along * 2.5, across * 2.0, UP * 1.6, WHITE, open_bottom=False)
        paint.poly([centre - across * 2.01 - along * 0.5 + UP * 0.1, centre - across * 2.01 + along * 0.5 + UP * 0.1, centre - across * 2.01 + along * 0.5 + UP * 2.2, centre - across * 2.01 - along * 0.5 + UP * 2.2], PLANT_DARK)


def club(line, parts, write):
    paint, glass = parts("pit", "paint"), parts("pit", "glass")
    s0, s1 = CLUB
    back = CLUB_BACK
    front = FRONT + 1.0
    outline = []
    for s in np.linspace(s0, s1 - CLUB_ROUND, 8):
        outline.append((s, front))
    for t in np.linspace(0, np.pi / 2, 7)[1:]:
        outline.append((s1 - CLUB_ROUND + CLUB_ROUND * np.sin(t), front + CLUB_ROUND * (1 - np.cos(t))))
    outline.append((s1, back))
    outline.append((s0, back))
    low, top = ROOF - 0.2, CLUB_TOP
    def ring(z):
        return [line.at(s, lateral, z, True) for s, lateral in outline]

    for (z0, z1, colour, look) in ((low, CLUB_BANDS[0][0], WHITE, paint), (CLUB_BANDS[0][0], CLUB_BANDS[0][1], WHITE, paint), (CLUB_GLASS[0], CLUB_GLASS[1], GLASS, glass), (CLUB_BANDS[1][0], top, WHITE, paint)):
        a, b = ring(z0), ring(z1)
        for k in range(len(outline) - 1):
            look.poly([a[k], a[k + 1], b[k + 1], b[k]], colour)
        look.poly([a[-1], a[0], b[0], b[-1]], colour)
    paint.poly(ring(top)[::-1], WHITE)
    curve = [(s, lateral) for s, lateral in outline if s >= s1 - CLUB_ROUND - 0.1 and lateral <= back - 0.1]
    wall_low = 0.0
    for k in range(len(curve) - 1):
        (sa, la), (sb, lb) = curve[k], curve[k + 1]
        paint.poly([line.at(sa, la, wall_low - 0.8, True), line.at(sb, lb, wall_low - 0.8, True), line.at(sb, lb, low, True), line.at(sa, la, low, True)], WHITE)
    paint.poly([line.at(s1, FRONT + 1.0 + CLUB_ROUND, wall_low - 0.8, True), line.at(s1, back, wall_low - 0.8, True), line.at(s1, back, low, True), line.at(s1, FRONT + 1.0 + CLUB_ROUND, low, True)], WHITE)
    for z in np.arange(CLUB_STOREY_FROM, low - 1.0, CLUB_STOREY):
        a, b = line.at(s1 + 0.05, FRONT + 2.5, z, True), line.at(s1 + 0.05, back - 1.5, z, True)
        glass.poly([a, b, b + UP * CLUB_PANE, a + UP * CLUB_PANE], GLASS)
    along = line.direction(s1)
    write(paint, "PADDOCK CLUB", "montserrat", CLUB_SIGN, line.at(s1 + 0.08, FRONT + 9.0, 1.6, True), np.array([-along[1], along[0], 0.0]), UP, along, srgb("#3a3d42"))


def back(line, parts):
    paint, glass = parts("pit", "paint"), parts("pit", "glass")
    s0, s1 = span()
    face = FRONT + 24.0 + 0.06
    steps = np.arange(s0, s1, 6.0).tolist() + [s1]
    for k, (a, b) in enumerate(zip(steps, steps[1:])):
        paint.poly([line.at(b, face, -0.5, True), line.at(a, face, -0.5, True), line.at(a, face, ROOF, True), line.at(b, face, ROOF, True)], WHITE)
        for z0, z1 in ((6.6, 8.6), (10.2, 12.2)):
            glass.poly([line.at(b - 0.6, face + 0.02, z0, True), line.at(a + 0.6, face + 0.02, z0, True), line.at(a + 0.6, face + 0.02, z1, True), line.at(b - 0.6, face + 0.02, z1, True)], GLASS)
        if k % 2 == 0:
            paint.poly([line.at(b - 1.2, face + 0.03, 0.0, True), line.at(a + 1.2, face + 0.03, 0.0, True), line.at(a + 1.2, face + 0.03, 4.2, True), line.at(b - 1.2, face + 0.03, 4.2, True)], PLANT)
            for z in np.arange(0.3, 4.2, 0.35):
                paint.poly([line.at(b - 1.2, face + 0.05, z, True), line.at(a + 1.2, face + 0.05, z, True), line.at(a + 1.2, face + 0.05, z + 0.05, True), line.at(b - 1.2, face + 0.05, z + 0.05, True)], PLANT_DARK)
        paint.box(line.at(a, face + 0.15, ROOF / 2, True), line.direction(a) * 0.08, np.array([-line.direction(a)[1], line.direction(a)[0], 0.0]) * 0.08, UP * ROOF / 2, PLANT_DARK)


def end_board(line, parts, write):
    paint, metal = parts("pit", "paint"), parts("pit", "metal")
    s0, _ = span()
    s = s0 - 0.35
    near, far, low, high = END_BOARD
    frame = END_FRAME
    along = line.direction(s)
    across = np.array([-along[1], along[0], 0.0])

    def at(lateral, z, out=0.0):
        return line.at(s - out, lateral, z, True)

    for sign in (1.0, -1.0):
        paint.poly([at(near - frame, low - frame, 0.02 * sign), at(far + frame, low - frame, 0.02 * sign), at(far + frame, high + frame, 0.02 * sign), at(near - frame, high + frame, 0.02 * sign)][:: int(sign)], BLACK)
        paint.poly([at(near, low, 0.05 * sign), at(far, low, 0.05 * sign), at(far, high, 0.05 * sign), at(near, high, 0.05 * sign)][:: int(sign)], RED)
    top = high + frame
    metal.beam(at(near - frame, top + END_BEAM / 2), at(END_ANCHOR, top + END_BEAM / 2), END_BEAM, BLACK, depth=END_BEAM)
    for lateral in (near + 1.0, (near + far) / 2, far - 1.0):
        metal.beam(at(lateral, high + frame), at(lateral, top + 0.02), 0.08, BLACK)
    width = write(Part(), "REVRACERS", "barlow", END_WORD, at(near, (low + high) / 2, 0.08), -across, UP, -along, WHITE)
    start = at((near + far) / 2, (low + high) / 2 - END_WORD / 2, 0.08) + across * width / 2
    write(paint, "REVRACERS", "barlow", END_WORD, start, -across, UP, -along, WHITE)


def build(parts, site):
    banner(site.line, parts, site.write)
    back(site.line, parts)
    roof(site.line, parts)
    club(site.line, parts, site.write)
    end_board(site.line, parts, site.write)
