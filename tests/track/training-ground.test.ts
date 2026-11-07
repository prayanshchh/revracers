import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
  type LinePath,
  type Part,
  type TrainingTrack,
  trainingParts,
  stations,
} from "../../apps/client/src/game/training-layout.ts";
import { repoRoot, run } from "../support/repo.ts";
import {
  type SpeedDreams,
  startCircuit,
  wasm,
} from "../support/speed-dreams.ts";

interface Turn {
  number: number;
  distance: number;
  side: string;
}

interface Frame {
  origin: number[];
  heading: number;
}

const directory = path.join(repoRoot, "content/tracks/training-ground");
const read = (file: string): unknown =>
  JSON.parse(readFileSync(path.join(directory, file), "utf8"));
const track = read("track.json") as TrainingTrack;
const line = read("racing-line.json") as LinePath;
const { turns } = read("circuit-map.json") as { turns: Turn[] };
const points = track.centerline;
const n = points.length;
const spacing = track.length / n;
const at = (i: number) => {
  const point = points[((i % n) + n) % n];
  if (!point) throw new Error(`no point ${String(i)}`);
  return point;
};
const half = track.width / 2;

function radiusAt(i: number, reach: number): number {
  const a = at(i - reach);
  const b = at(i);
  const c = at(i + reach);
  const ab = Math.hypot(b.x - a.x, b.z - a.z);
  const bc = Math.hypot(c.x - b.x, c.z - b.z);
  const ca = Math.hypot(a.x - c.x, a.z - c.z);
  const area =
    Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2;
  return area < 1e-9 ? Infinity : (ab * bc * ca) / (4 * area);
}

function turnsLeft(i: number): boolean {
  const a = at(i - 5);
  const b = at(i);
  const c = at(i + 5);
  return (b.x - a.x) * -(c.z - b.z) - -(b.z - a.z) * (c.x - b.x) > 0;
}

function onSpan(distance: number, from: number, to: number): boolean {
  return from <= to
    ? distance >= from && distance <= to
    : distance >= from || distance <= to;
}

describe("Training Ground layout", () => {
  test("the centreline is one smooth closed loop with no corner tighter than the physics allows", () => {
    const first = at(0);
    const last = at(n - 1);
    const gap = Math.hypot(first.x - last.x, first.z - last.z);
    expect(gap).toBeGreaterThan(spacing * 0.9);
    expect(gap).toBeLessThan(spacing * 1.1);
    let sharpest = 0;
    let tightest = Infinity;
    for (let i = 0; i < n; i++) {
      const a = at(i - 1);
      const b = at(i);
      const c = at(i + 1);
      const h1 = Math.atan2(b.z - a.z, b.x - a.x);
      const h2 = Math.atan2(c.z - b.z, c.x - b.x);
      const turn = Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1)));
      sharpest = Math.max(sharpest, (turn * 180) / Math.PI);
      tightest = Math.min(tightest, radiusAt(i, 3));
    }
    expect(sharpest).toBeLessThan(8);
    expect(tightest).toBeGreaterThan(15);
  });

  test("no part of the lap comes close enough to another for their walls to meet", () => {
    let worst = Infinity;
    for (let i = 0; i < n; i += 2)
      for (let j = i + 2; j < n; j += 2) {
        const apart = Math.min(j - i, n - (j - i)) * spacing;
        if (apart < 300) continue;
        const a = at(i);
        const b = at(j);
        const reach =
          Math.max(a.wallLeft, a.wallRight) + Math.max(b.wallLeft, b.wallRight);
        worst = Math.min(worst, Math.hypot(a.x - b.x, a.z - b.z) - reach);
      }
    expect(worst).toBeGreaterThan(5);
  });

  test("inside walls stay closer than the corner's own radius, so the wall never folds over itself", () => {
    for (let i = 0; i < n; i++) {
      const point = at(i);
      const inside = turnsLeft(i) ? point.wallLeft : point.wallRight;
      expect(inside).toBeGreaterThan(half + track.runoff);
      expect(inside).toBeLessThan(radiusAt(i, 5) * 0.95);
    }
  });

  test("every numbered turn has a kerb on its inside at the apex", () => {
    expect(turns.length).toBeGreaterThanOrEqual(6);
    for (const turn of turns)
      expect(
        track.surfaces.some(
          (kerb) =>
            kerb.kind === "kerb" &&
            kerb.side === turn.side &&
            onSpan(turn.distance, kerb.from, kerb.to),
        ),
        `turn ${String(turn.number)}`,
      ).toBe(true);
  });

  test("the grid is just behind the line with a long run to a heavy Turn 1, and a long straight follows the hairpin for the boost lesson", () => {
    const [slot] = track.grid;
    expect(slot?.distance).toBeGreaterThan(track.length - 20);
    const turnAt = (number: number) =>
      turns.find((turn) => turn.number === number)?.distance ?? 0;
    expect(turnAt(1)).toBeGreaterThan(400);
    expect(radiusAt(Math.round(turnAt(1) / spacing), 3)).toBeLessThan(40);
    const boost = turnAt(4) + 150;
    const nextCorner = turns
      .map((turn) => turn.distance)
      .filter((distance) => distance > boost)
      .sort((a, b) => a - b)[0];
    expect((nextCorner ?? 0) - boost).toBeGreaterThan(700);
  });
});

describe("Training Ground generated files", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "training-ground-"));
  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  test("training-ground.xml and sd-frame.json are generated from the current track.json", () => {
    copyFileSync(
      path.join(directory, "track.json"),
      path.join(scratch, "track.json"),
    );
    const result = run("node", ["tools/sd-track.mjs", scratch]);
    expect(result.code, result.output).toBe(0);
    for (const file of ["training-ground.xml", "sd-frame.json"])
      expect(readFileSync(path.join(scratch, file), "utf8")).toBe(
        readFileSync(path.join(directory, file), "utf8"),
      );
  });
});

function corner(values: Float32Array, vertex: number): number[] {
  return [0, 1, 2].map((k) => Number(values[vertex * 3 + k]));
}

function faces(part: Part, a: number, b: number, c: number): boolean {
  const pa = corner(part.position, a);
  const e1 = corner(part.position, b).map((v, k) => v - Number(pa[k]));
  const e2 = corner(part.position, c).map((v, k) => v - Number(pa[k]));
  const face = [
    Number(e1[1]) * Number(e2[2]) - Number(e1[2]) * Number(e2[1]),
    Number(e1[2]) * Number(e2[0]) - Number(e1[0]) * Number(e2[2]),
    Number(e1[0]) * Number(e2[1]) - Number(e1[1]) * Number(e2[0]),
  ];
  if (Math.hypot(...face) < 1e-9) return true;
  const shade = [a, b, c]
    .map((v) => corner(part.normal, v))
    .reduce(
      (sum, n) =>
        sum + n.reduce((dot, value, k) => dot + value * Number(face[k]), 0),
      0,
    );
  return shade > 0;
}

function backFacing(part: Part): number {
  let wrong = 0;
  for (let t = 0; t < part.index.length; t += 3)
    if (
      !faces(
        part,
        Number(part.index[t]),
        Number(part.index[t + 1]),
        Number(part.index[t + 2]),
      )
    )
      wrong++;
  return wrong;
}

describe("Training Ground meshes", () => {
  const parts = trainingParts(track, line);

  test("every triangle faces the way its normals point, so no surface shows its dark back side", () => {
    for (const part of parts) expect(backFacing(part), part.name).toBe(0);
  });

  test("both walls run unbroken round the lap, so no gap shows where the physics wall is solid", () => {
    const list = stations(track, line);
    const walls = parts.filter((part) => part.name.startsWith("wall"));
    const along = (part: Part, v: number) => part.uvs[0]?.[v * 2] ?? 0;
    const end = Math.max(
      ...walls.flatMap((part) =>
        Array.from({ length: part.position.length / 3 }, (_, v) =>
          along(part, v),
        ),
      ),
    );
    const stationAt = (u: number) => {
      const s = (u / end) * track.length;
      let best = list[0];
      for (const station of list)
        if (Math.abs(station.s - s) < Math.abs((best?.s ?? 0) - s))
          best = station;
      if (!best) throw new Error("no stations");
      return best;
    };
    const covered = new Map<number, [number, number][]>([
      [1, []],
      [-1, []],
    ]);
    for (const part of walls)
      for (let t = 0; t < part.index.length; t += 3) {
        const corners = [0, 1, 2].map((k) => Number(part.index[t + k]));
        if (corners.some((v) => (part.normal[v * 3 + 1] ?? 0) < 0.99)) continue;
        const us = corners.map((v) => along(part, v));
        const middle = (Math.min(...us) + Math.max(...us)) / 2;
        const station = stationAt(middle);
        const x =
          corners.reduce((sum, v) => sum + (part.position[v * 3] ?? 0), 0) / 3;
        const z =
          corners.reduce((sum, v) => sum + (part.position[v * 3 + 2] ?? 0), 0) /
          3;
        const side = Math.sign(
          (x - station.x) * station.lx + (z - station.z) * station.lz,
        );
        covered.get(side)?.push([Math.min(...us), Math.max(...us)]);
      }
    for (const [side, spans] of covered) {
      spans.sort((a, b) => a[0] - b[0]);
      let reach = 0;
      for (const [from, to] of spans) {
        expect(
          from,
          `gap on side ${String(side)} at u ${from.toFixed(2)}`,
        ).toBeLessThanOrEqual(reach + 1e-4);
        reach = Math.max(reach, to);
      }
      expect(reach).toBeCloseTo(end, 4);
    }
  });

  test("the road spans the asphalt physics drives on and its edge lines sit on the road edge", () => {
    const road = parts.find((part) => part.name === "road");
    const lines = parts.find((part) => part.name === "edge lines");
    if (!road || !lines) throw new Error("missing road meshes");
    const list = stations(track, line);
    const lateral = (part: typeof road, v: number) => {
      const x = part.position[v * 3] ?? 0;
      const z = part.position[v * 3 + 2] ?? 0;
      let best = Infinity;
      let side = 0;
      for (const s of list) {
        const d = Math.hypot(x - s.x, z - s.z);
        if (d < best) {
          best = d;
          side = (x - s.x) * s.lx + (z - s.z) * s.lz;
        }
      }
      return side;
    };
    const sample = (part: typeof road) =>
      Array.from({ length: 40 }, (_, k) =>
        Math.abs(
          lateral(part, Math.floor((k / 40) * (part.position.length / 3))),
        ),
      );
    expect(Math.max(...sample(road))).toBeCloseTo(half + track.runoff, 1);
    for (const offset of sample(lines)) {
      expect(offset).toBeGreaterThan(half - 0.3);
      expect(offset).toBeLessThan(half + 0.05);
    }
  });
});

interface Lookup extends SpeedDreams {
  _sdTrackLength: () => number;
  _free: (pointer: number) => void;
}

interface Drift {
  across: number;
  along: number;
  length: number;
}

function sdLookup(m: Lookup) {
  const out = m._malloc(12);
  return {
    point(distance: number, lateral: number): number[] {
      m._sdTrackLocal2Global(distance, lateral, out);
      return Array.from(new Float32Array(m.HEAPF32.buffer, out, 3));
    },
    done(): void {
      m._free(out);
    },
  };
}

function visualToSd(frame: Frame, start: number[]) {
  const [sx = 0, sy = 0] = start;
  const [ox = 0, , oz = 0] = frame.origin;
  const cos = Math.cos(frame.heading);
  const sin = Math.sin(frame.heading);
  return (x: number, z: number) => {
    const qx = x - ox;
    const qy = -z + oz;
    return [sx + qx * cos + qy * sin, sy - qx * sin + qy * cos];
  };
}

function offsetFrom(
  sd: ReturnType<typeof sdLookup>,
  distance: number,
  lateral: number,
  seen: number[],
): number[] {
  const [ax = 0, ay = 0] = sd.point(distance, 0);
  const [bx = 0, by = 0] = sd.point(distance + 1, 0);
  const norm = Math.hypot(bx - ax, by - ay);
  const [tx, ty] = [(bx - ax) / norm, (by - ay) / norm];
  const [px = 0, py = 0] = sd.point(distance, lateral);
  const [vx = 0, vy = 0] = seen;
  return [
    Math.abs((vx - px) * ty - (vy - py) * tx),
    Math.abs((vx - px) * tx + (vy - py) * ty),
  ];
}

async function drift(): Promise<Drift> {
  const m = await startCircuit<Lookup>(undefined, "training-ground");
  const sd = sdLookup(m);
  const toSd = visualToSd(read("sd-frame.json") as Frame, sd.point(0, 0));
  const scale = m._sdTrackLength() / track.length;
  const worst = { across: 0, along: 0, length: m._sdTrackLength() };
  const sampled = stations(track, line).filter(
    (station) => Math.round(station.s) % 25 === 0,
  );
  for (const station of sampled)
    for (const lateral of [0, half, -half]) {
      const seen = toSd(
        station.x + station.lx * lateral,
        station.z + station.lz * lateral,
      );
      const [across, along] = offsetFrom(sd, station.s * scale, lateral, seen);
      worst.across = Math.max(worst.across, Number(across));
      worst.along = Math.max(worst.along, Number(along));
    }
  sd.done();
  return worst;
}

describe.runIf(existsSync(wasm))("Training Ground physics", () => {
  test("the road you see is where Speed Dreams drives, all the way round the lap", async () => {
    const { across, along, length } = await drift();
    expect(across).toBeLessThan(0.3);
    expect(along).toBeLessThan(2);
    expect(Math.abs(length - track.length)).toBeLessThan(1);
  });
});
