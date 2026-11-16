// The availability card's model: which devices are watched, which of them are
// offline or have gone quiet, and how they group. Pure functions over the
// registry snapshots Home Assistant already keeps on `hass`, so the card works
// for any user and the logic is testable without a DOM.

/** A filter over the watched set. Entity patterns accept `*` and `?`. */
export interface AvailabilityFilter {
  devices?: string[];
  integrations?: string[];
  areas?: string[];
  entities?: string[];
}

/** The fields of `hass.entities` this module reads. */
export interface RegEntity {
  entity_id: string;
  device_id?: string | null;
  area_id?: string | null;
  platform?: string | null;
  hidden?: boolean;
  hidden_by?: string | null;
  entity_category?: string | null;
}

/** The fields of `hass.devices` this module reads. */
export interface RegDevice {
  id: string;
  name?: string | null;
  name_by_user?: string | null;
  area_id?: string | null;
  entry_type?: string | null;
}

export interface RegArea {
  area_id: string;
  name: string;
}

/** The fields of a state object this module reads. */
export interface StateLike {
  state: string;
  last_changed?: string;
  last_updated?: string;
  last_reported?: string;
  attributes?: Record<string, unknown>;
}

/** One watched thing: a device, or an entity without one. */
export interface WatchedUnit {
  /** The device id, or `entity:<entity_id>` for an entity without a device. */
  key: string;
  deviceId?: string;
  name: string;
  areaId?: string;
  areaName?: string;
  /** The platform most of its entities come from. */
  integration?: string;
  /** The entities that decide whether it is reachable. */
  entities: string[];
  /** The entity whose icon and detail stand for the device. */
  primary: string;
}

export type UnitKind = "offline" | "stale";

export interface FlaggedUnit {
  unit: WatchedUnit;
  kind: UnitKind;
  /** When it went offline or last reported, in ms. */
  since: number;
}

/**
 * Domains that do not decide reachability. Several integrations keep their
 * buttons, update entities and event entities available while the device
 * itself is gone, and a dead device would otherwise count as alive because
 * of a button. Helpers and housekeeping never belong to a device anyway.
 */
export const IGNORED_DOMAINS = new Set([
  "button",
  "event",
  "update",
  "scene",
  "image",
  "notify",
  "tts",
  "stt",
  "conversation",
  "automation",
  "script",
  "zone",
  "person",
  "sun",
  "input_boolean",
  "input_number",
  "input_select",
  "input_text",
  "input_datetime",
  "input_button",
  "counter",
  "timer",
  "schedule",
  "tag",
]);

/**
 * Platforms of helpers a user can attach to any device. They live in Home
 * Assistant itself and keep a state when the device is gone — a daily
 * utility_meter on a dead plug reads "0", not unavailable — so they must never
 * make a device count as reachable.
 */
export const HELPER_PLATFORMS = new Set([
  "utility_meter",
  "template",
  "derivative",
  "integration",
  "statistics",
  "min_max",
  "group",
  "threshold",
  "filter",
  "trend",
  "switch_as_x",
  "history_stats",
  "counter",
  "compensation",
]);

/** Which entity stands for a device, most telling domain first. */
const PRIMARY_ORDER = [
  "camera",
  "climate",
  "light",
  "cover",
  "lock",
  "media_player",
  "fan",
  "vacuum",
  "switch",
  "binary_sensor",
  "sensor",
];

export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

function matcher(patterns: string[] | undefined): ((id: string) => boolean) | undefined {
  if (!patterns?.length) return undefined;
  const plain = new Set(patterns.filter((p) => !/[*?]/.test(p)));
  const globs = patterns.filter((p) => /[*?]/.test(p)).map(globToRegExp);
  return (id) => plain.has(id) || globs.some((re) => re.test(id));
}

const hasAny = (f: AvailabilityFilter | undefined): boolean =>
  !!f && !!(f.devices?.length || f.integrations?.length || f.areas?.length || f.entities?.length);

export interface IndexOptions {
  include?: AvailabilityFilter;
  exclude?: AvailabilityFilter;
  ignoreDiagnostic?: boolean;
  includeOrphans?: boolean;
  /** The display name of an entity without a device. */
  entityName?: (entityId: string) => string;
}

function mostCommon(values: (string | undefined | null)[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | undefined;
  let n = 0;
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c];
  return best;
}

function pickPrimary(entityIds: string[]): string {
  for (const domain of PRIMARY_ORDER) {
    const hit = entityIds.find((id) => id.startsWith(`${domain}.`));
    if (hit) return hit;
  }
  return entityIds[0];
}

/**
 * The watched units, from the registries. Rebuilt only when a registry
 * changes; the card evaluates states against it on every tick.
 */
export function buildWatchIndex(
  entities: Record<string, RegEntity> | undefined,
  devices: Record<string, RegDevice> | undefined,
  areas: Record<string, RegArea> | undefined,
  opts: IndexOptions = {},
): WatchedUnit[] {
  const ignoreDiagnostic = opts.ignoreDiagnostic !== false;
  const excludeEntity = matcher(opts.exclude?.entities);
  const includeEntity = matcher(opts.include?.entities);
  const byDevice = new Map<string, RegEntity[]>();
  const orphans: RegEntity[] = [];

  for (const e of Object.values(entities ?? {})) {
    const domain = e.entity_id.split(".")[0];
    if (IGNORED_DOMAINS.has(domain)) continue;
    if (e.hidden || e.hidden_by) continue;
    if (ignoreDiagnostic && (e.entity_category === "diagnostic" || e.entity_category === "config")) continue;
    if (excludeEntity?.(e.entity_id)) continue;
    if (e.device_id) {
      const list = byDevice.get(e.device_id);
      if (list) list.push(e);
      else byDevice.set(e.device_id, [e]);
    } else if (opts.includeOrphans) {
      orphans.push(e);
    }
  }

  const exDevices = new Set(opts.exclude?.devices ?? []);
  const exIntegrations = new Set(opts.exclude?.integrations ?? []);
  const exAreas = new Set(opts.exclude?.areas ?? []);
  const inDevices = new Set(opts.include?.devices ?? []);
  const inIntegrations = new Set(opts.include?.integrations ?? []);
  const inAreas = new Set(opts.include?.areas ?? []);
  const restrict = hasAny(opts.include);

  const accept = (u: WatchedUnit): boolean => {
    if (u.deviceId && exDevices.has(u.deviceId)) return false;
    if (u.integration && exIntegrations.has(u.integration)) return false;
    if (u.areaId && exAreas.has(u.areaId)) return false;
    if (!restrict) return true;
    return (
      (!!u.deviceId && inDevices.has(u.deviceId)) ||
      (!!u.integration && inIntegrations.has(u.integration)) ||
      (!!u.areaId && inAreas.has(u.areaId)) ||
      (!!includeEntity && u.entities.some(includeEntity))
    );
  };

  const units: WatchedUnit[] = [];
  for (const [deviceId, all] of byDevice) {
    const device = devices?.[deviceId];
    if (!device || device.entry_type === "service") continue;
    // The device's own integration decides, not helpers attached to it or a
    // second integration that merely adds an entity.
    const own = all.filter((e) => !e.platform || !HELPER_PLATFORMS.has(e.platform));
    const integration = mostCommon(own.map((e) => e.platform));
    const list = integration ? own.filter((e) => e.platform === integration) : own;
    if (!list.length) continue;
    const ids = list.map((e) => e.entity_id);
    const primary = pickPrimary(ids);
    const areaId = device.area_id ?? list.find((e) => e.entity_id === primary)?.area_id ?? undefined;
    const unit: WatchedUnit = {
      key: deviceId,
      deviceId,
      name: device.name_by_user || device.name || primary,
      areaId: areaId ?? undefined,
      areaName: areaId ? areas?.[areaId]?.name : undefined,
      integration,
      entities: ids,
      primary,
    };
    if (accept(unit)) units.push(unit);
  }
  for (const e of orphans) {
    const unit: WatchedUnit = {
      key: `entity:${e.entity_id}`,
      name: opts.entityName?.(e.entity_id) ?? e.entity_id,
      areaId: e.area_id ?? undefined,
      areaName: e.area_id ? areas?.[e.area_id]?.name : undefined,
      integration: e.platform ?? undefined,
      entities: [e.entity_id],
      primary: e.entity_id,
    };
    if (accept(unit)) units.push(unit);
  }
  return units;
}

const ms = (iso: string | undefined): number => (iso ? Date.parse(iso) : NaN);

export interface EvaluateOptions {
  /** Silence longer than this flags a device as quiet; 0 or undefined: off. */
  staleMs?: number;
  /** The integrations silence is checked for. Empty: none. */
  staleIntegrations?: string[];
}

/**
 * Which watched units are offline (every deciding entity `unavailable`) or,
 * for the integrations named, quiet (nothing reported for longer than
 * `staleMs`). An entity without a state object does not count either way.
 */
export function evaluateUnits(
  units: WatchedUnit[],
  states: Record<string, StateLike | undefined>,
  now: number,
  opts: EvaluateOptions = {},
): FlaggedUnit[] {
  const staleFor = new Set(opts.staleIntegrations ?? []);
  const out: FlaggedUnit[] = [];
  for (const unit of units) {
    let present = 0;
    let unavailable = 0;
    let newestChange = 0;
    let newestReport = 0;
    for (const id of unit.entities) {
      const st = states[id];
      if (!st) continue;
      present++;
      if (st.state === "unavailable") {
        unavailable++;
        const at = ms(st.last_changed);
        if (at > newestChange) newestChange = at;
      } else {
        const at = ms(st.last_reported ?? st.last_updated);
        if (at > newestReport) newestReport = at;
      }
    }
    if (present === 0) continue;
    if (unavailable === present) {
      out.push({ unit, kind: "offline", since: newestChange || now });
      continue;
    }
    if (opts.staleMs && unit.integration && staleFor.has(unit.integration) && newestReport > 0) {
      if (now - newestReport > opts.staleMs) out.push({ unit, kind: "stale", since: newestReport });
    }
  }
  return out;
}

/** A cheap fingerprint of what the evaluation depends on, for shouldUpdate. */
export function unavailableSignature(
  units: WatchedUnit[],
  states: Record<string, StateLike | undefined>,
): string {
  const parts: string[] = [];
  for (const unit of units) {
    for (const id of unit.entities) {
      const st = states[id];
      if (st?.state === "unavailable") parts.push(id);
      else if (!st) parts.push(`!${id}`);
    }
  }
  return parts.join(",");
}

export interface Grouped {
  recent: FlaggedUnit[];
  longer: FlaggedUnit[];
}

/** Split at `recentMs`, newest first in each group. */
export function groupFlagged(flagged: FlaggedUnit[], now: number, recentMs: number): Grouped {
  const sorted = [...flagged].sort((a, b) => b.since - a.since);
  return {
    recent: sorted.filter((f) => now - f.since < recentMs),
    longer: sorted.filter((f) => now - f.since >= recentMs),
  };
}

export type Severity = "warn" | "critical";

export function severityOf(f: FlaggedUnit, now: number, criticalMs: number): Severity {
  return f.kind === "offline" && now - f.since >= criticalMs ? "critical" : "warn";
}

/** One row of a minimal history response. */
export interface HistoryRowLite {
  s?: string | null;
  lc?: number;
  lu?: number;
}

const MISSING = new Set(["unavailable", "unknown", ""]);

/**
 * When an entity really went offline, read from its history.
 *
 * A restart writes `unavailable` again and resets last_changed, so a device
 * dead for a week would read "for 3 min." after every restart. Walking back
 * from the newest row, missing states belong to the current outage; the
 * outage starts at the first missing row after the last real state. A window
 * with no real state at all: it was offline before the window began.
 */
export function offlineStartFromHistory(
  rows: HistoryRowLite[],
  windowStart: number,
): { at?: number; older: boolean } {
  let start: number | undefined;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    const at = (row.lc ?? row.lu ?? NaN) * 1000;
    if (row.s == null || MISSING.has(row.s)) {
      if (Number.isFinite(at)) start = at;
      continue;
    }
    return { at: start, older: false };
  }
  if (start === undefined) return { older: false };
  if (start <= windowStart + 60_000) return { older: true, at: windowStart };
  return { at: start, older: false };
}

/** Icons by domain, then by device_class, for the row's squircle. */
const DOMAIN_ICONS: Record<string, string> = {
  camera: "mdi:cctv",
  climate: "mdi:thermostat",
  light: "mdi:lightbulb",
  cover: "mdi:window-shutter",
  lock: "mdi:lock",
  media_player: "mdi:cast",
  fan: "mdi:fan",
  vacuum: "mdi:robot-vacuum",
  switch: "mdi:power-socket-de",
  binary_sensor: "mdi:radiobox-marked",
  sensor: "mdi:eye",
  siren: "mdi:alarm-light",
  valve: "mdi:valve",
  humidifier: "mdi:air-humidifier",
  water_heater: "mdi:water-boiler",
  device_tracker: "mdi:cellphone",
};

const CLASS_ICONS: Record<string, string> = {
  door: "mdi:door",
  window: "mdi:window-closed-variant",
  opening: "mdi:window-closed-variant",
  motion: "mdi:motion-sensor",
  occupancy: "mdi:motion-sensor",
  presence: "mdi:motion-sensor",
  moisture: "mdi:water-alert",
  smoke: "mdi:smoke-detector-variant",
  temperature: "mdi:thermometer",
  humidity: "mdi:water-percent",
  power: "mdi:flash",
  energy: "mdi:lightning-bolt",
  battery: "mdi:battery",
  outlet: "mdi:power-socket-de",
  plug: "mdi:power-plug",
  illuminance: "mdi:brightness-5",
  pressure: "mdi:gauge",
};

export function unitIcon(primary: string, state?: StateLike): string {
  const explicit = state?.attributes?.icon;
  if (typeof explicit === "string" && explicit) return explicit;
  const cls = state?.attributes?.device_class;
  if (typeof cls === "string" && CLASS_ICONS[cls]) return CLASS_ICONS[cls];
  return DOMAIN_ICONS[primary.split(".")[0]] ?? "mdi:devices";
}

/**
 * Integration names for the most common platforms. The frontend only loads
 * the `title` translations on configuration pages, so on a dashboard
 * `component.<domain>.title` is often missing.
 */
const INTEGRATION_NAMES: Record<string, string> = {
  zigbee2mqtt: "Zigbee2MQTT",
  mqtt: "MQTT",
  zha: "ZHA",
  zwave_js: "Z-Wave",
  shelly: "Shelly",
  frigate: "Frigate",
  esphome: "ESPHome",
  tapo_control: "Tapo",
  tapo: "Tapo",
  tplink: "TP-Link",
  hue: "Hue",
  tradfri: "IKEA",
  matter: "Matter",
  homekit_controller: "HomeKit",
  sonos: "Sonos",
  cast: "Google Cast",
  tuya: "Tuya",
  xiaomi_miio: "Xiaomi",
  roborock: "Roborock",
  ecoflow_cloud: "EcoFlow",
  better_thermostat: "Better Thermostat",
  fritz: "FRITZ!Box",
  unifi: "UniFi",
  remote_homeassistant: "Remote HA",
  mobile_app: "Companion",
  bambu_lab: "Bambu Lab",
  motioneye: "motionEye",
  tasmota: "Tasmota",
  tuya_local: "Tuya Local",
  midea_ac_lan: "Midea AC LAN",
  smartthings: "SmartThings",
  home_connect: "Home Connect",
  petkit: "PetKit",
  glances: "Glances",
  wled: "WLED",
  reolink: "Reolink",
  octoprint: "OctoPrint",
  google_cast: "Google Cast",
  androidtv_remote: "Android TV",
  samsungtv: "Samsung TV",
  spotify: "Spotify",
  synology_dsm: "Synology",
  ipp: "IPP",
};

export function integrationTitle(domain: string | undefined, localize?: (key: string) => string): string {
  if (!domain) return "—";
  const translated = localize?.(`component.${domain}.title`);
  if (translated && translated !== `component.${domain}.title`) return translated;
  return INTEGRATION_NAMES[domain] ?? domain.charAt(0).toUpperCase() + domain.slice(1).replace(/_/g, " ");
}
