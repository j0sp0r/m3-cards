import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  HassEntity,
  M3EnergyCardConfig,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_ENERGY_RADIUS,
  DEFAULT_ENERGY_ACCENT,
  DEFAULT_ENERGY_DAYS,
  DEFAULT_ENERGY_HOURS,
  DEFAULT_ENERGY_MONTHS,
  DEFAULT_SOLAR_ICON,
  DEFAULT_ENERGY_ICON,
  ENERGY_ICON_BY_DEVICE_CLASS,
  ENERGY_BAR_TINT_PERCENT,
  ENERGY_SOLAR_BAR_TINT_PERCENT,
  ENERGY_FORECAST_OUTLINE_OPACITY,
  ENERGY_PROJECTION_OUTLINE_OPACITY,
  ENERGY_MONTH_COMPARISON_BETTER_COLOR,
  ENERGY_MONTH_COMPARISON_WORSE_COLOR,
  ENERGY_SOLAR_LABEL_STEP,
  ENERGY_SOLAR_COMPARISON_DAYS,
  ENERGY_REFRESH_MS,
  ENERGY_REFRESH_HOUR_MS,
  ENERGY_REFRESH_MONTH_MS,
  ENERGY_DENSE_BAR_THRESHOLD,
  ENERGY_MONTH_BAR_MAX_HEIGHT,
  ENERGY_MONTH_BAR_MIN_HEIGHT,
  ENERGY_MONTH_BAR_GAP,
  ENERGY_MONTH_BAR_RADIUS,
  resolveCornerRadius,
} from "./const";
import { resolveThemeColor, buildCssVars, resolveCommonColors, tintOn, tintInk, foregroundOn, fillColor, foregroundVars } from "./shared/color-config";
import { glassCardStyles, glassCardClass, renderMissingEntity } from "./shared/glass-card";
import { activateOnKey } from "./shared/a11y";
import { renderCardHeader, cardHeaderStyles } from "./shared/card-header";
import {
  fetchEnergyDays,
  fetchEnergyHours,
  fetchEnergyMonths,
  fetchMonthToDateSum,
  fetchSolarDayHours,
  fetchSolarPastDays,
  fetchCurrentPeriodChangeSum,
  mapWhHoursToLocalKwh,
  localHourKey,
} from "./shared/ha-statistics";
import { getSolarEntities, fetchSolarForecast } from "./shared/ha-energy";
import { fireEvent } from "./shared/editor-helpers";
import { shouldAnimate } from "./shared/animation";
import { localize, type TranslationKey } from "./localize";
import { formatNumber } from "./shared/formatting";
import { hassChangeMatters } from "./shared/should-update";
import { TemplatedCard } from "./shared/templated-card";

console.info(
  `%c M3-ENERGY-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #81c784; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #81c784; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

const BAR_MAX_HEIGHT = 90;
const BAR_MIN_HEIGHT = 8;

interface BarValue {
  label: string;
  value: number;
  isCurrent: boolean;
  showLabel: boolean;
  // Solar mode only: this hour's forecast (kWh), and whether the hour is
  // still ahead of "now" (pure forecast, no actual data yet).
  forecastValue?: number;
  isFuture?: boolean;
}

@customElement("m3-energy-card")
export class M3EnergyCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3EnergyCardConfig;
  @state() private _dayValues: number[] = [];
  @state() private _loading = true;
  @state() private _revealed = false;
  @state() private _staggerActive = false;
  @state() private _activeBarIndex?: number;
  @state() private _solarActualByHour: Map<string, number> = new Map();
  @state() private _solarPastDays: number[] = [];
  @state() private _solarForecastByHour?: Map<string, number>;
  @state() private _solarCurrentHourValue = 0;
  @state() private _noEnergyDashboard = false;
  @state() private _monthCompletedValues: number[] = [];
  @state() private _monthCurrentValue = 0;
  @state() private _monthRealCount = 0;

  private _refreshTimer?: number;
  private _refreshBucket?: string;
  private _lastFetchKey?: string;
  private _fetchInFlight = false;
  private _hasLoadedOnce = false;
  private _bubbleTimer?: number;

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-energy-card-editor");
    return document.createElement(
      "m3-energy-card-editor",
    ) as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(hass: HomeAssistant): M3EnergyCardConfig {
    const entities = Object.keys(hass?.states ?? {}).filter(
      (eid) => eid.startsWith("sensor."),
    );
    const preferred = entities.find((eid) => {
      const st = hass.states[eid];
      const deviceClass = st?.attributes?.device_class;
      return (
        deviceClass === "energy" &&
        (/solar/.test(eid) || /daily/.test(eid))
      );
    });
    return {
      type: "custom:m3-energy-card",
      entity: preferred ?? entities[0] ?? "",
      glass_background: true,
    };
  }

  public setConfig(config: M3EnergyCardConfig): void {
    const mode = config.mode ?? "consumption";
    const usesEnergyDashboard = mode === "solar" && config.source === "energy";
    if (!config.entity && !usesEnergyDashboard) {
      throw new Error(
        "Bitte eine Energie-Entität auswählen / Please select an energy entity",
      );
    }
    this._config = {
      glass_background: true,
      animation: "auto",
      // Solar-dashboard sensors are almost always lifetime-cumulative
      // (state_class: total_increasing, never reset), so "change" is the
      // right per-hour delta there. Month mode needs "change" too: even a
      // *_daily-resetting counter sensor's "state" statistic at month
      // granularity is just whatever the daily value happened to be on the
      // last day of the month (a few kWh), not the month's total — "change"
      // correctly accumulates across all the daily resets within the month.
      // Day/hour mode's *_daily/*_hourly counters reset at exactly that
      // granularity, where "state" (last raw value of the period) is right.
      statistic_type: mode === "solar" || config.period === "month" ? "change" : "state",
      mode: "consumption",
      source: "entity",
      full_day: false,
      show_legend: true,
      period: "day",
      days: DEFAULT_ENERGY_DAYS,
      hours: DEFAULT_ENERGY_HOURS,
      months: DEFAULT_ENERGY_MONTHS,
      show_values: false,
      show_projection: true,
      show_comparison: true,
      show_average: true,
      higher_is_better: false,
      ...config,
    };
  }

  public getCardSize(): number {
    return 3;
  }

  public getGridOptions(): LovelaceGridOptions {
    return {
      columns: "full",
      rows: "auto",
      min_rows: 3,
    };
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _ensureRefreshTimer(): void {
    const period = this._config?.period ?? "day";
    const mode = this._config?.mode ?? "consumption";
    const bucket = `${mode}:${period}`;
    if (this._refreshTimer !== undefined && this._refreshBucket === bucket) return;
    if (this._refreshTimer !== undefined) {
      window.clearInterval(this._refreshTimer);
    }
    this._refreshBucket = bucket;
    const ms =
      period === "month"
        ? ENERGY_REFRESH_MONTH_MS
        : period === "hour" || mode === "solar"
          ? ENERGY_REFRESH_HOUR_MS
          : ENERGY_REFRESH_MS;
    this._refreshTimer = window.setInterval(() => {
      this._lastFetchKey = undefined;
      this._maybeFetch();
    }, ms);
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._refreshTimer !== undefined) {
      window.clearInterval(this._refreshTimer);
      this._refreshTimer = undefined;
    }
    if (this._bubbleTimer !== undefined) {
      window.clearTimeout(this._bubbleTimer);
      this._bubbleTimer = undefined;
    }
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    this._ensureRefreshTimer();
    this._maybeFetch();
  }

  private _maybeFetch(): void {
    if (!this.hass || !this._config) return;
    const mode = this._config.mode ?? "consumption";
    if (mode === "solar") {
      const key = `solar|${this._config.entity}|${this._config.source}|${this._config.forecast_entity}|${this._config.statistic_type}`;
      if (key === this._lastFetchKey) return;
      this._lastFetchKey = key;
      this._fetchData();
      return;
    }
    if (!this._config.entity) return;
    const period = this._config.period ?? "day";
    const span =
      period === "hour" ? this._config.hours : period === "month" ? this._config.months : this._config.days;
    const key = `${this._config.entity}|${period}|${span}|${this._config.statistic_type}`;
    if (key === this._lastFetchKey) return;
    this._lastFetchKey = key;
    this._fetchData();
  }

  private async _fetchData(): Promise<void> {
    if (!this.hass || !this._config || this._fetchInFlight) return;
    const mode = this._config.mode ?? "consumption";
    if (mode === "solar") {
      await this._fetchSolarData();
      return;
    }
    if (!this._config.entity) return;
    const period = this._config.period ?? "day";
    if (period === "month") {
      await this._fetchMonthData();
      return;
    }
    this._fetchInFlight = true;
    const entity = this._config.entity;
    const statisticType = this._config.statistic_type ?? "state";
    const barCount =
      period === "hour"
        ? (this._config.hours ?? DEFAULT_ENERGY_HOURS)
        : (this._config.days ?? DEFAULT_ENERGY_DAYS);
    try {
      const result =
        period === "hour"
          ? await fetchEnergyHours(this.hass, entity, barCount, statisticType)
          : await fetchEnergyDays(this.hass, entity, barCount, statisticType);
      this._dayValues = result.values;
    } catch (e) {
      console.error("m3-energy-card: failed to load energy data", e);
    } finally {
      this._loading = false;
      this._fetchInFlight = false;
      this._markLoadedOnce(barCount);
    }
  }

  private async _fetchMonthData(): Promise<void> {
    if (!this.hass || !this._config?.entity || this._fetchInFlight) return;
    this._fetchInFlight = true;
    const entity = this._config.entity;
    const statisticType = this._config.statistic_type ?? "state";
    const months = this._config.months ?? DEFAULT_ENERGY_MONTHS;
    try {
      const result = await fetchEnergyMonths(this.hass, entity, months, statisticType);
      // Always render the full 12-month axis (zero-filled for months
      // without statistics, e.g. before the entity existed) — same
      // treatment as a newly added power entity gets, rather than hiding
      // months or blocking the whole chart.
      this._monthCompletedValues = result.values;
      this._monthRealCount = result.realMonthCount;

      // Month-to-date (full completed days of this month) at day
      // granularity, same reset-double-counting-avoidance reasoning as
      // fetchEnergyMonths — plus today's own still-running contribution,
      // added the same way "today" is computed everywhere else in this
      // card (live state for periodically-resetting counters, a
      // fine-grained current-period sum for lifetime ones). Computed
      // unconditionally: the still-running month is real data independent
      // of whether any past months have statistics yet.
      const monthToDate = await fetchMonthToDateSum(this.hass, entity, statisticType);
      if (statisticType === "change") {
        const todayMidnight = new Date();
        todayMidnight.setHours(0, 0, 0, 0);
        const todaySoFar = await fetchCurrentPeriodChangeSum(
          this.hass,
          [entity],
          todayMidnight,
          "hour",
        );
        this._monthCurrentValue = monthToDate + todaySoFar;
      } else {
        this._monthCurrentValue = monthToDate + this._liveValueInKwh(this.hass.states[entity]);
      }
    } catch (e) {
      console.error("m3-energy-card: failed to load monthly energy data", e);
    } finally {
      this._loading = false;
      this._fetchInFlight = false;
      this._markLoadedOnce(months);
    }
  }

  private async _fetchSolarData(): Promise<void> {
    if (!this.hass || !this._config || this._fetchInFlight) return;
    this._fetchInFlight = true;
    const config = this._config;
    const statisticType = config.statistic_type ?? "change";
    let entityIds: string[];
    let forecastConfigEntryIds: string[] = [];
    try {
      if (config.source === "energy") {
        const solar = await getSolarEntities(this.hass);
        entityIds = solar?.from ?? [];
        forecastConfigEntryIds = solar?.forecastConfigEntryIds ?? [];
        this._noEnergyDashboard = !solar;
      } else {
        entityIds = config.entity ? [config.entity] : [];
        this._noEnergyDashboard = false;
      }
      this._solarActualByHour = await fetchSolarDayHours(this.hass, entityIds, statisticType);
      this._solarPastDays = await fetchSolarPastDays(
        this.hass,
        entityIds,
        ENERGY_SOLAR_COMPARISON_DAYS,
        statisticType,
      );

      // For "change"-type (lifetime-cumulative) counters, the live entity
      // state is the all-time total, not "this hour so far" — compute that
      // delta from short-term statistics instead. Periodically-resetting
      // ("state"-type) counters can be read live directly (see render()).
      if (statisticType === "change") {
        const currentHourStart = new Date();
        currentHourStart.setMinutes(0, 0, 0);
        this._solarCurrentHourValue = await fetchCurrentPeriodChangeSum(
          this.hass,
          entityIds,
          currentHourStart,
        );
      } else {
        this._solarCurrentHourValue = this._sumLiveStates(entityIds);
      }

      let forecast: Map<string, number> | undefined;
      if (forecastConfigEntryIds.length > 0) {
        forecast = await fetchSolarForecast(this.hass, forecastConfigEntryIds);
      }
      if (!forecast && config.forecast_entity) {
        const whHours = this.hass.states[config.forecast_entity]?.attributes?.wh_hours as
          | Record<string, number>
          | undefined;
        if (whHours) forecast = mapWhHoursToLocalKwh(whHours);
      }
      this._solarForecastByHour = forecast;
    } catch (e) {
      console.error("m3-energy-card: failed to load solar data", e);
    } finally {
      this._loading = false;
      this._fetchInFlight = false;
      this._markLoadedOnce(24);
    }
  }

  private _markLoadedOnce(barCount: number): void {
    if (this._hasLoadedOnce) return;
    this._hasLoadedOnce = true;
    if (shouldAnimate(this._config?.animation)) {
      this._staggerActive = true;
      requestAnimationFrame(() => {
        this._revealed = true;
        const totalDelay = (barCount + 1) * 30 + 400;
        window.setTimeout(() => {
          this._staggerActive = false;
        }, totalDelay);
      });
    } else {
      this._revealed = true;
    }
  }

  private _handleBarTap(index: number): void {
    if (this._bubbleTimer !== undefined) {
      window.clearTimeout(this._bubbleTimer);
      this._bubbleTimer = undefined;
    }
    if (this._activeBarIndex === index) {
      this._activeBarIndex = undefined;
      return;
    }
    this._activeBarIndex = index;
    this._bubbleTimer = window.setTimeout(() => {
      this._activeBarIndex = undefined;
      this._bubbleTimer = undefined;
    }, 2000);
  }

  // Whether hour-axis labels should render in 12h (AM/PM) or 24h notation,
  // honoring the user's HA time-format preference before falling back to
  // what the resolved locale would use by default.
  private _use12Hour(): boolean {
    const timeFormat = this.hass?.locale?.time_format;
    if (timeFormat === "12") return true;
    if (timeFormat === "24") return false;
    try {
      return !!new Intl.DateTimeFormat(this._language, { hour: "numeric" }).resolvedOptions()
        .hour12;
    } catch {
      return false;
    }
  }

  // Reads a live entity state as kWh, normalizing Wh/MWh-native sensors
  // (common among solar inverters/smart plugs) so summing across mixed
  // sources — and comparing against kWh-converted statistics/forecast data
  // — lines up.
  private _liveValueInKwh(entity: HassEntity | undefined): number {
    if (!entity) return 0;
    const raw = parseFloat(entity.state);
    if (entity.state === "unavailable" || entity.state === "unknown" || isNaN(raw)) return 0;
    const unit = String(entity.attributes.unit_of_measurement ?? "").toLowerCase();
    if (unit === "wh") return raw / 1000;
    if (unit === "mwh") return raw * 1000;
    return raw;
  }

  private _currentValue(entity: HassEntity): number {
    return this._liveValueInKwh(entity);
  }

  private _buildBars(entity: HassEntity): BarValue[] {
    const config = this._config!;
    const period = config.period ?? "day";
    const currentValue = this._currentValue(entity);
    let bars: BarValue[];

    if (period === "hour") {
      const hours = config.hours ?? DEFAULT_ENERGY_HOURS;
      const formatter = new Intl.DateTimeFormat(this._language, {
        hour: "numeric",
        minute: "2-digit",
        hour12: this._use12Hour(),
      });
      const currentHourStart = new Date();
      currentHourStart.setMinutes(0, 0, 0);
      bars = [];
      for (let i = hours; i >= 1; i--) {
        const d = new Date(currentHourStart);
        d.setHours(d.getHours() - i);
        const value = this._dayValues[hours - i] ?? 0;
        bars.push({ label: formatter.format(d), value, isCurrent: false, showLabel: true });
      }
      bars.push({
        label: this._t("energy_hour_now"),
        value: currentValue,
        isCurrent: true,
        showLabel: true,
      });
    } else {
      const days = config.days ?? DEFAULT_ENERGY_DAYS;
      const formatter = new Intl.DateTimeFormat(this._language, { weekday: "short" });
      const todayMidnight = new Date();
      todayMidnight.setHours(0, 0, 0, 0);
      bars = [];
      for (let i = days; i >= 1; i--) {
        const d = new Date(todayMidnight);
        d.setDate(d.getDate() - i);
        const value = this._dayValues[days - i] ?? 0;
        bars.push({ label: formatter.format(d), value, isCurrent: false, showLabel: true });
      }
      bars.push({
        label: this._t("energy_weekday_today"),
        value: currentValue,
        isCurrent: true,
        showLabel: true,
      });
    }

    if (bars.length > ENERGY_DENSE_BAR_THRESHOLD) {
      const lastIndex = bars.length - 1;
      bars = bars.map((b, i) => ({ ...b, showLabel: (lastIndex - i) % 2 === 0 }));
    }
    return bars;
  }

  // Straight-line projection for the still-running current month: what the
  // month's total would be if the rest of it continues at the same average
  // daily rate seen so far.
  private _monthProjection(): number {
    const now = new Date();
    const elapsedDays = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    if (elapsedDays <= 0) return this._monthCurrentValue;
    return (this._monthCurrentValue / elapsedDays) * daysInMonth;
  }

  private _buildMonthBars(): BarValue[] {
    const config = this._config!;
    const formatter = new Intl.DateTimeFormat(this._language, { month: "short" });
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    // fetchEnergyMonths always returns a full months-1-length array
    // (zero-filled for months predating the entity), so this naturally
    // covers the whole configured axis.
    const pastCount = this._monthCompletedValues.length;

    let bars: BarValue[] = [];
    for (let i = pastCount; i >= 1; i--) {
      const d = new Date(currentMonthStart.getFullYear(), currentMonthStart.getMonth() - i, 1);
      const value = this._monthCompletedValues[pastCount - i];
      bars.push({ label: formatter.format(d), value, isCurrent: false, showLabel: true });
    }
    bars.push({
      label: formatter.format(currentMonthStart),
      value: this._monthCurrentValue,
      isCurrent: true,
      showLabel: true,
      forecastValue: config.show_projection !== false ? this._monthProjection() : undefined,
    });

    if (bars.length > ENERGY_DENSE_BAR_THRESHOLD) {
      const lastIndex = bars.length - 1;
      bars = bars.map((b, i) => ({ ...b, showLabel: (lastIndex - i) % 2 === 0 }));
    }
    return bars;
  }

  private _sumLiveStates(entityIds: string[]): number {
    if (!this.hass) return 0;
    let total = 0;
    for (const id of entityIds) {
      total += this._liveValueInKwh(this.hass.states[id]);
    }
    return total;
  }

  // Builds today's hourly bars for solar mode: actual generation (live for
  // the running hour, statistics for completed hours) plus, where available,
  // a forecast overlay — trimmed to the first..last hour with any
  // generation or forecast (unless `full_day` forces the full 0-24 range),
  // always including the current hour even if it's zero.
  // Solar mode's trimmed range is often wider than the fixed-hours mode (a
  // full sunrise-to-sunset span), so the "HH:MM" labels used there don't fit
  // these narrower columns. Asking Intl for `hour: "numeric"` alone doesn't
  // help — some locales (e.g. German) pad that out to "15 Uhr", longer than
  // "15:00". Format normally, then strip the always-":00" minutes instead.
  private _formatHourShort(date: Date): string {
    const formatter = new Intl.DateTimeFormat(this._language, {
      hour: "numeric",
      minute: "2-digit",
      hour12: this._use12Hour(),
    });
    return formatter.format(date).replace(":00", "").trim();
  }

  private _buildSolarBars(): { bars: BarValue[]; hasForecast: boolean } {
    const config = this._config!;
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const currentHourStart = new Date();
    currentHourStart.setMinutes(0, 0, 0);
    const currentHourIndex = currentHourStart.getHours();
    const liveCurrentValue = this._solarCurrentHourValue;

    const hasForecast = !!this._solarForecastByHour && this._solarForecastByHour.size > 0;

    const hourEntries: { hourIndex: number; date: Date; actual: number; forecast?: number }[] =
      [];
    for (let h = 0; h < 24; h++) {
      const d = new Date(todayMidnight);
      d.setHours(h);
      const key = localHourKey(d);
      const actual = h === currentHourIndex ? liveCurrentValue : (this._solarActualByHour.get(key) ?? 0);
      const forecast = this._solarForecastByHour?.get(key);
      hourEntries.push({ hourIndex: h, date: d, actual, forecast });
    }

    let startIdx = 0;
    let endIdx = 23;
    if (!config.full_day) {
      const nonZero = hourEntries.filter((e) => e.actual > 0 || (e.forecast ?? 0) > 0);
      if (nonZero.length > 0) {
        startIdx = nonZero[0].hourIndex;
        endIdx = nonZero[nonZero.length - 1].hourIndex;
      } else {
        startIdx = currentHourIndex;
        endIdx = currentHourIndex;
      }
    }
    startIdx = Math.min(startIdx, currentHourIndex);
    endIdx = Math.max(endIdx, currentHourIndex);

    let bars: BarValue[] = hourEntries.slice(startIdx, endIdx + 1).map((e) => {
      const isCurrent = e.hourIndex === currentHourIndex;
      const isFuture = e.hourIndex > currentHourIndex;
      return {
        label: isCurrent ? this._t("energy_hour_now") : this._formatHourShort(e.date),
        value: isFuture ? 0 : e.actual,
        isCurrent,
        isFuture,
        forecastValue: e.forecast,
        showLabel: isCurrent || e.hourIndex % ENERGY_SOLAR_LABEL_STEP === 0,
      };
    });

    if (bars.length > ENERGY_DENSE_BAR_THRESHOLD * 2) {
      // Extremely wide (full_day) ranges: thin further to every 4th hour.
      bars = bars.map((b, i) => {
        const hourIndex = startIdx + i;
        return { ...b, showLabel: b.isCurrent || hourIndex % 4 === 0 };
      });
    }

    return { bars, hasForecast };
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    // The bars come from fetched statistics, not from states, and the fetch is
    // driven by config rather than by hass ticks. Only two entities are read
    // live: the one the card is pointed at, and the solar forecast attribute.
    return hassChangeMatters(changed, this.hass, [
      this._config?.entity,
      this._config?.forecast_entity,
    ]);
  }

  protected render() {
    if (!this._config || !this.hass) return nothing;

    const mode = this._config.mode ?? "consumption";
    const usesEnergyDashboard = mode === "solar" && this._config.source === "energy";
    const entity = usesEnergyDashboard
      ? undefined
      : this.hass.states[this._config.entity ?? ""];

    if (!usesEnergyDashboard && !entity) {
      return renderMissingEntity(this._config.entity ?? "");
    }
    if (usesEnergyDashboard && this._noEnergyDashboard) {
      return html`
        <ha-card>
          <div class="card-inner glass">
            <div class="missing-entity">${this._t("gauge_no_energy_dashboard")}</div>
          </div>
        </ha-card>
      `;
    }
    const name =
      this._config.name ||
      entity?.attributes.friendly_name ||
      (mode === "solar" ? this._t("energy_solar_default_name") : this._config.entity);
    const icon =
      this._config.icon ||
      (mode === "solar"
        ? DEFAULT_SOLAR_ICON
        : (ENERGY_ICON_BY_DEVICE_CLASS[entity?.attributes.device_class ?? ""] ??
          DEFAULT_ENERGY_ICON));
    const period = this._config.period ?? "day";
    const subtitle =
      this._config.subtitle ||
      (mode === "solar"
        ? this._t("energy_subtitle_solar")
        : period === "hour"
          ? this._t("energy_subtitle_hours").replace(
              "{hours}",
              String(this._config.hours ?? DEFAULT_ENERGY_HOURS),
            )
          : period === "month"
            ? this._t("energy_subtitle_months").replace(
                "{months}",
                String(this._config.months ?? DEFAULT_ENERGY_MONTHS),
              )
            : this._t("energy_subtitle_days").replace(
                "{days}",
                String(this._config.days ?? DEFAULT_ENERGY_DAYS),
              ));

    const accentColor = this._config.accent_color
      ? resolveThemeColor(this._config.accent_color)
      : DEFAULT_ENERGY_ACCENT;
    const tintPercent = mode === "solar" ? ENERGY_SOLAR_BAR_TINT_PERCENT : ENERGY_BAR_TINT_PERCENT;
    const tintColorCss = this._config.bar_tint_color
      ? resolveThemeColor(this._config.bar_tint_color)
      : tintOn(this, accentColor, this._config.accent_opacity, tintPercent);
    // The highlighted bar is a bare fill, so it needs the solid-fill rule
    // rather than the tint one — otherwise it lands below its own neighbours
    // in a light theme.
    const currentBarCss = fillColor(this, accentColor);
    const outlineOpacity =
      period === "month" ? ENERGY_PROJECTION_OUTLINE_OPACITY : ENERGY_FORECAST_OUTLINE_OPACITY;
    const outlineColorCss = tintOn(this, accentColor, this._config.accent_opacity, outlineOpacity);
    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(
      this._config,
    );

    const radius = resolveCornerRadius(
      this._config.radius ?? DEFAULT_ENERGY_RADIUS,
      this._config.corners,
    );

    let values: BarValue[];
    let hasForecast = false;
    if (mode === "solar") {
      const solarBars = this._buildSolarBars();
      values = solarBars.bars;
      hasForecast = solarBars.hasForecast;
    } else if (period === "month") {
      values = this._buildMonthBars();
    } else {
      values = this._buildBars(entity!);
    }

    const geometry =
      period === "month"
        ? {
            maxHeight: ENERGY_MONTH_BAR_MAX_HEIGHT,
            minHeight: ENERGY_MONTH_BAR_MIN_HEIGHT,
            gap: ENERGY_MONTH_BAR_GAP,
            radius: ENERGY_MONTH_BAR_RADIUS,
          }
        : { maxHeight: BAR_MAX_HEIGHT, minHeight: BAR_MIN_HEIGHT, gap: 6, radius: 9 };

    const unit = this._config?.unit || entity?.attributes.unit_of_measurement || "kWh";
    const barExtent = (v: BarValue): number =>
      v.isFuture
        ? (v.forecastValue ?? 0)
        : v.isCurrent
          ? Math.max(v.value, v.forecastValue ?? 0)
          : v.value;
    // Floor is only to avoid dividing by zero when every bar is 0 — must stay
    // far below any real value. A literal "1" here silently caps the scale
    // for entities whose typical values are well under 1 (e.g. kWh per hour
    // for a small solar setup), making every bar render at a fraction of the
    // available height regardless of how tall it should actually be.
    const maxValue = Math.max(0.001, ...values.map(barExtent));
    const showValueRow =
      mode === "solar" || period === "month"
        ? false
        : period === "hour"
          ? values.length <= ENERGY_DENSE_BAR_THRESHOLD
          : !!this._config.show_values && values.length <= ENERGY_DENSE_BAR_THRESHOLD;

    const currentValue =
      mode === "solar"
        ? values.reduce((sum, v) => sum + (v.isFuture ? 0 : v.value), 0)
        : (values[values.length - 1]?.value ?? 0);
    const forecastDayTotal =
      mode === "solar" && hasForecast
        ? values.reduce((sum, v) => sum + Math.max(v.value, v.forecastValue ?? 0), 0)
        : undefined;

    // Divide by the count of months actually backed by statistics, not the
    // full configured window — otherwise a recently added entity's average
    // stays diluted by zero-filled pre-existence months for up to a year.
    const monthAverage =
      period === "month" && this._monthRealCount > 0
        ? this._monthCompletedValues.reduce((a, b) => a + b, 0) / this._monthRealCount
        : undefined;

    const betterColor = this._config.comparison_better_color
      ? resolveThemeColor(this._config.comparison_better_color)
      : ENERGY_MONTH_COMPARISON_BETTER_COLOR;
    const worseColor = this._config.comparison_worse_color
      ? resolveThemeColor(this._config.comparison_worse_color)
      : ENERGY_MONTH_COMPARISON_WORSE_COLOR;

    const monthComparison = (() => {
      if (period !== "month" || this._config.show_comparison === false) return undefined;
      const previousMonth = this._monthCompletedValues[this._monthCompletedValues.length - 1];
      if (!previousMonth) return undefined;
      const compareValue =
        this._config.show_projection !== false ? this._monthProjection() : this._monthCurrentValue;
      const percent = ((compareValue - previousMonth) / previousMonth) * 100;
      const higherIsBetter = mode === "solar" || !!this._config.higher_is_better;
      const isMore = percent > 0;
      const isBetter = higherIsBetter ? isMore : !isMore;
      const prevMonthDate = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
      const prevMonthName = new Intl.DateTimeFormat(this._language, { month: "short" }).format(
        prevMonthDate,
      );
      return {
        percent: Math.round(Math.abs(percent)),
        isMore,
        color: isBetter ? betterColor : worseColor,
        prevMonthName,
      };
    })();

    // Same "vs previous period" + "N-period average" pattern as month mode,
    // one level down: vs yesterday, and the average of the past
    // ENERGY_SOLAR_COMPARISON_DAYS days (today itself isn't included in
    // either — it's still running).
    const solarAverage =
      mode === "solar" && this._solarPastDays.length > 0
        ? this._solarPastDays.reduce((a, b) => a + b, 0) / this._solarPastDays.length
        : undefined;

    const solarComparison = (() => {
      if (mode !== "solar" || this._config.show_comparison === false) return undefined;
      const yesterday = this._solarPastDays[this._solarPastDays.length - 1];
      if (!yesterday) return undefined;
      const compareValue = forecastDayTotal ?? currentValue;
      const percent = ((compareValue - yesterday) / yesterday) * 100;
      const isMore = percent > 0;
      return {
        percent: Math.round(Math.abs(percent)),
        isMore,
        color: isMore ? betterColor : worseColor,
      };
    })();

    // month/solar comparison+average are mutually exclusive (a card is
    // either in month-bar mode or solar-day mode, never both) — unify them
    // into one shape so the markup below doesn't need to branch twice.
    const activeComparison = monthComparison
      ? {
          ...monthComparison,
          moreKey: "energy_month_chip_more" as TranslationKey,
          lessKey: "energy_month_chip_less" as TranslationKey,
          monthName: monthComparison.prevMonthName as string | undefined,
        }
      : solarComparison
        ? {
            ...solarComparison,
            moreKey: "energy_solar_chip_more" as TranslationKey,
            lessKey: "energy_solar_chip_less" as TranslationKey,
            monthName: undefined as string | undefined,
          }
        : undefined;
    const activeAverage = monthAverage ?? solarAverage;

    const currentMonthName =
      period === "month"
        ? new Intl.DateTimeFormat(this._language, { month: "long" }).format(new Date())
        : "";

    // The glyph sits on this well, not on the card, so its contrast has to be
    // measured against the well.
    const iconWellCss = tintOn(this, accentColor, this._config.accent_opacity, 18);
    const cssVars = buildCssVars({
      "m3p-accent": accentColor,
      "m3p-icon-color": foregroundOn(accentColor, iconWellCss),
      "m3p-icon-bg": iconWellCss,
      "m3p-text": textColorCss,
      "m3p-secondary-text": secondaryTextColorCss,
      "bar-max-height": `${geometry.maxHeight}px`,
      "bar-gap": `${geometry.gap}px`,
      "bar-radius": `${geometry.radius}px`,
      // Fills keep the accent; these twins carry it where it is text.
      ...foregroundVars(this, {
        "m3p-accent": accentColor,
      }),
    });

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(this._config.glass_background)} ${shouldAnimate(this._config?.animation) ? "" : "no-animations"}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          ${renderCardHeader({
            icon,
            name,
            subtitle,
            onClick: this._config.entity
              ? () => fireEvent(this, "hass-more-info", { entityId: this._config!.entity! })
              : undefined,
            right: html`
              <div class="current-value">
                <div class="current-number">${this._formatNumber(currentValue)}</div>
                <div class="current-unit">
                  ${mode === "solar"
                    ? forecastDayTotal !== undefined
                      ? this._t("energy_solar_expected")
                          .replace("{value}", this._formatNumber(forecastDayTotal))
                          .replace("{unit}", unit)
                      : `${unit} ${this._t("energy_today_suffix")}`
                    : period === "month"
                      ? `${unit} ${this._t("energy_month_suffix").replace("{month}", currentMonthName)}`
                      : html`
                          ${unit}
                          ${period === "hour"
                            ? this._t("energy_hour_suffix")
                            : this._t("energy_today_suffix")}
                        `}
                </div>
              </div>
            `,
          })}

          ${activeComparison || activeAverage !== undefined
            ? html`
                <div class="comparison-row">
                  ${activeComparison
                    ? html`
                        <div
                          class="comparison-chip"
                          style=${`color: ${tintInk(this, activeComparison.color, this._config.comparison_tint_opacity, 16)}; background: ${tintOn(this, activeComparison.color, this._config.comparison_tint_opacity, 16)};`}
                        >
                          <ha-icon
                            icon=${activeComparison.isMore ? "mdi:arrow-up" : "mdi:arrow-down"}
                          ></ha-icon>
                          <span>
                            ${this._t(
                              activeComparison.isMore ? activeComparison.moreKey : activeComparison.lessKey,
                            )
                              .replace("{value}", String(activeComparison.percent))
                              .replace("{month}", activeComparison.monthName ?? "")}
                          </span>
                        </div>
                      `
                    : nothing}
                  ${activeAverage !== undefined
                    ? html`
                        <div class="comparison-chip neutral">
                          <span
                            >${this._t("energy_month_chip_average")
                              .replace("{value}", this._formatNumber(activeAverage))
                              .replace("{unit}", unit)}</span
                          >
                        </div>
                      `
                    : nothing}
                </div>
              `
            : nothing}

          ${showValueRow
            ? html`
                <div class="values-row">
                  ${values.map(
                    (v) => html`
                      <div class="bar-value ${v.isCurrent ? "current" : ""}">
                        ${this._formatNumber(v.value)}
                      </div>
                    `,
                  )}
                </div>
              `
            : nothing}

          <div class="bars-row ${this._loading ? "loading" : ""}">
            ${period === "month" && this._config.show_average !== false && monthAverage !== undefined
              ? html`
                  <div
                    class="average-line"
                    style=${`bottom: ${((monthAverage / maxValue) * geometry.maxHeight).toFixed(1)}px;`}
                  ></div>
                `
              : nothing}
            ${values.map((v, i) => {
              const targetHeight =
                geometry.minHeight + (geometry.maxHeight - geometry.minHeight) * (v.value / maxValue);
              const heightPx = this._revealed ? targetHeight : geometry.minHeight;
              const growDelay = this._staggerActive ? i * 30 : 0;
              const active = this._activeBarIndex === i;

              const remainder =
                v.forecastValue !== undefined ? Math.max(0, v.forecastValue - v.value) : 0;
              // Floor forecast-only bars at the same minHeight as actual bars —
              // otherwise a small (but non-zero) forecast rounds down to a few
              // px tall, which with the bar's border-radius reads as a dot
              // instead of a bar (hard to tell it's "some forecast" at a glance).
              const remainderHeight = Math.max(
                geometry.minHeight,
                geometry.maxHeight * (remainder / maxValue),
              );
              const remainderHeightPx = this._revealed && remainder > 0 ? remainderHeight : 0;

              const bubbleValue = v.isFuture ? (v.forecastValue ?? 0) : v.value;

              return html`
                <div
                  class="bar-col"
                  role="button"
                  tabindex="0"
                  aria-label=${`${this._formatNumber(bubbleValue)} ${unit}`}
                  @keydown=${activateOnKey(() => this._handleBarTap(i))}
                >
                  ${active
                    ? html`
                        <div class="value-bubble">${this._formatNumber(bubbleValue)} ${unit}</div>
                      `
                    : nothing}
                  ${remainder > 0
                    ? html`
                        <div
                          class="bar-outline"
                          style=${`height: ${remainderHeightPx.toFixed(1)}px; border-color: ${outlineColorCss}; --grow-delay: ${growDelay}ms;`}
                          @click=${() => this._handleBarTap(i)}
                        ></div>
                      `
                    : nothing}
                  ${v.isFuture
                    ? nothing
                    : html`
                        <div
                          class="bar ${v.isCurrent ? "current" : ""} ${active ? "active" : ""}"
                          style=${`height: ${heightPx.toFixed(1)}px; background: ${v.isCurrent ? currentBarCss : tintColorCss}; --grow-delay: ${growDelay}ms;`}
                          @click=${() => this._handleBarTap(i)}
                        ></div>
                      `}
                </div>
              `;
            })}
          </div>

          <div class="labels-row">
            ${values.map(
              (v) => html`
                <div class="day-label ${v.isCurrent ? "current" : ""}">
                  ${v.showLabel ? v.label : ""}
                </div>
              `,
            )}
          </div>

          ${mode === "solar" && hasForecast && this._config.show_legend !== false
            ? html`
                <div class="legend">
                  <div class="legend-chip">
                    <span class="legend-swatch solid"></span>
                    <span>${this._t("energy_legend_generated")}</span>
                  </div>
                  <div class="legend-chip">
                    <span class="legend-swatch outline" style=${`border-color: ${outlineColorCss};`}></span>
                    <span>${this._t("energy_legend_forecast")}</span>
                  </div>
                </div>
              `
            : nothing}
        </div>
      </ha-card>
    `;
  }

  private _formatNumber(value: number): string {
    return formatNumber(this._language, value, { maximumFractionDigits: 2 });
  }

  static styles = [
    glassCardStyles,
    cardHeaderStyles,
    css`
      .current-value {
        flex-shrink: 0;
        text-align: right;
      }

      .current-number {
        font-size: 22px;
        font-weight: 700;
        line-height: 1.1;
        color: var(--m3p-accent-fg, var(--m3p-accent));
      }

      .current-unit {
        font-size: 11px;
        opacity: 0.65;
        color: var(--m3p-secondary-text);
      }

      .values-row {
        display: flex;
        gap: var(--bar-gap, 6px);
        margin-bottom: 2px;
      }

      .bar-value {
        flex: 1;
        min-width: 0;
        text-align: center;
        font-size: 10px;
        color: var(--m3p-text);
        opacity: 0.55;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .bar-value.current {
        font-weight: 700;
        opacity: 1;
        color: var(--m3p-accent-fg, var(--m3p-accent));
      }

      .bars-row {
        position: relative;
        display: flex;
        align-items: flex-end;
        gap: var(--bar-gap, 6px);
        height: var(--bar-max-height, 90px);
        transition: opacity 0.3s ease;
      }

      .bars-row.loading {
        opacity: 0.35;
      }

      .average-line {
        position: absolute;
        left: 0;
        right: 0;
        border-top: 1.5px dashed color-mix(in srgb, var(--primary-text-color) 28%, var(--ha-card-background, var(--card-background-color)));
        pointer-events: none;
      }

      .comparison-row {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .comparison-chip {
        display: flex;
        align-items: center;
        gap: 5px;
        height: 28px;
        padding: 0 10px;
        border-radius: 14px;
        font-size: 12px;
        font-weight: 500;
      }

      .comparison-chip.neutral {
        background: color-mix(in srgb, var(--primary-text-color) 8%, var(--ha-card-background, var(--card-background-color)));
        color: var(--m3p-secondary-text);
      }

      .comparison-chip ha-icon {
        --mdc-icon-size: 14px;
      }

      .bar-col {
        flex: 1;
        min-width: 0;
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        align-items: stretch;
        position: relative;
      }

      .bar-col:focus-visible {
        outline: 2px solid var(--primary-color);
        outline-offset: 2px;
        border-radius: 4px;
      }

      .bar {
        border-radius: var(--bar-radius, 9px);
        min-height: 8px;
        transition:
          height 0.35s cubic-bezier(0.2, 0, 0, 1) var(--grow-delay, 0ms),
          border-radius 0.2s cubic-bezier(0.2, 0, 0, 1),
          filter 0.2s cubic-bezier(0.2, 0, 0, 1);
        cursor: pointer;
      }

      .bar.active {
        border-radius: calc(var(--bar-radius, 9px) - 3px);
        filter: brightness(1.3);
      }

      .card-inner.no-animations .bar,
      .card-inner.no-animations .bar-outline {
        transition: none;
      }

      .bar-outline {
        box-sizing: border-box;
        /* Deliberately smaller than the solid bar's radius: at the short
           heights forecast-only bars are usually rendered at, a 9px radius
           rounds the whole shape into a circle/pill, which reads as a dot
           rather than a bar and hides how tall (i.e. how much forecast) it
           actually is. */
        border-radius: 4px;
        border: 1.5px dashed transparent;
        min-height: 0;
        background: transparent;
        cursor: pointer;
        transition: height 0.35s cubic-bezier(0.2, 0, 0, 1) var(--grow-delay, 0ms);
      }

      .value-bubble {
        position: absolute;
        bottom: calc(100% + 6px);
        left: 50%;
        transform: translateX(-50%);
        white-space: nowrap;
        padding: 3px 8px;
        border-radius: 8px;
        font-size: 11px;
        font-weight: 700;
        color: var(--m3p-text);
        background: color-mix(in srgb, var(--primary-text-color) 12%, var(--card-background-color, #1c1c1c) 88%);
        pointer-events: none;
        z-index: 1;
      }

      .labels-row {
        display: flex;
        gap: var(--bar-gap, 6px);
      }

      .day-label {
        flex: 1;
        text-align: center;
        font-size: 10px;
        opacity: 0.6;
        color: var(--m3p-secondary-text);
        white-space: nowrap;
        /* Dense layouts (e.g. a full 24h solar axis) give each column only a
           few px — too narrow even for a 2-digit hour. Labels only show every
           few hours though, so neighboring columns are usually empty; let
           the text overflow into them instead of ellipsizing to "1…". */
        overflow: visible;
        text-overflow: clip;
      }

      .day-label.current {
        font-weight: 700;
        opacity: 1;
        color: var(--m3p-text);
      }

      .legend {
        display: flex;
        justify-content: center;
        gap: 16px;
        margin-top: 10px;
      }

      .legend-chip {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: var(--m3p-secondary-text);
      }

      .legend-swatch {
        width: 10px;
        height: 10px;
        border-radius: 3px;
        flex-shrink: 0;
      }

      .legend-swatch.solid {
        background: var(--m3p-accent);
      }

      .legend-swatch.outline {
        box-sizing: border-box;
        background: transparent;
        border: 1.5px dashed transparent;
      }

      /* Safari gained color-mix() in 16.2, and an iPod touch 7 or an iPad Air 2
         stops at iOS 15. A plain declaration before each mix cannot serve as the
         fallback: every one of them contains var(), which defers the check until
         after substitution, where failure yields unset rather than the previous
         declaration — the tint did not fade, the fill disappeared entirely. This
         block is the one those browsers alone can see; the tint is what it gives
         up. Backticks are not allowed in here: this is a css template literal. */
      @supports not (color: color-mix(in srgb, red 50%, blue)) {
        .comparison-chip.neutral {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .value-bubble {
          background: var(--card-background-color, #1c1c1c);
        }
      }
      `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-energy-card": M3EnergyCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-energy-card",
  name: "M3 Energy Card",
  description:
    "Ein Material-3-Balkendiagramm für Energiewerte pro Tag/Stunde, oder als Solar-Tagesverlauf mit Prognose.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
