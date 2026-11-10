import * as THREE from "three/webgpu";
import {
  dot,
  float,
  mx_fractal_noise_float,
  normalViewGeometry,
  positionViewDirection,
  mix,
  smoothstep,
  texture,
  uv,
  vec3,
} from "three/tsl";
import wrapsUrl from "../../../../content/tracks/neon-boulevard/textures/wraps.webp?url";
import leavesUrl from "../../../../content/tracks/neon-boulevard/textures/leaves.webp?url";
import frondUrl from "../../../../content/tracks/neon-boulevard/textures/frond.webp?url";
import fenceUrl from "../../../../content/tracks/neon-boulevard/textures/fence.webp?url";
import { releaseOnceUploaded } from "./preload.ts";
import { type SkyRadiance, surface } from "./road.ts";
import {
  bakedGround,
  loadMaps,
  type Maps,
  meshOf,
  sources,
} from "./training-ground.ts";
import type { LinePath } from "./training-layout.ts";
import {
  type StreetPole,
  type StreetTrack,
  streetParts,
} from "./street-layout.ts";
import { buildCity, type CityData, cityGlow } from "./street-city.ts";
import { buildLandmarks } from "./street-landmarks.ts";
import {
  crowdMaterial,
  garageInteriorMaterial,
  garageMaterial,
  hallMaterial,
  lightStripMaterial,
  pitKitMaterial,
  pitSignMaterial,
} from "./street-materials.ts";
import type { CrewSpot, GarageCar } from "./street-pit.ts";

export const streetFiles = [wrapsUrl, frondUrl, leavesUrl, fenceUrl];

const lampColour = new THREE.Color(0.93, 0.96, 1);
const lampPeak = 90;
const fenceColour = new THREE.Color(0.8, 0.82, 0.85);
const fenceDensity = 0.72;
const fenceSpill = 0.08;
const steelSpill = 0.22;
const wrapGlow = 0.3;
const shaftRadius = 4.6;
const shaftStrength = 0.2;
const shaftTop = 0.2;
const shaftFade = 0.6;
const shaftSegments = 10;
const roofGlow = 0.12;
const grimeAcross = 4;
const grimeAlong = 0.08;
const grimeStrength = 0.3;
const runoffPaint = new THREE.Color(0.17, 0.44, 0.31);
const runoffCover = 0.82;
const patchAcross = 0.33;
const patchAlong = 0.11;
const patchShade = 0.86;
const laneWear = new THREE.Color(0.36, 0.36, 0.35);

function image(url: string, colour: boolean, anisotropy: number) {
  const map = releaseOnceUploaded(new THREE.TextureLoader().load(url));
  map.flipY = false;
  map.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = anisotropy;
  return map;
}

function streetSources(
  maps: Maps,
  anisotropy: number,
): Record<string, THREE.MeshStandardMaterial> {
  const wraps = image(wrapsUrl, true, anisotropy);
  wraps.wrapT = THREE.ClampToEdgeWrapping;
  const fence = image(fenceUrl, true, anisotropy);
  const make = (name: string, params: THREE.MeshStandardMaterialParameters) =>
    new THREE.MeshStandardMaterial({ name, roughness: 1, ...params });
  return {
    ...sources(maps),
    "track runoff asphalt": make("track runoff asphalt", {
      map: maps.asphalt,
      normalMap: maps.asphaltNormal,
      roughnessMap: maps.asphaltRoughness,
    }),
    "track wall wraps": make("track wall wraps", {
      map: wraps,
      roughness: 0.55,
    }),
    "track lane road paint": make("track lane road paint", {
      map: maps.paint,
      normalMap: maps.paintNormal,
      roughnessMap: maps.paintRoughness,
      color: laneWear,
    }),
    "track mesh fence": make("track mesh fence", {
      map: fence,
      color: fenceColour,
      roughness: 0.55,
      metalness: 0.2,
    }),
    "track fence steel": make("track fence steel", {
      color: new THREE.Color(0.78, 0.79, 0.8),
      roughness: 0.5,
      metalness: 0.2,
    }),
    "track stand concrete": make("track stand concrete", {
      color: new THREE.Color(0.5, 0.5, 0.52),
      roughness: 0.9,
    }),
    "track stand roof": make("track stand roof", {
      color: new THREE.Color(0.82, 0.83, 0.85),
      roughness: 0.5,
      metalness: 0.2,
    }),
    "track pole steel": make("track pole steel", {
      color: new THREE.Color(0.7, 0.71, 0.72),
      roughness: 0.5,
      metalness: 0.25,
    }),
  };
}

type Decorate = (
  made: THREE.MeshStandardNodeMaterial,
  source: THREE.MeshStandardMaterial,
) => void;

function glowOf(source: THREE.MeshStandardMaterial, share: number) {
  return vec3(source.color.r, source.color.g, source.color.b).mul(
    cityGlow.mul(share),
  );
}

const steelGlow: Decorate = (made, source) => {
  made.emissiveNode = glowOf(source, steelSpill);
};

const decorations: Record<string, Decorate> = {
  "track mesh fence": (made, source) => {
    if (!source.map) return;
    made.opacityNode = texture(source.map, uv()).a.mul(fenceDensity).min(1);
    made.emissiveNode = vec3(fenceColour.r, fenceColour.g, fenceColour.b).mul(
      cityGlow.mul(fenceSpill),
    );
  },
  "track road asphalt": (made) => {
    if (made.colorNode) made.colorNode = made.colorNode.mul(streetGrime());
  },
  "track runoff asphalt": (made) => {
    if (!made.colorNode) return;
    made.colorNode = mix(
      vec3(made.colorNode as THREE.Node<"vec3">),
      vec3(runoffPaint.r, runoffPaint.g, runoffPaint.b),
      uv(1).x.mul(runoffCover),
    );
  },
  "track stand roof": (made, source) => {
    made.emissiveNode = glowOf(source, roofGlow);
  },
  "track wall wraps": (made, source) => {
    if (source.map)
      made.emissiveNode = texture(source.map, uv()).rgb.mul(
        cityGlow.mul(wrapGlow),
      );
  },
  "track fence steel": steelGlow,
  "track pole steel": steelGlow,
};

function streetGrime(): THREE.Node<"float"> {
  const streaks = mx_fractal_noise_float(
    vec3(uv().x.mul(grimeAcross), uv().y.mul(grimeAlong), 0),
    3,
  );
  const patch = smoothstep(
    0.25,
    0.32,
    mx_fractal_noise_float(
      vec3(uv().x.mul(patchAcross), uv().y.mul(patchAlong), 7),
      2,
    ),
  );
  return float(1)
    .add(streaks.mul(grimeStrength))
    .mul(mix(float(1), float(patchShade), patch));
}

function lightShafts(poles: StreetPole[]): THREE.InstancedMesh {
  const cone = new THREE.CylinderGeometry(
    shaftTop,
    1,
    1,
    shaftSegments,
    1,
    true,
  );
  cone.translate(0, -0.5, 0);
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
  material.fog = false;
  const down = float(1).sub(uv().y);
  const facing = dot(normalViewGeometry, positionViewDirection).abs();
  material.colorNode = vec3(lampColour.r, lampColour.g, lampColour.b).mul(
    smoothstep(1, 0, down)
      .mul(facing.mul(facing).mul(facing))
      .mul(cityGlow.mul(shaftStrength)),
  );
  const shafts = new THREE.InstancedMesh(cone, material, poles.length);
  const matrix = new THREE.Matrix4();
  const turn = new THREE.Quaternion();
  const below = new THREE.Vector3(0, -1, 0);
  poles.forEach((pole, i) => {
    const head = new THREE.Vector3().fromArray(pole.head);
    const axis = new THREE.Vector3().fromArray(pole.aim).sub(head);
    const reach = axis.length() * shaftFade;
    turn.setFromUnitVectors(below, axis.normalize());
    matrix.compose(
      head,
      turn,
      new THREE.Vector3(shaftRadius, reach, shaftRadius),
    );
    shafts.setMatrixAt(i, matrix);
  });
  shafts.computeBoundingSphere();
  shafts.castShadow = false;
  shafts.receiveShadow = false;
  shafts.renderOrder = 2;
  shafts.name = "lamp shafts";
  return shafts;
}

function lampMaterial(): THREE.MeshBasicNodeMaterial {
  const lamp = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  lamp.colorNode = vec3(lampColour.r, lampColour.g, lampColour.b).mul(
    float(lampPeak).mul(cityGlow).add(0.05),
  );
  return lamp;
}

export async function buildStreetCircuit(
  track: StreetTrack,
  line: LinePath | null,
  city: CityData,
  anisotropy: number,
  skyLoad: Promise<SkyRadiance | null>,
  after: Promise<unknown>,
): Promise<THREE.Object3D> {
  const maps = loadMaps(anisotropy, after);
  const byName = streetSources(maps, anisotropy);
  const sky = await skyLoad;
  const baked = bakedGround(maps);
  const materials = new Map<string, THREE.Material>();
  const lamp = lampMaterial();
  const special: Record<string, THREE.Material> = {
    "track pole lamps": lamp,
    "track stand crowd": crowdMaterial(),
    "track stand lights": lightStripMaterial(),
    "track garage front": garageMaterial(),
    "track garage interior": garageInteriorMaterial(),
    "track pit kit": pitKitMaterial(),
    "track pit signs": pitSignMaterial(),
    "track paddock hall": hallMaterial(),
  };
  const materialOf = (name: string) => {
    const custom = special[name];
    if (custom) return custom;
    const known = materials.get(name);
    if (known) return known;
    const source = byName[name];
    if (!source) throw new Error(`street circuit has no material ${name}`);
    const made = surface(source, anisotropy, baked, sky);
    decorations[name]?.(made, source);
    materials.set(name, made);
    return made;
  };
  const root = new THREE.Group();
  root.name = "street circuit";
  const { parts, poles, crew, cars } = streetParts(
    track,
    line,
    city.bridges.map((b) => b.distance),
    city.venue,
  );
  for (const part of parts)
    if (part.index.length > 0)
      root.add(meshOf(part, materialOf(part.material)));
  const frond = image(frondUrl, true, anisotropy);
  frond.wrapS = THREE.ClampToEdgeWrapping;
  frond.wrapT = THREE.ClampToEdgeWrapping;
  const foliage = image(leavesUrl, true, anisotropy);
  foliage.wrapS = THREE.ClampToEdgeWrapping;
  foliage.wrapT = THREE.ClampToEdgeWrapping;
  root.add(
    buildCity(city, frond, foliage),
    buildLandmarks(city.landmarks),
    lightShafts(poles),
  );
  root.userData["poles"] = poles;
  root.userData["crew"] = crew;
  root.userData["lap"] = track.length;
  root.userData["cars"] = cars;
  return root;
}

export function crewOf(root: THREE.Object3D): {
  spots: CrewSpot[];
  length: number;
} {
  return {
    spots: (root.userData["crew"] as CrewSpot[] | undefined) ?? [],
    length: (root.userData["lap"] as number | undefined) ?? 1,
  };
}

export function garageCarsOf(root: THREE.Object3D): GarageCar[] {
  return (root.userData["cars"] as GarageCar[] | undefined) ?? [];
}

export function polesOf(root: THREE.Object3D): StreetPole[] {
  return (root.userData["poles"] as StreetPole[] | undefined) ?? [];
}
