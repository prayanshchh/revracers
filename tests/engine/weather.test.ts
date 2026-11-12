import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  sessionKind,
  startField,
  statsOf,
  timingOf,
  weatherOf,
  type Weekend,
} from "../support/race-weekend.ts";
import { planWeekend } from "../../apps/client/src/game/weekend.ts";
import { wasm } from "../support/speed-dreams.ts";
import { tracks } from "../../apps/client/src/game/settings.ts";
import {
  sessionSeconds,
  type WeatherPlan,
  weatherPlan,
} from "../../apps/client/src/game/weather-plan.ts";

const fieldSize = 22;
const wet = 4;
const inter = 3;
const stepsPerSecond = 500;
const rampSeconds = 90;

function family(compound: number): "slick" | "inter" | "wet" {
  if (compound === wet) return "wet";
  return compound === inter ? "inter" : "slick";
}

function seconds(m: Weekend, count: number, each?: (second: number) => void) {
  for (let second = 1; second <= count; second++) {
    m._sdStep(stepsPerSecond);
    each?.(second);
  }
}

describe.runIf(existsSync(wasm))("rain and a drying track", () => {
  test("a wet start puts the field on wets, then inters, then slicks as the line dries", async () => {
    const laps = 10;
    const m = await startField({
      kind: sessionKind.race,
      laps,
      seed: 7,
      rain: "medium",
    });
    const rivals = () => timingOf(m, fieldSize).slice(1);
    expect(rivals().every((car) => car.compound === wet)).toBe(true);
    seconds(m, 300);
    const soaked = weatherOf(m);
    expect(soaked.line).toBeGreaterThan(0.55);
    m._sdWeatherSet(0, soaked.line, soaked.off);
    const majority = new Set<string>();
    let lineAhead = 0;
    seconds(m, 1500, (second) => {
      const cars = rivals().filter((car) => !car.finished);
      if (cars.length === 0) return;
      const counts = { slick: 0, inter: 0, wet: 0 };
      for (const car of cars) counts[family(car.compound)]++;
      for (const [name, count] of Object.entries(counts))
        if (count > cars.length / 2) majority.add(name);
      if (second % 10 !== 0) return;
      const w = weatherOf(m);
      if (w.off - w.line > 0.05) lineAhead++;
    });
    expect([...majority]).toEqual(["wet", "inter", "slick"]);
    expect(lineAhead).toBeGreaterThan(60);
    const end = rivals();
    expect(end.filter((car) => car.retired)).toEqual([]);
    expect(end.every((car) => car.finished)).toBe(true);
    expect(end.every((car) => family(car.compound) === "slick")).toBe(true);
    expect(statsOf(m).walls).toBeLessThan(laps * 3);
  });

  test("cars keep to the drying line, where the water is shallower", async () => {
    const { entrants, slots } = planWeekend("corvus", 0, null);
    const m = await startField({
      kind: sessionKind.race,
      laps: 5,
      seed: 3,
      rain: "heavy",
      plan: { entrants: entrants.slice(0, 1), slots: slots.slice(0, 1) },
    });
    seconds(m, 60);
    const w = weatherOf(m);
    m._sdWeatherSet(0, w.line * 0.4, w.off);
    let met = 0;
    let middle = 0;
    seconds(m, 90, () => {
      const now = weatherOf(m);
      expect(now.player).toBeGreaterThanOrEqual(now.line - 1e-9);
      expect(now.player).toBeLessThanOrEqual(now.off + 1e-9);
      met += now.player;
      middle += (now.line + now.off) / 2;
    });
    expect(met).toBeLessThan(middle);
  });

  test("dynamic weather over a five-lap race turns the call between slicks and wet tyres, both when rain arrives and when the track dries, without the rain ever jumping", async () => {
    const laps = 5;
    const length = tracks[0].length;
    const duration = Math.round(sessionSeconds("race", laps, length));
    const plans = Array.from({ length: 2000 }, (_, i) =>
      weatherPlan(i + 1, duration),
    );
    const gap = (plan: WeatherPlan) =>
      plan.story === "rain" && plan.shifts.length === 2
        ? (plan.shifts[1]?.at ?? 0) - (plan.shifts[0]?.at ?? 0)
        : Infinity;
    const heavier = plans.reduce((best, plan) =>
      gap(plan) < gap(best) ? plan : best,
    );
    expect(gap(heavier)).toBeLessThan(rampSeconds - 10);
    const drying = plans.find((plan) => plan.story === "drying");
    if (!drying) throw new Error("no drying plan");
    for (const plan of [heavier, drying]) {
      const m = await startField({
        kind: sessionKind.race,
        laps,
        seed: 5,
        weather: plan,
      });
      const promised = weatherOf(m).forecast[0] ?? 0;
      const calls: string[] = [];
      let rain = weatherOf(m).rain;
      seconds(m, duration, (second) => {
        const w = weatherOf(m);
        const call = w.line >= w.slickLimit ? "wet" : "slick";
        if (calls.at(-1) !== call) calls.push(call);
        if (second === 300) expect(w.rain).toBeCloseTo(promised, 3);
        expect(
          Math.abs(w.rain - rain),
          `second ${String(second)}`,
        ).toBeLessThan(1 / rampSeconds + 1e-6);
        rain = w.rain;
      });
      expect(calls, plan.story).toEqual(
        plan.story === "rain" ? ["slick", "wet"] : ["wet", "slick"],
      );
    }
  });
});
