import type * as THREE from "three/webgpu";

export const lampMaterial = "led-red";
export const lampMaterials: ReadonlySet<string> = new Set([
  lampMaterial,
  "led-strip",
]);
const brakeLampFrom = 0.05;
export const brakeLampHold = 0.3;
export const energySignal = {
  none: 0,
  single: 1,
  double: 2,
  clipping: 3,
} as const;
const signalPeriod = 1;
const blink = 0.12;
const clippingBlink = 0.08;

export interface CarLamps {
  lit: number;
  held: number;
  signal: number;
  since: number;
}

export function carLamps(): CarLamps {
  return { lit: 0, held: 0, signal: energySignal.none, since: 0 };
}

export function fitLamps(model: THREE.Object3D, lamps: CarLamps): void {
  model.traverse((object) => {
    const material = (object as THREE.Mesh).material as
      THREE.Material | undefined;
    if (material && lampMaterials.has(material.name))
      object.userData = { ...object.userData, lamps };
  });
}

function flashes(signal: number): number {
  if (signal === energySignal.single) return 1;
  return signal === energySignal.double ? 2 : 0;
}

function signalLit(signal: number, since: number): boolean {
  if (signal === energySignal.clipping)
    return since % (2 * clippingBlink) < clippingBlink;
  const at = since % signalPeriod;
  return at < 2 * blink * flashes(signal) && at % (2 * blink) < blink;
}

export function setLamps(
  lamps: CarLamps,
  brake: number,
  signal: number,
  seconds: number,
): void {
  const rewound = seconds < 0;
  const step = Math.max(0, seconds);
  const held = rewound ? 0 : Math.max(0, lamps.held - step);
  lamps.held = brake > brakeLampFrom ? brakeLampHold : held;
  lamps.since = signal === lamps.signal && !rewound ? lamps.since + step : 0;
  lamps.signal = signal;
  lamps.lit = lamps.held > 0 || signalLit(signal, lamps.since) ? 1 : 0;
}

export class PastLamps {
  private readonly past = carLamps();
  private time = 0;
  private live = 0;

  show(lamps: CarLamps, brake: number, signal: number, time: number): void {
    setLamps(this.past, brake, signal, time - this.time);
    this.time = time;
    this.live = lamps.lit;
    lamps.lit = this.past.lit;
  }

  restore(lamps: CarLamps): void {
    lamps.lit = this.live;
  }
}
