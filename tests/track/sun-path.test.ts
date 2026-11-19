import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { circuitOf } from "../../apps/client/src/game/circuits.ts";
import { SdSky } from "../../apps/client/src/game/sky.ts";
import { repoRoot } from "../support/repo.ts";

const deg = Math.PI / 180;
const latitude = 30.1328;
const longitude = -97.6411;
const centralDaylight = -5;
const allowed = 3;
const frame = JSON.parse(
  readFileSync(
    path.join(repoRoot, "content/tracks/hill-country/sd-frame.json"),
    "utf8",
  ),
) as { heading: number };

function realSun(
  day: number,
  clock: number,
): { elevation: number; azimuth: number } {
  const utc =
    Date.UTC(2026, 9, day) / 86400000 + (clock - centralDaylight) / 24;
  const n = utc + 2440587.5 - 2451545;
  const mean = (280.46 + 0.9856474 * n) % 360;
  const anomaly = ((357.528 + 0.9856003 * n) % 360) * deg;
  const ecliptic =
    (mean + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * deg;
  const tilt = (23.439 - 0.0000004 * n) * deg;
  const ascension = Math.atan2(
    Math.cos(tilt) * Math.sin(ecliptic),
    Math.cos(ecliptic),
  );
  const declination = Math.asin(Math.sin(tilt) * Math.sin(ecliptic));
  const sidereal = (18.697374558 + 24.06570982441908 * n) % 24;
  const angle = ((sidereal * 15 + longitude) % 360) * deg - ascension;
  const at = latitude * deg;
  const elevation = Math.asin(
    Math.sin(at) * Math.sin(declination) +
      Math.cos(at) * Math.cos(declination) * Math.cos(angle),
  );
  const azimuth = Math.atan2(
    -Math.sin(angle),
    Math.tan(declination) * Math.cos(at) - Math.sin(at) * Math.cos(angle),
  );
  return { elevation, azimuth: (azimuth / deg + 360) % 360 };
}

function gameBearing(elevation: number, afternoon: boolean): number {
  const day = circuitOf("hill-country").day;
  const height = (90 - elevation / deg) / 15;
  const hours = afternoon ? 12 + height : 12 - height;
  const sky = new SdSky(
    {
      timeOfDay: hours * 3600,
      sunAscension: 73.2 * deg,
      rain: 0,
      visibility: 16000,
      worldX: 2000,
      worldY: 2000,
      worldZ: 100,
    },
    day,
    frame.heading,
  );
  const [x, y] = sky.update(-1, 0, 1000, 1000).sunPosition;
  const world = Math.atan2(x - 1000, y - 1000) - frame.heading;
  return (((world / deg) % 360) + 360) % 360;
}

function apart(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

describe("Hill Country sun", () => {
  test.each([
    ["sunrise light", 24, 8.25],
    ["mid-morning", 24, 10],
    ["race start", 25, 14],
    ["qualifying", 24, 16.85],
    ["evening", 24, 18.25],
  ])(
    "at %s the game sun stands where the real Austin sun stood that weekend",
    (_, day, clock) => {
      const real = realSun(day, clock);
      const bearing = gameBearing(real.elevation, clock > 13.25);
      expect(apart(bearing, real.azimuth)).toBeLessThan(allowed);
    },
  );
});
