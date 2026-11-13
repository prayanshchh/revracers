import json
import math
import sys
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

SPECIES = {
    "oak": {
        "seed": 11,
        "height": 9.4,
        "trunk": 1.1,
        "trunkRadius": 0.34,
        "crown": {"radius": 5.6, "top": 9.6, "bottom": 1.3, "widest": 0.46, "flat": 1.0, "lobes": 0.5, "lobeScale": 0.42},
        "attractors": 4200,
        "shell": 0.7,
        "blobs": 9,
        "blobShare": 0.42,
        "step": 0.4,
        "influence": 3.0,
        "kill": 0.8,
        "droop": 0.06,
        "sprays": 5,
        "sprayLength": (0.55, 1.1),
        "leavesPerMetre": 400,
        "leaf": (0.12, 0.068),
        "leafColour": (0.038, 0.062, 0.014),
        "leafSpread": (0.34, 0.34, 0.6),
        "bark": (0.07, 0.062, 0.052),
        "limbs": 5,
    },
    "elm": {
        "seed": 23,
        "height": 11.5,
        "trunk": 1.4,
        "trunkRadius": 0.28,
        "crown": {"radius": 4.6, "top": 11.5, "bottom": 1.7, "widest": 0.48, "flat": 1.05, "lobes": 0.5, "lobeScale": 0.4},
        "attractors": 3800,
        "shell": 0.7,
        "blobs": 8,
        "blobShare": 0.42,
        "step": 0.4,
        "influence": 2.8,
        "kill": 0.76,
        "droop": 0.12,
        "sprays": 5,
        "sprayLength": (0.5, 1.05),
        "leavesPerMetre": 400,
        "leaf": (0.105, 0.058),
        "leafColour": (0.042, 0.07, 0.016),
        "leafSpread": (0.34, 0.34, 0.6),
        "bark": (0.075, 0.066, 0.055),
        "limbs": 3,
    },
    "ash": {
        "seed": 37,
        "height": 13.0,
        "trunk": 1.7,
        "trunkRadius": 0.32,
        "crown": {"radius": 5.0, "top": 12.6, "bottom": 2.0, "widest": 0.5, "flat": 1.0, "lobes": 0.5, "lobeScale": 0.36},
        "attractors": 4000,
        "shell": 0.7,
        "blobs": 8,
        "blobShare": 0.42,
        "step": 0.44,
        "influence": 3.3,
        "kill": 0.86,
        "droop": 0.16,
        "sprays": 5,
        "sprayLength": (0.6, 1.3),
        "leavesPerMetre": 400,
        "leaf": (0.135, 0.058),
        "leafColour": (0.046, 0.076, 0.018),
        "leafSpread": (0.36, 0.36, 0.6),
        "bark": (0.08, 0.07, 0.06),
        "limbs": 4,
    },
    "shrub": {
        "seed": 41,
        "height": 4.2,
        "trunk": 0.35,
        "trunkRadius": 0.12,
        "crown": {"radius": 2.7, "top": 4.2, "bottom": 0.15, "widest": 0.4, "flat": 0.75, "lobes": 0.3, "lobeScale": 0.7},
        "attractors": 2600,
        "shell": 0.8,
        "step": 0.2,
        "influence": 1.5,
        "kill": 0.36,
        "droop": 0.0,
        "sprays": 5,
        "sprayLength": (0.3, 0.6),
        "leavesPerMetre": 620,
        "leaf": (0.07, 0.04),
        "leafColour": (0.03, 0.055, 0.018),
        "leafSpread": (0.3, 0.2, 0.3),
        "bark": (0.07, 0.06, 0.05),
        "limbs": 6,
    },
}


def lattice(rng, size=24):
    return rng.random((size, size, size)).astype(np.float32)


def noise3(field, points):
    size = field.shape[0]
    p = np.mod(points, size)
    base = np.floor(p).astype(int)
    f = p - base
    f = f * f * (3 - 2 * f)
    out = np.zeros(len(points))
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                weight = (f[:, 0] if dx else 1 - f[:, 0]) * (f[:, 1] if dy else 1 - f[:, 1]) * (f[:, 2] if dz else 1 - f[:, 2])
                out += weight * field[(base[:, 0] + dx) % size, (base[:, 1] + dy) % size, (base[:, 2] + dz) % size]
    return out


def crown_reach(crown, field, direction, rise):
    span = crown["top"] - crown["bottom"]
    t = np.clip(rise, 0, 1)
    widest = crown["widest"]
    below = np.clip(t / widest, 0, 1)
    above = np.clip((t - widest) / (1 - widest), 0, 1)
    profile = np.where(t < widest, np.sqrt(1 - (1 - below) ** 2) ** crown["flat"], np.sqrt(np.maximum(1 - above**2, 0)) ** (1 / max(crown["flat"], 0.3)))
    turns = 0.5 / max(crown["lobeScale"], 1e-3)
    probe = np.stack([direction[:, 0] * turns + 7.3, direction[:, 1] * turns + 3.1, t * turns * 1.4 + 1.7], 1)
    bulge = 1 + crown["lobes"] * (noise3(field, probe) * 2 - 1)
    return crown["radius"] * profile * bulge


def attractors(spec, rng, field):
    crown = spec["crown"]
    span = crown["top"] - crown["bottom"]
    count = spec["attractors"]
    main = int(count * (1 - spec.get("blobShare", 0.4)))
    out = []
    while sum(len(o) for o in out) < main:
        n = main * 3
        rise = rng.random(n)
        angle = rng.random(n) * 2 * math.pi
        direction = np.stack([np.cos(angle), np.sin(angle)], 1)
        reach = crown_reach(crown, field, direction, rise)
        shell = rng.random(n) < spec["shell"]
        share = np.where(shell, 1 - rng.random(n) ** 2 * 0.3, np.sqrt(rng.random(n)) * 0.72)
        radius = reach * share
        points = np.stack([direction[:, 0] * radius, direction[:, 1] * radius, crown["bottom"] + rise * span], 1)
        keep = reach > 0.25
        out.append(points[keep])
    points = [np.concatenate(out)[:main]]
    blobs = spec.get("blobs", 6)
    each = (count - main) // max(blobs, 1)
    for _ in range(blobs):
        rise = rng.uniform(0.18, 0.9)
        angle = rng.random() * 2 * math.pi
        direction = np.array([[math.cos(angle), math.sin(angle)]])
        reach = crown_reach(crown, field, direction, np.array([rise]))[0]
        centre = np.array([direction[0, 0] * reach * 0.92, direction[0, 1] * reach * 0.92, crown["bottom"] + rise * span])
        size = crown["radius"] * rng.uniform(0.26, 0.42)
        offset = rng.normal(0, 1, (each, 3))
        offset /= np.linalg.norm(offset, axis=1, keepdims=True)
        offset *= (size * (1 - rng.random(each) ** 2 * 0.45))[:, None]
        offset[:, 2] *= 0.72
        blob = centre + offset
        points.append(blob[blob[:, 2] > crown["bottom"] * 0.5])
    return np.concatenate(points)


def colonize(spec, rng, targets):
    step = spec["step"]
    nodes = []
    parents = []
    wobble = rng.normal(0, 0.035, (64, 2)).cumsum(0)
    count = max(2, int(spec["trunk"] / step))
    for i in range(count + 1):
        z = i * spec["trunk"] / count
        nodes.append([wobble[i, 0] * z * 0.25, wobble[i, 1] * z * 0.25, z])
        parents.append(i - 1)
    top = len(nodes) - 1
    for limb in range(spec["limbs"]):
        angle = 2 * math.pi * (limb + rng.random() * 0.5) / spec["limbs"]
        lift = rng.uniform(0.45, 0.95)
        direction = np.array([math.cos(angle), math.sin(angle), lift])
        direction /= np.linalg.norm(direction)
        nodes.append((np.array(nodes[top]) + direction * step).tolist())
        parents.append(top)
    nodes = np.array(nodes)
    parents = list(parents)
    alive = np.ones(len(targets), bool)
    for _ in range(400):
        if not alive.any():
            break
        tree = cKDTree(nodes)
        gap, nearest = tree.query(targets[alive], distance_upper_bound=spec["influence"])
        seen = np.isfinite(gap)
        if not seen.any():
            break
        live = np.nonzero(alive)[0][seen]
        owner = nearest[seen]
        pull = targets[live] - nodes[owner]
        pull /= np.linalg.norm(pull, axis=1, keepdims=True)
        total = np.zeros((len(nodes), 3))
        np.add.at(total, owner, pull)
        grown = np.nonzero(np.linalg.norm(total, axis=1) > 1e-6)[0]
        heading = total[grown] / np.linalg.norm(total[grown], axis=1, keepdims=True)
        heading[:, 2] -= spec["droop"] * 0.2
        heading += rng.normal(0, 0.12, heading.shape)
        heading /= np.linalg.norm(heading, axis=1, keepdims=True)
        fresh = nodes[grown] + heading * step
        far = cKDTree(nodes).query(fresh)[0] > step * 0.45
        fresh, grown = fresh[far], grown[far]
        if len(fresh) == 0:
            break
        nodes = np.concatenate([nodes, fresh])
        parents.extend(grown.tolist())
        reach = cKDTree(fresh).query(targets[alive])[0]
        alive[np.nonzero(alive)[0][reach < spec["kill"]]] = False
    return nodes, np.array(parents)


def radii(spec, nodes, parents):
    count = len(nodes)
    children = [[] for _ in range(count)]
    for node, parent in enumerate(parents):
        if parent >= 0:
            children[parent].append(node)
    order = np.argsort(-np.arange(count))
    power = 2.35
    tip = 0.006
    area = np.zeros(count)
    for node in order:
        if not children[node]:
            area[node] = tip**power
        else:
            area[node] = sum(area[c] for c in children[node])
    radius = area ** (1 / power)
    scale = spec["trunkRadius"] / radius[0]
    radius = np.maximum(radius * scale, tip)
    flare = np.exp(-nodes[:, 2] / 0.5) * 0.55
    radius *= 1 + flare * (np.arange(count) < 64)
    return radius, children


def chains(parents, children, radius):
    starts = [0]
    out = []
    while starts:
        node = starts.pop()
        chain = [node]
        while children[node]:
            kids = sorted(children[node], key=lambda c: -radius[c])
            starts.extend(kids[1:])
            node = kids[0]
            chain.append(node)
        out.append(chain)
    return out


def tube(points, widths, sides, lead=None):
    points = np.asarray(points)
    count = len(points)
    tangent = np.gradient(points, axis=0)
    tangent /= np.maximum(np.linalg.norm(tangent, axis=1, keepdims=True), 1e-9)
    reference = np.array([0.0, 0.0, 1.0]) if abs(tangent[0, 2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    side = np.cross(tangent[0], reference)
    side /= np.linalg.norm(side)
    rings = []
    for i in range(count):
        side = side - tangent[i] * side.dot(tangent[i])
        side /= max(np.linalg.norm(side), 1e-9)
        other = np.cross(tangent[i], side)
        turn = np.arange(sides) * 2 * math.pi / sides
        rings.append(points[i] + widths[i] * (np.cos(turn)[:, None] * side + np.sin(turn)[:, None] * other))
    vertices = np.concatenate(rings)
    faces = []
    for i in range(count - 1):
        for k in range(sides):
            a = i * sides + k
            b = i * sides + (k + 1) % sides
            faces.append([a, b, b + sides, a + sides])
    return vertices, np.array(faces, np.int64).reshape(-1, 4)


def branches(spec, nodes, parents, radius, children, rng, field):
    vertices, faces, colours = [], [], []
    offset = 0
    bark = np.array(spec["bark"])
    for chain in chains(parents, children, radius):
        first = parents[chain[0]]
        path = ([first] if first >= 0 else []) + chain
        keep = [n for n in path if radius[n] >= 0.011]
        if len(keep) < 2:
            continue
        widths = radius[keep].copy()
        if first >= 0:
            widths[0] = min(widths[0], radius[chain[0]] * 1.15)
        sides = 10 if widths.max() > 0.12 else (7 if widths.max() > 0.04 else 5)
        v, f = tube(nodes[keep], widths, sides)
        tone = 0.72 + 0.56 * noise3(field, v * np.array([9.0, 9.0, 2.2]) + 3.3)
        moss = np.clip(noise3(field, v * 0.9 + 11.1) - 0.55, 0, 1) * 1.2
        colour = bark * tone[:, None] * (1 - moss[:, None] * 0.25) + np.array([0.0, 0.012, 0.0]) * moss[:, None]
        vertices.append(v)
        faces.append(f + offset)
        colours.append(colour)
        offset += len(v)
    return np.concatenate(vertices), np.concatenate(faces), np.concatenate(colours)


def foliage(spec, nodes, parents, radius, children, rng, field):
    depth = np.zeros(len(nodes), int)
    for node in range(len(nodes) - 1, -1, -1):
        if children[node]:
            depth[node] = 1 + min(depth[c] for c in children[node])
    hosts = np.nonzero((depth <= 2) & (nodes[:, 2] > spec["crown"]["bottom"] * 0.6))[0]
    centre = np.array([0.0, 0.0, spec["crown"]["bottom"] + (spec["crown"]["top"] - spec["crown"]["bottom"]) * 0.42])
    low, high = spec["sprayLength"]
    length, width = spec["leaf"]
    base_colour = np.array(spec["leafColour"])
    quads, colours = [], []
    for host in hosts:
        parent = parents[host]
        along = nodes[host] - nodes[parent] if parent >= 0 else np.array([0, 0, 1.0])
        along /= max(np.linalg.norm(along), 1e-9)
        outward = nodes[host] - centre
        outward /= max(np.linalg.norm(outward), 1e-9)
        sprays = spec["sprays"] if depth[host] == 0 else max(2, spec["sprays"] - 2)
        for _ in range(sprays):
            heading = along * 0.55 + outward * 0.75 + rng.normal(0, 0.62, 3)
            heading[2] += 0.12 - spec["droop"]
            heading /= np.linalg.norm(heading)
            reach = rng.uniform(low, high)
            fan = reach * spec.get("fan", 0.5)
            count = max(8, int(reach * spec["leavesPerMetre"]))
            t = rng.random(count) ** 0.75
            bend = np.array([0, 0, -1.0]) * spec["droop"] * reach
            stem = nodes[host] + heading * (t * reach)[:, None] + bend * (t**2)[:, None]
            away = rng.normal(0, 1, (count, 3))
            away -= heading * (away @ heading)[:, None]
            away[:, 2] *= 0.45
            away /= np.maximum(np.linalg.norm(away, axis=1, keepdims=True), 1e-9)
            aside = rng.random(count) ** 0.7 * fan * (1.15 - t * 0.6)
            point = heading * 0.45 + away * 0.8 + np.array([0, 0, 0.18])
            point += rng.normal(0, 0.3, (count, 3))
            point /= np.linalg.norm(point, axis=1, keepdims=True)
            up = np.array([0, 0, 1.0]) + rng.normal(0, 0.6, (count, 3))
            across = np.cross(point, up)
            across /= np.maximum(np.linalg.norm(across, axis=1, keepdims=True), 1e-9)
            size = rng.uniform(0.7, 1.25, count)[:, None]
            root = stem + away * aside[:, None]
            tip = root + point * length * size
            mid = root + point * length * size * 0.45
            quads.append(np.stack([root, mid + across * width * size * 0.5, tip, mid - across * width * size * 0.5], 1))
            shade = 1 + (rng.random(count) - 0.5) * spec["leafSpread"][1] * 2
            hue = (rng.random(count) - 0.5) * spec["leafSpread"][0]
            patch = noise3(field, stem * 0.55 + 5.5) - 0.5
            tone = shade + patch * spec["leafSpread"][2]
            colour = base_colour * tone[:, None]
            colour[:, 0] *= 1 + hue + patch * 0.5
            colour[:, 2] *= 1 - hue * 0.5
            colours.append(np.clip(colour, 0.004, 1))
    quads = np.concatenate(quads)
    colours = np.concatenate(colours)
    vertices = quads.reshape(-1, 3)
    faces = np.arange(len(vertices)).reshape(-1, 4)
    return vertices, faces, np.repeat(colours, 4, 0)


PALM = {
    "seed": 53,
    "height": 13.5,
    "radius": (0.24, 0.17),
    "lean": 0.5,
    "fronds": 38,
    "length": (3.4, 4.6),
    "leaflets": 64,
    "leaflet": (0.78, 0.045),
    "leafColour": (0.04, 0.07, 0.018),
    "dryColour": (0.11, 0.085, 0.035),
    "bark": (0.11, 0.09, 0.07),
}


def palm_trunk(spec, rng, field):
    rise = np.linspace(0, 1, 48)
    sway = spec["lean"] * (rise**2)
    turn = rng.random() * 2 * math.pi
    path = np.stack([np.cos(turn) * sway, np.sin(turn) * sway, rise * spec["height"]], 1)
    low, high = spec["radius"]
    width = high + (low - high) * (1 - rise) ** 1.5 + 0.1 * np.exp(-rise * spec["height"] / 0.5)
    width[-6:] *= np.linspace(1.15, 1.7, 6)
    vertices, faces = tube(path, width, 12)
    rings = 0.5 + 0.5 * np.sin(vertices[:, 2] * 2 * math.pi / 0.22)
    tone = 0.62 + 0.3 * rings + 0.3 * noise3(field, vertices * 3.1 + 2.2)
    colour = np.array(spec["bark"]) * tone[:, None]
    return path[-1], vertices, faces, colour


def palm_frond(spec, rng, top, index):
    count = spec["fronds"]
    age = index / (count - 1)
    azimuth = index * 2.39996 + rng.normal(0, 0.15)
    lift = math.radians(78 - 118 * age**0.85 + rng.normal(0, 5))
    low, high = spec["length"]
    length = rng.uniform(low, high) * (0.7 + 0.3 * math.sin(math.pi * min(1, age * 1.3 + 0.1)))
    steps = 22
    out = np.array([math.cos(azimuth), math.sin(azimuth), 0.0])
    point = np.array(top) + out * 0.12
    pitch = lift
    spine = [point.copy()]
    for step in range(steps):
        pitch -= (0.55 + 0.9 * age) * (step / steps) * (2.2 / steps) + 0.012
        point = point + (out * math.cos(pitch) + np.array([0, 0, math.sin(pitch)])) * length / steps
        spine.append(point.copy())
    spine = np.array(spine)
    along = np.gradient(spine, axis=0)
    along /= np.linalg.norm(along, axis=1, keepdims=True)
    aside = np.cross(along, np.array([0, 0, 1.0]))
    aside /= np.maximum(np.linalg.norm(aside, axis=1, keepdims=True), 1e-6)
    above = np.cross(aside, along)
    share = np.linspace(0.12, 1.0, spec["leaflets"])
    at = share * steps
    base = np.floor(at).astype(int).clip(0, steps - 1)
    blend = (at - base)[:, None]
    pick = lambda field: field[base] * (1 - blend) + field[base + 1] * blend
    root, forward, side, up = pick(spine), pick(along), pick(aside), pick(above)
    reach, width = spec["leaflet"]
    size = reach * np.sin(math.pi * np.clip(share * 0.9 + 0.08, 0, 1)) ** 0.6
    quads = []
    for sign in (1.0, -1.0):
        heading = side * sign * 0.8 + forward * 0.55 + up * 0.28 - np.array([0, 0, 0.3 + 0.35 * age])
        heading += rng.normal(0, 0.07, heading.shape)
        heading /= np.linalg.norm(heading, axis=1, keepdims=True)
        flat = np.cross(heading, up)
        flat /= np.maximum(np.linalg.norm(flat, axis=1, keepdims=True), 1e-6)
        tip = root + heading * size[:, None]
        middle = root + heading * size[:, None] * 0.4 - np.array([0, 0, 0.02])
        quads.append(np.stack([root, middle + flat * width, tip, middle - flat * width], 1))
    quads = np.concatenate(quads)
    green = np.array(spec["leafColour"])
    dry = np.array(spec["dryColour"])
    wither = np.clip((age - 0.72) / 0.28, 0, 1) ** 1.5
    tone = rng.uniform(0.8, 1.2, len(quads))[:, None]
    colours = (green * (1 - wither) + dry * wither) * tone
    stem_width = np.linspace(0.045, 0.012, len(spine))
    stem = tube(spine, stem_width, 5)
    stem_colour = np.tile((green * (1 - wither) + dry * wither) * 1.6 + 0.02, (len(stem[0]), 1))
    return quads, colours, stem, stem_colour


def palm():
    spec = PALM
    rng = np.random.default_rng(spec["seed"])
    field = lattice(rng)
    top, trunk_vertices, trunk_faces, trunk_colours = palm_trunk(spec, rng, field)
    wood_vertices, wood_faces, wood_colours = [trunk_vertices], [trunk_faces], [trunk_colours]
    quads, colours = [], []
    offset = len(trunk_vertices)
    for index in range(spec["fronds"]):
        leaves, leaf_colours, (stem_vertices, stem_faces), stem_colours = palm_frond(spec, rng, top, index)
        quads.append(leaves)
        colours.append(leaf_colours)
        wood_vertices.append(stem_vertices)
        wood_faces.append(stem_faces + offset)
        wood_colours.append(stem_colours)
        offset += len(stem_vertices)
    quads = np.concatenate(quads)
    colours = np.concatenate(colours)
    wood = (np.concatenate(wood_vertices), np.concatenate(wood_faces), np.concatenate(wood_colours))
    leaves = (quads.reshape(-1, 3), np.arange(len(quads) * 4).reshape(-1, 4), np.repeat(colours, 4, 0))
    return wood, leaves, spec["fronds"]


def grow(name):
    if name == "palm":
        return palm()
    spec = SPECIES[name]
    rng = np.random.default_rng(spec["seed"])
    field = lattice(rng)
    targets = attractors(spec, rng, field)
    nodes, parents = colonize(spec, rng, targets)
    radius, children = radii(spec, nodes, parents)
    wood = branches(spec, nodes, parents, radius, children, rng, field)
    leaves = foliage(spec, nodes, parents, radius, children, rng, field)
    return wood, leaves, len(nodes)


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    names = sys.argv[2:] or [*SPECIES, "palm"]
    for name in names:
        (wv, wf, wc), (lv, lf, lc), count = grow(name)
        np.savez_compressed(out / f"{name}.npz", wood_vertices=wv.astype(np.float32), wood_faces=wf.astype(np.int32), wood_colours=wc.astype(np.float32), leaf_vertices=lv.astype(np.float32), leaf_faces=lf.astype(np.int32), leaf_colours=lc.astype(np.float32))
        print(json.dumps({"name": name, "nodes": count, "woodFaces": len(wf), "leaves": len(lf), "height": float(max(wv[:, 2].max(), lv[:, 2].max())), "radius": float(np.percentile(np.linalg.norm(lv[:, :2], axis=1), 99.5))}), flush=True)


if __name__ == "__main__":
    main()
