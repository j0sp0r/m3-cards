import { describe, expect, it } from "vitest";
import { temperatureColor } from "./temperature-color";
import {
  CLIMATE_OVERVIEW_COLOR_COLD,
  CLIMATE_OVERVIEW_COLOR_COMFORTABLE,
  CLIMATE_OVERVIEW_COLOR_HOT,
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
