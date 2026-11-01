import {
  LitElement,
  html,
  css,
  nothing,
  svg,
  unsafeCSS,
  type PropertyValues,
  type SVGTemplateResult,
  type TemplateResult,
} from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  ApplianceBlock,
  ApplianceButtonConfig,
  ApplianceSelectConfig,
  ApplianceSliderConfig,
  HaActionConfig,
  HassEntity,
  HomeAssistant,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  M3ApplianceCardConfig,
  StatusRule,
  WaveStyle,
} from "./types";
import {
  APPLIANCE_BAR_HEIGHT,
  APPLIANCE_BAR_RADIUS,
  APPLIANCE_BAR_SVG_HEIGHT,
  APPLIANCE_WAVE_AMPLITUDE,
  APPLIANCE_WAVE_AMPLITUDE_LERP,
  APPLIANCE_WAVE_DOT_RADIUS,
  APPLIANCE_WAVE_GAP,
  APPLIANCE_WAVE_PHASE_SPEED,
  APPLIANCE_WAVE_WAVELENGTH,
  APPLIANCE_BUTTON_HEIGHT,
  APPLIANCE_BUTTON_RADIUS,
  APPLIANCE_BUTTON_RADIUS_ACTIVE,
  APPLIANCE_BUTTON_TINT,
  APPLIANCE_CAPTION_SIZE,
  APPLIANCE_DRAG_SETTLE_MS,
  APPLIANCE_HANDLE_HEIGHT,
  APPLIANCE_HANDLE_RADIUS,
  APPLIANCE_HANDLE_WIDTH,
  APPLIANCE_ICON_TINT,
  APPLIANCE_INDETERMINATE_FRACTION,
  APPLIANCE_INDETERMINATE_MS,
  APPLIANCE_LABEL_SIZE,
  APPLIANCE_NARROW_PX,
  APPLIANCE_OPTION_DROPDOWN_FROM,
  APPLIANCE_OPTION_HEIGHT,
  APPLIANCE_OPTION_RADIUS,
  APPLIANCE_OPTION_RADIUS_ACTIVE,
  APPLIANCE_OPTION_TINT,
  APPLIANCE_PALETTE,
  APPLIANCE_SLIDER_HEIGHT,
  APPLIANCE_SLIDER_THROTTLE_MS,
  APPLIANCE_SLIDER_TRACK,
  APPLIANCE_VALUE_SIZE,
  APPLIANCE_HERO_SIZE,
  APPLIANCE_UNAVAILABLE_GRACE_MS,
  APPLIANCE_DONE_SLACK_MIN,
  APPLIANCE_PILL_HEIGHT,
  APPLIANCE_PILL_RADIUS,
  APPLIANCE_FINISH_HEIGHT,
  APPLIANCE_FINISH_RADIUS,
  APPLIANCE_FINISH_RADIUS_ACTIVE,
  APPLIANCE_FINISH_TINT,
  APPLIANCE_RESIZE_MS,
  CARD_VERSION,
  DEFAULT_APPLIANCE_ACCENT,
  DEFAULT_DONE_STATES,
  DEFAULT_IDLE_STATES,
  DEFAULT_APPLIANCE_ICON,
  DEFAULT_APPLIANCE_RADIUS,
  resolveCornerRadius,
  NEW_CARD_ACCENT,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import { activateOnKey } from "./shared/a11y";
import { shouldAnimate, STANDARD_EASING } from "./shared/animation";
import { runHaAction, isActionable } from "./shared/actions";
import { DetailCardController } from "./shared/detail-card";
import {
  renderPopupDialog,
  syncDialogOpenState,
  shouldCloseOnBackdropClick,
  popupCardStyles,
  type PopupCardHandle,
} from "./shared/popup-card";
import {
  prettifyOption,
  prettifyState,
  endTimeOf,
  remainingMinutes,
  sinceParts,
  resolveSliderRange,
  snapToRange,
  splitDuration,
  visibleOptions,
  waveBarGeometry,
  waveSliderGeometry,
} from "./shared/appliance";
import { buildWavePath, lerpStep } from "./shared/wave";
import {
  buildCssVars,
  foregroundOn,
  inkOn,
  resolveCommonColors,
  resolveThemeColor,
  tintInk,
  tintOn,
} from "./shared/color-config";
import { DragThrottle } from "./shared/drag-throttle";
import {
  defaultEntityAction,
  isMissingState,
  isOnState,
  selectOptionDomain,
  setValueDomain,
} from "./shared/entity-actions";
import { formatNumber } from "./shared/formatting";
import { glassCardClass, glassCardStyles, renderMissingEntity } from "./shared/glass-card";
import { cardHeaderStyles, renderCardHeader } from "./shared/card-header";
import { foldHides, readCollapsed, writeCollapsed, type CollapseTarget } from "./shared/collapse-state";
import { detailsToggleStyles, easeFoldHeight, renderDetailsToggle } from "./shared/fold-arrow";
import { hassChangeMatters } from "./shared/should-update";
import { stopSwipe } from "./shared/swipe";
import { findStateRule, numericState } from "./shared/state-rules";
import { infoChipStyles, renderInfoChips } from "./shared/info-chips";
import { TemplatedCard } from "./shared/templated-card";
import { VisibleTicker } from "./shared/visible-ticker";
import { openEntityDetail } from "./shared/entity-detail";

console.info(
  `%c M3-APPLIANCE-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #85b7eb; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #85b7eb; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

const EASING = unsafeCSS(STANDARD_EASING);

/**
 * A run at 100 % with at most APPLIANCE_DONE_SLACK_MIN left is done. Not
 * "under a minute": a Home Connect dryer in its anti-crease phase sets its end
 * to now + 1 min every time it reconnects, which it does every few minutes, so
 * the card flipped between "1 min left" and "Done" all afternoon.
 */
function doneByProgress(progress: ProgressReading | undefined): boolean {
  return (
    !!progress &&
    !progress.indeterminate &&
    (progress.percent ?? 0) >= 100 &&
    (progress.remaining ?? 0) <= APPLIANCE_DONE_SLACK_MIN
  );
}

/** What the card shows: a run with its time, a finished machine, or one line. */
type AppliancePhase = "ready" | "running" | "done";

// Everything, in the order a person reads an appliance: what it is doing, how
// far along, what it is set to, what it offers, and the details at the bottom.
const DEFAULT_LAYOUT: ApplianceBlock[] = ["progress", "sliders", "selects", "buttons", "chips"];

/** Domains whose "on" is worth showing as a filled button. */
const TOGGLE_DOMAINS = new Set(["switch", "input_boolean", "light", "fan", "siren", "lock"]);

/**
 * Domains whose state says nothing about whether they can be pressed.
 *
 * A `button` entity reads `unknown` until the first time it is pressed, and a
 * timestamp afterwards. Treating `unknown` as missing would grey out a working
 * button forever — and every one of them on a fresh install. Only
 * `unavailable` means the integration is actually refusing it.
 */
const STATELESS_DOMAINS = new Set(["button", "input_button", "scene"]);

interface ProgressReading {
  percent?: number;
  remaining?: number;
  indeterminate: boolean;
}

@customElement("m3-appliance-card")
export class M3ApplianceCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3ApplianceCardConfig;
  @state() private _popupOpen = false;
  @state() private _folded = false;
  @state() private _popupCardEl?: HTMLElement & PopupCardHandle;

  private _popupOpenedAt = 0;
  private readonly _popupCard = new DetailCardController();
  @state() private _narrow = false;
  /** Only advances when doing so would change a shown minute — see `_onTick`. */
  @state() private _now = Date.now();
  /** The entity being dragged and the value the finger is on, before HA echoes it. */
  @state() private _drag?: { entity: string; value: number };

  /** Width of a block, so the wave SVGs can be laid out in real pixels. Every
   *  block is the same width, so one measurement serves the bar and every
   *  slider. */
  @state() private _blockWidth = 0;
  /** The machine's phase as last drawn, so a change of height can be eased. */
  private _machinePhase: AppliancePhase = "ready";
  private _heightBefore = 0;
  /** Travelling phase of the wave, in radians. */
  @state() private _phase = 0;
  /** Animated toward `_targetAmplitude`, so a wave settles flat instead of
   *  snapping when the appliance stops. */
  @state() private _displayAmplitude = 0;

  private _targetAmplitude = 0;
  private _phaseAnimating = false;
  private _rafId?: number;
  private _resizeObserver?: ResizeObserver;
  private _blockObserver?: ResizeObserver;
  private _dragEndTimer?: number;
  private readonly _throttles = new Map<string, DragThrottle<number>>();
  private readonly _ticker = new VisibleTicker(this, (now) => this._onTick(now));

  private get _waveStyle(): WaveStyle {
    return this._config?.wave_style ?? "wavy";
  }

  private get _reducedMotion(): boolean {
    return (
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    );
  }

  /**
   * Whether the wave should be drawn as a wave at all.
   *
   * `wave_style: flat` is a look, not an animation setting, so it flattens
   * regardless of `animation`. Reduced motion stops the travel but keeps the
   * shape — the wave is the component's identity, its movement is the
   * decoration.
   */
  private get _wavy(): boolean {
    return this._waveStyle === "wavy";
  }

  private _startWaveLoop(): void {
    if (this._rafId !== undefined) return;
    const tick = (): void => {
      this._rafId = undefined;
      if (this._phaseAnimating) this._phase -= APPLIANCE_WAVE_PHASE_SPEED;
      this._displayAmplitude = lerpStep(
        this._displayAmplitude,
        this._targetAmplitude,
        APPLIANCE_WAVE_AMPLITUDE_LERP,
      );
      const settled = Math.abs(this._displayAmplitude - this._targetAmplitude) < 0.01;
      if (settled) this._displayAmplitude = this._targetAmplitude;
      if (this._phaseAnimating || !settled) this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  private _stopWaveLoop(): void {
    if (this._rafId !== undefined) cancelAnimationFrame(this._rafId);
    this._rafId = undefined;
  }

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-appliance-card-editor");
    return document.createElement("m3-appliance-card-editor") as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(hass: HomeAssistant): M3ApplianceCardConfig {
    const sensors = Object.keys(hass?.states ?? {}).filter((eid) => eid.startsWith("sensor."));
    const guess =
      sensors.find((eid) => /washer|washing|dryer|dishwasher|oven|waschmaschine|trockner/.test(eid)) ??
      sensors[0] ??
      "";
    return {
      type: "custom:m3-appliance-card",
      entity: guess,
      glass_background: true,
      accent_color: NEW_CARD_ACCENT,
    };
  }

  public setConfig(config: M3ApplianceCardConfig): void {
    if (!config?.entity) throw new Error("m3-appliance-card: 'entity' is required");
    for (const key of ["sliders", "selects", "buttons", "chips"] as const) {
      const value = config[key];
      if (value !== undefined && !Array.isArray(value)) {
        throw new Error(`m3-appliance-card: '${key}' must be a list`);
      }
    }
    this._config = { glass_background: true, animation: "auto", ...config };
    this._folded = config.collapsible ? readCollapsed(this.hass, this._foldTarget) : false;
  }

  /** Same keys and storage as the vacuum and printer cards, so the suite folds one way. */
  private get _foldTarget(): CollapseTarget {
    return {
      entity: this._config?.collapse_state_entity,
      storageKey: `m3-appliance-folded:${location.pathname}:${this._config?.entity ?? ""}`,
      defaultCollapsed: this._config?.default_collapsed,
      memory: this._config?.collapse_memory,
    };
  }

  private _toggleFold = (e: Event): void => {
    e.stopPropagation();
    // Measured before the change, so the card can ease from it once the
    // folded or opened layout has rendered.
    const inner = this.renderRoot.querySelector(".card-inner") as HTMLElement | null;
    const before = inner?.offsetHeight ?? 0;
    this._folded = !this._folded;
    writeCollapsed(this.hass, this._foldTarget, this._folded);
    void this.updateComplete.then(() =>
      easeFoldHeight(inner, before, shouldAnimate(this._config?.animation)),
    );
  };

  public getCardSize(): number {
    const cfg = this._config;
    if (!cfg) return 3;
    return (
      2 +
      (cfg.progress ? 1 : 0) +
      (cfg.sliders?.length ?? 0) +
      (cfg.selects?.length ?? 0) +
      (cfg.buttons?.length ? 1 : 0) +
      (cfg.chips?.length ? 1 : 0)
    );
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: "full", rows: "auto", min_rows: 2 };
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return hassChangeMatters(changed, this.hass, this._watchedEntities());
  }

  /** Every entity the card reads, collected in one place for `shouldUpdate`. */
  private _watchedEntities(): string[] {
    const c = this._config;
    if (!c) return [];
    return [
      c.entity,
      c.progress?.percentage_entity,
      c.progress?.remaining_entity,
      ...(c.sliders ?? []).map((x) => x.entity),
      ...(c.selects ?? []).map((x) => x.entity),
      ...(c.buttons ?? []).map((x) => x.entity),
      ...(c.chips ?? []).map((x) => ("entity" in x ? x.entity : undefined)),
      c.collapse_state_entity,
    ].filter((e): e is string => !!e);
  }

  // ---- lifecycle ------------------------------------------------------------

  public connectedCallback(): void {
    super.connectedCallback();
    this._resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      const narrow = width > 0 && width < APPLIANCE_NARROW_PX;
      if (narrow !== this._narrow) this._narrow = narrow;
    });
    this._resizeObserver.observe(this);
    // Separate from the card observer: this one measures a block's inner width,
    // which is what the wave SVGs are laid out in.
    this._blockObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0 && Math.abs(width - this._blockWidth) > 1) this._blockWidth = width;
    });
    this._ticker.connect();
  }

  protected willUpdate(changed: PropertyValues): void {
    super.willUpdate?.(changed);
    const inner = this.renderRoot?.querySelector?.(".card-inner") as HTMLElement | null;
    this._heightBefore = inner?.offsetHeight ?? 0;
    this._phaseBefore = this._machinePhase;
  }

  private _phaseBefore: AppliancePhase = "ready";

  /** Eases the card to its new height when the phase changes its layout. */
  private _easeHeight(): void {
    if (this._machinePhase === this._phaseBefore || !this._heightBefore) return;
    if (this._reducedMotion || !shouldAnimate(this._config?.animation)) return;
    const inner = this.renderRoot.querySelector(".card-inner") as HTMLElement | null;
    const after = inner?.offsetHeight ?? 0;
    if (!inner || !after || Math.abs(after - this._heightBefore) < 2) return;
    inner.animate([{ height: `${this._heightBefore}px` }, { height: `${after}px` }], {
      duration: APPLIANCE_RESIZE_MS,
      easing: STANDARD_EASING,
    });
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    this._easeHeight();
    // An entity-backed fold can be changed elsewhere, so it is re-read rather
    // than only written on a tap.
    if (this._config?.collapsible) {
      const wanted = readCollapsed(this.hass, this._foldTarget);
      if (wanted !== this._folded) this._folded = wanted;
    }
    const el = this.renderRoot.querySelector(".wave-host") as HTMLElement | null;
    if (el && this._blockObserver) {
      this._blockObserver.disconnect();
      this._blockObserver.observe(el);
    }
    this._maybeSyncPopupCard();
    if (this._popupCardEl && this.hass) this._popupCardEl.hass = this.hass;
    if (changed.has("_popupOpen")) {
      const dialog = this.renderRoot?.querySelector("dialog") as HTMLDialogElement | null;
      syncDialogOpenState(dialog, this._popupOpen);
    }
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    this._blockObserver?.disconnect();
    this._stopWaveLoop();
    this._ticker.disconnect();
    for (const throttle of this._throttles.values()) throttle.clear();
    window.clearTimeout(this._dragEndTimer);
  }

  /**
   * A remaining time given as a *completion timestamp* counts down on its own:
   * nothing in `hass` changes between now and the end of the programme, so
   * without a clock of its own the card would sit on "1 h 24 min" for the whole
   * 84 minutes. A remaining time given as a number needs no clock, because the
   * integration pushes a new state — hence the comparison rather than an
   * unconditional assignment: on those the minute tick renders nothing at all.
   */
  private _onTick(now: number): void {
    // "Done 12 min ago" has no sensor that changes as the minutes pass, and a
    // machine hidden behind the last reading has to be shown as gone once the
    // grace runs out, whether or not anything else changes.
    const actual = this._config?.entity ? this.hass?.states[this._config.entity]?.state : undefined;
    if (this._machinePhase !== "running" || (actual !== undefined && isMissingState(actual))) {
      this._now = now;
      return;
    }
    const before = this._remainingAt(this._now);
    const after = this._remainingAt(now);
    if (before === undefined && after === undefined) return;
    if (before !== undefined && after !== undefined && Math.round(before) === Math.round(after)) {
      return;
    }
    this._now = now;
  }

  // ---- reading --------------------------------------------------------------

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  /**
   * The entity's state — or, for a short gap, the last one that was a reading.
   *
   * A Home Connect dryer in its anti-crease phase drops off and reconnects
   * every few minutes, each time for a few seconds, and the card went grey and
   * back with it. A blip shorter than APPLIANCE_UNAVAILABLE_GRACE_MS shows the
   * last reading instead; a machine that stays gone is shown as gone.
   */
  private _state(entityId?: string): HassEntity | undefined {
    if (!entityId) return undefined;
    const st = this.hass?.states[entityId];
    if (st && !isMissingState(st.state)) {
      this._lastReading.set(entityId, st);
      return st;
    }
    const last = this._lastReading.get(entityId);
    const since = st?.last_changed ? Date.parse(st.last_changed) : NaN;
    if (last && Number.isFinite(since) && Date.now() - since < APPLIANCE_UNAVAILABLE_GRACE_MS) return last;
    return st;
  }

  private readonly _lastReading = new Map<string, HassEntity>();

  private get _main(): HassEntity | undefined {
    return this._state(this._config?.entity);
  }

  /** The value the status rules run against: the state, or a named attribute. */
  private get _raw(): string {
    const cfg = this._config;
    const st = this._main;
    const value = cfg?.attribute ? st?.attributes?.[cfg.attribute] : st?.state;
    return value === undefined || value === null ? "" : String(value);
  }

  private get _rule(): StatusRule | undefined {
    const states = this._config?.states;
    // Done in all but name: a dryer in its anti-crease phase keeps reporting
    // `run` at 100% with its finish time behind it. When the card has a rule
    // for a finished state, that is the one that describes the machine.
    const progress = this._config?.progress ? this._progress() : undefined;
    if (doneByProgress(progress)) {
      const done = states?.find((r) => r.value && DEFAULT_DONE_STATES.includes(r.value.toLowerCase()));
      if (done) return done;
    }
    return findStateRule(states, this._raw, numericState(this._raw));
  }

  /**
   * Whether the machine itself cannot be reached. Narrower than
   * `isMissingState`: SmartThings reports an idle washer's job state as
   * `none`, which is a reading (one of the idle states), not a missing one —
   * counting it greyed out every idle Samsung as unavailable.
   */
  private get _unavailable(): boolean {
    const raw = this._raw.toLowerCase();
    return raw === "" || raw === "unavailable" || raw === "unknown";
  }

  private get _accent(): string {
    return resolveThemeColor(
      this._rule?.color ?? this._config?.accent_color ?? DEFAULT_APPLIANCE_ACCENT,
    );
  }

  private get _layout(): ApplianceBlock[] {
    return this._config?.layout?.length ? this._config.layout : DEFAULT_LAYOUT;
  }

  /**
   * Home Assistant's own word for a value of this entity — its translation of
   * an enum state or select option ("laundry_care_dryer_program_cotton" is
   * "Baumwolle") — or undefined when it has none and would hand the raw value
   * straight back.
   */
  private _translated(st: HassEntity | undefined, value: string): string | undefined {
    const format = this.hass?.formatEntityState;
    if (!st || !format) return undefined;
    const text = format({ ...st, state: value });
    return text && text !== value ? text : undefined;
  }

  /** A state nobody wrote a rule for, tidied up rather than shown as `heavy_duty`. */
  private _stateText(st: HassEntity | undefined, raw: string): string {
    const numeric = numericState(raw);
    if (numeric === undefined) return this._translated(st, raw) ?? prettifyState(raw);
    const unit = st?.attributes?.unit_of_measurement as string | undefined;
    const decimals = Math.min(2, (raw.split(/[.,]/)[1] ?? "").length);
    const value = formatNumber(this._language, numeric, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    return unit ? `${value} ${unit}` : value;
  }

  /**
   * The remaining time with the figures large and the units small. Set in one
   * size, "1 Std. 58 Min." took the header's width from the name, which a
   * card with a long name lost to an ellipsis after four letters.
   */
  private _durationParts(totalMinutes: number): TemplateResult {
    const { hours, minutes } = splitDuration(totalMinutes);
    const template = hours > 0 ? this._t("appliance_duration_hm") : this._t("appliance_duration_m");
    const parts = template.split(/(\{h\}|\{m\})/).filter((p) => p !== "");
    return html`${parts.map((p) =>
      p === "{h}"
        ? html`<span>${hours}</span>`
        : p === "{m}"
          ? html`<span>${minutes}</span>`
          : html`<span class="reading-unit">${p}</span>`,
    )}`;
  }

  // ---- progress -------------------------------------------------------------

  private _remainingAt(now: number): number | undefined {
    const st = this._state(this._config?.progress?.remaining_entity);
    if (!st || isMissingState(st.state)) return undefined;
    return remainingMinutes(st.state, st.attributes, now);
  }

  private _progress(): ProgressReading | undefined {
    const cfg = this._config?.progress;
    if (!cfg) return undefined;

    const pctState = this._state(cfg.percentage_entity);
    const pctRaw = pctState?.state ?? "";
    const pctValue = isMissingState(pctRaw) ? undefined : numericState(pctRaw);
    const percent = pctValue === undefined ? undefined : Math.min(100, Math.max(0, pctValue));

    const remaining = this._remainingAt(this._now);

    if (percent === undefined && remaining === undefined) return undefined;
    return { percent, remaining, indeterminate: percent === undefined };
  }

  // ---- service calls --------------------------------------------------------

  private _call(domain: string, service: string, data: Record<string, unknown>, entityId: string): void {
    this.hass?.callService(domain, service, { ...data, entity_id: entityId });
  }

  private _run(action: HaActionConfig | undefined, entityId?: string): void {
    // Every action in this card goes through the shared handler, so a
    // `confirmation:` on any of them is asked for in exactly one place — and
    // `navigate`, `url` and `perform-action` behave as they do on every other
    // card in the suite.
    //
    // `runHaAction` rather than `handleAction` because only the former knows
    // the `popup` kind; the branches the two share behave identically.
    if (!this.hass) return;
    runHaAction(this.hass, action, {
      source: this,
      entityId,
      openPopup: () => this._openPopup(),
      fireMoreInfo: (id) => openEntityDetail(this, id),
      navigate: (path) => {
        window.history.pushState(null, "", path);
        this.dispatchEvent(
          new CustomEvent("location-changed", { bubbles: true, composed: true, detail: { replace: false } }),
        );
      },
    });
  }

  // ---- popup ----------------------------------------------------------------

  /**
   * The card's own popup: any Lovelace card, in the shared popup chrome.
   *
   * An appliance's card is a summary — a state, a progress bar, a few buttons.
   * The full set of controls (every programme, every option, the history) does
   * not belong on a dashboard tile, but it does belong one tap away, which is
   * what this is.
   */
  private _openPopup(): void {
    if (!this._config?.popup) {
      // Nothing configured: fall back to more-info rather than opening an empty
      // dialog, the same as any action a card does not wire up.
      openEntityDetail(this, this._config?.entity);
      return;
    }
    this._popupOpenedAt = Date.now();
    this._popupOpen = true;
  }

  private _closePopup(): void {
    this._popupOpen = false;
    this._popupCardEl = undefined;
    this._popupCard.reset();
  }

  // createCardElement() is async, so the build is driven from updated() and
  // render() stays synchronous.
  private _maybeSyncPopupCard(): void {
    const popup = this._config?.popup;
    if (!this._popupOpen || !popup || !this.hass) {
      this._popupCard.reset();
      return;
    }
    this._popupCard.sync({
      skeleton: popup.content,
      tokens: { entity_id: this._config?.entity, name: this._config?.name },
      hass: this.hass,
      onChange: (el) => {
        this._popupCardEl = el;
      },
    });
  }

  private _renderPopup() {
    const popup = this._config?.popup;
    if (!this._popupOpen || !popup) return nothing;
    return renderPopupDialog({
      content: this._popupCardEl,
      title: popup.title ?? this._config?.name,
      size: popup.size,
      onClose: () => this._closePopup(),
      onBackdropClick: (e) => {
        if (shouldCloseOnBackdropClick(e, this._popupOpenedAt)) this._closePopup();
      },
      closeLabel: this._t("dialog_close"),
    });
  }

  /**
   * One throttle per slider entity, kept across renders so a drag is not
   * restarted by the re-render its own first service call causes. The value
   * handed in is already snapped to the entity's grid, so nothing about the
   * range is captured here — the throttle outlives config edits.
   */
  private _throttleFor(entityId: string): DragThrottle<number> {
    let throttle = this._throttles.get(entityId);
    if (!throttle) {
      throttle = new DragThrottle<number>((value) => {
        this._call(setValueDomain(entityId.split(".")[0]), "set_value", { value }, entityId);
      }, APPLIANCE_SLIDER_THROTTLE_MS);
      this._throttles.set(entityId, throttle);
    }
    return throttle;
  }

  private _scheduleDragEnd(): void {
    window.clearTimeout(this._dragEndTimer);
    this._dragEndTimer = window.setTimeout(() => {
      this._drag = undefined;
      this._dragEndTimer = undefined;
    }, APPLIANCE_DRAG_SETTLE_MS);
  }

  // ---- render ---------------------------------------------------------------

  protected render(): TemplateResult | typeof nothing {
    const cfg = this._config;
    if (!cfg || !this.hass) return nothing;
    if (!this.hass.states[cfg.entity]) return renderMissingEntity(cfg.entity);

    const unavailable = this._unavailable;
    const accent = this._accent;
    const rule = this._rule;
    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(cfg);
    const radius = resolveCornerRadius(cfg.radius ?? DEFAULT_APPLIANCE_RADIUS, cfg.corners);

    const iconBg = tintOn(this, accent, cfg.accent_opacity, APPLIANCE_ICON_TINT);
    const cssVars = buildCssVars({
      "m3a-accent": accent,
      "m3a-ink": inkOn(accent, this),
      // The shared header reads the m3p-* names, so they are set rather than
      // re-styled — one fewer place for this card to drift from its siblings.
      "m3p-icon-bg": iconBg,
      "m3p-icon-color": foregroundOn(accent, iconBg, 3, this),
      "m3p-text": textColorCss,
      "m3p-secondary-text": secondaryTextColorCss,
    });

    // SmartThings' idle job state is `none`, which Home Assistant translates
    // as "Kein" — a word, but not one that says the machine is off.
    const raw = this._raw.toLowerCase();
    const idle = (cfg.idle_states ?? DEFAULT_IDLE_STATES).some((s) => s.toLowerCase() === raw);
    const subtitle = unavailable
      ? this._t("appliance_unavailable")
      : (rule?.label ?? (raw === "none" ? this._t("appliance_idle") : this._stateText(this._main, this._raw)));

    // An idle machine has no programme to show the progress of. A Samsung
    // keeps reporting 0 % and 0 minutes left while it is off, which drew an
    // empty bar and "0 Min. verbleibend" on a machine that is doing nothing.
    const progress = idle ? undefined : this._progress();
    const folded = !!cfg.collapsible && this._folded;
    // Three layouts, by what the machine is doing. Done includes "done in all
    // but name": a dryer in its anti-crease phase reports `run` at 100 % with
    // its finish time behind it.
    const done = (cfg.done_states ?? DEFAULT_DONE_STATES).some((s) => s.toLowerCase() === raw);
    const progressDone = doneByProgress(progress);
    const phase: AppliancePhase = unavailable || idle ? "ready" : done || progressDone ? "done" : "running";
    this._machinePhase = phase;
    // A new run, or a machine emptied, starts the "Done … ago" clock afresh.
    if (phase !== "done" && !unavailable) this._forgetDone();
    const remaining = phase === "running" ? progress?.remaining : undefined;

    // Decide how the wave behaves this render, before anything draws one.
    //
    // `wave_style: flat` is a look rather than an animation setting, so it
    // flattens whatever `animation` says. Travel is the decoration on top: it
    // runs only while there is progress still to make, which is the same rule
    // m3-progress-card uses, and stops entirely under reduced motion — the
    // shape survives, the movement does not.
    const wavy = this._wavy;
    const progressMoving =
      !!progress && (progress.indeterminate || (progress.percent ?? 0) < 100);
    this._phaseAnimating =
      wavy &&
      !this._reducedMotion &&
      shouldAnimate(cfg.animation) &&
      progressMoving &&
      this._layout.includes("progress");
    this._targetAmplitude = wavy && !unavailable ? APPLIANCE_WAVE_AMPLITUDE : 0;
    if (this._phaseAnimating || this._displayAmplitude !== this._targetAmplitude) {
      this._startWaveLoop();
    } else {
      this._stopWaveLoop();
    }

    // A card with a popup configured opens it on tap, so the common case needs
    // no `tap_action` at all; an explicit one still wins.
    const headerAction =
      cfg.tap_action ?? (cfg.popup ? { action: "popup" as const } : { action: "more-info" as const });
    const headerInteractive = isActionable(headerAction);

    // Each block once, unfolded, so the arrow can be left out when folding
    // would hide nothing — a dryer that drops off Wi-Fi takes every chip with
    // it, and an arrow that toggles an empty body reads as a broken one.
    const blocks = this._layout.map((block) => ({ block, body: this._renderBlock(block, progress) }));
    const foldable =
      !!cfg.collapsible &&
      blocks.some(({ block, body }) => foldHides(block, true, cfg.collapse_blocks) && this._blockShows(block, body));

    const name =
      cfg.name ?? (this._main?.attributes?.friendly_name as string | undefined) ?? this._t("appliance_default_name");
    const onHeader = headerInteractive
      ? (e: Event) => {
          e.stopPropagation();
          this._run(headerAction, cfg.entity);
        }
      : undefined;
    const doneSubtitle = phase === "done" && !unavailable ? this._doneSince(done) : undefined;
    const right =
      phase === "running"
        ? remaining === undefined
          ? undefined
          : html`<div class="reading hero">
              <div class="reading-value">${this._durationParts(remaining)}</div>
              <div class="reading-caption">${this._endCaption()}</div>
            </div>`
        : phase === "done"
          ? html`<span class="done-pill"><ha-icon icon="mdi:check"></ha-icon>${this._t("appliance_done")}</span>`
          : html`<span class="done-pill ${unavailable ? "neutral" : ""}"
              ><ha-icon icon=${unavailable ? "mdi:lan-disconnect" : "mdi:power-standby"}></ha-icon>${subtitle}</span
            >`;

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner phase-${phase} ${glassCardClass(cfg.glass_background)} ${
            unavailable ? "off" : ""
          } ${this._narrow ? "narrow" : ""} ${shouldAnimate(cfg.animation) ? "" : "no-animations"}"
          style=${`border-radius: ${radius};${cardBackgroundCss ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          ${renderCardHeader({
            icon: rule?.icon ?? cfg.icon ?? DEFAULT_APPLIANCE_ICON,
            name,
            subtitle: doneSubtitle ?? (phase === "ready" ? (this._readySince() ?? "") : subtitle),
            onClick: onHeader,
            right,
          })}
          ${phase === "done" ? this._renderFinish() : nothing}
          ${blocks
            .filter(({ block }) => !foldHides(block, folded && foldable, cfg.collapse_blocks))
            .map(({ body }) => body)}
          ${foldable
            ? renderDetailsToggle({
                folded: folded,
                text: this._t("details_toggle"),
                label: `${this._config?.name ?? ""} ${this._t("details_toggle")}`.trim(),
                onToggle: this._toggleFold,
              })
            : nothing}
        </div>
      </ha-card>
      ${this._renderPopup()}
    `;
  }

  /** Whether a rendered block draws anything; sliders and selects map a list, which may be empty. */
  private _blockShows(block: ApplianceBlock, body: unknown): boolean {
    if (body === nothing) return false;
    if (block === "sliders") return (this._config?.sliders?.length ?? 0) > 0;
    if (block === "selects") return (this._config?.selects?.length ?? 0) > 0;
    return true;
  }

  private _renderBlock(
    block: ApplianceBlock,
    progress: ProgressReading | undefined,
  ): TemplateResult | typeof nothing {
    switch (block) {
      case "progress":
        return this._renderProgress(progress);
      case "sliders":
        return html`${(this._config?.sliders ?? []).map((s) => this._renderSlider(s))}`;
      case "selects":
        return html`${(this._config?.selects ?? []).map((s, i) => this._renderSelect(s, i))}`;
      case "buttons":
        return this._renderButtons();
      case "chips":
        return this._renderChips();
      default:
        return nothing;
    }
  }

  // ---- progress block -------------------------------------------------------

  private _renderProgress(progress: ProgressReading | undefined): TemplateResult | typeof nothing {
    // Only while a run is on: a finished machine says so in its pill, and a
    // full bar beside it would say it twice.
    if (!progress || this._machinePhase !== "running") return nothing;
    const cfg = this._config?.progress;
    const color = cfg?.color ? resolveThemeColor(cfg.color) : undefined;
    const animate = shouldAnimate(this._config?.animation);
    const label = cfg?.label ?? this._t("appliance_progress");

    // The percentage sits on the bar's own line rather than over it: the
    // label row above said "Progress" over a bar that says progress.
    return html`
      <div class="block progress-row" style=${color ? buildCssVars({ "m3a-accent": color }) : nothing}>
        <div
          class="bar wave-host ${this._wavy ? "wavy" : "flat"}"
          role="progressbar"
          aria-label=${label}
          aria-valuemin=${progress.indeterminate ? nothing : 0}
          aria-valuemax=${progress.indeterminate ? nothing : 100}
          aria-valuenow=${progress.indeterminate ? nothing : Math.round(progress.percent ?? 0)}
        >
          ${this._wavy && this._blockWidth > 0
            ? this._renderWaveBar(progress)
            : html`<div
                class="bar-fill ${progress.indeterminate ? "indeterminate" : ""} ${
                  animate ? "" : "still"
                }"
                style=${progress.indeterminate ? nothing : `width: ${progress.percent ?? 0}%;`}
              ></div>`}
        </div>
        ${progress.percent === undefined
          ? nothing
          : html`<span class="block-value"
              >${formatNumber(this._language, progress.percent, { maximumFractionDigits: 0 })} %</span
            >`}
      </div>
    `;
  }

  /** "done at 15:18" under the remaining time, or "left" when the end is not known. */
  private _endCaption(): string {
    const st = this._state(this._config?.progress?.remaining_entity);
    if (this._config?.show_end_time === false || !st) return this._t("appliance_remaining");
    const end = endTimeOf(st.state, st.attributes, this._now);
    if (end === undefined) return this._t("appliance_remaining");
    const hour12 =
      this.hass?.locale?.time_format === "12" ? true : this.hass?.locale?.time_format === "24" ? false : undefined;
    const time = new Intl.DateTimeFormat(this._language, { hour: "2-digit", minute: "2-digit", hour12 }).format(end);
    return this._t("appliance_done_at").replace("{time}", time);
  }

  /**
   * "Done 12 min ago": from the status turning done — or, for a machine done
   * in all but name, from the progress reaching 100 %, since its status has
   * said `run` since the programme began.
   */
  private _doneSince(byState: boolean): string | undefined {
    // A `finished_at` attribute wins: a template sensor's last_changed is the
    // moment Home Assistant last started or reloaded it, which made a
    // dishwasher done for hours read "Done 0 min ago".
    const stamped = this._main?.attributes?.finished_at;
    const source = byState ? this._main : this._state(this._config?.progress?.percentage_entity);
    let changed =
      typeof stamped === "string" && Number.isFinite(Date.parse(stamped))
        ? Date.parse(stamped)
        : source?.last_changed
          ? Date.parse(source.last_changed)
          : NaN;
    // And the earliest moment this browser saw the machine done: a Home
    // Connect dryer reconnects every few minutes in its anti-crease phase,
    // each time resetting every timestamp it has, and "Done 40 min ago" fell
    // back to "0 min" with each one.
    const seen = this._doneSeen();
    if (seen !== undefined && (!Number.isFinite(changed) || seen < changed)) changed = seen;
    if (Number.isFinite(changed)) this._rememberDone(changed);
    if (!Number.isFinite(changed)) return undefined;
    const parts = sinceParts(changed, this._now);
    return "m" in parts
      ? this._t("appliance_done_since_m").replace("{m}", String(parts.m))
      : this._t("appliance_done_since_h").replace("{h}", String(parts.h));
  }

  /** "Since 2 h": how long an idle machine has been idle, under its name. */
  private _readySince(): string | undefined {
    const raw = this.hass?.states[this._config?.entity ?? ""];
    const changed = raw?.last_changed ? Date.parse(raw.last_changed) : NaN;
    if (!Number.isFinite(changed)) return undefined;
    const parts = sinceParts(changed, this._now);
    return "m" in parts
      ? this._t("appliance_since_m").replace("{m}", String(parts.m))
      : this._t("appliance_since_h").replace("{h}", String(parts.h));
  }

  private get _doneKey(): string {
    return `m3-appliance-done:${this._config?.entity ?? ""}`;
  }

  private _doneSeen(): number | undefined {
    try {
      const v = Number(window.localStorage.getItem(this._doneKey));
      return Number.isFinite(v) && v > 0 ? v : undefined;
    } catch {
      return undefined;
    }
  }

  private _rememberDone(at: number): void {
    try {
      window.localStorage.setItem(this._doneKey, String(Math.round(at)));
    } catch {
      /* private mode: the sensor's own timestamp has to do */
    }
  }

  private _forgetDone(): void {
    try {
      window.localStorage.removeItem(this._doneKey);
    } catch {
      /* nothing stored */
    }
  }

  /** The full-width "Emptied" button, only when an action is configured. */
  private _renderFinish(): TemplateResult | typeof nothing {
    const action = this._config?.finish_action;
    if (!action || !isActionable(action)) return nothing;
    const accent = this._accent;
    const label = this._config?.finish_label || this._t("appliance_emptied");
    const onTap = (e: Event): void => {
      e.stopPropagation();
      this._run(action, this._config?.entity);
    };
    return html`
      <button
        class="finish"
        style=${`background: ${tintOn(this, accent, this._config?.accent_opacity, APPLIANCE_FINISH_TINT)}; color: ${tintInk(
          this,
          accent,
          this._config?.accent_opacity,
          APPLIANCE_FINISH_TINT,
        )};`}
        aria-label=${label}
        @click=${onTap}
      >
        <ha-icon icon="mdi:basket-check-outline"></ha-icon><span>${label}</span>
      </button>
    `;
  }

  // ---- slider block ---------------------------------------------------------

  /**
   * The bar as an M3-Expressive wave: a travelling sine over the done part, a
   * flat rail over the rest, and the progress card's end dot.
   *
   * An indeterminate bar sweeps a fixed-width wave segment instead, because
   * there is no "done part" to fill — the same thing the flat bar does with a
   * CSS keyframe.
   */
  private _renderWaveBar(progress: ProgressReading): SVGTemplateResult {
    const width = this._blockWidth;
    const midY = APPLIANCE_BAR_SVG_HEIGHT / 2;
    const amplitude = this._displayAmplitude;

    if (progress.indeterminate) {
      const segWidth = width * APPLIANCE_INDETERMINATE_FRACTION;
      const travel = Math.max(0, width - segWidth - APPLIANCE_WAVE_DOT_RADIUS * 2);
      // Parked in the middle when still, matching the flat bar's `.still` rule.
      const t = this._phaseAnimating
        ? (performance.now() % APPLIANCE_INDETERMINATE_MS) / APPLIANCE_INDETERMINATE_MS
        : 0.5;
      const tri = t < 0.5 ? t * 2 : (1 - t) * 2;
      const segStartX = tri * travel;
      const segEndX = segStartX + segWidth;
      const trackEndX = Math.max(0, width - APPLIANCE_WAVE_DOT_RADIUS);
      return svg`<svg
        class="wave-svg"
        viewBox="0 0 ${width} ${APPLIANCE_BAR_SVG_HEIGHT}"
        width="100%"
        height=${APPLIANCE_BAR_SVG_HEIGHT}
        preserveAspectRatio="none"
      >
        ${segStartX > 0
          ? svg`<line class="wave-track" x1="0" y1=${midY} x2=${segStartX} y2=${midY}></line>`
          : nothing}
        <path
          class="wave-active"
          d=${buildWavePath(
            segStartX,
            segWidth,
            amplitude,
            APPLIANCE_WAVE_WAVELENGTH,
            this._phase,
            midY,
          )}
          fill="none"
        ></path>
        ${segEndX < trackEndX
          ? svg`<line class="wave-track" x1=${segEndX} y1=${midY} x2=${trackEndX} y2=${midY}></line>`
          : nothing}
        <circle class="wave-dot" cx=${trackEndX} cy=${midY} r=${APPLIANCE_WAVE_DOT_RADIUS}></circle>
      </svg>`;
    }

    const geom = waveBarGeometry(
      width,
      progress.percent ?? 0,
      APPLIANCE_WAVE_GAP,
      APPLIANCE_WAVE_DOT_RADIUS,
    );
    const activePath = geom.activeWidth
      ? buildWavePath(
          0,
          geom.activeWidth,
          amplitude,
          APPLIANCE_WAVE_WAVELENGTH,
          this._phase,
          midY,
        )
      : "";

    return svg`<svg
      class="wave-svg"
      viewBox="0 0 ${width} ${APPLIANCE_BAR_SVG_HEIGHT}"
      width="100%"
      height=${APPLIANCE_BAR_SVG_HEIGHT}
      preserveAspectRatio="none"
    >
      ${activePath ? svg`<path class="wave-active" d=${activePath} fill="none"></path>` : nothing}
      ${geom.trackEndX > geom.trackStartX
        ? svg`<line
            class="wave-track"
            x1=${geom.trackStartX}
            y1=${midY}
            x2=${geom.trackEndX}
            y2=${midY}
          ></line>`
        : nothing}
      <circle class="wave-dot" cx=${geom.trackEndX} cy=${midY} r=${APPLIANCE_WAVE_DOT_RADIUS}></circle>
    </svg>`;
  }

  private _renderSlider(cfg: ApplianceSliderConfig): TemplateResult | typeof nothing {
    const st = this._state(cfg.entity);
    // A slider with no entity behind it has no range and no value; drawing a
    // dead track would only invite a drag that goes nowhere.
    if (!st || isMissingState(st.state)) return nothing;

    const range = resolveSliderRange(st.attributes, {
      min: cfg.min,
      max: cfg.max,
      step: cfg.step,
    });
    const live = numericState(st.state) ?? range.min;
    const value =
      this._drag?.entity === cfg.entity ? this._drag.value : snapToRange(live, range);
    const pct = ((value - range.min) / (range.max - range.min)) * 100;
    const unit = cfg.unit ?? (st.attributes?.unit_of_measurement as string | undefined) ?? "";
    const label =
      cfg.label ?? (st.attributes?.friendly_name as string | undefined) ?? cfg.entity;
    const decimals = range.step < 1 ? 1 : 0;

    const valueFromX = (clientX: number, el: HTMLElement): number => {
      const rect = el.getBoundingClientRect();
      const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
      const raw = rect.width > 0 ? range.min + (x / rect.width) * (range.max - range.min) : range.min;
      return snapToRange(raw, range);
    };
    const commit = (next: number): void => {
      this._drag = { entity: cfg.entity, value: next };
      this._throttleFor(cfg.entity).call(next);
    };

    return html`
      <div class="block" style=${cfg.color ? buildCssVars({ "m3a-accent": resolveThemeColor(cfg.color) }) : nothing}>
        <div class="block-head">
          <span class="block-label"
            >${cfg.icon ? html`<ha-icon icon=${cfg.icon}></ha-icon>` : nothing}${label}</span
          >
          <span class="block-value"
            >${formatNumber(this._language, value, {
              minimumFractionDigits: decimals,
              maximumFractionDigits: decimals,
            })}${unit ? ` ${unit}` : ""}</span
          >
        </div>
        <div
          class="slider"
          role="slider"
          aria-label=${this._t("appliance_slider_label").replace("{name}", label)}
          aria-valuemin=${range.min}
          aria-valuemax=${range.max}
          aria-valuenow=${value}
          aria-valuetext=${unit ? `${value} ${unit}` : String(value)}
          tabindex="0"
          @touchstart=${stopSwipe}
          @touchmove=${stopSwipe}
          @touchend=${stopSwipe}
          @mousedown=${stopSwipe}
          @mousemove=${stopSwipe}
          @mouseup=${stopSwipe}
          @pointerdown=${(e: PointerEvent) => {
            e.preventDefault();
            const el = e.currentTarget as HTMLElement;
            el.setPointerCapture(e.pointerId);
            commit(valueFromX(e.clientX, el));
          }}
          @pointermove=${(e: PointerEvent) => {
            const el = e.currentTarget as HTMLElement;
            if (!el.hasPointerCapture(e.pointerId)) return;
            const next = valueFromX(e.clientX, el);
            if (next !== this._drag?.value) commit(next);
          }}
          @pointerup=${(e: PointerEvent) => {
            const el = e.currentTarget as HTMLElement;
            if (!el.hasPointerCapture(e.pointerId)) return;
            const next = valueFromX(e.clientX, el);
            this._drag = { entity: cfg.entity, value: next };
            this._throttleFor(cfg.entity).flush(next);
            this._scheduleDragEnd();
          }}
          @pointercancel=${() => this._scheduleDragEnd()}
          @keydown=${(e: KeyboardEvent) => {
            const dir = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
            if (dir === undefined) return;
            e.preventDefault();
            const step = range.step * (e.shiftKey ? 5 : 1);
            commit(snapToRange(value + dir * step, range));
            this._scheduleDragEnd();
          }}
        >
          ${this._wavy && this._blockWidth > 0
            ? this._renderWaveSlider(pct)
            : html`
                <div class="slider-track"></div>
                <div
                  class="slider-fill"
                  style=${`width: ${Math.max(0, Math.min(100, pct))}%;`}
                ></div>
              `}
          <div
            class="slider-handle"
            style=${this._wavy && this._blockWidth > 0
              ? `left: ${waveSliderGeometry(
                  this._blockWidth,
                  pct / 100,
                  APPLIANCE_HANDLE_WIDTH,
                  APPLIANCE_WAVE_GAP,
                ).handleX}px;`
              : `left: ${Math.max(0, Math.min(100, pct))}%;`}
          ></div>
        </div>
      </div>
    `;
  }

  // ---- select block ---------------------------------------------------------

  /**
   * The slider rail as a wave up to the handle and a flat track after it.
   *
   * Half the gap sits on each side of the handle so the wave never appears to
   * sprout from it — the humidifier card's arrangement, which this card's
   * slider was already shaped after.
   */
  private _renderWaveSlider(percentage: number): SVGTemplateResult {
    const width = this._blockWidth;
    const height = APPLIANCE_SLIDER_HEIGHT;
    const midY = height / 2;
    const geom = waveSliderGeometry(
      width,
      percentage / 100,
      APPLIANCE_HANDLE_WIDTH,
      APPLIANCE_WAVE_GAP,
    );
    const hasActive = geom.activeEnd > 1;
    const hasTrack = geom.trackStart < width - 1;

    return svg`<svg
      class="wave-svg"
      viewBox="0 0 ${width} ${height}"
      width="100%"
      height=${height}
      preserveAspectRatio="none"
    >
      ${hasActive
        ? svg`<path
            class="wave-active"
            d=${buildWavePath(
              0,
              geom.activeEnd,
              this._displayAmplitude,
              APPLIANCE_WAVE_WAVELENGTH,
              this._phase,
              midY,
            )}
            fill="none"
          ></path>`
        : nothing}
      ${hasTrack
        ? svg`<line
            class="wave-track"
            x1=${geom.trackStart}
            y1=${midY}
            x2=${width}
            y2=${midY}
          ></line>`
        : nothing}
    </svg>`;
  }

  private _renderSelect(cfg: ApplianceSelectConfig, index: number): TemplateResult | typeof nothing {
    const st = this._state(cfg.entity);
    if (!st) return nothing;

    const options = visibleOptions(st.attributes?.options, cfg.options);
    if (options.length === 0) return nothing;

    const domain = selectOptionDomain(cfg.entity.split(".")[0]);
    const label = cfg.label ?? (st.attributes?.friendly_name as string | undefined) ?? cfg.entity;
    const color = resolveThemeColor(
      cfg.color ?? APPLIANCE_PALETTE[index % APPLIANCE_PALETTE.length],
    );
    const disabled = isMissingState(st.state);
    const style =
      cfg.style === "dropdown" || options.length > APPLIANCE_OPTION_DROPDOWN_FROM
        ? "dropdown"
        : (cfg.style ?? "icon_label");

    const nameFor = (option: string): string =>
      cfg.names?.[option] ?? this._translated(st, option) ?? prettifyOption(option);
    const select = (option: string): void =>
      this._call(domain, "select_option", { option }, cfg.entity);

    if (style === "dropdown") {
      return html`
        <div class="block">
          <span class="block-label">${label}</span>
          <select
            class="dropdown"
            aria-label=${label}
            ?disabled=${disabled}
            @change=${(e: Event) => select((e.target as HTMLSelectElement).value)}
          >
            ${options.map(
              (option) =>
                html`<option value=${option} ?selected=${option === st.state}>
                  ${nameFor(option)}
                </option>`,
            )}
          </select>
        </div>
      `;
    }

    return html`
      <div
        class="block"
        style=${buildCssVars({
          "m3a-pill": color,
          "m3a-pill-tint": tintOn(this, color, undefined, APPLIANCE_OPTION_TINT),
          "m3a-pill-ink": inkOn(color, this),
        })}
      >
        <span class="block-label">${label}</span>
        <div class="pill-row wrap" role="group" aria-label=${label}>
          ${options.map((option) => {
            const active = st.state === option;
            const icon = cfg.icons?.[option];
            const onTap = (): void => select(option);
            return html`
              <button
                class="option-pill ${active ? "active" : ""}"
                type="button"
                ?disabled=${disabled}
                aria-pressed=${active ? "true" : "false"}
                @click=${onTap}
                @keydown=${activateOnKey(onTap)}
              >
                ${icon && style === "icon_label"
                  ? html`<ha-icon icon=${icon}></ha-icon>`
                  : nothing}
                <span class="pill-label">${nameFor(option)}</span>
              </button>
            `;
          })}
        </div>
      </div>
    `;
  }

  // ---- button block ---------------------------------------------------------

  private _renderButtons(): TemplateResult | typeof nothing {
    const buttons = this._config?.buttons ?? [];
    if (buttons.length === 0) return nothing;

    return html`
      <div class="block">
        <div class="pill-row wrap" role="group" aria-label=${this._t("appliance_actions")}>
          ${buttons.map((btn, i) => this._renderButton(btn, i))}
        </div>
      </div>
    `;
  }

  private _renderButton(cfg: ApplianceButtonConfig, index: number): TemplateResult | typeof nothing {
    const st = this._state(cfg.entity);
    const domain = cfg.entity?.split(".")[0] ?? "";
    const action = cfg.tap_action ?? defaultEntityAction(domain);
    // A button with neither an entity nor an action of its own would be a pill
    // that does nothing at all.
    if (!cfg.entity && !cfg.tap_action) return nothing;

    const missing =
      !!cfg.entity &&
      (!st ||
        (STATELESS_DOMAINS.has(domain)
          ? st.state.toLowerCase() === "unavailable"
          : isMissingState(st.state)));
    const active = TOGGLE_DOMAINS.has(domain) && isOnState(st?.state);
    const color = resolveThemeColor(cfg.color ?? APPLIANCE_PALETTE[index % APPLIANCE_PALETTE.length]);
    const tint = tintOn(this, color, undefined, APPLIANCE_BUTTON_TINT);
    const name =
      cfg.name ??
      (st?.attributes?.friendly_name as string | undefined) ??
      (cfg.entity ? prettifyOption(cfg.entity.split(".")[1] ?? cfg.entity) : "");
    const onTap = (e: Event): void => {
      e.stopPropagation();
      this._run(action, cfg.entity);
    };

    return html`
      <button
        class="action-btn ${active ? "active" : ""} ${missing ? "dimmed" : ""}"
        type="button"
        style=${buildCssVars({
          "m3a-btn": color,
          "m3a-btn-tint": tint,
          "m3a-btn-fg": foregroundOn(color, tint, 4.5, this),
          "m3a-btn-ink": inkOn(color, this),
        })}
        ?disabled=${missing}
        aria-label=${name}
        aria-pressed=${TOGGLE_DOMAINS.has(domain) ? (active ? "true" : "false") : nothing}
        @click=${onTap}
        @keydown=${activateOnKey(onTap)}
      >
        ${cfg.icon ? html`<ha-icon icon=${cfg.icon}></ha-icon>` : nothing}
        ${name ? html`<span class="pill-label">${name}</span>` : nothing}
      </button>
    `;
  }

  // ---- chip block -----------------------------------------------------------

  private _renderChips(): TemplateResult | typeof nothing {
    return renderInfoChips(this._config?.chips, {
      host: this,
      hass: this.hass,
      language: this._language,
      style: this._config?.chip_style,
      accent: this._config?.accent_color ?? DEFAULT_APPLIANCE_ACCENT,
      run: (action, entityId) => this._run(action, entityId),
    });
  }

  static styles = css`
    ${glassCardStyles}
    ${infoChipStyles}
    ${cardHeaderStyles}
    ${popupCardStyles}
    ${detailsToggleStyles}

    ha-card {
      color: var(--m3p-text, var(--primary-text-color));
    }

    .card-inner {
      gap: var(--m3-card-gap, 12px);
    }

    .card-inner.off {
      opacity: 0.5;
    }

    /* ---- header right-hand reading ---- */
    /* The remaining time and the fold chevron share the header's trailing
       slot, centred on each other as on the printer card. */
    .header-trailing {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .reading {
      margin-left: auto;
      text-align: right;
      line-height: 1.1;
    }

    .reading-value {
      font-size: ${APPLIANCE_VALUE_SIZE}px;
      font-weight: 700;
      color: var(--m3a-accent);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .reading-unit {
      font-size: ${APPLIANCE_CAPTION_SIZE + 2}px;
      font-weight: 600;
      opacity: 0.8;
    }

    .reading-caption {
      font-size: ${APPLIANCE_CAPTION_SIZE}px;
      opacity: 0.5;
      color: var(--m3p-secondary-text);
    }

    /* ---- the three phases ---- */
    /* Running: the time left is the figure the card is read for, so it is
       large; the end time sits under it, small. */
    .reading.hero .reading-value {
      font-size: ${APPLIANCE_HERO_SIZE}px;
      line-height: 1;
    }

    .reading.hero .reading-unit {
      font-size: ${APPLIANCE_CAPTION_SIZE + 4}px;
    }

    .reading.hero .reading-caption {
      margin-top: 4px;
      opacity: 0.7;
    }

    /* The bar and its percentage on one line. Two classes, so the general
       .block rule below — a column — does not win by coming later. */
    .block.progress-row {
      flex-direction: row;
      align-items: center;
      gap: 12px;
    }

    .block.progress-row .bar {
      flex: 1 1 auto;
      align-self: center;
      min-width: 0;
    }

    .block.progress-row .block-value {
      font-size: 15px;
    }

    /* Done: a tinted pill in place of the time — the size and weight of the
       battery pill on the vacuum card beside it, so the two corners match.
       line-height 1 and a flex icon keep the check on the text's centre line:
       an inline ha-icon sits on the baseline and dropped below the word. */
    .done-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
      height: ${APPLIANCE_PILL_HEIGHT}px;
      padding: 0 10px 0 8px;
      border-radius: ${APPLIANCE_PILL_RADIUS}px;
      line-height: 1;
      font-size: 12px;
      font-weight: 700;
      color: var(--m3p-icon-color);
      background: var(--m3p-icon-bg);
    }

    /* Unreachable: the same pill in the quiet colour. Idle keeps the state's
       colour, as the icon beside it does. */
    .done-pill.neutral {
      color: var(--m3p-secondary-text);
      background: color-mix(in srgb, var(--m3p-secondary-text) 12%, transparent);
    }

    .done-pill ha-icon {
      display: flex;
      --mdc-icon-size: 15px;
      width: 15px;
      height: 15px;
    }

    /* "Emptied": the supply card's refill button, full width. */
    .finish {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      height: ${APPLIANCE_FINISH_HEIGHT}px;
      border: none;
      border-radius: ${APPLIANCE_FINISH_RADIUS}px;
      font-family: inherit;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: border-radius 0.4s ${EASING};
    }

    .finish:active {
      border-radius: ${APPLIANCE_FINISH_RADIUS_ACTIVE}px;
    }

    .finish:focus-visible {
      outline: 2px solid var(--m3a-accent);
      outline-offset: 2px;
    }

    .finish ha-icon {
      --mdc-icon-size: 20px;
    }

    .no-animations .finish {
      transition: none;
    }

    /* ---- blocks ---- */
    .block {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
    }

    .block-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
    }

    .block-label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      font-size: ${APPLIANCE_LABEL_SIZE}px;
      opacity: 0.5;
      color: var(--m3p-secondary-text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .block-label ha-icon {
      --mdc-icon-size: 14px;
      width: 14px;
      height: 14px;
    }

    .block-value {
      flex-shrink: 0;
      font-size: 13px;
      font-weight: 700;
      color: var(--m3a-accent);
      font-variant-numeric: tabular-nums;
    }

    /* ---- progress bar ---- */
    .bar {
      position: relative;
      height: ${APPLIANCE_BAR_HEIGHT}px;
      border-radius: ${APPLIANCE_BAR_RADIUS}px;
      overflow: hidden;
      background: color-mix(in srgb, var(--m3p-secondary-text) 16%, transparent);
    }

    .bar-fill {
      position: absolute;
      inset: 0 auto 0 0;
      border-radius: ${APPLIANCE_BAR_RADIUS}px;
      background: var(--m3a-accent);
      transition: width 0.45s ${EASING};
    }

    .bar-fill.indeterminate {
      width: ${Math.round(APPLIANCE_INDETERMINATE_FRACTION * 100)}%;
      transition: none;
      animation: appliance-sweep ${unsafeCSS(APPLIANCE_INDETERMINATE_MS)}ms ${EASING} infinite;
    }

    /* An indeterminate bar with nothing to animate would otherwise sit as a
       stub at the left edge and read as "5% done". Parked in the middle it
       reads as "running, no idea how far". */
    .bar-fill.indeterminate.still {
      animation: none;
      left: ${Math.round((100 - APPLIANCE_INDETERMINATE_FRACTION * 100) / 2)}%;
    }

    @keyframes appliance-sweep {
      0% {
        transform: translateX(-100%);
      }
      50% {
        transform: translateX(${Math.round(100 / APPLIANCE_INDETERMINATE_FRACTION - 100)}%);
      }
      100% {
        transform: translateX(-100%);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .bar-fill.indeterminate {
        animation: none;
        left: ${Math.round((100 - APPLIANCE_INDETERMINATE_FRACTION * 100) / 2)}%;
      }

      .bar-fill {
        transition: none;
      }
    }

    /* ---- wave indicators ---- */
    /* The wavy bar is an SVG, not a filled box: it needs a transparent host
       tall enough for the amplitude, with no rounding to clip the stroke. */
    .bar.wavy {
      height: ${APPLIANCE_BAR_SVG_HEIGHT}px;
      border-radius: 0;
      overflow: visible;
      background: none;
    }

    .wave-svg {
      display: block;
      width: 100%;
      overflow: visible;
    }

    .wave-active {
      stroke: var(--m3a-accent);
      stroke-width: ${APPLIANCE_BAR_HEIGHT}px;
      stroke-linecap: round;
    }

    .wave-track {
      stroke: color-mix(in srgb, var(--m3p-secondary-text) 16%, transparent);
      stroke-width: ${APPLIANCE_BAR_HEIGHT}px;
      stroke-linecap: round;
    }

    .wave-dot {
      fill: var(--m3a-accent);
    }

    /* On a slider the rail is the humidifier's thickness, not the bar's. */
    .slider .wave-active,
    .slider .wave-track {
      stroke-width: ${APPLIANCE_SLIDER_TRACK}px;
    }

    .slider .wave-svg {
      position: absolute;
      inset: 0;
      height: 100%;
      pointer-events: none;
    }

    /* ---- sliders ---- */
    .slider {
      position: relative;
      height: ${APPLIANCE_SLIDER_HEIGHT}px;
      cursor: pointer;
      touch-action: none;
      outline: none;
    }

    .slider:focus-visible {
      outline: 2px solid var(--m3a-accent);
      outline-offset: 3px;
      border-radius: 8px;
    }

    .slider-track,
    .slider-fill {
      position: absolute;
      top: 50%;
      left: 0;
      height: ${APPLIANCE_SLIDER_TRACK}px;
      border-radius: ${APPLIANCE_SLIDER_TRACK / 2}px;
      transform: translateY(-50%);
      pointer-events: none;
    }

    .slider-track {
      right: 0;
      background: color-mix(in srgb, var(--m3p-secondary-text) 22%, transparent);
    }

    .slider-fill {
      background: var(--m3a-accent);
    }

    .slider-handle {
      position: absolute;
      top: 50%;
      width: ${APPLIANCE_HANDLE_WIDTH}px;
      height: ${APPLIANCE_HANDLE_HEIGHT}px;
      border-radius: ${APPLIANCE_HANDLE_RADIUS}px;
      background: var(--m3p-text, var(--primary-text-color));
      transform: translate(-50%, -50%);
      pointer-events: none;
    }

    /* ---- pill rows ---- */
    .pill-row {
      display: flex;
      gap: 6px;
    }

    .pill-row.wrap {
      flex-wrap: wrap;
    }

    .option-pill,
    .action-btn {
      flex: 1 1 auto;
      min-width: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      border: none;
      cursor: pointer;
      color: var(--m3p-text, var(--primary-text-color));
      font-family: inherit;
      transition:
        border-radius 0.35s ${EASING},
        background 0.35s ${EASING},
        color 0.35s ${EASING};
    }

    .option-pill:disabled,
    .action-btn:disabled {
      cursor: default;
    }

    .option-pill {
      flex-direction: column;
      gap: 2px;
      height: ${APPLIANCE_OPTION_HEIGHT}px;
      padding: 0 10px;
      border-radius: ${APPLIANCE_OPTION_RADIUS}px;
      background: var(--m3a-pill-tint);
    }

    .option-pill ha-icon {
      --mdc-icon-size: 16px;
      width: 16px;
      height: 16px;
    }

    .option-pill.active {
      border-radius: ${APPLIANCE_OPTION_RADIUS_ACTIVE}px;
      background: var(--m3a-pill);
      color: var(--m3a-pill-ink);
    }

    .action-btn {
      height: ${APPLIANCE_BUTTON_HEIGHT}px;
      padding: 0 14px;
      border-radius: ${APPLIANCE_BUTTON_RADIUS}px;
      background: var(--m3a-btn-tint);
      color: var(--m3a-btn-fg);
      font-weight: 600;
    }

    .action-btn ha-icon {
      --mdc-icon-size: 18px;
      width: 18px;
      height: 18px;
    }

    .action-btn.active {
      border-radius: ${APPLIANCE_BUTTON_RADIUS_ACTIVE}px;
      background: var(--m3a-btn);
      color: var(--m3a-btn-ink);
    }

    .action-btn.dimmed {
      opacity: 0.4;
    }

    /* On a narrow card the pills stop sharing a line: at 300px, three action
       buttons side by side leave room for about four characters each. */
    .narrow .action-btn,
    .narrow .option-pill {
      flex-basis: 100%;
    }

    .pill-label {
      font-size: 11px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 100%;
    }

    .action-btn .pill-label {
      font-size: 13px;
    }

    .dropdown {
      width: 100%;
      height: 40px;
      border-radius: 14px;
      border: none;
      padding: 0 12px;
      font-family: inherit;
      font-size: 13px;
      color: var(--m3p-text, var(--primary-text-color));
      background: color-mix(in srgb, var(--m3p-secondary-text) 8%, transparent);
    }


    /* A tile sets its name, value and icon colours itself, so the fill's ink
       has to reach them too: a switched-on tile kept light text on its light
       fill and could not be read. */
    .chip.tile.control.active .tile-name,
    .chip.tile.control.active .tile-value,
    .chip.tile.control.active .tile-icon {
      color: var(--m3a-chip-ink);
    }

    .chip.tile.control.active .tile-name {
      opacity: 0.8;
    }

    .chip.tile.control.active .tile-icon {
      background: color-mix(in srgb, var(--m3a-chip-ink) 12%, transparent);
    }

    .option-pill:focus-visible,
    .action-btn:focus-visible,
    .chip.control:focus-visible {
      outline: 2px solid var(--m3a-accent);
      outline-offset: 2px;
    }

    .no-animations .option-pill,
    .no-animations .action-btn,
    .no-animations .chip,
    .no-animations .bar-fill {
      transition: none;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-appliance-card": M3ApplianceCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-appliance-card",
  name: "M3 Appliance Card",
  description:
    "One appliance, with its status and its everyday controls on the same card: progress, sliders, programme pills, action buttons and status chips.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
