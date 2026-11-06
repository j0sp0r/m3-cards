// The recent past of several temperature sensors at once, for the temperature
// graph card: one websocket call for all of them, not one per sensor.
//
// Up to 48 hours the raw history is read. It is short enough there, and it is
// every reading rather than a mean of them. Beyond that, hourly long-term
// statistics: a month of five chatty sensors is 3,600 rows instead of tens of
// thousands of state changes. Statistics exist only for a sensor with a
// `state_class`; one without falls back to the history for that range, and
// only a sensor with neither ends up with nothing.
//
// What comes back is a step series per sensor (see temperature-graph.ts) and
// the lowest and highest real reading in the window: for statistics, from the
// hours' own min and max, which the means would understate.

import type { HomeAssistant } from "../types";
import type { SeriesPoint } from "./entity-history";
import { cachedStatsCall } from "./ha-statistics";
import { numericOf, statRowsToSteps, stepExtremes, type TempStatRow } from "./temperature-graph";

const HOUR_MS = 3_600_000;

export interface TempSeries {
  steps: SeriesPoint[];
  /** Real lowest and highest reading in the window, if any. */
  extremes?: { min: number; max: number };
  source: "history" | "statistics" | "none";
}

interface HistoryRow {
  s?: string;
  lu?: number;
}

/**
 * History rows as a step series. The first row is the state the sensor already
 * had when the window opened, stamped with when it got there, which can be
 * days earlier; it is moved to the window's start.
 */
export function historyRowsToSteps(rows: readonly HistoryRow[], start: number): SeriesPoint[] {
  return rows.map((row) => ({ t: Math.max(start, (row.lu ?? 0) * 1000), v: numericOf(row.s) }));
}

async function readHistory(
  hass: HomeAssistant,
  ids: readonly string[],
  start: number,
  end: number,
): Promise<Map<string, TempSeries>> {
  const out = new Map<string, TempSeries>();
  if (!ids.length) return out;
  const response = await hass.callWS<Record<string, HistoryRow[]>>({
    type: "history/history_during_period",
    start_time: new Date(start).toISOString(),
    end_time: new Date(end).toISOString(),
    entity_ids: [...ids],
    minimal_response: true,
    no_attributes: true,
  });
  for (const id of ids) {
    const steps = historyRowsToSteps(response?.[id] ?? [], start);
    const extremes = stepExtremes(steps, start);
    out.set(id, { steps, extremes, source: extremes ? "history" : "none" });
  }
  return out;
}

async function readStatistics(
  hass: HomeAssistant,
  ids: readonly string[],
  start: number,
  end: number,
): Promise<Map<string, TempSeries>> {
  const out = new Map<string, TempSeries>();
  if (!ids.length) return out;
  // Rounded to the hour, so cards opened a few seconds apart share one cached call.
  const response = await cachedStatsCall<Record<string, TempStatRow[]>>(hass, {
    type: "recorder/statistics_during_period",
    start_time: new Date(Math.floor(start / HOUR_MS) * HOUR_MS).toISOString(),
    end_time: new Date(Math.ceil(end / HOUR_MS) * HOUR_MS).toISOString(),
    statistic_ids: [...ids],
    period: "hour",
    types: ["mean", "min", "max"],
  });
  for (const id of ids) {
    const rows = response?.[id] ?? [];
    const steps = statRowsToSteps(rows, HOUR_MS);
    let min = Infinity;
    let max = -Infinity;
    for (const r of rows) {
      const t = typeof r.start === "number" ? r.start : Date.parse(r.start);
      if (!(t + HOUR_MS > start)) continue;
      const lo = typeof r.min === "number" ? r.min : r.mean;
      const hi = typeof r.max === "number" ? r.max : r.mean;
      if (typeof lo === "number" && lo < min) min = lo;
      if (typeof hi === "number" && hi > max) max = hi;
    }
    if (min <= max) out.set(id, { steps, extremes: { min, max }, source: "statistics" });
  }
  return out;
}

/**
 * Reads every sensor for the window ending `now`. Never throws: a sensor that
 * could not be read comes back with `source: "none"`, and the card still shows
 * its current value.
 */
export async function fetchTempSeries(
  hass: HomeAssistant,
  ids: readonly string[],
  windowMs: number,
  historyMaxMs: number,
  now = Date.now(),
): Promise<Map<string, TempSeries>> {
  const start = now - windowMs;
  const out = new Map<string, TempSeries>();
  let rest = [...new Set(ids)];

  if (windowMs > historyMaxMs) {
    const withStats = rest.filter((id) => hass.states[id]?.attributes?.state_class);
    try {
      const stats = await readStatistics(hass, withStats, start, now);
      for (const [id, series] of stats) out.set(id, series);
    } catch {
      // Falls through to the history for all of them.
    }
    rest = rest.filter((id) => !out.has(id));
  }

  try {
    const history = await readHistory(hass, rest, start, now);
    for (const [id, series] of history) out.set(id, series);
  } catch {
    // No recorder, or excluded sensors: nothing to draw, which is an answer.
  }
  for (const id of ids) if (!out.has(id)) out.set(id, { steps: [], source: "none" });
  return out;
}
