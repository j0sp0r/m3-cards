import { describe, it, expect } from "vitest";
import { pushPoint, sparklinePath, takeEvenly } from "./router-sparkline";

describe("pushPoint", () => {
  it("keeps the series bounded, dropping the oldest", () => {
    let s: number[] = [];
    for (let i = 0; i < 10; i++) s = pushPoint(s, i, 4);
    expect(s).toEqual([6, 7, 8, 9]);
  });

  it("returns a new array so Lit notices", () => {
    const a = [1, 2];
    const b = pushPoint(a, 3, 10);
    expect(b).not.toBe(a);
    expect(a).toEqual([1, 2]);
  });

  it("refuses a non-number rather than poisoning the scale", () => {
    expect(pushPoint([1, 2], NaN, 10)).toEqual([1, 2]);
  });
});

describe("sparklinePath", () => {
  it("draws nothing with fewer than two points", () => {
    expect(sparklinePath([], 100, 20)).toBe("");
    expect(sparklinePath([5], 100, 20)).toBe("");
  });

  it("spans the full width", () => {
    const d = sparklinePath([1, 2, 3], 100, 20);
    expect(d.startsWith("M0.00 ")).toBe(true);
    expect(d).toContain("L100.00 ");
  });

  it("puts the maximum at the top and the zero at the bottom", () => {
    const d = sparklinePath([0, 10], 100, 20);
    const ys = [...d.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]));
    expect(ys[0]).toBeCloseTo(19.5); // floor, half a stroke in
    expect(ys[1]).toBeCloseTo(0.5); // ceiling, half a stroke in
  });

  it("draws a flat floor rather than dividing by zero", () => {
    const d = sparklinePath([0, 0, 0], 100, 20);
    expect(d).toBe("M0 20.00L100.00 20.00");
    expect(d).not.toContain("NaN");
  });

  it("never emits NaN for a negative reading", () => {
    expect(sparklinePath([-5, 10], 100, 20)).not.toContain("NaN");
  });

  it("can be pinned to an external peak", () => {
    const local = sparklinePath([0, 10], 100, 20);
    const pinned = sparklinePath([0, 10], 100, 20, 100);
    expect(pinned).not.toBe(local);
    const y = Number(/L[\d.]+ ([\d.]+)/.exec(pinned)![1]);
    expect(y).toBeGreaterThan(17); // 10 % of the pinned scale, near the floor
  });
});

describe("takeEvenly", () => {
  it("passes a short series through untouched", () => {
    expect(takeEvenly([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });

  it("spreads the samples across the whole window, not just the end", () => {
    const long = Array.from({ length: 600 }, (_, i) => i);
    const out = takeEvenly(long, 40);
    expect(out).toHaveLength(40);
    expect(out[0]).toBe(0);
    expect(out[39]).toBe(599);
  });

  it("returns nothing when asked for nothing", () => {
    expect(takeEvenly([1, 2, 3], 0)).toEqual([]);
  });
});
