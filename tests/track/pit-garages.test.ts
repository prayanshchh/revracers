import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  type DesertVenue,
  desertParts,
} from "../../apps/client/src/game/desert-layout.ts";
import {
  backGrid,
  boardGrid,
  boardsHeight,
  boardTile,
  seats,
} from "../../apps/client/src/game/garage-tiles.ts";
import {
  type StreetTrack,
  streetParts,
} from "../../apps/client/src/game/street-layout.ts";
import type { GarageCar } from "../../apps/client/src/game/street-pit.ts";
import type { Venue } from "../../apps/client/src/game/street-venue.ts";
import type { Part } from "../../apps/client/src/game/training-layout.ts";
import { teams } from "../../apps/client/src/game/weekend.ts";
import { repoRoot } from "../support/repo.ts";

type Vec = [number, number, number];

interface Quad {
  corners: Vec[];
  atlas: [number, number][];
  kind: number;
  centre: Vec;
}

const boardKind = 1;
const artKind = 1;
const floorKind = 4;
const eye = 1.6;

function read(track: string, name: string): unknown {
  return JSON.parse(
    readFileSync(path.join(repoRoot, "content/tracks", track, name), "utf8"),
  );
}

function quadsOf(
  part: Part,
  atlasSet: number,
  kindOf: (k: number) => number,
): Quad[] {
  const quads: Quad[] = [];
  const atlasUvs = part.uvs[atlasSet] ?? new Float32Array();
  for (let first = 0; first + 3 < part.position.length / 3; first += 4) {
    const corners: Vec[] = [];
    const atlas: [number, number][] = [];
    for (let k = first; k < first + 4; k++) {
      corners.push([
        part.position[3 * k] ?? 0,
        part.position[3 * k + 1] ?? 0,
        part.position[3 * k + 2] ?? 0,
      ]);
      atlas.push([atlasUvs[2 * k] ?? 0, atlasUvs[2 * k + 1] ?? 0]);
    }
    const centre = [0, 1, 2].map(
      (axis) => corners.reduce((sum, c) => sum + (c[axis] ?? 0), 0) / 4,
    ) as Vec;
    quads.push({ corners, atlas, kind: kindOf(first), centre });
  }
  return quads;
}

function partNamed(parts: Part[], name: string): Part {
  const part = parts.find((candidate) => candidate.name === name);
  if (!part) throw new Error(`no ${name} part`);
  return part;
}

function readsLeftToRight(quad: Quad, viewer: Vec): boolean {
  const fx = quad.centre[0] - viewer[0];
  const fz = quad.centre[2] - viewer[2];
  const across = quad.corners.map(([x, , z]) => -fz * x + fx * z);
  const heights = quad.corners.map(([, y]) => y);
  const rightmost = across.indexOf(Math.max(...across));
  const leftmost = across.indexOf(Math.min(...across));
  const top = heights.indexOf(Math.max(...heights));
  const bottom = heights.indexOf(Math.min(...heights));
  const u = (k: number) => quad.atlas[k]?.[0] ?? 0;
  const v = (k: number) => quad.atlas[k]?.[1] ?? 0;
  return u(rightmost) > u(leftmost) && v(top) > v(bottom);
}

function middle(quad: Quad): [number, number] {
  const u = quad.atlas.reduce((sum, [a]) => sum + a, 0) / 4;
  const v = quad.atlas.reduce((sum, [, b]) => sum + b, 0) / 4;
  return [u, v];
}

function boardTeam(quad: Quad): { car: string; seat: number } {
  const [u, v] = middle(quad);
  const column = Math.floor(u * boardGrid[0]);
  const row = Math.floor(((1 - v) * boardsHeight) / boardTile[1]);
  const slot = row * boardGrid[0] + column;
  const team = teams.find((t) => t.index === Math.floor(slot / seats));
  return { car: team?.car ?? "none", seat: slot % seats };
}

function artTeam(quad: Quad): string {
  const [u, v] = middle(quad);
  const index =
    Math.floor((1 - v) * backGrid[1]) * backGrid[0] +
    Math.floor(u * backGrid[0]);
  return teams.find((t) => t.index === index)?.car ?? "none";
}

function nearestIndex(points: Vec[], at: Vec): number {
  let best = 0;
  let gap = Infinity;
  points.forEach((p, k) => {
    const d = Math.hypot(p[0] - at[0], p[2] - at[2]);
    if (d < gap) {
      gap = d;
      best = k;
    }
  });
  return best;
}

interface Pit {
  name: string;
  track: StreetTrack;
  parts: Part[];
  cars: GarageCar[];
}

function pits(): Pit[] {
  const neonTrack = read("neon-boulevard", "track.json") as StreetTrack;
  const city = read("neon-boulevard", "city.json") as {
    venue: Venue;
    bridges: { distance: number }[];
  };
  const neon = streetParts(
    neonTrack,
    null,
    city.bridges.map((b) => b.distance),
    city.venue,
  );
  const duneTrack = read("dune-bay", "track.json") as StreetTrack;
  const dune = desertParts(
    duneTrack,
    null,
    read("dune-bay", "venue.json") as DesertVenue,
  );
  return [
    { name: "neon boulevard", track: neonTrack, ...neon },
    { name: "dune bay", track: duneTrack, ...dune },
  ];
}

describe("street circuit garages", () => {
  test.each(pits())(
    "every team garage at $name carries that team's driver boards and wall art, reading left to right from where it is seen",
    ({ track, parts, cars }) => {
      const centreline = track.centerline.map((p) => [p.x, p.y, p.z] as Vec);
      const step = track.length / centreline.length;
      const sOf = (at: Vec) => nearestIndex(centreline, at) * step;
      const gap = (a: number, b: number) => {
        const d = Math.abs(a - b) % track.length;
        return Math.min(d, track.length - d);
      };
      const carAt = (at: Vec) => {
        const s = sOf(at);
        return cars.reduce((best, car) =>
          gap(car.s, s) < gap(best.s, s) ? car : best,
        );
      };

      const front = partNamed(parts, "garage front");
      const kinds = front.uvs[2] ?? new Float32Array();
      const boards = quadsOf(front, 1, (k) => kinds[2 * k] ?? -1).filter(
        (q) => q.kind === boardKind,
      );
      expect(boards.length).toBe(cars.length);
      const seatsByCar = new Map<string, number[]>();
      for (const board of boards) {
        const lane = centreline[nearestIndex(centreline, board.centre)];
        if (!lane) throw new Error("no centreline");
        expect(readsLeftToRight(board, [lane[0], lane[1] + eye, lane[2]])).toBe(
          true,
        );
        const shown = boardTeam(board);
        expect(shown.car).toBe(carAt(board.centre).team);
        seatsByCar.set(shown.car, [
          ...(seatsByCar.get(shown.car) ?? []),
          shown.seat,
        ]);
      }
      for (const team of teams)
        expect(seatsByCar.get(team.car)?.sort()).toEqual([0, 1]);

      const interior = partNamed(parts, "garage interior");
      const marks = interior.uvs[2] ?? new Float32Array();
      const quads = quadsOf(interior, 0, (k) => marks[2 * k + 1] ?? -1);
      const floors = quads.filter((q) => q.kind === floorKind);
      const walls = quads.filter((q) => q.kind === artKind);
      expect(walls.length).toBe(3 * cars.length);
      for (const wall of walls) {
        const floor =
          floors[
            nearestIndex(
              floors.map((f) => f.centre),
              wall.centre,
            )
          ];
        if (!floor) throw new Error("no garage floor");
        const viewer: Vec = [
          floor.centre[0],
          floor.centre[1] + eye,
          floor.centre[2],
        ];
        expect(readsLeftToRight(wall, viewer)).toBe(true);
        expect(artTeam(wall)).toBe(carAt(floor.centre).team);
      }
    },
  );
});
