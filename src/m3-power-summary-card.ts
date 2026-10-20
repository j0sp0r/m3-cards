import { LitElement, html, css, nothing } from "lit";
import type { PropertyValues } from "lit";
import { hassChangeMatters } from "./shared/should-update";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  M3PowerSummaryCardConfig,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  PowerMetricConfig,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_SUMMARY_RADIUS,
  DEFAULT_SUMMARY_EXPORT_COLOR,
  DEFAULT_SUMMARY_IMPORT_COLOR,
  DEFAULT_SUMMARY_PRODUCER_COLOR,
  DEFAULT_SUMMARY_NEUTRAL_COLOR,
  DEFAULT_SUMMARY_ZERO_THRESHOLD,
  DEFAULT_SUMMARY_KW_THRESHOLD,
  SUMMARY_MAIN_ICON_SIZE,
  SUMMARY_MAIN_ICON_RADIUS,
  SUMMARY_CHIP_RADIUS,
  SUMMARY_SPLIT_BAR_HEIGHT,
  SUMMARY_SPLIT_BAR_RADIUS,
  SUMMARY_SPLIT_BAR_GAP,
  SUMMARY_METRIC_RADIUS,
  SUMMARY_METRIC_RADIUS_ACTIVE,
  SUMMARY_METRIC_ICON_SIZE,
  SUMMARY_METRIC_ICON_RADIUS,
  SUMMARY_METRIC_MIN_WIDTH,
  SUMMARY_VALUE_LERP_MS,
  resolveCornerRadius,
} from "./const";
import { resolveThemeColor, buildCssVars, resolveCommonColors, tintOn, foregroundVars, foregroundColor, foregroundOn , tintBackground } from "./shared/color-config";
import { glassCardStyles, glassCardClass } from "./shared/glass-card";
import { activateOnKey } from "./shared/a11y";
import { shouldAnimate } from "./shared/animation";
import { fireEvent } from "./shared/editor-helpers";
import { localize, type TranslationKey } from "./localize";
import { formatNumber } from "./shared/formatting";
import { TemplatedCard } from "./shared/templated-card";

console.info(
  `%c M3-POWER-SUMMARY-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #81c784; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #81c784; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

type Direction = "export" | "import" | "neutral";

@customElement("m3-power-summary-card")
export class M3PowerSummaryCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3PowerSummaryCardConfig;
  /** The value actually shown. Only assigned when the *rendered* text would
   * change, which is what keeps the count-up animation from re-rendering the
   * card on every frame. */
  @state() private _displayGridValue = 0;
  /** The precise, per-frame value. Deliberately not @state. */
  private _preciseGridValue = 0;

  private _gridValueInitialized = false;
  private _lerpStart = 0;
  private _lerpFrom = 0;
  private _lerpTo = 0;
  private _rafId?: number;

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-power-summary-card-editor");
    return document.createElement(
      "m3-power-summary-card-editor",
    ) as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(hass: HomeAssistant): M3PowerSummaryCardConfig {
    const powerEntity = Object.values(hass?.states ?? {}).find(
      (s) => s.entity_id.startsWith("sensor.") && s.attributes.device_class === "power",
    )?.entity_id;
    return {
      type: "custom:m3-power-summary-card",
      grid_entity: powerEntity ?? "",
      glass_background: true,
    };
  }

  public setConfig(config: M3PowerSummaryCardConfig): void {
    if (!config.grid_entity) {
      throw new Error("m3-power-summary-card: 'grid_entity' is required");
    }
    this._config = {
      glass_background: true,
      animation: "auto",
      grid_sign: "negative_is_export",
      show_self_sufficiency: true,
      show_split_bar: true,
      zero_threshold: DEFAULT_SUMMARY_ZERO_THRESHOLD,
      kw_threshold: DEFAULT_SUMMARY_KW_THRESHOLD,
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

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopLerp();
  }

  private _stopLerp(): void {
    if (this._rafId !== undefined) {
      cancelAnimationFrame(this._rafId);
      this._rafId = undefined;
    }
  }

  /** The granularity the reading is displayed at, so two values that would
   * render the same text compare equal. Mirrors _formatWatts: whole watts
   * below the kW threshold, tenths of a kW above it. */
  private _displayStep(value: number): number {
    const kwThreshold = this._config?.kw_threshold ?? DEFAULT_SUMMARY_KW_THRESHOLD;
    return Math.abs(value) >= kwThreshold ? Math.round(value / 100) : Math.round(value);
  }

  private _startLerp(from: number, to: number): void {
    this._lerpFrom = from;
    this._lerpTo = to;
    this._lerpStart = performance.now();
    this._stopLerp();
    const step = (now: number) => {
      const t = Math.min(1, (now - this._lerpStart) / SUMMARY_VALUE_LERP_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      this._preciseGridValue = this._lerpFrom + (this._lerpTo - this._lerpFrom) * eased;
      // A 500 ms count-up runs about 30 frames, but the reading is rounded to
      // whole watts (or a tenth of a kW), so most frames would render text
      // identical to the frame before. Assigning the @state only when the
      // rounded reading actually moves cut this card from 352 renders in 20
      // seconds to a handful.
      if (this._displayStep(this._preciseGridValue) !== this._displayStep(this._displayGridValue)) {
        this._displayGridValue = this._preciseGridValue;
      }
      if (t < 1) {
        this._rafId = requestAnimationFrame(step);
      } else {
        this._preciseGridValue = this._lerpTo;
        this._displayGridValue = this._lerpTo;
        this._rafId = undefined;
      }
    };
    this._rafId = requestAnimationFrame(step);
  }

  private _formatWatts(value: number): { number: string; unit: string } {
    const kwThreshold = this._config?.kw_threshold ?? DEFAULT_SUMMARY_KW_THRESHOLD;
    if (Math.abs(value) >= kwThreshold) {
      const kw = formatNumber(this._language, value / 1000, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      });
      return { number: kw, unit: "kW" };
    }
    return {
      number: formatNumber(this._language, value, { maximumFractionDigits: 0 }),
      unit: "W",
    };
  }

  private _stateValue(entityId: string | undefined): number {
    if (!entityId) return NaN;
    const s = this.hass?.states[entityId];
    if (!s) return NaN;
    return parseFloat(s.state);
  }

  private _solarEntities(): string[] {
    const raw = this._config?.solar_entity;
    if (!raw) return [];
    return Array.isArray(raw) ? raw : [raw];
  }

  private _moreInfo(entityId: string): () => void {
    return () => fireEvent(this, "hass-more-info", { entityId });
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return hassChangeMatters(changed, this.hass, [
      this._config?.grid_entity,
      this._config?.consumption_entity,
      ...this._solarEntities(),
    ]);
  }

  protected render() {
    if (!this._config || !this.hass) return nothing;

    const exportColor = this._config.export_color
      ? resolveThemeColor(this._config.export_color)
      : DEFAULT_SUMMARY_EXPORT_COLOR;
    const importColor = this._config.import_color
      ? resolveThemeColor(this._config.import_color)
      : DEFAULT_SUMMARY_IMPORT_COLOR;
    const producerColor = this._config.producer_color
      ? resolveThemeColor(this._config.producer_color)
      : DEFAULT_SUMMARY_PRODUCER_COLOR;
    const accentColor = this._config.accent_color
      ? resolveThemeColor(this._config.accent_color)
      : DEFAULT_SUMMARY_EXPORT_COLOR;
    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(
      this._config,
    );

    const radius = resolveCornerRadius(
      this._config.radius ?? DEFAULT_SUMMARY_RADIUS,
      this._config.corners,
    );

    const gridRaw = this._stateValue(this._config.grid_entity);
    const gridUnavailable = Number.isNaN(gridRaw);
    const zeroThreshold = this._config.zero_threshold ?? DEFAULT_SUMMARY_ZERO_THRESHOLD;
    const positiveIsExport = this._config.grid_sign === "positive_is_export";

    const gridExportW = gridUnavailable
      ? 0
      : Math.max(0, positiveIsExport ? gridRaw : -gridRaw);
    const gridImportW = gridUnavailable
      ? 0
      : Math.max(0, positiveIsExport ? -gridRaw : gridRaw);

    let direction: Direction = "neutral";
    if (!gridUnavailable) {
      if (Math.abs(gridRaw) <= zeroThreshold) direction = "neutral";
      else direction = gridExportW > gridImportW ? "export" : "import";
    }

    const solarRaw = this._solarEntities()
      .map((e) => this._stateValue(e))
      .filter((v) => !Number.isNaN(v))
      .reduce((sum, v) => sum + Math.max(0, v), 0);
    const hasSolar = this._solarEntities().length > 0;

    const consumptionRaw = this._config.consumption_entity
      ? this._stateValue(this._config.consumption_entity)
      : gridImportW + solarRaw;
    const consumption = Number.isNaN(consumptionRaw) ? 0 : Math.max(0, consumptionRaw);

    const targetValue = direction === "export" ? gridExportW : direction === "import" ? gridImportW : 0;
    const animate = shouldAnimate(this._config.animation);
    if (!this._gridValueInitialized) {
      this._preciseGridValue = targetValue;
      this._displayGridValue = targetValue;
      this._gridValueInitialized = true;
    } else if (!animate) {
      if (this._displayGridValue !== targetValue) {
        this._preciseGridValue = targetValue;
        this._displayGridValue = targetValue;
      }
    } else if (this._lerpTo !== targetValue) {
      this._startLerp(this._preciseGridValue, targetValue);
    }

    const mainIcon =
      direction === "export"
        ? "mdi:transmission-tower-export"
        : direction === "import"
          ? "mdi:transmission-tower-import"
          : "mdi:transmission-tower";
    const mainColor =
      direction === "export" ? exportColor : direction === "import" ? importColor : DEFAULT_SUMMARY_NEUTRAL_COLOR;
    const mainLabel = gridUnavailable
      ? this._t("power_summary_unavailable")
      : direction === "export"
        ? this._config.label_export || this._t("power_summary_export")
        : direction === "import"
          ? this._config.label_import || this._t("power_summary_import")
          : this._t("power_summary_neutral");

    const displayed = this._formatWatts(Math.max(0, this._displayGridValue));

    const showSelfSufficiency = this._config.show_self_sufficiency ?? true;
    const selfSufficiency =
      consumption > 0 ? Math.max(0, Math.min(100, ((consumption - gridImportW) / consumption) * 100)) : 0;

    const showSplitBar = (this._config.show_split_bar ?? true) && hasSolar && solarRaw > 0 && !gridUnavailable;
    let segA = 0;
    let segB = 0;
    let segAColor = producerColor;
    let segBColor = exportColor;
    let labelA = "";
    let labelB = "";
    if (showSplitBar) {
      if (direction === "import") {
        segA = Math.min(solarRaw, consumption);
        segB = Math.max(0, consumption - solarRaw);
        segAColor = producerColor;
        segBColor = importColor;
        labelA = this._t("power_summary_self_use");
        labelB = this._t("power_summary_grid_share");
      } else {
        segA = Math.min(solarRaw, consumption);
        segB = Math.max(0, solarRaw - consumption);
        segAColor = producerColor;
        segBColor = exportColor;
        labelA = this._t("power_summary_self_use");
        labelB = this._t("power_summary_surplus");
      }
    }
    const segTotal = segA + segB;
    const pctA = segTotal > 0 ? (segA / segTotal) * 100 : 0;
    const pctB = 100 - pctA;

    // Fills keep the pure accent; the -fg twins carry the same colours where
    // they are used as text, adjusted for contrast against the card surface.
    const cssVars = buildCssVars({
      "m3p-text": textColorCss,
      "m3p-secondary-text": secondaryTextColorCss,
      "ps-accent": accentColor,
      "ps-accent-bg": tintOn(this, accentColor, this._config.accent_opacity, 18),
      "ps-producer": producerColor,
      "ps-main": mainColor,
      ...foregroundVars(this, {
        "ps-accent": accentColor,
        "ps-producer": producerColor,
        "ps-main": mainColor,
      }),
    });

    const metrics = this._config.metrics ?? [];

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(this._config.glass_background)} ${animate ? "" : "no-animations"}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          <div class="main-row ${gridUnavailable ? "unavailable" : ""}">
            <div
              class="main-icon"
              style=${`background: ${tintOn(this, mainColor, this._config.flow_tint_opacity, 18)}; color: ${foregroundColor(this, mainColor)};`}
              role="button"
              tabindex="0"
              aria-label=${mainLabel}
              @click=${this._moreInfo(this._config.grid_entity)}
              @keydown=${activateOnKey(this._moreInfo(this._config.grid_entity))}
            >
              <ha-icon icon=${mainIcon}></ha-icon>
            </div>
            <div class="main-text">
              <div class="main-label">${mainLabel}</div>
              <div class="main-value">
                ${gridUnavailable ? "–" : displayed.number}
                <span class="main-unit">${gridUnavailable ? "" : displayed.unit}</span>
              </div>
            </div>
            ${showSelfSufficiency && !gridUnavailable
              ? html`
                  <div class="self-sufficiency-chip">
                    <ha-icon icon="mdi:leaf"></ha-icon>
                    <span>${Math.round(selfSufficiency)} %</span>
                  </div>
                `
              : nothing}
          </div>

          ${showSplitBar
            ? html`
                <div class="split-bar">
                  <div
                    class="split-segment"
                    style=${`width: ${pctA}%; background: ${segAColor}; margin-right: ${pctB > 0 ? SUMMARY_SPLIT_BAR_GAP : 0}px;`}
                  ></div>
                  <div class="split-segment" style=${`width: ${pctB}%; background: ${segBColor};`}></div>
                </div>
                <div class="split-legend">
                  <div class="legend-item">
                    <span class="legend-swatch" style=${`background:${segAColor};`}></span>
                    <span>${labelA} ${Math.round(segA)} W</span>
                  </div>
                  <div class="legend-item">
                    <span class="legend-swatch" style=${`background:${segBColor};`}></span>
                    <span>${labelB} ${Math.round(segB)} W</span>
                  </div>
                </div>
              `
            : nothing}

          ${metrics.length > 0
            ? html`
                <div class="metrics-grid">
                  ${metrics.map((m) => this._renderMetric(m, producerColor))}
                </div>
              `
            : nothing}
        </div>
      </ha-card>
    `;
  }

  private _renderMetric(metric: PowerMetricConfig, producerColor: string) {
    const state = this.hass!.states[metric.entity];
    const raw = state ? parseFloat(state.state) : NaN;
    const unavailable = !state || Number.isNaN(raw);
    const value = unavailable ? 0 : Math.max(0, raw);
    const isProducer = metric.type === "producer";
    const explicitColor = metric.color ? resolveThemeColor(metric.color) : undefined;
    const color = explicitColor ?? (isProducer ? producerColor : "var(--primary-text-color)");
    const flowTintOpacity = this._config?.flow_tint_opacity;
    const bg = explicitColor
      ? tintOn(this, explicitColor, flowTintOpacity, 14)
      : isProducer
        ? tintOn(this, producerColor, flowTintOpacity, 14)
        : tintBackground("var(--primary-text-color)", undefined, 7);
    const iconColor = explicitColor ?? (isProducer ? producerColor : "var(--primary-text-color)");
    const iconBg = explicitColor
      ? tintOn(this, explicitColor, flowTintOpacity, 24)
      : isProducer
        ? tintOn(this, producerColor, flowTintOpacity, 24)
        : tintBackground("var(--primary-text-color)", undefined, 12);
    const name = metric.name || state?.attributes.friendly_name || metric.entity;
    const icon = metric.icon || state?.attributes.icon || "mdi:power-plug";
    const formatted = this._formatWatts(value);

    return html`
      <div
        class="metric ${unavailable ? "unavailable" : ""}"
        style=${`background: ${bg};`}
        role="button"
        tabindex="0"
        aria-label=${name}
        @click=${this._moreInfo(metric.entity)}
        @keydown=${activateOnKey(this._moreInfo(metric.entity))}
      >
        <div class="metric-icon" style=${`background: ${iconBg}; color: ${foregroundOn(iconColor, iconBg)};`}>
          <ha-icon icon=${icon}></ha-icon>
        </div>
        <div class="metric-value" style=${`color: ${unavailable ? "var(--m3p-secondary-text)" : foregroundColor(this, color)};`}>
          ${unavailable ? "–" : formatted.number}
          <span class="metric-unit" style=${`color: ${unavailable ? "var(--m3p-secondary-text)" : foregroundOn(color, bg, 4.5)};`}>${unavailable ? "" : formatted.unit}</span>
        </div>
        <div class="metric-name">${name}</div>
      </div>
    `;
  }

  static styles = [
    glassCardStyles,
    css`
      .main-row {
        display: flex;
        align-items: center;
        gap: 14px;
      }

      .main-row.unavailable {
        opacity: 0.5;
      }

      .main-icon {
        flex-shrink: 0;
        width: ${SUMMARY_MAIN_ICON_SIZE}px;
        height: ${SUMMARY_MAIN_ICON_SIZE}px;
        border-radius: ${SUMMARY_MAIN_ICON_RADIUS}px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      }

      .main-icon ha-icon {
        --mdc-icon-size: 26px;
      }

      .main-icon:focus-visible {
        outline: 2px solid var(--ps-main, var(--primary-color));
        outline-offset: 2px;
      }

      .main-text {
        flex: 1;
        min-width: 0;
      }

      .main-label {
        font-size: 12px;
        opacity: 0.6;
        color: var(--m3p-secondary-text);
      }

      .main-value {
        font-size: 32px;
        font-weight: 700;
        line-height: 1.15;
        color: var(--ps-main-fg, var(--ps-main));
        font-variant-numeric: tabular-nums;
      }

      .main-unit {
        font-size: 16px;
        font-weight: 500;
        opacity: 0.7;
        margin-left: 2px;
      }

      .self-sufficiency-chip {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: 4px;
        height: 30px;
        padding: 0 12px;
        border-radius: ${SUMMARY_CHIP_RADIUS}px;
        background: var(--ps-accent-bg);
        color: var(--ps-accent-fg, var(--ps-accent));
        font-size: 14px;
        font-weight: 700;
      }

      .self-sufficiency-chip ha-icon {
        --mdc-icon-size: 15px;
      }

      .split-bar {
        display: flex;
        height: ${SUMMARY_SPLIT_BAR_HEIGHT}px;
      }

      .split-segment {
        height: 100%;
        border-radius: ${SUMMARY_SPLIT_BAR_RADIUS}px;
        transition: width 300ms cubic-bezier(0.2, 0, 0, 1);
      }

      .split-legend {
        display: flex;
        justify-content: space-between;
        font-size: 11px;
        color: var(--m3p-secondary-text);
      }

      .legend-item {
        display: flex;
        align-items: center;
        gap: 5px;
      }

      .legend-swatch {
        width: 8px;
        height: 8px;
        border-radius: 3px;
        flex-shrink: 0;
      }

      .metrics-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(${SUMMARY_METRIC_MIN_WIDTH}px, 1fr));
        gap: 8px;
      }

      .metric {
        padding: 12px 10px;
        border-radius: ${SUMMARY_METRIC_RADIUS}px;
        cursor: pointer;
        transition: border-radius 350ms cubic-bezier(0.2, 0, 0, 1);
        box-sizing: border-box;
      }

      .metric:active {
        border-radius: ${SUMMARY_METRIC_RADIUS_ACTIVE}px;
      }

      .card-inner.no-animations .split-segment,
      .card-inner.no-animations .metric {
        transition: none;
      }

      .metric:focus-visible {
        outline: 2px solid var(--ps-accent, var(--primary-color));
        outline-offset: 2px;
      }

      .metric.unavailable {
        opacity: 0.5;
      }

      .metric-icon {
        width: ${SUMMARY_METRIC_ICON_SIZE}px;
        height: ${SUMMARY_METRIC_ICON_SIZE}px;
        border-radius: ${SUMMARY_METRIC_ICON_RADIUS}px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 8px;
      }

      .metric-icon ha-icon {
        --mdc-icon-size: 15px;
      }

      .metric-value {
        font-size: 17px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }

      .metric-unit {
        font-size: 11px;
        font-weight: 500;
        /* No opacity here: at 11px the unit needs 4.5:1, and dimming a colour
           that has just been corrected to exactly that takes it back under. */
      }

      .metric-name {
        margin-top: 2px;
        font-size: 10px;
        opacity: 0.55;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--m3p-secondary-text);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-power-summary-card": M3PowerSummaryCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-power-summary-card",
  name: "M3 Power Summary Card",
  description:
    "Eine Material-3-Schnellübersicht für Netzbilanz, Verbrauch, Erzeugung und Autarkie in einer Karte.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
