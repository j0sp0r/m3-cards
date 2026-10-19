import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import type {
  HaActionConfig,
  HomeAssistant,
  M3PresenceCardConfig,
  PresencePersonPopupConfig,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  HassEntity,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_PRESENCE_RADIUS,
  DEFAULT_PRESENCE_ICON,
  PRESENCE_AVATAR_SIZE,
  PRESENCE_AVATAR_RADIUS,
  PRESENCE_DOT_SIZE,
  PRESENCE_RING_WIDTH,
  PRESENCE_GRID_GAP,
  PRESENCE_GRID_MIN_COL,
  PRESENCE_COLOR_HOME,
  PRESENCE_COLOR_NOT_HOME,
  PRESENCE_COLOR_ZONE,
  PRESENCE_COLOR_UNKNOWN,
  resolveCornerRadius,
} from "./const";
import { resolveThemeColor, buildCssVars, resolveCommonColors, tintOn, foregroundOn, tintInk } from "./shared/color-config";
import { glassCardStyles, glassCardClass } from "./shared/glass-card";
import { renderCardHeader, cardHeaderStyles } from "./shared/card-header";
import { shouldAnimate } from "./shared/animation";
import { activateOnKey } from "./shared/a11y";
import { discoverPersonEntities } from "./shared/ha-registry";
import { runHaAction, isActionable } from "./shared/actions";
import { DetailCardController } from "./shared/detail-card";
import {
  renderPopupDialog,
  syncDialogOpenState,
  shouldCloseOnBackdropClick,
  popupCardStyles,
  type PopupCardHandle,
} from "./shared/popup-card";
import { localize, type TranslationKey } from "./localize";
import { formatNumber } from "./shared/formatting";
import { discoveryChangeMatters } from "./shared/should-update";
import { TemplatedCard } from "./shared/templated-card";
import { cssUrl } from "./shared/css-safe";

console.info(
  `%c M3-PRESENCE-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #85b7eb; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #85b7eb; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

const HOLD_MS = 500;

interface PersonRow {
  entityId: string;
  name: string;
  entity: HassEntity;
  status: "home" | "not_home" | "zone" | "unknown";
  zoneName?: string;
  color: string;
  icon: string;
}

@customElement("m3-presence-card")
export class M3PresenceCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3PresenceCardConfig;
  @state() private _discovered: string[] = [];
  /** The person whose popup is open, or undefined for none. */
  @state() private _popupFor?: string;
  @state() private _popupCardEl?: HTMLElement & PopupCardHandle;

  @query(".map-wrap") private _mapWrapEl?: HTMLDivElement;

  private _discoverInFlight = false;
  private _lastDiscoverKey?: string;
  private _holdTimer?: number;
  private _holdFired = false;
  private _popupOpenedAt = 0;
  private readonly _popupCard = new DetailCardController();
  private _mapCardEl?: HTMLElement & { hass?: HomeAssistant; setConfig?: (c: unknown) => void };
  private _mapEntityKey?: string;

  public static getStubConfig(): M3PresenceCardConfig {
    return {
      type: "custom:m3-presence-card",
      auto_discover: true,
      glass_background: true,
    };
  }

  public setConfig(config: M3PresenceCardConfig): void {
    this._config = {
      glass_background: true,
      animation: "auto",
      auto_discover: config.entities ? false : true,
      sort: "home_first",
      show_distance: true,
      show_since: true,
      show_map: false,
      ...config,
    };
  }

  public getCardSize(): number {
    return 3;
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: "full", rows: "auto", min_rows: 3 };
  }

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-presence-card-editor");
    return document.createElement("m3-presence-card-editor") as unknown as LovelaceCardEditor;
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    this._maybeDiscover();
    this._syncMapCard();
    this._maybeSyncPopupCard();
    if (this._popupCardEl && this.hass) this._popupCardEl.hass = this.hass;
    if (changed.has("_popupFor")) {
      const dialog = this.renderRoot?.querySelector("dialog") as HTMLDialogElement | null;
      syncDialogOpenState(dialog, !!this._popupFor);
    }
  }

  private _syncMapCard(): void {
    if (!this._config?.show_map || !this.hass || !this._mapWrapEl) {
      this._mapCardEl = undefined;
      this._mapEntityKey = undefined;
      return;
    }
    if (this._mapCardEl && this._mapCardEl.parentElement !== this._mapWrapEl) {
      this._mapCardEl = undefined;
      this._mapEntityKey = undefined;
    }
    const rows = this._buildRows();
    if (rows.length === 0) return;
    const entityIds = rows.map((r) => r.entityId);
    const key = entityIds.join(",");
    if (!this._mapCardEl) {
      const ctor = customElements.get("hui-map-card");
      if (!ctor) return;
      try {
        this._mapCardEl = document.createElement("hui-map-card") as HTMLElement & {
          hass?: HomeAssistant;
          setConfig?: (c: unknown) => void;
        };
        this._mapWrapEl.appendChild(this._mapCardEl);
      } catch (e) {
        console.warn("m3-presence-card: failed to create hui-map-card", e);
        return;
      }
    }
    if (key !== this._mapEntityKey) {
      this._mapEntityKey = key;
      try {
        this._mapCardEl.setConfig?.({
          type: "map",
          entities: entityIds.map((id) => ({ entity: id })),
        });
      } catch (e) {
        console.warn("m3-presence-card: hui-map-card setConfig failed", e);
      }
    }
    this._mapCardEl.hass = this.hass;
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._holdTimer !== undefined) window.clearTimeout(this._holdTimer);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _maybeDiscover(): void {
    if (!this.hass || !this._config || !(this._config.auto_discover ?? true) || this._discoverInFlight) return;
    const key = JSON.stringify({
      area: this._config.include_area,
      label: this._config.include_label,
      exclude: this._config.exclude_entities,
    });
    if (key === this._lastDiscoverKey) return;
    this._lastDiscoverKey = key;
    this._discoverInFlight = true;
    discoverPersonEntities(this.hass, {
      includeAreas: this._config.include_area,
      includeLabels: this._config.include_label,
      excludeEntities: this._config.exclude_entities,
    })
      .then((ids) => {
        this._discovered = ids;
      })
      .finally(() => {
        this._discoverInFlight = false;
      });
  }

  private _buildRows(): PersonRow[] {
    if (!this.hass || !this._config) return [];
    const autoDiscover = this._config.auto_discover ?? true;
    const ids = autoDiscover ? this._discovered : (this._config.entities ?? []);
    const rows: PersonRow[] = [];
    for (const entityId of ids) {
      const entity: HassEntity | undefined = this.hass.states[entityId];
      if (!entity) continue;
      const name = entity.attributes.friendly_name || entityId;
      const state = entity.state;
      let status: PersonRow["status"];
      let zoneName: string | undefined;
      let color: string;
      let icon: string;
      if (state === "home") {
        status = "home";
        color = this._config.home_color ? resolveThemeColor(this._config.home_color) : PRESENCE_COLOR_HOME;
        icon = "mdi:home";
      } else if (state === "not_home") {
        status = "not_home";
        color = this._config.not_home_color
          ? resolveThemeColor(this._config.not_home_color)
          : PRESENCE_COLOR_NOT_HOME;
        icon = "mdi:map-marker-outline";
      } else if (state === "unknown" || state === "unavailable") {
        status = "unknown";
        color = this._config.unknown_color ? resolveThemeColor(this._config.unknown_color) : PRESENCE_COLOR_UNKNOWN;
        icon = "mdi:help-circle-outline";
      } else {
        status = "zone";
        zoneName = state;
        const override = this._config.zone_colors?.[state];
        color = override
          ? resolveThemeColor(override)
          : this._config.zone_color
            ? resolveThemeColor(this._config.zone_color)
            : PRESENCE_COLOR_ZONE;
        icon = "mdi:map-marker";
      }
      rows.push({ entityId, name, entity, status, zoneName, color, icon });
    }

    const sort = this._config.sort ?? "home_first";
    return rows.sort((a, b) => {
      if (sort === "home_first") {
        const rank = (r: PersonRow) => (r.status === "home" ? 0 : r.status === "zone" ? 1 : r.status === "not_home" ? 2 : 3);
        const diff = rank(a) - rank(b);
        if (diff !== 0) return diff;
      }
      return a.name.localeCompare(b.name, this._language);
    });
  }

  private _initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  private _relativeSince(row: PersonRow): string | undefined {
    if (!this._config?.show_since || row.status === "home") return undefined;
    const changed = new Date(row.entity.last_changed).getTime();
    if (Number.isNaN(changed)) return undefined;
    const elapsedMin = Math.max(0, Math.round((Date.now() - changed) / 60000));
    if (elapsedMin < 1) return undefined;
    if (elapsedMin < 60) return this._t("since_minutes").replace("{n}", String(elapsedMin));
    const hours = Math.round(elapsedMin / 60);
    if (hours < 24) return this._t("since_hours").replace("{n}", String(hours));
    const days = Math.round(hours / 24);
    return this._t("since_days").replace("{n}", String(days));
  }

  private _popupConfigFor(entityId: string): PresencePersonPopupConfig | undefined {
    return this._config?.person_popups?.[entityId];
  }

  /**
   * What a tap runs when the config says nothing.
   *
   * A person with a `person_popups` entry opens it, which is the whole point of
   * having written one — requiring `tap_action: {action: popup}` alongside it
   * would be a second thing to remember that could only ever be set one way.
   * Everyone else keeps the more-info a tap has always opened, so adding a
   * popup for one person does not change what tapping the others does.
   */
  private _defaultTapAction(entityId: string): HaActionConfig {
    return this._popupConfigFor(entityId) ? { action: "popup" } : { action: "more-info" };
  }

  /**
   * Runs one of the card's actions against the person that was pressed.
   *
   * `tap_action` and `hold_action` are card-level — one setting for every row,
   * matching how `hold_action` has always been configured — and the row supplies
   * the target, so `more-info`, `toggle` and a service call with no target of
   * its own all land on the person actually pressed rather than on some entity
   * named once in the config.
   *
   * `runHaAction` rather than `handleAction` because only the former knows the
   * `popup` kind; the branches the two share behave identically.
   */
  private _runAction(action: HaActionConfig | undefined, entityId: string): void {
    if (!this.hass) return;
    runHaAction(this.hass, action, {
      entityId,
      openPopup: () => this._openPopup(entityId),
      fireMoreInfo: (id) =>
        this.dispatchEvent(
          new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId: id } }),
        ),
      navigate: (path) => {
        window.history.pushState(null, "", path);
        this.dispatchEvent(
          new CustomEvent("location-changed", { bubbles: true, composed: true, detail: { replace: false } }),
        );
      },
    });
  }

  private _openPopup(entityId: string): void {
    // Nothing configured for this person: a `popup` action someone set on the
    // whole card should still do something sensible for the people it has no
    // popup for, rather than opening an empty dialog.
    if (!this._popupConfigFor(entityId)) {
      this.dispatchEvent(
        new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId } }),
      );
      return;
    }
    this._popupOpenedAt = Date.now();
    this._popupFor = entityId;
  }

  private _closePopup(): void {
    this._popupFor = undefined;
    this._popupCardEl = undefined;
    this._popupCard.reset();
  }

  // Drives the async card build — createCardElement() is a promise, and
  // render() has to stay synchronous.
  private _maybeSyncPopupCard(): void {
    const entityId = this._popupFor;
    const popup = entityId ? this._popupConfigFor(entityId) : undefined;
    if (!entityId || !popup || !this.hass) {
      this._popupCard.reset();
      return;
    }
    const row = this._buildRows().find((r) => r.entityId === entityId);
    this._popupCard.sync({
      skeleton: popup.content,
      tokens: { entity_id: entityId, name: row?.name },
      hass: this.hass,
      onChange: (el) => {
        this._popupCardEl = el;
      },
    });
  }

  private _renderPopup() {
    const entityId = this._popupFor;
    const popup = entityId ? this._popupConfigFor(entityId) : undefined;
    if (!entityId || !popup) return nothing;
    const row = this._buildRows().find((r) => r.entityId === entityId);
    return renderPopupDialog({
      content: this._popupCardEl,
      title: popup.title ?? row?.name,
      size: popup.size,
      onClose: () => this._closePopup(),
      onBackdropClick: (e) => {
        if (shouldCloseOnBackdropClick(e, this._popupOpenedAt)) this._closePopup();
      },
      closeLabel: this._t("dialog_close"),
    });
  }

  private _handlePointerDown(row: PersonRow): (e: PointerEvent) => void {
    return () => {
      this._holdFired = false;
      const hold = this._config?.hold_action;
      // No hold timer at all without an action to run, so a press-and-wait
      // still ends in the tap it would have before.
      if (!hold || !isActionable(hold)) return;
      this._holdTimer = window.setTimeout(() => {
        this._holdFired = true;
        this._triggerHoldAction(row.entityId);
      }, HOLD_MS);
    };
  }

  private _handlePointerUp(row: PersonRow): (e: PointerEvent) => void {
    return () => {
      if (this._holdTimer !== undefined) {
        window.clearTimeout(this._holdTimer);
        this._holdTimer = undefined;
      }
      if (!this._holdFired) this._runAction(this._config?.tap_action ?? this._defaultTapAction(row.entityId), row.entityId);
    };
  }

  /**
   * The hold now goes through the shared handler as well.
   *
   * It used to implement `navigate` and `url` itself and quietly ignore
   * everything else, so a `hold_action` of `more-info`, `toggle` or
   * `perform-action` did nothing at all — which the editor never revealed,
   * because it offered no `hold_action` field to begin with. The two kinds that
   * did work behave identically here.
   */
  private _triggerHoldAction(entityId: string): void {
    const action = this._config?.hold_action;
    if (!action) return;
    this._runAction(action, entityId);
  }

  private _watchedEntities(): string[] {
    if (!this._config) return [];
    return (this._config.auto_discover ?? true)
      ? this._discovered
      : (this._config.entities ?? []);
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return discoveryChangeMatters(changed, this.hass, this._watchedEntities());
  }

  protected render() {
    if (!this._config || !this.hass) return nothing;

    const rows = this._buildRows();
    const homeCount = rows.filter((r) => r.status === "home").length;
    const total = rows.length;
    const name = this._config.name || this._t("presence_default_name");
    const icon = this._config.icon || DEFAULT_PRESENCE_ICON;
    const subtitle = this._t("presence_subtitle")
      .replace("{home}", String(homeCount))
      .replace("{total}", String(total));

    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(this._config);
    const radius = resolveCornerRadius(this._config.radius ?? DEFAULT_PRESENCE_RADIUS, this._config.corners);
    const animClass = shouldAnimate(this._config.animation) ? "" : "no-animations";

    // Static CSS cannot run the contrast helpers, so the chip's tint and its
    // label colour are computed here.
    const chipBgCss = tintOn(this, PRESENCE_COLOR_HOME, undefined, 20);
    const iconWellCss = tintOn(this, "var(--primary-color)", undefined, 14);
    const cssVars = buildCssVars({
      "presence-chip-bg": chipBgCss,
      "presence-chip-ink": foregroundOn(PRESENCE_COLOR_HOME, chipBgCss, 4.5),
      "m3p-icon-color": foregroundOn("var(--primary-color)", iconWellCss, 3, this),
      "m3p-icon-bg": iconWellCss,
      "m3p-text": textColorCss,
      "m3p-secondary-text": secondaryTextColorCss,
    });

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(this._config.glass_background)} ${animClass}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          ${renderCardHeader({
            icon,
            name,
            subtitle,
            right:
              total > 0
                ? html`
                    <div class="presence-chip ${homeCount === 0 ? "empty" : "some"}">
                      ${homeCount === 0 ? this._t("presence_nobody_home") : homeCount}
                    </div>
                  `
                : undefined,
          })}

          ${rows.length === 0
            ? html`<div class="empty-state">${this._t("presence_empty")}</div>`
            : html`<div class="person-grid">${rows.map((r) => this._renderPerson(r))}</div>`}

          ${this._config.show_map && rows.length > 0 ? html`<div class="map-wrap"></div>` : nothing}
        </div>
      </ha-card>
      ${this._renderPopup()}
    `;
  }

  private _renderPerson(row: PersonRow) {
    const picture = row.entity.attributes.entity_picture as string | undefined;
    const since = this._relativeSince(row);
    const distance =
      this._config?.show_distance && row.status === "not_home" && typeof row.entity.attributes.distance === "number"
        ? `${this._formatNumber(row.entity.attributes.distance)} km`
        : undefined;
    const statusText = row.status === "home" ? this._t("presence_home") : row.status === "zone" ? row.zoneName! : row.status === "not_home" ? this._t("presence_not_home") : this._t("unavailable");

    return html`
      <div
        class="person"
        role="button"
        tabindex="0"
        aria-label=${row.name}
        style=${`--presence-color: ${row.color}; --presence-tint: ${tintOn(this, row.color, this._config?.presence_tint_opacity, 18)}; --presence-ink: ${tintInk(this, row.color, this._config?.presence_tint_opacity, 18)};`}
        @pointerdown=${this._handlePointerDown(row)}
        @pointerup=${this._handlePointerUp(row)}
        @pointercancel=${() => {
          if (this._holdTimer !== undefined) {
            window.clearTimeout(this._holdTimer);
            this._holdTimer = undefined;
          }
        }}
        @keydown=${activateOnKey(() => this._runAction(this._config?.tap_action ?? this._defaultTapAction(row.entityId), row.entityId))}
      >
        <div class="avatar-wrap">
          <div class="avatar" style=${cssUrl(picture) ? `background-image: ${cssUrl(picture)};` : ""}>
            ${!picture ? html`<span class="initials">${this._initials(row.name)}</span>` : nothing}
          </div>
          <div class="status-dot">
            <ha-icon icon=${row.icon}></ha-icon>
          </div>
        </div>
        <div class="person-name">${row.name}</div>
        <div class="person-status">
          ${statusText}${distance ? html` · ${distance}` : nothing}
        </div>
        ${since ? html`<div class="person-since">${since}</div>` : nothing}
      </div>
    `;
  }

  private _formatNumber(value: number): string {
    return formatNumber(this._language, value, { maximumFractionDigits: 1 });
  }

  static styles = [
    glassCardStyles,
    cardHeaderStyles,
    popupCardStyles,
    css`
      .presence-chip {
        flex-shrink: 0;
        height: 24px;
        padding: 0 10px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        font-size: 12px;
        font-weight: 700;
      }

      .presence-chip.some {
        background: var(--presence-chip-bg);
        color: var(--presence-chip-ink);
      }

      .presence-chip.empty {
        background: color-mix(in srgb, var(--primary-text-color) 8%, var(--ha-card-background, var(--card-background-color)));
        color: var(--m3p-secondary-text);
      }

      .empty-state {
        padding: 12px 0;
        font-size: 13px;
        opacity: 0.6;
        color: var(--m3p-text);
      }

      .person-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(${PRESENCE_GRID_MIN_COL}px, 1fr));
        gap: ${PRESENCE_GRID_GAP}px;
      }

      .person {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        padding: 4px;
        border-radius: 12px;
        text-align: center;
      }

      .person:focus-visible {
        outline: 2px solid var(--presence-color);
        outline-offset: 2px;
      }

      .avatar-wrap {
        position: relative;
        width: ${PRESENCE_AVATAR_SIZE}px;
        height: ${PRESENCE_AVATAR_SIZE}px;
      }

      .avatar {
        width: 100%;
        height: 100%;
        border-radius: ${PRESENCE_AVATAR_RADIUS}px;
        border: ${PRESENCE_RING_WIDTH}px solid var(--presence-color);
        background-color: var(--presence-tint);
        background-size: cover;
        background-position: center;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .initials {
        font-size: 20px;
        font-weight: 700;
        /* Initials sit on --presence-tint, not on the card. */
        color: var(--presence-ink, var(--presence-color));
      }

      .status-dot {
        position: absolute;
        right: -2px;
        bottom: -2px;
        width: ${PRESENCE_DOT_SIZE}px;
        height: ${PRESENCE_DOT_SIZE}px;
        border-radius: 5px;
        background: var(--presence-color);
        border: 2px solid var(--card-background-color, #1c1c1e);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .status-dot ha-icon {
        --mdc-icon-size: 9px;
        color: white;
      }

      .person-name {
        font-size: 12px;
        font-weight: 600;
        color: var(--m3p-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 100%;
      }

      .person-status {
        font-size: 10px;
        opacity: 0.55;
        color: var(--m3p-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 100%;
      }

      .person-since {
        font-size: 9px;
        opacity: 0.45;
        color: var(--m3p-text);
      }

      .map-wrap {
        height: 200px;
        border-radius: 16px;
        overflow: hidden;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-presence-card": M3PresenceCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-presence-card",
  name: "M3 Presence Card",
  description: "Anwesenheitsübersicht für person- und device_tracker-Entities mit Avataren und Statusringen.",
  // false: HA's "Add card" dialog builds a real, hass-wired element of every
  // registered type just to draw its preview thumbnail. This card discovers
  // its entities as soon as it sees a hass, so leaving the preview on runs a
  // full-house scan for everyone who opens that dialog.
  preview: false,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
