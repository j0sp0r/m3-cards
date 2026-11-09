import { describe, it, expect } from "vitest";
import {
  deviceSiblings,
  discoverBatteryEntities,
  discoverClimateRooms,
  discoverLeakSensors,
  discoverLightRooms,
  discoverOccupancyRooms,
  discoverPersonEntities,
  isHiddenEntity,
} from "./ha-registry";
import type { HomeAssistant, HassEntity } from "../types";

interface RegistryFixture {
  states: Record<string, { state: string; attributes?: Record<string, unknown> }>;
  entities: { entity_id: string; area_id?: string; device_id?: string; labels?: string[] }[];
  devices?: { id: string; area_id?: string; labels?: string[] }[];
  areas?: { area_id: string; name: string; icon?: string }[];
}

function hassFromFixture(fixture: RegistryFixture): HomeAssistant {
  const states: Record<string, HassEntity> = {};
  for (const [id, s] of Object.entries(fixture.states)) {
    states[id] = { entity_id: id, state: s.state, attributes: s.attributes ?? {}, last_changed: "", last_updated: "" };
  }
  return {
    states,
    callWS: async <T,>(msg: Record<string, unknown>): Promise<T> => {
      switch (msg.type) {
        case "config/entity_registry/list":
          return fixture.entities as unknown as T;
        case "config/device_registry/list":
          return (fixture.devices ?? []) as unknown as T;
        case "config/area_registry/list":
          return (fixture.areas ?? []) as unknown as T;
        default:
          throw new Error(`unexpected callWS type: ${String(msg.type)}`);
      }
    },
  } as unknown as HomeAssistant;
}

describe("discoverLightRooms", () => {
  it("groups lights by area and names/icons the room from the area registry", async () => {
    const hass = hassFromFixture({
      states: { "light.kitchen_1": { state: "on" }, "light.kitchen_2": { state: "off" } },
      entities: [
        { entity_id: "light.kitchen_1", area_id: "kitchen" },
        { entity_id: "light.kitchen_2", area_id: "kitchen" },
      ],
      areas: [{ area_id: "kitchen", name: "Küche", icon: "mdi:silverware-fork-knife" }],
    });

    const rooms = await discoverLightRooms(hass, {});
    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toMatchObject({
      areaId: "kitchen",
      name: "Küche",
      icon: "mdi:silverware-fork-knife",
      entities: ["light.kitchen_1", "light.kitchen_2"],
      toggleEntities: ["light.kitchen_1", "light.kitchen_2"],
    });
  });

  it("drops lights that resolve to no area at all", async () => {
    const hass = hassFromFixture({
      states: { "light.orphan": { state: "on" } },
      entities: [{ entity_id: "light.orphan" }],
    });
    expect(await discoverLightRooms(hass, {})).toEqual([]);
  });

  it("applies a separate toggle filter independent of the display filter", async () => {
    const hass = hassFromFixture({
      states: { "light.a": { state: "on" }, "light.b": { state: "on" } },
      entities: [
        { entity_id: "light.a", area_id: "kitchen" },
        { entity_id: "light.b", area_id: "kitchen" },
      ],
      areas: [{ area_id: "kitchen", name: "Kitchen" }],
    });

    const rooms = await discoverLightRooms(hass, {
      toggleFilter: { exclude_entities: ["light.b"] },
    });
    expect(rooms[0].entities).toEqual(["light.a", "light.b"]);
    expect(rooms[0].toggleEntities).toEqual(["light.a"]);
  });

  it("prefer_groups keeps the group and drops its members", async () => {
    const hass = hassFromFixture({
      states: {
        "light.group": { state: "on", attributes: { entity_id: ["light.member_1", "light.member_2"] } },
        "light.member_1": { state: "on" },
        "light.member_2": { state: "off" },
      },
      entities: [
        { entity_id: "light.group", area_id: "living_room" },
        { entity_id: "light.member_1", area_id: "living_room" },
        { entity_id: "light.member_2", area_id: "living_room" },
      ],
      areas: [{ area_id: "living_room", name: "Living Room" }],
    });

    const rooms = await discoverLightRooms(hass, { groupHandling: "prefer_groups" });
    expect(rooms[0].entities).toEqual(["light.group"]);
  });

  it("prefer_members keeps the members and drops the group", async () => {
    const hass = hassFromFixture({
      states: {
        "light.group": { state: "on", attributes: { entity_id: ["light.member_1"] } },
        "light.member_1": { state: "on" },
      },
      entities: [
        { entity_id: "light.group", area_id: "living_room" },
        { entity_id: "light.member_1", area_id: "living_room" },
      ],
      areas: [{ area_id: "living_room", name: "Living Room" }],
    });

    const rooms = await discoverLightRooms(hass, { groupHandling: "prefer_members" });
    expect(rooms[0].entities).toEqual(["light.member_1"]);
  });

  it("resolves area via the device when the entity itself has none", async () => {
    const hass = hassFromFixture({
      states: { "light.a": { state: "on" } },
      entities: [{ entity_id: "light.a", device_id: "dev1" }],
      devices: [{ id: "dev1", area_id: "kitchen" }],
      areas: [{ area_id: "kitchen", name: "Kitchen" }],
    });
    const rooms = await discoverLightRooms(hass, {});
    expect(rooms[0].areaId).toBe("kitchen");
  });

  it("include_area/exclude_entities narrow the display filter", async () => {
    const hass = hassFromFixture({
      states: { "light.a": { state: "on" }, "light.b": { state: "on" } },
      entities: [
        { entity_id: "light.a", area_id: "kitchen" },
        { entity_id: "light.b", area_id: "bedroom" },
      ],
      areas: [
        { area_id: "kitchen", name: "Kitchen" },
        { area_id: "bedroom", name: "Bedroom" },
      ],
    });
    const rooms = await discoverLightRooms(hass, { filter: { include_area: ["kitchen"] } });
    expect(rooms.map((r) => r.areaId)).toEqual(["kitchen"]);
  });
});

// The fixture above hands the card only `callWS`, which exercises the
// fallback. In a current Home Assistant frontend that path never runs: the
// registries are already on `hass`, and reading them from there is the whole
// point of getRegistries. So this fixture provides the snapshots and makes
// `callWS` throw — if discovery still works, it demonstrably never asked the
// backend.
function hassFromSnapshots(fixture: {
  states: Record<string, { state: string; attributes?: Record<string, unknown> }>;
  entities: Record<string, { device_id?: string; area_id?: string; labels?: string[]; hidden?: boolean }>;
  devices?: Record<string, { area_id?: string; labels?: string[] }>;
  areas?: Record<string, { name: string; icon?: string }>;
}): HomeAssistant {
  const states: Record<string, HassEntity> = {};
  for (const [id, s] of Object.entries(fixture.states)) {
    states[id] = {
      entity_id: id,
      state: s.state,
      attributes: s.attributes ?? {},
      last_changed: "",
      last_updated: "",
    };
  }
  return {
    states,
    entities: fixture.entities,
    devices: fixture.devices ?? {},
    areas: fixture.areas ?? {},
    callWS: async () => {
      throw new Error("callWS must not be reached when hass carries the registries");
    },
  } as unknown as HomeAssistant;
}

describe("discoverLightRooms on the hass registry snapshots", () => {
  it("resolves rooms without a websocket round-trip", async () => {
    const hass = hassFromSnapshots({
      states: { "light.a": { state: "on" }, "light.b": { state: "off" } },
      entities: { "light.a": { area_id: "kitchen" }, "light.b": { device_id: "dev1" } },
      devices: { dev1: { area_id: "kitchen" } },
      areas: { kitchen: { name: "Kitchen", icon: "mdi:silverware" } },
    });
    const rooms = await discoverLightRooms(hass, {});
    expect(rooms).toHaveLength(1);
    expect(rooms[0].name).toBe("Kitchen");
    expect(rooms[0].icon).toBe("mdi:silverware");
    expect(rooms[0].entities).toEqual(["light.a", "light.b"]);
  });

  it("takes labels from the device as well as the entity", async () => {
    const hass = hassFromSnapshots({
      states: { "light.a": { state: "on" }, "light.b": { state: "on" } },
      entities: {
        "light.a": { area_id: "kitchen", labels: ["ambient"] },
        "light.b": { area_id: "kitchen", device_id: "dev1" },
      },
      devices: { dev1: { area_id: "kitchen", labels: ["ambient"] } },
      areas: { kitchen: { name: "Kitchen" } },
    });
    const rooms = await discoverLightRooms(hass, { filter: { include_labels: ["ambient"] } });
    expect(rooms[0].entities).toEqual(["light.a", "light.b"]);
  });

  // A lamp on a smart plug is a `switch`, so the domains discovery sweeps are
  // configurable. Nothing in Home Assistant marks a switch as lighting, which
  // is why the default stays `light` alone.
  it("sweeps only the light domain unless told otherwise", async () => {
    const hass = hassFromSnapshots({
      states: { "light.a": { state: "on" }, "switch.lamp": { state: "on" } },
      entities: { "light.a": { area_id: "kitchen" }, "switch.lamp": { area_id: "kitchen" } },
      areas: { kitchen: { name: "Kitchen" } },
    });
    expect((await discoverLightRooms(hass, {}))[0].entities).toEqual(["light.a"]);
    expect((await discoverLightRooms(hass, { domains: ["light", "switch"] }))[0].entities).toEqual([
      "light.a",
      "switch.lamp",
    ]);
  });

  it("drops an area-less light rather than giving it a room of its own", async () => {
    const hass = hassFromSnapshots({
      states: { "light.nowhere": { state: "on" } },
      entities: { "light.nowhere": {} },
      areas: {},
    });
    expect(await discoverLightRooms(hass, {})).toEqual([]);
  });
});

describe("deviceSiblings", () => {
  it("keeps diagnostics after primaries and drops config, hidden and disabled", () => {
    const state = (id: string) => ({ entity_id: id, state: "1", attributes: {}, last_changed: "", last_updated: "" });
    const ids = ["sensor.h", "sensor.t", "sensor.bat", "sensor.rssi", "switch.lock", "sensor.hid", "sensor.off", "sensor.other"];
    const hass = {
      states: Object.fromEntries(ids.map((id) => [id, state(id)])),
      entities: {
        "sensor.h": { device_id: "d" },
        "sensor.t": { device_id: "d" },
        "sensor.rssi": { device_id: "d", entity_category: "diagnostic" },
        "sensor.bat": { device_id: "d", entity_category: "diagnostic" },
        "switch.lock": { device_id: "d", entity_category: "config" },
        "sensor.hid": { device_id: "d", hidden: true },
        "sensor.off": { device_id: "d", disabled_by: "user" },
        "sensor.other": { device_id: "e" },
      },
    } as unknown as HomeAssistant;
    expect(deviceSiblings(hass, "sensor.h")).toEqual(["sensor.t", "sensor.bat", "sensor.rssi"]);
    expect(deviceSiblings(hass, "sensor.none")).toEqual([]);
  });
});

// A group created with "hide members" hides every member; the user has said
// they do not want to see those on automatically built dashboards (#33).
describe("discovery leaves hidden entities out", () => {
  const groupHass = () =>
    hassFromSnapshots({
      states: {
        "light.living": { state: "on", attributes: { entity_id: ["light.living_1", "light.living_2"] } },
        "light.living_1": { state: "on" },
        "light.living_2": { state: "on" },
      },
      entities: {
        "light.living": { area_id: "living" },
        "light.living_1": { area_id: "living", hidden: true },
        "light.living_2": { area_id: "living", hidden: true },
      },
      areas: { living: { name: "Living room" } },
    });

  it("shows the group but not its hidden members, and still switches them", async () => {
    const [room] = await discoverLightRooms(groupHass(), { groupHandling: "all" });
    expect(room.entities).toEqual(["light.living"]);
    expect(room.toggleEntities).toEqual(["light.living", "light.living_1", "light.living_2"]);
  });

  it("shows a hidden light that is named in include_entities", async () => {
    const [room] = await discoverLightRooms(groupHass(), {
      filter: { include_entities: ["light.living", "light.living_1"] },
    });
    expect(room.entities).toEqual(["light.living", "light.living_1"]);
  });

  it("drops a room whose only lights are hidden", async () => {
    const hass = hassFromSnapshots({
      states: { "light.a": { state: "on" } },
      entities: { "light.a": { area_id: "attic", hidden: true } },
      areas: { attic: { name: "Attic" } },
    });
    expect(await discoverLightRooms(hass, {})).toEqual([]);
  });

  it("reads hidden_by from the full registry as well as hidden from the display one", () => {
    const hass = { states: {}, entities: { "light.a": { hidden: true } } } as unknown as HomeAssistant;
    expect(isHiddenEntity(hass, "light.a")).toBe(true);
    expect(isHiddenEntity(hass, "light.b")).toBe(false);
    expect(isHiddenEntity(hass, "light.b", { hidden_by: "integration" })).toBe(true);
    expect(isHiddenEntity(hass, "light.b", { hidden_by: null })).toBe(false);
  });

  it("skips hidden batteries, people, leak and occupancy sensors", async () => {
    const hass = hassFromSnapshots({
      states: {
        "sensor.remote_battery": { state: "80", attributes: { device_class: "battery" } },
        "sensor.hidden_battery": { state: "80", attributes: { device_class: "battery" } },
        "person.alex": { state: "home" },
        "person.guest": { state: "home" },
        "binary_sensor.sink_leak": { state: "off", attributes: { device_class: "moisture" } },
        "binary_sensor.old_leak": { state: "off", attributes: { device_class: "moisture" } },
        "binary_sensor.hall_motion": { state: "off", attributes: { device_class: "motion" } },
        "binary_sensor.raw_motion": { state: "off", attributes: { device_class: "motion" } },
      },
      entities: {
        "sensor.hidden_battery": { hidden: true },
        "person.guest": { hidden: true },
        "binary_sensor.old_leak": { area_id: "kitchen", hidden: true },
        "binary_sensor.sink_leak": { area_id: "kitchen" },
        "binary_sensor.hall_motion": { area_id: "hall" },
        "binary_sensor.raw_motion": { area_id: "office", hidden: true },
      },
      areas: { kitchen: { name: "Kitchen" }, hall: { name: "Hall" }, office: { name: "Office" } },
    });
    expect(await discoverBatteryEntities(hass, {})).toEqual(["sensor.remote_battery"]);
    expect(await discoverPersonEntities(hass, {})).toEqual(["person.alex"]);
    expect((await discoverLeakSensors(hass, {})).map((s) => s.entity)).toEqual(["binary_sensor.sink_leak"]);
    expect((await discoverOccupancyRooms(hass, {})).flatMap((r) => r.entities)).toEqual(["binary_sensor.hall_motion"]);
  });

  it("skips a hidden temperature sensor unless include_entities names it", async () => {
    const hass = hassFromSnapshots({
      states: {
        "sensor.office_temperature": { state: "21", attributes: { device_class: "temperature" } },
        "sensor.trv_temperature": { state: "24", attributes: { device_class: "temperature" } },
      },
      entities: {
        "sensor.office_temperature": { area_id: "office" },
        "sensor.trv_temperature": { area_id: "bedroom", hidden: true },
      },
      areas: { office: { name: "Office" }, bedroom: { name: "Bedroom" } },
    });
    expect((await discoverClimateRooms(hass, {})).map((r) => r.name)).toEqual(["Office"]);
    const named = await discoverClimateRooms(hass, {
      filter: { include_entities: ["sensor.office_temperature", "sensor.trv_temperature"] },
    });
    expect(named.map((r) => r.name).sort()).toEqual(["Bedroom", "Office"]);
  });
});
