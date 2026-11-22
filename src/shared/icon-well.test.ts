import { describe, expect, it } from "vitest";
import { iconWell, iconWellsOff } from "./icon-well";

describe("iconWell", () => {
  it("keeps the card's own background unless the theme sets one", () => {
    expect(iconWell("rgba(1, 2, 3, 0.2)")).toBe("var(--m3-icon-background, rgba(1, 2, 3, 0.2))");
  });

  it("reads wells as on without a connected host", () => {
    expect(iconWellsOff(undefined)).toBe(false);
  });
});
