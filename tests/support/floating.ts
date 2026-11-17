export interface Shape {
  name: string;
  position: ArrayLike<number>;
  index: ArrayLike<number>;
}

export interface Floating {
  names: string[];
  centre: number[];
  lift: number;
}

type Ground = (x: number, z: number) => number | null;

interface Box {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}

interface Piece {
  shape: number;
  box: Box;
  grounded: boolean;
}

const cell = 2;
const largest = 200;

function emptyBox(): Box {
  return {
    x0: Infinity,
    y0: Infinity,
    z0: Infinity,
    x1: -Infinity,
    y1: -Infinity,
    z1: -Infinity,
  };
}

function grow(box: Box, x: number, y: number, z: number): void {
  box.x0 = Math.min(box.x0, x);
  box.y0 = Math.min(box.y0, y);
  box.z0 = Math.min(box.z0, z);
  box.x1 = Math.max(box.x1, x);
  box.y1 = Math.max(box.y1, y);
  box.z1 = Math.max(box.z1, z);
}

function triangleBox(shape: Shape, first: number): Box {
  const box = emptyBox();
  for (let k = 0; k < 3; k++) {
    const v = Number(shape.index[first + k]) * 3;
    grow(
      box,
      Number(shape.position[v]),
      Number(shape.position[v + 1]),
      Number(shape.position[v + 2]),
    );
  }
  return box;
}

function piecesOf(shapes: Shape[], ground: Ground, rest: number): Piece[] {
  const pieces: Piece[] = [];
  shapes.forEach((shape, s) => {
    for (let i = 0; i + 2 < shape.index.length; i += 3) {
      const box = triangleBox(shape, i);
      const floor = ground((box.x0 + box.x1) / 2, (box.z0 + box.z1) / 2);
      const grounded = floor === null || box.y0 <= floor + rest;
      pieces.push({ shape: s, box, grounded });
    }
  });
  return pieces;
}

function cellsOf(box: Box, gap: number): number[] {
  if (box.x1 - box.x0 > largest || box.z1 - box.z0 > largest) return [];
  const keys: number[] = [];
  for (
    let x = Math.floor((box.x0 - gap) / cell);
    x <= (box.x1 + gap) / cell;
    x++
  )
    for (
      let z = Math.floor((box.z0 - gap) / cell);
      z <= (box.z1 + gap) / cell;
      z++
    )
      keys.push(x * 1000003 + z);
  return keys;
}

function touching(a: Box, b: Box, gap: number): boolean {
  return (
    a.x0 <= b.x1 + gap &&
    b.x0 <= a.x1 + gap &&
    a.y0 <= b.y1 + gap &&
    b.y0 <= a.y1 + gap &&
    a.z0 <= b.z1 + gap &&
    b.z0 <= a.z1 + gap
  );
}

function gridOf(pieces: Piece[], gap: number): Map<number, number[]> {
  const grid = new Map<number, number[]>();
  pieces.forEach((piece, index) => {
    for (const key of cellsOf(piece.box, gap)) {
      const list = grid.get(key);
      if (list) list.push(index);
      else grid.set(key, [index]);
    }
  });
  return grid;
}

function neighbours(
  index: number,
  pieces: Piece[],
  grid: Map<number, number[]>,
  gap: number,
): number[] {
  const piece = pieces[index];
  if (!piece) return [];
  const found = new Set<number>();
  for (const key of cellsOf(piece.box, gap))
    for (const other of grid.get(key) ?? []) {
      const next = pieces[other];
      if (next && other !== index && touching(piece.box, next.box, gap))
        found.add(other);
    }
  return [...found];
}

function spread(
  first: number,
  pieces: Piece[],
  grid: Map<number, number[]>,
  group: Int32Array,
  gap: number,
): number[] | null {
  group[first] = first;
  const members = [first];
  for (let m = 0; m < members.length; m++)
    for (const other of neighbours(Number(members[m]), pieces, grid, gap)) {
      if (group[other] === first) continue;
      if (pieces[other]?.grounded || group[other] !== -1) return null;
      group[other] = first;
      members.push(other);
    }
  return members;
}

function tenths(value: number): number {
  return Math.round(value * 10) / 10;
}

function described(
  members: number[],
  pieces: Piece[],
  shapes: Shape[],
  ground: Ground,
): Floating {
  const box = emptyBox();
  const names = new Set<string>();
  for (const member of members) {
    const piece = pieces[member];
    if (!piece) continue;
    names.add(shapes[piece.shape]?.name ?? "");
    grow(box, piece.box.x0, piece.box.y0, piece.box.z0);
    grow(box, piece.box.x1, piece.box.y1, piece.box.z1);
  }
  const x = (box.x0 + box.x1) / 2;
  const z = (box.z0 + box.z1) / 2;
  return {
    names: [...names],
    centre: [x, (box.y0 + box.y1) / 2, z].map(tenths),
    lift: tenths(box.y0 - (ground(x, z) ?? 0)),
  };
}

export function floating(
  shapes: Shape[],
  ground: Ground,
  { rest = 0.6, gap = 0.2 } = {},
): Floating[] {
  const pieces = piecesOf(shapes, ground, rest);
  const grid = gridOf(pieces, gap);
  const group = new Int32Array(pieces.length).fill(-1);
  const found: Floating[] = [];
  pieces.forEach((piece, index) => {
    if (piece.grounded || group[index] !== -1) return;
    const members = spread(index, pieces, grid, group, gap);
    if (members) found.push(described(members, pieces, shapes, ground));
  });
  return found;
}
