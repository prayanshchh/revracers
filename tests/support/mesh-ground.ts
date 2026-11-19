import * as THREE from "three/webgpu";
import { readModel } from "./gltf.ts";

export type Ground = (x: number, z: number) => number | null;

async function primitiveOf(file: string, name: RegExp) {
  const document = await readModel(file);
  const node = document
    .getRoot()
    .listNodes()
    .find((each) => name.test(each.getName()));
  const primitive = node?.getMesh()?.listPrimitives()[0];
  const position = primitive?.getAttribute("POSITION");
  const index = primitive?.getIndices()?.getArray();
  if (!node || !position || !index)
    throw new Error(`no ${String(name)} mesh in ${file}`);
  return {
    position,
    index,
    matrix: new THREE.Matrix4().fromArray(node.getWorldMatrix()),
  };
}

async function trianglesOf(
  file: string,
  name: RegExp,
): Promise<THREE.Triangle[]> {
  const { position, index, matrix } = await primitiveOf(file, name);
  const corner = [0, 0, 0];
  const points = Array.from({ length: position.getCount() }, (_, i) =>
    new THREE.Vector3(...position.getElement(i, corner)).applyMatrix4(matrix),
  );
  const triangles: THREE.Triangle[] = [];
  for (let t = 0; t + 2 < index.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => points[Number(index[t + k])]);
    if (a && b && c) triangles.push(new THREE.Triangle(a, b, c));
  }
  return triangles;
}

function cellOf(x: number, z: number, bucket: number): string {
  return `${String(Math.floor(x / bucket))}|${String(Math.floor(z / bucket))}`;
}

function bucketed(
  triangles: THREE.Triangle[],
  bucket: number,
): Map<string, THREE.Triangle[]> {
  const cells = new Map<string, THREE.Triangle[]>();
  const box = new THREE.Box3();
  for (const triangle of triangles) {
    box.setFromPoints([triangle.a, triangle.b, triangle.c]);
    for (let x = Math.floor(box.min.x / bucket); x <= box.max.x / bucket; x++)
      for (
        let z = Math.floor(box.min.z / bucket);
        z <= box.max.z / bucket;
        z++
      ) {
        const key = cellOf(x * bucket, z * bucket, bucket);
        cells.set(key, [...(cells.get(key) ?? []), triangle]);
      }
  }
  return cells;
}

function heightOn(
  triangle: THREE.Triangle,
  x: number,
  z: number,
): number | null {
  const flat = new THREE.Triangle(
    new THREE.Vector3(triangle.a.x, 0, triangle.a.z),
    new THREE.Vector3(triangle.b.x, 0, triangle.b.z),
    new THREE.Vector3(triangle.c.x, 0, triangle.c.z),
  );
  const at = new THREE.Vector3(x, 0, z);
  if (flat.getArea() < 1e-6 || !flat.containsPoint(at)) return null;
  const weights = flat.getBarycoord(at, new THREE.Vector3());
  if (!weights) return null;
  return (
    triangle.a.y * weights.x +
    triangle.b.y * weights.y +
    triangle.c.y * weights.z
  );
}

export async function meshGround(
  file: string,
  name: RegExp,
  bucket: number,
): Promise<Ground> {
  const cells = bucketed(await trianglesOf(file, name), bucket);
  return (x, z) => {
    for (const triangle of cells.get(cellOf(x, z, bucket)) ?? []) {
      const height = heightOn(triangle, x, z);
      if (height !== null) return height;
    }
    return null;
  };
}
