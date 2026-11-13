import * as THREE from "three/webgpu";
import {
  box,
  Builder,
  place,
  type Station,
  stationAt,
  up,
  wrap,
} from "./training-layout.ts";
import { beam, wallAt } from "./street-layout.ts";
import { hash } from "./street-shell.ts";
import { boardAt, type BoardSpan, wrapV } from "./trackside-plan.ts";

export interface CraneSpec {
  at: number;
  side: number;
  back: number;
  turn?: number;
}

export interface BankSpec {
  from: number;
  to: number;
  side: number;
  near: number;
  far: number;
  share: number;
}

export interface Zone {
  from: number;
  to: number;
  side: number;
  near: number;
  far: number;
  trees: boolean;
}

export type Height = (x: number, z: number) => number | null;

const cell = 3;
const ringLimit = 6;
const boomLength = 27;
const boomRise = 1.08;
const boomTurn = 0.5;
const hookDrop = 2.5;
const hookLine = 0.12;
const bankRow = 0.95;
const bankSpacing = 0.62;
const bankJitter = 0.3;
const coarse = 6;
const bucketSize = 64;

function keyOf(x: number, z: number): number {
  return Math.floor(x / cell) * 65536 + Math.floor(z / cell);
}

export function heightField(meshes: THREE.Mesh[]): Height {
  const sums = new Map<number, [number, number]>();
  const point = new THREE.Vector3();
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const position = mesh.geometry.getAttribute("position");
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      const key = keyOf(point.x, point.z);
      const entry = sums.get(key) ?? [0, 0];
      entry[0] += point.y;
      entry[1] += 1;
      sums.set(key, entry);
    }
  }
  const mean = (x: number, z: number) => {
    const entry = sums.get(keyOf(x, z));
    return entry ? entry[0] / entry[1] : null;
  };
  return (x, z) => {
    for (let ring = 0; ring <= ringLimit; ring++) {
      let sum = 0;
      let count = 0;
      for (let dx = -ring; dx <= ring; dx++)
        for (let dz = -ring; dz <= ring; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const found = mean(x + dx * cell, z + dz * cell);
          if (found === null) continue;
          sum += found;
          count++;
        }
      if (count > 0) return sum / count;
    }
    return null;
  };
}

interface Rig {
  at: (forward: number, rise: number, left: number) => number[];
  axes: number[][];
}

function rigOf(base: number[], heading: number[], side: number[]): Rig {
  return {
    at: (forward, rise, left) =>
      base.map(
        (value, axis) =>
          value +
          (heading[axis] ?? 0) * forward +
          (up[axis] ?? 0) * rise +
          (side[axis] ?? 0) * left,
      ),
    axes: [heading, up, side],
  };
}

function carrier(body: Builder, dark: Builder, rig: Rig): void {
  box(body, rig.at(0, 1.25, 0), [5.4, 0.45, 1.3], rig.axes);
  box(body, rig.at(4.3, 2.35, 0), [1.1, 0.65, 1.25], rig.axes);
  box(dark, rig.at(5.42, 2.5, 0), [0.03, 0.4, 1.1], rig.axes);
  box(body, rig.at(-1.2, 2.45, 0), [2.4, 0.75, 1.2], rig.axes);
  box(dark, rig.at(-0.2, 2.75, 1.05), [0.8, 0.6, 0.45], rig.axes);
  box(dark, rig.at(-3.9, 2.3, 0), [0.7, 0.6, 1.3], rig.axes);
  for (const axle of [3.6, 1.6, -1.6, -3.6])
    for (const side of [-1.2, 1.2])
      box(dark, rig.at(axle, 0.6, side), [0.6, 0.6, 0.22], rig.axes);
  for (const reach of [-4.6, 4.6]) {
    beam(body, rig.at(reach, 0.9, -3.4), rig.at(reach, 0.9, 3.4), 0.3);
    for (const side of [-3.4, 3.4]) {
      beam(body, rig.at(reach, 0.2, side), rig.at(reach, 0.9, side), 0.22);
      box(dark, rig.at(reach, 0.12, side), [0.4, 0.12, 0.4], rig.axes);
    }
  }
}

function boom(body: Builder, dark: Builder, rig: Rig, turn: number): void {
  const flat = Math.cos(boomRise);
  const along = (reach: number) =>
    rig.at(
      -2.6 + Math.cos(turn) * flat * reach,
      3.3 + Math.sin(boomRise) * reach,
      Math.sin(turn) * flat * reach,
    );
  [0.95, 0.75, 0.55].forEach((size, section) => {
    beam(
      body,
      along((boomLength * section) / 3 - (section > 0 ? 1.5 : 0)),
      along((boomLength * (section + 1)) / 3),
      size,
    );
  });
  const tip = along(boomLength);
  const hook = tip.map((value, axis) => value - (up[axis] ?? 0) * hookDrop);
  beam(dark, tip, hook, hookLine);
  box(dark, hook, [0.16, 0.3, 0.16], rig.axes);
}

export function craneParts(
  list: Station[],
  length: number,
  specs: CraneSpec[],
  ground: Height,
): { body: Builder; dark: Builder } {
  const body = new Builder(1);
  const dark = new Builder(1);
  for (const spec of specs) {
    const station = stationAt(list, length, spec.at);
    const wall = wallAt(station, spec.side);
    const base = place(station, spec.side * (wall + spec.back), 0);
    const [x = 0, , z = 0] = base;
    base[1] = ground(x, z) ?? station.y;
    const heading = [-station.lz, 0, station.lx];
    const side = [station.lx, 0, station.lz];
    const rig = rigOf(base, heading, side);
    carrier(body, dark, rig);
    boom(body, dark, rig, (spec.turn ?? boomTurn) * -spec.side * Math.PI);
  }
  return { body, dark };
}

export function bankSpots(
  list: Station[],
  length: number,
  specs: BankSpec[],
  ground: Height,
): number[] {
  const spots: number[] = [];
  specs.forEach((spec, index) => {
    const span = wrap(spec.to - spec.from, length);
    const columns = Math.floor(span / bankSpacing);
    const rows = Math.floor((spec.far - spec.near) / bankRow);
    for (let column = 0; column < columns; column++)
      for (let row = 0; row < rows; row++) {
        const seed = index * 7919 + column * 31 + row * 0.37;
        if (hash(seed) > spec.share * (1 - (0.6 * row) / rows)) continue;
        const s =
          spec.from + (column + hash(seed + 1) * bankJitter) * bankSpacing;
        const station = stationAt(list, length, s);
        const wall = wallAt(station, spec.side);
        const lateral =
          wall + spec.near + (row + hash(seed + 2) * bankJitter) * bankRow;
        const [x = 0, , z = 0] = place(station, spec.side * lateral, 0);
        const height = ground(x, z);
        if (height !== null) spots.push(x, height, z);
      }
  });
  return spots;
}

const lookups = new WeakMap<Station[], Map<number, Station[]>>();

function bucket(x: number, z: number): number {
  return Math.floor(x / bucketSize) * 4096 + Math.floor(z / bucketSize);
}

function lookupOf(list: Station[]): Map<number, Station[]> {
  const known = lookups.get(list);
  if (known) return known;
  const made = new Map<number, Station[]>();
  for (let i = 0; i < list.length; i += 2) {
    const station = list[i];
    if (!station) continue;
    const key = bucket(station.x, station.z);
    const held = made.get(key);
    if (held) held.push(station);
    else made.set(key, [station]);
  }
  lookups.set(list, made);
  return made;
}

function nearby(list: Station[], x: number, z: number): Station[] {
  const lookup = lookupOf(list);
  const found: Station[] = [];
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++) {
      const held = lookup.get(bucket(x + dx * bucketSize, z + dz * bucketSize));
      if (held) found.push(...held);
    }
  return found.length > 0 ? found : list.filter((_, i) => i % coarse === 0);
}

export function locate(
  list: Station[],
  x: number,
  z: number,
): { station: Station; lateral: number } | null {
  let best: Station | null = null;
  let reach = Infinity;
  for (const station of nearby(list, x, z)) {
    const distance = (station.x - x) ** 2 + (station.z - z) ** 2;
    if (distance < reach) {
      reach = distance;
      best = station;
    }
  }
  if (!best) return null;
  return {
    station: best,
    lateral: (x - best.x) * best.lx + (z - best.z) * best.lz,
  };
}

export function inZone(
  zones: Zone[],
  list: Station[],
  length: number,
  x: number,
  z: number,
): boolean {
  const found = locate(list, x, z);
  if (!found) return false;
  const { station, lateral } = found;
  return zones.some(
    (zone) =>
      Math.sign(lateral) === zone.side &&
      Math.abs(lateral) >= zone.near &&
      Math.abs(lateral) <= zone.far &&
      wrap(station.s - zone.from, length) <= wrap(zone.to - zone.from, length),
  );
}

export function outside(
  values: number[],
  stride: number,
  zones: Zone[],
  list: Station[],
  length: number,
): number[] {
  if (zones.length === 0) return values;
  const kept: number[] = [];
  for (let i = 0; i + stride <= values.length; i += stride) {
    const x = values[i] ?? 0;
    const z = values[i + 2] ?? 0;
    if (inZone(zones, list, length, x, z)) continue;
    for (let k = 0; k < stride; k++) kept.push(values[i + k] ?? 0);
  }
  return kept;
}

export function rebranded(
  geometry: THREE.BufferGeometry,
  list: Station[],
  spans: BoardSpan[],
  stretch = 1,
): void {
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  for (let first = 0; first + 3 < position.count; first += 4) {
    const corners = [first, first + 1, first + 2, first + 3];
    const mean = (pick: (i: number) => number) =>
      corners.reduce((sum, i) => sum + pick(i), 0) / 4;
    const x = mean((i) => position.getX(i));
    const y = mean((i) => position.getY(i));
    const z = mean((i) => position.getZ(i));
    const found = locate(list, x, z);
    if (!found) continue;
    const { station, lateral: side } = found;
    const row = boardAt(spans, station.s, side);
    for (const i of corners)
      uv.setXY(
        i,
        uv.getX(i) * stretch,
        wrapV(row, position.getY(i) > y ? 1 : 0),
      );
  }
  uv.needsUpdate = true;
}

export interface Sector {
  from: number;
  to: number;
  side: number;
}

export function inSector(
  sectors: Sector[],
  list: Station[],
  length: number,
  x: number,
  z: number,
): boolean {
  const found = locate(list, x, z);
  if (!found) return false;
  const { station, lateral } = found;
  return sectors.some(
    (sector) =>
      (sector.side === 0 || Math.sign(lateral) === sector.side) &&
      wrap(station.s - sector.from, length) <=
        wrap(sector.to - sector.from, length),
  );
}

export function without(
  geometry: THREE.BufferGeometry,
  gone: (x: number, z: number) => boolean,
): void {
  const index = geometry.getIndex();
  const position = geometry.getAttribute("position");
  if (!index) return;
  const kept: number[] = [];
  for (let i = 0; i + 2 < index.count; i += 3) {
    const corners = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    const x = corners.reduce((sum, k) => sum + position.getX(k), 0) / 3;
    const z = corners.reduce((sum, k) => sum + position.getZ(k), 0) / 3;
    if (!gone(x, z)) kept.push(...corners);
  }
  geometry.setIndex(kept);
}

export interface Marker {
  at: number;
  side: number;
  metres: number;
}

const markerValues = [200, 150, 100, 50];
const markerWide = 1.15;
const markerTall = 0.58;
const markerLow = 0.3;
const markerOut = 5.4;
const markerInside = 1.2;
const markerClear = 1.6;
const markerPost = 0.06;

export function markerParts(
  list: Station[],
  length: number,
  markers: Marker[],
  ground: Height,
  row: number,
): { faces: Builder; posts: Builder } {
  const faces = new Builder(1);
  const posts = new Builder(1);
  for (const marker of markers) {
    const station = stationAt(list, length, marker.at);
    const cellAt = Math.max(0, markerValues.indexOf(marker.metres));
    const room = wallAt(station, marker.side) - markerInside;
    if (room < station.half + markerClear) continue;
    const out = Math.min(station.half + markerOut, room);
    const [x = 0, , z = 0] = place(station, marker.side * out, 0);
    const base = [x, ground(x, z) ?? station.y, z];
    const across = [station.lx, 0, station.lz];
    const back = [station.lz, 0, -station.lx];
    const corner = (share: number, rise: number) =>
      base.map(
        (value, axis) =>
          value +
          (across[axis] ?? 0) * share * markerWide * marker.side +
          (up[axis] ?? 0) * rise,
      );
    const first = faces.count;
    const cells = markerValues.length;
    const spots: [number, number][] = [
      [-0.5, 0],
      [0.5, 0],
      [0.5, 1],
      [-0.5, 1],
    ];
    for (const [share, rise] of spots)
      faces.vertex(corner(share, markerLow + rise * markerTall), back, [
        [
          (cellAt + 0.5 + share * marker.side * -0.94) / cells,
          wrapV(row, 0.04 + rise * 0.92),
        ],
      ]);
    faces.quad(first, first + 1, first + 2, first + 3);
    for (const share of [-0.42, 0.42])
      beam(posts, corner(share, -0.3), corner(share, markerLow), markerPost);
  }
  return { faces, posts };
}

export interface Lot {
  from: number;
  to: number;
  side: number;
  lateral: number;
  rows: number;
}

const carLong = 4.5;
const carWide = 1.85;
const bay = 2.7;
const laneGap = 6.5;
const lotFill = 0.82;

export function carPark(
  list: Station[],
  length: number,
  lots: Lot[],
  ground: Height,
): { paint: Builder[]; glass: Builder } {
  const paint = [new Builder(1), new Builder(1), new Builder(1)];
  const glass = new Builder(1);
  lots.forEach((lot, index) => {
    const span = wrap(lot.to - lot.from, length);
    const bays = Math.floor(span / bay);
    for (let row = 0; row < lot.rows; row++)
      for (let k = 0; k < bays; k++) {
        const seed = index * 131 + row * 17 + k * 0.731;
        if (hash(seed) > lotFill) continue;
        const station = stationAt(list, length, lot.from + (k + 0.5) * bay);
        const lateral =
          lot.lateral + row * carLong + Math.floor((row + 1) / 2) * laneGap;
        const [x = 0, , z = 0] = place(station, lot.side * lateral, 0);
        const height = ground(x, z);
        if (height === null) continue;
        const axes = [
          [station.lx, 0, station.lz],
          up,
          [-station.lz, 0, station.lx],
        ];
        const body = paint[Math.floor(hash(seed + 3) * paint.length)];
        if (!body) continue;
        box(
          body,
          [x, height + 0.62, z],
          [carLong / 2, 0.36, carWide / 2],
          axes,
        );
        box(
          glass,
          [x, height + 1.2, z],
          [carLong * 0.28, 0.24, carWide * 0.46],
          axes,
        );
      }
  });
  return { paint, glass };
}

export interface TentRow {
  from: number;
  to: number;
  side: number;
  lateral: number;
  deep: number;
}

const tentWide = 10;
const tentEave = 3.4;
const tentPeak = 2.4;
const tentBand = 1;

export function tentRows(
  list: Station[],
  length: number,
  rows: TentRow[],
  ground: Height,
): { cloth: Builder; band: Builder } {
  const cloth = new Builder(1);
  const band = new Builder(1);
  for (const row of rows) {
    const span = wrap(row.to - row.from, length);
    const count = Math.max(1, Math.floor(span / tentWide));
    for (let k = 0; k < count; k++) {
      const station = stationAt(list, length, row.from + (k + 0.5) * tentWide);
      const [x = 0, , z = 0] = place(
        station,
        row.side * (row.lateral + row.deep / 2),
        0,
      );
      const base = ground(x, z);
      if (base === null) continue;
      const along = [-station.lz, 0, station.lx];
      const across = [station.lx, 0, station.lz];
      const axes = [along, up, across];
      const half = [tentWide / 2 - 0.05, 0, row.deep / 2];
      box(
        band,
        [x, base + tentBand / 2, z],
        [half[0] ?? 0, tentBand / 2, half[2] ?? 0],
        axes,
      );
      box(
        cloth,
        [x, base + tentBand + (tentEave - tentBand) / 2, z],
        [half[0] ?? 0, (tentEave - tentBand) / 2, half[2] ?? 0],
        axes,
      );
      const at = (a: number, c: number, rise: number) =>
        [x, base + rise, z].map(
          (value, axis) =>
            value +
            (along[axis] ?? 0) * a * (half[0] ?? 0) +
            (across[axis] ?? 0) * c * (half[2] ?? 0),
        );
      const peak = at(0, 0, tentEave + tentPeak);
      const rim: [number, number][] = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ];
      rim.forEach(([a, c], i) => {
        const [na = 0, nc = 0] = rim[(i + 1) % rim.length] ?? [];
        const first = cloth.count;
        const normal = [
          (along[0] ?? 0) * (a + na) * 0.35 +
            (across[0] ?? 0) * (c + nc) * 0.35,
          0.7,
          (along[2] ?? 0) * (a + na) * 0.35 +
            (across[2] ?? 0) * (c + nc) * 0.35,
        ];
        cloth.vertex(at(a, c, tentEave), normal, [[0, 0]]);
        cloth.vertex(at(na, nc, tentEave), normal, [[1, 0]]);
        cloth.vertex(peak, normal, [[0.5, 1]]);
        cloth.index.push(first, first + 1, first + 2);
      });
    }
  }
  return { cloth, band };
}

export interface Pylon {
  x: number;
  z: number;
  tall: number;
  wide: number;
  turn?: number;
}

const pylonRows = 10;
const pylonFoot = 2.4;
const pylonHead = 2.6;
const pylonCap = 1.35;
const pylonDigit = 0.55;

export function pylonParts(
  pylons: Pylon[],
  ground: Height,
): { body: Builder; lamps: Builder } {
  const body = new Builder(1);
  const lamps = new Builder(1);
  for (const pylon of pylons) {
    const turn = pylon.turn ?? 0;
    const along = [Math.cos(turn), 0, Math.sin(turn)];
    const across = [-Math.sin(turn), 0, Math.cos(turn)];
    const axes = [along, up, across];
    const base = ground(pylon.x, pylon.z) ?? 0;
    const half = pylon.wide / 2;
    const shaft = pylon.tall - pylonHead;
    box(
      body,
      [pylon.x, base + shaft / 2, pylon.z],
      [half, shaft / 2, half],
      axes,
    );
    box(
      body,
      [pylon.x, base + shaft + pylonHead / 2, pylon.z],
      [half * pylonCap, pylonHead / 2, half * pylonCap],
      axes,
    );
    const pitch = (shaft - pylonFoot) / pylonRows;
    const faces = [
      [along, across],
      [across, along],
    ].flatMap(([out = up, slide = up]) =>
      [1, -1].map((sign) => [out.map((value) => value * sign), slide]),
    );
    for (let row = 0; row < pylonRows; row++)
      for (const [out = up, slide = up] of faces)
        box(
          lamps,
          [pylon.x, base + pylonFoot + (row + 0.5) * pitch, pylon.z].map(
            (value, axis) =>
              value +
              (out[axis] ?? 0) * (half + 0.03) +
              (slide[axis] ?? 0) * half * pylonDigit,
          ),
          [0.02, pitch * 0.3, half * 0.24],
          [out, up, slide],
        );
  }
  return { body, lamps };
}

export interface Post {
  at: number;
  side: number;
}

const postBack = 1.8;
const hutSize = [1.1, 1.15, 0.9];
const panelSize = [0.5, 0.36, 0.06];
const panelLift = 3.1;
const panelBack = 1;
const panelAhead = -2.5;
const plateSize = [0.3, 0.36, 0.03];
const plateLift = 3.3;
const plateAhead = 1.6;
const postPole = 0.09;

export function postParts(
  list: Station[],
  length: number,
  posts: Post[],
  ground: Height,
): { dark: Builder; plate: Builder; marshals: number[] } {
  const dark = new Builder(1);
  const plate = new Builder(1);
  const marshals: number[] = [];
  for (const post of posts) {
    const spot = (ahead: number, back: number) => {
      const station = stationAt(list, length, post.at + ahead);
      const wall = wallAt(station, post.side);
      const [x = 0, , z = 0] = place(station, post.side * (wall + back), 0);
      const base = [x, ground(x, z) ?? station.y, z];
      const axes = [
        [station.lx, 0, station.lz],
        up,
        [-station.lz, 0, station.lx],
      ];
      return { axes, at: (rise: number) => [x, (base[1] ?? 0) + rise, z] };
    };
    const [wide = 0, tall = 0] = hutSize;
    const hut = spot(0, postBack + wide);
    box(dark, hut.at(tall), hutSize, hut.axes);
    const panel = spot(panelAhead, panelBack);
    beam(dark, panel.at(-0.3), panel.at(panelLift), postPole);
    box(dark, panel.at(panelLift), panelSize, panel.axes);
    const sign = spot(plateAhead, postBack);
    beam(dark, sign.at(-0.3), sign.at(plateLift), postPole);
    box(plate, sign.at(plateLift), plateSize, sign.axes);
    for (const ahead of [-1.1, 0.2, 1.1])
      marshals.push(...spot(ahead, postBack - 0.5).at(0));
  }
  return { dark, plate, marshals };
}
