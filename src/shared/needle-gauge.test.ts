import { describe, expect, it } from "vitest";
import {
  angleOf,
  arcPieces,
  compactTick,
  fractionOf,
  resolveSegments,
  segmentFor,
  springSettled,
  springStep,
  tickValues,
} from "./needle-gauge";

const SEGS = [
  { from: 0, color: "green", label: "Normal" },
  { from: 1500, color: "orange", label: "Erhöht" },
  { from: 3000, color: "red", label: "Hoch" },
];

describe("needle gauge scale", () => {
  it("clamps past either end, so the needle rests at the stop", () => {
    expect(fractionOf(-200, 0, 4000)).toBe(0);
    expect(fractionOf(5000, 0, 4000)).toBe(1);
    expect(fractionOf(2000, 0, 4000)).toBe(0.5);
    expect(angleOf(0)).toBe(-135);
    expect(angleOf(1)).toBe(135);
  });

  it("turns the ranges into closed intervals", () => {
    const segs = resolveSegments(SEGS, 0, 4000, "x");
    expect(segs.map((s) => [s.from, s.to, s.label])).toEqual([
      [0, 1500, "Normal"],
      [1500, 3000, "Erhöht"],
      [3000, 4000, "Hoch"],
    ]);
    expect(resolveSegments([], 0, 100, "c")).toEqual([{ from: 0, to: 100, color: "c" }]);
  });

  it("finds the range at the boundaries and outside", () => {
    const segs = resolveSegments(SEGS, 0, 4000, "x");
    expect(segmentFor(1499.9, segs)?.label).toBe("Normal");
    expect(segmentFor(1500, segs)?.label).toBe("Erhöht");
    expect(segmentFor(3000, segs)?.label).toBe("Hoch");
    expect(segmentFor(9000, segs)?.label).toBe("Hoch");
    expect(segmentFor(-5, segs)?.label).toBe("Normal");
  });

  it("fills up to the value and leaves the rest as track", () => {
    const segs = resolveSegments(SEGS, 0, 4000, "x");
    const { track, fill } = arcPieces(segs, 0, 4000, fractionOf(2350, 0, 4000), 2, 4);
    expect(track).toHaveLength(3);
    expect(fill.map((p) => p.color)).toEqual(["green", "orange"]);
    expect(fill[1].toDeg).toBeCloseTo(angleOf(2350 / 4000), 5);
    // The gap between two ranges is wider than the caps.
    expect(track[1].fromDeg - track[0].toDeg).toBeCloseTo(2 + 8, 5);
  });

  it("ticks and compact labels", () => {
    expect(tickValues(0, 4000, 5)).toEqual([0, 1000, 2000, 3000, 4000]);
    expect(compactTick(2000, "de")).toBe("2k");
    expect(compactTick(2500, "de")).toBe("2,5k");
    expect(compactTick(40, "en")).toBe("40");
  });

  it("springs past the target and settles on it", () => {
    let s = { pos: 0, vel: 0 };
    let peak = 0;
    for (let i = 0; i < 240; i++) {
      s = springStep(s.pos, s.vel, 1, 1 / 60);
      peak = Math.max(peak, s.pos);
    }
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.1);
    expect(springSettled(s.pos, s.vel, 1)).toBe(true);
  });
});
