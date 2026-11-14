export function headed(
  points: [number, number][],
  heading: number | undefined,
  yUp: boolean,
): [number, number][] {
  const first = points[0];
  const next = points[Math.min(2, points.length - 1)];
  if (heading === undefined || !first || !next) return points;
  const flip = yUp ? -1 : 1;
  const now = Math.atan2(flip * (next[1] - first[1]), next[0] - first[0]);
  const turn = flip * ((heading * Math.PI) / 180 - now);
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  return points.map(([x, y]) => [x * c - y * s, x * s + y * c]);
}
