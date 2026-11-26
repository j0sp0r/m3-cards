import { describe, expect, it, vi } from "vitest";
import { getGridCostEntities } from "./pricing";
import type { HomeAssistant } from "../types";

function hassWith(prefs: unknown, info: unknown | Error) {
  return {
    states: {},
    callWS: vi.fn(async (msg: { type: string }) => {
      if (msg.type === "energy/get_prefs") return prefs;
      if (msg.type === "energy/info") {
        if (info instanceof Error) throw info;
        return info;
      }
      throw new Error(`unexpected ${msg.type}`);
    }),
  } as unknown as HomeAssistant;
}

const tariffs = (stat_cost: string | null) => ({
  energy_sources: [
    { type: "grid", stat_energy_from: "sensor.t1", stat_cost, number_energy_price: 0.24 },
    { type: "grid", stat_energy_from: "sensor.t2", stat_cost: null, number_energy_price: 0.24 },
    { type: "solar", stat_energy_from: "sensor.pv" },
  ],
});

describe("getGridCostEntities", () => {
  it("finds the cost statistics HA generates for a fixed price, where stat_cost is null (#72)", async () => {
    const hass = hassWith(tariffs(null), {
      cost_sensors: { "sensor.t1": "sensor.t1_cost", "sensor.t2": "sensor.t2_cost" },
    });
    expect(await getGridCostEntities(hass)).toEqual(["sensor.t1_cost", "sensor.t2_cost"]);
  });

  it("prefers a cost entity the user picked over the generated one", async () => {
    const hass = hassWith(tariffs("sensor.my_cost"), {
      cost_sensors: { "sensor.t1": "sensor.t1_cost", "sensor.t2": "sensor.t2_cost" },
    });
    expect(await getGridCostEntities(hass)).toEqual(["sensor.my_cost", "sensor.t2_cost"]);
  });

  it("reads the older flow_from format", async () => {
    const hass = hassWith(
      { energy_sources: [{ type: "grid", flow_from: [{ stat_energy_from: "sensor.t1", stat_cost: null }] }] },
      { cost_sensors: { "sensor.t1": "sensor.t1_cost" } },
    );
    expect(await getGridCostEntities(hass)).toEqual(["sensor.t1_cost"]);
  });

  it("is undefined while no grid source has a price", async () => {
    expect(await getGridCostEntities(hassWith(tariffs(null), { cost_sensors: {} }))).toBeUndefined();
  });

  it("still uses stat_cost when energy/info cannot be read", async () => {
    const hass = hassWith(tariffs("sensor.my_cost"), new Error("unknown command"));
    expect(await getGridCostEntities(hass)).toEqual(["sensor.my_cost"]);
  });
});
