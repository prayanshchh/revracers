import * as THREE from "three/webgpu";
import {
  cameraViewMatrix,
  cos,
  float,
  materialColor,
  mix,
  normalLocal,
  normalWorld,
  positionLocal,
  sin,
  time,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import landmarksUrl from "../../../../content/tracks/hill-country/landmarks.glb?url";
import dressing from "../../../../content/tracks/hill-country/dressing.json";
import footprints from "../../../../content/tracks/hill-country/landmarks.json";
import { gltfLoader } from "./gltf-loader.ts";
import { type Footprint, inFootprint } from "./landmark-footprints.ts";
import { curtain } from "./venue-facade.ts";
import { inZone, without, type Zone } from "./trackside-props.ts";
import type { Frames } from "./venue-dressing.ts";

type Dress = (source: THREE.MeshStandardMaterial) => THREE.Material;

export const landmarkFiles = [landmarksUrl];

const replacedBaked =
  /^(tower_core|tower_plates|veil|paddock_banner|crane_body|crane_dark|prop_(marquee|hut|marshal|screen|steel|dark))$/;
const soffitLook = /^track paddock canopy$/;
const shadowless = /^landmark_(glass|flag|rope|lamp)_/;
const flagPart = /^landmark_flag_/;
const flagWaves = [
  { length: 7.5, speed: 2.3, reach: 0.9 },
  { length: 15.0, speed: 3.7, reach: 0.28 },
];
const flagShade = 0.22;
const roofMeshes = /^stand_canopy$/;
const boxMeshes = /^(walls|rooftops)$/;
const backMeshes = /^paddock_panels$/;
const standMeshes = /^stand_/;
const bowlName = "amphitheatre bowl";
const boxMargin = 1.5;
const frameMeshes = /^stand_scaffold$/;
const fabricLook = /^landmark fabric$/;
const glassLook = /^landmark glass$/;
const lampLook = /^landmark lamp$/;
const lampGlow = 1.6;
const fabricLift = 0.7;

function waving(material: THREE.MeshStandardNodeMaterial): void {
  const along = uv().x;
  const phases = flagWaves.map((wave) =>
    along.mul(wave.length).sub(time.mul(wave.speed)),
  );
  const lift = phases
    .map((phase, k) => sin(phase).mul(along.mul(flagWaves[k]?.reach ?? 0)))
    .reduce((a, b) => a.add(b));
  material.positionNode = positionLocal.add(normalLocal.mul(lift));
  const light = cos(phases[0] ?? float(0))
    .mul(along)
    .mul(flagShade)
    .add(1);
  material.colorNode = (material.colorNode ?? materialColor).mul(light);
}

function dressed(
  mesh: THREE.Mesh,
  dress: Dress,
  made: Map<THREE.Material, THREE.Material>,
): THREE.Material {
  const source = mesh.material as THREE.MeshStandardMaterial;
  const known = made.get(source);
  if (known) return known;
  const material = dress(source) as THREE.MeshStandardNodeMaterial;
  material.vertexColors = mesh.geometry.hasAttribute("color");
  if (flagPart.test(mesh.name)) waving(material);
  if (fabricLook.test(source.name)) translucent(material, fabricLift);
  if (glassLook.test(source.name)) curtain(material);
  if (lampLook.test(source.name))
    material.emissiveNode = materialColor.mul(lampGlow);
  made.set(source, material);
  return material;
}

export function loadLandmarks(): Promise<THREE.Object3D> {
  return gltfLoader()
    .loadAsync(landmarksUrl)
    .then((gltf) => gltf.scene);
}

function uncovered(
  scene: THREE.Object3D,
  frames: Frames | null,
  footprints: Footprint[],
): void {
  const within = (zones: Zone[], x: number, z: number) =>
    frames !== null && inZone(zones, frames.list, frames.length, x, z);
  const lifted = (x: number, z: number, top: number) =>
    dressing.roofless.some((zone) => top > zone.above && within([zone], x, z));
  const bowls = footprints.filter((print) => print.name === bowlName);
  const strips: [RegExp, (x: number, z: number, top: number) => boolean][] = [
    [roofMeshes, (x, z) => within(dressing.roofless, x, z)],
    [frameMeshes, lifted],
    [boxMeshes, (x, z) => inFootprint(footprints, x, z, boxMargin)],
    [backMeshes, (x, z) => within(dressing.rebacked, x, z)],
    [standMeshes, (x, z) => inFootprint(bowls, x, z, 0)],
  ];
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const strip = strips.find(([names]) => names.test(object.name));
    if (strip) without((object as THREE.Mesh).geometry, strip[1]);
  });
}

function unseated(scene: THREE.Object3D): void {
  const people = scene.userData["people"] as { seated?: number[] } | undefined;
  const seated = people?.seated;
  if (!people || !seated) return;
  const bowls = footprints.filter((print) => print.name === bowlName);
  const kept: number[] = [];
  for (let i = 0; i + 2 < seated.length; i += 3) {
    const [x = 0, y = 0, z = 0] = seated.slice(i, i + 3);
    if (!inFootprint(bowls, x, z, 0)) kept.push(x, y, z);
  }
  people.seated = kept;
}

function translucent(material: THREE.MeshStandardNodeMaterial, lift = 0): void {
  const facing = normalWorld.y
    .lessThan(0)
    .select(normalWorld.negate(), normalWorld);
  const lit = mix(facing, vec3(0, 1, 0), lift).normalize();
  material.normalNode = cameraViewMatrix.mul(vec4(lit, 0)).xyz;
}

function soffits(scene: THREE.Object3D): void {
  const done = new Set<THREE.Material>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const material = object.material as THREE.MeshStandardNodeMaterial;
    if (done.has(material) || !soffitLook.test(material.name)) return;
    done.add(material);
    translucent(material);
  });
}

export function placeLandmarks(
  scene: THREE.Object3D,
  landmarks: THREE.Object3D,
  dress: Dress,
  frames: Frames | null,
): void {
  const gone: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh && replacedBaked.test(object.name))
      gone.push(object);
  });
  for (const object of gone) object.removeFromParent();
  const made = new Map<THREE.Material, THREE.Material>();
  const meshes: THREE.Mesh[] = [];
  landmarks.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object as THREE.Mesh);
  });
  uncovered(scene, frames, footprints);
  unseated(scene);
  soffits(scene);
  for (const mesh of meshes) {
    mesh.material = dressed(mesh, dress, made);
    mesh.castShadow = !shadowless.test(mesh.name);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}
