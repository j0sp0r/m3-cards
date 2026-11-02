import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  LovelaceCardEditor,
  M3AquariumCardConfig,
  AquariumDeviceConfig,
  AquariumScheduleEntry,
} from "./types";
import {
  DEFAULT_AQUARIUM_RADIUS,
  DEFAULT_AQUARIUM_TARGET_RANGE,
  DEFAULT_AQUARIUM_CLEANING_INTERVAL_DAYS,
  DEFAULT_AQUARIUM_FEEDING_DUE_TIME,
  DEFAULT_AQUARIUM_CAMERA_REFRESH_S,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import { fireEvent, colorRow, opacityRow, editorStyles, type SchemaEntry } from "./shared/editor-helpers";
import {
  initAppearanceState,
  radiusPresetPatch,
  cornerPresetPatch,
  renderAppearanceSection,
  type AppearanceState,
} from "./shared/appearance-editor";
import {
  notifyServiceSchema,
  notifyTokenHint,
  renderNotifyControls,
  setAutomationEnabled,
  resolveAutomationId,
  notifyTimeSchema,
  notifyStyles,
  notifyTitleSchema,
  notifyMessageSchema,
  saveNotifyAutomation,
  notifyActions,
  slugifyForId,
} from "./shared/notify-editor";

type DeviceSlotKey = "light_day" | "light_night" | "pump" | "heater" | "co2";

@customElement("m3-aquarium-card-editor")
export class M3AquariumCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3AquariumCardConfig;
  @state() private _appearance: AppearanceState = { showCustomRadius: false, showCorners: false, cornerCustom: {} };
  @state() private _reminderBusy = false;
  @state() private _reminderStatus: "idle" | "success" | "error" = "idle";
  @state() private _reminderDetail = "";
  @state() private _feedBusy = false;
  @state() private _feedStatus: "idle" | "success" | "error" = "idle";
  @state() private _feedDetail = "";

  public setConfig(config: M3AquariumCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_AQUARIUM_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  // ---- schemas --------------------------------------------------------

  private _generalSchema(): SchemaEntry[] {
    return [
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
    ];
  }

  private _waterSchema(): SchemaEntry[] {
    return [
      { name: "water_temperature_entity", selector: { entity: { domain: "sensor", device_class: "temperature" } } },
      { name: "target_min", selector: { number: { mode: "box", step: 0.5, unit_of_measurement: "°" } } },
      { name: "target_max", selector: { number: { mode: "box", step: 0.5, unit_of_measurement: "°" } } },
      { name: "ph_entity", selector: { entity: { domain: "sensor" } } },
      { name: "tds_entity", selector: { entity: { domain: "sensor" } } },
      { name: "water_level_entity", selector: { entity: { domain: "binary_sensor" } } },
      { name: "power_entity", selector: { entity: { domain: "sensor", device_class: "power" } } },
    ];
  }

  private _deviceSlotSchema(): SchemaEntry[] {
    return [
      { name: "entity", selector: { entity: { domain: ["light", "switch"] } } },
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
    ];
  }

  private _heaterPowerSchema(): SchemaEntry[] {
    return [{ name: "heater_power_entity", selector: { entity: { domain: "sensor", device_class: "power" } } }];
  }

  private _extraDeviceSchema(): SchemaEntry[] {
    return [
      { name: "entity", required: true, selector: { entity: { domain: ["light", "switch"] } } },
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
    ];
  }

  private _cameraSchema(): SchemaEntry[] {
    return [
      { name: "camera_entity", selector: { entity: { domain: "camera" } } },
      {
        name: "camera_style",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "none", label: this._t("editor_aquarium_camera_style_none") },
              { value: "thumbnail", label: this._t("editor_aquarium_camera_style_thumbnail") },
              { value: "banner", label: this._t("editor_aquarium_camera_style_banner") },
              { value: "live", label: this._t("editor_aquarium_camera_style_live") },
            ],
          },
        },
      },
      { name: "camera_refresh", selector: { number: { mode: "box", min: 0, step: 1, unit_of_measurement: "s" } } },
      { name: "camera_live_on_tap", selector: { boolean: {} } },
    ];
  }

  private _scheduleMetaSchema(): SchemaEntry[] {
    return [
      { name: "schedule_entity", selector: { entity: { domain: "schedule" } } },
      { name: "show_schedule", selector: { boolean: {} } },
    ];
  }

  private _phaseSchema(): SchemaEntry[] {
    return [
      {
        name: "device",
        required: true,
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "day", label: this._t("editor_aquarium_phase_day") },
              { value: "night", label: this._t("editor_aquarium_phase_night") },
            ],
          },
        },
      },
      { name: "start", required: true, selector: { time: {} } },
      { name: "end", required: true, selector: { time: {} } },
    ];
  }

  private _maintenanceSchema(): SchemaEntry[] {
    return [
      { name: "cleaning_entity", selector: { entity: { domain: ["input_datetime", "input_button", "button"] } } },
      { name: "cleaning_interval", selector: { number: { mode: "box", min: 1, step: 1, unit_of_measurement: "d" } } },
      { name: "cleaning_interval_entity", selector: { entity: { domain: "input_number" } } },
    ];
  }

  private _feedingSchema(): SchemaEntry[] {
    return [
      { name: "feeding_entity", selector: { entity: { domain: ["input_datetime", "input_button"] } } },
      { name: "feeding_due_time", selector: { time: {} } },
      notifyServiceSchema(this.hass, "feeding_notify_service"),
    ];
  }

  private _reminderSchema(): SchemaEntry[] {
    return [
      notifyServiceSchema(this.hass, "cleaning_notify_service"),
      notifyTimeSchema("cleaning_notify_time"),
      notifyTitleSchema("cleaning_notify_title"),
      notifyMessageSchema("cleaning_notify_message"),
    ];
  }

  private _animationSchema(): SchemaEntry[] {
    return [
      {
        name: "animation",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "auto", label: this._t("editor_progress_animation_auto") },
              { value: "on", label: this._t("editor_progress_animation_on") },
              { value: "off", label: this._t("editor_progress_animation_off") },
            ],
          },
        },
      },
    ];
  }

  private _computeLabel = (schema: SchemaEntry): string => {
    const labelMap: Record<string, TranslationKey> = {
      cleaning_notify_title: "editor_notify_title",
      cleaning_notify_message: "editor_notify_message",
      name: "editor_name",
      icon: "editor_icon",
      entity: "editor_entity",
      water_temperature_entity: "editor_aquarium_water_temperature_entity",
      target_min: "editor_aquarium_target_min",
      target_max: "editor_aquarium_target_max",
      ph_entity: "editor_aquarium_ph_entity",
      tds_entity: "editor_aquarium_tds_entity",
      water_level_entity: "editor_aquarium_water_level_entity",
      power_entity: "editor_aquarium_power_entity",
      heater_power_entity: "editor_aquarium_heater_power_entity",
      camera_entity: "editor_aquarium_camera_entity",
      camera_style: "editor_aquarium_camera_style",
      camera_refresh: "editor_aquarium_camera_refresh",
      camera_live_on_tap: "editor_aquarium_camera_live_on_tap",
      schedule_entity: "editor_aquarium_schedule_entity",
      show_schedule: "editor_aquarium_show_schedule",
      device: "editor_aquarium_phase_device",
      start: "editor_aquarium_phase_start",
      end: "editor_aquarium_phase_end",
      cleaning_entity: "editor_aquarium_cleaning_entity",
      cleaning_interval: "editor_aquarium_cleaning_interval",
      cleaning_interval_entity: "editor_aquarium_cleaning_interval_entity",
      cleaning_notify_service: "editor_aquarium_notify_service",
      cleaning_notify_time: "editor_aquarium_notify_time",
      feeding_entity: "editor_aquarium_feeding_entity",
      feeding_due_time: "editor_aquarium_feeding_due_time",
      feeding_notify_service: "editor_aquarium_notify_service",
      animation: "editor_progress_animation",
      glass_background: "editor_glass_background",
    };
    const key = labelMap[schema.name];
    return key ? this._t(key) : schema.name;
  };

  // ---- change handlers --------------------------------------------------

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    this._config = { ...this._config, ...ev.detail.value };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _targetRangeChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const v = ev.detail.value as { target_min: number; target_max: number };
    this._config = { ...this._config, target_range: [v.target_min, v.target_max] };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _colorChanged(field: "accent_color" | "text_color" | "secondary_text_color" | "card_background", value: string): void {
    if (!this._config) return;
    if (value) {
      this._config = { ...this._config, [field]: value };
    } else {
      const { [field]: _removed, ...rest } = this._config;
      this._config = rest;
    }
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _opacityChanged(field: "tile_tint_opacity" | "accent_opacity", value: number): void {
    if (!this._config) return;
    this._config = { ...this._config, [field]: value };
    fireEvent(this, "config-changed", { config: this._config });
  }

  // ---- cleaning reminder ----------------------------------------------

  // Creates (or updates) the "cleaning due" automation, plus the input_number
  // interval helper it shares with the card's chip if there isn't one yet. The
  // automation id is derived from the cleaning entity so pressing the button
  // twice updates the same automation instead of piling up duplicates.
  private async _toggleReminder(enabled: boolean): Promise<void> {
    if (!this._config || !this.hass) return;
    this._config = { ...this._config, notify_enabled: enabled };
    fireEvent(this, "config-changed", { config: this._config });
    if (enabled) {
      await this._setupReminder();
      return;
    }
    const id = this._config.notify_automation_id;
    if (id) await setAutomationEnabled(this.hass, id, false);
  }

  private async _setupReminder(): Promise<void> {
    const cfg = this._config;
    if (!this.hass || !cfg) return;
    const targets = cfg.cleaning_notify_service ?? [];
    if (!cfg.cleaning_entity || targets.length === 0) {
      this._reminderStatus = "error";
      this._reminderDetail = this._t("editor_aquarium_reminder_missing");
      return;
    }
    this._reminderBusy = true;
    this._reminderStatus = "idle";
    this._reminderDetail = "";
    try {
      const cardName = cfg.name || this._t("aquarium_default_name");
      let intervalEntity = cfg.cleaning_interval_entity;

      if (!intervalEntity) {
        const created = await this.hass.callWS<{ id: string }>({
          type: "input_number/create",
          name: `${cardName} ${this._t("editor_aquarium_interval_helper_name")}`,
          icon: "mdi:calendar-refresh",
          min: 1,
          max: 365,
          step: 1,
          initial: cfg.cleaning_interval ?? DEFAULT_AQUARIUM_CLEANING_INTERVAL_DAYS,
          mode: "box",
          unit_of_measurement: "d",
        });
        // create() returns the storage item, not the entity_id. Resolve it via
        // the entity registry (the helper's storage id is its unique_id) rather
        // than watching hass.states — that keeps working even when this editor
        // isn't receiving live hass updates.
        const registry = await this.hass.callWS<Array<{ entity_id: string; unique_id: string; platform: string }>>(
          { type: "config/entity_registry/list" },
        );
        intervalEntity = registry.find(
          (entry) => entry.platform === "input_number" && entry.unique_id === created.id,
        )?.entity_id;
        if (!intervalEntity) throw new Error("interval helper could not be resolved");
        this._config = { ...cfg, cleaning_interval_entity: intervalEntity };
        fireEvent(this, "config-changed", { config: this._config });
      }

      const cleaned = cfg.cleaning_entity;
      const tsExpr = `{% set ts = state_attr('${cleaned}', 'timestamp') %}`;
      const ivExpr = `{% set iv = states('${intervalEntity}') | float(${DEFAULT_AQUARIUM_CLEANING_INTERVAL_DAYS}) %}`;
      const automationId = resolveAutomationId(
        "aquarium_clean",
        cfg.notify_automation_id ?? `m3_aquarium_clean_${slugifyForId(cleaned)}`,
      );

      await saveNotifyAutomation(this.hass, {
        id: automationId,
        alias: `${cardName}: ${this._t("editor_aquarium_reminder_alias")}`,
        description: this._t("editor_aquarium_reminder_description"),
        mode: "single",
        triggers: [{ trigger: "time", at: cfg.cleaning_notify_time || "18:00:00" }],
        conditions: [
          {
            condition: "template",
            value_template: `${tsExpr}${ivExpr}{{ ts is not none and iv > 0 and (now().timestamp() - ts) / 86400 >= iv }}`,
          },
        ],
        actions: notifyActions(targets, cardName,
          `${tsExpr}{% set d = ((now().timestamp() - ts) / 86400) | round(0) | int %}${this._t("editor_aquarium_reminder_message")}`,
          { title: cfg.notify_title, message: cfg.notify_message, tokens: {
            tage: `${tsExpr}{{ ((now().timestamp() - ts) / 86400) | round(0) | int }}`,
          } }),
      });

      await setAutomationEnabled(this.hass, automationId, true);

      if (cfg.notify_automation_id !== automationId) {

        this._config = { ...cfg, notify_automation_id: automationId };

        fireEvent(this, "config-changed", { config: this._config });

      }

      this._reminderStatus = "success";
      this._reminderDetail = intervalEntity;
    } catch (e) {
      this._reminderStatus = "error";
      this._reminderDetail = e instanceof Error ? e.message : String(e);
    } finally {
      this._reminderBusy = false;
    }
  }

  // The feeding reminder: one automation with three triggers. At the feed-by
  // time it notifies, unless the fish were fed today; the notification's
  // button logs the feeding; and any feeding, from wherever, clears the
  // notification off the phones again. Its id comes from the card config, so
  // setting it up twice updates the same automation.
  private async _toggleFeedReminder(enabled: boolean): Promise<void> {
    if (!this._config || !this.hass) return;
    this._config = { ...this._config, feeding_notify_enabled: enabled };
    fireEvent(this, "config-changed", { config: this._config });
    if (enabled) {
      await this._setupFeedReminder();
      return;
    }
    const id = this._config.feeding_notify_automation_id;
    if (id) await setAutomationEnabled(this.hass, id, false);
  }

  private async _setupFeedReminder(): Promise<void> {
    const cfg = this._config;
    if (!this.hass || !cfg) return;
    const targets = cfg.feeding_notify_service ?? [];
    const fed = cfg.feeding_entity;
    if (!fed || targets.length === 0) {
      this._feedStatus = "error";
      this._feedDetail = this._t("editor_aquarium_feeding_reminder_missing");
      return;
    }
    this._feedBusy = true;
    this._feedStatus = "idle";
    this._feedDetail = "";
    try {
      const cardName = cfg.name || this._t("aquarium_default_name");
      const isButton = fed.startsWith("input_button.");
      const tag = `m3_aquarium_feed_${slugifyForId(fed)}`;
      const action = tag.toUpperCase();
      // An input_datetime's timestamp attribute is local time already; an
      // input_button holds an ISO timestamp with its zone
      const ts = isButton ? `as_timestamp(states('${fed}'), none)` : `state_attr('${fed}', 'timestamp')`;
      const notFedToday = `{% set ts = ${ts} %}{{ ts is none or (ts | timestamp_custom('%Y-%m-%d')) != now().strftime('%Y-%m-%d') }}`;
      const logFeeding = isButton
        ? { action: "input_button.press", target: { entity_id: fed } }
        : { action: "input_datetime.set_datetime", target: { entity_id: fed }, data: { datetime: "{{ now().strftime('%Y-%m-%d %H:%M:%S') }}" } };
      const remind = notifyActions(targets, cardName, this._t("editor_aquarium_feeding_reminder_message")).map((a) => ({
        ...a,
        data: {
          ...(a.data as Record<string, unknown>),
          data: { tag, actions: [{ action, title: this._t("editor_aquarium_feeding_reminder_action") }] },
        },
      }));
      const clear = targets.map((target) => ({
        action: `notify.${target}`,
        data: { message: "clear_notification", data: { tag } },
      }));
      const automationId = resolveAutomationId("aquarium_feed", cfg.feeding_notify_automation_id);

      await saveNotifyAutomation(this.hass, {
        id: automationId,
        alias: `${cardName}: ${this._t("editor_aquarium_feeding_reminder_alias")}`,
        description: this._t("editor_aquarium_feeding_reminder_description"),
        mode: "queued",
        triggers: [
          { trigger: "time", at: cfg.feeding_due_time || DEFAULT_AQUARIUM_FEEDING_DUE_TIME, id: "remind" },
          { trigger: "event", event_type: "mobile_app_notification_action", event_data: { action }, id: "fed" },
          { trigger: "state", entity_id: fed, id: "logged" },
        ],
        conditions: [],
        actions: [
          {
            choose: [
              {
                conditions: [{ condition: "trigger", id: "remind" }, { condition: "template", value_template: notFedToday }],
                sequence: remind,
              },
              { conditions: [{ condition: "trigger", id: "fed" }], sequence: [logFeeding] },
              { conditions: [{ condition: "trigger", id: "logged" }], sequence: clear },
            ],
          },
        ],
      });

      await setAutomationEnabled(this.hass, automationId, true);
      if (cfg.feeding_notify_automation_id !== automationId) {
        this._config = { ...cfg, feeding_notify_automation_id: automationId };
        fireEvent(this, "config-changed", { config: this._config });
      }
      this._feedStatus = "success";
      this._feedDetail = "";
    } catch (e) {
      this._feedStatus = "error";
      this._feedDetail = e instanceof Error ? e.message : String(e);
    } finally {
      this._feedBusy = false;
    }
  }

  private _deviceSlotChanged(slot: DeviceSlotKey, ev: CustomEvent): void {
    if (!this._config) return;
    const value = ev.detail.value as AquariumDeviceConfig;
    if (!value.entity) {
      const { [slot]: _removed, ...rest } = this._config;
      this._config = rest;
    } else {
      this._config = {
        ...this._config,
        [slot]: { entity: value.entity, name: value.name || undefined, icon: value.icon || undefined },
      };
    }
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _heaterPowerChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const value = ev.detail.value as { heater_power_entity?: string };
    this._config = { ...this._config, heater_power_entity: value.heater_power_entity || undefined };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _extraDeviceChanged(index: number, ev: CustomEvent): void {
    if (!this._config) return;
    const extra = [...(this._config.extra_devices ?? [])];
    const value = ev.detail.value as AquariumDeviceConfig;
    extra[index] = { entity: value.entity ?? "", name: value.name || undefined, icon: value.icon || undefined, color: extra[index]?.color };
    this._config = { ...this._config, extra_devices: extra };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _extraDeviceColorChanged(index: number, color: string): void {
    if (!this._config) return;
    const extra = [...(this._config.extra_devices ?? [])];
    extra[index] = { ...extra[index], color: color || undefined };
    this._config = { ...this._config, extra_devices: extra };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _addExtraDevice(): void {
    if (!this._config) return;
    const extra = [...(this._config.extra_devices ?? []), { entity: "" }];
    this._config = { ...this._config, extra_devices: extra };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _removeExtraDevice(index: number): void {
    if (!this._config) return;
    const extra = [...(this._config.extra_devices ?? [])];
    extra.splice(index, 1);
    this._config = { ...this._config, extra_devices: extra };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _phaseChanged(index: number, ev: CustomEvent): void {
    if (!this._config) return;
    const phases = [...(this._config.schedule ?? [])];
    const value = ev.detail.value as AquariumScheduleEntry;
    phases[index] = { device: value.device ?? "day", start: value.start ?? "", end: value.end ?? "", color: phases[index]?.color };
    this._config = { ...this._config, schedule: phases };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _phaseColorChanged(index: number, color: string): void {
    if (!this._config) return;
    const phases = [...(this._config.schedule ?? [])];
    phases[index] = { ...phases[index], color: color || undefined };
    this._config = { ...this._config, schedule: phases };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _addPhase(): void {
    if (!this._config) return;
    const phases = [...(this._config.schedule ?? []), { device: "day" as const, start: "10:00", end: "20:00" }];
    this._config = { ...this._config, schedule: phases };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _removePhase(index: number): void {
    if (!this._config) return;
    const phases = [...(this._config.schedule ?? [])];
    phases.splice(index, 1);
    this._config = { ...this._config, schedule: phases };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _radiusPresetChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const patch = radiusPresetPatch(ev.detail.value.radius_preset as string);
    this._appearance = { ...this._appearance, showCustomRadius: patch.showCustomRadius };
    if (patch.radius !== undefined) {
      this._config = { ...this._config, radius: patch.radius };
      fireEvent(this, "config-changed", { config: this._config });
    }
  }

  private _cornersToggleChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const showCorners = ev.detail.value.use_corners as boolean;
    this._appearance = { ...this._appearance, showCorners };
    if (!showCorners) {
      const { corners, ...rest } = this._config;
      this._config = rest;
      fireEvent(this, "config-changed", { config: this._config });
    }
  }

  private _cornerPresetChanged(key: string, ev: CustomEvent): void {
    if (!this._config) return;
    const patch = cornerPresetPatch(ev.detail.value[key] as string);
    this._appearance = {
      ...this._appearance,
      cornerCustom: { ...this._appearance.cornerCustom, [key]: patch.custom },
    };
    if (patch.px !== undefined) {
      this._config = { ...this._config, corners: { ...(this._config.corners ?? {}), [key]: patch.px } };
      fireEvent(this, "config-changed", { config: this._config });
    }
  }

  private _cornerValueChanged(key: string, ev: CustomEvent): void {
    if (!this._config) return;
    const px = ev.detail.value[key] as number;
    this._config = { ...this._config, corners: { ...(this._config.corners ?? {}), [key]: px } };
    fireEvent(this, "config-changed", { config: this._config });
  }

  // ---- render -------------------------------------------------------------

  private _renderDeviceSlot(slot: DeviceSlotKey, labelKey: TranslationKey) {
    const cfg = this._config?.[slot] as AquariumDeviceConfig | undefined;
    return html`
      <div class="slot-block">
        <div class="slot-label">${this._t(labelKey)}</div>
        <ha-form
          .hass=${this.hass}
          .data=${{ entity: cfg?.entity ?? "", name: cfg?.name ?? "", icon: cfg?.icon ?? "" }}
          .schema=${this._deviceSlotSchema()}
          .computeLabel=${this._computeLabel}
          @value-changed=${(ev: CustomEvent) => this._deviceSlotChanged(slot, ev)}
        ></ha-form>
        ${slot === "heater"
          ? html`
              <ha-form
                .hass=${this.hass}
                .data=${{ heater_power_entity: this._config?.heater_power_entity ?? "" }}
                .schema=${this._heaterPowerSchema()}
                .computeLabel=${this._computeLabel}
                @value-changed=${this._heaterPowerChanged}
              ></ha-form>
            `
          : nothing}
      </div>
    `;
  }

  protected render() {
    if (!this.hass || !this._config) return nothing;

    const generalData = { name: this._config.name, icon: this._config.icon };
    const [targetMin, targetMax] = this._config.target_range ?? DEFAULT_AQUARIUM_TARGET_RANGE;
    const waterData = {
      water_temperature_entity: this._config.water_temperature_entity,
      target_min: targetMin,
      target_max: targetMax,
      ph_entity: this._config.ph_entity,
      tds_entity: this._config.tds_entity,
      water_level_entity: this._config.water_level_entity,
      power_entity: this._config.power_entity,
    };
    const cameraData = {
      camera_entity: this._config.camera_entity,
      camera_style: this._config.camera_style ?? "none",
      camera_refresh: this._config.camera_refresh ?? DEFAULT_AQUARIUM_CAMERA_REFRESH_S,
      camera_live_on_tap: this._config.camera_live_on_tap ?? true,
    };
    const scheduleMetaData = {
      schedule_entity: this._config.schedule_entity,
      show_schedule: this._config.show_schedule ?? true,
    };
    const phases = this._config.schedule ?? [];
    const maintenanceData = {
      cleaning_entity: this._config.cleaning_entity,
      cleaning_interval: this._config.cleaning_interval ?? DEFAULT_AQUARIUM_CLEANING_INTERVAL_DAYS,
      cleaning_interval_entity: this._config.cleaning_interval_entity ?? "",
    };
    const reminderData = {
      cleaning_notify_service: this._config.cleaning_notify_service ?? [],
      cleaning_notify_time: this._config.cleaning_notify_time ?? "18:00:00",
    };
    const feedingData = {
      feeding_entity: this._config.feeding_entity,
      feeding_due_time: this._config.feeding_due_time ?? DEFAULT_AQUARIUM_FEEDING_DUE_TIME,
      feeding_notify_service: this._config.feeding_notify_service ?? [],
    };
    const extraDevices = this._config.extra_devices ?? [];
    const animationData = { animation: this._config.animation ?? "auto" };

    return html`
      <div class="editor">
        <ha-expansion-panel outlined .header=${this._t("editor_aquarium_general")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:fishbowl-outline"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${generalData}
              .schema=${this._generalSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            ${colorRow(
              this._t("editor_aquarium_accent_color"),
              this._config.accent_color,
              (v) => this._colorChanged("accent_color", v),
              {
                label: this._t("editor_opacity"),
                value: this._config.accent_opacity,
                defaultValue: 18,
                onChange: (v) => this._opacityChanged("accent_opacity", v),
              },
            )}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_aquarium_water")}>
          <ha-icon slot="leading-icon" icon="mdi:thermometer-water"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${waterData}
              .schema=${this._waterSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._targetRangeChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_aquarium_devices")}>
          <ha-icon slot="leading-icon" icon="mdi:pump"></ha-icon>
          <div class="panel-content">
            ${this._renderDeviceSlot("light_day", "editor_aquarium_light_day")}
            ${this._renderDeviceSlot("light_night", "editor_aquarium_light_night")}
            ${this._renderDeviceSlot("pump", "editor_aquarium_pump")}
            ${this._renderDeviceSlot("heater", "editor_aquarium_heater")}
            ${this._renderDeviceSlot("co2", "editor_aquarium_co2")}

            <div class="sub-header">${this._t("editor_aquarium_extra_devices")}</div>
            ${extraDevices.map(
              (d, i) => html`
                <div class="override-row">
                  <div class="override-form">
                    <ha-form
                      .hass=${this.hass}
                      .data=${{ entity: d.entity, name: d.name ?? "", icon: d.icon ?? "" }}
                      .schema=${this._extraDeviceSchema()}
                      .computeLabel=${this._computeLabel}
                      @value-changed=${(ev: CustomEvent) => this._extraDeviceChanged(i, ev)}
                    ></ha-form>
                    ${colorRow(this._t("editor_color"), d.color, (v) => this._extraDeviceColorChanged(i, v))}
                  </div>
                  <button class="remove-btn" @click=${() => this._removeExtraDevice(i)}>
                    <ha-icon icon="mdi:close"></ha-icon>
                  </button>
                </div>
              `,
            )}
            <button class="add-btn" @click=${() => this._addExtraDevice()}>
              <ha-icon icon="mdi:plus"></ha-icon>
              ${this._t("editor_aquarium_add_device")}
            </button>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_aquarium_camera")}>
          <ha-icon slot="leading-icon" icon="mdi:cctv"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${cameraData}
              .schema=${this._cameraSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_aquarium_schedule")}>
          <ha-icon slot="leading-icon" icon="mdi:sun-clock-outline"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${scheduleMetaData}
              .schema=${this._scheduleMetaSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_aquarium_schedule_helper")}</div>
            ${phases.map(
              (p, i) => html`
                <div class="override-row">
                  <div class="override-form">
                    <ha-form
                      .hass=${this.hass}
                      .data=${{ device: p.device, start: p.start, end: p.end }}
                      .schema=${this._phaseSchema()}
                      .computeLabel=${this._computeLabel}
                      @value-changed=${(ev: CustomEvent) => this._phaseChanged(i, ev)}
                    ></ha-form>
                    ${colorRow(this._t("editor_color"), p.color, (v) => this._phaseColorChanged(i, v))}
                  </div>
                  <button class="remove-btn" @click=${() => this._removePhase(i)}>
                    <ha-icon icon="mdi:close"></ha-icon>
                  </button>
                </div>
              `,
            )}
            <button class="add-btn" @click=${() => this._addPhase()}>
              <ha-icon icon="mdi:plus"></ha-icon>
              ${this._t("editor_aquarium_add_phase")}
            </button>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_aquarium_maintenance")}>
          <ha-icon slot="leading-icon" icon="mdi:broom"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${maintenanceData}
              .schema=${this._maintenanceSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_aquarium_cleaning_interval_helper")}</div>

            <div class="sub-header">${this._t("editor_aquarium_reminder")}</div>
            <div class="hint">${this._t("editor_aquarium_reminder_hint")}</div>
            <ha-form
              .hass=${this.hass}
              .data=${reminderData}
              .schema=${this._reminderSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${notifyTokenHint(this._language, ["tage"])}</div>
            ${renderNotifyControls({
              hass: this.hass,
              language: this._language,
              enabled: this._config.notify_enabled ?? false,
              automationId: this._config.notify_automation_id,
              busy: this._reminderBusy,
              status: this._reminderStatus,
              detail: this._reminderDetail,
              successText: this._t("editor_aquarium_reminder_success"),
              blockedReason: !this._config.cleaning_entity
                ? this._t("editor_aquarium_reminder_missing")
                : this._config.cleaning_notify_service?.length
                  ? undefined
                  : this._t("editor_notify_missing"),
              onToggle: (on) => this._toggleReminder(on),
              onSetup: () => this._setupReminder(),
            })}

            <div class="sub-header">${this._t("editor_aquarium_feeding")}</div>
            <div class="hint">${this._t("editor_aquarium_feeding_hint")}</div>
            <ha-form
              .hass=${this.hass}
              .data=${feedingData}
              .schema=${this._feedingSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_aquarium_feeding_reminder_hint")}</div>
            ${renderNotifyControls({
              hass: this.hass,
              language: this._language,
              enabled: this._config.feeding_notify_enabled ?? false,
              automationId: this._config.feeding_notify_automation_id,
              busy: this._feedBusy,
              status: this._feedStatus,
              detail: this._feedDetail,
              successText: this._t("editor_aquarium_feeding_reminder_success"),
              blockedReason: !this._config.feeding_entity
                ? this._t("editor_aquarium_feeding_reminder_missing")
                : this._config.feeding_notify_service?.length
                  ? undefined
                  : this._t("editor_notify_missing"),
              onToggle: (on) => this._toggleFeedReminder(on),
              onSetup: () => this._setupFeedReminder(),
            })}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_colors")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            ${opacityRow(this._t("editor_aquarium_tile_tint_opacity"), this._config.tile_tint_opacity, 17, (v) => this._opacityChanged("tile_tint_opacity", v))}
            ${colorRow(this._t("editor_progress_text_color"), this._config.text_color, (v) => this._colorChanged("text_color", v))}
            ${colorRow(this._t("editor_progress_secondary_text_color"), this._config.secondary_text_color, (v) => this._colorChanged("secondary_text_color", v))}
            ${colorRow(this._t("editor_progress_card_background"), this._config.card_background, (v) => this._colorChanged("card_background", v))}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_animation")}>
          <ha-icon slot="leading-icon" icon="mdi:wave"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${animationData}
              .schema=${this._animationSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_progress_animation_reduced_motion_hint")}</div>
          </div>
        </ha-expansion-panel>

        ${renderAppearanceSection({
          hass: this.hass,
          language: this._language,
          config: this._config,
          defaultRadius: DEFAULT_AQUARIUM_RADIUS,
          state: this._appearance,
          computeLabel: this._computeLabel,
          onValueChanged: this._valueChanged.bind(this),
          onRadiusPresetChanged: this._radiusPresetChanged.bind(this),
          onCornersToggleChanged: this._cornersToggleChanged.bind(this),
          onCornerPresetChanged: this._cornerPresetChanged.bind(this),
          onCornerValueChanged: this._cornerValueChanged.bind(this),
        })}
      </div>
    `;
  }

  static styles = [
    editorStyles,
    notifyStyles,
    css`
      .slot-block {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding-bottom: 8px;
        margin-bottom: 8px;
        border-bottom: 1px solid rgba(127, 127, 127, 0.2);
      }

      .slot-block:last-of-type {
        border-bottom: none;
      }

      .slot-label {
        font-size: 12px;
        font-weight: 600;
        opacity: 0.7;
        color: var(--primary-text-color);
      }

      .sub-header {
        font-size: 13px;
        font-weight: 600;
        opacity: 0.7;
        color: var(--primary-text-color);
        margin-top: 4px;
      }

      .override-row {
        display: flex;
        align-items: flex-start;
        gap: 8px;
      }

      .override-form {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .remove-btn {
        flex-shrink: 0;
        width: 40px;
        height: 40px;
        border: none;
        border-radius: 8px;
        background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
        color: var(--primary-text-color);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .add-btn {
        width: 100%;
        height: 40px;
        border: none;
        border-radius: 8px;
        background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
        color: var(--primary-text-color);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-size: 14px;
        font-family: inherit;
      }

    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-aquarium-card-editor": M3AquariumCardEditor;
  }
}
