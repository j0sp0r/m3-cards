// What kind of detail view an entity gets.
//
// Five layouts, decided by domain first and by the state itself second:
//
//   numeric  a number with a history: the smoothed curve and its stats
//   binary   two states: a timeline, time in each, changes today
//   states   any other set of words: a timeline and how long each lasted
//   control  something to operate: the suite's own card for it, then a timeline
//   info     a summary with no useful history: weather, a person's location
//
// Entities this view has nothing for at all — an `update` with release notes,
// a button or script whose state is only the time it was last pressed — get no
// kind, and their tap stays with Home Assistant's more-info dialog.

import type { HassEntity } from "../types";

export type DetailKind = "numeric" | "binary" | "states" | "control" | "info";

export const DETAIL_KINDS: readonly DetailKind[] = ["numeric", "binary", "states", "control", "info"];

const MORE_INFO_ONLY = new Set(["update", "button", "input_button", "script", "scene", "event", "image", "camera"]);
const CONTROL = new Set([
  "light",
  "switch",
  "fan",
  "cover",
  "climate",
  "media_player",
  "humidifier",
  "vacuum",
  "lock",
  "input_boolean",
]);
const INFO = new Set(["weather", "person", "device_tracker", "sun"]);
const BINARY = new Set(["binary_sensor", "automation", "schedule"]);
const NUMERIC = new Set(["sensor", "number", "input_number", "counter"]);

/**
 * The layout for `st`, or undefined for an entity that belongs to more-info.
 *
 * `overrides` is the card's `type_overrides`, keyed by entity id or domain —
 * the entity id wins. A value that is not a kind is ignored rather than
 * trusted, so a typo falls back to the default instead of an empty sheet.
 */
export function detailKind(
  st: HassEntity | undefined,
  overrides?: Record<string, string>,
): DetailKind | undefined {
  if (!st) return undefined;
  const domain = st.entity_id.split(".")[0];
  const override = overrides?.[st.entity_id] ?? overrides?.[domain];
  if (override && (DETAIL_KINDS as readonly string[]).includes(override)) return override as DetailKind;
  if (MORE_INFO_ONLY.has(domain)) return undefined;
  if (CONTROL.has(domain)) return "control";
  if (INFO.has(domain)) return "info";
  if (BINARY.has(domain)) return "binary";
  if (NUMERIC.has(domain)) {
    // A timestamp sensor's state parses as a date, not a number, and a
    // numeric one can be unavailable right now — the unit says which it is
    // meant to be.
    if (st.attributes.device_class === "timestamp") return "info";
    const n = Number(st.state);
    if (st.attributes.unit_of_measurement !== undefined || st.attributes.state_class) return "numeric";
    return st.state.trim() !== "" && Number.isFinite(n) ? "numeric" : "states";
  }
  return "states";
}

/**
 * The card shown at the top of a `control` view: the suite's own card for the
 * domain, configured with nothing but the entity.
 *
 * Every one of these takes `entity` alone (checked against each card's
 * setConfig and getStubConfig); the cover card also wants its single mode
 * named. Switches, fans, locks and helpers have no card of their own and get
 * the button card, whose default tap toggles them.
 */
export function defaultControlCard(entityId: string): Record<string, unknown> | undefined {
  const domain = entityId.split(".")[0];
  const card = (type: string, extra: Record<string, unknown> = {}) => ({
    type: `custom:${type}`,
    entity: entityId,
    ...extra,
  });
  switch (domain) {
    case "light":
      return card("m3-light-card");
    case "cover":
      return card("m3-cover-card", { mode: "single" });
    case "climate":
      return card("m3-climate-card");
    case "media_player":
      return card("m3-media-card");
    case "humidifier":
      return card("m3-humidifier-card");
    case "vacuum":
      return card("m3-vacuum-card");
    case "switch":
    case "fan":
    case "lock":
    case "input_boolean":
      return card("m3-button-card", { show_state: true, show_icon_background: true });
    default:
      return undefined;
  }
}

/**
 * Whether a set of observed states reads as a pair — on/off, open/closed,
 * locked/unlocked — and gets the two-state tiles instead of a frequency list.
 */
export function isTwoState(states: Iterable<string>): boolean {
  const seen = new Set([...states].filter((s) => s !== "unavailable" && s !== "unknown"));
  if (seen.size > 2) return false;
  const pairs = [
    ["on", "off"],
    ["open", "closed"],
    ["locked", "unlocked"],
    ["home", "not_home"],
  ];
  return pairs.some(([a, b]) => [...seen].every((s) => s === a || s === b));
}
