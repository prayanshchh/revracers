import * as THREE from "three/webgpu";
import { MeshoptSimplifier } from "meshoptimizer/simplifier";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { clone as cloneRig } from "three/examples/jsm/utils/SkeletonUtils.js";
import { gltfLoader } from "./gltf-loader.ts";
import { teamKit } from "./pit-crew.ts";
import { surface } from "./road.ts";
import type { CrewSpot } from "./street-pit.ts";

const kitMaterials = new Set(["crew suit", "crew shell"]);
const poseShare = 0.4;
const figureError = 0.01;
const keptAttributes = ["position", "normal", "uv"] as const;

type Pose = Map<
  string,
  { geometry: THREE.BufferGeometry; source: THREE.Material }
>;

function attributeOf(
  geometry: THREE.BufferGeometry,
  name: string,
): THREE.BufferAttribute | undefined {
  return geometry.getAttribute(name) as THREE.BufferAttribute | undefined;
}

function skinned(mesh: THREE.Mesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  for (const name of keptAttributes) {
    const attribute = attributeOf(mesh.geometry, name);
    if (attribute) geometry.setAttribute(name, attribute.clone());
  }
  if (mesh.geometry.index) geometry.setIndex(mesh.geometry.index.clone());
  if (mesh instanceof THREE.SkinnedMesh) {
    const position = geometry.getAttribute("position");
    const point = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      mesh.applyBoneTransform(i, point.fromBufferAttribute(position, i));
      position.setXYZ(i, point.x, point.y, point.z);
    }
  }
  geometry.applyMatrix4(mesh.matrixWorld);
  geometry.computeVertexNormals();
  return geometry;
}

function lighter(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const position = geometry.getAttribute("position");
  const source = geometry.index
    ? Uint32Array.from(geometry.index.array)
    : Uint32Array.from({ length: position.count }, (_, i) => i);
  const flat = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    flat[i * 3] = position.getX(i);
    flat[i * 3 + 1] = position.getY(i);
    flat[i * 3 + 2] = position.getZ(i);
  }
  const [indices] = MeshoptSimplifier.simplify(
    source,
    flat,
    3,
    0,
    figureError,
    ["ErrorAbsolute"],
  );
  const [remap, unique] = MeshoptSimplifier.compactMesh(indices);
  const out = new THREE.BufferGeometry();
  for (const name of keptAttributes) {
    const attribute = attributeOf(geometry, name);
    if (!attribute) continue;
    const size = attribute.itemSize;
    const values = new Float32Array(unique * size);
    for (let i = 0; i < attribute.count; i++) {
      const to = remap[i];
      if (to === undefined || to >= unique) continue;
      for (let c = 0; c < size; c++)
        values[to * size + c] = attribute.getComponent(i, c);
    }
    out.setAttribute(name, new THREE.BufferAttribute(values, size));
  }
  out.setIndex(new THREE.BufferAttribute(indices, 1));
  return out;
}

function bake(model: THREE.Object3D, clip: THREE.AnimationClip): Pose {
  const rig = cloneRig(model);
  const mixer = new THREE.AnimationMixer(rig);
  mixer.clipAction(clip).play();
  mixer.setTime(clip.duration * poseShare);
  rig.updateMatrixWorld(true);
  const pose: Pose = new Map();
  rig.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object instanceof THREE.SkinnedMesh) object.skeleton.update();
    const source = object.material as THREE.Material;
    pose.set(source.name, {
      geometry: lighter(skinned(object as THREE.Mesh)),
      source,
    });
  });
  return pose;
}

function teamMaterial(
  source: THREE.Material,
  map: THREE.Texture,
  anisotropy: number,
): THREE.Material {
  const copy = (source as THREE.MeshStandardMaterial).clone();
  if (kitMaterials.has(source.name)) copy.map = map;
  return surface(copy, anisotropy);
}

type Parts = Map<
  string,
  { source: THREE.Material; pieces: THREE.BufferGeometry[] }
>;

function teamParts(
  team: string,
  spots: CrewSpot[],
  poses: Map<string, Pose>,
): Parts {
  const parts: Parts = new Map();
  const place = new THREE.Matrix4();
  const turn = new THREE.Quaternion();
  const axis = new THREE.Vector3(0, 1, 0);
  const scale = new THREE.Vector3(1, 1, 1);
  for (const spot of spots) {
    const pose = spot.team === team ? poses.get(spot.pose) : undefined;
    if (!pose) continue;
    const [x = 0, y = 0, z = 0] = spot.position;
    place.compose(
      new THREE.Vector3(x, y, z),
      turn.setFromAxisAngle(axis, spot.heading),
      scale,
    );
    for (const [name, { geometry, source }] of pose) {
      const entry = parts.get(name) ?? { source, pieces: [] };
      entry.pieces.push(geometry.clone().applyMatrix4(place));
      parts.set(name, entry);
    }
  }
  return parts;
}

export async function paddockCrew(
  url: string,
  spots: CrewSpot[],
  anisotropy: number,
): Promise<THREE.Group> {
  const group = new THREE.Group();
  group.name = "paddock crew";
  if (spots.length === 0) return group;
  const names = [...new Set(spots.map((spot) => spot.team))];
  const [gltf, kits] = await Promise.all([
    gltfLoader().loadAsync(url),
    Promise.all(names.map((team) => teamKit(team, anisotropy))),
    MeshoptSimplifier.ready,
  ]);
  const poses = new Map<string, Pose>();
  for (const clip of gltf.animations) {
    if (spots.some((spot) => spot.pose === clip.name))
      poses.set(clip.name, bake(gltf.scene, clip));
  }
  names.forEach((team, index) => {
    const map = kits[index];
    if (!map) return;
    for (const { source, pieces } of teamParts(team, spots, poses).values()) {
      const merged = mergeGeometries(pieces);
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(
        merged,
        teamMaterial(source, map, anisotropy),
      );
      mesh.name = `paddock crew ${team}`;
      group.add(mesh);
    }
  });
  return group;
}
