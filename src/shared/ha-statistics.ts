import type { HomeAssistant } from "../types";

export type StatisticType = "change" | "state";

// Multiple cards on the same dashboard (e.g. cost-card + energy-card, or
// several top-consumers cards) can independently request the exact same
// `recorder/statistics_during_period` window for the same entities within
// the same render burst. Caching by request shape avoids issuing duplicate
// WS round-trips for identical data: in-flight requests are always shared
// (same promise), and completed results stay cached briefly so a page-load
// flurry of near-simultaneous card renders collapses into one fetch.
const STATS_CACHE_TTL_MS = 30_000;
const statsCache = new Map<string, { promise: Promise<unknown>; timestamp: number }>();

export function cachedStatsCall<T>(hass: HomeAssistant, params: Record<string, unknown>): Promise<T> {
  const key = JSON.stringify(params);
  const cached = statsCache.get(key);
  const now = Date.now();
  if (cached && now - cached.timestamp < STATS_CACHE_TTL_MS) {
    return cached.promise as Promise<T>;
  }
  const promise = hass.callWS<T>(params).catch((e) => {
    statsCache.delete(key);
    throw e;
  });
  statsCache.set(key, { promise, timestamp: now });
  return promise;
}

export interface EnergyDaysResult {
  values: number[];
  usingFallback: boolean;
}

interface StatisticRow {
  start: string | number;
  change?: number;
  state?: number;
}

interface HistoryPoint {
  s?: string;
  lu?: number;
}

// A negative "change" for a period is never physically valid for the
// total_increasing/cumulative counters this module targets — consumption
// can't be negative. It only shows up when the recorder's long-term
// statistics lose continuity across a meter reset (observed in practice:
// an entity reload right at a daily reset boundary made the recorder treat
// the post-reset value as a raw decrease instead of a new cycle, baking a
// large negative "change" into that one bucket). Clamping here keeps a
// one-off recorder-side data glitch from corrupting bars/averages/sums
// derived from it; "state"-type reads are snapshots, not deltas, so they're
// left untouched.
function statValue(row: StatisticRow, statisticType: StatisticType): number | undefined {
  const val = row[statisticType];
  if (typeof val !== "number") return undefined;
  return statisticType === "change" && val < 0 ? 0 : val;
}

export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function localHourKey(d: Date): string {
  return `${localDayKey(d)}T${String(d.getHours()).padStart(2, "0")}`;
}

// Start of the still-running bar of the energy card: the current hour in hour mode, local
// midnight in day mode.
export function currentPeriodStart(period: "day" | "hour", now: Date = new Date()): Date {
  const start = new Date(now);
  if (period === "hour") start.setMinutes(0, 0, 0);
  else start.setHours(0, 0, 0, 0);
  return start;
}

function localMonthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Volume units Home Assistant can normalize statistics into. */
const VOLUME_UNITS = new Set(["L", "mL", "m³", "ft³", "CCF", "gal", "fl. oz."]);

// `recorder/statistics_during_period`'s `units` param normalizes mixed
// source units within one unit *class* (e.g. Wh/kWh/MWh all -> kWh) — it has
// no effect on statistics outside the requested class(es), so it's safe to
// pass unconditionally. Gas/water meter entities (device_class "gas"/
// "water") belong to the "volume" class, not "energy", so they need a target
// unit of their own for multiple sources in mixed units (m³ and L) to add up.
//
// That target has to be the unit the caller will *label* the numbers with,
// and that is the entity's own — a card writes `unit_of_measurement` under
// the value unless told otherwise. Asking for m³ regardless, as this did,
// left a litre meter's month reading a thousandth of the truth with "L"
// printed beside it: 57 L of watering showed up as "0.06 L", while the daily
// chart, which asks for no unit at all, had it right. A wrong number under a
// right label is worse than either.
function statisticsUnitsFor(hass: HomeAssistant, entityIds: string[]): Record<string, string> {
  const attributes = hass.states[entityIds[0]]?.attributes;
  if (attributes?.device_class === "gas" || attributes?.device_class === "water") {
    const unit = String(attributes.unit_of_measurement ?? "");
    // An unrecognised unit would be rejected outright, so fall back to the
    // class's base unit and let the values speak for themselves.
    return { volume: VOLUME_UNITS.has(unit) ? unit : "m³" };
  }
  return { energy: "kWh" };
}

// Converts a `wh_hours`-shaped forecast object (ISO hour-start timestamp ->
// watt-hours, as returned by HA's `energy/solar_forecast` WS command and by
// the common convention some forecast integrations expose on an entity
// attribute) into a local-hour-keyed kWh map.
export function mapWhHoursToLocalKwh(whHours: Record<string, number>): Map<string, number> {
  const byHour = new Map<string, number>();
  for (const [iso, wh] of Object.entries(whHours)) {
    if (typeof wh !== "number") continue;
    const d = new Date(iso);
    if (isNaN(d.getTime())) continue;
    const key = localHourKey(d);
    byHour.set(key, (byHour.get(key) ?? 0) + wh / 1000);
  }
  return byHour;
}

// Fetches `days` full past calendar days (not including today — the caller
// reads today's value live from the entity state) via HA's long-term
// statistics API, falling back to the History API (aggregated per day by
// maximum, matching how these *_daily counter sensors behave) when the
// entity has no statistics at all.
export async function fetchEnergyDays(
  hass: HomeAssistant,
  entityId: string,
  days: number,
  statisticType: StatisticType,
): Promise<EnergyDaysResult> {
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const startMidnight = new Date(todayMidnight);
  startMidnight.setDate(startMidnight.getDate() - days);

  const expectedKeys: string[] = [];
  for (let i = days; i >= 1; i--) {
    const d = new Date(todayMidnight);
    d.setDate(d.getDate() - i);
    expectedKeys.push(localDayKey(d));
  }

  try {
    const response = await cachedStatsCall<Record<string, StatisticRow[]>>(hass, {
      type: "recorder/statistics_during_period",
      start_time: startMidnight.toISOString(),
      end_time: todayMidnight.toISOString(),
      statistic_ids: [entityId],
      period: "day",
      types: [statisticType],
    });
    const rows = response[entityId];
    if (rows && rows.length > 0) {
      const byDay = new Map<string, number>();
      for (const row of rows) {
        const d = new Date(row.start);
        const val = statValue(row, statisticType);
        if (val !== undefined) byDay.set(localDayKey(d), val);
      }
      return {
        values: expectedKeys.map((k) => byDay.get(k) ?? 0),
        usingFallback: false,
      };
    }
  } catch (e) {
    console.warn("m3-energy-card: statistics_during_period failed, falling back to history", e);
  }

  const historyResponse = await hass.callWS<Record<string, HistoryPoint[]>>({
    type: "history/history_during_period",
    start_time: startMidnight.toISOString(),
    end_time: todayMidnight.toISOString(),
    entity_ids: [entityId],
    minimal_response: true,
    no_attributes: true,
  });
  const points = historyResponse[entityId] ?? [];
  const byDay = new Map<string, number>();
  for (const p of points) {
    if (p.lu === undefined) continue;
    const raw = parseFloat(p.s ?? "");
    if (isNaN(raw)) continue;
    const key = localDayKey(new Date(p.lu * 1000));
    byDay.set(key, Math.max(byDay.get(key) ?? 0, raw));
  }
  return {
    values: expectedKeys.map((k) => byDay.get(k) ?? 0),
    usingFallback: true,
  };
}

// Fetches `hours` full past hours (not including the current, still-running
// hour — the caller reads that live from the entity state, same pattern as
// fetchEnergyDays uses for "today") via HA's long-term statistics API,
// falling back to the History API when the entity has no statistics.
export async function fetchEnergyHours(
  hass: HomeAssistant,
  entityId: string,
  hours: number,
  statisticType: StatisticType,
): Promise<EnergyDaysResult> {
  const currentHourStart = new Date();
  currentHourStart.setMinutes(0, 0, 0);
  const startTime = new Date(currentHourStart);
  startTime.setHours(startTime.getHours() - hours);

  const expectedKeys: string[] = [];
  for (let i = hours; i >= 1; i--) {
    const d = new Date(currentHourStart);
    d.setHours(d.getHours() - i);
    expectedKeys.push(localHourKey(d));
  }

  try {
    const response = await cachedStatsCall<Record<string, StatisticRow[]>>(hass, {
      type: "recorder/statistics_during_period",
      start_time: startTime.toISOString(),
      end_time: currentHourStart.toISOString(),
      statistic_ids: [entityId],
      period: "hour",
      types: [statisticType],
    });
    const rows = response[entityId];
    if (rows && rows.length > 0) {
      const byHour = new Map<string, number>();
      for (const row of rows) {
        const d = new Date(row.start);
        const val = statValue(row, statisticType);
        if (val !== undefined) byHour.set(localHourKey(d), val);
      }
      return {
        values: expectedKeys.map((k) => byHour.get(k) ?? 0),
        usingFallback: false,
      };
    }
  } catch (e) {
    console.warn("m3-energy-card: statistics_during_period (hour) failed, falling back to history", e);
  }

  const historyResponse = await hass.callWS<Record<string, HistoryPoint[]>>({
    type: "history/history_during_period",
    start_time: startTime.toISOString(),
    end_time: currentHourStart.toISOString(),
    entity_ids: [entityId],
    minimal_response: true,
    no_attributes: true,
  });
  const points = historyResponse[entityId] ?? [];
  const byHour = new Map<string, number>();
  for (const p of points) {
    if (p.lu === undefined) continue;
    const raw = parseFloat(p.s ?? "");
    if (isNaN(raw)) continue;
    const key = localHourKey(new Date(p.lu * 1000));
    byHour.set(key, Math.max(byHour.get(key) ?? 0, raw));
  }
  return {
    values: expectedKeys.map((k) => byHour.get(k) ?? 0),
    usingFallback: true,
  };
}

export interface EnergyMonthsResult {
  values: number[];
  hasStatistics: boolean;
  // How many of the returned `values` entries are backed by actual
  // statistics rows, as opposed to being zero-filled placeholders for
  // months before the entity existed. Lets callers average only over real
  // months instead of diluting the average with pre-existence zeros.
  realMonthCount: number;
}

// Fetches `months - 1` full past calendar months (not including the
// current, still-running month — the caller computes that separately via
// fetchMonthToDateSum + a live/today value, same pattern as fetchEnergyDays
// uses for "today"). Deliberately does NOT ask the recorder for `period:
// "month"` statistics directly: daily-resetting counters (the common case
// this card targets) can log more than one reset event in the same instant
// at midnight (observed in practice), and HA's recorder "change" statistic
// double-counts each of those resets — the error compounds across a whole
// month into a wildly inflated total. Fetching at day granularity and
// summing locally per calendar month reuses the exact per-day values already
// verified correct elsewhere in this card (day/hour mode), sidestepping the
// bug entirely. No History-API fallback: month-scale History queries are
// impractically large, and Energy-dashboard-eligible entities are expected
// to carry long-term statistics — `hasStatistics: false` tells the caller
// to show a clear "no monthly statistics" message instead.
export async function fetchEnergyMonths(
  hass: HomeAssistant,
  entityId: string,
  months: number,
  statisticType: StatisticType,
): Promise<EnergyMonthsResult> {
  const completedCount = months - 1;
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const expectedKeys: string[] = [];
  for (let i = completedCount; i >= 1; i--) {
    const d = new Date(currentMonthStart.getFullYear(), currentMonthStart.getMonth() - i, 1);
    expectedKeys.push(localMonthKey(d));
  }
  if (completedCount <= 0) return { values: [], hasStatistics: true, realMonthCount: 0 };

  const startMonth = new Date(
    currentMonthStart.getFullYear(),
    currentMonthStart.getMonth() - completedCount,
    1,
  );

  try {
    const response = await cachedStatsCall<Record<string, StatisticRow[]>>(hass, {
      type: "recorder/statistics_during_period",
      start_time: startMonth.toISOString(),
      end_time: currentMonthStart.toISOString(),
      statistic_ids: [entityId],
      period: "day",
      types: [statisticType],
      units: statisticsUnitsFor(hass, [entityId]),
    });
    const rows = response[entityId];
    if (rows && rows.length > 0) {
      const byMonth = new Map<string, number>();
      for (const row of rows) {
        const val = statValue(row, statisticType);
        if (val === undefined) continue;
        const key = localMonthKey(new Date(row.start));
        byMonth.set(key, (byMonth.get(key) ?? 0) + val);
      }
      return {
        values: expectedKeys.map((k) => byMonth.get(k) ?? 0),
        hasStatistics: true,
        realMonthCount: expectedKeys.filter((k) => byMonth.has(k)).length,
      };
    }
    return { values: expectedKeys.map(() => 0), hasStatistics: false, realMonthCount: 0 };
  } catch (e) {
    console.warn("m3-energy-card: statistics_during_period (month) failed", e);
    return { values: expectedKeys.map(() => 0), hasStatistics: false, realMonthCount: 0 };
  }
}

// Sums per-day statistics from the start of the current calendar month up to
// (not including) today, for the still-running month's "so far" total in
// month mode. The caller adds today's own contribution on top (read live for
// "state"-type counters, or via a fine-grained current-period sum for
// "change"-type ones) — same day-granularity approach as fetchEnergyMonths,
// for the same reason (avoids the coarser-period reset-double-counting bug).
export async function fetchMonthToDateSum(
  hass: HomeAssistant,
  entityId: string,
  statisticType: StatisticType,
): Promise<number> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const todayMidnight = new Date(now);
  todayMidnight.setHours(0, 0, 0, 0);
  if (todayMidnight <= monthStart) return 0;
  try {
    const response = await cachedStatsCall<Record<string, StatisticRow[]>>(hass, {
      type: "recorder/statistics_during_period",
      start_time: monthStart.toISOString(),
      end_time: todayMidnight.toISOString(),
      statistic_ids: [entityId],
      period: "day",
      types: [statisticType],
      units: statisticsUnitsFor(hass, [entityId]),
    });
    const rows = response[entityId] ?? [];
    let total = 0;
    for (const row of rows) {
      const val = statValue(row, statisticType);
      if (val !== undefined) total += val;
    }
    return total;
  } catch (e) {
    console.warn("m3-energy-card: failed to load month-to-date sum", e);
    return 0;
  }
}

// Fetches today's per-hour actual values (local midnight up to the current,
// still-running hour) summed across one or more entities — used by the solar
// mode of m3-energy-card, which can aggregate multiple Energy-dashboard solar
// sources. No History-API fallback: Energy-dashboard-eligible entities are
// expected to carry long-term statistics.
export async function fetchSolarDayHours(
  hass: HomeAssistant,
  entityIds: string[],
  statisticType: StatisticType,
): Promise<Map<string, number>> {
  const byHour = new Map<string, number>();
  if (entityIds.length === 0) return byHour;

  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const currentHourStart = new Date();
  currentHourStart.setMinutes(0, 0, 0);

  try {
    const response = await cachedStatsCall<Record<string, StatisticRow[]>>(hass, {
      type: "recorder/statistics_during_period",
      start_time: todayMidnight.toISOString(),
      end_time: currentHourStart.toISOString(),
      statistic_ids: entityIds,
      period: "hour",
      types: [statisticType],
      // Solar sensors across multiple sources/integrations are often mixed
      // Wh/kWh — request a consistent unit so summing across entities and
      // against the (already kWh-converted) forecast data lines up.
      units: { energy: "kWh" },
    });
    for (const id of entityIds) {
      const rows = response[id] ?? [];
      for (const row of rows) {
        const val = statValue(row, statisticType);
        if (val === undefined) continue;
        const key = localHourKey(new Date(row.start));
        byHour.set(key, (byHour.get(key) ?? 0) + val);
      }
    }
  } catch (e) {
    console.warn("m3-energy-card: failed to load solar hourly statistics", e);
  }
  return byHour;
}

// Same idea as fetchSolarDayHours, but buckets by calendar day over the
// `days` most recent *completed* days (today excluded — the caller reads
// today live/from the forecast the same way it already does elsewhere).
// Used for the solar-mode day view's comparison/average chips, mirroring
// month-mode's "vs previous month" + "N-month average" pattern one level
// down (vs yesterday + N-day average).
export async function fetchSolarPastDays(
  hass: HomeAssistant,
  entityIds: string[],
  days: number,
  statisticType: StatisticType,
): Promise<number[]> {
  const expectedKeys: string[] = [];
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  for (let i = days; i >= 1; i--) {
    const d = new Date(todayMidnight);
    d.setDate(d.getDate() - i);
    expectedKeys.push(localDayKey(d));
  }
  if (entityIds.length === 0) return expectedKeys.map(() => 0);

  const startMidnight = new Date(todayMidnight);
  startMidnight.setDate(startMidnight.getDate() - days);

  const byDay = new Map<string, number>();
  try {
    const response = await cachedStatsCall<Record<string, StatisticRow[]>>(hass, {
      type: "recorder/statistics_during_period",
      start_time: startMidnight.toISOString(),
      end_time: todayMidnight.toISOString(),
      statistic_ids: entityIds,
      period: "day",
      types: [statisticType],
      units: { energy: "kWh" },
    });
    for (const id of entityIds) {
      for (const row of response[id] ?? []) {
        const val = statValue(row, statisticType);
        if (val === undefined) continue;
        const key = localDayKey(new Date(row.start));
        byDay.set(key, (byDay.get(key) ?? 0) + val);
      }
    }
  } catch (e) {
    console.warn("m3-energy-card: failed to load solar daily statistics", e);
  }
  return expectedKeys.map((k) => byDay.get(k) ?? 0);
}

// Sums the "change" statistic across one or more entities from `periodStart`
// to now, using 5-minute short-term statistics. Used for the still-running
// current hour of "change"-type (lifetime-cumulative, never-resetting)
// counters, where the live entity state is the all-time total and cannot be
// read directly as "this hour's generation" the way a periodically-resetting
// counter's state can.
export async function fetchCurrentPeriodChangeSum(
  hass: HomeAssistant,
  entityIds: string[],
  periodStart: Date,
  granularity: "5minute" | "hour" | "day" = "5minute",
): Promise<number> {
  if (entityIds.length === 0) return 0;
  try {
    const response = await cachedStatsCall<Record<string, StatisticRow[]>>(hass, {
      type: "recorder/statistics_during_period",
      start_time: periodStart.toISOString(),
      end_time: new Date().toISOString(),
      statistic_ids: entityIds,
      period: granularity,
      types: ["change"],
      units: statisticsUnitsFor(hass, entityIds),
    });
    let total = 0;
    for (const id of entityIds) {
      for (const row of response[id] ?? []) {
        const val = statValue(row, "change");
        if (val !== undefined) total += val;
      }
    }
    return total;
  } catch (e) {
    console.warn("m3-energy-card: failed to load current-period change sum", e);
    return 0;
  }
}

// Same as fetchCurrentPeriodChangeSum, but keeps each entity's total
// separate instead of combining them — used by m3-top-consumers-card to
// rank individual devices rather than sum a whole category.
export async function fetchPeriodChangeByEntity(
  hass: HomeAssistant,
  entityIds: string[],
  periodStart: Date,
  periodEnd: Date,
  granularity: "hour" | "day" = "day",
): Promise<Map<string, number>> {
  const byEntity = new Map<string, number>();
  if (entityIds.length === 0) return byEntity;
  try {
    const response = await cachedStatsCall<Record<string, StatisticRow[]>>(hass, {
      type: "recorder/statistics_during_period",
      start_time: periodStart.toISOString(),
      end_time: periodEnd.toISOString(),
      statistic_ids: entityIds,
      period: granularity,
      types: ["change"],
      units: { energy: "kWh" },
    });
    for (const id of entityIds) {
      let total = 0;
      for (const row of response[id] ?? []) {
        const val = statValue(row, "change");
        if (val !== undefined) total += val;
      }
      byEntity.set(id, total);
    }
  } catch (e) {
    console.warn("m3-top-consumers-card: failed to load per-device statistics", e);
  }
  return byEntity;
}

// General-purpose day-bucketed fetch over an arbitrary [start, end) window
// (unlike fetchEnergyDays, which is always a fixed rolling N-days-ending-
// today window) — summed across one or more entities. Used by m3-cost-card
// for its day-bar chart and period-to-date/previous-period totals, for both
// real energy entities (kWh -> unit-normalized) and HA's own synthetic cost
// statistics (monetary, no energy unit class to normalize).
export async function fetchDaySeries(
  hass: HomeAssistant,
  entityIds: string[],
  start: Date,
  end: Date,
  statisticType: StatisticType,
  applyEnergyUnits = true,
): Promise<Map<string, number>> {
  const byDay = new Map<string, number>();
  if (entityIds.length === 0) return byDay;
  try {
    const response = await cachedStatsCall<Record<string, StatisticRow[]>>(hass, {
      type: "recorder/statistics_during_period",
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      statistic_ids: entityIds,
      period: "day",
      types: [statisticType],
      ...(applyEnergyUnits ? { units: statisticsUnitsFor(hass, entityIds) } : {}),
    });
    for (const id of entityIds) {
      for (const row of response[id] ?? []) {
        const val = statValue(row, statisticType);
        if (val === undefined) continue;
        const key = localDayKey(new Date(row.start));
        byDay.set(key, (byDay.get(key) ?? 0) + val);
      }
    }
  } catch (e) {
    console.warn("m3-cost-card: failed to load day series", e);
  }
  return byDay;
}

// Fetches each entity's most recent state value from shortly before
// `hoursAgo` hours ago (a ±10 min window) — a simple point-in-time lookback
// for "did this change in the last hour" trend indicators, unlike every
// other function here which sums/aggregates over a period. Long-term
// statistics don't help here (temperature sensors' mean/min/max buckets
// don't give a single "value at time T"), so this goes straight to the
// History API.
export async function fetchValueHoursAgo(
  hass: HomeAssistant,
  entityIds: string[],
  hoursAgo: number,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (entityIds.length === 0) return result;
  const target = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  const start = new Date(target.getTime() - 10 * 60 * 1000);
  const end = new Date(target.getTime() + 10 * 60 * 1000);
  try {
    const response = await hass.callWS<Record<string, HistoryPoint[]>>({
      type: "history/history_during_period",
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      entity_ids: entityIds,
      minimal_response: true,
      no_attributes: true,
    });
    for (const id of entityIds) {
      const points = response[id] ?? [];
      for (let i = points.length - 1; i >= 0; i--) {
        const raw = parseFloat(points[i].s ?? "");
        if (!isNaN(raw)) {
          result.set(id, raw);
          break;
        }
      }
    }
  } catch (e) {
    console.warn("m3-climate-overview-card: failed to load trend history", e);
  }
  return result;
}

// Used by the editor (Phase 4) to show the "using History-API fallback"
// hint without needing to fetch the full day range.
export async function hasLongTermStatistics(
  hass: HomeAssistant,
  entityId: string,
): Promise<boolean> {
  try {
    const ids = await hass.callWS<Array<{ statistic_id: string }>>({
      type: "recorder/list_statistic_ids",
    });
    return ids.some((s) => s.statistic_id === entityId);
  } catch {
    return false;
  }
}

// How far the readings of a counter that never resets sit above their own
// day-to-day steps before a short run is called cumulative. A meter at
// 1780 kWh that moves 2 kWh a day is ~900x; a daily counter's last readings
// are each one day's use, of the same order as the differences between them.
const CUMULATIVE_RATIO = 10;
// From this many day-to-day steps on, the number of drops decides alone.
const CUMULATIVE_MIN_STEPS = 7;

const dropTolerance = (previous: number): number => Math.max(0.01, Math.abs(previous) * 0.001);

/**
 * Whether a run of last-readings-per-day (oldest first) comes from a counter
 * that keeps counting — a meter, a monthly or yearly utility_meter — rather
 * than one that starts over every day (#55). Summing those readings is only
 * right for the second kind.
 *
 * A daily counter drops back whenever a day used less than the one before:
 * over a week, about every other day. A meter never drops, and a monthly
 * meter once, at the start of the month. So a long run with at most one
 * drop is a running counter. A short run (a sensor only a few days old)
 * must not drop at all and stand far above its daily steps, so a daily
 * counter that happened to rise a few days in a row is not taken for one.
 * Fewer than two readings, or more than one zero, decide nothing.
 */
export function looksCumulative(values: number[]): boolean {
  if (values.length < 2) return false;
  // A running counter reads above zero, save right after a reset. An hourly
  // counter of an appliance that sits idle ends most days at zero, and is
  // no meter.
  if (values.filter((v) => v === 0).length > 1) return false;
  const steps: number[] = [];
  let drops = 0;
  for (let i = 1; i < values.length; i++) {
    const step = values[i] - values[i - 1];
    // A tiny dip is rounding or a recorder hiccup, not a reset.
    if (step < -dropTolerance(values[i - 1])) drops++;
    else steps.push(Math.max(0, step));
  }
  if (values.length - 1 >= CUMULATIVE_MIN_STEPS) return drops <= 1;
  if (drops > 0) return false;
  steps.sort((a, b) => a - b);
  const median = steps[Math.floor(steps.length / 2)];
  const lowest = Math.min(...values);
  return lowest > 0 && lowest > CUMULATIVE_RATIO * median;
}

/**
 * What a running counter used per day, from its last reading of each day and
 * of the day before (oldest first). A drop is a reset — a monthly meter's
 * first of the month, a meter replaced — and the reading after it is what was
 * used since. Not the recorder's "change": that counts a sensor that went to
 * zero for a moment as a reset and adds the whole reading again, which on a
 * real meter here made 26 000 kWh of one November.
 */
export function runningDayUse(previous: number | undefined, days: [string, number][]): Map<string, number> {
  const out = new Map<string, number>();
  let prev = previous;
  for (const [key, value] of days) {
    if (prev !== undefined) {
      const step = value - prev;
      out.set(key, step < -dropTolerance(prev) ? Math.max(0, value) : Math.max(0, step));
    }
    prev = value;
  }
  return out;
}

const sortedDays = (byDay: Map<string, number>): [string, number][] =>
  Array.from(byDay.entries()).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/** Days of readings `detectCounterKind` looks back over. */
const DETECT_DAYS = 8;

export type CounterKind = "daily" | "running";

/**
 * Whether a consumption counter starts over every day or keeps counting —
 * see `looksCumulative`. Decides how the cost card sums it when the config
 * does not say.
 */
export async function detectCounterKind(
  hass: HomeAssistant,
  entityId: string,
  applyEnergyUnits = true,
  now = new Date(),
): Promise<CounterKind> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - DETECT_DAYS);
  const byDay = await fetchDaySeries(hass, [entityId], start, now, "state", applyEnergyUnits);
  return looksCumulative(sortedDays(byDay).map(([, v]) => v)) ? "running" : "daily";
}

/**
 * A running counter's use per day between `start` and `end`, from its last
 * readings (see `runningDayUse`). The day before `start` is read too, so the
 * first day has a reading to count from.
 */
export async function fetchRunningDaySeries(
  hass: HomeAssistant,
  entityId: string,
  start: Date,
  end: Date,
  applyEnergyUnits = true,
): Promise<Map<string, number>> {
  const before = new Date(start);
  before.setDate(before.getDate() - 1);
  const byDay = sortedDays(await fetchDaySeries(hass, [entityId], before, end, "state", applyEnergyUnits));
  const firstKey = localDayKey(start);
  const previous = byDay.filter(([k]) => k < firstKey).pop()?.[1];
  return runningDayUse(previous, byDay.filter(([k]) => k >= firstKey));
}
