import { describe, it, expect } from "vitest";
import { findNavTemplate } from "./nav-template";

const nav = (items: string[], extra: Record<string, unknown> = {}) => ({
  type: "custom:m3-nav-card",
  items: items.map((name) => ({ name, path: `/lovelace/${name}` })),
  ...extra,
});

const dash = {
  views: [
    { path: "start", sections: [{ cards: [{ type: "heading" }, nav(["a", "b"])] }] },
    { path: "garten", cards: [{ type: "vertical-stack", cards: [nav([], { config_from: "start" })] }] },
    { path: "leer", cards: [{ type: "markdown" }] },
  ],
};

describe("findNavTemplate (#38)", () => {
  it("finds the nav card on a view by its path, in sections or nested stacks", () => {
    expect(findNavTemplate(dash, "start")?.items?.map((i) => i.name)).toEqual(["a", "b"]);
  });

  it("accepts a full path and a view index", () => {
    expect(findNavTemplate(dash, "/lovelace/start")?.items?.length).toBe(2);
    expect(findNavTemplate(dash, "0")?.items?.length).toBe(2);
  });

  it("skips a nav card that points elsewhere itself, so nothing chains", () => {
    expect(findNavTemplate(dash, "garten")).toBeUndefined();
  });

  it("is undefined for a view without a nav card, or no such view", () => {
    expect(findNavTemplate(dash, "leer")).toBeUndefined();
    expect(findNavTemplate(dash, "gibtsnicht")).toBeUndefined();
    expect(findNavTemplate(undefined, "start")).toBeUndefined();
  });
});
