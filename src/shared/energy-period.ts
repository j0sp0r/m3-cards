// The period the energy usage card shows (#56): day, week, month or year,
// how to step through them, how to name them, and one shared period per
// key so several cards on a page move together.
//
// Home Assistant's own energy cards share their period through an energy
// collection that lives on `hass.connection` (`_energy`, or `_energy_<key>`).
// That object is not a public API. Where it exists — a native energy card on
// the same view created it — the card follows it and moves it along; where it
// does not, the card keeps its own shared period. Nothing depends on it.

export type EnergyPeriodKind = "day" | "week" | "month" | "year";

export interface EnergyPeriod {
  kind: EnergyPeriodKind;
  start: Date;
  /** Exclusive. */
  end: Date;
}

export function periodFor(kind: EnergyPeriodKind, anchor: Date): EnergyPeriod {
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  if (kind === "week") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (kind === "month") start.setDate(1);
  if (kind === "year") start.setMonth(0, 1);
  const end = new Date(start);
  if (kind === "day") end.setDate(end.getDate() + 1);
  if (kind === "week") end.setDate(end.getDate() + 7);
  if (kind === "month") end.setMonth(end.getMonth() + 1);
  if (kind === "year") end.setFullYear(end.getFullYear() + 1);
  return { kind, start, end };
}

export function shiftPeriod(p: EnergyPeriod, dir: -1 | 1): EnergyPeriod {
  const anchor = new Date(p.start);
  if (p.kind === "day") anchor.setDate(anchor.getDate() + dir);
  if (p.kind === "week") anchor.setDate(anchor.getDate() + 7 * dir);
  if (p.kind === "month") anchor.setMonth(anchor.getMonth() + dir);
  if (p.kind === "year") anchor.setFullYear(anchor.getFullYear() + dir);
  return periodFor(p.kind, anchor);
}

/** A period that has not begun yet has nothing to show. */
export function isFuture(p: EnergyPeriod, now: Date): boolean {
  return p.start.getTime() > now.getTime();
}

/** The resolution the statistics are read at, for the bars. */
export function bucketOf(kind: EnergyPeriodKind): "hour" | "day" | "month" {
  return kind === "day" ? "hour" : kind === "year" ? "month" : "day";
}

/** The bucket starts that make up a period. */
export function bucketsOf(p: EnergyPeriod): Date[] {
  const out: Date[] = [];
  const unit = bucketOf(p.kind);
  for (let d = new Date(p.start); d < p.end; ) {
    out.push(new Date(d));
    if (unit === "hour") d.setHours(d.getHours() + 1);
    else if (unit === "day") d.setDate(d.getDate() + 1);
    else d.setMonth(d.getMonth() + 1);
  }
  return out;
}

/**
 * "Today, 16 Nov", "10 – 16 Nov", "November 2026", "2026" — in the given
 * language. Today and yesterday get their word, as the native card does.
 */
export function periodLabel(p: EnergyPeriod, language: string, now: Date, words: { today: string; yesterday: string }): string {
  const dayMonth = new Intl.DateTimeFormat(language, { day: "numeric", month: "short" });
  if (p.kind === "day") {
    const today = periodFor("day", now).start.getTime();
    const prefix = p.start.getTime() === today ? `${words.today}, ` : p.start.getTime() === today - 86_400_000 ? `${words.yesterday}, ` : "";
    return prefix + (prefix ? dayMonth : new Intl.DateTimeFormat(language, { weekday: "short", day: "numeric", month: "short" })).format(p.start);
  }
  if (p.kind === "week") {
    const last = new Date(p.end.getTime() - 86_400_000);
    const sameMonth = last.getMonth() === p.start.getMonth();
    const first = sameMonth ? new Intl.DateTimeFormat(language, { day: "numeric" }).format(p.start) : dayMonth.format(p.start);
    // German puts the period after the day ("10."), so an en dash between
    // two such parts reads "10. – 16. Nov."; English "10 – 16 Nov".
    const firstText = sameMonth && /^de/.test(language) ? `${first}.` : first;
    return `${firstText} – ${dayMonth.format(last)}`;
  }
  if (p.kind === "month") return new Intl.DateTimeFormat(language, { month: "long", year: "numeric" }).format(p.start);
  return String(p.start.getFullYear());
}

/** The x-axis text for a bucket, or "" to leave that one unlabelled. */
export function bucketLabel(p: EnergyPeriod, d: Date, index: number, language: string): string {
  if (p.kind === "day") return index % 6 === 0 ? `${String(d.getHours()).padStart(2, "0")}` : "";
  if (p.kind === "week") return new Intl.DateTimeFormat(language, { weekday: "short" }).format(d);
  if (p.kind === "month") {
    // Every seventh day, and the last one unless a label sits right before it.
    const last = bucketsOf(p).length - 1;
    return index % 7 === 0 || (index === last && last % 7 >= 3) ? String(d.getDate()) : "";
  }
  return new Intl.DateTimeFormat(language, { month: "narrow" }).format(d);
}

// ---- shared period ---------------------------------------------------------

type Listener = (p: EnergyPeriod) => void;
const shared = new Map<string, { period: EnergyPeriod; listeners: Set<Listener> }>();

function slot(key: string, fallback: () => EnergyPeriod) {
  let s = shared.get(key);
  if (!s) {
    s = { period: fallback(), listeners: new Set() };
    shared.set(key, s);
  }
  return s;
}

export function getSharedPeriod(key: string, fallback: () => EnergyPeriod): EnergyPeriod {
  return slot(key, fallback).period;
}

export function setSharedPeriod(key: string, p: EnergyPeriod): void {
  const s = slot(key, () => p);
  s.period = p;
  for (const l of s.listeners) l(p);
}

export function subscribeSharedPeriod(key: string, fallback: () => EnergyPeriod, listener: Listener): () => void {
  const s = slot(key, fallback);
  s.listeners.add(listener);
  return () => s.listeners.delete(listener);
}

/** The shape of Home Assistant's energy collection this module touches. */
interface HaEnergyCollection {
  start?: Date;
  end?: Date;
  setPeriod?: (start: Date, end?: Date) => void;
  refresh?: () => void;
  subscribe?: (cb: (data: unknown) => void) => () => void;
}

/** Home Assistant's energy collection for `key`, if a native card created one. */
export function haEnergyCollection(connection: unknown, key?: string): HaEnergyCollection | undefined {
  if (!connection || typeof connection !== "object") return undefined;
  const c = (connection as Record<string, unknown>)[key ? `_energy_${key}` : "_energy"];
  return c && typeof c === "object" ? (c as HaEnergyCollection) : undefined;
}

/** Infers the kind of a native period from its length. */
export function kindFromRange(start: Date, end: Date | undefined): EnergyPeriodKind {
  if (!end) return "day";
  const days = (end.getTime() - start.getTime()) / 86_400_000;
  if (days <= 1.05) return "day";
  if (days <= 7.05) return "week";
  if (days <= 31.5) return "month";
  return "year";
}
