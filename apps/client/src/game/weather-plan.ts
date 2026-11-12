import { seeded } from "./random.ts";
import type { Stage } from "./weekend.ts";

type WeatherStory = "rain" | "drying" | "shower";

interface WeatherShift {
  at: number;
  level: number;
}

export interface WeatherPlan {
  story: WeatherStory;
  start: number;
  shifts: WeatherShift[];
}

const referenceSpeed = 56.7;
const qualifyingLaps = 6;
const practiceLaps = 10;
const shortSession = 900;
const levelNames = ["Dry", "Light Rain", "Heavy Rain", "Storm"];
const rainIds = ["none", "little", "medium", "heavy"];

export function lapSeconds(trackLength: number): number {
  return trackLength / referenceSpeed;
}

export function sessionSeconds(
  stage: Stage | null,
  laps: number,
  trackLength: number,
): number {
  const driven =
    stage === "race"
      ? laps
      : stage === "qualifying"
        ? qualifyingLaps
        : practiceLaps;
  return driven * lapSeconds(trackLength);
}

export function newWeatherSeed(): number {
  return Math.floor(Math.random() * 1_000_000) + 1;
}

export function weatherPlan(seed: number, seconds: number): WeatherPlan {
  const next = seeded(Math.floor(seed) || 1);
  const share = (low: number, high: number) =>
    seconds * (low + (high - low) * next());
  const short = seconds < shortSession;
  const roll = next();
  if (roll < 0.45) {
    const level = 1 + Math.floor(next() * (short ? 2 : 3));
    const first = { at: share(0.25, 0.5), level };
    const later = { at: first.at + share(0.15, 0.25), level: level + 1 };
    const heavier = level < 3 && next() < 0.4 && later.at < seconds * 0.85;
    return {
      story: "rain",
      start: 0,
      shifts: heavier ? [first, later] : [first],
    };
  }
  if (roll < 0.85) {
    const start = short ? 1 : 1 + Math.floor(next() * 2);
    const easing = { at: share(0.1, 0.2), level: 1 };
    const stop = { at: share(0.3, 0.42), level: 0 };
    return {
      story: "drying",
      start,
      shifts:
        start > 1 ? [easing, stop] : [{ at: share(0.12, 0.28), level: 0 }],
    };
  }
  return {
    story: "shower",
    start: 0,
    shifts: [
      { at: share(0.2, 0.32), level: 1 + Math.floor(next() * 2) },
      { at: share(0.55, 0.68), level: 0 },
    ],
  };
}

export function startRain(plan: WeatherPlan): string {
  return rainIds[plan.start] ?? "none";
}

function lapOf(at: number, lap: number, laps: number): number {
  return Math.min(laps, Math.floor(at / lap) + 1);
}

function shiftText(
  shift: WeatherShift,
  before: number,
  lap: number | null,
  laps: number,
): string {
  const time =
    lap === null
      ? `after about ${String(Math.max(1, Math.round(shift.at / 60)))} min`
      : `${shift.level === 0 ? "on" : "from"} lap ${String(lapOf(shift.at, lap, laps))}`;
  if (shift.level === 0) return `rain stops ${time}`;
  const name = levelNames[shift.level] ?? "Rain";
  return before > 0 && shift.level > before
    ? `turning to ${name} ${time}`
    : `${name} ${time}`;
}

export function forecastText(
  plan: WeatherPlan,
  lap: number | null,
  laps: number,
): string {
  const parts = [
    plan.start === 0
      ? "Dry start"
      : `${levelNames[plan.start] ?? "Rain"} at the start`,
  ];
  let before = plan.start;
  for (const shift of plan.shifts) {
    parts.push(shiftText(shift, before, lap, laps));
    before = shift.level;
  }
  return parts.join(", ");
}

export function storyText(plan: WeatherPlan): string {
  const wettest = Math.max(plan.start, ...plan.shifts.map((s) => s.level));
  const rain = levelNames[wettest] ?? "Rain";
  if (plan.story === "rain") return `Dry, then ${rain}`;
  if (plan.story === "drying") return `${rain}, then drying`;
  return `${rain} shower`;
}
