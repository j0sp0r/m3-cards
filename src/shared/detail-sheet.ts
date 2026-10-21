import { LitElement, html, css, unsafeCSS } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import type { HomeAssistant } from "../types";
import type { M3DetailCard } from "../m3-detail-card";
import {
  DETAIL_GRIP_HEIGHT,
  DETAIL_GRIP_WIDTH,
  DETAIL_SHEET_MAX_WIDTH,
  DETAIL_SHEET_RADIUS,
  DETAIL_SHEET_SLIDE_MS,
} from "../const";
import { STANDARD_EASING, isReducedMotion } from "./animation";
import { anchorFocus, anchorTarget } from "./focus-anchor";
import { POPUP_CLICK_GUARD_MS } from "./popup-card";
import { SheetGesture } from "./sheet-gesture";
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

const EASING = unsafeCSS(STANDARD_EASING);

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
export class M3DetailSheet extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @query("dialog") private _dialog?: HTMLDialogElement;
  @query(".sheet") private _sheetEl?: HTMLElement;
  @query(".body") private _body?: HTMLElement;

  private _openedAt = 0;
  private _closing = false;
  private _gesture?: SheetGesture;
  private _detach: (() => void)[] = [];
  private _closeTimer?: number;

  public show(entityId: string, opener: HTMLElement): void {
    window.clearTimeout(this._closeTimer);
    this._closing = false;
    // Closing a <dialog> hands focus back to whatever had it on opening and
    // scrolls that into view; parked on what the finger hit, the page stays
    // where it was. The same anchor popup-card.ts sets.
    anchorFocus(anchorTarget(opener));
    void this.updateComplete.then(() => {
      const dialog = this._dialog;
      if (!dialog) return;
      // Configured imperatively, as Lovelace does it. The card may have moved
      // on to a sibling since it was last open, so it is asked which entity it
      // shows rather than trusted to still show the last one asked for.
      const card = this.renderRoot.querySelector<M3DetailCard>("m3-detail-card");
      if (card && card.entity !== entityId) card.setConfig({ type: "custom:m3-detail-card", entity: entityId });
      // The same entity again: configured, but its graph was read when it was
      // last open.
      else card?.refresh();
      if (this._body) this._body.scrollTop = 0;
      if (!dialog.open) dialog.showModal();
      this._openedAt = Date.now();
      this._place(1, false);
      // Next frame: the dialog has to be laid out at its start position before
      // the transition to the open one has anything to animate from.
      requestAnimationFrame(() => {
        this.setAttribute("open", "");
        this._place(1, true);
      });
    });
  }

  /** Slides out, then closes. `immediate` skips the animation (card removed). */
  public dismiss(immediate = false): void {
    const dialog = this._dialog;
    if (!dialog?.open || this._closing) return;
    this._closing = true;
    this.removeAttribute("open");
    const done = () => {
      this._closing = false;
      if (dialog.open) dialog.close();
    };
    if (immediate || isReducedMotion()) {
      done();
      return;
    }
    this._place(0, true);
    this._closeTimer = window.setTimeout(done, DETAIL_SHEET_SLIDE_MS);
  }

  protected firstUpdated(): void {
    this._attachGesture();
  }

  private _attachGesture(): void {
    const grip = this.renderRoot.querySelector<HTMLElement>(".grip-zone");
    const body = this.renderRoot.querySelector<HTMLElement>(".body");
    this._gesture = new SheetGesture({
      geometry: () => ({ travel: this._sheetEl?.offsetHeight ?? 0, snapPoints: [0, 1] }),
      current: () => 1,
      onDrag: (f) => this._place(f, false),
      onSettle: (f) => (f <= 0 ? this.dismiss() : this._place(1, true)),
      onTap: () => undefined,
      reducedMotion: isReducedMotion,
    });
    if (grip) this._detach.push(this._gesture.attachHandle(grip));
    if (body) this._detach.push(this._gesture.attachContent(body));
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    window.clearTimeout(this._closeTimer);
    this._detach.forEach((off) => off());
    this._detach = [];
    this._gesture?.destroy();
    this._gesture = undefined;
  }

  public connectedCallback(): void {
    super.connectedCallback();
    // Moved between cards or re-inserted: disconnectedCallback dropped the
    // handlers, and firstUpdated does not run twice.
    if (this.hasUpdated && !this._gesture) this._attachGesture();
  }

  /** 1 is fully open, 0 is off the bottom edge. */
  private _place(fraction: number, animated: boolean): void {
    const el = this._sheetEl;
    if (!el) return;
    el.style.transition = animated && !isReducedMotion() ? "" : "none";
    el.style.setProperty("--sheet-offset", `${(1 - fraction) * 100}%`);
    el.style.setProperty("--sheet-open", String(fraction));
  }

  private _close = (): void => this.dismiss();

  /** A sibling opened from the bottom of the list starts at its own top. */
  private _toTop = (): void => {
    this._body?.scrollTo({ top: 0, behavior: isReducedMotion() ? "auto" : "smooth" });
  };

  private _onBackdrop(e: MouseEvent): void {
    if (e.target !== e.currentTarget) return;
    // The tap that opened the sheet can land on the backdrop under the same
    // click; without the guard it closes what it just opened.
    if (Date.now() - this._openedAt < POPUP_CLICK_GUARD_MS) return;
    this.dismiss();
  }

  private _onCancel(e: Event): void {
    // Escape: animate out instead of letting the browser close it in one frame.
    e.preventDefault();
    this.dismiss();
  }

  protected render() {
    return html`
      <dialog @click=${this._onBackdrop} @cancel=${this._onCancel}>
        <!-- showModal() focuses the first focusable thing inside, which is the
             settings button, and draws a ring round it on opening. The sheet
             itself takes the focus instead; Tab still reaches every button. -->
        <div class="sheet" role="document" tabindex="-1" autofocus>
          <div class="grip-zone"><div class="grip"></div></div>
          <div class="body" @m3-detail-switched=${this._toTop}>
            <m3-detail-card in-sheet .hass=${this.hass} .closeHandler=${this._close}></m3-detail-card>
          </div>
        </div>
      </dialog>
    `;
  }

  static styles = css`
    :host {
      display: contents;
    }

    dialog {
      border: none;
      padding: 0;
      margin: auto auto 0;
      width: 100%;
      max-width: min(${DETAIL_SHEET_MAX_WIDTH}px, 100vw);
      max-height: 92dvh;
      background: transparent;
      overflow: visible;
      color: var(--primary-text-color);
    }

    dialog:focus,
    dialog:focus-visible,
    .sheet:focus {
      outline: none;
    }

    dialog::backdrop {
      background: rgba(0, 0, 0, 0);
      transition: background ${DETAIL_SHEET_SLIDE_MS}ms ${EASING};
    }
    :host([open]) dialog::backdrop {
      background: rgba(0, 0, 0, 0.5);
    }

    .sheet {
      --sheet-offset: 100%;
      --sheet-open: 0;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      max-height: 92dvh;
      border-radius: ${DETAIL_SHEET_RADIUS}px ${DETAIL_SHEET_RADIUS}px 0 0;
      background: var(--ha-card-background, var(--card-background-color, #1c1c1c));
      box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.35);
      transform: translateY(var(--sheet-offset));
      transition: transform ${DETAIL_SHEET_SLIDE_MS}ms ${EASING};
      padding-bottom: env(safe-area-inset-bottom, 0px);
    }

    .grip-zone {
      flex: 0 0 auto;
      display: grid;
      place-items: center;
      height: 22px;
      cursor: grab;
      touch-action: none;
    }
    .grip {
      width: ${DETAIL_GRIP_WIDTH}px;
      height: ${DETAIL_GRIP_HEIGHT}px;
      border-radius: 2px;
      background: currentColor;
      opacity: 0.3;
    }

    .body {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 0 18px 20px;
    }

    /* A desktop is not a phone held in one hand: centred, all four corners
       round, and it fades in rather than climbing out of the bottom edge. */
    @media (min-width: 600px) and (min-height: 600px) {
      dialog {
        margin: auto;
      }
      .sheet {
        border-radius: ${DETAIL_SHEET_RADIUS}px;
        transform: translateY(calc((1 - var(--sheet-open)) * 24px));
        opacity: var(--sheet-open);
        transition:
          transform ${DETAIL_SHEET_SLIDE_MS}ms ${EASING},
          opacity ${DETAIL_SHEET_SLIDE_MS}ms ${EASING};
      }
      .grip-zone {
        height: 14px;
      }
      .grip {
        display: none;
      }
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-detail-sheet": M3DetailSheet;
  }
}
