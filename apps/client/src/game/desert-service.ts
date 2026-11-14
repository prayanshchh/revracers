import { beam, wallAt } from "./street-layout.ts";
import { lampGains, type LampSpot } from "./desert-lamps.ts";
import {
  box,
  Builder,
  type Part,
  place,
  type Station,
  stationAt,
  up,
  wrap,
} from "./training-layout.ts";

export interface ServiceCluster {
  at: number;
  side: number;
  back: number;
  kinds: string[];
}

interface Kit {
  spots: LampSpot[];
  white: Builder;
  glass: Builder;
  dark: Builder;
  yellow: Builder;
  blue: Builder;
  lamps: Builder;
}

interface Frame {
  centre: number[];
  along: number[];
  across: number[];
}

const spacing = 3.2;
const lean = 0.12;

function at(frame: Frame, a: number, h: number, c: number): number[] {
  return frame.centre.map(
    (v, i) =>
      v +
      (frame.along[i] ?? 0) * a +
      (i === 1 ? h : 0) +
      (frame.across[i] ?? 0) * c,
  );
}

function solid(
  builder: Builder,
  frame: Frame,
  a: number,
  h: number,
  c: number,
  half: number[],
): void {
  box(builder, at(frame, a, h, c), half, [frame.along, up, frame.across]);
}

function cabin(kit: Kit, frame: Frame): number {
  solid(kit.white, frame, 0, 1.45, 0, [3, 1.3, 1.2]);
  solid(kit.white, frame, 0, 2.8, 0, [3.08, 0.06, 1.28]);
  solid(kit.dark, frame, 0, 0.08, 0, [2.9, 0.1, 1.1]);
  for (const a of [-1.8, 0.6, 2.1])
    solid(kit.glass, frame, a, 1.75, -1.21, [0.55, 0.45, 0.02]);
  solid(kit.dark, frame, -0.6, 1.25, -1.21, [0.45, 1.05, 0.02]);
  solid(kit.white, frame, -0.6, 0.18, -1.55, [0.6, 0.18, 0.35]);
  solid(kit.white, frame, 3.15, 1.9, 0.3, [0.15, 0.3, 0.42]);
  solid(kit.lamps, frame, -0.6, 2.45, -1.26, [0.18, 0.05, 0.05]);
  kit.spots.push({
    head: at(frame, -0.6, 2.4, -1.4),
    aim: at(frame, -0.6, 0, -6),
    gain: lampGains.cabin,
    reach: 14,
  });
  return 6.4;
}

function wheels(kit: Kit, frame: Frame, axles: number[], track: number): void {
  for (const a of axles)
    for (const c of [-track, track])
      solid(kit.dark, frame, a, 0.38, c, [0.38, 0.38, 0.14]);
}

function van(kit: Kit, frame: Frame): number {
  solid(kit.white, frame, -0.4, 1.35, 0, [1.9, 0.85, 0.98]);
  solid(kit.white, frame, 1.95, 1.0, 0, [0.6, 0.5, 0.95]);
  solid(kit.glass, frame, 1.62, 1.75, 0, [0.06, 0.32, 0.86]);
  solid(kit.glass, frame, 1.0, 1.75, -0.99, [0.5, 0.3, 0.02]);
  solid(kit.glass, frame, 1.0, 1.75, 0.99, [0.5, 0.3, 0.02]);
  solid(kit.yellow, frame, -0.4, 1.05, -0.99, [1.9, 0.12, 0.02]);
  solid(kit.yellow, frame, -0.4, 1.05, 0.99, [1.9, 0.12, 0.02]);
  solid(kit.lamps, frame, 1.3, 2.26, 0, [0.12, 0.06, 0.55]);
  wheels(kit, frame, [-1.5, 1.7], 0.86);
  return 6.2;
}

function truck(kit: Kit, frame: Frame): number {
  solid(kit.white, frame, 2.9, 1.55, 0, [0.95, 1.1, 1.2]);
  solid(kit.glass, frame, 3.86, 1.95, 0, [0.04, 0.45, 1.05]);
  solid(kit.dark, frame, -0.9, 0.9, 0, [2.9, 0.16, 1.2]);
  solid(kit.white, frame, -0.9, 1.15, -1.2, [2.9, 0.12, 0.04]);
  solid(kit.white, frame, -0.9, 1.15, 1.2, [2.9, 0.12, 0.04]);
  solid(kit.yellow, frame, 1.5, 1.6, 0, [0.35, 0.55, 0.35]);
  const base = at(frame, 1.5, 2.1, 0);
  const tip = at(frame, -2.6, 4.2, 0);
  beam(kit.yellow, base, tip, 0.32);
  solid(kit.lamps, frame, 2.9, 2.75, 0, [0.15, 0.06, 0.8]);
  wheels(kit, frame, [-2.8, -1.6, 2.9], 1.05);
  return 9.6;
}

function generator(kit: Kit, frame: Frame): number {
  solid(kit.yellow, frame, 0, 0.85, 0, [1.4, 0.75, 0.6]);
  solid(kit.dark, frame, 0, 0.06, 0, [1.5, 0.08, 0.7]);
  solid(kit.dark, frame, 0.9, 1.25, -0.61, [0.4, 0.25, 0.02]);
  solid(kit.dark, frame, -1.0, 1.75, 0, [0.08, 0.2, 0.08]);
  return 3.4;
}

function container(kit: Kit, frame: Frame): number {
  solid(kit.blue, frame, 0, 1.3, 0, [3.05, 1.3, 1.22]);
  for (let k = -5; k <= 5; k++)
    solid(kit.blue, frame, k * 0.55, 1.3, -1.23, [0.06, 1.22, 0.02]);
  solid(kit.dark, frame, 3.06, 1.3, 0, [0.02, 1.2, 1.15]);
  return 6.6;
}

function tower(kit: Kit, frame: Frame): number {
  solid(kit.yellow, frame, 0, 0.75, 0, [1.4, 0.45, 0.75]);
  wheels(kit, frame, [0], 0.85);
  const foot = at(frame, 0.2, 1.2, 0);
  const head = at(frame, 0.2, 8.2, 0);
  beam(kit.dark, foot, head, 0.16);
  solid(kit.dark, frame, 0.2, 8.45, 0, [0.12, 0.35, 1.0]);
  for (const c of [-0.6, -0.2, 0.2, 0.6])
    solid(kit.lamps, frame, 0.33, 8.45, c, [0.02, 0.28, 0.16]);
  kit.spots.push({
    head: at(frame, 0.4, 8.45, 0),
    aim: at(frame, 14, 0, 0),
    gain: lampGains.tower,
    reach: 48,
  });
  return 3.4;
}

const builders: Record<string, (kit: Kit, frame: Frame) => number> = {
  cabin,
  van,
  truck,
  generator,
  container,
  tower,
};

function frameAt(
  list: Station[],
  length: number,
  cluster: ServiceCluster,
  offset: number,
  index: number,
): Frame {
  const station = stationAt(list, length, wrap(cluster.at + offset, length));
  const lateral =
    wallAt(station, cluster.side) + cluster.back + (index % 2) * 1.6;
  const centre = place(station, cluster.side * lateral, 0);
  const twist = (index % 3 === 1 ? lean : -lean) * cluster.side;
  const lx = station.lx * Math.cos(twist) - station.lz * Math.sin(twist);
  const lz = station.lz * Math.cos(twist) + station.lx * Math.sin(twist);
  return {
    centre,
    along: [-lz, 0, lx],
    across: [lx * cluster.side, 0, lz * cluster.side],
  };
}

export function serviceParts(
  list: Station[],
  length: number,
  clusters: ServiceCluster[],
  spots: LampSpot[],
): Part[] {
  const kit: Kit = {
    spots,
    white: new Builder(1),
    glass: new Builder(1),
    dark: new Builder(1),
    yellow: new Builder(1),
    blue: new Builder(1),
    lamps: new Builder(1),
  };
  for (const cluster of clusters) {
    let offset = 0;
    cluster.kinds.forEach((kind, index) => {
      const make = builders[kind];
      if (!make) return;
      const frame = frameAt(list, length, cluster, offset, index);
      offset += make(kit, frame) + spacing;
    });
  }
  return [
    kit.white.part("service white", "track service white"),
    kit.glass.part("service glass", "track service glass"),
    kit.dark.part("service dark", "track prop dark"),
    kit.yellow.part("service yellow", "track prop crane"),
    kit.blue.part("service blue", "track service blue"),
    kit.lamps.part("service lamps", "track stand lights"),
  ];
}
