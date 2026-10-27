import type { LitElement, PropertyDeclaration, PropertyValues } from "lit";
import { ConfigTemplateResolver } from "./config-templates";
import type { HomeAssistant } from "../types";
import { closeSheetOf, forwardHassToSheet } from "./entity-detail";
import { attachCardHaptics } from "./card-haptics";

// Jinja2 in a card's own config, for every card at once.
//
// A card binds its name, icon or colour to an entity's state, and that is all it
// can do: "Kitchen", or the raw value — never "Kitchen · 21.4 °C", and never an
// icon that depends on two entities at once. Mushroom's template card can do
// that, so a dashboard moved over from mushroom loses it, and the workaround is
// a template-sensor helper in the Home Assistant config for every card that
// needs one.
//
// A card mixed with this gets it without knowing. Any string in its config
// containing `{{` or `{%` is subscribed over Home Assistant's `render_template`
// websocket subscription — the same live subscription the nav card already uses
// for its entries — and substituted before the card renders. Which strings
// those are is up to whoever wrote the dashboard: the mixin has no list of
// fields, so anything a card reads out of its config can be templated.
//
// HOW IT ATTACHES
//
// Not by wrapping `setConfig`. Every card does real work in there — building
// nested cards, pulling the entity registry over the websocket, reading
// collapse state — and running all of it again just to get a new string in
// would make a templated name cost as much as a dashboard reload. So the mixin
// hooks `willUpdate`, which runs before every render, and swaps `_config` for a
// resolved copy at that point. setConfig runs once per config, as before; a
// pushed value costs one substitution and one render.
//
// Cards need no change of their own beyond mixing this in: they go on reading
// `this._config`, which is now the config they were given with the templates
// already rendered.
//
// A card whose config holds no template pays one small object per instance and
// two identity comparisons per update, and nothing else: no subscription, no
// manager, no copy of the config, no extra render. Its `_config` stays the very
// object its own setConfig built.

// The `any[]` rest parameter is what TypeScript requires of a mixin's base
// constructor; nothing here reads the arguments.
type Constructor<T> = new (...args: any[]) => T;

/**
 * The two members the mixin reaches for on the card.
 *
 * Both are declared by the cards themselves — `_config` as a private `@state()`
 * and `hass` as a plain property on most cards but as an accessor pair on a
 * couple of them — and re-declaring either here would clash with those
 * declarations rather than unify with them. One cast, in one place, is the
 * honest way to state what the mixin expects of its host: the config in
 * `_config`, Home Assistant in `hass`.
 */
interface TemplatedCardHost {
  _config?: unknown;
  hass?: HomeAssistant;
}

export interface TemplatedCardMixin {
  /** The config as the author wrote it, templates unrendered. */
  readonly rawConfig: unknown;
}

export const TemplatedCard = <T extends Constructor<LitElement>>(
  Base: T,
): T & Constructor<TemplatedCardMixin> =>
  class TemplatedCardElement extends Base {
    private readonly _templates = new ConfigTemplateResolver(() => this.requestUpdate());
    private _detachHaptics?: () => void;

    public get rawConfig(): unknown {
      return this._templates.rawConfig;
    }

    public connectedCallback(): void {
      super.connectedCallback();
      // Home Assistant keeps view elements in a cache and re-inserts the same
      // card when you navigate back, and a reconnect changes no property — so
      // without this nothing would ask for the update that reopens the
      // subscriptions closed on the way out.
      if (this._templates.active) this.requestUpdate();
      // A light vibration on every tap on a control (shared/card-haptics.ts).
      // `haptics: false` turns it off per card; a card that fires its own
      // haptics sets `ownHaptics` so a tap does not vibrate twice.
      if (!(this.constructor as { ownHaptics?: boolean }).ownHaptics) {
        this._detachHaptics ??= attachCardHaptics(
          this,
          () => ((this as unknown as TemplatedCardHost)._config as { haptics?: boolean } | undefined)?.haptics !== false,
        );
      }
    }

    public disconnectedCallback(): void {
      this._templates.close();
      this._detachHaptics?.();
      this._detachHaptics = undefined;
      closeSheetOf(this);
      super.disconnectedCallback();
    }

    // The detail sheet (shared/detail-sheet.ts) lives in this card's shadow root
    // and shows live values, so it needs every new `hass` — including the
    // ones the card's own shouldUpdate decides are not worth a render, which
    // is most of them. Every property write passes through here, render or
    // not; willUpdate would only see the ones that render.
    public requestUpdate(
      name?: PropertyKey,
      oldValue?: unknown,
      options?: PropertyDeclaration,
      useNewValue?: boolean,
      newValue?: unknown,
    ): void {
      super.requestUpdate(name, oldValue, options, useNewValue, newValue);
      if (name === "hass") forwardHassToSheet(this, (this as unknown as TemplatedCardHost).hass);
    }

    protected willUpdate(changed: PropertyValues): void {
      super.willUpdate(changed);

      const host = this as unknown as TemplatedCardHost;
      const resolved = this._templates.sync(host._config, host.hass);
      if (resolved === host._config) return;

      // Written straight to the card's reactive `_config`. Inside willUpdate
      // that folds into the render already in flight rather than scheduling a
      // second one, and the card reads its resolved config without knowing any
      // of this happened.
      host._config = resolved;
    }
  };
