import { describe, expect, it } from "vitest";
import { smartChipWidths } from "./chip-buttons";

describe("smartChipWidths", () => {
  it("shares spare room evenly on top of each content width", () => {
    expect(smartChipWidths([200, 80, 60], 400)).toEqual([220, 100, 80]);
  });

  it("cuts only the long chip when the row is too narrow", () => {
    // The screenshot case: a long lock chip next to two short sensor chips.
    expect(smartChipWidths([260, 100, 90], 360)).toEqual([170, 100, 90]);
  });

  it("caps every chip that is over the fair share, not just the widest", () => {
    expect(smartChipWidths([300, 200, 50], 350)).toEqual([150, 150, 50]);
  });

  it("splits evenly when nothing is under the fair share", () => {
    expect(smartChipWidths([200, 200], 300)).toEqual([150, 150]);
  });

  it("never widens a fixed chip", () => {
    expect(smartChipWidths([100, 36, 64], 260, [false, true, false])).toEqual([130, 36, 94]);
  });

  it("fills the row exactly", () => {
    const widths = smartChipWidths([310, 95, 42, 180], 500);
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(500);
  });
});
