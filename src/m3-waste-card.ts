import { LitElement, html, css, nothing, type PropertyValues, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  LovelaceGridOptions,
  M3WasteCardConfig,
  WasteEntityConfig,
  LovelaceCard,
  LovelaceCardEditor,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_WASTE_RADIUS,
  DEFAULT_WASTE_ICON,
  DEFAULT_WASTE_COLOR,
  WASTE_ICON_RULES,
  WASTE_COLOR_RULES,
  WASTE_DEFAULT_NAME_STRIP,
  WASTE_TIMELINE_DAYS,
  WASTE_CALENDAR_LOOKAHEAD_DAYS,
  WASTE_REMINDER_OFFSET,
  WASTE_REMINDER_TIME,
  WASTE_TICK_MS,
  resolveCornerRadius,
  WASTE_TIMELINE_DOT_PX,
  WASTE_ESCALATE_COLOR,
  WASTE_COMPACT_ICON_PX,
  WASTE_TILE_MIN_HEIGHT_PX,
} from "./const";
import { resolveThemeColor, buildCssVars, tintOn, tintInk, foregroundOn, resolveCommonColors, foregroundVars, inkOn } from "./shared/color-config";
import { glassCardStyles, glassCardClass } from "./shared/glass-card";
import { shouldAnimate, isReducedMotion } from "./shared/animation";
import { localize, type TranslationKey } from "./localize";
import { hassChangeMatters, listEntities } from "./shared/should-update";
import { TemplatedCard } from "./shared/templated-card";
import { openEntityDetail } from "./shared/entity-detail";
import { iconWell } from "./shared/icon-well";
import { openDropdownMenu } from "./shared/dropdown-menu";
import { wasteDaysFromState, withoutDeviceName } from "./shared/waste";

console.info(
  `%c M3-WASTE-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #9fb0c0; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #9fb0c0; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

// Shape of the REST calendar response, narrowed to what this card reads.
interface CalendarEvent {
  summary?: string;
  start?: { date?: string; dateTime?: string };
}

interface WasteStream {
  entity: string;
  name: string;
  icon: string;
  color: string;
  /** The integration's own picture, shown with `show_entity_picture`. */
  picture?: string;
  daysTo?: number; // undefined = unknown/unavailable
  date?: Date;
}

@customElement("m3-waste-card")
export class M3WasteCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3WasteCardConfig;
  @state() private _expanded = false;
  @state() private _sessionAck?: string;
  @state() private _now = Date.now();
  @state() private _calendarStreams: WasteStream[] = [];
  private _tick?: number;
  private _calendarKey?: string;

  protected shouldUpdate(changed: PropertyValues): boolean {
    return hassChangeMatters(changed, this.hass, [this._config?.ack_entity, ...listEntities(this._config?.entities)]);
  }

  public setConfig(config: M3WasteCardConfig): void {
    this._config = config;
  }

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-waste-card-editor");
    return document.createElement("m3-waste-card-editor") as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(hass: HomeAssistant): M3WasteCardConfig {
    const sensors = Object.keys(hass.states).filter(
      (id) =>
        id.startsWith("sensor.") &&
        /waste|abfall|m(ü|ue)ll|tonne|collection|abfuhr/i.test(id) &&
        !isNaN(parseFloat(hass.states[id].state)),
    );
    return {
      type: "custom:m3-waste-card",
      mode: "info",
      auto_discover: sensors.length > 0,
      entities: sensors.length ? sensors : [],
      glass_background: true,
    };
  }

  private get _layout(): "full" | "row" | "tile" | "pill" {
    const l = this._config?.layout;
    return l === "row" || l === "tile" || l === "pill" ? l : "full";
  }

  public getCardSize(): number {
    return { full: 4, row: 1, tile: 3, pill: 1 }[this._layout];
  }

  public getGridOptions(): LovelaceGridOptions {
    switch (this._layout) {
      case "tile":
        return { columns: 6, rows: "auto", min_columns: 3 };
      case "pill":
        return { columns: 4, rows: "auto", min_columns: 3 };
      default:
        return { columns: 12, rows: "auto" };
    }
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this._tick = window.setInterval(() => (this._now = Date.now()), WASTE_TICK_MS);
  }
  public disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._tick) clearInterval(this._tick);
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    this._maybeFetchCalendar();
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }
  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  // ---- model ---------------------------------------------------------------

  private _deviceName(entityId: string): string | undefined {
    const deviceId = (this.hass?.entities as Record<string, { device_id?: string | null }> | undefined)?.[entityId]?.device_id;
    const device = deviceId
      ? (this.hass?.devices as Record<string, { name?: string | null; name_by_user?: string | null }> | undefined)?.[deviceId]
      : undefined;
    return device?.name_by_user || device?.name || undefined;
  }

  /** A bin's glyph: the integration's picture when asked for and there, else its icon. */
  private _glyph(s: WasteStream | undefined, fallback: string = DEFAULT_WASTE_ICON): unknown {
    if (this._config?.show_entity_picture && s?.picture) {
      return html`<img class="waste-pic" src=${s.picture} alt="" />`;
    }
    return html`<ha-icon icon=${s?.icon ?? fallback}></ha-icon>`;
  }

  private _stripName(name: string): string {
    const patterns = this._config?.name_strip ?? WASTE_DEFAULT_NAME_STRIP;
    let out = name;
    for (const p of patterns) out = out.replace(new RegExp(p, "i"), "");
    return out.trim() || name;
  }

  private _iconFor(name: string, explicit?: string): string {
    if (explicit) return explicit;
    for (const [re, icon] of WASTE_ICON_RULES) if (re.test(name)) return icon;
    return DEFAULT_WASTE_ICON;
  }
  private _colorFor(name: string, explicit?: string): string {
    if (explicit) return resolveThemeColor(explicit);
    for (const [re, color] of WASTE_COLOR_RULES) if (re.test(name)) return color;
    return DEFAULT_WASTE_COLOR;
  }

  private _entities(): WasteEntityConfig[] {
    const list = this._config?.entities ?? [];
    return list.map((e) => (typeof e === "string" ? { entity: e } : e));
  }

  // ---- calendar source -----------------------------------------------------
  // Waste Collection Schedule can expose the schedule either as one day-count
  // sensor per bin or as a single calendar whose event summaries name the bins.
  // The two models are different enough to need separate handling: a sensor is
  // one stream, a calendar is many, and only the calendar has to be fetched.
  //
  // There is no websocket command for listing events — `calendar/event/list`
  // does not exist — so this goes through the REST endpoint the HA frontend
  // itself uses.
  private async _fetchCalendar(): Promise<void> {
    const hass = this.hass;
    const eid = this._config?.calendar_entity;
    if (!hass || !eid) return;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + WASTE_CALENDAR_LOOKAHEAD_DAYS * 86400_000);
    try {
      const events = await hass.callApi<CalendarEvent[]>(
        "GET",
        `calendars/${eid}?start=${encodeURIComponent(start.toISOString())}` +
          `&end=${encodeURIComponent(end.toISOString())}`,
      );
      this._calendarStreams = this._groupEvents(events ?? [], start);
    } catch {
      // A missing or unreadable calendar leaves the configured sensors to
      // carry the card, rather than emptying it.
      if (this._calendarStreams.length) this._calendarStreams = [];
    }
  }

  private _maybeFetchCalendar(): void {
    const eid = this._config?.calendar_entity;
    if (!this.hass || !eid) {
      // Only assign when there is something to clear. A fresh [] is a new
      // identity, and a @state field reassigned from updated() schedules the
      // next render, which schedules the next — the card without a calendar
      // would spin forever.
      if (this._calendarStreams.length) this._calendarStreams = [];
      this._calendarKey = undefined;
      return;
    }
    // Re-read once a day, or whenever the configured calendar changes.
    const key = `${eid}|${new Date().toDateString()}`;
    if (key === this._calendarKey) return;
    this._calendarKey = key;
    void this._fetchCalendar();
  }

  // One stream per distinct event summary, taking each bin's soonest date.
  private _groupEvents(events: CalendarEvent[], startOfToday: Date): WasteStream[] {
    const proTonne = new Map<string, { name: string; date: Date }>();
    for (const ev of events) {
      const summary = (ev.summary ?? "").trim();
      if (!summary) continue;
      const roh = ev.start?.date ?? ev.start?.dateTime;
      if (!roh) continue;
      const date = new Date(roh);
      if (isNaN(date.getTime())) continue;
      date.setHours(0, 0, 0, 0);
      if (date.getTime() < startOfToday.getTime()) continue;
      const key = summary.toLowerCase();
      const bisher = proTonne.get(key);
      if (!bisher || date.getTime() < bisher.date.getTime()) {
        proTonne.set(key, { name: summary, date });
      }
    }
    return [...proTonne.entries()].map(([key, { name, date }]) => {
      // Event summaries come straight out of an ICS file and are often all
      // lower case ("altpapier"). A sensor's friendly name is the user's own
      // wording and is left alone; this one is not, so it gets a capital.
      const roh = this._stripName(name);
      const anzeige = roh.charAt(0).toUpperCase() + roh.slice(1);
      return {
        entity: `${this._config?.calendar_entity ?? "calendar"}#${key}`,
        name: anzeige,
        icon: this._iconFor(anzeige),
        color: this._colorFor(anzeige),
        daysTo: Math.round((date.getTime() - startOfToday.getTime()) / 86400_000),
        date,
      };
    });
  }

  private _streams(): WasteStream[] {
    const hass = this.hass;
    if (!hass) return [];
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return this._entities()
      .filter((c) => c.entity)
      .map((c): WasteStream => {
        const st = hass.states[c.entity];
        const rawName = c.name || (st?.attributes?.friendly_name as string) || c.entity;
        const name = c.name ? rawName : this._stripName(withoutDeviceName(rawName, this._deviceName(c.entity)));
        let daysTo = wasteDaysFromState(st?.state);
        // A negative value (appointment already past) reads as "today".
        if (daysTo !== undefined && daysTo < 0) daysTo = 0;
        const date = daysTo !== undefined ? new Date(startOfToday.getTime() + daysTo * 86400_000) : undefined;
        return {
          entity: c.entity,
          name,
          icon: this._iconFor(name, c.icon),
          color: this._colorFor(name, c.color),
          picture: (st?.attributes?.entity_picture as string | undefined) || undefined,
          daysTo,
          date,
        };
      });
  }

  private _allStreams(): WasteStream[] {
    const sensoren = this._streams();
    // Both sources may describe the same bin — someone running the integration
    // with sensors *and* a calendar would otherwise see every bin twice. The
    // explicitly configured sensor wins; the calendar fills in the rest.
    const bekannt = new Set(sensoren.map((s) => s.name.toLowerCase()));
    return [...sensoren, ...this._calendarStreams.filter((s) => !bekannt.has(s.name.toLowerCase()))];
  }

  private _sorted(streams: WasteStream[]): WasteStream[] {
    return [...streams].sort((a, b) => {
      if (a.daysTo === undefined) return 1;
      if (b.daysTo === undefined) return -1;
      return a.daysTo - b.daysTo;
    });
  }

  // ---- date/label helpers --------------------------------------------------

  private _weekday(date: Date): string {
    return new Intl.DateTimeFormat(this._language, { weekday: "long" }).format(date);
  }
  private _shortDate(date: Date): string {
    return new Intl.DateTimeFormat(this._language, { day: "numeric", month: "short" }).format(date);
  }
  private _daysHero(days: number): string {
    if (days <= 0) return this._t("waste_today");
    if (days === 1) return this._t("waste_tomorrow");
    return this._t("waste_in_days").replace("{n}", String(days));
  }
  private _daysRow(days: number): string {
    if (days <= 0) return this._t("waste_today_short");
    if (days === 1) return this._t("waste_tomorrow_short");
    return this._t("waste_days").replace("{n}", String(days));
  }

  // ---- reminder / ack ------------------------------------------------------

  private _ackKey(next?: WasteStream): string {
    return next?.date ? next.date.toISOString().slice(0, 10) : "";
  }

  private _isAcked(ackKey: string): boolean {
    if (!ackKey) return false;
    const ent = this._config?.ack_entity;
    if (ent && this.hass) {
      const st = this.hass.states[ent];
      if (!st) return false;
      if (ent.startsWith("input_boolean.")) return st.state === "on";
      // input_datetime: acked if set today or later (this cycle).
      const ts = Date.parse(st.state);
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      return !isNaN(ts) && ts >= startOfToday.getTime();
    }
    return this._sessionAck === ackKey;
  }

  private _ack(ackKey: string): void {
    const ent = this._config?.ack_entity;
    if (ent && this.hass) {
      if (ent.startsWith("input_boolean.")) {
        this.hass.callService("input_boolean", "turn_on", { entity_id: ent }).catch(() => undefined);
      } else if (ent.startsWith("input_datetime.")) {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, "0");
        const datetime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        this.hass.callService("input_datetime", "set_datetime", { entity_id: ent, datetime }).catch(() => undefined);
      }
    }
    this._sessionAck = ackKey;
  }

  private _reminderMinutes(): number {
    const t = this._config?.reminder_time ?? WASTE_REMINDER_TIME;
    const [h, m] = t.split(":").map((x) => parseInt(x, 10));
    return (isNaN(h) ? 18 : h) * 60 + (isNaN(m) ? 0 : m);
  }

  private _moreInfo(entity: string): void {
    openEntityDetail(this, entity);
  }

  // ---- render: hero --------------------------------------------------------

  private _renderHeroIcon(sameDayStreams: WasteStream[], primaryColor: string, mode: "first" | "multi"): unknown {
    if (mode === "multi" && sameDayStreams.length > 1) {
      const three = sameDayStreams.slice(0, 3);
      return html`<div class="hero-multi">
        ${three.map(
          (s, i) => html`<div class="mini" style=${`background: ${tintOn(this, s.color, undefined, 22)}; color: ${tintInk(this, s.color, undefined, 22, 3)}; margin-left: ${i === 0 ? 0 : -8}px; z-index: ${3 - i};`}>
            ${this._glyph(s)}
          </div>`,
        )}
      </div>`;
    }
    return html`<div class="hero-icon" style=${`background: ${iconWell(tintOn(this, primaryColor, undefined, 22))}; color: ${tintInk(this, primaryColor, undefined, 22, 3)};`}>
      ${this._glyph(sameDayStreams[0])}
    </div>`;
  }

  protected render() {
    if (!this._config || !this.hass) return nothing;
    const mode = this._config.mode ?? "info";
    const heroPrimary = this._config.hero_primary ?? "days";
    const heroIconMode = this._config.hero_icon ?? "first";
    const streams = this._sorted(this._allStreams());
    const known = streams.filter((s) => s.daysTo !== undefined);
    const next = known[0];
    const sameDay = next ? known.filter((s) => s.daysTo === next.daysTo) : [];
    const primaryColor = next ? next.color : DEFAULT_WASTE_COLOR;

    const animate = shouldAnimate(this._config.animation) && !isReducedMotion();
    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(this._config);

    // reminder escalation
    const ackKey = this._ackKey(next);
    const acked = this._isAcked(ackKey);
    let escalate = false;
    if (mode === "reminder" && next && next.daysTo !== undefined && !acked) {
      const offset = this._config.reminder_offset ?? WASTE_REMINDER_OFFSET;
      const nowMins = new Date(this._now).getHours() * 60 + new Date(this._now).getMinutes();
      if (next.daysTo < offset) escalate = true;
      else if (next.daysTo === offset) escalate = nowMins >= this._reminderMinutes();
    }

    // Urgency is not a property of the bin: a grey Restmüll bin washed the
    // "put it out now" hero in grey, which reads as switched off. The hero
    // icon keeps the bin's colour below, so the card still says which bin.
    const accentColor = escalate ? WASTE_ESCALATE_COLOR : primaryColor;
    const cssVars = buildCssVars({
      "m3p-text": textColorCss,
      "m3p-secondary-text": secondaryTextColorCss,
      "waste-accent": accentColor,
      // Fills keep the accent; these twins carry it where it is text.
      ...foregroundVars(this, {
        "waste-accent": accentColor,
      }),
    });
    const radius = resolveCornerRadius(this._config.radius ?? DEFAULT_WASTE_RADIUS, this._config.corners);

    // hero label + values
    let heroLabel: string;
    if (!next) heroLabel = this._t("waste_none_label");
    else if (escalate) heroLabel = next.daysTo === 0 ? this._t("waste_put_out_now") : this._t("waste_put_out_evening");
    else if (next.daysTo === 0) heroLabel = this._t("waste_emptied_today");
    else heroLabel = this._t("waste_next_label");

    const namesJoined = sameDay.map((s) => s.name).join(" · ");
    let heroMain: string;
    let heroSub: string;
    if (!next) {
      heroMain = "—";
      heroSub = "";
    } else if (heroPrimary === "date") {
      heroMain = next.daysTo === 0 ? this._t("waste_today") : next.date ? this._compactDate(next.date) : "—";
      heroSub = `${namesJoined} · ${this._daysHero(next.daysTo!)}`;
    } else if (heroPrimary === "weekday") {
      heroMain = next.daysTo === 0 ? this._t("waste_today") : next.date ? this._weekday(next.date) : "—";
      heroSub = `${namesJoined} · ${this._daysHero(next.daysTo!)}`;
    } else {
      heroMain = this._daysHero(next.daysTo!);
      heroSub = next.date ? `${namesJoined} · ${this._weekday(next.date)}` : namesJoined;
    }

    if (this._layout !== "full") {
      return this._renderCompact(this._layout, { next, sameDay, escalate, acked, ackKey, cssVars, radius, cardBackgroundCss, animate });
    }

    const timelineDays = Math.max(7, Math.min(28, this._config.timeline_days ?? WASTE_TIMELINE_DAYS));
    const maxRows = this._config.max_visible ?? this._config.max_rows ?? 0;
    const visibleRows = maxRows > 0 ? streams.slice(0, maxRows) : streams;
    const hiddenRows = maxRows > 0 ? streams.slice(maxRows) : [];

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(this._config.glass_background)} ${escalate ? "escalate" : ""} ${animate ? "" : "no-animations"}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          <div class="hero ${escalate ? "escalate" : ""}">
            ${this._renderHeroIcon(sameDay.length ? sameDay : [{ icon: this._config.icon || DEFAULT_WASTE_ICON } as WasteStream], primaryColor, heroIconMode)}
            <div class="hero-text">
              <div class="hero-label">${heroLabel}</div>
              <div class="hero-main ${escalate ? "big" : ""}">${heroMain}</div>
              <div class="hero-sub">${heroSub}</div>
            </div>
            ${sameDay.length > 1 && !escalate
              ? html`<div class="count-chip">${this._t("waste_count").replace("{n}", String(sameDay.length))}</div>`
              : nothing}
            ${escalate
              ? html`<button class="ack-btn ${acked ? "done" : ""}" @click=${() => this._ack(ackKey)} aria-label=${this._t("waste_ack")}>
                  <ha-icon icon="mdi:check"></ha-icon>
                </button>`
              : nothing}
          </div>

          ${this._config.show_timeline !== false && known.length
            ? this._renderTimeline(known, timelineDays)
            : nothing}

          <div class="row-list">${visibleRows.map((s) => this._renderRow(s, next))}</div>
          ${hiddenRows.length
            ? html`<button class="collapse-toggle" @click=${() => (this._expanded = !this._expanded)}>
                  <span>${this._expanded ? this._t("waste_collapse") : this._t("waste_expand").replace("{n}", String(hiddenRows.length))}</span>
                  <ha-icon class="chevron ${this._expanded ? "open" : ""}" icon="mdi:chevron-down"></ha-icon>
                </button>
                ${this._expanded ? html`<div class="row-list">${hiddenRows.map((s) => this._renderRow(s, next))}</div>` : nothing}`
            : nothing}
        </div>
      </ha-card>
    `;
  }

  // ---- render: compact ------------------------------------------------------

  /** "Heute", "Morgen", "14 T." — the right size for a chip. */
  private _daysCompact(days: number): string {
    if (days <= 0) return this._t("waste_today");
    if (days === 1) return this._t("waste_tomorrow");
    return this._t("waste_days_short").replace("{n}", String(days));
  }

  /** "Do., 10. Dez." */
  private _compactDate(date: Date): string {
    return new Intl.DateTimeFormat(this._language, { weekday: "short", day: "numeric", month: "short" }).format(date);
  }

  /** One bin's icon in a well, or up to three overlapping when several go the same day. */
  private _renderCompactIcon(sameDay: WasteStream[], fallbackIcon: string): unknown {
    if (sameDay.length > 1) {
      return html`<div class="c-icons">
        ${sameDay.slice(0, 3).map(
          (s, i) => html`<div class="c-mini" style=${`background: ${tintOn(this, s.color, undefined, 22)}; color: ${tintInk(this, s.color, undefined, 22, 3)}; z-index: ${3 - i};`}>
            ${this._glyph(s)}
          </div>`,
        )}
      </div>`;
    }
    const s = sameDay[0];
    const color = s?.color ?? DEFAULT_WASTE_COLOR;
    return html`<div class="c-icon" style=${`background: ${iconWell(tintOn(this, color, undefined, 22))}; color: ${tintInk(this, color, undefined, 22, 3)};`}>
      ${this._glyph(s, fallbackIcon)}
    </div>`;
  }

  /**
   * Only the next collection, in three sizes from one card: a row across the
   * width, a tile for a half-width slot, a pill for a header or a chip row.
   * Days away it stays quiet; tomorrow the card takes the bin's tint and the
   * chip its colour; today (or when a reminder is due) the chip is filled.
   * Several bins on the same day overlap their icons and share the names.
   */
  private _renderCompact(
    layout: "row" | "tile" | "pill",
    c: {
      next?: WasteStream;
      sameDay: WasteStream[];
      escalate: boolean;
      acked: boolean;
      ackKey: string;
      cssVars: string;
      radius: string;
      cardBackgroundCss?: string;
      animate: boolean;
    },
  ): unknown {
    const cfg = this._config!;
    const { next, sameDay, escalate, acked, ackKey } = c;
    const days = next?.daysTo;
    const urgency = escalate || days === 0 ? "today" : days === 1 ? "tomorrow" : days === undefined ? "none" : "later";
    const names = sameDay.length > 1 ? sameDay.map((s) => s.name).join(" · ") : next?.name ?? this._t("waste_none_label");
    // `hero_primary` decides what leads here too: the days ("14 d"), the
    // weekday ("Thu") or the date ("10 Dec"). Today and tomorrow stay words —
    // they say more than any date — and what does not lead goes underneath.
    const lead = cfg.hero_primary ?? "days";
    const byDate = lead !== "days" && days !== undefined && days >= 2 && !!next?.date;
    const weekdayLead = byDate && lead === "weekday" && days! <= 6;
    const chip =
      days === undefined
        ? "—"
        : !byDate
          ? this._daysCompact(days)
          : weekdayLead
            ? new Intl.DateTimeFormat(this._language, { weekday: "short" }).format(next!.date!)
            : this._shortDate(next!.date!);
    const date = !next?.date ? "" : byDate ? this._daysHero(days!) : this._compactDate(next.date);
    const icon = this._renderCompactIcon(sameDay, cfg.icon || DEFAULT_WASTE_ICON);
    const accent = escalate ? WASTE_ESCALATE_COLOR : next?.color ?? DEFAULT_WASTE_COLOR;
    const chipStyle =
      urgency === "today"
        ? `background: ${accent}; color: ${inkOn(accent, this)};`
        : urgency === "tomorrow"
          ? `background: ${tintOn(this, accent, undefined, 24)}; color: ${foregroundOn(accent, tintOn(this, accent, undefined, 24), 4.5)};`
          : "";
    // Several bins on one day: a tap asks which one rather than opening the
    // first and leaving the others out of reach.
    const open = (e?: Event) => {
      if (!next) return;
      if (sameDay.length < 2) {
        this._moreInfo(next.entity);
        return;
      }
      openDropdownMenu({
        anchor: (e?.currentTarget as HTMLElement | null) ?? this,
        label: date || names,
        items: sameDay.map((s) => ({ value: s.entity, label: s.name, icon: s.icon })),
        onSelect: (entity) => this._moreInfo(entity),
      });
    };
    const label = next ? `${names}: ${days !== undefined ? this._daysHero(days) : ""}${date ? `, ${date}` : ""}` : this._t("waste_none_label");
    const ackButton =
      escalate && layout !== "pill"
        ? html`<button
            class="c-ack ${acked ? "done" : ""}"
            aria-label=${this._t("waste_ack")}
            title=${this._t("waste_ack")}
            @click=${(e: Event) => {
              e.stopPropagation();
              this._ack(ackKey);
            }}
          >
            <ha-icon icon="mdi:check"></ha-icon>
          </button>`
        : nothing;

    let body: unknown;
    if (layout === "row") {
      body = html`
        ${icon}
        <div class="c-text">
          <div class="c-name">${names}</div>
          ${date ? html`<div class="c-sub">${date}</div>` : nothing}
        </div>
        <div class="c-chip" style=${chipStyle}>${chip}</div>
        ${ackButton}
      `;
    } else if (layout === "tile") {
      let big;
      if (days === undefined || days < 2) big = html`<span class="c-word">${chip}</span>`;
      else if (!byDate) big = html`<span class="c-num">${days}</span><span class="c-unit">${this._t("waste_days_unit")}</span>`;
      else if (weekdayLead) big = html`<span class="c-word">${this._weekday(next!.date!)}</span>`;
      else {
        const parts = new Intl.DateTimeFormat(this._language, { day: "numeric", month: "short" }).formatToParts(next!.date!);
        const day = parts.find((p) => p.type === "day")?.value ?? "";
        const month = parts.find((p) => p.type === "month")?.value ?? "";
        // "10." in German, "10" in English: the separator the locale puts after the day.
        const dot = parts.find((p, i) => p.type === "literal" && parts[i - 1]?.type === "day")?.value.trim() ?? "";
        big = html`<span class="c-num">${day}${dot}</span><span class="c-unit">${month}</span>`;
      }
      const shortDate = !next?.date ? "" : byDate ? this._daysHero(days!) : this._shortDate(next.date);
      // Three names do not fit a half-width tile; the icons above say which.
      const tileNames = sameDay.length > 2 ? this._t("waste_count").replace("{n}", String(sameDay.length)) : names;
      body = html`
        <div class="c-top">${icon}${ackButton}</div>
        <div class="c-bottom">
          <div class="c-big">${big}</div>
          <div class="c-sub">${shortDate ? `${tileNames} · ${shortDate}` : tileNames}</div>
        </div>
      `;
    } else {
      body = html`${icon}<span class="c-pill-label">${chip}</span>`;
    }

    return html`
      <ha-card class="compact-host ${layout}" style=${`${c.cssVars} border-radius: ${layout === "pill" ? "999px" : c.radius};`}>
        <div
          class="card-inner compact ${layout} ${urgency} ${glassCardClass(cfg.glass_background)} ${c.animate ? "" : "no-animations"}"
          style=${`border-radius: ${layout === "pill" ? "999px" : c.radius};${c.cardBackgroundCss ? ` background: ${c.cardBackgroundCss};` : ""}`}
          role="button"
          tabindex="0"
          aria-label=${label}
          aria-haspopup=${sameDay.length > 1 ? "listbox" : nothing}
          @click=${(e: Event) => open(e)}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              open(e);
            }
          }}
        >
          ${body}
        </div>
      </ha-card>
    `;
  }

  private _renderTimeline(known: WasteStream[], timelineDays: number): unknown {
    // Group appointments by clamped day so same-day dots offset horizontally.
    const byDay = new Map<number, WasteStream[]>();
    for (const s of known) {
      const d = Math.max(0, Math.min(timelineDays, s.daysTo!));
      byDay.set(d, [...(byDay.get(d) ?? []), s]);
    }
    const dots: unknown[] = [];
    for (const [day, list] of byDay) {
      const pct = (day / timelineDays) * 100;
      list.forEach((s, i) => {
        dots.push(
          html`<div
            class="tl-dot"
            style=${`left: calc(${pct}% + ${(
              WASTE_TIMELINE_DOT_PX / 2 -
              (pct / 100) * WASTE_TIMELINE_DOT_PX
            ).toFixed(2)}px); background: ${s.color}; transform: translate(calc(-50% + ${i * 10}px), -50%);`}
          ></div>`,
        );
      });
    }
    return html`
      <div class="timeline-block">
        <div class="tl-label">${this._t("waste_timeline_label")}</div>
        <div class="tl-track">
          <div class="tl-line"></div>
          ${dots}
        </div>
        <div class="tl-axis">
          <span>${this._t("waste_today_short")}</span>
          <span>+${Math.round(timelineDays / 2)}</span>
          <span>+${timelineDays}</span>
        </div>
      </div>
    `;
  }

  private _renderRow(s: WasteStream, next?: WasteStream): unknown {
    const unknown = s.daysTo === undefined;
    const isNext = !!next && s.entity === next.entity && s.daysTo === next.daysTo;
    let sub: string;
    if (unknown) sub = this._t("waste_unknown");
    else if (s.daysTo! > 7 && s.date) sub = `${this._weekday(s.date)}, ${this._shortDate(s.date)}`;
    else if (s.date) sub = this._weekday(s.date);
    else sub = "";
    const right = unknown ? this._t("waste_unknown") : this._daysRow(s.daysTo!);
    // Row background, icon well and their ink all come from one calculation, so
    // the text is measured against the surface it actually sits on.
    const rowBgCss = tintOn(
      this,
      isNext ? s.color : "var(--primary-text-color)",
      undefined,
      isNext ? 8 : 5,
    );
    const iconBgCss = tintOn(this, unknown ? "var(--primary-text-color)" : s.color, undefined, 14);
    const rowInkCss = unknown ? "var(--m3p-secondary-text)" : foregroundOn(s.color, rowBgCss, 4.5);
    const iconInkCss = unknown ? "var(--m3p-secondary-text)" : foregroundOn(s.color, iconBgCss);
    return html`
      <div
        class="waste-row ${isNext ? "next" : ""} ${unknown ? "unknown" : ""}"
        style=${`--row-color: ${s.color}; --row-bg: ${rowBgCss};`}
        role="button"
        tabindex="0"
        @click=${() => this._moreInfo(s.entity)}
      >
        <div class="row-icon" style=${`background: ${iconWell(iconBgCss)}; color: ${iconInkCss};`}>
          ${this._glyph(s)}
        </div>
        <div class="row-text">
          <div class="row-name">${s.name}</div>
          <div class="row-sub">${sub}</div>
        </div>
        <div class="row-days" style=${`color: ${rowInkCss};`}>${right}</div>
      </div>
    `;
  }

  static styles = [
    glassCardStyles,
    css`
      /* The integration's picture fills the icon well, round or squircle. */
      .waste-pic {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: inherit;
        display: block;
      }

      .card-inner.escalate {
        background: color-mix(in srgb, var(--waste-accent) 7%, var(--ha-card-background, var(--card-background-color)));
        border-color: color-mix(in srgb, var(--waste-accent) 30%, var(--ha-card-background, var(--card-background-color)));
      }

      .hero {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 13px;
        border-radius: 20px;
        background: color-mix(in srgb, var(--waste-accent) 9%, var(--ha-card-background, var(--card-background-color)));
      }
      .hero.escalate {
        background: color-mix(in srgb, var(--waste-accent) 20%, var(--ha-card-background, var(--card-background-color)));
      }
      .hero-icon {
        flex-shrink: 0;
        width: 56px;
        height: 56px;
        border-radius: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .hero-icon ha-icon {
        --mdc-icon-size: 28px;
      }
      .hero.escalate .hero-icon {
        animation: waste-pulse 2s ease-in-out infinite;
      }
      @keyframes waste-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.62; }
      }
      .no-animations .hero-icon {
        animation: none !important;
      }
      .hero-multi {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        width: 56px;
        height: 56px;
      }
      .hero-multi .mini {
        width: 26px;
        height: 26px;
        border-radius: 9px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .hero-multi .mini ha-icon {
        --mdc-icon-size: 16px;
      }
      .hero-text {
        flex: 1;
        min-width: 0;
      }
      .hero-label {
        font-size: 12px;
        opacity: 0.7;
        color: var(--m3p-secondary-text);
      }
      .hero-main {
        font-size: 21px;
        font-weight: 700;
        color: var(--waste-accent-fg, var(--waste-accent));
        line-height: 1.15;
      }
      .hero-main.big {
        font-size: 23px;
      }
      .hero-sub {
        font-size: 13px;
        color: var(--m3p-text);
        opacity: 0.85;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .count-chip {
        flex-shrink: 0;
        height: 28px;
        border-radius: 14px;
        padding: 0 10px;
        display: flex;
        align-items: center;
        font-size: 12px;
        font-weight: 600;
        background: color-mix(in srgb, var(--primary-text-color) 10%, var(--ha-card-background, var(--card-background-color)));
        color: var(--m3p-secondary-text);
      }
      .ack-btn {
        flex-shrink: 0;
        width: 46px;
        height: 46px;
        border: none;
        border-radius: 23px;
        cursor: pointer;
        background: color-mix(in srgb, var(--primary-text-color) 12%, var(--ha-card-background, var(--card-background-color)));
        color: var(--m3p-text);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: border-radius 0.3s ease, background 0.3s ease;
      }
      .ack-btn.done {
        background: #81c784;
        color: #14201b;
        border-radius: 15px;
      }

      .timeline-block {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .tl-label {
        font-size: 12px;
        opacity: 0.6;
        color: var(--m3p-secondary-text);
      }
      .tl-track {
        position: relative;
        height: 20px;
      }
      .tl-line {
        position: absolute;
        top: 50%;
        left: 0;
        right: 0;
        height: 3px;
        transform: translateY(-50%);
        border-radius: 2px;
        background: color-mix(in srgb, var(--primary-text-color) 12%, var(--ha-card-background, var(--card-background-color)));
      }
      .tl-dot {
        position: absolute;
        top: 50%;
        width: ${unsafeCSS(WASTE_TIMELINE_DOT_PX)}px;
        height: ${unsafeCSS(WASTE_TIMELINE_DOT_PX)}px;
        border-radius: 5px;
      }
      .tl-axis {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        opacity: 0.5;
        color: var(--m3p-secondary-text);
      }

      .row-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .waste-row {
        min-height: 56px;
        border-radius: 18px;
        padding: 8px 12px;
        display: flex;
        align-items: center;
        gap: 12px;
        cursor: pointer;
        background: var(--row-bg);
      }
      .waste-row.unknown {
        opacity: 0.55;
      }
      .row-icon {
        flex-shrink: 0;
        width: 32px;
        height: 32px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .row-icon ha-icon {
        --mdc-icon-size: 18px;
      }
      .row-text {
        flex: 1;
        min-width: 0;
      }
      .row-name {
        font-size: 14px;
        font-weight: 700;
        color: var(--m3p-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .row-sub {
        font-size: 11px;
        opacity: 0.6;
        color: var(--m3p-secondary-text);
      }
      .row-days {
        flex-shrink: 0;
        font-size: 15px;
        font-weight: 700;
      }
      .collapse-toggle {
        width: 100%;
        height: 44px;
        border: none;
        border-radius: 14px;
        cursor: pointer;
        background: color-mix(in srgb, var(--primary-text-color) 6%, var(--ha-card-background, var(--card-background-color)));
        color: var(--m3p-secondary-text);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-size: 13px;
      }
      .collapse-toggle .chevron {
        transition: transform 0.2s ease;
      }
      .collapse-toggle .chevron.open {
        transform: rotate(180deg);
      }

      /* ---- compact layouts ---- */
      .card-inner.compact {
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      .card-inner.compact.tomorrow {
        background: color-mix(in srgb, var(--waste-accent) 9%, var(--ha-card-background, var(--card-background-color)));
      }
      .card-inner.compact.today {
        background: color-mix(in srgb, var(--waste-accent) 16%, var(--ha-card-background, var(--card-background-color)));
        border-color: color-mix(in srgb, var(--waste-accent) 32%, var(--ha-card-background, var(--card-background-color)));
      }
      .card-inner.compact:focus-visible {
        outline: 2px solid var(--primary-color);
        outline-offset: -2px;
      }
      .c-icon {
        flex-shrink: 0;
        width: ${unsafeCSS(WASTE_COMPACT_ICON_PX)}px;
        height: ${unsafeCSS(WASTE_COMPACT_ICON_PX)}px;
        border-radius: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .c-icon ha-icon {
        --mdc-icon-size: 24px;
      }
      .c-icons {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        height: ${unsafeCSS(WASTE_COMPACT_ICON_PX)}px;
      }
      .c-mini {
        width: 30px;
        height: 30px;
        border-radius: 11px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 0 0 2px var(--ha-card-background, var(--card-background-color));
      }
      .c-mini + .c-mini {
        margin-left: -9px;
      }
      .c-mini ha-icon {
        --mdc-icon-size: 17px;
      }
      .c-text {
        flex: 1;
        min-width: 0;
      }
      .c-name {
        font-size: 16px;
        font-weight: 700;
        color: var(--m3p-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .c-sub {
        font-size: 13px;
        color: var(--m3p-secondary-text);
        opacity: 0.8;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .c-chip {
        flex-shrink: 0;
        height: 34px;
        padding: 0 14px;
        border-radius: 17px;
        display: flex;
        align-items: center;
        font-size: 14px;
        font-weight: 700;
        white-space: nowrap;
        color: var(--m3p-text);
        background: color-mix(in srgb, var(--primary-text-color) 9%, var(--ha-card-background, var(--card-background-color)));
      }
      .c-ack {
        flex-shrink: 0;
        width: 40px;
        height: 40px;
        border: none;
        border-radius: 20px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        background: color-mix(in srgb, var(--primary-text-color) 12%, var(--ha-card-background, var(--card-background-color)));
        color: var(--m3p-text);
        transition: border-radius 0.3s ease, background 0.3s ease;
      }
      .c-ack.done {
        background: #81c784;
        color: #1c1c1c;
        border-radius: 13px;
      }

      .card-inner.compact.row {
        flex-direction: row;
        align-items: center;
        gap: 14px;
      }

      .card-inner.compact.tile {
        min-height: ${unsafeCSS(WASTE_TILE_MIN_HEIGHT_PX)}px;
        justify-content: space-between;
      }
      .c-top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
      }
      .c-big {
        display: flex;
        align-items: baseline;
        gap: 6px;
        color: var(--m3p-text);
        line-height: 1.05;
      }
      .card-inner.compact.tile.tomorrow .c-big,
      .card-inner.compact.tile.today .c-big {
        color: var(--waste-accent-fg, var(--waste-accent));
      }
      .c-num {
        font-size: 40px;
        font-weight: 700;
        letter-spacing: -0.02em;
      }
      .c-unit {
        font-size: 18px;
        font-weight: 600;
      }
      .c-word {
        font-size: 28px;
        font-weight: 700;
      }

      ha-card.compact-host.pill {
        width: fit-content;
        max-width: 100%;
      }
      .card-inner.compact.pill {
        flex-direction: row;
        align-items: center;
        gap: 10px;
        padding: 6px 18px 6px 6px;
      }
      .card-inner.compact.pill .c-icon {
        width: 36px;
        height: 36px;
        border-radius: 18px;
      }
      .card-inner.compact.pill .c-icon ha-icon {
        --mdc-icon-size: 20px;
      }
      .card-inner.compact.pill .c-mini {
        width: 26px;
        height: 26px;
        border-radius: 13px;
      }
      .c-pill-label {
        font-size: 15px;
        font-weight: 700;
        white-space: nowrap;
        color: var(--m3p-text);
      }
      .card-inner.compact.pill.tomorrow .c-pill-label,
      .card-inner.compact.pill.today .c-pill-label {
        color: var(--waste-accent-fg, var(--waste-accent));
      }

      /* Safari gained color-mix() in 16.2, and an iPod touch 7 or an iPad Air 2
         stops at iOS 15. A plain declaration before each mix cannot serve as the
         fallback: every one of them contains var(), which defers the check until
         after substitution, where failure yields unset rather than the previous
         declaration — the tint did not fade, the fill disappeared entirely. This
         block is the one those browsers alone can see; the tint is what it gives
         up. Backticks are not allowed in here: this is a css template literal. */
      @supports not (color: color-mix(in srgb, red 50%, blue)) {
        .card-inner.escalate {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .hero {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .hero.escalate {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .count-chip {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .ack-btn {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .tl-line {
          background: var(--ha-card-background, var(--card-background-color));
        }
        .collapse-toggle {
          background: var(--ha-card-background, var(--card-background-color));
        }
      }
      `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-waste-card": M3WasteCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-waste-card",
  name: "M3 Waste Card",
  description:
    "Eine Material-3-Karte für Abfuhrtermine mit Hero, Zwei-Wochen-Zeitleiste und optionalem Erinnerungs-Modus mit Rausstell-Quittierung.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
