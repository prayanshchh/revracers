import { ordinal } from "./buildup-ordinal.ts";
import { el } from "./dom.ts";
import { teamLogo } from "./team-logos.ts";
import type { GridEntry } from "./teams.ts";

const rowPitch = 84;
const pairPitch = rowPitch * 2;
const settledLift = 36;
const listInset = 128;
const firstLeftIn = 0.15;
const leftIn = 0.3;
const rightLag = 0.35;
const leftOut = 2.7;
const rightOut = 2.88;
const firstReveal = 1.3;
const reveal = 0.5;
const artLines = 9;
const artSpacing = 15;

const svgNamespace = "http://www.w3.org/2000/svg";

function trackArt(): SVGSVGElement {
  const svg = document.createElementNS(svgNamespace, "svg");
  svg.setAttribute("class", "bu-board-art");
  svg.setAttribute("viewBox", "0 0 854 890");
  svg.setAttribute("aria-hidden", "true");
  for (let i = 0; i < artLines; i += 1) {
    const dx = i * artSpacing;
    const path = document.createElementNS(svgNamespace, "path");
    path.setAttribute(
      "d",
      `M${String(800 + dx)} 200 L${String(500 + dx)} 450 Q${String(400 + dx)} 535 ${String(480 + dx)} 615 L${String(760 + dx)} 900`,
    );
    path.setAttribute("opacity", (1 - i / artLines).toFixed(2));
    svg.append(path);
  }
  return svg;
}

class BoardSide {
  readonly root: HTMLElement;
  private readonly number = el("b");
  private readonly suffix = el("sup");
  private readonly figure = el("div", "bu-board-figure");
  private readonly ghost = el("i", "bu-board-ghost");
  private readonly logo = el("div", "bu-board-logo");
  private readonly first = el("span");
  private readonly last = el("b");

  constructor(side: "left" | "right") {
    this.root = el("div", `bu-board-side ${side}`);
    const place = el("div", "bu-board-place");
    place.append(this.number, this.suffix);
    const names = el("div", "bu-board-names");
    names.append(this.first, this.last);
    const name = el("div", "bu-board-name");
    name.append(this.logo, names);
    this.root.append(
      el("div", "bu-board-glow"),
      trackArt(),
      this.figure,
      place,
      name,
    );
  }

  fill(entry: GridEntry | undefined, image: HTMLImageElement | undefined) {
    this.root.hidden = !entry;
    if (!entry) return;
    this.root.style.setProperty("--brand", entry.team.brand);
    this.number.textContent = String(entry.position);
    this.suffix.textContent = ordinal(entry.position);
    this.first.textContent = entry.first;
    this.last.textContent = entry.last.toUpperCase();
    this.logo.replaceChildren(teamLogo(entry.team.id, entry.team.brand));
    this.ghost.style.maskImage = image ? `url("${image.src}")` : "none";
    this.figure.replaceChildren(this.ghost, ...(image ? [image] : []));
  }

  show(on: boolean): void {
    if (this.root.classList.contains("in") !== on)
      this.root.classList.toggle("in", on);
  }
}

export class GridBoard {
  readonly root = el("section", "bu-board");
  private readonly sides = [new BoardSide("left"), new BoardSide("right")];
  private readonly rows: HTMLElement[];
  private readonly list = el("div", "bu-board-rows");
  private pair = -1;
  private revealed = -1;
  private readonly pairs: number;

  constructor(
    event: string,
    private readonly grid: GridEntry[],
    private readonly portraits: HTMLImageElement[],
  ) {
    this.pairs = Math.ceil(grid.length / 2);
    const panel = el("div", "bu-board-panel");
    const viewport = el("div", "bu-board-list");
    this.rows = grid.map((entry, k) => {
      const row = el("div", `bu-board-row${k % 2 ? " even" : ""}`);
      row.style.top = `${String(k * rowPitch)}px`;
      row.style.setProperty("--brand", entry.team.brand);
      row.append(
        el("small", "", String(entry.position)),
        el("b", "", entry.code),
      );
      return row;
    });
    this.list.append(...this.rows);
    this.list.style.translate = `0 ${String(listInset)}px`;
    viewport.append(this.list);
    panel.append(
      el("i", "bu-board-dots left"),
      el("i", "bu-board-dots right"),
      ...this.sides.map((side) => side.root),
      el("h2", "", "Starting Grid"),
      viewport,
    );
    this.root.append(
      el("header", "bu-board-event", event.toUpperCase()),
      panel,
    );
  }

  update(pair: number, time: number): void {
    if (pair !== this.pair) this.turn(pair);
    const first = pair === 0;
    const last = pair === this.pairs - 1;
    const leftAt = first ? firstLeftIn : leftIn;
    const rightAt = leftAt + rightLag;
    const [left, right] = this.sides;
    left?.show(time >= leftAt && (last || time < leftOut));
    right?.show(time >= rightAt && (last || time < rightOut));
    const delay = first ? firstReveal : reveal;
    const shown = [leftAt, rightAt].filter((at) => time >= at + delay).length;
    this.reveal(pair * 2 + shown);
  }

  private turn(pair: number): void {
    this.pair = pair;
    this.sides.forEach((side, k) => {
      side.fill(this.grid[pair * 2 + k], this.portraits[pair * 2 + k]);
    });
    const lift = pair === 0 ? 0 : pair * pairPitch - settledLift;
    this.list.style.translate = `0 ${String(listInset - lift)}px`;
  }

  private reveal(count: number): void {
    if (count === this.revealed) return;
    this.revealed = count;
    this.rows.forEach((row, k) => {
      if (row.classList.contains("shown") !== k < count)
        row.classList.toggle("shown", k < count);
    });
  }
}
