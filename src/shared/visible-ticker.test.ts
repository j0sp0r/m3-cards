import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VisibleTicker } from "./visible-ticker";

describe("VisibleTicker at frame cadence", () => {
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal("document", { hidden: false, addEventListener: () => {}, removeEventListener: () => {} });
  });

  afterEach(() => vi.unstubAllGlobals());

  /** Runs whatever frame is queued, as the browser would. */
  const nextFrame = () => frames.shift()?.(0);

  it("keeps ticking while nothing stops it", () => {
    let ticks = 0;
    const ticker = new VisibleTicker({} as HTMLElement, () => ticks++);
    ticker.setCadence("frame");
    ticker.connect();
    const before = ticks;
    nextFrame();
    nextFrame();
    expect(ticks - before).toBe(2);
    expect(frames.length).toBe(1);
    ticker.disconnect();
  });

  it("stops for good when the callback disconnects it", () => {
    // An animation that has settled stops its own ticker. The next frame used
    // to be scheduled after that stop, so the loop ran on with nothing left to
    // cancel it.
    let ticks = 0;
    const ticker: VisibleTicker = new VisibleTicker({} as HTMLElement, () => {
      ticks++;
      if (ticks >= 2) ticker.disconnect();
    });
    ticker.setCadence("frame");
    ticker.connect();
    for (let i = 0; i < 5; i++) nextFrame();
    expect(ticker.running).toBe(false);
    expect(frames.length).toBe(0);
  });
});

describe("VisibleTicker at ten-second cadence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T12:00:03Z"));
    vi.stubGlobal("document", { hidden: false, addEventListener: () => {}, removeEventListener: () => {} });
    vi.stubGlobal("window", globalThis);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("ticks on each ten-second boundary", () => {
    const at: number[] = [];
    const ticker = new VisibleTicker({} as HTMLElement, (now) => at.push(now));
    ticker.setCadence("ten-seconds");
    ticker.connect();
    at.length = 0; // the tick on connect
    vi.advanceTimersByTime(30_000);
    expect(at.map((t) => Math.floor((t % 60_000) / 1000))).toEqual([10, 20, 30]);
    ticker.disconnect();
  });
});
