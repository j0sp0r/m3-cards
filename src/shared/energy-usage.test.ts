import { describe, expect, it } from "vitest";
import { scaleEnergy, selfSufficiency, splitUsage } from "./energy-usage";

describe("splitUsage", () => {
  it("uses solar first, charges from the surplus, exports the rest", () => {
    const u = splitUsage({ gridIn: 3, gridOut: 1, solar: 6, batteryIn: 2, batteryOut: 1.5 });
    expect(u).toEqual({ grid: 3, solar: 3, battery: 1.5, export: 1, total: 7.5 });
    expect(selfSufficiency(u)).toBe(60);
  });

  it("counts a battery charged from the grid as not used in the home", () => {
    const u = splitUsage({ gridIn: 5, gridOut: 0, solar: 0, batteryIn: 2, batteryOut: 0 });
    expect(u.grid).toBe(3);
    expect(u.total).toBe(3);
  });

  it("has no self-sufficiency without use", () => {
    expect(selfSufficiency(splitUsage({ gridIn: 0, gridOut: 0, solar: 0, batteryIn: 0, batteryOut: 0 }))).toBeUndefined();
  });

  it("ignores negative and missing readings", () => {
    const u = splitUsage({ gridIn: -1, gridOut: NaN, solar: 2, batteryIn: 0, batteryOut: 0 });
    expect(u).toEqual({ grid: 0, solar: 2, battery: 0, export: 0, total: 2 });
  });

  it("scales like the native dashboard", () => {
    expect(scaleEnergy(0.4)).toEqual({ value: 400, unit: "Wh" });
    expect(scaleEnergy(83.4)).toEqual({ value: 83.4, unit: "kWh" });
    expect(scaleEnergy(12_500).unit).toBe("MWh");
  });
});
