import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import type {
  HomeAssistant,
  M3CounterCardConfig,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  PowerThreshold,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_COUNTER_RADIUS,
  DEFAULT_COUNTER_ICON,
  DEFAULT_COUNTER_ACCENT,
  DEFAULT_COUNTER_DECIMALS,
  DEFAULT_COUNTER_MIN_DIGITS,
  COUNTER_CELL_WIDTH,
  COUNTER_CELL_HEIGHT,
  COUNTER_CELL_NARROW_WIDTH,
  COUNTER_CELL_NARROW_HEIGHT,
  COUNTER_CELL_GAP,
  COUNTER_CELL_RADIUS,
  COUNTER_DIGIT_FONT_SIZE,
  COUNTER_DIGIT_FONT_SIZE_NARROW,
  COUNTER_NARROW_BREAKPOINT,
  COUNTER_ROLL_DURATION_MS,
  COUNTER_ROLL_STAGGER_MS,
  COUNTER_POWER_CHIP_COLOR,
  COUNTER_ADJUST_HEIGHT,
  COUNTER_ADJUST_RADIUS,
  resolveCornerRadius,
} from "./const";
import { resolveThemeColor, buildCssVars, resolveCommonColors, tintOn, tintInk, foregroundOn , foregroundVars, tintBackground } from "./shared/color-config";
import { glassCardStyles, glassCardClass } from "./shared/glass-card";
import { activateOnKey } from "./shared/a11y";
import { renderCardHeader, cardHeaderStyles } from "./shared/card-header";
import { shouldAnimate } from "./shared/animation";
import { fireEvent } from "./shared/editor-helpers";
import { localize, type TranslationKey } from "./localize";
import { hassChangeMatters } from "./shared/should-update";
import { confirmDialogStyles, renderConfirmDialog, type ConfirmRequest } from "./shared/confirm-dialog";
import { syncDialogOpenState } from "./shared/popup-card";
import { decimalSeparator, formatNumber } from "./shared/formatting";
import { TemplatedCard } from "./shared/templated-card";

console.info(
  `%c M3-COUNTER-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #85b7eb; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #85b7eb; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

interface DigitCell {
  key: string;
  char: string;
  kind: "sign" | "int" | "sep" | "frac";
}

@customElement("m3-counter-card")
export class M3CounterCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3CounterCardConfig;
  @state() private _narrow = false;
  @state() private _adjusting = false;
  @state() private _adjustError = "";
  /** The pending "are you sure?" of a calibration. */
  @state() private _confirm?: ConfirmRequest;

  private _minIntegerDigits = DEFAULT_COUNTER_MIN_DIGITS;
  private _prevDigitByKey = new Map<string, string>();
  private _animatingKeys = new Set<string>();
  private _animationTimers = new Map<string, number>();
  private _resizeObserver?: ResizeObserver;

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-counter-card-editor");
    return document.createElement(
      "m3-counter-card-editor",
    ) as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(hass: HomeAssistant): M3CounterCardConfig {
    const entities = Object.keys(hass?.states ?? {}).filter((eid) =>
      eid.startsWith("sensor."),
    );
    const entity =
      entities.find((eid) => /zahler|zaehler|counter|total/.test(eid)) ??
      entities[0] ??
      "";
    return {
      type: "custom:m3-counter-card",
      entity,
      glass_background: true,
    };
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return hassChangeMatters(changed, this.hass, [
      this._config?.entity,
      this._config?.power_entity,
      this._config?.daily_entity,
      this._config?.adjust_entity,
    ]);
  }

  public setConfig(config: M3CounterCardConfig): void {
    if (!config.entity) {
      throw new Error("m3-counter-card: 'entity' is required");
    }
    this._config = {
      glass_background: true,
      animation: "auto",
      decimals: DEFAULT_COUNTER_DECIMALS,
      digits: "auto",
      ...config,
    };
    if (typeof this._config.digits === "number") {
      this._minIntegerDigits = Math.max(1, this._config.digits);
    } else {
      this._minIntegerDigits = DEFAULT_COUNTER_MIN_DIGITS;
    }
  }

  public getCardSize(): number {
    return 2;
  }

  public getGridOptions(): LovelaceGridOptions {
    return {
      columns: "full",
      rows: "auto",
      min_rows: 2,
    };
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _decimalSeparator(): string {
    return decimalSeparator(this._language);
  }

  private _formatNumber(value: number, maxFractionDigits = 2): string {
    return formatNumber(this._language, value, { maximumFractionDigits: maxFractionDigits });
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    for (const timer of this._animationTimers.values()) {
      window.clearTimeout(timer);
    }
    this._animationTimers.clear();
  }

  protected firstUpdated(changed: PropertyValues): void {
    super.firstUpdated(changed);
    this._resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      const narrow = width > 0 && width < COUNTER_NARROW_BREAKPOINT;
      if (narrow !== this._narrow) this._narrow = narrow;
    });
    this._resizeObserver.observe(this);
  }

  private _powerChipColor(power: number): string {
    const base = this._config?.power_chip_color
      ? resolveThemeColor(this._config.power_chip_color)
      : COUNTER_POWER_CHIP_COLOR;
    const thresholds: PowerThreshold[] = this._config?.power_thresholds ?? [];
    const sorted = [...thresholds].sort((a, b) => a.above - b.above);
    let color = base;
    for (const t of sorted) {
      if (power > t.above) color = resolveThemeColor(t.color);
    }
    return color;
  }

  private _buildCells(
    integerDigits: number,
    decimals: number,
    intStr: string,
    fracStr: string,
    negative: boolean,
  ): DigitCell[] {
    const cells: DigitCell[] = [];
    if (negative) {
      cells.push({ key: "sign", char: "−", kind: "sign" });
    }
    for (let i = 0; i < integerDigits; i++) {
      const posFromRight = integerDigits - 1 - i;
      cells.push({
        key: `int-${posFromRight}`,
        char: intStr[i] ?? "0",
        kind: "int",
      });
    }
    if (decimals > 0) {
      cells.push({ key: "sep", char: this._decimalSeparator(), kind: "sep" });
      for (let i = 0; i < decimals; i++) {
        cells.push({ key: `frac-${i}`, char: fracStr[i] ?? "0", kind: "frac" });
      }
    }
    return cells;
  }

  private _scheduleAnimationEnd(key: string, newChar: string): void {
    const existing = this._animationTimers.get(key);
    if (existing !== undefined) window.clearTimeout(existing);
    const totalMs = COUNTER_ROLL_DURATION_MS + COUNTER_ROLL_STAGGER_MS;
    const timer = window.setTimeout(() => {
      this._animatingKeys.delete(key);
      this._animationTimers.delete(key);
      this._prevDigitByKey.set(key, newChar);
      this.requestUpdate();
    }, totalMs);
    this._animationTimers.set(key, timer);
  }

  /**
   * Which entity the correction is written to, and how.
   *
   * Three ways, because a reading can be three different things:
   *
   * - **value** — the entity is writable itself (`input_number`, `number`).
   * - **offset** — a separate helper is moved by the difference, which is what
   *   a template sensor built as "sources + offset" needs.
   * - **calibrate** — the entity is a `utility_meter`, which has no state to
   *   write and a service of its own instead. This is the case the card was
   *   really built for and the one it could not do: an energy or water meter
   *   is a `utility_meter` far more often than it is a helper.
   *
   * A `utility_meter` must never be corrected through its *source*. The meter
   * reads a falling source as a meter change and adds the whole new value on
   * the next rise — measured once on the author's instance as 18,899 → 40,793
   * in a single five-minute row. Hence the platform check before the domain
   * one: a helper that happens to feed a meter still gets offset mode, but the
   * meter itself gets calibrated.
   */
  private get _adjustTarget():
    | { entityId: string; mode: "value" | "offset" | "calibrate" }
    | undefined {
    const cfg = this._config;
    if (!cfg?.adjustable) return undefined;
    const target = cfg.adjust_entity || cfg.entity;
    if (this._platformOf(target) === "utility_meter") {
      return { entityId: target, mode: "calibrate" };
    }
    const domain = target.split(".")[0];
    if (target !== cfg.entity) return { entityId: target, mode: "offset" };
    // Writing the displayed entity only works where a set service exists;
    // a plain sensor has none.
    if (domain === "input_number" || domain === "number") return { entityId: target, mode: "value" };
    return undefined;
  }

  /** The integration behind an entity, from the frontend's registry snapshot. */
  private _platformOf(entityId: string): string | undefined {
    const registry = this.hass?.entities as
      | Record<string, { platform?: string | null }>
      | undefined;
    return registry?.[entityId]?.platform ?? undefined;
  }

  /**
   * Why the correction cannot be offered, in one sentence, or nothing when it
   * can. A silently missing control is the worst of the three states: the
   * option is on, nothing appears, and the card never says what it wants.
   */
  private get _adjustBlocker(): string | undefined {
    const cfg = this._config;
    if (!cfg?.adjustable || this._adjustTarget) return undefined;
    return this._t("counter_adjust_unwritable");
  }

  private async _saveAdjust(raw: string): Promise<void> {
    const target = this._adjustTarget;
    const cfg = this._config;
    if (!target || !cfg || !this.hass) return;
    const wanted = parseFloat(raw.replace(",", "."));
    if (Number.isNaN(wanted)) return;

    if (target.mode === "calibrate") {
      // A meter carries history. Rewriting it is not undoable from here, and
      // the statistics engine reads a downward step as a meter change, so the
      // question names both before anything is sent.
      const shown = this.hass.states[cfg.entity]?.state ?? "";
      this._confirm = {
        title: this._t("counter_calibrate_confirm").replace("{to}", String(wanted)),
        message: this._t("counter_calibrate_confirm_body")
          .replace("{from}", shown)
          .replace("{to}", String(wanted)),
        confirmLabel: this._t("counter_calibrate"),
        cancelLabel: this._t("counter_adjust_cancel"),
        icon: "mdi:counter",
        onConfirm: () => {
          this.hass?.callService("utility_meter", "calibrate", {
            entity_id: target.entityId,
            value: wanted,
          });
          this._adjusting = false;
          this._adjustError = "";
        },
      };
      return;
    }

    const domain = target.entityId.split(".")[0];
    let value = wanted;
    if (target.mode === "offset") {
      const shown = parseFloat(this.hass.states[cfg.entity]?.state ?? "");
      const current = parseFloat(this.hass.states[target.entityId]?.state ?? "");
      if (Number.isNaN(shown) || Number.isNaN(current)) return;
      // The reading is sources + offset, so moving the offset by the shortfall
      // moves the reading to the wanted value without the card needing to know
      // what the sources are.
      value = current + (wanted - shown);
    }
    try {
      await this.hass.callService(domain, "set_value", { entity_id: target.entityId, value });
      this._adjusting = false;
      this._adjustError = "";
    } catch (e) {
      console.warn("m3-counter-card: could not write the correction", e);
      this._adjustError = this._t("counter_adjust_failed");
    }
  }

  // Lives in the header beside the power chip rather than as a labelled row
  // below the digits: a correction is a rare, deliberate act, and a full-width
  // button for it competes with the reading itself for attention.
  private _renderAdjustButton() {
    if (this._adjusting) return nothing;
    const blocker = this._adjustBlocker;
    if (blocker) {
      // Drawn, greyed, and carrying its reason. `adjustable: true` on a plain
      // sensor is a config that looks right and does nothing.
      return html`
        <div class="adjust-open blocked" title=${blocker} aria-label=${blocker}>
          <ha-icon icon="mdi:pencil-off-outline"></ha-icon>
        </div>
      `;
    }
    if (!this._adjustTarget) return nothing;
    return html`
      <div
        class="adjust-open"
        role="button"
        tabindex="0"
        aria-label=${this._t("counter_adjust")}
        title=${this._t("counter_adjust")}
        @click=${(e: Event) => {
          // The header itself opens more-info, and this button sits inside it.
          e.stopPropagation();
          this._adjustError = "";
          this._adjusting = true;
        }}
        @keydown=${activateOnKey((e: Event) => {
          e.stopPropagation();
          this._adjustError = "";
          this._adjusting = true;
        })}
      >
        <ha-icon icon="mdi:pencil-outline"></ha-icon>
      </div>
    `;
  }

  private _renderAdjust(currentValue: number) {
    const target = this._adjustTarget;
    if (!target) return nothing;
    if (!this._adjusting) return nothing;
    return html`
      <div class="adjust-row">
        <input
          class="adjust-input"
          type="text"
          inputmode="decimal"
          .value=${Number.isNaN(currentValue) ? "" : String(currentValue)}
          .placeholder=${this._t("counter_adjust_placeholder")}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === "Enter") this._saveAdjust((e.target as HTMLInputElement).value);
            if (e.key === "Escape") this._adjusting = false;
          }}
        />
        <div
          class="adjust-btn save"
          role="button"
          tabindex="0"
          @click=${(e: Event) => {
            const input = (e.currentTarget as HTMLElement)
              .parentElement?.querySelector<HTMLInputElement>(".adjust-input");
            if (input) this._saveAdjust(input.value);
          }}
        >
          ${this._t("counter_adjust_save")}
        </div>
        <div
          class="adjust-btn"
          role="button"
          tabindex="0"
          @click=${() => (this._adjusting = false)}
        >
          ${this._t("counter_adjust_cancel")}
        </div>
      </div>
      <div class="adjust-caution">${this._t("counter_adjust_caution")}</div>
      ${this._adjustError ? html`<div class="adjust-error">${this._adjustError}</div>` : nothing}
    `;
  }

  protected render() {
    if (!this._config || !this.hass) return nothing;

    const entityState = this.hass.states[this._config.entity];
    const name = this._config.name || entityState?.attributes.friendly_name || "";
    const icon = this._config.icon || DEFAULT_COUNTER_ICON;
    const subtitle = this._config.subtitle || this._t("counter_subtitle_default");
    const accentColor = this._config.accent_color
      ? resolveThemeColor(this._config.accent_color)
      : DEFAULT_COUNTER_ACCENT;
    const cellBackgroundCss = this._config.cell_background
      ? resolveThemeColor(this._config.cell_background)
      : tintBackground("var(--primary-text-color)", undefined, 8);
    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(
      this._config,
    );

    const radius = resolveCornerRadius(
      this._config.radius ?? DEFAULT_COUNTER_RADIUS,
      this._config.corners,
    );

    const decimals = this._config.decimals ?? DEFAULT_COUNTER_DECIMALS;
    const unit = entityState?.attributes.unit_of_measurement ?? "";
    const rawValue = entityState ? parseFloat(entityState.state) : NaN;
    const unavailable = !entityState || Number.isNaN(rawValue);

    const animate = shouldAnimate(this._config.animation);

    let cells: DigitCell[];
    if (unavailable) {
      const intCount = this._minIntegerDigits;
      cells = this._buildCells(
        intCount,
        decimals,
        "".padStart(intCount, "–"),
        "".padStart(decimals, "–"),
        false,
      );
    } else {
      const negative = rawValue < 0;
      const absValue = Math.abs(rawValue);
      const fixed = absValue.toFixed(decimals);
      const [intPart, fracPart] = fixed.split(".");
      const neededDigits = Math.max(1, intPart.length);
      if (neededDigits > this._minIntegerDigits) {
        this._minIntegerDigits = neededDigits;
      }
      const intStr = intPart.padStart(this._minIntegerDigits, "0");
      cells = this._buildCells(
        this._minIntegerDigits,
        decimals,
        intStr,
        fracPart ?? "",
        negative,
      );
    }

    for (const cell of cells) {
      if (cell.kind !== "int" && cell.kind !== "frac") continue;
      const prev = this._prevDigitByKey.get(cell.key);
      if (
        animate &&
        !unavailable &&
        prev !== undefined &&
        prev !== cell.char &&
        !this._animatingKeys.has(cell.key)
      ) {
        this._animatingKeys.add(cell.key);
        this._scheduleAnimationEnd(cell.key, cell.char);
      } else if (!this._animatingKeys.has(cell.key)) {
        this._prevDigitByKey.set(cell.key, cell.char);
      }
    }

    const powerEntity = this._config.power_entity
      ? this.hass.states[this._config.power_entity]
      : undefined;
    const powerValue = powerEntity ? parseFloat(powerEntity.state) : NaN;
    const showPowerChip =
      !!this._config.power_entity && !unavailable && !Number.isNaN(powerValue);

    const dailyEntity = this._config.daily_entity
      ? this.hass.states[this._config.daily_entity]
      : undefined;
    const dailyValue = dailyEntity ? parseFloat(dailyEntity.state) : NaN;
    const showTicker =
      !!this._config.show_ticker &&
      !!this._config.daily_entity &&
      dailyEntity &&
      !Number.isNaN(dailyValue);

    // The glyph sits on this well, not on the card, so its contrast has to be
    // measured against the well.
    const iconWellCss = tintOn(this, accentColor, this._config.accent_opacity, 18);
    const cssVars = buildCssVars({
      "m3p-icon-color": foregroundOn(accentColor, iconWellCss),
      "m3p-icon-bg": iconWellCss,
      "m3p-text": textColorCss,
      "m3p-secondary-text": secondaryTextColorCss,
      "counter-accent": accentColor,
      "counter-frac-bg": tintOn(this, accentColor, this._config.accent_opacity, 18),
      "counter-cell-bg": cellBackgroundCss,
      "counter-cell-w": `${this._narrow ? COUNTER_CELL_NARROW_WIDTH : COUNTER_CELL_WIDTH}px`,
      "counter-cell-h": `${this._narrow ? COUNTER_CELL_NARROW_HEIGHT : COUNTER_CELL_HEIGHT}px`,
      "counter-digit-size": `${this._narrow ? COUNTER_DIGIT_FONT_SIZE_NARROW : COUNTER_DIGIT_FONT_SIZE}px`,
      // Fills keep the accent; these twins carry it where it is text.
      ...foregroundVars(this, {
        "counter-accent": accentColor,
      }),
    });

    const moreInfo = () =>
      fireEvent(this, "hass-more-info", { entityId: this._config!.entity });

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(this._config.glass_background)}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          ${renderCardHeader({
            icon,
            name,
            subtitle,
            onClick: moreInfo,
            right:
              // The blocker counts too: a blocked pencil is the whole point of
              // drawing one. Gating on the target alone meant `adjustable` on a
              // plain sensor still showed nothing at all — unless a power chip
              // happened to open the header for it.
              showPowerChip || this._adjustTarget || this._adjustBlocker
                ? html`
                    <div class="header-right">
                      ${showPowerChip
                        ? html`
                            <div
                              class="power-chip"
                              style=${`color: ${tintInk(this, this._powerChipColor(powerValue), this._config.power_chip_opacity, 18)}; background: ${tintOn(this, this._powerChipColor(powerValue), this._config.power_chip_opacity, 18)};`}
                            >
                              <ha-icon icon="mdi:lightning-bolt"></ha-icon>
                              <span>${this._formatNumber(powerValue, 0)} W</span>
                            </div>
                          `
                        : nothing}
                      ${this._renderAdjustButton()}
                    </div>
                  `
                : undefined,
          })}

          <div
            class="digit-row ${unavailable ? "unavailable" : ""}"
            role="button"
            tabindex="0"
            aria-label=${name}
            @click=${moreInfo}
            @keydown=${activateOnKey(moreInfo)}
          >
            ${repeat(
              cells,
              (c) => c.key,
              (c) => this._renderCell(c),
            )}
            ${unit
              ? html`<span class="counter-unit">${unit}</span>`
              : nothing}
          </div>

          ${showTicker
            ? html`
                <div class="ticker">
                  +${this._formatNumber(dailyValue)} ${dailyEntity!.attributes.unit_of_measurement ?? unit}
                  ${this._t("counter_ticker_today")}
                </div>
              `
            : nothing}

          ${this._renderAdjust(rawValue)}
        </div>
      </ha-card>
      <!-- Outside the card: a modal dialog is painted in the top layer, and
           ha-card's own colour scope does not reach it. -->
      ${renderConfirmDialog({
        request: this._confirm,
        host: this,
        onCancel: () => {
          this._confirm = undefined;
        },
      })}
    `;
  }

  private _renderCell(cell: DigitCell) {
    if (cell.kind === "sep") {
      return html`<span class="cell sep">${cell.char}</span>`;
    }
    if (cell.kind === "sign") {
      return html`<div class="cell sign">${cell.char}</div>`;
    }
    const animating = this._animatingKeys.has(cell.key);
    const prevChar = this._prevDigitByKey.get(cell.key) ?? cell.char;
    return html`
      <div class="cell ${cell.kind}">
        ${animating
          ? html`
              <span class="digit-old">${prevChar}</span>
              <span class="digit-new">${cell.char}</span>
            `
          : html`<span class="digit-static">${cell.char}</span>`}
      </div>
    `;
  }

  protected updated(changed: PropertyValues): void {
    super.updated?.(changed);
    // A native <dialog> opens imperatively, not by an attribute.
    syncDialogOpenState(
      this.renderRoot.querySelector("dialog.m3-confirm") as HTMLDialogElement | null,
      this._confirm !== undefined,
    );
  }

  static styles = [
    confirmDialogStyles,
    glassCardStyles,
    cardHeaderStyles,
    css`
      .power-chip {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: 4px;
        height: 28px;
        padding: 0 10px;
        border-radius: 14px;
        font-size: 13px;
        font-weight: 700;
      }

      .power-chip ha-icon {
        --mdc-icon-size: 14px;
      }

      .digit-row {
        display: flex;
        align-items: flex-end;
        justify-content: center;
        gap: ${COUNTER_CELL_GAP}px;
        cursor: pointer;
      }

      .digit-row.unavailable {
        opacity: 0.4;
      }

      .digit-row:focus-visible {
        outline: 2px solid var(--counter-accent, var(--primary-color));
        outline-offset: 2px;
        border-radius: 8px;
      }

      .cell {
        flex-shrink: 0;
        width: var(--counter-cell-w);
        height: var(--counter-cell-h);
        border-radius: ${COUNTER_CELL_RADIUS}px;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        overflow: hidden;
        font-size: var(--counter-digit-size);
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }

      .cell.int {
        background: var(--counter-cell-bg);
        color: var(--m3p-text);
      }

      .cell.frac {
        background: var(--counter-frac-bg);
        color: var(--counter-accent-fg, var(--counter-accent));
      }

      .cell.sign {
        width: 12px;
        background: transparent;
        color: var(--m3p-text);
        font-size: calc(var(--counter-digit-size) * 0.8);
      }

      .cell.sep {
        width: 10px;
        flex-shrink: 0;
        text-align: center;
        font-size: 22px;
        opacity: 0.5;
        align-self: flex-end;
        padding-bottom: 8px;
        color: var(--m3p-text);
      }

      .digit-static {
        display: block;
      }

      .digit-old,
      .digit-new {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .digit-old {
        animation: roll-out-up ${COUNTER_ROLL_DURATION_MS}ms cubic-bezier(0.2, 0, 0, 1) forwards;
      }

      .digit-new {
        transform: translateY(100%);
        opacity: 0;
        animation: roll-in-up ${COUNTER_ROLL_DURATION_MS}ms cubic-bezier(0.2, 0, 0, 1)
          ${COUNTER_ROLL_STAGGER_MS}ms forwards;
      }

      @keyframes roll-out-up {
        to {
          transform: translateY(-100%);
          opacity: 0;
        }
      }

      @keyframes roll-in-up {
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }

      .counter-unit {
        margin-left: 8px;
        align-self: center;
        font-size: 14px;
        font-weight: 500;
        opacity: 0.55;
        color: var(--m3p-text);
      }

      .ticker {
        text-align: center;
        font-size: 12px;
        opacity: 0.6;
        color: var(--m3p-secondary-text);
      }

      /* ---- correcting the reading ---- */

      .header-right {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .adjust-open.blocked {
        cursor: default;
        opacity: 0.32;
      }

      .adjust-open {
        flex-shrink: 0;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        opacity: 0.7;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
        background: color-mix(in srgb, var(--primary-text-color) 8%, var(--ha-card-background, var(--card-background-color)));
        transition: opacity 200ms ease;
      }

      .adjust-open:hover,
      .adjust-open:focus-visible {
        opacity: 1;
      }

      .adjust-open ha-icon {
        --mdc-icon-size: 15px;
      }

      .adjust-row {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .adjust-input {
        flex: 1;
        min-width: 0;
        height: ${COUNTER_ADJUST_HEIGHT}px;
        box-sizing: border-box;
        padding: 0 14px;
        border: none;
        outline: none;
        border-radius: ${COUNTER_ADJUST_RADIUS}px;
        font-size: 16px;
        font-weight: 700;
        font-family: inherit;
        font-variant-numeric: tabular-nums;
        color: var(--m3p-text, var(--primary-text-color));
        background: color-mix(in srgb, var(--primary-text-color) 8%, var(--ha-card-background, var(--card-background-color)));
      }

      .adjust-btn {
        flex-shrink: 0;
        height: ${COUNTER_ADJUST_HEIGHT}px;
        padding: 0 14px;
        display: flex;
        align-items: center;
        border-radius: ${COUNTER_ADJUST_RADIUS}px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        color: var(--primary-text-color);
        background: color-mix(in srgb, var(--primary-text-color) 8%, var(--ha-card-background, var(--card-background-color)));
      }

      .adjust-btn.save {
        color: #1c1c1c;
        background: var(--counter-accent);
      }

      .adjust-caution {
        font-size: 10px;
        line-height: 1.35;
        opacity: 0.6;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
      }

      .adjust-error {
        font-size: 11px;
        color: var(--error-color, #e57368);
      }

      /* Safari gained color-mix() in 16.2, and an iPod touch 7 or an iPad Air 2
         stops at iOS 15. A plain declaration before each mix cannot serve as the
         fallback: every one of them contains var(), which defers the check until
         after substitution, where failure yields unset rather than the previous
         declaration — the tint did not fade, the fill disappeared entirely. This
         block is the one those browsers alone can see; the tint is what it gives
         up. Backticks are not allowed in here: this is a css template literal. */
      @supports not (color: color-mix(in srgb, red 50%, blue)) {
        .adjust-open {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .adjust-input {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .adjust-btn {
          background: var(--ha-card-background, var(--card-background-color));
        }
      }
      `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-counter-card": M3CounterCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-counter-card",
  name: "M3 Counter Card",
  description:
    "Ein Material-3-Zählerstand mit rollender Ziffernanzeige (z.B. für Stromzähler).",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
