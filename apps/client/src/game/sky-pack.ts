import { DataUtils } from "three";

const halfLimit = 65504;

export interface SkyTexels {
  data: Uint16Array;
  width: number;
  height: number;
}

export function skyHalves(
  stacked: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Uint16Array {
  const pixels = width * height;
  const one = DataUtils.toHalfFloat(1);
  const tables = new Map<number, Uint16Array>();
  const tableOf = (exponent: number): Uint16Array => {
    const known = tables.get(exponent);
    if (known) return known;
    const scale = Math.pow(2.0, exponent - 128.0) / 255.0;
    const table = Uint16Array.from({ length: 256 }, (_, mantissa) =>
      DataUtils.toHalfFloat(Math.min(mantissa * scale, halfLimit)),
    );
    tables.set(exponent, table);
    return table;
  };
  const halves = new Uint16Array(pixels * 4);
  for (let i = 0; i < pixels; i++) {
    const table = tableOf(stacked[(pixels + i) * 4] ?? 0);
    halves[i * 4] = table[stacked[i * 4] ?? 0] ?? 0;
    halves[i * 4 + 1] = table[stacked[i * 4 + 1] ?? 0] ?? 0;
    halves[i * 4 + 2] = table[stacked[i * 4 + 2] ?? 0] ?? 0;
    halves[i * 4 + 3] = one;
  }
  return halves;
}

export async function picturePixels(picture: Blob): Promise<{
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}> {
  const bitmap = await createImageBitmap(picture, {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no 2d canvas to decode the sky");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return {
    pixels: context.getImageData(0, 0, width, height).data,
    width,
    height,
  };
}
