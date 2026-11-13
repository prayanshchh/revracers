import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as THREE from "three/webgpu";
import { describe, expect, test } from "vitest";
import {
  emptyStand,
  lineStandParts,
  lineStandSeats,
  standSeats,
  type StandSpec,
} from "../../apps/client/src/game/grandstand.ts";
import { gantryParts } from "../../apps/client/src/game/trackside-gantry.ts";
import {
  boardAt,
  boardRow,
  type Dressing,
  wrapV,
} from "../../apps/client/src/game/trackside-plan.ts";
import {
  type BankSpec,
  bankSpots,
  carPark,
  type CraneSpec,
  craneParts,
  inSector,
  inZone,
  type Lot,
  type Marker,
  markerParts,
  type Post,
  postParts,
  type Pylon,
  pylonParts,
  rebranded,
  type Sector,
  type TentRow,
  tentRows,
  without,
  type Zone,
} from "../../apps/client/src/game/trackside-props.ts";
import {
  type Station,
  stations,
  type TrainingTrack,
} from "../../apps/client/src/game/training-layout.ts";
import { repoRoot } from "../support/repo.ts";

interface Venue extends Dressing {
  stands: StandSpec[];
  clear: Zone[];
  cranes: CraneSpec[];
  banks: BankSpec[];
  markers: Marker[];
  lots: Lot[];
  tents: TentRow[];
  posts: Post[];
  pylons: Pylon[];
  fenceless: Sector[];
}

type Triple = [number, number, number];

const pointerPrefix = "version https://git-lfs";
const treeStride = 8;
const clearance = 5;
const canopy = 3;

function read(circuit: string, name: string): unknown {
  return JSON.parse(
    readFileSync(path.join(repoRoot, "content/tracks", circuit, name), "utf8"),
  );
}

function floats(circuit: string, name: string): Float32Array | null {
  const file = path.join(repoRoot, "content/tracks", circuit, name);
  if (!existsSync(file)) return null;
  const bytes = readFileSync(file);
  if (
    bytes.subarray(0, pointerPrefix.length).toString("latin1") === pointerPrefix
  )
    return null;
  return new Float32Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
}

function planOf(known: Partial<Venue> & Dressing): Venue {
  return {
    stands: [],
    clear: [],
    cranes: [],
    banks: [],
    markers: [],
    lots: [],
    tents: [],
    posts: [],
    pylons: [],
    fenceless: [],
    ...known,
  };
}

const circuits = ["hill-country", "neon-boulevard"].map((name) => {
  const track = read(name, "track.json") as TrainingTrack;
  return {
    name,
    track,
    list: stations(track, null),
    plan: planOf(read(name, "dressing.json") as Partial<Venue> & Dressing),
  };
});

function triples(values: ArrayLike<number>): Triple[] {
  return Array.from({ length: Math.floor(values.length / 3) }, (_, i) => [
    Number(values[i * 3]),
    Number(values[i * 3 + 1]),
    Number(values[i * 3 + 2]),
  ]);
}

function seen(list: Station[], x: number, z: number) {
  let best = list[0];
  let reach = Infinity;
  for (const station of list) {
    const distance = (station.x - x) ** 2 + (station.z - z) ** 2;
    if (distance < reach) {
      reach = distance;
      best = station;
    }
  }
  if (!best) throw new Error("no stations");
  const lateral = (x - best.x) * best.lx + (z - best.z) * best.lz;
  const wall = lateral > 0 ? best.wallLeft : best.wallRight;
  return { station: best, lateral, wall };
}

function straight(length: number): Station[] {
  return Array.from({ length }, (_, s) => ({
    s,
    x: s,
    y: 0,
    z: 0,
    lx: 0,
    lz: -1,
    half: 7,
    wallLeft: 12,
    wallRight: 12,
    line: 0,
    rubber: 0,
  }));
}

describe.each(circuits)("trackside dressing at $name", (circuit) => {
  const { list, track, plan } = circuit;

  test("every planned banner names a sponsor row that exists", () => {
    const names = [
      ...plan.boards.flatMap((span) => [span.left, span.right]),
      ...plan.gantries.map((gantry) => gantry.board),
      ...plan.stands.flatMap((stand) => stand.board ?? []),
    ];
    const unknown = names.filter(
      (name) => boardRow(name) === 0 && name !== "northwind",
    );
    expect(unknown).toEqual([]);
  });

  test("the banner plan covers the whole lap in order", () => {
    const starts = plan.boards.map((span) => span.from);
    expect(starts[0]).toBe(0);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(Math.max(...starts)).toBeLessThan(track.length);
  });

  test("nothing of a banner gantry hangs low over the asphalt", () => {
    const built = gantryParts(list, track.length, plan.gantries);
    const low = [built.steel, built.faces, built.deck]
      .flatMap((part) => triples(part.position))
      .filter(([x, y, z]) => {
        const { station, lateral } = seen(list, x, z);
        const over = Math.abs(lateral) < station.half + 0.5;
        return over && y - station.y < clearance;
      });
    expect(built.faces.position.length).toBeGreaterThan(0);
    expect(low).toEqual([]);
  });

  test("every added grandstand seat is behind the wall", () => {
    const seats = triples(standSeats(list, track.length, plan.stands));
    const inside = seats.filter(([x, , z]) => {
      const { lateral, wall } = seen(list, x, z);
      return Math.abs(lateral) < wall + 2;
    });
    expect(inside).toEqual([]);
  });

  test("spectators on the banks and cranes stay off the track side of the wall", () => {
    const flat = () => 0;
    const cranes = craneParts(list, track.length, plan.cranes, flat);
    const low = [
      ...triples(bankSpots(list, track.length, plan.banks, flat)).map(
        ([x, , z]): Triple => [x, 0, z],
      ),
      ...triples(cranes.body.position),
      ...triples(cranes.dark.position),
    ];
    const inside = low.filter(([x, y, z]) => {
      const { lateral, wall } = seen(list, x, z);
      return Math.abs(lateral) < wall && y < 4;
    });
    expect(inside).toEqual([]);
  });

  test("no tree is left growing through an added grandstand", () => {
    const trees = floats(circuit.name, "trees.bin");
    if (!trees || plan.stands.length === 0) return;
    const seats = triples(standSeats(list, track.length, plan.stands));
    const plots = plan.clear.filter((zone) => zone.trees);
    const through: number[] = [];
    for (let i = 0; i < trees.length; i += treeStride) {
      const x = Number(trees[i]);
      const z = -Number(trees[i + 1]);
      if (inZone(plots, list, track.length, x, z)) continue;
      if (seats.some(([sx, , sz]) => Math.hypot(sx - x, sz - z) < canopy))
        through.push(i / treeStride);
    }
    expect(through).toEqual([]);
  });
});

describe.each(circuits)("trackside objects at $name", (circuit) => {
  const { list, track, plan } = circuit;
  const flat = () => 0;

  test("distance boards stand beside the asphalt, never on it or behind the wall", () => {
    const built = markerParts(list, track.length, plan.markers, flat, 0);
    const wrong = triples(built.faces.position).filter(([x, , z]) => {
      const { station, lateral, wall } = seen(list, x, z);
      const beside = Math.abs(lateral) - station.half;
      return beside < 1 || Math.abs(lateral) > wall;
    });
    expect(wrong).toEqual([]);
  });

  test("parked cars and tents are behind the wall", () => {
    const cars = carPark(list, track.length, plan.lots, flat);
    const tents = tentRows(list, track.length, plan.tents, flat);
    const inside = [...cars.paint, cars.glass, tents.cloth, tents.band]
      .flatMap((part) => triples(part.position))
      .filter(([x, , z]) => {
        const { lateral, wall } = seen(list, x, z);
        return Math.abs(lateral) < wall + 1;
      });
    expect(inside).toEqual([]);
  });

  test("no timing pylon stands on the asphalt", () => {
    const built = pylonParts(plan.pylons, flat);
    const on = triples(built.body.position).filter(([x, , z]) => {
      const { station, lateral } = seen(list, x, z);
      return Math.abs(lateral) < station.half + 1.5;
    });
    expect(on).toEqual([]);
  });

  test("marshal posts and their marshals stand behind the wall, clear of the cars", () => {
    const posts = postParts(list, track.length, plan.posts, flat);
    const inside = [
      ...triples(posts.dark.position),
      ...triples(posts.plate.position),
      ...triples(posts.marshals),
    ].filter(([x, , z]) => {
      const { lateral, wall } = seen(list, x, z);
      return Math.abs(lateral) < wall + 0.2;
    });
    expect(inside).toEqual([]);
  });
});

describe("distance boards on a narrow verge", () => {
  test("a board is left out where the wall leaves no room beside the asphalt", () => {
    const tight = straight(200).map((station) => ({
      ...station,
      wallLeft: station.s < 100 ? 12 : 8,
    }));
    const built = markerParts(
      tight,
      200,
      [
        { at: 50, side: 1, metres: 100 },
        { at: 150, side: 1, metres: 50 },
      ],
      () => 0,
      0,
    );
    const along = triples(built.faces.position).map(([x]) => Math.round(x));
    expect(along.length).toBe(4);
    expect(new Set(along)).toEqual(new Set([50]));
  });
});

describe("footprint grandstands", () => {
  test("every seat is behind the front line, within the depth, and above the base", () => {
    const line = {
      from: [10, 5],
      to: [70, 5],
      depth: 20,
      base: 3,
      roof: true,
    };
    const seats = triples(lineStandSeats([line]));
    const outside = seats.filter(
      ([x, y, z]) => x < 10 || x > 70 || z < 5 || z > 25 || y < 3,
    );
    expect(seats.length).toBeGreaterThan(1000);
    expect(outside).toEqual([]);
  });

  test("the banner along the front reads left to right for someone facing the stand", () => {
    const parts = emptyStand();
    lineStandParts(
      [{ from: [10, 5], to: [70, 5], depth: 20, base: 3, roof: false }],
      parts,
    );
    const xs = triples(parts.banner.position).map(([x]) => x);
    const us = (parts.banner.uvs[0] ?? []).filter((_, i) => i % 2 === 0);
    const far = xs.indexOf(Math.max(...xs));
    const near = xs.indexOf(Math.min(...xs));
    expect(Number(us[far])).toBeLessThan(Number(us[near]));
  });
});

describe("fence gaps", () => {
  test("only fence panels inside an open sector are taken away", () => {
    const list = straight(400);
    const sectors = [{ from: 100, to: 200, side: -1 }];
    const panel = (x: number, z: number) => [x, 0, z, x + 2, 0, z, x + 2, 3, z];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [
          ...panel(50, 12),
          ...panel(150, 12),
          ...panel(150, -12),
          ...panel(300, 12),
        ],
        3,
      ),
    );
    geometry.setIndex(Array.from({ length: 12 }, (_, i) => i));
    without(geometry, (x, z) => inSector(sectors, list, 400, x, z));
    const position = geometry.getAttribute("position");
    const index = geometry.getIndex();
    const kept = Array.from({ length: (index?.count ?? 0) / 3 }, (_, k) => [
      position.getX(index?.getX(k * 3) ?? 0),
      position.getZ(index?.getX(k * 3) ?? 0),
    ]);
    const side = seen(list, 150, 12).lateral > 0 ? 12 : -12;
    expect(kept).toEqual([
      [50, 12],
      [150, side],
      [300, 12],
    ]);
  });
});

describe("re-branded wall boards", () => {
  test("each wall quad shows the sponsor planned for its side and distance", () => {
    const list = straight(400);
    const spans = [
      { from: 0, left: "voltara", right: "kestrel" },
      { from: 200, left: "torqua", right: "torqua" },
    ];
    const quad = (x: number, z: number) => [
      [x, 0, z],
      [x + 4, 0, z],
      [x + 4, 1, z],
      [x, 1, z],
    ];
    const corners = [quad(50, -12), quad(50, 12), quad(300, 12)].flat();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(corners.flat(), 3),
    );
    geometry.setAttribute(
      "uv",
      new THREE.Float32BufferAttribute(
        new Array(corners.length * 2).fill(0),
        2,
      ),
    );
    rebranded(geometry, list, spans);
    const uv = geometry.getAttribute("uv");
    const rows = [0, 4, 8].map((first) => [uv.getY(first), uv.getY(first + 2)]);
    const expected = ["voltara", "kestrel", "torqua"].map((name) => [
      Math.fround(wrapV(boardRow(name), 0)),
      Math.fround(wrapV(boardRow(name), 1)),
    ]);
    expect(rows).toEqual(expected);
    expect(boardAt(spans, 250, -1)).toBe(boardRow("torqua"));
  });
});
