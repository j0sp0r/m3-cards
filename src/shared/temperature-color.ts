import {
  CLIMATE_OVERVIEW_COLOR_COLD,
  CLIMATE_OVERVIEW_COLOR_COMFORTABLE,
  CLIMATE_OVERVIEW_COLOR_COOL,
  CLIMATE_OVERVIEW_COLOR_HOT,
  CLIMATE_OVERVIEW_COLOR_WARM,
  DEFAULT_CLIMATE_OVERVIEW_TEMP_THRESHOLDS,
} from "../const";

/**
 * A temperature's colour by what it is: blue when cold, green when
 * comfortable, red only when hot.
 *
 * A fixed red for every temperature sensor read as "hot" for a 12 °C garden
 * shed. These are the climate overview card's own stages and colours, so a
 * room reads the same in both. Fahrenheit is converted first; anything that
 * is not a number gets no colour and the caller keeps its default.
 */
export function temperatureColor(value: number, unit?: string): string | undefined {
  if (!Number.isFinite(value)) return undefined;
  const celsius = unit === "°F" ? ((value - 32) * 5) / 9 : value;
  const t = DEFAULT_CLIMATE_OVERVIEW_TEMP_THRESHOLDS;
  if (celsius < t.cold) return CLIMATE_OVERVIEW_COLOR_COLD;
  if (celsius < t.cool) return CLIMATE_OVERVIEW_COLOR_COOL;
  if (celsius < t.comfortable) return CLIMATE_OVERVIEW_COLOR_COMFORTABLE;
  if (celsius < t.warm) return CLIMATE_OVERVIEW_COLOR_WARM;
  return CLIMATE_OVERVIEW_COLOR_HOT;
}
