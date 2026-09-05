import { describe, it, expect } from "vitest";
import {
  ASSIST_SHORTCUT,
  assistAvailable,
  quickBarModeAvailable,
  quickBarShortcut,
  shortcutEventInit,
  shortcutsAvailable,
} from "./quick-bar";
import type { HomeAssistant } from "../types";

function fakeHass(overrides: Partial<HomeAssistant> = {}): HomeAssistant {
  return {
    config: { unit_system: { temperature: "°C" }, components: ["conversation"] },
    user: { is_admin: true },
    enableShortcuts: true,
    ...overrides,
  } as unknown as HomeAssistant;
}

describe("shortcutEventInit", () => {
  it("sets both key and code", () => {
    // Not redundant: Home Assistant registers each shortcut twice, once per
    // field, and tinykeys drops any event missing either one.
    const init = shortcutEventInit(quickBarShortcut(fakeHass(), "entity"));
    expect(init.key).toBe("e");
    expect(init.code).toBe("KeyE");
  });

  it("mirrors keyCode into which, for older frontends", () => {
    const init = shortcutEventInit(ASSIST_SHORTCUT);
    expect(init.keyCode).toBe(65);
    expect(init.which).toBe(65);
  });

  it("is composed, so it escapes the card's shadow root", () => {
    expect(shortcutEventInit(ASSIST_SHORTCUT).composed).toBe(true);
  });

  it("carries no modifier, which would disqualify the press", () => {
    const init = shortcutEventInit(ASSIST_SHORTCUT) as unknown as Record<string, unknown>;
    for (const flag of ["ctrlKey", "metaKey", "altKey", "shiftKey", "repeat"]) {
      expect(init[flag]).toBeUndefined();
    }
  });
});

describe("quickBarShortcut", () => {
  it("sends e for the entity quick bar", () => {
    expect(quickBarShortcut(fakeHass(), "entity").key).toBe("e");
  });

  it("sends c for the command quick bar, for an admin", () => {
    expect(quickBarShortcut(fakeHass(), "command").key).toBe("c");
  });

  it("falls back to the entity search for a non-admin, since c reaches nothing", () => {
    const hass = fakeHass({ user: { is_admin: false } } as Partial<HomeAssistant>);
    expect(quickBarShortcut(hass, "command").key).toBe("e");
  });

  it("defaults to the entity search for an unset or unknown mode", () => {
    expect(quickBarShortcut(fakeHass(), undefined).key).toBe("e");
    expect(quickBarShortcut(fakeHass(), "nonsense" as never).key).toBe("e");
  });
});

describe("availability", () => {
  it("treats an unstated enableShortcuts as on, not off", () => {
    expect(shortcutsAvailable({} as HomeAssistant)).toBe(true);
    expect(shortcutsAvailable(undefined)).toBe(true);
  });

  it("respects an explicit enableShortcuts: false", () => {
    expect(shortcutsAvailable(fakeHass({ enableShortcuts: false }))).toBe(false);
    expect(assistAvailable(fakeHass({ enableShortcuts: false }))).toBe(false);
    expect(quickBarModeAvailable(fakeHass({ enableShortcuts: false }), "entity")).toBe(false);
  });

  it("needs the conversation component for Assist", () => {
    const without = fakeHass({
      config: { unit_system: { temperature: "°C" }, components: ["light"] },
    } as Partial<HomeAssistant>);
    expect(assistAvailable(without)).toBe(false);
    expect(assistAvailable(fakeHass())).toBe(true);
  });

  it("treats a missing component list as no evidence either way", () => {
    const noList = fakeHass({
      config: { unit_system: { temperature: "°C" } },
    } as Partial<HomeAssistant>);
    expect(assistAvailable(noList)).toBe(true);
  });

  it("treats a missing user as no evidence that command mode is out of reach", () => {
    const noUser = fakeHass({ user: undefined });
    expect(quickBarModeAvailable(noUser, "command")).toBe(true);
  });
});
