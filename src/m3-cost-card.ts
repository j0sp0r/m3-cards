import { LitElement, html, css, unsafeCSS, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import type {
  HomeAssistant,
  M3CostCardConfig,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  CostPeriod,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_COST_RADIUS,
  DEFAULT_COST_ICON,
  DEFAULT_COST_ACCENT,
  DEFAULT_COST_CURRENCY,
  COST_MAIN_ICON_SIZE,
  COST_MAIN_ICON_RADIUS,
  COST_CHIP_RADIUS,
  COST_BETTER_COLOR,
  COST_WORSE_COLOR,
  COST_BAR_HEIGHT,
  COST_BAR_GAP,
  COST_BAR_RADIUS,
  COST_BAR_MIN_HEIGHT,
  COST_TARIFF_ROW_HEIGHT,
  COST_TARIFF_ROW_RADIUS,
  COST_TARIFF_ICON_SIZE,
  COST_TARIFF_ICON_RADIUS,
  COST_STEPPER_WIDTH,
  COST_STEPPER_HEIGHT,
  COST_STEPPER_RADIUS_OUTER,
  COST_STEPPER_RADIUS_INNER,
  COST_REFRESH_MS,
  resolveCornerRadius,
} from "./const";
import { resolveThemeColor, buildCssVars, resolveCommonColors, tintOn, tintInk, fillColor , foregroundVars, tintBackground } from "./shared/color-config";
import { glassCardStyles, glassCardClass } from "./shared/glass-card";
import { shouldAnimate, STANDARD_EASING } from "./shared/animation";
import { fireEvent } from "./shared/editor-helpers";
import { fetchDaySeries } from "./shared/ha-statistics";
import {
  resolveCurrentPrice,
  formatCurrency,
  formatCurrencyParts,
  proratedBaseFee,
  getGridCostEntities,
} from "./shared/pricing";
import { activateOnKey } from "./shared/a11y";
import { localize, type TranslationKey } from "./localize";
import { hassChangeMatters } from "./shared/should-update";
import { formatNumber } from "./shared/formatting";
import { TemplatedCard } from "./shared/templated-card";

console.info(
  `%c M3-COST-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #f0a24a; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #f0a24a; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

const EASING = unsafeCSS(STANDARD_EASING);

interface PeriodWindow {
  start: Date;
  end: Date;
  bucketUnit: "day" | "month";
  // true when the window is a fully-elapsed past period (browsed via the nav
  // buttons) rather than the still-running current one — no "future" bars,
  // no forecast, comparison uses the actual total instead of a projection.
  complete: boolean;
}

// `offset` counts periods back from "now" (0 = the current, still-running
// period; 1 = the one before it; ...) — how the nav buttons browse history.
function periodBounds(period: CostPeriod, now: Date, offset: number): PeriodWindow {
  if (period === "day") {
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const start = new Date(todayStart);
    start.setDate(start.getDate() - offset);
    if (offset === 0) return { start, end: now, bucketUnit: "day", complete: false };
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end, bucketUnit: "day", complete: true };
  }
  if (period === "year") {
    const start = new Date(now.getFullYear() - offset, 0, 1);
    if (offset === 0) return { start, end: now, bucketUnit: "month", complete: false };
    const end = new Date(now.getFullYear() - offset + 1, 0, 1);
    return { start, end, bucketUnit: "month", complete: true };
  }
  const start = new Date(now.getFullYear(), now.getMonth() - offset, 1);
  if (offset === 0) return { start, end: now, bucketUnit: "day", complete: false };
  const end = new Date(now.getFullYear(), now.getMonth() - offset + 1, 1);
  return { start, end, bucketUnit: "day", complete: true };
}

function bucketsTotal(period: CostPeriod, viewedDate: Date): number {
  if (period === "day") return 1;
  if (period === "year") return 12;
  return new Date(viewedDate.getFullYear(), viewedDate.getMonth() + 1, 0).getDate();
}

function bucketsElapsed(period: CostPeriod, window: PeriodWindow, now: Date): number {
  if (window.complete) return bucketsTotal(period, window.start);
  if (period === "day") return 1;
  if (period === "year") return now.getMonth() + 1;
  return now.getDate();
}

function bucketize(dayMap: Map<string, number>, window: PeriodWindow): number[] {
  const total = window.bucketUnit === "month" ? 12 : bucketsTotal("month", window.start);
  const values = new Array(total).fill(0);
  if (window.bucketUnit === "day") {
    for (const [key, val] of dayMap) {
      const d = new Date(key);
      if (d.getMonth() !== window.start.getMonth() || d.getFullYear() !== window.start.getFullYear()) continue;
      values[d.getDate() - 1] += val;
    }
  } else {
    for (const [key, val] of dayMap) {
      const d = new Date(key);
      if (d.getFullYear() !== window.start.getFullYear()) continue;
      values[d.getMonth()] += val;
    }
  }
  return values;
}

@customElement("m3-cost-card")
export class M3CostCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3CostCardConfig;
  @state() private _bucketValues: number[] = [];
  @state() private _totalSoFar = 0;
  @state() private _previousPeriodTotal?: number;
  @state() private _noPriceConfigured = false;
  @state() private _activeBarIndex?: number;
  @state() private _periodOffset = 0;
  @state() private _viewedWindow?: PeriodWindow;

  private _refreshTimer?: number;
  private _lastFetchKey?: string;
  private _fetchInFlight = false;

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-cost-card-editor");
    return document.createElement("m3-cost-card-editor") as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(): M3CostCardConfig {
    return {
      type: "custom:m3-cost-card",
      price_source: "energy_dashboard",
      glass_background: true,
    };
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return hassChangeMatters(changed, this.hass, [this._config?.entity, this._config?.price_entity]);
  }

  public setConfig(config: M3CostCardConfig): void {
    this._config = {
      glass_background: true,
      animation: "auto",
      price_source: "energy_dashboard",
      period: "month",
      currency: DEFAULT_COST_CURRENCY,
      show_projection: true,
      show_comparison: true,
      ...config,
    };
  }

  public getCardSize(): number {
    return 4;
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: "full", rows: "auto", min_rows: 4 };
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this._refreshTimer = window.setInterval(() => {
      this._lastFetchKey = undefined;
      this._maybeFetch();
    }, COST_REFRESH_MS);
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._refreshTimer !== undefined) {
      window.clearInterval(this._refreshTimer);
      this._refreshTimer = undefined;
    }
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    this._maybeFetch();
  }

  private _maybeFetch(): void {
    if (!this.hass || !this._config) return;
    const key = JSON.stringify({
      source: this._config.price_source,
      entity: this._config.entity,
      priceEntity: this._config.price_entity,
      price: this._config.price,
      period: this._config.period,
      offset: this._periodOffset,
    });
    if (key === this._lastFetchKey) return;
    this._lastFetchKey = key;
    this._fetchCostData();
  }

  private async _fetchCostData(): Promise<void> {
    if (!this.hass || !this._config || this._fetchInFlight) return;
    this._fetchInFlight = true;
    try {
      const period = this._config.period ?? "month";
      const now = new Date();
      const window = periodBounds(period, now, this._periodOffset);
      const prevWindow = periodBounds(period, now, this._periodOffset + 1);
      this._viewedWindow = window;

      let currentDayMap: Map<string, number>;
      let prevDayMap: Map<string, number>;

      if (this._config.price_source === "input_number" || this._config.price_source === "fixed") {
        const price = resolveCurrentPrice(this.hass, this._config);
        if (price === undefined || !this._config.entity) {
          this._noPriceConfigured = true;
          return;
        }
        this._noPriceConfigured = false;
        // "state" default matches the day/hour consumption bars elsewhere in
        // the project: many real-world daily-resetting counters only ever
        // populate the "state" statistic (last reading of the day), not
        // "change" — see fetchEnergyDays / m3-energy-card. "change" is only
        // correct for true lifetime (never-resetting) counters.
        const statType = this._config.statistic_type ?? "state";
        // "custom" mode (any non-energy quantity, e.g. water in L priced per
        // m³) skips the recorder's energy-unit-class normalization — it only
        // converts within the "energy" class anyway, a no-op for anything
        // else — and instead applies the user's own price_quantity_factor.
        const isCustom = this._config.price_unit === "custom";
        const quantityFactor = isCustom ? (this._config.price_quantity_factor ?? 1) : 1;
        const [kwhMap, prevKwhMap] = await Promise.all([
          fetchDaySeries(this.hass, [this._config.entity], window.start, window.end, statType, !isCustom),
          fetchDaySeries(this.hass, [this._config.entity], prevWindow.start, prevWindow.end, statType, !isCustom),
        ]);
        currentDayMap = new Map(Array.from(kwhMap, ([k, v]) => [k, v * quantityFactor * price]));
        prevDayMap = new Map(Array.from(prevKwhMap, ([k, v]) => [k, v * quantityFactor * price]));
      } else {
        const costIds = await getGridCostEntities(this.hass);
        if (!costIds) {
          this._noPriceConfigured = true;
          return;
        }
        this._noPriceConfigured = false;
        [currentDayMap, prevDayMap] = await Promise.all([
          fetchDaySeries(this.hass, costIds, window.start, window.end, "change", false),
          fetchDaySeries(this.hass, costIds, prevWindow.start, prevWindow.end, "change", false),
        ]);
      }

      this._bucketValues = bucketize(currentDayMap, window);
      let total = Array.from(currentDayMap.values()).reduce((a, b) => a + b, 0);
      if (period === "month" && this._config.base_fee) {
        total += proratedBaseFee(this._config.base_fee, bucketsElapsed(period, window, now));
      }
      this._totalSoFar = total;
      this._previousPeriodTotal = Array.from(prevDayMap.values()).reduce((a, b) => a + b, 0);
    } catch (e) {
      console.error("m3-cost-card: failed to load cost data", e);
    } finally {
      this._fetchInFlight = false;
    }
  }

  private _handlePrevPeriod(): void {
    this._activeBarIndex = undefined;
    this._periodOffset += 1;
  }

  private _handleNextPeriod(): void {
    if (this._periodOffset <= 0) return;
    this._activeBarIndex = undefined;
    this._periodOffset -= 1;
  }

  private _openPriceMoreInfo(): void {
    if (!this._config?.price_entity) return;
    fireEvent(this, "hass-more-info", { entityId: this._config.price_entity });
  }

  private _handleBarTap(index: number): void {
    this._activeBarIndex = this._activeBarIndex === index ? undefined : index;
  }

  protected render() {
    if (!this._config || !this.hass) return nothing;

    const period = this._config.period ?? "month";
    const currency = this._config.currency || DEFAULT_COST_CURRENCY;
    const accentColor = this._config.accent_color
      ? resolveThemeColor(this._config.accent_color)
      : DEFAULT_COST_ACCENT;
    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(
      this._config,
    );
    const radius = resolveCornerRadius(this._config.radius ?? DEFAULT_COST_RADIUS, this._config.corners);
    const icon = this._config.icon || DEFAULT_COST_ICON;

    const cssVars = buildCssVars({
      "m3p-text": textColorCss,
      "m3p-secondary-text": secondaryTextColorCss,
      "cost-accent": accentColor,
      // Fills keep the accent; these twins carry it where it is text.
      ...foregroundVars(this, {
        "cost-accent": accentColor,
      }),
    });

    if (this._noPriceConfigured) {
      return html`
        <ha-card style=${`${cssVars} border-radius: ${radius};`}>
          <div
            class="card-inner ${glassCardClass(this._config.glass_background)}"
            style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
          >
            <div class="main-row">
              <div class="main-icon" style=${`background: ${tintOn(this, accentColor, this._config.accent_opacity, 18)}; color: ${tintInk(this, accentColor, this._config.accent_opacity, 18, 3)};`}>
                <ha-icon icon=${icon}></ha-icon>
              </div>
              <div class="main-text">
                <div class="main-label">${this._t("cost_default_name")}</div>
              </div>
            </div>
            <div class="empty-state">
              ${this._t("cost_no_price_configured")}
              ${this._config.price_source === "energy_dashboard"
                ? html`<a href="/config/energy">${this._t("top_consumers_open_energy_settings")}</a>`
                : nothing}
            </div>
          </div>
        </ha-card>
      `;
    }

    const now = new Date();
    const window = this._viewedWindow ?? periodBounds(period, now, this._periodOffset);
    const elapsed = bucketsElapsed(period, window, now);
    const total = bucketsTotal(period, window.start);
    const isCredit = this._totalSoFar < 0;
    const displayAmount = Math.abs(this._totalSoFar);
    const { number: amountNumber, symbol: currencySymbol } = formatCurrencyParts(
      displayAmount,
      currency,
      this._language,
    );

    const viewedYearSuffix =
      window.start.getFullYear() !== now.getFullYear() ? ` ${window.start.getFullYear()}` : "";
    const periodLabel =
      period === "day"
        ? window.complete
          ? this._t("cost_subtitle_day_date").replace(
              "{date}",
              new Intl.DateTimeFormat(this._language, { day: "numeric", month: "long" }).format(window.start),
            )
          : this._t("cost_subtitle_day")
        : period === "year"
          ? this._t("cost_subtitle_year").replace("{year}", String(window.start.getFullYear()))
          : this._t("cost_subtitle_month").replace(
              "{month}",
              new Intl.DateTimeFormat(this._language, { month: "long" }).format(window.start) + viewedYearSuffix,
            );
    const label = isCredit ? this._t("cost_credit_label") : periodLabel;

    const showProjection = this._config.show_projection !== false && !window.complete;
    const showFirstBucketHint = showProjection && elapsed <= 1;
    const projection =
      showProjection && elapsed > 1 ? (this._totalSoFar / elapsed) * total : undefined;

    const showComparison = this._config.show_comparison !== false;
    const comparison =
      showComparison && projection !== undefined && this._previousPeriodTotal
        ? (() => {
            const percent = ((projection - this._previousPeriodTotal!) / Math.abs(this._previousPeriodTotal!)) * 100;
            const isMore = percent > 0;
            return {
              percent: Math.round(Math.abs(percent)),
              isMore,
              color: isMore ? COST_WORSE_COLOR : COST_BETTER_COLOR,
            };
          })()
        : undefined;

    const budgetChip = (() => {
      if (!this._config?.budget) return undefined;
      const compareValue = projection ?? this._totalSoFar;
      const percent = Math.round((compareValue / this._config.budget) * 100);
      return { percent, overBudget: percent > 100 };
    })();

    const avgPerBucket = elapsed > 0 ? this._totalSoFar / elapsed : 0;
    // The average has to be in the scale, because the future bars are drawn
    // with it. Taking the maximum over the recorded days alone left whatever is
    // drawn from the average unbounded — and while the period is being switched
    // the two disagree for a moment: the new month's days are already empty, so
    // the maximum falls to the floor below, while the average still belongs to
    // the old one — one month's total divided by the other month's elapsed days.
    // Nothing bounded the result, so the dashed bars shot up over the amount and
    // the comparison chip for a frame before the next render put them right.
    const maxBucket = Math.max(...this._bucketValues, avgPerBucket, 0.01);
    const showBars = period !== "day";

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(this._config.glass_background)} ${shouldAnimate(this._config.animation) ? "" : "no-animations"}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          <div class="main-row">
            <div
              class="main-icon"
              style=${`background: ${tintOn(this, isCredit ? COST_BETTER_COLOR : accentColor, this._config.accent_opacity, 18)}; color: ${tintInk(this, isCredit ? COST_BETTER_COLOR : accentColor, this._config.accent_opacity, 18, 3)};`}
            >
              <ha-icon icon=${icon}></ha-icon>
            </div>
            <div class="main-text">
              <div class="main-label">${label}</div>
              <div class="main-value" style=${isCredit ? `color: ${COST_BETTER_COLOR};` : nothing}>
                ${amountNumber}<span class="main-unit">${currencySymbol}</span>
              </div>
            </div>
          </div>

          ${showFirstBucketHint || comparison || budgetChip
            ? html`
                <div class="chip-row">
                  ${showFirstBucketHint
                    ? html`<div class="chip neutral">${this._t("cost_forecast_hint")}</div>`
                    : comparison
                      ? html`
                          <div
                            class="chip"
                            style=${`color: ${tintInk(this, comparison.color, undefined, 16)}; background: ${tintOn(this, comparison.color, undefined, 16)};`}
                          >
                            <ha-icon icon=${comparison.isMore ? "mdi:arrow-up" : "mdi:arrow-down"}></ha-icon>
                            <span
                              >${this._t(
                                comparison.isMore ? "cost_chip_more" : "cost_chip_less",
                              ).replace("{value}", String(comparison.percent))}</span
                            >
                          </div>
                        `
                      : nothing}
                  ${budgetChip
                    ? html`
                        <div
                          class="chip"
                          style=${`color: ${budgetChip.overBudget ? COST_WORSE_COLOR : COST_BETTER_COLOR}; background: ${tintBackground(budgetChip.overBudget ? COST_WORSE_COLOR : COST_BETTER_COLOR, undefined, 16)};`}
                        >
                          <span>${this._t("cost_budget_percent").replace("{value}", String(budgetChip.percent))}</span>
                        </div>
                      `
                    : nothing}
                </div>
              `
            : nothing}

          ${showBars
            ? html`
                <div class="bar-row">
                  ${repeat(
                    this._bucketValues,
                    (_v, i) => i,
                    (v, i) => this._renderBar(v, i, elapsed, maxBucket, avgPerBucket, accentColor),
                  )}
                </div>
                <div class="bar-footer">
                  <span>${this._bucketFooterStart(period, window)}</span>
                  <span
                    >${this._t("cost_avg_per_day").replace(
                      "{value}",
                      formatCurrency(avgPerBucket, currency, this._language),
                    )}</span
                  >
                  <span>${this._bucketFooterEnd(period, window)}</span>
                </div>
              `
            : nothing}

          ${this._renderNavRow(accentColor)}
          ${this._config.price_source !== "energy_dashboard"
            ? this._renderTariffRow(accentColor, currency)
            : nothing}
        </div>
      </ha-card>
    `;
  }

  private _renderNavRow(accentColor: string) {
    const atPresent = this._periodOffset <= 0;
    return html`
      <div class="nav-row">
        <button class="nav-btn prev" @click=${() => this._handlePrevPeriod()}>
          <ha-icon icon="mdi:chevron-left"></ha-icon>
        </button>
        <div class="nav-info">
          <div
            class="nav-icon"
            style=${`background: ${tintOn(this, accentColor, this._config?.accent_opacity, 20)}; color: ${tintInk(this, accentColor, this._config?.accent_opacity, 20)};`}
          >
            <ha-icon icon="mdi:calendar-month-outline"></ha-icon>
          </div>
          <div class="nav-text">
            <div class="nav-label">${this._t("cost_nav_period_label")}</div>
            <div class="nav-value">${this._navPeriodText()}</div>
          </div>
        </div>
        <button class="nav-btn next" ?disabled=${atPresent} @click=${() => this._handleNextPeriod()}>
          <ha-icon icon="mdi:chevron-right"></ha-icon>
        </button>
      </div>
    `;
  }

  private _navPeriodText(): string {
    const now = new Date();
    const window = this._viewedWindow ?? periodBounds(this._config?.period ?? "month", now, this._periodOffset);
    const period = this._config?.period ?? "month";
    if (period === "day") {
      return new Intl.DateTimeFormat(this._language, { day: "numeric", month: "long", year: "numeric" }).format(
        window.start,
      );
    }
    if (period === "year") {
      return String(window.start.getFullYear());
    }
    return new Intl.DateTimeFormat(this._language, { month: "long", year: "numeric" }).format(window.start);
  }

  private _bucketFooterStart(period: CostPeriod, window: PeriodWindow): string {
    if (period === "year") return String(window.start.getFullYear());
    return new Intl.DateTimeFormat(this._language, { day: "numeric", month: "short" }).format(window.start);
  }

  private _bucketFooterEnd(period: CostPeriod, window: PeriodWindow): string {
    if (period === "year") return String(window.start.getFullYear());
    const lastDay = new Date(window.start.getFullYear(), window.start.getMonth() + 1, 0);
    return new Intl.DateTimeFormat(this._language, { day: "numeric", month: "short" }).format(lastDay);
  }

  private _renderBar(
    value: number,
    index: number,
    elapsed: number,
    maxBucket: number,
    avgPerBucket: number,
    accentColor: string,
  ) {
    const isCurrent = index === elapsed - 1;
    const isFuture = index >= elapsed;
    const barValue = isFuture ? avgPerBucket : value;
    // Clamped as well as scaled. The scale above already covers everything that
    // is drawn, so this changes nothing in normal use — it is here so that no
    // future arithmetic slip can put a bar outside the chart again. The row
    // cannot simply clip, because the value bubble deliberately sits above it.
    const heightPx = Math.max(
      COST_BAR_MIN_HEIGHT,
      Math.min(1, barValue / maxBucket) * COST_BAR_HEIGHT,
    );
    const active = this._activeBarIndex === index;
    const currency = this._config?.currency || DEFAULT_COST_CURRENCY;
    const { number, symbol } = formatCurrencyParts(barValue, currency, this._language);

    return html`
      <div class="bar-col">
        ${active
          ? html`<div class="value-bubble">${number}${symbol}</div>`
          : nothing}
        <div
          class="bar ${isFuture ? "future" : ""} ${isCurrent ? "current" : ""}"
          style=${`height: ${heightPx.toFixed(1)}px; ${
            isFuture
              ? `border-color: ${tintOn(this, accentColor, this._config?.accent_opacity, 55)};`
              : `background: ${isCurrent ? fillColor(this, accentColor) : tintOn(this, accentColor, this._config?.accent_opacity, 30)};`
          }`}
          role="button"
          tabindex="0"
          aria-label=${`${number}${symbol}`}
          @click=${() => this._handleBarTap(index)}
          @keydown=${activateOnKey(() => this._handleBarTap(index))}
        ></div>
      </div>
    `;
  }

  private _renderTariffRow(accentColor: string, currency: string) {
    if (!this.hass || !this._config) return nothing;
    const isInputNumber = this._config.price_source === "input_number";
    let displayValue = "–";
    let unit = "";
    if (isInputNumber && this._config.price_entity) {
      const state = this.hass.states[this._config.price_entity];
      if (state) {
        const raw = parseFloat(state.state);
        if (!isNaN(raw)) {
          displayValue = formatNumber(this._language, raw, { maximumFractionDigits: 3 });
          unit = state.attributes.unit_of_measurement ?? "";
        }
      }
    } else if (this._config.price_source === "fixed" && typeof this._config.price === "number") {
      displayValue = formatNumber(this._language, this._config.price, {
        maximumFractionDigits: 3,
      });
      unit =
        this._config.price_unit === "ct_per_kwh"
          ? `ct/kWh`
          : this._config.price_unit === "custom"
            ? this._config.price_unit_label || `${currency}/?`
            : `${currency}/kWh`;
    }

    return html`
      <div
        class="tariff-info ${isInputNumber ? "tappable" : ""}"
        role=${isInputNumber ? "button" : nothing}
        tabindex=${isInputNumber ? "0" : nothing}
        aria-label=${isInputNumber ? this._t("cost_tariff_label") : nothing}
        @click=${isInputNumber ? () => this._openPriceMoreInfo() : nothing}
        @keydown=${isInputNumber ? activateOnKey(() => this._openPriceMoreInfo()) : nothing}
      >
        <div
          class="tariff-icon"
          style=${`background: ${tintOn(this, accentColor, this._config.accent_opacity, 20)}; color: ${tintInk(this, accentColor, this._config.accent_opacity, 20)};`}
        >
          <ha-icon icon="mdi:tag-outline"></ha-icon>
        </div>
        <div class="tariff-text">
          <div class="tariff-label">${this._t("cost_tariff_label")}</div>
          <div class="tariff-value">${displayValue} ${unit}</div>
        </div>
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

      .main-icon {
        flex-shrink: 0;
        width: ${COST_MAIN_ICON_SIZE}px;
        height: ${COST_MAIN_ICON_SIZE}px;
        border-radius: ${COST_MAIN_ICON_RADIUS}px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .main-icon ha-icon {
        --mdc-icon-size: 26px;
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
        color: var(--m3p-text);
        font-variant-numeric: tabular-nums;
      }

      .main-unit {
        font-size: 16px;
        font-weight: 500;
        opacity: 0.7;
        margin-left: 2px;
      }

      .chip-row {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .chip {
        display: flex;
        align-items: center;
        gap: 4px;
        height: 30px;
        padding: 0 12px;
        border-radius: ${COST_CHIP_RADIUS}px;
        font-size: 13px;
        font-weight: 700;
      }

      .chip ha-icon {
        --mdc-icon-size: 15px;
      }

      .chip.neutral {
        background: color-mix(in srgb, var(--primary-text-color) 8%, var(--ha-card-background, var(--card-background-color)));
        color: var(--m3p-secondary-text);
        font-weight: 500;
      }

      .bar-row {
        display: flex;
        align-items: flex-end;
        gap: ${COST_BAR_GAP}px;
        height: ${COST_BAR_HEIGHT}px;
      }

      .bar-col {
        position: relative;
        flex: 1;
        min-width: 0;
        height: 100%;
        display: flex;
        align-items: flex-end;
      }

      .bar {
        width: 100%;
        border-radius: ${COST_BAR_RADIUS}px;
        cursor: pointer;
        transition: height 300ms ${EASING};
      }

      .bar:focus-visible {
        outline: 2px solid var(--primary-color);
        outline-offset: 2px;
      }

      .card-inner.no-animations .bar,
      .card-inner.no-animations .nav-btn {
        transition: none;
      }

      .bar.future {
        background: transparent;
        border: 1.5px dashed;
        box-sizing: border-box;
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
        background: var(--primary-text-color);
        color: var(--primary-background-color, #1c1c1c);
        z-index: 1;
      }

      .bar-footer {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        opacity: 0.4;
        color: var(--m3p-secondary-text);
      }

      .nav-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .nav-btn {
        width: ${COST_STEPPER_WIDTH}px;
        height: ${COST_STEPPER_HEIGHT}px;
        flex-shrink: 0;
        border: none;
        color: var(--m3p-text);
        background: color-mix(in srgb, var(--primary-text-color) 8%, var(--ha-card-background, var(--card-background-color)));
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
      }

      .nav-btn ha-icon {
        --mdc-icon-size: 20px;
      }

      .nav-btn:active:not(:disabled) {
        transform: scale(0.88);
      }

      .nav-btn:disabled {
        opacity: 0.3;
        cursor: default;
      }

      .nav-btn.prev {
        border-radius: ${COST_STEPPER_RADIUS_OUTER}px ${COST_STEPPER_RADIUS_INNER}px
          ${COST_STEPPER_RADIUS_INNER}px ${COST_STEPPER_RADIUS_OUTER}px;
      }

      .nav-btn.next {
        border-radius: ${COST_STEPPER_RADIUS_INNER}px ${COST_STEPPER_RADIUS_OUTER}px
          ${COST_STEPPER_RADIUS_OUTER}px ${COST_STEPPER_RADIUS_INNER}px;
      }

      .nav-info {
        flex: 1;
        min-width: 0;
        height: ${COST_TARIFF_ROW_HEIGHT}px;
        border-radius: ${COST_TARIFF_ROW_RADIUS}px;
        background: color-mix(in srgb, var(--primary-text-color) 6%, var(--ha-card-background, var(--card-background-color)));
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 0 12px;
        box-sizing: border-box;
      }

      .nav-icon {
        flex-shrink: 0;
        width: ${COST_TARIFF_ICON_SIZE}px;
        height: ${COST_TARIFF_ICON_SIZE}px;
        border-radius: ${COST_TARIFF_ICON_RADIUS}px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .nav-icon ha-icon {
        --mdc-icon-size: 16px;
      }

      .nav-text {
        min-width: 0;
        text-align: center;
      }

      .nav-label {
        font-size: 10px;
        opacity: 0.55;
        color: var(--m3p-secondary-text);
      }

      .nav-value {
        font-size: 14px;
        font-weight: 700;
        color: var(--m3p-text);
      }

      .tariff-info {
        height: ${COST_TARIFF_ROW_HEIGHT}px;
        border-radius: ${COST_TARIFF_ROW_RADIUS}px;
        background: color-mix(in srgb, var(--primary-text-color) 6%, var(--ha-card-background, var(--card-background-color)));
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 12px;
        box-sizing: border-box;
      }

      .tariff-info.tappable {
        cursor: pointer;
      }

      .tariff-info.tappable:focus-visible {
        outline: 2px solid var(--primary-color);
        outline-offset: 2px;
      }

      .tariff-icon {
        flex-shrink: 0;
        width: ${COST_TARIFF_ICON_SIZE}px;
        height: ${COST_TARIFF_ICON_SIZE}px;
        border-radius: ${COST_TARIFF_ICON_RADIUS}px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .tariff-icon ha-icon {
        --mdc-icon-size: 16px;
      }

      .tariff-text {
        min-width: 0;
      }

      .tariff-label {
        font-size: 10px;
        opacity: 0.55;
        color: var(--m3p-secondary-text);
      }

      .tariff-value {
        font-size: 14px;
        font-weight: 700;
        color: var(--m3p-text);
      }

      .empty-state {
        text-align: center;
        font-size: 13px;
        opacity: 0.6;
        padding: 8px 0;
        color: var(--m3p-secondary-text);
      }

      .empty-state a {
        display: block;
        margin-top: 6px;
        color: var(--cost-accent-fg, var(--cost-accent));
      }

      /* Safari gained color-mix() in 16.2, and an iPod touch 7 or an iPad Air 2
         stops at iOS 15. A plain declaration before each mix cannot serve as the
         fallback: every one of them contains var(), which defers the check until
         after substitution, where failure yields unset rather than the previous
         declaration — the tint did not fade, the fill disappeared entirely. This
         block is the one those browsers alone can see; the tint is what it gives
         up. Backticks are not allowed in here: this is a css template literal. */
      @supports not (color: color-mix(in srgb, red 50%, blue)) {
        .chip.neutral {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .nav-btn {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .nav-info {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .tariff-info {
          background: var(--ha-card-background, var(--card-background-color));
        }
      }
      `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-cost-card": M3CostCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-cost-card",
  name: "M3 Cost Card",
  description:
    "Eine Material-3-Kostenauswertung mit Prognose, Vergleichs-Chips und Tagesbalken.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
