import { html, css, nothing, type TemplateResult } from "lit";
import type { HomeAssistant, HassEntity, ChipButtonConfig, ChipButtonsRowConfig } from "../types";
import { STATELESS_DOMAINS, ACTIVE_STATES, CHIP_BUTTON_HEIGHT, CHIP_BUTTON_ICON_SIZE } from "../const";
import { RADIUS } from "./tokens";
import { resolveThemeColor, tintOn, foregroundOn } from "./color-config";
import { runHaAction, navigateTo, type RunActionContext } from "./actions";
import { defaultEntityAction } from "./entity-actions";
import type { TapHoldGesture } from "./gestures";
import { stopSwipe } from "./swipe";

// Renders a horizontal row of tappable "chip button" chips — the M3 answer to
// Bubble Card's sub-buttons feature (see .claude/docs/NOTES.md). Lives in
// shared/ rather than only on m3-chip-buttons-card so any card can embed a
// chip row later, matching this project's "gemeinsame Logik IMMER hier"
// convention (CLAUDE.md).

export interface ChipButtonsRenderState {
  /** Key of the chip currently mid-press, for the `.pressed` scale cue. */
  pressedKey?: string;
  /** Owned by the consuming card; one instance shared across every chip. */
  gestures: TapHoldGesture;
  onPressChange: (key: string | undefined) => void;
}

function fireMoreInfo(host: EventTarget, entityId?: string): void {
  if (!entityId) return;
  host.dispatchEvent(
    new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId } }),
  );
}

function isActive(entity: HassEntity | undefined, domain: string): boolean {
  if (!entity) return false;
  if (STATELESS_DOMAINS.has(domain)) return true;
  return ACTIVE_STATES.has(entity.state);
}

function chipKey(button: ChipButtonConfig, index: number): string {
  return button.entity ?? `#${index}`;
}

// The color HA's own frontend theme assigns this domain/state pair — the
// same `--state-<domain>-<state>-color` custom properties the native tile
// card colors itself with. Falls back through the domain-only var, then the
// generic active color, then the theme accent, so an undefined var never
// leaves the chip transparent.
function entityStateColorVar(domain: string, entityState: string): string {
  return `var(--state-${domain}-${entityState}-color, var(--state-${domain}-color, var(--state-active-color, var(--primary-color))))`;
}

const INACTIVE_ENTITY_COLOR_VAR =
  "var(--state-inactive-color, var(--disabled-text-color, var(--primary-text-color)))";

// The three ways a row can handle more chips than fit: stretched to share the
// width, wrapped onto a second line, or kept on one line and scrolled.
export function chipRowLayoutClass(config: ChipButtonsRowConfig): "stretch" | "wrap" | "scroll" {
  return config.stretch ? "stretch" : config.wrap ? "wrap" : "scroll";
}

// The row config a card that *embeds* a chip row derives from its own options,
// as opposed to m3-chip-buttons-card, which is configured as a row directly.
// `chip_buttons_layout` defaults to wrapping, which is what embedded rows did
// before the option existed.
export function embeddedChipRowConfig(config: {
  chip_buttons?: ChipButtonConfig[];
  chip_buttons_layout?: "wrap" | "scroll";
}): ChipButtonsRowConfig {
  return {
    buttons: config.chip_buttons ?? [],
    wrap: config.chip_buttons_layout !== "scroll",
  };
}

// `chip_buttons_justify` in a card's own vocabulary, as the flexbox value the
// row is laid out with. Defaults to the right edge, where an embedded row sits
// next to the card's content.
export function chipRowJustify(justify: "start" | "center" | "end" | undefined): string {
  if (justify === "start") return "flex-start";
  if (justify === "center") return "center";
  return "flex-end";
}

export function renderChipButtons(
  host: HTMLElement,
  hass: HomeAssistant,
  config: ChipButtonsRowConfig,
  state: ChipButtonsRenderState,
): TemplateResult {
  const buttons = config.buttons ?? [];
  const layoutClass = chipRowLayoutClass(config);
  return html`
    <div
      class="m3-chip-buttons ${layoutClass}"
      style=${`justify-content: ${config.justify ?? "start"};`}
      @touchstart=${stopSwipe}
      @touchmove=${stopSwipe}
      @touchend=${stopSwipe}
      @mousedown=${stopSwipe}
      @mousemove=${stopSwipe}
      @mouseup=${stopSwipe}
    >
      ${buttons.map((button, index) =>
        renderChipButton(host, hass, button, chipKey(button, index), state),
      )}
    </div>
  `;
}

function renderChipButton(
  host: HTMLElement,
  hass: HomeAssistant,
  button: ChipButtonConfig,
  key: string,
  state: ChipButtonsRenderState,
): TemplateResult {
  const entity = button.entity ? hass.states[button.entity] : undefined;
  const domain = button.entity?.split(".")[0] ?? "";
  const unavailable = entity?.state === "unavailable";
  const active = button.static_color === true || (!unavailable && isActive(entity, domain));
  const activeColor = button.use_entity_color
    ? entityStateColorVar(domain || "state", entity?.state ?? "on")
    : resolveThemeColor(button.color || "primary");
  const inactiveColor = button.use_entity_color
    ? INACTIVE_ENTITY_COLOR_VAR
    : button.inactive_color
      ? resolveThemeColor(button.inactive_color)
      : "var(--primary-text-color)";
  const color = active ? activeColor : inactiveColor;
  const bg = tintOn(host, color, undefined, active ? 20 : 8);
  const ink = foregroundOn(color, bg, 3, host);
  const name = button.name || entity?.attributes.friendly_name || button.entity || "";
  // A button, a scene or a script has no state worth reading — it is
  // "unknown" until pressed and a timestamp after, and neither is news. So
  // those default to hiding it, while `show_state: true` still forces it for
  // anyone who wants the timestamp.
  const stateless = STATELESS_DOMAINS.has(domain);
  const showState = button.show_state ?? !stateless;
  const stateText =
    showState && entity && !unavailable
      ? (hass.formatEntityState?.(entity) ?? entity.state)
      : "";
  const cssVars = `--m3cb-bg: ${bg}; --m3cb-ink: ${ink};`;
  const icon = button.icon || "mdi:gesture-tap-button";

  // A pure display chip (Bubble Card's info-row equivalent): no pointer/
  // keyboard handlers, no button role — it isn't tappable.
  if (button.interactive === false) {
    return html`
      <div class="m3-chip-button static" style=${cssVars}>
        ${entity
          ? html`<ha-state-icon .hass=${hass} .icon=${button.icon} .stateObj=${entity}></ha-state-icon>`
          : html`<ha-icon icon=${icon}></ha-icon>`}
        <span class="label">${name}${stateText ? html`<span class="state"> ${stateText}</span>` : nothing}</span>
      </div>
    `;
  }

  // Without a configured action the chip does what the entity is for: a script
  // starts, a button is pressed, a switch toggles, and only something with no
  // obvious verb opens more-info. `runHaAction` alone would fall back to
  // more-info for all of them — and a chip labelled "Vollreinigung" that opens
  // a dialog instead of cleaning is a chip that appears not to work, which is
  // exactly what `defaultEntityAction` was written for. The button card has
  // always done this; the chip row was the one place that did not ask.
  const tap = button.tap_action ?? defaultEntityAction(domain);
  const hasHold = (button.hold_action?.action ?? "none") !== "none";
  const hasDoubleTap = (button.double_tap_action?.action ?? "none") !== "none";
  const ctx: RunActionContext = {
    entityId: button.entity,
    fireMoreInfo: (entityId) => fireMoreInfo(host, entityId),
    navigate: (path) => navigateTo(host, path),
  };
  const listeners = state.gestures.listeners({
    onTap: () => runHaAction(hass, tap, ctx),
    onHold: hasHold ? () => runHaAction(hass, button.hold_action, ctx) : undefined,
    onDoubleTap: hasDoubleTap ? () => runHaAction(hass, button.double_tap_action, ctx) : undefined,
    onPressChange: (pressed) => state.onPressChange(pressed ? key : undefined),
  });

  return html`
    <div
      class="m3-chip-button ${state.pressedKey === key ? "pressed" : ""}"
      style=${cssVars}
      role="button"
      tabindex="0"
      aria-label=${name}
      @pointerdown=${listeners["@pointerdown"]}
      @pointermove=${listeners["@pointermove"]}
      @pointerup=${listeners["@pointerup"]}
      @pointercancel=${listeners["@pointercancel"]}
      @contextmenu=${listeners["@contextmenu"]}
      @keydown=${listeners["@keydown"]}
    >
      ${entity
        ? html`<ha-state-icon .hass=${hass} .icon=${button.icon} .stateObj=${entity}></ha-state-icon>`
        : html`<ha-icon icon=${icon}></ha-icon>`}
      <span class="label">${name}${stateText ? html`<span class="state"> ${stateText}</span>` : nothing}</span>
    </div>
  `;
}

// Which edges of a scrolling chip row still have chips hidden behind them.
// Kept as a pure function over the row's scroll metrics so the fade behaviour
// is testable without a layout engine.
export function chipRowFades(metrics: {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}): { start: boolean; end: boolean } {
  // A sub-pixel slack: a row that fits exactly still reports a stray fraction,
  // and fading an edge that has nothing behind it reads as a rendering fault
  // rather than an affordance.
  const hidden = metrics.scrollWidth - metrics.clientWidth;
  return {
    start: metrics.scrollLeft > 1,
    end: hidden > 1 && metrics.scrollLeft < hidden - 1,
  };
}

// Keeps `.fade-start`/`.fade-end` on every scrolling chip row of a card in
// sync with that row's real scroll position. It lives here rather than on
// either card for the same reason `stopSwipe` lives in shared/swipe.ts: both
// call sites get it and a third one can't forget it. A card drives it from
// `updated()` and releases it in `disconnectedCallback()`.
export class ChipRowFadeController {
  private _observer?: ResizeObserver;
  private _rows: HTMLElement[] = [];

  private _onScroll = (event: Event): void => {
    this._apply(event.currentTarget as HTMLElement);
  };

  /** Re-binds whenever Lit swaps the row elements out, then refreshes them. */
  public sync(root: ParentNode): void {
    const rows = Array.from(root.querySelectorAll<HTMLElement>(".m3-chip-buttons.scroll"));
    const changed =
      rows.length !== this._rows.length || rows.some((row, index) => row !== this._rows[index]);
    if (changed) {
      this._release();
      this._rows = rows;
      if (rows.length > 0) {
        // Both matter: resizing changes whether anything overflows at all,
        // scrolling changes which side it overflows on.
        this._observer = new ResizeObserver((entries) => {
          for (const entry of entries) this._apply(entry.target as HTMLElement);
        });
        for (const row of rows) {
          this._observer.observe(row);
          row.addEventListener("scroll", this._onScroll, { passive: true });
        }
      }
    }
    for (const row of this._rows) this._apply(row);
  }

  public disconnect(): void {
    this._release();
    this._rows = [];
  }

  private _release(): void {
    this._observer?.disconnect();
    this._observer = undefined;
    for (const row of this._rows) row.removeEventListener("scroll", this._onScroll);
  }

  private _apply(row: HTMLElement): void {
    const { start, end } = chipRowFades(row);
    row.classList.toggle("fade-start", start);
    row.classList.toggle("fade-end", end);
  }
}

export const chipButtonsStyles = css`
  .m3-chip-buttons {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .m3-chip-buttons.scroll {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
  }

  /* The row scrolls with its scrollbar hidden, so a chip that does not fit was
     cut off mid-word with nothing to say more existed. The edge fades instead
     — but only on a side that actually has something hidden behind it, which
     is why these are classes the card sets from the real scroll position and
     not a mask that is simply always on. A permanent mask would eat into the
     first chip even when the row fits and there is nothing to scroll to. */
  .m3-chip-buttons.scroll.fade-start {
    mask-image: linear-gradient(to right, transparent 0, #000 20px);
  }

  .m3-chip-buttons.scroll.fade-end {
    mask-image: linear-gradient(to left, transparent 0, #000 20px);
  }

  .m3-chip-buttons.scroll.fade-start.fade-end {
    mask-image: linear-gradient(
      to right,
      transparent 0,
      #000 20px,
      #000 calc(100% - 20px),
      transparent 100%
    );
  }

  .m3-chip-buttons.scroll::-webkit-scrollbar {
    display: none;
  }

  .m3-chip-buttons.wrap {
    flex-wrap: wrap;
  }

  .m3-chip-buttons.stretch {
    flex-wrap: nowrap;
  }

  .m3-chip-buttons.stretch .m3-chip-button {
    flex: 1 1 0;
    min-width: 0;
    justify-content: center;
  }

  .m3-chip-button {
    flex-shrink: 0;
    box-sizing: border-box;
    height: ${CHIP_BUTTON_HEIGHT}px;
    border-radius: ${RADIUS.chip}px;
    padding: 0 14px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--m3cb-bg);
    color: var(--m3cb-ink);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1);
    --mdc-icon-size: ${CHIP_BUTTON_ICON_SIZE}px;
  }

  .m3-chip-button.static {
    cursor: default;
  }

  .m3-chip-button.pressed {
    transform: scale(0.94);
  }

  .m3-chip-button:focus-visible {
    outline: 2px solid var(--m3cb-ink);
    outline-offset: 2px;
  }

  .m3-chip-button .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .m3-chip-button .state {
    opacity: 0.75;
    font-weight: 500;
  }
`;
