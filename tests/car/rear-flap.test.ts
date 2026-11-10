import { existsSync } from "node:fs";
import * as THREE from "three/webgpu";
import { describe, expect, test } from "vitest";
import {
  carField,
  carStride,
  frameIndex,
} from "../../apps/client/src/game/frame-layout.ts";
import { MeshoptSimplifier } from "meshoptimizer";
import { detailLevels } from "../../apps/client/src/game/detail-level.ts";
import { flapName, RearFlap } from "../../apps/client/src/game/rear-flap.ts";
import { simplifiedBody } from "../../apps/client/src/game/simplify.ts";
import { planWeekend } from "../../apps/client/src/game/weekend.ts";
import {
  energyReader,
  type RaceSystems,
  startRace,
} from "../support/race-systems.ts";
import { sessionKind, startField, subset } from "../support/race-weekend.ts";
import { wasm } from "../support/speed-dreams.ts";

const rearWing = 6;
const opened = 0.3;
const fieldCars = 4;
const stepsPerFrame = 8;
const frameSeconds = stepsPerFrame / 500;
const closeSeconds = 0.1;
const raceFrames = 6000;

class ShownFlap {
  private readonly node = new THREE.Group();
  private readonly flap: RearFlap;
  widest = 0;

  constructor() {
    const model = new THREE.Group();
    this.node.name = "rear-flap";
    model.add(this.node);
    const flap = RearFlap.find(model);
    if (!flap) throw new Error("no rear flap");
    this.flap = flap;
  }

  show(opening: number): number {
    this.flap.update(opening);
    const e = this.node.matrix.elements;
    const angle = Math.abs(Math.atan2(e[6], e[5]));
    this.widest = Math.max(this.widest, angle);
    return angle;
  }
}

async function playerFlap(setup: (m: RaceSystems) => void) {
  const m = await startRace();
  setup(m);
  const energy = energyReader(m);
  const shown = new ShownFlap();
  let drift = 0;
  for (let tick = 0; tick < 3000; tick++) {
    m._sdInputAnalog(1, 0, 1, 0);
    m._sdStep(1);
    const frame = new Float64Array(
      m.HEAPF64.buffer,
      m._sdFrame(),
      frameIndex.size,
    );
    const opening = frame[frameIndex.rearFlap] ?? 0;
    shown.show(opening);
    drift = Math.max(drift, Math.abs(opening - energy().straight));
  }
  return { widest: shown.widest, drift };
}

describe.runIf(existsSync(wasm))("rear wing flap", () => {
  test("opens on a straight exactly as the engine's Straight Mode does", async () => {
    const clean = await playerFlap(() => undefined);
    expect(clean.widest).toBeGreaterThan(opened);
    expect(clean.drift).toBe(0);
  });

  test("stays shut when the rear wing is wrecked or manual Straight Mode is not armed", async () => {
    const wrecked = await playerFlap((m) => {
      m._sdCarDamageSet(rearWing, 1);
    });
    const unarmed = await playerFlap((m) => {
      m._sdEnergyStraight(0, 0);
    });
    expect(wrecked.widest).toBe(0);
    expect(unarmed.widest).toBe(0);
  });

  test("rival flaps open in the Straight Mode zones and shut as soon as they brake", async () => {
    const m = await startField({
      kind: sessionKind.race,
      laps: 3,
      seed: 4,
      plan: subset(planWeekend("corvus", 0, null), fieldCars),
      autopilot: true,
    });
    const memory = m._malloc(fieldCars * carStride * 8);
    const shown = Array.from({ length: fieldCars }, () => new ShownFlap());
    const braking = Array.from({ length: fieldCars }, () => 0);
    let openUnderBraking = 0;
    for (let frame = 0; frame < raceFrames; frame++) {
      m._sdStep(stepsPerFrame);
      m._sdCars(memory);
      const data = new Float64Array(
        m.HEAPF64.buffer,
        memory,
        fieldCars * carStride,
      );
      shown.forEach((flap, car) => {
        const at = car * carStride;
        const angle = flap.show(data[at + carField.rearFlap] ?? 0);
        braking[car] =
          (data[at + carField.brake] ?? 0) > 0.02
            ? (braking[car] ?? 0) + frameSeconds
            : 0;
        if ((braking[car] ?? 0) > closeSeconds && angle > 0) openUnderBraking++;
      });
    }
    for (const flap of shown) expect(flap.widest).toBeGreaterThan(opened);
    expect(openUnderBraking).toBe(0);
  }, 120_000);
});

function rivalModel(): THREE.Group {
  const atlas = new THREE.MeshStandardMaterial({ name: "rival atlas" });
  const body = new THREE.Group();
  const model = new THREE.Group();
  const flap = new THREE.Group();
  flap.name = flapName;
  flap.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.4, 0.4).translate(0, 0.9, -2.4),
      atlas,
    ),
  );
  model.add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 4), atlas), flap);
  body.add(model);
  return body;
}

function topOf(root: THREE.Object3D): number {
  let top = -Infinity;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry as THREE.BufferGeometry;
    const index = geometry.index;
    const position = geometry.getAttribute("position");
    const count = index ? index.count : position.count;
    for (let i = 0; i < count; i++)
      top = Math.max(top, position.getY(index ? index.getX(i) : i));
  });
  return top;
}

describe("distant rival flaps", () => {
  test("every simpler rival model keeps its flap apart from the body so it still opens", async () => {
    await MeshoptSimplifier.ready;
    for (const { error } of detailLevels) {
      const level = simplifiedBody(rivalModel(), error);
      const flap = RearFlap.find(level);
      const node = level.getObjectByName(flapName);
      if (!flap || !node) throw new Error("a simpler model lost its flap");
      const fixed = new THREE.Group();
      for (const part of level.children)
        if (part !== node) fixed.add(part.clone());
      expect(topOf(node)).toBeGreaterThan(0.9);
      expect(topOf(fixed)).toBeLessThan(0.31);
      flap.update(1);
      expect(node.matrix.equals(new THREE.Matrix4())).toBe(false);
    }
  });
});
