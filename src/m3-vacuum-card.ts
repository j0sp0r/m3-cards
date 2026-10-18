import { LitElement, html, css, nothing, unsafeCSS, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HaActionConfig,
  HomeAssistant,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  M3VacuumCardConfig,
  VacuumBlock,
  VacuumSecondaryAction,
} from "./types";
import {
  CARD_VERSION,
  DEFAULT_VACUUM_ICON,
  DEFAULT_VACUUM_RADIUS,
  VACUUM_CHIP_GAP,
  VACUUM_CHIP_HEIGHT,
  VACUUM_CHIP_RADIUS,
  VACUUM_MAP_CHIP_RADIUS,
  VACUUM_MAP_HEIGHT,
  VACUUM_MAP_MAX_ZOOM,
  VACUUM_MAP_RADIUS,
  VACUUM_MAP_SAMPLE_PX,
  VACUUM_CLEAN_MODE_ICONS,
  VACUUM_MODE_ROW_HEIGHT,
  VACUUM_MODE_ROW_RADIUS,
  VACUUM_PICK_OPTION_HEIGHT,
  VACUUM_PICK_OPTION_RADIUS,
  VACUUM_PICK_SHEET_RADIUS,
  VACUUM_MAX_CHIPS,
  VACUUM_BATTERY_HEIGHT,
  VACUUM_BATTERY_LOW,
  VACUUM_BATTERY_OK,
  VACUUM_BATTERY_RADIUS,
  VACUUM_ICON_TINT,
  VACUUM_OPTIMISTIC_MS,
  VACUUM_PENDING_OPACITY,
  VACUUM_PRIMARY_HEIGHT,
  VACUUM_PRIMARY_RADIUS,
  VACUUM_PRIMARY_RADIUS_PAUSED,
  VACUUM_ROOM_HEIGHT,
  VACUUM_ROOM_RADIUS,
  VACUUM_ROOM_RADIUS_ACTIVE,
  VACUUM_SECONDARY_RADIUS,
  VACUUM_SECONDARY_TINT,
  VACUUM_SECONDARY_WIDTH,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import { formatNumber } from "./shared/formatting";
import { PanZoom, type PanZoomState, PAN_ZOOM_IDENTITY } from "./shared/pan-zoom";
import { contentInset, insetCss } from "./shared/image-crop";
import { acknowledgeReminder, reminderStates } from "./shared/vacuum-reminders";
import { stopSwipe } from "./shared/swipe";
import { activateOnKey } from "./shared/a11y";
import { STANDARD_EASING } from "./shared/animation";
import {
  renderLevelSlider,
  levelSliderStyles,
  type LevelStep,
} from "./shared/level-slider";
import { foldHides, readCollapsed, writeCollapsed, type CollapseTarget } from "./shared/collapse-state";
import { foldArrowStyles, renderFoldArrow } from "./shared/fold-arrow";
import {
  ChipRowController,
  chipButtonsStyles,
  renderChipButtons,
} from "./shared/chip-buttons";
import { DetailCardController } from "./shared/detail-card";
import {
  popupCardStyles,
  renderPopupDialog,
  shouldCloseOnBackdropClick,
  syncDialogOpenState,
  type PopupCardHandle,
} from "./shared/popup-card";
import { runHaAction, isActionable } from "./shared/actions";
import { TapHoldGesture } from "./shared/gestures";
import { findStateRule } from "./shared/state-rules";
import { glassCardClass, glassCardStyles, renderMissingEntity } from "./shared/glass-card";
import { cardHeaderStyles, renderCardHeader } from "./shared/card-header";
import { resolveCommonColors, resolveThemeColor, tintOn, inkOn } from "./shared/color-config";
import { hassChangeMatters, listEntities } from "./shared/should-update";
import { TemplatedCard } from "./shared/templated-card";
import {
  OptimisticActivity,
  activityColor,
  activityIcon,
  discoverVacuum,
  fanSpeedKey,
  optimisticActivity,
  primaryIntent,
  supportsFeature,
  resolveActivity,
  type DiscoveredVacuum,
  type VacuumActivity,
} from "./shared/vacuum";

/**
 * A Material 3 control surface for a robot vacuum.
 *
 * Built against the Roborock integration but not tied to it: everything
 * beyond `vacuum.start`/`pause`/`return_to_base`/`locate` and the entity's own
 * `fan_speed_list` is discovered on the device and simply left out when it is
 * not there, so a Valetudo or Dreame vacuum gets the header, the buttons and
 * the suction row and nothing it cannot support.
 *
 * The one thing worth knowing before reading further: **the integration polls
 * every 30 seconds and pushes nothing.** Every control on this card therefore
 * paints the state it just asked for and reconciles on the next poll — see
 * `OptimisticActivity` in shared/vacuum.ts. Without that, every button feels
 * broken for half a minute.
 */
@customElement("m3-vacuum-card")
export class M3VacuumCard extends TemplatedCard(LitElement) implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3VacuumCardConfig;
  /** Bumped when the optimistic state expires, to force one more render. */
  @state() private _tick = 0;
  @state() private _fanPressed = false;
  /**
   * What the card last asked for, shown until the 30-second poll catches up.
   * Without it a drag snaps back to the old value a moment after releasing.
   */
  @state() private _fanOptimistic?: string;
  @state() private _selectOptimistic: Record<string, string> = {};
  @state() private _pressedSelect?: string;
  @state() private _folded = false;
  /** Areas picked for the next run. Cleared once it is sent. */
  @state() private _selectedRooms: string[] = [];
  @state() private _pressedChip?: string;
  @state() private _popupOpen = false;
  @state() private _popupCardEl?: HTMLElement & PopupCardHandle;
  private _popupOpenedAt = 0;
  private readonly _popupCard = new DetailCardController();
  /** Only ever off identity inside the map dialog; the card's own map is flat. */
  @state() private _mapView: PanZoomState = { ...PAN_ZOOM_IDENTITY };
  @state() private _mapOpen = false;
  /** The select whose options are being picked, while the menu is open. */
  @state() private _picker?: { entityId: string; title: string; prefix: string };
  private _mapOpenedAt = 0;
  /** `object-view-box` cropping the map to its floor plan, and the src it is for. */
  @state() private _mapInset?: string;
  private _mapInsetFor?: string;
  private _mapPanZoom = new PanZoom({
    max: VACUUM_MAP_MAX_ZOOM,
    onChange: (view) => {
      this._mapView = view;
    },
  });
  private _chipGestures = new TapHoldGesture();
  /** Edge hints, smart widths and sliding labels on the free-button row,
   * shared with the chip-buttons card. */
  private _chipRow = new ChipRowController();
  private _selectTimers: Record<string, number> = {};
  /** The speed to return to when "mop only" is switched back off. */
  private _lastRealSpeed?: string;

  private _optimistic = new OptimisticActivity(VACUUM_OPTIMISTIC_MS, () => {
    this._tick++;
  });
  private _discovered?: DiscoveredVacuum;
  private _discoveredFor?: string;
  private _fanSettle?: number;

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import("./m3-vacuum-card-editor");
    return document.createElement("m3-vacuum-card-editor") as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(hass: HomeAssistant): M3VacuumCardConfig {
    const entity = Object.keys(hass.states).find((e) => e.startsWith("vacuum."));
    return { type: "custom:m3-vacuum-card", entity: entity ?? "" };
  }

  public setConfig(config: M3VacuumCardConfig): void {
    if (!config.entity) throw new Error("m3-vacuum-card: 'entity' is required");
    if (!config.entity.startsWith("vacuum.")) {
      throw new Error("m3-vacuum-card: 'entity' must be a vacuum entity");
    }
    this._config = config;
    // A different vacuum means a different device; drop what was found for the
    // old one rather than mixing two robots' entities.
    this._discovered = undefined;
    this._discoveredFor = undefined;
    this._optimistic.clear();
    this._folded = config.collapsible ? readCollapsed(this.hass, this._foldTarget) : false;
  }

  public getCardSize(): number {
    return 5;
  }

  public getGridOptions(): LovelaceGridOptions {
    return { columns: 12, min_columns: 6, min_rows: 4 };
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._chipRow.disconnect();
    this._optimistic.clear();
    this._popupCard.reset();
    if (this._fanSettle) clearTimeout(this._fanSettle);
    for (const t of Object.values(this._selectTimers)) clearTimeout(t);
    this._selectTimers = {};
  }

  protected shouldUpdate(changed: PropertyValues): boolean {
    return hassChangeMatters(changed, this.hass, this._watched());
  }

  /**
   * Every entity the card reads, in one place, for `shouldUpdate`.
   *
   * Under-declaring here is the documented hazard of `hassChangeMatters`: what
   * is missing simply stops reacting. This list was short enough to hide it —
   * the vacuum entity itself changes on every poll, so everything else looked
   * like it was updating when it was only riding along thirty seconds late.
   * The map, which gets a new picture every few seconds while the robot is
   * out, and a reminder's counter, which nothing else touches, were the two
   * that showed.
   */
  private _watched(): (string | undefined)[] {
    const d = this._entities();
    return [
      this._config?.entity,
      this._entity("map_entity", "map"),
      d?.progress,
      d?.area,
      d?.time,
      d?.status,
      d?.currentRoom,
      d?.vacuumError,
      d?.dockError,
      d?.mopDryingRemaining,
      d?.lastCleanEnd,
      d?.mopMode,
      d?.mopIntensity,
      d?.cleaningMode,
      d?.emptyMode,
      d?.selectedMap,
      ...Object.values(d?.binary ?? {}),
      ...Object.values(d?.switches ?? {}),
      ...Object.values(d?.totals ?? {}),
      ...(this._config?.reminders ?? []).map((r) => r.counter_entity),
      ...listEntities(this._config?.buttons),
    ];
  }

  private get _foldTarget(): CollapseTarget {
    return {
      entity: this._config?.collapse_state_entity,
      // Keyed on the vacuum, so two cards for the same robot on one view share
      // a fold — which is what someone expects when they collapse one.
      storageKey: `m3-vacuum-folded:${location.pathname}:${this._config?.entity ?? ""}`,
      defaultCollapsed: this._config?.default_collapsed,
      memory: this._config?.collapse_memory,
    };
  }

  private _toggleFold = (e: Event): void => {
    e.stopPropagation();
    this._folded = !this._folded;
    writeCollapsed(this.hass, this._foldTarget, this._folded);
  };

  protected updated(): void {
    this._chipRow.sync(this.renderRoot);
    this._maybeSyncPopupCard();
    if (this._popupCardEl && this.hass) this._popupCardEl.hass = this.hass;
    // Two dialogs live in this shadow root — the configured popup and the
    // enlarged map. Each is addressed by its own selector; a bare
    // `querySelector("dialog")` would find whichever the render put first and
    // then open the wrong one.
    syncDialogOpenState(
      this.renderRoot?.querySelector("dialog:not(.map-dialog)") as HTMLDialogElement | null,
      this._popupOpen,
    );
    syncDialogOpenState(
      this.renderRoot?.querySelector("dialog.map-dialog") as HTMLDialogElement | null,
      this._mapOpen,
    );
    syncDialogOpenState(
      this.renderRoot?.querySelector("dialog.pick-dialog") as HTMLDialogElement | null,
      this._picker !== undefined,
    );
    if (!this._config?.collapsible) return;
    // An entity-backed fold can be changed from another dashboard or by an
    // automation, so it is re-read rather than only written on a tap.
    const wanted = readCollapsed(this.hass, this._foldTarget);
    if (wanted !== this._folded) this._folded = wanted;
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private get _t() {
    return (key: TranslationKey): string => localize(key, this._language);
  }

  /**
   * Companion entities, cached per vacuum. The walk is over the whole entity
   * registry, so doing it on every `hass` tick would be wasteful — and the
   * result only changes when the device's entities do, which is a restart.
   */
  private _entities(): DiscoveredVacuum | undefined {
    const entity = this._config?.entity;
    if (!entity || !this.hass) return undefined;
    if (this._discoveredFor !== entity || !this._discovered) {
      this._discovered = discoverVacuum(this.hass, entity);
      this._discoveredFor = entity;
    }
    return this._discovered;
  }

  /** An explicit override always wins over what was found on the device. */
  private _entity(
    override: keyof M3VacuumCardConfig,
    found: keyof DiscoveredVacuum,
  ): string | undefined {
    const explicit = this._config?.[override];
    if (typeof explicit === "string" && explicit) return explicit;
    const value = this._entities()?.[found];
    return typeof value === "string" ? value : undefined;
  }

  // ---- actions --------------------------------------------------------------

  private _call(service: string, data: Record<string, unknown> = {}): void {
    this.hass?.callService("vacuum", service, {
      entity_id: this._config!.entity,
      ...data,
    });
  }

  /**
   * Runs a command and paints its outcome immediately.
   *
   * The order matters: the optimistic state is set *before* the service call,
   * so the button has already changed by the time the websocket round-trip
   * starts. Setting it afterwards would put a frame of the old state on screen.
   */
  private _command(intent: "start" | "pause" | "resume" | "return" | "stop"): void {
    const current = this._activity().activity;
    this._optimistic.set(optimisticActivity(intent, current));
    this.requestUpdate();
    switch (intent) {
      case "start":
      case "resume":
        this._call("start");
        break;
      case "pause":
        this._call("pause");
        break;
      case "return":
        this._call("return_to_base");
        break;
      case "stop":
        this._call("stop");
        break;
    }
  }

  /**
   * Sets the speed and shows it at once. The poll is 30 seconds away, and a
   * slider that springs back to where it was is worse than no slider.
   */
  private _setFanSpeed(speed: string): void {
    this._fanOptimistic = speed;
    if (this._fanSettle) clearTimeout(this._fanSettle);
    for (const t of Object.values(this._selectTimers)) clearTimeout(t);
    this._selectTimers = {};
    this._fanSettle = setTimeout(() => {
      this._fanOptimistic = undefined;
      this._fanSettle = undefined;
    }, VACUUM_OPTIMISTIC_MS) as unknown as number;
    this._call("set_fan_speed", { fan_speed: speed });
  }

  private _fireMoreInfo(entityId: string | undefined): void {
    if (!entityId) return;
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        bubbles: true,
        composed: true,
        detail: { entityId },
      }),
    );
  }

  // ---- state ----------------------------------------------------------------

  private _activity(): { activity: VacuumActivity; pending: boolean; actual: VacuumActivity } {
    const state = this.hass?.states[this._config!.entity];
    const actual = resolveActivity(state?.state);
    const resolved = this._optimistic.resolve(actual);
    return { ...resolved, actual };
  }

  /**
   * The status line's text. The integration's own `status` sensor is preferred
   * when it exists — it says "Emptying dustbin" where the vacuum entity only
   * says "docked" — and the generic state is the fallback for everything else.
   */
  private _statusText(activity: VacuumActivity, pending: boolean): string {
    // A configured rule wins over everything, including the status sensor:
    // it is the only way a brand this card has never seen gets a line a
    // person can read, and the only way to override one it got wrong.
    const rule = this._stateRule();
    if (rule?.label && !pending) return rule.label;

    if (pending) {
      // Mid-command the status sensor still describes the old state, so the
      // generic label is the honest one to show.
      return this._t(`vacuum_${activity}` as TranslationKey);
    }
    const statusEntity = this._entity("status_entity", "status");
    const statusRaw = statusEntity ? this.hass?.states[statusEntity]?.state : undefined;
    if (statusRaw && statusRaw !== "unknown" && statusRaw !== "unavailable") {
      const localised = this.hass?.formatEntityState?.(this.hass.states[statusEntity!]);
      if (localised) return localised;
    }
    return this._t(`vacuum_${activity}` as TranslationKey);
  }

  private _stateRule() {
    const raw = this.hass?.states[this._config!.entity]?.state ?? "";
    return findStateRule(this._config?.states, raw, undefined);
  }

  private _battery(): { level?: number; charging: boolean } {
    const state = this.hass?.states[this._config!.entity];
    // `battery_level` on the vacuum entity was deprecated in favour of a
    // separate sensor, so both are read and whichever exists wins.
    const attr = state?.attributes.battery_level;
    let level = typeof attr === "number" ? attr : undefined;
    if (level === undefined) {
      const found = Object.keys(this.hass?.states ?? {}).find(
        (e) =>
          e.startsWith("sensor.") &&
          this.hass!.states[e].attributes.device_class === "battery" &&
          (this.hass!.entities as Record<string, { device_id?: string | null }> | undefined)?.[e]
            ?.device_id === this._entities()?.deviceId,
      );
      const value = found ? parseFloat(this.hass!.states[found].state) : NaN;
      if (!isNaN(value)) level = value;
    }
    const chargingEntity = this._entities()?.binary.charging;
    const charging =
      (chargingEntity ? this.hass?.states[chargingEntity]?.state === "on" : false) ||
      this._activity().activity === "docked";
    return { level, charging };
  }

  private _batteryColor(level: number | undefined): string {
    if (level === undefined) return "var(--secondary-text-color)";
    if (level > VACUUM_BATTERY_OK) return activityColor("docked");
    if (level > VACUUM_BATTERY_LOW) return activityColor("paused");
    return activityColor("error");
  }

  private _batteryIcon(level: number | undefined, charging: boolean): string {
    if (charging) return "mdi:battery-charging";
    if (level === undefined) return "mdi:battery-unknown";
    const step = Math.max(0, Math.min(10, Math.round(level / 10))) * 10;
    return step >= 100 ? "mdi:battery" : step <= 0 ? "mdi:battery-outline" : `mdi:battery-${step}`;
  }

  // ---- render ---------------------------------------------------------------

  protected render() {
    if (!this._config || !this.hass) return nothing;
    const state = this.hass.states[this._config.entity];
    if (!state) return renderMissingEntity(this._config.entity);

    const { activity, pending } = this._activity();
    const unavailable = activity === "unavailable";
    const colors = resolveCommonColors(this._config);
    // A configured accent pins the card to one colour; without one the state
    // is the colour, which is the whole point of the header.
    const accent = this._accent(activity);
    const radius = `${this._config.radius ?? DEFAULT_VACUUM_RADIUS}px`;
    // The state, the battery and Start/Pause never fold: they are what the
    // card is for at a glance. Of what is below them, the fold hides whatever
    // `collapse_blocks` names — and everything, when it names nothing.
    const folded = !!this._config.collapsible && this._folded;
    const foldable = this._config.collapse_blocks;
    const hidden = (block: VacuumBlock): boolean => foldHides(block, folded, foldable);

    return html`
      <ha-card
        class=${unavailable ? "unavailable" : activity === "error" ? "errored" : ""}
        style=${(() => {
          const iconBg = tintOn(this, accent, this._config!.accent_opacity, VACUUM_ICON_TINT);
          // The shared header reads --m3p-icon-*, so the state colour is
          // handed over in the suite's own variables rather than in ours.
          return (
            `--m3v-accent: ${accent}; --m3v-icon-bg: ${iconBg}; ` +
            `--m3p-icon-bg: ${iconBg}; --m3p-icon-color: ${accent}; ` +
            `--m3v-ink: ${inkOn(accent, this)}; border-radius: ${radius};`
          );
        })()}
      >
        <div
          class="card-inner ${glassCardClass(this._config.glass_background)}"
          style=${`border-radius: ${radius};${
            colors.cardBackgroundCss ? ` background: ${colors.cardBackgroundCss};` : ""
          }`}
        >
          ${this._renderHeader(activity, pending)}
          ${this._renderPrimaryRow(activity, pending)}
          ${hidden("map") ? nothing : this._renderMap()}
          ${hidden("rooms") ? nothing : this._renderRooms(unavailable)}
          ${hidden("fan_speed")
            ? nothing
            : this._renderFanSpeed(
                state.attributes.fan_speed_list as string[] | undefined,
                state.attributes.fan_speed as string | undefined,
                unavailable,
              )}
          ${hidden("mop")
            ? nothing
            : html`
                ${this._renderSelectScale(
                  "mop_intensity_entity",
                  "mopIntensity",
                  "vacuum_mop_intensity",
                  "vacuum_mop_",
                  this._config.show_mop_intensity,
                  unavailable,
                )}
                ${this._renderSelectScale(
                  "mop_mode_entity",
                  "mopMode",
                  "vacuum_mop_mode",
                  "vacuum_route_",
                  this._config.show_mop_mode ?? false,
                  unavailable,
                )}
              `}
          ${hidden("buttons") ? nothing : this._renderButtons(unavailable)}
          ${hidden("chips") ? nothing : this._renderChips()}
          <!-- Last, on purpose. It is the one control you set before sending
               the machine out and then leave alone, so it belongs under the
               things read at a glance rather than between two sliders that are
               nudged far more often. -->
          ${hidden("cleaning_mode") ? nothing : this._renderCleaningMode(unavailable)}
          ${this._config.card_version
            ? html`<div class="version">${CARD_VERSION}</div>`
            : nothing}
        </div>
      </ha-card>
      ${this._renderPopup()}
      ${this._renderMapDialog()}
      ${this._renderPickerDialog()}
    `;
  }

  /**
   * The suite's own header, not a private one.
   *
   * Seventeen other cards draw this shape through `renderCardHeader`, and a
   * vacuum has no reason to be the eighteenth with its own 46px swatch two
   * pixels off everyone else's. The state colour arrives through the same
   * `--m3p-icon-*` variables every other card sets, and the battery chip and
   * the fold arrow go in its trailing slot.
   */
  private _renderHeader(activity: VacuumActivity, pending: boolean) {
    const cfg = this._config!;
    const state = this.hass!.states[cfg.entity];
    const name = cfg.name ?? state.attributes.friendly_name ?? cfg.entity;
    const { level, charging } = this._battery();

    const trailing = html`
      ${level !== undefined
        ? html`
            <div
              class="battery"
              style=${`color: ${this._batteryColor(level)};`}
              aria-label=${`${this._t("vacuum_battery")} ${Math.round(level)} %`}
            >
              <ha-icon icon=${this._batteryIcon(level, charging)}></ha-icon>
              <span>${Math.round(level)} %</span>
            </div>
          `
        : nothing}
      ${cfg.collapsible
        ? renderFoldArrow({
            folded: this._folded,
            accent: "var(--m3v-accent)",
            host: this,
            label: name,
            onToggle: this._toggleFold,
          })
        : nothing}
    `;

    return renderCardHeader({
      icon: cfg.icon ?? this._stateRule()?.icon ?? activityIcon(activity) ?? DEFAULT_VACUUM_ICON,
      name,
      subtitle: this._statusText(activity, pending),
      onClick: () => this._headerTap(),
      right: trailing,
    });
  }

  private _renderPrimaryRow(activity: VacuumActivity, pending: boolean) {
    const cfg = this._config!;
    const unavailable = activity === "unavailable";
    const supported = this.hass!.states[cfg.entity]?.attributes?.supported_features as
      | number
      | undefined;
    const intent = primaryIntent(activity, supported);
    const roomCount = this._selectedRooms.length;
    if (roomCount > 0) {
      const roomLabel =
        roomCount === 1
          ? this._t("vacuum_clean_one_room")
          : this._t("vacuum_clean_rooms").replace("{n}", String(roomCount));
      return html`
        <div class="primary-row">
          <button
            class="primary"
            style=${`border-radius: ${VACUUM_PRIMARY_RADIUS}px;`}
            ?disabled=${unavailable}
            @click=${() => this._cleanRooms()}
          >
            <ha-icon icon="mdi:play"></ha-icon>
            <span>${roomLabel}</span>
          </button>
          <button
            class="secondary"
            aria-label=${this._t("vacuum_rooms_none")}
            title=${this._t("vacuum_rooms_none")}
            @click=${() => {
              this._selectedRooms = [];
            }}
          >
            <ha-icon icon="mdi:close"></ha-icon>
          </button>
        </div>
      `;
    }

    const label =
      intent === "pause"
        ? this._t("vacuum_pause")
        : intent === "stop"
          ? this._t("vacuum_stop")
          : intent === "resume"
            ? this._t("vacuum_resume")
            : this._t("vacuum_start");
    const icon =
      intent === "pause" ? "mdi:pause" : intent === "stop" ? "mdi:stop" : "mdi:play";

    // Paused morphs rounder: the shape carries the state, so the button still
    // reads as "held" at a glance from across the room.
    const radius = activity === "paused" ? VACUUM_PRIMARY_RADIUS_PAUSED : VACUUM_PRIMARY_RADIUS;
    const secondary = cfg.secondary_actions ?? (["return_to_base", "locate"] as const);

    return html`
      <div class="primary-row">
        <button
          class="primary ${pending ? "pending" : ""}"
          style=${`border-radius: ${radius}px;`}
          ?disabled=${unavailable || intent === "none"}
          @click=${() => {
            if (intent === "pause") this._command("pause");
            else if (intent === "stop") this._command("stop");
            else if (intent === "resume") this._command("resume");
            else this._command("start");
          }}
        >
          <ha-icon icon=${icon}></ha-icon>
          <span>${label}</span>
        </button>
        ${(secondary as readonly VacuumSecondaryAction[])
          .filter((action) => this._secondarySupported(action, supported))
          .slice(0, 2)
          .map((action) => this._renderSecondary(action, unavailable))}
      </div>
    `;
  }

  /** A control the entity has not declared is not drawn at all — a dead
   *  button is worse than a missing one. */
  private _secondarySupported(action: VacuumSecondaryAction, supported?: number): boolean {
    switch (action) {
      case "return_to_base":
        return supportsFeature(supported, "RETURN_HOME");
      case "locate":
        return supportsFeature(supported, "LOCATE");
      case "stop":
        return supportsFeature(supported, "STOP");
      default:
        return true;
    }
  }

  private _renderSecondary(action: VacuumSecondaryAction, unavailable: boolean) {
    const spec: Record<VacuumSecondaryAction, { icon: string; key: TranslationKey }> = {
      return_to_base: { icon: "mdi:home-import-outline", key: "vacuum_return" },
      locate: { icon: "mdi:map-marker-radius-outline", key: "vacuum_locate" },
      stop: { icon: "mdi:stop", key: "vacuum_stop" },
      // The rooms toggle lands in step 3, with the block it opens; until then
      // it is not offered rather than rendered as a button that does nothing.
      rooms: { icon: "mdi:view-grid-outline", key: "vacuum_rooms" },
    };
    if (action === "rooms") return nothing;
    const { icon, key } = spec[action];
    return html`
      <button
        class="secondary"
        ?disabled=${unavailable}
        aria-label=${this._t(key)}
        title=${this._t(key)}
        @click=${() => {
          if (action === "return_to_base") this._command("return");
          else if (action === "stop") this._command("stop");
          else this._call("locate");
        }}
      >
        <ha-icon icon=${icon}></ha-icon>
      </button>
    `;
  }

  /**
   * Suction, as an ordered scale rather than a row of buttons.
   *
   * `off` and `custom` are deliberately not on it. `off` is not a quieter
   * setting, it is "do not vacuum at all" — a different decision, so it gets
   * its own leading toggle. `custom` is defined in the Roborock app and has no
   * place between two steps; it is shown when it is what the vacuum is doing
   * and dragging simply leaves it.
   */
  private _renderFanSpeed(
    list: string[] | undefined,
    current: string | undefined,
    unavailable: boolean,
  ) {
    if (this._config?.show_fan_speed === false) return nothing;
    const supported = this.hass?.states[this._config!.entity]?.attributes?.supported_features as
      | number
      | undefined;
    if (!supportsFeature(supported, "FAN_SPEED")) return nothing;
    if (!list || list.length < 2) return nothing;

    const scale = list.filter((s) => s !== "off" && s !== "custom");
    if (scale.length < 2) return nothing;

    const shown = this._fanOptimistic ?? current;
    if (shown && shown !== "off" && shown !== "custom") this._lastRealSpeed = shown;

    // `_optionLabel` rather than a bare lookup: localize() answers with the key
    // it was given when there is no translation, so a speed the suite has no
    // word for printed "vacuum_fan_quiet" on the card instead of "quiet".
    const steps: LevelStep[] = scale.map((speed) => {
      const key = fanSpeedKey(speed);
      return { value: speed, label: key ? this._optionLabel("vacuum_fan_", key) : speed };
    });

    const hasOff = list.includes("off");
    const isOff = shown === "off";

    return html`
      <div class="fan-row">
        ${hasOff
          ? html`
              <button
                class="mop-only ${isOff ? "active" : ""}"
                ?disabled=${unavailable}
                aria-pressed=${isOff ? "true" : "false"}
                aria-label=${this._t("vacuum_fan_off")}
                title=${this._t("vacuum_fan_off")}
                @click=${() =>
                  this._setFanSpeed(isOff ? (this._lastRealSpeed ?? scale[0]) : "off")}
              >
                <ha-icon icon=${isOff ? "mdi:fan-off" : "mdi:fan"}></ha-icon>
              </button>
            `
          : nothing}
        <div class="fan-slider">
          ${renderLevelSlider({
            steps,
            current: isOff ? undefined : shown,
            label: this._t("vacuum_fan_speed"),
            offScaleLabel: isOff
              ? this._t("vacuum_fan_off")
              : shown === "custom"
                ? this._t("vacuum_fan_custom")
                : undefined,
            disabled: unavailable,
            pressed: this._fanPressed,
            setPressed: (p) => {
              this._fanPressed = p;
            },
            onChange: (value) => this._setFanSpeed(value),
          })}
        </div>
      </div>
    `;
  }

  // ---- map ------------------------------------------------------------------

  /**
   * The live map, as it sits on the card: a picture, a chip, and the magnifier
   * that opens the version you can work. Nothing here takes a gesture — see
   * `_renderMapDialog` for why.
   */
  private _renderMap() {
    if (this._config?.show_map === false) return nothing;
    const source = this._mapSource();
    if (!source) return nothing;

    const area = this._numeric(this._entity("area_entity", "area"));
    const minutes = this._numeric(this._entity("time_entity", "time"));
    const parts: string[] = [];
    if (area !== undefined && area > 0) parts.push(`${formatNumber(this._language, area, { maximumFractionDigits: 1 })} m²`);
    if (minutes !== undefined && minutes >= 1) {
      parts.push(`${formatNumber(this._language, minutes, { maximumFractionDigits: 0 })} min`);
    }

    // A picture that reacts to nothing should not claim to be a button, or
    // offer a pointer cursor and a focus ring for a tap that does nothing.
    const action = this._config?.map_tap_action;
    const tappable = action ? isActionable(action) : this._config?.map_zoom !== false;

    return html`
      <div
        class="map ${tappable ? "tappable" : ""}"
        style=${`--m3v-map-height: ${this._config?.map_height ?? VACUUM_MAP_HEIGHT}px;`}
        role=${tappable ? "button" : "img"}
        tabindex=${tappable ? 0 : -1}
        aria-label=${this._t("vacuum_map")}
        @keydown=${tappable ? activateOnKey(() => this._mapTapped()) : nothing}
        @click=${tappable ? () => this._mapTapped() : nothing}
      >
        <img
          src=${source.src}
          style=${this._mapInset ? `object-view-box: ${this._mapInset};` : nothing}
          alt=""
          @load=${this._measureMap}
        />
        ${parts.length
          ? html`<div class="map-chip">${parts.join(" · ")}</div>`
          : nothing}
        ${this._config?.map_zoom === false
          ? nothing
          : html`
              <button
                class="map-btn map-zoom"
                aria-label=${this._t("vacuum_map_zoom")}
                title=${this._t("vacuum_map_zoom")}
                @click=${(e: Event) => {
                  e.stopPropagation();
                  this._openMap();
                }}
              >
                <ha-icon icon="mdi:magnify-plus-outline"></ha-icon>
              </button>
            `}
      </div>
    `;
  }

  /**
   * The map at full size, and the only place the picture zooms.
   *
   * WHY THE CARD'S OWN MAP NO LONGER PINCHES
   *
   * Pinch and drag need `touch-action: none` on the element, and that also
   * swallows the vertical swipe that scrolls the dashboard. On a phone the map
   * is most of the card's height, so scrolling past it meant hunting for the
   * few pixels beside it — and the picture shifting under the thumb on every
   * try. The gestures moved in here, where the picture is the only thing on
   * screen and there is nothing behind it to scroll. A tap on the card's map
   * still opens more-info, as it always did.
   */
  private _renderMapDialog() {
    if (!this._mapOpen) return nothing;
    const source = this._mapSource();
    if (!source) return nothing;
    const view = this._mapView;

    return html`
      <dialog
        class="map-dialog"
        @close=${() => this._closeMap()}
        @click=${(e: Event) => {
          if (shouldCloseOnBackdropClick(e, this._mapOpenedAt)) this._closeMap();
        }}
      >
        <div
          class="map-stage ${view.scale > 1.001 ? "zoomed" : ""}"
          @dblclick=${() => this._mapPanZoom.toggle()}
          @pointerdown=${this._mapPanZoom.onPointerDown}
          @pointermove=${this._mapPanZoom.onPointerMove}
          @pointerup=${this._mapPanZoom.onPointerUp}
          @pointercancel=${this._mapPanZoom.onPointerUp}
          @wheel=${this._mapPanZoom.onWheel}
          @touchstart=${stopSwipe}
          @touchmove=${stopSwipe}
          @touchend=${stopSwipe}
          @mousedown=${stopSwipe}
          @mousemove=${stopSwipe}
          @mouseup=${stopSwipe}
        >
          <img
            style=${`transform: translate(${view.x}px, ${view.y}px) scale(${view.scale});` +
            (this._mapInset ? ` object-view-box: ${this._mapInset};` : "")}
            src=${source.src}
            alt=""
          />
        </div>
        <div class="map-actions">
          ${view.scale > 1.001
            ? html`
                <button
                  class="map-btn"
                  aria-label=${this._t("vacuum_map_reset")}
                  title=${this._t("vacuum_map_reset")}
                  @click=${() => this._mapPanZoom.reset()}
                >
                  <ha-icon icon="mdi:magnify-minus-outline"></ha-icon>
                </button>
              `
            : nothing}
          <button
            class="map-btn"
            aria-label=${this._t("dialog_close")}
            title=${this._t("dialog_close")}
            @click=${() => this._closeMap()}
          >
            <ha-icon icon="mdi:close"></ha-icon>
          </button>
        </div>
      </dialog>
    `;
  }

  /**
   * The picture's URL, cache-keyed on the entity's own state.
   *
   * No refresh timer, deliberately. An `image` entity's *state* is the
   * timestamp of the picture behind it, so keying the URL on that state makes
   * the browser refetch exactly when there is something new and never
   * otherwise — which beats the 30-second poll the integration does anyway,
   * and costs nothing while the card is off screen.
   */
  private _mapSource(): { entityId: string; src: string } | undefined {
    const entityId = this._entity("map_entity", "map");
    if (!entityId) return undefined;
    const state = this.hass?.states[entityId];
    const picture = state?.attributes.entity_picture as string | undefined;
    if (!picture) return undefined;
    return { entityId, src: `${picture}${picture.includes("?") ? "&" : "?"}s=${state!.state}` };
  }

  /**
   * Crops the map to its floor plan.
   *
   * A Roborock map is a picture of the robot's whole coordinate space, and a
   * flat takes up a corner of it. `object-fit: contain` then fits the empty
   * margin as carefully as the rooms, which is why the plan arrives as a stamp
   * in the middle of a 360px box with air on every side. Measuring where the
   * content actually is and handing that to `object-view-box` lets the same
   * box show the same plan several times larger, with no layout change at all.
   *
   * It runs on the picture's `load`, once per src, against a downscaled copy —
   * a few hundred pixels are plenty to find an edge, and a full-size readback
   * of a map that changes every few seconds during a run would not be. The
   * image comes from Home Assistant's own origin, so the canvas is not tainted
   * and `getImageData` is allowed; if a future proxy changes that, the throw is
   * caught and the map simply stays as it was.
   */
  private _measureMap = (e: Event): void => {
    if (this._config?.map_fit === "picture") return;
    const img = e.currentTarget as HTMLImageElement;
    const src = img.currentSrc || img.src;
    if (!src || this._mapInsetFor === src) return;
    if (!img.naturalWidth || !img.naturalHeight) return;
    if (!CSS.supports?.("object-view-box", "inset(1% 1% 1% 1%)")) return;
    this._mapInsetFor = src;
    try {
      const width = Math.min(VACUUM_MAP_SAMPLE_PX, img.naturalWidth);
      const height = Math.max(1, Math.round((width / img.naturalWidth) * img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, width, height);
      const found = contentInset(ctx.getImageData(0, 0, width, height).data, width, height);
      this._mapInset = found ? insetCss(found) : undefined;
    } catch {
      // A tainted canvas, or a picture that never decoded. Either way the
      // uncropped map is a working map.
      this._mapInset = undefined;
    }
  };

  private _openMap(): void {
    this._mapPanZoom.reset();
    this._mapOpen = true;
    this._mapOpenedAt = Date.now();
  }

  private _closeMap(): void {
    this._mapOpen = false;
    // Reset on the way out rather than on the way in, so the picture is never
    // briefly drawn at the last gesture's scale while the dialog appears.
    this._mapPanZoom.reset();
  }

  /**
   * The map's own tap.
   *
   * It used to open more-info on the image entity, and that was worth having
   * only while the map could be pinched in place: more-info on an `image` is
   * the same picture again with a history graph under it, which answers no
   * question anybody had about a floor plan. So a plain tap now does what the
   * magnifier does. `map_tap_action` overrides it — `{ action: "none" }`
   * makes the map inert, and more-info is still available by asking for it.
   */
  private _mapTapped(): void {
    const action = this._config?.map_tap_action;
    if (!action) {
      if (this._config?.map_zoom !== false) this._openMap();
      return;
    }
    if (!isActionable(action) || !this.hass) return;
    runHaAction(this.hass, action, {
      entityId: this._entity("map_entity", "map") ?? this._config!.entity,
      openPopup: () => this._openPopup(),
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

  private _numeric(entityId: string | undefined): number | undefined {
    if (!entityId) return undefined;
    const value = parseFloat(this.hass?.states[entityId]?.state ?? "");
    return isNaN(value) ? undefined : value;
  }

  // ---- rooms ------------------------------------------------------------------

  /**
   * The areas the vacuum can be sent to.
   *
   * Configured rather than discovered, and that is not laziness: the mapping
   * from a map's segments onto Home Assistant areas lives inside the
   * integration and is not readable from a card, so offering every area in the
   * house would put "Garden" and "Terrace" next to "Kitchen" with no way to
   * tell which of them the robot can reach. `vacuum.clean_area` takes area ids
   * directly, so the list is exactly what the editor's area picker produces.
   */
  private _renderRooms(unavailable: boolean) {
    if (this._config?.show_rooms === false) return nothing;
    const rooms = this._config?.rooms;
    if (!rooms?.length || !this.hass) return nothing;
    const supported = this.hass.states[this._config!.entity]?.attributes?.supported_features as
      | number
      | undefined;
    if (!supportsFeature(supported, "CLEAN_AREA")) return nothing;

    // `hass.areas` is typed as an opaque record — the frontend's own registry
    // entry carries more than this card needs, so only the name is read out.
    const areas = (this.hass.areas ?? {}) as Record<string, { name?: string }>;
    const known = rooms.filter((id) => areas[id]);
    if (!known.length) return nothing;

    return html`
      <div class="rooms">
        ${known.map((id) => {
          const chosen = this._selectedRooms.includes(id);
          return html`
            <button
              class="room ${chosen ? "chosen" : ""}"
              ?disabled=${unavailable}
              aria-pressed=${chosen ? "true" : "false"}
              @click=${() => this._toggleRoom(id)}
            >
              ${areas[id].name ?? id}
            </button>
          `;
        })}
      </div>
    `;
  }

  private _toggleRoom(areaId: string): void {
    this._selectedRooms = this._selectedRooms.includes(areaId)
      ? this._selectedRooms.filter((id) => id !== areaId)
      : [...this._selectedRooms, areaId];
  }

  /**
   * Sends the picked areas. The order they were tapped in is the order that
   * goes out — the service takes a reorderable list, so it is treated as
   * meaningful rather than sorted behind the user's back.
   */
  private _cleanRooms(): void {
    if (!this._selectedRooms.length) return;
    this._optimistic.set(optimisticActivity("start", this._activity().activity));
    this.hass?.callService("vacuum", "clean_area", {
      entity_id: this._config!.entity,
      cleaning_area_id: [...this._selectedRooms],
    });
    this._selectedRooms = [];
  }

  // ---- select-backed scales ---------------------------------------------------

  /**
   * A `select` entity drawn as the same Expressive scale as suction.
   *
   * Mop intensity and mop route are both ordered lists, which is what the
   * slider is for. `custom` is the one option that is not on the scale — it is
   * whatever was configured in the vendor's app — so it is shown when active
   * and skipped when choosing.
   */
  private _renderSelectScale(
    override: keyof M3VacuumCardConfig,
    found: keyof DiscoveredVacuum,
    labelKey: TranslationKey,
    prefix: string,
    show: boolean | undefined,
    unavailable: boolean,
  ) {
    if (show === false) return nothing;
    const entityId = this._entity(override, found);
    if (!entityId) return nothing;
    const state = this.hass?.states[entityId];
    const options = state?.attributes.options as string[] | undefined;
    if (!options || options.length < 2) return nothing;

    const scale = options.filter((o) => o !== "custom" && o !== "unknown");
    if (scale.length < 2) return nothing;
    const current = this._selectOptimistic[entityId] ?? state!.state;
    const label = (value: string) => {
      const key = `${prefix}${value}` as TranslationKey;
      const text = this._t(key);
      // localize() hands back the key itself when it has no translation, which
      // is the signal to show the integration's own word instead.
      return text === key ? value : text;
    };

    return html`
      <div class="scale-row">
        ${renderLevelSlider({
          steps: scale.map((value) => ({ value, label: label(value) })),
          current: scale.includes(current) ? current : undefined,
          label: this._t(labelKey),
          offScaleLabel: label(current),
          disabled: unavailable,
          pressed: this._pressedSelect === entityId,
          setPressed: (p) => {
            this._pressedSelect = p ? entityId : undefined;
          },
          onChange: (value) => this._selectOption(entityId, value),
        })}
      </div>
    `;
  }

  /**
   * What the next run will do: vacuum, mop, or both.
   *
   * A menu, not a scale, and that is the whole point of it being separate from
   * the two rows below. Mop intensity and route are three strengths of one
   * thing, so a slider reads them correctly; vacuum / mop / both are three
   * different jobs, and sliding from "vacuum" to "mop" through "both" says
   * something about them that is not true. The vacuum's own app asks this
   * question with a menu too.
   *
   * It only sets what the machine will do next — nothing here starts anything.
   * Starting stays with the one button that says Start.
   */
  private _renderCleaningMode(unavailable: boolean) {
    if (this._config?.show_cleaning_mode === false) return nothing;
    const entityId = this._entity("cleaning_mode_entity", "cleaningMode");
    if (!entityId) return nothing;
    const state = this.hass?.states[entityId];
    const options = state?.attributes.options as string[] | undefined;
    if (!options || options.length < 2) return nothing;
    const current = this._selectOptimistic[entityId] ?? state!.state;

    return html`
      <button
        class="mode-row"
        ?disabled=${unavailable}
        aria-haspopup="dialog"
        @click=${() =>
          (this._picker = {
            entityId,
            title: this._t("vacuum_cleaning_mode"),
            prefix: "vacuum_clean_",
          })}
      >
        <ha-icon icon=${VACUUM_CLEAN_MODE_ICONS[current] ?? "mdi:tune-variant"}></ha-icon>
        <span class="mode-label">${this._t("vacuum_cleaning_mode")}</span>
        <span class="mode-value">${this._optionLabel("vacuum_clean_", current)}</span>
        <ha-icon class="mode-chevron" icon="mdi:chevron-right"></ha-icon>
      </button>
    `;
  }

  /**
   * The card's accent: a configured colour, then a matching state rule, then
   * the activity's own colour.
   *
   * Lifted out of render() because a modal dialog needs it too — one painted in
   * the top layer sits outside `ha-card`, so the variables set inline there do
   * not reach it and it has to be given the colour directly.
   */
  private _accent(activity: VacuumActivity): string {
    if (this._config?.accent_color) return resolveThemeColor(this._config.accent_color);
    const ruleColor = this._stateRule()?.color;
    return ruleColor ? resolveThemeColor(ruleColor) : activityColor(activity);
  }

  /** An option's word: the suite's translation, or the integration's own. */
  private _optionLabel(prefix: string, value: string): string {
    const key = `${prefix}${value}` as TranslationKey;
    const text = this._t(key);
    // localize() hands back the key itself when it has no translation, which is
    // the signal to show whatever the integration called it.
    return text === key ? value : text;
  }

  private _renderPickerDialog() {
    const picker = this._picker;
    if (!picker) return nothing;
    const state = this.hass?.states[picker.entityId];
    const options = (state?.attributes.options as string[] | undefined) ?? [];
    const current = this._selectOptimistic[picker.entityId] ?? state?.state;

    return html`
      <dialog
        class="pick-dialog"
        @close=${() => {
          this._picker = undefined;
        }}
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) this._picker = undefined;
        }}
      >
        <div
          class="pick-sheet"
          style=${(() => {
            const accent = this._accent(this._activity().activity);
            return `--m3v-accent: ${accent}; --m3v-ink: ${inkOn(accent, this)};`;
          })()}
        >
          <h2 class="pick-title">${picker.title}</h2>
          ${options.map(
            (option) => html`
              <button
                class="pick-option ${option === current ? "current" : ""}"
                @click=${() => {
                  this._selectOption(picker.entityId, option);
                  this._picker = undefined;
                }}
              >
                <ha-icon
                  icon=${VACUUM_CLEAN_MODE_ICONS[option] ?? "mdi:circle-medium"}
                ></ha-icon>
                <span>${this._optionLabel(picker.prefix, option)}</span>
                ${option === current
                  ? html`<ha-icon class="pick-tick" icon="mdi:check"></ha-icon>`
                  : nothing}
              </button>
            `,
          )}
        </div>
      </dialog>
    `;
  }

  private _selectOption(entityId: string, option: string): void {
    this._selectOptimistic = { ...this._selectOptimistic, [entityId]: option };
    const timers = this._selectTimers;
    if (timers[entityId]) clearTimeout(timers[entityId]);
    timers[entityId] = setTimeout(() => {
      const next = { ...this._selectOptimistic };
      delete next[entityId];
      this._selectOptimistic = next;
      delete this._selectTimers[entityId];
    }, VACUUM_OPTIMISTIC_MS) as unknown as number;
    this.hass?.callService("select", "select_option", { entity_id: entityId, option });
  }

  // ---- free buttons -----------------------------------------------------------

  /**
   * Buttons the config names, for whatever the integration exposes that this
   * card cannot know about — app routines, a script, a scene.
   *
   * These are the suite's chip buttons, not a private copy: they arrive with
   * the theme's own state colours, hold and double-tap actions, the scrolling
   * row with its edge fades, and the swipe shield. A vacuum from another brand
   * is then a config change rather than a code one.
   */
  private _renderButtons(unavailable: boolean) {
    const buttons = this._config?.buttons;
    if (!buttons?.length || !this.hass) return nothing;
    return html`
      <div class="free-buttons ${unavailable ? "dimmed" : ""}">
        ${renderChipButtons(
          this,
          this.hass,
          {
            buttons,
            wrap: this._config?.buttons_wrap ?? true,
            stretch: this._config?.buttons_stretch,
            justify: this._config?.buttons_justify,
          },
          {
            pressedKey: this._pressedChip,
            gestures: this._chipGestures,
            onPressChange: (key) => {
              this._pressedChip = key;
            },
          },
        )}
      </div>
    `;
  }

  // ---- popup ------------------------------------------------------------------

  private _openPopup(): void {
    if (!this._config?.popup) {
      this._fireMoreInfo(this._config?.entity);
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

  // createCardElement() is async, so the build runs from updated() and
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
    const name =
      this._config?.name ??
      this.hass?.states[this._config!.entity]?.attributes.friendly_name ??
      this._config!.entity;
    return renderPopupDialog({
      content: this._popupCardEl,
      title: popup.title ?? name,
      size: popup.size,
      onClose: () => this._closePopup(),
      onBackdropClick: (e) => {
        if (shouldCloseOnBackdropClick(e, this._popupOpenedAt)) this._closePopup();
      },
      closeLabel: this._t("dialog_close"),
    });
  }

  /**
   * The header's tap. A configured popup takes it, so the common case needs
   * no `tap_action`; an explicit one still wins, and more-info stays the
   * fallback it has always been.
   */
  private _headerTap(): void {
    const action =
      this._config?.tap_action ??
      (this._config?.popup ? ({ action: "popup" } as HaActionConfig) : undefined);
    if (!action) {
      this._fireMoreInfo(this._config?.entity);
      return;
    }
    if (!isActionable(action) || !this.hass) return;
    runHaAction(this.hass, action, {
      entityId: this._config!.entity,
      openPopup: () => this._openPopup(),
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

  // ---- station chips ----------------------------------------------------------

  /**
   * Only what is worth saying. A full clean-water tank and an attached mop are
   * the normal case and say nothing; an empty tank, a full waste tank or a
   * dock error are what the row exists for.
   *
   * Errors are never collapsed into the "+n" overflow — they are the reason
   * someone looks at the card at all.
   */
  private _renderChips() {
    if (this._config?.show_station_chips === false) return nothing;
    const d = this._entities();
    if (!d) return nothing;

    type Chip = {
      icon: string;
      text: string;
      tone: "error" | "warn" | "plain";
      /** Present only when tapping it does something — ticking a reminder off. */
      onTap?: () => void;
    };
    const chips: Chip[] = [];
    const on = (id: string | undefined) =>
      id ? this.hass?.states[id]?.state === "on" : false;

    // Errors first, and always shown.
    const dockError = this._enumState(d.dockError);
    if (dockError) {
      chips.push({
        icon: "mdi:home-alert-outline",
        text: `${this._t("vacuum_dock_error")}: ${dockError}`,
        tone: "error",
      });
    }
    const vacError = this._enumState(d.vacuumError);
    if (vacError) {
      chips.push({
        icon: "mdi:alert-circle-outline",
        text: `${this._t("vacuum_vacuum_error")}: ${vacError}`,
        tone: "error",
      });
    }

    // Only the due ones, and never collapsed away: a reminder that is not due
    // is not news, and one that is competes with an error for attention only
    // when there is genuinely something to do.
    const reminders = reminderStates(this.hass, this._config?.reminders, {
      runs: d.totals.total_count,
      hours: d.totals.total_time,
    }).filter((r) => r.due);
    for (const reminder of reminders) {
      chips.push({
        icon: reminder.config.icon ?? "mdi:calendar-refresh-outline",
        text: reminder.config.name,
        tone: "warn",
        onTap: reminder.acknowledgeable ? () => acknowledgeReminder(this.hass, reminder) : undefined,
      });
    }

    if (on(d.binary.clean_water_box)) {
      // The sensor is `clean_box_empty` — "on" is the bad news, not the good.
      chips.push({
        icon: "mdi:water-alert-outline",
        text: this._t("vacuum_chip_clean_water_empty"),
        tone: "warn",
      });
    }
    if (on(d.binary.dirty_water_box)) {
      chips.push({
        icon: "mdi:delete-alert-outline",
        text: this._t("vacuum_chip_dirty_water_full"),
        tone: "warn",
      });
    }
    if (on(d.binary.water_shortage)) {
      chips.push({
        icon: "mdi:water-off-outline",
        text: this._t("vacuum_chip_water_shortage"),
        tone: "warn",
      });
    }
    if (on(d.binary.mop_drying)) {
      chips.push({
        icon: "mdi:weather-windy",
        text: this._t("vacuum_chip_mop_drying"),
        tone: "plain",
      });
    }
    if (on(d.binary.mop_attached)) {
      chips.push({
        // Not the empty rounded square it used to be: on a chip that square read
        // as an unticked checkbox, which invites exactly the tap this chip
        // cannot take.
        icon: "mdi:water-outline",
        text: this._t("vacuum_chip_mop_attached"),
        tone: "plain",
      });
    }

    if (!chips.length) return nothing;
    const max = this._config?.max_chips ?? VACUUM_MAX_CHIPS;
    // Errors and due reminders are both "something needs doing", so neither is
    // pushed into the overflow to make room for a chip saying the mop is on.
    const urgent = chips.filter((c) => c.tone === "error" || !!c.onTap || reminders.some((r) => r.config.name === c.text));
    const rest = chips.filter((c) => !urgent.includes(c));
    const shown = [...urgent, ...rest].slice(0, Math.max(urgent.length, max));
    const hidden = chips.length - shown.length;

    return html`
      <div class="chips">
        ${shown.map(
          (c) =>
            c.onTap
              ? html`
                  <button class="chip ${c.tone} tappable" @click=${c.onTap}>
                    <ha-icon icon=${c.icon}></ha-icon>
                    <span>${c.text}</span>
                    <ha-icon class="chip-check" icon="mdi:check"></ha-icon>
                  </button>
                `
              : html`
                  <span class="chip ${c.tone}">
                    <ha-icon icon=${c.icon}></ha-icon>
                    <span>${c.text}</span>
                  </span>
                `,
        )}
        ${hidden > 0
          ? html`<span class="chip plain"
              >${this._t("vacuum_chip_more").replace("{n}", String(hidden))}</span
            >`
          : nothing}
      </div>
    `;
  }

  /** An enum sensor's state, localised, or nothing when it reads as fine. */
  private _enumState(entityId: string | undefined): string | undefined {
    if (!entityId) return undefined;
    const state = this.hass?.states[entityId];
    const raw = state?.state;
    if (!raw || raw === "ok" || raw === "none" || raw === "unknown" || raw === "unavailable") {
      return undefined;
    }
    return this.hass?.formatEntityState?.(state!) ?? raw;
  }

  static styles = [
    glassCardStyles,
    levelSliderStyles,
    foldArrowStyles,
    cardHeaderStyles,
    chipButtonsStyles,
    popupCardStyles,
    css`
      ha-card {
        color: var(--m3p-text, var(--primary-text-color));
        overflow: hidden;
      }

      ha-card.unavailable .card-inner {
        /* Grey, never red: a Roborock drops off the network briefly all the
           time, and painting that as an error trains the user to ignore red. */
        opacity: 0.4;
      }

      ha-card.errored {
        outline: 2px solid var(--m3v-accent);
        outline-offset: -2px;
      }

      .card-inner {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 14px;
        box-sizing: border-box;
        height: 100%;
      }







      .battery {
        flex: 0 0 auto;
        height: ${unsafeCSS(VACUUM_BATTERY_HEIGHT)}px;
        border-radius: ${unsafeCSS(VACUUM_BATTERY_RADIUS)}px;
        padding: 0 10px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: color-mix(in srgb, currentColor 14%, transparent);
        font-size: 12px;
        font-weight: 700;
        --mdc-icon-size: 15px;
      }

      .primary-row {
        display: flex;
        align-items: stretch;
        gap: 8px;
      }

      .primary {
        flex: 1;
        min-width: 0;
        height: ${unsafeCSS(VACUUM_PRIMARY_HEIGHT)}px;
        border: none;
        background: var(--m3v-accent);
        color: var(--m3v-ink);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        font-family: inherit;
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
        --mdc-icon-size: 20px;
        /* Radius is the state signal, so it gets the longer, softer curve;
           colour follows it rather than leading. */
        transition:
          border-radius 0.35s ${unsafeCSS(STANDARD_EASING)},
          background 0.25s ${unsafeCSS(STANDARD_EASING)},
          opacity 0.2s linear;
      }

      /* Showing something the vacuum has not confirmed yet. Dimmed, not
         disabled: tapping again should still work if the first one was lost. */
      .primary.pending {
        opacity: ${unsafeCSS(VACUUM_PENDING_OPACITY)};
      }

      .primary:disabled,
      .secondary:disabled {
        cursor: default;
        opacity: 0.4;
      }

      .secondary {
        flex: 0 0 auto;
        width: ${unsafeCSS(VACUUM_SECONDARY_WIDTH)}px;
        height: ${unsafeCSS(VACUUM_PRIMARY_HEIGHT)}px;
        border: none;
        border-radius: ${unsafeCSS(VACUUM_SECONDARY_RADIUS)}px;
        background: color-mix(
          in srgb,
          var(--m3v-accent) ${unsafeCSS(VACUUM_SECONDARY_TINT)}%,
          transparent
        );
        color: var(--m3v-accent);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        --mdc-icon-size: 22px;
        transition: background 0.25s ${unsafeCSS(STANDARD_EASING)};
      }

      .fan-row {
        display: flex;
        align-items: flex-end;
        gap: 8px;
      }

      .fan-slider {
        flex: 1;
        min-width: 0;
        --level-accent: var(--m3v-accent);
        --level-ink: var(--m3v-ink);
      }

      /* "Mop only" is a mode, not a quieter setting, so it sits beside the
         scale rather than on it. */
      .mop-only {
        flex: 0 0 auto;
        width: 40px;
        height: 40px;
        margin-bottom: 2px;
        border: none;
        border-radius: 20px;
        background: color-mix(in srgb, var(--m3p-text, currentColor) 7%, transparent);
        color: var(--m3p-secondary-text, var(--secondary-text-color));
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        --mdc-icon-size: 20px;
        transition:
          border-radius 0.35s ${unsafeCSS(STANDARD_EASING)},
          background 0.25s ${unsafeCSS(STANDARD_EASING)};
      }

      .mop-only.active {
        border-radius: 12px;
        background: color-mix(in srgb, var(--m3v-accent) 16%, transparent);
        color: var(--m3v-accent);
      }

      .map {
        position: relative;
        border-radius: ${unsafeCSS(VACUUM_MAP_RADIUS)}px;
        overflow: hidden;
        /* A faint ground so a map with transparent edges does not float on
           whatever the card background happens to be. */
        background: color-mix(in srgb, var(--m3p-text, currentColor) 5%, transparent);
        line-height: 0;
      }

      .map.tappable {
        cursor: pointer;
      }

      .map:focus-visible {
        outline: 2px solid var(--m3v-accent);
        outline-offset: 2px;
      }

      .map img {
        display: block;
        width: 100%;
        height: var(--m3v-map-height, ${unsafeCSS(VACUUM_MAP_HEIGHT)}px);
        /* contain, never cover: cropping a floor plan hides rooms, and the
           whole point of the picture is where the vacuum has been. A Roborock
           map brings wide transparent margins of its own, which is what the
           magnifier is for. */
        object-fit: contain;
      }

      .map-btn {
        width: 34px;
        height: 34px;
        border: none;
        border-radius: 17px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        --mdc-icon-size: 20px;
        color: var(--m3p-text, var(--primary-text-color));
        background: color-mix(in srgb, var(--ha-card-background, var(--card-background-color)) 74%, transparent);
        backdrop-filter: blur(6px);
      }

      .map-zoom {
        position: absolute;
        bottom: 8px;
        right: 8px;
      }

      /* ---- cleaning mode -------------------------------------------------- */

      .mode-row {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        min-height: ${unsafeCSS(VACUUM_MODE_ROW_HEIGHT)}px;
        padding: 0 14px;
        box-sizing: border-box;
        border: none;
        border-radius: ${unsafeCSS(VACUUM_MODE_ROW_RADIUS)}px;
        cursor: pointer;
        font-family: inherit;
        font-size: 13px;
        color: var(--m3p-text, var(--primary-text-color));
        background: color-mix(in srgb, var(--m3p-text, currentColor) 6%, transparent);
        --mdc-icon-size: 20px;
        transition: border-radius ${unsafeCSS(STANDARD_EASING)};
      }

      .mode-row:active {
        border-radius: ${unsafeCSS(Math.round(VACUUM_MODE_ROW_RADIUS / 2))}px;
      }

      .mode-row[disabled] {
        opacity: ${unsafeCSS(VACUUM_PENDING_OPACITY)};
        cursor: default;
      }

      .mode-label {
        flex: 1;
        text-align: left;
        opacity: 0.7;
      }

      .mode-value {
        font-weight: 700;
        color: var(--m3v-accent);
      }

      .mode-chevron {
        opacity: 0.5;
        --mdc-icon-size: 18px;
      }

      /* ---- the option menu ------------------------------------------------ */

      dialog.pick-dialog {
        border: none;
        padding: 0;
        background: transparent;
        max-width: min(420px, 92vw);
        width: 100%;
      }

      dialog.pick-dialog::backdrop {
        background: rgba(0, 0, 0, 0.55);
        backdrop-filter: blur(2px);
      }

      .pick-sheet {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 18px;
        border-radius: ${unsafeCSS(VACUUM_PICK_SHEET_RADIUS)}px;
        background: var(--ha-card-background, var(--card-background-color));
        color: var(--primary-text-color);
      }

      .pick-title {
        margin: 2px 4px 8px;
        font-size: 17px;
        font-weight: 700;
      }

      .pick-option {
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: ${unsafeCSS(VACUUM_PICK_OPTION_HEIGHT)}px;
        padding: 0 14px;
        border: none;
        border-radius: ${unsafeCSS(VACUUM_PICK_OPTION_RADIUS)}px;
        cursor: pointer;
        font-family: inherit;
        font-size: 15px;
        text-align: left;
        color: inherit;
        background: color-mix(in srgb, currentColor 6%, transparent);
        --mdc-icon-size: 22px;
      }

      .pick-option span {
        flex: 1;
      }

      /* The one in force is filled, the rest are quiet — the same rule the
         chips follow, so "this is the state" never reads as "press this". */
      .pick-option.current {
        background: var(--m3v-accent);
        color: var(--m3v-ink);
        font-weight: 700;
      }

      /* ---- the enlarged map ---------------------------------------------- */

      dialog.map-dialog {
        max-width: 96vw;
        width: 96vw;
        max-height: 94dvh;
        border: none;
        padding: 0;
        background: transparent;
        overflow: visible;
      }

      /* Only here does the picture take the gestures, and only here may the
         browser be stopped from panning the page underneath. */
      .map-stage {
        position: relative;
        overflow: hidden;
        border-radius: ${unsafeCSS(VACUUM_MAP_RADIUS)}px;
        background: color-mix(in srgb, var(--ha-card-background, var(--card-background-color)) 92%, transparent);
        line-height: 0;
        touch-action: none;
      }

      .map-stage.zoomed {
        cursor: grab;
      }

      .map-stage img {
        display: block;
        width: 100%;
        height: min(78dvh, 78vw);
        object-fit: contain;
        transform-origin: center;
        will-change: transform;
      }

      .map-actions {
        position: absolute;
        top: 8px;
        right: 8px;
        display: flex;
        gap: 8px;
      }

      .map-chip {
        position: absolute;
        top: 8px;
        right: 8px;
        border-radius: ${unsafeCSS(VACUUM_MAP_CHIP_RADIUS)}px;
        padding: 3px 8px;
        font-size: 11px;
        font-weight: 600;
        line-height: 1.4;
        color: var(--m3p-text, var(--primary-text-color));
        background: color-mix(in srgb, var(--ha-card-background, var(--card-background-color)) 74%, transparent);
        backdrop-filter: blur(6px);
      }

      .scale-row {
        --level-accent: var(--m3v-accent);
        --level-ink: var(--m3v-ink);
      }

      .rooms {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .room {
        height: ${unsafeCSS(VACUUM_ROOM_HEIGHT)}px;
        border: none;
        border-radius: ${unsafeCSS(VACUUM_ROOM_RADIUS)}px;
        padding: 0 14px;
        background: color-mix(in srgb, var(--m3p-text, currentColor) 7%, transparent);
        color: var(--m3p-secondary-text, var(--secondary-text-color));
        font-family: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition:
          border-radius 0.35s ${unsafeCSS(STANDARD_EASING)},
          background 0.25s ${unsafeCSS(STANDARD_EASING)};
      }

      .room.chosen {
        border-radius: ${unsafeCSS(VACUUM_ROOM_RADIUS_ACTIVE)}px;
        background: var(--m3v-accent);
        color: var(--m3v-ink);
      }

      .room:disabled {
        cursor: default;
        opacity: 0.4;
      }

      /* Air between the scales above and the rows of buttons and chips below:
         two dense pill rows straight under a slider read as one crowded block. */
      .free-buttons {
        margin-top: 4px;
      }

      .free-buttons.dimmed {
        opacity: 0.4;
        pointer-events: none;
      }

      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: ${unsafeCSS(VACUUM_CHIP_GAP)}px;
        margin-top: 4px;
      }

      /* Filled means it can be pressed; outlined means it is telling you
         something. The free buttons above are filled pills, and these chips used
         to be filled pills four pixels shorter — nobody could tell which of the
         two rows did anything. A status chip now has a rim and no fill, in its
         own colour, and only a chip that takes a tap is filled. */
      .chip {
        box-sizing: border-box;
        height: ${unsafeCSS(VACUUM_CHIP_HEIGHT)}px;
        border-radius: ${unsafeCSS(VACUUM_CHIP_RADIUS)}px;
        padding: 0 12px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        font-weight: 500;
        --mdc-icon-size: 15px;
        color: var(--m3p-secondary-text, var(--secondary-text-color));
        background: transparent;
        border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
      }

      .chip.warn {
        color: #f0a24a;
        background: color-mix(in srgb, #f0a24a 6%, transparent);
      }

      /* A reminder that can be ticked off is a button, so it looks like one. */
      .chip.tappable {
        border-color: transparent;
        background: color-mix(in srgb, currentColor 14%, transparent);
        font-family: inherit;
        font-weight: 600;
        cursor: pointer;
      }

      .chip-check {
        --mdc-icon-size: 14px;
        opacity: 0.7;
      }

      /* Never collapsed into the overflow, and never quiet — but still a rim,
         not a fill: an error is information, not something to press. */
      .chip.error {
        color: #e57368;
        background: color-mix(in srgb, #e57368 8%, transparent);
        border-color: color-mix(in srgb, #e57368 45%, transparent);
      }

      .version {
        font-size: 10px;
        opacity: 0.4;
        text-align: right;
      }

      @media (prefers-reduced-motion: reduce) {
        .primary,
        .fan,
        .icon-swatch,
        .status,
        .secondary {
          transition: none;
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-vacuum-card": M3VacuumCard;
  }
}

const windowWithCards = window as unknown as {
  customCards: Array<Record<string, unknown>>;
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "m3-vacuum-card",
  name: "M3 Vacuum Card",
  description:
    "A Material 3 control surface for a robot vacuum: state, battery, start/pause and suction, with every companion entity discovered on the device. Built for Roborock, usable with any vacuum entity.",
  preview: true,
  documentationURL: "https://github.com/j0sp0r/m3-cards",
});
