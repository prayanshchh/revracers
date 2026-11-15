import sharp from "sharp";

const webpLimit = 16383;
const runMarker = 2;
const longestRun = 128;

interface Radiance {
  width: number;
  height: number;
  rgbe: Uint8Array;
}

function headerOf(
  bytes: Uint8Array,
): { width: number; height: number; start: number } | null {
  const text = Buffer.from(bytes.subarray(0, 512)).toString("latin1");
  if (!text.startsWith("#?")) return null;
  const size = /\n\n-Y (\d+) \+X (\d+)\n/.exec(text);
  if (!size || !text.includes("FORMAT=32-bit_rle_rgbe")) return null;
  return {
    width: Number(size[2]),
    height: Number(size[1]),
    start: size.index + size[0].length,
  };
}

function runLengthCoded(bytes: Uint8Array, at: number, width: number): boolean {
  return (
    bytes[at] === runMarker &&
    bytes[at + 1] === runMarker &&
    ((bytes[at + 2] ?? 0) << 8) + (bytes[at + 3] ?? 0) === width
  );
}

function readChannel(
  bytes: Uint8Array,
  from: number,
  row: Uint8Array,
  channel: number,
): number {
  let at = from;
  const width = row.length / 4;
  for (let x = 0; x < width;) {
    const count = bytes[at++] ?? 0;
    const run = count > longestRun;
    const length = run ? count - longestRun : count;
    if (length === 0 || x + length > width) return -1;
    for (let i = 0; i < length; i++)
      row[(x + i) * 4 + channel] = bytes[run ? at : at + i] ?? 0;
    at += run ? 1 : length;
    x += length;
  }
  return at;
}

function radianceOf(bytes: Uint8Array): Radiance | null {
  const header = headerOf(bytes);
  if (!header) return null;
  const { width, height } = header;
  const rgbe = new Uint8Array(width * height * 4);
  let at = header.start;
  for (let y = 0; y < height; y++) {
    if (!runLengthCoded(bytes, at, width)) return null;
    at += 4;
    const row = rgbe.subarray(y * width * 4, (y + 1) * width * 4);
    for (let channel = 0; channel < 4 && at >= 0; channel++)
      at = readChannel(bytes, at, row, channel);
    if (at < 0) return null;
  }
  return { width, height, rgbe };
}

function stacked({ width, height, rgbe }: Radiance): Uint8Array {
  const pixels = width * height;
  const image = new Uint8Array(pixels * 6);
  for (let i = 0; i < pixels; i++) {
    image[i * 3] = rgbe[i * 4] ?? 0;
    image[i * 3 + 1] = rgbe[i * 4 + 1] ?? 0;
    image[i * 3 + 2] = rgbe[i * 4 + 2] ?? 0;
    image.fill(rgbe[i * 4 + 3] ?? 0, (pixels + i) * 3, (pixels + i) * 3 + 3);
  }
  return image;
}

export async function packSky(source: Uint8Array): Promise<Uint8Array | null> {
  const radiance = radianceOf(source);
  if (!radiance) return null;
  const { width, height } = radiance;
  if (width > webpLimit || height * 2 > webpLimit) return null;
  const image = stacked(radiance);
  const webp = await sharp(image, {
    raw: { width, height: height * 2, channels: 3 },
  })
    .webp({ lossless: true, exact: true, effort: 4, quality: 75 })
    .toBuffer();
  const decoded = await sharp(webp).raw().toBuffer({ resolveWithObject: true });
  const exact =
    decoded.info.channels === 3 && Buffer.from(image).equals(decoded.data);
  return exact && webp.length < source.length ? new Uint8Array(webp) : null;
}
