// A thermostat's target, adjusted in the card before it is sent.
//
// A step used to call `climate.set_temperature` at once and the next step
// started from what Home Assistant reported. That lags: a Zigbee valve takes
// a second or two to confirm, so a second tap in that time stepped from the
// old value again, and holding a button could never work. The card now
// keeps a draft: every step moves the draft, the reading shows it, and the
// value is sent once, a moment after the last step — one call per adjustment
// instead of one per tap, which battery valves are grateful for too.
//
// Holding a button repeats the step: a pause first, so a tap stays one step,
// then steady, then faster.

import type { ReactiveController, ReactiveControllerHost } from "lit";

/** After the last step, this long until the value is sent. */
export const SETPOINT_COMMIT_MS = 700;
/** Held this long, a button starts repeating. */
export const HOLD_DELAY_MS = 400;
/** The repeat, and the faster one after a few steps. */
export const HOLD_REPEAT_MS = 160;
export const HOLD_FAST_MS = 70;
export const HOLD_FAST_AFTER = 8;
/** A sent value Home Assistant never confirms is dropped after this long. */
export const DRAFT_STALE_MS = 6000;

interface Draft {
  value: number;
  sentAt?: number;
}

export interface HoldHandlers {
  down: (e: PointerEvent) => void;
  up: () => void;
  click: (e: MouseEvent) => void;
  menu: (e: Event) => void;
}

export class SetpointDraft implements ReactiveController {
  private drafts = new Map<string, Draft>();
  private commitTimer?: ReturnType<typeof setTimeout>;
  private pendingCommit?: () => void;
  private pendingKeys: string[] = [];
  private holdDelay?: ReturnType<typeof setTimeout>;
  private holdRepeat?: ReturnType<typeof setTimeout>;
  private pointerStep = false;

  /** `onChange` asks the host to render: a draft is not a property. */
  constructor(
    host: ReactiveControllerHost,
    private onChange: () => void,
    private now: () => number = () => Date.now(),
  ) {
    host.addController(this);
  }

  hostDisconnected(): void {
    this.stopHold();
    // Leaving the page mid-adjustment still sends what was set.
    this.flush();
  }

  /**
   * The value to show for `key`: the draft while there is one, else what
   * Home Assistant reports. A sent draft gives way once Home Assistant
   * reports the same value, or after a while if it never does.
   */
  get(key: string, actual: number | undefined): number | undefined {
    const d = this.drafts.get(key);
    if (!d) return actual;
    if (d.sentAt !== undefined) {
      const confirmed = actual !== undefined && Math.abs(actual - d.value) < 1e-6;
      if (confirmed || this.now() - d.sentAt > DRAFT_STALE_MS) {
        this.drafts.delete(key);
        return actual;
      }
    }
    return d.value;
  }

  /** Whether `key` has a value not yet sent. */
  pending(key: string): boolean {
    const d = this.drafts.get(key);
    return !!d && d.sentAt === undefined;
  }

  /**
   * Moves the drafts and sends them `SETPOINT_COMMIT_MS` after the last
   * move — or at once with `immediate`, as for a typed value.
   */
  set(values: Record<string, number>, commit: () => void, immediate = false): void {
    for (const [k, v] of Object.entries(values)) this.drafts.set(k, { value: v });
    this.pendingKeys = Object.keys(values);
    this.pendingCommit = commit;
    clearTimeout(this.commitTimer);
    if (immediate) this.flush();
    else this.commitTimer = setTimeout(() => this.flush(), SETPOINT_COMMIT_MS);
    this.onChange();
  }

  /** Sends what is pending now. */
  flush(): void {
    clearTimeout(this.commitTimer);
    this.commitTimer = undefined;
    const commit = this.pendingCommit;
    this.pendingCommit = undefined;
    if (!commit) return;
    const at = this.now();
    for (const k of this.pendingKeys) {
      const d = this.drafts.get(k);
      if (d) d.sentAt = at;
    }
    this.pendingKeys = [];
    commit();
  }

  /**
   * Pointer handlers for a step button: one step on press, repeating while
   * held. The click a pointer press also produces is swallowed; a click
   * from the keyboard (Enter, Space) steps once.
   */
  hold(step: () => void): HoldHandlers {
    return {
      down: (e: PointerEvent) => {
        if (e.button !== 0) return;
        this.stopHold();
        this.pointerStep = true;
        step();
        let n = 0;
        const again = () => {
          step();
          n += 1;
          this.holdRepeat = setTimeout(again, n >= HOLD_FAST_AFTER ? HOLD_FAST_MS : HOLD_REPEAT_MS);
        };
        this.holdDelay = setTimeout(again, HOLD_DELAY_MS);
      },
      up: () => this.stopHold(),
      click: (e: MouseEvent) => {
        // detail 0: a click the keyboard made. A pointer's click was a step
        // already, on its pointerdown.
        if (e.detail === 0 && !this.pointerStep) step();
        this.pointerStep = false;
      },
      menu: (e: Event) => e.preventDefault(),
    };
  }

  private stopHold(): void {
    clearTimeout(this.holdDelay);
    clearTimeout(this.holdRepeat);
    this.holdDelay = undefined;
    this.holdRepeat = undefined;
  }
}

/**
 * A typed target: decimal comma or point, held to the limits and to the
 * thermostat's step. Undefined when it is not a number.
 */
export function parseTarget(text: string, limits: { step: number; min: number; max: number }): number | undefined {
  const n = Number(String(text).trim().replace(",", "."));
  if (!Number.isFinite(n) || String(text).trim() === "") return undefined;
  const clamped = Math.min(limits.max, Math.max(limits.min, n));
  const stepped = Math.round(clamped / limits.step) * limits.step;
  return Number(stepped.toFixed(4));
}
