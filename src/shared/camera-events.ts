// Events on the camera card: rings, people, parcels, motion.
//
// Two kinds of entity carry them. An `event.*` entity's state is the time of
// its last event, with the kind in `event_type` ("ding", "motion", …); every
// new timestamp is an event. A `binary_sensor.*` is on while something
// happens; every change to "on" is an event. The role an entity has in the
// config (doorbell, person, package, motion) names the kind, unless its
// `event_type` says more precisely.

import type { CameraConfig } from "../types";

export type CameraEventKind = "ring" | "door" | "person" | "package" | "motion" | "other";

export interface CameraEvent {
  entity: string;
  kind: CameraEventKind;
  /** When it happened, epoch ms. */
  at: number;
  eventType?: string;
  /** An integration's id for the event (Frigate's `event_id`), for a snapshot URL. */
  id?: string;
}

/** One row of history/history_during_period in its compressed form. */
export interface HistoryRow {
  s: string;
  a?: Record<string, unknown>;
  /** last_updated / last_changed, epoch seconds. */
  lu?: number;
  lc?: number;
}

export interface StateLike {
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: string;
}

const KIND_WORDS: Array<[CameraEventKind, RegExp]> = [
  // An intercom's "intercom_unlock": the door was opened.
  ["door", /\b(unlock|unlocked|opened|door open|open door)\b/i],
  ["ring", /\b(ding|ring|ringing|doorbell|press|pressed|button)\b/i],
  ["package", /\b(package|parcel|delivery)\b/i],
  ["person", /\b(person|people|face|human)\b/i],
  ["motion", /\b(motion|movement|moving|vehicle|animal|car|dog|cat)\b/i],
];

function roleOf(cam: CameraConfig, entity: string): CameraEventKind {
  if (entity === cam.doorbell) return "ring";
  if (entity === cam.person) return "person";
  if (entity === cam.package) return "package";
  if (entity === cam.motion) return "motion";
  return "other";
}

/** The kind of an event: its `event_type` if that says, else the entity's role. */
export function kindOf(cam: CameraConfig, entity: string, eventType?: string): CameraEventKind {
  const role = roleOf(cam, entity);
  // A doorbell's own entity rings, whatever word its integration uses.
  if (role === "ring") return "ring";
  if (eventType) {
    const words = eventType.replace(/[_-]/g, " ");
    for (const [kind, re] of KIND_WORDS) if (re.test(words)) return kind;
  }
  return role;
}

const isEventEntity = (id: string) => id.startsWith("event.");
const dead = (s: string) => s === "unavailable" || s === "unknown" || s === "";

function idFrom(attrs: Record<string, unknown> | undefined): string | undefined {
  const raw = attrs?.event_id ?? attrs?.id;
  return typeof raw === "string" || typeof raw === "number" ? String(raw) : undefined;
}

/** Every event in one entity's history since `startMs`, oldest first. */
export function eventsFromHistory(cam: CameraConfig, entity: string, rows: readonly HistoryRow[], startMs: number): CameraEvent[] {
  const out: CameraEvent[] = [];
  let prevState: string | undefined;
  for (const row of rows) {
    if (isEventEntity(entity)) {
      // The first row is the state at the start of the window: its event
      // happened before, and its time says so.
      const at = Date.parse(row.s);
      if (!dead(row.s) && !isNaN(at) && at >= startMs && row.s !== prevState) {
        const eventType = typeof row.a?.event_type === "string" ? row.a.event_type : undefined;
        out.push({ entity, kind: kindOf(cam, entity, eventType), at, eventType, id: idFrom(row.a) });
      }
    } else if (row.s === "on" && prevState !== "on") {
      const at = ((row.lc ?? row.lu) ?? 0) * 1000;
      if (at >= startMs) out.push({ entity, kind: kindOf(cam, entity), at });
    }
    prevState = row.s;
  }
  return out;
}

/**
 * The event a state change brings, if any: a new timestamp on an `event.*`,
 * a binary sensor turning on. Used to add to the timeline without asking the
 * history again.
 */
export function eventFromChange(cam: CameraConfig, entity: string, before: StateLike | undefined, after: StateLike | undefined): CameraEvent | undefined {
  if (!after || dead(after.state) || before?.state === after.state) return undefined;
  if (isEventEntity(entity)) {
    const at = Date.parse(after.state);
    if (isNaN(at)) return undefined;
    const eventType = typeof after.attributes.event_type === "string" ? after.attributes.event_type : undefined;
    return { entity, kind: kindOf(cam, entity, eventType), at, eventType, id: idFrom(after.attributes) };
  }
  if (after.state !== "on") return undefined;
  const at = after.last_changed ? Date.parse(after.last_changed) : Date.now();
  return { entity, kind: kindOf(cam, entity), at: isNaN(at) ? Date.now() : at };
}

/** Newest first, each event once, none older than `startMs`. */
export function mergeEvents(a: readonly CameraEvent[], b: readonly CameraEvent[], startMs = 0): CameraEvent[] {
  const seen = new Set<string>();
  const out: CameraEvent[] = [];
  for (const e of [...a, ...b].sort((x, y) => y.at - x.at)) {
    const key = `${e.entity}|${e.at}`;
    if (e.at < startMs || seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/** When the doorbell last rang, epoch ms — from the live state, not the history. */
export function lastRingAt(cam: CameraConfig, states: Record<string, StateLike | undefined>): number | undefined {
  if (!cam.doorbell) return undefined;
  const st = states[cam.doorbell];
  if (!st || dead(st.state)) return undefined;
  if (isEventEntity(cam.doorbell)) {
    const at = Date.parse(st.state);
    return isNaN(at) ? undefined : at;
  }
  // A doorbell binary sensor is on for a moment per ring; its last change is
  // the ring (or the end of it, a second later).
  if (!st.last_changed) return undefined;
  const at = Date.parse(st.last_changed);
  return isNaN(at) ? undefined : at;
}

/**
 * What the camera sees right now, the strongest first: a person, a parcel,
 * motion. A binary sensor counts while it is on; an event entity for
 * `windowMs` after its event.
 */
export function currentDetection(
  cam: CameraConfig,
  states: Record<string, StateLike | undefined>,
  now: number,
  windowMs: number,
): { kind: CameraEventKind; at: number } | undefined {
  const roles: Array<[CameraEventKind, string | undefined]> = [
    ["person", cam.person],
    ["package", cam.package],
    ["motion", cam.motion],
  ];
  for (const [kind, entity] of roles) {
    if (!entity) continue;
    const st = states[entity];
    if (!st || dead(st.state)) continue;
    if (isEventEntity(entity)) {
      const at = Date.parse(st.state);
      if (!isNaN(at) && now - at < windowMs) return { kind, at };
    } else if (st.state === "on") {
      const at = st.last_changed ? Date.parse(st.last_changed) : now;
      return { kind, at: isNaN(at) ? now : at };
    }
  }
  return undefined;
}

/** Fills a snapshot or clip URL template for one event. */
export function fillEventTemplate(template: string, cam: CameraConfig, event: CameraEvent): string | undefined {
  if (/\{id\}/.test(template) && !event.id) return undefined;
  const values: Record<string, string> = {
    camera: (cam.camera ?? cam.doorbell ?? "").replace(/^[a-z_]+\./, ""),
    entity: event.entity,
    event_type: event.eventType ?? event.kind,
    timestamp: String(Math.floor(event.at / 1000)),
    id: event.id ?? "",
  };
  return template.replace(/\{(camera|entity|event_type|timestamp|id)\}/g, (_, k: string) => encodeURIComponent(values[k]));
}
