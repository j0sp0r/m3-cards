// What the energy flow card is showing: energy over the day (kWh) or power
// right now (W). The Energy dashboard source is always energy. With
// `source: entities` the sensors decide: if every one that is set reports a
// power unit, the card shows live power — "Grid · W", "Now", "Self-sufficiency
// now" — instead of putting watts under a kWh label (#29).

export type FlowMeasure = "energy" | "power";

/** Factor to the base unit: kWh for energy, W for power. */
const ENERGY: Record<string, number> = { wh: 1 / 1000, kwh: 1, mwh: 1000, gwh: 1_000_000 };
const POWER: Record<string, number> = { w: 1, kw: 1000, mw: 1_000_000 };

function norm(unit: string | undefined): string {
  return String(unit ?? "").trim().toLowerCase();
}

/** Power when every configured sensor reports a power unit (or device class); energy otherwise. */
export function flowMeasure(sensors: ReadonlyArray<{ unit?: string; deviceClass?: string }>): FlowMeasure {
  if (!sensors.length) return "energy";
  return sensors.every((s) => norm(s.unit) in POWER || (s.deviceClass === "power" && !(norm(s.unit) in ENERGY)))
    ? "power"
    : "energy";
}

/** A sensor reading in the base unit of the measure; an unknown unit is taken as already in it. */
export function toBase(value: number, unit: string | undefined, measure: FlowMeasure): number {
  const factor = (measure === "power" ? POWER : ENERGY)[norm(unit)];
  return factor === undefined ? value : value * factor;
}

export interface FlowDisplayUnit {
  /** As written under the nodes. */
  label: string;
  /** Base-unit values are divided by this before they are shown. */
  divisor: number;
}

/**
 * The unit the numbers are shown in. A configured `unit` that the card knows
 * (W, kW, Wh, kWh, MWh) also scales the numbers; any other text is only a
 * label. Without one, power switches from W to kW once the largest value
 * reaches 1000 W, and energy stays in kWh.
 */
export function displayUnit(measure: FlowMeasure, largest: number, configured?: string): FlowDisplayUnit {
  const table = measure === "power" ? POWER : ENERGY;
  if (configured && configured.trim()) {
    const factor = table[norm(configured)];
    return { label: configured.trim(), divisor: factor ?? 1 };
  }
  if (measure === "power") return largest >= 1000 ? { label: "kW", divisor: 1000 } : { label: "W", divisor: 1 };
  return { label: "kWh", divisor: 1 };
}
