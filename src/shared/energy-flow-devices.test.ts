import { describe, expect, it } from "vitest";
import { consumerShares, curvePath, flowColumns, homeAnchorY, shortName } from "./energy-flow-devices";

describe("consumerShares", () => {
  it("gives each device its share and Other the rest", () => {
    const s = consumerShares(5.2, [3.7, 0.9], true);
    expect(s.map((x) => x.index)).toEqual([0, 1, -1]);
    expect(s[2].value).toBeCloseTo(0.6);
    expect(s[0].share).toBeCloseTo(3.7 / 5.2);
  });
  it("leaves Other out when asked, or when nothing is left", () => {
    expect(consumerShares(5, [3, 2], true).map((x) => x.index)).toEqual([0, 1]);
    expect(consumerShares(5, [1], false).map((x) => x.index)).toEqual([0]);
  });
  it("never lets the shares exceed the whole", () => {
    const s = consumerShares(2, [3, 1], true);
    expect(s.reduce((t, x) => t + x.share, 0)).toBeCloseTo(1);
  });
});

describe("flowColumns", () => {
  it("centres the home and spreads each column over the rows", () => {
    const l = flowColumns(3, 4);
    expect(l.xLeft).toBeLessThan(l.xHome);
    expect(l.xRight).toBeGreaterThan(l.xHome);
    expect(l.yLeft).toHaveLength(3);
    expect(l.yRight).toHaveLength(4);
    expect(l.yRight[3]).toBeLessThan(l.viewHeight);
    expect(l.yLeft[0]).toBeGreaterThan(l.headingY);
  });
});

describe("curvePath / homeAnchorY / shortName", () => {
  it("draws a level S", () => {
    expect(curvePath(80, 50, 118, 150)).toBe("M 80 50 C 99 50 99 150 118 150");
  });
  it("spreads the anchors around the middle", () => {
    expect([0, 1, 2].map((i) => homeAnchorY(100, i, 3))).toEqual([88, 100, 112]);
  });
  it("shortens long names", () => {
    expect(shortName("Wallbox")).toBe("Wallbox");
    expect(shortName("Wärmepumpe Keller")).toBe("Wärmepumpe…");
  });
});
