import { describe, expect, it } from "vitest";
import { summarizeConsumption } from "./supply-history";

const DAY = 86400000;
const now = Date.UTC(2026, 9, 31);
const start = now - 30 * DAY;
/** A history from [days ago, value] pairs, in the History API's minimal shape. */
const hist = (pairs: [number, number][]) => pairs.map(([d, v]) => ({ s: String(v), lu: (now - d * DAY) / 1000 }));

describe("summarizeConsumption", () => {
  it("counts one-at-a-time use", () => {
    const r = summarizeConsumption(hist([[10, 30], [8, 29], [6, 28], [4, 27], [2, 26]]), start, now, 3, 2);
    expect(r.events).toBe(4);
    expect(r.perDay).toBeCloseTo(4 / 10);
  });

  it("ignores a refill", () => {
    const r = summarizeConsumption(hist([[10, 3], [8, 2], [6, 60], [4, 59], [2, 58]]), start, now, 3, 2);
    expect(r.events).toBe(3);
    expect(r.perDay).toBeCloseTo(3 / 10);
  });

  it("ignores a correction made by hand", () => {
    // 46 set to 25 by hand is not 21 tablets used: only the single steps count
    const r = summarizeConsumption(hist([[10, 46], [9, 25], [7, 24], [5, 23], [3, 22]]), start, now, 3, 2);
    expect(r.events).toBe(3);
    expect(r.perDay).toBeCloseTo(3 / 10);
  });
});
