import { describe, expect, it } from "vitest";
import type { HomeAssistant } from "../types";
import { discoverAreaSensors } from "./ha-registry";

function hass(): HomeAssistant {
  const st = (state: string, attributes: Record<string, unknown>) => ({ state, attributes });
  return {
    states: {
      "sensor.wz_co2": st("612", { device_class: "carbon_dioxide", state_class: "measurement", friendly_name: "WZ CO2" }),
      "sensor.wz_co2_raw": st("unknown", { device_class: "carbon_dioxide", friendly_name: "WZ CO2 roh" }),
      "sensor.bad_co2": st("820", { device_class: "carbon_dioxide", state_class: "measurement", friendly_name: "Bad CO2" }),
      "sensor.diag_co2": st("700", { device_class: "carbon_dioxide", friendly_name: "Diag" }),
      "sensor.loose_co2": st("500", { device_class: "carbon_dioxide", friendly_name: "Loser Sensor CO2" }),
      "sensor.wz_temp": st("21", { device_class: "temperature" }),
    },
    entities: {
      "sensor.wz_co2_raw": { area_id: "wz" },
      "sensor.wz_co2": { area_id: "wz" },
      "sensor.bad_co2": { device_id: "d1" },
      "sensor.diag_co2": { area_id: "flur", entity_category: "diagnostic" },
      "sensor.loose_co2": {},
      "sensor.wz_temp": { area_id: "wz" },
    },
    devices: { d1: { area_id: "bad" } },
    areas: { wz: { name: "Wohnzimmer" }, bad: { name: "Bad" }, flur: { name: "Flur" } },
  } as unknown as HomeAssistant;
}

describe("discoverAreaSensors", () => {
  it("finds one sensor of the class per area, by entity or device area, preferring a measured number", async () => {
    const found = await discoverAreaSensors(hass(), "carbon_dioxide", {});
    expect(found).toEqual([
      { areaId: "wz", name: "Wohnzimmer", entity: "sensor.wz_co2" },
      { areaId: "bad", name: "Bad", entity: "sensor.bad_co2" },
    ]);
  });

  it("takes a sensor without an area only when include_entities names it", async () => {
    const found = await discoverAreaSensors(hass(), "carbon_dioxide", {
      filter: { include_entities: ["sensor.loose_co2"] },
      nameStrip: [" CO2$"],
    });
    expect(found).toEqual([{ areaId: undefined, name: "Loser Sensor", entity: "sensor.loose_co2" }]);
  });
});
