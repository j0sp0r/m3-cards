import { describe, it, expect } from "vitest";
import { lastSeen, deviceSiblings } from "./last-seen";
import type { HomeAssistant } from "../types";

const T = (h: number) => new Date(Date.UTC(2026, 10, 1, h)).toISOString();

function hass(
  states: Record<string, { state?: string; last_updated: string; last_reported?: string }>,
  devices: Record<string, string> = {},
): HomeAssistant {
  const entities = Object.fromEntries(Object.entries(devices).map(([id, device_id]) => [id, { device_id }]));
  const full = Object.fromEntries(
    Object.entries(states).map(([id, s]) => [id, { entity_id: id, state: s.state ?? "off", attributes: {}, last_changed: s.last_updated, ...s }]),
  );
  return { states: full, entities } as unknown as HomeAssistant;
}

describe("lastSeen (#25)", () => {
  it("without last_reported, reports activity but cannot prove silence", () => {
    const h = hass({ "binary_sensor.leak": { last_updated: T(1) } });
    expect(lastSeen(h, "binary_sensor.leak")).toEqual({ at: Date.parse(T(1)), reported: false });
  });

  it("uses last_reported when the state carries it", () => {
    const h = hass({ "binary_sensor.leak": { last_updated: T(1), last_reported: T(9) } });
    expect(lastSeen(h, "binary_sensor.leak")).toEqual({ at: Date.parse(T(9)), reported: true });
  });

  it("takes the newest activity of the other entities on the same device", () => {
    const h = hass(
      {
        "binary_sensor.leak": { last_updated: T(1) },
        "sensor.leak_linkquality": { last_updated: T(7) },
        "sensor.other_device": { last_updated: T(10) },
      },
      { "binary_sensor.leak": "d1", "sensor.leak_linkquality": "d1", "sensor.other_device": "d2" },
    );
    expect(lastSeen(h, "binary_sensor.leak")?.at).toBe(Date.parse(T(7)));
  });

  it("ignores siblings that move without the device: unavailable, update, button", () => {
    const h = hass(
      {
        "binary_sensor.leak": { last_updated: T(1) },
        "sensor.leak_battery": { state: "unavailable", last_updated: T(8) },
        "update.leak_firmware": { last_updated: T(9) },
        "button.leak_identify": { last_updated: T(10) },
      },
      {
        "binary_sensor.leak": "d1",
        "sensor.leak_battery": "d1",
        "update.leak_firmware": "d1",
        "button.leak_identify": "d1",
      },
    );
    expect(lastSeen(h, "binary_sensor.leak")?.at).toBe(Date.parse(T(1)));
  });

  it("counts an extra entity such as a configured battery sensor", () => {
    const h = hass({
      "binary_sensor.leak": { last_updated: T(1) },
      "sensor.battery": { last_updated: T(5), last_reported: T(6) },
    });
    expect(lastSeen(h, "binary_sensor.leak", ["sensor.battery", undefined])).toEqual({
      at: Date.parse(T(6)),
      reported: true,
    });
  });

  it("returns undefined for an entity that has no state", () => {
    expect(lastSeen(hass({}), "binary_sensor.gone")).toBeUndefined();
  });
});

describe("deviceSiblings", () => {
  it("is empty without a registry or a device", () => {
    expect(deviceSiblings({ states: {} } as unknown as HomeAssistant, "binary_sensor.leak")).toEqual([]);
    expect(deviceSiblings(hass({}, { "sensor.x": "d1" }), "binary_sensor.leak")).toEqual([]);
  });
});

describe("lastSeen: last-seen sensors", () => {
  it("a sibling *_last_seen timestamp sensor proves silence by its state", () => {
    const h = hass(
      {
        "binary_sensor.leak": { last_updated: T(1) },
        "sensor.leak_last_seen": { state: T(8), last_updated: T(2) },
      },
      { "binary_sensor.leak": "d1", "sensor.leak_last_seen": "d1" },
    );
    (h.states["sensor.leak_last_seen"].attributes as Record<string, unknown>).device_class = "timestamp";
    expect(lastSeen(h, "binary_sensor.leak")).toEqual({ at: Date.parse(T(8)), reported: true });
  });

  it("a named last-seen entity counts even off the device", () => {
    const h = hass({
      "binary_sensor.leak": { last_updated: T(1) },
      "sensor.bridge_seen": { state: T(5), last_updated: T(5) },
    });
    expect(lastSeen(h, "binary_sensor.leak", [], ["sensor.bridge_seen"])).toEqual({ at: Date.parse(T(5)), reported: true });
  });

  it("a last-seen sensor without a parseable time proves nothing", () => {
    const h = hass({
      "binary_sensor.leak": { last_updated: T(1) },
      "sensor.bridge_seen": { state: "never", last_updated: T(5) },
    });
    expect(lastSeen(h, "binary_sensor.leak", [], ["sensor.bridge_seen"])).toEqual({ at: Date.parse(T(1)), reported: false });
  });
});
