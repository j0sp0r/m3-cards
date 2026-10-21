// One entity's recent past as a line: what the detail card draws.
//
// Two sources, tried in order. Long-term statistics first, because they are
// already aggregated on the server — a month of a chatty sensor is 720 hourly
// rows instead of tens of thousands of state changes. They only exist for a
// sensor with a `state_class`, so anything else (a template sensor without
// one, most `input_number`s) falls back to the History API, which every entity
// the recorder keeps has.
//
// The result says which one it came from, because the card has to: a series
// built from five-minute means is not the same claim as a series of raw
// readings, and the fallback is the case the author asked to see.

import type { HomeAssistant } from "../types";
import { cachedStatsCall } from "./ha-statistics";

export type DetailRange = "1h" | "24h" | "7d" | "30d";

export const DETAIL_RANGE_MS: Record<DetailRange, number> = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
};

type StatPeriod = "5minute" | "hour" | "day";

/**
 * Which statistics bucket a range is read in, or none.
 *
 * An hour in five-minute means is twelve points, which is a staircase rather
 * than a line — the raw history is short enough there and says more. A month
 * is read hourly, not daily: thirty points cannot show a day's swing, and the
 * 720 rows are thinned on the client anyway.
 */
export const DETAIL_RANGE_PERIOD: Record<DetailRange, StatPeriod | undefined> = {
  "1h": undefined,
  "24h": "5minute",
  "7d": "hour",
  "30d": "hour",
};

const PERIOD_MS: Record<StatPeriod, number> = {
  "5minute": 300_000,
  hour: 3_600_000,
  day: 86_400_000,
};

/** The most points a curve is drawn through. More than a phone has pixels for. */
export const DETAIL_MAX_POINTS = 300;

/** `v: null` is a hole: the entity was unavailable, or nothing was recorded. */
export interface SeriesPoint {
  t: number;
  v: number | null;
}

export interface EntitySeries {
  points: SeriesPoint[];
  source: "statistics" | "history" | "none";
}

interface StatRow {
  start: string | number;
  mean?: number | null;
  state?: number | null;
}

interface HistoryPoint {
  s?: string;
  lu?: number;
}

/**
 * Reads the series for `range`, ending now.
 *
 * Never throws: a detail view whose graph could not be loaded still has a
 * value to show, and `source: "none"` is how it learns to say so.
 */
export async function fetchEntitySeries(
  hass: HomeAssistant,
  entityId: string,
  range: DetailRange,
  now = Date.now(),
): Promise<EntitySeries> {
  const start = now - DETAIL_RANGE_MS[range];
  const period = DETAIL_RANGE_PERIOD[range];
  const live = liveValue(hass, entityId);

  if (period && hass.states[entityId]?.attributes?.state_class) {
    try {
      const rows = await fetchStatRows(hass, entityId, start, now, period);
      const points = statisticsToPoints(rows, PERIOD_MS[period]);
      if (points.some((p) => p.v !== null)) {
        return { points: thin(withLiveEnd(points, now, live)), source: "statistics" };
      }
    } catch {
      // Falls through to the history, which is the more forgiving of the two.
    }
  }

  try {
    const response = await hass.callWS<Record<string, HistoryPoint[]>>({
      type: "history/history_during_period",
      start_time: new Date(start).toISOString(),
      end_time: new Date(now).toISOString(),
      entity_ids: [entityId],
      minimal_response: true,
      no_attributes: true,
    });
    const points = historyToPoints(response[entityId] ?? [], start);
    if (points.some((p) => p.v !== null)) {
      return { points: thin(withLiveEnd(points, now, live)), source: "history" };
    }
  } catch {
    // No recorder, an excluded entity: nothing to draw, which is an answer.
  }
  return { points: [], source: "none" };
}

async function fetchStatRows(
  hass: HomeAssistant,
  entityId: string,
  start: number,
  end: number,
  period: StatPeriod,
): Promise<StatRow[]> {
  // Rounded to the bucket so two openings a few seconds apart share one
  // cached request instead of each asking for a window that differs by
  // milliseconds.
  const step = PERIOD_MS[period];
  const response = await cachedStatsCall<Record<string, StatRow[]>>(hass, {
    type: "recorder/statistics_during_period",
    start_time: new Date(Math.floor(start / step) * step).toISOString(),
    end_time: new Date(Math.ceil(end / step) * step).toISOString(),
    statistic_ids: [entityId],
    period,
    types: ["mean", "state"],
  });
  return response[entityId] ?? [];
}

/**
 * Statistics rows as points, with a hole wherever buckets are missing.
 *
 * The recorder writes no row for a bucket in which the sensor had no numeric
 * state, so an outage is not a value — it is an absence, and drawing straight
 * across it would invent the readings in between. A measurement carries its
 * value in `mean`; a meter (`total`, `total_increasing`) has no mean and
 * carries it in `state`.
 */
export function statisticsToPoints(rows: readonly StatRow[], periodMs: number): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  let last: number | undefined;
  for (const row of rows) {
    const t = typeof row.start === "number" ? row.start : Date.parse(row.start);
    const v = typeof row.mean === "number" ? row.mean : typeof row.state === "number" ? row.state : null;
    if (!Number.isFinite(t)) continue;
    // A bucket's value describes its whole span; drawn at its middle it lines
    // up with the raw readings that made it.
    const mid = t + periodMs / 2;
    if (last !== undefined && mid - last > periodMs * 2.5) out.push({ t: last + periodMs, v: null });
    out.push({ t: mid, v });
    last = mid;
  }
  return out;
}

/**
 * History rows as points. Anything that is not a number — `unavailable`,
 * `unknown`, a stray text state — becomes a hole rather than being skipped,
 * so the line breaks where the sensor was gone.
 *
 * The first row is the state the entity already had when the window opened,
 * stamped with the time it got there, which can be days before the window.
 * It is moved to the window's start; the line begins there, not off-screen.
 */
export function historyToPoints(rows: readonly HistoryPoint[], start: number): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (const row of rows) {
    const t = Math.max(start, (row.lu ?? 0) * 1000);
    const n = row.s === undefined || row.s === "" ? NaN : Number(row.s);
    out.push({ t, v: Number.isFinite(n) ? n : null });
  }
  return out;
}

function liveValue(hass: HomeAssistant, entityId: string): number | null {
  const n = Number(hass.states[entityId]?.state);
  return Number.isFinite(n) ? n : null;
}

/**
 * The line ends at the value the card shows, at now.
 *
 * Statistics trail by up to a bucket and the last history row is the last
 * *change*, so without this the curve stops short of the big number above it
 * and the "now" marker sits on a value that is not the current one.
 */
function withLiveEnd(points: SeriesPoint[], now: number, live: number | null): SeriesPoint[] {
  if (live === null) return points;
  const lastT = points.length ? points[points.length - 1].t : -Infinity;
  if (lastT >= now) return points;
  return [...points, { t: now, v: live }];
}

function thin(points: SeriesPoint[]): SeriesPoint[] {
  return downsample(points, DETAIL_MAX_POINTS);
}

/**
 * Largest-Triangle-Three-Buckets, run on each unbroken stretch separately.
 *
 * Plain every-nth sampling drops the one spike that made someone open the
 * graph; LTTB keeps whichever point in each bucket bends the line the most,
 * which is what the eye reads as the shape. Holes are kept as they are and the
 * point budget is shared between the stretches by length.
 */
export function downsample(points: readonly SeriesPoint[], max: number): SeriesPoint[] {
  if (points.length <= max) return [...points];
  const runs: SeriesPoint[][] = [];
  let run: SeriesPoint[] = [];
  for (const p of points) {
    if (p.v === null) {
      if (run.length) runs.push(run);
      runs.push([p]);
      run = [];
    } else {
      run.push(p);
    }
  }
  if (run.length) runs.push(run);

  const holes = runs.filter((r) => r[0].v === null).length;
  const valued = points.length - holes;
  const budget = Math.max(2, max - holes);
  const out: SeriesPoint[] = [];
  for (const r of runs) {
    if (r[0].v === null) {
      out.push(r[0]);
      continue;
    }
    const share = Math.max(2, Math.round((r.length / valued) * budget));
    out.push(...lttb(r, share));
  }
  return out;
}

function lttb(data: readonly SeriesPoint[], threshold: number): SeriesPoint[] {
  if (threshold >= data.length || threshold < 3) {
    return threshold >= data.length ? [...data] : [data[0], data[data.length - 1]];
  }
  const out: SeriesPoint[] = [data[0]];
  const every = (data.length - 2) / (threshold - 2);
  let a = 0;
  for (let i = 0; i < threshold - 2; i++) {
    const avgStart = Math.floor((i + 1) * every) + 1;
    const avgEnd = Math.min(Math.floor((i + 2) * every) + 1, data.length);
    let avgT = 0;
    let avgV = 0;
    for (let j = avgStart; j < avgEnd; j++) {
      avgT += data[j].t;
      avgV += data[j].v as number;
    }
    const n = Math.max(1, avgEnd - avgStart);
    avgT /= n;
    avgV /= n;

    const from = Math.floor(i * every) + 1;
    const to = Math.floor((i + 1) * every) + 1;
    const pa = data[a];
    let best = from;
    let bestArea = -1;
    for (let j = from; j < to; j++) {
      const area = Math.abs(
        (pa.t - avgT) * ((data[j].v as number) - (pa.v as number)) -
          (pa.t - data[j].t) * (avgV - (pa.v as number)),
      );
      if (area > bestArea) {
        bestArea = area;
        best = j;
      }
    }
    out.push(data[best]);
    a = best;
  }
  out.push(data[data.length - 1]);
  return out;
}

export interface SeriesExtremes {
  min?: SeriesPoint;
  max?: SeriesPoint;
  first?: SeriesPoint;
}

/** Lowest, highest and first valued point — the markers and the trend's base. */
export function seriesExtremes(points: readonly SeriesPoint[]): SeriesExtremes {
  const out: SeriesExtremes = {};
  for (const p of points) {
    if (p.v === null) continue;
    out.first ??= p;
    if (!out.min || p.v < (out.min.v as number)) out.min = p;
    if (!out.max || p.v > (out.max.v as number)) out.max = p;
  }
  return out;
}
