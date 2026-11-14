import json
import sys
from pathlib import Path

import numpy as np
from scipy.ndimage import gaussian_filter1d

from boulevard_geo import PIT_LANE, START_LINE, STREETS, TIMING_LINE, Osm, Terrain
from training import merged, spans

STEP = 0.25
SPACING = 2.0
MAX_RADIUS = 2000.0
CURVE_SMOOTHING = 11.0
TIGHT_SMOOTHING = 24.0
TIGHT_FROM = 1 / 32
TIGHT_FULL = 1 / 16
TIGHT_REACH = 30.0
DRIFT_SIGMA = 120.0
HEIGHT_SIGMA = 40.0
WIDTH_SMOOTHING = 60.0
BORDER = 0.5
VERGE = 0.4
RUNOFF_BEFORE = 50.0
RUNOFF_AFTER = 90.0
RUNOFF_RAMP = 30.0
RUNOFFS = (
    (-1, 285.0, 420.0, 11.0, False),
    (-1, 2030.0, 2170.0, 15.0, True),
    (1, 3236.0, 3284.0, 5.0, False),
    (-1, 5125.0, 5240.0, 12.0, False),
)
ESCAPES = ((3232.0, 70.0),)
ESCAPE_SMOOTHING = 4.0
ESCAPE_CLOSE = 0.4
ESCAPE_BLOCK = 1.8
ESCAPE_SPILL = 6.0
BOLLARDS = ((12, 4.0),)
BOLLARD_SET = 0.35
INSIDE_SHARE = 0.45
APEX_VERGE = 0.4
WALL_SMOOTHING = 30.0
KERB_WIDTH = 1.2
KERB_ROOM = 0.55
KERB_EASE = 16.0
KERB_SHARE = 0.5
EXIT_SHARE = 0.25
EXIT_KERB = 14.0
KERB_LONGEST_PAUSE = 6.0
KERB_SHORTEST = 10.0
CORNER_KAPPA = 1 / 140
CORNER_MIN_TURN = np.radians(20)
GRID_SLOTS = 22
GRID_SPACING = 8.0
GRID_LATERAL = 3.5
GRID_BEHIND = 16.0
ROUND = 4
DEFAULT_WIDTH = 12.2
PADDOCK_WIDTH = 13.2
TURNS = (
    (1, 318), (2, 540), (3, 589), (4, 714), (5, 1608), (6, 1860), (7, 2069), (8, 2126), (9, 2276),
    (10, 2601), (11, 2626), (12, 3259), (13, 3700), (14, 5186), (15, 5315), (16, 5560), (17, 6048),
)
TURN_SNAP = 40.0
PIT_ENTRY = 5985.0
PIT_EXIT = 255.0
PIT_MOUTH = 50.0
PIT_SPLAY = 40.0
PIT_WALL = 9.9
PIT_WALL_DECK = 0.6
PIT_LANE_SIGN = 16.0
PIT_CLEAR = 2.4
PIT_SPEED = 80
GARAGE_FRONT = 24.0
GARAGE_GAP = 5.0
GARAGE_BAYS = 25
BAY_SPACING = 14.0
FAST_LANE = 15.0
BOX_LATERAL = 20.5
PLAYER_BAY = 7
STRAIGHTS = ((760.0, 1560.0), (3330.0, 5120.0))
SPEED_TRAP = 5060.0


def box(values, width):
    count = max(1, int(round(width / STEP)))
    if count <= 1:
        return values
    kernel = np.ones(count) / count
    padded = np.concatenate([values[-count:], values, values[:count]])
    return np.convolve(padded, kernel, "same")[count:-count]


def wrap_angle(a):
    return (a + np.pi) % (2 * np.pi) - np.pi


def densify(points, values):
    closed = np.vstack([points, points[:1]])
    seg = np.linalg.norm(np.diff(closed, axis=0), axis=1)
    s = np.concatenate([[0.0], np.cumsum(seg)])
    length = s[-1]
    count = int(round(length / STEP))
    fine = np.arange(count) * length / count
    x = np.interp(fine, s, closed[:, 0])
    y = np.interp(fine, s, closed[:, 1])
    owner = np.searchsorted(s, fine, side="right") - 1
    return np.stack([x, y], 1), length, values[np.clip(owner, 0, len(values) - 1)]


def smooth_path(raw, length):
    count = len(raw)
    step = length / count
    delta = np.roll(raw, -1, 0) - raw
    heading = np.arctan2(delta[:, 1], delta[:, 0])
    kappa = wrap_angle(np.roll(heading, -1) - heading) / step
    gentle = box(box(kappa, CURVE_SMOOTHING), CURVE_SMOOTHING)
    tight = box(box(kappa, TIGHT_SMOOTHING), TIGHT_SMOOTHING)
    share = np.clip((np.abs(gentle) - TIGHT_FROM) / (TIGHT_FULL - TIGHT_FROM), 0, 1)
    share = box(windowed_max(share, TIGHT_REACH, TIGHT_REACH), TIGHT_REACH)
    kappa = gentle + (tight - gentle) * share
    total = kappa.sum() * step
    kappa *= 2 * np.pi * np.sign(total) / total
    turned = np.concatenate([[0.0], np.cumsum(kappa[:-1]) * step])
    best = None
    for offset in np.linspace(-0.2, 0.2, 81):
        h = heading[0] + offset + turned
        steps = np.stack([np.cos(h), np.sin(h)], 1) * step
        p = raw[0] + np.concatenate([[[0.0, 0.0]], np.cumsum(steps, 0)[:-1]])
        error = p[-1] + steps[-1] - raw[0]
        p -= np.outer(np.arange(count) / count, error)
        score = np.mean(np.sum((p - raw) ** 2, 1))
        if best is None or score < best[0]:
            best = (score, p)
    path = best[1]
    drift = path - raw
    sigma = DRIFT_SIGMA / step
    drift = np.stack([gaussian_filter1d(drift[:, k], sigma, mode="wrap") for k in range(2)], 1)
    return path - drift


def curvature(path, step):
    delta = np.roll(path, -1, 0) - np.roll(path, 1, 0)
    heading = np.unwrap(np.arctan2(delta[:, 1], delta[:, 0]))
    return np.gradient(heading) / step


def windowed_max(values, before, after):
    lead = int(round(before / STEP))
    trail = int(round(after / STEP))
    out = values.copy()
    for shift in range(-trail, lead + 1, 4):
        out = np.maximum(out, np.roll(values, -shift))
    return out


def runoff_profile(count, step, side):
    s = np.arange(count) * step
    out = np.zeros(count)
    for sign, begin, end, width, _ in RUNOFFS:
        if sign != side:
            continue
        rise = np.clip((s - begin + RUNOFF_RAMP) / RUNOFF_RAMP, 0, 1)
        fall = np.clip((end + RUNOFF_RAMP - s) / RUNOFF_RAMP, 0, 1)
        out = np.maximum(out, width * np.minimum(rise, fall))
    return out


def painted_runoffs():
    return [["left" if sign > 0 else "right", begin, end] for sign, begin, end, _, painted in RUNOFFS if painted]


def walls(kappa, half, step):
    local = np.abs(box(kappa, 10.0))
    broad = box(kappa, 30.0)
    floor = half + BORDER + APEX_VERGE
    base = half + BORDER + VERGE
    cap = np.where(local > 1e-6, INSIDE_SHARE / np.maximum(local, 1e-6), np.inf)
    inside = np.clip(cap, floor, base)
    leftward = windowed_max(np.clip(broad, 0, None), RUNOFF_BEFORE, RUNOFF_AFTER)
    rightward = windowed_max(np.clip(-broad, 0, None), RUNOFF_BEFORE, RUNOFF_AFTER)
    turning_left = leftward >= rightward
    count = len(kappa)
    left = box(np.where(turning_left, inside, base), WALL_SMOOTHING) + runoff_profile(count, step, 1)
    right = box(np.where(turning_left, base, inside), WALL_SMOOTHING) + runoff_profile(count, step, -1)
    return np.maximum(left, floor), np.maximum(right, floor)


def frames(path):
    delta = np.roll(path, -1, 0) - np.roll(path, 1, 0)
    tangent = delta / np.linalg.norm(delta, axis=1)[:, None]
    return tangent, np.stack([-tangent[:, 1], tangent[:, 0]], 1)


def ray_span(base, ray, frame, limits):
    lo, hi = 0.0, np.inf
    for axis, (a, b) in zip(frame, limits):
        p0, dp = base @ axis, ray @ axis
        if abs(dp) < 1e-9:
            if not a <= p0 <= b:
                return np.inf, 0.0
            continue
        t1, t2 = sorted(((a - p0) / dp, (b - p0) / dp))
        lo, hi = max(lo, t1), min(hi, t2)
    return lo, hi


def escape_road(path, step, half, right, start, reach):
    i0 = int(round(start / step)) % len(path)
    tangent, normal = frames(path)
    frame = (tangent[i0], normal[i0])
    limits = ((0.0, reach), (-right[i0], half[i0] + ESCAPE_SPILL))
    return i0, frame, limits


def escape_walls(path, step, half, right):
    tangent, normal = frames(path)
    out = right.copy()
    for start, reach in ESCAPES:
        i0, frame, limits = escape_road(path, step, half, right, start, reach)
        for i in (i0 + np.arange(int(round(2 * reach / step)))) % len(path):
            lo, hi = ray_span(path[i] - path[i0], -normal[i], frame, limits)
            if lo <= half[i] + BORDER and hi > out[i]:
                out[i] = hi
    out = np.maximum(right, box(out, ESCAPE_SMOOTHING))
    count = len(path)
    for start, reach in ESCAPES:
        rows = (int(round(start / step)) + np.arange(int(round(2 * reach / step)))) % count
        peak = int(rows[np.argmax(out[rows])])
        span = int(np.ceil((out[peak] - right[peak]) / (ESCAPE_CLOSE * step)))
        for k in range(peak + 1, peak + span + 1):
            out[k % count] = max(out[k % count], out[(k - 1) % count] - ESCAPE_CLOSE * step)
    return out


def props(path, step, half, right, turns):
    tangent, normal = frames(path)
    count = len(path)
    out = []
    for number, ahead in BOLLARDS:
        turn = next(t for t in turns if t["number"] == number)
        i = int(round((turn["distance"] + ahead) / step)) % count
        sign = 1 if turn["side"] == "left" else -1
        out.append({"kind": "bollard", "distance": round(i * step, 2), "lateral": round(sign * (half[i] + KERB_WIDTH + BOLLARD_SET), 2), "turn": 0.0})
    for start, reach in ESCAPES:
        i0, (_, across), _ = escape_road(path, step, half, right, start, reach)
        rows = (i0 + np.arange(int(round(2 * reach / step)))) % count
        i = int(rows[np.argmax(right[rows])])
        turn = float(np.arctan2(tangent[i][0] * across[1] - tangent[i][1] * across[0], tangent[i] @ across))
        out.append({"kind": "block", "distance": round(i * step, 2), "lateral": round(ESCAPE_BLOCK - float(right[i]), 2), "turn": round(turn, 4)})
    return out


def corners(kappa, step):
    count = len(kappa)
    local = box(kappa, 6.0)
    out = []
    for begin, size in spans(np.abs(local) > CORNER_KAPPA):
        rows = (begin + np.arange(size)) % count
        turn = float(local[rows].sum() * step)
        if abs(turn) < CORNER_MIN_TURN:
            continue
        apex = int(rows[np.argmax(np.abs(local[rows]))])
        out.append({"rows": rows, "turn": turn, "apex": apex})
    return out


def kerbs(kappa, found, length):
    count = len(kappa)
    local = box(kappa, 6.0)
    masks = {"left": np.zeros(count, bool), "right": np.zeros(count, bool)}
    for corner in found:
        reach = int(round(30 / STEP))
        window = (corner["rows"][0] - reach + np.arange(len(corner["rows"]) + 2 * reach)) % count
        sign = np.sign(corner["turn"])
        strength = np.abs(local[window]) * (np.sign(local[window]) == sign)
        peak = strength.max()
        inside = "left" if sign > 0 else "right"
        outside = "right" if sign > 0 else "left"
        masks[inside][window[strength >= KERB_SHARE * peak]] = True
        apex = int(np.argmax(strength))
        tail = np.flatnonzero(strength[apex:] >= EXIT_SHARE * peak)
        last = apex + int(tail.max())
        masks[outside][window[apex + (last - apex) // 3 : last + 1]] = True
        masks[outside][(window[last] + np.arange(1, int(round(EXIT_KERB / STEP)))) % count] = True
    out = []
    for side, mask in masks.items():
        for begin, size in spans(merged(mask, KERB_LONGEST_PAUSE)):
            if size * STEP < KERB_SHORTEST:
                continue
            out.append({
                "kind": "kerb",
                "side": side,
                "from": round(begin * STEP % length, 3),
                "to": round((begin + size) * STEP % length, 3),
                "width": KERB_WIDTH,
            })
    return sorted(out, key=lambda k: k["from"])


def kerb_room(wall, half, surfaces, side, length):
    count = len(wall)
    step = length / count
    kerbed = np.zeros(count)
    for span in surfaces:
        if span["side"] != side:
            continue
        rows = np.arange(int(span["from"] / step), int(span["from"] / step) + int(round(((span["to"] - span["from"]) % length) / step)) + 1) % count
        kerbed[rows] = 1.0
    need = half + KERB_WIDTH + KERB_ROOM
    eased = np.clip(box(kerbed, KERB_EASE) * 2, 0, 1)
    return np.maximum(wall, wall + (need - wall) * eased)


def width_of(tags):
    name = tags.get("name", "")
    if tags.get("highway") == "raceway":
        return PADDOCK_WIDTH
    for road, width in STREETS:
        if name == road:
            return width
    return DEFAULT_WIDTH


def circuit_chain(osm):
    chain = osm.circuit_nodes()
    if chain[0] == chain[-1]:
        chain = chain[:-1]
    first = chain.index(TIMING_LINE)
    return chain[first:] + chain[:first]


def node_widths(osm, chain):
    width = {}
    for member in osm.relations[16696508]["members"]:
        if member["type"] != "way" or member["role"] not in ("forward", "backward"):
            continue
        tags = osm.shapes.get(member["ref"], osm.ways[member["ref"]]).get("tags", {})
        for node in osm.ways[member["ref"]]["nodes"][1:]:
            width[node] = width_of(tags)
    return np.array([width.get(node, DEFAULT_WIDTH) for node in chain])


def resample(position, values, length):
    count = int(round(length / SPACING))
    fine = np.arange(len(position)) * length / len(position)
    s = np.arange(count) * length / count
    x = np.interp(s, fine, position[:, 0], period=length)
    y = np.interp(s, fine, position[:, 1], period=length)
    return s, np.stack([x, y], 1), {k: np.interp(s, fine, v, period=length) for k, v in values.items()}


def on_arc(s, start, end, length):
    return (s - start) % length <= (end - start) % length


def eased(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def pit_walls(s, left, length):
    inside = on_arc(s, PIT_ENTRY, PIT_EXIT, length)
    opening = eased(((s - PIT_ENTRY) % length) / PIT_SPLAY)
    closing = eased(((PIT_EXIT - s) % length) / PIT_SPLAY)
    ramp = np.where(inside, np.minimum(opening, closing), 0.0)
    return left + (np.maximum(GARAGE_FRONT, left) - left) * ramp


def pit_lane(s, xy, values, length):
    rows = np.flatnonzero(on_arc(s, PIT_ENTRY, PIT_EXIT, length))
    rows = rows[np.argsort((s[rows] - PIT_ENTRY) % length)]
    forward = np.roll(xy, -1, 0) - np.roll(xy, 1, 0)
    forward /= np.linalg.norm(forward, axis=1)[:, None]
    normal = np.stack([-forward[:, 1], forward[:, 0]], 1)
    wall = values["left"][rows]
    lateral = np.minimum((PIT_WALL + wall) / 2, wall - PIT_CLEAR)
    lane = xy[rows] + normal[rows] * lateral[:, None]
    wall_start = (PIT_ENTRY + PIT_MOUTH) % length
    wall_end = (PIT_EXIT - PIT_MOUTH) % length
    garage_start = (wall_start + GARAGE_GAP) % length
    garage_end = (wall_end - GARAGE_GAP) % length
    span = (garage_end - garage_start) % length
    spacing = span / max(GARAGE_BAYS, int(span // BAY_SPACING))
    return {
        "side": "left",
        "entry": round(PIT_ENTRY % length, 3),
        "wallStart": round(wall_start, 3),
        "wallEnd": round(wall_end, 3),
        "exit": round(PIT_EXIT % length, 3),
        "pitWall": PIT_WALL,
        "speedLimit": PIT_SPEED,
        "centerline": [
            {"x": round(float(p[0]), ROUND), "y": round(float(h), ROUND), "z": round(float(-p[1]), ROUND)}
            for p, h in zip(lane, values["height"][rows])
        ],
        "garageStart": round(garage_start, 3),
        "garageEnd": round(garage_end, 3),
        "garageFront": GARAGE_FRONT,
        "pitWallDeck": PIT_WALL_DECK,
        "pitLaneSign": PIT_LANE_SIGN,
        "pitBarrier": GARAGE_FRONT,
        "playerBay": PLAYER_BAY,
        "boxDistance": round((garage_start + (PLAYER_BAY + 1) * spacing) % length, 3),
        "boxLateral": BOX_LATERAL,
        "fastLane": FAST_LANE,
        "baySpacing": round(spacing, 4),
    }


def nearest_distance(path, length, point):
    i = int(np.argmin(np.sum((path - point) ** 2, 1)))
    return i * length / len(path)


def build(root):
    osm = Osm(root / "source" / "osm.json")
    terrain = Terrain(root / "source" / "dem.png", osm)
    chain = circuit_chain(osm)
    points = osm.local([osm.nodes[n] for n in chain])
    raw, _, widths = densify(points, node_widths(osm, chain))
    raw_length = np.sum(np.linalg.norm(np.roll(raw, -1, 0) - raw, axis=1))
    path = smooth_path(raw, raw_length)
    length = float(np.sum(np.linalg.norm(np.roll(path, -1, 0) - path, axis=1)))
    step = length / len(path)
    kappa = curvature(path, step)
    width = box(box(widths, WIDTH_SMOOTHING), WIDTH_SMOOTHING)
    half = width / 2
    left, right = walls(kappa, half, step)
    right = escape_walls(path, step, half, right)
    ground = terrain(path)
    ground = gaussian_filter1d(ground, HEIGHT_SIGMA / step, mode="wrap")
    origin_height = ground[0]
    found = corners(kappa, step)
    s, xy, values = resample(
        path, {"width": width, "left": left, "right": right, "height": ground - origin_height}, length
    )
    surfaces = kerbs(kappa, found, length)
    for side in ("left", "right"):
        values[side] = kerb_room(values[side], values["width"] / 2, surfaces, side, length)
    values["left"] = pit_walls(s, values["left"], length)
    centerline = [
        {
            "x": round(float(p[0]), ROUND),
            "y": round(float(values["height"][i]), ROUND),
            "z": round(float(-p[1]), ROUND),
            "width": round(float(values["width"][i]), 3),
            "camber": 0.0,
            "wallLeft": round(float(values["left"][i]), 3),
            "wallRight": round(float(values["right"][i]), 3),
        }
        for i, p in enumerate(xy)
    ]
    start = nearest_distance(path, length, osm.local([osm.nodes[START_LINE]])[0])
    pit = osm.local([osm.nodes[n] for n in osm.way_nodes(PIT_LANE)])
    grid = [
        {
            "distance": round(start - GRID_BEHIND - GRID_SPACING * slot, 3),
            "offset": GRID_LATERAL if slot % 2 == 0 else -GRID_LATERAL,
        }
        for slot in range(GRID_SLOTS)
    ]
    apexes = sorted(c["apex"] * step for c in found)
    local = box(kappa, 6.0)
    turns = []
    for number, approximate in TURNS:
        centre = int(round(approximate / step))
        reach = int(round(TURN_SNAP / step))
        window = (centre + np.arange(-reach, reach + 1)) % len(local)
        best = int(window[np.argmax(np.abs(local[window]))])
        turns.append({"number": number, "distance": round(best * step, 1), "side": "left" if local[best] > 0 else "right"})
    track = {
        "id": root.name,
        "name": "Neon Boulevard Circuit",
        "length": round(length, 3),
        "width": DEFAULT_WIDTH,
        "runoff": BORDER,
        "paintedRunoff": painted_runoffs(),
        "sideSurface": "asphalt-lines",
        "maxRadius": MAX_RADIUS,
        "local": {"station": "KLAS", "precipitation": 106, "timeOfDay": 22.0, "latitude": 36.1147, "longitude": -115.1728, "altitude": 620},
        "centerline": centerline,
        "surfaces": surfaces,
        "pitLane": pit_lane(s, xy, values, length),
        "sectors": [round(length / 3, 3), round(2 * length / 3, 3)],
        "startLine": round(start, 3),
        "grid": grid,
        "turns": turns,
        "straights": [list(pair) for pair in STRAIGHTS],
        "speedTrap": SPEED_TRAP,
        "props": props(path, step, half, right, turns),
    }
    report = {
        "rawLength": round(raw_length, 1),
        "length": round(length, 1),
        "deviation": round(float(np.max(np.min(np.linalg.norm(raw[:, None, :] - path[None, ::40, :], axis=2), axis=1))), 2),
        "minRadius": round(float(1 / np.max(np.abs(box(kappa, 2.0)))), 1),
        "corners": [(round(c["apex"] * step), round(np.degrees(c["turn"]))) for c in found],
        "pitLane": [round(nearest_distance(path, length, p)) for p in pit[[0, -1]]],
        "height": [round(float(ground.min() - origin_height), 2), round(float(ground.max() - origin_height), 2)],
        "apexes": [round(a) for a in apexes],
    }
    return track, report


def main():
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "content/tracks/neon-boulevard")
    track, report = build(root)
    (root / "track.json").write_text(json.dumps(track, indent=1) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
