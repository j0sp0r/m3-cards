// The energy dashboard's sources, as the energy usage card and its report
// read them (#56): grid in and out with their costs, solar, battery in and
// out, the individual devices. A card's own `sources` override wins.

import type { HomeAssistant, M3EnergyUsageCardConfig } from "../types";

type EnergyUsageSourcesConfig = NonNullable<M3EnergyUsageCardConfig["sources"]>;

export interface Sources {
  gridFrom: string[];
  gridTo: string[];
  solar: string[];
  batteryFrom: string[];
  batteryTo: string[];
  gridCost: string[];
  exportCompensation: string[];
  devices: { id: string; name?: string }[];
}

export interface LoadedSources {
  sources?: Sources;
  /** The energy dashboard has nothing set up. */
  noDashboard: boolean;
}

type GridSourcePrefs = {
  type: string;
  stat_energy_from?: string | null;
  stat_energy_to?: string | null;
  stat_cost?: string | null;
  stat_compensation?: string | null;
  flow_from?: { stat_energy_from?: string; stat_cost?: string | null }[];
  flow_to?: { stat_energy_to?: string; stat_compensation?: string | null }[];
};

export async function loadEnergySources(hass: HomeAssistant, over?: EnergyUsageSourcesConfig): Promise<LoadedSources> {
  try {
    const [prefs, info] = await Promise.all([
      hass.callWS<{ energy_sources: GridSourcePrefs[]; device_consumption?: { stat_consumption: string; name?: string }[] }>({ type: "energy/get_prefs" }),
      hass.callWS<{ cost_sensors?: Record<string, string> }>({ type: "energy/info" }).catch(() => ({ cost_sensors: {} as Record<string, string> })),
    ]);
    const costs = info?.cost_sensors ?? {};
    const grids = prefs.energy_sources.filter((s) => s.type === "grid");
    const from: string[] = [];
    const to: string[] = [];
    const gridCost: string[] = [];
    const comp: string[] = [];
    for (const g of grids) {
      // Both the flat format and the older flow_from / flow_to lists.
      const fromList = g.flow_from ?? (g.stat_energy_from ? [{ stat_energy_from: g.stat_energy_from, stat_cost: g.stat_cost }] : []);
      const toList = g.flow_to ?? (g.stat_energy_to ? [{ stat_energy_to: g.stat_energy_to, stat_compensation: g.stat_compensation }] : []);
      for (const f of fromList) {
        if (!f.stat_energy_from) continue;
        from.push(f.stat_energy_from);
        const c = f.stat_cost || costs[f.stat_energy_from];
        if (c) gridCost.push(c);
      }
      for (const t of toList) {
        if (!t.stat_energy_to) continue;
        to.push(t.stat_energy_to);
        const c = t.stat_compensation || costs[t.stat_energy_to];
        if (c) comp.push(c);
      }
    }
    const of = (type: string, field: "stat_energy_from" | "stat_energy_to") =>
      prefs.energy_sources.filter((s) => s.type === type).map((s) => s[field]).filter((v): v is string => !!v);
    const sources: Sources = {
      gridFrom: over?.grid_from ?? from,
      gridTo: over?.grid_to ?? to,
      solar: over?.solar ?? of("solar", "stat_energy_from"),
      batteryFrom: over?.battery_from ?? of("battery", "stat_energy_from"),
      batteryTo: over?.battery_to ?? of("battery", "stat_energy_to"),
      gridCost,
      exportCompensation: comp,
      devices: (prefs.device_consumption ?? []).map((d) => ({ id: d.stat_consumption, name: d.name })),
    };
    const any = sources.gridFrom.length + sources.solar.length + sources.batteryFrom.length;
    return { sources, noDashboard: any === 0 };
  } catch {
    if (over) {
      return {
        noDashboard: false,
        sources: {
        gridFrom: over.grid_from ?? [],
        gridTo: over.grid_to ?? [],
        solar: over.solar ?? [],
        batteryFrom: over.battery_from ?? [],
        batteryTo: over.battery_to ?? [],
        gridCost: [],
        exportCompensation: [],
        devices: [],
        },
      };
    }
    return { noDashboard: true };
  }
}
