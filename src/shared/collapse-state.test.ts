import { describe, it, expect } from "vitest";
import { collapseBlocksFor, foldHides, keptWhenFolded } from "./collapse-state";

describe("foldHides", () => {
  it("hides nothing while the card is open", () => {
    expect(foldHides("camera", false, undefined)).toBe(false);
    expect(foldHides("camera", false, ["camera"])).toBe(false);
  });

  it("hides every block when collapse_blocks is absent", () => {
    // Absent is the documented default: fold everything below the controls.
    expect(foldHides("camera", true, undefined)).toBe(true);
    expect(foldHides("ams", true, undefined)).toBe(true);
  });

  it("hides only the named blocks when collapse_blocks is set", () => {
    expect(foldHides("camera", true, ["camera"])).toBe(true);
    expect(foldHides("ams", true, ["camera"])).toBe(false);
  });

  it("never hides a pinned block, whatever the config says", () => {
    // The printer's socket while offline: the one control that brings it back.
    expect(foldHides("details", true, undefined, ["details"])).toBe(false);
    expect(foldHides("details", true, ["details"], ["details"])).toBe(false);
  });
});

describe("the editor's kept list", () => {
  const all = ["progress", "sliders", "chips"] as const;

  it("keeps nothing when everything folds, and the reverse", () => {
    expect(keptWhenFolded(all, undefined)).toEqual([]);
    expect(collapseBlocksFor(all, [])).toBeUndefined();
  });

  it("keeps the progress by folding the rest", () => {
    expect(collapseBlocksFor(all, ["progress"])).toEqual(["sliders", "chips"]);
    expect(keptWhenFolded(all, ["sliders", "chips"])).toEqual(["progress"]);
  });

  it("keeping everything folds nothing", () => {
    expect(collapseBlocksFor(all, [...all])).toEqual([]);
  });
});
