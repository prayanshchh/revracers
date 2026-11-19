import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import binary_opening, gaussian_filter

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "track"))

from geo import DEM_ORIGIN, DEM_SIZE

CELL = 2.0
LIDAR_CELL = 0.5
GROWN = 1.5
TALLEST = 25.0
UNMEASURED = 251
NDVI_STEPS = np.linspace(-0.1, 0.4, 51)
LIGHT_STEPS = np.linspace(0.25, 0.6, 36)
GREEN_FLOOR = 0.1
NARROWEST = np.ones((2, 2))
TALL = 10.0
TALL_NARROWEST = np.ones((3, 3))


def photo(colour_path, infrared_path, width, height):
    Image.MAX_IMAGE_PIXELS = None
    shrink = lambda image: np.asarray(image.resize((width, height), Image.BOX), np.float32) / 255.0
    colour = shrink(Image.open(colour_path).convert("RGB"))
    infrared = shrink(Image.open(infrared_path).convert("L"))
    red = colour[..., 0]
    green = (infrared - red) / np.maximum(infrared + red, 1e-3)
    return gaussian_filter(green, 0.6), gaussian_filter(colour.mean(-1), 0.8)


def lidar(path, width, height):
    data = np.load(path)
    surface = np.nan_to_num(data["dsm"] - data["dtm"], nan=0.0).clip(0, TALLEST)
    step = int(round(CELL / LIDAR_CELL))
    column = int(round((float(data["e0"]) - DEM_ORIGIN[0]) / LIDAR_CELL))
    row = int(round((DEM_ORIGIN[1] - float(data["n1"])) / LIDAR_CELL))
    fine = np.full((height * step, width * step), np.nan, np.float32)
    rows, columns = surface.shape
    top, left = max(row, 0), max(column, 0)
    bottom, right = min(row + rows, fine.shape[0]), min(column + columns, fine.shape[1])
    fine[top:bottom, left:right] = surface[top - row : bottom - row, left - column : right - column]
    blocks = fine.reshape(height, step, width, step)
    covered = np.isfinite(blocks).all((1, 3))
    return np.where(covered, np.nanmax(np.nan_to_num(blocks, nan=0.0), (1, 3)), 0.0), covered


def thresholds(green, light, canopy, covered):
    truth = canopy[covered]
    best = (-1.0, 0.0, 1.0)
    for low in NDVI_STEPS:
        leafy = green[covered] > low
        for dark in LIGHT_STEPS:
            guess = leafy & (light[covered] < dark)
            hit = (guess & truth).sum()
            score = 2 * hit / max(guess.sum() + truth.sum(), 1)
            if score > best[0]:
                best = (score, low, dark)
    return best


def main():
    root = Path(sys.argv[1])
    folder = Path(sys.argv[2])
    width, height = int(DEM_SIZE[0] / CELL), int(DEM_SIZE[1] / CELL)
    recent, recent_light = photo(folder / "naip2024-rgb.png", folder / "naip2024-nir.png", width, height)
    older, older_light = photo(root / "source" / "aerial.jpg", root / "source" / "aerial-nir.png", width, height)
    tall, covered = lidar(Path(sys.argv[3]), width, height)
    wires = (tall > TALL) & ~binary_opening(tall > TALL, TALL_NARROWEST)
    measured = binary_opening((tall > GROWN) & (recent > GREEN_FLOOR) & ~wires, NARROWEST) & covered
    guess = np.ones((height, width), bool)
    fits = []
    for green, light in ((recent, recent_light), (older, older_light)):
        score, low, dark = thresholds(green, light, measured, covered)
        guess &= (green > low) & (light < dark)
        fits.append(f"ndvi > {low:.2f}, light < {dark:.2f}, fit {score:.2f}")
    guessed = binary_opening(guess, NARROWEST) & ~covered
    out = np.zeros((height, width), np.uint8)
    out[measured] = np.clip(np.round(tall[measured] * 10), 1, UNMEASURED - 1)
    out[guessed] = UNMEASURED
    Image.fromarray(out).save(root / "source" / "canopy.png", optimize=True)
    print(f"canopy {width}x{height} at {CELL} m: {int(measured.sum())} measured cells, {int(guessed.sum())} from colour in both photos ({'; '.join(fits)})")


if __name__ == "__main__":
    main()
