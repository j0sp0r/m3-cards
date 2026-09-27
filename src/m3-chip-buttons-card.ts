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
import {
  chipButtonsStyles,
  renderChipButtons,
  updateChipLabelScroll,
  updateSmartStretch,
} from "./shared/chip-buttons";
import { TapHoldGesture } from "./shared/gestures";
import { TemplatedCard } from "./shared/templated-card";

@customElement("m3-chip-buttons-card")
export class M3ChipButtonsCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3ChipButtonsCardConfig;
  @state() private _pressedKey?: string;

  private _rowObserver?: ResizeObserver;
  private _observedRow?: HTMLElement;
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
    this._rowObserver?.disconnect();
    this._rowObserver = undefined;
    this._observedRow = undefined;
  }

  // Which sides of a scrolling row still have chips hidden behind them. The
  // fade belongs on those sides only: a row that fits has nothing to scroll
  // to, and fading its first chip for no reason looks like a rendering fault
  // rather than an affordance. The same resize also decides which labels
  // are too long for their chip and need to slide.
  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    const row = this.renderRoot.querySelector<HTMLElement>(".m3-chip-buttons");
    if (row !== this._observedRow) {
      this._rowObserver?.disconnect();
      this._observedRow = row ?? undefined;
      if (row) {
        // Both matter: resizing changes whether anything overflows at all,
        // scrolling changes which side it overflows on.
        this._rowObserver = new ResizeObserver(() => this._updateOverflow());
        this._rowObserver.observe(row);
        row.addEventListener("scroll", () => this._updateFades(), { passive: true });
      }
    }
    this._updateOverflow();
  }

  private _updateOverflow(): void {
    this._updateFades();
    updateSmartStretch(this.renderRoot);
    updateChipLabelScroll(this.renderRoot);
  }

  private _updateFades(): void {
    const row = this._observedRow;
    if (!row?.classList.contains("scroll")) return;
    // A sub-pixel slack, or a row that fits exactly reports a stray fraction
    // and fades an edge that has nothing behind it.
    const hidden = row.scrollWidth - row.clientWidth;
    row.classList.toggle("fade-start", row.scrollLeft > 1);
    row.classList.toggle("fade-end", hidden > 1 && row.scrollLeft < hidden - 1);
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

      .card-inner.no-animations .label.scrolling {
        text-overflow: ellipsis;
      }

      .card-inner.no-animations .label.scrolling .label-text {
        display: inline;
        animation: none;
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
