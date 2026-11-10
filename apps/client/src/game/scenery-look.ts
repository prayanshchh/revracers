import * as THREE from "three/webgpu";
import { float, positionWorld, smoothstep, texture, uniform } from "three/tsl";

export type Season = "spring" | "summer" | "autumn" | "winter";

interface SeasonLook {
  turf: [number, number, number];
  dryness: number;
  foliage: [number, number, number];
  turning: number;
  turned: [number, number, number];
}

const looks: Record<Season, SeasonLook> = {
  spring: {
    turf: [0.84, 1.06, 0.9],
    dryness: 0.2,
    foliage: [0.9, 1.08, 0.86],
    turning: 0,
    turned: [1, 1, 1],
  },
  summer: {
    turf: [0.96, 1.0, 0.94],
    dryness: 0.8,
    foliage: [0.98, 1.0, 0.9],
    turning: 0.03,
    turned: [1.45, 1.1, 0.5],
  },
  autumn: {
    turf: [0.9, 1.0, 0.96],
    dryness: 0.62,
    foliage: [1, 1, 0.94],
    turning: 0.08,
    turned: [1.7, 1.12, 0.45],
  },
  winter: {
    turf: [1.12, 1.0, 0.78],
    dryness: 1,
    foliage: [0.9, 0.86, 0.74],
    turning: 0.4,
    turned: [1.25, 0.92, 0.55],
  },
};

const seasonsByMonth: Season[] = [
  "winter",
  "winter",
  "spring",
  "spring",
  "spring",
  "summer",
  "summer",
  "summer",
  "autumn",
  "autumn",
  "autumn",
  "winter",
];

export const turfTint = uniform(new THREE.Color(...looks.autumn.turf));
export const turfDryness = uniform(looks.autumn.dryness);
export const foliageTint = uniform(new THREE.Color(...looks.autumn.foliage));
export const foliageTurning = uniform(looks.autumn.turning);
export const foliageTurned = uniform(new THREE.Color(...looks.autumn.turned));

export function seasonOf(
  choice: string,
  venue: Season,
  month = new Date().getMonth(),
  southern = false,
): Season {
  if (choice in looks) return choice as Season;
  if (choice !== "now") return venue;
  return seasonsByMonth[(month + (southern ? 6 : 0)) % 12] ?? venue;
}

export function useSeason(season: Season): void {
  const look = looks[season];
  turfTint.value.setRGB(...look.turf);
  turfDryness.value = look.dryness;
  foliageTint.value.setRGB(...look.foliage);
  foliageTurning.value = look.turning;
  foliageTurned.value.setRGB(...look.turned);
}

const noiseSize = 128;
const noiseCells = 9;
const cloudTile = 1500;
const cloudDetailTile = 410;
const cloudDetail = 0.14;
const cloudEdge = 0.07;
const cloudDepth = 0.6;
const cloudDrift = new THREE.Vector2(6.5, 2.2);
const cloudShareOfCover = 0.8;

function smoothNoise(seed: number): Float32Array {
  let state = seed;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const lattice = Float32Array.from(
    { length: noiseCells * noiseCells },
    random,
  );
  const at = (x: number, y: number) =>
    lattice[(y % noiseCells) * noiseCells + (x % noiseCells)] ?? 0;
  const field = new Float32Array(noiseSize * noiseSize);
  for (let row = 0; row < noiseSize; row++)
    for (let column = 0; column < noiseSize; column++) {
      const x = (column / noiseSize) * noiseCells;
      const y = (row / noiseSize) * noiseCells;
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const fx = THREE.MathUtils.smootherstep(x - ix, 0, 1);
      const fy = THREE.MathUtils.smootherstep(y - iy, 0, 1);
      const top = at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx;
      const bottom = at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx;
      field[row * noiseSize + column] = top * (1 - fy) + bottom * fy;
    }
  return field;
}

function ranked(field: Float32Array): Uint8Array {
  const order = Array.from(field.keys()).sort(
    (a, b) => (field[a] ?? 0) - (field[b] ?? 0),
  );
  const out = new Uint8Array(field.length);
  order.forEach((index, rank) => {
    out[index] = Math.round((rank / (field.length - 1)) * 255);
  });
  return out;
}

function noiseMap(): THREE.DataTexture {
  const map = new THREE.DataTexture(
    ranked(smoothNoise(20261110)),
    noiseSize,
    noiseSize,
    THREE.RedFormat,
    THREE.UnsignedByteType,
  );
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.colorSpace = THREE.NoColorSpace;
  map.needsUpdate = true;
  return map;
}

const cloudShare = uniform(0);
const cloudOffset = uniform(new THREE.Vector2());
let cloudField: THREE.DataTexture | null = null;

export function cloudShade(): THREE.Node<"float"> {
  cloudField ??= noiseMap();
  const at = positionWorld.xy.add(cloudOffset);
  const mass = texture(cloudField, at.div(cloudTile)).r;
  const detail = texture(cloudField, at.div(cloudDetailTile)).r;
  const field = mass.add(detail.sub(0.5).mul(cloudDetail));
  const clear = float(1).sub(cloudShare);
  const cover = smoothstep(clear.sub(cloudEdge), clear.add(cloudEdge), field);
  return float(1).sub(
    cover.mul(cloudDepth).mul(smoothstep(0, 0.05, cloudShare)),
  );
}

export function setCloudShadows(cover: number, time: number): void {
  cloudShare.value = Math.min(1, Math.max(0, cover)) * cloudShareOfCover;
  cloudOffset.value.copy(cloudDrift).multiplyScalar(time);
}
