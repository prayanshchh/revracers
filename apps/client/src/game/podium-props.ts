import * as THREE from "three/webgpu";
import type { Celebrant } from "./celebrant.ts";
import { type Move, setHand } from "./celebration-moves.ts";
import { Follow3, mixV, smooth, type V3 } from "./crew-motion.ts";

type Place = V3 | ((now: number) => V3);

export interface PropKey {
  at: number;
  where: Place | null;
  axis?: Place;
  shake?: number;
  spray?: boolean;
}

interface Pose {
  at: V3;
  axis: V3;
  shake: number;
}

const zAxis = new THREE.Vector3(0, 0, 1);
const shakeRate = 29;
const trophyGrip = { height: 0.62, half: 0.28 };
const bottleGrip = { base: 0.11, neck: 0.31, radius: 0.05 };

const unit = (v: V3): V3 => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
};
const add = (a: V3, b: V3, k = 1): V3 => [
  a[0] + b[0] * k,
  a[1] + b[1] * k,
  a[2] + b[2] * k,
];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const across = (axis: V3, side: V3): V3 =>
  unit(add(side, axis, -dot(side, axis)));
const placeOf = (place: Place, now: number): V3 =>
  typeof place === "function" ? place(now) : place;

export class Prop {
  holder: Celebrant | null = null;
  keys: PropKey[] = [];
  at: V3;
  axis: V3 = [0, 0, 1];
  private readonly follow = new Follow3(4.4, 0.72, 0);
  private readonly turn = new Follow3(4.4, 0.85, 0);
  private readonly direction = new THREE.Vector3();
  private fresh = true;

  constructor(
    readonly object: THREE.Object3D,
    readonly rest: V3,
    readonly length: number,
  ) {
    this.at = rest;
    this.object.position.set(...rest);
  }

  update(now: number, dt: number): void {
    const wanted = this.target(now);
    const shaken = add(wanted.at, [
      0,
      0,
      wanted.shake * Math.sin(now * shakeRate),
    ]);
    const fresh = this.fresh;
    this.fresh = false;
    this.at = fresh ? this.follow.reset(shaken) : this.follow.step(shaken, dt);
    this.axis = unit(
      fresh ? this.turn.reset(wanted.axis) : this.turn.step(wanted.axis, dt),
    );
    this.object.position.set(...this.at);
    this.object.quaternion.setFromUnitVectors(
      zAxis,
      this.direction.set(...this.axis),
    );
  }

  spraying(now: number): boolean {
    return this.keys.findLast((key) => key.at <= now)?.spray === true;
  }

  tip(): V3 {
    return add(this.at, this.axis, this.length);
  }

  private target(now: number): Pose {
    const index = this.keys.findLastIndex((key) => key.at <= now);
    const from = this.keys[index];
    if (!from) return { at: this.rest, axis: [0, 0, 1], shake: 0 };
    const to = this.keys[index + 1];
    const a = this.poseOf(from, now);
    if (!to) return a;
    const b = this.poseOf(to, now);
    const u = smooth((now - from.at) / Math.max(1e-3, to.at - from.at));
    return {
      at: mixV(a.at, b.at, u),
      axis: unit(mixV(a.axis, b.axis, u)),
      shake: a.shake + (b.shake - a.shake) * u,
    };
  }

  private poseOf(key: PropKey, now: number): Pose {
    const holder = this.holder;
    if (!key.where || !holder)
      return { at: this.rest, axis: [0, 0, 1], shake: 0 };
    return {
      at: holder.stage(placeOf(key.where, now)),
      axis: unit(holder.turnOut(placeOf(key.axis ?? [0, 0, 1], now))),
      shake: key.shake ?? 0,
    };
  }
}

function held(k: number): number {
  return k * k * (3 - 2 * k);
}

export function gripTrophy(prop: Prop): Move {
  return (draft, _t, k, body) => {
    const side = across(prop.axis, body.turnOut([0, 1, 0]));
    const ahead = across(prop.axis, body.turnOut([1, 0, 0]));
    const fingers = body.turnIn(
      unit(add(add([0, 0, 0], prop.axis, 0.85), ahead, 0.4)),
    );
    for (const s of [1, -1]) {
      const at = add(
        add(prop.at, prop.axis, trophyGrip.height * prop.length),
        side,
        s * trophyGrip.half * prop.length,
      );
      setHand(
        draft,
        s,
        {
          at: body.local(at),
          pole: [-0.3, s, -0.6],
          fingers: [fingers[0], fingers[1] - s * 0.25, fingers[2]],
          palm: body.turnIn(add([0, 0, 0], side, -s)),
          grip: 0.6,
          hold: held(k),
        },
        k,
      );
    }
  };
}

export function gripBottle(prop: Prop): Move {
  return (draft, _t, k, body) => {
    const side = across(prop.axis, body.turnOut([0, 1, 0]));
    const spots: [number, number][] = [
      [1, bottleGrip.neck],
      [-1, bottleGrip.base],
    ];
    for (const [s, along] of spots) {
      const palm = add([0, 0, 0], side, -s);
      const at = add(
        add(prop.at, prop.axis, along),
        side,
        s * bottleGrip.radius,
      );
      setHand(
        draft,
        s,
        {
          at: body.local(at),
          pole: [-0.4, s, -0.5],
          fingers: body.turnIn(
            s > 0 ? cross(prop.axis, palm) : cross(palm, prop.axis),
          ),
          palm: body.turnIn(palm),
          grip: 0.75,
          hold: held(k),
        },
        k,
      );
    }
  };
}
