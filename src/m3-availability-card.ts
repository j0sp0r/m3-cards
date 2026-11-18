import { LitElement, html, css, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import type {
  HomeAssistant,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  M3AvailabilityCardConfig,
} from "./types";
import {
  CARD_VERSION,
  AVAILABILITY_CRITICAL_COLOR,
  AVAILABILITY_HEADER_ICON,
  AVAILABILITY_HEADER_RADIUS,
  AVAILABILITY_HISTORY_DAYS,
  AVAILABILITY_ICON_RADIUS,
  AVAILABILITY_ICON_SIZE,
  AVAILABILITY_OK_COLOR,
  AVAILABILITY_ROW_GAP,
  AVAILABILITY_ROW_HEIGHT,
  AVAILABILITY_ROW_RADIUS,
  AVAILABILITY_ROW_RADIUS_ACTIVE,
  AVAILABILITY_TICK_MS,
  AVAILABILITY_WARN_COLOR,
  DEFAULT_AVAILABILITY_CRITICAL_HOURS,
  DEFAULT_AVAILABILITY_ICON,
  DEFAULT_AVAILABILITY_MAX_ITEMS,
  DEFAULT_AVAILABILITY_RADIUS,
  DEFAULT_AVAILABILITY_RECENT_MINUTES,
  NEW_CARD_ACCENT,
  resolveCornerRadius,
} from "./const";
import { buildCssVars, foregroundColor, foregroundOn, resolveCommonColors, resolveThemeColor, tintOn } from "./shared/color-config";
import { glassCardClass, glassCardStyles } from "./shared/glass-card";
import { isReducedMotion, shouldAnimate, STANDARD_EASING } from "./shared/animation";
import { captureRowRects, flipRows } from "./shared/list-row";
import { localize, type TranslationKey } from "./localize";
import { TemplatedCard } from "./shared/templated-card";
import { openEntityDetail } from "./shared/entity-detail";
import { navigateTo } from "./shared/actions";
import { openDropdownMenu } from "./shared/dropdown-menu";
import { showSnackbar } from "./shared/snackbar";
import {
  buildWatchIndex,
  evaluateUnits,
  groupFlagged,
  integrationTitle,
  offlineStartFromHistory,
  severityOf,
  unavailableSignature,
  unitIcon,
  type FlaggedUnit,
  type HistoryRowLite,
  type RegArea,
  type RegDevice,
  type RegEntity,
  type StateLike,
  type WatchedUnit,
} from "./shared/availability";
import {
  isMuted,
  loadUserData,
  MUTE_DURATIONS,
  parseMutes,
  pruneMutes,
  saveUserData,
  type MuteDuration,
  type MuteMap, AVAILABILITY_MUTES_KEY } from "./shared/user-data";

console.info(
  `%c M3-AVAILABILITY-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #81c784; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #81c784; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

const MUTES_KEY = AVAILABILITY_MUTES_KEY;
const HOLD_MS = 500;
const FLIP_MS = 260;

/**
 * Devices that cannot be reached, one row per device rather than per entity:
 * what needs a battery, a re-pair or a removal. Reads only the registries the
 * frontend already holds, so it works for every user. See
 * shared/availability.ts for what counts as offline and why.
 */
@customElement("m3-availability-card")
export class M3AvailabilityCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3AvailabilityCardConfig;
  @state() private _filter = "all";
  @state() private _showAll = false;
  @state() private _mutedOpen = false;
  @state() private _mutes: MuteMap = {};
  @state() private _now = Date.now();
  /** Outage starts read from the history, by unit key. */
  @state() private _realSince = new Map<string, number>();

  private _mutesLoaded = false;
  private _tick?: number;
  private _index: WatchedUnit[] = [];
  private _indexKey?: unknown[];
  private _flagged: FlaggedUnit[] = [];
  private _signature = "";
  private _historyAsked = new Set<string>();
  private _rects?: Map<string, DOMRect>;
  private _holdTimer?: number;
  private _held = false;

  public setConfig(config: M3AvailabilityCardConfig): void {
    if (!config) throw new Error("Invalid configuration");
    this._config = config;
    this._indexKey = undefined;
  }

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-availability-card-editor");
    return document.createElement("m3-availability-card-editor") as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(): M3AvailabilityCardConfig {
    return { type: "custom:m3-availability-card", glass_background: true, accent_color: NEW_CARD_ACCENT };
  }

  public getCardSize(): number {
    return 3;
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: 12, rows: "auto", min_columns: 6 };
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this._tick = window.setInterval(() => (this._now = Date.now()), AVAILABILITY_TICK_MS);
    this._now = Date.now();
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._tick) window.clearInterval(this._tick);
    if (this._holdTimer) window.clearTimeout(this._holdTimer);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  // ---- model ---------------------------------------------------------------

  /** Rebuilds the watched set when a registry or the scope changes. */
  private _ensureIndex(): void {
    const hass = this.hass;
    const cfg = this._config;
    if (!hass || !cfg) return;
    const key = [hass.entities, hass.devices, hass.areas, cfg.include, cfg.exclude, cfg.ignore_diagnostic, cfg.include_orphan_entities];
    if (this._indexKey && key.every((v, i) => v === this._indexKey![i])) return;
    this._indexKey = key;
    this._index = buildWatchIndex(
      hass.entities as Record<string, RegEntity> | undefined,
      hass.devices as Record<string, RegDevice> | undefined,
      hass.areas as Record<string, RegArea> | undefined,
      {
        include: cfg.include,
        exclude: cfg.exclude,
        ignoreDiagnostic: cfg.ignore_diagnostic,
        includeOrphans: cfg.include_orphan_entities,
        entityName: (id) => (hass.states[id]?.attributes?.friendly_name as string | undefined) ?? id,
      },
    );
    this._signature = "";
  }

  private _evaluate(): void {
    const hass = this.hass;
    const cfg = this._config;
    if (!hass || !cfg) return;
    const staleHours = cfg.stale_hours ?? 0;
    this._flagged = evaluateUnits(this._index, hass.states as Record<string, StateLike>, this._now, {
      staleMs: staleHours > 0 ? staleHours * 3_600_000 : undefined,
      staleIntegrations: cfg.stale_integrations,
    }).map((f) => {
      const real = f.kind === "offline" ? this._realSince.get(f.unit.key) : undefined;
      return real !== undefined && real < f.since ? { ...f, since: real } : f;
    });
    this._afterEvaluate();
  }

  /** Forgets what belongs to devices that are back, asks the history for new outages. */
  private _afterEvaluate(): void {
    const offlineKeys = new Set(this._flagged.filter((f) => f.kind === "offline").map((f) => f.unit.key));
    for (const key of [...this._historyAsked]) {
      if (!offlineKeys.has(key)) {
        this._historyAsked.delete(key);
        this._realSince.delete(key);
      }
    }
    if (this._mutesLoaded) {
      const flaggedKeys = new Set(this._flagged.map((f) => f.unit.key));
      const pruned = pruneMutes(this._mutes, this._now, flaggedKeys);
      if (pruned !== this._mutes) {
        this._mutes = pruned;
        void saveUserData(this.hass, MUTES_KEY, pruned);
      }
    }
    const ask = this._flagged.filter((f) => f.kind === "offline" && !this._historyAsked.has(f.unit.key));
    if (ask.length) void this._fetchHistory(ask);
  }

  /**
   * A restart writes `unavailable` again, so last_changed would make a device
   * dead for a week read "for 3 min.". One history call for the new outages,
   * through the primary entity; every user may read the history.
   */
  private async _fetchHistory(flagged: FlaggedUnit[]): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    for (const f of flagged) this._historyAsked.add(f.unit.key);
    const windowStart = Date.now() - AVAILABILITY_HISTORY_DAYS * 86_400_000;
    try {
      const res = await hass.callWS<Record<string, HistoryRowLite[]>>({
        type: "history/history_during_period",
        start_time: new Date(windowStart).toISOString(),
        entity_ids: flagged.map((f) => f.unit.primary),
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      });
      const next = new Map(this._realSince);
      for (const f of flagged) {
        const found = offlineStartFromHistory(res?.[f.unit.primary] ?? [], windowStart);
        if (found.at !== undefined) next.set(f.unit.key, found.at);
      }
      this._realSince = next;
      this._signature = "";
    } catch {
      // No recorder, or no access: last_changed stands.
    }
  }

  private async _loadMutes(): Promise<void> {
    if (this._mutesLoaded) return;
    this._mutesLoaded = true;
    const raw = await loadUserData<unknown>(this.hass, MUTES_KEY);
    this._mutes = pruneMutes(parseMutes(raw), Date.now());
  }

  // ---- lifecycle -----------------------------------------------------------

  protected shouldUpdate(changed: PropertyValues): boolean {
    if (!changed.has("hass") || changed.size > 1) return true;
    const prev = changed.get("hass") as HomeAssistant | undefined;
    const hass = this.hass;
    if (!prev || !hass) return true;
    if (
      prev.locale !== hass.locale ||
      prev.themes !== hass.themes ||
      prev.language !== hass.language ||
      prev.entities !== hass.entities ||
      prev.devices !== hass.devices ||
      prev.areas !== hass.areas
    )
      return true;
    // Only a change in which watched entities are unavailable matters between
    // ticks; quiet devices are re-checked by the minute tick.
    return unavailableSignature(this._index, hass.states as Record<string, StateLike>) !== this._signature;
  }

  protected willUpdate(changed: PropertyValues): void {
    super.willUpdate?.(changed);
    if (!this.hass || !this._config) return;
    if (!this._mutesLoaded) void this._loadMutes();
    this._ensureIndex();
    const sig = unavailableSignature(this._index, this.hass.states as Record<string, StateLike>);
    if (sig !== this._signature || changed.has("_now") || changed.has("_config") || changed.has("_realSince")) {
      this._signature = sig;
      this._evaluate();
    }
    if (this._animate) this._rects = captureRowRects(this.renderRoot);
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    if (this._rects && this._animate) flipRows(this.renderRoot, this._rects, FLIP_MS);
    this._rects = undefined;
  }

  private get _animate(): boolean {
    return shouldAnimate(this._config?.animation) && !isReducedMotion();
  }

  // ---- actions -------------------------------------------------------------

  private _open(f: FlaggedUnit): void {
    if (this._held) return;
    if (f.unit.deviceId && this.hass?.user?.is_admin) {
      navigateTo(this, `/config/devices/device/${f.unit.deviceId}`);
    } else {
      openEntityDetail(this, f.unit.primary);
    }
  }

  private _durationLabel(d: MuteDuration): string {
    return this._t(`avail_mute_${d}` as TranslationKey);
  }

  private _mute(f: FlaggedUnit, duration: MuteDuration): void {
    const key = f.unit.key;
    const previous = this._mutes[key];
    const span = MUTE_DURATIONS[duration];
    const now = Date.now();
    const permanent = duration === "permanent";
    this._mutes = {
      ...this._mutes,
      [key]: permanent ? { until: null, at: now, permanent: true } : { until: span === null ? null : now + span, at: now },
    };
    void saveUserData(this.hass, MUTES_KEY, this._mutes);
    const message = permanent
      ? this._t("avail_muted_permanent").replace("{name}", f.unit.name)
      : span === null
        ? this._t("avail_muted_forever").replace("{name}", f.unit.name)
        : this._t("avail_muted_for").replace("{name}", f.unit.name).replace("{t}", this._durationLabel(duration));
    showSnackbar({
      message,
      action: {
        label: this._t("avail_undo"),
        onAction: () => {
          const next = { ...this._mutes };
          if (previous) next[key] = previous;
          else delete next[key];
          this._mutes = next;
          void saveUserData(this.hass, MUTES_KEY, next);
        },
      },
    });
  }

  private _unmute(f: FlaggedUnit): void {
    const next = { ...this._mutes };
    delete next[f.unit.key];
    this._mutes = next;
    void saveUserData(this.hass, MUTES_KEY, next);
    showSnackbar({ message: this._t("avail_unmuted").replace("{name}", f.unit.name), durationMs: 3000 });
  }

  private _openMuteMenu(f: FlaggedUnit, anchor: HTMLElement): void {
    const durations: MuteDuration[] = ["1h", "24h", "7d", "forever", "permanent"];
    openDropdownMenu({
      anchor,
      label: this._t("avail_mute_menu"),
      items: durations.map((d) => ({
        value: d,
        label: this._durationLabel(d),
        icon: d === "permanent" ? "mdi:bell-cancel" : d === "forever" ? "mdi:bell-off" : "mdi:bell-sleep",
      })),
      onSelect: (value) => this._mute(f, value as MuteDuration),
    });
  }

  private _bellDown(e: PointerEvent, f: FlaggedUnit): void {
    this._held = false;
    const anchor = e.currentTarget as HTMLElement;
    if (this._holdTimer) window.clearTimeout(this._holdTimer);
    this._holdTimer = window.setTimeout(() => {
      this._held = true;
      this._openMuteMenu(f, anchor);
    }, HOLD_MS);
  }

  private _bellUp(): void {
    if (this._holdTimer) window.clearTimeout(this._holdTimer);
    this._holdTimer = undefined;
  }

  private _bellClick(e: Event, f: FlaggedUnit): void {
    e.stopPropagation();
    if (this._held) {
      this._held = false;
      return;
    }
    this._mute(f, this._config?.mute_default ?? "24h");
  }

  private _bellKey(e: KeyboardEvent, f: FlaggedUnit): void {
    // The long press, for a keyboard: the context-menu key, Shift+F10 or
    // Shift+Enter opens the duration menu.
    if (e.key === "ContextMenu" || (e.shiftKey && (e.key === "F10" || e.key === "Enter"))) {
      e.preventDefault();
      e.stopPropagation();
      this._openMuteMenu(f, e.currentTarget as HTMLElement);
    }
  }

  private _bellContext(e: Event, f: FlaggedUnit): void {
    e.preventDefault();
    e.stopPropagation();
    this._held = true;
    this._openMuteMenu(f, e.currentTarget as HTMLElement);
  }

  // ---- text ----------------------------------------------------------------

  private _duration(since: number): string {
    const minutes = Math.max(0, Math.floor((this._now - since) / 60_000));
    if (minutes < 60) return this._t("avail_dur_minutes").replace("{n}", String(minutes));
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return this._t("avail_dur_hours").replace("{n}", String(hours));
    const days = Math.floor(hours / 24);
    return days === 1 ? this._t("avail_dur_day") : this._t("avail_dur_days").replace("{n}", String(days));
  }

  private _integration(domain?: string): string {
    const loc = (this.hass as unknown as { localize?: (k: string) => string } | undefined)?.localize;
    return integrationTitle(domain, loc ? (k) => loc(k) : undefined);
  }

  // ---- render --------------------------------------------------------------

  private _renderRow(f: FlaggedUnit, critical: number, cls: string): TemplateResult {
    const sev = severityOf(f, this._now, critical);
    const stale = f.kind === "stale";
    const st = this.hass?.states[f.unit.primary] as StateLike | undefined;
    const parts = [f.unit.areaName, this._integration(f.unit.integration)].filter(Boolean).join(" · ");
    const span = this._duration(f.since);
    const when = stale
      ? this._t("avail_quiet_since").replace("{t}", span)
      : this._t("avail_since").replace("{t}", span);
    const label = `${f.unit.name}, ${parts}, ${when}`;
    return html`
      <div
        class="row ${stale ? "stale" : sev} ${cls}"
        data-row-key=${f.unit.key}
        role="button"
        tabindex="0"
        aria-label=${label}
        @click=${() => this._open(f)}
        @keydown=${(e: KeyboardEvent) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            this._open(f);
          }
        }}
      >
        <div class="ricon">
          <ha-icon icon=${unitIcon(f.unit.primary, st)}></ha-icon>
          <span class="badge"><ha-icon icon=${stale ? "mdi:clock-outline" : "mdi:close"}></ha-icon></span>
        </div>
        <div class="rtext">
          <div class="rname">${f.unit.name}</div>
          <div class="rsub">
            ${parts ? html`<span class="parts">${parts}</span><span class="dot">·</span>` : nothing}<span class="dur">${when}</span>
          </div>
        </div>
        <button
          class="bell"
          aria-label=${`${this._t("avail_mute")}: ${f.unit.name}`}
          title=${this._t("avail_mute")}
          @click=${(e: Event) => this._bellClick(e, f)}
          @pointerdown=${(e: PointerEvent) => this._bellDown(e, f)}
          @pointerup=${() => this._bellUp()}
          @pointerleave=${() => this._bellUp()}
          @pointercancel=${() => this._bellUp()}
          @contextmenu=${(e: Event) => this._bellContext(e, f)}
          @keydown=${(e: KeyboardEvent) => this._bellKey(e, f)}
        >
          <ha-icon icon="mdi:bell-off-outline"></ha-icon>
        </button>
      </div>
    `;
  }

  private _renderGroup(title: string, rows: FlaggedUnit[], critical: number): TemplateResult | typeof nothing {
    if (!rows.length) return nothing;
    return html`
      <div class="group">
        <div class="group-title">${title}</div>
        <div class="group-rows">
          ${repeat(
            rows,
            (f) => f.unit.key,
            (f, i) => this._renderRow(f, critical, `${i === 0 ? "first" : ""} ${i === rows.length - 1 ? "last" : ""}`),
          )}
        </div>
      </div>
    `;
  }

  protected render() {
    const cfg = this._config;
    const hass = this.hass;
    if (!cfg || !hass) return nothing;

    const recentMs = (cfg.recent_minutes ?? DEFAULT_AVAILABILITY_RECENT_MINUTES) * 60_000;
    const criticalHours = cfg.critical_hours ?? DEFAULT_AVAILABILITY_CRITICAL_HOURS;
    const criticalMs = criticalHours * 3_600_000;
    const maxItems = cfg.max_items ?? DEFAULT_AVAILABILITY_MAX_ITEMS;

    const visible = this._flagged.filter((f) => !isMuted(this._mutes, f.unit.key, this._now));
    const muted = this._flagged.filter((f) => isMuted(this._mutes, f.unit.key, this._now));

    // Chips only when more than one integration is involved.
    const counts = new Map<string, number>();
    for (const f of visible) {
      const k = f.unit.integration ?? "";
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const filter = this._filter !== "all" && counts.has(this._filter) ? this._filter : "all";
    const showChips = cfg.show_filters !== false && counts.size > 1;
    const shown = filter === "all" ? visible : visible.filter((f) => (f.unit.integration ?? "") === filter);

    const { recent, longer } = groupFlagged(shown, this._now, recentMs);
    const ordered = [...recent, ...longer];
    const limit = maxItems > 0 && !this._showAll ? maxItems : Infinity;
    const keep = new Set(ordered.slice(0, limit).map((f) => f.unit.key));
    const hidden = Math.max(0, ordered.length - keep.size);

    const offlineVisible = visible.filter((f) => f.kind === "offline");
    const criticalCount = offlineVisible.filter((f) => severityOf(f, this._now, criticalMs) === "critical").length;
    const allOk = visible.length === 0;

    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(cfg);
    const warn = cfg.warn_color ? resolveThemeColor(cfg.warn_color) : AVAILABILITY_WARN_COLOR;
    const crit = cfg.critical_color ? resolveThemeColor(cfg.critical_color) : AVAILABILITY_CRITICAL_COLOR;
    const ok = cfg.accent_color && cfg.accent_color !== NEW_CARD_ACCENT ? resolveThemeColor(cfg.accent_color) : AVAILABILITY_OK_COLOR;
    const headColor = allOk ? ok : criticalCount ? crit : warn;
    const warnRow = tintOn(this, warn, undefined, 12);
    const critRow = tintOn(this, crit, undefined, 14);
    const cssVars = buildCssVars({
      "av-text": textColorCss,
      "av-secondary": secondaryTextColorCss,
      "av-warn": warn,
      "av-crit": crit,
      "av-ok": ok,
      "av-head": headColor,
      "av-head-bg": tintOn(this, headColor, undefined, 22),
      "av-head-fg": foregroundOn(headColor, tintOn(this, headColor, undefined, 22), 3, this),
      "av-head-text": foregroundColor(this, headColor),
      "av-warn-row": warnRow,
      "av-crit-row": critRow,
      "av-warn-fg": foregroundOn(warn, warnRow, 4.5, this),
      "av-crit-fg": foregroundOn(crit, critRow, 4.5, this),
      "av-warn-icon": tintOn(this, warn, undefined, 22),
      "av-crit-icon": tintOn(this, crit, undefined, 24),
      "av-ok-bg": tintOn(this, ok, undefined, 20),
      "av-ok-fg": foregroundOn(ok, tintOn(this, ok, undefined, 20), 4.5, this),
      "av-row-h": `${AVAILABILITY_ROW_HEIGHT}px`,
      "av-row-r": `${AVAILABILITY_ROW_RADIUS}px`,
      "av-row-r-in": `${Math.round(AVAILABILITY_ROW_RADIUS_ACTIVE / 2)}px`,
      "av-icon": `${AVAILABILITY_ICON_SIZE}px`,
      "av-icon-r": `${AVAILABILITY_ICON_RADIUS}px`,
      "av-head-icon": `${AVAILABILITY_HEADER_ICON}px`,
      "av-head-r": `${AVAILABILITY_HEADER_RADIUS}px`,
      "av-gap": `${AVAILABILITY_ROW_GAP / 2}px`,
    });
    const radius = resolveCornerRadius(cfg.radius ?? DEFAULT_AVAILABILITY_RADIUS, cfg.corners);
    const title = cfg.title || this._t("avail_title");
    const watched = this._index.length;

    let subtitle: string;
    if (allOk) subtitle = this._t("avail_ok_watched").replace("{n}", String(watched));
    else if (criticalCount)
      subtitle =
        criticalHours === 24
          ? criticalCount === 1
            ? this._t("avail_sub_critical_one")
            : this._t("avail_sub_critical_many").replace("{n}", String(criticalCount))
          : this._t("avail_sub_critical_hours").replace("{n}", String(criticalCount)).replace("{h}", String(criticalHours));
    else if (!offlineVisible.length) subtitle = this._t("avail_sub_stale_only").replace("{n}", String(visible.length));
    else {
      const longOffline = groupFlagged(offlineVisible, this._now, recentMs).longer.length;
      subtitle = longOffline
        ? this._t("avail_sub_mixed").replace("{n}", String(longOffline))
        : this._t("avail_sub_recent");
    }

    const shownRecent = recent.filter((f) => keep.has(f.unit.key));
    const shownLonger = longer.filter((f) => keep.has(f.unit.key));

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(cfg.glass_background)} ${this._animate ? "" : "no-animations"} ${allOk ? "all-ok" : ""}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          <div class="header">
            <div class="head-icon">
              <ha-icon icon=${allOk ? "mdi:wifi" : cfg.icon || DEFAULT_AVAILABILITY_ICON}></ha-icon>
            </div>
            <div class="head-text">
              <div class="title">${title}</div>
              <div class="subtitle">${subtitle}</div>
            </div>
            ${allOk
              ? html`<div class="ok-pill">${this._t("avail_ok_pill")}</div>`
              : html`<div class="hero" aria-label=${`${visible.length} ${this._t("avail_offline")}, ${this._t("avail_of").replace("{n}", String(watched))}`}>
                  <div class="hero-line">
                    <span class="hero-n">${visible.length}</span><span class="hero-unit">${this._t("avail_offline")}</span>
                  </div>
                  <div class="hero-of">${this._t("avail_of").replace("{n}", String(watched))}</div>
                </div>`}
          </div>

          ${showChips
            ? html`<div class="chips" role="tablist">
                ${[["all", visible.length] as [string, number], ...[...counts].sort((a, b) => b[1] - a[1])].map(
                  ([key, n]) => html`<button
                    class="chip ${filter === key ? "active" : ""}"
                    role="tab"
                    aria-selected=${filter === key ? "true" : "false"}
                    @click=${() => {
                      this._filter = key;
                      this._showAll = false;
                    }}
                  >
                    <span>${key === "all" ? this._t("avail_all") : this._integration(key || undefined)}</span>
                    <span class="chip-n">${n}</span>
                  </button>`,
                )}
              </div>`
            : nothing}

          ${allOk
            ? nothing
            : html`
                ${this._renderGroup(this._t("avail_group_recent"), shownRecent, criticalMs)}
                ${this._renderGroup(this._t("avail_group_longer"), shownLonger, criticalMs)}
                ${hidden > 0 || (this._showAll && ordered.length > maxItems && maxItems > 0)
                  ? html`<button class="more" @click=${() => (this._showAll = !this._showAll)}>
                      ${this._showAll ? this._t("avail_less") : this._t("avail_more").replace("{n}", String(hidden))}
                      <ha-icon class=${this._showAll ? "open" : ""} icon="mdi:chevron-down"></ha-icon>
                    </button>`
                  : nothing}
              `}

          ${muted.length
            ? html`
                <div class="muted-bar">
                  <button
                    class="muted-chip"
                    aria-expanded=${this._mutedOpen ? "true" : "false"}
                    @click=${() => (this._mutedOpen = !this._mutedOpen)}
                  >
                    <ha-icon icon="mdi:bell-off-outline"></ha-icon>
                    ${this._t("avail_muted_chip").replace("{n}", String(muted.length))}
                    <ha-icon class="chev ${this._mutedOpen ? "open" : ""}" icon="mdi:chevron-down"></ha-icon>
                  </button>
                </div>
                ${this._mutedOpen
                  ? html`<div class="muted-list">
                      ${muted.map(
                        (f) => html`<div class="muted-row">
                          <ha-icon icon=${unitIcon(f.unit.primary, this.hass?.states[f.unit.primary] as StateLike | undefined)}></ha-icon>
                          <span class="muted-name">${f.unit.name}</span>
                          <span class="muted-when"
                            >${this._mutes[f.unit.key]?.permanent
                              ? this._t("avail_muted_tag_permanent")
                              : this._duration(f.since)}</span
                          >
                          <button class="unmute" @click=${() => this._unmute(f)} aria-label=${`${this._t("avail_unmute")}: ${f.unit.name}`}>
                            <ha-icon icon="mdi:bell-ring-outline"></ha-icon>
                          </button>
                        </div>`,
                      )}
                    </div>`
                  : nothing}
              `
            : nothing}
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
        min-height: var(--av-head-icon);
      }
      .head-icon {
        flex: 0 0 auto;
        width: var(--av-head-icon);
        height: var(--av-head-icon);
        border-radius: var(--av-head-r);
        display: grid;
        place-items: center;
        background: var(--av-head-bg);
        color: var(--av-head-fg, var(--av-head));
        --mdc-icon-size: 24px;
      }
      .head-text {
        flex: 1;
        min-width: 0;
      }
      .title {
        font-size: 16px;
        font-weight: 700;
        color: var(--av-text, var(--primary-text-color));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .subtitle {
        font-size: 13px;
        color: var(--av-secondary, var(--secondary-text-color));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .hero {
        flex: 0 0 auto;
        text-align: right;
      }
      .hero-line {
        display: flex;
        align-items: baseline;
        justify-content: flex-end;
        gap: 4px;
        color: var(--av-head-text, var(--av-head));
      }
      .hero-n {
        font-size: 36px;
        font-weight: 700;
        line-height: 1;
        letter-spacing: -0.02em;
      }
      .hero-unit {
        font-size: 15px;
        font-weight: 600;
      }
      .hero-of {
        font-size: 12px;
        color: var(--av-secondary, var(--secondary-text-color));
      }
      .ok-pill {
        flex: 0 0 auto;
        height: 30px;
        padding: 0 14px;
        border-radius: 15px;
        display: flex;
        align-items: center;
        font-size: 13px;
        font-weight: 700;
        background: var(--av-ok-bg);
        color: var(--av-ok-fg, var(--av-ok));
      }

      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .chip {
        height: 36px;
        padding: 0 14px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 18px;
        border: 1px solid color-mix(in srgb, var(--primary-text-color) 18%, transparent);
        background: transparent;
        color: var(--av-text, var(--primary-text-color));
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: border-radius 220ms ${unsafeCSS(STANDARD_EASING)}, background 220ms ease;
      }
      .chip .chip-n {
        opacity: 0.6;
      }
      .chip.active {
        border-radius: 10px;
        border-color: transparent;
        background: color-mix(in srgb, var(--primary-color) 22%, var(--ha-card-background, var(--card-background-color)));
      }
      .chip:focus-visible,
      .bell:focus-visible,
      .row:focus-visible,
      .more:focus-visible,
      .muted-chip:focus-visible,
      .unmute:focus-visible {
        outline: 2px solid var(--primary-color);
        outline-offset: 2px;
      }

      .group {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .group-title {
        font-size: 13px;
        font-weight: 600;
        padding: 0 4px;
        color: var(--av-secondary, var(--secondary-text-color));
      }
      .group-rows {
        display: flex;
        flex-direction: column;
        gap: var(--av-gap);
      }
      .row {
        position: relative;
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: var(--av-row-h);
        padding: 8px 8px 8px 10px;
        box-sizing: border-box;
        border-radius: var(--av-row-r-in);
        background: var(--av-warn-row);
        cursor: pointer;
        transition: border-radius 200ms ease;
        -webkit-tap-highlight-color: transparent;
      }
      .row.first {
        border-top-left-radius: var(--av-row-r);
        border-top-right-radius: var(--av-row-r);
      }
      .row.last {
        border-bottom-left-radius: var(--av-row-r);
        border-bottom-right-radius: var(--av-row-r);
      }
      .row.critical {
        background: var(--av-crit-row);
      }
      .row.stale {
        background: color-mix(in srgb, var(--primary-text-color) 7%, var(--ha-card-background, var(--card-background-color)));
      }
      .row:active {
        border-radius: var(--av-row-r);
      }
      .ricon {
        position: relative;
        flex: 0 0 auto;
        width: var(--av-icon);
        height: var(--av-icon);
        border-radius: var(--av-icon-r);
        display: grid;
        place-items: center;
        background: var(--av-warn-icon);
        color: var(--av-warn-fg, var(--av-warn));
        --mdc-icon-size: 22px;
      }
      .row.critical .ricon {
        background: var(--av-crit-icon);
        color: var(--av-crit-fg, var(--av-crit));
      }
      .row.stale .ricon {
        background: color-mix(in srgb, var(--primary-text-color) 12%, var(--ha-card-background, var(--card-background-color)));
        color: var(--av-secondary, var(--secondary-text-color));
      }
      .badge {
        position: absolute;
        right: -4px;
        bottom: -4px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: var(--av-warn);
        color: #1c1c1c;
        box-shadow: 0 0 0 2px var(--ha-card-background, var(--card-background-color, #1c1c1c));
        --mdc-icon-size: 12px;
      }
      .row.critical .badge {
        background: var(--av-crit);
      }
      .row.stale .badge {
        background: var(--av-secondary, var(--secondary-text-color));
      }
      .rtext {
        flex: 1;
        min-width: 0;
      }
      .rname {
        font-size: 15px;
        font-weight: 600;
        color: var(--av-text, var(--primary-text-color));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* The duration is what the row is about: it never shrinks, the room and
         integration give way first. */
      .rsub {
        display: flex;
        min-width: 0;
        font-size: 13px;
        color: var(--av-secondary, var(--secondary-text-color));
        white-space: nowrap;
      }
      .rsub .parts {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .rsub .dot,
      .rsub .dur {
        flex: 0 0 auto;
      }
      .rsub .dot {
        margin: 0 5px;
      }
      .rsub .dur {
        font-weight: 600;
        color: var(--av-warn-fg, var(--av-warn));
      }
      .row.critical .rsub .dur {
        color: var(--av-crit-fg, var(--av-crit));
      }
      .row.stale .rsub .dur {
        color: var(--av-secondary, var(--secondary-text-color));
        font-style: italic;
      }
      .bell {
        flex: 0 0 auto;
        width: 44px;
        height: 44px;
        border-radius: 12px;
        border: 1px solid color-mix(in srgb, var(--primary-text-color) 18%, transparent);
        background: transparent;
        color: var(--av-text, var(--primary-text-color));
        display: grid;
        place-items: center;
        cursor: pointer;
        --mdc-icon-size: 20px;
        transition: border-radius 200ms ease;
        touch-action: manipulation;
        -webkit-touch-callout: none;
        user-select: none;
      }
      .bell:active {
        border-radius: 22px;
      }

      .more,
      .muted-chip {
        align-self: center;
        height: 36px;
        padding: 0 14px;
        border: none;
        border-radius: 18px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        background: color-mix(in srgb, var(--primary-text-color) 7%, var(--ha-card-background, var(--card-background-color)));
        color: var(--av-secondary, var(--secondary-text-color));
        --mdc-icon-size: 18px;
      }
      .more ha-icon,
      .muted-chip .chev {
        transition: transform 200ms ease;
      }
      .more ha-icon.open,
      .muted-chip .chev.open {
        transform: rotate(180deg);
      }
      .muted-bar {
        display: flex;
      }
      .muted-chip {
        align-self: flex-start;
      }
      .muted-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .muted-row {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 44px;
        padding: 0 4px 0 12px;
        border-radius: 14px;
        background: color-mix(in srgb, var(--primary-text-color) 5%, var(--ha-card-background, var(--card-background-color)));
        color: var(--av-secondary, var(--secondary-text-color));
        --mdc-icon-size: 18px;
      }
      .muted-name {
        flex: 1;
        min-width: 0;
        font-size: 14px;
        color: var(--av-text, var(--primary-text-color));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .muted-when {
        font-size: 12px;
      }
      .unmute {
        width: 40px;
        height: 40px;
        border: none;
        border-radius: 12px;
        background: transparent;
        color: var(--av-text, var(--primary-text-color));
        display: grid;
        place-items: center;
        cursor: pointer;
      }

      .no-animations .row,
      .no-animations .chip,
      .no-animations .bell,
      .no-animations .more ha-icon,
      .no-animations .muted-chip .chev {
        transition: none;
      }

      /* Safari before 16.2 has no color-mix(); see the leak card for why this
         block, and not a plain fallback declaration, is what those browsers
         need. */
      @supports not (color: color-mix(in srgb, red 50%, blue)) {
        .chip.active,
        .row.stale,
        .row.stale .ricon,
        .more,
        .muted-chip,
        .muted-row {
          background: var(--ha-card-background, var(--card-background-color));
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-availability-card": M3AvailabilityCard;
  }
}

const windowWithCards = window as unknown as { customCards: Array<Record<string, unknown>> };
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-availability-card",
  name: "M3 Availability Card",
  description: "Unreachable devices at a glance, one row per device, with mute and undo.",
  // false: the card walks every registry entry; the "Add card" dialog would
  // run that for everyone who opens it.
  preview: false,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
