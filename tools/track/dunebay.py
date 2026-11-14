import json
import sys
from pathlib import Path

import numpy as np
from scipy.ndimage import median_filter

from boulevard import box, corners, curvature, densify, eased, on_arc, resample, smooth_path, windowed_max
from dunebay_geo import PIT_WAYS, Osm
from dunebay_surface import survey as surface_survey

MAX_RADIUS = 2000.0
CALM_SMOOTHING = 70.0
CALM_BELOW = 1 / 700
CALM_REACH = 50.0
RULED = ((330, 1335),)
RULED_EASE = 45.0
WIDTH = 12.0
WIDEST = 14.4
LINE_ALLOWANCE = 0.1
WIDTH_SMOOTHING = 40.0
TIMING_LINE_BEFORE_START = 322.0
BARRIERS = ("wall", "fence", "block", "guard_rail", "jersey_barrier")
WALL_NEAREST = 3.2
WALL_REACH = 118.0
WALL_MEDIAN = 9.0
WALL_SMOOTHING = 6.0
WALL_DEFAULT = 30.0
INSIDE_SHARE = 0.72
INSIDE_FLOOR = 4.5
GRID_SLOTS = 22
GRID_SPACING = 8.0
GRID_LATERAL = 3.5
GRID_FRONT = 291.0
START_LIGHTS = 322.0
PIT_ENTRY = -598.0
PIT_WALL_START = -143.0
PIT_WALL_END = 477.0
PIT_EXIT = 662.0
PIT_WALL = 9.9
PIT_WALL_DECK = 0.6
PIT_LANE_SIGN = 16.0
PIT_SPEED = 80
GARAGE_FRONT = 24.0
GARAGE_START = 10.0
GARAGE_BAYS = 25
BAY_SPACING = 14.25
FAST_LANE = 15.0
BOX_LATERAL = 20.5
PLAYER_BAY = 7
ENTRY_LANE = 4.4
ENTRY_OUTER = 3.2
LANE_SETTLE = 40.0
LANE_SMOOTHING = 30.0
TURNS = (
    (1, 825), (2, 1189), (3, 1411), (4, 1827), (5, 1938), (6, 2286), (7, 2700), (8, 2880), (9, 3013),
    (10, 3240), (11, 3460), (12, 3866), (13, 4040), (14, 4244), (15, 4561), (16, 5008),
)
TURN_SNAP = 40.0
STRAIGHT_LEAD = 110.0
STRAIGHT_STOP = 65.0
STRAIGHT_KAPPA = 1 / 900
STRAIGHT_SHORTEST = 420.0
ROUND = 4


def closed(points):
    return np.vstack([points, points[:1]])


def ruled(middle, first, last):
    rows = np.arange(first, last + 1) % len(middle)
    points = middle[rows]
    centre = points.mean(axis=0)
    _, _, axes = np.linalg.svd(points - centre)
    along = (points - centre) @ axes[0]
    line = centre + np.outer(along, axes[0])
    reach = np.minimum(rows - first, last - rows) if last < len(middle) else np.minimum(np.arange(len(rows)), np.arange(len(rows))[::-1])
    weight = eased(reach / RULED_EASE)[:, None]
    out = middle.copy()
    out[rows] = points + (line - points) * weight
    return out


def survey_path(source):
    survey = json.loads((source / "survey.json").read_text())
    left = np.array(survey["left"], float)
    right = np.array(survey["right"], float)
    middle = (left + right) / 2
    for first, last in RULED:
        middle = ruled(middle, first, last)
    return middle, np.linalg.norm(left - right, axis=1)


def calmed(kappa, curved):
    calm = box(box(kappa, CALM_SMOOTHING), CALM_SMOOTHING)
    straight = (np.abs(calm) < CALM_BELOW).astype(float)
    straight = box(1 - windowed_max(1 - straight, CALM_REACH, CALM_REACH), CALM_REACH)
    return curved + (calm - curved) * straight


def rolled(path, values, start):
    first = int(np.argmin(np.sum((path - start) ** 2, 1)))
    return np.roll(path, -first, 0), np.roll(values, -first)


def barrier_segments(osm):
    starts, ends = [], []
    for way in osm.tagged("barrier", BARRIERS):
        points = osm.local(way["geometry"])
        starts.append(points[:-1])
        ends.append(points[1:])
    return np.vstack(starts), np.vstack(ends)


def first_hits(path, normal, starts, ends, nearest):
    edge = ends - starts
    out = np.full(len(path), np.nan)
    for i, (point, ray) in enumerate(zip(path, normal)):
        offset = starts - point
        denominator = ray[0] * edge[:, 1] - ray[1] * edge[:, 0]
        safe = np.where(np.abs(denominator) < 1e-12, 1e-12, denominator)
        along = (offset[:, 0] * edge[:, 1] - offset[:, 1] * edge[:, 0]) / safe
        across = (offset[:, 0] * ray[1] - offset[:, 1] * ray[0]) / safe
        hit = (along > nearest[i]) & (along < WALL_REACH * 1.5) & (across >= 0) & (across <= 1)
        if hit.any():
            out[i] = along[hit].min()
    return out


def filled(values, default):
    known = np.isfinite(values)
    if not known.any():
        return np.full(len(values), default)
    index = np.arange(len(values))
    return np.interp(index, index[known], values[known], period=len(values))


def walls(osm, path, kappa, half, step):
    tangent = np.roll(path, -1, 0) - np.roll(path, 1, 0)
    tangent /= np.linalg.norm(tangent, axis=1)[:, None]
    normal = np.stack([-tangent[:, 1], tangent[:, 0]], 1)
    starts, ends = barrier_segments(osm)
    rows = slice(None, None, int(round(1.0 / step)))
    nearest = half[rows] + WALL_NEAREST
    local = np.abs(box(kappa, 8.0))
    cap = np.where(local > 1e-6, INSIDE_SHARE / np.maximum(local, 1e-6), np.inf)
    out = []
    for sign in (1, -1):
        coarse = first_hits(path[rows], sign * normal[rows], starts, ends, nearest)
        coarse = median_filter(filled(coarse, WALL_DEFAULT), int(WALL_MEDIAN), mode="wrap")
        wall = np.interp(np.arange(len(path)), np.arange(len(path))[rows], coarse, period=len(path))
        inside = np.sign(box(kappa, 8.0)) == sign
        limit = np.where(inside, np.maximum(cap, half + INSIDE_FLOOR), np.inf)
        wall = np.minimum(np.minimum(wall, limit), WALL_REACH)
        out.append(np.maximum(box(wall, WALL_SMOOTHING), half + INSIDE_FLOOR))
    return out[0], out[1]


def pit_lane(s, xy, values, length):
    entry = PIT_ENTRY % length
    exit_ = PIT_EXIT % length
    rows = np.flatnonzero(on_arc(s, entry, exit_, length))
    rows = rows[np.argsort((s[rows] - entry) % length)]
    forward = np.roll(xy, -1, 0) - np.roll(xy, 1, 0)
    forward /= np.linalg.norm(forward, axis=1)[:, None]
    normal = np.stack([-forward[:, 1], forward[:, 0]], 1)
    lane = xy[rows] - normal[rows] * values["lane"][rows][:, None]
    garage_start = GARAGE_START % length
    garage_end = (GARAGE_START + GARAGE_BAYS * BAY_SPACING) % length
    return {
        "side": "right",
        "entry": round(entry, 3),
        "wallStart": round(PIT_WALL_START % length, 3),
        "wallEnd": round(PIT_WALL_END % length, 3),
        "exit": round(exit_, 3),
        "pitWall": PIT_WALL,
        "speedLimit": PIT_SPEED,
        "centerline": [
            {"x": round(float(p[0]), ROUND), "y": 0.0, "z": round(float(-p[1]), ROUND)} for p in lane
        ],
        "garageStart": round(garage_start, 3),
        "garageEnd": round(garage_end, 3),
        "garageFront": GARAGE_FRONT,
        "pitWallDeck": PIT_WALL_DECK,
        "pitLaneSign": PIT_LANE_SIGN,
        "pitBarrier": GARAGE_FRONT,
        "playerBay": PLAYER_BAY,
        "boxDistance": round((garage_start + (PLAYER_BAY + 1) * BAY_SPACING) % length, 3),
        "boxLateral": BOX_LATERAL,
        "fastLane": FAST_LANE,
        "baySpacing": BAY_SPACING,
    }


def lane_profile(osm, path, step, half):
    lane = osm.chain(PIT_WAYS)
    seg = np.linalg.norm(np.diff(lane, axis=0), axis=1)
    along = np.concatenate([[0.0], np.cumsum(seg)])
    fine = np.arange(0.0, along[-1], 1.0)
    points = np.stack([np.interp(fine, along, lane[:, k]) for k in range(2)], 1)
    tangent = np.roll(path, -1, 0) - np.roll(path, 1, 0)
    tangent /= np.linalg.norm(tangent, axis=1)[:, None]
    normal = np.stack([-tangent[:, 1], tangent[:, 0]], 1)
    total = np.zeros(len(path))
    weight = np.zeros(len(path))
    for point in points:
        i = int(np.argmin(np.sum((path - point) ** 2, 1)))
        total[i] += -(point - path[i]) @ normal[i]
        weight[i] += 1.0
    known = weight > 0
    index = np.arange(len(path))
    profile = np.interp(index, index[known], total[known] / weight[known], period=len(path))
    return np.maximum(box(profile, 12.0), half + ENTRY_LANE / 2)


def held_out(s, lane, length):
    out = lane.copy()
    spacing = length / len(s)
    for start, end, backwards in ((PIT_ENTRY, PIT_WALL_START + LANE_SETTLE, False), (PIT_WALL_END - LANE_SETTLE, PIT_EXIT, True)):
        rows = np.flatnonzero(on_arc(s, start % length, end % length, length))
        rows = rows[np.argsort((s[rows] - start) % length)]
        if backwards:
            rows = rows[::-1]
        out[rows] = np.maximum.accumulate(lane[rows])
    count = max(1, int(round(LANE_SMOOTHING / spacing)))
    padded = np.concatenate([out[-count:], out, out[:count]])
    return np.maximum(np.convolve(padded, np.ones(count) / count, "same")[count:-count], lane)


def pit_side(s, right, lane, length):
    entry = PIT_ENTRY % length
    exit_ = PIT_EXIT % length
    inside = on_arc(s, entry, exit_, length)
    opening = eased(((s - entry) % length) / 40.0)
    closing = eased(((exit_ - s) % length) / 40.0)
    ramp = np.where(inside, np.minimum(opening, closing), 0.0)
    walled = on_arc(s, (PIT_WALL_START - 60.0) % length, (PIT_WALL_END + 60.0) % length, length)
    grow = eased(((s - (PIT_WALL_START - 60.0)) % length) / 60.0)
    shrink = eased((((PIT_WALL_END + 60.0) - s) % length) / 60.0)
    building = np.where(walled, np.minimum(grow, shrink), 0.0)
    outer = lane + ENTRY_LANE / 2 + ENTRY_OUTER
    wall = outer + (GARAGE_FRONT - outer) * building
    return right + (wall - right) * ramp


def numbered(kappa, step):
    local = box(kappa, 6.0)
    reach = int(round(TURN_SNAP / step))
    out = []
    for number, approximate in TURNS:
        window = (int(round(approximate / step)) + np.arange(-reach, reach + 1)) % len(local)
        best = int(window[np.argmax(np.abs(local[window]))])
        out.append({"number": number, "distance": round(best * step, 1), "side": "left" if local[best] > 0 else "right"})
    return out


def straights(kappa, step, length):
    quiet = np.abs(box(kappa, 30.0)) < STRAIGHT_KAPPA
    count = len(kappa)
    out = []
    start = int(np.argmin(quiet))
    run = None
    for k in range(count + 1):
        i = (start + k) % count
        if quiet[i] and k < count:
            run = k if run is None else run
            continue
        if run is not None and (k - run) * step >= STRAIGHT_SHORTEST:
            begin = ((start + run) * step + STRAIGHT_LEAD) % length
            end = ((start + k) * step - STRAIGHT_STOP) % length
            out.append([round(begin, 1), round(end, 1)])
        run = None
    return sorted(out)


def build(root):
    source = root / "source"
    osm = Osm(source / "osm.json")
    middle, surveyed = survey_path(source)
    raw, _, widths = densify(middle, surveyed)
    raw_length = np.sum(np.linalg.norm(np.roll(raw, -1, 0) - raw, axis=1))
    smooth = smooth_path(raw, raw_length, calmed)
    step0 = raw_length / len(smooth)
    line = int(np.argmin(np.sum(smooth**2, 1)))
    start = smooth[(line - int(round(TIMING_LINE_BEFORE_START / step0))) % len(smooth)]
    path, widths = rolled(smooth, widths, start)
    length = float(np.sum(np.linalg.norm(np.roll(path, -1, 0) - path, axis=1)))
    step = length / len(path)
    kappa = curvature(path, step)
    width = np.clip(box(box(widths + LINE_ALLOWANCE, WIDTH_SMOOTHING), WIDTH_SMOOTHING), WIDTH, WIDEST)
    half = width / 2
    left, right = walls(osm, path, kappa, half, step)
    lane = lane_profile(osm, path, step, half)
    found = corners(kappa, step)
    s, xy, values = resample(path, {"width": width, "left": left, "right": right, "lane": lane}, length)
    values["lane"] = held_out(s, values["lane"], length)
    values["right"] = pit_side(s, values["right"], values["lane"], length)
    surface = surface_survey(source, xy, values, length, kappa, found)
    centerline = [
        {
            "x": round(float(p[0]), ROUND),
            "y": 0.0,
            "z": round(float(-p[1]), ROUND),
            "width": round(float(values["width"][i]), 3),
            "camber": 0.0,
            "wallLeft": round(float(values["left"][i]), 3),
            "wallRight": round(float(values["right"][i]), 3),
        }
        for i, p in enumerate(xy)
    ]
    grid = [
        {
            "distance": round(GRID_FRONT - GRID_SPACING * slot, 3),
            "offset": GRID_LATERAL if slot % 2 == 0 else -GRID_LATERAL,
        }
        for slot in range(GRID_SLOTS)
    ]
    turns = numbered(kappa, step)
    track = {
        "id": root.name,
        "name": "Dune Bay Circuit",
        "length": round(length, 3),
        "width": WIDTH,
        "runoff": surface["runoff"],
        "sideSurface": "asphalt-lines",
        "maxRadius": MAX_RADIUS,
        "local": {"station": "OTHH", "precipitation": 75, "timeOfDay": 20.0, "latitude": 25.489, "longitude": 51.4497, "altitude": 12},
        "centerline": centerline,
        "surfaces": surface["kerbs"],
        "gravel": surface["gravel"],
        "sealed": surface["sealed"],
        "pitLane": pit_lane(s, xy, values, length),
        "sectors": [round(length / 3, 3), round(2 * length / 3, 3)],
        "startLine": START_LIGHTS,
        "grid": grid,
        "turns": turns,
        "straights": straights(kappa, step, length),
        "speedTrap": round((PIT_ENTRY % length) + 330.0, 1),
    }
    report = {
        "rawLength": round(float(raw_length), 1),
        "length": round(length, 1),
        "deviation": round(float(np.max(np.min(np.linalg.norm(raw[::8, None, :] - smooth[None, ::8, :], axis=2), axis=1))), 2),
        "minRadius": round(float(1 / np.max(np.abs(box(kappa, 2.0)))), 1),
        "corners": [(t["number"], t["distance"], t["side"]) for t in turns],
        "width": [round(float(width.min()), 2), round(float(width.max()), 2)],
        "walls": [round(float(v), 1) for v in (left.min(), np.median(left), left.max(), right.min(), np.median(right), right.max())],
        "straights": track["straights"],
        "kerbs": len(surface["kerbs"]),
        "gravel": len(surface["gravel"]),
    }
    return track, report


def main():
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "content/tracks/dune-bay")
    track, report = build(root)
    (root / "track.json").write_text(json.dumps(track, indent=1) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
