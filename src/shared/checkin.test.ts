import { describe, expect, it } from "vitest";
import { checkinAction, checkinSince, checkinState, durationParts, fillStatus } from "./checkin";
import type { HassEntity } from "../types";

const st = (state: string, last_changed = "2026-11-01T12:00:00Z"): HassEntity =>
  ({ entity_id: "x.y", state, attributes: {}, last_changed }) as HassEntity;

describe("checkinState", () => {
  it("reads an input_boolean by state_on", () => {
    expect(checkinState({ entity: "input_boolean.garden" }, st("on"))).toBe("in");
    expect(checkinState({ entity: "input_boolean.garden" }, st("off"))).toBe("out");
    expect(checkinState({ entity: "input_boolean.garden", state_on: "off" }, st("off"))).toBe("in");
  });

  it("reads a person by home_state", () => {
    expect(checkinState({ entity: "person.a" }, st("home"))).toBe("in");
    expect(checkinState({ entity: "person.a" }, st("not_home"))).toBe("out");
    expect(checkinState({ entity: "person.a", home_state: "Garten" }, st("Garten"))).toBe("in");
  });

  it("knows a missing entity", () => {
    expect(checkinState({ entity: "input_boolean.garden" }, st("unavailable"))).toBe("unavailable");
    expect(checkinState({ entity: "input_boolean.garden" }, undefined)).toBe("unavailable");
  });
});

describe("checkinAction", () => {
  it("switches an input_boolean by default", () => {
    expect(checkinAction({ entity: "input_boolean.garden" }, "in")).toEqual({
      action: "perform-action",
      perform_action: "input_boolean.turn_on",
      target: { entity_id: "input_boolean.garden" },
    });
  });

  it("prefers the configured action", () => {
    const script = { action: "perform-action" as const, perform_action: "script.leave_garden" };
    expect(checkinAction({ entity: "input_boolean.garden", checkout_action: script }, "out")).toBe(script);
  });

  it("offers nothing for a sensor without actions", () => {
    expect(checkinAction({ entity: "binary_sensor.door" }, "in")).toBeUndefined();
    expect(checkinAction({ entity: "person.a" }, "out")).toBeUndefined();
  });
});

describe("checkinSince", () => {
  const now = Date.parse("2026-11-01T14:00:00Z");
  it("uses last_changed without a since entity", () => {
    expect(checkinSince(st("on"), undefined, now)).toBe(Date.parse("2026-11-01T12:00:00Z"));
  });
  it("reads an input_datetime", () => {
    const since = checkinSince(st("on"), st("2026-11-01 13:30:00"), now);
    expect(since).toBe(Date.parse("2026-11-01T13:30:00"));
  });
  it("hides a time in the future", () => {
    expect(checkinSince(st("on"), st("2026-11-02T13:30:00Z"), now)).toBeUndefined();
  });
});

describe("durationParts and fillStatus", () => {
  it("splits hours and minutes", () => {
    expect(durationParts(0, 134 * 60000)).toEqual({ h: 2, m: 14 });
  });
  it("fills both placeholders", () => {
    expect(fillStatus("Eingecheckt seit {duration} ({time})", "2 Std.", "14:34")).toBe("Eingecheckt seit 2 Std. (14:34)");
  });
});
