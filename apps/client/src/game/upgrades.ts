import * as THREE from "three/webgpu";
import { releaseOnceUploaded } from "./preload.ts";

type Apply = (image: HTMLImageElement) => void;

interface Upgrade {
  url: string;
  apply: Apply;
}

const waiting: Upgrade[] = [];

export function upgradeLater(url: string, apply: Apply): void {
  waiting.push({ url, apply });
}

export function replaceImage(texture: THREE.Texture, image: unknown): void {
  texture.dispose();
  texture.image = image;
  texture.needsUpdate = true;
  releaseOnceUploaded(texture);
}

export function swapLater(texture: THREE.Texture, url: string): void {
  upgradeLater(url, (image) => {
    replaceImage(texture, image);
  });
}

export function upgradeFiles(): string[] {
  return waiting.map((upgrade) => upgrade.url);
}

export async function upgradeAll(lanes = 2): Promise<number> {
  const due = waiting.splice(0);
  const loader = new THREE.ImageLoader();
  let applied = 0;
  const lane = async (): Promise<void> => {
    for (let next = due.shift(); next; next = due.shift()) {
      const image = await loader.loadAsync(next.url).catch(() => null);
      if (!image) continue;
      next.apply(image);
      applied++;
    }
  };
  await Promise.all(Array.from({ length: lanes }, lane));
  return applied;
}
