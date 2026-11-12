import { describe, expect, test } from "vitest";
import { tracks } from "../../apps/client/src/game/settings.ts";
import {
  forecastText,
  lapSeconds,
  sessionSeconds,
  type WeatherPlan,
  weatherPlan,
} from "../../apps/client/src/game/weather-plan.ts";

const seeds = Array.from({ length: 400 }, (_, i) => i + 1);
const raceLengths = [5, 10, 20, 56];

function levelAt(plan: WeatherPlan, at: number): number {
  let level = plan.start;
  for (const shift of plan.shifts) if (shift.at <= at) level = shift.level;
  return level;
}

function firstTurn(plan: WeatherPlan): number | null {
  for (const shift of plan.shifts)
    if ((shift.level === 0) !== (levelAt(plan, shift.at - 1e-6) === 0))
      return shift.at;
  return null;
}

function firstOf(story: WeatherPlan["story"], seconds: number): WeatherPlan {
  for (const seed of seeds) {
    const plan = weatherPlan(seed, seconds);
    if (plan.story === story) return plan;
  }
  throw new Error(`no ${story} plan`);
}

describe("dynamic weather plan", () => {
  test("every dynamic race turns between dry and wet in its first half or so, even over five laps", () => {
    for (const track of tracks)
      for (const laps of raceLengths) {
        const seconds = sessionSeconds("race", laps, track.length);
        for (const seed of seeds) {
          const turn = firstTurn(weatherPlan(seed, seconds));
          const what = `${track.id} ${String(laps)} laps seed ${String(seed)}`;
          expect(turn, what).not.toBeNull();
          expect(turn ?? 0, what).toBeGreaterThan(seconds * 0.1);
          expect(turn ?? Infinity, what).toBeLessThan(seconds * 0.55);
        }
      }
  });

  test("most dynamic races either start dry and turn to rain or start wet and dry out", () => {
    const seconds = sessionSeconds("race", 5, tracks[0].length);
    const plans = seeds.map((seed) => weatherPlan(seed, seconds));
    const share = (keep: (plan: WeatherPlan) => boolean) =>
      plans.filter(keep).length / plans.length;
    const intoRain = share((p) => p.start === 0 && levelAt(p, seconds) > 0);
    const dryingOut = share((p) => p.start > 0 && levelAt(p, seconds) === 0);
    expect(intoRain + dryingOut).toBeGreaterThan(0.75);
    expect(intoRain).toBeGreaterThan(0.3);
    expect(dryingOut).toBeGreaterThan(0.3);
    expect(new Set(plans.map((p) => JSON.stringify(p))).size).toBeGreaterThan(
      seeds.length * 0.9,
    );
  });

  test("a seed always gives the same weather, so the forecast in the menu is the weather in the race", () => {
    const seconds = sessionSeconds("race", 10, tracks[1].length);
    for (const seed of seeds.slice(0, 50))
      expect(weatherPlan(seed, seconds)).toEqual(weatherPlan(seed, seconds));
  });

  test("the forecast names the lap the rain arrives and the lap it stops", () => {
    const track = tracks[0];
    const laps = 5;
    const lap = lapSeconds(track.length);
    const seconds = sessionSeconds("race", laps, track.length);
    const lapOf = (at: number) => String(Math.floor(at / lap) + 1);

    const rain = firstOf("rain", seconds);
    const arrives = rain.shifts[0]?.at ?? 0;
    const rainText = forecastText(rain, lap, laps);
    expect(rainText).toMatch(/^Dry start, /);
    expect(rainText).toContain(`from lap ${lapOf(arrives)}`);

    const drying = firstOf("drying", seconds);
    const stops = drying.shifts.find((s) => s.level === 0)?.at ?? 0;
    const dryingText = forecastText(drying, lap, laps);
    expect(dryingText).toMatch(/at the start, /);
    expect(dryingText).toContain(`rain stops on lap ${lapOf(stops)}`);
  });
});
