import { LitElement, html, css, nothing, svg, unsafeCSS, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, HassEntity, LovelaceCard, M3DetailCardConfig } from "./types";
import {
  CARD_VERSION,
  DEFAULT_DETAIL_ICON,
  DETAIL_BUTTON_RADIUS_PRESSED,
  DETAIL_BUTTON_SIZE,
  DETAIL_CHART_HALO,
  DETAIL_CHART_HEIGHT,
  DETAIL_CHART_PADDING,
  DETAIL_CLOSE_RADIUS,
  DETAIL_DEFAULT_ACCENT,
  DETAIL_DEVICE_CLASS_COLORS,
  DETAIL_DEVICE_CLASS_ICONS,
  DETAIL_ICON_RADIUS,
  DETAIL_ICON_SIZE,
  DETAIL_MIN_COLOR,
  DETAIL_SETTINGS_RADIUS,
  DETAIL_TICK_MS,
  DETAIL_TREND_DOWN_COLOR,
  DETAIL_TREND_HEIGHT,
  DETAIL_TREND_RADIUS,
  DETAIL_TREND_UP_COLOR,
  resolveCornerRadius,
} from "./const";
import { RADIUS } from "./shared/tokens";
import {
  buildCssVars,
  fillColor,
  foregroundColor,
  resolveCommonColors,
  resolveThemeColor,
  tintInk,
  tintOn,
} from "./shared/color-config";
import { glassCardStyles, glassCardClass, renderMissingEntity } from "./shared/glass-card";
import { shouldAnimate, isReducedMotion, STANDARD_EASING } from "./shared/animation";
import { formatNumber } from "./shared/formatting";
import { localize, type TranslationKey } from "./localize";
import { hassChangeMatters } from "./shared/should-update";
import { TemplatedCard } from "./shared/templated-card";
import { openEntitySettings } from "./shared/entity-detail";
import {
  DETAIL_RANGE_MS,
  fetchEntitySeries,
  seriesExtremes,
  type DetailRange,
  type EntitySeries,
  type SeriesPoint,
} from "./shared/entity-history";
import { monotoneArea, monotonePath, type XY } from "./shared/smooth-path";

const EASING = unsafeCSS(STANDARD_EASING);

console.info(
  `%c M3-DETAIL-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #85b7eb; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #85b7eb; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

interface RegistryEntity {
  device_id?: string | null;
  area_id?: string | null;
  platform?: string;
  display_precision?: number | null;
}
interface RegistryDevice {
  name?: string | null;
  name_by_user?: string | null;
  area_id?: string | null;
}
interface RegistryArea {
  name?: string;
}

const MISSING = new Set(["unavailable", "unknown", ""]);

/**
 * One entity, large: its value, where it has been, and how far it moved.
 *
 * Usable on its own — on a dashboard, in browser_mod or bubble-card popups, in
 * the suite's `popup` with `mode: custom` — and it is what the detail sheet
 * (shared/detail-sheet.ts) shows when a card is set to `detail_mode: sheet`.
 * In the sheet it is handed a `closeHandler` and draws a close button.
 */
@customElement("m3-detail-card")
export class M3DetailCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;
  /** Set by the sheet. With it the card draws a close button and calls this. */
  @property({ attribute: false }) public closeHandler?: () => void;

  @state() private _config?: M3DetailCardConfig;
  @state() private _series?: EntitySeries;
  @state() private _chartWidth = 0;
  @state() private _now = Date.now();

  private _fetchKey = "";
  private _fetchSeq = 0;
  private _tick?: number;
  private _resize?: ResizeObserver;
  private _observed?: Element;

  public setConfig(config: M3DetailCardConfig): void {
    if (!config?.entity) throw new Error("m3-detail-card: `entity` is required");
    this._config = config;
  }

  public static getStubConfig(hass?: HomeAssistant): M3DetailCardConfig {
    const entity =
      Object.keys(hass?.states ?? {}).find(
        (id) => id.startsWith("sensor.") && hass!.states[id].attributes?.state_class === "measurement",
      ) ?? "";
    return { type: "custom:m3-detail-card", entity };
  }

  /** Reads the history again — the sheet calls this each time it opens. */
  public refresh(): void {
    this._fetchKey = "";
    this._now = Date.now();
    this._maybeFetch();
  }

  public getCardSize(): number {
    return 5;
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this._now = Date.now();
    this._tick = window.setInterval(() => (this._now = Date.now()), DETAIL_TICK_MS);
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._tick) clearInterval(this._tick);
    this._resize?.disconnect();
    this._resize = undefined;
    this._observed = undefined;
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return hassChangeMatters(changed, this.hass, [this._config?.entity]);
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("hass") || changed.has("_config")) this._maybeFetch();
    this._observeChart();
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private get _range(): DetailRange {
    return this._config?.range ?? "24h";
  }

  // ---- data ------------------------------------------------------------------

  private _maybeFetch(): void {
    const hass = this.hass;
    const entity = this._config?.entity;
    if (!hass || !entity || !hass.states[entity]) return;
    const key = `${entity}|${this._range}`;
    if (key === this._fetchKey) return;
    this._fetchKey = key;
    this._series = undefined;
    // A range or entity change while a request is out must not let the older
    // answer land on top of the newer question.
    const seq = ++this._fetchSeq;
    void fetchEntitySeries(hass, entity, this._range).then((series) => {
      if (seq === this._fetchSeq) this._series = series;
    });
  }

  private _observeChart(): void {
    const chart = this.renderRoot.querySelector(".chart");
    if (!chart || chart === this._observed) return;
    this._resize ??= new ResizeObserver((entries) => {
      const width = Math.round(entries[0]?.contentRect.width ?? 0);
      if (width !== this._chartWidth) this._chartWidth = width;
    });
    if (this._observed) this._resize.unobserve(this._observed);
    this._resize.observe(chart);
    this._observed = chart;
  }

  // ---- naming ----------------------------------------------------------------

  private _registry(entityId: string): {
    entity?: RegistryEntity;
    device?: RegistryDevice;
    area?: RegistryArea;
  } {
    const entity = this.hass?.entities?.[entityId] as RegistryEntity | undefined;
    const device = entity?.device_id
      ? (this.hass?.devices?.[entity.device_id] as RegistryDevice | undefined)
      : undefined;
    const areaId = entity?.area_id ?? device?.area_id ?? undefined;
    const area = areaId ? (this.hass?.areas?.[areaId] as RegistryArea | undefined) : undefined;
    return { entity, device, area };
  }

  /**
   * The entity's name without its device's in front of it.
   *
   * Home Assistant composes `friendly_name` as "device entity", so a
   * thermometer's humidity reads "Thermometer 13 Luftfeuchtigkeit" — and the
   * breadcrumb above the title already says which thermometer. When nothing
   * is left after stripping (the entity *is* the device), the full name stays.
   */
  private _names(st: HassEntity): { title: string; crumb: string } {
    const { entity, device, area } = this._registry(st.entity_id);
    const friendly = String(st.attributes.friendly_name ?? st.entity_id);
    const deviceName = (device?.name_by_user || device?.name || "").trim();
    let title = friendly;
    if (deviceName && friendly.toLowerCase().startsWith(deviceName.toLowerCase() + " ")) {
      title = friendly.slice(deviceName.length).trim() || friendly;
    }
    const crumb = [deviceName, area?.name ?? entity?.platform].filter(Boolean).join(" · ");
    return { title: this._config?.name || title, crumb };
  }

  private _icon(st: HassEntity): string {
    const deviceClass = String(st.attributes.device_class ?? "");
    return (
      this._config?.icon ||
      (st.attributes.icon as string | undefined) ||
      DETAIL_DEVICE_CLASS_ICONS[deviceClass] ||
      DEFAULT_DETAIL_ICON
    );
  }

  private _accent(st: HassEntity): string {
    if (this._config?.color) return resolveThemeColor(this._config.color);
    return DETAIL_DEVICE_CLASS_COLORS[String(st.attributes.device_class ?? "")] ?? DETAIL_DEFAULT_ACCENT;
  }

  // ---- numbers -----------------------------------------------------------------

  /** The registry's display precision, else as many decimals as the state has (at most two). */
  private _decimals(st: HassEntity): number {
    const precision = this._registry(st.entity_id).entity?.display_precision;
    if (typeof precision === "number") return precision;
    const dot = st.state.indexOf(".");
    return dot < 0 ? 0 : Math.min(2, st.state.length - dot - 1);
  }

  private _format(value: number, decimals: number): string {
    return formatNumber(this._language, value, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  private _since(iso: string): string {
    const seconds = Math.round((Date.parse(iso) - this._now) / 1000);
    if (!Number.isFinite(seconds)) return "";
    const rtf = new Intl.RelativeTimeFormat(this._language, { numeric: "auto" });
    const abs = Math.abs(seconds);
    if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
    if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
    return rtf.format(Math.round(seconds / 86400), "day");
  }

  // ---- chart -------------------------------------------------------------------

  private _timeLabel(t: number): string {
    const tf = this.hass?.locale?.time_format;
    const hour12 = tf === "12" ? true : tf === "24" ? false : undefined;
    const range = this._range;
    const opts: Intl.DateTimeFormatOptions =
      range === "7d"
        ? { weekday: "short" }
        : range === "30d"
          ? { day: "numeric", month: "numeric" }
          : { hour: "numeric", minute: "2-digit", hour12 };
    return new Intl.DateTimeFormat(this._language, opts).format(new Date(t));
  }

  /**
   * Where the axis labels go: three times spread over the window, rounded to
   * something a person would say, and "now" at the end.
   */
  private _labels(t0: number, span: number): { t: number; text: string }[] {
    const round =
      this._range === "1h" ? 15 * 60_000 : this._range === "24h" ? 3_600_000 : 86_400_000;
    const out: { t: number; text: string }[] = [];
    for (let i = 0; i < 3; i++) {
      const raw = t0 + (span * i) / 3;
      // Rounded up, so the first label never falls left of the plot.
      const t = Math.ceil(raw / round) * round;
      out.push({ t, text: this._timeLabel(t) });
    }
    out.push({ t: t0 + span, text: this._t("detail_now") });
    return out;
  }

  private _renderChart(st: HassEntity, accent: string, available: boolean): unknown {
    const series = this._series;
    if (!series) return html`<div class="chart loading" style="height:${DETAIL_CHART_HEIGHT}px"></div>`;
    if (series.source === "none") return html`<div class="no-history">${this._t("detail_no_history")}</div>`;

    const width = this._chartWidth;
    const height = DETAIL_CHART_HEIGHT;
    const span = DETAIL_RANGE_MS[this._range];
    const t1 = this._now;
    const t0 = t1 - span;
    const points = this._pointsWithLive(series.points, st, t1);
    const visible = points.filter((p) => p.t >= t0);
    const { min, max } = seriesExtremes(visible);

    let body: unknown = nothing;
    if (width > 0 && min && max) {
      const plotW = width - DETAIL_CHART_HALO;
      const lo = min.v as number;
      const hi = max.v as number;
      const spread = hi - lo || Math.abs(hi) * 0.1 || 1;
      const yLo = lo - spread * DETAIL_CHART_PADDING;
      const yHi = hi + spread * DETAIL_CHART_PADDING;
      const top = DETAIL_CHART_HALO;
      const bottom = height - DETAIL_CHART_HALO;
      const x = (t: number) => ((t - t0) / span) * plotW;
      const y = (v: number) => bottom - ((v - yLo) / (yHi - yLo)) * (bottom - top);

      const runs: XY[][] = [];
      let run: XY[] = [];
      for (const p of points) {
        if (p.v === null) {
          if (run.length) runs.push(run);
          run = [];
        } else {
          run.push({ x: x(p.t), y: y(p.v) });
        }
      }
      if (run.length) runs.push(run);

      const last = available ? [...points].reverse().find((p) => p.v !== null) : undefined;
      const minColor = fillColor(this, DETAIL_MIN_COLOR);
      const lineColor = fillColor(this, accent);
      body = svg`
        <defs>
          <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color=${lineColor} stop-opacity="0.32"></stop>
            <stop offset="1" stop-color=${lineColor} stop-opacity="0"></stop>
          </linearGradient>
        </defs>
        ${runs.map((r) => svg`<path class="area" d=${monotoneArea(r, height)} fill="url(#fill)"></path>`)}
        ${runs.map((r) => svg`<path class="line" d=${monotonePath(r)} stroke=${lineColor}></path>`)}
        ${lo !== hi
          ? svg`
              <circle class="ring" cx=${x(min.t)} cy=${y(lo)} r="4" stroke=${minColor}></circle>
              <circle class="ring" cx=${x(max.t)} cy=${y(hi)} r="4" stroke=${lineColor}></circle>
            `
          : nothing}
        ${last
          ? svg`
              <circle cx=${x(last.t)} cy=${y(last.v as number)} r=${DETAIL_CHART_HALO} fill=${lineColor} opacity="0.2"></circle>
              <circle cx=${x(last.t)} cy=${y(last.v as number)} r="5.5" fill=${lineColor}></circle>
            `
          : nothing}
      `;
    }

    const labels = this._labels(t0, span);
    return html`
      <div class="chart ${available ? "" : "dim"}" data-source=${series.source}>
        <svg width="100%" height=${height} viewBox="0 0 ${Math.max(1, width)} ${height}" aria-hidden="true">
          ${body}
        </svg>
      </div>
      <div class="axis">
        ${labels.map((l, i) => {
          const pct = i === labels.length - 1 ? 100 : Math.min(100, Math.max(0, ((l.t - t0) / span) * 100));
          return html`<span class="tick ${i === 0 && pct < 8 ? "start" : ""} ${i === labels.length - 1 ? "end" : ""}" style="left:${pct}%">${l.text}</span>`;
        })}
      </div>
    `;
  }

  /**
   * The fetched series, extended by whatever the entity has done since.
   *
   * The series is read once per opening; the big number above it is live. A
   * reading that arrives while the card is open is appended here, so the line
   * keeps ending on the number it sits under.
   */
  private _pointsWithLive(points: readonly SeriesPoint[], st: HassEntity, now: number): SeriesPoint[] {
    const n = Number(st.state);
    const live = MISSING.has(st.state) || !Number.isFinite(n) ? null : n;
    const lastT = points.length ? points[points.length - 1].t : -Infinity;
    if (lastT >= now) return [...points];
    return [...points, { t: now, v: live }];
  }

  // ---- render --------------------------------------------------------------------

  private _renderTrend(st: HassEntity, decimals: number): unknown {
    const series = this._series;
    const live = Number(st.state);
    if (!series?.points.length || MISSING.has(st.state) || !Number.isFinite(live)) return nothing;
    const t0 = this._now - DETAIL_RANGE_MS[this._range];
    const first = seriesExtremes(series.points.filter((p) => p.t >= t0)).first;
    if (!first) return nothing;
    const diff = live - (first.v as number);
    const step = 10 ** -decimals / 2;
    const dir = diff > step ? 1 : diff < -step ? -1 : 0;
    const good = this._config?.trend_inverted ? -dir : dir;
    const color = good > 0 ? DETAIL_TREND_UP_COLOR : good < 0 ? DETAIL_TREND_DOWN_COLOR : "var(--primary-text-color)";
    const icon = dir > 0 ? "mdi:arrow-top-right" : dir < 0 ? "mdi:arrow-bottom-right" : "mdi:arrow-right";
    const sign = dir > 0 ? "+" : dir < 0 ? "−" : "±";
    return html`
      <span
        class="trend"
        title=${this._t("detail_trend")}
        style=${buildCssVars({
          "trend-bg": tintOn(this, color, undefined, 18),
          "trend-ink": tintInk(this, color, undefined, 18),
        })}
      >
        <ha-icon icon=${icon}></ha-icon>${sign}${this._format(Math.abs(diff), decimals)}
      </span>
    `;
  }

  private _renderValue(st: HassEntity, accent: string): unknown {
    const numeric = !MISSING.has(st.state) && st.state.trim() !== "" && Number.isFinite(Number(st.state));
    const decimals = numeric ? this._decimals(st) : 0;
    const unit = numeric ? (st.attributes.unit_of_measurement as string | undefined) : undefined;
    const text = MISSING.has(st.state)
      ? "—"
      : numeric
        ? this._format(Number(st.state), decimals)
        : (this.hass?.formatEntityState?.(st) ?? st.state);
    // Long numbers step down once; text — "Bewölkt", "Waschen" — starts
    // smaller, because a word at 52px wraps on a phone.
    const size = !numeric && text !== "—" ? "text" : text.length > 6 ? "long" : "";
    return html`
      <div class="value-row">
        <div class="value ${size}" style="color:${foregroundColor(this, accent)}">
          <span class="number">${text}</span>${unit ? html`<span class="unit">${unit}</span>` : nothing}
        </div>
        <div class="value-side">
          ${this._renderTrend(st, decimals)}
          <span class="since"
            >${MISSING.has(st.state) ? this._t("detail_unavailable") : this._since(st.last_changed)}</span
          >
        </div>
      </div>
    `;
  }

  private _openSettings(): void {
    const entity = this._config?.entity;
    // Home Assistant's dialog opening on top of ours would leave two modals
    // stacked, one of them unreachable. Close first.
    this.closeHandler?.();
    openEntitySettings(this, entity);
  }

  protected render() {
    if (!this._config || !this.hass) return nothing;
    const st = this.hass.states[this._config.entity];
    if (!st) return renderMissingEntity(this._config.entity);

    const accent = this._accent(st);
    const { title, crumb } = this._names(st);
    const available = !MISSING.has(st.state);
    const animate = shouldAnimate(this._config.animation) && !isReducedMotion();
    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(this._config);
    const radius = resolveCornerRadius(this._config.radius ?? RADIUS.card, this._config.corners);
    const cssVars = buildCssVars({
      "dc-text": textColorCss,
      "dc-secondary": secondaryTextColorCss,
      "dc-icon-bg": tintOn(this, accent, undefined, 20),
      "dc-icon-ink": tintInk(this, accent, undefined, 20, 3),
      "dc-button-bg": tintOn(this, "var(--primary-text-color)", undefined, 6),
    });

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(this._config.glass_background)} ${animate ? "" : "no-animations"}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          <div class="header">
            <div class="icon"><ha-icon icon=${this._icon(st)}></ha-icon></div>
            <div class="titles">
              ${crumb ? html`<div class="crumb">${crumb}</div>` : nothing}
              <div class="title">${title}</div>
            </div>
            <button class="hbtn settings" @click=${() => this._openSettings()} aria-label=${this._t("detail_settings")}>
              <ha-icon icon="mdi:cog-outline"></ha-icon>
            </button>
            ${this.closeHandler
              ? html`<button class="hbtn close" @click=${() => this.closeHandler?.()} aria-label=${this._t("detail_close")}>
                  <ha-icon icon="mdi:close"></ha-icon>
                </button>`
              : nothing}
          </div>
          ${this._renderValue(st, accent)} ${this._renderChart(st, accent, available)}
        </div>
      </ha-card>
    `;
  }

  static styles = [
    glassCardStyles,
    css`
      .card-inner {
        gap: 16px;
        padding: 16px;
        color: var(--dc-text, var(--primary-text-color));
      }

      /* Inside the sheet the sheet is the surface; a card frame in it would
         be a box drawn inside a box. */
      :host([in-sheet]) .card-inner {
        border: none;
        background: transparent;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
        padding: 0;
      }

      .header {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
      }

      .icon {
        flex: 0 0 auto;
        width: ${DETAIL_ICON_SIZE}px;
        height: ${DETAIL_ICON_SIZE}px;
        border-radius: ${DETAIL_ICON_RADIUS}px;
        display: grid;
        place-items: center;
        background: var(--dc-icon-bg);
        color: var(--dc-icon-ink);
        --mdc-icon-size: 22px;
      }

      .titles {
        flex: 1;
        min-width: 0;
      }

      .crumb {
        font-size: 10px;
        opacity: 0.45;
        color: var(--dc-secondary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.4;
      }

      .title {
        font-size: 18px;
        font-weight: 700;
        line-height: 1.25;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .hbtn {
        flex: 0 0 auto;
        width: ${DETAIL_BUTTON_SIZE}px;
        height: ${DETAIL_BUTTON_SIZE}px;
        border: none;
        padding: 0;
        display: grid;
        place-items: center;
        background: var(--dc-button-bg);
        color: inherit;
        cursor: pointer;
        --mdc-icon-size: 18px;
        transition: border-radius 200ms ${EASING};
      }
      .hbtn.settings {
        border-radius: ${DETAIL_SETTINGS_RADIUS}px;
      }
      .hbtn.close {
        border-radius: ${DETAIL_CLOSE_RADIUS}px;
      }
      .hbtn:active {
        border-radius: ${DETAIL_BUTTON_RADIUS_PRESSED}px;
      }

      .value-row {
        display: flex;
        align-items: flex-start;
        gap: 14px;
        min-width: 0;
      }

      .value {
        display: flex;
        align-items: baseline;
        min-width: 0;
        font-variant-numeric: tabular-nums;
        line-height: 1;
      }
      .value .number {
        font-size: 52px;
        font-weight: 700;
        letter-spacing: -2.4px;
      }
      .value.long .number {
        font-size: 40px;
        letter-spacing: -1.6px;
      }
      .value.text .number {
        font-size: 28px;
        letter-spacing: -0.6px;
        overflow-wrap: anywhere;
      }
      /* The weight contrast is the point: a light unit beside a heavy number
         reads as one value with a label, not as two numbers. */
      .value .unit {
        font-size: 20px;
        font-weight: 300;
        margin-left: 3px;
        letter-spacing: 0;
      }

      .value-side {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 6px;
        padding-top: 4px;
        min-width: 0;
      }

      .trend {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: ${DETAIL_TREND_HEIGHT}px;
        padding: 0 9px 0 7px;
        border-radius: ${DETAIL_TREND_RADIUS}px;
        background: var(--trend-bg);
        color: var(--trend-ink);
        font-size: 13px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        --mdc-icon-size: 15px;
        white-space: nowrap;
      }

      .since {
        font-size: 12px;
        opacity: 0.6;
        color: var(--dc-secondary);
      }

      .chart {
        position: relative;
        height: ${DETAIL_CHART_HEIGHT}px;
        transition: opacity 300ms ${EASING};
      }
      .chart svg {
        display: block;
        overflow: visible;
      }
      .chart.dim {
        opacity: 0.45;
      }
      .chart.loading {
        border-radius: 16px;
        background: var(--dc-button-bg);
        opacity: 0.5;
      }
      .line {
        fill: none;
        stroke-width: 2.6;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .ring {
        fill: var(--ha-card-background, var(--card-background-color, #1c1c1c));
        stroke-width: 2;
      }

      .axis {
        position: relative;
        height: 14px;
        margin-top: -6px;
        font-size: 9px;
        opacity: 0.35;
        font-variant-numeric: tabular-nums;
      }
      .tick {
        position: absolute;
        top: 0;
        transform: translateX(-50%);
        white-space: nowrap;
      }
      .tick.start {
        transform: none;
      }
      .tick.end {
        transform: translateX(-100%);
      }

      .no-history {
        padding: 14px 16px;
        border-radius: 16px;
        background: var(--dc-button-bg);
        font-size: 13px;
        opacity: 0.75;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-detail-card": M3DetailCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-detail-card",
  name: "M3 Detail Card",
  description: "Ein Wert groß, sein Verlauf als geglättete Kurve und die Änderung im gewählten Zeitraum.",
  // false: the preview would fetch a day of statistics for whichever sensor
  // the stub picked, for everyone who opens the card picker.
  preview: false,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
