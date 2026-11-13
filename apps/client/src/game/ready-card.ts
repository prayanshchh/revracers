import type { PadLink } from "./pad.ts";
import { type Plan, stintRange } from "./strategy.ts";
import { compounds } from "./tyres.ts";

export interface StrategyChoice {
  plans: Plan[];
  choose: (index: number) => void;
}

const planLetters = ["A", "B", "C"];

function planCard(plan: Plan, index: number, best: number): HTMLButtonElement {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "ready-plan";
  const head = document.createElement("header");
  const title = document.createElement("b");
  title.textContent = `Plan ${planLetters[index] ?? ""}`;
  const stops = document.createElement("span");
  const count = plan.stops.length;
  stops.textContent =
    count === 0 ? "No stop" : `${String(count)} stop${count > 1 ? "s" : ""}`;
  const delta = document.createElement("em");
  delta.textContent =
    index === 0 ? "Fastest" : `+${(plan.time - best).toFixed(1)}s`;
  head.append(title, stops, delta);
  const stints = document.createElement("div");
  stints.className = "ready-stints";
  plan.stints.forEach((stint, i) => {
    const tyre = compounds[stint.compound] ?? compounds[1];
    const row = document.createElement("span");
    const badge = document.createElement("i");
    badge.textContent = tyre.letter;
    badge.style.setProperty("--tyre", tyre.colour);
    row.append(badge, `${tyre.label} · ${stintRange(plan, i)}`);
    stints.append(row);
  });
  card.append(head, stints);
  return card;
}

function showStrategy(root: HTMLElement, strategy: StrategyChoice | null) {
  const section = part(root, "strategy");
  const plans = strategy?.plans.slice(0, planLetters.length) ?? [];
  section.hidden = plans.length === 0;
  if (!strategy || plans.length === 0) return () => false;
  const best = plans[0]?.time ?? 0;
  const cards = plans.map((plan, i) => planCard(plan, i, best));
  const pick = (index: number) => {
    if (!cards[index]) return false;
    cards.forEach((card, k) => card.classList.toggle("on", k === index));
    strategy.choose(index);
    return true;
  };
  cards.forEach((card, i) => {
    card.addEventListener("click", () => pick(i));
  });
  part(root, "plans").replaceChildren(...cards);
  pick(0);
  return pick;
}

function part(root: HTMLElement, name: string): HTMLElement {
  const found = root.querySelector<HTMLElement>(`[data-ready=${name}]`);
  if (!found) throw new Error(`missing ready card element ${name}`);
  return found;
}

export function readyCard(
  root: HTMLElement,
  pad: PadLink,
  strategy: StrategyChoice | null = null,
): Promise<void> {
  const linked = part(root, "linked");
  const unlinked = part(root, "unlinked");
  const pick = showStrategy(root, strategy);
  root.hidden = false;
  return new Promise((done) => {
    let frame = 0;
    const finish = () => {
      window.removeEventListener("keydown", onKey, true);
      cancelAnimationFrame(frame);
      root.hidden = true;
      done();
    };
    const onKey = (event: KeyboardEvent) => {
      event.stopImmediatePropagation();
      event.preventDefault();
      if (event.repeat) return;
      if (event.key === "Enter") finish();
      else if (/^[1-3]$/.test(event.key)) pick(Number(event.key) - 1);
    };
    const watch = () => {
      const connected = pad.connected;
      root.classList.toggle("behind", pad.panelOpen);
      linked.hidden = !connected;
      unlinked.hidden = connected;
      frame = requestAnimationFrame(watch);
    };
    window.addEventListener("keydown", onKey, true);
    part(root, "go").addEventListener("click", finish, { once: true });
    watch();
  });
}
