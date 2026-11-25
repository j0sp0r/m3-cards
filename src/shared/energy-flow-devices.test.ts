import { describe, expect, it } from "vitest";
import { branchPath, deviceFlowLines, deviceRowLayout, shortName, trunkPath } from "./energy-flow-devices";

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

describe("deviceFlowLines", () => {
  const l = deviceRowLayout(4, 268, 212, 330, 52);
  it("thins the bus past each node and drops into each", () => {
    const lines = deviceFlowLines(l, 268, 52, [4, 1, 2, 0.5]);
    const by = Object.fromEntries(lines.map((x) => [x.key, x.value]));
    expect(by.trunk).toBe(7.5);
    expect(by["drop-3"]).toBe(0.5);
    expect(by["bus-3"]).toBe(7); // left of the node under the home
    expect(by["drop-2"]).toBe(2);
    expect(by["bus-2"]).toBe(5);
    expect(by["drop-1"]).toBe(1);
    expect(by["drop-0"]).toBe(4); // round the corner into the leftmost
  });
  it("draws nothing to a device that uses nothing, and no bus beyond it", () => {
    const lines = deviceFlowLines(l, 268, 52, [0, 0, 2, 0]);
    expect(lines.map((x) => x.key).sort()).toEqual(["bus-3", "drop-2", "trunk"]);
  });
  it("is one drop for a single device", () => {
    const one = deviceRowLayout(1, 268, 212, 250, 52);
    expect(deviceFlowLines(one, 268, 52, [3]).map((x) => x.key)).toEqual(["trunk", "drop-0"]);
  });
});
