import wasmUrl from "../../wasm/speed-dreams.wasm?url";
import { carFile, defaultTeam, liteCarFiles } from "./car-files.ts";
import { circuitFiles, circuitOf, trainingGround } from "./circuits.ts";
import { fetchEarly } from "./early.ts";
import { trainingTextures } from "./training-files.ts";

function stored(store: Storage, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function schoolAhead(params: URLSearchParams): boolean {
  return (
    (stored(localStorage, "revracers.tutorial") === null &&
      stored(localStorage, "revracers.player") === null) ||
    params.has("tutorial") ||
    stored(sessionStorage, "revracers.tutorialRun") === "1"
  );
}

function savedCar(): unknown {
  try {
    const settings: unknown = JSON.parse(
      stored(localStorage, "revracers.settings") ?? "{}",
    );
    return typeof settings === "object" && settings !== null
      ? (settings as { car?: unknown }).car
      : undefined;
  } catch {
    return undefined;
  }
}

function teamOf(params: URLSearchParams): string {
  const wanted = params.get("team") ?? savedCar();
  if (typeof wanted !== "string") return defaultTeam;
  try {
    carFile(wanted, "lite/car.bin");
    return wanted;
  } catch {
    return defaultTeam;
  }
}

export function schoolFirst(): boolean {
  const params = new URLSearchParams(location.search);
  return schoolAhead(params) && !params.has("autostart");
}

export function fetchSchoolEarly(): void {
  if (!schoolFirst()) return;
  const params = new URLSearchParams(location.search);
  const car = liteCarFiles(teamOf(params));
  const geometry = car.filter((url) => url.endsWith(".bin"));
  fetchEarly([wasmUrl, ...circuitFiles(circuitOf(trainingGround))], geometry, [
    ...trainingTextures,
    ...car.filter((url) => !geometry.includes(url)),
  ]);
}
