import {
  CLIMATE_OVERVIEW_COLOR_COLD,
  CLIMATE_OVERVIEW_COLOR_COMFORTABLE,
  CLIMATE_OVERVIEW_COLOR_COOL,
  CLIMATE_OVERVIEW_COLOR_HOT,
  CLIMATE_OVERVIEW_COLOR_WARM,
  DEFAULT_CLIMATE_OVERVIEW_TEMP_THRESHOLDS,
  WEATHER_TEMP_SCALE,
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
  const celsius = toCelsius(value, unit);
  const t = DEFAULT_CLIMATE_OVERVIEW_TEMP_THRESHOLDS;
  if (celsius < t.cold) return CLIMATE_OVERVIEW_COLOR_COLD;
  if (celsius < t.cool) return CLIMATE_OVERVIEW_COLOR_COOL;
  if (celsius < t.comfortable) return CLIMATE_OVERVIEW_COLOR_COMFORTABLE;
  if (celsius < t.warm) return CLIMATE_OVERVIEW_COLOR_WARM;
  return CLIMATE_OVERVIEW_COLOR_HOT;
}

const toCelsius = (value: number, unit?: string): number => (unit === "°F" ? ((value - 32) * 5) / 9 : value);

function mixHex(a: string, b: string, f: number): string {
  const ch = (hex: string, k: number) => parseInt(hex.slice(1 + 2 * k, 3 + 2 * k), 16);
  let out = "#";
  for (let k = 0; k < 3; k++) {
    out += Math.round(ch(a, k) + (ch(b, k) - ch(a, k)) * f).toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * An outdoor temperature's colour: blended along the weather scale, held at
 * the end colours beyond it. Unlike temperatureColor() this is continuous —
 * a forecast bar runs from one value to another and should not jump.
 */
export function outdoorTemperatureColor(value: number, unit?: string): string {
  const c = toCelsius(value, unit);
  const scale = WEATHER_TEMP_SCALE;
  if (!Number.isFinite(c) || c <= scale[0][0]) return scale[0][1];
  for (let i = 1; i < scale.length; i++) {
    const [t1, c1] = scale[i];
    if (c <= t1) {
      const [t0, c0] = scale[i - 1];
      return mixHex(c0, c1, (c - t0) / (t1 - t0));
    }
  }
  return scale[scale.length - 1][1];
}

/**
 * A CSS gradient for a bar from `low` to `high`: the colours at both ends,
 * plus every scale stop the bar crosses at its true place, so a 5–20 °C day
 * passes through the cool and comfortable colours rather than straight from
 * blue to green.
 */
export function outdoorTemperatureGradient(low: number, high: number, unit?: string): string {
  const lo = toCelsius(Math.min(low, high), unit);
  const hi = toCelsius(Math.max(low, high), unit);
  if (!(hi - lo > 0)) return outdoorTemperatureColor(lo);
  const stops = [`${outdoorTemperatureColor(lo)} 0%`];
  for (const [t] of WEATHER_TEMP_SCALE) {
    if (t > lo && t < hi) stops.push(`${outdoorTemperatureColor(t)} ${(((t - lo) / (hi - lo)) * 100).toFixed(1)}%`);
  }
  stops.push(`${outdoorTemperatureColor(hi)} 100%`);
  return `linear-gradient(to right, ${stops.join(", ")})`;
}
