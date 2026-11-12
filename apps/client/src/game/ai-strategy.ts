import {
  baseWearPerLap,
  candidatePlans,
  defaultPitLoss,
  type Plan,
  twoCompoundLaps,
} from "./strategy.ts";
import { seeded } from "./seeded.ts";

export interface StintPlan {
  compound: number;
  from: number;
}

export interface FieldEntry {
  teamIndex: number;
  player: boolean;
}

export interface FieldRace {
  laps: number;
  wearScale: number;
  seed: number;
}

const shortestStint = 4;
const stintWear = 0.66;
const shortlist = 10;
const costScale = 2.5;
const styleWeight = 1.4;
const stopWeight = 0.8;
const gambleFrom = 0.6;
const gambleWeight = 1;
const gambleChance = 0.35;
const teammateWeight = 1.1;
const temperature = 0.9;
const stopSpread = 0.15;

function planKey(plan: Plan): string {
  return plan.stints.map((s) => String(s.compound)).join("");
}

function share(plan: Plan, compound: number, laps: number): number {
  const on = plan.stints
    .filter((s) => s.compound === compound)
    .reduce((n, s) => n + s.laps, 0);
  return on / laps;
}

interface Pick {
  plans: Plan[];
  laps: number;
  style: number;
  gamble: number;
  teammate: string | null;
  random: () => number;
}

function utility(pick: Pick, plan: Plan, best: number): number {
  const lean = share(plan, 0, pick.laps) - share(plan, 2, pick.laps);
  const stops = plan.stops.length;
  return (
    -(plan.time - best) / costScale +
    pick.style * (lean * styleWeight + stops * stopWeight) +
    Math.min(1, stops) * pick.gamble +
    (planKey(plan) === pick.teammate ? teammateWeight : 0)
  );
}

function choose(pick: Pick): Plan | null {
  const best = pick.plans[0]?.time ?? 0;
  let chosen: Plan | null = null;
  let top = -Infinity;
  for (const plan of pick.plans) {
    const gumbel = -Math.log(-Math.log(Math.max(1e-12, pick.random())));
    const score = utility(pick, plan, best) + temperature * gumbel;
    if (score > top) {
      top = score;
      chosen = plan;
    }
  }
  return chosen;
}

function stintsOf(plan: Plan, laps: number): StintPlan[] {
  return plan.stints.map((stint, i) => ({
    compound: stint.compound,
    from: i === 0 ? 0 : (plan.stops[i - 1] ?? 0) / laps,
  }));
}

function gambleOffset(plans: Plan[]): number {
  const best = plans[0]?.time ?? 0;
  const stopping = plans.find((plan) => plan.stops.length > 0);
  return stopping ? (stopping.time - best) / costScale + gambleWeight : 0;
}

function usable(stint: Plan["stints"][number], wear: number[]): boolean {
  return (
    stint.laps >= shortestStint &&
    stint.laps * (wear[stint.compound] ?? 0) <= stintWear
  );
}

function shifted(plan: Plan, shift: number, race: FieldRace): Plan | null {
  const wear = baseWearPerLap(race.wearScale);
  const stops = plan.stops.map((stop) => stop + shift);
  const stints = plan.stints.map((stint, i) => ({
    ...stint,
    laps: (stops[i] ?? race.laps) - (stops[i - 1] ?? 0),
  }));
  return stints.every((stint) => usable(stint, wear))
    ? { ...plan, stops, stints }
    : null;
}

function spread(
  plan: Plan,
  race: FieldRace,
  random: () => number,
  avoid: number | null,
): { plan: Plan; shift: number } {
  if (plan.stops.length === 0) return { plan, shift: 0 };
  const reach = Math.max(1, Math.round(race.laps * stopSpread));
  const wanted = Math.round((random() * 2 - 1) * reach);
  const shifts = Array.from({ length: 2 * reach + 1 }, (_, i) => i - reach)
    .filter((shift) => shift !== avoid)
    .sort(
      (a, b) =>
        Math.abs(Math.abs(a) - Math.abs(wanted)) -
          Math.abs(Math.abs(b) - Math.abs(wanted)) ||
        (a === wanted ? -1 : b === wanted ? 1 : 0),
    );
  for (const shift of shifts) {
    const moved = shifted(plan, shift, race);
    if (moved) return { plan: moved, shift };
  }
  return { plan, shift: 0 };
}

function fieldPlans(race: FieldRace): Plan[] {
  const wear = baseWearPerLap(race.wearScale);
  return candidatePlans({
    laps: race.laps,
    wearPerLap: wear,
    twoCompounds: race.laps >= twoCompoundLaps,
    pitLoss: defaultPitLoss,
  })
    .filter((plan) => plan.stints.every((stint) => usable(stint, wear)))
    .slice(0, shortlist);
}

export function fieldStrategies(
  entrants: FieldEntry[],
  slots: number[],
  race: FieldRace,
): StintPlan[][] {
  const plans = fieldPlans(race);
  const offset = gambleOffset(plans);
  const random = seeded(race.seed);
  const shifts = seeded(race.seed * 7 + 3);
  const gambles = (slot: number) =>
    slot >= gambleFrom * entrants.length && random() < gambleChance;
  const styles = new Map<number, number>();
  const chosen = new Map<number, { key: string; shift: number }>();
  const styleOf = (team: number) => {
    const style = styles.get(team) ?? random() * 2 - 1;
    styles.set(team, style);
    return style;
  };
  return entrants.map((entrant, index) => {
    if (entrant.player || plans.length === 0) return [];
    const plan = choose({
      plans,
      laps: race.laps,
      style: styleOf(entrant.teamIndex),
      gamble: gambles(slots[index] ?? 0) ? offset : 0,
      teammate: chosen.get(entrant.teamIndex)?.key ?? null,
      random,
    });
    if (!plan) return [];
    const mate = chosen.get(entrant.teamIndex);
    const key = planKey(plan);
    const own = spread(
      plan,
      race,
      shifts,
      mate?.key === key ? mate.shift : null,
    );
    chosen.set(entrant.teamIndex, { key, shift: own.shift });
    return stintsOf(own.plan, race.laps);
  });
}
