import io
import json
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image

from brands import FONTS
from geo import BOUNDS, DEM_ORIGIN, DEM_SIZE

Image.MAX_IMAGE_PIXELS = None

USER_AGENT = "revracers-track-builder"
DEM_SERVICE = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"
AERIAL_SERVICE = "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage"
AERIAL_METRES_PER_PIXEL = 0.3
AERIAL_TILE = 4000
AERIAL_QUALITY = 92
NEAR_INFRARED_BAND = "3"
FONT_REPOSITORY = "https://raw.githubusercontent.com/google/fonts/main"
REGION_SERVICE = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/export"
REGION_SIZE = 44000
REGION_CENTRE = (631483, 3334446)
REGION_DEM_PIXELS = 1100
REGION_AERIAL_PIXELS = 4096
OSM_MAP = "https://api.openstreetmap.org/api/0.6/map.json"
NAIP_2024_SERVICE = "https://planetarycomputer.microsoft.com/api/data/v1/item/bbox"
NAIP_2024_ITEMS = ("tx_m_3009751_se_14_060_20240821", "tx_m_3009752_sw_14_060_20240821", "tx_m_3009759_ne_14_060_20240821", "tx_m_3009760_nw_14_060_20240821")
NAIP_2024_METRES_PER_PIXEL = 0.6
NAIP_2024_TILE = 1024
KEEP = ("highway", "area:highway", "barrier", "building", "landuse", "natural", "leisure", "amenity", "man_made", "raceway")


def get(url, attempts=4):
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=180) as response:
                return response.read()
        except OSError:
            if attempt == attempts - 1:
                raise
            time.sleep(5 * (attempt + 1))


def fetch_osm(out):
    west, south, east, north = BOUNDS
    data = json.loads(get(f"{OSM_MAP}?bbox={west},{south},{east},{north}"))
    elements = data["elements"]
    ways = [e for e in elements if e["type"] == "way" and any(k in e.get("tags", {}) for k in KEEP)]
    relations = [e for e in elements if e["type"] == "relation" and e.get("tags", {}).get("type") == "circuit"]
    used = {n for w in ways for n in w["nodes"]}
    used |= {m["ref"] for r in relations for m in r["members"] if m["type"] == "node"}
    nodes = [
        {k: e[k] for k in ("type", "id", "lat", "lon", "tags") if k in e}
        for e in elements
        if e["type"] == "node" and (e["id"] in used or "raceway" in e.get("tags", {}))
    ]
    ways = [{k: w[k] for k in ("type", "id", "nodes", "tags")} for w in ways]
    relations = [{k: r[k] for k in ("type", "id", "members", "tags")} for r in relations]
    out.write_text(
        json.dumps(
            {"copyright": data["copyright"], "license": data["license"], "elements": nodes + ways + relations},
            separators=(",", ":"),
        )
    )


def elevation_tiles(origin, size, resolution, tile, epsg):
    x0, y0 = origin
    width, height = size
    dem = np.zeros((height, width), np.float32)
    for top in range(0, height, tile):
        for left in range(0, width, tile):
            w, h = min(tile, width - left), min(tile, height - top)
            xmin, ymax = x0 + left * resolution, y0 - top * resolution
            url = (
                f"{DEM_SERVICE}?bbox={xmin},{ymax - h * resolution},{xmin + w * resolution},{ymax}&bboxSR={epsg}&imageSR={epsg}"
                f"&size={w},{h}&format=tiff&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image"
            )
            for attempt in range(6):
                body = get(url)
                if body[:2] in (b"II", b"MM"):
                    break
                time.sleep(5 * (attempt + 1))
            else:
                raise RuntimeError(f"elevation service refused tile {left},{top}")
            dem[top : top + h, left : left + w] = tifffile.imread(io.BytesIO(body))
    return dem


def save_elevation(dem, floor, out):
    centimetres = np.round((dem - floor) * 100.0)
    if centimetres.min() < 0 or centimetres.max() > 65535:
        raise RuntimeError(f"elevation outside the {floor:.0f} m to {floor + 655.35:.0f} m PNG range")
    Image.fromarray(centimetres.astype(np.uint16)).save(out)


def fetch_dem(out):
    save_elevation(elevation_tiles(DEM_ORIGIN, DEM_SIZE, 1, 1000, 32614), 100.0, out)


def aerial_tile(service, xmin, ymin, xmax, ymax, width, height, bands="0,1,2", mode="RGB"):
    url = (
        f"{service}?bbox={xmin},{ymin},{xmax},{ymax}&bboxSR=32614&imageSR=32614"
        f"&size={width},{height}&format=png&pixelType=U8&bandIds={bands}&interpolation=RSP_BilinearInterpolation&f=image"
    )
    for attempt in range(6):
        body = get(url)
        if body[:4] == b"\x89PNG":
            return Image.open(io.BytesIO(body)).convert(mode)
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"imagery service refused tile {xmin},{ymin}")


def fetch_aerial(out, bands="0,1,2", mode="RGB"):
    x0, y0 = DEM_ORIGIN
    span_x, span_y = DEM_SIZE
    width = int(round(span_x / AERIAL_METRES_PER_PIXEL))
    height = int(round(span_y / AERIAL_METRES_PER_PIXEL))
    image = Image.new(mode, (width, height))
    for top in range(0, height, AERIAL_TILE):
        for left in range(0, width, AERIAL_TILE):
            w, h = min(AERIAL_TILE, width - left), min(AERIAL_TILE, height - top)
            xmin = x0 + left * AERIAL_METRES_PER_PIXEL
            ymax = y0 - top * AERIAL_METRES_PER_PIXEL
            tile = aerial_tile(AERIAL_SERVICE, xmin, ymax - h * AERIAL_METRES_PER_PIXEL, xmin + w * AERIAL_METRES_PER_PIXEL, ymax, w, h, bands, mode)
            image.paste(tile, (left, top))
    if out.suffix == ".png":
        image.save(out)
    else:
        image.save(out, quality=AERIAL_QUALITY, subsampling=0)


def fetch_region(dem_out, aerial_out):
    half = REGION_SIZE / 2
    cx, cy = REGION_CENTRE
    box = (cx - half, cy - half, cx + half, cy + half)
    url = (
        f"{REGION_SERVICE}?bbox={box[0]},{box[1]},{box[2]},{box[3]}&bboxSR=32614&imageSR=32614"
        f"&size={REGION_AERIAL_PIXELS},{REGION_AERIAL_PIXELS}&format=jpg&f=image"
    )
    Image.open(io.BytesIO(get(url))).convert("RGB").save(aerial_out, quality=AERIAL_QUALITY, subsampling=0)
    url = (
        f"{DEM_SERVICE}?bbox={box[0]},{box[1]},{box[2]},{box[3]}&bboxSR=32614&imageSR=32614"
        f"&size={REGION_DEM_PIXELS},{REGION_DEM_PIXELS}&format=tiff&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image"
    )
    for attempt in range(6):
        body = get(url)
        if body[:2] in (b"II", b"MM"):
            break
        time.sleep(5 * (attempt + 1))
    else:
        raise RuntimeError("elevation service refused the region")
    dem = tifffile.imread(io.BytesIO(body))
    Image.fromarray(np.round((dem - 100.0) * 100.0).astype(np.uint16)).save(dem_out)


def fetch_naip_2024(colour_out, infrared_out):
    step = NAIP_2024_METRES_PER_PIXEL
    width, height = int(round(DEM_SIZE[0] / step)), int(round(DEM_SIZE[1] / step))
    data = np.zeros((4, height, width), np.uint8)
    have = np.zeros((height, width), bool)
    for top in range(0, height, NAIP_2024_TILE):
        for left in range(0, width, NAIP_2024_TILE):
            w, h = min(NAIP_2024_TILE, width - left), min(NAIP_2024_TILE, height - top)
            xmin, ymax = DEM_ORIGIN[0] + left * step, DEM_ORIGIN[1] - top * step
            xmax, ymin = xmin + w * step, ymax - h * step
            for item in NAIP_2024_ITEMS:
                need = ~have[top : top + h, left : left + w]
                if not need.any():
                    break
                url = (
                    f"{NAIP_2024_SERVICE}/{xmin},{ymin},{xmax},{ymax}/{w}x{h}.npy?collection=naip&item={item}"
                    "&coord_crs=epsg:32614&dst_crs=epsg:32614&assets=image&asset_bidx=image%7C1,2,3,4&resampling=bilinear"
                )
                tile = np.load(io.BytesIO(get(url)), allow_pickle=False)
                if tile.ndim != 3 or tile.shape[0] != 5:
                    continue
                valid = (tile[4] > 0) & need
                data[:, top : top + h, left : left + w][:, valid] = tile[:4][:, valid]
                have[top : top + h, left : left + w] |= valid
    if not have.all():
        raise RuntimeError("NAIP 2024 left part of the grid uncovered")
    Image.fromarray(np.moveaxis(data[:3], 0, -1)).save(colour_out, quality=AERIAL_QUALITY, subsampling=0)
    Image.fromarray(data[3]).save(infrared_out)


def fetch_fonts(directory):
    directory.mkdir(parents=True, exist_ok=True)
    for name, path in FONTS.items():
        target = directory / f"{name}.ttf"
        if not target.exists():
            target.write_bytes(get(f"{FONT_REPOSITORY}/{path}"))


def main():
    source = Path(sys.argv[1] if len(sys.argv) > 1 else "content/tracks/hill-country/source")
    fetch_fonts(Path("build/hill-country/fonts"))
    source.mkdir(parents=True, exist_ok=True)
    if not (source / "osm.json").exists():
        fetch_osm(source / "osm.json")
    if not (source / "dem.png").exists():
        fetch_dem(source / "dem.png")
    if not (source / "aerial.jpg").exists():
        fetch_aerial(source / "aerial.jpg")
    if not (source / "aerial-nir.png").exists():
        fetch_aerial(source / "aerial-nir.png", NEAR_INFRARED_BAND, "L")
    if not (source / "aerial-2024.jpg").exists():
        fetch_naip_2024(source / "aerial-2024.jpg", source / "aerial-2024-nir.png")
    if not (source / "region-aerial.jpg").exists():
        fetch_region(source / "region-dem.png", source / "region-aerial.jpg")


if __name__ == "__main__":
    main()
