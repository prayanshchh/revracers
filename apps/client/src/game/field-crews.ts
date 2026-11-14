import * as THREE from "three/webgpu";
import { newLook } from "./car-damage.ts";
import type { FieldCars } from "./field-cars.ts";
import { aiPit, aiPitPhase, carStride, pitStateSize } from "./frame-layout.ts";
import type { PitCrew } from "./pit-crew.ts";
import type { ParkedBoxes } from "./pit-props.ts";
import { planTimed, type StopPlan } from "./pit-service.ts";
import type { PitPhase } from "./pitstop.ts";

type Point = (distance: number, lateral: number) => [number, number, number];

interface Duty {
  crew: PitCrew;
  car: number;
  box: number;
  plan: StopPlan | null;
}

interface Sight {
  intersectsSphere(sphere: THREE.Sphere): boolean;
}

const crewReach = 9;
const resting = [false, false, false, false];
const boxMatch = 1;

function sameBox(a: number, b: number): boolean {
  return Math.abs(a - b) < boxMatch;
}

export class FieldCrews {
  private readonly duties: Duty[];
  private readonly carMatrix = new THREE.Matrix4();
  private readonly bounds = new THREE.Sphere(new THREE.Vector3(), crewReach);
  private point: Point | null = null;
  private lateral = 0;
  private parked: ParkedBoxes | null = null;
  private home: Duty | null = null;

  constructor(
    crews: PitCrew[],
    private readonly field: FieldCars,
  ) {
    this.duties = crews.map((crew) => ({
      crew,
      car: -1,
      box: 0,
      plan: null,
    }));
  }

  get roots(): THREE.Object3D[] {
    return this.duties.map((duty) => duty.crew.root);
  }

  park(parked: ParkedBoxes): void {
    this.parked = parked;
  }

  lend(crew: PitCrew, box: number): void {
    this.home = { crew, car: -1, box, plan: null };
  }

  guest(pits: Float64Array): number {
    const home = this.home;
    if (!home) return -1;
    const count = Math.floor(pits.length / pitStateSize);
    for (let car = 1; car < count; car++)
      if (
        this.serviced(pits, car) &&
        sameBox(this.state(pits, car, aiPit.box), home.box) &&
        this.phase(pits, car) !== "track"
      )
        return car;
    return -1;
  }

  guestInBox(pits: Float64Array, car: number): boolean {
    const phase = this.state(pits, car, aiPit.phase);
    return phase === aiPitPhase.stopped || phase === aiPitPhase.release;
  }

  serveGuest(
    car: number,
    pits: Float64Array,
    cars: Float64Array,
    eye: THREE.Vector3,
    now: number,
  ): void {
    const home = this.home;
    if (!home) return;
    if (home.car !== car) this.handOver(home, car);
    this.serve(home, pits, cars, eye, now);
  }

  dropGuest(): void {
    const home = this.home;
    if (!home || home.car < 0) return;
    this.field.setPitService(home.car, 0, 0, resting);
    home.car = -1;
    home.plan = null;
    home.crew.rearm();
  }

  private handOver(duty: Duty, car: number): void {
    if (duty.car >= 0) this.field.setPitService(duty.car, 0, 0, resting);
    const mounts = this.field.crewMounts(car);
    duty.crew.rearm();
    duty.car = car;
    duty.plan = null;
    if (mounts)
      duty.crew.attachCar(mounts, null, this.field.damageOf(car) ?? newLook());
  }

  place(point: Point, lateral: number): void {
    this.point = point;
    this.lateral = lateral;
  }

  update(
    pits: Float64Array,
    cars: Float64Array,
    eye: THREE.Vector3,
    now: number,
  ): void {
    this.assign(pits);
    for (const duty of this.duties)
      if (duty.car >= 0) this.serve(duty, pits, cars, eye, now);
  }

  private state(pits: Float64Array, car: number, field: number): number {
    return pits[car * pitStateSize + field] ?? 0;
  }

  private serviced(pits: Float64Array, car: number): boolean {
    return (
      this.state(pits, car, aiPit.noService) === 0 &&
      this.state(pits, car, aiPit.autoRelease) === 1
    );
  }

  private wanted(pits: Float64Array, car: number): boolean {
    const phase = this.state(pits, car, aiPit.phase);
    const box = this.state(pits, car, aiPit.box);
    return (
      (phase === aiPitPhase.lane || phase === aiPitPhase.boxing) &&
      this.serviced(pits, car) &&
      !(this.home && sameBox(box, this.home.box)) &&
      !this.duties.some((duty) => duty.car >= 0 && sameBox(duty.box, box))
    );
  }

  private waiting(pits: Float64Array, duty: Duty): number {
    const count = Math.floor(pits.length / pitStateSize);
    for (let car = 1; car < count; car++) {
      const phase = this.state(pits, car, aiPit.phase);
      if (
        car !== duty.car &&
        (phase === aiPitPhase.lane || phase === aiPitPhase.boxing) &&
        this.serviced(pits, car) &&
        sameBox(this.state(pits, car, aiPit.box), duty.box)
      )
        return car;
    }
    return -1;
  }

  private assign(pits: Float64Array): void {
    const count = Math.floor(pits.length / pitStateSize);
    for (let car = 1; car < count; car++) {
      if (!this.wanted(pits, car)) continue;
      const team = this.field.teamOf(car);
      const duty = this.duties.find(
        (each) => each.car < 0 && each.crew.team === team,
      );
      if (duty) this.take(duty, car, this.state(pits, car, aiPit.box));
    }
  }

  private take(duty: Duty, car: number, box: number): void {
    const mounts = this.field.crewMounts(car);
    if (!mounts || !this.point) return;
    const [x, y, z] = this.point(box, this.lateral);
    const [x2, y2] = this.point(box + 2, this.lateral);
    duty.car = car;
    duty.box = box;
    this.parked?.show(box, false);
    duty.plan = null;
    duty.crew.setAnchor(x, y, z, Math.atan2(y2 - y, x2 - x));
    duty.crew.attachCar(mounts, null, this.field.damageOf(car) ?? newLook());
  }

  private phase(pits: Float64Array, car: number): PitPhase {
    const phase = this.state(pits, car, aiPit.phase);
    if (phase === aiPitPhase.stopped) return "service";
    if (phase === aiPitPhase.release) return "release";
    if (phase === aiPitPhase.exit) return "lane";
    if (phase === aiPitPhase.lane || phase === aiPitPhase.boxing)
      return "boxing";
    return "track";
  }

  private serve(
    duty: Duty,
    pits: Float64Array,
    cars: Float64Array,
    eye: THREE.Vector3,
    now: number,
  ): void {
    const done = this.phase(pits, duty.car);
    const next =
      done === "release" || done === "lane" ? this.waiting(pits, duty) : -1;
    if (next >= 0) this.handOver(duty, next);
    const phase = this.phase(pits, duty.car);
    this.carMatrix.fromArray(cars, duty.car * carStride);
    const compound = this.state(pits, duty.car, aiPit.compound);
    if (compound >= 0) duty.crew.setCompounds(compound);
    const result = duty.crew.update(
      phase,
      this.planFor(duty, phase, pits),
      this.state(pits, duty.car, aiPit.elapsed),
      this.carMatrix,
      eye,
      now,
      cars,
      duty.car,
    );
    if (phase !== "track") {
      this.field.setPitService(
        duty.car,
        result.heave,
        result.pitch,
        result.off,
      );
      return;
    }
    this.field.setPitService(duty.car, 0, 0, resting);
    duty.car = -1;
    this.parked?.show(duty.box, true);
  }

  private planFor(
    duty: Duty,
    phase: PitPhase,
    pits: Float64Array,
  ): StopPlan | null {
    if (phase !== "service") return null;
    duty.plan ??= planTimed(
      this.state(pits, duty.car, aiPit.duration),
      Math.random,
    );
    return duty.plan;
  }

  hideUnseen(sight: Sight, shadows: Sight, warming: boolean): void {
    for (const { crew, car } of this.duties) {
      if (!warming) {
        this.bounds.center.setFromMatrixPosition(crew.root.matrix);
        crew.root.visible =
          car >= 0 &&
          crew.out &&
          (sight.intersectsSphere(this.bounds) ||
            shadows.intersectsSphere(this.bounds));
      }
      if (crew.root.visible) crew.present();
    }
  }

  warm(): void {
    for (const { crew } of this.duties) crew.warm();
  }

  rest(): void {
    for (const { crew } of this.duties) crew.standDown();
  }

  posts(out: number[]): void {
    for (const { crew, car } of this.duties) if (car >= 0) crew.posts(out);
  }
}
