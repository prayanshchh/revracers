import { picturePixels, skyHalves, type SkyTexels } from "./sky-pack.ts";

interface Scope {
  onmessage: ((event: MessageEvent<Blob>) => void) | null;
  postMessage(message: SkyTexels | null, transfer?: Transferable[]): void;
}

const scope = globalThis as unknown as Scope;

async function texelsOf(picture: Blob): Promise<SkyTexels> {
  const { pixels, width, height } = await picturePixels(picture);
  const rows = height / 2;
  return { data: skyHalves(pixels, width, rows), width, height: rows };
}

scope.onmessage = (event) => {
  texelsOf(event.data).then(
    (texels) => {
      scope.postMessage(texels, [texels.data.buffer]);
    },
    () => {
      scope.postMessage(null);
    },
  );
};
