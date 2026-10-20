// The throughput sparkline: a bounded series of recent readings and the path
// that draws them.
//
// Two sources feed the same buffer. While the card is on screen it appends
// every state change it is handed, which is as live as the integration is.
// On the first render it has no past at all, so it asks the History API once
// and prefills — otherwise a freshly loaded dashboard shows a flat line that
// slowly grows a shape over the next twenty minutes.

import type { HomeAssistant } from "../types";
import { toBitsPerSecond } from "./router";

/** Default number of points kept, matching `spark_points`. */
export const DEFAULT_SPARK_POINTS = 40;

/**
 * Appends to a bounded series, in place of a class: the card holds the array
 * and this decides what it may contain.
 *
 * Returns a new array rather than mutating, so Lit sees a changed reference
 * and re-renders. The arrays are 40 numbers long; copying one is cheaper than
 * the `requestUpdate` it would otherwise take.
 */
export function pushPoint(series: readonly number[], value: number, max: number): number[] {
  if (!Number.isFinite(value)) return [...series];
  const next = [...series, value];
  return next.length > max ? next.slice(next.length - max) : next;
}

/**
 * An SVG path through the series, scaled to its own maximum.
 *
 * Scaled locally and not to the line rate on purpose: a 50 Mbit/s connection
 * idling at 6 kbit/s would otherwise draw a flat line along the floor, and the
 * question this answers is "what has it been doing lately", not "how close to
 * the limit is it".
 *
 * `peak` can pin the scale instead — passing the day's maximum makes several
 * cards comparable, at the cost of flattening a quiet one.
 */
export function sparklinePath(
  series: readonly number[],
  width: number,
  height: number,
  peak?: number,
): string {
  if (series.length < 2) return "";
  const max = Math.max(peak ?? 0, ...series);
  // Everything at zero: one flat line on the floor, not a division by zero.
  if (!Number.isFinite(max) || max <= 0) {
    return `M0 ${height.toFixed(2)}L${width.toFixed(2)} ${height.toFixed(2)}`;
  }
  const stepX = width / (series.length - 1);
  return series
    .map((v, i) => {
      const x = i * stepX;
      // The stroke has width; a point at the very top would be clipped in half
      // by the viewBox, so the usable band stops just short of both edges.
      const y = height - (Math.max(0, v) / max) * (height - 1) - 0.5;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join("");
}

interface HistoryPoint {
  s?: string;
  lu?: number;
}

/**
 * The prefill cache, keyed by entity and bucketed to the minute.
 *
 * Two cards on the same dashboard asking for the same sensor — the common
 * case, since the router card is usually placed once per view but a dashboard
 * may hold several views — share one round-trip. The bucket expires the entry
 * without needing a timer.
 */
const prefillCache = new Map<string, Promise<number[]>>();

/** Exposed for tests; a card never calls it. */
export function _clearPrefillCache(): void {
  prefillCache.clear();
}

/**
 * Reads the last `points` values of a throughput sensor out of the recorder.
 *
 * Returns an empty array on any failure — no recorder, excluded entity, a
 * stricter HA — because a sparkline is an ornament on a value that is
 * displayed anyway, and a card that renders nothing because its decoration
 * could not be drawn is a worse card.
 */
export async function prefillSeries(
  hass: HomeAssistant,
  entityId: string,
  points: number,
  minutes = 60,
): Promise<number[]> {
  const bucket = Math.floor(Date.now() / 60_000);
  const key = `${entityId}|${points}|${minutes}|${bucket}`;
  const cached = prefillCache.get(key);
  if (cached) return cached;

  const run = (async () => {
    const end = new Date();
    const start = new Date(end.getTime() - minutes * 60_000);
    let response: Record<string, HistoryPoint[]> = {};
    try {
      response = await hass.callWS<Record<string, HistoryPoint[]>>({
        type: "history/history_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        entity_ids: [entityId],
        minimal_response: true,
        no_attributes: true,
      });
    } catch {
      return [];
    }
    const unit = hass.states[entityId]?.attributes.unit_of_measurement;
    const raw = (response[entityId] ?? [])
      .map((p) => Number(p.s))
      .filter((n) => Number.isFinite(n))
      .map((n) => toBitsPerSecond(n, unit));
    return takeEvenly(raw, points);
  })();

  prefillCache.set(key, run);
  // A failed lookup should not be remembered for a minute: the next render
  // gets to try again.
  run.catch(() => prefillCache.delete(key));
  return run;
}

/**
 * Thins a long history down to `points` samples spread across the window.
 *
 * Taking the last 40 of 600 recorder rows would cover the last four minutes
 * and call it an hour. Spreading them keeps the shape of the whole window,
 * which is what the picture claims to show.
 */
export function takeEvenly(values: readonly number[], points: number): number[] {
  if (points <= 0) return [];
  if (values.length <= points) return [...values];
  const out: number[] = [];
  const step = (values.length - 1) / (points - 1);
  for (let i = 0; i < points; i++) out.push(values[Math.round(i * step)]);
  return out;
}
