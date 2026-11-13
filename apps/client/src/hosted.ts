import { hostedPath, rehomeSizes } from "./game/hosted-urls.ts";
import { type PhoneSite, phoneSitePath } from "./game/pad-address.ts";

const server =
  document.querySelector<HTMLMetaElement>("meta[name=revracers-server]")
    ?.content ?? "";
const site = new URL(".", location.href).pathname;
const nativeFetch = globalThis.fetch.bind(globalThis);

function rewriteMap(
  selector: string,
  rewrite: (sizes: Record<string, number>) => Record<string, number>,
): void {
  const tag = document.querySelector(selector);
  if (!tag) return;
  const sizes = JSON.parse(tag.textContent || "{}") as Record<string, number>;
  tag.textContent = JSON.stringify(rewrite(sizes));
}

rewriteMap("[data-asset-sizes]", (sizes) => rehomeSizes(sizes, site));
rewriteMap("[data-asset-wire]", () => ({}));

const phone: PhoneSite = { origin: server, problem: null };

globalThis.fetch = (input, init) => {
  if (typeof input !== "string") return nativeFetch(input, init);
  if (input === phoneSitePath) return Promise.resolve(Response.json(phone));
  return nativeFetch(hostedPath(input, site, server), init);
};
