import * as THREE from "three/webgpu";
import dressing from "../../../../content/tracks/hill-country/dressing.json";
import structures from "../../../../content/tracks/hill-country/structures.json";
import screensUrl from "../../../../content/tracks/neon-boulevard/textures/screens.webp?url";
import wrapsUrl from "../../../../content/tracks/neon-boulevard/textures/wraps.webp?url";
import { crowdData, placedCrowd } from "./crowd.ts";
import {
  emptyStand,
  type Ground,
  type StandLine,
  lineStandParts,
  lineStandSeats,
  standParts,
  standSeats,
} from "./grandstand.ts";
import { releaseOnceUploaded } from "./preload.ts";
import { meshOf } from "./training-ground.ts";
import { type Part, place, type Station } from "./training-layout.ts";
import { gantryParts } from "./trackside-gantry.ts";
import { float } from "three/tsl";
import { type Sign, signMesh } from "./street-screens.ts";
import { boardNameAt, boardRow } from "./trackside-plan.ts";
import {
  bankSpots,
  craneParts,
  type Height,
  heightField,
  carPark,
  inSector,
  inZone,
  locate,
  type Marker,
  markerParts,
  postParts,
  pylonParts,
  rebranded,
  tentRows,
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
}

const boardMeshes = /^wall_(boards|tecpro)$/;
const blockMesh = "wall_tecpro";
const blockTile = 3;
const boardTile = 8;
const replaced = /^(billboard_|prop_crane|stand_|columns$|roofs$|distance_)/;
const fenceMeshes = /^(debris_fence|fence_steel)$/;
const markerMesh = /^distance_boards$/;
const markerSteps = [150, 100, 50];
const markerRoom = 160;
const screenGlow = 0.35;
const screenTurn = 0.45;
const groundMeshes = /^(terrain|verges)$/;
const seatedSprites = 32;
const fallbackBoard = "revracers";
const wheelMeshes = /^prop_(hut|marquee)$/;
const crowdStride = 8;

function sources(
  map: THREE.Texture,
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

function markersOf(scene: THREE.Object3D, frames: Frames): Marker[] {
  const markers: Marker[] = [];
  for (const mesh of meshesOf(scene, markerMesh)) {
    const position = mesh.geometry.getAttribute("position");
    const uv = mesh.geometry.getAttribute("uv");
    for (let first = 0; first + 3 < position.count; first += 4) {
      const corners = [first, first + 1, first + 2, first + 3];
      const mean = (pick: (i: number) => number) =>
        corners.reduce((sum, i) => sum + pick(i), 0) / 4;
      const found = locate(
        frames.list,
        mean((i) => position.getX(i)),
        mean((i) => position.getZ(i)),
      );
      const metres = markerSteps[Math.floor(mean((i) => uv.getY(i)) * 3)];
      if (!found || metres === undefined) continue;
      markers.push({
        at: found.station.s + metres,
        side: Math.sign(found.lateral) || 1,
        metres,
      });
    }
  }
  return markers;
}

function screenSigns(frames: Frames, ground: Height): Sign[] {
  return dressing.screens.map((screen) => {
    const station = locateAt(frames, screen.at) ?? frames.list[0];
    if (!station) throw new Error("track has no stations");
    const [x = 0, , z = 0] = place(station, screen.side * screen.lateral, 0);
    const inward = [-screen.side * station.lx, -screen.side * station.lz];
    const back = [station.lz, -station.lx];
    const nx = (inward[0] ?? 0) + (back[0] ?? 0) * screenTurn;
    const nz = (inward[1] ?? 0) + (back[1] ?? 0) * screenTurn;
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
    ? boardNameAt(dressing.boards, found.station.s, found.lateral)
    : fallbackBoard;
}

function standLine(
  stand: (typeof structures.stands)[number],
  frames: Frames,
): StandLine | null {
  const [first, last] = stand.front.map((point) => [
    Number(point[0]),
    -Number(point[1]),
  ]);
  if (!first || !last) return null;
  const x = (Number(first[0]) + Number(last[0])) / 2;
  const z = (Number(first[1]) + Number(last[1])) / 2;
  if (inZone(dressing.clear, frames.list, frames.length, x, z)) return null;
  const run = [
    Number(last[0]) - Number(first[0]),
    Number(last[1]) - Number(first[1]),
  ];
  const flipped =
    -Number(run[1]) * Number(stand.back[0]) -
      Number(run[0]) * Number(stand.back[1]) <
    0;
  return {
    from: flipped ? last : first,
    to: flipped ? first : last,
    depth: stand.depth,
    base: stand.base,
    roof: stand.roof,
    board: boardFor(frames, x, z),
  };
}

function standLines(frames: Frames): StandLine[] {
  return structures.stands.flatMap((stand) => standLine(stand, frames) ?? []);
}

function addedStands(
  frames: Frames,
  ground: Ground,
  lines: StandLine[],
  mesh: (part: Part, source: string) => THREE.Mesh,
): THREE.Mesh[] {
  const built = emptyStand();
  standParts(frames.list, frames.length, dressing.stands, built, ground);
  lineStandParts(lines, built);
  return [
    mesh(built.deck.part("stand deck", "track stand deck"), "seats"),
    mesh(built.aisle.part("stand aisles", "track stand aisle"), "aisle"),
    mesh(built.skirt.part("stand skirt", "track stand skirt"), "skirt"),
    mesh(built.banner.part("stand banner", "track wall boards"), "boards"),
    mesh(built.frame.part("stand scaffold", "track stand frame"), "frame"),
    mesh(built.roof.part("stand canopy", "track stand canopy"), "roof"),
  ];
}

type Cast = (part: Part, source: string) => THREE.Mesh;

function props(
  frames: Frames,
  height: Height,
  mesh: Cast,
): { meshes: THREE.Mesh[]; marshals: number[] } {
  const { list, length } = frames;
  const cars = carPark(list, length, dressing.lots, height);
  const tents = tentRows(list, length, dressing.tents, height);
  const pylons = pylonParts(dressing.pylons, height);
  const posts = postParts(list, length, dressing.posts, height);
  const cranes = craneParts(list, length, dressing.cranes, height);
  const meshes = [
    mesh(cranes.body.part("crane body", "track prop crane"), "crane"),
    mesh(cranes.dark.part("crane dark", "track prop dark"), "dark"),
    ...cars.paint.map((paint, k) =>
      mesh(
        paint.part("parked cars", "track stand canopy"),
        ["roof", "frame", "dark"][k] ?? "roof",
      ),
    ),
    mesh(cars.glass.part("parked glass", "track prop dark"), "dark"),
    mesh(tents.cloth.part("tent cloth", "track stand canopy"), "roof"),
    mesh(tents.band.part("tent band", "track stand skirt"), "skirt"),
    mesh(pylons.body.part("pylon body", "track prop dark"), "dark"),
    mesh(pylons.lamps.part("pylon lamps", "track stand canopy"), "roof"),
    mesh(posts.dark.part("marshal posts", "track prop dark"), "dark"),
    mesh(posts.plate.part("marshal plates", "track stand canopy"), "roof"),
  ];
  return { meshes, marshals: posts.marshals };
}

export function dressVenue(
  scene: THREE.Object3D,
  frames: Frames,
  look: { dress: Dress; anisotropy: number },
): void {
  const { list, length } = frames;
  const made = sources(texture(wrapsUrl, look.anisotropy));
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
    );
    object.material = material("boards");
  }
  const open = (x: number, z: number) =>
    inSector(dressing.fenceless, list, length, x, z);
  for (const object of meshesOf(scene, fenceMeshes))
    without(object.geometry, open);
  const markers = markerParts(
    list,
    length,
    [
      ...dressing.markers,
      ...markersOf(scene, frames).filter((found) =>
        dressing.markers.every(
          (marker) => Math.abs(marker.at - found.at) > markerRoom,
        ),
      ),
    ],
    height,
    boardRow("distance"),
  );
  movedWheel(scene, frames, height);
  for (const object of meshesOf(scene, replaced)) object.removeFromParent();
  const built = gantryParts(list, length, dressing.gantries);
  const placed = props(frames, height, mesh);
  const screens = signMesh(
    screenSigns(frames, height),
    texture(screensUrl, look.anisotropy),
    float(screenGlow),
  );
  screens.name = "venue_screens";
  scene.add(
    mesh(built.steel.part("banner steel", "track gantry steel"), "steel"),
    mesh(built.faces.part("banner faces", "track wall boards"), "boards"),
    mesh(built.deck.part("banner deck", "track venue concrete"), "deck"),
    mesh(markers.faces.part("marker boards", "track wall boards"), "boards"),
    mesh(markers.posts.part("marker posts", "track stand frame"), "frame"),
    ...placed.meshes,
    screens,
    ...addedStands(frames, ground, lines, mesh),
  );
  const people: People = {
    seated: [
      ...standSeats(list, length, dressing.stands, ground),
      ...lineStandSeats(lines),
    ],
    standing: [
      ...bankSpots(list, length, dressing.banks, height),
      ...placed.marshals,
    ],
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
    if (Number(row[4]) < seatedSprites) continue;
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
  const added = placedCrowd(people.standing, people.seated);
  const all = new Float32Array(kept.length + added.length);
  all.set(kept);
  all.set(added, kept.length);
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
