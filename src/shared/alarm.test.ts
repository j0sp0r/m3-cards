import { describe, it, expect } from "vitest";
import type { HassEntity } from "../types";
import {
  alarmChangedBy,
  alarmCountdown,
  alarmMode,
  alarmPhase,
  alarmSensors,
  alarmService,
  codeFormat,
  codeNeeded,
  resolveModes,
  secondsLeft,
  supportedModes,
} from "./alarm";

const panel = (state: string, attributes: Record<string, unknown> = {}, lastChanged = "2026-11-09T18:00:00Z") =>
  ({ entity_id: "alarm_control_panel.test", state, attributes, last_changed: lastChanged, last_updated: lastChanged }) as unknown as HassEntity;

describe("alarmPhase", () => {
  it("maps every armed state to armed and the rest by name", () => {
    expect(alarmPhase("armed_away")).toBe("armed");
    expect(alarmPhase("armed_custom_bypass")).toBe("armed");
    for (const s of ["disarmed", "arming", "pending", "triggered", "disarming"]) expect(alarmPhase(s)).toBe(s);
  });

  it("treats unavailable, unknown and missing alike", () => {
    expect(alarmPhase("unavailable")).toBe("unavailable");
    expect(alarmPhase("unknown")).toBe("unavailable");
    expect(alarmPhase(undefined)).toBe("unavailable");
  });
});

describe("modes", () => {
  it("reads the supported modes from the feature bits, disarmed always first", () => {
    expect(supportedModes(panel("disarmed", { supported_features: 1 | 2 }))).toEqual(["disarmed", "armed_home", "armed_away"]);
    expect(supportedModes(panel("disarmed", { supported_features: 63 }))).toHaveLength(6);
  });

  it("offers everything when the panel lists no features", () => {
    expect(supportedModes(panel("disarmed"))).toHaveLength(6);
  });

  it("shows at most four by default", () => {
    expect(resolveModes(undefined, panel("disarmed", { supported_features: 63 })).map((m) => m.mode)).toEqual([
      "disarmed",
      "armed_home",
      "armed_away",
      "armed_night",
    ]);
  });

  it("takes a configured list as written, dropping unknown and doubled entries", () => {
    const modes = resolveModes(
      ["armed_away", { mode: "disarmed", name: "Aus", icon: "mdi:lock-open" }, "nonsense" as never, "armed_away"],
      panel("disarmed", { supported_features: 1 }),
    );
    expect(modes).toEqual([{ mode: "armed_away" }, { mode: "disarmed", name: "Aus", icon: "mdi:lock-open" }]);
  });

  it("names the mode armed into, or the one being armed into", () => {
    expect(alarmMode(panel("armed_night"))).toBe("armed_night");
    expect(alarmMode(panel("arming", { next_state: "armed_away" }))).toBe("armed_away");
    expect(alarmMode(panel("arming", { arm_mode: "armed_home" }))).toBe("armed_home");
    expect(alarmMode(panel("arming"))).toBeUndefined();
  });

  it("maps modes to their services", () => {
    expect(alarmService("disarmed")).toBe("alarm_disarm");
    expect(alarmService("armed_away")).toBe("alarm_arm_away");
    expect(alarmService("armed_custom_bypass")).toBe("alarm_arm_custom_bypass");
  });
});

describe("alarmCountdown", () => {
  const start = Date.parse("2026-11-09T18:00:00Z");

  it("counts down from last_changed when the delay is known", () => {
    const c = alarmCountdown(panel("arming", { delay: 30 }));
    expect(c).toEqual({ endsAt: start + 30_000, total: 30_000 });
    expect(secondsLeft(c!, start + 10_500)).toBe(20);
    expect(secondsLeft(c!, start + 60_000)).toBe(0);
  });

  it("has nothing to count without a delay, or outside arming and pending", () => {
    expect(alarmCountdown(panel("arming"))).toBeUndefined();
    expect(alarmCountdown(panel("pending", { delay: 0 }))).toBeUndefined();
    expect(alarmCountdown(panel("armed_away", { delay: 30 }))).toBeUndefined();
  });
});

describe("codes", () => {
  it("asks for a code to disarm whenever the panel has a format", () => {
    expect(codeNeeded(panel("armed_away", { code_format: "number" }), "disarm")).toBe(true);
    expect(codeNeeded(panel("armed_away", {}), "disarm")).toBe(false);
  });

  it("asks for one to arm only with code_arm_required, which defaults to true", () => {
    expect(codeNeeded(panel("disarmed", { code_format: "number", code_arm_required: false }), "arm")).toBe(false);
    expect(codeNeeded(panel("disarmed", { code_format: "text", code_arm_required: true }), "arm")).toBe(true);
    expect(codeNeeded(panel("disarmed", { code_format: "number" }), "arm")).toBe(true);
  });

  it("knows only the two formats Home Assistant defines", () => {
    expect(codeFormat(panel("disarmed", { code_format: "number" }))).toBe("number");
    expect(codeFormat(panel("disarmed", { code_format: "text" }))).toBe("text");
    expect(codeFormat(panel("disarmed", { code_format: null }))).toBeUndefined();
  });
});

describe("alarmSensors", () => {
  const states = {
    "binary_sensor.door": { state: "on" },
    "binary_sensor.window": { state: "off" },
    "binary_sensor.gone": { state: "unavailable" },
  } as unknown as Record<string, HassEntity>;

  it("prefers Alarmo's open_sensors, as an object or a list", () => {
    expect(alarmSensors(panel("disarmed", { open_sensors: { "binary_sensor.x": "on" } }), [], states)).toEqual({ open: ["binary_sensor.x"], ok: 0 });
    expect(alarmSensors(panel("disarmed", { open_sensors: ["binary_sensor.y"] }), [], states).open).toEqual(["binary_sensor.y"]);
  });

  it("falls back to the configured sensors, leaving out ones without a reading", () => {
    expect(alarmSensors(panel("disarmed"), ["binary_sensor.door", "binary_sensor.window", "binary_sensor.gone"], states)).toEqual({
      open: ["binary_sensor.door"],
      ok: 1,
    });
  });

  it("reads changed_by when it says something", () => {
    expect(alarmChangedBy(panel("triggered", { changed_by: "Haustür" }))).toBe("Haustür");
    expect(alarmChangedBy(panel("triggered", { changed_by: " " }))).toBeUndefined();
  });
});
