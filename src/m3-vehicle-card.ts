import { LitElement, html, svg, css, nothing, unsafeCSS, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HaActionConfig,
  HomeAssistant,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  M3VehicleCardConfig,
  StatusRule,
  VehicleActionConfig,
  VehicleBlock,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_VEHICLE_ICON,
  DEFAULT_VEHICLE_RADIUS,
  VEHICLE_ALERT_ACTION_HEIGHT,
  VEHICLE_ALERT_MIN_HEIGHT,
  VEHICLE_ALERT_RADIUS,
  VEHICLE_ALERT_TINT,
  VEHICLE_BAR_HEIGHT,
  VEHICLE_BAR_HEIGHT_HYBRID,
  VEHICLE_BUTTON_HEIGHT,
  VEHICLE_BUTTON_PRESS_MS,
  VEHICLE_BUTTON_RADIUS_ACTIVE,
  VEHICLE_BUTTON_RADIUS_PRESSED,
  VEHICLE_COLOR_NEUTRAL,
  VEHICLE_COLOR_OK,
  VEHICLE_COLOR_WARN,
  VEHICLE_HERO_SIZE,
  VEHICLE_HERO_SIZE_COMPACT,
  VEHICLE_HERO_WEIGHT,
  VEHICLE_ICON_TINT,
  VEHICLE_LIMIT_MARK_HEIGHT,
  VEHICLE_LIMIT_MARK_WIDTH,
  VEHICLE_MORPH_MS,
  VEHICLE_PILL_HEIGHT,
  VEHICLE_PILL_RADIUS,
  VEHICLE_PILL_TINT,
  VEHICLE_PRIMARY_RADIUS,
  VEHICLE_PRIMARY_TINT,
  VEHICLE_SECONDARY_RADIUS,
  VEHICLE_SECONDARY_TINT,
  VEHICLE_WAVE_AMPLITUDE,
  VEHICLE_WAVE_AMPLITUDE_LERP,
  VEHICLE_WAVE_GAP,
  VEHICLE_WAVE_PHASE_SPEED,
  VEHICLE_WAVE_STROKE,
  VEHICLE_WAVE_SVG_HEIGHT,
  VEHICLE_WAVE_WAVELENGTH,
  resolveCornerRadius,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import { STANDARD_EASING, isReducedMotion, shouldAnimate } from "./shared/animation";
import { runHaAction, navigateTo } from "./shared/actions";
import { activateOnKey } from "./shared/a11y";
import { cardHeaderStyles, renderCardHeader } from "./shared/card-header";
import {
  buildCssVars,
  fillColor,
  foregroundColor,
  foregroundOn,
  inkOn,
  resolveCommonColors,
  resolveThemeColor,
  tintInk,
  tintOn,
} from "./shared/color-config";
import { cssUrl } from "./shared/css-safe";
import { formatClock, formatNumber } from "./shared/formatting";
import { buildWavePath } from "./shared/wave";
import { VisibleTicker } from "./shared/visible-ticker";
import { glassCardClass, glassCardStyles } from "./shared/glass-card";
import { foldHides, readCollapsed, writeCollapsed, type CollapseTarget } from "./shared/collapse-state";
import {
  easeFoldHeight,
  foldArrowStyles,
  pillChevronStyles,
  renderFoldArrow,
  renderPillChevron,
} from "./shared/fold-arrow";
import { hassChangeMatters } from "./shared/should-update";
import { infoChipStyles, renderInfoChips } from "./shared/info-chips";
import { TemplatedCard } from "./shared/templated-card";
import { openEntityDetail } from "./shared/entity-detail";
import { isOnState } from "./shared/entity-actions";
import { formatHeldFor } from "./shared/state-since";
import { TapHold } from "./shared/tap-hold";
import {
  VEHICLE_DEFAULT_FOLD,
  allMet,
  resolveVehicle,
  vehicleEntities,
  vehicleLayout,
  visibleActions,
  type LockState,
  type ResolvedVehicle,
  type SlotReading,
} from "./shared/vehicle";

/**
 * One car, whatever drives it and whoever built it.
 *
 * The card knows meanings, not manufacturers: a battery, a range, whether it is
 * charging, the lock, where it stands. Each is a slot the config fills with an
 * entity or a template (shared/vehicle.ts reads them), and a slot left empty is
 * a block that is not drawn — so `name` and a battery make a whole card, and
 * the rest arrives as it is mapped.
 *
 * THE CHARGE IS THE LAYOUT
 *
 * Parked, the charge is one line: a figure, a bar and the range. Charging, it
 * becomes the card's hero — a large figure over the suite's wave, with the
 * limit marked on the track and what it means in words underneath ("11 kW ·
 * full at 18:40"). The change between the two eases rather than jumps.
 */

console.info(
  `%c M3-VEHICLE-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #81c784; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #81c784; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

/** Domains whose state a button shows as pressed. */
const SWITCH_DOMAINS = new Set(["switch", "input_boolean", "climate", "fan", "light", "siren"]);

/** A reading outside its thresholds takes the warning colour throughout its block. */
const WARN_VARS = "--m3v-accent: var(--m3v-warn); --m3v-fill: var(--m3v-warn-fill); --m3v-ink: var(--m3v-warn-ink);";

const LOCK_ICONS: Record<LockState, string> = {
  locked: "mdi:lock",
  unlocked: "mdi:lock-open-variant",
  moving: "mdi:lock-clock",
  jammed: "mdi:lock-alert",
  unknown: "mdi:lock-question",
};

@customElement("m3-vehicle-card")
export class M3VehicleCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3VehicleCardConfig;
  /** Bumped every minute, for "for 2 h" and "updated 3 min ago". */
  @state() private _tick = 0;
  @state() private _folded = false;
  private _ticker = new VisibleTicker(this, () => {
    this._tick++;
  });

  /** The energy block's shape at the last render — a change eases. */
  private _shape?: string;
  private _heightBefore = 0;
  private _rendered = false;
  /** One gesture tracker per action button, so a hold on one is not a tap on another. */
  private _gestures = new Map<string, TapHold>();

  // ---- the wave, as the printer card draws it --------------------------------
  // Kept out of reactive state: it moves every frame, and the frame callback
  // writes one path attribute rather than asking for a render.
  @state() private _waveWidth = 0;
  private _waveObserver?: ResizeObserver;
  private _waveObserved?: Element;
  private _wavePhase = 0;
  private _waveAmplitude = VEHICLE_WAVE_AMPLITUDE;
  private _waveTarget = VEHICLE_WAVE_AMPLITUDE;
  private _waveDrawn = false;
  private _waveGeom?: { end: number; mid: number };
  private _waveTicker = new VisibleTicker(this, () => this._tickWave());
  private _waveTicking = false;

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-vehicle-card-editor");
    return document.createElement("m3-vehicle-card-editor") as unknown as LovelaceCardEditor;
  }

  /** A battery sensor that looks like a car's, if there is one. */
  public static getStubConfig(hass: HomeAssistant): M3VehicleCardConfig {
    const battery = Object.keys(hass?.states ?? {}).find(
      (id) =>
        id.startsWith("sensor.") &&
        hass.states[id].attributes?.device_class === "battery" &&
        /car|auto|vehicle|_ev_|_ev$|soc|state_of_charge|tesla|ioniq|id[._]?[3-7]|zoe|leaf|polestar|enyaq|kona|niro/i.test(id),
    );
    return { type: "custom:m3-vehicle-card", energy: battery ? { battery } : {} };
  }

  public setConfig(config: M3VehicleCardConfig): void {
    if (!config) throw new Error("m3-vehicle-card: invalid configuration");
    this._config = config;
    this._folded = config.collapsible ? readCollapsed(this.hass, this._foldTarget) : false;
    this._gestures.clear();
  }

  public getCardSize(): number {
    return 4;
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: 12, min_columns: 6, min_rows: 2 };
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this._ticker.setCadence("minute");
    this._ticker.connect();
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._ticker.disconnect();
    this._setWaveTicking(false);
    this._waveObserver?.disconnect();
    this._waveObserved = undefined;
    for (const g of this._gestures.values()) g.destroy();
    this._gestures.clear();
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return hassChangeMatters(changed, this.hass, vehicleEntities(this._config));
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  // ---- folding ------------------------------------------------------------------

  private get _foldTarget(): CollapseTarget {
    const c = this._config;
    const key = typeof c?.energy?.battery === "string" ? c.energy.battery : (c?.name ?? "");
    return {
      entity: c?.collapse_state_entity,
      storageKey: `m3-vehicle-folded:${location.pathname}:${key}`,
      defaultCollapsed: c?.default_collapsed,
      memory: c?.collapse_memory,
    };
  }

  private _toggleFold = (e: Event): void => {
    e.stopPropagation();
    const inner = this.renderRoot.querySelector(".card-inner") as HTMLElement | null;
    const before = inner?.offsetHeight ?? 0;
    this._folded = !this._folded;
    writeCollapsed(this.hass, this._foldTarget, this._folded);
    void this.updateComplete.then(() => easeFoldHeight(inner, before, shouldAnimate(this._config?.animation)));
  };

  // ---- the charging ↔ parked change ---------------------------------------------

  protected willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    if (!this._config || !this.hass) return;
    // Measured before the new layout renders, so the card can ease from it.
    const shape = this._shapeOf(resolveVehicle(this.hass, this._config, Date.now()));
    if (this._shape !== undefined && shape !== this._shape) {
      this._heightBefore = (this.renderRoot?.querySelector(".card-inner") as HTMLElement | null)?.offsetHeight ?? 0;
    }
    this._shape = shape;
  }

  private _shapeOf(v: ResolvedVehicle): string {
    return v.drive === "hybrid" ? `hybrid:${v.mode === "charging"}` : v.mode === "charging" ? "charging" : "parked";
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    this._syncWave();
    if (this._heightBefore) {
      const inner = this.renderRoot.querySelector(".card-inner") as HTMLElement | null;
      easeFoldHeight(inner, this._heightBefore, shouldAnimate(this._config?.animation));
      this._heightBefore = 0;
    }
    this._rendered = true;
    if (!this._config?.collapsible) return;
    const wanted = readCollapsed(this.hass, this._foldTarget);
    if (wanted !== this._folded) this._folded = wanted;
  }

  // ---- actions ----------------------------------------------------------------------

  private _run(action: HaActionConfig | undefined, entityId: string | undefined): void {
    if (!this.hass) return;
    runHaAction(this.hass, action ?? (entityId ? { action: "more-info" } : { action: "none" }), {
      source: this,
      entityId,
      fireMoreInfo: (id) => {
        if (id) openEntityDetail(this, id);
      },
      navigate: (path) => navigateTo(this, path),
    });
  }

  private _gesture(key: string, action: VehicleActionConfig): TapHold {
    let g = this._gestures.get(key);
    if (!g) {
      g = new TapHold({
        onTap: () => this._run(action.tap_action, action.entity),
        onHold: () => this._run(action.hold_action, action.entity),
        hasHold: () => !!action.hold_action && action.hold_action.action !== "none",
      });
      this._gestures.set(key, g);
    }
    return g;
  }

  // ---- formatting -------------------------------------------------------------------

  private _num(value: number, digits = 0): string {
    return formatNumber(this._language, value, { maximumFractionDigits: digits });
  }

  /** A reading as "312 km", or a dash when it has nothing to say. */
  private _value(r: SlotReading | undefined, digits = 0): string {
    if (!r?.ok) return "–";
    if (r.num === undefined) return r.raw ?? "–";
    return r.unit ? `${this._num(r.num, digits)} ${r.unit}` : this._num(r.num, digits);
  }

  private _percent(r: SlotReading | undefined): number | undefined {
    return r?.ok && r.num !== undefined ? Math.max(0, Math.min(100, r.num)) : undefined;
  }

  // ---- render -------------------------------------------------------------------------

  protected render() {
    if (!this._config || !this.hass) return nothing;
    void this._tick;
    const cfg = this._config;
    const now = Date.now();
    const v = resolveVehicle(this.hass, cfg, now);

    const accent = cfg.accent_color ? resolveThemeColor(cfg.accent_color) : VEHICLE_COLOR_OK;
    const colors = resolveCommonColors(cfg);
    const radius = resolveCornerRadius(cfg.radius ?? DEFAULT_VEHICLE_RADIUS, cfg.corners);
    const animate = shouldAnimate(cfg.animation);

    // Every block is drawn first; the fold then decides, so the card knows
    // whether folding would take anything — a chevron over nothing looks broken.
    this._waveGeom = undefined;
    const layout = vehicleLayout(cfg.layout);
    const bodies = new Map<VehicleBlock, unknown>(
      layout.map((block) => [block, this._renderBlock(block, v, accent, now)] as [VehicleBlock, unknown]),
    );
    const collapse = cfg.collapse_blocks ?? [...VEHICLE_DEFAULT_FOLD];
    const pinned: VehicleBlock[] = ["alerts"];
    const foldable =
      !!cfg.collapsible &&
      layout.some((b) => bodies.get(b) !== nothing && foldHides(b, true, collapse, pinned));
    const folded = foldable && this._folded;
    if (folded && foldHides("energy", true, collapse, pinned)) this._waveGeom = undefined;

    const iconBg = tintOn(this, accent, cfg.accent_opacity, VEHICLE_ICON_TINT);
    const vars = buildCssVars({
      "m3v-accent": accent,
      "m3v-fill": fillColor(this, accent),
      "m3v-warn": VEHICLE_COLOR_WARN,
      "m3v-warn-fill": fillColor(this, VEHICLE_COLOR_WARN),
      // The figure and the charge line are the accent as text on the card.
      "m3v-ink": foregroundColor(this, accent, 3),
      "m3v-warn-ink": foregroundColor(this, VEHICLE_COLOR_WARN, 3),
      "m3p-icon-bg": iconBg,
      "m3p-icon-color": foregroundOn(accent, iconBg, 3, this),
      "m3p-text": colors.textColorCss,
      "m3p-secondary-text": colors.secondaryTextColorCss,
    });

    return html`
      <ha-card style=${`${vars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(cfg.glass_background)} ${animate ? "" : "no-animations"}"
          style=${`border-radius: ${radius};${colors.cardBackgroundCss ? ` background: ${colors.cardBackgroundCss};` : ""}`}
        >
          ${this._renderHeader(v, foldable, folded, now)}
          ${layout.map((block) => (foldHides(block, folded, collapse, pinned) ? nothing : bodies.get(block)))}
        </div>
      </ha-card>
    `;
  }

  private _renderBlock(block: VehicleBlock, v: ResolvedVehicle, accent: string, now: number): unknown {
    switch (block) {
      case "energy":
        return this._renderEnergy(v);
      case "alerts":
        return this._renderAlerts(v, now);
      case "chips":
        return this._renderChips(accent);
      case "actions":
        return this._renderActions(v, accent, now);
      case "footer":
        return this._renderFooter(v, now);
      default:
        return nothing;
    }
  }

  // ---- header -----------------------------------------------------------------------

  private _subtitle(v: ResolvedVehicle, now: number): string {
    const parts: string[] = [];
    // The state word only when something says it: "parked" needs a charging
    // or plug sensor that reads "no", or it is a guess about a car that may
    // be on the motorway. Without one the place speaks alone.
    const knows = v.charging !== undefined || v.plugged !== undefined;
    if (!v.unmapped) {
      if (v.mode === "unknown") parts.push(this._t("vehicle_unknown"));
      else if (knows) {
        parts.push(this._t(v.mode === "charging" ? "vehicle_charging" : v.mode === "plugged" ? "vehicle_plugged" : "vehicle_parked"));
      }
    }
    const place = v.place;
    if (place && place.kind !== "unknown") {
      parts.push(
        place.kind === "home" ? this._t("vehicle_home") : place.kind === "away" ? this._t("vehicle_away") : place.name,
      );
      // How long it has stood there — not while charging, where the time that
      // matters is when it will be full.
      if (v.mode !== "charging" && v.placeSince !== undefined && now - v.placeSince >= 60_000) {
        parts.push(this._t("vehicle_since").replace("{t}", formatHeldFor(v.placeSince, now, this._language)));
      }
    }
    return parts.join(" · ");
  }

  private _renderHeader(v: ResolvedVehicle, foldable: boolean, folded: boolean, now: number) {
    const cfg = this._config!;
    const name = cfg.name ?? this._t("vehicle_default_name");
    const pill = v.lock ? this._renderLockPill(v.lock, name, foldable, folded) : nothing;
    const arrow =
      foldable && !v.lock
        ? renderFoldArrow({ folded, accent: "var(--m3v-accent)", host: this, label: name, onToggle: this._toggleFold })
        : nothing;
    return renderCardHeader({
      icon: cfg.icon ?? DEFAULT_VEHICLE_ICON,
      image: cssUrl(cfg.image),
      name,
      subtitle: this._subtitle(v, now),
      onClick: () => this._run(cfg.tap_action, v.primaryEntity),
      right: pill !== nothing || arrow !== nothing ? html`<div class="header-trailing">${pill}${arrow}</div>` : undefined,
    });
  }

  /** "Locked" in green, "Open" in amber, a dash in grey; the fold when the card folds. */
  private _renderLockPill(lock: LockState, name: string, foldable: boolean, folded: boolean) {
    const color = lock === "locked" ? VEHICLE_COLOR_OK : lock === "unlocked" || lock === "jammed" ? VEHICLE_COLOR_WARN : VEHICLE_COLOR_NEUTRAL;
    const tint = tintOn(this, color, undefined, VEHICLE_PILL_TINT);
    const style = `--m3v-pill: ${tint}; --m3v-pill-ink: ${tintInk(this, color, undefined, VEHICLE_PILL_TINT)};`;
    const text =
      lock === "locked"
        ? this._t("vehicle_locked")
        : lock === "unlocked"
          ? this._t("vehicle_unlocked")
          : lock === "jammed"
            ? this._t("vehicle_jammed")
            : lock === "moving"
              ? this._t("vehicle_lock_moving")
              : "–";
    const body = html`<ha-icon icon=${LOCK_ICONS[lock]}></ha-icon><span>${text}</span>`;
    if (!foldable) {
      return html`<span class="lock-pill" style=${style} role="status" aria-label=${`${this._t("vehicle_lock_label")}: ${text}`}
        >${body}</span
      >`;
    }
    return html`<button
      class="lock-pill pill-toggle"
      style=${style}
      aria-expanded=${String(!folded)}
      aria-label=${`${name}: ${this._t("vehicle_lock_label")} ${text}`}
      @click=${this._toggleFold}
    >
      ${body}${renderPillChevron(folded)}
    </button>`;
  }

  // ---- energy ---------------------------------------------------------------------

  private _renderEnergy(v: ResolvedVehicle) {
    if (v.unmapped) {
      return html`<div class="unmapped"><ha-icon icon="mdi:battery-unknown"></ha-icon>${this._t("vehicle_unmapped")}</div>`;
    }
    const morph = this._rendered ? "morph" : "";
    if (v.drive === "hybrid" && v.battery && v.fuel) {
      return html`<div class="energy hybrid ${morph}">
        ${this._renderHybridRow(v, "battery")} ${this._renderHybridRow(v, "fuel")}
        ${v.mode === "charging" ? this._renderChargeCaption(v) : nothing}
      </div>`;
    }
    const level = v.battery ?? v.fuel;
    const range = v.battery ? v.range : v.fuelRange;
    const warn = !!level?.warn;
    const style = warn ? WARN_VARS : "";
    if (v.mode === "charging" && v.battery) {
      return html`
        <div class="energy charging ${morph}" style=${style}>
          <div class="hero">
            ${this._renderFigure(level, false)}
            ${range
              ? html`<div class="hero-range">
                  <div class="range-value">${this._value(range)}</div>
                  <div class="range-label">${this._t("vehicle_range")}</div>
                </div>`
              : nothing}
          </div>
          ${this._renderWave(this._percent(level), this._percent(v.limit))}
          ${this._renderChargeCaption(v)}
        </div>
      `;
    }
    const showLimit = v.mode === "plugged" ? this._percent(v.limit) : undefined;
    return html`
      <div class="energy parked ${morph}" style=${style}>
        ${this._renderFigure(level, true)}
        ${this._renderBar(this._percent(level), showLimit, VEHICLE_BAR_HEIGHT, level?.ok ? this._label(v, level) : undefined)}
        ${range ? html`<div class="row-range">${this._value(range)}</div>` : nothing}
      </div>
    `;
  }

  private _label(v: ResolvedVehicle, level: SlotReading): string {
    return `${this._t(level === v.fuel ? "vehicle_fuel" : "vehicle_battery")} ${this._value(level)}`;
  }

  /** The big figure. The unit stays small; an unreadable value is a dash, never 0 %. */
  private _renderFigure(r: SlotReading | undefined, compact: boolean) {
    const ok = r?.ok && r.num !== undefined;
    return html`<div class="figure ${compact ? "compact" : ""}" aria-live="polite">
      <span class="figure-num">${ok ? this._num(r!.num!) : "–"}</span>${ok
        ? html`<span class="figure-unit">${r!.unit ?? "%"}</span>`
        : nothing}
    </div>`;
  }

  private _renderBar(percent: number | undefined, limit: number | undefined, height: number, label?: string) {
    return html`<div
      class="bar"
      style=${`height: ${height}px;`}
      role=${label ? "meter" : nothing}
      aria-label=${label ?? nothing}
      aria-valuemin=${label ? "0" : nothing}
      aria-valuemax=${label ? "100" : nothing}
      aria-valuenow=${label && percent !== undefined ? String(Math.round(percent)) : nothing}
    >
      ${percent !== undefined ? html`<div class="bar-fill" style=${`width: ${percent}%;`}></div>` : nothing}
      ${limit !== undefined && limit < 100 ? html`<div class="bar-limit" style=${`left: ${limit}%;`}></div>` : nothing}
    </div>`;
  }

  private _renderHybridRow(v: ResolvedVehicle, kind: "battery" | "fuel") {
    const level = kind === "battery" ? v.battery : v.fuel;
    const range = kind === "battery" ? v.range : v.fuelRange;
    const warn = !!level?.warn;
    const style = warn ? WARN_VARS : "";
    const charging = kind === "battery" && v.mode === "charging";
    return html`<div class="hybrid-row" style=${style}>
      <ha-icon icon=${kind === "battery" ? (charging ? "mdi:battery-charging" : "mdi:battery") : "mdi:gas-station"}></ha-icon>
      <span class="hybrid-value">${this._value(level)}</span>
      ${charging
        ? this._renderWave(this._percent(level), this._percent(v.limit))
        : this._renderBar(this._percent(level), undefined, VEHICLE_BAR_HEIGHT_HYBRID, level?.ok ? this._label(v, level!) : undefined)}
      ${range ? html`<span class="row-range">${this._value(range)}</span>` : nothing}
    </div>`;
  }

  /** "⚡ 11 kW · full at 18:40" on the left, "Limit 80 %" on the right. */
  private _renderChargeCaption(v: ResolvedVehicle) {
    const left: string[] = [];
    if (v.powerKw !== undefined) left.push(`${this._num(v.powerKw, v.powerKw < 10 ? 1 : 0)} kW`);
    if (v.end) {
      const clock = formatClock(new Date(v.end.at).toISOString(), this._language);
      if (clock) left.push(this._t(v.end.estimated ? "vehicle_full_approx" : "vehicle_full_at").replace("{t}", clock));
    }
    const limit = this._percent(v.limit);
    if (left.length === 0 && limit === undefined) return nothing;
    return html`<div class="charge-caption">
      <span class="charge-left">${left.length ? html`<ha-icon icon="mdi:lightning-bolt"></ha-icon>${left.join(" · ")}` : nothing}</span>
      ${limit !== undefined ? html`<span class="charge-limit">${this._t("vehicle_limit").replace("{n}", this._num(limit))}</span>` : nothing}
    </div>`;
  }

  /** The suite's wave up to the charge, a flat track after it, the limit as an upright stroke. */
  private _renderWave(percent: number | undefined, limit: number | undefined) {
    const value = percent ?? 0;
    this._waveTarget = percent === undefined ? 0 : VEHICLE_WAVE_AMPLITUDE;
    if (!this._waveDrawn || isReducedMotion()) this._waveAmplitude = this._waveTarget;
    const width = this._waveWidth;
    const height = VEHICLE_WAVE_SVG_HEIGHT;
    const mid = height / 2;
    const gapHalf = VEHICLE_WAVE_GAP / 2;
    const filledX = (value / 100) * width;
    const end = Math.max(0, filledX - gapHalf);
    const trackStart = Math.min(width, filledX + gapHalf);
    const drawWave = width > 0 && end > 1;
    this._waveGeom = drawWave ? { end, mid } : undefined;
    if (width > 0) this._waveDrawn = true;
    const limitX = limit !== undefined && limit < 100 ? (limit / 100) * width : undefined;
    const markHalf = VEHICLE_LIMIT_MARK_HEIGHT / 2;
    return html`<div class="wave-box">
      ${width > 0
        ? html`<svg class="wave" viewBox=${`0 0 ${width} ${height}`} width=${width} height=${height} aria-hidden="true">
            ${trackStart < width - 1 ? svg`<line class="wave-rest" x1=${trackStart} y1=${mid} x2=${width} y2=${mid}></line>` : nothing}
            ${drawWave
              ? svg`<path class="wave-fill" d=${buildWavePath(0, end, this._waveAmplitude, VEHICLE_WAVE_WAVELENGTH, this._wavePhase, mid)}></path>`
              : nothing}
            ${limitX !== undefined
              ? svg`<line class="wave-limit" x1=${limitX} y1=${mid - markHalf} x2=${limitX} y2=${mid + markHalf}></line>`
              : nothing}
          </svg>`
        : nothing}
    </div>`;
  }

  private _syncWave(): void {
    const box = this.renderRoot.querySelector(".wave-box");
    if (box && box !== this._waveObserved) {
      this._waveObserver ??= new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect.width ?? 0;
        if (w && Math.abs(w - this._waveWidth) > 0.5) this._waveWidth = w;
      });
      if (this._waveObserved) this._waveObserver.unobserve(this._waveObserved);
      this._waveObserver.observe(box);
      this._waveObserved = box;
      const w = box.getBoundingClientRect().width;
      if (w && Math.abs(w - this._waveWidth) > 0.5) this._waveWidth = w;
    } else if (!box && this._waveObserved) {
      this._waveObserver?.unobserve(this._waveObserved);
      this._waveObserved = undefined;
      this._waveDrawn = false;
    }
    const easing = Math.abs(this._waveAmplitude - this._waveTarget) > 0.01;
    this._setWaveTicking(!!this._waveGeom && !isReducedMotion() && shouldAnimate(this._config?.animation) && (this._waveTarget > 0 || easing));
  }

  private _setWaveTicking(on: boolean): void {
    if (on === this._waveTicking) return;
    this._waveTicking = on;
    if (on) {
      this._waveTicker.setCadence("frame");
      this._waveTicker.connect();
    } else {
      this._waveTicker.disconnect();
    }
  }

  private _tickWave(): void {
    const geom = this._waveGeom;
    if (!geom) {
      this._setWaveTicking(false);
      return;
    }
    const delta = this._waveTarget - this._waveAmplitude;
    if (Math.abs(delta) > 0.01) this._waveAmplitude += delta * VEHICLE_WAVE_AMPLITUDE_LERP;
    else this._waveAmplitude = this._waveTarget;
    if (this._waveTarget > 0) this._wavePhase -= VEHICLE_WAVE_PHASE_SPEED;
    else if (Math.abs(delta) <= 0.01) {
      this._setWaveTicking(false);
      return;
    }
    this.renderRoot
      .querySelector(".wave-fill")
      ?.setAttribute("d", buildWavePath(0, geom.end, this._waveAmplitude, VEHICLE_WAVE_WAVELENGTH, this._wavePhase, geom.mid));
  }

  // ---- alerts, chips, actions, footer -------------------------------------------------

  private _renderAlerts(v: ResolvedVehicle, now: number) {
    const active = (this._config?.alerts ?? []).filter(
      (a) => a.text && allMet(this.hass, a.when, v.primaryEntity, now),
    );
    if (active.length === 0) return nothing;
    return html`<div class="alerts">
      ${active.map((a) => {
        const color = a.severity === "info" ? VEHICLE_COLOR_NEUTRAL : VEHICLE_COLOR_WARN;
        const tint = tintOn(this, color, undefined, VEHICLE_ALERT_TINT);
        const style = `--m3v-alert: ${tint}; --m3v-alert-icon: ${foregroundOn(color, tint, 3, this)}; --m3v-alert-btn: ${tintOn(this, color, undefined, VEHICLE_ALERT_TINT * 2)}; --m3v-alert-btn-ink: ${tintInk(this, color, undefined, VEHICLE_ALERT_TINT * 2)};`;
        return html`<div class="alert ${a.severity === "info" ? "info" : ""}" style=${style} role=${a.severity === "info" ? "status" : "alert"}>
          <ha-icon icon=${a.icon ?? (a.severity === "info" ? "mdi:information-outline" : "mdi:alert-outline")}></ha-icon>
          <span class="alert-text">${a.text}</span>
          ${a.action
            ? html`<button class="alert-action" @click=${() => this._run(a.action!.tap_action, a.action!.entity)}>
                ${a.action.name}
              </button>`
            : nothing}
        </div>`;
      })}
    </div>`;
  }

  /** `warn_below` / `warn_above` on a chip are amber rules in front of its own. */
  private _renderChips(accent: string) {
    const chips = (this._config?.chips ?? []).map((c) => {
      if (!("entity" in c)) return c;
      const { warn_below, warn_above, ...chip } = c as typeof c & { warn_below?: number; warn_above?: number };
      const rules: StatusRule[] = [];
      if (warn_below !== undefined) rules.push({ below: warn_below, color: VEHICLE_COLOR_WARN });
      if (warn_above !== undefined) rules.push({ above: warn_above, color: VEHICLE_COLOR_WARN });
      return rules.length ? { ...chip, states: [...rules, ...(chip.states ?? [])] } : chip;
    });
    const rendered = renderInfoChips(chips, {
      host: this,
      hass: this.hass,
      language: this._language,
      style: this._config?.chip_style,
      accent,
      run: (action, entityId) => this._run(action, entityId),
    });
    return rendered === nothing ? nothing : html`<div class="chips">${rendered}</div>`;
  }

  private _renderActions(v: ResolvedVehicle, accent: string, now: number) {
    const { primary, rest } = visibleActions(this.hass, this._config?.actions, v.primaryEntity, now);
    if (!primary && rest.length === 0) return nothing;
    const all = this._config?.actions ?? [];
    const keyOf = (a: VehicleActionConfig) => String(all.indexOf(a));
    const tint = tintOn(this, accent, undefined, VEHICLE_PRIMARY_TINT);
    const vars = `--m3v-primary: ${tint}; --m3v-primary-ink: ${tintInk(this, accent, undefined, VEHICLE_PRIMARY_TINT)}; --m3v-on: ${accent}; --m3v-on-ink: ${inkOn(accent, this)}; --m3v-soft: ${tintOn(this, accent, undefined, VEHICLE_PILL_TINT)}; --m3v-soft-ink: ${tintInk(this, accent, undefined, VEHICLE_PILL_TINT)};`;
    const button = (a: VehicleActionConfig, isPrimary: boolean) => {
      const g = this._gesture(keyOf(a), a);
      const st = a.entity ? this.hass?.states[a.entity] : undefined;
      // Only something that switches reads as pressed. A tracker is "home",
      // which is not off, and a location button is not a switch.
      const switchy = a.tap_action?.action === "toggle" || SWITCH_DOMAINS.has((a.entity ?? "").split(".")[0]);
      const on = !!st && switchy && isOnState(st.state);
      const label = a.name ?? (st?.attributes?.friendly_name as string | undefined) ?? a.icon ?? "";
      return html`<button
        class="${isPrimary ? "primary" : "secondary"} ${on ? "on" : ""}"
        aria-label=${label}
        title=${isPrimary ? nothing : label}
        aria-pressed=${st && (a.tap_action?.action === "toggle") ? String(on) : nothing}
        @pointerdown=${g.down}
        @pointermove=${g.move}
        @pointerup=${g.up}
        @pointercancel=${g.up}
        @click=${g.click}
        @keydown=${activateOnKey(() => this._run(a.tap_action, a.entity))}
      >
        ${a.icon ? html`<ha-icon icon=${a.icon}></ha-icon>` : nothing}
        ${isPrimary && a.name ? html`<span>${a.name}</span>` : nothing}
      </button>`;
    };
    return html`<div class="actions" style=${vars}>
      ${primary ? button(primary, true) : nothing} ${rest.map((a) => button(a, false))}
    </div>`;
  }

  private _renderFooter(v: ResolvedVehicle, now: number) {
    if (v.reportedAt === undefined) return nothing;
    const age = now - v.reportedAt;
    const held = formatHeldFor(v.reportedAt, now, this._language);
    if (v.stale) {
      return html`<div class="footer stale" role="status">
        <ha-icon icon="mdi:clock-alert-outline"></ha-icon>${this._t("vehicle_stale").replace("{t}", held)}
      </div>`;
    }
    return html`<div class="footer">
      ${age < 60_000 ? this._t("vehicle_updated_now") : this._t("vehicle_updated").replace("{t}", held)}
    </div>`;
  }

  static styles = [
    glassCardStyles,
    cardHeaderStyles,
    foldArrowStyles,
    pillChevronStyles,
    infoChipStyles,
    css`
      .card-inner {
        display: flex;
        flex-direction: column;
        gap: var(--m3-card-gap, 12px);
        padding: var(--m3-group-padding, 12px);
        box-sizing: border-box;
        -webkit-tap-highlight-color: transparent;
      }

      .header-trailing {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }

      .lock-pill {
        height: ${unsafeCSS(VEHICLE_PILL_HEIGHT)}px;
        border-radius: ${unsafeCSS(VEHICLE_PILL_RADIUS)}px;
        padding: 0 12px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: var(--m3v-pill);
        color: var(--m3v-pill-ink);
        font-size: 13px;
        font-weight: 700;
        white-space: nowrap;
        --mdc-icon-size: 16px;
        transition: background 0.3s ${unsafeCSS(STANDARD_EASING)}, color 0.3s ${unsafeCSS(STANDARD_EASING)};
      }

      /* ---- energy ---- */

      .morph {
        animation: m3v-in ${unsafeCSS(VEHICLE_MORPH_MS)}ms ${unsafeCSS(STANDARD_EASING)};
      }

      .no-animations .morph {
        animation: none;
      }

      @keyframes m3v-in {
        from {
          opacity: 0;
          transform: translateY(4px);
        }
        to {
          opacity: 1;
          transform: none;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .morph {
          animation: none;
        }
      }

      .energy.charging {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .hero {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 12px;
      }

      .figure {
        display: flex;
        align-items: baseline;
        color: var(--m3v-ink);
        font-variant-numeric: tabular-nums;
        line-height: 1;
        flex-shrink: 0;
      }

      .figure-num {
        font-size: ${unsafeCSS(VEHICLE_HERO_SIZE)}px;
        font-weight: ${unsafeCSS(VEHICLE_HERO_WEIGHT)};
        letter-spacing: -0.03em;
      }

      .figure-unit {
        font-size: 20px;
        font-weight: 600;
        margin-left: 3px;
      }

      .figure.compact .figure-num {
        font-size: ${unsafeCSS(VEHICLE_HERO_SIZE_COMPACT)}px;
      }

      .figure.compact .figure-unit {
        font-size: 14px;
      }

      .hero-range {
        text-align: right;
        min-width: 0;
      }

      .range-value {
        font-size: 20px;
        font-weight: 700;
        color: var(--m3p-text);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }

      .range-label {
        font-size: 12px;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
      }

      .energy.parked {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .bar {
        position: relative;
        flex: 1;
        min-width: 0;
        border-radius: 999px;
        background: color-mix(in srgb, var(--m3p-text, currentColor) 12%, transparent);
      }

      .bar-fill {
        height: 100%;
        border-radius: inherit;
        background: var(--m3v-fill);
        transition: width 0.6s ${unsafeCSS(STANDARD_EASING)};
      }

      .no-animations .bar-fill {
        transition: none;
      }

      .bar-limit {
        position: absolute;
        top: 50%;
        width: ${unsafeCSS(VEHICLE_LIMIT_MARK_WIDTH)}px;
        height: ${unsafeCSS(VEHICLE_LIMIT_MARK_HEIGHT)}px;
        margin-left: -${unsafeCSS(VEHICLE_LIMIT_MARK_WIDTH / 2)}px;
        transform: translateY(-50%);
        border-radius: 2px;
        background: var(--m3p-text, currentColor);
        opacity: 0.7;
      }

      .row-range {
        font-size: 15px;
        font-weight: 700;
        color: var(--m3p-text);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        flex-shrink: 0;
      }

      .energy.hybrid {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .hybrid-row {
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--m3v-ink);
        --mdc-icon-size: 20px;
      }

      .hybrid-value {
        min-width: 44px;
        font-size: 15px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }

      .hybrid-row .wave-box {
        flex: 1;
        min-width: 0;
      }

      .wave-box {
        height: ${unsafeCSS(VEHICLE_WAVE_SVG_HEIGHT)}px;
      }

      .wave {
        display: block;
        overflow: visible;
      }

      .wave-fill {
        fill: none;
        stroke: var(--m3v-fill);
        stroke-width: ${unsafeCSS(VEHICLE_WAVE_STROKE)};
        stroke-linecap: round;
        vector-effect: non-scaling-stroke;
      }

      .wave-rest {
        stroke: color-mix(in srgb, var(--m3p-text, currentColor) 12%, transparent);
        stroke-width: ${unsafeCSS(VEHICLE_WAVE_STROKE)};
        stroke-linecap: round;
        vector-effect: non-scaling-stroke;
      }

      .wave-limit {
        stroke: var(--m3p-text, currentColor);
        stroke-width: ${unsafeCSS(VEHICLE_LIMIT_MARK_WIDTH)};
        stroke-linecap: round;
        opacity: 0.7;
      }

      .charge-caption {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        font-size: 12px;
        font-variant-numeric: tabular-nums;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
      }

      .charge-left {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        color: var(--m3v-ink);
        font-weight: 600;
        min-width: 0;
        --mdc-icon-size: 15px;
      }

      .charge-limit {
        white-space: nowrap;
      }

      .unmapped {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
        --mdc-icon-size: 18px;
      }

      /* ---- alerts ---- */

      .alerts {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .alert {
        min-height: ${unsafeCSS(VEHICLE_ALERT_MIN_HEIGHT)}px;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 8px 8px 14px;
        border-radius: ${unsafeCSS(VEHICLE_ALERT_RADIUS)}px;
        background: var(--m3v-alert);
        --mdc-icon-size: 20px;
      }

      .alert ha-icon {
        color: var(--m3v-alert-icon);
        flex-shrink: 0;
      }

      .alert-text {
        flex: 1;
        min-width: 0;
        font-size: 13px;
        font-weight: 500;
        color: var(--m3p-text);
      }

      .alert-action {
        flex-shrink: 0;
        height: ${unsafeCSS(VEHICLE_ALERT_ACTION_HEIGHT)}px;
        padding: 0 14px;
        border: none;
        border-radius: ${unsafeCSS(VEHICLE_ALERT_ACTION_HEIGHT / 2)}px;
        background: var(--m3v-alert-btn);
        color: var(--m3v-alert-btn-ink);
        font-family: inherit;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
      }

      .alert-action:focus-visible {
        outline: 2px solid currentColor;
        outline-offset: 2px;
      }

      /* ---- actions ---- */

      .actions {
        display: flex;
        gap: 8px;
      }

      .actions button {
        height: ${unsafeCSS(VEHICLE_BUTTON_HEIGHT)}px;
        border: none;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        font-family: inherit;
        cursor: pointer;
        touch-action: manipulation;
        transition:
          border-radius ${unsafeCSS(VEHICLE_BUTTON_PRESS_MS)}ms ${unsafeCSS(STANDARD_EASING)},
          background 0.25s ${unsafeCSS(STANDARD_EASING)},
          color 0.25s ${unsafeCSS(STANDARD_EASING)};
      }

      .actions button:focus-visible {
        outline: 2px solid var(--m3v-accent);
        outline-offset: 2px;
      }

      .actions button:active {
        border-radius: ${unsafeCSS(VEHICLE_BUTTON_RADIUS_PRESSED)}px;
      }

      .primary {
        flex: 1;
        min-width: 0;
        padding: 0 16px;
        border-radius: ${unsafeCSS(VEHICLE_PRIMARY_RADIUS)}px;
        background: var(--m3v-primary);
        color: var(--m3v-primary-ink);
        font-size: 15px;
        font-weight: 700;
        --mdc-icon-size: 20px;
      }

      .primary span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .primary.on {
        background: var(--m3v-on);
        color: var(--m3v-on-ink);
      }

      .secondary {
        flex: 0 0 ${unsafeCSS(VEHICLE_BUTTON_HEIGHT)}px;
        width: ${unsafeCSS(VEHICLE_BUTTON_HEIGHT)}px;
        border-radius: ${unsafeCSS(VEHICLE_SECONDARY_RADIUS)}px;
        background: color-mix(in srgb, var(--m3p-text, currentColor) ${unsafeCSS(VEHICLE_SECONDARY_TINT)}%, transparent);
        color: var(--m3p-secondary-text, var(--secondary-text-color));
        --mdc-icon-size: 22px;
      }

      /* Only icon buttons: they share the row, so with no primary they spread. */
      .actions:not(:has(.primary)) .secondary {
        flex: 1;
      }

      .secondary.on {
        border-radius: ${unsafeCSS(VEHICLE_BUTTON_RADIUS_ACTIVE)}px;
        background: var(--m3v-soft);
        color: var(--m3v-soft-ink);
      }

      /* ---- footer ---- */

      .footer {
        text-align: center;
        font-size: 12px;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
        opacity: 0.8;
      }

      .footer.stale {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        opacity: 1;
        color: var(--m3v-warn-ink);
        font-weight: 600;
        --mdc-icon-size: 15px;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-vehicle-card": M3VehicleCard;
  }
}

const windowWithCards = window as unknown as { customCards: Array<Record<string, unknown>> };
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-vehicle-card",
  name: "M3 Vehicle Card",
  description: "One car — charge or tank, range, lock, location, alerts and actions — for any integration.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
