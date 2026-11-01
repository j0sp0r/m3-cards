import { describe, expect, it } from "vitest";
import { outdoorTemperatureColor, outdoorTemperatureGradient, temperatureColor } from "./temperature-color";
import {
  CLIMATE_OVERVIEW_COLOR_COLD,
  CLIMATE_OVERVIEW_COLOR_COMFORTABLE,
  CLIMATE_OVERVIEW_COLOR_HOT,
  WEATHER_TEMP_SCALE,
} from "../const";

describe("temperatureColor", () => {
  it("colours by stage, with the climate overview's colours", () => {
    expect(temperatureColor(12.1)).toBe(CLIMATE_OVERVIEW_COLOR_COLD);
    expect(temperatureColor(21.4)).toBe(CLIMATE_OVERVIEW_COLOR_COMFORTABLE);
    expect(temperatureColor(29)).toBe(CLIMATE_OVERVIEW_COLOR_HOT);
  });

  it("converts Fahrenheit before staging", () => {
    expect(temperatureColor(70, "°F")).toBe(CLIMATE_OVERVIEW_COLOR_COMFORTABLE);
  });

  it("has nothing for a missing value", () => {
    expect(temperatureColor(Number.NaN)).toBeUndefined();
  });
});

describe("outdoorTemperatureColor", () => {
  it("is blue on a cold day and red only on a hot one", () => {
    expect(outdoorTemperatureColor(-8)).toBe(CLIMATE_OVERVIEW_COLOR_COLD);
    expect(outdoorTemperatureColor(0)).toBe(CLIMATE_OVERVIEW_COLOR_COLD);
    expect(outdoorTemperatureColor(35)).toBe(CLIMATE_OVERVIEW_COLOR_HOT);
  });

  it("hits each stop exactly and blends between them", () => {
    for (const [t, c] of WEATHER_TEMP_SCALE) expect(outdoorTemperatureColor(t)).toBe(c);
    const mid = outdoorTemperatureColor(5);
    expect(mid).not.toBe(WEATHER_TEMP_SCALE[0][1]);
    expect(mid).not.toBe(WEATHER_TEMP_SCALE[1][1]);
  });

  it("converts Fahrenheit", () => {
    expect(outdoorTemperatureColor(32, "°F")).toBe(CLIMATE_OVERVIEW_COLOR_COLD);
    expect(outdoorTemperatureColor(86, "°F")).toBe(CLIMATE_OVERVIEW_COLOR_HOT);
  });
});

describe("outdoorTemperatureGradient", () => {
  it("passes through the stops a bar crosses, at their place", () => {
    const g = outdoorTemperatureGradient(5, 20);
    expect(g).toContain(`${WEATHER_TEMP_SCALE[1][1]} 33.3%`);
    expect(g).toContain(`${WEATHER_TEMP_SCALE[2][1]} 80.0%`);
  });

  it("is a flat colour for a day without a spread", () => {
    expect(outdoorTemperatureGradient(10, 10)).toBe(WEATHER_TEMP_SCALE[1][1]);
  });
});
