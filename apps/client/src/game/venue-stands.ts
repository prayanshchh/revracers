import * as THREE from "three/webgpu";
import signsUrl from "../../../../content/tracks/hill-country/textures/stand-signs.webp?url";
import { releaseOnceUploaded } from "./preload.ts";
import { meshOf } from "./training-ground.ts";
import type { Part } from "./training-layout.ts";
import {
  bowlSeats,
  type Landmark,
  solidOutlines,
  type Stage,
} from "./venue-crowd.ts";

type Dress = (source: THREE.MeshStandardMaterial) => THREE.Material;
type Known = (part: Part, look: string) => THREE.Mesh;

export const standFiles = [signsUrl];

const landmarkFiles = import.meta.glob<Landmark[]>(
  "../../../../content/tracks/hill-country/landmarks.json",
  { eager: true, import: "default" },
);

const landmarks = Object.values(landmarkFiles).flat();

export const buildingOutlines = solidOutlines(landmarks);

const bowlRows = landmarks.filter(
  (landmark) => landmark.name === "amphitheatre seats",
);

export const amphitheatreSeats = bowlSeats(
  landmarks.filter((landmark) => landmark.rows),
);

export const stages: Stage[] = landmarks
  .filter((landmark) => landmark.name === "amphitheatre bowl")
  .map((bowl) => ({
    focus: bowlRows[0]?.focus ?? bowl.outline[0] ?? [0, 0],
    outline: bowl.outline,
  }));

const seatColours: Record<string, [number, number, number]> = {
  grey: [0.16, 0.17, 0.19],
  navy: [0.028, 0.04, 0.1],
  blue: [0.03, 0.09, 0.26],
  silver: [0.42, 0.43, 0.45],
};
const cladRed: [number, number, number] = [0.6, 0.06, 0.05];
const railGrey: [number, number, number] = [0.2, 0.205, 0.21];

function signs(anisotropy: number): THREE.Texture {
  const map = releaseOnceUploaded(new THREE.TextureLoader().load(signsUrl));
  map.flipY = false;
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.anisotropy = anisotropy;
  return map;
}

function plain(
  name: string,
  [r, g, b]: [number, number, number],
  roughness: number,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    name,
    color: new THREE.Color(r, g, b),
    roughness,
    metalness: 0,
  });
}

export function standMeshes(
  pieces: { part: Part; look: string }[],
  known: Known,
  look: { dress: Dress; anisotropy: number },
): THREE.Mesh[] {
  const made = new Map<string, THREE.Material>();
  const material = (key: string): THREE.Material => {
    const found = made.get(key);
    if (found) return found;
    const source =
      key === "sign"
        ? new THREE.MeshStandardMaterial({
            name: "track stand signs",
            map: signs(look.anisotropy),
            roughness: 0.75,
          })
        : key === "red"
          ? plain("track stand cladding", cladRed, 0.8)
          : key === "rail"
            ? plain("track stand rails", railGrey, 0.7)
            : plain(
                "track stand seats",
                seatColours[key.slice(5)] ?? seatColours["grey"] ?? cladRed,
                0.6,
              );
    const dressed = look.dress(source);
    made.set(key, dressed);
    return dressed;
  };
  return pieces.map(({ part, look: key }) => {
    if (!["sign", "red", "rail"].includes(key) && !key.startsWith("seat:"))
      return known(part, key);
    const mesh = meshOf(part, material(key));
    mesh.castShadow = true;
    return mesh;
  });
}
