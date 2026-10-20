import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  M3ClimateCardMiniConfig,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  HvacMode,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_MODE_COLORS,
  DEFAULT_TEMP_STEP,
  DEFAULT_MINI_RADIUS,
  resolveCornerRadius,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import { glassCardStyles, glassCardClass } from "./shared/glass-card";
import { hassChangeMatters } from "./shared/should-update";
import { formatNumber } from "./shared/formatting";
import { renderMissingEntity } from "./shared/glass-card";
import { shouldAnimate } from "./shared/animation";
import { migrateAnimationsField } from "./shared/config-migration";
import { activateOnKey } from "./shared/a11y";
import { tintOn, tintInk, foregroundOn, foregroundColor , resolveThemeColor } from "./shared/color-config";
import { TemplatedCard } from "./shared/templated-card";
import {
  readClimateTarget,
  boundMode,
  nudgeRange,
  setTargetRange,
  setTargetTemperature,
  type ClimateTarget,
  type TargetBound,
} from "./shared/climate-target";

console.info(
  `%c M3-CLIMATE-CARD-MINI %c v${CARD_VERSION} `,
  "color: #222; background: #5dcaa5; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #5dcaa5; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

@customElement("m3-climate-card-mini")
export class M3ClimateCardMini extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3ClimateCardMiniConfig;

  // Which end of a band the minus/plus buttons move. A thermostat in
  // heat/cool holds two setpoints, and this tile has room for one pair of
  // buttons — so both numbers are printed and the buttons are aimed at the
  // one that is lit. Purely a view state: nothing is written to the config,
  // and a card that never sees a band never uses it.
  @state() private _bound: TargetBound = "low";

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-climate-card-mini-editor");
    return document.createElement(
      "m3-climate-card-mini-editor",
    ) as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(
    hass: HomeAssistant,
  ): M3ClimateCardMiniConfig {
    const climateEntity = Object.keys(hass?.states ?? {}).find((eid) =>
      eid.startsWith("climate."),
    );
    return {
      type: "custom:m3-climate-card-mini",
      entity: climateEntity ?? "",
      glass_background: true,
    };
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return hassChangeMatters(changed, this.hass, [
      this._config?.entity,
      this._config?.humidity_sensor,
    ]);
  }

  public setConfig(config: M3ClimateCardMiniConfig): void {
    if (!config.entity) {
      throw new Error(
        "Bitte eine climate-Entität auswählen / Please select a climate entity",
      );
    }
    this._config = migrateAnimationsField({
      glass_background: true,
      ...config,
    });
  }

  public getCardSize(): number {
    return 3;
  }

  public getGridOptions(): LovelaceGridOptions {
    return {
      columns: 6,
      rows: "auto",
      min_columns: 3,
      min_rows: 2,
    };
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _modeColor(mode: string): string {
    const override = (
      this._config?.mode_colors as Record<string, string> | undefined
    )?.[mode];
    const resolved =
      override || DEFAULT_MODE_COLORS[mode as HvacMode] || DEFAULT_MODE_COLORS.off;
    return resolveThemeColor(resolved);
  }

  private _resolveColor(value: string): string {
    return resolveThemeColor(value);
  }

  private _defaultIcon(hvacModes: string[]): string {
    const canHeat = hvacModes.includes("heat");
    const canCool = hvacModes.includes("cool") || hvacModes.includes("heat_cool");
    if (canHeat && !canCool) return "mdi:radiator";
    return "mdi:air-conditioner";
  }

  /**
   * The humidity for the status line, or undefined when there is none to show.
   *
   * Opt-in on purpose: a card that silently grew a third reading would be a
   * change to every existing dashboard that nobody asked for. Naming a sensor
   * is itself the request, so `humidity_sensor` implies `show_humidity` —
   * the flag on its own is for the thermostat that reports `current_humidity`.
   */
  private _readHumidity(attrs: Record<string, unknown>): number | undefined {
    const cfg = this._config;
    if (!cfg || (!cfg.humidity_sensor && cfg.show_humidity !== true)) return undefined;
    if (cfg.humidity_sensor) {
      const state = this.hass?.states[cfg.humidity_sensor];
      const value = state ? parseFloat(state.state) : Number.NaN;
      return Number.isFinite(value) ? value : undefined;
    }
    return typeof attrs.current_humidity === "number" ? attrs.current_humidity : undefined;
  }

  private _formatNumber(value: number, digits = 1): string {
    return formatNumber(this._language, value, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  private _fireMoreInfo(entityId?: string): void {
    if (!entityId) return;
    const event = new CustomEvent("hass-more-info", {
      bubbles: true,
      composed: true,
      detail: { entityId },
    });
    this.dispatchEvent(event);
  }

  private _handlePowerToggle(unavailable: boolean): void {
    if (unavailable || !this.hass || !this._config) return;
    this.hass.callService("homeassistant", "toggle", {
      entity_id: this._config.entity,
    });
  }

  private _handleStep(
    direction: 1 | -1,
    currentTemp: number,
    step: number,
    min: number,
    max: number,
    unavailable: boolean,
  ): void {
    if (unavailable || !this.hass || !this._config) return;
    let next = currentTemp + direction * step;
    next = Math.min(max, Math.max(min, next));
    next = Math.round(next / step) * step;
    setTargetTemperature(this.hass, this._config.entity, next);
  }

  /**
   * Moves one end of a band.
   *
   * `nudgeRange` does the clamping, including keeping the two bounds a step
   * apart, and `setTargetRange` sends both of them — an omitted bound is read
   * by several integrations as permission to reset it.
   */
  private _handleRangeStep(
    direction: 1 | -1,
    range: { low?: number; high?: number },
    step: number,
    min: number,
    max: number,
    unavailable: boolean,
  ): void {
    if (unavailable || !this.hass || !this._config) return;
    const next = nudgeRange(range, this._bound, direction * step, { step, min, max });
    if (!next) return;
    setTargetRange(this.hass, this._config.entity, next);
  }

  private _selectBound(bound: TargetBound): void {
    this._bound = bound;
  }

  /**
   * The ink and the well for one bound of a band.
   *
   * Both numbers carry their own colour at all times — that is what says which
   * end of the band each one is, and the pair is unreadable without it. The
   * selection is the fill: the lit bound sits in a well of its colour and is
   * measured against that well, the unlit one is coloured text measured
   * against the card. Neither changes size, so the eye is not pulled by the
   * selection alone.
   */
  private _boundPaint(bound: TargetBound): { ink: string; bg: string; on: string } {
    const color = this._modeColor(boundMode(bound));
    return {
      ink: foregroundColor(this, color),
      bg: tintOn(this, color, undefined, 22),
      on: tintInk(this, color, undefined, 22),
    };
  }

  /**
   * The bottom row: minus, the target, plus.
   *
   * A single setpoint gets the row this card has always had. A band gets both
   * numbers side by side in place of the one, because a tile this size has no
   * second pair of buttons to give each bound its own — tapping a number aims
   * the buttons at it instead.
   */
  private _renderStepper(
    target: ClimateTarget,
    limits: { step: number; min: number; max: number },
    unavailable: boolean,
    dimUnavailable: boolean,
  ) {
    const { step, min, max } = limits;
    const readout = (value: number | undefined) =>
      unavailable || value === undefined ? "–" : `${this._formatNumber(value)}°`;

    if (target.kind === "range") {
      const complete = target.low !== undefined && target.high !== undefined;
      const locked = dimUnavailable || !complete;
      const renderBound = (which: TargetBound, value: number | undefined) => {
        const selected = this._bound === which;
        const paint = this._boundPaint(which);
        return html`
          <button
            class="bound ${selected ? "selected" : ""}"
            style=${`--m3-bound-ink: ${paint.ink}; --m3-bound-bg: ${paint.bg}; --m3-bound-color: ${paint.on};`}
            ?disabled=${dimUnavailable}
            aria-pressed=${selected}
            aria-label=${this._t(
              which === "low" ? "target_temp_low" : "target_temp_high",
            )}
            @click=${() => this._selectBound(which)}
          >
            ${readout(value)}
          </button>
        `;
      };
      return html`
        <div
          class="stepper-row range"
          role="group"
          aria-label=${this._t("target_temp_range")}
        >
          <button
            class="stepper-btn minus"
            ?disabled=${locked}
            @click=${() =>
              this._handleRangeStep(-1, target, step, min, max, dimUnavailable)}
          >
            −
          </button>
          ${renderBound("low", target.low)} ${renderBound("high", target.high)}
          <button
            class="stepper-btn plus"
            ?disabled=${locked}
            @click=${() =>
              this._handleRangeStep(1, target, step, min, max, dimUnavailable)}
          >
            +
          </button>
        </div>
      `;
    }

    const targetTemp = target.value;
    return html`
      <div class="stepper-row">
        <button
          class="stepper-btn minus"
          ?disabled=${dimUnavailable || targetTemp === undefined}
          @click=${() =>
            targetTemp !== undefined &&
            this._handleStep(-1, targetTemp, step, min, max, dimUnavailable)}
        >
          −
        </button>
        <div
          class="stepper-value"
          role="button"
          tabindex="0"
          aria-label=${this._t("target_temperature")}
          @click=${() => this._fireMoreInfo(this._config?.entity)}
          @keydown=${activateOnKey(() =>
            this._fireMoreInfo(this._config?.entity),
          )}
        >
          ${readout(targetTemp)}
        </div>
        <button
          class="stepper-btn plus"
          ?disabled=${dimUnavailable || targetTemp === undefined}
          @click=${() =>
            targetTemp !== undefined &&
            this._handleStep(1, targetTemp, step, min, max, dimUnavailable)}
        >
          +
        </button>
      </div>
    `;
  }

  protected render() {
    if (!this._config || !this.hass) return nothing;

    const entity = this.hass.states[this._config.entity];

    if (!entity) {
      return renderMissingEntity(this._config.entity);
    }

    const attrs = entity.attributes ?? {};
    const unavailable =
      entity.state === "unavailable" || entity.state === "unknown";
    if (unavailable && this._config.unavailable_style === "hidden") {
      return nothing;
    }
    const dimUnavailable =
      unavailable && this._config.unavailable_style !== "normal";
    const currentMode = entity.state as HvacMode;
    const active = !unavailable && currentMode !== "off";
    const modeColor = this._modeColor(unavailable ? "off" : currentMode);
    const offColor = this._modeColor("off");

    const iconActiveColor = this._config.icon_active_color
      ? this._resolveColor(this._config.icon_active_color)
      : modeColor;
    const iconInactiveColor = this._config.icon_inactive_color
      ? this._resolveColor(this._config.icon_inactive_color)
      : offColor;
    const powerActiveColor = this._config.power_active_color
      ? this._resolveColor(this._config.power_active_color)
      : modeColor;
    const powerInactiveColor = this._config.power_inactive_color
      ? this._resolveColor(this._config.power_inactive_color)
      : offColor;
    const plusActiveColor = this._config.plus_active_color
      ? this._resolveColor(this._config.plus_active_color)
      : modeColor;
    const plusInactiveColor = this._config.plus_inactive_color
      ? this._resolveColor(this._config.plus_inactive_color)
      : offColor;
    const minusActiveColor = this._config.minus_active_color
      ? this._resolveColor(this._config.minus_active_color)
      : "var(--primary-text-color)";
    const minusInactiveColor = this._config.minus_inactive_color
      ? this._resolveColor(this._config.minus_inactive_color)
      : "var(--primary-text-color)";
    const plusColor = active ? plusActiveColor : plusInactiveColor;
    const minusColor = active ? minusActiveColor : minusInactiveColor;

    // Each of these glyphs sits in its own tinted well, so its colour is
    // measured against that well rather than against the card.
    const iconInactiveBg = tintOn(this, 
      iconInactiveColor,
      this._config.icon_inactive_opacity,
      14,
    );
    const iconActiveBg = tintOn(this, 
      iconActiveColor,
      this._config.icon_active_opacity,
      22,
    );
    const powerInactiveBg = tintOn(this, 
      powerInactiveColor,
      this._config.power_inactive_opacity,
      14,
    );
    const powerActiveBg = tintOn(this, 
      powerActiveColor,
      this._config.power_active_opacity,
      30,
    );
    const minusBg = tintOn(this, minusColor, this._config.minus_opacity, 8);
    const plusBg = tintOn(this, plusColor, this._config.plus_opacity, 20);

    const hvacModesRaw: string[] = Array.isArray(attrs.hvac_modes)
      ? attrs.hvac_modes
      : [];

    const name = this._config.name || attrs.friendly_name || this._config.entity;
    const icon = this._config.icon || this._defaultIcon(hvacModesRaw);

    const currentTemperature: number | undefined =
      typeof attrs.current_temperature === "number"
        ? attrs.current_temperature
        : undefined;
    const tempUnit = this.hass.config?.unit_system?.temperature ?? "°C";
    const modeLabel = unavailable
      ? this._t("unavailable")
      : (this._t(currentMode as TranslationKey) ?? currentMode);

    // Most thermostats carry no `current_humidity` at all — the ones here
    // that do are the exception — so the usual source is the room's own
    // sensor, named the same way the full card names it. Configuring one is
    // itself the request to show it; `show_humidity` alone covers the
    // thermostat that does report its own.
    const currentHumidity = this._readHumidity(attrs);
    const readings = [
      currentTemperature !== undefined
        ? `${this._formatNumber(currentTemperature)} ${tempUnit}`
        : undefined,
      currentHumidity !== undefined ? `${Math.round(currentHumidity)} %` : undefined,
    ].filter((part): part is string => !!part);
    // The mode goes last, so the line reads as "what it is, then what it is
    // doing" however many readings there turn out to be.
    const statusText = !unavailable && readings.length ? `${readings.join(" · ")} · ${modeLabel}` : modeLabel;

    // The attributes decide the shape of the target, not the mode: in
    // heat/cool a thermostat carries `target_temp_low` and `target_temp_high`
    // and no `temperature` at all, which this card used to read as "no target"
    // and print as a dash (issue #21).
    const target = readClimateTarget(attrs);
    const step = attrs.target_temp_step ?? DEFAULT_TEMP_STEP;
    const minTemp = attrs.min_temp ?? 7;
    const maxTemp = attrs.max_temp ?? 35;
    const radius = resolveCornerRadius(
      this._config.radius ?? DEFAULT_MINI_RADIUS,
      this._config.corners,
    );
    const animClass = shouldAnimate(this._config.animation) ? "" : "no-animations";

    return html`
      <ha-card
        style=${`--m3-mode-color: ${modeColor}; --m3-icon-active-color: ${foregroundOn(iconActiveColor, iconActiveBg)}; --m3-icon-inactive-color: ${foregroundOn(iconInactiveColor, iconInactiveBg)}; --m3-power-active-color: ${foregroundOn(powerActiveColor, powerActiveBg)}; --m3-power-inactive-color: ${foregroundOn(powerInactiveColor, powerInactiveBg)}; --m3-plus-color: ${plusColor}; --m3-minus-color: ${minusColor}; --m3-icon-inactive-bg: ${iconInactiveBg}; --m3-icon-active-bg: ${iconActiveBg}; --m3-power-inactive-bg: ${powerInactiveBg}; --m3-power-active-bg: ${powerActiveBg}; --m3-minus-bg: ${minusBg}; --m3-plus-bg: ${plusBg}; border-radius: ${radius};`}
        class=${dimUnavailable ? "unavailable" : ""}
      >
        <div
          class="card-inner ${glassCardClass(this._config.glass_background)} ${animClass}"
          style=${`border-radius: ${radius};`}
        >
          <div class="header">
            <div
              class="icon-swatch ${active ? "active" : ""}"
              role="button"
              tabindex="0"
              aria-label=${name}
              @click=${() => this._fireMoreInfo(this._config?.entity)}
              @keydown=${activateOnKey(() =>
                this._fireMoreInfo(this._config?.entity),
              )}
            >
              <ha-icon icon=${icon}></ha-icon>
            </div>
            <div
              class="text-block"
              role="button"
              tabindex="0"
              aria-label=${name}
              @click=${() => this._fireMoreInfo(this._config?.entity)}
              @keydown=${activateOnKey(() =>
                this._fireMoreInfo(this._config?.entity),
              )}
            >
              <div class="name">${name}</div>
              <div class="status">${statusText}</div>
            </div>
            <button
              class="power-btn ${active ? "active" : ""}"
              ?disabled=${dimUnavailable}
              aria-label="mdi:power"
              @click=${() => this._handlePowerToggle(dimUnavailable)}
            >
              <ha-icon icon="mdi:power"></ha-icon>
            </button>
          </div>

          ${this._renderStepper(
            target,
            { step, min: minTemp, max: maxTemp },
            unavailable,
            dimUnavailable,
          )}
        </div>
      </ha-card>
    `;
  }

  static styles = css`
    ${glassCardStyles}

    /* See the note in m3-button-card: ha-card is a size container, so a
       percentage height that does not resolve leaves it at 0. This card had no
       min-height at all, so in a masonry column it collapsed entirely — host
       included.

       112px is the smallest height at which the compact layout still fits
       without clipping — measured, not chosen. A floor has to be low enough
       that it never overrides a height someone configured: 168px, the natural
       full-layout height, looked right on its own but silently forced a
       configured 110px tile up to 168 and broke the compact mode that exists
       for exactly those sizes. The three sizes below 112px that this does
       raise were already clipping their own content before it. */
    :host {
      display: grid;
      min-height: 112px;
    }

    ha-card {
      border-radius: 28px;
      container-type: size;
    }

    /* .card-inner's glass/solid background and border come from
       glassCardStyles. Only the layout this card differs on is set here. */
    .card-inner {
      gap: 10px;
      padding: var(--m3-group-padding, 12px 10px);
      border-radius: 28px;
    }

    ha-card.unavailable .power-btn,
    ha-card.unavailable .stepper-row {
      opacity: 0.4;
      pointer-events: none;
    }

    .header {
      display: grid;
      grid-template-columns: auto 1fr auto;
      grid-template-areas:
        "icon .    power"
        "text text text";
      gap: 8px 10px;
      align-items: start;
    }

    .icon-swatch {
      grid-area: icon;
      flex-shrink: 0;
      width: 48px;
      height: 48px;
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--m3-icon-inactive-bg);
      color: var(--m3-icon-inactive-color);
      cursor: pointer;
      transition: all 0.35s cubic-bezier(0.2, 0, 0, 1);
    }

    .icon-swatch.active {
      background: var(--m3-icon-active-bg);
      color: var(--m3-icon-active-color);
    }

    .icon-swatch:focus-visible,
    .text-block:focus-visible,
    .stepper-value:focus-visible {
      outline: 2px solid var(--m3-icon-active-color, var(--primary-color));
      outline-offset: 2px;
      border-radius: 8px;
    }

    .icon-swatch ha-icon {
      --mdc-icon-size: 24px;
    }

    .power-btn {
      grid-area: power;
      flex-shrink: 0;
      width: 40px;
      height: 40px;
      border: none;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--m3-power-inactive-bg);
      color: var(--m3-power-inactive-color);
      cursor: pointer;
      padding: 0;
      transition: all 0.35s cubic-bezier(0.2, 0, 0, 1);
    }

    .power-btn:disabled {
      cursor: default;
    }

    .power-btn.active {
      border-radius: 50%;
      background: var(--m3-power-active-bg);
      color: var(--m3-power-active-color);
    }

    .power-btn ha-icon {
      --mdc-icon-size: 18px;
    }

    .card-inner.no-animations .icon-swatch,
    .card-inner.no-animations .power-btn,
    .card-inner.no-animations .stepper-btn,
    .card-inner.no-animations .bound {
      transition: none;
    }

    .card-inner.no-animations .stepper-btn:active {
      transform: none;
    }

    .text-block {
      grid-area: text;
      display: flex;
      flex-direction: column;
      gap: 2px;
      cursor: pointer;
      min-width: 0;
    }

    .name {
      font-size: 16px;
      font-weight: 700;
      line-height: 1.2;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--primary-text-color);
    }

    .status {
      font-size: 13px;
      opacity: 0.7;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--primary-text-color);
    }

    .stepper-row {
      display: flex;
      height: 40px;
      flex-shrink: 0;
      gap: 2px;
      margin-top: auto;
    }

    .stepper-btn {
      flex: 1;
      border: none;
      font-size: 18px;
      font-weight: 500;
      color: var(--primary-text-color);
      background: color-mix(in srgb, var(--primary-text-color) 8%, var(--ha-card-background, var(--card-background-color)));
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      transition:
        background 0.35s cubic-bezier(0.2, 0, 0, 1),
        border-radius 0.35s cubic-bezier(0.2, 0, 0, 1),
        transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .stepper-btn:active {
      transform: scale(0.88);
    }

    .stepper-btn:disabled {
      cursor: default;
    }

    .stepper-btn.minus {
      border-radius: 20px 8px 8px 20px;
      background: var(--m3-minus-bg);
    }

    .stepper-btn.plus {
      border-radius: 8px 20px 20px 8px;
      background: var(--m3-plus-bg);
    }

    .stepper-value {
      flex: 1.3;
      min-width: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      background: color-mix(in srgb, var(--primary-text-color) 4%, var(--ha-card-background, var(--card-background-color)));
      text-align: center;
      font-size: 16px;
      font-weight: 700;
      color: var(--primary-text-color);
      cursor: pointer;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* A band has two numbers where a single setpoint has one, and this row is
       40px tall on a tile meant to sit two-up on a phone — there is no room
       for a second pair of buttons. So the buttons shrink to the width of
       their glyph, both bounds are printed at full strength in the colour of
       the end they are, and the lit one is the one the buttons move. */
    .stepper-row.range .stepper-btn {
      flex: 0 0 40px;
    }

    .bound {
      flex: 1;
      min-width: 0;
      border: none;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      background: color-mix(in srgb, var(--primary-text-color) 4%, var(--ha-card-background, var(--card-background-color)));
      font-family: inherit;
      font-size: 15px;
      font-weight: 700;
      color: var(--m3-bound-ink, var(--primary-text-color));
      cursor: pointer;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      transition: all 0.35s cubic-bezier(0.2, 0, 0, 1);
    }

    /* Only the fill and the ink change between the two, never the size: the
       unlit bound is a number to read, not a number to squint at. */
    .bound.selected {
      background: var(--m3-bound-bg);
      color: var(--m3-bound-color);
    }

    .bound:disabled {
      cursor: default;
    }

    .bound:focus-visible {
      outline: 2px solid var(--m3-icon-active-color, var(--primary-color));
      outline-offset: -2px;
    }

    @container (max-width: 230px) {
      .stepper-row.range .stepper-btn {
        flex: 0 0 32px;
      }

      .bound {
        font-size: 13px;
      }
    }

    @container (max-height: 150px) {
      .header {
        grid-template-areas: "icon text power";
        align-items: center;
      }

      .icon-swatch {
        width: 32px;
        height: 32px;
        border-radius: 50%;
      }

      .icon-swatch ha-icon {
        --mdc-icon-size: 16px;
      }
    }

    @container (max-height: 150px) and (max-width: 230px) {
      .header {
        grid-template-columns: 1fr auto;
        grid-template-areas: "text power";
      }

      .icon-swatch {
        display: none;
      }
    }

    /* Safari gained color-mix() in 16.2, and an iPod touch 7 or an iPad Air 2
       stops at iOS 15. A plain declaration before each mix cannot serve as the
       fallback: every one of them contains var(), which defers the check until
       after substitution, where failure yields unset rather than the previous
       declaration — the tint did not fade, the fill disappeared entirely. This
       block is the one those browsers alone can see; the tint is what it gives
       up. Backticks are not allowed in here: this is a css template literal. */
    @supports not (color: color-mix(in srgb, red 50%, blue)) {
      .stepper-btn {
        background: var(--ha-card-background, var(--card-background-color));
      }
      .stepper-value {
        background: var(--ha-card-background, var(--card-background-color));
      }
      .bound {
        background: var(--ha-card-background, var(--card-background-color));
      }
    }
    `;
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-climate-card-mini": M3ClimateCardMini;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-climate-card-mini",
  name: "M3 Climate Card Mini",
  description:
    "Eine kompakte Material-3-inspirierte Klimakarte für climate-Entities, geeignet für zwei Kacheln nebeneinander auf schmalen Bildschirmen.",
  preview: true,
  documentationURL:
    "https://github.com/j0sp0r/m3-cards",
});
