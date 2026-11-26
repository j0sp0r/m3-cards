import { describe, expect, it } from "vitest";
import { SWIPE_PLUGIN_SKIP } from "./swipe";

// hass-swipe-navigation listens in the capture phase since 1.16.3, so the
// `stopSwipe` binding alone no longer keeps it away from a drag zone; the
// class it skips by has to be on the element too. See shared/swipe.ts.
const SOURCES = import.meta.glob("../**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("swipe shield", () => {
  it("every drag zone that binds stopSwipe also carries the plugin's skip class", () => {
    const missing: string[] = [];
    for (const [file, src] of Object.entries(SOURCES)) {
      if (file.includes(".test.")) continue;
      for (const m of src.matchAll(/@touchstart=\$\{(?:this\._)?stopSwipe\}/g)) {
        const start = src.lastIndexOf("<", m.index);
        const tag = src.slice(start, m.index);
        if (!tag.startsWith("<") || /^<\s*$/.test(tag)) continue;
        if (!tag.includes(SWIPE_PLUGIN_SKIP)) missing.push(`${file}:${src.slice(0, start).split("\n").length}`);
      }
    }
    // The example in swipe.ts's own comment is not a template.
    expect(missing.filter((m) => !m.includes("shared/swipe.ts"))).toEqual([]);
  });

  it("every element that scrolls sideways carries the skip class, so a swipe on it never changes the view", () => {
    const missing: string[] = [];
    for (const [file, src] of Object.entries(SOURCES)) {
      if (file.includes(".test.")) continue;
      // A card that puts the class on its own host covers everything inside it.
      if (/classList\.add\(SWIPE_PLUGIN_SKIP\)/.test(src)) continue;
      for (const rule of src.matchAll(/\n\s*([^{}\n]+)\{[^{}]*overflow-x:\s*(?:auto|scroll)/g)) {
        for (const selector of rule[1].split(",")) {
          const name = [...selector.matchAll(/\.([\w-]+)/g)].pop()?.[1];
          if (!name) continue;
          const attrs = [...src.matchAll(/class="([^"]*)"/g)].map((m) => m[1].split(/\s+/));
          const uses = attrs.filter((classes) => classes.includes(name));
          if (uses.length && !uses.every((classes) => classes.includes(SWIPE_PLUGIN_SKIP))) missing.push(`${file}: .${name}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
