import * as THREE from "three/webgpu";
import { surface } from "./road.ts";

export interface Step {
  place: number;
  x: number;
  height: number;
}

export const steps: Step[] = [
  { place: 1, x: 0, height: 1.1 },
  { place: 2, x: -2.3, height: 0.75 },
  { place: 3, x: 2.3, height: 0.5 },
];

const stepWidth = 2.2;
const stepDepth = 1.8;
const backdropWidth = 13;
const backdropHeight = 5.2;
const backdropGap = 1.4;
const baseSize: [number, number, number] = [9.4, 4.2, 0.16];
const charcoal = 0x1d1f27;
const gold = 0xd8a520;
const bottleGreen = 0x0f3d24;
const fontFamily = '"Saira Variable", "Saira", sans-serif';

function lit(
  name: string,
  params: THREE.MeshStandardMaterialParameters,
): THREE.Material {
  return surface(new THREE.MeshStandardMaterial({ name, ...params }), 8);
}

function canvasTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) draw(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function stepFace(place: number): THREE.CanvasTexture {
  return canvasTexture(512, 256, (ctx) => {
    ctx.fillStyle = "#1d1f27";
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = "#e10600";
    ctx.fillRect(0, 0, 512, 14);
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 170px ${fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(place), 256, 140);
  });
}

function backdropFace(event: string): THREE.CanvasTexture {
  return canvasTexture(2048, 820, (ctx) => {
    const glow = ctx.createLinearGradient(0, 0, 0, 820);
    glow.addColorStop(0, "#14151d");
    glow.addColorStop(1, "#262938");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 2048, 820);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.font = `700 64px ${fontFamily}`;
    for (let row = 0; row < 7; row++)
      for (let col = -1; col < 6; col++)
        ctx.fillText(
          "REVRACERS",
          col * 420 + (row % 2) * 210 + 120,
          row * 120 + 50,
        );
    ctx.fillStyle = "#e10600";
    ctx.fillRect(0, 300, 2048, 10);
    ctx.fillRect(0, 520, 2048, 10);
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 150px ${fontFamily}`;
    ctx.fillText("REVRACERS", 1024, 380);
    ctx.font = `600 64px ${fontFamily}`;
    ctx.fillText(event.toUpperCase(), 1024, 470);
  });
}

function trophy(material: THREE.Material, size: number): THREE.Group {
  const profile = [
    [0.0, 0],
    [0.09, 0],
    [0.09, 0.03],
    [0.03, 0.06],
    [0.025, 0.2],
    [0.06, 0.24],
    [0.13, 0.3],
    [0.15, 0.42],
    [0.14, 0.48],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const cup = new THREE.Mesh(new THREE.LatheGeometry(profile, 32), material);
  cup.rotation.x = Math.PI / 2;
  cup.castShadow = true;
  const group = new THREE.Group();
  group.add(cup);
  group.scale.setScalar(size);
  return group;
}

function bottle(): THREE.Group {
  const glass = lit("podium glass", {
    color: bottleGreen,
    roughness: 0.15,
    metalness: 0.2,
  });
  const foil = lit("podium foil", {
    color: gold,
    roughness: 0.35,
    metalness: 0.9,
  });
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.052, 0.052, 0.26, 18),
    glass,
  );
  const shoulder = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.052, 0.08, 18),
    glass,
  );
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.024, 0.1, 16),
    foil,
  );
  body.position.y = 0.13;
  shoulder.position.y = 0.3;
  neck.position.y = 0.39;
  for (const part of [body, shoulder, neck]) part.castShadow = true;
  const group = new THREE.Group();
  const inner = new THREE.Group();
  inner.rotation.x = Math.PI / 2;
  inner.add(body, shoulder, neck);
  group.add(inner);
  return group;
}

export interface Stage {
  root: THREE.Group;
  trophies: THREE.Group[];
  bottles: THREE.Group[];
  stands: [number, number, number][];
}

const stand = { ahead: 0.42, right: 0.42, height: 0.98 };
const standRadius = 0.11;
const barrierHeight = 1.05;

function trophyStand(dark: THREE.Material, metal: THREE.Material): THREE.Group {
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(
      standRadius * 0.7,
      standRadius,
      stand.height - 0.04,
      20,
    ),
    dark,
  );
  column.rotation.x = Math.PI / 2;
  column.position.z = (stand.height - 0.04) / 2;
  const plate = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, 0.04, 28),
    metal,
  );
  plate.rotation.x = Math.PI / 2;
  plate.position.z = stand.height - 0.02;
  const group = new THREE.Group();
  for (const part of [column, plate]) {
    part.castShadow = true;
    part.receiveShadow = true;
  }
  group.add(column, plate);
  return group;
}

function barrierFace(colour: string): THREE.CanvasTexture {
  return canvasTexture(1024, 160, (ctx) => {
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, 1024, 160);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(0, 128, 1024, 32);
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 92px ${fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("REVRACERS", 256, 70);
    ctx.fillText("REVRACERS", 768, 70);
  });
}

export function buildBarrier(
  colour: string,
  from: [number, number],
  to: [number, number],
): THREE.Group {
  const group = new THREE.Group();
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const post = lit("podium post", {
    color: 0xd8dade,
    roughness: 0.35,
    metalness: 0.8,
  });
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(length, barrierHeight * 0.62),
    lit("podium barrier", {
      map: barrierFace(colour),
      roughness: 0.7,
      side: THREE.DoubleSide,
    }),
  );
  panel.rotation.set(Math.PI / 2, 0, 0);
  panel.position.z = barrierHeight * 0.5;
  const rail = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, length, 10),
    post,
  );
  rail.rotation.z = Math.PI / 2;
  rail.position.z = barrierHeight;
  group.add(panel, rail);
  for (let k = 0; k <= Math.round(length / 1.25); k++) {
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, barrierHeight, 10),
      post,
    );
    leg.rotation.x = Math.PI / 2;
    leg.position.set(
      -length / 2 + (k * length) / Math.round(length / 1.25),
      0,
      barrierHeight / 2,
    );
    group.add(leg);
  }
  group.traverse((part) => {
    part.castShadow = true;
  });
  group.position.set((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, 0);
  group.rotation.z = Math.atan2(to[1] - from[1], to[0] - from[0]);
  return group;
}

export function buildStage(event: string): Stage {
  const root = new THREE.Group();
  const dark = lit("podium dark", {
    color: charcoal,
    roughness: 0.55,
  });
  const base = new THREE.Mesh(new THREE.BoxGeometry(...baseSize), dark);
  base.position.set(0, 0.5, baseSize[2] / 2);
  base.receiveShadow = true;
  root.add(base);
  for (const step of steps) {
    const face = lit("podium face", {
      map: stepFace(step.place),
      roughness: 0.5,
    });
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(stepWidth, stepDepth, step.height),
      [dark, dark, dark, face, dark, dark],
    );
    block.position.set(step.x, 0, baseSize[2] + step.height / 2);
    block.castShadow = true;
    block.receiveShadow = true;
    root.add(block);
  }
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(backdropWidth, backdropHeight),
    lit("podium backdrop", {
      map: backdropFace(event),
      roughness: 0.8,
      side: THREE.DoubleSide,
    }),
  );
  backdrop.rotation.x = Math.PI / 2;
  backdrop.position.set(0, stepDepth / 2 + backdropGap, backdropHeight / 2);
  backdrop.receiveShadow = true;
  root.add(backdrop);
  const metal = lit("podium gold", {
    color: gold,
    roughness: 0.28,
    metalness: 0.85,
  });
  const trophies = steps.map((step) =>
    trophy(metal, step.place === 1 ? 1.25 : 1),
  );
  const bottles = steps.map(() => bottle());
  const stands = steps.map((step): [number, number, number] => {
    const top = baseSize[2] + step.height;
    const holder = trophyStand(dark, metal);
    holder.position.set(step.x - stand.right, -stand.ahead, top);
    root.add(holder);
    return [step.x - stand.right, -stand.ahead, top + stand.height];
  });
  return { root, trophies, bottles, stands };
}
