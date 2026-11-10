import type { HomeAssistant, M3SolarBatteryCardConfig, SolarBatteryNumberSource } from "../types";
import {
  DEFAULT_SOLAR_BATTERY_IDLE_W,
  DEFAULT_SOLAR_BATTERY_MPPT_MAX_W,
  SOLAR_BATTERY_FORECAST_MAX_H,
  SOLAR_BATTERY_FORECAST_STEP_MIN,
} from "../const";
import { toBase } from "./energy-flow-units";
import { formatNumber } from "./formatting";

// The solar battery card's arithmetic, without Lit: what is charging, how
// full, until when. Every reader returns `undefined` for a value it cannot
// read — `unavailable`, `unknown`, an entity that does not exist — so the card
// shows "–" and drops the forecast instead of computing with a made-up 0.

type States = HomeAssistant["states"];

/** A plain number from an entity, or a fixed number as it is. */
export function readNumber(states: States, source: SolarBatteryNumberSource | undefined): number | undefined {
  if (source === undefined || source === "") return undefined;
  if (typeof source === "number") return Number.isFinite(source) ? source : undefined;
  const asNumber = Number(source);
  if (source.trim() !== "" && Number.isFinite(asNumber)) return asNumber;
  const st = states[source];
  if (!st) return undefined;
  const value = parseFloat(st.state);
  return Number.isFinite(value) ? value : undefined;
}

/** A power sensor in watts, whatever unit it reports in (W, kW, MW). */
export function readPower(states: States, entity: string | undefined): number | undefined {
  if (!entity) return undefined;
  const value = readNumber(states, entity);
  if (value === undefined) return undefined;
  return toBase(value, states[entity]?.attributes?.unit_of_measurement as string | undefined, "power");
}

export type SolarBatteryPhase = "charging" | "discharging" | "idle" | "full";

/**
 * The battery's net power, positive while charging: from one signed sensor
 * (flipped by `invert`) or from separate charge and discharge sensors. With
 * two sensors one may be unreadable and the other still counts; with neither
 * readable the answer is unknown.
 */
export function batteryNet(cfg: M3SolarBatteryCardConfig, states: States): number | undefined {
  if (cfg.battery_power) {
    const p = readPower(states, cfg.battery_power);
    if (p === undefined) return undefined;
    return cfg.invert ? -p : p;
  }
  const charge = readPower(states, cfg.charge_power);
  const discharge = readPower(states, cfg.discharge_power);
  if (charge === undefined && discharge === undefined) return undefined;
  return Math.abs(charge ?? 0) - Math.abs(discharge ?? 0);
}

export function hasBatteryPower(cfg: M3SolarBatteryCardConfig): boolean {
  return !!(cfg.battery_power || cfg.charge_power || cfg.discharge_power);
}

export function idleThreshold(cfg: M3SolarBatteryCardConfig): number {
  const t = cfg.idle_threshold_w;
  return typeof t === "number" && t >= 0 ? t : DEFAULT_SOLAR_BATTERY_IDLE_W;
}

/**
 * Charging, supplying, ready or full. "Full" wins over a trickle charge — at
 * the limit a battery keeps topping up a few watts, and "charging" at 100 %
 * reads wrong — but not over discharging.
 */
export function batteryPhase(
  net: number | undefined,
  soc: number | undefined,
  chargeLimit: number,
  idle: number,
): SolarBatteryPhase {
  const discharging = net !== undefined && net < -idle;
  if (!discharging && soc !== undefined && soc >= chargeLimit) return "full";
  if (net === undefined) return "idle";
  if (net > idle) return "charging";
  if (discharging) return "discharging";
  return "idle";
}

export interface BatteryPack {
  soc: number | undefined;
  capacity: number | undefined;
}

/**
 * The state of charge across the main battery and its expansions, weighted by
 * capacity, and the total capacity. A pack that cannot be read, or whose
 * capacity is unknown, is left out of both — counting it as empty would make
 * the whole system look drained. With no extra packs the main one stands as
 * it is, capacity or not.
 */
export function combinePacks(main: BatteryPack, extras: BatteryPack[]): BatteryPack {
  if (!extras.length) return main;
  const all = [main, ...extras].filter(
    (p): p is { soc: number; capacity: number } => p.soc !== undefined && p.capacity !== undefined && p.capacity > 0,
  );
  if (main.soc === undefined) return { soc: undefined, capacity: undefined };
  if (!all.length) return main;
  const capacity = all.reduce((sum, p) => sum + p.capacity, 0);
  const soc = all.reduce((sum, p) => sum + p.soc * p.capacity, 0) / capacity;
  return { soc, capacity };
}

export interface BatteryForecast {
  kind: "full" | "empty";
  /** When, rounded to five minutes; undefined when beyond 24 hours. */
  at?: number;
  beyond: boolean;
}

/**
 * "Full at" while charging: (limit − soc) / 100 × capacity / power; "lasts
 * until" while discharging: (soc − reserve) / 100 × capacity / power. Nothing
 * when idle, when a value is missing, or when there is nothing left to fill
 * or to draw.
 */
export function batteryForecast(p: {
  phase: SolarBatteryPhase;
  soc: number | undefined;
  capacityKwh: number | undefined;
  net: number | undefined;
  reserve: number;
  chargeLimit: number;
  now: number;
}): BatteryForecast | undefined {
  const { phase, soc, capacityKwh, net, reserve, chargeLimit, now } = p;
  if (soc === undefined || net === undefined || !capacityKwh || capacityKwh <= 0) return undefined;
  if (phase !== "charging" && phase !== "discharging") return undefined;
  const kind = phase === "charging" ? "full" : "empty";
  const percent = kind === "full" ? chargeLimit - soc : soc - reserve;
  const watts = Math.abs(net);
  if (percent <= 0 || watts <= 0) return undefined;
  const hours = ((percent / 100) * capacityKwh * 1000) / watts;
  if (hours > SOLAR_BATTERY_FORECAST_MAX_H) return { kind, beyond: true };
  const step = SOLAR_BATTERY_FORECAST_STEP_MIN * 60_000;
  return { kind, at: Math.round((now + hours * 3_600_000) / step) * step, beyond: false };
}

/** A percentage on the bar, kept on it. */
export function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export interface MpptReading {
  entity: string;
  name: string;
  watts: number | undefined;
  /** 0–1 of the column. */
  fill: number;
}

export function mpptReadings(cfg: M3SolarBatteryCardConfig, states: States): MpptReading[] {
  return (cfg.mppt ?? [])
    .filter((m) => m && m.entity)
    .map((m, i) => {
      const watts = readPower(states, m.entity);
      const max = m.max_watts && m.max_watts > 0 ? m.max_watts : DEFAULT_SOLAR_BATTERY_MPPT_MAX_W;
      return {
        entity: m.entity,
        name: m.name ?? `PV${i + 1}`,
        watts,
        fill: watts === undefined ? 0 : Math.min(1, Math.max(0, watts / max)),
      };
    });
}

/** The input producing most, if any produces anything. */
export function peakMppt(readings: MpptReading[]): MpptReading | undefined {
  let best: MpptReading | undefined;
  for (const r of readings) if (r.watts !== undefined && r.watts > 0 && (!best || r.watts > best.watts!)) best = r;
  return best;
}

/** `solar_power` when set; otherwise the sum of the inputs that can be read. */
export function solarTotal(cfg: M3SolarBatteryCardConfig, states: States, readings: MpptReading[]): number | undefined {
  if (cfg.solar_power) return readPower(states, cfg.solar_power);
  const known = readings.filter((r) => r.watts !== undefined);
  if (!known.length) return undefined;
  return known.reduce((sum, r) => sum + r.watts!, 0);
}

export interface PowerText {
  value: string;
  unit: string;
}

/** "620 W", "1,24 kW" — the switch at `kwThreshold`, in the locale's digits. */
export function formatPower(language: string, watts: number, kwThreshold: number, signed = false): PowerText {
  const sign = signed && watts > 0.5 ? "+" : signed && watts < -0.5 ? "−" : "";
  const abs = Math.abs(watts);
  if (abs >= kwThreshold) {
    return { value: sign + formatNumber(language, abs / 1000, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), unit: "kW" };
  }
  return { value: sign + formatNumber(language, Math.round(abs), { maximumFractionDigits: 0 }), unit: "W" };
}

/** Every entity the card reads, for shouldUpdate. */
export function solarBatteryEntities(cfg: M3SolarBatteryCardConfig | undefined): string[] {
  if (!cfg) return [];
  const sources = [cfg.reserve, cfg.charge_limit].filter((s): s is string => typeof s === "string");
  return [
    cfg.soc,
    cfg.mode,
    cfg.battery_power,
    cfg.charge_power,
    cfg.discharge_power,
    cfg.solar_power,
    cfg.output_power,
    ...sources,
    ...(cfg.mppt ?? []).map((m) => m?.entity),
    ...(cfg.batteries ?? []).map((b) => b?.soc),
    ...(cfg.chips ?? []).map((c) => c?.entity),
  ].filter((e): e is string => typeof e === "string" && e.includes("."));
}
