const shortestFrame = 6.5;
const longestFrame = 100;
const slowestRefresh = 17.5;
const windowFrames = 48;
const settleFrames = 72;
const slowShare = 1.2;
const easyShare = 1.06;
const easyWindows = 3;
const patientWindows = 48;
const downStep = 0.92;
const upStep = 1.04;
const lowestScale = 0.8;

export class RefreshProbe {
  private shortest = Infinity;
  private last = 0;
  private running = true;

  constructor(frame: (callback: (now: number) => void) => void) {
    const step = (now: number) => {
      if (!this.running) return;
      const gap = now - this.last;
      if (this.last > 0 && gap >= shortestFrame && gap < this.shortest)
        this.shortest = gap;
      this.last = now;
      frame(step);
    };
    frame(step);
  }

  stop(): number {
    this.running = false;
    return Math.min(this.shortest, slowestRefresh);
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

export class FrameGovernor {
  private readonly gaps: number[] = [];
  private last = 0;
  private wait = settleFrames;
  private easy = 0;
  private needed = easyWindows;
  private raised = false;
  private current = 1;

  constructor(
    private readonly refresh: number,
    private readonly apply: (scale: number) => void,
    private readonly enabled = true,
  ) {}

  get scale(): number {
    return this.current;
  }

  tick(now: number): void {
    if (!this.enabled) return;
    const typical = this.window(now);
    if (typical === null) return;
    if (typical > this.refresh * slowShare) this.slower();
    else if (typical > this.refresh * easyShare) this.steady();
    else this.easier();
  }

  private window(now: number): number | null {
    const gap = now - this.last;
    this.last = now;
    if (gap <= 0 || gap > longestFrame) return null;
    if (this.wait > 0) {
      this.wait--;
      return null;
    }
    this.gaps.push(gap);
    if (this.gaps.length < windowFrames) return null;
    const typical = median(this.gaps);
    this.gaps.length = 0;
    return typical;
  }

  private slower(): void {
    this.easy = 0;
    if (this.raised) this.needed = Math.min(patientWindows, this.needed * 2);
    this.raised = false;
    this.change(Math.max(lowestScale, this.current * downStep));
  }

  private steady(): void {
    this.raised = false;
    this.easy = 0;
  }

  private easier(): void {
    this.raised = false;
    if (++this.easy < this.needed) return;
    this.easy = 0;
    if (this.current >= 1) return;
    this.raised = true;
    this.change(Math.min(1, this.current * upStep));
  }

  pause(): void {
    this.last = 0;
    this.gaps.length = 0;
    this.wait = settleFrames;
  }

  private change(scale: number): void {
    if (Math.abs(scale - this.current) < 1e-3) return;
    this.current = scale;
    this.wait = settleFrames;
    this.apply(scale);
  }
}
