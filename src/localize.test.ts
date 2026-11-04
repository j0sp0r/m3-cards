/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

/**
 * A string in `localize.ts` carrying a `{placeholder}` is a promise that the
 * call site fills it in. Nothing enforces that: `_t("key")` without the
 * `.replace()` compiles, renders, and ships the braces to the user.
 *
 * That is not hypothetical. The counter card's calibration dialog asked
 * "Zähler auf {to} setzen?" in its title while its body said "von 85 auf 40" —
 * the body had the replace, the title did not, and tsc cannot tell them apart.
 *
 * The sources are read through `import.meta.glob` rather than `node:fs` so
 * that this needs no `@types/node`: vite is already here, node's types are not.
 */

const SOURCES = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * The substitution has to be chained onto *this* call — `_t("k").replace(…)`,
 * with a line break before the dot allowed. Looking "somewhere nearby" instead
 * is what let the original bug through a first version of this test: the title
 * had no replace, the `message:` on the very next line did, and a window-based
 * check counted that one for both.
 */
const CHAINED = /^\s*\.replace(All)?\s*\(/;

/**
 * Substituted, but not on the call itself — each entry says where instead, so
 * that an entry added to silence a failure has to name something checkable.
 */
const SUBSTITUTED_ELSEWHERE = new Map<string, string>([
  // Handed to formatSince() as a map of unit strings; it substitutes once it
  // knows which unit it picked.
  ["leak_since_minutes", "formatSince()"],
  ["leak_since_hours", "formatSince()"],
  ["leak_since_days", "formatSince()"],
  ["leak_dur_minutes", "formatSince()"],
  ["leak_dur_hours", "formatSince()"],
  ["leak_dur_days", "formatSince()"],
  ["occupancy_minutes", "formatSince()"],
  ["occupancy_hours", "formatSince()"],
  ["occupancy_days", "formatSince()"],
  ["printer_remaining_hm", "the printer card's duration formatter"],
  ["printer_remaining_m", "the printer card's duration formatter"],
  ["appliance_duration_hm", "the appliance card's _durationParts, which splits on the placeholders"],
  ["appliance_duration_m", "the appliance card's _durationParts, which splits on the placeholders"],
  // The replace is chained onto the parenthesised ternary around it, so both
  // branches get it.
  ["climate_overview_subtitle_one", "the .replace on the enclosing ternary"],
  // Goes into a `template` const first, because a configured
  // `status_text_running` may replace it; the const is then substituted.
  ["progress_status_running", "the `template` const one line down"],
  // A configured status_in/status_out may replace them, so they go into a
  // `template` const that fillStatus() then fills.
  ["checkin_status_in", "fillStatus() on the `template` const"],
  ["checkin_status_out", "fillStatus() on the `template` const"],
  // Handed to buildVehicleNotifyAutomation, which fills {name}, {level} and {n}.
  ["vehicle_notify_charge_done", "buildVehicleNotifyAutomation()"],
  ["vehicle_notify_low", "buildVehicleNotifyAutomation()"],
  ["vehicle_notify_unlocked", "buildVehicleNotifyAutomation()"],
  ["vehicle_notify_plug", "buildVehicleNotifyAutomation()"],
]);

/**
 * Keys whose braces are meant to reach the screen: editor hints that explain a
 * placeholder to the person writing the config.
 */
const LITERAL_BRACES = new Map<string, string>([
  ["editor_progress_status_text_running_helper", "documents {remaining} to the user"],
  ["editor_climate_max_visible_helper", "quotes the «{n} weitere» label"],
  ["editor_appliance_notify_start_text_hint", "documents {ende} to the user"],
  ["editor_checkin_status_helper", "documents {duration} and {time} to the user"],
]);

const ALLOWED = new Map([...SUBSTITUTED_ELSEWHERE, ...LITERAL_BRACES]);

function keysWithPlaceholders(): Set<string> {
  const loc = SOURCES["./localize.ts"];
  const keys = new Set<string>();
  for (const m of loc.matchAll(/^\s{4}([a-z0-9_]+):\s*"((?:[^"\\]|\\.)*)"/gm)) {
    if (/\{[a-z_]+\}/.test(m[2])) keys.add(m[1]);
  }
  return keys;
}

describe("localize placeholders", () => {
  it("finds strings with placeholders at all", () => {
    // Guards the regex above: if the file's shape changes and this finds
    // nothing, the real test below would pass by being empty.
    expect(keysWithPlaceholders().size).toBeGreaterThan(10);
  });

  it("every call site either substitutes its placeholders or is allowed to skip", () => {
    const withPlaceholders = keysWithPlaceholders();
    const unsubstituted: string[] = [];

    for (const [path, src] of Object.entries(SOURCES)) {
      if (path.endsWith(".test.ts")) continue;
      for (const hit of src.matchAll(/_t\("([a-z0-9_]+)"\)/g)) {
        const key = hit[1];
        if (!withPlaceholders.has(key) || ALLOWED.has(key)) continue;
        if (!CHAINED.test(src.slice(hit.index + hit[0].length))) {
          const line = src.slice(0, hit.index).split("\n").length;
          unsubstituted.push(`${path}:${line} — _t("${key}") leaves its braces in`);
        }
      }
    }

    expect(unsubstituted).toEqual([]);
  });

  it("the allow list has no entries for keys that no longer carry placeholders", () => {
    const withPlaceholders = keysWithPlaceholders();
    const stale = [...ALLOWED.keys()].filter((k) => !withPlaceholders.has(k));
    expect(stale).toEqual([]);
  });
});
