import type { Celebrant, Routine } from "./celebrant.ts";
import {
  blendHand,
  type Draft,
  type HandDraft,
  mix,
  mixV,
  span,
  type V3,
  wander,
} from "./crew-motion.ts";

export type Move = (
  draft: Draft,
  t: number,
  k: number,
  body: Celebrant,
) => void;

export interface Cue {
  from: number;
  to: number;
  move: Move;
  fade?: number;
}

export interface Waypoint {
  t: number;
  at: V3;
  yaw: number;
  leap?: number;
}

const fadeTime = 0.32;

export function sequence(cues: Cue[]): Routine {
  const sorted = [...cues].sort((a, b) => a.from - b.from);
  return (draft, now, body) => {
    sorted.forEach((cue, i) => {
      const next = sorted[i + 1];
      const handed = next !== undefined && next.from <= cue.to;
      const end = handed ? next.from + (next.fade ?? fadeTime) : cue.to;
      if (now < cue.from || now > end) return;
      const fade = cue.fade ?? fadeTime;
      const out = handed ? 1 : 1 - span(now, cue.to - fade, cue.to);
      const k = span(now, cue.from, cue.from + fade) * out;
      if (k > 1e-3) cue.move(draft, now - cue.from, k, body);
    });
  };
}

export function layers(...routines: Routine[]): Routine {
  return (draft, now, body) => {
    for (const routine of routines) routine(draft, now, body);
  };
}

export function together(...moves: Move[]): Move {
  return (draft, t, k, body) => {
    for (const move of moves) move(draft, t, k, body);
  };
}

export function journey(points: Waypoint[]): Routine {
  return (_draft, now, body) => {
    const next = points.findIndex((p) => p.t > now);
    const last = points.at(-1);
    const to = next < 0 ? last : points[next];
    const from = next <= 0 ? to : points[next - 1];
    if (!from || !to) return;
    const u = to.t > from.t ? Math.min(1, (now - from.t) / (to.t - from.t)) : 1;
    const leap = to.leap ?? 0;
    const e = leap > 0 ? u : span(u, 0, 1);
    body.at.x = mix(from.at[0], to.at[0], e);
    body.at.y = mix(from.at[1], to.at[1], e);
    body.at.z = mix(from.at[2], to.at[2], e) + 4 * leap * u * (1 - u);
    body.at.yaw = mix(from.yaw, to.yaw, span(u, 0, 0.6));
    body.flying = leap > 0 && u > 0 && u < 1;
  };
}

export function setHand(
  draft: Draft,
  side: number,
  wanted: HandDraft,
  k: number,
): void {
  const i = side > 0 ? 0 : 1;
  draft.hands[i] = blendHand(draft.hands[i], wanted, k, i);
}

function setHands(
  draft: Draft,
  left: HandDraft,
  right: HandDraft,
  k: number,
): void {
  setHand(draft, 1, left, k);
  setHand(draft, -1, right, k);
}

const fist = (at: V3, side: number): HandDraft => ({
  at,
  pole: [0.15, side, -0.35],
  fingers: [0.05, side * 0.1, 1],
  palm: [1, 0, 0],
  grip: 1,
});

const rhythm = (t: number, rate: number, body: Celebrant) =>
  t * rate * body.build.tempo + body.seed * 0.37;

export const cheer: Move = (draft, t, k, body) => {
  const beat = Math.abs(Math.sin(Math.PI * rhythm(t, 1.7, body)));
  const reach = 1.72 + 0.24 * beat;
  setHands(
    draft,
    fist([0.1, 0.27, reach], 1),
    fist([0.1, -0.27, reach + 0.03], -1),
    k,
  );
  draft.hips[2] -= 0.04 * (1 - beat) * k;
  draft.lean -= 0.1 * k;
};

export const pull: Move = (draft, t, k, body) => {
  const cycle = rhythm(t, 1.2, body) % 1;
  const down = span(cycle, 0.42, 0.56) * (1 - span(cycle, 0.74, 1));
  setHands(
    draft,
    fist([0.3, 0.14, 1.1], 1),
    fist(mixV([0.16, -0.24, 1.9], [0.36, -0.08, 1.16], down), -1),
    k,
  );
  draft.hips[2] -= 0.08 * down * k;
  draft.lean += 0.24 * down * k;
  draft.twist -= 0.12 * down * k;
};

function clapAt(height: number, ahead: number, rate: number): Move {
  return (draft, t, k, body) => {
    const open = Math.abs(Math.sin(Math.PI * rhythm(t, rate, body))) ** 0.55;
    const gap = 0.022 + 0.13 * open;
    const palm = (side: number): HandDraft => ({
      at: [ahead, side * gap, height],
      pole: [-0.6, side, -0.45],
      fingers: [0.55, -side * 0.12, 0.82],
      palm: [0, -side, 0],
      grip: 0.1,
    });
    setHands(draft, palm(1), palm(-1), k);
    draft.lean += 0.04 * k;
  };
}

export const clap = clapAt(1.22, 0.34, 2.1);
export const clapHigh = clapAt(1.86, 0.16, 1.8);

export function wave(side: number): Move {
  return (draft, t, k, body) => {
    const swing = Math.sin(Math.PI * rhythm(t, 2.4, body));
    setHand(
      draft,
      side,
      {
        at: [0.2, side * (0.42 + 0.05 * swing), 1.72],
        pole: [-0.1, side, -0.55],
        fingers: [0.1, side * (0.12 + 0.32 * swing), 1],
        palm: [1, 0, 0],
        grip: 0.05,
      },
      k,
    );
    draft.side -= side * 0.04 * k;
  };
}

export const armsUp: Move = (draft, t, k, body) => {
  const sway = Math.sin(Math.PI * rhythm(t, 1.1, body));
  const open = (side: number): HandDraft => ({
    at: [0.12, side * 0.6, 1.84 + 0.05 * sway * side],
    pole: [0, side, -0.4],
    fingers: [0.1, side * 0.45, 0.9],
    palm: [1, 0, 0],
    grip: 0.25,
  });
  setHands(draft, open(1), open(-1), k);
  draft.side += 0.05 * sway * k;
  draft.lean -= 0.06 * k;
};

export function hop(height: number, rate: number): Move {
  return (draft, t, k, body) => {
    const phase = rhythm(t, rate, body) % 1;
    const flight = phase > 0.3 && phase < 0.75 ? (phase - 0.3) / 0.45 : -1;
    const sink = (phase + 0.25) % 1;
    const dip = sink < 0.55 ? Math.sin((Math.PI * sink) / 0.55) : 0;
    const air = flight >= 0 ? Math.sin(Math.PI * flight) : 0;
    body.air = Math.max(body.air, height * air * k);
    draft.hips[2] -= 0.11 * dip * k;
    draft.lean += 0.14 * dip * k;
    for (const foot of draft.feet) foot.heel += 0.55 * air * k;
  };
}

export const bounce: Move = (draft, t, k, body) => {
  const up = Math.abs(Math.sin(Math.PI * rhythm(t, 2, body)));
  draft.hips[2] += (0.02 * up - 0.025) * k;
  for (const foot of draft.feet) foot.heel += 0.3 * up * k;
};

export const disbelief: Move = (draft, t, k, body) => {
  const rock = wander(t, body.seed, 2.2);
  const onHelmet = (side: number): HandDraft => ({
    at: [0.02, side * 0.16, 1.7],
    pole: [0.2, side, 0.2],
    fingers: [0.35, -side * 0.15, 0.9],
    palm: [0, -side, 0],
    grip: 0.25,
  });
  setHands(draft, onHelmet(1), onHelmet(-1), k);
  draft.lean += (0.05 * rock - 0.1) * k;
  draft.twist += 0.08 * rock * k;
};

export const crouch: Move = (draft, t, k) => {
  const down = span(t, 0, 0.35);
  const back = (side: number): HandDraft => ({
    at: [-0.12, side * 0.3, 0.86],
    pole: [-1, side * 0.3, 0],
    fingers: [-0.4, 0, -1],
    palm: [0, -side, 0],
    grip: 0.5,
  });
  setHands(draft, back(1), back(-1), k * down);
  draft.hips[2] -= 0.17 * down * k;
  draft.lean += 0.32 * down * k;
};

export function duck(from: number): Move {
  return (draft, t, k) => {
    const flinch = span(t, 0, 0.25);
    draft.twist -= from * 0.42 * flinch * k;
    draft.lean += 0.34 * flinch * k;
    draft.hips[2] -= 0.06 * flinch * k;
    draft.side -= from * 0.06 * flinch * k;
  };
}

export function gaze(target: (now: number) => V3): Routine {
  return (draft, now) => {
    draft.look = target(now);
  };
}

export function lookAt(target: (now: number) => V3): Move {
  return (draft, t, k, body) => {
    const wanted = target(t);
    draft.look = draft.look ? mixV(draft.look, wanted, k) : wanted;
    const [f, l] = body.local(wanted);
    draft.twist += Math.max(-0.5, Math.min(0.5, Math.atan2(l, f) * 0.45)) * k;
  };
}

export type Touch = "pat" | "hug" | "five";

export function touch(side: number, style: Touch, target: () => V3): Move {
  return (draft, t, k, body) => {
    const at = body.local(target());
    const pat = style === "pat" ? 0.035 * Math.abs(Math.sin(t * 9.5)) : 0;
    const shapes: Record<Touch, HandDraft> = {
      pat: {
        at: [at[0], at[1], at[2] + 0.04 + pat],
        pole: [0, side, -0.5],
        fingers: [1, 0, -0.2],
        palm: [0, 0, -1],
        grip: 0.2,
      },
      hug: {
        at,
        pole: [0, side, 0.2],
        fingers: [0.3, -side, -0.4],
        palm: [0.6, 0, -0.6],
        grip: 0.45,
      },
      five: {
        at: [
          at[0],
          at[1],
          at[2] + 0.06 * Math.sin(Math.min(1, t * 3) * Math.PI),
        ],
        pole: [-0.2, side, -0.5],
        fingers: [0.1, 0, 1],
        palm: [1, -side * 0.2, 0],
        grip: 0.02,
      },
    };
    setHand(draft, side, shapes[style], k);
    draft.lean += (style === "hug" ? 0.22 : 0.08) * k;
  };
}
