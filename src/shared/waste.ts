/**
 * Days from today until a waste sensor's next collection.
 *
 * Integrations disagree on what the state is. Most count days ("3"), but
 * others — the Belgian Recycle! app among them — hand over the date itself
 * ("2026-11-26", or a full timestamp). `parseFloat` reads the year of such a
 * date as a day count, which is how "in 2026 days" happened. A date is
 * therefore recognised first, by its shape, and counted in calendar days in
 * the browser's time zone; anything else falls back to the number.
 */
export function wasteDaysFromState(state: string | undefined, now: Date = new Date()): number | undefined {
  if (!state) return undefined;
  const s = state.trim();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ymd = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(s);
  if (ymd) {
    // A timestamp carries its own zone: the local calendar day it falls on.
    // A bare date is already a calendar day.
    const at =
      s.length > 10 && !isNaN(Date.parse(s))
        ? new Date(Date.parse(s))
        : new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
    const day = new Date(at.getFullYear(), at.getMonth(), at.getDate());
    return Math.round((day.getTime() - today.getTime()) / 86400_000);
  }
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

/**
 * The entity's own name without its device's: since HA's entity naming, a
 * friendly name is "<device> <entity>", and for a collection schedule the
 * device is often the street address.
 */
export function withoutDeviceName(name: string, deviceName: string | undefined | null): string {
  if (!deviceName) return name;
  const d = deviceName.trim();
  if (!d || name.length <= d.length || !name.toLowerCase().startsWith(d.toLowerCase())) return name;
  const rest = name.slice(d.length).replace(/^[\s\-–:·,]+/, "");
  return rest || name;
}
