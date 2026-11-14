import * as THREE from "three/webgpu";
import {
  abs,
  atan,
  length,
  mx_noise_float,
  vec2,
  exp,
  float,
  floor,
  fract,
  fwidth,
  max,
  mix,
  sin,
  smoothstep,
  step,
  time,
  uv,
  vec3,
} from "three/tsl";
import { Vector2 } from "three";
import { ringOf } from "./desert-buildings.ts";
import { SkyLitMaterial } from "./sky-ambient.ts";
import { cityGlow } from "./street-city.ts";
import { Boxes } from "./street-landmarks.ts";

interface ArenaSpot {
  ring: number[];
  height: number;
}

interface TowerSpot {
  ring: number[];
  floors: number;
}

export interface DesertLandmarks {
  arena?: ArenaSpot;
  tower?: TowerSpot;
}

type Node = THREE.Node<"float">;
type Node3 = THREE.Node<"vec3">;

const arenaColumns = 448;
const arenaRows = 44;
const arenaPodium = 6.5;
const arenaInset = 0.955;
const arenaSquareness = 2.7;
const arenaSmoothing = 3;
const arenaDiamonds = 40;
const arenaCrease = 0.9;
const arenaRise = 6.5;
const arenaLine = 0.036;
const arenaGlow = 1.9;
const arenaDot = 0.07;
const arenaDotGrid = 4;
const arenaDotGlow = 2.2;
const arenaPanel: [number, number, number] = [0.02, 0.005, 0.034];
const arenaPanelPale: [number, number, number] = [0.07, 0.05, 0.1];
const arenaRibLow: [number, number, number] = [0.82, 0.38, 1];
const arenaRibHigh: [number, number, number] = [0.95, 0.32, 0.9];
const arenaDotPink: [number, number, number] = [1, 0.42, 0.85];
const arenaValley = 0.22;
const arenaValleyAt = 0.12;
const arenaValleyWide = 0.24;
const arenaCrownFrom = 0.84;
const arenaCrownSink = 0.05;
const arenaMagenta: [number, number, number] = [0.62, 0.12, 0.92];
const arenaDeck = 1.09;
const arenaFascia = 1.3;
const arenaDeckGlow = 0.34;
const arenaLipGlow = 2.4;
const arenaColumnStep = 5;
const plazaStone: [number, number, number] = [0.42, 0.34, 0.3];
const plazaJoint: [number, number, number] = [0.3, 0.25, 0.22];
const plazaSpill = 0.35;
const gardenReach = 70;
const gardenPromenade = 20;
const gardenRings = [32, 58];
const gardenRadialEvery = 46;
const gardenMedallionEvery = 92;
const gardenMedallionAt = 45;
const gardenMedallionRadius = 10;
const gardenGreen: [number, number, number] = [0.09, 0.16, 0.07];
const gardenShrub: [number, number, number] = [0.045, 0.09, 0.04];
const gardenLampGlow = 2.6;
const gardenSpill = 8;
const plazaRows = 10;
const towerSides = 120;
const towerFloor = 4.4;
const towerSlab = 0.75;
const towerLobby = 5.5;
const towerColumns = 7;
const towerBranches = 3;
const discRings = 14;
const discDome = 0.7;
const discDepth = 1.5;
const discRibs = 48;
const discSeam = 2.6;
const discOculus = 2.2;
const discFins = 180;
const discLed = 2.2;
const discBeams = 24;
const discLightRing = 3;
const discDownlight = 1.1;

function resampled(ring: Vector2[], count: number): Vector2[] {
  const lengths = ring.map((p, i) =>
    p.distanceTo(ring[(i + 1) % ring.length] ?? p),
  );
  const total = lengths.reduce((a, b) => a + b, 0);
  const out: Vector2[] = [];
  let edge = 0;
  let walked = 0;
  for (let k = 0; k < count; k++) {
    const goal = (k / count) * total;
    while (walked + (lengths[edge] ?? 0) < goal && edge < ring.length - 1) {
      walked += lengths[edge] ?? 0;
      edge++;
    }
    const a = ring[edge] ?? new Vector2();
    const b = ring[(edge + 1) % ring.length] ?? a;
    const share = (goal - walked) / Math.max(1e-6, lengths[edge] ?? 1);
    out.push(a.clone().lerp(b, share));
  }
  return out;
}

function smoothed(ring: Vector2[], passes: number): Vector2[] {
  let out = ring;
  for (let pass = 0; pass < passes; pass++)
    out = out.map((p, i) => {
      const before = out[(i - 1 + out.length) % out.length] ?? p;
      const after = out[(i + 1) % out.length] ?? p;
      return p
        .clone()
        .multiplyScalar(2)
        .add(before)
        .add(after)
        .multiplyScalar(0.25);
    });
  return out;
}

function centroid(ring: Vector2[]): Vector2 {
  let area = 0;
  const sum = new Vector2();
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length] ?? a;
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    sum.x += (a.x + b.x) * cross;
    sum.y += (a.y + b.y) * cross;
  });
  return sum.multiplyScalar(1 / (3 * area));
}

class Sheet {
  readonly positions: number[] = [];
  readonly uvs: number[] = [];
  readonly index: number[] = [];

  vertex(x: number, y: number, z: number, u: number, v: number): number {
    this.positions.push(x, y, z);
    this.uvs.push(u, v);
    return this.positions.length / 3 - 1;
  }

  grid(rows: number, columns: number, first: number): void {
    for (let j = 0; j + 1 < rows; j++)
      for (let i = 0; i + 1 < columns; i++) {
        const a = first + j * columns + i;
        const b = a + columns;
        this.index.push(a, b, a + 1, a + 1, b, b + 1);
      }
  }

  geometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(this.positions, 3),
    );
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.setIndex(this.index);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

function seamed(geometry: THREE.BufferGeometry, columns: number): void {
  const normal = geometry.getAttribute("normal");
  for (let start = 0; start + columns < normal.count; start += columns + 1) {
    const end = start + columns;
    const n = new THREE.Vector3(
      normal.getX(start) + normal.getX(end),
      normal.getY(start) + normal.getY(end),
      normal.getZ(start) + normal.getZ(end),
    ).normalize();
    normal.setXYZ(start, n.x, n.y, n.z);
    normal.setXYZ(end, n.x, n.y, n.z);
  }
}

function lines(a: Node, width: number): Node {
  const d = abs(fract(a.add(0.5)).sub(0.5));
  const blur = max(fwidth(a), float(1e-4));
  return float(1).sub(smoothstep(float(width).sub(blur), blur.add(width), d));
}

interface Arena {
  ring: Vector2[];
  centre: Vector2;
  base: number;
  height: number;
}

function arenaFrame(spot: ArenaSpot, base: number): Arena {
  const ring = smoothed(
    resampled(ringOf(spot.ring), arenaColumns),
    arenaSmoothing,
  );
  return { ring, centre: centroid(ring), base, height: spot.height };
}

function around(arena: Arena, share: number, i: number): [number, number] {
  const p = arena.ring[i % arena.ring.length] ?? arena.centre;
  return [
    arena.centre.x + (p.x - arena.centre.x) * share,
    arena.centre.y + (p.y - arena.centre.y) * share,
  ];
}

function reaches(arena: Arena): number[] {
  const far = arena.ring.map((p) => p.distanceTo(arena.centre));
  const widest = Math.max(...far);
  return far.map((r) => r / widest);
}

function longAxis(arena: Arena): { axis: Vector2; half: number } {
  let xx = 0;
  let xz = 0;
  let zz = 0;
  for (const p of arena.ring) {
    const dx = p.x - arena.centre.x;
    const dz = p.y - arena.centre.y;
    xx += dx * dx;
    xz += dx * dz;
    zz += dz * dz;
  }
  const turn = 0.5 * Math.atan2(2 * xz, xx - zz);
  const axis = new Vector2(Math.cos(turn), Math.sin(turn));
  const half = Math.max(
    ...arena.ring.map((p) => Math.abs(p.clone().sub(arena.centre).dot(axis))),
  );
  return { axis, half };
}

function lobed(along: number, angle: number): number {
  const valley = Math.exp(-(((along - arenaValleyAt) / arenaValleyWide) ** 2));
  const upper = Math.sin(angle) ** 1.4;
  return 1 - arenaValley * valley * upper;
}

function sunken(v: number): number {
  const t = Math.min(
    1,
    Math.max(0, (v - arenaCrownFrom) / (1 - arenaCrownFrom)),
  );
  return 1 - arenaCrownSink * t * t * (3 - 2 * t);
}

function shellGeometry(arena: Arena): THREE.BufferGeometry {
  const sheet = new Sheet();
  const power = 2 / arenaSquareness;
  const rise = arena.height - arenaPodium;
  const reach = reaches(arena);
  const { axis, half } = longAxis(arena);
  for (let j = 0; j <= arenaRows; j++) {
    const v = j / arenaRows;
    const angle = v * (Math.PI / 2);
    const share = Math.cos(angle) ** power;
    const lift = Math.sin(angle) ** power;
    const fold = Math.sin(2 * angle) * arenaCrease;
    for (let i = 0; i <= arenaColumns; i++) {
      const [x, z] = around(arena, share, i);
      const rim = arena.ring[i % arenaColumns] ?? arena.centre;
      const along = rim.clone().sub(arena.centre).dot(axis) / half;
      const dip = 1 - fold * (1 - (reach[i % arenaColumns] ?? 1));
      const height = lift * rise * dip * lobed(along, angle) * sunken(v);
      sheet.vertex(
        x,
        arena.base + arenaPodium + height,
        z,
        i / arenaColumns,
        v,
      );
    }
  }
  sheet.grid(arenaRows + 1, arenaColumns + 1, 0);
  const geometry = sheet.geometry();
  seamed(geometry, arenaColumns);
  return geometry;
}

function twinkle(cell: Node): Node {
  const seed = fract(sin(cell.mul(78.233)).mul(43758.5453));
  const pulse = sin(time.mul(seed.mul(1.7).add(0.4)).add(seed.mul(40)));
  return step(0.55, seed).mul(pulse.mul(0.35).add(0.65));
}

function cellHash(cell: Node): Node {
  return fract(sin(cell.mul(12.9898)).mul(43758.5453));
}

function lattice(): Node3 {
  const u = uv().x;
  const v = uv().y;
  const across = u.mul(arenaDiamonds);
  const climb = v.mul(arenaRise);
  const a = across.add(climb);
  const b = across.sub(climb);
  const crown = smoothstep(arenaCrownFrom - 0.04, arenaCrownFrom + 0.04, v);
  const open = float(1).sub(crown);
  const left = lines(a, arenaLine).mul(open);
  const right = lines(b, arenaLine).mul(open);
  const lip = smoothstep(0.012, 0.004, abs(v.sub(arenaCrownFrom)));
  const rings = lines(
    v
      .sub(arenaCrownFrom)
      .div(1 - arenaCrownFrom)
      .mul(5),
    0.05,
  )
    .mul(crown)
    .mul(0.7)
    .add(lip.mul(1.2));
  const knots = left.mul(right);
  const cell = floor(a).add(floor(b).mul(131));
  const sub = floor(a.mul(2))
    .mul(7)
    .add(floor(b.mul(2)));
  const dots = lines(a.mul(arenaDotGrid), arenaDot)
    .mul(lines(b.mul(arenaDotGrid), arenaDot))
    .mul(float(1).sub(max(lines(a, 0.12), lines(b, 0.12))))
    .mul(twinkle(cell.add(sub)))
    .mul(open);
  const sweep = sin(u.mul(Math.PI * 4).sub(time.mul(0.1)))
    .mul(0.1)
    .add(0.9);
  const ribs = max(max(left, right), rings);
  const tint = mix(
    vec3(...arenaRibLow),
    vec3(...arenaRibHigh),
    smoothstep(0.1, 0.8, v),
  );
  const hot = mix(tint, vec3(1, 0.92, 1), knots.clamp(0, 1));
  const dotTint = mix(
    vec3(0.95, 0.9, 1),
    vec3(...arenaDotPink),
    smoothstep(0.25, 0.6, v),
  );
  const dotGain = mix(float(0.6), float(1), smoothstep(0.2, 0.6, v));
  return hot
    .mul(ribs.add(knots).mul(sweep).mul(arenaGlow))
    .add(dotTint.mul(dots.mul(dotGain).mul(arenaDotGlow)));
}

function panelTone(): Node3 {
  const u = uv().x;
  const v = uv().y;
  const a = u.mul(arenaDiamonds).add(v.mul(arenaRise));
  const b = u.mul(arenaDiamonds).sub(v.mul(arenaRise));
  const roll = cellHash(floor(a).add(floor(b).mul(131)));
  const pale = step(0.82, roll).mul(smoothstep(0.55, 0.15, v));
  const violet = vec3(...arenaPanel).mul(roll.mul(0.8).add(0.6));
  return mix(violet, vec3(...arenaPanelPale), pale);
}

function shellMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new SkyLitMaterial({ side: THREE.DoubleSide });
  material.colorNode = vec3(0.012, 0.006, 0.02);
  material.roughnessNode = float(0.2);
  material.metalnessNode = float(0.6);
  material.emissiveNode = lattice().add(panelTone()).mul(cityGlow);
  return material;
}

function podiumGeometry(arena: Arena): THREE.BufferGeometry {
  const sheet = new Sheet();
  for (const h of [0, arenaPodium - arenaFascia])
    for (let i = 0; i <= arenaColumns; i++) {
      const [x, z] = around(arena, arenaInset, i);
      sheet.vertex(
        x,
        arena.base + h,
        z,
        i / arenaColumns,
        h / (arenaPodium - arenaFascia),
      );
    }
  sheet.grid(2, arenaColumns + 1, 0);
  return sheet.geometry();
}

function podiumMaterial(perimeter: number): THREE.MeshStandardNodeMaterial {
  const material = new SkyLitMaterial({ side: THREE.DoubleSide });
  const u = uv().x.mul(perimeter / 3.2);
  const v = uv().y;
  const mullion = lines(u, 0.06);
  const lobby = smoothstep(0.08, 0.16, v).mul(smoothstep(0.9, 0.8, v));
  material.colorNode = vec3(0.04, 0.045, 0.05);
  material.roughnessNode = float(0.2);
  material.metalnessNode = float(0.5);
  material.emissiveNode = vec3(1, 0.74, 0.5)
    .mul(lobby.mul(float(1).sub(mullion)).mul(0.7))
    .mul(cityGlow);
  return material;
}

function deckGeometry(arena: Arena): THREE.BufferGeometry {
  const sheet = new Sheet();
  const top = arena.base + arenaPodium;
  const rows: [number, number, number][] = [
    [0.985, top, 0],
    [arenaDeck, top, 0.8],
    [arenaDeck, top - arenaFascia, 1],
  ];
  for (const [share, h, v] of rows)
    for (let i = 0; i <= arenaColumns; i++) {
      const [x, z] = around(arena, share, i);
      sheet.vertex(x, h, z, i / arenaColumns, v);
    }
  sheet.grid(rows.length, arenaColumns + 1, 0);
  return sheet.geometry();
}

function deckMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new SkyLitMaterial({ side: THREE.DoubleSide });
  const v = uv().y;
  const deck = float(1).sub(step(0.8, v));
  const wash = exp(v.mul(-3.2)).mul(0.75).add(0.22).mul(deck);
  const lip = smoothstep(0.76, 0.8, v).mul(smoothstep(0.86, 0.81, v));
  const strip = smoothstep(0.93, 0.97, v);
  material.colorNode = vec3(0.05, 0.04, 0.06);
  material.roughnessNode = float(0.35);
  material.emissiveNode = vec3(...arenaMagenta)
    .mul(wash.mul(arenaDeckGlow))
    .add(vec3(1, 0.55, 1).mul(lip.add(strip.mul(0.6)).mul(arenaLipGlow)))
    .mul(cityGlow);
  return material;
}

function columnsMesh(arena: Arena): THREE.Mesh {
  const boxes = new Boxes();
  for (let i = 0; i < arenaColumns; i += arenaColumnStep) {
    const [x, z] = around(arena, arenaDeck - 0.012, i);
    boxes.beam(
      new THREE.Vector3(x, arena.base, z),
      new THREE.Vector3(x, arena.base + arenaPodium - arenaFascia, z),
      0.7,
    );
  }
  const material = new SkyLitMaterial();
  material.colorNode = vec3(0.6, 0.58, 0.56);
  material.roughnessNode = float(0.6);
  return new THREE.Mesh(boxes.geometry(), material);
}

function meanReach(arena: Arena): number {
  return (
    arena.ring.reduce((sum, p) => sum + p.distanceTo(arena.centre), 0) /
    arena.ring.length
  );
}

function plazaGeometry(arena: Arena): THREE.BufferGeometry {
  const sheet = new Sheet();
  const radius = meanReach(arena);
  const perimeter = perimeterOf(arena.ring) * arenaDeck;
  const from = arenaInset;
  const to = arenaDeck + gardenReach / radius;
  for (let j = 0; j <= plazaRows; j++) {
    const share = from + ((to - from) * j) / plazaRows;
    for (let i = 0; i <= arenaColumns; i++) {
      const [x, z] = around(arena, share, i);
      sheet.vertex(
        x,
        arena.base + 0.06,
        z,
        (i / arenaColumns) * perimeter,
        (share - arenaDeck) * radius,
      );
    }
  }
  sheet.grid(plazaRows + 1, arenaColumns + 1, 0);
  const geometry = sheet.geometry();
  const normal = geometry.getAttribute("normal");
  for (let i = 0; i < normal.count; i++) normal.setXYZ(i, 0, 1, 0);
  return geometry;
}

function belt(w: Node, centre: number, half: number): Node {
  const blur = fwidth(w).max(0.02);
  return smoothstep(blur.add(half), float(half).sub(blur), w.sub(centre).abs());
}

interface Garden {
  path: Node;
  bed: Node;
  lights: Node;
  water: Node;
}

function medallions(along: Node, w: Node): Garden {
  const slot = along.div(gardenMedallionEvery).sub(0.5);
  const local = vec2(
    fract(slot).sub(0.5).mul(gardenMedallionEvery),
    w.sub(gardenMedallionAt),
  );
  const r = length(local);
  const ring = belt(r, gardenMedallionRadius - 1.4, 1.1);
  const inner = smoothstep(
    gardenMedallionRadius - 2.6,
    gardenMedallionRadius - 3.2,
    r,
  );
  const water = smoothstep(1.8, 1.4, r);
  const spoke = belt(
    abs(
      atan(local.y, local.x)
        .mul(6 / Math.PI)
        .fract()
        .sub(0.5),
    ).mul(r),
    0,
    0.5,
  ).mul(inner);
  const lamps = belt(
    fract(
      atan(local.y, local.x)
        .div(Math.PI * 2)
        .mul(12),
    ),
    0.5,
    0.06,
  ).mul(belt(r, gardenMedallionRadius - 0.2, 0.25));
  return { path: ring.max(spoke).max(water), bed: inner, lights: lamps, water };
}

function garden(): Garden {
  const along = uv().x;
  const w = uv().y;
  const wavy = along.add(sin(w.div(9)).mul(5));
  const radial = belt(
    fract(wavy.div(gardenRadialEvery)),
    0.5,
    1.3 / gardenRadialEvery,
  );
  const rings = gardenRings.reduce<Node>(
    (sum, at) => sum.max(belt(w, at, 2.2)),
    float(0),
  );
  const outer = smoothstep(gardenReach - 2, gardenReach, w);
  const medallion = medallions(along, w);
  const promenade = smoothstep(gardenPromenade + 0.5, gardenPromenade - 0.5, w);
  const path = rings.max(radial).max(medallion.path).max(promenade).max(outer);
  const pathEdge = rings.max(radial);
  const along7 = belt(fract(along.div(7)), 0.5, 0.05);
  const across7 = belt(fract(w.div(7)), 0.5, 0.05);
  const ringLights = gardenRings.reduce<Node>(
    (sum, at) => sum.max(belt(w, at + 1.6, 0.18)),
    float(0),
  );
  const lights = ringLights
    .mul(along7)
    .max(
      belt(fract(wavy.div(gardenRadialEvery)), 0.5, 1.6 / gardenRadialEvery)
        .mul(across7)
        .sub(radial)
        .max(0),
    )
    .max(medallion.lights)
    .mul(step(gardenPromenade, w))
    .mul(float(1).sub(pathEdge.mul(0.5)));
  return { path, bed: float(1).sub(path), lights, water: medallion.water };
}

function plazaMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new SkyLitMaterial({ side: THREE.DoubleSide });
  const along = uv().x;
  const w = uv().y;
  const { bed, lights, water } = garden();
  const slabs = lines(along.div(2.5), 0.03)
    .max(lines(w.div(2.5), 0.03))
    .mul(0.25);
  const paving = mix(vec3(...plazaStone), vec3(...plazaJoint), slabs);
  const tuft = mx_noise_float(vec3(along.mul(0.35), w.mul(0.35), 3.1));
  const pattern = sin(along.div(4.2).add(sin(w.div(3.1)).mul(2.2)))
    .mul(0.5)
    .add(0.5);
  const leaves = mix(
    vec3(...gardenGreen),
    vec3(...gardenShrub),
    smoothstep(0.55, 0.75, pattern).max(smoothstep(0.35, 0.7, tuft)),
  );
  const ground = mix(mix(paving, leaves, bed), vec3(0.02, 0.05, 0.08), water);
  material.colorNode = ground;
  material.roughnessNode = mix(float(0.8), float(0.95), bed);
  material.emissiveNode = vec3(...arenaMagenta)
    .mul(exp(w.max(-20).div(-gardenSpill)).mul(plazaSpill))
    .add(vec3(1, 0.88, 0.7).mul(lights.mul(gardenLampGlow)))
    .add(vec3(0.3, 0.55, 0.9).mul(water.mul(0.25)))
    .mul(cityGlow);
  return material;
}

function perimeterOf(ring: Vector2[]): number {
  return ring.reduce(
    (sum, p, i) => sum + p.distanceTo(ring[(i + 1) % ring.length] ?? p),
    0,
  );
}

function arenaMesh(spot: ArenaSpot, base: number): THREE.Object3D {
  const arena = arenaFrame(spot, base);
  const perimeter = perimeterOf(arena.ring);
  const group = new THREE.Group();
  group.name = "landmark_arena";
  group.add(
    new THREE.Mesh(shellGeometry(arena), shellMaterial()),
    new THREE.Mesh(podiumGeometry(arena), podiumMaterial(perimeter)),
    new THREE.Mesh(deckGeometry(arena), deckMaterial()),
    columnsMesh(arena),
    new THREE.Mesh(plazaGeometry(arena), plazaMaterial()),
  );
  return group;
}

interface Tower {
  centre: Vector2;
  radius: number;
  base: number;
  floors: number;
}

function towerFrame(spot: TowerSpot, base: number): Tower {
  const ring = ringOf(spot.ring);
  const centre = centroid(ring);
  const radius =
    ring.reduce((sum, p) => sum + p.distanceTo(centre), 0) / ring.length;
  return { centre, radius, base, floors: spot.floors };
}

function slabRadius(tower: Tower, level: number, angle: number): number {
  const reach = [0.86, 1.02, 0.94, 1.08, 0.9, 1.04][level % 6] ?? 1;
  const lean = [0.0, 1.4, 2.9, 4.2, 5.3, 0.7][level % 6] ?? 0;
  const lobe =
    0.09 * Math.cos(angle - lean) + 0.05 * Math.cos(2 * (angle + lean));
  return tower.radius * reach * (1 + lobe);
}

function outline(
  tower: Tower,
  radius: (angle: number) => number,
): [number, number][] {
  return Array.from({ length: towerSides + 1 }, (_, k) => {
    const angle = (k / towerSides) * Math.PI * 2;
    const r = radius(angle);
    return [
      tower.centre.x + Math.cos(angle) * r,
      tower.centre.y + Math.sin(angle) * r,
    ];
  });
}

function band(
  sheet: Sheet,
  points: [number, number][],
  low: number,
  high: number,
  v: [number, number],
): void {
  const first = sheet.positions.length / 3;
  for (const [h, along] of [
    [low, v[0]],
    [high, v[1]],
  ] as const)
    points.forEach(([x, z], k) => {
      sheet.vertex(x, h, z, k / towerSides, along);
    });
  sheet.grid(2, points.length, first);
}

function cap(
  sheet: Sheet,
  points: [number, number][],
  centre: Vector2,
  h: number,
  facing: number,
): void {
  const first = sheet.positions.length / 3;
  sheet.vertex(centre.x, h, centre.y, 0.5, 0.5);
  points.forEach(([x, z]) => {
    sheet.vertex(x, h, z, 0.5, 0.5);
  });
  for (let k = 0; k + 1 < points.length; k++)
    if (facing > 0) sheet.index.push(first, first + k + 2, first + k + 1);
    else sheet.index.push(first, first + k + 1, first + k + 2);
}

function slabs(tower: Tower): { concrete: Sheet; glass: Sheet } {
  const concrete = new Sheet();
  const glass = new Sheet();
  for (let level = 0; level <= tower.floors; level++) {
    const top = tower.base + towerLobby + level * towerFloor;
    const edge = outline(tower, (a) => slabRadius(tower, level, a));
    band(concrete, edge, top - towerSlab, top, [0, 1]);
    cap(concrete, edge, tower.centre, top, 1);
    cap(concrete, edge, tower.centre, top - towerSlab, -1);
    if (level === tower.floors) break;
    const core = outline(tower, () => tower.radius * 0.74);
    band(glass, core, top, top + towerFloor - towerSlab, [level, level + 1]);
  }
  const lobby = outline(tower, () => tower.radius * 0.7);
  band(glass, lobby, tower.base, tower.base + towerLobby - towerSlab, [-1, 0]);
  return { concrete, glass };
}

function roofHeight(tower: Tower): number {
  return tower.base + towerLobby + tower.floors * towerFloor;
}

interface Disc {
  centre: Vector2;
  radius: number;
  height: number;
}

function discs(tower: Tower): Disc[] {
  const top = roofHeight(tower);
  const shift = new Vector2(Math.cos(2.2), Math.sin(2.2)).multiplyScalar(
    tower.radius * 1.15,
  );
  return [
    { centre: tower.centre, radius: tower.radius * 1.6, height: top + 9 },
    {
      centre: tower.centre.clone().add(shift),
      radius: tower.radius * 0.95,
      height: top + 4.2,
    },
  ];
}

interface DiscSheets {
  top: Sheet;
  rim: Sheet;
  under: Sheet;
}

function polar(
  sheet: Sheet,
  disc: Disc,
  height: (r: number) => number,
  facing: number,
): void {
  const first = sheet.positions.length / 3;
  for (let ring = 0; ring <= discRings; ring++) {
    const r = (disc.radius * ring) / discRings;
    for (let k = 0; k <= towerSides; k++) {
      const angle = (k / towerSides) * Math.PI * 2;
      sheet.vertex(
        disc.centre.x + Math.cos(angle) * r,
        height(r),
        disc.centre.y + Math.sin(angle) * r,
        k / towerSides,
        r,
      );
    }
  }
  for (let ring = 0; ring < discRings; ring++)
    for (let k = 0; k < towerSides; k++) {
      const a = first + ring * (towerSides + 1) + k;
      const b = a + towerSides + 1;
      if (facing > 0) sheet.index.push(a, b, a + 1, a + 1, b, b + 1);
      else sheet.index.push(a, a + 1, b, a + 1, b + 1, b);
    }
}

function canopy(sheets: DiscSheets, disc: Disc): void {
  const crown = (r: number) =>
    disc.height + discDome * (1 - (r / disc.radius) ** 2);
  polar(sheets.top, disc, crown, 1);
  polar(sheets.under, disc, () => disc.height - discDepth, -1);
  const rim = Array.from({ length: towerSides + 1 }, (_, k) => {
    const angle = (k / towerSides) * Math.PI * 2;
    return [
      disc.centre.x + Math.cos(angle) * disc.radius,
      disc.centre.y + Math.sin(angle) * disc.radius,
    ] as [number, number];
  });
  band(sheets.rim, rim, disc.height - discDepth, disc.height + 0.25, [0, 1]);
}

function supports(boxes: Boxes, tower: Tower, disc: Disc): void {
  for (let c = 0; c < towerColumns; c++) {
    const angle = ((c + 0.5) / towerColumns) * Math.PI * 2;
    const foot = new THREE.Vector3(
      tower.centre.x + Math.cos(angle) * tower.radius * 1.12,
      tower.base,
      tower.centre.y + Math.sin(angle) * tower.radius * 1.12,
    );
    const fork = foot.clone();
    fork.y = disc.height - 7;
    boxes.beam(foot, fork, 0.9);
    for (let b = 0; b < towerBranches; b++) {
      const spread = angle + (b - 1) * 0.32;
      const reach = disc.radius * (b === 1 ? 0.92 : 0.78);
      const tip = new THREE.Vector3(
        disc.centre.x + Math.cos(spread) * reach,
        disc.height - 1.2,
        disc.centre.y + Math.sin(spread) * reach,
      );
      boxes.beam(fork, tip, 0.5);
    }
  }
}

function concreteMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new SkyLitMaterial({ side: THREE.DoubleSide });
  material.colorNode = vec3(0.7, 0.69, 0.66);
  material.roughnessNode = float(0.75);
  const v = uv().y;
  const strip = smoothstep(0.25, 0, abs(v.sub(0.08)));
  material.emissiveNode = vec3(1, 0.93, 0.82).mul(strip.mul(0.5)).mul(cityGlow);
  return material;
}

function glassMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new SkyLitMaterial({ side: THREE.DoubleSide });
  const u = uv().x.mul(towerSides * 0.9);
  const v = uv().y;
  const cell = floor(u).add(floor(v).mul(57.3));
  const roll = fract(sin(cell.mul(12.9898)).mul(43758.5453));
  const lit = step(0.6, roll).mul(roll.mul(0.8).add(0.2));
  const mullion = lines(u, 0.05);
  const room = smoothstep(0.05, 0.2, fract(v)).mul(
    smoothstep(0.98, 0.8, fract(v)),
  );
  material.colorNode = vec3(0.025, 0.035, 0.045);
  material.roughnessNode = float(0.12);
  material.metalnessNode = float(0.6);
  material.emissiveNode = vec3(1, 0.8, 0.58)
    .mul(lit.mul(room).mul(float(1).sub(mullion)).mul(0.32).add(0.012))
    .mul(cityGlow);
  return material;
}

function discTopMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new SkyLitMaterial({ side: THREE.DoubleSide });
  const around = uv().x;
  const r = uv().y;
  const ribs = lines(around.mul(discRibs), 0.05);
  const seams = lines(r.div(discSeam), 0.06);
  const panel = floor(around.mul(discRibs)).add(floor(r.div(discSeam)).mul(37));
  const shade = fract(sin(panel.mul(12.9898)).mul(43758.5453)).mul(0.07);
  const perforated = lines(around.mul(discRibs * 6), 0.18)
    .mul(lines(r.div(discSeam / 5), 0.18))
    .mul(0.18);
  const oculus = smoothstep(discOculus + 0.4, discOculus, r);
  const halo = lines(r.sub(discOculus).div(1.2), 0.12).mul(
    smoothstep(discOculus + 2, discOculus, r),
  );
  const white = vec3(0.8, 0.79, 0.76).mul(float(1).sub(shade));
  const grooved = mix(
    white,
    vec3(0.5, 0.5, 0.49),
    max(max(ribs, seams), perforated),
  );
  material.colorNode = mix(grooved, vec3(0.03, 0.035, 0.045), oculus);
  material.roughnessNode = mix(float(0.55), float(0.15), oculus);
  material.metalnessNode = float(0.25);
  material.emissiveNode = vec3(1, 0.9, 0.75)
    .mul(halo.mul(1.6).add(oculus.mul(0.25)))
    .mul(cityGlow);
  return material;
}

function discRimMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new SkyLitMaterial({ side: THREE.DoubleSide });
  const around = uv().x;
  const v = uv().y;
  const fins = lines(around.mul(discFins), 0.18);
  const led = lines(v.sub(0.12).mul(10), 0.18).add(
    lines(v.sub(0.86).mul(10), 0.12),
  );
  material.colorNode = mix(
    vec3(0.82, 0.81, 0.78),
    vec3(0.55, 0.55, 0.54),
    fins,
  );
  material.roughnessNode = float(0.5);
  material.emissiveNode = vec3(1, 0.88, 0.7)
    .mul(led.clamp(0, 1).mul(discLed))
    .mul(cityGlow);
  return material;
}

function discUnderMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new SkyLitMaterial({ side: THREE.DoubleSide });
  const around = uv().x;
  const r = uv().y;
  const beams = lines(around.mul(discBeams), 0.06);
  const rings = lines(r.div(discLightRing), 0.05);
  const lights = lines(around.mul(discBeams * 2).add(0.5), 0.08)
    .mul(lines(r.div(discLightRing).add(0.5), 0.08))
    .mul(smoothstep(discOculus + 1, discOculus + 3, r));
  material.colorNode = mix(
    vec3(0.34, 0.34, 0.33),
    vec3(0.2, 0.2, 0.2),
    max(beams, rings),
  );
  material.roughnessNode = float(0.6);
  material.emissiveNode = vec3(1, 0.93, 0.82)
    .mul(lights.mul(discDownlight).add(0.015))
    .mul(cityGlow);
  return material;
}

function steelMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new SkyLitMaterial();
  material.colorNode = vec3(0.8, 0.8, 0.79);
  material.roughnessNode = float(0.45);
  material.metalnessNode = float(0.4);
  return material;
}

function towerMesh(spot: TowerSpot, base: number): THREE.Object3D {
  const tower = towerFrame(spot, base);
  const { concrete, glass } = slabs(tower);
  const sheets = { top: new Sheet(), rim: new Sheet(), under: new Sheet() };
  const steel = new Boxes();
  for (const disc of discs(tower)) {
    canopy(sheets, disc);
    supports(steel, tower, disc);
  }
  const group = new THREE.Group();
  group.name = "landmark_tower";
  group.add(
    new THREE.Mesh(concrete.geometry(), concreteMaterial()),
    new THREE.Mesh(glass.geometry(), glassMaterial()),
    new THREE.Mesh(sheets.top.geometry(), discTopMaterial()),
    new THREE.Mesh(sheets.rim.geometry(), discRimMaterial()),
    new THREE.Mesh(sheets.under.geometry(), discUnderMaterial()),
    new THREE.Mesh(steel.geometry(), steelMaterial()),
  );
  return group;
}

export function desertLandmarks(
  landmarks: DesertLandmarks | undefined,
  base: number,
): THREE.Object3D {
  const group = new THREE.Group();
  group.name = "landmarks";
  if (landmarks?.arena) group.add(arenaMesh(landmarks.arena, base));
  if (landmarks?.tower) group.add(towerMesh(landmarks.tower, base));
  for (const child of group.children)
    child.traverse((mesh) => {
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    });
  return group;
}
