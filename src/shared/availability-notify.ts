// The availability card's notification: a Home Assistant automation that
// says when a device has been unreachable for a while, and optionally when it
// is back. The card decides in the browser which entities speak for a device
// (its own integration, no helpers, no buttons); the automation cannot run
// that logic, so the editor writes the outcome into it — one entry per
// device with the entities that decide — and the automation only checks
// states against it. A device added later needs the notification set up
// again, as the editor says.
//
// One message per device: every deciding entity triggers, but only the
// trigger of the entity that went last, once all of them are unavailable,
// gets through. Coming back works the other way round: the first entity
// back, and only after an outage at least as long as the delay.

import type { WatchedUnit } from "./availability";
import { applyNotifyTemplate } from "./notify-editor";

export interface AvailabilityNotifyInput {
  units: WatchedUnit[];
  /** Device keys left out, e.g. those muted for good. */
  skip?: Set<string>;
  /** Minutes a device must be gone before it is reported. */
  minutes: number;
  /** Also report when a device is back. */
  back: boolean;
  texts: {
    /** Default offline text; may use {geraet} and {minuten}. */
    offline: string;
    /** Default back text; may use {geraet}. */
    back: string;
    /** The user's own offline text, if any. */
    customOffline?: string;
  };
}

export interface AvailabilityNotifyParts {
  variables: Record<string, string>;
  triggers: Record<string, unknown>[];
  conditions: Record<string, unknown>[];
  /** The message, Jinja, for both cases. */
  message: string;
  /** How many devices and entities the automation watches. */
  devices: number;
  entities: number;
}

/** Names go into Jinja literals: braces and quotes would end them early. */
const safeName = (name: string): string => name.replace(/[{}%]/g, "").replace(/"/g, "'");

export function availabilityNotifyParts(input: AvailabilityNotifyInput): AvailabilityNotifyParts {
  const minutes = Math.max(1, Math.round(input.minutes || 0));
  const units = input.units.filter((u) => !input.skip?.has(u.key) && u.entities.length > 0);
  const table: Record<string, { n: string; e: string[] }> = {};
  const owner: Record<string, string> = {};
  units.forEach((u, i) => {
    const k = `u${i}`;
    table[k] = { n: safeName(u.name), e: u.entities };
    for (const id of u.entities) owner[id] = k;
  });
  const watched = Object.keys(owner);
  const sample = watched[0] ?? "";

  const variables: Record<string, string> = {
    minutes: String(minutes),
    units: `{{ ${JSON.stringify(table)} }}`,
    owner: `{{ ${JSON.stringify(owner)} }}`,
    // A hand-run ("Run" in the automation's menu) has no trigger: it then
    // speaks for the first device, so the test message renders.
    ent: `{{ trigger.entity_id if trigger is defined and trigger.entity_id is defined else '${sample}' }}`,
    back: "{{ trigger is defined and trigger.id is defined and trigger.id == 'back' }}",
    unit: "{{ units[owner[ent]] if ent in owner else {'n': ent, 'e': [ent]} }}",
  };

  const triggers: Record<string, unknown>[] = [
    { trigger: "state", entity_id: watched, to: "unavailable", for: { minutes }, id: "off" },
  ];
  if (input.back) {
    triggers.push({
      trigger: "state",
      entity_id: watched,
      from: "unavailable",
      not_to: ["unavailable", "unknown"],
      for: { minutes: 1 },
      id: "back",
    });
  }

  const offlineCheck =
    "{% set all = expand(unit.e) %}" +
    "{{ all | rejectattr('state', 'eq', 'unavailable') | list | count == 0" +
    " and (all | sort(attribute='last_changed') | last).entity_id == ent }}";
  const backCheck =
    "{% set up = expand(unit.e) | rejectattr('state', 'eq', 'unavailable') | sort(attribute='last_changed') | list %}" +
    "{{ up | count > 0 and up[0].entity_id == ent" +
    " and (trigger.to_state.last_changed - trigger.from_state.last_changed).total_seconds() >= (minutes | int) * 60 }}";
  const conditions = [
    { condition: "template", value_template: `{% if back %}${backCheck}{% else %}${offlineCheck}{% endif %}` },
  ];

  const tokens = { geraet: "{{ unit.n }}", minuten: "{{ minutes }}" };
  const offline = applyNotifyTemplate(input.texts.customOffline, input.texts.offline, tokens).replace(
    /\{(geraet|minuten)\}/g,
    (_, k: string) => tokens[k as keyof typeof tokens],
  );
  const backText = input.texts.back.replace(/\{geraet\}/g, tokens.geraet);
  const message = input.back ? `{% if back %}${backText}{% else %}${offline}{% endif %}` : offline;

  return { variables, triggers, conditions, message, devices: units.length, entities: watched.length };
}
