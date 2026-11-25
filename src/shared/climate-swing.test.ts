import { describe, expect, it } from "vitest";
import { currentSwingMode, swingModeIcon, swingModes } from "./climate-swing";

describe("swingModes", () => {
  const attrs = {
    supported_features: 32 | 512,
    swing_modes: ["on", "off", "both"],
    swing_horizontal_modes: ["off", "left", "right", "swing"],
    swing_mode: "both",
    swing_horizontal_mode: "left",
  };
  it("lists each axis the entity supports", () => {
    expect(swingModes(attrs, "vertical")).toEqual(["on", "off", "both"]);
    expect(swingModes(attrs, "horizontal")).toEqual(["off", "left", "right", "swing"]);
    expect(currentSwingMode(attrs, "vertical")).toBe("both");
    expect(currentSwingMode(attrs, "horizontal")).toBe("left");
  });
  it("needs the feature bit as well as the list", () => {
    expect(swingModes({ ...attrs, supported_features: 32 }, "horizontal")).toEqual([]);
    expect(swingModes({ ...attrs, supported_features: 0 }, "vertical")).toEqual([]);
  });
  it("ignores a missing or malformed list", () => {
    expect(swingModes({ supported_features: 32 }, "vertical")).toEqual([]);
    expect(swingModes({ supported_features: 32, swing_modes: "on" }, "vertical")).toEqual([]);
  });
});

describe("swingModeIcon", () => {
  it("knows HA's values and leaves others to their name", () => {
    expect(swingModeIcon("Off")).toBe("mdi:arrow-oscillating-off");
    expect(swingModeIcon("left")).toBeUndefined();
    expect(swingModeIcon(undefined)).toBeUndefined();
  });
});
