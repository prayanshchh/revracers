import * as THREE from "three/webgpu";
import {
  float,
  floor,
  fract,
  mix,
  sin,
  smoothstep,
  step,
  texture,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import { floorHeight } from "./trackside-plan.ts";
import { cityGlow } from "./street-city.ts";
import { garageArt } from "./garage-art.ts";

const garageDepth = 12;
const mullion = 1.6;
const garageTop = 8.5;
const hallStrip = 1.6;
const hallRoom = 0.12;
const claddingWide = 1.4;
const claddingTall = 1.45;
const shutterSlat = 0.11;
const shutterPane = 1.25;
const boardDaylight = 0.12;
const lampPitch = 2.4;
const daylightLamps = 0.9;
const daylightWalls = 0.1;

function hash(p: THREE.Node<"vec2">): THREE.Node<"float"> {
  return fract(sin(p.dot(vec2(127.1, 311.7))).mul(43758.5453));
}

function kindOf(kind: THREE.Node<"float">, value: number): THREE.Node<"float"> {
  return step(value - 0.5, kind).mul(step(kind, value + 0.5));
}

function cladding(metres: THREE.Node<"vec2">): THREE.Node<"vec3"> {
  const across = metres.x.div(claddingWide);
  const up = metres.y.div(claddingTall);
  const joint = smoothstep(0.955, 0.975, fract(across)).max(
    smoothstep(0.955, 0.975, fract(up)),
  );
  const tone = hash(floor(vec2(across, up)))
    .mul(0.14)
    .add(0.93);
  return vec3(0.105, 0.11, 0.122)
    .mul(tone)
    .mul(float(1).sub(joint.mul(0.55)));
}

function shutter(metres: THREE.Node<"vec2">): THREE.Node<"vec3"> {
  const slat = fract(metres.y.div(shutterSlat));
  const pane = fract(metres.x.div(shutterPane));
  const glass = step(2.72, metres.y)
    .mul(step(metres.y, 3.22))
    .mul(step(0.12, pane))
    .mul(step(pane, 0.88));
  const rail = step(metres.y, 0.16);
  const steel = vec3(0.5, 0.52, 0.55).mul(float(1.07).sub(slat.mul(0.2)));
  return mix(
    mix(steel, vec3(0.045, 0.055, 0.07), glass),
    vec3(0.16, 0.17, 0.19),
    rail,
  );
}

export function garageMaterial(): THREE.MeshStandardNodeMaterial {
  const { boards } = garageArt();
  const material = new THREE.MeshStandardNodeMaterial({
    side: THREE.DoubleSide,
  });
  const metres = uv();
  const kind = uv(2).x;
  const picture = texture(boards, uv(1));
  const isCladding = kindOf(kind, 0);
  const isBoard = kindOf(kind, 1);
  const isBand = kindOf(kind, 2);
  const isNumber = kindOf(kind, 3);
  const isShutter = kindOf(kind, 4);
  const isTrim = kindOf(kind, 5);
  const isTeam = kindOf(kind, 6);
  const team = vec3(uv(1).x, uv(1).y, uv(2).y);
  const wall = cladding(metres);
  const ink = vec3(0.9, 0.91, 0.93);
  const number = mix(wall, ink, picture.a);
  const door = shutter(metres);
  const white = vec3(0.95, 0.96, 0.97);
  material.colorNode = wall
    .mul(isCladding)
    .add(picture.rgb.mul(isBoard.add(isBand)))
    .add(number.mul(isNumber))
    .add(door.mul(isShutter))
    .add(white.mul(isTrim))
    .add(team.mul(isTeam));
  material.roughnessNode = float(0.55)
    .mul(isCladding.add(isNumber))
    .add(float(0.3).mul(isBoard))
    .add(float(0.5).mul(isBand))
    .add(float(0.42).mul(isShutter))
    .add(float(0.3).mul(isTrim.add(isTeam)));
  material.metalnessNode = float(0.35).mul(isCladding.add(isShutter));
  material.emissiveNode = picture.rgb
    .mul(isBoard.mul(cityGlow.mul(1.1).add(boardDaylight)))
    .add(picture.rgb.mul(isBand).mul(cityGlow.mul(0.5)))
    .add(ink.mul(picture.a).mul(isNumber).mul(cityGlow.mul(0.45)))
    .add(white.mul(isTrim).mul(cityGlow.mul(1.4).add(0.3)))
    .add(team.mul(isTeam).mul(cityGlow.mul(1.2).add(0.25)))
    .add(door.mul(isShutter).mul(cityGlow.mul(0.18)))
    .add(wall.mul(isCladding).mul(cityGlow.mul(0.2)));
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
  canvas.width = 1024;
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
  context.fillStyle = "#1747c9";
  context.fillRect(772, 4, 248, 248);
  context.fillStyle = "#f4f4f2";
  context.fillText("PIT", 896, 96);
  context.beginPath();
  context.moveTo(820, 200);
  context.lineTo(930, 200);
  context.stroke();
  context.beginPath();
  context.moveTo(924, 170);
  context.lineTo(972, 200);
  context.lineTo(924, 230);
  context.closePath();
  context.fill();
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
  const { back } = garageArt();
  const material = new THREE.MeshStandardNodeMaterial();
  const u = uv().x;
  const v = uv().y;
  const kind = uv(2).y;
  const art = texture(back, uv()).rgb;
  const panelAcross = fract(u.div(lampPitch)).sub(0.5).abs();
  const panelDeep = fract(v.div(lampPitch)).sub(0.5).abs();
  const lamp = step(panelAcross, 0.16)
    .mul(step(panelDeep, 0.34))
    .mul(step(1.0, v).mul(step(v, garageDepth - 1.0)));
  const grid = step(0.97, fract(u.div(0.6))).max(step(0.97, fract(v.div(0.6))));
  const ceiling = mix(
    mix(vec3(0.5, 0.51, 0.53), vec3(0.36, 0.37, 0.39), grid),
    vec3(1.0),
    lamp,
  );
  const tile = step(0.985, fract(u.div(3))).max(step(0.985, fract(v.div(3))));
  const floorColour = mix(vec3(0.44, 0.45, 0.47), vec3(0.3, 0.31, 0.33), tile);
  const isBack = kindOf(kind, 1);
  const isCeiling = kindOf(kind, 3);
  const isFloor = step(3.5, kind);
  material.colorNode = art
    .mul(isBack)
    .add(ceiling.mul(isCeiling))
    .add(floorColour.mul(isFloor));
  material.roughnessNode = mix(float(0.62), float(0.22), isFloor);
  material.emissiveNode = art
    .mul(isBack.mul(0.42))
    .add(ceiling.mul(lamp).mul(isCeiling).mul(1.6))
    .add(ceiling.mul(isCeiling).mul(0.2))
    .add(floorColour.mul(isFloor).mul(0.16))
    .mul(cityGlow)
    .add(ceiling.mul(lamp).mul(isCeiling).mul(daylightLamps))
    .add(art.mul(isBack).mul(daylightWalls));
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
  const mood = hash(vec2(room, floorIndex)).mul(0.5).add(0.5);
  const strip = smoothstep(0.7, 0.74, level).mul(smoothstep(0.84, 0.8, level));
  const glow = vec3(1.0, 0.9, 0.76)
    .mul(strip.mul(hallStrip).add(hallRoom))
    .mul(mood)
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
