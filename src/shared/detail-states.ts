// The detail card's view of an entity that has states rather than a number:
// a timeline of stretches, and either two tiles (a pair like on/off) or a
// list of how long each state lasted.
//
// Kept out of m3-detail-card.ts so the card stays about choosing a layout and
// fetching for it; everything here is a pure function of what it is handed.

import { css, html, nothing, type TemplateResult } from "lit";
import { PALETTE } from "./tokens";
import { tintOn } from "./color-config";
import { formatNumber, formatSpan, formatSpanParts } from "./formatting";
import { parseColor } from "./contrast";
import { isMissingState, type StateSegment, type StateShare } from "./state-timeline";

/** The state of a pair that is the active one — what gets the accent. */
const ACTIVE = new Set(["on", "open", "unlocked", "home", "playing", "heat", "cool", "cleaning"]);

export function isActiveState(state: string): boolean {
  return ACTIVE.has(state);
}

/**
 * A colour per state.
 *
 * A pair is the accent for its active half and a quiet neutral for the other,
 * so a door's timeline is a line of "when was it open". More states take the
 * accent for the most frequent and then walk the palette; past its end
 * everything is grey, because an eleventh hue is not a distinction anyone can
 * read.
 */
export function stateColors(
  host: HTMLElement,
  shares: readonly StateShare[],
  accent: string,
  twoState: boolean,
): Map<string, string> {
  const out = new Map<string, string>();
  const neutral = tintOn(host, "var(--primary-text-color)", undefined, 22);
  if (twoState) {
    for (const s of shares) out.set(s.state, isActiveState(s.state) ? accent : neutral);
    return out;
  }
  // Neighbours in the palette are chosen to differ in hue, and any that sits
  // too close to the accent is skipped: the house blue and the cooling blue
  // are 30 apart in RGB and read as one colour in a thin stretch.
  const palette = [accent];
  for (const c of [PALETTE.dryAuto, PALETTE.media, PALETTE.light, PALETTE.heat, PALETTE.grid, PALETTE.solar, PALETTE.cool]) {
    if (palette.every((p) => colorDistance(p, c) > 60)) palette.push(c);
  }
  shares.forEach((s, i) => out.set(s.state, palette[i] ?? PALETTE.off));
  return out;
}

function colorDistance(a: string, b: string): number {
  const x = parseColor(a);
  const y = parseColor(b);
  // An accent given as a theme variable cannot be measured; assume distinct.
  if (!x || !y) return Infinity;
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/**
 * The bar. Stretches are placed by time, not laid end to end, so a gap where
 * the entity was unavailable is a gap and not a squeezed neighbour.
 */
export function renderTimeline(params: {
  segments: readonly StateSegment[];
  t0: number;
  t1: number;
  colors: Map<string, string>;
  stale: boolean;
  label: (state: string) => string;
}): TemplateResult {
  const { segments, t0, t1, colors, stale, label } = params;
  const span = t1 - t0;
  return html`
    <div class="timeline ${stale ? "stale" : ""}" role="img">
      <div class="track">
      ${segments.map((s) => {
        const left = ((s.from - t0) / span) * 100;
        const width = ((s.to - s.from) / span) * 100;
        if (isMissingState(s.state)) {
          return html`<span class="seg missing" style="left:${left}%;width:${width}%"></span>`;
        }
        return html`<span
          class="seg"
          title=${label(s.state)}
          style="left:${left}%;width:max(1px, ${width}%);background:${colors.get(s.state) ?? PALETTE.off}"
        ></span>`;
      })}
      </div>
    </div>
  `;
}

/** Time in each half of a pair, active first, then the changes since midnight. */
export function renderPairTiles(params: {
  shares: readonly StateShare[];
  changes: number;
  colors: Map<string, string>;
  language: string;
  label: (state: string) => string;
  changesLabel: string;
  inkFor: (color: string) => string;
}): TemplateResult {
  const { shares, changes, colors, language, label, changesLabel, inkFor } = params;
  const ordered = [...shares].sort((a, b) => Number(isActiveState(b.state)) - Number(isActiveState(a.state)));
  return html`
    <div class="tiles pair" style="grid-template-columns: repeat(${ordered.length + 1}, minmax(0, 1fr))">
      ${ordered.map(
        (s) => html`<div class="tile">
          <div class="tile-value" style="color:${inkFor(colors.get(s.state) ?? PALETTE.off)}">
            ${formatSpanParts(s.ms, language).map((part, i) => html`${i ? " " : ""}<span class="unit-part">${part}</span>`)}
          </div>
          <div class="tile-label">${label(s.state)}</div>
        </div>`,
      )}
      <div class="tile">
        <div class="tile-value">${changes}</div>
        <div class="tile-label">${changesLabel}</div>
      </div>
    </div>
  `;
}

/** How long each state lasted, longest first, with its share of the window. */
export function renderShares(params: {
  shares: readonly StateShare[];
  colors: Map<string, string>;
  language: string;
  label: (state: string) => string;
  max: number;
}): TemplateResult | typeof nothing {
  const { shares, colors, language, label, max } = params;
  const total = shares.reduce((a, s) => a + s.ms, 0);
  if (!total) return nothing;
  return html`
    <div class="shares">
      ${shares.slice(0, max).map(
        (s) => html`<div class="share">
          <span class="dot" style="background:${colors.get(s.state) ?? PALETTE.off}"></span>
          <span class="share-name">${label(s.state)}</span>
          <span class="share-time">${formatSpan(s.ms, language)}</span>
          <span class="share-pct">${sharePercent(s.ms / total, language)}</span>
        </div>`,
      )}
    </div>
  `;
}

/** "37 %", and "< 1 %" rather than a zero for a state that did happen. */
function sharePercent(ratio: number, language: string): string {
  const pct = (r: number) => formatNumber(language, r, { style: "percent", maximumFractionDigits: 0 });
  return ratio > 0 && ratio < 0.005 ? `< ${pct(0.01)}` : pct(ratio);
}

export const detailStateStyles = css`
  .timeline {
    position: relative;
    height: 32px;
    border-radius: 10px;
    overflow: hidden;
    background: var(--dc-button-bg);
    transition: opacity 300ms;
  }
  .timeline.stale {
    opacity: 0.4;
  }
  /* What the period switch scales; anchored at "now", which is the one
     point both periods share. */
  .track {
    position: absolute;
    inset: 0;
    transform-origin: right center;
  }
  .seg {
    position: absolute;
    top: 0;
    bottom: 0;
  }
  /* Unavailable: hatched, so it reads as "no data" rather than as a state. */
  .seg.missing {
    background: repeating-linear-gradient(
      -45deg,
      transparent 0 4px,
      color-mix(in srgb, var(--primary-text-color) 14%, transparent) 4px 6px
    );
  }

  /* A duration is two units long; on a phone it takes two lines rather than
     an ellipsis. */
  .tiles.pair .tile-value {
    font-size: 15px;
    white-space: normal;
    line-height: 1.2;
    /* Always room for two lines, so "3 Min." and "23 Std. 57 Min." give the
       row the same height and a period switch does not move what is under
       it. Centred, so the one-line case does not hang at the top. */
    min-height: 2.4em;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    column-gap: 0.25em;
  }

  .unit-part {
    white-space: nowrap;
  }

  .shares {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .share {
    display: grid;
    grid-template-columns: 10px minmax(0, 1fr) auto 48px;
    align-items: center;
    gap: 10px;
    min-height: 40px;
    padding: 0 14px;
    border-radius: 15px;
    background: var(--dc-button-bg);
    font-size: 13px;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .share-name {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .share-time {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .share-pct {
    text-align: right;
    opacity: 0.55;
    font-variant-numeric: tabular-nums;
  }
`;
