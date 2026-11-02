import type { HaActionConfig, HassEntity } from "../types";

// The openings card's model: which windows and doors are open, for how long,
// whether that is worth a warning, and what the quiet "all closed" line says.
// Rendering lives in the card; everything here is plain data in, data out.

/** The device classes the card shows, and the ones auto-discovery looks for. */
export const OPENING_DEVICE_CLASSES = ["door", "window", "opening", "garage_door"] as const;

export interface OpeningEntryConfig {
  entity: string;
  name?: string;
  icon?: string;
  tap_action?: HaActionConfig;
}

/** A list entry may be the bare entity id. */
export type OpeningEntryInput = string | OpeningEntryConfig;

export function normalizeEntries(raw: OpeningEntryInput[] | undefined): OpeningEntryConfig[] {
  return (raw ?? [])
    .map((e) => (typeof e === "string" ? { entity: e } : e))
    .filter((e): e is OpeningEntryConfig => !!e?.entity);
}

/**
 * The entries the card shows. With auto-discovery the found sensors are the
 * list and a configured entry only renames or re-icons its sensor; without,
 * the configured list is the list.
 */
export function resolveEntries(
  configured: OpeningEntryConfig[],
  discovered: string[] | undefined,
): OpeningEntryConfig[] {
  if (!discovered) return configured;
  const overrides = new Map(configured.map((e) => [e.entity, e]));
  return discovered.map((id) => overrides.get(id) ?? { entity: id });
}

export type OpeningStatus = "open" | "closed" | "missing";

/** A binary sensor is open while `on`; anything but on/off is missing, never closed. */
export function openingStatus(entity: HassEntity | undefined): OpeningStatus {
  if (entity?.state === "on") return "open";
  if (entity?.state === "off") return "closed";
  return "missing";
}

const ICONS: Record<string, [open: string, closed: string]> = {
  window: ["mdi:window-open-variant", "mdi:window-closed-variant"],
  door: ["mdi:door-open", "mdi:door-closed"],
  garage_door: ["mdi:garage-open-variant", "mdi:garage-variant"],
  opening: ["mdi:square-rounded-outline", "mdi:square-rounded"],
};

/** A window or a door, by device class; an unknown class reads as a window. */
export function openingIcon(deviceClass: string | undefined, open: boolean): string {
  const pair = ICONS[deviceClass ?? ""] ?? ICONS.window;
  return open ? pair[0] : pair[1];
}

export interface WarnInput {
  /** How long the sensor has been open, in minutes. */
  openMinutes: number;
  warnAfterMinutes: number;
  /** The outdoor reading, or undefined when there is no sensor or no number. */
  outdoor: number | undefined;
  /** Whether an outdoor sensor is configured at all. */
  hasOutdoorSensor: boolean;
  coldBelow: number;
}

/**
 * The two warnings a row can carry. With an outdoor sensor both need both
 * thresholds: open long enough *and* cold outside — an open window on a warm
 * evening is no news. Without one the pill has nothing to show, and the
 * duration is highlighted on time alone. A configured sensor that reads no
 * number counts as none, rather than hiding every warning.
 */
export function openingWarning(i: WarnInput): { highlight: boolean; pill: boolean } {
  const long = i.openMinutes >= i.warnAfterMinutes;
  if (!i.hasOutdoorSensor || i.outdoor === undefined) return { highlight: long, pill: false };
  const cold = i.outdoor < i.coldBelow;
  return { highlight: long && cold, pill: long && cold };
}

/** Longest open first; one without a known start goes last, by name after that. */
export function sortOpen<T extends { since?: number; name: string }>(rows: T[], language: string): T[] {
  return [...rows].sort((a, b) => {
    const sa = a.since ?? Infinity;
    const sb = b.since ?? Infinity;
    if (sa !== sb) return sa - sb;
    return a.name.localeCompare(b.name, language);
  });
}

/** The sensor closed most recently: the one the "all closed" line names. */
export function latestClosed<T extends { since?: number }>(rows: T[]): T | undefined {
  let best: T | undefined;
  for (const r of rows) if (r.since !== undefined && (best?.since === undefined || r.since > best.since)) best = r;
  return best;
}

/** A sensor value as a number, or undefined when it is not one. */
export function numericState(entity: HassEntity | undefined): number | undefined {
  if (!entity) return undefined;
  const n = Number.parseFloat(entity.state);
  return Number.isFinite(n) ? n : undefined;
}
