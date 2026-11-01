import type { HaActionConfig, HassEntity } from "../types";

// The check-in card's model, shared by its three styles: whether someone is
// checked in, what checking in and out does, and how long it has been. Only
// the control differs between the styles, so everything else lives here once.

export type CheckinState = "in" | "out" | "unavailable";

export interface CheckinModelConfig {
  entity: string;
  state_on?: string;
  home_state?: string;
  checkin_action?: HaActionConfig;
  checkout_action?: HaActionConfig;
}

const MISSING = new Set(["unavailable", "unknown", ""]);

/** Domains the card can switch without being told how. */
const SWITCHABLE: Record<string, [string, string]> = {
  input_boolean: ["input_boolean.turn_on", "input_boolean.turn_off"],
  switch: ["switch.turn_on", "switch.turn_off"],
};

/**
 * Checked in, out, or not readable. A person or device tracker is in when
 * it is in `home_state` (default `home`); everything else when its state is
 * `state_on` (default `on`).
 */
export function checkinState(cfg: CheckinModelConfig, entity: HassEntity | undefined): CheckinState {
  const raw = entity?.state ?? "";
  if (MISSING.has(raw)) return "unavailable";
  const domain = cfg.entity.split(".")[0];
  const on = domain === "person" || domain === "device_tracker" ? (cfg.home_state ?? "home") : (cfg.state_on ?? "on");
  return raw === on ? "in" : "out";
}

/**
 * The action that checks in or out: the configured one, else the domain's own
 * turn_on/turn_off. A binary sensor, a person or a tracker has none — the card
 * then shows the state and offers nothing to press.
 */
export function checkinAction(cfg: CheckinModelConfig, direction: "in" | "out"): HaActionConfig | undefined {
  const configured = direction === "in" ? cfg.checkin_action : cfg.checkout_action;
  if (configured) return configured;
  const services = SWITCHABLE[cfg.entity.split(".")[0]];
  if (!services) return undefined;
  return {
    action: "perform-action",
    perform_action: services[direction === "in" ? 0 : 1],
    target: { entity_id: cfg.entity },
  };
}

/**
 * When the state last changed: the `since_entity` when there is one — an
 * input_datetime or a timestamp sensor — else the entity's own last_changed.
 * Undefined when there is nothing usable, or when it lies in the future.
 */
export function checkinSince(
  entity: HassEntity | undefined,
  sinceEntity: HassEntity | undefined,
  now: number,
): number | undefined {
  let at: number | undefined;
  if (sinceEntity) {
    const raw = sinceEntity.state;
    if (!MISSING.has(raw)) {
      // input_datetime's state is local "YYYY-MM-DD HH:MM:SS"; a timestamp
      // sensor's is ISO. Both parse once the space is a T.
      const parsed = Date.parse(raw.includes("T") ? raw : raw.replace(" ", "T"));
      if (Number.isFinite(parsed)) at = parsed;
    }
  } else if (entity?.last_changed) {
    const parsed = Date.parse(entity.last_changed);
    if (Number.isFinite(parsed)) at = parsed;
  }
  if (at === undefined || at > now + 60000) return undefined;
  return at;
}

/** Whole hours and minutes between two moments, never negative. */
export function durationParts(since: number, now: number): { h: number; m: number } {
  const minutes = Math.max(0, Math.floor((now - since) / 60000));
  return { h: Math.floor(minutes / 60), m: minutes % 60 };
}

/** Fills `{duration}` and `{time}` in a status template. */
export function fillStatus(template: string, duration: string, time: string): string {
  return template.replace(/\{duration\}/g, duration).replace(/\{time\}/g, time);
}

/**
 * The status style's big running time: a value set in tabular figures and the
 * unit beside it. Minutes under an hour ("14" min), hours and minutes as a
 * clock face up to two days ("2:05" h), whole days beyond — a stopwatch reading
 * of 73:40 says less than "3 days".
 */
export function runningTime(since: number, now: number): { value: string; unit: "m" | "h" | "d" } {
  const minutes = Math.max(0, Math.floor((now - since) / 60000));
  if (minutes < 60) return { value: String(minutes), unit: "m" };
  const h = Math.floor(minutes / 60);
  if (h < 48) return { value: `${h}:${String(minutes % 60).padStart(2, "0")}`, unit: "h" };
  return { value: String(Math.floor(h / 24)), unit: "d" };
}

/** How far a swipe has to travel, as a share of the track, to count. */
export const SWIPE_THRESHOLD = 0.75;

/**
 * How far along its way a dragged handle is, 0 to 1. Checked out, the handle
 * starts on the left and travels right; checked in, it starts on the right and
 * travels left. Dragging the wrong way, or past the end, is clamped.
 */
export function swipeProgress(dx: number, travel: number, fromIn: boolean): number {
  if (travel <= 0) return 0;
  const p = (fromIn ? -dx : dx) / travel;
  return Math.min(1, Math.max(0, p));
}
