import { LitElement, html, css, svg, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  M3RouterCardConfig,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  RouterThresholdConfig,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_ROUTER_ICON,
  DEFAULT_ROUTER_RADIUS,
  DEFAULT_ROUTER_SPARK_MINUTES,
  DEFAULT_ROUTER_SPARK_POINTS,
  ROUTER_BAR_COUNT,
  ROUTER_BAR_GAP,
  ROUTER_BAR_HEIGHTS,
  ROUTER_BAR_RADIUS,
  ROUTER_BAR_WIDTH,
  ROUTER_CHIP_HEIGHT,
  ROUTER_CHIP_RADIUS,
  ROUTER_COLOR_ACCENT,
  ROUTER_COLOR_BAD,
  ROUTER_COLOR_DOWNLOAD,
  ROUTER_COLOR_EXCELLENT,
  ROUTER_COLOR_FAIR,
  ROUTER_COLOR_GOOD,
  ROUTER_COLOR_OFFLINE,
  ROUTER_COLOR_UPLOAD,
  ROUTER_COLOR_WEAK,
  ROUTER_HEADER_ICON_RADIUS,
  ROUTER_HEADER_ICON_SIZE,
  ROUTER_LEGEND_SWATCH,
  ROUTER_SIGNAL_PADDING,
  ROUTER_SIGNAL_RADIUS,
  ROUTER_SIGNAL_TINT,
  ROUTER_SPARK_HEIGHT,
  ROUTER_SPARK_STROKE,
  ROUTER_SPARK_WIDTH,
  ROUTER_TILE_PADDING_H,
  ROUTER_TILE_PADDING_V,
  ROUTER_TILE_RADIUS,
  ROUTER_TILE_TINT,
  ROUTER_VOLUME_BAR_GAP,
  ROUTER_VOLUME_BAR_HEIGHT,
  ROUTER_VOLUME_BAR_RADIUS,
  ROUTER_VOLUME_TRACK_TINT,
  resolveCornerRadius,
} from "./const";
import {
  buildCssVars,
  foregroundOn,
  resolveCommonColors,
  resolveThemeColor,
  tintOn,
} from "./shared/color-config";
import { glassCardStyles, glassCardClass } from "./shared/glass-card";
import { cardHeaderStyles } from "./shared/card-header";
import { handleAction } from "./shared/actions";
import { activateOnKey } from "./shared/a11y";
import { formatNumber } from "./shared/formatting";
import { localize, type TranslationKey } from "./localize";
import { hassChangeMatters } from "./shared/should-update";
import { TemplatedCard } from "./shared/templated-card";
import {
  DEFAULT_NR_RSRP_THRESHOLDS,
  DEFAULT_RSRP_THRESHOLDS,
  DEFAULT_RSRQ_THRESHOLDS,
  DEFAULT_SNR_THRESHOLDS,
  GRADE_BARS,
  discoverRouterEntities,
  formatGigabytes,
  gradeBy,
  gradeOptical,
  DEFAULT_OPTICAL_RX_THRESHOLDS,
  OPTICAL_RX_MAX_DBM,
  toGigabytes,
  guessRouterPrefix,
  limitGrade,
  linkStateOf,
  normalizeNegativeDb,
  scaleThroughput,
  splitVolume,
  throughputDecimals,
  tidyValue,
  toBitsPerSecond,
  withMinusSign,
  type RouterSlot,
  type SignalGrade,
} from "./shared/router";
import {
  prefillSeries,
  pushPoint,
  sparklinePath,
} from "./shared/router-sparkline";

console.info(
  `%c M3-ROUTER-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #85b7eb; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #85b7eb; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

const GRADE_COLORS: Record<SignalGrade, string> = {
  excellent: ROUTER_COLOR_EXCELLENT,
  good: ROUTER_COLOR_GOOD,
  fair: ROUTER_COLOR_FAIR,
  weak: ROUTER_COLOR_WEAK,
  bad: ROUTER_COLOR_BAD,
};

const GRADE_LABELS: Record<SignalGrade, TranslationKey> = {
  excellent: "router_grade_excellent",
  good: "router_grade_good",
  fair: "router_grade_fair",
  weak: "router_grade_weak",
  bad: "router_grade_bad",
};

@customElement("m3-router-card")
export class M3RouterCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() protected _config?: M3RouterCardConfig;
  /** Discovered slots, recomputed whenever the entity list changes. */
  @state() private _found: Partial<Record<RouterSlot, string>> = {};
  @state() private _down: number[] = [];
  @state() private _up: number[] = [];

  /** Highest bit/s seen since the card loaded, for the optional peak chip. */
  private _peakDown = 0;
  private _peakUp = 0;
  private _prefilled = false;
  /** The state object each series last sampled, so one reading is not counted
   *  twice when an unrelated entity ticks. */
  private _lastDownStamp?: string;
  private _lastUpStamp?: string;

  public setConfig(config: M3RouterCardConfig): void {
    this._config = {
      auto_discover: true,
      show_signal: true,
      show_signal_details: true,
      show_throughput: true,
      show_sparkline: true,
      show_data: true,
      show_nr_signal: true,
      spark_points: DEFAULT_ROUTER_SPARK_POINTS,
      spark_history_minutes: DEFAULT_ROUTER_SPARK_MINUTES,
      ...config,
    };
    this._found = {};
    this._prefilled = false;
    this._down = [];
    this._up = [];
    this._peakDown = 0;
    this._peakUp = 0;
  }

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-router-card-editor");
    return document.createElement("m3-router-card-editor") as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(hass?: HomeAssistant): Partial<M3RouterCardConfig> {
    const ids = hass ? Object.keys(hass.states) : [];
    const prefix = guessRouterPrefix(ids);
    const found = discoverRouterEntities(ids, prefix);
    return {
      auto_discover: true,
      ...(prefix ? { entity_prefix: prefix } : {}),
      ...(found.connection ? { entity: found.connection } : {}),
    };
  }

  public getCardSize(): number {
    return 5;
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: "full", min_rows: 4 };
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    // The discovered set is derived from the whole entity list, so a new
    // entity appearing has to repaint even though no watched state changed.
    return hassChangeMatters(changed, this.hass, this._watched());
  }

  protected willUpdate(changed: PropertyValues): void {
    if (!this.hass || !this._config) return;
    if (changed.has("hass") || changed.has("_config")) this._discover();
    this._sample();
    if (!this._prefilled) void this._prefill();
  }

  // ---- entities -------------------------------------------------------------

  private _discover(): void {
    const cfg = this._config;
    if (!cfg || !this.hass) return;
    if (cfg.auto_discover === false) {
      this._found = {};
      return;
    }
    const ids = Object.keys(this.hass.states);
    const prefix = cfg.entity_prefix ?? guessRouterPrefix(ids);
    const found = discoverRouterEntities(ids, prefix);
    // Only assign when something actually moved: @state on an object means
    // every assignment is a render, and this runs on every hass tick.
    const same =
      Object.keys(found).length === Object.keys(this._found).length &&
      (Object.keys(found) as RouterSlot[]).every((k) => this._found[k] === found[k]);
    if (!same) this._found = found;
  }

  /** The configured entity wins over the discovered one, always. */
  private _slot(slot: RouterSlot, override?: string): string | undefined {
    return override ?? this._found[slot];
  }

  private get _e() {
    const c = this._config ?? ({} as M3RouterCardConfig);
    return {
      connection: this._slot("connection", c.entity),
      rsrp: this._slot("rsrp", c.rsrp_entity),
      rsrq: this._slot("rsrq", c.rsrq_entity),
      snr: this._slot("snr", c.snr_entity),
      nrRsrp: this._slot("nr_rsrp", c.nr_rsrp_entity),
      nrSnr: this._slot("nr_snr", c.nr_snr_entity),
      opticalRx: this._slot("optical_rx", c.optical_rx_entity),
      opticalTx: this._slot("optical_tx", c.optical_tx_entity),
      band: this._slot("band", c.band_entity),
      nrBand: this._slot("nr_band", c.nr_band_entity),
      cellId: this._slot("cell_id", c.cell_id_entity),
      networkType: this._slot("network_type", c.network_type_entity),
      download: this._slot("download", c.download_entity),
      upload: this._slot("upload", c.upload_entity),
      dataDown: this._slot("data_down", c.data_down_entity),
      dataUp: this._slot("data_up", c.data_up_entity),
      dataTotal: this._slot("data_total", c.data_total_entity),
    };
  }

  private _watched(): (string | undefined)[] {
    return Object.values(this._e);
  }

  private _num(entityId?: string): number | undefined {
    if (!entityId || !this.hass) return undefined;
    const st = this.hass.states[entityId];
    if (!st || st.state === "unknown" || st.state === "unavailable") return undefined;
    const n = Number(st.state);
    return Number.isFinite(n) ? n : undefined;
  }

  private _str(entityId?: string): string | undefined {
    if (!entityId || !this.hass) return undefined;
    const st = this.hass.states[entityId];
    if (!st || st.state === "unknown" || st.state === "unavailable" || st.state === "") {
      return undefined;
    }
    return st.state;
  }

  /** A volume sensor in gigabytes, whatever unit it publishes. */
  private _gb(entityId?: string): number | undefined {
    const raw = this._num(entityId);
    if (raw === undefined || !entityId || !this.hass) return undefined;
    return toGigabytes(raw, this.hass.states[entityId]?.attributes.unit_of_measurement);
  }

  private _bps(entityId?: string): number | undefined {
    const raw = this._num(entityId);
    if (raw === undefined || !entityId || !this.hass) return undefined;
    return toBitsPerSecond(raw, this.hass.states[entityId]?.attributes.unit_of_measurement);
  }

  // ---- series ---------------------------------------------------------------

  private _sample(): void {
    const max = this._config?.spark_points ?? DEFAULT_ROUTER_SPARK_POINTS;
    const e = this._e;
    const downStamp = e.download ? this.hass?.states[e.download]?.last_updated : undefined;
    if (downStamp && downStamp !== this._lastDownStamp) {
      this._lastDownStamp = downStamp;
      const v = this._bps(e.download);
      if (v !== undefined) {
        this._down = pushPoint(this._down, v, max);
        this._peakDown = Math.max(this._peakDown, v);
      }
    }
    const upStamp = e.upload ? this.hass?.states[e.upload]?.last_updated : undefined;
    if (upStamp && upStamp !== this._lastUpStamp) {
      this._lastUpStamp = upStamp;
      const v = this._bps(e.upload);
      if (v !== undefined) {
        this._up = pushPoint(this._up, v, max);
        this._peakUp = Math.max(this._peakUp, v);
      }
    }
  }

  private async _prefill(): Promise<void> {
    const cfg = this._config;
    if (!this.hass || !cfg || this._prefilled) return;
    if (cfg.show_sparkline === false || cfg.show_throughput === false) return;
    const e = this._e;
    if (!e.download && !e.upload) return; // nothing discovered yet; try again next tick
    this._prefilled = true;
    const points = cfg.spark_points ?? DEFAULT_ROUTER_SPARK_POINTS;
    const minutes = cfg.spark_history_minutes ?? DEFAULT_ROUTER_SPARK_MINUTES;
    const [down, up] = await Promise.all([
      e.download ? prefillSeries(this.hass, e.download, points, minutes) : Promise.resolve([]),
      e.upload ? prefillSeries(this.hass, e.upload, points, minutes) : Promise.resolve([]),
    ]);
    // The live sampler may have appended a point or two while the round-trip
    // was out; the history ends where those begin, so they go after it.
    if (down.length) this._down = [...down, ...this._down].slice(-points);
    if (up.length) this._up = [...up, ...this._up].slice(-points);
    if (down.length) this._peakDown = Math.max(this._peakDown, ...down);
    if (up.length) this._peakUp = Math.max(this._peakUp, ...up);
  }

  // ---- language -------------------------------------------------------------

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey, vars?: Record<string, string | number>): string {
    let text = localize(key, this._language);
    if (vars) {
      for (const [k, v] of Object.entries(vars)) text = text.replace(`{${k}}`, String(v));
    }
    return text;
  }

  private _thresholds(
    configured: RouterThresholdConfig[] | undefined,
    fallback: typeof DEFAULT_RSRP_THRESHOLDS,
  ) {
    return configured?.length ? configured : fallback;
  }

  // ---- render ---------------------------------------------------------------

  protected render() {
    const cfg = this._config;
    if (!cfg || !this.hass) return nothing;

    const e = this._e;
    const common = resolveCommonColors(cfg);
    const link = linkStateOf(
      e.connection ? this.hass.states[e.connection]?.state : undefined,
      e.connection ? this.hass.states[e.connection]?.attributes.device_class : undefined,
    );
    const onlineCss = resolveThemeColor(cfg.online_color ?? ROUTER_COLOR_EXCELLENT);
    const offlineCss = resolveThemeColor(cfg.offline_color ?? ROUTER_COLOR_WEAK);
    const statusCss =
      link === "online" ? onlineCss : link === "offline" ? offlineCss : ROUTER_COLOR_OFFLINE;
    const accentCss = resolveThemeColor(cfg.accent_color ?? ROUTER_COLOR_ACCENT);

    const vars = buildCssVars({
      "m3r-text": common.textColorCss,
      "m3r-secondary-text": common.secondaryTextColorCss,
      "m3r-status": statusCss,
      "m3r-status-tint": tintOn(this, statusCss, undefined, ROUTER_SIGNAL_TINT),
      "m3r-status-ink": foregroundOn(statusCss, tintOn(this, statusCss, undefined, ROUTER_SIGNAL_TINT), 3, this),
      "m3r-accent": accentCss,
      "ha-card-background": common.cardBackgroundCss,
      "m3r-radius": resolveCornerRadius(cfg.radius ?? DEFAULT_ROUTER_RADIUS, cfg.corners),
    });

    const name = cfg.name ?? this._defaultName();
    const offline = link === "offline";

    return html`
      <ha-card style=${vars} class=${offline ? "offline" : ""}>
        <div class="card-inner ${glassCardClass(cfg.glass_background)}">
          ${this._renderHeader(name, link)}
          ${cfg.show_signal === false ? nothing : this._renderSignal()}
          ${cfg.show_throughput === false ? nothing : this._renderThroughput()}
          ${cfg.show_data === false ? nothing : this._renderData()}
        </div>
      </ha-card>
    `;
  }

  /**
   * The connection entity's own name is the wrong default: it is named after
   * what it measures, not after the device — "ZTE TCP erreichbar" is a fine
   * sensor name and a poor card title. The shared prefix is what the entities
   * agree the router is called, so it wins when there is one.
   */
  private _defaultName(): string {
    const prefix = this._config?.entity_prefix ?? guessRouterPrefix(Object.keys(this.hass?.states ?? {}));
    if (prefix) return `${prefix.toUpperCase()} Router`;
    const e = this._e;
    const friendly = e.connection ? this.hass?.states[e.connection]?.attributes.friendly_name : undefined;
    return friendly ? String(friendly) : "Router";
  }

  /** "Verbunden · LTE B3 + n1" — whichever parts exist. */
  private _subtitle(link: "online" | "offline" | "unknown"): string {
    const cfg = this._config!;
    const e = this._e;
    if (link === "offline") return this._t("router_disconnected");
    if (link === "unknown") return this._t("router_unknown");
    const bands = [this._str(e.band), this._str(e.nrBand)]
      .filter((b): b is string => !!b)
      .map((b) => tidyValue(b, cfg.value_map));
    const parts = [this._t("router_connected")];
    if (bands.length) parts.push(bands.join(" + "));
    else {
      const type = this._str(e.networkType);
      if (type) parts.push(tidyValue(type, cfg.value_map));
    }
    return parts.join(" · ");
  }

  private _renderHeader(name: string, link: "online" | "offline" | "unknown") {
    const cfg = this._config!;
    const label =
      link === "online"
        ? this._t("router_online")
        : link === "offline"
          ? this._t("router_offline")
          : this._t("router_unknown");
    const icon =
      link === "offline" ? "mdi:router-wireless-off" : (cfg.icon ?? DEFAULT_ROUTER_ICON);
    return html`
      <div
        class="m3-header"
        role="button"
        tabindex="0"
        aria-label=${name}
        @click=${this._onHeaderTap}
        @keydown=${activateOnKey(this._onHeaderTap)}
      >
        <div class="router-swatch"><ha-icon icon=${icon}></ha-icon></div>
        <div class="m3-text-block">
          <div class="m3-name">${name}</div>
          <div class="m3-subtitle status">${this._subtitle(link)}</div>
        </div>
        <div class="status-chip">
          <ha-icon icon=${link === "online" ? "mdi:check" : "mdi:close"}></ha-icon>
          <span>${label}</span>
        </div>
      </div>
    `;
  }

  private readonly _onHeaderTap = (ev: Event) => {
    ev.stopPropagation();
    handleAction(this, this.hass, this._config?.tap_action, this._e.connection);
  };

  // ---- signal ---------------------------------------------------------------

  private _renderSignal() {
    const cfg = this._config!;
    const e = this._e;
    const lte = normalizeNegativeDb(this._num(e.rsrp));
    const nr = normalizeNegativeDb(this._num(e.nrRsrp));

    // A fibre line has no RSRP at all; what it has is an optical receive
    // level, which is the same question asked of a different medium. It only
    // takes over when there is no radio, so a 5G router that happens to expose
    // an SFP is still graded on its radio.
    if (lte === undefined && nr === undefined) return this._renderOpticalSignal();

    const primaryIsNr = lte === undefined;
    const value = primaryIsNr ? nr! : lte!;
    const grade = gradeBy(
      value,
      this._thresholds(
        primaryIsNr ? cfg.nr_rsrp_thresholds : cfg.rsrp_thresholds,
        primaryIsNr ? DEFAULT_NR_RSRP_THRESHOLDS : DEFAULT_RSRP_THRESHOLDS,
      ),
    );

    const showSecond =
      cfg.show_nr_signal !== false && !primaryIsNr && nr !== undefined;

    return html`
      ${this._renderSignalWell(value, grade, primaryIsNr ? "5G" : "LTE", !showSecond)}
      ${showSecond
        ? this._renderSignalWell(
            nr!,
            gradeBy(nr!, this._thresholds(cfg.nr_rsrp_thresholds, DEFAULT_NR_RSRP_THRESHOLDS)),
            "5G",
            true,
          )
        : nothing}
      ${cfg.show_signal_details === false ? nothing : this._renderSignalChips()}
    `;
  }

  /**
   * The fibre equivalent of the radio block: optical receive power, graded
   * against a window rather than a ramp, with the transmit level as a chip
   * beside it.
   */
  private _renderOpticalSignal() {
    const cfg = this._config!;
    const rx = this._num(this._e.opticalRx);
    if (rx === undefined) return nothing;
    const grade = gradeOptical(
      rx,
      cfg.optical_rx_thresholds?.length ? cfg.optical_rx_thresholds : DEFAULT_OPTICAL_RX_THRESHOLDS,
      cfg.optical_rx_max ?? OPTICAL_RX_MAX_DBM,
    );
    const tx = this._num(this._e.opticalTx);
    return html`
      ${this._renderSignalWell(rx, grade, "RX", true, "dBm RX")}
      ${cfg.show_signal_details === false || tx === undefined
        ? nothing
        : html`<div class="chips">
            <div class="chip">
              <span class="chip-label">TX</span>
              <span class="chip-value"
                >${withMinusSign(formatNumber(this._language, tx, { maximumFractionDigits: 1 }))} dBm</span
              >
            </div>
          </div>`}
    `;
  }

  /**
   * One graded well: bars, verdict, raw value.
   *
   * `compact` halves the vertical padding and drops the bar heights — used by
   * the second well on an NSA connection, where two full-height blocks would
   * push everything else off a four-row card.
   */
  private _renderSignalWell(
    value: number,
    grade: SignalGrade,
    tech: string,
    compact: boolean,
    unitCaption?: string,
  ) {
    const colorCss = GRADE_COLORS[grade];
    const filled = GRADE_BARS[grade];
    const scale = compact ? 0.68 : 1;
    const width = ROUTER_BAR_COUNT * ROUTER_BAR_WIDTH + (ROUTER_BAR_COUNT - 1) * ROUTER_BAR_GAP;
    const height = ROUTER_BAR_HEIGHTS[ROUTER_BAR_COUNT - 1];
    const label = this._t(GRADE_LABELS[grade]);
    const style = buildCssVars({
      "m3r-grade": colorCss,
      "m3r-grade-tint": tintOn(this, colorCss, undefined, ROUTER_SIGNAL_TINT),
    });

    return html`
      <div class="signal ${compact ? "compact" : ""}" style=${style}>
        <svg
          class="bars"
          width=${(width * scale).toFixed(1)}
          height=${(height * scale).toFixed(1)}
          viewBox="0 0 ${width} ${height}"
          aria-hidden="true"
        >
          ${ROUTER_BAR_HEIGHTS.map(
            (h, i) => svg`
              <rect
                x=${i * (ROUTER_BAR_WIDTH + ROUTER_BAR_GAP)}
                y=${height - h}
                width=${ROUTER_BAR_WIDTH}
                height=${h}
                rx=${ROUTER_BAR_RADIUS}
                class=${i < filled ? "on" : "off"}
              ></rect>`,
          )}
        </svg>
        <div class="signal-text">
          <div class="signal-label">${this._t("router_signal_quality")}${compact ? ` · ${tech}` : nothing}</div>
          <div class="signal-grade">${label}</div>
        </div>
        <div class="signal-value">
          <div class="signal-dbm">${withMinusSign(formatNumber(this._language, value, { maximumFractionDigits: 0 }))}</div>
          <div class="signal-unit">${unitCaption ?? `dBm ${compact ? "" : `${tech} `}RSRP`}</div>
        </div>
      </div>
    `;
  }

  private _renderSignalChips() {
    const cfg = this._config!;
    const e = this._e;
    const chips: Array<{ label: string; value: string; colorCss?: string }> = [];

    const rsrq = normalizeNegativeDb(this._num(e.rsrq));
    if (rsrq !== undefined) {
      chips.push({
        label: "RSRQ",
        value: `${withMinusSign(String(rsrq))} dB`,
        colorCss: GRADE_COLORS[gradeBy(rsrq, this._thresholds(cfg.rsrq_thresholds, DEFAULT_RSRQ_THRESHOLDS))],
      });
    }
    const snr = this._num(e.snr);
    if (snr !== undefined) {
      chips.push({
        label: "SNR",
        value: `${withMinusSign(formatNumber(this._language, snr, { maximumFractionDigits: 1 }))} dB`,
        colorCss: GRADE_COLORS[gradeBy(snr, this._thresholds(cfg.snr_thresholds, DEFAULT_SNR_THRESHOLDS))],
      });
    }
    const nrSnr = this._num(e.nrSnr);
    if (nrSnr !== undefined && e.nrSnr !== e.snr) {
      chips.push({
        label: "SINR 5G",
        value: `${withMinusSign(formatNumber(this._language, nrSnr, { maximumFractionDigits: 1 }))} dB`,
        colorCss: GRADE_COLORS[gradeBy(nrSnr, this._thresholds(cfg.snr_thresholds, DEFAULT_SNR_THRESHOLDS))],
      });
    }
    const cell = this._str(e.cellId);
    if (cell) chips.push({ label: this._t("router_cell"), value: cell });

    if (!chips.length) return nothing;

    return html`
      <div class="chips">
        ${chips.map(
          (c) => html`
            <div class="chip">
              <span class="chip-label">${c.label}</span>
              <span class="chip-value" style=${c.colorCss ? `color:${c.colorCss}` : nothing}>${c.value}</span>
            </div>
          `,
        )}
      </div>
    `;
  }

  // ---- throughput -----------------------------------------------------------

  private _renderThroughput() {
    const e = this._e;
    if (!e.download && !e.upload) return nothing;
    const cfg = this._config!;
    const downCss = resolveThemeColor(cfg.download_color ?? ROUTER_COLOR_DOWNLOAD);
    const upCss = resolveThemeColor(cfg.upload_color ?? ROUTER_COLOR_UPLOAD);

    return html`
      <div class="section-label">${this._t("router_throughput")}</div>
      <div class="rates">
        ${e.download
          ? this._renderRate(this._bps(e.download), downCss, "mdi:arrow-down", this._t("router_download"), this._down, this._peakDown)
          : nothing}
        ${e.upload
          ? this._renderRate(this._bps(e.upload), upCss, "mdi:arrow-up", this._t("router_upload"), this._up, this._peakUp)
          : nothing}
      </div>
    `;
  }

  private _renderRate(
    bps: number | undefined,
    colorCss: string,
    icon: string,
    label: string,
    series: readonly number[],
    peak: number,
  ) {
    const cfg = this._config!;
    const style = buildCssVars({
      "m3r-rate": colorCss,
      "m3r-rate-tint": tintOn(this, colorCss, undefined, ROUTER_TILE_TINT),
    });
    const scaled = bps === undefined ? undefined : scaleThroughput(bps);
    const path =
      cfg.show_sparkline === false
        ? ""
        : sparklinePath(series, ROUTER_SPARK_WIDTH, ROUTER_SPARK_HEIGHT);
    const peakScaled = peak > 0 ? scaleThroughput(peak) : undefined;

    return html`
      <div class="rate" style=${style}>
        <div class="rate-head">
          <ha-icon icon=${icon}></ha-icon>
          <span>${label}</span>
          ${cfg.peak_chip && peakScaled
            ? html`<span class="peak"
                >${this._t("router_peak")}
                ${formatNumber(this._language, peakScaled.value, {
                  maximumFractionDigits: throughputDecimals(peakScaled.value),
                  minimumFractionDigits: throughputDecimals(peakScaled.value),
                })}
                ${peakScaled.unit}</span
              >`
            : nothing}
        </div>
        <div class="rate-value">
          ${scaled
            ? html`<span class="rate-number"
                  >${formatNumber(this._language, scaled.value, {
                    maximumFractionDigits: throughputDecimals(scaled.value),
                    minimumFractionDigits: throughputDecimals(scaled.value),
                  })}</span
                ><span class="rate-unit">${scaled.unit}</span>`
            : html`<span class="rate-number dim">–</span>`}
        </div>
        ${path
          ? html`
              <svg
                class="spark"
                viewBox="0 0 ${ROUTER_SPARK_WIDTH} ${ROUTER_SPARK_HEIGHT}"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path d=${path} fill="none" stroke-width=${ROUTER_SPARK_STROKE} stroke-linecap="round" stroke-linejoin="round"></path>
              </svg>
            `
          : nothing}
      </div>
    `;
  }

  // ---- data volume ----------------------------------------------------------

  private _renderData() {
    const cfg = this._config!;
    const e = this._e;
    const down = this._gb(e.dataDown);
    const up = this._gb(e.dataUp);
    const totalEntity = this._gb(e.dataTotal);
    const split = splitVolume(down, up);
    const total = totalEntity ?? split?.total;
    if (total === undefined) return nothing;

    const downCss = resolveThemeColor(cfg.download_color ?? ROUTER_COLOR_DOWNLOAD);
    const upCss = resolveThemeColor(cfg.upload_color ?? ROUTER_COLOR_UPLOAD);
    const month = new Intl.DateTimeFormat(this._language, { month: "long" }).format(new Date());
    const limit = cfg.data_limit;

    const accentCss =
      limit && limit > 0
        ? limitGrade(total, limit) === "critical"
          ? ROUTER_COLOR_WEAK
          : limitGrade(total, limit) === "warn"
            ? ROUTER_COLOR_FAIR
            : resolveThemeColor(cfg.accent_color ?? ROUTER_COLOR_ACCENT)
        : resolveThemeColor(cfg.accent_color ?? ROUTER_COLOR_ACCENT);

    return html`
      <div class="volume">
        <div class="volume-head">
          <span class="volume-label">${this._t("router_data_volume", { month })}</span>
          <span class="volume-total" style="color:${accentCss}">${formatGigabytes(this._language, total)}</span>
        </div>
        ${limit && limit > 0
          ? this._renderLimitBar(total, limit, accentCss)
          : this._renderSplitBar(split, downCss, upCss)}
      </div>
    `;
  }

  private _renderSplitBar(
    split: ReturnType<typeof splitVolume>,
    downCss: string,
    upCss: string,
  ) {
    if (!split) return nothing;
    return html`
      <div class="bar-split">
        <div class="bar-part" style="flex:${split.downShare};background:${downCss}"></div>
        <div class="bar-part" style="flex:${split.upShare};background:${upCss}"></div>
      </div>
      <div class="legend">
        <span class="legend-item"
          ><i style="background:${downCss}"></i
          >${this._t("router_data_down", { value: formatGigabytes(this._language, split.down) })}</span
        >
        <span class="legend-item"
          ><i style="background:${upCss}"></i
          >${this._t("router_data_up", { value: formatGigabytes(this._language, split.up) })}</span
        >
      </div>
    `;
  }

  private _renderLimitBar(total: number, limit: number, accentCss: string) {
    const share = Math.min(1, total / limit);
    const remaining = limit - total;
    return html`
      <div class="bar-track">
        <div class="bar-fill" style="width:${(share * 100).toFixed(1)}%;background:${accentCss}"></div>
      </div>
      <div class="legend">
        <span class="legend-item">${formatGigabytes(this._language, limit, 0)}</span>
        <span class="legend-item" style="color:${accentCss}">
          ${remaining >= 0
            ? this._t("router_data_remaining", { value: formatGigabytes(this._language, remaining) })
            : this._t("router_data_over_limit", { value: formatGigabytes(this._language, -remaining) })}
        </span>
      </div>
    `;
  }

  static styles = [
    glassCardStyles,
    cardHeaderStyles,
    css`
      ha-card {
        color: var(--m3r-text, var(--primary-text-color));
        border-radius: var(--m3r-radius, 28px);
      }

      .card-inner {
        gap: 10px;
      }

      /* Offline: the radio and the rate are stale, the month's volume is not.
         Dimming the whole card would hide the one number still worth reading. */
      ha-card.offline .signal,
      ha-card.offline .rates,
      ha-card.offline .chips {
        opacity: 0.45;
      }

      .router-swatch {
        flex-shrink: 0;
        width: ${ROUTER_HEADER_ICON_SIZE}px;
        height: ${ROUTER_HEADER_ICON_SIZE}px;
        border-radius: ${ROUTER_HEADER_ICON_RADIUS}px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--m3r-status-tint);
        color: var(--m3r-status);
      }

      .router-swatch ha-icon {
        --mdc-icon-size: 24px;
      }

      .m3-subtitle.status {
        color: var(--m3r-status);
        opacity: 1;
        font-weight: 500;
      }

      .status-chip {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: ${ROUTER_CHIP_HEIGHT}px;
        padding: 0 12px;
        border-radius: ${ROUTER_CHIP_RADIUS}px;
        background: var(--m3r-status-tint);
        color: var(--m3r-status-ink);
        font-size: 12px;
        font-weight: 700;
      }

      .status-chip ha-icon {
        --mdc-icon-size: 15px;
      }

      /* ---- signal ---- */

      .signal {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: ${ROUTER_SIGNAL_PADDING}px;
        border-radius: ${ROUTER_SIGNAL_RADIUS}px;
        background: var(--m3r-grade-tint);
      }

      .signal.compact {
        padding: 8px ${ROUTER_SIGNAL_PADDING}px;
      }

      .bars rect.on {
        fill: var(--m3r-grade);
      }

      .bars rect.off {
        fill: rgba(255, 255, 255, 0.14);
      }

      .signal-text {
        flex: 1;
        min-width: 0;
      }

      .signal-label {
        font-size: 11px;
        opacity: 0.6;
        color: var(--m3r-secondary-text);
      }

      .signal-grade {
        font-size: 19px;
        font-weight: 700;
        color: var(--m3r-grade);
        line-height: 1.15;
      }

      .signal.compact .signal-grade {
        font-size: 15px;
      }

      .signal-value {
        text-align: right;
        flex-shrink: 0;
      }

      .signal-dbm {
        font-size: 18px;
        font-weight: 700;
        color: var(--m3r-grade);
        font-variant-numeric: tabular-nums;
        line-height: 1.1;
      }

      .signal.compact .signal-dbm {
        font-size: 15px;
      }

      .signal-unit {
        font-size: 9px;
        opacity: 0.6;
        color: var(--m3r-secondary-text);
        white-space: nowrap;
      }

      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: ${ROUTER_CHIP_HEIGHT}px;
        padding: 0 11px;
        border-radius: ${ROUTER_CHIP_RADIUS}px;
        background: rgba(128, 128, 128, 0.16);
      }

      .chip-label {
        font-size: 11px;
        opacity: 0.6;
        color: var(--m3r-secondary-text);
      }

      .chip-value {
        font-size: 12px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        color: var(--m3r-text);
      }

      /* ---- throughput ---- */

      .section-label {
        font-size: 12px;
        opacity: 0.6;
        color: var(--m3r-secondary-text);
        margin-top: 2px;
      }

      .rates {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      .rate {
        position: relative;
        padding: ${ROUTER_TILE_PADDING_V}px ${ROUTER_TILE_PADDING_H}px;
        border-radius: ${ROUTER_TILE_RADIUS}px;
        background: var(--m3r-rate-tint);
        min-width: 0;
        overflow: hidden;
      }

      .rate-head {
        display: flex;
        align-items: center;
        gap: 5px;
        color: var(--m3r-rate);
        font-size: 10px;
        font-weight: 600;
      }

      .rate-head ha-icon {
        --mdc-icon-size: 13px;
      }

      .peak {
        margin-left: auto;
        opacity: 0.75;
        font-weight: 500;
        white-space: nowrap;
      }

      .rate-value {
        display: flex;
        align-items: baseline;
        gap: 3px;
        margin-top: 2px;
      }

      .rate-number {
        font-size: 20px;
        font-weight: 700;
        color: var(--m3r-rate);
        font-variant-numeric: tabular-nums;
        line-height: 1.1;
      }

      .rate-number.dim {
        opacity: 0.5;
      }

      .rate-unit {
        font-size: 11px;
        color: var(--m3r-text);
        opacity: 0.75;
      }

      .spark {
        display: block;
        width: 100%;
        height: ${ROUTER_SPARK_HEIGHT}px;
        margin-top: 4px;
      }

      .spark path {
        stroke: var(--m3r-rate);
        /* preserveAspectRatio: none stretches the stroke with the box, so the
           line would thin out on a wide card and thicken on a narrow one. */
        vector-effect: non-scaling-stroke;
      }

      /* ---- data volume ---- */

      .volume {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .volume-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
      }

      .volume-label {
        font-size: 12px;
        opacity: 0.6;
        color: var(--m3r-secondary-text);
      }

      .volume-total {
        font-size: 13px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }

      .bar-split {
        display: flex;
        gap: ${ROUTER_VOLUME_BAR_GAP}px;
        height: ${ROUTER_VOLUME_BAR_HEIGHT}px;
      }

      .bar-part {
        border-radius: ${ROUTER_VOLUME_BAR_RADIUS}px;
        min-width: 4px;
      }

      .bar-track {
        height: ${ROUTER_VOLUME_BAR_HEIGHT}px;
        border-radius: ${ROUTER_VOLUME_BAR_RADIUS}px;
        background: rgba(128, 128, 128, ${ROUTER_VOLUME_TRACK_TINT / 100});
        overflow: hidden;
      }

      .bar-fill {
        height: 100%;
        border-radius: ${ROUTER_VOLUME_BAR_RADIUS}px;
      }

      .legend {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        font-size: 11px;
        color: var(--m3r-secondary-text);
        opacity: 0.85;
      }

      .legend-item {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .legend-item i {
        width: ${ROUTER_LEGEND_SWATCH}px;
        height: ${ROUTER_LEGEND_SWATCH}px;
        border-radius: 50%;
        display: inline-block;
      }

      @media (max-width: 380px) {
        .rates {
          grid-template-columns: 1fr;
        }
      }

      /* Safari 15 and anything else without color-mix: the tints above resolve
         to unset, which paints a transparent well rather than a faded one.
         Backticks are not allowed in here: this is a css template literal. */
      @supports not (color: color-mix(in srgb, red 50%, blue)) {
        .signal {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .rate {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .router-swatch {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .status-chip {
          background: var(--ha-card-background, var(--card-background-color));
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-router-card": M3RouterCard;
  }
}

const windowWithCards = window as unknown as Window & {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-router-card",
  name: "M3 Router Card",
  description:
    "Verbindung, Signalqualität, Durchsatz und Datenvolumen eines LTE-/5G-Routers — mit einer Bewertung statt nur Rohwerten.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
