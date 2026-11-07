interface CentrePoint {
  x: number;
  y: number;
  z: number;
  width: number;
  wallLeft: number;
  wallRight: number;
}

interface KerbSpan {
  kind: string;
  side: string;
  from: number;
  to: number;
  width: number;
}

export interface TrainingTrack {
  length: number;
  width: number;
  runoff: number;
  centerline: CentrePoint[];
  surfaces: KerbSpan[];
  grid: { distance: number; offset: number }[];
  startLine: number;
}

export interface LinePath {
  length: number;
  x: number[];
  z: number[];
}

export interface Part {
  name: string;
  material: string;
  position: Float32Array;
  normal: Float32Array;
  uvs: Float32Array[];
  index: Uint32Array;
}

const subdivide = 2;
const mainColumns = 9;
const lineWidth = 0.25;
const paintLift = 0.004;
const startLineWidth = 0.4;
const gridHalfWidth = 1.3;
const gridLeg = 1.0;
const gridBar = 0.15;
const gridNose = 2.6;
const kerbProfile: [number, number][] = [
  [0, 0],
  [0.1, 0.007],
  [0.4, 0.016],
  [1.05, 0.02],
  [1.2, 0.02],
];
const kerbTaper = 16;
const kerbLift = 0.008;
const kerbTile = 5;
const asphaltTile = 2;
const grassTile = 3;
const spaceReach = 60;
const terrainTile = 400;
const vergeColumns = 7;
const vergeBeyond = 4;
const wallHeight = 1;
const wallThickness = 0.45;
const wallTile = 2;
const tecproReach = 26;
const terrainDrop = 0.05;
const terrainRadius = 5200;
const terrainRings = 28;
const terrainSpokes = 96;
const rubberCurvature = 60;
const gantryPost = 0.6;
const gantryBeam = 0.9;
const gantryClear = 6.2;
const gantryReach = 3;
const lampPods = 5;
const lampRows = 4;
const lampSize = 0.24;
const lampGap = 0.34;

interface Station {
  s: number;
  x: number;
  y: number;
  z: number;
  lx: number;
  lz: number;
  half: number;
  wallLeft: number;
  wallRight: number;
  line: number;
  rubber: number;
}

function wrap(value: number, length: number): number {
  return ((value % length) + length) % length;
}

function catmull(a: number, b: number, c: number, d: number, t: number) {
  return (
    0.5 *
    (2 * b +
      (-a + c) * t +
      (2 * a - 5 * b + 4 * c - d) * t * t +
      (-a + 3 * b - 3 * c + d) * t * t * t)
  );
}

function lineOffsets(points: CentrePoint[], line: LinePath | null): number[] {
  const count = points.length;
  return points.map((point, i) => {
    if (line?.x.length !== count) return 0;
    const next = points[(i + 1) % count] ?? point;
    const prev = points[(i - 1 + count) % count] ?? point;
    const tx = next.x - prev.x;
    const tz = next.z - prev.z;
    const norm = Math.hypot(tx, tz) || 1;
    const dx = (line.x[i] ?? point.x) - point.x;
    const dz = (line.z[i] ?? point.z) - point.z;
    return (dx * tz - dz * tx) / norm;
  });
}

export function stations(
  track: TrainingTrack,
  line: LinePath | null,
): Station[] {
  const points = track.centerline;
  const count = points.length;
  const offsets = lineOffsets(points, line);
  const at = (i: number) => points[wrap(i, count)] ?? points[0];
  const out: Station[] = [];
  for (let i = 0; i < count; i++)
    for (let k = 0; k < subdivide; k++) {
      const t = k / subdivide;
      const [a, b, c, d] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
      if (!a || !b || !c || !d) continue;
      const lerp = (p: number, q: number) => p + (q - p) * t;
      out.push({
        s: ((i + t) * track.length) / count,
        x: catmull(a.x, b.x, c.x, d.x, t),
        y: lerp(b.y, c.y),
        z: catmull(a.z, b.z, c.z, d.z, t),
        lx: 0,
        lz: 0,
        half: lerp(b.width, c.width) / 2,
        wallLeft: lerp(b.wallLeft, c.wallLeft),
        wallRight: lerp(b.wallRight, c.wallRight),
        line: lerp(offsets[i] ?? 0, offsets[wrap(i + 1, count)] ?? 0),
        rubber: 0,
      });
    }
  const n = out.length;
  const headings: number[] = [];
  out.forEach((station, i) => {
    const next = out[(i + 1) % n] ?? station;
    const prev = out[(i - 1 + n) % n] ?? station;
    const tx = next.x - prev.x;
    const tz = next.z - prev.z;
    const norm = Math.hypot(tx, tz) || 1;
    station.lx = tz / norm;
    station.lz = -tx / norm;
    headings.push(Math.atan2(-tz, tx));
  });
  const spacing = track.length / n;
  out.forEach((station, i) => {
    const ahead = headings[(i + 4) % n] ?? 0;
    const behind = headings[(i - 4 + n) % n] ?? 0;
    let turn = ahead - behind;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    const curvature = Math.abs(turn) / (8 * spacing);
    station.rubber =
      0.45 + 0.55 * Math.min(1, Math.max(0, curvature * rubberCurvature));
  });
  return out;
}

function place(station: Station, lateral: number, lift = 0): number[] {
  return [
    station.x + station.lx * lateral,
    station.y + lift,
    station.z + station.lz * lateral,
  ];
}

class Builder {
  readonly position: number[] = [];
  readonly normal: number[] = [];
  readonly uvs: number[][];
  readonly index: number[] = [];

  constructor(uvSets: number) {
    this.uvs = Array.from({ length: uvSets }, () => []);
  }

  get count(): number {
    return this.position.length / 3;
  }

  vertex(p: number[], n: number[], uv: number[][]): void {
    this.position.push(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);
    this.normal.push(n[0] ?? 0, n[1] ?? 1, n[2] ?? 0);
    uv.forEach((pair, set) => this.uvs[set]?.push(pair[0] ?? 0, pair[1] ?? 0));
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.index.push(a, b, c, a, c, d);
  }

  grid(rows: number, columns: number, first: number, flip = false): void {
    for (let r = 0; r < rows - 1; r++)
      for (let c = 0; c < columns - 1; c++) {
        const a = first + r * columns + c;
        const b = first + (r + 1) * columns + c;
        if (flip) this.quad(a, a + 1, b + 1, b);
        else this.quad(a, b, b + 1, a + 1);
      }
  }

  part(name: string, material: string): Part {
    return {
      name,
      material,
      position: new Float32Array(this.position),
      normal: new Float32Array(this.normal),
      uvs: this.uvs.map((set) => new Float32Array(set)),
      index: new Uint32Array(this.index),
    };
  }
}

const up = [0, 1, 0];

function closedRows(list: Station[], length: number): Station[] {
  const first = list[0];
  return first ? [...list, { ...first, s: length }] : list;
}

function space(lateral: number, s: number, length: number): number[] {
  return [(lateral + spaceReach) / (2 * spaceReach), 1 - s / length];
}

function road(list: Station[], track: TrainingTrack): Part {
  const builder = new Builder(3);
  const rows = closedRows(list, track.length);
  const border = track.runoff;
  for (const station of rows) {
    const half = station.half;
    const main = Array.from(
      { length: mainColumns },
      (_, k) => -half + (2 * half * k) / (mainColumns - 1),
    );
    const lateral = [-(half + border), ...main, half + border];
    for (const l of lateral)
      builder.vertex(place(station, l), up, [
        [l / asphaltTile, station.s / asphaltTile],
        [l - station.line, station.rubber],
        space(l, station.s, track.length),
      ]);
  }
  builder.grid(rows.length, mainColumns + 2, 0);
  return builder.part("road", "track road asphalt");
}

function strip(
  builder: Builder,
  rows: Station[],
  inner: (station: Station) => number,
  outer: (station: Station) => number,
  lift: number,
): void {
  const first = builder.count;
  for (const station of rows) {
    const a = inner(station);
    const b = outer(station);
    const [low, high] = a < b ? [a, b] : [b, a];
    for (const l of [low, high])
      builder.vertex(place(station, l, lift), up, [[l, station.s]]);
  }
  builder.grid(rows.length, 2, first);
}

function edgeLines(list: Station[], track: TrainingTrack): Part {
  const builder = new Builder(1);
  const rows = closedRows(list, track.length);
  for (const sign of [1, -1])
    strip(
      builder,
      rows,
      (s) => sign * (s.half - lineWidth),
      (s) => sign * s.half,
      paintLift,
    );
  return builder.part("edge lines", "track road paint");
}

function stationAt(list: Station[], length: number, s: number): Station {
  const n = list.length;
  const f = (wrap(s, length) / length) * n;
  const i = Math.floor(f) % n;
  const t = f - Math.floor(f);
  const a = list[i] ?? list[0];
  const b = list[(i + 1) % n] ?? a;
  if (!a || !b) throw new Error("track has no stations");
  const mix = (p: number, q: number) => p + (q - p) * t;
  return {
    ...a,
    s,
    x: mix(a.x, b.x),
    y: mix(a.y, b.y),
    z: mix(a.z, b.z),
    half: mix(a.half, b.half),
  };
}

function rectangle(
  builder: Builder,
  list: Station[],
  length: number,
  along: [number, number],
  across: [number, number],
): void {
  const first = builder.count;
  for (const s of along) {
    const station = stationAt(list, length, s);
    for (const l of across)
      builder.vertex(place(station, l, paintLift), up, [[l, s]]);
  }
  builder.quad(first, first + 2, first + 3, first + 1);
}

function markings(list: Station[], track: TrainingTrack): Part {
  const builder = new Builder(1);
  const line = track.startLine;
  const span = stationAt(list, track.length, line).half - lineWidth;
  rectangle(
    builder,
    list,
    track.length,
    [line - startLineWidth / 2, line + startLineWidth / 2],
    [-span, span],
  );
  for (const slot of track.grid) {
    const front = slot.distance + gridNose;
    const o = slot.offset;
    rectangle(
      builder,
      list,
      track.length,
      [front - gridBar, front],
      [o - gridHalfWidth, o + gridHalfWidth],
    );
    for (const edge of [o - gridHalfWidth, o + gridHalfWidth - gridBar])
      rectangle(
        builder,
        list,
        track.length,
        [front - gridLeg, front - gridBar],
        [edge, edge + gridBar],
      );
  }
  return builder.part("markings", "track road paint");
}

function kerbRows(list: Station[], track: TrainingTrack, span: KerbSpan) {
  const n = list.length;
  const spacing = track.length / n;
  const extent = wrap(span.to - span.from, track.length);
  const count = Math.max(2, Math.round(extent / spacing) + 1);
  return Array.from({ length: count }, (_, k) => {
    const s = span.from + (k * extent) / (count - 1);
    const done = (k * extent) / (count - 1);
    return {
      station: stationAt(list, track.length, s),
      along: s,
      taper: Math.min(1, Math.min(done, extent - done) / kerbTaper),
    };
  });
}

function kerbs(list: Station[], track: TrainingTrack): Part {
  const builder = new Builder(1);
  const last = kerbProfile[kerbProfile.length - 1]?.[0] ?? 1;
  for (const span of track.surfaces) {
    if (span.kind !== "kerb") continue;
    const sign = span.side === "left" ? 1 : -1;
    const first = builder.count;
    const rows = kerbRows(list, track, span);
    for (const row of rows) {
      const profile = sign > 0 ? kerbProfile : [...kerbProfile].reverse();
      for (const [across, height] of profile) {
        const offset = (across * span.width) / last;
        const lateral = sign * (row.station.half + offset);
        builder.vertex(
          place(row.station, lateral, kerbLift + height * row.taper),
          up,
          [[offset / span.width, row.along / kerbTile]],
        );
      }
    }
    builder.grid(rows.length, kerbProfile.length, first);
  }
  return builder.part("kerbs", "track road kerb");
}

function verges(list: Station[], track: TrainingTrack): Part {
  const builder = new Builder(3);
  const rows = closedRows(list, track.length);
  for (const sign of [1, -1]) {
    const first = builder.count;
    for (const station of rows) {
      const edge = station.half + track.runoff;
      const wall =
        (sign > 0 ? station.wallLeft : station.wallRight) + vergeBeyond;
      const columns = Array.from(
        { length: vergeColumns },
        (_, k) => edge + ((wall - edge) * k) / (vergeColumns - 1),
      );
      const ordered = sign > 0 ? columns : [...columns].reverse();
      for (const distance of ordered) {
        const lateral = sign * distance;
        const p = place(station, lateral);
        builder.vertex(p, up, [
          [lateral / grassTile, station.s / grassTile],
          space(lateral, station.s, track.length),
          [(p[0] ?? 0) / terrainTile, (p[2] ?? 0) / terrainTile],
        ]);
      }
    }
    builder.grid(rows.length, vergeColumns, first);
  }
  return builder.part("verges", "track road grass");
}

function wallFaces(
  builder: Builder,
  rows: Station[],
  sign: number,
  pick: (station: Station) => boolean,
): void {
  const sides = [
    { from: 0, to: 0, low: 0, high: wallHeight, normal: -1 },
    {
      from: 0,
      to: wallThickness,
      low: wallHeight,
      high: wallHeight,
      normal: 0,
    },
    {
      from: wallThickness,
      to: wallThickness,
      low: wallHeight,
      high: 0,
      normal: 1,
    },
  ];
  for (const face of sides) {
    let run: Station[] = [];
    const flush = () => {
      if (run.length < 2) {
        run = [];
        return;
      }
      const first = builder.count;
      for (const station of run) {
        const wall = sign > 0 ? station.wallLeft : station.wallRight;
        const n =
          face.normal === 0
            ? up
            : [
                station.lx * sign * face.normal,
                0,
                station.lz * sign * face.normal,
              ];
        const across = [
          [wall + face.from, face.low],
          [wall + face.to, face.high],
        ];
        const ordered = sign > 0 ? across : [...across].reverse();
        for (const [distance = 0, height = 0] of ordered)
          builder.vertex(place(station, sign * distance, height), n, [
            [station.s / wallTile, (height + distance - wall) / wallTile],
          ]);
      }
      builder.grid(run.length, 2, first);
      run = [];
    };
    rows.forEach((station, i) => {
      const next = rows[i + 1];
      if (!next || !pick(station)) {
        flush();
        return;
      }
      if (run.length === 0) run.push(station);
      run.push(next);
    });
    flush();
  }
}

function walls(list: Station[], track: TrainingTrack, tecpro: boolean): Part {
  const builder = new Builder(1);
  const rows = closedRows(list, track.length);
  for (const sign of [1, -1])
    wallFaces(builder, rows, sign, (station) => {
      const wall = sign > 0 ? station.wallLeft : station.wallRight;
      return wall - station.half >= tecproReach === tecpro;
    });
  return tecpro
    ? builder.part("wall tecpro", "track wall tecpro")
    : builder.part("wall concrete", "track wall concrete");
}

function terrain(centre: number[]): Part {
  const builder = new Builder(2);
  const [cx = 0, cz = 0] = centre;
  for (let r = 0; r <= terrainRings; r++) {
    const radius = terrainRadius * (r / terrainRings) ** 2;
    for (let k = 0; k <= terrainSpokes; k++) {
      const angle = (k / terrainSpokes) * Math.PI * 2;
      const x = cx + Math.cos(angle) * radius;
      const z = cz + Math.sin(angle) * radius;
      builder.vertex([x, -terrainDrop, z], up, [
        [x / grassTile, z / grassTile],
        [x / terrainTile, z / terrainTile],
      ]);
    }
  }
  builder.grid(terrainRings + 1, terrainSpokes + 1, 0, true);
  return builder.part("terrain", "track terrain");
}

function box(
  builder: Builder,
  centre: number[],
  half: number[],
  axes: number[][],
): void {
  const [ax = [1, 0, 0], ay = [0, 1, 0], az = [0, 0, 1]] = axes;
  const corner = (sx: number, sy: number, sz: number) =>
    [0, 1, 2].map(
      (i) =>
        (centre[i] ?? 0) +
        (ax[i] ?? 0) * sx * (half[0] ?? 0) +
        (ay[i] ?? 0) * sy * (half[1] ?? 0) +
        (az[i] ?? 0) * sz * (half[2] ?? 0),
    );
  const faces: [number[], number[][]][] = [
    [
      ax,
      [
        [1, -1, -1],
        [1, 1, -1],
        [1, 1, 1],
        [1, -1, 1],
      ],
    ],
    [
      ax.map((v) => -v),
      [
        [-1, -1, 1],
        [-1, 1, 1],
        [-1, 1, -1],
        [-1, -1, -1],
      ],
    ],
    [
      ay,
      [
        [-1, 1, -1],
        [-1, 1, 1],
        [1, 1, 1],
        [1, 1, -1],
      ],
    ],
    [
      ay.map((v) => -v),
      [
        [-1, -1, 1],
        [-1, -1, -1],
        [1, -1, -1],
        [1, -1, 1],
      ],
    ],
    [
      az,
      [
        [-1, -1, 1],
        [1, -1, 1],
        [1, 1, 1],
        [-1, 1, 1],
      ],
    ],
    [
      az.map((v) => -v),
      [
        [1, -1, -1],
        [-1, -1, -1],
        [-1, 1, -1],
        [1, 1, -1],
      ],
    ],
  ];
  for (const [normal, corners] of faces) {
    const first = builder.count;
    for (const [sx = 0, sy = 0, sz = 0] of corners)
      builder.vertex(corner(sx, sy, sz), normal, [[0, 0]]);
    builder.quad(first, first + 1, first + 2, first + 3);
  }
}

function gantryFrame(list: Station[], track: TrainingTrack) {
  const station = stationAt(list, track.length, track.startLine);
  const forward = [-station.lz, 0, station.lx];
  const left = [station.lx, 0, station.lz];
  return { station, forward, left, axes: [left, up, forward] };
}

function gantry(list: Station[], track: TrainingTrack): Part {
  const builder = new Builder(1);
  const { station, axes } = gantryFrame(list, track);
  const reach = station.half + track.runoff + gantryReach;
  const top = gantryClear + gantryBeam / 2;
  for (const sign of [1, -1])
    box(
      builder,
      place(station, sign * reach, top / 2),
      [gantryPost / 2, top / 2, gantryPost / 2],
      axes,
    );
  box(
    builder,
    place(station, 0, gantryClear),
    [reach, gantryBeam / 2, gantryBeam / 2],
    axes,
  );
  const width = lampPods * lampGap * 1.6;
  box(
    builder,
    place(station, 0, gantryClear - lampRows * lampGap * 0.5),
    [width / 2, (lampRows * lampGap) / 2 + 0.08, 0.12],
    axes,
  );
  return builder.part("gantry steel", "track gantry steel");
}

function lamps(list: Station[], track: TrainingTrack): Part {
  const builder = new Builder(1);
  const { station, forward, left } = gantryFrame(list, track);
  const back = forward.map((v) => -v);
  const centreY = gantryClear - lampRows * lampGap * 0.5;
  for (let pod = 0; pod < lampPods; pod++) {
    const lateral = (pod - (lampPods - 1) / 2) * lampGap * 1.6;
    for (let row = 0; row < lampRows; row++) {
      const y = centreY + ((lampRows - 1) / 2 - row) * lampGap;
      const centre = place(station, -lateral, y).map(
        (v, i) => v + (back[i] ?? 0) * 0.13,
      );
      const first = builder.count;
      const uv = [pod + 0.5, 0.5 - row];
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const)
        builder.vertex(
          [0, 1, 2].map(
            (i) =>
              (centre[i] ?? 0) +
              (left[i] ?? 0) * sx * (lampSize / 2) +
              (up[i] ?? 0) * sy * (lampSize / 2),
          ),
          back,
          [uv],
        );
      builder.quad(first, first + 3, first + 2, first + 1);
    }
  }
  return builder.part("start lamps", "track start lamps");
}

export function trainingParts(
  track: TrainingTrack,
  line: LinePath | null,
): Part[] {
  const list = stations(track, line);
  const xs = list.map((s) => s.x);
  const zs = list.map((s) => s.z);
  const centre = [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...zs) + Math.max(...zs)) / 2,
  ];
  return [
    road(list, track),
    edgeLines(list, track),
    markings(list, track),
    kerbs(list, track),
    verges(list, track),
    walls(list, track, false),
    walls(list, track, true),
    terrain(centre),
    gantry(list, track),
    lamps(list, track),
  ];
}
