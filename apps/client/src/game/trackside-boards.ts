import layout from "../../../../content/tracks/hill-country/textures/boards/boards.json";
import boardsUrl from "../../../../content/tracks/hill-country/textures/boards/boards.webp?url";
import { type Atlas } from "./trackside-plan.ts";

export const boardsFile = boardsUrl;

const [panelWide = 2048, panelTall = 256] = layout.panel;

export const realBoards: Atlas = {
  row: (name) => Math.max(0, layout.rows.indexOf(name)),
  v: (row, rise) =>
    (row * layout.row + layout.gutter + (1 - rise) * panelTall) / layout.height,
  aspect: panelWide / panelTall,
};

export function knownBoard(name: string): boolean {
  return layout.rows.includes(name);
}

export function boardFill(row: number): number[] {
  return [0.004, realBoards.v(row, 0.5)];
}

const standBoards: Record<string, string> = {
  harbour: "aurenne",
  "harbour gantry": "aurenne",
  chrono: "maison",
  event: "hill prix",
  pasta: "northwind",
  archer: "northwind",
  lager: "verdale",
  lottery: "albaren",
  stream: "torqua",
  energy: "verdale",
  cloud: "cordave",
  hex: "northwind",
  scarlet: "kestrel",
  tyre: "voltara",
  card: "albaren",
  airline: "marlowe",
  bank: "kestrel",
  monogram: "maison",
};

export function standBoard(name: string): string {
  return standBoards[name] ?? "revracers";
}
