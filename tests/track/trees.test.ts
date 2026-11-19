import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  seasonOf,
  type Season,
} from "../../apps/client/src/game/scenery-look.ts";
import {
  beyondWall,
  hillTrack,
  inLandmark,
  inside,
  nearest,
  solidLandmarks,
} from "../support/hill-country.ts";
import { repoRoot } from "../support/repo.ts";

const directory = path.join(repoRoot, "content/tracks/hill-country");
const track = hillTrack;
const map = JSON.parse(
  readFileSync(path.join(directory, "circuit-map.json"), "utf8"),
) as { buildings: { footprint: number[] }[] };
const table = JSON.parse(
  readFileSync(path.join(repoRoot, "content/scenery/trees/trees.json"), "utf8"),
) as { species: Record<string, { spread: number }> };
interface ClearZone {
  from?: number;
  to?: number;
  side?: "left" | "right" | "both";
  far?: number;
  osm?: number;
  buffer?: number;
}

const config = JSON.parse(
  readFileSync(path.join(directory, "source/scenery.json"), "utf8"),
) as {
  trees: {
    shadowReach: number;
    clearance: { crownShare: number };
    clear: ClearZone[];
  };
};
const osm = JSON.parse(
  readFileSync(path.join(directory, "source/osm.json"), "utf8"),
) as {
  elements: {
    type: string;
    id: number;
    lat?: number;
    lon?: number;
    nodes?: number[];
  }[];
};
const earth = 6378137;
const timingNode = 13826373967;
const stride = 8;
const speciesCount = Object.keys(table.species).length;

function trees(): Float32Array {
  const bytes = readFileSync(path.join(directory, "trees.bin"));
  return new Float32Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
}

function footprint(way: number): number[] {
  const nodes = new Map(
    osm.elements
      .filter((e) => e.type === "node")
      .map((e) => [e.id, [e.lat ?? 0, e.lon ?? 0]] as const),
  );
  const [lat0 = 0, lon0 = 0] = nodes.get(timingNode) ?? [];
  const ids = osm.elements.find((e) => e.type === "way" && e.id === way)?.nodes;
  return (ids ?? []).flatMap((id) => {
    const [lat = 0, lon = 0] = nodes.get(id) ?? [];
    const east =
      (((lon - lon0) * Math.PI) / 180) *
      Math.cos((lat0 * Math.PI) / 180) *
      earth;
    const north = (((lat - lat0) * Math.PI) / 180) * earth;
    return [east, -north];
  });
}

function edgeGap(ring: number[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const [ax = 0, az = 0] = ring.slice(i, i + 2);
    const [bx = 0, bz = 0] = ring.slice(j, j + 2);
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(
      0,
      Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)),
    );
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return best;
}

function lateralOf(x: number, north: number): { s: number; lateral: number } {
  const { row } = nearest(x, north);
  const point = track.centerline[row];
  const next = track.centerline[(row + 1) % track.centerline.length];
  if (!point || !next) return { s: 0, lateral: 0 };
  const tx = next.x - point.x;
  const tn = -next.z + point.z;
  const lateral =
    ((x - point.x) * -tn + (north + point.z) * tx) / Math.hypot(tx, tn);
  return { s: (row * track.length) / track.centerline.length, lateral };
}

function inFootprint(way: number, buffer: number, x: number, north: number) {
  const ring = footprint(way);
  return inside(ring, x, -north) || edgeGap(ring, x, -north) < buffer;
}

function inZone(zone: ClearZone, x: number, north: number): boolean {
  if (zone.osm !== undefined)
    return inFootprint(zone.osm, zone.buffer ?? 0, x, north);
  return inStretch(zone, x, north);
}

function inStretch(zone: ClearZone, x: number, north: number): boolean {
  const { s, lateral } = lateralOf(x, north);
  const from = zone.from ?? 0;
  const span = ((zone.to ?? 0) - from + track.length) % track.length;
  const along = (s - from + track.length) % track.length <= span;
  const side =
    zone.side === "both" || (zone.side === "left" ? lateral > 0 : lateral < 0);
  return along && side && beyondWall(x, north) < (zone.far ?? 0);
}

describe("Hill Country trees", () => {
  const values = trees();

  test("no tree grows in the grandstand, theme park or clubhouse plots kept clear for other builders", () => {
    expect(config.trees.clear.length).toBeGreaterThan(0);
    for (const zone of config.trees.clear)
      if (zone.osm !== undefined)
        expect(footprint(zone.osm).length).toBeGreaterThan(5);
    const offenders: number[] = [];
    for (let i = 0; i < values.length; i += stride) {
      const [x = 0, north = 0] = values.subarray(i, i + 2);
      if (nearest(x, north).gap > 900) continue;
      if (config.trees.clear.some((zone) => inZone(zone, x, north)))
        offenders.push(i / stride);
    }
    expect(offenders).toEqual([]);
  });

  test("no tree grows inside a landmark building, marquee or ride", () => {
    expect(solidLandmarks.length).toBeGreaterThan(20);
    const offenders: string[] = [];
    for (let i = 0; i < values.length; i += stride) {
      const [x = 0, north = 0] = values.subarray(i, i + 2);
      const hit = inLandmark(x, -north);
      if (hit) offenders.push(hit);
    }
    expect(offenders).toEqual([]);
  });

  test("the track runs through open prairie: hardly any tree stands within 40 m of the barriers", () => {
    let close = 0;
    for (let i = 0; i < values.length; i += stride) {
      const [x = 0, north = 0] = values.subarray(i, i + 2);
      if (beyondWall(x, north) < 40) close++;
    }
    expect(close / (values.length / stride)).toBeLessThan(0.01);
  });

  test("every tree stands clear of the barriers by its crown, and off the pit lane", () => {
    expect(values.length % stride).toBe(0);
    expect(values.length / stride).toBeGreaterThan(5000);
    const offenders: number[] = [];
    for (let i = 0; i < values.length; i += stride) {
      const [x = 0, north = 0, , height = 0] = values.subarray(i, i + 4);
      const crown = height * config.trees.clearance.crownShare;
      const pitGap = Math.min(
        ...track.pitLane.centerline.map((p) =>
          Math.hypot(p.x - x, -p.z - north),
        ),
      );
      if (beyondWall(x, north) < crown + 3 || pitGap < 40)
        offenders.push(i / stride);
    }
    expect(offenders).toEqual([]);
  });

  test("no tree grows through a building or grandstand", () => {
    const offenders: number[] = [];
    for (let i = 0; i < values.length; i += stride) {
      const [x = 0, north = 0] = values.subarray(i, i + 2);
      if (nearest(x, north).gap > 900) continue;
      if (map.buildings.some((b) => inside(b.footprint, x, -north)))
        offenders.push(i / stride);
    }
    expect(offenders).toEqual([]);
  });

  test("trees use real species, sane heights, and only trackside ones cast shadows", () => {
    for (let i = 0; i < values.length; i += stride) {
      const [x = 0, north = 0, , height = 0, kind = -1, , casts = 0] =
        values.subarray(i, i + 7);
      expect(Number.isInteger(kind) && kind >= 0 && kind < speciesCount).toBe(
        true,
      );
      expect(height).toBeGreaterThan(1.5);
      expect(height).toBeLessThan(22);
      if (casts > 0.5)
        expect(nearest(x, north).gap).toBeLessThan(config.trees.shadowReach);
    }
  });
});

describe("season choice", () => {
  const venue: Season = "autumn";

  test("a chosen season wins, the circuit's own season is used otherwise", () => {
    expect(seasonOf("winter", venue, 6)).toBe("winter");
    expect(seasonOf("from track", venue, 6)).toBe("autumn");
  });

  test("'now' follows the calendar, flipped south of the equator", () => {
    expect(seasonOf("now", venue, 0)).toBe("winter");
    expect(seasonOf("now", venue, 6)).toBe("summer");
    expect(seasonOf("now", venue, 9)).toBe("autumn");
    expect(seasonOf("now", venue, 0, true)).toBe("summer");
    expect(seasonOf("now", venue, 9, true)).toBe("spring");
  });
});
