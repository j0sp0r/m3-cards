import { describe, expect, it, vi } from "vitest";
import {
  clipSegments,
  countChanges,
  fetchStateTimeline,
  subscribeStateTimeline,
  historyToSegments,
  stateShares,
} from "./state-timeline";
import type { HomeAssistant } from "../types";

const MIN = 60_000;

describe("historyToSegments", () => {
  it("pulls the opening row to the start, merges repeats, runs the last one to now", () => {
    const start = 100 * MIN;
    const segs = historyToSegments(
      [
        { s: "off", lu: (start - 500 * MIN) / 1000 },
        { s: "on", lu: (start + 10 * MIN) / 1000 },
        { s: "on", lu: (start + 15 * MIN) / 1000 },
        { s: "off", lu: (start + 20 * MIN) / 1000 },
      ],
      start,
      start + 60 * MIN,
    );
    expect(segs).toEqual([
      { state: "off", from: start, to: start + 10 * MIN },
      { state: "on", from: start + 10 * MIN, to: start + 20 * MIN },
      { state: "off", from: start + 20 * MIN, to: start + 60 * MIN },
    ]);
  });
});

describe("stateShares and countChanges", () => {
  const segs = [
    { state: "off", from: 0, to: 10 },
    { state: "on", from: 10, to: 15 },
    { state: "unavailable", from: 15, to: 20 },
    { state: "on", from: 20, to: 30 },
    { state: "off", from: 30, to: 40 },
  ];

  it("adds up time per state, longest first, without the gaps", () => {
    expect(stateShares(segs, 0, 40)).toEqual([
      { state: "off", ms: 20, count: 2 },
      { state: "on", ms: 15, count: 2 },
    ]);
  });

  it("does not count a dropout back into the same state as a change", () => {
    expect(countChanges(segs, 0, 40)).toBe(2);
    expect(countChanges(segs, 25, 40)).toBe(1);
  });

  it("clips at the window", () => {
    expect(clipSegments(segs, 12, 22)).toEqual([
      { state: "on", from: 12, to: 15 },
      { state: "unavailable", from: 15, to: 20 },
      { state: "on", from: 20, to: 22 },
    ]);
  });
});

describe("fetchStateTimeline", () => {
  it("reads exactly the period on screen", async () => {
    const now = new Date(2026, 9, 21, 15, 0, 0).getTime();
    const callWS = vi.fn(async () => ({ "binary_sensor.d": [{ s: "off", lu: (now - 86_400_000) / 1000 }] }));
    const hass = { callWS } as unknown as HomeAssistant;
    const tl = await fetchStateTimeline(hass, "binary_sensor.d", "1h", now);
    expect(tl.source).toBe("history");
    const msg = (callWS.mock.calls[0] as unknown[])[0] as { start_time: string };
    expect(Date.parse(msg.start_time)).toBe(now - 3_600_000);
  });

  it("reports none when there is nothing", async () => {
    const hass = { callWS: vi.fn(async () => ({})) } as unknown as HomeAssistant;
    expect((await fetchStateTimeline(hass, "x.y", "24h")).source).toBe("none");
  });
});

describe("subscribeStateTimeline", () => {
  it("builds the timeline from the stream and grows it with every new state", async () => {
    const now = Date.now();
    let push: ((msg: unknown) => void) | undefined;
    const unsub = vi.fn();
    const hass = {
      connection: {
        subscribeMessage: vi.fn(async (cb: (msg: unknown) => void, msg: Record<string, unknown>) => {
          push = cb;
          expect(msg.type).toBe("history/stream");
          return unsub;
        }),
      },
    } as unknown as HomeAssistant;
    const seen: number[] = [];
    const stop = subscribeStateTimeline(hass, "switch.s", "24h", (t) => seen.push(t.segments.length), now);
    await Promise.resolve();
    push!({ states: { "switch.s": [{ s: "off", lu: (now - 3_600_000) / 1000 }] } });
    push!({ states: { "switch.s": [{ s: "on", lu: (now - 60_000) / 1000 }] } });
    push!({ states: { "switch.s": [{ s: "off", lu: (now - 30_000) / 1000 }] } });
    expect(seen).toEqual([1, 2, 3]);
    await Promise.resolve();
    stop();
    expect(unsub).toHaveBeenCalled();
  });

  it("reads once when there is no websocket to stream from", async () => {
    const callWS = vi.fn(async () => ({}));
    const done = new Promise<string>((resolve) =>
      subscribeStateTimeline({ callWS } as unknown as HomeAssistant, "x.y", "1h", (t) => resolve(t.source)),
    );
    expect(await done).toBe("none");
  });
});
