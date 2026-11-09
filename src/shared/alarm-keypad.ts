import { css, html, nothing, unsafeCSS, type TemplateResult } from "lit";
import {
  ALARM_KEY_GAP,
  ALARM_KEY_RADIUS_PRESSED,
  ALARM_KEY_SIZE,
  ALARM_SHAKE_MS,
} from "../const";
import { STANDARD_EASING } from "./animation";
import type { CodeFormat } from "./alarm";

// The alarm card's code entry (#47). A number code gets a keypad — twelve
// round keys that square off a little while pressed, and dots for the digits
// typed so far — a text code a field. Nothing is submitted by itself after
// some number of digits: codes differ in length, so there is a confirm
// button, and Enter.
//
// The code lives only in the card's state for as long as it is being typed.
// It is not logged, not stored, and the card clears it after every attempt.

export interface KeypadParams {
  format: CodeFormat;
  /** The heading: what the code is for. */
  title: string;
  code: string;
  error?: string;
  /** Bumped on a rejected code; a change restarts the shake. */
  shake: number;
  busy: boolean;
  labels: { confirm: string; cancel: string; delete: string; code: string };
  onDigit: (d: string) => void;
  onDelete: () => void;
  onInput: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export function renderKeypad(p: KeypadParams): TemplateResult {
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      p.onSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      p.onCancel();
    } else if (p.format === "number" && /^[0-9]$/.test(e.key)) {
      e.preventDefault();
      p.onDigit(e.key);
    } else if (p.format === "number" && e.key === "Backspace") {
      e.preventDefault();
      p.onDelete();
    }
  };
  return html`
    <div class="keypad ${p.shake % 2 ? "shake-a" : p.shake ? "shake-b" : ""}" @keydown=${onKey}>
      <div class="keypad-title">${p.title}</div>
      ${p.format === "number"
        ? html`
            <div class="keypad-dots" aria-label=${p.labels.code} aria-live="polite">
              ${p.code.length
                ? Array.from(p.code).map(() => html`<span class="keypad-dot"></span>`)
                : html`<span class="keypad-dot empty"></span>`}
            </div>
            ${p.error ? html`<div class="keypad-error" role="alert">${p.error}</div>` : nothing}
            <div class="keypad-grid">
              ${DIGITS.map((d) => key(d, () => p.onDigit(d), p.busy))}
              ${key(p.labels.cancel, p.onCancel, false, "mdi:close", "cancel")}
              ${key("0", () => p.onDigit("0"), p.busy)}
              ${key(p.labels.delete, p.onDelete, p.busy || !p.code, "mdi:backspace-outline", "delete")}
            </div>
            <button class="keypad-confirm" ?disabled=${p.busy} @click=${p.onSubmit}>${p.labels.confirm}</button>
          `
        : html`
            <div class="keypad-text">
              <input
                type="password"
                autocomplete="off"
                .value=${p.code}
                aria-label=${p.labels.code}
                placeholder=${p.labels.code}
                @input=${(e: Event) => p.onInput((e.target as HTMLInputElement).value)}
              />
              <button class="keypad-confirm" ?disabled=${p.busy} @click=${p.onSubmit}>${p.labels.confirm}</button>
            </div>
            ${p.error ? html`<div class="keypad-error" role="alert">${p.error}</div>` : nothing}
            <button class="keypad-link" @click=${p.onCancel}>${p.labels.cancel}</button>
          `}
    </div>
  `;
}

function key(label: string, onClick: () => void, disabled: boolean, icon?: string, kind = "digit"): TemplateResult {
  return html`<button class="keypad-key ${kind}" aria-label=${label} ?disabled=${disabled} @click=${onClick}>
    ${icon ? html`<ha-icon icon=${icon}></ha-icon>` : label}
  </button>`;
}

const EASING = unsafeCSS(STANDARD_EASING);

export const keypadStyles = css`
  .keypad {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding-top: 2px;
  }

  .keypad-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--m3p-secondary-text, var(--secondary-text-color));
  }

  .keypad-dots {
    display: flex;
    gap: 8px;
    height: 12px;
    align-items: center;
  }

  .keypad-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--m3p-text, var(--primary-text-color));
  }

  .keypad-dot.empty {
    background: transparent;
    border: 1.5px solid var(--m3p-secondary-text, var(--secondary-text-color));
    box-sizing: border-box;
  }

  .keypad-grid {
    display: grid;
    grid-template-columns: repeat(3, ${unsafeCSS(ALARM_KEY_SIZE)}px);
    gap: ${unsafeCSS(ALARM_KEY_GAP)}px;
  }

  .keypad-key {
    width: ${unsafeCSS(ALARM_KEY_SIZE)}px;
    height: ${unsafeCSS(ALARM_KEY_SIZE)}px;
    border-radius: 50%;
    border: none;
    background: var(--alarm-key-bg);
    color: var(--m3p-text, var(--primary-text-color));
    font: inherit;
    font-size: 20px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-radius 160ms ${EASING}, background-color 160ms ${EASING};
    -webkit-tap-highlight-color: transparent;
  }

  .keypad-key:active:not(:disabled) {
    border-radius: ${unsafeCSS(ALARM_KEY_RADIUS_PRESSED)}px;
  }

  .keypad-key.cancel,
  .keypad-key.delete {
    background: transparent;
    --mdc-icon-size: 22px;
  }

  .keypad-key:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .keypad-key:focus-visible,
  .keypad-confirm:focus-visible,
  .keypad-link:focus-visible {
    outline: 2px solid var(--alarm-accent-fg, var(--primary-color));
    outline-offset: 2px;
  }

  .keypad-confirm {
    min-width: 160px;
    height: 44px;
    padding: 0 20px;
    border: none;
    border-radius: 22px;
    background: var(--alarm-confirm-bg);
    color: var(--alarm-confirm-ink);
    font: inherit;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
  }

  .keypad-confirm:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .keypad-text {
    display: flex;
    gap: 8px;
    width: 100%;
  }

  .keypad-text input {
    flex: 1;
    min-width: 0;
    height: 44px;
    padding: 0 14px;
    border-radius: 14px;
    border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.4));
    background: var(--alarm-key-bg);
    color: var(--m3p-text, var(--primary-text-color));
    font: inherit;
    font-size: 16px;
  }

  .keypad-text .keypad-confirm {
    min-width: 0;
  }

  .keypad-link {
    border: none;
    background: none;
    color: var(--m3p-secondary-text, var(--secondary-text-color));
    font: inherit;
    font-size: 13px;
    cursor: pointer;
    padding: 4px 8px;
  }

  .keypad-error {
    font-size: 13px;
    font-weight: 600;
    color: var(--alarm-error-fg);
  }

  /* A rejected code: a short shake. Two classes so a second rejection in a
     row restarts the animation. */
  .keypad.shake-a .keypad-dots,
  .keypad.shake-a .keypad-text,
  .keypad.shake-b .keypad-dots,
  .keypad.shake-b .keypad-text {
    animation: alarm-shake-a ${unsafeCSS(ALARM_SHAKE_MS)}ms ${EASING};
  }

  .keypad.shake-b .keypad-dots,
  .keypad.shake-b .keypad-text {
    animation-name: alarm-shake-b;
  }

  @keyframes alarm-shake-a {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-8px); }
    40% { transform: translateX(7px); }
    60% { transform: translateX(-5px); }
    80% { transform: translateX(3px); }
  }

  @keyframes alarm-shake-b {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-8px); }
    40% { transform: translateX(7px); }
    60% { transform: translateX(-5px); }
    80% { transform: translateX(3px); }
  }

  @media (prefers-reduced-motion: reduce) {
    .keypad-key {
      transition: none;
    }

    .keypad .keypad-dots,
    .keypad .keypad-text {
      animation: none !important;
    }
  }
`;
