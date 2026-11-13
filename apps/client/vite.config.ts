import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { apiServer } from "./api-server.ts";
import { assetPack } from "./asset-pack.ts";
import { assetSizes } from "./asset-sizes.ts";
import { engineBuild } from "./engine-build.ts";
import { hostedBuild } from "./hosted-build.ts";
import { phoneTunnel } from "./phone-tunnel.ts";

const headers = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

const page = (name: string) =>
  fileURLToPath(new URL(`./${name}.html`, import.meta.url));

const hostedServer = process.env["REVRACERS_HOSTED"];

export default defineConfig({
  ...(hostedServer ? { base: "./" } : {}),
  plugins: [
    assetPack(),
    engineBuild(),
    phoneTunnel(),
    apiServer(),
    assetSizes(),
    ...(hostedServer ? [hostedBuild(hostedServer)] : []),
  ],
  server: {
    headers,
    allowedHosts: [".trycloudflare.com"],
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
  },
  preview: { headers },
  assetsInclude: ["**/*.glb"],
  build: {
    target: "es2023",
    ...(hostedServer
      ? {
          outDir: fileURLToPath(
            new URL("../../build/hosted/site", import.meta.url),
          ),
          emptyOutDir: true,
        }
      : {}),
    license: { fileName: "third-party-licenses.md" },
    rollupOptions: {
      input: hostedServer
        ? { index: page("index") }
        : { index: page("index"), phonepad: page("phonepad") },
    },
  },
});
