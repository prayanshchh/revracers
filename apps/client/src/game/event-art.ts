import type { CircuitData } from "./circuit-map.ts";
import { circuitOf } from "./circuits.ts";
import { weatherOf } from "./settings.ts";

const pictures = import.meta.glob<string>(
  "../../../../content/tracks/*/menu/**/*.webp",
  { eager: true, query: "?url", import: "default" },
);

const stillTimes = [
  "dawn",
  "morning",
  "noon",
  "afternoon",
  "dusk",
  "night",
] as const;

export type StillTime = (typeof stillTimes)[number];

const stillSkies = [
  "clear",
  "light cloud",
  "overcast",
  "light rain",
  "heavy rain",
  "storm",
] as const;

export interface Look {
  time: StillTime;
  sky: string;
  second: string | null;
  random: boolean;
}

export interface Conditions {
  timeOfDay: string;
  clouds: string;
  rain: string;
}

const fixedHours: Record<string, number> = {
  dawn: 6 + 13 / 60 + 20 / 3600,
  morning: 10,
  noon: 12,
  afternoon: 15,
  dusk: 17 + 46 / 60 + 40 / 3600,
  night: 0,
};

const rainLevels: Record<string, number> = { little: 1, medium: 2, heavy: 3 };

export function startHour(
  timeOfDay: string,
  trackHour: number,
  now: Date,
): number | null {
  if (timeOfDay === "random") return null;
  if (timeOfDay === "now") return now.getHours() + now.getMinutes() / 60;
  return fixedHours[timeOfDay] ?? trackHour;
}

export function timeOf(hour: number): StillTime {
  if (hour < 4.5 || hour >= 19.5) return "night";
  let best: StillTime = "noon";
  for (const time of stillTimes) {
    const gap = Math.abs((fixedHours[time] ?? 0) - hour);
    if (time !== "night" && gap < Math.abs((fixedHours[best] ?? 0) - hour))
      best = time;
  }
  return best;
}

export function rainLevel(rain: string): number {
  return rainLevels[rain] ?? 0;
}

export function overcastSky(clouds: string): boolean {
  return clouds === "many clouds" || clouds === "full cover";
}

export function lookOf(
  conditions: Conditions,
  trackHour: number,
  now: Date,
): Look {
  const hour = startHour(conditions.timeOfDay, trackHour, now);
  const weather: string = weatherOf(conditions).id;
  const known = (stillSkies as readonly string[]).includes(weather);
  return {
    time: timeOf(hour ?? trackHour),
    sky: known ? weather : "light cloud",
    second: weather === "dynamic" ? "light rain" : null,
    random: hour === null || weather === "random",
  };
}

function picture(track: string, name: string): string {
  return (
    pictures[`../../../../content/tracks/${track}/menu/${name}.webp`] ?? ""
  );
}

export function stillOf(
  track: string,
  time: StillTime,
  sky: string,
  thumb = false,
): string {
  return picture(
    track,
    `${thumb ? "thumb/" : ""}${time}-${sky.replace(/ /g, "-")}`,
  );
}

export function overviewOf(track: string): string {
  return picture(track, "overview");
}

export function clockText(hour: number | null): string {
  if (hour === null) return "--:--";
  const minutes = Math.round(hour * 60) % (24 * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function surfaceOf(rain: string): string {
  const surfaces: Record<string, string> = {
    none: "Dry",
    little: "Damp",
    medium: "Wet",
    heavy: "Flooded",
    dynamic: "Changing",
  };
  return surfaces[rain] ?? "Random";
}

export function tyresFor(rain: string): string[] {
  if (rain === "little") return ["inter"];
  if (rain === "medium" || rain === "heavy") return ["wet", "inter"];
  if (rain === "none") return ["soft", "medium", "hard"];
  return ["soft", "medium", "hard", "inter", "wet"];
}

export interface Outline {
  d: string;
  width: number;
  height: number;
  start: [number, number];
  angle: number;
  turns: number;
  length: number;
}

const outlineSize = 1000;
const outlinePad = 40;
const outlineStep = 3;
const outlines = new Map<string, Promise<Outline>>();

function outlineFrom(data: CircuitData): Outline {
  const raw = data.track.points;
  const points: [number, number][] = [];
  for (let i = 0; i + 2 < raw.length; i += 3 * outlineStep)
    points.push([raw[i] ?? 0, raw[i + 2] ?? 0]);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY, 1);
  const scale = (outlineSize - outlinePad * 2) / span;
  const screen = points.map(([x, y]): [number, number] => [
    outlinePad + (x - minX) * scale,
    outlinePad + (y - minY) * scale,
  ]);
  const first = screen[0] ?? [0, 0];
  const next = screen[2] ?? first;
  const d = `M${screen.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}Z`;
  return {
    d,
    width: Math.max(...screen.map((p) => p[0])) + outlinePad,
    height: Math.max(...screen.map((p) => p[1])) + outlinePad,
    start: first,
    angle: (Math.atan2(next[1] - first[1], next[0] - first[0]) * 180) / Math.PI,
    turns: data.turns.length,
    length: data.track.length,
  };
}

export function outlineOf(track: string): Promise<Outline> {
  const known = outlines.get(track);
  if (known) return known;
  const load = fetch(circuitOf(track).map)
    .then((response) => response.json() as Promise<CircuitData>)
    .then(outlineFrom);
  load.catch(() => outlines.delete(track));
  outlines.set(track, load);
  return load;
}

const svgNs = "http://www.w3.org/2000/svg";

export function outlineSvg(outline: Outline, className: string): SVGSVGElement {
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("class", className);
  svg.setAttribute(
    "viewBox",
    `0 0 ${outline.width.toFixed(0)} ${outline.height.toFixed(0)}`,
  );
  svg.setAttribute("aria-hidden", "true");
  const [x, y] = outline.start;
  svg.innerHTML = `<path class="casing" d="${outline.d}"/><path class="line" pathLength="1" d="${outline.d}"/><g class="start" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${outline.angle.toFixed(1)})"><path d="M-6 -30V30"/><path class="arrow" d="M14 -46l26 12-26 12Z"/></g>`;
  return svg;
}

const cloud =
  "M15 38a9 9 0 0 1-1.6-17.9A12 12 0 0 1 36.5 18 10 10 0 0 1 36 38Z";
const highCloud =
  "M15 32a9 9 0 0 1-1.6-17.9A12 12 0 0 1 36.5 12 10 10 0 0 1 36 32Z";
const sunRays =
  "M24 5v4M24 39v4M5 24h4M39 24h4M10.6 10.6l2.8 2.8M34.6 34.6l2.8 2.8M10.6 37.4l2.8-2.8M34.6 13.4l2.8-2.8";
const moon = "M29 7a17 17 0 1 0 13 26A14 14 0 0 1 29 7Z";

function sunOrMoon(night: boolean, small: boolean): string {
  if (night)
    return small
      ? '<path class="solid" d="M19 5a11 11 0 1 0 9 17A9 9 0 0 1 19 5Z"/>'
      : `<path class="solid" d="${moon}"/>`;
  return small
    ? '<circle class="solid" cx="16" cy="15" r="6"/><path d="M16 3v3M4 15h3M7.5 6.5l2 2M24.5 6.5l-2 2"/>'
    : `<circle class="solid" cx="24" cy="24" r="9"/><path d="${sunRays}"/>`;
}

const weatherArt: Record<string, (night: boolean) => string> = {
  clear: (night) => sunOrMoon(night, false),
  "light cloud": (night) =>
    `${sunOrMoon(night, true)}<path class="fill" d="M18 41a8 8 0 0 1-1.4-15.9A11 11 0 0 1 37.6 23 9 9 0 0 1 37 41Z"/>`,
  overcast: () =>
    `<path d="M30 14a10 10 0 0 1 14 10"/><path class="fill" d="${cloud}"/>`,
  "light rain": () =>
    `<path class="fill" d="${highCloud}"/><path d="M19 37l-2 5M29 37l-2 5"/>`,
  "heavy rain": () =>
    `<path class="fill" d="${highCloud}"/><path d="M15 37l-2.5 6M22 37l-2.5 6M29 37l-2.5 6M36 37l-2.5 6"/>`,
  storm: () =>
    `<path class="fill" d="${highCloud}"/><path d="M25 34l-5 7h6l-4 7"/><path d="M15 37l-2 5M35 37l-2 5"/>`,
  dynamic: (night) =>
    `${sunOrMoon(night, true)}<path class="fill" d="${highCloud}"/><path d="M22 37l-2 5"/><path d="M33 44a10 10 0 0 0 6-6M39 44v-6h-6"/>`,
  random: () =>
    `<path class="fill" d="${cloud}"/><text x="25" y="34" text-anchor="middle">?</text>`,
};

export function weatherSvg(id: string, night: boolean): string {
  const art = weatherArt[id] ?? weatherArt["clear"];
  return `<svg class="wx-icon" viewBox="0 0 48 48" aria-hidden="true">${art?.(night) ?? ""}</svg>`;
}

const rowArt: Record<string, string> = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2.5"/>',
  temp: '<path d="M10 4a2 2 0 0 1 4 0v10a5 5 0 1 1-4 0Z"/><path d="M12 10v7"/>',
  road: '<path d="M8 3 4 21M16 3l4 18M12 4v3M12 11v3M12 18v2"/>',
  flag: '<path d="M6 21V3M6 4h12l-3 4 3 4H6"/>',
};

export function rowSvg(id: string): string {
  return `<svg class="row-icon" viewBox="0 0 24 24" aria-hidden="true">${rowArt[id] ?? ""}</svg>`;
}

export function tyreSvg(letter: string, colour: string): string {
  return `<svg class="tyre-art" viewBox="0 0 100 100" aria-hidden="true" style="--tyre:${colour}"><circle class="rubber" cx="50" cy="50" r="46"/><circle class="band" cx="50" cy="50" r="33"/><text x="50" y="51">${letter}</text></svg>`;
}
