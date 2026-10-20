import { describe, it, expect } from "vitest";
import {
  profileForPlatform,
  resolveKey,
  resolveTextEntry,
  capabilitiesOf,
  currentPosition,
  formatPosition,
  isAppActive,
  hasFeature,
  MP_FEATURE,
  PROFILE_DEFAULTS,
  PROFILE_KEYS,
  KEY_ICONS,
} from "./remote-profiles";
import {
  ringGeometry,
  sectorPath,
  arrowPosition,
  centerSize,
  keyToDirection,
  DPAD_DIRECTIONS,
} from "./remote-dpad";
import type { HomeAssistant } from "../types";

/** The author's own two devices, as the instance reports them. */
const hass = {
  states: {
    "media_player.samsung_q90_series_55": {
      state: "on",
      attributes: { supported_features: 24381, source_list: ["TV", "HDMI"] },
    },
    "remote.samsung_q90_series_55": { state: "on", attributes: { supported_features: 0 } },
    "media_player.google_tv": {
      state: "playing",
      attributes: {
        supported_features: 152499,
        media_title: "Das passiert, wenn du Crystal Meth nimmst!",
        app_name: "SmartTube",
        media_duration: 2159,
        media_position: 954.72,
        media_position_updated_at: "2026-10-20T18:42:57.940575+00:00",
      },
    },
  },
} as unknown as HomeAssistant;

describe("profileForPlatform", () => {
  it("maps the integrations it knows", () => {
    expect(profileForPlatform("samsungtv")).toBe("samsung");
    expect(profileForPlatform("androidtv_remote")).toBe("google_tv");
    expect(profileForPlatform("webostv")).toBe("lg_webos");
    expect(profileForPlatform("apple_tv")).toBe("appletv");
    expect(profileForPlatform("kodi")).toBe("kodi");
  });

  it("recognises androidtv_remote, whose entity id names no integration", () => {
    // remote.google_tv reads as nothing in particular; only the registry
    // knows it is androidtv_remote, and guessing from the id gave generic —
    // a Chromecast's card for a device with a full set of keycodes.
    expect(profileForPlatform("androidtv_remote")).toBe("google_tv");
  });

  it("falls back to generic for a Chromecast rather than guessing google_tv", () => {
    // A cast entity has no remote and no keycodes; calling it google_tv would
    // draw a ring whose every press is swallowed.
    expect(profileForPlatform("cast")).toBe("generic");
    expect(profileForPlatform(undefined)).toBe("generic");
  });
});

describe("resolveKey", () => {
  const R = "remote.samsung_q90_series_55";
  const M = "media_player.samsung_q90_series_55";

  it("sends a Samsung keycode through remote.send_command", () => {
    expect(resolveKey("up", "samsung", undefined, R, M)).toEqual({
      domain: "remote",
      service: "send_command",
      data: { entity_id: R, command: "KEY_UP" },
    });
  });

  it("routes volume through the media_player, which owns the slider", () => {
    expect(resolveKey("volume_up", "samsung", undefined, R, M)).toEqual({
      domain: "media_player",
      service: "volume_up",
      data: { entity_id: M },
    });
  });

  it("returns nothing for a keycode with no remote entity to send it", () => {
    expect(resolveKey("up", "samsung", undefined, undefined, M)).toBeUndefined();
  });

  it("lets an override replace a single key without restating the table", () => {
    const call = resolveKey("info", "samsung", { info: { command: "KEY_TOOLS" } }, R, M);
    expect(call?.data.command).toBe("KEY_TOOLS");
    // and the rest of the profile is untouched
    expect(resolveKey("home", "samsung", { info: { command: "KEY_TOOLS" } }, R, M)?.data.command).toBe("KEY_HOME");
  });

  it("uses webOS's own service domain, not remote.send_command", () => {
    const call = resolveKey("up", "lg_webos", undefined, undefined, "media_player.lg");
    expect(call).toEqual({
      domain: "webostv",
      service: "button",
      data: { entity_id: "media_player.lg", button: "UP" },
    });
  });

  it("uses Android's keycode names", () => {
    const call = resolveKey("ok", "google_tv", undefined, "remote.gtv", "media_player.gtv");
    expect(call?.data.command).toBe("DPAD_CENTER");
  });

  it("has no directional keys at all for a plain media_player", () => {
    expect(resolveKey("up", "generic", undefined, undefined, "media_player.cast")).toBeUndefined();
    expect(resolveKey("play_pause", "generic", undefined, undefined, "media_player.cast")).toBeDefined();
  });
});

describe("resolveTextEntry", () => {
  it("types text on Android TV, which accepts it as a command", () => {
    const call = resolveTextEntry("tagesschau", "google_tv", "remote.gtv");
    expect(call?.data.command).toBe("tagesschau");
  });

  it("refuses on a profile whose integration cannot type", () => {
    expect(resolveTextEntry("tagesschau", "samsung", "remote.tv")).toBeUndefined();
  });

  it("refuses an empty string", () => {
    expect(resolveTextEntry("", "google_tv", "remote.gtv")).toBeUndefined();
  });
});

describe("capabilitiesOf", () => {
  it("reads the Samsung pair: keys, volume, transport and a source list", () => {
    const c = capabilitiesOf(
      hass,
      "remote.samsung_q90_series_55",
      "media_player.samsung_q90_series_55",
      "samsung",
    );
    expect(c.sendCommand).toBe(true);
    expect(c.volume).toBe(true);
    expect(c.transport).toBe(true);
    expect(c.selectSource).toBe(true);
    expect(c.power).toBe(true);
  });

  it("knows a Chromecast has no keys and no volume", () => {
    // 152499 carries neither VOLUME_STEP nor VOLUME_SET nor SELECT_SOURCE.
    const c = capabilitiesOf(hass, undefined, "media_player.google_tv", "generic");
    expect(c.sendCommand).toBe(false);
    expect(c.volume).toBe(false);
    expect(c.selectSource).toBe(false);
    // What it does have is worth drawing.
    expect(c.transport).toBe(true);
    expect(c.metadata).toBe(true);
  });

  it("gives webOS a ring without a remote entity", () => {
    const c = capabilitiesOf(hass, undefined, "media_player.google_tv", "lg_webos");
    expect(c.sendCommand).toBe(true);
  });

  it("decodes the feature bits it relies on", () => {
    expect(hasFeature(24381, MP_FEATURE.SELECT_SOURCE)).toBe(true);
    expect(hasFeature(24381, MP_FEATURE.TURN_ON)).toBe(false);
    expect(hasFeature(152499, MP_FEATURE.VOLUME_STEP)).toBe(false);
    expect(hasFeature(152499, MP_FEATURE.SEEK)).toBe(true);
  });
});

describe("currentPosition", () => {
  const a = hass.states["media_player.google_tv"].attributes as Record<string, unknown>;

  it("counts on from the last report while playing", () => {
    const base = new Date("2026-10-20T18:42:57.940Z").getTime();
    expect(currentPosition(a, "playing", base + 30_000)).toBeCloseTo(984.72, 1);
  });

  it("stands still while paused", () => {
    const base = new Date("2026-10-20T18:42:57.940Z").getTime();
    expect(currentPosition(a, "paused", base + 30_000)).toBeCloseTo(954.72, 2);
  });

  it("never runs past the duration", () => {
    const base = new Date("2026-10-20T18:42:57.940Z").getTime();
    expect(currentPosition(a, "playing", base + 10_000_000)).toBe(2159);
  });

  it("does not run backwards on a clock skew", () => {
    const base = new Date("2026-10-20T18:42:57.940Z").getTime();
    expect(currentPosition(a, "playing", base - 60_000)).toBeCloseTo(954.72, 2);
  });

  it("returns nothing when the player reports no position", () => {
    expect(currentPosition({}, "playing")).toBeUndefined();
    expect(currentPosition(undefined, "playing")).toBeUndefined();
  });
});

describe("formatPosition", () => {
  it("writes m:ss and grows an hour field", () => {
    expect(formatPosition(954)).toBe("15:54");
    expect(formatPosition(59)).toBe("0:59");
    expect(formatPosition(3725)).toBe("1:02:05");
  });

  it("does not print NaN", () => {
    expect(formatPosition(undefined)).toBe("–");
    expect(formatPosition(NaN)).toBe("–");
    expect(formatPosition(-5)).toBe("–");
  });
});

describe("isAppActive", () => {
  it("matches SmartTube against a YouTube entry, which an exact compare would miss", () => {
    expect(isAppActive("SmartTube", undefined, "YouTube")).toBe(false);
    expect(isAppActive("YouTube", undefined, "YouTube")).toBe(true);
    expect(isAppActive("YouTube Music", undefined, "YouTube")).toBe(true);
  });

  it("matches a source name too", () => {
    expect(isAppActive(undefined, "HDMI", "HDMI")).toBe(true);
  });

  it("matches an explicit id", () => {
    expect(isAppActive("com.netflix.ninja", undefined, "Netflix", "com.netflix.ninja")).toBe(true);
  });

  it("says nothing is active when the player reports nothing", () => {
    expect(isAppActive(undefined, undefined, "Netflix")).toBe(false);
  });
});

describe("ring geometry", () => {
  const g = ringGeometry(168);

  it("scales the hole with the ring rather than leaving it fixed", () => {
    expect(g.outerRadius).toBe(84);
    expect(g.innerRadius).toBeCloseTo(37, 5);
    expect(ringGeometry(220).innerRadius).toBeCloseTo(48.45, 1);
  });

  it("leaves a gap between the sectors", () => {
    expect(g.sweep).toBe(82);
  });

  it("draws a closed wedge with both arcs, sweeping opposite ways", () => {
    const d = sectorPath(g, "up");
    expect(d).toMatch(/^M[\d.-]+ [\d.-]+A/);
    expect(d.endsWith("Z")).toBe(true);
    // outer arc sweeps 1, inner arc sweeps 0 — the other way round folds the
    // shape through itself and fills as an hourglass.
    expect(d).toContain(`A${(84).toFixed(2)} ${(84).toFixed(2)} 0 0 1 `);
    expect(d).toContain(" 0 0 0 ");
    expect(d).not.toContain("NaN");
  });

  it("puts each sector where its name says", () => {
    // "up" spans the top, so every point of it is above the centre.
    const ys = [...sectorPath(g, "up").matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map((m) => Number(m[2]));
    expect(Math.max(...ys)).toBeLessThan(84);
    const xs = [...sectorPath(g, "right").matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map((m) => Number(m[1]));
    expect(Math.min(...xs)).toBeGreaterThan(84);
  });

  it("draws all four without a NaN", () => {
    for (const d of DPAD_DIRECTIONS) expect(sectorPath(g, d)).not.toContain("NaN");
  });

  it("places the arrows on the band's midline", () => {
    const up = arrowPosition(g, "up");
    expect(up.left).toBe("50.00%");
    // midline is (37+84)/2 = 60.5 above centre, i.e. 23.5/168 from the top
    expect(Number.parseFloat(up.top)).toBeCloseTo(13.99, 1);
  });

  it("keeps the OK button inside the hole, with a gap all round", () => {
    expect(centerSize(g)).toBe(62);
    // Smaller than the hole: the gap is what tells the middle button apart
    // from the four around it.
    expect(centerSize(g)).toBeLessThan(g.innerRadius * 2);
  });

  it("scales the OK button with the ring", () => {
    expect(centerSize(ringGeometry(220))).toBe(81);
    expect(centerSize(ringGeometry(140))).toBe(52);
  });
});

describe("keyToDirection", () => {
  it("maps the arrow keys and Enter", () => {
    expect(keyToDirection("ArrowUp")).toBe("up");
    expect(keyToDirection("ArrowRight")).toBe("right");
    expect(keyToDirection("Enter")).toBe("ok");
    expect(keyToDirection(" ")).toBe("ok");
  });

  it("leaves everything else alone, so Tab still escapes the card", () => {
    expect(keyToDirection("Tab")).toBeUndefined();
    expect(keyToDirection("a")).toBeUndefined();
  });
});

describe("profile tables", () => {
  it("gives every profile a full set of defaults", () => {
    for (const [name, d] of Object.entries(PROFILE_DEFAULTS)) {
      expect(d.functionKeys.length, name).toBe(5);
      expect(d.accent, name).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("has an icon for every key any profile binds", () => {
    for (const map of Object.values(PROFILE_KEYS)) {
      for (const key of Object.keys(map)) {
        expect(KEY_ICONS[key as keyof typeof KEY_ICONS], key).toBeDefined();
      }
    }
  });

  it("has an icon for every key any profile puts in its function row", () => {
    for (const d of Object.values(PROFILE_DEFAULTS)) {
      for (const key of d.functionKeys) expect(KEY_ICONS[key], key).toBeDefined();
    }
  });

  it("only claims text entry where the integration really accepts it", () => {
    expect(PROFILE_DEFAULTS.google_tv.textEntry).toBe(true);
    expect(PROFILE_DEFAULTS.samsung.textEntry).toBe(false);
    expect(PROFILE_DEFAULTS.generic.textEntry).toBe(false);
  });
});
