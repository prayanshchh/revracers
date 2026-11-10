import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from fetch import elevation_tiles, save_elevation
from boulevard_geo import DEM_ORIGIN, DEM_RESOLUTION, DEM_SIZE, DETAIL_BOUNDS, SKYLINE_BOUNDS, STREETS, UTM

USER_AGENT = "revracers-track-builder"
OVERPASS = "https://overpass-api.de/api/interpreter"
DEM_TILE = 250
CIRCUIT_RELATION = 16696508
DETAIL = (
    "way[building];relation[building];way[\"building:part\"];way[highway];way[barrier];way[landuse];"
    "way[amenity];way[leisure];way[man_made];way[natural];way[\"area:highway\"];way[raceway];way[railway];"
    "node[natural=tree];way[water];"
)
ATTRACTIONS = "way[attraction];"
TAGS = frozenset((
    "amenity", "area", "attraction", "bridge", "building", "building:levels", "building:part", "height",
    "highway", "lanes", "min_height", "natural", "oneway", "railway", "service",
))
STREET_NAMES = frozenset(name for name, _ in STREETS)
SKYLINE = "way[building][~\"^(height|building:levels)$\"~\".\"];relation[building][~\"^(height|building:levels)$\"~\".\"];"


def get(url, data=None, attempts=6):
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=600) as response:
                return response.read()
        except OSError:
            if attempt == attempts - 1:
                raise
            time.sleep(10 * (attempt + 1))


def overpass(query):
    body = urllib.parse.urlencode({"data": query}).encode()
    return json.loads(get(OVERPASS, body))


def bbox(bounds):
    west, south, east, north = bounds
    return f"[bbox:{south},{west},{north},{east}]"


def slim(element):
    keep = {k: element[k] for k in ("type", "id", "tags", "lat", "lon", "geometry", "members", "nodes") if k in element}
    if "tags" in keep:
        keep["tags"] = {k: v for k, v in keep["tags"].items() if k in TAGS or (k == "name" and v in STREET_NAMES)}
    if "geometry" in keep:
        keep["geometry"] = [[round(p["lat"], 7), round(p["lon"], 7)] for p in keep["geometry"]]
    if "members" in keep:
        keep["members"] = [
            {
                "type": m["type"],
                "ref": m["ref"],
                "role": m.get("role", ""),
                **({"geometry": [[round(p["lat"], 7), round(p["lon"], 7)] for p in m["geometry"]]} if "geometry" in m else {}),
            }
            for m in keep["members"]
        ]
    return keep


def fetch_osm(out):
    circuit = overpass(f"[out:json][timeout:180];relation({CIRCUIT_RELATION});out body;>;out skel qt;")
    detail = overpass(f"[out:json][timeout:600]{bbox(DETAIL_BOUNDS)};({DETAIL});out geom;")
    skyline = overpass(f"[out:json][timeout:600]{bbox(SKYLINE_BOUNDS)};({SKYLINE});out geom;")
    seen = set()
    elements = []
    for element in circuit["elements"] + detail["elements"] + skyline["elements"]:
        key = (element["type"], element["id"], "geometry" in element)
        if key in seen:
            continue
        seen.add(key)
        elements.append(slim(element))
    out.write_text(
        json.dumps({"copyright": "© OpenStreetMap contributors, ODbL", "elements": elements}, separators=(",", ":"))
    )


def fetch_attractions(out):
    found = overpass(f"[out:json][timeout:180]{bbox(DETAIL_BOUNDS)};({ATTRACTIONS});out geom;")
    out.write_text(
        json.dumps(
            {"copyright": "© OpenStreetMap contributors, ODbL", "elements": [slim(e) for e in found["elements"]]},
            separators=(",", ":"),
        )
    )


def fetch_dem(out):
    size = tuple(int(round(v / DEM_RESOLUTION)) for v in DEM_SIZE)
    save_elevation(elevation_tiles(DEM_ORIGIN, size, DEM_RESOLUTION, DEM_TILE, UTM), 400.0, out)


def main():
    source = Path(sys.argv[1] if len(sys.argv) > 1 else "content/tracks/neon-boulevard/source")
    source.mkdir(parents=True, exist_ok=True)
    if not (source / "osm.json").exists():
        fetch_osm(source / "osm.json")
    if not (source / "attractions.json").exists():
        fetch_attractions(source / "attractions.json")
    if not (source / "dem.png").exists():
        fetch_dem(source / "dem.png")


if __name__ == "__main__":
    main()
