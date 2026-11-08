import { describe, expect, it } from "vitest";
import { displayUnit, flowMeasure, toBase } from "./energy-flow-units";

describe("flowMeasure", () => {
  it("is power when every sensor reports watts", () => {
    expect(flowMeasure([{ unit: "W" }, { unit: "kW" }])).toBe("power");
    expect(flowMeasure([{ deviceClass: "power" }])).toBe("power");
  });
  it("is energy as soon as one sensor reports energy, and by default", () => {
    expect(flowMeasure([{ unit: "W" }, { unit: "kWh" }])).toBe("energy");
    expect(flowMeasure([{ unit: "Wh", deviceClass: "power" }])).toBe("energy");
    expect(flowMeasure([])).toBe("energy");
    expect(flowMeasure([{ unit: "kWh" }])).toBe("energy");
  });
});

describe("toBase", () => {
  it("brings energy to kWh and power to W", () => {
    expect(toBase(2500, "Wh", "energy")).toBe(2.5);
    expect(toBase(1.2, "MWh", "energy")).toBe(1200);
    expect(toBase(1.5, "kW", "power")).toBe(1500);
    expect(toBase(800, "W", "power")).toBe(800);
    expect(toBase(7, "unknown", "energy")).toBe(7);
  });
});

describe("displayUnit", () => {
  it("shows power in W, and in kW from 1000 W", () => {
    expect(displayUnit("power", 850)).toEqual({ label: "W", divisor: 1 });
    expect(displayUnit("power", 3200)).toEqual({ label: "kW", divisor: 1000 });
  });
  it("keeps energy in kWh", () => {
    expect(displayUnit("energy", 12)).toEqual({ label: "kWh", divisor: 1 });
  });
  it("scales to a configured unit it knows, and only labels with one it does not", () => {
    expect(displayUnit("power", 3200, "W")).toEqual({ label: "W", divisor: 1 });
    expect(displayUnit("power", 3200, "kW")).toEqual({ label: "kW", divisor: 1000 });
    expect(displayUnit("energy", 2, "Wh")).toEqual({ label: "Wh", divisor: 0.001 });
    expect(displayUnit("power", 3200, "Watt")).toEqual({ label: "Watt", divisor: 1 });
  });
});
