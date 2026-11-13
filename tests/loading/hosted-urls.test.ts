import { describe, expect, test } from "vitest";
import {
  hostedPath,
  rehomeSizes,
} from "../../apps/client/src/game/hosted-urls.ts";

const site = "/games/abc123/";
const server = "https://revracers.com";

describe("game hosted under another site's folder", () => {
  test("API calls go to the RevRacers server", () => {
    expect(hostedPath("/api/players", site, server)).toBe(
      "https://revracers.com/api/players",
    );
    expect(hostedPath("/api/pad/room/offers?after=3", site, server)).toBe(
      "https://revracers.com/api/pad/room/offers?after=3",
    );
  });

  test("site-root paths stay inside the game's folder", () => {
    expect(hostedPath("/", site, server)).toBe("/games/abc123/");
    expect(hostedPath("/loading/01.jpg", site, server)).toBe(
      "/games/abc123/loading/01.jpg",
    );
  });

  test("a path that only starts with api is not sent to the server", () => {
    expect(hostedPath("/apiary.json", site, server)).toBe(
      "/games/abc123/apiary.json",
    );
  });

  test("relative, absolute and protocol-relative addresses are left alone", () => {
    for (const url of [
      "./assets/road.glb",
      "assets/road.glb",
      "https://cdn.example.net/x.js",
      "//cdn.example.net/x.js",
      "blob:https://game.example.net/1",
    ])
      expect(hostedPath(url, site, server)).toBe(url);
  });

  test("the download size map follows the game's folder", () => {
    expect(
      rehomeSizes({ "/assets/road.glb": 100, "/assets/sky.hdr": 7 }, site),
    ).toEqual({
      "/games/abc123/assets/road.glb": 100,
      "/games/abc123/assets/sky.hdr": 7,
    });
  });

  test("at the site root nothing moves", () => {
    expect(hostedPath("/loading/01.jpg", "/", server)).toBe("/loading/01.jpg");
    expect(rehomeSizes({ "/assets/road.glb": 100 }, "/")).toEqual({
      "/assets/road.glb": 100,
    });
  });
});
