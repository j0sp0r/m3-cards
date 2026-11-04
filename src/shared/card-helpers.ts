import type { HomeAssistant } from "../types";

// Rendering other people's Lovelace cards inside one of ours.
//
// Home Assistant builds a card from a config through `loadCardHelpers()`, an
// async global it exposes to custom cards for exactly this. The nav card's
// sheet is the first place in this suite that needs it; it lives here rather
// than in that card because "host a list of arbitrary cards" is the kind of
// thing a second card eventually wants too, and copying the lifecycle rules
// below is how they drift.
//
// Two rules matter and both are easy to get wrong:
//
//   1. Build once, not per render. `createCardElement` is not cheap, and a
//      rebuilt card loses whatever state it was holding — a media card's
//      scrubber, an expanded section, a half-typed field. So the elements are
//      created when the *config* changes, never in the render path.
//   2. `hass` is pushed, not passed. Every Lovelace card takes its data from a
//      `hass` property set on it from outside; a nested card that never gets a
//      fresh one renders the state it was born with, forever.

// The one declaration of this global in the suite. `createCardElement` returns
// the element synchronously — only `loadCardHelpers()` itself is async — so a
// caller that awaits the result still works, but the type says what HA does.
export interface CardHelpers {
  createCardElement: (config: Record<string, unknown>) => HTMLElement;
}

declare global {
  interface Window {
    loadCardHelpers?: () => Promise<CardHelpers>;
  }
}

/**
 * Builds one element per config.
 *
 * A config Home Assistant cannot build comes back as its own error card rather
 * than throwing, which is what every other Lovelace container shows for a bad
 * card, so it is passed straight through instead of being caught and restyled.
 */
export async function createCards(
  configs: Record<string, unknown>[],
  hass: HomeAssistant | undefined,
): Promise<HTMLElement[]> {
  const loader = window.loadCardHelpers;
  if (!loader || !configs.length) return [];
  let helpers: CardHelpers;
  try {
    helpers = await loader();
  } catch {
    // The helpers are part of the frontend bundle a Lovelace card is loaded
    // by, so this should not happen — but an empty sheet beats a card that
    // throws during its own update.
    return [];
  }

  const out: HTMLElement[] = [];
  for (const config of configs) {
    const el = helpers.createCardElement(config);
    (el as HTMLElement & { hass?: HomeAssistant }).hass = hass;
    out.push(el);
  }
  return out;
}

/**
 * Makes sure one of HA's own lazy-loaded cards is defined, so a caller can
 * create it with `document.createElement(tag)`.
 *
 * HA registers most of its built-in cards (`hui-map-card` among them) only the
 * first time a dashboard asks for one. A card that embeds one and merely checks
 * `customElements.get(tag)` therefore works only on a page where some native
 * card of that type happened to load first. Asking the card helpers to build
 * one — the element is thrown away — makes HA import the module; the promise
 * resolves once the tag is defined.
 *
 * `config` must be one HA accepts for that type, or HA may not import it.
 * Resolves `false` (with a console warning) if the helpers are missing or the
 * tag is still undefined after `timeoutMs`.
 */
export async function ensureHaCardDefined(
  tag: string,
  config: Record<string, unknown>,
  timeoutMs = 10_000,
): Promise<boolean> {
  if (customElements.get(tag)) return true;
  const loader = window.loadCardHelpers;
  if (!loader) {
    console.warn(`m3-cards: cannot load ${tag} — window.loadCardHelpers is missing`);
    return false;
  }
  try {
    const helpers = await loader();
    helpers.createCardElement(config);
  } catch (e) {
    console.warn(`m3-cards: loading ${tag} failed`, e);
    return false;
  }
  let timer: number | undefined;
  const defined = await Promise.race([
    customElements.whenDefined(tag).then(() => true),
    new Promise<boolean>((resolve) => {
      timer = window.setTimeout(() => resolve(false), timeoutMs);
    }),
  ]);
  window.clearTimeout(timer);
  if (!defined) console.warn(`m3-cards: ${tag} was not defined after ${timeoutMs} ms`);
  return defined;
}

/** Pushes a fresh `hass` into each nested card. Cheap enough to call per tick. */
export function updateCardsHass(
  cards: HTMLElement[],
  hass: HomeAssistant | undefined,
): void {
  for (const card of cards) {
    (card as HTMLElement & { hass?: HomeAssistant }).hass = hass;
  }
}
