/// <reference types="vite/client" />
import { describe, expect, it, vi } from "vitest";
import { openEntityDetail } from "./entity-detail";

/**
 * Forty call sites used to fire `hass-more-info` themselves. A card that goes
 * back to doing so keeps working and silently ignores whatever the suite later
 * decides "details" means, so the walk below fails instead.
 *
 * Read through `import.meta.glob` for the same reason as localize.test.ts: no
 * `@types/node` needed.
 */
const SOURCES = import.meta.glob(["../**/*.ts", "!../**/*.test.ts", "!../graphify-out/**"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Allowed to name the event: the door itself, and a listener that only watches it. */
const ALLOWED = new Set(["./entity-detail.ts", "./focus-anchor.ts"]);

describe("openEntityDetail", () => {
  it("fires a composed, bubbling hass-more-info for the entity", () => {
    const host = new EventTarget();
    const seen = vi.fn();
    host.addEventListener("hass-more-info", (e) => {
      const ev = e as CustomEvent;
      seen(ev.detail, ev.bubbles, ev.composed);
    });
    openEntityDetail(host, "sensor.x");
    expect(seen).toHaveBeenCalledWith({ entityId: "sensor.x" }, true, true);
  });

  it("does nothing without an entity", () => {
    const host = new EventTarget();
    const seen = vi.fn();
    host.addEventListener("hass-more-info", seen);
    openEntityDetail(host, undefined);
    openEntityDetail(host, "");
    expect(seen).not.toHaveBeenCalled();
  });

  it("is the only place that dispatches hass-more-info", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(40);
    const offenders = Object.entries(SOURCES)
      .filter(([path, src]) => !ALLOWED.has(path) && src.includes('"hass-more-info"'))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
