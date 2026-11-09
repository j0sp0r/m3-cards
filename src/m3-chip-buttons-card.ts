import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  M3ChipButtonsCardConfig,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
} from "./types";
import { CARD_VERSION, DEFAULT_CHIP_BUTTONS_RADIUS, resolveCornerRadius } from "./const";
import { hassChangeMatters } from "./shared/should-update";
import { shouldAnimate } from "./shared/animation";
import { resolveThemeColor } from "./shared/color-config";
import { glassCardStyles, glassCardClass } from "./shared/glass-card";
import {
  ChipRowController,
  chipButtonsStyles,
  chipConditionEntities,
  chipVisible,
  renderChipButtons,
} from "./shared/chip-buttons";
import { TapHoldGesture } from "./shared/gestures";
import { TemplatedCard } from "./shared/templated-card";

console.info(
  `%c M3-CHIP-BUTTONS-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #85b7eb; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #85b7eb; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

@customElement("m3-chip-buttons-card")
export class M3ChipButtonsCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3ChipButtonsCardConfig;
  @state() private _pressedKey?: string;
  /** Set by Lovelace while the dashboard is being edited / in the card editor. */
  @property({ type: Boolean }) public editMode = false;
  @property({ type: Boolean }) public preview = false;

  private _chipRow = new ChipRowController();
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
    // Moved or removed: give the wrappers back their display, so a card put
    // elsewhere (or an editor preview) does not inherit a hidden cell.
    this._empty = false;
    this._applyEmpty();
    this._gestures.cancel();
    this._chipRow.disconnect();
  }

  // Edge fades, smart widths and sliding labels — see ChipRowController in
  // shared/chip-buttons.ts.
  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    this._chipRow.sync(this.renderRoot);
    this._applyEmpty();
  }

  /** Whether the last render had nothing to show (#37). Set in render. */
  private _empty = false;
  private _collapsed: { el: HTMLElement; display: string }[] = [];

  /**
   * An empty card still holds its place: in a sections view the card sits in
   * a hui-card inside a grid cell, and an empty cell keeps the grid's gap. So
   * the wrappers go with it, the way the popup card takes itself off the
   * dashboard — and come back as soon as a chip has something to say.
   */
  private _applyEmpty(): void {
    if (!this._empty) {
      this._collapsed.forEach(({ el, display }) => (el.style.display = display));
      this._collapsed = [];
      return;
    }
    if (this._collapsed.length) return;
    const wrappers: HTMLElement[] = [this];
    const huiCard = this.parentElement;
    if (huiCard?.tagName === "HUI-CARD") {
      wrappers.push(huiCard);
      const cell = huiCard.parentElement;
      if (cell?.tagName === "DIV" && cell.classList.contains("card")) wrappers.push(cell);
    }
    this._collapsed = wrappers.map((el) => ({ el, display: el.style.display }));
    wrappers.forEach((el) => (el.style.display = "none"));
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return hassChangeMatters(changed, this.hass, [
      ...(this._config?.buttons ?? []).map((b) => b.entity),
      ...chipConditionEntities(this._config?.buttons),
    ]);
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
    // Every chip hidden right now: no card at all, rather than an empty frame
    // (#37). While editing, the hidden chips show faded instead, so the card
    // can still be found and opened.
    const editing = this.editMode || this.preview;
    const buttons = this._config.buttons ?? [];
    const hass = this.hass;
    const anyVisible = buttons.some((b) => chipVisible(hass, b));
    this._empty = buttons.length > 0 && !anyVisible && !editing;
    if (this._empty) return nothing;
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
            showHidden: editing,
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
