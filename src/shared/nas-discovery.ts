import type { HostSource } from "../types";

/**
 * Entity registry discovery for the NAS/System card, kept out of the element so
 * the mapping can be tested without a DOM.
 *
 * Every supported integration exposes the same handful of concepts under its
 * own vocabulary, so each source maps its registry keys onto the internal ones
 * below. Entities are matched by their registry `translation_key`, never by
 * their display name: HA localises those, so a German instance would report
 * "Datenträgernutzung" and an English one "Disk usage" for the same sensor.
 */
export type HostMetric =
  | "disk_usage"
  | "disk_used"
  | "disk_size"
  | "disk_free"
  | "temperature"
  | "memory_usage"
  | "cpu_usage"
  | "processor_load"
  | "network_rx"
  | "network_tx"
  | "uptime"
  | "volume_status";

/**
 * System Monitor leaves `last_boot` without a translation_key and Synology
 * leaves its uptime sensor without one, hence the unique_id fallback in
 * {@link sourceSignal}.
 */
export const SOURCE_KEYS: Record<HostSource, Record<string, HostMetric>> = {
  glances: {
    disk_usage: "disk_usage",
    disk_used: "disk_used",
    disk_size: "disk_size",
    disk_free: "disk_free",
    temperature: "temperature",
    memory_usage: "memory_usage",
    cpu_usage: "cpu_usage",
    network_rx: "network_rx",
    network_tx: "network_tx",
    uptime: "uptime",
  },
  systemmonitor: {
    disk_use_percent: "disk_usage",
    disk_use: "disk_used",
    disk_free: "disk_free",
    processor_temperature: "temperature",
    memory_use_percent: "memory_usage",
    processor_use: "cpu_usage",
    throughput_network_in: "network_rx",
    throughput_network_out: "network_tx",
    last_boot: "uptime",
  },
  // Synology reports per *volume*, not per mount point, and its disk
  // temperatures are per drive. `temperature` is the chassis sensor and is
  // deliberately mapped alongside `disk_temp`: the drive sensors carry a
  // drive-shaped label (`sda`), so the existing drive-first preference in the
  // card picks them and falls back to the chassis reading when a model exposes
  // no per-drive sensor. The CPU load averages and the swap/cache memory
  // sensors have no place among the percentage tiles and are left out.
  synology_dsm: {
    volume_percentage_used: "disk_usage",
    volume_size_used: "disk_used",
    volume_size_total: "disk_size",
    volume_status: "volume_status",
    disk_temp: "temperature",
    temperature: "temperature",
    memory_real_usage: "memory_usage",
    cpu_total_load: "cpu_usage",
    network_down: "network_rx",
    network_up: "network_tx",
    uptime: "uptime",
  },
};

export interface HostEntity {
  entityId: string;
  /** Mount point for Glances disks, volume id for Synology, iface for network. */
  label: string;
}

/** The subset of an entity registry entry discovery reads. */
export interface HostRegistryEntry {
  entity_id: string;
  platform: string;
  translation_key?: string | null;
  unique_id: string;
  config_entry_id?: string;
  disabled_by?: string | null;
}

export interface HostDiscovery {
  byMetric: Partial<Record<HostMetric, HostEntity[]>>;
  /** Syncthing folder sensors, discovered alongside the host ones. */
  sync: string[];
}

/**
 * Glances unique_ids are `<config_entry_id>-<label>-<sensor_key>`. The label
 * can itself contain dashes (`/rootfs/srv/dev-disk-by-uuid-43ab...`) but the
 * sensor key never does, so cutting at the last dash is unambiguous.
 */
export function labelFromUniqueId(uniqueId: string, configEntryId: string): string | undefined {
  const prefix = `${configEntryId}-`;
  if (!uniqueId.startsWith(prefix)) return undefined;
  const rest = uniqueId.slice(prefix.length);
  const cut = rest.lastIndexOf("-");
  return cut <= 0 ? undefined : rest.slice(0, cut);
}

/**
 * System Monitor unique_ids are `<key>` for the primary target and
 * `<key>_<target>` for the others (disk_use_media, throughput_network_in_end0).
 * Stripping the key is what lets "used" and "free" of the same volume find
 * each other — keeping the raw unique_id gives every sensor its own label and
 * the volume never assembles.
 */
export function systemMonitorLabel(uniqueId: string, signal: string): string {
  if (!uniqueId.startsWith(signal)) return uniqueId;
  return uniqueId.slice(signal.length).replace(/^_/, "") || "/";
}

/**
 * Synology unique_ids are `<serial>_<DSM API>:<key>[_<target>]`, e.g.
 * `2240QDNAXTY69_SYNO.Storage.CGI.Storage:volume_percentage_used_volume_1` or
 * `2240QDNAXTY69_SYNO.DSM.Info:temperature`. Only the part behind the colon is
 * the integration's own key; the serial and the API path differ per NAS and per
 * sensor group, so neither can be matched on. Verified against a live DSM
 * instance's entity registry.
 */
export function synologyKey(uniqueId: string): string {
  const cut = uniqueId.lastIndexOf(":");
  return cut < 0 ? uniqueId : uniqueId.slice(cut + 1);
}

/**
 * Whatever follows the key in the unique_id is the thing the sensor is about:
 * `volume_1` for a volume sensor, `sda` for a drive one. Chassis-wide sensors
 * have nothing after the key and get no label.
 */
export function synologyLabel(uniqueId: string, signal: string): string | undefined {
  const key = synologyKey(uniqueId);
  if (!key.startsWith(signal)) return undefined;
  return key.slice(signal.length).replace(/^_/, "") || undefined;
}

/**
 * The signal a source's registry key is looked up under. Glances and System
 * Monitor fall back to the bare unique_id, which is what System Monitor's
 * `last_boot` is matched by; Synology's unique_id needs the API prefix cut off
 * first, which is what makes its translation_key-less uptime sensor findable.
 */
function sourceSignal(source: HostSource, entry: HostRegistryEntry): string {
  if (entry.translation_key) return entry.translation_key;
  return source === "synology_dsm" ? synologyKey(entry.unique_id) : entry.unique_id;
}

function sourceLabel(source: HostSource, entry: HostRegistryEntry, signal: string): string | undefined {
  switch (source) {
    case "glances":
      return entry.config_entry_id ? labelFromUniqueId(entry.unique_id, entry.config_entry_id) : undefined;
    case "synology_dsm":
      return synologyLabel(entry.unique_id, signal);
    default:
      return systemMonitorLabel(entry.unique_id, signal);
  }
}

// The mount as Glances sees it is prefixed with the container's view of the
// host (`/rootfs`), and OMV volumes are named after their UUID. Neither means
// anything to a person reading a dashboard.
export function prettyMount(mount: string): string {
  const stripped = mount.replace(/^\/rootfs/, "") || "/";
  const uuid = stripped.match(/dev-disk-by-uuid-([0-9a-f]{8})/i);
  if (uuid) return `Volume ${uuid[1]}`;
  return stripped;
}

// Synology has no mount point to shorten — the identifier is the DSM volume id
// (`volume_1`), which only needs capitalising to read like the label DSM itself
// shows. Anything unexpected is left verbatim rather than mangled.
export function prettySynologyVolume(label: string): string {
  const m = label.match(/^volume_(\d+)$/i);
  return m ? `Volume ${m[1]}` : label;
}

export function prettyLabel(source: HostSource, label: string): string {
  return source === "synology_dsm" ? prettySynologyVolume(label) : prettyMount(label);
}

/** The card type's own default source, shared with the editor. */
export function defaultHostSource(cardType?: string): HostSource {
  return cardType === "custom:m3-system-card" || cardType === "m3-system-card" ? "systemmonitor" : "glances";
}

/**
 * DSM volume states that mean the volume itself is in trouble, independent of
 * how full it is. `normal` and `background` (a scrub or an expansion running)
 * are healthy; anything unrecognised is treated as healthy too, so a DSM
 * version with a state this list does not know never paints a row red.
 */
const VOLUME_STATUS_CRITICAL = new Set(["crashed", "degrade", "degraded", "danger"]);
const VOLUME_STATUS_WARN = new Set(["attention"]);

export type VolumeHealth = "warn" | "critical" | undefined;

export function volumeHealth(status?: string): VolumeHealth {
  if (!status) return undefined;
  const s = status.toLowerCase();
  if (VOLUME_STATUS_CRITICAL.has(s)) return "critical";
  if (VOLUME_STATUS_WARN.has(s)) return "warn";
  return undefined;
}

/**
 * A volume's total size: the source's own sensor when there is one, otherwise
 * used + free. A source that reports "used" but neither of the other two — a
 * Synology whose `volume_size_total` sensor is still disabled, which is how the
 * integration ships it — has no total to show, and says so with `undefined`
 * rather than letting a NaN reach the row.
 */
export function resolveDiskSize(
  sizeValue?: number,
  usedValue?: number,
  freeValue?: number,
): number | undefined {
  if (sizeValue !== undefined) return sizeValue;
  if (usedValue === undefined || freeValue === undefined) return undefined;
  const total = usedValue + freeValue;
  return Number.isFinite(total) ? total : undefined;
}

/**
 * Group a raw entity registry listing into the card's internal vocabulary.
 * Disabled entities are skipped — they have no state to read — and
 * `configEntryId` narrows discovery to one instance when several exist.
 */
export function discoverHostEntities(
  entries: readonly HostRegistryEntry[],
  source: HostSource,
  configEntryId?: string,
): HostDiscovery {
  const map = SOURCE_KEYS[source];
  const byMetric: Partial<Record<HostMetric, HostEntity[]>> = {};
  const sync: string[] = [];

  for (const e of entries) {
    if (e.platform === "syncthing" && !e.disabled_by) sync.push(e.entity_id);
    if (e.platform !== source || e.disabled_by) continue;
    if (configEntryId && e.config_entry_id !== configEntryId) continue;
    const signal = sourceSignal(source, e);
    const metric = map[signal];
    if (!metric) continue;
    const label = sourceLabel(source, e, signal);
    (byMetric[metric] ||= []).push({ entityId: e.entity_id, label: label ?? e.entity_id });
  }

  return { byMetric, sync };
}
