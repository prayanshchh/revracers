import io
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from natural_sky import SKY_SATURATION, clear_dome, desaturated, exposure_of, sun_direction
from sky import decode, read_header, scanline

SKY_SCALE = 0.3
SKY_GAMMA = 2.2
SKY_LIMIT = 0.999
SKY_QUALITY = 97
TERRAIN_SIZE = 256
TERRAIN_LUMINANCE = 0.12
TERRAIN_SEED = 23
SUN_KEEP = 3.0
ENVIRONMENT_SATURATION = 0.5
SUN_LIMIT = 40.0
DOME_WIDTH = 2048
HORIZON_BAND = (2.0, 6.0)

SURFACES = {
    "asphalt_base": ("asphalt_track_base_color.jpg", 1024, "colour", 86),
    "asphalt_normal": ("asphalt_track_normal.jpg", 1024, "colour", 88),
    "asphalt_base_first": ("asphalt_track_base_color.jpg", 512, "colour", 84),
    "asphalt_normal_first": ("asphalt_track_normal.jpg", 512, "colour", 84),
    "asphalt_roughness": ("asphalt_track_roughness.png", 512, "green", 85),
    "paint_white": ("circuit_paint_white.jpg", 256, "colour", 85),
    "paint_normal": ("circuit_paint_normal.jpg", 256, "colour", 85),
    "paint_roughness": ("circuit_paint_roughness.png", 256, "green", 85),
    "grass_base": ("grass_base_color.jpg", 256, "colour", 82),
    "grass_normal": ("withered_grass_normal.jpg", 256, "colour", 82),
    "concrete_base": ("rough_concrete_base_color.jpg", 256, "colour", 84),
    "concrete_normal": ("rough_concrete_normal.jpg", 256, "colour", 84),
    "tecpro_base": ("tecpro_base_color.png", 512, "colour", 88),
}


def webp(image, quality):
    out = io.BytesIO()
    image.save(out, "WEBP", quality=quality, method=6)
    return out.getvalue()


def surface(path, size, mode, quality):
    image = Image.open(path)
    if mode == "green":
        image = image.convert("RGB").getchannel("G").convert("RGB")
    else:
        image = image.convert("RGB")
    scale = size / max(image.size)
    if scale < 1:
        image = image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)
    return webp(image, quality)


def streaks(path):
    image = Image.open(path).convert("L")
    image = image.resize((image.width // 2, image.height // 2), Image.LANCZOS)
    return webp(image.convert("RGB"), 85)


def smooth_noise(size, cells, rng):
    grid = rng.random((cells + 1, cells + 1))
    grid[-1, :] = grid[0, :]
    grid[:, -1] = grid[:, 0]
    t = np.linspace(0, cells, size, endpoint=False)
    i = t.astype(int)
    f = t - i
    f = f * f * (3 - 2 * f)
    rows = grid[i] * (1 - f)[:, None] + grid[i + 1] * f[:, None]
    return rows[:, i] * (1 - f)[None, :] + rows[:, i + 1] * f[None, :]


def terrain():
    rng = np.random.default_rng(TERRAIN_SEED)
    field = 0.55 * smooth_noise(TERRAIN_SIZE, 4, rng) + 0.3 * smooth_noise(TERRAIN_SIZE, 12, rng) + 0.15 * smooth_noise(TERRAIN_SIZE, 32, rng)
    tone = TERRAIN_LUMINANCE * (0.8 + 0.45 * field)
    tint = np.array([0.95, 1.12, 0.45])
    linear = np.clip(tone[..., None] * tint[None, None, :], 0, 1)
    srgb = np.where(linear <= 0.0031308, linear * 12.92, 1.055 * linear ** (1 / 2.4) - 0.055)
    return webp(Image.fromarray((srgb * 255 + 0.5).astype(np.uint8)), 85)


def hdr(path):
    data = path.read_bytes()
    start, width, height = read_header(data)
    rows = np.empty((height, width, 4), np.uint8)
    offset = start
    for y in range(height):
        if data[offset] == 2 and data[offset + 1] == 2:
            rows[y], offset = scanline(data, offset, width)
        else:
            rows[y] = np.frombuffer(data, np.uint8, width * 4, offset).reshape(width, 4)
            offset += width * 4
    return decode(rows)


def sun_angle(height, width, full_height, meta):
    latitude = (0.5 - (np.arange(height) + 0.5) / full_height) * np.pi
    longitude = ((np.arange(width) + 0.5) / width - 0.5) * 2 * np.pi
    sun = sun_direction(meta)
    cosine = np.sin(latitude)[:, None] * sun[2] + np.cos(latitude)[:, None] * (np.cos(longitude)[None, :] * sun[0] + np.sin(longitude)[None, :] * sun[1])
    return np.degrees(np.arccos(np.clip(cosine, -1, 1)))


def with_photo_sun(photo, meta):
    height, width, _ = photo.shape
    angle = sun_angle(height, width, height / meta["keepTop"], meta)
    near = np.clip((SUN_KEEP - angle) / (SUN_KEEP / 2), 0, 1)[..., None]
    return lambda sky: sky * (1 - near) + np.maximum(photo, sky) * near


def resized(radiance, size):
    channels = [np.asarray(Image.fromarray(radiance[..., c].astype(np.float32), "F").resize(size, Image.BOX)) for c in range(3)]
    return np.stack(channels, -1)


def clear_environment(environment, clean, meta):
    height, width, _ = environment.shape
    keep = int(round(height * meta["keepTop"]))
    upper = resized(clean, (width, keep))
    angle = sun_angle(keep, width, height, meta)
    peak = upper.max(axis=2, keepdims=True)
    upper = np.where((angle[..., None] < 12) & (peak > SUN_LIMIT), upper * SUN_LIMIT / np.maximum(peak, 1e-6), upper)
    out = environment.copy()
    horizon = height // 2
    out[:horizon] = upper[:horizon]
    blend = np.linspace(1, 0, keep - horizon)[:, None, None]
    out[horizon:keep] = upper[horizon:keep] * blend + environment[horizon:keep] * (1 - blend)
    return out


def sky_meta(meta, clean):
    rows = clean.shape[0]
    dome_latitude = np.degrees((0.5 - (np.arange(rows) + 0.5) / (rows / meta["keepTop"])) * np.pi)
    band = (dome_latitude > HORIZON_BAND[0]) & (dome_latitude < HORIZON_BAND[1])
    return {
        **meta,
        "horizon": [float(v) for v in desaturated(clean[band].mean(axis=(0, 1)), SKY_SATURATION)],
        "encoding": {"scale": SKY_SCALE, "gamma": SKY_GAMMA},
    }


def encoded_sky(radiance):
    t = np.clip(radiance / (radiance + SKY_SCALE), 0, SKY_LIMIT)
    g = t ** (1 / SKY_GAMMA)
    return webp(Image.fromarray((g * 255 + 0.5).astype(np.uint8)), SKY_QUALITY)


def main():
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "content/tracks/training-ground")
    sources = Path(sys.argv[2])
    sky_source = Path(sys.argv[3] if len(sys.argv) > 3 else "content/tracks/hill-country/sky")
    textures = root / "textures"
    textures.mkdir(parents=True, exist_ok=True)
    for name, (file, size, mode, quality) in SURFACES.items():
        (textures / f"{name}.webp").write_bytes(surface(sources / file, size, mode, quality))
    (textures / "asphalt_streaks.webp").write_bytes(streaks(sources / "asphalt_streaks.png"))
    (textures / "terrain.webp").write_bytes(terrain())
    sky = root / "sky"
    sky.mkdir(parents=True, exist_ok=True)
    meta = json.loads((sky_source / "noon.json").read_text())
    photo = hdr(sky_source / "noon.hdr")
    clean = clear_dome(photo.shape[:2], meta, exposure_of(meta["skyRadiance"]), with_photo_sun(photo, meta))
    environment = clear_environment(hdr(sky_source / "noon-env.hdr"), desaturated(clean, ENVIRONMENT_SATURATION), meta)
    dome = resized(clean, (DOME_WIDTH, round(clean.shape[0] * DOME_WIDTH / clean.shape[1])))
    (sky / "noon-dome.webp").write_bytes(encoded_sky(dome))
    (sky / "noon-env.webp").write_bytes(encoded_sky(environment))
    (sky / "noon.json").write_text(json.dumps(sky_meta(meta, clean), indent=2) + "\n")
    total = sum(f.stat().st_size for f in [*textures.iterdir(), *sky.iterdir()])
    print(f"wrote {len(list(textures.iterdir()))} textures and the sky, {total / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
