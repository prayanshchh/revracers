import type { Celebrant } from "./celebrant.ts";
import {
  armsUp,
  bounce,
  cheer,
  clap,
  clapHigh,
  crouch,
  type Cue,
  disbelief,
  duck,
  gaze,
  hop,
  journey,
  layers,
  lookAt,
  type Move,
  pull,
  sequence,
  setHand,
  together,
  touch,
  wave,
} from "./celebration-moves.ts";
import { mixV, type V3, wander } from "./crew-motion.ts";
import {
  gripBottle,
  gripTrophy,
  type Prop,
  type PropKey,
} from "./podium-props.ts";
import { seeded } from "./random.ts";

export const parcLength = 8.6;
export const podiumTimes = {
  third: 5,
  second: 8.8,
  winner: 12.6,
  spray: 18.6,
  end: 28.6,
};
const beats = [podiumTimes.winner, podiumTimes.second, podiumTimes.third];
const raise = podiumTimes.winner + 3.5;
const spray = podiumTimes.spray;
const crowdAim = [0, -3.6, 1.6] as V3;

export interface Driver {
  body: Celebrant;
  trophy: Prop;
  bottle: Prop;
}

export interface Bones {
  bone: (body: Celebrant, name: string) => V3;
}

const over = (p: V3, dx: number, dy: number, dz: number): V3 => [
  p[0] + dx,
  p[1] + dy,
  p[2] + dz,
];

const pumpOne =
  (side: number): Move =>
  (draft, t, k, body) => {
    const beat = Math.abs(
      Math.sin(Math.PI * (t * 1.8 * body.build.tempo + body.seed)),
    );
    setHand(
      draft,
      side,
      {
        at: [0.14, side * 0.24, 1.7 + 0.26 * beat],
        pole: [0.15, side, -0.35],
        fingers: [0.05, 0, 1],
        palm: [1, 0, 0],
        grip: 1,
      },
      k,
    );
  };

const wild = together(cheer, hop(0.2, 1.2));
const jumpy = together(armsUp, hop(0.16, 1.05));
const crowdPool: Move[] = [
  cheer,
  clap,
  clapHigh,
  armsUp,
  pull,
  wave(-1),
  wave(1),
  together(cheer, hop(0.12, 1.1)),
  together(clap, bounce),
  together(pumpOne(-1), bounce),
];

function fill(
  from: number,
  to: number,
  random: () => number,
  pool: Move[],
): Cue[] {
  const cues: Cue[] = [];
  let at = from + random() * 0.4;
  while (at < to - 0.8) {
    const length = 1.4 + random() * 1.8;
    const move = pool[Math.floor(random() * pool.length)] ?? cheer;
    cues.push({ from: at, to: Math.min(to, at + length), move });
    at += length - 0.3;
  }
  return cues;
}

function scheduled(
  windows: Cue[],
  end: number,
  random: () => number,
  pool: Move[],
): Cue[] {
  const sorted = [...windows].sort((a, b) => a.from - b.from);
  const cues: Cue[] = [];
  let at = 0;
  for (const window of sorted) {
    cues.push(...fill(at, window.from + 0.2, random, pool), window);
    at = window.to - 0.2;
  }
  return [...cues, ...fill(at, end, random, pool)];
}

function trophyKeys(place: number): PropKey[] {
  const beat = beats[place] ?? 0;
  const chest: V3 = [0.34, 0, 1.0];
  const high: V3 = [0.12, 0, place === 0 ? 1.5 : 1.62];
  const dip: V3 = [0.14, 0, high[2] - 0.1];
  const pumps = (from: number, count: number): PropKey[] =>
    Array.from({ length: count }, (_, i) => ({
      at: from + i * 0.42,
      where: i % 2 === 0 ? dip : high,
    }));
  const lift: PropKey[] = [
    { at: beat + 0.75, where: null },
    { at: beat + 1.5, where: chest },
  ];
  const down: PropKey[] = [
    { at: spray + 0.25, where: chest },
    { at: spray + 1.0, where: null },
  ];
  if (place === 0)
    return [
      ...lift,
      { at: beat + 2.1, where: [0.27, 0, 1.1] },
      { at: beat + 2.8, where: [0.27, 0, 1.1] },
      { at: beat + 3.5, where: high },
      ...pumps(beat + 3.9, 5),
      { at: beat + 6, where: [0.3, 0, 1.2] },
      ...down,
    ];
  return [
    ...lift,
    { at: beat + 2.2, where: high },
    ...pumps(beat + 2.6, 3),
    { at: beat + 3.9, where: chest },
    { at: raise, where: chest },
    { at: raise + 0.5, where: high },
    { at: raise + 1.8, where: high },
    { at: raise + 2.3, where: chest },
    ...down,
  ];
}

function sprayPose(body: Celebrant, aim: (now: number) => V3) {
  const where = (now: number): V3 => {
    const [, l] = body.local(aim(now));
    return [0.36, Math.max(-0.2, Math.min(0.16, l * 0.12)) - 0.06, 1.25];
  };
  const axis = (now: number): V3 => {
    const [f, l, u] = body.local(aim(now));
    const length = Math.hypot(f - 0.4, l, u - 1.45) || 1;
    return [(f - 0.4) / length, l / length, (u - 1.45) / length + 0.32];
  };
  return { where, axis, spray: true };
}

function bottleKeys(
  place: number,
  body: Celebrant,
  aim: (now: number) => V3,
): PropKey[] {
  const shake: V3 = [0.3, -0.04, 1.15];
  const pose = sprayPose(body, aim);
  const start: PropKey[] = [
    { at: spray + 1.45, where: null },
    { at: spray + 2.0, where: shake, shake: 0.075 },
    { at: spray + 3.4, where: shake, shake: 0.075 },
  ];
  if (place !== 0) return [...start, { at: spray + 3.75, ...pose }];
  const drink: V3 = [0.27, 0.02, 1.66];
  const tilt: V3 = [-0.62, 0, -0.42];
  return [
    ...start,
    { at: spray + 3.85, ...pose },
    { at: spray + 6.6, ...pose },
    { at: spray + 7.2, where: drink, axis: tilt },
    { at: spray + 8.0, where: drink, axis: tilt },
    { at: spray + 8.4, ...pose },
  ];
}

function aimOf(
  place: number,
  heads: (place: number) => V3,
): (now: number) => V3 {
  if (place !== 0) return () => over(heads(0), 0, 0, -0.1);
  return (now) => {
    const t = now - spray;
    if (t < 5.4) return heads(1);
    if (t < 6.6 || t >= 9.4) return crowdAim;
    return heads(2);
  };
}

const greetings: Record<number, Cue[]> = {
  0: [
    { from: 0.4, to: 2.6, move: wave(-1) },
    { from: 2.6, to: 4.6, move: cheer },
    { from: 5.3, to: 8.4, move: clap },
    { from: 9.1, to: 12.2, move: clap },
  ],
  1: [
    { from: 0.6, to: 3.4, move: wave(1) },
    { from: 3.4, to: 4.6, move: clap },
    { from: 5.3, to: 8.4, move: clap },
  ],
  2: [{ from: 0.5, to: 4.6, move: wave(-1) }],
};

export function driverScript(
  place: number,
  driver: Driver,
  heads: (place: number) => V3,
): void {
  const { body, trophy, bottle } = driver;
  const beat = beats[place] ?? 0;
  const aim = aimOf(place, heads);
  trophy.holder = body;
  bottle.holder = body;
  trophy.keys = trophyKeys(place);
  bottle.keys = bottleKeys(place, body, aim);
  const crowd = (now: number): V3 => [
    body.at.x + 0.6 * wander(now, body.seed, 0.4),
    -5.5,
    1.8 + 0.2 * wander(now, body.seed + 3, 0.5),
  ];
  const hands = sequence([
    ...(greetings[place] ?? []),
    {
      from: beat + 0.15,
      to: spray + 1.0,
      move: gripTrophy(trophy),
      fade: 0.65,
    },
    {
      from: spray + 0.95,
      to: podiumTimes.end + 2,
      move: gripBottle(bottle),
      fade: 0.5,
    },
  ]);
  const looks = sequence([
    ...[2, 1, 0]
      .filter((other) => other !== place && (beats[other] ?? 0) < beat)
      .map((other) => ({
        from: (beats[other] ?? 0) + 0.3,
        to: (beats[other] ?? 0) + 3.6,
        move: lookAt(() => heads(other)),
      })),
    { from: beat + 0.2, to: beat + 1.6, move: lookAt(() => trophy.at) },
    {
      from: beat + 2.0,
      to: beat + 2.9,
      move: lookAt(() => over(trophy.at, 0, 0, 0.45)),
    },
    { from: spray + 3.7, to: podiumTimes.end + 2, move: lookAt(aim) },
  ]);
  const moves = sequence(bodyCues(place, beat));
  body.routine = layers(gaze(crowd), hands, looks, moves);
}

const lean =
  (by: number): Move =>
  (draft, _t, k) => {
    draft.lean += by * k;
  };

function bodyCues(place: number, beat: number): Cue[] {
  if (place === 0)
    return [
      { from: beat + 3.5, to: beat + 5.8, move: hop(0.16, 1.1) },
      { from: spray + 4.0, to: spray + 4.7, move: duck(-1) },
      { from: spray + 7.2, to: spray + 8.0, move: lean(-0.18) },
    ];
  const from = place === 1 ? 1 : -1;
  const hit = place === 1 ? spray + 4.3 : spray + 8.9;
  return [
    { from: beat + 2.2, to: beat + 3.7, move: bounce },
    { from: raise + 0.4, to: raise + 1.9, move: bounce },
    { from: hit, to: hit + 0.9, move: duck(from) },
  ];
}

export function crowdScript(
  body: Celebrant,
  team: number,
  heads: (place: number) => V3,
): void {
  const random = seeded(Math.floor(body.seed * 9973));
  const own = beats[team] ?? 0;
  const windows: Cue[] = [
    { from: own + 1.4, to: own + 3.8, move: wild },
    { from: raise - 0.1, to: raise + 2.2, move: wild },
    { from: spray + 5.4, to: spray + 6.7, move: jumpy },
  ];
  if (team === 0) windows.splice(0, 1);
  const focus = (now: number): V3 => {
    const place = now < 5 ? 0 : now < 8.8 ? 2 : now < 12.6 ? 1 : 0;
    return over(
      heads(place),
      0.3 * wander(now, body.seed, 0.3),
      0,
      -0.2 + 0.15 * wander(now, body.seed + 1, 0.4),
    );
  };
  body.routine = layers(
    gaze(focus),
    sequence(scheduled(windows, podiumTimes.end + 2, random, crowdPool)),
  );
}

export interface Parc {
  driver: Celebrant;
  crew: Celebrant[];
}

const parcStand: V3 = [-0.68, -8.05, 0.72];
const parcLand: V3 = [-1.42, -7.9, 0];
export const parcCrewSpots: [number, number][] = [
  [-2.36, -9.4],
  [-2.36, -8.65],
  [-2.36, -7.9],
  [-2.36, -7.15],
  [-2.36, -6.4],
  [-3.05, -9.05],
  [-3.05, -8.3],
  [-3.05, -7.55],
  [-3.05, -6.8],
  [-3.05, -6.05],
];

export function parcDriver(parc: Parc, bones: Bones): void {
  const { driver, crew } = parc;
  const { bone } = bones;
  const at = (j: number, name: string) => {
    const member = crew[j];
    return member ? bone(member, name) : parcLand;
  };
  driver.routine = layers(
    journey([
      { t: 0, at: parcStand, yaw: Math.PI },
      { t: 2.95, at: parcStand, yaw: Math.PI },
      { t: 3.5, at: parcLand, yaw: Math.PI, leap: 0.38 },
    ]),
    gaze(() => at(2, "Head")),
    sequence([
      { from: 0, to: 0.95, move: disbelief, fade: 0.2 },
      { from: 0.8, to: 2.55, move: cheer },
      { from: 2.5, to: 3.0, move: crouch, fade: 0.25 },
      { from: 2.95, to: 3.5, move: armsUp, fade: 0.15 },
      { from: 3.45, to: 3.95, move: crouch, fade: 0.12 },
      {
        from: 3.9,
        to: 5.6,
        move: together(
          touch(1, "hug", () => over(at(2, "clavicle_r"), -0.14, 0, 0.02)),
          touch(-1, "hug", () => over(at(2, "clavicle_l"), -0.14, 0, 0.02)),
        ),
      },
      {
        from: 5.6,
        to: 6.3,
        move: touch(-1, "five", () => fivePoint(bone, driver, crew[3])),
      },
      {
        from: 6.3,
        to: 7.0,
        move: touch(1, "five", () => fivePoint(bone, driver, crew[1])),
      },
      { from: 7.0, to: parcLength + 1, move: wild },
    ]),
  );
}

function fivePoint(
  bone: Bones["bone"],
  driver: Celebrant,
  member: Celebrant | undefined,
): V3 {
  const a = bone(driver, "Head");
  const b = member ? bone(member, "Head") : a;
  const mid = mixV(a, b, 0.5);
  return [mid[0], mid[1], 1.92];
}

export function parcCrew(parc: Parc, bones: Bones): void {
  const { driver, crew } = parc;
  const { bone } = bones;
  const toDriver = (name: string, dx: number, dz: number) => () =>
    over(bone(driver, name), dx, 0, dz);
  crew.forEach((member, j) => {
    const random = seeded(31 + j * 7);
    const late = moments(j, parc, bones, toDriver);
    member.routine = layers(
      gaze(() => over(bone(driver, "Head"), 0, 0, -0.1)),
      sequence([
        ...fill(0, 2.9, random, [
          cheer,
          pull,
          armsUp,
          clapHigh,
          together(cheer, hop(0.14, 1.3)),
        ]),
        { from: 2.9, to: 3.8, move: wild },
        ...late,
        ...fill(late.at(-1)?.to ?? 3.8, parcLength + 1, random, [
          wild,
          jumpy,
          cheer,
          clapHigh,
        ]),
      ]),
    );
  });
}

function moments(
  j: number,
  parc: Parc,
  bones: Bones,
  toDriver: (name: string, dx: number, dz: number) => () => V3,
): Cue[] {
  const { driver } = parc;
  const member = parc.crew[j];
  const five = () => fivePoint(bones.bone, driver, member);
  const plans: Record<number, Cue[]> = {
    1: [
      {
        from: 3.85,
        to: 5.9,
        move: together(touch(-1, "pat", toDriver("Head", 0, 0.14)), pumpOne(1)),
      },
      { from: 6.3, to: 7.0, move: touch(1, "five", five) },
    ],
    2: [
      {
        from: 3.8,
        to: 5.7,
        move: together(
          touch(1, "hug", toDriver("clavicle_r", 0.14, 0.02)),
          touch(-1, "hug", toDriver("clavicle_l", 0.14, 0.02)),
        ),
      },
    ],
    3: [
      {
        from: 3.85,
        to: 5.55,
        move: together(touch(1, "pat", toDriver("Head", 0, 0.14)), pumpOne(-1)),
      },
      { from: 5.6, to: 6.3, move: touch(-1, "five", five) },
    ],
  };
  return plans[j] ?? [{ from: 3.8, to: 5.4, move: jumpy }];
}
