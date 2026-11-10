import hillFrame from "../../../../content/tracks/hill-country/sd-frame.json?url";
import hillMap from "../../../../content/tracks/hill-country/circuit-map.json?url";
import hillLine from "../../../../content/tracks/hill-country/racing-line.json?url";
import hillTrack from "../../../../content/tracks/hill-country/track.json?url";
import hillXml from "../../../../content/tracks/hill-country/hill-country.xml?url";
import hillAi from "../../wasm/hill-country-ai.txt?url";
import boulevardFrame from "../../../../content/tracks/neon-boulevard/sd-frame.json?url";
import boulevardMap from "../../../../content/tracks/neon-boulevard/circuit-map.json?url";
import boulevardLine from "../../../../content/tracks/neon-boulevard/racing-line.json?url";
import boulevardTrack from "../../../../content/tracks/neon-boulevard/track.json?url";
import boulevardXml from "../../../../content/tracks/neon-boulevard/neon-boulevard.xml?url";
import boulevardCity from "../../../../content/tracks/neon-boulevard/city.json?url";
import boulevardAi from "../../wasm/neon-boulevard-ai.txt?url";
import trainingFrame from "../../../../content/tracks/training-ground/sd-frame.json?url";
import trainingMap from "../../../../content/tracks/training-ground/circuit-map.json?url";
import trainingLine from "../../../../content/tracks/training-ground/racing-line.json?url";
import trainingTrack from "../../../../content/tracks/training-ground/track.json?url";
import trainingDome from "../../../../content/tracks/training-ground/sky/noon-dome.webp?url";
import trainingEnv from "../../../../content/tracks/training-ground/sky/noon-env.webp?url";
import trainingSky from "../../../../content/tracks/training-ground/sky/noon.json?url";
import type { CompactSky } from "./skybox.ts";
import type { Lessons } from "./tutorial.ts";

interface EngineFile {
  path: string;
  url: string;
}

type CircuitGround = "glb" | "training" | "street";

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
}

export interface Circuit {
  id: string;
  ground: CircuitGround;
  city: string | null;
  engineFiles: EngineFile[];
  frame: string;
  map: string;
  racingLine: string;
  track: string;
  lessons: Lessons;
  sky: CompactSky | null;
  night: NightLook | null;
  venue: boolean;
}

export const trainingGround = "training-ground";

const circuits: Circuit[] = [
  {
    id: "hill-country",
    ground: "glb",
    city: null,
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
  },
  {
    id: "neon-boulevard",
    ground: "street",
    city: boulevardCity,
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
      tint: [1, 0.98, 0.89],
      dome: 0.12,
      layer: 26,
    },
    venue: true,
  },
  {
    id: trainingGround,
    ground: "training",
    city: null,
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
  },
];

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
    ...sky,
  ];
}
