import { describe, expect, it } from "vitest";
import {
  currentDetection,
  eventFromChange,
  eventsFromHistory,
  fillEventTemplate,
  kindOf,
  lastRingAt,
  mergeEvents,
} from "./camera-events";
import type { CameraConfig } from "../types";

const cam: CameraConfig = {
  camera: "camera.front_door",
  doorbell: "event.front_door_ding",
  person: "binary_sensor.front_person",
  motion: "event.front_door_motion",
  events: ["event.front_door_extra"],
};
const iso = (ms: number) => new Date(ms).toISOString();

describe("kindOf", () => {
  it("lets the doorbell ring whatever its event type says", () => {
    expect(kindOf(cam, "event.front_door_ding", "pressed")).toBe("ring");
  });
  it("reads the event type before the role", () => {
    expect(kindOf(cam, "event.front_door_extra", "package_detected")).toBe("package");
    expect(kindOf(cam, "event.front_door_motion", "person")).toBe("person");
    expect(kindOf(cam, "event.front_door_motion", "something")).toBe("motion");
    expect(kindOf(cam, "event.front_door_extra")).toBe("other");
    expect(kindOf(cam, "event.front_door_extra", "intercom_unlock")).toBe("door");
  });
});

describe("eventsFromHistory", () => {
  const start = Date.parse("2026-11-25T00:00:00Z");
  it("takes each new timestamp of an event entity, from the window on", () => {
    const rows = [
      { s: iso(start - 3600_000), a: { event_type: "ding" } },
      { s: iso(start + 60_000), a: { event_type: "ding", event_id: "abc" } },
      { s: "unavailable" },
      { s: iso(start + 120_000), a: { event_type: "ding" } },
    ];
    const out = eventsFromHistory(cam, "event.front_door_ding", rows, start);
    expect(out.map((e) => e.at)).toEqual([start + 60_000, start + 120_000]);
    expect(out[0]).toMatchObject({ kind: "ring", id: "abc" });
  });
  it("takes each change to on of a binary sensor", () => {
    const s = start / 1000;
    const rows = [
      { s: "off", lu: s - 10 },
      { s: "on", lu: s + 5 },
      { s: "on", lu: s + 6 },
      { s: "off", lu: s + 30 },
      { s: "on", lu: s + 90 },
    ];
    const out = eventsFromHistory(cam, "binary_sensor.front_person", rows, start);
    expect(out.map((e) => e.at)).toEqual([start + 5000, start + 90_000]);
    expect(out.every((e) => e.kind === "person")).toBe(true);
  });
});

describe("eventFromChange / mergeEvents", () => {
  it("adds a new event without asking the history", () => {
    const at = Date.parse("2026-11-25T10:00:00Z");
    const e = eventFromChange(cam, "event.front_door_ding", { state: iso(at - 1000), attributes: {} }, { state: iso(at), attributes: { event_type: "ding" } });
    expect(e).toMatchObject({ kind: "ring", at });
    expect(eventFromChange(cam, "binary_sensor.front_person", { state: "on", attributes: {} }, { state: "off", attributes: {} })).toBeUndefined();
  });
  it("sorts newest first, keeps each event once and drops the old", () => {
    const a = [{ entity: "x", kind: "motion" as const, at: 10 }, { entity: "x", kind: "motion" as const, at: 30 }];
    const b = [{ entity: "x", kind: "motion" as const, at: 30 }, { entity: "y", kind: "ring" as const, at: 20 }, { entity: "x", kind: "motion" as const, at: 1 }];
    expect(mergeEvents(a, b, 5).map((e) => e.at)).toEqual([30, 20, 10]);
  });
});

describe("lastRingAt / currentDetection", () => {
  const now = Date.parse("2026-11-25T10:00:00Z");
  it("reads the ring from the doorbell's state", () => {
    expect(lastRingAt(cam, { "event.front_door_ding": { state: iso(now - 5000), attributes: {} } })).toBe(now - 5000);
    expect(lastRingAt(cam, { "event.front_door_ding": { state: "unknown", attributes: {} } })).toBeUndefined();
    expect(lastRingAt({ camera: "camera.x" }, {})).toBeUndefined();
  });
  it("puts a person before motion, and lets an event entity's detection pass", () => {
    const states = {
      "binary_sensor.front_person": { state: "on", attributes: {}, last_changed: iso(now - 2000) },
      "event.front_door_motion": { state: iso(now - 1000), attributes: {} },
    };
    expect(currentDetection(cam, states, now, 60_000)?.kind).toBe("person");
    const later = { ...states, "binary_sensor.front_person": { state: "off", attributes: {} } };
    expect(currentDetection(cam, later, now, 60_000)?.kind).toBe("motion");
    expect(currentDetection(cam, later, now + 120_000, 60_000)).toBeUndefined();
  });
});

describe("fillEventTemplate", () => {
  const ev = { entity: "event.front_door_ding", kind: "ring" as const, at: 1_700_000_000_000, id: "1700000000.12-ab" };
  it("fills the variables", () => {
    expect(fillEventTemplate("/api/frigate/notifications/{id}/thumbnail.jpg", cam, ev)).toBe("/api/frigate/notifications/1700000000.12-ab/thumbnail.jpg");
    expect(fillEventTemplate("/x/{camera}/{timestamp}", cam, ev)).toBe("/x/front_door/1700000000");
  });
  it("gives no URL when it needs an id the event does not have", () => {
    expect(fillEventTemplate("/x/{id}.jpg", cam, { ...ev, id: undefined })).toBeUndefined();
  });
});
