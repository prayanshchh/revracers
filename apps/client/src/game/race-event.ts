import { api } from "./api.ts";
import { airTemperature, buildUpVenue } from "./buildup-venues.ts";
import { button, el } from "./dom.ts";
import {
  clockText,
  type Look,
  lookOf,
  outlineOf,
  outlineSvg,
  overcastSky,
  overviewOf,
  rainLevel,
  rowSvg,
  startHour,
  surfaceOf,
  timeOf,
  tyreSvg,
  tyresFor,
  weatherSvg,
} from "./event-art.ts";
import { Shot } from "./event-shot.ts";
import { flagUrl } from "./flags.ts";
import { lapTime } from "./hud.ts";
import { seasonOf } from "./scenery-look.ts";
import {
  applyWeather,
  choices,
  saveSettings,
  sessionSummary,
  type Settings,
  tracks,
  weatherOf,
  weatherPresets,
} from "./settings.ts";
import { compounds } from "./tyres.ts";
import {
  forecastText,
  lapSeconds,
  newWeatherSeed,
  sessionSeconds,
  startRain,
  storyText,
  type WeatherPlan,
  weatherPlan,
} from "./weather-plan.ts";
import { lastSlot, raceLapOptions, raceLaps, type Stage } from "./weekend.ts";

export type EventPick = "start" | "back";

type Keys = Record<string, () => void>;

type Dir = "next" | "back";

export type FootPrompt = [
  glyph: string,
  label: string,
  action: () => void,
  primary?: boolean,
];

export interface FrontScreen {
  show(keys: Keys, ...nodes: HTMLElement[]): void;
  footer(...prompts: FootPrompt[]): HTMLElement;
}

type Track = (typeof tracks)[number];

interface Choice {
  id: string;
  label: string;
}

interface ConditionRow {
  id: string;
  title: string;
  options: readonly Choice[];
  get: () => string;
  set: (id: string) => void;
  look: (id: string) => Look;
  caption: (id: string) => string;
  icon: (id: string) => string;
  info: (id: string) => string;
}

interface SettingRow {
  id: string;
  label: string;
  info: string;
  options: readonly Choice[];
  get: () => string;
  set: (id: string) => void;
  shown?: () => boolean;
  kind?: "tyre" | "meter";
  note?: (id: string) => string;
}

interface Painted {
  root: HTMLElement;
  paint: () => void;
}

const stepNames = ["Circuit", "Conditions", "Race Settings"];
const difficultyMin = 40;
const difficultyMax = 110;

const weatherInfo: Record<string, string> = {
  clear:
    "Clear skies and a dry track. The surface rubbers in and grip builds through the session.",
  "light cloud": "Sunny spells between scattered clouds, on a dry track.",
  overcast:
    "A grey sky covers the circuit. The track stays dry and a little cooler.",
  "light rain":
    "A steady drizzle leaves the track damp. Intermediates are the tyre to have.",
  "heavy rain":
    "Heavy rain puts water on the racing line and throws up spray. Full Wets work best.",
  storm:
    "Torrential rain, standing water and very little grip. Spray hides the cars ahead.",
  dynamic:
    "Rain arrives on a dry track or a wet track dries out, even over a few laps. Plan your stops around the forecast.",
  random: "The weather is drawn at random when the session starts.",
};

const timeInfo: Record<string, string> = {
  dawn: "First light, with a low sun and long shadows across the track.",
  morning: "Mid-morning, with the sun climbing and the track still cool.",
  noon: "The sun is overhead at midday and the shadows are short.",
  afternoon: "A mid-afternoon start, the usual slot for a race.",
  dusk: "The sun sets during the session and the floodlights take over.",
  night: "Midnight, under the floodlights.",
  now: "Starts at the time on your clock right now.",
  random: "The start time is drawn at random when the session starts.",
};

const tyreWords: Record<string, string> = {
  none: "Slick Tyres",
  little: "Intermediates",
  medium: "Full Wets",
  heavy: "Full Wets",
};

const timeOptions: readonly Choice[] = [
  { id: "from track", label: "Circuit Time" },
  ...choices.timeOfDay.filter((c) => c.id !== "from track"),
];

const sessionOptions: readonly Choice[] = [
  { id: "weekend", label: "Race Weekend" },
  { id: "race", label: "Race" },
  { id: "qualifying", label: "Qualifying" },
  { id: "practice", label: "Practice" },
];

const onOff: readonly Choice[] = [
  { id: "on", label: "On" },
  { id: "off", label: "Off" },
];

const gridOptions: readonly Choice[] = Array.from(
  { length: lastSlot + 1 },
  (_, slot) => ({ id: String(slot), label: `P${String(slot + 1)}` }),
);

const difficultyOptions: readonly Choice[] = Array.from(
  { length: difficultyMax - difficultyMin + 1 },
  (_, step) => ({
    id: String(difficultyMin + step),
    label: String(difficultyMin + step),
  }),
);

function trackFor(id: string): Track {
  return tracks.find((t) => t.id === id) ?? tracks[0];
}

function shortName(track: Track): string {
  return track.label.replace(/ Circuit$/, "");
}

function timeLabel(id: string): string {
  if (id === "from track") return "Circuit Time";
  if (id === "now") return "Your Local Time";
  return choices.timeOfDay.find((c) => c.id === id)?.label ?? id;
}

function startText(hour: number | null): string {
  return hour === null ? "Random start" : `Lights out ${clockText(hour)}`;
}

function flag(code: string): HTMLImageElement {
  const image = el("img", "flag");
  image.src = flagUrl(code);
  image.alt = "";
  return image;
}

function image(className: string, url: string): HTMLImageElement {
  const node = el("img", className);
  node.alt = "";
  node.decoding = "async";
  node.src = url;
  return node;
}

function page(kind: string, dir: Dir, ...nodes: HTMLElement[]): HTMLElement {
  const node = el("section", `ev-page ev-${kind}`);
  node.dataset["dir"] = dir;
  node.append(...nodes);
  return node;
}

function iconLine(markup: string, text: string): HTMLElement {
  const item = el("li");
  item.innerHTML = markup;
  item.append(el("span", "", text));
  return item;
}

function raceTag(track: Track): HTMLElement {
  const night = timeOf(track.hour) === "night";
  const tag = el("span", `ev-tag ${night ? "night" : "day"}`);
  tag.innerHTML = weatherSvg("clear", night);
  tag.append(night ? "Night Race" : "Day Race");
  return tag;
}

function tyreChip(rain: string): HTMLElement {
  const item = el("li");
  const suggested = tyresFor(rain);
  for (const compound of compounds)
    if (suggested.includes(compound.id)) {
      const dot = el("i", "ev-tyre-dot");
      dot.style.setProperty("--tyre", compound.colour);
      item.append(dot);
    }
  item.append(el("span", "", tyreWords[rain] ?? "Any Tyre"));
  return item;
}

function tyreWarning(rain: string, compound: string): string {
  const slick = ["soft", "medium", "hard"].includes(compound);
  if (rainLevel(rain) > 0 && slick)
    return "Slicks on a wet track have almost no grip";
  if (rain === "none" && !slick)
    return "Wet-weather tyres overheat quickly on a dry track";
  return "";
}

function shiftRow(
  row: {
    options: readonly Choice[];
    get: () => string;
    set: (id: string) => void;
  },
  delta: number,
): boolean {
  const at = row.options.findIndex((o) => o.id === row.get());
  const next = row.options[at + delta];
  if (!next || delta === 0) return false;
  row.set(next.id);
  return true;
}

function fact(label: string, value: string): HTMLElement {
  const item = el("div");
  item.append(el("dt", "", label), el("dd", "", value));
  return item;
}

export class RaceEvent {
  private done: ((pick: EventPick) => void) | null = null;
  private readonly bests = new Map<string, number>();
  private readonly profile: Promise<void>;

  constructor(
    private readonly screen: FrontScreen,
    private readonly settings: Settings,
  ) {
    for (const track of tracks) outlineOf(track.id).catch(() => undefined);
    this.profile = api.profile().then(
      (profile) => {
        for (const best of profile.bests) {
          const known = this.bests.get(best.track);
          if (known === undefined || best.timeMs < known)
            this.bests.set(best.track, best.timeMs);
        }
      },
      () => undefined,
    );
  }

  run(): Promise<EventPick> {
    this.settings.weatherSeed = newWeatherSeed();
    saveSettings(this.settings);
    return new Promise((resolve) => {
      this.done = resolve;
      this.circuits("next");
    });
  }

  private finish(pick: EventPick): void {
    saveSettings(this.settings);
    const done = this.done;
    this.done = null;
    done?.(pick);
  }

  private track(): Track {
    return trackFor(this.settings.track);
  }

  private hour(): number | null {
    return startHour(this.settings.timeOfDay, this.track().hour, new Date());
  }

  private look(): Look {
    return lookOf(this.settings, this.track().hour, new Date());
  }

  private night(): boolean {
    return timeOf(this.hour() ?? this.track().hour) === "night";
  }

  private stage(): Stage | null {
    const s = this.settings;
    if (s.session === "practice") return null;
    return s.session === "qualifying" ? "qualifying" : "race";
  }

  private plan(): WeatherPlan | null {
    const s = this.settings;
    if (s.rain !== "dynamic") return null;
    return weatherPlan(
      s.weatherSeed,
      sessionSeconds(this.stage(), s.laps, this.track().length),
    );
  }

  private startRain(): string {
    const plan = this.plan();
    return plan ? startRain(plan) : this.settings.rain;
  }

  private forecast(plan: WeatherPlan): string {
    const lap =
      this.stage() === "race" ? lapSeconds(this.track().length) : null;
    return forecastText(plan, lap, this.settings.laps);
  }

  private weatherLine(): string {
    const s = this.settings;
    const plan = this.plan();
    if (plan) return `Forecast: ${this.forecast(plan)}`;
    return `${weatherOf(s).label} · ${surfaceOf(s.rain)} Track`;
  }

  private temperature(): string {
    const s = this.settings;
    if (s.clouds === "random" || s.rain === "random") return "--°C Air";
    const venue = buildUpVenue(s.track);
    const air = airTemperature(
      venue,
      seasonOf(s.season, venue.season),
      rainLevel(s.rain),
      overcastSky(s.clouds),
    );
    return `${String(air)}°C Air`;
  }

  private distance(laps: number): string {
    const track = this.track();
    const km = `${((track.length * laps) / 1000).toFixed(1)} km`;
    const best = this.bests.get(track.id);
    if (best === undefined) return km;
    return `${km} · about ${String(Math.round((best * laps) / 60000))} min`;
  }

  private footer(event: string, ...prompts: FootPrompt[]): HTMLElement {
    const foot = this.screen.footer(...prompts);
    foot.querySelector(".primary")?.setAttribute("data-event", event);
    return foot;
  }

  private stepper(step: number): HTMLElement {
    const s = this.settings;
    const values = [
      shortName(this.track()),
      `${weatherOf(s).label} · ${clockText(this.hour())}`,
    ];
    const open = [
      () => {
        this.circuits("back");
      },
      () => {
        this.conditions("back");
      },
    ];
    const nav = el("nav", "ev-steps");
    stepNames.forEach((name, i) => {
      const item = button("ev-step", "", () => {
        if (i < step) open[i]?.();
      });
      item.dataset["step"] = name;
      item.classList.toggle("current", i === step);
      item.classList.toggle("done", i < step);
      item.append(
        el("i", "", String(i + 1)),
        el("b", "", name),
        el("span", "", i < step ? (values[i] ?? "") : ""),
      );
      nav.append(item);
    });
    return nav;
  }

  private trackFacts(track: Track, metres: number | null): HTMLElement[] {
    const best = this.bests.get(track.id);
    return [
      fact(
        "Circuit Length",
        metres === null ? "--" : `${(metres / 1000).toFixed(3)} km`,
      ),
      fact("Turns", String(buildUpVenue(track.id).turns)),
      fact("Difficulty", track.difficulty),
      fact("Race Start", `${clockText(track.hour)} local`),
      fact(
        "Your Best Lap",
        best === undefined ? "No lap yet" : lapTime(best / 1000),
      ),
    ];
  }

  private slide(track: Track): HTMLElement {
    const venue = buildUpVenue(track.id);
    const slide = el("article", "ev-slide");
    slide.dataset["track"] = track.id;
    const map = el("div", "ev-slide-map");
    const place = el("div", "ev-place");
    place.append(flag(venue.country), el("b", "", venue.event), raceTag(track));
    const title = el("div", "ev-slide-title");
    title.append(
      place,
      el("h2", "", shortName(track)),
      el("p", "", venue.place),
    );
    const media = el("div", "ev-slide-media");
    media.append(image("ev-slide-img", overviewOf(track.id)), map, title);
    const facts = el("dl", "ev-facts");
    slide.append(media, facts);
    let metres: number | null = null;
    const fill = () => {
      facts.replaceChildren(...this.trackFacts(track, metres));
    };
    fill();
    outlineOf(track.id).then(
      (outline) => {
        metres = outline.length;
        map.replaceChildren(outlineSvg(outline, "ev-outline"));
        fill();
      },
      () => undefined,
    );
    void this.profile.then(fill);
    return slide;
  }

  private circuits(dir: Dir): void {
    const s = this.settings;
    let at = Math.max(
      0,
      tracks.findIndex((t) => t.id === s.track),
    );
    const backdrop = el("div", "ev-backdrop");
    const blurs = tracks.map((track) => image("", overviewOf(track.id)));
    backdrop.append(...blurs);
    const belt = el("div", "ev-belt");
    const slides = tracks.map((track, i) => {
      const slide = this.slide(track);
      slide.addEventListener("click", () => {
        if (i === at) confirm();
        else go(i);
      });
      return slide;
    });
    belt.append(...slides);
    const prev = button("ev-arrow prev", "", () => {
      go(at - 1);
    });
    const next = button("ev-arrow next", "", () => {
      go(at + 1);
    });
    prev.setAttribute("aria-label", "Previous circuit");
    next.setAttribute("aria-label", "Next circuit");
    const carousel = el("div", "ev-carousel ev-slidein");
    carousel.append(belt, prev, next);
    const marks = tracks.map((track, i) => {
      const dot = button("ev-dot", "", () => {
        go(i);
      });
      dot.setAttribute("aria-label", track.label);
      return dot;
    });
    const count = el("span", "ev-count");
    const dots = el("div", "ev-dots");
    dots.append(...marks, count);
    const paint = () => {
      belt.style.setProperty("--at", String(at));
      for (const list of [slides, blurs, marks])
        list.forEach((node, i) => {
          node.classList.toggle("active", i === at);
        });
      prev.disabled = at === 0;
      next.disabled = at === tracks.length - 1;
      count.textContent = `${String(at + 1)} / ${String(tracks.length)}`;
    };
    const bump = (side: string) => {
      belt.classList.remove("bump-left", "bump-right");
      belt.getBoundingClientRect();
      belt.classList.add(`bump-${side}`);
    };
    const go = (i: number) => {
      const track = tracks[i];
      if (!track) {
        bump(i < 0 ? "left" : "right");
        return;
      }
      if (i === at) return;
      at = i;
      s.track = track.id;
      saveSettings(s);
      paint();
    };
    const confirm = () => {
      this.conditions("next");
    };
    const back = () => {
      this.finish("back");
    };
    paint();
    this.screen.show(
      {
        ArrowLeft: () => {
          go(at - 1);
        },
        ArrowRight: () => {
          go(at + 1);
        },
        Enter: confirm,
        Escape: back,
      },
      page("circuits", dir, backdrop, this.stepper(0), carousel, dots),
      this.footer(
        "next",
        [
          "←→",
          "Change Circuit",
          () => {
            go((at + 1) % tracks.length);
          },
        ],
        ["↵", "Select Circuit", confirm, true],
        ["Esc", "Back", back],
      ),
    );
  }

  private conditionRows(track: Track): ConditionRow[] {
    const s = this.settings;
    const now = new Date();
    const lookAt = (timeOfDay: string, weather: string) => {
      const preset =
        weatherPresets.find((p) => p.id === weather) ?? weatherPresets[0];
      return lookOf(
        { timeOfDay, clouds: preset.clouds, rain: preset.rain },
        track.hour,
        now,
      );
    };
    return [
      {
        id: "weather",
        title: "Weather",
        options: weatherPresets,
        get: () => weatherOf(s).id,
        set: (id) => {
          applyWeather(s, id);
        },
        look: (id) => lookAt(s.timeOfDay, id),
        caption: (id) =>
          surfaceOf(weatherPresets.find((p) => p.id === id)?.rain ?? ""),
        icon: (id) => weatherSvg(id, this.night()),
        info: (id) => weatherInfo[id] ?? "",
      },
      {
        id: "time",
        title: "Time of Day",
        options: timeOptions,
        get: () => s.timeOfDay,
        set: (id) => {
          s.timeOfDay = id as Settings["timeOfDay"];
        },
        look: (id) => lookAt(id, weatherOf(s).id),
        caption: (id) => clockText(startHour(id, track.hour, now)),
        icon: () => "",
        info: (id) =>
          timeInfo[id] ??
          `The circuit's own start time, ${clockText(track.hour)} local.`,
      },
    ];
  }

  private conditionStrip(
    row: ConditionRow,
    track: Track,
    pick: () => void,
  ): { root: HTMLElement; paint: (focused: boolean) => void } {
    const root = el("div", "ev-strip");
    root.dataset["row"] = row.id;
    const cards = row.options.map((option, i) => {
      const shot = new Shot("", true);
      const icon = el("span", "ev-cond-icon");
      const caption = el("small");
      const node = button("ev-cond", "", () => {
        row.set(option.id);
        pick();
      });
      node.dataset["option"] = option.id;
      node.style.setProperty("--i", String(i));
      const label = el("span", "ev-cond-label");
      label.append(icon, el("b", "", option.label), caption);
      node.append(shot.root, label);
      return { node, shot, icon, caption, option };
    });
    const list = el("div", "ev-strip-cards");
    list.append(...cards.map((card) => card.node));
    root.append(el("h3", "", row.title), list);
    return {
      root,
      paint: (focused) => {
        root.classList.toggle("focus", focused);
        const current = row.get();
        for (const card of cards) {
          card.node.classList.toggle("active", card.option.id === current);
          card.shot.show(track.id, row.look(card.option.id));
          card.icon.innerHTML = row.icon(card.option.id);
          card.caption.textContent = row.caption(card.option.id);
        }
      },
    };
  }

  private conditionHead(
    head: HTMLElement,
    row: ConditionRow | undefined,
  ): void {
    const s = this.settings;
    const track = this.track();
    const venue = buildUpVenue(track.id);
    const weather = weatherOf(s);
    const place = el("div", "ev-place");
    place.append(flag(venue.country), el("b", "", track.label));
    const title = el("h2");
    title.innerHTML = weatherSvg(weather.id, this.night());
    title.append(weather.label);
    const plan = this.plan();
    const chips = el("ul", "ev-chips");
    chips.append(
      iconLine(rowSvg("temp"), this.temperature()),
      iconLine(
        rowSvg("road"),
        plan ? storyText(plan) : `${surfaceOf(s.rain)} Track`,
      ),
      tyreChip(this.startRain()),
    );
    head.replaceChildren(
      place,
      title,
      el(
        "p",
        "ev-cond-time",
        `${timeLabel(s.timeOfDay)} · ${startText(this.hour())}`,
      ),
      chips,
      el("p", "ev-forecast", plan ? this.weatherLine() : ""),
      el("p", "ev-cond-info", row ? row.info(row.get()) : ""),
    );
  }

  private conditions(dir: Dir): void {
    const s = this.settings;
    const track = this.track();
    const rows = this.conditionRows(track);
    let focus = 0;
    const hero = new Shot("ev-hero", false);
    const head = el("div", "ev-cond-head ev-slidein");
    const strips = rows.map((row, at) =>
      this.conditionStrip(row, track, () => {
        focus = at;
        changed();
      }),
    );
    const box = el("div", "ev-strips ev-rise");
    box.append(...strips.map((strip) => strip.root));
    const paint = () => {
      hero.show(track.id, this.look());
      strips.forEach((strip, at) => {
        strip.paint(at === focus);
      });
      this.conditionHead(head, rows[focus]);
    };
    const changed = () => {
      saveSettings(s);
      paint();
    };
    const shift = (delta: number) => {
      const row = rows[focus];
      if (row && shiftRow(row, delta)) changed();
    };
    const row = (at: number) => {
      focus = at;
      paint();
    };
    const next = () => {
      this.raceSettings("next");
    };
    const back = () => {
      this.circuits("back");
    };
    paint();
    this.screen.show(
      {
        ArrowUp: () => {
          row(0);
        },
        ArrowDown: () => {
          row(rows.length - 1);
        },
        ArrowLeft: () => {
          shift(-1);
        },
        ArrowRight: () => {
          shift(1);
        },
        Enter: next,
        Escape: back,
      },
      page(
        "conditions",
        dir,
        hero.root,
        el("div", "ev-shade"),
        this.stepper(1),
        head,
        box,
      ),
      this.footer(
        "next",
        [
          "↑↓",
          "Weather / Time",
          () => {
            row((focus + 1) % rows.length);
          },
        ],
        [
          "←→",
          "Change",
          () => {
            shift(1);
          },
        ],
        ["↵", "Continue", next, true],
        ["Esc", "Back", back],
      ),
    );
  }

  private settingRows(): SettingRow[] {
    const s = this.settings;
    const race = () => s.session === "race" || s.session === "weekend";
    const rows: SettingRow[] = [
      {
        id: "session",
        label: "Session",
        info: "A Race Weekend runs qualifying and then the race from the grid slot you earn. Race goes straight to the grid. Qualifying runs Q1, Q2 and Q3 on their own, and Practice is an open session on your own.",
        options: sessionOptions,
        get: () => s.session,
        set: (id) => {
          s.session = id as Settings["session"];
        },
      },
      {
        id: "qualifying",
        label: "Qualifying",
        info: "In Q1, Q2 and Q3 every car does an out lap and one timed lap, and the slowest six drop out after Q1 and Q2. Skip goes straight to the race and you start from the back.",
        options: choices.qualifying,
        get: () => s.qualifying,
        set: (id) => {
          s.qualifying = id as Settings["qualifying"];
        },
        shown: () => s.session === "weekend",
      },
      {
        id: "rivalLaps",
        label: "Rival Laps",
        info: "Simulate gives the other drivers their times straight away, so you only drive your own laps. Watch sends them out on track one by one.",
        options: choices.rivalLaps,
        get: () => s.rivalLaps,
        set: (id) => {
          s.rivalLaps = id as Settings["rivalLaps"];
        },
        shown: () =>
          s.session === "qualifying" ||
          (s.session === "weekend" && s.qualifying === "run"),
      },
      {
        id: "startSlot",
        label: "Starting Position",
        info: "Where you line up on the grid when there is no qualifying.",
        options: gridOptions,
        get: () => String(s.startSlot),
        set: (id) => {
          s.startSlot = Number(id);
        },
        shown: () => s.session === "race",
      },
      {
        id: "laps",
        label: "Race Distance",
        info: `How many laps the race runs. A full race distance is ${String(raceLaps)} laps.`,
        options: raceLapOptions().map((laps) => ({
          id: String(laps),
          label:
            laps === raceLaps
              ? `${String(laps)} Laps (Full)`
              : `${String(laps)} Laps`,
        })),
        get: () => String(s.laps),
        set: (id) => {
          s.laps = Number(id);
        },
        shown: race,
        note: (id) => this.distance(Number(id)),
      },
      ...this.raceRows(race),
    ];
    return rows.filter((row) => row.shown?.() ?? true);
  }

  private raceRows(race: () => boolean): SettingRow[] {
    const s = this.settings;
    return [
      {
        id: "difficulty",
        label: "AI Difficulty",
        info: "How fast the other 21 drivers are. At 110 the best of them drive at the limit of the car; each step down costs them about a tenth of a second a lap.",
        options: difficultyOptions,
        kind: "meter",
        get: () => String(s.difficulty),
        set: (id) => {
          s.difficulty = Number(id);
        },
        shown: () => s.session !== "practice",
      },
      {
        id: "compound",
        label: "Starting Tyre",
        info: "Soft has the most grip and the shortest life, Medium balances the two and Hard lasts longest. Intermediates and Full Wets clear water and overheat on a dry track.",
        options: compounds,
        kind: "tyre",
        get: () => s.compound,
        set: (id) => {
          s.compound = id;
        },
      },
      {
        id: "tyreWear",
        label: "Tyre Wear",
        info: "Real Life wears tyres at the rate of real stints on this circuit. Race Length speeds wear up so a short race still needs a stop. Off keeps them new.",
        options: choices.tyreWear,
        get: () => s.tyreWear,
        set: (id) => {
          s.tyreWear = id as Settings["tyreWear"];
        },
      },
      {
        id: "startType",
        label: "Race Start",
        info: "A standing start goes when the five red lights go out. A rolling start follows the safety car for a lap and racing begins at the control line.",
        options: choices.startType,
        get: () => s.startType,
        set: (id) => {
          s.startType = id as Settings["startType"];
        },
        shown: race,
      },
      {
        id: "buildUp",
        label: "Pre-Race Build-Up",
        info: "Plays the circuit preview, the track map and the starting grid before the session.",
        options: onOff,
        get: () => (s.buildUp ? "on" : "off"),
        set: (id) => {
          s.buildUp = id === "on";
        },
      },
    ];
  }

  private tyreFace(row: SettingRow, changed: () => void): Painted {
    const root = el("div", "ev-row-face ev-tyres");
    const picks = compounds.map((compound) => {
      const pick = button("ev-tyre-pick", "", () => {
        row.set(compound.id);
        changed();
      });
      pick.dataset["tyre"] = compound.id;
      pick.setAttribute("aria-label", compound.label);
      pick.innerHTML = tyreSvg(compound.letter, compound.colour);
      return pick;
    });
    const name = el("b", "ev-tyre-name");
    const weather = el("small", "ev-tyre-weather");
    root.append(...picks, name, weather);
    return {
      root,
      paint: () => {
        weather.innerHTML = weatherSvg(
          weatherOf(this.settings).id,
          this.night(),
        );
        weather.append(this.weatherLine());
        const suggested = tyresFor(this.startRain());
        const hint = suggested.length < compounds.length;
        picks.forEach((pick, i) => {
          const id = compounds[i]?.id ?? "";
          pick.classList.toggle("active", id === row.get());
          pick.classList.toggle("suggested", hint && suggested.includes(id));
        });
        name.textContent =
          compounds.find((c) => c.id === row.get())?.label ?? "";
      },
    };
  }

  private face(row: SettingRow, changed: () => void): Painted {
    if (row.kind === "tyre") return this.tyreFace(row, changed);
    const root = el("div", "ev-row-face");
    const value = el("b");
    const note = el("small");
    const fill = el("i");
    root.append(value, note);
    if (row.kind === "meter") {
      const meter = el("span", "ev-meter");
      meter.append(fill);
      root.append(meter);
    }
    return {
      root,
      paint: () => {
        const at = row.options.findIndex((o) => o.id === row.get());
        value.textContent = row.options[at]?.label ?? row.get();
        note.textContent = row.note?.(row.get()) ?? "";
        fill.style.setProperty(
          "--fill",
          String(Math.max(0, at) / Math.max(1, row.options.length - 1)),
        );
      },
    };
  }

  private settingRow(
    row: SettingRow,
    select: () => void,
    step: (delta: number) => void,
    changed: () => void,
  ): { node: HTMLElement; paint: (focused: boolean) => void } {
    const node = el("div", `ev-row ${row.kind ?? ""}`.trim());
    node.dataset["row"] = row.id;
    node.addEventListener("click", select);
    const face = this.face(row, changed);
    const less = button("ev-row-step less", "", () => {
      step(-1);
    });
    const more = button("ev-row-step more", "", () => {
      step(1);
    });
    less.setAttribute("aria-label", `Previous ${row.label}`);
    more.setAttribute("aria-label", `Next ${row.label}`);
    const value = el("div", "ev-row-value");
    value.append(less, face.root, more);
    node.append(el("span", "ev-row-label", row.label), value);
    return {
      node,
      paint: (focused) => {
        node.classList.toggle("focus", focused);
        const at = row.options.findIndex((o) => o.id === row.get());
        less.disabled = at <= 0;
        more.disabled = at >= row.options.length - 1;
        face.paint();
      },
    };
  }

  private summary(track: Track): Painted {
    const s = this.settings;
    const venue = buildUpVenue(track.id);
    const shot = new Shot("ev-sum-shot", false);
    shot.show(track.id, this.look());
    const map = el("div", "ev-sum-map");
    outlineOf(track.id).then(
      (outline) => {
        map.replaceChildren(outlineSvg(outline, "ev-outline"));
      },
      () => undefined,
    );
    const media = el("div", "ev-sum-media");
    media.append(shot.root, map);
    const place = el("div", "ev-place");
    place.append(flag(venue.country), el("b", "", venue.event));
    const list = el("ul", "ev-sum-list");
    const tyre = el("div", "ev-sum-tyre");
    const body = el("div", "ev-sum-body");
    body.append(place, el("h3", "", shortName(track)), list, tyre);
    const root = el("aside", "ev-summary ev-slidein");
    root.append(media, body);
    return {
      root,
      paint: () => {
        const weather = weatherOf(s);
        const race = s.session === "race" || s.session === "weekend";
        list.replaceChildren(
          iconLine(weatherSvg(weather.id, this.night()), this.weatherLine()),
          iconLine(
            rowSvg("clock"),
            `${timeLabel(s.timeOfDay)} · ${startText(this.hour())}`,
          ),
          iconLine(rowSvg("temp"), this.temperature()),
          iconLine(
            rowSvg("flag"),
            race
              ? `${sessionSummary(s)} · ${this.distance(s.laps)}`
              : sessionSummary(s),
          ),
        );
        const compound =
          compounds.find((c) => c.id === s.compound) ?? compounds[1];
        const words = el("div");
        words.append(
          el("b", "", `Starting on ${compound.label}`),
          el("span", "ev-warn", tyreWarning(this.startRain(), compound.id)),
        );
        tyre.innerHTML = tyreSvg(compound.letter, compound.colour);
        tyre.append(words);
      },
    };
  }

  private raceSettings(dir: Dir): void {
    const s = this.settings;
    const track = this.track();
    const hero = new Shot("ev-hero blurred", false);
    hero.show(track.id, this.look());
    const summary = this.summary(track);
    const list = el("div", "ev-rows-list");
    const info = el("p", "ev-row-info");
    const panel = el("section", "ev-rows ev-slidein");
    panel.append(list, info);
    let focus = 0;
    let shape = "";
    let built: {
      row: SettingRow;
      paint: (focused: boolean) => void;
    }[] = [];
    const paint = () => {
      const rows = this.settingRows();
      const ids = rows.map((r) => r.id).join();
      if (ids !== shape) {
        shape = ids;
        const made = rows.map((row, i) => ({
          row,
          ...this.settingRow(
            row,
            () => {
              select(i);
            },
            (delta) => {
              focus = i;
              shift(delta);
            },
            changed,
          ),
        }));
        built = made;
        list.replaceChildren(...made.map((b) => b.node));
      }
      focus = Math.min(focus, built.length - 1);
      built.forEach((b, i) => {
        b.paint(i === focus);
      });
      info.textContent = built[focus]?.row.info ?? "";
      summary.paint();
    };
    const changed = () => {
      saveSettings(s);
      paint();
    };
    const select = (i: number) => {
      focus = i;
      paint();
    };
    const shift = (delta: number) => {
      const row = built[focus]?.row;
      if (row && shiftRow(row, delta)) changed();
      else paint();
    };
    const move = (delta: number) => {
      select(Math.max(0, Math.min(built.length - 1, focus + delta)));
    };
    const start = () => {
      this.finish("start");
    };
    const back = () => {
      this.conditions("back");
    };
    paint();
    void this.profile.then(paint);
    this.screen.show(
      {
        ArrowUp: () => {
          move(-1);
        },
        ArrowDown: () => {
          move(1);
        },
        ArrowLeft: () => {
          shift(-1);
        },
        ArrowRight: () => {
          shift(1);
        },
        Enter: start,
        Escape: back,
      },
      page(
        "settings",
        dir,
        hero.root,
        el("div", "ev-shade"),
        this.stepper(2),
        panel,
        summary.root,
      ),
      this.footer(
        "start",
        [
          "↑↓",
          "Select",
          () => {
            move(1);
          },
        ],
        [
          "←→",
          "Change",
          () => {
            shift(1);
          },
        ],
        ["↵", "Start Session", start, true],
        ["Esc", "Back", back],
      ),
    );
  }
}
