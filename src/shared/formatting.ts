// Shared locale-aware number formatting, used by every card that displays a
// numeric value (power, energy, percentages, totals). Centralizes the
// `new Intl.NumberFormat(language, options)` call that was previously
// reimplemented ad-hoc per card.
// Constructing an Intl formatter is markedly more expensive than formatting
// with one, and list cards build a formatter per value per render. Keyed by
// language plus the options object, so the handful of shapes this suite uses
// are each built once for the life of the page.
const numberFormatters = new Map<string, Intl.NumberFormat>();

// Returns a cached formatter, or undefined for a locale/options combination
// Intl rejects. Exposed so callers that need formatToParts (currency symbol
// splitting) share the same cache instead of building their own.
export function getNumberFormat(
  language: string,
  options?: Intl.NumberFormatOptions,
): Intl.NumberFormat | undefined {
  const key = language + "|" + (options ? JSON.stringify(options) : "");
  const cached = numberFormatters.get(key);
  if (cached) return cached;
  try {
    const fmt = new Intl.NumberFormat(language, options);
    numberFormatters.set(key, fmt);
    return fmt;
  } catch {
    // An unusable locale tag from hass.locale would otherwise throw mid
    // render. Two of the nine per-card copies guarded this, seven did not;
    // consolidating keeps the safer behaviour for all of them.
    return undefined;
  }
}

export function formatNumber(
  language: string,
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  const fmt = getNumberFormat(language, options);
  return fmt ? fmt.format(value) : value.toFixed(options?.maximumFractionDigits ?? 0);
}

// Locale's decimal separator (e.g. "," for de, "." for en) — used by the
// counter-card's digit-roll to pick the correct separator glyph.
const separators = new Map<string, string>();

export function decimalSeparator(language: string): string {
  const cached = separators.get(language);
  if (cached !== undefined) return cached;
  const parts = getNumberFormat(language)?.formatToParts(1.1) ?? [];
  const sep = parts.find((p) => p.type === "decimal")?.value ?? ".";
  separators.set(language, sep);
  return sep;
}

// Coarse "how long ago" used by the occupancy card's status line: minutes up
// to an hour, then hours up to a day, then days. Deliberately one unit and no
// decimals — "seit 2 Std." is what a glance needs, "seit 2 Std. 14 Min." is
// not. The caller supplies the localized unit strings.
export function formatSince(
  fromIso: string | undefined,
  units: { minutes: string; hours: string; days: string },
  now = Date.now(),
): string | undefined {
  if (!fromIso) return undefined;
  const then = Date.parse(fromIso);
  if (isNaN(then)) return undefined;
  const minutes = Math.max(0, Math.floor((now - then) / 60000));
  if (minutes < 60) return units.minutes.replace("{n}", String(minutes));
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return units.hours.replace("{n}", String(hours));
  return units.days.replace("{n}", String(Math.floor(hours / 24)));
}

/**
 * A timestamp as short as it can be without being ambiguous.
 *
 * Home Assistant's own `formatEntityState` gives a timestamp sensor its full
 * date — "13. September 2026 um 17:55" — which is correct and useless inside a
 * chip that says when a print finishes, twenty minutes from now. So the date is
 * dropped when it is today's, kept in short form when it is not, and a job
 * running past midnight still says which day it lands on.
 */
export function formatClock(
  iso: string | undefined,
  language: string,
  now = Date.now(),
): string | undefined {
  if (!iso) return undefined;
  const when = Date.parse(iso);
  if (isNaN(when)) return undefined;
  const date = new Date(when);
  const today = new Date(now);
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  const time = new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit" }).format(
    date,
  );
  if (sameDay) return time;
  const day = new Intl.DateTimeFormat(language, { day: "numeric", month: "short" }).format(date);
  return `${day}, ${time}`;
}

/**
 * A duration sensor as a person would say it.
 *
 * Printers report "time remaining" in whatever unit the firmware thinks in —
 * Bambu in hours, OctoPrint and Moonraker in seconds — so the raw state is as
 * likely to be `0.0166666666666667` as `60`. Home Assistant's own formatter
 * turns the first into "0h, 1 Min.", which is correct and reads like a
 * stopwatch; this drops the empty leading unit.
 *
 * Returns undefined for anything that is not a number, so a caller can fall
 * back to whatever the integration already formatted itself.
 */
export function formatDuration(
  raw: string | number | undefined,
  unit: string | undefined,
  strings: { hm: string; m: string },
): string | undefined {
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return undefined;

  const perUnit: Record<string, number> = { d: 1440, h: 60, hr: 60, min: 1, m: 1, s: 1 / 60, sec: 1 / 60 };
  const factor = perUnit[(unit ?? "min").toLowerCase().trim()];
  if (factor === undefined) return undefined;

  const total = Math.round(value * factor);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours > 0) {
    return strings.hm.replace("{h}", String(hours)).replace("{m}", String(minutes));
  }
  return strings.m.replace("{m}", String(minutes));
}

/**
 * A length of time in at most two units, the larger first: "12 Min.",
 * "3 Std. 5 Min.", "2 Tg. 4 Std." — what a timeline's "how long was it open"
 * needs. The units are Intl's own short forms, so every language Home
 * Assistant ships gets its words without a translation table here.
 */
export function formatSpan(ms: number, language: string): string {
  return formatSpanParts(ms, language).join(" ");
}

/** The same, one string per unit, so a layout can break between them and never inside one. */
export function formatSpanParts(ms: number, language: string): string[] {
  const unit = (n: number, u: "minute" | "hour" | "day") => {
    const fmt = getNumberFormat(language, { style: "unit", unit: u, unitDisplay: "short" });
    return fmt ? fmt.format(n) : `${n} ${u[0]}`;
  };
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return [unit(minutes, "minute")];
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? [unit(hours, "hour"), unit(minutes % 60, "minute")] : [unit(hours, "hour")];
  const days = Math.floor(hours / 24);
  return hours % 24 ? [unit(days, "day"), unit(hours % 24, "hour")] : [unit(days, "day")];
}

/**
 * A date as day and month in numbers ("9/11", "11/9", "9.11."), in the order
 * the profile asks for.
 *
 * Home Assistant keeps the order of a date's numbers as its own profile
 * setting, apart from the language: English with day-first dates is a common
 * choice outside the US. Formatting by language alone gave such a user
 * "11/9" for the 9th of November. "language" (or no setting) keeps the
 * language's own form; "system" asks the browser; DMY / MDY / YMD reorder the
 * language's numbers, keeping its separator ("/" in English, "." in German).
 */
export function formatDayMonth(date: Date, language: string, dateFormat?: string): string {
  const fmt = new Intl.DateTimeFormat(dateFormat === "system" ? undefined : language, {
    day: "numeric",
    month: "numeric",
  });
  if (dateFormat !== "DMY" && dateFormat !== "MDY" && dateFormat !== "YMD") return fmt.format(date);
  const parts = fmt.formatToParts(date);
  const day = parts.find((p) => p.type === "day")?.value ?? String(date.getDate());
  const month = parts.find((p) => p.type === "month")?.value ?? String(date.getMonth() + 1);
  const inner = parts.find((p, i) => p.type === "literal" && i > 0 && i < parts.length - 1);
  const sep = inner?.value ?? "/";
  const last = parts[parts.length - 1];
  const trailing = last?.type === "literal" ? last.value : "";
  return dateFormat === "DMY" ? `${day}${sep}${month}${trailing}` : `${month}${sep}${day}${trailing}`;
}
