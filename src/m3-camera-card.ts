import { LitElement, html, css, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  CameraActionConfig,
  HaActionConfig,
  HomeAssistant,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  M3CameraCardConfig,
} from "./types";
import {
  CARD_VERSION,
  CAMERA_BATTERY_LOW,
  CAMERA_DEFAULT_ICON,
  CAMERA_DOOR_FEEDBACK_MS,
  CAMERA_DOOR_OPENING_MAX_MS,
  CAMERA_DOOR_OPENING_MIN_MS,
  CAMERA_DOOR_SPRING_EASING,
  CAMERA_DOOR_CLOSING_MS,
  CAMERA_LIVE_LINGER_MAX_MS,
  CAMERA_LIVE_START_MAX_MS,
  CAMERA_SLIDE_HANDLE,
  CAMERA_SLIDE_HEIGHT,
  CAMERA_SLIDE_PAD,
  CAMERA_SLIDE_SPRING_MS,
  CAMERA_SLIDE_THRESHOLD,
  CAMERA_MAX_ICON_BUTTONS,
  CAMERA_MOTION_COLOR,
  CAMERA_PACKAGE_COLOR,
  CAMERA_PERSON_COLOR,
  CAMERA_RING_COLOR,
  CAMERA_STAGE_RADIUS,
  DEFAULT_CAMERA_EVENTS_HOURS,
  DEFAULT_CAMERA_LIVE_IDLE_S,
  DEFAULT_CAMERA_MAX_EVENTS,
  DEFAULT_CAMERA_RADIUS,
  DEFAULT_CAMERA_RING_TIMEOUT_S,
  DEFAULT_CAMERA_SNAPSHOT_REFRESH_S,
  resolveCornerRadius,
} from "./const";
import { buildCssVars, resolveCommonColors } from "./shared/color-config";
import { glassCardClass, glassCardStyles } from "./shared/glass-card";
import { renderCardHeader, cardHeaderStyles } from "./shared/card-header";
import { shouldAnimate, STANDARD_EASING } from "./shared/animation";
import { swipeProgress } from "./shared/checkin";
import { stopSwipe } from "./shared/swipe";
import { localize, type TranslationKey } from "./localize";
import { TemplatedCard } from "./shared/templated-card";
import { hassChangeMatters } from "./shared/should-update";
import { handleAction, navigateTo } from "./shared/actions";
import { openDropdownMenu } from "./shared/dropdown-menu";
import { showSnackbar } from "./shared/snackbar";
import { confirmDialogStyles, renderConfirmDialog, type ConfirmRequest } from "./shared/confirm-dialog";
import { syncDialogOpenState } from "./shared/popup-card";
import { ensureHaCardDefined } from "./shared/card-helpers";
import { openEntityDetail } from "./shared/entity-detail";
import { cameraEntities, eventEntities, initialCamera, normalizeCameras, type CameraEntry } from "./shared/camera-config";
import {
  currentDetection,
  eventFromChange,
  eventsFromHistory,
  fillEventTemplate,
  lastRingAt,
  mergeEvents,
  type CameraEvent,
  type CameraEventKind,
  type HistoryRow,
} from "./shared/camera-events";
import { LiveController, imageRetryDelay, liveMode, playerShowsPicture, snapshotUrl } from "./shared/camera-stream";

console.info(
  `%c M3-CAMERA-CARD %c v${CARD_VERSION} `,
  "color: #222; background: #6ba7dc; font-weight: 700; border-radius: 4px 0 0 4px;",
  "color: #6ba7dc; background: #222; font-weight: 700; border-radius: 0 4px 4px 0;",
);

const KIND_ICON: Record<CameraEventKind, string> = {
  ring: "mdi:bell-ring-outline",
  door: "mdi:door-open",
  person: "mdi:account-outline",
  package: "mdi:package-variant-closed",
  motion: "mdi:run",
  other: "mdi:motion-sensor",
};

const KIND_COLOR: Record<CameraEventKind, string> = {
  ring: CAMERA_RING_COLOR,
  door: CAMERA_PERSON_COLOR,
  person: CAMERA_PERSON_COLOR,
  package: CAMERA_PACKAGE_COLOR,
  motion: CAMERA_MOTION_COLOR,
  other: CAMERA_MOTION_COLOR,
};

/** States of a feedback entity that mean "the door is open". */
const DOOR_OPEN_STATES = new Set(["on", "open", "unlocked", "opening", "unlocking"]);

/**
 * Cameras and doorbells, any vendor: a still at rest, live on demand, a ring
 * that takes the card over, and the day's events underneath. The logic lives
 * in shared/camera-config.ts, camera-events.ts and camera-stream.ts; this
 * file wires it to Home Assistant and draws it.
 */
@customElement("m3-camera-card")
export class M3CameraCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3CameraCardConfig;
  @state() private _selected?: string;
  /** Bumped to fetch a new still. */
  @state() private _tick = 0;
  @state() private _now = Date.now();
  @state() private _live = false;
  @state() private _streamReady = false;
  @state() private _imgError = false;
  /** When the still on screen was taken (loaded), epoch ms. */
  @state() private _stillAt?: number;
  @state() private _events = new Map<string, CameraEvent[]>();
  @state() private _ringCamera?: string;
  @state() private _ringAt = 0;
  @state() private _overlay = false;
  @state() private _talk = false;
  @state() private _doorUntil = 0;
  /** The camera whose door is opening: tapped, and not yet reported open. */
  @state() private _doorOpening?: string;
  /** The camera whose door just locked again: its lock snaps shut. */
  @state() private _doorClosing?: string;
  /** A drag in progress on the door slider's handle. */
  @state() private _slide?: { pointerId: number; startX: number; travel: number; progress: number; moved: boolean };
  @state() private _slideNudge = false;
  @state() private _confirm?: ConfirmRequest;
  @state() private _menuOpen = false;

  private _cameras: CameraEntry[] = [];
  private _controller = new LiveController((live) => {
    // Stopping live: the player stays up until the fresh still has loaded
    // under it, so the picture never drops to an empty stage in between.
    if (!live && this._live && this._streamPlaying) {
      this._lingering = true;
      if (this._lingerTimer !== undefined) window.clearTimeout(this._lingerTimer);
      this._lingerTimer = window.setTimeout(() => this._endLinger(), CAMERA_LIVE_LINGER_MAX_MS);
    }
    this._live = live;
    if (live) this._endLinger();
    else this._tick++;
  }, DEFAULT_CAMERA_LIVE_IDLE_S * 1000);
  /** The live player shows a picture; until then the still stays on top. */
  @state() private _streamPlaying = false;
  /** Live has stopped, and the player waits for the new still to load under it. */
  @state() private _lingering = false;
  private _lingerTimer?: number;
  private _playWatch?: number;
  private _playWatchSince = 0;
  private _historyLoaded = new Set<string>();
  private _historyLoading = new Set<string>();
  /** The ring each camera last acted on, so a ring is handled once. */
  private _handledRing = new Map<string, number>();
  private _handledDetection = new Map<string, number>();
  private _ignoredAt = 0;
  private _imgFailures = 0;
  private _refreshTimer?: number;
  private _clockTimer?: number;
  private _ringTimer?: number;
  private _retryTimer?: number;
  private _doorTimer?: number;
  private _openingTimer?: number;
  private _closingTimer?: number;
  private _lastDoorPhase = new Map<string, string>();
  private _observer?: IntersectionObserver;
  private _onScreen = true;
  private _tabVisible = true;

  public setConfig(config: M3CameraCardConfig): void {
    const cameras = normalizeCameras(config);
    if (!cameras.length) throw new Error("cameras is required: a camera.* entity, or a doorbell for an intercom without a camera");
    this._config = config;
    this._cameras = cameras;
    if (!this._selected || !cameras.some((c) => c.id === this._selected)) {
      this._selected = initialCamera(cameras, config.default_camera);
    }
    this._controller.setIdle((config.live_idle_timeout ?? DEFAULT_CAMERA_LIVE_IDLE_S) * 1000);
    this._historyLoaded.clear();
    this._events = new Map();
    this._restartRefresh();
  }

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-camera-card-editor");
    return document.createElement("m3-camera-card-editor") as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(hass?: HomeAssistant): M3CameraCardConfig {
    const camera = Object.keys(hass?.states ?? {}).find((id) => id.startsWith("camera.")) ?? "camera.front_door";
    return { type: "custom:m3-camera-card", cameras: [camera], glass_background: true };
  }

  public getCardSize(): number {
    return 6;
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: 12, rows: "auto", min_columns: 6 };
  }

  private get _lang(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey, vars?: Record<string, string | number>): string {
    let s = localize(key, this._lang);
    for (const [k, v] of Object.entries(vars ?? {})) s = s.replace(`{${k}}`, String(v));
    return s;
  }

  private get _camera(): CameraEntry | undefined {
    return this._cameras.find((c) => c.id === this._selected) ?? this._cameras[0];
  }

  private get _ringTimeoutMs(): number {
    return (this._config?.ring_timeout ?? DEFAULT_CAMERA_RING_TIMEOUT_S) * 1000;
  }

  // ---- lifetime --------------------------------------------------------

  public connectedCallback(): void {
    super.connectedCallback();
    this._tabVisible = !document.hidden;
    document.addEventListener("visibilitychange", this._onDocVisibility);
    if (typeof IntersectionObserver !== "undefined") {
      this._observer = new IntersectionObserver((entries) => {
        this._onScreen = entries.some((e) => e.isIntersecting);
        this._syncVisibility();
      });
      this._observer.observe(this);
    }
    // "just now", "3 min ago" and the end of a detection move on with the clock.
    this._clockTimer = window.setInterval(() => {
      if (this._onScreen && this._tabVisible) this._now = Date.now();
    }, 15_000);
    this._restartRefresh();
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("visibilitychange", this._onDocVisibility);
    this._observer?.disconnect();
    this._observer = undefined;
    this._controller.stop();
    this._endLinger();
    if (this._playWatch !== undefined) window.clearInterval(this._playWatch);
    this._playWatch = undefined;
    for (const t of [this._refreshTimer, this._clockTimer]) if (t !== undefined) window.clearInterval(t);
    for (const t of [this._ringTimer, this._retryTimer, this._doorTimer, this._openingTimer, this._closingTimer]) if (t !== undefined) window.clearTimeout(t);
    this._refreshTimer = this._clockTimer = this._ringTimer = this._retryTimer = this._doorTimer = this._openingTimer = this._closingTimer = undefined;
    this._doorOpening = undefined;
  }

  private _onDocVisibility = (): void => {
    this._tabVisible = !document.hidden;
    this._syncVisibility();
  };

  /** Off screen or in a background tab: no stream, no refresh. */
  private _syncVisibility(): void {
    const visible = this._onScreen && this._tabVisible;
    this._controller.setVisible(visible);
    if (visible) {
      this._now = Date.now();
      this._tick++;
    }
  }

  private _restartRefresh(): void {
    if (this._refreshTimer !== undefined) window.clearInterval(this._refreshTimer);
    this._refreshTimer = undefined;
    if (!this.isConnected) return;
    const seconds = this._config?.snapshot_refresh ?? DEFAULT_CAMERA_SNAPSHOT_REFRESH_S;
    if (seconds <= 0) return;
    this._refreshTimer = window.setInterval(() => {
      if (this._onScreen && this._tabVisible && !this._live && !this._imgError) this._tick++;
    }, seconds * 1000);
  }

  // ---- updates ---------------------------------------------------------

  protected shouldUpdate(changed: PropertyValues): boolean {
    return hassChangeMatters(changed, this.hass, this._cameras.flatMap(cameraEntities));
  }

  protected willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    if (!changed.has("hass") || !this.hass) return;
    const before = changed.get("hass") as HomeAssistant | undefined;
    const now = Date.now();
    this._now = now;

    // New events go onto the timeline without asking the history again, and
    // fetch a fresh still of the camera they belong to.
    for (const cam of this._cameras) {
      for (const entity of eventEntities(cam)) {
        const prev = before?.states[entity];
        const next = this.hass.states[entity];
        if (!before || prev === next) continue;
        const event = eventFromChange(cam, entity, prev, next);
        if (!event) continue;
        if (this._historyLoaded.has(cam.id)) {
          const list = mergeEvents(this._events.get(cam.id) ?? [], [event], this._windowStart());
          this._events = new Map(this._events).set(cam.id, list);
        }
        if (cam.id === this._selected) {
          this._imgFailures = 0;
          this._imgError = false;
          this._tick++;
        }
      }
    }

    // A feedback entity that is an event (an intercom's "unlocked"): the door
    // shows as opened for a moment after each one.
    for (const cam of this._cameras) {
      const fb = cam.door_action?.feedback_entity;
      if (!fb?.startsWith("event.") || !before || before.states[fb] === this.hass.states[fb]) continue;
      const at = Date.parse(this.hass.states[fb]?.state ?? "");
      if (!isNaN(at) && now - at < CAMERA_DOOR_FEEDBACK_MS) {
        if (this._doorOpening === cam.id) this._stopOpening();
        this._showDoorOpened(at + CAMERA_DOOR_FEEDBACK_MS - now);
      }
    }
    // A feedback entity with a state ends "opening" as soon as it reports open.
    const opening = this._cameras.find((c) => c.id === this._doorOpening);
    if (opening && this._doorOpen(opening)) this._stopOpening();

    this._checkRing(now);
    this._checkDetection(now);
  }

  /** A fresh ring switches to its camera, goes live and, if asked, opens the overlay. */
  private _checkRing(now: number): void {
    for (const cam of this._cameras) {
      const at = lastRingAt(cam, this.hass!.states);
      if (!at || now - at >= this._ringTimeoutMs || at <= (this._handledRing.get(cam.id) ?? 0)) continue;
      this._handledRing.set(cam.id, at);
      if (at <= this._ignoredAt) continue;
      if (this._selected !== cam.id) this._select(cam.id);
      this._ringCamera = cam.id;
      this._ringAt = at;
      this._talk = false;
      if (liveMode(cam.live_provider, this._featuresOf(cam)) !== "image") this._controller.start("ring");
      if (this._config?.ring_overlay === "fullscreen") this._overlay = true;
      if (this._ringTimer !== undefined) window.clearTimeout(this._ringTimer);
      this._ringTimer = window.setTimeout(() => this._endRing(), at + this._ringTimeoutMs - now + 50);
    }
  }

  private _checkDetection(now: number): void {
    const cam = this._camera;
    if (!cam || !this._config?.auto_live_on_motion || this._ringing) return;
    const det = currentDetection(cam, this.hass!.states, now, this._ringTimeoutMs);
    if (!det || det.at <= (this._handledDetection.get(cam.id) ?? 0)) return;
    this._handledDetection.set(cam.id, det.at);
    if (liveMode(cam.live_provider, this._featuresOf(cam)) !== "image") this._controller.start("motion");
  }

  private get _ringing(): boolean {
    return !!this._ringCamera && this._now < this._ringAt + this._ringTimeoutMs && this._ringAt > this._ignoredAt;
  }

  private _endRing(): void {
    this._ringTimer = undefined;
    this._ringCamera = undefined;
    this._overlay = false;
    this._talk = false;
    this._now = Date.now();
    if (this._controller.reason === "ring") this._controller.stop();
  }

  private _ignore = (): void => {
    this._ignoredAt = this._ringAt;
    if (this._ringTimer !== undefined) window.clearTimeout(this._ringTimer);
    this._endRing();
  };

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    const cam = this._camera;
    if (cam && this._config?.show_events !== false) void this._loadHistory(cam);
    if (cam?.door_action) {
      const phase = this._doorPhase(cam);
      if (this._lastDoorPhase.get(cam.id) === "open" && phase === "locked") {
        this._doorClosing = cam.id;
        if (this._closingTimer !== undefined) window.clearTimeout(this._closingTimer);
        this._closingTimer = window.setTimeout(() => {
          this._closingTimer = undefined;
          this._doorClosing = undefined;
        }, CAMERA_DOOR_CLOSING_MS);
      }
      this._lastDoorPhase.set(cam.id, phase);
    }
    if (this._live && !this._streamReady) void this._ensureStream();
    this._watchPlayer();
    // A still that is already in (same picture, nothing to fetch) fires no
    // load: the lingering player can go now.
    if (this._lingering) {
      const still = this.renderRoot.querySelector<HTMLImageElement>(".stage .still");
      if (still?.complete && still.naturalWidth > 0) this._endLinger();
    }
    syncDialogOpenState(this.renderRoot.querySelector<HTMLDialogElement>("dialog.m3-confirm"), !!this._confirm);
    const overlay = this.renderRoot.querySelector<HTMLDialogElement>("dialog.ring-overlay");
    if (overlay) {
      if (this._overlay && this._ringing && !overlay.open) overlay.showModal();
      else if ((!this._overlay || !this._ringing) && overlay.open) overlay.close();
    }
  }

  private _featuresOf(cam: CameraEntry): number {
    return cam.camera ? Number(this.hass?.states[cam.camera]?.attributes.supported_features) || 0 : 0;
  }

  private _windowStart(): number {
    return Date.now() - (this._config?.events_hours ?? DEFAULT_CAMERA_EVENTS_HOURS) * 3600_000;
  }

  /** The events of the last hours, once per camera; afterwards only added to. */
  private async _loadHistory(cam: CameraEntry): Promise<void> {
    if (!this.hass || this._historyLoaded.has(cam.id) || this._historyLoading.has(cam.id)) return;
    const ids = eventEntities(cam).filter((id) => this.hass!.states[id]);
    this._historyLoading.add(cam.id);
    const start = this._windowStart();
    const ask = async (entityIds: string[], withAttributes: boolean): Promise<Record<string, HistoryRow[]>> => {
      if (!entityIds.length) return {};
      return this.hass!.callWS<Record<string, HistoryRow[]>>({
        type: "history/history_during_period",
        start_time: new Date(start).toISOString(),
        entity_ids: entityIds,
        // An event entity's kind sits in its `event_type` attribute, which a
        // minimal response leaves out; a binary sensor needs only its state.
        minimal_response: !withAttributes,
        no_attributes: !withAttributes,
        significant_changes_only: false,
      });
    };
    try {
      const [withAttrs, plain] = await Promise.all([
        ask(ids.filter((id) => id.startsWith("event.")), true),
        ask(ids.filter((id) => !id.startsWith("event.")), false),
      ]);
      const found: CameraEvent[] = [];
      for (const [entity, rows] of Object.entries({ ...withAttrs, ...plain })) {
        found.push(...eventsFromHistory(cam, entity, rows ?? [], start));
      }
      const merged = mergeEvents(this._events.get(cam.id) ?? [], found, start);
      this._events = new Map(this._events).set(cam.id, merged);
    } catch (e) {
      console.warn("m3-camera-card: could not read the event history", e);
    } finally {
      this._historyLoading.delete(cam.id);
      this._historyLoaded.add(cam.id);
    }
  }

  /** Home Assistant defines its stream element only once a camera view needs it. */
  private async _ensureStream(): Promise<void> {
    if (customElements.get("ha-camera-stream")) {
      this._streamReady = true;
      return;
    }
    const cam = this._camera;
    if (!cam) return;
    if (!cam.camera) return;
    await ensureHaCardDefined("hui-picture-entity-card", { type: "picture-entity", entity: cam.camera, camera_view: "live" });
    const ok = await Promise.race([
      customElements.whenDefined("ha-camera-stream").then(() => true),
      new Promise<boolean>((r) => window.setTimeout(() => r(false), 8000)),
    ]);
    if (ok) this._streamReady = true;
    else console.warn("m3-camera-card: ha-camera-stream is not available; showing stills");
  }

  // ---- actions ---------------------------------------------------------

  private _select(camera: string): void {
    if (camera === this._selected) return;
    this._controller.stop();
    this._endLinger();
    this._selected = camera;
    this._imgFailures = 0;
    this._imgError = false;
    this._stillAt = undefined;
    this._talk = false;
    this._tick++;
  }

  private _toggleLive = (): void => {
    if (this._live) this._controller.stop();
    else this._controller.start("user");
  };

  private _touch = (): void => this._controller.touch();

  /**
   * Runs an action from a button the user pressed. A service call is awaited
   * so a failure can say so; the rest go through the suite's action handler.
   * Confirmation has been asked by then, in the card's own dialog.
   */
  private async _run(action: HaActionConfig | undefined, entityId?: string): Promise<boolean> {
    if (!this.hass || !action) return false;
    const plain = { ...action, confirmation: undefined } as HaActionConfig;
    if (plain.action === "perform-action" || plain.action === "call-service") {
      const [domain, service] = (plain.perform_action ?? plain.service ?? "").split(".");
      if (!domain || !service) return false;
      try {
        await this.hass.callService(domain, service, {
          ...(plain.target ? {} : entityId ? { entity_id: entityId } : {}),
          ...(plain.target ?? {}),
          ...(plain.data ?? plain.service_data ?? {}),
        });
        return true;
      } catch (e) {
        const msg = (e as { message?: string })?.message ?? String(e);
        showSnackbar({ message: this._t("camera_action_failed", { error: msg }), tone: "error" });
        return false;
      }
    }
    handleAction(this, this.hass, plain, entityId);
    return true;
  }

  /** Never without a tap: the door only opens from this button, after the question unless it is turned off. */
  private _requestDoor = (): void => {
    const cam = this._camera;
    const door = cam?.door_action;
    if (!cam || !door) return;
    const open = () => void this._openDoor(cam);
    if (door.confirmation === false) {
      open();
      return;
    }
    this._confirm = {
      title: this._t("camera_door_confirm_title"),
      message: this._t("camera_door_confirm_text", { camera: this._cameraName(cam) }),
      confirmLabel: door.name ?? this._t("camera_open_door"),
      cancelLabel: this._t("camera_cancel"),
      icon: door.icon ?? "mdi:door-open",
      destructive: false,
      onConfirm: open,
    };
  };

  /**
   * The button shows the door's way from locked to open: "opening" from the
   * tap until the door is reported open, then "opened". Without a feedback
   * entity "opening" lasts a moment, so the change can be seen; with one it
   * lasts until the entity says so, at most CAMERA_DOOR_OPENING_MAX_MS. An
   * event feedback that never comes still ends in "opened" — the call went
   * through — while a state one that never turns says nothing it cannot know.
   */
  private async _openDoor(cam: CameraEntry): Promise<void> {
    const door = cam.door_action;
    if (!door || this._doorOpening === cam.id) return;
    const fb = door.feedback_entity;
    const started = Date.now();
    this._doorOpening = cam.id;
    const ok = await this._run(door.tap_action);
    if (this._doorOpening !== cam.id) return;
    if (!ok) {
      this._stopOpening();
      return;
    }
    if (fb && !fb.startsWith("event.")) {
      if (this._doorOpen(cam)) this._stopOpening();
      else this._holdOpening(CAMERA_DOOR_OPENING_MAX_MS - (Date.now() - started), false);
      return;
    }
    if (fb) this._holdOpening(CAMERA_DOOR_OPENING_MAX_MS - (Date.now() - started), true);
    else this._holdOpening(CAMERA_DOOR_OPENING_MIN_MS - (Date.now() - started), true);
  }

  /** Keeps "opening" for `ms` more, then shows "opened" or goes back to locked. */
  private _holdOpening(ms: number, thenOpened: boolean): void {
    if (this._openingTimer !== undefined) window.clearTimeout(this._openingTimer);
    this._openingTimer = window.setTimeout(() => {
      this._stopOpening();
      if (thenOpened) this._showDoorOpened(CAMERA_DOOR_FEEDBACK_MS);
    }, Math.max(0, ms));
  }

  private _stopOpening(): void {
    if (this._openingTimer !== undefined) window.clearTimeout(this._openingTimer);
    this._openingTimer = undefined;
    this._doorOpening = undefined;
  }

  private _doorPhase(cam: CameraEntry): "locked" | "opening" | "open" {
    if (this._doorOpen(cam)) return "open";
    return this._doorOpening === cam.id ? "opening" : "locked";
  }

  /**
   * The door button, wide or round: a closed lock at rest; on a tap it takes
   * a squarer shape and the lock opens while it waits; once the door is open
   * it stays square in a lighter tone until the door closes again.
   */
  private _renderDoorButton(cam: CameraEntry, variant: "primary" | "round", extra = ""): TemplateResult {
    const door = cam.door_action!;
    const phase = this._doorPhase(cam);
    const name = door.name ?? this._t("camera_open_door");
    const icon =
      phase === "open"
        ? door.icon ? "mdi:check" : "mdi:lock-open-variant"
        : phase === "opening"
          ? door.icon ?? "mdi:lock-open-variant-outline"
          : door.icon ?? "mdi:lock-outline";
    const label = phase === "open" ? this._t("camera_door_opened") : phase === "opening" ? this._t("camera_door_opening") : name;
    const run = phase === "locked" ? this._requestDoor : undefined;
    const closing = phase === "locked" && this._doorClosing === cam.id;
    // While open on a timer, a fill drains over the time that is left; a
    // feedback entity with a state says itself when it is over, so none then.
    const fb = door.feedback_entity;
    const left = phase === "open" && !(fb && !fb.startsWith("event.")) ? Math.max(0, this._doorUntil - Date.now()) : 0;
    return html`<button
      class="${variant} door-button ${phase} ${closing ? "closing" : ""} ${left ? "timed" : ""} ${extra}"
      style=${left ? `--door-left: ${left}ms;` : nothing}
      aria-label=${label}
      title=${variant === "round" ? label : nothing}
      aria-busy=${phase === "opening" ? "true" : "false"}
      aria-disabled=${phase === "locked" ? "false" : "true"}
      @click=${() => run?.()}
    >
      <ha-icon icon=${icon}></ha-icon>
      ${variant === "primary" ? html`<span aria-live="polite">${label}</span>` : nothing}
    </button>`;
  }

  /** `style: slide`, unless motion is reduced: then there is nothing to slide, and the button asks. */
  private _slideStyle(cam: CameraEntry): boolean {
    return cam.door_action?.style === "slide" && shouldAnimate(this._config?.animation);
  }

  /**
   * The door as a lock to slide across a track. Past the threshold it opens,
   * without a question: the slide is one. Short of it the lock springs back.
   * Then it shows the same way as the button — the handle waits at the end
   * while the door opens and is open, and springs home as it locks again.
   * The keyboard gets the button's way: Enter, then the question.
   */
  private _renderDoorSlide(cam: CameraEntry): TemplateResult {
    const door = cam.door_action!;
    const phase = this._doorPhase(cam);
    const drag = phase === "locked" ? this._slide : undefined;
    const p = phase === "locked" ? (drag?.progress ?? 0) : 1;
    const closing = phase === "locked" && this._doorClosing === cam.id;
    const fb = door.feedback_entity;
    const left = phase === "open" && !(fb && !fb.startsWith("event.")) ? Math.max(0, this._doorUntil - Date.now()) : 0;
    const icon =
      phase === "open"
        ? door.icon ? "mdi:check" : "mdi:lock-open-variant"
        : phase === "opening"
          ? door.icon ?? "mdi:lock-open-variant-outline"
          : door.icon ?? "mdi:lock-outline";
    const label =
      phase === "open" ? this._t("camera_door_opened") : phase === "opening" ? this._t("camera_door_opening") : door.name ?? this._t("camera_door_slide");
    const handleStyle = drag ? `left: ${CAMERA_SLIDE_PAD + drag.travel * drag.progress}px;` : "";
    return html`<div
      class="door-slide ${phase} ${drag ? "dragging" : ""} ${closing ? "closing" : ""} ${left ? "timed" : ""} ${this._slideNudge ? "nudge" : ""}"
      role="button"
      tabindex=${phase === "locked" ? "0" : "-1"}
      aria-label=${label}
      aria-busy=${phase === "opening" ? "true" : "false"}
      aria-disabled=${phase === "locked" ? "false" : "true"}
      style=${`--p: ${p};${left ? ` --door-left: ${left}ms;` : ""}`}
      @keydown=${(e: KeyboardEvent) => {
        if ((e.key !== " " && e.key !== "Enter") || phase !== "locked") return;
        e.preventDefault();
        this._requestDoor();
      }}
    >
      <span class="slide-label" aria-live="polite">${label}</span>
      <div
        class="swiper slide-handle"
        style=${handleStyle}
        @pointerdown=${(e: PointerEvent) => this._slideStart(e, phase === "locked")}
        @pointermove=${this._slideMove}
        @pointerup=${(e: PointerEvent) => this._slideEnd(e, cam, false)}
        @pointercancel=${(e: PointerEvent) => this._slideEnd(e, cam, true)}
        @touchstart=${stopSwipe}
        @touchmove=${stopSwipe}
        @touchend=${stopSwipe}
        @mousedown=${stopSwipe}
        @mousemove=${stopSwipe}
        @mouseup=${stopSwipe}
      >
        <ha-icon icon=${icon}></ha-icon>
      </div>
    </div>`;
  }

  private _slideStart(e: PointerEvent, allowed: boolean): void {
    if (!allowed || this._slide) return;
    const handle = e.currentTarget as HTMLElement;
    const track = handle.parentElement;
    if (!track) return;
    e.preventDefault();
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // A pointer the browser no longer knows; the drag still works while the finger stays on.
    }
    this._touch();
    this._slide = {
      pointerId: e.pointerId,
      startX: e.clientX,
      travel: track.clientWidth - 2 * CAMERA_SLIDE_PAD - CAMERA_SLIDE_HANDLE,
      progress: 0,
      moved: false,
    };
  }

  private _slideMove = (e: PointerEvent): void => {
    const drag = this._slide;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    const progress = swipeProgress(dx, drag.travel, false);
    if (progress === drag.progress && drag.moved) return;
    this._slide = { ...drag, progress, moved: drag.moved || Math.abs(dx) > 4 };
  };

  private _slideEnd(e: PointerEvent, cam: CameraEntry, cancelled: boolean): void {
    const drag = this._slide;
    if (!drag || e.pointerId !== drag.pointerId) return;
    this._slide = undefined;
    if (!cancelled && drag.progress >= CAMERA_SLIDE_THRESHOLD) {
      void this._openDoor(cam);
      return;
    }
    // A tap, not a slide: nudge the lock the way it goes, so the gesture explains itself.
    if (!cancelled && !drag.moved) {
      this._slideNudge = true;
      window.setTimeout(() => (this._slideNudge = false), 180);
    }
  }

  private _showDoorOpened(ms: number): void {
    this._doorUntil = Math.max(this._doorUntil, Date.now() + ms);
    if (this._doorTimer !== undefined) window.clearTimeout(this._doorTimer);
    this._doorTimer = window.setTimeout(() => {
      this._doorTimer = undefined;
      this._now = Date.now();
    }, this._doorUntil - Date.now() + 30);
  }

  private _runCustom(action: CameraActionConfig): void {
    const go = () => void this._run(action.tap_action);
    if (!action.confirmation) {
      go();
      return;
    }
    const text = typeof action.confirmation === "object" ? action.confirmation.text : undefined;
    this._confirm = {
      title: text ?? this._t("camera_confirm_title", { name: action.name ?? action.icon }),
      confirmLabel: this._t("camera_confirm_ok"),
      cancelLabel: this._t("camera_cancel"),
      icon: action.icon,
      destructive: false,
      onConfirm: go,
    };
  }

  private _toggleTalk = (): void => {
    const talk = this._camera?.talk_action;
    if (!talk) return;
    this._controller.touch();
    if (this._talk) {
      this._talk = false;
      if (talk.stop_action) void this._run(talk.stop_action);
    } else {
      this._talk = true;
      void this._run(talk.tap_action);
    }
  };

  private _fullscreen = (e: Event): void => {
    e.stopPropagation();
    const stage = (e.currentTarget as HTMLElement).closest<HTMLElement>(".stage");
    if (stage?.requestFullscreen && document.fullscreenEnabled) {
      void stage.requestFullscreen().catch(() => this._moreInfo());
    } else {
      this._moreInfo();
    }
  };

  private _moreInfo(entityId = this._camera?.camera): void {
    openEntityDetail(this, entityId);
  }

  private _openEvent(cam: CameraEntry, event: CameraEvent): void {
    const tap = cam.event_tap ?? "more-info";
    if (tap === "more-info") return this._moreInfo(event.entity);
    if ("url_template" in tap) {
      const url = fillEventTemplate(tap.url_template, cam, event);
      if (url) window.open(url, "_blank", "noopener");
      return;
    }
    if ("media_path" in tap) navigateTo(this, `/media-browser/browser/${encodeURIComponent(tap.media_path)}`);
  }

  // ---- image -----------------------------------------------------------

  private _imgLoaded = (): void => {
    this._imgFailures = 0;
    this._imgError = false;
    this._stillAt = Date.now();
    if (this._lingering) this._endLinger();
  };

  private _endLinger(): void {
    if (this._lingerTimer !== undefined) window.clearTimeout(this._lingerTimer);
    this._lingerTimer = undefined;
    this._lingering = false;
    if (!this._live) this._streamPlaying = false;
  }

  /** Watches a starting player until it shows a picture, then lets it fade in over the still. */
  private _watchPlayer(): void {
    const player = this.renderRoot.querySelector(".stage .live");
    if (!player || this._streamPlaying) {
      if (this._playWatch !== undefined) window.clearInterval(this._playWatch);
      this._playWatch = undefined;
      return;
    }
    if (this._playWatch !== undefined) return;
    this._playWatchSince = Date.now();
    this._playWatch = window.setInterval(() => {
      const el = this.renderRoot.querySelector(".stage .live");
      const timedOut = Date.now() - this._playWatchSince > CAMERA_LIVE_START_MAX_MS;
      if (!el || playerShowsPicture(el as never, true) || timedOut) {
        window.clearInterval(this._playWatch);
        this._playWatch = undefined;
        if (el) this._streamPlaying = true;
      }
    }, 150);
  }

  /** A still that will not load: try again later, slower each time, then wait for an event. */
  private _imgFailed = (): void => {
    this._imgFailures++;
    this._imgError = true;
    const delay = imageRetryDelay(this._imgFailures);
    if (delay === undefined) return;
    if (this._retryTimer !== undefined) window.clearTimeout(this._retryTimer);
    this._retryTimer = window.setTimeout(() => {
      this._retryTimer = undefined;
      this._imgError = false;
      this._tick++;
    }, delay);
  };

  // ---- text ------------------------------------------------------------

  private _cameraName(cam: CameraEntry): string {
    return cam.name ?? (this.hass?.states[cam.camera ?? cam.id]?.attributes.friendly_name as string | undefined) ?? cam.id;
  }

  private _time(ms: number): string {
    return new Date(ms).toLocaleTimeString(this._lang, { hour: "2-digit", minute: "2-digit" });
  }

  private _ago(ms: number): string {
    const minutes = Math.floor((this._now - ms) / 60_000);
    return minutes < 1 ? this._t("camera_just_now") : this._t("camera_minutes_ago", { n: minutes });
  }

  private _defaultIcon(cam: CameraEntry): string {
    if (!cam.camera) return "mdi:doorbell";
    return cam.doorbell ? "mdi:doorbell-video" : CAMERA_DEFAULT_ICON;
  }

  private _kindLabel(kind: CameraEventKind): string {
    return this._t(`camera_kind_${kind}` as TranslationKey);
  }

  // ---- render ----------------------------------------------------------

  protected render() {
    const cfg = this._config;
    const cam = this._camera;
    if (!cfg || !cam || !this.hass) return nothing;
    // An intercom without a camera has no picture: it is never "unavailable" for want of one.
    const st = cam.camera ? this.hass.states[cam.camera] : undefined;
    const unavailable = !!cam.camera && (!st || st.state === "unavailable");
    const ringing = this._ringing && this._ringCamera === cam.id;
    const det = ringing ? undefined : currentDetection(cam, this.hass.states, this._now, this._ringTimeoutMs);
    const events = (this._events.get(cam.id) ?? []).filter((e) => e.at >= this._windowStart());
    const name = this._cameraName(cam);
    const radius = resolveCornerRadius(cfg.radius ?? DEFAULT_CAMERA_RADIUS, cfg.corners);
    const { textColorCss, secondaryTextColorCss, cardBackgroundCss } = resolveCommonColors(cfg);
    const animate = shouldAnimate(cfg.animation);

    const stateColor = ringing ? CAMERA_RING_COLOR : det ? KIND_COLOR[det.kind] : undefined;
    const cssVars = buildCssVars({
      "cam-text": textColorCss,
      "cam-secondary": secondaryTextColorCss,
      "cam-state": stateColor,
      "m3p-text": textColorCss,
      "m3p-icon-bg": stateColor
        ? `color-mix(in srgb, ${stateColor} 26%, transparent)`
        : "color-mix(in srgb, var(--primary-text-color) 9%, transparent)",
      "m3p-icon-color": stateColor ?? textColorCss,
    });

    const latest = events[0];
    const subtitle = ringing
      ? `${name} · ${this._ago(this._ringAt)}`
      : unavailable
        ? this._t("camera_unavailable")
        : det
          ? this._t("camera_detected", { event: this._kindLabel(det.kind), when: this._ago(det.at) })
          : latest
            ? this._t("camera_last", { event: this._kindLabel(latest.kind), time: this._time(latest.at) })
            : cfg.show_events === false
              ? ""
              : this._t("camera_no_events");

    const overlayMode = cfg.ring_overlay === "fullscreen" && ringing && this._overlay;
    const body = (inOverlay: boolean) => html`
      ${renderCardHeader({
        icon: ringing ? "mdi:bell-ring-outline" : cam.icon ?? this._defaultIcon(cam),
        name: ringing ? this._t("camera_ringing") : name,
        subtitle,
        right: this._renderBattery(cam),
      })}
      ${cam.camera
        ? this._renderStage(cam, st, unavailable, ringing, det?.kind, inOverlay || !overlayMode)
        : this._renderStatus()}
      ${ringing ? this._renderRingActions(cam) : this._renderActions(cam, unavailable)}
    `;

    return html`
      <ha-card style=${`${cssVars} border-radius: ${radius};`}>
        <div
          class="card-inner ${glassCardClass(cfg.glass_background)} ${animate ? "" : "no-animations"} ${ringing ? "ringing" : ""}"
          style=${`border-radius: ${radius};${cardBackgroundCss && !ringing ? ` background: ${cardBackgroundCss};` : ""}`}
        >
          <div class="sr-only" aria-live="assertive">${ringing ? `${this._t("camera_ringing")}: ${name}` : ""}</div>
          ${body(false)}
          ${!ringing && this._cameras.length > 1 ? this._renderChips() : nothing}
          ${!ringing && cfg.show_events !== false ? this._renderTimeline(cam, events) : nothing}
        </div>
        ${cfg.ring_overlay === "fullscreen"
          ? html`<dialog
              class="ring-overlay"
              aria-label=${this._t("camera_ring_view")}
              @cancel=${() => (this._overlay = false)}
              @click=${(e: Event) => {
                if (e.target === e.currentTarget) this._overlay = false;
              }}
            >
              ${overlayMode
                ? html`<div class="overlay-sheet card-inner ringing" style=${`${cssVars} border-radius: ${radius};`}>${body(true)}</div>`
                : nothing}
            </dialog>`
          : nothing}
        ${renderConfirmDialog({ request: this._confirm, host: this, onCancel: () => (this._confirm = undefined) })}
      </ha-card>
    `;
  }

  private _renderBattery(cam: CameraEntry): TemplateResult | undefined {
    if (!cam.battery) return undefined;
    const value = Number(this.hass?.states[cam.battery]?.state);
    if (!Number.isFinite(value)) return undefined;
    const low = value < CAMERA_BATTERY_LOW;
    const step = Math.round(value / 10) * 10;
    const icon = low ? "mdi:battery-alert-variant-outline" : step >= 100 ? "mdi:battery" : `mdi:battery-${Math.max(10, step)}`;
    return html`<span class="battery ${low ? "low" : ""}" aria-label=${this._t("camera_battery", { n: Math.round(value) })}>
      <ha-icon icon=${icon}></ha-icon>${Math.round(value)} %
    </span>`;
  }

  /**
   * The picture: live when asked for and possible, else the still. The live
   * element is only placed while the view runs, so nothing streams at rest;
   * inside the overlay's card the still stands in, so one stream runs at once.
   */
  private _renderStage(
    cam: CameraEntry,
    st: HomeAssistant["states"][string] | undefined,
    unavailable: boolean,
    ringing: boolean,
    detection: CameraEventKind | undefined,
    mayStream: boolean,
  ): TemplateResult {
    const mode = liveMode(cam.live_provider, this._featuresOf(cam));
    const streaming = mayStream && this._live && mode !== "image" && !unavailable;
    const url = snapshotUrl(st?.attributes.entity_picture as string | undefined, this._tick);
    const doorOpen = this._doorOpen(cam);
    // Layers, so a change never shows an empty stage: the still at the bottom
    // whenever there is one, and the player over it, see-through until it
    // shows a picture. Stopping, the player stays until the new still is in.
    const showPlayer = mayStream && !unavailable && mode !== "image" && this._streamReady && (streaming || this._lingering);
    const showStill = !unavailable && !!url && !this._imgError;
    const playerClass = `live ${this._streamPlaying ? "playing" : ""}`;
    const picture = html`
      ${showStill
        ? html`<img class="still" src=${url!} alt=${this._cameraName(cam)} @load=${this._imgLoaded} @error=${this._imgFailed} />`
        : showPlayer
          ? nothing
          : html`<div class="placeholder">
              <ha-icon icon="mdi:video-off-outline"></ha-icon>
              <span>${this._t("camera_unavailable")}</span>
            </div>`}
      ${showPlayer
        ? mode === "webrtc" && customElements.get("ha-web-rtc-player")
          ? html`<ha-web-rtc-player class=${playerClass} .hass=${this.hass} .entityid=${cam.camera} .muted=${true} .playsInline=${true} .controls=${false}></ha-web-rtc-player>`
          : html`<ha-camera-stream class=${playerClass} .hass=${this.hass} .stateObj=${st} .muted=${true} .controls=${false} allow-exoplayer></ha-camera-stream>`
        : nothing}
    `;
    const kindColor = detection ? KIND_COLOR[detection] : undefined;
    return html`
      <div
        class="stage"
        style=${`border-radius: ${CAMERA_STAGE_RADIUS}px;`}
        @pointerdown=${this._touch}
        @pointermove=${this._touch}
        @wheel=${this._touch}
        @keydown=${this._touch}
      >
        ${picture}
        <div class="pills top-left">
          ${streaming
            ? html`<span class="pill live-pill"><span class="dot"></span>${this._streamPlaying ? this._t("camera_live") : this._t("camera_loading_live")}</span>`
            : !unavailable && this._stillAt
              ? html`<span class="pill"><ha-icon icon="mdi:image-outline"></ha-icon>${this._t("camera_still", { time: this._time(this._stillAt) })}</span>`
              : nothing}
        </div>
        <div class="pills top-right">
          ${detection && !ringing
            ? html`<span class="pill kind" style=${`--kind: ${kindColor};`}><ha-icon icon=${KIND_ICON[detection]}></ha-icon>${this._kindLabel(detection)}</span>`
            : nothing}
        </div>
        <div class="pills bottom-left">
          ${this._talk ? html`<span class="pill talk"><ha-icon icon="mdi:microphone"></ha-icon>${this._t("camera_talk_active")}</span>` : nothing}
          ${doorOpen ? html`<span class="pill door"><ha-icon icon="mdi:door-open"></ha-icon>${this._t("camera_door_opened")}</span>` : nothing}
        </div>
        ${unavailable
          ? nothing
          : html`<button class="fs-button" aria-label=${this._t("camera_fullscreen")} title=${this._t("camera_fullscreen")} @click=${this._fullscreen}>
              <ha-icon icon="mdi:fullscreen"></ha-icon>
            </button>`}
      </div>
    `;
  }

  /** Without a camera there is no picture to carry Talk's pill: it gets a row of its own. */
  private _renderStatus(): TemplateResult | typeof nothing {
    // The door button shows its own state; only Talk needs a pill here.
    if (!this._talk) return nothing;
    return html`<div class="status-row">
      <span class="pill talk"><ha-icon icon="mdi:microphone"></ha-icon>${this._t("camera_talk_active")}</span>
    </div>`;
  }

  private _doorOpen(cam: CameraEntry): boolean {
    const fb = cam.door_action?.feedback_entity;
    if (fb && !fb.startsWith("event.")) return DOOR_OPEN_STATES.has(this.hass?.states[fb]?.state ?? "");
    return this._now < this._doorUntil || Date.now() < this._doorUntil;
  }

  private _renderActions(cam: CameraEntry, unavailable: boolean): TemplateResult {
    const mode = cam.camera ? liveMode(cam.live_provider, this._featuresOf(cam)) : "image";
    // Without a camera there is nothing to watch: opening the door takes the wide button.
    const doorWide = !cam.camera && !!cam.door_action;
    // A slider needs the width: it takes a row of its own under the buttons.
    const slide = this._slideStyle(cam);
    const icons: Array<{ key: string; icon: string; label: string; run: () => void; door?: boolean }> = [];
    if (cam.door_action && !doorWide && !slide) {
      icons.push({ key: "door", icon: cam.door_action.icon ?? "mdi:lock-outline", label: cam.door_action.name ?? this._t("camera_open_door"), run: this._requestDoor, door: true });
    }
    const custom = [...(cam.actions ?? [])].sort((a, b) => Number(!!b.primary) - Number(!!a.primary));
    custom.forEach((a, i) => icons.push({ key: `a${i}`, icon: a.icon, label: a.name ?? a.icon, run: () => this._runCustom(a) }));
    const overflow = icons.length > CAMERA_MAX_ICON_BUTTONS;
    const shown = overflow ? icons.slice(0, CAMERA_MAX_ICON_BUTTONS - 1) : icons;
    const rest = overflow ? icons.slice(CAMERA_MAX_ICON_BUTTONS - 1) : [];
    const slider = slide ? html`<div class="actions">${this._renderDoorSlide(cam)}</div>` : nothing;
    if (slide && doorWide && !icons.length) return html`${slider}`;
    if (mode === "image" && !icons.length && !doorWide) return html`${slider}`;
    return html`
      <div class="actions">
        ${doorWide && !slide ? this._renderDoorButton(cam, "primary") : nothing}
        ${mode !== "image"
          ? html`<button class="primary ${this._live ? "on" : ""}" ?disabled=${unavailable} @click=${this._toggleLive}>
              <ha-icon icon=${this._live ? "mdi:stop" : "mdi:play"}></ha-icon>
              <span>${this._live ? this._t("camera_stop_live") : this._t("camera_watch_live")}</span>
            </button>`
          : nothing}
        ${shown.map((b) =>
          b.door
            ? this._renderDoorButton(cam, "round")
            : html`<button class="round" aria-label=${b.label} title=${b.label} @click=${b.run}><ha-icon icon=${b.icon}></ha-icon></button>`,
        )}
        ${rest.length
          ? html`<button
              class="round"
              aria-label=${this._t("camera_more")}
              title=${this._t("camera_more")}
              aria-haspopup="listbox"
              aria-expanded=${String(this._menuOpen)}
              @click=${(e: Event) => {
                this._menuOpen = true;
                openDropdownMenu({
                  anchor: e.currentTarget as HTMLElement,
                  label: this._t("camera_more"),
                  items: rest.map((b) => ({ value: b.key, label: b.label, icon: b.icon })),
                  onSelect: (key) => rest.find((b) => b.key === key)?.run(),
                  onClose: () => (this._menuOpen = false),
                });
              }}
            >
              <ha-icon icon="mdi:dots-horizontal"></ha-icon>
            </button>`
          : nothing}
      </div>
      ${slider}
    `;
  }

  /**
   * While it rings: Talk (with a talk action) | Open door (with a door action) | Ignore.
   * A door slider takes a row of its own under Talk, with Ignore beside it when there is no Talk.
   */
  private _renderRingActions(cam: CameraEntry): TemplateResult {
    const talk = cam.talk_action
      ? html`<button class="tonal talk ${this._talk ? "on" : ""}" aria-pressed=${String(this._talk)} @click=${this._toggleTalk}>
          <ha-icon icon=${cam.talk_action.icon ?? "mdi:microphone"}></ha-icon>
          <span>${cam.talk_action.name ?? this._t("camera_talk")}</span>
        </button>`
      : nothing;
    const ignore = html`<button class="round ignore" aria-label=${this._t("camera_ignore")} title=${this._t("camera_ignore")} @click=${this._ignore}>
      <ha-icon icon="mdi:close"></ha-icon>
    </button>`;
    if (cam.door_action && this._slideStyle(cam)) {
      return html`
        ${cam.talk_action ? html`<div class="actions ring-actions">${talk}${ignore}</div>` : nothing}
        <div class="actions ring-actions">${this._renderDoorSlide(cam)}${cam.talk_action ? nothing : ignore}</div>
      `;
    }
    return html`
      <div class="actions ring-actions">
        ${talk}
        ${cam.door_action ? this._renderDoorButton(cam, "primary", "door") : nothing}
        ${ignore}
      </div>
    `;
  }

  private _renderChips(): TemplateResult {
    return html`
      <div class="chips" role="tablist" aria-label=${this._t("camera_cameras")}>
        ${this._cameras.map((c) => {
          const active = c.id === this._selected;
          return html`<button
            class="chip ${active ? "active" : ""}"
            role="tab"
            aria-selected=${String(active)}
            @click=${() => this._select(c.id)}
          >
            <ha-icon icon=${c.icon ?? this._defaultIcon(c)}></ha-icon>
            <span>${this._cameraName(c)}</span>
          </button>`;
        })}
      </div>
    `;
  }

  private _renderTimeline(cam: CameraEntry, events: CameraEvent[]): TemplateResult {
    const hours = this._config?.events_hours ?? DEFAULT_CAMERA_EVENTS_HOURS;
    const max = this._config?.max_events ?? DEFAULT_CAMERA_MAX_EVENTS;
    const midnight = new Date(this._now);
    midnight.setHours(0, 0, 0, 0);
    const heading =
      hours <= 24
        ? this._t("camera_events_today", { n: events.filter((e) => e.at >= midnight.getTime()).length })
        : this._t("camera_events_hours", { h: hours, n: events.length });
    if (!events.length) return html``;
    const all = this._config?.events_all_action;
    return html`
      <div class="timeline-head">
        <span>${heading}</span>
        ${all ? html`<button class="link" @click=${() => void this._run(all)}>${this._t("camera_events_all")}</button>` : nothing}
      </div>
      <div class="timeline" role="list">
        ${events.slice(0, max).map((e) => {
          const preview = cam.snapshot_url_template ? fillEventTemplate(cam.snapshot_url_template, cam, e) : undefined;
          return html`<button class="event" role="listitem" @click=${() => this._openEvent(cam, e)} aria-label=${`${this._kindLabel(e.kind)} ${this._time(e.at)}`}>
            <span class="thumb" style=${`--kind: ${KIND_COLOR[e.kind]};`}>
              <ha-icon class="big" icon=${KIND_ICON[e.kind]}></ha-icon>
              ${preview
                ? html`<img src=${preview} alt="" loading="lazy" @error=${(ev: Event) => ((ev.target as HTMLElement).parentElement!.classList.remove("has-picture"))} @load=${(ev: Event) => (ev.target as HTMLElement).parentElement!.classList.add("has-picture")} />
                    <span class="badge"><ha-icon icon=${KIND_ICON[e.kind]}></ha-icon></span>`
                : nothing}
            </span>
            <span class="event-kind">${this._kindLabel(e.kind)}</span>
            <span class="event-time">${this._time(e.at)}</span>
          </button>`;
        })}
      </div>
    `;
  }

  static styles = [
    glassCardStyles,
    cardHeaderStyles,
    confirmDialogStyles,
    css`
      .card-inner {
        display: flex;
        flex-direction: column;
        gap: var(--m3-card-gap, 12px);
        padding: var(--m3-group-padding, 12px);
        color: var(--cam-text);
        transition: background 300ms ease;
      }
      /* A ring turns the card into the info container. */
      .card-inner.ringing {
        background: color-mix(in srgb, ${unsafeCSS(CAMERA_RING_COLOR)} 20%, var(--ha-card-background, var(--card-background-color)));
      }
      .card-inner.ringing .m3-icon-swatch {
        animation: cam-ring 1.6s ${unsafeCSS(STANDARD_EASING)} infinite;
      }
      @keyframes cam-ring {
        0% { box-shadow: 0 0 0 0 color-mix(in srgb, ${unsafeCSS(CAMERA_RING_COLOR)} 55%, transparent); }
        70% { box-shadow: 0 0 0 12px transparent; }
        100% { box-shadow: 0 0 0 0 transparent; }
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }

      .battery {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 32px;
        padding: 0 12px;
        border-radius: 16px;
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
        background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
      }
      .battery ha-icon {
        --mdc-icon-size: 18px;
      }
      .battery.low {
        color: var(--error-color, #db4437);
        background: color-mix(in srgb, var(--error-color, #db4437) 16%, transparent);
      }

      .stage {
        position: relative;
        aspect-ratio: 16 / 9;
        overflow: hidden;
        background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
      }
      .stage:fullscreen {
        border-radius: 0 !important;
        background: #000;
      }
      .still,
      .live {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .stage:fullscreen .still {
        object-fit: contain;
      }
      /* The player fades in over the still once it shows a picture. */
      .live {
        opacity: 0;
        transition: opacity 280ms ${unsafeCSS(STANDARD_EASING)};
      }
      .live.playing {
        opacity: 1;
      }
      .placeholder {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        color: var(--cam-secondary);
        font-size: 14px;
      }
      .placeholder ha-icon {
        --mdc-icon-size: 36px;
        opacity: 0.6;
      }
      .pills {
        position: absolute;
        display: flex;
        flex-direction: column;
        gap: 6px;
        pointer-events: none;
      }
      .top-left { top: 10px; left: 10px; align-items: flex-start; }
      .top-right { top: 10px; right: 10px; align-items: flex-end; }
      .bottom-left { bottom: 10px; left: 10px; align-items: flex-start; }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 30px;
        padding: 0 12px;
        border-radius: 15px;
        font-size: 13px;
        font-weight: 600;
        color: #fff;
        background: color-mix(in srgb, #000 55%, transparent);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        white-space: nowrap;
      }
      .pill ha-icon {
        --mdc-icon-size: 16px;
      }
      .pill.kind {
        color: #1c1c1c;
        background: color-mix(in srgb, var(--kind) 88%, transparent);
      }
      .pill.door {
        color: #1c1c1c;
        background: color-mix(in srgb, ${unsafeCSS(CAMERA_PERSON_COLOR)} 90%, transparent);
      }
      .live-pill .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #ef5350;
        animation: cam-dot 1.4s ease-in-out infinite;
      }
      @keyframes cam-dot {
        50% { opacity: 0.35; }
      }
      .status-row {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .fs-button {
        position: absolute;
        right: 10px;
        bottom: 10px;
        width: 40px;
        height: 40px;
        border-radius: 12px;
        border: none;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        background: color-mix(in srgb, #000 45%, transparent);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        cursor: pointer;
      }

      .actions {
        display: flex;
        gap: 8px;
      }
      /* Narrow (a phone): the round buttons give the label its room. */
      .card-inner {
        container-type: inline-size;
      }
      @container (max-width: 400px) {
        .round {
          width: 48px !important;
          height: 48px !important;
          align-self: center;
        }
        .primary,
        .tonal {
          padding: 0 14px;
          gap: 6px;
        }
      }
      .actions button {
        font: inherit;
        cursor: pointer;
        border: none;
        -webkit-tap-highlight-color: transparent;
        transition: border-radius 200ms ${unsafeCSS(STANDARD_EASING)}, background 200ms ease, transform 120ms ease;
      }
      .actions button:active {
        border-radius: 14px;
      }
      .actions button[disabled] {
        opacity: 0.5;
        cursor: default;
      }
      .primary,
      .tonal {
        flex: 1;
        min-width: 0;
        height: 56px;
        border-radius: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 0 18px;
        font-size: 15px;
        font-weight: 700;
      }
      .primary span,
      .tonal span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .primary {
        background: ${unsafeCSS(CAMERA_PERSON_COLOR)};
        color: #1c1c1c;
      }
      .primary.on {
        background: color-mix(in srgb, var(--primary-text-color) 12%, transparent);
        color: var(--cam-text);
      }
      .tonal {
        background: color-mix(in srgb, ${unsafeCSS(CAMERA_RING_COLOR)} 85%, white 15%);
        color: #1c1c1c;
      }
      .tonal.on {
        background: ${unsafeCSS(CAMERA_RING_COLOR)};
        box-shadow: inset 0 0 0 2px color-mix(in srgb, #fff 60%, transparent);
      }
      .round {
        flex: 0 0 auto;
        width: 56px;
        height: 56px;
        border-radius: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--cam-text);
        background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
      }
      .round:hover {
        background: color-mix(in srgb, var(--primary-text-color) 13%, transparent);
      }

      /* The door button: a pill with a closed lock; squarer while the door
         opens, with a sweep and a nudging lock; square and lighter once open. */
      .door-button {
        position: relative;
        overflow: hidden;
        isolation: isolate;
        transition:
          border-radius 420ms ${unsafeCSS(CAMERA_DOOR_SPRING_EASING)},
          background 260ms ease,
          color 260ms ease !important;
      }
      .door-button.opening,
      .door-button.open {
        border-radius: 16px;
        cursor: default;
      }
      .door-button.opening::before {
        content: "";
        position: absolute;
        inset: 0;
        z-index: -1;
        background: linear-gradient(
          90deg,
          transparent 0%,
          color-mix(in srgb, #fff 45%, transparent) 50%,
          transparent 100%
        );
        transform: translateX(-100%);
        animation: cam-door-sweep 1.1s ${unsafeCSS(STANDARD_EASING)} infinite;
      }
      .door-button.round.opening {
        background: color-mix(in srgb, ${unsafeCSS(CAMERA_PERSON_COLOR)} 35%, transparent);
      }
      .door-button.opening ha-icon {
        animation: cam-door-nudge 0.9s ease-in-out infinite;
      }
      .door-button.open {
        background: color-mix(in srgb, ${unsafeCSS(CAMERA_PERSON_COLOR)} 26%, transparent);
        color: var(--cam-text);
        box-shadow: inset 0 0 0 1.5px color-mix(in srgb, ${unsafeCSS(CAMERA_PERSON_COLOR)} 70%, transparent);
      }
      .door-button.open.timed::after {
        content: "";
        position: absolute;
        inset: 0;
        z-index: -1;
        background: color-mix(in srgb, ${unsafeCSS(CAMERA_PERSON_COLOR)} 55%, transparent);
        transform-origin: left center;
        animation: cam-door-drain var(--door-left, 3000ms) linear forwards;
      }
      .door-button.closing ha-icon {
        animation: cam-door-snap 480ms ${unsafeCSS(CAMERA_DOOR_SPRING_EASING)};
      }
      @keyframes cam-door-drain {
        from { transform: scaleX(1); }
        to { transform: scaleX(0); }
      }
      @keyframes cam-door-snap {
        0% { transform: translateY(-5px) rotate(-14deg) scale(1.2); }
        55% { transform: translateY(1px) rotate(3deg) scale(0.95); }
        100% { transform: none; }
      }
      .door-button.open ha-icon {
        animation: cam-door-pop 360ms ${unsafeCSS(CAMERA_DOOR_SPRING_EASING)};
      }
      .door-button.opening:active,
      .door-button.open:active {
        border-radius: 16px;
      }
      /* The door slider: a track with the lock as its handle. */
      .door-slide {
        position: relative;
        flex: 1;
        min-width: 0;
        height: ${CAMERA_SLIDE_HEIGHT}px;
        border-radius: ${CAMERA_SLIDE_HEIGHT / 2}px;
        overflow: hidden;
        isolation: isolate;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 ${CAMERA_SLIDE_HANDLE + CAMERA_SLIDE_PAD + 8}px;
        box-sizing: border-box;
        user-select: none;
        -webkit-user-select: none;
        background: color-mix(in srgb, ${unsafeCSS(CAMERA_PERSON_COLOR)} calc(18% + var(--p) * 40%), transparent);
        transition:
          border-radius 420ms ${unsafeCSS(CAMERA_DOOR_SPRING_EASING)},
          background 260ms ease;
      }
      .door-slide.dragging {
        transition: border-radius 420ms ${unsafeCSS(CAMERA_DOOR_SPRING_EASING)};
      }
      .door-slide.opening,
      .door-slide.open {
        border-radius: 16px;
      }
      .door-slide.open {
        background: color-mix(in srgb, ${unsafeCSS(CAMERA_PERSON_COLOR)} 26%, transparent);
        box-shadow: inset 0 0 0 1.5px color-mix(in srgb, ${unsafeCSS(CAMERA_PERSON_COLOR)} 70%, transparent);
      }
      .door-slide:focus-visible {
        outline: 2px solid var(--primary-color);
        outline-offset: 2px;
      }
      .slide-label {
        font-size: 15px;
        font-weight: 700;
        color: var(--cam-text);
        opacity: calc(0.9 - var(--p) * 1.3);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        pointer-events: none;
        transition: opacity 200ms ease;
      }
      .door-slide.opening .slide-label,
      .door-slide.open .slide-label {
        opacity: 1;
      }
      .slide-handle {
        position: absolute;
        top: ${CAMERA_SLIDE_PAD}px;
        left: ${CAMERA_SLIDE_PAD}px;
        width: ${CAMERA_SLIDE_HANDLE}px;
        height: ${CAMERA_SLIDE_HANDLE}px;
        border-radius: ${CAMERA_SLIDE_HANDLE / 2}px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: ${unsafeCSS(CAMERA_PERSON_COLOR)};
        color: #1c1c1c;
        /* Only the handle claims the touch: the rest of the card still scrolls. */
        touch-action: none;
        cursor: grab;
        transition:
          left ${CAMERA_SLIDE_SPRING_MS}ms ${unsafeCSS(CAMERA_DOOR_SPRING_EASING)},
          border-radius 300ms ${unsafeCSS(STANDARD_EASING)},
          transform 180ms ${unsafeCSS(STANDARD_EASING)};
      }
      .door-slide.dragging .slide-handle {
        border-radius: 16px;
        cursor: grabbing;
        transition: border-radius 300ms ${unsafeCSS(STANDARD_EASING)};
      }
      .door-slide.opening .slide-handle,
      .door-slide.open .slide-handle {
        left: calc(100% - ${CAMERA_SLIDE_PAD + CAMERA_SLIDE_HANDLE}px);
        border-radius: 12px;
        cursor: default;
      }
      .door-slide.nudge .slide-handle {
        transform: translateX(10px);
      }
      .slide-handle ha-icon {
        --mdc-icon-size: 22px;
        display: flex;
        pointer-events: none;
      }
      .door-slide.opening::before {
        content: "";
        position: absolute;
        inset: 0;
        z-index: -1;
        background: linear-gradient(90deg, transparent 0%, color-mix(in srgb, #fff 30%, transparent) 50%, transparent 100%);
        transform: translateX(-100%);
        animation: cam-door-sweep 1.1s ${unsafeCSS(STANDARD_EASING)} infinite;
      }
      .door-slide.open.timed::after {
        content: "";
        position: absolute;
        inset: 0;
        z-index: -1;
        background: color-mix(in srgb, ${unsafeCSS(CAMERA_PERSON_COLOR)} 55%, transparent);
        transform-origin: left center;
        animation: cam-door-drain var(--door-left, 3000ms) linear forwards;
      }
      .door-slide.opening .slide-handle ha-icon {
        animation: cam-door-nudge 0.9s ease-in-out infinite;
      }
      .door-slide.open .slide-handle ha-icon {
        animation: cam-door-pop 360ms ${unsafeCSS(CAMERA_DOOR_SPRING_EASING)};
      }
      .door-slide.closing .slide-handle ha-icon {
        animation: cam-door-snap 480ms ${unsafeCSS(CAMERA_DOOR_SPRING_EASING)};
      }
      @keyframes cam-door-sweep {
        to { transform: translateX(100%); }
      }
      @keyframes cam-door-nudge {
        0%, 100% { transform: rotate(0deg); }
        30% { transform: rotate(-12deg); }
        60% { transform: rotate(8deg); }
      }
      @keyframes cam-door-pop {
        0% { transform: scale(0.6); }
        100% { transform: scale(1); }
      }
      .actions ha-icon {
        --mdc-icon-size: 22px;
      }
      .actions button:focus-visible,
      .chip:focus-visible,
      .event:focus-visible,
      .fs-button:focus-visible,
      .link:focus-visible {
        outline: 2px solid var(--primary-color);
        outline-offset: 2px;
      }

      .chips {
        display: flex;
        gap: 8px;
        overflow-x: auto;
        scrollbar-width: none;
        margin: 0 calc(-1 * var(--m3-group-padding, 12px));
        padding: 0 var(--m3-group-padding, 12px);
      }
      .chips::-webkit-scrollbar {
        display: none;
      }
      .chip {
        flex: 0 0 auto;
        height: 36px;
        padding: 0 14px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 18px;
        border: 1px solid color-mix(in srgb, var(--primary-text-color) 18%, transparent);
        background: transparent;
        color: var(--cam-text);
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: border-radius 220ms ${unsafeCSS(STANDARD_EASING)}, background 220ms ease;
      }
      .chip ha-icon {
        --mdc-icon-size: 18px;
      }
      .chip.active {
        border-radius: 10px;
        border-color: transparent;
        background: color-mix(in srgb, var(--primary-color) 22%, var(--ha-card-background, var(--card-background-color)));
      }

      .timeline-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 13px;
        color: var(--cam-secondary);
      }
      .link {
        border: none;
        background: none;
        font: inherit;
        font-weight: 700;
        color: var(--primary-color);
        cursor: pointer;
        padding: 4px 6px;
        border-radius: 8px;
      }
      .timeline {
        display: flex;
        gap: 10px;
        overflow-x: auto;
        scrollbar-width: none;
        margin: 0 calc(-1 * var(--m3-group-padding, 12px));
        padding: 0 var(--m3-group-padding, 12px) 2px;
      }
      .timeline::-webkit-scrollbar {
        display: none;
      }
      .event {
        flex: 0 0 auto;
        display: flex;
        flex-direction: column;
        gap: 2px;
        align-items: flex-start;
        border: none;
        background: none;
        padding: 0;
        color: var(--cam-text);
        font: inherit;
        cursor: pointer;
        text-align: start;
      }
      .thumb {
        position: relative;
        width: 92px;
        height: 56px;
        border-radius: 14px;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        background: color-mix(in srgb, var(--kind) 18%, transparent);
        margin-bottom: 4px;
      }
      /* The picture covers the big icon once it has loaded; the small badge
         then says the kind. A picture that fails leaves the tonal tile. */
      .thumb img,
      .thumb .badge {
        visibility: hidden;
      }
      .thumb.has-picture img,
      .thumb.has-picture .badge {
        visibility: visible;
      }
      .thumb img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .thumb .big {
        --mdc-icon-size: 26px;
        color: var(--kind);
      }
      .badge {
        position: absolute;
        left: 6px;
        bottom: 6px;
        width: 22px;
        height: 22px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--kind);
        background: color-mix(in srgb, #000 55%, transparent);
      }
      .badge ha-icon {
        --mdc-icon-size: 14px;
      }
      .event-kind {
        font-size: 13px;
        font-weight: 600;
      }
      .event-time {
        font-size: 12px;
        color: var(--cam-secondary);
      }

      /* ring_overlay: fullscreen. A modal dialog sits in the top layer, above
         every container of the dashboard, without a Browser Mod. On a phone
         it rises from the bottom as a sheet. */
      dialog.ring-overlay {
        border: none;
        padding: 0;
        background: transparent;
        width: min(560px, 92vw);
        max-width: none;
        overflow: visible;
      }
      dialog.ring-overlay::backdrop {
        background: rgba(0, 0, 0, 0.55);
      }
      .overlay-sheet {
        background: color-mix(in srgb, ${unsafeCSS(CAMERA_RING_COLOR)} 20%, var(--ha-card-background, var(--card-background-color, #1c1b1f)));
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
      }
      @media (max-width: 600px) {
        dialog.ring-overlay {
          width: 100vw;
          margin: auto 0 0;
        }
        dialog.ring-overlay .overlay-sheet {
          border-bottom-left-radius: 0 !important;
          border-bottom-right-radius: 0 !important;
          padding-bottom: calc(var(--m3-group-padding, 12px) + env(safe-area-inset-bottom, 0px));
        }
      }

      .no-animations *,
      .no-animations .m3-icon-swatch {
        animation: none !important;
        transition: none !important;
      }
      @media (prefers-reduced-motion: reduce) {
        .card-inner *,
        .card-inner.ringing .m3-icon-swatch,
        .live-pill .dot {
          animation: none !important;
          transition: none !important;
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-camera-card": M3CameraCard;
  }
}

const windowWithCards = window as unknown as { customCards: Array<Record<string, unknown>> };
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-camera-card",
  name: "M3 Camera Card",
  description: "Cameras and doorbells: a still at rest, live on demand, a ring that takes the card over, and the day's events.",
  preview: false,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
