import * as THREE from "three/webgpu";

const confettiCount = 700;
const sprayCount = 2600;
const gravity = 9.81;
const confettiFall = 1.1;
const confettiSway = 0.6;
const sprayLife = 1.1;
const sprayRate = 560;
const spraySpeed = 6.5;
const spraySpread = 0.1;
const streak = 0.32;
const alongZ = new THREE.Vector3(0, 0, 1);

interface Flake {
  position: THREE.Vector3;
  spin: THREE.Vector3;
  phase: number;
}

interface Drop {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  age: number;
}

export interface Nozzle {
  from: THREE.Vector3;
  direction: THREE.Vector3;
}

const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

export class Confetti {
  readonly mesh: THREE.InstancedMesh;
  private readonly flakes: Flake[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly turn = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private running = false;
  private time = 0;

  constructor(
    private readonly centre: THREE.Vector3,
    private area: [number, number],
    private readonly ceiling: number,
    colours: string[],
  ) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.07, 0.045),
      new THREE.MeshStandardNodeMaterial({
        side: THREE.DoubleSide,
        roughness: 0.4,
        metalness: 0.3,
      }),
      confettiCount,
    );
    this.mesh.frustumCulled = false;
    const colour = new THREE.Color();
    for (let i = 0; i < confettiCount; i++) {
      colour.set(colours[i % colours.length] ?? "#ffffff");
      this.mesh.setColorAt(i, colour);
      this.flakes.push({
        position: this.spawn(new THREE.Vector3(), Math.random()),
        spin: new THREE.Vector3(
          Math.random() * 6,
          Math.random() * 6,
          Math.random() * 6,
        ),
        phase: Math.random() * Math.PI * 2,
      });
      this.mesh.setMatrixAt(i, hidden);
    }
  }

  private spawn(target: THREE.Vector3, height: number): THREE.Vector3 {
    const [width, depth] = this.area;
    return target.set(
      this.centre.x + (Math.random() - 0.5) * width,
      this.centre.y + (Math.random() - 0.5) * depth,
      this.centre.z + this.ceiling * (0.6 + height * 0.6),
    );
  }

  start(): void {
    this.running = true;
  }

  over(centre: THREE.Vector3, area: [number, number]): void {
    if (centre.equals(this.centre)) return;
    this.centre.copy(centre);
    this.area = area;
    for (const flake of this.flakes) this.spawn(flake.position, Math.random());
  }

  update(dt: number): void {
    if (!this.running) return;
    this.time += dt;
    this.flakes.forEach((flake, i) => {
      const p = flake.position;
      p.z -= confettiFall * dt;
      p.x += Math.sin(this.time * 1.7 + flake.phase) * confettiSway * dt;
      p.y += Math.cos(this.time * 1.3 + flake.phase) * confettiSway * dt;
      if (p.z < this.centre.z) this.spawn(p, 0.2);
      this.euler.set(
        flake.spin.x * this.time,
        flake.spin.y * this.time,
        flake.spin.z * this.time,
      );
      this.turn.setFromEuler(this.euler);
      this.mesh.setMatrixAt(i, this.matrix.compose(p, this.turn, this.scale));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Champagne {
  readonly mesh: THREE.InstancedMesh;
  private readonly drops: Drop[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly size = new THREE.Vector3();
  private readonly turn = new THREE.Quaternion();
  private readonly heading = new THREE.Vector3();
  private next = 0;
  private owed = 0;

  constructor() {
    this.mesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.006, 1),
      new THREE.MeshStandardNodeMaterial({
        color: 0xfff6d8,
        roughness: 0.15,
        transparent: true,
        opacity: 0.5,
      }),
      sprayCount,
    );
    this.mesh.frustumCulled = false;
    for (let i = 0; i < sprayCount; i++) {
      this.drops.push({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        age: Infinity,
      });
      this.mesh.setMatrixAt(i, hidden);
    }
  }

  private emit(nozzle: Nozzle): void {
    const drop = this.drops[this.next];
    this.next = (this.next + 1) % sprayCount;
    if (!drop) return;
    drop.age = 0;
    drop.position.copy(nozzle.from);
    drop.velocity
      .set(
        nozzle.direction.x + (Math.random() - 0.5) * spraySpread * 2,
        nozzle.direction.y + (Math.random() - 0.5) * spraySpread * 2,
        nozzle.direction.z + (Math.random() - 0.5) * spraySpread * 2,
      )
      .normalize()
      .multiplyScalar(spraySpeed * (0.7 + Math.random() * 0.5));
  }

  update(dt: number, nozzles: Nozzle[]): void {
    this.owed += dt * sprayRate;
    while (this.owed >= 1) {
      this.owed -= 1;
      for (const nozzle of nozzles) this.emit(nozzle);
    }
    this.drops.forEach((drop, i) => {
      drop.age += dt;
      if (drop.age > sprayLife) {
        this.mesh.setMatrixAt(i, hidden);
        return;
      }
      drop.velocity.z -= gravity * dt;
      drop.velocity.multiplyScalar(1 - dt * 0.8);
      drop.position.addScaledVector(drop.velocity, dt);
      const grow = 1 + drop.age * 1.4;
      const speed = drop.velocity.length();
      this.heading.copy(drop.velocity).divideScalar(Math.max(speed, 1e-3));
      this.turn.setFromUnitVectors(alongZ, this.heading);
      this.size.set(grow, grow, grow * (1 + speed * streak));
      this.mesh.setMatrixAt(
        i,
        this.matrix.compose(drop.position, this.turn, this.size),
      );
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
