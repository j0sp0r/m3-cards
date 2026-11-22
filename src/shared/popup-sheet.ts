import { html, css, nothing, unsafeCSS, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  DETAIL_BUTTON_RADIUS_PRESSED,
  DETAIL_BUTTON_SIZE,
  DETAIL_CLOSE_RADIUS,
  DETAIL_ICON_RADIUS,
  DETAIL_ICON_SIZE,
  DETAIL_SHEET_MAX_WIDTH,
  POPUP_CARD_GAP,
  POPUP_CARD_RIM,
  POPUP_SCREEN_MARGIN,
} from "../const";
import { STANDARD_EASING } from "./animation";
import { M3SheetBase } from "./sheet-base";
import { POPUP_GRID_COLUMNS } from "./popup-hash";
import type { PopupSize } from "./css-length";

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
  /**
   * Resolved text colours, from the popup's `text_color` and
   * `secondary_text_color`. Set as the theme's own variables on the surface,
   * so the cards on it follow too: text chosen for a light background has to
   * reach every card on that background, not only the heading.
   */
  @property({ attribute: false }) public textColor?: string;
  @property({ attribute: false }) public secondaryTextColor?: string;
  /** Checked sizes from the popup's `width`, `height` and their phone twins (#58). */
  @property({ attribute: false }) public size: PopupSize = {};

  protected updated(changed: PropertyValues): void {
    super.updated?.(changed);
    if (!changed.has("size")) return;
    // On the host, so the dialog's own rules in the base sheet read them.
    const vars: [string, string | undefined][] = [
      ["--m3-popup-width", this.size.width],
      ["--m3-popup-height", this.size.height],
      ["--m3-popup-mobile-width", this.size.mobileWidth],
      ["--m3-popup-mobile-height", this.size.mobileHeight],
    ];
    for (const [name, value] of vars) {
      if (value) this.style.setProperty(name, value);
      else this.style.removeProperty(name);
    }
  }

  public open(opener?: HTMLElement): void {
    this.present(opener, () => {
      if (this._body) this._body.scrollTop = 0;
    });
  }

  protected sheetStyle(): string {
    return [
      this.background ? `background: ${this.background};` : "",
      this.textColor ? `--primary-text-color: ${this.textColor}; color: ${this.textColor};` : "",
      this.secondaryTextColor ? `--secondary-text-color: ${this.secondaryTextColor};` : "",
    ].join(" ");
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
        background: var(--m3-icon-background, var(--pp-icon-bg));
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
      /* A configured size (#58), one pair for the phone's bottom sheet and
         one for the centred sheet. Both stay inside the screen, whatever
         was typed. */
      dialog {
        max-width: min(var(--m3-popup-mobile-width, 100vw), 100vw);
      }
      .sheet {
        height: var(--m3-popup-mobile-height, auto);
      }
      @media (min-width: 600px) and (min-height: 600px) {
        dialog {
          max-width: min(var(--m3-popup-width, ${DETAIL_SHEET_MAX_WIDTH}px), calc(100vw - ${2 * POPUP_SCREEN_MARGIN}px));
        }
        .sheet {
          height: var(--m3-popup-height, auto);
          max-height: min(92dvh, calc(100dvh - ${2 * POPUP_SCREEN_MARGIN}px));
        }
      }

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
