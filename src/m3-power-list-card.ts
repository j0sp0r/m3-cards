import { LitElement, html, css, unsafeCSS, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import type {
  HomeAssistant,
  M3PowerListCardConfig,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  PowerListEntity,
  PowerEntryType,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_POWER_LIST_RADIUS,
  DEFAULT_POWER_LIST_ICON,
  DEFAULT_POWER_LIST_ACCENT,
  DEFAULT_POWER_LIST_PRODUCER_COLOR,
  DEFAULT_POWER_LIST_THRESHOLD,
  POWER_LIST_ROW_HEIGHT,
  POWER_LIST_ROW_RADIUS,
  POWER_LIST_ROW_RADIUS_ACTIVE,
  POWER_LIST_IDLE_ROW_HEIGHT,
  POWER_LIST_IDLE_ROW_RADIUS,
  POWER_LIST_TOGGLE_HEIGHT,
  POWER_LIST_TOGGLE_RADIUS,
  POWER_LIST_TOGGLE_RADIUS_OPEN,
  POWER_LIST_ICON_SIZE,
  POWER_LIST_ICON_RADIUS,
  POWER_LIST_ROW_GAP,
  POWER_LIST_FLIP_DURATION_MS,
  resolveCornerRadius,
} from "./const";
import { resolveThemeColor, buildCssVars, resolveCommonColors, tintOn, foregroundOn , foregroundVars, tintBackground } from "./shared/color-config";
import { glassCardStyles, glassCardClass } from "./shared/glass-card";
import { renderCardHeader, cardHeaderStyles } from "./shared/card-header";
import { shouldAnimate, STANDARD_EASING } from "./shared/animation";
import { fireEvent } from "./shared/editor-helpers";
import { discoverPowerEntities } from "./shared/ha-registry";
import { renderListRow, captureRowRects, flipRows, listRowStyles } from "./shared/list-row";
import { localize, type TranslationKey } from "./localize";
import { formatNumber } from "./shared/formatting";
import { discoveryChangeMatters } from "./shared/should-update";
import { TemplatedCard } from "./shared/templated-card";

console.info(
  `%c M3-POWER-LIST-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #f0a24a; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #f0a24a; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

const EASING = unsafeCSS(STANDARD_EASING);

interface PowerRow {
  key: string;
  entity: string;
  name: string;
  icon: string;
  type: PowerEntryType;
  power: number;
  active: boolean;
}

@customElement("m3-power-list-card")
export class M3PowerListCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3PowerListCardConfig;
  @state() private _expanded = false;
  @state() private _discovered: string[] = [];

  private _lastDiscoverKey?: string;
  private _discoverInFlight = false;
  private _rowRects: Map<string, DOMRect> = new Map();

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-power-list-card-editor");
    return document.createElement(
      "m3-power-list-card-editor",
    ) as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(): M3PowerListCardConfig {
    return {
      type: "custom:m3-power-list-card",
      auto_discover: true,
      glass_background: true,
      max_visible: 3,
    };
  }

  public setConfig(config: M3PowerListCardConfig): void {
    this._config = {
      glass_background: true,
      animation: "auto",
      threshold: DEFAULT_POWER_LIST_THRESHOLD,
      sort: "power_desc",
      max_visible: 3,
      show_idle_toggle: true,
      ...config,
    };
  }

  public getCardSize(): number {
    return 4;
  }

  public getGridOptions(): LovelaceGridOptions {
    return {
      columns: "full",
      rows: "auto",
      min_rows: 4,
    };
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _formatNumber(value: number): string {
    return formatNumber(this._language, value, { maximumFractionDigits: 0 });
  }

  protected willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    if (changed.has("hass") || changed.has("_config")) {
      this._maybeDiscover();
    }
    this._rowRects = captureRowRects(this.renderRoot);
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    if (shouldAnimate(this._config?.animation)) {
      flipRows(this.renderRoot, this._rowRects, POWER_LIST_FLIP_DURATION_MS);
    }
  }

  private _maybeDiscover(): void {
    if (!this.hass || !this._config?.auto_discover) return;
    const key = JSON.stringify({
      areas: this._config.include_area ?? [],
      labels: this._config.include_label ?? [],
      excl: this._config.exclude_entities ?? [],
    });
    if (key === this._lastDiscoverKey) return;
    this._lastDiscoverKey = key;
    this._discover();
  }

  private async _discover(): Promise<void> {
    if (!this.hass || this._discoverInFlight) return;
    this._discoverInFlight = true;
    try {
      this._discovered = await discoverPowerEntities(this.hass, {
        includeAreas: this._config?.include_area,
        includeLabels: this._config?.include_label,
        excludeEntities: this._config?.exclude_entities,
      });
    } catch (e) {
      console.error("m3-power-list-card: auto-discovery failed", e);
    } finally {
      this._discoverInFlight = false;
    }
  }

  private _buildRows(): PowerRow[] {
    if (!this.hass || !this._config) return [];
    const threshold = this._config.threshold ?? DEFAULT_POWER_LIST_THRESHOLD;

    const sourceEntities: PowerListEntity[] = this._config.auto_discover
      ? this._discovered.map((entity) => ({ entity }))
      : (this._config.entities ?? []);

    return sourceEntities.map((entry): PowerRow => {
      const state = this.hass!.states[entry.entity];
      const power = state ? parseFloat(state.state) : NaN;
      const safePower = Number.isNaN(power) ? 0 : power;
      return {
        key: entry.entity,
        entity: entry.entity,
        name: entry.name || state?.attributes.friendly_name || entry.entity,
        icon: entry.icon || state?.attributes.icon || "mdi:power-plug",
        type: entry.type ?? "consumer",
        power: safePower,
        active: safePower > threshold,
      };
    });
  }

  private _sortRows(rows: PowerRow[]): PowerRow[] {
    const sort = this._config?.sort ?? "power_desc";
    const sorted = [...rows];
    if (sort === "power_desc") sorted.sort((a, b) => b.power - a.power);
    else if (sort === "power_asc") sorted.sort((a, b) => a.power - b.power);
    else if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }

  private _moreInfo(entityId: string): () => void {
    return () => fireEvent(this, "hass-more-info", { entityId });
  }

  private _watchedEntities(): string[] {
    if (!this._config) return [];
    return this._config.auto_discover
      ? this._discovered
      : (this._config.entities ?? []).map((e) => e.entity);
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return discoveryChangeMatters(changed, this.hass, this._watchedEntities());
  }

  protected render() {
    if (!this._config || !this.hass) return nothing;

    const name = this._config.name || this._t("power_list_default_name");
    const icon = this._config.icon || DEFAULT_POWER_LIST_ICON;
    const accentColor = this._accentColor();
    const producerColor = this._producerColor();
    const barTintColor = this._barTintColor();
    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(
      this._config,
    );

    const radius = resolveCornerRadius(
      this._config.radius ?? DEFAULT_POWER_LIST_RADIUS,
      this._config.corners,
    );

    const allRows = this._buildRows();
    const producers = allRows.filter((r) => r.type === "producer");
    const consumers = allRows.filter((r) => r.type === "consumer");

    const activeConsumers = this._sortRows(consumers.filter((r) => r.active));
    const idleConsumers = consumers.filter((r) => !r.active);

    const maxVisible = this._config.max_visible ?? 0;
    const visibleActive = maxVisible > 0 ? activeConsumers.slice(0, maxVisible) : activeConsumers;
    // Active consumers pushed out by max_visible stay active — they're only
    // collapsed, not idle. They keep the active row styling when expanded, and
    // the toggle wording switches to a neutral "weitere" so they aren't
    // mislabelled as idle in the count.
    const overflowActive = maxVisible > 0 ? activeConsumers.slice(maxVisible) : [];
    const hiddenCount = overflowActive.length + idleConsumers.length;

    const totalPower = consumers.reduce((sum, r) => sum + r.power, 0);
    // Scale bars against every active consumer, not just the visible slice, so
    // an overflow row's bar stays comparable to the ones above it (and so a
    // non-power_desc sort can't put the largest consumer outside the scale).
    const maxRowPower = Math.max(...activeConsumers.map((r) => r.power), 1);

    const subtitle =
      this._config.subtitle ||
      this._t("power_list_subtitle").replace("{active}", String(activeConsumers.length)).replace(
        "{total}",
        String(consumers.length),
      );

    // The glyph sits on this well, not on the card, so its contrast has to be
    // measured against the well.
    const iconWellCss = tintOn(this, accentColor, this._config.accent_opacity, 18);
    const cssVars = buildCssVars({
      "m3p-icon-color": foregroundOn(accentColor, iconWellCss),
      "m3p-icon-bg": iconWellCss,
      "m3p-text": textColorCss,
      "m3p-secondary-text": secondaryTextColorCss,
      "pl-accent": accentColor,
      "pl-bar-tint": barTintColor,
      "pl-producer": producerColor,
      "lr-row-height": `${POWER_LIST_ROW_HEIGHT}px`,
      "lr-row-radius": `${POWER_LIST_ROW_RADIUS}px`,
      "lr-row-radius-active": `${POWER_LIST_ROW_RADIUS_ACTIVE}px`,
      "lr-icon-size": `${POWER_LIST_ICON_SIZE}px`,
      "lr-icon-radius": `${POWER_LIST_ICON_RADIUS}px`,
      "lr-row-gap": `${POWER_LIST_ROW_GAP}px`,
      // Fills keep the accent; these twins carry it where it is text.
      ...foregroundVars(this, {
        "pl-accent": accentColor,
        "pl-producer": producerColor,
      }),
    });

    const showIdleToggle = this._config.show_idle_toggle ?? true;

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(this._config.glass_background)} ${shouldAnimate(this._config?.animation) ? "" : "no-animations"}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          ${renderCardHeader({
            icon,
            name,
            subtitle,
            right: html`
              <div class="total-value">
                <div class="total-number">${this._formatNumber(totalPower)}</div>
                <div class="total-unit">${this._t("power_list_total_suffix")}</div>
              </div>
            `,
          })}

          ${allRows.length === 0
            ? html`<div class="empty-state">${this._t("power_list_empty")}</div>`
            : html`
                <div class="row-list">
                  ${repeat(
                    producers,
                    (r) => r.key,
                    (r) => this._renderProducerRow(r),
                  )}
                  ${repeat(
                    visibleActive,
                    (r) => r.key,
                    (r) => this._renderActiveRow(r, maxRowPower),
                  )}
                </div>

                ${showIdleToggle && hiddenCount > 0
                  ? html`
                      <button
                        class="idle-toggle ${this._expanded ? "open" : ""}"
                        @click=${() => (this._expanded = !this._expanded)}
                      >
                        <span
                          >${hiddenCount}
                          ${overflowActive.length > 0
                            ? this._expanded
                              ? this._t("power_list_hide_more")
                              : this._t("power_list_show_more")
                            : this._expanded
                              ? this._t("power_list_hide_idle")
                              : this._t("power_list_show_idle")}</span
                        >
                        <ha-icon class="chevron" icon="mdi:chevron-down"></ha-icon>
                      </button>
                      ${this._expanded
                        ? html`
                            ${overflowActive.length > 0
                              ? html`
                                  <div class="row-list overflow-list">
                                    ${repeat(
                                      overflowActive,
                                      (r) => r.key,
                                      (r) => this._renderActiveRow(r, maxRowPower),
                                    )}
                                  </div>
                                `
                              : nothing}
                            ${idleConsumers.length > 0
                              ? html`
                                  <div class="row-list idle-list">
                                    ${repeat(
                                      idleConsumers,
                                      (r) => r.key,
                                      (r) => this._renderIdleRow(r),
                                    )}
                                  </div>
                                `
                              : nothing}
                          `
                        : nothing}
                    `
                  : nothing}
              `}
        </div>
      </ha-card>
    `;
  }

  // Shared by render() (for the CSS variable) and by the row builder, which
  // needs the resolved value rather than the variable.
  private _accentColor(): string {
    return this._config?.accent_color
      ? resolveThemeColor(this._config.accent_color)
      : DEFAULT_POWER_LIST_ACCENT;
  }

  private _producerColor(): string {
    return this._config?.producer_color
      ? resolveThemeColor(this._config.producer_color)
      : DEFAULT_POWER_LIST_PRODUCER_COLOR;
  }

  private _barTintColor(): string {
    return this._config?.bar_tint_color
      ? resolveThemeColor(this._config.bar_tint_color)
      : this._config?.accent_color
        ? resolveThemeColor(this._config.accent_color)
        : DEFAULT_POWER_LIST_ACCENT;
  }

  private _renderProducerRow(row: PowerRow) {
    return renderListRow({
      host: this,
      key: row.key,
      label: row.name,
      icon: row.icon,
      iconColor: this._producerColor(),
      iconBackground: tintOn(this, this._producerColor(), this._config?.producer_opacity, 24),
      middle: html`<div class="row-name">${row.name}</div>`,
      right: html`<div class="row-value producer-value">${this._formatNumber(row.power)} W</div>`,
      onClick: this._moreInfo(row.entity),
      extraClass: "producer-row",
      style: `--lr-row-bg: ${tintOn(this, this._producerColor(), this._config?.producer_opacity, 14)};`,
    });
  }

  private _renderActiveRow(row: PowerRow, maxPower: number) {
    return renderListRow({
      host: this,
      key: row.key,
      label: row.name,
      icon: row.icon,
      iconColor: this._accentColor(),
      iconBackground: tintOn(this, this._accentColor(), this._config?.accent_opacity, 20),
      middle: html`<div class="row-name">${row.name}</div>`,
      right: html`<div class="row-value consumer-value">${this._formatNumber(row.power)} W</div>`,
      onClick: this._moreInfo(row.entity),
      barFraction: row.power / maxPower,
      // The resolved value, not var(--pl-bar-tint): the tint has to parse the
      // colour to correct it against a light surface, and a bare var() cannot.
      barColor: this._barTintColor(),
    });
  }

  private _renderIdleRow(row: PowerRow) {
    return renderListRow({
      host: this,
      key: row.key,
      label: row.name,
      icon: "mdi:power-plug-off",
      iconColor: "var(--m3p-secondary-text)",
      iconBackground: tintOn(this, "var(--primary-text-color)", undefined, 10),
      middle: html`<div class="row-name idle-name">${row.name}</div>`,
      right: html`<div class="row-value idle-value">${this._formatNumber(row.power)} W</div>`,
      onClick: this._moreInfo(row.entity),
      extraClass: "idle-row",
      style: `--lr-row-height: ${POWER_LIST_IDLE_ROW_HEIGHT}px; --lr-row-radius: ${POWER_LIST_IDLE_ROW_RADIUS}px; --lr-row-bg: ${tintBackground("var(--primary-text-color)", undefined, 4)}; opacity: 0.5;`,
    });
  }

  static styles = [
    glassCardStyles,
    cardHeaderStyles,
    listRowStyles,
    css`
      .total-value {
        flex-shrink: 0;
        text-align: right;
      }

      .total-number {
        font-size: 20px;
        font-weight: 700;
        line-height: 1.1;
        color: var(--pl-accent-fg, var(--pl-accent));
      }

      .total-unit {
        font-size: 11px;
        opacity: 0.6;
        color: var(--m3p-secondary-text);
      }

      .row-name {
        position: relative;
        flex: 1;
        min-width: 0;
        font-size: 13px;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--m3p-text);
      }

      .row-value {
        position: relative;
        flex-shrink: 0;
        font-size: 14px;
        font-weight: 700;
      }

      .producer-value {
        color: var(--pl-producer-fg, var(--pl-producer));
      }

      .consumer-value {
        color: var(--pl-accent-fg, var(--pl-accent));
      }

      .idle-value {
        color: var(--m3p-secondary-text);
      }

      .idle-name {
        font-size: 12px;
      }

      .idle-toggle {
        width: 100%;
        height: ${POWER_LIST_TOGGLE_HEIGHT}px;
        border-radius: ${POWER_LIST_TOGGLE_RADIUS}px;
        border: none;
        background: color-mix(in srgb, var(--primary-text-color) 8%, var(--ha-card-background, var(--card-background-color)));
        color: var(--m3p-text);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-size: 13px;
        font-family: inherit;
        cursor: pointer;
        transition: border-radius 350ms ${EASING};
      }

      .idle-toggle.open {
        border-radius: ${POWER_LIST_TOGGLE_RADIUS_OPEN}px;
      }

      .chevron {
        --mdc-icon-size: 18px;
        transition: transform 250ms ${EASING};
      }

      .idle-toggle.open .chevron {
        transform: rotate(180deg);
      }

      .card-inner.no-animations .idle-toggle,
      .card-inner.no-animations .chevron {
        transition: none;
      }

      .empty-state {
        text-align: center;
        font-size: 13px;
        opacity: 0.6;
        padding: 16px 0;
        color: var(--m3p-secondary-text);
      }

      /* Safari gained color-mix() in 16.2, and an iPod touch 7 or an iPad Air 2
         stops at iOS 15. A plain declaration before each mix cannot serve as the
         fallback: every one of them contains var(), which defers the check until
         after substitution, where failure yields unset rather than the previous
         declaration — the tint did not fade, the fill disappeared entirely. This
         block is the one those browsers alone can see; the tint is what it gives
         up. Backticks are not allowed in here: this is a css template literal. */
      @supports not (color: color-mix(in srgb, red 50%, blue)) {
        .idle-toggle {
          background: var(--ha-card-background, var(--card-background-color));
        }
      }
      `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-power-list-card": M3PowerListCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-power-list-card",
  name: "M3 Power List Card",
  description:
    "Eine Material-3-Liste für Leistungssensoren (z.B. Steckdosen) mit Sortierung, Schwellwert-Filter und Anteilsbalken.",
  // false: HA's "Add card" dialog builds a real, hass-wired element of every
  // registered type just to draw its preview thumbnail. This card discovers
  // its entities as soon as it sees a hass, so leaving the preview on runs a
  // full-house scan for everyone who opens that dialog.
  preview: false,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
