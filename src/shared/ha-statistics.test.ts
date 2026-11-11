import { describe, expect, it, vi } from "vitest";
import type { HomeAssistant } from "../types";
import {
  currentPeriodStart,
  detectCounterKind,
  fetchCurrentPeriodChangeSum,
  looksCumulative,
  runningDayUse,
} from "./ha-statistics";

describe("currentPeriodStart", () => {
  const now = new Date(2026, 10, 8, 18, 14, 37, 250);

  it("is local midnight for the day bar", () => {
    expect(currentPeriodStart("day", now)).toEqual(new Date(2026, 10, 8, 0, 0, 0, 0));
  });

  it("is the top of the hour for the hour bar", () => {
    expect(currentPeriodStart("hour", now)).toEqual(new Date(2026, 10, 8, 18, 0, 0, 0));
  });

  it("leaves the date it is given alone", () => {
    const before = now.getTime();
    currentPeriodStart("day", now);
    expect(now.getTime()).toBe(before);
  });
});

describe("fetchCurrentPeriodChangeSum", () => {
  // A lifetime meter at 11 556 kWh whose running day so far is 3.5 kWh: the
  // sum must come from the short-term "change" rows, never from the state.
  it("sums the short-term change since the period start", async () => {
    const callWS = vi.fn().mockResolvedValue({
      "sensor.grid_import": [
        { start: 0, end: 0, change: 1.25 },
        { start: 0, end: 0, change: 2.25 },
        { start: 0, end: 0, change: null },
      ],
    });
    const hass = {
      callWS,
      states: {
        "sensor.grid_import": {
          entity_id: "sensor.grid_import",
          state: "11556.21",
          attributes: { unit_of_measurement: "kWh", device_class: "energy" },
        },
      },
    } as unknown as HomeAssistant;
    const start = new Date(2026, 10, 8, 0, 0, 0, 0);

    const total = await fetchCurrentPeriodChangeSum(hass, ["sensor.grid_import"], start);

    expect(total).toBeCloseTo(3.5);
    expect(callWS).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "recorder/statistics_during_period",
        start_time: start.toISOString(),
        period: "5minute",
        types: ["change"],
      }),
    );
  });
});

describe("looksCumulative (#55)", () => {
  // Last readings per day of real sensors on the author's instance, 3–11 Nov.
  const lifetime = [1816.23, 1827.49, 1842.42, 1853.32, 1860.88, 1877.62, 1888.19, 1904.39, 1917.25];
  const monthly = [9.44, 11.39, 14.7, 16.93, 19.18, 24.38, 27.28, 30.66, 33.5];
  const daily = [15.29, 11.27, 14.94, 10.91, 7.59, 21.47, 11.94, 16.23, 12.88];

  it("takes a lifetime meter for a running total", () => {
    expect(looksCumulative(lifetime)).toBe(true);
  });

  it("takes a monthly meter early in the month for one too", () => {
    expect(looksCumulative(monthly)).toBe(true);
  });

  it("allows a monthly meter its one reset", () => {
    expect(looksCumulative([61.2, 63.0, 65.1, 1.9, 4.2, 6.0, 8.3, 10.1])).toBe(true);
  });

  it("calls a counter that drops back daily", () => {
    expect(looksCumulative(daily)).toBe(false);
  });

  it("does not take a daily counter that rose three days running for a meter", () => {
    expect(looksCumulative([1.8, 2.0, 2.3])).toBe(false);
  });

  it("takes a young meter only far above its steps", () => {
    expect(looksCumulative([1771.2, 1773.1, 1775.4])).toBe(true);
  });

  it("decides nothing from one reading, or from a counter at zero", () => {
    expect(looksCumulative([1780])).toBe(false);
    expect(looksCumulative([0, 0, 0])).toBe(false);
  });

  it("does not take an idle appliance's hourly counter for a meter", () => {
    expect(looksCumulative([0, 0, 0, 0.21, 0, 0, 0, 0, 0])).toBe(false);
  });

  it("ignores a rounding dip in a running total", () => {
    expect(looksCumulative([1780.0, 1779.99, 1782.1, 1784.0])).toBe(true);
  });
});

describe("runningDayUse (#55)", () => {
  it("counts each day from the reading before", () => {
    const use = runningDayUse(1800, [
      ["2026-11-01", 1810.5],
      ["2026-11-02", 1823.0],
    ]);
    expect([...use.values()].map((v) => +v.toFixed(2))).toEqual([10.5, 12.5]);
  });

  it("takes the reading after a reset as that day's use", () => {
    const use = runningDayUse(65.1, [
      ["2026-11-01", 1.9],
      ["2026-11-02", 4.2],
    ]);
    expect([...use.values()].map((v) => +v.toFixed(2))).toEqual([1.9, 2.3]);
  });

  it("skips a first day with nothing to count from", () => {
    const use = runningDayUse(undefined, [
      ["2026-11-01", 1810.5],
      ["2026-11-02", 1823.0],
    ]);
    expect([...use.keys()]).toEqual(["2026-11-02"]);
  });
});

describe("detectCounterKind (#55)", () => {
  // Each test asks for its own day: the statistics cache would otherwise
  // hand the second one the first one's answer.
  const hassWith = (states: number[], day: number) => {
    const now = new Date(2026, 10, day, 12);
    const rows = states.map((state, i) => ({
      start: new Date(2026, 10, day - states.length + 1 + i).getTime(),
      state,
    }));
    const callWS = vi.fn().mockResolvedValue({ "sensor.meter": rows });
    return { hass: { callWS, config: {} } as unknown as HomeAssistant, now };
  };

  it("calls a meter running", async () => {
    const { hass, now } = hassWith([1771.2, 1773.1, 1775.4, 1777.0], 11);
    expect(await detectCounterKind(hass, "sensor.meter", false, now)).toBe("running");
  });

  it("calls a counter that resets daily daily", async () => {
    const { hass, now } = hassWith([2.4, 1.9, 2.8, 2.1], 12);
    expect(await detectCounterKind(hass, "sensor.meter", false, now)).toBe("daily");
  });
});
