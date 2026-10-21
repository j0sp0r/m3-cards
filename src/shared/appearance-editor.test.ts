/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { NO_DETAIL_CARDS, supportsDetailMode } from "./appearance-editor";

/**
 * `detail_mode` is offered in every editor whose card can open an entity's
 * details. A card can, when its source reaches the shared door to them —
 * directly, through the action runners, or through chip buttons, which run
 * actions of their own. The list of exceptions is checked against that both
 * ways: an option that does nothing is as wrong as one that is missing.
 */
const CARDS = import.meta.glob(["../m3-*-card.ts", "../m3-climate-card-mini.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// handleAction only opens details when it is handed an entity, its fourth
// argument; a call with three is a configured action and nothing more.
const DETAIL_PATH = /openEntityDetail|handleAction\([^)]*,[^)]*,[^)]*,|runHaAction\(|renderChipButtons|chipButtons/;

describe("detail_mode coverage", () => {
  const cards = Object.entries(CARDS).map(([path, src]) => ({
    tag: path.replace(/^\.\.\//, "").replace(/\.ts$/, ""),
    reaches: DETAIL_PATH.test(src),
  }));

  it("finds the cards", () => {
    expect(cards.length).toBeGreaterThan(40);
  });

  it("offers the option exactly where a card can open details", () => {
    const wrong = cards
      .filter(({ tag, reaches }) => tag !== "m3-detail-card" && supportsDetailMode(`custom:${tag}`) !== reaches)
      .map(({ tag, reaches }) => `${tag}: ${reaches ? "opens details, option missing" : "never opens details, option offered"}`);
    expect(wrong).toEqual([]);
  });

  it("lists no card that does not exist", () => {
    const tags = new Set(cards.map((c) => c.tag));
    expect([...NO_DETAIL_CARDS].filter((t) => !tags.has(t))).toEqual([]);
  });

  it("ignores anything that is not one of ours", () => {
    expect(supportsDetailMode("tile")).toBe(false);
    expect(supportsDetailMode(undefined)).toBe(false);
  });
});
