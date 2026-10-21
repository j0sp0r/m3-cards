// An entity's states over time, as stretches: what the timeline draws and the
// tiles under it count.
//
// Only the History API knows this. Long-term statistics exist for numbers,
// and a door's "open for 14 minutes at 9:02" is not a number.

import type { HomeAssistant } from "../types";
import { DETAIL_RANGE_MS, type DetailRange } from "./entity-history";

export interface StateSegment {
  state: string;
  from: number;
  to: number;
}

export interface StateTimeline {
  segments: StateSegment[];
  source: "history" | "none";
  range: DetailRange;
}

interface HistoryPoint {
  s?: string;
  lu?: number;
}

const MISSING = new Set(["unavailable", "unknown", ""]);

export function isMissingState(state: string): boolean {
  return MISSING.has(state);
}

/** Local midnight before `now` — where "today" starts for "changes today". */
export function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Reads the timeline for `range`, ending now.
 *
 * The request reaches back to midnight when the range is shorter than today,
 * because "changes today" is asked of every two-state entity whichever period
 * is on screen. The extra rows cost a few bytes; drawing clips them.
 */
export async function fetchStateTimeline(
  hass: HomeAssistant,
  entityId: string,
  range: DetailRange,
  now = Date.now(),
): Promise<StateTimeline> {
  const start = Math.min(now - DETAIL_RANGE_MS[range], startOfDay(now));
  try {
    const response = await hass.callWS<Record<string, HistoryPoint[]>>({
      type: "history/history_during_period",
      start_time: new Date(start).toISOString(),
      end_time: new Date(now).toISOString(),
      entity_ids: [entityId],
      minimal_response: true,
      no_attributes: true,
    });
    const segments = historyToSegments(response[entityId] ?? [], start, now);
    if (segments.length) return { segments, source: "history", range };
  } catch {
    // Excluded from the recorder, or no recorder: the view says so.
  }
  return { segments: [], source: "none", range };
}

/**
 * Rows of state changes as stretches, merged where a row repeats the state
 * before it (an attribute change with no state change still makes a row).
 * The first row may be stamped long before `start` — it is the state the
 * entity was already in — and is pulled to `start`. The last stretch runs to
 * `now`.
 */
export function historyToSegments(rows: readonly HistoryPoint[], start: number, now: number): StateSegment[] {
  const out: StateSegment[] = [];
  for (let i = 0; i < rows.length; i++) {
    const state = rows[i].s ?? "";
    const from = Math.max(start, (rows[i].lu ?? 0) * 1000);
    const to = i + 1 < rows.length ? Math.max(start, (rows[i + 1].lu ?? 0) * 1000) : now;
    if (to <= from) continue;
    const last = out[out.length - 1];
    if (last && last.state === state && last.to >= from) last.to = to;
    else out.push({ state, from, to });
  }
  return out;
}

/** The stretches inside [t0, t1], cut at the edges. */
export function clipSegments(segments: readonly StateSegment[], t0: number, t1: number): StateSegment[] {
  const out: StateSegment[] = [];
  for (const s of segments) {
    const from = Math.max(t0, s.from);
    const to = Math.min(t1, s.to);
    if (to > from) out.push({ state: s.state, from, to });
  }
  return out;
}

export interface StateShare {
  state: string;
  ms: number;
  /** How many times the entity went into this state inside the window. */
  count: number;
}

/**
 * Time spent in each state inside [t0, t1], longest first. Unavailable and
 * unknown are left out: "unavailable for 3 hours" is a fact about the device,
 * not one of the entity's states, and the timeline shows it as a gap already.
 */
export function stateShares(segments: readonly StateSegment[], t0: number, t1: number): StateShare[] {
  const by = new Map<string, StateShare>();
  for (const s of clipSegments(segments, t0, t1)) {
    if (isMissingState(s.state)) continue;
    const share = by.get(s.state) ?? { state: s.state, ms: 0, count: 0 };
    share.ms += s.to - s.from;
    share.count += 1;
    by.set(s.state, share);
  }
  return [...by.values()].sort((a, b) => b.ms - a.ms);
}

/**
 * Changes between two real states inside [t0, t1]. A dropout and back to the
 * same state is not a change; a dropout between two different states is one.
 */
export function countChanges(segments: readonly StateSegment[], t0: number, t1: number): number {
  let changes = 0;
  let previous: string | undefined;
  for (const s of segments) {
    if (isMissingState(s.state)) continue;
    if (previous !== undefined && s.state !== previous && s.from >= t0 && s.from <= t1) changes++;
    previous = s.state;
  }
  return changes;
}
