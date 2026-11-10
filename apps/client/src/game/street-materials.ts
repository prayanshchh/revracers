import * as THREE from "three/webgpu";
import {
  float,
  floor,
  fract,
  fwidth,
  length,
  max,
  mix,
  mod,
  select,
  sin,
  smoothstep,
  step,
  texture,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import { cityGlow } from "./street-city.ts";
import { crowdRowSpan } from "./street-venue.ts";

const seatWidth = 0.55;
const occupied = 0.88;
const garageDepth = 12;
const floorHeight = 3.6;
const mullion = 1.6;
const garageTop = 8.5;

function hash(p: THREE.Node<"vec2">): THREE.Node<"float"> {
  return fract(sin(p.dot(vec2(127.1, 311.7))).mul(43758.5453));
}

function pick(
  index: THREE.Node<"float">,
  colours: [number, number, number][],
): THREE.Node<"vec3"> {
  let result: THREE.Node<"vec3"> = vec3(...(colours[0] ?? [0, 0, 0]));
  colours.forEach((colour, i) => {
    if (i === 0) return;
    result = select(index.greaterThanEqual(i), vec3(...colour), result);
  });
  return result;
}

const shirts: [number, number, number][] = [
  [0.03, 0.03, 0.035],
  [0.04, 0.05, 0.12],
  [0.7, 0.7, 0.72],
  [0.45, 0.04, 0.04],
  [0.03, 0.03, 0.035],
  [0.08, 0.2, 0.45],
  [0.6, 0.38, 0.05],
  [0.12, 0.12, 0.13],
  [0.55, 0.08, 0.3],
  [0.05, 0.25, 0.12],
];
const skins: [number, number, number][] = [
  [0.55, 0.38, 0.28],
  [0.38, 0.24, 0.16],
  [0.2, 0.12, 0.08],
  [0.62, 0.46, 0.36],
];

export function crowdMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({
    side: THREE.DoubleSide,
  });
  const along = uv().x.div(seatWidth);
  const row = floor(uv().y.div(crowdRowSpan));
  const rise = mod(uv().y, crowdRowSpan).div(0.95);
  const seat = vec2(floor(along), row);
  const x = fract(along).sub(0.5);
  const jitter = hash(seat.add(3.3)).sub(0.5).mul(0.2);
  const present = step(hash(seat), occupied);
  const torso = smoothstep(0.36, 0.3, x.add(jitter).abs()).mul(
    smoothstep(0.72, 0.66, rise),
  );
  const head = smoothstep(
    0.15,
    0.11,
    length(vec2(x.add(jitter).mul(1.1), rise.sub(0.8))),
  );
  const shirt = pick(floor(hash(seat.add(7.1)).mul(shirts.length)), shirts);
  const skin = pick(floor(hash(seat.add(1.9)).mul(skins.length)), skins);
  const seatColour = vec3(0.05, 0.07, 0.14);
  const person = mix(shirt.mul(torso), skin, head);
  const body = torso.max(head).mul(present);
  const far = smoothstep(0.4, 1.2, max(fwidth(along), fwidth(rise.mul(2))));
  const average = mix(seatColour, vec3(0.16, 0.13, 0.13), occupied * 0.7);
  material.colorNode = mix(mix(seatColour, person, body), average, far);
  material.roughnessNode = float(0.9);
  material.emissiveNode = mix(mix(seatColour, person, body), average, far).mul(
    cityGlow.mul(0.35),
  );
  return material;
}

export function garageMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({
    side: THREE.DoubleSide,
  });
  const h = uv().y;
  const team = vec3(uv(1).x, uv(1).y, uv(2).x);
  const fascia = step(6.0, h).mul(step(h, 8.0));
  const trim = step(5.6, h).mul(step(h, 5.85));
  const panel = vec3(0.2, 0.21, 0.23);
  material.colorNode = mix(mix(panel, team, fascia), vec3(0.85), trim);
  material.roughnessNode = float(0.6);
  material.emissiveNode = team
    .mul(fascia)
    .mul(0.45)
    .add(vec3(0.9, 0.92, 0.95).mul(trim))
    .mul(cityGlow);
  return material;
}

function drawLimit(
  context: CanvasRenderingContext2D,
  x: number,
  ended: boolean,
): void {
  const centre = x + 128;
  context.fillStyle = "#f4f4f2";
  context.fillRect(x + 4, 4, 248, 248);
  context.beginPath();
  context.arc(centre, 128, 104, 0, Math.PI * 2);
  context.fillStyle = ended ? "#f4f4f2" : "#d81e1e";
  context.fill();
  context.beginPath();
  context.arc(centre, 128, ended ? 104 : 80, 0, Math.PI * 2);
  context.fillStyle = "#f4f4f2";
  context.fill();
  if (ended) {
    context.lineWidth = 6;
    context.strokeStyle = "#202020";
    context.stroke();
  }
  context.fillStyle = "#151515";
  context.font = "bold 92px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("80", centre, 134);
  if (!ended) return;
  context.lineWidth = 14;
  context.strokeStyle = "#202020";
  context.beginPath();
  context.moveTo(centre - 70, 198);
  context.lineTo(centre + 70, 58);
  context.stroke();
}

function signAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d context");
  drawLimit(context, 0, false);
  drawLimit(context, 256, true);
  context.fillStyle = "#1747c9";
  context.fillRect(516, 4, 248, 248);
  context.fillStyle = "#f4f4f2";
  context.font = "bold 96px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("PIT", 640, 96);
  context.lineWidth = 18;
  context.strokeStyle = "#f4f4f2";
  context.beginPath();
  context.moveTo(570, 200);
  context.lineTo(690, 200);
  context.lineTo(690, 160);
  context.stroke();
  const atlas = new THREE.CanvasTexture(canvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 8;
  return atlas;
}

export function pitSignMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial();
  const picture = texture(signAtlas(), uv()).rgb;
  material.colorNode = picture;
  material.roughnessNode = float(0.5);
  material.emissiveNode = picture.mul(cityGlow.mul(0.35));
  return material;
}

export function pitKitMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial();
  const colour = vec3(uv(1).x, uv(1).y, uv(2).x);
  material.colorNode = colour;
  material.roughnessNode = float(0.55);
  material.emissiveNode = colour.mul(uv(2).y).mul(cityGlow);
  return material;
}

export function garageInteriorMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial();
  const u = uv().x;
  const v = uv().y;
  const team = vec3(uv(1).x, uv(1).y, uv(2).x);
  const kind = uv(2).y;
  const band = step(1.5, v).mul(step(v, 3.6));
  const cabinets = step(v, 1.05);
  const seam = step(0.97, fract(u.div(2.4)));
  const white = vec3(0.86, 0.87, 0.89);
  const wall = mix(
    mix(white.mul(float(1).sub(seam.mul(0.25))), team, band),
    vec3(0.09, 0.1, 0.12).add(team.mul(0.08)),
    cabinets,
  );
  const lamp = smoothstep(0.12, 0.04, fract(u.div(2.0)).sub(0.5).abs()).mul(
    step(1.0, v).mul(step(v, garageDepth - 1.0)),
  );
  const ceiling = mix(vec3(0.12, 0.12, 0.13), vec3(1.0), lamp);
  const tile = step(0.985, fract(u.div(3))).max(step(0.985, fract(v.div(3))));
  const floorColour = mix(vec3(0.5, 0.51, 0.53), vec3(0.3, 0.31, 0.33), tile);
  const isBack = step(0.5, kind).mul(step(kind, 1.5));
  const isSide = step(1.5, kind).mul(step(kind, 2.5));
  const isCeiling = step(2.5, kind).mul(step(kind, 3.5));
  const isFloor = step(3.5, kind);
  const colour = wall
    .mul(isBack.add(isSide))
    .add(ceiling.mul(isCeiling))
    .add(floorColour.mul(isFloor));
  material.colorNode = colour;
  material.roughnessNode = mix(float(0.7), float(0.25), isFloor);
  material.emissiveNode = wall
    .mul(isBack.add(isSide).mul(0.55))
    .add(ceiling.mul(lamp).mul(isCeiling).mul(2.5))
    .add(floorColour.mul(isFloor).mul(0.4))
    .mul(cityGlow);
  return material;
}

export function hallMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({
    side: THREE.DoubleSide,
  });
  const s = uv().x;
  const h = uv().y;
  const level = fract(h.div(floorHeight));
  const pane = fract(s.div(mullion));
  const slab = smoothstep(0.86, 0.9, level);
  const frame = smoothstep(0.04, 0.0, pane)
    .add(smoothstep(0.96, 1.0, pane))
    .min(1);
  const floorIndex = floor(h.div(floorHeight));
  const room = floor(s.div(mullion * 6));
  const lit = step(hash(vec2(room, floorIndex)), 0.82);
  const glow = vec3(1.0, 0.88, 0.7)
    .mul(lit.mul(0.9).add(0.12))
    .mul(float(1).sub(slab))
    .mul(float(1).sub(frame.mul(0.8)));
  const top = step(garageTop - 0.1, h);
  const glass = mix(
    vec3(0.025, 0.03, 0.04),
    vec3(0.62, 0.63, 0.64),
    frame.mul(0.6),
  );
  const facade = mix(glass, vec3(0.78, 0.79, 0.8), slab);
  material.colorNode = mix(vec3(0.3, 0.31, 0.33), facade, top);
  material.roughnessNode = mix(
    float(0.6),
    mix(float(0.12), float(0.7), slab),
    top,
  );
  material.emissiveNode = glow
    .mul(top)
    .mul(0.55)
    .add(vec3(0.85, 0.86, 0.88).mul(slab.mul(top)).mul(0.12))
    .mul(cityGlow);
  return material;
}

export function lightStripMaterial(): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  material.colorNode = vec3(1, 0.97, 0.92).mul(cityGlow.mul(9).add(0.4));
  return material;
}
