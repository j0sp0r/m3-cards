import { describe, it, expect } from "vitest";
import { resolveActionGlow, actionGlowColor } from "./action-glow";
import { ACTION_GLOW_COLOR_HEAT, ACTION_GLOW_COLOR_COOL } from "../const";

describe("resolveActionGlow", () => {
  it("reads hvac_action when the integration provides it", () => {
    expect(resolveActionGlow({ hvac_action: "heating" }, "heat", false)).toEqual({
      state: "heat",
      running: true,
    });
    expect(resolveActionGlow({ hvac_action: "cooling" }, "cool", false)).toEqual({
      state: "cool",
      running: true,
    });
  });

  it("dims to the armed frame when the mode is heat/cool but hvac_action is idle", () => {
    // Homematic's eTRV/HEATING sit at "idle" for months while the mode stays
    // "heat" — the frame has to keep saying something there.
    expect(resolveActionGlow({ hvac_action: "idle" }, "heat", false)).toEqual({
      state: "heat",
      running: false,
    });
    expect(resolveActionGlow({ hvac_action: "idle" }, "cool", false)).toEqual({
      state: "cool",
      running: false,
    });
  });

  it("shows nothing when hvac_action is idle and the mode is not heat/cool", () => {
    expect(resolveActionGlow({ hvac_action: "idle" }, "off", false)).toEqual({
      state: null,
      running: false,
    });
    expect(resolveActionGlow({ hvac_action: "fan" }, "fan_only", false)).toEqual({
      state: null,
      running: false,
    });
  });

  it("gives the mode a full-strength frame when hvac_action is absent", () => {
    // Nothing better to go on, so these must not sit permanently dimmed.
    expect(resolveActionGlow({}, "heat", false)).toEqual({ state: "heat", running: true });
    expect(resolveActionGlow({}, "cool", false)).toEqual({ state: "cool", running: true });
    expect(resolveActionGlow({}, "off", false)).toEqual({ state: null, running: false });
    expect(resolveActionGlow({}, "fan_only", false)).toEqual({ state: null, running: false });
  });

  it("is always off while unavailable, regardless of attributes", () => {
    expect(resolveActionGlow({ hvac_action: "heating" }, "heat", true)).toEqual({
      state: null,
      running: false,
    });
  });
});

describe("actionGlowColor", () => {
  it("maps heat/cool states to the suite's existing palette colors", () => {
    expect(actionGlowColor("heat")).toBe(ACTION_GLOW_COLOR_HEAT);
    expect(actionGlowColor("cool")).toBe(ACTION_GLOW_COLOR_COOL);
  });
});
