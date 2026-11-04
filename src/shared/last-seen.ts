import type { HomeAssistant } from "../types";

// When did a device last talk to Home Assistant? (#25)
//
// HA keeps three timestamps on a state, and only one of them answers that:
//
//   last_changed   the state changed
//   last_updated   the state or an attribute changed
//   last_reported  the integration wrote the state, changed or not
//
// A dry leak sensor changes nothing for days, so its `last_updated` says
// "unchanged", not "silent" — calling that "not reporting" was a false alarm.
// Only `last_reported` can prove silence, and it is not on every state object
// the frontend hands a card, so:
//
//   - `at` is the newest activity we can see: the entity's own timestamps and
//     those of the other entities on the same device (a Zigbee sensor's link
//     quality moves with almost every message) plus any extra entity the
//     caller names, such as a configured battery sensor.
//   - `reported` says whether a `last_reported` was among them. Only then is a
//     long gap evidence that the device has gone quiet; without one, the card
//     must not claim it.

export interface LastSeen {
  /** Newest activity, ms since the epoch. */
  at: number;
  /** True if a `last_reported` timestamp was available. */
  reported: boolean;
}

type StateWithReport = { last_updated?: string; last_reported?: string; state?: string };

// Domains whose state moves without the device saying anything: an update
// entity follows a firmware feed, a button's state is when someone pressed it.
const NOT_DEVICE_SIGNALS = new Set(["update", "button"]);

const siblingCache = new WeakMap<object, Map<string, string[]>>();

/** The other entity ids on the same device, from `hass.entities`. */
export function deviceSiblings(hass: HomeAssistant, entityId: string): string[] {
  const registry = hass.entities as Record<string, { device_id?: string | null }> | undefined;
  if (!registry) return [];
  const deviceId = registry[entityId]?.device_id;
  if (!deviceId) return [];

  // One pass over the registry per registry object, not one per sensor per tick.
  let byDevice = siblingCache.get(registry);
  if (!byDevice) {
    byDevice = new Map();
    for (const [id, entry] of Object.entries(registry)) {
      const dev = entry?.device_id;
      if (!dev) continue;
      const list = byDevice.get(dev);
      if (list) list.push(id);
      else byDevice.set(dev, [id]);
    }
    siblingCache.set(registry, byDevice);
  }
  return (byDevice.get(deviceId) ?? []).filter(
    (id) => id !== entityId && !NOT_DEVICE_SIGNALS.has(id.split(".")[0]),
  );
}

export function lastSeen(
  hass: HomeAssistant,
  entityId: string,
  extra: (string | undefined)[] = [],
): LastSeen | undefined {
  const ids = [entityId, ...deviceSiblings(hass, entityId), ...extra.filter((x): x is string => !!x)];
  let at = 0;
  let reported = false;
  for (const id of new Set(ids)) {
    const st = hass.states[id] as StateWithReport | undefined;
    if (!st) continue;
    // An entity that is itself unavailable says nothing about the device.
    if (id !== entityId && (st.state === "unavailable" || st.state === "unknown")) continue;
    for (const iso of [st.last_updated, st.last_reported]) {
      const t = iso ? Date.parse(iso) : NaN;
      if (!isNaN(t) && t > at) at = t;
    }
    if (st.last_reported) reported = true;
  }
  return at ? { at, reported } : undefined;
}
