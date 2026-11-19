import { readFileSync } from "node:fs";
import path from "node:path";
import type { Accessor, Document } from "@gltf-transform/core";
import { PNG } from "pngjs";
import * as THREE from "three/webgpu";
import { describe, expect, test } from "vitest";
import {
  heightField,
  type PropPlan,
  strippedBaked,
  venueProps,
} from "../../apps/client/src/game/trackside-props.ts";
import {
  stations,
  type TrainingTrack,
} from "../../apps/client/src/game/training-layout.ts";
import {
  type Structure,
  structureParts,
} from "../../apps/client/src/game/venue-gantry.ts";
import {
  type Armco,
  armcoParts,
  type Billboard,
  billboardParts,
  type Hoarding,
  hoardingParts,
} from "../../apps/client/src/game/venue-barriers.ts";
import { realBoards } from "../../apps/client/src/game/trackside-boards.ts";
import { floating, type Shape } from "../support/floating.ts";
import { readModel } from "../support/gltf.ts";
import { repoRoot } from "../support/repo.ts";

interface Point {
  x: number;
  y: number;
  z: number;
  width: number;
  camber: number;
  wallLeft: number;
  wallRight: number;
}

const directory = path.join(repoRoot, "content/tracks/hill-country");
const track = JSON.parse(
  readFileSync(path.join(directory, "track.json"), "utf8"),
) as {
  length: number;
  centerline: Point[];
  surfaces: { kind: string; from: number; to: number; width: number }[];
  pitLane: {
    entry: number;
    exit: number;
    garageStart: number;
    garageEnd: number;
    garageFront: number;
  };
};
function widthAt(share: number): number {
  const points = track.centerline.length;
  const at = share * points;
  const index = Math.floor(at);
  const blend = at - index;
  const here = track.centerline[index]?.width ?? 0;
  const next = track.centerline[(index + 1) % points]?.width ?? 0;
  return here * (1 - blend) + next * blend;
}

const skies = [
  "circuit",
  "dawn",
  "morning",
  "noon",
  "afternoon",
  "dusk",
  "night",
];
const pointerPrefix = "version https://git-lfs";
const isPointer = (file: string) =>
  readFileSync(file).subarray(0, pointerPrefix.length).toString("latin1") ===
  pointerPrefix;
const crowdFile = path.join(directory, "crowd.bin");
const lfsPointer = isPointer(path.join(directory, "road.glb"));
const stride = 8;
const sharpRowsPerMetre = 2.5;
const gpuTextureLimit = 16384;
const maskColumns = 401;
const clearanceHeight = 4;
const balconyLevels = [7.2, 10.7];
const balconyLip = 1.2;
const balconyRecess = 1.6;

function floats(file: string): Float32Array {
  const bytes = readFileSync(file);
  return new Float32Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
}

function nearestRow(x: number, north: number): number {
  let best = 0;
  let bestDistance = Infinity;
  track.centerline.forEach((point, row) => {
    const distance = (point.x - x) ** 2 + (-point.z - north) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = row;
    }
  });
  return best;
}

function roadHeight(x: number, north: number): number {
  return track.centerline[nearestRow(x, north)]?.y ?? 0;
}

function insideBarriers(x: number, north: number): boolean {
  const row = nearestRow(x, north);
  const point = track.centerline[row];
  const next = track.centerline[(row + 1) % track.centerline.length];
  if (!point || !next) return false;
  const tx = next.x - point.x;
  const tn = -next.z + point.z;
  const size = Math.hypot(tx, tn);
  const lateral = ((x - point.x) * -tn + (north + point.z) * tx) / size;
  return lateral > 0 ? lateral < point.wallLeft : -lateral < point.wallRight;
}

function lateralOf(x: number, north: number): { row: number; lateral: number } {
  const row = nearestRow(x, north);
  const point = track.centerline[row];
  const next = track.centerline[(row + 1) % track.centerline.length];
  if (!point || !next) return { row, lateral: 0 };
  const tx = next.x - point.x;
  const tn = -next.z + point.z;
  const size = Math.hypot(tx, tn);
  return {
    row,
    lateral: ((x - point.x) * -tn + (north + point.z) * tx) / size,
  };
}

function onBalcony(x: number, north: number, up: number): boolean {
  const { row, lateral } = lateralOf(x, north);
  const point = track.centerline[row];
  if (!point) return false;
  const pit = track.pitLane;
  const distance = (row / track.centerline.length) * track.length;
  const span = (pit.garageEnd - pit.garageStart + track.length) % track.length;
  const along = (distance - pit.garageStart + track.length) % track.length;
  const floor = up - point.y - point.camber * lateral;
  return (
    along < span + 2 &&
    lateral > pit.garageFront - balconyLip &&
    lateral < pit.garageFront + balconyRecess &&
    balconyLevels.some((level) => Math.abs(floor - level) < 0.2)
  );
}

function standsInside(position: Accessor | null): boolean {
  if (!position) return false;
  const v = [0, 0, 0];
  for (let i = 0; i < position.getCount(); i += 97) {
    position.getElement(i, v);
    const [x = 0, up = 0, z = 0] = v;
    if (up < roadHeight(x, -z) + clearanceHeight && insideBarriers(x, -z))
      return true;
  }
  return false;
}

const spriteCells = 128;
const standingFrom = 64;
const groundMeshes = /^(terrain|verges)$/;

function sceneOf(document: Document): THREE.Group {
  const scene = new THREE.Group();
  const corner = [0, 0, 0];
  for (const node of document.getRoot().listNodes()) {
    const primitive = node.getMesh()?.listPrimitives()[0];
    const position = primitive?.getAttribute("POSITION");
    if (!primitive || !position) continue;
    const values = new Float32Array(position.getCount() * 3);
    for (let i = 0; i < position.getCount(); i++)
      values.set(position.getElement(i, corner), i * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(values, 3));
    geometry.setIndex(Array.from(primitive.getIndices()?.getArray() ?? []));
    geometry.applyMatrix4(new THREE.Matrix4().fromArray(node.getWorldMatrix()));
    const mesh = new THREE.Mesh(geometry);
    mesh.name = THREE.PropertyBinding.sanitizeNodeName(node.getName());
    scene.add(mesh);
  }
  return scene;
}

function shapeOf(mesh: THREE.Mesh): Shape {
  return {
    name: mesh.name,
    position: mesh.geometry.getAttribute("position").array,
    index: mesh.geometry.getIndex()?.array ?? [],
  };
}

describe.skipIf(lfsPointer)("Hill Country surroundings", () => {
  test("spectators stay behind the barriers or on the pit building balconies, sit in the stands and stand on the balconies", () => {
    const values = floats(crowdFile);
    expect(values.length % stride).toBe(0);
    const people = Array.from({ length: values.length / stride }, (_, i) => {
      const [x = 0, north = 0, up = 0, , cell = -1] = values.subarray(
        i * stride,
        (i + 1) * stride,
      );
      return { x, north, up, cell };
    });
    const inside = people.filter((one) => insideBarriers(one.x, one.north));
    const guests = inside.filter((one) => onBalcony(one.x, one.north, one.up));
    expect(inside.length - guests.length).toBe(0);
    expect(guests.length).toBeGreaterThan(1000);
    expect(guests.filter((one) => one.cell < standingFrom)).toEqual([]);
    expect(
      people.filter((one) => one.cell < 0 || one.cell >= spriteCells),
    ).toEqual([]);
    expect(
      people.filter((one) => one.cell < standingFrom).length,
    ).toBeGreaterThan(40000);
  });

  test("no tent, crane, mast or screen stands inside the barriers", async () => {
    const document = await readModel(path.join(directory, "road.glb"));
    const props = document
      .getRoot()
      .listMeshes()
      .filter((mesh) => mesh.getName().startsWith("prop"));
    expect(props.length).toBeGreaterThan(3);
    const offenders = props
      .filter((mesh) =>
        mesh
          .listPrimitives()
          .some((primitive) =>
            standsInside(primitive.getAttribute("POSITION")),
          ),
      )
      .map((mesh) => mesh.getName());
    expect(offenders).toEqual([]);
  });

  test("road-space masks resolve run-off paint finely along the lap and still fit on the GPU", () => {
    for (const name of ["apron_a.png", "apron_b.png", "apron_c.png"]) {
      const image = PNG.sync.read(
        readFileSync(path.join(directory, "textures/baked", name)),
      );
      expect(image.width).toBe(maskColumns);
      expect(image.height / track.length).toBeGreaterThan(sharpRowsPerMetre);
      expect(image.height).toBeLessThanOrEqual(gpuTextureLimit);
    }
  });

  test("painted run-off designs stay off the racing surface", () => {
    const image = PNG.sync.read(
      readFileSync(path.join(directory, "textures/baked/apron_c.png")),
    );
    const reach = 60;
    const step = (2 * reach) / (image.width - 1);
    const painted: number[] = [];
    for (let row = 0; row < image.height; row++) {
      const limit = widthAt(row / image.height) / 2 - 0.5;
      for (let column = 0; column < image.width; column++) {
        if (Math.abs(-reach + column * step) > limit) continue;
        const texel = (row * image.width + column) * 4;
        const first = image.data[texel] ?? 0;
        const second = image.data[texel + 2] ?? 0;
        if (first > 127 || second > 127)
          painted.push(Math.round((row / image.height) * track.length));
      }
    }
    expect(painted).toEqual([]);
  });

  test("kerbs stay out of the pit lane mouth and on the track", () => {
    const kerbs = track.surfaces.filter((span) => span.kind === "kerb");
    expect(kerbs.length).toBeGreaterThan(10);
    const inPit = (s: number) =>
      s > track.pitLane.entry || s < track.pitLane.exit;
    for (const kerb of kerbs) {
      expect(kerb.from).toBeGreaterThanOrEqual(0);
      expect(kerb.to).toBeLessThanOrEqual(track.length);
      expect(kerb.width).toBeGreaterThan(0.5);
      expect(inPit((kerb.from + kerb.to) / 2)).toBe(false);
    }
  });

  test.each(skies)(
    "%s sky has a readable crop, environment and sun",
    (name) => {
      const meta = JSON.parse(
        readFileSync(path.join(directory, "sky", `${name}.json`), "utf8"),
      ) as {
        elevation: number;
        keepTop: number;
        skyRadiance: number[];
        sunColor: number[];
      };
      expect(meta.elevation).toBeGreaterThan(0);
      expect(meta.keepTop).toBeGreaterThan(0.5);
      expect(meta.keepTop).toBeLessThan(0.6);
      expect(meta.skyRadiance).toHaveLength(3);
      expect(Math.max(...meta.sunColor)).toBeCloseTo(1, 5);
      for (const file of [
        `${name}.hdr`,
        `${name}-env.hdr`,
        `${name}-clear.hdr`,
      ]) {
        const header = readFileSync(path.join(directory, "sky", file))
          .subarray(0, 64)
          .toString("latin1");
        expect(header).toMatch(
          /^#\?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y \d+ \+X \d+\n/,
        );
      }
    },
  );

  test("nothing baked into the circuit or added around it is left hanging in the air", async () => {
    const scene = sceneOf(await readModel(path.join(directory, "road.glb")));
    const meshes = scene.children.filter(
      (child): child is THREE.Mesh => child instanceof THREE.Mesh,
    );
    const ground = heightField(
      meshes.filter((mesh) => groundMeshes.test(mesh.name)),
    );
    strippedBaked(scene, ground);
    const dressing = JSON.parse(
      readFileSync(path.join(directory, "dressing.json"), "utf8"),
    ) as PropPlan & {
      gantries: Structure[];
      armco: Armco[];
      hoardings: Hoarding[];
      billboards: Billboard[];
    };
    const list = stations(track as unknown as TrainingTrack, null);
    const added = venueProps(list, track.length, dressing, ground).parts;
    const gantries = structureParts(
      list,
      track.length,
      dressing.gantries,
      ground,
    );
    const shapes = [
      ...scene.children
        .filter(
          (child): child is THREE.Mesh =>
            child instanceof THREE.Mesh && child.name.startsWith("prop_"),
        )
        .map(shapeOf),
      ...added.map(({ part }) => part),
      gantries.steel.part("banner steel", "steel"),
      gantries.faces.part("banner faces", "boards"),
      gantries.dark.part("banner dark", "dark"),
      gantries.concrete.part("banner concrete", "deck"),
      ...Object.values(
        armcoParts(list, track.length, dressing.armco, ground),
      ).map((part) => part.part("armco", "steel")),
      ...Object.values(
        hoardingParts(
          list,
          track.length,
          dressing.hoardings,
          ground,
          realBoards,
        ),
      ).map((part) => part.part("hoardings", "boards")),
      ...Object.values(
        billboardParts(
          list,
          track.length,
          dressing.billboards,
          ground,
          realBoards,
        ),
      ).map((part) => part.part("billboards", "boards")),
    ];
    expect(shapes.length).toBeGreaterThan(10);
    expect(floating(shapes, ground)).toEqual([]);
  });
});
