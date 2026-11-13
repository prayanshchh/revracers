import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt, gaussian_filter

SPECIES = ("oak", "elm", "ash", "shrub", "palm")
COLOUR_QUALITY = 84
LIGHT_QUALITY = 84
LIGHT_SCALE = 2
SOLID = 0.35
LIGHT_BLUR = 0.6


def srgb(linear):
    return np.where(linear <= 0.0031308, linear * 12.92, 1.055 * np.power(np.maximum(linear, 1e-9), 1 / 2.4) - 0.055)


def bleed(pixels, alpha, columns, rows):
    out = pixels.copy()
    height, width = alpha.shape
    tall, wide = height // rows, width // columns
    for row in range(rows):
        for column in range(columns):
            window = (slice(row * tall, (row + 1) * tall), slice(column * wide, (column + 1) * wide))
            solid = alpha[window] > SOLID
            if not solid.any():
                continue
            _, (near_row, near_column) = distance_transform_edt(~solid, return_indices=True)
            cell = pixels[window]
            out[window] = np.where(solid[..., None], cell, cell[near_row, near_column])
    return out


def halve(image, scale):
    height, width = image.shape[:2]
    return image.reshape(height // scale, scale, width // scale, scale, -1).mean((1, 3))


def pack(source, out, name):
    meta = json.loads((source / f"{name}.json").read_text())
    colour = np.load(source / f"{name}-colour.npy")
    light = np.load(source / f"{name}-light.npy")
    alpha = colour[..., 3]
    rgb = bleed(srgb(np.clip(colour[..., :3], 0, 1)), alpha, meta["columns"], meta["rows"])
    rgba = np.concatenate([rgb, alpha[..., None]], -1)
    Image.fromarray((np.clip(rgba, 0, 1) * 255 + 0.5).astype(np.uint8)).save(
        out / f"{name}.webp", quality=COLOUR_QUALITY, alpha_quality=92, method=6, exact=True
    )
    lit = bleed(light, alpha, meta["columns"], meta["rows"])
    lit = np.stack([gaussian_filter(lit[..., c], LIGHT_BLUR) for c in range(3)], -1)
    lit = halve(lit, LIGHT_SCALE)
    Image.fromarray((np.clip(lit, 0, 1) * 255 + 0.5).astype(np.uint8)).save(out / f"{name}-light.webp", quality=LIGHT_QUALITY, method=6)
    return {key: meta[key] for key in ("sizes", "spread", "drops")}, {key: meta[key] for key in ("sunElevation", "sunTurns", "lightScale")}


def main():
    source = Path(sys.argv[1])
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    first = json.loads((source / f"{SPECIES[0]}.json").read_text())
    packed = {name: pack(source, out, name) for name in SPECIES}
    table = {
        "columns": first["columns"],
        "rows": first["rows"],
        "azimuths": first["azimuths"],
        "rings": first["rings"],
        **packed[SPECIES[0]][1],
        "species": {name: packed[name][0] for name in SPECIES},
    }
    (out / "trees.json").write_text(json.dumps(table, indent=2) + "\n")


if __name__ == "__main__":
    main()
