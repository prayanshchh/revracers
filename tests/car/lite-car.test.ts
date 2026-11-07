import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { type Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { describe, expect, test } from "vitest";
import { repoRoot } from "../support/repo.ts";

const cars = path.join(repoRoot, "content/cars");
const teams = readdirSync(cars).filter((team) =>
  existsSync(path.join(cars, team, "car.glb")),
);
const pointer = (file: string) =>
  readFileSync(file)
    .subarray(0, 40)
    .toString()
    .startsWith("version https://git-lfs");
const lfsMissing = teams.some(
  (team) =>
    pointer(path.join(cars, team, "car.glb")) ||
    pointer(path.join(cars, team, "lite", "car.bin")),
);
const tolerance: Record<string, number> = {
  POSITION: 2e-4,
  NORMAL: 2e-3,
  TEXCOORD_0: 2e-4,
};

interface Shape {
  nodes: string[];
  primitives: string[];
  arrays: Map<string, ArrayLike<number>>;
}

function shape(document: Document): Shape {
  const primitives: string[] = [];
  const arrays = new Map<string, ArrayLike<number>>();
  for (const mesh of document.getRoot().listMeshes())
    mesh.listPrimitives().forEach((primitive, index) => {
      const key = `${mesh.getName()}#${String(index)}`;
      const semantics = primitive.listSemantics().sort();
      const count = primitive.getAttribute("POSITION")?.getCount() ?? 0;
      primitives.push(
        `${key} ${primitive.getMaterial()?.getName() ?? ""} ${semantics.join(",")} ${String(count)} ${String(primitive.getIndices()?.getCount() ?? 0)}`,
      );
      for (const semantic of semantics) {
        const array = primitive.getAttribute(semantic)?.getArray();
        if (array) arrays.set(`${key} ${semantic}`, array);
      }
    });
  return {
    nodes: document
      .getRoot()
      .listNodes()
      .map((node) => node.getName())
      .sort(),
    primitives: primitives.sort(),
    arrays,
  };
}

const components: Record<string, number> = {
  POSITION: 3,
  NORMAL: 3,
  TEXCOORD_0: 2,
};

function summary(values: ArrayLike<number>, stride: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < stride; k++) {
    let low = Infinity;
    let high = -Infinity;
    let sum = 0;
    for (let i = k; i < values.length; i += stride) {
      const value = values[i] ?? 0;
      low = Math.min(low, value);
      high = Math.max(high, value);
      sum += value;
    }
    out.push(low, high, sum / (values.length / stride));
  }
  return out;
}

function largestError(
  full: ArrayLike<number>,
  lite: ArrayLike<number>,
  stride: number,
): number {
  const a = summary(full, stride);
  const b = summary(lite, stride);
  return Math.max(...a.map((value, i) => Math.abs(value - (b[i] ?? Infinity))));
}

function merged(parts: Shape[]): Shape {
  return {
    nodes: [...new Set(parts.flatMap((part) => part.nodes))].sort(),
    primitives: parts.flatMap((part) => part.primitives).sort(),
    arrays: new Map(parts.flatMap((part) => [...part.arrays])),
  };
}

const packs: [string, string[]][] = [
  ["car.glb", ["car.bin", "cockpit.bin"]],
  ["lod.glb", ["lod.bin"]],
];

describe.skipIf(lfsMissing)("lite cars for the first download", () => {
  test("every team's packed car, body and cockpit together, is its full car with the same parts, materials and vertices, to a fraction of a millimetre", async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
    for (const team of teams)
      for (const [file, pieces] of packs) {
        const full = shape(
          await io.readBinary(readFileSync(path.join(cars, team, file))),
        );
        const parts: Shape[] = [];
        for (const piece of pieces)
          parts.push(
            shape(
              await io.readBinary(
                readFileSync(path.join(cars, team, "lite", piece)),
              ),
            ),
          );
        const lite = merged(parts);
        expect(lite.nodes, `${team} ${file}`).toEqual(full.nodes);
        expect(lite.primitives, `${team} ${file}`).toEqual(full.primitives);
        for (const [key, values] of full.arrays) {
          const semantic = key.split(" ").at(-1) ?? "";
          const packed = lite.arrays.get(key);
          expect(packed, `${team} ${file} ${key}`).toBeDefined();
          if (!packed) continue;
          expect(packed.length).toBe(values.length);
          expect(
            largestError(values, packed, components[semantic] ?? 1),
            `${team} ${file} ${key}`,
          ).toBeLessThan(tolerance[semantic] ?? 1e-6);
        }
      }
  });
});
