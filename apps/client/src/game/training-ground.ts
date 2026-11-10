import * as THREE from "three/webgpu";
import { trainingMaps, trainingUpgrades } from "./training-files.ts";
import { swapLater } from "./upgrades.ts";
import { releaseOnceUploaded } from "./preload.ts";
import {
  alphaTestedOrder,
  type BakedGround,
  type SkyRadiance,
  surface,
} from "./road.ts";
import {
  type LinePath,
  type Part,
  type TrainingTrack,
  trainingParts,
} from "./training-layout.ts";

const shadowCasters = /^(wall|gantry)/;
const toneRows = 512;
const toneColumns = 8;
const toneBase = 0.26;
const toneSwing = 0.09;

export type Maps = Record<
  | "asphalt"
  | "asphaltNormal"
  | "asphaltRoughness"
  | "streaks"
  | "concrete"
  | "concreteNormal"
  | "grass"
  | "grassNormal"
  | "paintNormal"
  | "paintRoughness"
  | "paint"
  | "tecpro"
  | "terrain",
  THREE.Texture
>;

function later(url: string, after: Promise<unknown>): THREE.Texture {
  const map = new THREE.Texture();
  const manager = THREE.DefaultLoadingManager;
  manager.itemStart(url);
  void after
    .then(() => new THREE.ImageLoader().loadAsync(url))
    .then(
      (image) => {
        map.image = image;
        map.needsUpdate = true;
      },
      () => {
        manager.itemError(url);
      },
    )
    .finally(() => {
      manager.itemEnd(url);
    });
  return map;
}

function better(map: THREE.Texture, url: string): THREE.Texture {
  swapLater(map, url);
  return map;
}

export function loadMaps(anisotropy: number, after: Promise<unknown>): Maps {
  const load = (url: string, colour: boolean) => {
    const map = releaseOnceUploaded(later(url, after));
    map.flipY = false;
    map.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = anisotropy;
    return map;
  };
  const [
    asphalt,
    asphaltNormal,
    asphaltRoughness,
    streaks,
    concrete,
    concreteNormal,
    grass,
    grassNormal,
    paintNormal,
    paintRoughness,
    paint,
    tecpro,
    terrain,
  ] = [
    better(load(trainingMaps.asphaltBase, true), trainingUpgrades.asphaltBase),
    better(
      load(trainingMaps.asphaltNormal, false),
      trainingUpgrades.asphaltNormal,
    ),
    load(trainingMaps.asphaltRoughness, false),
    load(trainingMaps.streaks, false),
    load(trainingMaps.concreteBase, true),
    load(trainingMaps.concreteNormal, false),
    load(trainingMaps.grassBase, true),
    load(trainingMaps.grassNormal, false),
    load(trainingMaps.paintNormal, false),
    load(trainingMaps.paintRoughness, false),
    load(trainingMaps.paintWhite, true),
    load(trainingMaps.tecpro, true),
    load(trainingMaps.terrain, true),
  ];
  return {
    asphalt,
    asphaltNormal,
    asphaltRoughness,
    streaks,
    concrete,
    concreteNormal,
    grass,
    grassNormal,
    paintNormal,
    paintRoughness,
    paint,
    tecpro,
    terrain,
  };
}

function maskTexture(
  data: Uint8Array,
  width: number,
  height: number,
): THREE.DataTexture {
  const map = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  map.colorSpace = THREE.NoColorSpace;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearFilter;
  map.generateMipmaps = false;
  map.wrapS = THREE.ClampToEdgeWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.needsUpdate = true;
  return map;
}

function asphaltTone(row: number, rows: number): number {
  const t = (row / rows) * Math.PI * 2;
  const wave =
    0.55 * Math.sin(t * 3 + 0.7) +
    0.3 * Math.sin(t * 11 + 2.1) +
    0.15 * Math.sin(t * 29 + 4.4);
  return toneBase + toneSwing * wave;
}

export function bakedGround(maps: Maps): BakedGround {
  const apronA = maskTexture(new Uint8Array(4 * 4 * 4), 4, 4);
  const tone = new Uint8Array(toneColumns * toneRows * 4);
  for (let row = 0; row < toneRows; row++) {
    const value = Math.round(asphaltTone(row, toneRows) * 255);
    for (let column = 0; column < toneColumns; column++)
      tone[(row * toneColumns + column) * 4 + 2] = value;
  }
  const apronB = maskTexture(tone, toneColumns, toneRows);
  return {
    apronA,
    apronB,
    streaks: maps.streaks,
    terrain: maps.terrain,
    grain: maps.asphalt,
  };
}

export function sources(
  maps: Maps,
): Record<string, THREE.MeshStandardMaterial> {
  const make = (name: string, params: THREE.MeshStandardMaterialParameters) =>
    new THREE.MeshStandardMaterial({ name, roughness: 1, ...params });
  return {
    "track road asphalt": make("track road asphalt", {
      map: maps.asphalt,
      normalMap: maps.asphaltNormal,
      roughnessMap: maps.asphaltRoughness,
    }),
    "track road paint": make("track road paint", {
      map: maps.paint,
      normalMap: maps.paintNormal,
      roughnessMap: maps.paintRoughness,
    }),
    "track road kerb": make("track road kerb", {
      normalMap: maps.paintNormal,
      roughnessMap: maps.paintRoughness,
    }),
    "track road grass": make("track road grass", {
      map: maps.grass,
      normalMap: maps.grassNormal,
    }),
    "track terrain": make("track terrain", {
      map: maps.grass,
      normalMap: maps.grassNormal,
    }),
    "track wall concrete": make("track wall concrete", {
      map: maps.concrete,
      normalMap: maps.concreteNormal,
      roughness: 0.9,
    }),
    "track wall tecpro": make("track wall tecpro", {
      map: maps.tecpro,
      roughness: 0.9,
    }),
    "track gantry steel": make("track gantry steel", {
      color: new THREE.Color(0.12, 0.12, 0.13),
      roughness: 0.5,
      metalness: 0.6,
    }),
    "track start lamps": make("track start lamps", {}),
  };
}

export function meshOf(part: Part, material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(part.position, 3),
  );
  geometry.setAttribute("normal", new THREE.BufferAttribute(part.normal, 3));
  part.uvs.forEach((set, index) => {
    geometry.setAttribute(
      index === 0 ? "uv" : `uv${String(index)}`,
      new THREE.BufferAttribute(set, 2),
    );
  });
  geometry.setIndex(new THREE.BufferAttribute(part.index, 1));
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = part.name.replaceAll(" ", "_");
  mesh.receiveShadow = true;
  mesh.castShadow = shadowCasters.test(part.name);
  if (material.alphaTest > 0) mesh.renderOrder = alphaTestedOrder;
  return mesh;
}

export async function buildTrainingGround(
  track: TrainingTrack,
  line: LinePath | null,
  anisotropy: number,
  skyLoad: Promise<SkyRadiance | null>,
  after: Promise<unknown>,
): Promise<THREE.Object3D> {
  const maps = loadMaps(anisotropy, after);
  const sky = await skyLoad;
  const baked = bakedGround(maps);
  const byName = sources(maps);
  const materials = new Map<string, THREE.Material>();
  const materialOf = (name: string) => {
    const known = materials.get(name);
    if (known) return known;
    const source = byName[name];
    if (!source) throw new Error(`training ground has no material ${name}`);
    const made = surface(source, anisotropy, baked, sky);
    materials.set(name, made);
    return made;
  };
  const root = new THREE.Group();
  root.name = "training ground";
  for (const part of trainingParts(track, line))
    if (part.index.length > 0)
      root.add(meshOf(part, materialOf(part.material)));
  return root;
}
