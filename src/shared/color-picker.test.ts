import { describe, expect, it } from "vitest";
import { kelvinToRgb, lightColorHex } from "./color-picker";

describe("lightColorHex", () => {
  it("takes rgb_color first", () => {
    expect(lightColorHex({ rgb_color: [255, 0, 0], hs_color: [240, 100] })).toBe("#ff0000");
  });
  it("falls back to hs_color", () => {
    expect(lightColorHex({ hs_color: [120, 100] })).toBe("#00ff00");
  });
  it("falls back to the colour temperature", () => {
    const warm = lightColorHex({ color_temp_kelvin: 2700 });
    expect(warm).toMatch(/^#ff[0-9a-f]{4}$/);
  });
  it("is undefined for a light without colour", () => {
    expect(lightColorHex({ brightness: 200 })).toBeUndefined();
    expect(lightColorHex({ rgb_color: null })).toBeUndefined();
  });
});

describe("kelvinToRgb", () => {
  it("is warm at 2700 K and bluish at 10000 K", () => {
    const [r, , b] = kelvinToRgb(2700);
    expect(r).toBe(255);
    expect(b).toBeLessThan(200);
    const [r2, , b2] = kelvinToRgb(10000);
    expect(b2).toBe(255);
    expect(r2).toBeLessThan(255);
  });
});
