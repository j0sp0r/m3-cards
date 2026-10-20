import { LitElement, html, css, nothing, svg, type SVGTemplateResult, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  M3GaugeCardConfig,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_GAUGE_RADIUS,
  DEFAULT_GAUGE_SEGMENT_A,
  DEFAULT_GAUGE_SEGMENT_B,
  GAUGE_GAP_DEGREES,
  GAUGE_STROKE_WIDTH,
  GAUGE_BOX_WIDTH,
  GAUGE_BOX_HEIGHT,
  ENERGY_REFRESH_MS,
  resolveCornerRadius,
} from "./const";
import {
  resolveThemeColor,
  buildCssVars,
  resolveCommonColors,
  tintOn, foregroundOn,
  tintBackground,
} from "./shared/color-config";
import { glassCardStyles, glassCardClass } from "./shared/glass-card";
import { renderCardHeader, cardHeaderStyles } from "./shared/card-header";
import { getGridEntities, fetchTodayChangeSum } from "./shared/ha-energy";
import { shouldAnimate } from "./shared/animation";
import { localize, type TranslationKey } from "./localize";
import { hassChangeMatters } from "./shared/should-update";
import { formatNumber } from "./shared/formatting";
import { TemplatedCard } from "./shared/templated-card";

console.info(
  `%c M3-GAUGE-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #8f79e0; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #8f79e0; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

const PA_LERP = 0.12;

const GAUGE_RADIUS = (GAUGE_BOX_WIDTH - GAUGE_STROKE_WIDTH) / 2;
const GAUGE_CX = GAUGE_BOX_WIDTH / 2;
const GAUGE_CY = GAUGE_BOX_HEIGHT - GAUGE_STROKE_WIDTH / 2 - 4;

function polarPoint(tDeg: number): { x: number; y: number } {
  const standardAngle = ((180 - tDeg) * Math.PI) / 180;
  return {
    x: GAUGE_CX + GAUGE_RADIUS * Math.cos(standardAngle),
    y: GAUGE_CY - GAUGE_RADIUS * Math.sin(standardAngle),
  };
}

function arcPath(tStart: number, tEnd: number): string {
  if (tEnd <= tStart) return "";
  const start = polarPoint(tStart);
  const end = polarPoint(tEnd);
  const largeArc = tEnd - tStart > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)},${start.y.toFixed(2)} A ${GAUGE_RADIUS},${GAUGE_RADIUS} 0 ${largeArc} 1 ${end.x.toFixed(2)},${end.y.toFixed(2)}`;
}

@customElement("m3-gauge-card")
export class M3GaugeCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3GaugeCardConfig;
  @state() private _energyValueA = 0;
  @state() private _energyValueB = 0;
  @state() private _noEnergyDashboard = false;
  @state() private _displayPA = 0;

  private _refreshTimer?: number;
  private _lastFetchKey?: string;
  private _fetchInFlight = false;
  private _rafId?: number;
  private _targetPA = 0;
  private _paInitialized = false;

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-gauge-card-editor");
    return document.createElement(
      "m3-gauge-card-editor",
    ) as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(): M3GaugeCardConfig {
    return {
      type: "custom:m3-gauge-card",
      source: "energy",
      glass_background: true,
    };
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return hassChangeMatters(changed, this.hass, [this._config?.value_a_entity, this._config?.value_b_entity]);
  }

  public setConfig(config: M3GaugeCardConfig): void {
    this._config = {
      glass_background: true,
      animation: "auto",
      source: "energy",
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

  private _formatNumber(value: number): string {
    return formatNumber(this._language, value, { maximumFractionDigits: 2 });
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this._refreshTimer = window.setInterval(() => {
      this._lastFetchKey = undefined;
      this._maybeFetch();
    }, ENERGY_REFRESH_MS);
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._refreshTimer !== undefined) {
      window.clearInterval(this._refreshTimer);
      this._refreshTimer = undefined;
    }
    this._stopAnimationLoop();
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    this._maybeFetch();
  }

  private _maybeFetch(): void {
    if (!this.hass || !this._config || this._config.source !== "energy") return;
    const key = "energy";
    if (key === this._lastFetchKey) return;
    this._lastFetchKey = key;
    this._fetchEnergyData();
  }

  private async _fetchEnergyData(): Promise<void> {
    if (!this.hass || this._fetchInFlight) return;
    this._fetchInFlight = true;
    try {
      const grid = await getGridEntities(this.hass);
      if (!grid) {
        this._noEnergyDashboard = true;
        this._energyValueA = 0;
        this._energyValueB = 0;
        return;
      }
      this._noEnergyDashboard = false;
      const [a, b] = await Promise.all([
        fetchTodayChangeSum(this.hass, grid.from),
        fetchTodayChangeSum(this.hass, grid.to),
      ]);
      this._energyValueA = a;
      this._energyValueB = b;
    } catch (e) {
      console.error("m3-gauge-card: failed to load energy data", e);
    } finally {
      this._fetchInFlight = false;
    }
  }

  private _startAnimationLoop(): void {
    if (this._rafId !== undefined) return;
    const step = () => {
      this._rafId = requestAnimationFrame(step);
      this._tick();
    };
    this._rafId = requestAnimationFrame(step);
  }

  private _stopAnimationLoop(): void {
    if (this._rafId !== undefined) {
      cancelAnimationFrame(this._rafId);
      this._rafId = undefined;
    }
  }

  private _tick(): void {
    if (document.hidden) {
      this._stopAnimationLoop();
      return;
    }
    const delta = this._targetPA - this._displayPA;
    if (Math.abs(delta) > 0.002) {
      this._displayPA += delta * PA_LERP;
      this.requestUpdate();
    } else if (this._displayPA !== this._targetPA) {
      this._displayPA = this._targetPA;
      this.requestUpdate();
    } else {
      this._stopAnimationLoop();
    }
  }

  protected render() {
    if (!this._config || !this.hass) return nothing;

    const name = this._config.name || "Netzbilanz";
    const icon = this._config.icon || "mdi:transmission-tower";
    const subtitle = this._config.subtitle || this._t("gauge_subtitle_today");

    const segmentAColor = this._config.segment_a_color
      ? resolveThemeColor(this._config.segment_a_color)
      : DEFAULT_GAUGE_SEGMENT_A;
    const segmentBColor = this._config.segment_b_color
      ? resolveThemeColor(this._config.segment_b_color)
      : DEFAULT_GAUGE_SEGMENT_B;
    const trackColorCss = this._config.track_color
      ? resolveThemeColor(this._config.track_color)
      : tintBackground("var(--primary-text-color)", undefined, 12);
    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(
      this._config,
    );

    const radius = resolveCornerRadius(
      this._config.radius ?? DEFAULT_GAUGE_RADIUS,
      this._config.corners,
    );

    const source = this._config.source ?? "energy";
    let a = 0;
    let b = 0;
    let unit = "kWh";
    if (source === "entities") {
      const entityA = this._config.value_a_entity
        ? this.hass.states[this._config.value_a_entity]
        : undefined;
      const entityB = this._config.value_b_entity
        ? this.hass.states[this._config.value_b_entity]
        : undefined;
      const rawA = entityA ? parseFloat(entityA.state) : NaN;
      const rawB = entityB ? parseFloat(entityB.state) : NaN;
      a = isNaN(rawA) ? 0 : rawA;
      b = isNaN(rawB) ? 0 : rawB;
      // source:entities isn't electricity-specific (e.g. comparing two gas
      // or water meters) — show whichever unit the configured entities
      // actually use instead of assuming kWh.
      unit =
        entityA?.attributes.unit_of_measurement || entityB?.attributes.unit_of_measurement || "kWh";
    } else {
      a = this._energyValueA;
      b = this._energyValueB;
    }
    const total = a + b;
    const net = a - b;

    const targetPA = total > 0 && a > 0 && b > 0 ? a / total : this._targetPA;
    this._targetPA = targetPA;
    if (!this._paInitialized) {
      this._displayPA = 0;
      this._paInitialized = true;
    }
    const animate = shouldAnimate(this._config.animation);
    if (!animate) {
      this._displayPA = this._targetPA;
    } else if (this._displayPA !== this._targetPA) {
      this._startAnimationLoop();
    }

    // The glyph sits on this well, not on the card, so its contrast has to be
    // measured against the well.
    const iconWellCss = tintOn(this, segmentAColor, this._config.segment_a_opacity, 18);
    const cssVars = buildCssVars({
      "m3p-icon-color": foregroundOn(segmentAColor, iconWellCss),
      "m3p-icon-bg": iconWellCss,
      "m3p-text": textColorCss,
      "m3p-secondary-text": secondaryTextColorCss,
    });

    const netLabel =
      net >= 0
        ? this._config.label_positive || this._t("gauge_net_grid")
        : this._config.label_negative || this._t("gauge_net_feed_in");

    const labelA = this._config.label_a || this._t("gauge_label_a");
    const labelB = this._config.label_b || this._t("gauge_label_b");

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(this._config.glass_background)}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          ${renderCardHeader({ icon, name, subtitle })}

          <div class="arc-wrap">
            ${this._renderArc(a, b, this._displayPA, segmentAColor, segmentBColor, trackColorCss)}
            <div class="arc-center">
              ${total <= 0
                ? html`<div class="no-data">
                    ${source === "energy" && this._noEnergyDashboard
                      ? this._t("gauge_no_energy_dashboard")
                      : this._t("gauge_no_data")}
                  </div>`
                : html`
                    <div class="net-value">
                      ${this._formatNumber(Math.abs(net))}
                      <span class="net-unit">${unit}</span>
                    </div>
                    <div class="net-label">${netLabel}</div>
                  `}
            </div>
          </div>

          ${total > 0
            ? html`
                <div class="legend">
                  <div class="legend-chip">
                    <span class="legend-swatch" style=${`background:${segmentAColor};`}></span>
                    <span
                      >${labelA} ${Math.round((a / total) * 100)}%</span
                    >
                  </div>
                  <div class="legend-chip">
                    <span class="legend-swatch" style=${`background:${segmentBColor};`}></span>
                    <span
                      >${labelB} ${Math.round((b / total) * 100)}%</span
                    >
                  </div>
                </div>
              `
            : nothing}
        </div>
      </ha-card>
    `;
  }

  private _renderArc(
    a: number,
    b: number,
    displayPA: number,
    colorA: string,
    colorB: string,
    trackColor: string,
  ): SVGTemplateResult {
    const total = a + b;
    let segments: SVGTemplateResult;

    if (total <= 0) {
      segments = svg`<path class="arc-segment" d=${arcPath(0, 180)} stroke=${trackColor}></path>`;
    } else if (a <= 0 || b <= 0) {
      const color = a > 0 ? colorA : colorB;
      segments = svg`<path class="arc-segment" d=${arcPath(0, 180)} stroke=${color}></path>`;
    } else {
      const half = GAUGE_GAP_DEGREES / 2;
      const aEnd = Math.max(0, displayPA * 180 - half);
      const bStart = Math.min(180, displayPA * 180 + half);
      segments = svg`
        <path class="arc-segment" d=${arcPath(0, aEnd)} stroke=${colorA}></path>
        <path class="arc-segment" d=${arcPath(bStart, 180)} stroke=${colorB}></path>
      `;
    }

    return svg`<svg
      class="arc-svg"
      viewBox="0 0 ${GAUGE_BOX_WIDTH} ${GAUGE_BOX_HEIGHT}"
      preserveAspectRatio="xMidYMid meet"
    >
      ${segments}
    </svg>`;
  }

  static styles = [
    glassCardStyles,
    cardHeaderStyles,
    css`
      .arc-wrap {
        position: relative;
        width: 60%;
        max-width: 260px;
        margin: 0 auto;
      }

      .arc-svg {
        display: block;
        width: 100%;
        height: auto;
        overflow: visible;
      }

      .arc-segment {
        fill: none;
        stroke-width: 18px;
        stroke-linecap: round;
      }

      .arc-center {
        position: absolute;
        left: 50%;
        bottom: 6px;
        transform: translateX(-50%);
        text-align: center;
      }

      .net-value {
        font-size: 26px;
        font-weight: 700;
        line-height: 1.1;
        color: var(--m3p-text);
      }

      .net-unit {
        font-size: 14px;
        font-weight: 500;
        opacity: 0.7;
      }

      .net-label {
        font-size: 12px;
        opacity: 0.6;
        color: var(--m3p-secondary-text);
      }

      .no-data {
        font-size: 13px;
        opacity: 0.6;
        color: var(--m3p-secondary-text);
      }

      .legend {
        display: flex;
        justify-content: center;
        gap: 16px;
      }

      .legend-chip {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: var(--m3p-secondary-text);
      }

      .legend-swatch {
        width: 10px;
        height: 10px;
        border-radius: 4px;
        flex-shrink: 0;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-gauge-card": M3GaugeCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-gauge-card",
  name: "M3 Gauge Card",
  description:
    "Ein Material-3-Halbkreis-Gauge für das Verhältnis zweier Größen (z. B. Netzbezug vs. Einspeisung).",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
