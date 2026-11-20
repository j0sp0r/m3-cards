// The devices the network card has met, per user (frontend user data, the
// browser's storage as a fallback): when each was first and last seen,
// whether it is known, and the name and icon given to it. "New" is a device
// seen but not yet known. On the very first run everything already there
// becomes known, so the card does not open with the whole network as new.

export const NETWORK_KNOWN_KEY = "m3_network_known";

export interface KnownEntry {
  /** First seen, ms. */
  first: number;
  /** Last seen online, ms. */
  last?: number;
  known: boolean;
  name?: string;
  icon?: string;
  ignored?: boolean;
  /** A notification about it went out. */
  notified?: boolean;
  /** Where it was last seen, for the offline list. */
  ip?: string;
  host?: string;
}

export type KnownMap = Record<string, KnownEntry>;

export function parseKnown(raw: unknown): KnownMap {
  const out: KnownMap = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const e = v as Record<string, unknown>;
    if (typeof e.first !== "number") continue;
    out[k] = {
      first: e.first,
      last: typeof e.last === "number" ? e.last : undefined,
      known: e.known === true,
      name: typeof e.name === "string" && e.name ? e.name : undefined,
      icon: typeof e.icon === "string" && e.icon ? e.icon : undefined,
      ignored: e.ignored === true || undefined,
      notified: e.notified === true || undefined,
      ip: typeof e.ip === "string" && e.ip ? e.ip : undefined,
      host: typeof e.host === "string" && e.host ? e.host : undefined,
    };
  }
  return out;
}

export interface SeenDevice {
  key: string;
  ip?: string;
  host?: string;
}

/** How long a "last seen" may lag before it is written again. */
export const LAST_SEEN_WRITE_MS = 10 * 60_000;

/**
 * Brings the map up to the devices online now. Returns the same object when
 * nothing worth saving changed, so the caller can skip the write.
 *
 * - An empty map takes everyone online as known (the first run).
 * - A device not in the map is added, not known: it is new.
 * - "Last seen" moves on for devices online, but only every
 *   `LAST_SEEN_WRITE_MS`, so the user data is not rewritten each minute.
 */
export function updateKnown(map: KnownMap, online: (string | SeenDevice)[], now: number): KnownMap {
  const firstRun = Object.keys(map).length === 0;
  let next: KnownMap | undefined;
  const edit = () => (next ??= { ...map });
  for (const item of online) {
    const d = typeof item === "string" ? { key: item } : item;
    const had = (next ?? map)[d.key];
    if (!had) {
      edit()[d.key] = { first: now, last: now, known: firstRun, ip: d.ip, host: d.host };
    } else if (
      had.last === undefined ||
      now - had.last >= LAST_SEEN_WRITE_MS ||
      (d.ip !== undefined && d.ip !== had.ip) ||
      (d.host !== undefined && d.host !== had.host)
    ) {
      edit()[d.key] = { ...had, last: now, ip: d.ip ?? had.ip, host: d.host ?? had.host };
    }
  }
  return next ?? map;
}

export function isNew(entry: KnownEntry | undefined): boolean {
  return !!entry && !entry.known && !entry.ignored;
}

/** A copy with one entry changed — `undefined` removes it. */
export function withEntry(map: KnownMap, key: string, entry: KnownEntry | undefined): KnownMap {
  const next = { ...map };
  if (entry) next[key] = entry;
  else delete next[key];
  return next;
}
