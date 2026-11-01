import { html, css, unsafeCSS, type TemplateResult } from "lit";
import { HEADING_ARROW, HEADING_ARROW_RADIUS, HEADING_ARROW_RADIUS_COLLAPSED, HEADING_ARROW_TINT, HEADING_COLLAPSE_MS } from "../const";
import { STANDARD_EASING } from "./animation";
import { foregroundOn, tintOn } from "./color-config";

// The chevron that says "this card folds".
//
// The heading card drew it first, the room card copied it, and the two vacuum
// cards made three — at which point a fourth hand-rolled copy is how a suite
// stops looking like one thing. It is a small shape, but it is a shape people
// learn: a 26px tinted square that becomes a circle when the card is folded,
// with the chevron turning to point the way it will move.
//
// The radius morph is the part worth keeping honest. Folded is the *circle*,
// not the square: a folded card is a closed thing, and the roundest shape
// reads that way without needing a second colour.

export interface FoldArrowOptions {
  folded: boolean;
  /** Tinted from this, so the arrow belongs to whatever the card is showing. */
  accent: string;
  /** The element resolving the tint — needed for the theme-aware mix. */
  host: HTMLElement;
  label: string;
  onToggle: (e: Event) => void;
}

export function renderFoldArrow(options: FoldArrowOptions): TemplateResult {
  const background = tintOn(options.host, options.accent, undefined, HEADING_ARROW_TINT);
  return html`
    <button
      class="m3-fold ${options.folded ? "folded" : ""}"
      style=${`background: ${background}; color: ${foregroundOn(options.accent, background, 3, options.host)};`}
      aria-expanded=${String(!options.folded)}
      aria-label=${options.label}
      @click=${options.onToggle}
    >
      <ha-icon icon="mdi:chevron-down"></ha-icon>
    </button>
  `;
}

export const foldArrowStyles = css`
  .m3-fold {
    flex: 0 0 auto;
    width: ${HEADING_ARROW}px;
    height: ${HEADING_ARROW}px;
    border: none;
    border-radius: ${HEADING_ARROW_RADIUS}px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    --mdc-icon-size: 18px;
    transition: border-radius ${HEADING_COLLAPSE_MS}ms ${unsafeCSS(STANDARD_EASING)};
  }

  /* The icon turns, not the button — rotating the whole thing would carry the
     square's corners round with it and read as a spin rather than a fold. */
  .m3-fold ha-icon {
    transition: transform ${HEADING_COLLAPSE_MS}ms ${unsafeCSS(STANDARD_EASING)};
  }

  .m3-fold.folded {
    border-radius: ${HEADING_ARROW_RADIUS_COLLAPSED}px;
  }

  .m3-fold.folded ha-icon {
    transform: rotate(-90deg);
  }

  @media (prefers-reduced-motion: reduce) {
    .m3-fold,
    .m3-fold ha-icon {
      transition: none;
    }
  }
`;

// The fold inside a status pill: the pill says what the card is doing and,
// with a chevron at its end, is also the control that opens it — one element
// in the corner instead of a figure and a separate arrow beside it.

/** The chevron a pill carries when it folds the card; it turns when open. */
export function renderPillChevron(folded: boolean): TemplateResult {
  return html`<ha-icon class="pill-chevron ${folded ? "" : "open"}" icon="mdi:chevron-down"></ha-icon>`;
}

export const pillChevronStyles = css`
  .pill-chevron {
    display: flex;
    --mdc-icon-size: 16px;
    width: 16px;
    height: 16px;
    margin-left: 2px;
    margin-right: -2px;
    transition: transform 0.3s ${unsafeCSS(STANDARD_EASING)};
  }

  .pill-chevron.open {
    transform: rotate(180deg);
  }

  button.pill-toggle {
    border: none;
    font-family: inherit;
    cursor: pointer;
  }

  button.pill-toggle:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 2px;
  }

  .no-animations .pill-chevron {
    transition: none;
  }
`;

/** How long the card takes to grow or shrink into its folded or open height. */
export const FOLD_EASE_MS = 320;

/**
 * Eases a card from the height it had before a fold to the one it has after.
 *
 * The cards fold by leaving blocks out of the render, so the change itself is
 * instant; this plays it back as a movement — the card grows or shrinks, and
 * what appears is uncovered by the growing edge rather than popping in. Call
 * it with the height measured before the change, once the update is done.
 * Nothing happens under reduced motion, with `animation: off`, or when the
 * height did not change.
 */
export function easeFoldHeight(inner: HTMLElement | null, before: number, allowed: boolean): void {
  if (!inner || !allowed || !before) return;
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const after = inner.offsetHeight;
  if (!after || Math.abs(after - before) < 2) return;
  inner.animate(
    [
      { height: `${before}px`, overflow: "hidden" },
      { height: `${after}px`, overflow: "hidden" },
    ],
    { duration: FOLD_EASE_MS, easing: STANDARD_EASING },
  );
}
