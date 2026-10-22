import { LitElement, html, css, unsafeCSS, type CSSResultGroup, type TemplateResult } from "lit";
import { query } from "lit/decorators.js";
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

// The bottom sheet both the detail view and the popup card open in: a modal
// <dialog> that slides up from the bottom edge on a phone and fades in
// centred on a desktop, with a grip to drag it down by, a backdrop and
// Escape to close it, and the same motion everywhere.
//
// What goes in it and what closing it means for the browser history are the
// subclass's: the detail sheet pushes an entry of its own, the popup card's
// entry is its URL hash. This class owns the dialog, the motion and the
// gestures, so a fix to any of them reaches both.

const EASING = unsafeCSS(STANDARD_EASING);

export abstract class M3SheetBase extends LitElement {
  @query("dialog") protected _dialog?: HTMLDialogElement;
  @query(".sheet") protected _sheetEl?: HTMLElement;
  @query(".body") protected _body?: HTMLElement;

  protected _openedAt = 0;
  private _closing = false;
  private _gesture?: SheetGesture;
  private _detach: (() => void)[] = [];
  private _closeTimer?: number;

  /** What the sheet holds, below the grip. */
  protected abstract renderContent(): unknown;

  /** Called once the dialog is shown, before it slides up. */
  protected opened(): void {}

  /**
   * Undoes whatever opening did to the browser history. `goBack` is false
   * when the page is already being navigated away from. Resolves once it is
   * safe to open another dialog.
   */
  protected leaveHistory(_goBack: boolean): Promise<void> {
    return Promise.resolve();
  }

  /** Called once the dialog has closed, after the slide out. */
  protected closed(): void {}

  public get isOpen(): boolean {
    return !!this._dialog?.open && !this._closing;
  }

  /**
   * Slides the sheet up. `prepare` runs once the sheet is rendered and before
   * it is shown — the place to configure what it holds.
   */
  protected present(opener: HTMLElement | undefined, prepare?: () => void): void {
    window.clearTimeout(this._closeTimer);
    this._closing = false;
    // Closing a <dialog> hands focus back to whatever had it on opening and
    // scrolls that into view; parked on what the finger hit, the page stays
    // where it was. The same anchor popup-card.ts sets.
    if (opener) anchorFocus(anchorTarget(opener));
    void this.updateComplete.then(() => {
      const dialog = this._dialog;
      if (!dialog) return;
      prepare?.();
      const reopening = dialog.open;
      if (!reopening) dialog.showModal();
      // Also when reopened while sliding out: closing took the entry away.
      this.opened();
      this._openedAt = Date.now();
      // Off the bottom edge first, without a transition, so the slide up has
      // somewhere to start from. This used to place it at fully open, which
      // left the transition nothing to animate: the sheet appeared in one
      // frame and only closing moved. A sheet already open (a second tap
      // while it slides out) stays where it is and just comes back up.
      if (!reopening) this._place(0, false);
      // Commit that position before asking for the next one. Without the
      // layout read, the browser folds both writes into one style change
      // and, again, there is nothing between them to animate.
      void this._sheetEl?.offsetHeight;
      requestAnimationFrame(() => {
        this.setAttribute("open", "");
        this._place(1, true);
      });
    });
  }

  /**
   * Slides out, then closes. `immediate` skips the animation (card removed).
   * The promise resolves once the history is put back, which is when it is
   * safe to open another dialog.
   */
  public dismiss(immediate = false): Promise<void> {
    const dialog = this._dialog;
    // Removed with the card, the page is already being navigated away from:
    // stepping back now would undo that navigation.
    const history = this.leaveHistory(!immediate);
    if (!dialog?.open || this._closing) return history;
    this._closing = true;
    this.removeAttribute("open");
    const done = () => {
      this._closing = false;
      if (dialog.open) dialog.close();
      this.closed();
    };
    if (immediate || isReducedMotion()) {
      done();
      return history;
    }
    this._place(0, true);
    this._closeTimer = window.setTimeout(done, DETAIL_SHEET_SLIDE_MS);
    return history;
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
    void this.leaveHistory(false);
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

  protected _close = (): Promise<void> => this.dismiss();

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

  protected render(): TemplateResult {
    return html`
      <dialog @click=${this._onBackdrop} @cancel=${this._onCancel}>
        <!-- showModal() focuses the first focusable thing inside, which is a
             header button, and draws a ring round it on opening. The sheet
             itself takes the focus instead; Tab still reaches every button. -->
        <div class="sheet" role="document" tabindex="-1" autofocus>
          <div class="grip-zone"><div class="grip"></div></div>
          <div class="body">${this.renderContent()}</div>
        </div>
      </dialog>
    `;
  }

  static styles: CSSResultGroup = css`
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
