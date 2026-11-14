import json
import sys
from pathlib import Path

from boulevard_fetch import bbox, overpass
from dunebay_geo import CIRCUIT_RELATION, DETAIL_BOUNDS, START_LINE

DETAIL = (
    "way[building];way[highway];way[barrier];way[landuse];way[amenity=parking];way[leisure];way[man_made];"
    "way[natural];way[\"area:highway\"];"
)
TAGS = frozenset((
    "amenity", "area", "barrier", "bridge", "building", "building:levels", "height", "highway", "landuse", "layer",
    "leisure", "man_made", "natural", "oneway", "service", "sport", "surface", "tower:type", "tunnel",
))


def slim(element):
    keep = {k: element[k] for k in ("type", "id", "tags", "lat", "lon", "geometry") if k in element}
    if "tags" in keep:
        keep["tags"] = {k: v for k, v in keep["tags"].items() if k in TAGS}
    if "geometry" in keep:
        keep["geometry"] = [[round(p["lat"], 7), round(p["lon"], 7)] for p in keep["geometry"]]
    return keep


def merged(circuit, detail):
    line = [e for e in circuit["elements"] if e["type"] == "node" and e["id"] == START_LINE]
    ways = [e for e in detail["elements"] if e["type"] == "way" and "geometry" in e]
    return {"copyright": "© OpenStreetMap contributors, ODbL", "elements": [slim(e) for e in line + ways]}


def fetch_osm(out):
    circuit = overpass(f"[out:json][timeout:180];relation({CIRCUIT_RELATION});out body;>;out body qt;")
    detail = overpass(f"[out:json][timeout:600]{bbox(DETAIL_BOUNDS)};({DETAIL});out geom;")
    out.write_text(json.dumps(merged(circuit, detail), separators=(",", ":")))


def main():
    source = Path(sys.argv[1] if len(sys.argv) > 1 else "content/tracks/dune-bay/source")
    source.mkdir(parents=True, exist_ok=True)
    if not (source / "osm.json").exists():
        fetch_osm(source / "osm.json")


if __name__ == "__main__":
    main()
