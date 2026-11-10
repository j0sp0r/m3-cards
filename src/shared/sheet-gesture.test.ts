import { describe, expect, it } from "vitest";
import { contentTouchIsSheetDrag } from "./sheet-gesture";

describe("contentTouchIsSheetDrag (#50)", () => {
  it("claims a downward swipe on content at its top", () => {
    expect(contentTouchIsSheetDrag(0, 6, false)).toBe(true);
    expect(contentTouchIsSheetDrag(-3, 4, false)).toBe(true);
  });

  it("leaves an upward swipe to the content's scrolling", () => {
    expect(contentTouchIsSheetDrag(0, -6, false)).toBe(false);
  });

  it("leaves a sideways swipe to the content", () => {
    expect(contentTouchIsSheetDrag(8, 3, false)).toBe(false);
    expect(contentTouchIsSheetDrag(-8, 3, false)).toBe(false);
  });

  it("leaves a downward swipe in a list scrolled away from its top", () => {
    expect(contentTouchIsSheetDrag(0, 6, true)).toBe(false);
  });
});
