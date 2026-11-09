import type { HassEntity } from "../types";

// The alarm card's model (#47), with no DOM in it: which phase the panel is
// in, which modes it offers, whether a code is needed, how long a delay has
// left. Everything here reads Home Assistant's alarm_control_panel contract,
// plus the extra attributes Alarmo and the `manual` platform add on top —
// never required, used when present.

export type AlarmMode =
  | "disarmed"
  | "armed_home"
  | "armed_away"
  | "armed_night"
  | "armed_vacation"
  | "armed_custom_bypass";

export type ArmedMode = Exclude<AlarmMode, "disarmed">;

/** The order the modes are offered in when the config names none. */
export const ALARM_MODES: readonly AlarmMode[] = [
  "disarmed",
  "armed_home",
  "armed_away",
  "armed_night",
  "armed_vacation",
  "armed_custom_bypass",
];

/** AlarmControlPanelEntityFeature: which arm services a panel supports. */
export const ALARM_FEATURE: Record<ArmedMode, number> = {
  armed_home: 1,
  armed_away: 2,
  armed_night: 4,
  armed_custom_bypass: 16,
  armed_vacation: 32,
};

/** How many modes the default (unconfigured) button row shows. */
export const ALARM_DEFAULT_MAX_MODES = 4;

export type AlarmPhase =
  | "disarmed"
  | "arming"
  | "armed"
  | "pending"
  | "triggered"
  | "disarming"
  | "unavailable";

export interface AlarmModeConfig {
  mode: AlarmMode;
  name?: string;
  icon?: string;
}

export function isAlarmMode(value: unknown): value is AlarmMode {
  return typeof value === "string" && (ALARM_MODES as readonly string[]).includes(value);
}

export function alarmPhase(state: string | undefined): AlarmPhase {
  switch (state) {
    case "disarmed":
    case "arming":
    case "pending":
    case "triggered":
    case "disarming":
      return state;
    default:
      return state && state.startsWith("armed_") ? "armed" : "unavailable";
  }
}

/** The modes a panel supports. "Disarmed" always; the rest by feature bit. */
export function supportedModes(entity: HassEntity | undefined): AlarmMode[] {
  const raw = entity?.attributes?.supported_features;
  // No feature list at all: offer everything rather than nothing — the
  // service call says so if one is not supported.
  if (typeof raw !== "number") return [...ALARM_MODES];
  return ALARM_MODES.filter((m) => m === "disarmed" || (raw & ALARM_FEATURE[m]) !== 0);
}

/**
 * The buttons to draw. A configured list is taken as written (order, names,
 * icons), minus anything that is not a mode. Without one: the supported
 * modes, at most four, "Disarmed" first.
 */
export function resolveModes(
  configured: ReadonlyArray<AlarmMode | AlarmModeConfig> | undefined,
  entity: HassEntity | undefined,
): AlarmModeConfig[] {
  if (configured?.length) {
    const out: AlarmModeConfig[] = [];
    for (const entry of configured) {
      const cfg = typeof entry === "string" ? { mode: entry } : entry;
      if (cfg && isAlarmMode(cfg.mode) && !out.some((o) => o.mode === cfg.mode)) out.push({ ...cfg });
    }
    return out;
  }
  return supportedModes(entity)
    .slice(0, ALARM_DEFAULT_MAX_MODES)
    .map((mode) => ({ mode }));
}

/**
 * The armed mode the panel is in, or — while arming — the one it is going to.
 * Alarmo names it in `arm_mode`, the manual platform in `next_state`.
 */
export function alarmMode(entity: HassEntity | undefined): AlarmMode | undefined {
  if (!entity) return undefined;
  const state = entity.state;
  if (state === "disarmed") return "disarmed";
  if (isAlarmMode(state)) return state;
  const attrs = entity.attributes ?? {};
  for (const key of ["next_state", "arm_mode"]) {
    const v = attrs[key];
    if (isAlarmMode(v) && v !== "disarmed") return v;
  }
  return undefined;
}

/**
 * A running delay's end and length, while arming or pending — only when the
 * integration says how long (Alarmo's `delay`, in seconds). Counted from
 * `last_changed`, the moment the delay began. No length, no countdown: the
 * card draws an indeterminate bar instead of a made-up number.
 */
export function alarmCountdown(
  entity: HassEntity | undefined,
): { endsAt: number; total: number } | undefined {
  if (!entity) return undefined;
  const phase = alarmPhase(entity.state);
  if (phase !== "arming" && phase !== "pending") return undefined;
  const delay = Number(entity.attributes?.delay);
  const start = Date.parse(entity.last_changed);
  if (!Number.isFinite(delay) || delay <= 0 || !Number.isFinite(start)) return undefined;
  return { endsAt: start + delay * 1000, total: delay * 1000 };
}

/** Whole seconds left, never below zero. */
export function secondsLeft(countdown: { endsAt: number }, now: number): number {
  return Math.max(0, Math.ceil((countdown.endsAt - now) / 1000));
}

export type CodeFormat = "number" | "text";

export function codeFormat(entity: HassEntity | undefined): CodeFormat | undefined {
  const f = entity?.attributes?.code_format;
  return f === "number" || f === "text" ? f : undefined;
}

/**
 * Whether the card should ask for a code before this action. Disarming needs
 * one whenever the panel has a code format; arming only when it also says
 * `code_arm_required` (true when the attribute is missing, as in Home
 * Assistant's own more-info dialog).
 */
export function codeNeeded(entity: HassEntity | undefined, action: "arm" | "disarm"): boolean {
  if (!codeFormat(entity)) return false;
  if (action === "disarm") return true;
  return entity?.attributes?.code_arm_required !== false;
}

/** The service for a mode: alarm_disarm, alarm_arm_home, … */
export function alarmService(mode: AlarmMode): string {
  return mode === "disarmed" ? "alarm_disarm" : `alarm_arm_${mode.slice("armed_".length)}`;
}

/**
 * Which sensors are open. Alarmo lists the ones that blocked arming in
 * `open_sensors` (an object of entity → state, or a list); that wins when it
 * has anything. Otherwise the configured `sensors`: open while "on", counted
 * as fine while off, left out of both while they have no reading.
 */
export function alarmSensors(
  entity: HassEntity | undefined,
  sensors: readonly string[] | undefined,
  states: Record<string, HassEntity> | undefined,
): { open: string[]; ok: number } {
  const attr = entity?.attributes?.open_sensors;
  const fromAttr = Array.isArray(attr)
    ? attr.filter((v): v is string => typeof v === "string")
    : attr && typeof attr === "object"
      ? Object.keys(attr as Record<string, unknown>)
      : [];
  if (fromAttr.length) return { open: fromAttr, ok: 0 };
  const open: string[] = [];
  let ok = 0;
  for (const id of sensors ?? []) {
    const st = states?.[id]?.state;
    if (st === "on") open.push(id);
    else if (st === "off") ok++;
  }
  return { open, ok };
}

/** Who or what changed the state last, when the integration says. */
export function alarmChangedBy(entity: HassEntity | undefined): string | undefined {
  const v = entity?.attributes?.changed_by;
  return typeof v === "string" && v.trim() ? v : undefined;
}
