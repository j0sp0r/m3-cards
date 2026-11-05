// Swiping along the nav bar moves to the neighbouring entry (m3-nav-card
// `swipe_navigation`).
//
// The finger only ever moves the bar: the active pill travels toward the
// entry it would land on, with a rubber band at either end. Once the swipe is
// committed the page slides — but not as one piece. The bar is
// `position: fixed` inside the view it would be sliding, and a transform on
// any ancestor makes it part of the page; a View Transition snapshot cannot
// leave it out either, since names in shadow trees are not captured on their
// own. So what moves is everything *beside* the bar: at every level from the
// nav card up to the view, its siblings — the other sections, in a sections
// view. The bar and the view's background never move.

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
 * Where a release lands. `dx` is the travel along the bar, negative toward
 * the next entry — the card turns the finger's travel into it, per
 * `swipe_direction`. `distance` is the gap to the neighbour on that side,
 * `velocity` the speed over the last few moves in px/ms, counted the same way.
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

/** Out: short and accelerating; in: longer and decelerating, as M3 pairs them. */
const OUT_MS = 180;
const IN_MS = 340;
const OUT_EASING = "cubic-bezier(0.3, 0, 0.8, 0.15)";
const IN_EASING = "cubic-bezier(0.05, 0.7, 0.1, 1)";
/** How long the new page's nav card may take to appear. */
const ARRIVE_CAP_MS = 800;

/**
 * Everything on the page beside `card`: at each level from it up to the view,
 * the visible siblings of the branch it is in. Stops below `hui-view`, so the
 * view's background stays where it is.
 */
export function contentBeside(card: Element): HTMLElement[] {
  const out: HTMLElement[] = [];
  let node: Element = card;
  for (let depth = 0; depth < 24; depth++) {
    const container = node.parentNode;
    if (!container || node.localName === "hui-view") break;
    for (const sibling of Array.from(container.children)) {
      if (sibling === node || !(sibling instanceof HTMLElement)) continue;
      if (sibling.localName === "style" || sibling.getClientRects().length === 0) continue;
      out.push(sibling);
    }
    node = container instanceof ShadowRoot ? container.host : (container as Element);
  }
  return out;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type UpdateCallback = () => Promise<unknown> | unknown;
type StartViewTransition = (arg?: UpdateCallback | { update?: UpdateCallback }) => unknown;

/**
 * Home Assistant cross-fades between views with a View Transition of its own,
 * which would lay a still picture of the new page over the slide. While ours
 * runs, a request for one just runs its update.
 */
function withoutViewTransitions(): () => void {
  const doc = document as unknown as { startViewTransition?: StartViewTransition };
  if (typeof doc.startViewTransition !== "function") return () => undefined;
  const hadOwn = Object.prototype.hasOwnProperty.call(document, "startViewTransition");
  const own = doc.startViewTransition;
  doc.startViewTransition = (arg) => {
    const update = typeof arg === "function" ? arg : arg?.update;
    const done = Promise.resolve()
      .then(() => update?.())
      .then(() => undefined);
    return { finished: done, ready: done, updateCallbackDone: done, skipTransition: () => undefined, types: new Set() };
  };
  return () => {
    if (hadOwn) doc.startViewTransition = own;
    else delete doc.startViewTransition;
  };
}

/**
 * Slide the page beside `from` out, navigate, and slide the page beside the
 * nav card that arrives in. `findArrived` returns that card once it is on
 * screen (it may be `from` itself, when the bar survives the navigation).
 */
export async function slideToPage(
  direction: SwipeDirection,
  from: Element,
  navigate: () => void,
  findArrived: () => Element | undefined,
): Promise<void> {
  const sign = direction === "next" ? -1 : 1;
  // A whole screen's width, and transform only. Fading would need opacity on
  // the sections, and an ancestor below full opacity cuts the frosted cards
  // inside it off from what is behind them: their blur drops out for as long
  // as the fade runs and snaps back when it ends. Moved the full width, the
  // content leaves and enters at the screen's edge, so nothing pops either.
  const shift = Math.max(window.innerWidth, 1);
  // Content a screen to the right widens the page, and a phone lets a page
  // that is wider than the screen be panned sideways. Clipping is not one of
  // the things that cut the frosted cards off from their backdrop.
  const root = document.documentElement;
  const overflowX = root.style.overflowX;
  root.style.overflowX = "clip";
  try {
    await slide(sign * shift, from, navigate, findArrived);
  } finally {
    root.style.overflowX = overflowX;
  }
}

async function slide(
  by: number,
  from: Element,
  navigate: () => void,
  findArrived: () => Element | undefined,
): Promise<void> {
  const leaving = contentBeside(from);
  const outs = leaving.map((el) =>
    el.animate(
      [{ transform: "none" }, { transform: `translateX(${by}px)` }],
      { duration: OUT_MS, easing: OUT_EASING, fill: "forwards" },
    ),
  );
  await Promise.all(outs.map((a) => a.finished.catch(() => undefined)));

  const restore = withoutViewTransitions();
  let arrived: Element | undefined;
  try {
    navigate();
    const started = performance.now();
    // The old view leaves the document; the new one, with its own bar, comes in.
    while (performance.now() - started < ARRIVE_CAP_MS) {
      await wait(16);
      const card = findArrived();
      if (card && (card !== from || !leaving.some((el) => el.isConnected))) {
        arrived = card;
        break;
      }
    }
  } finally {
    restore();
    // Home Assistant keeps the old view to show again later: it must come back
    // as it was, not slid away.
    for (const a of outs) a.cancel();
  }
  if (!arrived) return;
  // At once, in the same task that found it: a frame later the new page
  // would already have been painted in place.
  const ins = contentBeside(arrived).map((el) =>
    el.animate(
      [{ transform: `translateX(${-by}px)` }, { transform: "none" }],
      { duration: IN_MS, easing: IN_EASING, fill: "backwards" },
    ),
  );
  await Promise.all(ins.map((a) => a.finished.catch(() => undefined)));
}
