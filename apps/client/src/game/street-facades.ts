import * as THREE from "three/webgpu";
import {
  clamp,
  cross,
  dFdx,
  dFdy,
  exp,
  float,
  floor,
  fract,
  fwidth,
  length,
  max,
  min,
  mix,
  mx_noise_float,
  normalize,
  positionLocal,
  positionView,
  select,
  sin,
  smoothstep,
  step,
  texture,
  time,
  uv,
  vec2,
  vec3,
} from "three/tsl";

import {
  addAwning,
  addBalconies,
  addClutter,
  addMansard,
  addSpire,
  copperTone,
} from "./street-roofs.ts";
import {
  addCap,
  addLedge,
  addPiers,
  addWalls,
  centroid,
  hash,
  inside,
  Mesh,
  ringOf,
  roofPart,
  type Shell,
  signedArea,
  trimPart,
  wallPart,
} from "./street-shell.ts";

type Rgb = [number, number, number];

const flatRoof = 0;
const slateRoof = 1;
const tileRoof = 2;
type Kind = "tower" | "podium" | "parking" | "low";

export interface Building {
  kind: Kind;
  style: string;
  balcony?: boolean;
  base: number;
  height: number;
  ring: number[];
}

interface FacadeStyle {
  wall: Rgb;
  glass: number;
  wash: Rgb;
  lit: number;
  crown: Rgb;
  pier: number;
  accent: Rgb;
  warmth: number;
  bay: number;
  storey: number;
  wide: number;
  tall: number;
  arch: number;
  shop: number;
  drift: number;
  level: number;
  cornice: number;
  tier: number;
  roof: number;
}

const plinthTone = 0.86;
const plinthStoreys = 2;
const plinthLedge = 0.55;
const plinthBand = 0.7;
const pierWidth = 0.8;
const pierDepth = 0.42;
const warm: Rgb = [1, 0.8, 0.54];
const soft: Rgb = [1, 0.9, 0.74];
const cool: Rgb = [0.78, 0.87, 1];
const none: Rgb = [0, 0, 0];

function scaled(colour: Rgb, by: number): Rgb {
  return [colour[0] * by, colour[1] * by, colour[2] * by];
}

const stone: FacadeStyle = {
  wall: [0.6, 0.5, 0.36],
  glass: 0,
  wash: scaled(warm, 0.56),
  lit: 0.05,
  crown: scaled(warm, 0.69),
  pier: 0.7,
  accent: none,
  warmth: 0.8,
  bay: 3.4,
  storey: 3.1,
  wide: 0.42,
  tall: 0.6,
  arch: 0,
  shop: 0,
  drift: 0,
  level: 0.55,
  cornice: 0.8,
  tier: 12,
  roof: slateRoof,
};

const curtain: FacadeStyle = {
  ...stone,
  wall: [0.02, 0.028, 0.038],
  glass: 1,
  wash: none,
  lit: 0.012,
  crown: scaled(cool, 0.24),
  pier: 0,
  accent: scaled(cool, 0.4),
  warmth: 0.3,
  bay: 1.7,
  storey: 3.8,
  wide: 0.9,
  tall: 0.8,
  cornice: 0,
  tier: 0,
  roof: flatRoof,
};

const styles: Record<string, FacadeStyle> = {
  cream: stone,
  ivory: {
    ...stone,
    wall: [0.66, 0.62, 0.53],
    wash: scaled(soft, 0.53),
    crown: scaled(soft, 0.63),
    pier: 0.5,
    bay: 3.6,
    storey: 3,
    wide: 0.5,
    tall: 0.56,
    tier: 10,
    roof: flatRoof,
  },
  sand: {
    ...stone,
    wall: [0.52, 0.4, 0.26],
    wash: scaled(warm, 0.59),
    crown: scaled(warm, 0.63),
    wide: 0.4,
    tall: 0.58,
    tier: 9,
  },
  terracotta: {
    ...stone,
    wall: [0.55, 0.3, 0.2],
    wash: scaled([1, 0.72, 0.5], 0.56),
    crown: scaled([1, 0.72, 0.5], 0.58),
    tier: 11,
    roof: tileRoof,
  },
  rose: {
    ...stone,
    wall: [0.6, 0.4, 0.42],
    wash: scaled([1, 0.5, 0.62], 0.5),
    crown: scaled([1, 0.25, 0.5], 0.69),
    accent: scaled([1, 0.15, 0.45], 0.9),
    pier: 0.4,
    tier: 8,
    roof: flatRoof,
  },
  white: {
    ...stone,
    wall: [0.7, 0.7, 0.68],
    wash: scaled(cool, 0.5),
    crown: scaled(cool, 0.63),
    pier: 0.8,
    warmth: 0.6,
    tier: 10,
    roof: flatRoof,
  },
  violet: {
    ...stone,
    wall: [0.62, 0.6, 0.64],
    wash: scaled([0.72, 0.48, 1], 0.5),
    crown: scaled([0.75, 0.42, 1], 0.63),
    pier: 0.5,
    tier: 9,
    roof: flatRoof,
  },
  pier: {
    ...stone,
    wall: [0.68, 0.66, 0.61],
    wash: scaled(soft, 0.56),
    crown: scaled(soft, 0.69),
    pier: 1,
    bay: 3,
    wide: 0.36,
    tall: 0.82,
    tier: 11,
    roof: flatRoof,
  },
  slab: {
    ...stone,
    wall: [0.1, 0.1, 0.11],
    wash: scaled(soft, 0.15),
    lit: 0.3,
    crown: none,
    pier: 0.6,
    warmth: 0.7,
    bay: 3.2,
    wide: 0.36,
    tall: 0.36,
    level: 0.42,
    cornice: 0,
    tier: 0,
    roof: flatRoof,
  },
  charcoal: {
    ...stone,
    wall: [0.08, 0.08, 0.09],
    wash: scaled(cool, 0.12),
    lit: 0.16,
    crown: scaled(cool, 0.21),
    pier: 0.3,
    warmth: 0.5,
    bay: 3,
    wide: 0.5,
    tall: 0.45,
    level: 0.6,
    cornice: 0,
    tier: 0,
    roof: flatRoof,
  },
  glass: curtain,
  azure: {
    ...curtain,
    lit: 0.008,
    crown: scaled([0.2, 0.45, 1], 0.9),
    accent: scaled([0.12, 0.32, 1], 0.9),
    drift: 1,
  },
  bronze: {
    ...curtain,
    wall: [0.09, 0.05, 0.025],
    lit: 0.006,
    crown: scaled([1, 0.95, 0.86], 1.5),
    accent: scaled([1, 0.9, 0.76], 0.3),
    warmth: 0.8,
    storey: 3.4,
  },
  gold: {
    ...curtain,
    wall: [0.12, 0.08, 0.02],
    lit: 0.008,
    crown: scaled([1, 0.86, 0.5], 1.2),
    accent: scaled([1, 0.8, 0.4], 0.3),
    warmth: 0.9,
  },
  crimson: {
    ...curtain,
    wall: [0.1, 0.015, 0.02],
    lit: 0.008,
    crown: scaled([1, 0.15, 0.1], 1.2),
    accent: scaled([1, 0.1, 0.1], 0.8),
    warmth: 0.9,
  },
  emerald: {
    ...curtain,
    wall: [0.01, 0.07, 0.04],
    lit: 0.01,
    crown: scaled([0.3, 1, 0.55], 1),
    accent: scaled([0.2, 1, 0.5], 0.6),
  },
  casino: {
    ...stone,
    wall: [0.46, 0.41, 0.33],
    wash: scaled(warm, 0.5),
    lit: 0.1,
    crown: scaled(warm, 0.68),
    pier: 0.8,
    accent: scaled([1, 0.75, 0.35], 0.9),
    bay: 6.5,
    storey: 5.5,
    wide: 0.5,
    tall: 0.6,
    shop: 0.85,
    level: 0.8,
    cornice: 1,
    tier: 0,
    roof: tileRoof,
  },
  arcade: {
    ...stone,
    wall: [0.5, 0.45, 0.37],
    wash: scaled(warm, 0.5),
    lit: 0.08,
    crown: scaled(warm, 0.68),
    pier: 1,
    bay: 5,
    storey: 6.5,
    wide: 0.52,
    tall: 0.66,
    arch: 1,
    shop: 0.7,
    level: 0.8,
    cornice: 1.1,
    tier: 0,
  },
  mall: {
    ...stone,
    wall: [0.55, 0.56, 0.58],
    wash: scaled(cool, 0.43),
    lit: 0.08,
    crown: scaled(cool, 0.38),
    pier: 0.3,
    accent: scaled([1, 0.2, 0.6], 1.1),
    warmth: 0.4,
    bay: 8,
    storey: 6,
    wide: 0.8,
    tall: 0.45,
    shop: 1,
    level: 0.8,
    cornice: 0.5,
    tier: 0,
    roof: flatRoof,
  },
  deck: {
    ...stone,
    wall: [0.42, 0.42, 0.4],
    wash: scaled(soft, 0.19),
    lit: 1,
    crown: none,
    pier: 0.3,
    warmth: 0.35,
    bay: 8.5,
    storey: 3.1,
    wide: 0.92,
    tall: 0.44,
    level: 0.12,
    cornice: 0,
    tier: 0,
    roof: flatRoof,
  },
  shop: {
    ...stone,
    wall: [0.4, 0.36, 0.3],
    wash: scaled(warm, 0.37),
    lit: 0.08,
    crown: scaled(warm, 0.3),
    pier: 0.5,
    bay: 4.5,
    storey: 4,
    wide: 0.6,
    tall: 0.55,
    shop: 0.8,
    level: 0.7,
    cornice: 0.35,
    tier: 0,
    roof: flatRoof,
  },
  stucco: {
    ...stone,
    wall: [0.5, 0.44, 0.36],
    wash: scaled(warm, 0.31),
    lit: 0.1,
    crown: scaled(warm, 0.3),
    pier: 0.4,
    storey: 3.2,
    cornice: 0.35,
    tier: 0,
    roof: tileRoof,
  },
  depot: {
    ...stone,
    wall: [0.22, 0.22, 0.23],
    wash: scaled(cool, 0.15),
    lit: 0.03,
    crown: none,
    pier: 0,
    bay: 6,
    storey: 5,
    wide: 0.3,
    tall: 0.25,
    cornice: 0,
    tier: 0,
    roof: flatRoof,
  },
};

const classical = [
  "cream",
  "ivory",
  "sand",
  "terracotta",
  "rose",
  "white",
  "violet",
  "pier",
  "stucco",
];
const plinthSuffix = ":plinth";

for (const name of classical) {
  const style = styles[name];
  if (style)
    styles[name + plinthSuffix] = {
      ...style,
      wall: scaled(style.wall, plinthTone),
      lit: 0.1,
      bay: style.bay * 2,
      storey: style.storey * plinthStoreys,
      wide: 0.56,
      tall: 0.7,
      arch: 1,
      shop: 0.8,
      level: 0.8,
      tier: 0,
    };
}

const styleNames = Object.keys(styles);
const styleColumns = 7;
const corniceDrop = 1.1;
const parapet = 0.9;
const ledgeReach = 0.45;
const ledgeDepth = 0.5;
const parapetLight = 0.12;
const penthouseLight = 0.12;
const crownStoreys = 2.5;
const penthouseShare = 0.5;
const penthouseLow = 3.5;
const penthouseHigh = 8;
const penthouseArea = 500;
const fill = 0.055;
const washStoreys = 2.2;
const crownFade = 1.7;
const floodReach = 9;
const floodFade = 34;
const floodHigh = 0.32;
const glassRough = 0.035;
const wallRough = 0.88;
const untiered = 1e5;
const weathering = 0.22;
const coursing = 0.1;
const floodShare = 0.6;
const mansardLimit = 34;
const awningLimit = 12;
const awningGap = 0.2;
const shopSill = 0.16;
const spireArea = 450;
const roofCourses = 2.6;
const roofGlow = 0.12;
const recessStone = 0.42;
const recessGlass = 0.1;
const roomDepth = 1.1;
const grazing = 0.22;
const slideLimit = 3;
const transomAt = 0.7;
const frameWidth = 0.045;
const frameShade = 0.35;
const frameTone: Rgb = [0.05, 0.045, 0.04];
const revealSide = 0.62;
const revealSill = 0.25;
const revealSoffit = 1.45;
const blockHeight = 0.62;
const blockLength = 1.3;
const jointWidth = 0.012;
const jointShade = 0.2;
const curtainShare = 0.55;
const curtainLight = 0.3;
const roomDim = 0.16;
const lampReach = 0.55;
const lampGain = 1.6;
const shopModule = 2.2;
const shopBack = 0.34;
const shopStock = 0.5;
const shopSpots = 2.4;
const shelfColumns = 1.4;
const farWindows = 0.22;
const blindShare = 0.4;
const blindTone: Rgb = [0.2, 0.19, 0.17];
const slatRows = 9;
const glassSheen: Rgb = [0.006, 0.008, 0.012];
const coneSpread = 0.5;
const coneNeck = 0.07;
const coneGain = 0.3;
const coneBright = 4.2;
const coneFloor = 0.12;
const nookFrom = 0.4;
const nookTo = 1.1;
const nookShade = 0.38;
const slate: Rgb = [0.045, 0.06, 0.075];
const tiles: Rgb = [0.2, 0.085, 0.05];
const copper: Rgb = [0.07, 0.16, 0.13];

function behindWall(
  u: THREE.Node<"float">,
  h: THREE.Node<"float">,
): THREE.Node<"vec2"> {
  const acrossX = dFdx(positionView);
  const acrossY = dFdy(positionView);
  const du = vec2(dFdx(u), dFdy(u));
  const dh = vec2(dFdx(h), dFdy(h));
  const turn = du.x.mul(dh.y).sub(du.y.mul(dh.x));
  const safe = select(turn.abs().lessThan(1e-9), float(1), turn);
  const along = acrossX.mul(dh.y).sub(acrossY.mul(dh.x)).div(safe);
  const up = acrossY.mul(du.x).sub(acrossX.mul(du.y)).div(safe);
  const view = normalize(positionView);
  const facing = view.dot(normalize(cross(along, up))).abs();
  return vec2(view.dot(along), view.dot(up))
    .div(facing.max(grazing))
    .clamp(-slideLimit, slideLimit);
}

function ashlar(
  u: THREE.Node<"float">,
  h: THREE.Node<"float">,
  seed: THREE.Node<"float">,
): THREE.Node<"float"> {
  const course = h.div(blockHeight);
  const row = floor(course);
  const shift = fract(row.mul(0.5)).mul(blockLength).add(seed.mul(7.1));
  const bed = fract(course).sub(0.5).abs().mul(blockHeight);
  const head = fract(u.add(shift).div(blockLength))
    .sub(0.5)
    .abs()
    .mul(blockLength);
  const wide = fwidth(h).add(jointWidth);
  const joint = float(1).sub(
    smoothstep(wide.mul(0.5), wide, min(bed, head).sub(0).abs()),
  );
  const fade = float(1).sub(smoothstep(0.02, 0.12, fwidth(h)));
  return joint.mul(fade);
}

function hashNode(p: THREE.Node<"vec2">): THREE.Node<"float"> {
  return fract(sin(p.dot(vec2(127.1, 311.7))).mul(43758.5453));
}

function addPenthouse(mesh: Mesh, shell: Shell, top: number): void {
  const middle = centroid(shell.ring);
  if (!inside(shell.ring, middle)) return;
  if (Math.abs(signedArea(shell.ring)) < penthouseArea) return;
  const ring = shell.ring.map((p) =>
    p.clone().sub(middle).multiplyScalar(penthouseShare).add(middle),
  );
  const rise =
    penthouseLow + (penthouseHigh - penthouseLow) * hash(shell.seed * 7.7);
  const box = { ...shell, ring };
  addWalls(mesh, box, top, top + rise, penthouseLight);
  addCap(mesh, box, ring, top + rise);
}

function crownBase(total: number, storey: number): number {
  return Math.max(
    0,
    Math.floor((total - crownStoreys * storey) / storey) * storey,
  );
}

function addTiers(
  mesh: Mesh,
  shell: Shell,
  style: FacadeStyle,
  base: number,
): void {
  const span = style.tier * style.storey;
  const crown = crownBase(shell.total, style.storey);
  if (span > 0)
    for (let h = span; h < crown - style.storey; h += span)
      addLedge(mesh, shell, base + h, ledgeReach, ledgeDepth);
  if (crown > style.storey)
    addLedge(mesh, shell, base + crown, ledgeReach, ledgeDepth);
}

function plinthOf(
  shell: Shell,
  style: FacadeStyle,
  building: Building,
): Shell | null {
  const name = building.style + plinthSuffix;
  const row = styleNames.indexOf(name);
  if (row < 0 || building.height < style.storey * (plinthStoreys + 2))
    return null;
  return { ...shell, row, bay: style.bay * 2 };
}

function pierTop(shell: Shell, style: FacadeStyle, building: Building): number {
  const crown = crownBase(shell.total, style.storey);
  const tiered = building.kind === "tower" && style.cornice > 0;
  return (
    building.base +
    (tiered && crown > style.storey ? crown - ledgeDepth : building.height)
  );
}

function addBody(
  mesh: Mesh,
  shell: Shell,
  style: FacadeStyle,
  building: Building,
): void {
  const base = building.base;
  const plinth = plinthOf(shell, style, building);
  if (plinth) {
    const rise = style.storey * plinthStoreys;
    addWalls(mesh, plinth, base, base + rise, null);
    addWalls(mesh, shell, base + rise, base + building.height, null, rise);
    addLedge(
      mesh,
      shell,
      base + rise + plinthBand / 2,
      plinthLedge,
      plinthBand,
    );
    addPiers(
      mesh,
      plinth,
      base,
      base + rise - plinthBand / 2,
      0,
      pierWidth * 1.4,
      pierDepth,
    );
    addPiers(
      mesh,
      shell,
      base + rise + plinthBand / 2,
      pierTop(shell, style, building),
      rise + plinthBand / 2,
      pierWidth,
      pierDepth,
    );
  } else addWalls(mesh, shell, base, base + building.height, null);
  if (building.kind === "tower" && style.cornice > 0)
    addTiers(mesh, shell, style, base);
  if (building.balcony) addBalconies(mesh, shell, base, style.storey);
  if (style.shop > 0 && building.height < awningLimit)
    addAwning(
      mesh,
      shell,
      base + (shopSill + style.tall) * style.storey + awningGap,
    );
}

function addFlatRoof(
  mesh: Mesh,
  shell: Shell,
  style: FacadeStyle,
  kind: Kind,
  top: number,
): void {
  addCap(mesh, shell, shell.ring, top);
  if (kind === "low") return;
  if (style.cornice > 0) {
    addLedge(mesh, shell, top + parapet, style.cornice, corniceDrop + parapet);
    addWalls(
      mesh,
      { ...shell, outward: -shell.outward },
      top,
      top + parapet,
      parapetLight,
    );
  }
  if (kind === "tower") addPenthouse(mesh, shell, top);
  addClutter(mesh, shell, top);
}

function addBuilding(mesh: Mesh, building: Building, seed: number): void {
  const ring = ringOf(building.ring);
  if (ring.length < 3) return;
  const name = building.style in styles ? building.style : "cream";
  const style = styles[name] ?? stone;
  const shell: Shell = {
    ring,
    outward: signedArea(ring) > 0 ? -1 : 1,
    seed,
    row: styleNames.indexOf(name),
    total: building.height,
    bay: style.bay,
  };
  const top = building.base + building.height;
  addBody(mesh, shell, style, building);
  if (!addSlopedRoof(mesh, shell, style, building.kind === "tower", top))
    addFlatRoof(mesh, shell, style, building.kind, top);
}

function addSlopedRoof(
  mesh: Mesh,
  shell: Shell,
  style: FacadeStyle,
  tower: boolean,
  top: number,
): boolean {
  if (style.roof === flatRoof) return false;
  if (!tower)
    return (
      shell.total <= mansardLimit &&
      addMansard(mesh, shell, top, style.roof - 1)
    );
  return (
    Math.abs(signedArea(shell.ring)) < spireArea &&
    addSpire(mesh, shell, top, copperTone)
  );
}

function styleTable(): THREE.DataTexture {
  const data = new Uint16Array(styleNames.length * styleColumns * 4);
  const half = (value: number) => THREE.DataUtils.toHalfFloat(value);
  styleNames.forEach((name, row) => {
    const s = styles[name] ?? stone;
    const cells = [
      [...s.wall, s.glass],
      [...s.wash, s.lit],
      [...s.crown, s.pier],
      [...s.accent, s.warmth],
      [s.bay, s.storey, s.wide, s.tall],
      [s.arch, s.shop, s.drift, s.level],
      [s.tier > 0 ? s.tier * s.storey : untiered, 0, 0, 0],
    ];
    cells.forEach((cell, column) => {
      cell.forEach((value, k) => {
        data[(row * styleColumns + column) * 4 + k] = half(value);
      });
    });
  });
  const table = new THREE.DataTexture(
    data,
    styleColumns,
    styleNames.length,
    THREE.RGBAFormat,
    THREE.HalfFloatType,
  );
  table.minFilter = THREE.NearestFilter;
  table.magFilter = THREE.NearestFilter;
  table.generateMipmaps = false;
  table.needsUpdate = true;
  return table;
}

function facadeMaterial(
  glow: THREE.Node<"float">,
): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({
    side: THREE.DoubleSide,
  });
  const table = styleTable();
  const u = uv().x;
  const h = uv().y;
  const seed = uv(1).x;
  const part = uv(1).y;
  const total = uv(2).x;
  const row = uv(2).y.add(0.5).div(styleNames.length);
  const read = (column: number) =>
    texture(table, vec2((column + 0.5) / styleColumns, row));
  const surface = read(0);
  const washed = read(1);
  const crowned = read(2);
  const accented = read(3);
  const grid = read(4);
  const extra = read(5);
  const tier = read(6).r;
  const wall = surface.rgb;
  const glass = surface.a;
  const wash = washed.rgb;
  const lit = washed.a;
  const crown = crowned.rgb;
  const pier = crowned.a;
  const accent = accented.rgb;
  const warmth = accented.a;
  const bay = grid.r;
  const storey = grid.g;
  const wide = grid.b;
  const tall = grid.a;
  const arch = extra.r;
  const shop = extra.g;
  const drift = extra.b;
  const level = extra.a;
  const isWall = step(part, wallPart + 0.5);
  const isRoof = step(wallPart + 0.5, part).mul(step(part, roofPart + 0.5));
  const isTrim = step(roofPart + 0.5, part).mul(step(part, trimPart + 0.5));
  const isSlope = step(trimPart + 0.5, part);
  const coord = vec2(u.div(bay), h.div(storey));
  const cell = floor(coord);
  const within = fract(coord);
  const spread = max(fwidth(coord.x), fwidth(coord.y));
  const edge = spread.mul(1.2).add(0.012);
  const side = float(1).sub(wide).mul(0.5);
  const sill = float(shopSill);
  const head = sill.add(tall);
  const radius = wide.mul(bay).mul(0.5);
  const spring = head.mul(storey).sub(radius);
  const between = (w: THREE.Node<"vec2">) =>
    smoothstep(side.sub(edge), side.add(edge), w.x).mul(
      smoothstep(side.sub(edge), side.add(edge), float(1).sub(w.x)),
    );
  const opening = (w: THREE.Node<"vec2">) => {
    const above = smoothstep(sill.sub(edge), sill.add(edge), w.y);
    const square = between(w)
      .mul(above)
      .mul(smoothstep(head.add(edge), head.sub(edge), w.y));
    const round = smoothstep(
      radius.add(edge.mul(bay)),
      radius.sub(edge.mul(bay)),
      length(vec2(w.x.sub(0.5).mul(bay), max(w.y.mul(storey).sub(spring), 0))),
    ).mul(above);
    return mix(square, round, arch);
  };
  const across = between(within);
  const far = smoothstep(0.35, 0.9, spread);
  const near = float(1).sub(far);
  const cellSize = vec2(bay, storey);
  const slide = behindWall(u, h).toVar();
  const inner = within
    .add(
      slide
        .mul(mix(float(recessStone), float(recessGlass), glass))
        .div(cellSize),
    )
    .toVar();
  const room = within.add(slide.mul(roomDepth).div(cellSize));
  const open = opening(within);
  const seen = opening(inner);
  const rim = min(
    min(inner.x.sub(side), float(1).sub(side).sub(inner.x)).mul(bay),
    min(inner.y.sub(sill), head.sub(inner.y)).mul(storey),
  );
  const bars = min(
    inner.x.sub(0.5).abs().mul(bay),
    inner.y
      .sub(sill.add(tall.mul(transomAt)))
      .abs()
      .mul(storey),
  );
  const line = fwidth(inner.x).mul(bay).add(frameWidth);
  const frame = float(1)
    .sub(smoothstep(line, line.mul(1.5), min(rim, bars.add(frameWidth * 0.5))))
    .mul(seen)
    .mul(open)
    .mul(near);
  const recess = open.mul(float(1).sub(seen)).mul(near);
  const revealLight = mix(
    mix(float(revealSide), float(revealSill), step(inner.y, sill)),
    float(revealSoffit),
    step(head, inner.y),
  );
  const depthShade = mix(float(1), revealLight, recess.mul(isWall)).mul(
    mix(float(1), float(frameShade), frame.mul(isWall)),
  );
  const pane = mix(
    open.mul(seen).mul(float(1).sub(frame)),
    wide.mul(tall),
    far,
  ).mul(isWall);
  const key = cell.add(vec2(seed.mul(173.3), seed.mul(41.7)));
  const chance = hashNode(key);
  const strength = hashNode(key.add(vec2(7.3, 13.1)));
  const mood = hashNode(key.add(vec2(3.9, 27.7)));
  const street = step(cell.y, 0.5).mul(shop);
  const busy = step(hashNode(vec2(cell.y.mul(1.7), seed.mul(57.3))), 0.12)
    .mul(glass)
    .mul(5)
    .add(1);
  const share = lit.mul(busy).add(street).min(1);
  const on = step(chance, share);
  const tone = mix(
    vec3(0.72, 0.84, 1),
    vec3(1, 0.74, 0.44),
    clamp(warmth.add(mood.sub(0.5).mul(0.6)), 0, 1),
  );
  const ceiling = smoothstep(sill, head, room.y).mul(0.5).add(0.5);
  const folds = sin(room.x.mul(Math.PI * 6).add(mood.mul(40)))
    .mul(0.18)
    .add(0.82);
  const drawn = step(strength, curtainShare);
  const lampAt = vec2(mood.mul(0.5).add(0.25), sill.add(tall.mul(0.45)));
  const lampSpot = exp(
    room.sub(lampAt).mul(vec2(bay, storey)).length().div(lampReach).negate(),
  );
  const roomLight = mix(
    ceiling.mul(roomDim).add(lampSpot.mul(lampGain)),
    folds.mul(curtainLight),
    drawn,
  );
  const aisle = fract(room.x.mul(bay).div(shopModule));
  const downlights = smoothstep(0.1, 0.02, aisle.sub(0.5).abs()).mul(
    smoothstep(0.05, 0.0, room.y.sub(head.sub(0.06)).abs()),
  );
  const shelves = hashNode(
    floor(
      vec2(room.x.mul(bay).mul(shelfColumns), room.y.mul(storey).mul(1.6)),
    ).add(seed.mul(31)),
  );
  const counter = smoothstep(
    sill.add(tall.mul(0.5)),
    sill.add(tall.mul(0.42)),
    room.y,
  );
  const shopLight = mix(float(shopBack), shelves.mul(shopStock), counter)
    .mul(ceiling)
    .add(downlights.mul(shopSpots));
  const glowing = on
    .mul(strength.mul(0.6).add(0.4))
    .mul(mix(roomLight, shopLight, street));
  const lamps = tone
    .mul(mix(glowing, share.mul(farWindows), far))
    .mul(level)
    .mul(pane);
  const blinds = step(hashNode(key.add(vec2(17.9, 5.3))), blindShare)
    .mul(float(1).sub(on))
    .mul(float(1).sub(street))
    .mul(float(1).sub(glass));
  const slats = smoothstep(0.35, 0.5, fract(inner.y.mul(storey).mul(slatRows)));
  const dressed = mix(
    vec3(0.012, 0.014, 0.018),
    vec3(...blindTone).mul(slats.mul(0.5).add(0.5)),
    blinds.mul(near),
  );
  const sheen = vec3(...glassSheen)
    .mul(within.y.mul(0.9).add(0.35))
    .mul(float(1).sub(blinds))
    .mul(pane);
  const top = total.sub(h);
  const reach = storey.mul(washStoreys);
  const lift = exp(h.mod(tier).div(reach).negate());
  const crest = floor(total.sub(storey.mul(crownStoreys)).div(storey))
    .mul(storey)
    .max(0);
  const fall = step(crest, h).mul(
    exp(h.sub(crest).div(storey.mul(crownFade)).negate()),
  );
  const fromPier = fract(coord.x.add(0.5)).sub(0.5).abs();
  const coneWide = h.mod(tier).div(reach).mul(coneSpread).add(coneNeck);
  const cone = exp(fromPier.div(coneWide).pow(2).negate()).mul(
    float(coneGain).div(coneWide.add(coneGain)),
  );
  const scallop = mix(
    float(1),
    cone.mul(coneBright).add(coneFloor),
    pier.mul(float(1).sub(far)),
  );
  const nook = mix(
    float(1),
    smoothstep(nookFrom, nookTo, fromPier.mul(bay)).mul(nookShade).oneMinus(),
    pier.mul(float(1).sub(far)),
  );
  const relief = mix(
    float(1),
    mix(float(1.1), float(0.82), across),
    pier.mul(float(1).sub(far)),
  );
  const light = wash
    .mul(lift)
    .add(crown.mul(fall))
    .mul(scallop)
    .mul(relief)
    .add(fill)
    .mul(nook)
    .mul(depthShade);
  const trimLight = wash.add(crown).mul(0.5).mul(u).add(fill);
  const solid = float(1).sub(pane);
  const storeyLine = smoothstep(0.1, 0.03, within.y).mul(float(1).sub(far));
  const chosen = step(hashNode(vec2(cell.y, seed.mul(91.7))), 0.3);
  const run = hashNode(vec2(cell.y.mul(3.3), seed));
  const dash = step(
    0.5,
    fract(
      u
        .mul(0.035)
        .add(run.mul(9))
        .sub(time.mul(drift).mul(run.sub(0.4)).mul(0.12)),
    ),
  );
  const lines = storeyLine
    .mul(mix(float(1), chosen.mul(dash).mul(2.2), step(0.5, drift)))
    .mul(glass);
  const roofline = smoothstep(1.4, 0.2, top);
  const neon = accent.mul(lines.add(roofline)).mul(isWall);
  const grain = mx_noise_float(vec3(u.mul(0.11), h.mul(0.5), seed.mul(40)))
    .mul(0.5)
    .add(mx_noise_float(vec3(u.mul(1.3), h.mul(2.1), seed.mul(17))).mul(0.2))
    .mul(float(1).sub(glass))
    .mul(weathering)
    .add(1);
  const course = smoothstep(0.05, 0.02, within.y)
    .sub(smoothstep(0.05, 0.02, within.y.sub(0.045).abs()).mul(0.6))
    .mul(float(1).sub(far))
    .mul(float(1).sub(glass))
    .mul(coursing)
    .add(1);
  const blocks = ashlar(u, h, seed)
    .mul(near)
    .mul(float(1).sub(glass))
    .mul(float(1).sub(open));
  const tinted = mix(
    wall
      .mul(grain)
      .mul(course)
      .mul(float(1).sub(blocks.mul(jointShade))),
    vec3(...frameTone),
    frame.mul(isWall),
  );
  const colour = mix(tinted.mul(depthShade).mul(nook), dressed, pane);
  const flood = mix(
    float(1),
    float(floodHigh),
    smoothstep(floodReach, floodFade, h),
  );
  const roofing = mix(
    mix(vec3(...slate), vec3(...tiles), step(0.5, h)),
    vec3(...copper),
    step(1.5, h),
  ).mul(
    smoothstep(0.14, 0, fract(positionLocal.y.mul(roofCourses)))
      .mul(0.3)
      .oneMinus(),
  );
  material.colorNode = mix(
    mix(colour.mul(flood).mul(floodShare), vec3(0.03, 0.03, 0.032), isRoof),
    roofing,
    isSlope,
  );
  material.roughnessNode = mix(float(wallRough), float(glassRough), pane);
  material.metalnessNode = glass.mul(pane).mul(0.4);
  material.emissiveNode = mix(
    mix(
      tinted.mul(light).mul(solid).add(lamps).add(sheen).add(neon),
      wall.mul(trimLight),
      isTrim,
    ),
    roofing.mul(
      wash
        .add(crown)
        .mul(u)
        .mul(roofGlow)
        .add(fill * 2),
    ),
    isSlope,
  )
    .mul(float(1).sub(isRoof))
    .mul(glow);
  return material;
}

export function buildingMesh(
  buildings: Building[],
  glow: THREE.Node<"float">,
): THREE.Mesh {
  const mesh = new Mesh();
  buildings.forEach((building, index) => {
    addBuilding(mesh, building, hash(index + 0.5));
  });
  const result = new THREE.Mesh(mesh.geometry(), facadeMaterial(glow));
  result.name = "city_buildings";
  result.receiveShadow = false;
  result.castShadow = false;
  return result;
}
