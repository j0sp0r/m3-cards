// Splits a period's energy into what the home used and where it came from
// (#56), the way Home Assistant's energy dashboard counts it: solar goes to
// the home first, then into the battery, then out to the grid; whatever the
// battery took beyond the solar surplus came from the grid.

export interface EnergyFlows {
  gridIn: number;
  gridOut: number;
  solar: number;
  batteryOut: number;
  batteryIn: number;
}

export interface Usage {
  /** Drawn from the grid and used in the home. */
  grid: number;
  /** Solar used directly in the home. */
  solar: number;
  /** Taken from the battery. */
  battery: number;
  /** Fed into the grid. */
  export: number;
  total: number;
}

const pos = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);

export function splitUsage(f: EnergyFlows): Usage {
  const solar = pos(f.solar);
  const gridOut = pos(f.gridOut);
  const batteryIn = pos(f.batteryIn);
  const solarSurplus = Math.max(0, solar - gridOut);
  const chargeFromSolar = Math.min(batteryIn, solarSurplus);
  const chargeFromGrid = batteryIn - chargeFromSolar;
  const solarUsed = Math.max(0, solar - gridOut - chargeFromSolar);
  const gridUsed = Math.max(0, pos(f.gridIn) - chargeFromGrid);
  const batteryUsed = pos(f.batteryOut);
  return { grid: gridUsed, solar: solarUsed, battery: batteryUsed, export: gridOut, total: gridUsed + solarUsed + batteryUsed };
}

/**
 * The use of a whole period, split bucket by bucket and then added up — the
 * way the energy dashboard counts it. Splitting the period's totals instead
 * gives a different answer as soon as export and solar fall in different
 * hours: a phase-balanced meter can show more export than solar over a
 * month while every single day used its sun directly.
 */
export function sumUsage(usages: Usage[]): Usage {
  return usages.reduce(
    (a, u) => ({ grid: a.grid + u.grid, solar: a.solar + u.solar, battery: a.battery + u.battery, export: a.export + u.export, total: a.total + u.total }),
    { grid: 0, solar: 0, battery: 0, export: 0, total: 0 },
  );
}

/** The share of the home's use not drawn from the grid, 0–100. */
export function selfSufficiency(u: Usage): number | undefined {
  if (!(u.total > 0)) return undefined;
  return Math.round(((u.solar + u.battery) / u.total) * 100);
}

export function addFlows(a: EnergyFlows, b: EnergyFlows): EnergyFlows {
  return {
    gridIn: a.gridIn + b.gridIn,
    gridOut: a.gridOut + b.gridOut,
    solar: a.solar + b.solar,
    batteryOut: a.batteryOut + b.batteryOut,
    batteryIn: a.batteryIn + b.batteryIn,
  };
}

export const NO_FLOWS: EnergyFlows = { gridIn: 0, gridOut: 0, solar: 0, batteryOut: 0, batteryIn: 0 };

/** Wh / kWh / MWh for a kWh amount, as the native dashboard scales it. */
export function scaleEnergy(kwh: number): { value: number; unit: "Wh" | "kWh" | "MWh" } {
  const a = Math.abs(kwh);
  if (a > 0 && a < 1) return { value: kwh * 1000, unit: "Wh" };
  if (a >= 10_000) return { value: kwh / 1000, unit: "MWh" };
  return { value: kwh, unit: "kWh" };
}
