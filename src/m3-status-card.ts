import { LitElement, html, css, nothing, unsafeCSS } from "lit";
import type { PropertyValues, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HaActionConfig,
  HomeAssistant,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  M3StatusCardConfig,
  M3StatusItemConfig,
  StatusPreset,
  StatusRule,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_STATUS_ACCENT,
  DEFAULT_STATUS_ICON,
  DEFAULT_STATUS_RADIUS,
  STATUS_BADGE,
  STATUS_BADGE_MORPH_MS,
  STATUS_BADGE_RADIUS,
  STATUS_BADGE_RADIUS_MORPH,
  STATUS_CARD_TINT,
  STATUS_CHIP_TINT,
  STATUS_COLOR_BAD,
  STATUS_COLOR_GOOD,
  STATUS_COLOR_WARN,
  STATUS_GRID_GAP,
  STATUS_GRID_MIN,
  STATUS_HERO_ICON,
  STATUS_HERO_ICON_RADIUS,
  STATUS_HERO_LABEL_SIZE,
  STATUS_ICON_TINT,
  STATUS_NARROW_PX,
  STATUS_ROW_HEIGHT,
  STATUS_ROW_RADIUS,
  STATUS_SECONDARY_SIZE,
  STATUS_TILE_ICON,
  STATUS_TILE_ICON_RADIUS,
  STATUS_TILE_LABEL_SIZE,
  STATUS_TILE_MORPH_MS,
  STATUS_TILE_RADIUS,
  STATUS_TILE_RADIUS_ACTIVE,
  STATUS_TILE_TINT,
  STATUS_TILE_VALUE_SIZE,
  STATUS_TREND_DEADBAND_PCT,
  STATUS_TREND_DEFAULT_HOURS,
  STATUS_TREND_HEIGHT,
  STATUS_TREND_RADIUS,
  STATUS_UNIT_RATIO,
  STATUS_VALUE_LETTER_SPACING,
  STATUS_VALUE_LONG_CHARS,
  STATUS_VALUE_SIZE_LONG,
  STATUS_VALUE_SIZE_NUMBER,
  STATUS_VALUE_SIZE_TEXT,
  resolveCornerRadius,
  NEW_CARD_ACCENT,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import { STANDARD_EASING, shouldAnimate } from "./shared/animation";
import { handleAction, isActionable } from "./shared/actions";
import { activateOnKey } from "./shared/a11y";
import {
  buildCssVars,
  fillColor,
  foregroundOn,
  inkOn,
  resolveCommonColors,
  resolveThemeColor,
  tintOn,
} from "./shared/color-config";
import { glassCardClass, glassCardStyles } from "./shared/glass-card";
import { formatNumber } from "./shared/formatting";
import { fetchValueHoursAgo } from "./shared/ha-statistics";
import { hassChangeMatters } from "./shared/should-update";
import { findStateRule, numericState } from "./shared/state-rules";
import { TemplatedCard } from "./shared/templated-card";

const EASING = unsafeCSS(STANDARD_EASING);

console.info(
  `%c M3-STATUS-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #85b7eb; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #85b7eb; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

/** How long an optimistic toggle stands before the real state takes over. */
const OPTIMISTIC_MS = 2500;
/** Trend history is re-read on this cadence; it compares against yesterday. */
const TREND_REFRESH_MS = 15 * 60 * 1000;

interface ResolvedItem {
  key: string;
  entityId?: string;
  name: string;
  icon: string;
  color: string;
  /** The formatted value, already localized. */
  value: string;
  /** Unit or suffix drawn small beside the value. */
  unit: string;
  secondary?: string;
  available: boolean;
  /** Present only when the value is a number, which drives sizing and trend. */
  numeric?: number;
  tapAction?: HaActionConfig;
  config: M3StatusItemConfig;
}

interface TrendResult {
  percent: number;
  /** Which way the arrow points, before `trend_inverted` decides the colour. */
  direction: "up" | "down" | "flat";
}

// ---- presets ---------------------------------------------------------------

// A preset is nothing but a rule list, so a user's own `states` and a preset
// are the same mechanism and compose in the obvious way: the user's rules are
// tried first, the preset's fill in whatever they did not cover.
//
// The values are matched case-insensitively, and each preset lists the spellings
// HA actually produces for that shape of entity — `true`/`false` alongside
// `on`/`off` because a template sensor emits either.
const PRESETS: Record<StatusPreset, StatusRule[]> = {
  yes_no: [
    { value: "on", label: "@status_yes", icon: "mdi:check", color: STATUS_COLOR_GOOD },
    { value: "true", label: "@status_yes", icon: "mdi:check", color: STATUS_COLOR_GOOD },
    { value: "off", label: "@status_no", icon: "mdi:close", color: STATUS_COLOR_BAD },
    { value: "false", label: "@status_no", icon: "mdi:close", color: STATUS_COLOR_BAD },
  ],
  on_off: [
    { value: "on", label: "@status_on", icon: "mdi:power", color: STATUS_COLOR_GOOD },
    { value: "off", label: "@status_off", icon: "mdi:power-off", color: "#888780" },
  ],
  ok_problem: [
    { value: "off", label: "@status_ok", icon: "mdi:check-circle", color: STATUS_COLOR_GOOD },
    { value: "ok", label: "@status_ok", icon: "mdi:check-circle", color: STATUS_COLOR_GOOD },
    { value: "on", label: "@status_problem", icon: "mdi:alert-circle", color: STATUS_COLOR_BAD },
    { value: "problem", label: "@status_problem", icon: "mdi:alert-circle", color: STATUS_COLOR_BAD },
  ],
  open_closed: [
    { value: "on", label: "@status_open", icon: "mdi:door-open", color: STATUS_COLOR_WARN },
    { value: "open", label: "@status_open", icon: "mdi:door-open", color: STATUS_COLOR_WARN },
    { value: "off", label: "@status_closed", icon: "mdi:door-closed", color: STATUS_COLOR_GOOD },
    { value: "closed", label: "@status_closed", icon: "mdi:door-closed", color: STATUS_COLOR_GOOD },
  ],
  // Higher is better, which is the common case (battery, signal, a score). For
  // the opposite direction the thresholds are two `states` rules — that is what
  // the rule list is for, and inventing a `traffic_inverted` flag would only
  // cover one of the many scales a user might actually mean.
  traffic: [
    { below: 33, color: STATUS_COLOR_BAD },
    { below: 66, color: STATUS_COLOR_WARN },
    { color: STATUS_COLOR_GOOD },
  ],
};

const UNAVAILABLE_STATES = new Set(["unavailable", "unknown", "none", ""]);

@customElement("m3-status-card")
export class M3StatusCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3StatusCardConfig;
  @state() private _narrow = false;
  @state() private _trends: Record<string, TrendResult> = {};

  /** Entity id -> the state a tap just asked for, until hass confirms it. */
  @state() private _optimistic: Record<string, string> = {};

  private _resizeObserver?: ResizeObserver;
  private _optimisticTimers = new Map<string, number>();
  private _trendTimer?: number;
  private _trendKey = "";
  /** Value per item key at the last render, so the badge only morphs on a change. */
  private _lastValues = new Map<string, string>();

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-status-card-editor");
    return document.createElement(
      "m3-status-card-editor",
    ) as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(hass: HomeAssistant): M3StatusCardConfig {
    const entity =
      Object.keys(hass?.states ?? {}).find((eid) => eid.startsWith("sensor.")) ?? "";
    return {
      type: "custom:m3-status-card",
      layout: "auto",
      items: entity ? [{ entity }] : [],
      glass_background: true,
      accent_color: NEW_CARD_ACCENT,
    };
  }

  public setConfig(config: M3StatusCardConfig): void {
    const items = config.items ?? [];
    if (!Array.isArray(items)) {
      throw new Error("m3-status-card: 'items' must be a list");
    }
    this._config = {
      layout: "auto",
      hero_style: "inline",
      value_size: "auto",
      glass_background: true,
      animation: "auto",
      ...config,
      items,
    };
  }

  public getCardSize(): number {
    const items = this._config?.items?.length ?? 0;
    if (this._layout === "hero") return 3;
    if (this._layout === "row") return 1 + items;
    return 2 + Math.ceil(items / 2);
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: "full", rows: "auto", min_rows: 2 };
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    const ids: (string | undefined)[] = [];
    for (const item of this._config?.items ?? []) {
      ids.push(item.entity);
      // A `secondary` that names an entity is read on every render, so a change
      // to it has to let the tick through. Anything else is plain text and
      // simply never matches an entity id.
      if (item.secondary && this.hass?.states[item.secondary]) ids.push(item.secondary);
    }
    return hassChangeMatters(changed, this.hass, ids);
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this._scheduleTrendRefresh();
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    for (const timer of this._optimisticTimers.values()) window.clearTimeout(timer);
    this._optimisticTimers.clear();
    if (this._trendTimer !== undefined) window.clearInterval(this._trendTimer);
    this._trendTimer = undefined;
  }

  protected firstUpdated(changed: PropertyValues): void {
    super.firstUpdated(changed);
    this._resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      const narrow = width > 0 && width < STATUS_NARROW_PX;
      if (narrow !== this._narrow) this._narrow = narrow;
    });
    this._resizeObserver.observe(this);
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    this._clearConfirmedOptimistic();
    this._maybeFetchTrends();
  }

  // ---- language ------------------------------------------------------------

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  /**
   * A preset's own labels are stored as `@key` and resolved here, so the built-in
   * rules follow the dashboard's language while a user-written label is used
   * exactly as typed.
   */
  private _label(raw: string): string {
    return raw.startsWith("@") ? this._t(raw.slice(1) as TranslationKey) : raw;
  }

  // ---- layout --------------------------------------------------------------

  private get _layout(): "hero" | "grid" | "row" {
    const configured = this._config?.layout ?? "auto";
    if (configured !== "auto") return configured;
    return (this._config?.items?.length ?? 0) <= 1 ? "hero" : "grid";
  }

  // ---- value resolution ----------------------------------------------------

  private _rulesFor(item: M3StatusItemConfig): StatusRule[] {
    const own = item.states ?? [];
    const preset = item.preset ? (PRESETS[item.preset] ?? []) : [];
    return [...own, ...preset];
  }

  private _formatValue(item: M3StatusItemConfig, raw: string, numeric?: number): string {
    if (numeric === undefined) return raw;
    const decimals =
      item.decimals ?? Math.min(2, (raw.split(".")[1] ?? "").length);
    return formatNumber(this._language, numeric, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  private _resolve(item: M3StatusItemConfig, index: number): ResolvedItem {
    const key = item.entity ?? `item-${index}`;
    const stateObj = item.entity ? this.hass?.states[item.entity] : undefined;
    const fallbackColor = resolveThemeColor(
      item.color ?? this._config?.accent_color ?? DEFAULT_STATUS_ACCENT,
    );

    const rawValue =
      this._optimistic[item.entity ?? ""] ??
      (item.attribute
        ? stateObj?.attributes?.[item.attribute]
        : stateObj?.state);
    const raw = rawValue === undefined || rawValue === null ? "" : String(rawValue);
    const available = !!stateObj && !UNAVAILABLE_STATES.has(raw.toLowerCase());

    const name =
      item.name ??
      (stateObj?.attributes?.friendly_name as string | undefined) ??
      item.entity ??
      this._t("status_default_name");

    if (!available) {
      return {
        key,
        entityId: item.entity,
        name,
        icon: item.icon ?? DEFAULT_STATUS_ICON,
        // Deliberately neutral: an unreachable sensor keeping its green would
        // read as "everything is fine" at a glance, which is the opposite of
        // what it means.
        color: "var(--primary-text-color)",
        value: "—",
        unit: "",
        secondary: this._secondaryText(item),
        available: false,
        tapAction: item.tap_action ?? this._config?.tap_action,
        config: item,
      };
    }

    const numeric = numericState(raw);

    const rule = findStateRule(this._rulesFor(item), raw, numeric);

    const unitSource =
      item.unit ??
      (item.attribute
        ? undefined
        : (stateObj?.attributes?.unit_of_measurement as string | undefined));

    const value = rule?.label
      ? this._label(rule.label)
      : this._formatValue(item, raw, numeric);

    return {
      key,
      entityId: item.entity,
      name,
      icon: rule?.icon ?? item.icon ?? DEFAULT_STATUS_ICON,
      color: resolveThemeColor(rule?.color ?? item.color ?? this._config?.accent_color ?? DEFAULT_STATUS_ACCENT) || fallbackColor,
      value: `${item.prefix ?? ""}${value}`,
      // A matched rule replaced the reading with a word, so a unit no longer
      // belongs to it: "Ja kWh" is not a thing. The suffix is the user's own
      // text and always stands.
      unit: `${rule?.label ? "" : (unitSource ?? "")}${item.suffix ? ` ${item.suffix}` : ""}`.trim(),
      secondary: this._secondaryText(item),
      available: true,
      numeric,
      tapAction: item.tap_action ?? this._config?.tap_action,
      config: item,
    };
  }

  /** `secondary` is an entity id if one exists by that name, otherwise plain text. */
  private _secondaryText(item: M3StatusItemConfig): string | undefined {
    if (!item.secondary) return undefined;
    const stateObj = this.hass?.states[item.secondary];
    if (!stateObj) return item.secondary;
    const unit = stateObj.attributes?.unit_of_measurement as string | undefined;
    return unit ? `${stateObj.state} ${unit}` : stateObj.state;
  }

  private get _items(): ResolvedItem[] {
    return (this._config?.items ?? []).map((item, i) => this._resolve(item, i));
  }

  // ---- interaction ---------------------------------------------------------

  private _onTap(item: ResolvedItem, e: Event): void {
    e.stopPropagation();
    const action = item.tapAction ?? { action: "more-info" as const };
    if (action.action === "toggle" && item.entityId) this._optimisticToggle(item);
    handleAction(this, this.hass, action, item.entityId);
  }

  /**
   * Flips the shown state immediately, before HA has confirmed anything.
   *
   * A "medication given" card is tapped and then looked at, in that order. The
   * round trip to HA and back is short but not invisible, and without this the
   * card sits on the old answer for long enough to invite a second tap — which
   * would toggle it straight back.
   */
  private _optimisticToggle(item: ResolvedItem): void {
    const id = item.entityId;
    if (!id) return;
    const current = this.hass?.states[id]?.state;
    const next = current === "on" ? "off" : "on";
    this._optimistic = { ...this._optimistic, [id]: next };

    window.clearTimeout(this._optimisticTimers.get(id));
    // The timeout is the backstop for a service call that never lands (an
    // unavailable device, a lost connection). Without it the card would show a
    // state the system never reached, indefinitely.
    this._optimisticTimers.set(
      id,
      window.setTimeout(() => this._clearOptimistic(id), OPTIMISTIC_MS),
    );
  }

  private _clearOptimistic(id: string): void {
    if (!(id in this._optimistic)) return;
    const next = { ...this._optimistic };
    delete next[id];
    this._optimistic = next;
    window.clearTimeout(this._optimisticTimers.get(id));
    this._optimisticTimers.delete(id);
  }

  private _clearConfirmedOptimistic(): void {
    for (const [id, expected] of Object.entries(this._optimistic)) {
      if (this.hass?.states[id]?.state === expected) this._clearOptimistic(id);
    }
  }

  // ---- trend ---------------------------------------------------------------

  private _trendItems(): M3StatusItemConfig[] {
    return (this._config?.items ?? []).filter((i) => i.trend && i.entity);
  }

  private _scheduleTrendRefresh(): void {
    if (this._trendTimer !== undefined) return;
    this._trendTimer = window.setInterval(() => {
      this._trendKey = "";
      this._maybeFetchTrends();
    }, TREND_REFRESH_MS);
  }

  private _maybeFetchTrends(): void {
    const items = this._trendItems();
    if (!this.hass || items.length === 0) return;
    // Keyed by the whole request, so a config edit refetches and an ordinary
    // state tick does not.
    const key = items
      .map((i) => `${i.entity}@${i.trend_hours ?? STATUS_TREND_DEFAULT_HOURS}`)
      .join("|");
    if (key === this._trendKey) return;
    this._trendKey = key;
    void this._fetchTrends(items);
  }

  private async _fetchTrends(items: M3StatusItemConfig[]): Promise<void> {
    const hass = this.hass;
    if (!hass) return;
    // Grouped by period so entities sharing one comparison point cost a single
    // history call, which is the normal case — one card, one "vs. yesterday".
    const byHours = new Map<number, string[]>();
    for (const item of items) {
      const hours = item.trend_hours ?? STATUS_TREND_DEFAULT_HOURS;
      byHours.set(hours, [...(byHours.get(hours) ?? []), item.entity!]);
    }

    const next: Record<string, TrendResult> = {};
    for (const [hours, ids] of byHours) {
      const past = await fetchValueHoursAgo(hass, ids, hours);
      for (const id of ids) {
        const then = past.get(id);
        const now = parseFloat(hass.states[id]?.state ?? "");
        if (then === undefined || !Number.isFinite(now) || then === 0) continue;
        const percent = ((now - then) / Math.abs(then)) * 100;
        next[id] = {
          percent,
          direction:
            Math.abs(percent) < STATUS_TREND_DEADBAND_PCT
              ? "flat"
              : percent > 0
                ? "up"
                : "down",
        };
      }
    }
    this._trends = next;
  }

  private _trendCaption(item: M3StatusItemConfig): string {
    const hours = item.trend_hours ?? STATUS_TREND_DEFAULT_HOURS;
    return hours === 24
      ? this._t("status_trend_day")
      : this._t("status_trend_hours").replace("{n}", String(hours));
  }

  private _renderTrend(item: ResolvedItem): TemplateResult | typeof nothing {
    if (!item.config.trend || !item.entityId) return nothing;
    const trend = this._trends[item.entityId];
    if (!trend) return nothing;

    const rising = trend.direction === "up";
    // "Good" is not "up": for consumption or cost a fall is the win, and
    // colouring that red would read as an alarm on the best possible reading.
    const good = item.config.trend_inverted ? !rising : rising;
    const color =
      trend.direction === "flat"
        ? "var(--primary-text-color)"
        : good
          ? STATUS_COLOR_GOOD
          : STATUS_COLOR_BAD;
    const background = tintOn(this, color, undefined, STATUS_CHIP_TINT);
    const icon =
      trend.direction === "flat"
        ? "mdi:trending-neutral"
        : rising
          ? "mdi:trending-up"
          : "mdi:trending-down";
    const text =
      trend.direction === "flat"
        ? this._t("status_trend_unchanged")
        : `${trend.percent > 0 ? "+" : "−"}${formatNumber(this._language, Math.abs(trend.percent), { maximumFractionDigits: 0 })} %`;

    return html`
      <div class="trend-row">
        <div
          class="trend-chip"
          style=${`background: ${background}; color: ${foregroundOn(color, background, 4.5, this)};`}
        >
          <ha-icon icon=${icon}></ha-icon><span>${text}</span>
        </div>
        <span class="trend-caption">${this._trendCaption(item.config)}</span>
      </div>
    `;
  }

  // ---- rendering -----------------------------------------------------------

  private _valueSize(item: ResolvedItem): number {
    const configured = this._config?.value_size;
    if (typeof configured === "number" && configured > 0) return configured;
    const base =
      item.numeric !== undefined
        ? STATUS_VALUE_SIZE_NUMBER
        : item.value.length >= STATUS_VALUE_LONG_CHARS
          ? STATUS_VALUE_SIZE_LONG
          : STATUS_VALUE_SIZE_TEXT;
    // One step down on a narrow card, using the same ladder rather than a
    // percentage, so the sizes stay on the scale.
    if (!this._narrow) return base;
    return base === STATUS_VALUE_SIZE_NUMBER
      ? STATUS_VALUE_SIZE_TEXT
      : STATUS_VALUE_SIZE_LONG;
  }

  private _iconWell(color: string, size: number, radius: number, icon: string): TemplateResult {
    const background = tintOn(this, color, this._config?.accent_opacity, STATUS_ICON_TINT);
    return html`
      <div
        class="well"
        style=${`width: ${size}px; height: ${size}px; border-radius: ${radius}px; background: ${background}; color: ${foregroundOn(color, background, 3, this)}; --mdc-icon-size: ${Math.round(size * 0.52)}px;`}
      >
        <ha-icon icon=${icon}></ha-icon>
      </div>
    `;
  }

  private _renderHero(item: ResolvedItem, surface: string): TemplateResult {
    const badge = this._config?.hero_style === "badge";
    const size = this._valueSize(item);
    const ink = item.available
      ? foregroundOn(item.color, surface, 4.5, this)
      : "var(--primary-text-color)";

    // The badge is a solid fill carrying an icon, so its ink is chosen between
    // two known-good inks rather than nudged — shifting the user's colour under
    // their own glyph is not the same problem as making a label readable.
    const badgeFill = fillColor(this, item.color, 3);
    const changed = this._lastValues.get(item.key) !== item.value;
    this._lastValues.set(item.key, item.value);

    return html`
      <div class="hero ${item.available ? "" : "dimmed"}">
        ${badge
          ? html`
              <div
                class="badge ${changed && shouldAnimate(this._config?.animation) ? "morph" : ""}"
                style=${`background: ${badgeFill}; color: ${inkOn(badgeFill, this)};`}
              >
                <ha-icon icon=${item.icon}></ha-icon>
              </div>
            `
          : html`
              <div class="hero-head">
                ${this._iconWell(item.color, STATUS_HERO_ICON, STATUS_HERO_ICON_RADIUS, item.icon)}
                <span class="hero-label">${item.name}</span>
              </div>
            `}
        <div
          class="hero-value"
          style=${`font-size: ${size}px; color: ${ink};`}
          title=${item.value}
        >
          <span class="hero-number">${item.value}</span>
          ${item.unit
            ? html`<span class="hero-unit" style=${`font-size: ${Math.round(size * STATUS_UNIT_RATIO)}px;`}>${item.unit}</span>`
            : nothing}
        </div>
        ${badge ? html`<div class="hero-caption">${item.name}</div>` : nothing}
        ${item.secondary ? html`<div class="hero-secondary">${item.secondary}</div>` : nothing}
        ${this._renderTrend(item)}
      </div>
    `;
  }

  private _renderTile(item: ResolvedItem): TemplateResult {
    const background = item.available
      ? tintOn(this, item.color, undefined, STATUS_TILE_TINT)
      : tintOn(this, "var(--primary-text-color)", undefined, 6);
    const ink = item.available
      ? foregroundOn(item.color, background, 4.5, this)
      : "var(--primary-text-color)";
    const interactive = isActionable(item.tapAction) && item.available;

    return html`
      <div
        class="tile ${item.available ? "" : "dimmed"}"
        style=${`background: ${background};`}
        role=${interactive ? "button" : nothing}
        tabindex=${interactive ? "0" : nothing}
        aria-label=${interactive ? `${item.name}: ${item.value}` : nothing}
        @click=${interactive ? (e: Event) => this._onTap(item, e) : nothing}
        @keydown=${interactive ? activateOnKey((e: Event) => this._onTap(item, e)) : nothing}
      >
        ${this._iconWell(item.color, STATUS_TILE_ICON, STATUS_TILE_ICON_RADIUS, item.icon)}
        <div class="tile-value" style=${`color: ${ink};`} title=${item.value}>
          ${item.value}${item.unit ? html`<span class="tile-unit"> ${item.unit}</span>` : nothing}
        </div>
        <div class="tile-label" title=${item.name}>${item.name}</div>
      </div>
    `;
  }

  private _renderRow(item: ResolvedItem): TemplateResult {
    const background = tintOn(this, "var(--primary-text-color)", undefined, 6);
    const ink = item.available
      ? foregroundOn(item.color, background, 4.5, this)
      : "var(--primary-text-color)";
    const interactive = isActionable(item.tapAction) && item.available;

    return html`
      <div
        class="row ${item.available ? "" : "dimmed"}"
        style=${`background: ${background};`}
        role=${interactive ? "button" : nothing}
        tabindex=${interactive ? "0" : nothing}
        aria-label=${interactive ? `${item.name}: ${item.value}` : nothing}
        @click=${interactive ? (e: Event) => this._onTap(item, e) : nothing}
        @keydown=${interactive ? activateOnKey((e: Event) => this._onTap(item, e)) : nothing}
      >
        ${this._iconWell(item.color, 30, 11, item.icon)}
        <span class="row-name" title=${item.name}>${item.name}</span>
        <span class="row-value" style=${`color: ${ink};`}>
          ${item.value}${item.unit ? html`<span class="row-unit"> ${item.unit}</span>` : nothing}
        </span>
      </div>
    `;
  }

  protected render(): TemplateResult | typeof nothing {
    const cfg = this._config;
    if (!cfg) return nothing;
    if (!this.hass) return nothing;

    const items = this._items;
    const layout = this._layout;
    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } =
      resolveCommonColors(cfg);

    const hero = layout === "hero" ? items[0] : undefined;
    // The hero washes the whole card in its own colour; a grid cannot, because
    // its items disagree about what the colour would be.
    const tint =
      hero && hero.available
        ? tintOn(this, hero.color, cfg.accent_opacity, STATUS_CARD_TINT)
        : "";
    // What is actually painted behind the hero text, so its ink is measured
    // against the right thing whichever of the three is in play.
    const surface =
      cardBackgroundCss ||
      tint ||
      "var(--ha-card-background, var(--card-background-color))";
    const glass = cfg.glass_background !== false;
    // Taken to 55% rather than laid down solid, which is exactly what the glass
    // frame does to the card surface itself. Painting the tint opaque would
    // switch the frosted card off wherever a hero happened to be coloured.
    const painted = cardBackgroundCss
      ? cardBackgroundCss
      : tint
        ? glass
          ? `color-mix(in srgb, ${tint} 55%, transparent)`
          : tint
        : "";

    const cssVars = buildCssVars({
      "m3p-text": textColorCss,
      "m3p-secondary-text": secondaryTextColorCss,
      "status-columns":
        cfg.columns && cfg.columns > 0 && !this._narrow
          ? `repeat(${cfg.columns}, minmax(0, 1fr))`
          : this._narrow
            ? "minmax(0, 1fr)"
            : `repeat(auto-fit, minmax(${STATUS_GRID_MIN}px, 1fr))`,
    });
    const radius = resolveCornerRadius(cfg.radius ?? DEFAULT_STATUS_RADIUS, cfg.corners);

    const heroInteractive = !!hero && isActionable(hero.tapAction) && hero.available;

    const body =
      items.length === 0
        ? html`<div class="empty">${this._t("status_empty")}</div>`
        : layout === "hero"
          ? this._renderHero(hero!, surface)
          : layout === "row"
            ? html`<div class="rows">${items.map((i) => this._renderRow(i))}</div>`
            : html`<div class="grid">${items.map((i) => this._renderTile(i))}</div>`;

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(cfg.glass_background)} layout-${layout} ${
            shouldAnimate(cfg.animation) ? "" : "no-animations"
          } ${heroInteractive ? "tappable" : ""}"
          style=${`border-radius: ${radius};${painted ? ` background: ${painted};` : ""}`}
          role=${heroInteractive ? "button" : nothing}
          tabindex=${heroInteractive ? "0" : nothing}
          aria-label=${heroInteractive ? `${hero!.name}: ${hero!.value}` : nothing}
          @click=${heroInteractive ? (e: Event) => this._onTap(hero!, e) : nothing}
          @keydown=${heroInteractive ? activateOnKey((e: Event) => this._onTap(hero!, e)) : nothing}
        >
          ${cfg.title && layout !== "hero"
            ? html`<div class="card-title">${cfg.title}</div>`
            : nothing}
          ${body}
        </div>
      </ha-card>
    `;
  }

  static styles = [
    glassCardStyles,
    css`
      .card-inner {
        gap: 10px;
      }

      .card-inner.tappable {
        cursor: pointer;
      }

      .card-inner:focus-visible,
      .tile:focus-visible,
      .row:focus-visible {
        outline: 2px solid var(--m3p-text, var(--primary-text-color));
        outline-offset: -2px;
      }

      .card-title {
        font-size: 12px;
        font-weight: 700;
        color: var(--m3p-text, var(--primary-text-color));
      }

      .empty {
        font-size: 12px;
        opacity: 0.6;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
      }

      .well {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .dimmed {
        opacity: 0.4;
      }

      /* ---- hero ---- */

      .hero {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 0;
      }

      .hero-head {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }

      .hero-label {
        font-size: ${STATUS_HERO_LABEL_SIZE}px;
        font-weight: 600;
        opacity: 0.6;
        color: var(--m3p-text, var(--primary-text-color));
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .badge {
        width: ${STATUS_BADGE}px;
        height: ${STATUS_BADGE}px;
        border-radius: ${STATUS_BADGE_RADIUS}px;
        display: flex;
        align-items: center;
        justify-content: center;
        --mdc-icon-size: 28px;
        transition: border-radius ${unsafeCSS(STATUS_BADGE_MORPH_MS)}ms ${EASING};
      }

      .badge.morph {
        animation: badge-morph ${unsafeCSS(STATUS_BADGE_MORPH_MS)}ms ${EASING};
      }

      @keyframes badge-morph {
        0% {
          border-radius: ${STATUS_BADGE_RADIUS}px;
        }
        45% {
          border-radius: ${STATUS_BADGE_RADIUS_MORPH}px;
          transform: scale(1.06);
        }
        100% {
          border-radius: ${STATUS_BADGE_RADIUS}px;
        }
      }

      .hero-value {
        display: flex;
        align-items: baseline;
        gap: 6px;
        min-width: 0;
        font-weight: 700;
        line-height: 1.05;
        letter-spacing: ${STATUS_VALUE_LETTER_SPACING}px;
        font-variant-numeric: tabular-nums;
      }

      .hero-number {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .hero-unit {
        flex-shrink: 0;
        font-weight: 700;
        opacity: 0.6;
        letter-spacing: 0;
      }

      .hero-caption {
        font-size: 13px;
        font-weight: 700;
        color: var(--m3p-text, var(--primary-text-color));
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .hero-secondary {
        font-size: ${STATUS_SECONDARY_SIZE}px;
        opacity: 0.4;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* ---- trend ---- */

      .trend-row {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }

      .trend-chip {
        flex-shrink: 0;
        height: ${STATUS_TREND_HEIGHT}px;
        border-radius: ${STATUS_TREND_RADIUS}px;
        padding: 0 9px;
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        font-weight: 700;
        --mdc-icon-size: 14px;
      }

      .trend-caption {
        font-size: 11px;
        opacity: 0.5;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* ---- grid ---- */

      .grid {
        display: grid;
        grid-template-columns: var(--status-columns);
        gap: ${STATUS_GRID_GAP}px;
      }

      .tile {
        min-width: 0;
        padding: 10px 9px;
        border-radius: ${STATUS_TILE_RADIUS}px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        transition: border-radius ${unsafeCSS(STATUS_TILE_MORPH_MS)}ms ${EASING};
      }

      .tile[role="button"] {
        cursor: pointer;
      }

      .tile[role="button"]:active {
        border-radius: ${STATUS_TILE_RADIUS_ACTIVE}px;
      }

      .tile-value {
        font-size: ${STATUS_TILE_VALUE_SIZE}px;
        font-weight: 700;
        line-height: 1.1;
        font-variant-numeric: tabular-nums;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tile-unit {
        font-size: ${Math.round(STATUS_TILE_VALUE_SIZE * 0.6)}px;
        opacity: 0.7;
      }

      .tile-label {
        font-size: ${STATUS_TILE_LABEL_SIZE}px;
        font-weight: 600;
        letter-spacing: 0.2px;
        opacity: 0.5;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* ---- rows ---- */

      .rows {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .row {
        height: ${STATUS_ROW_HEIGHT}px;
        border-radius: ${STATUS_ROW_RADIUS}px;
        padding: 0 12px 0 9px;
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
        transition: border-radius ${unsafeCSS(STATUS_TILE_MORPH_MS)}ms ${EASING};
      }

      .row[role="button"] {
        cursor: pointer;
      }

      .row[role="button"]:active {
        border-radius: ${STATUS_TILE_RADIUS_ACTIVE}px;
      }

      .row-name {
        flex: 1;
        min-width: 0;
        font-size: 13px;
        font-weight: 500;
        color: var(--m3p-text, var(--primary-text-color));
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .row-value {
        flex-shrink: 0;
        font-size: 14px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }

      .row-unit {
        font-size: 11px;
        opacity: 0.7;
      }

      .no-animations .badge,
      .no-animations .tile,
      .no-animations .row {
        transition: none;
        animation: none;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-status-card": M3StatusCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-status-card",
  name: "M3 Status Card",
  description:
    "Zeigt Werte, Texte und Ja/Nein-Zustände groß und farbig — einzeln oder als Raster.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
