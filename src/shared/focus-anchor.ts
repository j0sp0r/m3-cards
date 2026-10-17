// Where focus goes back to when a dialog closes.
//
// A dialog — Home Assistant's more-info or one of the suite's own <dialog>s —
// remembers what had focus when it opened and hands focus back there on close,
// and the browser scrolls that element into view as it does. That is right when
// the element is the thing that opened the dialog. On a phone it usually is not:
// a tap on a card's header does not move focus at all, so focus is still sitting
// wherever it was left — a slider tapped three minutes and two screens ago — and
// closing the dialog throws the dashboard back up to it.
//
// Reported as "closing the vacuum's details scrolls the overview up to 9a", and
// reproduced exactly: focus on 9a's brightness slider, open 13c's details, close
// them, and the page jumps 4,318px to put the slider back on screen.
//
// So focus is parked on the opening card first, without scrolling. The dialog
// then returns it there, which is where the user already is.
//
// WHY THE CARD IS NOT PRECISE ENOUGH
//
// Anchoring the *card* trades a big jump for a smaller one. A vacuum card is
// most of a phone screen, and its chip row sits under the map and two sliders;
// closing a dialog opened from a chip scrolled the card's top edge into view
// and moved the page by the card's own height — "wir befinden uns bei einer
// anderen Kachel". So the anchor aims at the element the finger actually hit,
// remembered from the pointer that preceded the dialog, and falls back to the
// card when there is nothing better.

/** The element that really has focus, through open shadow roots. */
export function deepActiveElement(root: Document | ShadowRoot = document): Element | null {
  let active = root.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

/**
 * Whether `node` sits inside `host`, across shadow boundaries — climbing to a
 * shadow root's host when a tree runs out of parents.
 */
export function isInside(host: Node, node: Node | null): boolean {
  let current: Node | null = node;
  while (current) {
    if (current === host) return true;
    current = current.parentNode ?? (current as ShadowRoot).host ?? null;
  }
  return false;
}

/**
 * Parks focus on `card` before it opens a dialog.
 *
 * Focus already inside the card is left exactly where it is: that is a keyboard
 * user who tabbed to a control and pressed Enter, and the dialog should hand
 * focus back to that control, not to the card around it.
 */
export function anchorFocus(card: HTMLElement): void {
  const active = deepActiveElement();
  if (active && active !== card.ownerDocument?.body && isInside(card, active)) return;
  // -1: focusable by script, never by Tab — the card does not join the tab order.
  // Only for an element that can't take focus on its own: a button that opens
  // a menu is anchored to itself, and -1 would take it out of the tab order.
  if (!card.hasAttribute("tabindex") && card.tabIndex < 0) card.setAttribute("tabindex", "-1");
  card.focus({ preventScroll: true });
}

/**
 * How long a remembered pointer stays eligible as an anchor.
 *
 * Long enough for a hold gesture and a card that opens its dialog after a
 * service call, short enough that an unrelated tap minutes ago is never
 * mistaken for the origin of this dialog.
 */
const POINTER_MEMORY_MS = 2000;

let lastPointer: { el: HTMLElement; at: number } | undefined;

/**
 * The best thing to park focus on for a dialog opened from `card`: whatever
 * the last pointer went down on inside it, or the card itself.
 *
 * Checked for `isConnected` because a card that re-rendered between the tap
 * and the dialog may have thrown the node away, and focusing a detached
 * element silently does nothing — leaving focus wherever it was, which is the
 * bug this whole module exists for.
 */
export function anchorTarget(card: HTMLElement): HTMLElement {
  const remembered = lastPointer;
  if (!remembered) return card;
  if (Date.now() - remembered.at > POINTER_MEMORY_MS) return card;
  if (!remembered.el.isConnected || !isInside(card, remembered.el)) return card;
  return remembered.el;
}

/** Records a pointer for `anchorTarget`. Exported for the tests. */
export function rememberPointer(el: HTMLElement | undefined, now = Date.now()): void {
  lastPointer = el ? { el, at: now } : undefined;
}

const INSTALLED = Symbol.for("m3-cards.focus-anchor");

/**
 * One listener for every more-info a card of this suite opens.
 *
 * Capture phase on the window, so it runs before Home Assistant opens the
 * dialog. It only acts on events coming out of an `m3-` card; Home Assistant's
 * own cards on the same dashboard are none of this bundle's business.
 */
export function installFocusAnchor(win: Window = window): void {
  const flagged = win as unknown as Record<symbol, boolean>;
  if (flagged[INSTALLED]) return;
  flagged[INSTALLED] = true;
  // The innermost element a pointer went down on, kept so a dialog can be
  // anchored to it rather than to the card around it.
  win.addEventListener(
    "pointerdown",
    (event) => {
      const el = event
        .composedPath()
        .find((n): n is HTMLElement => n instanceof HTMLElement);
      rememberPointer(el);
    },
    { capture: true, passive: true },
  );
  win.addEventListener(
    "hass-more-info",
    (event) => {
      const card = event
        .composedPath()
        .find((n): n is HTMLElement => n instanceof HTMLElement && n.tagName.startsWith("M3-"));
      if (card) anchorFocus(anchorTarget(card));
    },
    { capture: true },
  );
}
