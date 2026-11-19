import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as THREE from "three/webgpu";
import { beforeAll, describe, expect, test } from "vitest";
import {
  emptyStand,
  lineStandParts,
  lineStandSeats,
  type StandLine,
  standParts,
  type StandSpec,
  standSeats,
} from "../../apps/client/src/game/grandstand.ts";
import {
  heightField,
  type Height,
  inZone,
  type PropPlan,
  venueProps,
  type Zone,
} from "../../apps/client/src/game/trackside-props.ts";
import {
  stations,
  type Station,
  type TrainingTrack,
} from "../../apps/client/src/game/training-layout.ts";
import {
  type BankSpec,
  bankSpots,
  type FootprintStand,
  footprints,
  insidePolygon,
  standDecks,
  standLine,
  standOutline,
  standPieces,
  type Landmark,
  bowlSeats,
  trackAim,
  solidOutlines,
} from "../../apps/client/src/game/venue-crowd.ts";
import { floating } from "../support/floating.ts";
import { readModel } from "../support/gltf.ts";
import { repoRoot } from "../support/repo.ts";

const directory = path.join(repoRoot, "content/tracks/hill-country");
const read = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(directory, name), "utf8"));
const track = read("track.json") as TrainingTrack;
const dressing = read("dressing.json") as PropPlan & {
  stands: StandSpec[];
  banks: BankSpec[];
  clear: Zone[];
};
const structures = read("structures.json") as {
  stands: FootprintStand[];
};
const landmarks = existsSync(path.join(directory, "landmarks.json"))
  ? (read("landmarks.json") as Landmark[])
  : [];
const buildings = solidOutlines(landmarks);
const bowl = landmarks.filter(
  (landmark) => landmark.name === "amphitheatre seats",
);
const osm = read("source/osm.json") as {
  elements: {
    type: string;
    id: number;
    lat?: number;
    lon?: number;
    nodes?: number[];
    tags?: Record<string, string>;
  }[];
};
const timingNode = 13826373967;
const earth = 6378137;
const pointerPrefix = "version https://git-lfs";
const lfsPointer = readFileSync(path.join(directory, "road.glb"))
  .subarray(0, pointerPrefix.length)
  .toString("latin1")
  .startsWith(pointerPrefix);
const groundMeshes = /^(terrain|verges)$/;
const nudges = [
  [0, 0],
  [0.5, 0],
  [-0.5, 0],
  [0, 0.5],
  [0, -0.5],
];
const standDepth = 1.4 + 0.8;
const standBack = 3.4;
const standGap = 3.4;

function theme(): number[][] {
  const nodes = new Map<number, [number, number]>();
  for (const element of osm.elements)
    if (element.type === "node")
      nodes.set(element.id, [Number(element.lat), Number(element.lon)]);
  const [lat0 = 0, lon0 = 0] = nodes.get(timingNode) ?? [];
  const park = osm.elements.find(
    (element) => element.tags?.["tourism"] === "theme_park",
  );
  return (park?.nodes ?? []).map((id) => {
    const [lat = 0, lon = 0] = nodes.get(id) ?? [];
    const east =
      ((lon - lon0) * Math.PI * Math.cos((lat0 * Math.PI) / 180) * earth) / 180;
    const north = ((lat - lat0) * Math.PI * earth) / 180;
    return [east, -north];
  });
}

function sceneGround(scene: THREE.Group): Height {
  return heightField(
    scene.children.filter(
      (child): child is THREE.Mesh =>
        child instanceof THREE.Mesh && groundMeshes.test(child.name),
    ),
  );
}

function specOutline(list: Station[], spec: StandSpec): number[][] {
  const near: number[][] = [];
  const far: number[][] = [];
  const span = (spec.to - spec.from + track.length) % track.length;
  for (let k = 0; k <= Math.ceil(span / 2); k++) {
    const s = (spec.from + Math.min(span, k * 2)) % track.length;
    const station =
      list[Math.round((s / track.length) * list.length) % list.length];
    if (!station) continue;
    const wall = spec.side > 0 ? station.wallLeft : station.wallRight;
    const front = wall + (spec.gap ?? standGap);
    const back = front + standDepth + spec.rows * 0.8 + standBack;
    for (const [lateral, into] of [
      [front, near],
      [back, far],
    ] as const)
      into.push([
        station.x + station.lx * spec.side * lateral,
        station.z + station.lz * spec.side * lateral,
      ]);
  }
  return [...near, ...far.reverse()];
}

describe.skipIf(lfsPointer)("Hill Country crowd and grandstands", () => {
  const list = stations(track, null);
  let ground: Height = () => null;
  let lines: StandLine[] = [];
  let fans: number[] = [];
  let pieces: ReturnType<typeof standPieces> = [];

  beforeAll(async () => {
    const document = await readModel(path.join(directory, "road.glb"));
    const scene = new THREE.Group();
    const corner = [0, 0, 0];
    for (const node of document.getRoot().listNodes()) {
      if (!groundMeshes.test(node.getName())) continue;
      const primitive = node.getMesh()?.listPrimitives()[0];
      const position = primitive?.getAttribute("POSITION");
      if (!primitive || !position) continue;
      const values = new Float32Array(position.getCount() * 3);
      for (let i = 0; i < position.getCount(); i++)
        values.set(position.getElement(i, corner), i * 3);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(values, 3));
      geometry.applyMatrix4(
        new THREE.Matrix4().fromArray(node.getWorldMatrix()),
      );
      const mesh = new THREE.Mesh(geometry);
      mesh.name = node.getName();
      scene.add(mesh);
    }
    ground = sceneGround(scene);
    const cleared = (x: number, z: number) =>
      inZone(dressing.clear, list, track.length, x, z);
    lines = structures.stands.flatMap(
      (stand) => standLine(stand, cleared, () => "revracers") ?? [],
    );
    const parts = emptyStand();
    const onGround = (station: Station, lateral: number) => {
      const x = station.x + station.lx * lateral;
      const z = station.z + station.lz * lateral;
      return ground(x, z) ?? station.y;
    };
    standParts(list, track.length, dressing.stands, parts, onGround);
    lineStandParts(lines, parts);
    pieces = standPieces(parts);
    const props = venueProps(list, track.length, dressing, ground).parts;
    const blocked = footprints(
      [...pieces.map(({ part }) => part), ...props.map(({ part }) => part)],
      ground,
      buildings,
      standDecks(pieces),
    );
    fans = bankSpots(list, track.length, dressing.banks, ground, blocked);
  }, 120000);

  test("the general admission banks are packed like race day", () => {
    expect(fans.length / 3).toBeGreaterThan(40000);
  });

  test("no fan on a bank stands inside a grandstand or a building", () => {
    const outlines = [
      ...lines.map(standOutline),
      ...dressing.stands.map((spec) => specOutline(list, spec)),
      ...buildings,
    ];
    const inside: number[][] = [];
    for (let i = 0; i < fans.length; i += 3) {
      const x = Number(fans[i]);
      const z = Number(fans[i + 2]);
      if (outlines.some((outline) => insidePolygon(outline, x, z)))
        inside.push([Math.round(x), Math.round(z)]);
    }
    expect(inside.slice(0, 10)).toEqual([]);
  });

  test("amphitheatre spectators sit on the bowl's seat rows, at their heights", () => {
    const seats = bowlSeats(bowl);
    if (bowl.length === 0) return;
    const rows = bowl.flatMap((sector) => sector.rows ?? []);
    const low = Math.min(...rows.map((row) => row.height));
    const high = Math.max(...rows.map((row) => row.height));
    const off: number[][] = [];
    for (let i = 0; i < seats.length; i += 3) {
      const x = Number(seats[i]);
      const y = Number(seats[i + 1]);
      const z = Number(seats[i + 2]);
      const on = bowl.some((sector) =>
        nudges.some(([dx = 0, dz = 0]) =>
          insidePolygon(sector.outline, x + dx, z + dz),
        ),
      );
      if (!on || y < low || y > high) off.push([Math.round(x), Math.round(z)]);
    }
    expect(seats.length / 3).toBeGreaterThan(1000);
    expect(off.slice(0, 10)).toEqual([]);
  });

  test("fans on the banks face the track and amphitheatre fans face the stage", () => {
    const stages = landmarks
      .filter((landmark) => landmark.name === "amphitheatre bowl")
      .map((item) => ({
        focus: bowl[0]?.focus ?? [0, 0],
        outline: item.outline,
      }));
    const aim = trackAim(list, stages);
    const away: number[][] = [];
    const check = (x: number, z: number, tx: number, tz: number) => {
      const [fx = 0, fz = 0] = aim(x, z) ?? [];
      const length = Math.hypot(tx - x, tz - z) || 1;
      if ((fx * (tx - x) + fz * (tz - z)) / length < 0.5)
        away.push([Math.round(x), Math.round(z)]);
    };
    for (let i = 0; i < fans.length; i += 300) {
      const x = Number(fans[i]);
      const z = Number(fans[i + 2]);
      const near = list.reduce((best, station) =>
        (station.x - x) ** 2 + (station.z - z) ** 2 <
        (best.x - x) ** 2 + (best.z - z) ** 2
          ? station
          : best,
      );
      check(x, z, near.x, near.z);
    }
    const seats = bowlSeats(bowl);
    const [cx = 0, cz = 0] = bowl[0]?.focus ?? [];
    for (let i = 0; i < seats.length; i += 30)
      check(Number(seats[i]), Number(seats[i + 2]), cx, cz);
    expect(away.slice(0, 10)).toEqual([]);
  });

  test("no grandstand seat is inside a building", () => {
    const seats = [
      ...lineStandSeats(lines),
      ...standSeats(list, track.length, dressing.stands),
    ];
    const inside: number[][] = [];
    for (let i = 0; i < seats.length; i += 3) {
      const x = Number(seats[i]);
      const z = Number(seats[i + 2]);
      if (buildings.some((outline) => insidePolygon(outline, x, z)))
        inside.push([Math.round(x), Math.round(z)]);
    }
    expect(inside.slice(0, 10)).toEqual([]);
  });

  test("no grandstand, seat or fan is left where the theme park was built", () => {
    const park = theme();
    expect(park.length).toBeGreaterThan(3);
    const seats = [
      ...lineStandSeats(lines),
      ...standSeats(list, track.length, dressing.stands),
      ...fans,
    ];
    const inPark: number[][] = [];
    for (let i = 0; i < seats.length; i += 3) {
      const x = Number(seats[i]);
      const z = Number(seats[i + 2]);
      if (insidePolygon(park, x, z))
        inPark.push([Math.round(x), Math.round(z)]);
    }
    expect(inPark.slice(0, 10)).toEqual([]);
  });

  test("every grandstand, roof, sign and stair rests on the ground", () => {
    const shapes = pieces.map(({ part }) => part);
    expect(shapes.length).toBeGreaterThan(5);
    expect(floating(shapes, ground)).toEqual([]);
  });
});
