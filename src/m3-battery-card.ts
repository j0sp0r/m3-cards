import { LitElement, html, css, unsafeCSS, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import type {
  HomeAssistant,
  M3BatteryCardConfig,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  BatteryEntityConfig,
  BatteryThresholds,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_BATTERY_RADIUS,
  DEFAULT_BATTERY_ICON_OK,
  DEFAULT_BATTERY_ICON_CRITICAL,
  DEFAULT_BATTERY_THRESHOLD_CRITICAL,
  DEFAULT_BATTERY_THRESHOLD_LOW,
  DEFAULT_BATTERY_THRESHOLD_MEDIUM,
  BATTERY_COLOR_CRITICAL,
  BATTERY_COLOR_LOW,
  BATTERY_COLOR_MEDIUM,
  BATTERY_COLOR_OK,
  BATTERY_COLOR_UNAVAILABLE,
  BATTERY_ROW_HEIGHT,
  BATTERY_ROW_RADIUS,
  BATTERY_ROW_RADIUS_ACTIVE,
  BATTERY_ICON_SIZE,
  BATTERY_ICON_RADIUS,
  BATTERY_ROW_GAP,
  BATTERY_BAR_HEIGHT,
  BATTERY_BAR_RADIUS,
  BATTERY_BAR_MIN_WIDTH,
  BATTERY_CHIP_RADIUS,
  BATTERY_COMPACT_ROW_HEIGHT,
  BATTERY_COMPACT_ROW_RADIUS,
  BATTERY_TOGGLE_HEIGHT,
  BATTERY_TOGGLE_RADIUS,
  BATTERY_TOGGLE_RADIUS_OPEN,
  BATTERY_FLIP_DURATION_MS,
  DEFAULT_BATTERY_NAME_STRIP,
  resolveCornerRadius,
} from "./const";
import { resolveThemeColor, buildCssVars, resolveCommonColors, tintOn, foregroundOn } from "./shared/color-config";
import { glassCardStyles, glassCardClass } from "./shared/glass-card";
import { renderCardHeader, cardHeaderStyles } from "./shared/card-header";
import { shouldAnimate, STANDARD_EASING } from "./shared/animation";
import { fireEvent } from "./shared/editor-helpers";
import { renderListRow, captureRowRects, flipRows, listRowStyles, listRowSurface } from "./shared/list-row";
import { discoverBatteryEntities } from "./shared/ha-registry";
import { activateOnKey } from "./shared/a11y";
import { localize, type TranslationKey } from "./localize";
import { discoveryChangeMatters } from "./shared/should-update";
import { TemplatedCard } from "./shared/templated-card";

console.info(
  `%c M3-BATTERY-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #81c784; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #81c784; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

type BatteryStage = "critical" | "low" | "medium" | "ok" | "unavailable";

interface BatteryRow {
  key: string;
  entity: string;
  name: string;
  icon: string;
  value: number;
  unavailable: boolean;
  stage: BatteryStage;
}

const CRITICAL_COLOR_CSS = unsafeCSS(BATTERY_COLOR_CRITICAL);
const EASING = unsafeCSS(STANDARD_EASING);

const STAGE_ORDER: Record<BatteryStage, number> = {
  unavailable: 0,
  critical: 1,
  low: 2,
  medium: 3,
  ok: 4,
};

@customElement("m3-battery-card")
export class M3BatteryCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3BatteryCardConfig;
  @state() private _discovered: string[] = [];
  @state() private _expanded = false;

  private _lastDiscoverKey?: string;
  private _discoverInFlight = false;
  private _rowRects: Map<string, DOMRect> = new Map();

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-battery-card-editor");
    return document.createElement(
      "m3-battery-card-editor",
    ) as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(): M3BatteryCardConfig {
    return {
      type: "custom:m3-battery-card",
      auto_discover: true,
      glass_background: true,
      max_visible: 3,
    };
  }

  public setConfig(config: M3BatteryCardConfig): void {
    this._config = {
      glass_background: true,
      animation: "auto",
      auto_discover: config.entities ? false : true,
      show_healthy_toggle: true,
      max_visible: 3,
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
      flipRows(this.renderRoot, this._rowRects, BATTERY_FLIP_DURATION_MS);
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
      this._discovered = await discoverBatteryEntities(this.hass, {
        includeAreas: this._config?.include_area,
        includeLabels: this._config?.include_label,
        excludeEntities: this._config?.exclude_entities,
      });
      // eslint-disable-next-line no-console
      console.info(
        `m3-battery-card: ${this._discovered.length} Batterie-Entities gefunden`,
        this._discovered,
      );
    } catch (e) {
      console.error("m3-battery-card: auto-discovery failed", e);
    } finally {
      this._discoverInFlight = false;
    }
  }

  private _stripName(raw: string): string {
    const patterns = this._config?.name_strip ?? DEFAULT_BATTERY_NAME_STRIP;
    let name = raw;
    for (const pattern of patterns) {
      try {
        name = name.replace(new RegExp(pattern, "i"), "");
      } catch {
        // ignore invalid user-supplied regex
      }
    }
    return name.trim() || raw;
  }

  private _thresholds(): Required<BatteryThresholds> {
    const t = this._config?.thresholds ?? {};
    return {
      critical: t.critical ?? DEFAULT_BATTERY_THRESHOLD_CRITICAL,
      low: t.low ?? DEFAULT_BATTERY_THRESHOLD_LOW,
      medium: t.medium ?? DEFAULT_BATTERY_THRESHOLD_MEDIUM,
    };
  }

  private _stageFor(value: number, unavailable: boolean): BatteryStage {
    if (unavailable) return "unavailable";
    const t = this._thresholds();
    if (value < t.critical) return "critical";
    if (value < t.low) return "low";
    if (value < t.medium) return "medium";
    return "ok";
  }

  private _stageColor(stage: BatteryStage): string {
    const c = this._config;
    switch (stage) {
      case "critical":
        return c?.critical_color ? resolveThemeColor(c.critical_color) : BATTERY_COLOR_CRITICAL;
      case "low":
        return c?.low_color ? resolveThemeColor(c.low_color) : BATTERY_COLOR_LOW;
      case "medium":
        return c?.medium_color ? resolveThemeColor(c.medium_color) : BATTERY_COLOR_MEDIUM;
      case "ok":
        return c?.ok_color ? resolveThemeColor(c.ok_color) : BATTERY_COLOR_OK;
      case "unavailable":
      default:
        return c?.unavailable_color ? resolveThemeColor(c.unavailable_color) : BATTERY_COLOR_UNAVAILABLE;
    }
  }

  private _buildRows(): BatteryRow[] {
    if (!this.hass || !this._config) return [];

    // In auto_discover mode, a manually configured `entities` entry acts as a
    // per-entity name/icon override rather than replacing the discovered set.
    const overridesByEntity = new Map(
      (this._config.entities ?? []).map((e) => [e.entity, e] as const),
    );
    const sourceEntities: BatteryEntityConfig[] = this._config.auto_discover
      ? this._discovered.map((entity) => overridesByEntity.get(entity) ?? { entity })
      : (this._config.entities ?? []);

    return sourceEntities.map((entry): BatteryRow => {
      const st = this.hass!.states[entry.entity];
      const isBinary = entry.entity.startsWith("binary_sensor.");
      const unavailable = !st || st.state === "unavailable" || st.state === "unknown";
      let value = 0;
      if (!unavailable) {
        if (isBinary) {
          value = st!.state === "on" ? 0 : 100;
        } else {
          const parsed = parseFloat(st!.state);
          value = Number.isNaN(parsed) ? 0 : parsed;
        }
      }
      const rawName = entry.name || st?.attributes.friendly_name || entry.entity;
      const stage = this._stageFor(value, unavailable);
      return {
        key: entry.entity,
        entity: entry.entity,
        name: entry.name ? entry.name : this._stripName(rawName),
        icon: entry.icon || st?.attributes.icon || (stage === "critical" ? DEFAULT_BATTERY_ICON_CRITICAL : DEFAULT_BATTERY_ICON_OK),
        value,
        unavailable,
        stage,
      };
    });
  }

  private _sortRows(rows: BatteryRow[]): BatteryRow[] {
    return [...rows].sort((a, b) => {
      if (a.unavailable !== b.unavailable) return a.unavailable ? -1 : 1;
      return a.value - b.value;
    });
  }

  private _moreInfo(entityId: string): () => void {
    return () => fireEvent(this, "hass-more-info", { entityId });
  }

  private _renderRow(row: BatteryRow) {
    const color = this._stageColor(row.stage);
    const barPct = row.unavailable ? 0 : Math.max(0, Math.min(100, row.value));
    return renderListRow({
      host: this,
      key: row.key,
      label: row.name,
      icon: row.icon,
      iconColor: color,
      iconBackground: tintOn(this, color, this._config?.stage_tint_opacity, 18),
      middle: html`
        <div class="battery-name">${row.name}</div>
        <div class="battery-track">
          <div
            class="battery-fill"
            style=${`width: ${barPct}%; min-width: ${barPct > 0 ? BATTERY_BAR_MIN_WIDTH : 0}px; background: ${color};`}
          ></div>
        </div>
      `,
      right: html`
        <div class="battery-value" style=${`color: ${foregroundOn(color, listRowSurface(this), 4.5)};`}>
          ${row.unavailable ? this._t("battery_value_unavailable") : `${Math.round(row.value)} %`}
        </div>
      `,
      onClick: this._moreInfo(row.entity),
    });
  }

  private _renderCompactRow(row: BatteryRow) {
    const color = this._stageColor(row.stage);
    const barPct = row.unavailable ? 0 : Math.max(0, Math.min(100, row.value));
    return html`
      <div
        class="compact-row"
        data-row-key=${row.key}
        role="button"
        tabindex="0"
        aria-label=${row.name}
        @click=${this._moreInfo(row.entity)}
        @keydown=${activateOnKey(this._moreInfo(row.entity))}
      >
        <div class="compact-name">${row.name}</div>
        <div class="compact-track">
          <div
            class="compact-fill"
            style=${`width: ${barPct}%; min-width: ${barPct > 0 ? BATTERY_BAR_MIN_WIDTH : 0}px; background: ${color};`}
          ></div>
        </div>
        <div class="compact-value" style=${`color: ${color};`}>
          ${row.unavailable ? this._t("battery_value_unavailable") : `${Math.round(row.value)} %`}
        </div>
      </div>
    `;
  }

  // Auto-discovery runs from updated(), so a tick filtered out here would also
  // stop a newly added battery sensor from ever being found. discoveryChangeMatters
  // lets a change in the entity count through for exactly that reason.
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

    const name = this._config.name || this._t("battery_default_name");
    const rows = this._sortRows(this._buildRows());

    const attentionCount = rows.filter((r) => r.stage !== "ok").length;
    const criticalCount = rows.filter((r) => r.stage === "critical").length;
    const worstStage = rows.reduce<BatteryStage>((worst, r) => {
      return STAGE_ORDER[r.stage] < STAGE_ORDER[worst] ? r.stage : worst;
    }, "ok");

    const maxVisible = this._config.max_visible ?? 0;
    const visibleRows = maxVisible > 0 ? rows.slice(0, maxVisible) : rows;
    const hiddenRows = maxVisible > 0 ? rows.slice(maxVisible) : [];
    const hiddenCount = hiddenRows.length;

    const headerIcon = this._config.icon || (worstStage === "critical" ? DEFAULT_BATTERY_ICON_CRITICAL : DEFAULT_BATTERY_ICON_OK);
    const headerColor = this._stageColor(rows.length ? worstStage : "ok");
    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(
      this._config,
    );

    const radius = resolveCornerRadius(
      this._config.radius ?? DEFAULT_BATTERY_RADIUS,
      this._config.corners,
    );

    const subtitle =
      attentionCount > 0
        ? this._t("battery_subtitle_attention").replace("{n}", String(attentionCount))
        : this._t("battery_subtitle_ok");

    // The glyph sits on this well, not on the card, so its contrast has to be
    // measured against the well.
    const iconWellCss = tintOn(this, headerColor, this._config.stage_tint_opacity, 18);
    // Static CSS cannot run the contrast helpers, so the expand toggle's
    // tint and its label colour are computed here instead.
    const toggleBg = tintOn(this, BATTERY_COLOR_OK, undefined, 14);
    const cssVars = buildCssVars({
      "bat-toggle-bg": toggleBg,
      "bat-toggle-ink": foregroundOn(BATTERY_COLOR_OK, toggleBg, 4.5),
      "m3p-icon-color": foregroundOn(headerColor, iconWellCss),
      "m3p-icon-bg": iconWellCss,
      "m3p-text": textColorCss,
      "m3p-secondary-text": secondaryTextColorCss,
      "lr-row-height": `${BATTERY_ROW_HEIGHT}px`,
      "lr-row-radius": `${BATTERY_ROW_RADIUS}px`,
      "lr-row-radius-active": `${BATTERY_ROW_RADIUS_ACTIVE}px`,
      "lr-icon-size": `${BATTERY_ICON_SIZE}px`,
      "lr-icon-radius": `${BATTERY_ICON_RADIUS}px`,
      "lr-row-gap": `${BATTERY_ROW_GAP}px`,
    });

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(this._config.glass_background)} ${shouldAnimate(this._config.animation) ? "" : "no-animations"}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          ${renderCardHeader({
            icon: headerIcon,
            name,
            subtitle,
            right:
              criticalCount > 0
                ? html`
                    <div class="critical-chip">
                      <ha-icon icon="mdi:battery-alert-variant-outline"></ha-icon>
                      <span>${criticalCount}</span>
                    </div>
                  `
                : undefined,
          })}

          ${rows.length === 0
            ? html`<div class="empty-state">${this._t("battery_empty")}</div>`
            : html`
                <div class="row-list">
                  ${repeat(
                    visibleRows,
                    (r) => r.key,
                    (r) => this._renderRow(r),
                  )}
                </div>
                ${hiddenCount > 0 && this._config.show_healthy_toggle !== false
                  ? html`
                      <button
                        class="expand-toggle ${this._expanded ? "open" : ""}"
                        @click=${() => (this._expanded = !this._expanded)}
                      >
                        <ha-icon icon="mdi:battery-check-outline"></ha-icon>
                        <span
                          >${this._expanded
                            ? this._t("battery_collapse")
                            : this._t("battery_expand").replace("{n}", String(hiddenCount))}</span
                        >
                        <ha-icon class="chevron" icon="mdi:chevron-down"></ha-icon>
                      </button>
                      ${this._expanded
                        ? html`
                            <div class="row-list compact-list">
                              ${repeat(
                                hiddenRows,
                                (r) => r.key,
                                (r) => this._renderCompactRow(r),
                              )}
                            </div>
                          `
                        : nothing}
                    `
                  : nothing}
              `}
        </div>
      </ha-card>
    `;
  }

  static styles = [
    glassCardStyles,
    cardHeaderStyles,
    listRowStyles,
    css`
      .critical-chip {
        flex-shrink: 0;
        height: 30px;
        border-radius: ${BATTERY_CHIP_RADIUS}px;
        padding: 0 10px;
        display: flex;
        align-items: center;
        gap: 4px;
        background: color-mix(in srgb, ${CRITICAL_COLOR_CSS} 18%, var(--ha-card-background, var(--card-background-color)));
        color: ${CRITICAL_COLOR_CSS};
        font-size: 13px;
        font-weight: 700;
      }

      .critical-chip ha-icon {
        --mdc-icon-size: 16px;
      }

      .battery-name {
        font-size: 13px;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--m3p-text);
      }

      .battery-track {
        margin-top: 5px;
        height: ${BATTERY_BAR_HEIGHT}px;
        border-radius: ${BATTERY_BAR_RADIUS}px;
        background: rgba(255, 255, 255, 0.1);
        overflow: hidden;
      }

      .battery-fill {
        height: 100%;
        border-radius: inherit;
      }

      .battery-value {
        min-width: 42px;
        text-align: right;
        font-size: 14px;
        font-weight: 700;
      }

      .empty-state {
        text-align: center;
        font-size: 13px;
        opacity: 0.6;
        padding: 16px 0;
        color: var(--m3p-secondary-text);
      }

      .expand-toggle {
        width: 100%;
        height: ${BATTERY_TOGGLE_HEIGHT}px;
        border-radius: ${BATTERY_TOGGLE_RADIUS}px;
        border: none;
        background: var(--bat-toggle-bg);
        color: var(--bat-toggle-ink);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-size: 13px;
        font-family: inherit;
        cursor: pointer;
        transition: border-radius 350ms ${EASING};
      }

      .expand-toggle.open {
        border-radius: ${BATTERY_TOGGLE_RADIUS_OPEN}px;
      }

      .expand-toggle .chevron {
        --mdc-icon-size: 18px;
        transition: transform 250ms ${EASING};
      }

      .expand-toggle.open .chevron {
        transform: rotate(180deg);
      }

      .card-inner.no-animations .expand-toggle,
      .card-inner.no-animations .expand-toggle .chevron {
        transition: none;
      }

      .compact-list {
        margin-top: 2px;
      }

      .compact-row {
        position: relative;
        height: ${BATTERY_COMPACT_ROW_HEIGHT}px;
        border-radius: ${BATTERY_COMPACT_ROW_RADIUS}px;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 10px;
        box-sizing: border-box;
        cursor: pointer;
        opacity: 0.7;
        background: color-mix(in srgb, var(--primary-text-color) 4%, var(--ha-card-background, var(--card-background-color)));
      }

      .compact-row:focus-visible {
        outline: 2px solid var(--primary-color);
        outline-offset: 2px;
      }

      .compact-name {
        flex: 1;
        min-width: 0;
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--m3p-text);
      }

      .compact-track {
        flex-shrink: 0;
        width: 44px;
        height: 5px;
        border-radius: 3px;
        background: rgba(255, 255, 255, 0.1);
        overflow: hidden;
      }

      .compact-fill {
        height: 100%;
        border-radius: inherit;
      }

      .compact-value {
        flex-shrink: 0;
        min-width: 34px;
        text-align: right;
        font-size: 12px;
        font-weight: 700;
      }

      /* Safari gained color-mix() in 16.2, and an iPod touch 7 or an iPad Air 2
         stops at iOS 15. A plain declaration before each mix cannot serve as the
         fallback: every one of them contains var(), which defers the check until
         after substitution, where failure yields unset rather than the previous
         declaration — the tint did not fade, the fill disappeared entirely. This
         block is the one those browsers alone can see; the tint is what it gives
         up. Backticks are not allowed in here: this is a css template literal. */
      @supports not (color: color-mix(in srgb, red 50%, blue)) {
        .critical-chip {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .compact-row {
          background: var(--ha-card-background, var(--card-background-color));
        }
      }
      `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-battery-card": M3BatteryCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-battery-card",
  name: "M3 Battery Card",
  description:
    "Eine Material-3-Übersicht aller Batteriestände mit automatischer Erkennung, Schwellwert-Farben und Sortierung.",
  // false: HA's "Add card" dialog builds a real, hass-wired element of every
  // registered type just to draw its preview thumbnail. This card discovers
  // its entities as soon as it sees a hass, so leaving the preview on runs a
  // full-house scan for everyone who opens that dialog.
  preview: false,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
