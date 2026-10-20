import { LitElement, html, css, nothing, unsafeCSS, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  M3AquariumCardConfig,
  AquariumDeviceConfig,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  HassEntity,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_AQUARIUM_RADIUS,
  DEFAULT_AQUARIUM_ICON,
  DEFAULT_AQUARIUM_ACCENT,
  DEFAULT_AQUARIUM_TARGET_RANGE,
  DEFAULT_AQUARIUM_CLEANING_INTERVAL_DAYS,
  DEFAULT_AQUARIUM_CAMERA_REFRESH_S,
  DEFAULT_AQUARIUM_DEVICE_COLORS,
  AQUARIUM_HEADER_ICON_SIZE,
  AQUARIUM_HEADER_ICON_RADIUS,
  AQUARIUM_TILE_GAP,
  AQUARIUM_TILE_MIN_COL,
  AQUARIUM_TILE_RADIUS_OFF,
  AQUARIUM_TILE_RADIUS_ON,
  AQUARIUM_TILE_ICON_BOX,
  AQUARIUM_TILE_ICON_RADIUS_OFF,
  AQUARIUM_TILE_ICON_RADIUS_ON,
  AQUARIUM_TILE_MORPH_MS,
  AQUARIUM_WATER_COLOR_OK,
  AQUARIUM_WATER_COLOR_BELOW,
  AQUARIUM_WATER_COLOR_ABOVE,
  AQUARIUM_WATER_COLOR_WARN,
  AQUARIUM_WATER_WARN_DEVIATION_K,
  AQUARIUM_SCHEDULE_TRACK_HEIGHT,
  AQUARIUM_SCHEDULE_TRACK_RADIUS,
  AQUARIUM_SCHEDULE_MARKER_WIDTH,
  AQUARIUM_SCHEDULE_GAP,
  AQUARIUM_SCHEDULE_INSET,
  AQUARIUM_SCHEDULE_MARKER_HEIGHT,
  AQUARIUM_SCHEDULE_MARKER_RADIUS,
  AQUARIUM_SCHEDULE_REFRESH_MS,
  AQUARIUM_CAMERA_BANNER_RADIUS,
  AQUARIUM_CAMERA_BANNER_PADDING,
  AQUARIUM_CAMERA_THUMB_SIZE,
  AQUARIUM_CAMERA_THUMB_RADIUS,
  AQUARIUM_CAMERA_THUMB_RADIUS_ACTIVE,
  AQUARIUM_CAMERA_LIVE_DOT_SIZE,
  AQUARIUM_CAMERA_EXPAND_MS,
  AQUARIUM_CAMERA_BADGE_HEIGHT,
  AQUARIUM_CAMERA_BADGE_RADIUS,
  AQUARIUM_CAMERA_CHIP_HEIGHT,
  AQUARIUM_CAMERA_CHIP_RADIUS,
  AQUARIUM_CHIP_HEIGHT,
  AQUARIUM_CHIP_RADIUS,
  AQUARIUM_CHIP_MAX,
  ACTIVE_STATES,
  resolveCornerRadius,
} from "./const";
import { resolveThemeColor, resolveCommonColors, buildCssVars, tintOn, tintInk } from "./shared/color-config";
import { glassCardStyles, glassCardClass } from "./shared/glass-card";
import { shouldAnimate, STANDARD_EASING } from "./shared/animation";
import { activateOnKey } from "./shared/a11y";
import { fireEvent } from "./shared/editor-helpers";
import { formatNumber } from "./shared/formatting";
import { localize, type TranslationKey } from "./localize";
import { hassChangeMatters } from "./shared/should-update";
import { TemplatedCard } from "./shared/templated-card";

console.info(
  `%c M3-AQUARIUM-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #5dcaa5; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #5dcaa5; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

const HOLD_DURATION_MS = 500;
const EASING = unsafeCSS(STANDARD_EASING);

// Domains with no meaningful persistent on/off state — tapping them fires a
// one-shot action instead of a toggle, and their tile never shows the
// "active" color (there's nothing ongoing to represent). input_datetime is
// included for the "last cleaned" use case: tapping logs "now" rather than
// toggling a boolean.
const MOMENTARY_DOMAINS = new Set(["button", "input_button", "scene", "script", "input_datetime"]);

const MOMENTARY_SERVICE: Record<string, string> = {
  button: "press",
  input_button: "press",
  scene: "turn_on",
  script: "turn_on",
};

interface AquariumSlotDef {
  key: string;
  labelKey?: TranslationKey;
  fallbackName: string;
  fallbackIcon: string;
  defaultColor: string;
}

const FIXED_SLOTS: AquariumSlotDef[] = [
  { key: "light_day", fallbackName: "Tag", fallbackIcon: "mdi:white-balance-sunny", defaultColor: DEFAULT_AQUARIUM_DEVICE_COLORS.light_day },
  { key: "light_night", fallbackName: "Nacht", fallbackIcon: "mdi:weather-night", defaultColor: DEFAULT_AQUARIUM_DEVICE_COLORS.light_night },
  { key: "pump", fallbackName: "Pumpe", fallbackIcon: "mdi:pump", defaultColor: DEFAULT_AQUARIUM_DEVICE_COLORS.pump },
  { key: "heater", fallbackName: "Heizer", fallbackIcon: "mdi:radiator", defaultColor: DEFAULT_AQUARIUM_DEVICE_COLORS.heater },
  { key: "co2", fallbackName: "CO₂", fallbackIcon: "mdi:molecule-co2", defaultColor: DEFAULT_AQUARIUM_DEVICE_COLORS.co2 },
];

interface AquariumPhase {
  device: string;
  startMin: number;
  endMin: number;
  color: string;
}

interface AquariumChip {
  key: string;
  icon?: string;
  text: string;
  warn: boolean;
}

interface AquariumTile {
  key: string;
  entity: string;
  name: string;
  icon: string;
  color: string;
  domain: string;
  momentary: boolean;
  unavailable: boolean;
  active: boolean;
  secondary: string;
}

@customElement("m3-aquarium-card")
export class M3AquariumCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3AquariumCardConfig;
  @state() private _cameraLoaded = false;
  @state() private _cameraError = false;
  @state() private _cameraExpanded = false;
  @state() private _cameraTick = 0;

  private _holdTimer?: number;
  private _holdTriggered = false;
  private _scheduleRefreshTimer?: number;
  private _cameraRefreshTimer?: number;
  private _cameraRefreshKey?: string;
  private _cardVisible = true;
  private _visibilityObserver?: IntersectionObserver;
  private _onDocVisibilityChange = (): void => {
    // No immediate action needed — the refresh timer itself checks
    // document.hidden right before each tick, this listener just exists so
    // the guard reflects the current tab state rather than only the state
    // at connect time.
  };

  public connectedCallback(): void {
    super.connectedCallback();
    // The day-arc and its "Tagphase · noch N Std." status line are computed
    // fresh from Date.now() on every render() — this timer just forces a
    // render each minute so they don't go stale while the tab stays open.
    this._scheduleRefreshTimer = window.setInterval(() => {
      this.requestUpdate();
    }, AQUARIUM_SCHEDULE_REFRESH_MS);
    document.addEventListener("visibilitychange", this._onDocVisibilityChange);
    this._visibilityObserver = new IntersectionObserver((entries) => {
      this._cardVisible = entries[entries.length - 1]?.isIntersecting ?? true;
    });
    this._visibilityObserver.observe(this);
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._scheduleRefreshTimer !== undefined) {
      window.clearInterval(this._scheduleRefreshTimer);
      this._scheduleRefreshTimer = undefined;
    }
    if (this._cameraRefreshTimer !== undefined) {
      window.clearInterval(this._cameraRefreshTimer);
      this._cameraRefreshTimer = undefined;
    }
    document.removeEventListener("visibilitychange", this._onDocVisibilityChange);
    this._visibilityObserver?.disconnect();
    this._visibilityObserver = undefined;
  }

  protected updated(changed: Map<string, unknown>): void {
    super.updated(changed);
    this._syncCameraTimer();
  }

  // Recreates the still-image refresh interval whenever the camera entity
  // or the configured refresh period changes — never on every render (the
  // key check makes this a no-op on unrelated re-renders, e.g. a tile
  // toggling or the minute-tick from the schedule timer above).
  private _syncCameraTimer(): void {
    const refreshS = this._config?.camera_refresh ?? DEFAULT_AQUARIUM_CAMERA_REFRESH_S;
    const entityId = this._config?.camera_entity;
    const style = this._config?.camera_style;
    const key = `${entityId ?? ""}:${refreshS}:${style ?? ""}`;
    if (key === this._cameraRefreshKey) return;
    this._cameraRefreshKey = key;
    if (this._cameraRefreshTimer !== undefined) {
      window.clearInterval(this._cameraRefreshTimer);
      this._cameraRefreshTimer = undefined;
    }
    // "live" embeds an actual video stream (see _renderCameraLive) — there's
    // no still image to periodically refresh in that mode.
    if (!entityId || refreshS <= 0 || style === "live") return;
    this._cameraRefreshTimer = window.setInterval(() => {
      if (!this._cardVisible || document.hidden) return;
      this._cameraLoaded = false;
      this._cameraError = false;
      this._cameraTick++;
    }, refreshS * 1000);
  }

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-aquarium-card-editor");
    return document.createElement("m3-aquarium-card-editor") as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(hass: HomeAssistant): M3AquariumCardConfig {
    const states = hass?.states ?? {};
    const aquaEntities = Object.keys(states).filter((id) => id.toLowerCase().includes("aqua"));
    const nameOf = (id: string) => (states[id]?.attributes.friendly_name || id).toLowerCase();

    // Matches against the friendly name, not the entity_id: this repo's
    // real-world naming has automations ("aqualicht_tag_an_12_uhr") and
    // diagnostic sub-entities (power-on-behavior selects) sharing the same
    // "aqua"/"licht_tag" substrings as the actual switch — the human-facing
    // name ("Aqualicht WZ Tag") is what's actually reliable to match on.
    const usedIds = new Set<string>();
    const pickAll = (domains: string[], ...termSets: string[][]): AquariumDeviceConfig | undefined => {
      for (const id of aquaEntities) {
        if (usedIds.has(id)) continue;
        if (!domains.includes(id.split(".")[0])) continue;
        const name = nameOf(id);
        if (termSets.some((terms) => terms.every((t) => name.includes(t)))) {
          usedIds.add(id);
          return { entity: id };
        }
      }
      return undefined;
    };

    const waterTemp = aquaEntities.find(
      (id) => id.startsWith("sensor.") && states[id]?.attributes.device_class === "temperature",
    );
    // Claim the temp sensor early so it can't also be picked as a device
    // slot (device_class sensors never match the switch/light domain filter
    // anyway, but this keeps the exclusion logic consistent either way).
    if (waterTemp) usedIds.add(waterTemp);

    const lightDomains = ["light", "switch"];
    return {
      type: "custom:m3-aquarium-card",
      name: "Aquarium",
      water_temperature_entity: waterTemp,
      light_day: pickAll(lightDomains, ["licht", "tag"]),
      light_night: pickAll(lightDomains, ["licht", "nacht"]),
      heater: pickAll(lightDomains, ["heiz"]),
      co2: pickAll(lightDomains, ["co2"]),
      pump: pickAll(lightDomains, ["pumpe"]),
      camera_entity: pickAll(["camera"], ["aqua"], ["kamera"])?.entity,
      glass_background: true,
    };
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return hassChangeMatters(changed, this.hass, [
      this._config?.water_temperature_entity,
      this._config?.heater_power_entity,
      this._config?.ph_entity,
      this._config?.tds_entity,
      this._config?.power_entity,
      this._config?.water_level_entity,
      this._config?.cleaning_entity,
      this._config?.cleaning_interval_entity,
      this._config?.camera_entity,
      this._config?.schedule_entity,
    ]);
  }

  public setConfig(config: M3AquariumCardConfig): void {
    this._config = {
      glass_background: true,
      animation: "auto",
      target_range: DEFAULT_AQUARIUM_TARGET_RANGE,
      cleaning_interval: DEFAULT_AQUARIUM_CLEANING_INTERVAL_DAYS,
      camera_style: "none",
      camera_refresh: DEFAULT_AQUARIUM_CAMERA_REFRESH_S,
      camera_live_on_tap: true,
      show_schedule: true,
      ...config,
    };
  }

  public getCardSize(): number {
    return 3;
  }

  public getGridOptions(): LovelaceGridOptions {
    return {
      columns: 12,
      rows: "auto",
      min_columns: 6,
      min_rows: 3,
    };
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _resolveColor(color: string | undefined, fallback: string): string {
    return color ? resolveThemeColor(color) : fallback;
  }

  private _domain(entityId: string): string {
    return entityId.split(".")[0] ?? "";
  }

  private _isActive(entity: HassEntity | undefined, domain: string): boolean {
    if (!entity || MOMENTARY_DOMAINS.has(domain)) return false;
    return ACTIVE_STATES.has(entity.state);
  }

  // input_datetime's own state (set via the tile's tap action, see below)
  // doubles as a lightweight "last cleaned" log — no separate history/
  // notification integration needed. Shows a plain days-ago count; the
  // "Säubern fällig" warning coloring is chip-row logic (later build step).
  private _daysAgoLabel(entity: HassEntity | undefined): string {
    if (!entity || entity.state === "unavailable" || entity.state === "unknown") return "—";
    const date = new Date(entity.state);
    if (Number.isNaN(date.getTime())) return "—";
    const days = Math.floor((Date.now() - date.getTime()) / 86400000);
    if (days <= 0) return this._t("aquarium_cleaned_today");
    return this._t("aquarium_cleaned_days_ago").replace("{n}", String(days));
  }

  private _defaultTapAction(tile: AquariumTile): void {
    if (!this.hass) return;
    if (tile.domain === "input_datetime") {
      const now = new Date();
      this.hass.callService("input_datetime", "set_datetime", {
        entity_id: tile.entity,
        date: now.toISOString().slice(0, 10),
        time: now.toTimeString().slice(0, 8),
      });
      return;
    }
    if (tile.momentary) {
      const service = MOMENTARY_SERVICE[tile.domain] ?? "turn_on";
      this.hass.callService(tile.domain, service, { entity_id: tile.entity });
      return;
    }
    this.hass.callService("homeassistant", "toggle", { entity_id: tile.entity });
  }

  private _fireMoreInfo(entityId: string): void {
    fireEvent(this, "hass-more-info", { entityId });
  }

  private _onTilePointerDown = (tile: AquariumTile): ((e: PointerEvent) => void) => {
    return () => {
      if (tile.unavailable) return;
      this._holdTriggered = false;
      window.clearTimeout(this._holdTimer);
      this._holdTimer = window.setTimeout(() => {
        this._holdTriggered = true;
        this._fireMoreInfo(tile.entity);
      }, HOLD_DURATION_MS);
    };
  };

  private _onTilePointerUp = (): void => {
    window.clearTimeout(this._holdTimer);
  };

  private _onTileClick = (tile: AquariumTile): ((e: Event) => void) => {
    return () => {
      if (tile.unavailable) return;
      if (this._holdTriggered) {
        this._holdTriggered = false;
        return;
      }
      this._defaultTapAction(tile);
    };
  };

  private _buildSlotTile(slot: AquariumSlotDef, cfg: AquariumDeviceConfig | undefined): AquariumTile | undefined {
    if (!cfg?.entity || !this.hass) return undefined;
    return this._buildTile(cfg, slot.fallbackName, slot.fallbackIcon, slot.defaultColor);
  }

  // `fallbackName` wins over the entity's own friendly_name for the fixed
  // slots (Tag/Nacht/Pumpe/...) and cleaning tile — those already have a
  // short, generic label that reads better in a ~90px tile than e.g.
  // "Steckdose 13 - Aqualicht WZ Tag". Passing `undefined` (extra_devices,
  // which have no generic label) falls through to the friendly_name instead.
  private _buildTile(
    cfg: AquariumDeviceConfig,
    fallbackName: string | undefined,
    fallbackIcon: string,
    defaultColor: string,
  ): AquariumTile {
    const entity = this.hass!.states[cfg.entity];
    const domain = this._domain(cfg.entity);
    const momentary = MOMENTARY_DOMAINS.has(domain);
    const unavailable = !entity || entity.state === "unavailable";
    const active = this._isActive(entity, domain);
    const secondary =
      domain === "input_datetime"
        ? this._daysAgoLabel(entity)
        : momentary
          ? this._t("aquarium_action_start")
          : this._t(active ? "aquarium_state_on" : "off");
    return {
      key: cfg.entity,
      entity: cfg.entity,
      name: cfg.name || fallbackName || entity?.attributes.friendly_name || cfg.entity,
      icon: cfg.icon || fallbackIcon,
      color: this._resolveColor(cfg.color, defaultColor),
      domain,
      momentary,
      unavailable,
      active,
      secondary,
    };
  }

  private _buildTiles(): AquariumTile[] {
    if (!this.hass || !this._config) return [];
    const tiles: AquariumTile[] = [];
    for (const slot of FIXED_SLOTS) {
      const cfg = this._config[slot.key as keyof M3AquariumCardConfig] as AquariumDeviceConfig | undefined;
      const tile = this._buildSlotTile(slot, cfg);
      if (tile) tiles.push(tile);
    }
    if (this._config.cleaning_entity) {
      tiles.push(
        this._buildTile(
          { entity: this._config.cleaning_entity },
          "Säubern",
          "mdi:water-sync",
          DEFAULT_AQUARIUM_DEVICE_COLORS.cleaning,
        ),
      );
    }
    for (const extra of this._config.extra_devices ?? []) {
      if (!extra.entity) continue;
      tiles.push(this._buildTile(extra, undefined, "mdi:power-socket-eu", DEFAULT_AQUARIUM_ACCENT));
    }
    return tiles;
  }

  private _waterTemp(): { value: number; unavailable: boolean } | undefined {
    const entityId = this._config?.water_temperature_entity;
    if (!entityId || !this.hass) return undefined;
    const entity = this.hass.states[entityId];
    if (!entity) return undefined;
    if (entity.state === "unavailable" || entity.state === "unknown") {
      return { value: NaN, unavailable: true };
    }
    const value = parseFloat(entity.state);
    if (Number.isNaN(value)) return undefined;
    return { value, unavailable: false };
  }

  private _waterColor(value: number): string {
    const [lo, hi] = this._config?.target_range ?? DEFAULT_AQUARIUM_TARGET_RANGE;
    if (value >= lo && value <= hi) return AQUARIUM_WATER_COLOR_OK;
    const deviation = value < lo ? lo - value : value - hi;
    if (deviation >= AQUARIUM_WATER_WARN_DEVIATION_K) return AQUARIUM_WATER_COLOR_WARN;
    return value < lo ? AQUARIUM_WATER_COLOR_BELOW : AQUARIUM_WATER_COLOR_ABOVE;
  }

  private _cameraEntity(): HassEntity | undefined {
    const entityId = this._config?.camera_entity;
    return entityId ? this.hass?.states[entityId] : undefined;
  }

  private _cameraAvailable(): boolean {
    const entity = this._cameraEntity();
    return !!entity && entity.state !== "unavailable";
  }

  // Built fresh from the entity's own `access_token` attribute (HA rotates
  // it periodically) plus a manual cache-bust counter — the token alone
  // isn't enough to force a reload between rotations, since the browser
  // would otherwise just serve the previous still frame from cache.
  private _cameraImageUrl(): string | undefined {
    const entity = this._cameraEntity();
    const entityId = this._config?.camera_entity;
    const token = entity?.attributes.access_token;
    if (!entityId || !token) return undefined;
    return `/api/camera_proxy/${entityId}?token=${token}&t=${this._cameraTick}`;
  }

  private _onCameraImgLoad = (): void => {
    this._cameraLoaded = true;
    this._cameraError = false;
  };

  private _onCameraImgError = (): void => {
    this._cameraError = true;
  };

  private _onCameraStreamTap = (): void => {
    if (this._config?.camera_live_on_tap === false) return;
    const entityId = this._config?.camera_entity;
    if (entityId) this._fireMoreInfo(entityId);
  };

  private _onThumbnailTap = (e: Event): void => {
    e.stopPropagation();
    this._cameraExpanded = !this._cameraExpanded;
  };

  private _renderCameraPlaceholder(errored: boolean) {
    return html`
      <div class="camera-placeholder">
        <ha-icon icon=${errored ? "mdi:camera-off-outline" : "mdi:camera-outline"}></ha-icon>
        ${errored ? html`<span>${this._t("aquarium_camera_no_image")}</span>` : nothing}
      </div>
    `;
  }

  private _renderCameraImg(extraClass: string) {
    const url = this._cameraImageUrl();
    const ready = this._cameraLoaded && !this._cameraError;
    return html`
      ${!ready ? this._renderCameraPlaceholder(this._cameraError) : nothing}
      ${url
        ? html`<img
            class="camera-img ${extraClass}"
            src=${url}
            style=${`opacity: ${ready ? 1 : 0};`}
            alt=""
            @load=${this._onCameraImgLoad}
            @error=${this._onCameraImgError}
          />`
        : nothing}
    `;
  }

  private _renderCameraBanner(name: string, statusLine: string, waterText: string | undefined) {
    return this._renderCameraBannerChrome(name, statusLine, waterText, this._renderCameraImg(""));
  }

  // A real embedded stream instead of a periodically-refreshed still image
  // — HA's own <ha-camera-stream> (already registered globally by the
  // frontend, no import needed here) picks HLS vs WebRTC automatically.
  // Deliberately opt-in only (camera_style: "live"): unlike the still-image
  // styles, this keeps a stream open for as long as the card is mounted,
  // which is the exact cost the "NIEMALS dauerhaft einen Stream öffnen"
  // design rule was written to avoid — so it's the user's explicit choice
  // per card, not a default.
  private _renderCameraLive(name: string, statusLine: string, waterText: string | undefined) {
    const entity = this._cameraEntity();
    const content = entity
      ? html`<ha-camera-stream
          .hass=${this.hass}
          .stateObj=${entity}
          .controls=${false}
          .muted=${true}
        ></ha-camera-stream>`
      : this._renderCameraPlaceholder(false);
    return this._renderCameraBannerChrome(name, statusLine, waterText, content);
  }

  private _renderCameraBannerChrome(
    name: string,
    statusLine: string,
    waterText: string | undefined,
    content: unknown,
  ) {
    return html`
      <div
        class="camera-media camera-banner"
        role="button"
        tabindex="0"
        aria-label=${name}
        @click=${this._onCameraStreamTap}
        @keydown=${activateOnKey(this._onCameraStreamTap)}
      >
        ${content}
        <div class="camera-gradient"></div>
        <div class="camera-badge-live">
          <span class="live-dot"></span>${this._t("aquarium_live")}
        </div>
        ${waterText ? html`<div class="camera-chip-temp">${waterText}</div>` : nothing}
        <div class="camera-caption">
          <div class="camera-caption-name">${name}</div>
          <div class="camera-caption-status">${statusLine}</div>
        </div>
      </div>
    `;
  }

  private _renderCameraThumbnail() {
    return html`
      <div
        class="thumb-wrap ${this._cameraExpanded ? "active" : ""}"
        role="button"
        tabindex="0"
        aria-label=${this._t("aquarium_camera_toggle")}
        @click=${this._onThumbnailTap}
        @keydown=${activateOnKey(this._onThumbnailTap)}
      >
        ${this._renderCameraImg("thumb-img")}
        <span class="live-dot thumb-live-dot"></span>
      </div>
    `;
  }

  private _renderCameraExpanded() {
    return html`
      <div class="camera-expand-wrap ${this._cameraExpanded ? "open" : ""}">
        <div class="camera-expand-inner">
          <div
            class="camera-media camera-expand-media"
            role="button"
            tabindex="0"
            aria-label=${this._t("aquarium_live")}
            @click=${this._onCameraStreamTap}
            @keydown=${activateOnKey(this._onCameraStreamTap)}
          >
            ${this._renderCameraImg("")}
            <div class="camera-badge-live">
              <span class="live-dot"></span>${this._t("aquarium_live")}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private _numericState(entityId: string | undefined): number | undefined {
    if (!entityId || !this.hass) return undefined;
    const entity = this.hass.states[entityId];
    if (!entity || entity.state === "unavailable" || entity.state === "unknown") return undefined;
    const val = parseFloat(entity.state);
    return Number.isNaN(val) ? undefined : val;
  }

  // An input_number helper takes priority over the plain number so the card
  // chip and the reminder automation (which reads the same helper) can never
  // drift apart; falls back to the static value when no helper is set.
  private _cleaningIntervalDays(): number {
    const cfg = this._config;
    if (!cfg) return DEFAULT_AQUARIUM_CLEANING_INTERVAL_DAYS;
    if (cfg.cleaning_interval_entity) {
      const fromHelper = this._numericState(cfg.cleaning_interval_entity);
      if (fromHelper !== undefined && fromHelper > 0) return fromHelper;
    }
    return cfg.cleaning_interval ?? DEFAULT_AQUARIUM_CLEANING_INTERVAL_DAYS;
  }

  // Fixed priority order (warn-capable chips first) since only the first
  // AQUARIUM_CHIP_MAX are shown — the rest collapse into a single "+{n}"
  // chip rather than each competing for one of the 4 slots individually.
  private _buildChips(tiles: AquariumTile[], water: { value: number; unavailable: boolean } | undefined): AquariumChip[] {
    const cfg = this._config;
    if (!cfg || !this.hass) return [];
    const chips: AquariumChip[] = [];

    if (water && !water.unavailable) {
      const [lo, hi] = cfg.target_range ?? DEFAULT_AQUARIUM_TARGET_RANGE;
      if (water.value < lo || water.value > hi) {
        const deviation = water.value < lo ? lo - water.value : water.value - hi;
        const key = water.value < lo ? "aquarium_chip_temp_below" : "aquarium_chip_temp_above";
        chips.push({
          key: "temp",
          icon: "mdi:thermometer-alert",
          text: this._t(key).replace(
            "{x}",
            formatNumber(this._language, deviation, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
          ),
          warn: true,
        });
      }
    }

    if (cfg.heater?.entity && cfg.heater_power_entity) {
      const heaterTile = tiles.find((t) => t.entity === cfg.heater!.entity);
      const power = this._numericState(cfg.heater_power_entity);
      if (heaterTile?.active && power !== undefined && power <= 0) {
        chips.push({ key: "heater", icon: "mdi:radiator-disabled", text: this._t("aquarium_chip_heater_no_power"), warn: true });
      }
    }

    if (cfg.cleaning_entity) {
      const entity = this.hass.states[cfg.cleaning_entity];
      const date = entity && entity.state !== "unavailable" && entity.state !== "unknown" ? new Date(entity.state) : undefined;
      if (date && !Number.isNaN(date.getTime())) {
        const days = Math.floor((Date.now() - date.getTime()) / 86400000);
        const interval = this._cleaningIntervalDays();
        if (days >= interval) {
          chips.push({ key: "cleaning", icon: "mdi:broom", text: this._t("aquarium_chip_cleaning_due"), warn: true });
        } else {
          chips.push({
            key: "cleaning",
            icon: "mdi:broom",
            text:
              days <= 0
                ? this._t("aquarium_chip_cleaned_today")
                : this._t("aquarium_chip_cleaned_days_ago").replace("{n}", String(days)),
            warn: false,
          });
        }
      }
    }

    // Deliberately narrow: only a binary_sensor's "on" state is treated as
    // "problem detected" (this chip is a warning, not a live level gauge —
    // a numeric % reading has no universally-right low-water threshold to
    // guess at here).
    if (cfg.water_level_entity && this.hass.states[cfg.water_level_entity]?.state === "on") {
      chips.push({ key: "water_level", icon: "mdi:waves-arrow-up", text: this._t("aquarium_chip_water_level_low"), warn: true });
    }

    const ph = this._numericState(cfg.ph_entity);
    if (ph !== undefined) {
      chips.push({
        key: "ph",
        icon: "mdi:flask-outline",
        text: `pH ${formatNumber(this._language, ph, { maximumFractionDigits: 1 })}`,
        warn: false,
      });
    }

    const tds = this._numericState(cfg.tds_entity);
    if (tds !== undefined) {
      const unit = this.hass.states[cfg.tds_entity!]?.attributes.unit_of_measurement ?? "ppm";
      chips.push({
        key: "tds",
        icon: "mdi:water-opacity",
        text: `${formatNumber(this._language, tds, { maximumFractionDigits: 0 })} ${unit}`,
        warn: false,
      });
    }

    const power = this._numericState(cfg.power_entity);
    if (power !== undefined) {
      const unit = this.hass.states[cfg.power_entity!]?.attributes.unit_of_measurement ?? "W";
      chips.push({
        key: "power",
        icon: "mdi:flash",
        text: `${formatNumber(this._language, power, { maximumFractionDigits: 0 })} ${unit}`,
        warn: false,
      });
    }

    return chips;
  }

  private _renderChipRow(chips: AquariumChip[]) {
    if (chips.length === 0) return nothing;
    const visible = chips.slice(0, AQUARIUM_CHIP_MAX);
    const overflow = chips.length - AQUARIUM_CHIP_MAX;
    return html`
      <div class="chip-row">
        ${visible.map(
          (c) => html`
            <div class="chip ${c.warn ? "warn" : ""}">
              ${c.icon ? html`<ha-icon icon=${c.icon}></ha-icon>` : nothing}
              <span>${c.text}</span>
            </div>
          `,
        )}
        ${overflow > 0 ? html`<div class="chip more">+${overflow}</div>` : nothing}
      </div>
    `;
  }

  // Fallback status line when no schedule is configured (or known) at all —
  // a plain device-count summary instead of the schedule-derived phase text.
  private _deviceStatusLine(tiles: AquariumTile[]): string {
    const switchable = tiles.filter((t) => !t.momentary);
    const activeCount = switchable.filter((t) => t.active).length;
    if (switchable.length === 0) return "";
    if (activeCount === 0) return this._t("off") === "Aus" ? "Alle Geräte aus" : "All devices off";
    return this._t("off") === "Aus"
      ? `${activeCount} von ${switchable.length} Geräte an`
      : `${activeCount} of ${switchable.length} devices on`;
  }

  private _parseTimeToMin(t: string | undefined): number | undefined {
    if (!t) return undefined;
    const m = /^(\d{1,2}):(\d{2})/.exec(t);
    if (!m) return undefined;
    const h = parseInt(m[1], 10);
    const mi = parseInt(m[2], 10);
    if (h > 24 || mi > 59) return undefined;
    return h * 60 + mi;
  }

  // Splits an overnight range (e.g. 22:00–06:00) into two same-day segments
  // (22:00–24:00 and 00:00–06:00) so every phase can be rendered/queried
  // within a single 0–1440 "minutes since local midnight" axis.
  private _pushPhase(phases: AquariumPhase[], device: string, start: number, end: number, color: string): void {
    if (end > start) {
      phases.push({ device, startMin: start, endMin: end, color });
    } else {
      phases.push({ device, startMin: start, endMin: 1440, color });
      if (end > 0) phases.push({ device, startMin: 0, endMin: end, color });
    }
  }

  private _phaseColorFor(device: string, override?: string): string {
    if (override) return this._resolveColor(override, DEFAULT_AQUARIUM_ACCENT);
    if (device === "day") return DEFAULT_AQUARIUM_DEVICE_COLORS.light_day;
    if (device === "night") return DEFAULT_AQUARIUM_DEVICE_COLORS.light_night;
    const slot = this._config?.[device as keyof M3AquariumCardConfig] as AquariumDeviceConfig | undefined;
    return slot?.color ? this._resolveColor(slot.color, DEFAULT_AQUARIUM_ACCENT) : DEFAULT_AQUARIUM_ACCENT;
  }

  // Manual `schedule` config wins when set; otherwise falls back to a
  // `schedule_entity` (HA's `schedule.*` domain — weekday-keyed [{from,to}]
  // attributes). A plain schedule entity has no day/night concept of its
  // own (it's a single on/off timeline), so those ranges render as one
  // generic "on" phase rather than the day/night pair manual config gives.
  private _buildPhases(): AquariumPhase[] {
    const cfg = this._config;
    if (!cfg) return [];
    const phases: AquariumPhase[] = [];
    if (cfg.schedule?.length) {
      for (const entry of cfg.schedule) {
        const start = this._parseTimeToMin(entry.start);
        const end = this._parseTimeToMin(entry.end);
        if (start === undefined || end === undefined) continue;
        this._pushPhase(phases, entry.device, start, end, this._phaseColorFor(entry.device, entry.color));
      }
    } else if (cfg.schedule_entity && this.hass) {
      const entity = this.hass.states[cfg.schedule_entity];
      const dayKey = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][
        new Date().getDay()
      ];
      const ranges = entity?.attributes[dayKey];
      if (Array.isArray(ranges)) {
        for (const r of ranges) {
          const start = this._parseTimeToMin(r?.from);
          const end = this._parseTimeToMin(r?.to);
          if (start === undefined || end === undefined) continue;
          this._pushPhase(phases, "on", start, end, DEFAULT_AQUARIUM_ACCENT);
        }
      }
    }
    return phases.sort((a, b) => a.startMin - b.startMin);
  }

  private _nowMinutes(): number {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }

  private _formatTime(d: Date): string {
    const hour12 = this.hass?.locale?.time_format === "12";
    return new Intl.DateTimeFormat(this._language, { hour: "numeric", minute: "2-digit", hour12 }).format(d);
  }

  private _timeAtMinutes(min: number): Date {
    const d = new Date();
    d.setHours(Math.floor(min / 60) % 24, min % 60, 0, 0);
    return d;
  }

  private _hourLabel(hour: number): string {
    const hour12 = this.hass?.locale?.time_format === "12";
    if (!hour12) return String(hour % 24);
    const d = new Date();
    d.setHours(hour % 24, 0, 0, 0);
    return new Intl.DateTimeFormat(this._language, { hour: "numeric", hour12: true }).format(d);
  }

  // "Tagphase · noch 4 Std." while a day-type phase is running, "Nachtruhe
  // · Licht ab 10:00" while a night-type phase is running (deliberately
  // asymmetric per the design: a countdown while the light is expected to
  // stay on, a wake-time while it's expected to stay off) — undefined when
  // no schedule is known at all, letting the caller fall back to
  // _deviceStatusLine.
  private _scheduleStatusLine(phases: AquariumPhase[]): string | undefined {
    if (phases.length === 0) return undefined;
    const now = this._nowMinutes();
    const current = phases.find((p) => now >= p.startMin && now < p.endMin);
    if (!current) return undefined;

    if (current.device === "day") {
      const remain = current.endMin - now;
      const text =
        remain >= 60
          ? this._t("aquarium_phase_remaining_hours").replace("{h}", String(Math.floor(remain / 60)))
          : this._t("aquarium_phase_remaining_minutes").replace("{m}", String(Math.max(1, remain)));
      return `${this._t("aquarium_phase_day")} · ${text}`;
    }
    if (current.device === "night") {
      const upcoming = phases.filter((p) => p.device === "day" && p.startMin > now).sort((a, b) => a.startMin - b.startMin)[0]
        ?? phases.filter((p) => p.device === "day").sort((a, b) => a.startMin - b.startMin)[0];
      if (!upcoming) return this._t("aquarium_phase_night");
      return `${this._t("aquarium_phase_night")} · ${this._t("aquarium_phase_light_from").replace("{time}", this._formatTime(this._timeAtMinutes(upcoming.startMin)))}`;
    }
    const remain = current.endMin - now;
    const text =
      remain >= 60
        ? this._t("aquarium_phase_remaining_hours").replace("{h}", String(Math.floor(remain / 60)))
        : this._t("aquarium_phase_remaining_minutes").replace("{m}", String(Math.max(1, remain)));
    return `${current.device} · ${text}`;
  }

  /**
   * The day as a bar: the lighting phases in their own colours, with a marker
   * for now.
   *
   * Divs rather than the SVG this used to be. The SVG stretched x with
   * `preserveAspectRatio="none"`, which is fine for the phase rects — they are
   * percentages of the day — but makes a pixel-sized gap around the marker
   * come out a different width on every card. `calc()` on absolutely
   * positioned elements mixes the two units correctly and needs no
   * measurement before the first paint.
   *
   * The shape is the Expressive level slider's, from shared/level-slider.ts:
   * the same idea drawn twice — a position on a scale — so it reads as the
   * same control rather than as a near-miss.
   */
  private _renderScheduleBar(phases: AquariumPhase[]) {
    const now = this._nowMinutes();
    const nowFraction = now / 1440;

    return html`
      <div class="schedule-bar">
        <div class="schedule-track-wrap" style=${`--now: ${nowFraction};`}>
          <div class="schedule-track"></div>
          <div class="schedule-phases">
            ${phases.map((p) => {
              const current = now >= p.startMin && now < p.endMin;
              const left = (p.startMin / 1440) * 100;
              const width = ((p.endMin - p.startMin) / 1440) * 100;
              return html`<span
                class="schedule-phase"
                style=${`left: ${left}%; width: ${width}%; background: ${p.color}; opacity: ${
                  current ? 0.85 : 0.5
                };`}
              ></span>`;
            })}
          </div>
          <div class="schedule-now-marker"></div>
        </div>
        <div class="schedule-hour-labels">
          ${[0, 6, 12, 18, 24].map((h) => html`<span>${this._hourLabel(h)}</span>`)}
        </div>
      </div>
    `;
  }

  protected render() {
    if (!this._config || !this.hass) return nothing;

    const tiles = this._buildTiles();
    const phases = this._config.show_schedule !== false ? this._buildPhases() : [];
    const statusLine = this._scheduleStatusLine(phases) ?? this._deviceStatusLine(tiles);
    const water = this._waterTemp();
    const chips = this._buildChips(tiles, water);
    const accentColor =
      water && !water.unavailable
        ? this._waterColor(water.value)
        : this._config.accent_color
          ? resolveThemeColor(this._config.accent_color)
          : DEFAULT_AQUARIUM_ACCENT;

    const name = this._config.name || this._t("aquarium_default_name");
    const icon = this._config.icon || DEFAULT_AQUARIUM_ICON;
    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(this._config);
    const radius = resolveCornerRadius(this._config.radius ?? DEFAULT_AQUARIUM_RADIUS, this._config.corners);
    const animClass = shouldAnimate(this._config.animation) ? "" : "no-animations";
    const tempUnit = this.hass.config?.unit_system?.temperature ?? "°C";

    const cssVars = buildCssVars({
      "m3p-text": textColorCss,
      "m3p-secondary-text": secondaryTextColorCss,
      "aq-accent": accentColor,
    });

    const cameraAvailable = this._cameraAvailable();
    const bannerMode = this._config.camera_style === "banner" && cameraAvailable;
    const liveMode = this._config.camera_style === "live" && cameraAvailable;
    const thumbnailMode = this._config.camera_style === "thumbnail" && cameraAvailable;
    const waterText =
      water && !water.unavailable
        ? `${formatNumber(this._language, water.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}${tempUnit}`
        : undefined;

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(this._config.glass_background)} ${animClass} ${bannerMode || liveMode ? "camera-banner-mode" : ""}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          ${bannerMode
            ? this._renderCameraBanner(name, statusLine, waterText)
            : liveMode
              ? this._renderCameraLive(name, statusLine, waterText)
              : html`
                <div class="header">
                  ${thumbnailMode
                    ? this._renderCameraThumbnail()
                    : html`
                        <div class="icon-swatch" style=${`background: ${tintOn(this, accentColor, this._config.accent_opacity, 18)}; color: ${tintInk(this, accentColor, this._config.accent_opacity, 18, 3)};`}>
                          <ha-icon icon=${icon}></ha-icon>
                        </div>
                      `}
                  <div class="text-block">
                    <div class="name">${name}</div>
                    <div class="status-line">${statusLine}</div>
                  </div>
                  ${water && !water.unavailable
                    ? html`
                        <div class="water-block" style=${`color: ${accentColor};`}>
                          <div class="water-value">
                            ${formatNumber(this._language, water.value, {
                              minimumFractionDigits: 1,
                              maximumFractionDigits: 1,
                            })}<span class="water-unit">${tempUnit}</span>
                          </div>
                          <div class="water-label">${this._t("aquarium_water_label")}</div>
                        </div>
                      `
                    : nothing}
                </div>
                ${thumbnailMode ? this._renderCameraExpanded() : nothing}
              `}

          ${phases.length > 0 ? this._renderScheduleBar(phases) : nothing}

          ${tiles.length > 0
            ? html`
                <div
                  class="tile-grid"
                  style=${`grid-template-columns: ${
                    tiles.length >= 6
                      ? `repeat(auto-fit, minmax(${AQUARIUM_TILE_MIN_COL}px, 1fr))`
                      : `repeat(${tiles.length}, minmax(0, 1fr))`
                  };`}
                >
                  ${tiles.map((t) => this._renderTile(t))}
                </div>
              `
            : nothing}

          ${this._renderChipRow(chips)}
        </div>
      </ha-card>
    `;
  }

  private _renderTile(tile: AquariumTile) {
    return html`
      <div
        class="tile ${tile.active ? "active" : ""} ${tile.unavailable ? "unavailable" : ""}"
        style=${`--tile-color: ${tile.color}; --tile-icon-bg: ${tintOn(this, tile.color, this._config?.tile_tint_opacity, 22)}; --tile-icon-color: ${tintInk(this, tile.color, this._config?.tile_tint_opacity, 22, 3)}; border-radius: ${tile.active ? AQUARIUM_TILE_RADIUS_ON : AQUARIUM_TILE_RADIUS_OFF}px; background: ${tintOn(this, tile.color, this._config?.tile_tint_opacity, tile.active ? 17 : 6)};`}
        role="button"
        tabindex="0"
        aria-label=${tile.name}
        title=${tile.name}
        @pointerdown=${this._onTilePointerDown(tile)}
        @pointerup=${this._onTilePointerUp}
        @pointercancel=${this._onTilePointerUp}
        @pointerleave=${this._onTilePointerUp}
        @click=${this._onTileClick(tile)}
        @keydown=${activateOnKey(this._onTileClick(tile))}
      >
        <div
          class="tile-icon ${tile.active ? "active" : ""}"
          style=${`border-radius: ${tile.active ? AQUARIUM_TILE_ICON_RADIUS_ON : AQUARIUM_TILE_ICON_RADIUS_OFF}px;`}
        >
          <ha-icon icon=${tile.icon}></ha-icon>
        </div>
        <div class="tile-label">${tile.name}</div>
        <div class="tile-secondary">${tile.secondary}</div>
      </div>
    `;
  }

  static styles = [
    glassCardStyles,
    css`
      :host {
        min-width: 0;
      }

      .card-inner {
        gap: 14px;
        min-width: 0;
      }

      .card-inner.camera-banner-mode {
        padding: ${AQUARIUM_CAMERA_BANNER_PADDING}px;
      }

      .header {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .icon-swatch {
        flex-shrink: 0;
        width: ${AQUARIUM_HEADER_ICON_SIZE}px;
        height: ${AQUARIUM_HEADER_ICON_SIZE}px;
        border-radius: ${AQUARIUM_HEADER_ICON_RADIUS}px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.3s ${EASING}, color 0.3s ${EASING};
      }

      .icon-swatch ha-icon {
        --mdc-icon-size: 23px;
      }

      .text-block {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .name {
        font-size: 14px;
        font-weight: 700;
        line-height: 1.2;
        color: var(--m3p-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .status-line {
        font-size: 11px;
        opacity: 0.6;
        color: var(--m3p-secondary-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .water-block {
        flex-shrink: 0;
        text-align: right;
      }

      .water-value {
        font-size: 21px;
        font-weight: 700;
        line-height: 1;
      }

      .water-unit {
        font-size: 12px;
        font-weight: 500;
        margin-left: 1px;
      }

      .water-label {
        font-size: 9px;
        opacity: 0.5;
        color: var(--m3p-secondary-text);
        margin-top: 2px;
      }

      .schedule-bar {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .schedule-track-wrap {
        position: relative;
        height: ${AQUARIUM_SCHEDULE_MARKER_HEIGHT}px;
        display: flex;
        align-items: center;
        /* Where "now" sits, inset at both ends so the marker stays inside the
           track at midnight. Everything below positions itself against this,
           so the marker and the gap in the phases cannot drift apart. */
        --now-x: calc(
          ${AQUARIUM_SCHEDULE_INSET}px + var(--now) * (100% - ${AQUARIUM_SCHEDULE_INSET * 2}px)
        );
      }

      .schedule-track,
      .schedule-phases {
        position: absolute;
        left: 0;
        right: 0;
        height: ${AQUARIUM_SCHEDULE_TRACK_HEIGHT}px;
        border-radius: ${AQUARIUM_SCHEDULE_TRACK_RADIUS}px;
      }

      .schedule-track {
        background: color-mix(in srgb, white 9%, transparent);
      }

      /* The gap is masked out rather than painted over: the card may be glass,
         and a stripe in the card colour would show as a bar across it. */
      .schedule-phases {
        overflow: hidden;
        -webkit-mask-image: linear-gradient(
          to right,
          #000 calc(var(--now-x) - ${AQUARIUM_SCHEDULE_GAP}px),
          transparent calc(var(--now-x) - ${AQUARIUM_SCHEDULE_GAP}px),
          transparent calc(var(--now-x) + ${AQUARIUM_SCHEDULE_GAP + AQUARIUM_SCHEDULE_MARKER_WIDTH}px),
          #000 calc(var(--now-x) + ${AQUARIUM_SCHEDULE_GAP + AQUARIUM_SCHEDULE_MARKER_WIDTH}px)
        );
        mask-image: linear-gradient(
          to right,
          #000 calc(var(--now-x) - ${AQUARIUM_SCHEDULE_GAP}px),
          transparent calc(var(--now-x) - ${AQUARIUM_SCHEDULE_GAP}px),
          transparent calc(var(--now-x) + ${AQUARIUM_SCHEDULE_GAP + AQUARIUM_SCHEDULE_MARKER_WIDTH}px),
          #000 calc(var(--now-x) + ${AQUARIUM_SCHEDULE_GAP + AQUARIUM_SCHEDULE_MARKER_WIDTH}px)
        );
      }

      .schedule-phase {
        position: absolute;
        top: 0;
        bottom: 0;
        border-radius: ${AQUARIUM_SCHEDULE_TRACK_RADIUS}px;
      }

      .schedule-now-marker {
        position: absolute;
        left: var(--now-x);
        width: ${AQUARIUM_SCHEDULE_MARKER_WIDTH}px;
        height: ${AQUARIUM_SCHEDULE_MARKER_HEIGHT}px;
        border-radius: ${AQUARIUM_SCHEDULE_MARKER_RADIUS}px;
        background: var(--m3p-text);
        transition: left 1s linear;
      }

      .card-inner.no-animations .schedule-now-marker {
        transition: none;
      }

      @media (prefers-reduced-motion: reduce) {
        .schedule-now-marker {
          transition: none;
        }
      }

      .schedule-hour-labels {
        display: flex;
        justify-content: space-between;
        font-size: 9px;
        opacity: 0.35;
        color: var(--m3p-text);
      }

      .camera-media {
        position: relative;
        overflow: hidden;
        aspect-ratio: 16 / 9;
        cursor: pointer;
        background: color-mix(in srgb, var(--m3p-text) 8%, var(--ha-card-background, var(--card-background-color)));
      }

      .camera-banner {
        border-radius: ${AQUARIUM_CAMERA_BANNER_RADIUS}px;
      }

      .camera-img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        transition: opacity 0.3s ease;
      }

      .camera-media ha-camera-stream {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        --video-max-height: none;
      }

      .camera-placeholder {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        color: var(--m3p-secondary-text);
      }

      .camera-placeholder ha-icon {
        --mdc-icon-size: 28px;
        opacity: 0.5;
      }

      .camera-placeholder span {
        font-size: 11px;
        opacity: 0.6;
      }

      .camera-gradient {
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: linear-gradient(
          180deg,
          rgba(0, 0, 0, 0.35) 0%,
          transparent 32%,
          transparent 58%,
          rgba(0, 0, 0, 0.55) 100%
        );
      }

      .camera-badge-live,
      .camera-chip-temp {
        position: absolute;
        display: flex;
        align-items: center;
        gap: 5px;
        box-sizing: border-box;
        background: color-mix(in srgb, black 40%, transparent);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        color: white;
        font-weight: 700;
      }

      .camera-badge-live {
        top: 10px;
        left: 10px;
        height: ${AQUARIUM_CAMERA_BADGE_HEIGHT}px;
        padding: 0 10px;
        border-radius: ${AQUARIUM_CAMERA_BADGE_RADIUS}px;
        font-size: 11px;
      }

      .camera-expand-media .camera-badge-live {
        top: 8px;
        left: 8px;
      }

      .live-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: ${unsafeCSS(AQUARIUM_WATER_COLOR_WARN)};
        flex-shrink: 0;
      }

      .camera-chip-temp {
        top: 10px;
        right: 10px;
        height: ${AQUARIUM_CAMERA_CHIP_HEIGHT}px;
        padding: 0 10px;
        border-radius: ${AQUARIUM_CAMERA_CHIP_RADIUS}px;
        font-size: 13px;
      }

      .camera-caption {
        position: absolute;
        left: 12px;
        bottom: 10px;
        right: 12px;
        display: flex;
        flex-direction: column;
        gap: 2px;
        color: white;
      }

      .camera-caption-name {
        font-size: 15px;
        font-weight: 700;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .camera-caption-status {
        font-size: 11px;
        opacity: 0.75;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .thumb-wrap {
        position: relative;
        flex-shrink: 0;
        overflow: hidden;
        width: ${AQUARIUM_CAMERA_THUMB_SIZE}px;
        height: ${AQUARIUM_CAMERA_THUMB_SIZE}px;
        border-radius: ${AQUARIUM_CAMERA_THUMB_RADIUS}px;
        cursor: pointer;
        background: color-mix(in srgb, var(--m3p-text) 8%, var(--ha-card-background, var(--card-background-color)));
        transition: border-radius ${AQUARIUM_TILE_MORPH_MS}ms ${EASING};
      }

      .card-inner.no-animations .thumb-wrap {
        transition: none;
      }

      .thumb-wrap.active {
        border-radius: ${AQUARIUM_CAMERA_THUMB_RADIUS_ACTIVE}px;
      }

      .thumb-img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        transition: opacity 0.3s ease;
      }

      .thumb-wrap .camera-placeholder ha-icon {
        --mdc-icon-size: 18px;
      }

      .thumb-live-dot {
        position: absolute;
        right: 3px;
        bottom: 3px;
        width: ${AQUARIUM_CAMERA_LIVE_DOT_SIZE}px;
        height: ${AQUARIUM_CAMERA_LIVE_DOT_SIZE}px;
        border-radius: 50%;
        background: ${unsafeCSS(AQUARIUM_WATER_COLOR_WARN)};
        border: 2px solid var(--card-background-color, #1c1c1e);
        box-sizing: border-box;
      }

      .camera-expand-wrap {
        display: grid;
        grid-template-rows: 0fr;
        transition: grid-template-rows ${AQUARIUM_CAMERA_EXPAND_MS}ms ${EASING};
      }

      .card-inner.no-animations .camera-expand-wrap {
        transition: none;
      }

      .camera-expand-wrap.open {
        grid-template-rows: 1fr;
      }

      .camera-expand-inner {
        overflow: hidden;
      }

      .camera-expand-media {
        border-radius: 16px;
      }

      .tile-grid {
        display: grid;
        gap: ${AQUARIUM_TILE_GAP}px;
        min-width: 0;
      }

      .tile {
        box-sizing: border-box;
        min-width: 0;
        padding: 9px 4px 8px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        cursor: pointer;
        transition: border-radius ${AQUARIUM_TILE_MORPH_MS}ms ${EASING}, background 0.25s ease;
      }

      .tile:focus-visible {
        outline: 2px solid var(--tile-color);
        outline-offset: 2px;
      }

      .tile.unavailable {
        opacity: 0.4;
        pointer-events: none;
      }

      .card-inner.no-animations .tile {
        transition: none;
      }

      .card-inner.no-animations .tile-icon {
        transition: none;
      }

      .tile-icon {
        width: ${AQUARIUM_TILE_ICON_BOX}px;
        height: ${AQUARIUM_TILE_ICON_BOX}px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--tile-color);
        opacity: 0.85;
        transition: border-radius ${AQUARIUM_TILE_MORPH_MS}ms ${EASING}, background 0.25s ease, color 0.25s ease;
      }

      .tile-icon ha-icon {
        --mdc-icon-size: 16px;
      }

      .tile-icon.active {
        background: var(--tile-icon-bg);
        /* The glyph sits in the well, so it is measured against the well. */
        color: var(--tile-icon-color, var(--tile-color));
        opacity: 1;
      }

      .tile-label {
        font-size: 9px;
        font-weight: 600;
        color: var(--m3p-text);
        text-align: center;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 100%;
      }

      .tile-secondary {
        font-size: 8px;
        opacity: 0.6;
        color: var(--m3p-secondary-text);
        text-align: center;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 100%;
      }

      .chip-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .chip {
        box-sizing: border-box;
        height: ${AQUARIUM_CHIP_HEIGHT}px;
        padding: 0 10px;
        border-radius: ${AQUARIUM_CHIP_RADIUS}px;
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 12px;
        font-weight: 600;
        background: color-mix(in srgb, var(--m3p-text) 10%, var(--ha-card-background, var(--card-background-color)));
        color: var(--m3p-text);
      }

      .chip ha-icon {
        --mdc-icon-size: 14px;
        flex-shrink: 0;
      }

      .chip.warn {
        background: color-mix(in srgb, ${unsafeCSS(AQUARIUM_WATER_COLOR_WARN)} 18%, var(--ha-card-background, var(--card-background-color)));
        color: ${unsafeCSS(AQUARIUM_WATER_COLOR_WARN)};
      }

      .chip.more {
        opacity: 0.6;
        padding: 0 12px;
      }

      /* Safari gained color-mix() in 16.2, and an iPod touch 7 or an iPad Air 2
         stops at iOS 15. A plain declaration before each mix cannot serve as the
         fallback: every one of them contains var(), which defers the check until
         after substitution, where failure yields unset rather than the previous
         declaration — the tint did not fade, the fill disappeared entirely. This
         block is the one those browsers alone can see; the tint is what it gives
         up. Backticks are not allowed in here: this is a css template literal. */
      @supports not (color: color-mix(in srgb, red 50%, blue)) {
        .camera-media {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .thumb-wrap {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .chip {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .chip.warn {
          background: var(--ha-card-background, var(--card-background-color));
        }
      }
      `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-aquarium-card": M3AquariumCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-aquarium-card",
  name: "M3 Aquarium Card",
  description:
    "Eine Material-3-Spezialkarte für Aquarien: Wasserwerte, Beleuchtung und Geräte in einer Kachel.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
