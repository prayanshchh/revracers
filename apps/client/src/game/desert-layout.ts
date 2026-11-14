import type { DesertLandmarks } from "./desert-landmarks.ts";
import { lampGains, type LampSpot } from "./desert-lamps.ts";
import { buildingParts, type Footprint } from "./desert-buildings.ts";
import {
  Builder,
  closedRows,
  edgeLines,
  gantry,
  kerbs,
  lamps,
  type LinePath,
  markings,
  type Part,
  place,
  road,
  type Station,
  stationAt,
  stations,
  up,
  wrap,
} from "./training-layout.ts";
import {
  barrierBody,
  barrierFaces,
  fenceMesh,
  fencePosts,
  pitMarkings,
  pitSign,
  spanRows,
  type StreetTrack,
  wallAt,
  wallRuns,
} from "./street-layout.ts";
import {
  type CrewSpot,
  crewSpots,
  type GarageCar,
  garageCars,
} from "./street-pit.ts";
import { type Venue, venueParts } from "./street-venue.ts";
import { type LaneEdges, laneEdges, pitLaneParts } from "./desert-pitlane.ts";
import { type ServiceCluster, serviceParts } from "./desert-service.ts";
import { type Lot, lotParts } from "./desert-lots.ts";
import { type Lawn, pavingParts, type Road } from "./desert-paving.ts";
import { gantryParts } from "./trackside-gantry.ts";
import { type BoardSpan, boardRow, type GantrySpec } from "./trackside-plan.ts";
import {
  type CraneSpec,
  craneParts,
  type Marker,
  markerParts,
  type Post,
  postParts,
  type TentRow,
  tentRows,
} from "./trackside-props.ts";

export interface DesertVenue extends Venue {
  buildings: Footprint[];
  boards: BoardSpan[];
  gantries: GantrySpec[];
  markers: Marker[];
  posts: Post[];
  cranes: CraneSpec[];
  tents: TentRow[];
  landmarks?: DesertLandmarks;
  service?: ServiceCluster[];
  lots?: Lot[];
  roads?: Road[];
  lawns?: Lawn[];
}

const flat = (): number | null => null;

function props(list: Station[], length: number, venue: DesertVenue): Part[] {
  const markers = markerParts(
    list,
    length,
    venue.markers,
    flat,
    boardRow("distance"),
  );
  const posts = postParts(list, length, venue.posts, flat);
  const cranes = craneParts(list, length, venue.cranes, flat);
  const tents = tentRows(list, length, venue.tents, flat);
  return [
    markers.faces.part("marker boards", "track wall wraps"),
    markers.posts.part("marker posts", "track pole steel"),
    posts.dark.part("marshal posts", "track prop dark"),
    posts.plate.part("marshal plates", "track stand canopy"),
    cranes.body.part("crane body", "track prop crane"),
    cranes.dark.part("crane dark", "track prop dark"),
    tents.cloth.part("tent cloth", "track stand canopy"),
    tents.band.part("tent band", "track stand skirt"),
  ];
}

const vergeColumns = 6;
const vergeBeyond = 6;
const sandTile = 3;
const apronLift = -0.003;
const terrainRadius = 6000;
const paddockMargin = 12;
const paddockBehind = 10;
const paddockLift = 0.006;
const pitLightEvery = 7;
const pitLightHeight = 8;
const pitLightReach = 26;
const terrainRings = 30;
const terrainSpokes = 120;
const terrainDrop = 0.06;

function vergeStrip(
  builder: Builder,
  rows: Station[],
  sign: number,
  span: (station: Station) => [number, number],
): void {
  const first = builder.count;
  for (const station of rows) {
    const [edge, wall] = span(station);
    const columns = Array.from(
      { length: vergeColumns },
      (_, k) => edge + ((wall - edge) * k) / (vergeColumns - 1),
    );
    const ordered = sign > 0 ? columns : [...columns].reverse();
    for (const distance of ordered) {
      const lateral = sign * distance;
      const p = place(station, lateral, apronLift);
      builder.vertex(p, up, [
        [(p[0] ?? 0) / sandTile, (p[2] ?? 0) / sandTile],
        [lateral, station.s],
      ]);
    }
  }
  builder.grid(rows.length, vergeColumns, first);
}

function verge(list: Station[], track: StreetTrack, edges: LaneEdges): Part {
  const builder = new Builder(2);
  const rows = closedRows(list, track.length);
  const pit = pitSign(track);
  for (const sign of [1, -1]) {
    const reach = (station: Station) => wallAt(station, sign) + vergeBeyond;
    const kerbside = (station: Station) => station.half + track.runoff;
    if (sign !== pit) {
      vergeStrip(builder, rows, sign, (station) => [
        kerbside(station),
        reach(station),
      ]);
      continue;
    }
    vergeStrip(builder, rows, sign, (station) => {
      const cut = edges(station.s);
      return [
        kerbside(station),
        cut ? Math.max(kerbside(station), cut[0]) : reach(station),
      ];
    });
    vergeStrip(builder, rows, sign, (station) => {
      const cut = edges(station.s);
      const far = reach(station);
      return cut ? [Math.min(cut[1], far), Math.max(cut[1], far)] : [far, far];
    });
  }
  return builder.part("verge", "track desert sand");
}

function paddockFloor(
  list: Station[],
  track: StreetTrack,
  paddock: NonNullable<DesertVenue["paddock"]>,
): Part {
  const builder = new Builder(2);
  const sign = pitSign(track);
  const from = paddock.from - paddockMargin;
  const span = wrap(paddock.end + paddockMargin - from, track.length);
  const rows = spanRows(list, track.length, from, span, 2);
  const near = paddock.front - 0.3;
  const far = paddock.front + paddock.depth + paddockBehind;
  const first = builder.count;
  for (const station of rows)
    for (const distance of sign > 0 ? [near, far] : [far, near]) {
      const lateral = sign * distance;
      builder.vertex(place(station, lateral, paddockLift), up, [
        [lateral / 3, station.s / 3],
        [0, 0],
      ]);
    }
  builder.grid(rows.length, 2, first);
  return builder.part("paddock floor", "track stand concrete");
}

function pitLights(
  list: Station[],
  track: StreetTrack,
  paddock: NonNullable<DesertVenue["paddock"]>,
  spots: LampSpot[],
): void {
  const sign = pitSign(track);
  const span = wrap(paddock.to - paddock.from, track.length);
  for (let along = 0; along <= span; along += pitLightEvery) {
    const station = stationAt(list, track.length, paddock.from + along);
    spots.push({
      head: place(station, sign * (paddock.front - 1), pitLightHeight),
      aim: place(station, sign * track.pitLane.fastLane, 0),
      gain: lampGains.pit,
      reach: pitLightReach,
    });
  }
}

function terrain(list: Station[]): Part {
  const builder = new Builder(2);
  const xs = list.map((s) => s.x);
  const zs = list.map((s) => s.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  for (let r = 0; r <= terrainRings; r++) {
    const radius = terrainRadius * (r / terrainRings) ** 2;
    for (let k = 0; k <= terrainSpokes; k++) {
      const angle = (k / terrainSpokes) * Math.PI * 2;
      const x = cx + Math.cos(angle) * radius;
      const z = cz + Math.sin(angle) * radius;
      builder.vertex([x, -terrainDrop, z], up, [
        [x / sandTile, z / sandTile],
        [999, 0],
      ]);
    }
  }
  builder.grid(terrainRings + 1, terrainSpokes + 1, 0, true);
  return builder.part("terrain", "track desert sand");
}

function overheads(list: Station[], length: number, specs: GantrySpec[]) {
  const built = gantryParts(list, length, specs);
  return [
    built.steel.part("overhead steel", "track gantry steel"),
    built.faces.part("banner wraps", "track wall wraps"),
    built.deck.part("overhead deck", "track stand concrete"),
  ];
}

function surroundings(
  list: Station[],
  length: number,
  venue: DesertVenue,
  spots: LampSpot[],
): Part[] {
  const base = list[0]?.y ?? 0;
  return [
    ...buildingParts(venue.buildings, base, spots),
    ...serviceParts(list, length, venue.service ?? [], spots),
    ...lotParts(venue.lots ?? [], base, spots),
    ...pavingParts(
      venue.roads ?? [],
      venue.lawns ?? [],
      base,
      spots,
      venue.landmarks?.arena?.ring ?? null,
    ),
  ];
}

export function desertParts(
  track: StreetTrack,
  line: LinePath | null,
  venue: DesertVenue,
): {
  parts: Part[];
  crew: CrewSpot[];
  cars: GarageCar[];
  lamps: LampSpot[];
} {
  const list = stations(track, line);
  const spots: LampSpot[] = [];
  const edges = laneEdges(list, track);
  const runs = wallRuns(track);
  const sign = pitSign(track);
  const paddock = venue.paddock ? { ...venue.paddock, sign } : null;
  const side = paddock ? { ...paddock, wall: track.pitLane.pitWall } : null;
  if (paddock) pitLights(list, track, paddock, spots);
  return {
    parts: [
      road(list, track),
      edgeLines(list, track),
      markings(list, track),
      pitMarkings(list, track, false),
      kerbs(list, track),
      verge(list, track, edges),
      ...(paddock ? [paddockFloor(list, track, paddock)] : []),
      ...pitLaneParts(list, track, edges),
      terrain(list),
      barrierFaces(list, track, runs, venue.boards),
      barrierBody(list, track, runs),
      fenceMesh(list, track, runs),
      fencePosts(list, track, runs),
      gantry(list, track),
      lamps(list, track),
      ...overheads(list, track.length, venue.gantries),
      ...props(list, track.length, venue),
      ...surroundings(list, track.length, venue, spots),
      ...venueParts(
        list,
        track,
        { stands: venue.stands, paddock },
        track.pitLane,
      ),
    ],
    crew: side ? crewSpots(list, track.length, side) : [],
    cars: side ? garageCars(side, track.length) : [],
    lamps: spots,
  };
}
