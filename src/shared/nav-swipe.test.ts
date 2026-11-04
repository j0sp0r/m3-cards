import { describe, it, expect } from "vitest";
import { swipeOutcome, swipeShown, SWIPE_RUBBER_BAND } from "./nav-swipe";

const both = { hasPrev: true, hasNext: true };

describe("swipeOutcome", () => {
  it("a leftward drag past the share goes to the next entry", () => {
    expect(swipeOutcome({ dx: -50, velocity: 0, distance: 100, ...both })).toBe("next");
  });

  it("a rightward drag goes to the previous one", () => {
    expect(swipeOutcome({ dx: 60, velocity: 0, distance: 100, ...both })).toBe("prev");
  });

  it("a short slow drag springs back", () => {
    expect(swipeOutcome({ dx: -30, velocity: -0.1, distance: 100, ...both })).toBeUndefined();
  });

  it("a short fast flick commits", () => {
    expect(swipeOutcome({ dx: -30, velocity: -0.8, distance: 100, ...both })).toBe("next");
  });

  it("a flick that turned back does not", () => {
    expect(swipeOutcome({ dx: -30, velocity: 0.8, distance: 100, ...both })).toBeUndefined();
  });

  it("there is nothing past the last entry", () => {
    expect(swipeOutcome({ dx: -90, velocity: -1, distance: 100, hasPrev: true, hasNext: false })).toBeUndefined();
  });
});

describe("swipeShown", () => {
  it("follows the finger up to the neighbour", () => {
    expect(swipeShown({ dx: -40, distance: 100, ...both })).toBe(-40);
    expect(swipeShown({ dx: -140, distance: 100, ...both })).toBe(-100);
  });

  it("rubber-bands past the end", () => {
    expect(swipeShown({ dx: 40, distance: 0, hasPrev: false, hasNext: true })).toBe(40 * SWIPE_RUBBER_BAND);
  });
});
