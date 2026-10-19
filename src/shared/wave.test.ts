import { describe, it, expect } from "vitest";
import { buildWavePath } from "./wave";

// Samples a path made only of M and C commands back into points, so the
// emitted curve can be compared against the sine it is meant to trace.
function sampleCubics(d: string, per = 12): Array<[number, number]> {
  const nums = (s: string) => s.trim().split(/[\s,]+/).map(Number);
  const segs = d.split(/(?=[MC])/).filter(Boolean);
  const [startX, startY] = nums(segs[0].slice(1));
  let cur: [number, number] = [startX, startY];
  const out: Array<[number, number]> = [cur];
  for (const seg of segs.slice(1)) {
    const [c1x, c1y, c2x, c2y, x, y] = nums(seg.slice(1));
    const [p0x, p0y] = cur;
    for (let i = 1; i <= per; i++) {
      const t = i / per;
      const u = 1 - t;
      out.push([
        u * u * u * p0x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x,
        u * u * u * p0y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y,
      ]);
    }
    cur = [x, y];
  }
  return out;
}

const AMPLITUDE = 3.5;
const WAVELENGTH = 24;
const MID_Y = 10;
const sine = (x: number, phase: number) =>
  MID_Y + AMPLITUDE * Math.sin((x / WAVELENGTH) * 2 * Math.PI + phase);

describe("buildWavePath", () => {
  it("returns nothing for a zero or negative width", () => {
    expect(buildWavePath(0, 0, AMPLITUDE, WAVELENGTH, 0, MID_Y)).toBe("");
    expect(buildWavePath(0, -10, AMPLITUDE, WAVELENGTH, 0, MID_Y)).toBe("");
  });

  it("draws curves rather than straight chords", () => {
    const d = buildWavePath(0, 96, AMPLITUDE, WAVELENGTH, 0, MID_Y);
    expect(d).toMatch(/^M/);
    expect(d).toContain("C");
    expect(d).not.toContain("L");
  });

  it("tracks the sine to well under a pixel", () => {
    for (const phase of [0, 0.7, 2.4, -1.9]) {
      const d = buildWavePath(0, 200, AMPLITUDE, WAVELENGTH, phase, MID_Y);
      for (const [x, y] of sampleCubics(d)) {
        expect(Math.abs(y - sine(x, phase))).toBeLessThan(0.05);
      }
    }
  });

  it("keeps the two halves of a split wave meeting exactly", () => {
    // The cards draw the active and track halves as separate paths; the seam
    // between them has to be invisible at any split point.
    for (const split of [37.5, 61.2, 100]) {
      const left = buildWavePath(0, split, AMPLITUDE, WAVELENGTH, 0.5, MID_Y);
      const right = buildWavePath(split, 40, AMPLITUDE, WAVELENGTH, 0.5, MID_Y);
      const leftPoints = sampleCubics(left);
      const leftEnd = leftPoints[leftPoints.length - 1];
      const rightStart = sampleCubics(right)[0];
      expect(rightStart[0]).toBeCloseTo(leftEnd[0], 2);
      expect(rightStart[1]).toBeCloseTo(leftEnd[1], 2);
    }
  });

  it("collapses to a flat line at zero amplitude", () => {
    const d = buildWavePath(0, 60, 0, WAVELENGTH, 1.1, MID_Y);
    for (const [, y] of sampleCubics(d)) expect(y).toBeCloseTo(MID_Y, 6);
  });
});

/**
 * The second argument is a WIDTH, not an end coordinate. Every call site but
 * one starts at 0, where the two are the same number — so the one that did
 * not drew its segment for the length of the whole bar and ran off the edge
 * (the media card's indeterminate progress wave). Pinned here because the
 * signature makes the mistake easy and the symptom is only visible on screen.
 */
describe("buildWavePath: the second argument is a width", () => {
  function letztesX(d: string): number {
    const züge = d.trim().split(/(?=[MC])/);
    const letzter = züge[züge.length - 1];
    const zahlen = (letzter.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    return zahlen[zahlen.length - 2];
  }

  it("ends at startX + width when it starts at zero", () => {
    expect(letztesX(buildWavePath(0, 120, 3, 20, 0, 10))).toBeCloseTo(120, 1);
  });

  it("ends at startX + width when it starts somewhere else", () => {
    // The function was always right; the caller passed an end coordinate as
    // the width. From 452 the travelling segment is 18 wide and must stop at
    // 470 — it used to be asked for 470 of width and ran to 922.
    expect(letztesX(buildWavePath(60, 120, 3, 20, 0, 10))).toBeCloseTo(180, 1);
    expect(letztesX(buildWavePath(452, 18, 3, 20, 0, 10))).toBeCloseTo(470, 1);
  });

  it("starts where it is told to", () => {
    expect(buildWavePath(452, 18, 3, 20, 0, 10).startsWith("M452.00,")).toBe(true);
  });
});
