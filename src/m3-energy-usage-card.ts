import { LitElement, html, css, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import type {
  EnergyUsagePeriodKind,
  HomeAssistant,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  M3EnergyUsageCardConfig,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_USAGE_RADIUS,
  USAGE_BATTERY_COLOR,
  USAGE_EXPORT_COLOR,
  USAGE_GRID_COLOR,
  USAGE_COUNT_MS,
  USAGE_REFRESH_MS,
  USAGE_SEGMENT_GAP,
  USAGE_SEGMENT_HEIGHT,
  USAGE_SEGMENT_PAD,
  USAGE_SEGMENT_RADIUS,
  USAGE_SEGMENT_RADIUS_ON,
  USAGE_SLIDE_PX,
  USAGE_SOLAR_COLOR,
  USAGE_STAGGER_TOTAL_MS,
  resolveCornerRadius,
} from "./const";
import { buildCssVars, foregroundOn, resolveCommonColors, resolveThemeColor, tintOn } from "./shared/color-config";
import { glassCardClass, glassCardStyles } from "./shared/glass-card";
import { isReducedMotion, shouldAnimate } from "./shared/animation";
import { localize, type TranslationKey } from "./localize";
import { TemplatedCard } from "./shared/templated-card";
import { formatNumber } from "./shared/formatting";
import { openEntityDetail } from "./shared/entity-detail";
import { formatCurrencyParts } from "./shared/pricing";
import { cachedStatsCall } from "./shared/ha-statistics";
import {
  bucketLabel,
  bucketOf,
  bucketsOf,
  getSharedPeriod,
  haEnergyCollection,
  isFuture,
  kindFromRange,
  periodFor,
  periodLabel,
  setSharedPeriod,
  shiftPeriod,
  subscribeSharedPeriod,
  type EnergyPeriod,
} from "./shared/energy-period";
import { NO_FLOWS, addFlows, scaleEnergy, selfSufficiency, splitUsage, sumUsage, type EnergyFlows, type Usage } from "./shared/energy-usage";

console.info(
  `%c M3-ENERGY-USAGE-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #f0a24a; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #f0a24a; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

interface Sources {
  gridFrom: string[];
  gridTo: string[];
  solar: string[];
  batteryFrom: string[];
  batteryTo: string[];
  gridCost: string[];
  exportCompensation: string[];
  devices: { id: string; name?: string }[];
}

interface Loaded {
  key: string;
  period: EnergyPeriod;
  buckets: EnergyFlows[];
  total: EnergyFlows;
  gridCost?: number;
  compensation?: number;
  devices: { id: string; name: string; kwh: number }[];
}

type GridSourcePrefs = {
  type: string;
  stat_energy_from?: string | null;
  stat_energy_to?: string | null;
  stat_cost?: string | null;
  stat_compensation?: string | null;
  flow_from?: { stat_energy_from?: string; stat_cost?: string | null }[];
  flow_to?: { stat_energy_to?: string; stat_compensation?: string | null }[];
};

const DEFAULT_PERIODS: EnergyUsagePeriodKind[] = ["day", "week", "month"];

/**
 * The energy dashboard's use over a period, in M3 (#56): a date selection
 * with arrows and a segmented day/week/month, the total with the
 * self-sufficiency, stacked bars per hour/day/month (grid at the bottom,
 * battery, solar on top) and a table of the sources with their costs.
 * Built on the same statistics as Home Assistant's own energy cards, not on
 * their components; see shared/energy-period.ts for how the period is shared.
 */
@customElement("m3-energy-usage-card")
export class M3EnergyUsageCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3EnergyUsageCardConfig;
  @state() private _period?: EnergyPeriod;
  @state() private _data?: Loaded;
  @state() private _noDashboard = false;
  @state() private _tip?: number;
  @state() private _loading = false;
  /** Where the last new period came from: −1 earlier, 1 later, 0 another kind. */
  private _dir: -1 | 0 | 1 = 0;
  /** The total as last painted, in kWh, for the count to the next one. */
  private _heroFrom?: number;
  private _heroFrame?: number;

  private _sources?: Sources;
  private _unsubShared?: () => void;
  private _unsubHa?: () => void;
  private _timer?: number;
  private _fetchKey?: string;

  public setConfig(config: M3EnergyUsageCardConfig): void {
    this._config = config;
    this._sources = undefined;
    this._fetchKey = undefined;
  }

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-energy-usage-card-editor");
    return document.createElement("m3-energy-usage-card-editor") as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(): M3EnergyUsageCardConfig {
    return { type: "custom:m3-energy-usage-card", glass_background: true };
  }

  public getCardSize(): number {
    return 8;
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: 12, rows: "auto", min_columns: 6 };
  }

  private get _key(): string {
    return this._config?.collection_key || "default";
  }

  private _fallbackPeriod = (): EnergyPeriod => periodFor(this._config?.period ?? "day", new Date());

  public connectedCallback(): void {
    super.connectedCallback();
    // A running period gains data by the hour; a past one never changes.
    this._timer = window.setInterval(() => {
      if (this._period && this._period.end.getTime() > Date.now()) {
        this._fetchKey = undefined;
        this.requestUpdate();
      }
    }, USAGE_REFRESH_MS);
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._timer) window.clearInterval(this._timer);
    if (this._heroFrame) cancelAnimationFrame(this._heroFrame);
    this._unsubShared?.();
    this._unsubShared = undefined;
    this._unsubHa?.();
    this._unsubHa = undefined;
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private get _currency(): string {
    return (this.hass?.config as { currency?: string } | undefined)?.currency ?? "EUR";
  }

  // ---- period ----------------------------------------------------------------

  /** Joins the shared period and, where a native energy card made one, HA's collection. */
  private _attach(): void {
    if (this._unsubShared || !this.hass) return;
    this._period = getSharedPeriod(this._key, this._fallbackPeriod);
    this._unsubShared = subscribeSharedPeriod(this._key, this._fallbackPeriod, (p) => {
      const old = this._period;
      this._dir = !old || old.kind !== p.kind ? 0 : p.start > old.start ? 1 : p.start < old.start ? -1 : 0;
      this._period = p;
      this._tip = undefined;
    });
    const coll = haEnergyCollection((this.hass as unknown as { connection?: unknown }).connection, this._config?.collection_key);
    if (coll?.start && coll.subscribe) {
      const adopt = () => {
        if (!coll.start) return;
        const kind = kindFromRange(coll.start, coll.end);
        const p = periodFor(kind, coll.start);
        if (this._period && p.start.getTime() === this._period.start.getTime() && p.kind === this._period.kind) return;
        setSharedPeriod(this._key, p);
      };
      adopt();
      try {
        this._unsubHa = coll.subscribe(() => adopt());
      } catch {
        // The collection changed shape: the card keeps its own period.
      }
    }
  }

  private _setPeriod(p: EnergyPeriod): void {
    setSharedPeriod(this._key, p);
    // Native energy cards on the same view follow, where HA exposes their
    // collection. Its end is inclusive.
    const coll = haEnergyCollection((this.hass as unknown as { connection?: unknown } | undefined)?.connection, this._config?.collection_key);
    try {
      coll?.setPeriod?.(p.start, new Date(p.end.getTime() - 1));
      coll?.refresh?.();
    } catch {
      // Not ours to depend on.
    }
  }

  // ---- data ------------------------------------------------------------------

  protected shouldUpdate(changed: PropertyValues): boolean {
    if (!changed.has("hass") || changed.size > 1) return true;
    const prev = changed.get("hass") as HomeAssistant | undefined;
    const hass = this.hass;
    if (!prev || !hass) return true;
    // Statistics, not states: only locale/theme or the first hass matter.
    return prev.locale !== hass.locale || prev.themes !== hass.themes || prev.language !== hass.language;
  }

  protected willUpdate(changed: PropertyValues): void {
    super.willUpdate?.(changed);
    if (this.hass && !this._unsubShared) this._attach();
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    void this._maybeFetch();
    if (changed.has("_data")) this._countHero();
  }

  private async _loadSources(): Promise<Sources | undefined> {
    const hass = this.hass!;
    const over = this._config?.sources;
    try {
      const [prefs, info] = await Promise.all([
        hass.callWS<{ energy_sources: GridSourcePrefs[]; device_consumption?: { stat_consumption: string; name?: string }[] }>({ type: "energy/get_prefs" }),
        hass.callWS<{ cost_sensors?: Record<string, string> }>({ type: "energy/info" }).catch(() => ({ cost_sensors: {} as Record<string, string> })),
      ]);
      const costs = info?.cost_sensors ?? {};
      const grids = prefs.energy_sources.filter((s) => s.type === "grid");
      const from: string[] = [];
      const to: string[] = [];
      const gridCost: string[] = [];
      const comp: string[] = [];
      for (const g of grids) {
        // Both the flat format and the older flow_from / flow_to lists.
        const fromList = g.flow_from ?? (g.stat_energy_from ? [{ stat_energy_from: g.stat_energy_from, stat_cost: g.stat_cost }] : []);
        const toList = g.flow_to ?? (g.stat_energy_to ? [{ stat_energy_to: g.stat_energy_to, stat_compensation: g.stat_compensation }] : []);
        for (const f of fromList) {
          if (!f.stat_energy_from) continue;
          from.push(f.stat_energy_from);
          const c = f.stat_cost || costs[f.stat_energy_from];
          if (c) gridCost.push(c);
        }
        for (const t of toList) {
          if (!t.stat_energy_to) continue;
          to.push(t.stat_energy_to);
          const c = t.stat_compensation || costs[t.stat_energy_to];
          if (c) comp.push(c);
        }
      }
      const of = (type: string, field: "stat_energy_from" | "stat_energy_to") =>
        prefs.energy_sources.filter((s) => s.type === type).map((s) => s[field]).filter((v): v is string => !!v);
      const sources: Sources = {
        gridFrom: over?.grid_from ?? from,
        gridTo: over?.grid_to ?? to,
        solar: over?.solar ?? of("solar", "stat_energy_from"),
        batteryFrom: over?.battery_from ?? of("battery", "stat_energy_from"),
        batteryTo: over?.battery_to ?? of("battery", "stat_energy_to"),
        gridCost,
        exportCompensation: comp,
        devices: (prefs.device_consumption ?? []).map((d) => ({ id: d.stat_consumption, name: d.name })),
      };
      const any = sources.gridFrom.length + sources.solar.length + sources.batteryFrom.length;
      this._noDashboard = any === 0;
      return sources;
    } catch {
      if (over) {
        return {
          gridFrom: over.grid_from ?? [],
          gridTo: over.grid_to ?? [],
          solar: over.solar ?? [],
          batteryFrom: over.battery_from ?? [],
          batteryTo: over.battery_to ?? [],
          gridCost: [],
          exportCompensation: [],
          devices: [],
        };
      }
      this._noDashboard = true;
      return undefined;
    }
  }

  private async _maybeFetch(): Promise<void> {
    if (!this.hass || !this._config || !this._period) return;
    const p = this._period;
    const key = `${p.kind}|${p.start.getTime()}|${this._config.show_devices ? 1 : 0}`;
    if (key === this._fetchKey) return;
    this._fetchKey = key;
    if (!this._sources) this._sources = await this._loadSources();
    const src = this._sources;
    if (!src) return;
    if (isFuture(p, new Date())) {
      this._data = { key, period: p, buckets: bucketsOf(p).map(() => ({ ...NO_FLOWS })), total: { ...NO_FLOWS }, devices: [] };
      return;
    }
    this._loading = true;
    const unit = bucketOf(p.kind);
    const end = new Date(Math.min(p.end.getTime(), Date.now()));
    const energyIds = [...new Set([...src.gridFrom, ...src.gridTo, ...src.solar, ...src.batteryFrom, ...src.batteryTo, ...(this._config.show_devices ? src.devices.map((d) => d.id) : [])])];
    const costIds = [...new Set([...src.gridCost, ...src.exportCompensation])];
    try {
      const [energy, cost] = await Promise.all([
        energyIds.length
          ? cachedStatsCall<Record<string, { start: string | number; change?: number }[]>>(this.hass, {
              type: "recorder/statistics_during_period",
              start_time: p.start.toISOString(),
              end_time: end.toISOString(),
              statistic_ids: energyIds,
              period: unit,
              types: ["change"],
              units: { energy: "kWh" },
            })
          : Promise.resolve({} as Record<string, { start: string | number; change?: number }[]>),
        costIds.length
          ? cachedStatsCall<Record<string, { start: string | number; change?: number }[]>>(this.hass, {
              type: "recorder/statistics_during_period",
              start_time: p.start.toISOString(),
              end_time: end.toISOString(),
              statistic_ids: costIds,
              period: "month",
              types: ["change"],
            }).catch(() => ({}))
          : Promise.resolve({} as Record<string, { start: string | number; change?: number }[]>),
      ]);
      if (key !== this._fetchKey) return;
      const starts = bucketsOf(p);
      // Rows are matched to bars by their local hour, day or month, so a
      // daylight-saving shift cannot put a row into the wrong bar.
      const keyOf = (d: Date): string =>
        unit === "hour"
          ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`
          : unit === "day"
            ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
            : `${d.getFullYear()}-${d.getMonth()}`;
      const slots = new Map(starts.map((d, i) => [keyOf(d), i]));
      const indexOf = (t: number): number => slots.get(keyOf(new Date(t))) ?? -1;
      const buckets: EnergyFlows[] = starts.map(() => ({ ...NO_FLOWS }));
      const addTo = (ids: string[], field: keyof EnergyFlows) => {
        for (const id of ids) {
          for (const row of energy?.[id] ?? []) {
            const i = indexOf(typeof row.start === "number" ? row.start : Date.parse(row.start));
            if (i < 0 || typeof row.change !== "number") continue;
            buckets[i][field] += Math.max(0, row.change);
          }
        }
      };
      addTo(src.gridFrom, "gridIn");
      addTo(src.gridTo, "gridOut");
      addTo(src.solar, "solar");
      addTo(src.batteryFrom, "batteryOut");
      addTo(src.batteryTo, "batteryIn");
      const sumIds = (ids: string[], from: Record<string, { change?: number }[]>) =>
        ids.length ? ids.reduce((a, id) => a + (from?.[id] ?? []).reduce((b, r) => b + (typeof r.change === "number" ? r.change : 0), 0), 0) : undefined;
      const devices = this._config.show_devices
        ? src.devices
            .map((d) => ({
              id: d.id,
              name: d.name || (this.hass!.states[d.id]?.attributes.friendly_name as string | undefined) || d.id,
              kwh: (energy?.[d.id] ?? []).reduce((a, r) => a + Math.max(0, r.change ?? 0), 0),
            }))
            .filter((d) => d.kwh > 0)
            .sort((a, b) => b.kwh - a.kwh)
        : [];
      this._data = {
        key,
        period: p,
        buckets,
        total: buckets.reduce(addFlows, { ...NO_FLOWS }),
        gridCost: sumIds(src.gridCost, cost),
        compensation: sumIds(src.exportCompensation, cost),
        devices,
      };
    } catch (e) {
      console.warn("m3-energy-usage-card: failed to load statistics", e);
    } finally {
      this._loading = false;
    }
  }

  // ---- formatting -------------------------------------------------------------

  private _energy(kwh: number | undefined): string {
    if (kwh === undefined || !Number.isFinite(kwh)) return "–";
    const s = scaleEnergy(kwh);
    return `${formatNumber(this._language, s.value, { maximumFractionDigits: s.unit === "Wh" ? 0 : 1 })} ${s.unit}`;
  }

  private _money(v: number | undefined): string {
    if (v === undefined || !Number.isFinite(v)) return "–";
    const p = formatCurrencyParts(v, this._currency, this._language);
    return `${p.number} ${p.symbol}`;
  }

  // ---- render -------------------------------------------------------------------

  private _renderDate(p: EnergyPeriod): TemplateResult {
    const cfg = this._config!;
    const now = new Date();
    const next = shiftPeriod(p, 1);
    const periods = cfg.periods?.length ? cfg.periods : DEFAULT_PERIODS;
    const label = periodLabel(p, this._language, now, { today: this._t("usage_today"), yesterday: this._t("usage_yesterday") });
    return html`
      <div class="date">
        <div class="date-row">
          <button class="nav" aria-label=${this._t("usage_prev")} @click=${() => this._setPeriod(shiftPeriod(p, -1))}>
            <ha-icon icon="mdi:chevron-left"></ha-icon>
          </button>
          <div class="date-label" aria-live="polite">
            ${keyed(label, html`<span class="slide" style=${this._slideStyle()}>${label}</span>`)}
          </div>
          <button
            class="nav"
            aria-label=${this._t("usage_next")}
            ?disabled=${isFuture(next, now)}
            @click=${() => this._setPeriod(next)}
          >
            <ha-icon icon="mdi:chevron-right"></ha-icon>
          </button>
        </div>
        <div class="segmented" role="radiogroup">
          ${periods.includes(p.kind)
            ? html`<span
                class="seg-ind"
                style=${`width: calc((100% - ${2 * USAGE_SEGMENT_PAD + (periods.length - 1) * USAGE_SEGMENT_GAP}px) / ${periods.length}); transform: translateX(calc(${periods.indexOf(p.kind)} * (100% + ${USAGE_SEGMENT_GAP}px)));`}
              ></span>`
            : nothing}
          ${periods.map(
            (k) => html`<button
              class="seg-btn ${p.kind === k ? "on" : ""}"
              role="radio"
              aria-checked=${p.kind === k ? "true" : "false"}
              @click=${() => this._setPeriod(periodFor(k, p.kind === k ? p.start : new Date(Math.min(Date.now(), p.end.getTime() - 1))))}
            >
              ${this._t(`usage_${k}` as TranslationKey)}
            </button>`,
          )}
        </div>
      </div>
    `;
  }

  private _renderGraph(p: EnergyPeriod, usages: Usage[], colors: Record<string, string>): TemplateResult {
    const max = Math.max(0.0001, ...usages.map((u) => u.total));
    const starts = bucketsOf(p);
    const stagger = USAGE_STAGGER_TOTAL_MS / Math.max(1, usages.length);
    return html`
      <div class="bars" style=${`grid-template-columns: repeat(${usages.length}, minmax(0, 1fr)); gap: ${usages.length > 20 ? 3 : 6}px;`}>
        ${usages.map((u, i) => {
          const open = this._tip === i;
          const parts: [string, number][] = [
            ["solar", u.solar],
            ["battery", u.battery],
            ["grid", u.grid],
          ];
          return html`<div class="col">
            <button
              class="bar"
              style=${`height: ${Math.max(u.total > 0 ? 3 : 0, (u.total / max) * 100)}%; animation-delay: ${Math.round(i * stagger)}ms;`}
              aria-label=${`${bucketLabel(p, starts[i], 0, this._language) || starts[i].toLocaleString(this._language)}: ${this._energy(u.total)}`}
              aria-expanded=${open ? "true" : "false"}
              @click=${() => (this._tip = open ? undefined : i)}
            >
              ${parts.map(([k, v]) => (v > 0 ? html`<span class="seg" style=${`flex: ${v} 1 0; background: ${colors[k]};`}></span>` : nothing))}
            </button>
            ${open
              ? html`<div class="tip ${i > usages.length / 2 ? "left" : ""}" role="status">
                  <div class="tip-head">${starts[i].toLocaleString(this._language, p.kind === "day" ? { hour: "2-digit", minute: "2-digit" } : p.kind === "year" ? { month: "long" } : { weekday: "short", day: "numeric", month: "short" })}</div>
                  ${parts.map(([k, v]) =>
                    v > 0
                      ? html`<div class="tip-row"><span class="dot" style=${`background: ${colors[k]};`}></span>${this._t(`usage_${k}` as TranslationKey)}<b>${this._energy(v)}</b></div>`
                      : nothing,
                  )}
                </div>`
              : nothing}
          </div>`;
        })}
      </div>
      <div class="axis" style=${`grid-template-columns: repeat(${usages.length}, minmax(0, 1fr));`}>
        ${starts.map((d, i) => html`<span>${bucketLabel(p, d, i, this._language)}</span>`)}
      </div>
    `;
  }

  private _renderTable(u: Usage, colors: Record<string, string>): TemplateResult {
    const src = this._sources!;
    const d = this._data!;
    // A tap opens the source's meter — the first one, where several feed a row.
    const rows: { key: string; label: string; kwh: number; money?: number; entity?: string }[] = [];
    if (src.gridFrom.length) rows.push({ key: "grid", label: this._t("usage_grid"), kwh: d.total.gridIn, money: d.gridCost, entity: src.gridFrom[0] });
    if (src.solar.length) rows.push({ key: "solar", label: this._t("usage_solar"), kwh: u.solar, entity: src.solar[0] });
    if (src.batteryFrom.length) rows.push({ key: "battery", label: this._t("usage_battery"), kwh: u.battery, entity: src.batteryFrom[0] });
    if (src.gridTo.length) rows.push({ key: "export", label: this._t("usage_export"), kwh: u.export, money: d.compensation, entity: src.gridTo[0] });
    const devices = (this._config?.show_devices ? d.devices : []).slice(0, this._config?.max_devices ?? 10);
    return html`
      <div class="table" role="table">
        ${rows.map(
          (r) => html`<div
            class="trow"
            role="row"
            tabindex=${r.entity && this.hass?.states[r.entity] ? "0" : nothing}
            @click=${() => r.entity && this.hass?.states[r.entity] && openEntityDetail(this, r.entity)}
            @keydown=${(e: KeyboardEvent) => (e.key === "Enter" || e.key === " ") && r.entity && this.hass?.states[r.entity] && openEntityDetail(this, r.entity)}
          >
            <span class="dot" style=${`background: ${colors[r.key]};`}></span>
            <span class="tname" role="cell">${r.label}</span>
            <span class="tkwh" role="cell">${this._energy(r.kwh)}</span>
            <span class="tcost" role="cell">${this._money(r.money)}</span>
          </div>`,
        )}
      </div>
      ${devices.length
        ? html`<div class="table" role="table" aria-label=${this._t("usage_devices")}>
            ${devices.map(
              (dv) => html`<div
                class="trow"
                role="row"
                tabindex=${this.hass?.states[dv.id] ? "0" : nothing}
                @click=${() => this.hass?.states[dv.id] && openEntityDetail(this, dv.id)}
              >
                <ha-icon class="dicon" icon="mdi:power-plug-outline"></ha-icon>
                <span class="tname" role="cell">${dv.name}</span>
                <span class="tkwh" role="cell">${this._energy(dv.kwh)}</span>
                <span class="tcost" role="cell"></span>
              </div>`,
            )}
          </div>`
        : nothing}
    `;
  }

  private _slideStyle(): string {
    return `--eu-slide: ${this._dir * USAGE_SLIDE_PX}px;`;
  }

  /** Counts the total from the figure last shown to the new one. */
  private _countHero(): void {
    const to = this._data ? sumUsage(this._data.buckets.map(splitUsage)).total : undefined;
    const from = this._heroFrom;
    this._heroFrom = to;
    const el = this.renderRoot.querySelector<HTMLElement>(".hero-num");
    const unitEl = this.renderRoot.querySelector<HTMLElement>(".hero-unit");
    if (this._heroFrame) cancelAnimationFrame(this._heroFrame);
    const cfg = this._config;
    if (!el || to === undefined || from === undefined || from === to || !cfg || !shouldAnimate(cfg.animation) || isReducedMotion()) return;
    // Into the text node Lit rendered, not over it: replacing the node
    // (textContent) would pull it from under Lit's next update.
    const write = (host: HTMLElement | null, text: string) => {
      const node = [...(host?.childNodes ?? [])].find((n): n is Text => n.nodeType === Node.TEXT_NODE && !!n.data.trim());
      if (node) node.data = text;
    };
    const paint = (kwh: number) => {
      const s = scaleEnergy(kwh);
      write(el, formatNumber(this._language, s.value, { maximumFractionDigits: s.unit === "Wh" ? 0 : 1 }));
      write(unitEl, s.unit);
    };
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / USAGE_COUNT_MS);
      paint(from + (to - from) * (1 - Math.pow(1 - t, 3)));
      this._heroFrame = t < 1 ? requestAnimationFrame(step) : undefined;
    };
    paint(from);
    this._heroFrame = requestAnimationFrame(step);
  }

  protected render() {
    const cfg = this._config;
    if (!cfg || !this.hass) return nothing;
    const p = this._period ?? this._fallbackPeriod();
    const colors = {
      grid: cfg.grid_color ? resolveThemeColor(cfg.grid_color) : `color-mix(in srgb, ${USAGE_GRID_COLOR} 60%, white)`,
      solar: cfg.solar_color ? resolveThemeColor(cfg.solar_color) : `color-mix(in srgb, ${USAGE_SOLAR_COLOR} 65%, white)`,
      battery: cfg.battery_color ? resolveThemeColor(cfg.battery_color) : `color-mix(in srgb, ${USAGE_BATTERY_COLOR} 75%, white)`,
      export: cfg.export_color ? resolveThemeColor(cfg.export_color) : USAGE_EXPORT_COLOR,
    };
    // While the next period loads, the last one stays (dimmed) instead of the
    // card collapsing and growing again; the new one then slides in.
    const data = this._data;
    const shownPeriod = data?.period ?? p;
    const usages = data ? data.buckets.map(splitUsage) : [];
    const total = data ? sumUsage(usages) : undefined;
    const self = total ? selfSufficiency(total) : undefined;
    const hero = total ? scaleEnergy(total.total) : undefined;
    const animate = shouldAnimate(cfg.animation) && !isReducedMotion();
    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(cfg);
    const okBg = tintOn(this, USAGE_BATTERY_COLOR, undefined, 20);
    const cssVars = buildCssVars({
      "eu-text": textColorCss,
      "eu-secondary": secondaryTextColorCss,
      "eu-self-bg": okBg,
      "eu-self-fg": foregroundOn(USAGE_BATTERY_COLOR, okBg, 4.5),
    });
    const radius = resolveCornerRadius(cfg.radius ?? DEFAULT_USAGE_RADIUS, cfg.corners);

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(cfg.glass_background)} ${animate ? "" : "no-animations"} ${this._loading ? "loading" : ""}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          ${cfg.title ? html`<div class="title">${cfg.title}</div>` : nothing}
          ${cfg.show_date !== false ? this._renderDate(p) : nothing}
          ${this._noDashboard
            ? html`<div class="empty">${this._t("usage_no_dashboard")}</div>`
            : html`
                ${cfg.show_graph !== false || cfg.show_table !== false
                  ? html`<div class="hero-row">
                      <div class="hero">
                        ${hero ? html`<span class="hero-num">${formatNumber(this._language, hero.value, { maximumFractionDigits: hero.unit === "Wh" ? 0 : 1 })}</span><span class="hero-unit">${hero.unit}</span>` : "–"}
                      </div>
                      ${self !== undefined
                        ? html`<div class="self"><ha-icon icon="mdi:leaf"></ha-icon>${this._t("usage_self").replace("{p}", String(self))}</div>`
                        : nothing}
                    </div>`
                  : nothing}
                ${data
                  ? keyed(
                      data.key,
                      html`<div class="period-body slide" style=${this._slideStyle()}>
                        ${cfg.show_graph !== false
                          ? usages.some((u) => u.total > 0)
                            ? this._renderGraph(shownPeriod, usages, colors)
                            : html`<div class="empty">${this._t("usage_no_data")}</div>`
                          : nothing}
                        ${cfg.show_table !== false && total && this._sources ? this._renderTable(total, colors) : nothing}
                      </div>`,
                    )
                  : nothing}
              `}
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
      .card-inner.loading .period-body,
      .card-inner.loading .hero {
        opacity: 0.5;
        transition: opacity 200ms ease;
      }
      .title {
        font-size: 16px;
        font-weight: 700;
        color: var(--eu-text, var(--primary-text-color));
      }
      .date {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .date-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .date-label {
        flex: 1;
        overflow: hidden;
        text-align: center;
        font-size: 17px;
        font-weight: 700;
        color: var(--eu-text, var(--primary-text-color));
      }
      .nav {
        width: 44px;
        height: 44px;
        border-radius: 14px;
        border: 1px solid color-mix(in srgb, var(--primary-text-color) 18%, transparent);
        background: transparent;
        color: var(--eu-text, var(--primary-text-color));
        display: grid;
        place-items: center;
        cursor: pointer;
        transition: border-radius 200ms ease;
      }
      .nav:active:not(:disabled) {
        border-radius: 22px;
      }
      .nav:disabled {
        opacity: 0.35;
        cursor: default;
      }
      .segmented {
        position: relative;
        display: flex;
        gap: ${USAGE_SEGMENT_GAP}px;
        padding: ${USAGE_SEGMENT_PAD}px;
        border-radius: ${USAGE_SEGMENT_RADIUS}px;
        background: color-mix(in srgb, var(--primary-text-color) 6%, var(--ha-card-background, var(--card-background-color)));
      }
      .seg-btn {
        flex: 1;
        position: relative;
        height: ${USAGE_SEGMENT_HEIGHT}px;
        border: none;
        border-radius: ${USAGE_SEGMENT_RADIUS_ON}px;
        background: transparent;
        color: var(--eu-secondary, var(--secondary-text-color));
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: color 250ms ease;
      }
      .seg-btn.on {
        color: var(--eu-text, var(--primary-text-color));
      }
      /* One pill that slides to the chosen period, rather than each button
         lighting up on its own. */
      .seg-ind {
        position: absolute;
        top: ${USAGE_SEGMENT_PAD}px;
        left: ${USAGE_SEGMENT_PAD}px;
        height: ${USAGE_SEGMENT_HEIGHT}px;
        border-radius: ${USAGE_SEGMENT_RADIUS_ON}px;
        background: color-mix(in srgb, var(--primary-color) 22%, var(--ha-card-background, var(--card-background-color)));
        transition: transform 400ms cubic-bezier(0.2, 0, 0, 1);
      }
      .slide {
        display: block;
        animation: eu-in 350ms cubic-bezier(0.05, 0.7, 0.1, 1) both;
      }
      .period-body {
        display: flex;
        flex-direction: column;
        gap: var(--m3-card-gap, 12px);
      }
      @keyframes eu-in {
        from {
          opacity: 0;
          transform: translateX(var(--eu-slide, 0px));
        }
      }
      @keyframes eu-grow {
        from {
          transform: scaleY(0);
        }
      }
      .nav:focus-visible,
      .seg-btn:focus-visible,
      .bar:focus-visible {
        outline: 2px solid var(--primary-color);
        outline-offset: 2px;
      }
      .hero-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .hero {
        font-size: 40px;
        font-weight: 700;
        line-height: 1;
        letter-spacing: -0.02em;
        color: var(--eu-text, var(--primary-text-color));
        font-variant-numeric: tabular-nums;
      }
      .hero-unit {
        font-size: 18px;
        font-weight: 500;
        margin-left: 4px;
        opacity: 0.6;
      }
      .self {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 34px;
        padding: 0 14px;
        border-radius: 17px;
        background: var(--eu-self-bg);
        color: var(--eu-self-fg);
        font-size: 14px;
        font-weight: 700;
        --mdc-icon-size: 16px;
      }
      .bars {
        display: grid;
        height: 180px;
        align-items: end;
      }
      .col {
        position: relative;
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
      }
      .bar {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 0;
        border: none;
        background: none;
        cursor: pointer;
        transform-origin: bottom;
        transition: height 400ms cubic-bezier(0.2, 0, 0, 1);
        animation: eu-grow 500ms cubic-bezier(0.05, 0.7, 0.1, 1) backwards;
      }
      .seg {
        min-height: 2px;
        border-radius: 8px;
      }
      .axis {
        display: grid;
        font-size: 11px;
        color: var(--eu-secondary, var(--secondary-text-color));
        margin-top: -4px;
      }
      .axis span {
        white-space: nowrap;
        overflow: visible;
      }
      .tip {
        position: absolute;
        bottom: calc(100% + 4px);
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
      .tip-head {
        font-weight: 700;
        margin-bottom: 4px;
      }
      .tip-row {
        display: flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
      }
      .tip-row b {
        margin-left: auto;
        padding-left: 10px;
      }
      .table {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .trow {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 46px;
        padding: 0 14px;
        border-radius: 6px;
        background: color-mix(in srgb, var(--primary-text-color) 6%, var(--ha-card-background, var(--card-background-color)));
      }
      .trow:first-child {
        border-top-left-radius: 18px;
        border-top-right-radius: 18px;
      }
      .trow:last-child {
        border-bottom-left-radius: 18px;
        border-bottom-right-radius: 18px;
      }
      .dot {
        flex: 0 0 auto;
        width: 10px;
        height: 10px;
        border-radius: 50%;
      }
      .dicon {
        --mdc-icon-size: 16px;
        color: var(--eu-secondary, var(--secondary-text-color));
      }
      .tname {
        flex: 1;
        min-width: 0;
        font-size: 15px;
        color: var(--eu-text, var(--primary-text-color));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .tkwh {
        font-size: 15px;
        font-weight: 700;
        color: var(--eu-text, var(--primary-text-color));
        font-variant-numeric: tabular-nums;
      }
      .tcost {
        min-width: 64px;
        text-align: right;
        font-size: 14px;
        color: var(--eu-secondary, var(--secondary-text-color));
        font-variant-numeric: tabular-nums;
      }
      .empty {
        padding: 16px;
        text-align: center;
        font-size: 13px;
        color: var(--eu-secondary, var(--secondary-text-color));
      }
      .no-animations .bar,
      .no-animations .seg-btn,
      .no-animations .seg-ind,
      .no-animations .nav {
        transition: none;
      }
      .no-animations .bar,
      .no-animations .slide {
        animation: none;
      }
      @supports not (color: color-mix(in srgb, red 50%, blue)) {
        .segmented,
        .trow,
        .seg-ind {
          background: var(--ha-card-background, var(--card-background-color));
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-energy-usage-card": M3EnergyUsageCard;
  }
}

const windowWithCards = window as unknown as { customCards: Array<Record<string, unknown>> };
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-energy-usage-card",
  name: "M3 Energy Usage Card",
  description: "The energy dashboard's use over a day, week or month: date selection, stacked bars and a source table with costs.",
  preview: false,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
