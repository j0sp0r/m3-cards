// Splits a period's energy into what the home used and where it came from
// (#56), the way Home Assistant's energy dashboard counts it
// (`computeConsumptionSingle` in its frontend): the home's use is the
// balance of everything that came in and went out, solar covers it first,
// then the battery, then the grid; a battery discharging while the meter
// exports is taken to be feeding the grid.

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
  /** Taken from the battery into the home. */
  battery: number;
  /** Fed into the grid. */
  export: number;
  /** Drawn from the grid in all, the battery's share included. */
  gridIn: number;
  total: number;
}

const pos = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);

export function splitUsage(f: EnergyFlows): Usage {
  let toGrid = pos(f.gridOut);
  let toBattery = pos(f.batteryIn);
  let solar = pos(f.solar);
  let fromGrid = pos(f.gridIn);
  let fromBattery = pos(f.batteryOut);
  let left = Math.max(0, fromGrid + solar + fromBattery - toGrid - toBattery);
  const usedSolar = Math.min(left, solar);
  left -= usedSolar;
  solar -= usedSolar;
  const batteryToGrid = Math.min(fromBattery, toGrid);
  fromBattery -= batteryToGrid;
  toGrid -= batteryToGrid;
  const solarToBattery = Math.min(solar, toBattery);
  toBattery -= solarToBattery;
  solar -= solarToBattery;
  const gridToBattery = Math.min(fromGrid, toBattery);
  fromGrid -= gridToBattery;
  const usedBattery = Math.min(left, fromBattery);
  left -= usedBattery;
  const usedGrid = Math.min(left, fromGrid);
  return {
    grid: usedGrid,
    solar: usedSolar,
    battery: usedBattery,
    export: pos(f.gridOut),
    gridIn: pos(f.gridIn),
    total: usedGrid + usedSolar + usedBattery,
  };
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
    (a, u) => ({
      grid: a.grid + u.grid,
      solar: a.solar + u.solar,
      battery: a.battery + u.battery,
      export: a.export + u.export,
      gridIn: a.gridIn + u.gridIn,
      total: a.total + u.total,
    }),
    { grid: 0, solar: 0, battery: 0, export: 0, gridIn: 0, total: 0 },
  );
}

/**
 * The share of the home's use not drawn from the grid, 0–100, as the energy
 * dashboard's gauge counts it: all the grid drew, the battery's charge
 * included, against the home's use.
 */
export function selfSufficiency(u: Usage): number | undefined {
  if (!(u.total > 0)) return undefined;
  return Math.round((1 - Math.min(1, u.gridIn / u.total)) * 100);
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

/**
 * The y-axis for bars up to `max`: of the round steps (1, 2, 2.5 or 5 × 10ⁿ)
 * that give three to five lines above zero, the one whose top sits closest
 * above the tallest bar — fewer lines when two reach the same top.
 */
export function axisTicks(max: number): { top: number; ticks: number[] } {
  if (!(max > 0) || !Number.isFinite(max)) return { top: 1, ticks: [0, 1] };
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  let best: { step: number; n: number } | undefined;
  for (const m of [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5]) {
    const step = m * mag;
    const n = Math.ceil(max / step - 1e-9);
    if (n < 3 || n > 5) continue;
    const top = n * step;
    if (!best || top < best.n * best.step - 1e-9 || (Math.abs(top - best.n * best.step) < 1e-9 && n < best.n)) best = { step, n };
  }
  const { step, n } = best ?? { step: mag, n: Math.ceil(max / mag) };
  // Rounding keeps 0.1 + 0.2 from printing as 0.30000000000000004.
  const ticks = Array.from({ length: n + 1 }, (_, i) => Number((i * step).toPrecision(12)));
  return { top: ticks[ticks.length - 1], ticks };
}
