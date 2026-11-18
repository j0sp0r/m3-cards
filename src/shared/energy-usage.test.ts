import { describe, expect, it } from "vitest";
import { axisTicks, scaleEnergy, selfSufficiency, splitUsage, sumUsage } from "./energy-usage";

describe("splitUsage", () => {
  it("covers the home from solar first, then the battery, then the grid", () => {
    const u = splitUsage({ gridIn: 3, gridOut: 1, solar: 6, batteryIn: 2, batteryOut: 1.5 });
    // Balance 3 + 6 + 1.5 − 1 − 2 = 7.5; solar takes 6, the battery's 1.5 goes
    // to the grid's export first (1), then 0.5 to the home, the grid the rest.
    expect(u).toEqual({ grid: 1, solar: 6, battery: 0.5, export: 1, gridIn: 3, total: 7.5 });
  });

  it("counts a battery charged from the grid as not used in the home", () => {
    const u = splitUsage({ gridIn: 5, gridOut: 0, solar: 0, batteryIn: 2, batteryOut: 0 });
    expect(u.grid).toBe(3);
    expect(u.total).toBe(3);
  });

  it("takes export beyond the sun out of the home's use", () => {
    // A phase-balanced meter: export on one phase while another imports.
    const u = splitUsage({ gridIn: 10, gridOut: 1, solar: 0.5, batteryIn: 0, batteryOut: 0 });
    expect(u.total).toBeCloseTo(9.5);
    expect(u.solar).toBe(0.5);
  });

  it("has no self-sufficiency without use", () => {
    expect(selfSufficiency(splitUsage({ gridIn: 0, gridOut: 0, solar: 0, batteryIn: 0, batteryOut: 0 }))).toBeUndefined();
  });

  it("measures self-sufficiency as the energy dashboard's gauge does", () => {
    expect(selfSufficiency(splitUsage({ gridIn: 4, gridOut: 0, solar: 6, batteryIn: 0, batteryOut: 0 }))).toBe(60);
    // The grid drew more than the home used: none of it was self-supplied.
    expect(selfSufficiency(splitUsage({ gridIn: 10, gridOut: 1, solar: 0.5, batteryIn: 0, batteryOut: 0 }))).toBe(0);
  });

  it("ignores negative and missing readings", () => {
    const u = splitUsage({ gridIn: -1, gridOut: NaN, solar: 2, batteryIn: 0, batteryOut: 0 });
    expect(u).toEqual({ grid: 0, solar: 2, battery: 0, export: 0, gridIn: 0, total: 2 });
  });

  it("adds buckets up", () => {
    const days = [
      { gridIn: 2, gridOut: 0, solar: 1, batteryIn: 0, batteryOut: 0 },
      { gridIn: 2, gridOut: 3, solar: 0, batteryIn: 0, batteryOut: 0 },
    ];
    const sum = sumUsage(days.map(splitUsage));
    expect(sum.solar).toBe(1);
    expect(sum.gridIn).toBe(4);
    expect(sum.total).toBe(3);
  });

  it("puts the y-axis on round steps just above the tallest bar", () => {
    expect(axisTicks(23.4)).toEqual({ top: 25, ticks: [0, 5, 10, 15, 20, 25] });
    expect(axisTicks(21.3).top).toBe(25);
    expect(axisTicks(27).top).toBe(30);
    expect(axisTicks(0.87)).toEqual({ top: 1, ticks: [0, 0.25, 0.5, 0.75, 1] });
    expect(axisTicks(14)).toEqual({ top: 15, ticks: [0, 5, 10, 15] });
    expect(axisTicks(0.3).ticks).toEqual([0, 0.1, 0.2, 0.3]);
    expect(axisTicks(0)).toEqual({ top: 1, ticks: [0, 1] });
  });

  it("scales like the native dashboard", () => {
    expect(scaleEnergy(0.4)).toEqual({ value: 400, unit: "Wh" });
    expect(scaleEnergy(83.4)).toEqual({ value: 83.4, unit: "kWh" });
    expect(scaleEnergy(12_500).unit).toBe("MWh");
  });
});
