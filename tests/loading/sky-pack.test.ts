import sharp from "sharp";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { describe, expect, test } from "vitest";
import { packSky } from "../../apps/client/sky-codec.ts";
import { skyHalves } from "../../apps/client/src/game/sky-pack.ts";

const width = 256;
const height = 96;
const longestRun = 127;

function radiance(): Uint8Array {
  const rgbe = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      const sun = Math.hypot(x - 180, y - 20) < 6;
      rgbe[at] = sun ? 255 : (90 + ((x * 3 + y) % 60)) & 255;
      rgbe[at + 1] = sun ? 240 : (120 + ((x + y * 2) % 50)) & 255;
      rgbe[at + 2] = sun ? 200 : (160 + ((x ^ y) % 40)) & 255;
      rgbe[at + 3] = sun ? 141 : y < 8 ? 0 : 126 + Math.floor(y / 30);
    }
  return rgbe;
}

function runs(values: number[]): number[] {
  const out: number[] = [];
  for (let at = 0; at < values.length;) {
    const value = values[at] ?? 0;
    let same = 1;
    while (same < longestRun && values[at + same] === value) same += 1;
    if (same > 2) {
      out.push(128 + same, value);
      at += same;
      continue;
    }
    const literal = values.slice(at, at + Math.min(longestRun, 16));
    out.push(literal.length, ...literal);
    at += literal.length;
  }
  return out;
}

function hdrFile(rgbe: Uint8Array, runLength: boolean): Uint8Array {
  const header = Buffer.from(
    `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${String(height)} +X ${String(width)}\n`,
    "latin1",
  );
  if (!runLength) return Buffer.concat([header, rgbe]);
  const rows: number[] = [];
  for (let y = 0; y < height; y++) {
    rows.push(2, 2, width >> 8, width & 255);
    for (let channel = 0; channel < 4; channel++)
      rows.push(
        ...runs(
          Array.from(
            { length: width },
            (_, x) => rgbe[(y * width + x) * 4 + channel] ?? 0,
          ),
        ),
      );
  }
  return Buffer.concat([header, Buffer.from(rows)]);
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

describe("lossless sky packing", () => {
  test("a packed sky decodes to the very half-float texels three reads from the source HDR, sun and black rows included", async () => {
    const source = hdrFile(radiance(), true);
    const packed = await packSky(source);
    expect(packed).not.toBeNull();
    if (!packed) return;
    expect(packed.length).toBeLessThan(source.length);
    const stacked = await sharp(packed)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([stacked.info.width, stacked.info.height]).toEqual([
      width,
      height * 2,
    ]);
    const wanted = new HDRLoader().parse(arrayBuffer(source)).data;
    if (!wanted) throw new Error("three could not read the source HDR");
    const halves = skyHalves(stacked.data, width, height);
    expect(halves.length).toBe(wanted.length);
    expect(Buffer.from(halves.buffer).equals(Buffer.from(wanted.buffer))).toBe(
      true,
    );
  });

  test("a sky stored without run-length coding, and a file that is no sky at all, are left as they are", async () => {
    expect(await packSky(hdrFile(radiance(), false))).toBeNull();
    expect(await packSky(Buffer.from("version https://git-lfs"))).toBeNull();
  });
});
