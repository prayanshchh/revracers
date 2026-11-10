import numpy as np


def value_noise(points, scale, seed):
    rng = np.random.default_rng(seed)
    lattice = rng.random((64, 64))
    p = points * scale
    i = np.floor(p).astype(int)
    f = p - i
    f = f * f * (3 - 2 * f)
    at = lambda dx, dy: lattice[(i[:, 0] + dx) % 64, (i[:, 1] + dy) % 64]
    top = at(0, 0) * (1 - f[:, 0]) + at(1, 0) * f[:, 0]
    bottom = at(0, 1) * (1 - f[:, 0]) + at(1, 1) * f[:, 0]
    return top * (1 - f[:, 1]) + bottom * f[:, 1]
