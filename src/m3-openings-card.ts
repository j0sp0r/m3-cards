import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HaActionConfig,
  HassEntity,
  HomeAssistant,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  M3OpeningsCardConfig,
} from "./types";
import {
  DEFAULT_OPENINGS_COLD_BELOW,
  DEFAULT_OPENINGS_MAX_CHIPS,
  DEFAULT_OPENINGS_RADIUS,
  DEFAULT_OPENINGS_WARN_AFTER_MIN,
  OPENINGS_CHIP_HEIGHT,
  OPENINGS_CHIP_RADIUS,
  OPENINGS_CHIP_TINT,
  OPENINGS_COLOR_CLOSED,
  OPENINGS_COLOR_MISSING,
  OPENINGS_COLOR_OPEN,
  OPENINGS_COLOR_WARN,
  OPENINGS_GROUP_GAP,
  OPENINGS_GROUP_RADIUS_INNER,
  OPENINGS_GROUP_RADIUS_OUTER,
  OPENINGS_GROUP_RADIUS_PRESSED,
  OPENINGS_HERO_SIZE,
  OPENINGS_HISTORY_DAYS,
  OPENINGS_MOTION,
  OPENINGS_ICON_RADIUS,
  OPENINGS_ICON_SIZE,
  OPENINGS_ICON_TINT,
  OPENINGS_ROW_HEIGHT,
  OPENINGS_ROW_TINT,
  STATUS_PILL_TINT,
  APPLIANCE_PILL_HEIGHT,
  resolveCornerRadius,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import { shouldAnimate } from "./shared/animation";
import { activateOnKey } from "./shared/a11y";
import { buildCssVars, foregroundColor, foregroundOn, resolveCommonColors, resolveThemeColor, tintOn } from "./shared/color-config";
import { glassCardClass, glassCardStyles } from "./shared/glass-card";
import { cardHeaderStyles, renderCardHeader } from "./shared/card-header";
import { listRowStyles, renderListRow } from "./shared/list-row";
import { discoveryChangeMatters, hassChangeMatters } from "./shared/should-update";
import { runHaAction } from "./shared/actions";
import { openEntityDetail } from "./shared/entity-detail";
import { easeFoldHeight } from "./shared/fold-arrow";
import { playKeyed, snapshotKeyed, type MotionSnapshot } from "./shared/keyed-motion";
import { formatClock } from "./shared/formatting";
import { discoverOpeningEntities } from "./shared/ha-registry";
import { TemplatedCard } from "./shared/templated-card";
import { VisibleTicker } from "./shared/visible-ticker";
import { fetchRealChanges, formatHeldFor, type RealChange } from "./shared/state-since";
import {
  latestClosed,
  normalizeEntries,
  numericState,
  openingIcon,
  openingStatus,
  openingWarning,
  resolveEntries,
  sortOpen,
  type OpeningEntryConfig,
  type OpeningStatus,
} from "./shared/openings";

const MISSING_STATES = new Set(["unavailable", "unknown", ""]);

interface OpeningRow {
  entry: OpeningEntryConfig;
  entity?: HassEntity;
  name: string;
  status: OpeningStatus;
  /** When the current state really began, if known. */
  since?: number;
  /** The state has held longer than the history the card reads. */
  older: boolean;
}

/** What the card as a whole says: something open, all closed, or closed but not all answering. */
type Summary = "open" | "clear" | "incomplete" | "empty";

/**
 * Windows and doors. While something is open the card leads with it: a count
 * beside the header, the open sensors as one joined group with how long each
 * has been open, longest first, and a warning when one has been open too long
 * on a cold day. Everything closed shrinks it to a single line that names the
 * last one opened. A sensor that does not answer is shown as such and never
 * counted as closed.
 */
@customElement("m3-openings-card")
export class M3OpeningsCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config?: M3OpeningsCardConfig;
  @state() private _discovered?: string[];
  @state() private _now = Date.now();
  @state() private _chipsOpen = false;
  /** From the recorder, per entity, for the readings in `_historyKey`. */
  @state() private _history = new Map<string, RealChange>();
  private _historyKey = "";
  private _historyFetching = "";
  private _discoverKey = "";
  private _layoutKey?: string;
  private _easeFrom = 0;
  private _motion?: MotionSnapshot;
  private readonly _ticker = new VisibleTicker(this, (now) => {
    this._now = now;
  });

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-openings-card-editor");
    return document.createElement("m3-openings-card-editor") as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(): M3OpeningsCardConfig {
    return { type: "custom:m3-openings-card", auto_discover: true };
  }

  public setConfig(config: M3OpeningsCardConfig): void {
    if (!config) throw new Error("m3-openings-card: invalid config");
    // As on the battery card: no list means "find them", a list means "these".
    this._config = {
      glass_background: true,
      animation: "auto",
      auto_discover: !config.entities?.length,
      ...config,
    };
    this._discoverKey = "";
  }

  public getCardSize(): number {
    return 3;
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this._ticker.connect();
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._ticker.disconnect();
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  // ---- which sensors --------------------------------------------------------

  private get _entries(): OpeningEntryConfig[] {
    const cfg = this._config;
    if (!cfg) return [];
    return resolveEntries(normalizeEntries(cfg.entities), cfg.auto_discover ? (this._discovered ?? []) : undefined);
  }

  private _maybeDiscover(): void {
    const cfg = this._config;
    if (!this.hass || !cfg?.auto_discover) return;
    // The entity count is in the key so a newly added sensor is found; the
    // filters so a changed config searches again.
    const key = JSON.stringify([
      cfg.include_area ?? [],
      cfg.include_label ?? [],
      cfg.exclude_entities ?? [],
      Object.keys(this.hass.states).length,
    ]);
    if (key === this._discoverKey) return;
    this._discoverKey = key;
    discoverOpeningEntities(this.hass, {
      includeAreas: cfg.include_area,
      includeLabels: cfg.include_label,
      excludeEntities: cfg.exclude_entities,
    })
      .then((ids) => {
        if (key === this._discoverKey) this._discovered = ids;
      })
      .catch((e) => console.error("m3-openings-card: auto-discovery failed", e));
  }

  private _watched(): (string | undefined)[] {
    return [...this._entries.map((e) => e.entity), this._config?.outdoor_temperature];
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    if (changed.size > 1 || !changed.has("hass")) return true;
    return this._config?.auto_discover
      ? discoveryChangeMatters(changed, this.hass, this._watched())
      : hassChangeMatters(changed, this.hass, this._watched());
  }

  // ---- since when -----------------------------------------------------------

  /**
   * Asks the recorder when each sensor really took its state, whenever one of
   * them changes or Home Assistant restarts. A restart rewrites every state
   * with a new last_changed: without this, every window would read "open for
   * 2 min" afterwards, and the cold warning would wait another quarter hour.
   */
  private _fetchHistory(): void {
    if (!this.hass?.callWS) return;
    const readings = this._entries
      .map((e) => this.hass!.states[e.entity])
      .filter((s): s is HassEntity => !!s && !MISSING_STATES.has(s.state));
    const key = readings.map((s) => `${s.entity_id}|${s.state}|${s.last_changed}`).join(",");
    if (!key || key === this._historyKey || key === this._historyFetching) return;
    this._historyFetching = key;
    fetchRealChanges(this.hass, readings, OPENINGS_HISTORY_DAYS)
      .then((changes) => {
        if (this._historyFetching !== key) return;
        this._history = changes;
        this._historyKey = key;
      })
      .catch(() => {
        this._historyKey = key;
        this._history = new Map();
      })
      .finally(() => {
        if (this._historyFetching === key) this._historyFetching = "";
      });
  }

  private _sinceOf(entity: HassEntity | undefined): { since?: number; older: boolean } {
    if (!entity) return { older: false };
    const lastChanged = Date.parse(entity.last_changed);
    const lc = Number.isFinite(lastChanged) ? lastChanged : undefined;
    const fresh = this._historyKey.includes(`${entity.entity_id}|${entity.state}|${entity.last_changed}`);
    const h = fresh ? this._history.get(entity.entity_id) : undefined;
    if (h?.older) return { older: true };
    // The history can only move "since" back, never later than Home Assistant says.
    if (h?.at !== undefined && (lc === undefined || h.at <= lc)) return { since: h.at, older: false };
    return { since: lc, older: false };
  }

  // ---- model ----------------------------------------------------------------

  private _rows(): OpeningRow[] {
    const states = this.hass?.states ?? {};
    return this._entries.map((entry) => {
      const entity = states[entry.entity];
      const status = openingStatus(entity);
      const name = entry.name ?? (entity?.attributes?.friendly_name as string | undefined) ?? entry.entity;
      return { entry, entity, name, status, ...this._sinceOf(entity) };
    });
  }

  private _summary(rows: OpeningRow[]): Summary {
    if (rows.length === 0) return "empty";
    if (rows.some((r) => r.status === "open")) return "open";
    if (rows.some((r) => r.status === "missing")) return "incomplete";
    return "clear";
  }

  // ---- lifecycle ------------------------------------------------------------

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has("hass") || changed.has("_config")) this._maybeDiscover();
    if (changed.has("hass") || changed.has("_config") || changed.has("_discovered")) this._fetchHistory();
    // A window that opens or closes changes the layout: a row comes or goes,
    // a chip with it, the count, the height. Measured before, played after.
    const rows = this._rows();
    const key = [this._chipsOpen, ...rows.map((r) => `${r.entry.entity}:${r.status}`)].join("|");
    if (this._layoutKey !== undefined && key !== this._layoutKey && shouldAnimate(this._config?.animation)) {
      const inner = this.renderRoot?.querySelector?.(".card-inner") as HTMLElement | null;
      this._easeFrom = inner?.offsetHeight ?? 0;
      this._motion = snapshotKeyed(inner);
    }
    this._layoutKey = key;
  }

  protected updated(changed: PropertyValues): void {
    super.updated?.(changed);
    if (this._easeFrom) {
      const inner = this.renderRoot.querySelector(".card-inner") as HTMLElement | null;
      easeFoldHeight(inner, this._easeFrom, shouldAnimate(this._config?.animation));
      playKeyed(inner, this._motion, OPENINGS_MOTION);
      this._easeFrom = 0;
      this._motion = undefined;
    }
  }

  // ---- actions --------------------------------------------------------------

  private _tap(entry: OpeningEntryConfig): void {
    if (!this.hass) return;
    const action: HaActionConfig = entry.tap_action ?? this._config?.tap_action ?? { action: "more-info" };
    runHaAction(this.hass, action, {
      source: this,
      entityId: entry.entity,
      fireMoreInfo: (id) => openEntityDetail(this, id),
      navigate: (path) => {
        window.history.pushState(null, "", path);
        this.dispatchEvent(new CustomEvent("location-changed", { bubbles: true, composed: true, detail: { replace: false } }));
      },
    });
  }

  private _toggleChips(e: Event): void {
    e.stopPropagation();
    // The layout key includes the fold, so willUpdate eases it like any change
    this._chipsOpen = !this._chipsOpen;
  }

  // ---- render ---------------------------------------------------------------

  protected render() {
    const cfg = this._config;
    if (!cfg || !this.hass) return nothing;

    const rows = this._rows();
    const summary = this._summary(rows);
    const open = sortOpen(
      rows.filter((r) => r.status === "open"),
      this._language,
    );
    const closed = rows.filter((r) => r.status === "closed");
    const missing = rows.filter((r) => r.status === "missing");

    const colorOpen = resolveThemeColor(cfg.color_open ?? OPENINGS_COLOR_OPEN);
    const colorWarn = resolveThemeColor(cfg.color_warn ?? OPENINGS_COLOR_WARN);
    const colorClosed = resolveThemeColor(cfg.color_closed ?? OPENINGS_COLOR_CLOSED);
    const tone =
      summary === "open" ? colorOpen : summary === "clear" ? colorClosed : OPENINGS_COLOR_MISSING;
    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(cfg);
    const iconBg = tintOn(this, tone, undefined, OPENINGS_ICON_TINT);
    const rowBg = tintOn(this, colorOpen, undefined, OPENINGS_ROW_TINT);
    const pillWarnBg = tintOn(this, colorWarn, undefined, STATUS_PILL_TINT);
    const pillOkBg = tintOn(this, colorClosed, undefined, STATUS_PILL_TINT);
    const chipOkBg = tintOn(this, colorClosed, undefined, OPENINGS_CHIP_TINT);
    const chipMissingBg = tintOn(this, "var(--primary-text-color)", undefined, 8);

    const vars = buildCssVars({
      "m3p-icon-bg": iconBg,
      "m3p-icon-color": foregroundOn(tone, iconBg, 3, this),
      "m3p-text": textColorCss,
      "m3p-secondary-text": secondaryTextColorCss,
      "op-hero": foregroundColor(this, colorOpen, 3),
      "op-row-bg": rowBg,
      "op-duration-warn": foregroundOn(colorOpen, rowBg, 4.5, this),
      "op-pill-warn-bg": pillWarnBg,
      "op-pill-warn-ink": foregroundOn(colorWarn, pillWarnBg, 4.5, this),
      "op-pill-ok-bg": pillOkBg,
      "op-pill-ok-ink": foregroundOn(colorClosed, pillOkBg, 4.5, this),
      "op-chip-ok-bg": chipOkBg,
      "op-chip-ok-ink": foregroundOn(colorClosed, chipOkBg, 4.5, this),
      "op-chip-missing-bg": chipMissingBg,
      "lr-row-height": `${OPENINGS_ROW_HEIGHT}px`,
      "lr-row-radius": `${OPENINGS_GROUP_RADIUS_INNER}px`,
      "lr-row-radius-active": `${OPENINGS_GROUP_RADIUS_PRESSED}px`,
      "lr-icon-size": `${OPENINGS_ICON_SIZE}px`,
      "lr-icon-radius": `${OPENINGS_ICON_RADIUS}px`,
      "lr-row-gap": `${OPENINGS_GROUP_GAP}px`,
    });
    const radius = resolveCornerRadius(cfg.radius ?? DEFAULT_OPENINGS_RADIUS, cfg.corners);
    const title = cfg.title ?? this._t("openings_title");

    return html`
      <ha-card style=${`${vars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(cfg.glass_background)} summary-${summary} ${shouldAnimate(cfg.animation) ? "" : "no-animations"}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          ${renderCardHeader({
            icon: this._headerIcon(summary, open[0]),
            name: title,
            subtitle: this._subtitle(summary, rows, closed, missing),
            right: this._headerRight(summary, open.length),
          })}
          ${this._renderOpen(open, colorOpen)} ${summary === "clear" ? nothing : this._renderChips(missing, closed)}
        </div>
      </ha-card>
    `;
  }

  private _headerIcon(summary: Summary, firstOpen: OpeningRow | undefined): string {
    if (this._config?.icon) return this._config.icon;
    if (summary === "clear") return "mdi:lock";
    if (summary === "open") return openingIcon(firstOpen?.entity?.attributes?.device_class as string | undefined, true);
    return "mdi:alert-circle-outline";
  }

  private _subtitle(summary: Summary, rows: OpeningRow[], closed: OpeningRow[], missing: OpeningRow[]): string {
    if (summary === "empty") return this._t("openings_none");
    if (summary === "clear") {
      const last = latestClosed(closed);
      if (!last?.since) return this._t("openings_all_closed_sub").replace("{n}", String(closed.length));
      const time = formatClock(new Date(last.since).toISOString(), this._language, this._now) ?? "";
      return this._t("openings_last_opened").replace("{name}", last.name).replace("{time}", time);
    }
    const base = this._t("openings_closed_of")
      .replace("{closed}", String(closed.length))
      .replace("{total}", String(rows.length));
    return missing.length ? `${base} · ${this._t("openings_missing_n").replace("{n}", String(missing.length))}` : base;
  }

  private _headerRight(summary: Summary, openCount: number) {
    if (summary === "open") {
      return html`<div class="hero" data-motion-key="hero" aria-label=${`${openCount} ${this._t("openings_open_label")}`}>
        <span class="hero-n" data-motion-key="hero-n" data-motion-count>${openCount}</span><span class="hero-l">${this._t("openings_open_label")}</span>
      </div>`;
    }
    if (summary === "clear") {
      return html`<span class="pill ok" data-motion-key="pill-ok"><ha-icon icon="mdi:check"></ha-icon>${this._t("openings_all_closed")}</span>`;
    }
    return undefined;
  }

  /** How long, as the row says it; and the minutes the warning compares. */
  private _openFor(row: OpeningRow): { text: string; minutes: number } {
    if (row.older) {
      return {
        text: this._t("openings_open_older").replace("{d}", String(OPENINGS_HISTORY_DAYS)),
        minutes: Number.POSITIVE_INFINITY,
      };
    }
    if (row.since === undefined) return { text: this._t("openings_open_unknown"), minutes: 0 };
    const ms = this._now - row.since;
    if (ms < 60_000) return { text: this._t("openings_open_just_now"), minutes: 0 };
    return {
      text: this._t("openings_open_since").replace("{duration}", formatHeldFor(row.since, this._now, this._language)),
      minutes: ms / 60_000,
    };
  }

  private _outdoor(): { value?: number; label?: string; configured: boolean } {
    const id = this._config?.outdoor_temperature;
    if (!id) return { configured: false };
    const entity = this.hass?.states[id];
    const value = numericState(entity);
    if (value === undefined) return { configured: true };
    const unit = (entity?.attributes?.unit_of_measurement as string | undefined) ?? "";
    const n = new Intl.NumberFormat(this._language, { maximumFractionDigits: 0 }).format(value);
    return { value, label: unit ? `${n} ${unit}` : n, configured: true };
  }

  /** The open sensors as one joined group: round outside, tight at the joints. */
  private _renderOpen(open: OpeningRow[], colorOpen: string) {
    if (open.length === 0) return nothing;
    const cfg = this._config!;
    const outdoor = this._outdoor();
    return html`
      <div class="row-list open-group" role="list">
        ${open.map((row) => {
          const { text, minutes } = this._openFor(row);
          const warn = openingWarning({
            openMinutes: minutes,
            warnAfterMinutes: cfg.warn_after_minutes ?? DEFAULT_OPENINGS_WARN_AFTER_MIN,
            outdoor: outdoor.value,
            hasOutdoorSensor: outdoor.configured,
            coldBelow: cfg.cold_below ?? DEFAULT_OPENINGS_COLD_BELOW,
          });
          const deviceClass = row.entity?.attributes?.device_class as string | undefined;
          const pillLabel = outdoor.label ? this._t("openings_outdoor").replace("{t}", outdoor.label) : "";
          return renderListRow({
            host: this,
            key: row.entry.entity,
            icon: row.entry.icon ?? openingIcon(deviceClass, true),
            iconColor: colorOpen,
            iconBackground: tintOn(this, colorOpen, undefined, OPENINGS_ICON_TINT),
            rowBackground: "var(--op-row-bg)",
            label: [row.name, text, warn.pill ? pillLabel : ""].filter(Boolean).join(", "),
            extraClass: warn.highlight ? "warn" : "",
            onClick: () => this._tap(row.entry),
            middle: html`
              <div class="op-name">${row.name}</div>
              <div class="op-sub ${warn.highlight ? "warn" : ""}">${text}</div>
            `,
            right:
              warn.pill && outdoor.label
                ? html`<span class="pill warn"><ha-icon icon="mdi:thermometer"></ha-icon>${outdoor.label}</span>`
                : undefined,
          });
        })}
      </div>
    `;
  }

  /** Missing sensors first — they want attention — then the closed ones; "+N" beyond the limit. */
  private _renderChips(missing: OpeningRow[], closed: OpeningRow[]) {
    const all = [
      ...missing.sort((a, b) => a.name.localeCompare(b.name, this._language)),
      ...closed.sort((a, b) => a.name.localeCompare(b.name, this._language)),
    ];
    if (all.length === 0) return nothing;
    const max = Math.max(0, this._config?.max_chips ?? DEFAULT_OPENINGS_MAX_CHIPS);
    const overflow = all.length > max;
    const shown = overflow && !this._chipsOpen ? all.slice(0, max) : all;
    const hidden = all.length - shown.length;
    return html`
      <div class="chips" role="list">
        ${shown.map((row) => {
          const isMissing = row.status === "missing";
          const label = this._t(isMissing ? "openings_chip_missing" : "openings_chip_closed").replace("{name}", row.name);
          const tap = (e: Event) => {
            e.stopPropagation();
            this._tap(row.entry);
          };
          return html`<span
            class="chip ${isMissing ? "missing" : "ok"}"
            data-motion-key=${`chip:${row.entry.entity}`}
            role="button"
            tabindex="0"
            aria-label=${label}
            @click=${tap}
            @keydown=${activateOnKey(tap)}
          >
            <ha-icon icon=${isMissing ? "mdi:alert-circle-outline" : "mdi:check"}></ha-icon>${row.name}
          </span>`;
        })}
        ${overflow
          ? html`<span
              class="chip more"
              data-motion-key="chip:more"
              role="button"
              tabindex="0"
              aria-expanded=${String(this._chipsOpen)}
              aria-label=${this._chipsOpen ? this._t("openings_less") : this._t("openings_more").replace("{n}", String(hidden))}
              @click=${(e: Event) => this._toggleChips(e)}
              @keydown=${activateOnKey((e: Event) => this._toggleChips(e))}
            >
              ${this._chipsOpen ? html`<ha-icon icon="mdi:chevron-up"></ha-icon>` : `+${hidden}`}
            </span>`
          : nothing}
      </div>
    `;
  }

  static styles = [
    glassCardStyles,
    cardHeaderStyles,
    listRowStyles,
    css`
      ha-card {
        color: var(--m3p-text, var(--primary-text-color));
      }

      .card-inner {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: var(--m3-card-gap, 12px);
      }

      .m3-icon-swatch {
        transition:
          background 400ms ease,
          color 400ms ease;
      }

      /* ---- header right ---- */
      .hero {
        display: flex;
        align-items: baseline;
        gap: 5px;
        flex-shrink: 0;
        color: var(--op-hero);
      }

      .hero-n {
        font-size: ${OPENINGS_HERO_SIZE}px;
        font-weight: 700;
        line-height: 1;
        font-variant-numeric: tabular-nums;
      }

      .hero-l {
        font-size: 14px;
        font-weight: 600;
      }

      .pill {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: ${APPLIANCE_PILL_HEIGHT}px;
        padding: 0 10px 0 8px;
        border-radius: ${APPLIANCE_PILL_HEIGHT / 2}px;
        line-height: 1;
        font-size: 12px;
        font-weight: 700;
        white-space: nowrap;
        box-sizing: border-box;
      }

      .pill ha-icon {
        --mdc-icon-size: 16px;
        display: flex;
      }

      .pill.ok {
        background: var(--op-pill-ok-bg);
        color: var(--op-pill-ok-ink);
      }

      .pill.warn {
        background: var(--op-pill-warn-bg);
        color: var(--op-pill-warn-ink);
      }

      /* ---- the open group ---- */
      .open-group .lr-row:first-child {
        border-top-left-radius: ${OPENINGS_GROUP_RADIUS_OUTER}px;
        border-top-right-radius: ${OPENINGS_GROUP_RADIUS_OUTER}px;
      }

      .open-group .lr-row:last-child {
        border-bottom-left-radius: ${OPENINGS_GROUP_RADIUS_OUTER}px;
        border-bottom-right-radius: ${OPENINGS_GROUP_RADIUS_OUTER}px;
      }

      .open-group .lr-row:active {
        border-radius: ${OPENINGS_GROUP_RADIUS_PRESSED}px;
      }

      .open-group .lr-icon ha-icon {
        --mdc-icon-size: 18px;
      }

      .op-name {
        font-size: 14px;
        font-weight: 600;
        line-height: 1.25;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--m3p-text, var(--primary-text-color));
      }

      .op-sub {
        font-size: 12px;
        line-height: 1.3;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
      }

      .op-sub.warn {
        color: var(--op-duration-warn);
        font-weight: 600;
      }

      /* ---- chips ---- */
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: ${OPENINGS_CHIP_HEIGHT}px;
        padding: 0 12px 0 9px;
        border-radius: ${OPENINGS_CHIP_RADIUS}px;
        font-size: 13px;
        font-weight: 600;
        line-height: 1;
        white-space: nowrap;
        cursor: pointer;
        box-sizing: border-box;
        user-select: none;
        transition: border-radius 350ms ease;
      }

      .chip:active {
        border-radius: 9px;
      }

      .chip:focus-visible {
        outline: 2px solid var(--m3p-icon-color, var(--primary-color));
        outline-offset: 2px;
      }

      .chip ha-icon {
        --mdc-icon-size: 16px;
        display: flex;
      }

      .chip.ok {
        background: var(--op-chip-ok-bg);
        color: var(--op-chip-ok-ink);
      }

      .chip.missing,
      .chip.more {
        background: var(--op-chip-missing-bg);
        color: var(--m3p-text, var(--primary-text-color));
      }

      .chip.more {
        padding: 0 12px;
        font-variant-numeric: tabular-nums;
      }

      .no-animations .chip,
      .no-animations .m3-icon-swatch {
        transition: none;
      }

      @media (prefers-reduced-motion: reduce) {
        .chip,
        .m3-icon-swatch {
          transition: none;
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-openings-card": M3OpeningsCard;
  }
}

const windowWithCards = window as unknown as { customCards: Array<Record<string, unknown>> };
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-openings-card",
  name: "M3 Openings Card",
  description: "Windows and doors: what is open, for how long, and a warning when it is cold outside.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
