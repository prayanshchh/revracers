import * as THREE from "three/webgpu";
import {
  float,
  floor,
  fract,
  fwidth,
  length,
  max,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  positionWorld,
  sin,
  smoothstep,
  step,
  texture,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import gravelUrl from "../../../../content/tracks/hill-country/textures/baked/gravel_base_color.jpg?url";
import gravelHeightUrl from "../../../../content/tracks/hill-country/textures/source/gravel_floor_height.jpg?url";
import { releaseOnceUploaded } from "./preload.ts";
import { gravelBed, type GravelMaps } from "./track-surface.ts";

type Node = THREE.Node<"float">;
type Node3 = THREE.Node<"vec3">;
type Rgb = [number, number, number];

export const surfaceFiles = [gravelUrl, gravelHeightUrl];

export interface GroundMaps {
  a: THREE.Texture;
  b: THREE.Texture;
  grain: THREE.Texture;
  streaks: THREE.Texture;
}

const apronStep = 0.5;
const apronReach = 64;
const apronFold = 5429;
const apronEdge = 0.02;
const sectorBlend = 4;
const asphaltColour: Rgb = [0.05, 0.052, 0.05];
const whiteColour: Rgb = [0.55, 0.55, 0.54];
const orange: Rgb = [0.4, 0.092, 0.012];
const blue: Rgb = [0.008, 0.1, 0.37];
const red: Rgb = [0.43, 0.002, 0.0135];
const maroon: Rgb = [0.075, 0.001, 0.024];
type Sector = [number, Rgb];
const leftSectors: Sector[] = [
  [990, orange],
  [2110, blue],
  [3790, red],
  [5110, maroon],
];
const rightSectors: Sector[] = [
  [780, orange],
  [2110, blue],
  [3790, red],
  [5040, maroon],
];
const padCell = 1.6;
const padSlant = 2;
const padStroke = 9;
const padDash = 0.2;
const padBreak = 0.35;
const padHoles = 0.07;
const padPurple: Rgb = [0.19, 0.035, 0.3];
const padMagenta: Rgb = [0.62, 0.012, 0.23];
const padTeal: Rgb = [0.05, 0.48, 0.52];
const grainTile = 3.1;
const grainMean = 0.0144;
const paintGrain = 0.32;
const asphaltGrain = 0.6;
const lineGrain = 0.18;
const rubberReach = 10;
const rubberShade = 0.82;
const gravelGrade: Rgb = [0.74, 0.74, 0.72];
const sandLight: Rgb = [0.84, 0.82, 0.67];
const sandDark: Rgb = [0.7, 0.68, 0.54];
const sandPatch = 0.03;
const sandGrain = 2.3;
const sandRipple = 0.07;
const scrubDense = 0.012;
const scrubLayers: [number, number, number][] = [
  [1.6, 0.55, 0.0],
  [2.9, 0.45, 7.7],
  [5.3, 0.35, 3.1],
];
const scrubDry: Rgb = [0.21, 0.165, 0.1];
const scrubDeep: Rgb = [0.1, 0.085, 0.055];
const scrubShare = 0.16;

function crisp(mask: Node): Node {
  const edge = fwidth(mask).max(apronEdge);
  return smoothstep(float(0.5).sub(edge), float(0.5).add(edge), mask);
}

function hash(x: Node, y: Node): Node {
  return fract(sin(x.mul(12.9898).add(y.mul(78.233))).mul(43758.5453));
}

function sectorColour(s: Node, sectors: Sector[]): Node3 {
  const last = sectors[sectors.length - 1];
  let colour: Node3 = vec3(...(last ? last[1] : [0, 0, 0]));
  for (const [from, rgb] of sectors)
    colour = mix(colour, vec3(...rgb), smoothstep(from - sectorBlend, from, s));
  return colour;
}

function mosaic(lateral: Node, s: Node): Node3 {
  const column = floor(lateral.div(padCell));
  const row = floor(s.div(padCell));
  const roll = hash(column, row);
  const slant = row.add(column.mul(padSlant));
  const dash = step(fract(slant.div(padStroke)), padDash).mul(
    step(padBreak, hash(floor(slant.div(padStroke)), floor(column.div(3)))),
  );
  const base = mix(vec3(...padPurple), vec3(...padMagenta), step(0.62, roll));
  const holed = mix(base, vec3(...asphaltColour), step(roll, padHoles));
  return mix(holed, vec3(...padTeal), dash);
}

function scrub(world: THREE.Node<"vec2">): Node {
  const clump = mx_fractal_noise_float(vec3(world.mul(scrubDense), 4.1), 3)
    .mul(0.5)
    .add(0.5);
  let cover: Node = float(0);
  for (const [size, keep, seed] of scrubLayers) {
    const at = world.div(size).add(seed);
    const cell = floor(at);
    const local = fract(at).sub(0.5);
    const jitter = vec2(
      hash(cell.x, cell.y.add(17)),
      hash(cell.x.add(31), cell.y),
    )
      .sub(0.5)
      .mul(0.55);
    const reach = mix(float(0.12), float(0.3), hash(cell.x.add(5), cell.y));
    const ragged = reach.mul(
      mx_noise_float(world.mul(4.2).add(seed)).mul(0.6).add(1),
    );
    const stretch = vec2(
      mix(float(0.7), float(1.3), hash(cell.x.add(9), cell.y.add(3))),
      1,
    );
    const near = length(local.sub(jitter).mul(stretch));
    const tuft = smoothstep(ragged, ragged.mul(0.55), near);
    const odds = clump.mul(keep).add(0.12);
    const present = step(hash(cell.x.add(53), cell.y.add(seed)), odds);
    const blur = fwidth(at.x).mul(2.2).clamp(0, 1);
    cover = max(cover, mix(tuft.mul(present), odds.mul(scrubShare), blur));
  }
  return cover;
}

function sand(): { colour: Node3; roughness: Node } {
  const world = positionWorld.xy;
  const patch = mx_fractal_noise_float(vec3(world.mul(sandPatch), 1.3), 3)
    .mul(0.5)
    .add(0.5);
  const grain = mx_noise_float(world.mul(sandGrain)).mul(0.06).add(1);
  const ripple = mx_noise_float(vec2(world.x.mul(0.08), world.y.mul(0.35)))
    .mul(sandRipple)
    .add(1);
  const base = mix(
    vec3(...sandDark),
    vec3(...sandLight),
    smoothstep(0.2, 0.8, patch),
  )
    .mul(grain)
    .mul(ripple);
  const tufts = scrub(world);
  const brush = mix(
    vec3(...scrubDry),
    vec3(...scrubDeep),
    mx_noise_float(world.mul(5.3)).mul(0.5).add(0.5),
  );
  return { colour: mix(base, brush, tufts), roughness: float(0.96) };
}

function folded(maps: GroundMaps): {
  a: THREE.Node<"vec4">;
  b: THREE.Node<"vec4">;
  lateral: Node;
  s: Node;
  within: Node;
} {
  const lateral = uv(1).x;
  const s = uv(1).y;
  const row = s.div(apronStep);
  const second = step(apronFold, row);
  const v = row.sub(second.mul(apronFold)).add(0.5).div(apronFold);
  const u = lateral
    .add(apronReach)
    .div(apronReach * 2)
    .clamp(0, 1)
    .add(second)
    .mul(0.5);
  const at = vec2(u, v);
  return {
    a: texture(maps.a, at),
    b: texture(maps.b, at),
    lateral,
    s,
    within: step(lateral.abs(), apronReach - 0.5),
  };
}

export function gravelMaps(
  anisotropy: number,
  streaks: THREE.Texture,
): GravelMaps {
  const load = (url: string, colour: boolean) => {
    const map = releaseOnceUploaded(new THREE.TextureLoader().load(url));
    map.flipY = false;
    map.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = anisotropy;
    return map;
  };
  return {
    albedo: load(gravelUrl, true),
    height: load(gravelHeightUrl, false),
    streaks,
  };
}

export function shadeDesertGround(
  made: THREE.MeshStandardNodeMaterial,
  maps: GroundMaps,
  gravel: GravelMaps,
): void {
  const { a, b, lateral, s, within } = folded(maps);
  const ground = sand();
  const tone = texture(maps.grain, positionWorld.xy.div(grainTile))
    .rgb.dot(vec3(1 / 3))
    .div(grainMean)
    .clamp(0.4, 1.8);
  const textured = (amount: number) => mix(float(1), tone, amount);
  const rubber = mix(
    float(rubberShade),
    float(1),
    smoothstep(7, rubberReach, lateral.abs()),
  );
  const bed = gravelBed(gravel, b.g.mul(within), lateral, s);
  let colour: Node3 = mix(
    ground.colour,
    bed.colour.mul(vec3(...gravelGrade)),
    bed.cover.mul(within),
  );
  let roughness: Node = mix(ground.roughness, bed.roughness, bed.cover);
  const layer = (mask: Node, paint: Node3, rough: number) => {
    const cover = crisp(mask).mul(within);
    colour = mix(colour, paint, cover);
    roughness = mix(roughness, float(rough), cover);
  };
  layer(a.b, vec3(...asphaltColour).mul(textured(asphaltGrain)), 0.86);
  const painted = mix(
    sectorColour(s, rightSectors),
    sectorColour(s, leftSectors),
    step(0, lateral),
  );
  layer(a.r, painted.mul(textured(paintGrain)).mul(rubber), 0.62);
  layer(b.r, mosaic(lateral, s).mul(textured(paintGrain)), 0.62);
  layer(a.g, vec3(...whiteColour).mul(textured(lineGrain)), 0.55);
  made.colorNode = colour;
  made.roughnessNode = roughness;
}
