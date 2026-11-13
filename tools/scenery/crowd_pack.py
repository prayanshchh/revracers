import sys
from pathlib import Path

import numpy as np
from PIL import Image

QUALITY = 90


def main():
    source = Path(sys.argv[1])
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    people = np.load(source / "people.npy")
    mask = np.load(source / "people-mask.npy")
    Image.fromarray((np.clip(people, 0, 1) * 255 + 0.5).astype(np.uint8)).save(out / "people.webp", quality=QUALITY, alpha_quality=95, method=6, exact=True)
    Image.fromarray((np.clip(mask, 0, 1) * 255 + 0.5).astype(np.uint8)).save(out / "people-mask.webp", quality=QUALITY, method=6)
    print("sprites", people.shape, "covered", float((people[..., 3] > 0.5).mean()), "tinted", float(mask.mean()))


if __name__ == "__main__":
    main()
