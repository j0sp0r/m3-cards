import { describe, expect, it } from "vitest";
import { hashMatches, normalizeHash, popupCardSpan, withoutHash } from "./popup-hash";

describe("normalizeHash", () => {
  it("accepts the hash with or without its #", () => {
    expect(normalizeHash("remotes")).toBe("#remotes");
    expect(normalizeHash("#remotes")).toBe("#remotes");
    expect(normalizeHash("  ##remotes ")).toBe("#remotes");
  });

  it("has nothing for an empty or missing hash", () => {
    expect(normalizeHash("")).toBeUndefined();
    expect(normalizeHash("#")).toBeUndefined();
    expect(normalizeHash(undefined)).toBeUndefined();
    expect(normalizeHash(42)).toBeUndefined();
  });
});

describe("hashMatches", () => {
  it("matches its own hash only", () => {
    expect(hashMatches("#remotes", "#remotes")).toBe(true);
    expect(hashMatches("#remotes2", "#remotes")).toBe(false);
    expect(hashMatches("", "#remotes")).toBe(false);
    expect(hashMatches("#remotes", undefined)).toBe(false);
  });

  it("reads a percent-encoded hash as typed", () => {
    // The browser encodes what a navigate action wrote: #küche is #k%C3%BCche.
    expect(hashMatches("#k%C3%BCche", "#küche")).toBe(true);
    expect(hashMatches("#%E0%A4%A", "#%E0%A4%A")).toBe(true);
  });
});

describe("withoutHash", () => {
  it("keeps the path and the query", () => {
    expect(withoutHash({ pathname: "/lovelace/0", search: "?edit=1" })).toBe("/lovelace/0?edit=1");
  });
});

describe("popupCardSpan", () => {
  it("reads grid_options.columns as a sections view does", () => {
    expect(popupCardSpan({ grid_options: { columns: 6 } })).toBe(6);
    expect(popupCardSpan({ grid_options: { columns: "full" } })).toBe(12);
    expect(popupCardSpan({ grid_options: { columns: 30 } })).toBe(12);
    expect(popupCardSpan({ grid_options: { columns: 0 } })).toBe(1);
  });

  it("reads the older layout_options, which counted four columns", () => {
    expect(popupCardSpan({ layout_options: { grid_columns: 2 } })).toBe(6);
    expect(popupCardSpan({ layout_options: { grid_columns: "full" } })).toBe(12);
  });

  it("takes the full width when the card says nothing", () => {
    expect(popupCardSpan({ type: "tile" })).toBe(12);
    expect(popupCardSpan(undefined)).toBe(12);
  });
});
