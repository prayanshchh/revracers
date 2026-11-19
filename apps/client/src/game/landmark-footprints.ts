import footprints from "../../../../content/tracks/hill-country/landmarks.json";

export interface Footprint {
  name: string;
  solid: boolean;
  outline: number[][];
}

function edgeGap(outline: number[][], x: number, z: number): number {
  let best = Infinity;
  outline.forEach(([ax = 0, az = 0], k) => {
    const [bx = 0, bz = 0] = outline[(k + 1) % outline.length] ?? [];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(
      0,
      Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)),
    );
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  });
  return best;
}

function enclosed(outline: number[][], x: number, z: number): boolean {
  let inside = false;
  outline.forEach(([ax = 0, az = 0], k) => {
    const [bx = 0, bz = 0] = outline[(k + 1) % outline.length] ?? [];
    if (az > z !== bz > z && x < ax + ((z - az) * (bx - ax)) / (bz - az))
      inside = !inside;
  });
  return inside;
}

export function inFootprint(
  footprints: Footprint[],
  x: number,
  z: number,
  margin: number,
): boolean {
  return footprints.some(
    ({ outline }) => enclosed(outline, x, z) || edgeGap(outline, x, z) < margin,
  );
}

const solid = (footprints as Footprint[]).filter((print) => print.solid);

export function unbuilt(trees: Float32Array, stride: number): Float32Array {
  const kept: number[] = [];
  for (let i = 0; i + stride <= trees.length; i += stride) {
    const x = trees[i] ?? 0;
    const z = -(trees[i + 1] ?? 0);
    if (!inFootprint(solid, x, z, 0))
      kept.push(...trees.subarray(i, i + stride));
  }
  return new Float32Array(kept);
}
