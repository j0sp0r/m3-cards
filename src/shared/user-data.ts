import type { HomeAssistant } from "../types";

// Per-user data that should follow the user from phone to tablet: Home
// Assistant's frontend user data (`frontend/get_user_data` /
// `frontend/set_user_data`), which every user may read and write for
// themselves — no admin rights needed. localStorage stands in when the
// connection refuses, so a mute still holds on this one device.

const LOCAL_PREFIX = "m3-cards:";

function readLocal<T>(key: string): T | undefined {
  try {
    const raw = window.localStorage.getItem(LOCAL_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function writeLocal(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(LOCAL_PREFIX + key, JSON.stringify(value));
  } catch {
    // Private mode or a full quota: the value lives for this page only.
  }
}

export async function loadUserData<T>(hass: HomeAssistant | undefined, key: string): Promise<T | undefined> {
  if (hass?.callWS) {
    try {
      const res = await hass.callWS<{ value?: T | null }>({ type: "frontend/get_user_data", key });
      if (res && res.value != null) return res.value;
      // Nothing stored on the server yet: an older local copy, if any, is
      // still better than starting empty.
      return readLocal<T>(key);
    } catch {
      return readLocal<T>(key);
    }
  }
  return readLocal<T>(key);
}

export async function saveUserData(hass: HomeAssistant | undefined, key: string, value: unknown): Promise<void> {
  writeLocal(key, value);
  if (!hass?.callWS) return;
  try {
    await hass.callWS({ type: "frontend/set_user_data", key, value });
  } catch {
    // Kept locally above.
  }
}

/**
 * A muted device: until when (null: no end time), since when, and whether it
 * outlives the outage. A plain mute covers one outage; a permanent one stays
 * for every later outage too — a TV that is off whenever its plug is off.
 */
/** Where the availability card keeps its mutes in the user data. */
export const AVAILABILITY_MUTES_KEY = "m3_availability_mutes";

export interface MuteEntry {
  until: number | null;
  at: number;
  permanent?: boolean;
}

export type MuteMap = Record<string, MuteEntry>;

/**
 * Drops expired mutes and, when the offline set is known, mutes of devices
 * that are reachable again — a mute covers one outage, not the next one.
 * Permanent mutes stay until they are lifted by hand.
 * Returns the same object when nothing changed, so callers can skip a save.
 */
export function pruneMutes(mutes: MuteMap, now: number, offlineKeys?: Set<string>): MuteMap {
  let changed = false;
  const out: MuteMap = {};
  for (const [key, entry] of Object.entries(mutes)) {
    const expired = entry.until !== null && entry.until <= now;
    const recovered = !entry.permanent && offlineKeys !== undefined && !offlineKeys.has(key);
    if (expired || recovered) {
      changed = true;
      continue;
    }
    out[key] = entry;
  }
  return changed ? out : mutes;
}

export function isMuted(mutes: MuteMap, key: string, now: number): boolean {
  const entry = mutes[key];
  return !!entry && (entry.until === null || entry.until > now);
}

/** Mute durations offered in the menu, in ms; `forever` is null. */
export const MUTE_DURATIONS = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 604_800_000,
  forever: null,
  permanent: null,
} as const;

export type MuteDuration = keyof typeof MUTE_DURATIONS;

/** Validates whatever came back from storage into a MuteMap. */
export function parseMutes(raw: unknown): MuteMap {
  if (!raw || typeof raw !== "object") return {};
  const out: MuteMap = {};
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const e = v as { until?: unknown; at?: unknown; permanent?: unknown };
    const until = e.until === null ? null : typeof e.until === "number" ? e.until : undefined;
    const at = typeof e.at === "number" ? e.at : 0;
    if (until === undefined) continue;
    out[key] = e.permanent === true ? { until: null, at, permanent: true } : { until, at };
  }
  return out;
}
