import io
import sys
from pathlib import Path

from PIL import Image

SHRINK = {"bump.jpg": (1024, 88), "albedo.jpg": (1024, 86), "orm.jpg": (512, 88)}
TYRE_WIDTH = 1024


def resized(image, size):
    scale = size / max(image.size)
    if scale >= 1:
        return image
    return image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)


def jpeg(image, quality):
    out = io.BytesIO()
    image.save(out, "JPEG", quality=quality, subsampling=0, optimize=True)
    return out.getvalue()


def main():
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "content/cars")
    for team in sorted(p for p in root.iterdir() if (p / "car.glb").exists()):
        lite = team / "lite"
        lite.mkdir(exist_ok=True)
        for name, (size, quality) in SHRINK.items():
            image = Image.open(team / name)
            mode = "L" if image.mode == "L" else "RGB"
            (lite / name).write_bytes(jpeg(resized(image.convert(mode), size), quality))
    tyre = Image.open(root / "shared" / "tyre.png").convert("RGB")
    shared = root / "shared" / "lite"
    shared.mkdir(exist_ok=True)
    (shared / "tyre.jpg").write_bytes(jpeg(resized(tyre, TYRE_WIDTH), 92))
    print("lite textures written")


if __name__ == "__main__":
    main()
