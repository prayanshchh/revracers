import type { CarTiming } from "./engine.ts";
import { teamLogo } from "./team-logos.ts";
import { compounds } from "./tyres.ts";
import type { Entrant } from "./weekend.ts";

const aroundRows = 5;
const moveShown = 6000;
const statusGarage = 5;
const statusOut = 1;
const statusIn = 3;

export function lapText(seconds: number): string {
  if (!(seconds > 0)) return "--:--.---";
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}:${(seconds - minutes * 60).toFixed(3).padStart(6, "0")}`;
}

export function surname(entrant: Entrant): string {
  const parts = entrant.name.trim().split(/\s+/);
  return (parts.at(-1) ?? entrant.code).toUpperCase();
}

function signedGap(value: number): string {
  return `${value < 0 ? "-" : "+"}${Math.abs(value).toFixed(3)}`;
}

function raceGapText(
  row: CarTiming,
  player: CarTiming | undefined,
  isPlayer: boolean,
): string {
  if (isPlayer) return "--:--.---";
  if (row.progress <= 0) return "";
  if (row.inPit) return "IN PIT";
  if (!player) return "";
  const laps = player.lapsDown - row.lapsDown;
  if (laps !== 0) return `${laps > 0 ? "-" : "+"}${String(Math.abs(laps))} LAP`;
  return signedGap(row.gapLeader - player.gapLeader);
}

function qualifyingGapText(row: CarTiming, leaderBest: number): string {
  if (row.eliminated) return "OUT";
  if (row.status === statusGarage && row.segmentBest <= 0) return "PIT";
  if (row.segmentBest <= 0)
    return row.status === statusOut
      ? "OUT LAP"
      : row.status === statusIn
        ? "IN LAP"
        : "NO TIME";
  if (row.position === 1) return lapText(row.segmentBest);
  return signedGap(row.segmentBest - leaderBest);
}

interface TowerRow {
  root: HTMLElement;
  pos: HTMLElement;
  name: HTMLElement;
  logo: HTMLElement;
  label: HTMLElement;
  tyre: HTMLElement;
  gap: HTMLElement;
  pen: HTMLElement;
  shown: string;
}

function positionMoves(
  before: Map<number, number>,
  timing: { index: number; position: number }[],
): Map<number, "up" | "down"> {
  const moves = new Map<number, "up" | "down">();
  for (const row of timing) {
    const was = before.get(row.index);
    if (was !== undefined && was !== row.position)
      moves.set(row.index, row.position < was ? "up" : "down");
    before.set(row.index, row.position);
  }
  return moves;
}

export class Tower {
  private readonly rows: TowerRow[];
  private full = false;
  private readonly positions = new Map<number, number>();
  private readonly moved = new Map<number, { way: string; until: number }>();
  private readonly strip: HTMLElement;
  private stripShown = "";

  constructor(
    private readonly list: HTMLElement,
    private readonly entrants: Entrant[],
    private readonly qualifying: boolean,
  ) {
    this.list.replaceChildren();
    this.rows = entrants.map(() => this.makeRow());
    this.list.parentElement?.querySelector(".tower-fl")?.remove();
    this.strip = document.createElement("div");
    this.strip.className = "tower-fl";
    this.strip.dataset["hud"] = "fastest-lap";
    this.strip.hidden = true;
    this.list.after(this.strip);
  }

  private showFastest(timing: CarTiming[], fastestCar: number): void {
    const row = timing.find((t) => t.index === fastestCar);
    const entrant = this.entrants[fastestCar];
    const best = row?.best ?? 0;
    const show = !this.qualifying && entrant !== undefined && best > 0;
    const key = show ? `${entrant.code}|${lapText(best)}` : "";
    if (key === this.stripShown) return;
    this.stripShown = key;
    this.strip.hidden = !show;
    if (show)
      this.paintFastest(entrant.player ? "YOU" : surname(entrant), best);
  }

  private paintFastest(name: string, best: number): void {
    const icon = '<svg><use href="#stopwatch" /></svg>';
    this.strip.innerHTML = `${icon}<small>Fastest Lap</small><span></span><b></b>`;
    const label = this.strip.querySelector("span");
    const time = this.strip.querySelector("b");
    if (label) label.textContent = name;
    if (time) time.textContent = lapText(best);
  }

  private makeRow(): TowerRow {
    const root = document.createElement("li");
    const pos = document.createElement("span");
    pos.className = "row-pos";
    const name = document.createElement("span");
    name.className = "row-name";
    const logo = document.createElement("i");
    logo.className = "row-logo";
    const label = document.createElement("span");
    name.append(logo, label);
    const tyre = document.createElement("i");
    tyre.className = "row-tyre";
    const gap = document.createElement("b");
    gap.className = "row-gap";
    const pen = document.createElement("em");
    pen.className = "row-pen";
    pen.hidden = true;
    const flag = document.createElement("i");
    flag.className = "row-flag";
    flag.innerHTML = '<svg><use href="#stopwatch" /></svg>';
    root.append(pos, name, tyre, gap, flag, pen);
    root.hidden = true;
    this.list.append(root);
    return { root, pos, name, logo, label, tyre, gap, pen, shown: "" };
  }

  toggleFull(): boolean {
    this.full = !this.full;
    return this.full;
  }

  private window(ranked: CarTiming[]): CarTiming[] {
    if (this.full) return ranked;
    const mine = ranked.findIndex((row) => row.index === 0);
    const half = Math.floor(aroundRows / 2);
    const from = Math.max(0, Math.min(ranked.length - aroundRows, mine - half));
    return ranked.slice(from, from + aroundRows);
  }

  private moves(timing: CarTiming[]): void {
    const now = performance.now();
    for (const [car, way] of positionMoves(this.positions, timing))
      if (!this.qualifying)
        this.moved.set(car, { way, until: now + moveShown });
    for (const [car, move] of this.moved)
      if (move.until < now) this.moved.delete(car);
  }

  update(timing: CarTiming[], penalties: string[], fastestCar = -1): void {
    this.moves(timing);
    this.showFastest(timing, fastestCar);
    const ranked = [...timing].sort((a, b) => a.position - b.position);
    const player = timing[0];
    const leaderBest = ranked[0]?.segmentBest ?? 0;
    const visible = this.window(ranked);
    this.rows.forEach((row, i) => {
      const data = visible[i];
      if (!data) {
        row.root.hidden = true;
        return;
      }
      row.root.hidden = false;
      const entrant = this.entrants[data.index];
      if (!entrant) return;
      const isPlayer = data.index === 0;
      const gap = this.qualifying
        ? qualifyingGapText(data, leaderBest)
        : raceGapText(data, player, isPlayer);
      const compound = compounds[data.compound] ?? compounds[1];
      const pen = penalties[data.index] ?? "";
      const fastest = data.index === fastestCar;
      const move = this.moved.get(data.index)?.way ?? "";
      const key = `${String(data.position)}|${entrant.code}|${gap}|${compound.letter}|${pen}|${String(fastest)}|${move}`;
      if (key === row.shown) return;
      row.shown = key;
      row.root.classList.toggle("fl", fastest);
      row.root.dataset["move"] = move;
      row.pos.textContent = String(data.position);
      row.label.textContent = surname(entrant);
      row.logo.replaceChildren(teamLogo(entrant.car, entrant.colour));
      row.name.style.setProperty("--team", entrant.colour);
      row.root.dataset["me"] = isPlayer ? "1" : "";
      row.root.classList.toggle("out", data.eliminated);
      row.tyre.textContent = compound.letter;
      row.tyre.style.setProperty("--tyre", compound.colour);
      row.gap.textContent = gap;
      row.pen.textContent = pen;
      row.pen.hidden = pen === "";
    });
  }
}
