import * as THREE from "three/webgpu";
import {
  clamp,
  float,
  floor,
  fract,
  fwidth,
  max,
  min,
  mix,
  smoothstep,
  step,
  texture,
  time,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import { Mesh } from "./street-shell.ts";

export interface Sign {
  x: number;
  y: number;
  z: number;
  facing: number;
  width: number;
  height: number;
  lift: number;
  seed: number;
  wall?: boolean;
}

const tileWidth = 448;
const tileHeight = 252;
const tileAspect = tileWidth / tileHeight;
const columns = 4;
const rows = 4;
const gutter = 8;
const slideSeconds = 7;
const slideStride = 7;
const fade = 0.08;
const zoom = 0.12;
const drift = 0.4;
const shine = 1.5;
const standby = 0.4;
const bezel = 0.2;
const seam = 0.12;
const ledPitch = 0.05;
const ledGap = 0.3;
const ledGain = 1.9;
const casing = 0.02;
const boxDepth = 0.8;
const wallDepth = 0.6;
const post = 0.7;

export function slide(
  atlas: THREE.Texture,
  at: THREE.Node<"vec2">,
  index: THREE.Node<"float">,
): THREE.Node<"vec3"> {
  const cell = vec2(tileWidth + gutter * 2, tileHeight + gutter * 2);
  const corner = vec2(index.mod(columns), floor(index.div(columns)))
    .mul(cell)
    .add(gutter);
  const pixel = corner.add(
    vec2(at.x, float(1).sub(at.y)).mul(vec2(tileWidth, tileHeight)),
  );
  return texture(atlas, pixel.div(cell.mul(vec2(columns, rows)))).rgb;
}

function screenMaterial(
  atlas: THREE.Texture,
  glow: THREE.Node<"float">,
): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const seed = uv(1).x;
  const front = uv(1).y;
  const size = uv(2);
  const metres = uv();
  const panel = metres.div(size.max(0.01));
  const shape = size.x.div(size.y.max(0.01)).div(tileAspect);
  const crop = vec2(min(float(1), shape), min(float(1), float(1).div(shape)));
  const phase = time.div(slideSeconds).add(seed.mul(columns * rows));
  const slot = floor(phase);
  const progress = fract(phase);
  const count = columns * rows;
  const current = floor(seed.mul(97)).add(slot.mul(slideStride)).mod(count);
  const next = current.add(slideStride).mod(count);
  const sway = step(0.5, fract(seed.mul(7.3)))
    .mul(2)
    .sub(1);
  const view = (local: THREE.Node<"float">) => {
    const tight = float(1).sub(
      float(zoom)
        .mul(float(1).sub(local))
        .div(1 + fade),
    );
    const reach = crop.mul(tight);
    const pan = vec2(1).sub(reach).mul(local.sub(0.5).mul(drift).mul(sway));
    return panel.sub(0.5).mul(reach).add(0.5).add(pan);
  };
  const picture = mix(
    slide(atlas, view(progress), current),
    slide(atlas, view(progress.sub(1)), next),
    smoothstep(1 - fade, 1, progress),
  );
  const led = metres.div(ledPitch);
  const offset = fract(led).sub(0.5).abs();
  const lamp = smoothstep(0.5, 0.5 - ledGap, max(offset.x, offset.y));
  const close = clamp(
    float(1).sub(fwidth(led.x).add(fwidth(led.y)).mul(1.2)),
    0,
    1,
  );
  const dots = mix(float(1), lamp.mul(ledGain), close);
  const edge = smoothstep(0, bezel, metres.x)
    .mul(smoothstep(0, bezel, size.x.sub(metres.x)))
    .mul(smoothstep(0, seam, metres.y))
    .mul(smoothstep(0, seam, size.y.sub(metres.y)));
  material.colorNode = mix(
    vec3(casing),
    picture.mul(dots).mul(edge).mul(glow.mul(shine).add(standby)),
    front,
  );
  return material;
}

function addSign(mesh: Mesh, sign: Sign): void {
  const dx = Math.cos(sign.facing);
  const dz = -Math.sin(sign.facing);
  const half = sign.width / 2;
  const bottom = sign.y + sign.lift;
  const top = bottom + sign.height;
  const near = sign.wall ? 0 : boxDepth / 2;
  const far = sign.wall ? -wallDepth : -boxDepth / 2;
  const at = (a: number, b: number, y: number) => [
    sign.x + dz * a + dx * b,
    y,
    sign.z - dx * a + dz * b,
  ];
  const blank = (corners: number[][], n: number[]) => {
    mesh.quad(
      corners,
      n,
      [
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
      ],
      [sign.seed, 0],
      [1, 1],
    );
  };
  const shape = sign.width / sign.height / tileAspect;
  const across = Math.max(1, Math.round(shape));
  const stacked = Math.max(1, Math.round(1 / shape));
  const wide = sign.width / across;
  const tall = sign.height / stacked;
  for (let k = 0; k < across * stacked; k++) {
    const left = -half + (k % across) * wide;
    const low = bottom + Math.floor(k / across) * tall;
    mesh.quad(
      [
        at(left, near, low),
        at(left + wide, near, low),
        at(left + wide, near, low + tall),
        at(left, near, low + tall),
      ],
      [dx, 0, dz],
      [
        [0, 0],
        [wide, 0],
        [wide, tall],
        [0, tall],
      ],
      [(sign.seed + k * 0.371) % 1, 1],
      [wide, tall],
    );
  }
  blank(
    [
      at(half, far, bottom),
      at(-half, far, bottom),
      at(-half, far, top),
      at(half, far, top),
    ],
    [-dx, 0, -dz],
  );
  for (const side of [-1, 1])
    blank(
      [
        at(side * half, far, bottom),
        at(side * half, near, bottom),
        at(side * half, near, top),
        at(side * half, far, top),
      ],
      [dz * side, 0, -dx * side],
    );
  for (const [y, up] of [
    [bottom, -1],
    [top, 1],
  ] as const)
    blank(
      [
        at(-half, far, y),
        at(half, far, y),
        at(half, near, y),
        at(-half, near, y),
      ],
      [0, up, 0],
    );
  if (sign.wall) return;
  for (const [a0, b0, a1, b1, n] of [
    [-post, post, post, post, [dx, 0, dz]],
    [post, -post, -post, -post, [-dx, 0, -dz]],
    [post, post, post, -post, [dz, 0, -dx]],
    [-post, -post, -post, post, [-dz, 0, dx]],
  ] as [number, number, number, number, number[]][])
    blank(
      [
        at(a0, b0, sign.y),
        at(a1, b1, sign.y),
        at(a1, b1, bottom),
        at(a0, b0, bottom),
      ],
      n,
    );
}

export function signMesh(
  signs: Sign[],
  atlas: THREE.Texture,
  glow: THREE.Node<"float">,
): THREE.Mesh {
  const mesh = new Mesh();
  for (const sign of signs) addSign(mesh, sign);
  const result = new THREE.Mesh(mesh.geometry(), screenMaterial(atlas, glow));
  result.name = "city_signs";
  return result;
}
