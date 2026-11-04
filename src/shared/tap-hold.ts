import { NAV_DOUBLE_TAP_MS, NAV_DRAG_THRESHOLD_PX, NAV_HOLD_MS } from "../const";

// Tap / hold / double-tap on one element, told apart from each other and from a
// drag.
//
// The button card has carried its own copy of this since it was the only card
// that needed it, and `shared/actions.ts` says out loud that the next card to
// need the same thing should not write a third one. This is that module. It is
// written fresh rather than lifted out of the button card, because the button
// card's copy is entangled with its slider drag and its icon's second set of
// actions — and because that card is the most-used in the suite and not worth
// destabilising for a refactor it does not benefit from today. It can adopt this
// whenever it is next touched; the timings here are its own, so the behaviour
// would not change.
//
// Why the double-tap delay is conditional: waiting to see whether a second tap
// arrives makes every single tap feel late. So the wait only happens when a
// double-tap action actually exists — the common case, where it does not, fires
// on the first tap with no delay at all.

export interface TapHoldCallbacks {
  onTap?: () => void;
  onHold?: () => void;
  onDoubleTap?: () => void;
  /** Whether a hold is worth watching for. Read per gesture, not at wiring time. */
  hasHold?: () => boolean;
  /** Whether a double tap is worth waiting for. Read per gesture. */
  hasDoubleTap?: () => boolean;
}

export class TapHold {
  private holdTimer?: number;
  private tapTimer?: number;
  private startX = 0;
  private startY = 0;
  private holdFired = false;
  private moved = false;
  private lastTapAt = 0;

  constructor(private readonly cb: TapHoldCallbacks) {}

  /** Wire as `@pointerdown=${h.down} @pointermove=${h.move} @pointerup=${h.up}`. */
  readonly down = (e: PointerEvent): void => {
    this.holdFired = false;
    this.moved = false;
    this.startX = e.clientX;
    this.startY = e.clientY;
    if (!this.cb.hasHold?.()) return;
    window.clearTimeout(this.holdTimer);
    this.holdTimer = window.setTimeout(() => {
      this.holdFired = true;
      this.cb.onHold?.();
    }, NAV_HOLD_MS);
  };

  readonly move = (e: PointerEvent): void => {
    if (this.moved) return;
    if (
      Math.abs(e.clientX - this.startX) > NAV_DRAG_THRESHOLD_PX ||
      Math.abs(e.clientY - this.startY) > NAV_DRAG_THRESHOLD_PX
    ) {
      // A finger that travelled is scrolling or dragging the sheet, not
      // pressing this entry.
      this.moved = true;
      window.clearTimeout(this.holdTimer);
    }
  };

  readonly up = (): void => {
    window.clearTimeout(this.holdTimer);
  };

  /**
   * Someone else took the gesture (the nav bar's swipe captured the pointer):
   * no hold, and the click that may still arrive is not a tap.
   */
  readonly abandon = (): void => {
    this.moved = true;
    window.clearTimeout(this.holdTimer);
  };

  /** Wire as `@click=${h.click}`. Returns without acting on a drag or after a hold. */
  readonly click = (): void => {
    if (this.moved) {
      this.moved = false;
      return;
    }
    if (this.holdFired) {
      this.holdFired = false;
      return;
    }

    if (!this.cb.hasDoubleTap?.()) {
      this.cb.onTap?.();
      return;
    }

    const now = Date.now();
    if (now - this.lastTapAt < NAV_DOUBLE_TAP_MS) {
      this.lastTapAt = 0;
      window.clearTimeout(this.tapTimer);
      this.cb.onDoubleTap?.();
      return;
    }
    this.lastTapAt = now;
    this.tapTimer = window.setTimeout(() => {
      // A second tap resets `lastTapAt`, so this only fires for a lone one.
      if (this.lastTapAt !== now) return;
      this.cb.onTap?.();
    }, NAV_DOUBLE_TAP_MS);
  };

  /** Clears anything pending. Call from the card's disconnectedCallback. */
  destroy(): void {
    window.clearTimeout(this.holdTimer);
    window.clearTimeout(this.tapTimer);
  }
}

/**
 * Home Assistant's own haptic channel: the companion app listens for this event
 * on the document and vibrates. On a desktop browser nothing listens and the
 * event is harmless, so it needs no platform check.
 */
export function fireHaptic(
  source: HTMLElement,
  kind: "light" | "medium" | "heavy" | "selection" | "success" | "warning" | "failure" = "light",
): void {
  source.dispatchEvent(
    new CustomEvent("haptic", { bubbles: true, composed: true, detail: kind }),
  );
}
