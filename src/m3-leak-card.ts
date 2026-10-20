import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  M3LeakCardConfig,
  LeakSensorConfig,
  LovelaceCard,
  LovelaceCardEditor,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_LEAK_RADIUS,
  DEFAULT_LEAK_ACCENT,
  DEFAULT_LEAK_ICON,
  LEAK_ALARM_COLOR,
  LEAK_STALE_COLOR,
  DEFAULT_LEAK_STALE_HOURS,
  DEFAULT_LEAK_BATTERY_WARN,
  DEFAULT_LEAK_BATTERY_CRITICAL,
  LEAK_ROW_HEIGHT,
  LEAK_ROW_RADIUS,
  LEAK_ROW_RADIUS_ACTIVE,
  LEAK_ICON_SIZE,
  LEAK_ICON_RADIUS,
  LEAK_ROW_GAP,
  LEAK_ICON_RULES,
  LEAK_DEFAULT_NAME_STRIP,
  LEAK_TICK_MS,
  LEAK_ARM_TIMEOUT_MS,
  resolveCornerRadius,
} from "./const";
import { resolveThemeColor, buildCssVars, resolveCommonColors , tintOn, foregroundOn, foregroundVars, tintBackground } from "./shared/color-config";
import { glassCardStyles, glassCardClass } from "./shared/glass-card";
import { shouldAnimate, isReducedMotion } from "./shared/animation";
import { renderListRow, listRowStyles , listRowSurface} from "./shared/list-row";
import { formatSince } from "./shared/formatting";
import { fireEvent } from "./shared/editor-helpers";
import { discoverLeakSensors } from "./shared/ha-registry";
import { localize, type TranslationKey } from "./localize";
import { discoveryChangeMatters } from "./shared/should-update";
import { TemplatedCard } from "./shared/templated-card";

console.info(
  `%c M3-LEAK-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #81c784; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #81c784; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

type LeakState = "ok" | "alarm" | "stale";
type RowState = "wet" | "dry" | "stale" | "unavailable";

interface LeakRow {
  entity: string;
  name: string;
  icon: string;
  rowState: RowState;
  lastUpdated?: string;
  battery?: number;
}

@customElement("m3-leak-card")
export class M3LeakCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3LeakCardConfig;
  @state() private _discovered: LeakSensorConfig[] = [];
  @state() private _expanded = false;
  /** Separate from _expanded: that one is "the all-OK list is open at all",
   *  this one is "show every row rather than the first few". */
  @state() private _showAll = false;
  @state() private _shutoffDone = false;
  @state() private _armShutoff = false;
  @state() private _now = Date.now();
  private _tick?: number;
  private _armTimer?: number;
  private _discoverKey = "";
  private _discoverInFlight = false;

  public setConfig(config: M3LeakCardConfig): void {
    this._config = config;
  }

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-leak-card-editor");
    return document.createElement("m3-leak-card-editor") as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(): M3LeakCardConfig {
    return { type: "custom:m3-leak-card", auto_discover: true, glass_background: true };
  }

  public getCardSize(): number {
    return 3;
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this._tick = window.setInterval(() => (this._now = Date.now()), LEAK_TICK_MS);
  }
  public disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._tick) clearInterval(this._tick);
    if (this._armTimer) clearTimeout(this._armTimer);
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("hass") || changed.has("_config")) this._maybeDiscover();
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }
  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  // ---- discovery -----------------------------------------------------------

  private async _maybeDiscover(): Promise<void> {
    if (!this.hass || !this._config) return;
    if (!(this._config.auto_discover ?? true)) return;
    const moisture = Object.keys(this.hass.states).filter(
      (id) => id.startsWith("binary_sensor.") && this.hass!.states[id]?.attributes?.device_class === "moisture",
    );
    const key = [
      moisture.join(","),
      (this._config.include_area ?? []).join(","),
      (this._config.exclude_entities ?? []).join(","),
    ].join("|");
    if (key === this._discoverKey || this._discoverInFlight) return;
    this._discoverInFlight = true;
    try {
      const found = await discoverLeakSensors(this.hass, {
        includeAreas: this._config.include_area,
        excludeEntities: this._config.exclude_entities,
      });
      this._discovered = found.map((f) => ({
        entity: f.entity,
        name: f.areaName ? `${f.areaName} · ${this._stripName(f.name)}` : this._stripName(f.name),
        battery_entity: f.batteryEntity,
      }));
      this._discoverKey = key;
    } finally {
      this._discoverInFlight = false;
    }
  }

  private _stripName(name: string): string {
    const patterns = this._config?.name_strip ?? LEAK_DEFAULT_NAME_STRIP;
    let out = name;
    for (const p of patterns) out = out.replace(new RegExp(p, "i"), "");
    return out.trim() || name;
  }

  private _iconFor(name: string, explicit?: string): string {
    if (explicit) return explicit;
    for (const [re, icon] of LEAK_ICON_RULES) if (re.test(name)) return icon;
    return DEFAULT_LEAK_ICON;
  }

  // ---- model ---------------------------------------------------------------

  private get _sensors(): LeakSensorConfig[] {
    const manual = this._config?.sensors ?? [];
    return manual.length ? manual : this._discovered;
  }

  private _batteryOf(cfg: LeakSensorConfig): number | undefined {
    const id = cfg.battery_entity;
    if (!id || !this.hass) return undefined;
    const v = parseFloat(this.hass.states[id]?.state ?? "");
    return isNaN(v) ? undefined : Math.round(v);
  }

  private _buildRows(): LeakRow[] {
    const hass = this.hass;
    if (!hass) return [];
    const staleMs = (this._config?.stale_hours ?? DEFAULT_LEAK_STALE_HOURS) * 3600_000;
    return this._sensors
      .filter((c) => c.entity)
      .map((c): LeakRow => {
        const st = hass.states[c.entity];
        const name = c.name || (st?.attributes?.friendly_name as string) || c.entity;
        const icon = this._iconFor(name, c.icon);
        let rowState: RowState;
        if (!st || st.state === "unavailable") rowState = "unavailable";
        else if (st.state === "on") rowState = "wet";
        else {
          const age = this._now - Date.parse(st.last_updated);
          rowState = age > staleMs ? "stale" : "dry";
        }
        return { entity: c.entity, name, icon, rowState, lastUpdated: st?.last_updated, battery: this._batteryOf(c) };
      });
  }

  private _cardState(rows: LeakRow[]): LeakState {
    if (rows.some((r) => r.rowState === "wet")) return "alarm";
    if (rows.some((r) => r.rowState === "stale" || r.rowState === "unavailable")) return "stale";
    return "ok";
  }

  private _sortRows(rows: LeakRow[]): LeakRow[] {
    const rank: Record<RowState, number> = { wet: 0, unavailable: 1, stale: 1, dry: 2 };
    return [...rows].sort((a, b) => rank[a.rowState] - rank[b.rowState]);
  }

  // ---- since text ----------------------------------------------------------

  private _since(iso?: string): string {
    return (
      formatSince(iso, {
        minutes: this._t("leak_since_minutes"),
        hours: this._t("leak_since_hours"),
        days: this._t("leak_since_days"),
      }, this._now) ?? "—"
    );
  }

  // Duration without the "vor" prefix, for "seit {t}" phrasing.
  private _duration(iso?: string): string {
    return (
      formatSince(iso, {
        minutes: this._t("leak_dur_minutes"),
        hours: this._t("leak_dur_hours"),
        days: this._t("leak_dur_days"),
      }, this._now) ?? "—"
    );
  }

  // ---- actions -------------------------------------------------------------

  private _shutoff(): void {
    const hass = this.hass;
    const valve = this._config?.valve_entity;
    if (!hass || !valve) return;
    if (this._config?.confirm_shutoff && !this._armShutoff) {
      this._armShutoff = true;
      if (this._armTimer) clearTimeout(this._armTimer);
      this._armTimer = window.setTimeout(() => {
        this._armShutoff = false;
        this._armTimer = undefined;
      }, LEAK_ARM_TIMEOUT_MS);
      return;
    }
    const [domain] = valve.split(".");
    const call =
      domain === "valve"
        ? ["valve", "close_valve"]
        : domain === "cover"
          ? ["cover", "close_cover"]
          : ["switch", "turn_off"];
    hass
      .callService(call[0], call[1], { entity_id: valve })
      .then(() => {
        this._shutoffDone = true;
        this._armShutoff = false;
      })
      .catch(() => undefined);
  }

  private _ack(): void {
    const hass = this.hass;
    if (!hass) return;
    const siren = this._config?.siren_entity;
    const ack = this._config?.ack_entity;
    if (siren) {
      const [domain] = siren.split(".");
      hass.callService(domain === "siren" ? "siren" : "switch", "turn_off", { entity_id: siren }).catch(() => undefined);
    }
    if (ack) hass.callService("input_boolean", "turn_on", { entity_id: ack }).catch(() => undefined);
  }

  private _moreInfo(entity: string): void {
    fireEvent(this, "hass-more-info", { entityId: entity });
  }

  private _setTestDate(): void {
    const ent = this._config?.last_test_entity;
    if (!ent || !this.hass) return;
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const datetime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    this.hass.callService("input_datetime", "set_datetime", { entity_id: ent, datetime }).catch(() => undefined);
  }

  // ---- render helpers ------------------------------------------------------

  private _batteryChip(battery: number | undefined): unknown {
    if (battery === undefined) return nothing;
    const warn = this._config?.battery_warn ?? DEFAULT_LEAK_BATTERY_WARN;
    const crit = this._config?.battery_critical ?? DEFAULT_LEAK_BATTERY_CRITICAL;
    const cls = battery <= crit ? "crit" : battery <= warn ? "warn" : "ok";
    return html`<span class="bat ${cls}"><ha-icon icon="mdi:battery"></ha-icon>${battery}</span>`;
  }

  private _renderRow(r: LeakRow): unknown {
    const staleAge =
      r.rowState === "stale" && r.lastUpdated
        ? this._t("leak_reported_since").replace("{t}", this._since(r.lastUpdated))
        : r.rowState === "unavailable"
          ? this._t("leak_unreachable")
          : r.lastUpdated
            ? this._t("leak_reported_since").replace("{t}", this._since(r.lastUpdated))
            : "";
    const statusLabel =
      r.rowState === "wet"
        ? this._t("leak_status_wet")
        : r.rowState === "unavailable"
          ? this._t("leak_status_unavailable")
          : this._t("leak_status_dry");
    const iconColor =
      r.rowState === "wet" ? LEAK_ALARM_COLOR : r.rowState === "stale" || r.rowState === "unavailable" ? LEAK_STALE_COLOR : "var(--m3p-secondary-text)";
    const extraClass = r.rowState === "wet" ? "row-wet" : r.rowState === "stale" || r.rowState === "unavailable" ? "row-stale" : "";
    return renderListRow({
      host: this,
      key: r.entity,
      icon: r.icon,
      iconColor,
      iconBackground: tintOn(
        this,
        iconColor === "var(--m3p-secondary-text)" ? "var(--primary-text-color)" : iconColor,
        undefined,
        14,
      ),
      label: r.name,
      extraClass,
      onClick: () => this._moreInfo(r.entity),
      middle: html`
        <div class="lr-name">${r.name}</div>
        <div class="lr-sub ${r.rowState === "stale" ? "stale" : ""}">${staleAge}</div>
      `,
      right: html`
        ${this._batteryChip(r.battery)}
        <span class="status ${r.rowState}">${statusLabel}</span>
      `,
    });
  }

  private _valveChip(): unknown {
    const valve = this._config?.valve_entity;
    if (!valve || !this.hass) return undefined;
    const st = this.hass.states[valve];
    if (!st) return undefined;
    const open = st.state === "open" || st.state === "on";
    return html`<div
      class="valve-chip ${open ? "open" : "closed"}"
      role="button"
      tabindex="0"
      @click=${() => this._moreInfo(valve)}
    >
      ${open ? this._t("leak_valve_open") : this._t("leak_valve_closed")}
    </div>`;
  }

  private _testDueChip(): unknown {
    const days = this._config?.test_interval_days ?? 0;
    const ent = this._config?.last_test_entity;
    if (!days || !ent || !this.hass) return nothing;
    const st = this.hass.states[ent];
    const ts = st ? Date.parse(st.state) : NaN;
    if (isNaN(ts)) return nothing;
    const overdue = this._now - ts > days * 86400_000;
    if (!overdue) return nothing;
    return html`<div class="test-chip" role="button" tabindex="0" @click=${() => this._setTestDate()}>
      <ha-icon icon="mdi:test-tube"></ha-icon>${this._t("leak_test_due")}
    </div>`;
  }

  // Each sensor contributes two entities: the moisture sensor and, if set, the
  // battery sensor whose level the row shows.
  private _watchedEntities(): (string | undefined)[] {
    return this._sensors.flatMap((c) => [c.entity, c.battery_entity]);
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return discoveryChangeMatters(changed, this.hass, this._watchedEntities());
  }

  protected render() {
    if (!this._config || !this.hass) return nothing;
    const rows = this._sortRows(this._buildRows());
    const state = this._cardState(rows);
    const animate = shouldAnimate(this._config.animation) && !isReducedMotion();

    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(this._config);
    const accent = this._config.accent_color ? resolveThemeColor(this._config.accent_color) : DEFAULT_LEAK_ACCENT;

    const bannerColor = state === "alarm" ? LEAK_ALARM_COLOR : state === "stale" ? LEAK_STALE_COLOR : accent;
    const cssVars = buildCssVars({
      "m3p-icon-color": bannerColor,
      "m3p-icon-bg": tintBackground(bannerColor, undefined, 18),
      "m3p-text": textColorCss,
      "m3p-secondary-text": secondaryTextColorCss,
      "leak-alarm": LEAK_ALARM_COLOR,
      "leak-stale": LEAK_STALE_COLOR,
      "lr-row-height": `${LEAK_ROW_HEIGHT}px`,
      "lr-row-radius": `${LEAK_ROW_RADIUS}px`,
      "lr-row-radius-active": `${LEAK_ROW_RADIUS_ACTIVE}px`,
      "lr-icon-size": `${LEAK_ICON_SIZE}px`,
      "lr-icon-radius": `${LEAK_ICON_RADIUS}px`,
      "lr-row-gap": `${LEAK_ROW_GAP}px`,
      // Fills keep the accent; these twins carry it where it is text.
      // Measured against the row wash these badges actually sit on; against
      // the card they land at 4.46:1.
      "leak-alarm-fg": foregroundOn(LEAK_ALARM_COLOR, listRowSurface(this), 4.5),
      "leak-stale-fg": foregroundOn(LEAK_STALE_COLOR, listRowSurface(this), 4.5),
      ...foregroundVars(this, {
        "m3p-icon-color": bannerColor,
      }),
    });
    const radius = resolveCornerRadius(this._config.radius ?? DEFAULT_LEAK_RADIUS, this._config.corners);

    const wetRows = rows.filter((r) => r.rowState === "wet");
    const staleRows = rows.filter((r) => r.rowState === "stale" || r.rowState === "unavailable");

    // banner content
    let bannerIcon: string;
    let title: string;
    let subtitle: string;
    if (state === "alarm") {
      bannerIcon = "mdi:water-alert";
      title = this._t("leak_alarm_title");
      subtitle =
        wetRows.length === 1
          ? `${wetRows[0].name} — ${this._t("leak_alarm_since").replace("{t}", this._duration(wetRows[0].lastUpdated))}`
          : this._t("leak_alarm_multi").replace("{n}", String(wetRows.length));
    } else if (state === "stale") {
      bannerIcon = "mdi:shield-alert";
      title = this._t("leak_stale_title");
      const s = staleRows[0];
      subtitle = s ? this._t("leak_stale_sub").replace("{name}", s.name).replace("{t}", this._duration(s.lastUpdated)) : "";
    } else {
      bannerIcon = this._config.icon || "mdi:shield-check";
      title = this._t("leak_ok_title");
      const newest = rows
        .map((r) => (r.lastUpdated ? Date.parse(r.lastUpdated) : 0))
        .reduce((a, b) => Math.max(a, b), 0);
      subtitle = this._t("leak_ok_sub")
        .replace("{n}", String(rows.length))
        .replace("{t}", newest ? this._since(new Date(newest).toISOString()) : "—");
    }

    const collapseOk = this._config.collapse_ok === true && state === "ok";

    // A long list of quiet sensors is worth keeping short. An alarm is not:
    // whichever sensor is wet must be on screen without another tap, so the
    // limit is dropped as soon as anything is wrong.
    const maxVisible = state === "alarm" ? 0 : (this._config.max_visible ?? 0);
    const visibleRows =
      maxVisible > 0 && !this._showAll ? rows.slice(0, maxVisible) : rows;
    const hiddenCount = maxVisible > 0 ? Math.max(0, rows.length - maxVisible) : 0;
    const showShutoff = state === "alarm" && !!this._config.valve_entity;

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(this._config.glass_background)} state-${state} ${animate ? "" : "no-animations"}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          <div class="banner ${state}">
            <div class="banner-icon ${state === "alarm" && animate ? "pulse" : ""}">
              <ha-icon icon=${bannerIcon}></ha-icon>
            </div>
            <div class="banner-text">
              <div class="banner-title">${title}</div>
              <div class="banner-sub">${subtitle}</div>
            </div>
            ${state === "ok"
              ? html`<div class="banner-right">${this._testDueChip()}${this._valveChip()}</div>`
              : nothing}
          </div>

          ${state === "alarm"
            ? html`
                <div class="action-bar">
                  ${showShutoff
                    ? html`<button
                        class="shutoff ${this._shutoffDone ? "done" : ""} ${this._armShutoff ? "armed" : ""}"
                        @click=${() => this._shutoff()}
                      >
                        <ha-icon icon=${this._shutoffDone ? "mdi:check" : "mdi:water-off"}></ha-icon>
                        <span
                          >${this._shutoffDone
                            ? this._t("leak_shutoff_done")
                            : this._armShutoff
                              ? this._t("leak_shutoff_confirm")
                              : this._t("leak_shutoff")}</span
                        >
                      </button>`
                    : nothing}
                  <button class="ack" @click=${() => this._ack()} aria-label=${this._t("leak_ack")}>
                    <ha-icon icon="mdi:bell-off"></ha-icon>
                  </button>
                </div>
              `
            : nothing}

          ${collapseOk
            ? html`<button class="collapse-toggle" @click=${() => (this._expanded = !this._expanded)}>
                <ha-icon icon="mdi:water-check-outline"></ha-icon>
                <span>${this._expanded ? this._t("leak_collapse") : this._t("leak_expand").replace("{n}", String(rows.length))}</span>
                <ha-icon class="chevron ${this._expanded ? "open" : ""}" icon="mdi:chevron-down"></ha-icon>
              </button>`
            : nothing}

          ${!collapseOk || this._expanded
            ? html`
                <div class="row-list">${visibleRows.map((r) => this._renderRow(r))}</div>
                ${hiddenCount > 0
                  ? html`<button
                      class="collapse-toggle"
                      @click=${() => (this._showAll = !this._showAll)}
                    >
                      <span
                        >${this._showAll
                          ? this._t("leak_show_less")
                          : this._t("leak_show_more").replace("{n}", String(hiddenCount))}</span
                      >
                      <ha-icon
                        class="chevron ${this._showAll ? "open" : ""}"
                        icon="mdi:chevron-down"
                      ></ha-icon>
                    </button>`
                  : nothing}
              `
            : nothing}
        </div>
      </ha-card>
    `;
  }

  static styles = [
    glassCardStyles,
    listRowStyles,
    css`
      .card-inner.state-alarm {
        background: color-mix(in srgb, var(--leak-alarm) 9%, var(--ha-card-background, var(--card-background-color)));
        border-color: color-mix(in srgb, var(--leak-alarm) 40%, var(--ha-card-background, var(--card-background-color)));
      }

      .banner {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 13px;
        border-radius: 22px;
        background: color-mix(in srgb, var(--m3p-icon-color) 14%, var(--ha-card-background, var(--card-background-color)));
      }
      .banner.alarm {
        background: color-mix(in srgb, var(--leak-alarm) 20%, var(--ha-card-background, var(--card-background-color)));
      }
      .banner-icon {
        flex-shrink: 0;
        width: 48px;
        height: 48px;
        border-radius: 17px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: color-mix(in srgb, var(--m3p-icon-color) 22%, var(--ha-card-background, var(--card-background-color)));
        color: var(--m3p-icon-color-fg, var(--m3p-icon-color));
      }
      .banner-icon ha-icon {
        --mdc-icon-size: 26px;
      }
      .banner-icon.pulse {
        animation: leak-pulse 1.6s ease-in-out infinite;
      }
      @keyframes leak-pulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.12); opacity: 0.7; }
      }
      .banner-text {
        flex: 1;
        min-width: 0;
      }
      .banner-title {
        font-size: 15px;
        font-weight: 700;
        color: var(--m3p-text);
      }
      .banner.alarm .banner-title {
        font-size: 17px;
        color: var(--leak-alarm-fg, var(--leak-alarm));
      }
      .banner-sub {
        font-size: 12px;
        opacity: 0.7;
        color: var(--m3p-secondary-text);
      }
      .banner-right {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
      }
      .valve-chip {
        height: 30px;
        border-radius: 15px;
        padding: 0 12px;
        display: flex;
        align-items: center;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
      .valve-chip.open {
        background: color-mix(in srgb, #6ba7dc 20%, var(--ha-card-background, var(--card-background-color)));
        color: #6ba7dc;
      }
      .valve-chip.closed {
        background: color-mix(in srgb, var(--leak-stale) 20%, var(--ha-card-background, var(--card-background-color)));
        color: var(--leak-stale-fg, var(--leak-stale));
      }
      .test-chip {
        height: 30px;
        border-radius: 15px;
        padding: 0 10px;
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        background: color-mix(in srgb, var(--leak-stale) 18%, var(--ha-card-background, var(--card-background-color)));
        color: var(--leak-stale-fg, var(--leak-stale));
      }
      .test-chip ha-icon {
        --mdc-icon-size: 16px;
      }

      .action-bar {
        display: flex;
        gap: 8px;
      }
      .shutoff {
        flex: 1;
        height: 56px;
        border: none;
        border-radius: 28px;
        cursor: pointer;
        background: var(--leak-alarm);
        color: #1c1210;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        font-size: 15px;
        font-weight: 700;
        transition: border-radius 0.3s ease, background 0.3s ease;
      }
      .shutoff.armed {
        background: color-mix(in srgb, var(--leak-alarm) 70%, #000);
      }
      .shutoff.done {
        background: #81c784;
        border-radius: 16px;
      }
      .shutoff ha-icon {
        --mdc-icon-size: 22px;
      }
      .ack {
        flex: 0 0 56px;
        height: 56px;
        border: none;
        border-radius: 28px;
        cursor: pointer;
        background: color-mix(in srgb, var(--primary-text-color) 10%, var(--ha-card-background, var(--card-background-color)));
        color: var(--m3p-text);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .ack ha-icon {
        --mdc-icon-size: 22px;
      }

      .row-list {
        display: flex;
        flex-direction: column;
        gap: var(--lr-row-gap, 6px);
      }
      .lr-name {
        font-size: 12px;
        font-weight: 600;
        color: var(--m3p-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .lr-sub {
        font-size: 10px;
        opacity: 0.55;
        color: var(--m3p-secondary-text);
      }
      .lr-sub.stale {
        color: var(--leak-stale-fg, var(--leak-stale));
        opacity: 0.9;
      }
      .lr-row.row-wet {
        background: color-mix(in srgb, var(--leak-alarm) 16%, var(--ha-card-background, var(--card-background-color)));
      }
      .lr-row.row-stale {
        background: color-mix(in srgb, var(--leak-stale) 12%, var(--ha-card-background, var(--card-background-color)));
      }
      .bat {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        font-size: 13px;
        font-weight: 700;
        color: var(--m3p-secondary-text);
      }
      .bat ha-icon {
        --mdc-icon-size: 16px;
      }
      .bat.warn {
        color: var(--leak-stale-fg, var(--leak-stale));
      }
      .bat.crit {
        color: var(--leak-alarm-fg, var(--leak-alarm));
      }
      .status {
        font-size: 11px;
        font-weight: 700;
        color: var(--m3p-secondary-text);
        opacity: 0.7;
      }
      .status.wet {
        color: var(--leak-alarm-fg, var(--leak-alarm));
        opacity: 1;
      }
      .lr-right {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .collapse-toggle {
        width: 100%;
        height: 44px;
        border: none;
        border-radius: 14px;
        cursor: pointer;
        background: color-mix(in srgb, var(--primary-text-color) 6%, var(--ha-card-background, var(--card-background-color)));
        color: var(--m3p-secondary-text);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-size: 13px;
      }
      .collapse-toggle .chevron {
        transition: transform 0.2s ease;
      }
      .collapse-toggle .chevron.open {
        transform: rotate(180deg);
      }
      .no-animations .banner-icon.pulse {
        animation: none;
      }

      /* Safari gained color-mix() in 16.2, and an iPod touch 7 or an iPad Air 2
         stops at iOS 15. A plain declaration before each mix cannot serve as the
         fallback: every one of them contains var(), which defers the check until
         after substitution, where failure yields unset rather than the previous
         declaration — the tint did not fade, the fill disappeared entirely. This
         block is the one those browsers alone can see; the tint is what it gives
         up. Backticks are not allowed in here: this is a css template literal. */
      @supports not (color: color-mix(in srgb, red 50%, blue)) {
        .card-inner.state-alarm {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .banner {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .banner.alarm {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .banner-icon {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .valve-chip.open {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .valve-chip.closed {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .test-chip {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .shutoff.armed {
          background: var(--leak-alarm);
        }
        .ack {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .lr-row.row-wet {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .lr-row.row-stale {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .collapse-toggle {
          background: var(--ha-card-background, var(--card-background-color));
        }
      }
      `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-leak-card": M3LeakCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-leak-card",
  name: "M3 Leak Card",
  description:
    "Eine Material-3-Übersicht für Wassermelder mit ruhigem Normalzustand, unübersehbarem Alarm und direkter Absperr-Aktion.",
  // false: HA's "Add card" dialog builds a real, hass-wired element of every
  // registered type just to draw its preview thumbnail. This card discovers
  // its entities as soon as it sees a hass, so leaving the preview on runs a
  // full-house scan for everyone who opens that dialog.
  preview: false,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
