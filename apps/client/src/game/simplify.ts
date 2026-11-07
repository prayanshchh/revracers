import * as THREE from "three/webgpu";
import { MeshoptSimplifier } from "meshoptimizer/simplifier";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { lampMaterial } from "./lamps.ts";
import { flapName } from "./rear-flap.ts";

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

export function simplified(
  geometry: THREE.BufferGeometry,
  error: number,
): THREE.BufferGeometry {
  const count = geometry.getAttribute("position").count;
  const source = geometry.index
    ? Uint32Array.from(geometry.index.array)
    : Uint32Array.from({ length: count }, (_, i) => i);
  const [indices] = MeshoptSimplifier.simplify(
    source,
    flatPositions(geometry),
    3,
    0,
    error,
    ["ErrorAbsolute"],
  );
  const result = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(geometry.attributes))
    result.setAttribute(name, attribute);
  result.setIndex(new THREE.BufferAttribute(indices, 1));
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  result.boundingSphere = geometry.boundingSphere;
  return result;
}

function simplifiedParts(meshes: THREE.Mesh[], error: number): THREE.Mesh[] {
  const groups = new Map<THREE.Material, THREE.Mesh[]>();
  for (const mesh of meshes) {
    const material = mesh.material as THREE.Material;
    groups.set(material, [...(groups.get(material) ?? []), mesh]);
  }
  return Array.from(groups, ([material, parts]) => {
    const geometry =
      parts.length === 1
        ? parts[0]?.geometry
        : mergeGeometries(parts.map((mesh) => mesh.geometry));
    if (!geometry) throw new Error(`cannot merge ${material.name} parts`);
    const lamp = material.name === lampMaterial;
    const copy = new THREE.Mesh(
      lamp ? geometry : simplified(geometry, error),
      material,
    );
    copy.userData = parts[0]?.userData ?? {};
    return copy;
  });
}

export function simplifiedBody(
  body: THREE.Object3D,
  error: number,
): THREE.Group {
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
  level.add(...simplifiedParts(fixed, error));
  if (moving.length > 0) {
    const flap = matrix();
    flap.name = flapName;
    flap.add(...simplifiedParts(moving, error));
    level.add(flap);
  }
  return level;
}
