import { LitElement, html, css, svg, unsafeCSS, nothing, type PropertyValues } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import type {
  HomeAssistant,
  M3WeatherCardConfig,
  WeatherChipType,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_WEATHER_RADIUS,
  DEFAULT_WEATHER_HOURS,
  DEFAULT_WEATHER_DAYS,
  DEFAULT_WEATHER_ACCENT,
  DEFAULT_WEATHER_PRECIPITATION_COLOR,
  DEFAULT_WEATHER_CHIPS,
  WEATHER_HEADER_ICON_RADIUS,
  WEATHER_CHIP_RADIUS,
  WEATHER_DAY_ROW_HEIGHT,
  WEATHER_DAY_ROW_RADIUS,
  WEATHER_PRECIP_BAR_MAX_HEIGHT,
  WEATHER_PRECIP_BAR_RADIUS,
  WEATHER_PRECIP_MIN_SCALE_MM,
  WEATHER_CURVE_STROKE,
  WEATHER_CURVE_DRAW_MS,
  WEATHER_HOUR_DOT_STRIDE,
  WEATHER_REFRESH_MS,
  WEATHER_CHART_HEIGHT,
  WEATHER_DAILY_COLLAPSED_COUNT,
  WEATHER_HOUR_LABEL_MIN_WIDTH_PX,
  WEATHER_HOURLY_SLOT_MIN_WIDTH_PX,
  WEATHER_NICE_HOUR_STRIDES,
  WEATHER_DAYS_TOGGLE_HEIGHT,
  WEATHER_DAYS_TOGGLE_RADIUS,
  WEATHER_DAYS_TOGGLE_RADIUS_OPEN,
  resolveCornerRadius,
} from "./const";
import { resolveThemeColor, buildCssVars, resolveCommonColors, tintOn, tintInk, foregroundOn , foregroundVars} from "./shared/color-config";
import { glassCardStyles, glassCardClass, renderMissingEntity } from "./shared/glass-card";
import { shouldAnimate, STANDARD_EASING } from "./shared/animation";
import { activateOnKey } from "./shared/a11y";
import { computeBarHeights } from "./shared/bar-chart";
import { fireEvent } from "./shared/editor-helpers";
import { localize, type TranslationKey } from "./localize";
import { hassChangeMatters } from "./shared/should-update";
import { formatNumber } from "./shared/formatting";
import { TemplatedCard } from "./shared/templated-card";

console.info(
  `%c M3-WEATHER-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #6ba7dc; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #6ba7dc; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

const EASING = unsafeCSS(STANDARD_EASING);
let instanceCounter = 0;

interface WeatherForecastItem {
  datetime: string;
  condition?: string;
  temperature?: number;
  templow?: number;
  precipitation?: number;
  precipitation_probability?: number;
  wind_speed?: number;
  humidity?: number;
  is_daytime?: boolean;
}

const CONDITION_ICONS: Record<string, string> = {
  "clear-night": "mdi:weather-night",
  cloudy: "mdi:weather-cloudy",
  exceptional: "mdi:alert-circle-outline",
  fog: "mdi:weather-fog",
  hail: "mdi:weather-hail",
  lightning: "mdi:weather-lightning",
  "lightning-rainy": "mdi:weather-lightning-rainy",
  partlycloudy: "mdi:weather-partly-cloudy",
  pouring: "mdi:weather-pouring",
  rainy: "mdi:weather-rainy",
  snowy: "mdi:weather-snowy",
  "snowy-rainy": "mdi:weather-snowy-rainy",
  sunny: "mdi:weather-sunny",
  windy: "mdi:weather-windy",
  "windy-variant": "mdi:weather-windy-variant",
};

// Conditions that visually only make sense in daylight get swapped for a
// night-appropriate icon when the forecast hour/day falls outside daytime —
// most weather integrations report "sunny"/"partlycloudy" around the clock
// and rely on the dashboard to pick the night variant itself.
const NIGHT_ICON_OVERRIDES: Record<string, string> = {
  sunny: "mdi:weather-night",
  partlycloudy: "mdi:weather-night-partly-cloudy",
};

function weatherIcon(condition: string | undefined, daytime: boolean): string {
  if (!condition) return "mdi:weather-cloudy";
  if (!daytime && NIGHT_ICON_OVERRIDES[condition]) return NIGHT_ICON_OVERRIDES[condition];
  return CONDITION_ICONS[condition] ?? "mdi:weather-cloudy";
}

// Picks how many of the n hourly slots can actually fit at their minimum
// width, then rounds that up to a "nice" stride (every 2nd/3rd/4th/6th/...
// hour) so labels/icons land on a regular rhythm instead of an arbitrary
// fraction — the same idea the hour-axis labels already used with a fixed
// stride of 3, now driven by the card's measured width.
function displayStride(n: number, width: number, minSlotWidthPx: number): number {
  if (n <= 1 || width <= 0) return 1;
  const maxEntries = Math.max(1, Math.floor(width / minSlotWidthPx));
  if (maxEntries >= n) return 1;
  const rawStride = Math.ceil(n / maxEntries);
  return WEATHER_NICE_HOUR_STRIDES.find((s) => s >= rawStride) ?? rawStride;
}

// No per-location sunrise/sunset table is available without extra API
// round-trips, so daytime is approximated from the hour of day. Close
// enough for icon selection; `is_daytime` on the forecast item (provided by
// most modern weather integrations) is preferred when present.
function isDaytime(item: WeatherForecastItem): boolean {
  if (typeof item.is_daytime === "boolean") return item.is_daytime;
  const hour = new Date(item.datetime).getHours();
  return hour >= 6 && hour < 20;
}

const CHIP_META: Record<
  WeatherChipType,
  { icon: string; attr: string; unitAttr?: string; fallbackUnit?: string }
> = {
  apparent_temperature: { icon: "mdi:thermometer", attr: "apparent_temperature", unitAttr: "temperature_unit" },
  wind_speed: { icon: "mdi:weather-windy", attr: "wind_speed", unitAttr: "wind_speed_unit" },
  humidity: { icon: "mdi:water-percent", attr: "humidity", fallbackUnit: "%" },
  pressure: { icon: "mdi:gauge", attr: "pressure", unitAttr: "pressure_unit" },
  uv_index: { icon: "mdi:sun-wireless-outline", attr: "uv_index", fallbackUnit: "" },
  visibility: { icon: "mdi:eye-outline", attr: "visibility", unitAttr: "visibility_unit" },
};

// Uniform Catmull-Rom -> cubic-Bezier conversion (tension 1/6) — smooths a
// polyline of points into a single SVG path without overshooting between
// samples, matching the "wavy" M3-expressive line look used elsewhere.
function smoothCurvePath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;
  let d = `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

@customElement("m3-weather-card")
export class M3WeatherCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3WeatherCardConfig;
  @state() private _hourly?: WeatherForecastItem[];
  @state() private _daily?: WeatherForecastItem[];
  @state() private _measuredWidth = 300;
  @state() private _curveRevealed = false;
  @state() private _daysExpanded = false;

  @query(".hourly-wrap") private _hourlyWrapEl?: HTMLDivElement;

  private readonly _instanceId = ++instanceCounter;
  private _refreshTimer?: number;
  private _lastFetchKey?: string;
  private _resizeObserver?: ResizeObserver;
  // Snapshot of the entity while it was last available, so a transient
  // "unavailable" (e.g. the weather integration briefly losing connectivity)
  // keeps showing the last known conditions instead of blanking the card.
  private _lastKnown?: { state: string; attributes: Record<string, unknown>; timestamp: number };

  public static getStubConfig(hass: HomeAssistant): M3WeatherCardConfig {
    const entities = Object.keys(hass?.states ?? {}).filter((eid) => eid.startsWith("weather."));
    return {
      type: "custom:m3-weather-card",
      entity: entities[0] ?? "",
      glass_background: true,
    };
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return hassChangeMatters(changed, this.hass, [this._config?.entity, "sun.sun"]);
  }

  public setConfig(config: M3WeatherCardConfig): void {
    if (!config.entity) {
      throw new Error("Bitte eine weather-Entität auswählen / Please select a weather entity");
    }
    this._config = {
      glass_background: true,
      animation: "auto",
      hours: DEFAULT_WEATHER_HOURS,
      days: DEFAULT_WEATHER_DAYS,
      chips: DEFAULT_WEATHER_CHIPS,
      show_current: true,
      show_chart: true,
      show_sun: true,
      show_days_toggle: true,
      show_hour_labels: true,
      show_hourly_icons: true,
      show_hourly_temperatures: true,
      show_temp_axis: false,
      ...config,
    };
  }

  public getCardSize(): number {
    return 4;
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: "full", rows: "auto", min_rows: 4 };
  }

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-weather-card-editor");
    return document.createElement("m3-weather-card-editor") as unknown as LovelaceCardEditor;
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this._refreshTimer = window.setInterval(() => {
      this._lastFetchKey = undefined;
      this._maybeFetch();
    }, WEATHER_REFRESH_MS);
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._refreshTimer !== undefined) {
      window.clearInterval(this._refreshTimer);
      this._refreshTimer = undefined;
    }
    this._resizeObserver?.disconnect();
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    this._maybeFetch();
    if (this._hourlyWrapEl && !this._resizeObserver) {
      this._resizeObserver = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width;
        if (width && Math.abs(width - this._measuredWidth) > 0.5) {
          this._measuredWidth = width;
        }
      });
      this._resizeObserver.observe(this._hourlyWrapEl);
      const rect = this._hourlyWrapEl.getBoundingClientRect();
      if (rect.width) this._measuredWidth = rect.width;
    }
    if (!this._curveRevealed && this._hourly && this._hourly.length > 0) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this._curveRevealed = true;
        });
      });
    }
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _maybeFetch(): void {
    if (!this.hass || !this._config?.entity) return;
    const key = `${this._config.entity}:${this._config.days ?? 0}`;
    if (key === this._lastFetchKey) return;
    this._lastFetchKey = key;
    this._curveRevealed = false;
    this._fetchForecasts();
  }

  private async _fetchForecasts(): Promise<void> {
    if (!this.hass || !this._config) return;
    const entityId = this._config.entity;
    try {
      const res = await this.hass.callWS<{ response: Record<string, { forecast: WeatherForecastItem[] }> }>({
        type: "call_service",
        domain: "weather",
        service: "get_forecasts",
        service_data: { type: "hourly" },
        target: { entity_id: entityId },
        return_response: true,
      });
      this._hourly = res.response?.[entityId]?.forecast ?? [];
    } catch (e) {
      console.warn("m3-weather-card: hourly forecast fetch failed", e);
      if (this._hourly === undefined) this._hourly = [];
    }

    const days = this._config.days ?? DEFAULT_WEATHER_DAYS;
    if (days > 0) {
      try {
        const res = await this.hass.callWS<{ response: Record<string, { forecast: WeatherForecastItem[] }> }>({
          type: "call_service",
          domain: "weather",
          service: "get_forecasts",
          service_data: { type: "daily" },
          target: { entity_id: entityId },
          return_response: true,
        });
        this._daily = res.response?.[entityId]?.forecast ?? [];
      } catch (e) {
        console.warn("m3-weather-card: daily forecast fetch failed", e);
        if (this._daily === undefined) this._daily = [];
      }
    } else {
      this._daily = [];
    }
  }

  private _fireMoreInfo(): void {
    fireEvent(this, "hass-more-info", { entityId: this._config?.entity });
  }

  private _formatNumber(value: number, decimals = 0): string {
    return formatNumber(this._language, value, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  private _use12Hour(): boolean {
    const fmt = this.hass?.locale?.time_format;
    if (fmt === "12") return true;
    if (fmt === "24") return false;
    return this._language.startsWith("en");
  }

  private _formatHour(date: Date): string {
    return new Intl.DateTimeFormat(this._language, {
      hour: "numeric",
      hour12: this._use12Hour(),
    }).format(date);
  }

  private _formatWeekday(date: Date): string {
    return new Intl.DateTimeFormat(this._language, { weekday: "short" }).format(date);
  }

  private _formatRelativeTime(timestampMs: number): string {
    const rtf = new Intl.RelativeTimeFormat(this._language, { numeric: "auto" });
    const diffMinutes = Math.round((timestampMs - Date.now()) / 60000);
    if (Math.abs(diffMinutes) < 60) return rtf.format(diffMinutes, "minute");
    return rtf.format(Math.round(diffMinutes / 60), "hour");
  }

  protected render() {
    if (!this._config || !this.hass) return nothing;

    const entity = this.hass.states[this._config.entity];
    if (!entity) return renderMissingEntity(this._config.entity);

    const unavailable = entity.state === "unavailable";
    if (!unavailable) {
      this._lastKnown = { state: entity.state, attributes: entity.attributes, timestamp: Date.now() };
    }
    const stale = unavailable && this._lastKnown !== undefined;
    const displayState = stale ? this._lastKnown!.state : entity.state;
    const attrs = stale ? this._lastKnown!.attributes : entity.attributes;
    const name = this._config.name || attrs.friendly_name || this._config.entity;
    const tempUnit = attrs.temperature_unit || this.hass.config?.unit_system?.temperature || "°C";
    const currentTemp: number | undefined = typeof attrs.temperature === "number" ? attrs.temperature : undefined;
    const daytimeNow = isDaytime({ datetime: new Date().toISOString() });
    const headerIcon = weatherIcon(displayState, daytimeNow);
    const conditionText =
      unavailable && !stale
        ? this._t("unavailable")
        : (this.hass.formatEntityState?.({ ...entity, state: displayState, attributes: attrs }) ?? displayState);
    const staleHint = stale
      ? `${this._t("weather_last_known")} · ${this._formatRelativeTime(this._lastKnown!.timestamp)}`
      : undefined;

    const accentColor = this._config.accent_color
      ? resolveThemeColor(this._config.accent_color)
      : DEFAULT_WEATHER_ACCENT;
    const precipColor = this._config.precipitation_color
      ? resolveThemeColor(this._config.precipitation_color)
      : DEFAULT_WEATHER_PRECIPITATION_COLOR;
    const gradientColor = this._config.gradient_color
      ? resolveThemeColor(this._config.gradient_color)
      : accentColor;
    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(this._config);

    const radius = resolveCornerRadius(this._config.radius ?? DEFAULT_WEATHER_RADIUS, this._config.corners);
    const animClass = shouldAnimate(this._config.animation) ? "" : "no-animations";

    // The glyph sits on this well, not on the card, so its contrast has to be
    // measured against the well.
    const iconWellCss = tintOn(this, accentColor, this._config.accent_opacity, 18);
    const cssVars = buildCssVars({
      "m3p-icon-color": foregroundOn(accentColor, iconWellCss),
      "m3p-icon-bg": iconWellCss,
      "m3p-text": textColorCss,
      "m3p-secondary-text": secondaryTextColorCss,
      "wc-accent": accentColor,
      "wc-precip": precipColor,
      "wc-gradient": gradientColor,
      "wc-days-toggle-bg": tintOn(this, accentColor, this._config.accent_opacity, 14),
      // The label sits on that tint, not on the card.
      "wc-days-toggle-ink": tintInk(this, accentColor, this._config.accent_opacity, 14),
      // Fills keep the accent; these twins carry it where it is text.
      ...foregroundVars(this, {
        "m3p-icon-color": accentColor,
        "wc-accent": accentColor,
      }),
    });

    const hours = Math.max(0, this._config.hours ?? DEFAULT_WEATHER_HOURS);
    const chips = this._config.chips ?? DEFAULT_WEATHER_CHIPS;
    const days = this._config.days ?? DEFAULT_WEATHER_DAYS;
    const showCurrent = this._config.show_current ?? true;

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(this._config.glass_background)} ${animClass}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          ${showCurrent || chips.length > 0
            ? html`
                <div
                  class="header"
                  role="button"
                  tabindex="0"
                  aria-label=${name}
                  @click=${() => this._fireMoreInfo()}
                  @keydown=${activateOnKey(() => this._fireMoreInfo())}
                >
                  ${showCurrent
                    ? html`
                        <div class="header-icon-swatch">
                          <ha-icon icon=${headerIcon}></ha-icon>
                        </div>
                        <div class="header-text">
                          <div class="header-temp">
                            ${currentTemp !== undefined ? `${this._formatNumber(currentTemp)}°` : "–"}
                          </div>
                          <div class="header-condition">${conditionText}</div>
                          ${staleHint ? html`<div class="header-stale">${staleHint}</div>` : nothing}
                        </div>
                      `
                    : nothing}
                  ${chips.length > 0 ? html`<div class="header-chips">${chips.map((c) => this._renderChip(c, attrs, tempUnit))}</div>` : nothing}
                </div>
              `
            : nothing}

          ${hours > 0 ? this._renderHourly(hours, accentColor, precipColor, gradientColor) : nothing}
          ${days > 0 ? this._renderDaily(days) : nothing}
        </div>
      </ha-card>
    `;
  }

  private _renderChip(type: WeatherChipType, attrs: Record<string, unknown>, tempUnit: string) {
    const meta = CHIP_META[type];
    const raw = attrs[meta.attr];
    if (raw === undefined || raw === null) return nothing;
    const unit = meta.unitAttr ? ((attrs[meta.unitAttr] as string) ?? "") : (meta.fallbackUnit ?? "");
    const displayUnit = type === "apparent_temperature" ? tempUnit : unit;
    const value = typeof raw === "number" ? this._formatNumber(raw, type === "wind_speed" ? 0 : 0) : String(raw);
    return html`
      <div class="chip">
        <ha-icon icon=${meta.icon}></ha-icon>
        <span>${value}${displayUnit ? ` ${displayUnit}` : ""}</span>
      </div>
    `;
  }

  private _renderHourly(hours: number, accentColor: string, precipColor: string, gradientColor: string) {
    if (this._hourly === undefined) {
      return html`<div class="chart-loading-hint"></div>`;
    }
    if (this._hourly.length === 0) {
      return html`<div class="hint-text">${this._t("weather_no_hourly_forecast")}</div>`;
    }

    const width = this._measuredWidth;
    const height = WEATHER_CHART_HEIGHT;

    // How many hours fit before the strip has to start skipping some, and then
    // how many hours are actually shown — which is not the same number.
    //
    // The strip fills a column per hour and writes into every stride-th one.
    // Unless the stride divides the row exactly, the last few columns stay
    // empty and the whole strip reads as pushed to the left, with a gap at the
    // right edge. Forcing the final hour into the row instead fixes the edge
    // but breaks the rhythm: twelve hours every second one then ends
    // "18 Uhr · 21 Uhr", and twenty-four every third ends with two hours
    // almost touching.
    //
    // A regular rhythm and a flush right edge can only both hold when the
    // stride divides the row, so the row is cut back to where it does. That
    // costs up to stride-1 hours off the tail — twelve requested, eleven drawn
    // — which is invisible next to a strip that ends ragged, and the chart,
    // the rain bars and the sun markers are all cut to the same length so
    // nothing drifts apart.
    const requested = this._hourly.slice(0, hours);
    const stride = displayStride(
      requested.length,
      width,
      (this._config?.show_hour_labels ?? true)
        ? WEATHER_HOUR_LABEL_MIN_WIDTH_PX
        : WEATHER_HOURLY_SLOT_MIN_WIDTH_PX,
    );
    const items =
      stride > 1 ? requested.slice(0, Math.floor((requested.length - 1) / stride) * stride + 1) : requested;
    const n = items.length;
    const temps = items.map((it) => it.temperature ?? 0);
    const minTemp = Math.min(...temps);
    const maxTemp = Math.max(...temps);
    const range = Math.max(1, maxTemp - minTemp);
    const topMargin = 8;
    const bottomMargin = 8;
    const yFor = (t: number) =>
      height - bottomMargin - ((t - minTemp) / range) * (height - topMargin - bottomMargin);
    const xFor = (i: number) => (n > 1 ? (i / (n - 1)) * width : width / 2);

    const points = items.map((it, i) => ({ x: xFor(i), y: yFor(it.temperature ?? minTemp) }));
    const curvePath = smoothCurvePath(points);
    const fillPath =
      points.length > 0
        ? `${curvePath} L${points[points.length - 1].x.toFixed(2)},${height} L${points[0].x.toFixed(2)},${height} Z`
        : "";

    const precipValues = items.map((it) => it.precipitation ?? 0);
    const bars = computeBarHeights(precipValues, WEATHER_PRECIP_BAR_MAX_HEIGHT, WEATHER_PRECIP_MIN_SCALE_MM);

    const sunMarkers = this._config?.show_sun ? this._sunMarkerPositions(items, width) : [];

    const showLabels = this._config?.show_hour_labels ?? true;
    const showHourlyIcons = this._config?.show_hourly_icons ?? true;
    const showHourlyTemps = this._config?.show_hourly_temperatures ?? true;
    const showChart = this._config?.show_chart ?? true;

    // One rhythm for the whole strip. Icon, temperature and hour used to thin
    // out at three different rates, so 24 crowded temperatures sat above eight
    // times that lined up with none of them, and a reader could not tell which
    // number belonged to which hour. They share a stride now, which makes each
    // visible column one reading: this icon, this temperature, at this time.
    //
    // The stride follows the widest thing on show — an hour like "13 Uhr"
    // needs more room than a two-digit temperature — so turning the hours off
    // packs the icons closer rather than leaving their old gaps behind.
    // The row was cut to a whole number of strides above, so the first and the
    // last column both carry content and every step between them is equal.
    const isHourlySlotVisible = (i: number) => i % stride === 0;

    return html`
      <div class="hourly-wrap">
        ${showHourlyIcons || showHourlyTemps
          ? html`
              <div class="hourly-icons">
                ${items.map(
                  (it, i) => html`
                    <div class="hour-slot">
                      ${showHourlyIcons && isHourlySlotVisible(i)
                        ? html`<ha-icon class="hour-icon" icon=${weatherIcon(it.condition, isDaytime(it))}></ha-icon>`
                        : nothing}
                      ${showHourlyTemps && isHourlySlotVisible(i)
                        ? html`<span class="hour-temp">${it.temperature !== undefined ? `${this._formatNumber(it.temperature)}°` : "–"}</span>`
                        : nothing}
                    </div>
                  `,
                )}
              </div>
            `
          : nothing}

        ${showChart
          ? html`
              <div class="chart-track">
                <svg
                  class="curve-svg ${this._curveRevealed ? "revealed" : ""}"
                  viewBox="0 0 ${width} ${height}"
                  width="100%"
                  height=${height}
                  preserveAspectRatio="none"
                >
                  <defs>
                    <linearGradient id="wc-grad-${this._instanceId}" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stop-color=${gradientColor} stop-opacity="0.18"></stop>
                      <stop offset="100%" stop-color=${gradientColor} stop-opacity="0"></stop>
                    </linearGradient>
                  </defs>
                  ${sunMarkers.map(
                    (m) => svg`<line class="sun-marker" x1=${m.x} y1="0" x2=${m.x} y2=${height}></line>`,
                  )}
                  <path class="curve-fill" d=${fillPath} fill="url(#wc-grad-${this._instanceId})"></path>
                  <path class="curve-stroke" d=${curvePath} fill="none" stroke=${accentColor}></path>
                  ${points.map((p, i) =>
                    i % WEATHER_HOUR_DOT_STRIDE === 0
                      ? svg`<circle class="curve-dot" cx=${p.x} cy=${p.y} r="2.5" fill=${accentColor}></circle>`
                      : nothing,
                  )}
                </svg>
                ${this._config?.show_temp_axis ? this._renderTempAxis(minTemp, maxTemp, yFor) : nothing}
              </div>

              <div class="precip-row">
                ${items.map(
                  (_it, i) => html`
                    <div class="hour-slot">
                      ${bars[i].value > 0
                        ? html`
                            <span class="precip-label">${this._formatNumber(bars[i].value, 1)}</span>
                            <div
                              class="precip-bar"
                              style=${`height: ${bars[i].heightPx}px; background: ${precipColor};`}
                            ></div>
                          `
                        : html`<div class="precip-bar empty"></div>`}
                    </div>
                  `,
                )}
              </div>
            `
          : nothing}

        ${showLabels
          ? html`
              <div class="hour-labels">
                ${items.map(
                  (it, i) => html`
                    <div class="hour-slot">
                      ${isHourlySlotVisible(i)
                        ? html`
                            <span class="hour-label ${i === 0 ? "now" : ""}">
                              ${i === 0 ? this._t("weather_now") : this._formatHour(new Date(it.datetime))}
                            </span>
                          `
                        : nothing}
                    </div>
                  `,
                )}
              </div>
            `
          : nothing}
      </div>
    `;
  }

  private _renderTempAxis(minTemp: number, maxTemp: number, yFor: (t: number) => number) {
    const midTemp = (minTemp + maxTemp) / 2;
    const ticks = maxTemp === minTemp ? [maxTemp] : [maxTemp, midTemp, minTemp];
    return html`
      <div class="temp-axis">
        ${ticks.map(
          (t) => html`<span class="temp-axis-label" style=${`top: ${yFor(t).toFixed(1)}px`}>${this._formatNumber(t)}°</span>`,
        )}
      </div>
    `;
  }

  private _sunMarkerPositions(items: WeatherForecastItem[], width: number): { x: number }[] {
    if (!this.hass || items.length === 0) return [];
    const sun = this.hass.states["sun.sun"];
    if (!sun) return [];
    const rangeStart = new Date(items[0].datetime).getTime();
    const rangeEnd = new Date(items[items.length - 1].datetime).getTime();
    const markers: { x: number }[] = [];
    for (const attr of ["next_rising", "next_setting"]) {
      const raw = sun.attributes[attr];
      if (typeof raw !== "string") continue;
      const t = new Date(raw).getTime();
      if (Number.isNaN(t) || t < rangeStart || t > rangeEnd) continue;
      const frac = (t - rangeStart) / Math.max(1, rangeEnd - rangeStart);
      markers.push({ x: frac * width });
    }
    return markers;
  }

  private _renderDaily(days: number) {
    if (this._daily === undefined) return nothing;
    if (this._daily.length === 0) return nothing;

    const showToggle = this._config?.show_days_toggle ?? true;
    const total = Math.min(days, this._daily.length);
    const collapsedCount = showToggle ? Math.min(WEATHER_DAILY_COLLAPSED_COUNT, total) : total;
    const visibleCount = this._daysExpanded ? total : collapsedCount;
    const canExpand = showToggle && total > collapsedCount;
    const items = this._daily.slice(0, visibleCount);
    const allHigh = items.map((it) => it.temperature ?? 0);
    const allLow = items.map((it) => it.templow ?? it.temperature ?? 0);
    const weekMin = Math.min(...allLow);
    const weekMax = Math.max(...allHigh);
    const weekRange = Math.max(1, weekMax - weekMin);

    return html`
      <div class="daily-list">
        ${items.map((it, i) => {
          const high = it.temperature ?? weekMax;
          const low = it.templow ?? weekMin;
          const startPct = ((low - weekMin) / weekRange) * 100;
          const endPct = ((high - weekMin) / weekRange) * 100;
          const dayColor = `color-mix(in srgb, #6ba7dc ${100 - endPct}%, #e57368 ${endPct}%)`;
          return html`
            <div class="day-row">
              <span class="day-name">${i === 0 ? this._t("weather_today") : this._formatWeekday(new Date(it.datetime))}</span>
              <ha-icon class="day-icon" icon=${weatherIcon(it.condition, true)}></ha-icon>
              ${it.precipitation_probability !== undefined && it.precipitation_probability > 0
                ? html`<span class="day-pop">${Math.round(it.precipitation_probability)} %</span>`
                : html`<span class="day-pop"></span>`}
              <div class="day-range">
                <span class="day-low">${this._formatNumber(low)}°</span>
                <div class="day-track">
                  <div
                    class="day-fill"
                    style=${`left: ${startPct}%; width: ${Math.max(4, endPct - startPct)}%; background: ${dayColor};`}
                  ></div>
                </div>
                <span class="day-high">${this._formatNumber(high)}°</span>
              </div>
            </div>
          `;
        })}
      </div>
      ${canExpand
        ? html`
            <button
              class="days-toggle ${this._daysExpanded ? "open" : ""}"
              @click=${() => (this._daysExpanded = !this._daysExpanded)}
            >
              <span
                >${this._daysExpanded
                  ? this._t("weather_days_collapse")
                  : this._t("weather_days_expand").replace("{n}", String(total - collapsedCount))}</span
              >
              <ha-icon class="chevron" icon="mdi:chevron-down"></ha-icon>
            </button>
          `
        : nothing}
    `;
  }

  static styles = [
    glassCardStyles,
    css`
      .header {
        display: flex;
        align-items: center;
        gap: 12px;
        cursor: pointer;
      }

      .header:focus-visible {
        outline: 2px solid var(--wc-accent);
        outline-offset: 2px;
        border-radius: 8px;
      }

      .header-icon-swatch {
        flex-shrink: 0;
        width: 56px;
        height: 56px;
        border-radius: ${WEATHER_HEADER_ICON_RADIUS}px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--m3p-icon-bg);
        color: var(--m3p-icon-color-fg, var(--m3p-icon-color));
      }

      .header-icon-swatch ha-icon {
        --mdc-icon-size: 30px;
      }

      .header-text {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .header-temp {
        font-size: 34px;
        font-weight: 700;
        line-height: 1;
        color: var(--m3p-text);
      }

      .header-condition {
        font-size: 13px;
        color: var(--m3p-secondary-text);
        opacity: 0.75;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .header-stale {
        font-size: 11px;
        color: var(--m3p-secondary-text);
        opacity: 0.55;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .header-chips {
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .chip {
        height: 30px;
        padding: 0 10px;
        border-radius: ${WEATHER_CHIP_RADIUS}px;
        background: color-mix(in srgb, var(--primary-text-color) 6%, var(--ha-card-background, var(--card-background-color)));
        color: var(--m3p-text);
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 11px;
        font-weight: 600;
        white-space: nowrap;
      }

      .chip ha-icon {
        --mdc-icon-size: 14px;
        opacity: 0.75;
      }

      .hint-text {
        font-size: 12px;
        opacity: 0.6;
        color: var(--m3p-text);
      }

      .hourly-wrap {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .hourly-icons,
      .precip-row,
      .hour-labels {
        display: flex;
      }

      .hour-slot {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
      }

      .hour-icon {
        --mdc-icon-size: 14px;
        opacity: 0.6;
        color: var(--m3p-text);
      }

      .hour-temp {
        font-size: 10px;
        font-weight: 700;
        color: var(--m3p-text);
      }

      .chart-track {
        position: relative;
        width: 100%;
      }

      .curve-svg {
        display: block;
        width: 100%;
        overflow: visible;
      }

      .curve-fill,
      .curve-stroke {
        clip-path: inset(0 100% 0 0);
        transition: clip-path ${WEATHER_CURVE_DRAW_MS}ms ${EASING};
      }

      .curve-svg.revealed .curve-fill,
      .curve-svg.revealed .curve-stroke {
        clip-path: inset(0 0% 0 0);
      }

      .card-inner.no-animations .curve-fill,
      .card-inner.no-animations .curve-stroke {
        transition: none;
        clip-path: inset(0 0% 0 0);
      }

      .curve-stroke {
        stroke-width: ${WEATHER_CURVE_STROKE}px;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .curve-dot {
        opacity: 0.9;
      }

      .temp-axis {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }

      .temp-axis-label {
        position: absolute;
        left: 2px;
        transform: translateY(-50%);
        font-size: 10px;
        font-weight: 600;
        color: var(--m3p-secondary-text);
        background: color-mix(in srgb, var(--ha-card-background, var(--card-background-color)) 75%, transparent);
        padding: 0 3px;
        border-radius: 4px;
        white-space: nowrap;
      }

      .sun-marker {
        stroke: var(--m3p-secondary-text);
        stroke-width: 1px;
        stroke-dasharray: 2 3;
        opacity: 0.4;
      }

      .precip-bar {
        width: 60%;
        max-width: 18px;
        border-radius: ${WEATHER_PRECIP_BAR_RADIUS}px ${WEATHER_PRECIP_BAR_RADIUS}px 0 0;
        min-height: 2px;
      }

      .precip-bar.empty {
        min-height: 0;
      }

      .precip-label {
        font-size: 9px;
        opacity: 0.65;
        color: var(--m3p-text);
      }

      .hour-label {
        font-size: 10px;
        opacity: 0.55;
        color: var(--m3p-text);
        white-space: nowrap;
      }

      .hour-label.now {
        font-weight: 700;
        opacity: 1;
      }

      .daily-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .days-toggle {
        width: 100%;
        height: ${WEATHER_DAYS_TOGGLE_HEIGHT}px;
        margin-top: 6px;
        border-radius: ${WEATHER_DAYS_TOGGLE_RADIUS}px;
        border: none;
        background: var(--wc-days-toggle-bg);
        color: var(--wc-days-toggle-ink, var(--wc-accent-fg, var(--wc-accent)));
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-size: 13px;
        font-family: inherit;
        cursor: pointer;
        transition: border-radius 350ms ${EASING};
      }

      .days-toggle.open {
        border-radius: ${WEATHER_DAYS_TOGGLE_RADIUS_OPEN}px;
      }

      .days-toggle .chevron {
        --mdc-icon-size: 18px;
        transition: transform 250ms ${EASING};
      }

      .days-toggle.open .chevron {
        transform: rotate(180deg);
      }

      .card-inner.no-animations .days-toggle,
      .card-inner.no-animations .days-toggle .chevron {
        transition: none;
      }

      .day-row {
        height: ${WEATHER_DAY_ROW_HEIGHT}px;
        border-radius: ${WEATHER_DAY_ROW_RADIUS}px;
        background: color-mix(in srgb, var(--primary-text-color) 5%, var(--ha-card-background, var(--card-background-color)));
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 12px;
        box-sizing: border-box;
      }

      .day-name {
        flex-shrink: 0;
        width: 34px;
        font-size: 13px;
        font-weight: 600;
        color: var(--m3p-text);
      }

      .day-icon {
        flex-shrink: 0;
        --mdc-icon-size: 20px;
        color: var(--m3p-icon-color-fg, var(--m3p-icon-color));
      }

      .day-pop {
        flex-shrink: 0;
        width: 34px;
        font-size: 11px;
        color: var(--wc-accent-fg, var(--wc-accent));
        opacity: 0.8;
      }

      .day-range {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .day-low {
        flex-shrink: 0;
        width: 26px;
        font-size: 12px;
        opacity: 0.6;
        color: var(--m3p-text);
        text-align: right;
      }

      .day-high {
        flex-shrink: 0;
        width: 26px;
        font-size: 12px;
        font-weight: 700;
        color: var(--m3p-text);
      }

      .day-track {
        position: relative;
        flex: 1;
        height: 4px;
        border-radius: 2px;
        background: color-mix(in srgb, var(--primary-text-color) 10%, var(--ha-card-background, var(--card-background-color)));
      }

      .day-fill {
        position: absolute;
        top: 0;
        bottom: 0;
        border-radius: 2px;
      }

      /* Safari gained color-mix() in 16.2, and an iPod touch 7 or an iPad Air 2
         stops at iOS 15. A plain declaration before each mix cannot serve as the
         fallback: every one of them contains var(), which defers the check until
         after substitution, where failure yields unset rather than the previous
         declaration — the tint did not fade, the fill disappeared entirely. This
         block is the one those browsers alone can see; the tint is what it gives
         up. Backticks are not allowed in here: this is a css template literal. */
      @supports not (color: color-mix(in srgb, red 50%, blue)) {
        .chip {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .day-row {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .day-track {
          background: var(--ha-card-background, var(--card-background-color));
        }
      }
      `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-weather-card": M3WeatherCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-weather-card",
  name: "M3 Weather Card",
  description: "Wetterkarte mit Stundenverlauf, Temperaturkurve, Niederschlag und Tagesvorhersage.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
