import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "./repo.ts";

export interface SpeedDreams {
  HEAPF64: Float64Array;
  HEAPF32: Float32Array;
  cwrap: (
    name: string,
    result: string,
    args: string[],
  ) => (...values: (string | number)[]) => number;
  _malloc: (size: number) => number;
  _sdStep: (count: number) => void;
  _sdTelemetry: (pointer: number) => void;
  _sdAudio: (pointer: number) => void;
  _sdFrame: () => number;
  _sdHudInfo: (pointer: number) => void;
  _sdTrackLocal2Global: (d: number, l: number, out: number) => number;
  _sdInputSpeedLimit: (limit: number) => void;
  _sdInputSteerDirect: (on: number) => void;
  _sdInputPitHold: (on: number) => void;
  _sdPitService: (fuel: number, frontWing: number) => void;
  _sdInputAnalog: (
    active: number,
    steer: number,
    throttle: number,
    brake: number,
  ) => void;
}

export const wasm = path.join(repoRoot, "apps/client/wasm/speed-dreams.js");

const trackFiles: Record<string, [string, string][]> = {
  "hill-country": [
    [
      "content/tracks/hill-country/hill-country.xml",
      "tracks/circuit/hill-country/hill-country.xml",
    ],
    [
      "apps/client/wasm/hill-country-ai.txt",
      "tracks/circuit/hill-country/ai.dat",
    ],
  ],
  "neon-boulevard": [
    [
      "content/tracks/neon-boulevard/neon-boulevard.xml",
      "tracks/circuit/neon-boulevard/neon-boulevard.xml",
    ],
    [
      "apps/client/wasm/neon-boulevard-ai.txt",
      "tracks/circuit/neon-boulevard/ai.dat",
    ],
  ],
};

interface Files {
  FS: {
    mkdirTree: (path: string) => void;
    writeFile: (path: string, data: Uint8Array) => void;
  };
}

function installTrack(m: Files, track: string): void {
  for (const [from, to] of trackFiles[track] ?? []) {
    const target = `/sd/data/${to}`;
    m.FS.mkdirTree(target.slice(0, target.lastIndexOf("/")));
    m.FS.writeFile(target, readFileSync(path.join(repoRoot, from)));
  }
}

export async function startCircuit<M extends SpeedDreams = SpeedDreams>(
  prepare?: (module: M) => void,
  track = "hill-country",
): Promise<M> {
  const url = pathToFileURL(wasm).href;
  const loaded = (await import(url)) as {
    default: (options: object) => Promise<M>;
  };
  const m = await loaded.default({
    print: () => undefined,
    printErr: () => undefined,
  });
  prepare?.(m);
  installTrack(m as unknown as Files, track);
  m.cwrap("sdInit", "number", [
    "string",
    "string",
    "string",
    "string",
    "number",
  ])("circuit", track, "config/raceman/quickrace.xml", "revracer-26", 0);
  return m;
}
