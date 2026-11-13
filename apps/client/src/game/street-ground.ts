import * as THREE from "three/webgpu";
import {
  dot,
  exp,
  float,
  floor,
  fract,
  fwidth,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  normalViewGeometry,
  positionViewDirection,
  sin,
  smoothstep,
  step,
  texture,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import wrapsUrl from "../../../../content/tracks/neon-boulevard/textures/wraps.webp?url";
import fenceUrl from "../../../../content/tracks/neon-boulevard/textures/fence.webp?url";
import screensUrl from "../../../../content/tracks/neon-boulevard/textures/screens.webp?url";
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
import { entranceMesh } from "./street-entrances.ts";
import { buildLandmarks } from "./street-landmarks.ts";
import {
  garageInteriorMaterial,
  garageMaterial,
  hallMaterial,
  lightStripMaterial,
  pitKitMaterial,
  pitSignMaterial,
} from "./street-materials.ts";
import type { CrewSpot, GarageCar } from "./street-pit.ts";

export const streetFiles = [wrapsUrl, fenceUrl, screensUrl];

const lampColour = new THREE.Color(0.93, 0.96, 1);
const lampPeak = 55;
const fenceColour = new THREE.Color(0.8, 0.82, 0.85);
const fenceDensity = 0.86;
const fenceSpill = 0.24;
const steelSpill = 0.22;
const wrapGlow = 0.95;
const shaftRadius = 4.6;
const shaftStrength = 0.12;
const shaftTop = 0.2;
const shaftFade = 0.6;
const shaftSegments = 10;
const roofGlow = 0.2;
const roofSheet = 0.45;
const roofLap = 13;
const roadTile = 2;
const grimeAcross = 2;
const grimeAlong = 0.04;
const grimeStrength = 0.26;
const rubberReach = 3;
const rubberComb = 6;
const rubberRun = 0.012;
const rubberStreak = 0.32;
const rubberFilm = 0.16;
const laneWidth = 3.7;
const dripReach = 0.42;
const dripRun = 0.035;
const dripShade = 0.13;
const coverAcross = 4.6;
const coverAlong = 64;
const coverSpread = 0.7;
const coverShare = 0.45;
const coverRadius = 0.42;
const coverShade = 0.5;
const coverRim = 0.22;
const runoffPaint = new THREE.Color(0.17, 0.44, 0.31);
const runoffCover = 0.82;
const patchAcross = 0.165;
const patchAlong = 0.055;
const patchShade = 0.86;
const laneWear = new THREE.Color(0.36, 0.36, 0.35);
const roadTone = new THREE.Color(0.84, 0.86, 0.9);

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
      color: new THREE.Color(0.84, 0.85, 0.86),
      roughness: 0.5,
      metalness: 0.1,
    }),
    "track stand concrete": make("track stand concrete", {
      color: new THREE.Color(0.5, 0.5, 0.52),
      roughness: 0.9,
    }),
    "track stand aisle": make("track stand aisle", {
      color: new THREE.Color(0.6, 0.61, 0.63),
      roughness: 0.8,
    }),
    "track stand skirt": make("track stand skirt", {
      color: new THREE.Color(0.045, 0.047, 0.055),
      roughness: 0.92,
    }),
    "track stand roof": make("track stand roof", {
      color: new THREE.Color(0.82, 0.83, 0.85),
      roughness: 0.5,
      metalness: 0.2,
    }),
    "track pole steel": make("track pole steel", {
      color: new THREE.Color(0.52, 0.53, 0.54),
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
    if (made.colorNode)
      made.colorNode = made.colorNode
        .mul(streetGrime())
        .mul(vec3(roadTone.r, roadTone.g, roadTone.b));
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
    const sheet = uv().x.div(roofSheet);
    const ribs = sin(sheet.mul(Math.PI * 2))
      .mul(0.5)
      .add(0.5);
    const seen = float(1).sub(smoothstep(0.12, 0.5, fwidth(sheet)));
    const lap = smoothstep(0.03, 0, fract(sheet.div(roofLap)).sub(0.5).abs());
    const shade = mix(float(1), ribs.mul(0.34).add(0.7), seen).mul(
      lap.mul(seen).mul(0.3).oneMinus(),
    );
    const tone = vec3(source.color.r, source.color.g, source.color.b);
    made.colorNode = tone.mul(shade);
    made.emissiveNode = glowOf(source, roofGlow).mul(shade);
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

function cellRoll(cell: THREE.Node<"vec2">, salt: number): THREE.Node<"float"> {
  return fract(sin(cell.dot(vec2(12.9898, 78.233)).add(salt)).mul(43758.5453));
}

function laidRubber(
  across: THREE.Node<"float">,
  along: THREE.Node<"float">,
): THREE.Node<"float"> {
  const line = uv(1);
  const lane = exp(line.x.div(rubberReach).pow(2).negate());
  const combed = mx_fractal_noise_float(
    vec3(across.mul(rubberComb), along.mul(rubberRun), 3),
    2,
  );
  return lane
    .mul(line.y)
    .mul(smoothstep(-0.3, 0.4, combed).mul(rubberStreak).add(rubberFilm));
}

function drips(
  across: THREE.Node<"float">,
  along: THREE.Node<"float">,
): THREE.Node<"float"> {
  const centre = fract(across.div(laneWidth)).sub(0.5).abs().mul(laneWidth);
  const pooled = mx_noise_float(vec2(across.mul(0.4), along.mul(dripRun)))
    .mul(0.5)
    .add(0.5);
  return exp(centre.div(dripReach).pow(2).negate()).mul(pooled);
}

function manholes(
  across: THREE.Node<"float">,
  along: THREE.Node<"float">,
): THREE.Node<"float"> {
  const size = vec2(coverAcross, coverAlong);
  const at = vec2(across, along).div(size);
  const cell = floor(at);
  const centre = vec2(cellRoll(cell, 1.7), cellRoll(cell, 5.3))
    .sub(0.5)
    .mul(coverSpread);
  const reach = fract(at).sub(0.5).sub(centre).mul(size).length();
  const present = step(cellRoll(cell, 9.1), coverShare);
  const lid = smoothstep(coverRadius, coverRadius - 0.04, reach).mul(present);
  const rim = smoothstep(coverRadius * 0.72, coverRadius * 0.8, reach);
  return lid.mul(mix(float(coverShade), float(coverRim), rim));
}

function streetGrime(): THREE.Node<"float"> {
  const across = uv().x.mul(roadTile);
  const along = uv().y.mul(roadTile);
  const streaks = mx_fractal_noise_float(
    vec3(across.mul(grimeAcross), along.mul(grimeAlong), 0),
    3,
  );
  const patch = smoothstep(
    0.25,
    0.32,
    mx_fractal_noise_float(
      vec3(across.mul(patchAcross), along.mul(patchAlong), 7),
      2,
    ),
  );
  return float(1)
    .add(streaks.mul(grimeStrength))
    .mul(mix(float(1), float(patchShade), patch))
    .mul(float(1).sub(laidRubber(across, along)))
    .mul(float(1).sub(drips(across, along).mul(dripShade)))
    .mul(float(1).sub(manholes(across, along)));
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
  const screens = image(screensUrl, true, anisotropy);
  screens.wrapS = THREE.ClampToEdgeWrapping;
  screens.wrapT = THREE.ClampToEdgeWrapping;
  root.add(
    buildCity(city, screens),
    entranceMesh(city.entrances),
    buildLandmarks(city.landmarks, screens),
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
