// The network card's model: the devices on the network, gathered from any
// number of sources and merged by MAC, with what is new and what is wrong
// with them. Pure functions; the card supplies `hass` data and the clock.
//
// Sources, in the order the config lists them (the first one wins a
// conflict, later ones only fill gaps):
// - device_tracker entities, listed or gathered by integration (fritz,
//   unifi, nmap_tracker …);
// - a list entity: an attribute holding `[{mac, ip, host_name, …}]`, for a
//   router whose integration has no trackers — a pyscript, REST or MQTT
//   sensor will do.

export type Connection = "wired" | "wireless";

export interface NetDevice {
  /** The normalised MAC, or `entity:<id>` / `ip:<ip>` without one. */
  key: string;
  mac?: string;
  ip?: string;
  host?: string;
  /** A name from Home Assistant: the device's, else the entity's. */
  haName?: string;
  manufacturer?: string;
  entity?: string;
  online: boolean;
  connection?: Connection;
  band?: string;
  ssid?: string;
  /** dBm. */
  signal?: number;
  /** ms; when a source last saw it. */
  lastSeen?: number;
  randomMac: boolean;
}

export interface Override {
  mac?: string;
  entity?: string;
  name?: string;
  icon?: string;
  signal?: string;
  fixed_ip?: boolean;
}

// ---- MAC -------------------------------------------------------------------

/** "aa-bb-cc-dd-ee-ff", "aabb.ccdd.eeff" → "AA:BB:CC:DD:EE:FF"; undefined if not a MAC. */
export function normalizeMac(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const hex = raw.replace(/[^0-9a-f]/gi, "");
  if (hex.length !== 12) return undefined;
  return hex.toUpperCase().match(/.{2}/g)!.join(":");
}

/** A locally administered (randomised, "private") address: the second bit of the first octet. */
export function isRandomMac(mac: string | undefined): boolean {
  if (!mac) return false;
  const first = parseInt(mac.slice(0, 2), 16);
  return Number.isFinite(first) && (first & 0x02) !== 0;
}

/** For the list: never the whole address. */
export function maskMac(mac: string | undefined): string {
  return mac ? `${mac.slice(0, 8)}:…` : "";
}

// ---- reading sources -------------------------------------------------------

interface StateLike {
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: string;
}

const str = (v: unknown): string | undefined => {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s && s !== "--" && s.toLowerCase() !== "unknown" && s.toLowerCase() !== "unavailable" ? s : undefined;
};

const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : undefined;
};

function connectionOf(a: Record<string, unknown>): Connection | undefined {
  if (a.is_wired === true || a.wired === true) return "wired";
  if (a.is_wired === false || a.wired === false) return "wireless";
  const c = String(a.connection ?? a.connection_type ?? a.interface ?? "").toLowerCase();
  if (/wired|lan|ethernet|eth/.test(c) && !/wlan/.test(c)) return "wired";
  if (/wireless|wlan|wifi|wi-fi|802\.11/.test(c)) return "wireless";
  if (str(a.ssid) || str(a.essid) || num(a.rssi ?? a.signal ?? a.signal_strength) !== undefined) return "wireless";
  return undefined;
}

function bandOf(a: Record<string, unknown>): string | undefined {
  const b = str(a.band ?? a.radio ?? a.radio_proto ?? a.channel_band);
  if (!b) {
    const ch = num(a.channel);
    if (ch === undefined) return undefined;
    return ch > 14 ? "5 GHz" : "2,4 GHz";
  }
  const l = b.toLowerCase().replace(",", ".");
  if (l.includes("2.4") || l === "ng" || l === "2g" || l === "b" || l === "g") return "2,4 GHz";
  if (l.includes("6g") || l.includes("6 ghz") || l === "6e") return "6 GHz";
  if (l.includes("5") || l === "na" || l === "ac" || l === "ax") return "5 GHz";
  return b;
}

function signalOf(a: Record<string, unknown>): number | undefined {
  const s = num(a.signal_strength ?? a.rssi ?? a.signal);
  // Some integrations report a percentage; only dBm (negative) is used.
  return s !== undefined && s < 0 ? s : undefined;
}

function seenOf(a: Record<string, unknown>, fallback?: string): number | undefined {
  for (const k of ["last_time_reachable", "last_seen", "last_activity"]) {
    const v = a[k];
    if (v === undefined || v === null) continue;
    const n = typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : Date.parse(String(v));
    if (Number.isFinite(n)) return n;
  }
  return fallback ? Date.parse(fallback) : undefined;
}

export function fromTracker(entityId: string, st: StateLike, ha?: { name?: string; manufacturer?: string }): NetDevice {
  const a = st.attributes ?? {};
  const mac = normalizeMac(a.mac);
  const ip = str(a.ip);
  return {
    key: mac ?? `entity:${entityId}`,
    mac,
    ip,
    host: str(a.host_name ?? a.hostname),
    haName: ha?.name ?? str(a.friendly_name),
    manufacturer: ha?.manufacturer ?? str(a.manufacturer ?? a.oui),
    entity: entityId,
    online: st.state === "home",
    connection: connectionOf(a),
    band: bandOf(a),
    ssid: str(a.ssid ?? a.essid),
    signal: signalOf(a),
    lastSeen: seenOf(a, st.state === "home" ? undefined : st.last_changed),
    randomMac: isRandomMac(mac),
  };
}

/**
 * The devices in a list entity's attribute; every listed device is online.
 * `connection` is what a device is when it does not say.
 */
export function fromList(list: unknown, connection?: Connection): NetDevice[] {
  if (!Array.isArray(list)) return [];
  const out: NetDevice[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const a = raw as Record<string, unknown>;
    const mac = normalizeMac(a.mac ?? a.mac_addr ?? a.mac_address);
    const ip = str(a.ip ?? a.ip_addr ?? a.ip_address);
    const key = mac ?? (ip ? `ip:${ip}` : undefined);
    if (!key) continue;
    out.push({
      key,
      mac,
      ip,
      host: str(a.host_name ?? a.hostname ?? a.name),
      manufacturer: str(a.manufacturer ?? a.vendor),
      online: a.online === false ? false : true,
      connection: connectionOf(a) ?? connection,
      band: bandOf(a),
      ssid: str(a.ssid),
      signal: signalOf(a),
      lastSeen: seenOf(a),
      randomMac: isRandomMac(mac),
    });
  }
  return out;
}

/**
 * Merges by key: the first source's fields stand, later ones only fill what
 * is missing. A device is online when its first source says so.
 */
export function mergeDevices(sources: NetDevice[][]): NetDevice[] {
  const byKey = new Map<string, NetDevice>();
  for (const list of sources) {
    for (const d of list) {
      const had = byKey.get(d.key);
      if (!had) {
        byKey.set(d.key, { ...d });
        continue;
      }
      for (const [k, v] of Object.entries(d) as [keyof NetDevice, unknown][]) {
        if (v !== undefined && had[k] === undefined) (had as unknown as Record<string, unknown>)[k] = v;
      }
    }
  }
  return [...byKey.values()];
}

export type RandomMacHandling = "flag" | "merge_by_name" | "ignore";

/**
 * Randomised addresses: `ignore` drops them; `merge_by_name` folds one into
 * a device of the same host name (a phone that changed its private address
 * stays one phone); `flag` keeps them, marked as private.
 */
export function applyRandomMacs(devices: NetDevice[], handling: RandomMacHandling): NetDevice[] {
  if (handling === "ignore") return devices.filter((d) => !d.randomMac);
  if (handling !== "merge_by_name") return devices;
  const out: NetDevice[] = [];
  const byName = new Map<string, NetDevice>();
  // Stable devices first, so a private address folds into them.
  for (const d of [...devices].sort((a, b) => Number(a.randomMac) - Number(b.randomMac))) {
    const name = (d.host ?? d.haName)?.toLowerCase();
    const into = name ? byName.get(name) : undefined;
    if (d.randomMac && into) {
      into.online = into.online || d.online;
      into.ip = into.ip ?? d.ip;
      continue;
    }
    out.push(d);
    if (name && !byName.has(name)) byName.set(name, d);
  }
  return out;
}

// ---- names and icons -------------------------------------------------------

export function findOverride(d: NetDevice, overrides: Override[] | undefined): Override | undefined {
  return overrides?.find((o) => (o.mac && normalizeMac(o.mac) === d.mac) || (o.entity && o.entity === d.entity));
}

/** Override → Home Assistant's name → host name → undefined (the card says "Unknown device"). */
export function deviceName(d: NetDevice, o?: Pick<Override, "name">): string | undefined {
  return o?.name || d.haName || d.host;
}

const ICONS: [RegExp, string][] = [
  [/iphone|android|galaxy|pixel|phone|handy|smartphone|oneplus|xiaomi|redmi|oppo|huawei|s2\d|note\d/i, "mdi:cellphone"],
  [/ipad|tablet|tab[\s-]|kindle|surface/i, "mdi:tablet"],
  [/watch|uhr/i, "mdi:watch"],
  [/macbook|laptop|notebook|thinkpad|mbp/i, "mdi:laptop"],
  [/desktop|imac|\bpc\b|computer|workstation/i, "mdi:monitor"],
  [/\btv\b|fernseher|bravia|webos|tizen|roku|chromecast|fire[\s-]?tv|apple[\s-]?tv|shield/i, "mdi:television"],
  [/nest|echo|alexa|sonos|homepod|speaker|lautsprecher/i, "mdi:speaker"],
  [/cam|kamera|camera|doorbell|ring|intercom|frigate|reolink|tapo[\s_-]?c/i, "mdi:cctv"],
  [/printer|drucker|bambu|prusa|epson|brother|canon|hp[\s-]?[a-z]*jet/i, "mdi:printer"],
  [/plug|steckdose|shelly|tasmota|sonoff|socket|switch/i, "mdi:power-socket-eu"],
  [/bulb|lamp|lampe|light|hue|wled|licht/i, "mdi:lightbulb"],
  [/nas|server|openmediavault|synology|qnap|unraid|proxmox|raspberry|homeassistant|home[\s-]?assistant/i, "mdi:server"],
  [/repeater|router|access[\s-]?point|mesh|re\d{3}|fritz/i, "mdi:router-wireless"],
  [/vacuum|roborock|roomba|saug/i, "mdi:robot-vacuum"],
  [/wash|wasch|dryer|trockner|dishwasher|spül/i, "mdi:washing-machine"],
  [/console|playstation|xbox|nintendo|switch/i, "mdi:gamepad-variant"],
  [/car|auto|tesla|leapmotor/i, "mdi:car"],
  [/esp|tuya|zigbee|sensor|ecoflow|petkit/i, "mdi:chip"],
];

export function deviceIcon(d: NetDevice, o?: Pick<Override, "icon">): string {
  if (o?.icon) return o.icon;
  const text = [d.haName, d.host, d.manufacturer].filter(Boolean).join(" ");
  for (const [re, icon] of ICONS) if (re.test(text)) return icon;
  return "mdi:help-network-outline";
}

// ---- signal ------------------------------------------------------------------

/** 1–4 bars from a Wi-Fi RSSI. */
export function signalBars(dbm: number | undefined): number | undefined {
  if (dbm === undefined) return undefined;
  if (dbm >= -55) return 4;
  if (dbm >= -65) return 3;
  if (dbm >= -75) return 2;
  return 1;
}

export type Quality = "good" | "fair" | "weak";

/** The router's signal against its thresholds (RSRP by default). */
export function routerQuality(value: number | undefined, t: { good: number; fair: number }): Quality | undefined {
  if (value === undefined) return undefined;
  return value >= t.good ? "good" : value >= t.fair ? "fair" : "weak";
}

/** A throughput in Mbit/s from a value and its unit; undefined for other units. */
export function toMbit(value: number | undefined, unit: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const u = (unit ?? "").trim();
  const table: Record<string, number> = {
    "bit/s": 1e-6, "b/s": 1e-6, bps: 1e-6,
    "kbit/s": 1e-3, "Kbit/s": 1e-3, kbps: 1e-3,
    "Mbit/s": 1, Mbps: 1, "MBit/s": 1,
    "Gbit/s": 1e3, Gbps: 1e3,
    "B/s": 8e-6, "kB/s": 8e-3, "KB/s": 8e-3, "KiB/s": 8 * 1.024e-3, "MB/s": 8, "MiB/s": 8 * 1.048576,
  };
  const f = table[u];
  return f === undefined ? undefined : value * f;
}

// ---- problems -----------------------------------------------------------------

export interface ProblemRules {
  weakBelow?: number;
  reconnectThreshold?: number;
  ipConflict?: boolean;
}

export type ProblemKind = "weak" | "reconnects" | "ip_conflict" | "custom";

export interface Problem {
  kind: ProblemKind;
  /** Reconnect count, or the custom text. */
  detail?: string;
}

/**
 * Keys of online devices sharing an IP with a different MAC. A repeater or
 * access point shows up with its own address and a locally administered
 * second one on the same IP; that is one device, not a conflict — so it
 * takes two universal (not private) addresses on one IP.
 */
export function ipConflicts(devices: NetDevice[]): Set<string> {
  const byIp = new Map<string, NetDevice[]>();
  for (const d of devices) {
    if (!d.online || !d.ip) continue;
    const list = byIp.get(d.ip) ?? [];
    list.push(d);
    byIp.set(d.ip, list);
  }
  const out = new Set<string>();
  for (const list of byIp.values()) {
    const universal = new Set(list.filter((d) => !d.randomMac).map((d) => d.mac ?? d.key));
    if (universal.size > 1) for (const d of list) out.add(d.key);
  }
  return out;
}

export function problemsOf(
  d: NetDevice,
  rules: ProblemRules,
  ctx: { conflicts: Set<string>; reconnects?: Map<string, number>; custom?: Map<string, string> },
): Problem[] {
  const out: Problem[] = [];
  if (d.online && rules.weakBelow !== undefined && d.signal !== undefined && d.signal < rules.weakBelow) out.push({ kind: "weak" });
  const rc = ctx.reconnects?.get(d.key);
  if (rules.reconnectThreshold !== undefined && rc !== undefined && rc >= rules.reconnectThreshold) {
    out.push({ kind: "reconnects", detail: String(rc) });
  }
  if (rules.ipConflict !== false && ctx.conflicts.has(d.key)) out.push({ kind: "ip_conflict" });
  const c = ctx.custom?.get(d.key)?.trim();
  if (c) out.push({ kind: "custom", detail: c });
  return out;
}

/** History rows of a tracker → how often it switched between home and away. */
export function countReconnects(rows: { s: string }[] | undefined): number {
  if (!rows?.length) return 0;
  let n = 0;
  let prev: string | undefined;
  for (const r of rows) {
    const s = r.s === "home" ? "home" : r.s === "not_home" ? "away" : undefined;
    if (!s) continue;
    if (prev && s !== prev) n++;
    prev = s;
  }
  return n;
}

// ---- view ------------------------------------------------------------------------

export interface Row {
  device: NetDevice;
  name?: string;
  icon: string;
  isNew: boolean;
  /** When it was first seen, for "new 2 h ago". */
  firstSeen?: number;
  /** When it was last seen, for "offline since". */
  lastSeen?: number;
  problems: Problem[];
  fixedIp: boolean;
}

export type Filter = "all" | "new" | "problems" | "wifi" | "lan" | "offline";

export function matchesFilter(r: Row, f: Filter): boolean {
  switch (f) {
    case "new":
      return r.isNew;
    case "problems":
      return r.problems.length > 0;
    case "wifi":
      return r.device.online && r.device.connection === "wireless";
    case "lan":
      return r.device.online && r.device.connection === "wired";
    case "offline":
      return !r.device.online;
    default:
      return true;
  }
}

export function matchesSearch(r: Row, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const mac = r.device.mac?.toLowerCase() ?? "";
  return [r.name, r.device.host, r.device.ip].some((v) => v?.toLowerCase().includes(s)) || (s.length >= 2 && (mac.includes(s) || mac.replace(/:/g, "").includes(s.replace(/[:-]/g, ""))));
}

/** New, then problems, then online by name, then offline. */
export function sortRows(rows: Row[], collator: Intl.Collator): Row[] {
  const rank = (r: Row) => (r.isNew ? 0 : r.problems.length ? 1 : r.device.online ? 2 : 3);
  return [...rows].sort((a, b) => rank(a) - rank(b) || collator.compare(a.name ?? a.device.host ?? a.device.ip ?? "~", b.name ?? b.device.host ?? b.device.ip ?? "~"));
}

export function countFilters(rows: Row[]): Record<Filter, number> {
  const out = { all: 0, new: 0, problems: 0, wifi: 0, lan: 0, offline: 0 } as Record<Filter, number>;
  for (const r of rows) {
    for (const f of Object.keys(out) as Filter[]) if (matchesFilter(r, f)) out[f]++;
  }
  // "All" counts what is online and the new ones, not the offline tail.
  out.all = rows.filter((r) => r.device.online).length;
  return out;
}
