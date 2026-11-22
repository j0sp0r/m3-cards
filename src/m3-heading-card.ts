import { LitElement, html, css, nothing, unsafeCSS } from "lit";
import type { PropertyValues, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  M3HeadingCardConfig,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_HEADING_COLOR,
  DEFAULT_HEADING_ICON,
  HEADING_ACTION_FEEDBACK_MS,
  HEADING_ACTION_HEIGHT,
  HEADING_ACTION_RADIUS,
  HEADING_ACTION_RADIUS_ACTIVE,
  HEADING_ACTION_TINT,
  HEADING_ARROW,
  HEADING_ARROW_RADIUS,
  HEADING_ARROW_RADIUS_COLLAPSED,
  HEADING_ARROW_TINT,
  HEADING_BADGE_HEIGHT,
  HEADING_BADGE_RADIUS,
  HEADING_BADGE_TINT,
  HEADING_COLLAPSE_MS,
  HEADING_ICON,
  HEADING_ICON_GLYPH,
  HEADING_ICON_RADIUS,
  HEADING_ICON_TINT,
  HEADING_NARROW_PX,
  HEADING_RULE_HEIGHT,
  HEADING_RULE_STUB,
  HEADING_RULE_TINT,
  HEADING_TITLE_SIZE,
  HEADING_TITLE_SIZE_MAX,
  HEADING_TITLE_SIZE_MIN,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import { STANDARD_EASING, shouldAnimate } from "./shared/animation";
import { activateOnKey } from "./shared/a11y";
import { handleAction, isActionable } from "./shared/actions";
import {
  buildCssVars,
  foregroundOn,
  resolveThemeColor,
  tintOn,
} from "./shared/color-config";
import { readCollapsed, writeCollapsed, type CollapseTarget } from "./shared/collapse-state";
import { hassChangeMatters } from "./shared/should-update";
import { TemplatedCard } from "./shared/templated-card";
import { iconWell } from "./shared/icon-well";

const EASING = unsafeCSS(STANDARD_EASING);

console.info(
  `%c M3-HEADING-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #85b7eb; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #85b7eb; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

const STORAGE_PREFIX = "m3-heading-collapsed";

@customElement("m3-heading-card")
export class M3HeadingCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3HeadingCardConfig;
  @state() private _collapsed = false;
  @state() private _narrow = false;
  @state() private _pressed = false;
  /**
   * Set when the collapsible variant cannot find the cards it would hide.
   * The card then renders as `simple` rather than showing an arrow that does
   * nothing — a control that visibly fails is worse than one that is absent.
   */
  @state() private _collapseUnavailable = false;

  private _resizeObserver?: ResizeObserver;
  private _pressTimer?: number;
  /** Exactly the elements this card hid, so expanding restores those and no others. */
  private _hidden: HTMLElement[] = [];

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-heading-card-editor");
    return document.createElement(
      "m3-heading-card-editor",
    ) as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(): M3HeadingCardConfig {
    return {
      type: "custom:m3-heading-card",
      style: "simple",
      title: localize("heading_default_title", "de"),
    };
  }

  public setConfig(config: M3HeadingCardConfig): void {
    this._config = { style: "simple", animation: "auto", ...config };
    this._collapsed = this._readCollapsed();
  }

  public getCardSize(): number {
    return 1;
  }

  public getGridOptions(): LovelaceGridOptions {
    // A heading spans the view: a section grid that put one beside a card would
    // read as a label for that card rather than for what follows it.
    return { columns: "full", rows: "auto" };
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return hassChangeMatters(changed, this.hass, [
      this._config?.badge,
      this._config?.collapse_state_entity,
      ...(this._config?.count_entities ?? []),
    ]);
  }

  public connectedCallback(): void {
    super.connectedCallback();
    // The DOM around the card is only settled once the view has laid itself
    // out, so the first collapse is applied a frame later rather than here.
    requestAnimationFrame(() => this._applyCollapse());
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    window.clearTimeout(this._pressTimer);
    // Leaving hidden siblings behind would make cards vanish for good when a
    // collapsed heading is deleted from the dashboard.
    this._restoreHidden();
  }

  protected firstUpdated(changed: PropertyValues): void {
    super.firstUpdated(changed);
    this._resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      const narrow = width > 0 && width < HEADING_NARROW_PX;
      if (narrow !== this._narrow) this._narrow = narrow;
    });
    this._resizeObserver.observe(this);
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    // An entity-backed collapse state can change from anywhere — another
    // dashboard, an automation — so it is re-read on every tick rather than
    // only on a tap.
    const wanted = this._readCollapsed();
    if (wanted !== this._collapsed) this._collapsed = wanted;
    this._applyCollapse();
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private get _style(): "simple" | "status" | "divider" | "collapsible" {
    const style = this._config?.style ?? "simple";
    if (style === "collapsible" && this._collapseUnavailable) return "simple";
    return style;
  }

  private get _color(): string {
    return resolveThemeColor(this._config?.color ?? DEFAULT_HEADING_COLOR);
  }

  // ---- collapse state ------------------------------------------------------

  private get _storageKey(): string {
    // Cards carry no id, so the key is built from what identifies this heading
    // to a reader: the view it is on and its own title.
    return `${STORAGE_PREFIX}:${location.pathname}:${this._config?.title ?? ""}`;
  }

  private get _collapseTarget(): CollapseTarget {
    return {
      entity: this._config?.collapse_state_entity,
      storageKey: this._storageKey,
      defaultCollapsed: this._config?.default_collapsed,
    };
  }

  private _readCollapsed(): boolean {
    if (!this._config) return false;
    return readCollapsed(this.hass, this._collapseTarget);
  }

  private _writeCollapsed(value: boolean): void {
    if (!this._config) return;
    writeCollapsed(this.hass, this._collapseTarget, value);
  }

  // ---- collapsing the siblings ---------------------------------------------

  /**
   * The element the view lays out, which is the level siblings live at.
   *
   * Chosen over the three alternatives: rewriting the Lovelace config on every
   * tap is destructive and writes to storage for a UI state; a `conditional`
   * wrapper round every card needs per-card configuration, which is exactly
   * the work this card exists to avoid; and a container card that takes its
   * children as config would be a stack, not a heading, and could not sit
   * between cards in a section grid.
   *
   * Hiding siblings is the only approach that leaves the dashboard's own
   * configuration untouched. Its cost is a dependency on Home Assistant's DOM,
   * which is why every step below is a check rather than an assumption, and why
   * failing to recognise the shape falls back to `simple` instead of throwing.
   *
   * Both layouts the suite is used in are covered:
   *   sections: div.container > div.card > hui-card > m3-heading-card
   *   masonry:  div.column    > hui-card > m3-heading-card
   */
  private _gridItem(): HTMLElement | undefined {
    let node: HTMLElement | null = this;
    for (let depth = 0; depth < 6 && node; depth++) {
      const parent: HTMLElement | null = node.parentElement;
      if (!parent) return undefined;
      if (parent.classList.contains("container") || parent.classList.contains("column")) {
        return node;
      }
      node = parent;
    }
    return undefined;
  }

  /** True while the dashboard is being edited, where hiding cards would put them out of reach. */
  private get _editing(): boolean {
    const self = this as unknown as { editMode?: boolean; preview?: boolean };
    if (self.editMode || self.preview) return true;
    const wrapper = this.parentElement as unknown as { editMode?: boolean; preview?: boolean } | null;
    return !!(wrapper?.editMode || wrapper?.preview);
  }

  private _restoreHidden(): void {
    for (const el of this._hidden) el.style.removeProperty("display");
    this._hidden = [];
  }

  private _applyCollapse(): void {
    if (this._config?.style !== "collapsible") {
      this._restoreHidden();
      return;
    }

    const start = this._gridItem();
    if (!start) {
      this._restoreHidden();
      if (!this._collapseUnavailable) this._collapseUnavailable = true;
      return;
    }
    if (this._collapseUnavailable) this._collapseUnavailable = false;

    this._restoreHidden();
    if (!this._collapsed || this._editing) return;

    for (let el = start.nextElementSibling; el; el = el.nextElementSibling) {
      // The run ends at the next heading, which is what makes several headings
      // on one view each own the cards below them.
      if (el.querySelector("m3-heading-card")) break;
      const html = el as HTMLElement;
      html.style.display = "none";
      this._hidden.push(html);
    }
  }

  private _toggleCollapsed = (e: Event): void => {
    e.stopPropagation();
    const next = !this._collapsed;
    this._collapsed = next;
    this._writeCollapsed(next);
    this._applyCollapse();
  };

  // ---- status variant ------------------------------------------------------

  private _badgeText(): string | undefined {
    const cfg = this._config;
    if (!cfg) return undefined;

    if (cfg.count_entities?.length) {
      let on = 0;
      for (const id of cfg.count_entities) {
        const state = this.hass?.states[id]?.state;
        // An unreachable entity is not counted either way: reporting it as off
        // would be a claim the card cannot support.
        if (state === "on") on++;
      }
      return this._t("heading_badge_active").replace("{n}", String(on));
    }

    if (!cfg.badge) return undefined;
    const stateObj = this.hass?.states[cfg.badge];
    if (!stateObj) return cfg.badge;
    const unit = stateObj.attributes?.unit_of_measurement as string | undefined;
    return unit ? `${stateObj.state} ${unit}` : stateObj.state;
  }

  private _runAction = (e: Event): void => {
    e.stopPropagation();
    const action = this._config?.action?.tap_action;
    if (!isActionable(action)) return;
    handleAction(this, this.hass, action);
    // The button carries no state of its own, so the only confirmation that a
    // tap landed is this: a brief squash and colour lift.
    if (!shouldAnimate(this._config?.animation)) return;
    this._pressed = true;
    window.clearTimeout(this._pressTimer);
    this._pressTimer = window.setTimeout(() => {
      this._pressed = false;
    }, HEADING_ACTION_FEEDBACK_MS);
  };

  private _onHeadingTap = (e: Event): void => {
    if (this._style === "collapsible") {
      this._toggleCollapsed(e);
      return;
    }
    const action = this._config?.tap_action;
    if (!isActionable(action) || !action) return;
    handleAction(this, this.hass, action);
  };

  // ---- rendering -----------------------------------------------------------

  private _renderIcon(): TemplateResult | typeof nothing {
    const cfg = this._config;
    if (!cfg || cfg.show_icon === false) return nothing;
    const color = this._color;
    const background = tintOn(this, color, undefined, HEADING_ICON_TINT);
    return html`
      <div
        class="icon"
        style=${`background: ${iconWell(background)}; color: ${foregroundOn(color, background, 3, this)};`}
      >
        <ha-icon icon=${cfg.icon ?? DEFAULT_HEADING_ICON}></ha-icon>
      </div>
    `;
  }

  /**
   * One size for every piece of heading text. The divider's label used to be a
   * fixed 10px while the titles sat at 15, which read as a different kind of
   * element rather than as the same heading in another variant — reported as
   * "it looks noticeably smaller". Deriving both from here means `title_size`
   * moves them together and they cannot drift apart again.
   */
  private get _titleSize(): number {
    return Math.max(
      HEADING_TITLE_SIZE_MIN,
      Math.min(HEADING_TITLE_SIZE_MAX, this._config?.title_size ?? HEADING_TITLE_SIZE),
    );
  }

  private _renderTitle(): TemplateResult {
    const cfg = this._config!;
    const text = cfg.title ?? this._t("heading_default_title");
    return html`
      <span class="title" style=${`font-size: ${this._titleSize}px;`} title=${text}>${text}</span>
    `;
  }

  private _renderBadge(): TemplateResult | typeof nothing {
    const text = this._badgeText();
    if (!text) return nothing;
    const color = this._color;
    const background = tintOn(this, color, undefined, HEADING_BADGE_TINT);
    return html`
      <span
        class="badge"
        style=${`background: ${background}; color: ${foregroundOn(color, background, 4.5, this)};`}
        >${text}</span
      >
    `;
  }

  private _renderAction(): TemplateResult | typeof nothing {
    const action = this._config?.action;
    if (!action || (!action.name && !action.icon)) return nothing;
    const color = this._color;
    const background = tintOn(this, color, undefined, HEADING_ACTION_TINT);
    const pressedBackground = tintOn(this, color, undefined, HEADING_ACTION_TINT * 2.5);
    const label = action.name;
    const showLabel = !!label && !this._narrow;
    return html`
      <button
        class="action ${this._pressed ? "pressed" : ""}"
        style=${`background: ${this._pressed ? pressedBackground : background}; color: ${foregroundOn(color, background, 4.5, this)};`}
        aria-label=${label ?? ""}
        @click=${this._runAction}
      >
        ${action.icon ? html`<ha-icon icon=${action.icon}></ha-icon>` : nothing}
        ${showLabel ? html`<span>${label}</span>` : nothing}
      </button>
    `;
  }

  private _renderArrow(): TemplateResult {
    const color = this._color;
    const background = tintOn(this, color, undefined, HEADING_ARROW_TINT);
    return html`
      <div
        class="arrow ${this._collapsed ? "collapsed" : ""}"
        style=${`background: ${background}; color: ${foregroundOn(color, background, 3, this)};`}
        role="button"
        tabindex="0"
        aria-expanded=${this._collapsed ? "false" : "true"}
        aria-label=${this._collapsed ? this._t("heading_expand") : this._t("heading_collapse")}
        @click=${this._toggleCollapsed}
        @keydown=${activateOnKey(this._toggleCollapsed)}
      >
        <ha-icon icon="mdi:chevron-down"></ha-icon>
      </div>
    `;
  }

  private _renderDivider(): TemplateResult {
    const label = this._config?.label;
    return html`
      <div class="divider">
        ${label
          ? html`
              <span class="rule stub"></span>
              <span class="rule-label">${label}</span>
              <span class="rule grow"></span>
            `
          : html`<span class="rule grow"></span>`}
      </div>
    `;
  }

  protected render(): TemplateResult | typeof nothing {
    const cfg = this._config;
    if (!cfg) return nothing;

    const style = this._style;
    // `color` used to reach the icon, badge, action and arrow but never the
    // divider, so setting it on a divider silently did nothing. It now drives
    // both parts. Without one the divider stays neutral, which is what a
    // divider should be by default; with one, the label takes the colour at
    // full strength, because someone who names a colour means that colour and
    // not a muted version of it.
    const tinted = cfg.color ? this._color : "var(--primary-text-color)";
    const cssVars = buildCssVars({
      "m3h-rule": tintOn(this, tinted, undefined, HEADING_RULE_TINT),
      "m3h-label": cfg.color ? this._color : "var(--primary-text-color)",
      "m3h-label-opacity": cfg.color ? "1" : "0.65",
      "m3h-label-size": `${this._titleSize}px`,
    });

    if (style === "divider") {
      return html`<div class="root" style=${cssVars}>${this._renderDivider()}</div>`;
    }

    const collapsible = style === "collapsible";
    const tappable = collapsible || isActionable(cfg.tap_action);
    const interactive = tappable && (collapsible || !!cfg.tap_action);

    return html`
      <div
        class="root ${shouldAnimate(cfg.animation) ? "" : "no-animations"}"
        style=${cssVars}
      >
        <div
          class="row ${interactive ? "tappable" : ""}"
          role=${interactive ? "button" : nothing}
          tabindex=${interactive ? "0" : nothing}
          @click=${interactive ? this._onHeadingTap : nothing}
          @keydown=${interactive ? activateOnKey(this._onHeadingTap) : nothing}
        >
          ${this._renderIcon()} ${this._renderTitle()}
          ${style === "status" ? this._renderBadge() : nothing}
          <span class="spacer"></span>
          ${style === "status" ? this._renderAction() : nothing}
          ${collapsible ? this._renderArrow() : nothing}
        </div>
      </div>
    `;
  }

  static styles = css`
    /* No ha-card, no background, no border, no shadow: the heading floats
       between the cards rather than sitting on one of its own. */
    :host {
      /* No grey tap rectangle over a rounded card — see glass-card.ts. */
      -webkit-tap-highlight-color: transparent;
      display: block;
      background: none;
    }

    .root {
      box-sizing: border-box;
      padding: 4px 2px 12px;
    }

    .row {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .row.tappable {
      cursor: pointer;
    }

    .row:focus-visible,
    .arrow:focus-visible {
      outline: 2px solid var(--primary-text-color);
      outline-offset: 2px;
      border-radius: 8px;
    }

    .icon {
      flex-shrink: 0;
      width: ${HEADING_ICON}px;
      height: ${HEADING_ICON}px;
      border-radius: ${HEADING_ICON_RADIUS}px;
      display: flex;
      align-items: center;
      justify-content: center;
      --mdc-icon-size: ${HEADING_ICON_GLYPH}px;
    }

    .title {
      min-width: 0;
      font-weight: 700;
      letter-spacing: -0.2px;
      line-height: 1.2;
      color: var(--primary-text-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .badge {
      flex-shrink: 0;
      height: ${HEADING_BADGE_HEIGHT}px;
      border-radius: ${HEADING_BADGE_RADIUS}px;
      padding: 0 8px;
      display: inline-flex;
      align-items: center;
      font-size: 10px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    .spacer {
      flex: 1;
      min-width: 0;
    }

    .action {
      flex-shrink: 0;
      height: ${HEADING_ACTION_HEIGHT}px;
      border-radius: ${HEADING_ACTION_RADIUS}px;
      padding: 0 12px;
      border: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      --mdc-icon-size: 16px;
      transition:
        border-radius ${unsafeCSS(HEADING_ACTION_FEEDBACK_MS)}ms ${EASING},
        background ${unsafeCSS(HEADING_ACTION_FEEDBACK_MS)}ms ${EASING};
    }

    .action.pressed {
      border-radius: ${HEADING_ACTION_RADIUS_ACTIVE}px;
    }

    .arrow {
      flex-shrink: 0;
      width: ${HEADING_ARROW}px;
      height: ${HEADING_ARROW}px;
      border-radius: ${HEADING_ARROW_RADIUS}px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      --mdc-icon-size: 18px;
      transition:
        border-radius ${unsafeCSS(HEADING_COLLAPSE_MS)}ms ${EASING};
    }

    .arrow ha-icon {
      transition: transform ${unsafeCSS(HEADING_COLLAPSE_MS)}ms ${EASING};
    }

    .arrow.collapsed {
      border-radius: ${HEADING_ARROW_RADIUS_COLLAPSED}px;
    }

    .arrow.collapsed ha-icon {
      transform: rotate(-90deg);
    }

    /* ---- divider ---- */

    .divider {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 2px 14px;
    }

    .rule {
      height: ${HEADING_RULE_HEIGHT}px;
      border-radius: 1px;
      background: var(--m3h-rule);
    }

    .rule.stub {
      flex: 0 0 ${HEADING_RULE_STUB}px;
    }

    .rule.grow {
      flex: 1;
    }

    .rule-label {
      flex-shrink: 0;
      font-size: var(--m3h-label-size, ${HEADING_TITLE_SIZE}px);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      /* The default 0.65 is higher than the 0.6 the rest of the suite uses for
         a muted label, and deliberately so. title_size reaches down to
         ${HEADING_TITLE_SIZE_MIN}px, and below 14px bold no longer counts as
         large text, so the target there is 4.5:1 rather than 3:1 — and 0.6
         reaches only 4.35:1 against a light card. The light theme is the binding
         case, as it usually is. This label also has no card of its own behind
         it: the heading card draws no surface, so whatever the dashboard uses as
         a background is what it has to read against. An explicitly configured
         colour drops the muting entirely. */
      opacity: var(--m3h-label-opacity, 0.65);
      color: var(--m3h-label, var(--primary-text-color));
    }

    .no-animations .action,
    .no-animations .arrow,
    .no-animations .arrow ha-icon {
      transition: none;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-heading-card": M3HeadingCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-heading-card",
  name: "M3 Heading Card",
  description:
    "Abschnitts-Überschrift zwischen den Karten — schlicht, mit Status und Aktion, als Trenner oder aufklappbar.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
