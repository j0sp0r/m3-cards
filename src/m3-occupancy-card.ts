import { LitElement, html, css, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import type {
  HomeAssistant,
  M3OccupancyCardConfig,
  OccupancySensorConfig,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_OCCUPANCY_RADIUS,
  DEFAULT_OCCUPANCY_ICON,
  DEFAULT_OCCUPANCY_ACCENT,
  DEFAULT_OCCUPANCY_NAME_STRIP,
  OCCUPANCY_HEADER_ICON_SIZE,
  OCCUPANCY_HEADER_ICON_RADIUS,
  OCCUPANCY_ROW_RADIUS,
  OCCUPANCY_ROW_RADIUS_ACTIVE,
  OCCUPANCY_ROW_PADDING_Y,
  OCCUPANCY_ROW_PADDING_X,
  OCCUPANCY_ROW_GAP,
  OCCUPANCY_ICON_SIZE,
  OCCUPANCY_ICON_RADIUS,
  OCCUPANCY_DOT_SIZE,
  OCCUPANCY_PULSE_MS,
  OCCUPANCY_TINT_OCCUPIED,
  OCCUPANCY_TINT_FREE,
  OCCUPANCY_TINT_ON_ROW,
  OCCUPANCY_TOGGLE_HEIGHT,
  OCCUPANCY_TOGGLE_RADIUS,
  OCCUPANCY_CHIP_RADIUS,
  OCCUPANCY_TICK_MS,
  DEFAULT_OCCUPANCY_TIMELINE_HOURS,
  DEFAULT_OCCUPANCY_TIMELINE_SEGMENTS,
  OCCUPANCY_TIMELINE_HOURS_MIN,
  OCCUPANCY_TIMELINE_HOURS_MAX,
  OCCUPANCY_SEGMENT_HEIGHT,
  OCCUPANCY_SEGMENT_RADIUS,
  OCCUPANCY_SEGMENT_GAP,
  OCCUPANCY_SEGMENT_FADED_OPACITY,
  resolveCornerRadius,
} from "./const";
import { resolveThemeColor, buildCssVars, resolveCommonColors, tintOn , foregroundVars} from "./shared/color-config";
import { glassCardStyles, glassCardClass } from "./shared/glass-card";
import { activateOnKey } from "./shared/a11y";
import { STANDARD_EASING, shouldAnimate } from "./shared/animation";
import { formatSince } from "./shared/formatting";
import { guessRoomIcon } from "./shared/room-icons";
import { discoverOccupancyRooms, type DiscoveredOccupancyRoom } from "./shared/ha-registry";
import { fetchOccupancySegments } from "./shared/occupancy-history";
import { localize, type TranslationKey } from "./localize";
import { discoveryChangeMatters } from "./shared/should-update";
import { TemplatedCard } from "./shared/templated-card";

console.info(
  `%c M3-OCCUPANCY-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #5dcaa5; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #5dcaa5; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

const EASING = unsafeCSS(STANDARD_EASING);

interface OccupancyRow {
  key: string;
  /** Every sensor in the room; occupied when any is on. */
  entities: string[];
  /** The sensor a tap opens — the one that last changed. */
  primary: string;
  name: string;
  icon: string;
  occupied: boolean;
  available: boolean;
  /** ISO timestamp of the room's last state change, for the "since" line. */
  since?: string;
  config: OccupancySensorConfig;
}

@customElement("m3-occupancy-card")
export class M3OccupancyCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3OccupancyCardConfig;
  @state() private _expanded = false;
  @state() private _discovered: DiscoveredOccupancyRoom[] = [];
  /** Bumped by the ticker so the elapsed-time text stays honest. */
  @state() private _tick = 0;
  /** entity id -> which slices of the window had motion. */
  @state() private _segments = new Map<string, boolean[]>();

  private _lastDiscoverKey?: string;
  private _discoverInFlight = false;
  private _tickTimer?: number;
  private _historyKey?: string;
  private _historyInFlight = false;

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-occupancy-card-editor");
    return document.createElement("m3-occupancy-card-editor") as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(): M3OccupancyCardConfig {
    return { type: "custom:m3-occupancy-card", auto_discover: true };
  }

  public setConfig(config: M3OccupancyCardConfig): void {
    this._config = {
      glass_background: true,
      animation: "auto",
      auto_discover: true,
      sort: "occupied_first",
      show_timeline: true,
      ...config,
    };
    this._lastDiscoverKey = undefined;
  }

  public getCardSize(): number {
    return 4;
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: "full", rows: "auto", min_rows: 3 };
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this._tickTimer = window.setInterval(() => {
      this._tick++;
      // Same cadence for both: the elapsed-time text and the strip should
      // never disagree about how long ago something happened.
      this._historyKey = undefined;
      this._maybeFetchHistory();
    }, OCCUPANCY_TICK_MS);
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._tickTimer !== undefined) {
      clearInterval(this._tickTimer);
      this._tickTimer = undefined;
    }
  }

  protected willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    if (changed.has("hass") || changed.has("_config")) this._maybeDiscover();
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    this._maybeFetchHistory();
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey, vars?: Record<string, string | number>): string {
    let out = localize(key, this._language);
    for (const [k, v] of Object.entries(vars ?? {})) out = out.replaceAll(`{${k}}`, String(v));
    return out;
  }

  // ---- discovery --------------------------------------------------------

  private _maybeDiscover(): void {
    if (!this.hass || !this._config?.auto_discover) return;
    const key = JSON.stringify({
      areas: this._config.include_area ?? [],
      exclude: this._config.exclude_entities ?? [],
      strip: this._config.name_strip ?? DEFAULT_OCCUPANCY_NAME_STRIP,
    });
    if (key === this._lastDiscoverKey || this._discoverInFlight) return;
    this._lastDiscoverKey = key;
    this._discover();
  }

  private async _discover(): Promise<void> {
    if (!this.hass || this._discoverInFlight) return;
    this._discoverInFlight = true;
    try {
      this._discovered = await discoverOccupancyRooms(this.hass, {
        includeAreas: this._config?.include_area,
        excludeEntities: this._config?.exclude_entities,
        nameStrip: this._config?.name_strip ?? DEFAULT_OCCUPANCY_NAME_STRIP,
      });
    } catch (e) {
      console.warn("m3-occupancy-card: discovery failed", e);
    } finally {
      this._discoverInFlight = false;
    }
  }

  /**
   * Manual `sensors:` wins over discovery, one room per configured entry;
   * otherwise the discovered rooms, each possibly holding several sensors.
   */
  private get _rooms(): { key: string; entities: string[]; config: OccupancySensorConfig; icon?: string }[] {
    const manual = this._config?.sensors ?? [];
    if (manual.length) {
      return manual
        .filter((cfg) => cfg.entity)
        .map((cfg) => ({ key: cfg.entity, entities: [cfg.entity], config: cfg, icon: cfg.icon }));
    }
    return this._discovered.map((d) => ({
      key: d.key,
      entities: d.entities,
      icon: d.icon,
      config: {
        entity: d.entities[0],
        name: d.name,
        icon: d.icon,
        illuminance_entity: d.illuminanceEntity,
        battery_entity: d.batteryEntity,
        signal_entity: d.signalEntity,
        timeout_entity: d.timeoutEntity,
      },
    }));
  }

  private _buildRows(): OccupancyRow[] {
    const hass = this.hass;
    if (!hass) return [];
    const rows = this._rooms.map((room): OccupancyRow => {
      const states = room.entities.map((id) => hass.states[id]).filter(Boolean);
      // One live sensor is enough for the room to count as reporting; the
      // room only goes dark when every sensor in it has.
      const live = states.filter((st) => st.state !== "unavailable" && st.state !== "unknown");
      const occupiedStates = live.filter((st) => st.state === "on");
      const occupied = occupiedStates.length > 0;
      // Time the room in question: since the first sensor turned on while
      // occupied, since the last one turned off while clear.
      const relevant = occupied ? occupiedStates : live;
      const timestamps = relevant
        .map((st) => Date.parse(st.last_changed ?? ""))
        .filter((t) => !isNaN(t));
      const since = timestamps.length
        ? new Date(occupied ? Math.min(...timestamps) : Math.max(...timestamps)).toISOString()
        : undefined;
      const name =
        room.config.name ??
        (states[0]?.attributes.friendly_name as string | undefined) ??
        room.entities[0];
      return {
        key: room.key,
        entities: room.entities,
        primary: (occupiedStates[0] ?? live[0] ?? states[0])?.entity_id ?? room.entities[0],
        name,
        icon: room.icon ?? guessRoomIcon(name),
        occupied,
        available: live.length > 0,
        since,
        config: room.config,
      };
    });
    return this._sortRows(rows);
  }

  private _sortRows(rows: OccupancyRow[]): OccupancyRow[] {
    const sorted = [...rows];
    // A sensor that stopped reporting outranks everything: a dead presence
    // sensor is a problem, a quiet room is not.
    const rank = (r: OccupancyRow): number => (!r.available ? 0 : r.occupied ? 1 : 2);
    switch (this._config?.sort ?? "occupied_first") {
      case "name":
        sorted.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
        break;
      case "last_active":
        sorted.sort(
          (a, b) =>
            rank(a) - rank(b) ||
            Date.parse(b.since ?? "0") - Date.parse(a.since ?? "0"),
        );
        break;
      default:
        sorted.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    }
    return sorted;
  }

  // ---- timeline ---------------------------------------------------------

  private get _timelineHours(): number {
    const raw = this._config?.timeline_hours ?? DEFAULT_OCCUPANCY_TIMELINE_HOURS;
    return Math.min(OCCUPANCY_TIMELINE_HOURS_MAX, Math.max(OCCUPANCY_TIMELINE_HOURS_MIN, raw));
  }

  private get _timelineSegments(): number {
    return Math.max(4, this._config?.timeline_segments ?? DEFAULT_OCCUPANCY_TIMELINE_SEGMENTS);
  }

  private _maybeFetchHistory(): void {
    if (!this.hass || this._config?.show_timeline === false) return;
    const ids = this._rooms.flatMap((r) => r.entities);
    if (!ids.length) return;
    // The state of every sensor is part of the key, so a room switching on or
    // off refreshes the strip without waiting for the next minute tick.
    const stamp = ids.map((id) => this.hass!.states[id]?.state ?? "?").join("");
    const key = `${ids.join(",")}|${this._timelineHours}|${this._timelineSegments}|${stamp}`;
    if (key === this._historyKey) return;
    this._historyKey = key;
    this._fetchHistory(ids);
  }

  private async _fetchHistory(ids: string[]): Promise<void> {
    if (!this.hass || this._historyInFlight) return;
    this._historyInFlight = true;
    try {
      this._segments = await fetchOccupancySegments(
        this.hass,
        ids,
        this._timelineHours,
        this._timelineSegments,
      );
    } finally {
      this._historyInFlight = false;
    }
  }

  /** A room's slice is active when any of its sensors was on during it. */
  private _roomSegments(row: OccupancyRow): boolean[] {
    const total = this._timelineSegments;
    const merged = new Array<boolean>(total).fill(false);
    for (const id of row.entities) {
      const slots = this._segments.get(id);
      if (!slots) continue;
      for (let i = 0; i < total && i < slots.length; i++) {
        if (slots[i]) merged[i] = true;
      }
    }
    return merged;
  }

  private _hasHistory(row: OccupancyRow): boolean {
    return row.entities.some((id) => this._segments.has(id));
  }

  private _renderTimeline(row: OccupancyRow): TemplateResult {
    const slots = this._roomSegments(row);
    const known = this._hasHistory(row);
    return html`
      <div
        class="timeline ${known ? "" : "unknown"}"
        title=${known ? nothing : this._t("occupancy_no_history")}
      >
        ${slots.map((active, i) => {
          // The newest two slices stay at full strength while the room is
          // occupied, so "right now" reads differently from "a while ago".
          const fresh = row.occupied && i >= slots.length - 2;
          return html`<div
            class="segment ${active ? "on" : ""} ${active && !fresh ? "faded" : ""}"
          ></div>`;
        })}
      </div>
    `;
  }

  private _renderAxis(): TemplateResult {
    const hours = this._timelineHours;
    // Four labels across the strip: the window start, two thirds, and "now".
    const labels = [0, 1, 2, 3].map((i) => {
      const hoursAgo = Math.round((hours * (3 - i)) / 3);
      return hoursAgo === 0
        ? this._t("occupancy_axis_now")
        : this._t("occupancy_axis_ago", { n: hoursAgo });
    });
    return html`
      <div class="axis">
        ${labels.map((label) => html`<span>${label}</span>`)}
      </div>
    `;
  }

  // ---- render -----------------------------------------------------------

  private _statusText(row: OccupancyRow): string {
    if (!row.available) return this._t("occupancy_unavailable");
    const since = formatSince(row.since, {
      minutes: this._t("occupancy_minutes"),
      hours: this._t("occupancy_hours"),
      days: this._t("occupancy_days"),
    });
    if (!since) return row.occupied ? this._t("occupancy_occupied") : this._t("occupancy_never");
    return row.occupied
      ? `${this._t("occupancy_occupied")} · ${this._t("occupancy_since", { dauer: since })}`
      : this._t("occupancy_free_since", { dauer: since });
  }

  private _moreInfo(entityId: string): () => void {
    return () => {
      this.dispatchEvent(
        new CustomEvent("hass-more-info", {
          detail: { entityId },
          bubbles: true,
          composed: true,
        }),
      );
    };
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return discoveryChangeMatters(changed, this.hass, this._rooms.flatMap((r) => r.entities));
  }

  protected render() {
    const cfg = this._config;
    if (!cfg) return nothing;
    // Referenced so the minute ticker actually triggers a re-render.
    void this._tick;

    const rows = this._buildRows();
    const occupied = rows.filter((r) => r.occupied).length;
    const accent = resolveThemeColor(cfg.accent_color ?? DEFAULT_OCCUPANCY_ACCENT);
    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(cfg);

    const cssVars = buildCssVars({
      "m3o-accent": accent,
      "m3o-accent-tint": tintOn(this, accent, cfg.accent_opacity, 18),
      "m3o-text": textColorCss,
      "m3o-secondary-text": secondaryTextColorCss,
      "m3o-radius": resolveCornerRadius(cfg.radius ?? DEFAULT_OCCUPANCY_RADIUS, cfg.corners),
      // Fills keep the accent; these twins carry it where it is text.
      ...foregroundVars(this, {
        "m3o-accent": accent,
      }),
    });
    const style = cardBackgroundCss
      ? `${cssVars} --ha-card-background: ${cardBackgroundCss};`
      : cssVars;

    // max_visible was offered by the editor and never read here — reported as
    // a bug against 2.0.0. Same shape the battery, power-list, NAS and updates
    // cards already use: keep the first N rows, put the rest behind a toggle.
    const maxVisible = cfg.max_visible ?? 0;
    const sichtbar = maxVisible > 0 && !this._expanded ? rows.slice(0, maxVisible) : rows;
    const versteckt = maxVisible > 0 ? Math.max(0, rows.length - maxVisible) : 0;

    return html`
      <ha-card style=${style}>
        <div
          class="card-inner ${glassCardClass(cfg.glass_background)} ${shouldAnimate(cfg.animation) ? "" : "no-animations"}"
        >
          ${this._renderHeader(occupied, rows.length)}
          ${rows.length
            ? html`<div class="rows">
                  ${repeat(sichtbar, (r) => r.key, (r) => this._renderRow(r))}
                </div>
                ${versteckt > 0
                  ? html`
                      <button
                        class="expand-toggle ${this._expanded ? "open" : ""}"
                        @click=${() => (this._expanded = !this._expanded)}
                      >
                        <span
                          >${this._expanded
                            ? this._t("occupancy_collapse")
                            : this._t("occupancy_expand").replace("{n}", String(versteckt))}</span
                        >
                        <ha-icon class="chevron" icon="mdi:chevron-down"></ha-icon>
                      </button>
                    `
                  : nothing}
                ${cfg.show_timeline === false ? nothing : this._renderAxis()}`
            : html`<div class="empty">${this._t("occupancy_none_found")}</div>`}
        </div>
      </ha-card>
    `;
  }

  private _renderHeader(occupied: number, total: number): TemplateResult {
    const cfg = this._config!;
    return html`
      <div class="header">
        <div class="header-icon">
          <ha-icon icon=${cfg.icon ?? DEFAULT_OCCUPANCY_ICON}></ha-icon>
        </div>
        <div class="header-text">
          <div class="header-name">${cfg.name ?? this._t("occupancy_default_name")}</div>
          <div class="header-sub">
            ${this._t("occupancy_subtitle", { belegt: occupied, gesamt: total })}
          </div>
        </div>
        ${occupied > 0
          ? html`<div class="count-chip">
              <span class="pulse-dot"></span>
              <span>${occupied}</span>
            </div>`
          : nothing}
      </div>
    `;
  }

  private _renderRow(row: OccupancyRow): TemplateResult {
    return html`
      <div
        class="row ${row.occupied ? "occupied" : ""} ${row.available ? "" : "dead"}"
        role="button"
        tabindex="0"
        aria-label=${row.name}
        @click=${this._moreInfo(row.primary)}
        @keydown=${activateOnKey(this._moreInfo(row.primary))}
      >
        <div class="row-icon">
          <ha-icon icon=${row.icon}></ha-icon>
          ${row.occupied ? html`<span class="pulse-dot corner"></span>` : nothing}
        </div>
        <div class="row-body">
          <div class="row-head">
            <span class="row-name">${row.name}</span>
            <span class="row-status">${this._statusText(row)}</span>
          </div>
          ${this._config?.show_timeline === false ? nothing : this._renderTimeline(row)}
        </div>
      </div>
    `;
  }

  static styles = [
    glassCardStyles,
    css`
      ha-card {
        border-radius: var(--m3o-radius);
      }

      .card-inner {
        border-radius: var(--m3o-radius);
        gap: 10px;
      }

      .empty {
        font-size: 12px;
        opacity: 0.5;
        color: var(--m3o-secondary-text);
        padding: 8px 2px;
      }

      /* ---- header ---- */

      .header {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .header-icon {
        flex-shrink: 0;
        width: ${OCCUPANCY_HEADER_ICON_SIZE}px;
        height: ${OCCUPANCY_HEADER_ICON_SIZE}px;
        border-radius: ${OCCUPANCY_HEADER_ICON_RADIUS}px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--m3o-accent-fg, var(--m3o-accent));
        background: var(--m3o-accent-tint);
      }

      .header-icon ha-icon {
        --mdc-icon-size: 22px;
      }

      .header-text {
        flex: 1;
        min-width: 0;
      }

      .header-name {
        font-size: 15px;
        font-weight: 700;
        line-height: 1.2;
        color: var(--m3o-text);
      }

      .header-sub {
        font-size: 12px;
        opacity: 0.6;
        color: var(--m3o-secondary-text);
      }

      .count-chip {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: 7px;
        height: 30px;
        padding: 0 12px;
        border-radius: ${OCCUPANCY_CHIP_RADIUS}px;
        font-size: 13px;
        font-weight: 700;
        color: var(--m3o-accent-fg, var(--m3o-accent));
        background: var(--m3o-accent-tint);
      }

      /* ---- rows ---- */

      .rows {
        display: flex;
        flex-direction: column;
        gap: ${OCCUPANCY_ROW_GAP}px;
      }

      .expand-toggle {
        width: 100%;
        height: ${OCCUPANCY_TOGGLE_HEIGHT}px;
        border-radius: ${OCCUPANCY_TOGGLE_RADIUS}px;
        border: none;
        background: color-mix(
          in srgb,
          var(--primary-text-color) 7%,
          var(--ha-card-background, var(--card-background-color))
        );
        color: var(--m3p-secondary-text);
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
        border-radius: ${OCCUPANCY_TOGGLE_RADIUS - 7}px;
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

      .row {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: ${OCCUPANCY_ROW_PADDING_Y}px ${OCCUPANCY_ROW_PADDING_X}px;
        border-radius: ${OCCUPANCY_ROW_RADIUS}px;
        cursor: pointer;
        box-sizing: border-box;
        /* Published as a variable so the segments can build on the row they
           actually sit on instead of on the card behind it. */
        --m3o-row: color-mix(in srgb, var(--primary-text-color) ${OCCUPANCY_TINT_FREE}%, var(--ha-card-background, var(--card-background-color)));
        background: var(--m3o-row);
        transition: border-radius 350ms ${EASING};
      }

      .row.occupied {
        --m3o-row: color-mix(in srgb, var(--m3o-accent) ${OCCUPANCY_TINT_OCCUPIED}%, var(--ha-card-background, var(--card-background-color)));
        background: var(--m3o-row);
      }

      .row.dead {
        opacity: 0.5;
      }

      .row:active {
        border-radius: ${OCCUPANCY_ROW_RADIUS_ACTIVE}px;
      }

      .card-inner.no-animations .row {
        transition: none;
      }

      .row:focus-visible {
        outline: 2px solid var(--m3o-accent);
        outline-offset: 2px;
      }

      .row-icon {
        position: relative;
        flex-shrink: 0;
        width: ${OCCUPANCY_ICON_SIZE}px;
        height: ${OCCUPANCY_ICON_SIZE}px;
        border-radius: ${OCCUPANCY_ICON_RADIUS}px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--m3o-secondary-text);
        /* On the row, like the segments — 7% over the card left it two points
           from a row tinted 5% over the same card, which is no edge at all. */
        background: color-mix(in srgb, var(--primary-text-color) ${OCCUPANCY_TINT_ON_ROW}%, var(--m3o-row, var(--ha-card-background, var(--card-background-color))));
      }

      .row.occupied .row-icon {
        color: var(--m3o-accent-fg, var(--m3o-accent));
        background: color-mix(in srgb, var(--m3o-accent) 20%, var(--ha-card-background, var(--card-background-color)));
      }

      .row-icon ha-icon {
        --mdc-icon-size: 19px;
      }

      .pulse-dot {
        width: ${OCCUPANCY_DOT_SIZE}px;
        height: ${OCCUPANCY_DOT_SIZE}px;
        border-radius: 50%;
        background: var(--m3o-accent);
        animation: occupancy-pulse ${OCCUPANCY_PULSE_MS}ms ease-in-out infinite;
      }

      .pulse-dot.corner {
        position: absolute;
        top: -2px;
        right: -2px;
      }

      @keyframes occupancy-pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.35;
        }
      }

      /* Both switches must silence it: the config option and the OS setting. */
      .card-inner.no-animations .pulse-dot {
        animation: none;
      }

      @media (prefers-reduced-motion: reduce) {
        .pulse-dot {
          animation: none;
        }
      }

      .row-body {
        flex: 1;
        min-width: 0;
      }

      .row-head {
        display: flex;
        align-items: baseline;
        gap: 8px;
        min-width: 0;
      }

      .row-name {
        font-size: 13px;
        font-weight: 600;
        color: var(--m3o-text);
        white-space: nowrap;
      }

      .timeline {
        display: flex;
        align-items: stretch;
        gap: ${OCCUPANCY_SEGMENT_GAP}px;
        margin-top: 6px;
      }

      .timeline.unknown {
        opacity: 0.4;
      }

      .segment {
        flex: 1;
        min-width: 0;
        height: ${OCCUPANCY_SEGMENT_HEIGHT}px;
        border-radius: ${OCCUPANCY_SEGMENT_RADIUS}px;
        background: color-mix(in srgb, var(--primary-text-color) ${OCCUPANCY_TINT_ON_ROW}%, var(--m3o-row, var(--ha-card-background, var(--card-background-color))));
      }

      .segment.on {
        background: var(--m3o-accent);
      }

      .segment.on.faded {
        opacity: ${OCCUPANCY_SEGMENT_FADED_OPACITY};
      }

      .axis {
        display: flex;
        justify-content: space-between;
        font-size: 9px;
        opacity: 0.35;
        color: var(--m3o-secondary-text);
        padding: 0 ${OCCUPANCY_ROW_PADDING_X}px;
      }

      .row-status {
        font-size: 10px;
        color: var(--m3o-secondary-text);
        opacity: 0.7;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .row.occupied .row-status {
        color: var(--m3o-accent-fg, var(--m3o-accent));
        opacity: 1;
      }

      /* Safari gained color-mix() in 16.2, and an iPod touch 7 or an iPad Air 2
         stops at iOS 15. A plain declaration before each mix cannot serve as the
         fallback: every one of them contains var(), which defers the check until
         after substitution, where failure yields unset rather than the previous
         declaration — the tint did not fade, the fill disappeared entirely. This
         block is the one those browsers alone can see; the tint is what it gives
         up. Backticks are not allowed in here: this is a css template literal. */
      @supports not (color: color-mix(in srgb, red 50%, blue)) {
        .expand-toggle {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .row {
          --m3o-row: var(--ha-card-background, var(--card-background-color));
        }
        .row.occupied {
          --m3o-row: var(--ha-card-background, var(--card-background-color));
        }
        .row-icon {
          background: var(--m3o-row, var(--ha-card-background, var(--card-background-color)));
        }
        .row.occupied .row-icon {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .segment {
          background: var(--m3o-row, var(--ha-card-background, var(--card-background-color)));
        }
      }
      `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-occupancy-card": M3OccupancyCard;
  }
}

const windowWithCards = window as unknown as Window & {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-occupancy-card",
  name: "M3 Occupancy Card",
  description:
    "Raumbelegung aus Präsenz- und Bewegungssensoren: Zustand, Dauer und Aktivitätsverlauf je Raum.",
  // false: HA's "Add card" dialog builds a real, hass-wired element of every
  // registered type just to draw its preview thumbnail. This card discovers
  // its entities as soon as it sees a hass, so leaving the preview on runs a
  // full-house scan for everyone who opens that dialog.
  preview: false,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
