import * as THREE from "three/webgpu";
import {
  addCap,
  addLedge,
  addWalls,
  centroid,
  cornerOf,
  grown,
  hash,
  inside,
  type Mesh,
  type Shell,
  signedArea,
  slopePart,
} from "./street-shell.ts";

export const copperTone = 2;

const mansardRun = 2.4;
const mansardRise = 3.6;
const mansardKeep = 0.35;
const eaveReach = 0.4;
const eaveDepth = 0.32;
const eaveStrip = 1.25;
const eaveLight = 0.5;
const slopeLight = 0.6;
const spireLow = 7;
const spireHigh = 24;
const spireShare = 1.1;
const balconyReach = 1.15;
const balconySlab = 0.16;
const balconyRail = 1.05;
const railLight = 0.1;
const awningReach = 1.7;
const awningDepth = 0.45;
const awningLight = 1.1;
const clutterArea = 1400;
const clutterLight = 0.05;
const clutterTries = 12;

function inset(
  ring: THREE.Vector2[],
  outward: number,
  by: number,
): THREE.Vector2[] | null {
  const inner = grown(ring, outward, -by);
  const before = signedArea(ring);
  const after = signedArea(inner);
  if (before * after <= 0 || Math.abs(after) < Math.abs(before) * mansardKeep)
    return null;
  const kept = ring.every((a, i) => {
    const b = cornerOf(ring, i + 1);
    const c = cornerOf(inner, i);
    const d = cornerOf(inner, i + 1);
    return (b.x - a.x) * (d.x - c.x) + (b.y - a.y) * (d.y - c.y) > 0;
  });
  return kept ? inner : null;
}

function addSlope(
  mesh: Mesh,
  shell: Shell,
  outer: THREE.Vector2[],
  inner: THREE.Vector2[],
  low: number,
  high: number,
  tone: number,
): void {
  outer.forEach((a, i) => {
    const b = cornerOf(outer, i + 1);
    const c = cornerOf(inner, i + 1);
    const d = cornerOf(inner, i);
    const span = a.distanceTo(b) || 1;
    const nx = ((a.y - b.y) / span) * shell.outward;
    const nz = ((b.x - a.x) / span) * shell.outward;
    mesh.quad(
      [
        [a.x, low, a.y],
        [b.x, low, b.y],
        [c.x, high, c.y],
        [d.x, high, d.y],
      ],
      [nx * 0.7, 0.7, nz * 0.7],
      [
        [slopeLight, tone],
        [slopeLight, tone],
        [slopeLight * 0.4, tone],
        [slopeLight * 0.4, tone],
      ],
      [shell.seed, slopePart],
      [shell.total, shell.row],
    );
  });
}

function addEave(mesh: Mesh, shell: Shell, top: number): void {
  addLedge(mesh, shell, top, eaveReach, eaveDepth);
  addWalls(
    mesh,
    { ...shell, ring: grown(shell.ring, shell.outward, 0.05) },
    top - eaveDepth - eaveLight,
    top - eaveDepth,
    eaveStrip,
  );
}

export function addMansard(
  mesh: Mesh,
  shell: Shell,
  top: number,
  tone: number,
): boolean {
  const inner = inset(shell.ring, shell.outward, mansardRun);
  if (!inner) return false;
  addEave(mesh, shell, top);
  addSlope(mesh, shell, shell.ring, inner, top, top + mansardRise, tone);
  addCap(mesh, shell, inner, top + mansardRise);
  return true;
}

export function addSpire(
  mesh: Mesh,
  shell: Shell,
  top: number,
  tone: number,
): boolean {
  const peak = centroid(shell.ring);
  if (!inside(shell.ring, peak)) return false;
  const rise = THREE.MathUtils.clamp(
    Math.sqrt(Math.abs(signedArea(shell.ring))) * spireShare,
    spireLow,
    spireHigh,
  );
  addEave(mesh, shell, top);
  addSlope(
    mesh,
    shell,
    shell.ring,
    shell.ring.map(() => peak),
    top,
    top + rise,
    tone,
  );
  return true;
}

export function addBalconies(
  mesh: Mesh,
  shell: Shell,
  base: number,
  storey: number,
): void {
  const floors = Math.floor(shell.total / storey);
  const edge = grown(shell.ring, shell.outward, balconyReach);
  for (let k = 2; k < floors - 1; k++) {
    const y = base + k * storey + 0.1;
    addLedge(mesh, shell, y, balconyReach, balconySlab);
    addWalls(mesh, { ...shell, ring: edge }, y, y + balconyRail, railLight);
  }
}

export function addAwning(mesh: Mesh, shell: Shell, y: number): void {
  addLedge(mesh, shell, y + awningDepth, awningReach, awningDepth);
  addWalls(
    mesh,
    { ...shell, ring: grown(shell.ring, shell.outward, awningReach + 0.04) },
    y + awningDepth * 0.2,
    y + awningDepth * 0.8,
    awningLight,
  );
}

export function addClutter(mesh: Mesh, shell: Shell, top: number): void {
  const area = Math.abs(signedArea(shell.ring));
  if (area < clutterArea) return;
  const box = new THREE.Box2().setFromPoints(shell.ring);
  const count = 2 + Math.floor(hash(shell.seed * 3.3) * 4);
  for (let k = 0; k < count; k++)
    for (let attempt = 0; attempt < clutterTries; attempt++) {
      const roll = (salt: number) =>
        hash(shell.seed * 17.1 + k * 5.3 + attempt * 1.9 + salt);
      const at = new THREE.Vector2(
        THREE.MathUtils.lerp(box.min.x, box.max.x, roll(0.1)),
        THREE.MathUtils.lerp(box.min.y, box.max.y, roll(0.2)),
      );
      const half = new THREE.Vector2(2 + roll(0.3) * 3.5, 1.5 + roll(0.4) * 2);
      const corners = [
        new THREE.Vector2(at.x - half.x, at.y - half.y),
        new THREE.Vector2(at.x + half.x, at.y - half.y),
        new THREE.Vector2(at.x + half.x, at.y + half.y),
        new THREE.Vector2(at.x - half.x, at.y + half.y),
      ];
      if (!corners.every((corner) => inside(shell.ring, corner))) continue;
      const unit = { ...shell, ring: corners, outward: -1 };
      const rise = 1.8 + roll(0.5) * 2;
      addWalls(mesh, unit, top, top + rise, clutterLight);
      addCap(mesh, unit, corners, top + rise);
      break;
    }
}
