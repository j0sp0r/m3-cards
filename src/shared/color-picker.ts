// HS (hue/saturation, as HA's light.turn_on hs_color expects — 0-360 / 0-100)
// <-> RGB <-> hex conversions for the light card's color wheel and palette
// swatches. Value (brightness) is intentionally not part of this — the wave
// slider already owns brightness, so the wheel only ever picks hue+saturation
// at full value, matching how HA's own more-info color picker behaves.

export function hexToRgb(hex: string): [number, number, number] | undefined {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return undefined;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function rgbToHs(r: number, g: number, b: number): [number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : (delta / max) * 100;
  return [h, s];
}

export function hsToRgb(h: number, s: number): [number, number, number] {
  const sn = s / 100;
  const c = sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = 1 - c;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export function hexToHs(hex: string): [number, number] | undefined {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHs(...rgb) : undefined;
}

/**
 * RGB of a black body at `kelvin`, for a light that reports only its colour
 * temperature (Tanner Helland's fit, good to a few percent from 1000 K to
 * 40000 K).
 */
export function kelvinToRgb(kelvin: number): [number, number, number] {
  const t = Math.max(1000, Math.min(40000, kelvin)) / 100;
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = t <= 66 ? 255 : clamp(329.698727446 * Math.pow(t - 60, -0.1332047592));
  const g =
    t <= 66
      ? clamp(99.4708025861 * Math.log(t) - 161.1195681661)
      : clamp(288.1221695283 * Math.pow(t - 60, -0.0755148492));
  const b = t >= 66 ? 255 : t <= 19 ? 0 : clamp(138.5177312231 * Math.log(t - 10) - 305.0447927307);
  return [r, g, b];
}

/**
 * The colour a light is shining in, as hex — from `rgb_color`, which Home
 * Assistant fills in for every colour mode including colour temperature, then
 * from `hs_color`, then from the colour temperature itself. Undefined for a
 * light that reports none of them (on/off or brightness only).
 */
export function lightColorHex(attributes: Record<string, unknown>): string | undefined {
  const rgb = attributes.rgb_color;
  if (Array.isArray(rgb) && rgb.length === 3 && rgb.every((v) => typeof v === "number")) {
    return rgbToHex(rgb[0], rgb[1], rgb[2]);
  }
  const hs = attributes.hs_color;
  if (Array.isArray(hs) && hs.length === 2 && hs.every((v) => typeof v === "number")) {
    return rgbToHex(...hsToRgb(hs[0], hs[1]));
  }
  const kelvin = attributes.color_temp_kelvin;
  if (typeof kelvin === "number" && kelvin > 0) return rgbToHex(...kelvinToRgb(kelvin));
  return undefined;
}
