import { warm } from "./asset-store.ts";
import { circuitOf, engineDownloads, venues } from "./circuits.ts";
import { startHour } from "./event-art.ts";
import type { WebGPURenderer } from "three/webgpu";
import { forgetPrimed } from "./prime.ts";
import { raceFiles, sceneFiles } from "./race-files.ts";
import { groundPrimes, primeGround } from "./scene.ts";
import { carOf, type Settings, tracks } from "./settings.ts";
import {
  primeSky,
  skyDownloads,
  skyFor,
  skyNames,
  skyPrimes,
} from "./skybox.ts";
import { musicFiles } from "./sound/music.ts";
import { upgradeAll, upgradeFiles } from "./upgrades.ts";

function skyOf(settings: Settings, trackHour: number, now: Date): string[] {
  const hour = startHour(settings.timeOfDay, trackHour, now);
  return hour === null ? skyDownloads(["circuit"]) : skyFor(hour);
}

export function eventFiles(settings: Settings, now = new Date()): string[] {
  const track = tracks.find((each) => each.id === settings.track);
  if (!track) return [];
  return [
    ...raceFiles(circuitOf(track.id), carOf(settings).id, []),
    ...skyOf(settings, track.hour, now),
  ];
}

export function loadingFiles(settings: Settings, now = new Date()): string[] {
  const track = tracks.find((each) => each.id === settings.track);
  if (!track) return [];
  const circuit = circuitOf(track.id);
  const hour = startHour(settings.timeOfDay, track.hour, now);
  const skyKnown = hour !== null && settings.timeOfDay !== "now";
  return [
    ...engineDownloads(circuit),
    ...sceneFiles(circuit, carOf(settings).id, []),
    ...(skyKnown ? skyFor(hour) : []),
  ];
}

function everyRace(team: string): string[] {
  return [
    ...venues().flatMap((circuit) => raceFiles(circuit, team, [])),
    ...skyDownloads(["circuit"]),
    ...musicFiles(),
    ...skyDownloads([...skyNames]),
  ];
}

export type EventStep = "hub" | "circuits" | "conditions" | "settings";

export function warmEvent(settings: Settings): void {
  warm(eventFiles(settings), true);
}

export function dropPrimes(): void {
  forgetPrimed(() => false);
}

export function primeEvent(
  renderer: WebGPURenderer,
  settings: Settings,
  step: EventStep,
): void {
  const track = tracks.find((each) => each.id === settings.track);
  if (!track || step === "hub" || step === "circuits") return;
  const circuit = circuitOf(track.id);
  const hour = startHour(settings.timeOfDay, track.hour, new Date());
  const sky = step === "settings" && hour !== null;
  const wanted = new Set([
    ...groundPrimes(circuit),
    ...(sky ? skyPrimes(hour) : []),
  ]);
  forgetPrimed((key) => wanted.has(key));
  primeGround(renderer, circuit);
  if (sky) primeSky(hour);
}

export async function warmGame(
  settings: Settings,
  upgraded: () => void,
): Promise<void> {
  const files = [
    ...upgradeFiles(),
    ...eventFiles(settings),
    ...everyRace(carOf(settings).id),
  ];
  if ((await upgradeAll()) > 0) upgraded();
  warm(files);
}
