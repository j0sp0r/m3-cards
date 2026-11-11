import { describe, expect, it, vi } from "vitest";
import type { HomeAssistant } from "../types";
import {
  currentPeriodStart,
  detectCounterStatType,
  fetchCurrentPeriodChangeSum,
  looksCumulative,
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
  it("takes a meter that only climbs for a running total", () => {
    expect(looksCumulative([1771.2, 1773.1, 1775.4, 1777.0, 1779.9])).toBe(true);
  });

  it("takes a monthly counter's month-to-date readings for one too", () => {
    expect(looksCumulative([2.1, 4.0, 6.3, 8.1, 10.4, 12.2, 14.6])).toBe(false);
    expect(looksCumulative([40.1, 42.0, 44.3, 46.1, 48.4, 50.2, 52.6])).toBe(true);
  });

  it("calls a counter that drops back daily", () => {
    expect(looksCumulative([2.4, 1.9, 2.8, 2.1, 1.7])).toBe(false);
  });

  it("does not take a daily counter that rose three days running for a meter", () => {
    expect(looksCumulative([1.8, 2.0, 2.3])).toBe(false);
  });

  it("decides nothing from one reading, or from a counter at zero", () => {
    expect(looksCumulative([1780])).toBe(false);
    expect(looksCumulative([0, 0, 0])).toBe(false);
  });

  it("ignores a rounding dip in a running total", () => {
    expect(looksCumulative([1780.0, 1779.99, 1782.1, 1784.0])).toBe(true);
  });
});

describe("detectCounterStatType (#55)", () => {
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

  it("sums a meter by its change", async () => {
    const { hass, now } = hassWith([1771.2, 1773.1, 1775.4, 1777.0], 11);
    expect(await detectCounterStatType(hass, "sensor.meter", false, now)).toBe("change");
  });

  it("keeps the last reading for a daily counter", async () => {
    const { hass, now } = hassWith([2.4, 1.9, 2.8, 2.1], 12);
    expect(await detectCounterStatType(hass, "sensor.meter", false, now)).toBe("state");
  });
});
