import { LitElement, html, css, svg, unsafeCSS, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";
import type {
  HomeAssistant,
  M3RemoteCardConfig,
  RemoteAppConfig,
  RemoteButtonConfig,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_REMOTE_ASSISTANT_TIMEOUT,
  DEFAULT_REMOTE_DPAD_SIZE,
  DEFAULT_REMOTE_RADIUS,
  DEFAULT_REMOTE_REPEAT_INTERVAL,
  REMOTE_ACTIVE_OUTLINE,
  REMOTE_ACTIVE_TINT,
  REMOTE_ASSISTANT_GRADIENT,
  REMOTE_ASSISTANT_RADIUS,
  REMOTE_ASSISTANT_RADIUS_ACTIVE,
  REMOTE_ASSISTANT_SIZE,
  REMOTE_CHIP_HEIGHT,
  REMOTE_CHIP_RADIUS,
  REMOTE_CHIP_RADIUS_PRESSED,
  REMOTE_CHIP_TINT,
  REMOTE_DPAD_GAP_DEGREES,
  REMOTE_DPAD_MAX,
  REMOTE_DPAD_MIN,
  REMOTE_FUNCTION_HEIGHT,
  REMOTE_FUNCTION_RADIUS,
  REMOTE_FUNCTION_RADIUS_PRESSED,
  REMOTE_HEADER_ICON_RADIUS,
  REMOTE_HEADER_ICON_SIZE,
  REMOTE_MAX_WIDTH,
  REMOTE_NARROW_WIDTH,
  REMOTE_NOW_PLAYING_ART,
  REMOTE_NOW_PLAYING_ART_RADIUS,
  REMOTE_NOW_PLAYING_BUTTON,
  REMOTE_NOW_PLAYING_BUTTON_RADIUS,
  REMOTE_NOW_PLAYING_HEIGHT,
  REMOTE_NOW_PLAYING_RADIUS,
  REMOTE_NOW_PLAYING_TINT,
  REMOTE_NUMPAD_HEIGHT,
  REMOTE_NUMPAD_RADIUS,
  REMOTE_OK_RADIUS_PRESSED,
  REMOTE_POWER_RADIUS_OFF,
  REMOTE_POWER_RADIUS_ON,
  REMOTE_POWER_SIZE,
  REMOTE_REPEAT_DELAY,
  REMOTE_ROCKER_END_HEIGHT,
  REMOTE_ROCKER_GAP,
  REMOTE_ROCKER_MID_HEIGHT,
  REMOTE_ROCKER_RADIUS_INNER,
  REMOTE_ROCKER_RADIUS_MUTED,
  REMOTE_ROCKER_RADIUS_OUTER,
  REMOTE_ROCKER_WIDTH,
  REMOTE_ROCKER_WIDTH_NARROW,
  REMOTE_SECTOR_TINT,
  REMOTE_TILE_COLUMNS,
  REMOTE_TILE_RADIUS,
  REMOTE_TILE_RADIUS_PRESSED,
  resolveCornerRadius,
  THEME_PRIMARY,
} from "./const";
import {
  buildCssVars,
  inkOn,
  resolveCommonColors,
  resolveThemeColor,
  tintOn,
} from "./shared/color-config";
import { glassCardStyles, glassCardClass, renderMissingEntity } from "./shared/glass-card";
import { cardHeaderStyles } from "./shared/card-header";
import { handleAction } from "./shared/actions";
import { fireHaptic } from "./shared/tap-hold";
import { localize, type TranslationKey } from "./localize";
import { hassChangeMatters } from "./shared/should-update";
import { TemplatedCard } from "./shared/templated-card";
import { STANDARD_EASING, shouldAnimate } from "./shared/animation";
import { VisibleTicker } from "./shared/visible-ticker";
import {
  DPAD_DIRECTIONS,
  arrowPosition,
  centerSize,
  keyToDirection,
  ringGeometry,
  sectorPath,
} from "./shared/remote-dpad";
import {
  KEY_ICONS,
  PROFILE_DEFAULTS,
  powerTarget,
  capabilitiesOf,
  currentPosition,
  formatPosition,
  isAppActive,
  isDeviceOn,
  isDeviceUnavailable,
  meaningfulAppName,
  profileForPlatform,
  resolveKey,
  resolveTextEntry,
  type KeyMap,
  type RemoteKey,
  type RemoteProfile,
} from "./shared/remote-profiles";

console.info(
  `%c M3-REMOTE-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #f0c46e; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #f0c46e; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

/** Brand colours for the apps the card offers to fill in. */
const APP_COLORS: Record<string, string> = {
  netflix: "#e50914",
  youtube: "#ff0033",
  "youtube music": "#ff0033",
  "prime video": "#00a8e1",
  prime: "#00a8e1",
  "amazon prime video": "#00a8e1",
  "disney+": "#5a6fe8",
  disney: "#5a6fe8",
  spotify: "#1db954",
  "apple tv": "#b8c4c9",
  "apple tv+": "#b8c4c9",
  ard: "#1c6ecc",
  zdf: "#fa7d19",
  "zdf mediathek": "#fa7d19",
  ardmediathek: "#1c6ecc",
  twitch: "#9146ff",
  plex: "#e5a00d",
  kodi: "#5dcaa5",
  dazn: "#8ce800",
  wow: "#7b2cbf",
  magentatv: "#e20074",
};

function appColor(name: string, explicit?: string): string | undefined {
  return explicit ?? APP_COLORS[name.trim().toLowerCase()];
}

@customElement("m3-remote-card")
export class M3RemoteCard extends TemplatedCard(LitElement) implements LovelaceCard {
  /** Fires its own haptics, tuned per key; the shared tap haptic stays out. */
  public static ownHaptics = true;

  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() protected _config?: M3RemoteCardConfig;
  /** Which control is held down, for the press morph. */
  @state() private _pressed?: string;
  @state() private _assistantActive = false;
  @state() private _keyboardOpen = false;
  @state() private _keyboardText = "";
  /** Ticks once a second while a track is playing, to advance the position. */
  @state() private _tick = 0;
  /** The integration behind `entity`, once the registry has answered. */
  @state() private _registryPlatform?: string;
  private _registryLoaded = false;

  private _repeatTimer?: number;
  private _repeatDelay?: number;
  private _assistantTimer?: number;
  /** Advances the now-playing position; only while the card is on screen. */
  private readonly _ticker = new VisibleTicker(this, () => {
    if (this._mediaState?.state === "playing") this._tick++;
  });

  public setConfig(config: M3RemoteCardConfig): void {
    if (!config.entity) throw new Error("m3-remote-card: entity is required");
    this._config = { ...config };
    this._registryLoaded = false;
    this._registryPlatform = undefined;
    this._clearTimers();
    void this._loadPlatform();
  }

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-remote-card-editor");
    return document.createElement("m3-remote-card-editor") as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(hass?: HomeAssistant): Partial<M3RemoteCardConfig> {
    const ids = hass ? Object.keys(hass.states) : [];
    const remote = ids.find((id) => id.startsWith("remote."));
    const media = ids.find(
      (id) => id.startsWith("media_player.") && hass?.states[id]?.attributes.device_class === "tv",
    ) ?? ids.find((id) => id.startsWith("media_player."));
    return { entity: remote ?? media ?? "" };
  }

  public getCardSize(): number {
    return 8;
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: "full", min_rows: 6 };
  }

  public connectedCallback(): void {
    super.connectedCallback();
    // Once a second, and only while the card is on screen: a remote on a tab
    // nobody is looking at should not wake to move a progress bar.
    this._ticker.setCadence("second");
    this._ticker.connect();
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._clearTimers();
    this._ticker.disconnect();
  }

  private _clearTimers(): void {
    if (this._repeatTimer) window.clearInterval(this._repeatTimer);
    if (this._repeatDelay) window.clearTimeout(this._repeatDelay);
    if (this._assistantTimer) window.clearTimeout(this._assistantTimer);
    this._repeatTimer = undefined;
    this._repeatDelay = undefined;
    this._assistantTimer = undefined;
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return hassChangeMatters(changed, this.hass, [this._remoteEntity, this._mediaEntity, this._config?.power_entity]);
  }

  // ---- entities -------------------------------------------------------------

  /**
   * The pair this card drives.
   *
   * `entity` may be either half. The other is found on the same device, which
   * is how `androidtv_remote` is usually set up — `remote.*` takes the keys and
   * `media_player.*` knows what is playing — without asking for both.
   */
  private get _remoteEntity(): string | undefined {
    const e = this._config?.entity;
    if (e?.startsWith("remote.")) return e;
    if (this._config?.media_entity && e && !e.startsWith("media_player.")) return e;
    return this._counterpart("remote.");
  }

  private get _mediaEntity(): string | undefined {
    const e = this._config?.entity;
    if (this._config?.media_entity) return this._config.media_entity;
    if (e?.startsWith("media_player.")) return e;
    return this._counterpart("media_player.");
  }

  /**
   * The sibling entity on the same device.
   *
   * Matched on the object id rather than the registry, because the registry
   * needs a websocket round-trip and this runs in a getter during render. The
   * two halves of a device share their object id in every integration this
   * card targets.
   */
  private _counterpart(prefix: string): string | undefined {
    const e = this._config?.entity;
    if (!e || !this.hass) return undefined;
    const object = e.slice(e.indexOf(".") + 1);
    const candidate = prefix + object;
    return this.hass.states[candidate] ? candidate : undefined;
  }

  private get _mediaState() {
    return this._mediaEntity ? this.hass?.states[this._mediaEntity] : undefined;
  }

  private get _profile(): RemoteProfile {
    const configured = this._config?.profile as RemoteProfile | undefined;
    if (configured && configured in PROFILE_DEFAULTS) return configured;
    return profileForPlatform(this._platform);
  }

  /**
   * The integration behind the entity.
   *
   * Read from the entity registry, which is the only place that actually
   * knows. The id heuristic below is a stopgap for the first render, before
   * the registry has arrived — and a poor one: `remote.google_tv` names no
   * integration at all, and guessing from it landed on `generic`, which drew a
   * Chromecast's card for a device with a full set of Android keycodes.
   */
  private get _platform(): string | undefined {
    if (this._registryPlatform) return this._registryPlatform;
    const e = this._config?.entity ?? "";
    if (/samsung/i.test(e)) return "samsungtv";
    if (/appletv|apple_tv/i.test(e)) return "apple_tv";
    if (/kodi/i.test(e)) return "kodi";
    if (/webos|lg_/i.test(e)) return "webostv";
    if (/android|google_?tv|shield|chromecast|nvidia|onn/i.test(e)) return "androidtv_remote";
    return undefined;
  }

  private async _loadPlatform(): Promise<void> {
    if (!this.hass || this._registryLoaded) return;
    this._registryLoaded = true;
    const want = this._config?.entity;
    if (!want) return;
    try {
      const reg = await this.hass.callWS<Array<{ entity_id: string; platform: string }>>({
        type: "config/entity_registry/list",
      });
      const hit = reg.find((r) => r.entity_id === want);
      if (hit && hit.platform !== this._registryPlatform) this._registryPlatform = hit.platform;
    } catch {
      // No registry access: the id heuristic above stands, which is what the
      // card ran on before. Degraded, not broken.
    }
  }

  private get _defaults() {
    return PROFILE_DEFAULTS[this._profile];
  }

  private get _caps() {
    return capabilitiesOf(this.hass, this._remoteEntity, this._mediaEntity, this._profile);
  }

  /** The states of every entity that has an opinion about this device. */
  private get _witnessStates(): Array<string | undefined> {
    return [this._remoteEntity, this._mediaEntity]
      .filter((v): v is string => !!v)
      .map((id) => this.hass?.states[id]?.state);
  }

  private get _isOn(): boolean {
    const power = this._config?.power_entity;
    if (power) return this.hass?.states[power]?.state === "on";
    return isDeviceOn(...this._witnessStates);
  }

  private get _unavailable(): boolean {
    if (!this._remoteEntity && !this._mediaEntity) return true;
    return isDeviceUnavailable(...this._witnessStates);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey, vars?: Record<string, string | number>): string {
    let text = localize(key, this._language);
    if (vars) for (const [k, v] of Object.entries(vars)) text = text.replace(`{${k}}`, String(v));
    return text;
  }

  // ---- sending --------------------------------------------------------------

  private _send(key: RemoteKey): void {
    const call = resolveKey(
      key,
      this._profile,
      this._config?.key_overrides as KeyMap | undefined,
      this._remoteEntity,
      this._mediaEntity,
    );
    if (!call || !this.hass) return;
    // `media_player.volume_mute` is a setter, not a toggle, so the current
    // state has to be inverted rather than asserted. It is also the *only*
    // call that takes the flag: a profile whose mute is a keycode goes through
    // `remote.send_command`, which rejected the extra field outright —
    // "not a valid option at 'is_volume_muted'".
    if (key === "mute" && call.service === "volume_mute") {
      call.data = { ...call.data, is_volume_muted: !this._muted };
    }
    this.hass.callService(call.domain, call.service, call.data);
    if (this._config?.haptics !== false) fireHaptic(this, "light");
  }

  private get _muted(): boolean {
    return this._mediaState?.attributes.is_volume_muted === true;
  }

  private _canSend(key: RemoteKey): boolean {
    return !!resolveKey(
      key,
      this._profile,
      this._config?.key_overrides as KeyMap | undefined,
      this._remoteEntity,
      this._mediaEntity,
    );
  }

  // ---- press plumbing -------------------------------------------------------

  private _press(id: string): void {
    this._pressed = id;
  }

  private _release(): void {
    this._pressed = undefined;
    if (this._repeatTimer) window.clearInterval(this._repeatTimer);
    if (this._repeatDelay) window.clearTimeout(this._repeatDelay);
    this._repeatTimer = undefined;
    this._repeatDelay = undefined;
  }

  /**
   * A direction, held: fires once immediately, then repeats.
   *
   * The delay before the first repeat is what separates "one step down the
   * list" from "scroll"; without it every tap sends two.
   */
  private _holdStart(key: RemoteKey, id: string): void {
    this._press(id);
    this._send(key);
    const interval = this._config?.repeat_interval ?? DEFAULT_REMOTE_REPEAT_INTERVAL;
    this._repeatDelay = window.setTimeout(() => {
      this._repeatDelay = undefined;
      this._repeatTimer = window.setInterval(() => this._send(key), interval);
    }, REMOTE_REPEAT_DELAY);
  }

  // ---- keyboard -------------------------------------------------------------

  private readonly _onKeyDown = (ev: KeyboardEvent) => {
    if (this._config?.keyboard_control === false) return;
    if (this._keyboardOpen) return;
    const hit = keyToDirection(ev.key);
    if (!hit) return;
    const key: RemoteKey = hit === "ok" ? "ok" : hit;
    if (!this._canSend(key)) return;
    ev.preventDefault();
    ev.stopPropagation();
    this._send(key);
    this._press(`dpad-${hit}`);
    window.setTimeout(() => {
      if (this._pressed === `dpad-${hit}`) this._pressed = undefined;
    }, 160);
  };

  // ---- render ---------------------------------------------------------------

  protected render() {
    const cfg = this._config;
    if (!cfg || !this.hass) return nothing;
    if (!this.hass.states[cfg.entity] && !this._mediaEntity && !this._remoteEntity) {
      return renderMissingEntity(cfg.entity);
    }

    const common = resolveCommonColors(cfg);
    const accentCss = resolveThemeColor(cfg.accent_color ?? THEME_PRIMARY);
    const on = this._isOn;
    const unavailable = this._unavailable;

    const vars = buildCssVars({
      "m3rc-text": common.textColorCss,
      "m3rc-secondary-text": common.secondaryTextColorCss,
      "m3rc-accent": accentCss,
      "m3rc-accent-ink": inkOn(accentCss, this),
      "m3rc-accent-tint": tintOn(this, accentCss, undefined, REMOTE_NOW_PLAYING_TINT),
      "m3rc-accent-strong": tintOn(this, accentCss, undefined, REMOTE_ACTIVE_TINT),
      "ha-card-background": common.cardBackgroundCss,
      "m3rc-radius": resolveCornerRadius(cfg.radius ?? DEFAULT_REMOTE_RADIUS, cfg.corners),
      "m3rc-dpad": `${this._dpadSize}px`,
    });

    return html`
      <ha-card
        style=${vars}
        class=${classMap({ off: !on, unavailable, "no-motion": !shouldAnimate(cfg.animation) })}
      >
        <div
          class="card-inner ${glassCardClass(cfg.glass_background)}"
          tabindex=${cfg.keyboard_control === false ? -1 : 0}
          @keydown=${this._onKeyDown}
        >
          ${this._renderHeader()}
          ${this._renderNowPlaying()}
          <div class="body">
            ${this._renderControls()}
            ${this._renderFunctionRow()}
            ${this._renderTransport()}
            ${this._renderNumpad()}
            ${this._renderApps()}
          </div>
        </div>
      </ha-card>
      ${this._renderKeyboardDialog()}
    `;
  }

  private get _dpadSize(): number {
    const raw = this._config?.dpad_size ?? DEFAULT_REMOTE_DPAD_SIZE;
    return Math.max(REMOTE_DPAD_MIN, Math.min(REMOTE_DPAD_MAX, raw));
  }

  // ---- header ---------------------------------------------------------------

  private _renderHeader() {
    const cfg = this._config!;
    const on = this._isOn;
    const media = this._mediaState;
    const app = meaningfulAppName(
      (media?.attributes.app_name ?? media?.attributes.source) as string | undefined,
    );
    const subtitle = this._unavailable
      ? this._t("remote_unavailable")
      : on
        ? app
          ? `${this._t("remote_on")} · ${app}`
          : this._t("remote_on")
        : this._t("remote_off");

    const name =
      cfg.name ??
      (media?.attributes.friendly_name as string | undefined) ??
      (this._remoteEntity ? (this.hass?.states[this._remoteEntity]?.attributes.friendly_name as string) : undefined) ??
      "Remote";

    return html`
      <div class="m3-header">
        <div class="swatch"><ha-icon icon=${cfg.icon ?? this._defaults.icon}></ha-icon></div>
        <div class="m3-text-block">
          <div class="m3-name">${name}</div>
          <div class="m3-subtitle accent">${subtitle}</div>
        </div>
        ${this._renderPower()}
      </div>
    `;
  }

  /**
   * One button that toggles, morphing between a squircle and a circle.
   *
   * The shape carries the state, not just the colour: on a wall tablet seen
   * from across the room the fill is the first thing read, and the radius is
   * the second — two signals for the same bit, which is what makes it legible
   * without reading the label.
   */
  private _renderPower() {
    const cfg = this._config!;
    if (!this._caps.power) return nothing;
    const on = this._isOn;
    if (cfg.power_toggle === false) {
      return html`
        <div class="power-pair">
          <button class="power on" type="button" aria-label=${this._t("remote_turn_on")} @click=${() => this._power(true)}>
            <ha-icon icon="mdi:power"></ha-icon>
          </button>
          <button class="power" type="button" aria-label=${this._t("remote_turn_off")} @click=${() => this._power(false)}>
            <ha-icon icon="mdi:power-off"></ha-icon>
          </button>
        </div>
      `;
    }
    return html`
      <button
        class=${classMap({ power: true, on })}
        type="button"
        aria-label=${on ? this._t("remote_turn_off") : this._t("remote_turn_on")}
        aria-pressed=${on ? "true" : "false"}
        @click=${() => this._power(!on)}
      >
        <ha-icon icon="mdi:power"></ha-icon>
      </button>
    `;
  }

  private _power(on: boolean): void {
    if (!this.hass) return;
    const cfg = this._config!;
    if (this._config?.haptics !== false) fireHaptic(this, "medium");
    if (cfg.power_entity) {
      const domain = cfg.power_entity.split(".")[0];
      this.hass.callService(domain, on ? "turn_on" : "turn_off", { entity_id: cfg.power_entity });
      return;
    }
    const target = this._powerTarget(on);
    if (!target) return;
    this.hass.callService(target.split(".")[0], on ? "turn_on" : "turn_off", { entity_id: target });
  }

  /**
   * Which entity can perform *this* direction.
   *
   * The two are not interchangeable, and picking the media_player for both is
   * what broke switching a Samsung on: its `media_player` declares `TURN_OFF`
   * and not `TURN_ON`, because the TV's websocket cannot be reached once the
   * panel is off. The `remote` entity can — it wakes the set over the network
   * instead — so off goes to one and on to the other.
   *
   * Checked per direction rather than once, because an entity that supports
   * neither should hand over rather than throw "action not supported" at the
   * user, which is all the old code did.
   */
  private _powerTarget(on: boolean): string | undefined {
    const media = this._mediaEntity;
    const supported = media
      ? (this.hass?.states[media]?.attributes.supported_features as number | undefined)
      : undefined;
    return powerTarget(on, media, this._remoteEntity, supported);
  }

  // ---- now playing ----------------------------------------------------------

  private _renderNowPlaying() {
    const cfg = this._config!;
    const show = cfg.show_now_playing ?? this._defaults.showNowPlaying;
    if (!show || !this._isOn) return nothing;
    const media = this._mediaState;
    if (!media) return nothing;
    const title = media.attributes.media_title as string | undefined;
    const app = meaningfulAppName(
      (media.attributes.app_name ?? media.attributes.media_artist ?? media.attributes.source) as
        | string
        | undefined,
    );
    // The bar is for what is *playing*. Without a title nothing is, and the
    // app name alone is already in the header — rendering it here produced a
    // row reading "Default Media Receiver" twice over.
    if (!title) return nothing;

    // `_tick` is only here to make Lit re-render; the time comes from the clock.
    void this._tick;
    const position = currentPosition(media.attributes, media.state);
    const duration = Number(media.attributes.media_duration);
    const picture = media.attributes.entity_picture as string | undefined;
    const playing = media.state === "playing";
    const progress =
      position !== undefined && Number.isFinite(duration) && duration > 0
        ? Math.max(0, Math.min(1, position / duration))
        : undefined;

    const meta = [
      app,
      position !== undefined && Number.isFinite(duration) && duration > 0
        ? `${formatPosition(position)} / ${formatPosition(duration)}`
        : undefined,
    ]
      .filter(Boolean)
      .join(" · ");

    return html`
      <div class="now-playing">
        <div class="art">
          ${picture
            ? html`<img src=${picture} alt="" />`
            : html`<ha-icon icon=${this._defaults.icon}></ha-icon>`}
        </div>
        <div class="np-text">
          <div class="np-title">${title}</div>
          <div class="np-meta">${meta}</div>
        </div>
        ${this._canSend("play_pause")
          ? html`
              <button
                class="np-button"
                type="button"
                aria-label=${playing ? this._t("remote_pause") : this._t("remote_play")}
                @click=${() => this._send("play_pause")}
              >
                <ha-icon icon=${playing ? "mdi:pause" : "mdi:play"}></ha-icon>
              </button>
            `
          : nothing}
        ${progress !== undefined
          ? html`<div class="np-progress"><div style=${styleMap({ width: `${(progress * 100).toFixed(2)}%` })}></div></div>`
          : nothing}
      </div>
    `;
  }

  // ---- the three columns ----------------------------------------------------

  private _renderControls() {
    return html`
      <div class="controls">
        ${this._renderVolumeRocker()}
        ${this._renderDpad()}
        ${this._renderRightColumn()}
      </div>
    `;
  }

  /**
   * Volume as one rocker, not three buttons.
   *
   * The outer ends stay fully round and the inner joints are squared off, so
   * the three press targets read as a single object — the same trick the
   * climate card's connected setpoint uses.
   */
  private _renderVolumeRocker() {
    if (!this._caps.volume) return html`<div class="side spacer"></div>`;
    const cfg = this._config!;
    const muted = this._muted;
    return html`
      <div class="side">
        <div class="rocker">
          ${this._rockerButton("volume_up", "top", this._t("remote_volume_up"))}
          <button
            class=${classMap({ "rocker-btn": true, mid: true, muted, pressed: this._pressed === "mute" })}
            type="button"
            aria-label=${this._t("remote_mute")}
            aria-pressed=${muted ? "true" : "false"}
            ?disabled=${!this._canSend("mute")}
            @pointerdown=${() => this._press("mute")}
            @pointerup=${() => this._release()}
            @pointercancel=${() => this._release()}
            @pointerleave=${() => this._release()}
            @click=${() => this._send("mute")}
          >
            <ha-icon icon=${muted ? "mdi:volume-off" : "mdi:volume-high"}></ha-icon>
          </button>
          ${this._rockerButton("volume_down", "bottom", this._t("remote_volume_down"))}
        </div>
        ${cfg.show_rocker_labels === false ? nothing : html`<div class="rocker-label">VOL</div>`}
      </div>
    `;
  }

  private _rockerButton(key: RemoteKey, position: "top" | "bottom", label: string) {
    const id = `rocker-${key}`;
    return html`
      <button
        class=${classMap({ "rocker-btn": true, [position]: true, pressed: this._pressed === id })}
        type="button"
        aria-label=${label}
        ?disabled=${!this._canSend(key)}
        @pointerdown=${() => this._holdStart(key, id)}
        @pointerup=${() => this._release()}
        @pointercancel=${() => this._release()}
        @pointerleave=${() => this._release()}
      >
        <ha-icon icon=${KEY_ICONS[key]}></ha-icon>
      </button>
    `;
  }

  /**
   * The ring.
   *
   * Four SVG donut sectors with the arrow glyphs floated over them. The icons
   * are plain elements rather than SVG text because `ha-icon` is the suite's
   * rule everywhere, and they carry `pointer-events: none` so a tap on the
   * arrow still lands on the sector underneath it.
   */
  private _renderDpad() {
    if (!this._caps.sendCommand || !this._canSend("ok")) {
      // No directional keys on this device. Saying so beats a dead ring.
      return html`<div class="dpad-missing">${this._t("remote_no_dpad")}</div>`;
    }
    const size = this._dpadSize;
    const g = ringGeometry(size, REMOTE_DPAD_GAP_DEGREES);
    const ok = centerSize(g);

    return html`
      <div class="dpad" style=${styleMap({ width: `${size}px`, height: `${size}px` })}>
        <svg viewBox="0 0 ${size} ${size}" width=${size} height=${size} aria-hidden="true">
          ${DPAD_DIRECTIONS.map(
            (d) => svg`
              <path
                class="sector ${this._pressed === `dpad-${d}` ? "pressed" : ""}"
                d=${sectorPath(g, d)}
              ></path>`,
          )}
        </svg>
        ${DPAD_DIRECTIONS.map((d) => {
          const pos = arrowPosition(g, d);
          const key = d as RemoteKey;
          return html`
            <button
              class=${classMap({ "sector-btn": true, pressed: this._pressed === `dpad-${d}` })}
              type="button"
              style=${styleMap({ left: pos.left, top: pos.top })}
              aria-label=${this._t(`remote_${d}` as TranslationKey)}
              ?disabled=${!this._canSend(key)}
              @pointerdown=${(ev: PointerEvent) => {
                ev.preventDefault();
                this._holdStart(key, `dpad-${d}`);
              }}
              @pointerup=${() => this._release()}
              @pointercancel=${() => this._release()}
              @pointerleave=${() => this._release()}
            >
              <ha-icon icon=${KEY_ICONS[key]}></ha-icon>
            </button>
          `;
        })}
        <button
          class=${classMap({ ok: true, pressed: this._pressed === "ok" })}
          type="button"
          style=${styleMap({ width: `${ok}px`, height: `${ok}px` })}
          aria-label="OK"
          @pointerdown=${() => this._press("ok")}
          @pointerup=${() => this._release()}
          @pointercancel=${() => this._release()}
          @pointerleave=${() => this._release()}
          @click=${() => this._send("ok")}
        >
          OK
        </button>
      </div>
    `;
  }

  private _renderRightColumn() {
    const cfg = this._config!;
    const mode = cfg.right_column ?? "auto";
    const resolved = mode === "auto" ? this._defaults.rightColumn : mode;

    if (resolved === "custom") return this._renderCustomColumn(cfg.right_buttons ?? []);
    if (resolved === "channel") return this._renderChannelRocker();
    if (resolved === "assistant") return this._renderAssistantColumn();
    return html`<div class="side spacer"></div>`;
  }

  private _renderChannelRocker() {
    if (!this._canSend("channel_up")) return html`<div class="side spacer"></div>`;
    const cfg = this._config!;
    return html`
      <div class="side">
        <div class="rocker">
          ${this._rockerButton("channel_up", "top", this._t("remote_channel_up"))}
          <button
            class=${classMap({ "rocker-btn": true, mid: true, pressed: this._pressed === "chlist" })}
            type="button"
            aria-label=${this._t("remote_channel_list")}
            ?disabled=${!this._canSend("channel_list")}
            @pointerdown=${() => this._press("chlist")}
            @pointerup=${() => this._release()}
            @pointercancel=${() => this._release()}
            @pointerleave=${() => this._release()}
            @click=${() => this._send("channel_list")}
          >
            <ha-icon icon=${KEY_ICONS.channel_list}></ha-icon>
          </button>
          ${this._rockerButton("channel_down", "bottom", this._t("remote_channel_down"))}
        </div>
        ${cfg.show_rocker_labels === false ? nothing : html`<div class="rocker-label">CH</div>`}
      </div>
    `;
  }

  private _renderAssistantColumn() {
    const canAssist = this._canSend("assistant");
    const canType = this._defaults.textEntry && !!this._remoteEntity;
    const canSource = this._canSend("source");
    if (!canAssist && !canType && !canSource) return html`<div class="side spacer"></div>`;
    return html`
      <div class="side">
        ${canAssist
          ? html`
              <button
                class=${classMap({ assistant: true, active: this._assistantActive })}
                type="button"
                aria-label=${this._t("remote_assistant")}
                @click=${this._onAssistant}
              >
                <ha-icon icon=${KEY_ICONS.assistant}></ha-icon>
              </button>
            `
          : nothing}
        ${canSource
          ? html`
              <button class="side-btn" type="button" aria-label=${this._t("remote_source")} @click=${() => this._send("source")}>
                <ha-icon icon=${KEY_ICONS.source}></ha-icon>
              </button>
            `
          : nothing}
        ${canType
          ? html`
              <button class="side-btn" type="button" aria-label=${this._t("remote_keyboard")} @click=${() => (this._keyboardOpen = true)}>
                <ha-icon icon=${KEY_ICONS.keyboard}></ha-icon>
              </button>
            `
          : nothing}
      </div>
    `;
  }

  /**
   * The assistant button fills with Google's own four colours while it listens.
   *
   * It is a timer rather than real feedback, because nothing tells Home
   * Assistant when the microphone closed. The timeout is therefore a
   * *gesture*, not a status, and it is configurable for whoever finds the
   * default out of step with their device.
   */
  private readonly _onAssistant = () => {
    this._send("assistant");
    this._assistantActive = true;
    if (this._assistantTimer) window.clearTimeout(this._assistantTimer);
    this._assistantTimer = window.setTimeout(
      () => {
        this._assistantTimer = undefined;
        this._assistantActive = false;
      },
      this._config?.assistant_timeout ?? DEFAULT_REMOTE_ASSISTANT_TIMEOUT,
    );
  };

  private _renderCustomColumn(buttons: RemoteButtonConfig[]) {
    if (!buttons.length) return html`<div class="side spacer"></div>`;
    return html`
      <div class="side">
        ${buttons.map(
          (b) => html`
            <button
              class="side-btn"
              type="button"
              aria-label=${b.label ?? b.key ?? ""}
              @click=${() => this._runButton(b)}
            >
              <ha-icon icon=${b.icon ?? (b.key ? KEY_ICONS[b.key as RemoteKey] : "mdi:gesture-tap-button")}></ha-icon>
            </button>
          `,
        )}
      </div>
    `;
  }

  private _runButton(b: RemoteButtonConfig): void {
    if (b.action) {
      handleAction(this, this.hass, b.action, this._mediaEntity ?? this._remoteEntity);
      if (this._config?.haptics !== false) fireHaptic(this, "light");
      return;
    }
    if (b.key) this._send(b.key as RemoteKey);
  }

  // ---- rows -----------------------------------------------------------------

  private _renderFunctionRow() {
    const cfg = this._config!;
    const buttons: RemoteButtonConfig[] =
      cfg.function_buttons ?? this._defaults.functionKeys.map((key) => ({ key }));
    // A key this device does not have becomes an empty slot rather than
    // disappearing: the row is a fixed five columns, and letting it collapse
    // moves every other button under the user's thumb.
    if (!buttons.length) return nothing;
    // A row where no button works is five empty pills pretending to be a
    // control. The blank slot exists to keep a *partly* usable row from
    // shifting under the thumb, not to draw a row of nothing.
    const anyUsable = buttons.some((b) => !!b.action || (b.key && this._canSend(b.key as RemoteKey)));
    if (!anyUsable) return nothing;
    return html`
      <div class="row">
        ${buttons.map((b) => {
          const key = b.key as RemoteKey | undefined;
          const usable = !!b.action || (key && this._canSend(key));
          const id = `fn-${b.key ?? b.label ?? ""}`;
          return html`
            <button
              class=${classMap({ "row-btn": true, pressed: this._pressed === id, blank: !usable })}
              type="button"
              aria-label=${b.label ?? (key ? this._t(`remote_${key}` as TranslationKey) : "")}
              ?disabled=${!usable}
              @pointerdown=${() => usable && this._press(id)}
              @pointerup=${() => this._release()}
              @pointercancel=${() => this._release()}
              @pointerleave=${() => this._release()}
              @click=${() => usable && this._runButton(b)}
            >
              ${usable
                ? html`<ha-icon icon=${b.icon ?? (key ? KEY_ICONS[key] : "mdi:gesture-tap-button")}></ha-icon>`
                : nothing}
            </button>
          `;
        })}
      </div>
    `;
  }

  private _renderTransport() {
    const cfg = this._config!;
    const show = cfg.show_transport ?? this._defaults.showTransport;
    if (!show) return nothing;
    const keys: RemoteKey[] = ["previous", "play_pause", "next"];
    if (!keys.some((k) => this._canSend(k))) return nothing;
    return html`
      <div class="row transport">
        ${keys.map((key) => {
          const id = `tr-${key}`;
          const usable = this._canSend(key);
          return html`
            <button
              class=${classMap({ "row-btn": true, pressed: this._pressed === id, blank: !usable })}
              type="button"
              aria-label=${this._t(`remote_${key}` as TranslationKey)}
              ?disabled=${!usable}
              @pointerdown=${() => usable && this._press(id)}
              @pointerup=${() => this._release()}
              @pointercancel=${() => this._release()}
              @pointerleave=${() => this._release()}
              @click=${() => usable && this._send(key)}
            >
              ${usable ? html`<ha-icon icon=${KEY_ICONS[key]}></ha-icon>` : nothing}
            </button>
          `;
        })}
      </div>
    `;
  }

  private _renderNumpad() {
    const cfg = this._config!;
    if (!cfg.show_numpad) return nothing;
    if (!this._canSend("digit_1")) return nothing;
    const digits: RemoteKey[] = [
      "digit_1", "digit_2", "digit_3",
      "digit_4", "digit_5", "digit_6",
      "digit_7", "digit_8", "digit_9",
      "dash", "digit_0", "enter",
    ];
    return html`
      <div class="numpad">
        ${digits.map((key) => {
          const label = key.startsWith("digit_") ? key.slice(6) : key === "dash" ? "—" : "↵";
          const id = `np-${key}`;
          return html`
            <button
              class=${classMap({ "num-btn": true, pressed: this._pressed === id })}
              type="button"
              aria-label=${label}
              ?disabled=${!this._canSend(key)}
              @pointerdown=${() => this._press(id)}
              @pointerup=${() => this._release()}
              @pointercancel=${() => this._release()}
              @pointerleave=${() => this._release()}
              @click=${() => this._send(key)}
            >
              ${label}
            </button>
          `;
        })}
      </div>
    `;
  }

  // ---- apps -----------------------------------------------------------------

  private _renderApps() {
    const cfg = this._config!;
    if (cfg.show_apps === false) return nothing;
    let apps = cfg.apps ?? [];
    if (!apps.length) {
      // Nothing configured: offer the entity's own source list, which is the
      // only app list the card can know without being told.
      const sources = this._mediaState?.attributes.source_list as string[] | undefined;
      if (!sources?.length) return nothing;
      apps = sources.map((name) => ({ name }));
    }
    const max = cfg.max_apps ?? 0;
    const shown = max > 0 ? apps.slice(0, max) : apps;
    const style = cfg.app_style ?? this._defaults.appStyle;
    // The remote entity's own `current_activity` is asked first, because on an
    // Android TV it is the authoritative answer and the media entity is often
    // the wrong half: a box that also speaks Cast reports "Default Media
    // Receiver" from its cast player while SmartTube is what is on screen.
    const activity = this._remoteEntity
      ? (this.hass?.states[this._remoteEntity]?.attributes.current_activity as string | undefined)
      : undefined;
    const appName = (this._mediaState?.attributes.app_name as string | undefined) ?? activity;
    const appId =
      (this._mediaState?.attributes.app_id as string | undefined) ?? activity;
    const source = this._mediaState?.attributes.source as string | undefined;

    return html`
      <div class="apps-label">${this._t("remote_apps")}</div>
      <div class=${style === "tiles" ? "app-tiles" : "app-chips"}>
        ${shown.map((app) => this._renderApp(app, style, appName, source, appId, activity))}
      </div>
    `;
  }

  private _renderApp(
    app: RemoteAppConfig,
    style: "chips" | "tiles",
    appName: string | undefined,
    source: string | undefined,
    appId?: string,
    activity?: string,
  ) {
    const colorCss = appColor(app.name, app.color);
    // Three witnesses, because no single one is right on every device: the
    // player's app name, its app id, and the remote's current activity. A
    // package only ever matches the entry that names that package.
    const active =
      isAppActive(appName, source, app.name, app.app_id) ||
      (!!app.app_id && (appId === app.app_id || activity === app.app_id));
    const id = `app-${app.name}`;
    const vars = colorCss
      ? buildCssVars({
          "m3rc-app": resolveThemeColor(colorCss),
          "m3rc-app-tint": tintOn(this, resolveThemeColor(colorCss), undefined, active ? REMOTE_ACTIVE_TINT : REMOTE_CHIP_TINT),
        })
      : "";
    return html`
      <button
        class=${classMap({
          [style === "tiles" ? "app-tile" : "app-chip"]: true,
          pressed: this._pressed === id,
          active,
          branded: !!colorCss,
        })}
        type="button"
        style=${vars}
        aria-label=${app.name}
        aria-current=${active ? "true" : "false"}
        @pointerdown=${() => this._press(id)}
        @pointerup=${() => this._release()}
        @pointercancel=${() => this._release()}
        @pointerleave=${() => this._release()}
        @click=${() => this._launchApp(app)}
      >
        ${style === "tiles" && app.icon ? html`<ha-icon icon=${app.icon}></ha-icon>` : nothing}
        <span>${app.name}</span>
      </button>
    `;
  }

  private _launchApp(app: RemoteAppConfig): void {
    if (this._config?.haptics !== false) fireHaptic(this, "light");
    if (app.action) {
      handleAction(this, this.hass, app.action, this._mediaEntity ?? this._remoteEntity);
      return;
    }
    if (!this.hass || !this._mediaEntity) return;
    this.hass.callService("media_player", "select_source", {
      entity_id: this._mediaEntity,
      source: app.name,
    });
  }

  // ---- keyboard dialog ------------------------------------------------------

  /**
   * Text entry, which on Android TV is the single biggest everyday win.
   *
   * The integration types whatever command it does not recognise as a keycode,
   * so a search box on a television becomes a phone keyboard instead of
   * twenty-six presses of a d-pad.
   */
  /**
   * Built from plain elements rather than `ha-dialog` and `ha-textfield`.
   *
   * Home Assistant loads those lazily, and inside this card's shadow root —
   * nested again inside whatever popup the card is placed in — they were never
   * registered: the text field rendered as an unknown element with no height,
   * leaving a black sheet with two buttons floating at the top of it. An
   * `<input>` the card styles itself has no such dependency.
   */
  private _renderKeyboardDialog() {
    if (!this._keyboardOpen) return nothing;
    return html`
      <div
        class="kb-overlay"
        role="dialog"
        aria-modal="true"
        aria-label=${this._t("remote_keyboard")}
        @click=${(e: Event) => {
          // Only the backdrop closes; a click inside the sheet must not.
          if (e.target === e.currentTarget) this._closeKeyboard();
        }}
      >
        <div class="kb-sheet">
          <div class="kb-title">${this._t("remote_keyboard")}</div>
          <input
            class="kb-input"
            type="text"
            inputmode="search"
            autocomplete="off"
            spellcheck="false"
            placeholder=${this._t("remote_keyboard_label")}
            .value=${this._keyboardText}
            @input=${(e: Event) => (this._keyboardText = (e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => {
              // The card's own arrow-key handler must not see these.
              e.stopPropagation();
              if (e.key === "Enter") this._sendText();
              if (e.key === "Escape") this._closeKeyboard();
            }}
          />
          <div class="kb-actions">
            <button class="kb-btn" type="button" @click=${this._closeKeyboard}>
              ${this._t("remote_cancel")}
            </button>
            <button class="kb-btn primary" type="button" @click=${this._sendText}>
              ${this._t("remote_send")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private readonly _closeKeyboard = () => {
    this._keyboardOpen = false;
    this._keyboardText = "";
  };

  protected updated(changed: PropertyValues): void {
    // setConfig can run before `hass` is set, so the registry lookup has to be
    // retried once the card is actually connected to one.
    if (this.hass && !this._registryLoaded) void this._loadPlatform();
    // Focus the field as it appears, so the phone's keyboard comes up without
    // a second tap.
    if (changed.has("_keyboardOpen") && this._keyboardOpen) {
      const input = this.renderRoot.querySelector<HTMLInputElement>(".kb-input");
      input?.focus();
    }
  }

  private readonly _sendText = () => {
    const call = resolveTextEntry(this._keyboardText, this._profile, this._remoteEntity);
    if (call && this.hass) this.hass.callService(call.domain, call.service, call.data);
    this._keyboardText = "";
    this._keyboardOpen = false;
  };

  static styles = [
    glassCardStyles,
    cardHeaderStyles,
    css`
      /* Rounded on both: the frame is .card-inner's border, and ha-card's
         clip alone cut it away at the corners. */
      ha-card,
      .card-inner {
        border-radius: var(--m3rc-radius, 28px);
      }

      /* The width limit belongs on the card, not on .card-inner: the frame
         and fill are drawn by .card-inner and the corners by ha-card's clip,
         so a narrower .card-inner showed as a square box inside a round,
         empty card. */
      ha-card {
        color: var(--m3rc-text, var(--primary-text-color));
        max-width: ${REMOTE_MAX_WIDTH}px;
        margin: 0 auto;
      }

      .card-inner {
        gap: var(--m3-card-gap, 12px);
      }

      .card-inner:focus-visible {
        outline: 2px solid var(--m3rc-accent);
        outline-offset: -2px;
      }

      /* Off is not unavailable: most of these devices still take a key press
         in standby, and the one that wakes them is on this card. Dimmed, not
         disabled. */
      ha-card.off .body,
      ha-card.off .now-playing {
        opacity: 0.5;
      }

      ha-card.unavailable .body {
        opacity: 0.3;
        pointer-events: none;
      }

      ha-card.no-motion * {
        transition: none !important;
        animation: none !important;
      }

      .body {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      /* ---- header ---- */

      .swatch {
        flex-shrink: 0;
        width: ${REMOTE_HEADER_ICON_SIZE}px;
        height: ${REMOTE_HEADER_ICON_SIZE}px;
        border-radius: ${REMOTE_HEADER_ICON_RADIUS}px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--m3rc-accent-tint);
        color: var(--m3rc-accent);
      }

      .swatch ha-icon {
        --mdc-icon-size: 24px;
      }

      .m3-subtitle.accent {
        color: var(--m3rc-accent);
        opacity: 1;
        font-weight: 500;
      }

      .power-pair {
        display: flex;
        gap: 6px;
      }

      .power {
        flex-shrink: 0;
        width: ${REMOTE_POWER_SIZE}px;
        height: ${REMOTE_POWER_SIZE}px;
        border: none;
        border-radius: ${REMOTE_POWER_RADIUS_OFF}px;
        background: rgba(128, 128, 128, 0.18);
        color: var(--m3rc-text);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition:
          border-radius 400ms ${unsafeCSS(STANDARD_EASING)},
          background-color 400ms ${unsafeCSS(STANDARD_EASING)},
          color 400ms ${unsafeCSS(STANDARD_EASING)};
      }

      .power.on {
        border-radius: ${REMOTE_POWER_RADIUS_ON}px;
        background: var(--m3rc-accent);
        color: var(--m3rc-accent-ink);
      }

      .power ha-icon {
        --mdc-icon-size: 22px;
      }

      /* ---- now playing ---- */

      .now-playing {
        position: relative;
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: ${REMOTE_NOW_PLAYING_HEIGHT}px;
        padding: 0 9px;
        border-radius: ${REMOTE_NOW_PLAYING_RADIUS}px;
        background: var(--m3rc-accent-tint);
        overflow: hidden;
      }

      .art {
        flex-shrink: 0;
        width: ${REMOTE_NOW_PLAYING_ART}px;
        height: ${REMOTE_NOW_PLAYING_ART}px;
        border-radius: ${REMOTE_NOW_PLAYING_ART_RADIUS}px;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(128, 128, 128, 0.2);
        color: var(--m3rc-accent);
      }

      .art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .art ha-icon {
        --mdc-icon-size: 18px;
      }

      .np-text {
        flex: 1;
        min-width: 0;
      }

      .np-title {
        font-size: 12px;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .np-meta {
        font-size: 10px;
        opacity: 0.5;
        color: var(--m3rc-secondary-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }

      .np-button {
        flex-shrink: 0;
        width: ${REMOTE_NOW_PLAYING_BUTTON}px;
        height: ${REMOTE_NOW_PLAYING_BUTTON}px;
        border: none;
        border-radius: ${REMOTE_NOW_PLAYING_BUTTON_RADIUS}px;
        background: var(--m3rc-accent);
        color: var(--m3rc-accent-ink);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .np-button ha-icon {
        --mdc-icon-size: 19px;
      }

      .np-progress {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 2px;
        background: rgba(128, 128, 128, 0.25);
      }

      .np-progress div {
        height: 100%;
        background: var(--m3rc-accent);
      }

      /* ---- the three columns ---- */

      .controls {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .side {
        flex-shrink: 0;
        width: ${REMOTE_ROCKER_WIDTH}px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
      }

      .side.spacer {
        width: ${REMOTE_ROCKER_WIDTH}px;
      }

      .rocker {
        display: flex;
        flex-direction: column;
        gap: ${REMOTE_ROCKER_GAP}px;
        width: 100%;
      }

      .rocker-btn {
        width: 100%;
        border: none;
        background: rgba(128, 128, 128, 0.16);
        color: var(--m3rc-text);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition:
          border-radius 180ms ${unsafeCSS(STANDARD_EASING)},
          background-color 180ms ${unsafeCSS(STANDARD_EASING)};
      }

      /* Outer ends round, inner joints square: one rocker, three targets. */
      .rocker-btn.top {
        height: ${REMOTE_ROCKER_END_HEIGHT}px;
        border-radius: ${REMOTE_ROCKER_RADIUS_OUTER}px ${REMOTE_ROCKER_RADIUS_OUTER}px
          ${REMOTE_ROCKER_RADIUS_INNER}px ${REMOTE_ROCKER_RADIUS_INNER}px;
      }

      .rocker-btn.mid {
        height: ${REMOTE_ROCKER_MID_HEIGHT}px;
        border-radius: ${REMOTE_ROCKER_RADIUS_INNER}px;
      }

      .rocker-btn.bottom {
        height: ${REMOTE_ROCKER_END_HEIGHT}px;
        border-radius: ${REMOTE_ROCKER_RADIUS_INNER}px ${REMOTE_ROCKER_RADIUS_INNER}px
          ${REMOTE_ROCKER_RADIUS_OUTER}px ${REMOTE_ROCKER_RADIUS_OUTER}px;
      }

      .rocker-btn.muted {
        background: #e57368;
        color: #1c1c1c;
        border-radius: ${REMOTE_ROCKER_RADIUS_MUTED}px;
      }

      .rocker-btn.pressed {
        background: var(--m3rc-accent);
        color: var(--m3rc-accent-ink);
      }

      .rocker-btn[disabled] {
        opacity: 0.35;
        cursor: default;
      }

      .rocker-btn ha-icon {
        --mdc-icon-size: 20px;
      }

      .rocker-label {
        font-size: 8px;
        letter-spacing: 0.08em;
        opacity: 0.45;
        color: var(--m3rc-secondary-text);
      }

      .side-btn {
        width: 46px;
        height: 46px;
        border: none;
        border-radius: 16px;
        background: rgba(128, 128, 128, 0.16);
        color: var(--m3rc-text);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: border-radius 180ms ${unsafeCSS(STANDARD_EASING)};
      }

      .side-btn:active {
        border-radius: 10px;
      }

      .side-btn ha-icon {
        --mdc-icon-size: 20px;
      }

      .assistant {
        width: ${REMOTE_ASSISTANT_SIZE}px;
        height: ${REMOTE_ASSISTANT_SIZE}px;
        border: none;
        border-radius: ${REMOTE_ASSISTANT_RADIUS}px;
        background: rgba(128, 128, 128, 0.16);
        color: var(--m3rc-text);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition:
          border-radius 300ms ${unsafeCSS(STANDARD_EASING)},
          background 300ms ${unsafeCSS(STANDARD_EASING)};
      }

      .assistant.active {
        border-radius: ${REMOTE_ASSISTANT_RADIUS_ACTIVE}px;
        background: ${unsafeCSS(REMOTE_ASSISTANT_GRADIENT)};
        color: #fff;
      }

      .assistant ha-icon {
        --mdc-icon-size: 24px;
      }

      /* ---- the ring ---- */

      .dpad {
        position: relative;
        flex-shrink: 0;
      }

      .dpad svg {
        display: block;
      }

      /* Neutral grey, not white: white at 7% is invisible on a light theme,
         and the ring is the one control that cannot fall back to a border. */
      .sector {
        fill: rgba(128, 128, 128, ${REMOTE_SECTOR_TINT / 100});
        transition: fill 220ms ${unsafeCSS(STANDARD_EASING)};
      }

      .sector.pressed {
        fill: var(--m3rc-accent);
      }

      .sector-btn {
        position: absolute;
        transform: translate(-50%, -50%);
        width: 34px;
        height: 34px;
        border: none;
        background: transparent;
        color: var(--m3rc-text);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        /* The glyph must not swallow the press meant for the sector, but the
           button itself is the press target, so only the icon opts out. */
        transition: color 220ms ${unsafeCSS(STANDARD_EASING)};
      }

      .sector-btn ha-icon {
        pointer-events: none;
        --mdc-icon-size: 22px;
      }

      .sector-btn.pressed {
        color: var(--m3rc-accent-ink);
      }

      .sector-btn:focus-visible {
        outline: 2px solid var(--m3rc-accent);
        outline-offset: 2px;
        border-radius: 12px;
      }

      .ok {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        border: none;
        border-radius: 50%;
        background: var(--m3rc-accent);
        color: var(--m3rc-accent-ink);
        font-size: 15px;
        font-weight: 700;
        font-family: inherit;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition:
          border-radius 260ms ${unsafeCSS(STANDARD_EASING)},
          transform 260ms ${unsafeCSS(STANDARD_EASING)};
      }

      /* The circle-to-squircle morph is the card's visual anchor. */
      .ok.pressed {
        border-radius: ${REMOTE_OK_RADIUS_PRESSED}px;
        transform: translate(-50%, -50%) scale(0.94);
      }

      .dpad-missing {
        flex: 1;
        text-align: center;
        font-size: 11px;
        opacity: 0.5;
        color: var(--m3rc-secondary-text);
        padding: 20px 8px;
      }

      /* ---- rows ---- */

      .row {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 6px;
      }

      .row.transport {
        grid-template-columns: repeat(3, 1fr);
      }

      .row-btn {
        height: ${REMOTE_FUNCTION_HEIGHT}px;
        border: none;
        border-radius: ${REMOTE_FUNCTION_RADIUS}px;
        background: rgba(128, 128, 128, 0.16);
        color: var(--m3rc-text);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition:
          border-radius 180ms ${unsafeCSS(STANDARD_EASING)},
          background-color 180ms ${unsafeCSS(STANDARD_EASING)};
      }

      .row-btn.pressed {
        border-radius: ${REMOTE_FUNCTION_RADIUS_PRESSED}px;
        background: var(--m3rc-accent);
        color: var(--m3rc-accent-ink);
      }

      /* A key this device does not have: the slot stays, so nothing else
         moves under the thumb, but it is plainly not a button. */
      .row-btn.blank {
        background: rgba(128, 128, 128, 0.07);
        cursor: default;
      }

      .row-btn ha-icon {
        --mdc-icon-size: 21px;
      }

      /* ---- numpad ---- */

      .numpad {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 6px;
      }

      .num-btn {
        height: ${REMOTE_NUMPAD_HEIGHT}px;
        border: none;
        border-radius: ${REMOTE_NUMPAD_RADIUS}px;
        background: rgba(128, 128, 128, 0.16);
        color: var(--m3rc-text);
        font-size: 17px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        font-family: inherit;
        cursor: pointer;
        transition: border-radius 180ms ${unsafeCSS(STANDARD_EASING)};
      }

      .num-btn.pressed {
        border-radius: 10px;
        background: var(--m3rc-accent);
        color: var(--m3rc-accent-ink);
      }

      /* ---- apps ---- */

      .apps-label {
        font-size: 11px;
        opacity: 0.5;
        color: var(--m3rc-secondary-text);
        margin-top: 2px;
      }

      .app-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .app-chip {
        height: ${REMOTE_CHIP_HEIGHT}px;
        padding: 0 14px;
        border: none;
        border-radius: ${REMOTE_CHIP_RADIUS}px;
        background: rgba(128, 128, 128, 0.16);
        color: var(--m3rc-text);
        font-size: 12px;
        font-weight: 700;
        font-family: inherit;
        cursor: pointer;
        transition:
          border-radius 180ms ${unsafeCSS(STANDARD_EASING)},
          background-color 180ms ${unsafeCSS(STANDARD_EASING)};
      }

      .app-chip.branded {
        background: var(--m3rc-app-tint);
        color: var(--m3rc-app);
      }

      .app-chip.pressed {
        border-radius: ${REMOTE_CHIP_RADIUS_PRESSED}px;
      }

      .app-tiles {
        display: grid;
        grid-template-columns: repeat(${REMOTE_TILE_COLUMNS}, 1fr);
        gap: 6px;
      }

      .app-tile {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        padding: 9px 4px;
        border: none;
        border-radius: ${REMOTE_TILE_RADIUS}px;
        background: rgba(128, 128, 128, 0.16);
        color: var(--m3rc-text);
        font-size: 8px;
        font-weight: 600;
        font-family: inherit;
        cursor: pointer;
        min-width: 0;
        transition: border-radius 180ms ${unsafeCSS(STANDARD_EASING)};
      }

      .app-tile.branded {
        background: var(--m3rc-app-tint);
        color: var(--m3rc-app);
      }

      .app-tile.pressed {
        border-radius: ${REMOTE_TILE_RADIUS_PRESSED}px;
      }

      .app-tile ha-icon {
        --mdc-icon-size: 19px;
      }

      .app-tile span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 100%;
      }

      /* Whatever is in front gets an outline, so the card answers "what is
         running" without being asked. */
      .app-chip.active,
      .app-tile.active {
        outline: ${REMOTE_ACTIVE_OUTLINE}px solid var(--m3rc-app, var(--m3rc-accent));
        outline-offset: -${REMOTE_ACTIVE_OUTLINE}px;
      }

      /* ---- keyboard dialog ---- */

      .kb-overlay {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        background: rgba(0, 0, 0, 0.6);
      }

      .kb-sheet {
        width: 100%;
        max-width: 420px;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 20px;
        border-radius: 24px;
        background: var(--ha-card-background, var(--card-background-color, #1c1c1c));
        color: var(--m3rc-text, var(--primary-text-color));
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
      }

      .kb-title {
        font-size: 16px;
        font-weight: 700;
      }

      .kb-input {
        width: 100%;
        box-sizing: border-box;
        height: 48px;
        padding: 0 14px;
        border-radius: 14px;
        border: 1px solid rgba(127, 127, 127, 0.45);
        background: transparent;
        color: inherit;
        font-size: 16px;
        font-family: inherit;
      }

      .kb-input:focus {
        outline: none;
        border-color: var(--m3rc-accent);
      }

      .kb-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }

      .kb-btn {
        height: 40px;
        padding: 0 18px;
        border: none;
        border-radius: 20px;
        background: rgba(128, 128, 128, 0.18);
        color: var(--primary-text-color);
        font-size: 14px;
        font-weight: 600;
        font-family: inherit;
        cursor: pointer;
      }

      .kb-btn.primary {
        background: var(--m3rc-accent);
        color: var(--m3rc-accent-ink);
      }

      /* ---- narrow ---- */

      @media (max-width: ${REMOTE_NARROW_WIDTH}px) {
        .side,
        .side.spacer {
          width: ${REMOTE_ROCKER_WIDTH_NARROW}px;
        }
        .dpad {
          width: ${REMOTE_DPAD_MIN}px !important;
          height: ${REMOTE_DPAD_MIN}px !important;
        }
        .row {
          grid-template-columns: repeat(3, 1fr);
        }
        .app-tiles {
          grid-template-columns: repeat(4, 1fr);
        }
      }

      /* Safari 15 and anything else without color-mix: the tints resolve to
         unset, painting transparent rather than faded.
         Backticks are not allowed in here: this is a css template literal. */
      @supports not (color: color-mix(in srgb, red 50%, blue)) {
        .swatch {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .now-playing {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .app-chip.branded {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .app-tile.branded {
          background: var(--ha-card-background, var(--card-background-color));
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-remote-card": M3RemoteCard;
  }
}

const windowWithCards = window as unknown as Window & {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-remote-card",
  name: "M3 Remote Card",
  description:
    "Fernbedienung für Fernseher und Streaming-Geräte: Steuerkreuz als Ring, Lautstärkewippe, Apps und profilabhängige Tastenbelegung.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
