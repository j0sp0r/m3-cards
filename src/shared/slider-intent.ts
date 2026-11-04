// A slider that does not swallow the page scroll (#27).
//
// With `touch-action: none` a swipe that starts on a slider can never become a
// scroll. On a view of lights, where most of the screen is slider, scrolling
// the page then mostly changes some light's brightness. HA's own tile slider
// and Bubble Card avoid that the same way, and so does this:
//
//   1. The slider gets `touch-action: pan-y` (see SLIDER_TOUCH_ACTION): the
//      browser keeps vertical scrolling. If the finger goes up or down, it
//      scrolls the page and sends `pointercancel`.
//   2. A touch is only *pending* at first. Once the finger has moved
//      INTENT_SLOP_PX, the dominant direction decides: along the slider means
//      drag, across it means the page's, and the slider ignores the rest of
//      the gesture.
//   3. A touch that never moves is a tap, and acts only on release — so a
//      scroll that happens to begin on a slider changes nothing.
//
// Mouse and pen have no scroll to protect and start the drag at once, as
// before.

/** CSS for a horizontal slider: the browser keeps vertical panning. */
export const SLIDER_TOUCH_ACTION = "pan-y";

/** Movement before a touch counts as a drag or a scroll. */
export const INTENT_SLOP_PX = 8;

type Phase = "idle" | "pending" | "drag" | "scroll";

export class SliderIntent {
  private _phase: Phase = "idle";
  private _x = 0;
  private _y = 0;
  private _id = -1;

  constructor(private readonly _slop = INTENT_SLOP_PX) {}

  /** True while a drag is under way (mouse at once, touch once decided). */
  get dragging(): boolean {
    return this._phase === "drag";
  }

  /** True while a touch has not yet shown which way it is going. */
  get pending(): boolean {
    return this._phase === "pending";
  }

  /** Returns true if the drag starts now (mouse, pen). */
  down(e: PointerEvent): boolean {
    this._id = e.pointerId;
    this._x = e.clientX;
    this._y = e.clientY;
    this._phase = e.pointerType === "touch" ? "pending" : "drag";
    return this._phase === "drag";
  }

  /**
   * "start" once, when a pending touch turns out to run along the slider;
   * "drag" for every move after that; "none" otherwise.
   */
  move(e: PointerEvent): "start" | "drag" | "none" {
    if (e.pointerId !== this._id) return "none";
    if (this._phase === "drag") return "drag";
    if (this._phase !== "pending") return "none";
    const dx = Math.abs(e.clientX - this._x);
    const dy = Math.abs(e.clientY - this._y);
    if (Math.max(dx, dy) < this._slop) return "none";
    this._phase = dx > dy ? "drag" : "scroll";
    return this._phase === "drag" ? "start" : "none";
  }

  /** "tap" for a touch that never moved, "drag" to end a drag, else "none". */
  up(e: PointerEvent): "tap" | "drag" | "none" {
    if (e.pointerId !== this._id) return "none";
    const phase = this._phase;
    this._phase = "idle";
    return phase === "pending" ? "tap" : phase === "drag" ? "drag" : "none";
  }

  /** The browser took the gesture (it scrolled). True if a drag was running. */
  cancel(e: PointerEvent): boolean {
    if (e.pointerId !== this._id) return false;
    const was = this._phase === "drag";
    this._phase = "idle";
    return was;
  }
}

export interface SliderHandlers {
  down: (e: PointerEvent) => void;
  move: (e: PointerEvent) => void;
  up: (e: PointerEvent) => void;
}

// One intent per slider element, so the wrapper also works for handlers a
// template recreates on every render.
const intents = new WeakMap<EventTarget, SliderIntent>();

function intentOf(e: PointerEvent): SliderIntent {
  const key = (e.currentTarget ?? e.target) as EventTarget;
  let intent = intents.get(key);
  if (!intent) {
    intent = new SliderIntent();
    intents.set(key, intent);
  }
  return intent;
}

/**
 * `setPointerCapture` that does not throw. A tap reaches a slider's `down`
 * handler only on release, when the browser may already consider the pointer
 * gone; the capture is pointless then, and must not abort the handler.
 */
export function capturePointer(el: Element | null | undefined, e: PointerEvent): void {
  try {
    el?.setPointerCapture(e.pointerId);
  } catch {
    /* pointer already released — nothing to capture */
  }
}

/**
 * Wraps a slider's existing pointer handlers so they run only for a real drag
 * or a tap. The wrapped `down` is called late for a touch — with the event
 * that decided it (the first move along the slider, or the release of a tap)
 * — so a handler must read the position from the event it is given and
 * capture through `capturePointer`. A cancelled drag ends through `up`, as it
 * did before; a cancelled pending touch (the page scrolled) reaches no
 * handler at all.
 */
export function sliderPointer(h: SliderHandlers): SliderHandlers & { cancel: (e: PointerEvent) => void } {
  return {
    down: (e) => {
      if (intentOf(e).down(e)) h.down(e);
    },
    move: (e) => {
      const m = intentOf(e).move(e);
      if (m === "start") h.down(e);
      if (m !== "none") h.move(e);
    },
    up: (e) => {
      const u = intentOf(e).up(e);
      if (u === "tap") h.down(e);
      if (u !== "none") h.up(e);
    },
    cancel: (e) => {
      if (intentOf(e).cancel(e)) h.up(e);
    },
  };
}
