import { html, css, nothing, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  DETAIL_BUTTON_RADIUS_PRESSED,
  DETAIL_BUTTON_SIZE,
  DETAIL_CLOSE_RADIUS,
  DETAIL_ICON_RADIUS,
  DETAIL_ICON_SIZE,
  POPUP_CARD_GAP,
  POPUP_CARD_RIM,
} from "../const";
import { STANDARD_EASING } from "./animation";
import { M3SheetBase } from "./sheet-base";
import { POPUP_GRID_COLUMNS } from "./popup-hash";

// The sheet m3-popup-card opens: a header in the detail view's design — icon,
// title, close button — over the cards the popup holds.
//
// The cards are live elements built by the popup card and handed in as they
// are, so they keep their own state between openings. What closing does to
// the URL is the popup card's business too: it is handed in as
// `historyLeaver`.

const EASING = unsafeCSS(STANDARD_EASING);

@customElement("m3-popup-sheet")
export class M3PopupSheet extends M3SheetBase {
  @property({ attribute: false }) public heading?: string;
  @property({ attribute: false }) public icon?: string;
  @property({ attribute: false }) public cards: HTMLElement[] = [];
  @property({ attribute: false }) public closeLabel = "Close";
  /** Inline CSS variables for the icon's tint, from the popup card. */
  @property({ attribute: false }) public tint = "";
  @property({ attribute: false }) public historyLeaver?: (goBack: boolean) => Promise<void>;
  @property({ attribute: false }) public onClosed?: () => void;
  /** A resolved colour for the surface, from the popup's `card_background`. */
  @property({ attribute: false }) public background?: string;

  public open(opener?: HTMLElement): void {
    this.present(opener, () => {
      if (this._body) this._body.scrollTop = 0;
    });
  }

  protected sheetStyle(): string {
    return this.background ? `background: ${this.background};` : "";
  }

  protected leaveHistory(goBack: boolean): Promise<void> {
    return this.historyLeaver?.(goBack) ?? Promise.resolve();
  }

  protected closed(): void {
    this.onClosed?.();
  }

  protected renderContent() {
    return html`
      <div class="header" style=${this.tint}>
        ${this.icon ? html`<div class="icon"><ha-icon icon=${this.icon}></ha-icon></div>` : nothing}
        <div class="title">${this.heading ?? ""}</div>
        <button class="close" @click=${this._close} aria-label=${this.closeLabel}>
          <ha-icon icon="mdi:close"></ha-icon>
        </button>
      </div>
      <div class="cards">${this.cards}</div>
    `;
  }

  static styles = [
    M3SheetBase.styles,
    css`
      .header {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
        padding: 0 0 16px;
      }

      .icon {
        flex: 0 0 auto;
        width: ${DETAIL_ICON_SIZE}px;
        height: ${DETAIL_ICON_SIZE}px;
        border-radius: ${DETAIL_ICON_RADIUS}px;
        display: grid;
        place-items: center;
        background: var(--pp-icon-bg);
        color: var(--pp-icon-ink);
        --mdc-icon-size: 22px;
      }

      /* Two lines before an ellipsis, as in the detail view's header. */
      .title {
        flex: 1;
        min-width: 0;
        font-size: 18px;
        font-weight: 700;
        line-height: 1.25;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        overflow: hidden;
        overflow-wrap: anywhere;
      }

      .close {
        flex: 0 0 auto;
        width: ${DETAIL_BUTTON_SIZE}px;
        height: ${DETAIL_BUTTON_SIZE}px;
        border: none;
        padding: 0;
        display: grid;
        place-items: center;
        border-radius: ${DETAIL_CLOSE_RADIUS}px;
        background: var(--pp-button-bg);
        color: inherit;
        cursor: pointer;
        --mdc-icon-size: 18px;
        -webkit-tap-highlight-color: transparent;
        transition: border-radius 200ms ${EASING};
      }
      .close:active {
        border-radius: ${DETAIL_BUTTON_RADIUS_PRESSED}px;
      }

      /* Twelve columns, as in a sections view; each card's span is set on it
         by the popup card from its grid_options.

         Home Assistant's own cards draw their rim from the theme, and many
         themes set none: on a dashboard the wallpaper outlines them, in a
         sheet of their own colour nothing does. They get the rim every M3
         card draws, through the variables ha-card reads. */
      .cards {
        display: grid;
        grid-template-columns: repeat(${POPUP_GRID_COLUMNS}, minmax(0, 1fr));
        gap: ${POPUP_CARD_GAP}px;
        --ha-card-border-width: 1px;
        --ha-card-border-color: ${unsafeCSS(POPUP_CARD_RIM)};
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-popup-sheet": M3PopupSheet;
  }
}
