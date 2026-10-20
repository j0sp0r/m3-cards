// Domain logic for the two router cards: grading a radio signal, naming a
// throughput, and finding the entities that carry either.
//
// Kept out of the card files because all of it is arithmetic over numbers and
// strings, which is the part worth unit-testing. The cards hold the markup.

import type { HomeAssistant } from "../types";
import { formatNumber } from "./formatting";

// ---- signal grading ---------------------------------------------------------

/**
 * The five steps every radio value is sorted into. Deliberately not named
 * after a colour: the same step means "five bars" on RSRP and "green text" on
 * SNR, and only the card decides what that looks like.
 */
export type SignalGrade = "excellent" | "good" | "fair" | "weak" | "bad";

export const SIGNAL_GRADES: SignalGrade[] = ["bad", "weak", "fair", "good", "excellent"];

/** How many of the five bars a grade fills. */
export const GRADE_BARS: Record<SignalGrade, number> = {
  excellent: 5,
  good: 4,
  fair: 3,
  weak: 2,
  bad: 1,
};

/**
 * A threshold list is read top-down and the first `min` the value clears wins,
 * so the order matters and the list must be sorted descending. `gradeBy`
 * sorts defensively rather than trusting a hand-written config.
 */
export interface Threshold {
  min: number;
  grade: SignalGrade;
}

/**
 * LTE RSRP, in dBm. The steps are the ones the LTE field-test community has
 * converged on: −80 is as good as an urban cell gets, −110 is where a
 * connection starts dropping rather than merely slowing down.
 */
export const DEFAULT_RSRP_THRESHOLDS: Threshold[] = [
  { min: -80, grade: "excellent" },
  { min: -90, grade: "good" },
  { min: -100, grade: "fair" },
  { min: -110, grade: "weak" },
];

/**
 * NR (5G) RSRP, in dBm, shifted about 5 dB stricter than LTE.
 *
 * Not a flourish: NR carriers are wider, so the same total power is spread
 * over more resource elements and each one measures lower for an equally good
 * connection — and the n78/n1 bands in use here sit higher than LTE B3, where
 * the same path loss costs more. Judging NR on the LTE scale reads one step
 * too generous at every level.
 */
export const DEFAULT_NR_RSRP_THRESHOLDS: Threshold[] = [
  { min: -75, grade: "excellent" },
  { min: -85, grade: "good" },
  { min: -95, grade: "fair" },
  { min: -105, grade: "weak" },
];

/** SNR / SINR, in dB. Below 0 the noise is louder than the signal. */
export const DEFAULT_SNR_THRESHOLDS: Threshold[] = [
  { min: 20, grade: "excellent" },
  { min: 13, grade: "good" },
  { min: 0, grade: "fair" },
  { min: -5, grade: "weak" },
];

/** RSRQ, in dB — quality rather than strength, so a much narrower range. */
export const DEFAULT_RSRQ_THRESHOLDS: Threshold[] = [
  { min: -10, grade: "excellent" },
  { min: -15, grade: "good" },
  { min: -20, grade: "fair" },
  { min: -25, grade: "weak" },
];

/**
 * Sorts the list descending and returns the first grade the value clears,
 * falling through to the worst step.
 */
export function gradeBy(value: number, thresholds: Threshold[]): SignalGrade {
  if (!Number.isFinite(value)) return "bad";
  const sorted = [...thresholds].sort((a, b) => b.min - a.min);
  for (const t of sorted) if (value >= t.min) return t.grade;
  return "bad";
}

/**
 * RSRP and RSRQ are negative by definition — the scale runs −44 dBm (standing
 * on the mast) to −140 (nothing). Some integrations publish the magnitude with
 * the sign stripped, so a reading of `94` means −94 dBm and grading it as-is
 * would call a mediocre signal perfect.
 *
 * Only applied to the quantities that cannot be positive. SNR genuinely can
 * be, and must never be flipped.
 */
export function normalizeNegativeDb(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return value > 0 ? -value : value;
}

/**
 * A typographic minus (U+2212) rather than a hyphen.
 *
 * In a proportional font a hyphen is a short connector sitting low, and in
 * `−94 dBm` at 18px it reads as a dash next to the number rather than part of
 * it. The minus is the same width as a digit and sits on the digits' own
 * midline, which is what makes a column of readings line up.
 */
export function withMinusSign(text: string): string {
  return text.replace(/-/g, "−");
}

// ---- throughput -------------------------------------------------------------

export interface Throughput {
  /** Always bit/s, whatever the source reported. */
  bps: number;
  value: number;
  unit: string;
}

const BPS_UNITS: Array<{ unit: string; factor: number }> = [
  { unit: "Gbit/s", factor: 1e9 },
  { unit: "Mbit/s", factor: 1e6 },
  { unit: "kbit/s", factor: 1e3 },
  { unit: "bit/s", factor: 1 },
];

/**
 * Reads a throughput sensor into bit/s, whatever unit it publishes.
 *
 * The unit is taken from the entity rather than assumed, because the same
 * reading arrives as `6106 bit/s` from one integration and `0.006 Mbit/s` from
 * the next, and guessing turns a working card into one that is wrong by six
 * orders of magnitude. An unrecognised unit is treated as bit/s — the raw
 * reading — which is wrong by a factor rather than silently blank.
 *
 * Byte units are accepted too: a router that reports B/s is reporting the same
 * quantity, and multiplying by 8 is not a conversion the viewer should have to
 * do in their head.
 */
export function toBitsPerSecond(value: number, unit: string | undefined): number {
  const u = (unit ?? "").trim().toLowerCase().replace(/\s+/g, "");
  const table: Record<string, number> = {
    "bit/s": 1, bps: 1, "b/s": 8, "byte/s": 8,
    "kbit/s": 1e3, kbps: 1e3, "kb/s": 8e3, "kib/s": 8192,
    "mbit/s": 1e6, mbps: 1e6, "mb/s": 8e6, "mib/s": 8 * 1024 ** 2,
    "gbit/s": 1e9, gbps: 1e9, "gb/s": 8e9, "gib/s": 8 * 1024 ** 3,
  };
  return value * (table[u] ?? 1);
}

/** Picks the unit a bit/s figure reads best in. */
export function scaleThroughput(bps: number): Throughput {
  const abs = Math.abs(bps);
  const step = BPS_UNITS.find((s) => abs >= s.factor) ?? BPS_UNITS[BPS_UNITS.length - 1];
  return { bps, value: bps / step.factor, unit: step.unit };
}

/** Two significant-ish digits: 0,4 — 12,7 — 340 Mbit/s. */
export function throughputDecimals(value: number): number {
  const abs = Math.abs(value);
  if (abs >= 100) return 0;
  if (abs >= 10) return 1;
  return abs >= 1 ? 1 : 2;
}

// ---- data volume ------------------------------------------------------------

/**
 * Gigabytes, as every monthly-volume sensor in this family reports them.
 *
 * The language is required rather than optional: `toFixed` writes a decimal
 * **point** whatever the locale, which put "580.6 GB" on a German dashboard
 * next to the card's own "2,2 dB". Making the caller pass it is what stops the
 * next call site quietly reintroducing that.
 */
export function formatGigabytes(language: string, gb: number, decimals = 1): string {
  if (!Number.isFinite(gb)) return "–";
  const [value, unit, digits] =
    Math.abs(gb) >= 1000 ? [gb / 1000, "TB", 2] : [gb, "GB", decimals];
  return `${formatNumber(language, value, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${unit}`;
}

export interface VolumeSplit {
  down: number;
  up: number;
  total: number;
  /** Share of the bar each direction takes, 0–1, summing to 1. */
  downShare: number;
  upShare: number;
}

export function splitVolume(down: number | undefined, up: number | undefined): VolumeSplit | undefined {
  const d = Number.isFinite(down) ? (down as number) : undefined;
  const u = Number.isFinite(up) ? (up as number) : undefined;
  if (d === undefined && u === undefined) return undefined;
  const dv = d ?? 0;
  const uv = u ?? 0;
  const total = dv + uv;
  // Nothing transferred yet: split the bar evenly rather than divide by zero
  // and paint a NaN-width element, which renders as a full-width bar.
  if (total <= 0) return { down: dv, up: uv, total: 0, downShare: 0.5, upShare: 0.5 };
  return { down: dv, up: uv, total, downShare: dv / total, upShare: uv / total };
}

/** Where a tariff allowance turns amber, then red. */
export const DATA_LIMIT_WARN = 0.8;
export const DATA_LIMIT_CRITICAL = 0.95;

export function limitGrade(used: number, limit: number): "ok" | "warn" | "critical" {
  if (limit <= 0) return "ok";
  const share = used / limit;
  if (share >= DATA_LIMIT_CRITICAL) return "critical";
  if (share >= DATA_LIMIT_WARN) return "warn";
  return "ok";
}

// ---- value tidying ----------------------------------------------------------

/**
 * The vocabulary these routers publish, shortened to what fits a 11px cell.
 *
 * Every entry is a *default* — `value_map` in the config is applied first, so
 * a brand this table has never seen is one config line away rather than a
 * code change.
 */
export const DEFAULT_VALUE_MAP: Record<string, string> = {
  ca_activated: "An",
  ca_deactivated: "Aus",
  ipv4_ipv6_connected: "IPv4 + IPv6",
  ipv4_connected: "IPv4",
  ipv6_connected: "IPv6",
  ppp_disconnected: "Getrennt",
  modem_init_complete: "Bereit",
  modem_offline: "Offline",
};

/** The values that should be read as "this is not the happy case". */
const WARN_VALUES = new Set(["ca_deactivated", "ppp_disconnected", "modem_offline", "aus"]);

export function isWarnValue(raw: string): boolean {
  return WARN_VALUES.has(raw.trim().toLowerCase());
}

/**
 * `LTE BAND 3` → `LTE B3`, `NR BAND 78` → `NR B78`.
 *
 * The long form is what the modem reports and it is three times the width of
 * the number anyone actually reads off it.
 */
export function shortenBand(raw: string): string {
  return raw.replace(/\b(LTE|NR|GSM|WCDMA)\s+BAND\s*(\d+)\b/gi, (_m, tech: string, n: string) =>
    `${tech.toUpperCase()} B${n}`,
  );
}

/** `value_map` first, then the built-in table, then the band shortener. */
export function tidyValue(raw: string, valueMap?: Record<string, string>): string {
  const trimmed = String(raw).trim();
  const mapped = valueMap?.[trimmed] ?? DEFAULT_VALUE_MAP[trimmed];
  if (mapped !== undefined) return mapped;
  return shortenBand(trimmed);
}

// ---- connection state -------------------------------------------------------

export type LinkState = "online" | "offline" | "unknown";

const OFFLINE_WORDS = /^(off|false|disconnected|ppp_disconnected|modem_offline|unavailable|unknown|none|0)$/i;
const ONLINE_WORDS = /^(on|true|connected|ipv4_ipv6_connected|ipv4_connected|ipv6_connected|up)$/i;

/**
 * Reads a connection entity whatever shape it has: a `binary_sensor` with
 * on/off, a `sensor` carrying the modem's own PPP vocabulary, or a plain
 * "Connected" string from a Fritzbox.
 */
export function linkStateOf(state: string | undefined, deviceClass?: string): LinkState {
  if (state === undefined) return "unknown";
  const s = String(state).trim();
  if (!s || /^(unknown|unavailable)$/i.test(s)) return "unknown";
  if (ONLINE_WORDS.test(s)) return "online";
  if (OFFLINE_WORDS.test(s)) return "offline";
  // A connectivity binary_sensor that got here has a state this table does not
  // know; anything other than the two words above is not a connection.
  if (deviceClass === "connectivity") return "offline";
  // A free-text status sensor saying something unrecognised is reporting
  // *something*, which is more than an offline modem does.
  return "online";
}

// ---- temperature ------------------------------------------------------------

/**
 * ZTE publishes `C`, not `°C`, and HA passes the unit through untouched, so
 * the card would otherwise print "52 C".
 */
export function normalizeTempUnit(unit: string | undefined): string {
  const u = (unit ?? "").trim();
  if (!u) return "°C";
  if (/^°?C$/i.test(u)) return "°C";
  if (/^°?F$/i.test(u)) return "°F";
  return u;
}

export type TempGrade = "ok" | "warn" | "hot";

export interface TempThresholds {
  warn: number;
  hot: number;
}

export const DEFAULT_TEMP_THRESHOLDS: TempThresholds = { warn: 60, hot: 70 };

export function gradeTemp(celsius: number, t: TempThresholds = DEFAULT_TEMP_THRESHOLDS): TempGrade {
  if (celsius >= t.hot) return "hot";
  if (celsius >= t.warn) return "warn";
  return "ok";
}

// ---- throttling -------------------------------------------------------------

/**
 * A throttle sensor reads 0 the overwhelming majority of the time, which is
 * exactly why the old dashboard's bar chart of it was useless: a flat line at
 * zero for 24 hours tells you nothing you could not have assumed. What is
 * worth drawing is the single bit "is anything throttling right now", and if
 * so, which sensor said so.
 */
export interface ThrottleState {
  active: boolean;
  /** The sensors that are non-zero, by their display name. */
  offenders: string[];
}

export function throttleStateOf(
  readings: Array<{ name: string; value: number | undefined }>,
): ThrottleState {
  const offenders = readings
    .filter((r) => r.value !== undefined && Number.isFinite(r.value) && (r.value as number) > 0)
    .map((r) => r.name);
  return { active: offenders.length > 0, offenders };
}

// ---- entity discovery -------------------------------------------------------

/**
 * What a router card looks for, as a list of patterns per slot.
 *
 * Matching is on the **entity id**, not the device, because the sensors this
 * was built against do not have a device: they are published with
 * `state.set()` from a pyscript app, which never touches the entity registry.
 * A Fritzbox or a Huawei integration does register its entities, and those are
 * found by the same patterns — the id is the one thing every source has.
 */
export interface DiscoverySlot {
  key: RouterSlot;
  patterns: RegExp[];
}

export type RouterSlot =
  | "connection"
  | "rsrp" | "rsrq" | "snr" | "rssi"
  | "nr_rsrp" | "nr_snr"
  | "band" | "nr_band" | "cell_id" | "pci" | "nr_pci" | "network_type" | "carrier_aggregation"
  | "download" | "upload"
  | "data_down" | "data_up" | "data_total"
  | "operator" | "sim"
  | "uptime" | "firmware" | "connected_devices";

/**
 * Ordered: the first pattern that matches an unclaimed entity wins the slot,
 * and each entity is claimed once, so `zte_5g_rsrp` cannot also become the
 * LTE RSRP. The NR patterns therefore come before the plain ones.
 */
export const DISCOVERY_SLOTS: DiscoverySlot[] = [
  { key: "nr_rsrp", patterns: [/(?:^|_)(?:5g|nr5?g?)_rsrp$/, /(?:^|_)nr_rsrp$/] },
  { key: "nr_snr", patterns: [/(?:^|_)(?:5g|nr5?g?)_(?:sinr|snr)$/] },
  { key: "nr_band", patterns: [/(?:^|_)nr5?g?_(?:action_)?band$/, /(?:^|_)5g_band$/] },
  { key: "nr_pci", patterns: [/(?:^|_)(?:5g|nr5?g?)_pci$/] },
  { key: "rsrp", patterns: [/(?:^|_)(?:lte_)?rsrp$/] },
  { key: "rsrq", patterns: [/(?:^|_)(?:lte_)?rsrq$/] },
  { key: "snr", patterns: [/(?:^|_)(?:lte_)?(?:sinr|snr)$/] },
  { key: "rssi", patterns: [/(?:^|_)(?:lte_)?rssi$/] },
  { key: "pci", patterns: [/(?:^|_)(?:lte_)?pci$/] },
  { key: "cell_id", patterns: [/(?:^|_)cell_?id$/, /(?:^|_)enb_?id$/] },
  { key: "carrier_aggregation", patterns: [/(?:^|_)(?:wan_)?lte_ca$/, /(?:^|_)carrier_aggregation$/] },
  { key: "band", patterns: [/(?:^|_)(?:wan_)?(?:active_)?band$/, /(?:^|_)lte_band$/] },
  { key: "network_type", patterns: [/(?:^|_)network_type$/, /(?:^|_)(?:ppp|modem(?:_main)?)_(?:status|state)$/] },
  { key: "download", patterns: [/(?:^|_)(?:download|rx)_(?:bps|bits|throughput|thrpt)$/, /(?:^|_)downstream_current$/, /(?:^|_)download$/] },
  { key: "upload", patterns: [/(?:^|_)(?:upload|tx)_(?:bps|bits|throughput|thrpt)$/, /(?:^|_)upstream_current$/, /(?:^|_)upload$/] },
  { key: "data_total", patterns: [/(?:^|_)monthly_total(?:_gb)?$/, /(?:^|_)data_total$/] },
  { key: "data_down", patterns: [/(?:^|_)monthly_rx(?:_gb)?$/, /(?:^|_)data_(?:down|rx)$/] },
  { key: "data_up", patterns: [/(?:^|_)monthly_tx(?:_gb)?$/, /(?:^|_)data_(?:up|tx)$/] },
  { key: "operator", patterns: [/(?:^|_)(?:operator|provider|network_name)$/] },
  { key: "sim", patterns: [/(?:^|_)sim(?:_status|_state)?$/] },
  { key: "uptime", patterns: [/(?:^|_)uptime$/] },
  { key: "firmware", patterns: [/(?:^|_)(?:firmware|sw_version)$/] },
  { key: "connected_devices", patterns: [/(?:^|_)(?:connected_)?devices?(?:_connected|_count)?$/] },
  { key: "connection", patterns: [/(?:^|_)(?:reachable|connection|online|connected)$/] },
];

/**
 * The prefix a set of router entities share, e.g. `zte` for `sensor.zte_*`.
 *
 * Derived rather than configured so that adding the card to a fresh dashboard
 * finds something without being told: the prefix that owns the most
 * router-looking entities wins.
 */
export function guessRouterPrefix(entityIds: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const id of entityIds) {
    const object = id.slice(id.indexOf(".") + 1);
    const prefix = object.split("_")[0];
    if (!prefix || prefix.length < 2) continue;
    const slot = DISCOVERY_SLOTS.find((s) =>
      s.patterns.some((p) => p.test(object.slice(prefix.length))),
    );
    if (!slot) continue;
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 1; // a single match is a coincidence, not a prefix
  for (const [prefix, n] of counts) {
    if (n > bestCount) {
      best = prefix;
      bestCount = n;
    }
  }
  return best;
}

/**
 * Fills whichever slots the given entities can fill.
 *
 * Each entity is claimed at most once and each slot filled at most once, so
 * the order of DISCOVERY_SLOTS decides the ties. Passing a prefix narrows the
 * search to one router on an instance that has two.
 */
export function discoverRouterEntities(
  entityIds: string[],
  prefix?: string,
): Partial<Record<RouterSlot, string>> {
  const out: Partial<Record<RouterSlot, string>> = {};
  const claimed = new Set<string>();
  const candidates = prefix
    ? entityIds.filter((id) => id.slice(id.indexOf(".") + 1).startsWith(`${prefix}_`))
    : entityIds;

  for (const slot of DISCOVERY_SLOTS) {
    if (out[slot.key]) continue;
    for (const pattern of slot.patterns) {
      const hit = candidates.find((id) => {
        if (claimed.has(id)) return false;
        const object = id.slice(id.indexOf(".") + 1);
        const tail = prefix && object.startsWith(`${prefix}_`) ? object.slice(prefix.length) : object;
        return pattern.test(tail) || pattern.test(object);
      });
      if (hit) {
        out[slot.key] = hit;
        claimed.add(hit);
        break;
      }
    }
  }
  return out;
}

/**
 * Temperature sensors belonging to the same prefix, in reporting order.
 *
 * Found by **unit**, not by name. The obvious filter — an id containing
 * "temp" — misses the one this was built against: `sensor.zte_pm_modem_5g`
 * carries "Temp" in its friendly name and nowhere in its id, so a name filter
 * drew one of the two modem temperatures and silently dropped the other.
 *
 * The unit is also what keeps the ZTE's PA sensor out: it reads −40 on a scale
 * nobody has documented and publishes no unit at all, and drawing it as 40 °C
 * below zero beside a modem at 52 °C is worse than leaving it out.
 */
export function discoverTemperatureEntities(
  hass: HomeAssistant,
  entityIds: string[],
  prefix?: string,
): string[] {
  return entityIds.filter((id) => {
    if (!id.startsWith("sensor.")) return false;
    const object = id.slice(7);
    if (prefix && !object.startsWith(`${prefix}_`)) return false;
    const st = hass.states[id];
    if (!st) return false;
    if (st.attributes.device_class === "temperature") return true;
    const unit = st.attributes.unit_of_measurement;
    return !!unit && /^°?[CF]$/i.test(String(unit).trim());
  });
}

/** Throttle/level sensors belonging to the same prefix. */
export function discoverThrottleEntities(entityIds: string[], prefix?: string): string[] {
  return entityIds.filter((id) => {
    if (!id.startsWith("sensor.")) return false;
    const object = id.slice(7);
    if (prefix && !object.startsWith(`${prefix}_`)) return false;
    return /(?:^|_)(?:therm|throttle)[a-z0-9_]*_level$/i.test(object);
  });
}
