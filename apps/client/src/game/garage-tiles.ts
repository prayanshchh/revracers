import { firstTeamBay, teamOfBay } from "./street-pit.ts";
import type { Team } from "./weekend.ts";

export type Rect = [number, number, number, number];

export const backTile = [1024, 512] as const;
export const backGrid = [4, 3] as const;
export const boardTile = [1024, 96] as const;
export const boardGrid = [2, 12] as const;
export const numberTile = 128;
export const numberGrid = [16, 2] as const;
export const bandTall = 192;
export const boardsWidth = boardTile[0] * boardGrid[0];
export const numbersTop = boardTile[1] * boardGrid[1];
export const bandTop = numbersTop + numberTile * numberGrid[1];
export const boardsHeight = bandTop + bandTall;
export const backWidth = backTile[0] * backGrid[0];
export const backHeight = backTile[1] * backGrid[1];
export const seats = 2;
export const emptyBack = backGrid[0] * backGrid[1] - 1;
const inset = 2;

function cell(
  x: number,
  y: number,
  w: number,
  h: number,
  width: number,
  height: number,
): Rect {
  return [
    (x + inset) / width,
    1 - (y + h - inset) / height,
    (x + w - inset) / width,
    1 - (y + inset) / height,
  ];
}

export function backRect(index: number): Rect {
  const [w, h] = backTile;
  const [columns] = backGrid;
  return cell(
    (index % columns) * w,
    Math.floor(index / columns) * h,
    w,
    h,
    backWidth,
    backHeight,
  );
}

export function boardRect(slot: number): Rect {
  const [w, h] = boardTile;
  const [columns] = boardGrid;
  return cell(
    (slot % columns) * w,
    Math.floor(slot / columns) * h,
    w,
    h,
    boardsWidth,
    boardsHeight,
  );
}

export function numberRect(number: number): Rect {
  const [columns] = numberGrid;
  const index = number - 1;
  return cell(
    (index % columns) * numberTile,
    numbersTop + Math.floor(index / columns) * numberTile,
    numberTile,
    numberTile,
    boardsWidth,
    boardsHeight,
  );
}

export function bandRect(): Rect {
  return cell(0, bandTop, boardsWidth, bandTall, boardsWidth, boardsHeight);
}

export function seatOfBay(bay: number): { team: Team; seat: number } | null {
  const team = teamOfBay(bay);
  if (!team) return null;
  return { team, seat: (bay - firstTeamBay) % seats };
}
