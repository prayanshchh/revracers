import * as THREE from "three/webgpu";
import dressing from "../../../../content/tracks/hill-country/dressing.json";
import structures from "../../../../content/tracks/hill-country/structures.json";
import screensUrl from "../../../../content/tracks/neon-boulevard/textures/screens.webp?url";
import wrapsUrl from "../../../../content/tracks/neon-boulevard/textures/wraps.webp?url";
import { crowdData, placedCrowd, riseShare, standingFrom } from "./crowd.ts";
import {
  emptyStand,
  type Ground,
  type StandLine,
  lineStandParts,
  lineStandSeats,
  standParts,
  standSeats,
} from "./grandstand.ts";
import {
  bankSpots,
  footprints,
  standDecks,
  standLine,
  aimed,
  standPieces,
  trackAim,
} from "./venue-crowd.ts";
import {
  amphitheatreSeats,
  buildingOutlines,
  stages,
  standFiles,
  standMeshes,
} from "./venue-stands.ts";
import { galvanisedSteel } from "./fence-steel.ts";
import { releaseOnceUploaded } from "./preload.ts";
import { meshOf } from "./training-ground.ts";
import { type Part, place, type Station } from "./training-layout.ts";
import { boardsFile, realBoards, standBoard } from "./trackside-boards.ts";
import { structureParts } from "./venue-gantry.ts";
import { armcoParts, billboardParts, hoardingParts } from "./venue-barriers.ts";
import { float } from "three/tsl";
import { type Sign, signMesh } from "./street-screens.ts";
import { boardNameAt } from "./trackside-plan.ts";
import {
  type Height,
  heightField,
  inSector,
  inZone,
  locate,
  markerParts,
  rebranded,
  rewrapped,
  strippedBaked,
  venueProps,
  without,
} from "./trackside-props.ts";

type Dress = (source: THREE.MeshStandardMaterial) => THREE.Material;
type Solid = THREE.Mesh;

export interface Frames {
  list: Station[];
  length: number;
}

interface People {
  seated: number[];
  standing: number[];
  fans: number[];
}

export const venueFiles = [wrapsUrl, screensUrl, boardsFile, ...standFiles];

const boardMeshes = /^wall_(boards|tecpro)$/;
const bannerMeshes = /^(paddock_banner|pit_strip)$/;
const lampMeshes = /^start_lamps$/;
const distanceShape = { wide: 1.5, tall: 0.75, out: 4.2 };
const lampLift = 0.9;
const blockMesh = "wall_tecpro";
const blockTile = 3;
const boardTile = 8;
const fenceMeshes = /^(debris_fence|fence_steel)$/;
const steelMesh = /^fence_steel$/;
const wallMeshes = /^wall_(boards|tecpro|concrete)$/;
const screenGlow = 0.35;
const screenTurn = 0.45;
const groundMeshes = /^(terrain|verges)$/;
const fallbackBoard = "revracers";
const wheelMeshes = /^prop_(hut|marquee)$/;
const crowdStride = 8;

function sources(
  map: THREE.Texture,
  real: THREE.Texture,
): Record<string, THREE.MeshStandardMaterial> {
  const plain = (
    name: string,
    tone: number,
    roughness: number,
    metalness = 0,
  ) =>
    new THREE.MeshStandardMaterial({
      name,
      color: new THREE.Color(tone, tone * 1.01, tone * 1.04),
      roughness,
      metalness,
    });
  return {
    boards: new THREE.MeshStandardMaterial({
      name: "track wall boards",
      map,
      roughness: 0.6,
    }),
    real: new THREE.MeshStandardMaterial({
      name: "track real boards",
      map: real,
      roughness: 0.62,
    }),
    steel: plain("track gantry steel", 0.5, 0.45, 0.5),
    deck: plain("track venue concrete", 0.55, 0.9),
    seats: plain("track stand deck", 0.3, 0.85),
    aisle: plain("track stand aisle", 0.58, 0.8),
    skirt: plain("track stand skirt", 0.05, 0.92),
    frame: plain("track stand frame", 0.42, 0.5, 0.4),
    roof: plain("track stand canopy", 0.8, 0.5, 0.2),
    crane: new THREE.MeshStandardMaterial({
      name: "track prop crane",
      color: new THREE.Color(0.78, 0.55, 0.05),
      roughness: 0.45,
      metalness: 0.3,
    }),
    dark: plain("track prop dark", 0.03, 0.6),
  };
}

function cast(part: Part, material: THREE.Material): THREE.Mesh {
  const mesh = meshOf(part, material);
  mesh.castShadow = true;
  return mesh;
}

function moved(
  geometry: THREE.BufferGeometry,
  from: number[],
  to: number[],
  shape: { reach: number; scale: number; turn: number },
): void {
  const position = geometry.getAttribute("position");
  const [fx = 0, fy = 0, fz = 0] = from;
  const [tx = 0, ty = 0, tz = 0] = to;
  const cos = Math.cos(shape.turn) * shape.scale;
  const sin = Math.sin(shape.turn) * shape.scale;
  for (let i = 0; i < position.count; i++) {
    const dx = position.getX(i) - fx;
    const dz = position.getZ(i) - fz;
    if (Math.hypot(dx, dz) > shape.reach) continue;
    position.setXYZ(
      i,
      tx + dx * cos - dz * sin,
      ty + (position.getY(i) - fy) * shape.scale,
      tz + dx * sin + dz * cos,
    );
  }
  position.needsUpdate = true;
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
}

function meshesOf(scene: THREE.Object3D, names: RegExp): Solid[] {
  const found: Solid[] = [];
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh && names.test(object.name))
      found.push(object as Solid);
  });
  return found;
}

function grounded(point: number[], ground: Height, fallback: number): number[] {
  const [x = 0, , z = 0] = point;
  return [x, ground(x, z) ?? fallback, z];
}

function movedWheel(
  scene: THREE.Object3D,
  frames: Frames,
  ground: Height,
): void {
  const { from, to, reach, scale, turn } = dressing.wheel;
  const [s = 0, lateral = 0] = from;
  const [tx = 0, tz = 0] = to;
  const station = frames.list.find((item) => item.s >= s);
  if (!station) return;
  const start = grounded(place(station, lateral, 0), ground, station.y);
  const end = grounded([tx, 0, tz], ground, station.y);
  for (const mesh of meshesOf(scene, wheelMeshes))
    moved(mesh.geometry, start, end, { reach, scale, turn });
}

function texture(url: string, anisotropy: number): THREE.Texture {
  const map = releaseOnceUploaded(new THREE.TextureLoader().load(url));
  map.flipY = false;
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.anisotropy = anisotropy;
  return map;
}

function turnOf(screen: object): number {
  return "turn" in screen && typeof screen.turn === "number"
    ? screen.turn
    : screenTurn;
}

function screenSigns(frames: Frames, ground: Height): Sign[] {
  return dressing.screens.map((screen) => {
    const station = locateAt(frames, screen.at) ?? frames.list[0];
    if (!station) throw new Error("track has no stations");
    const [x = 0, , z = 0] = place(station, screen.side * screen.lateral, 0);
    const inward = [-screen.side * station.lx, -screen.side * station.lz];
    const back = [station.lz, -station.lx];
    const turn = turnOf(screen);
    const nx = (inward[0] ?? 0) + (back[0] ?? 0) * turn;
    const nz = (inward[1] ?? 0) + (back[1] ?? 0) * turn;
    return {
      x,
      y: ground(x, z) ?? station.y,
      z,
      facing: Math.atan2(-nz, nx),
      width: screen.wide,
      height: screen.tall,
      lift: screen.lift,
      seed: screen.seed,
    };
  });
}

function locateAt(frames: Frames, s: number): Station | undefined {
  return frames.list.find((item) => item.s >= s);
}

function boardFor(frames: Frames, x: number, z: number): string {
  const found = locate(frames.list, x, z);
  return found
    ? standBoard(boardNameAt(dressing.boards, found.station.s, found.lateral))
    : fallbackBoard;
}

function standLines(frames: Frames): StandLine[] {
  const cleared = (x: number, z: number) =>
    inZone(dressing.clear, frames.list, frames.length, x, z);
  const board = (x: number, z: number) => boardFor(frames, x, z);
  return structures.stands.flatMap(
    (stand) => standLine(stand, cleared, board) ?? [],
  );
}

type Cast = (part: Part, source: string) => THREE.Mesh;

function props(
  frames: Frames,
  height: Height,
  mesh: Cast,
): { meshes: THREE.Mesh[]; parts: Part[]; marshals: number[] } {
  const { parts, marshals } = venueProps(
    frames.list,
    frames.length,
    dressing,
    height,
  );
  return {
    meshes: parts.map(({ part, look }) => mesh(part, look)),
    parts: parts.map(({ part }) => part),
    marshals,
  };
}

export function dressVenue(
  scene: THREE.Object3D,
  frames: Frames,
  look: { dress: Dress; anisotropy: number },
): void {
  const { list, length } = frames;
  const made = sources(
    texture(wrapsUrl, look.anisotropy),
    texture(boardsFile, look.anisotropy),
  );
  const dressed = new Map<string, THREE.Material>();
  const material = (key: string) => {
    const known = dressed.get(key);
    if (known) return known;
    const fresh = look.dress(made[key] as THREE.MeshStandardMaterial);
    dressed.set(key, fresh);
    return fresh;
  };
  const mesh = (part: Part, source: string) => cast(part, material(source));
  const height = heightField(meshesOf(scene, groundMeshes));
  const ground: Ground = (station, lateral) => {
    const [x = 0, , z = 0] = place(station, lateral, 0);
    return height(x, z) ?? station.y;
  };
  const lines = standLines(frames);
  for (const object of meshesOf(scene, boardMeshes)) {
    rebranded(
      object.geometry,
      list,
      dressing.boards,
      object.name === blockMesh ? blockTile / boardTile : 1,
      realBoards,
    );
    object.material = material("real");
  }
  for (const object of meshesOf(scene, lampMeshes))
    object.geometry.translate(0, lampLift, 0);
  for (const object of meshesOf(scene, bannerMeshes)) {
    rewrapped(object.geometry);
    object.material = material("boards");
  }
  const open = (x: number, z: number) =>
    inSector(dressing.fenceless, list, length, x, z);
  for (const object of meshesOf(scene, fenceMeshes))
    without(object.geometry, open);
  for (const object of meshesOf(scene, steelMesh))
    for (const each of [object.material].flat()) galvanisedSteel(each);
  const railed = (x: number, z: number) =>
    inSector(dressing.armco, list, length, x, z);
  for (const object of meshesOf(scene, wallMeshes))
    without(object.geometry, railed);
  const armco = armcoParts(list, length, dressing.armco, height);
  const signs = billboardParts(
    list,
    length,
    dressing.billboards,
    height,
    realBoards,
  );
  const hoardings = hoardingParts(
    list,
    length,
    dressing.hoardings,
    height,
    realBoards,
  );
  const markers = markerParts(
    list,
    length,
    dressing.markers,
    height,
    realBoards.row("distance"),
    realBoards,
    distanceShape,
  );
  movedWheel(scene, frames, height);
  strippedBaked(scene, height);
  const built = structureParts(list, length, dressing.gantries, height);
  const placed = props(frames, height, mesh);
  const stands = emptyStand();
  standParts(list, length, dressing.stands, stands, ground);
  lineStandParts(lines, stands);
  const pieces = standPieces(stands);
  const screens = signMesh(
    screenSigns(frames, height),
    texture(screensUrl, look.anisotropy),
    float(screenGlow),
  );
  screens.name = "venue_screens";
  scene.add(
    mesh(built.steel.part("banner steel", "track gantry steel"), "steel"),
    mesh(built.faces.part("banner faces", "track real boards"), "real"),
    mesh(
      built.concrete.part("banner concrete", "track venue concrete"),
      "deck",
    ),
    mesh(built.dark.part("banner dark", "track prop dark"), "dark"),
    mesh(markers.faces.part("marker boards", "track real boards"), "real"),
    mesh(armco.rails.part("armco rails", "track gantry steel"), "steel"),
    mesh(armco.posts.part("armco posts", "track gantry steel"), "steel"),
    mesh(hoardings.faces.part("hoarding faces", "track real boards"), "real"),
    mesh(hoardings.frame.part("hoarding frame", "track prop dark"), "dark"),
    mesh(signs.faces.part("billboard faces", "track real boards"), "real"),
    mesh(signs.frame.part("billboard frame", "track prop dark"), "dark"),
    mesh(markers.posts.part("marker posts", "track stand frame"), "frame"),
    ...placed.meshes,
    screens,
    ...standMeshes(pieces, mesh, look),
  );
  const blocked = footprints(
    [...pieces.map(({ part }) => part), ...placed.parts],
    height,
    buildingOutlines,
    standDecks(pieces),
  );
  const people: People = {
    seated: [
      ...standSeats(list, length, dressing.stands, ground),
      ...lineStandSeats(lines),
    ],
    standing: placed.marshals,
    fans: bankSpots(list, length, dressing.banks, height, blocked),
  };
  scene.userData["people"] = people;
  scene.userData["frames"] = frames;
}

function keptCrowd(known: Float32Array, frames: Frames): number[] {
  const kept: number[] = [];
  for (let i = 0; i < known.length; i += crowdStride) {
    const row = known.subarray(i, i + crowdStride);
    const x = Number(row[0]);
    const z = -Number(row[1]);
    if (Number(row[4]) < standingFrom) continue;
    if (inZone(dressing.clear, frames.list, frames.length, x, z)) continue;
    kept.push(...row);
  }
  return kept;
}

export async function venuePeople(
  road: Promise<THREE.Object3D>,
): Promise<Float32Array> {
  const [scene, buffer] = await Promise.all([
    road,
    fetch(crowdData).then((response) => response.arrayBuffer()),
  ]);
  const known = new Float32Array(buffer);
  const people = scene.userData["people"] as People | undefined;
  const frames = scene.userData["frames"] as Frames | undefined;
  if (!people || !frames) return known;
  const kept = keptCrowd(known, frames);
  const added = placedCrowd(
    people.standing,
    [...people.seated, ...amphitheatreSeats],
    people.fans,
    standingFrom,
    riseShare,
  );
  const all = new Float32Array(kept.length + added.length);
  all.set(kept);
  all.set(added, kept.length);
  aimed(all, trackAim(frames.list, stages));
  return all;
}

export async function clearedTrees(
  url: string,
  framesLoad: Promise<Frames>,
  stride: number,
): Promise<Float32Array> {
  const [frames, buffer] = await Promise.all([
    framesLoad,
    fetch(url).then((response) => response.arrayBuffer()),
  ]);
  const known = new Float32Array(buffer);
  const plots = dressing.clear.filter((zone) => zone.trees);
  const kept: number[] = [];
  for (let i = 0; i < known.length; i += stride) {
    const x = known[i] ?? 0;
    const z = -(known[i + 1] ?? 0);
    if (inZone(plots, frames.list, frames.length, x, z)) continue;
    for (let k = 0; k < stride; k++) kept.push(known[i + k] ?? 0);
  }
  return new Float32Array(kept);
}
