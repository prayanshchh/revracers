import wasmUrl from "../../wasm/speed-dreams.wasm?url";
import { carFile, defaultTeam, liteCarFiles } from "./car-files.ts";
import { circuitFiles, circuitOf, trainingGround } from "./circuits.ts";
import { fetchEarly } from "./early.ts";
import { trainingTextures } from "./training-files.ts";

const openingKey = "revracers.introPlayed";

function stored(store: Storage, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function storedObject(key: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(stored(localStorage, key) ?? "null");
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function remember(key: string): void {
  try {
    sessionStorage.setItem(key, "1");
  } catch {
    return;
  }
}

function newcomer(): boolean {
  return (
    stored(localStorage, "revracers.tutorial") === null &&
    (stored(localStorage, "revracers.player") === null ||
      storedObject("revracers.driver")["onboarded"] === false)
  );
}

function schoolAhead(params: URLSearchParams): boolean {
  return (
    newcomer() ||
    params.has("tutorial") ||
    stored(sessionStorage, "revracers.tutorialRun") === "1"
  );
}

function teamOf(params: URLSearchParams): string {
  const wanted =
    params.get("team") ?? storedObject("revracers.settings")["car"];
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

export function openingShow(): boolean {
  const params = new URLSearchParams(location.search);
  const school = schoolAhead(params);
  const show =
    !school &&
    stored(sessionStorage, openingKey) !== "1" &&
    stored(sessionStorage, "revracers.autostart") !== "1" &&
    !params.has("autostart") &&
    params.get("intro") !== "off" &&
    "gpu" in navigator;
  if (school) remember(openingKey);
  return show;
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
