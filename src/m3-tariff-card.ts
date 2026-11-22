import { LitElement, html, css, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  M3TariffCardConfig,
  TariffEntryConfig,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_TARIFF_BASE,
  DEFAULT_TARIFF_HISTORY_DAYS,
  DEFAULT_TARIFF_ICON,
  DEFAULT_TARIFF_RADIUS,
  TARIFF_REFRESH_MS,
  resolveCornerRadius,
} from "./const";
import { buildCssVars, foregroundColor, foregroundOn, resolveCommonColors, resolveThemeColor, tintOn } from "./shared/color-config";
import { glassCardClass, glassCardStyles } from "./shared/glass-card";
import { isReducedMotion, shouldAnimate } from "./shared/animation";
import { localize, type TranslationKey } from "./localize";
import { TemplatedCard } from "./shared/templated-card";
import { openEntityDetail } from "./shared/entity-detail";
import { formatNumber } from "./shared/formatting";
import { formatCurrencyParts } from "./shared/pricing";
import { cachedStatsCall, fetchDaySeries, localDayKey } from "./shared/ha-statistics";
import { activeFromSchedule, savingsPercent, sharesOf, tariffFromState, tariffTones } from "./shared/tariff";

console.info(
  `%c M3-TARIFF-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #85b7eb; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #85b7eb; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

/** One tariff on one day: kWh and cost, undefined where not known. */
interface DayCell {
  kwh?: number;
  cost?: number;
}

interface Loaded {
  /** day key → per-tariff cells. */
  days: Map<string, DayCell[]>;
}

const DAY_MS = 86_400_000;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function periodStart(period: "day" | "week" | "month", now: Date): Date {
  const d = startOfDay(now);
  if (period === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (period === "month") d.setDate(1);
  return d;
}

/**
 * Electricity use and cost split over two or more tariffs (#56: the French
 * Heures Pleines / Heures Creuses, but any number). The active tariff comes
 * from an entity or a schedule; consumption from each tariff's meter in the
 * long-term statistics; cost from a cost entity where one is given, else
 * kWh × price, with a price entity's daily mean.
 */
@customElement("m3-tariff-card")
export class M3TariffCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3TariffCardConfig;
  @state() private _data?: Loaded;
  @state() private _tip?: number;
  @state() private _now = Date.now();
  private _fetchKey?: string;
  private _timer?: number;

  public setConfig(config: M3TariffCardConfig): void {
    if (!config || !Array.isArray(config.tariffs) || config.tariffs.length < 1) {
      throw new Error("tariffs: at least one tariff with an energy meter is required");
    }
    this._config = config;
    this._fetchKey = undefined;
  }

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-tariff-card-editor");
    return document.createElement("m3-tariff-card-editor") as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(): M3TariffCardConfig {
    return {
      type: "custom:m3-tariff-card",
      tariffs: [
        { name: "Peak", short: "HP", energy: "", price: 0.25 },
        { name: "Off-peak", short: "HC", energy: "", price: 0.18 },
      ],
      glass_background: true,
    };
  }

  public getCardSize(): number {
    return 6;
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: 12, rows: "auto", min_columns: 6 };
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this._timer = window.setInterval(() => {
      this._now = Date.now();
      this._fetchKey = undefined;
    }, TARIFF_REFRESH_MS);
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._timer) window.clearInterval(this._timer);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private get _tariffs(): TariffEntryConfig[] {
    return this._config?.tariffs ?? [];
  }

  private get _currency(): string {
    return this._config?.currency || ((this.hass?.config as { currency?: string } | undefined)?.currency ?? "EUR");
  }

  // ---- data ----------------------------------------------------------------

  protected shouldUpdate(changed: PropertyValues): boolean {
    if (!changed.has("hass") || changed.size > 1) return true;
    const prev = changed.get("hass") as HomeAssistant | undefined;
    const hass = this.hass;
    if (!prev || !hass) return true;
    if (prev.locale !== hass.locale || prev.themes !== hass.themes || prev.language !== hass.language) return true;
    const ids = [
      this._config?.active_tariff,
      this._config?.active_until,
      ...this._tariffs.flatMap((t) => [t.energy, typeof t.price === "string" ? t.price : undefined, t.cost]),
    ];
    return ids.some((id) => id && prev.states[id] !== hass.states[id]);
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    this._maybeFetch();
  }

  /**
   * The statistics change once an hour at most; they are fetched when the
   * config or the day changes and on the refresh timer, never per state tick.
   */
  private _maybeFetch(): void {
    if (!this.hass || !this._config) return;
    const key = JSON.stringify([this._config.tariffs, this._config.period, this._config.history_days, localDayKey(new Date(this._now)), this._now]);
    if (key === this._fetchKey) return;
    this._fetchKey = key;
    void this._fetch();
  }

  private async _fetchMean(entityId: string, start: Date, end: Date): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    try {
      const res = await cachedStatsCall<Record<string, { start: string | number; mean?: number }[]>>(this.hass!, {
        type: "recorder/statistics_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        statistic_ids: [entityId],
        period: "day",
        types: ["mean"],
      });
      for (const row of res?.[entityId] ?? []) {
        if (typeof row.mean === "number") out.set(localDayKey(new Date(row.start)), row.mean);
      }
    } catch {
      // No statistics for the price: the current price is used instead.
    }
    return out;
  }

  private async _fetch(): Promise<void> {
    const hass = this.hass;
    const cfg = this._config;
    if (!hass || !cfg) return;
    const now = new Date();
    const historyDays = cfg.history_days ?? DEFAULT_TARIFF_HISTORY_DAYS;
    const histStart = startOfDay(new Date(now.getTime() - (historyDays - 1) * DAY_MS));
    const start = new Date(Math.min(histStart.getTime(), periodStart(cfg.period ?? "day", now).getTime()));
    const perTariff = await Promise.all(
      this._tariffs.map(async (t) => {
        const [energy, cost, price] = await Promise.all([
          t.energy ? fetchDaySeries(hass, [t.energy], start, now, "change", true) : Promise.resolve(new Map<string, number>()),
          t.cost ? fetchDaySeries(hass, [t.cost], start, now, "change", false) : Promise.resolve(undefined),
          typeof t.price === "string" ? this._fetchMean(t.price, start, now) : Promise.resolve(undefined),
        ]);
        return { energy, cost, price };
      }),
    );
    const days = new Map<string, DayCell[]>();
    for (let d = new Date(start); d <= now; d = new Date(d.getTime() + DAY_MS)) {
      const key = localDayKey(d);
      days.set(
        key,
        this._tariffs.map((t, i) => {
          const kwh = perTariff[i].energy.get(key);
          const costStat = perTariff[i].cost?.get(key);
          if (costStat !== undefined) return { kwh, cost: costStat };
          const price = perTariff[i].price?.get(key) ?? this._currentPrice(t);
          return { kwh, cost: kwh !== undefined && price !== undefined ? kwh * price : undefined };
        }),
      );
    }
    this._data = { days };
  }

  private _currentPrice(t: TariffEntryConfig): number | undefined {
    if (typeof t.price === "number") return t.price;
    if (typeof t.price === "string") {
      const v = parseFloat(this.hass?.states[t.price]?.state ?? "");
      return Number.isFinite(v) ? v : undefined;
    }
    return undefined;
  }

  private _available(t: TariffEntryConfig): boolean {
    const st = t.energy ? this.hass?.states[t.energy] : undefined;
    return !!st && st.state !== "unavailable" && st.state !== "unknown";
  }

  // ---- active tariff ---------------------------------------------------------

  private _active(): { index: number; until?: Date } {
    const cfg = this._config!;
    if (cfg.active_tariff) {
      const st = this.hass?.states[cfg.active_tariff];
      const index = tariffFromState(st?.state, this._tariffs);
      const untilSt = cfg.active_until ? this.hass?.states[cfg.active_until] : undefined;
      const untilMs = untilSt ? Date.parse(untilSt.state) : NaN;
      if (Number.isFinite(untilMs)) return { index, until: new Date(untilMs) };
      // The entity decides the tariff; a schedule, if given, still knows when
      // the current window ends.
      const fromSchedule = cfg.schedule?.length ? activeFromSchedule(cfg.schedule, this._tariffs, new Date(this._now)) : undefined;
      return { index, until: fromSchedule && fromSchedule.index === index ? fromSchedule.until : undefined };
    }
    if (cfg.schedule?.length) return activeFromSchedule(cfg.schedule, this._tariffs, new Date(this._now));
    return { index: -1 };
  }

  // ---- formatting ------------------------------------------------------------

  private _money(v: number | undefined): string {
    if (v === undefined || !Number.isFinite(v)) return "–";
    const p = formatCurrencyParts(v, this._currency, this._language);
    return `${p.number} ${p.symbol}`;
  }

  private _kwh(v: number | undefined): string {
    if (v === undefined || !Number.isFinite(v)) return "–";
    return `${formatNumber(this._language, v, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} kWh`;
  }

  private _price(v: number | undefined): string {
    if (v === undefined) return "–";
    const symbol = formatCurrencyParts(1, this._currency, this._language).symbol;
    return `${formatNumber(this._language, v, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ${symbol}${this._t("tariff_per_kwh")}`;
  }

  private _clock(d: Date): string {
    return new Intl.DateTimeFormat(this._language, { hour: "2-digit", minute: "2-digit" }).format(d);
  }

  // ---- render ----------------------------------------------------------------

  private _sumPeriod(): DayCell[] {
    const cfg = this._config!;
    const from = localDayKey(periodStart(cfg.period ?? "day", new Date(this._now)));
    const sums: DayCell[] = this._tariffs.map(() => ({}));
    for (const [key, cells] of this._data?.days ?? []) {
      if (key < from) continue;
      cells.forEach((c, i) => {
        if (c.kwh !== undefined) sums[i].kwh = (sums[i].kwh ?? 0) + c.kwh;
        if (c.cost !== undefined) sums[i].cost = (sums[i].cost ?? 0) + c.cost;
      });
    }
    return sums;
  }

  private _renderHistory(tones: string[], strong: string[]): TemplateResult | typeof nothing {
    const cfg = this._config!;
    if (cfg.show_history === false || !this._data) return nothing;
    const n = cfg.history_days ?? DEFAULT_TARIFF_HISTORY_DAYS;
    const today = new Date(this._now);
    const keys = Array.from({ length: n }, (_, i) => localDayKey(new Date(startOfDay(today).getTime() - (n - 1 - i) * DAY_MS)));
    const totals = keys.map((k) => (this._data!.days.get(k) ?? []).reduce((a, c) => a + (c.kwh ?? 0), 0));
    const max = Math.max(0.0001, ...totals);
    // Dearest on top, cheapest at the bottom; tariffs without a price keep
    // their place in the list after the priced ones.
    const prices = this._tariffs.map((t) => this._currentPrice(t));
    const order = this._tariffs
      .map((_, i) => i)
      .sort((a, b) => (prices[b] ?? -Infinity) - (prices[a] ?? -Infinity) || a - b);
    const weekday = new Intl.DateTimeFormat(this._language, { weekday: "short" });
    return html`
      <div class="hist">
        <div class="hist-title">${this._t("tariff_history").replace("{n}", String(n))}</div>
        <div class="hist-bars" style=${`grid-template-columns: repeat(${n}, minmax(0, 1fr));`}>
          ${keys.map((k, di) => {
            const cells = this._data!.days.get(k) ?? [];
            const isToday = di === n - 1;
            const open = this._tip === di;
            const total = totals[di];
            return html`
              <div class="hist-col ${isToday ? "today" : ""}">
                <button
                  class="hist-bar"
                  style=${`height: ${Math.max(4, (total / max) * 100)}%;`}
                  aria-label=${`${isToday ? this._t("tariff_today_short") : weekday.format(new Date(k + "T12:00"))}: ${this._tariffs
                    .map((t, i) => `${t.short || t.name} ${this._kwh(cells[i]?.kwh)}`)
                    .join(", ")}`}
                  aria-expanded=${open ? "true" : "false"}
                  @click=${() => (this._tip = open ? undefined : di)}
                >
                  ${order.map((i) => {
                    const v = cells[i]?.kwh ?? 0;
                    if (!(v > 0) || !(total > 0)) return nothing;
                    return html`<span class="seg" style=${`flex: ${v} 1 0; background: ${isToday ? strong[i] : tones[i]};`}></span>`;
                  })}
                </button>
                <div class="hist-label">${isToday ? this._t("tariff_today_short") : weekday.format(new Date(k + "T12:00"))}</div>
                ${open
                  ? html`<div class="tip ${di > n / 2 ? "left" : ""}" role="status">
                      ${this._tariffs.map(
                        (t, i) => html`<div class="tip-row">
                          <span class="dot" style=${`background: ${strong[i]};`}></span>
                          <span>${t.short || t.name}</span>
                          <b>${this._kwh(cells[i]?.kwh)}</b>
                          <span class="tip-cost">${this._money(cells[i]?.cost)}</span>
                        </div>`,
                      )}
                    </div>`
                  : nothing}
              </div>
            `;
          })}
        </div>
      </div>
    `;
  }

  protected render() {
    const cfg = this._config;
    const hass = this.hass;
    if (!cfg || !hass) return nothing;
    const tariffs = this._tariffs;
    const base = cfg.accent_color ? resolveThemeColor(cfg.accent_color) : DEFAULT_TARIFF_BASE;
    const prices = tariffs.map((t) => this._currentPrice(t));
    const autoTones = tariffTones(base, prices);
    const strong = tariffs.map((t, i) => (t.color ? resolveThemeColor(t.color) : autoTones[i]));
    const muted = strong.map((c) => `color-mix(in srgb, ${c} 45%, var(--ha-card-background, var(--card-background-color, #1c1c1c)))`);
    const sums = this._sumPeriod();
    const kwhs = sums.map((s, i) => (this._available(tariffs[i]) || s.kwh !== undefined ? s.kwh ?? 0 : 0));
    const shares = sharesOf(kwhs);
    const totalKwh = kwhs.reduce((a, b) => a + b, 0);
    const costs = sums.map((s) => s.cost);
    const totalCost = costs.every((c) => c === undefined) ? undefined : costs.reduce<number>((a, c) => a + (c ?? 0), 0);
    const active = this._active();
    const activeTariff = active.index >= 0 ? tariffs[active.index] : undefined;
    const activePrice = active.index >= 0 ? prices[active.index] : undefined;
    const save = savingsPercent(activePrice, prices);
    const cheapest = prices.every((p) => p === undefined) ? -1 : prices.indexOf(Math.min(...prices.filter((p): p is number => p !== undefined)));
    const animate = shouldAnimate(cfg.animation) && !isReducedMotion();

    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(cfg);
    const iconWell = tintOn(this, base, undefined, 20);
    const activeBg = tintOn(this, activeTariff ? strong[active.index] : base, undefined, 14);
    const cssVars = buildCssVars({
      "tf-text": textColorCss,
      "tf-secondary": secondaryTextColorCss,
      "tf-icon-bg": iconWell,
      "tf-icon-fg": foregroundOn(base, iconWell),
      "tf-hero": foregroundColor(this, base),
      "tf-active-bg": activeBg,
      "tf-active-fg": activeTariff ? foregroundOn(strong[active.index], activeBg, 3) : "var(--secondary-text-color)",
      "tf-pill-bg": tintOn(this, base, undefined, 24),
    });
    const radius = resolveCornerRadius(cfg.radius ?? DEFAULT_TARIFF_RADIUS, cfg.corners);
    const periodLabel = this._t(cfg.period === "week" ? "tariff_week" : cfg.period === "month" ? "tariff_month" : "tariff_today");
    const hero = totalCost !== undefined ? formatCurrencyParts(totalCost, this._currency, this._language) : undefined;
    const activeIcon = activeTariff?.icon || (active.index === cheapest && tariffs.length > 1 ? "mdi:weather-night" : "mdi:white-balance-sunny");

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(cfg.glass_background)} ${animate ? "" : "no-animations"}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          <div class="header">
            <div class="head-icon"><ha-icon icon=${cfg.icon || DEFAULT_TARIFF_ICON}></ha-icon></div>
            <div class="head-text">
              <div class="title">${cfg.title || this._t("tariff_title")}</div>
              <div class="subtitle">${periodLabel} · ${this._kwh(this._data ? totalKwh : undefined)}</div>
            </div>
            <div class="hero" aria-label=${`${this._t("tariff_total")} ${this._money(totalCost)}`}>
              ${hero ? html`${hero.number}<span class="hero-sym">${hero.symbol}</span>` : "–"}
            </div>
          </div>

          ${cfg.active_tariff || cfg.schedule?.length
            ? html`<div class="active" role="button" tabindex="0"
                @click=${() => cfg.active_tariff && openEntityDetail(this, cfg.active_tariff)}
                @keydown=${(e: KeyboardEvent) => (e.key === "Enter" || e.key === " ") && cfg.active_tariff && openEntityDetail(this, cfg.active_tariff)}
              >
                <ha-icon icon=${activeTariff ? activeIcon : "mdi:help-circle-outline"}></ha-icon>
                <div class="active-text">
                  <div class="active-name">
                    ${activeTariff
                      ? this._t("tariff_now").replace("{name}", `${activeTariff.name}${activeTariff.short ? ` (${activeTariff.short})` : ""}`)
                      : this._t("tariff_no_active")}
                  </div>
                  ${activeTariff
                    ? html`<div class="active-sub">
                        ${this._price(activePrice)}${active.until ? html` · ${this._t("tariff_until").replace("{t}", this._clock(active.until))}` : nothing}
                      </div>`
                    : nothing}
                </div>
                ${save !== undefined ? html`<div class="save-pill">−${save} %</div>` : nothing}
              </div>`
            : nothing}

          <div class="split" role="img" aria-label=${tariffs.map((t, i) => `${t.short || t.name} ${shares[i]} %`).join(", ")}>
            ${tariffs.map((_t, i) =>
              kwhs[i] > 0 ? html`<span class="split-seg" style=${`flex: ${kwhs[i]} 1 0; background: ${strong[i]};`}></span>` : nothing,
            )}
            ${totalKwh > 0 ? nothing : html`<span class="split-seg empty"></span>`}
          </div>

          <div class="tiles">
            ${tariffs.map(
              (t, i) => html`<div class="tile" role="button" tabindex="0"
                @click=${() => t.energy && openEntityDetail(this, t.energy)}
                @keydown=${(e: KeyboardEvent) => (e.key === "Enter" || e.key === " ") && t.energy && openEntityDetail(this, t.energy)}
              >
                <div class="tile-name"><span class="dot" style=${`background: ${strong[i]};`}></span>${t.name}${t.short ? ` (${t.short})` : ""}</div>
                <div class="tile-cost">${this._available(t) || sums[i].cost !== undefined ? this._money(sums[i].cost) : "–"}</div>
                <div class="tile-sub">${this._available(t) || sums[i].kwh !== undefined ? html`${this._kwh(sums[i].kwh)} · ${shares[i]} %` : "–"}</div>
              </div>`,
            )}
          </div>

          ${this._renderHistory(muted, strong)}
        </div>
      </ha-card>
    `;
  }

  static styles = [
    glassCardStyles,
    css`
      .card-inner {
        gap: var(--m3-card-gap, 12px);
      }
      .header {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .head-icon {
        flex: 0 0 auto;
        width: 44px;
        height: 44px;
        border-radius: 16px;
        display: grid;
        place-items: center;
        background: var(--m3-icon-background, var(--tf-icon-bg));
        color: var(--tf-icon-fg);
        --mdc-icon-size: 24px;
      }
      .head-text {
        flex: 1;
        min-width: 0;
      }
      .title {
        font-size: 16px;
        font-weight: 700;
        color: var(--tf-text, var(--primary-text-color));
      }
      .subtitle {
        font-size: 13px;
        color: var(--tf-secondary, var(--secondary-text-color));
      }
      .hero {
        flex: 0 0 auto;
        font-size: 34px;
        font-weight: 700;
        line-height: 1;
        letter-spacing: -0.02em;
        color: var(--tf-hero);
        font-variant-numeric: tabular-nums;
      }
      .hero-sym {
        font-size: 16px;
        margin-left: 2px;
      }
      .active {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 12px 10px 14px;
        border-radius: 18px;
        background: var(--tf-active-bg);
        cursor: pointer;
        color: var(--tf-active-fg);
        --mdc-icon-size: 24px;
      }
      .active-text {
        flex: 1;
        min-width: 0;
      }
      .active-name {
        font-size: 15px;
        font-weight: 700;
        color: var(--tf-text, var(--primary-text-color));
      }
      .active-sub {
        font-size: 13px;
        color: var(--tf-secondary, var(--secondary-text-color));
      }
      .save-pill {
        flex: 0 0 auto;
        height: 30px;
        padding: 0 12px;
        border-radius: 15px;
        display: flex;
        align-items: center;
        font-size: 14px;
        font-weight: 700;
        background: var(--tf-pill-bg);
        color: var(--tf-text, var(--primary-text-color));
      }
      .split {
        display: flex;
        gap: 3px;
        height: 12px;
      }
      .split-seg {
        min-width: 4px;
        border-radius: 2px;
        transition: flex-grow 400ms cubic-bezier(0.2, 0, 0, 1);
      }
      .split-seg:first-child {
        border-top-left-radius: 6px;
        border-bottom-left-radius: 6px;
      }
      .split-seg:last-child {
        border-top-right-radius: 6px;
        border-bottom-right-radius: 6px;
      }
      .split-seg.empty {
        flex: 1;
        background: color-mix(in srgb, var(--primary-text-color) 10%, transparent);
      }
      .tiles {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 8px;
      }
      .tile {
        padding: 12px 14px;
        border-radius: 18px;
        background: color-mix(in srgb, var(--primary-text-color) 6%, var(--ha-card-background, var(--card-background-color)));
        cursor: pointer;
      }
      .tile-name {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: var(--tf-secondary, var(--secondary-text-color));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .dot {
        flex: 0 0 auto;
        width: 10px;
        height: 10px;
        border-radius: 50%;
      }
      .tile-cost {
        margin-top: 6px;
        font-size: 22px;
        font-weight: 700;
        color: var(--tf-text, var(--primary-text-color));
        font-variant-numeric: tabular-nums;
      }
      .tile-sub {
        font-size: 13px;
        color: var(--tf-secondary, var(--secondary-text-color));
      }
      .hist-title {
        font-size: 13px;
        color: var(--tf-secondary, var(--secondary-text-color));
        margin: 4px 4px 8px;
      }
      .hist-bars {
        display: grid;
        gap: 8px;
        height: 150px;
        align-items: end;
      }
      .hist-col {
        position: relative;
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        align-items: stretch;
        gap: 6px;
      }
      .hist-bar {
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 0;
        border: none;
        background: none;
        cursor: pointer;
        min-height: 4px;
        transition: height 400ms cubic-bezier(0.2, 0, 0, 1);
      }
      .hist-bar:focus-visible {
        outline: 2px solid var(--primary-color);
        outline-offset: 2px;
        border-radius: 12px;
      }
      .seg {
        min-height: 3px;
        border-radius: 10px;
      }
      .hist-label {
        text-align: center;
        font-size: 12px;
        color: var(--tf-secondary, var(--secondary-text-color));
      }
      .hist-col.today .hist-label {
        font-weight: 700;
        color: var(--tf-text, var(--primary-text-color));
      }
      .tip {
        position: absolute;
        bottom: calc(100% - 12px);
        left: 0;
        z-index: 2;
        min-width: 170px;
        padding: 8px 10px;
        border-radius: 14px;
        background: var(--m3-inverse-surface, #e6e1e5);
        color: var(--m3-inverse-on-surface, #313033);
        font-size: 12px;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
      }
      .tip.left {
        left: auto;
        right: 0;
      }
      .tip-row {
        display: flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
      }
      .tip-row b {
        margin-left: auto;
      }
      .tip-cost {
        min-width: 52px;
        text-align: right;
        opacity: 0.75;
      }
      .no-animations .split-seg,
      .no-animations .hist-bar {
        transition: none;
      }
      @supports not (color: color-mix(in srgb, red 50%, blue)) {
        .tile,
        .split-seg.empty {
          background: var(--ha-card-background, var(--card-background-color));
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-tariff-card": M3TariffCard;
  }
}

const windowWithCards = window as unknown as { customCards: Array<Record<string, unknown>> };
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-tariff-card",
  name: "M3 Tariff Card",
  description: "Electricity use and cost over two or more tariffs (peak / off-peak), with the active tariff.",
  preview: false,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
