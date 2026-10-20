import { LitElement, html, css, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  M3TimeCardConfig,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_TIME_RADIUS,
  DEFAULT_TIME_ICON,
  DEFAULT_TIME_ACCENT,
  DEFAULT_TIME_MINUTE_STEP,
  DEFAULT_TIME_MINUTE_STEP_COMPACT,
  TIME_COMPACT_BUTTON_WIDTH,
  TIME_COMPACT_HEIGHT,
  TIME_COMPACT_RADIUS_OUTER,
  TIME_COMPACT_RADIUS_INNER,
  TIME_COMPACT_VALUE_FONT_SIZE,
  TIME_PRESET_HEIGHT,
  TIME_PRESET_RADIUS,
  TIME_PRESET_RADIUS_ACTIVE,
  TIME_WHEEL_HEIGHT,
  TIME_WHEEL_RADIUS,
  TIME_WHEEL_ITEM_HEIGHT,
  TIME_WHEEL_PAD,
  TIME_WHEEL_BAND_RADIUS,
  TIME_WHEEL_ACTIVE_FONT_SIZE,
  TIME_WHEEL_IDLE_FONT_SIZE,
  TIME_WHEEL_SETTLE_MS,
  TIME_HEADER_ICON_SIZE,
  TIME_HEADER_ICON_RADIUS,
  TIME_FIELD_WIDTH,
  TIME_FIELD_HEIGHT,
  TIME_FIELD_RADIUS,
  TIME_STEP_BUTTON_HEIGHT,
  TIME_STEP_RADIUS_OUTER,
  TIME_STEP_RADIUS_INNER,
  TIME_DIGIT_FONT_SIZE,
  TIME_SEPARATOR_FONT_SIZE,
  TIME_APPLY_HEIGHT,
  TIME_APPLY_RADIUS,
  TIME_APPLY_RADIUS_ACTIVE,
  TIME_APPLY_MORPH_MS,
  TIME_REPEAT_MS,
  TIME_REPEAT_FAST_MS,
  TIME_REPEAT_ACCELERATE_AFTER_MS,
  TIME_NARROW_BREAKPOINT,
  TIME_FIELD_WIDTH_NARROW,
  TIME_DIGIT_BUFFER_MS,
  TIME_INSTANT_DEBOUNCE_MS,
  resolveCornerRadius,
} from "./const";
import { resolveThemeColor, buildCssVars, resolveCommonColors, tintOn, tintInk , foregroundVars} from "./shared/color-config";
import { glassCardStyles, glassCardClass, renderMissingEntity } from "./shared/glass-card";
import { activateOnKey } from "./shared/a11y";
import { STANDARD_EASING, shouldAnimate } from "./shared/animation";
import {
  readTime,
  hasTime,
  uses12Hour,
  pad2,
  to12Hour,
  from12Hour,
  formatTime,
  stepTime,
  writeTime,
  parsePresetTime,
} from "./shared/ha-time";
import { localize, type TranslationKey } from "./localize";
import { hassChangeMatters } from "./shared/should-update";
import { TemplatedCard } from "./shared/templated-card";

console.info(
  `%c M3-TIME-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #85b7eb; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #85b7eb; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

const EASING = unsafeCSS(STANDARD_EASING);

type Field = "hours" | "minutes";

// Dashboard-wide swipe plugins (hass-swipe-navigation and friends) listen for
// touch and mouse drags on an ancestor of the card, in the bubble phase. A
// drag on a wheel is scrolling, never navigation, so it is kept from reaching
// them — a flick with any sideways drift would otherwise change the view out
// from under the value being set. Verified against hass-swipe-navigation
// 1.16.0: its listeners sit on haAppLayout with no capture flag, so stopping
// propagation here is enough.
function stopSwipe(e: Event): void {
  e.stopPropagation();
}

/** The hour as the wheel lists it: 1..12 in 12h mode, 0..23 otherwise. */
function to12HourOrRaw(hours: number, twelveHour: boolean): number {
  return twelveHour ? to12Hour(hours).display : hours;
}

@customElement("m3-time-card")
export class M3TimeCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3TimeCardConfig;
  /** The value being edited. Only written back on apply. */
  @state() private _draft?: { hours: number; minutes: number };
  @state() private _focus?: Field;
  @state() private _applyMorph = false;
  /** Set when the helper changed underneath an unapplied edit. */
  @state() private _external = false;
  @state() private _narrow = false;

  /** The entity value the draft was seeded from, to detect outside changes. */
  private _seed?: string;
  private _repeatTimer?: number;
  private _accelerateTimer?: number;
  private _morphTimer?: number;
  private _debounceTimer?: number;
  private _digitBuffer = "";
  private _digitTimer?: number;
  private _resizeObserver?: ResizeObserver;
  /** Columns the card is scrolling itself, whose scroll events must be ignored. */
  private _wheelSyncing = new Set<Field>();
  private _wheelTimers = new Map<Field, number>();

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-time-card-editor");
    return document.createElement("m3-time-card-editor") as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(hass: HomeAssistant): M3TimeCardConfig {
    const entity =
      Object.keys(hass?.states ?? {}).find(
        (e) => e.startsWith("input_datetime.") && hass.states[e].attributes.has_time === true,
      ) ?? "";
    return { type: "custom:m3-time-card", entity };
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return hassChangeMatters(changed, this.hass, [this._config?.entity]);
  }

  public setConfig(config: M3TimeCardConfig): void {
    if (!config.entity) throw new Error("entity is required");
    this._config = {
      glass_background: true,
      animation: "auto",
      style: "stepper",
      apply_mode: "button",
      // Deliberately not defaulted here: _minuteStep picks a different value
      // per variant, which a default set at this point would mask.
      keep_seconds: true,
      ...config,
    };
    this._draft = undefined;
    this._seed = undefined;
    this._external = false;
  }

  public getCardSize(): number {
    return 3;
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: "full", rows: "auto", min_rows: 2 };
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this._resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0) this._narrow = width < TIME_NARROW_BREAKPOINT;
    });
    this._resizeObserver.observe(this);
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    this._stopRepeat();
    for (const t of [this._morphTimer, this._debounceTimer, this._digitTimer]) {
      if (t) clearTimeout(t);
    }
    for (const t of this._wheelTimers.values()) clearTimeout(t);
  }

  protected willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    this._syncDraft();
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    this._syncWheels();
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey, vars?: Record<string, string | number>): string {
    let out = localize(key, this._language);
    for (const [k, v] of Object.entries(vars ?? {})) out = out.replaceAll(`{${k}}`, String(v));
    return out;
  }

  // ---- state ------------------------------------------------------------

  private get _state() {
    return this.hass?.states[this._config?.entity ?? ""];
  }

  private get _available(): boolean {
    const st = this._state;
    return !!st && st.state !== "unavailable" && st.state !== "unknown";
  }

  private get _entityTime() {
    return readTime(this._state);
  }

  private get _twelveHour(): boolean {
    return uses12Hour(this.hass);
  }

  private get _dirty(): boolean {
    const entity = this._entityTime;
    if (!entity || !this._draft) return false;
    return entity.hours !== this._draft.hours || entity.minutes !== this._draft.minutes;
  }

  // Seeds the draft from the entity, and afterwards only re-seeds when there
  // is nothing unapplied to lose. An outside change during an edit raises a
  // notice instead of yanking the value out from under the user.
  private _syncDraft(): void {
    const entity = this._entityTime;
    if (!entity) return;
    const key = `${entity.hours}:${entity.minutes}`;
    if (this._draft === undefined) {
      this._draft = { hours: entity.hours, minutes: entity.minutes };
      this._seed = key;
      return;
    }
    if (key === this._seed) return;
    if (this._dirty) {
      this._external = true;
      return;
    }
    this._draft = { hours: entity.hours, minutes: entity.minutes };
    this._seed = key;
    this._external = false;
  }

  private _reloadFromEntity = (): void => {
    const entity = this._entityTime;
    if (!entity) return;
    this._draft = { hours: entity.hours, minutes: entity.minutes };
    this._seed = `${entity.hours}:${entity.minutes}`;
    this._external = false;
  };

  // ---- editing ----------------------------------------------------------

  private _setDraft(next: { hours: number; minutes: number }): void {
    this._draft = next;
    if ((this._config?.apply_mode ?? "button") !== "instant") return;
    // Instant still waits for the interaction to settle: a held stepper would
    // otherwise fire a service call per tick.
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = window.setTimeout(() => this._apply(), TIME_INSTANT_DEBOUNCE_MS);
  }

  // The compact variant is the "set it roughly" layout, so it jumps further
  // by default than the stepper, where fine control is the point.
  private get _minuteStep(): number {
    const configured = this._config?.minute_step;
    if (configured) return configured;
    return this._config?.style === "compact"
      ? DEFAULT_TIME_MINUTE_STEP_COMPACT
      : DEFAULT_TIME_MINUTE_STEP;
  }

  private _step(field: Field, direction: 1 | -1): void {
    if (!this._available || !this._draft) return;
    const amount = field === "minutes" ? this._minuteStep : 1;
    this._setDraft(stepTime(this._draft, field, direction * amount));
  }

  /** Compact steps the whole time by minute_step, carrying into the hour. */
  private _nudge(direction: 1 | -1): void {
    if (!this._available || !this._draft) return;
    this._setDraft(stepTime(this._draft, "minutes", direction * this._minuteStep));
  }

  private _startRepeat(field: Field, direction: 1 | -1): (e: Event) => void {
    return (e: Event) => {
      e.preventDefault();
      this._focus = field;
      this._step(field, direction);
      this._stopRepeat();
      this._repeatTimer = window.setInterval(() => this._step(field, direction), TIME_REPEAT_MS);
      this._accelerateTimer = window.setTimeout(() => {
        if (this._repeatTimer) clearInterval(this._repeatTimer);
        this._repeatTimer = window.setInterval(() => this._step(field, direction), TIME_REPEAT_FAST_MS);
      }, TIME_REPEAT_ACCELERATE_AFTER_MS);
    };
  }

  private _stopRepeat = (): void => {
    if (this._repeatTimer) {
      clearInterval(this._repeatTimer);
      this._repeatTimer = undefined;
    }
    if (this._accelerateTimer) {
      clearTimeout(this._accelerateTimer);
      this._accelerateTimer = undefined;
    }
  };

  private async _apply(): Promise<void> {
    const cfg = this._config;
    const entity = this._entityTime;
    if (!this.hass || !cfg || !entity || !this._draft) return;
    if (!this._dirty) return;
    const seconds = cfg.keep_seconds === false ? 0 : entity.seconds;
    try {
      await writeTime(this.hass, cfg.entity, {
        hours: this._draft.hours,
        minutes: this._draft.minutes,
        seconds,
        date: entity.date,
      });
    } catch (e) {
      console.warn("m3-time-card: could not write the time", e);
      return;
    }
    this._seed = `${this._draft.hours}:${this._draft.minutes}`;
    this._external = false;
    if (!shouldAnimate(cfg.animation)) return;
    this._applyMorph = true;
    if (this._morphTimer) clearTimeout(this._morphTimer);
    this._morphTimer = window.setTimeout(() => {
      this._applyMorph = false;
    }, TIME_APPLY_MORPH_MS);
  }

  private _revert = (): void => {
    this._reloadFromEntity();
  };

  // ---- keyboard ---------------------------------------------------------

  private _onFieldKey(field: Field): (e: KeyboardEvent) => void {
    return (e: KeyboardEvent) => {
      if (!this._available || !this._draft) return;
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        this._step(field, e.key === "ArrowUp" ? 1 : -1);
        return;
      }
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        this._typeDigit(field, e.key);
      }
    };
  }

  // Two digits make a value; one digit stands on its own once the buffer
  // times out, so "7" becomes 07 rather than waiting forever.
  private _typeDigit(field: Field, digit: string): void {
    if (!this._draft) return;
    const buffer = this._digitBuffer + digit;
    const max = field === "hours" ? (this._twelveHour ? 12 : 23) : 59;
    const min = field === "hours" && this._twelveHour ? 1 : 0;

    const twoDigit = Number(buffer.slice(-2));
    const single = Number(digit);
    const value = buffer.length >= 2 && twoDigit <= max && twoDigit >= min ? twoDigit : single;
    if (value > max || value < min) {
      this._digitBuffer = digit;
      return;
    }

    this._applyTyped(field, value);
    if (this._digitTimer) clearTimeout(this._digitTimer);

    if (buffer.length >= 2 || value * 10 > max) {
      // Nothing a second digit could still add — commit and move on.
      this._digitBuffer = "";
      if (field === "hours") this._focus = "minutes";
      return;
    }
    this._digitBuffer = buffer;
    this._digitTimer = window.setTimeout(() => {
      this._digitBuffer = "";
    }, TIME_DIGIT_BUFFER_MS);
  }

  private _applyTyped(field: Field, value: number): void {
    if (!this._draft) return;
    if (field === "minutes") {
      this._setDraft({ ...this._draft, minutes: value });
      return;
    }
    const hours = this._twelveHour
      ? from12Hour(value, to12Hour(this._draft.hours).pm)
      : value;
    this._setDraft({ ...this._draft, hours });
  }

  private get _presets(): { label: string; hours: number; minutes: number }[] {
    return (this._config?.presets ?? [])
      .map((raw) => {
        const parsed = parsePresetTime(raw);
        return parsed ? { label: raw.trim(), ...parsed } : undefined;
      })
      .filter((p): p is { label: string; hours: number; minutes: number } => !!p);
  }

  private _applyPreset(preset: { hours: number; minutes: number }): void {
    if (!this._available) return;
    // In button mode this only preselects — the chip shows the choice and the
    // apply button still has to confirm it.
    this._setDraft({ hours: preset.hours, minutes: preset.minutes });
  }

  private _setHalf(pm: boolean): void {
    if (!this._draft) return;
    const { display } = to12Hour(this._draft.hours);
    this._setDraft({ ...this._draft, hours: from12Hour(display, pm) });
  }

  // ---- render -----------------------------------------------------------

  protected render() {
    const cfg = this._config;
    if (!cfg) return nothing;
    const st = this._state;
    if (this.hass && !st) return renderMissingEntity(cfg.entity);

    // A date-only helper has no time to edit; saying so beats rendering a
    // stepper that would write a value the helper cannot hold.
    if (st && !hasTime(st)) {
      return html`<ha-card><div class="card-inner glass">
        <div class="notice">${this._t("time_needs_time_helper")}</div>
      </div></ha-card>`;
    }

    const accent = resolveThemeColor(cfg.accent_color ?? DEFAULT_TIME_ACCENT);
    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(cfg);
    const cssVars = buildCssVars({
      "m3ti-accent": accent,
      "m3ti-accent-tint": tintOn(this, accent, cfg.accent_opacity, 18),
      // Chips drawn on that tint take their label colour from it.
      "m3ti-accent-tint-ink": tintInk(this, accent, cfg.accent_opacity, 18),
      "m3ti-text": textColorCss,
      "m3ti-secondary-text": secondaryTextColorCss,
      "m3ti-radius": resolveCornerRadius(cfg.radius ?? DEFAULT_TIME_RADIUS, cfg.corners),
      "m3ti-field-width": `${this._narrow ? TIME_FIELD_WIDTH_NARROW : TIME_FIELD_WIDTH}px`,
      // Fills keep the accent; these twins carry it where it is text.
      ...foregroundVars(this, {
        "m3ti-accent": accent,
      }),
    });
    const style = cardBackgroundCss
      ? `${cssVars} --ha-card-background: ${cardBackgroundCss};`
      : cssVars;

    return html`
      <ha-card style=${style}>
        <div
          class="card-inner ${glassCardClass(cfg.glass_background)} ${shouldAnimate(cfg.animation) ? "" : "no-animations"} ${this._available ? "" : "dimmed"}"
        >
          ${cfg.style === "compact"
            ? this._renderCompactRow()
            : html`${this._renderHeader()}
                ${this._external ? this._renderExternalNotice() : nothing}
                ${cfg.style === "wheel" ? this._renderWheels() : this._renderStepper()}
                ${this._twelveHour ? this._renderHalfPills() : nothing}`}
          ${cfg.style === "compact" && this._external ? this._renderExternalNotice() : nothing}
          ${this._presets.length ? this._renderPresets() : nothing}
          ${this._showApplyRow ? this._renderApplyRow() : nothing}
        </div>
      </ha-card>
    `;
  }

  // "always" keeps the row on screen with an inert "Unchanged" label;
  // "when_changed" keeps the card compact and slides the button in on the
  // first edit. Compact defaults to the latter, the stepper to the former.
  private get _showApplyRow(): boolean {
    const cfg = this._config;
    if (!cfg || (cfg.apply_mode ?? "button") !== "button") return false;
    const visibility =
      cfg.apply_visibility ?? (cfg.style === "compact" ? "when_changed" : "always");
    return visibility === "always" || (this._dirty && this._available);
  }

  private _renderHeader(): TemplateResult {
    const cfg = this._config!;
    const st = this._state;
    const name =
      cfg.name ?? (st?.attributes.friendly_name as string | undefined) ?? cfg.entity;
    const entity = this._entityTime;
    const subtitle = !this._available
      ? this._t("unavailable")
      : (cfg.subtitle ??
        this._t("time_current", {
          zeit: entity ? formatTime(entity.hours, entity.minutes, this._twelveHour) : "–",
        }));
    return html`
      <div class="header">
        <div class="header-icon">
          <ha-icon icon=${cfg.icon ?? DEFAULT_TIME_ICON}></ha-icon>
        </div>
        <div class="header-text">
          <div class="header-name">${name}</div>
          <div class="header-sub">${subtitle}</div>
        </div>
        ${cfg.show_date && entity?.date
          ? html`<div class="date-chip">${entity.date}</div>`
          : nothing}
      </div>
    `;
  }

  private _renderExternalNotice(): TemplateResult {
    return html`
      <div
        class="external"
        role="button"
        tabindex="0"
        @click=${this._reloadFromEntity}
        @keydown=${activateOnKey(this._reloadFromEntity)}
      >
        <ha-icon icon="mdi:refresh"></ha-icon>
        <span>${this._t("time_changed_externally")}</span>
      </div>
    `;
  }

  private _renderStepper(): TemplateResult {
    const draft = this._draft ?? { hours: 0, minutes: 0 };
    const hourValue = this._twelveHour ? to12Hour(draft.hours).display : draft.hours;
    return html`
      <div class="stepper">
        ${this._renderColumn("hours", hourValue, this._twelveHour ? 1 : 0, this._twelveHour ? 12 : 23)}
        <div class="separator">:</div>
        ${this._renderColumn("minutes", draft.minutes, 0, 59)}
      </div>
    `;
  }

  private _renderColumn(field: Field, value: number, min: number, max: number): TemplateResult {
    const active = this._focus === field;
    return html`
      <div class="column">
        <div
          class="step-btn up"
          role="button"
          tabindex="-1"
          aria-label=${this._t(field === "hours" ? "time_hour_up" : "time_minute_up")}
          @pointerdown=${this._startRepeat(field, 1)}
          @pointerup=${this._stopRepeat}
          @pointerleave=${this._stopRepeat}
          @pointercancel=${this._stopRepeat}
        >
          <ha-icon icon="mdi:menu-up"></ha-icon>
        </div>
        <div
          class="field ${active ? "active" : ""}"
          role="spinbutton"
          tabindex="0"
          aria-valuenow=${value}
          aria-valuemin=${min}
          aria-valuemax=${max}
          aria-label=${this._t(field === "hours" ? "time_hours" : "time_minutes")}
          @focus=${() => (this._focus = field)}
          @blur=${() => {
            if (this._focus === field) this._focus = undefined;
            this._digitBuffer = "";
          }}
          @keydown=${this._onFieldKey(field)}
        >
          ${pad2(value)}
        </div>
        <div
          class="step-btn down"
          role="button"
          tabindex="-1"
          aria-label=${this._t(field === "hours" ? "time_hour_down" : "time_minute_down")}
          @pointerdown=${this._startRepeat(field, -1)}
          @pointerup=${this._stopRepeat}
          @pointerleave=${this._stopRepeat}
          @pointercancel=${this._stopRepeat}
        >
          <ha-icon icon="mdi:menu-down"></ha-icon>
        </div>
      </div>
    `;
  }

  private _renderCompactRow(): TemplateResult {
    const cfg = this._config!;
    const st = this._state;
    const name = cfg.name ?? (st?.attributes.friendly_name as string | undefined) ?? cfg.entity;
    const draft = this._draft ?? { hours: 0, minutes: 0 };
    const subtitle = !this._available
      ? this._t("unavailable")
      : (cfg.subtitle ?? this._t("time_current", {
          zeit: this._entityTime
            ? formatTime(this._entityTime.hours, this._entityTime.minutes, this._twelveHour)
            : "-",
        }));
    return html`
      <div class="compact">
        <div class="header-icon">
          <ha-icon icon=${cfg.icon ?? DEFAULT_TIME_ICON}></ha-icon>
        </div>
        <div class="header-text">
          <div class="header-name">${name}</div>
          <div class="header-sub">${subtitle}</div>
        </div>
        <div class="nudge-group">
          <div
            class="nudge minus"
            role="button"
            tabindex="0"
            aria-label=${this._t("time_minute_down")}
            @pointerdown=${this._startNudge(-1)}
            @pointerup=${this._stopRepeat}
            @pointerleave=${this._stopRepeat}
            @pointercancel=${this._stopRepeat}
            @keydown=${activateOnKey(() => this._nudge(-1))}
          >
            <ha-icon icon="mdi:minus"></ha-icon>
          </div>
          <div
            class="nudge-value"
            role="spinbutton"
            tabindex="0"
            aria-valuenow=${draft.hours * 60 + draft.minutes}
            aria-valuemin="0"
            aria-valuemax="1439"
            aria-label=${this._t("time_hours")}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                this._nudge(e.key === "ArrowUp" ? 1 : -1);
              }
            }}
          >
            ${formatTime(draft.hours, draft.minutes, this._twelveHour)}
          </div>
          <div
            class="nudge plus"
            role="button"
            tabindex="0"
            aria-label=${this._t("time_minute_up")}
            @pointerdown=${this._startNudge(1)}
            @pointerup=${this._stopRepeat}
            @pointerleave=${this._stopRepeat}
            @pointercancel=${this._stopRepeat}
            @keydown=${activateOnKey(() => this._nudge(1))}
          >
            <ha-icon icon="mdi:plus"></ha-icon>
          </div>
        </div>
      </div>
    `;
  }

  private _startNudge(direction: 1 | -1): (e: Event) => void {
    return (e: Event) => {
      e.preventDefault();
      this._nudge(direction);
      this._stopRepeat();
      this._repeatTimer = window.setInterval(() => this._nudge(direction), TIME_REPEAT_MS);
      this._accelerateTimer = window.setTimeout(() => {
        if (this._repeatTimer) clearInterval(this._repeatTimer);
        this._repeatTimer = window.setInterval(() => this._nudge(direction), TIME_REPEAT_FAST_MS);
      }, TIME_REPEAT_ACCELERATE_AFTER_MS);
    };
  }

  private _renderPresets(): TemplateResult {
    const draft = this._draft;
    return html`
      <div class="presets">
        ${this._presets.map((preset) => {
          const on = !!draft && draft.hours === preset.hours && draft.minutes === preset.minutes;
          return html`
            <div
              class="preset ${on ? "on" : ""}"
              role="button"
              tabindex="0"
              aria-pressed=${on ? "true" : "false"}
              @click=${() => this._applyPreset(preset)}
              @keydown=${activateOnKey(() => this._applyPreset(preset))}
            >
              ${preset.label}
            </div>
          `;
        })}
      </div>
    `;
  }

  // ---- wheel ------------------------------------------------------------

  private _wheelValues(field: Field): number[] {
    if (field === "minutes") return Array.from({ length: 60 }, (_, i) => i);
    // 12h shows 1..12 in wheel order, so index 0 is 12 rather than a gap.
    if (this._twelveHour) return [12, ...Array.from({ length: 11 }, (_, i) => i + 1)];
    return Array.from({ length: 24 }, (_, i) => i);
  }

  private _wheelIndex(field: Field): number {
    const draft = this._draft ?? { hours: 0, minutes: 0 };
    const value = field === "minutes" ? draft.minutes : to12HourOrRaw(draft.hours, this._twelveHour);
    const index = this._wheelValues(field).indexOf(value);
    return index < 0 ? 0 : index;
  }

  private _onWheelScroll(field: Field): (e: Event) => void {
    return (e: Event) => {
      // Ignore the scroll the card itself just performed to follow the value.
      if (this._wheelSyncing.has(field)) return;
      const el = e.currentTarget as HTMLElement;
      const existing = this._wheelTimers.get(field);
      if (existing) clearTimeout(existing);
      // Read only once the wheel has settled: mid-flick positions are between
      // entries, and snapping has not had its say yet.
      this._wheelTimers.set(
        field,
        window.setTimeout(() => {
          this._wheelTimers.delete(field);
          const values = this._wheelValues(field);
          const index = Math.max(
            0,
            Math.min(values.length - 1, Math.round(el.scrollTop / TIME_WHEEL_ITEM_HEIGHT)),
          );
          this._commitWheel(field, values[index]);
        }, TIME_WHEEL_SETTLE_MS),
      );
    };
  }

  private _commitWheel(field: Field, value: number): void {
    if (!this._draft || !this._available) return;
    if (field === "minutes") {
      if (this._draft.minutes === value) return;
      this._setDraft({ ...this._draft, minutes: value });
      return;
    }
    const hours = this._twelveHour
      ? from12Hour(value, to12Hour(this._draft.hours).pm)
      : value;
    if (this._draft.hours === hours) return;
    this._setDraft({ ...this._draft, hours });
  }

  // Keeps each wheel parked on the current value when it changed from
  // anywhere other than that wheel — a stepper elsewhere, a revert, or the
  // helper itself.
  private _syncWheels(attempt = 0): void {
    if (this._config?.style !== "wheel") return;
    let pending = false;
    for (const field of ["hours", "minutes"] as Field[]) {
      if (this._wheelTimers.has(field)) continue;
      const el = this.renderRoot?.querySelector<HTMLElement>(`.wheel[data-field="${field}"]`);
      if (!el) continue;
      const target = this._wheelIndex(field) * TIME_WHEEL_ITEM_HEIGHT;
      if (Math.abs(el.scrollTop - target) < 1) continue;
      this._wheelSyncing.add(field);
      el.scrollTop = target;
      // On the first render the card may not be laid out yet, and assigning
      // scrollTop to an element that cannot scroll is silently dropped. Read
      // it back and try again rather than leaving the wheel parked at zero.
      if (Math.abs(el.scrollTop - target) >= 1) pending = true;
      window.setTimeout(() => this._wheelSyncing.delete(field), 60);
    }
    if (pending && attempt < 5) {
      window.setTimeout(() => this._syncWheels(attempt + 1), 50);
    }
  }

  private _renderWheels(): TemplateResult {
    return html`
      <div class="wheel-box">
        <div class="wheel-band"></div>
        ${this._renderWheel("hours")}
        <div class="wheel-separator">:</div>
        ${this._renderWheel("minutes")}
      </div>
    `;
  }

  private _renderWheel(field: Field): TemplateResult {
    const values = this._wheelValues(field);
    const current = values[this._wheelIndex(field)];
    // In 12h the list starts at 12 and runs 1..11, so its first and last
    // entries are not the range — a screen reader needs the actual bounds,
    // not the scroll order.
    const low = Math.min(...values);
    const high = Math.max(...values);
    return html`
      <div
        class="wheel"
        data-field=${field}
        role="spinbutton"
        tabindex="0"
        aria-valuenow=${current}
        aria-valuemin=${low}
        aria-valuemax=${high}
        aria-label=${this._t(field === "hours" ? "time_hours" : "time_minutes")}
        @scroll=${this._onWheelScroll(field)}
        @touchstart=${stopSwipe}
        @touchmove=${stopSwipe}
        @mousedown=${stopSwipe}
        @mousemove=${stopSwipe}
        @keydown=${this._onFieldKey(field)}
        @focus=${() => (this._focus = field)}
        @blur=${() => {
          if (this._focus === field) this._focus = undefined;
          this._digitBuffer = "";
        }}
      >
        <div class="wheel-pad"></div>
        ${values.map(
          (value) => html`
            <div class="wheel-item ${value === current ? "on" : ""}">${pad2(value)}</div>
          `,
        )}
        <div class="wheel-pad"></div>
      </div>
    `;
  }

  private _renderHalfPills(): TemplateResult {
    const pm = this._draft ? to12Hour(this._draft.hours).pm : false;
    return html`
      <div class="halves">
        ${[false, true].map(
          (isPm) => html`
            <div
              class="half ${pm === isPm ? "on" : ""}"
              role="button"
              tabindex="0"
              @click=${() => this._setHalf(isPm)}
              @keydown=${activateOnKey(() => this._setHalf(isPm))}
            >
              ${isPm ? "PM" : "AM"}
            </div>
          `,
        )}
      </div>
    `;
  }

  private _renderApplyRow(): TemplateResult {
    const dirty = this._dirty && this._available;
    const showRevert = (this._config?.show_revert ?? true) && dirty;
    return html`
      <div class="apply-row">
        <div
          class="apply ${dirty ? "dirty" : ""} ${this._applyMorph ? "morph" : ""}"
          role="button"
          tabindex=${dirty ? "0" : "-1"}
          aria-disabled=${dirty ? "false" : "true"}
          @click=${dirty ? () => this._apply() : nothing}
          @keydown=${dirty ? activateOnKey(() => this._apply()) : nothing}
        >
          ${this._t(dirty ? "time_apply" : "time_unchanged")}
        </div>
        ${showRevert
          ? html`<div
              class="revert"
              role="button"
              tabindex="0"
              aria-label=${this._t("time_revert")}
              title=${this._t("time_revert")}
              @click=${this._revert}
              @keydown=${activateOnKey(this._revert)}
            >
              <ha-icon icon="mdi:undo-variant"></ha-icon>
            </div>`
          : nothing}
      </div>
    `;
  }

  static styles = [
    glassCardStyles,
    css`
      ha-card {
        border-radius: var(--m3ti-radius);
      }

      .card-inner {
        border-radius: var(--m3ti-radius);
        gap: 12px;
      }

      .card-inner.dimmed {
        opacity: 0.4;
        pointer-events: none;
      }

      .notice {
        font-size: 13px;
        opacity: 0.7;
        color: var(--m3ti-secondary-text);
        padding: 6px 2px;
      }

      /* ---- header ---- */

      .header {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .header-icon {
        flex-shrink: 0;
        width: ${TIME_HEADER_ICON_SIZE}px;
        height: ${TIME_HEADER_ICON_SIZE}px;
        border-radius: ${TIME_HEADER_ICON_RADIUS}px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--m3ti-accent-tint-ink, var(--m3ti-accent-fg, var(--m3ti-accent)));
        background: var(--m3ti-accent-tint);
      }

      .header-icon ha-icon {
        --mdc-icon-size: 22px;
      }

      .header-text {
        flex: 1;
        min-width: 0;
      }

      .header-name {
        font-size: 14px;
        font-weight: 700;
        line-height: 1.2;
        color: var(--m3ti-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .header-sub {
        font-size: 11px;
        opacity: 0.6;
        color: var(--m3ti-secondary-text);
      }

      .date-chip {
        flex-shrink: 0;
        font-size: 11px;
        font-weight: 600;
        padding: 4px 9px;
        border-radius: 12px;
        color: var(--m3ti-accent-tint-ink, var(--m3ti-accent-fg, var(--m3ti-accent)));
        background: var(--m3ti-accent-tint);
      }

      .external {
        display: flex;
        align-items: center;
        gap: 7px;
        font-size: 11px;
        font-weight: 600;
        padding: 7px 10px;
        border-radius: 13px;
        cursor: pointer;
        color: var(--warning-color, #f0a24a);
        background: color-mix(in srgb, var(--warning-color, #f0a24a) 15%, var(--ha-card-background, var(--card-background-color)));
      }

      .external ha-icon {
        --mdc-icon-size: 15px;
      }

      /* ---- stepper ---- */

      .stepper {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }

      .column {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .step-btn {
        width: var(--m3ti-field-width);
        height: ${TIME_STEP_BUTTON_HEIGHT}px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        user-select: none;
        color: var(--m3ti-secondary-text);
        background: color-mix(in srgb, var(--primary-text-color) 8%, var(--ha-card-background, var(--card-background-color)));
        transition: background 200ms ${EASING};
      }

      .step-btn.up {
        border-radius: ${TIME_STEP_RADIUS_OUTER}px ${TIME_STEP_RADIUS_OUTER}px
          ${TIME_STEP_RADIUS_INNER}px ${TIME_STEP_RADIUS_INNER}px;
      }

      .step-btn.down {
        border-radius: ${TIME_STEP_RADIUS_INNER}px ${TIME_STEP_RADIUS_INNER}px
          ${TIME_STEP_RADIUS_OUTER}px ${TIME_STEP_RADIUS_OUTER}px;
      }

      .step-btn:active {
        background: color-mix(in srgb, var(--primary-text-color) 14%, var(--ha-card-background, var(--card-background-color)));
      }

      .step-btn ha-icon {
        --mdc-icon-size: 20px;
      }

      .field {
        width: var(--m3ti-field-width);
        height: ${TIME_FIELD_HEIGHT}px;
        border-radius: ${TIME_FIELD_RADIUS}px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        user-select: none;
        font-size: ${TIME_DIGIT_FONT_SIZE}px;
        font-weight: 700;
        /* Digits keep their column when the value changes, so the field does
           not twitch as you step through it. */
        font-variant-numeric: tabular-nums;
        color: var(--m3ti-text);
        background: color-mix(in srgb, var(--primary-text-color) 8%, var(--ha-card-background, var(--card-background-color)));
        transition:
          background 200ms ${EASING},
          color 200ms ${EASING};
      }

      .field.active {
        color: var(--m3ti-accent-fg, var(--m3ti-accent));
        background: color-mix(in srgb, var(--m3ti-accent) 20%, var(--ha-card-background, var(--card-background-color)));
      }

      .field:focus-visible,
      .apply:focus-visible,
      .revert:focus-visible,
      .half:focus-visible,
      .external:focus-visible {
        outline: 2px solid var(--m3ti-accent);
        outline-offset: 2px;
      }

      .card-inner.no-animations .field,
      .card-inner.no-animations .step-btn,
      .card-inner.no-animations .apply,
      .card-inner.no-animations .half {
        transition: none;
      }

      .separator {
        font-size: ${TIME_SEPARATOR_FONT_SIZE}px;
        font-weight: 700;
        opacity: 0.35;
        color: var(--m3ti-text);
        /* Sits level with the value fields, not the stepper buttons. */
        align-self: center;
      }

      /* ---- AM/PM ---- */

      .halves {
        display: flex;
        justify-content: center;
        gap: 8px;
      }

      .half {
        width: 44px;
        height: 30px;
        border-radius: 15px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        user-select: none;
        font-size: 12px;
        font-weight: 700;
        color: var(--m3ti-secondary-text);
        background: color-mix(in srgb, var(--primary-text-color) 8%, var(--ha-card-background, var(--card-background-color)));
        transition:
          border-radius 250ms ${EASING},
          background 250ms ${EASING},
          color 250ms ${EASING};
      }

      .half.on {
        border-radius: 9px;
        color: var(--m3ti-accent-fg, var(--m3ti-accent));
        background: color-mix(in srgb, var(--m3ti-accent) 20%, var(--ha-card-background, var(--card-background-color)));
      }

      /* ---- wheel ---- */

      .wheel-box {
        position: relative;
        display: flex;
        align-items: stretch;
        justify-content: center;
        gap: 4px;
        height: ${TIME_WHEEL_HEIGHT}px;
        border-radius: ${TIME_WHEEL_RADIUS}px;
        background: color-mix(in srgb, var(--primary-text-color) 5%, var(--ha-card-background, var(--card-background-color)));
        overflow: hidden;
      }

      .wheel-band {
        position: absolute;
        left: 8px;
        right: 8px;
        top: ${TIME_WHEEL_PAD}px;
        height: ${TIME_WHEEL_ITEM_HEIGHT}px;
        border-radius: ${TIME_WHEEL_BAND_RADIUS}px;
        background: var(--m3ti-accent-tint);
        /* Purely a backdrop — every pointer event belongs to the wheels. */
        pointer-events: none;
      }

      .wheel {
        position: relative;
        flex: 0 1 92px;
        height: 100%;
        overflow-y: auto;
        scroll-snap-type: y mandatory;
        /* Tells the browser this surface owns vertical panning, so a gesture
           here is never handed to a horizontal pager. */
        touch-action: pan-y;
        scrollbar-width: none;
        -ms-overflow-style: none;
        outline: none;
      }

      .wheel::-webkit-scrollbar {
        display: none;
      }

      .wheel:focus-visible {
        outline: 2px solid var(--m3ti-accent);
        outline-offset: -2px;
        border-radius: ${TIME_WHEEL_BAND_RADIUS}px;
      }

      .wheel-pad {
        height: ${TIME_WHEEL_PAD}px;
      }

      .wheel-item {
        height: ${TIME_WHEEL_ITEM_HEIGHT}px;
        display: flex;
        align-items: center;
        justify-content: center;
        scroll-snap-align: center;
        font-size: ${TIME_WHEEL_IDLE_FONT_SIZE}px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        opacity: 0.55;
        color: var(--m3ti-text);
        transition:
          font-size 150ms ${EASING},
          opacity 150ms ${EASING},
          color 150ms ${EASING};
      }

      .wheel-item.on {
        font-size: ${TIME_WHEEL_ACTIVE_FONT_SIZE}px;
        font-weight: 700;
        opacity: 1;
        color: var(--m3ti-accent-fg, var(--m3ti-accent));
      }

      .card-inner.no-animations .wheel-item {
        transition: none;
      }

      .wheel-separator {
        align-self: center;
        font-size: ${TIME_SEPARATOR_FONT_SIZE}px;
        font-weight: 700;
        opacity: 0.35;
        color: var(--m3ti-text);
        pointer-events: none;
      }

      /* ---- compact ---- */

      .compact {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .nudge-group {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: 3px;
      }

      .nudge {
        width: ${TIME_COMPACT_BUTTON_WIDTH}px;
        height: ${TIME_COMPACT_HEIGHT}px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        user-select: none;
        color: var(--m3ti-secondary-text);
        background: color-mix(in srgb, var(--primary-text-color) 8%, var(--ha-card-background, var(--card-background-color)));
      }

      .nudge.minus {
        border-radius: ${TIME_COMPACT_RADIUS_OUTER}px ${TIME_COMPACT_RADIUS_INNER}px
          ${TIME_COMPACT_RADIUS_INNER}px ${TIME_COMPACT_RADIUS_OUTER}px;
      }

      .nudge.plus {
        border-radius: ${TIME_COMPACT_RADIUS_INNER}px ${TIME_COMPACT_RADIUS_OUTER}px
          ${TIME_COMPACT_RADIUS_OUTER}px ${TIME_COMPACT_RADIUS_INNER}px;
      }

      .nudge ha-icon {
        --mdc-icon-size: 20px;
      }

      .nudge-value {
        height: ${TIME_COMPACT_HEIGHT}px;
        padding: 0 12px;
        border-radius: ${TIME_COMPACT_RADIUS_INNER}px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: ${TIME_COMPACT_VALUE_FONT_SIZE}px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        color: var(--m3ti-accent-fg, var(--m3ti-accent));
        background: color-mix(in srgb, var(--m3ti-accent) 20%, var(--ha-card-background, var(--card-background-color)));
      }

      .nudge:focus-visible,
      .nudge-value:focus-visible,
      .preset:focus-visible {
        outline: 2px solid var(--m3ti-accent);
        outline-offset: 2px;
      }

      /* ---- presets ---- */

      .presets {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .preset {
        flex: 1 1 auto;
        min-width: 64px;
        height: ${TIME_PRESET_HEIGHT}px;
        border-radius: ${TIME_PRESET_RADIUS}px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        user-select: none;
        font-size: 13px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: var(--m3ti-text);
        background: color-mix(in srgb, var(--primary-text-color) 8%, var(--ha-card-background, var(--card-background-color)));
        transition:
          border-radius 250ms ${EASING},
          background 250ms ${EASING},
          color 250ms ${EASING};
      }

      .preset.on {
        border-radius: ${TIME_PRESET_RADIUS_ACTIVE}px;
        color: #1c1c1c;
        background: var(--m3ti-accent);
      }

      .card-inner.no-animations .preset {
        transition: none;
      }

      /* ---- apply ---- */

      .apply-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .apply {
        flex: 1;
        min-width: 0;
        height: ${TIME_APPLY_HEIGHT}px;
        border-radius: ${TIME_APPLY_RADIUS}px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 600;
        cursor: default;
        user-select: none;
        /* Resting state reads as a label, not a button: nothing to press yet. */
        color: color-mix(in srgb, var(--m3ti-text) 40%, var(--ha-card-background, var(--card-background-color)));
        background: color-mix(in srgb, var(--primary-text-color) 8%, var(--ha-card-background, var(--card-background-color)));
        transition:
          border-radius ${TIME_APPLY_MORPH_MS}ms ${EASING},
          background 250ms ${EASING},
          color 250ms ${EASING};
      }

      .apply.dirty {
        cursor: pointer;
        font-size: 14px;
        font-weight: 700;
        color: #1c1c1c;
        background: var(--m3ti-accent);
      }

      .apply.morph {
        border-radius: ${TIME_APPLY_RADIUS_ACTIVE}px;
      }

      .revert {
        flex-shrink: 0;
        width: ${TIME_APPLY_HEIGHT}px;
        height: ${TIME_APPLY_HEIGHT}px;
        border-radius: ${TIME_APPLY_RADIUS}px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        color: var(--m3ti-secondary-text);
        background: color-mix(in srgb, var(--primary-text-color) 8%, var(--ha-card-background, var(--card-background-color)));
      }

      .revert ha-icon {
        --mdc-icon-size: 20px;
      }

      /* Safari gained color-mix() in 16.2, and an iPod touch 7 or an iPad Air 2
         stops at iOS 15. A plain declaration before each mix cannot serve as the
         fallback: every one of them contains var(), which defers the check until
         after substitution, where failure yields unset rather than the previous
         declaration — the tint did not fade, the fill disappeared entirely. This
         block is the one those browsers alone can see; the tint is what it gives
         up. Backticks are not allowed in here: this is a css template literal. */
      @supports not (color: color-mix(in srgb, red 50%, blue)) {
        .external {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .step-btn {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .step-btn:active {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .field {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .field.active {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .half {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .half.on {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .wheel-box {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .nudge {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .nudge-value {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .preset {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .apply {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .revert {
          background: var(--ha-card-background, var(--card-background-color));
        }
      }
      `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-time-card": M3TimeCard;
  }
}

const windowWithCards = window as unknown as Window & {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-time-card",
  name: "M3 Time Card",
  description:
    "Zeitwähler für input_datetime-Helfer: Stepper-Felder statt des nativen Browser-Zeitfelds, mit Übernehmen-Button.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
