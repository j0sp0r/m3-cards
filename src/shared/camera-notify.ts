import type { CameraConfig, HomeAssistant } from "../types";
import { notifyActions, type NotifyAutomationSpec } from "./notify-editor";

// The camera card's notification: a push when the doorbell rings, and
// optionally when a person or a parcel is seen, with the camera's picture at
// that moment where the target can show one.
//
// One automation for the whole card. Which camera an event belongs to, and
// what kind it is, travels as a small Jinja dict written into the templates
// themselves, so the automation needs nothing from the card at run time and
// reads correctly in Home Assistant's own editor.

export type CameraNotifyKind = "ring" | "person" | "package";

export interface CameraNotifySource {
  /** The event.* or binary_sensor.* that fires. */
  entity: string;
  /** The camera whose picture goes with it, if there is one. */
  camera?: string;
  /** The camera's name as the card shows it. */
  name: string;
  kind: CameraNotifyKind;
}

/** Every doorbell, and with `detections` every person and parcel entity, of the card's cameras. */
export function cameraNotifySources(
  hass: HomeAssistant,
  cameras: CameraConfig[],
  detections: boolean,
): CameraNotifySource[] {
  const out: CameraNotifySource[] = [];
  const seen = new Set<string>();
  for (const cam of cameras) {
    const anchor = cam.camera ?? cam.doorbell;
    const name =
      cam.name ||
      (anchor ? (hass.states[anchor]?.attributes.friendly_name as string | undefined) : undefined) ||
      anchor ||
      "";
    const kinds: [CameraNotifyKind, string | undefined][] = [["ring", cam.doorbell]];
    if (detections) kinds.push(["person", cam.person], ["package", cam.package]);
    for (const [kind, entity] of kinds) {
      if (!entity || seen.has(entity) || !hass.states[entity]) continue;
      seen.add(entity);
      out.push({ entity, camera: cam.camera, name, kind });
    }
  }
  return out;
}

export interface CameraNotifyTexts {
  /** Built-in messages; the camera's name is the title. `{kamera}` stands for it here too. */
  ring: string;
  person: string;
  package: string;
  /** The kind as a word, for the `{ereignis}` placeholder. */
  words: Record<CameraNotifyKind, string>;
}

export interface CameraNotifyOptions {
  id: string;
  alias: string;
  description: string;
  sources: CameraNotifySource[];
  targets: string[];
  texts: CameraNotifyTexts;
  /** Minutes between two detection messages; a ring always gets through. */
  cooldownMinutes: number;
  /** The camera's picture in the push, for the companion app. */
  snapshot: boolean;
  customTitle?: string;
  customMessage?: string;
}

const jinjaString = (s: string) => JSON.stringify(s);

export function buildCameraNotifyAutomation(o: CameraNotifyOptions): NotifyAutomationSpec {
  // entity → [name, camera, kind, word]; JSON of strings is a valid Jinja literal.
  const table: Record<string, [string, string, CameraNotifyKind, string]> = {};
  for (const s of o.sources) table[s.entity] = [s.name, s.camera ?? "", s.kind, o.texts.words[s.kind]];
  const dict = JSON.stringify(table);
  const first = o.sources[0]?.entity ?? "";
  // A hand-run from the automation menu has no trigger: it shows the first
  // source, so the test message reads like the real one.
  const prelude =
    `{% set m3 = ${dict} %}` +
    `{% set src = m3[trigger.entity_id] if trigger is defined and trigger.entity_id is defined and trigger.entity_id in m3 else m3[${jinjaString(first)}] %}`;
  const byKind = (kind: CameraNotifyKind) => o.texts[kind].replace(/\{kamera\}/g, "{{ src[0] }}");
  const message =
    `{% if src[2] == 'ring' %}${byKind("ring")}` +
    `{% elif src[2] == 'person' %}${byKind("person")}` +
    `{% else %}${byKind("package")}{% endif %}`;

  const events = o.sources.filter((s) => s.entity.startsWith("event.")).map((s) => s.entity);
  const binaries = o.sources.filter((s) => !s.entity.startsWith("event.")).map((s) => s.entity);
  const triggers: Record<string, unknown>[] = [];
  if (events.length) triggers.push({ trigger: "state", entity_id: events, id: "event" });
  if (binaries.length) triggers.push({ trigger: "state", entity_id: binaries, to: "on", id: "binary" });

  // The title is the camera's name, so it needs the lookup too.
  const actions = notifyActions(o.targets, `${prelude}{{ src[0] }}`, message, {
    title: o.customTitle,
    message: o.customMessage,
    prelude,
    tokens: { kamera: "{{ src[0] }}", ereignis: "{{ src[3] }}" },
  });
  const anyCamera = o.sources.some((s) => s.camera);
  if (o.snapshot && anyCamera) {
    // The companion app fetches the picture itself, signed in, when the push
    // arrives: the frame from the moment it rang. Other targets get no image
    // field, which some of them would reject.
    for (const a of actions) {
      if (!String(a.action).startsWith("notify.mobile_app_")) continue;
      const data = a.data as Record<string, unknown>;
      data.data = { image: `${prelude}{{ '/api/camera_proxy/' ~ src[1] if src[1] else '' }}` };
    }
  }

  const cooldown = Math.max(0, Math.round(o.cooldownMinutes * 60));
  return {
    id: o.id,
    alias: o.alias,
    description: o.description,
    // Two cameras at once both get their message.
    mode: "queued",
    triggers,
    conditions: [
      {
        // A restart (no old state) or an integration coming back
        // (unavailable) replays the last event; neither is someone at the
        // door. An event entity that never fired before reads "unknown", and
        // its first ring is real. A binary sensor only counts off → on.
        condition: "template",
        value_template:
          "{{ trigger.from_state is not none" +
          " and trigger.to_state.state not in ['unknown', 'unavailable']" +
          " and trigger.from_state.state != 'unavailable'" +
          " and (trigger.id != 'binary' or trigger.from_state.state == 'off') }}",
      },
      {
        // Detections wait out the cooldown since the last message; a ring
        // never waits.
        condition: "template",
        value_template:
          `{% set m3 = ${dict} %}` +
          `{{ m3[trigger.entity_id][2] == 'ring' or this.attributes.last_triggered is none` +
          ` or (now() - this.attributes.last_triggered).total_seconds() > ${cooldown} }}`,
      },
    ],
    actions,
  };
}
