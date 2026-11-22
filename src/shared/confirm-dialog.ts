import { html, css, nothing, unsafeCSS, type TemplateResult } from "lit";
import {
  CONFIRM_BUTTON_HEIGHT,
  CONFIRM_BUTTON_PRESS_MS,
  CONFIRM_BUTTON_RADIUS,
  CONFIRM_BUTTON_RADIUS_PRESSED,
  CONFIRM_CANCEL_TINT,
  CONFIRM_DESTRUCTIVE_COLOR,
  CONFIRM_DIALOG_RADIUS,
  CONFIRM_DIALOG_WIDTH,
  CONFIRM_ICON,
  CONFIRM_ICON_RADIUS,
  CONFIRM_ICON_TINT,
} from "../const";
import { STANDARD_EASING } from "./animation";
import { inkOn, tintOn } from "./color-config";
import { iconWell } from "./icon-well";

// The "are you sure?" sheet.
//
// `shared/actions.ts` already gates a *configured* action behind
// `window.confirm`, and that stays as it is: it is synchronous, so a decision
// cannot race the action it guards. This module is for the other case — a
// control the card draws itself, where the card knows what is about to be
// thrown away and a native alert would say none of it.
//
// The pattern it replaces is the two-tap arm ("tap once to arm, again to
// send"). That looked clever and failed the one job it had: on a phone, a
// pocket tap arms it and a second pocket tap sends it, and nothing in between
// ever said what was about to happen. A dialog cannot be dismissed by
// accident, and it can name the consequence.

export interface ConfirmRequest {
  title: string;
  /** The consequence, in one sentence. Optional, but usually the point. */
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  icon?: string;
  /**
   * Paints the confirming button red and leads with a warning icon. Default,
   * because nothing that needs a dialog is a neutral choice.
   */
  destructive?: boolean;
  onConfirm: () => void;
}

export interface ConfirmDialogOptions {
  /** Absent means "no question pending" — the dialog renders closed. */
  request?: ConfirmRequest;
  /** Resolves the tint. The card itself. */
  host: HTMLElement;
  /** Cancel, Escape and a backdrop click all land here. */
  onCancel: () => void;
}

/**
 * The defaults a question inherits when it does not spell them out, kept apart
 * from the template so they can be reasoned about (and tested) on their own.
 *
 * `destructive` defaults to true: a choice that needs a dialog is not a neutral
 * one, and a caller that has a genuinely neutral question has to say so.
 */
export function confirmVisuals(request?: ConfirmRequest): {
  destructive: boolean;
  accent: string;
  icon: string;
} {
  const destructive = request?.destructive !== false;
  return {
    destructive,
    // The dialog deliberately sits outside the card's own colour scope — a card
    // accent set inline on `ha-card` does not reach it — so the neutral case
    // takes the theme's primary rather than a variable that would not resolve.
    accent: destructive ? CONFIRM_DESTRUCTIVE_COLOR : "var(--primary-color)",
    icon: request?.icon ?? (destructive ? "mdi:alert-outline" : "mdi:help-circle-outline"),
  };
}

/**
 * The dialog element is rendered whether or not a question is pending, so the
 * host can open and close it with `syncDialogOpenState` instead of having the
 * node appear and disappear under a modal.
 */
export function renderConfirmDialog(options: ConfirmDialogOptions): TemplateResult {
  const request = options.request;
  const { destructive, accent, icon } = confirmVisuals(request);
  const iconBg = tintOn(options.host, accent, undefined, CONFIRM_ICON_TINT);

  return html`
    <dialog
      class="m3-confirm"
      @close=${options.onCancel}
      @cancel=${options.onCancel}
      @click=${(e: Event) => {
        if (e.target === e.currentTarget) options.onCancel();
      }}
    >
      ${request
        ? html`
            <div
              class="confirm-sheet"
              style=${`--confirm-accent: ${accent}; --confirm-ink: ${inkOn(accent, options.host)};`}
            >
              <div class="confirm-icon" style=${`background: ${iconWell(iconBg)};`}>
                <ha-icon icon=${icon}></ha-icon>
              </div>
              <h2 class="confirm-title">${request.title}</h2>
              ${request.message ? html`<p class="confirm-text">${request.message}</p>` : nothing}
              <div class="confirm-actions">
                <!-- Cancel first, and not only for reading order: showModal()
                     focuses the first focusable child, and the harmless one is
                     the right thing to have under a stray Enter. -->
                <button class="confirm-cancel" @click=${options.onCancel}>
                  ${request.cancelLabel}
                </button>
                <button
                  class="confirm-ok ${destructive ? "destructive" : ""}"
                  @click=${() => {
                    options.onCancel();
                    request.onConfirm();
                  }}
                >
                  ${request.confirmLabel}
                </button>
              </div>
            </div>
          `
        : nothing}
    </dialog>
  `;
}

export const confirmDialogStyles = css`
  dialog.m3-confirm {
    border: none;
    padding: 0;
    background: transparent;
    width: min(${CONFIRM_DIALOG_WIDTH}px, 88vw);
    max-width: none;
    overflow: visible;
    color: var(--primary-text-color);
  }

  dialog.m3-confirm::backdrop {
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(2px);
  }

  .confirm-sheet {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 10px;
    padding: 22px 20px 16px;
    border-radius: ${unsafeCSS(CONFIRM_DIALOG_RADIUS)}px;
    background: var(--card-background-color, #fff);
    font-family: var(--paper-font-body1_-_font-family, inherit);
  }

  .confirm-icon {
    width: ${unsafeCSS(CONFIRM_ICON)}px;
    height: ${unsafeCSS(CONFIRM_ICON)}px;
    border-radius: ${unsafeCSS(CONFIRM_ICON_RADIUS)}px;
    display: grid;
    place-items: center;
    color: var(--confirm-accent);
    --mdc-icon-size: 24px;
  }

  .confirm-title {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 700;
    line-height: 1.3;
  }

  .confirm-text {
    margin: 0;
    font-size: 0.85rem;
    line-height: 1.4;
    color: var(--secondary-text-color);
  }

  .confirm-actions {
    display: flex;
    gap: 8px;
    width: 100%;
    margin-top: 6px;
  }

  .confirm-cancel,
  .confirm-ok {
    flex: 1;
    min-width: 0;
    height: ${unsafeCSS(CONFIRM_BUTTON_HEIGHT)}px;
    border: none;
    border-radius: ${unsafeCSS(CONFIRM_BUTTON_RADIUS)}px;
    font-family: inherit;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
    transition: border-radius ${unsafeCSS(CONFIRM_BUTTON_PRESS_MS)}ms ${unsafeCSS(STANDARD_EASING)};
  }

  .confirm-cancel:active,
  .confirm-ok:active {
    border-radius: ${unsafeCSS(CONFIRM_BUTTON_RADIUS_PRESSED)}px;
  }

  .confirm-cancel {
    background: color-mix(
      in srgb,
      var(--primary-text-color, currentColor) ${unsafeCSS(CONFIRM_CANCEL_TINT)}%,
      transparent
    );
    color: var(--primary-text-color);
  }

  /* The confirming button is the filled one — the dialog exists to make this
     choice deliberate, so it should be the one the eye lands on. */
  .confirm-ok {
    background: var(--confirm-accent);
    color: var(--confirm-ink);
  }

  @media (prefers-reduced-motion: reduce) {
    .confirm-cancel,
    .confirm-ok {
      transition: none;
    }
  }
`;
