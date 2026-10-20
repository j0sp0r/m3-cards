// Feature tests for CSS the suite uses but cannot assume.
//
// Home Assistant dashboards outlive the hardware they are read on. An iPod
// touch 7 and an iPad Air 2 both stop at iOS 15, which is Safari 15 — and
// Safari only learned container queries in 16.0 and `color-mix()` in 16.2.
// Those devices make fine wall panels, so the cards degrade on them rather
// than break.

/**
 * Whether `cqw`/`cqh`/`cqi` resolve. False on Safari 15 and older.
 *
 * The usual cascade fallback — a plain declaration before the fancy one —
 * handles a *literal* container-query unit on its own: the parser sees an
 * unknown unit, drops that declaration, and the plain one before it wins.
 *
 * It does **not** handle one that arrives through `var()`. The parser cannot
 * know what a custom property will substitute to, so it keeps the
 * declaration and only discovers the bad unit afterwards — and a declaration
 * that fails *then* becomes `unset`, not "the previous declaration". That is
 * how a button card's icon ended up 300px wide on an iPod: `--mdc-icon-size`
 * substituted to `min(28px, 39cqh)`, the `width` on ha-icon's `<svg>` fell to
 * `unset` (`auto`), and an SVG at `width: auto` with no intrinsic size is
 * 300x150 by definition.
 *
 * So anything that hands a container-query unit to a custom property has to
 * ask this first and pass a plain pixel value instead.
 */
export const SUPPORTS_CONTAINER_UNITS: boolean =
  typeof CSS !== "undefined" && typeof CSS.supports === "function"
    ? CSS.supports("width", "1cqh")
    : true;

/**
 * Whether `color-mix()` resolves. False on Safari 16.1 and older.
 *
 * Unlike a container-query unit, a *literal* `color-mix()` is caught at parse
 * time — the declaration is dropped and a plain one written before it wins,
 * which is how the stylesheets handle it. This flag is for the values built
 * in script and set inline, where there is no earlier declaration to fall
 * back to. See `tintBackground`.
 */
export const SUPPORTS_COLOR_MIX: boolean =
  typeof CSS !== "undefined" && typeof CSS.supports === "function"
    ? CSS.supports("color", "color-mix(in srgb, red 50%, blue)")
    : true;

/** The card surface every tint in this suite is mixed over. */
export const CARD_SURFACE_CSS = "var(--ha-card-background, var(--card-background-color))";
