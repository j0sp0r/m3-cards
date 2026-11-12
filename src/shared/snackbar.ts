import { LitElement, html, css, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";

// A Material snackbar for the whole suite: one element on document.body, so it
// is not clipped by a card and is reused by every card that needs one. Inverse
// surface, one line of text, an optional action, gone after a few seconds.
// Announced through aria-live.

const TAG = "m3-snackbar";
const DEFAULT_MS = 5000;

export interface SnackbarOptions {
  message: string;
  action?: { label: string; onAction: () => void };
  durationMs?: number;
}

@customElement(TAG)
export class M3Snackbar extends LitElement {
  @state() private _opts?: SnackbarOptions;
  @state() private _open = false;
  private _timer?: number;

  public show(opts: SnackbarOptions): void {
    if (this._timer) window.clearTimeout(this._timer);
    this._opts = opts;
    this._open = true;
    this._timer = window.setTimeout(() => this.hide(), opts.durationMs ?? DEFAULT_MS);
  }

  public hide(): void {
    if (this._timer) window.clearTimeout(this._timer);
    this._timer = undefined;
    this._open = false;
  }

  private _act(): void {
    const action = this._opts?.action;
    this.hide();
    action?.onAction();
  }

  protected render() {
    const o = this._opts;
    return html`
      <div class="bar ${this._open ? "open" : ""}" role="status" aria-live="polite">
        ${o
          ? html`<span class="msg">${o.message}</span>
              ${o.action && this._open
                ? html`<button class="action" @click=${this._act}>${o.action.label}</button>`
                : nothing}`
          : nothing}
      </div>
    `;
  }

  static styles = css`
    :host {
      position: fixed;
      left: 0;
      right: 0;
      bottom: calc(24px + var(--m3-snackbar-offset, 72px) + env(safe-area-inset-bottom, 0px));
      display: flex;
      justify-content: center;
      pointer-events: none;
      z-index: 9;
    }
    .bar {
      display: flex;
      align-items: center;
      gap: 12px;
      max-width: min(560px, calc(100vw - 32px));
      min-height: 48px;
      box-sizing: border-box;
      padding: 6px 8px 6px 16px;
      border-radius: 12px;
      background: var(--m3-inverse-surface, #e6e1e5);
      color: var(--m3-inverse-on-surface, #313033);
      font: 500 14px/1.35 var(--paper-font-body1_-_font-family, Roboto, system-ui, sans-serif);
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
      opacity: 0;
      transform: translateY(12px);
      transition: opacity 180ms ease, transform 220ms cubic-bezier(0.2, 0, 0, 1);
    }
    .bar.open {
      opacity: 1;
      transform: none;
      pointer-events: auto;
    }
    .msg {
      flex: 1;
      min-width: 0;
    }
    .action {
      border: none;
      background: none;
      color: var(--m3-inverse-primary, #4f6a3a);
      font: inherit;
      font-weight: 700;
      padding: 10px 12px;
      border-radius: 20px;
      cursor: pointer;
    }
    .action:focus-visible {
      outline: 2px solid currentColor;
    }
    @media (prefers-reduced-motion: reduce) {
      .bar {
        transition: none;
      }
    }
  `;
}

let instance: M3Snackbar | undefined;

export function showSnackbar(opts: SnackbarOptions): void {
  if (typeof document === "undefined") return;
  if (!instance || !instance.isConnected) {
    instance = document.createElement(TAG) as M3Snackbar;
    document.body.appendChild(instance);
  }
  instance.show(opts);
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-snackbar": M3Snackbar;
  }
}
