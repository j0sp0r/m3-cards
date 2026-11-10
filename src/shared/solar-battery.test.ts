import { describe, expect, it } from "vitest";
import type { HomeAssistant, M3SolarBatteryCardConfig } from "../types";
import {
  batteryForecast,
  batteryNet,
  batteryPhase,
  clampPercent,
  combinePacks,
  formatPower,
  mpptReadings,
  peakMppt,
  readNumber,
  readPower,
  solarBatteryEntities,
  solarTotal,
} from "./solar-battery";

function st(state: string, unit?: string) {
  return { state, attributes: unit ? { unit_of_measurement: unit } : {} };
}

const states = {
  "sensor.soc": st("68"),
  "sensor.bat": st("620", "W"),
  "sensor.bat_neg": st("-300", "W"),
  "sensor.bat_kw": st("0.62", "kW"),
  "sensor.charge": st("400", "W"),
  "sensor.discharge": st("0", "W"),
  "sensor.dead": st("unavailable"),
  "sensor.unknown": st("unknown"),
  "sensor.pv1": st("410", "W"),
  "sensor.pv2": st("380", "W"),
  "sensor.pv3": st("unavailable"),
  "number.reserve": st("10"),
} as unknown as HomeAssistant["states"];

const base: M3SolarBatteryCardConfig = { type: "custom:m3-solar-battery-card", soc: "sensor.soc" };

describe("readNumber / readPower", () => {
  it("reads entities, fixed numbers and numeric strings", () => {
    expect(readNumber(states, "sensor.soc")).toBe(68);
    expect(readNumber(states, 25)).toBe(25);
    expect(readNumber(states, "15")).toBe(15);
    expect(readNumber(states, "number.reserve")).toBe(10);
  });

  it("never turns unavailable or unknown into 0", () => {
    expect(readNumber(states, "sensor.dead")).toBeUndefined();
    expect(readNumber(states, "sensor.unknown")).toBeUndefined();
    expect(readNumber(states, "sensor.missing")).toBeUndefined();
    expect(readNumber(states, undefined)).toBeUndefined();
  });

  it("converts kW to W", () => {
    expect(readPower(states, "sensor.bat_kw")).toBeCloseTo(620);
  });
});

describe("batteryNet", () => {
  it("takes a signed sensor as positive = charging", () => {
    expect(batteryNet({ ...base, battery_power: "sensor.bat" }, states)).toBe(620);
    expect(batteryNet({ ...base, battery_power: "sensor.bat_neg" }, states)).toBe(-300);
  });

  it("flips with invert", () => {
    expect(batteryNet({ ...base, battery_power: "sensor.bat", invert: true }, states)).toBe(-620);
    expect(batteryNet({ ...base, battery_power: "sensor.bat_neg", invert: true }, states)).toBe(300);
  });

  it("nets separate charge and discharge sensors", () => {
    expect(batteryNet({ ...base, charge_power: "sensor.charge", discharge_power: "sensor.discharge" }, states)).toBe(400);
    expect(batteryNet({ ...base, charge_power: "sensor.discharge", discharge_power: "sensor.charge" }, states)).toBe(-400);
  });

  it("keeps one readable sensor of two, and is unknown with none", () => {
    expect(batteryNet({ ...base, charge_power: "sensor.dead", discharge_power: "sensor.charge" }, states)).toBe(-400);
    expect(batteryNet({ ...base, charge_power: "sensor.dead", discharge_power: "sensor.unknown" }, states)).toBeUndefined();
    expect(batteryNet({ ...base, battery_power: "sensor.dead" }, states)).toBeUndefined();
    expect(batteryNet(base, states)).toBeUndefined();
  });
});

describe("batteryPhase", () => {
  it("charges, supplies and idles around the threshold", () => {
    expect(batteryPhase(620, 68, 100, 10)).toBe("charging");
    expect(batteryPhase(-300, 68, 100, 10)).toBe("discharging");
    expect(batteryPhase(8, 68, 100, 10)).toBe("idle");
    expect(batteryPhase(-10, 68, 100, 10)).toBe("idle");
    expect(batteryPhase(undefined, 68, 100, 10)).toBe("idle");
  });

  it("is full at the charge limit, even with a trickle, but not while discharging", () => {
    expect(batteryPhase(30, 100, 100, 10)).toBe("full");
    expect(batteryPhase(0, 90, 90, 10)).toBe("full");
    expect(batteryPhase(-300, 100, 100, 10)).toBe("discharging");
  });
});

describe("combinePacks", () => {
  it("leaves a single pack as it is", () => {
    expect(combinePacks({ soc: 50, capacity: undefined }, [])).toEqual({ soc: 50, capacity: undefined });
  });

  it("weights the SoC by capacity and adds the capacities", () => {
    const r = combinePacks({ soc: 80, capacity: 1.92 }, [{ soc: 20, capacity: 1.92 }]);
    expect(r.soc).toBeCloseTo(50);
    expect(r.capacity).toBeCloseTo(3.84);
    const s = combinePacks({ soc: 100, capacity: 1 }, [{ soc: 0, capacity: 3 }]);
    expect(s.soc).toBeCloseTo(25);
  });

  it("leaves an unreadable expansion out instead of counting it empty", () => {
    const r = combinePacks({ soc: 80, capacity: 2 }, [{ soc: undefined, capacity: 2 }]);
    expect(r).toEqual({ soc: 80, capacity: 2 });
  });

  it("is unknown when the main pack is", () => {
    expect(combinePacks({ soc: undefined, capacity: 2 }, [{ soc: 50, capacity: 2 }]).soc).toBeUndefined();
  });
});

describe("batteryForecast", () => {
  const now = Date.UTC(2026, 10, 10, 10, 0, 0);

  it("follows the charging formula, rounded to five minutes", () => {
    // (100 − 68) / 100 × 1.92 kWh = 0.6144 kWh at 620 W → 0.991 h → 59.5 min → 10:00 rounds to 11:00
    const f = batteryForecast({ phase: "charging", soc: 68, capacityKwh: 1.92, net: 620, reserve: 10, chargeLimit: 100, now });
    expect(f?.kind).toBe("full");
    expect(f?.at).toBe(Date.UTC(2026, 10, 10, 11, 0, 0));
  });

  it("follows the discharging formula down to the reserve", () => {
    // (50 − 10) / 100 × 2 kWh = 0.8 kWh at 400 W → 2 h
    const f = batteryForecast({ phase: "discharging", soc: 50, capacityKwh: 2, net: -400, reserve: 10, chargeLimit: 100, now });
    expect(f).toEqual({ kind: "empty", at: Date.UTC(2026, 10, 10, 12, 0, 0), beyond: false });
  });

  it("says beyond 24 hours instead of a time", () => {
    const f = batteryForecast({ phase: "discharging", soc: 90, capacityKwh: 2, net: -20, reserve: 0, chargeLimit: 100, now });
    expect(f).toEqual({ kind: "empty", beyond: true });
  });

  it("disappears when idle, full, unknown or without capacity", () => {
    const args = { soc: 50, capacityKwh: 2, net: 5, reserve: 10, chargeLimit: 100, now };
    expect(batteryForecast({ ...args, phase: "idle" })).toBeUndefined();
    expect(batteryForecast({ ...args, phase: "full" })).toBeUndefined();
    expect(batteryForecast({ ...args, phase: "charging", soc: undefined })).toBeUndefined();
    expect(batteryForecast({ ...args, phase: "charging", net: undefined })).toBeUndefined();
    expect(batteryForecast({ ...args, phase: "charging", capacityKwh: undefined })).toBeUndefined();
    expect(batteryForecast({ ...args, phase: "discharging", soc: 10, net: -300 })).toBeUndefined();
  });
});

describe("mppt", () => {
  const cfg: M3SolarBatteryCardConfig = {
    ...base,
    mppt: [
      { entity: "sensor.pv1" },
      { entity: "sensor.pv2", name: "Süd", max_watts: 760 },
      { entity: "sensor.pv3" },
    ],
  };

  it("scales each column to its max_watts (default 500)", () => {
    const r = mpptReadings(cfg, states);
    expect(r.map((x) => x.fill)).toEqual([0.82, 0.5, 0]);
    expect(r.map((x) => x.name)).toEqual(["PV1", "Süd", "PV3"]);
    expect(r[2].watts).toBeUndefined();
  });

  it("caps a column at the top", () => {
    const r = mpptReadings({ ...base, mppt: [{ entity: "sensor.pv1", max_watts: 200 }] }, states);
    expect(r[0].fill).toBe(1);
  });

  it("finds the peak and sums the readable inputs", () => {
    const r = mpptReadings(cfg, states);
    expect(peakMppt(r)?.name).toBe("PV1");
    expect(solarTotal(cfg, states, r)).toBe(790);
    expect(solarTotal({ ...cfg, solar_power: "sensor.bat" }, states, r)).toBe(620);
    expect(solarTotal(base, states, [])).toBeUndefined();
  });

  it("has no peak without sun", () => {
    expect(peakMppt([{ entity: "a", name: "PV1", watts: 0, fill: 0 }])).toBeUndefined();
  });
});

describe("formatPower", () => {
  it("switches to kW at the threshold, in the locale", () => {
    expect(formatPower("de", 620, 1000)).toEqual({ value: "620", unit: "W" });
    expect(formatPower("de", 1240, 1000)).toEqual({ value: "1,24", unit: "kW" });
    expect(formatPower("en", 1240, 1000)).toEqual({ value: "1.24", unit: "kW" });
  });

  it("signs on request", () => {
    expect(formatPower("de", 620, 1000, true).value).toBe("+620");
    expect(formatPower("de", -300, 1000, true).value).toBe("−300");
    expect(formatPower("de", 0, 1000, true).value).toBe("0");
  });
});

describe("helpers", () => {
  it("clamps markers onto the bar", () => {
    expect(clampPercent(10)).toBe(10);
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(140)).toBe(100);
  });

  it("lists every mapped entity and no fixed numbers", () => {
    const list = solarBatteryEntities({
      ...base,
      reserve: 10,
      charge_limit: "number.limit",
      battery_power: "sensor.bat",
      mppt: [{ entity: "sensor.pv1" }],
      batteries: [{ soc: "sensor.extra" }],
      chips: [{ entity: "sensor.temp" }, { template: "x" }],
    });
    expect(list).toEqual(["sensor.soc", "sensor.bat", "number.limit", "sensor.pv1", "sensor.extra", "sensor.temp"]);
  });
});
