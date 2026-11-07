import json
import sys
from pathlib import Path

import numpy as np

STEP = 0.25
SPACING = 2.0
KERB_WIDTH = 1.5
BORDER = 1.5
KERB_SHARE = 0.45
EXIT_SHARE = 0.2
EXIT_KERB = 18.0
KERB_LONGEST_PAUSE = 6.0
KERB_SHORTEST = 12.0
RUNOFF_SCALE = 120.0
RUNOFF_BEFORE = 60.0
RUNOFF_AFTER = 140.0
WALL_SMOOTHING = 40.0
INSIDE_SHARE = 0.6
MIN_VERGE = 2.5
KINK = np.radians(15)
SPEED_TRAP_LEAD = 80.0
ROUND = 4
STRAIGHT_BELOW = 1e-4


def unit(v):
    return v / np.linalg.norm(v)


def cross(a, b):
    return a[0] * b[1] - a[1] * b[0]


def box(values, width):
    count = max(1, int(round(width / STEP)))
    if count <= 1:
        return values
    kernel = np.ones(count) / count
    padded = np.concatenate([values[-count:], values, values[:count]])
    return np.convolve(padded, kernel, "same")[count:-count]


def fillet(layout):
    points = np.array([v["at"] for v in layout["vertices"]], float)
    radii = np.array([v["radius"] for v in layout["vertices"]], float)
    line = np.array(layout["line"], float)
    count = len(points)
    corners = []
    for i in range(count):
        before, here, after = points[i - 1], points[i], points[(i + 1) % count]
        into, out = unit(here - before), unit(after - here)
        turn = np.arctan2(cross(into, out), into @ out)
        reach = radii[i] * np.tan(abs(turn) / 2)
        corners.append((here - into * reach, here + out * reach, turn))
    pieces = [("straight", np.linalg.norm(corners[0][0] - line))]
    for i, (_, leave, turn) in enumerate(corners):
        target = corners[i + 1][0] if i + 1 < count else line
        ahead = target - leave
        if ahead @ unit(points[(i + 1) % count] - points[i]) <= 0:
            raise ValueError(f"corners {i} and {i + 1} overlap")
        pieces.append(("arc", turn, radii[i], i))
        pieces.append(("straight", np.linalg.norm(ahead)))
    kappa, owner = [], []
    for piece in pieces:
        if piece[0] == "arc":
            _, turn, radius, index = piece
            samples = int(round(abs(turn) * radius / STEP))
            kappa += [np.sign(turn) / radius] * samples
            owner += [index] * samples
        else:
            samples = int(round(piece[1] / STEP))
            kappa += [0.0] * samples
            owner += [-1] * samples
    heading = np.arctan2(*(unit(points[0] - points[-1])[::-1]))
    return np.array(kappa), np.array(owner), heading, line, [c[2] for c in corners]


def integrate(kappa, heading0, start):
    heading = heading0 + np.concatenate([[0.0], np.cumsum(kappa[:-1]) * STEP]) + kappa * STEP / 2
    steps = np.stack([np.cos(heading), np.sin(heading)], 1) * STEP
    position = start + np.concatenate([[[0.0, 0.0]], np.cumsum(steps, 0)])
    error = position[-1] - start
    position = position[:-1] - np.outer(np.arange(len(kappa)) / len(kappa), error)
    return position, heading


def closed_curvature(kappa, smoothing):
    smoothed = box(box(kappa, smoothing), smoothing)
    total = smoothed.sum() * STEP
    target = 2 * np.pi * np.sign(total)
    return smoothed * target / total


def resample(position, values, length):
    count = int(round(length / SPACING))
    fine = np.arange(len(position)) * STEP
    s = np.arange(count) * length / count
    x = np.interp(s, fine, position[:, 0], period=length)
    y = np.interp(s, fine, position[:, 1], period=length)
    return s, np.stack([x, y], 1), {k: np.interp(s, fine, v, period=length) for k, v in values.items()}


def windowed_max(values, before, after):
    lead = int(round(before / STEP))
    trail = int(round(after / STEP))
    out = values.copy()
    for shift in range(-trail, lead + 1, 4):
        out = np.maximum(out, np.roll(values, -shift))
    return out


def walls(kappa, half, verge, runoff):
    local = np.abs(box(kappa, 10.0))
    broad = box(kappa, 30.0)
    intensity = windowed_max(np.clip(np.abs(broad) * RUNOFF_SCALE, 0, 1), RUNOFF_BEFORE, RUNOFF_AFTER)
    floor = half + BORDER + MIN_VERGE
    base = half + BORDER + verge
    outside = base + runoff * intensity
    cap = np.where(local > 1e-6, INSIDE_SHARE / np.maximum(local, 1e-6), np.inf)
    inside = np.clip(cap, floor, base)
    leftward = windowed_max(np.clip(broad, 0, None), RUNOFF_BEFORE, RUNOFF_AFTER)
    rightward = windowed_max(np.clip(-broad, 0, None), RUNOFF_BEFORE, RUNOFF_AFTER)
    turning_left = leftward >= rightward
    left = box(np.where(turning_left, inside, outside), WALL_SMOOTHING)
    right = box(np.where(turning_left, outside, inside), WALL_SMOOTHING)
    limit = np.maximum(cap, floor)
    left = np.where(turning_left, np.minimum(left, limit), left)
    right = np.where(turning_left, right, np.minimum(right, limit))
    return np.maximum(left, floor), np.maximum(right, floor)


def spans(mask):
    count = len(mask)
    if mask.all():
        return [(0, count)]
    start = int(np.argmin(mask))
    rolled = np.roll(mask, -start)
    out, begin = [], None
    for i, on in enumerate(np.append(rolled, False)):
        if on and begin is None:
            begin = i
        if not on and begin is not None:
            out.append(((begin + start) % count, (i - begin)))
            begin = None
    return out


def merged(mask, gap):
    filled = mask.copy()
    reach = int(round(gap / STEP))
    for begin, size in spans(~mask):
        if size <= reach:
            filled[(begin + np.arange(size)) % len(mask)] = True
    return filled


def corner_windows(owner, turns, count):
    centres = []
    for index in range(len(turns)):
        own = np.flatnonzero(owner == index)
        centres.append(int(own[len(own) // 2]) if len(own) else None)
    windows = []
    for index, centre in enumerate(centres):
        if centre is None:
            windows.append(None)
            continue
        before = centres[index - 1]
        after = centres[(index + 1) % len(centres)]
        back = (centre - before) % count // 2
        ahead = (after - centre) % count // 2
        windows.append((centre + np.arange(-back, ahead + 1)) % count)
    return windows


def kerb_spans(mask, length):
    out = []
    for begin, size in spans(merged(mask, KERB_LONGEST_PAUSE)):
        if size * STEP < KERB_SHORTEST:
            continue
        out.append((round(begin * STEP % length, 3), round((begin + size) * STEP % length, 3)))
    return out


def kerbs(kappa, owner, turns, length):
    count = len(kappa)
    local = box(kappa, 6.0)
    masks = {"left": np.zeros(count, bool), "right": np.zeros(count, bool)}
    for index, window in enumerate(corner_windows(owner, turns, count)):
        if window is None or abs(turns[index]) < KINK:
            continue
        strength = np.abs(local[window]) * (np.sign(local[window]) == np.sign(turns[index]))
        peak = strength.max()
        inside = "left" if turns[index] > 0 else "right"
        outside = "right" if turns[index] > 0 else "left"
        masks[inside][window[strength >= KERB_SHARE * peak]] = True
        apex = int(np.argmax(strength))
        tail = np.flatnonzero(strength[apex:] >= EXIT_SHARE * peak)
        last = apex + int(tail.max())
        exit_rows = window[apex + (last - apex) // 3 : last + 1]
        extra = (window[last] + np.arange(1, int(round(EXIT_KERB / STEP)))) % count
        masks[outside][exit_rows] = True
        masks[outside][extra] = True
    out = []
    for side, mask in masks.items():
        for begin, end in kerb_spans(mask, length):
            out.append({"kind": "kerb", "side": side, "from": begin, "to": end, "width": KERB_WIDTH})
    return sorted(out, key=lambda k: k["from"])


def apexes(kappa, owner, layout, turns):
    out = []
    local = box(kappa, 6.0)
    for index, vertex in enumerate(layout["vertices"]):
        if vertex["turn"] is None:
            continue
        own = np.flatnonzero(owner == index)
        best = own[np.argmax(np.abs(local[own]))]
        out.append({
            "number": vertex["turn"],
            "distance": round(float(best * STEP), 1),
            "side": "left" if turns[index] > 0 else "right",
        })
    return sorted(out, key=lambda t: t["number"])


def straights(owner, layout):
    count = len(owner)
    out = []
    for after, before in layout["straights"]:
        leave = int(np.flatnonzero(owner == after).max()) + 1
        enter = int(np.flatnonzero(owner == before).min())
        out.append([round(leave * STEP, 1), round(enter * STEP, 1)])
    return out, count


def build(layout):
    raw, owner, heading0, line, turns = fillet(layout)
    kappa = closed_curvature(raw, layout["smoothing"])
    fine, _ = integrate(kappa, heading0, line)
    length = len(kappa) * STEP
    half = layout["width"] / 2
    left, right = walls(kappa, half, layout["verge"], layout["runoff"])
    s, xy, values = resample(fine, {"left": left, "right": right}, length)
    centerline = [
        {
            "x": round(float(p[0]), ROUND),
            "y": 0.0,
            "z": round(float(-p[1]), ROUND),
            "width": float(layout["width"]),
            "camber": 0.0,
            "wallLeft": round(float(values["left"][i]), 3),
            "wallRight": round(float(values["right"][i]), 3),
        }
        for i, p in enumerate(xy)
    ]
    rows = layout["gridRows"]
    grid_lateral = layout["width"] * (1 / (rows + 1)) - half
    grid = [{"distance": round(length - layout["gridToLine"], 3), "offset": round(-grid_lateral if turns[0] > 0 else grid_lateral, 3)}]
    track = {
        "id": layout["id"],
        "name": layout["name"],
        "length": round(length, 3),
        "width": float(layout["width"]),
        "runoff": BORDER,
        "centerline": centerline,
        "surfaces": kerbs(kappa, owner, turns, length),
        "pitLane": None,
        "sectors": [round(length / 3, 3), round(2 * length / 3, 3)],
        "startLine": 0.0,
        "grid": grid,
        "gridRows": rows,
        "straightBelow": STRAIGHT_BELOW,
    }
    straight_list, _ = straights(owner, layout)
    back = straight_list[-1]
    circuit = {
        "roads": [],
        "lanes": [],
        "aisles": [],
        "parking": [],
        "water": [],
        "buildings": [],
        "track": {
            "length": track["length"],
            "points": [v for p in centerline[::2] for v in (round(p["x"], 1), round(p["y"], 1), round(p["z"], 1))],
        },
        "turns": apexes(kappa, owner, layout, turns),
        "sectors": track["sectors"],
        "straights": straight_list,
        "speedTrap": round(back[1] - SPEED_TRAP_LEAD, 1),
    }
    return track, circuit


def main():
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "content/tracks/training-ground")
    layout = json.loads((root / "layout.json").read_text())
    track, circuit = build(layout)
    (root / "track.json").write_text(json.dumps(track, indent=1) + "\n")
    (root / "circuit-map.json").write_text(json.dumps(circuit, separators=(",", ":")) + "\n")
    print(f"length {track['length']:.1f} m, {len(track['centerline'])} points, {len(track['surfaces'])} kerbs, turns {[(t['number'], t['distance']) for t in circuit['turns']]}, straights {circuit['straights']}")


if __name__ == "__main__":
    main()
