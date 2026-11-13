import type { Plugin } from "vite";

export function hostedBuild(server: string): Plugin {
  return {
    name: "revracers-hosted-build",
    apply: "build",
    transformIndexHtml: {
      order: "pre",
      handler: () => [
        {
          tag: "meta",
          attrs: { name: "revracers-server", content: server },
          injectTo: "head-prepend",
        },
        {
          tag: "script",
          attrs: { type: "module", src: "/src/hosted.ts" },
          injectTo: "head-prepend",
        },
      ],
    },
  };
}
