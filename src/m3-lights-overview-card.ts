import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  M3LightsOverviewCardConfig,
  LightsOverviewPopupMode,
  HaActionConfig,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_LIGHTS_OVERVIEW_RADIUS,
  DEFAULT_LIGHTS_OVERVIEW_ICON,
  LIGHTS_OVERVIEW_GRID_GAP,
  LIGHTS_OVERVIEW_GRID_MIN_COL,
  LIGHTS_OVERVIEW_ENTITY_GRID_MIN_COL,
  LIGHTS_OVERVIEW_TILE_RADIUS,
  LIGHTS_OVERVIEW_COLOR_ON,
  LIGHTS_OVERVIEW_COLOR_OFF,
  resolveCornerRadius,
} from "./const";
import { resolveThemeColor, buildCssVars, resolveCommonColors, tintOn, foregroundOn } from "./shared/color-config";
import { glassCardStyles, glassCardClass } from "./shared/glass-card";
import { renderCardHeader, cardHeaderStyles } from "./shared/card-header";
import { shouldAnimate } from "./shared/animation";
import { discoverLightRooms, type DiscoveredLightRoom } from "./shared/ha-registry";
import {
  buildStatePredicate,
  hasStateFilter,
  mergeEntityFilters,
  type EntityFilterConfig,
} from "./shared/entity-filter";
import { guessRoomIcon } from "./shared/room-icons";
import { TapHoldGesture } from "./shared/gestures";
import { runHaAction, navigateTo } from "./shared/actions";
import {
  syncPopupCardElement,
  syncDialogOpenState,
  renderPopupDialog,
  popupCardStyles,
  shouldCloseOnBackdropClick,
  type PopupCardHandle,
} from "./shared/popup-card";
import { DetailCardController } from "./shared/detail-card";
import type { CardTemplateTokens } from "./shared/card-template";
import { discoveryChangeMatters } from "./shared/should-update";
import { localize, type TranslationKey } from "./localize";
import { TemplatedCard } from "./shared/templated-card";
import { openEntityDetail } from "./shared/entity-detail";

console.info(
  `%c M3-LIGHTS-OVERVIEW-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #f0c46e; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #f0c46e; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

type ActionKind = "tap" | "hold" | "double_tap";

interface LightsOverviewTile {
  key: string;
  name: string;
  icon: string;
  entities: string[];
  switchable: string[];
  onCount: number;
  total: number;
  unavailable: boolean;
  areaId?: string;
  areaName?: string;
  /** Room name shown under an individual light, in the "entities" view. */
  secondary?: string;
}

// The 8-key subset every EntityFilterConfig consumer wants, pulled off the
// card config once — kept separate from the full config so the discovery
// dedup key (below) doesn't change on every unrelated edit (a color tweak,
// an action change), which would trigger a needless re-discovery.
function configFilter(config: M3LightsOverviewCardConfig): EntityFilterConfig {
  return {
    include_area: config.include_area,
    exclude_area: config.exclude_area,
    include_entities: config.include_entities,
    exclude_entities: config.exclude_entities,
    include_labels: config.include_labels,
    exclude_labels: config.exclude_labels,
    include_state: config.include_state,
    exclude_state: config.exclude_state,
  };
}

@customElement("m3-lights-overview-card")
export class M3LightsOverviewCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3LightsOverviewCardConfig;
  @state() private _discovered: DiscoveredLightRoom[] = [];
  @state() private _popupTile?: LightsOverviewTile;
  @state() private _pressedKey?: string;
  @state() private _detailCardEl?: HTMLElement & PopupCardHandle;

  private _discoverInFlight = false;
  private _lastDiscoverKey?: string;
  private _gestures = new TapHoldGesture();
  private _popupOpenedAt = 0;
  private _popupCardEl?: HTMLElement & PopupCardHandle;
  private _popupCardKey?: string;
  private _detailCard = new DetailCardController();

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-lights-overview-card-editor");
    return document.createElement("m3-lights-overview-card-editor") as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(): M3LightsOverviewCardConfig {
    return {
      type: "custom:m3-lights-overview-card",
      auto_discover: true,
      glass_background: true,
    };
  }

  public setConfig(config: M3LightsOverviewCardConfig): void {
    this._config = {
      glass_background: true,
      animation: "auto",
      auto_discover: config.rooms?.length ? false : true,
      sort: "name",
      show_count: true,
      ...config,
    };
    this._lastDiscoverKey = undefined;
  }

  public getCardSize(): number {
    return 3;
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: "full", rows: "auto", min_rows: 3 };
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._gestures.cancel();
    this._closePopup();
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  /**
   * The toggle set's filter: the card's own display filter with the
   * `toggle_filter` override layered on, unless inheriting is switched off.
   * `exclude_toggle_entities` is a shorthand folded in here so both
   * spellings behave identically.
   */
  private _toggleFilter(): EntityFilterConfig {
    const cfg = this._config;
    if (!cfg) return {};
    const override: EntityFilterConfig = { ...(cfg.toggle_filter ?? {}) };
    if (cfg.exclude_toggle_entities?.length) {
      override.exclude_entities = [
        ...new Set([...(override.exclude_entities ?? []), ...cfg.exclude_toggle_entities]),
      ];
    }
    return mergeEntityFilters(configFilter(cfg), override, cfg.toggle_inherit_filters ?? true);
  }

  private _maybeDiscover(): void {
    const cfg = this._config;
    if (!this.hass || !cfg || cfg.rooms?.length || !(cfg.auto_discover ?? true) || this._discoverInFlight) {
      return;
    }
    const filter = configFilter(cfg);
    const toggleFilter = this._toggleFilter();
    const key = JSON.stringify({
      filter,
      toggleFilter,
      groupHandling: cfg.group_handling ?? "all",
      toggleGroupHandling: cfg.toggle_group_handling ?? cfg.group_handling ?? "all",
    });
    if (key === this._lastDiscoverKey) return;
    this._lastDiscoverKey = key;
    this._discoverInFlight = true;
    discoverLightRooms(this.hass, {
      domains: cfg.include_domains,
      filter,
      toggleFilter,
      groupHandling: cfg.group_handling,
      toggleGroupHandling: cfg.toggle_group_handling,
    })
      .then((rooms) => {
        this._discovered = rooms;
      })
      .catch((e) => console.error("m3-lights-overview-card: auto-discovery failed", e))
      .finally(() => {
        this._discoverInFlight = false;
      });
  }

  private _buildTiles(): LightsOverviewTile[] {
    if (!this.hass || !this._config) return [];
    const cfg = this._config;
    const hass = this.hass;
    const view = cfg.view ?? "rooms";
    const filter = configFilter(cfg);
    const toggleFilter = this._toggleFilter();
    // State changes far more often than area/label assignment, so unlike the
    // area filter this is re-evaluated live here rather than baked into
    // discovery — see discoverLightRooms' doc comment.
    const showState = buildStatePredicate(hass, filter);
    const toggleState = buildStatePredicate(hass, toggleFilter);
    const excludeToggleGlobal = new Set(cfg.exclude_toggle_entities ?? []);

    const rooms = cfg.rooms?.length
      ? cfg.rooms.map((r, i) => {
          const exclude = new Set([...(r.exclude_toggle_entities ?? []), ...excludeToggleGlobal]);
          const toggleSource = r.toggle_entities ?? r.entities ?? [];
          return {
            key: `manual:${i}`,
            name: r.name,
            icon: r.icon,
            entities: (r.entities ?? []).filter(showState),
            toggleEntities: toggleSource.filter((id) => !exclude.has(id)).filter(toggleState),
            areaId: undefined as string | undefined,
          };
        })
      : this._discovered.map((r) => ({
          key: `area:${r.areaId}`,
          name: r.name,
          icon: r.icon,
          entities: r.entities.filter(showState),
          toggleEntities: r.toggleEntities.filter(toggleState),
          areaId: r.areaId as string | undefined,
        }));

    if (view === "entities") {
      const showArea = cfg.show_area !== false;
      return rooms.flatMap((room) => {
        const switchableSet = new Set(room.toggleEntities);
        return room.entities
          .filter((id) => !!hass.states[id])
          .map((id): LightsOverviewTile => {
            const st = hass.states[id];
            const on = st.state === "on";
            return {
              key: `entity:${id}`,
              name: (st.attributes.friendly_name as string | undefined) ?? id,
              icon: (st.attributes.icon as string | undefined) ?? (on ? "mdi:lightbulb" : "mdi:lightbulb-outline"),
              entities: [id],
              switchable: switchableSet.has(id) ? [id] : [],
              onCount: on ? 1 : 0,
              total: 1,
              unavailable: st.state === "unavailable" || st.state === "unknown",
              secondary: showArea ? room.name : undefined,
              areaName: room.name,
              areaId: room.areaId,
            };
          });
      });
    }

    // A room the display filter narrowed down to zero entities should
    // disappear even with hide_empty_rooms off — otherwise filtering by
    // e.g. include_state: ["on"] leaves a trail of empty tiles once every
    // light in a room turns off.
    const forceHideEmpty = hasStateFilter(filter);
    return rooms
      .map((room): LightsOverviewTile => {
        const entities = room.entities.filter((id) => !!hass.states[id]);
        const onCount = entities.filter((id) => hass.states[id]?.state === "on").length;
        return {
          key: room.key,
          name: room.name,
          icon: room.icon || guessRoomIcon(room.name),
          entities,
          switchable: room.toggleEntities.filter((id) => !!hass.states[id]),
          onCount,
          total: entities.length,
          unavailable: entities.length === 0,
          areaName: room.name,
          areaId: room.areaId,
        };
      })
      .filter((tile) => !((cfg.hide_empty_rooms || forceHideEmpty) && tile.total === 0));
  }

  private _sortTiles(tiles: LightsOverviewTile[]): LightsOverviewTile[] {
    const sort = this._config?.sort ?? "name";
    if (sort === "on_first") {
      return [...tiles].sort(
        (a, b) => +(b.onCount > 0) - +(a.onCount > 0) || a.name.localeCompare(b.name, this._language),
      );
    }
    if (sort === "area") {
      return [...tiles].sort(
        (a, b) =>
          (a.areaName ?? "").localeCompare(b.areaName ?? "", this._language) ||
          a.name.localeCompare(b.name, this._language),
      );
    }
    return [...tiles].sort((a, b) => a.name.localeCompare(b.name, this._language));
  }

  // Any light on means the room reads as on, so a tap turns everything off —
  // a plain toggle would flip each lamp individually and leave a chequerboard.
  //
  // `homeassistant` rather than `light`, because a room's lighting is not
  // always in the light domain: a lamp on a smart plug is a `switch`, and a
  // manual room takes whatever entity ids it is given. `light.turn_on` simply
  // fails on those. The generic service covers every switchable domain, and
  // for a real light it does exactly what `light.turn_on` did.
  private _toggleRoom(tile: LightsOverviewTile): void {
    if (!this.hass || tile.switchable.length === 0) return;
    const anyOn = tile.switchable.some((id) => this.hass!.states[id]?.state === "on");
    this.hass.callService("homeassistant", anyOn ? "turn_off" : "turn_on", {}, { entity_id: tile.switchable });
  }

  private _defaultAction(kind: ActionKind): HaActionConfig {
    if (kind === "tap") return { action: "toggle" };
    if (kind === "hold") return { action: (this._config?.view ?? "rooms") === "entities" ? "more-info" : "popup" };
    return { action: "none" };
  }

  private _resolveAction(kind: ActionKind): HaActionConfig {
    const cfg = this._config;
    const configured =
      kind === "tap" ? cfg?.tap_action : kind === "hold" ? cfg?.hold_action : cfg?.double_tap_action;
    return configured ?? this._defaultAction(kind);
  }

  private _runAction(tile: LightsOverviewTile, kind: ActionKind): void {
    if (!this.hass) return;
    runHaAction(this.hass, this._resolveAction(kind), {
      source: this,
      entityId: tile.entities[0],
      toggle: () => this._toggleRoom(tile),
      openPopup: () => this._openPopup(tile),
      fireMoreInfo: (entityId) => openEntityDetail(this, entityId),
      navigate: (path) => navigateTo(this, path),
    });
  }

  private _closePopup(): void {
    this._popupTile = undefined;
    this._popupCardEl = undefined;
    this._popupCardKey = undefined;
    this._detailCardEl = undefined;
    this._detailCard.reset();
  }

  private _popupMode(): LightsOverviewPopupMode {
    return this._config?.popup?.mode ?? "default-grid";
  }

  private _openPopup(tile: LightsOverviewTile): void {
    // "default-detail" isn't a card popup at all — it's HA's own more-info
    // dialog for the tile's first entity, so the internal <dialog> never opens.
    if (this._popupMode() === "default-detail") {
      openEntityDetail(this, tile.entities[0]);
      return;
    }
    this._popupOpenedAt = Date.now();
    this._popupTile = tile;
  }

  /** Context handed to a configured `popup.card` skeleton's `[[token]]`
   * placeholders — see shared/card-template.ts. */
  private _tileTokens(tile: LightsOverviewTile): CardTemplateTokens {
    return {
      area_id: tile.areaId,
      entity_id: tile.switchable[0] ?? tile.entities[0],
      name: tile.name,
    };
  }

  // Drives the async `popup.card` build/reuse cycle — called from updated()
  // since createCardElement() is async and render() must stay synchronous.
  private _maybeSyncDetailCard(): void {
    const tile = this._popupTile;
    const skeleton = this._popupMode() === "custom" ? this._config?.popup?.card : undefined;
    if (!tile || !this.hass || !skeleton) {
      this._detailCard.reset();
      return;
    }
    this._detailCard.sync({
      skeleton,
      tokens: this._tileTokens(tile),
      hass: this.hass,
      onChange: (el) => {
        this._detailCardEl = el;
      },
    });
  }

  /**
   * The popup is this same card again, scoped to what was pressed. A
   * discovered tile scopes by area; a manually configured room has no area,
   * so it scopes by its explicit entity list instead — same filter
   * vocabulary either way.
   */
  private _popupConfig(tile: LightsOverviewTile): M3LightsOverviewCardConfig | undefined {
    const cfg = this._config;
    if (!cfg) return undefined;
    const popup = cfg.popup ?? {};
    const merged = mergeEntityFilters(configFilter(cfg), popup, popup.inherit_filters ?? true);
    // A tile from an area re-runs discovery scoped to that area, which also
    // picks up anything added to the room since. A tile from a manual `rooms`
    // entry cannot: discovery drops entities that have no area, and a manual
    // room is exactly where those live — the popup came up empty. It already
    // knows its own entities, so it hands them over as a room of one instead
    // of asking the registry a question it cannot answer.
    const scoped: Partial<M3LightsOverviewCardConfig> = tile.areaId
      ? { include_area: [tile.areaId], rooms: undefined, auto_discover: true }
      : {
          rooms: [
            { name: tile.name, entities: tile.entities, toggle_entities: tile.switchable },
          ],
          auto_discover: false,
        };
    return {
      ...cfg,
      ...merged,
      ...scoped,
      view: popup.view ?? "entities",
      sort: popup.sort ?? "name",
      group_handling: popup.group_handling ?? cfg.group_handling,
      toggle_group_handling: popup.toggle_group_handling ?? cfg.toggle_group_handling,
      show_area: popup.show_area ?? false,
      // The popup's header carries the room name, so it stays unless the
      // popup config says otherwise — inheriting a hidden header would leave
      // the dialog with nothing identifying it.
      show_header: popup.show_header ?? true,
      name: popup.title || tile.name,
      // A popup inside a popup would be a trap with no way out.
      tap_action: { action: "toggle" },
      hold_action: { action: "more-info" },
      double_tap_action: undefined,
      popup: undefined,
      glass_background: false,
      type: "custom:m3-lights-overview-card",
    };
  }

  private _syncScopedPopupCard(tile: LightsOverviewTile): HTMLElement | undefined {
    const { el, key } = syncPopupCardElement<M3LightsOverviewCardConfig>({
      tagName: "m3-lights-overview-card",
      config: this._popupConfig(tile),
      hass: this.hass,
      existingEl: this._popupCardEl,
      existingKey: this._popupCardKey,
    });
    this._popupCardEl = el;
    this._popupCardKey = key;
    return this._popupCardEl;
  }

  private _renderPopup() {
    const tile = this._popupTile;
    if (!tile) {
      this._popupCardEl = undefined;
      this._popupCardKey = undefined;
      return nothing;
    }
    const content = this._popupMode() === "custom" ? this._detailCardEl : this._syncScopedPopupCard(tile);

    return renderPopupDialog({
      content,
      onClose: () => this._closePopup(),
      onBackdropClick: (e) => {
        if (shouldCloseOnBackdropClick(e, this._popupOpenedAt)) this._closePopup();
      },
      closeLabel: this._t("dialog_close"),
    });
  }

  private _watchedEntities(): (string | undefined)[] {
    const cfg = this._config;
    if (!cfg) return [];
    if (cfg.rooms?.length) {
      return cfg.rooms.flatMap((r) => [...(r.entities ?? []), ...(r.toggle_entities ?? r.entities ?? [])]);
    }
    return this._discovered.flatMap((r) => [...r.entities, ...r.toggleEntities]);
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return discoveryChangeMatters(changed, this.hass, this._watchedEntities());
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    this._maybeDiscover();
    if (this._popupCardEl && this.hass) this._popupCardEl.hass = this.hass;
    this._maybeSyncDetailCard();
    if (changed.has("_popupTile")) {
      const dialog = this.renderRoot?.querySelector("dialog") as HTMLDialogElement | null;
      syncDialogOpenState(dialog, !!this._popupTile);
    }
  }

  protected render() {
    if (!this._config || !this.hass) return nothing;

    const view = this._config.view ?? "rooms";
    const tiles = this._sortTiles(this._buildTiles());
    const onRooms = tiles.filter((t) => t.onCount > 0).length;
    const onLights = tiles.reduce((sum, t) => sum + t.onCount, 0);

    const name = this._config.name || this._t("lights_overview_default_name");
    const icon = this._config.icon || (view === "entities" ? "mdi:lightbulb-multiple" : DEFAULT_LIGHTS_OVERVIEW_ICON);
    const emptyKey: TranslationKey = view === "entities" ? "lights_overview_empty_entities" : "lights_overview_empty";
    const subtitle =
      tiles.length === 0
        ? this._t(emptyKey)
        : view === "entities"
          ? this._t("lights_overview_subtitle_entities")
              .replace("{on}", String(onLights))
              .replace("{total}", String(tiles.length))
          : this._t("lights_overview_subtitle")
              .replace("{rooms}", String(onRooms))
              .replace("{lights}", String(onLights));

    const onColor = this._config.on_color ? resolveThemeColor(this._config.on_color) : LIGHTS_OVERVIEW_COLOR_ON;
    const offColor = this._config.off_color ? resolveThemeColor(this._config.off_color) : LIGHTS_OVERVIEW_COLOR_OFF;
    const accentColor = this._config.accent_color ? resolveThemeColor(this._config.accent_color) : onColor;

    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(this._config);
    const radius = resolveCornerRadius(this._config.radius ?? DEFAULT_LIGHTS_OVERVIEW_RADIUS, this._config.corners);
    const animClass = shouldAnimate(this._config.animation) ? "" : "no-animations";

    const iconWellCss = tintOn(this, accentColor, this._config.accent_opacity, 12);
    const cssVars = buildCssVars({
      "m3p-icon-color": foregroundOn(accentColor, iconWellCss),
      "m3p-icon-bg": iconWellCss,
      "m3p-text": textColorCss,
      "m3p-secondary-text": secondaryTextColorCss,
    });

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(this._config.glass_background)} ${animClass}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          ${this._config.show_header === false ? nothing : renderCardHeader({ icon, name, subtitle })}

          ${tiles.length === 0
            ? html`<div class="empty-state">${this._t(emptyKey)}</div>`
            : html`
                <div class="room-grid ${view === "entities" ? "entity-grid" : ""}">
                  ${tiles.map((t) => this._renderTile(t, onColor, offColor))}
                </div>
              `}
        </div>
        ${this._renderPopup()}
      </ha-card>
    `;
  }

  private _renderTile(tile: LightsOverviewTile, onColor: string, offColor: string) {
    const hasDoubleTap = (this._config?.double_tap_action?.action ?? "none") !== "none";
    const holdAction = this._resolveAction("hold");
    const listeners = this._gestures.listeners({
      onTap: () => this._runAction(tile, "tap"),
      onHold: holdAction.action === "none" ? undefined : () => this._runAction(tile, "hold"),
      onDoubleTap: hasDoubleTap ? () => this._runAction(tile, "double_tap") : undefined,
      onPressChange: (pressed) => {
        this._pressedKey = pressed ? tile.key : undefined;
      },
    });
    const on = tile.onCount > 0;
    const color = on ? onColor : offColor;
    const stateLabel = on ? this._t("lights_overview_on") : this._t("lights_overview_off");
    const ariaLabel = `${tile.name}: ${stateLabel}`;

    return html`
      <div
        class="room-tile ${tile.unavailable ? "unavailable" : ""} ${tile.switchable.length === 0
          ? "not-switchable"
          : ""} ${on ? "is-on" : ""} ${this._pressedKey === tile.key ? "pressed" : ""}"
        style=${`--tile-color: ${color}; background: ${tintOn(this, color, this._config?.tile_tint_opacity, on ? 20 : 10)};`}
        role="button"
        tabindex="0"
        aria-label=${ariaLabel}
        title=${ariaLabel}
        @pointerdown=${listeners["@pointerdown"]}
        @pointermove=${listeners["@pointermove"]}
        @pointerup=${listeners["@pointerup"]}
        @pointercancel=${listeners["@pointercancel"]}
        @contextmenu=${listeners["@contextmenu"]}
        @keydown=${listeners["@keydown"]}
      >
        <div class="tile-header">
          <ha-icon icon=${tile.icon}></ha-icon>
          <span class="tile-name">${tile.name}</span>
        </div>
        <div class="tile-state">
          <ha-icon class="bulb" icon=${on ? "mdi:lightbulb-on" : "mdi:lightbulb-outline"}></ha-icon>
          <span class="state-text">${stateLabel}</span>
        </div>
        ${tile.secondary
          ? html`<div class="tile-count">${tile.secondary}</div>`
          : this._config?.show_count !== false && tile.total > 1
            ? html`
                <div class="tile-count">
                  ${this._t("lights_overview_count")
                    .replace("{on}", String(tile.onCount))
                    .replace("{total}", String(tile.total))}
                </div>
              `
            : nothing}
      </div>
    `;
  }

  static styles = [
    glassCardStyles,
    cardHeaderStyles,
    popupCardStyles,
    css`
      .room-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(${LIGHTS_OVERVIEW_GRID_MIN_COL}px, 1fr));
        gap: ${LIGHTS_OVERVIEW_GRID_GAP}px;
      }

      .entity-grid {
        grid-template-columns: repeat(auto-fit, minmax(${LIGHTS_OVERVIEW_ENTITY_GRID_MIN_COL}px, 1fr));
      }

      .room-tile {
        padding: 11px 9px;
        border-radius: ${LIGHTS_OVERVIEW_TILE_RADIUS}px;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        gap: 4px;
        box-sizing: border-box;
        /* iOS would otherwise answer a long press with the text-selection
           magnifier and its own share/copy callout. */
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
        -webkit-tap-highlight-color: transparent;
        transition: transform 120ms ease-out;
      }

      /* Without this the hold is invisible until the popup appears, which
         reads as an unresponsive tile. */
      .room-tile.pressed {
        transform: scale(0.96);
      }

      .no-animations .room-tile {
        transition: none;
      }

      .room-tile:focus-visible {
        outline: 2px solid var(--tile-color);
        outline-offset: 2px;
      }

      .room-tile.unavailable {
        opacity: 0.4;
        cursor: default;
      }

      /* Nothing left to switch after the toggle filter — still readable,
         but it must not look like a button. */
      .room-tile.not-switchable {
        cursor: default;
      }

      .tile-header {
        display: flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
      }

      .tile-header ha-icon {
        --mdc-icon-size: 13px;
        color: var(--tile-color);
        flex-shrink: 0;
      }

      .tile-name {
        font-size: 10px;
        opacity: 0.7;
        color: var(--m3p-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
      }

      .tile-state {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .tile-state .bulb {
        --mdc-icon-size: 18px;
        color: var(--tile-color);
      }

      .state-text {
        font-size: 17px;
        font-weight: 500;
        color: var(--m3p-text);
        line-height: 1.1;
      }

      .tile-count {
        font-size: 10px;
        opacity: 0.55;
        color: var(--m3p-secondary-text);
      }

      .empty-state {
        text-align: center;
        font-size: 13px;
        opacity: 0.6;
        padding: 16px 0;
        color: var(--m3p-secondary-text);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-lights-overview-card": M3LightsOverviewCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-lights-overview-card",
  name: "M3 Lights Overview Card",
  description: "Eine Material-3-Übersicht aller Lichter, automatisch nach Bereich gruppiert.",
  // false: auto_discover would otherwise run full-house discovery in HA's
  // card picker preview — see m3-battery-card.ts for the full rationale.
  preview: false,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
