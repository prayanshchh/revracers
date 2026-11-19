import json
import math
import struct

import numpy as np

GROUND_MESHES = ("terrain", "verges")
GROUND_CELL = 6.0
COMPONENTS = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
WIDTHS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
UP = np.array([0.0, 0.0, 1.0])


def srgb(code):
    value = code.lstrip("#")
    rgb = [int(value[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb)


def shade(colour, factor):
    return tuple(min(1.0, c * factor) for c in colour)


def heading(degrees):
    angle = math.radians(degrees)
    return np.array([math.cos(angle), math.sin(angle), 0.0])


def unit(vector):
    vector = np.asarray(vector, float)
    return vector / np.linalg.norm(vector)


def flat(point, z=0.0):
    return np.array([point[0], point[1], z], float)


def read_glb(path):
    data = open(path, "rb").read()
    length = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20 : 20 + length])
    offset = 20 + length
    binary = data[offset + 8 : offset + 8 + struct.unpack_from("<I", data, offset)[0]]
    return gltf, binary


def accessor(gltf, binary, index):
    item = gltf["accessors"][index]
    view = gltf["bufferViews"][item["bufferView"]]
    dtype = np.dtype(COMPONENTS[item["componentType"]])
    width = WIDTHS[item["type"]]
    start = view.get("byteOffset", 0) + item.get("byteOffset", 0)
    stride = view.get("byteStride", dtype.itemsize * width)
    raw = np.frombuffer(binary, np.uint8, item["count"] * stride, start).reshape(item["count"], stride)
    return raw[:, : dtype.itemsize * width].copy().view(dtype).reshape(item["count"], width)


def planar(corners):
    points = np.asarray(corners, float)
    normal = np.zeros(3)
    for a, b in zip(points, np.roll(points, -1, axis=0)):
        normal += np.cross(a, b)
    length = np.linalg.norm(normal)
    normal = normal / length if length > 1e-9 else UP
    if abs(normal[2]) > 0.7:
        return [(p[0], p[1]) for p in points]
    across = unit(np.cross(UP, normal))
    return [(p @ across, p[2]) for p in points]


class Ground:
    def __init__(self, glb_path):
        gltf, binary = read_glb(glb_path)
        triangles = []
        for node in gltf["nodes"]:
            if node.get("name") not in GROUND_MESHES or "mesh" not in node:
                continue
            for primitive in gltf["meshes"][node["mesh"]]["primitives"]:
                position = accessor(gltf, binary, primitive["attributes"]["POSITION"]).astype(float)
                position += np.asarray(node.get("translation", [0, 0, 0]), float)
                local = np.stack([position[:, 0], -position[:, 2], position[:, 1]], 1)
                triangles.append(local[accessor(gltf, binary, primitive["indices"]).reshape(-1, 3)])
        self.triangles = np.concatenate(triangles)
        low = np.floor(self.triangles[:, :, :2].min(axis=1) / GROUND_CELL).astype(int)
        high = np.floor(self.triangles[:, :, :2].max(axis=1) / GROUND_CELL).astype(int)
        self.cells = {}
        for index, ((x0, y0), (x1, y1)) in enumerate(zip(low, high)):
            for i in range(x0, x1 + 1):
                for j in range(y0, y1 + 1):
                    self.cells.setdefault((i, j), []).append(index)

    def __call__(self, x, y):
        best = None
        for index in self.cells.get((int(math.floor(x / GROUND_CELL)), int(math.floor(y / GROUND_CELL))), ()):
            a, b, c = self.triangles[index]
            d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(d) < 1e-9:
                continue
            u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d
            v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d
            if u < -1e-6 or v < -1e-6 or u + v > 1 + 1e-6:
                continue
            z = u * a[2] + v * b[2] + (1 - u - v) * c[2]
            best = z if best is None else max(best, z)
        return best

    def low(self, points):
        found = [self(p[0], p[1]) for p in points]
        return min(z for z in found if z is not None)

    def under(self, centre, u, v, half_u, half_v, steps=4):
        points = [np.asarray(centre)[:2] + u[:2] * half_u * a + v[:2] * half_v * b for a in np.linspace(-1, 1, steps) for b in np.linspace(-1, 1, steps)]
        return self.low(points)


class Part:
    def __init__(self):
        self.points = []
        self.colours = []
        self.uvs = []
        self.faces = []
        self.smooth = []

    @property
    def count(self):
        return len(self.points)

    def vertices(self, points, colour, uvs=None):
        start = len(self.points)
        points = [np.asarray(p, float) for p in points]
        self.points += points
        self.colours += [tuple(colour)] * len(points)
        self.uvs += list(uvs) if uvs is not None else [(0.0, 0.0)] * len(points)
        return start

    def face(self, indices, smooth=False):
        self.faces.append(tuple(indices))
        self.smooth.append(smooth)

    def poly(self, corners, colour, uvs=None):
        start = self.vertices(corners, colour, uvs if uvs is not None else planar(corners))
        self.face(range(start, start + len(corners)))

    def box(self, centre, u, v, w, colour, open_bottom=True):
        c = np.asarray(centre, float)
        u, v, w = (np.asarray(a, float) for a in (u, v, w))
        corners = [c - u - v - w, c + u - v - w, c + u + v - w, c - u + v - w]
        top = [p + 2 * w for p in corners]
        for k in range(4):
            j = (k + 1) % 4
            self.poly([corners[k], corners[j], top[j], top[k]], colour)
        self.poly(top, colour)
        if not open_bottom:
            self.poly(corners[::-1], colour)

    def slab(self, origin, along, across, height, colour, bottom=True):
        o = np.asarray(origin, float)
        a, b = np.asarray(along, float), np.asarray(across, float)
        lift = UP * height
        corners = [o, o + a, o + a + b, o + b]
        top = [p + lift for p in corners]
        for k in range(4):
            j = (k + 1) % 4
            self.poly([corners[k], corners[j], top[j], top[k]], colour)
        self.poly(top, colour)
        if bottom:
            self.poly(corners[::-1], colour)

    def beam(self, a, b, size, colour, depth=None, roll=None):
        a, b = np.asarray(a, float), np.asarray(b, float)
        axis = b - a
        length = np.linalg.norm(axis)
        if length < 1e-6:
            return
        axis /= length
        helper = np.asarray(roll, float) if roll is not None else (UP if abs(axis[2]) < 0.9 else np.array([1.0, 0.0, 0.0]))
        side = unit(np.cross(axis, helper)) * size / 2
        up = unit(np.cross(side, axis)) * (depth if depth is not None else size) / 2
        ring = [side + up, -side + up, -side - up, side - up]
        for k in range(4):
            j = (k + 1) % 4
            self.poly([a + ring[k], a + ring[j], b + ring[j], b + ring[k]], colour)

    def tube(self, path, radius, colour, sides=8, caps=False):
        path = [np.asarray(p, float) for p in path]
        if len(path) < 2:
            return
        radii = radius if hasattr(radius, "__len__") else [radius] * len(path)
        tangents = [unit(path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]) for i in range(len(path))]
        helper = UP if abs(tangents[0][2]) < 0.9 else np.array([1.0, 0.0, 0.0])
        normal = unit(np.cross(tangents[0], helper))
        rings = []
        for point, tangent, r in zip(path, tangents, radii):
            normal = unit(normal - tangent * (normal @ tangent))
            binormal = np.cross(tangent, normal)
            rings.append([point + (normal * math.cos(t) + binormal * math.sin(t)) * r for t in np.linspace(0, 2 * math.pi, sides, endpoint=False)])
        walked = np.concatenate([[0.0], np.cumsum([np.linalg.norm(b - a) for a, b in zip(path, path[1:])])])
        uvs = [(2 * math.pi * r * k / sides, v) for v, r in zip(walked, radii) for k in range(sides)]
        start = self.vertices([p for ring in rings for p in ring], colour, uvs)
        for i in range(len(rings) - 1):
            for k in range(sides):
                j = (k + 1) % sides
                self.face((start + i * sides + k, start + i * sides + j, start + (i + 1) * sides + j, start + (i + 1) * sides + k), True)
        if caps:
            self.face([start + k for k in range(sides)][::-1])
            last = start + (len(rings) - 1) * sides
            self.face([last + k for k in range(sides)])

    def rod(self, a, b, radius, colour, sides=6):
        self.tube([a, b], radius, colour, sides)

    def sheet(self, grid, colour, smooth=True, uvs=None):
        grid = np.asarray(grid, float)
        rows, columns = grid.shape[:2]
        flat_uvs = planar(grid.reshape(-1, 3)) if uvs is None else np.asarray(uvs, float).reshape(-1, 2)
        start = self.vertices(grid.reshape(-1, 3), colour, flat_uvs)
        for i in range(rows - 1):
            for j in range(columns - 1):
                a = start + i * columns + j
                self.face((a, a + 1, a + columns + 1, a + columns), smooth)

    def mesh(self, vertices, triangles, colour, place):
        start = self.vertices([place(v) for v in vertices], colour)
        for tri in triangles:
            self.face([start + k for k in tri])

    def arrays(self):
        return np.array(self.points, float), self.faces, np.array(self.colours, float), np.array(self.uvs, float), np.array(self.smooth, bool)


class Parts:
    def __init__(self):
        self.items = {}
        self.footprints = []

    def __call__(self, name, look):
        return self.items.setdefault((name, look), Part())

    def footprint(self, name, ring, solid=True, **extra):
        self.footprints.append({"name": name, "solid": solid, "outline": [[round(float(x), 2), round(float(-y), 2)] for x, y in ring], **extra})


class Centreline:
    def __init__(self, track_path):
        data = json.loads(open(track_path).read())
        self.points = np.array([[p["x"], -p["z"], p["y"]] for p in data["centerline"]], float)
        self.camber = np.array([p.get("camber", 0.0) for p in data["centerline"]], float)
        self.walls = np.array([[p.get("wallLeft", 0.0), p.get("wallRight", 0.0)] for p in data["centerline"]], float)
        steps = np.linalg.norm(np.diff(np.vstack([self.points[:, :2], self.points[:1, :2]]), axis=0), axis=1)
        self.s = np.concatenate([[0.0], np.cumsum(steps)[:-1]])
        self.steps = steps
        self.length = float(steps.sum())
        tangents = np.roll(self.points[:, :2], -1, axis=0) - np.roll(self.points[:, :2], 1, axis=0)
        self.tangents = tangents / np.linalg.norm(tangents, axis=1)[:, None]

    def sample(self, s):
        s = s % self.length
        i = int(np.searchsorted(self.s, s, side="right") - 1) % len(self.s)
        j = (i + 1) % len(self.s)
        t = (s - self.s[i]) / self.steps[i]
        tangent = self.tangents[i] * (1 - t) + self.tangents[j] * t
        tangent /= np.linalg.norm(tangent)
        return self.points[i] * (1 - t) + self.points[j] * t, self.camber[i] * (1 - t) + self.camber[j] * t, tangent

    def at(self, s, lateral, lift=0.0, banked=False):
        point, camber, tangent = self.sample(s)
        left = np.array([-tangent[1], tangent[0]])
        xy = point[:2] + left * lateral
        return np.array([xy[0], xy[1], point[2] + lift + (camber * lateral if banked else 0.0)])

    def wall(self, s, side):
        k = int(np.searchsorted(self.s, s % self.length, side="right") - 1) % len(self.s)
        window = [(k + j) % len(self.s) for j in range(-6, 7)]
        return float(self.walls[window, 0 if side > 0 else 1].max())

    def clear(self, point, margin):
        offset = self.points[:, :2] - np.asarray(point, float)[:2]
        k = int(np.argmin(np.einsum("ij,ij->i", offset, offset)))
        t = self.tangents[k]
        lateral = -offset[k] @ np.array([-t[1], t[0]])
        return abs(lateral) > self.walls[k, 0 if lateral > 0 else 1] + margin

    def direction(self, s):
        tangent = self.sample(s)[2]
        return np.array([tangent[0], tangent[1], 0.0])


def railing(part, points, height, colour, post_every=1.8, size=0.045):
    points = [np.asarray(p, float) for p in points]
    for a, b in zip(points, points[1:]):
        length = np.linalg.norm(b - a)
        part.rod(a + UP * height, b + UP * height, size, colour, 4)
        part.rod(a + UP * height * 0.5, b + UP * height * 0.5, size * 0.6, colour, 4)
        for t in np.linspace(0, 1, max(2, int(length / post_every) + 1)):
            foot = a + (b - a) * t
            part.rod(foot, foot + UP * height, size * 0.8, colour, 4)


def louvres(part, origin, along, up, out, count, colour):
    origin = np.asarray(origin, float)
    height = np.linalg.norm(up)
    direction = up / height
    for k in range(count):
        z = (k + 0.5) / count
        low = origin + up * z + out * 0.08
        part.poly([low, low + along, low + along + direction * height / count * 0.7 - out * 0.1, low + direction * height / count * 0.7 - out * 0.1], colour)


def fan(part, centre, radius, body, dark):
    centre = np.asarray(centre, float)
    part.tube([centre, centre + UP * 0.45], [radius, radius], body, 12, caps=True)
    part.tube([centre + UP * 0.46, centre + UP * 0.5], [radius * 0.9, radius * 0.9], dark, 12, caps=True)
    for k in range(4):
        t = k * math.pi / 4
        spoke = np.array([math.cos(t), math.sin(t), 0.0]) * radius * 0.92
        part.rod(centre + UP * 0.52 - spoke, centre + UP * 0.52 + spoke, 0.025, body, 3)


def capsule(part, centre, along, size, sides=8):
    lx, ly, lz = size
    side = unit(np.cross(UP, along))

    def ring(z, shrink):
        out = []
        for k in range(sides):
            t = 2 * math.pi * (k + 0.5) / sides
            out.append(centre + along * math.cos(t) * lx / 2 * shrink + side * math.sin(t) * ly / 2 * shrink + UP * z)
        return out

    return ring


def band(part, lower, upper, colour):
    for k in range(len(lower)):
        j = (k + 1) % len(lower)
        part.poly([lower[k], lower[j], upper[j], upper[k]], colour)


def truss(part, a, b, depth, colour, size=0.08, panels=None):
    a, b = np.asarray(a, float), np.asarray(b, float)
    length = np.linalg.norm(b - a)
    count = panels or max(2, int(length / max(depth, 0.5)))
    top = [a + (b - a) * t + UP * depth for t in np.linspace(0, 1, count + 1)]
    bottom = [a + (b - a) * t for t in np.linspace(0, 1, count + 1)]
    part.rod(top[0], top[-1], size, colour, 4)
    part.rod(bottom[0], bottom[-1], size, colour, 4)
    for k in range(count + 1):
        part.rod(bottom[k], top[k], size * 0.7, colour, 4)
        if k < count:
            part.rod(bottom[k], top[k + 1], size * 0.6, colour, 4)
