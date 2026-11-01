import type { HomeAssistant } from "../types";

// Whether a collapsible thing is folded away, and where that answer is kept.
//
// Two cards need this — the heading card folds the cards below it, the room
// card folds its own body — and they need it to behave identically, so the
// rule lives here rather than in two copies that drift.
//
// An `input_boolean` is the better home when one is configured: the state then
// survives a different browser, syncs between phone and tablet, and an
// automation can fold a section away. Without one the browser remembers it,
// which is per-device and good enough for a display preference.
//
// How long the browser remembers is a real choice, not a detail. Kept on the
// device, a section left open stays open for good — which is what someone who
// arranged the dashboard once wants, and a nuisance for someone who wants the
// overview back every time they come to it. Kept for the session, the fold
// follows you around the dashboard and is gone when the app is next started.

/** Where a fold is remembered when no helper entity holds it. */
export type CollapseMemory = "device" | "session";

export interface CollapseTarget {
  /** An `input_boolean` holding the state, or nothing for browser storage. */
  entity?: string;
  /** Identifies this collapsible in browser storage. */
  storageKey: string;
  defaultCollapsed?: boolean;
  /** Defaults to `device`, which is what every card did before the choice. */
  memory?: CollapseMemory;
}

/**
 * Reading `sessionStorage` can throw outright rather than return null — a
 * browser set to block site data does that — so even choosing the store is
 * guarded.
 */
function storeFor(memory: CollapseMemory | undefined): Storage | null {
  try {
    return memory === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

export function readCollapsed(
  hass: HomeAssistant | undefined,
  target: CollapseTarget,
): boolean {
  if (target.entity) {
    const state = hass?.states[target.entity]?.state;
    if (state === "on") return true;
    if (state === "off") return false;
    // An unavailable helper falls back to the configured default rather than
    // silently reading as "expanded".
    return target.defaultCollapsed ?? false;
  }
  try {
    const stored = storeFor(target.memory)?.getItem(target.storageKey);
    if (stored != null) return stored === "1";
  } catch {
    // Private mode, or storage disabled. The default is still correct.
  }
  return target.defaultCollapsed ?? false;
}

export function writeCollapsed(
  hass: HomeAssistant | undefined,
  target: CollapseTarget,
  value: boolean,
): void {
  if (target.entity) {
    hass?.callService("input_boolean", value ? "turn_on" : "turn_off", {
      entity_id: target.entity,
    });
    return;
  }
  try {
    storeFor(target.memory)?.setItem(target.storageKey, value ? "1" : "0");
  } catch {
    // Not being able to remember is survivable; not being able to fold would
    // not be.
  }
}

/**
 * Whether the fold takes one block with it.
 *
 * The vacuum, maintenance and printer cards all fold the same way — the header
 * and the primary controls stay, and of everything below them the fold hides
 * what `collapse_blocks` names, or all of it when the key is absent. Three
 * inline copies of that rule is how one of them ends up treating an empty list
 * as "fold nothing".
 *
 * `pinned` is the escape hatch for a block the fold must never take no matter
 * what the config says: the printer's socket while the printer is offline,
 * since it is the one control that can bring the machine back.
 */
export function foldHides<B extends string>(
  block: B,
  folded: boolean,
  collapseBlocks: readonly B[] | undefined,
  pinned: readonly B[] = [],
): boolean {
  if (!folded || pinned.includes(block)) return false;
  return !collapseBlocks || collapseBlocks.includes(block);
}

/**
 * The editors ask the question the other way round from the config. The
 * config lists what the fold takes (`collapse_blocks`, absent meaning all);
 * the editor lists what *stays* when folded. Ticking "Progress" to keep it in
 * view used to do the opposite — fold only the progress — and an empty list
 * meant "fold everything", which no one reads off an empty list.
 */
export function keptWhenFolded<B extends string>(all: readonly B[], collapseBlocks: readonly B[] | undefined): B[] {
  return collapseBlocks ? all.filter((b) => !collapseBlocks.includes(b)) : [];
}

/** The inverse: the config's `collapse_blocks` for a set of blocks to keep. */
export function collapseBlocksFor<B extends string>(all: readonly B[], kept: readonly B[]): B[] | undefined {
  return kept.length ? all.filter((b) => !kept.includes(b)) : undefined;
}
