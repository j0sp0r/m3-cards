/// <reference types="vite/client" />
import { describe, expect, it, vi } from "vitest";
import { openEntityDetail, openEntitySettings, registerDetailSheet } from "./entity-detail";

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

  it("hands a sheet-mode card to the registered sheet, and falls back when it declines", () => {
    const opened: string[] = [];
    registerDetailSheet({
      open: (_host, id) => {
        opened.push(id);
        return id !== "update.core";
      },
      forward: () => undefined,
      close: () => undefined,
    });
    const host = Object.assign(new EventTarget(), { _config: { detail_mode: "sheet" } });
    const fired = vi.fn();
    host.addEventListener("hass-more-info", fired);

    openEntityDetail(host, "sensor.x");
    expect(opened).toEqual(["sensor.x"]);
    expect(fired).not.toHaveBeenCalled();

    openEntityDetail(host, "update.core");
    expect(fired).toHaveBeenCalledTimes(1);

    // No option set: the sheet is never asked.
    const plain = new EventTarget();
    plain.addEventListener("hass-more-info", fired);
    openEntityDetail(plain, "sensor.y");
    expect(opened).not.toContain("sensor.y");
    expect(fired).toHaveBeenCalledTimes(2);
  });

  it("opens the settings view of more-info", () => {
    const host = new EventTarget();
    const seen = vi.fn();
    host.addEventListener("hass-more-info", (e) => seen((e as CustomEvent).detail));
    openEntitySettings(host, "sensor.x");
    expect(seen).toHaveBeenCalledWith({ entityId: "sensor.x", view: "settings" });
  });

  it("is the only place that dispatches hass-more-info", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(40);
    const offenders = Object.entries(SOURCES)
      .filter(([path, src]) => !ALLOWED.has(path) && src.includes('"hass-more-info"'))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
