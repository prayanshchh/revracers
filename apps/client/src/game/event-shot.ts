import { el } from "./dom.ts";
import { type Look, stillOf } from "./event-art.ts";

const keptLayers = 2;

function picture(url: string, className = ""): HTMLImageElement {
  const image = el("img", className);
  image.alt = "";
  image.decoding = "async";
  image.src = url;
  return image;
}

export class Shot {
  readonly root: HTMLElement;
  private key = "";

  constructor(
    className: string,
    private readonly thumb: boolean,
  ) {
    this.root = el("div", `ev-shot ${className}`.trim());
  }

  show(track: string, look: Look): void {
    const key = [track, look.time, look.sky, look.second, look.random].join();
    if (key === this.key) return;
    this.key = key;
    const url = stillOf(track, look.time, look.sky, this.thumb);
    this.root.dataset["still"] =
      `${track}/${this.thumb ? "thumb/" : ""}${look.time}-${look.sky.replace(/ /g, "-")}`;
    const layer = el("div", "ev-shot-layer");
    const main = picture(url);
    layer.append(main);
    if (look.second) {
      layer.classList.add("split");
      layer.append(
        picture(
          stillOf(track, look.time, look.second, this.thumb),
          "ev-shot-second",
        ),
      );
    }
    if (look.random) layer.append(el("b", "ev-shot-random", "?"));
    const reveal = () => {
      layer.classList.add("in");
    };
    main.addEventListener("load", reveal, { once: true });
    main.addEventListener("error", reveal, { once: true });
    this.root.append(layer);
    const all = Array.from(this.root.querySelectorAll(".ev-shot-layer"));
    for (const old of all.slice(0, Math.max(0, all.length - keptLayers)))
      old.remove();
  }
}
