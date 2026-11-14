import hillFrame from "../../../../content/tracks/hill-country/sd-frame.json?url";
import hillMap from "../../../../content/tracks/hill-country/circuit-map.json?url";
import hillLine from "../../../../content/tracks/hill-country/racing-line.json?url";
import hillTrack from "../../../../content/tracks/hill-country/track.json?url";
import hillTrees from "../../../../content/tracks/hill-country/trees.bin?url";
import hillXml from "../../../../content/tracks/hill-country/hill-country.xml?url";
import hillAi from "../../wasm/hill-country-ai.txt?url";
import boulevardFrame from "../../../../content/tracks/neon-boulevard/sd-frame.json?url";
import boulevardMap from "../../../../content/tracks/neon-boulevard/circuit-map.json?url";
import boulevardLine from "../../../../content/tracks/neon-boulevard/racing-line.json?url";
import boulevardTrack from "../../../../content/tracks/neon-boulevard/track.json?url";
import boulevardXml from "../../../../content/tracks/neon-boulevard/neon-boulevard.xml?url";
import boulevardCity from "../../../../content/tracks/neon-boulevard/city.json?url";
import boulevardAi from "../../wasm/neon-boulevard-ai.txt?url";
import duneFrame from "../../../../content/tracks/dune-bay/sd-frame.json?url";
import duneMap from "../../../../content/tracks/dune-bay/circuit-map.json?url";
import duneLine from "../../../../content/tracks/dune-bay/racing-line.json?url";
import duneTrack from "../../../../content/tracks/dune-bay/track.json?url";
import duneVenue from "../../../../content/tracks/dune-bay/venue.json?url";
import duneTrees from "../../../../content/tracks/dune-bay/trees.bin?url";
import duneXml from "../../../../content/tracks/dune-bay/dune-bay.xml?url";
import duneAi from "../../wasm/dune-bay-ai.txt?url";
import trainingFrame from "../../../../content/tracks/training-ground/sd-frame.json?url";
import trainingMap from "../../../../content/tracks/training-ground/circuit-map.json?url";
import trainingLine from "../../../../content/tracks/training-ground/racing-line.json?url";
import trainingTrack from "../../../../content/tracks/training-ground/track.json?url";
import trainingDome from "../../../../content/tracks/training-ground/sky/noon-dome.webp?url";
import trainingEnv from "../../../../content/tracks/training-ground/sky/noon-env.webp?url";
import trainingSky from "../../../../content/tracks/training-ground/sky/noon.json?url";
import type { Season } from "./scenery-look.ts";
import type { Species } from "./scenery-trees.ts";
import type { CompactSky } from "./skybox.ts";
import type { Lessons } from "./tutorial.ts";

interface EngineFile {
  path: string;
  url: string;
}

type CircuitGround = "glb" | "training" | "street" | "desert";

type Rgb = [number, number, number];

export interface NightLook {
  zenith: Rgb;
  horizon: Rgb;
  glow: Rgb;
  haze: Rgb;
  visibility: number;
  flood: number;
  tint: Rgb;
  dome: number;
  layer: number;
  glare?: number;
}

export interface Circuit {
  id: string;
  ground: CircuitGround;
  city: string | null;
  plan: string | null;
  engineFiles: EngineFile[];
  frame: string;
  map: string;
  racingLine: string;
  track: string;
  lessons: Lessons;
  sky: CompactSky | null;
  night: NightLook | null;
  venue: boolean;
  trees: string | null;
  flora?: Species[];
  mapHeading?: number;
  season: Season;
}

export const trainingGround = "training-ground";

const circuits: Circuit[] = [
  {
    id: "hill-country",
    ground: "glb",
    city: null,
    plan: null,
    engineFiles: [
      { path: "tracks/circuit/hill-country/hill-country.xml", url: hillXml },
      { path: "tracks/circuit/hill-country/ai.dat", url: hillAi },
    ],
    frame: hillFrame,
    map: hillMap,
    racingLine: hillLine,
    track: hillTrack,
    lessons: { brake: 1, boost: 11, camera: 12 },
    sky: null,
    night: null,
    venue: true,
    trees: hillTrees,
    season: "autumn",
  },
  {
    id: "neon-boulevard",
    ground: "street",
    city: boulevardCity,
    plan: null,
    engineFiles: [
      {
        path: "tracks/circuit/neon-boulevard/neon-boulevard.xml",
        url: boulevardXml,
      },
      { path: "tracks/circuit/neon-boulevard/ai.dat", url: boulevardAi },
    ],
    frame: boulevardFrame,
    map: boulevardMap,
    racingLine: boulevardLine,
    track: boulevardTrack,
    lessons: { brake: 1, boost: 12, camera: 13 },
    sky: null,
    night: {
      zenith: [0.012, 0.012, 0.013],
      horizon: [0.026, 0.024, 0.022],
      glow: [0.03, 0.026, 0.02],
      haze: [0.13, 0.124, 0.112],
      visibility: 1000,
      flood: 5.5,
      tint: [1, 0.99, 0.95],
      dome: 0.12,
      layer: 26,
    },
    venue: true,
    trees: null,
    season: "autumn",
  },
  {
    id: "dune-bay",
    ground: "desert",
    city: null,
    plan: duneVenue,
    engineFiles: [
      { path: "tracks/circuit/dune-bay/dune-bay.xml", url: duneXml },
      { path: "tracks/circuit/dune-bay/ai.dat", url: duneAi },
    ],
    frame: duneFrame,
    map: duneMap,
    racingLine: duneLine,
    track: duneTrack,
    lessons: { brake: 1, boost: 16, camera: 2 },
    sky: null,
    night: {
      zenith: [0.001, 0.001, 0.001],
      horizon: [0.002, 0.002, 0.002],
      glow: [0.003, 0.003, 0.003],
      haze: [0.004, 0.004, 0.004],
      visibility: 2600,
      flood: 1.3,
      tint: [1, 0.98, 0.95],
      dome: 0.01,
      layer: 22,
      glare: 0.9,
    },
    venue: true,
    trees: duneTrees,
    flora: ["palm", "shrub"],
    mapHeading: 180,
    season: "autumn",
  },
  {
    id: trainingGround,
    ground: "training",
    city: null,
    plan: null,
    engineFiles: [],
    frame: trainingFrame,
    map: trainingMap,
    racingLine: trainingLine,
    track: trainingTrack,
    lessons: { brake: 1, boost: 4, camera: 5 },
    sky: {
      name: "noon",
      dome: trainingDome,
      env: trainingEnv,
      meta: trainingSky,
    },
    night: null,
    venue: false,
    trees: null,
    season: "summer",
  },
];

export function venues(): Circuit[] {
  return circuits.filter((circuit) => circuit.venue);
}

export function circuitOf(id: string): Circuit {
  const circuit = circuits.find((c) => c.id === id) ?? circuits[0];
  if (!circuit) throw new Error("no circuits defined");
  return circuit;
}

export function engineDownloads(circuit: Circuit): string[] {
  return circuit.engineFiles.map((file) => file.url);
}

export function circuitFiles(circuit: Circuit): string[] {
  const sky = circuit.sky
    ? [circuit.sky.dome, circuit.sky.env, circuit.sky.meta]
    : [];
  return [
    circuit.frame,
    circuit.map,
    circuit.racingLine,
    circuit.track,
    ...(circuit.city ? [circuit.city] : []),
    ...(circuit.plan ? [circuit.plan] : []),
    ...sky,
  ];
}
