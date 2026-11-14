import * as THREE from "three/webgpu";
import {
  exp,
  float,
  floor,
  fract,
  mix,
  mx_noise_float,
  positionWorld,
  sin,
  smoothstep,
  step,
  texture,
  uv,
  vec3,
} from "three/tsl";
import apronAUrl from "../../../../content/tracks/dune-bay/textures/apron_a.png?url";
import apronBUrl from "../../../../content/tracks/dune-bay/textures/apron_b.png?url";
import { releaseOnceUploaded } from "./preload.ts";
import { SkyLitMaterial } from "./sky-ambient.ts";
import { cityGlow } from "./street-city.ts";
import type { SkyRadiance } from "./road.ts";
import { bakedGround, loadMaps, meshOf, sources } from "./training-ground.ts";
import type { LinePath } from "./training-layout.ts";
import type { StreetTrack } from "./street-layout.ts";
import { type DesertVenue, desertParts } from "./desert-layout.ts";
import { desertLandmarks } from "./desert-landmarks.ts";
import {
  gravelMaps,
  shadeDesertGround,
  surfaceFiles,
} from "./desert-surface.ts";
import { lotBay, lotModule } from "./desert-lots.ts";
import {
  decorations,
  materialPicker,
  streetFiles,
  streetSources,
} from "./street-ground.ts";
import type { KerbPaint } from "./track-surface.ts";

export const desertFiles = [
  ...streetFiles,
  ...surfaceFiles,
  apronAUrl,
  apronBUrl,
];

const roadTone: [number, number, number] = [0.32, 0.36, 0.37];

const serviceWindow: [number, number, number] = [0.32, 0.25, 0.17];
const lawnTint: [number, number, number] = [0.3, 0.44, 0.22];
const storey = 3.6;
const washReach = 3.5;
const washGlow = 0.05;
const bayWidth = 2.8;
const downlightEvery = 2.6;
const downlightShare = 0.14;
const downlightPeak = 7;
const sandColour = new THREE.Color(0.26, 0.235, 0.16);
const sandRoughness = 0.96;
const kerbPaint: KerbPaint = {
  red: [0.05, 0.003, 0.013],
  white: [0.51, 0.51, 0.5],
};

function downlightMaterial(): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const lamp = step(fract(uv().x.div(downlightEvery)), downlightShare);
  material.colorNode = vec3(1, 0.96, 0.9).mul(
    cityGlow.mul(downlightPeak).mul(lamp).add(0.05),
  );
  return material;
}

function facadeMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new SkyLitMaterial({ side: THREE.DoubleSide });
  const u = uv().x;
  const h = uv().y;
  const level = fract(h.div(storey));
  const pane = fract(u.div(bayWidth));
  const cell = floor(u.div(bayWidth)).add(floor(h.div(storey)).mul(97.13));
  const roll = fract(sin(cell.mul(12.9898)).mul(43758.5453));
  const glazed = step(0.32, level)
    .mul(step(level, 0.74))
    .mul(step(0.16, pane))
    .mul(step(pane, 0.84))
    .mul(step(1.2, h));
  const lit = step(0.7, roll).mul(roll.mul(0.5).add(0.25));
  const grime = mx_noise_float(positionWorld.mul(0.35)).mul(0.06).add(1);
  const render = vec3(0.6, 0.56, 0.48).mul(grime);
  material.colorNode = mix(render, vec3(0.035, 0.045, 0.055), glazed);
  material.roughnessNode = mix(float(0.88), float(0.15), glazed);
  const wash = exp(h.max(0).div(-washReach)).mul(float(1).sub(glazed));
  material.emissiveNode = vec3(1, 0.8, 0.56)
    .mul(glazed.mul(lit).add(wash.mul(washGlow)))
    .mul(cityGlow);
  return material;
}

function lotMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new SkyLitMaterial({ side: THREE.DoubleSide });
  const along = uv().x;
  const across = uv().y;
  const row = fract(across.div(lotModule)).mul(lotModule);
  const inRow = step(0.4, row)
    .mul(step(row, 4.8))
    .add(step(11.2, row).mul(step(row, 15.6)));
  const bay = fract(along.div(lotBay));
  const line = float(1)
    .sub(smoothstep(0.02, 0.05, bay.min(float(1).sub(bay))))
    .mul(inRow);
  material.colorNode = mix(
    vec3(0.05, 0.05, 0.048),
    vec3(0.34, 0.34, 0.33),
    line,
  );
  material.roughnessNode = float(0.85);
  return material;
}

function roadMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new SkyLitMaterial({ side: THREE.DoubleSide });
  const along = uv().x;
  const across = uv().y;
  const edge = smoothstep(0.88, 0.92, across.abs()).mul(
    float(1).sub(smoothstep(0.96, 0.99, across.abs())),
  );
  const dash = step(fract(along.div(9)), 0.45).mul(
    float(1).sub(smoothstep(0.015, 0.03, across.abs())),
  );
  const grime = mx_noise_float(positionWorld.mul(0.6)).mul(0.08).add(1);
  const paint = edge.add(dash).clamp(0, 1);
  material.colorNode = mix(
    vec3(0.05, 0.05, 0.048).mul(grime),
    vec3(0.3, 0.3, 0.29),
    paint,
  );
  material.roughnessNode = float(0.85);
  return material;
}

function lawnMaterial(grass: THREE.Texture): THREE.MeshStandardNodeMaterial {
  const material = new SkyLitMaterial({ side: THREE.DoubleSide });
  const blades = texture(grass, uv()).rgb;
  const patch = mx_noise_float(positionWorld.mul(0.08)).mul(0.18).add(1);
  material.colorNode = blades.mul(vec3(...lawnTint)).mul(patch);
  material.roughnessNode = float(0.92);
  return material;
}

function sandMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    name: "track desert sand",
    color: sandColour,
    roughness: sandRoughness,
  });
}

function apronMap(url: string): THREE.Texture {
  const map = releaseOnceUploaded(new THREE.TextureLoader().load(url));
  map.flipY = false;
  map.colorSpace = THREE.NoColorSpace;
  map.wrapS = THREE.ClampToEdgeWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.anisotropy = 8;
  return map;
}

export async function buildDesertCircuit(
  track: StreetTrack,
  line: LinePath | null,
  venue: DesertVenue,
  anisotropy: number,
  skyLoad: Promise<SkyRadiance | null>,
  after: Promise<unknown>,
): Promise<THREE.Object3D> {
  const maps = loadMaps(anisotropy, after);
  const byName: Record<string, THREE.MeshStandardMaterial> = {
    ...sources(maps),
    ...streetSources(maps, anisotropy),
    "track desert sand": sandMaterial(),
    "track prop crane": new THREE.MeshStandardMaterial({
      name: "track prop crane",
      color: new THREE.Color(0.78, 0.55, 0.05),
      roughness: 0.45,
      metalness: 0.3,
    }),
    "track prop dark": new THREE.MeshStandardMaterial({
      name: "track prop dark",
      color: new THREE.Color(0.03, 0.03, 0.031),
      roughness: 0.6,
    }),
    "track service white": new THREE.MeshStandardMaterial({
      name: "track service white",
      color: new THREE.Color(0.78, 0.79, 0.8),
      roughness: 0.45,
      metalness: 0.1,
    }),
    "track service glass": new THREE.MeshStandardMaterial({
      name: "track service glass",
      color: new THREE.Color(0.03, 0.035, 0.04),
      roughness: 0.1,
      metalness: 0.5,
    }),
    "track service blue": new THREE.MeshStandardMaterial({
      name: "track service blue",
      color: new THREE.Color(0.04, 0.1, 0.26),
      roughness: 0.6,
      metalness: 0.2,
    }),
    "track bollard orange": new THREE.MeshStandardMaterial({
      name: "track bollard orange",
      color: new THREE.Color(0.85, 0.22, 0.02),
      roughness: 0.5,
    }),
    "track marquee red": new THREE.MeshStandardMaterial({
      name: "track marquee red",
      color: new THREE.Color(0.42, 0.025, 0.03),
      roughness: 0.75,
    }),
    "track stand canopy": new THREE.MeshStandardMaterial({
      name: "track stand canopy",
      color: new THREE.Color(0.8, 0.81, 0.83),
      roughness: 0.5,
      metalness: 0.2,
    }),
  };
  const kerb = byName["track road kerb"];
  if (kerb) kerb.userData["kerb"] = kerbPaint;
  const ground = {
    a: apronMap(apronAUrl),
    b: apronMap(apronBUrl),
    grain: maps.asphalt,
    streaks: maps.streaks,
  };
  const gravel = gravelMaps(anisotropy, maps.streaks);
  const sky = await skyLoad;
  const materialOf = materialPicker(
    byName,
    (made, source) => {
      if (source.name === "track desert sand")
        shadeDesertGround(made, ground, gravel);
      else if (source.name === "track road asphalt") {
        if (made.colorNode)
          made.colorNode = (made.colorNode as THREE.Node<"vec3">).mul(
            vec3(...roadTone),
          );
      } else if (source.name === "track service glass") {
        made.emissiveNode = vec3(...serviceWindow).mul(cityGlow);
      } else decorations[source.name]?.(made, source);
    },
    {
      anisotropy,
      baked: bakedGround(maps),
      sky,
      special: {
        "track stand lights": downlightMaterial(),
        "track scenery facade": facadeMaterial(),
        "track lot asphalt": lotMaterial(),
        "track service road": roadMaterial(),
        "track desert lawn": lawnMaterial(maps.grass),
      },
    },
  );
  const root = new THREE.Group();
  root.name = "desert circuit";
  const { parts, crew, cars, lamps } = desertParts(track, line, venue);
  for (const part of parts)
    if (part.index.length > 0)
      root.add(meshOf(part, materialOf(part.material)));
  root.add(desertLandmarks(venue.landmarks, track.centerline[0]?.y ?? 0));
  root.userData["poles"] = [];
  root.userData["lamps"] = lamps;
  root.userData["crew"] = crew;
  root.userData["lap"] = track.length;
  root.userData["cars"] = cars;
  return root;
}
