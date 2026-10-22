import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { HomeAssistant } from "../types";
import type { M3DetailCard } from "../m3-detail-card";
import { isReducedMotion } from "./animation";
import { M3SheetBase } from "./sheet-base";
import { registerDetailSheet } from "./entity-detail";
import { detailKind } from "./detail-kind";
import "../m3-detail-card";

// The detail sheet: m3-detail-card in a bottom sheet, opened in place of Home
// Assistant's more-info dialog for a card set to `detail_mode: sheet`.
//
// WHERE IT LIVES
//
// In the opening card's shadow root, not on document.body. A <dialog> opened
// with showModal() goes to the top layer wherever it sits in the tree, so it
// overlays the dashboard either way — but a view's theme is set on the view
// element, and only a node inside the card inherits it. It is inserted
// *before* everything Lit renders there: Lit owns the range from its own
// marker to the end of the root and clears it whenever a card switches
// templates, which would take a sheet appended at the end with it.
//
// HOW IT STAYS LIVE
//
// The card it opened from hands it each new `hass`. Cards filter their
// renders through shouldUpdate, so the forwarding cannot happen in the render
// path; templated-card.ts does it in requestUpdate, which every property write
// goes through whether or not a render follows.

const sheets = new WeakMap<HTMLElement, M3DetailSheet>();

/**
 * Whether the sheet has a layout for the entity. Release notes, press-only
 * entities and the like do not (see detail-kind.ts) and stay with more-info.
 */
function canShow(hass: HomeAssistant | undefined, entityId: string): boolean {
  return detailKind(hass?.states[entityId]) !== undefined;
}

function openDetailSheet(host: HTMLElement, entityId: string): boolean {
  const hass = (host as { hass?: HomeAssistant }).hass;
  const root = host.shadowRoot;
  if (!root || !canShow(hass, entityId)) return false;
  let sheet = sheets.get(host);
  if (!sheet) {
    sheet = document.createElement("m3-detail-sheet") as M3DetailSheet;
    sheets.set(host, sheet);
  }
  if (!sheet.isConnected) root.insertBefore(sheet, root.firstChild);
  sheet.hass = hass;
  sheet.show(entityId, host);
  return true;
}

/** On every `hass` write, through templated-card.ts. Cheap when no sheet exists. */
function forwardHass(host: HTMLElement, hass: unknown): void {
  const sheet = sheets.get(host);
  if (sheet?.isConnected) sheet.hass = hass as HomeAssistant | undefined;
}

/** When the card leaves the page, through templated-card.ts. */
function closeSheet(host: HTMLElement): void {
  sheets.get(host)?.dismiss(true);
}

registerDetailSheet({ open: openDetailSheet, forward: forwardHass, close: closeSheet });

@customElement("m3-detail-sheet")
export class M3DetailSheet extends M3SheetBase {
  @property({ attribute: false }) public hass?: HomeAssistant;

  /** Whether the sheet's entry is on top of the browser history. */
  private _inHistory = false;

  public show(entityId: string, opener: HTMLElement): void {
    this.present(opener, () => {
      // Configured imperatively, as Lovelace does it. The card may have moved
      // on to a sibling since it was last open, so it is asked which entity it
      // shows rather than trusted to still show the last one asked for.
      const card = this.renderRoot.querySelector<M3DetailCard>("m3-detail-card");
      if (card && card.entity !== entityId) card.setConfig({ type: "custom:m3-detail-card", entity: entityId });
      // The same entity again: configured, but its graph was read when it was
      // last open.
      else card?.refresh();
      if (this._body) this._body.scrollTop = 0;
    });
  }

  protected opened(): void {
    this._pushHistory();
  }

  /**
   * A step in the browser history for the open sheet.
   *
   * Home Assistant's own dialogs push one, which is why Android's back
   * gesture closes them. The sheet pushed none, so back left the page — and
   * with no page before it, the companion app closed. Now back pops this entry
   * and the sheet closes; any other way of closing pops it too, so the history
   * is left as it was found. Same URL, so the dashboard's router sees no
   * navigation.
   */
  private _pushHistory(): void {
    if (this._inHistory) return;
    window.history.pushState({ ...(window.history.state ?? {}), m3DetailSheet: true }, "");
    this._inHistory = true;
    window.addEventListener("popstate", this._onPopState);
  }

  /** Back was pressed (or swiped) while the sheet was open. */
  private _onPopState = (e: PopStateEvent): void => {
    if (!this._inHistory || (e.state as { m3DetailSheet?: boolean } | null)?.m3DetailSheet) return;
    void this.leaveHistory(false);
    this.dismiss();
  };

  /**
   * Takes the sheet's entry back out of the history. Resolves once the
   * browser has done so: whoever opens Home Assistant's dialog next pushes an
   * entry of its own, and a `back()` still in flight would pop that one and
   * close the dialog it just opened.
   */
  protected leaveHistory(goBack: boolean): Promise<void> {
    if (!this._inHistory) return Promise.resolve();
    this._inHistory = false;
    window.removeEventListener("popstate", this._onPopState);
    const ours = (window.history.state as { m3DetailSheet?: boolean } | null)?.m3DetailSheet;
    if (!goBack || !ours) return Promise.resolve();
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
  }

  /** A sibling opened from the bottom of the list starts at its own top. */
  private _toTop = (): void => {
    this._body?.scrollTo({ top: 0, behavior: isReducedMotion() ? "auto" : "smooth" });
  };

  protected renderContent() {
    return html`<m3-detail-card
      in-sheet
      .hass=${this.hass}
      .closeHandler=${this._close}
      @m3-detail-switched=${this._toTop}
    ></m3-detail-card>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-detail-sheet": M3DetailSheet;
  }
}
