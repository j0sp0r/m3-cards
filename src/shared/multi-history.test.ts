import { describe, expect, it, vi } from "vitest";
import type { HomeAssistant } from "../types";
import { fetchTempSeries, historyRowsToSteps } from "./multi-history";

const H = 3_600_000;
const NOW = Date.UTC(2026, 10, 5, 12);

function fakeHass(states: Record<string, Record<string, unknown>>, answer: (msg: Record<string, unknown>) => unknown) {
  const callWS = vi.fn(async (msg: Record<string, unknown>) => answer(msg));
  const hass = {
    states: Object.fromEntries(
      Object.entries(states).map(([id, attributes]) => [id, { entity_id: id, state: "20", attributes }]),
    ),
    callWS,
  } as unknown as HomeAssistant;
  return { hass, callWS };
}

describe("fetchTempSeries", () => {
  it("reads up to 48 hours from the history, in one call for all sensors", async () => {
    const { hass, callWS } = fakeHass({ "sensor.a": {}, "sensor.b": {} }, () => ({
      "sensor.a": [{ s: "20.5", lu: (NOW - 30 * H) / 1000 }, { s: "unavailable", lu: (NOW - 2 * H) / 1000 }],
      "sensor.b": [{ s: "19", lu: (NOW - 10 * H) / 1000 }],
    }));
    const out = await fetchTempSeries(hass, ["sensor.a", "sensor.b"], 24 * H, 48 * H, NOW);
    expect(callWS).toHaveBeenCalledTimes(1);
    expect(callWS.mock.calls[0][0]).toMatchObject({
      type: "history/history_during_period",
      entity_ids: ["sensor.a", "sensor.b"],
      minimal_response: true,
      no_attributes: true,
    });
    const a = out.get("sensor.a")!;
    expect(a.source).toBe("history");
    // The state already held when the window opened starts at the window.
    expect(a.steps[0]).toEqual({ t: NOW - 24 * H, v: 20.5 });
    expect(a.steps[1].v).toBeNull();
    expect(out.get("sensor.b")!.extremes).toEqual({ min: 19, max: 19 });
  });

  it("reads a week from hourly statistics, and the history for a sensor without them", async () => {
    const { hass, callWS } = fakeHass({ "sensor.a": { state_class: "measurement" }, "sensor.b": {} }, (msg) =>
      msg.type === "recorder/statistics_during_period"
        ? { "sensor.a": [{ start: NOW - 3 * H, mean: 21, min: 20, max: 23 }] }
        : { "sensor.b": [{ s: "18", lu: (NOW - 8 * 24 * H) / 1000 }] },
    );
    const out = await fetchTempSeries(hass, ["sensor.a", "sensor.b"], 7 * 24 * H, 48 * H, NOW);
    const types = callWS.mock.calls.map((c) => c[0].type);
    expect(types).toEqual(["recorder/statistics_during_period", "history/history_during_period"]);
    expect(callWS.mock.calls[0][0]).toMatchObject({ statistic_ids: ["sensor.a"], period: "hour" });
    expect(callWS.mock.calls[1][0]).toMatchObject({ entity_ids: ["sensor.b"] });
    expect(out.get("sensor.a")).toMatchObject({ source: "statistics", extremes: { min: 20, max: 23 } });
    expect(out.get("sensor.b")!.source).toBe("history");
  });

  it("answers for every sensor even when the recorder fails", async () => {
    const { hass } = fakeHass({ "sensor.a": {} }, () => {
      throw new Error("no recorder");
    });
    const out = await fetchTempSeries(hass, ["sensor.a"], 24 * H, 48 * H, NOW);
    expect(out.get("sensor.a")).toEqual({ steps: [], source: "none" });
  });
});

describe("historyRowsToSteps", () => {
  it("turns text states into holes", () => {
    expect(historyRowsToSteps([{ s: "unknown", lu: 10 }, { s: "21.2", lu: 20 }], 0)).toEqual([
      { t: 10_000, v: null },
      { t: 20_000, v: 21.2 },
    ]);
  });
});
