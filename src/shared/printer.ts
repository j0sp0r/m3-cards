import type { HomeAssistant, PrinterStateMap } from "../types";
import { PALETTE } from "./tokens";

// What a 3D printer's state *means*, and which of a device's entities belong
// to which block.
//
// WHY THE MAPPING IS CONFIGURABLE AND THE DEFAULTS ARE ONLY DEFAULTS
//
// Every integration words this differently. Bambu Lab reports a "stage" with
// dozens of values ("printing", "paused", "heatbed_preheating", "idle"),
// OctoPrint reports "Printing"/"Operational", Moonraker reports Klipper's
// "printing"/"complete"/"standby", Prusa Connect something else again. There
// is no set of strings that covers all four, so `state_map` in the card config
// always wins and the table below is what the card falls back to.
//
// The consequence for the code: never test a raw string anywhere but here.

export type PrinterState =
  | "printing"
  | "paused"
  | "idle"
  | "finished"
  | "error"
  | "offline";

const PRINTER_STATES: PrinterState[] = [
  "printing",
  "paused",
  "idle",
  "finished",
  "error",
  "offline",
];

/**
 * Raw status values seen in the wild, lower-cased, mapped onto the six states.
 *
 * Ordered longest-prefix-first is not needed because matching is exact; a
 * value that is not here falls through to the substring rules in
 * `resolvePrinterState`, which is what keeps a vendor's forty stage names from
 * having to be listed one by one.
 */
export const DEFAULT_PRINTER_STATE_MAP: Readonly<Record<string, PrinterState>> = {
  // Bambu Lab (ha-bambulab)
  printing: "printing",
  running: "printing",
  prepare: "printing",
  slicing: "printing",
  paused: "paused",
  pause: "paused",
  idle: "idle",
  // Listed although the fallback below reads it as idle anyway: the
  // notification automation only knows the values in this table.
  init: "idle",
  standby: "idle",
  finish: "finished",
  finished: "finished",
  complete: "finished",
  completed: "finished",
  success: "finished",
  failed: "error",
  error: "error",
  offline: "offline",
  unavailable: "offline",
  unknown: "offline",
  // OctoPrint
  operational: "idle",
  cancelling: "printing",
  // Moonraker / Klipper
  ready: "idle",
  shutdown: "offline",
  startup: "offline",
};

/**
 * Turns a raw status into one of the six states.
 *
 * Three passes, in order: the user's own map, the table above, then substring
 * rules. The last one exists because Bambu's stage entity reports things like
 * `heatbed_preheating` and `filament_loading` — dozens of values that all mean
 * "the printer is working on a job", and listing them would guarantee missing
 * one on the next firmware.
 */
export function resolvePrinterState(
  raw: string | undefined,
  stateMap?: PrinterStateMap,
): PrinterState {
  if (!raw) return "offline";
  const key = raw.toLowerCase().trim();

  const configured = stateMap?.[key] ?? stateMap?.[raw];
  if (configured && PRINTER_STATES.includes(configured)) return configured;

  const known = DEFAULT_PRINTER_STATE_MAP[key];
  if (known) return known;

  if (key.includes("pause")) return "paused";
  if (key.includes("error") || key.includes("fail")) return "error";
  if (key.includes("offline") || key.includes("disconnect")) return "offline";
  if (key.includes("finish") || key.includes("complete")) return "finished";
  // Anything still unrecognised while a job is clearly under way — preheating,
  // loading filament, cleaning the nozzle — is the printer working.
  if (
    key.includes("print") ||
    key.includes("heat") ||
    key.includes("load") ||
    key.includes("clean") ||
    key.includes("level") ||
    key.includes("calibrat")
  ) {
    return "printing";
  }
  // A state nobody recognises is not an error. Idle is the safe reading: it
  // shows the card without painting a red frame around a healthy machine.
  return "idle";
}

/** The accent each state paints with, from the suite's palette. */
export function printerStateColor(state: PrinterState): string {
  switch (state) {
    case "printing":
      return PALETTE.home;
    case "finished":
    case "idle":
      return PALETTE.ok;
    case "paused":
      return PALETTE.solar;
    case "error":
      return PALETTE.heat;
    default:
      return PALETTE.off;
  }
}

export function printerStateIcon(state: PrinterState): string {
  switch (state) {
    case "printing":
      return "mdi:printer-3d-nozzle";
    case "paused":
      return "mdi:pause";
    case "finished":
      return "mdi:check-circle-outline";
    case "error":
      return "mdi:alert-circle-outline";
    case "offline":
      return "mdi:power-plug-off-outline";
    default:
      return "mdi:printer-3d";
  }
}

/** Whether a job is under way, which is what most blocks key off. */
export function isRunning(state: PrinterState): boolean {
  return state === "printing" || state === "paused";
}

/** What a tap on the primary button should do, given the state. */
export type PrinterIntent = "pause" | "resume" | "start" | "confirm" | "none";

/**
 * `canStart` is not a detail, and it defaults to false on purpose.
 *
 * Nobody starts a print from Home Assistant. A job is sliced, sent to the
 * machine and started at the machine or in the slicer; a dashboard has no file
 * to print and no way to pick one. The button was here because the state table
 * looked symmetrical with it — every other state had a primary action, so idle
 * got one too — which is a reason to draw a diagram, not a button.
 *
 * So idle and finished have no primary action unless a `start_action` says what
 * starting would even mean (a printer with a queue integration, a Klipper macro).
 * Without one the control row is its secondary buttons alone, which is the
 * honest shape: there is nothing to press.
 */
export function primaryIntent(state: PrinterState, canStart = false): PrinterIntent {
  switch (state) {
    case "printing":
      return "pause";
    case "paused":
      return "resume";
    case "idle":
    case "finished":
      return canStart ? "start" : "none";
    case "error":
      // Acknowledging is the only thing that helps, and it is the one the
      // vendor's own app offers here too.
      return "confirm";
    default:
      // Offline: the printer cannot be told anything. The socket switch in the
      // details block is the way back, and that stays live — see the card.
      return "none";
  }
}

export function optimisticPrinterState(
  intent: PrinterIntent,
  current: PrinterState,
): PrinterState {
  switch (intent) {
    case "pause":
      return "paused";
    case "resume":
    case "start":
      return "printing";
    default:
      return current;
  }
}

// ---- discovery --------------------------------------------------------------

/**
 * A printer's companion entities.
 *
 * Matched on the registry's `translation_key` first, the entity_id suffix
 * second, and a device class third. Three passes rather than one because
 * integrations differ in which of them they bother to set: Bambu Lab assigns
 * translation keys, OctoPrint largely does not, and a renamed entity keeps
 * neither its original id nor a key it never had.
 */
export interface DiscoveredPrinter {
  deviceId?: string;
  camera?: string;
  progress?: string;
  remaining?: string;
  layer?: string;
  totalLayers?: string;
  jobName?: string;
  stage?: string;
  nozzleTemp?: string;
  nozzleTarget?: string;
  bedTemp?: string;
  bedTarget?: string;
  chamberTemp?: string;
  speed?: string;
  /** Read-only profile, for when the select exists but is unavailable. */
  speedState?: string;
  startTime?: string;
  endTime?: string;
  power?: string;
  online?: string;
  error?: string;
  light?: string;
  /** `button` entities that pause, resume and stop a job, when the integration has them. */
  pauseButton?: string;
  resumeButton?: string;
  stopButton?: string;
  /** AMS trays, in slot order, each with whatever it exposes. */
  amsSlots: { type?: string; color?: string; remaining?: string; entity?: string }[];
}

interface RegistryEntry {
  entity_id: string;
  device_id?: string | null;
  translation_key?: string | null;
  platform?: string | null;
}

function suffixOf(entityId: string): string {
  return entityId.slice(entityId.indexOf(".") + 1);
}

/**
 * Whether one registry entry answers to one key.
 *
 * `reject` is what keeps a target temperature from being read as a current
 * one. `sensor.x_target_nozzle_temperature` ends with `_nozzle_temperature`,
 * so the suffix pass matches it for `nozzleTemp` — and whichever of the two
 * the registry happened to list first would win. The words are listed in
 * English and German because entity ids are localised at creation time: a
 * German install names Bambu's pair `temperatur_der_duse` and
 * `zieltemperatur_der_duse`, and only the translation key is language-free.
 */
function matchesKey(entry: RegistryEntry, key: string, reject?: readonly string[]): boolean {
  const tk = entry.translation_key ?? undefined;
  const suffix = suffixOf(entry.entity_id);
  if (reject?.some((word) => tk?.includes(word) || suffix.includes(word))) return false;
  if (tk === key) return true;
  return suffix === key || suffix.endsWith(`_${key}`);
}

interface SensorSpec {
  /** Tried in order, so the first is the best answer and the rest are fallbacks. */
  keys: string[];
  reject?: string[];
}

const NOT_A_TARGET = ["target", "ziel", "soll", "consigne", "objetivo"];

const SENSOR_KEYS: Record<string, SensorSpec> = {
  progress: { keys: ["print_progress", "progress", "job_percentage", "percent_complete"] },
  remaining: { keys: ["remaining_time", "time_remaining", "print_time_left", "remaining"] },
  layer: { keys: ["current_layer", "layer_number", "current_layer_number", "layer"] },
  totalLayers: { keys: ["total_layer_count", "total_layers", "layer_count"] },
  // Bambu splits these: `subtask_name` is what the user called the job,
  // `gcode_file` is the file it came from. The name reads better on a header,
  // so it is asked for first and the filename is the fallback.
  jobName: {
    keys: [
      "subtask_name",
      "task_name",
      "print_job_name",
      "job_name",
      "current_file",
      "filename",
      "gcode_file",
      "gcode_filename",
    ],
  },
  stage: { keys: ["current_stage", "stage", "print_status", "printer_state", "current_state"] },
  nozzleTemp: {
    keys: ["nozzle_temperature", "nozzle_temp", "tool0_temperature", "extruder_temperature"],
    reject: NOT_A_TARGET,
  },
  nozzleTarget: {
    keys: [
      "target_nozzle_temp",
      "target_nozzle_temperature",
      "nozzle_target_temperature",
      "nozzle_target",
      "tool0_target",
    ],
  },
  bedTemp: {
    keys: ["bed_temperature", "bed_temp", "heater_bed_temperature"],
    reject: NOT_A_TARGET,
  },
  bedTarget: {
    keys: ["target_bed_temp", "target_bed_temperature", "bed_target_temperature", "bed_target"],
  },
  chamberTemp: { keys: ["chamber_temperature", "chamber_temp"], reject: NOT_A_TARGET },
  startTime: { keys: ["start_time", "print_start_time"] },
  endTime: { keys: ["end_time", "estimated_end_time", "finish_time", "print_end_time"] },
  power: { keys: ["power", "current_power"] },
};

/**
 * The camera, which is not simply "the first image entity on the device".
 *
 * Bambu registers three things that look like one: `camera` (the chamber),
 * `cover_image` (the model's thumbnail) and `pick_image` (the build-plate
 * scan). Taking whichever came first showed the thumbnail as the chamber view,
 * which is wrong in the most convincing possible way — it is a picture of the
 * right object.
 */
const CAMERA_KEYS = ["camera", "chamber_camera", "chamber_image", "camera_image", "webcam"];

/**
 * Collects a printer's companion entities.
 *
 * Diagnostic and config entities are kept on purpose: on a Bambu printer the
 * temperatures, the stage and most of the AMS live in those categories, and
 * dropping them would leave the card with a name and nothing else.
 */
export function discoverPrinter(hass: HomeAssistant, entityId: string): DiscoveredPrinter {
  const found: DiscoveredPrinter = { amsSlots: [] };
  const registry = hass.entities as unknown as Record<string, RegistryEntry> | undefined;
  if (!registry) return found;

  const own = registry[entityId];
  const deviceId = own?.device_id ?? undefined;
  if (!deviceId) return found;
  found.deviceId = deviceId;

  // A Bambu printer registers its AMS units as their own devices, the way the
  // vacuum's dock does — so siblings are gathered from the printer's device
  // and from anything the same integration registered alongside it.
  const devices = hass.devices as unknown as
    | Record<string, { via_device_id?: string | null; id?: string }>
    | undefined;
  const related = new Set<string>([deviceId]);
  for (const [id, device] of Object.entries(devices ?? {})) {
    if (device.via_device_id === deviceId) related.add(id);
  }

  const siblings = Object.values(registry).filter(
    (e) => e.device_id && related.has(e.device_id) && hass.states[e.entity_id],
  );
  const inDomain = (domain: string) => siblings.filter((e) => e.entity_id.startsWith(`${domain}.`));
  // Key order is priority order, so the loop is over the keys and not over the
  // entities: otherwise the answer depends on what the registry happened to
  // list first, which is not something a card should be deciding by.
  const pick = (domain: string, keys: string[], reject?: string[]): string | undefined => {
    const pool = inDomain(domain);
    for (const key of keys) {
      const hit = pool.find((e) => matchesKey(e, key, reject));
      if (hit) return hit.entity_id;
    }
    return undefined;
  };

  for (const [field, spec] of Object.entries(SENSOR_KEYS)) {
    const hit = pick("sensor", spec.keys, spec.reject);
    if (hit) (found as unknown as Record<string, unknown>)[field] = hit;
  }

  // Temperatures are worth a second pass on device class: OctoPrint names them
  // nothing recognisable, but it does declare what they are.
  if (!found.nozzleTemp || !found.bedTemp) {
    const temps = inDomain("sensor").filter(
      (e) => hass.states[e.entity_id]?.attributes?.device_class === "temperature",
    );
    const byWord = (words: string[]) =>
      temps.find((e) => words.some((w) => e.entity_id.toLowerCase().includes(w)))?.entity_id;
    found.nozzleTemp ??= byWord(["nozzle", "tool", "extruder", "hotend"]);
    found.bedTemp ??= byWord(["bed"]);
    found.chamberTemp ??= byWord(["chamber"]);
  }

  // The camera may be either domain; `image` is preferred because it is a
  // still the browser can cache, and a stream costs the printer bandwidth it
  // would rather spend on the job. A camera entity that names itself nothing
  // recognisable is still a camera, so the domain carries the last pass —
  // but an unrecognised *image* entity is not, and gets no such benefit.
  found.camera =
    pick("image", CAMERA_KEYS) ?? pick("camera", CAMERA_KEYS) ?? inDomain("camera")[0]?.entity_id;

  found.speed = pick("select", ["printing_speed", "speed_profile", "print_speed", "speed"]);
  // Bambu offers both: a `select` that only works in some connection modes and
  // a sensor that always reports the profile. On a P1S over hybrid MQTT the
  // select sits at `unavailable` while the printer is quite happily printing in
  // Standard, so the sensor is what the row should be reading.
  found.speedState = pick("sensor", ["speed_profile", "printing_speed", "print_speed"]);
  found.light =
    pick("light", ["chamber_light", "light"]) ?? pick("switch", ["chamber_light", "light"]);
  // The job controls, as the button entities the integration publishes, so a
  // card with no actions configured still pauses and stops something.
  //
  // `stop` has to reject more than the other two. Moonraker exposes an
  // `emergency_stop` button — it halts the firmware, drops the heaters and needs
  // a restart to recover from — and the suffix pass would take it for "stop" on
  // the strength of its last word. A stop dialog that confirms a print
  // cancellation and then kills the printer is the worst thing this card could
  // do, so anything that sounds like a firmware or host action is out.
  found.pauseButton = pick("button", ["pause", "pause_job", "pause_print"]);
  found.resumeButton = pick("button", ["resume", "resume_job", "resume_print"]);
  found.stopButton = pick(
    "button",
    ["stop", "stop_job", "stop_print", "cancel_job", "cancel_print"],
    ["emergency", "estop", "e_stop", "firmware", "restart", "reboot", "shutdown", "not_aus", "nothalt"],
  );
  found.online = pick("binary_sensor", ["online", "connected"]);
  found.error =
    pick("binary_sensor", ["print_error", "hms_errors", "error"]) ??
    pick("sensor", ["print_error", "error"]);

  found.amsSlots = discoverAmsSlots(siblings);
  return found;
}

/**
 * One tray, read from whatever the integration offers.
 *
 * Bambu does not publish a tray as three entities. It publishes *one* sensor
 * per slot whose state is the spool's full product name and whose attributes
 * carry everything else — `type`, `color`, `remain`, `empty`. So a card that
 * only knows how to read three separate entities finds none of them and draws
 * four empty trays on a printer with four full ones, which is what it did.
 *
 * Dedicated entities still win where they exist (a user override, or an
 * integration that does split them); the attributes are the fallback.
 */
export interface AmsTray {
  material?: string;
  color?: string;
  remaining?: number;
  empty: boolean;
}

const AMS_MATERIAL_ATTRS = ["type", "material", "filament_type"];
const AMS_COLOR_ATTRS = ["color", "colour", "filament_color"];
const AMS_REMAIN_ATTRS = ["remain", "remaining", "remaining_percent", "level"];

/** State strings that mean "nothing loaded" rather than a material name. */
const AMS_BLANK = ["", "empty", "unknown", "unavailable", "none", "-", "leer"];

function attr(
  attributes: Record<string, unknown> | undefined,
  names: readonly string[],
): string | undefined {
  for (const name of names) {
    const value = attributes?.[name];
    if (value === undefined || value === null || value === "") continue;
    return String(value);
  }
  return undefined;
}

export function resolveAmsTray(params: {
  /** The slot's own entity, when it has one. */
  state?: { state: string; attributes?: Record<string, unknown> };
  /** Values already read from dedicated entities; these win. */
  material?: string;
  color?: string;
  remaining?: number;
}): AmsTray {
  const attributes = params.state?.attributes;
  const material = params.material ?? attr(attributes, AMS_MATERIAL_ATTRS) ?? params.state?.state;
  const color = params.color ?? attr(attributes, AMS_COLOR_ATTRS);

  let remaining = params.remaining;
  if (remaining === undefined) {
    const raw = Number(attr(attributes, AMS_REMAIN_ATTRS));
    // Bambu reports -1 for a spool that cannot report how much is left, which
    // as a bar would read as "empty" rather than "unknown".
    if (Number.isFinite(raw) && raw >= 0) remaining = raw;
  }

  const blank = !material || AMS_BLANK.includes(material.toLowerCase().trim());
  const empty = attributes?.empty === true || blank;
  return { material: blank ? undefined : material, color, remaining, empty };
}

/**
 * AMS trays, in slot order.
 *
 * Bambu names them `..._tray_1` through `_tray_4` (or `slot_`), so the number
 * in the id is the ordering key rather than the order the registry happened to
 * return them in — a grid that reshuffles between renders is unreadable.
 */
function discoverAmsSlots(siblings: RegistryEntry[]): DiscoveredPrinter["amsSlots"] {
  const bySlot = new Map<string, { type?: string; color?: string; remaining?: string; entity?: string }>();
  for (const entry of siblings) {
    const id = entry.entity_id;
    const slot = /(?:tray|slot)[_ ]?(\d+)/i.exec(id)?.[1];
    if (!slot) continue;
    // A second AMS repeats slots 1–4, so the unit number is part of the key.
    // Without it the two units' trays merge into one row of four and half the
    // filament in the machine is simply not on the card.
    const unit = /ams[_ ]?(\d+)/i.exec(id)?.[1] ?? "0";
    const key = `${unit.padStart(3, "0")}-${slot.padStart(3, "0")}`;
    const existing = bySlot.get(key) ?? {};
    existing.entity ??= id;
    const lower = id.toLowerCase();
    if (lower.includes("type") || lower.includes("material") || lower.includes("filament")) {
      existing.type ??= id;
    }
    if (lower.includes("color") || lower.includes("colour")) existing.color ??= id;
    if (lower.includes("remain") || lower.includes("level")) existing.remaining ??= id;
    bySlot.set(key, existing);
  }
  return [...bySlot.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, value]) => value);
}
