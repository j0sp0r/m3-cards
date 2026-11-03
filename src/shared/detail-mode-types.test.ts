/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { NO_DETAIL_CARDS } from "./appearance-editor";

/**
 * A card config declares `detail_mode` by extending `DetailModeConfig` exactly
 * when the card opens details — the same split as `NO_DETAIL_CARDS`, which the
 * editor uses to offer the option. Read from the source, so the two cannot
 * drift apart without this failing.
 */
const TYPES = import.meta.glob("../types.ts", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;
const src = Object.values(TYPES)[0];

const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

describe("DetailModeConfig", () => {
  const configs = [...src.matchAll(/export interface M3(\w+?)Card(Mini)?Config(?: extends ([^{]+))? \{/g)].map((m) => ({
    tag: `m3-${kebab(m[1])}-card${m[2] ? "-mini" : ""}`,
    extendsIt: (m[3] ?? "").includes("DetailModeConfig"),
  }));

  it("finds the card configs", () => {
    expect(configs.length).toBeGreaterThanOrEqual(50);
  });

  it.each(configs.map((c) => [c.tag, c]))("%s declares detail_mode only if it opens details", (_tag, c) => {
    expect(c.extendsIt).toBe(!NO_DETAIL_CARDS.has(c.tag));
  });

  it("no card config declares detail_mode by hand", () => {
    expect(src.match(/^ {2}detail_mode\?: DetailMode;$/gm)?.length).toBe(1);
  });
});
