import "@fontsource-variable/saira/wdth.css";
import "../card-band.css";
import "../school-still.css";
import stillUrl from "../school-still.webp?url";
import { welcomeCard } from "./school-card.ts";
import { fitStage } from "./stage.ts";

const handOverAfter = 500;
const fadeTime = 400;
const fontWait = 800;
const titleFont = '800 40px "Saira Variable"';

let root: HTMLElement | null = null;
let shownAt: number | null = null;
let skipped = false;
const refit = () => {
  fitStage();
};

function part<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  name: string,
  text = "",
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = name;
  element.textContent = text;
  return element;
}

function onKey(event: KeyboardEvent): void {
  if (event.key !== "Escape" || event.repeat || !root) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (skipped) return;
  skipped = true;
  const body = root.querySelector(".school-still-body");
  if (body) body.textContent = "Skipping Driving School…";
}

function cardReady(card: HTMLElement): void {
  const show = () => {
    card.classList.add("school-still-in");
  };
  const waited = new Promise((resolve) => setTimeout(resolve, fontWait));
  void Promise.race([document.fonts.load(titleFont), waited]).then(show, show);
}

export function showStill(): void {
  if (root) return;
  fitStage();
  window.addEventListener("resize", refit);
  const frame = part("img", "school-still-frame");
  frame.alt = "";
  frame.decoding = "async";
  frame.fetchPriority = "high";
  frame.src = stillUrl;
  const card = part("section", "school-still-card card-band");
  card.append(
    part("h2", "school-still-title", welcomeCard.title),
    part("p", "school-still-body", welcomeCard.body),
  );
  const wait = part("div", "loader school-still-wait");
  wait.append(...Array.from({ length: 5 }, () => part("i", "")));
  const still = part("div", "school-still");
  still.dataset["schoolStill"] = "";
  still.append(frame, card, wait);
  document.body.append(still);
  root = still;
  shownAt = performance.now();
  cardReady(card);
  window.addEventListener("keydown", onKey, true);
}

export function stillSeen(): number {
  return shownAt === null ? 0 : (performance.now() - shownAt) / 1000;
}

export function stillSkipped(): boolean {
  return skipped;
}

export function handOverStill(): void {
  const still = root;
  if (!still || skipped) return;
  root = null;
  window.removeEventListener("keydown", onKey, true);
  window.removeEventListener("resize", refit);
  setTimeout(() => {
    still.classList.add("gone");
    setTimeout(() => {
      still.remove();
    }, fadeTime);
  }, handOverAfter);
}
