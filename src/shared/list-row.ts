import { html, css, unsafeCSS, nothing, type TemplateResult } from "lit";
import { STANDARD_EASING } from "./animation";
import { activateOnKey } from "./a11y";
import { foregroundOn, tintOn } from "./color-config";

// Shared row-pill component for the M3 list-style cards (power-list,
// top-consumers, battery, ...): a squircle icon, a flexible middle slot
// (name, optional secondary content like a progress bar), and an optional
// right-aligned value slot, with FLIP-reorder support baked in via
// data-row-key.

const EASING = unsafeCSS(STANDARD_EASING);

export interface ListRowParams {
  key: string;
  icon: string;
  iconColor: string;
  iconBackground: string;
  middle: TemplateResult;
  right?: TemplateResult;
  barFraction?: number;
  barColor?: string;
  onClick?: (e: Event) => void;
  /** Accessible name for the row, e.g. the entity's display name. Falls
   * back to `key` (the entity id) if omitted. */
  label?: string;
  extraClass?: string;
  style?: string;
  /** Overrides the row's own background. */
  rowBackground?: string;
  /** The card element, so the bar tint can be resolved against the actual
   * card surface. Without it the tint falls back to a plain CSS mix. */
  host?: HTMLElement;
}

/**
 * The surface a row actually draws on, so a card can measure the ink it puts
 * in `middle` or `right` against the row rather than against the card.
 *
 * The row's own wash was the last place still mixing toward transparent, which
 * both made it depend on whatever sits behind the card and left it unparseable
 * for the contrast helpers — so a coloured row value stayed at 1.73:1 in a
 * light theme.
 */
export function listRowSurface(host?: HTMLElement, override?: string): string {
  return override ?? tintOn(host, "var(--primary-text-color)", undefined, 6);
}

export function renderListRow(p: ListRowParams): TemplateResult {
  const barPct = p.barFraction !== undefined ? Math.max(0, Math.min(100, p.barFraction * 100)) : undefined;
  const interactive = !!p.onClick;
  return html`
    <div
      class="lr-row ${p.extraClass ?? ""}"
      data-row-key=${p.key}
      style=${`--lr-row-bg: ${listRowSurface(p.host, p.rowBackground)}; ${p.style ?? ""}`}
      role=${interactive ? "button" : nothing}
      tabindex=${interactive ? "0" : nothing}
      aria-label=${interactive ? (p.label ?? p.key) : nothing}
      @click=${p.onClick}
      @keydown=${interactive && p.onClick ? activateOnKey(p.onClick) : nothing}
    >
      ${barPct !== undefined
        ? html`<div class="lr-bar-fill" style=${`width: ${barPct}%; background: ${tintOn(p.host, p.barColor ?? p.iconColor, undefined, 16)};`}></div>`
        : nothing}
      <div
        class="lr-icon"
        style=${`--lr-icon-color: ${foregroundOn(p.iconColor, p.iconBackground, 3, p.host)}; --lr-icon-bg: ${p.iconBackground};`}
      >
        <ha-icon icon=${p.icon}></ha-icon>
      </div>
      <div class="lr-middle">${p.middle}</div>
      ${p.right ? html`<div class="lr-right">${p.right}</div>` : nothing}
    </div>
  `;
}

// Captures the current [data-row-key] positions before a re-render, so
// flipRows() can animate from the old to the new layout afterward.
export function captureRowRects(
  renderRoot: DocumentFragment | Element | null | undefined,
): Map<string, DOMRect> {
  const map = new Map<string, DOMRect>();
  const rows = renderRoot?.querySelectorAll<HTMLElement>("[data-row-key]");
  if (!rows) return map;
  for (const el of Array.from(rows)) {
    const key = el.dataset.rowKey;
    if (key) map.set(key, el.getBoundingClientRect());
  }
  return map;
}

// FLIP-lite: inverts each row's transform back to its pre-render position,
// then animates it to identity on the next frame.
export function flipRows(
  renderRoot: DocumentFragment | Element | null | undefined,
  prevRects: Map<string, DOMRect>,
  durationMs: number,
): void {
  const rows = renderRoot?.querySelectorAll<HTMLElement>("[data-row-key]");
  if (!rows) return;
  for (const el of Array.from(rows)) {
    const key = el.dataset.rowKey;
    if (!key) continue;
    const prev = prevRects.get(key);
    if (!prev) continue;
    const next = el.getBoundingClientRect();
    const deltaY = prev.top - next.top;
    if (Math.abs(deltaY) < 1) continue;
    el.style.transition = "none";
    el.style.transform = `translateY(${deltaY}px)`;
    requestAnimationFrame(() => {
      el.style.transition = `transform ${durationMs}ms ${STANDARD_EASING}`;
      el.style.transform = "";
    });
  }
}

export const listRowStyles = css`
  .row-list {
    display: flex;
    flex-direction: column;
    gap: var(--lr-row-gap, 6px);
  }

  .lr-row {
    position: relative;
    height: var(--lr-row-height, 48px);
    border-radius: var(--lr-row-radius, 16px);
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 12px;
    overflow: hidden;
    cursor: pointer;
    box-sizing: border-box;
    background: var(--lr-row-bg, color-mix(in srgb, var(--primary-text-color) 6%, var(--ha-card-background, var(--card-background-color))));
    transition: border-radius 350ms ${EASING};
  }

  .lr-row:active {
    border-radius: var(--lr-row-radius-active, 10px);
  }

  .lr-row:focus-visible {
    outline: 2px solid var(--lr-icon-color, var(--primary-color));
    outline-offset: 2px;
  }

  .card-inner.no-animations .lr-row {
    transition: none;
  }

  .lr-bar-fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: inherit;
    pointer-events: none;
  }

  .lr-icon {
    position: relative;
    flex-shrink: 0;
    width: var(--lr-icon-size, 30px);
    height: var(--lr-icon-size, 30px);
    border-radius: var(--lr-icon-radius, 11px);
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--lr-icon-bg);
    color: var(--lr-icon-color);
  }

  .lr-icon ha-icon {
    --mdc-icon-size: 16px;
  }

  .lr-middle {
    position: relative;
    flex: 1;
    min-width: 0;
  }

  .lr-right {
    position: relative;
    flex-shrink: 0;
  }

  /* Safari gained color-mix() in 16.2, and an iPod touch 7 or an iPad Air 2
     stops at iOS 15. A plain declaration before each mix cannot serve as the
     fallback: every one of them contains var(), which defers the check until
     after substitution, where failure yields unset rather than the previous
     declaration — the tint did not fade, the fill disappeared entirely. This
     block is the one those browsers alone can see; the tint is what it gives
     up. Backticks are not allowed in here: this is a css template literal. */
  @supports not (color: color-mix(in srgb, red 50%, blue)) {
    .lr-row {
      background: var(--lr-row-bg, var(--ha-card-background, var(--card-background-color)));
    }
  }
  `;
