import { describe, expect, it } from "vitest";
import { defaultControlCard, detailKind, isTwoState } from "./detail-kind";
import type { HassEntity } from "../types";

const st = (entity_id: string, state: string, attributes: Record<string, unknown> = {}): HassEntity => ({
  entity_id,
  state,
  attributes,
  last_changed: "",
  last_updated: "",
});

describe("detailKind", () => {
  it("sorts entities into the five layouts", () => {
    expect(detailKind(st("sensor.t", "21.5", { unit_of_measurement: "°C" }))).toBe("numeric");
    // Unavailable right now, but meant to be a number.
    expect(detailKind(st("sensor.t", "unavailable", { unit_of_measurement: "°C" }))).toBe("numeric");
    expect(detailKind(st("sensor.wash", "Spülen"))).toBe("states");
    expect(detailKind(st("sensor.next", "2026-10-21T10:00:00+00:00", { device_class: "timestamp" }))).toBe("states");
    expect(detailKind(st("binary_sensor.door", "off"))).toBe("binary");
    expect(detailKind(st("select.mode", "eco"))).toBe("states");
    expect(detailKind(st("light.k", "on"))).toBe("control");
    expect(detailKind(st("weather.home", "sunny"))).toBe("info");
  });

  it("leaves release notes and press-only entities to more-info", () => {
    expect(detailKind(st("update.core", "on"))).toBeUndefined();
    expect(detailKind(st("button.restart", "2026-10-21T10:00:00+00:00"))).toBeUndefined();
    expect(detailKind(undefined)).toBeUndefined();
  });

  it("lets an entity override beat a domain override, and ignores nonsense", () => {
    const o = { light: "binary", "light.k": "states", sensor: "pie-chart" };
    expect(detailKind(st("light.k", "on"), o)).toBe("states");
    expect(detailKind(st("light.j", "on"), o)).toBe("binary");
    expect(detailKind(st("sensor.t", "2", { unit_of_measurement: "W" }), o)).toBe("numeric");
  });
});

describe("defaultControlCard", () => {
  it("names the suite card, with the cover's mode", () => {
    expect(defaultControlCard("cover.r")).toEqual({ type: "custom:m3-cover-card", entity: "cover.r", mode: "single" });
    expect(defaultControlCard("lock.front")?.type).toBe("custom:m3-button-card");
    expect(defaultControlCard("sensor.x")).toBeUndefined();
  });
});

describe("isTwoState", () => {
  it("recognises pairs, ignoring dropouts", () => {
    expect(isTwoState(["on", "off", "unavailable"])).toBe(true);
    expect(isTwoState(["locked"])).toBe(true);
    expect(isTwoState(["heat", "off"])).toBe(false);
    expect(isTwoState(["a", "b", "c"])).toBe(false);
  });
});
