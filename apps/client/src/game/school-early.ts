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

function teamOf(params: URLSearchParams): string {
  const settings = JSON.parse(
    stored(localStorage, "revracers.settings") ?? "{}",
  ) as { car?: unknown };
  const wanted = params.get("team") ?? settings.car;
  if (typeof wanted !== "string") return defaultTeam;
  try {
    carFile(wanted, "lite/car.bin");
    return wanted;
  } catch {
    return defaultTeam;
  }
}

export function fetchSchoolEarly(): void {
  const params = new URLSearchParams(location.search);
  if (!schoolAhead(params) || params.has("autostart")) return;
  const car = liteCarFiles(teamOf(params));
  const geometry = car.filter((url) => url.endsWith(".bin"));
  fetchEarly([wasmUrl, ...circuitFiles(circuitOf(trainingGround))], geometry, [
    ...trainingTextures,
    ...car.filter((url) => !geometry.includes(url)),
  ]);
}
