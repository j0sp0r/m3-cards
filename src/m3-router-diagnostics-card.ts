import { LitElement, html, css, unsafeCSS, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  M3RouterDiagnosticsCardConfig,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  RouterCheckConfig,
  RouterInfoConfig,
  RouterTemperatureConfig,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_ROUTER_CONFIRM_TIMEOUT,
  DEFAULT_ROUTER_DIAG_ICON,
  DEFAULT_ROUTER_RADIUS,
  DEFAULT_ROUTER_TEMP_HOT,
  DEFAULT_ROUTER_TEMP_MAX,
  DEFAULT_ROUTER_TEMP_WARN,
  ROUTER_CHECK_COLUMNS,
  ROUTER_CHECK_ICON_RADIUS,
  ROUTER_CHECK_ICON_SIZE,
  ROUTER_CHECK_TILE_PADDING_H,
  ROUTER_CHECK_TILE_PADDING_V,
  ROUTER_CHECK_TILE_RADIUS,
  ROUTER_CHECK_TILE_TINT,
  ROUTER_CHIP_HEIGHT,
  ROUTER_CHIP_RADIUS,
  ROUTER_COLOR_EXCELLENT,
  ROUTER_COLOR_FAIR,
  ROUTER_COLOR_OFFLINE,
  ROUTER_COLOR_WEAK,
  ROUTER_DIAG_ICON_RADIUS,
  ROUTER_DIAG_ICON_SIZE,
  ROUTER_INFO_CELL_PADDING_H,
  ROUTER_INFO_CELL_PADDING_V,
  ROUTER_INFO_CELL_RADIUS,
  ROUTER_INFO_CELL_TINT,
  ROUTER_REBOOT_HEIGHT,
  ROUTER_REBOOT_RADIUS,
  ROUTER_REBOOT_RADIUS_ARMED,
  ROUTER_REBOOT_TINT,
  ROUTER_REBOOT_WAIT_MS,
  ROUTER_TEMP_BAR_HEIGHT,
  ROUTER_TEMP_BAR_RADIUS,
  ROUTER_TEMP_ICON_RADIUS,
  ROUTER_TEMP_ICON_SIZE,
  ROUTER_TEMP_ROW_HEIGHT,
  ROUTER_TEMP_ROW_RADIUS,
  ROUTER_TEMP_ROW_TINT,
  resolveCornerRadius,
  THEME_PRIMARY,
} from "./const";
import {
  buildCssVars,
  foregroundOn,
  inkOn,
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
import { STANDARD_EASING, shouldAnimate } from "./shared/animation";
import {
  discoverRouterEntities,
  discoverTemperatureEntities,
  discoverThrottleEntities,
  gradeTemp,
  guessRouterPrefix,
  isWarnValue,
  linkStateOf,
  normalizeTempUnit,
  throttleStateOf,
  tidyValue,
  type RouterSlot,
  type TempGrade,
} from "./shared/router";

console.info(
  `%c M3-ROUTER-DIAGNOSTICS-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #85b7eb; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #85b7eb; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

/** Which colour a temperature grade paints in. */
const TEMP_COLORS: Record<TempGrade, string> = {
  ok: "#85b7eb",
  warn: ROUTER_COLOR_FAIR,
  hot: ROUTER_COLOR_WEAK,
};

type RebootPhase = "idle" | "armed" | "running";

@customElement("m3-router-diagnostics-card")
export class M3RouterDiagnosticsCard
  extends TemplatedCard(LitElement)
  implements LovelaceCard
{
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() protected _config?: M3RouterDiagnosticsCardConfig;
  @state() private _found: Partial<Record<RouterSlot, string>> = {};
  @state() private _temps: string[] = [];
  @state() private _throttles: string[] = [];
  @state() private _reboot: RebootPhase = "idle";

  private _armTimer?: number;
  private _rebootTimer?: number;

  public setConfig(config: M3RouterDiagnosticsCardConfig): void {
    this._config = {
      auto_discover: true,
      show_temperatures: true,
      show_throttle: true,
      show_info: true,
      show_checks: true,
      show_reboot: true,
      confirm_reboot: true,
      confirm_timeout: DEFAULT_ROUTER_CONFIRM_TIMEOUT,
      temp_warn: DEFAULT_ROUTER_TEMP_WARN,
      temp_hot: DEFAULT_ROUTER_TEMP_HOT,
      temp_max: DEFAULT_ROUTER_TEMP_MAX,
      ...config,
    };
    this._found = {};
    this._disarm();
  }

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-router-diagnostics-card-editor");
    return document.createElement(
      "m3-router-diagnostics-card-editor",
    ) as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(hass?: HomeAssistant): Partial<M3RouterDiagnosticsCardConfig> {
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
    return 6;
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: "full", min_rows: 4 };
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._disarm();
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return hassChangeMatters(changed, this.hass, this._watched());
  }

  protected willUpdate(changed: PropertyValues): void {
    if (!this.hass || !this._config) return;
    if (changed.has("hass") || changed.has("_config")) this._discover();
    this._watchRebootFinish();
  }

  // ---- entities -------------------------------------------------------------

  private _discover(): void {
    const cfg = this._config;
    if (!cfg || !this.hass) return;
    if (cfg.auto_discover === false) {
      if (Object.keys(this._found).length) this._found = {};
      return;
    }
    const ids = Object.keys(this.hass.states);
    const prefix = cfg.entity_prefix ?? guessRouterPrefix(ids);
    const found = discoverRouterEntities(ids, prefix);
    const same =
      Object.keys(found).length === Object.keys(this._found).length &&
      (Object.keys(found) as RouterSlot[]).every((k) => this._found[k] === found[k]);
    if (!same) this._found = found;

    const temps = discoverTemperatureEntities(this.hass, ids, prefix);
    if (temps.join("|") !== this._temps.join("|")) this._temps = temps;
    const throttles = discoverThrottleEntities(ids, prefix);
    if (throttles.join("|") !== this._throttles.join("|")) this._throttles = throttles;
  }

  private _temperatureRows(): RouterTemperatureConfig[] {
    const configured = this._config?.temperature_entities;
    if (configured?.length) return configured;
    return this._temps.map((entity) => ({ entity }));
  }

  private _throttleEntities(): string[] {
    return this._config?.throttle_entities?.length
      ? this._config.throttle_entities
      : this._throttles;
  }

  /** `info_entities` if given, else whatever the cell/band slots turned up. */
  private _infoRows(): RouterInfoConfig[] {
    const configured = this._config?.info_entities;
    if (configured?.length) return configured;
    const f = this._found;
    const c = this._config ?? ({} as M3RouterDiagnosticsCardConfig);
    const pairs: Array<[string | undefined, string]> = [
      [c.pci_entity ?? f.pci, "LTE PCI"],
      [c.nr_pci_entity ?? f.nr_pci, "5G PCI"],
      [c.band_entity ?? f.band, "Band"],
      [c.nr_band_entity ?? f.nr_band, "5G Band"],
      [c.carrier_aggregation_entity ?? f.carrier_aggregation, "Carrier Agg."],
      [c.cell_id_entity ?? f.cell_id, "Cell-ID"],
    ];
    return pairs
      .filter((p): p is [string, string] => !!p[0])
      .map(([entity, label]) => ({ entity, label }));
  }

  private _watched(): (string | undefined)[] {
    const cfg = this._config;
    return [
      cfg?.entity ?? this._found.connection,
      ...this._temperatureRows().map((t) => t.entity),
      ...this._throttleEntities(),
      ...this._infoRows().map((i) => i.entity),
      ...(cfg?.check_entities ?? []).map((c) => c.entity),
      cfg?.uptime_entity ?? this._found.uptime,
      cfg?.firmware_entity ?? this._found.firmware,
      cfg?.connected_devices_entity ?? this._found.connected_devices,
    ];
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

  private _friendly(entityId: string): string {
    return String(this.hass?.states[entityId]?.attributes.friendly_name ?? entityId);
  }

  // ---- verdict --------------------------------------------------------------

  /**
   * How many things are **wrong** — which is not the same as how many things
   * are highlighted.
   *
   * Carrier aggregation is the case that forced the distinction: it switches
   * itself off whenever the link is idle or the cell is busy, so it reads
   * `ca_deactivated` most of the time on a quiet connection. Colouring that
   * amber is useful; reporting "1 finding" in the header for it is crying
   * wolf, and a verdict that is always amber stops being a verdict.
   *
   * So the built-in vocabulary only colours. A value counts here when the
   * config named it in `warn_value`, i.e. when someone said for this router
   * that this value is a problem.
   */
  private _findings(): number {
    const cfg = this._config!;
    let n = 0;
    const warnAt = cfg.temp_warn ?? DEFAULT_ROUTER_TEMP_WARN;
    const hotAt = cfg.temp_hot ?? DEFAULT_ROUTER_TEMP_HOT;
    for (const row of this._temperatureRows()) {
      const v = this._num(row.entity);
      if (v !== undefined && gradeTemp(v, { warn: warnAt, hot: hotAt }) === "hot") n++;
    }
    if (this._throttleState().active) n++;
    for (const check of cfg.check_entities ?? []) {
      if (this._checkState(check) === "bad") n++;
    }
    for (const info of this._infoRows()) {
      if (!info.warn_value) continue;
      const raw = this._str(info.entity);
      if (raw !== undefined && raw === info.warn_value) n++;
    }
    return n;
  }

  private _throttleState() {
    return throttleStateOf(
      this._throttleEntities().map((entity) => ({
        name: this._shortThrottleName(entity),
        value: this._num(entity),
      })),
    );
  }

  /** `sensor.zte_therm_pa_level` → `PA`. */
  private _shortThrottleName(entityId: string): string {
    const object = entityId.slice(entityId.indexOf(".") + 1);
    const m = /(?:therm|throttle)_(.+?)_level$/i.exec(object);
    return (m?.[1] ?? object).replace(/_/g, " ").toUpperCase();
  }

  private _checkState(check: RouterCheckConfig): "ok" | "bad" | "unknown" {
    const raw = this._str(check.entity);
    if (raw === undefined) return "unknown";
    const ok = check.ok_state ?? "on";
    if (raw === ok) return "ok";
    // A check without an explicit ok_state is a binary_sensor, where anything
    // the link reader calls online counts — `connected` and `on` both occur.
    if (!check.ok_state && linkStateOf(raw) === "online") return "ok";
    return "bad";
  }

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

  // ---- reboot ---------------------------------------------------------------

  private _disarm(): void {
    if (this._armTimer) window.clearTimeout(this._armTimer);
    if (this._rebootTimer) window.clearTimeout(this._rebootTimer);
    this._armTimer = undefined;
    this._rebootTimer = undefined;
    this._reboot = "idle";
  }

  private readonly _onRebootTap = (ev: Event) => {
    ev.stopPropagation();
    const cfg = this._config;
    if (!cfg || this._reboot === "running") return;

    if (cfg.confirm_reboot !== false && this._reboot === "idle") {
      this._reboot = "armed";
      // Disarms itself rather than waiting for a second tap that may never
      // come — an armed red button left on a wall tablet is a trap.
      this._armTimer = window.setTimeout(
        () => {
          this._armTimer = undefined;
          if (this._reboot === "armed") this._reboot = "idle";
        },
        cfg.confirm_timeout ?? DEFAULT_ROUTER_CONFIRM_TIMEOUT,
      );
      return;
    }

    this._fireReboot();
  };

  private _fireReboot(): void {
    const cfg = this._config!;
    if (this._armTimer) window.clearTimeout(this._armTimer);
    this._armTimer = undefined;
    this._reboot = "running";
    const action = cfg.reboot_action ?? this._defaultRebootAction();
    if (action) handleAction(this, this.hass, action, undefined);
    // The connection entity coming back is what ends the wait; this is only
    // the backstop for a router that never returns, or one whose connection
    // entity the card does not have.
    this._rebootTimer = window.setTimeout(() => {
      this._rebootTimer = undefined;
      this._reboot = "idle";
    }, ROUTER_REBOOT_WAIT_MS);
  }

  /** A `button.*_restart` on the same prefix, when the config names nothing. */
  private _defaultRebootAction() {
    const cfg = this._config!;
    if (!this.hass) return undefined;
    const prefix = cfg.entity_prefix;
    const hit = Object.keys(this.hass.states).find((id) => {
      if (!id.startsWith("button.")) return false;
      const object = id.slice(7);
      if (prefix && !object.startsWith(`${prefix}_`)) return false;
      return /(?:^|_)(?:reboot|restart)(?:_[a-z0-9_]+)?$/i.test(object);
    });
    if (!hit) return undefined;
    return { action: "call-service" as const, service: "button.press", target: { entity_id: hit } };
  }

  /**
   * Ends the "restarting…" state when the link comes back.
   *
   * Watched rather than timed: a ZTE is back in about 50 seconds and a
   * Fritzbox in three minutes, and a fixed wait would be wrong for both.
   */
  private _watchRebootFinish(): void {
    if (this._reboot !== "running") return;
    const entity = this._config?.entity ?? this._found.connection;
    if (!entity) return;
    const link = linkStateOf(
      this.hass?.states[entity]?.state,
      this.hass?.states[entity]?.attributes.device_class,
    );
    if (link === "online") {
      if (this._rebootTimer) window.clearTimeout(this._rebootTimer);
      this._rebootTimer = undefined;
      this._reboot = "idle";
    }
  }

  // ---- render ---------------------------------------------------------------

  protected render() {
    const cfg = this._config;
    if (!cfg || !this.hass) return nothing;

    const common = resolveCommonColors(cfg);
    const okCss = resolveThemeColor(cfg.ok_color ?? ROUTER_COLOR_EXCELLENT);
    const warnCss = resolveThemeColor(cfg.warn_color ?? ROUTER_COLOR_FAIR);
    const hotCss = resolveThemeColor(cfg.hot_color ?? ROUTER_COLOR_WEAK);
    const findings = this._findings();
    const verdictCss = findings === 0 ? okCss : findings > 1 ? hotCss : warnCss;
    const accentCss = resolveThemeColor(cfg.accent_color ?? THEME_PRIMARY);

    const vars = buildCssVars({
      "m3r-text": common.textColorCss,
      "m3r-secondary-text": common.secondaryTextColorCss,
      "m3r-accent": accentCss,
      "m3r-accent-tint": tintOn(this, accentCss, undefined, ROUTER_TEMP_ROW_TINT * 2),
      "m3r-verdict": verdictCss,
      "m3r-verdict-tint": tintOn(this, verdictCss, undefined, 12),
      "m3r-verdict-ink": foregroundOn(verdictCss, tintOn(this, verdictCss, undefined, 12), 3, this),
      "m3r-ok": okCss,
      "m3r-warn": warnCss,
      "m3r-hot": hotCss,
      "m3r-hot-ink": inkOn(hotCss, this),
      "m3r-hot-tint": tintOn(this, hotCss, undefined, ROUTER_REBOOT_TINT),
      "ha-card-background": common.cardBackgroundCss,
      "m3r-radius": resolveCornerRadius(cfg.radius ?? DEFAULT_ROUTER_RADIUS, cfg.corners),
    });

    return html`
      <ha-card style=${vars}>
        <div class="card-inner ${glassCardClass(cfg.glass_background)} ${shouldAnimate(cfg.animation) ? "" : "no-animations"}">
          ${this._renderHeader(findings)}
          ${cfg.show_temperatures === false ? nothing : this._renderTemperatures()}
          ${cfg.show_throttle === false ? nothing : this._renderThrottle()}
          ${cfg.show_info === false ? nothing : this._renderInfo()}
          ${cfg.show_checks === false ? nothing : this._renderChecks()}
          ${cfg.show_reboot === false ? nothing : this._renderReboot()}
        </div>
      </ha-card>
    `;
  }

  private _renderHeader(findings: number) {
    const cfg = this._config!;
    const name = cfg.name ?? this._t("router_diagnostics");
    const subtitle =
      findings === 0
        ? this._t("router_diag_all_clear")
        : findings === 1
          ? this._t("router_diag_finding_one")
          : this._t("router_diag_findings", { n: findings });
    const chipText = findings === 0 ? this._t("router_diag_ok") : String(findings);

    const extras: Array<{ icon: string; text: string }> = [];
    if (cfg.show_uptime) {
      const v = this._str(cfg.uptime_entity ?? this._found.uptime);
      if (v) extras.push({ icon: "mdi:clock-outline", text: v });
    }
    if (cfg.show_firmware) {
      const v = this._str(cfg.firmware_entity ?? this._found.firmware);
      if (v) extras.push({ icon: "mdi:chip", text: v });
    }
    if (cfg.show_clients) {
      const v = this._str(cfg.connected_devices_entity ?? this._found.connected_devices);
      if (v) extras.push({ icon: "mdi:devices", text: v });
    }

    return html`
      <div class="m3-header">
        <div class="diag-swatch"><ha-icon icon=${cfg.icon ?? DEFAULT_ROUTER_DIAG_ICON}></ha-icon></div>
        <div class="m3-text-block">
          <div class="m3-name">${name}</div>
          <div class="m3-subtitle">${subtitle}</div>
        </div>
        <div class="verdict-chip">
          <ha-icon icon=${findings === 0 ? "mdi:shield-check-outline" : "mdi:alert-outline"}></ha-icon>
          <span>${chipText}</span>
        </div>
      </div>
      ${extras.length
        ? html`<div class="chips">
            ${extras.map(
              (x) => html`<div class="chip">
                <ha-icon icon=${x.icon}></ha-icon><span class="chip-value">${x.text}</span>
              </div>`,
            )}
          </div>`
        : nothing}
    `;
  }

  // ---- temperatures ---------------------------------------------------------

  private _renderTemperatures() {
    const rows = this._temperatureRows();
    const readable = rows.filter((r) => this._num(r.entity) !== undefined);
    if (!readable.length) return nothing;
    const cfg = this._config!;
    const warnAt = cfg.temp_warn ?? DEFAULT_ROUTER_TEMP_WARN;
    const hotAt = cfg.temp_hot ?? DEFAULT_ROUTER_TEMP_HOT;

    return html`
      <div class="section-label">${this._t("router_temperatures")}</div>
      <div class="temp-rows">
        ${readable.map((row) => {
          const value = this._num(row.entity)!;
          const max = row.max ?? cfg.temp_max ?? DEFAULT_ROUTER_TEMP_MAX;
          const grade = gradeTemp(value, { warn: warnAt, hot: hotAt });
          const colorCss = TEMP_COLORS[grade];
          const share = Math.max(0, Math.min(1, value / max));
          const style = buildCssVars({
            "m3r-temp": colorCss,
            "m3r-temp-tint": tintOn(this, colorCss, undefined, ROUTER_TEMP_ROW_TINT * 3),
          });
          const unit = normalizeTempUnit(
            this.hass?.states[row.entity]?.attributes.unit_of_measurement,
          );
          return html`
            <div
              class="temp-row"
              style=${style}
              role="button"
              tabindex="0"
              @click=${() => handleAction(this, this.hass, { action: "more-info" }, row.entity)}
              @keydown=${activateOnKey(() =>
                handleAction(this, this.hass, { action: "more-info" }, row.entity),
              )}
            >
              <div class="temp-icon"><ha-icon icon="mdi:thermometer"></ha-icon></div>
              <div class="temp-body">
                <div class="temp-name">${row.name ?? this._friendly(row.entity)}</div>
                <div class="temp-track">
                  <div class="temp-fill" style="width:${(share * 100).toFixed(1)}%"></div>
                </div>
              </div>
              <div class="temp-value">
                ${formatNumber(this._language, value, { maximumFractionDigits: 0 })} ${unit}
              </div>
            </div>
          `;
        })}
      </div>
    `;
  }

  /**
   * The throttle sensors as one chip.
   *
   * Never a graph: these read 0 the overwhelming majority of the time, and a
   * flat line at zero across 24 hours is a picture of nothing. The one bit
   * worth having is whether anything is throttling now, and which.
   */
  private _renderThrottle() {
    const entities = this._throttleEntities();
    if (!entities.length) return nothing;
    const state = this._throttleState();
    const names = entities.map((e) => this._shortThrottleName(e)).join("/");
    return html`
      <div class="chips">
        <div class="chip ${state.active ? "bad" : "good"}">
          <ha-icon icon=${state.active ? "mdi:speedometer-slow" : "mdi:engine-outline"}></ha-icon>
          <span class="chip-value"
            >${state.active
              ? this._t("router_throttle_active", { names: state.offenders.join(", ") })
              : this._t("router_throttle_none", { names })}</span
          >
        </div>
      </div>
    `;
  }

  // ---- cell & band ----------------------------------------------------------

  private _renderInfo() {
    const rows = this._infoRows().filter((r) => this._str(r.entity) !== undefined);
    if (!rows.length) return nothing;
    const cfg = this._config!;
    return html`
      <div class="section-label">${this._t("router_cell_and_band")}</div>
      <div class="info-grid">
        ${rows.map((row) => {
          const raw = this._str(row.entity)!;
          const warn = row.warn_value ? raw === row.warn_value : isWarnValue(raw);
          return html`
            <div
              class="info-cell"
              role="button"
              tabindex="0"
              @click=${() => handleAction(this, this.hass, { action: "more-info" }, row.entity)}
              @keydown=${activateOnKey(() =>
                handleAction(this, this.hass, { action: "more-info" }, row.entity),
              )}
            >
              <span class="info-label">${row.label ?? this._friendly(row.entity)}</span>
              <span class="info-value ${warn ? "warn" : ""}">${tidyValue(raw, cfg.value_map)}</span>
            </div>
          `;
        })}
      </div>
    `;
  }

  // ---- checks ---------------------------------------------------------------

  private _renderChecks() {
    const checks = this._config?.check_entities ?? [];
    if (!checks.length) return nothing;
    return html`
      <div class="section-label">${this._t("router_checks")}</div>
      <div class="check-grid">
        ${checks.map((check) => {
          const state = this._checkState(check);
          const colorCss =
            state === "ok" ? "var(--m3r-ok)" : state === "bad" ? "var(--m3r-hot)" : ROUTER_COLOR_OFFLINE;
          const icon =
            state === "ok" ? "mdi:check" : state === "bad" ? "mdi:close" : "mdi:help";
          return html`
            <div
              class="check-tile ${state}"
              style=${buildCssVars({ "m3r-check": colorCss })}
              role="button"
              tabindex="0"
              @click=${() => handleAction(this, this.hass, { action: "more-info" }, check.entity)}
              @keydown=${activateOnKey(() =>
                handleAction(this, this.hass, { action: "more-info" }, check.entity),
              )}
            >
              <div class="check-icon"><ha-icon icon=${icon}></ha-icon></div>
              <div class="check-name">${check.name ?? this._friendly(check.entity)}</div>
            </div>
          `;
        })}
      </div>
    `;
  }

  // ---- reboot ---------------------------------------------------------------

  private _renderReboot() {
    const phase = this._reboot;
    const label =
      phase === "running"
        ? this._t("router_rebooting")
        : phase === "armed"
          ? this._t("router_reboot_confirm")
          : this._t("router_reboot");
    return html`
      <button
        class="reboot ${phase}"
        type="button"
        aria-label=${label}
        ?disabled=${phase === "running"}
        @click=${this._onRebootTap}
      >
        <ha-icon class=${phase === "running" ? "spin" : ""} icon="mdi:restart"></ha-icon>
        <span>${label}</span>
      </button>
    `;
  }

  static styles = [
    glassCardStyles,
    cardHeaderStyles,
    css`
      /* Rounded on both: the frame is .card-inner's border, and ha-card's
         clip alone cut it away at the corners. */
      ha-card,
      .card-inner {
        border-radius: var(--m3r-radius, 28px);
      }

      ha-card {
        color: var(--m3r-text, var(--primary-text-color));
      }

      .card-inner {
        gap: 10px;
      }

      .diag-swatch {
        flex-shrink: 0;
        width: ${ROUTER_DIAG_ICON_SIZE}px;
        height: ${ROUTER_DIAG_ICON_SIZE}px;
        border-radius: ${ROUTER_DIAG_ICON_RADIUS}px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--m3r-accent-tint);
        color: var(--m3r-accent);
      }

      .diag-swatch ha-icon {
        --mdc-icon-size: 22px;
      }

      .verdict-chip {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: ${ROUTER_CHIP_HEIGHT}px;
        padding: 0 12px;
        border-radius: ${ROUTER_CHIP_RADIUS}px;
        background: var(--m3r-verdict-tint);
        color: var(--m3r-verdict-ink);
        font-size: 12px;
        font-weight: 700;
      }

      .verdict-chip ha-icon {
        --mdc-icon-size: 15px;
      }

      .section-label {
        font-size: 12px;
        opacity: 0.6;
        color: var(--m3r-secondary-text);
        margin-top: 2px;
      }

      /* ---- temperatures ---- */

      .temp-rows {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .temp-row {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: ${ROUTER_TEMP_ROW_HEIGHT}px;
        padding: 0 12px 0 9px;
        border-radius: ${ROUTER_TEMP_ROW_RADIUS}px;
        background: var(--m3r-temp-tint);
        cursor: pointer;
        transition: border-radius 140ms ${unsafeCSS(STANDARD_EASING)};
      }

      .temp-row:active {
        border-radius: 11px;
      }

      .temp-row:focus-visible {
        outline: 2px solid var(--m3r-temp);
        outline-offset: 2px;
      }

      .temp-icon {
        flex-shrink: 0;
        width: ${ROUTER_TEMP_ICON_SIZE}px;
        height: ${ROUTER_TEMP_ICON_SIZE}px;
        border-radius: ${ROUTER_TEMP_ICON_RADIUS}px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--m3r-temp-tint);
        color: var(--m3r-temp);
      }

      .temp-icon ha-icon {
        --mdc-icon-size: 15px;
      }

      .temp-body {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .temp-name {
        font-size: 11px;
        font-weight: 600;
        color: var(--m3r-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .temp-track {
        height: ${ROUTER_TEMP_BAR_HEIGHT}px;
        border-radius: ${ROUTER_TEMP_BAR_RADIUS}px;
        background: rgba(128, 128, 128, 0.22);
        overflow: hidden;
      }

      .temp-fill {
        height: 100%;
        border-radius: ${ROUTER_TEMP_BAR_RADIUS}px;
        background: var(--m3r-temp);
      }

      .temp-value {
        flex-shrink: 0;
        font-size: 13px;
        font-weight: 700;
        color: var(--m3r-temp);
        font-variant-numeric: tabular-nums;
      }

      /* ---- chips ---- */

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
        color: var(--m3r-text);
      }

      .chip ha-icon {
        --mdc-icon-size: 15px;
      }

      .chip-value {
        font-size: 12px;
        font-weight: 600;
      }

      .chip.good {
        color: var(--m3r-ok);
      }

      .chip.bad {
        color: var(--m3r-hot);
      }

      /* ---- cell & band ---- */

      .info-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
      }

      .info-cell {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: ${ROUTER_INFO_CELL_PADDING_V}px ${ROUTER_INFO_CELL_PADDING_H}px;
        border-radius: ${ROUTER_INFO_CELL_RADIUS}px;
        background: rgba(128, 128, 128, ${ROUTER_INFO_CELL_TINT / 100 + 0.08});
        cursor: pointer;
        min-width: 0;
      }

      .info-cell:focus-visible {
        outline: 2px solid var(--m3r-accent);
        outline-offset: 2px;
      }

      .info-label {
        font-size: 10px;
        opacity: 0.55;
        color: var(--m3r-secondary-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .info-value {
        font-size: 11px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        color: var(--m3r-text);
        white-space: nowrap;
      }

      .info-value.warn {
        color: var(--m3r-warn);
      }

      /* ---- checks ---- */

      .check-grid {
        display: grid;
        grid-template-columns: repeat(${ROUTER_CHECK_COLUMNS}, 1fr);
        gap: 6px;
      }

      .check-tile {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: ${ROUTER_CHECK_TILE_PADDING_V}px ${ROUTER_CHECK_TILE_PADDING_H}px;
        border-radius: ${ROUTER_CHECK_TILE_RADIUS}px;
        background: rgba(128, 128, 128, ${ROUTER_CHECK_TILE_TINT / 100 + 0.06});
        cursor: pointer;
        min-width: 0;
      }

      .check-tile:focus-visible {
        outline: 2px solid var(--m3r-check);
        outline-offset: 2px;
      }

      .check-icon {
        width: ${ROUTER_CHECK_ICON_SIZE}px;
        height: ${ROUTER_CHECK_ICON_SIZE}px;
        border-radius: ${ROUTER_CHECK_ICON_RADIUS}px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--m3r-check);
        /* Dark ink on a filled accent — the suite's rule everywhere. */
        color: #1c1c1c;
      }

      .check-icon ha-icon {
        --mdc-icon-size: 16px;
      }

      .check-name {
        font-size: 9px;
        font-weight: 600;
        color: var(--m3r-text);
        text-align: center;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 100%;
      }

      /* ---- reboot ---- */

      .reboot {
        width: 100%;
        height: ${ROUTER_REBOOT_HEIGHT}px;
        border: none;
        border-radius: ${ROUTER_REBOOT_RADIUS}px;
        background: var(--m3r-hot-tint);
        color: var(--m3r-hot);
        font-size: 15px;
        font-weight: 700;
        font-family: inherit;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        cursor: pointer;
        transition:
          border-radius 180ms ${unsafeCSS(STANDARD_EASING)},
          background-color 180ms ${unsafeCSS(STANDARD_EASING)},
          color 180ms ${unsafeCSS(STANDARD_EASING)};
      }

      /* animation: off, or the system asking for less motion */
      .no-animations .temp-row,
      .no-animations .reboot {
        transition: none;
      }
      .no-animations .reboot ha-icon.spin {
        animation: none;
      }

      /* Armed: the tint becomes the full colour and the pill squares off, so
         the second tap lands on something that plainly is not the first. */
      .reboot.armed {
        background: var(--m3r-hot);
        color: var(--m3r-hot-ink);
        border-radius: ${ROUTER_REBOOT_RADIUS_ARMED}px;
      }

      .reboot.running {
        cursor: default;
        opacity: 0.8;
      }

      .reboot ha-icon {
        --mdc-icon-size: 20px;
      }

      .reboot ha-icon.spin {
        animation: m3r-spin 1.1s linear infinite;
      }

      @keyframes m3r-spin {
        to {
          transform: rotate(360deg);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .reboot ha-icon.spin {
          animation: none;
        }
        .reboot {
          transition: none;
        }
      }

      @media (max-width: 380px) {
        .info-grid {
          grid-template-columns: 1fr;
        }
        .check-grid {
          grid-template-columns: repeat(2, 1fr);
        }
      }

      /* Safari 15 and anything else without color-mix: the tints resolve to
         unset, which paints transparent rather than faded.
         Backticks are not allowed in here: this is a css template literal. */
      @supports not (color: color-mix(in srgb, red 50%, blue)) {
        .diag-swatch {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .verdict-chip {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .temp-row {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .temp-icon {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .reboot {
          background: var(--ha-card-background, var(--card-background-color));
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-router-diagnostics-card": M3RouterDiagnosticsCard;
  }
}

const windowWithCards = window as unknown as Window & {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-router-diagnostics-card",
  name: "M3 Router Diagnostics Card",
  description:
    "Temperaturen, Throttling, Zell- und Banddaten, Erreichbarkeits-Prüfungen und ein Neustart-Knopf mit Rückfrage.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
