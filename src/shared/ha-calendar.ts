import type { HomeAssistant } from "../types";

// Events must come from the `calendar.get_events` service, not from the
// entity's attributes: those carry only the next event, which is useless for a
// list. The service returns date-only strings for all-day events and full ISO
// timestamps for timed ones — verified against a Local Calendar and two ICS
// feeds, where all-day came back as "2026-09-01" and timed as
// "2026-08-31T09:00:00+02:00". That is the whole all-day test.

export interface CalendarEvent {
  /** The calendar this came from, so a row can be coloured by its source. */
  calendarId: string;
  summary: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  allDay: boolean;
}

interface RawEvent {
  start: string;
  end: string;
  summary?: string;
  description?: string;
  location?: string;
}

interface CacheEntry {
  promise: Promise<CalendarEvent[]>;
  ts: number;
}

/** How long a fetched range stays good. */
export const CALENDAR_CACHE_MS = 5 * 60 * 1000;

// One cache for the page. Two cards asking for the same calendar over the same
// range therefore make one request between them rather than one each, which is
// the whole point — a month view and an agenda view of the same calendars would
// otherwise double every fetch. A frontend has one connection per page, so
// there is nothing to key this on that would ever hold a second entry.
const cache = new Map<string, CacheEntry>();

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * The service wants a naive local timestamp, not an ISO string with an offset:
 * `toISOString()` converts to UTC and silently shifts the range by the local
 * offset, which loses or gains events at both ends of the window.
 */
export function localTimestamp(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** A date-only string means all day; anything with a time part does not. */
function isAllDay(raw: string): boolean {
  return !raw.includes("T") && !raw.includes(":");
}

function parse(raw: string): Date {
  // A date-only string parsed by `new Date()` is treated as UTC midnight,
  // which lands on the previous day west of Greenwich. Split it by hand.
  if (isAllDay(raw)) {
    const [y, m, d] = raw.split("-").map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1);
  }
  return new Date(raw);
}

function normalise(calendarId: string, raw: RawEvent): CalendarEvent {
  const allDay = isAllDay(raw.start);
  const start = parse(raw.start);
  const end = parse(raw.end);
  return {
    calendarId,
    summary: raw.summary ?? "",
    description: raw.description || undefined,
    location: raw.location || undefined,
    start,
    // An all-day event's `end` is exclusive — a one-day event ends on the next
    // day. Pulling it back a millisecond keeps "does this day contain the
    // event" a plain comparison everywhere else in the card.
    end: allDay ? new Date(end.getTime() - 1) : end,
    allDay,
  };
}

async function fetchOne(
  hass: HomeAssistant,
  entityId: string,
  start: Date,
  end: Date,
): Promise<CalendarEvent[]> {
  // `call_service` with `return_response`, not `execute_script`: the latter
  // is admin-only, so a non-admin user saw no events at all (#32).
  const response = await hass.callWS<{ response?: Record<string, { events?: RawEvent[] }> }>({
    type: "call_service",
    domain: "calendar",
    service: "get_events",
    service_data: { start_date_time: localTimestamp(start), end_date_time: localTimestamp(end) },
    target: { entity_id: entityId },
    return_response: true,
  });
  const events = response?.response?.[entityId]?.events ?? [];
  return events.map((e) => normalise(entityId, e));
}

/**
 * Events for several calendars over one range, merged and sorted by start.
 *
 * A calendar that fails — unavailable, or an integration that has gone away —
 * contributes nothing instead of failing the whole card. Which ones failed is
 * reported separately, because a card that silently shows four calendars'
 * events while claiming to show five is worse than one that says so.
 */
export async function fetchCalendarEvents(
  hass: HomeAssistant,
  entityIds: string[],
  start: Date,
  end: Date,
): Promise<{ events: CalendarEvent[]; failed: string[] }> {
  const now = Date.now();
  const failed: string[] = [];
  const results = await Promise.all(
    entityIds.map(async (entityId) => {
      const key = `${entityId}|${start.getTime()}|${end.getTime()}`;
      const hit = cache.get(key);
      if (hit && now - hit.ts < CALENDAR_CACHE_MS) {
        try {
          return await hit.promise;
        } catch {
          failed.push(entityId);
          return [];
        }
      }
      const promise = fetchOne(hass, entityId, start, end);
      cache.set(key, { promise, ts: now });
      try {
        return await promise;
      } catch {
        // Do not keep a rejected promise around: the next render would reuse
        // it for five minutes and the calendar could never recover on its own.
        cache.delete(key);
        failed.push(entityId);
        return [];
      }
    }),
  );

  const events = results.flat().sort((a, b) => a.start.getTime() - b.start.getTime());
  return { events, failed };
}

/** Drops every cached range, so the next read goes back to the service. */
export function clearCalendarCache(): void {
  cache.clear();
}

/** Midnight at the start of `d`, in the browser's zone. */
export function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Every day an event touches, so a multi-day event appears on each of them. */
export function daysSpanned(event: CalendarEvent): number {
  const first = startOfDay(event.start).getTime();
  const last = startOfDay(event.end).getTime();
  return Math.max(1, Math.round((last - first) / 86400000) + 1);
}

export function dayIndexOf(event: CalendarEvent, day: Date): number {
  const first = startOfDay(event.start).getTime();
  const target = startOfDay(day).getTime();
  return Math.round((target - first) / 86400000) + 1;
}

export function occursOn(event: CalendarEvent, day: Date): boolean {
  const from = startOfDay(day).getTime();
  const to = from + 86400000 - 1;
  return event.start.getTime() <= to && event.end.getTime() >= from;
}

/**
 * Timed events only, deliberately. An all-day event covering today is not
 * "running now" in any sense a reader gets something from — it would put a NOW
 * badge on every birthday and every bin collection, under a heading that
 * already says Today. Use `occursOn` for "is this event on this day".
 */
export function isRunning(event: CalendarEvent, now = new Date()): boolean {
  if (event.allDay) return false;
  return event.start.getTime() <= now.getTime() && event.end.getTime() > now.getTime();
}

export function isPast(event: CalendarEvent, now = new Date()): boolean {
  return event.end.getTime() < now.getTime();
}
