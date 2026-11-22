// The surface behind a card's icons — its "well" — and the theme switch that
// takes it away (#64).
//
// A theme sets `m3-icon-background: none` and every M3 card draws its icons
// straight on the card, as the current Google Home app does. Unset, nothing
// changes. Any other value (a colour) becomes the well of every icon instead.
//
// Most wells are a light tint of the icon's colour over the card, and the
// icon's colour was chosen to read on that tint, so it reads on the card
// beside it just as well: wrapping the background is all those need. A well
// filled solid is different — its glyph is dark ink, which on a dark card
// without the fill would vanish — so those also ask `iconWellsOff` and take
// the accent as text on the card instead.

const OFF = new Set(["none", "transparent", "off", "false", "0"]);

/** The CSS custom property a theme sets (HA prefixes theme keys with `--`). */
export const ICON_WELL_VAR = "--m3-icon-background";

/** A well's background, unless the theme replaces or removes it. */
export function iconWell(css: string): string {
  return `var(${ICON_WELL_VAR}, ${css})`;
}

/** Whether the theme has turned icon wells off. */
export function iconWellsOff(host: HTMLElement | undefined): boolean {
  if (!host?.isConnected) return false;
  const value = getComputedStyle(host).getPropertyValue(ICON_WELL_VAR).trim().toLowerCase();
  return OFF.has(value);
}
