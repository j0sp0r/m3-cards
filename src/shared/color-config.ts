import { THEME_COLOR_TOKENS } from "../const";
import {
  contrastRatio,
  mixColors,
  parseColor,
  relativeLuminance,
  toHex,
  toneAt,
  vividOn,
} from "./contrast";
import type { Rgb } from "./contrast";
import { CARD_SURFACE_CSS, SUPPORTS_COLOR_MIX } from "./css-support";

// Resolves a config color value against the curated HA/tile-card token list
// (e.g. "red", "primary"); anything not found is used verbatim as a CSS
// color (hex, rgb(), var(...), color-mix(...), ...).
export function resolveThemeColor(value: string): string {
  return THEME_COLOR_TOKENS[value] ?? value;
}

// Formats a `color-mix(...)` background-tint string. `opacityPercent` is the
// user-configured strength (0-100) from an editor opacityRow slider; when
// unset, falls back to `defaultPercent` — the value hardcoded at this call
// site before the slider existed, so unconfigured cards render identically.
export function tintBackground(
  colorCss: string,
  opacityPercent: number | undefined,
  defaultPercent: number,
): string {
  // Mixed into the card surface rather than toward transparent. Mixing toward
  // transparent leaves the result depending on everything behind the card —
  // the glass scrim, and through it the dashboard's wallpaper — so a 14% tint
  // rendered as a barely-there wash in a light theme over a dark background.
  // Against the surface the tint is definite and theme-correct at both ends:
  // the same percentage of accent over near-white in a light theme and over
  // near-black in a dark one. The card as a whole stays translucent; only
  // these inner fills become opaque, which is the Material tonal-surface
  // model and what keeps them legible.
  const percent = opacityPercent ?? defaultPercent;
  // Safari only learned color-mix() in 16.2, and this string is set inline,
  // where a dropped declaration leaves nothing behind it. So the mix is
  // decided here instead: whichever of the two colours the percentage was
  // asking for more of. Below half that is the surface — a tile that is a
  // definite shape without its tint — and above it the colour itself, which
  // is what a 70% "mix" was always mostly made of.
  if (!SUPPORTS_COLOR_MIX) return percent >= 50 ? colorCss : CARD_SURFACE_CSS;
  return `color-mix(in srgb, ${colorCss} ${percent}%, ${CARD_SURFACE_CSS})`;
}

// Builds a `--prefix-key: value;` inline style string from a map, skipping
// undefined entries. Used by cards to assemble their CSS-custom-property
// theming block on the <ha-card> root in one line.
// Derives a readable foreground twin for each colour a card uses as *text*.
//
// The palette is built for dark backgrounds — every one of its colours falls
// below 4.5:1 on a light card surface (docs/light-theme-colors.md) — so an
// accent that reads well as a fill is washed out as a figure or a label. Each
// entry comes back with a `-fg` suffix, adjusted only as far as the target
// contrast demands and left alone when it already clears it, which means the
// dark theme is untouched.
//
// Deliberately explicit rather than derived from variable names: a card's
// foreground colours are not all called "-accent" (power-summary alone has
// `ps-main` and `ps-producer`), and guessing from names would silently miss
// them.
//
// The surface is read from the host's computed style because only the theme
// knows it. When it cannot be resolved — the element is not connected yet, or
// the theme sets nothing — every value is passed through unchanged, so the
// worst case is today's appearance.
/**
 * Resolves a bare `var(--x)` / `var(--x, fallback)` against the host's computed
 * style so the contrast helpers can parse it.
 *
 * Without this the helpers silently no-op on every call site that passes a
 * custom property instead of a literal — and a lot of them do. The waste card's
 * non-highlighted rows tint from `var(--primary-text-color)`, so the tint fell
 * back to a CSS mix, which then could not be parsed as a surface, so the row's
 * text kept the raw accent and stayed at 1.34:1 while the highlighted row next
 * to it was corrected properly.
 */
export function resolveVarCss(host: HTMLElement | undefined, css: string): string {
  const m = css.trim().match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/);
  if (!m) return css;
  if (host?.isConnected) {
    const value = getComputedStyle(host).getPropertyValue(m[1]).trim();
    if (value) return value;
  }
  return m[2] ? resolveVarCss(host, m[2].trim()) : css;
}

function surfaceOf(host: HTMLElement | undefined): string {
  if (!host?.isConnected) return "";
  const cs = getComputedStyle(host);
  return (
    cs.getPropertyValue("--ha-card-background").trim() ||
    cs.getPropertyValue("--card-background-color").trim()
  );
}

// The bisection is cheap but list cards call this per row per render, and the
// set of (colour, surface) pairs a dashboard uses is tiny and stable.
const foregroundCache = new Map<string, string>();

// How much the saturation is lifted while a colour is darkened. Darkening
// alone reaches the contrast target but drains the colour out — #85b7eb ends
// up #537293, a grey-blue that reads as washed rather than as a deliberate
// deep tone. Lifting saturation as the lightness drops keeps the accent
// recognisably itself: the same colour lands on #0b6ed5.
const SATURATION_BOOST = 1.25;

function readableCached(colorCss: string, surface: string, target: number): string {
  const key = `${colorCss}|${surface}|${target}`;
  let out = foregroundCache.get(key);
  if (out === undefined) {
    const color = parseColor(colorCss);
    const ground = parseColor(surface);
    out =
      color && ground
        ? toHex(vividOn(color, ground, target, SATURATION_BOOST))
        : colorCss;
    foregroundCache.set(key, out);
  }
  return out;
}

// Single colour in, readable colour out — for the places a card sets a text
// colour inline rather than through a CSS variable.
export function foregroundColor(
  host: HTMLElement | undefined,
  colorCss: string,
  target = 4.5,
): string {
  const surface = surfaceOf(host);
  return surface ? readableCached(resolveVarCss(host, colorCss), surface, target) : colorCss;
}

export function foregroundVars(
  host: HTMLElement | undefined,
  vars: Record<string, string | undefined>,
  target = 4.5,
): Record<string, string | undefined> {
  const surface = surfaceOf(host);
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) continue;
    out[`${key}-fg`] = surface ? readableCached(value, surface, target) : value;
  }
  return out;
}

export function buildCssVars(vars: Record<string, string | undefined>): string {
  return Object.entries(vars)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `--${k}: ${v};`)
    .join(" ");
}

export interface CommonColorConfig {
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
}

export interface CommonColors {
  textColorCss: string;
  secondaryTextColorCss: string;
  cardBackgroundCss: string | undefined;
}

// Resolves the text_color/secondary_text_color/card_background triplet that
// every card exposes identically, with the same fallbacks
// (var(--primary-text-color) for text, theme default for the card
// background). Previously duplicated inline in every card's render().
export function resolveCommonColors(config: CommonColorConfig): CommonColors {
  return {
    textColorCss: config.text_color
      ? resolveThemeColor(config.text_color)
      : "var(--primary-text-color)",
    secondaryTextColorCss: config.secondary_text_color
      ? resolveThemeColor(config.secondary_text_color)
      : "var(--primary-text-color)",
    cardBackgroundCss: config.card_background
      ? resolveThemeColor(config.card_background)
      : undefined,
  };
}

// The reference dark surface the palette was designed against. Used to ask what
// contrast a tint *already achieves* in a dark theme, which is then the target
// for the same tint in a light one.
const DARK_REFERENCE: Rgb = [28, 28, 28];

const tintCache = new Map<string, string>();

/**
 * Host-aware `tintBackground`: resolves the mix itself and, on a light surface,
 * darkens the result until it is as visible as the identical tint is in a dark
 * theme.
 *
 * `tintBackground` mixes the accent into the card surface, which fixed the
 * old "mixes toward transparent" bug but left a second one: the palette is made
 * of light colours, so a light accent mixed into a light surface stays light. A
 * 30% energy-card bar renders rgb(53,83,92) on #111e1c — 2.05:1, clearly
 * visible — and rgb(205,236,242) on #e8f7f3, which is 1.06:1 and effectively
 * invisible — which is what "the bars are barely visible" is, as a number.
 *
 * The target is not invented: it is whatever *this* colour at *this* percentage
 * reaches on the reference dark surface. That makes the correction
 * self-scaling — a 10% chip wash asks for barely any contrast and stays a wash,
 * a 30% data bar asks for real separation and gets it — and a no-op in a dark
 * theme, where the mix already clears its own target.
 */
export function tintOn(
  host: HTMLElement | undefined,
  colorCss: string,
  opacityPercent: number | undefined,
  defaultPercent: number,
): string {
  const percent = opacityPercent ?? defaultPercent;
  const surfaceCss = surfaceOf(host);
  const resolvedCss = resolveVarCss(host, colorCss);
  const surface = parseColor(surfaceCss);
  const color = parseColor(resolvedCss);
  // Still unresolvable — a theme colour not yet applied — so hand back the
  // CSS-level mix and let the browser do what it did before.
  if (!surface || !color) return tintBackground(colorCss, opacityPercent, defaultPercent);

  const key = `${resolvedCss}|${surfaceCss}|${percent}`;
  const cached = tintCache.get(key);
  if (cached !== undefined) return cached;

  const share = percent / 100;

  // A dark surface is what the palette was built for, so the plain mix needs no
  // correction there. It is still computed and returned as a hex rather than
  // handed back as a CSS color-mix string: `color-mix(in srgb, X p%, surface)`
  // is exactly this arithmetic, so the pixels are identical, but a hex can be
  // *parsed*. Returning the string made tintInk a silent no-op in every dark
  // theme — it feeds tintOn's output back in as the surface to measure against,
  // and an unparseable surface means the ink comes back unchanged. On the clock
  // card that put an accent-coloured digit on an accent-coloured shape.
  if (relativeLuminance(surface) <= 0.5) {
    const out = toHex(mixColors(color, surface, share));
    tintCache.set(key, out);
    return out;
  }

  const mixed = mixColors(color, surface, share);
  const wanted = contrastRatio(mixColors(color, DARK_REFERENCE, share), DARK_REFERENCE);

  // The plain mix comes first, and for a neutral wash it is the right answer:
  // `var(--primary-text-color)` is dark in a light theme, so 6% of it over a
  // light surface already reads as the intended grey. Rebuilding that from hue
  // and saturation is not just unnecessary, it is wrong — a dark colour mixed
  // into the dark reference contrasts at about 1.0, so the target came out at
  // 1.0 and the wash vanished. List rows went white while the tile beside them,
  // still a CSS literal, kept its grey.
  //
  // Only a colour that falls short of what it manages in a dark theme gets
  // rebuilt: that is the light accent this whole mechanism is for.
  const out = toHex(
    contrastRatio(mixed, surface) >= wanted
      ? mixed
      : toneAt(color, surface, wanted, SATURATION_BOOST),
  );
  tintCache.set(key, out);
  return out;
}

/**
 * A solid data fill — a chart bar, a progress segment — moved far enough from a
 * light surface to read as a mark rather than a wash.
 *
 * Deliberately not the `tintOn` rule. A tint can aim for the contrast the same
 * tint reaches in a dark theme, because both ends are mixtures. A *solid*
 * accent cannot: a light accent on a dark ground is inherently high-contrast
 * (#89CFF0 on #1c1c1c is 10.7:1), and demanding that on near-white would mean a
 * near-black bar. So this uses the WCAG floor for graphical objects instead,
 * 3:1, which is also comfortably above the ~2:1 the tinted bars land on — the
 * emphasis stays an emphasis.
 *
 * Only for fills that carry nothing on top. Several solid accent surfaces in
 * these cards hold dark ink (#1c1c1c), and darkening those would trade a
 * fill-vs-surface problem for an ink-vs-fill one.
 */
export function fillColor(
  host: HTMLElement | undefined,
  colorCss: string,
  target = 3,
): string {
  const surfaceCss = surfaceOf(host);
  const surface = parseColor(surfaceCss);
  if (!surface || relativeLuminance(surface) <= 0.5) return colorCss;
  return readableCached(resolveVarCss(host, colorCss), surfaceCss, target);
}

/**
 * Foreground colour against an explicit surface rather than the card's.
 *
 * Needed wherever ink sits on a tinted well instead of on the card itself.
 * Once tints keep their hue, an icon well and the icon on it are the same hue
 * at similar lightness, and the glyph disappears — measured against the well,
 * it darkens instead.
 */
export function foregroundOn(
  colorCss: string,
  surfaceCss: string,
  target = 3,
  host?: HTMLElement,
): string {
  // The host is optional but matters: without it a colour given as a custom
  // property cannot be parsed, and this silently hands back the input — the
  // same quiet no-op that left the waste card's rows uncorrected.
  return readableCached(resolveVarCss(host, colorCss), surfaceCss, target);
}

/**
 * The ink for content that sits on `tintOn`'s output — a chip's label, the
 * glyph in an icon well.
 *
 * Without it the two are the same colour at similar lightness once tints keep
 * their hue: an accent chip renders #81c784 on #9cdc9f, which is 1.26:1 and
 * unreadable. Measuring the ink against the tint it sits on rather than
 * against the card is the whole fix.
 *
 * Defaults to 4.5:1, because most tinted surfaces in these cards carry a label
 * and the labels are small — 9 to 15px. Pass 3 for a well that holds nothing
 * but an icon, where the WCAG floor for graphical objects applies and 4.5
 * would render the glyph heavier than the design wants.
 */
export function tintInk(
  host: HTMLElement | undefined,
  colorCss: string,
  opacityPercent: number | undefined,
  defaultPercent: number,
  target = 4.5,
): string {
  return foregroundOn(
    colorCss,
    tintOn(host, colorCss, opacityPercent, defaultPercent),
    target,
    host,
  );
}

/**
 * Ink for content laid on a *solid* colour fill: whichever of the house dark
 * ink and white reads better on it.
 *
 * Distinct from `foregroundOn`, which nudges a colour until it clears a target.
 * That is the wrong move on a fill the user chose — it would shift their accent
 * — and it cannot always succeed: the palette's own `#85b7eb` sits at luminance
 * 0.45, so a search that lightens toward white tops out at 2.11:1 and gives up.
 * Choosing between two inks always succeeds and matches what the cards already
 * do by hand: dark ink on a light accent.
 */
const HOUSE_INK = "#1c1c1c";

export function inkOn(fillCss: string, host?: HTMLElement): string {
  const fill = parseColor(resolveVarCss(host, fillCss));
  if (!fill) return HOUSE_INK;
  const dark = contrastRatio(parseColor(HOUSE_INK)!, fill);
  const light = contrastRatio([255, 255, 255], fill);
  return dark >= light ? HOUSE_INK : "#ffffff";
}
