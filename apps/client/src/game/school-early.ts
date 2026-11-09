import wasmUrl from "../../wasm/speed-dreams.wasm?url";
import { currentDriver, type Driver } from "./api.ts";
import { carFile, defaultTeam, liteCarFiles } from "./car-files.ts";
import { circuitFiles, circuitOf, trainingGround } from "./circuits.ts";
import { fetchEarly } from "./early.ts";
import { showStill } from "./school-still.ts";
import { openAudio } from "./sound/open-audio.ts";
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

let ahead: boolean | null = null;
let driver: Promise<Driver | null> | null = null;
let fresh = false;
let audio: AudioContext | null = null;

function schoolAhead(params: URLSearchParams): boolean {
  ahead ??=
    newcomer() ||
    params.has("tutorial") ||
    stored(sessionStorage, "revracers.tutorialRun") === "1";
  return ahead;
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

export function schoolDriver(): Promise<Driver | null> | null {
  return driver;
}

export function freshPlayer(): boolean {
  return fresh;
}

export function gameAudio(): AudioContext {
  audio ??= openAudio();
  return audio;
}

export function fetchSchoolEarly(): void {
  if (!schoolFirst()) return;
  fresh = stored(localStorage, "revracers.player") === null;
  driver = currentDriver();
  if ("requestIdleCallback" in globalThis)
    requestIdleCallback(gameAudio, { timeout: 1000 });
  else setTimeout(gameAudio, 300);
  const params = new URLSearchParams(location.search);
  const team = teamOf(params);
  if (team === defaultTeam) showStill();
  const car = liteCarFiles(team);
  const geometry = car.filter((url) => url.endsWith(".bin"));
  fetchEarly([wasmUrl, ...circuitFiles(circuitOf(trainingGround))], geometry, [
    ...trainingTextures,
    ...car.filter((url) => !geometry.includes(url)),
  ]);
}
