import {
  NAV_DRAG_THRESHOLD_PX,
  NAV_DRAG_THROTTLE_MS,
  NAV_FLING_VELOCITY_PX_MS,
  NAV_VELOCITY_SAMPLES,
  NAV_VELOCITY_WINDOW_MS,
} from "../const";
import { DragThrottle } from "./drag-throttle";
import { stopSwipe } from "./swipe";

// Dragging a bottom sheet: the finger moves it, the release decides where it
// lands.
//
// The rest of this suite drags in one dimension already (the light card's
// sliders), but only ever "the value follows the finger" — release position is
// the answer, and nothing measures how fast the finger was going. A sheet needs
// more than that. Released halfway with a flick, it should finish opening;
// released halfway after being carefully positioned, it should go to the
// nearest stop. Those are different answers to the same position, and velocity
// is what tells them apart.
//
// The genuinely awkward part is not the maths, it is deciding whether a drag
// inside the sheet belongs to the sheet or to the content scrolling inside it.
// The rule every native bottom sheet uses, and the one implemented here: the
// content scrolls, unless it is already at the top and the finger is going
// down — only then does the sheet take over. Anything else and this module
// keeps its hands off, so the browser's own scrolling (including its momentum,
// which no JS reimplementation matches) is untouched.

export interface SheetGeometry {
  /** Pixels the panel travels between fully collapsed and fully open. */
  travel: number;
  /** Stops, as fractions of `travel`. Always includes 0 and 1. */
  snapPoints: number[];
}

export interface SheetGestureOptions {
  geometry: () => SheetGeometry;
  /** The panel's fraction right now, read when a drag starts. */
  current: () => number;
  /** Live position while a finger is down. */
  onDrag: (fraction: number) => void;
  /** The stop the sheet should animate to after a release. */
  onSettle: (fraction: number) => void;
  /** A press that never became a drag. */
  onTap?: () => void;
  /**
   * Asked at the moment a finger goes down, not when the handlers are wired.
   *
   * The host used to decide at attach time whether dragging made sense, which
   * meant a state it reads from its surroundings — dashboard edit mode — had to
   * be noticed changing, and it was not: the drawer stayed dead until the page
   * was reloaded. Asking here removes the transition from the problem
   * entirely.
   */
  enabled?: () => boolean;
  reducedMotion: () => boolean;
}

interface Sample {
  t: number;
  y: number;
}

type Mode = "idle" | "pending" | "dragging" | "scrolling";

/**
 * Whether a touch moving by (dx, dy) from where it went down belongs to the
 * sheet rather than to the browser's scrolling: downward, more down than
 * sideways, with nothing under the finger scrolled away from its top. A
 * sideways swipe stays the content's (a carousel, a chip row), and so does
 * a downward one in a list that can still scroll up.
 */
export function contentTouchIsSheetDrag(dx: number, dy: number, scrolledAbove: boolean): boolean {
  return !scrolledAbove && dy > 0 && dy >= Math.abs(dx);
}

/**
 * Whether anything between the touched element and the sheet's content
 * element — the content element included — is scrolled down from its top.
 * The path crosses shadow roots: a popup's cards keep their lists inside
 * their own.
 */
function scrolledAboveTouch(path: EventTarget[], el: HTMLElement): boolean {
  for (const node of path) {
    if (node instanceof HTMLElement && node.scrollTop > 0) return true;
    if (node === el) break;
  }
  return false;
}

export class SheetGesture {
  private mode: Mode = "idle";
  private startY = 0;
  private startFraction = 0;
  private samples: Sample[] = [];
  private pointerId?: number;
  private element?: HTMLElement;
  /** Set while a content-area drag has borrowed the element's touch-action. */
  private touchActionPatched = false;
  /** Where the current touch on the content went down, for the touch claim. */
  private touchStart?: { x: number; y: number; scrolledAbove: boolean };
  /** What the current touch on the content was decided to be, once decided. */
  private touchClaim?: "sheet" | "content";
  private readonly throttle: DragThrottle<number>;

  constructor(private readonly opts: SheetGestureOptions) {
    this.throttle = new DragThrottle<number>(
      (fraction) => this.opts.onDrag(fraction),
      NAV_DRAG_THROTTLE_MS,
    );
  }

  /**
   * The grip. Every press here is a drag from the first pixel, and a press that
   * never moves is a tap that toggles.
   */
  attachHandle(el: HTMLElement): () => void {
    return this.attach(el, "handle");
  }

  /**
   * The bar under the sheet. A press here is a tap on a navigation entry until
   * the finger travels upwards far enough to mean otherwise, so the drag only
   * arms after the threshold — the entry's own tap handler decides what happens
   * below it.
   */
  attachBar(el: HTMLElement): () => void {
    return this.attach(el, "bar");
  }

  /** The scrollable content. See the note above about who wins a drag. */
  attachContent(el: HTMLElement): () => void {
    return this.attach(el, "content");
  }

  private attach(el: HTMLElement, kind: "handle" | "bar" | "content"): () => void {
    const down = (e: PointerEvent) => this.onDown(e, el, kind);
    const move = (e: PointerEvent) => this.onMove(e, el, kind);
    const up = (e: PointerEvent) => this.onUp(e, el);

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    // Swipe-navigation plugins listen on an ancestor in the bubble phase; a
    // drag on a sheet is never a request to change the view.
    el.addEventListener("touchstart", stopSwipe);
    el.addEventListener("touchmove", stopSwipe);

    // On a touch screen the browser decides on the first move whether the
    // finger scrolls, and once it does the pointer events stop with a
    // pointercancel: switching touch-action off in onMove comes too late, and
    // a downward swipe on a popup's header or content did nothing — only the
    // grip, which is touch-action: none from the start, answered (#50).
    // Cancelling that first touchmove is what keeps the browser out, so the
    // claim is made here, in a listener that may cancel.
    const touchStart = (e: TouchEvent) => this.onTouchStart(e, el);
    const touchMove = (e: TouchEvent) => this.onTouchMove(e);
    if (kind === "content") {
      el.addEventListener("touchstart", touchStart, { passive: true });
      el.addEventListener("touchmove", touchMove, { passive: false });
    }

    return () => {
      el.removeEventListener("touchstart", touchStart);
      el.removeEventListener("touchmove", touchMove);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("touchstart", stopSwipe);
      el.removeEventListener("touchmove", stopSwipe);
    };
  }

  private onTouchStart(e: TouchEvent, el: HTMLElement): void {
    const t = e.touches[0];
    this.touchClaim = undefined;
    if (!t || e.touches.length > 1 || (this.opts.enabled && !this.opts.enabled())) {
      this.touchStart = undefined;
      return;
    }
    this.touchStart = { x: t.clientX, y: t.clientY, scrolledAbove: scrolledAboveTouch(e.composedPath(), el) };
  }

  private onTouchMove(e: TouchEvent): void {
    const start = this.touchStart;
    const t = e.touches[0];
    if (!start || !t) return;
    if (this.touchClaim === undefined) {
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      // Too small to tell a direction yet; the browser does not commit on
      // a jitter either.
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
      this.touchClaim = contentTouchIsSheetDrag(dx, dy, start.scrolledAbove) ? "sheet" : "content";
    }
    if (this.touchClaim === "sheet" && e.cancelable) e.preventDefault();
  }

  private onDown(e: PointerEvent, el: HTMLElement, kind: "handle" | "bar" | "content"): void {
    if (e.button !== undefined && e.button !== 0) return;
    if (this.opts.enabled && !this.opts.enabled()) return;
    this.startY = e.clientY;
    this.startFraction = this.opts.current();
    this.samples = [{ t: performance.now(), y: e.clientY }];
    this.pointerId = e.pointerId;
    this.element = el;

    if (kind === "handle") {
      this.mode = "dragging";
      el.setPointerCapture(e.pointerId);
      return;
    }
    // Bar and content both wait to see where the finger goes.
    this.mode = "pending";
  }

  private onMove(e: PointerEvent, el: HTMLElement, kind: "handle" | "bar" | "content"): void {
    if (this.mode === "idle" || this.mode === "scrolling") return;
    if (this.pointerId !== undefined && e.pointerId !== this.pointerId) return;

    const dy = e.clientY - this.startY;

    if (this.mode === "pending") {
      if (Math.abs(dy) < NAV_DRAG_THRESHOLD_PX) return;
      if (kind === "bar") {
        // Only upward: a downward drag on the bar is a page scroll starting
        // under someone's thumb, not a request to open a sheet that is shut.
        if (dy > 0) {
          this.mode = "scrolling";
          return;
        }
      } else {
        const atTop = el.scrollTop <= 0;
        if (!atTop || dy < 0) {
          // The content has somewhere to scroll, so it scrolls. This gesture is
          // not ours and we do not touch it again until the next pointerdown.
          this.mode = "scrolling";
          return;
        }
        // Taking over a gesture the browser was about to scroll with: its own
        // panning has to be switched off for the duration, and only for the
        // duration, or the content would never scroll again.
        el.style.touchAction = "none";
        this.touchActionPatched = true;
      }
      this.mode = "dragging";
      el.setPointerCapture(e.pointerId);
      // Measure from where the drag actually began, not from the press, so the
      // sheet does not jump by the threshold distance on the first frame.
      this.startY = e.clientY;
      this.samples = [{ t: performance.now(), y: e.clientY }];
      return;
    }

    this.pushSample(e.clientY);
    const { travel } = this.opts.geometry();
    if (travel <= 0) return;
    // Up is negative in screen coordinates and open is up, hence the minus.
    const fraction = clamp(this.startFraction - (e.clientY - this.startY) / travel, 0, 1);
    this.throttle.call(fraction);
  }

  private onUp(e: PointerEvent, el: HTMLElement): void {
    const wasDragging = this.mode === "dragging";
    const totalMovement = Math.abs(e.clientY - this.startY);
    this.release(el, e.pointerId);

    if (!wasDragging) {
      this.mode = "idle";
      return;
    }
    this.mode = "idle";

    const { travel, snapPoints } = this.opts.geometry();
    const fraction =
      travel > 0
        ? clamp(this.startFraction - (e.clientY - this.startY) / travel, 0, 1)
        : this.startFraction;

    // A press on the grip that never travelled is a tap, and toggling is what a
    // tap on a grip means everywhere else.
    if (totalMovement < NAV_DRAG_THRESHOLD_PX && this.opts.onTap) {
      this.throttle.clear();
      this.opts.onTap();
      return;
    }

    this.throttle.flush(fraction);
    this.opts.onSettle(this.resolveTarget(fraction, snapPoints));
  }

  private release(el: HTMLElement, pointerId: number): void {
    if (el.hasPointerCapture?.(pointerId)) el.releasePointerCapture(pointerId);
    if (this.touchActionPatched) {
      el.style.removeProperty("touch-action");
      this.touchActionPatched = false;
    }
    this.pointerId = undefined;
    this.element = undefined;
  }

  /**
   * Where a release lands.
   *
   * A fast release is an instruction: it goes to the next stop in the direction
   * it was thrown, whatever fraction the sheet happens to be sitting at. A slow
   * one is a placement, and goes to whichever stop is closest. Reduced motion
   * changes how it gets there, not where — that is the card's business.
   */
  private resolveTarget(fraction: number, snapPoints: number[]): number {
    const stops = [...snapPoints].sort((a, b) => a - b);
    if (!stops.length) return fraction > 0.5 ? 1 : 0;

    const velocity = this.velocity();
    if (Math.abs(velocity) > NAV_FLING_VELOCITY_PX_MS) {
      // Negative velocity is upward, which is opening.
      const opening = velocity < 0;
      const next = opening
        ? stops.find((s) => s > fraction + 0.001)
        : [...stops].reverse().find((s) => s < fraction - 0.001);
      if (next !== undefined) return next;
      return opening ? stops[stops.length - 1] : stops[0];
    }

    let best = stops[0];
    let bestDistance = Math.abs(fraction - best);
    for (const stop of stops) {
      const distance = Math.abs(fraction - stop);
      if (distance < bestDistance) {
        best = stop;
        bestDistance = distance;
      }
    }
    return best;
  }

  private pushSample(y: number): void {
    const now = performance.now();
    this.samples.push({ t: now, y });
    // Only the tail matters: a drag that paused and then flicked should be read
    // as a flick, not averaged against the pause.
    while (
      this.samples.length > NAV_VELOCITY_SAMPLES ||
      (this.samples.length > 2 && now - this.samples[0].t > NAV_VELOCITY_WINDOW_MS)
    ) {
      this.samples.shift();
    }
  }

  /** px/ms, negative upwards. */
  private velocity(): number {
    if (this.samples.length < 2) return 0;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const dt = last.t - first.t;
    if (dt <= 0) return 0;
    return (last.y - first.y) / dt;
  }

  /** Drops anything in flight. Call from the card's disconnectedCallback. */
  destroy(): void {
    this.throttle.clear();
    if (this.element && this.pointerId !== undefined) {
      this.release(this.element, this.pointerId);
    }
    this.mode = "idle";
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
