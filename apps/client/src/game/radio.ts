import type { RadioCall } from "./engineer.ts";
import { putAttr, putData, putText } from "./hud-dom.ts";

const queueSize = 4;
const staleAfter = 12;
const urgentStale = 25;
const urgent = 4;
const minShown = 3.2;
const perWord = 0.36;
const gapAfter = 0.6;
const speechGrace = 8;

interface Queued extends RadioCall {
  at: number;
}

function shownFor(text: string): number {
  return Math.max(minShown, text.split(/\s+/).length * perWord + 1);
}

export function nextCall(queue: Queued[], now: number): Queued | null {
  const fresh = queue.filter(
    (call) =>
      now - call.at <= (call.priority >= urgent ? urgentStale : staleAfter),
  );
  queue.splice(0, queue.length, ...fresh);
  if (queue.length === 0) return null;
  let best = 0;
  queue.forEach((call, i) => {
    const top = queue[best];
    if (top && call.priority > top.priority) best = i;
  });
  return queue.splice(best, 1)[0] ?? null;
}

function englishVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === "en-GB" && v.localService) ??
    voices.find((v) => v.lang.startsWith("en-GB")) ??
    voices.find((v) => v.lang.startsWith("en")) ??
    null
  );
}

export class Radio {
  private readonly queue: Queued[] = [];
  private shownUntil = 0;
  private speaking = false;
  private muted = false;
  private current: Queued | null = null;
  private readonly text: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly voice: () => {
      on: boolean;
      volume: number;
      subtitles: boolean;
    },
  ) {
    root.innerHTML = `
      <div class="radio-icon" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
      <div class="radio-body"><small>Race Engineer</small><b data-radio="text"></b></div>`;
    const text = root.querySelector<HTMLElement>("[data-radio=text]");
    if (!text) throw new Error("radio panel has no text");
    this.text = text;
    root.hidden = true;
  }

  push(calls: RadioCall[], now: number): void {
    for (const call of calls) {
      if (call.priority >= urgent && this.current) this.interrupt();
      this.queue.push({ ...call, at: now });
    }
    while (this.queue.length > queueSize) {
      const lowest = this.queue.reduce(
        (low, call, i) =>
          call.priority < (this.queue[low]?.priority ?? Infinity) ? i : low,
        0,
      );
      this.queue.splice(lowest, 1);
    }
  }

  get last(): string {
    return this.current?.text ?? "";
  }

  mute(muted: boolean): void {
    this.muted = muted;
    if (muted) this.interrupt();
  }

  update(now: number): void {
    if (this.muted) return;
    const talking = this.talking(now);
    if (this.current && (now < this.shownUntil || talking)) return;
    if (this.current) {
      this.current = null;
      this.root.classList.remove("show");
      this.shownUntil = now + gapAfter;
      return;
    }
    if (now < this.shownUntil) return;
    const call = nextCall(this.queue, now);
    if (!call) {
      this.root.hidden = true;
      return;
    }
    this.show(call, now);
  }

  private show(call: Queued, now: number): void {
    this.current = call;
    this.shownUntil = now + shownFor(call.text);
    this.root.hidden = !this.voice().subtitles;
    putData(this.root, "tone", call.tone);
    putText(this.text, call.text);
    this.root.classList.remove("show");
    void this.root.getBoundingClientRect();
    this.root.classList.add("show");
    this.speak(call.text);
  }

  private interrupt(): void {
    this.current = null;
    this.shownUntil = 0;
    this.root.classList.remove("show");
    if (this.speaking) this.silence();
  }

  private talking(now: number): boolean {
    if (this.speaking && !this.voice().on) this.silence();
    return this.speaking && now < this.shownUntil + speechGrace;
  }

  private silence(): void {
    window.speechSynthesis.cancel();
    this.speaking = false;
  }

  private speak(text: string): void {
    const { on, volume } = this.voice();
    if (!on || volume <= 0 || !("speechSynthesis" in window)) return;
    const line = new SpeechSynthesisUtterance(text);
    line.voice = englishVoice();
    line.lang = line.voice?.lang ?? "en-GB";
    line.rate = 1.1;
    line.pitch = 0.92;
    line.volume = Math.min(1, volume / 100);
    this.speaking = true;
    const done = () => {
      this.speaking = false;
    };
    line.onend = done;
    line.onerror = done;
    window.speechSynthesis.speak(line);
  }
}

export class VoiceSwitch {
  constructor(
    private readonly tab: HTMLElement,
    private readonly settings: { engineerVoice: boolean },
    private readonly save: () => void,
  ) {
    tab.addEventListener("click", () => {
      tab.blur();
      this.toggle();
    });
    this.paint();
  }

  toggle(): void {
    this.settings.engineerVoice = !this.settings.engineerVoice;
    this.save();
    this.paint();
  }

  paint(): void {
    const on = this.settings.engineerVoice;
    putData(this.tab, "voice", on ? "on" : "off");
    putAttr(this.tab, "aria-pressed", String(on));
    putAttr(
      this.tab,
      "title",
      on
        ? "Engineer voice on - V to mute"
        : "Engineer voice off - V to hear it",
    );
  }
}
