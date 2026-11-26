import type { HomeAssistant, PriceUnit, PricingConfig } from "../types";
import { getNumberFormat } from "./formatting";
import { fetchPeriodChangeByEntity } from "./ha-statistics";
import { getGridEntities } from "./ha-energy";
import { loadEnergySources } from "./energy-sources";

const DEFAULT_PRICE_STEP = 0.1;

// Guesses the price unit (ct/kWh vs €/kWh) from an input_number helper's own
// unit_of_measurement, when the card config doesn't override it explicitly.
function inferPriceUnit(unitOfMeasurement: string | undefined): PriceUnit {
  const u = (unitOfMeasurement ?? "").toLowerCase();
  if (u.includes("ct") || u.includes("cent") || u.includes("¢")) return "ct_per_kwh";
  return "eur_per_kwh";
}

// Resolves the current price per kWh, in the card's base currency unit (not
// cents) — undefined means "no usable price available" (caller shows the
// "not configured" edge case). Never used for price_source
// "energy_dashboard": that mode reads HA's own pre-computed cost statistics
// instead of computing a price × kWh total itself (see getGridCostEntities).
export function resolveCurrentPrice(
  hass: HomeAssistant,
  config: PricingConfig,
): number | undefined {
  if (config.price_source === "fixed") {
    if (typeof config.price !== "number") return undefined;
    return config.price_unit === "ct_per_kwh" ? config.price / 100 : config.price;
  }
  if (config.price_source === "input_number") {
    const state = config.price_entity ? hass.states[config.price_entity] : undefined;
    if (!state) return undefined;
    const raw = parseFloat(state.state);
    if (Number.isNaN(raw)) return undefined;
    const unit = config.price_unit ?? inferPriceUnit(state.attributes.unit_of_measurement);
    return unit === "ct_per_kwh" ? raw / 100 : raw;
  }
  return undefined;
}

// The input_number helper's own step (falls back to the project default when
// the helper doesn't define one — HA always sets one in practice, but the
// type is optional).
export function priceStep(hass: HomeAssistant, entityId: string | undefined): number {
  if (!entityId) return DEFAULT_PRICE_STEP;
  const step = hass.states[entityId]?.attributes.step;
  return typeof step === "number" ? step : DEFAULT_PRICE_STEP;
}

export async function setPrice(
  hass: HomeAssistant,
  entityId: string,
  value: number,
): Promise<void> {
  await hass.callService("input_number", "set_value", { entity_id: entityId, value });
}

// Currency formatters are the most expensive Intl objects here and are built
// per row by the cost and top-consumers lists; they go through the shared
// cache like everything else.
function getNumberFormatOrThrow(language: string, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  return getNumberFormat(language, options) ?? new Intl.NumberFormat(undefined, options);
}

export function formatCurrency(value: number, currency: string, language: string): string {
  return getNumberFormatOrThrow(language, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

// Splits a currency-formatted value into its number and symbol/code parts —
// used wherever the design shows the amount large and the currency unit
// small (matching how every other card here splits e.g. "32" + "W"), which
// plain `format()` can't do safely across locales (symbol position/spacing
// varies). Falls back to a trailing empty symbol if Intl can't find one.
export function formatCurrencyParts(
  value: number,
  currency: string,
  language: string,
): { number: string; symbol: string } {
  const parts = getNumberFormatOrThrow(language, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).formatToParts(value);
  const number = parts
    .filter((p) => p.type !== "currency" && p.type !== "literal")
    .map((p) => p.value)
    .join("");
  const symbol = parts.find((p) => p.type === "currency")?.value ?? currency;
  return { number, symbol };
}

// €/month base fee prorated to `days` days of the *actual* current calendar
// month (28-31), not a flat /30 — matters at the edges of short/long months.
export function proratedBaseFee(baseFeeMonthly: number, days: number): number {
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return (baseFeeMonthly / daysInMonth) * days;
}

// Like resolveCurrentPrice, but also handles price_source
// "energy_dashboard" — HA has no per-device cost statistic to read there
// (only a whole-grid one), so this derives an effective €/kWh by dividing
// the grid's total cost by its total consumption over the given window.
// Used by m3-top-consumers-card's cost mode, where per-device costs are
// always computed locally as kWh × price (there's no per-device equivalent
// of m3-cost-card's direct cost-statistic read).
export async function resolveEffectivePrice(
  hass: HomeAssistant,
  config: PricingConfig,
  periodStart: Date,
  periodEnd: Date,
): Promise<number | undefined> {
  if (config.price_source !== "energy_dashboard") {
    return resolveCurrentPrice(hass, config);
  }
  const [costIds, grid] = await Promise.all([getGridCostEntities(hass), getGridEntities(hass)]);
  if (!costIds || !grid || grid.from.length === 0) return undefined;
  const [costByEntity, kwhByEntity] = await Promise.all([
    fetchPeriodChangeByEntity(hass, costIds, periodStart, periodEnd, "day"),
    fetchPeriodChangeByEntity(hass, grid.from, periodStart, periodEnd, "day"),
  ]);
  const totalCost = Array.from(costByEntity.values()).reduce((a, b) => a + b, 0);
  const totalKwh = Array.from(kwhByEntity.values()).reduce((a, b) => a + b, 0);
  return totalKwh > 0 ? totalCost / totalKwh : undefined;
}

// The recorder cost-statistic ids of the Energy dashboard's grid source(s),
// one per tariff/flow. A grid with a fixed price or a price entity has
// `stat_cost: null` in the prefs: HA keeps the cost statistic it computes
// itself under `energy/info` → `cost_sensors` instead, and
// loadEnergySources() reads both. Undefined when no grid source has a price
// yet — HA only creates the statistic once a price is set *and* the recorder
// has processed an interval since, so this can stay undefined for a while
// after a price is first configured.
export async function getGridCostEntities(hass: HomeAssistant): Promise<string[] | undefined> {
  const { sources } = await loadEnergySources(hass);
  return sources?.gridCost.length ? sources.gridCost : undefined;
}
