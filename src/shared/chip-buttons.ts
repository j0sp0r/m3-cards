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

export function renderChipButtons(
  host: HTMLElement,
  hass: HomeAssistant,
  config: ChipButtonsRowConfig,
  state: ChipButtonsRenderState,
): TemplateResult {
  const buttons = config.buttons ?? [];
  const layoutClass =
    config.stretch === "smart"
      ? "stretch smart"
      : config.stretch
        ? "stretch"
        : config.wrap
          ? "wrap"
          : "scroll";
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
  // An explicit per-state override always wins — it's the escape hatch for
  // the cases use_entity_color can't cover: HA doesn't expose a
  // `--state-<domain>-<state>-color` custom property for every domain/state
  // pair (cover and binary_sensor door have none), so a chip left on
  // use_entity_color alone can fall through to the generic active color.
  const stateColorOverride = entity ? button.state_colors?.[entity.state] : undefined;
  const activeColor = stateColorOverride
    ? resolveThemeColor(stateColorOverride)
    : button.use_entity_color
      ? entityStateColorVar(domain || "state", entity?.state ?? "on")
      : resolveThemeColor(button.color || "primary");
  // An inactive state can still have a color of its own: a locked door is
  // "nothing to see" (so not in ACTIVE_STATES), yet HA paints it green. The
  // domain/state var is tried first and only its absence falls to grey.
  const inactiveColor = button.use_entity_color
    ? entity
      ? `var(--state-${domain}-${entity.state}-color, ${INACTIVE_ENTITY_COLOR_VAR})`
      : INACTIVE_ENTITY_COLOR_VAR
    : button.inactive_color
      ? resolveThemeColor(button.inactive_color)
      : "var(--primary-text-color)";
  // A state the user gave a color of their own is drawn in it whatever the
  // state is — otherwise `state_colors.locked` would never show, because a
  // locked lock renders through the inactive branch.
  const highlighted = active || (!!stateColorOverride && !unavailable);
  const color = highlighted ? activeColor : inactiveColor;
  const bg = tintOn(host, color, undefined, highlighted ? 20 : 8);
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
  const shownName = button.show_name === false ? "" : name.trim();
  const iconOnly = !shownName && !stateText;
  // The inner .label-text is what updateChipLabelScroll() slides when the
  // text is wider than the chip; the outer .label is the clipping window.
  const label = iconOnly
    ? nothing
    : html`<span class="label"
        ><span class="label-text"
          >${shownName}${stateText
            ? html`<span class="state">${shownName ? " " : ""}${stateText}</span>`
            : nothing}</span
        ></span
      >`;

  // A pure display chip (Bubble Card's info-row equivalent): no pointer/
  // keyboard handlers, no button role — it isn't tappable.
  if (button.interactive === false) {
    return html`
      <div class="m3-chip-button static ${iconOnly ? "icon-only" : ""}" style=${cssVars}>
        ${entity
          ? html`<ha-state-icon .hass=${hass} .icon=${button.icon} .stateObj=${entity}></ha-state-icon>`
          : html`<ha-icon icon=${icon}></ha-icon>`}
        ${label}
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
      class="m3-chip-button ${iconOnly ? "icon-only" : ""} ${state.pressedKey === key ? "pressed" : ""}"
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
      ${label}
    </div>
  `;
}

// Widths for a `stretch: smart` row. A chip that fits keeps its content
// width, and short chips are the ones that must never give any up: losing
// three of "15,2 °C"'s six characters costs far more than losing the same
// pixels from a long name. So when the row is too narrow, the width is split
// max-min fairly — every chip gets the same cap, and chips narrower than it
// keep their full width while only the ones above it are cut down to it.
// When the row has room to spare, the rest is shared out evenly on top of
// each content width. `fixed` chips (round icon buttons) never grow.
export function smartChipWidths(natural: number[], available: number, fixed: boolean[] = []): number[] {
  const total = natural.reduce((sum, w) => sum + w, 0);
  if (total <= available) {
    const growing = natural.filter((_, i) => !fixed[i]).length;
    const extra = growing ? (available - total) / growing : 0;
    return natural.map((w, i) => (fixed[i] ? w : w + extra));
  }
  const order = natural.map((_, i) => i).sort((a, b) => natural[a] - natural[b]);
  const widths = [...natural];
  let remaining = available;
  for (let k = 0; k < order.length; k++) {
    const cap = remaining / (order.length - k);
    const i = order[k];
    if (natural[i] <= cap) {
      remaining -= natural[i];
      continue;
    }
    for (let j = k; j < order.length; j++) widths[order[j]] = cap;
    break;
  }
  return widths;
}

// Sizes the chips of every `stretch: smart` row under `root`. Call after
// each render and on resize, before updateChipLabelScroll() — which label
// overflows depends on the width handed out here.
export function updateSmartStretch(root: ParentNode): void {
  for (const row of root.querySelectorAll<HTMLElement>(".m3-chip-buttons.stretch.smart")) {
    const chips = [...row.querySelectorAll<HTMLElement>(":scope > .m3-chip-button")];
    if (!chips.length) continue;
    // Content widths, read with every chip briefly at its natural size.
    // Rounded up with a pixel to spare: a chip handed exactly its fractional
    // content width can still lay out a hair narrower, and the ellipsis then
    // takes the last character — which is usually the unit ("71 %" → "71…").
    row.classList.add("measuring");
    const natural = chips.map((chip) => Math.ceil(chip.getBoundingClientRect().width) + 1);
    row.classList.remove("measuring");
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
    const available = row.clientWidth - gap * (chips.length - 1);
    const fixed = chips.map((chip) => chip.classList.contains("icon-only"));
    const widths = smartChipWidths(natural, available, fixed);
    // Only a chip cut below its content may shrink further; one that got its
    // full width is held there, so rounding never comes out of a short chip.
    chips.forEach((chip, i) => {
      const flex = `0 ${widths[i] < natural[i] ? 1 : 0} ${widths[i].toFixed(2)}px`;
      if (chip.style.flex !== flex) chip.style.flex = flex;
    });
  }
}

// Measures every chip label under `root` and turns the slide on exactly for
// the ones whose text is wider than the space they got. Call after each
// render and whenever the row resizes — both change the answer.
export function updateChipLabelScroll(root: ParentNode): void {
  for (const label of root.querySelectorAll<HTMLElement>(".m3-chip-button .label")) {
    const text = label.querySelector<HTMLElement>(".label-text");
    if (!text) continue;
    // offsetWidth ignores the slide's transform, so this reads the same
    // whether the label is currently scrolling or not — and nothing is
    // touched unless the answer changed, since every hass update re-renders
    // and resetting the class or the vars would restart the animation.
    const overflow = text.offsetWidth - label.clientWidth;
    const scroll = overflow > 1;
    if (scroll) {
      const distance = `-${overflow}px`;
      if (label.style.getPropertyValue("--m3cb-scroll-distance") !== distance) {
        label.style.setProperty("--m3cb-scroll-distance", distance);
        // ~30px/s, with a floor so a few pixels don't twitch back and forth.
        label.style.setProperty("--m3cb-scroll-duration", `${Math.max(3, overflow / 30 + 2).toFixed(1)}s`);
      }
    }
    label.classList.toggle("scrolling", scroll);
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

  /* An even split hands a two-letter chip the same width as a long name, so
     the short ones look oddly wide while the long one still has to scroll.
     Smart rows are sized by updateSmartStretch() (see smartChipWidths()),
     which sets each chip's flex inline; this is only the first paint before
     it has measured. .measuring is its momentary natural-size read. A round
     icon chip keeps its size — widened, it stops reading as an icon button. */
  .m3-chip-buttons.stretch.smart .m3-chip-button {
    flex: 1 1 auto;
  }

  .m3-chip-buttons.stretch.smart .m3-chip-button.icon-only,
  .m3-chip-buttons.stretch.smart.measuring .m3-chip-button {
    flex: 0 0 auto !important;
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

  /* A fixed box rather than whatever the icon element measures: ha-state-icon
     renders its glyph in its own later update, so right after the chip row
     renders it is still 0px wide — and updateSmartStretch() measures exactly
     then. Without this every smart chip was sized one icon too narrow. */
  .m3-chip-button > ha-icon,
  .m3-chip-button > ha-state-icon {
    flex: none;
    display: inline-flex;
    width: ${CHIP_BUTTON_ICON_SIZE}px;
    height: ${CHIP_BUTTON_ICON_SIZE}px;
  }

  .m3-chip-button.static {
    cursor: default;
  }

  /* Icon-only chips read as round icon buttons, not as text chips missing
     their text — square (width = height) and centered rather than the
     usual pill padded for a label that isn't there. */
  .m3-chip-button.icon-only {
    width: ${CHIP_BUTTON_HEIGHT}px;
    padding: 0;
    justify-content: center;
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

  /* A label too wide for its chip (a stretched row splits the width evenly,
     so a long name loses) slides to its end and back instead of ending in
     an ellipsis — Bubble Card's scrolling_effect. Ping-pong rather than a
     looping marquee, so the rendered text is never duplicated and Lit keeps
     owning it. The distance and duration come from updateChipLabelScroll(),
     which measures the real overflow. */
  .m3-chip-button .label.scrolling {
    text-overflow: clip;
  }

  .m3-chip-button .label.scrolling .label-text {
    display: inline-block;
    animation: m3cb-label-scroll var(--m3cb-scroll-duration, 4s) ease-in-out infinite alternate;
  }

  @keyframes m3cb-label-scroll {
    0%,
    15% {
      transform: translateX(0);
    }
    85%,
    100% {
      transform: translateX(var(--m3cb-scroll-distance, 0));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .m3-chip-button .label.scrolling {
      text-overflow: ellipsis;
    }
    .m3-chip-button .label.scrolling .label-text {
      display: inline;
      animation: none;
    }
  }

  .m3-chip-button .state {
    opacity: 0.75;
    font-weight: 500;
  }
`;
