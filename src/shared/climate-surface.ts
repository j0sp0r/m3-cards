// The visual language both climate cards borrow from the ecosee reference
// card, in one place so the full card's setpoint pill and the mini card's
// setpoint segment cannot drift apart.
//
// Two ideas carry that reference's Home Screen (see
// `reference/ecosee/docs/visual-spec.md` and `src/screens/home-screen.ts`):
//
//  1. The **setpoint oval** — the heat/cool colour appears as a thin outline
//     over a faint same-colour wash with a matching glyph and numeral, never
//     as a solid fill. That leaves the equipment glow as the only saturated
//     element on the card, so "the thermostat is running right now" reads
//     louder than "the thermostat is set to heat".
//  2. The **dominant current temperature** — one near-weightless, tightly
//     tracked figure with a faint top-bright sheen, and nothing else on the
//     card allowed to compete with it.
//
// Both are re-expressed for Home Assistant here: the wash is measured against
// the real theme surface via `tintOn()` instead of ecosee's fixed near-black
// canvas, and the sheen fades toward the card background rather than toward
// transparent, so neither breaks on a light theme or over a wallpaper.

import { css, unsafeCSS } from "lit";
import {
  HERO_TEMP_CQW,
  HERO_TEMP_LINE_HEIGHT,
  HERO_TEMP_MAX_PX,
  HERO_TEMP_MIN_PX,
  HERO_TEMP_TRACKING,
  HERO_TEMP_WEIGHT,
  HERO_TEMP_UNIT_WEIGHT,
  SETPOINT_BORDER_PX,
  SETPOINT_INK_TARGET,
} from "../const";
import { tintOn, foregroundOn } from "./color-config";

export interface SetpointSurface {
  /** Wash to paint behind the pill/segment. */
  bg: string;
  /** Glyph + numeral colour, corrected for legibility against `bg`. */
  ink: string;
  /** Outline colour — the mode colour pulled back toward the surface. */
  line: string;
}

// Resolves the outline-and-wash trio for one mode colour. `opacity` is the
// card's per-card config override (undefined ⇒ the shared default), kept as a
// parameter so a card can expose it without this module knowing about configs.
//
// The outline goes through `tintOn` too rather than using the raw mode colour:
// a full-strength ring is what made the setpoint pill outshout the figure
// above it, and mixing it against the real surface keeps it a hairline in both
// a light and a dark theme instead of only one of them.
//
// `inkTarget` is the contrast ratio the ink is corrected to. It is a parameter
// because what sits on the wash differs per caller: a 22px numeral takes the
// graphics/large-text floor of 3, a 13px mode label takes 4.5. Passing the
// wrong one is invisible in review and only shows up in an audit of the
// rendered page — the mode button came back at 3.0 in the light theme.
export function resolveSetpointSurface(
  host: HTMLElement | undefined,
  modeColor: string,
  opacity: number | undefined,
  defaultPercent: number,
  linePercent: number,
  inkTarget: number = SETPOINT_INK_TARGET,
): SetpointSurface {
  const bg = tintOn(host, modeColor, opacity, defaultPercent);
  return {
    bg,
    ink: foregroundOn(modeColor, bg, inkTarget),
    line: tintOn(host, modeColor, undefined, linePercent),
  };
}

// Base rules for anything wearing the setpoint language. Geometry (size,
// radius, layout) stays with the card — the full card's pill and the mini
// card's segmented control are shaped differently on purpose — so only the
// colour recipe lives here.
//
// `--m3-setpoint-bg` / `--m3-setpoint-ink` / `--m3-setpoint-line` come from
// `resolveSetpointSurface()`; without them the class is inert, which is what
// an unavailable entity wants.
export const setpointSurfaceStyles = css`
  .setpoint-surface {
    background: var(--m3-setpoint-bg, transparent);
    color: var(--m3-setpoint-ink, var(--primary-text-color));
    border: ${unsafeCSS(SETPOINT_BORDER_PX)}px solid
      var(--m3-setpoint-line, transparent);
    box-sizing: border-box;
    font-variant-numeric: lining-nums tabular-nums;
  }
`;

// The dominant current-temperature figure.
//
// Cross-browser constraints below are lifted from the reference card's
// ADR-0005 (`reference/ecosee/docs/adr/0005-cross-browser-typography.md`),
// which paid for them with two bugs. Do not "tidy" them:
//
//  * `.temp` must be laid out `display: inline-block`, never as a flex or grid
//    item. Firefox does not reliably clip a `background-clip: text` gradient
//    inside a flex container and renders mangled digits. `.hero-temp` is
//    therefore a plain block with `text-align: center`, not a flex row.
//  * Keep both the unprefixed and `-webkit-` `background-clip`, over a solid
//    `color` fallback, so an engine without the gradient still paints ink.
//  * Keep the symmetric padding cancelled by equal negative margins: the
//    gradient paints only inside the border box, and with compact font metrics
//    the digit ink can sit within a whisker of the tight line box's edge.
//
// The sheen itself is ours, not ecosee's: it fades toward the card background
// instead of toward a fixed near-white, so it self-corrects between light and
// dark themes and never lets a wallpaper show through the glyphs.
export const heroTempStyles = css`
  .hero {
    /* An inline-size container so the figure scales with the card's column
       rather than the viewport. Deliberately on .hero and not on ha-card:
       container-type also applies contain: layout, which would trap the
       menus' position: fixed backdrop inside the card. .hero has no
       positioned descendants, so it is safe here. */
    container-type: inline-size;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
  }

  /* With the reading moved into the header chip
     (temperature_chip_placement: header) the block holds nothing but the
     humidity line, and letting it absorb the card's spare height would strand
     one 13px line in the middle of an empty field. */
  .hero.hum-only {
    flex: 0 0 auto;
  }

  .hero-hum {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    font-weight: 400;
    letter-spacing: 0.01em;
    color: var(--primary-text-color);
    opacity: 0.55;
  }

  .hero-hum ha-icon {
    --mdc-icon-size: 15px;
  }

  /* Plain block, not flex — see the Firefox note above. */
  .hero-temp {
    display: block;
    text-align: center;
    cursor: pointer;
    max-width: 100%;
  }

  .hero-temp:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: 4px;
    border-radius: 12px;
  }

  .hero-temp .value {
    display: inline-block;
    font-size: clamp(
      ${unsafeCSS(HERO_TEMP_MIN_PX)}px,
      ${unsafeCSS(HERO_TEMP_CQW)}cqw,
      ${unsafeCSS(HERO_TEMP_MAX_PX)}px
    );
    font-weight: ${unsafeCSS(HERO_TEMP_WEIGHT)};
    line-height: ${unsafeCSS(HERO_TEMP_LINE_HEIGHT)};
    letter-spacing: ${unsafeCSS(HERO_TEMP_TRACKING)};
    font-variant-numeric: lining-nums proportional-nums;
    color: var(--m3-hero-ink, var(--primary-text-color));
    /* Vertical padding only is cancelled: the horizontal ink safety can stay
       in the layout (the block is centred anyway), and cancelling it too
       dragged the unit back over the last digit. */
    padding: 0.16em 0.06em;
    margin: -0.16em 0;
  }

  @supports (background-clip: text) or (-webkit-background-clip: text) {
    .hero-temp .value {
      background: linear-gradient(
        180deg,
        var(--m3-hero-ink, var(--primary-text-color)) 10%,
        color-mix(
            in srgb,
            var(--m3-hero-ink, var(--primary-text-color)) 68%,
            var(--ha-card-background, var(--card-background-color))
          )
          88%
      );
      background-clip: text;
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
  }

  /* The unit rides along the top of the figure at a fraction of its size, so
     the number itself stays the thing you read. ecosee prints no unit at all;
     Home Assistant users switch between °C and °F, so it earns its place —
     just not at full weight. Now that the numeral itself carries the heaviest
     weight on the card, the unit goes the other way (a light 300) so the two
     read as one deliberate contrast rather than two similarly-bold shapes. */
  .hero-temp .unit {
    display: inline-block;
    vertical-align: top;
    margin-top: 0.35em;
    margin-left: 0.1em;
    font-size: clamp(15px, 6cqw, 21px);
    font-weight: ${unsafeCSS(HERO_TEMP_UNIT_WEIGHT)};
    letter-spacing: 0;
    color: var(--primary-text-color);
    opacity: 0.45;
  }
`;
