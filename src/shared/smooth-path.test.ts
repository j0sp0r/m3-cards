import { describe, expect, it } from "vitest";
import { monotoneArea, monotonePath, monotoneTangents, type XY } from "./smooth-path";

/** Samples the cubic Bézier of segment i the way monotonePath builds it. */
function sampleSegment(points: XY[], i: number, steps = 50): number[] {
  const m = monotoneTangents(points);
  const p = points[i];
  const q = points[i + 1];
  const h = (q.x - p.x) / 3;
  const y0 = p.y;
  const y1 = p.y + h * m[i];
  const y2 = q.y - h * m[i + 1];
  const y3 = q.y;
  const out: number[] = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const u = 1 - t;
    out.push(u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
  }
  return out;
}

describe("monotonePath", () => {
  it("never leaves the range of the two points it joins", () => {
    // A step and a spike: exactly where Catmull-Rom overshoots.
    const pts: XY[] = [
      { x: 0, y: 50 },
      { x: 10, y: 50 },
      { x: 20, y: 10 },
      { x: 30, y: 12 },
      { x: 40, y: 80 },
      { x: 45, y: 79 },
      { x: 90, y: 30 },
    ];
    for (let i = 0; i < pts.length - 1; i++) {
      const lo = Math.min(pts[i].y, pts[i + 1].y) - 1e-9;
      const hi = Math.max(pts[i].y, pts[i + 1].y) + 1e-9;
      for (const y of sampleSegment(pts, i)) {
        expect(y).toBeGreaterThanOrEqual(lo);
        expect(y).toBeLessThanOrEqual(hi);
      }
    }
  });

  it("draws a single reading as a visible dot and nothing for none", () => {
    expect(monotonePath([])).toBe("");
    expect(monotonePath([{ x: 3, y: 4 }])).toMatch(/^M3\.00 4\.00h/);
  });

  it("starts and ends exactly on the first and last point", () => {
    const d = monotonePath([
      { x: 0, y: 1 },
      { x: 5, y: 9 },
      { x: 10, y: 3 },
    ]);
    expect(d.startsWith("M0.00 1.00")).toBe(true);
    expect(d.endsWith("10.00 3.00")).toBe(true);
  });

  it("closes the area down to the baseline", () => {
    const d = monotoneArea(
      [
        { x: 0, y: 1 },
        { x: 10, y: 3 },
      ],
      20,
    );
    expect(d.endsWith("L10.00 20.00L0.00 20.00Z")).toBe(true);
  });
});
