import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ensureHaCardDefined } from "./card-helpers";

// A stand-in for the browser's registry: `define` resolves pending
// `whenDefined` promises, as the real one does.
function fakeRegistry(initial: string[] = []) {
  const defined = new Set(initial);
  const waiting = new Map<string, (() => void)[]>();
  return {
    get: (tag: string) => (defined.has(tag) ? class {} : undefined),
    whenDefined: (tag: string) =>
      defined.has(tag)
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            waiting.set(tag, [...(waiting.get(tag) ?? []), resolve]);
          }),
    define: (tag: string) => {
      defined.add(tag);
      for (const resolve of waiting.get(tag) ?? []) resolve();
      waiting.delete(tag);
    },
  };
}

const MAP = { type: "map", entities: [{ entity: "person.a" }] };

describe("ensureHaCardDefined", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("returns at once when the tag is already defined, without the helpers", async () => {
    const loadCardHelpers = vi.fn();
    vi.stubGlobal("customElements", fakeRegistry(["hui-map-card"]));
    vi.stubGlobal("window", { loadCardHelpers });

    await expect(ensureHaCardDefined("hui-map-card", MAP)).resolves.toBe(true);
    expect(loadCardHelpers).not.toHaveBeenCalled();
  });

  it("asks HA to build the card, then resolves once the tag is defined (#26)", async () => {
    const registry = fakeRegistry();
    // HA's lazy loader: building a map card imports the module, which
    // registers the tag a moment later.
    const createCardElement = vi.fn(() => {
      queueMicrotask(() => registry.define("hui-map-card"));
      return {} as HTMLElement;
    });
    vi.stubGlobal("customElements", registry);
    vi.stubGlobal("window", {
      loadCardHelpers: async () => ({ createCardElement }),
      setTimeout,
      clearTimeout,
    });

    await expect(ensureHaCardDefined("hui-map-card", MAP)).resolves.toBe(true);
    expect(createCardElement).toHaveBeenCalledWith(MAP);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("warns and resolves false when loadCardHelpers is missing", async () => {
    vi.stubGlobal("customElements", fakeRegistry());
    vi.stubGlobal("window", {});

    await expect(ensureHaCardDefined("hui-map-card", MAP)).resolves.toBe(false);
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it("warns and resolves false when the helpers throw", async () => {
    vi.stubGlobal("customElements", fakeRegistry());
    vi.stubGlobal("window", {
      loadCardHelpers: async () => ({
        createCardElement: () => {
          throw new Error("boom");
        },
      }),
    });

    await expect(ensureHaCardDefined("hui-map-card", MAP)).resolves.toBe(false);
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it("gives up with a warning when the tag never arrives", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("customElements", fakeRegistry());
    vi.stubGlobal("window", {
      loadCardHelpers: async () => ({ createCardElement: () => ({}) as HTMLElement }),
      setTimeout,
      clearTimeout,
    });

    const result = ensureHaCardDefined("hui-map-card", MAP, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toBe(false);
    expect(console.warn).toHaveBeenCalledOnce();
  });
});
