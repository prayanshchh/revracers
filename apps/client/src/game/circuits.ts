import hillFrame from "../../../../content/tracks/hill-country/sd-frame.json?url";
import hillMap from "../../../../content/tracks/hill-country/circuit-map.json?url";
import hillLine from "../../../../content/tracks/hill-country/racing-line.json?url";
import hillTrack from "../../../../content/tracks/hill-country/track.json?url";
import hillXml from "../../../../content/tracks/hill-country/hill-country.xml?url";
import hillAi from "../../wasm/hill-country-ai.txt?url";
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

export interface Circuit {
  id: string;
  engineFiles: EngineFile[];
  frame: string;
  map: string;
  racingLine: string;
  track: string;
  lessons: Lessons;
  sky: CompactSky | null;
  venue: boolean;
}

export const trainingGround = "training-ground";

const circuits: Circuit[] = [
  {
    id: "hill-country",
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
    venue: true,
  },
  {
    id: trainingGround,
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
    ...sky,
  ];
}
