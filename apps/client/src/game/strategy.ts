import { compounds } from "./tyres.ts";

const dryCompounds = [0, 1, 2];
const paceOffset = [-0.4, 0, 0.3];
const realLife = [22, 28, 37];
const cliffFactor = [1.2, 1.0, 0.85];
const wearAtLife = 0.9;
const wearLimit = 0.97;
const lapSensitivity = 26;
const wearCurve: [number, number][] = [
  [0, 0],
  [0.2, 0.006],
  [0.4, 0.015],
  [0.6, 0.03],
  [0.75, 0.06],
  [0.9, 0.16],
  [1, 0.38],
];

export const defaultPitLoss = 22;
export const twoCompoundLaps = 20;

interface Stint {
  compound: number;
  laps: number;
}

export interface Plan {
  stints: Stint[];
  stops: number[];
  time: number;
}

export interface StrategyInput {
  laps: number;
  wearPerLap: number[];
  twoCompounds: boolean;
  pitLoss: number;
  start?: { compound: number; wear: number } | null;
}

function gripLoss(wear: number, cliff: number): number {
  for (let i = 1; i < wearCurve.length; i++) {
    const [w1, l1] = wearCurve[i] ?? [1, 0.38];
    if (wear <= w1) {
      const [w0, l0] = wearCurve[i - 1] ?? [0, 0];
      return (l0 + ((l1 - l0) * (wear - w0)) / (w1 - w0)) * cliff;
    }
  }
  return (wearCurve.at(-1)?.[1] ?? 0.38) * cliff;
}

export function baseWearPerLap(wearScale: number): number[] {
  return realLife.map((life) => (wearAtLife * Math.max(0, wearScale)) / life);
}

export function tyreLife(wearPerLap: number): number {
  return wearPerLap > 0 ? wearLimit / wearPerLap : Infinity;
}

function lapLoss(compound: number, wear: number): number {
  return (
    (paceOffset[compound] ?? 0) +
    gripLoss(Math.min(1, wear), cliffFactor[compound] ?? 1) * lapSensitivity
  );
}

function stintCosts(
  compound: number,
  wear: number,
  perLap: number,
  laps: number,
): number[] {
  const costs = [0];
  let total = 0;
  for (let k = 0; k < laps; k++) {
    const at = wear + perLap * (k + 0.5);
    total += at + perLap * 0.5 > wearLimit ? Infinity : lapLoss(compound, at);
    costs.push(total);
  }
  return costs;
}

interface Search {
  laps: number;
  pitLoss: number;
  first: number[][];
  fresh: number[][];
  firstCompounds: number[];
}

function better(best: Plan | null, plan: Plan | null): Plan | null {
  if (!plan) return best;
  return best === null || plan.time < best.time - 1e-9 ? plan : best;
}

function sequences(first: number[], length: number): number[][] {
  let all = first.map((c) => [c]);
  for (let k = 1; k < length; k++)
    all = all.flatMap((seq) => dryCompounds.map((c) => [...seq, c]));
  return all;
}

function compositions(total: number, parts: number): number[][] {
  if (parts === 1) return total > 0 ? [[total]] : [];
  const all: number[][] = [];
  for (let first = 1; first <= total - parts + 1; first++)
    for (const rest of compositions(total - first, parts - 1))
      all.push([first, ...rest]);
  return all;
}

function planOf(search: Search, seq: number[], split: number[]): Plan | null {
  let time = (seq.length - 1) * search.pitLoss;
  let done = 0;
  const stops: number[] = [];
  seq.forEach((compound, i) => {
    const laps = split[i] ?? 0;
    const table = i === 0 ? search.first : search.fresh;
    time += table[compound]?.[laps] ?? Infinity;
    done += laps;
    if (i < seq.length - 1) stops.push(done);
  });
  if (!Number.isFinite(time)) return null;
  const stints = seq.map((compound, i) => ({ compound, laps: split[i] ?? 0 }));
  return { stints, stops, time };
}

function bestPlans(
  search: Search,
  parts: number,
  twoCompounds: boolean,
): Plan[] {
  const splits = compositions(search.laps, parts);
  const plans: Plan[] = [];
  for (const seq of sequences(search.firstCompounds, parts)) {
    if (twoCompounds && new Set(seq).size < 2) continue;
    let best: Plan | null = null;
    for (const split of splits) best = better(best, planOf(search, seq, split));
    if (best) plans.push(best);
  }
  return plans;
}

function variety(sorted: Plan[]): Plan[] {
  const key = (plan: Plan) =>
    `${String(plan.stints[0]?.compound)}|${String(plan.stops.length)}`;
  const seen = new Set<string>();
  return sorted.filter((plan) => {
    const k = key(plan);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function candidatePlans(input: StrategyInput): Plan[] {
  const laps = Math.max(0, Math.floor(input.laps));
  if (laps === 0) return [];
  const perLap = (c: number) => input.wearPerLap[c] ?? 0;
  const start = input.start;
  const startDry = start && dryCompounds.includes(start.compound);
  const firstCompounds = start
    ? startDry
      ? [start.compound]
      : []
    : dryCompounds;
  const search: Search = {
    laps,
    pitLoss: input.pitLoss,
    firstCompounds,
    first: dryCompounds.map((c) =>
      stintCosts(c, start ? start.wear : 0, perLap(c), laps),
    ),
    fresh: dryCompounds.map((c) => stintCosts(c, 0, perLap(c), laps)),
  };
  return [1, 2, 3]
    .flatMap((parts) => bestPlans(search, parts, input.twoCompounds))
    .sort((a, b) => a.time - b.time);
}

export function planRace(input: StrategyInput): Plan[] {
  return variety(candidatePlans(input));
}

export function stintRange(plan: Plan, index: number, firstLap = 1): string {
  const from =
    firstLap + plan.stints.slice(0, index).reduce((n, s) => n + s.laps, 0);
  const stint = plan.stints[index];
  const to = from + (stint?.laps ?? 1) - 1;
  return from === to
    ? `Lap ${String(from)}`
    : `Laps ${String(from)}-${String(to)}`;
}

export function compoundName(compound: number): string {
  return compounds[compound]?.label ?? "Medium";
}

export function planSummary(plan: Plan): string {
  const names = plan.stints.map((s) => compoundName(s.compound)).join(" - ");
  const stops = plan.stops.length;
  return `${names} (${stops === 0 ? "no stop" : `${String(stops)} stop${stops > 1 ? "s" : ""}`})`;
}

export function observedWear(
  base: number[],
  compound: number,
  observed: number | null,
): number[] {
  const expected = base[compound] ?? 0;
  if (observed === null || !(observed > 0) || !(expected > 0)) return base;
  const ratio = Math.max(0.5, Math.min(2, observed / expected));
  return base.map((w) => w * ratio);
}
