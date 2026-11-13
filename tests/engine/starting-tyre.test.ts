import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  lastSlot,
  planWeekend,
  type Stage,
} from "../../apps/client/src/game/weekend.ts";
import { tracks } from "../../apps/client/src/game/settings.ts";
import {
  sessionSeconds,
  type WeatherPlan,
  weatherPlan,
} from "../../apps/client/src/game/weather-plan.ts";
import {
  carPoses,
  sessionKind,
  startField,
  timingOf,
  weatherOf,
  type Weekend,
} from "../support/race-weekend.ts";
import { startCircuit, wasm } from "../support/speed-dreams.ts";

const fieldSize = 22;
const laps = 5;
const picks = [0, 1, 2, 3, 4];
const engineChooses = -1;
const soft = 0;
const medium = 1;
const inter = 3;
const wet = 4;
const stepsPerSecond = 500;
const pastLightsOut = 12;
const raceFile = "/sd/local/config/raceman/quickrace.xml";

interface Weather {
  name: string;
  rain?: string;
  plan?: WeatherPlan;
}

function weathers(track: string, stage: Stage | null): Weather[] {
  const circuit = tracks.find((t) => t.id === track);
  if (!circuit) throw new Error(`unknown circuit ${track}`);
  const duration = sessionSeconds(stage, laps, circuit.length);
  const plans = Array.from({ length: 400 }, (_, i) =>
    weatherPlan(i + 1, duration),
  );
  const wetStart = plans.find((p) => p.story === "drying");
  const dryStart = plans.find((p) => p.story === "rain");
  if (!wetStart || !dryStart) throw new Error("no dynamic plans");
  return [
    { name: "clear", rain: "none" },
    { name: "light rain", rain: "little" },
    { name: "heavy rain", rain: "medium" },
    { name: "storm", rain: "heavy" },
    { name: "random", rain: "random" },
    { name: "dynamic, raining at the start", plan: wetStart },
    { name: "dynamic, dry at the start", plan: dryStart },
  ];
}

function setRain(m: Weekend, rain: string): void {
  m.FS.writeFile(
    raceFile,
    m.FS.readFile(raceFile, { encoding: "utf8" }).replace(
      'name="rain" val="none"',
      `name="rain" val="${rain}"`,
    ),
  );
}

function weatherCall(m: Weekend): number {
  const w = weatherOf(m);
  if (w.line >= w.interLimit) return wet;
  return w.line >= w.slickLimit ? inter : soft;
}

function fittedTyre(m: Weekend): number {
  const pointer = m._malloc(64 * 8);
  m._sdTyresInfo(pointer);
  const compound = new Float64Array(m.HEAPF64.buffer, pointer, 1)[0] ?? -2;
  m._free(pointer);
  return compound;
}

function shownTyres(m: Weekend, cars: number) {
  const timing = timingOf(m, cars);
  const poses = carPoses(m, cars);
  return timing.map((car, i) => ({
    tower: car.compound,
    car: poses[i]?.compound,
  }));
}

async function practice(track: string, compound: number, weather: Weather) {
  return startCircuit<Weekend>((m) => {
    m._sdTyresConfigure(compound, 1);
    m._sdWeatherConfigure(weather.plan ? 1 : 0, weather.plan?.start ?? 0);
    for (const shift of weather.plan?.shifts ?? [])
      m._sdWeatherShift(shift.at, shift.level);
    if (weather.rain) setRain(m, weather.rain);
  }, track);
}

describe.runIf(existsSync(wasm))("the starting tyre", () => {
  for (const track of ["hill-country", "neon-boulevard"])
    test(`at ${track} the player starts the race on the tyre they picked in every weather, while the rivals start on the tyre the weather calls for`, async () => {
      const seen = new Set<number>();
      for (const weather of weathers(track, "race"))
        for (const compound of picks) {
          const m = await startField({
            kind: sessionKind.race,
            laps,
            seed: 11,
            track,
            compound,
            autopilot: false,
            plan: planWeekend("corvus", lastSlot, null),
            ...(weather.rain ? { rain: weather.rain } : {}),
            ...(weather.plan ? { weather: weather.plan } : {}),
          });
          const label = `${weather.name}, picked ${String(compound)}`;
          const call = weatherCall(m);
          seen.add(call);
          const grid = shownTyres(m, fieldSize);
          expect(grid[0], label).toEqual({ tower: compound, car: compound });
          expect(fittedTyre(m), label).toBe(compound);
          for (const rival of grid.slice(1))
            expect(rival.tower >= inter, label).toBe(call >= inter);
          if (compound !== medium) continue;
          m._sdStep(pastLightsOut * stepsPerSecond);
          expect(shownTyres(m, fieldSize)[0], label).toEqual({
            tower: compound,
            car: compound,
          });
          expect(fittedTyre(m), label).toBe(compound);
        }
      expect([...seen].sort((a, b) => a - b)).toEqual([soft, inter, wet]);
    });

  test("practice keeps the picked tyre in every weather on both circuits", async () => {
    for (const track of ["hill-country", "neon-boulevard"])
      for (const weather of weathers(track, null)) {
        const m = await practice(track, medium, weather);
        const label = `${track}, ${weather.name}`;
        expect(fittedTyre(m), label).toBe(medium);
        m._sdStep(pastLightsOut * stepsPerSecond);
        expect(fittedTyre(m), label).toBe(medium);
      }
  });

  test("qualifying, where the garage picks each run's tyre, still sends everyone out on the tyre the weather calls for", async () => {
    for (const weather of weathers("hill-country", "qualifying")) {
      const m = await startField({
        kind: sessionKind.qualifying,
        laps: 1,
        seed: 11,
        compound: engineChooses,
        autopilot: false,
        ...(weather.rain ? { rain: weather.rain } : {}),
        ...(weather.plan ? { weather: weather.plan } : {}),
      });
      const call = weatherCall(m);
      const grid = shownTyres(m, fieldSize);
      for (const car of grid)
        expect(car.tower >= inter, weather.name).toBe(call >= inter);
      expect(grid[0]?.tower, weather.name).toBe(call);
    }
  });
});
