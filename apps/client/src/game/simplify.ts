import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { lampMaterial } from "./lamps.ts";
import { flapName } from "./rear-flap.ts";
import {
  type Simplify,
  type SimplifyJob,
  simplifyAllHere,
} from "./simplify-jobs.ts";

function matrix(): THREE.Group {
  const object = new THREE.Group();
  object.matrixAutoUpdate = false;
  return object;
}

function flatPositions(geometry: THREE.BufferGeometry): Float32Array {
  const position = geometry.getAttribute("position");
  const flat = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    flat[i * 3] = position.getX(i);
    flat[i * 3 + 1] = position.getY(i);
    flat[i * 3 + 2] = position.getZ(i);
  }
  return flat;
}

function jobOf(geometry: THREE.BufferGeometry, error: number): SimplifyJob {
  const count = geometry.getAttribute("position").count;
  const indices = geometry.index
    ? Uint32Array.from(geometry.index.array)
    : Uint32Array.from({ length: count }, (_, i) => i);
  return { indices, positions: flatPositions(geometry), error };
}

function withIndices(
  geometry: THREE.BufferGeometry,
  indices: Uint32Array,
): THREE.BufferGeometry {
  const result = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(geometry.attributes))
    result.setAttribute(name, attribute);
  result.setIndex(new THREE.BufferAttribute(indices, 1));
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  result.boundingSphere = geometry.boundingSphere;
  return result;
}

export async function simplified(
  geometry: THREE.BufferGeometry,
  error: number,
  run: Simplify = simplifyAllHere,
): Promise<THREE.BufferGeometry> {
  const [indices] = await run([jobOf(geometry, error)]);
  if (!indices) throw new Error("the simplifier returned nothing");
  return withIndices(geometry, indices);
}

interface Pending {
  jobs: SimplifyJob[];
  done: (indices: Uint32Array[]) => void;
  failed: (reason: unknown) => void;
}

export class Simplifier {
  private worker: Worker | null = null;
  private next = 0;
  private readonly pending = new Map<number, Pending>();

  constructor() {
    try {
      this.worker = new Worker(
        new URL("./simplify-worker.ts", import.meta.url),
        { type: "module" },
      );
    } catch {
      return;
    }
    this.worker.onmessage = (
      event: MessageEvent<{ id: number; indices: Uint32Array[] | null }>,
    ) => {
      const { id, indices } = event.data;
      const waiting = this.pending.get(id);
      if (!waiting) return;
      this.pending.delete(id);
      if (indices) waiting.done(indices);
      else this.here(waiting);
    };
    this.worker.onerror = () => {
      this.close();
    };
  }

  readonly run: Simplify = (jobs) =>
    new Promise((done, failed) => {
      const waiting = { jobs, done, failed };
      if (!this.worker) {
        this.here(waiting);
        return;
      }
      const id = this.next++;
      this.pending.set(id, waiting);
      this.worker.postMessage({ id, jobs });
    });

  close(): void {
    this.worker?.terminate();
    this.worker = null;
    const left = [...this.pending.values()];
    this.pending.clear();
    for (const waiting of left) this.here(waiting);
  }

  private here(waiting: Pending): void {
    simplifyAllHere(waiting.jobs).then(waiting.done, waiting.failed);
  }
}

async function simplifiedParts(
  meshes: THREE.Mesh[],
  error: number,
  run: Simplify,
): Promise<THREE.Mesh[]> {
  const groups = new Map<THREE.Material, THREE.Mesh[]>();
  for (const mesh of meshes) {
    const material = mesh.material as THREE.Material;
    groups.set(material, [...(groups.get(material) ?? []), mesh]);
  }
  const merged = Array.from(groups, ([material, parts]) => {
    const geometry =
      parts.length === 1
        ? parts[0]?.geometry
        : mergeGeometries(parts.map((mesh) => mesh.geometry));
    if (!geometry) throw new Error(`cannot merge ${material.name} parts`);
    return { material, parts, geometry };
  });
  const simple = merged.filter(
    ({ material }) => material.name !== lampMaterial,
  );
  const indices = await run(
    simple.map(({ geometry }) => jobOf(geometry, error)),
  );
  const made = new Map(
    simple.map(({ geometry }, i) => [
      geometry,
      withIndices(geometry, indices[i] ?? new Uint32Array()),
    ]),
  );
  return merged.map(({ material, parts, geometry }) => {
    const copy = new THREE.Mesh(made.get(geometry) ?? geometry, material);
    copy.userData = parts[0]?.userData ?? {};
    return copy;
  });
}

export async function simplifiedBody(
  body: THREE.Object3D,
  error: number,
  run: Simplify = simplifyAllHere,
): Promise<THREE.Group> {
  const level = matrix();
  level.matrix.copy(body.matrix);
  const hinged = new Set<THREE.Object3D>();
  body.getObjectByName(flapName)?.traverse((object) => hinged.add(object));
  const meshes: THREE.Mesh[] = [];
  body.traverse((object) => {
    if (object.type === "Mesh") meshes.push(object as THREE.Mesh);
  });
  const fixed = meshes.filter((mesh) => !hinged.has(mesh));
  const moving = meshes.filter((mesh) => hinged.has(mesh));
  const [still, hinge] = await Promise.all([
    simplifiedParts(fixed, error, run),
    moving.length > 0 ? simplifiedParts(moving, error, run) : null,
  ]);
  level.add(...still);
  if (hinge) {
    const flap = matrix();
    flap.name = flapName;
    flap.add(...hinge);
    level.add(flap);
  }
  return level;
}
