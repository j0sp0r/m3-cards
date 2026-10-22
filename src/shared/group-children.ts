import type { PopupCardHandle } from "./popup-card";
import type { LovelaceCardConfig } from "../types";

// The N-card version of DetailCardController (detail-card.ts): builds and
// keeps alive one child element per entry in a `cards` config array via HA's
// public `loadCardHelpers().createCardElement()` API, reusing an element
// in-place (via setConfig) whenever its config's `type` is unchanged so
// reordering/editing doesn't tear down and rebuild every child on every
// keystroke. `window.loadCardHelpers` is declared globally by detail-card.ts.

interface ChildEntry {
  el: HTMLElement & PopupCardHandle;
  type: string | undefined;
  key: string;
}

export class GroupChildrenController {
  private _entries: (ChildEntry | undefined)[] = [];
  private _building = new Set<number>();
  // The array _currentElements() returns is a fresh allocation on every call
  // even when its contents are identical, so callers that store it in a Lit
  // @state field would otherwise request another update every single render
  // (array identity, not content, is what Lit's default hasChanged compares)
  // — an infinite render loop, since updated() calls sync() again. Emitting
  // only when the content actually differs from the last emit breaks that
  // loop. `undefined` (not `[]`) means "never emitted yet", so the first
  // sync() still reports an empty list rather than being swallowed by the
  // same "nothing changed" check.
  private _lastEmitted: HTMLElement[] | undefined;

  reset(): void {
    this._entries = [];
    this._building.clear();
    this._lastEmitted = undefined;
  }

  sync(params: {
    cards: LovelaceCardConfig[];
    hass: unknown;
    onChange: (elements: HTMLElement[]) => void;
    /** Called with each element and the config it was built or reconfigured from. */
    decorate?: (el: HTMLElement, config: LovelaceCardConfig) => void;
  }): void {
    const { cards, hass, onChange, decorate } = params;
    const loadHelpers = window.loadCardHelpers;
    if (!loadHelpers) {
      this._entries = [];
      this._building.clear();
      this._maybeEmit(onChange);
      return;
    }

    this._entries.length = cards.length;

    cards.forEach((config, index) => {
      const key = JSON.stringify(config);
      const existing = this._entries[index];
      if (existing?.key === key) return;

      const type = typeof config.type === "string" ? config.type : undefined;
      if (existing && existing.type === type) {
        existing.key = key;
        existing.el.setConfig?.(config);
        decorate?.(existing.el, config);
        return;
      }

      // A build for a stale key may already be in flight — sync() runs again
      // on the host's next update and re-checks, same guard as
      // DetailCardController.sync().
      if (this._building.has(index)) return;
      this._building.add(index);
      loadHelpers()
        .then((helpers) => helpers.createCardElement(config) as HTMLElement & { hass?: unknown })
        .then((el) => {
          el.hass = hass;
          decorate?.(el, config);
          this._entries[index] = { el, type, key };
          this._maybeEmit(onChange);
        })
        .catch((e) => {
          console.error("m3-cards: failed to build group child card", e);
        })
        .finally(() => {
          this._building.delete(index);
        });
    });

    for (const entry of this._entries) {
      if (entry) entry.el.hass = hass;
    }
    this._maybeEmit(onChange);
  }

  private _maybeEmit(onChange: (elements: HTMLElement[]) => void): void {
    const next = this._currentElements();
    const last = this._lastEmitted;
    const unchanged = !!last && next.length === last.length && next.every((el, i) => el === last[i]);
    if (unchanged) return;
    this._lastEmitted = next;
    onChange(next);
  }

  private _currentElements(): HTMLElement[] {
    return this._entries.filter((e): e is ChildEntry => !!e).map((e) => e.el);
  }
}
