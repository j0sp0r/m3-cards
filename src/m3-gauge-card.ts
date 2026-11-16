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
import { isReducedMotion } from "./shared/animation";
import {
  angleOf,
  arcPathDeg,
  arcPieces,
  compactTick,
  fractionOf,
  pointAt,
  resolveSegments,
  segmentFor,
  springSettled,
  springStep,
  tickValues,
} from "./shared/needle-gauge";

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
  /** style: needle — where the needle is drawn, as a fraction of the scale. */
  @state() private _needlePos = 0;
  private _needleVel = 0;
  private _needleTarget = 0;
  private _needleInit = false;
  private _needleRaf?: number;
  private _needleLast = 0;

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
    const sec = this._config?.secondary;
    return hassChangeMatters(changed, this.hass, [
      this._config?.value_a_entity,
      this._config?.value_b_entity,
      this._config?.entity,
      typeof sec === "object" ? sec.entity : undefined,
    ]);
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
    if (this._config?.style === "needle") return { columns: 6, rows: "auto", min_columns: 6 };
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
    if (this._needleRaf !== undefined) cancelAnimationFrame(this._needleRaf);
    this._needleRaf = undefined;
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    this._maybeFetch();
  }

  private _maybeFetch(): void {
    if (!this.hass || !this._config || this._config.source !== "energy" || this._config.style === "needle") return;
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
    if (this._config.style === "needle") return this._renderNeedleCard();

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

  // ---- style: needle (#56) ---------------------------------------------------

  /**
   * Carries the needle to its target on a spring. A new value only moves the
   * target; the running loop bends toward it, so fast updates never queue up
   * animations behind one another.
   */
  private _moveNeedle(target: number, animate: boolean): void {
    this._needleTarget = target;
    if (!this._needleInit || !animate) {
      this._needleInit = true;
      this._needlePos = target;
      this._needleVel = 0;
      return;
    }
    if (this._needleRaf !== undefined) return;
    this._needleLast = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - this._needleLast) / 1000);
      this._needleLast = now;
      const next = springStep(this._needlePos, this._needleVel, this._needleTarget, dt);
      this._needleVel = next.vel;
      if (springSettled(next.pos, next.vel, this._needleTarget) || document.hidden) {
        this._needlePos = this._needleTarget;
        this._needleVel = 0;
        this._needleRaf = undefined;
        return;
      }
      this._needlePos = next.pos;
      this._needleRaf = requestAnimationFrame(step);
    };
    this._needleRaf = requestAnimationFrame(step);
  }

  private _renderNeedleCard() {
    const cfg = this._config!;
    const hass = this.hass!;
    const st = cfg.entity ? hass.states[cfg.entity] : undefined;
    const raw = st ? parseFloat(st.state) : NaN;
    const available = !!st && Number.isFinite(raw);
    const min = cfg.min ?? 0;
    const max = cfg.max ?? 100;
    const unit = cfg.unit ?? (st?.attributes.unit_of_measurement as string | undefined) ?? "";
    const name = cfg.name || (st?.attributes.friendly_name as string | undefined) || cfg.entity || "";
    const icon = cfg.icon || (st?.attributes.icon as string | undefined) || "mdi:gauge";
    const neutral = "var(--secondary-text-color)";
    const segs = resolveSegments(cfg.segments, min, max, resolveThemeColor("primary"));
    const resolved = segs.map((s) => ({ ...s, color: resolveThemeColor(s.color) }));
    const current = available ? segmentFor(raw, resolved) : undefined;
    const animate = shouldAnimate(cfg.animation) && !isReducedMotion();
    this._moveNeedle(available ? fractionOf(raw, min, max) : this._needleTarget, animate);
    const pos = this._needlePos;

    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(cfg);
    const headColor = current?.color ?? neutral;
    const iconWell = tintOn(this, headColor, undefined, 18);
    const pillBg = tintOn(this, headColor, undefined, 20);
    const cssVars = buildCssVars({
      "m3p-icon-color": foregroundOn(headColor, iconWell),
      "m3p-icon-bg": iconWell,
      "m3p-text": textColorCss,
      "m3p-secondary-text": secondaryTextColorCss,
    });
    const radius = resolveCornerRadius(cfg.radius ?? DEFAULT_GAUGE_RADIUS, cfg.corners);

    // The dial: 300 × 250 view, centre a little above the middle so the
    // value fits into the opening at the bottom.
    const CX = 150;
    const CY = 132;
    const R = 112;
    const STROKE = 18;
    const capDeg = ((STROKE / 2) / R) * (180 / Math.PI);
    const { track, fill } = arcPieces(resolved, min, max, available ? pos : 0, 2, capDeg);
    const ticks = cfg.show_ticks === false ? [] : tickValues(min, max, cfg.tick_count ?? 5);
    const showNeedle = available && cfg.show_needle !== false;
    const needleDeg = angleOf(pos);
    const tip = pointAt(CX, CY, R - STROKE / 2 - 10, needleDeg);
    const tail = pointAt(CX, CY, 16, needleDeg + 180);
    const valueText = available ? formatNumber(this._language, raw, { maximumFractionDigits: Math.abs(raw) >= 100 ? 0 : 1 }) : "–";
    const sec = cfg.secondary;
    let secondaryText: string | undefined;
    if (typeof sec === "string") secondaryText = sec;
    else if (sec?.entity) {
      const s2 = hass.states[sec.entity];
      const v2 = s2 ? parseFloat(s2.state) : NaN;
      const label = sec.name ?? (s2?.attributes.friendly_name as string | undefined) ?? sec.entity;
      secondaryText = `${label} ${Number.isFinite(v2) ? formatNumber(this._language, v2, { maximumFractionDigits: Math.abs(v2) >= 100 ? 0 : 1 }) : "–"}${s2?.attributes.unit_of_measurement ? ` ${s2.attributes.unit_of_measurement}` : ""}`;
    }
    const ariaText = available
      ? `${valueText} ${unit}${current?.label ? `, ${current.label}` : ""}`
      : this._t("gauge_no_data");

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(cfg.glass_background)}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          <div class="needle-head">
            ${renderCardHeader({ icon, name, subtitle: cfg.subtitle || "" })}
            ${current?.label
              ? html`<div class="range-pill" style=${`background: ${pillBg}; color: ${foregroundOn(headColor, pillBg, 4.5)};`}>${current.label}</div>`
              : !available
                ? html`<div class="range-pill neutral">–</div>`
                : nothing}
          </div>
          <div
            class="dial"
            role="meter"
            aria-valuemin=${min}
            aria-valuemax=${max}
            aria-valuenow=${available ? raw : nothing}
            aria-valuetext=${ariaText}
            aria-label=${name}
          >
            <svg viewBox="0 0 300 250" class="dial-svg">
              ${track.map(
                (p) => svg`<path d=${arcPathDeg(CX, CY, R, p.fromDeg, p.toDeg)} stroke=${p.color} class="dial-track"></path>`,
              )}
              ${fill.map(
                (p) => svg`<path d=${arcPathDeg(CX, CY, R, p.fromDeg, p.toDeg)} stroke=${p.color} class="dial-fill"></path>`,
              )}
              ${ticks.map((v) => {
                const pt = pointAt(CX, CY, R - STROKE - 22, angleOf(fractionOf(v, min, max)));
                return svg`<text x=${pt.x} y=${pt.y} class="dial-tick" text-anchor="middle" dominant-baseline="middle">${compactTick(v, this._language)}</text>`;
              })}
              ${showNeedle
                ? svg`
                    <line x1=${tail.x} y1=${tail.y} x2=${tip.x} y2=${tip.y} class="needle"></line>
                    <circle cx=${CX} cy=${CY} r="13" class="hub"></circle>
                    <circle cx=${CX} cy=${CY} r="6" class="hub-inner"></circle>`
                : nothing}
            </svg>
            <div class="dial-readout">
              ${cfg.show_value !== false
                ? html`<div class="dial-value">
                    ${valueText}${cfg.show_unit !== false && unit && available ? html`<span class="dial-unit">${unit}</span>` : nothing}
                  </div>`
                : nothing}
              ${secondaryText ? html`<div class="dial-secondary">${secondaryText}</div>` : nothing}
            </div>
          </div>
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

      /* style: needle */
      .needle-head {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .needle-head > :first-child {
        flex: 1;
        min-width: 0;
      }
      .range-pill {
        flex: 0 0 auto;
        height: 32px;
        padding: 0 14px;
        border-radius: 16px;
        display: flex;
        align-items: center;
        font-size: 14px;
        font-weight: 700;
      }
      .range-pill.neutral {
        background: color-mix(in srgb, var(--primary-text-color) 8%, var(--ha-card-background, var(--card-background-color)));
        color: var(--m3p-secondary-text);
      }
      .dial {
        position: relative;
        width: 100%;
        max-width: 340px;
        margin: 0 auto;
      }
      .dial-svg {
        display: block;
        width: 100%;
        height: auto;
        overflow: visible;
      }
      .dial-track,
      .dial-fill {
        fill: none;
        stroke-width: 18px;
        stroke-linecap: round;
      }
      .dial-track {
        opacity: 0.28;
      }
      .dial-tick {
        font-size: 15px;
        font-weight: 500;
        fill: var(--m3p-secondary-text);
        opacity: 0.8;
      }
      .needle {
        stroke: var(--primary-text-color);
        stroke-width: 5px;
        stroke-linecap: round;
      }
      .hub {
        fill: var(--primary-text-color);
      }
      .hub-inner {
        fill: var(--ha-card-background, var(--card-background-color, #1c1c1c));
      }
      .dial-readout {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        text-align: center;
      }
      .dial-value {
        font-size: 34px;
        font-weight: 700;
        line-height: 1.05;
        color: var(--m3p-text);
        font-variant-numeric: tabular-nums;
      }
      .dial-unit {
        font-size: 16px;
        font-weight: 500;
        margin-left: 3px;
        opacity: 0.75;
      }
      .dial-secondary {
        font-size: 13px;
        color: var(--m3p-secondary-text);
        margin-top: 2px;
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
