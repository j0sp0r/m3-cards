import { describe, it, expect } from "vitest";
import { positionDropdown } from "./dropdown-menu";

const VIEWPORT = { width: 400, height: 800 };
const MENU = { width: 200, height: 160 };

describe("positionDropdown", () => {
  it("opens below the anchor and centers on it when there is room", () => {
    const { left, top, placement } = positionDropdown(
      { top: 100, left: 150, width: 40, height: 38 },
      MENU,
      VIEWPORT,
    );
    expect(placement).toBe("below");
    expect(top).toBe(100 + 38 + 6);
    expect(left).toBe(150 + 20 - 100);
  });

  it("flips above the anchor when the menu would run off the bottom", () => {
    const { top, placement } = positionDropdown(
      { top: 700, left: 150, width: 40, height: 38 },
      MENU,
      VIEWPORT,
    );
    expect(placement).toBe("above");
    expect(top).toBe(700 - 6 - 160);
  });

  it("stays below when neither side fits, clamped into the viewport", () => {
    const tall = { width: 200, height: 780 };
    const { top, placement } = positionDropdown(
      { top: 300, left: 150, width: 40, height: 38 },
      tall,
      VIEWPORT,
    );
    expect(placement).toBe("below");
    // Pulled up so the bottom edge keeps its margin too.
    expect(top).toBe(VIEWPORT.height - 8 - tall.height);
  });

  it("clamps horizontally instead of hanging off the screen edge", () => {
    const nearLeft = positionDropdown(
      { top: 100, left: 0, width: 40, height: 38 },
      MENU,
      VIEWPORT,
    );
    expect(nearLeft.left).toBe(8);

    const nearRight = positionDropdown(
      { top: 100, left: 360, width: 40, height: 38 },
      MENU,
      VIEWPORT,
    );
    expect(nearRight.left).toBe(400 - 8 - 200);
  });
});
