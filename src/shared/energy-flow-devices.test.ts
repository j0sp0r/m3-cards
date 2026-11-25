import { describe, expect, it } from "vitest";
import { branchPath, deviceRowLayout, shortName, trunkPath } from "./energy-flow-devices";

describe("deviceRowLayout", () => {
  it("puts one device straight under the home", () => {
    const l = deviceRowLayout(1, 268, 212, 250, 52);
    expect(l.xs).toEqual([268]);
    expect(branchPath(l, 268, 268, 52)).toBe(`M 268 ${l.busY} L 268 ${l.nodeY - 26}`);
  });
  it("spreads four devices leftwards and keeps them inside the diagram", () => {
    const l = deviceRowLayout(4, 268, 212, 250, 52);
    expect(l.xs).toEqual([40, 116, 192, 268]);
    expect(Math.min(...l.xs) - 26).toBeGreaterThanOrEqual(0);
  });
  it("runs the bus below the diagram and grows it by the row", () => {
    const l = deviceRowLayout(2, 268, 212, 330, 52);
    expect(l.busY).toBe(338);
    expect(l.viewHeight).toBeGreaterThan(l.labelY);
    expect(trunkPath(l, 268)).toBe(`M 268 222 L 268 338`);
  });
  it("turns a branch along the bus and down into its node", () => {
    const l = deviceRowLayout(2, 268, 212, 250, 52);
    expect(branchPath(l, 268, 192, 52)).toMatch(/^M 268 \d+ L 202 \d+ Q 192/);
  });
});

describe("shortName", () => {
  it("keeps short names and shortens long ones", () => {
    expect(shortName("Wallbox")).toBe("Wallbox");
    expect(shortName("Wärmepumpe Keller")).toBe("Wärmepumpe…");
  });
});
