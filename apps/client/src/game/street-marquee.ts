import * as THREE from "three/webgpu";
import { texture, uv, vec3 } from "three/tsl";
import { Mesh } from "./street-shell.ts";

export interface Marquee {
  x: number;
  y: number;
  z: number;
  facing: number;
  width: number;
  height: number;
  name: number;
}

type Rgb = [number, number, number];

interface Lettering {
  text: string;
  font: string;
  spacing: number;
  tint: Rgb;
}

const script = "italic 600 64px Georgia, 'Times New Roman', serif";
const classic = "500 60px Georgia, 'Times New Roman', serif";
const modern = "700 56px 'Helvetica Neue', Arial, sans-serif";
const white: Rgb = [1, 0.96, 0.88];
const gold: Rgb = [1, 0.78, 0.4];
const red: Rgb = [1, 0.16, 0.12];
const pink: Rgb = [1, 0.3, 0.6];
const ice: Rgb = [0.7, 0.86, 1];

const letterings: Lettering[] = [
  { text: "AURELIA", font: classic, spacing: 10, tint: white },
  { text: "Nocturne", font: script, spacing: 0, tint: gold },
  { text: "HALCYON", font: modern, spacing: 12, tint: ice },
  { text: "Zafiro", font: script, spacing: 0, tint: white },
  { text: "VELOCE", font: modern, spacing: 14, tint: red },
  { text: "SOLENNE", font: classic, spacing: 10, tint: gold },
  { text: "ORO ALTO", font: classic, spacing: 8, tint: gold },
  { text: "Corvina", font: script, spacing: 0, tint: pink },
  { text: "MIRAMONTE", font: classic, spacing: 6, tint: white },
  { text: "LUNARA", font: modern, spacing: 14, tint: ice },
  { text: "Bella Notte", font: script, spacing: 0, tint: white },
  { text: "CASA BRAVA", font: modern, spacing: 8, tint: red },
  { text: "ALTURA", font: modern, spacing: 16, tint: white },
  { text: "Carnelian", font: script, spacing: 0, tint: red },
  { text: "OPALINE", font: classic, spacing: 10, tint: ice },
  { text: "SUNDIAL", font: modern, spacing: 12, tint: gold },
  { text: "MONTE ALTO", font: classic, spacing: 6, tint: white },
  { text: "Desert Rose", font: script, spacing: 0, tint: pink },
  { text: "GOLDEN MILE", font: modern, spacing: 6, tint: gold },
  { text: "Silver Palm", font: script, spacing: 0, tint: ice },
  { text: "THE CITADEL", font: classic, spacing: 6, tint: white },
  { text: "VERMILION", font: modern, spacing: 10, tint: red },
  { text: "KESTREL GRAND", font: classic, spacing: 4, tint: gold },
  { text: "Neon Royale", font: script, spacing: 0, tint: pink },
];

const columns = 2;
const cellWidth = 512;
const cellHeight = 96;
const margin = 22;
const halo = 12;
const shine = 1.5;
const standby = 0.12;

function atlas(): THREE.CanvasTexture {
  const rows = Math.ceil(letterings.length / columns);
  const canvas = document.createElement("canvas");
  canvas.width = cellWidth * columns;
  canvas.height = cellHeight * rows;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d context");
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#ffffff";
  letterings.forEach((lettering, index) => {
    const x = (index % columns) * cellWidth + cellWidth / 2;
    const y = Math.floor(index / columns) * cellHeight + cellHeight / 2;
    context.font = lettering.font;
    context.letterSpacing = `${String(lettering.spacing)}px`;
    const fit = Math.min(
      1,
      (cellWidth - margin * 2) / context.measureText(lettering.text).width,
    );
    context.save();
    context.translate(x + (lettering.spacing * fit) / 2, y);
    context.scale(fit, fit);
    context.shadowColor = "rgba(255,255,255,0.85)";
    context.shadowBlur = halo;
    context.fillText(lettering.text, 0, 0);
    context.shadowBlur = 0;
    context.fillText(lettering.text, 0, 0);
    context.restore();
  });
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.NoColorSpace;
  map.anisotropy = 4;
  return map;
}

export function marqueeMesh(
  marquees: Marquee[],
  glow: THREE.Node<"float">,
): THREE.Mesh {
  const mesh = new Mesh();
  const rows = Math.ceil(letterings.length / columns);
  for (const sign of marquees) {
    const index = sign.name % letterings.length;
    const lettering = letterings[index];
    if (!lettering) continue;
    const dx = Math.cos(sign.facing);
    const dz = -Math.sin(sign.facing);
    const half = sign.width / 2;
    const corner = (a: number, b: number) => [
      sign.x + dz * a * half,
      sign.y + (b * sign.height) / 2,
      sign.z - dx * a * half,
    ];
    const left = (index % columns) / columns;
    const top = 1 - Math.floor(index / columns) / rows;
    const right = left + 1 / columns;
    const bottom = top - 1 / rows;
    const [r, g, b] = lettering.tint;
    mesh.quad(
      [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)],
      [dx, 0, dz],
      [
        [left, bottom],
        [right, bottom],
        [right, top],
        [left, top],
      ],
      [r, g],
      [b, 0],
    );
  }
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  const ink = texture(atlas(), uv()).a;
  material.colorNode = vec3(uv(1).x, uv(1).y, uv(2).x).mul(
    glow.mul(shine).add(standby),
  );
  material.opacityNode = ink;
  const result = new THREE.Mesh(mesh.geometry(), material);
  result.name = "city_marquees";
  result.renderOrder = 1;
  return result;
}
