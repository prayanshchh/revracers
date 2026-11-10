import json
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import Transformer
from scipy.ndimage import gaussian_filter, map_coordinates

import geo

UTM = 32611
DETAIL_BOUNDS = (-115.186, 36.098, -115.144, 36.135)
SKYLINE_BOUNDS = (-115.25, 36.04, -115.08, 36.20)
DEM_ORIGIN = (663200, 4000600)
DEM_SIZE = (3900, 4400)
DEM_RESOLUTION = 4.0
TIMING_LINE = 13016217985
START_LINE = 13016217986
CIRCUIT_RELATION = 16696508
PIT_LANE = 1223479152
STREETS = (
    ("Koval Lane", 13.5),
    ("Westchester Drive", 13.0),
    ("Sands Avenue", 14.0),
    ("Spring Mountain Road", 15.0),
    ("South Las Vegas Boulevard", 15.0),
    ("West Harmon Avenue", 13.5),
    ("East Harmon Avenue", 13.5),
)

_utm = Transformer.from_crs(4326, UTM, always_xy=True)


class Osm(geo.Osm):
    def __init__(self, path):
        self.path = Path(path)
        data = json.loads(self.path.read_text())
        self.elements = data["elements"]
        self.nodes = {e["id"]: (e["lat"], e["lon"]) for e in self.elements if e["type"] == "node" and "lat" in e}
        self.ways = {}
        self.shapes = {}
        for e in self.elements:
            if e["type"] != "way":
                continue
            if "nodes" in e and e["id"] not in self.ways:
                self.ways[e["id"]] = e
            if "geometry" in e:
                self.shapes[e["id"]] = e
                for node, point in zip(e.get("nodes", []), e["geometry"]):
                    self.nodes.setdefault(node, tuple(point))
        self.relations = {e["id"]: e for e in self.elements if e["type"] == "relation"}
        self.origin = self.nodes[TIMING_LINE]

    def way_nodes(self, way_id):
        return self.ways[way_id]["nodes"]

    def way(self, way_id):
        return self.local([self.nodes[n] for n in self.way_nodes(way_id)])

    def tagged(self, key, value=None):
        return [
            w
            for w in self.shapes.values()
            if key in w.get("tags", {}) and (value is None or w["tags"][key] == value)
        ]

    def circuit_nodes(self):
        relation = self.relations[CIRCUIT_RELATION]
        chain = []
        for member in relation["members"]:
            if member["type"] != "way" or member["role"] not in ("forward", "backward"):
                continue
            nodes = list(self.ways[member["ref"]]["nodes"])
            if member["role"] == "backward":
                nodes.reverse()
            if chain and chain[-1] != nodes[0]:
                raise ValueError(f"circuit relation breaks at way {member['ref']}")
            chain += nodes if not chain else nodes[1:]
        return chain


class Terrain:
    def __init__(self, path, osm, smoothing=0.0):
        heights = np.asarray(Image.open(path), np.float64) / 100.0 + 400.0
        self.heights = gaussian_filter(heights, smoothing) if smoothing > 0 else heights
        self.osm = osm

    def __call__(self, points):
        lat, lon = self.osm.latlon(points)
        x, y = _utm.transform(lon, lat)
        rows = (DEM_ORIGIN[1] - np.asarray(y)) / DEM_RESOLUTION - 0.5
        cols = (np.asarray(x) - DEM_ORIGIN[0]) / DEM_RESOLUTION - 0.5
        return map_coordinates(self.heights, [rows, cols], order=1, mode="nearest")
