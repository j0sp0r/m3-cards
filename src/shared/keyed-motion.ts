import { STANDARD_EASING } from "./animation";

// A change of layout, animated by key: the elements that stay glide from
// where they were, the ones that leave fade out where they stood, the new
// ones grow in. Take a snapshot before the render (willUpdate) and play it
// after (updated). Keys come from `data-row-key` (list rows) or
// `data-motion-key` (anything else).
//
// Leaving elements are clones taken before the render: Lit reuses DOM nodes
// by position, so after the render the node that showed a row may already
// show another one.

const SELECTOR = "[data-row-key], [data-motion-key]";

interface Shot {
  rect: DOMRect;
  clone: HTMLElement;
  text: string;
}

export interface MotionSnapshot {
  box: DOMRect;
  shots: Map<string, Shot>;
}

export interface MotionTiming {
  moveMs: number;
  leaveMs: number;
  enterMs: number;
  enterDelayMs: number;
}

const keyOf = (el: HTMLElement): string | undefined => el.dataset.rowKey ?? el.dataset.motionKey;

export function snapshotKeyed(container: HTMLElement | null): MotionSnapshot | undefined {
  if (!container) return undefined;
  const shots = new Map<string, Shot>();
  for (const el of Array.from(container.querySelectorAll<HTMLElement>(SELECTOR))) {
    const key = keyOf(el);
    if (!key || shots.has(key)) continue;
    shots.set(key, { rect: el.getBoundingClientRect(), clone: el.cloneNode(true) as HTMLElement, text: el.textContent ?? "" });
  }
  return { box: container.getBoundingClientRect(), shots };
}

/**
 * Plays the change since `snap`. `container` must be positioned, so the
 * leaving clones can stand where their originals stood; elements marked
 * `data-motion-count` also roll their text when it changed.
 */
export function playKeyed(container: HTMLElement | null, snap: MotionSnapshot | undefined, t: MotionTiming): void {
  if (!container || !snap) return;
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const box = container.getBoundingClientRect();
  // Rects are in screen pixels, transforms in the card's own: they differ
  // when an ancestor is zoomed or scaled
  const scale = container.offsetWidth ? box.width / container.offsetWidth : 1;
  const seen = new Set<string>();

  for (const el of Array.from(container.querySelectorAll<HTMLElement>(SELECTOR))) {
    const key = keyOf(el);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const prev = snap.shots.get(key);
    if (!prev) {
      el.animate(
        [
          { opacity: 0, transform: "scale(0.9)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: t.enterMs, delay: t.enterDelayMs, easing: STANDARD_EASING, fill: "backwards" },
      );
      continue;
    }
    const now = el.getBoundingClientRect();
    // Relative to the container, so a card that moved as a whole stays put
    const dx = (prev.rect.left - snap.box.left - (now.left - box.left)) / scale;
    const dy = (prev.rect.top - snap.box.top - (now.top - box.top)) / scale;
    if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) {
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
        duration: t.moveMs,
        easing: STANDARD_EASING,
      });
    }
    if (el.dataset.motionCount !== undefined && prev.text !== (el.textContent ?? "")) {
      el.animate(
        [
          { opacity: 0, transform: "translateY(-40%)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: t.enterMs, easing: STANDARD_EASING },
      );
    }
  }

  for (const [key, prev] of snap.shots) {
    if (seen.has(key)) continue;
    const ghost = prev.clone;
    Object.assign(ghost.style, {
      position: "absolute",
      left: `${(prev.rect.left - snap.box.left) / scale}px`,
      top: `${(prev.rect.top - snap.box.top) / scale}px`,
      width: `${prev.rect.width / scale}px`,
      height: `${prev.rect.height / scale}px`,
      margin: "0",
      pointerEvents: "none",
      zIndex: "1",
    });
    ghost.removeAttribute("tabindex");
    ghost.setAttribute("aria-hidden", "true");
    container.appendChild(ghost);
    const a = ghost.animate(
      [
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: "scale(0.94)" },
      ],
      { duration: t.leaveMs, easing: STANDARD_EASING, fill: "forwards" },
    );
    a.onfinish = () => ghost.remove();
    a.oncancel = () => ghost.remove();
  }
}
