import type { HomeAssistant } from "../types";
import { localize } from "../localize";

// How long an entity has really held its state, shared by the cards that say
// "since": the check-in card ("checked out for 2 days") and the openings card
// ("open for 48 min"). Two parts: the recorder lookup that sees through
// restarts, and the one duration format they both print.

const MISSING = new Set(["unavailable", "unknown", ""]);

/** One row of a minimal history response: a state and when it was written. */
export interface HistoryRow {
  s?: string | null;
  /** Seconds since the epoch. */
  lc?: number;
  lu?: number;
}

const isMissing = (s: string | null | undefined): boolean => s == null || MISSING.has(s);

/** What the history says about the current state's start. */
export interface RealChange {
  /** When the current state really began, when the window shows it. */
  at?: number;
  /** The state held through the whole window: it began before `windowStart`. */
  older: boolean;
}

/**
 * When the entity really took its current state, read from its history.
 *
 * A restart, a reload or a mirrored entity reconnecting writes the state
 * again — unavailable for a moment, then the same state as before — and gives
 * it a new last_changed. "Checked out for 5 h" then counts from 4 a.m. rather
 * than from the evening before. Walking back over the rows, gaps of nothing
 * and repeats of the same state belong to the current run; the run starts at
 * the first row after the last *different* real state.
 *
 * With no different state in the window, the history's first row tells which
 * case it is: written at the window's start, the state was already there and
 * is older than the window; written later, the entity is newer than that and
 * its first row is the start. No rows at all (no recorder, or the entity is
 * excluded from it): nothing is known.
 */
export function realChange(rows: HistoryRow[], current: string, windowStart: number): RealChange {
  let start: number | undefined;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (isMissing(row.s)) continue;
    const at = (row.lc ?? row.lu ?? NaN) * 1000;
    if (row.s === current) {
      if (Number.isFinite(at)) start = at;
      continue;
    }
    return { at: start, older: false };
  }
  if (start === undefined) return { older: false };
  // The response opens with the state as it stood at start_time, stamped with
  // that moment; a minute's slack covers the round trip.
  if (start <= windowStart + 60_000) return { older: true };
  return { at: start, older: false };
}

/**
 * The status line's duration in parts: minutes under an hour, hours and
 * minutes under a day, a day and hours under two, then whole days — "48 h
 * 5 min" says less than "2 days".
 */
export function durationSpan(since: number, now: number):
  | { kind: "m"; m: number }
  | { kind: "hm"; h: number; m: number }
  | { kind: "dh"; h: number }
  | { kind: "d"; d: number } {
  const minutes = Math.max(0, Math.floor((now - since) / 60000));
  const h = Math.floor(minutes / 60);
  if (h === 0) return { kind: "m", m: minutes };
  if (h < 24) return { kind: "hm", h, m: minutes % 60 };
  if (h < 48) return { kind: "dh", h: h - 24 };
  return { kind: "d", d: Math.floor(h / 24) };
}

/** One entity's current reading, as the lookup needs it. */
export interface HeldState {
  entity_id: string;
  state: string;
}

/**
 * Asks the recorder, in one call, when each entity really took its current
 * state. Entities with no rows (no recorder, or excluded from it) come back
 * as `{ older: false }`, which leaves the caller on last_changed.
 */
export async function fetchRealChanges(
  hass: HomeAssistant,
  entities: HeldState[],
  days: number,
): Promise<Map<string, RealChange>> {
  const out = new Map<string, RealChange>();
  const wanted = entities.filter((e) => !MISSING.has(e.state));
  if (wanted.length === 0) return out;
  const windowStart = Date.now() - days * 86_400_000;
  const res = await hass.callWS<Record<string, HistoryRow[]>>({
    type: "history/history_during_period",
    start_time: new Date(windowStart).toISOString(),
    entity_ids: wanted.map((e) => e.entity_id),
    minimal_response: true,
    no_attributes: true,
    significant_changes_only: false,
  });
  for (const e of wanted) out.set(e.entity_id, realChange(res?.[e.entity_id] ?? [], e.state, windowStart));
  return out;
}

/** A duration as the status lines print it: "14 Min.", "2 Std. 5 Min.", "1 Tag 3 Std.", "2 Tagen". */
export function formatHeldFor(since: number, now: number, language: string): string {
  const span = durationSpan(since, now);
  const t = (key: Parameters<typeof localize>[0]) => localize(key, language);
  switch (span.kind) {
    case "m":
      return t("checkin_m").replace("{m}", String(span.m));
    case "hm":
      return t("checkin_hm").replace("{h}", String(span.h)).replace("{m}", String(span.m));
    case "dh":
      return span.h === 0 ? t("checkin_1d") : t("checkin_1d_h").replace("{h}", String(span.h));
    case "d":
      return t("checkin_days").replace("{d}", String(span.d));
  }
}
