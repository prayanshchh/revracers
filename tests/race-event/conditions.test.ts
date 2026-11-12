import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  lookOf,
  overviewOf,
  stillOf,
} from "../../apps/client/src/game/event-art.ts";
import {
  choices,
  tracks,
  weatherPresets,
} from "../../apps/client/src/game/settings.ts";
import { repoRoot } from "../support/repo.ts";

const evening = new Date(2026, 10, 11, 21, 30);
const lunchtime = new Date(2026, 10, 11, 12, 30);
const fixedTimes = ["dawn", "morning", "noon", "afternoon", "dusk", "night"];
const fixedSkies = weatherPresets.filter(
  (w) => w.id !== "dynamic" && w.id !== "random",
);

function xmlHour(track: string): number {
  const xml = readFileSync(
    path.join(repoRoot, "content/tracks", track, `${track}.xml`),
    "utf8",
  );
  const match = /<attnum name="time of day" unit="hour" val="([\d.]+)"\/>/.exec(
    xml,
  );
  if (!match?.[1]) throw new Error(`${track}.xml has no time of day`);
  return Number(match[1]);
}

function pictureOf(
  track: (typeof tracks)[number],
  timeOfDay: string,
  weather: (typeof weatherPresets)[number],
  thumb = false,
): string {
  const look = lookOf(
    { timeOfDay, clouds: weather.clouds, rain: weather.rain },
    track.hour,
    lunchtime,
  );
  return stillOf(track.id, look.time, look.sky, thumb);
}

describe("race event conditions", () => {
  test("every weather and start time on every circuit has a full picture and a card picture", () => {
    for (const track of tracks) {
      expect(overviewOf(track.id), track.id).not.toBe("");
      for (const weather of weatherPresets)
        for (const time of choices.timeOfDay)
          for (const now of [evening, lunchtime]) {
            const look = lookOf(
              {
                timeOfDay: time.id,
                clouds: weather.clouds,
                rain: weather.rain,
              },
              track.hour,
              now,
            );
            const what = `${track.id} ${weather.id} ${time.id}`;
            for (const thumb of [false, true]) {
              expect(
                stillOf(track.id, look.time, look.sky, thumb),
                what,
              ).not.toBe("");
              if (look.second)
                expect(
                  stillOf(track.id, look.time, look.second, thumb),
                  what,
                ).not.toBe("");
            }
          }
    }
  });

  test("each weather and each fixed start time shows its own picture of the circuit", () => {
    for (const track of tracks) {
      for (const time of fixedTimes) {
        const shots = fixedSkies.map((w) => pictureOf(track, time, w));
        expect(new Set(shots).size, `${track.id} at ${time}`).toBe(
          fixedSkies.length,
        );
        for (const shot of shots) expect(shot).toContain(`/${track.id}/`);
      }
      for (const weather of fixedSkies) {
        const shots = fixedTimes.map((t) => pictureOf(track, t, weather));
        expect(new Set(shots).size, `${track.id} in ${weather.id}`).toBe(
          fixedTimes.length,
        );
        const cards = fixedTimes.map((t) => pictureOf(track, t, weather, true));
        expect(cards.filter((card) => shots.includes(card))).toEqual([]);
      }
    }
  });

  test("dynamic weather shows a dry and a wet half, and random weather is marked unknown", () => {
    const dynamic = weatherPresets.find((w) => w.id === "dynamic");
    const random = weatherPresets.find((w) => w.id === "random");
    if (!dynamic || !random) throw new Error("missing presets");
    const at = (w: typeof dynamic | typeof random) =>
      lookOf(
        { timeOfDay: "noon", clouds: w.clouds, rain: w.rain },
        12,
        lunchtime,
      );
    expect(at(dynamic)).toMatchObject({
      sky: "light cloud",
      second: "light rain",
      random: false,
    });
    expect(at(random)).toMatchObject({ second: null, random: true });
  });

  test("each circuit's start time is the one its track file sets", () => {
    for (const track of tracks) expect(track.hour).toBe(xmlHour(track.id));
  });

  test("a circuit-time session is a night race only where the track file starts after dark", () => {
    const looks = Object.fromEntries(
      tracks.map((track) => [
        track.id,
        lookOf(
          { timeOfDay: "from track", clouds: "no cloud", rain: "none" },
          xmlHour(track.id),
          lunchtime,
        ).time,
      ]),
    );
    expect(looks).toEqual({
      "hill-country": "afternoon",
      "neon-boulevard": "night",
    });
  });

  test("a session set to start now follows the player's clock", () => {
    const at = (now: Date) =>
      lookOf({ timeOfDay: "now", clouds: "no cloud", rain: "none" }, 14.8, now)
        .time;
    expect(at(lunchtime)).toBe("noon");
    expect(at(evening)).toBe("night");
    expect(at(new Date(2026, 10, 11, 6, 40))).toBe("dawn");
    expect(at(new Date(2026, 10, 11, 18, 10))).toBe("dusk");
  });
});
