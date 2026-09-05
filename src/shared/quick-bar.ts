import type { HomeAssistant } from "../types";

// Opening Home Assistant's own quick bar (its entity/command search dialog)
// and its Assist dialog from a card.
//
// WHY THIS IS NOT A `show-dialog` EVENT
//
// Every other dialog this suite opens goes the obvious way: dispatch
// `show-dialog` with a `dialogTag` and let the frontend show it. That does not
// work for the quick bar. `ha-quick-bar` is code-split out of the frontend's
// main bundle, and the only thing that pulls it in is the frontend's own
// caller, which hands the dialog manager an import callback alongside the tag:
//
//   fireEvent(element, "show-dialog", {
//     dialogTag: "ha-quick-bar",
//     dialogImport: () => import("./ha-quick-bar"),
//     dialogParams,
//   });                    // frontend: dialogs/quick-bar/show-dialog-quick-bar.ts
//
// A card cannot supply that callback: the specifier is a path inside the
// frontend bundle, which a Lovelace resource loaded as its own module has no
// way to name. Firing the event without it makes the dialog manager
// `createElement("ha-quick-bar")` on a tag that was never defined, so it gets a
// plain HTMLElement with no `showDialog` on it and throws
// "Unknown dialog type loaded" (frontend: dialogs/make-dialog-manager.ts).
//
// So the card asks for the dialog the way a keyboard does — it replays the
// shortcut, and the frontend's own handler does the lazy import and opens what
// it built. The card then depends on the shortcut rather than on the dialog's
// tag and module path: a user-visible, documented contract, listed in Home
// Assistant's own Shift+? shortcut dialog, instead of an internal one.
//
// WHAT THE HANDLER ACTUALLY CHECKS
//
// Verified against home-assistant/frontend `dev` (2026-09), where the old
// hand-rolled keydown listener has been replaced by tinykeys:
// `src/state/quick-bar-mixin.ts` registers the bindings, and
// `src/common/keyboard/shortcuts.ts` wraps them. What that means for a
// synthetic event:
//
//   * The listener is on `window`, keydown, bubble phase, and `isTrusted` is
//     never consulted — a dispatched KeyboardEvent is accepted.
//   * tinykeys drops anything that is not `event.key && event.code &&
//     event.getModifierState`, so BOTH `key` and `code` have to be set. This is
//     the detail that silently breaks a hand-written attempt: an event built
//     with `{ key: "e" }` alone never matches. `keyCode`/`which` are set here
//     too — the current frontend does not read them, older ones did, and they
//     cost nothing.
//   * `repeat`, `isComposing` and any modifier flag disqualify the press.
//   * A non-empty `window.getSelection()` blocks every binding except Ctrl/⌘+K,
//     which is why the selection is collapsed before dispatching.
//
// WHAT CAN LEGITIMATELY TAKE THE SHORTCUTS AWAY
//
// Three things, all checked rather than assumed, because a control that
// silently does nothing is worse than one that is not drawn:
//
//   * "Keyboard shortcuts" is a per-user profile switch, and every handler
//     returns immediately when `hass.enableShortcuts` is off.
//   * The command palette (`c`) is registered only for admins, so on a
//     non-admin account that key reaches nothing at all.
//   * Assist needs the `conversation` integration loaded. It is part of
//     `default_config`, so it is there on a normal install, but a hand-written
//     configuration.yaml can leave it out.

/** Which of the quick bar's two modes a tap should open. */
export type QuickBarMode = "entity" | "command";

/** Everything needed to reconstruct a key press the frontend will recognise. */
export interface ShortcutKey {
  key: string;
  code: string;
  keyCode: number;
}

// The frontend registers each of these twice — once by `key` for latin
// keyboards and once by `code` for the rest — so setting both is not belt and
// braces, it is how either registration can match.
export const QUICK_BAR_SHORTCUTS: Record<QuickBarMode, ShortcutKey> = {
  entity: { key: "e", code: "KeyE", keyCode: 69 },
  command: { key: "c", code: "KeyC", keyCode: 67 },
};

export const ASSIST_SHORTCUT: ShortcutKey = { key: "a", code: "KeyA", keyCode: 65 };

/** Whether this account can reach a given mode's shortcut at all. */
export function quickBarModeAvailable(
  hass: HomeAssistant | undefined,
  mode: QuickBarMode | undefined,
): boolean {
  if (!shortcutsAvailable(hass)) return false;
  if (mode !== "command") return true;
  // Not a permission we are inventing: the frontend registers `c` and `d`
  // inside `if (this.hass?.user?.is_admin)`, and its own dialog strips a
  // `command` mode back to the unscoped search for a non-admin.
  return hass?.user?.is_admin !== false;
}

/**
 * The key to send for a mode, degrading rather than doing nothing.
 *
 * A non-admin asking for the command palette gets the entity search instead. It
 * is not what the config said, but `c` reaches no handler on that account, so
 * the alternative is a search bar that does not search — and the two dialogs
 * are close enough that landing in the wrong one is self-explanatory, while
 * landing nowhere is not.
 */
export function quickBarShortcut(
  hass: HomeAssistant | undefined,
  mode: QuickBarMode | undefined,
): ShortcutKey {
  const wanted = QUICK_BAR_SHORTCUTS[mode as QuickBarMode] ?? QUICK_BAR_SHORTCUTS.entity;
  if (wanted === QUICK_BAR_SHORTCUTS.command && !quickBarModeAvailable(hass, "command")) {
    return QUICK_BAR_SHORTCUTS.entity;
  }
  return wanted;
}

/**
 * The KeyboardEvent init for one shortcut.
 *
 * Pure, and deliberately separate from the dispatch below: this project's test
 * suite has no DOM, so a helper that constructed the event could not be tested
 * at all, while the shape it would have built can be asserted here.
 *
 * `composed` is set because the card lives in a shadow root — an event that
 * does not cross the boundary never reaches a `window` listener — and every
 * modifier is left off because tinykeys refuses a press carrying one.
 */
export function shortcutEventInit(
  shortcut: ShortcutKey,
): KeyboardEventInit & { keyCode: number; which: number } {
  return {
    key: shortcut.key,
    code: shortcut.code,
    keyCode: shortcut.keyCode,
    which: shortcut.keyCode,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
}

/** Replays one shortcut for Home Assistant's global handler to pick up. */
export function replayShortcut(shortcut: ShortcutKey): void {
  // Every binding but Ctrl/⌘+K is skipped while anything on the page is
  // selected. A tap normally collapses the selection on its own, but a tap that
  // followed a drag over some text does not, and the bar would then appear to
  // be dead for no reason the user can see.
  const selection = window.getSelection?.();
  if (selection?.toString()) selection.removeAllRanges();
  window.dispatchEvent(new KeyboardEvent("keydown", shortcutEventInit(shortcut)));
}

/**
 * Whether replaying a shortcut can do anything at all.
 *
 * Only an explicit `false` counts as off: an older frontend does not expose the
 * flag, and reading "not stated" as "disabled" would hide the card's whole
 * point on an install where the shortcut works perfectly well.
 */
export function shortcutsAvailable(hass: HomeAssistant | undefined): boolean {
  return hass?.enableShortcuts !== false;
}

/** Whether Assist exists to be opened, on top of the shortcut being live. */
export function assistAvailable(hass: HomeAssistant | undefined): boolean {
  if (!shortcutsAvailable(hass)) return false;
  const components = hass?.config?.components;
  // Same rule again — a frontend that hands over no component list is not
  // evidence that Assist is missing.
  return !components || components.includes("conversation");
}

export function openQuickBar(hass: HomeAssistant | undefined, mode: QuickBarMode | undefined): void {
  replayShortcut(quickBarShortcut(hass, mode));
}

export function openAssist(): void {
  replayShortcut(ASSIST_SHORTCUT);
}
