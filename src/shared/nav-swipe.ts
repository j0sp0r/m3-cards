// Swiping along the nav bar moves to the neighbouring entry (m3-nav-card
// `swipe_navigation`).
//
// The finger only ever moves the bar: the active pill follows it toward the
// entry it would land on, with a rubber band at either end. The page itself
// does not follow — the nav card sits inside the view it would be dragging,
// and a transform on an ancestor of a `position: fixed` bar turns the bar into
// part of the page. The page moves once the swipe is committed, through the
// View Transitions API: the old view slides out, the new one in, and the bar,
// captured under its own name, stays where it is. A browser without the API
// simply navigates.

export type SwipeDirection = "next" | "prev";

/** Share of the way to the neighbouring entry a release must have travelled. */
export const SWIPE_COMMIT_SHARE = 0.4;
/** A flick commits from this far, if it is fast enough. */
export const SWIPE_FLICK_MIN_PX = 24;
/** px/ms — a flick. */
export const SWIPE_FLICK_VELOCITY = 0.45;
/** How much of the finger's travel the bar shows past the first or last entry. */
export const SWIPE_RUBBER_BAND = 0.25;

/**
 * Where a release lands. `dx` is the finger's travel (negative: leftwards,
 * which brings the next entry in), `distance` the gap to the neighbour on that
 * side, `velocity` the speed over the last few moves in px/ms.
 */
export function swipeOutcome(p: {
  dx: number;
  velocity: number;
  distance: number;
  hasPrev: boolean;
  hasNext: boolean;
}): SwipeDirection | undefined {
  const direction: SwipeDirection = p.dx < 0 ? "next" : "prev";
  if (direction === "next" ? !p.hasNext : !p.hasPrev) return undefined;
  const travel = Math.abs(p.dx);
  if (p.distance > 0 && travel >= p.distance * SWIPE_COMMIT_SHARE) return direction;
  // A flick counts only when it goes the way it travelled.
  const flick = Math.abs(p.velocity) >= SWIPE_FLICK_VELOCITY && Math.sign(p.velocity) === Math.sign(p.dx);
  return travel >= SWIPE_FLICK_MIN_PX && flick ? direction : undefined;
}

/**
 * How far the bar's pill shows the drag: the finger's travel toward an entry
 * that exists, capped at that entry, and a damped share of it past either end.
 */
export function swipeShown(p: { dx: number; distance: number; hasPrev: boolean; hasNext: boolean }): number {
  const toward = p.dx < 0 ? p.hasNext : p.hasPrev;
  if (!toward || p.distance <= 0) return p.dx * SWIPE_RUBBER_BAND;
  return Math.sign(p.dx) * Math.min(Math.abs(p.dx), p.distance);
}

const STYLE_ID = "m3-nav-swipe-transition";

/** The slide itself. Document-level, since the pseudo-elements live there. */
const TRANSITION_CSS = `
@keyframes m3-nav-out-left { to { transform: translateX(-14%); opacity: 0; } }
@keyframes m3-nav-out-right { to { transform: translateX(14%); opacity: 0; } }
@keyframes m3-nav-in-right { from { transform: translateX(14%); opacity: 0; } }
@keyframes m3-nav-in-left { from { transform: translateX(-14%); opacity: 0; } }
html[data-m3-nav-swipe]::view-transition-old(root) {
  animation: 200ms cubic-bezier(0.3, 0, 0.8, 0.15) both m3-nav-out-left;
}
html[data-m3-nav-swipe]::view-transition-new(root) {
  animation: 340ms cubic-bezier(0.05, 0.7, 0.1, 1) 60ms both m3-nav-in-right;
}
html[data-m3-nav-swipe="prev"]::view-transition-old(root) {
  animation-name: m3-nav-out-right;
}
html[data-m3-nav-swipe="prev"]::view-transition-new(root) {
  animation-name: m3-nav-in-left;
}
html[data-m3-nav-swipe]::view-transition-group(m3-nav-bar) {
  animation-duration: 0s;
}
html[data-m3-nav-swipe]::view-transition-old(m3-nav-bar) {
  display: none;
}
html[data-m3-nav-swipe]::view-transition-new(m3-nav-bar) {
  animation: none;
}
`;

function ensureTransitionStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = TRANSITION_CSS;
  document.head.appendChild(style);
}

type StartViewTransition = (cb: () => Promise<void> | void) => {
  finished: Promise<void>;
};

/** Whether this browser can slide the page at all. */
export function canSlidePages(): boolean {
  return typeof (document as unknown as { startViewTransition?: unknown }).startViewTransition === "function";
}

/** Two frames: long enough for Home Assistant to have put the new view in. */
export function settleFrames(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/**
 * Run `navigate` inside a view transition that slides in `direction`. The
 * callbacks name the bar: `nameBars(true)` is called before the old page is
 * captured and again after navigating, so the new page's bar carries the name
 * too; `nameBars(false)` once it is over. Without the API, it just navigates.
 */
export async function slideToPage(
  direction: SwipeDirection,
  navigate: () => void,
  nameBars: (on: boolean) => void,
): Promise<void> {
  const start = (document as unknown as { startViewTransition?: StartViewTransition }).startViewTransition;
  if (typeof start !== "function") {
    navigate();
    return;
  }
  ensureTransitionStyle();
  const root = document.documentElement;
  root.dataset.m3NavSwipe = direction;
  nameBars(true);
  try {
    const transition = start.call(document, async () => {
      navigate();
      await settleFrames();
      nameBars(true);
    });
    await transition.finished;
  } catch {
    // A transition that could not run still ran its callback — the page has
    // changed either way, which is what matters.
  } finally {
    delete root.dataset.m3NavSwipe;
    nameBars(false);
  }
}
