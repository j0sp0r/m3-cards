// The energy usage card's report (#56): a Home Assistant automation that
// sends yesterday's, last week's or last month's use, counted the way the
// card and the energy dashboard count it. The automation asks the recorder
// itself (`recorder.get_statistics`, Home Assistant 2025.8 and later) and
// splits bucket by bucket in Jinja — hours for a day, days for a week or a
// month — so its figures are the card's figures.

import type { Sources } from "./energy-sources";
import { applyNotifyTemplate } from "./notify-editor";

export type ReportMode = "daily" | "weekly" | "monthly";

export interface EnergyReportInput {
  sources: Sources;
  mode: ReportMode;
  /** HH:MM or HH:MM:SS. */
  time: string;
  /** Decimal comma ("de") or point. */
  decimalComma: boolean;
  /** The currency symbol for the cost, e.g. "€". */
  currency: string;
  texts: {
    /** The period's name per mode, e.g. "Gestern". */
    period: Record<ReportMode, string>;
    /** Default message; placeholders below. */
    message: string;
    /** The user's own message, if any. */
    custom?: string;
  };
}

/** Placeholders the message may use. */
export const REPORT_TOKENS = ["zeitraum", "verbrauch", "netz", "solar", "akku", "einspeisung", "kosten", "autark"] as const;

export interface EnergyReportParts {
  triggers: Record<string, unknown>[];
  conditions: Record<string, unknown>[];
  /** Actions before the notify action: the period, the statistics, the sums. */
  actions: Record<string, unknown>[];
  message: string;
}

const list = (ids: string[]) => JSON.stringify(ids);

/** Jinja that adds up one group's change in the bucket starting at `s`. */
const groupSum = (field: string, group: string) =>
  `{% for id in ${group} %}{% for r in st.get(id, []) if r.start == s %}{% set b.${field} = b.${field} + (r.change or 0) %}{% endfor %}{% endfor %}`;

export function energyReportParts(input: EnergyReportInput): EnergyReportParts {
  const src = input.sources;
  const at = input.time.split(":").length === 2 ? `${input.time}:00` : input.time;
  const conditions: Record<string, unknown>[] =
    input.mode === "weekly"
      ? [{ condition: "time", weekday: ["mon"] }]
      : input.mode === "monthly"
        ? [{ condition: "template", value_template: "{{ now().day == 1 }}" }]
        : [];

  const start =
    input.mode === "daily"
      ? "{{ (today_at() - timedelta(days=1)).isoformat() }}"
      : input.mode === "weekly"
        ? "{{ (today_at() - timedelta(days=now().weekday() + 7)).isoformat() }}"
        : "{{ ((today_at().replace(day=1)) - timedelta(days=1)).replace(day=1).isoformat() }}";
  const end =
    input.mode === "daily"
      ? "{{ today_at().isoformat() }}"
      : input.mode === "weekly"
        ? "{{ (today_at() - timedelta(days=now().weekday())).isoformat() }}"
        : "{{ today_at().replace(day=1).isoformat() }}";
  const period = input.mode === "daily" ? "hour" : "day";
  const energyIds = [...src.gridFrom, ...src.gridTo, ...src.solar, ...src.batteryFrom, ...src.batteryTo];
  const allIds = [...new Set([...energyIds, ...src.gridCost])];

  // Per bucket the energy dashboard's split (computeConsumptionSingle):
  // the balance is the home's use, solar covers it first, a battery that
  // discharges while the meter exports feeds the grid, then battery, then grid.
  const report =
    "{% set st = stats.statistics %}" +
    "{% set starts = namespace(l=[]) %}" +
    "{% for id in energy_ids %}{% for r in st.get(id, []) %}{% if r.start not in starts.l %}{% set starts.l = starts.l + [r.start] %}{% endif %}{% endfor %}{% endfor %}" +
    "{% set t = namespace(use=0, grid=0, solar=0, bat=0, exp=0, gin=0) %}" +
    "{% for s in starts.l %}" +
    "{% set b = namespace(gi=0, go=0, so=0, bo=0, bi=0) %}" +
    groupSum("gi", "grid_in") +
    groupSum("go", "grid_out") +
    groupSum("so", "solar_ids") +
    groupSum("bo", "bat_out") +
    groupSum("bi", "bat_in") +
    "{% set gi = [b.gi, 0] | max %}{% set go = [b.go, 0] | max %}{% set so = [b.so, 0] | max %}{% set bo = [b.bo, 0] | max %}{% set bi = [b.bi, 0] | max %}" +
    "{% set left = [gi + so + bo - go - bi, 0] | max %}" +
    "{% set us = [left, so] | min %}{% set left = left - us %}{% set so = so - us %}" +
    "{% set b2g = [bo, go] | min %}{% set bo = bo - b2g %}{% set go = go - b2g %}" +
    "{% set s2b = [so, bi] | min %}{% set bi = bi - s2b %}" +
    "{% set g2b = [gi, bi] | min %}{% set gi2 = gi - g2b %}" +
    "{% set ub = [left, bo] | min %}{% set left = left - ub %}" +
    "{% set ug = [left, gi2] | min %}" +
    "{% set t.use = t.use + us + ub + ug %}{% set t.grid = t.grid + ug %}{% set t.solar = t.solar + us %}{% set t.bat = t.bat + ub %}" +
    "{% set t.exp = t.exp + ([b.go, 0] | max) %}{% set t.gin = t.gin + gi %}" +
    "{% endfor %}" +
    "{% set c = namespace(v=0) %}{% for id in cost_ids %}{% for r in st.get(id, []) %}{% set c.v = c.v + (r.change or 0) %}{% endfor %}{% endfor %}" +
    "{{ {'use': t.use, 'grid': t.grid, 'solar': t.solar, 'bat': t.bat, 'exp': t.exp," +
    " 'self': ((1 - ([1, t.gin / t.use] | min)) * 100) | round(0) if t.use > 0 else 0," +
    " 'cost': c.v, 'has_cost': cost_ids | count > 0} }}";

  const actions: Record<string, unknown>[] = [
    {
      variables: {
        start,
        end,
        grid_in: `{{ ${list(src.gridFrom)} }}`,
        grid_out: `{{ ${list(src.gridTo)} }}`,
        solar_ids: `{{ ${list(src.solar)} }}`,
        bat_out: `{{ ${list(src.batteryFrom)} }}`,
        bat_in: `{{ ${list(src.batteryTo)} }}`,
        cost_ids: `{{ ${list(src.gridCost)} }}`,
        energy_ids: `{{ ${list(energyIds)} }}`,
      },
    },
    {
      action: "recorder.get_statistics",
      data: { statistic_ids: allIds, start_time: "{{ start }}", end_time: "{{ end }}", period, types: ["change"], units: { energy: "kWh" } },
      response_variable: "stats",
    },
    { variables: { r: report } },
  ];

  const num = (expr: string, digits: number) =>
    `{{ ('%.${digits}f' | format(${expr}))${input.decimalComma ? " | replace('.', ',')" : ""} }}`;
  const tokens: Record<string, string> = {
    zeitraum: input.texts.period[input.mode],
    verbrauch: num("r.use", 1),
    netz: num("r.grid", 1),
    solar: num("r.solar", 1),
    akku: num("r.bat", 1),
    einspeisung: num("r.exp", 1),
    kosten: `{% if r.has_cost %}${num("r.cost", 2)} ${input.currency}{% else %}–{% endif %}`,
    autark: "{{ r.self | int }}",
  };
  const fill = (text: string) => text.replace(/\{(\w+)\}/g, (whole, k: string) => tokens[k] ?? whole);
  const message = input.texts.custom?.trim()
    ? applyNotifyTemplate(input.texts.custom, "", tokens)
    : fill(input.texts.message);

  return { triggers: [{ trigger: "time", at }], conditions, actions, message };
}
