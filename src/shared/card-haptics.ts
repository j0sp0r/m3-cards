import { fireHaptic } from "./tap-hold";

// A short vibration when a card is used, for every card at once.
//
// Home Assistant's companion app vibrates on the `haptic` event, and its own
// toggles fire it; an M3 card did only on the nav and remote cards, which had
// it built in. Wiring it into each of forty cards' handlers would mean forty
// places to forget it, so the card listens to its own clicks instead and asks
// one question of the click: did it land on something that can be used?
//
// That question is answered from the element, not from a list of handlers: a
// button, a link, a form control, an ARIA role that says "press me", or the
// pointer cursor that every tappable surface in the suite sets. A tap on a
// card's empty glass does not vibrate, which is the difference between
// feedback and noise.
//
// The app decides whether to vibrate at all: Home Assistant's own "Vibrate"
// profile setting governs it, and in a desktop browser nothing listens.

const CONTROL_TAGS = new Set(["BUTTON", "A", "SELECT", "INPUT", "HA-SWITCH", "HA-SLIDER", "HA-CHECKBOX"]);
const CONTROL_ROLES = new Set([
  "button",
  "switch",
  "slider",
  "checkbox",
  "radio",
  "tab",
  "menuitem",
  "option",
  "spinbutton",
]);

/** Whether `el` is something a person uses, rather than reads. */
export function isControl(el: Element, cursor?: string): boolean {
  if (CONTROL_TAGS.has(el.tagName)) {
    return el.tagName !== "INPUT" || !/^(text|search|email|password|number|url|tel)$/.test((el as HTMLInputElement).type);
  }
  const role = el.getAttribute("role");
  if (role && CONTROL_ROLES.has(role)) return true;
  return cursor === "pointer" || cursor === "grab";
}

/**
 * Whether a click inside `host` landed on a control. Walks the composed path
 * from the target up to the card itself, so a tap on an icon inside a button
 * counts as a tap on the button.
 */
export function clickHitsControl(ev: Event, host: Element): boolean {
  for (const node of ev.composedPath()) {
    if (node === host) return false;
    if (!(node instanceof Element)) continue;
    if ((node as HTMLElement).hasAttribute?.("disabled") || node.getAttribute("aria-disabled") === "true") {
      return false;
    }
    if (isControl(node, getComputedStyle(node).cursor)) return true;
  }
  return false;
}

/**
 * Listens on `host` and fires a light haptic for every click on a control,
 * unless `enabled()` says no. Returns the function that stops listening.
 */
export function attachCardHaptics(host: HTMLElement, enabled: () => boolean): () => void {
  const onClick = (ev: Event): void => {
    if (!enabled() || !clickHitsControl(ev, host)) return;
    fireHaptic(host, "light");
  };
  // Capture, not bubble: the suite's handlers stop propagation all the time —
  // a fold arrow inside a tappable header has to, or the tap would also run the
  // header's action — and a bubbling listener on the card never heard those
  // clicks. Capture on the host runs before any of them.
  host.addEventListener("click", onClick, { capture: true });
  return () => host.removeEventListener("click", onClick, { capture: true });
}
