import { describe, expect, it } from "vitest";
import {
  buildWatchIndex,
  evaluateUnits,
  globToRegExp,
  groupFlagged,
  integrationTitle,
  offlineStartFromHistory,
  severityOf,
  unavailableSignature,
  unitIcon,
  type RegDevice,
  type RegEntity,
  type StateLike,
} from "./availability";
import { isMuted, parseMutes, pruneMutes } from "./user-data";

const NOW = Date.parse("2026-11-12T22:00:00Z");
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

const entities: Record<string, RegEntity> = {
  "switch.plug": { entity_id: "switch.plug", device_id: "d1", platform: "zigbee2mqtt" },
  "sensor.plug_power": { entity_id: "sensor.plug_power", device_id: "d1", platform: "zigbee2mqtt" },
  "sensor.plug_linkquality": { entity_id: "sensor.plug_linkquality", device_id: "d1", platform: "zigbee2mqtt", entity_category: "diagnostic" },
  "button.plug_identify": { entity_id: "button.plug_identify", device_id: "d1", platform: "zigbee2mqtt" },
  "camera.garden": { entity_id: "camera.garden", device_id: "d2", platform: "frigate" },
  "binary_sensor.garden_person": { entity_id: "binary_sensor.garden_person", device_id: "d2", platform: "frigate" },
  "binary_sensor.window": { entity_id: "binary_sensor.window", device_id: "d3", platform: "zigbee2mqtt" },
  "sensor.template_x": { entity_id: "sensor.template_x", platform: "template" },
  "sensor.service_thing": { entity_id: "sensor.service_thing", device_id: "svc", platform: "sun" },
};
const devices: Record<string, RegDevice> = {
  d1: { id: "d1", name: "Plug", name_by_user: "Steckdose Balkon", area_id: "balkon" },
  d2: { id: "d2", name: "Kamera Garten", area_id: "garten" },
  d3: { id: "d3", name: "Fenstersensor Bad", area_id: "bad" },
  svc: { id: "svc", name: "Sun", entry_type: "service" },
};
const areas = { balkon: { area_id: "balkon", name: "Balkon" }, garten: { area_id: "garten", name: "Garten" }, bad: { area_id: "bad", name: "Bad" } };

describe("buildWatchIndex", () => {
  it("watches devices, not entities, and skips buttons, diagnostics and service devices", () => {
    const units = buildWatchIndex(entities, devices, areas);
    expect(units.map((u) => u.name).sort()).toEqual(["Fenstersensor Bad", "Kamera Garten", "Steckdose Balkon"]);
    const plug = units.find((u) => u.key === "d1")!;
    expect(plug.entities.sort()).toEqual(["sensor.plug_power", "switch.plug"]);
    expect(plug.areaName).toBe("Balkon");
    expect(plug.integration).toBe("zigbee2mqtt");
    expect(units.find((u) => u.key === "d2")!.primary).toBe("camera.garden");
  });

  it("does not let a helper attached to the device keep it online", () => {
    const withHelper = {
      ...entities,
      "sensor.solar_daily": { entity_id: "sensor.solar_daily", device_id: "d1", platform: "utility_meter" },
    };
    const plug = buildWatchIndex(withHelper, devices, areas).find((u) => u.key === "d1")!;
    expect(plug.entities).not.toContain("sensor.solar_daily");
    const flagged = evaluateUnits([plug], {
      "switch.plug": { state: "unavailable", last_changed: iso(5) },
      "sensor.plug_power": { state: "unavailable", last_changed: iso(5) },
      "sensor.solar_daily": { state: "0", last_reported: iso(1) },
    }, NOW);
    expect(flagged.map((f) => f.unit.key)).toEqual(["d1"]);
  });

  it("keeps diagnostics when asked to", () => {
    const plug = buildWatchIndex(entities, devices, areas, { ignoreDiagnostic: false }).find((u) => u.key === "d1")!;
    expect(plug.entities).toContain("sensor.plug_linkquality");
  });

  it("adds entities without a device only on request", () => {
    expect(buildWatchIndex(entities, devices, areas).some((u) => u.key.startsWith("entity:"))).toBe(false);
    const units = buildWatchIndex(entities, devices, areas, { includeOrphans: true, entityName: () => "Template X" });
    expect(units.find((u) => u.key === "entity:sensor.template_x")?.name).toBe("Template X");
  });

  it("excludes by device, integration, area and entity pattern", () => {
    const keys = (f: Parameters<typeof buildWatchIndex>[3]) => buildWatchIndex(entities, devices, areas, f).map((u) => u.key).sort();
    expect(keys({ exclude: { devices: ["d1"] } })).toEqual(["d2", "d3"]);
    expect(keys({ exclude: { integrations: ["frigate"] } })).toEqual(["d1", "d3"]);
    expect(keys({ exclude: { areas: ["bad"] } })).toEqual(["d1", "d2"]);
    expect(keys({ exclude: { entities: ["binary_sensor.*"] } })).toEqual(["d1", "d2"]);
  });

  it("narrows to an include", () => {
    const keys = buildWatchIndex(entities, devices, areas, { include: { integrations: ["zigbee2mqtt"] } }).map((u) => u.key).sort();
    expect(keys).toEqual(["d1", "d3"]);
  });
});

describe("evaluateUnits", () => {
  const units = buildWatchIndex(entities, devices, areas);

  it("lists a device with several unavailable entities exactly once, since its newest change", () => {
    const states: Record<string, StateLike> = {
      "switch.plug": { state: "unavailable", last_changed: iso(130) },
      "sensor.plug_power": { state: "unavailable", last_changed: iso(120) },
      "camera.garden": { state: "recording", last_reported: iso(1) },
      "binary_sensor.garden_person": { state: "off", last_reported: iso(1) },
      "binary_sensor.window": { state: "off", last_reported: iso(1) },
    };
    const flagged = evaluateUnits(units, states, NOW);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].unit.key).toBe("d1");
    expect(flagged[0].since).toBe(NOW - 120 * 60_000);
  });

  it("does not call a device offline while one entity still answers", () => {
    const states: Record<string, StateLike> = {
      "switch.plug": { state: "unavailable", last_changed: iso(10) },
      "sensor.plug_power": { state: "3.2", last_reported: iso(1) },
    };
    expect(evaluateUnits(units, states, NOW)).toHaveLength(0);
  });

  it("flags silence only for the integrations named", () => {
    const states: Record<string, StateLike> = {
      "binary_sensor.window": { state: "off", last_reported: iso(60 * 30) },
      "camera.garden": { state: "idle", last_reported: iso(60 * 30) },
      "binary_sensor.garden_person": { state: "off", last_reported: iso(60 * 30) },
    };
    const flagged = evaluateUnits(units, states, NOW, { staleMs: 24 * 3_600_000, staleIntegrations: ["zigbee2mqtt"] });
    expect(flagged.map((f) => [f.unit.key, f.kind])).toEqual([["d3", "stale"]]);
  });

  it("changes its signature only with the unavailable set", () => {
    const a = unavailableSignature(units, { "switch.plug": { state: "unavailable" } });
    const b = unavailableSignature(units, { "switch.plug": { state: "unavailable" }, "camera.garden": { state: "idle" } });
    expect(a).not.toBe("");
    expect(unavailableSignature(units, {})).not.toBe(a);
    expect(a.split(",").filter((p) => !p.startsWith("!"))).toEqual(b.split(",").filter((p) => !p.startsWith("!")));
  });

  it("stays fast on a large install", () => {
    const bigEntities: Record<string, RegEntity> = {};
    const bigDevices: Record<string, RegDevice> = {};
    const states: Record<string, StateLike> = {};
    for (let d = 0; d < 1000; d++) {
      bigDevices[`dev${d}`] = { id: `dev${d}`, name: `Device ${d}` };
      for (let e = 0; e < 5; e++) {
        const id = `sensor.dev${d}_${e}`;
        bigEntities[id] = { entity_id: id, device_id: `dev${d}`, platform: "zigbee2mqtt" };
        states[id] = { state: d % 50 === 0 ? "unavailable" : "1", last_changed: iso(5), last_reported: iso(1) };
      }
    }
    const t0 = performance.now();
    const index = buildWatchIndex(bigEntities, bigDevices, {});
    for (let i = 0; i < 20; i++) {
      unavailableSignature(index, states);
      evaluateUnits(index, states, NOW);
    }
    const elapsed = performance.now() - t0;
    expect(evaluateUnits(index, states, NOW)).toHaveLength(20);
    expect(elapsed).toBeLessThan(500);
  });
});

describe("groups and severity", () => {
  const unit = { key: "x", name: "X", entities: [], primary: "switch.x" };
  const at = (min: number) => ({ unit, kind: "offline" as const, since: NOW - min * 60_000 });

  it("splits at recent_minutes, newest first", () => {
    const g = groupFlagged([at(18), at(6), at(120), at(4320)], NOW, 60 * 60_000);
    expect(g.recent.map((f) => (NOW - f.since) / 60_000)).toEqual([6, 18]);
    expect(g.longer.map((f) => (NOW - f.since) / 60_000)).toEqual([120, 4320]);
  });

  it("turns critical at critical_hours", () => {
    expect(severityOf(at(23 * 60), NOW, 24 * 3_600_000)).toBe("warn");
    expect(severityOf(at(24 * 60), NOW, 24 * 3_600_000)).toBe("critical");
  });
});

describe("offlineStartFromHistory", () => {
  const ws = NOW - 30 * 86_400_000;
  const s = (state: string, minutesAgo: number) => ({ s: state, lc: (NOW - minutesAgo * 60_000) / 1000 });

  it("sees through a restart's fresh unavailable row", () => {
    const rows = [s("on", 6000), s("unavailable", 5000), s("unknown", 30), s("unavailable", 29)];
    expect(offlineStartFromHistory(rows, ws)).toEqual({ at: NOW - 5000 * 60_000, older: false });
  });

  it("reports an outage older than the window", () => {
    const rows = [{ s: "unavailable", lc: ws / 1000 }, s("unavailable", 10)];
    expect(offlineStartFromHistory(rows, ws).older).toBe(true);
  });

  it("knows nothing without rows", () => {
    expect(offlineStartFromHistory([], ws)).toEqual({ older: false });
  });
});

describe("helpers", () => {
  it("matches globs", () => {
    expect(globToRegExp("sensor.*_linkquality").test("sensor.plug_linkquality")).toBe(true);
    expect(globToRegExp("sensor.plug?").test("sensor.plug1")).toBe(true);
    expect(globToRegExp("sensor.a.b").test("sensorXa.b")).toBe(false);
  });

  it("picks an icon from device_class, then domain", () => {
    expect(unitIcon("binary_sensor.x", { state: "off", attributes: { device_class: "window" } })).toBe("mdi:window-closed-variant");
    expect(unitIcon("camera.x")).toBe("mdi:cctv");
    expect(unitIcon("weird.x")).toBe("mdi:devices");
  });

  it("names integrations, translated first", () => {
    expect(integrationTitle("zigbee2mqtt")).toBe("Zigbee2MQTT");
    expect(integrationTitle("my_thing")).toBe("My thing");
    expect(integrationTitle("hue", (k) => (k === "component.hue.title" ? "Philips Hue" : k))).toBe("Philips Hue");
  });
});

describe("mutes", () => {
  it("drops expired mutes and mutes of devices back online", () => {
    const m = { a: { until: NOW - 1, at: 0 }, b: { until: null, at: 0 }, c: { until: NOW + 1000, at: 0 } };
    expect(Object.keys(pruneMutes(m, NOW))).toEqual(["b", "c"]);
    expect(Object.keys(pruneMutes(m, NOW, new Set(["c"])))).toEqual(["c"]);
  });

  it("keeps a permanent mute when the device comes back", () => {
    const m = { tv: { until: null, at: 0, permanent: true }, plug: { until: null, at: 0 } };
    expect(Object.keys(pruneMutes(m, NOW, new Set()))).toEqual(["tv"]);
    expect(isMuted(m, "tv", NOW)).toBe(true);
    expect(parseMutes({ tv: { until: 5, at: 1, permanent: true } })).toEqual({ tv: { until: null, at: 1, permanent: true } });
  });

  it("returns the same object when nothing changed", () => {
    const m = { b: { until: null, at: 0 } };
    expect(pruneMutes(m, NOW, new Set(["b"]))).toBe(m);
  });

  it("reads mutes safely from storage", () => {
    expect(parseMutes({ a: { until: null, at: 5 }, b: { until: "x" }, c: 3 })).toEqual({ a: { until: null, at: 5 } });
    expect(parseMutes(null)).toEqual({});
    expect(isMuted({ a: { until: null, at: 0 } }, "a", NOW)).toBe(true);
    expect(isMuted({ a: { until: NOW - 1, at: 0 } }, "a", NOW)).toBe(false);
  });
});
