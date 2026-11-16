// The tariff card's model (#56): which tariff is active, until when, what it
// saves against the dearest one, and the colour tones. Pure functions, so
// the schedule maths can be tested across midnight without a clock.

export interface TariffLike {
  name: string;
  short?: string;
}

export interface ScheduleEntry {
  /** The tariff's name or short name. */
  tariff: string;
  /** "HH:MM". `to` before `from` runs past midnight. */
  from: string;
  to: string;
  /** Optional weekdays, 0 = Sunday … 6 = Saturday. Default every day. */
  days?: number[];
}

const norm = (s: string | undefined) => (s ?? "").trim().toLowerCase();

/** The tariff a state names: by name, short name, or a 1-based index. */
export function tariffFromState(state: string | undefined, tariffs: TariffLike[]): number {
  const s = norm(state);
  if (!s || s === "unknown" || s === "unavailable") return -1;
  let i = tariffs.findIndex((t) => norm(t.name) === s || (t.short && norm(t.short) === s));
  if (i >= 0) return i;
  // A utility_meter select often says "peak" / "offpeak" while the card's
  // names are "Peak hours" — accept a name that contains the state.
  i = tariffs.findIndex((t) => norm(t.name).includes(s) || s.includes(norm(t.name)));
  if (i >= 0) return i;
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= tariffs.length ? n - 1 : -1;
}

const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
};

/**
 * The schedule entry in force at `now`, and the moment it ends. A window
 * that crosses midnight belongs to the day it started on.
 */
export function activeFromSchedule(
  schedule: ScheduleEntry[],
  tariffs: TariffLike[],
  now: Date,
): { index: number; until?: Date } {
  const minute = now.getHours() * 60 + now.getMinutes();
  const day = now.getDay();
  for (const e of schedule) {
    const from = minutesOf(e.from);
    const to = minutesOf(e.to);
    const wraps = to <= from;
    const startedToday = minute >= from && (wraps || minute < to);
    const startedYesterday = wraps && minute < to;
    const startDay = startedToday ? day : (day + 6) % 7;
    if (!(startedToday || startedYesterday)) continue;
    if (e.days?.length && !e.days.includes(startDay)) continue;
    const index = tariffFromState(e.tariff, tariffs);
    if (index < 0) continue;
    const until = new Date(now);
    until.setHours(Math.floor(to / 60), to % 60, 0, 0);
    if (until <= now) until.setDate(until.getDate() + 1);
    return { index, until };
  }
  return { index: -1 };
}

/** "−27 %": what the active price saves against the dearest. Undefined when nothing is saved. */
export function savingsPercent(active: number | undefined, prices: (number | undefined)[]): number | undefined {
  const known = prices.filter((p): p is number => typeof p === "number" && Number.isFinite(p));
  if (active === undefined || !known.length) return undefined;
  const max = Math.max(...known);
  if (!(max > 0) || active >= max) return undefined;
  return Math.round(((max - active) / max) * 100);
}

/**
 * Tones of one colour, one per tariff: the dearer, the lighter — it is the
 * same electricity, so the tariffs share a hue. Ordered by the tariffs'
 * prices; tariffs without a price keep their place in the list.
 */
export function tariffTones(base: string, prices: (number | undefined)[]): string[] {
  const n = prices.length;
  const order = prices
    .map((p, i) => ({ p: p ?? -Infinity, i }))
    .sort((a, b) => (b.p === a.p ? a.i - b.i : b.p - a.p));
  const tones: string[] = new Array(n);
  order.forEach(({ i }, rank) => {
    const t = n === 1 ? 0.5 : rank / (n - 1); // 0 = dearest, 1 = cheapest
    // Dearest: base lightened toward white; cheapest: base darkened.
    const tone =
      t <= 0.5
        ? `color-mix(in srgb, ${base} ${Math.round(45 + t * 2 * 55)}%, white)`
        : `color-mix(in srgb, ${base} ${Math.round(100 - (t - 0.5) * 2 * 30)}%, black)`;
    tones[i] = tone;
  });
  return tones;
}

/** Shares of a total, in percent, rounded so they add up to 100. */
export function sharesOf(values: number[]): number[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return values.map(() => 0);
  const raw = values.map((v) => (v / total) * 100);
  const floored = raw.map(Math.floor);
  let rest = 100 - floored.reduce((a, b) => a + b, 0);
  const byFraction = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f);
  for (const { i } of byFraction) {
    if (rest <= 0) break;
    floored[i]++;
    rest--;
  }
  return floored;
}
