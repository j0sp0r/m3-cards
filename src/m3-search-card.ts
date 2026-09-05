import { LitElement, html, css, nothing, unsafeCSS } from "lit";
import type { TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  CornerRadiusConfig,
  HomeAssistant,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  M3SearchCardConfig,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_SEARCH_ASSIST_ICON,
  DEFAULT_SEARCH_ICON,
  DEFAULT_SEARCH_RADIUS,
  SEARCH_ACTION_RADIUS,
  SEARCH_ACTION_SIZE,
  SEARCH_ACTION_TINT,
  SEARCH_BAR_HEIGHT,
  SEARCH_FEEDBACK_MS,
  SEARCH_ICON_SIZE,
  resolveCornerRadius,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import { STANDARD_EASING, shouldAnimate } from "./shared/animation";
import { activateOnKey } from "./shared/a11y";
import { handleAction, isActionable } from "./shared/actions";
import {
  buildCssVars,
  foregroundColor,
  foregroundOn,
  resolveCommonColors,
  resolveThemeColor,
  tintOn,
} from "./shared/color-config";
import { glassCardClass, glassCardStyles } from "./shared/glass-card";
import { assistAvailable, openAssist, openQuickBar, shortcutsAvailable } from "./shared/quick-bar";
import { TemplatedCard } from "./shared/templated-card";

const EASING = unsafeCSS(STANDARD_EASING);

console.info(
  `%c M3-SEARCH-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #85b7eb; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #85b7eb; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

/**
 * How far the corners travel while the bar is held.
 *
 * The suite's press feedback is a radius morph rather than a ripple, and 0.4 is
 * what the list rows already use — 18px resting, 11px pressed. Applying it as a
 * factor rather than as a fixed target keeps the morph proportional for someone
 * who has set a squarer `radius`, and keeps a per-corner shape recognisably the
 * shape they configured.
 */
const PRESSED_RADIUS_FACTOR = 0.4;

function pressCorners(corners: CornerRadiusConfig | undefined): CornerRadiusConfig | undefined {
  if (!corners) return undefined;
  const out: CornerRadiusConfig = {};
  for (const [key, value] of Object.entries(corners)) {
    if (typeof value === "number") {
      out[key as keyof CornerRadiusConfig] = Math.round(value * PRESSED_RADIUS_FACTOR);
    }
  }
  return out;
}

@customElement("m3-search-card")
export class M3SearchCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3SearchCardConfig;
  @state() private _pressed = false;

  private _pressTimer?: number;

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-search-card-editor");
    return document.createElement("m3-search-card-editor") as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(): M3SearchCardConfig {
    return { type: "custom:m3-search-card" };
  }

  // Nothing here reads an entity, so there is no config to validate beyond the
  // defaults every card fills in.
  public setConfig(config: M3SearchCardConfig): void {
    this._config = { glass_background: true, animation: "auto", ...config };
  }

  public getCardSize(): number {
    return 1;
  }

  public getGridOptions(): LovelaceGridOptions {
    // Full width by default, because that is the shape a search bar has and
    // where a dashboard expects to find one — but resizable down to half a
    // section, since a bar beside a heading is a reasonable thing to want.
    return { columns: "full", rows: "auto", min_columns: 6, min_rows: 1 };
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    window.clearTimeout(this._pressTimer);
  }

  // No shouldUpdate override: this card reads no entity state at all, so
  // hassChangeMatters would have an empty list to filter on. What it does read
  // off `hass` — the language, the admin flag, the loaded components, the
  // shortcuts preference — changes about as often as the page reloads.

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private get _text(): string {
    const cfg = this._config;
    return (
      cfg?.placeholder ??
      cfg?.label ??
      this._t(cfg?.mode === "command" ? "search_placeholder_command" : "search_placeholder")
    );
  }

  private get _showAssist(): boolean {
    // Default on: Assist ships in `default_config`, and the header's own Assist
    // button disappears on a narrow screen for the same reason its search
    // button does — which is the gap this card exists to fill. Where Assist is
    // genuinely absent, or the profile has turned keyboard shortcuts off, the
    // button is dropped rather than drawn as a control that does nothing.
    if (this._config?.show_assist === false) return false;
    return assistAvailable(this.hass);
  }

  // ---- interaction ---------------------------------------------------------

  private _flashPress(): void {
    if (!shouldAnimate(this._config?.animation)) return;
    this._pressed = true;
    window.clearTimeout(this._pressTimer);
    this._pressTimer = window.setTimeout(() => {
      this._pressed = false;
    }, SEARCH_FEEDBACK_MS);
  }

  private _onPressStart = (): void => {
    if (!shouldAnimate(this._config?.animation)) return;
    window.clearTimeout(this._pressTimer);
    this._pressed = true;
  };

  private _onPressEnd = (): void => {
    window.clearTimeout(this._pressTimer);
    this._pressed = false;
  };

  private _onSearch = (e: Event): void => {
    e.stopPropagation();
    this._flashPress();
    const action = this._config?.tap_action;
    // A configured action replaces the built-in behaviour rather than running
    // beside it: two dialogs on one tap is not a thing anyone configures for.
    if (action) {
      if (isActionable(action)) handleAction(this, this.hass, action);
      return;
    }
    openQuickBar(this.hass, this._config?.mode);
  };

  private _onAssist = (e: Event): void => {
    e.stopPropagation();
    openAssist();
  };

  // ---- rendering -----------------------------------------------------------

  private _renderAssist(accentCss: string): TemplateResult | typeof nothing {
    if (!this._showAssist) return nothing;
    const background = tintOn(this, accentCss, undefined, SEARCH_ACTION_TINT);
    const label = this._t("search_assist_label");
    return html`
      <button
        class="assist"
        style=${`background: ${background}; color: ${foregroundOn(accentCss, background, 3, this)};`}
        title=${label}
        aria-label=${label}
        @click=${this._onAssist}
      >
        <ha-icon icon=${this._config?.assist_icon ?? DEFAULT_SEARCH_ASSIST_ICON}></ha-icon>
      </button>
    `;
  }

  protected render(): TemplateResult | typeof nothing {
    const cfg = this._config;
    if (!cfg || !this.hass) return nothing;

    const base = cfg.radius ?? DEFAULT_SEARCH_RADIUS;
    const radius = resolveCornerRadius(base, cfg.corners);
    const pressedRadius = resolveCornerRadius(
      Math.round(base * PRESSED_RADIUS_FACTOR),
      pressCorners(cfg.corners),
    );
    const shape = this._pressed ? pressedRadius : radius;

    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(cfg);
    // Unset means the Material default — a neutral bar, where the leading icon
    // and the placeholder are both on-surface-variant — rather than a house
    // colour this card would be inventing for a control that is meant to look
    // like part of the frontend.
    const accentCss = cfg.accent_color
      ? resolveThemeColor(cfg.accent_color)
      : secondaryTextColorCss;

    const cssVars = buildCssVars({
      "m3s-text": textColorCss,
      "m3s-secondary": secondaryTextColorCss,
      "m3s-icon": cfg.accent_color ? foregroundColor(this, accentCss, 3) : secondaryTextColorCss,
    });

    // Whether the tap can actually do anything. Without the shortcuts there is
    // no dialog to open, so the bar says so instead of pretending: a configured
    // tap_action still works, because it goes nowhere near them.
    const usable = !!cfg.tap_action || shortcutsAvailable(this.hass);
    const label = this._text;

    return html`
      <ha-card style=${`border-radius: ${shape};`}>
        <div
          class="card-inner ${glassCardClass(cfg.glass_background)} ${shouldAnimate(cfg.animation)
            ? ""
            : "no-animations"}"
          style=${`border-radius: ${shape}; ${cssVars}${
            cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""
          }`}
        >
          <div
            class="bar ${usable ? "" : "disabled"}"
            role="button"
            tabindex="0"
            aria-label=${label}
            aria-haspopup="dialog"
            aria-disabled=${usable ? "false" : "true"}
            title=${usable ? label : this._t("search_shortcuts_off")}
            @click=${this._onSearch}
            @keydown=${activateOnKey(this._onSearch)}
            @pointerdown=${this._onPressStart}
            @pointerup=${this._onPressEnd}
            @pointercancel=${this._onPressEnd}
            @pointerleave=${this._onPressEnd}
          >
            <ha-icon class="leading" icon=${cfg.icon ?? DEFAULT_SEARCH_ICON}></ha-icon>
            <span class="placeholder">${label}</span>
          </div>
          ${this._renderAssist(accentCss)}
        </div>
      </ha-card>
    `;
  }

  static styles = [
    glassCardStyles,
    css`
      ha-card {
        transition: border-radius ${unsafeCSS(SEARCH_FEEDBACK_MS)}ms ${EASING};
      }

      .card-inner {
        flex-direction: row;
        align-items: center;
        gap: 4px;
        /* 16px to the leading glyph and 16px to the trailing one, which is the
           M3 search bar's inset at both ends — the trailing button carries 8px
           of its own inside a 40px target, so its padding is 8. */
        padding: 0 8px 0 16px;
        min-height: ${SEARCH_BAR_HEIGHT}px;
        transition: border-radius ${unsafeCSS(SEARCH_FEEDBACK_MS)}ms ${EASING};
      }

      .bar {
        flex: 1;
        min-width: 0;
        align-self: stretch;
        display: flex;
        align-items: center;
        gap: 16px;
        cursor: pointer;
      }

      /* Still focusable and still announced — it is only the dialog behind it
         that is out of reach, and the title says why. */
      .bar.disabled {
        cursor: default;
        opacity: 0.55;
      }

      .bar:focus-visible {
        outline: 2px solid var(--m3s-text, var(--primary-text-color));
        outline-offset: -2px;
        border-radius: 8px;
      }

      .leading {
        flex-shrink: 0;
        color: var(--m3s-icon, var(--primary-text-color));
        --mdc-icon-size: ${SEARCH_ICON_SIZE}px;
      }

      .placeholder {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        /* M3 body-large, the search bar's own type role. */
        font-size: 16px;
        line-height: 24px;
        color: var(--m3s-secondary, var(--primary-text-color));
        /* 0.7 rather than the 0.6 a small muted label in this suite uses: this
           is 16px regular text, so it owes 4.5:1, and 0.6 does not clear that
           against a light card. */
        opacity: 0.7;
      }

      .assist {
        flex-shrink: 0;
        width: ${SEARCH_ACTION_SIZE}px;
        height: ${SEARCH_ACTION_SIZE}px;
        border: none;
        border-radius: ${SEARCH_ACTION_RADIUS}px;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-family: inherit;
        --mdc-icon-size: ${SEARCH_ICON_SIZE}px;
        transition: border-radius ${unsafeCSS(SEARCH_FEEDBACK_MS)}ms ${EASING};
      }

      .assist:active {
        border-radius: ${Math.round(SEARCH_ACTION_RADIUS * PRESSED_RADIUS_FACTOR)}px;
      }

      .assist:focus-visible {
        outline: 2px solid var(--m3s-text, var(--primary-text-color));
        outline-offset: 2px;
      }

      .no-animations,
      .no-animations .assist {
        transition: none;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-search-card": M3SearchCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-search-card",
  name: "M3 Search Card",
  description:
    "A Material 3 search bar on the dashboard itself, opening Home Assistant's own entity or command search — and Assist. The header's search button is not drawn on a narrow screen; this is.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
