import { describe, it, expect, vi } from "vitest";
import { runHaAction, safeActionUrl, type RunActionContext } from "./actions";
import type { HomeAssistant } from "../types";

function fakeHass(): { hass: HomeAssistant; callService: ReturnType<typeof vi.fn> } {
  const callService = vi.fn().mockResolvedValue(undefined);
  return { hass: { callService } as unknown as HomeAssistant, callService };
}

function fakeCtx(overrides: Partial<RunActionContext> = {}): RunActionContext {
  return {
    entityId: "light.a",
    fireMoreInfo: vi.fn(),
    navigate: vi.fn(),
    ...overrides,
  };
}

describe("runHaAction", () => {
  it("defaults to more-info when no action is configured", () => {
    const { hass } = fakeHass();
    const ctx = fakeCtx();
    runHaAction(hass, undefined, ctx);
    expect(ctx.fireMoreInfo).toHaveBeenCalledWith("light.a");
  });

  it("none does nothing", () => {
    const { hass, callService } = fakeHass();
    const ctx = fakeCtx();
    runHaAction(hass, { action: "none" }, ctx);
    expect(callService).not.toHaveBeenCalled();
    expect(ctx.fireMoreInfo).not.toHaveBeenCalled();
  });

  it("toggle calls homeassistant.toggle on entityId by default", () => {
    const { hass, callService } = fakeHass();
    runHaAction(hass, { action: "toggle" }, fakeCtx());
    expect(callService).toHaveBeenCalledWith("homeassistant", "toggle", { entity_id: "light.a" });
  });

  it("toggle prefers ctx.toggle() when provided, and skips the service call", () => {
    const { hass, callService } = fakeHass();
    const toggle = vi.fn();
    runHaAction(hass, { action: "toggle" }, fakeCtx({ toggle }));
    expect(toggle).toHaveBeenCalledOnce();
    expect(callService).not.toHaveBeenCalled();
  });

  it("popup calls ctx.openPopup when provided, and no-ops otherwise", () => {
    const { hass } = fakeHass();
    const openPopup = vi.fn();
    runHaAction(hass, { action: "popup" }, fakeCtx({ openPopup }));
    expect(openPopup).toHaveBeenCalledOnce();
    expect(() => runHaAction(hass, { action: "popup" }, fakeCtx())).not.toThrow();
  });

  it("perform-action calls the split domain.service with target/data merged", () => {
    const { hass, callService } = fakeHass();
    runHaAction(
      hass,
      { action: "perform-action", perform_action: "light.turn_on", data: { brightness: 128 } },
      fakeCtx(),
    );
    expect(callService).toHaveBeenCalledWith("light", "turn_on", {
      entity_id: "light.a",
      brightness: 128,
    });
  });

  it("navigate calls ctx.navigate with the configured path", () => {
    const { hass } = fakeHass();
    const ctx = fakeCtx();
    runHaAction(hass, { action: "navigate", navigation_path: "/lovelace/0" }, ctx);
    expect(ctx.navigate).toHaveBeenCalledWith("/lovelace/0");
  });
});

// handleAction has honoured `confirmation` since 2.3; runHaAction arrived from
// a fork that branched before that and did not. A "restart Home Assistant"
// action configured to ask would have fired on the first tap through this
// path, which is the one case it was configured not to.
describe("runHaAction confirmation", () => {
  // These suites run in Vitest's node environment, where there is no `window`
  // at all — so one is stood up for the duration rather than pulling in a DOM
  // implementation for a single global.
  const withConfirm = (answer: boolean, run: () => void) => {
    const holder = globalThis as { window?: { confirm?: unknown } };
    const hadWindow = "window" in holder;
    const originalWindow = holder.window;
    const spy = vi.fn().mockReturnValue(answer);
    holder.window = { ...(originalWindow ?? {}), confirm: spy };
    try {
      run();
    } finally {
      if (hadWindow) holder.window = originalWindow;
      else delete holder.window;
    }
    return spy;
  };

  it("does not act when the confirmation is declined", () => {
    const { hass, callService } = fakeHass();
    withConfirm(false, () =>
      runHaAction(
        hass,
        { action: "perform-action", perform_action: "homeassistant.restart", confirmation: true },
        fakeCtx(),
      ),
    );
    expect(callService).not.toHaveBeenCalled();
  });

  it("acts once the confirmation is accepted", () => {
    const { hass, callService } = fakeHass();
    withConfirm(true, () =>
      runHaAction(
        hass,
        { action: "perform-action", perform_action: "homeassistant.restart", confirmation: true },
        fakeCtx(),
      ),
    );
    expect(callService).toHaveBeenCalledWith("homeassistant", "restart", { entity_id: "light.a" });
  });

  it("gates the hooks too, not only service calls", () => {
    const openPopup = vi.fn();
    const toggle = vi.fn();
    withConfirm(false, () => {
      runHaAction(fakeHass().hass, { action: "popup", confirmation: true }, fakeCtx({ openPopup }));
      runHaAction(fakeHass().hass, { action: "toggle", confirmation: true }, fakeCtx({ toggle }));
    });
    expect(openPopup).not.toHaveBeenCalled();
    expect(toggle).not.toHaveBeenCalled();
  });

  it("asks nothing when no confirmation is configured", () => {
    const { hass, callService } = fakeHass();
    const spy = withConfirm(false, () =>
      runHaAction(hass, { action: "toggle" }, fakeCtx()),
    );
    expect(spy).not.toHaveBeenCalled();
    expect(callService).toHaveBeenCalled();
  });
});

/**
 * A `url` action's target is opened with window.open, which executes a
 * `javascript:` payload in the page's own context. Cards resolve templates
 * anywhere in their config, so the value can come from an entity's state —
 * i.e. from whoever is able to write that entity. Raised in the HACS review.
 */
describe("safeActionUrl", () => {
  const BASE = "http://homeassistant.local:8123/lovelace/0";

  it("keeps an ordinary external link", () => {
    expect(safeActionUrl("https://example.com/x?y=1", BASE)).toBe("https://example.com/x?y=1");
  });

  it("keeps a same-origin path, resolved against the page", () => {
    expect(safeActionUrl("/lovelace/garten", BASE)).toBe(
      "http://homeassistant.local:8123/lovelace/garten",
    );
  });

  it("refuses javascript:, however it is written", () => {
    for (const raw of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "  javascript:alert(1)",
      "java\nscript:alert(1)",
    ]) {
      expect(safeActionUrl(raw, BASE), raw).toBeUndefined();
    }
  });

  it("refuses the other schemes a payload can hide in", () => {
    expect(safeActionUrl("data:text/html,<script>alert(1)</script>", BASE)).toBeUndefined();
    expect(safeActionUrl("vbscript:msgbox(1)", BASE)).toBeUndefined();
    expect(safeActionUrl("file:///etc/passwd", BASE)).toBeUndefined();
  });
});
