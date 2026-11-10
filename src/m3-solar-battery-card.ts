import { LitElement, html, css, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HaActionConfig,
  HomeAssistant,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  M3SolarBatteryCardConfig,
  SolarBatteryChipConfig,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_SOLAR_BATTERY_BATTERY_COLOR,
  DEFAULT_SOLAR_BATTERY_HOUSE_COLOR,
  DEFAULT_SOLAR_BATTERY_ICON,
  DEFAULT_SOLAR_BATTERY_KW_THRESHOLD,
  DEFAULT_SOLAR_BATTERY_RADIUS,
  DEFAULT_SOLAR_BATTERY_SOLAR_COLOR,
  SOLAR_BATTERY_BAR_HEIGHT,
  SOLAR_BATTERY_HEADER_ICON,
  SOLAR_BATTERY_HEADER_ICON_RADIUS,
  SOLAR_BATTERY_ICON_TINT,
  SOLAR_BATTERY_MPPT_HEIGHT,
  SOLAR_BATTERY_TILE_ICON,
  SOLAR_BATTERY_TILE_ICON_RADIUS,
  SOLAR_BATTERY_TILE_ICON_TINT,
  SOLAR_BATTERY_TILE_RADIUS,
  SOLAR_BATTERY_TILE_RADIUS_ACTIVE,
  SOLAR_BATTERY_TILE_TINT,
  STATUS_PILL_TINT,
  resolveCornerRadius,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import { STANDARD_EASING, shouldAnimate } from "./shared/animation";
import {
  buildCssVars,
  fillColor,
  foregroundColor,
  foregroundOn,
  resolveCommonColors,
  resolveThemeColor,
  tintOn,
} from "./shared/color-config";
import { glassCardClass, glassCardStyles } from "./shared/glass-card";
import { hassChangeMatters } from "./shared/should-update";
import { activateOnKey } from "./shared/a11y";
import { openEntityDetail } from "./shared/entity-detail";
import { navigateTo, runHaAction } from "./shared/actions";
import { TemplatedCard } from "./shared/templated-card";
import { VisibleTicker } from "./shared/visible-ticker";
import { formatNumber, formatSpan } from "./shared/formatting";
import { chipStateText } from "./shared/info-chips";
import {
  batteryForecast,
  batteryNet,
  batteryPhase,
  clampPercent,
  combinePacks,
  formatPower,
  hasBatteryPower,
  idleThreshold,
  mpptReadings,
  peakMppt,
  readNumber,
  readPower,
  solarBatteryEntities,
  solarTotal,
  type BatteryForecast,
  type MpptReading,
  type SolarBatteryPhase,
} from "./shared/solar-battery";

const EASING = unsafeCSS(STANDARD_EASING);

console.info(
  `%c M3-SOLAR-BATTERY-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #81c784; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #81c784; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

const DASH = "–";

type TileKey = "solar" | "battery" | "house";

interface FlowTile {
  key: TileKey;
  icon: string;
  color: string;
  watts: number | undefined;
  signed: boolean;
  label: string;
  dim: boolean;
  entity: string | undefined;
  action: HaActionConfig | undefined;
}

/**
 * A balcony solar battery with its own inverter — EcoFlow STREAM, Anker
 * SOLIX, Zendure and the like — mapped entirely by config, so no integration
 * is assumed. How full, charging or supplying, until when; where the power
 * goes (solar → battery → house) and what each solar input brings. Grid
 * import is left out on purpose: the power summary card shows that.
 */
@customElement("m3-solar-battery-card")
export class M3SolarBatteryCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config?: M3SolarBatteryCardConfig;
  @state() private _now = Date.now();
  /** The bar grows in from empty once, after the first paint. */
  @state() private _barReady = false;
  private readonly _ticker = new VisibleTicker(this, (now) => {
    this._now = now;
  });

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-solar-battery-card-editor");
    return document.createElement("m3-solar-battery-card-editor") as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(hass: HomeAssistant): M3SolarBatteryCardConfig {
    const states = hass?.states ?? {};
    const soc =
      Object.keys(states).find(
        (e) => e.startsWith("sensor.") && states[e].attributes?.device_class === "battery" && /stream|solix|zendure|speicher|storage|home_battery|powerstream/i.test(e),
      ) ?? Object.keys(states).find((e) => e.startsWith("sensor.") && states[e].attributes?.device_class === "battery") ?? "";
    return { type: "custom:m3-solar-battery-card", soc };
  }

  public setConfig(config: M3SolarBatteryCardConfig): void {
    if (!config?.soc) throw new Error("m3-solar-battery-card: 'soc' is required");
    this._config = { glass_background: true, animation: "auto", ...config };
  }

  public getCardSize(): number {
    return 6;
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this._ticker.connect();
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._ticker.disconnect();
  }

  protected firstUpdated(): void {
    requestAnimationFrame(() => {
      this._barReady = true;
    });
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return hassChangeMatters(changed, this.hass, solarBatteryEntities(this._config));
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _time(ms: number): string {
    const hour12 =
      this.hass?.locale?.time_format === "12" ? true : this.hass?.locale?.time_format === "24" ? false : undefined;
    return new Intl.DateTimeFormat(this._language, { hour: "2-digit", minute: "2-digit", hour12 }).format(ms);
  }

  private _num(value: number, decimals: number): string {
    return formatNumber(this._language, value, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  private get _kw(): number {
    const t = this._config?.kw_threshold;
    return typeof t === "number" && t > 0 ? t : DEFAULT_SOLAR_BATTERY_KW_THRESHOLD;
  }

  private _power(watts: number, signed = false): string {
    const p = formatPower(this._language, watts, this._kw, signed);
    return `${p.value} ${p.unit}`;
  }

  private _run(action: HaActionConfig | undefined, entity: string | undefined): void {
    if (!this.hass) return;
    if (!action && !entity) return;
    runHaAction(this.hass, action, {
      entityId: entity,
      fireMoreInfo: (id) => openEntityDetail(this, id ?? entity),
      navigate: (path) => navigateTo(this, path),
      source: this,
    });
  }

  // ---- render -----------------------------------------------------------------

  protected render() {
    const cfg = this._config;
    if (!cfg || !this.hass) return nothing;
    const states = this.hass.states;

    const idle = idleThreshold(cfg);
    const reserve = clampPercent(readNumber(states, cfg.reserve) ?? 0);
    const chargeLimit = clampPercent(readNumber(states, cfg.charge_limit) ?? 100);
    const mainSoc = readNumber(states, cfg.soc);
    const extras = (cfg.batteries ?? []).filter((b) => b && b.soc);
    const pack = combinePacks(
      { soc: mainSoc, capacity: cfg.capacity_kwh },
      extras.map((b) => ({ soc: readNumber(states, b.soc), capacity: b.capacity_kwh })),
    );
    const soc = pack.soc !== undefined ? clampPercent(pack.soc) : undefined;
    const net = batteryNet(cfg, states);
    const phase = batteryPhase(net, soc, chargeLimit, idle);
    const forecast =
      cfg.show_forecast === false
        ? undefined
        : batteryForecast({ phase, soc, capacityKwh: pack.capacity, net, reserve, chargeLimit, now: this._now });

    const solarColor = resolveThemeColor(cfg.solar_color ?? DEFAULT_SOLAR_BATTERY_SOLAR_COLOR);
    const batteryColor = resolveThemeColor(cfg.battery_color ?? DEFAULT_SOLAR_BATTERY_BATTERY_COLOR);
    const houseColor = resolveThemeColor(cfg.house_color ?? DEFAULT_SOLAR_BATTERY_HOUSE_COLOR);
    const neutral = "var(--secondary-text-color)";
    const statusColor =
      phase === "charging" || phase === "full" ? batteryColor : phase === "discharging" ? houseColor : neutral;

    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(cfg);
    const radius = resolveCornerRadius(cfg.radius ?? DEFAULT_SOLAR_BATTERY_RADIUS, cfg.corners);
    const tint = cfg.flow_tint_opacity;
    const iconBg = tintOn(this, batteryColor, undefined, SOLAR_BATTERY_ICON_TINT);
    const pillBg = tintOn(this, statusColor, undefined, STATUS_PILL_TINT);
    const batteryFill = fillColor(this, batteryColor);
    const solarFill = fillColor(this, solarColor);
    const track = tintOn(this, "var(--primary-text-color)", undefined, 8);

    const cssVars = buildCssVars({
      "m3p-text": textColorCss,
      "m3p-secondary-text": secondaryTextColorCss,
      "sb-icon-bg": iconBg,
      "sb-icon-ink": foregroundOn(batteryColor, iconBg, 3, this),
      "sb-pill-bg": pillBg,
      "sb-pill-ink": foregroundOn(statusColor, pillBg, 4.5, this),
      "sb-soc": foregroundColor(this, batteryColor),
      "sb-fill": batteryFill,
      "sb-solar-fill": solarFill,
      "sb-track": track,
      "sb-chip-bg": tintOn(this, "var(--primary-text-color)", undefined, 7),
      "sb-solar-dot": foregroundColor(this, solarColor),
      "sb-house-dot": foregroundColor(this, houseColor),
      "sb-battery-dot": foregroundColor(this, batteryColor),
      "sb-tile-solar-bg": tintOn(this, solarColor, tint, SOLAR_BATTERY_TILE_TINT),
      "sb-tile-battery-bg": tintOn(this, batteryColor, tint, SOLAR_BATTERY_TILE_TINT),
      "sb-tile-house-bg": tintOn(this, houseColor, tint, SOLAR_BATTERY_TILE_TINT),
    });

    const animate = shouldAnimate(cfg.animation);
    const name = cfg.name || this._t("sb_default_name");

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(cfg.glass_background)} ${animate ? "" : "no-animations"}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          ${this._renderHeader(name, phase, soc)}
          ${this._renderHero(soc, pack.capacity, phase, net, forecast)}
          ${cfg.show_bar === false ? nothing : this._renderBar(soc, reserve, chargeLimit, phase)}
          ${cfg.show_flow === false ? nothing : this._renderFlow(net, phase, idle, solarColor, batteryColor, houseColor)}
          ${cfg.show_mppt === false ? nothing : this._renderMppt()}
          ${this._renderExtras()}
          ${this._renderChips()}
        </div>
      </ha-card>
    `;
  }

  private _batteryIcon(soc: number | undefined, phase: SolarBatteryPhase): string {
    if (this._config?.icon) return this._config.icon;
    if (soc === undefined) return phase === "charging" ? "mdi:battery-charging" : DEFAULT_SOLAR_BATTERY_ICON;
    const step = Math.round(soc / 10) * 10;
    if (phase === "charging") return step >= 100 ? "mdi:battery-charging-100" : step <= 0 ? "mdi:battery-charging-outline" : `mdi:battery-charging-${step}`;
    if (step >= 100) return "mdi:battery";
    if (step <= 0) return "mdi:battery-outline";
    return `mdi:battery-${step}`;
  }

  private _phaseText(phase: SolarBatteryPhase): string {
    return this._t(
      phase === "charging" ? "sb_charging" : phase === "discharging" ? "sb_supplying" : phase === "full" ? "sb_full" : "sb_ready",
    );
  }

  private _renderHeader(name: string, phase: SolarBatteryPhase, soc: number | undefined) {
    const cfg = this._config!;
    const modeState = cfg.mode ? this.hass!.states[cfg.mode] : undefined;
    const modeText =
      modeState && modeState.state !== "unavailable" && modeState.state !== "unknown"
        ? chipStateText(this.hass, this._language, modeState, modeState.state)
        : undefined;
    const capacity = this._config?.capacity_kwh;
    const totalCapacity =
      capacity && (cfg.batteries ?? []).length
        ? capacity + (cfg.batteries ?? []).reduce((sum, b) => sum + (b?.capacity_kwh ?? 0), 0)
        : capacity;
    const subtitle = [modeText ?? (cfg.subtitle || undefined), totalCapacity ? `${this._num(totalCapacity, 2)} kWh` : undefined]
      .filter(Boolean)
      .join(" · ");
    const phaseText = this._phaseText(phase);
    const pillIcon =
      phase === "charging" ? "mdi:lightning-bolt" : phase === "discharging" ? "mdi:home-lightning-bolt-outline" : phase === "full" ? "mdi:check" : "mdi:pause";
    const onHeader = () => this._run(cfg.tap_action, cfg.soc);
    return html`
      <div class="header">
        <div
          class="squircle"
          role="button"
          tabindex="0"
          aria-label=${name}
          @click=${onHeader}
          @keydown=${activateOnKey(onHeader)}
        >
          <ha-icon icon=${this._batteryIcon(soc, phase)}></ha-icon>
        </div>
        <div class="text">
          <div class="title">${name}</div>
          ${subtitle ? html`<div class="subtitle">${subtitle}</div>` : nothing}
        </div>
        <span class="pill phase-${phase}" role="status" aria-live="polite">
          <ha-icon icon=${pillIcon}></ha-icon>${phaseText}
        </span>
      </div>
    `;
  }

  private _renderHero(
    soc: number | undefined,
    capacity: number | undefined,
    phase: SolarBatteryPhase,
    net: number | undefined,
    forecast: BatteryForecast | undefined,
  ) {
    const stored = soc !== undefined && capacity ? (soc / 100) * capacity : undefined;
    const idle = idleThreshold(this._config!);
    const moving = net !== undefined && Math.abs(net) > idle && (phase === "charging" || phase === "discharging");
    let forecastText: string | undefined;
    if (forecast) {
      if (forecast.beyond) forecastText = this._t(forecast.kind === "full" ? "sb_full_beyond" : "sb_lasts_beyond");
      else if (forecast.at !== undefined)
        forecastText = this._t(forecast.kind === "full" ? "sb_full_at" : "sb_lasts_until").replace("{time}", this._time(forecast.at));
    }
    const rateText = moving
      ? this._t(phase === "charging" ? "sb_charging_with" : "sb_discharging_with").replace("{power}", this._power(Math.abs(net!)))
      : undefined;
    return html`
      <div class="hero">
        <div class="soc-block">
          <div class="soc" aria-label=${soc === undefined ? DASH : `${Math.round(soc)} %`}>
            ${soc === undefined ? DASH : html`${Math.round(soc)}<span class="soc-unit">%</span>`}
          </div>
          ${stored !== undefined
            ? html`<div class="stored">${this._t("sb_stored").replace("{kwh}", this._num(stored, 2))}</div>`
            : nothing}
        </div>
        ${forecastText || rateText
          ? html`<div class="forecast">
              ${forecastText ? html`<div class="forecast-main">${forecastText}</div>` : nothing}
              ${rateText ? html`<div class="forecast-rate">${rateText}</div>` : nothing}
            </div>`
          : nothing}
      </div>
    `;
  }

  private _renderBar(soc: number | undefined, reserve: number, chargeLimit: number, phase: SolarBatteryPhase) {
    const width = soc === undefined || !this._barReady ? 0 : soc;
    const leftLabel = reserve > 0 ? this._t("sb_reserve").replace("{n}", this._num(reserve, 0)) : "0 %";
    const rightLabel = chargeLimit < 100 ? this._t("sb_limit").replace("{n}", this._num(chargeLimit, 0)) : "100 %";
    return html`
      <div class="bar-block">
        <div
          class="bar"
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow=${soc === undefined ? nothing : Math.round(soc)}
          aria-label=${this._t("sb_soc_label")}
        >
          <div class="bar-fill ${phase === "charging" ? "striped" : ""}" style=${`width: ${width}%;`}></div>
          ${reserve > 0 ? html`<div class="marker" style=${`left: ${reserve}%;`}></div>` : nothing}
          ${chargeLimit < 100 ? html`<div class="marker" style=${`left: ${chargeLimit}%;`}></div>` : nothing}
        </div>
        <div class="bar-labels">
          <span class="bar-label" style=${reserve > 0 ? `left: ${reserve}%; transform: translateX(-${Math.min(50, reserve * 4)}%);` : "left: 0;"}>${leftLabel}</span>
          <span class="bar-label end" style=${chargeLimit < 100 ? `right: ${100 - chargeLimit}%; transform: translateX(${Math.min(50, (100 - chargeLimit) * 4)}%);` : "right: 0;"}>${rightLabel}</span>
        </div>
      </div>
    `;
  }

  private _renderFlow(
    net: number | undefined,
    phase: SolarBatteryPhase,
    idle: number,
    solarColor: string,
    batteryColor: string,
    houseColor: string,
  ) {
    const cfg = this._config!;
    const states = this.hass!.states;
    const readings = mpptReadings(cfg, states);
    const tiles: FlowTile[] = [];
    const hasSolar = !!cfg.solar_power || readings.length > 0;
    const solar = hasSolar ? solarTotal(cfg, states, readings) : undefined;
    if (hasSolar) {
      tiles.push({
        key: "solar",
        icon: "mdi:solar-power-variant",
        color: solarColor,
        watts: solar,
        signed: false,
        label: this._t("sb_solar"),
        dim: solar === undefined || solar <= idle,
        entity: cfg.solar_power ?? readings[0]?.entity,
        action: cfg.solar_tap_action,
      });
    }
    if (hasBatteryPower(cfg)) {
      tiles.push({
        key: "battery",
        icon: phase === "charging" ? "mdi:battery-charging" : "mdi:battery",
        color: batteryColor,
        watts: net,
        // Below the idle threshold a "+4 W" sign claims a direction that is not there.
        signed: phase === "charging" || phase === "discharging",
        label: this._t(phase === "charging" ? "sb_charge" : phase === "discharging" ? "sb_discharge" : "sb_idle"),
        dim: false,
        entity: cfg.battery_power ?? (phase === "discharging" ? cfg.discharge_power : cfg.charge_power) ?? cfg.charge_power ?? cfg.discharge_power,
        action: cfg.battery_tap_action,
      });
    }
    const output = cfg.output_power ? readPower(states, cfg.output_power) : undefined;
    if (cfg.output_power) {
      tiles.push({
        key: "house",
        icon: "mdi:home-lightning-bolt-outline",
        color: houseColor,
        watts: output,
        signed: false,
        label: this._t(output !== undefined && output < -idle ? "sb_from_house" : "sb_house"),
        dim: false,
        entity: cfg.output_power,
        action: cfg.output_tap_action,
      });
    }
    if (!tiles.length) return nothing;

    // A link carries power when its source side moves more than the idle
    // threshold: solar into the battery, the inverter into the house — or
    // back out of it, when a battery charges from the grid through its AC side.
    const link = (from: FlowTile, to: FlowTile): { dir: "fwd" | "back" | "none"; color: string } => {
      if (to.key === "house") {
        if (output === undefined) return { dir: "none", color: "" };
        if (output > idle) return { dir: "fwd", color: "var(--sb-house-dot)" };
        if (output < -idle) return { dir: "back", color: "var(--sb-house-dot)" };
        return { dir: "none", color: "" };
      }
      if (from.key === "solar" && to.key === "battery") {
        return solar !== undefined && solar > idle ? { dir: "fwd", color: "var(--sb-solar-dot)" } : { dir: "none", color: "" };
      }
      return { dir: "none", color: "" };
    };

    const flowLabel = tiles
      .map((t) => `${t.label} ${t.watts === undefined ? DASH : this._power(t.signed ? t.watts : Math.abs(t.watts), t.signed)}`)
      .join(", ");

    const parts: TemplateResult[] = [];
    tiles.forEach((tile, i) => {
      if (i > 0) {
        const l = link(tiles[i - 1], tile);
        parts.push(html`<div class="link ${l.dir}" style=${l.color ? `--sb-dot: ${l.color};` : ""} aria-hidden="true">
          ${l.dir === "none" ? html`<span class="dash"></span>` : html`<span class="dot"></span><span class="dot"></span><span class="dot"></span>`}
        </div>`);
      }
      parts.push(this._renderTile(tile));
    });

    return html`<div class="flow" role="group" aria-label=${`${this._t("sb_flow_label")}: ${flowLabel}`}>${parts}</div>`;
  }

  private _renderTile(tile: FlowTile) {
    const value =
      tile.watts === undefined
        ? undefined
        : formatPower(this._language, tile.signed ? tile.watts : Math.abs(tile.watts), this._kw, tile.signed);
    const iconBg = tintOn(this, tile.color, this._config?.flow_tint_opacity, SOLAR_BATTERY_TILE_ICON_TINT);
    const tileBg = tintOn(this, tile.color, this._config?.flow_tint_opacity, SOLAR_BATTERY_TILE_TINT);
    const run = () => this._run(tile.action, tile.entity);
    return html`
      <div
        class="tile ${tile.dim ? "dim" : ""}"
        style=${`background: var(--sb-tile-${tile.key}-bg);`}
        role="button"
        tabindex="0"
        aria-label=${`${tile.label} ${value ? `${value.value} ${value.unit}` : DASH}`}
        @click=${run}
        @keydown=${activateOnKey(run)}
      >
        <div class="tile-icon" style=${`background: ${iconBg}; color: ${foregroundOn(tile.color, iconBg, 3, this)};`}>
          <ha-icon icon=${tile.icon}></ha-icon>
        </div>
        <div class="tile-value" style=${`color: ${foregroundOn(tile.color, tileBg, 4.5, this)};`}>
          ${value ? html`${value.value}<span class="tile-unit">${value.unit}</span>` : DASH}
        </div>
        <div class="tile-label">${tile.label}</div>
      </div>
    `;
  }

  private _renderMppt() {
    const cfg = this._config!;
    const readings = mpptReadings(cfg, this.hass!.states);
    if (!readings.length) return nothing;
    const noSun = readings.every((r) => r.watts === undefined || r.watts <= 0);
    if (noSun && cfg.hide_mppt_without_sun) return nothing;
    const peak = peakMppt(readings);
    const side = peak ? this._t("sb_peak").replace("{name}", peak.name).replace("{power}", this._power(peak.watts!)) : this._t("sb_no_sun");
    return html`
      <div class="section">
        <div class="section-head">
          <span class="section-title">${this._t("sb_inputs")}</span>
          <span class="section-side">${side}</span>
        </div>
        <div class="mppt">${readings.map((r, i) => this._renderColumn(r, cfg.mppt?.[i]?.tap_action))}</div>
      </div>
    `;
  }

  private _renderColumn(r: MpptReading, action: HaActionConfig | undefined) {
    const run = () => this._run(action, r.entity);
    const text = r.watts === undefined ? DASH : this._power(r.watts);
    return html`
      <div
        class="column"
        role="button"
        tabindex="0"
        aria-label=${`${r.name} ${text}`}
        @click=${run}
        @keydown=${activateOnKey(run)}
      >
        <div class="column-track">
          <div class="column-fill" style=${`height: ${this._barReady ? r.fill * 100 : 0}%;`}></div>
        </div>
        <div class="column-value">${text}</div>
        <div class="column-label">${r.name}</div>
      </div>
    `;
  }

  private _renderExtras() {
    const cfg = this._config!;
    const extras = (cfg.batteries ?? []).filter((b) => b && b.soc);
    if (!extras.length) return nothing;
    return html`
      <div class="section">
        <div class="section-head"><span class="section-title">${this._t("sb_batteries")}</span></div>
        <div class="extras">
          ${extras.map((b, i) => {
            const soc = readNumber(this.hass!.states, b.soc);
            const name = b.name ?? (this.hass!.states[b.soc]?.attributes?.friendly_name as string | undefined) ?? `${this._t("sb_battery")} ${i + 2}`;
            const run = () => this._run(b.tap_action, b.soc);
            return html`<div class="extra" role="button" tabindex="0" @click=${run} @keydown=${activateOnKey(run)}>
              <span class="extra-name">${name}</span>
              <div class="extra-bar"><div class="extra-fill" style=${`width: ${soc === undefined || !this._barReady ? 0 : clampPercent(soc)}%;`}></div></div>
              <span class="extra-value">${soc === undefined ? DASH : `${Math.round(soc)} %`}</span>
            </div>`;
          })}
        </div>
      </div>
    `;
  }

  private _chipText(chip: SolarBatteryChipConfig): string | undefined {
    if (chip.template !== undefined) return [chip.name, chip.template].filter(Boolean).join(" ");
    if (!chip.entity) return undefined;
    const st = this.hass!.states[chip.entity];
    const name = chip.name ?? (st?.attributes?.friendly_name as string | undefined);
    if (!st || st.state === "unavailable" || st.state === "unknown") return [name, DASH].filter(Boolean).join(" ");
    let value: string;
    const numeric = Number(st.state);
    const ownUnit = String(st.attributes?.unit_of_measurement ?? "").toLowerCase();
    const perMs: Record<string, number> = { d: 86_400_000, h: 3_600_000, min: 60_000, s: 1000 };
    if (Number.isFinite(numeric) && !chip.unit && perMs[ownUnit] !== undefined) {
      // "1 Tg. 8 Std." instead of "1.935 min": a remaining time reads as a span.
      value = numeric > 0 ? formatSpan(numeric * perMs[ownUnit], this._language) : `0 ${ownUnit}`;
    } else if (Number.isFinite(numeric)) {
      const decimals = Math.min(2, (st.state.split(".")[1] ?? "").length);
      const unit = chip.unit ?? (st.attributes?.unit_of_measurement as string | undefined);
      value = `${this._num(numeric, decimals)}${unit ? ` ${unit}` : ""}`;
    } else {
      value = chipStateText(this.hass, this._language, st, st.state) + (chip.unit ? ` ${chip.unit}` : "");
    }
    return [name, value].filter(Boolean).join(" ");
  }

  private _renderChips() {
    const chips = (this._config?.chips ?? []).filter((c) => c && (c.entity || c.template !== undefined));
    if (!chips.length) return nothing;
    return html`<div class="chips">
      ${chips.map((chip) => {
        const text = this._chipText(chip);
        if (!text) return nothing;
        const color = chip.color ? resolveThemeColor(chip.color) : undefined;
        const clickable = !!chip.entity || !!chip.tap_action;
        const run = () => this._run(chip.tap_action, chip.entity);
        return html`<span
          class="chip ${clickable ? "clickable" : ""}"
          role=${clickable ? "button" : nothing}
          tabindex=${clickable ? "0" : nothing}
          @click=${clickable ? run : nothing}
          @keydown=${clickable ? activateOnKey(run) : nothing}
        >
          ${chip.icon ? html`<ha-icon icon=${chip.icon} style=${color ? `color: ${foregroundColor(this, color)};` : ""}></ha-icon>` : nothing}
          <span>${text}</span>
        </span>`;
      })}
    </div>`;
  }

  static styles = [
    glassCardStyles,
    css`
      /* ---- header ---- */
      .header {
        display: flex;
        align-items: center;
        gap: 14px;
        min-width: 0;
      }

      .squircle {
        flex-shrink: 0;
        width: ${unsafeCSS(SOLAR_BATTERY_HEADER_ICON)}px;
        height: ${unsafeCSS(SOLAR_BATTERY_HEADER_ICON)}px;
        border-radius: ${unsafeCSS(SOLAR_BATTERY_HEADER_ICON_RADIUS)}px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--sb-icon-bg);
        color: var(--sb-icon-ink);
        --mdc-icon-size: 28px;
        cursor: pointer;
      }

      .squircle:focus-visible,
      .tile:focus-visible,
      .column:focus-visible,
      .chip:focus-visible,
      .extra:focus-visible {
        outline: 2px solid var(--sb-soc);
        outline-offset: 2px;
      }

      .text {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .title {
        font-size: 18px;
        font-weight: 700;
        line-height: 1.2;
        color: var(--m3p-text, var(--primary-text-color));
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .subtitle {
        font-size: 13px;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .pill {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 36px;
        padding: 0 14px;
        border-radius: 18px;
        background: var(--sb-pill-bg);
        color: var(--sb-pill-ink);
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
        --mdc-icon-size: 16px;
        transition: background-color 300ms ${EASING}, color 300ms ${EASING};
      }

      /* ---- hero ---- */
      .hero {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 12px;
        min-width: 0;
      }

      .soc-block {
        min-width: 0;
      }

      .soc {
        font-size: 56px;
        font-weight: 600;
        line-height: 1;
        letter-spacing: -1px;
        font-variant-numeric: tabular-nums;
        color: var(--sb-soc);
      }

      .soc-unit {
        font-size: 24px;
        font-weight: 600;
        margin-left: 4px;
        letter-spacing: 0;
      }

      .stored {
        margin-top: 4px;
        font-size: 13px;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
      }

      .forecast {
        text-align: end;
        min-width: 0;
      }

      .forecast-main {
        font-size: 16px;
        font-weight: 700;
        color: var(--m3p-text, var(--primary-text-color));
      }

      .forecast-rate {
        margin-top: 2px;
        font-size: 13px;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
      }

      /* ---- bar ---- */
      .bar {
        position: relative;
        height: ${unsafeCSS(SOLAR_BATTERY_BAR_HEIGHT)}px;
        border-radius: ${unsafeCSS(SOLAR_BATTERY_BAR_HEIGHT / 2)}px;
        background: var(--sb-track);
        overflow: hidden;
      }

      .bar-fill {
        position: absolute;
        inset: 0 auto 0 0;
        border-radius: inherit;
        background-color: var(--sb-fill);
        transition: width 900ms cubic-bezier(0.34, 1.56, 0.64, 1);
      }

      .bar-fill.striped {
        background-image: repeating-linear-gradient(
          -45deg,
          rgba(255, 255, 255, 0.24) 0 8px,
          transparent 8px 16px
        );
        background-size: 22.63px 22.63px;
        animation: sb-stripes 900ms linear infinite;
      }

      @keyframes sb-stripes {
        to {
          background-position: 22.63px 0;
        }
      }

      .marker {
        position: absolute;
        top: 3px;
        bottom: 3px;
        width: 3px;
        margin-left: -1.5px;
        border-radius: 2px;
        background: #fff;
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25);
      }

      .bar-labels {
        position: relative;
        height: 16px;
        margin-top: 6px;
      }

      .bar-label {
        position: absolute;
        top: 0;
        font-size: 12px;
        white-space: nowrap;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
      }

      /* ---- flow ---- */
      .flow {
        display: flex;
        align-items: stretch;
        min-width: 0;
      }

      .tile {
        flex: 1 1 0;
        min-width: 0;
        padding: 12px;
        border-radius: ${unsafeCSS(SOLAR_BATTERY_TILE_RADIUS)}px;
        cursor: pointer;
        box-sizing: border-box;
        transition: border-radius 350ms ${EASING}, opacity 300ms ${EASING};
      }

      .tile:active {
        border-radius: ${unsafeCSS(SOLAR_BATTERY_TILE_RADIUS_ACTIVE)}px;
      }

      .tile.dim {
        opacity: 0.55;
      }

      .tile-icon {
        width: ${unsafeCSS(SOLAR_BATTERY_TILE_ICON)}px;
        height: ${unsafeCSS(SOLAR_BATTERY_TILE_ICON)}px;
        border-radius: ${unsafeCSS(SOLAR_BATTERY_TILE_ICON_RADIUS)}px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 10px;
        --mdc-icon-size: 18px;
      }

      .tile-value {
        font-size: 20px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .tile-unit {
        font-size: 12px;
        font-weight: 500;
        margin-left: 3px;
      }

      .tile-label {
        margin-top: 2px;
        font-size: 12px;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .link {
        flex: 0 0 18px;
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }

      .dash {
        width: 8px;
        height: 2px;
        border-radius: 1px;
        background: var(--m3p-secondary-text, var(--secondary-text-color));
        opacity: 0.4;
      }

      .dot {
        position: absolute;
        top: 50%;
        left: 0;
        width: 5px;
        height: 5px;
        margin-top: -2.5px;
        border-radius: 50%;
        background: var(--sb-dot);
        opacity: 0;
        animation: sb-dot 1500ms linear infinite;
      }

      .dot:nth-child(2) {
        animation-delay: 500ms;
      }

      .dot:nth-child(3) {
        animation-delay: 1000ms;
      }

      .link.back .dot {
        animation-name: sb-dot-back;
      }

      @keyframes sb-dot {
        0% {
          transform: translateX(0);
          opacity: 0;
        }
        20%,
        80% {
          opacity: 1;
        }
        100% {
          transform: translateX(13px);
          opacity: 0;
        }
      }

      @keyframes sb-dot-back {
        0% {
          transform: translateX(13px);
          opacity: 0;
        }
        20%,
        80% {
          opacity: 1;
        }
        100% {
          transform: translateX(0);
          opacity: 0;
        }
      }

      /* ---- sections ---- */
      .section {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .section-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
      }

      .section-title {
        font-size: 15px;
        font-weight: 500;
        color: var(--m3p-text, var(--primary-text-color));
      }

      .section-side {
        font-size: 12px;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .mppt {
        display: grid;
        grid-auto-columns: minmax(0, 1fr);
        grid-auto-flow: column;
        gap: 8px;
      }

      .column {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        cursor: pointer;
        border-radius: 12px;
        min-width: 0;
      }

      .column-track {
        position: relative;
        width: 100%;
        height: ${unsafeCSS(SOLAR_BATTERY_MPPT_HEIGHT)}px;
        border-radius: 14px;
        background: var(--sb-track);
        overflow: hidden;
        margin-bottom: 6px;
      }

      .column-fill {
        position: absolute;
        left: 4px;
        right: 4px;
        bottom: 4px;
        max-height: calc(100% - 8px);
        border-radius: 10px;
        background: var(--sb-solar-fill);
        transition: height 700ms cubic-bezier(0.34, 1.56, 0.64, 1);
      }

      .column-value {
        font-size: 14px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: var(--m3p-text, var(--primary-text-color));
        white-space: nowrap;
      }

      .column-label {
        font-size: 12px;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
      }

      .extras {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .extra {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(60px, 1.4fr) auto;
        align-items: center;
        gap: 10px;
        cursor: pointer;
        border-radius: 8px;
      }

      .extra-name {
        font-size: 13px;
        color: var(--m3p-text, var(--primary-text-color));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .extra-bar {
        position: relative;
        height: 8px;
        border-radius: 4px;
        background: var(--sb-track);
        overflow: hidden;
      }

      .extra-fill {
        position: absolute;
        inset: 0 auto 0 0;
        border-radius: inherit;
        background: var(--sb-fill);
        transition: width 700ms ${EASING};
      }

      .extra-value {
        font-size: 13px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: var(--m3p-text, var(--primary-text-color));
        min-width: 40px;
        text-align: end;
      }

      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 32px;
        padding: 0 12px;
        border-radius: 16px;
        background: var(--sb-chip-bg);
        color: var(--m3p-text, var(--primary-text-color));
        font-size: 13px;
        white-space: nowrap;
        --mdc-icon-size: 16px;
        transition: border-radius 300ms ${EASING};
      }

      .chip.clickable {
        cursor: pointer;
      }

      .chip.clickable:active {
        border-radius: 10px;
      }

      .no-animations .bar-fill,
      .no-animations .column-fill,
      .no-animations .extra-fill,
      .no-animations .tile,
      .no-animations .pill {
        transition: none;
      }

      .no-animations .bar-fill.striped,
      .no-animations .dot {
        animation: none;
      }

      .no-animations .dot {
        opacity: 0.8;
        transform: none;
        position: static;
        margin: 0 1px;
      }

      @media (prefers-reduced-motion: reduce) {
        .bar-fill,
        .column-fill,
        .extra-fill,
        .tile,
        .pill {
          transition: none;
        }
        .bar-fill.striped,
        .dot {
          animation: none;
        }
        .dot {
          opacity: 0.8;
          transform: none;
          position: static;
          margin: 0 1px;
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-solar-battery-card": M3SolarBatteryCard;
  }
}

const windowWithCards = window as unknown as { customCards: Array<Record<string, unknown>> };
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-solar-battery-card",
  name: "M3 Solar Battery Card",
  description: "A balcony solar battery with its own inverter: charge, forecast, solar → battery → house flow and the solar inputs, mapped by config.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
