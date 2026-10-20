import { LitElement, html, css, unsafeCSS, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  M3ClimateOverviewCardConfig,
  ClimateOverviewTempThresholds,
  ClimateOverviewPopupMode,
  HaActionConfig,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
} from "./types";
import {
  CLIMATE_SHEET_MS,
  CARD_VERSION,
  DEFAULT_CLIMATE_OVERVIEW_RADIUS,
  DEFAULT_CLIMATE_OVERVIEW_ICON,
  DEFAULT_CLIMATE_OVERVIEW_TEMP_THRESHOLDS,
  DEFAULT_CLIMATE_OVERVIEW_HUMIDITY_RANGE,
  DEFAULT_CLIMATE_OVERVIEW_NAME_STRIP,
  CLIMATE_OVERVIEW_GRID_GAP,
  CLIMATE_OVERVIEW_GRID_MIN_COL,
  CLIMATE_OVERVIEW_TILE_RADIUS,
  CLIMATE_OVERVIEW_COLOR_COLD,
  CLIMATE_OVERVIEW_COLOR_COOL,
  CLIMATE_OVERVIEW_COLOR_COMFORTABLE,
  CLIMATE_OVERVIEW_COLOR_WARM,
  CLIMATE_OVERVIEW_COLOR_HOT,
  CLIMATE_OVERVIEW_HUMIDITY_WARN_COLOR,
  CLIMATE_OVERVIEW_SCALE_MIN_SPAN,
  CLIMATE_OVERVIEW_LABEL_CHAR_PX,
  CLIMATE_OVERVIEW_LABEL_MAX_PX,
  CLIMATE_OVERVIEW_LABEL_GAP_PX,
  CLIMATE_OVERVIEW_DOT_SIZE,
  CLIMATE_OVERVIEW_DOT_RADIUS,
  CLIMATE_OVERVIEW_DOT_TRANSITION_MS,
  CLIMATE_OVERVIEW_CHIP_RADIUS,
  CLIMATE_OVERVIEW_TREND_REFRESH_MS,
  CLIMATE_OVERVIEW_TREND_THRESHOLD_K,
  CLIMATE_OVERVIEW_MOLD_HUMIDITY_THRESHOLD,
  CLIMATE_OVERVIEW_MOLD_TEMP_THRESHOLD,
  resolveCornerRadius,
} from "./const";
import { resolveThemeColor, buildCssVars, resolveCommonColors, tintOn, tintInk, foregroundOn } from "./shared/color-config";
import { glassCardStyles, glassCardClass } from "./shared/glass-card";
import { renderCardHeader, cardHeaderStyles } from "./shared/card-header";
import { shouldAnimate, STANDARD_EASING } from "./shared/animation";
import { activateOnKey } from "./shared/a11y";
import { fireEvent } from "./shared/editor-helpers";
import {
  areaEntityIds,
  deviceEntityIds,
  discoverClimateRooms,
  type DiscoveredClimateRoom,
} from "./shared/ha-registry";
import { fetchValueHoursAgo } from "./shared/ha-statistics";
import { formatNumber } from "./shared/formatting";
import { guessRoomIcon } from "./shared/room-icons";
import { buildStatePredicate, mergeEntityFilters, type EntityFilterConfig } from "./shared/entity-filter";
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
import { localize, type TranslationKey } from "./localize";
import { discoveryChangeMatters } from "./shared/should-update";
import { TemplatedCard } from "./shared/templated-card";
import { CompareScaleTrack, renderCompareScale, compareScaleStyles } from "./shared/compare-scale";

console.info(
  `%c M3-CLIMATE-OVERVIEW-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #6ba7dc; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #6ba7dc; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

type TempStage = "cold" | "cool" | "comfortable" | "warm" | "hot";
type ActionKind = "tap" | "hold" | "double_tap";

const EASING = unsafeCSS(STANDARD_EASING);

interface ClimateOverviewTile {
  key: string;
  name: string;
  icon: string;
  entity: string;
  /** Entity a tap opens more-info on — the thermostat in thermostat modes,
   * otherwise the same as `entity`. */
  tapEntity: string;
  humidityEntity?: string;
  areaId?: string;
  deviceId?: string;
  temperature?: number;
  temperatureUnavailable: boolean;
  humidity?: number;
  humidityUnavailable: boolean;
  hasHumidity: boolean;
  /** The humidity comes from an entity of its own, not from a thermostat's
   * `current_humidity` attribute. Only then is there anything to open: a
   * more-info on the thermostat would show the thermostat, not the humidity
   * history the number came from. */
  humidityOwnEntity: boolean;
  tempColor: string;
  /** The room's thermostat, when one is configured or discoverable. */
  climateEntity?: string;
}

// The subset every EntityFilterConfig consumer wants, pulled off the card
// config once — kept separate from the full config so the discovery dedup
// key (below) doesn't change on every unrelated edit (a color tweak, an
// action change), which would trigger a needless re-discovery.
export function configFilter(config: M3ClimateOverviewCardConfig): EntityFilterConfig {
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

@customElement("m3-climate-overview-card")
export class M3ClimateOverviewCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3ClimateOverviewCardConfig;
  @state() private _discovered: DiscoveredClimateRoom[] = [];
  @state() private _trendValues: Map<string, number> = new Map();
  /** The climate entity whose thermostat sheet is open, if any. */
  @state() private _thermostat?: string;
  @state() private _thermostatClosing = false;
  @state() private _showAllRooms = false;
  private _thermostatName?: string;
  private _thermostatTimer?: number;
  private _miniCard?: HTMLElement;
  private _miniEntity?: string;
  @state() private _popupTile?: ClimateOverviewTile;
  @state() private _pressedKey?: string;
  @state() private _pressedHumidityKey?: string;
  @state() private _detailCardEl?: HTMLElement & PopupCardHandle;

  private _lastDiscoverKey?: string;
  private _discoverInFlight = false;
  private _trendLastKey?: string;
  private _trendInFlight = false;
  private _trendRefreshTimer?: number;
  private _gestures = new TapHoldGesture();
  /** The humidity strip taps on its own, so it needs its own gesture state —
   * sharing the tile's would let one zone cancel the other's press. */
  private _humidityGestures = new TapHoldGesture();
  private _popupOpenedAt = 0;
  private _popupCardEl?: HTMLElement & PopupCardHandle;
  private _popupCardKey?: string;
  private _detailCard = new DetailCardController();

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-climate-overview-card-editor");
    return document.createElement(
      "m3-climate-overview-card-editor",
    ) as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(): M3ClimateOverviewCardConfig {
    return {
      type: "custom:m3-climate-overview-card",
      auto_discover: true,
      glass_background: true,
    };
  }

  public setConfig(config: M3ClimateOverviewCardConfig): void {
    this._config = {
      glass_background: true,
      animation: "auto",
      auto_discover: config.rooms?.length ? false : true,
      sort: "area",
      show_scale: true,
      show_outlier_chip: true,
      ...config,
    };
  }

  public getCardSize(): number {
    return 4;
  }

  public getGridOptions(): LovelaceGridOptions {
    return {
      columns: "full",
      rows: "auto",
      min_rows: 4,
    };
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this._trendRefreshTimer = window.setInterval(() => {
      this._trendLastKey = undefined;
      this._maybeFetchTrend();
    }, CLIMATE_OVERVIEW_TREND_REFRESH_MS);
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._trendRefreshTimer !== undefined) {
      window.clearInterval(this._trendRefreshTimer);
      this._trendRefreshTimer = undefined;
    }
    this._compareTrack.disconnect();
    this._gestures.cancel();
    this._closePopup();
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    this._maybeDiscover();
    this._maybeFetchTrend();
    if (this._config?.show_scale !== false) {
      const track = this.renderRoot?.querySelector(".compare-track-wrap") as HTMLElement | null;
      this._compareTrack.observe(track, (w) => {
        this._trackWidth = w;
      });
    }
    if (this._popupCardEl && this.hass) this._popupCardEl.hass = this.hass;
    this._maybeSyncDetailCard();
    if (changed.has("_popupTile")) {
      const dialog = this.renderRoot?.querySelector("dialog") as HTMLDialogElement | null;
      syncDialogOpenState(dialog, !!this._popupTile);
    }
  }

  private _maybeFetchTrend(): void {
    if (!this.hass || !this._config?.show_trend || this._trendInFlight) return;
    const entityIds = this._buildTiles().map((t) => t.entity);
    const key = entityIds.join(",");
    if (key === this._trendLastKey || entityIds.length === 0) return;
    this._trendLastKey = key;
    this._trendInFlight = true;
    fetchValueHoursAgo(this.hass, entityIds, 1)
      .then((values) => {
        this._trendValues = values;
      })
      .finally(() => {
        this._trendInFlight = false;
      });
  }

  private _trendDelta(tile: ClimateOverviewTile): number | undefined {
    if (!this._config?.show_trend || tile.temperature === undefined) return undefined;
    const past = this._trendValues.get(tile.entity);
    if (past === undefined) return undefined;
    const delta = tile.temperature - past;
    return Math.abs(delta) > CLIMATE_OVERVIEW_TREND_THRESHOLD_K ? delta : undefined;
  }

  private _moldRisk(tile: ClimateOverviewTile): boolean {
    return (
      !!this._config?.show_mold_warning &&
      tile.humidity !== undefined &&
      tile.humidity > CLIMATE_OVERVIEW_MOLD_HUMIDITY_THRESHOLD &&
      tile.temperature !== undefined &&
      tile.temperature < CLIMATE_OVERVIEW_MOLD_TEMP_THRESHOLD
    );
  }

  private _maybeDiscover(): void {
    if (
      !this.hass ||
      !this._config ||
      this._config.rooms?.length ||
      !(this._config.auto_discover ?? true) ||
      this._discoverInFlight
    ) {
      return;
    }
    const filter = configFilter(this._config);
    const key = JSON.stringify({
      filter,
      strip: this._config.name_strip ?? DEFAULT_CLIMATE_OVERVIEW_NAME_STRIP,
    });
    if (key === this._lastDiscoverKey) return;
    this._lastDiscoverKey = key;
    this._discoverInFlight = true;
    discoverClimateRooms(this.hass, {
      filter,
      nameStrip: this._config.name_strip ?? DEFAULT_CLIMATE_OVERVIEW_NAME_STRIP,
    })
      .then((rooms) => {
        this._discovered = rooms;
        // eslint-disable-next-line no-console
        console.info(`m3-climate-overview-card: ${rooms.length} Räume gefunden`, rooms);
      })
      .catch((e) => console.error("m3-climate-overview-card: auto-discovery failed", e))
      .finally(() => {
        this._discoverInFlight = false;
      });
  }

  private _tempThresholds(): Required<ClimateOverviewTempThresholds> {
    const t = this._config?.temp_thresholds ?? {};
    return {
      cold: t.cold ?? DEFAULT_CLIMATE_OVERVIEW_TEMP_THRESHOLDS.cold,
      cool: t.cool ?? DEFAULT_CLIMATE_OVERVIEW_TEMP_THRESHOLDS.cool,
      comfortable: t.comfortable ?? DEFAULT_CLIMATE_OVERVIEW_TEMP_THRESHOLDS.comfortable,
      warm: t.warm ?? DEFAULT_CLIMATE_OVERVIEW_TEMP_THRESHOLDS.warm,
    };
  }

  private _tempStage(value: number): TempStage {
    const t = this._tempThresholds();
    if (value < t.cold) return "cold";
    if (value < t.cool) return "cool";
    if (value < t.comfortable) return "comfortable";
    if (value < t.warm) return "warm";
    return "hot";
  }

  private _tempColor(stage: TempStage): string {
    const c = this._config;
    switch (stage) {
      case "cold":
        return c?.cold_color ? resolveThemeColor(c.cold_color) : CLIMATE_OVERVIEW_COLOR_COLD;
      case "cool":
        return c?.cool_color ? resolveThemeColor(c.cool_color) : CLIMATE_OVERVIEW_COLOR_COOL;
      case "comfortable":
        return c?.comfortable_color
          ? resolveThemeColor(c.comfortable_color)
          : CLIMATE_OVERVIEW_COLOR_COMFORTABLE;
      case "warm":
        return c?.warm_color ? resolveThemeColor(c.warm_color) : CLIMATE_OVERVIEW_COLOR_WARM;
      case "hot":
      default:
        return c?.hot_color ? resolveThemeColor(c.hot_color) : CLIMATE_OVERVIEW_COLOR_HOT;
    }
  }

  // Reads either an entity's state or one of its attributes as a number.
  // Anything unavailable, missing or non-numeric comes back undefined.
  private _readNumber(entityId: string | undefined, attribute?: string): number | undefined {
    if (!entityId || !this.hass) return undefined;
    const st = this.hass.states[entityId];
    if (!st || st.state === "unavailable" || st.state === "unknown") return undefined;
    const raw = attribute ? st.attributes[attribute] : st.state;
    if (raw === undefined || raw === null || raw === "") return undefined;
    const parsed = parseFloat(String(raw));
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  private _buildTiles(): ClimateOverviewTile[] {
    if (!this.hass || !this._config) return [];
    const mode = this._config.mode ?? "temperature";

    interface RoomSource {
      key: string;
      name: string;
      icon?: string;
      areaId?: string;
      deviceId?: string;
      color?: string;
      tempEntity?: string;
      tempAttribute?: string;
      humidityEntity?: string;
      humidityAttribute?: string;
      tapEntity?: string;
      /** The room's thermostat, independent of `tapEntity` — `tapEntity`
       * follows `mode` (it's the temperature sensor in "temperature" mode),
       * but the thermostat sheet (`tile_tap_action: thermostat`) needs the
       * actual climate entity regardless of mode. */
      climateEntity?: string;
    }

    const source: RoomSource[] = this._config.rooms?.length
      ? this._config.rooms.map((r, i) => ({
          key: `manual:${i}`,
          name: r.name,
          icon: r.icon,
          color: r.color,
          tempEntity: r.temperature_entity,
          humidityEntity: r.humidity_entity,
          tapEntity: r.climate_entity,
          climateEntity: r.climate_entity,
        }))
      : this._discovered.flatMap((room): RoomSource[] => {
          const climateEntity = room.climateEntity;
          const tempEntity = room.temperatureEntity;
          // Auto-discovery always finds both kinds of entity; `mode` decides
          // which rooms actually make the cut and which entity represents
          // each — this is the only place that filters on it.
          if (mode === "thermostat_only" && !climateEntity) return [];
          if (mode === "temperature" && !tempEntity) return [];
          if (!climateEntity && !tempEntity) return [];
          // A thermostat becomes the room's reading when there is no
          // dedicated sensor to fall back to, or when it fronts several
          // real devices ("group" tier) and so is more representative than
          // any single sensor.
          const useClimateAsTemp =
            mode === "thermostat_only" ? !!climateEntity : !tempEntity || room.climateTier === "group";
          return [
            {
              key: room.key,
              name: room.name,
              icon: room.icon,
              areaId: room.areaId,
              deviceId: room.deviceId,
              tempEntity: useClimateAsTemp ? climateEntity : tempEntity,
              tempAttribute: useClimateAsTemp ? "current_temperature" : undefined,
              humidityEntity: room.humidityEntity ?? climateEntity,
              humidityAttribute: room.humidityEntity ? undefined : "current_humidity",
              tapEntity: mode === "temperature" ? tempEntity : (climateEntity ?? tempEntity),
              climateEntity,
            },
          ];
        });

    // State changes far more often than area/label assignment, so unlike the
    // area filter this is re-evaluated live here rather than baked into
    // discovery — see discoverClimateRooms' doc comment.
    const showState = buildStatePredicate(this.hass, configFilter(this._config));

    return source
      .filter((room) => showState(room.tempEntity ?? room.tapEntity ?? ""))
      .flatMap((room): ClimateOverviewTile[] => {
        const entity = room.tempEntity ?? room.tapEntity;
        const tapCandidate = room.tapEntity ?? room.tempEntity;
        if (!entity || !tapCandidate) return [];

        const temperature = this._readNumber(room.tempEntity, room.tempAttribute);
        const humidity = this._readNumber(room.humidityEntity, room.humidityAttribute);
        const stage = temperature !== undefined ? this._tempStage(temperature) : "comfortable";

        return [
          {
            key: room.key,
            name: room.name,
            icon: room.icon || guessRoomIcon(room.name),
            entity,
            tapEntity: this.hass!.states[tapCandidate] ? tapCandidate : entity,
            humidityEntity: room.humidityEntity,
            areaId: room.areaId,
            deviceId: room.deviceId,
            temperature,
            temperatureUnavailable: !!room.tempEntity && temperature === undefined,
            humidity,
            humidityUnavailable: !!room.humidityEntity && humidity === undefined,
            hasHumidity: humidity !== undefined || (!!room.humidityEntity && !room.humidityAttribute),
            humidityOwnEntity: !!room.humidityEntity && !room.humidityAttribute,
            tempColor: room.color ? resolveThemeColor(room.color) : this._tempColor(stage),
            climateEntity: this._climateFor(room.areaId, room.deviceId, room.climateEntity),
          },
        ];
      });
  }

  private _sortTiles(tiles: ClimateOverviewTile[]): ClimateOverviewTile[] {
    const sort = this._config?.sort ?? "area";
    if (sort === "name") {
      return [...tiles].sort((a, b) => a.name.localeCompare(b.name, this._language));
    }
    if (sort === "temp_desc") {
      return [...tiles].sort((a, b) => (b.temperature ?? -Infinity) - (a.temperature ?? -Infinity));
    }
    if (sort === "temp_asc") {
      return [...tiles].sort((a, b) => (a.temperature ?? Infinity) - (b.temperature ?? Infinity));
    }
    return tiles;
  }

  private _tempUnit(): string {
    return this.hass?.config?.unit_system?.temperature ?? "°C";
  }

  private _formatTempValue(value: number): string {
    return formatNumber(this._language, value, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  private _humidityDisplay(tile: ClimateOverviewTile): { color: string; opacity: string } {
    if (tile.humidity === undefined) return { color: "var(--m3p-text)", opacity: "0.55" };
    const [lo, hi] = this._config?.humidity_range ?? DEFAULT_CLIMATE_OVERVIEW_HUMIDITY_RANGE;
    if (tile.humidity < lo || tile.humidity > hi) {
      const warn = this._config?.humidity_warn_color
        ? resolveThemeColor(this._config.humidity_warn_color)
        : CLIMATE_OVERVIEW_HUMIDITY_WARN_COLOR;
      return { color: warn, opacity: "1" };
    }
    return { color: "var(--m3p-text)", opacity: "0.55" };
  }

  private _moreInfo(entityId: string): () => void {
    return () => fireEvent(this, "hass-more-info", { entityId });
  }

  /**
   * The thermostat a room's tile should open.
   *
   * Configured per room first, then the first `climate` entity sitting in the
   * same Home Assistant area as the room. Rooms here are usually *derived*
   * from an area, so that lookup is right far more often than it is wrong —
   * and where it is wrong, `climate_entity` says so outright.
   *
   * A room with no area falls back to the device its sensors sit on. That is
   * the thermostat that reports its own room temperature: the `sensor` and the
   * `climate` entity are the same physical device, so the device is a reliable
   * link even though no area was ever assigned. Without this the tap did
   * nothing at all for those rooms.
   */
  private _climateFor(
    areaId: string | undefined,
    deviceId: string | undefined,
    configured?: string,
  ): string | undefined {
    if (configured) return configured;
    if (!this.hass) return undefined;
    const isClimate = (id: string): boolean => id.startsWith("climate.");
    if (areaId) return areaEntityIds(this.hass, areaId).find(isClimate);
    if (deviceId) return deviceEntityIds(this.hass, deviceId).find(isClimate);
    return undefined;
  }

  // A tap that opens nothing is worse than one that opens the graph, so a
  // room with no thermostat keeps the old behaviour rather than going dead.
  private _openThermostat(tile: ClimateOverviewTile): void {
    if (!tile.climateEntity) {
      fireEvent(this, "hass-more-info", { entityId: tile.tapEntity });
      return;
    }
    window.clearTimeout(this._thermostatTimer);
    this._thermostatClosing = false;
    this._thermostat = tile.climateEntity;
    this._thermostatName = tile.name;
  }

  private _closeThermostat = (): void => {
    if (!shouldAnimate(this._config?.animation)) {
      this._thermostat = undefined;
      return;
    }
    this._thermostatClosing = true;
    window.clearTimeout(this._thermostatTimer);
    this._thermostatTimer = window.setTimeout(() => {
      this._thermostat = undefined;
      this._thermostatClosing = false;
    }, CLIMATE_SHEET_MS);
  };

  /**
   * The suite's own thermostat, kept as one element and re-pointed rather than
   * rebuilt: recreating it on every render would restart its animations and
   * drop any adjustment in flight.
   */
  private _thermostatCard(entityId: string): HTMLElement {
    if (!this._miniCard || this._miniEntity !== entityId) {
      const el = document.createElement("m3-climate-card-mini");
      el.setConfig({ type: "custom:m3-climate-card-mini", entity: entityId });
      this._miniCard = el;
      this._miniEntity = entityId;
    }
    (this._miniCard as HTMLElement & { hass?: HomeAssistant }).hass = this.hass;
    return this._miniCard;
  }

  private _renderThermostatSheet(): TemplateResult | typeof nothing {
    const entityId = this._thermostat;
    if (!entityId) return nothing;
    return html`
      <div
        class="scrim ${this._thermostatClosing ? "closing" : ""}"
        @click=${this._closeThermostat}
      >
        <div
          class="thermo-sheet ${this._thermostatClosing ? "closing" : ""}"
          role="dialog"
          aria-label=${this._thermostatName ?? entityId}
          @click=${(e: Event) => e.stopPropagation()}
        >
          <div class="thermo-head">
            <span class="thermo-title">${this._thermostatName ?? ""}</span>
            <button
              class="thermo-close"
              aria-label=${localize("room_close", this._language)}
              @click=${this._closeThermostat}
            >
              <ha-icon icon="mdi:close"></ha-icon>
            </button>
          </div>
          ${this._thermostatCard(entityId)}
        </div>
      </div>
    `;
  }

  private _defaultAction(kind: ActionKind): HaActionConfig {
    if (kind === "hold") return { action: "popup" };
    if (kind === "double_tap") return { action: "none" };
    return { action: "more-info" };
  }

  /** What a tap on the humidity strip does. `more-info` on the humidity's own
   * entity by default, which is the history the number came from; `none`
   * gives the strip back to the tile, so the whole tile taps as one again. */
  private _humidityAction(): HaActionConfig {
    return this._config?.humidity_tap_action ?? { action: "more-info" };
  }

  /** The strip is only its own target when there is something behind it and
   * somewhere to go — otherwise it stays plain text and the tile owns it. */
  private _humidityTappable(tile: ClimateOverviewTile): boolean {
    return (
      tile.hasHumidity &&
      tile.humidityOwnEntity &&
      !!tile.humidityEntity &&
      this._humidityAction().action !== "none"
    );
  }

  private _runHumidityAction(tile: ClimateOverviewTile): void {
    if (!this.hass) return;
    runHaAction(this.hass, this._humidityAction(), {
      entityId: tile.humidityEntity,
      openPopup: () => this._openPopup(tile),
      fireMoreInfo: (entityId) => fireEvent(this, "hass-more-info", { entityId }),
      navigate: (path) => navigateTo(this, path),
    });
  }

  private _resolveAction(kind: ActionKind): HaActionConfig {
    const cfg = this._config;
    const configured =
      kind === "tap" ? cfg?.tap_action : kind === "hold" ? cfg?.hold_action : cfg?.double_tap_action;
    return configured ?? this._defaultAction(kind);
  }

  private _runAction(tile: ClimateOverviewTile, kind: ActionKind): void {
    if (!this.hass) return;
    // tile_tap_action: "thermostat" is the older, narrower per-card knob for
    // "tap opens the room's thermostat sheet" — it only drives the *default*
    // tap; an explicit tap_action (the newer, more general mechanism) wins.
    if (kind === "tap" && !this._config?.tap_action && this._config?.tile_tap_action === "thermostat") {
      this._openThermostat(tile);
      return;
    }
    runHaAction(this.hass, this._resolveAction(kind), {
      entityId: tile.tapEntity,
      openPopup: () => this._openPopup(tile),
      fireMoreInfo: (entityId) => fireEvent(this, "hass-more-info", { entityId }),
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

  private _popupMode(): ClimateOverviewPopupMode {
    return this._config?.popup?.mode ?? "default-grid";
  }

  private _openPopup(tile: ClimateOverviewTile): void {
    // "default-detail" isn't a card popup at all — it's HA's own more-info
    // dialog for whatever the tile taps, so the internal <dialog> never opens.
    if (this._popupMode() === "default-detail") {
      fireEvent(this, "hass-more-info", { entityId: tile.tapEntity });
      return;
    }
    this._popupOpenedAt = Date.now();
    this._popupTile = tile;
  }

  /** Context handed to a configured `popup.card` skeleton's `[[token]]`
   * placeholders — see shared/card-template.ts. */
  private _tileTokens(tile: ClimateOverviewTile): CardTemplateTokens {
    return {
      area_id: tile.areaId,
      device_id: tile.deviceId,
      entity_id: tile.tapEntity,
      temperature_entity: tile.entity,
      humidity_entity: tile.humidityEntity,
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
  private _popupConfig(tile: ClimateOverviewTile): M3ClimateOverviewCardConfig | undefined {
    const cfg = this._config;
    if (!cfg) return undefined;
    const popup = cfg.popup ?? {};
    const merged = mergeEntityFilters(configFilter(cfg), popup, popup.inherit_filters ?? true);
    const scope: EntityFilterConfig = tile.areaId
      ? { include_area: [tile.areaId] }
      : { include_entities: [tile.entity, tile.tapEntity, tile.humidityEntity].filter((id): id is string => !!id) };
    return {
      ...cfg,
      ...merged,
      ...scope,
      rooms: undefined,
      auto_discover: true,
      sort: popup.sort ?? "name",
      // The popup's header carries the room name, so it stays unless the
      // popup config says otherwise — inheriting a hidden header would leave
      // the dialog with nothing identifying it.
      show_header: popup.show_header ?? true,
      name: popup.title || tile.name,
      // A popup inside a popup would be a trap with no way out.
      hold_action: { action: "more-info" },
      double_tap_action: undefined,
      popup: undefined,
      glass_background: false,
      type: "custom:m3-climate-overview-card",
    };
  }

  private _syncScopedPopupCard(tile: ClimateOverviewTile): HTMLElement | undefined {
    const { el, key } = syncPopupCardElement<M3ClimateOverviewCardConfig>({
      tagName: "m3-climate-overview-card",
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

  // The single most conspicuous room: whichever tile deviates furthest
  // outside the "comfortable" band (below the cool threshold, or at/above
  // the comfortable threshold) — coldest wins on the cold side, warmest on
  // the hot side. No chip when every room is within the comfortable band.
  private _outlierTile(
    tiles: ClimateOverviewTile[],
  ): { tile: ClimateOverviewTile; direction: "cold" | "hot" } | undefined {
    const t = this._tempThresholds();
    let best: { tile: ClimateOverviewTile; direction: "cold" | "hot"; deviation: number } | undefined;
    for (const tile of tiles) {
      if (tile.temperature === undefined) continue;
      if (tile.temperature < t.cool) {
        const deviation = t.cool - tile.temperature;
        if (!best || deviation > best.deviation) best = { tile, direction: "cold", deviation };
      } else if (tile.temperature >= t.comfortable) {
        const deviation = tile.temperature - t.comfortable;
        if (!best || deviation > best.deviation) best = { tile, direction: "hot", deviation };
      }
    }
    return best;
  }

  /**
   * Width of the comparison track in px, needed for the label-collision math
   * in shared/compare-scale.ts — a change written by CompareScaleTrack's
   * onChange callback, so Lit's normal @state reactivity re-renders it.
   */
  @state() private _trackWidth = 0;
  private _compareTrack = new CompareScaleTrack();

  private _renderCompareScale(tiles: ClimateOverviewTile[]) {
    return renderCompareScale({
      tiles: tiles.map((t) => ({ key: t.key, name: t.name, value: t.temperature, color: t.tempColor, entity: t.tapEntity })),
      trackWidthPx: this._trackWidth,
      configMin: this._config?.scale_min,
      configMax: this._config?.scale_max,
      minSpan: CLIMATE_OVERVIEW_SCALE_MIN_SPAN,
      fallbackMin: 16,
      fallbackMax: 26,
      unit: this._tempUnit(),
      formatValue: (v) => this._formatTempValue(v),
      title: this._t("climate_overview_compare"),
      showLabels: this._config?.show_scale_labels !== false,
      charPx: CLIMATE_OVERVIEW_LABEL_CHAR_PX,
      maxLabelPx: CLIMATE_OVERVIEW_LABEL_MAX_PX,
      gapPx: CLIMATE_OVERVIEW_LABEL_GAP_PX,
      gradientColors: [
        CLIMATE_OVERVIEW_COLOR_COLD,
        CLIMATE_OVERVIEW_COLOR_COOL,
        CLIMATE_OVERVIEW_COLOR_COMFORTABLE,
        CLIMATE_OVERVIEW_COLOR_WARM,
        CLIMATE_OVERVIEW_COLOR_HOT,
      ],
      onActivate: (t) => this._moreInfo(t.entity)(),
    });
  }

  private _watchedEntities(): (string | undefined)[] {
    const cfg = this._config;
    if (!cfg) return [];
    return cfg.rooms?.length
      ? cfg.rooms.flatMap((r) => [r.temperature_entity, r.humidity_entity, r.climate_entity])
      : this._discovered.flatMap((r) => [r.temperatureEntity, r.humidityEntity, r.climateEntity]);
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return discoveryChangeMatters(changed, this.hass, this._watchedEntities());
  }

  protected render() {
    if (!this._config || !this.hass) return nothing;

    const tiles = this._sortTiles(this._buildTiles());
    const validTemps = tiles.filter((t) => t.temperature !== undefined).map((t) => t.temperature!);
    const avgTemp = validTemps.length ? validTemps.reduce((a, b) => a + b, 0) / validTemps.length : undefined;

    const name = this._config.name || this._t("climate_overview_default_name");
    const icon = this._config.icon || DEFAULT_CLIMATE_OVERVIEW_ICON;
    const avgTempText = avgTemp !== undefined ? `${this._formatTempValue(avgTemp)} ${this._tempUnit()}` : "—";
    const subtitle =
      tiles.length === 0
        ? this._t("climate_overview_empty")
        : (tiles.length === 1
            ? this._t("climate_overview_subtitle_one")
            : this._t("climate_overview_subtitle").replace("{n}", String(tiles.length))
          ).replace("{temp}", avgTempText);

    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(this._config);
    const radius = resolveCornerRadius(this._config.radius ?? DEFAULT_CLIMATE_OVERVIEW_RADIUS, this._config.corners);
    const animClass = shouldAnimate(this._config.animation) ? "" : "no-animations";
    const outlier = this._config.show_outlier_chip !== false ? this._outlierTile(tiles) : undefined;

    // Only the grid is shortened. The outlier chip above and the comparison
    // scale below keep reading `tiles` — the whole set — because a "warmest
    // room" drawn from the first three would be a different claim, and a
    // quietly wrong one.
    const maxVisible = this._config.max_visible ?? 0;
    const visibleTiles =
      maxVisible > 0 && !this._showAllRooms ? tiles.slice(0, maxVisible) : tiles;
    const hiddenRooms = maxVisible > 0 ? Math.max(0, tiles.length - maxVisible) : 0;

    const accentColor = this._config.accent_color
      ? resolveThemeColor(this._config.accent_color)
      : "var(--primary-text-color)";

    // The glyph sits on this well, not on the card, so its contrast has to be
    // measured against the well.
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
          ${this._config.show_header === false
            ? nothing
            : renderCardHeader({
                icon,
                name,
                subtitle,
                right: outlier
                  ? html`
                      <div
                        class="outlier-chip"
                        style=${`background: ${tintOn(this, outlier.tile.tempColor, this._config.tile_tint_opacity, 18)}; color: ${tintInk(this, outlier.tile.tempColor, this._config.tile_tint_opacity, 18)};`}
                        role="button"
                        tabindex="0"
                        aria-label=${outlier.tile.name}
                        @click=${this._moreInfo(outlier.tile.tapEntity)}
                        @keydown=${activateOnKey(this._moreInfo(outlier.tile.tapEntity))}
                      >
                        <ha-icon icon=${outlier.direction === "cold" ? "mdi:snowflake" : "mdi:fire"}></ha-icon>
                        <span>${outlier.tile.name} ${this._formatTempValue(outlier.tile.temperature!)}°</span>
                      </div>
                    `
                  : undefined,
              })}

          ${tiles.length === 0
            ? html`<div class="empty-state">${this._t("climate_overview_empty")}</div>`
            : html`
                <div class="room-grid">${visibleTiles.map((t) => this._renderTile(t))}</div>
                ${hiddenRooms > 0
                  ? html`<button
                      class="rooms-toggle"
                      @click=${() => (this._showAllRooms = !this._showAllRooms)}
                    >
                      <span
                        >${this._showAllRooms
                          ? this._t("climate_overview_show_less")
                          : this._t("climate_overview_show_more").replace(
                              "{n}",
                              String(hiddenRooms),
                            )}</span
                      >
                      <ha-icon
                        class="chevron ${this._showAllRooms ? "open" : ""}"
                        icon="mdi:chevron-down"
                      ></ha-icon>
                    </button>`
                  : nothing}
              `}

          ${this._config.show_scale !== false ? this._renderCompareScale(tiles) : nothing}
          ${this._renderThermostatSheet()}
        </div>
        ${this._renderPopup()}
      </ha-card>
    `;
  }

  /**
   * The humidity strip along the bottom of a tile.
   *
   * Where the humidity has an entity of its own it is a second tap target
   * rather than decoration: the tile's two numbers come from two sensors, and
   * tapping a number should open the history *that* number came from. The
   * strip therefore reaches the tile's edges — the tile's padding is cancelled
   * and re-applied inside it — so the target is the full width of the tile and
   * everything below the temperature, not the 10px line of text itself.
   *
   * Its gesture handlers stop propagation at the pointer events, so the tile's
   * own gesture never starts; a hold is passed through to the tile's hold
   * action, so the only thing that differs between the two zones is the tap.
   */
  private _renderHumidity(tile: ClimateOverviewTile, humidity: { color: string; opacity: string }) {
    const text = tile.humidityUnavailable
      ? this._t("climate_overview_unavailable")
      : `${Math.round(tile.humidity!)} %`;
    const body = html`
      <ha-icon icon="mdi:water-outline"></ha-icon>
      <span>${text}</span>
    `;
    const style = `color: ${humidity.color}; opacity: ${humidity.opacity};`;

    if (!this._humidityTappable(tile)) {
      return html`<div class="tile-humidity" style=${style}>${body}</div>`;
    }

    const holdAction = this._resolveAction("hold");
    const listeners = this._humidityGestures.listeners({
      onTap: () => this._runHumidityAction(tile),
      onHold: holdAction.action === "none" ? undefined : () => this._runAction(tile, "hold"),
      onPressChange: (pressed) => {
        this._pressedHumidityKey = pressed ? tile.key : undefined;
      },
    });
    // Swallowed before the tile sees them: the tile's gesture binds the same
    // events one level up, and both firing would run two actions on one tap.
    const own = <T extends Event>(handler: (event: T) => void) => (event: T) => {
      event.stopPropagation();
      handler(event);
    };

    return html`
      <div
        class="tile-humidity tappable ${this._pressedHumidityKey === tile.key ? "pressed" : ""}"
        style=${style}
        role="button"
        tabindex="0"
        aria-label=${`${tile.name} — ${this._t("chip_humidity")}`}
        @pointerdown=${own(listeners["@pointerdown"])}
        @pointermove=${own(listeners["@pointermove"])}
        @pointerup=${own(listeners["@pointerup"])}
        @pointercancel=${own(listeners["@pointercancel"])}
        @contextmenu=${own(listeners["@contextmenu"])}
        @keydown=${own(listeners["@keydown"])}
      >
        ${body}
      </div>
    `;
  }

  private _renderTile(tile: ClimateOverviewTile) {
    const humidity = this._humidityDisplay(tile);
    const trendDelta = this._trendDelta(tile);
    const moldRisk = this._moldRisk(tile);
    const holdAction = this._resolveAction("hold");
    const hasDoubleTap = (this._config?.double_tap_action?.action ?? "none") !== "none";
    const listeners = this._gestures.listeners({
      onTap: () => this._runAction(tile, "tap"),
      onHold: holdAction.action === "none" ? undefined : () => this._runAction(tile, "hold"),
      onDoubleTap: hasDoubleTap ? () => this._runAction(tile, "double_tap") : undefined,
      onPressChange: (pressed) => {
        this._pressedKey = pressed ? tile.key : undefined;
      },
    });
    return html`
      <div
        class="room-tile ${tile.temperatureUnavailable ? "unavailable" : ""} ${this._pressedKey === tile.key
          ? "pressed"
          : ""}"
        style=${`--tile-color: ${tile.tempColor}; --tile-ink: ${tintInk(this, tile.tempColor, this._config?.tile_tint_opacity, 12)}; background: ${tintOn(this, tile.tempColor, this._config?.tile_tint_opacity, 12)};`}
        role="button"
        tabindex="0"
        aria-label=${tile.name}
        title=${tile.name}
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
          ${moldRisk
            ? html`
                <ha-icon
                  class="mold-icon"
                  icon="mdi:water-alert-outline"
                  title=${this._t("climate_overview_mold_risk")}
                ></ha-icon>
              `
            : nothing}
        </div>
        <div class="tile-temp">
          ${tile.temperatureUnavailable
            ? html`<span class="temp-value">${this._t("climate_overview_unavailable")}</span>`
            : html`
                <span class="temp-value">${this._formatTempValue(tile.temperature!)}</span>
                <span class="temp-unit">${this._tempUnit()}</span>
                ${trendDelta !== undefined
                  ? html`
                      <ha-icon
                        class="trend-icon"
                        icon=${trendDelta > 0 ? "mdi:arrow-up-thin" : "mdi:arrow-down-thin"}
                      ></ha-icon>
                    `
                  : nothing}
              `}
        </div>
        ${tile.hasHumidity ? this._renderHumidity(tile, humidity) : nothing}
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
        grid-template-columns: repeat(auto-fit, minmax(${CLIMATE_OVERVIEW_GRID_MIN_COL}px, 1fr));
        gap: ${CLIMATE_OVERVIEW_GRID_GAP}px;
      }

      .room-tile {
        padding: 11px 9px;
        border-radius: ${CLIMATE_OVERVIEW_TILE_RADIUS}px;
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
      }

      .tile-header {
        display: flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
      }

      .tile-header ha-icon {
        --mdc-icon-size: 13px;
        color: var(--tile-ink, var(--tile-color));
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

      .mold-icon {
        --mdc-icon-size: 11px;
        flex-shrink: 0;
        margin-left: auto;
        color: ${unsafeCSS(CLIMATE_OVERVIEW_HUMIDITY_WARN_COLOR)};
      }

      .tile-temp {
        display: flex;
        align-items: baseline;
        gap: 1px;
      }

      .trend-icon {
        --mdc-icon-size: 12px;
        color: var(--tile-ink, var(--tile-color));
        opacity: 0.8;
        margin-left: 2px;
        align-self: center;
      }

      .temp-value {
        font-size: 21px;
        font-weight: 700;
        color: var(--tile-ink, var(--tile-color));
      }

      .temp-unit {
        font-size: 11px;
        font-weight: 500;
        color: var(--tile-ink, var(--tile-color));
      }

      .tile-humidity {
        display: flex;
        align-items: center;
        gap: 3px;
        font-size: 10px;
        font-weight: 500;
      }

      /* A 10px line of text is not a tap target. The strip cancels the tile's
         own padding and re-applies it inside itself, so it reaches the tile's
         left, right and bottom edges: everything below the temperature taps
         the humidity, and the rest of the tile still taps the temperature.
         The auto top margin pins it to the bottom even on a short tile. */
      .tile-humidity.tappable {
        margin: auto -9px -11px;
        padding: 7px 9px 11px;
        border-radius: 0 0 ${CLIMATE_OVERVIEW_TILE_RADIUS}px ${CLIMATE_OVERVIEW_TILE_RADIUS}px;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition: background-color 120ms ease-out;
      }

      /* The tile answers a press by scaling; a zone inside it cannot do that
         without dragging the tile's own corners around, so it darkens. */
      .tile-humidity.tappable.pressed {
        background: color-mix(in srgb, var(--tile-ink, var(--tile-color)) 14%, transparent);
      }

      .no-animations .tile-humidity.tappable {
        transition: none;
      }

      .tile-humidity.tappable:focus-visible {
        outline: 2px solid var(--tile-color);
        outline-offset: -2px;
      }

      .tile-humidity ha-icon {
        --mdc-icon-size: 11px;
      }

      .outlier-chip {
        flex-shrink: 0;
        height: 30px;
        max-width: 150px;
        padding: 0 10px;
        border-radius: ${CLIMATE_OVERVIEW_CHIP_RADIUS}px;
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
      }

      .outlier-chip ha-icon {
        --mdc-icon-size: 16px;
        flex-shrink: 0;
      }

      .outlier-chip span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .empty-state {
        text-align: center;
        font-size: 13px;
        opacity: 0.6;
        padding: 16px 0;
        color: var(--m3p-secondary-text);
      }

      .rooms-toggle {
        width: 100%;
        height: 44px;
        border: none;
        border-radius: 14px;
        cursor: pointer;
        background: color-mix(in srgb, var(--primary-text-color) 6%, var(--ha-card-background, var(--card-background-color)));
        color: var(--m3p-secondary-text);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-size: 13px;
        font-family: inherit;
      }

      .rooms-toggle .chevron {
        --mdc-icon-size: 18px;
        transition: transform 200ms ${EASING};
      }

      .rooms-toggle .chevron.open {
        transform: rotate(180deg);
      }

      .no-animations .rooms-toggle .chevron {
        transition: none;
      }

      /* ---- thermostat sheet ---- */

      .card-inner {
        position: relative;
      }

      .scrim {
        position: absolute;
        inset: 0;
        z-index: 5;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 8px;
        background: rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(3px);
        -webkit-backdrop-filter: blur(3px);
        animation: thermo-fade ${unsafeCSS(CLIMATE_SHEET_MS)}ms ${EASING} both;
      }

      .scrim.closing {
        animation: thermo-fade ${unsafeCSS(CLIMATE_SHEET_MS)}ms ${EASING} reverse both;
      }

      /* The thermostat keeps its own card frame and simply floats on the
         scrim. Wrapping it in a second panel would put one card border inside
         another, which reads as a mistake. */
      .thermo-sheet {
        width: 100%;
        /* Wide enough that the thermostat's own controls stay finger-sized:
           at 340px the minus/plus pair and the target temperature were sharing
           a row barely wider than the tile that opened them. */
        max-width: 420px;
        max-height: 100%;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 6px;
        animation: thermo-rise ${unsafeCSS(CLIMATE_SHEET_MS)}ms ${EASING} both;
      }

      .thermo-sheet.closing {
        animation: thermo-rise ${unsafeCSS(CLIMATE_SHEET_MS)}ms ${EASING} reverse both;
      }

      @keyframes thermo-fade {
        from {
          opacity: 0;
        }
      }

      @keyframes thermo-rise {
        from {
          transform: translateY(12px) scale(0.96);
          opacity: 0;
        }
      }

      .thermo-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 4px;
      }

      .thermo-title {
        flex: 1;
        min-width: 0;
        font-size: 13px;
        font-weight: 700;
        color: #fff;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .thermo-close {
        flex-shrink: 0;
        width: 30px;
        height: 30px;
        border: none;
        border-radius: 15px;
        background: rgba(255, 255, 255, 0.16);
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        --mdc-icon-size: 18px;
        transition:
          transform ${unsafeCSS(CLIMATE_SHEET_MS)}ms ${EASING},
          border-radius ${unsafeCSS(CLIMATE_SHEET_MS)}ms ${EASING},
          background ${unsafeCSS(CLIMATE_SHEET_MS)}ms ${EASING},
          opacity ${unsafeCSS(CLIMATE_SHEET_MS)}ms ${EASING};
      }

      .thermo-close:hover {
        background: rgba(255, 255, 255, 0.26);
      }

      /* The circle squares off under the finger, the house idiom for a press. */
      .thermo-close:active {
        border-radius: 9px;
        transform: scale(0.9);
      }

      /* On the way out it turns a quarter and leaves with the sheet, so the
         thing that was pressed is visibly the thing that closed it. */
      .thermo-sheet.closing .thermo-close {
        transform: rotate(90deg) scale(0.8);
        border-radius: 9px;
        opacity: 0;
      }

      .thermo-close:focus-visible {
        outline: 2px solid #fff;
        outline-offset: 2px;
      }

      .no-animations .scrim,
      .no-animations .thermo-sheet {
        animation: none;
      }

      .no-animations .thermo-close {
        transition: none;
      }

  /* Safari gained color-mix() in 16.2, and an iPod touch 7 or an iPad Air 2
     stops at iOS 15. A plain declaration before each mix cannot serve as the
     fallback: every one of them contains var(), which defers the check until
     after substitution, where failure yields unset rather than the previous
     declaration — the tint did not fade, the fill disappeared entirely. This
     block is the one those browsers alone can see; the tint is what it gives
     up. Backticks are not allowed in here: this is a css template literal. */
  @supports not (color: color-mix(in srgb, red 50%, blue)) {
    .rooms-toggle {
      background: var(--ha-card-background, var(--card-background-color));
    }
  }
  `,
    compareScaleStyles({
      dotSizePx: CLIMATE_OVERVIEW_DOT_SIZE,
      dotRadiusPx: CLIMATE_OVERVIEW_DOT_RADIUS,
      dotTransitionMs: CLIMATE_OVERVIEW_DOT_TRANSITION_MS,
      easing: STANDARD_EASING,
    }),
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-climate-overview-card": M3ClimateOverviewCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-climate-overview-card",
  name: "M3 Climate Overview Card",
  description:
    "Eine Material-3-Übersicht aller Raumklima-Sensoren, automatisch nach Bereich gruppiert.",
  // false: HA's "Add card" dialog builds a real, hass-wired element of every
  // registered type just to draw its preview thumbnail. This card discovers
  // its entities as soon as it sees a hass, so leaving the preview on runs a
  // full-house scan for everyone who opens that dialog.
  preview: false,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
