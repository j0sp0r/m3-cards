import type { HomeAssistant } from "../types";
import { PALETTE } from "./tokens";
import { OptimisticState } from "./optimistic-state";

// Everything the two vacuum cards share: what a vacuum's state *means*, which
// of a device's entities belong to which block, and the optimistic-state
// bookkeeping that keeps the buttons from feeling dead.
//
// WHY OPTIMISM IS NOT OPTIONAL HERE
//
// The Roborock integration polls on a 30-second timer and pushes nothing. A
// tap on "Start" therefore changes no state the card can see for up to half a
// minute, which reads as a broken button rather than a slow one. So the card
// shows the state it just asked for, and lets the next poll overwrite it —
// see `OptimisticActivity` below.

/**
 * The states `vacuum` entities actually report. Home Assistant renamed these
 * to a `VacuumActivity` enum in 2025.x but kept the same strings, so matching
 * on the string works on both sides of that change.
 */
export type VacuumActivity =
  | "cleaning"
  | "docked"
  | "paused"
  | "idle"
  | "returning"
  | "error"
  | "unavailable";

const KNOWN: VacuumActivity[] = [
  "cleaning",
  "docked",
  "paused",
  "idle",
  "returning",
  "error",
  "unavailable",
];

/**
 * `returning_home` is the legacy spelling and still turns up on non-core
 * integrations; anything unrecognised is treated as idle rather than as an
 * error, because a vacuum reporting a vendor-specific state is not broken.
 */
export function resolveActivity(state: string | undefined): VacuumActivity {
  if (!state) return "unavailable";
  if (state === "returning_home") return "returning";
  if (state === "unknown") return "unavailable";
  return KNOWN.includes(state as VacuumActivity) ? (state as VacuumActivity) : "idle";
}

/**
 * The accent each state paints with, taken from the suite's palette rather
 * than from new hex values: a vacuum that is cleaning should be the same blue
 * as everything else that is "active in the home".
 */
export function activityColor(activity: VacuumActivity): string {
  switch (activity) {
    case "cleaning":
      return PALETTE.home;
    case "docked":
      return PALETTE.ok;
    case "paused":
      return PALETTE.solar;
    case "returning":
      return PALETTE.media;
    case "error":
      return PALETTE.heat;
    default:
      return PALETTE.off;
  }
}

/**
 * The header icon says what the thing is; the colour says how it is.
 *
 * It used to change shape with the state — a house with a bolt in the dock, a
 * house with an arrow on the way back, a pause sign — which meant a vacuum spent
 * most of its life shown as a house. The accent already follows the state and
 * the status line says it in words, so the shape stays a robot vacuum.
 *
 * Two states keep a mark of their own, because they are the ones worth noticing
 * from across the room: an error, and a vacuum that cannot be reached.
 */
export function activityIcon(activity: VacuumActivity): string {
  switch (activity) {
    case "error":
      return "mdi:robot-vacuum-alert";
    case "unavailable":
      return "mdi:robot-vacuum-off";
    default:
      return "mdi:robot-vacuum";
  }
}

// ---- capabilities -----------------------------------------------------------

/**
 * Home Assistant's own `VacuumEntityFeature` bits.
 *
 * This is what makes the card brand-agnostic rather than Roborock-shaped: the
 * `vacuum` domain normalises start/pause/stop/return/locate/fan-speed across
 * every integration, and each entity declares which of them it actually has.
 * Reading that is the difference between "works with any vacuum" and "draws
 * buttons that silently do nothing on a Valetudo".
 *
 * Only the bits the card acts on are listed. Unknown higher bits are ignored
 * rather than guessed at.
 */
export const VACUUM_FEATURE = {
  TURN_ON: 1,
  TURN_OFF: 2,
  PAUSE: 4,
  STOP: 8,
  RETURN_HOME: 16,
  FAN_SPEED: 32,
  BATTERY: 64,
  STATUS: 128,
  SEND_COMMAND: 256,
  LOCATE: 512,
  CLEAN_SPOT: 1024,
  MAP: 2048,
  STATE: 4096,
  START: 8192,
  /**
   * Cleaning named areas. Added after the others, and the bit a Roborock S7
   * Pro Ultra reports that the documented list does not mention — it is what
   * `vacuum.clean_area` targets on.
   */
  CLEAN_AREA: 16384,
} as const;

export type VacuumFeature = keyof typeof VACUUM_FEATURE;

/**
 * Whether the entity declares a capability.
 *
 * An entity that reports no `supported_features` at all is treated as capable:
 * some integrations simply do not set it, and hiding every control on those
 * would be worse than offering one that errors.
 */
export function supportsFeature(
  supported: number | undefined,
  feature: VacuumFeature,
): boolean {
  if (supported === undefined || supported === null) return true;
  return (supported & VACUUM_FEATURE[feature]) !== 0;
}

/** Which service a tap on the primary button should call, given the state. */
export type PrimaryIntent = "start" | "pause" | "resume" | "stop" | "none";

export function primaryIntent(
  activity: VacuumActivity,
  supported?: number,
): PrimaryIntent {
  switch (activity) {
    case "cleaning":
      // A vacuum that cannot pause can usually still be stopped; offering
      // "Pause" on one that has neither would be a button that does nothing.
      if (supportsFeature(supported, "PAUSE")) return "pause";
      return supportsFeature(supported, "STOP") ? "stop" : "none";
    case "paused":
      return supportsFeature(supported, "START") ? "resume" : "none";
    case "docked":
    case "idle":
      return supportsFeature(supported, "START") ? "start" : "none";
    default:
      // Returning or errored: starting from here is ambiguous, so the button
      // says nothing rather than guessing.
      return "none";
  }
}

/**
 * What the vacuum's state will be once it has acted on `intent`. Only used to
 * paint the card between the tap and the next poll.
 *
 * `resume` and `start` both land on `cleaning`: the distinction is which
 * service is called, not what happens afterwards.
 */
export function optimisticActivity(
  intent: PrimaryIntent | "return" | "stop",
  current: VacuumActivity,
): VacuumActivity {
  switch (intent) {
    case "start":
    case "resume":
      return "cleaning";
    case "pause":
      return "paused";
    case "return":
      return "returning";
    case "stop":
      return "idle";
    default:
      return current;
  }
}

/**
 * The vacuum's own optimistic holder, wrapping the generic one.
 *
 * Composition rather than inheritance, because the card speaks of activities
 * and the generic class speaks of values — and a subclass that changes the
 * shape of an inherited method is a lie the compiler is right to reject.
 *
 * An error or a disconnect always wins over a standing guess: those are the
 * two states a user must not be kept from seeing for the sake of a smooth
 * animation.
 */
export class OptimisticActivity {
  private readonly _inner: OptimisticState<VacuumActivity>;

  public constructor(ttlMs = 70_000, onExpire?: () => void) {
    this._inner = new OptimisticState<VacuumActivity>({
      ttlMs,
      onExpire,
      overriding: ["error", "unavailable"],
    });
  }

  public set(activity: VacuumActivity): void {
    this._inner.set(activity);
  }

  public clear(): void {
    this._inner.clear();
  }

  public resolve(actual: VacuumActivity): { activity: VacuumActivity; pending: boolean } {
    const { value, pending } = this._inner.resolve(actual);
    return { activity: value, pending };
  }

  public get pendingSince(): number {
    return this._inner.pendingSince;
  }
}

// ---- discovery --------------------------------------------------------------

/**
 * A vacuum's companion entities, found on its own device.
 *
 * Matched on the registry's `translation_key` first and the entity_id suffix
 * only as a fallback. The key is what the integration assigns and it survives
 * a rename; the entity_id is what the user is free to change, and on an
 * instance where every entity has been renamed to German, suffix matching
 * finds nothing at all.
 */
export interface DiscoveredVacuum {
  deviceId?: string;
  /** The dock, when the vacuum has one. A separate device — see below. */
  dockDeviceId?: string;
  map?: string;
  mopMode?: string;
  mopIntensity?: string;
  emptyMode?: string;
  selectedMap?: string;
  progress?: string;
  area?: string;
  time?: string;
  status?: string;
  currentRoom?: string;
  cleaningMode?: string;
  dockError?: string;
  vacuumError?: string;
  mopDryingRemaining?: string;
  lastCleanEnd?: string;
  /** Consumables, keyed by part. */
  consumables: Record<string, string>;
  /** The button that zeroes a part's counter, keyed by the same part. */
  resets: Record<string, string>;
  /** Dock and mop binary sensors, keyed by meaning. */
  binary: Record<string, string>;
  /** Dock switches, keyed by meaning. */
  switches: Record<string, string>;
  volume?: string;
  childLock?: string;
  dnd?: string;
  totals: Record<string, string>;
}

interface RegistryEntry {
  entity_id: string;
  device_id?: string | null;
  translation_key?: string | null;
  platform?: string | null;
}

/** `sensor.sushi_main_brush_time_left` → `main_brush_time_left`. */
function suffixOf(entityId: string): string {
  return entityId.slice(entityId.indexOf(".") + 1);
}

function matches(entry: RegistryEntry, keys: string[]): boolean {
  const tk = entry.translation_key ?? undefined;
  if (tk && keys.includes(tk)) return true;
  // Fallback: the entity_id ends with the key. Anchored at the end so that
  // `mop_mode` does not also match `mop_mode_something_else`.
  const suffix = suffixOf(entry.entity_id);
  return keys.some((k) => suffix === k || suffix.endsWith(`_${k}`));
}

// The keys below are the ones a Roborock S7 Pro Ultra actually reports,
// verified against a live instance rather than taken from the documentation.
// Several differ from the obvious guess — `dirty_box_full` rather than
// `dirty_water_box`, `dust_collection_mode` rather than `empty_mode`,
// `cleaning_brush_time_left` rather than `maintenance_brush_time_left` — so
// each list keeps the plausible alternatives for firmware that words them
// differently.
const CONSUMABLE_KEYS: Record<string, string[]> = {
  main_brush: ["main_brush_time_left", "main_brush_left", "main_brush"],
  side_brush: ["side_brush_time_left", "side_brush_left", "side_brush"],
  filter: ["filter_time_left", "filter_left", "filter"],
  sensor: ["sensor_time_left", "sensor_dirty_left", "sensor_left"],
  strainer: ["strainer_time_left", "strainer_left"],
  maintenance_brush: [
    "cleaning_brush_time_left",
    "maintenance_brush_time_left",
    "maintenance_brush_left",
  ],
};

// The buttons that zero a consumable's counter after the part has been
// changed. Home Assistant ships all of Roborock's **disabled**, so an instance
// where nobody has enabled them discovers none of these — which is not the
// same as the vendor having none, and the card says so rather than guessing.
//
// Unlike the sensor lists above, these were not read off a live device: the
// author's buttons are disabled. Each entry therefore leads with the key the
// integration declares and keeps the plausible spellings behind it.
const RESET_KEYS: Record<string, string[]> = {
  main_brush: ["reset_main_brush_consumable", "reset_main_brush", "main_brush_reset"],
  side_brush: ["reset_side_brush_consumable", "reset_side_brush", "side_brush_reset"],
  filter: [
    "reset_air_filter_consumable",
    "reset_filter_consumable",
    "reset_filter",
    "filter_reset",
  ],
  sensor: ["reset_sensor_consumable", "reset_sensor", "sensor_reset"],
  strainer: ["reset_strainer_consumable", "reset_strainer", "strainer_reset"],
  maintenance_brush: [
    "reset_cleaning_brush_consumable",
    "reset_maintenance_brush_consumable",
    "cleaning_brush_reset",
  ],
};

const BINARY_KEYS: Record<string, string[]> = {
  cleaning: ["in_cleaning", "cleaning"],
  mop_attached: ["mop_attached"],
  mop_drying: ["mop_drying_status", "mop_drying"],
  water_box_attached: ["water_box_attached"],
  water_shortage: ["water_shortage"],
  cleaning_fluid: ["cleaning_fluid", "cleaning_fluid_status"],
  clean_water_box: ["clean_box_empty", "clean_water_box"],
  dirty_water_box: ["dirty_box_full", "dirty_water_box"],
};

const SWITCH_KEYS: Record<string, string[]> = {
  dust_emptying: ["dust_emptying"],
  mop_washing: ["mop_washing"],
  mop_drying: ["mop_drying"],
  status_indicator: ["status_indicator_light", "status_indicator"],
};

const TOTAL_KEYS: Record<string, string[]> = {
  total_time: ["total_cleaning_time"],
  total_area: ["total_cleaning_area"],
  total_count: ["total_cleaning_count"],
};

/**
 * Collects every companion entity on the vacuum's own device.
 *
 * Diagnostic and config entities are kept on purpose — `deviceEntityIds` in
 * ha-registry.ts drops them, and for this device that would throw away nearly
 * everything the maintenance card exists to show.
 */
export function discoverVacuum(hass: HomeAssistant, vacuumEntityId: string): DiscoveredVacuum {
  const found: DiscoveredVacuum = {
    consumables: {},
    resets: {},
    binary: {},
    switches: {},
    totals: {},
  };
  const registry = hass.entities as unknown as Record<string, RegistryEntry> | undefined;
  if (!registry) return found;

  const own = registry[vacuumEntityId];
  const deviceId = own?.device_id ?? undefined;
  if (!deviceId) return found;
  found.deviceId = deviceId;

  // The dock is a *second* device, and not linked by `via_device` or
  // `parent_device` — both are null. What does link them is the identifier:
  // the vacuum is `roborock:<duid>` and its dock is `roborock:<duid>_dock`.
  // Without this half the card is missing: the water tanks, the dust
  // emptying and mop washing switches, the dock's own maintenance counters
  // and the dock error all live over there.
  const dockId = findDockDevice(hass, deviceId);
  found.dockDeviceId = dockId;

  const deviceIds = new Set([deviceId, dockId].filter(Boolean) as string[]);
  const siblings = Object.values(registry).filter(
    (e) => e.device_id && deviceIds.has(e.device_id) && hass.states[e.entity_id],
  );
  const inDomain = (domain: string) =>
    siblings.filter((e) => e.entity_id.startsWith(`${domain}.`));

  const pick = (domain: string, keys: string[]): string | undefined =>
    inDomain(domain).find((e) => matches(e, keys))?.entity_id;

  // The map is the only one taken by domain alone: Roborock names the image
  // entity after the *map* ("Downstairs"), so there is no stable key to match,
  // and a vacuum device has no other image entity to confuse it with.
  found.map = inDomain("image")[0]?.entity_id;

  found.mopMode = pick("select", ["mop_mode"]);
  found.mopIntensity = pick("select", ["mop_intensity"]);
  found.cleaningMode = pick("select", ["cleaning_mode"]);
  found.emptyMode = pick("select", ["dust_collection_mode", "empty_mode"]);
  found.selectedMap = pick("select", ["selected_map"]);

  found.progress = pick("sensor", ["cleaning_progress"]);
  found.area = pick("sensor", ["cleaning_area"]);
  found.time = pick("sensor", ["cleaning_time"]);
  found.status = pick("sensor", ["status"]);
  found.currentRoom = pick("sensor", ["current_room"]);
  found.dockError = pick("sensor", ["dock_error"]);
  found.vacuumError = pick("sensor", ["vacuum_error", "error"]);
  found.mopDryingRemaining = pick("sensor", ["mop_drying_remaining_time"]);
  found.lastCleanEnd = pick("sensor", ["last_clean_end"]);

  for (const [part, keys] of Object.entries(CONSUMABLE_KEYS)) {
    const hit = pick("sensor", keys);
    if (hit) found.consumables[part] = hit;
  }
  for (const [part, keys] of Object.entries(RESET_KEYS)) {
    const hit = pick("button", keys);
    if (hit) found.resets[part] = hit;
  }
  for (const [what, keys] of Object.entries(BINARY_KEYS)) {
    const hit = pick("binary_sensor", keys);
    if (hit) found.binary[what] = hit;
  }
  // The charging sensor carries no translation key at all, so it is matched
  // on its device class instead — the one thing about it that is declared.
  const charging = inDomain("binary_sensor").find(
    (e) => hass.states[e.entity_id]?.attributes?.device_class === "battery_charging",
  );
  if (charging) found.binary.charging = charging.entity_id;
  for (const [what, keys] of Object.entries(SWITCH_KEYS)) {
    const hit = pick("switch", keys);
    if (hit) found.switches[what] = hit;
  }
  for (const [what, keys] of Object.entries(TOTAL_KEYS)) {
    const hit = pick("sensor", keys);
    if (hit) found.totals[what] = hit;
  }

  found.volume = pick("number", ["volume"]);
  found.childLock = pick("switch", ["child_lock"]);
  found.dnd = pick("switch", ["dnd_switch", "do_not_disturb"]);

  return found;
}

// ---- error sensors ----------------------------------------------------------

/**
 * The states of an error sensor that mean nothing is wrong: Roborock writes
 * `none`, Valetudo the words `No error`. Exact strings, for an automation's
 * `not_to`; isVacuumError() compares loosely.
 */
export const VACUUM_NO_ERROR_STATES = ["ok", "none", "no_error", "No error"];

/** Whether an error sensor's state names an actual error. */
export function isVacuumError(state: string | undefined): boolean {
  if (!state || state === "unknown" || state === "unavailable") return false;
  const key = state.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return !["ok", "none", "no_error"].includes(key);
}

// ---- fan speed --------------------------------------------------------------

/**
 * Roborock's own speed names, lower-cased, so the card can look up a
 * translation. Anything else is shown as the integration wrote it.
 */
export const FAN_SPEED_KEYS = [
  "quiet",
  "silent",
  "balanced",
  "turbo",
  "max",
  "max_plus",
  "custom",
  "off",
] as const;

export function fanSpeedKey(value: string): string | undefined {
  const norm = value
    .toLowerCase()
    .trim()
    // Roborock writes its top speed as "max+" on some firmwares and
    // "max_plus" on others. Spelling the plus out first keeps both on the
    // same key — collapsing it like whitespace would strand "max+" as "max_".
    .replace(/\+/g, "_plus")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_");
  return (FAN_SPEED_KEYS as readonly string[]).includes(norm) ? norm : undefined;
}


/**
 * The dock that belongs to a vacuum, found by identifier.
 *
 * Roborock registers the dock as its own device with no `via_device` and no
 * `parent_device` — both are null — so the device tree says nothing about the
 * relationship. The identifier does: `roborock:<duid>` for the vacuum,
 * `roborock:<duid>_dock` for its dock. Matching the config entry instead would
 * be wrong as soon as an account holds two vacuums.
 */
export function findDockDevice(hass: HomeAssistant, vacuumDeviceId: string): string | undefined {
  const devices = hass.devices as unknown as
    | Record<string, { id?: string; identifiers?: [string, string][] }>
    | undefined;
  if (!devices) return undefined;
  const own = devices[vacuumDeviceId]?.identifiers ?? [];
  const duid = own.find(([domain]) => domain === "roborock")?.[1];
  if (!duid) return undefined;
  for (const [id, device] of Object.entries(devices)) {
    if (id === vacuumDeviceId) continue;
    const match = (device.identifiers ?? []).some(
      ([domain, value]) => domain === "roborock" && value === `${duid}_dock`,
    );
    if (match) return id;
  }
  return undefined;
}
