import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  M3ChipButtonsCardConfig,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
} from "./types";
import { DEFAULT_CHIP_BUTTONS_RADIUS, resolveCornerRadius } from "./const";
import { hassChangeMatters } from "./shared/should-update";
import { shouldAnimate } from "./shared/animation";
import { resolveThemeColor } from "./shared/color-config";
import { glassCardStyles, glassCardClass } from "./shared/glass-card";
import { ChipRowFadeController, chipButtonsStyles, renderChipButtons } from "./shared/chip-buttons";
import { TapHoldGesture } from "./shared/gestures";
import { TemplatedCard } from "./shared/templated-card";

@customElement("m3-chip-buttons-card")
export class M3ChipButtonsCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3ChipButtonsCardConfig;
  @state() private _pressedKey?: string;

  private _fades = new ChipRowFadeController();
  private _gestures = new TapHoldGesture();

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-chip-buttons-card-editor");
    return document.createElement(
      "m3-chip-buttons-card-editor",
    ) as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(): M3ChipButtonsCardConfig {
    return {
      type: "custom:m3-chip-buttons-card",
      buttons: [{}],
    };
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._gestures.cancel();
    this._fades.disconnect();
  }

  // The edge fades on a scrolling row belong on the sides that actually hide
  // chips — see ChipRowFadeController in shared/chip-buttons.ts.
  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    this._fades.sync(this.renderRoot);
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return hassChangeMatters(
      changed,
      this.hass,
      (this._config?.buttons ?? []).map((b) => b.entity),
    );
  }

  public setConfig(config: M3ChipButtonsCardConfig): void {
    if (!config || !Array.isArray(config.buttons)) {
      throw new Error("m3-chip-buttons-card: 'buttons' must be a list.");
    }
    this._config = { glass_background: true, ...config };
  }

  public getCardSize(): number {
    return 1;
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: "full", rows: "auto" };
  }

  protected render() {
    if (!this._config || !this.hass) return nothing;
    const radius = resolveCornerRadius(
      this._config.radius ?? DEFAULT_CHIP_BUTTONS_RADIUS,
      this._config.corners,
    );
    const cardBackgroundCss = this._config.card_background
      ? resolveThemeColor(this._config.card_background)
      : undefined;

    return html`
      <ha-card style=${`border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(this._config.glass_background)} ${shouldAnimate(
            this._config.animation,
          )
            ? ""
            : "no-animations"}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          ${renderChipButtons(this, this.hass, this._config, {
            pressedKey: this._pressedKey,
            gestures: this._gestures,
            onPressChange: (key) => {
              this._pressedKey = key;
            },
          })}
        </div>
      </ha-card>
    `;
  }

  static styles = [
    glassCardStyles,
    chipButtonsStyles,
    css`
      .card-inner {
        padding: var(--m3-group-padding, 10px 12px);
      }

      .card-inner.no-animations .m3-chip-button {
        transition: none;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-chip-buttons-card": M3ChipButtonsCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-chip-buttons-card",
  name: "M3 Chip Buttons Card",
  description:
    "A row of Material-3-style tappable chip buttons for any entities — the M3 answer to Bubble Card's sub-buttons.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
