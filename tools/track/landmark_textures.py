import numpy as np

TILES = {"paint": 4.0, "concrete": 4.0, "metal": 2.0, "gloss": 2.0, "fabric": 6.0, "timber": 2.0}
SIZES = {"paint": 512, "concrete": 512, "metal": 256, "gloss": 256, "fabric": 512, "timber": 512}
NORMAL_STRENGTH = {"paint": 3.0, "concrete": 2.0, "metal": 1.0, "gloss": 0.6, "fabric": 1.2, "timber": 2.5}


def noise(size, beta, seed, stretch=(1.0, 1.0)):
    rng = np.random.default_rng(seed)
    fy = np.fft.fftfreq(size)[:, None] * size * stretch[1]
    fx = np.fft.fftfreq(size)[None, :] * size * stretch[0]
    radius = np.hypot(fx, fy)
    radius[0, 0] = 1.0
    spectrum = (rng.normal(size=(size, size)) + 1j * rng.normal(size=(size, size))) / radius**beta
    spectrum[0, 0] = 0.0
    field = np.real(np.fft.ifft2(spectrum))
    return (field - field.min()) / max(np.ptp(field), 1e-9)


def lines(size, period, width, axis):
    coordinate = np.arange(size)[None, :] if axis == 0 else np.arange(size)[:, None]
    distance = np.abs(((coordinate + period / 2) % period) - period / 2)
    mask = np.clip(1.0 - distance / width, 0.0, 1.0)
    return np.broadcast_to(mask, (size, size)).copy()


def cells(size, cell_x, cell_y, seed):
    rng = np.random.default_rng(seed)
    count_x, count_y = int(round(size / cell_x)), int(round(size / cell_y))
    tone = rng.uniform(-1, 1, (count_y, count_x))
    ys = (np.arange(size) // cell_y).astype(int) % count_y
    xs = (np.arange(size) // cell_x).astype(int) % count_x
    return tone[ys[:, None], xs[None, :]]


def paint(size):
    metre = size / TILES["paint"]
    joints = np.maximum(lines(size, metre, 1.6, 0), lines(size, metre * 2, 1.6, 1))
    streak = noise(size, 1.4, 3, (6.0, 0.4))
    below = (np.arange(size)[:, None] % (metre * 2)) / (metre * 2)
    dirt = (1 - below) ** 3 * streak
    albedo = 0.95 + 0.025 * cells(size, metre, metre * 2, 4) + 0.03 * (noise(size, 1.8, 5) - 0.5) - 0.12 * dirt - 0.22 * joints
    height = 1.0 - joints + 0.05 * noise(size, 2.0, 6)
    rough = 0.48 + 0.12 * noise(size, 1.6, 7) + 0.25 * joints + 0.1 * dirt
    return albedo, height, rough


def concrete(size):
    metre = size / TILES["concrete"]
    seams = np.maximum(lines(size, metre * 1.2, 1.2, 0), lines(size, metre * 2.4, 1.2, 1)) * 0.6
    holes_x, holes_y = np.meshgrid(np.arange(size), np.arange(size))
    holes = ((np.abs((holes_x % (metre * 0.6)) - metre * 0.3) < 2.0) & (np.abs((holes_y % (metre * 0.6)) - metre * 0.3) < 2.0)).astype(float)
    pits = (noise(size, 0.4, 8) > 0.82).astype(float)
    stains = noise(size, 1.2, 9, (5.0, 0.5))
    albedo = 0.9 + 0.08 * (noise(size, 1.5, 10) - 0.5) - 0.12 * stains**2 - 0.15 * seams - 0.25 * holes - 0.06 * pits
    height = 1.0 - 0.5 * seams - holes - 0.3 * pits + 0.15 * noise(size, 1.9, 11)
    rough = 0.82 + 0.1 * noise(size, 1.5, 12)
    return albedo, height, rough


def metal(size):
    spangle = cells(size, 9, 7, 13)
    albedo = 0.93 + 0.04 * spangle + 0.04 * (noise(size, 1.6, 14) - 0.5)
    height = 0.5 + 0.1 * noise(size, 2.2, 15)
    rough = 0.42 + 0.12 * spangle + 0.1 * noise(size, 1.4, 16)
    return albedo, height, rough


def gloss(size):
    albedo = 0.96 + 0.03 * (noise(size, 1.8, 17) - 0.5)
    height = 0.5 + 0.05 * noise(size, 2.4, 18)
    rough = 0.3 + 0.08 * noise(size, 1.3, 19)
    return albedo, height, rough


def fabric(size):
    metre = size / TILES["fabric"]
    seams = lines(size, metre * 1.5, 1.4, 0)
    weave = noise(size, 0.2, 20)
    dirt = noise(size, 1.3, 21)
    albedo = 0.97 - 0.05 * seams + 0.015 * (weave - 0.5) - 0.07 * dirt**2
    height = 1.0 - 0.4 * seams + 0.04 * weave
    rough = 0.78 + 0.08 * dirt
    return albedo, height, rough


def timber(size):
    metre = size / TILES["timber"]
    rng = np.random.default_rng(22)
    edges, x = [0], 0.0
    while x < size:
        x += metre * rng.uniform(0.16, 0.26)
        edges.append(min(int(x), size))
    plank = np.zeros(size, int)
    for k, (a, b) in enumerate(zip(edges, edges[1:])):
        plank[a:b] = k
    tone = rng.uniform(-1, 1, len(edges))[plank][None, :]
    gaps = np.zeros(size)
    gaps[[min(e, size - 1) for e in edges]] = 1.0
    gaps = np.maximum(gaps, np.roll(gaps, 1))[None, :]
    grain = noise(size, 1.2, 23, (8.0, 0.25))
    albedo = 0.9 + 0.12 * tone - 0.14 * (grain - 0.5) - 0.5 * gaps
    height = 1.0 - gaps + 0.12 * grain
    rough = 0.72 + 0.12 * grain
    return np.broadcast_to(albedo, (size, size)).copy(), np.broadcast_to(height, (size, size)).copy(), rough


MAKERS = {"paint": paint, "concrete": concrete, "metal": metal, "gloss": gloss, "fabric": fabric, "timber": timber}


def normal_map(height, strength):
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * strength
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * strength
    n = np.stack([-dx, -dy, np.ones_like(height)], axis=2)
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5


def maps(look):
    size = SIZES[look]
    albedo, height, rough = MAKERS[look](size)
    colour = np.repeat(np.clip(albedo, 0, 1)[:, :, None], 3, axis=2)
    roughness = np.stack([np.zeros_like(rough), np.clip(rough, 0.05, 1.0), np.zeros_like(rough)], axis=2)
    return colour, normal_map(height, NORMAL_STRENGTH[look]), roughness
