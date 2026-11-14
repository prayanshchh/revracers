import json
from pathlib import Path

import numpy as np

import geo

DETAIL_BOUNDS = (51.428, 25.468, 51.482, 25.512)
CIRCUIT_RELATION = 21297662
START_LINE = 14134811030
LAP_WAYS = (1553605580, 152483595)
PIT_WAYS = (1037707300, 196193732)


class Osm(geo.Osm):
    def __init__(self, path):
        data = json.loads(Path(path).read_text())
        self.elements = data["elements"]
        self.shapes = {e["id"]: e for e in self.elements if e["type"] == "way"}
        nodes = {e["id"]: (e["lat"], e["lon"]) for e in self.elements if e["type"] == "node"}
        self.origin = nodes[START_LINE]

    def way(self, way_id):
        return self.local(self.shapes[way_id]["geometry"])

    def chain(self, way_ids):
        parts = [self.way(way_id) for way_id in way_ids]
        for before, after in zip(parts, parts[1:]):
            if np.linalg.norm(before[-1] - after[0]) > 0.5:
                raise ValueError("ways do not join end to end")
        return np.vstack([parts[0]] + [part[1:] for part in parts[1:]])

    def tagged(self, key, values=None):
        return [
            way
            for way in self.shapes.values()
            if key in way.get("tags", {}) and (values is None or way["tags"][key] in values)
        ]
