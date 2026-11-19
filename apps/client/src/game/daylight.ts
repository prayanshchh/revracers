export interface SessionLight {
  elevation: number;
  afternoon: boolean;
  night: number;
  lamps: number;
}

const nightBelow = -2;
const lampsBelow = 14;
const lampsFull = 2;

function ramp(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

export function sessionLight(hours: number): SessionLight {
  const degrees = 90 - 15 * Math.abs(hours - 12);
  const night = degrees < nightBelow ? 1 : 0;
  return {
    elevation: (degrees * Math.PI) / 180,
    afternoon: hours > 12,
    night,
    lamps: Math.max(night, ramp(lampsBelow, lampsFull, degrees)),
  };
}

export function lightHour(sdHour: number): number {
  if (!import.meta.env.DEV || typeof location === "undefined") return sdHour;
  const asked = Number(new URLSearchParams(location.search).get("hour"));
  return asked > 0 && asked < 24 ? asked : sdHour;
}

export function irisStops(
  forward: { x: number; y: number },
  sun: { x: number; y: number; z: number },
  stops: readonly [number, number],
): number {
  const flat = Math.hypot(forward.x, forward.y);
  const low = Math.hypot(sun.x, sun.y);
  if (flat < 1e-3 || low < 1e-3 || sun.z <= 0) return 0;
  const facing = (forward.x * sun.x + forward.y * sun.y) / (flat * low);
  return -(facing > 0 ? stops[0] : stops[1]) * facing * low * low;
}
