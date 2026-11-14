import * as THREE from "three/webgpu";
import {
  backGrid,
  backHeight,
  backTile,
  backWidth,
  bandTall,
  bandTop,
  boardGrid,
  boardsHeight,
  boardsWidth,
  boardTile,
  emptyBack,
  numberGrid,
  numbersTop,
  numberTile,
  seats,
} from "./garage-tiles.ts";
import { teamOf } from "./teams.ts";
import { teams } from "./weekend.ts";

type Context = CanvasRenderingContext2D;

interface Livery {
  name: string;
  fullName: string;
  sponsors: string[];
  colour: string;
  brand: string;
  drivers: {
    first: string;
    last: string;
    nationality: string;
    number: number;
  }[];
}

const family = '"Saira Variable", Saira, sans-serif';
const weights = [500, 600, 700, 800];
const wallWhite = "#d4d6d9";
const wallSeam = "#c1c4c8";
const seamStep = 113;
const header = 64;
const cabinetTop = 400;
const drawerWidth = 64;
const drawerRows = 3;
const boardHalf = 215;
const bandInk = "#d2101a";
const bandYellow = "#ffd21f";
const bandWord = "VOLTARA";
const bandLogos = 2;
const slant = -0.22;
const anisotropy = 8;

function fontOf(weight: number, size: number): string {
  return `${String(weight)} ${String(size)}px ${family}`;
}

function fit(
  context: Context,
  text: string,
  size: number,
  weight: number,
  limit: number,
): void {
  let px = size;
  context.font = fontOf(weight, px);
  while (px > 10 && context.measureText(text).width > limit) {
    px -= 2;
    context.font = fontOf(weight, px);
  }
}

function centred(
  context: Context,
  text: string,
  x: number,
  y: number,
  colour: string,
): void {
  context.fillStyle = colour;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, x, y);
}

function liveries(): Livery[] {
  const field: Livery[] = [];
  for (const team of teams) {
    const data = teamOf(team.car);
    field[team.index] = {
      name: data.name,
      fullName: data.fullName,
      sponsors: data.sponsors,
      colour: team.colour,
      brand: data.brand,
      drivers: data.drivers,
    };
  }
  return field;
}

function wallScreen(
  context: Context,
  x: number,
  y: number,
  chart: boolean,
  field: Livery[],
): void {
  context.fillStyle = "#0b0d11";
  context.fillRect(x, y, 170, 100);
  context.fillStyle = "#0f1826";
  context.fillRect(x + 5, y + 5, 160, 90);
  if (chart) {
    const points = [
      [22, 70],
      [40, 34],
      [74, 26],
      [96, 44],
      [132, 30],
      [146, 62],
      [104, 78],
      [60, 66],
      [22, 70],
    ];
    context.strokeStyle = "#43c6e8";
    context.lineWidth = 3;
    context.beginPath();
    for (const [px = 0, py = 0] of points) context.lineTo(x + px, y + py);
    context.stroke();
    context.fillStyle = "#f2c418";
    context.beginPath();
    context.arc(x + 96, y + 44, 4, 0, Math.PI * 2);
    context.fill();
    return;
  }
  for (let row = 0; row < 7; row++) {
    const top = y + 11 + row * 12;
    context.fillStyle = field[row % field.length]?.brand ?? "#888";
    context.fillRect(x + 11, top, 5, 8);
    context.fillStyle = "#aab4c4";
    context.fillRect(x + 20, top + 1, 51 + ((row * 13) % 22), 6);
    context.fillStyle = row % 3 ? "#6fd08c" : "#c084fc";
    context.fillRect(x + 112, top + 1, 45, 6);
  }
}

function cabinets(context: Context, width: number, height: number): void {
  context.fillStyle = "#2b2e34";
  context.fillRect(0, cabinetTop, width, height - cabinetTop);
  context.fillStyle = "#3a3e45";
  context.fillRect(0, cabinetTop, width, 5);
  const tall = (height - cabinetTop - 5) / drawerRows;
  for (let x = 0; x < width; x += drawerWidth) {
    context.fillStyle = "#1c1f24";
    context.fillRect(x, cabinetTop + 5, 2, height - cabinetTop);
    for (let row = 0; row < drawerRows; row++) {
      const top = cabinetTop + 5 + row * tall;
      context.fillStyle = "#1c1f24";
      context.fillRect(x, top + tall - 2, drawerWidth, 2);
      context.fillStyle = "#8d939c";
      context.fillRect(x + drawerWidth / 2 - 12, top + 6, 24, 3);
    }
  }
}

function backPanel(
  context: Context,
  livery: Livery | null,
  field: Livery[],
): void {
  const [width, height] = backTile;
  const deep = livery?.colour ?? "#1b2230";
  const brand = livery?.brand ?? "#3a4252";
  context.fillStyle = wallWhite;
  context.fillRect(0, 0, width, height);
  const sheen = context.createLinearGradient(0, header, 0, cabinetTop);
  sheen.addColorStop(0, "rgba(255,255,255,0.08)");
  sheen.addColorStop(1, "rgba(0,0,0,0.06)");
  context.fillStyle = sheen;
  context.fillRect(0, header, width, cabinetTop - header);
  context.fillStyle = wallSeam;
  for (let x = 0; x < width; x += seamStep) context.fillRect(x, 0, 2, height);
  context.fillStyle = deep;
  context.fillRect(0, 0, width, header);
  context.fillStyle = brand;
  context.fillRect(0, header, width, 6);
  cabinets(context, width, height);
  context.fillStyle = brand;
  context.fillRect(0, header + 6, 10, cabinetTop - header - 6);
  context.fillRect(width - 10, header + 6, 10, cabinetTop - header - 6);
  if (!livery) return;
  context.font = fontOf(700, 24);
  livery.sponsors.forEach((name, k) => {
    centred(
      context,
      name,
      (width * (k + 0.5)) / livery.sponsors.length,
      header / 2,
      "#ffffff",
    );
  });
  const title = livery.name.toUpperCase();
  fit(context, title, 132, 800, width * 0.36);
  centred(context, title, width / 2, 205, deep);
  context.fillStyle = brand;
  context.fillRect(width / 2 - 70, 272, 140, 5);
  const full = livery.fullName.toUpperCase();
  fit(context, full, 22, 600, width * 0.4);
  centred(context, full, width / 2, 302, "#5c6370");
  wallScreen(context, 115, 150, false, field);
  wallScreen(context, width - 285, 150, true, field);
}

function boardPanel(
  context: Context,
  livery: Livery | null,
  seat: number,
): void {
  const [width, height] = boardTile;
  context.fillStyle = "#0d1118";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#1f2633";
  context.fillRect(0, height - 4, width, 4);
  const driver = livery?.drivers[seat];
  if (!livery || !driver) return;
  const left = width / 2 - boardHalf;
  const right = width / 2 + boardHalf;
  context.fillStyle = livery.colour;
  context.fillRect(left, 6, 104, height - 18);
  context.beginPath();
  context.moveTo(left + 104, 6);
  context.lineTo(left + 132, 6);
  context.lineTo(left + 104, height - 12);
  context.fill();
  context.fillStyle = livery.brand;
  context.fillRect(left, height - 10, right - left, 5);
  context.font = fontOf(800, 62);
  centred(context, String(driver.number), left + 54, 42, "#ffffff");
  const start = left + 148;
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.font = fontOf(500, 28);
  context.fillStyle = "#c3cad6";
  context.fillText(driver.first, start, 42);
  const reach = start + context.measureText(`${driver.first} `).width;
  const last = driver.last.toUpperCase();
  fit(context, last, 32, 800, right - 64 - reach);
  context.fillStyle = "#ffffff";
  context.fillText(last, reach, 42);
  const full = livery.fullName.toUpperCase();
  fit(context, full, 18, 600, right - 64 - start);
  context.fillStyle = "#8f98a8";
  context.textBaseline = "top";
  context.fillText(full, start, 54);
  context.strokeStyle = "#8f98a8";
  context.lineWidth = 2;
  context.beginPath();
  context.roundRect(right - 52, 14, 52, 32, 5);
  context.stroke();
  context.font = fontOf(700, 20);
  centred(context, driver.nationality, right - 26, 31, "#e6e9ee");
}

function numberPanel(context: Context, number: number): void {
  context.clearRect(0, 0, numberTile, numberTile);
  context.font = fontOf(700, 84);
  centred(
    context,
    String(number),
    numberTile / 2,
    numberTile / 2 + 4,
    "#ffffff",
  );
}

function bandPanel(context: Context): void {
  const width = boardsWidth;
  const fade = context.createLinearGradient(0, 0, 0, bandTall);
  fade.addColorStop(0, "#e9bd12");
  fade.addColorStop(0.12, bandYellow);
  fade.addColorStop(0.88, bandYellow);
  fade.addColorStop(1, "#d9ac10");
  context.fillStyle = fade;
  context.fillRect(0, 0, width, bandTall);
  const span = width / bandLogos;
  for (let k = 0; k < bandLogos; k++) {
    const x = k * span;
    context.save();
    context.translate(x + span / 2, bandTall / 2);
    context.transform(1, 0, slant, 1, 0, 0);
    context.fillStyle = bandInk;
    for (let line = 0; line < 3; line++) {
      const reach = 150 - line * 34;
      context.fillRect(-430 - reach, -44 + line * 34, reach, 18);
    }
    context.font = fontOf(800, 128);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(bandWord, 40, 6);
    context.restore();
  }
}

function inTile(
  context: Context,
  x: number,
  y: number,
  w: number,
  h: number,
  draw: () => void,
): void {
  context.save();
  context.translate(x, y);
  context.beginPath();
  context.rect(0, 0, w, h);
  context.clip();
  draw();
  context.restore();
}

function paintBacks(context: Context, field: Livery[]): void {
  const [w, h] = backTile;
  const [columns, rows] = backGrid;
  for (let index = 0; index < columns * rows; index++) {
    const livery = index === emptyBack ? null : (field[index] ?? null);
    inTile(
      context,
      (index % columns) * w,
      Math.floor(index / columns) * h,
      w,
      h,
      () => {
        backPanel(context, livery, field);
      },
    );
  }
}

function paintBoards(context: Context, field: Livery[]): void {
  const [w, h] = boardTile;
  const [columns, rows] = boardGrid;
  for (let slot = 0; slot < columns * rows; slot++)
    inTile(
      context,
      (slot % columns) * w,
      Math.floor(slot / columns) * h,
      w,
      h,
      () => {
        boardPanel(
          context,
          field[Math.floor(slot / seats)] ?? null,
          slot % seats,
        );
      },
    );
  const [numberColumns, numberRows] = numberGrid;
  for (let index = 0; index < numberColumns * numberRows; index++)
    inTile(
      context,
      (index % numberColumns) * numberTile,
      numbersTop + Math.floor(index / numberColumns) * numberTile,
      numberTile,
      numberTile,
      () => {
        numberPanel(context, index + 1);
      },
    );
  inTile(context, 0, bandTop, boardsWidth, bandTall, () => {
    bandPanel(context);
  });
}

function surface(width: number, height: number): Context {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d context");
  return context;
}

function textureOf(context: Context): THREE.CanvasTexture {
  const map = new THREE.CanvasTexture(context.canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = anisotropy;
  return map;
}

export interface GarageArt {
  back: THREE.CanvasTexture;
  boards: THREE.CanvasTexture;
}

let painted: GarageArt | null = null;

export function garageArt(): GarageArt {
  if (painted) return painted;
  const back = surface(backWidth, backHeight);
  const boards = surface(boardsWidth, boardsHeight);
  const field = liveries();
  const paint = () => {
    paintBacks(back, field);
    paintBoards(boards, field);
  };
  paint();
  const art = { back: textureOf(back), boards: textureOf(boards) };
  const faces = weights.map((weight) => fontOf(weight, 40));
  if (!faces.every((face) => document.fonts.check(face)))
    void Promise.all(faces.map((face) => document.fonts.load(face))).then(
      () => {
        paint();
        art.back.needsUpdate = true;
        art.boards.needsUpdate = true;
      },
    );
  painted = art;
  return art;
}
