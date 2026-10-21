import { describe, expect, it, vi } from "vitest";
import {
  clipSegments,
  countChanges,
  fetchStateTimeline,
  historyToSegments,
  startOfDay,
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
  it("reaches back to midnight when the range is shorter than today", async () => {
    const now = new Date(2026, 9, 21, 15, 0, 0).getTime();
    const callWS = vi.fn(async () => ({ "binary_sensor.d": [{ s: "off", lu: (now - 86_400_000) / 1000 }] }));
    const hass = { callWS } as unknown as HomeAssistant;
    const tl = await fetchStateTimeline(hass, "binary_sensor.d", "1h", now);
    expect(tl.source).toBe("history");
    const msg = (callWS.mock.calls[0] as unknown[])[0] as { start_time: string };
    expect(Date.parse(msg.start_time)).toBe(startOfDay(now));
  });

  it("reports none when there is nothing", async () => {
    const hass = { callWS: vi.fn(async () => ({})) } as unknown as HomeAssistant;
    expect((await fetchStateTimeline(hass, "x.y", "24h")).source).toBe("none");
  });
});
