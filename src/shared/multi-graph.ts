// The multi graph card's arithmetic, kept free of the DOM so it can be
// tested: which entries, which range, the curves on one shared time grid, the
// scale, the axis labels, and the figures in the header.
//
// ONE GRID FOR ALL CURVES
//
// Every curve is reduced to the same n buckets of the window, each bucket the
// time-weighted mean of what the sensor read during it. Two things follow from
// that. The point budget is spent evenly (about one point per 4px), however
// chatty a sensor is. And a finger on the graph lands in one bucket for every
// curve at once, so the values the chips show while scrubbing are the values
// of the curves under the finger, not the nearest reading of each sensor
// somewhere around that time.
//
// A reading holds until the next one: that is what a state is. A bucket in
// which the sensor read nothing numeric at all (it was unavailable, or there is
// no record yet) is a hole, and the line breaks there instead of bridging it.

import type { SeriesPoint } from "./entity-history";
import type { XY } from "./smooth-path";
import type { MultiGraphEntityConfig, MultiGraphRange, MultiGraphRoomConfig, MultiGraphSort } from "../types";

export const MULTI_GRAPH_RANGE_MS: Record<MultiGraphRange, number> = {
  "6h": 6 * 3_600_000,
  "12h": 12 * 3_600_000,
  "24h": 24 * 3_600_000,
  "48h": 48 * 3_600_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
};

export const MULTI_GRAPH_RANGES = Object.keys(MULTI_GRAPH_RANGE_MS) as MultiGraphRange[];

export function isMultiGraphRange(v: unknown): v is MultiGraphRange {
  return typeof v === "string" && v in MULTI_GRAPH_RANGE_MS;
}

/** The room field a device class reads: humidity has its own, everything else the temperature sensor. */
export function roomEntity(room: MultiGraphRoomConfig, deviceClass: string | undefined): string | undefined {
  const id = deviceClass === "humidity" ? room.humidity_entity : room.temperature_entity;
  return typeof id === "string" && id.trim() !== "" ? id : undefined;
}

/**
 * A room list (the climate overview card's format) as curves. Only
 * temperature and humidity have a field there; for any other class a room
 * list says nothing, and rooms without a sensor for the class are left out.
 */
export function roomsToEntries(rooms: readonly MultiGraphRoomConfig[] | undefined, deviceClass?: string): MultiGraphEntityConfig[] {
  const cls = deviceClass ?? "temperature";
  if (cls !== "temperature" && cls !== "humidity") return [];
  return (rooms ?? [])
    .filter((r) => !!r && !!roomEntity(r, cls))
    .map((r) => ({ entity: roomEntity(r, cls)!, name: r.name || undefined, color: r.color || undefined }));
}

/** An `entities` list as objects, without empty rows (the editor adds one to fill in). */
export function normalizeEntities(list: ReadonlyArray<string | MultiGraphEntityConfig> | undefined): MultiGraphEntityConfig[] {
  return (list ?? [])
    .map((e) => (typeof e === "string" ? { entity: e } : e))
    .filter((e): e is MultiGraphEntityConfig => !!e && typeof e.entity === "string" && e.entity.trim() !== "")
    .map((e) => ({ entity: e.entity, name: e.name || undefined, color: e.color || undefined }));
}

/** Chip and curve order. "area" keeps the order found or listed; the overview's temp_* names mean the value orders. */
export function sortEntries<T extends { name: string; live: number | null }>(rows: readonly T[], sort: MultiGraphSort | undefined, language: string): T[] {
  if (sort === "name") return [...rows].sort((a, b) => a.name.localeCompare(b.name, language));
  if (sort === "value_desc" || sort === "temp_desc") return [...rows].sort((a, b) => (b.live ?? -Infinity) - (a.live ?? -Infinity));
  if (sort === "value_asc" || sort === "temp_asc") return [...rows].sort((a, b) => (a.live ?? Infinity) - (b.live ?? Infinity));
  return [...rows];
}

export interface ClassProfile {
  icon: string;
  /** Decimals when neither the config nor the sensor's display precision says. */
  decimals: number;
}

/**
 * What a device class changes on the card. Classes read in whole numbers
 * (ppm, lx, W, %) drop the decimal; anything not listed keeps one.
 */
const PROFILES: Record<string, ClassProfile> = {
  temperature: { icon: "mdi:thermometer", decimals: 1 },
  humidity: { icon: "mdi:water-percent", decimals: 0 },
  moisture: { icon: "mdi:water-percent", decimals: 0 },
  carbon_dioxide: { icon: "mdi:molecule-co2", decimals: 0 },
  volatile_organic_compounds: { icon: "mdi:air-filter", decimals: 0 },
  pm25: { icon: "mdi:blur", decimals: 0 },
  pm10: { icon: "mdi:blur", decimals: 0 },
  illuminance: { icon: "mdi:brightness-5", decimals: 0 },
  power: { icon: "mdi:flash", decimals: 0 },
  pressure: { icon: "mdi:gauge", decimals: 0 },
  atmospheric_pressure: { icon: "mdi:gauge", decimals: 0 },
  sound_pressure: { icon: "mdi:volume-high", decimals: 0 },
  battery: { icon: "mdi:battery", decimals: 0 },
  voltage: { icon: "mdi:sine-wave", decimals: 1 },
  current: { icon: "mdi:current-ac", decimals: 1 },
};

export function classProfile(deviceClass: string | undefined): ClassProfile {
  return PROFILES[deviceClass ?? "temperature"] ?? { icon: "mdi:chart-line", decimals: 1 };
}

/** The device classes the editor offers; any other can be typed in. */
export const MULTI_GRAPH_CLASSES = Object.keys(PROFILES);

/**
 * A value as the chips and pills write it: a temperature with a bare degree
 * sign ("21,4°", the unit is in the header), a percentage with a thin space,
 * anything else with its unit.
 */
export function shortValue(text: string, deviceClass: string | undefined, unit: string): string {
  if ((deviceClass ?? "temperature") === "temperature") return `${text}°`;
  return unit ? `${text}\u202f${unit}` : text;
}

/** The ranges on offer, in the order given and without unknown ones, and the first shown. */
export function resolveRanges(
  ranges: readonly unknown[] | undefined,
  fallback: readonly MultiGraphRange[],
  initial?: unknown,
): { ranges: MultiGraphRange[]; initial: MultiGraphRange } {
  const valid = [...new Set((ranges ?? []).filter(isMultiGraphRange))];
  const list = valid.length ? valid : [...fallback];
  return { ranges: list, initial: isMultiGraphRange(initial) && list.includes(initial) ? initial : list[0] };
}

/** The entry in focus at first: an index, or an entity id; anything else is the first. */
export function resolveFocus(focus: number | string | undefined, entries: readonly MultiGraphEntityConfig[]): number {
  if (typeof focus === "number" && Number.isInteger(focus) && focus >= 0 && focus < entries.length) return focus;
  if (typeof focus === "string") {
    const i = entries.findIndex((e) => e.entity === focus);
    if (i >= 0) return i;
    const n = Number(focus);
    if (Number.isInteger(n) && n >= 0 && n < entries.length) return n;
  }
  return 0;
}

export function numericOf(state: string | undefined): number | null {
  if (state === undefined || state === "") return null;
  const n = Number(state);
  return Number.isFinite(n) ? n : null;
}

/** How many buckets a graph this wide is drawn with. */
export function bucketCount(width: number, pxPerPoint: number, min: number, max: number): number {
  if (!(width > 0)) return min;
  return Math.max(min, Math.min(max, Math.round(width / pxPerPoint)));
}

/**
 * The time-weighted mean of a step series in each of `n` equal buckets of
 * [t0, t1). `steps` is sorted by time; each value holds until the next step,
 * the last one until t1. A bucket with no numeric time in it is null.
 */
export function stepMeans(steps: readonly SeriesPoint[], t0: number, t1: number, n: number): (number | null)[] {
  const out: (number | null)[] = new Array(n).fill(null);
  if (n <= 0 || !(t1 > t0) || steps.length === 0) return out;
  const width = (t1 - t0) / n;
  const sum = new Array<number>(n).fill(0);
  const covered = new Array<number>(n).fill(0);
  for (let k = 0; k < steps.length; k++) {
    const v = steps[k].v;
    if (v === null) continue;
    const a = Math.max(t0, steps[k].t);
    const b = Math.min(t1, k + 1 < steps.length ? steps[k + 1].t : t1);
    if (!(b > a)) continue;
    let i = Math.min(n - 1, Math.floor((a - t0) / width));
    while (i < n) {
      const bucketStart = t0 + i * width;
      const bucketEnd = bucketStart + width;
      const overlap = Math.min(b, bucketEnd) - Math.max(a, bucketStart);
      if (overlap > 0) {
        sum[i] += v * overlap;
        covered[i] += overlap;
      }
      if (bucketEnd >= b) break;
      i++;
    }
  }
  for (let i = 0; i < n; i++) if (covered[i] > 0) out[i] = sum[i] / covered[i];
  return out;
}

export interface StatMeanRow {
  start: string | number;
  mean?: number | null;
  min?: number | null;
  max?: number | null;
}

/**
 * Hourly statistics as a step series: each mean holds for its hour, and a
 * missing hour (the recorder writes no row for one without a numeric state)
 * is a hole.
 */
export function statRowsToSteps(rows: readonly StatMeanRow[], periodMs: number): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  let end: number | undefined;
  for (const row of rows) {
    const t = typeof row.start === "number" ? row.start : Date.parse(row.start);
    if (!Number.isFinite(t)) continue;
    if (end !== undefined && t > end) out.push({ t: end, v: null });
    out.push({ t, v: typeof row.mean === "number" && Number.isFinite(row.mean) ? row.mean : null });
    end = t + periodMs;
  }
  if (end !== undefined) out.push({ t: end, v: null });
  return out;
}

/**
 * Adds a live reading to a step series, if it says something new. Returns the
 * same array when it does not, so a caller can tell nothing changed.
 */
export function appendLive(steps: SeriesPoint[], t: number, v: number | null): SeriesPoint[] {
  const last = steps[steps.length - 1];
  if (last && last.v === v) return steps;
  // A live reading older than the series' end (a slow state push) is not news.
  if (last && t < last.t) return steps;
  return [...steps, { t, v }];
}

/** The lowest and highest numeric value at or after t0. */
export function stepExtremes(steps: readonly SeriesPoint[], t0: number): { min: number; max: number } | undefined {
  let min = Infinity;
  let max = -Infinity;
  for (let k = 0; k < steps.length; k++) {
    const v = steps[k].v;
    if (v === null) continue;
    const until = k + 1 < steps.length ? steps[k + 1].t : Infinity;
    if (until <= t0) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min <= max ? { min, max } : undefined;
}

export function mean(values: readonly number[]): number | undefined {
  if (!values.length) return undefined;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function median(values: readonly number[]): number | undefined {
  if (!values.length) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Index of the highest value; the first one wins a tie. -1 when none is a number. */
export function highestIndex(values: readonly (number | null)[]): number {
  let best = -1;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null) continue;
    if (best < 0 || v > (values[best] as number)) best = i;
  }
  return best;
}

export interface GraphScale {
  lo: number;
  hi: number;
  /** y in px for a value, with `pad` kept free above and below. */
  y: (v: number) => number;
}

/** One scale for every curve: their lowest and highest drawn value. */
export function graphScale(curves: readonly (readonly (number | null)[])[], height: number, pad: number): GraphScale | undefined {
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of curves)
    for (const v of c) {
      if (v === null) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  if (!(lo <= hi)) return undefined;
  // A flat line is drawn through the middle, not along an edge.
  const span = hi - lo || 1;
  const a = hi === lo ? lo - span / 2 : lo;
  const b = hi === lo ? hi + span / 2 : hi;
  const inner = Math.max(1, height - 2 * pad);
  return { lo, hi, y: (v: number) => pad + ((b - v) / (b - a)) * inner };
}

/** The unbroken stretches of a curve as points; a null ends one. */
export function curveRuns(values: readonly (number | null)[], x: (i: number) => number, y: (v: number) => number): XY[][] {
  const runs: XY[][] = [];
  let run: XY[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (run.length) runs.push(run);
      run = [];
      return;
    }
    run.push({ x: x(i), y: y(v) });
  });
  if (run.length) runs.push(run);
  return runs;
}

export interface AxisLabel {
  /** 0 at the window's start, 1 at now. */
  at: number;
  label: string;
  align: "start" | "center" | "end";
}

const HOUR_STEP: Partial<Record<MultiGraphRange, number>> = { "6h": 2, "12h": 3, "24h": 6, "48h": 12 };

/**
 * A few labels along the time axis: full hours on a clock grid for the short
 * ranges ("0 Uhr, 6, 12, 18"), weekdays for a week, Mondays for a month — and
 * "now" at the right end. Labels that would crowd another are left out.
 */
export function axisLabels(range: MultiGraphRange, t0: number, t1: number, language: string, nowLabel: string): AxisLabel[] {
  const span = t1 - t0;
  const times: number[] = [];
  const step = HOUR_STEP[range];
  if (step) {
    const d = new Date(t0);
    d.setMinutes(0, 0, 0);
    while (d.getTime() <= t0 || d.getHours() % step !== 0) d.setHours(d.getHours() + 1);
    for (; d.getTime() < t1; d.setHours(d.getHours() + step)) times.push(d.getTime());
  } else {
    const d = new Date(t0);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 1);
    for (; d.getTime() < t1; d.setDate(d.getDate() + 1)) {
      if (range === "30d" && d.getDay() !== 1) continue;
      times.push(d.getTime());
    }
  }

  const labels: AxisLabel[] = [];
  const hourFmt = new Intl.DateTimeFormat(language, { hour: "numeric" });
  // A 24-hour clock writes "0 Uhr", "6 Uhr": the unit once is enough. A
  // 12-hour clock needs its AM/PM on every label.
  const twelveHour = hourFmt.formatToParts(new Date(t0)).some((p) => p.type === "dayPeriod");
  const dayFmt =
    range === "30d"
      ? new Intl.DateTimeFormat(language, { day: "numeric", month: "numeric" })
      : new Intl.DateTimeFormat(language, { weekday: "short" });
  const minGap = 0.11;
  const nowGap = 0.13;
  for (const t of times) {
    const at = (t - t0) / span;
    if (at > 1 - nowGap) continue;
    if (labels.length && at - labels[labels.length - 1].at < minGap) continue;
    let label: string;
    if (step) {
      // "00 Uhr" is how German ICU writes midnight; a clock face says 0.
      const parts = hourFmt.formatToParts(new Date(t)).map((p) =>
        p.type === "hour" ? { ...p, value: String(Number(p.value)) } : p,
      );
      label =
        labels.length === 0 || twelveHour
          ? parts.map((p) => p.value).join("")
          : (parts.find((p) => p.type === "hour")?.value ?? parts.map((p) => p.value).join(""));
    } else {
      label = dayFmt.format(new Date(t)).replace(/\.$/, "");
    }
    labels.push({ at, label, align: at < 0.05 ? "start" : "center" });
  }
  labels.push({ at: 1, label: nowLabel, align: "end" });
  return labels;
}

/** A number with exactly `decimals` places, in the language's own way. */
export function formatValue(value: number, decimals: number, language: string): string {
  // A reading that rounds to zero is zero, not "-0": a smoothed power curve
  // dips a hair below it.
  if (Math.abs(value) < 0.5 * 10 ** -decimals) value = 0;
  return new Intl.NumberFormat(language, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}

/**
 * The line as drawn: a triangular moving average within each unbroken
 * stretch. A sensor reports in 0.1° steps, so its bucket means come in flat
 * runs with a jump between them, and even a monotone curve through those
 * reads as a staircase. Only the drawing is smoothed; the readout while
 * scrubbing stays on the bucket means. Holes stay holes, and nothing is
 * averaged across one.
 */
export function smoothCurve(values: readonly (number | null)[], radius: number): (number | null)[] {
  if (radius < 1) return [...values];
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    if (values[i] === null) continue;
    let sum = 0;
    let weight = 0;
    for (let d = -radius; d <= radius; d++) {
      const j = i + d;
      if (j < 0 || j >= values.length) continue;
      // Stops at a hole on either side.
      const between = d < 0 ? values.slice(j, i) : values.slice(i + 1, j + 1);
      if (between.some((v) => v === null)) continue;
      const w = radius + 1 - Math.abs(d);
      sum += (values[j] as number) * w;
      weight += w;
    }
    out[i] = sum / weight;
  }
  return out;
}

/**
 * Which discovered rooms the graph draws. The climate overview card's
 * discovery also turns every sensor without an area into a room of its own —
 * on a real install that is the system monitor, a router, the mailbox and
 * every thermostat's built-in sensor, forty curves on one graph. Here a room
 * is an area; a sensor without one is drawn only when `include_entities`
 * names it.
 */
export function graphRooms<T extends { areaId?: string; name: string; temperatureEntity?: string; humidityEntity?: string }>(
  rooms: readonly T[],
  includeEntities: readonly string[] | undefined,
  deviceClass?: string,
): { name: string; entity: string }[] {
  const named = new Set(includeEntities ?? []);
  const out: { name: string; entity: string }[] = [];
  for (const r of rooms) {
    const entity = deviceClass === "humidity" ? r.humidityEntity : r.temperatureEntity;
    if (entity && (r.areaId || named.has(entity))) out.push({ name: r.name, entity });
  }
  return out;
}
