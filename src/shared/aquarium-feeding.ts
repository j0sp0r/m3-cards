// "Have the fish been fed today?" — read from a helper that holds the last
// feeding as a date and time (an input_datetime set by a button, a tile or a
// notification; an input_button's state works the same). Plain data in,
// data out, so the card and its tests share one answer.

export interface FeedingStatus {
  /** When the last feeding was logged, if the helper holds a readable time. */
  at?: Date;
  /** Logged on today's calendar date, local time — not "within 24 hours". */
  fedToday: boolean;
  /** Not fed today, and the day has passed the time it should have happened by. */
  overdue: boolean;
}

/** "19:00" or "19:00:00" as minutes after midnight; undefined when unreadable. */
export function minutesOfDay(time: string | undefined): number | undefined {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : undefined;
}

/**
 * An input_datetime with date and time reads "2026-11-02 08:12:00", which
 * Date parses as local time; an input_button holds an ISO timestamp. Both
 * come out as the same instant.
 */
export function parseFeedingState(state: string | undefined): Date | undefined {
  if (!state || state === "unknown" || state === "unavailable") return undefined;
  const d = new Date(state.includes("T") ? state : state.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function feedingStatus(state: string | undefined, now: Date, dueTime: string | undefined): FeedingStatus {
  const at = parseFeedingState(state);
  const fedToday = !!at && sameDay(at, now);
  const due = minutesOfDay(dueTime);
  const overdue = !fedToday && due !== undefined && now.getHours() * 60 + now.getMinutes() >= due;
  return { at, fedToday, overdue };
}
