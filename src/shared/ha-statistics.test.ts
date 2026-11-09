import { describe, expect, it, vi } from "vitest";
import type { HomeAssistant } from "../types";
import { currentPeriodStart, fetchCurrentPeriodChangeSum } from "./ha-statistics";

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
