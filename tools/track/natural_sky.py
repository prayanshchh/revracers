import numpy as np

EARTH = 6360e3
TOP = 6460e3
EYE = 300.0
RAYLEIGH = np.array([5.802e-6, 13.558e-6, 33.1e-6])
RAYLEIGH_HEIGHT = 8000.0
MIE_SCATTER = 3.996e-6
MIE_EXTINCT = 4.40e-6
MIE_HEIGHT = 1200.0
MIE_G = 0.8
OZONE = np.array([0.650e-6, 1.881e-6, 0.085e-6])
OZONE_PEAK = 25e3
OZONE_WIDTH = 15e3
VIEW_STEPS = 48
SUN_STEPS = 16
LOWEST_RAY = 0.002
CHUNK = 8192
COARSE = 4

SKY_SATURATION = 0.78
SKY_GAIN = 1.25
SUN_SHARE = 3.5
TARGET_MIDTONE = 1.4
MAX_EXPOSURE = 6.0
ACES_IN = np.array([[0.59719, 0.35458, 0.04823], [0.07600, 0.90834, 0.01566], [0.02840, 0.13383, 0.83777]])
ACES_OUT = np.array([[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]])
LUMINANCE = np.array([0.2126, 0.7152, 0.0722])

REFERENCE = {2.0: (198, 216, 228), 8.0: (174, 203, 219), 20.0: (132, 182, 207)}
GAIN_BLUR = 3.0
FIT_STEPS = 40
FIT_RATE = 0.9


def sun_direction(meta):
    elevation, azimuth = meta["elevation"], meta["azimuth"]
    return np.array([np.cos(elevation) * np.cos(azimuth), np.cos(elevation) * np.sin(azimuth), np.sin(elevation)])


def latitudes(height, keep_top):
    return (0.5 - (np.arange(height) + 0.5) / (height / keep_top)) * np.pi


def directions(height, width, keep_top):
    latitude = latitudes(height, keep_top)
    longitude = ((np.arange(width) + 0.5) / width - 0.5) * 2 * np.pi
    return np.stack([
        np.cos(latitude)[:, None] * np.cos(longitude)[None, :],
        np.cos(latitude)[:, None] * np.sin(longitude)[None, :],
        np.repeat(np.sin(latitude)[:, None], width, 1),
    ], -1)


def to_top(origin, direction):
    b = (origin * direction).sum(-1)
    c = (origin * origin).sum(-1) - TOP * TOP
    return -b + np.sqrt(np.maximum(b * b - c, 0))


def extinction(point):
    height = np.linalg.norm(point, axis=-1) - EARTH
    rayleigh = np.exp(-height / RAYLEIGH_HEIGHT)
    mie = np.exp(-height / MIE_HEIGHT)
    ozone = np.maximum(0, 1 - np.abs(height - OZONE_PEAK) / OZONE_WIDTH)
    total = RAYLEIGH * rayleigh[..., None] + MIE_EXTINCT * mie[..., None] + OZONE * ozone[..., None]
    return total, rayleigh, mie


def marched(length, steps):
    edges = (np.arange(steps + 1) / steps) ** 2
    for i in range(steps):
        yield (edges[i] + edges[i + 1]) / 2 * length, (edges[i + 1] - edges[i]) * length


def toward_sun(point, sun):
    depth = np.zeros(point.shape)
    for t, ds in marched(to_top(point, np.broadcast_to(sun, point.shape)), SUN_STEPS):
        depth += extinction(point + sun * t[..., None])[0] * ds[..., None]
    return np.exp(-depth)


def phases(mu):
    rayleigh = 3 / (16 * np.pi) * (1 + mu * mu)
    g = MIE_G
    mie = 3 / (8 * np.pi) * (1 - g * g) * (1 + mu * mu) / ((2 + g * g) * (1 + g * g - 2 * g * mu) ** 1.5)
    return rayleigh, mie


def lifted(direction):
    flat = np.linalg.norm(direction[:, :2], axis=-1, keepdims=True)
    raised = np.concatenate([direction[:, :2] / flat * np.sqrt(1 - LOWEST_RAY ** 2), np.full((len(direction), 1), LOWEST_RAY)], -1)
    return np.where(direction[:, 2:3] < LOWEST_RAY, raised, direction)


def single_scatter(direction, sun):
    flat = direction.reshape(-1, 3)
    out = np.zeros(flat.shape)
    origin = np.array([0.0, 0.0, EARTH + EYE])
    for start in range(0, len(flat), CHUNK):
        view = lifted(flat[start:start + CHUNK])
        eye = np.broadcast_to(origin, view.shape)
        rayleigh_phase, mie_phase = phases(view @ sun)
        depth = np.zeros(view.shape)
        light = np.zeros(view.shape)
        for t, ds in marched(to_top(eye, view), VIEW_STEPS):
            point = eye + view * t[:, None]
            sigma, rayleigh, mie = extinction(point)
            step = sigma * ds[:, None]
            scatter = RAYLEIGH * (rayleigh * rayleigh_phase)[:, None] + MIE_SCATTER * (mie * mie_phase)[:, None]
            light += np.exp(-(depth + step / 2)) * toward_sun(point, sun) * scatter * ds[:, None]
            depth += step
        out[start:start + CHUNK] = light
    return out.reshape(direction.shape)


def upsampled(small, height, width):
    h, w, _ = small.shape
    rows = (np.arange(height) + 0.5) * h / height - 0.5
    cols = (np.arange(width) + 0.5) * w / width - 0.5
    r0 = np.clip(np.floor(rows).astype(int), 0, h - 1)
    r1 = np.clip(r0 + 1, 0, h - 1)
    fr = np.clip(rows - np.floor(rows), 0, 1)[:, None, None]
    c0 = np.floor(cols).astype(int) % w
    c1 = (c0 + 1) % w
    fc = (cols - np.floor(cols))[None, :, None]
    top = small[r0][:, c0] * (1 - fc) + small[r0][:, c1] * fc
    bottom = small[r1][:, c0] * (1 - fc) + small[r1][:, c1] * fc
    return top * (1 - fr) + bottom * fr


def exposure_of(sky_radiance):
    return min(MAX_EXPOSURE, TARGET_MIDTONE / ((1 + SUN_SHARE) * sky_radiance[1]))


def desaturated(radiance, share):
    grey = (radiance @ LUMINANCE)[..., None]
    return grey + (radiance - grey) * share


def displayed(radiance, exposure):
    colour = desaturated(radiance, SKY_SATURATION) * SKY_GAIN * exposure / 0.6
    colour = colour @ ACES_IN.T
    colour = (colour * (colour + 0.0245786) - 0.000090537) / (colour * (0.983729 * colour + 0.4329510) + 0.238081)
    colour = np.clip(colour @ ACES_OUT.T, 0, 1)
    return np.where(colour <= 0.0031308, 12.92 * colour, 1.055 * colour ** (1 / 2.4) - 0.055) * 255


def linear(srgb):
    c = np.asarray(srgb, float) / 255
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def gain_rows(elevation, anchors, gains, rows_per_degree):
    logs = np.stack([np.interp(elevation, anchors, np.log(gains[:, c])) for c in range(3)], -1)
    sigma = GAIN_BLUR * rows_per_degree
    reach = int(3 * sigma)
    kernel = np.exp(-0.5 * (np.arange(-reach, reach + 1) / sigma) ** 2)
    kernel /= kernel.sum()
    padded = np.concatenate([np.repeat(logs[:1], reach, 0), logs, np.repeat(logs[-1:], reach, 0)])
    return np.exp(np.stack([np.convolve(padded[:, c], kernel, "valid") for c in range(3)], -1))


def clear_dome(shape, meta, exposure, keep_sun):
    height, width = shape
    sun = sun_direction(meta)
    keep_top = meta["keepTop"]
    coarse = single_scatter(directions(height // COARSE, width // COARSE, keep_top), sun)
    base = upsampled(coarse, height, width)
    elevation = np.degrees(latitudes(height, keep_top))
    rows_per_degree = height / keep_top / 180
    anchors = np.array(sorted(REFERENCE))
    target = linear([REFERENCE[a] for a in anchors])
    picks = [int(np.argmin(np.abs(elevation - a))) for a in anchors]
    gains = np.ones((len(anchors), 3))
    for _ in range(FIT_STEPS):
        sky = keep_sun(base * gain_rows(elevation, anchors, gains, rows_per_degree)[:, None, :])
        seen = np.array([np.median(displayed(sky[row], exposure), axis=0) for row in picks])
        gains *= (target / np.maximum(linear(seen), 1e-6)) ** FIT_RATE
    return keep_sun(base * gain_rows(elevation, anchors, gains, rows_per_degree)[:, None, :])
