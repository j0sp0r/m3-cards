import { LitElement, html, css, svg, nothing, unsafeCSS, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import type {
  HomeAssistant,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  M3TemperatureGraphCardConfig,
  TempGraphEntityConfig,
  TempGraphRange,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_TEMP_GRAPH_DECIMALS,
  DEFAULT_TEMP_GRAPH_HEIGHT,
  DEFAULT_TEMP_GRAPH_RADIUS,
  DEFAULT_TEMP_GRAPH_RANGES,
  DEFAULT_CLIMATE_OVERVIEW_NAME_STRIP,
  TEMP_GRAPH_AREA_TOP,
  TEMP_GRAPH_CHIP_HEIGHT,
  TEMP_GRAPH_CHIP_RADIUS_FOCUS,
  TEMP_GRAPH_CHIP_TINT,
  TEMP_GRAPH_DOT_R,
  TEMP_GRAPH_HERO_SIZE,
  TEMP_GRAPH_HISTORY_MAX_MS,
  TEMP_GRAPH_LINE,
  TEMP_GRAPH_LINE_DIM,
  TEMP_GRAPH_LINE_FOCUS,
  TEMP_GRAPH_MAX_POINTS,
  TEMP_GRAPH_MIN_POINTS,
  TEMP_GRAPH_MOTION_MS,
  TEMP_GRAPH_PAD_RIGHT,
  TEMP_GRAPH_PAD_Y,
  TEMP_GRAPH_PALETTE_TONAL,
  TEMP_GRAPH_PX_PER_POINT,
  TEMP_GRAPH_REFRESH_MS,
  TEMP_GRAPH_SEGMENT_HEIGHT,
  TEMP_GRAPH_SEGMENT_PADDING,
  TEMP_GRAPH_TAP_LINGER_MS,
  resolveCornerRadius,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import { STANDARD_EASING, shouldAnimate } from "./shared/animation";
import {
  buildCssVars,
  fillColor,
  foregroundColor,
  inkOn,
  resolveCommonColors,
  resolveThemeColor,
  tintOn,
} from "./shared/color-config";
import { glassCardClass, glassCardStyles } from "./shared/glass-card";
import { cardHeaderStyles, renderCardHeader } from "./shared/card-header";
import { discoveryChangeMatters, hassChangeMatters } from "./shared/should-update";
import { TemplatedCard } from "./shared/templated-card";
import { VisibleTicker } from "./shared/visible-ticker";
import { SLIDER_TOUCH_ACTION, SliderIntent } from "./shared/slider-intent";
import { stopSwipe } from "./shared/swipe";
import { areaInfo, discoverClimateRooms } from "./shared/ha-registry";
import { buildStatePredicate, type EntityFilterConfig } from "./shared/entity-filter";
import { monotoneArea, monotonePath, niceTicks, type XY } from "./shared/smooth-path";
import { fetchTempSeries, type TempSeries } from "./shared/multi-history";
import {
  TEMP_GRAPH_RANGE_MS,
  appendLive,
  axisLabels,
  bucketCount,
  curveRuns,
  formatTemp,
  graphScale,
  mean,
  median,
  graphRooms,
  roomsToEntries,
  sortEntries,
  numericOf,
  resolveFocus,
  resolveRanges,
  smoothCurve,
  stepMeans,
  warmestIndex,
} from "./shared/temperature-graph";

const EASING = unsafeCSS(STANDARD_EASING);

console.info(
  `%c M3-TEMPERATURE-GRAPH-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #f5b3a3; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #f5b3a3; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

/** One sensor as the card draws it. */
interface Row {
  entry: TempGraphEntityConfig;
  name: string;
  color: string;
  live: number | null;
  unit: string;
  /** Reports another unit than the card's; shown, but not drawn or averaged. */
  foreign: boolean;
  series?: TempSeries;
  /** Bucket means over the window; null is a hole. */
  values: (number | null)[];
}

interface Loaded {
  key: string;
  at: number;
  series: Map<string, TempSeries>;
}

/**
 * Several temperature sensors as one graph: a curve per room on a shared
 * scale, one of them in focus — thick, with an area beneath it and a dot at
 * now — and the rest thin and faint behind it. The chips are the legend and
 * pick the focus; a finger on the graph reads every curve at that moment.
 */
@customElement("m3-temperature-graph-card")
export class M3TemperatureGraphCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config?: M3TemperatureGraphCardConfig;
  @state() private _range?: TempGraphRange;
  /** The sensor in focus; unset means the configured default. */
  @state() private _focusEntity?: string;
  /** Rooms found by discovery, when the card has no room list. */
  @state() private _discovered?: TempGraphEntityConfig[];
  private _discoverKey = "";
  /** The bucket under the finger, while scrubbing. */
  @state() private _scrub?: number;
  @state() private _width = 0;
  @state() private _now = Date.now();
  /** Bumped when data arrives or a live reading is added. */
  @state() private _version = 0;

  private _loaded = new Map<TempGraphRange, Loaded>();
  private _fetching = new Set<string>();
  /** The range whose data is on screen while another one loads. */
  private _shown?: TempGraphRange;
  private _resize?: ResizeObserver;
  private _observed?: Element;
  private _intent = new SliderIntent();
  private _lingerTimer?: number;
  private readonly _ticker = new VisibleTicker(this, (now) => {
    this._now = now;
    this._ensureData();
  });

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-temperature-graph-card-editor");
    return document.createElement("m3-temperature-graph-card-editor") as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(): M3TemperatureGraphCardConfig {
    return { type: "custom:m3-temperature-graph-card", auto_discover: true };
  }

  public setConfig(config: M3TemperatureGraphCardConfig): void {
    if (!config) throw new Error("m3-temperature-graph-card: invalid config");
    if (config.rooms !== undefined && !Array.isArray(config.rooms)) {
      throw new Error("m3-temperature-graph-card: `rooms` must be a list");
    }
    const before = this._config;
    // As on the climate overview card: no room list means "find them".
    this._config = { glass_background: true, animation: "auto", auto_discover: !config.rooms?.length, ...config };
    const { ranges, initial } = resolveRanges(config.ranges, DEFAULT_TEMP_GRAPH_RANGES, config.default_range);
    if (!this._range || !ranges.includes(this._range) || before?.default_range !== config.default_range) this._range = initial;
    if (before?.default_focus !== config.default_focus) this._focusEntity = undefined;
    this._discoverKey = "";
  }

  public getCardSize(): number {
    return 5;
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
    this._resize?.disconnect();
    this._resize = undefined;
    this._observed = undefined;
    window.clearTimeout(this._lingerTimer);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private get _manual(): boolean {
    return !!this._config?.rooms?.length || this._config?.auto_discover === false;
  }

  /** The curves, in the order listed or found, before `sort`. */
  private get _entries(): TempGraphEntityConfig[] {
    if (this._manual) return roomsToEntries(this._config?.rooms);
    const show = this.hass ? buildStatePredicate(this.hass, this._filter()) : () => true;
    return (this._discovered ?? []).filter((e) => show(e.entity));
  }

  private _filter(): EntityFilterConfig {
    const c = this._config ?? ({} as M3TemperatureGraphCardConfig);
    return {
      include_area: c.include_area,
      exclude_area: c.exclude_area,
      include_entities: c.include_entities,
      exclude_entities: c.exclude_entities,
      include_labels: c.include_labels,
      exclude_labels: c.exclude_labels,
      include_state: c.include_state,
      exclude_state: c.exclude_state,
    };
  }

  /** Finds a temperature sensor per room, the climate overview card's way. */
  private _maybeDiscover(): void {
    if (!this.hass || !this._config || this._manual) return;
    const filter = this._filter();
    const nameStrip = this._config.name_strip ?? DEFAULT_CLIMATE_OVERVIEW_NAME_STRIP;
    const key = JSON.stringify([filter, nameStrip, Object.keys(this.hass.states).length]);
    if (key === this._discoverKey) return;
    this._discoverKey = key;
    discoverClimateRooms(this.hass, { filter, nameStrip })
      .then((rooms) => {
        if (key !== this._discoverKey) return;
        this._discovered = graphRooms(rooms, filter.include_entities).map((r) => ({ entity: r.temperatureEntity!, name: r.name }));
      })
      .catch((e) => console.error("m3-temperature-graph-card: auto-discovery failed", e));
  }

  private get _ranges(): TempGraphRange[] {
    return resolveRanges(this._config?.ranges, DEFAULT_TEMP_GRAPH_RANGES).ranges;
  }

  private get _decimals(): number {
    const d = this._config?.decimals;
    return typeof d === "number" && d >= 0 && d <= 3 ? Math.round(d) : DEFAULT_TEMP_GRAPH_DECIMALS;
  }

  private _watched(): (string | undefined)[] {
    return [...this._entries.map((e) => e.entity), this._config?.summary_entity];
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    if (changed.size > 1 || !changed.has("hass")) return true;
    return this._manual
      ? hassChangeMatters(changed, this.hass, this._watched())
      : discoveryChangeMatters(changed, this.hass, this._watched());
  }

  // ---- data ------------------------------------------------------------------

  private get _dataKey(): string {
    return this._entries.map((e) => e.entity).join(",");
  }

  /** Loads the current range if it has not been, or was loaded too long ago. */
  private _ensureData(): void {
    const hass = this.hass;
    const range = this._range;
    if (!hass?.callWS || !range) return;
    const key = this._dataKey;
    if (!key) return;
    const have = this._loaded.get(range);
    const now = Date.now();
    if (have && have.key === key && now - have.at < TEMP_GRAPH_REFRESH_MS) return;
    const token = `${range}|${key}`;
    if (this._fetching.has(token)) return;
    this._fetching.add(token);
    const ids = this._entries.map((e) => e.entity);
    fetchTempSeries(hass, ids, TEMP_GRAPH_RANGE_MS[range], TEMP_GRAPH_HISTORY_MAX_MS, now)
      .then((series) => {
        if (key !== this._dataKey) return;
        // What arrived ends at the moment it was asked for; the current
        // reading carries it to now.
        for (const id of ids) {
          const s = series.get(id);
          if (s) s.steps = appendLive(s.steps, Date.now(), numericOf(this.hass?.states[id]?.state));
        }
        this._loaded.set(range, { key, at: now, series });
        this._version++;
      })
      .finally(() => this._fetching.delete(token));
  }

  /** Adds the readings that changed since the last render to every loaded range. */
  private _appendLive(): void {
    const t = Date.now();
    let changed = false;
    for (const loaded of this._loaded.values()) {
      for (const [id, s] of loaded.series) {
        const v = numericOf(this.hass?.states[id]?.state);
        const next = appendLive(s.steps, t, v);
        if (next === s.steps) continue;
        s.steps = next;
        if (v !== null) {
          s.extremes = s.extremes ? { min: Math.min(s.extremes.min, v), max: Math.max(s.extremes.max, v) } : { min: v, max: v };
        }
        changed = true;
      }
    }
    if (changed) this._version++;
  }

  // ---- model -----------------------------------------------------------------

  private _nameOf(entry: TempGraphEntityConfig): string {
    if (entry.name) return entry.name;
    const hass = this.hass!;
    const reg = (hass.entities as Record<string, { area_id?: string | null; device_id?: string | null }> | undefined)?.[entry.entity];
    const devices = hass.devices as Record<string, { area_id?: string | null }> | undefined;
    const areaId = reg?.area_id ?? (reg?.device_id ? devices?.[reg.device_id]?.area_id : undefined);
    const area = areaId ? areaInfo(hass, areaId)?.name : undefined;
    if (area) return area;
    const friendly = (hass.states[entry.entity]?.attributes?.friendly_name as string | undefined) ?? entry.entity;
    let name = friendly;
    for (const pattern of this._config?.name_strip ?? DEFAULT_CLIMATE_OVERVIEW_NAME_STRIP) {
      try {
        name = name.replace(new RegExp(pattern, "i"), "");
      } catch {
        // An invalid pattern from the config is skipped.
      }
    }
    return name.trim() || friendly;
  }

  private _rows(t0: number, t1: number, n: number): { rows: Row[]; unit: string; shown?: TempGraphRange } {
    const hass = this.hass!;
    const entries = this._entries;
    const units = entries.map((e) => (hass.states[e.entity]?.attributes?.unit_of_measurement as string | undefined) ?? "");
    const unit = units.find((u) => u) ?? "°C";
    // The range on screen: the chosen one once it has loaded, until then the
    // one before it, so a switch never blanks the graph.
    const key = this._dataKey;
    const ready = (r?: TempGraphRange) => !!r && this._loaded.get(r)?.key === key;
    const shown = ready(this._range) ? this._range : ready(this._shown) ? this._shown : undefined;
    if (shown) this._shown = shown;
    const loaded = shown ? this._loaded.get(shown) : undefined;
    const listed = entries.map((entry, i) => {
      const st = hass.states[entry.entity];
      const foreign = !!units[i] && units[i] !== unit;
      const series = loaded?.series.get(entry.entity);
      const values = series && !foreign ? stepMeans(series.steps, t0, t1, n) : new Array<number | null>(n).fill(null);
      return {
        entry,
        name: this._nameOf(entry),
        color: resolveThemeColor(entry.color ?? TEMP_GRAPH_PALETTE_TONAL[i % TEMP_GRAPH_PALETTE_TONAL.length]),
        live: numericOf(st?.state),
        unit: units[i] || unit,
        foreign,
        series,
        values,
      };
    });
    return { rows: sortEntries(listed, this._config?.sort, this._language), unit, shown };
  }

  private _summary(rows: Row[]): { value?: number; label: string } {
    const cfg = this._config!;
    const lives = rows.filter((r) => !r.foreign && r.live !== null).map((r) => r.live as number);
    if (cfg.summary === "entity" && cfg.summary_entity) {
      const st = this.hass?.states[cfg.summary_entity];
      const label = (st?.attributes?.friendly_name as string | undefined) ?? cfg.summary_entity;
      return { value: numericOf(st?.state) ?? undefined, label };
    }
    if (cfg.summary === "median") return { value: median(lives), label: this._t("tempgraph_summary_median") };
    return { value: mean(lives), label: this._t("tempgraph_summary_mean") };
  }

  // ---- lifecycle -------------------------------------------------------------

  protected willUpdate(changed: PropertyValues): void {
    super.willUpdate?.(changed);
    if (changed.has("hass") || changed.has("_config")) this._maybeDiscover();
    if (changed.has("hass")) this._appendLive();
    if (changed.has("hass") || changed.has("_config") || changed.has("_range") || changed.has("_discovered")) this._ensureData();
  }

  protected updated(changed: PropertyValues): void {
    super.updated?.(changed);
    const chart = this.renderRoot.querySelector(".chart");
    if (chart && chart !== this._observed) {
      this._resize?.disconnect();
      this._observed = chart;
      this._resize = new ResizeObserver((entries) => {
        const w = Math.round(entries[0]?.contentRect.width ?? 0);
        if (w && w !== this._width) this._width = w;
      });
      this._resize.observe(chart);
    }
  }

  // ---- interaction -----------------------------------------------------------

  private _pickFocus(entity: string): void {
    if (entity === this._focusEntity) return;
    this._focusEntity = entity;
  }

  private _onChipKey(e: KeyboardEvent, i: number, rows: Row[]): void {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + rows.length) % rows.length;
    this._pickFocus(rows[next].entry.entity);
    void this.updateComplete.then(() => {
      (this.renderRoot.querySelectorAll<HTMLElement>(".chip")[next])?.focus();
    });
  }

  private _pickRange(r: TempGraphRange): void {
    if (r === this._range) return;
    this._scrub = undefined;
    this._range = r;
  }

  private _onRangeKey(e: KeyboardEvent, i: number): void {
    const ranges = this._ranges;
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + ranges.length) % ranges.length;
    this._pickRange(ranges[next]);
    void this.updateComplete.then(() => {
      (this.renderRoot.querySelectorAll<HTMLElement>(".segment")[next])?.focus();
    });
  }

  private _bucketAt(e: PointerEvent, n: number): number {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const plotW = Math.max(1, rect.width - TEMP_GRAPH_PAD_RIGHT);
    const f = Math.min(0.9999, Math.max(0, (e.clientX - rect.left) / plotW));
    return Math.floor(f * n);
  }

  private _n(): number {
    return bucketCount(this._width - TEMP_GRAPH_PAD_RIGHT, TEMP_GRAPH_PX_PER_POINT, TEMP_GRAPH_MIN_POINTS, TEMP_GRAPH_MAX_POINTS);
  }

  private _onPointerDown = (e: PointerEvent): void => {
    window.clearTimeout(this._lingerTimer);
    if (this._intent.down(e)) {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      this._scrub = this._bucketAt(e, this._n());
    }
  };

  private _onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType === "mouse" && !e.buttons) {
      this._scrub = this._bucketAt(e, this._n());
      return;
    }
    const r = this._intent.move(e);
    if (r === "none") return;
    if (r === "start") (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    this._scrub = this._bucketAt(e, this._n());
  };

  private _onPointerUp = (e: PointerEvent): void => {
    const r = this._intent.up(e);
    if (r === "tap") {
      // A tap shows the reading for a moment, long enough to read it.
      this._scrub = this._bucketAt(e, this._n());
      this._lingerTimer = window.setTimeout(() => (this._scrub = undefined), TEMP_GRAPH_TAP_LINGER_MS);
    } else if (e.pointerType !== "mouse") {
      this._scrub = undefined;
    }
  };

  private _onPointerCancel = (e: PointerEvent): void => {
    this._intent.cancel(e);
    this._scrub = undefined;
  };

  private _onPointerLeave = (e: PointerEvent): void => {
    if (e.pointerType === "mouse") this._scrub = undefined;
  };

  private _onChartKey = (e: KeyboardEvent): void => {
    const n = this._n();
    if (e.key === "Escape") {
      this._scrub = undefined;
      return;
    }
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const from = this._scrub ?? n;
    this._scrub = Math.min(n - 1, Math.max(0, from + step * (e.shiftKey ? 5 : 1)));
  };

  private _onChartBlur = (): void => {
    this._scrub = undefined;
  };

  // ---- render ----------------------------------------------------------------

  private _fmt(v: number): string {
    return formatTemp(v, this._decimals, this._language);
  }

  private _timeLabel(t: number, range: TempGraphRange): string {
    const short = TEMP_GRAPH_RANGE_MS[range] <= TEMP_GRAPH_HISTORY_MAX_MS / 2;
    const opts: Intl.DateTimeFormatOptions = short
      ? { hour: "numeric", minute: "2-digit" }
      : { weekday: "short", hour: "numeric", minute: "2-digit" };
    return new Intl.DateTimeFormat(this._language, opts).format(new Date(t));
  }

  protected render() {
    const cfg = this._config;
    if (!cfg || !this.hass) return nothing;

    const range = this._range ?? this._ranges[0];
    const n = this._n();
    const t1 = Math.max(this._now, Date.now());
    const span = TEMP_GRAPH_RANGE_MS[range];
    const t0 = t1 - span;
    void this._version;
    const { rows, unit, shown } = this._rows(t0, t1, n);
    const picked = rows.findIndex((r) => r.entry.entity === this._focusEntity);
    const focus = picked >= 0 ? picked : resolveFocus(cfg.default_focus, rows.map((r) => r.entry));
    const scrub = this._scrub !== undefined && this._scrub < n ? this._scrub : undefined;

    const accent = resolveThemeColor(cfg.accent_color ?? "primary");
    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(cfg);
    const iconBg = tintOn(this, accent, undefined, 20);
    const segFill = fillColor(this, accent);
    const vars = buildCssVars({
      "m3p-icon-bg": iconBg,
      "m3p-icon-color": foregroundColor(this, accent, 3),
      "m3p-text": textColorCss,
      "m3p-secondary-text": secondaryTextColorCss,
      "tg-hero": foregroundColor(this, accent, 3),
      "tg-seg-fill": segFill,
      "tg-seg-ink": inkOn(segFill, this),
      "tg-seg-bg": tintOn(this, "var(--primary-text-color)", undefined, 6),
    });
    const radius = resolveCornerRadius(cfg.radius ?? DEFAULT_TEMP_GRAPH_RADIUS, cfg.corners);
    const animate = shouldAnimate(cfg.animation);

    const summary = this._summary(rows);
    const warmest = warmestIndex(rows.map((r) => (r.foreign ? null : r.live)));
    const subtitle =
      rows.length === 0
        ? this._t("tempgraph_no_entities")
        : warmest >= 0
          ? this._t("tempgraph_warmest").replace("{name}", rows[warmest].name)
          : this._t("tempgraph_no_data");
    const heroUnit = cfg.summary === "entity" && cfg.summary_entity
      ? ((this.hass.states[cfg.summary_entity]?.attributes?.unit_of_measurement as string | undefined) ?? unit)
      : unit;

    return html`
      <ha-card style=${`${vars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(cfg.glass_background)} ${animate ? "" : "no-animations"}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          ${cfg.show_header === false
            ? nothing
            : renderCardHeader({
            icon: cfg.icon ?? "mdi:thermometer",
            name: cfg.name ?? this._t("tempgraph_title"),
            subtitle,
            right: html`<div class="hero">
              <div class="hero-value">
                <span class="hero-n">${summary.value === undefined ? "–" : this._fmt(summary.value)}</span><span class="hero-u"
                  >${heroUnit}</span
                >
              </div>
              <div class="hero-l">${summary.label}</div>
            </div>`,
              })}
          ${rows.length && cfg.show_chips !== false ? this._renderChips(rows, focus, scrub) : nothing}
          ${rows.length ? this._renderChart(rows, focus, scrub, range, shown, t0, t1, n) : nothing}
          ${rows.length ? this._renderFooter(rows[focus], unit, range) : nothing}
        </div>
      </ha-card>
    `;
  }

  private _renderChips(rows: Row[], focus: number, scrub: number | undefined) {
    return html`
      <div class="chips" role="radiogroup" aria-label=${this._t("tempgraph_sensors_label")}>
        ${rows.map((row, i) => {
          const v = scrub !== undefined ? row.values[scrub] : row.live;
          const hasData = row.live !== null || row.values.some((x) => x !== null);
          const text = v === null || v === undefined ? "–" : `${this._fmt(v)}°`;
          const selected = i === focus;
          const dot = fillColor(this, row.color);
          const style = buildCssVars({
            "chip-dot": dot,
            "chip-tint": tintOn(this, row.color, undefined, TEMP_GRAPH_CHIP_TINT),
          });
          return html`<button
            class="chip ${selected ? "focus" : ""} ${hasData && !row.foreign ? "" : "dim"}"
            role="radio"
            aria-checked=${selected ? "true" : "false"}
            aria-label=${`${row.name} ${v === null || v === undefined ? this._t("tempgraph_no_data") : `${this._fmt(v)} ${row.unit}`}`}
            tabindex=${selected ? "0" : "-1"}
            style=${style}
            @click=${() => this._pickFocus(row.entry.entity)}
            @keydown=${(e: KeyboardEvent) => this._onChipKey(e, i, rows)}
          >
            <span class="chip-dot"></span><span class="chip-name">${row.name}</span><span class="chip-value">${text}</span>
          </button>`;
        })}
      </div>
    `;
  }

  private _renderChart(
    rows: Row[],
    focus: number,
    scrub: number | undefined,
    range: TempGraphRange,
    shown: TempGraphRange | undefined,
    t0: number,
    t1: number,
    n: number,
  ) {
    const cfg = this._config!;
    const height = Math.max(60, Math.min(400, cfg.height ?? DEFAULT_TEMP_GRAPH_HEIGHT));
    const width = Math.max(1, this._width);
    const plotW = Math.max(1, width - TEMP_GRAPH_PAD_RIGHT);
    const drawn = rows.filter((r) => !r.foreign);
    const curves = drawn.map((r) => [...r.values, r.live]);
    const scale = graphScale(curves, height, TEMP_GRAPH_PAD_Y);
    const x = (i: number) => ((i + 0.5) / n) * plotW;
    const stale = shown !== range;

    const lineOf = (row: Row): { runs: XY[][]; end?: XY } => {
      if (!scale) return { runs: [] };
      const runs = curveRuns(smoothCurve(row.values, Math.max(1, Math.round(n / 32))), x, scale.y);
      // The line ends at the current reading, at now, where the dot is.
      const lastRun = runs[runs.length - 1];
      const end = row.live !== null && !row.foreign && !stale ? { x: plotW, y: scale.y(row.live) } : undefined;
      if (end && lastRun && row.values[n - 1] !== null) lastRun.push(end);
      return { runs, end };
    };

    const focusRow = rows[focus];
    const focusLine = focusRow && !focusRow.foreign ? lineOf(focusRow) : { runs: [] as XY[][] };
    const focusStroke = focusRow ? fillColor(this, focusRow.color) : "currentColor";
    const grid = scale ? niceTicks(scale.lo, scale.hi, 3).filter((v) => v > scale.lo && v < scale.hi) : [];
    const labels = axisLabels(range, t0, t1, this._language, this._t("tempgraph_now"));

    const scrubX = scrub !== undefined ? x(scrub) : undefined;
    const scrubV = scrub !== undefined && focusRow && !focusRow.foreign ? focusRow.values[scrub] : null;
    const scrubT = scrub !== undefined ? t0 + ((scrub + 0.5) / n) * (t1 - t0) : undefined;
    const tooltip =
      scrubX !== undefined && scrubT !== undefined
        ? `${this._timeLabel(scrubT, range)} · ${scrubV === null || scrubV === undefined ? "–" : `${this._fmt(scrubV)}°`}`
        : "";

    const curvesSvg = scale
      ? svg`
          ${grid.map((v) => svg`<line class="grid" x1="0" x2=${plotW} y1=${scale.y(v)} y2=${scale.y(v)}></line>`)}
          ${rows.map((row, i) => {
            if (row.foreign) return nothing;
            const { runs } = i === focus ? { runs: focusLine.runs } : lineOf(row);
            return svg`<path
              class="line ${i === focus ? "hidden" : ""}"
              d=${runs.map((r) => monotonePath(r)).join("")}
              style=${`stroke: ${fillColor(this, row.color)};`}
            ></path>`;
          })}
          ${keyed(
            `${focus}`,
            svg`<g class="focus">
              <defs>
                <linearGradient id="tg-area" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stop-color=${focusStroke} stop-opacity=${TEMP_GRAPH_AREA_TOP}></stop>
                  <stop offset="1" stop-color=${focusStroke} stop-opacity="0"></stop>
                </linearGradient>
              </defs>
              ${focusLine.runs.map((r) => svg`<path class="area" d=${monotoneArea(r, height)}></path>`)}
              <path class="line-focus" d=${focusLine.runs.map((r) => monotonePath(r)).join("")} style=${`stroke: ${focusStroke};`}></path>
              ${focusLine.end && scrub === undefined
                ? svg`<circle class="end" cx=${focusLine.end.x} cy=${focusLine.end.y} r=${TEMP_GRAPH_DOT_R} style=${`fill: ${focusStroke};`}></circle>`
                : nothing}
            </g>`,
          )}
          ${scrubX !== undefined
            ? svg`<line class="scrub" x1=${scrubX} x2=${scrubX} y1="0" y2=${height}></line>
                ${scrubV !== null && scrubV !== undefined
                  ? svg`<circle class="end" cx=${scrubX} cy=${scale.y(scrubV)} r=${TEMP_GRAPH_DOT_R} style=${`fill: ${focusStroke};`}></circle>`
                  : nothing}`
            : nothing}
        `
      : nothing;

    const showExtremes = cfg.show_extremes !== false && scale && scrub === undefined;
    return html`
      <div
        class="chart ${stale ? "stale" : ""}"
        style=${`height: ${height}px; touch-action: ${SLIDER_TOUCH_ACTION};`}
        tabindex="0"
        role="slider"
        aria-label=${this._t("tempgraph_chart_label")}
        aria-valuemin="0"
        aria-valuemax=${n - 1}
        aria-valuenow=${scrub ?? n - 1}
        aria-valuetext=${tooltip || this._t("tempgraph_now")}
        @pointerdown=${this._onPointerDown}
        @pointermove=${this._onPointerMove}
        @pointerup=${this._onPointerUp}
        @pointercancel=${this._onPointerCancel}
        @pointerleave=${this._onPointerLeave}
        @keydown=${this._onChartKey}
        @blur=${this._onChartBlur}
        @touchstart=${stopSwipe}
        @touchmove=${stopSwipe}
      >
        ${keyed(
          `${shown ?? ""}`,
          html`<svg class="curves" width="100%" height=${height} viewBox="0 0 ${width} ${height}" aria-hidden="true">
            ${curvesSvg}
          </svg>`,
        )}
        ${showExtremes
          ? html`<span class="extreme" style=${`top: ${scale!.y(scale!.hi)}px;`}>${this._fmt(scale!.hi)}°</span>
              <span class="extreme" style=${`top: ${scale!.y(scale!.lo)}px;`}>${this._fmt(scale!.lo)}°</span>`
          : nothing}
        ${scrubX !== undefined
          ? html`<span
              class="tooltip"
              style=${`left: ${Math.min(Math.max(scrubX, 56), Math.max(56, plotW - 56))}px;`}
              >${tooltip}</span
            >`
          : nothing}
      </div>
      ${cfg.show_axis === false
        ? nothing
        : html`<div class="axis" aria-hidden="true" style=${`padding-right: ${TEMP_GRAPH_PAD_RIGHT}px;`}>
            ${labels.map(
              (l) => html`<span class="tick ${l.align}" style=${`left: calc(${(l.at * 100).toFixed(3)}% - ${l.at * TEMP_GRAPH_PAD_RIGHT}px);`}
                >${l.label}</span
              >`,
            )}
          </div>`}
    `;
  }

  private _renderFooter(row: Row, unit: string, range: TempGraphRange) {
    const cfg = this._config!;
    const ranges = this._ranges;
    const showRanges = cfg.show_ranges !== false && ranges.length > 1;
    const showFocus = cfg.show_focus_range !== false;
    if (!showRanges && !showFocus) return nothing;
    const ext = row.foreign ? undefined : row.series?.extremes;
    const lo = ext && row.live !== null ? Math.min(ext.min, row.live) : ext?.min;
    const hi = ext && row.live !== null ? Math.max(ext.max, row.live) : ext?.max;
    const nameColor = foregroundColor(this, row.color, 4.5);
    return html`
      <div class="footer">
        ${showFocus
          ? html`<div class="focus-range">
              <span class="focus-name" style=${buildCssVars({ "tg-name": nameColor })}>${row.name}</span>
              ${lo !== undefined && hi !== undefined ? html`<span> · ${this._fmt(lo)} – ${this._fmt(hi)} ${row.foreign ? row.unit : unit}</span>` : nothing}
            </div>`
          : nothing}
        ${showRanges
          ? html`<div class="segments" role="radiogroup" aria-label=${this._t("tempgraph_ranges_label")}>
              ${ranges.map(
                (r, i) => html`<button
                  class="segment ${r === range ? "active" : ""}"
                  role="radio"
                  aria-checked=${r === range ? "true" : "false"}
                  tabindex=${r === range ? "0" : "-1"}
                  @click=${() => this._pickRange(r)}
                  @keydown=${(e: KeyboardEvent) => this._onRangeKey(e, i)}
                >
                  ${this._t(`tempgraph_range_${r}` as TranslationKey)}
                </button>`,
              )}
            </div>`
          : nothing}
      </div>
    `;
  }

  static styles = [
    glassCardStyles,
    cardHeaderStyles,
    css`
      ha-card {
        color: var(--m3p-text, var(--primary-text-color));
      }

      .card-inner {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: var(--m3-card-gap, 12px);
      }

      /* ---- header ---- */
      .m3-header {
        cursor: default;
      }
      .hero {
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        line-height: 1;
      }
      .hero-value {
        display: flex;
        align-items: baseline;
        gap: 3px;
        color: var(--tg-hero);
      }
      .hero-n {
        font-size: ${TEMP_GRAPH_HERO_SIZE}px;
        font-weight: 500;
        letter-spacing: -0.02em;
        font-variant-numeric: tabular-nums;
      }
      .hero-u {
        font-size: 15px;
        font-weight: 500;
      }
      .hero-l {
        margin-top: 4px;
        font-size: 12px;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
      }

      /* ---- chips ---- */
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        height: ${TEMP_GRAPH_CHIP_HEIGHT}px;
        padding: 0 13px 0 11px;
        border: 1px solid color-mix(in srgb, var(--m3p-text, var(--primary-text-color)) 16%, transparent);
        border-radius: ${TEMP_GRAPH_CHIP_HEIGHT / 2}px;
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: 14px;
        cursor: pointer;
        white-space: nowrap;
        transition:
          border-radius ${TEMP_GRAPH_MOTION_MS}ms ${EASING},
          background-color ${TEMP_GRAPH_MOTION_MS}ms ${EASING},
          border-color ${TEMP_GRAPH_MOTION_MS}ms ${EASING},
          opacity ${TEMP_GRAPH_MOTION_MS}ms ${EASING};
      }
      .chip.focus {
        border-radius: ${TEMP_GRAPH_CHIP_RADIUS_FOCUS}px;
        background: var(--chip-tint);
        border-color: transparent;
      }
      .chip:focus-visible {
        outline: 2px solid var(--chip-dot);
        outline-offset: 2px;
      }
      .chip.dim {
        opacity: 0.5;
      }
      .chip-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--chip-dot);
        flex-shrink: 0;
      }
      .chip-value {
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }

      /* ---- graph ---- */
      .chart {
        position: relative;
        width: 100%;
        outline: none;
        cursor: crosshair;
        user-select: none;
        -webkit-user-select: none;
        transition: opacity ${TEMP_GRAPH_MOTION_MS}ms ${EASING};
      }
      .chart:focus-visible {
        outline: 2px solid var(--tg-seg-fill);
        outline-offset: 4px;
        border-radius: 8px;
      }
      .chart.stale {
        opacity: 0.4;
      }
      .curves {
        display: block;
        overflow: visible;
        animation: tg-in ${TEMP_GRAPH_MOTION_MS}ms ${EASING};
      }
      .grid {
        stroke: currentColor;
        stroke-opacity: 0.12;
        stroke-width: 1;
        stroke-dasharray: 3 5;
      }
      .line,
      .line-focus {
        fill: none;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .line {
        stroke-width: ${TEMP_GRAPH_LINE}px;
        opacity: ${TEMP_GRAPH_LINE_DIM};
        transition: opacity ${TEMP_GRAPH_MOTION_MS}ms ${EASING};
      }
      .line.hidden {
        opacity: 0;
      }
      .line-focus {
        stroke-width: ${TEMP_GRAPH_LINE_FOCUS}px;
      }
      .area {
        fill: url(#tg-area);
        stroke: none;
      }
      .focus {
        animation: tg-in ${TEMP_GRAPH_MOTION_MS}ms ${EASING};
      }
      .end {
        stroke: var(--ha-card-background, var(--card-background-color, #1c1c1c));
        stroke-width: 2.5px;
      }
      .scrub {
        stroke: currentColor;
        stroke-opacity: 0.35;
        stroke-width: 1;
      }
      .extreme {
        position: absolute;
        left: 0;
        transform: translateY(-50%);
        padding: 2px 7px;
        border-radius: 10px;
        background: color-mix(in srgb, var(--card-background-color, #1c1c1c) 80%, transparent);
        font-size: 11px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
        pointer-events: none;
      }
      .tooltip {
        position: absolute;
        top: -6px;
        transform: translate(-50%, -100%);
        padding: 4px 10px;
        border-radius: 12px;
        background: var(--tg-seg-fill);
        color: var(--tg-seg-ink);
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
        pointer-events: none;
      }
      .axis {
        position: relative;
        height: 16px;
        font-size: 12px;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
      }
      .tick {
        position: absolute;
        top: 0;
        white-space: nowrap;
        transform: translateX(-50%);
      }
      .tick.start {
        transform: none;
      }
      .tick.end {
        transform: translateX(-100%);
      }

      /* ---- footer ---- */
      .footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }
      .focus-range {
        font-size: 13px;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
        min-width: 0;
        font-variant-numeric: tabular-nums;
      }
      .focus-name {
        color: var(--tg-name);
        font-weight: 600;
        transition: color ${TEMP_GRAPH_MOTION_MS}ms ${EASING};
      }
      .segments {
        display: flex;
        gap: 2px;
        padding: ${TEMP_GRAPH_SEGMENT_PADDING}px;
        border-radius: ${TEMP_GRAPH_SEGMENT_HEIGHT / 2 + TEMP_GRAPH_SEGMENT_PADDING}px;
        background: var(--tg-seg-bg);
        margin-left: auto;
      }
      .segment {
        height: ${TEMP_GRAPH_SEGMENT_HEIGHT}px;
        border: none;
        padding: 0 14px;
        border-radius: ${TEMP_GRAPH_SEGMENT_HEIGHT / 2}px;
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        opacity: 0.75;
        cursor: pointer;
        white-space: nowrap;
        transition:
          border-radius ${TEMP_GRAPH_MOTION_MS}ms ${EASING},
          background-color ${TEMP_GRAPH_MOTION_MS}ms ${EASING},
          opacity ${TEMP_GRAPH_MOTION_MS}ms ${EASING};
      }
      .segment.active {
        border-radius: ${TEMP_GRAPH_CHIP_RADIUS_FOCUS}px;
        background: var(--tg-seg-fill);
        color: var(--tg-seg-ink);
        opacity: 1;
      }
      .segment:focus-visible {
        outline: 2px solid var(--tg-seg-fill);
        outline-offset: 2px;
      }

      @keyframes tg-in {
        from {
          opacity: 0;
        }
      }

      .no-animations .chip,
      .no-animations .segment,
      .no-animations .line,
      .no-animations .chart,
      .no-animations .focus-name {
        transition: none;
      }
      .no-animations .curves,
      .no-animations .focus {
        animation: none;
      }
      @media (prefers-reduced-motion: reduce) {
        .chip,
        .segment,
        .line,
        .chart,
        .focus-name {
          transition: none;
        }
        .curves,
        .focus {
          animation: none;
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-temperature-graph-card": M3TemperatureGraphCard;
  }
}

const windowWithCards = window as unknown as { customCards: Array<Record<string, unknown>> };
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-temperature-graph-card",
  name: "M3 Temperature Graph Card",
  description: "Several temperature sensors as one graph, one room in focus, with a scrubbable timeline.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
