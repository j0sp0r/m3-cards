import { html, css, nothing, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  DETAIL_BUTTON_RADIUS_PRESSED,
  DETAIL_BUTTON_SIZE,
  DETAIL_CLOSE_RADIUS,
  DETAIL_ICON_RADIUS,
  DETAIL_ICON_SIZE,
} from "../const";
import { STANDARD_EASING } from "./animation";
import { M3SheetBase } from "./sheet-base";

// The media card's music picker in a bottom sheet (#49): the compact playing
// layouts open the queue and library here instead of growing the card.
//
// The sheet sits in the media card's own shadow root and shows what the card
// slots into it. The queue and library are the card's own template, with the
// card's styles and its handlers, so the two layouts share one picker — the
// sheet only adds the header, the grip and the dialog.

const EASING = unsafeCSS(STANDARD_EASING);

@customElement("m3-media-sheet")
export class M3MediaSheet extends M3SheetBase {
  @property({ attribute: false }) public heading?: string;
  @property({ attribute: false }) public subheading?: string;
  /** A checked `url(...)` for the artwork, or undefined for the icon. */
  @property({ attribute: false }) public picture?: string;
  @property({ attribute: false }) public closeLabel = "Close";
  @property({ attribute: false }) public onClosed?: () => void;

  private _inHistory = false;

  public open(opener?: HTMLElement): void {
    this.present(opener, () => {
      if (this._body) this._body.scrollTop = 0;
    });
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    // Playback stopped and the card switched to its idle row, taking the
    // sheet with it: the history entry it pushed goes too.
    void this.leaveHistory(true);
  }

  // The phone's back gesture closes the sheet rather than leaving the view,
  // as with the detail sheet.
  protected opened(): void {
    if (this._inHistory) return;
    window.history.pushState({ ...(window.history.state ?? {}), m3MediaSheet: true }, "");
    this._inHistory = true;
    window.addEventListener("popstate", this._onPopState);
  }

  private _onPopState = (e: PopStateEvent): void => {
    if (!this._inHistory || (e.state as { m3MediaSheet?: boolean } | null)?.m3MediaSheet) return;
    void this.leaveHistory(false);
    void this.dismiss();
  };

  protected leaveHistory(goBack: boolean): Promise<void> {
    if (!this._inHistory) return Promise.resolve();
    this._inHistory = false;
    window.removeEventListener("popstate", this._onPopState);
    const ours = (window.history.state as { m3MediaSheet?: boolean } | null)?.m3MediaSheet;
    if (!goBack || !ours) return Promise.resolve();
    return new Promise((resolve) => {
      const settled = () => {
        window.removeEventListener("popstate", settled);
        window.clearTimeout(timer);
        resolve();
      };
      const timer = window.setTimeout(settled, 300);
      window.addEventListener("popstate", settled);
      window.history.back();
    });
  }

  protected closed(): void {
    this.onClosed?.();
  }

  protected renderContent() {
    return html`
      <div class="header">
        <div class="art" style=${this.picture ? `background-image: ${this.picture};` : ""}>
          ${this.picture ? nothing : html`<ha-icon icon="mdi:music-note"></ha-icon>`}
        </div>
        <div class="titles">
          <div class="title">${this.heading ?? ""}</div>
          ${this.subheading ? html`<div class="sub">${this.subheading}</div>` : nothing}
        </div>
        <button class="close" @click=${this._close} aria-label=${this.closeLabel}>
          <ha-icon icon="mdi:close"></ha-icon>
        </button>
      </div>
      <slot></slot>
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
        padding: 0 0 14px;
      }
      .art {
        flex: 0 0 auto;
        width: ${DETAIL_ICON_SIZE}px;
        height: ${DETAIL_ICON_SIZE}px;
        border-radius: ${DETAIL_ICON_RADIUS}px;
        background-color: var(--m3p-artwork-bg);
        background-size: cover;
        background-position: center;
        display: grid;
        place-items: center;
        color: var(--mc-accent-fg, var(--mc-accent));
        --mdc-icon-size: 22px;
      }
      .titles {
        flex: 1;
        min-width: 0;
      }
      .title,
      .sub {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .title {
        font-size: 16px;
        font-weight: 700;
        line-height: 1.25;
        color: var(--m3p-text, inherit);
      }
      .sub {
        font-size: 13px;
        opacity: 0.7;
        color: var(--m3p-text, inherit);
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
        background: var(--m3p-transport-btn-bg);
        color: inherit;
        cursor: pointer;
        --mdc-icon-size: 18px;
        -webkit-tap-highlight-color: transparent;
        transition: border-radius 200ms ${EASING};
      }
      .close:active {
        border-radius: ${DETAIL_BUTTON_RADIUS_PRESSED}px;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-media-sheet": M3MediaSheet;
  }
}
