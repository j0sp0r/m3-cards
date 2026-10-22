import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, LovelaceCard, LovelaceCardEditor, LovelaceGridOptions, M3PopupCardConfig } from "./types";
import { CARD_VERSION, POPUP_PLACEHOLDER_RADIUS } from "./const";
import { localize, type TranslationKey } from "./localize";
import { buildCssVars, resolveThemeColor, tintInk, tintOn } from "./shared/color-config";
import { GroupChildrenController } from "./shared/group-children";
import { hashMatches, normalizeHash, popupCardSpan, withoutHash } from "./shared/popup-hash";
import { TemplatedCard } from "./shared/templated-card";
import "./shared/popup-sheet";
import type { M3PopupSheet } from "./shared/popup-sheet";

// Other cards in a bottom sheet, opened by the page's URL hash.
//
// The card itself is invisible on a dashboard: it takes no space, and only
// the sheet ever appears. Anything that navigates to its hash opens it — a
// button with `tap_action: { action: navigate, navigation_path: "#remotes" }`,
// a link, a deep link typed into the address bar — which is how Bubble
// Card's pop-ups work, so a dashboard built on those keeps its buttons as
// they are. Back takes the hash away and closes it; closing it any other way
// takes the hash away in turn.
//
// The sheet is the detail sheet's (shared/sheet-base.ts): same motion, same
// grip, same header buttons. The cards in it are built on first opening,
// not with the dashboard, and kept from then on, so a remote card keeps its
// state between openings and ten popups cost nothing until used.

console.info(
  `%c M3-POPUP-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #85b7eb; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #85b7eb; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

/** The wrappers a sections view puts round a card, which would hold a grid cell open. */
interface HiddenWrapper {
  el: HTMLElement;
  display: string;
}

@customElement("m3-popup-card")
export class M3PopupCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;
  /** Set by Home Assistant in edit mode and in the card editor's preview. */
  @property({ type: Boolean }) public preview = false;
  @property({ type: Boolean }) public editMode = false;

  @state() private _config?: M3PopupCardConfig;
  @state() private _cards: HTMLElement[] = [];
  /** Whether the sheet is open or sliding out; its cards follow `hass` only then. */
  @state() private _active = false;

  private _children = new GroupChildrenController();
  private _hidden: HiddenWrapper[] = [];
  /** Opened by a navigation on this page, so back undoes it; a deep link has nothing to go back to. */
  private _openedByNavigation = false;

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-popup-card-editor");
    return document.createElement("m3-popup-card-editor") as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(): M3PopupCardConfig {
    return { type: "custom:m3-popup-card", hash: "#popup", cards: [] };
  }

  public setConfig(config: M3PopupCardConfig): void {
    if (!config || (config.cards !== undefined && !Array.isArray(config.cards))) {
      throw new Error("m3-popup-card: 'cards' must be a list.");
    }
    this._config = { ...config, cards: config.cards ?? [] };
  }

  private get _hash(): string | undefined {
    return normalizeHash(this._config?.hash);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private get _sheet(): M3PopupSheet | null {
    return this.renderRoot.querySelector("m3-popup-sheet");
  }

  private get _visible(): boolean {
    return this.preview || this.editMode;
  }

  public connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("location-changed", this._onLocation);
    window.addEventListener("popstate", this._onLocation);
    window.addEventListener("hashchange", this._onLocation);
    // A page loaded with the hash already in the address: a deep link.
    void this.updateComplete.then(() => this._syncToLocation(false));
  }

  public disconnectedCallback(): void {
    window.removeEventListener("location-changed", this._onLocation);
    window.removeEventListener("popstate", this._onLocation);
    window.removeEventListener("hashchange", this._onLocation);
    this._showWrappers();
    super.disconnectedCallback();
  }

  private _onLocation = (): void => {
    // Home Assistant's router fires location-changed before it has settled;
    // the hash is already in place, so reading it straight away is safe.
    this._syncToLocation(true);
  };

  /** Opens or closes the sheet to match the page's hash. */
  private _syncToLocation(navigated: boolean): void {
    const sheet = this._sheet;
    if (!sheet || !this.isConnected) return;
    const wanted = hashMatches(window.location.hash, this._hash);
    if (wanted && !sheet.isOpen) {
      this._openedByNavigation = navigated;
      this._active = true;
      this._buildCards();
      sheet.open(this);
    } else if (!wanted && sheet.isOpen) {
      // The hash is gone already (back, or a navigation elsewhere): there is
      // no entry left to take out.
      this._openedByNavigation = false;
      void sheet.dismiss();
    }
  }

  /**
   * Takes the hash back out of the address once the sheet closes by any
   * other way than back. After a navigation on this page that is one step
   * back, which leaves the history as it was before the button was pressed;
   * after a deep link there is nothing to go back to, so the hash is simply
   * removed.
   */
  private _leaveHistory = (goBack: boolean): Promise<void> => {
    if (!goBack || !hashMatches(window.location.hash, this._hash)) return Promise.resolve();
    if (!this._openedByNavigation) {
      window.history.replaceState(window.history.state, "", withoutHash(window.location));
      return Promise.resolve();
    }
    this._openedByNavigation = false;
    return new Promise((resolve) => {
      const settled = () => {
        window.removeEventListener("popstate", settled);
        window.clearTimeout(timer);
        resolve();
      };
      // A browser that never answers must not leave the next dialog waiting.
      const timer = window.setTimeout(settled, 300);
      window.addEventListener("popstate", settled);
      window.history.back();
    });
  };

  private _onSheetClosed = (): void => {
    this._active = false;
  };

  private _buildCards(): void {
    if (!this._config || !this.hass) return;
    this._children.sync({
      cards: this._config.cards,
      hass: this.hass,
      onChange: (elements) => {
        this._cards = elements;
      },
      // Twelve columns, as in a sections view: two cards at `columns: 6`
      // share a row, which is how a Bubble pop-up laid them out.
      decorate: (el, config) => {
        el.style.gridColumn = `span ${popupCardSpan(config)}`;
      },
    });
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    // Closed, the card draws nothing that reads `hass`; open, its cards need
    // every change. A theme change needs nothing either way: the sheet sits
    // in this card's shadow root and inherits the view's variables.
    if (changed.size === 1 && changed.has("hass") && !this._active && !this._visible) return false;
    return true;
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    if (changed.has("preview") || changed.has("editMode")) this._applyVisibility();
    // Built on first opening, then kept in step while it is open.
    if (this._active && (changed.has("hass") || changed.has("_config"))) this._buildCards();
    if (changed.has("_config")) this._syncToLocation(false);
  }

  protected firstUpdated(changed: PropertyValues): void {
    super.firstUpdated?.(changed);
    this._applyVisibility();
  }

  /**
   * Off the dashboard outside edit mode. A sections view wraps each card in a
   * hui-card and a grid cell; those and the card are set to `display:
   * contents`, so they generate no box and hold no cell open while the sheet
   * — in the top layer — still renders. `display: none` would hide the sheet
   * with them.
   */
  private _applyVisibility(): void {
    if (this._visible) {
      this._showWrappers();
      return;
    }
    if (this._hidden.length) return;
    // The card itself too: a grid item of its own once its wrappers are gone.
    const wrappers: HTMLElement[] = [this];
    const huiCard = this.parentElement;
    if (huiCard?.tagName === "HUI-CARD") {
      wrappers.push(huiCard);
      const cell = huiCard.parentElement;
      if (cell?.tagName === "DIV" && cell.classList.contains("card")) wrappers.push(cell);
    }
    this._hidden = wrappers.map((el) => ({ el, display: el.style.display }));
    wrappers.forEach((el) => (el.style.display = "contents"));
  }

  private _showWrappers(): void {
    this._hidden.forEach(({ el, display }) => (el.style.display = display));
    this._hidden = [];
  }

  public getCardSize(): number {
    return this._visible ? 1 : 0;
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: "full", rows: "auto" };
  }

  protected render() {
    if (!this._config) return nothing;
    const hash = this._hash;
    const tint = buildCssVars({
      "pp-icon-bg": tintOn(this, "var(--primary-color)", undefined, 20),
      "pp-icon-ink": tintInk(this, "var(--primary-color)", undefined, 20, 3),
      "pp-button-bg": tintOn(this, "var(--primary-text-color)", undefined, 5),
    });
    return html`
      ${this._visible
        ? html`<ha-card class="placeholder" style=${`border-radius: ${POPUP_PLACEHOLDER_RADIUS}px;`}>
            <div class="ph">
              <ha-icon icon=${this._config.icon ?? "mdi:dock-bottom"}></ha-icon>
              <span class="ph-text">
                <span class="ph-title"
                  >${hash ? this._t("popup_placeholder").replace("{hash}", hash) : this._t("popup_no_hash")}</span
                >
                <span class="ph-hint">${this._config.title ? `${this._config.title} · ` : ""}${this._t("popup_placeholder_hint")}</span>
              </span>
            </div>
          </ha-card>`
        : nothing}
      <m3-popup-sheet
        .heading=${this._config.title}
        .icon=${this._config.icon}
        .cards=${this._cards}
        .closeLabel=${this._t("detail_close")}
        .tint=${tint}
        .glass=${this._config.glass_background !== false}
        .background=${this._config.card_background ? resolveThemeColor(this._config.card_background) : undefined}
        .historyLeaver=${this._leaveHistory}
        .onClosed=${this._onSheetClosed}
      ></m3-popup-sheet>
    `;
  }

  static styles = css`
    :host {
      display: block;
    }

    .placeholder {
      overflow: hidden;
      border: 1px dashed var(--divider-color);
      background: transparent;
      box-shadow: none;
    }

    .ph {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      padding: 12px 16px;
      box-sizing: border-box;
      color: var(--primary-text-color);
    }

    .ph ha-icon {
      flex: 0 0 auto;
      color: var(--secondary-text-color);
    }

    .ph-text {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .ph-title {
      font-weight: 600;
    }

    .ph-hint {
      font-size: 12px;
      color: var(--secondary-text-color);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-popup-card": M3PopupCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-popup-card",
  name: "M3 Popup Card",
  description:
    "Other cards in a bottom sheet, opened by a URL hash such as #remotes — in place of a Bubble Card pop-up.",
  preview: false,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
