import { LitElement, html, css, nothing, unsafeCSS, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HaActionConfig, HomeAssistant, LovelaceCard, LovelaceGridOptions, M3CheckinCardConfig } from "./types";
import {
  CHECKIN_BUTTON_HEIGHT,
  CHECKIN_BUTTON_RADIUS,
  CHECKIN_BUTTON_RADIUS_PRESSED,
  CHECKIN_COLOR_CHECKOUT,
  CHECKIN_COLOR_IN,
  CHECKIN_COLOR_OFF,
  CHECKIN_DOT_SIZE,
  CHECKIN_NARROW_PX,
  CHECKIN_OPTIMISTIC_MS,
  CHECKIN_PULSE_MS,
  CHECKIN_RUNNING_SIZE,
  CHECKIN_SEGMENT_HEIGHT,
  CHECKIN_SEGMENT_PAD,
  CHECKIN_SEGMENT_RADIUS,
  CHECKIN_SEGMENT_RADIUS_OFF,
  CHECKIN_SEGMENT_RADIUS_ON,
  CHECKIN_SEGMENT_RADIUS_PRESSED,
  CHECKIN_SWIPE_HANDLE,
  CHECKIN_SWIPE_HANDLE_RADIUS_HELD,
  CHECKIN_SWIPE_HEIGHT,
  CHECKIN_SWIPE_NUDGE_PX,
  CHECKIN_SWIPE_PAD,
  CHECKIN_SWIPE_SPRING_EASING,
  CHECKIN_SWIPE_SPRING_MS,
  CHECKIN_TINT_IN,
  CHECKIN_TINT_OUT,
  CHECKIN_TRANSITION_MS,
  DEFAULT_CHECKIN_ICON,
  DEFAULT_CHECKIN_ICON_IN,
  DEFAULT_CHECKIN_ICON_OFF,
  DEFAULT_CHECKIN_ICON_OUT,
  DEFAULT_CHECKIN_RADIUS,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import { STANDARD_EASING, shouldAnimate } from "./shared/animation";
import { buildCssVars, foregroundColor, foregroundOn, inkOn, resolveCommonColors, resolveThemeColor, tintOn } from "./shared/color-config";
import { glassBackground, glassCardClass, glassCardStyles, renderMissingEntity } from "./shared/glass-card";
import { cardHeaderStyles, renderCardHeader } from "./shared/card-header";
import { hassChangeMatters } from "./shared/should-update";
import { runHaAction } from "./shared/actions";
import { openEntityDetail } from "./shared/entity-detail";
import { TemplatedCard } from "./shared/templated-card";
import { VisibleTicker } from "./shared/visible-ticker";
import {
  checkinAction,
  checkinSince,
  checkinState,
  durationParts,
  fillStatus,
  runningTime,
  swipeProgress,
  SWIPE_THRESHOLD,
  type CheckinState,
} from "./shared/checkin";

const EASING = unsafeCSS(STANDARD_EASING);
const SPRING = unsafeCSS(CHECKIN_SWIPE_SPRING_EASING);

/** A drag in progress on the swipe handle. */
interface SwipeDrag {
  pointerId: number;
  startX: number;
  /** How far the handle can travel, in px. */
  travel: number;
  progress: number;
  moved: boolean;
}

/**
 * Check-in / check-out as one element that shows the state and switches it.
 *
 * Two buttons, "check in" and "check out", say nothing about which is true —
 * and a subtitle "on" under one of them reads as if that button were on. Here
 * the card says which, colours itself by it, and the control names states
 * ("Checked in"), never verbs. The three styles share everything but the
 * control: `segmented` (the default) offers the two states side by side;
 * `status` leads with how long, and one button that names the action — the
 * only place a verb is right, because pressing it does exactly that;
 * `swipe` asks for a deliberate slide, for a phone in a pocket or a tablet
 * by the door that should not switch on a brush of the hand.
 */
@customElement("m3-checkin-card")
export class M3CheckinCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config?: M3CheckinCardConfig;
  /** The state a tap asked for, shown until Home Assistant agrees or the wait runs out. */
  @state() private _pending?: "in" | "out";
  @state() private _unconfirmed = false;
  @state() private _now = Date.now();
  @state() private _drag?: SwipeDrag;
  /** Let go short of the threshold: the way back springs, the way on does not. */
  @state() private _spring = false;
  @state() private _nudge = false;
  private _nudgeTimer?: number;
  private _pendingTimer?: number;
  private readonly _ticker = new VisibleTicker(this, (now) => {
    this._now = now;
  });

  public static getStubConfig(hass: HomeAssistant): M3CheckinCardConfig {
    const booleans = Object.keys(hass?.states ?? {}).filter((e) => e.startsWith("input_boolean."));
    const entity = booleans.find((e) => /check|anwesen|presence/i.test(e)) ?? booleans[0] ?? "";
    return { type: "custom:m3-checkin-card", entity, style: "segmented" };
  }

  public setConfig(config: M3CheckinCardConfig): void {
    if (!config?.entity) throw new Error("m3-checkin-card: 'entity' is required");
    this._config = { glass_background: true, animation: "auto", ...config };
    // The status style's running time moves off the clock's minute; ten
    // seconds keeps it close. The others only show minutes in a subtitle.
    this._ticker.setCadence(this._style === "status" ? "ten-seconds" : "minute");
  }

  private get _style(): "segmented" | "status" | "swipe" {
    const style = this._config?.style;
    return style === "status" || style === "swipe" ? style : "segmented";
  }

  public getCardSize(): number {
    return 2;
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
    window.clearTimeout(this._pendingTimer);
    window.clearTimeout(this._nudgeTimer);
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    if (changed.size > 1 || !changed.has("hass")) return true;
    return hassChangeMatters(changed, this.hass, [this._config?.entity, this._config?.since_entity]);
  }

  protected willUpdate(changed: PropertyValues): void {
    // Home Assistant has caught up — or changed its mind from elsewhere (an
    // automation, a second phone). Either way the wait is over, quietly.
    if (changed.has("hass") && this._pending && this._actual !== "unavailable") {
      if (this._actual === this._pending || this._actualChangedSincePending) this._settle();
    }
  }

  private _pendingSince = 0;

  private get _actualChangedSincePending(): boolean {
    const changed = this._entity?.last_changed ? Date.parse(this._entity.last_changed) : 0;
    return changed > this._pendingSince;
  }

  private _settle(): void {
    window.clearTimeout(this._pendingTimer);
    this._pending = undefined;
  }

  private get _entity() {
    return this._config ? this.hass?.states[this._config.entity] : undefined;
  }

  private get _actual(): CheckinState {
    return this._config ? checkinState(this._config, this._entity) : "unavailable";
  }

  /** What the card shows: the asked-for state while a tap is pending. */
  private get _shown(): CheckinState {
    return this._pending ?? this._actual;
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  // ---- actions --------------------------------------------------------------

  private _choose(target: "in" | "out"): void {
    const cfg = this._config;
    if (!cfg || !this.hass || this._shown === target || this._shown === "unavailable") return;
    const action = checkinAction(cfg, target);
    if (!action) return;
    // Optimistic: the control moves at once, and goes back if Home Assistant
    // has not agreed within the timeout — with a word saying so, rather than
    // a silent jump the person may not even see.
    this._pending = target;
    this._pendingSince = Date.now();
    this._unconfirmed = false;
    window.clearTimeout(this._pendingTimer);
    this._pendingTimer = window.setTimeout(() => {
      if (this._pending && this._actual !== this._pending) this._unconfirmed = true;
      this._pending = undefined;
    }, cfg.optimistic_timeout ?? CHECKIN_OPTIMISTIC_MS);
    this._run(action);
  }

  private _run(action: HaActionConfig): void {
    if (!this.hass) return;
    runHaAction(this.hass, action, {
      source: this,
      entityId: this._config?.entity,
      fireMoreInfo: (id) => openEntityDetail(this, id),
      navigate: (path) => {
        window.history.pushState(null, "", path);
        this.dispatchEvent(new CustomEvent("location-changed", { bubbles: true, composed: true, detail: { replace: false } }));
      },
    });
  }

  // ---- reading --------------------------------------------------------------

  private _duration(since: number): string {
    const { h, m } = durationParts(since, this._now);
    if (h === 0 && m === 0) return "";
    return h > 0
      ? this._t("checkin_hm").replace("{h}", String(h)).replace("{m}", String(m))
      : this._t("checkin_m").replace("{m}", String(m));
  }

  private get _since(): number | undefined {
    const cfg = this._config!;
    return checkinSince(this._entity, cfg.since_entity ? this.hass?.states[cfg.since_entity] : undefined, this._now);
  }

  /** "14:02" today, "Sat 14:02" within the week, a date beyond. */
  private _clock(at: number): string {
    const lang = this._language;
    const time = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(at);
    const day = new Date(at);
    const today = new Date(this._now);
    if (day.toDateString() === today.toDateString()) return time;
    const days = (this._now - at) / 86_400_000;
    const date = new Intl.DateTimeFormat(lang, days < 6 ? { weekday: "short" } : { day: "numeric", month: "short" }).format(at);
    return `${date} ${time}`;
  }

  /** The status style's subtitle: since when, because the big figure says how long. */
  private _sinceLine(shown: CheckinState): string {
    if (shown === "unavailable") return this._t("appliance_unavailable");
    if (this._unconfirmed) return this._t("checkin_unconfirmed");
    const since = this._pending ? undefined : this._since;
    if (since === undefined) return this._t(shown === "in" ? "checkin_status_in_bare" : "checkin_status_out_bare");
    const key = shown === "in" ? "checkin_since_in" : "checkin_since_out";
    return this._t(key).replace("{time}", this._clock(since));
  }

  private _statusLine(shown: CheckinState): string {
    const cfg = this._config!;
    if (shown === "unavailable") return this._t("appliance_unavailable");
    if (this._unconfirmed) return this._t("checkin_unconfirmed");
    const since = this._pending ? undefined : this._since;
    const bare = this._t(shown === "in" ? "checkin_status_in_bare" : "checkin_status_out_bare");
    if (since === undefined) return bare;
    const duration = this._duration(since);
    if (!duration) return `${bare} · ${this._t("checkin_just_now")}`;
    const time = new Intl.DateTimeFormat(this._language, { hour: "2-digit", minute: "2-digit" }).format(since);
    const template = shown === "in" ? (cfg.status_in ?? this._t("checkin_status_in")) : (cfg.status_out ?? this._t("checkin_status_out"));
    return fillStatus(template, duration, time);
  }

  // ---- render ---------------------------------------------------------------

  protected render() {
    const cfg = this._config;
    if (!cfg || !this.hass) return nothing;
    if (!this._entity) return renderMissingEntity(cfg.entity);

    const shown = this._shown;
    const checkedIn = shown === "in";
    const unavailable = shown === "unavailable";
    const colorIn = resolveThemeColor(cfg.color ?? CHECKIN_COLOR_IN);
    const colorOff = resolveThemeColor(cfg.color_off ?? CHECKIN_COLOR_OFF);
    const tone = checkedIn ? colorIn : colorOff;
    const { textColorCss, secondaryTextColorCss } = resolveCommonColors(cfg);
    const iconBg = tintOn(this, tone, undefined, checkedIn ? 20 : 12);
    const radius = cfg.radius ?? DEFAULT_CHECKIN_RADIUS;
    const name =
      cfg.name ?? (this._entity.attributes?.friendly_name as string | undefined) ?? this._t("checkin_default_name");
    const canSwitch = !!checkinAction(cfg, "in") && !unavailable;
    const status = this._style === "status";

    const vars = buildCssVars({
      "ci-tone": tone,
      "ci-tint": `${checkedIn ? CHECKIN_TINT_IN : CHECKIN_TINT_OUT}%`,
      "ci-status": checkedIn ? foregroundOn(colorIn, iconBg, 4.5, this) : "var(--m3p-secondary-text)",
      "ci-on": colorIn,
      "ci-on-ink": inkOn(colorIn, this),
      "ci-running": checkedIn ? foregroundColor(this, colorIn, 3) : "var(--m3p-text, var(--primary-text-color))",
      "m3p-icon-bg": iconBg,
      "m3p-icon-color": checkedIn ? foregroundOn(colorIn, iconBg, 3, this) : colorOff,
      "m3p-text": textColorCss,
      "m3p-secondary-text": secondaryTextColorCss,
    });

    return html`
      <ha-card style=${`${vars} border-radius: ${radius}px;`}>
        <div
          class="card-inner ${glassCardClass(cfg.glass_background)} ${checkedIn ? "in" : "out"} style-${this._style} ${
            unavailable ? "unavailable" : ""
          } ${shouldAnimate(cfg.animation) ? "" : "no-animations"}"
          style=${`border-radius: ${radius}px;`}
        >
          ${renderCardHeader({
            icon: checkedIn ? (cfg.icon ?? DEFAULT_CHECKIN_ICON) : (cfg.icon_off ?? DEFAULT_CHECKIN_ICON_OFF),
            name,
            subtitle: status ? this._sinceLine(shown) : this._statusLine(shown),
            onClick: (e: Event) => {
              e.stopPropagation();
              this._run(cfg.tap_action ?? { action: "more-info" });
            },
          })}
          ${status
            ? this._renderStatus(shown, canSwitch)
            : this._style === "swipe"
              ? this._renderSwipe(checkedIn, canSwitch)
              : this._renderSegmented(checkedIn, canSwitch)}
        </div>
      </ha-card>
    `;
  }

  /**
   * How long, large, and one button that does the other thing. Checking in
   * is filled with the accent, the colour the card is about to take; checking
   * out is tonal and quiet, as the checked-out card will be.
   */
  private _renderStatus(shown: CheckinState, canSwitch: boolean) {
    const cfg = this._config!;
    // While a tap is pending the new state has just begun: 0, not the old
    // state's figure, and not an empty row that would make the card jump.
    const since = this._pending ? this._now : this._since;
    const running = since !== undefined && shown !== "unavailable" ? runningTime(since, this._now) : undefined;
    const target: "in" | "out" = shown === "in" ? "out" : "in";
    const hasAction = !!checkinAction(cfg, target);
    const label =
      target === "in"
        ? (cfg.button_label_in ?? this._t("checkin_action_in"))
        : (cfg.button_label_out ?? this._t("checkin_action_out"));
    const icon = target === "in" ? (cfg.icon_in ?? DEFAULT_CHECKIN_ICON_IN) : (cfg.icon_out ?? DEFAULT_CHECKIN_ICON_OUT);
    return html`
      ${running
        ? html`<div class="running" aria-live="off">
            <span class="running-value">${running.value}</span
            ><span class="running-unit">${this._t(`checkin_unit_${running.unit}` as TranslationKey)}</span>
          </div>`
        : nothing}
      ${hasAction
        ? html`<button
            class="action to-${target}"
            ?disabled=${!canSwitch}
            @click=${(e: Event) => {
              e.stopPropagation();
              this._choose(target);
            }}
          >
            <ha-icon icon=${icon}></ha-icon><span class="action-label">${label}</span>
          </button>`
        : nothing}
    `;
  }

  // ---- swipe ----------------------------------------------------------------

  /**
   * A track with a handle to slide across it: right to check in, left to
   * check out. Past three quarters it counts; short of that it springs back.
   * Under reduced motion there is nothing to slide — a tap does it.
   */
  private _renderSwipe(checkedIn: boolean, canSwitch: boolean) {
    const cfg = this._config!;
    const target: "in" | "out" = checkedIn ? "out" : "in";
    if (!checkinAction(cfg, target)) return nothing;
    const plainTap = !shouldAnimate(cfg.animation);
    const drag = this._drag;
    const progress = drag?.progress ?? 0;
    const label =
      target === "in"
        ? (cfg.swipe_label_in ?? this._t("checkin_swipe_in"))
        : (cfg.swipe_label_out ?? this._t("checkin_swipe_out"));
    const icon =
      target === "in"
        ? (cfg.icon_in ?? "mdi:chevron-double-right")
        : (cfg.icon_out ?? "mdi:chevron-double-left");
    const targetColor =
      target === "in"
        ? resolveThemeColor(cfg.color ?? CHECKIN_COLOR_IN)
        : resolveThemeColor(cfg.color_checkout ?? CHECKIN_COLOR_CHECKOUT);
    // While held the handle follows the finger; let go, the class puts it at
    // its end and the transition carries it there.
    const offset = drag ? (checkedIn ? drag.travel * (1 - progress) : drag.travel * progress) : undefined;
    const handleStyle = `${offset !== undefined ? `left: ${CHECKIN_SWIPE_PAD + offset}px;` : ""} background: ${targetColor}; color: ${inkOn(targetColor, this)};`;
    return html`
      <div
        class="swipe ${checkedIn ? "from-in" : "from-out"} ${drag ? "dragging" : ""} ${this._spring ? "spring" : ""} ${
          this._nudge ? "nudge" : ""
        } ${plainTap ? "plain" : ""}"
        role="switch"
        tabindex=${canSwitch ? "0" : "-1"}
        aria-checked=${String(checkedIn)}
        aria-disabled=${String(!canSwitch)}
        aria-label=${label}
        style=${`--p: ${progress}; --ci-target: ${targetColor};`}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key !== " " && e.key !== "Enter") return;
          e.preventDefault();
          if (canSwitch) this._choose(target);
        }}
        @click=${(e: Event) => {
          e.stopPropagation();
          if (plainTap && canSwitch) this._choose(target);
        }}
      >
        <span class="swipe-label">${label}</span>
        <div
          class="swipe-handle"
          style=${handleStyle}
          @pointerdown=${(e: PointerEvent) => this._dragStart(e, canSwitch && !plainTap)}
          @pointermove=${(e: PointerEvent) => this._dragMove(e, checkedIn)}
          @pointerup=${(e: PointerEvent) => this._dragEnd(e, target)}
          @pointercancel=${(e: PointerEvent) => this._dragEnd(e, undefined)}
        >
          <ha-icon icon=${icon}></ha-icon>
        </div>
      </div>
    `;
  }

  private _dragStart(e: PointerEvent, allowed: boolean): void {
    if (!allowed || this._drag) return;
    const handle = e.currentTarget as HTMLElement;
    const track = handle.parentElement;
    if (!track) return;
    e.preventDefault();
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // A pointer the browser no longer knows; the drag still works while
      // the finger stays on the handle.
    }
    this._spring = false;
    this._drag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      travel: track.clientWidth - 2 * CHECKIN_SWIPE_PAD - CHECKIN_SWIPE_HANDLE,
      progress: 0,
      moved: false,
    };
  }

  private _dragMove(e: PointerEvent, checkedIn: boolean): void {
    const drag = this._drag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    const progress = swipeProgress(dx, drag.travel, checkedIn);
    if (progress === drag.progress && drag.moved) return;
    this._drag = { ...drag, progress, moved: drag.moved || Math.abs(dx) > 4 };
  }

  /** `target` undefined: the gesture was cancelled, never a switch. */
  private _dragEnd(e: PointerEvent, target: "in" | "out" | undefined): void {
    const drag = this._drag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    this._drag = undefined;
    if (target && drag.progress >= SWIPE_THRESHOLD) {
      this._spring = false;
      this._choose(target);
      return;
    }
    this._spring = true;
    // A tap, not a slide: nudge the handle the way it goes, so the gesture
    // explains itself instead of the card seeming dead.
    if (target && !drag.moved) {
      this._nudge = true;
      window.clearTimeout(this._nudgeTimer);
      this._nudgeTimer = window.setTimeout(() => (this._nudge = false), 180);
    }
  }

  /** Two halves that name the two states; the active one is filled and squarer. */
  private _renderSegmented(checkedIn: boolean, canSwitch: boolean) {
    const cfg = this._config!;
    const half = (target: "in" | "out", label: string, icon: string) => {
      const active = (target === "in") === checkedIn;
      return html`
        <button
          class="seg ${active ? "active" : ""}"
          role="radio"
          aria-checked=${String(active)}
          aria-label=${label}
          ?disabled=${!canSwitch}
          @click=${(e: Event) => {
            e.stopPropagation();
            if (!active) this._choose(target);
          }}
        >
          <ha-icon icon=${icon}></ha-icon><span class="seg-label">${label}</span>
        </button>
      `;
    };
    return html`
      <div class="segmented" role="radiogroup" aria-label=${cfg.name ?? this._t("checkin_default_name")}>
        ${half("in", cfg.label_in ?? this._t("checkin_label_in"), cfg.icon_in ?? DEFAULT_CHECKIN_ICON_IN)}
        ${half("out", cfg.label_out ?? this._t("checkin_label_out"), cfg.icon_out ?? DEFAULT_CHECKIN_ICON_OUT)}
      </div>
    `;
  }

  static styles = [
    glassCardStyles,
    cardHeaderStyles,
    css`
      ha-card {
        color: var(--m3p-text, var(--primary-text-color));
      }

      .card-inner {
        display: flex;
        flex-direction: column;
        gap: var(--m3-card-gap, 12px);
        container-type: inline-size;
        transition:
          background-color ${CHECKIN_TRANSITION_MS}ms ${EASING},
          border-color ${CHECKIN_TRANSITION_MS}ms ${EASING},
          opacity ${CHECKIN_TRANSITION_MS}ms ${EASING};
      }

      /* The whole card takes the state's colour as a tint over the glass —
         stronger while checked in, faint while out, so out reads as quiet
         rather than as something wrong. The rim stays the suite's own, as on
         every card beside it. */
      .card-inner.glass,
      .card-inner {
        background-color: color-mix(in srgb, var(--ci-tone) var(--ci-tint), ${glassBackground});
      }

      .card-inner.unavailable {
        opacity: 0.4;
      }

      .m3-subtitle {
        color: var(--ci-status);
        transition: color ${CHECKIN_TRANSITION_MS}ms ${EASING};
      }

      .m3-icon-swatch {
        transition:
          background ${CHECKIN_TRANSITION_MS}ms ${EASING},
          color ${CHECKIN_TRANSITION_MS}ms ${EASING};
      }

      .card-inner.out .m3-icon-swatch ha-icon {
        opacity: 0.6;
      }

      /* ---- segmented ---- */
      .segmented {
        display: flex;
        gap: 4px;
        padding: ${CHECKIN_SEGMENT_PAD}px;
        border-radius: ${CHECKIN_SEGMENT_RADIUS}px;
        background: color-mix(in srgb, var(--m3p-text, var(--primary-text-color)) 7%, transparent);
      }

      .seg {
        flex: 1;
        min-width: 0;
        height: ${CHECKIN_SEGMENT_HEIGHT}px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        border: none;
        border-radius: ${CHECKIN_SEGMENT_RADIUS_OFF}px;
        background: transparent;
        color: var(--m3p-text, var(--primary-text-color));
        opacity: 0.6;
        font-family: inherit;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition:
          border-radius ${CHECKIN_TRANSITION_MS}ms ${EASING},
          background ${CHECKIN_TRANSITION_MS}ms ${EASING},
          color ${CHECKIN_TRANSITION_MS}ms ${EASING},
          opacity ${CHECKIN_TRANSITION_MS}ms ${EASING},
          font-weight ${CHECKIN_TRANSITION_MS}ms ${EASING};
      }

      .seg ha-icon {
        --mdc-icon-size: 17px;
        display: flex;
      }

      .seg-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Active: the state's colour, squarer, bold. Only checked in is filled
         with the accent; checked out fills with the neutral grey. */
      .seg.active {
        border-radius: ${CHECKIN_SEGMENT_RADIUS_ON}px;
        background: var(--ci-tone);
        color: var(--ci-on-ink);
        opacity: 1;
        font-weight: 700;
        cursor: default;
      }

      .card-inner.out .seg.active {
        color: #1c1c1c;
      }

      .seg:not(:disabled):active {
        border-radius: ${CHECKIN_SEGMENT_RADIUS_PRESSED}px;
      }

      .seg:disabled {
        cursor: default;
      }

      .seg:focus-visible {
        outline: 2px solid var(--ci-tone);
        outline-offset: 2px;
      }

      /* ---- status ---- */

      /* The live dot: on the header icon while checked in, breathing out a
         ring as a recording light does. Out has no dot at all. */
      .card-inner.style-status .m3-icon-swatch {
        position: relative;
      }

      .card-inner.style-status.in .m3-icon-swatch::after {
        content: "";
        position: absolute;
        top: -2px;
        right: -2px;
        width: ${CHECKIN_DOT_SIZE}px;
        height: ${CHECKIN_DOT_SIZE}px;
        border-radius: 50%;
        background: var(--ci-on);
        animation: ci-pulse ${CHECKIN_PULSE_MS}ms ${EASING} infinite;
      }

      @keyframes ci-pulse {
        0% {
          box-shadow: 0 0 0 0 color-mix(in srgb, var(--ci-on) 60%, transparent);
        }
        70%,
        100% {
          box-shadow: 0 0 0 8px color-mix(in srgb, var(--ci-on) 0%, transparent);
        }
      }

      .running {
        display: flex;
        align-items: baseline;
        gap: 6px;
        padding: 0 2px;
        color: var(--ci-running);
        transition: color ${CHECKIN_TRANSITION_MS}ms ${EASING};
      }

      .running-value {
        font-size: ${CHECKIN_RUNNING_SIZE}px;
        font-weight: 700;
        line-height: 1;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.01em;
      }

      .running-unit {
        font-size: 13px;
        font-weight: 600;
        opacity: 0.8;
      }

      .action {
        width: 100%;
        height: ${CHECKIN_BUTTON_HEIGHT}px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        border: none;
        border-radius: ${CHECKIN_BUTTON_RADIUS}px;
        font-family: inherit;
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
        transition:
          border-radius ${CHECKIN_TRANSITION_MS / 2}ms ${EASING},
          background ${CHECKIN_TRANSITION_MS}ms ${EASING},
          color ${CHECKIN_TRANSITION_MS}ms ${EASING};
      }

      .action.to-in {
        background: var(--ci-on);
        color: var(--ci-on-ink);
      }

      /* Checking out is the quieter act: tonal, in the text colour, so a
         checked-in card is not dominated by a grey slab. */
      .action.to-out {
        background: color-mix(in srgb, var(--m3p-text, var(--primary-text-color)) 10%, transparent);
        color: var(--m3p-text, var(--primary-text-color));
      }

      .action ha-icon {
        --mdc-icon-size: 20px;
        display: flex;
      }

      .action-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .action:not(:disabled):active {
        border-radius: ${CHECKIN_BUTTON_RADIUS_PRESSED}px;
      }

      .action:disabled {
        cursor: default;
        opacity: 0.5;
      }

      .action:focus-visible {
        outline: 2px solid var(--ci-tone);
        outline-offset: 2px;
      }

      /* ---- swipe ---- */
      .swipe {
        position: relative;
        height: ${CHECKIN_SWIPE_HEIGHT}px;
        border-radius: ${CHECKIN_SWIPE_HEIGHT / 2}px;
        background: color-mix(in srgb, var(--ci-target) calc(14% + var(--p) * 36%), transparent);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 ${CHECKIN_SWIPE_HANDLE + CHECKIN_SWIPE_PAD + 8}px;
        box-sizing: border-box;
        user-select: none;
        -webkit-user-select: none;
        transition: background ${CHECKIN_TRANSITION_MS}ms ${EASING};
      }

      .swipe.dragging {
        transition: none;
      }

      .swipe:focus-visible {
        outline: 2px solid var(--ci-target);
        outline-offset: 2px;
      }

      .swipe[aria-disabled="true"] {
        opacity: 0.5;
      }

      .swipe.plain:not([aria-disabled="true"]) {
        cursor: pointer;
      }

      .swipe-label {
        font-size: 14px;
        font-weight: 600;
        color: var(--m3p-text, var(--primary-text-color));
        opacity: calc(0.85 - var(--p) * 1.2);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        pointer-events: none;
      }

      .swipe-handle {
        position: absolute;
        top: ${CHECKIN_SWIPE_PAD}px;
        left: ${CHECKIN_SWIPE_PAD}px;
        width: ${CHECKIN_SWIPE_HANDLE}px;
        height: ${CHECKIN_SWIPE_HANDLE}px;
        border-radius: ${CHECKIN_SWIPE_HANDLE / 2}px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        /* Only the handle claims the touch: the rest of the track, and the
           card around it, still scroll the page. */
        touch-action: none;
        cursor: grab;
        transition:
          left ${CHECKIN_TRANSITION_MS}ms ${EASING},
          border-radius ${CHECKIN_TRANSITION_MS / 2}ms ${EASING},
          background ${CHECKIN_TRANSITION_MS}ms ${EASING},
          transform 180ms ${EASING};
      }

      .swipe.from-in .swipe-handle {
        left: calc(100% - ${CHECKIN_SWIPE_PAD + CHECKIN_SWIPE_HANDLE}px);
      }

      .swipe.spring .swipe-handle {
        transition:
          left ${CHECKIN_SWIPE_SPRING_MS}ms ${SPRING},
          border-radius ${CHECKIN_TRANSITION_MS / 2}ms ${EASING},
          background ${CHECKIN_TRANSITION_MS}ms ${EASING},
          transform 180ms ${EASING};
      }

      .swipe.dragging .swipe-handle {
        border-radius: ${CHECKIN_SWIPE_HANDLE_RADIUS_HELD}px;
        cursor: grabbing;
        transition: border-radius ${CHECKIN_TRANSITION_MS / 2}ms ${EASING};
      }

      .swipe.nudge.from-out .swipe-handle {
        transform: translateX(${CHECKIN_SWIPE_NUDGE_PX}px);
      }

      .swipe.nudge.from-in .swipe-handle {
        transform: translateX(-${CHECKIN_SWIPE_NUDGE_PX}px);
      }

      .swipe.plain .swipe-handle,
      .swipe[aria-disabled="true"] .swipe-handle {
        touch-action: manipulation;
        cursor: inherit;
      }

      .swipe-handle ha-icon {
        --mdc-icon-size: 22px;
        display: flex;
        pointer-events: none;
      }

      @container (max-width: ${CHECKIN_NARROW_PX}px) {
        .seg-label {
          display: none;
        }
      }

      .no-animations,
      .no-animations .seg,
      .no-animations .m3-subtitle,
      .no-animations .m3-icon-swatch,
      .no-animations .action,
      .no-animations .running,
      .no-animations .swipe,
      .no-animations .swipe-handle {
        transition: none;
      }

      .no-animations .m3-icon-swatch::after {
        animation: none;
      }

      @media (prefers-reduced-motion: reduce) {
        .card-inner,
        .seg,
        .action,
        .running,
        .swipe,
        .swipe-handle {
          transition: none;
        }

        .card-inner.style-status.in .m3-icon-swatch::after {
          animation: none;
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-checkin-card": M3CheckinCard;
  }
}

const windowWithCards = window as unknown as { customCards: Array<Record<string, unknown>> };
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-checkin-card",
  name: "M3 Check-in Card",
  description: "Check in and out with one element that shows the state and switches it — the card colours itself by it.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
