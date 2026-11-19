import { readFileSync } from "node:fs";
import path from "node:path";
import type { Document, Primitive } from "@gltf-transform/core";
import * as THREE from "three/webgpu";
import { beforeAll, describe, expect, test } from "vitest";
import {
  type Footprint,
  inFootprint,
} from "../../apps/client/src/game/landmark-footprints.ts";
import {
  type Height,
  heightField,
} from "../../apps/client/src/game/trackside-props.ts";
import { floating, type Shape } from "../support/floating.ts";
import { readModel } from "../support/gltf.ts";
import { repoRoot } from "../support/repo.ts";

interface Row {
  x: number;
  y: number;
  z: number;
  camber: number;
  wallLeft: number;
  wallRight: number;
}

const directory = path.join(repoRoot, "content/tracks/hill-country");
const rows = (
  JSON.parse(readFileSync(path.join(directory, "track.json"), "utf8")) as {
    centerline: Row[];
  }
).centerline;
const lfs = "version https://git-lfs";
const stored = (name: string) =>
  readFileSync(path.join(directory, name))
    .subarray(0, lfs.length)
    .toString() !== lfs;
const recordStride = 8;
const carClearance = 4.0;
const pitBuilding = /^paddock_(canopy|facade|panels)$/;
const groundNames = /^(terrain|verges)$/;
const nearParts = /^landmark_/;

function primitiveShape(
  name: string,
  primitive: Primitive,
  matrix: THREE.Matrix4,
): Shape | null {
  const source = primitive.getAttribute("POSITION")?.getArray();
  const index = primitive.getIndices()?.getArray();
  if (!source || !index) return null;
  const position = new THREE.BufferAttribute(Float32Array.from(source), 3);
  position.applyMatrix4(matrix);
  return { name, position: position.array, index };
}

function shapesOf(document: Document, names: RegExp): Shape[] {
  return document
    .getRoot()
    .listNodes()
    .flatMap((node) => {
      const name = THREE.PropertyBinding.sanitizeNodeName(node.getName());
      if (!names.test(name)) return [];
      const matrix = new THREE.Matrix4().fromArray(node.getWorldMatrix());
      return (node.getMesh()?.listPrimitives() ?? []).flatMap(
        (primitive) => primitiveShape(name, primitive, matrix) ?? [],
      );
    });
}

function groundOf(shapes: Shape[]): Height {
  return heightField(
    shapes
      .filter((shape) => groundNames.test(shape.name))
      .map((shape) => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.BufferAttribute(Float32Array.from(shape.position), 3),
        );
        return new THREE.Mesh(geometry);
      }),
  );
}

function trackSide(x: number, z: number): { lateral: number; row: Row } {
  let best = 0;
  let gap = Infinity;
  for (let k = 0; k < rows.length; k++) {
    const row = rows[k];
    if (!row) continue;
    const d = (row.x - x) ** 2 + (row.z - z) ** 2;
    if (d < gap) {
      gap = d;
      best = k;
    }
  }
  const here = rows[best] ?? rows[0];
  if (!here) throw new Error("track has no centreline");
  const ahead = rows[(best + 1) % rows.length] ?? here;
  const ux = ahead.x - here.x;
  const uz = ahead.z - here.z;
  const lateral = ((x - here.x) * uz - (z - here.z) * ux) / Math.hypot(ux, uz);
  return { lateral, row: here };
}

function onTrack(x: number, y: number, z: number): boolean {
  const { lateral, row } = trackSide(x, z);
  const wall = lateral > 0 ? row.wallLeft : row.wallRight;
  return (
    Math.abs(lateral) < wall && y < row.y + row.camber * lateral + carClearance
  );
}

function records(name: string): number[][] {
  const bytes = readFileSync(path.join(directory, name));
  const values = new Float32Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength / 4,
  );
  const out: number[][] = [];
  for (let i = 0; i + 1 < values.length; i += recordStride)
    out.push([values[i] ?? 0, values[i + 1] ?? 0]);
  return out;
}

describe.skipIf(!stored("road.glb") || !stored("landmarks.glb"))(
  "Hill Country landmarks",
  () => {
    let landmarks: Document;
    let road: Document;
    beforeAll(async () => {
      [landmarks, road] = await Promise.all([
        readModel(path.join(directory, "landmarks.glb")),
        readModel(path.join(directory, "road.glb")),
      ]);
    });

    test("every landmark part stands on the ground or hangs from something that does", () => {
      const ground = groundOf(shapesOf(road, groundNames));
      const parts = shapesOf(landmarks, nearParts);
      expect(parts.length).toBeGreaterThan(10);
      expect(
        floating([...parts, ...shapesOf(road, pitBuilding)], ground),
      ).toEqual([]);
    });

    test("nothing of the landmarks stands on the track or its run-off below car height", () => {
      const hits: string[] = [];
      for (const shape of shapesOf(landmarks, nearParts)) {
        const p = shape.position;
        for (let i = 0; i < p.length; i += 9) {
          const [x = 0, y = 0, z = 0] = [p[i], p[i + 1], p[i + 2]];
          if (onTrack(x, y, z))
            hits.push(`${shape.name} ${x.toFixed(0)},${z.toFixed(0)}`);
        }
      }
      expect(hits.slice(0, 10)).toEqual([]);
    });

    test("no spectator sits inside a landmark building", () => {
      const solid = (
        JSON.parse(
          readFileSync(path.join(directory, "landmarks.json"), "utf8"),
        ) as Footprint[]
      ).filter((print) => print.solid);
      expect(solid.length).toBeGreaterThan(10);
      const inside = (file: string) =>
        stored(file)
          ? records(file).filter(([x = 0, north = 0]) =>
              inFootprint(solid, x, -north, 0),
            ).length
          : 0;
      expect(inside("crowd.bin")).toBe(0);
    });
  },
);
