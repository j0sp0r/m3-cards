import { LitElement, html, svg, css, nothing, unsafeCSS, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HaActionConfig,
  HomeAssistant,
  LovelaceCard,
  LovelaceGridOptions,
  M3PrinterCardConfig,
  PrinterBlock,
  PrinterSecondaryAction,
} from "./types";
import {
  NEW_CARD_ACCENT,
  DEFAULT_PRINTER_ICON,
  DEFAULT_PRINTER_RADIUS,
  PRINTER_BUTTON_HEIGHT,
  PRINTER_BUTTON_PRESS_MS,
  PRINTER_BUTTON_RADIUS_PRESSED,
  PRINTER_ICON_TINT,
  PRINTER_OPTIMISTIC_MS,
  PRINTER_PENDING_OPACITY,
  PRINTER_PRIMARY_RADIUS,
  PRINTER_SECONDARY_RADIUS,
  PRINTER_SECONDARY_TINT,
  PRINTER_STOP_TINT,
  PRINTER_AMS_BAR_HEIGHT,
  PRINTER_AMS_PADDING,
  PRINTER_AMS_RADIUS,
  PRINTER_AMS_SWATCH,
  PRINTER_AMS_SWATCH_RADIUS,
  PRINTER_AMS_TINT,
  PRINTER_CAMERA_ASPECT,
  PRINTER_CAMERA_BADGE_RADIUS,
  PRINTER_CAMERA_BUTTON,
  PRINTER_CAMERA_BUTTON_RADIUS,
  PRINTER_CAMERA_BUTTON_RADIUS_ACTIVE,
  PRINTER_CAMERA_RADIUS,
  PRINTER_CAMERA_REFRESH_S,
  PRINTER_FILAMENT_WARN,
  PRINTER_HEATING_DELTA,
  PRINTER_NARROW_PX,
  PRINTER_SPEED_HEIGHT,
  PRINTER_SPEED_RADIUS,
  PRINTER_SPEED_RADIUS_ACTIVE,
  PRINTER_TEMP_LABEL_SIZE,
  PRINTER_TEMP_PADDING,
  PRINTER_TEMP_RADIUS,
  PRINTER_TEMP_TINT,
  PRINTER_TEMP_VALUE_SIZE,
  PRINTER_WAVE_AMPLITUDE,
  PRINTER_WAVE_GAP,
  PRINTER_WAVE_STROKE,
  PRINTER_WAVE_SVG_HEIGHT,
  PRINTER_WAVE_WAVELENGTH,
  PRINTER_WAVE_PHASE_SPEED,
  PRINTER_WAVE_AMPLITUDE_LERP,
  PRINTER_PROGRESS_PILL_HEIGHT,
  PRINTER_PROGRESS_PILL_RADIUS,
  PRINTER_ACCESSORY_HEIGHT,
  PRINTER_ACCESSORY_ICON,
  PRINTER_ACCESSORY_ICON_RADIUS,
  PRINTER_ACCESSORY_ICON_RADIUS_ON,
  PRINTER_ACCESSORY_RADIUS,
  PRINTER_DETAIL_CHIP_HEIGHT,
  PRINTER_DETAIL_CHIP_RADIUS,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import { STANDARD_EASING, isReducedMotion } from "./shared/animation";
import { runHaAction, isActionable } from "./shared/actions";
import { cardHeaderStyles, renderCardHeader } from "./shared/card-header";
import { inkOn, resolveCommonColors, resolveThemeColor, tintOn } from "./shared/color-config";
import { formatClock, formatDuration, formatNumber } from "./shared/formatting";
import { buildWavePath } from "./shared/wave";
import { VisibleTicker } from "./shared/visible-ticker";
import { glassCardClass, glassCardStyles, renderMissingEntity } from "./shared/glass-card";
import { OptimisticState } from "./shared/optimistic-state";
import { confirmDialogStyles, renderConfirmDialog, type ConfirmRequest } from "./shared/confirm-dialog";
import { syncDialogOpenState } from "./shared/popup-card";
import { foldHides, readCollapsed, writeCollapsed, type CollapseTarget } from "./shared/collapse-state";
import { detailsToggleStyles, renderDetailsToggle } from "./shared/fold-arrow";
import { hassChangeMatters } from "./shared/should-update";
import { infoChipStyles, renderInfoChips } from "./shared/info-chips";
import { TemplatedCard } from "./shared/templated-card";
import {
  discoverPrinter,
  isRunning,
  optimisticPrinterState,
  primaryIntent,
  printerStateColor,
  printerStateIcon,
  resolveAmsTray,
  resolvePrinterState,
  type DiscoveredPrinter,
  type PrinterState,
} from "./shared/printer";
import { openEntityDetail } from "./shared/entity-detail";

/**
 * A 3D printer as one card instead of sixteen tiles.
 *
 * Built against Bambu Lab's integration and deliberately not tied to it: every
 * block beyond the header and the buttons is optional, and the one thing that
 * would otherwise hard-code a vendor — what "printing" is called — is a
 * configurable `state_map` with a table of known values behind it.
 *
 * THE STATE IS THE LAYOUT
 *
 * The reason this card exists is that a printer spends most of its life idle,
 * and sixteen tiles reporting "unavailable" is what a dashboard looks like
 * when nobody thought about that. So the state decides what is drawn: a
 * printing machine shows its job, an idle one shows what it last did, an
 * offline one shows almost nothing — except the socket switch, because that is
 * the one control that can bring it back.
 */
@customElement("m3-printer-card")
export class M3PrinterCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3PrinterCardConfig;
  @state() private _tick = 0;
  /** The question currently on screen, if any. */
  @state() private _confirm?: ConfirmRequest;
  /** Bumped by the ticker so the camera still gets a fresh URL. */
  @state() private _cameraTick = 0;
  /** Whether the card is folded down to its header and controls. */
  @state() private _folded = false;
  private _ticker = new VisibleTicker(this, () => {
    this._cameraTick++;
  });

  // ---- the progress wave's own animation state -------------------------------
  //
  // Kept out of Lit's reactive state on purpose. The wave moves every frame, and
  // a reactive write per frame is sixty renders a second of a card that has not
  // changed; the frame callback writes one path attribute instead, the way the
  // light card's slider does.
  /** Measured in real pixels; the only piece of this that renders. */
  @state() private _waveWidth = 0;
  private _waveObserver?: ResizeObserver;
  private _waveObserved?: Element;
  private _wavePhase = 0;
  /** What is painted, easing towards `_waveTarget`. */
  private _waveAmplitude = PRINTER_WAVE_AMPLITUDE;
  /** Full height while printing, flat while paused. */
  private _waveTarget = PRINTER_WAVE_AMPLITUDE;
  private _waveDrawn = false;
  private _waveGeom?: { end: number; mid: number };
  private _waveTicker = new VisibleTicker(this, () => this._tickWave());
  private _waveTicking = false;

  private _optimistic = new OptimisticState<PrinterState>({
    ttlMs: PRINTER_OPTIMISTIC_MS,
    // An error or a disconnect always wins: those are the two a user must not
    // be kept from seeing for the sake of a smooth animation.
    overriding: ["error", "offline"],
    onExpire: () => {
      this._tick++;
    },
  });
  private _discovered?: DiscoveredPrinter;
  private _discoveredFor?: string;

  public static async getConfigElement(): Promise<import("./types").LovelaceCardEditor> {
    await import("./m3-printer-card-editor");
    return document.createElement(
      "m3-printer-card-editor",
    ) as unknown as import("./types").LovelaceCardEditor;
  }

  public static getStubConfig(hass: HomeAssistant): M3PrinterCardConfig {
    const entity =
      Object.keys(hass.states).find((e) => /printer|_3d|bambu/i.test(e) && e.startsWith("sensor.")) ??
      Object.keys(hass.states).find((e) => /printer/i.test(e));
    return { type: "custom:m3-printer-card", entity: entity ?? "" };
  }

  public setConfig(config: M3PrinterCardConfig): void {
    if (!config.entity) throw new Error("m3-printer-card: 'entity' is required");
    this._config = config;
    this._folded = config.collapsible ? readCollapsed(this.hass, this._foldTarget) : false;
    this._discovered = undefined;
    this._discoveredFor = undefined;
    this._optimistic.clear();
  }

  public getCardSize(): number {
    return 6;
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: 12, min_columns: 6, min_rows: 3 };
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this._ticker.setCadence("second");
    this._ticker.connect();
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._ticker.disconnect();
    this._optimistic.clear();
    this._confirm = undefined;
    this._setWaveTicking(false);
    this._waveObserver?.disconnect();
    this._waveObserved = undefined;
  }

  /**
   * A native <dialog> is opened imperatively, not by an attribute, so the
   * pending question and the element's own state are reconciled here.
   */
  protected updated(): void {
    syncDialogOpenState(
      this.renderRoot.querySelector("dialog.m3-confirm") as HTMLDialogElement | null,
      this._confirm !== undefined,
    );
    this._syncWave();
    if (!this._config?.collapsible) return;
    // An entity-backed fold can be changed from another dashboard or by an
    // automation, so it is re-read rather than only written on a tap.
    const wanted = readCollapsed(this.hass, this._foldTarget);
    if (wanted !== this._folded) this._folded = wanted;
  }

  /** Same keys and the same storage as the vacuum cards, so the suite folds one way. */
  private get _foldTarget(): CollapseTarget {
    return {
      entity: this._config?.collapse_state_entity,
      storageKey: `m3-printer-folded:${location.pathname}:${this._config?.entity ?? ""}`,
      defaultCollapsed: this._config?.default_collapsed,
      memory: this._config?.collapse_memory,
    };
  }

  private _toggleFold = (e: Event): void => {
    e.stopPropagation();
    this._folded = !this._folded;
    writeCollapsed(this.hass, this._foldTarget, this._folded);
  };

  protected shouldUpdate(changed: PropertyValues): boolean {
    return hassChangeMatters(changed, this.hass, this._watched());
  }

  /**
   * Everything the render path reads, which is more than the job.
   *
   * Under-declaring here is the one way this optimisation breaks, and the
   * accessories are where it bites: a socket toggled while the printer is idle
   * changes nothing else on the card, so without them in the list the row keeps
   * saying "Off" after the switch has gone on.
   */
  private _watched(): (string | undefined)[] {
    const d = this._entities();
    const cfg = this._config;
    return [
      cfg?.entity,
      this._entity("stage_entity", "stage"),
      this._entity("progress_entity", "progress"),
      this._entity("remaining_entity", "remaining"),
      this._entity("job_name_entity", "jobName"),
      this._entity("layer_entity", "layer"),
      this._entity("total_layers_entity", "totalLayers"),
      this._entity("nozzle_temp_entity", "nozzleTemp"),
      this._entity("nozzle_target_entity", "nozzleTarget"),
      this._entity("bed_temp_entity", "bedTemp"),
      this._entity("bed_target_entity", "bedTarget"),
      this._entity("chamber_temp_entity", "chamberTemp"),
      this._entity("speed_entity", "speed"),
      this._entity("speed_state_entity", "speedState"),
      this._entity("camera_entity", "camera"),
      this._entity("light_entity", "light"),
      this._entity("power_entity", "power"),
      this._entity("start_time_entity", "startTime"),
      this._entity("end_time_entity", "endTime"),
      d?.online,
      d?.error,
      ...(cfg?.chips ?? []).map((c) => ("entity" in c ? c.entity : undefined)),
      ...(d?.amsSlots ?? []).flatMap((slot) => [
        slot.entity,
        slot.type,
        slot.color,
        slot.remaining,
      ]),
      ...(cfg?.ams_slots ?? []).flatMap((slot) => [
        slot.type_entity,
        slot.color_entity,
        slot.remaining_entity,
      ]),
      ...(cfg?.accessories ?? []).flatMap((a) => [a.entity, a.power_entity]),
    ];
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private get _t() {
    return (key: TranslationKey): string => localize(key, this._language);
  }

  /**
   * Companion entities, cached per printer. The walk is over the whole entity
   * registry, so doing it on every `hass` tick would be wasteful — and the
   * result only changes when the device's entities do.
   */
  private _entities(): DiscoveredPrinter | undefined {
    const entity = this._config?.entity;
    if (!entity || !this.hass) return undefined;
    if (this._discoveredFor !== entity || !this._discovered) {
      this._discovered = discoverPrinter(this.hass, entity);
      this._discoveredFor = entity;
    }
    return this._discovered;
  }

  /** An explicit override always wins over what was found on the device. */
  private _entity(
    override: keyof M3PrinterCardConfig,
    found: keyof DiscoveredPrinter,
  ): string | undefined {
    const explicit = this._config?.[override];
    if (typeof explicit === "string" && explicit) return explicit;
    const value = this._entities()?.[found];
    return typeof value === "string" ? value : undefined;
  }

  private _stateOf(entityId: string | undefined): string | undefined {
    if (!entityId) return undefined;
    const raw = this.hass?.states[entityId]?.state;
    return raw === "unknown" || raw === "unavailable" ? undefined : raw;
  }

  private _numeric(entityId: string | undefined): number | undefined {
    if (!entityId) return undefined;
    const value = parseFloat(this.hass?.states[entityId]?.state ?? "");
    return isNaN(value) ? undefined : value;
  }

  // ---- state ------------------------------------------------------------------

  /**
   * The printer's state.
   *
   * Read from the stage entity when there is one and from the card's own
   * entity otherwise — a stage sensor says "heatbed_preheating" where a status
   * sensor says "printing", and the finer word makes the better status line
   * without changing which of the six states it maps to.
   */
  private _resolve(): { state: PrinterState; pending: boolean; actual: PrinterState } {
    const raw =
      this._stateOf(this._entity("stage_entity", "stage")) ??
      this.hass?.states[this._config!.entity]?.state;
    const actual = resolvePrinterState(raw, this._config?.state_map);
    // An explicit offline signal beats whatever the stage still reports: a
    // printer that has been unplugged often leaves its last stage behind.
    const online = this._entity("online_entity", "online");
    const offline = online ? this.hass?.states[online]?.state === "off" : false;
    const settled = offline ? "offline" : actual;
    const { value, pending } = this._optimistic.resolve(settled);
    return { state: value, pending, actual: settled };
  }

  // ---- actions ----------------------------------------------------------------

  private _run(action: HaActionConfig | undefined, fallback?: () => void, entityId?: string): void {
    if (!action) {
      fallback?.();
      return;
    }
    if (!isActionable(action) || !this.hass) return;
    runHaAction(this.hass, action, {
      source: this,
      entityId: entityId ?? this._config!.entity,
      openPopup: () => this._fireMoreInfo(this._config?.entity),
      fireMoreInfo: (id) => this._fireMoreInfo(id),
      navigate: (path) => {
        window.history.pushState(null, "", path);
        this.dispatchEvent(
          new CustomEvent("location-changed", {
            bubbles: true,
            composed: true,
            detail: { replace: false },
          }),
        );
      },
    });
  }

  private _fireMoreInfo(entityId: string | undefined): void {
    openEntityDetail(this, entityId);
  }

  /**
   * Runs the primary command and paints its outcome at once.
   *
   * The optimistic state is set before the call, so the button has already
   * changed by the time the round-trip starts — setting it afterwards would
   * put a frame of the old state on screen.
   */
  private _primary(): void {
    const { state } = this._resolve();
    const intent = primaryIntent(state, this._canStart);
    if (intent === "none") return;
    if (intent === "confirm") {
      this._fireMoreInfo(this._entity("error_entity", "error") ?? this._config?.entity);
      return;
    }
    this._optimistic.set(optimisticPrinterState(intent, state));
    this.requestUpdate();
    const cfg = this._config!;
    const d = this._entities();
    if (intent === "pause") this._run(cfg.pause_action, this._pressOr(d?.pauseButton));
    else if (intent === "resume") this._run(cfg.resume_action, this._pressOr(d?.resumeButton));
    else this._run(cfg.start_action, () => this._fireMoreInfo(cfg.entity));
  }

  /**
   * What a job control does when no action is configured: press the button
   * the integration publishes for it, or open the printer's details.
   *
   * Pause and resume used to have no fallback at all. With nothing configured
   * a tap did nothing — except set the optimistic state, so the card said
   * "Paused" for thirty-five seconds while the printer printed on. A control
   * that lies is worse than one that opens a dialog.
   */
  private _pressOr(button: string | undefined): () => void {
    return () => {
      if (button && this.hass) {
        this.hass.callService("button", "press", { entity_id: button });
        return;
      }
      this._fireMoreInfo(this._config?.entity);
    };
  }

  /** Whether an action is configured and does something. */
  private _hasAction(action: HaActionConfig | undefined): boolean {
    return action !== undefined && action.action !== "none";
  }

  /**
   * Whether idle and finished get a primary button at all.
   *
   * Only when a `start_action` says what starting would do — see
   * `primaryIntent`. An action explicitly set to `none` is a way of saying "no
   * button", so it does not count.
   */
  private get _canStart(): boolean {
    const action = this._config?.start_action;
    return action !== undefined && action.action !== "none";
  }

  /**
   * Stopping asks first.
   *
   * A stop throws away hours of work and a spool's worth of filament, and the
   * button sits next to Pause on a surface people tap while walking past it.
   * This used to be a two-tap arm, which is not a confirmation: it asks the
   * same question twice and never says what the answer costs. A dialog does
   * both, and cannot be dismissed by a stray tap in the same place.
   */
  private _stop(): void {
    const cfg = this._config!;
    const send = () => this._run(cfg.stop_action, this._pressOr(this._entities()?.stopButton));
    if (cfg.confirm_stop === false) {
      send();
      return;
    }
    this._confirm = {
      title: this._t("printer_stop_confirm"),
      message: this._t("printer_stop_confirm_body"),
      confirmLabel: this._t("printer_stop"),
      cancelLabel: this._t("printer_cancel"),
      icon: "mdi:stop",
      onConfirm: send,
    };
  }

  // ---- camera -----------------------------------------------------------------

  /**
   * The chamber view.
   *
   * A still by default, not a stream. A printer's camera runs on the printer's
   * own CPU and bandwidth, and a dashboard left open on a wall tablet would
   * hold that open for hours while the machine has better uses for it —
   * `camera_live` opts in.
   *
   * The refresh is driven by VisibleTicker, so it stops when the card scrolls
   * off screen or the tab is hidden. A layer takes longer than the interval
   * anyway, so there is nothing to miss.
   */
  private _renderCamera(state: PrinterState) {
    if (this._config?.show_camera === false) return nothing;
    // A printer switched off has no picture worth showing: the still is the
    // last frame from before the power went, and the chamber light cannot be
    // switched on either. The block goes with the machine and comes back with it.
    if (state === "offline") return nothing;
    const entityId = this._entity("camera_entity", "camera");
    if (!entityId) return nothing;
    const cameraState = this.hass?.states[entityId];
    const picture = cameraState?.attributes.entity_picture as string | undefined;
    if (!picture) return nothing;

    const live = this._config?.camera_live === true && entityId.startsWith("camera.");
    const refresh = (this._config?.camera_refresh ?? PRINTER_CAMERA_REFRESH_S) * 1000;
    // An image entity's state is the timestamp of the picture, so it is the
    // better cache key than a clock: it changes exactly when there is
    // something new. A camera entity has no such state, hence the bucket.
    const bucket =
      entityId.startsWith("image.")
        ? (cameraState!.state ?? "")
        : String(Math.floor((this._cameraTick * 1000) / Math.max(1000, refresh)));

    const lightEntity = this._entity("light_entity", "light");
    const lightOn = lightEntity ? this.hass?.states[lightEntity]?.state === "on" : false;
    const running = isRunning(state);

    return html`
      <div class="camera">
        <img
          class=${lightEntity && !lightOn ? "dim" : ""}
          src=${`${picture}${picture.includes("?") ? "&" : "?"}m3=${bucket}`}
          alt=""
        />
        <!-- The badge says which of the two this is. Labelling a ten-second
             still "LIVE" is how a stopped print looks like a working one: the
             picture simply does not change, and the badge insists it should. -->
        <div class="cam-badge">
          <span class="dot ${running && live ? "live" : ""}"></span>
          ${this._t(live ? "printer_live" : "printer_still")}
        </div>
        <div class="cam-actions">
          ${lightEntity
            ? html`
                <button
                  class="cam-btn ${lightOn ? "on" : ""}"
                  aria-pressed=${lightOn ? "true" : "false"}
                  aria-label=${this._t("printer_light")}
                  title=${this._t("printer_light")}
                  @click=${() =>
                    this.hass?.callService(lightEntity.split(".")[0], "toggle", {
                      entity_id: lightEntity,
                    })}
                >
                  <ha-icon icon=${lightOn ? "mdi:lightbulb-on" : "mdi:lightbulb-outline"}></ha-icon>
                </button>
              `
            : nothing}
          <button
            class="cam-btn"
            aria-label=${this._t("printer_fullscreen")}
            title=${this._t("printer_fullscreen")}
            @click=${() => this._fireMoreInfo(entityId)}
          >
            <ha-icon icon="mdi:fullscreen"></ha-icon>
          </button>
        </div>
      </div>
    `;
  }

  // ---- progress ---------------------------------------------------------------

  /** Only while a job exists. An idle printer has no progress to report, and a
   *  bar sitting at zero is worse than no bar. */
  private _renderProgress(state: PrinterState) {
    if (this._config?.show_progress === false) return nothing;
    if (!isRunning(state)) return nothing;
    const percent = this._numeric(this._entity("progress_entity", "progress"));
    if (percent === undefined) return nothing;

    // The wave flattens when paused: the shape says "stopped" before the word
    // does, and a wave that keeps rolling on a paused printer is a lie.
    // `wave_style: flat` holds it flat for good, as on the appliance card.
    const flat = this._config?.wave_style === "flat";
    this._waveTarget = state === "paused" || flat ? 0 : PRINTER_WAVE_AMPLITUDE;
    // The first paint takes the target at once. Easing there would make a card
    // that loads on a paused printer visibly settle, for no reason anyone asked.
    if (!this._waveDrawn || isReducedMotion()) this._waveAmplitude = this._waveTarget;

    const width = this._waveWidth;
    const height = PRINTER_WAVE_SVG_HEIGHT;
    const mid = height / 2;
    const gapHalf = PRINTER_WAVE_GAP / 2;
    const filledX = (Math.max(0, Math.min(100, percent)) / 100) * width;
    const end = Math.max(0, filledX - gapHalf);
    const trackStart = Math.min(width, filledX + gapHalf);
    const drawWave = width > 0 && end > 1;
    this._waveGeom = drawWave ? { end, mid } : undefined;
    if (width > 0) this._waveDrawn = true;

    const caption = this._progressCaption();

    return html`
      <div class="progress">
        <div class="wave-box">
          ${width > 0
            ? html`<svg
                class="wave"
                viewBox=${`0 0 ${width} ${height}`}
                width=${width}
                height=${height}
                aria-hidden="true"
              >
                ${trackStart < width - 1
                  ? svg`<line class="wave-rest" x1=${trackStart} y1=${mid} x2=${width} y2=${mid}></line>`
                  : nothing}
                ${drawWave
                  ? svg`<path class="wave-fill" d=${buildWavePath(0, end, this._waveAmplitude, PRINTER_WAVE_WAVELENGTH, this._wavePhase, mid)}></path>`
                  : nothing}
              </svg>`
            : nothing}
        </div>
        ${caption}
      </div>
    `;
  }

  /**
   * The two figures that used to crowd the header: the layer on the left, the
   * time left on the right. Under the wave they describe the thing they sit
   * under, and the header is left with the stage wording and a percentage pill.
   */
  private _progressCaption() {
    const layer = this._numeric(this._entity("layer_entity", "layer"));
    const total = this._numeric(this._entity("total_layers_entity", "totalLayers"));
    const remaining = this._remainingText();
    if (layer === undefined && !remaining) return nothing;

    const layerText =
      layer === undefined
        ? ""
        : total !== undefined && total > 0
          ? this._t("printer_layer_of")
              .replace("{n}", String(Math.round(layer)))
              .replace("{total}", String(Math.round(total)))
          : this._t("printer_layer").replace("{n}", String(Math.round(layer)));

    return html`
      <div class="progress-caption">
        <span>${layerText}</span>
        ${remaining
          ? html`<span class="progress-left">${this._t("printer_remaining_left").replace("{t}", remaining)}</span>`
          : nothing}
      </div>
    `;
  }

  // ---- the wave's frame loop ----------------------------------------------------

  /**
   * Starts the frame loop while there is something to move and stops it once
   * there is not. Called after every render; cheap when nothing changes.
   */
  private _syncWave(): void {
    const box = this.renderRoot.querySelector(".wave-box");
    if (box && box !== this._waveObserved) {
      this._waveObserver ??= new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect.width ?? 0;
        if (w && Math.abs(w - this._waveWidth) > 0.5) this._waveWidth = w;
      });
      if (this._waveObserved) this._waveObserver.unobserve(this._waveObserved);
      this._waveObserver.observe(box);
      this._waveObserved = box;
      // Measured once synchronously as well, so the first frame has a wave in it
      // rather than an empty box waiting for the observer.
      const w = box.getBoundingClientRect().width;
      if (w && Math.abs(w - this._waveWidth) > 0.5) this._waveWidth = w;
    } else if (!box && this._waveObserved) {
      this._waveObserver?.unobserve(this._waveObserved);
      this._waveObserved = undefined;
      this._waveDrawn = false;
    }

    const easing = Math.abs(this._waveAmplitude - this._waveTarget) > 0.01;
    this._setWaveTicking(
      !!this._waveGeom && !isReducedMotion() && (this._waveTarget > 0 || easing),
    );
  }

  private _setWaveTicking(on: boolean): void {
    if (on === this._waveTicking) return;
    this._waveTicking = on;
    if (on) {
      this._waveTicker.setCadence("frame");
      this._waveTicker.connect();
    } else {
      this._waveTicker.disconnect();
    }
  }

  private _tickWave(): void {
    const geom = this._waveGeom;
    if (!geom) {
      this._setWaveTicking(false);
      return;
    }
    let changed = false;
    const delta = this._waveTarget - this._waveAmplitude;
    if (Math.abs(delta) > 0.01) {
      this._waveAmplitude += delta * PRINTER_WAVE_AMPLITUDE_LERP;
      changed = true;
    } else if (this._waveAmplitude !== this._waveTarget) {
      this._waveAmplitude = this._waveTarget;
      changed = true;
    }
    // Only a wave with height flows. A flat line with a moving phase is still a
    // flat line, and a paused printer should look still.
    if (this._waveTarget > 0) {
      this._wavePhase -= PRINTER_WAVE_PHASE_SPEED;
      changed = true;
    }
    if (!changed) {
      // Settled flat after a pause: nothing left to draw until the state moves.
      this._setWaveTicking(false);
      return;
    }
    this.renderRoot
      .querySelector(".wave-fill")
      ?.setAttribute(
        "d",
        buildWavePath(0, geom.end, this._waveAmplitude, PRINTER_WAVE_WAVELENGTH, this._wavePhase, geom.mid),
      );
  }

  // ---- temperatures -----------------------------------------------------------

  private _renderTemps() {
    if (this._config?.show_temps === false) return nothing;
    const tiles = [
      {
        key: "printer_nozzle" as TranslationKey,
        icon: "mdi:thermometer",
        color: "#e57368",
        value: this._numeric(this._entity("nozzle_temp_entity", "nozzleTemp")),
        target: this._numeric(this._entity("nozzle_target_entity", "nozzleTarget")),
      },
      {
        key: "printer_bed" as TranslationKey,
        icon: "mdi:grill",
        color: "#f0a24a",
        value: this._numeric(this._entity("bed_temp_entity", "bedTemp")),
        target: this._numeric(this._entity("bed_target_entity", "bedTarget")),
      },
      {
        key: "printer_chamber" as TranslationKey,
        icon: "mdi:cube-outline",
        color: "#5dcaa5",
        value: this._numeric(this._entity("chamber_temp_entity", "chamberTemp")),
        target: undefined,
      },
    ].filter((t) => t.value !== undefined);
    if (!tiles.length) return nothing;

    return html`
      <div class="temps">
        ${tiles.map((tile) => {
          // Still heating: the value pulses rather than a second badge
          // appearing, because the number is already the thing being watched.
          const heating =
            tile.target !== undefined && tile.target > 0 && tile.value! < tile.target - PRINTER_HEATING_DELTA;
          return html`
            <div
              class="temp"
              style=${`background: color-mix(in srgb, ${tile.color} ${PRINTER_TEMP_TINT}%, transparent);`}
            >
              <ha-icon style=${`color: ${tile.color};`} icon=${tile.icon}></ha-icon>
              <div class="temp-value ${heating ? "heating" : ""}" style=${`color: ${tile.color};`}>
                ${formatNumber(this._language, tile.value!, { maximumFractionDigits: 0 })}<span
                  class="temp-unit"
                  >°C</span
                >
              </div>
              <div class="temp-label">
                ${this._t(tile.key)}${tile.target !== undefined && tile.target > 0
                  ? ` · ${this._t("printer_target").replace("{n}", String(Math.round(tile.target)))}`
                  : ""}
              </div>
            </div>
          `;
        })}
      </div>
    `;
  }

  // ---- speed profile ----------------------------------------------------------

  private _renderSpeed(state: PrinterState) {
    if (this._config?.show_speed === false) return nothing;
    const entityId = this._entity("speed_entity", "speed");
    const readoutId = this._entity("speed_state_entity", "speedState");
    const entity = entityId ? this.hass?.states[entityId] : undefined;
    const readout = readoutId ? this.hass?.states[readoutId] : undefined;

    // Two entities, one answer. Bambu's `select` is unavailable in some
    // connection modes while the printer prints on perfectly well, and a row of
    // four pills with none of them lit reads as "no profile" rather than as
    // "cannot be changed from here". So the value comes from whichever entity
    // has one, and only the *changing* depends on the select being there.
    const usable = (value?: string) =>
      value !== undefined && value !== "unavailable" && value !== "unknown";
    const selectable = usable(entity?.state);
    const current = selectable ? entity!.state : readout?.state;

    const options = ((entity?.attributes.options ?? readout?.attributes.options) ??
      undefined) as string[] | undefined;
    if (!options || options.length < 2) return nothing;

    const icons: Record<string, string> = {
      silent: "mdi:volume-off",
      quiet: "mdi:volume-off",
      standard: "mdi:speedometer",
      normal: "mdi:speedometer",
      sport: "mdi:rocket-launch-outline",
      ludicrous: "mdi:fire",
      extreme: "mdi:fire",
    };

    return html`
      <div class="section-label">${this._t("printer_speed")}</div>
      <div class="speed-row">
        ${options.map((option) => {
          const active = current === option;
          const key = option.toLowerCase();
          const translated = this._t(`printer_speed_${key}` as TranslationKey);
          const label = translated === `printer_speed_${key}` ? option : translated;
          return html`
            <button
              class="speed ${active ? "active" : ""} ${selectable ? "" : "readonly"}"
              ?disabled=${state === "offline" || !selectable}
              aria-pressed=${active ? "true" : "false"}
              @click=${() =>
                this.hass?.callService("select", "select_option", {
                  entity_id: entityId!,
                  option,
                })}
            >
              <ha-icon icon=${icons[key] ?? "mdi:speedometer"}></ha-icon>
              <span class="speed-label">${label}</span>
            </button>
          `;
        })}
      </div>
    `;
  }

  // ---- AMS --------------------------------------------------------------------

  /**
   * The filament trays.
   *
   * The swatch is filled with the tray's own colour, which is the one piece of
   * information here that a label cannot carry: "PLA" is four characters, but
   * which of the two PLA spools is the blue one is a question only the colour
   * answers.
   */
  private _renderAms() {
    if (this._config?.show_ams === false) return nothing;
    const configured = this._config?.ams_slots;
    const slots = configured?.length
      ? configured.map((slot) => ({
          type: slot.type_entity,
          color: slot.color_entity,
          remaining: slot.remaining_entity,
          // Doubles as the attribute source, so naming only `type_entity` is
          // enough for an integration that puts everything on one entity.
          entity: slot.type_entity ?? slot.color_entity ?? slot.remaining_entity,
        }))
      : (this._entities()?.amsSlots ?? []);
    if (!slots.length) return nothing;

    const warn = this._config?.filament_warn ?? PRINTER_FILAMENT_WARN;

    return html`
      <div class="section-label">${this._t("printer_ams")}</div>
      <div class="ams">
        ${slots.map((slot) => {
          // Three entities where an integration splits a tray, the tray
          // entity's own attributes where it does not — Bambu publishes one
          // sensor per slot and hangs type, colour and remaining off it.
          const { material, color: colour, remaining, empty } = resolveAmsTray({
            state: slot.entity ? this.hass?.states[slot.entity] : undefined,
            material: this._stateOf(slot.type),
            color: this._stateOf(slot.color),
            remaining: this._numeric(slot.remaining),
          });
          // A colour sensor reports a hex, sometimes with an alpha byte the
          // browser would read as a fifth digit; the first six are the colour.
          const swatch = colour
            ? colour.startsWith("#")
              ? colour.slice(0, 7)
              : `#${colour.slice(0, 6)}`
            : undefined;

          return html`
            <div
              class="ams-slot ${empty ? "empty" : ""}"
              role=${slot.entity ? "button" : nothing}
              tabindex=${slot.entity ? "0" : nothing}
              @click=${() => this._fireMoreInfo(slot.entity)}
            >
              <div
                class="ams-swatch ${empty ? "empty" : ""}"
                style=${!empty && swatch ? `background: ${swatch};` : ""}
              ></div>
              <div class="ams-head">
                <span class="ams-name">${empty ? this._t("printer_ams_empty") : material}</span>
                ${!empty && remaining !== undefined
                  ? html`<span class="ams-remaining ${remaining < warn ? "low" : ""}"
                      >${formatNumber(this._language, remaining, { maximumFractionDigits: 0 })}<span
                        class="ams-unit"
                        >%</span
                      ></span
                    >`
                  : nothing}
              </div>
              ${!empty && remaining !== undefined
                ? html`
                    <div class="ams-track">
                      <div
                        class="ams-fill ${remaining < warn ? "low" : ""}"
                        style=${`width: ${Math.max(0, Math.min(100, remaining))}%;`}
                      ></div>
                    </div>
                  `
                : nothing}
            </div>
          `;
        })}
      </div>
    `;
  }

  // ---- details ----------------------------------------------------------------

  /**
   * The drawer: everything true but not urgent.
   *
   * It stays closed by default because none of it changes what you would do
   * next — and it is the one block that survives `offline`, because the socket
   * switch lives in it and that is the only control that can bring the printer
   * back.
   */
  private _renderDetails(state: PrinterState) {
    if (this._config?.show_details === false) return nothing;
    const chips = this._detailChips(state);
    const accessories = this._config?.accessories ?? [];
    if (!chips.length && !accessories.length) return nothing;

    // No drawer of its own any more. It used to open and close with a button
    // and a chevron of its own, a second fold inside a card the suite folds
    // from its header — two different gestures for the same thing. It is a
    // block like the others now, and the card-level fold decides.
    return html`
      <div class="details">
        <div class="section-label">${this._t("printer_details")}</div>
        ${chips.length
          ? html`<div class="detail-chips">
              ${chips.map(
                (chip) => html`
                  <span class="detail-chip ${chip.tone}">
                    <ha-icon icon=${chip.icon}></ha-icon>
                    <span>${chip.text}</span>
                  </span>
                `,
              )}
            </div>`
          : nothing}
        ${accessories.length
          ? html`<div class="accessories">
              ${accessories.map((a) => this._renderAccessory(a))}
            </div>`
          : nothing}
      </div>
    `;
  }

  private _detailChips(
    state: PrinterState,
  ): { icon: string; text: string; tone: "plain" | "ok" | "error" }[] {
    const chips: { icon: string; text: string; tone: "plain" | "ok" | "error" }[] = [];
    // A timestamp sensor formatted by Home Assistant carries its full date,
    // which inside a chip saying when the print finishes is nine words for one
    // number. `formatClock` drops today's date and keeps tomorrow's.
    const fmt = (entityId: string | undefined) => {
      if (!entityId) return undefined;
      const entity = this.hass?.states[entityId];
      const raw = this._stateOf(entityId);
      if (!entity || !raw) return undefined;
      return (
        formatClock(raw, this._language) ?? this.hass?.formatEntityState?.(entity) ?? entity.state
      );
    };

    const start = fmt(this._entity("start_time_entity", "startTime"));
    if (start && isRunning(state)) {
      chips.push({
        icon: "mdi:clock-start",
        text: this._t("printer_started").replace("{when}", start),
        tone: "plain",
      });
    }
    const end = fmt(this._entity("end_time_entity", "endTime"));
    if (end && isRunning(state)) {
      chips.push({
        icon: "mdi:clock-end",
        text: this._t("printer_ends").replace("{when}", end),
        tone: "plain",
      });
    }
    const power = this._numeric(this._entity("power_entity", "power"));
    if (power !== undefined) {
      chips.push({
        icon: "mdi:flash",
        text: `${formatNumber(this._language, power, { maximumFractionDigits: 0 })} W`,
        tone: "plain",
      });
    }
    const onlineEntity = this._entity("online_entity", "online");
    if (onlineEntity) {
      const online = this.hass?.states[onlineEntity]?.state === "on";
      chips.push({
        icon: online ? "mdi:wifi" : "mdi:wifi-off",
        text: this._t(online ? "printer_online" : "printer_offline_chip"),
        tone: online ? "plain" : "error",
      });
    }
    // The error chip is the one that earns the drawer: "no errors" is worth
    // saying once you have opened it, and an actual fault is shown in full
    // rather than as a count.
    const errorEntity = this._entity("error_entity", "error");
    if (errorEntity) {
      const raw = this.hass?.states[errorEntity];
      const value = this._stateOf(errorEntity);
      const clean = !value || value === "off" || value === "0" || value === "none";
      chips.push({
        icon: clean ? "mdi:check-circle-outline" : "mdi:alert-circle-outline",
        text: clean
          ? this._t("printer_no_errors")
          : (this.hass?.formatEntityState?.(raw!) ?? value!),
        tone: clean ? "ok" : "error",
      });
    }
    return chips;
  }

  private _renderAccessory(accessory: import("./types").PrinterAccessoryConfig) {
    const entity = this.hass?.states[accessory.entity];
    const on = entity?.state === "on";
    const name = accessory.name ?? entity?.attributes.friendly_name ?? accessory.entity;
    const power = this._numeric(accessory.power_entity);
    const colour = accessory.color ? resolveThemeColor(accessory.color) : "var(--m3pr-accent)";
    const right =
      power !== undefined && on
        ? `${formatNumber(this._language, power, { maximumFractionDigits: 0 })} W`
        : this._t(on ? "printer_online" : "printer_off");

    return html`
      <button
        class="accessory ${on ? "on" : ""}"
        ?disabled=${!entity}
        style=${on ? `--m3pr-acc: ${colour};` : ""}
        @click=${() => this._toggleAccessory(accessory, on, name)}
      >
        <span class="accessory-icon">
          <ha-icon icon=${accessory.icon ?? "mdi:power-plug-outline"}></ha-icon>
        </span>
        <span class="accessory-name">${name}</span>
        <span class="accessory-value">${right}</span>
      </button>
    `;
  }

  /**
   * Switching an accessory *off* asks first; switching one on does not.
   *
   * The asymmetry is the whole point. Turning the socket on costs nothing, and
   * it is the one control that works while the printer is unreachable — making
   * the way back slower would be the wrong trade. Turning it off in the middle
   * of a ten-hour print costs the print, and the row sits in a drawer people
   * scroll past.
   */
  private _toggleAccessory(
    accessory: import("./types").PrinterAccessoryConfig,
    on: boolean,
    name: string,
  ): void {
    const send = () =>
      this.hass?.callService(accessory.entity.split(".")[0], "toggle", {
        entity_id: accessory.entity,
      });
    if (!on || this._config?.confirm_power_off === false) {
      send();
      return;
    }
    this._confirm = {
      title: this._t("printer_off_confirm").replace("{name}", name),
      message: this._t("printer_off_confirm_body"),
      confirmLabel: this._t("printer_switch_off"),
      cancelLabel: this._t("printer_cancel"),
      icon: accessory.icon ?? "mdi:power-plug-off-outline",
      onConfirm: send,
    };
  }

  /** Further readings at the foot of the card, as on the appliance card. */
  private _renderChips() {
    const chips = renderInfoChips(this._config?.chips, {
      host: this,
      hass: this.hass,
      language: this._language,
      style: this._config?.chip_style,
      accent: this._config?.accent_color ?? NEW_CARD_ACCENT,
      run: (action, entityId) => this._run(action, undefined, entityId),
    });
    return chips === nothing ? nothing : html`<div class="chips">${chips}</div>`;
  }

  // ---- render -----------------------------------------------------------------

  protected render() {
    if (!this._config || !this.hass) return nothing;
    if (!this.hass.states[this._config.entity]) {
      return renderMissingEntity(this._config.entity);
    }

    const { state, pending } = this._resolve();
    const colors = resolveCommonColors(this._config);
    const accent = this._config.accent_color
      ? resolveThemeColor(this._config.accent_color)
      : printerStateColor(state);
    const radius = `${this._config.radius ?? DEFAULT_PRINTER_RADIUS}px`;
    // Header and controls never fold. Of the rest, the fold takes what
    // `collapse_blocks` names — or everything. While the printer is offline the
    // details and the chips stay whatever the config says, because the socket
    // lives there and it is the only control that can bring the machine back.
    // Cleared before the blocks draw, so a folded or finished progress block
    // leaves no geometry behind for the frame loop to keep animating.
    this._waveGeom = undefined;
    // Only the details are held open. The chips were too, for a socket given
    // as a tile, but a card folded on purpose then sprang open with every
    // tile the moment the printer was switched off; the chevron reaches the
    // socket just as well, and the card stays as it was left.
    const pinned: PrinterBlock[] = state === "offline" ? ["details"] : [];
    // Every block is drawn first and the fold decides afterwards, so the card
    // knows whether folding would take anything at all. A chevron over a card
    // whose foldable blocks are all empty — an idle printer with no camera —
    // looked broken, the same fault the appliance card had on a dryer.
    const bodies: [PrinterBlock, unknown][] = [
      ["camera", this._renderCamera(state)],
      ["progress", this._renderProgress(state)],
      ["temps", this._renderTemps()],
      ["speed", this._renderSpeed(state)],
      ["ams", this._renderAms()],
      ["details", this._renderDetails(state)],
      ["chips", this._renderChips()],
    ];
    const foldable =
      !!this._config.collapsible &&
      bodies.some(([block, body]) => body !== nothing && foldHides(block, true, this._config!.collapse_blocks, pinned));
    const folded = foldable && this._folded;
    const hidden = (block: PrinterBlock): boolean =>
      foldHides(block, folded, this._config!.collapse_blocks, pinned);
    // A folded progress block leaves no geometry behind for the frame loop.
    if (hidden("progress")) this._waveGeom = undefined;
    const body = (block: PrinterBlock): unknown =>
      hidden(block) ? nothing : bodies.find(([b]) => b === block)![1];

    return html`
      <ha-card
        class=${state === "offline" ? "offline" : state === "error" ? "errored" : ""}
        style=${(() => {
          const iconBg = tintOn(this, accent, this._config!.accent_opacity, PRINTER_ICON_TINT);
          return (
            `--m3pr-accent: ${accent}; --m3pr-ink: ${inkOn(accent, this)}; ` +
            `--m3p-icon-bg: ${iconBg}; --m3p-icon-color: ${accent}; ` +
            `border-radius: ${radius};`
          );
        })()}
      >
        <div
          class="card-inner ${glassCardClass(this._config.glass_background)}"
          style=${`border-radius: ${radius};${
            colors.cardBackgroundCss ? ` background: ${colors.cardBackgroundCss};` : ""
          }`}
        >
          ${body("camera")}
          ${this._renderHeader(state)}
          ${body("progress")}
          ${body("temps")}
          ${this._renderControls(state, pending)}
          ${body("speed")}
          ${body("ams")}
          ${body("details")}
          ${body("chips")}
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
      <!-- Outside the card, not inside it: a modal dialog is painted in the
           top layer either way, but ha-card's offline dimming is a plain
           opacity rule on its children and would take the question with it. -->
      ${renderConfirmDialog({
        request: this._confirm,
        host: this,
        onCancel: () => {
          this._confirm = undefined;
        },
      })}
    `;
  }

  private _renderHeader(state: PrinterState) {
    const cfg = this._config!;
    const running = isRunning(state);

    let name = cfg.name ?? this._stateOf(this._entity("job_name_entity", "jobName")) ?? "";
    if (!name) name = this._t("printer_no_job");
    if (cfg.strip_extension !== false) name = name.replace(/\.(3mf|gcode|gco|bgcode)$/i, "");

    // The status line prefers the printer's own stage wording — "heatbed
    // preheating" says more than "printing" — and falls back to the generic
    // state when there is none.
    const stageEntity = this._entity("stage_entity", "stage");
    const stageState = stageEntity ? this.hass?.states[stageEntity] : undefined;
    const stageText =
      stageState && this._stateOf(stageEntity)
        ? (this.hass?.formatEntityState?.(stageState) ?? stageState.state)
        : this._t(`printer_${state}` as TranslationKey);

    // The stage wording alone. Layer and time left moved under the wave, where
    // they describe the thing they sit under; together with the percentage they
    // pushed the stage off the end of the line on a phone.
    const subtitle = stageText;

    const progress = this._numeric(this._entity("progress_entity", "progress"));
    // A pill, as the vacuum card shows its battery. Next to the fold chevron a
    // loose two-line figure read as crammed; a contained shape does not.
    const readout =
      running && progress !== undefined
        ? html`
            <div class="progress-pill">
              ${formatNumber(this._language, progress, { maximumFractionDigits: 0 })}<span
                class="percent-unit"
                >%</span
              >
            </div>
          `
        : nothing;
    const trailing = readout !== nothing ? html`<div class="header-trailing">${readout}</div>` : undefined;

    return renderCardHeader({
      icon: cfg.icon ?? printerStateIcon(state) ?? DEFAULT_PRINTER_ICON,
      name,
      subtitle,
      onClick: () => this._run(cfg.tap_action, () => this._fireMoreInfo(cfg.entity)),
      right: trailing,
    });
  }

  /**
   * "Time remaining", in whatever unit the firmware thinks in.
   *
   * Bambu reports hours as a float, so the raw state of a job a minute from
   * finishing is `0.0166666666666667` — which is what the header showed. The
   * sensor's own unit is what turns that into a number of minutes; an
   * integration that already formats the value itself has no unit and falls
   * through to whatever it wrote.
   */
  private _remainingText(): string | undefined {
    const entityId = this._entity("remaining_entity", "remaining");
    if (!entityId) return undefined;
    const entity = this.hass?.states[entityId];
    const raw = this._stateOf(entityId);
    if (!entity || !raw) return undefined;
    return (
      formatDuration(raw, entity.attributes.unit_of_measurement as string | undefined, {
        hm: this._t("printer_remaining_hm"),
        m: this._t("printer_remaining_m"),
      }) ??
      this.hass?.formatEntityState?.(entity) ??
      raw
    );
  }

  private _renderControls(state: PrinterState, pending: boolean) {
    const cfg = this._config!;
    const intent = primaryIntent(state, this._canStart);
    // Offline is the one state with no controls at all — nothing the card can
    // send will reach the machine. The socket switch lives in the details
    // block, which stays live, and that is the way back.
    if (state === "offline") return nothing;

    const label =
      intent === "pause"
        ? this._t("printer_pause")
        : intent === "resume"
          ? this._t("printer_resume")
          : intent === "confirm"
            ? this._t("printer_confirm_error")
            : this._t("printer_start");
    const icon =
      intent === "pause"
        ? "mdi:pause"
        : intent === "confirm"
          ? "mdi:alert-circle-outline"
          : "mdi:play";

    // Stop alone by default. Files and filament were in this list, and with no
    // action behind them both opened the same details dialog — two buttons that
    // looked different and did the same thing, with no label on a phone to say
    // what either was meant for.
    const secondary = cfg.secondary_actions ?? (["stop"] as const);

    // No primary button rather than a disabled one: an idle printer with no
    // start action has nothing to press, and a greyed-out Start invites the
    // question of why it is greyed out. The secondaries carry the row alone.
    // With neither, there is no row: an empty one still took the card's gap,
    // and a folded idle printer stood 12px taller than the appliances beside
    // it, with the space under its icon.
    const secondaries = (secondary as readonly PrinterSecondaryAction[]).filter((action) =>
      this._secondaryApplies(action, state),
    );
    if (intent === "none" && secondaries.length === 0) return nothing;
    return html`
      <div class="controls">
        ${intent === "none"
          ? nothing
          : html`
              <button
                class="primary ${pending ? "pending" : ""}"
                @click=${() => this._primary()}
              >
                <ha-icon icon=${icon}></ha-icon>
                <span>${label}</span>
              </button>
            `}
        ${secondaries.map((action) => this._renderSecondary(action))}
      </div>
    `;
  }

  /**
   * A control that cannot do anything is not drawn — in this state, or at all.
   *
   * Stop counts as able when a `stop_action` is configured or the integration
   * publishes a stop button; the others only with an action of their own. A
   * button with nothing behind it would fall back to opening details, which is
   * a way of drawing a button that is not one.
   */
  private _secondaryApplies(action: PrinterSecondaryAction, state: PrinterState): boolean {
    const cfg = this._config!;
    switch (action) {
      case "stop":
        return isRunning(state) && (this._hasAction(cfg.stop_action) || !!this._entities()?.stopButton);
      case "preheat":
        return !isRunning(state) && this._hasAction(cfg.preheat_action);
      case "files":
        return this._hasAction(cfg.files_action);
      case "filament":
        return this._hasAction(cfg.filament_action);
      default:
        return false;
    }
  }

  private _renderSecondary(action: PrinterSecondaryAction) {
    const cfg = this._config!;
    const spec: Record<
      PrinterSecondaryAction,
      { icon: string; key: TranslationKey; run: () => void }
    > = {
      stop: { icon: "mdi:stop", key: "printer_stop", run: () => this._stop() },
      files: {
        icon: "mdi:file-document-outline",
        key: "printer_files",
        run: () => this._run(cfg.files_action, () => this._fireMoreInfo(cfg.entity)),
      },
      filament: {
        icon: "mdi:swap-horizontal",
        key: "printer_filament",
        run: () => this._run(cfg.filament_action, () => this._fireMoreInfo(cfg.entity)),
      },
      preheat: {
        icon: "mdi:fire",
        key: "printer_preheat",
        run: () => this._run(cfg.preheat_action, () => this._fireMoreInfo(cfg.entity)),
      },
    };
    const { icon, key, run } = spec[action];
    const label = this._t(key);

    return html`
      <button
        class="secondary ${action === "stop" ? "stop" : ""}"
        aria-label=${label}
        title=${label}
        @click=${run}
      >
        <ha-icon icon=${icon}></ha-icon>
      </button>
    `;
  }

  static styles = [
    glassCardStyles,
    cardHeaderStyles,
    confirmDialogStyles,
    detailsToggleStyles,
    infoChipStyles,
    css`
      ha-card {
        color: var(--m3p-text, var(--primary-text-color));
        overflow: hidden;
      }

      /* Grey, not red: a printer at the wall socket is a normal state, not a
         fault, and painting it as one trains people to ignore red.
         The details block is exempt, and that is the point of the rule: the
         socket switch lives in there and it is the only control that can
         bring the printer back. Dimming it would make the one thing that
         still works look like the things that do not. */
      ha-card.offline .card-inner > *:not(.details) {
        opacity: 0.4;
      }

      ha-card.errored {
        outline: 2px solid var(--m3pr-accent);
        outline-offset: -2px;
      }

      .card-inner {
        display: flex;
        flex-direction: column;
        gap: var(--m3-card-gap, 12px);
        /* The suite's card padding, as the appliance card has it, so the two
           fold to the same height side by side. */
        padding: var(--m3-group-padding, 12px);
        box-sizing: border-box;
        /* The narrow-layout rules below measure the card's own column, not the
           viewport — a printer card in a two-column grid on a desktop is as
           narrow as one on a phone. Without this the @container rules would
           silently never match. */
        container-type: inline-size;
      }

      /* The vacuum card's battery pill, holding the percentage instead. */
      .progress-pill {
        flex: 0 0 auto;
        height: ${unsafeCSS(PRINTER_PROGRESS_PILL_HEIGHT)}px;
        border-radius: ${unsafeCSS(PRINTER_PROGRESS_PILL_RADIUS)}px;
        padding: 0 12px;
        display: inline-flex;
        align-items: baseline;
        justify-content: center;
        line-height: ${unsafeCSS(PRINTER_PROGRESS_PILL_HEIGHT)}px;
        color: var(--m3pr-accent);
        background: color-mix(in srgb, var(--m3pr-accent) 14%, transparent);
        font-size: 14px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }

      .percent-unit {
        font-size: 11px;
        font-weight: 600;
        margin-left: 1px;
      }

      .controls {
        display: flex;
        align-items: stretch;
        gap: 8px;
      }

      .primary {
        flex: 2;
        min-width: 0;
        height: ${unsafeCSS(PRINTER_BUTTON_HEIGHT)}px;
        border: none;
        border-radius: ${unsafeCSS(PRINTER_PRIMARY_RADIUS)}px;
        background: var(--m3pr-accent);
        color: var(--m3pr-ink);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        font-family: inherit;
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
        --mdc-icon-size: 20px;
        transition:
          border-radius ${unsafeCSS(PRINTER_BUTTON_PRESS_MS)}ms ${unsafeCSS(STANDARD_EASING)},
          background 0.25s ${unsafeCSS(STANDARD_EASING)},
          opacity 0.2s linear;
      }

      /* Showing something the printer has not confirmed yet. Dimmed, not
         disabled: tapping again should work if the first one was lost. */
      .primary.pending {
        opacity: ${unsafeCSS(PRINTER_PENDING_OPACITY)};
      }

      .primary:active,
      .secondary:active {
        border-radius: ${unsafeCSS(PRINTER_BUTTON_RADIUS_PRESSED)}px;
      }

      .primary:disabled {
        cursor: default;
        opacity: 0.4;
      }

      .secondary {
        flex: 1;
        min-width: 0;
        height: ${unsafeCSS(PRINTER_BUTTON_HEIGHT)}px;
        border: none;
        border-radius: ${unsafeCSS(PRINTER_SECONDARY_RADIUS)}px;
        background: color-mix(
          in srgb,
          var(--m3p-text, currentColor) ${unsafeCSS(PRINTER_SECONDARY_TINT)}%,
          transparent
        );
        color: var(--m3p-secondary-text, var(--secondary-text-color));
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        --mdc-icon-size: 22px;
        transition:
          border-radius ${unsafeCSS(PRINTER_BUTTON_PRESS_MS)}ms ${unsafeCSS(STANDARD_EASING)},
          background 0.25s ${unsafeCSS(STANDARD_EASING)},
          color 0.25s ${unsafeCSS(STANDARD_EASING)};
      }

      .secondary.stop {
        background: color-mix(in srgb, #e57368 ${unsafeCSS(PRINTER_STOP_TINT)}%, transparent);
        color: #e57368;
      }

      .camera {
        position: relative;
        aspect-ratio: ${unsafeCSS(PRINTER_CAMERA_ASPECT)};
        border-radius: ${unsafeCSS(PRINTER_CAMERA_RADIUS)}px;
        overflow: hidden;
        background: color-mix(in srgb, var(--m3p-text, currentColor) 6%, transparent);
        line-height: 0;
      }

      .camera img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transition: filter 0.3s ${unsafeCSS(STANDARD_EASING)};
      }

      /* With the chamber light off the picture is dark anyway; dimming it
         further makes the light button's effect obvious before it is pressed. */
      .camera img.dim {
        filter: brightness(0.55);
      }

      .cam-badge {
        position: absolute;
        top: 8px;
        left: 8px;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: 24px;
        padding: 0 9px;
        border-radius: ${unsafeCSS(PRINTER_CAMERA_BADGE_RADIUS)}px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.04em;
        line-height: 1;
        color: #fff;
        background: rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(6px);
      }

      .cam-badge .dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #8a8a8a;
      }

      /* Red only while a stream is actually live — a still image is not. */
      .cam-badge .dot.live {
        background: #e57368;
      }

      .cam-actions {
        position: absolute;
        top: 8px;
        right: 8px;
        display: flex;
        gap: 6px;
      }

      .cam-btn {
        width: ${unsafeCSS(PRINTER_CAMERA_BUTTON)}px;
        height: ${unsafeCSS(PRINTER_CAMERA_BUTTON)}px;
        border: none;
        border-radius: ${unsafeCSS(PRINTER_CAMERA_BUTTON_RADIUS)}px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        color: #fff;
        background: rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(6px);
        --mdc-icon-size: 18px;
        transition: border-radius 0.35s ${unsafeCSS(STANDARD_EASING)},
          background 0.25s ${unsafeCSS(STANDARD_EASING)};
      }

      .cam-btn.on {
        border-radius: ${unsafeCSS(PRINTER_CAMERA_BUTTON_RADIUS_ACTIVE)}px;
        background: #f0c46e;
        color: #1c1c1c;
      }

      .progress {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      /* Measured, not stretched: the SVG is drawn at this box's real width. */
      .wave-box {
        height: ${unsafeCSS(PRINTER_WAVE_SVG_HEIGHT)}px;
      }

      .wave {
        display: block;
        overflow: visible;
      }

      .progress-caption {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        font-size: 11px;
        font-variant-numeric: tabular-nums;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
      }

      .progress-left {
        white-space: nowrap;
      }

      .wave-fill {
        fill: none;
        stroke: var(--m3pr-accent);
        stroke-width: ${unsafeCSS(PRINTER_WAVE_STROKE)};
        stroke-linecap: round;
        vector-effect: non-scaling-stroke;
      }

      .wave-rest {
        stroke: color-mix(in srgb, var(--m3p-text, currentColor) 12%, transparent);
        stroke-width: ${unsafeCSS(PRINTER_WAVE_STROKE)};
        stroke-linecap: round;
        vector-effect: non-scaling-stroke;
      }

      .temps {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
        gap: 6px;
      }

      .temp {
        padding: ${unsafeCSS(PRINTER_TEMP_PADDING)}px;
        border-radius: ${unsafeCSS(PRINTER_TEMP_RADIUS)}px;
        text-align: center;
        --mdc-icon-size: 14px;
      }

      .temp-value {
        font-size: ${unsafeCSS(PRINTER_TEMP_VALUE_SIZE)}px;
        font-weight: 700;
        line-height: 1.2;
      }

      .temp-unit {
        font-size: 10px;
        font-weight: 600;
        opacity: 0.7;
        margin-left: 1px;
      }

      .temp-value.heating {
        animation: m3pr-pulse 1.6s ease-in-out infinite;
      }

      @keyframes m3pr-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.45; }
      }

      .temp-label {
        font-size: ${unsafeCSS(PRINTER_TEMP_LABEL_SIZE)}px;
        opacity: 0.5;
      }

      .section-label {
        font-size: 11px;
        font-weight: 600;
        opacity: 0.55;
        margin-bottom: -6px;
      }

      .speed-row {
        display: flex;
        gap: 6px;
      }

      .speed {
        flex: 1;
        min-width: 0;
        height: ${unsafeCSS(PRINTER_SPEED_HEIGHT)}px;
        border: none;
        border-radius: ${unsafeCSS(PRINTER_SPEED_RADIUS)}px;
        background: color-mix(in srgb, var(--m3p-text, currentColor) 7%, transparent);
        color: var(--m3p-secondary-text, var(--secondary-text-color));
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1px;
        padding: 0 4px;
        font-family: inherit;
        cursor: pointer;
        --mdc-icon-size: 16px;
        transition: border-radius 0.35s ${unsafeCSS(STANDARD_EASING)},
          background 0.25s ${unsafeCSS(STANDARD_EASING)},
          color 0.25s ${unsafeCSS(STANDARD_EASING)};
      }

      .speed.active {
        border-radius: ${unsafeCSS(PRINTER_SPEED_RADIUS_ACTIVE)}px;
        background: var(--m3pr-accent);
        color: var(--m3pr-ink);
      }

      /* Readable but not settable: the integration's select is unavailable in
         this connection mode while the sensor still reports the profile. The
         active pill keeps its full colour — the value is real, it is only the
         changing that is not on offer — and the rest step back so the row does
         not invite a tap it cannot honour. */
      .speed.readonly {
        cursor: default;
      }

      .speed.readonly:not(.active) {
        opacity: 0.55;
      }

      .speed-label {
        font-size: 8px;
        font-weight: 600;
        max-width: 100%;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .ams {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(74px, 1fr));
        gap: 6px;
      }

      .ams-slot {
        padding: ${unsafeCSS(PRINTER_AMS_PADDING)}px;
        border-radius: ${unsafeCSS(PRINTER_AMS_RADIUS)}px;
        background: color-mix(
          in srgb,
          var(--m3p-text, currentColor) ${unsafeCSS(PRINTER_AMS_TINT)}%,
          transparent
        );
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 5px;
        cursor: pointer;
      }

      .ams-swatch {
        width: ${unsafeCSS(PRINTER_AMS_SWATCH)}px;
        height: ${unsafeCSS(PRINTER_AMS_SWATCH)}px;
        border-radius: ${unsafeCSS(PRINTER_AMS_SWATCH_RADIUS)}px;
        border: 1.5px solid color-mix(in srgb, var(--m3p-text, currentColor) 22%, transparent);
        box-sizing: border-box;
      }

      /* An empty tray is drawn as an outline, not as a grey fill: grey is a
         filament colour, and a dashed hole is not. */
      .ams-swatch.empty {
        border-style: dashed;
        background: transparent;
      }

      /* Material and remaining share one line. Below the bar they would cost a
         third row on a tile that is 74px wide at its narrowest, and the number
         belongs with the name it qualifies rather than under a graph of it. */
      .ams-head {
        display: flex;
        align-items: baseline;
        justify-content: center;
        gap: 3px;
        max-width: 100%;
        min-width: 0;
      }

      .ams-name {
        font-size: 9px;
        font-weight: 700;
        opacity: 0.85;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
      }

      /* Tabular figures so the numbers do not shuffle sideways as the spool
         runs down from 100 to 99 to 9. */
      .ams-remaining {
        flex: 0 0 auto;
        font-size: 9px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        opacity: 0.6;
      }

      /* Below the warning threshold the number carries the same amber as the
         bar, at full strength — that is the one reading worth looking up for. */
      .ams-remaining.low {
        color: #f0a24a;
        opacity: 1;
      }

      .ams-unit {
        margin-left: 1px;
        font-size: 7px;
        opacity: 0.75;
      }

      .ams-slot.empty .ams-name {
        font-weight: 500;
        opacity: 0.45;
      }

      .ams-track {
        width: 100%;
        height: ${unsafeCSS(PRINTER_AMS_BAR_HEIGHT)}px;
        border-radius: ${unsafeCSS(PRINTER_AMS_BAR_HEIGHT)}px;
        background: color-mix(in srgb, var(--m3p-text, currentColor) 10%, transparent);
        overflow: hidden;
      }

      .ams-fill {
        height: 100%;
        border-radius: inherit;
        background: #81c784;
      }

      .ams-fill.low {
        background: #f0a24a;
      }

      /* Narrow column: the temperatures stack and the speed pills lose their
         labels rather than truncating them to two characters. */
      @container (max-width: ${unsafeCSS(PRINTER_NARROW_PX)}px) {
        .temps {
          grid-template-columns: 1fr;
        }
        .speed-label {
          display: none;
        }
      }

      /* The gap matches the card's own, so this block's label sits as far from
         its content as "AMS" and "Speed" do from theirs. It was 6px, which the
         label's -6px margin cancelled to nothing: the heading sat on the chips. */
      .details {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      /* The progress figure and the fold chevron share the header's trailing
         slot. Centred on each other, so the chevron does not ride up to the
         percentage's baseline when the remaining time adds a second line. */
      .header-trailing {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .detail-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      /* Status, not controls — so a rim and no fill, the same rule as the
         vacuum card's chips. The switches underneath are the things to press. */
      .detail-chip {
        box-sizing: border-box;
        height: ${unsafeCSS(PRINTER_DETAIL_CHIP_HEIGHT)}px;
        border-radius: ${unsafeCSS(PRINTER_DETAIL_CHIP_RADIUS)}px;
        padding: 0 12px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        font-weight: 500;
        --mdc-icon-size: 14px;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
        background: transparent;
        border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
      }

      .detail-chip.ok {
        color: #81c784;
        background: color-mix(in srgb, #81c784 6%, transparent);
      }

      .detail-chip.error {
        color: #e57368;
        background: color-mix(in srgb, #e57368 8%, transparent);
        border-color: color-mix(in srgb, #e57368 45%, transparent);
      }

      .accessories {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .accessory {
        height: ${unsafeCSS(PRINTER_ACCESSORY_HEIGHT)}px;
        border: none;
        border-radius: ${unsafeCSS(PRINTER_ACCESSORY_RADIUS)}px;
        padding: 0 10px;
        background: color-mix(in srgb, var(--m3p-text, currentColor) 5%, transparent);
        color: var(--m3p-text, var(--primary-text-color));
        display: flex;
        align-items: center;
        gap: 10px;
        font-family: inherit;
        cursor: pointer;
        transition: background 0.25s ${unsafeCSS(STANDARD_EASING)};
      }

      .accessory:disabled {
        cursor: default;
        opacity: 0.4;
      }

      .accessory-icon {
        flex: 0 0 auto;
        width: ${unsafeCSS(PRINTER_ACCESSORY_ICON)}px;
        height: ${unsafeCSS(PRINTER_ACCESSORY_ICON)}px;
        border-radius: ${unsafeCSS(PRINTER_ACCESSORY_ICON_RADIUS)}px;
        background: color-mix(in srgb, var(--m3p-text, currentColor) 8%, transparent);
        color: var(--m3p-secondary-text, var(--secondary-text-color));
        display: flex;
        align-items: center;
        justify-content: center;
        --mdc-icon-size: 17px;
        transition: border-radius 0.35s ${unsafeCSS(STANDARD_EASING)},
          background 0.25s ${unsafeCSS(STANDARD_EASING)},
          color 0.25s ${unsafeCSS(STANDARD_EASING)};
      }

      /* Switched on, the icon's container tightens — the same shape-morph the
         station tiles and the fold arrow use, so "on" looks the same
         everywhere in the suite. */
      .accessory.on .accessory-icon {
        border-radius: ${unsafeCSS(PRINTER_ACCESSORY_ICON_RADIUS_ON)}px;
        background: color-mix(in srgb, var(--m3pr-acc, var(--m3pr-accent)) 20%, transparent);
        color: var(--m3pr-acc, var(--m3pr-accent));
      }

      .accessory-name {
        flex: 1;
        text-align: left;
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .accessory-value {
        flex: 0 0 auto;
        font-size: 12px;
        font-weight: 700;
        opacity: 0.55;
      }

      .accessory.on .accessory-value {
        opacity: 1;
        color: var(--m3pr-acc, var(--m3pr-accent));
      }

      @media (prefers-reduced-motion: reduce) {
        .primary,
        .secondary {
          transition: none;
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-printer-card": M3PrinterCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-printer-card",
  name: "M3 Printer Card",
  description:
    "A 3D printer as one card instead of sixteen tiles: state, job, controls, and every companion entity found on the device. Built for Bambu Lab, usable with OctoPrint, Moonraker and Prusa via a configurable state map.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
