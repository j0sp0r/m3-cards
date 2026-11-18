// The tariff card's notification (#56): a Home Assistant automation that
// says when a tariff begins — "Off-peak from now, 0.18 €/kWh, until 06:00" —
// and, with a schedule, optionally a few minutes before. With a schedule the
// automation runs on the schedule's start times; with an active-tariff entity
// on that entity's changes, matched to the tariffs the way the card matches
// them (name or short name, then a name containing the state).

import type { ScheduleEntry } from "./tariff";

export interface TariffNotifyTariff {
  name: string;
  short?: string;
  /** A fixed price or a price entity. */
  price?: number | string;
}

export interface TariffNotifyInput {
  tariffs: TariffNotifyTariff[];
  schedule?: ScheduleEntry[];
  activeEntity?: string;
  /** A timestamp sensor for "until", with an entity. */
  untilEntity?: string;
  /** Indices of the tariffs to announce; empty or missing: all. */
  announce?: number[];
  /** Minutes ahead for a warning; schedule only. 0: none. */
  advance: number;
  decimalComma: boolean;
  /** "€/kWh" and the like. */
  priceUnit: string;
  texts: {
    /** {tarif}, {preis}, {bis}. */
    now: string;
    /** "until …" part, appended to `now` when an end is known; {bis}. */
    until: string;
    /** {tarif}, {preis}, {minuten}. */
    soon: string;
    custom?: string;
  };
}

export interface TariffNotifyParts {
  variables: Record<string, string>;
  triggers: Record<string, unknown>[];
  conditions: Record<string, unknown>[];
  message: string;
  /** False when nothing can trigger: no schedule entry and no entity. */
  usable: boolean;
}

const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
};
const hhmmss = (min: number): string => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`;
};
const norm = (s: string | undefined) => (s ?? "").trim().toLowerCase();
const label = (t: TariffNotifyTariff) => (t.short ? `${t.name} (${t.short})` : t.name).replace(/[{}%]/g, "").replace(/"/g, "'");

export function tariffNotifyParts(input: TariffNotifyInput): TariffNotifyParts {
  const tariffs = input.tariffs;
  const announce = input.announce?.length ? input.announce : tariffs.map((_, i) => i);
  const indexOf = (name: string) => {
    const s = norm(name);
    let i = tariffs.findIndex((t) => norm(t.name) === s || (t.short && norm(t.short) === s));
    if (i < 0) i = tariffs.findIndex((t) => norm(t.name).includes(s) || s.includes(norm(t.name)));
    return i;
  };

  const table = tariffs.map((t) => ({
    n: label(t),
    k: [norm(t.name), norm(t.short)].filter(Boolean),
    nl: norm(t.name),
    p: typeof t.price === "number" ? t.price : null,
    pe: typeof t.price === "string" && t.price.includes(".") ? t.price : null,
  }));
  const sched: Record<string, { t: number; to: string; days: number[] }> = {};
  const triggers: Record<string, unknown>[] = [];
  const advance = Math.max(0, Math.round(input.advance || 0));

  (input.schedule ?? []).forEach((e, i) => {
    const t = indexOf(e.tariff);
    if (t < 0 || !announce.includes(t)) return;
    sched[String(i)] = { t, to: e.to.slice(0, 5), days: e.days ?? [] };
    triggers.push({ trigger: "time", at: hhmmss(minutesOf(e.from)), id: `now_${i}` });
    if (advance > 0) triggers.push({ trigger: "time", at: hhmmss(minutesOf(e.from) - advance), id: `soon_${i}` });
  });
  const useEntity = triggers.length === 0 && !!input.activeEntity;
  if (useEntity) {
    triggers.push({
      trigger: "state",
      entity_id: input.activeEntity,
      not_from: ["unavailable", "unknown"],
      not_to: ["unavailable", "unknown"],
      id: "entity",
    });
  }
  const firstKey = Object.keys(sched)[0];
  const sampleKey = useEntity ? "entity" : firstKey !== undefined ? `now_${firstKey}` : "entity";

  const findByState =
    "{% set s = st | lower | trim %}{% set ns = namespace(i=-1) %}" +
    "{% for t in tt %}{% if ns.i < 0 and s in t.k %}{% set ns.i = loop.index0 %}{% endif %}{% endfor %}" +
    "{% if ns.i < 0 and s %}{% for t in tt %}{% if ns.i < 0 and (s in t.nl or t.nl in s) %}{% set ns.i = loop.index0 %}{% endif %}{% endfor %}{% endif %}" +
    "{{ ns.i }}";

  const variables: Record<string, string> = {
    // Jinja knows none, not JSON's null: a null would leave the whole
    // table a string.
    tt: `{{ ${JSON.stringify(table).replace(/\bnull\b/g, "none")} }}`,
    sched: `{{ ${JSON.stringify(sched)} }}`,
    announce: `{{ ${JSON.stringify(announce)} }}`,
    advance: String(advance),
    // A hand-run has no trigger: it then announces the first entry.
    key: `{{ trigger.id if trigger is defined and trigger.id is defined else '${sampleKey}' }}`,
    soon: "{{ key.startswith('soon_') }}",
    st: input.activeEntity
      ? `{{ trigger.to_state.state if trigger is defined and trigger.to_state is defined else states('${input.activeEntity}') }}`
      : "{{ '' }}",
    idx: `{% if key == 'entity' %}${findByState}{% else %}{{ sched[key.split('_')[1]].t }}{% endif %}`,
    until:
      "{% if key != 'entity' %}{{ sched[key.split('_')[1]].to }}" +
      (input.untilEntity
        ? `{% elif states('${input.untilEntity}') not in ['unknown', 'unavailable'] %}{{ as_timestamp(states('${input.untilEntity}')) | timestamp_custom('%H:%M') }}`
        : "") +
      "{% endif %}",
    price:
      "{% set t = tt[idx | int] if (idx | int) >= 0 else {'p': none, 'pe': none} %}" +
      "{% set p = (states(t.pe) | float(none)) if t.pe else t.p %}" +
      `{{ (('%.4f' | format(p)) | regex_replace('0{1,2}$', '')${input.decimalComma ? " | replace('.', ',')" : ""}) if p is not none else '' }}`,
  };

  const conditions: Record<string, unknown>[] = [
    {
      condition: "template",
      value_template:
        "{% if (idx | int) < 0 or (idx | int) not in announce %}{{ false }}" +
        "{% elif key == 'entity' %}{{ true }}" +
        "{% else %}{% set e = sched[key.split('_')[1]] %}{% set at = now() + timedelta(minutes=(advance | int) if soon else 0) %}" +
        "{{ e.days | count == 0 or (at.isoweekday() % 7) in e.days }}{% endif %}",
    },
  ];

  const tokens: Record<string, string> = {
    tarif: "{{ tt[idx | int].n }}",
    preis: `{% if price %}{{ price }} ${input.priceUnit}{% endif %}`,
    bis: "{{ until }}",
    minuten: "{{ advance }}",
  };
  const fill = (text: string) => text.replace(/\{(\w+)\}/g, (whole, k: string) => tokens[k] ?? whole);
  const nowText = input.texts.custom?.trim()
    ? fill(input.texts.custom)
    : `${fill(input.texts.now)}{% if until %}${fill(input.texts.until)}{% endif %}`;
  const message = advance > 0 && !useEntity ? `{% if soon %}${fill(input.texts.soon)}{% else %}${nowText}{% endif %}` : nowText;

  return { variables, triggers, conditions, message, usable: triggers.length > 0 };
}
