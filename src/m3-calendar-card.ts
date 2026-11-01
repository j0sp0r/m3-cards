import { LitElement, html, css, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  M3CalendarCardConfig,
  CalendarSourceConfig,
  CalendarView,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_CALENDAR_RADIUS,
  DEFAULT_CALENDAR_ICON,
  CALENDAR_DAYS_AHEAD,
  CALENDAR_DAYS_AHEAD_MIN,
  CALENDAR_DAYS_AHEAD_MAX,
  CALENDAR_REFRESH_MS,
  CALENDAR_PALETTE,
  CALENDAR_SWITCH_RADIUS,
  CALENDAR_SWITCH_PAD,
  CALENDAR_SWITCH_TINT,
  CALENDAR_SWITCH_BTN,
  CALENDAR_SWITCH_BTN_RADIUS,
  CALENDAR_SWITCH_BTN_RADIUS_ACTIVE,
  CALENDAR_DAY_LABEL_SIZE,
  CALENDAR_DAY_DATE_SIZE,
  CALENDAR_ROW_RADIUS,
  CALENDAR_ROW_RADIUS_ACTIVE,
  CALENDAR_ROW_TINT,
  CALENDAR_TIME_COL,
  CALENDAR_TIME_COL_12H,
  CALENDAR_TIME_SIZE,
  CALENDAR_TIME_END_SIZE,
  CALENDAR_BAR_WIDTH,
  CALENDAR_BAR_RADIUS,
  CALENDAR_TITLE_SIZE,
  CALENDAR_LOCATION_SIZE,
  CALENDAR_PAST_OPACITY,
  CALENDAR_RUNNING_TINT,
  CALENDAR_NOW_BADGE_HEIGHT,
  CALENDAR_NOW_BADGE_RADIUS,
  CALENDAR_NAV_BTN,
  CALENDAR_NAV_RADIUS,
  CALENDAR_NAV_TINT,
  CALENDAR_MONTH_TITLE_SIZE,
  CALENDAR_WEEKDAY_SIZE,
  CALENDAR_GRID_GAP,
  CALENDAR_CELL_NUM_SIZE,
  CALENDAR_DOT_SIZE,
  CALENDAR_DOTS_MAX,
  CALENDAR_TODAY_TINT,
  CALENDAR_TODAY_RADIUS,
  CALENDAR_SELECTED_RADIUS,
  CALENDAR_ADJACENT_OPACITY,
  CALENDAR_DAY_ROW_HEIGHT,
  CALENDAR_DAY_ROW_RADIUS,
  resolveCornerRadius,
} from "./const";
import {
  resolveThemeColor,
  buildCssVars,
  resolveCommonColors,
  tintOn,
  inkOn,
} from "./shared/color-config";
import { glassCardStyles, glassCardClass } from "./shared/glass-card";
import { renderCardHeader, cardHeaderStyles } from "./shared/card-header";
import { shouldAnimate, STANDARD_EASING } from "./shared/animation";
import { activateOnKey } from "./shared/a11y";
import { VisibleTicker } from "./shared/visible-ticker";
import {
  fetchCalendarEvents,
  clearCalendarCache,
  startOfDay,
  addDays,
  sameDay,
  occursOn,
  isRunning,
  isPast,
  daysSpanned,
  dayIndexOf,
  type CalendarEvent,
} from "./shared/ha-calendar";
import { localize, type TranslationKey } from "./localize";
import { hassChangeMatters, listEntities } from "./shared/should-update";
import { TemplatedCard } from "./shared/templated-card";
import { openEntityDetail } from "./shared/entity-detail";

console.info(
  `%c M3-CALENDAR-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #85b7eb; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #85b7eb; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

const EASING = unsafeCSS(STANDARD_EASING);
const DAY_MS = 86400000;

interface ResolvedCalendar {
  entity: string;
  name: string;
  color: string;
  available: boolean;
}

/** One day's worth of the agenda. */
interface DayGroup {
  day: Date;
  events: CalendarEvent[];
}

@customElement("m3-calendar-card")
export class M3CalendarCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3CalendarCardConfig;
  @state() private _events: CalendarEvent[] = [];
  @state() private _failed: string[] = [];
  @state() private _loading = false;
  @state() private _view: CalendarView = "agenda";
  /** First of the month the grid is showing. */
  @state() private _monthAnchor = startOfDay(new Date());
  @state() private _selectedDay?: Date;
  @state() private _dialogEvent?: CalendarEvent;
  @state() private _dialogClosing = false;
  /** Advanced by the minute ticker, so "now" is never stale on screen. */
  @state() private _now = Date.now();

  private _ticker?: VisibleTicker;
  private _lastFetch = 0;
  /** Guards against an older response landing after a newer one. */
  private _fetchToken = 0;
  private _dialogTimer?: number;

  public static getStubConfig(hass: HomeAssistant): M3CalendarCardConfig {
    const calendars = Object.keys(hass?.states ?? {})
      .filter((e) => e.startsWith("calendar."))
      .slice(0, 4);
    return {
      type: "custom:m3-calendar-card",
      entities: calendars,
      view: "agenda",
      glass_background: true,
    };
  }

  public setConfig(config: M3CalendarCardConfig): void {
    if (!config?.entities?.length) throw new Error("entities is required");
    this._config = { glass_background: true, animation: "auto", ...config };
    this._view = config.view ?? "agenda";
    this._monthAnchor = this._firstOfMonth(new Date());
  }

  public getCardSize(): number {
    return this._view === "month" ? 8 : 6;
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: "full", rows: "auto", min_rows: 4 };
  }

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-calendar-card-editor");
    return document.createElement("m3-calendar-card-editor") as unknown as LovelaceCardEditor;
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return hassChangeMatters(changed, this.hass, listEntities(this._config?.entities));
  }

  // ---- Lifecycle ------------------------------------------------------------

  public connectedCallback(): void {
    super.connectedCallback();
    // One minute is enough for both jobs this card has on a timer: moving the
    // "now" line — which decides the running badge and what counts as past —
    // and noticing that the five-minute refetch is due. It also stops entirely
    // while the card is off screen or the tab is in the background.
    this._ticker = new VisibleTicker(this, (now) => this._tick(now));
    this._ticker.connect();
    this._ticker.setCadence("minute");
    void this._load();
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._ticker?.disconnect();
    this._ticker = undefined;
    window.clearTimeout(this._dialogTimer);
  }

  private _tick(now: number): void {
    // Only assign when the minute actually changed, so an off-by-a-second tick
    // does not cost a render.
    if (Math.floor(now / 60000) !== Math.floor(this._now / 60000)) this._now = now;
    if (now - this._lastFetch >= CALENDAR_REFRESH_MS) void this._load();
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    if (changed.has("_config") || changed.has("_view") || changed.has("_monthAnchor")) {
      void this._load();
    }
    // A calendar entity's state flipping means something changed in it; the
    // cache would otherwise hand back the old window for up to five minutes.
    const previous = changed.get("hass") as HomeAssistant | undefined;
    if (previous && this.hass) {
      for (const id of this._calendars().map((c) => c.entity)) {
        if (previous.states[id] !== this.hass.states[id]) {
          clearCalendarCache();
          void this._load();
          break;
        }
      }
    }
  }

  // ---- Data -----------------------------------------------------------------

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _calendars(): ResolvedCalendar[] {
    const list = this._config?.entities ?? [];
    return list.map((item, index) => {
      const cfg: CalendarSourceConfig = typeof item === "string" ? { entity: item } : item;
      const st = this.hass?.states[cfg.entity];
      return {
        entity: cfg.entity,
        name: cfg.name ?? (st?.attributes?.friendly_name as string) ?? cfg.entity,
        color: resolveThemeColor(cfg.color ?? CALENDAR_PALETTE[index % CALENDAR_PALETTE.length]),
        available: !!st && st.state !== "unavailable",
      };
    });
  }

  private _colorOf(calendarId: string): string {
    return this._calendars().find((c) => c.entity === calendarId)?.color ?? "#888780";
  }

  private _range(): { start: Date; end: Date } {
    if (this._view === "month") {
      // Padded to whole weeks, because the grid draws the neighbouring months'
      // days and they need their dots too.
      const first = this._firstOfMonth(this._monthAnchor);
      const start = addDays(first, -((first.getDay() - this._weekStart() + 7) % 7) - 7);
      const end = addDays(start, 7 * 7);
      return { start, end };
    }
    const start = startOfDay(new Date());
    const days = Math.min(
      CALENDAR_DAYS_AHEAD_MAX,
      Math.max(CALENDAR_DAYS_AHEAD_MIN, this._config?.days_ahead ?? CALENDAR_DAYS_AHEAD),
    );
    return { start, end: addDays(start, days) };
  }

  private async _load(): Promise<void> {
    const hass = this.hass;
    const calendars = this._calendars();
    if (!hass || calendars.length === 0) return;
    const token = ++this._fetchToken;
    this._loading = this._events.length === 0;
    this._lastFetch = Date.now();
    const { start, end } = this._range();
    const result = await fetchCalendarEvents(
      hass,
      calendars.map((c) => c.entity),
      start,
      end,
    );
    if (token !== this._fetchToken) return;
    this._events = result.events;
    this._failed = result.failed;
    this._loading = false;
  }

  // ---- Formatting -----------------------------------------------------------

  private get _use12h(): boolean {
    const fmt = (this.hass?.locale as { time_format?: string } | undefined)?.time_format;
    if (fmt === "12") return true;
    if (fmt === "24") return false;
    // "language" and "system" both mean "ask the locale".
    return !!new Intl.DateTimeFormat(this._language, { hour: "numeric" })
      .formatToParts(new Date())
      .find((p) => p.type === "dayPeriod");
  }

  private _time(d: Date): string {
    return new Intl.DateTimeFormat(this._language, {
      hour: this._use12h ? "numeric" : "2-digit",
      minute: "2-digit",
      hour12: this._use12h,
    }).format(d);
  }

  private _dayDate(d: Date): string {
    return new Intl.DateTimeFormat(this._language, { day: "numeric", month: "short" }).format(d);
  }

  private _weekday(d: Date): string {
    return new Intl.DateTimeFormat(this._language, { weekday: "long" }).format(d);
  }

  private _monthTitle(d: Date): string {
    return new Intl.DateTimeFormat(this._language, { month: "long", year: "numeric" }).format(d);
  }

  private _dayLabel(d: Date): string {
    const today = new Date(this._now);
    if (sameDay(d, today)) return this._t("calendar_today");
    if (sameDay(d, addDays(today, 1))) return this._t("calendar_tomorrow");
    return this._weekday(d);
  }

  /** "in 2 hrs" / "in 20 min", for the header chip. */
  private _relative(d: Date): string {
    const diff = d.getTime() - this._now;
    const rtf = new Intl.RelativeTimeFormat(this._language, { numeric: "auto" });
    const minutes = Math.round(diff / 60000);
    if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
    const hours = Math.round(diff / 3600000);
    if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
    return rtf.format(Math.round(diff / DAY_MS), "day");
  }

  private _weekStart(): number {
    const first = (this.hass?.locale as { first_weekday?: string } | undefined)?.first_weekday;
    const map: Record<string, number> = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };
    if (first && first !== "language" && map[first] !== undefined) return map[first];
    // Intl knows this per locale from Firefox 122 / Chrome 130; where it does
    // not, Monday is right for every locale this card is translated into.
    const weekInfo = (
      new Intl.Locale(this._language) as unknown as { weekInfo?: { firstDay?: number } }
    ).weekInfo;
    const day = weekInfo?.firstDay;
    return day === undefined ? 1 : day % 7;
  }

  private _firstOfMonth(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  // ---- Grouping -------------------------------------------------------------

  /**
   * The agenda, day by day. A multi-day event appears under every day it
   * touches rather than only its first, because "Tuesday" showing nothing while
   * a three-day trip is running would be wrong.
   */
  private _agenda(): { groups: DayGroup[]; hidden: number } {
    const cfg = this._config;
    const { start, end } = this._range();
    const now = new Date(this._now);
    const groups: DayGroup[] = [];

    for (let day = new Date(start); day < end; day = addDays(day, 1)) {
      const events = this._events
        .filter((e) => occursOn(e, day))
        .filter((e) => {
          if (!cfg?.hide_past_today) return true;
          return !(sameDay(day, now) && isPast(e, now));
        })
        .sort((a, b) => {
          if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
          return a.start.getTime() - b.start.getTime();
        });
      if (events.length) groups.push({ day: new Date(day), events });
    }

    const limit = cfg?.max_events ?? 0;
    if (limit <= 0) return { groups, hidden: 0 };

    let kept = 0;
    const trimmed: DayGroup[] = [];
    for (const group of groups) {
      if (kept >= limit) break;
      const slice = group.events.slice(0, limit - kept);
      kept += slice.length;
      trimmed.push({ day: group.day, events: slice });
    }
    const total = groups.reduce((n, g) => n + g.events.length, 0);
    return { groups: trimmed, hidden: Math.max(0, total - kept) };
  }

  private _eventsOn(day: Date): CalendarEvent[] {
    return this._events
      .filter((e) => occursOn(e, day))
      .sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return a.start.getTime() - b.start.getTime();
      });
  }

  private _nextEvent(): CalendarEvent | undefined {
    return this._events.find((e) => e.start.getTime() > this._now);
  }

  // ---- Interaction ----------------------------------------------------------

  private _setView(view: CalendarView): void {
    if (this._view === view) return;
    this._view = view;
    if (view === "month") this._monthAnchor = this._firstOfMonth(new Date(this._now));
  }

  private _shiftMonth(delta: number): void {
    const a = this._monthAnchor;
    this._monthAnchor = new Date(a.getFullYear(), a.getMonth() + delta, 1);
    this._selectedDay = undefined;
  }

  private _openEvent(event: CalendarEvent): void {
    const action = this._config?.tap_action ?? "detail";
    if (action === "none") return;
    if (action === "more-info") {
      openEntityDetail(this, event.calendarId);
      return;
    }
    if (action === "navigate") {
      this._navigate();
      return;
    }
    this._dialogClosing = false;
    this._dialogEvent = event;
  }

  private _closeDialog = (): void => {
    if (!this._dialogEvent) return;
    this._dialogClosing = true;
    window.clearTimeout(this._dialogTimer);
    this._dialogTimer = window.setTimeout(() => {
      this._dialogEvent = undefined;
      this._dialogClosing = false;
    }, 220);
  };

  private _navigate(): void {
    const path = this._config?.navigation_path ?? "/calendar";
    history.pushState(null, "", path);
    this.dispatchEvent(new CustomEvent("location-changed", { bubbles: true, composed: true }));
  }

  // ---- Render ---------------------------------------------------------------

  protected render(): TemplateResult | typeof nothing {
    const cfg = this._config;
    if (!cfg || !this.hass) return nothing;

    const accent = resolveThemeColor(cfg.accent_color ?? CALENDAR_PALETTE[0]);
    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(cfg);
    const radius = resolveCornerRadius(cfg.radius ?? DEFAULT_CALENDAR_RADIUS, cfg.corners);
    const iconBg = tintOn(this, accent, undefined, CALENDAR_TODAY_TINT);

    const cssVars = buildCssVars({
      "m3c-accent": accent,
      "m3c-ink": inkOn(accent, this),
      "m3c-icon-bg": iconBg,
      "m3c-text": textColorCss,
      "m3c-secondary": secondaryTextColorCss,
      "m3c-switch-tint": tintOn(this, accent, undefined, CALENDAR_SWITCH_TINT),
      "m3c-nav-tint": tintOn(this, accent, undefined, CALENDAR_NAV_TINT),
      "m3c-today-tint": tintOn(this, accent, undefined, CALENDAR_TODAY_TINT),
      // A 12-hour locale needs room for "10:30 AM"; the 24-hour column would
      // wrap it onto two lines, which is what it did before this existed.
      "m3c-time-col": `${this._use12h ? CALENDAR_TIME_COL_12H : CALENDAR_TIME_COL}px`,
    });

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(cfg.glass_background)} ${
            shouldAnimate(cfg.animation) ? "" : "no-animations"
          }"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          ${renderCardHeader({
            icon: cfg.icon ?? DEFAULT_CALENDAR_ICON,
            name: cfg.name ?? this._t("calendar_default_name"),
            subtitle: this._subtitle(),
            right: this._renderHeaderRight(),
          })}
          ${this._failed.length ? html`<div class="warn">${this._failedText()}</div>` : nothing}
          ${this._view === "month" ? this._renderMonth() : this._renderAgenda()}
          ${this._renderDialog()}
        </div>
      </ha-card>
    `;
  }

  private _subtitle(): string {
    if (this._view === "month") return this._monthTitle(this._monthAnchor);
    const today = this._eventsOn(new Date(this._now));
    if (today.length === 0) {
      const next = this._nextEvent();
      return next
        ? this._t("calendar_next").replace("{t}", this._relative(next.start))
        : this._t("calendar_no_events_today");
    }
    if (today.length === 1) return this._t("calendar_one_event_today");
    return this._t("calendar_events_today").replace("{n}", String(today.length));
  }

  private _failedText(): string {
    return this._failed.length === 1
      ? this._t("calendar_unavailable")
      : this._t("calendar_unavailable_many").replace("{n}", String(this._failed.length));
  }

  private _renderHeaderRight(): TemplateResult | undefined {
    const cfg = this._config;
    if (!cfg) return undefined;
    const chip = cfg.show_next_chip ? this._nextEvent() : undefined;
    const showSwitch = cfg.show_view_switch ?? true;
    if (!chip && !showSwitch) return undefined;

    return html`
      <div class="header-right">
        ${chip
          ? html`
              <span class="next-chip">
                <ha-icon icon="mdi:clock-outline"></ha-icon>
                <span>${chip.summary}</span>
                <span class="next-when">${this._relative(chip.start)}</span>
              </span>
            `
          : nothing}
        ${showSwitch
          ? html`
              <div class="view-switch" role="group">
                ${(["agenda", "month"] as CalendarView[]).map((view) => {
                  const onTap = (): void => this._setView(view);
                  return html`
                    <button
                      class="view-btn ${this._view === view ? "active" : ""}"
                      aria-pressed=${this._view === view ? "true" : "false"}
                      @click=${onTap}
                      @keydown=${activateOnKey(onTap)}
                    >
                      ${this._t(view === "agenda" ? "calendar_agenda" : "calendar_month")}
                    </button>
                  `;
                })}
              </div>
            `
          : nothing}
      </div>
    `;
  }

  // ---- Agenda ---------------------------------------------------------------

  private _renderAgenda(): TemplateResult {
    const { groups, hidden } = this._agenda();
    if (groups.length === 0) {
      const days = this._config?.days_ahead ?? CALENDAR_DAYS_AHEAD;
      return html`
        <div class="empty">
          ${this._loading
            ? this._t("calendar_loading")
            : this._t("calendar_empty").replace("{n}", String(days))}
        </div>
      `;
    }

    return html`
      <div class="agenda">
        ${groups.map(
          (group, index) => html`
            <div class="day-head ${index === 0 ? "first" : ""}">
              <span class="day-label ${sameDay(group.day, new Date(this._now)) ? "today" : ""}">
                ${this._dayLabel(group.day)}
              </span>
              <span class="day-date">${this._dayDate(group.day)}</span>
            </div>
            ${group.events.map((event) => this._renderEventRow(event, group.day))}
          `,
        )}
        ${hidden > 0
          ? html`<div class="more">${this._t("calendar_more").replace("{n}", String(hidden))}</div>`
          : nothing}
      </div>
    `;
  }

  private _renderEventRow(event: CalendarEvent, day: Date): TemplateResult {
    const color = this._colorOf(event.calendarId);
    const now = new Date(this._now);
    const running = isRunning(event, now);
    const past = isPast(event, now);
    const span = daysSpanned(event);
    const onTap = (): void => this._openEvent(event);

    return html`
      <div
        class="event ${past ? "past" : ""} ${running ? "running" : ""}"
        style=${buildCssVars({
          "m3c-bar": color,
          "m3c-run-tint": running ? tintOn(this, color, undefined, CALENDAR_RUNNING_TINT) : undefined,
          "m3c-run-ink": running ? inkOn(color, this) : undefined,
        })}
        role="button"
        tabindex="0"
        @click=${onTap}
        @keydown=${activateOnKey(onTap)}
      >
        <div class="time">
          ${event.allDay
            ? html`<span class="all-day">${this._t("calendar_all_day")}</span>`
            : html`
                <span class="time-start">${this._time(event.start)}</span>
                <span class="time-end">${this._time(event.end)}</span>
              `}
        </div>
        <span class="bar"></span>
        <div class="body">
          <div class="title">${event.summary}</div>
          ${span > 1
            ? html`<div class="sub">
                ${this._t("calendar_day_of")
                  .replace("{n}", String(dayIndexOf(event, day)))
                  .replace("{m}", String(span))}
              </div>`
            : event.location
              ? html`<div class="sub">${event.location}</div>`
              : nothing}
        </div>
        ${running ? html`<span class="now-badge">${this._t("calendar_now")}</span>` : nothing}
      </div>
    `;
  }

  // ---- Month ----------------------------------------------------------------

  private _renderMonth(): TemplateResult {
    const anchor = this._monthAnchor;
    const first = this._firstOfMonth(anchor);
    const weekStart = this._weekStart();
    const lead = (first.getDay() - weekStart + 7) % 7;
    const gridStart = addDays(first, -lead);
    const daysInMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
    const cells = Math.ceil((lead + daysInMonth) / 7) * 7;
    const today = new Date(this._now);
    const showAdjacent = this._config?.show_adjacent_days ?? true;

    const weekdays = Array.from({ length: 7 }, (_, i) =>
      new Intl.DateTimeFormat(this._language, { weekday: "short" }).format(
        addDays(gridStart, i),
      ),
    );

    const onTitle = (): void => {
      this._monthAnchor = this._firstOfMonth(today);
      this._selectedDay = undefined;
    };

    return html`
      <div class="month">
        <div class="month-head">
          <button
            class="nav"
            aria-label=${this._t("calendar_prev_month")}
            @click=${() => this._shiftMonth(-1)}
          >
            <ha-icon icon="mdi:chevron-left"></ha-icon>
          </button>
          <button
            class="month-title"
            aria-label=${this._t("calendar_back_to_today")}
            @click=${onTitle}
            @keydown=${activateOnKey(onTitle)}
          >
            ${this._monthTitle(anchor)}
          </button>
          <button
            class="nav"
            aria-label=${this._t("calendar_next_month")}
            @click=${() => this._shiftMonth(1)}
          >
            <ha-icon icon="mdi:chevron-right"></ha-icon>
          </button>
        </div>

        <div class="weekdays">
          ${weekdays.map((w) => html`<span>${w}</span>`)}
        </div>

        <div class="grid">
          ${Array.from({ length: cells }, (_, i) => {
            const day = addDays(gridStart, i);
            const adjacent = day.getMonth() !== anchor.getMonth();
            if (adjacent && !showAdjacent) return html`<span class="cell empty-cell"></span>`;
            const events = this._eventsOn(day);
            const isToday = sameDay(day, today);
            const selected = this._selectedDay && sameDay(day, this._selectedDay);
            const dots = events.slice(0, CALENDAR_DOTS_MAX);
            const overflow = events.length > CALENDAR_DOTS_MAX;
            const onTap = (): void => {
              this._selectedDay = selected ? undefined : day;
            };
            return html`
              <button
                class="cell ${adjacent ? "adjacent" : ""} ${isToday ? "today" : ""} ${
                  selected ? "selected" : ""
                }"
                aria-pressed=${selected ? "true" : "false"}
                @click=${onTap}
                @keydown=${activateOnKey(onTap)}
              >
                <span class="num">${day.getDate()}</span>
                <span class="dots">
                  ${dots.map((event, index) =>
                    index === CALENDAR_DOTS_MAX - 1 && overflow
                      ? html`<span class="plus">+</span>`
                      : html`<span
                          class="dot"
                          style=${`background: ${this._colorOf(event.calendarId)};`}
                        ></span>`,
                  )}
                </span>
              </button>
            `;
          })}
        </div>

        ${this._selectedDay ? this._renderSelectedDay(this._selectedDay) : nothing}
      </div>
    `;
  }

  private _renderSelectedDay(day: Date): TemplateResult {
    const events = this._eventsOn(day);
    if (events.length === 0) {
      return html`<div class="empty small">${this._t("calendar_empty_day")}</div>`;
    }
    return html`
      <div class="day-list">
        ${events.map((event) => {
          const onTap = (): void => this._openEvent(event);
          return html`
            <div
              class="day-row"
              style=${buildCssVars({ "m3c-bar": this._colorOf(event.calendarId) })}
              role="button"
              tabindex="0"
              @click=${onTap}
              @keydown=${activateOnKey(onTap)}
            >
              <span class="bar"></span>
              <span class="day-row-title">${event.summary}</span>
              <span class="day-row-time">
                ${event.allDay ? this._t("calendar_all_day") : this._time(event.start)}
              </span>
            </div>
          `;
        })}
      </div>
    `;
  }

  // ---- Dialog ---------------------------------------------------------------

  private _renderDialog(): TemplateResult | typeof nothing {
    const event = this._dialogEvent;
    if (!event) return nothing;
    const calendar = this._calendars().find((c) => c.entity === event.calendarId);
    const span = daysSpanned(event);
    const when = event.allDay
      ? span > 1
        ? `${this._dayDate(event.start)} – ${this._dayDate(event.end)}`
        : `${this._dayLabel(event.start)}, ${this._dayDate(event.start)} · ${this._t("calendar_all_day")}`
      : `${this._dayLabel(event.start)}, ${this._dayDate(event.start)} · ${this._time(
          event.start,
        )} – ${this._time(event.end)}`;

    return html`
      <div class="scrim ${this._dialogClosing ? "closing" : ""}" @click=${this._closeDialog}>
        <div
          class="sheet ${this._dialogClosing ? "closing" : ""}"
          role="dialog"
          aria-label=${event.summary}
          @click=${(e: Event) => e.stopPropagation()}
        >
          <div class="sheet-head">
            <span class="sheet-title">${event.summary}</span>
            <button class="sheet-close" aria-label=${this._t("calendar_close")} @click=${this._closeDialog}>
              <ha-icon icon="mdi:close"></ha-icon>
            </button>
          </div>
          <div class="sheet-when">${when}</div>
          ${event.location ? html`<div class="sheet-row">${event.location}</div>` : nothing}
          ${event.description ? html`<div class="sheet-desc">${event.description}</div>` : nothing}
          ${calendar
            ? html`
                <div class="sheet-cal">
                  <span class="dot" style=${`background: ${calendar.color};`}></span>
                  <span>${calendar.name}</span>
                </div>
              `
            : nothing}
          <div class="sheet-actions">
            <button class="sheet-btn primary" @click=${() => this._navigate()}>
              ${this._t("calendar_open")}
            </button>
            <button class="sheet-btn" @click=${this._closeDialog}>${this._t("calendar_close")}</button>
          </div>
        </div>
      </div>
    `;
  }

  static styles = css`
    ${glassCardStyles}
    ${cardHeaderStyles}

    ha-card {
      color: var(--m3c-text);
    }

    .card-inner {
      gap: var(--m3-card-gap, 12px);
      position: relative;
    }

    .m3-icon-swatch {
      background: var(--m3c-icon-bg);
      color: var(--m3c-accent);
    }

    .warn {
      font-size: 11px;
      opacity: 0.7;
      color: var(--m3c-secondary);
    }

    .empty {
      padding: 18px 0;
      text-align: center;
      font-size: 11px;
      opacity: 0.4;
      color: var(--m3c-secondary);
    }

    .empty.small {
      padding: 10px 0;
    }

    /* ---- header right ---- */
    .header-right {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .next-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      max-width: 190px;
      height: 26px;
      padding: 0 10px;
      border-radius: 13px;
      font-size: 11px;
      font-weight: 600;
      color: var(--m3c-accent);
      background: var(--m3c-today-tint);
    }

    .next-chip ha-icon {
      --mdc-icon-size: 14px;
      width: 14px;
      height: 14px;
    }

    .next-chip span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .next-when {
      opacity: 0.7;
      flex-shrink: 0;
    }

    .view-switch {
      display: flex;
      gap: 2px;
      padding: ${CALENDAR_SWITCH_PAD}px;
      border-radius: ${CALENDAR_SWITCH_RADIUS}px;
      background: var(--m3c-switch-tint);
    }

    .view-btn {
      height: ${CALENDAR_SWITCH_BTN}px;
      padding: 0 12px;
      border: none;
      border-radius: ${CALENDAR_SWITCH_BTN_RADIUS}px;
      background: transparent;
      color: var(--m3c-text);
      font-family: inherit;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition:
        border-radius 0.35s ${EASING},
        background 0.35s ${EASING},
        color 0.35s ${EASING};
    }

    .view-btn.active {
      border-radius: ${CALENDAR_SWITCH_BTN_RADIUS_ACTIVE}px;
      background: var(--m3c-accent);
      color: var(--m3c-ink);
    }

    /* ---- agenda ---- */
    .agenda {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .day-head {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-top: 12px;
    }

    .day-head.first {
      margin-top: 2px;
    }

    .day-label {
      font-size: ${CALENDAR_DAY_LABEL_SIZE}px;
      font-weight: 700;
    }

    .day-label.today {
      color: var(--m3c-accent);
    }

    .day-date {
      font-size: ${CALENDAR_DAY_DATE_SIZE}px;
      opacity: 0.4;
      color: var(--m3c-secondary);
    }

    .event {
      display: flex;
      align-items: stretch;
      gap: 10px;
      padding: 9px 12px;
      border-radius: ${CALENDAR_ROW_RADIUS}px;
      background: color-mix(in srgb, var(--m3c-secondary) ${CALENDAR_ROW_TINT}%, transparent);
      cursor: pointer;
      transition: border-radius 0.35s ${EASING}, background 0.35s ${EASING};
    }

    .no-animations .event,
    .no-animations .view-btn,
    .no-animations .cell,
    .no-animations .day-row {
      transition: none;
    }

    .event:active {
      border-radius: ${CALENDAR_ROW_RADIUS_ACTIVE}px;
    }

    .event.past {
      opacity: ${CALENDAR_PAST_OPACITY};
    }

    .event.running {
      background: var(--m3c-run-tint);
    }

    .time {
      flex: 0 0 var(--m3c-time-col, ${CALENDAR_TIME_COL}px);
      display: flex;
      flex-direction: column;
      justify-content: center;
      font-variant-numeric: tabular-nums;
    }

    .time-start {
      font-size: ${CALENDAR_TIME_SIZE}px;
      font-weight: 700;
    }

    .time-end {
      font-size: ${CALENDAR_TIME_END_SIZE}px;
      opacity: 0.4;
    }

    .all-day {
      font-size: ${CALENDAR_TIME_END_SIZE}px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      color: var(--m3c-bar);
    }

    .bar {
      flex: 0 0 ${CALENDAR_BAR_WIDTH}px;
      align-self: stretch;
      border-radius: ${CALENDAR_BAR_RADIUS}px;
      background: var(--m3c-bar);
    }

    .body {
      min-width: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 1px;
    }

    .title {
      font-size: ${CALENDAR_TITLE_SIZE}px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .sub {
      font-size: ${CALENDAR_LOCATION_SIZE}px;
      opacity: 0.45;
      color: var(--m3c-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .now-badge {
      align-self: center;
      margin-left: auto;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      height: ${CALENDAR_NOW_BADGE_HEIGHT}px;
      padding: 0 10px;
      border-radius: ${CALENDAR_NOW_BADGE_RADIUS}px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      background: var(--m3c-bar);
      color: var(--m3c-run-ink);
    }

    .more {
      padding: 8px 12px;
      font-size: 11px;
      opacity: 0.5;
      color: var(--m3c-secondary);
    }

    /* ---- month ---- */
    .month {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .month-head {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .nav {
      width: ${CALENDAR_NAV_BTN}px;
      height: ${CALENDAR_NAV_BTN}px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      border-radius: ${CALENDAR_NAV_RADIUS}px;
      background: var(--m3c-nav-tint);
      color: var(--m3c-text);
      cursor: pointer;
    }

    .nav ha-icon {
      --mdc-icon-size: 20px;
      width: 20px;
      height: 20px;
    }

    .month-title {
      flex: 1;
      border: none;
      background: transparent;
      color: var(--m3c-text);
      font-family: inherit;
      font-size: ${CALENDAR_MONTH_TITLE_SIZE}px;
      font-weight: 700;
      cursor: pointer;
    }

    .weekdays,
    .grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: ${CALENDAR_GRID_GAP}px;
    }

    .weekdays span {
      text-align: center;
      font-size: ${CALENDAR_WEEKDAY_SIZE}px;
      font-weight: 600;
      opacity: 0.35;
      color: var(--m3c-secondary);
    }

    .cell {
      aspect-ratio: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      border: none;
      border-radius: 12px;
      background: transparent;
      color: var(--m3c-text);
      font-family: inherit;
      cursor: pointer;
      transition: border-radius 0.35s ${EASING}, background 0.35s ${EASING};
    }

    .cell.empty-cell {
      cursor: default;
    }

    .cell.adjacent {
      opacity: ${CALENDAR_ADJACENT_OPACITY};
    }

    .num {
      font-size: ${CALENDAR_CELL_NUM_SIZE}px;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
    }

    .cell.today {
      border-radius: ${CALENDAR_TODAY_RADIUS}px;
      background: var(--m3c-today-tint);
    }

    .cell.today .num {
      font-weight: 700;
      color: var(--m3c-accent);
    }

    .cell.selected {
      border-radius: ${CALENDAR_SELECTED_RADIUS}px;
      background: var(--m3c-accent);
    }

    .cell.selected .num {
      font-weight: 700;
      color: var(--m3c-ink);
    }

    .dots {
      display: flex;
      align-items: center;
      gap: 2px;
      height: ${CALENDAR_DOT_SIZE}px;
    }

    .dot {
      width: ${CALENDAR_DOT_SIZE}px;
      height: ${CALENDAR_DOT_SIZE}px;
      border-radius: ${CALENDAR_DOT_SIZE / 2}px;
    }

    .plus {
      font-size: 9px;
      font-weight: 700;
      line-height: ${CALENDAR_DOT_SIZE}px;
      opacity: 0.7;
    }

    .cell.selected .dot,
    .cell.selected .plus {
      filter: brightness(0.35);
    }

    .day-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 4px;
    }

    .day-row {
      display: flex;
      align-items: center;
      gap: 10px;
      height: ${CALENDAR_DAY_ROW_HEIGHT}px;
      padding: 0 12px;
      border-radius: ${CALENDAR_DAY_ROW_RADIUS}px;
      background: color-mix(in srgb, var(--m3c-secondary) ${CALENDAR_ROW_TINT}%, transparent);
      cursor: pointer;
      transition: border-radius 0.35s ${EASING};
    }

    .day-row:active {
      border-radius: ${CALENDAR_ROW_RADIUS_ACTIVE}px;
    }

    .day-row .bar {
      height: 20px;
      align-self: center;
    }

    .day-row-title {
      min-width: 0;
      font-size: ${CALENDAR_TITLE_SIZE}px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .day-row-time {
      margin-left: auto;
      flex-shrink: 0;
      font-size: 11px;
      opacity: 0.5;
      font-variant-numeric: tabular-nums;
    }

    /* ---- dialog ---- */
    .scrim {
      position: absolute;
      inset: 0;
      z-index: 5;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 12px;
      background: rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(2px);
      animation: fade-in 0.2s ${EASING};
    }

    .scrim.closing {
      animation: fade-out 0.2s ${EASING} forwards;
    }

    .sheet {
      width: 100%;
      max-width: 340px;
      max-height: min(100%, 70vh);
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 14px;
      border-radius: 22px;
      /* Painted in two layers, and it has to be. Taking the theme's card colour
         on its own is right for a card and wrong for a dialog: a glass theme
         makes that colour translucent on purpose, and a translucent panel laid
         over the agenda it came from leaves both unreadable — the rows behind
         show straight through the title and the buttons. The theme's colour is
         kept, as an image over an opaque base, so the panel looks like the rest
         of the theme and still hides what is under it. */
      background-color: var(--primary-background-color, #1c1c1c);
      background-image: linear-gradient(
        var(--ha-card-background, var(--card-background-color, transparent)),
        var(--ha-card-background, var(--card-background-color, transparent))
      );
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
      animation: pop-in 0.22s ${EASING};
    }

    .sheet.closing {
      animation: pop-out 0.22s ${EASING} forwards;
    }

    .sheet-head {
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }

    .sheet-title {
      flex: 1;
      font-size: 15px;
      font-weight: 700;
    }

    .sheet-close {
      flex-shrink: 0;
      width: 30px;
      height: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      border-radius: 11px;
      background: color-mix(in srgb, var(--m3c-secondary) 10%, transparent);
      color: var(--m3c-text);
      cursor: pointer;
      transition: border-radius 0.25s ${EASING}, transform 0.25s ${EASING};
    }

    .sheet-close:active {
      border-radius: 15px;
    }

    .sheet.closing .sheet-close {
      transform: rotate(90deg);
    }

    .sheet-when {
      font-size: 12px;
      font-weight: 600;
      color: var(--m3c-accent);
    }

    .sheet-row {
      font-size: 12px;
      opacity: 0.7;
      color: var(--m3c-secondary);
    }

    .sheet-desc {
      font-size: 12px;
      opacity: 0.7;
      color: var(--m3c-secondary);
      white-space: pre-wrap;
    }

    .sheet-cal {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      opacity: 0.6;
    }

    .sheet-actions {
      display: flex;
      gap: 6px;
      margin-top: 4px;
    }

    .sheet-btn {
      flex: 1;
      height: 38px;
      border: none;
      border-radius: 14px;
      font-family: inherit;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      color: var(--m3c-text);
      background: color-mix(in srgb, var(--m3c-secondary) 10%, transparent);
    }

    .sheet-btn.primary {
      background: var(--m3c-accent);
      color: var(--m3c-ink);
    }

    @keyframes fade-in {
      from {
        opacity: 0;
      }
    }

    @keyframes fade-out {
      to {
        opacity: 0;
      }
    }

    @keyframes pop-in {
      from {
        opacity: 0;
        transform: scale(0.94);
      }
    }

    @keyframes pop-out {
      to {
        opacity: 0;
        transform: scale(0.94);
      }
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-calendar-card": M3CalendarCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-calendar-card",
  name: "M3 Calendar Card",
  description:
    "Agenda and month grid for any number of calendars, in one card — with running events marked and multi-day events shown on every day they touch.",
  // false: connectedCallback() fetches real events from the backend for every
  // configured calendar as soon as the card mounts. HA's card-picker preview
  // would pay that network round-trip just to draw a thumbnail — the same
  // reasoning as the discovering cards, but a live fetch rather than a scan.
  preview: false,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
