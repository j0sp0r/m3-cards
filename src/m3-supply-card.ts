import { LitElement, html, css, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  M3SupplyCardConfig,
  SupplyItemConfig,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_SUPPLY_RADIUS,
  DEFAULT_SUPPLY_ICON,
  SUPPLY_HERO_ICON_SIZE,
  SUPPLY_HERO_ICON_RADIUS,
  SUPPLY_ROW_HEIGHT,
  SUPPLY_ROW_RADIUS,
  SUPPLY_ICON_SIZE,
  SUPPLY_ICON_RADIUS,
  SUPPLY_ROW_GAP,
  SUPPLY_DOTS_MAX,
  SUPPLY_DOT_HEIGHT,
  SUPPLY_DOT_RADIUS,
  SUPPLY_DOT_GAP,
  SUPPLY_BAR_HEIGHT,
  SUPPLY_BAR_RADIUS,
  SUPPLY_ACTION_HEIGHT,
  SUPPLY_ACTION_GAP,
  SUPPLY_STEPPER_WIDTH,
  SUPPLY_STEPPER_RADIUS_OUTER,
  SUPPLY_STEPPER_RADIUS_INNER,
  SUPPLY_REFILL_RADIUS,
  SUPPLY_REFILL_RADIUS_ACTIVE,
  SUPPLY_REFILL_MORPH_MS,
  SUPPLY_REPEAT_MS,
  SUPPLY_COLOR_OK,
  SUPPLY_COLOR_LOW,
  SUPPLY_COLOR_CRITICAL,
  SUPPLY_COLOR_UNAVAILABLE,
  SUPPLY_DEFAULT_RATE_WINDOW_DAYS,
  SUPPLY_MIN_EVENTS,
  SUPPLY_MIN_SPAN_DAYS,
  SUPPLY_FLIP_DURATION_MS,
  SUPPLY_CHIP_RADIUS,
  SUPPLY_RATE_REFRESH_MS,
  resolveCornerRadius,
} from "./const";
import { supplyPackSize, supplyLimits } from "./shared/supply-thresholds";
import { fetchConsumptionRates, type ConsumptionRate } from "./shared/supply-history";
import { resolveThemeColor, buildCssVars, resolveCommonColors, tintOn, tintInk, foregroundOn , foregroundVars} from "./shared/color-config";
import { glassCardStyles, glassCardClass } from "./shared/glass-card";
import { renderListRow, captureRowRects, flipRows, listRowStyles, listRowSurface } from "./shared/list-row";
import { repeat } from "lit/directives/repeat.js";
import { activateOnKey } from "./shared/a11y";
import { STANDARD_EASING, shouldAnimate } from "./shared/animation";
import { localize, type TranslationKey } from "./localize";
import { hassChangeMatters, listEntities } from "./shared/should-update";
import { formatNumber } from "./shared/formatting";
import { TemplatedCard } from "./shared/templated-card";

console.info(
  `%c M3-SUPPLY-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #85b7eb; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #85b7eb; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

const EASING = unsafeCSS(STANDARD_EASING);

type SupplyStage = "ok" | "low" | "critical" | "unavailable";

interface SupplyEntry {
  config: SupplyItemConfig;
  entityId: string;
  name: string;
  icon: string;
  /** Current remaining count; NaN when the helper is unavailable. */
  value: number;
  packSize: number;
  /** Lowest value the helper itself accepts, so "−" can stop there. */
  min: number;
  max?: number;
  step: number;
  unit?: string;
  stage: SupplyStage;
  colorCss: string;
  available: boolean;
}

@customElement("m3-supply-card")
export class M3SupplyCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3SupplyCardConfig;
  /** Entity id of the item the user promoted to hero by tapping a row. */
  @state() private _heroOverride?: string;
  @state() private _morphing = false;

  @state() private _rates = new Map<string, ConsumptionRate>();
  /** Items put on the todo list from this card, so the chip can confirm it. */
  @state() private _addedToList = new Set<string>();

  private _rowRects: Map<string, DOMRect> = new Map();
  private _repeatTimer?: number;
  private _morphTimer?: number;
  private _refreshTimer?: number;
  private _lastRateKey?: string;
  private _rateInFlight = false;

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-supply-card-editor");
    return document.createElement(
      "m3-supply-card-editor",
    ) as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(hass: HomeAssistant): M3SupplyCardConfig {
    const helper =
      Object.keys(hass?.states ?? {}).find((eid) => eid.startsWith("counter.")) ??
      Object.keys(hass?.states ?? {}).find((eid) => eid.startsWith("input_number.")) ??
      "";
    return {
      type: "custom:m3-supply-card",
      items: helper ? [{ entity: helper }] : [],
    };
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return hassChangeMatters(changed, this.hass, [
      this._config?.todo_entity,
      ...listEntities(this._config?.items),
    ]);
  }

  public setConfig(config: M3SupplyCardConfig): void {
    this._config = {
      glass_background: true,
      animation: "auto",
      layout: "hero_and_list",
      refill_mode: "set",
      list_tap_action: "hero",
      ...config,
    };
    this._heroOverride = undefined;
  }

  public getCardSize(): number {
    return 4;
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: "full", rows: "auto", min_rows: 3 };
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopRepeat();
    if (this._morphTimer) clearTimeout(this._morphTimer);
    if (this._refreshTimer !== undefined) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = undefined;
    }
  }

  protected willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    // Snapshot where every row sits before this render, so the rows that move
    // when the hero changes can be animated from their old position instead
    // of jumping straight to the new layout.
    this._rowRects = captureRowRects(this.renderRoot);
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    if (shouldAnimate(this._config?.animation)) {
      flipRows(this.renderRoot, this._rowRects, SUPPLY_FLIP_DURATION_MS);
    }
    this._ensureRefreshTimer();
    this._maybeFetchRates();
  }

  private _ensureRefreshTimer(): void {
    if (this._refreshTimer !== undefined) return;
    // Consumption moves over days, so a slow refresh is plenty; the counter
    // value itself updates live through hass, independent of this.
    this._refreshTimer = window.setInterval(() => {
      this._lastRateKey = undefined;
      this._maybeFetchRates();
    }, SUPPLY_RATE_REFRESH_MS);
  }

  private _maybeFetchRates(): void {
    if (!this.hass || !this._config) return;
    const ids = this._rateEntityIds();
    if (!ids.length) return;
    const window = this._config.rate_window ?? SUPPLY_DEFAULT_RATE_WINDOW_DAYS;
    const key = `${ids.join(",")}|${window}`;
    if (key === this._lastRateKey) return;
    this._lastRateKey = key;
    this._fetchRates(ids, window);
  }

  // Items with an explicit usage_per_week never need history, so they are left
  // out of the request rather than fetched and discarded.
  private _rateEntityIds(): string[] {
    const cardOverride = this._config?.usage_per_week;
    return (this._config?.items ?? [])
      .filter((item) => item.entity && !(item.usage_per_week ?? cardOverride))
      .map((item) => item.entity);
  }

  private async _fetchRates(ids: string[], windowDays: number): Promise<void> {
    if (!this.hass || this._rateInFlight) return;
    this._rateInFlight = true;
    try {
      this._rates = await fetchConsumptionRates(
        this.hass,
        ids,
        windowDays,
        SUPPLY_MIN_EVENTS,
        SUPPLY_MIN_SPAN_DAYS,
      );
    } finally {
      this._rateInFlight = false;
    }
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey, vars?: Record<string, string | number>): string {
    let out = localize(key, this._language);
    for (const [k, v] of Object.entries(vars ?? {})) {
      out = out.replaceAll(`{${k}}`, String(v));
    }
    return out;
  }

  // ---- data -------------------------------------------------------------

  private _buildEntries(): SupplyEntry[] {
    const hass = this.hass;
    const cfg = this._config;
    if (!hass || !cfg) return [];

    return (cfg.items ?? []).map((item) => {
      const st = hass.states[item.entity];
      const attrs = st?.attributes ?? {};
      const available = !!st && st.state !== "unavailable" && st.state !== "unknown";
      const value = available ? Number(st.state) : NaN;

      // counter helpers expose minimum/maximum/step, input_number min/max/step.
      const max = (attrs.maximum ?? attrs.max) as number | undefined;
      const min = ((attrs.minimum ?? attrs.min) as number | undefined) ?? 0;
      const step = ((attrs.step as number | undefined) ?? 1) || 1;

      const packSize = supplyPackSize(item, st);

      const stage = this._stageFor(value, packSize, item, available);
      return {
        config: item,
        entityId: item.entity,
        name: item.name ?? (attrs.friendly_name as string | undefined) ?? item.entity,
        icon: item.icon ?? (attrs.icon as string | undefined) ?? DEFAULT_SUPPLY_ICON,
        value,
        packSize,
        min,
        max,
        step,
        unit: item.unit,
        stage,
        colorCss: this._colorFor(stage, item),
        available,
      };
    });
  }

  // Defaults are derived from pack_size so a 60-tab box and a 4-filter pack
  // both get proportional warnings: "low" at 25% left, "critical" at 10%,
  // each never below one unit.
  private _stageFor(
    value: number,
    packSize: number,
    item: SupplyItemConfig,
    available: boolean,
  ): SupplyStage {
    if (!available || isNaN(value)) return "unavailable";
    const { low, critical } = supplyLimits(packSize, item);
    if (value <= critical) return "critical";
    if (value <= low) return "low";
    return "ok";
  }

  private _colorFor(stage: SupplyStage, item: SupplyItemConfig): string {
    const cfg: Partial<M3SupplyCardConfig> = this._config ?? {};
    if (stage === "unavailable") {
      return resolveThemeColor(cfg.unavailable_color ?? SUPPLY_COLOR_UNAVAILABLE);
    }
    if (stage === "critical") {
      return resolveThemeColor(cfg.critical_color ?? SUPPLY_COLOR_CRITICAL);
    }
    if (stage === "low") return resolveThemeColor(cfg.low_color ?? SUPPLY_COLOR_LOW);
    // A healthy item keeps its own configured colour, so a dashboard can give
    // each supply its own identity; the shared ok_color is the fallback.
    return resolveThemeColor(item.color ?? cfg.ok_color ?? SUPPLY_COLOR_OK);
  }

  private _pickHero(entries: SupplyEntry[]): number {
    if (!entries.length) return -1;
    if (this._heroOverride) {
      const i = entries.findIndex((e) => e.entityId === this._heroOverride);
      if (i >= 0) return i;
    }
    const configured = this._config?.hero;
    if (typeof configured === "number" && entries[configured]) return configured;
    if (typeof configured === "string") {
      const i = entries.findIndex((e) => e.entityId === configured);
      if (i >= 0) return i;
    }
    // Without an explicit choice the most urgent item leads: lowest fill
    // ratio, so the thing closest to running out is the one you see first.
    let best = 0;
    let bestRatio = Infinity;
    entries.forEach((e, i) => {
      if (!e.available) return;
      const ratio = e.packSize > 0 ? e.value / e.packSize : Infinity;
      if (ratio < bestRatio) {
        bestRatio = ratio;
        best = i;
      }
    });
    return best;
  }

  // ---- subtitle ---------------------------------------------------------

  private _subtitle(entry: SupplyEntry): string {
    if (!entry.available) return this._t("unavailable");
    if (entry.value <= 0) return this._t("supply_empty");
    if (entry.stage === "critical") {
      return this._t("supply_critical", { n: this._formatCount(entry.value) });
    }
    const perDay = this._perDay(entry);
    if (perDay && perDay > 0) return this._formatRange(entry.value / perDay);
    // Too little history to extrapolate from — a bare count beats a made-up
    // estimate, and the number is what the user would check anyway.
    return this._t("supply_of", {
      n: this._formatCount(entry.value),
      max: this._formatCount(entry.packSize),
    });
  }

  /** Configured usage wins over the measured rate; both are per day here. */
  private _perDay(entry: SupplyEntry): number | undefined {
    const perWeek = entry.config.usage_per_week ?? this._config?.usage_per_week;
    if (perWeek && perWeek > 0) return perWeek / 7;
    return this._rates.get(entry.entityId)?.perDay;
  }

  private _formatCount(value: number): string {
    return formatNumber(this._language, value, {
      maximumFractionDigits: Number.isInteger(value) ? 0 : 1,
    });
  }

  // Picks the coarsest unit that still reads as a useful number, so a long
  // range says "about 3 months" instead of "about 94 days".
  private _formatRange(days: number): string {
    if (days < 1.5) return this._t("supply_range_day");
    if (days < 14) return this._t("supply_range_days", { n: Math.round(days) });
    if (days < 21) return this._t("supply_range_week");
    if (days < 60) return this._t("supply_range_weeks", { n: Math.round(days / 7) });
    if (days < 75) return this._t("supply_range_month");
    return this._t("supply_range_months", { n: Math.round(days / 30) });
  }

  // ---- actions ----------------------------------------------------------

  private _setValue(entry: SupplyEntry, value: number): void {
    if (!this.hass) return;
    const domain = entry.entityId.split(".")[0];
    let target = value;
    if (typeof entry.max === "number") target = Math.min(target, entry.max);
    target = Math.max(target, entry.min);
    this.hass.callService(domain, "set_value", {
      entity_id: entry.entityId,
      value: target,
    });
  }

  private _step(entry: SupplyEntry, direction: 1 | -1): void {
    if (!this.hass || !entry.available) return;
    const domain = entry.entityId.split(".")[0];
    const next = entry.value + direction * entry.step;
    if (next < entry.min || (typeof entry.max === "number" && next > entry.max)) return;
    // Both counter and input_number ship increment/decrement, which keeps
    // their own clamping authoritative instead of racing our local value.
    this.hass.callService(domain, direction > 0 ? "increment" : "decrement", {
      entity_id: entry.entityId,
    });
  }

  private _refill(entry: SupplyEntry): void {
    if (!this.hass || !entry.available) return;
    const mode = this._config?.refill_mode ?? "set";
    this._setValue(entry, mode === "add" ? entry.value + entry.packSize : entry.packSize);

    if (!shouldAnimate(this._config?.animation)) return;
    this._morphing = true;
    if (this._morphTimer) clearTimeout(this._morphTimer);
    this._morphTimer = window.setTimeout(() => {
      this._morphing = false;
    }, SUPPLY_REFILL_MORPH_MS);
  }

  // Holding − or + keeps stepping, so correcting a count by ten taps once.
  private _startRepeat(entry: SupplyEntry, direction: 1 | -1): (e: Event) => void {
    return (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      this._step(entry, direction);
      this._stopRepeat();
      this._repeatTimer = window.setInterval(() => {
        const fresh = this._buildEntries().find((x) => x.entityId === entry.entityId);
        if (!fresh) return this._stopRepeat();
        this._step(fresh, direction);
      }, SUPPLY_REPEAT_MS);
    };
  }

  private _stopRepeat = (): void => {
    if (this._repeatTimer) {
      clearInterval(this._repeatTimer);
      this._repeatTimer = undefined;
    }
  };

  /** Free text for the list; the item name is the obvious default. */
  private _shoppingText(entry: SupplyEntry): string {
    return entry.config.shopping_item?.trim() || entry.name;
  }

  private _addToList(entry: SupplyEntry): void {
    const todo = this._config?.todo_entity;
    if (!this.hass || !todo) return;
    this.hass.callService(
      "todo",
      "add_item",
      { item: this._shoppingText(entry) },
      { entity_id: todo },
    );
    // Marked locally rather than by reading the list back: the chip only has
    // to stop inviting a second tap in this session, and a todo list has no
    // state attribute listing its entries.
    this._addedToList = new Set(this._addedToList).add(entry.entityId);
  }

  private _onRowTap(entry: SupplyEntry): () => void {
    return () => {
      if (this._config?.list_tap_action === "more-info") {
        this.dispatchEvent(
          new CustomEvent("hass-more-info", {
            detail: { entityId: entry.entityId },
            bubbles: true,
            composed: true,
          }),
        );
        return;
      }
      this._heroOverride = entry.entityId;
    };
  }

  // ---- render -----------------------------------------------------------

  protected render() {
    const cfg = this._config;
    if (!cfg) return nothing;

    const entries = this._buildEntries();
    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } =
      resolveCommonColors(cfg);
    const heroIndex = this._pickHero(entries);
    const hero = heroIndex >= 0 ? entries[heroIndex] : undefined;
    const layout = cfg.layout ?? "hero_and_list";
    // With no hero on screen, nothing may be held back for it — filtering the
    // hero out regardless would silently drop one supply from the card.
    const rest =
      layout === "list_only" ? entries : entries.filter((_, i) => i !== heroIndex);

    const cssVars = buildCssVars({
      "m3s-text": textColorCss,
      "m3s-secondary-text": secondaryTextColorCss,
      "m3s-radius": resolveCornerRadius(cfg.radius ?? DEFAULT_SUPPLY_RADIUS, cfg.corners),
      "m3s-accent": hero?.colorCss,
      "lr-row-height": `${SUPPLY_ROW_HEIGHT}px`,
      "lr-row-radius": `${SUPPLY_ROW_RADIUS}px`,
      "lr-icon-size": `${SUPPLY_ICON_SIZE}px`,
      "lr-icon-radius": `${SUPPLY_ICON_RADIUS}px`,
      "lr-row-gap": `${SUPPLY_ROW_GAP}px`,
      // Fills keep the accent; these twins carry it where it is text.
      ...foregroundVars(this, {
        "m3s-accent": hero?.colorCss,
      }),
    });

    const style = cardBackgroundCss
      ? `${cssVars} --ha-card-background: ${cardBackgroundCss};`
      : cssVars;

    return html`
      <ha-card style=${style}>
        <div
          class="card-inner ${glassCardClass(cfg.glass_background)} ${shouldAnimate(cfg.animation) ? "" : "no-animations"}"
        >
          ${!entries.length
            ? html`<div class="empty">${this._t("supply_no_items")}</div>`
            : nothing}
          ${hero && layout !== "list_only"
            ? // Keyed on the entity so switching hero replaces the node rather
              // than patching it in place — a CSS entry animation only runs on
              // a freshly mounted element, and a value change on the same
              // supply must not restart it.
              repeat([hero], (h) => h.entityId, (h) => this._renderHero(h))
            : nothing}
          ${rest.length && layout !== "hero_only"
            ? html`
                <div class="section-title">${this._t("supply_more")}</div>
                <div class="row-list">${rest.map((e) => this._renderRow(e))}</div>
              `
            : nothing}
        </div>
      </ha-card>
    `;
  }

  private _renderHero(entry: SupplyEntry): TemplateResult {
    const cfg: Partial<M3SupplyCardConfig> = this._config ?? {};
    const tint = tintOn(this, entry.colorCss, cfg.accent_opacity, 18);
    const dimmed = entry.available ? "" : "dimmed";

    return html`
      <div class="hero ${dimmed}" style=${`--m3s-accent: ${entry.colorCss};`}>
        <div class="hero-head">
          <div class="hero-icon" style=${`background: ${tintOn(this, entry.colorCss, undefined, 18)}; color: ${tintInk(this, entry.colorCss, undefined, 18, 3)};`}>
            <ha-icon icon=${entry.icon}></ha-icon>
          </div>
          <div class="hero-text">
            <div class="hero-name">${entry.name}</div>
            <div class="hero-sub ${entry.stage === "critical" || entry.value <= 0 ? "alert" : ""}">
              ${this._subtitle(entry)}
            </div>
          </div>
          <div class="hero-value">
            <div class="hero-number">
              <span class="hero-count">${entry.available ? this._formatCount(entry.value) : "–"}</span>
              <span class="hero-max">/ ${this._formatCount(entry.packSize)}</span>
            </div>
            ${entry.unit
              ? html`<div class="hero-unit">${entry.unit} ${this._t("supply_left")}</div>`
              : nothing}
          </div>
        </div>

        ${this._renderFill(entry)}
        ${this._renderShoppingChip(entry)}

        <div class="actions">
          <div
            class="step step-minus"
            role="button"
            tabindex="0"
            aria-label=${this._t("supply_decrement")}
            ?disabled=${!entry.available || entry.value <= entry.min}
            @pointerdown=${this._startRepeat(entry, -1)}
            @pointerup=${this._stopRepeat}
            @pointerleave=${this._stopRepeat}
            @pointercancel=${this._stopRepeat}
            @keydown=${activateOnKey(() => this._step(entry, -1))}
          >
            <ha-icon icon="mdi:minus"></ha-icon>
          </div>

          <div
            class="refill ${this._morphing ? "morph" : ""}"
            role="button"
            tabindex="0"
            aria-label=${this._t("supply_refill")}
            style=${`background: ${tint}; color: ${tintInk(this, entry.colorCss, cfg.accent_opacity, 18)};`}
            @click=${() => this._refill(entry)}
            @keydown=${activateOnKey(() => this._refill(entry))}
          >
            <ha-icon icon="mdi:package-variant"></ha-icon>
            <span>${this._t("supply_refill")}</span>
          </div>

          <div
            class="step step-plus"
            role="button"
            tabindex="0"
            aria-label=${this._t("supply_increment")}
            ?disabled=${!entry.available || (typeof entry.max === "number" && entry.value >= entry.max)}
            @pointerdown=${this._startRepeat(entry, 1)}
            @pointerup=${this._stopRepeat}
            @pointerleave=${this._stopRepeat}
            @pointercancel=${this._stopRepeat}
            @keydown=${activateOnKey(() => this._step(entry, 1))}
          >
            <ha-icon icon="mdi:plus"></ha-icon>
          </div>
        </div>
      </div>
    `;
  }

  // Only offered once a supply actually needs restocking, and only when a list
  // is configured — an always-visible button would be noise on a full pack.
  private _renderShoppingChip(entry: SupplyEntry) {
    if (!this._config?.todo_entity || !entry.available) return nothing;
    if (entry.stage !== "critical" && entry.value > 0) return nothing;
    const done = this._addedToList.has(entry.entityId);
    return html`
      <div
        class="shop-chip ${done ? "done" : ""}"
        role=${done ? nothing : "button"}
        tabindex=${done ? nothing : "0"}
        aria-label=${this._t("supply_add_to_list")}
        @click=${done ? nothing : () => this._addToList(entry)}
        @keydown=${done ? nothing : activateOnKey(() => this._addToList(entry))}
      >
        <ha-icon icon=${done ? "mdi:check" : "mdi:cart-plus"}></ha-icon>
        <span>${this._t(done ? "supply_added_to_list" : "supply_add_to_list")}</span>
      </div>
    `;
  }

  // One dot per unit while that stays legible, a proportional bar once a pack
  // is too large for dots to be countable at a glance.
  private _renderFill(entry: SupplyEntry): TemplateResult {
    const value = entry.available ? Math.max(0, entry.value) : 0;
    if (entry.packSize > SUPPLY_DOTS_MAX) {
      const pct = entry.packSize > 0 ? Math.min(100, (value / entry.packSize) * 100) : 0;
      return html`
        <div class="fill-bar">
          <div class="fill-bar-value" style=${`width: ${pct}%;`}></div>
        </div>
      `;
    }
    const filled = Math.min(entry.packSize, Math.floor(value));
    // More than a full pack on hand: show the pack as full and count the
    // surplus in a badge rather than silently hiding it.
    const overflow = Math.max(0, Math.floor(value) - entry.packSize);
    return html`
      <div class="fill-dots">
        ${Array.from({ length: entry.packSize }, (_, i) => html`
          <div class="dot ${i < filled ? "on" : ""}"></div>
        `)}
        ${overflow > 0 ? html`<div class="overflow">+${overflow}</div>` : nothing}
      </div>
    `;
  }

  private _renderRow(entry: SupplyEntry): TemplateResult {
    const fraction = entry.packSize > 0 && entry.available
      ? Math.max(0, Math.min(1, entry.value / entry.packSize))
      : 0;
    return renderListRow({
      host: this,
      key: entry.entityId,
      icon: entry.icon,
      iconColor: entry.colorCss,
      iconBackground: tintOn(this, entry.colorCss, undefined, 18),
      barFraction: fraction,
      barColor: entry.colorCss,
      label: entry.name,
      extraClass: entry.available ? "" : "dimmed",
      onClick: this._onRowTap(entry),
      middle: html`<div class="row-name">${entry.name}</div>`,
      right: html`
        <div class="row-value">
          <span class="row-count" style=${`color: ${foregroundOn(entry.colorCss, listRowSurface(this), 4.5)};`}
            >${entry.available ? this._formatCount(entry.value) : "–"}</span
          ><span class="row-max">/ ${this._formatCount(entry.packSize)}</span>
        </div>
      `,
    });
  }

  static styles = [
    glassCardStyles,
    listRowStyles,
    css`
      ha-card {
        border-radius: var(--m3s-radius);
      }

      .card-inner {
        border-radius: var(--m3s-radius);
        gap: 10px;
      }

      .empty {
        font-size: 13px;
        opacity: 0.6;
        color: var(--m3s-secondary-text);
      }

      /* ---- hero ---- */

      .hero {
        display: flex;
        flex-direction: column;
        gap: 10px;
        animation: hero-enter ${SUPPLY_FLIP_DURATION_MS}ms ${EASING} both;
      }

      @keyframes hero-enter {
        from {
          opacity: 0;
          transform: translateY(-6px);
        }
        to {
          opacity: 1;
          transform: none;
        }
      }

      .card-inner.no-animations .hero {
        animation: none;
      }

      @media (prefers-reduced-motion: reduce) {
        .hero {
          animation: none;
        }
      }

      /* filter, not opacity: hero-enter fills forwards with opacity 1, and an
         animation's filled value outranks a normal declaration in the cascade,
         so an opacity declaration here would simply never apply once the swap
         animation had run. filter is untouched by those keyframes. */
      .hero.dimmed {
        filter: opacity(0.45);
        pointer-events: none;
      }

      .hero-head {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .hero-icon {
        flex-shrink: 0;
        width: ${SUPPLY_HERO_ICON_SIZE}px;
        height: ${SUPPLY_HERO_ICON_SIZE}px;
        border-radius: ${SUPPLY_HERO_ICON_RADIUS}px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--m3s-accent-fg, var(--m3s-accent));
      }

      .hero-icon ha-icon {
        --mdc-icon-size: 24px;
      }

      .hero-text {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .hero-name {
        font-size: 15px;
        font-weight: 700;
        line-height: 1.2;
        color: var(--m3s-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .hero-sub {
        font-size: 12px;
        opacity: 0.65;
        color: var(--m3s-secondary-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .hero-sub.alert {
        opacity: 1;
        color: var(--m3s-accent-fg, var(--m3s-accent));
        font-weight: 600;
      }

      .hero-value {
        flex-shrink: 0;
        text-align: right;
      }

      .hero-number {
        line-height: 1.05;
        white-space: nowrap;
      }

      .hero-count {
        font-size: 30px;
        font-weight: 700;
        color: var(--m3s-accent-fg, var(--m3s-accent));
      }

      .hero-max {
        font-size: 13px;
        opacity: 0.55;
        color: var(--m3s-secondary-text);
        margin-left: 2px;
      }

      .hero-unit {
        font-size: 10px;
        opacity: 0.5;
        color: var(--m3s-secondary-text);
      }

      /* ---- fill ---- */

      .fill-dots {
        display: flex;
        align-items: center;
        gap: ${SUPPLY_DOT_GAP}px;
      }

      .dot {
        flex: 1;
        min-width: 0;
        height: ${SUPPLY_DOT_HEIGHT}px;
        border-radius: ${SUPPLY_DOT_RADIUS}px;
        background: color-mix(in srgb, var(--primary-text-color) 9%, var(--ha-card-background, var(--card-background-color)));
        transition: background 300ms ${EASING};
      }

      .dot.on {
        background: var(--m3s-accent);
      }

      .card-inner.no-animations .dot {
        transition: none;
      }

      .overflow {
        flex-shrink: 0;
        font-size: 11px;
        font-weight: 700;
        color: var(--m3s-accent-fg, var(--m3s-accent));
        padding-left: 4px;
      }

      .fill-bar {
        position: relative;
        height: ${SUPPLY_BAR_HEIGHT}px;
        border-radius: ${SUPPLY_BAR_RADIUS}px;
        background: color-mix(in srgb, var(--primary-text-color) 9%, var(--ha-card-background, var(--card-background-color)));
        overflow: hidden;
      }

      .fill-bar-value {
        height: 100%;
        border-radius: inherit;
        background: var(--m3s-accent);
        transition: width 300ms ${EASING};
      }

      .card-inner.no-animations .fill-bar-value {
        transition: none;
      }

      .shop-chip {
        align-self: flex-start;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 28px;
        padding: 0 12px;
        border-radius: ${SUPPLY_CHIP_RADIUS}px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        user-select: none;
        color: var(--m3s-accent-fg, var(--m3s-accent));
        background: color-mix(in srgb, var(--m3s-accent) 16%, var(--ha-card-background, var(--card-background-color)));
      }

      .shop-chip.done {
        cursor: default;
        opacity: 0.7;
      }

      .shop-chip ha-icon {
        --mdc-icon-size: 15px;
      }

      .shop-chip:focus-visible {
        outline: 2px solid var(--m3s-accent);
        outline-offset: 2px;
      }

      /* ---- actions ---- */

      .actions {
        display: flex;
        align-items: stretch;
        gap: ${SUPPLY_ACTION_GAP}px;
        height: ${SUPPLY_ACTION_HEIGHT}px;
      }

      .step {
        flex-shrink: 0;
        width: ${SUPPLY_STEPPER_WIDTH}px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        user-select: none;
        color: var(--m3s-text);
        background: color-mix(in srgb, var(--primary-text-color) 6%, var(--ha-card-background, var(--card-background-color)));
        transition: transform 150ms ${EASING};
      }

      .step-minus {
        border-radius: ${SUPPLY_STEPPER_RADIUS_OUTER}px ${SUPPLY_STEPPER_RADIUS_INNER}px
          ${SUPPLY_STEPPER_RADIUS_INNER}px ${SUPPLY_STEPPER_RADIUS_OUTER}px;
      }

      .step-plus {
        border-radius: ${SUPPLY_STEPPER_RADIUS_INNER}px ${SUPPLY_STEPPER_RADIUS_OUTER}px
          ${SUPPLY_STEPPER_RADIUS_OUTER}px ${SUPPLY_STEPPER_RADIUS_INNER}px;
      }

      .step:active {
        transform: scale(0.94);
      }

      .step[disabled] {
        opacity: 0.3;
        pointer-events: none;
      }

      .step ha-icon {
        --mdc-icon-size: 20px;
      }

      .refill {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        cursor: pointer;
        user-select: none;
        border-radius: ${SUPPLY_REFILL_RADIUS}px;
        color: var(--m3s-accent-fg, var(--m3s-accent));
        font-size: 15px;
        font-weight: 600;
        transition: border-radius ${SUPPLY_REFILL_MORPH_MS}ms ${EASING};
      }

      .refill.morph {
        border-radius: ${SUPPLY_REFILL_RADIUS_ACTIVE}px;
      }

      .card-inner.no-animations .refill {
        transition: none;
      }

      .refill ha-icon {
        --mdc-icon-size: 20px;
      }

      .step:focus-visible,
      .refill:focus-visible {
        outline: 2px solid var(--m3s-accent);
        outline-offset: 2px;
      }

      /* ---- list ---- */

      .section-title {
        font-size: 11px;
        opacity: 0.5;
        color: var(--m3s-secondary-text);
      }

      .lr-row.dimmed {
        opacity: 0.45;
      }

      .row-name {
        font-size: 12px;
        font-weight: 600;
        color: var(--m3s-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .row-value {
        white-space: nowrap;
      }

      .row-count {
        font-size: 13px;
        font-weight: 700;
      }

      .row-max {
        font-size: 11px;
        opacity: 0.55;
        color: var(--m3s-secondary-text);
        margin-left: 2px;
      }

      /* Safari gained color-mix() in 16.2, and an iPod touch 7 or an iPad Air 2
         stops at iOS 15. A plain declaration before each mix cannot serve as the
         fallback: every one of them contains var(), which defers the check until
         after substitution, where failure yields unset rather than the previous
         declaration — the tint did not fade, the fill disappeared entirely. This
         block is the one those browsers alone can see; the tint is what it gives
         up. Backticks are not allowed in here: this is a css template literal. */
      @supports not (color: color-mix(in srgb, red 50%, blue)) {
        .dot {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .fill-bar {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .shop-chip {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .step {
          background: var(--ha-card-background, var(--card-background-color));
        }
      }
      `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-supply-card": M3SupplyCard;
  }
}

const windowWithCards = window as unknown as Window & {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-supply-card",
  name: "M3 Supply Card",
  description:
    "Vorratsverwaltung für Verbrauchsmaterial: Restmenge, Reichweiten-Schätzung, Nachfüllen per Tap und Einkaufslisten-Anbindung.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
