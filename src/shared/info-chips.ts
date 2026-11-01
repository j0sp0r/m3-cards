import { css, html, nothing, unsafeCSS, type TemplateResult } from "lit";
import type { ApplianceChipConfig, HassEntity, HaActionConfig, HomeAssistant, InfoChipHeading } from "../types";
import {
  APPLIANCE_CHIP_GAP,
  APPLIANCE_CHIP_HEIGHT,
  APPLIANCE_CHIP_RADIUS,
  APPLIANCE_CHIP_RADIUS_ACTIVE,
  APPLIANCE_CHIP_TINT,
  APPLIANCE_TILE_GLYPH,
  APPLIANCE_TILE_HEIGHT,
  APPLIANCE_TILE_ICON,
  APPLIANCE_TILE_ICON_RADIUS_ON,
  APPLIANCE_TILE_INSET,
  APPLIANCE_TILE_RADIUS_ON,
  APPLIANCE_TILE_MIN_WIDTH,
  APPLIANCE_TILE_RADIUS,
} from "../const";
import { activateOnKey } from "./a11y";
import { isActionable } from "./actions";
import { STANDARD_EASING } from "./animation";
import { prettifyState } from "./appliance";
import { buildCssVars, foregroundColor, foregroundOn, inkOn, resolveThemeColor, tintOn } from "./color-config";
import { isMissingState, isOnState } from "./entity-actions";
import { formatNumber } from "./formatting";
import { findStateRule, numericState } from "./state-rules";
import { glassBackground } from "./glass-card";

/**
 * Extra readings a card shows as pills or tiles: any entity, its name and its
 * state, optionally recoloured by state rules and made tappable. Started as the
 * appliance card's `chips`; the printer card carries the same option, so the
 * rendering and the styles live here and both cards draw them alike.
 */
export type InfoChipConfig = ApplianceChipConfig;

export type InfoChipStyle = "pill" | "tile";

export interface InfoChipContext {
  /** The card: colours are measured against its surface. */
  host: HTMLElement;
  hass: HomeAssistant | undefined;
  language: string;
  style?: InfoChipStyle;
  /** The colour a chip takes when neither it nor a rule names one. */
  accent: string;
  run: (action: HaActionConfig | undefined, entityId: string) => void;
}

/** Domains whose chip reports a pressed state when it is on. */
const TOGGLE_DOMAINS = new Set(["switch", "input_boolean", "light", "fan", "siren", "lock"]);

/** Domains that are on or off without being switched from the tile. */
const ON_OFF_DOMAINS = new Set(["binary_sensor"]);

/** Home Assistant's own wording for a state, when it has any. */
function translated(hass: HomeAssistant | undefined, st: HassEntity, value: string): string | undefined {
  const format = hass?.formatEntityState;
  if (!format) return undefined;
  const text = format({ ...st, state: value });
  return text && text !== value ? text : undefined;
}

/** A state nobody wrote a rule for, tidied up rather than shown as `heavy_duty`. */
export function chipStateText(
  hass: HomeAssistant | undefined,
  language: string,
  st: HassEntity | undefined,
  raw: string,
): string {
  const numeric = numericState(raw);
  if (numeric === undefined) return (st && translated(hass, st, raw)) ?? prettifyState(raw);
  const unit = st?.attributes?.unit_of_measurement as string | undefined;
  const decimals = Math.min(2, (raw.split(/[.,]/)[1] ?? "").length);
  const value = formatNumber(language, numeric, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return unit ? `${value} ${unit}` : value;
}

export function isChipHeading(entry: InfoChipConfig | InfoChipHeading): entry is InfoChipHeading {
  return typeof (entry as InfoChipHeading).heading === "string" && !(entry as InfoChipConfig).entity;
}

export function renderInfoChips(
  chips: (InfoChipConfig | InfoChipHeading)[] | undefined,
  ctx: InfoChipContext,
): TemplateResult | typeof nothing {
  // A heading is only drawn when a chip follows it before the next heading:
  // a divider over a group whose entities are all unreadable labels nothing.
  const rendered: TemplateResult[] = [];
  let pending: InfoChipHeading | undefined;
  for (const entry of chips ?? []) {
    if (isChipHeading(entry)) {
      pending = entry;
      continue;
    }
    const chip = renderInfoChip(entry, ctx);
    if (!chip) continue;
    if (pending) {
      rendered.push(html`<div class="chip-heading">
        ${pending.icon ? html`<ha-icon icon=${pending.icon}></ha-icon>` : nothing}<span>${pending.heading}</span>
      </div>`);
      pending = undefined;
    }
    rendered.push(chip);
  }
  if (rendered.length === 0) return nothing;
  return html`<div class="chip-row ${ctx.style === "tile" ? "tiles" : ""}">${rendered}</div>`;
}

function renderInfoChip(cfg: InfoChipConfig, ctx: InfoChipContext): TemplateResult | undefined {
  const st = ctx.hass?.states[cfg.entity];
  // An unreadable chip is left out rather than dimmed: a row of "—" says
  // nothing and pushes the ones that do say something off the edge.
  if (!st || isMissingState(st.state)) return undefined;

  const raw = st.state;
  const rule = findStateRule(cfg.states, raw, numericState(raw));
  const name = cfg.name ?? (st.attributes?.friendly_name as string | undefined);
  const valueText =
    cfg.show_state === false ? undefined : (rule?.label ?? chipStateText(ctx.hass, ctx.language, st, raw));
  const text = cfg.label ?? ([name, valueText].filter(Boolean).join(" ") || cfg.entity);

  // A tile is a reading, not the machine's state: it keeps the card's base
  // colour while the state rules recolour the header and the bar. Following
  // the state turned every tile grey whenever the machine stood idle.
  const color = resolveThemeColor(rule?.color ?? cfg.color ?? ctx.accent);
  const host = ctx.host;
  const tint = tintOn(host, color, undefined, APPLIANCE_CHIP_TINT);
  const icon = rule?.icon ?? cfg.icon;
  const vars = buildCssVars({
    "m3a-chip": color,
    "m3a-chip-tint": tint,
    "m3a-chip-fg": foregroundOn(color, tint, 4.5, host),
    // An information chip has no fill, so its text sits on the card itself —
    // checked against that, not against a tint that is no longer drawn.
    "m3a-chip-text": foregroundColor(host, color),
    "m3a-chip-ink": inkOn(color, host),
    // The tile's well, as the button card's: a wash of the colour carrying the
    // colour as its glyph, and the solid colour with dark or white ink once on.
    "m3a-well": tintOn(host, color, undefined, 20),
    "m3a-well-ink": foregroundOn(color, tintOn(host, color, undefined, 20), 3, host),
  });
  const tile = ctx.style === "tile";
  // Anything with an on and an off reads that way, whether or not the tile can
  // switch it: the well is grey while off, and on, the tile and its well
  // square up and fill, as the room's button cards do. That includes binary
  // sensors — a door, a child lock, a leak — which have the two states and
  // were drawn as plain readings, round and tinted, whatever they said.
  const domain = cfg.entity.split(".")[0];
  const switchy = TOGGLE_DOMAINS.has(domain) || ON_OFF_DOMAINS.has(domain) || cfg.tap_action?.action === "toggle";
  const power = switchy ? (isOnState(raw) ? "on" : "off") : "";
  const body = tile
    ? html`
        ${icon ? html`<span class="tile-icon"><ha-icon icon=${icon}></ha-icon></span>` : nothing}
        <span class="tile-text">
          ${name ? html`<span class="tile-name">${name}</span>` : nothing}
          <span class="tile-value">${cfg.label ?? valueText ?? cfg.entity}</span>
        </span>
      `
    : html`${icon ? html`<ha-icon icon=${icon}></ha-icon>` : nothing}<span>${text}</span>`;

  if (!cfg.tap_action || !isActionable(cfg.tap_action)) {
    return html`<span class="chip ${tile ? `tile ${power}` : ""}" style=${vars}>${body}</span>`;
  }

  // Only a chip that actually switches something reports a pressed state.
  // A chip whose tap navigates or opens more-info is a link, and announcing
  // it as a toggle would be a lie a screen reader has no way to see through.
  const togglish = cfg.tap_action.action === "toggle" || TOGGLE_DOMAINS.has(cfg.entity.split(".")[0]);
  const on = togglish && isOnState(raw);
  const onTap = (e: Event): void => {
    e.stopPropagation();
    ctx.run(cfg.tap_action, cfg.entity);
  };
  return html`
    <button
      class="chip control ${tile ? `tile ${power}` : ""} ${on && !tile ? "active" : ""}"
      type="button"
      style=${vars}
      aria-label=${text}
      aria-pressed=${togglish ? (on ? "true" : "false") : nothing}
      @click=${onTap}
      @keydown=${activateOnKey(onTap)}
    >
      ${body}
    </button>
  `;
}

const EASING = unsafeCSS(STANDARD_EASING);

export const infoChipStyles = css`
  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: ${APPLIANCE_CHIP_GAP}px;
  }

  /* chip_style: tile — the figures as tiles: name small, value large, in a
     grid that gives two columns on a phone and more on a wide card. */
  .chip-row.tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(${APPLIANCE_TILE_MIN_WIDTH}px, 1fr));
  }

  /* A divider spans the row in either style: the full grid width for tiles,
     a line of its own among wrapping pills. */
  .chip-heading {
    grid-column: 1 / -1;
    flex-basis: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--m3p-secondary-text);
  }

  .chip-heading:first-child {
    margin-top: 0;
  }

  .chip-heading ha-icon {
    --mdc-icon-size: 16px;
    width: 16px;
    height: 16px;
  }

  /* A tile is drawn as the button card draws itself — the room card's
     buttons are button cards, and the two sat side by side in two designs:
     its height, its rim and corner, a round well at the same inset, the name
     bold with the reading under it. */
  .chip.tile {
    height: auto;
    min-height: ${APPLIANCE_TILE_HEIGHT}px;
    padding: 4px 14px 4px ${APPLIANCE_TILE_INSET}px;
    gap: 14px;
    border: 1px solid rgba(100, 100, 100, 0.25);
    border-radius: ${APPLIANCE_TILE_RADIUS}px;
    justify-content: flex-start;
    text-align: left;
    /* A read-only tile is a span and inherits the card's line height; a
       tile with an action is a button, which does not. Set once, so the two
       are the same height side by side. */
    line-height: 1.25;
    min-width: 0;
    background: ${glassBackground};
    color: var(--m3p-text, var(--primary-text-color));
    font-weight: 400;
    transition: border-radius 0.3s ${EASING};
  }

  /* On, the whole tile squares up, not only its well — a button card with
     shape_by_state does both, and the room's buttons are set up that way. */
  .chip.tile.on {
    border-radius: ${APPLIANCE_TILE_RADIUS_ON}px;
  }

  /* A tappable tile is still a tile: the pill's filled "control" look is
     for pills. The well says on or off; the press shrinks it a little, as a
     button card does. */
  .chip.tile.control {
    border: 1px solid rgba(100, 100, 100, 0.25);
    background: ${glassBackground};
    color: var(--m3p-text, var(--primary-text-color));
    font-weight: 400;
    transition:
      transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
      border-radius 0.3s ${EASING};
  }

  .chip.tile.control.on {
    border-radius: ${APPLIANCE_TILE_RADIUS_ON}px;
  }

  .chip.tile.control:active {
    transform: scale(0.96);
  }

  .tile-icon {
    flex: none;
    width: ${APPLIANCE_TILE_ICON}px;
    height: ${APPLIANCE_TILE_ICON}px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--m3a-well, color-mix(in srgb, var(--m3a-chip, var(--m3p-secondary-text)) 20%, transparent));
    color: var(--m3a-well-ink, var(--m3a-chip-text, var(--m3p-secondary-text)));
    transition:
      background 0.25s ease,
      color 0.25s ease,
      border-radius 0.3s ${EASING};
  }

  /* Off reads in the theme's outline colour, as the room's buttons are set
     up (inactive_color: outline), on an 8% wash of it. */
  .tile.off .tile-icon {
    background: color-mix(
      in srgb,
      var(--md-sys-color-outline, var(--m3p-secondary-text, var(--secondary-text-color))) 8%,
      transparent
    );
    color: var(--md-sys-color-outline, var(--m3p-secondary-text, var(--secondary-text-color)));
  }

  .tile.on .tile-icon {
    border-radius: ${unsafeCSS(APPLIANCE_TILE_ICON_RADIUS_ON)};
    background: var(--m3a-chip);
    color: var(--m3a-chip-ink);
  }

  /* Three classes deep on purpose: the pill's ".chip ha-icon" further down
     sets 16px, and at equal weight it won by coming later — the tiles drew
     a pill's icon in a button's well. */
  .chip.tile .tile-icon ha-icon {
    --mdc-icon-size: ${APPLIANCE_TILE_GLYPH}px;
    width: ${APPLIANCE_TILE_GLYPH}px;
    height: ${APPLIANCE_TILE_GLYPH}px;
  }

  .tile-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 2px;
  }

  .tile-name {
    font-size: 15px;
    font-weight: 700;
    color: var(--m3p-text, var(--primary-text-color));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tile-value {
    font-size: 13px;
    font-weight: 400;
    opacity: 0.7;
    color: var(--m3p-text, var(--primary-text-color));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Filled means it can be pressed; outlined means it is telling you
     something — the rule the vacuum and printer cards follow. An information
     chip has a rim in its own colour and no fill; a chip with a tap_action is
     a control and stays filled. */
  .chip {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: ${APPLIANCE_CHIP_HEIGHT}px;
    padding: 0 12px;
    border: 1px solid color-mix(in srgb, var(--m3a-chip, var(--m3p-secondary-text)) 40%, transparent);
    border-radius: ${APPLIANCE_CHIP_RADIUS}px;
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
    color: var(--m3a-chip-text, var(--m3p-secondary-text));
    background: transparent;
    transition:
      border-radius 0.35s ${EASING},
      background 0.35s ${EASING},
      border-color 0.35s ${EASING},
      color 0.35s ${EASING};
  }

  .chip ha-icon {
    --mdc-icon-size: 16px;
    width: 16px;
    height: 16px;
  }

  .chip.control {
    cursor: pointer;
    border-color: transparent;
    font-weight: 600;
    color: var(--m3a-chip-fg, var(--m3p-secondary-text));
    background: var(--m3a-chip-tint, color-mix(in srgb, var(--m3p-secondary-text) 8%, transparent));
  }

  .chip.control.active {
    border-radius: ${APPLIANCE_CHIP_RADIUS_ACTIVE}px;
    background: var(--m3a-chip);
    color: var(--m3a-chip-ink);
  }

`;
