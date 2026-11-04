import type {
  HassEntity,
  HomeAssistant,
  M3VehicleCardConfig,
  VehicleActionConfig,
  VehicleBlock,
  VehicleChargingSlotConfig,
  VehicleCondition,
  VehicleDrive,
  VehicleSlot,
  VehicleSlotConfig,
} from "../types";
import { isTemplate, templateTruthy } from "./template-sub";
import { matchesStateRule, numericState } from "./state-rules";

/**
 * The vehicle card's reading of Home Assistant, without a DOM.
 *
 * The card knows no manufacturer, only meanings — "battery", "charging",
 * "locked" — and every one of them is a slot the config fills. Everything that
 * turns those slots into what the card shows lives here, so it can be tested
 * without rendering, and so a later integration preset has one place to feed:
 * `resolveVehicle` is the only function that reads the slots.
 *
 * NEVER A GUESS
 *
 * An unavailable battery is not 0 %, a missing charging sensor is not "not
 * charging", and a charge end is shown only when the car reports one or the
 * capacity needed to work it out is configured. Every reading carries `ok`, and
 * a reading that is not ok is drawn as "–" and matches no threshold.
 */

/** States Home Assistant uses for a value it does not have. */
const MISSING = new Set(["unavailable", "unknown", "none", ""]);

/** States that read as "yes" for a plug, a window, a condition with no rule. */
const ON_LIKE = new Set(["on", "true", "yes", "1", "connected", "plugged", "plugged_in", "charging", "open", "unlocked"]);

export const DEFAULT_CHARGING_STATES = ["charging", "on", "true"];

/** The default blocks under the header, in order. */
export const VEHICLE_BLOCKS: readonly VehicleBlock[] = ["energy", "alerts", "chips", "actions", "footer"];

/** What the fold takes when `collapse_blocks` is not set. Alerts are never taken. */
export const VEHICLE_DEFAULT_FOLD: readonly VehicleBlock[] = ["chips", "actions", "footer"];

/** One slot, read. `ok: false` means "draw a dash". */
export interface SlotReading {
  ok: boolean;
  /** The raw text: the state, the attribute, or the rendered template. */
  raw?: string;
  /** The value as a number, when it is one. */
  num?: number;
  unit?: string;
  entityId?: string;
  entity?: HassEntity;
  name?: string;
  icon?: string;
  /** Outside `warn_below` / `warn_above`. */
  warn: boolean;
}

/** A slot in its object form; undefined when nothing is mapped. */
export function slotConfig(slot: VehicleSlot | undefined): VehicleSlotConfig | undefined {
  if (slot === undefined || slot === null) return undefined;
  if (typeof slot === "string") return slot.trim() ? { entity: slot.trim() } : undefined;
  if (!slot.entity && slot.template === undefined) return undefined;
  return slot;
}

/** The entity behind a slot, for shouldUpdate, more-info and timestamps. */
export function slotEntity(slot: VehicleSlot | undefined): string | undefined {
  return slotConfig(slot)?.entity;
}

/**
 * Reads one slot. Undefined means the slot is not mapped at all — the card
 * leaves its block out — while `ok: false` means it is mapped and has nothing
 * to say right now, and the card shows a dash in its place.
 */
export function readSlot(hass: HomeAssistant | undefined, slot: VehicleSlot | undefined): SlotReading | undefined {
  const cfg = slotConfig(slot);
  if (!cfg) return undefined;
  const entity = cfg.entity ? hass?.states[cfg.entity] : undefined;
  let raw: string | undefined;
  if (cfg.template !== undefined) {
    // The template subscription replaces the Jinja with what it rendered. A
    // string that still looks like Jinja has not been rendered yet — the first
    // push is on its way, or there is no connection — and is not a value.
    raw = isTemplate(cfg.template) ? undefined : String(cfg.template);
  } else if (entity) {
    raw = cfg.attribute ? stringify(entity.attributes?.[cfg.attribute]) : entity.state;
  }
  const base = {
    entityId: cfg.entity,
    entity,
    name: cfg.name ?? (entity?.attributes?.friendly_name as string | undefined),
    icon: cfg.icon,
  };
  if (raw === undefined || MISSING.has(raw.trim().toLowerCase())) return { ...base, ok: false, warn: false };
  const num = numericState(raw);
  const unit =
    cfg.unit ?? (cfg.attribute || cfg.template !== undefined ? undefined : (entity?.attributes?.unit_of_measurement as string | undefined));
  const warn =
    num !== undefined &&
    ((cfg.warn_below !== undefined && num < cfg.warn_below) || (cfg.warn_above !== undefined && num > cfg.warn_above));
  return { ...base, ok: true, raw: raw.trim(), num, unit, warn };
}

function stringify(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "object") return undefined;
  return String(value);
}

/** Whether a reading means "yes" — a binary sensor on, a plug connected. */
export function readsOn(reading: SlotReading | undefined): boolean | undefined {
  if (!reading?.ok || reading.raw === undefined) return undefined;
  return ON_LIKE.has(reading.raw.toLowerCase());
}

/**
 * Charging, from a binary_sensor or from a sensor whose states say it.
 * Undefined when the slot is unmapped or unreadable: unknown is not "no".
 */
export function isCharging(
  hass: HomeAssistant | undefined,
  slot: string | VehicleChargingSlotConfig | undefined,
): boolean | undefined {
  const reading = readSlot(hass, slot);
  if (!reading?.ok || reading.raw === undefined) return undefined;
  const value = reading.raw.toLowerCase();
  if (reading.entityId?.startsWith("binary_sensor.") && !(typeof slot === "object" && slot.attribute)) {
    return value === "on";
  }
  const states = (typeof slot === "object" && slot.charging_states) || DEFAULT_CHARGING_STATES;
  return states.some((s) => s.toLowerCase() === value);
}

/** The lock, as the pill shows it. */
export type LockState = "locked" | "unlocked" | "moving" | "jammed" | "unknown";

export function lockState(reading: SlotReading | undefined): LockState | undefined {
  if (!reading) return undefined;
  if (!reading.ok || reading.raw === undefined) return "unknown";
  const value = reading.raw.toLowerCase();
  // A lock-class binary sensor is on when *unlocked*: HA's convention, and
  // the one place where "on" is the worrying state.
  if (reading.entityId?.startsWith("binary_sensor.")) return value === "on" ? "unlocked" : value === "off" ? "locked" : "unknown";
  if (value === "locked" || value === "true" || value === "closed") return "locked";
  if (value === "unlocked" || value === "open" || value === "false" || value === "opening") return "unlocked";
  if (value === "locking" || value === "unlocking") return "moving";
  if (value === "jammed") return "jammed";
  return "unknown";
}

/** Where the car is, as one word for the subtitle. */
export type PlaceReading =
  | { kind: "home" }
  | { kind: "away" }
  | { kind: "named"; name: string }
  | { kind: "unknown" };

export function placeOf(hass: HomeAssistant | undefined, reading: SlotReading | undefined): PlaceReading | undefined {
  if (!reading) return undefined;
  if (!reading.ok || reading.raw === undefined) return { kind: "unknown" };
  const domain = reading.entityId?.split(".")[0];
  const tracked = domain === "device_tracker" || domain === "person";
  if (tracked && !slotHasOverride(reading)) {
    if (reading.raw === "home") return { kind: "home" };
    if (reading.raw === "not_home") return { kind: "away" };
    // A zone: HA states its friendly name, which is what a person reads.
    const zone = hass?.states[`zone.${reading.raw.toLowerCase().replace(/\s+/g, "_")}`];
    return { kind: "named", name: (zone?.attributes?.friendly_name as string | undefined) ?? reading.raw };
  }
  return { kind: "named", name: reading.raw };
}

function slotHasOverride(reading: SlotReading): boolean {
  // An attribute or a template means the author chose the text; take it as is.
  return reading.entity !== undefined && reading.raw !== reading.entity.state;
}

/** Charging power in kW, whatever unit the sensor states. */
export function powerKw(reading: SlotReading | undefined): number | undefined {
  if (!reading?.ok || reading.num === undefined) return undefined;
  const unit = (reading.unit ?? "").toLowerCase();
  if (unit === "w") return reading.num / 1000;
  if (unit === "mw") return reading.num * 1000;
  return reading.num;
}

/**
 * When charging ends: what the car reports, else an estimate from the
 * capacity — never from a guessed one. `estimated` lets the card say "approx.".
 */
export function chargeEnd(p: {
  now: number;
  reported?: SlotReading;
  battery?: number;
  limit?: number;
  powerKw?: number;
  capacityKwh?: number;
}): { at: number; estimated: boolean } | undefined {
  if (p.reported?.ok && p.reported.raw) {
    const at = Date.parse(p.reported.raw);
    // A report in the past is the last charge's, not this one's.
    if (Number.isFinite(at) && at > p.now - 60_000) return { at, estimated: false };
  }
  const capacity = p.capacityKwh;
  if (!capacity || capacity <= 0 || p.battery === undefined || !p.powerKw || p.powerKw <= 0) return undefined;
  const target = p.limit ?? 100;
  if (target <= p.battery) return undefined;
  const hours = (((target - p.battery) / 100) * capacity) / p.powerKw;
  // A trickle charge that would take more than two days is not a finish time.
  if (!Number.isFinite(hours) || hours > 48) return undefined;
  return { at: p.now + hours * 3_600_000, estimated: true };
}

/**
 * When the car last said anything. A `last_updated` slot states the moment
 * itself; otherwise the entity's own clock is used, `last_reported` first —
 * `last_updated` moves only when the value changes, and a parked car's
 * battery can read 72 % for a day while reporting every few minutes.
 */
export function lastReport(reading: SlotReading | undefined, statesTime: boolean): number | undefined {
  if (!reading) return undefined;
  if (statesTime && reading.ok && reading.raw) {
    const at = Date.parse(reading.raw);
    if (Number.isFinite(at) && !/^-?[\d.,]+$/.test(reading.raw)) return at;
  }
  const e = reading.entity as (HassEntity & { last_reported?: string }) | undefined;
  if (!e) return undefined;
  const times = [e.last_reported, e.last_updated, e.last_changed]
    .map((t) => (t ? Date.parse(t) : NaN))
    .filter((t) => Number.isFinite(t));
  return times.length ? Math.max(...times) : undefined;
}

/**
 * Whether a condition holds. `fallbackEntity` is the battery (or fuel level)
 * for a condition that names none — "below 20" means the battery.
 */
export function conditionMet(
  hass: HomeAssistant | undefined,
  cond: VehicleCondition,
  fallbackEntity: string | undefined,
  now: number,
): boolean {
  if (cond.template !== undefined) {
    // Unrendered yet: not met, so an alert does not flash up on load.
    if (isTemplate(cond.template)) return false;
    if (!templateTruthy(cond.template)) return false;
    // A template alone is the whole condition.
    if (!cond.entity && cond.value === undefined && cond.above === undefined && cond.below === undefined && cond.regex === undefined) {
      return true;
    }
  }
  const entityId = cond.entity ?? fallbackEntity;
  const entity = entityId ? hass?.states[entityId] : undefined;
  if (!entity) return false;
  const raw = cond.attribute ? stringify(entity.attributes?.[cond.attribute]) : entity.state;
  if (raw === undefined) return false;
  const lower = raw.toLowerCase();
  const values = cond.value === undefined ? undefined : Array.isArray(cond.value) ? cond.value : [cond.value];
  let met: boolean;
  if (values) {
    met = values.some((v) => String(v).toLowerCase() === lower);
  } else if (MISSING.has(lower)) {
    // Unavailable is never "below 20" and never "on".
    return false;
  } else if (cond.regex !== undefined || cond.above !== undefined || cond.below !== undefined) {
    const num = numericState(raw);
    met =
      (cond.regex === undefined || matchesStateRule({ regex: cond.regex }, raw, num)) &&
      (cond.above === undefined || matchesStateRule({ above: cond.above }, raw, num)) &&
      (cond.below === undefined || matchesStateRule({ below: cond.below }, raw, num));
  } else {
    met = ON_LIKE.has(lower);
  }
  if (!met) return false;
  if (cond.for_minutes && cond.for_minutes > 0) {
    const since = Date.parse(entity.last_changed);
    if (!Number.isFinite(since) || now - since < cond.for_minutes * 60_000) return false;
  }
  return true;
}

/** Every condition in a list holds; an empty or absent list always does. */
export function allMet(
  hass: HomeAssistant | undefined,
  when: VehicleCondition | VehicleCondition[] | undefined,
  fallbackEntity: string | undefined,
  now: number,
): boolean {
  if (!when) return true;
  const list = Array.isArray(when) ? when : [when];
  return list.every((c) => conditionMet(hass, c, fallbackEntity, now));
}

export function conditionEntities(when: VehicleCondition | VehicleCondition[] | undefined): string[] {
  if (!when) return [];
  return (Array.isArray(when) ? when : [when]).flatMap((c) => (c.entity ? [c.entity] : []));
}

/** The car's state, for the subtitle and the energy block's shape. */
export type VehicleMode = "charging" | "plugged" | "parked" | "unknown";

/** Everything the card draws, read once per render. */
export interface ResolvedVehicle {
  drive: VehicleDrive;
  battery?: SlotReading;
  range?: SlotReading;
  fuel?: SlotReading;
  fuelRange?: SlotReading;
  charging?: boolean;
  plugged?: boolean;
  power?: SlotReading;
  powerKw?: number;
  limit?: SlotReading;
  end?: { at: number; estimated: boolean };
  lock?: LockState;
  lockEntity?: string;
  place?: PlaceReading;
  /** When the place last changed — "at work for 2 h". */
  placeSince?: number;
  /** When the car last reported anything. */
  reportedAt?: number;
  stale: boolean;
  mode: VehicleMode;
  /** The entity a "below 20" condition and the header's more-info refer to. */
  primaryEntity?: string;
  /** Neither battery nor fuel is mapped — the card says so instead of drawing. */
  unmapped: boolean;
}

export function resolveVehicle(
  hass: HomeAssistant | undefined,
  config: M3VehicleCardConfig,
  now: number,
): ResolvedVehicle {
  const drive: VehicleDrive = config.drive ?? "ev";
  const e = config.energy ?? {};
  const electric = drive !== "fuel";
  const fueled = drive !== "ev";
  const battery = electric ? readSlot(hass, e.battery) : undefined;
  const fuel = fueled ? readSlot(hass, e.fuel_level) : undefined;
  const charging = electric ? isCharging(hass, e.charging) : undefined;
  const plugged = electric ? (readsOn(readSlot(hass, e.plugged)) ?? (charging ? true : undefined)) : undefined;
  const power = electric ? readSlot(hass, e.charge_power) : undefined;
  const limit = electric ? readSlot(hass, e.charge_limit) : undefined;
  const kw = powerKw(power);
  const end =
    charging === true
      ? chargeEnd({
          now,
          reported: readSlot(hass, e.charge_end),
          battery: battery?.num,
          limit: limit?.num,
          powerKw: kw,
          capacityKwh: e.capacity_kwh,
        })
      : undefined;
  const lockReading = readSlot(hass, config.lock);
  const placeReading = readSlot(hass, config.location);
  const placeSince = placeReading?.entity ? Date.parse(placeReading.entity.last_changed) : undefined;
  const primary = battery ?? fuel;
  const updatedSlot = readSlot(hass, config.last_updated);
  const reportedAt = updatedSlot ? lastReport(updatedSlot, true) : lastReport(primary, false);
  const staleAfter = config.stale_after_minutes ?? 0;
  const stale = staleAfter > 0 && reportedAt !== undefined && now - reportedAt > staleAfter * 60_000;
  const anyReading = primary?.ok;
  const mode: VehicleMode =
    charging === true ? "charging" : plugged === true ? "plugged" : anyReading || charging === false ? "parked" : "unknown";
  return {
    drive,
    battery,
    range: electric ? readSlot(hass, e.range) : undefined,
    fuel,
    fuelRange: fueled ? readSlot(hass, e.fuel_range) : undefined,
    charging,
    plugged,
    power,
    powerKw: kw,
    limit,
    end,
    lock: lockState(lockReading),
    lockEntity: lockReading?.entityId,
    place: placeOf(hass, placeReading),
    placeSince: placeSince !== undefined && Number.isFinite(placeSince) ? placeSince : undefined,
    reportedAt,
    stale,
    mode,
    primaryEntity: (electric ? slotEntity(e.battery) : undefined) ?? (fueled ? slotEntity(e.fuel_level) : undefined),
    unmapped: !battery && !fuel,
  };
}

/** Every entity the card reads, for shouldUpdate. Under-declaring is the one way it breaks. */
export function vehicleEntities(config: M3VehicleCardConfig | undefined): (string | undefined)[] {
  if (!config) return [];
  const e = config.energy ?? {};
  return [
    slotEntity(e.battery),
    slotEntity(e.range),
    slotEntity(e.charging),
    slotEntity(e.plugged),
    slotEntity(e.charge_power),
    slotEntity(e.charge_limit),
    slotEntity(e.charge_end),
    slotEntity(e.fuel_level),
    slotEntity(e.fuel_range),
    slotEntity(config.lock),
    slotEntity(config.location),
    slotEntity(config.last_updated),
    config.collapse_state_entity,
    ...(config.chips ?? []).map((c) => ("entity" in c ? c.entity : undefined)),
    ...(config.alerts ?? []).flatMap((a) => [...conditionEntities(a.when), a.action?.entity]),
    ...(config.actions ?? []).flatMap((a) => [a.entity, ...conditionEntities(a.visible)]),
  ];
}

/** The actions the card draws now: hidden ones dropped, the primary split off. */
export function visibleActions(
  hass: HomeAssistant | undefined,
  actions: VehicleActionConfig[] | undefined,
  fallbackEntity: string | undefined,
  now: number,
): { primary?: VehicleActionConfig; rest: VehicleActionConfig[] } {
  const list = actions ?? [];
  const first = list[0];
  const shown = list.filter((a) => allMet(hass, a.visible, a.entity ?? fallbackEntity, now));
  const primary = first?.primary && shown[0] === first ? first : undefined;
  return { primary, rest: primary ? shown.slice(1) : shown };
}

/** The blocks to draw, in order, from `layout` or the default. */
export function vehicleLayout(layout: VehicleBlock[] | undefined): VehicleBlock[] {
  const valid = (layout ?? [...VEHICLE_BLOCKS]).filter((b) => VEHICLE_BLOCKS.includes(b));
  return [...new Set(valid)];
}
