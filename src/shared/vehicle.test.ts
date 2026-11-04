import { describe, expect, it } from "vitest";
import type { HomeAssistant, M3VehicleCardConfig } from "../types";
import {
  allMet,
  chargeEnd,
  conditionMet,
  isCharging,
  lockState,
  readSlot,
  resolveVehicle,
  vehicleEntities,
  vehicleLayout,
  visibleActions,
} from "./vehicle";

const NOW = Date.parse("2026-11-04T17:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

function hassWith(states: Record<string, [string, Record<string, unknown>?, number?]>): HomeAssistant {
  const out: Record<string, unknown> = {};
  for (const [id, [state, attributes = {}, minAgo = 10]] of Object.entries(states)) {
    out[id] = { entity_id: id, state, attributes, last_changed: ago(minAgo), last_updated: ago(minAgo) };
  }
  return { states: out } as unknown as HomeAssistant;
}

const card = (c: Partial<M3VehicleCardConfig>): M3VehicleCardConfig => ({ type: "custom:m3-vehicle-card", ...c });

describe("readSlot", () => {
  const hass = hassWith({
    "sensor.soc": ["72", { unit_of_measurement: "%" }],
    "sensor.gone": ["unavailable"],
    "sensor.car": ["on", { range: 312 }],
  });

  it("is undefined for a slot nobody mapped", () => {
    expect(readSlot(hass, undefined)).toBeUndefined();
    expect(readSlot(hass, "")).toBeUndefined();
  });

  it("reads a value with its unit", () => {
    expect(readSlot(hass, "sensor.soc")).toMatchObject({ ok: true, num: 72, unit: "%" });
  });

  it("never turns unavailable into a number", () => {
    const r = readSlot(hass, "sensor.gone");
    expect(r?.ok).toBe(false);
    expect(r?.num).toBeUndefined();
  });

  it("reads an attribute, and a unit given in the slot", () => {
    expect(readSlot(hass, { entity: "sensor.car", attribute: "range", unit: "km" })).toMatchObject({ ok: true, num: 312, unit: "km" });
  });

  it("treats an unrendered template as no value yet", () => {
    expect(readSlot(hass, { template: "{{ 1 + 1 }}" })?.ok).toBe(false);
    expect(readSlot(hass, { template: "2" })).toMatchObject({ ok: true, num: 2 });
  });

  it("warns outside the thresholds only", () => {
    expect(readSlot(hass, { entity: "sensor.soc", warn_below: 80 })?.warn).toBe(true);
    expect(readSlot(hass, { entity: "sensor.soc", warn_below: 20 })?.warn).toBe(false);
    expect(readSlot(hass, { entity: "sensor.gone", warn_below: 20 })?.warn).toBe(false);
  });
});

describe("isCharging", () => {
  const hass = hassWith({
    "binary_sensor.charging": ["on"],
    "sensor.charge_state": ["Charging"],
    "sensor.charge_idle": ["complete"],
    "sensor.charge_gone": ["unknown"],
  });

  it("reads a binary sensor", () => {
    expect(isCharging(hass, "binary_sensor.charging")).toBe(true);
  });

  it("matches charging states case-insensitively", () => {
    expect(isCharging(hass, "sensor.charge_state")).toBe(true);
    expect(isCharging(hass, "sensor.charge_idle")).toBe(false);
    expect(isCharging(hass, { entity: "sensor.charge_idle", charging_states: ["complete"] })).toBe(true);
  });

  it("does not know when it cannot read", () => {
    expect(isCharging(hass, "sensor.charge_gone")).toBeUndefined();
    expect(isCharging(hass, undefined)).toBeUndefined();
  });
});

describe("lockState", () => {
  const hass = hassWith({
    "lock.car": ["locked"],
    "lock.open": ["unlocked"],
    "binary_sensor.lock": ["on", { device_class: "lock" }],
    "lock.gone": ["unavailable"],
  });

  it("reads a lock and a lock-class binary sensor (on = unlocked)", () => {
    expect(lockState(readSlot(hass, "lock.car"))).toBe("locked");
    expect(lockState(readSlot(hass, "lock.open"))).toBe("unlocked");
    expect(lockState(readSlot(hass, "binary_sensor.lock"))).toBe("unlocked");
  });

  it("is neutral when unavailable and absent when unmapped", () => {
    expect(lockState(readSlot(hass, "lock.gone"))).toBe("unknown");
    expect(lockState(undefined)).toBeUndefined();
  });
});

describe("chargeEnd", () => {
  it("prefers what the car reports", () => {
    const at = NOW + 90 * 60_000;
    const reported = { ok: true, raw: new Date(at).toISOString(), warn: false };
    expect(chargeEnd({ now: NOW, reported, battery: 50, powerKw: 11, capacityKwh: 77 })).toEqual({ at, estimated: false });
  });

  it("estimates only with a capacity", () => {
    expect(chargeEnd({ now: NOW, battery: 72, limit: 80, powerKw: 11 })).toBeUndefined();
    const end = chargeEnd({ now: NOW, battery: 72, limit: 80, powerKw: 11, capacityKwh: 77 });
    // 8 % of 77 kWh at 11 kW = 0.56 h
    expect(end?.estimated).toBe(true);
    expect(Math.round((end!.at - NOW) / 60_000)).toBe(34);
  });

  it("gives no time once the limit is reached, or for a report in the past", () => {
    expect(chargeEnd({ now: NOW, battery: 80, limit: 80, powerKw: 11, capacityKwh: 77 })).toBeUndefined();
    const old = { ok: true, raw: ago(120), warn: false };
    expect(chargeEnd({ now: NOW, reported: old })).toBeUndefined();
  });
});

describe("conditions", () => {
  const hass = hassWith({
    "sensor.soc": ["15", { unit_of_measurement: "%" }],
    "binary_sensor.window": ["on", {}, 30],
    "sensor.gone": ["unavailable"],
  });

  it("compares against the fallback entity when none is named", () => {
    expect(conditionMet(hass, { below: 20 }, "sensor.soc", NOW)).toBe(true);
    expect(conditionMet(hass, { below: 10 }, "sensor.soc", NOW)).toBe(false);
  });

  it("reads an entity on its own as 'is on'", () => {
    expect(conditionMet(hass, { entity: "binary_sensor.window" }, undefined, NOW)).toBe(true);
  });

  it("waits for for_minutes", () => {
    expect(conditionMet(hass, { entity: "binary_sensor.window", for_minutes: 20 }, undefined, NOW)).toBe(true);
    expect(conditionMet(hass, { entity: "binary_sensor.window", for_minutes: 60 }, undefined, NOW)).toBe(false);
  });

  it("never fires a threshold on an unavailable value", () => {
    expect(conditionMet(hass, { entity: "sensor.gone", below: 20 }, undefined, NOW)).toBe(false);
    expect(conditionMet(hass, { entity: "sensor.gone" }, undefined, NOW)).toBe(false);
    expect(conditionMet(hass, { entity: "sensor.gone", value: "unavailable" }, undefined, NOW)).toBe(true);
  });

  it("takes a rendered template", () => {
    expect(conditionMet(hass, { template: "True" }, undefined, NOW)).toBe(true);
    expect(conditionMet(hass, { template: "{{ true }}" }, undefined, NOW)).toBe(false);
  });

  it("needs every condition of a list", () => {
    expect(allMet(hass, [{ below: 20 }, { entity: "binary_sensor.window" }], "sensor.soc", NOW)).toBe(true);
    expect(allMet(hass, [{ below: 10 }, { entity: "binary_sensor.window" }], "sensor.soc", NOW)).toBe(false);
  });
});

describe("resolveVehicle", () => {
  it("renders from name and battery alone", () => {
    const hass = hassWith({ "sensor.soc": ["54", { unit_of_measurement: "%" }] });
    const v = resolveVehicle(hass, card({ name: "Auto", energy: { battery: "sensor.soc" } }), NOW);
    expect(v.unmapped).toBe(false);
    expect(v.battery?.num).toBe(54);
    expect(v.mode).toBe("parked");
    expect(v.lock).toBeUndefined();
    expect(v.place).toBeUndefined();
    expect(v.end).toBeUndefined();
  });

  it("is charging with a limit and an estimated end", () => {
    const hass = hassWith({
      "sensor.soc": ["72"],
      "binary_sensor.charging": ["on"],
      "sensor.power": ["11000", { unit_of_measurement: "W" }],
      "number.limit": ["80"],
    });
    const v = resolveVehicle(
      hass,
      card({
        energy: {
          battery: "sensor.soc",
          charging: "binary_sensor.charging",
          charge_power: "sensor.power",
          charge_limit: "number.limit",
          capacity_kwh: 77,
        },
      }),
      NOW,
    );
    expect(v.mode).toBe("charging");
    expect(v.powerKw).toBe(11);
    expect(v.limit?.num).toBe(80);
    expect(v.end?.estimated).toBe(true);
  });

  it("knows plugged in from parked", () => {
    const hass = hassWith({ "sensor.soc": ["80"], "binary_sensor.charging": ["off"], "binary_sensor.plug": ["on"] });
    const cfg = card({ energy: { battery: "sensor.soc", charging: "binary_sensor.charging", plugged: "binary_sensor.plug" } });
    expect(resolveVehicle(hass, cfg, NOW).mode).toBe("plugged");
  });

  it("reads fuel on drive: fuel and ignores the battery", () => {
    const hass = hassWith({ "sensor.tank": ["40"], "sensor.soc": ["80"] });
    const v = resolveVehicle(hass, card({ drive: "fuel", energy: { battery: "sensor.soc", fuel_level: "sensor.tank" } }), NOW);
    expect(v.battery).toBeUndefined();
    expect(v.fuel?.num).toBe(40);
    expect(v.primaryEntity).toBe("sensor.tank");
  });

  it("reads both on drive: hybrid", () => {
    const hass = hassWith({ "sensor.tank": ["40"], "sensor.soc": ["80"] });
    const v = resolveVehicle(hass, card({ drive: "hybrid", energy: { battery: "sensor.soc", fuel_level: "sensor.tank" } }), NOW);
    expect(v.battery?.num).toBe(80);
    expect(v.fuel?.num).toBe(40);
  });

  it("survives everything being unavailable", () => {
    const hass = hassWith({ "sensor.soc": ["unavailable"], "binary_sensor.charging": ["unknown"], "lock.car": ["unavailable"] });
    const v = resolveVehicle(hass, card({ energy: { battery: "sensor.soc", charging: "binary_sensor.charging" }, lock: "lock.car" }), NOW);
    expect(v.battery?.ok).toBe(false);
    expect(v.charging).toBeUndefined();
    expect(v.mode).toBe("unknown");
    expect(v.lock).toBe("unknown");
  });

  it("says when nothing is mapped", () => {
    expect(resolveVehicle(hassWith({}), card({}), NOW).unmapped).toBe(true);
  });

  it("goes stale after stale_after_minutes", () => {
    const hass = hassWith({ "sensor.soc": ["54", {}, 90] });
    expect(resolveVehicle(hass, card({ energy: { battery: "sensor.soc" }, stale_after_minutes: 60 }), NOW).stale).toBe(true);
    expect(resolveVehicle(hass, card({ energy: { battery: "sensor.soc" }, stale_after_minutes: 120 }), NOW).stale).toBe(false);
  });

  it("names a tracked place", () => {
    const hass = hassWith({ "sensor.soc": ["54"], "device_tracker.car": ["home"], "device_tracker.away": ["Arbeit"] });
    expect(resolveVehicle(hass, card({ energy: { battery: "sensor.soc" }, location: "device_tracker.car" }), NOW).place).toEqual({ kind: "home" });
    expect(resolveVehicle(hass, card({ energy: { battery: "sensor.soc" }, location: "device_tracker.away" }), NOW).place).toEqual({
      kind: "named",
      name: "Arbeit",
    });
  });
});

describe("actions and layout", () => {
  const hass = hassWith({ "binary_sensor.charging": ["off"] });

  it("splits off the primary and hides what does not apply", () => {
    const actions = [
      { name: "Klima", icon: "mdi:fan", primary: true },
      { icon: "mdi:ev-plug-type2", visible: { entity: "binary_sensor.charging" } },
      { icon: "mdi:map-marker" },
    ];
    const { primary, rest } = visibleActions(hass, actions, undefined, NOW);
    expect(primary?.name).toBe("Klima");
    expect(rest.map((a) => a.icon)).toEqual(["mdi:map-marker"]);
  });

  it("only takes primary from the first entry", () => {
    const { primary, rest } = visibleActions(hass, [{ icon: "a" }, { icon: "b", primary: true }], undefined, NOW);
    expect(primary).toBeUndefined();
    expect(rest).toHaveLength(2);
  });

  it("drops unknown and repeated blocks", () => {
    expect(vehicleLayout(["chips", "energy", "chips", "nope" as never])).toEqual(["chips", "energy"]);
    expect(vehicleLayout(undefined)).toEqual(["energy", "alerts", "chips", "actions", "footer"]);
  });

  it("lists every entity it reads", () => {
    const ids = vehicleEntities(
      card({
        energy: { battery: "sensor.soc", charging: { entity: "sensor.cs" } },
        lock: "lock.car",
        chips: [{ entity: "sensor.tyres" }],
        alerts: [{ when: { entity: "binary_sensor.window" }, text: "x", action: { name: "Lock", entity: "lock.car2", tap_action: { action: "toggle" } } }],
        actions: [{ icon: "a", entity: "climate.car", visible: { entity: "binary_sensor.plug" } }],
      }),
    );
    for (const id of ["sensor.soc", "sensor.cs", "lock.car", "sensor.tyres", "binary_sensor.window", "lock.car2", "climate.car", "binary_sensor.plug"]) {
      expect(ids).toContain(id);
    }
  });
});
