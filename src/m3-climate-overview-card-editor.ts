import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  LovelaceCardEditor,
  M3ClimateOverviewCardConfig,
  ClimateOverviewRoomConfig,
  ClimateOverviewPopupMode,
  HaActionConfig,
} from "./types";
import {
  DEFAULT_CLIMATE_OVERVIEW_RADIUS,
  DEFAULT_CLIMATE_OVERVIEW_TEMP_THRESHOLDS,
  DEFAULT_CLIMATE_OVERVIEW_HUMIDITY_RANGE,
  DEFAULT_CLIMATE_OVERVIEW_NAME_STRIP,
  CLIMATE_OVERVIEW_MOLD_HUMIDITY_THRESHOLD,
  CLIMATE_OVERVIEW_MOLD_TEMP_THRESHOLD,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import { fireEvent, colorRow, opacityRow, listRow, editorStyles, type SchemaEntry } from "./shared/editor-helpers";
import { renderDetailCardField } from "./shared/detail-card-editor";
import { radiusLabelMap } from "./shared/radius-editor";
import { discoverClimateRooms } from "./shared/ha-registry";
import { configFilter } from "./m3-climate-overview-card";
import {
  initAppearanceState,
  radiusPresetPatch,
  cornerPresetPatch,
  renderAppearanceSection,
  type AppearanceState,
} from "./shared/appearance-editor";
import {
  notifyServiceSchema,
  notifyModeSchema,
  notifyTimeSchema,
  notifyWeekdaySchema,
  notifyTokenHint,
  renderNotifyControls,
  setAutomationEnabled,
  notifyStyles,
  notifyTitleSchema,
  notifyMessageSchema,
  saveNotifyAutomation,
  notifyActions,
  resolveAutomationId,
  type NotifyAutomationSpec,
} from "./shared/notify-editor";

const DEFAULT_NOTIFY_TIME = "09:00:00";
const ACTION_KEYS = ["tap_action", "hold_action", "double_tap_action", "humidity_tap_action"] as const;

// A room only enters the mould digest when both readings exist — the card
// treats humidity as optional, so a temperature-only room can never satisfy
// the rule and is dropped here rather than producing a half-evaluated entry.
interface NotifyRoom {
  name: string;
  temperatureEntity: string;
  humidityEntity: string;
}

type ClimateOverviewColorField =
  | "cold_color"
  | "cool_color"
  | "comfortable_color"
  | "warm_color"
  | "hot_color"
  | "humidity_warn_color"
  | "accent_color"
  | "text_color"
  | "secondary_text_color"
  | "card_background";

@customElement("m3-climate-overview-card-editor")
export class M3ClimateOverviewCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3ClimateOverviewCardConfig;
  @state() private _appearance: AppearanceState = { showCustomRadius: false, showCorners: false, cornerCustom: {} };
  @state() private _notifyBusy = false;
  @state() private _notifyStatus: "idle" | "success" | "error" = "idle";
  @state() private _notifyDetail = "";

  public setConfig(config: M3ClimateOverviewCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_CLIMATE_OVERVIEW_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  // The notification has to cover exactly the rooms the card shows, and that
  // set is either the manual list or whatever auto-discovery finds right now.
  // Resolving it here (with the card's own precedence: a non-empty manual list
  // wins) and baking the pairs into the automation keeps the two in sync;
  // pressing the button again re-resolves after new sensors appear.
  private async _resolveNotifyRooms(): Promise<NotifyRoom[]> {
    const cfg = this._config;
    if (!cfg || !this.hass) return [];
    const source: { name: string; temperatureEntity?: string; humidityEntity?: string }[] = cfg.rooms?.length
      ? cfg.rooms.map((r) => ({
          name: r.name,
          temperatureEntity: r.temperature_entity,
          humidityEntity: r.humidity_entity,
        }))
      : (cfg.auto_discover ?? true)
        ? (
            await discoverClimateRooms(this.hass, {
              filter: configFilter(cfg),
              nameStrip: cfg.name_strip ?? DEFAULT_CLIMATE_OVERVIEW_NAME_STRIP,
            })
          ).map((r) => ({ name: r.name, temperatureEntity: r.temperatureEntity, humidityEntity: r.humidityEntity }))
        : [];

    return source.flatMap((r): NotifyRoom[] => {
      if (!r.temperatureEntity || !r.humidityEntity) return [];
      return [
        {
          name:
            r.name ||
            (this.hass!.states[r.temperatureEntity]?.attributes.friendly_name as string | undefined) ||
            r.temperatureEntity,
          temperatureEntity: r.temperatureEntity,
          humidityEntity: r.humidityEntity,
        },
      ];
    });
  }

  // Mirrors _moldRisk() in the card: humidity strictly above the humidity
  // threshold *and* temperature strictly below the temperature one. Both are
  // fixed constants on the card, so they are inlined here as literals.
  private _moldListTemplate(rooms: NotifyRoom[]): string {
    const unit = this.hass?.config?.unit_system?.temperature ?? "°C";
    // German renders decimals with a comma; the digest is plain text, so the
    // swap has to happen inside the template.
    const decimal = this._language.toLowerCase().startsWith("de") ? " | replace('.', ',')" : "";
    const pairs = JSON.stringify(
      rooms.map((r) => [r.name, r.temperatureEntity, r.humidityEntity]),
    );
    return (
      `{% set rooms = ${pairs} %}` +
      `{% set ns = namespace(items=[]) %}` +
      `{% for r in rooms %}{% set t = states[r[1]] %}{% set h = states[r[2]] %}` +
      `{% if t is not none and h is not none ` +
      `and t.state not in ['unknown', 'unavailable'] ` +
      `and h.state not in ['unknown', 'unavailable'] ` +
      `and h.state | float(0) > ${CLIMATE_OVERVIEW_MOLD_HUMIDITY_THRESHOLD} ` +
      `and t.state | float(100) < ${CLIMATE_OVERVIEW_MOLD_TEMP_THRESHOLD} %}` +
      `{% set ns.items = ns.items + [r[0] ~ ' (' ~ (h.state | float | round(0) | int) ~ ' %, ' ~ ` +
      `((t.state | float | round(1)) | string${decimal}) ~ ' ${unit})'] %}` +
      `{% endif %}{% endfor %}` +
      `{{ ns.items }}`
    );
  }

  // On switches the automation on (creating it first if needed); off pauses
  // it rather than deleting, so the configuration survives a toggle.
  private async _toggleNotify(enabled: boolean): Promise<void> {
    if (!this._config || !this.hass) return;
    this._config = { ...this._config, notify_enabled: enabled };
    fireEvent(this, "config-changed", { config: this._config });
    if (enabled) {
      await this._setupNotify();
      return;
    }
    const id = this._config.notify_automation_id;
    if (id) await setAutomationEnabled(this.hass, id, false);
  }

  private async _setupNotify(): Promise<void> {
    const cfg = this._config;
    if (!this.hass || !cfg) return;
    const targets = cfg.notify_service ?? [];
    if (targets.length === 0) {
      this._notifyStatus = "error";
      this._notifyDetail = this._t("editor_notify_missing");
      return;
    }
    this._notifyBusy = true;
    this._notifyStatus = "idle";
    this._notifyDetail = "";
    try {
      const rooms = await this._resolveNotifyRooms();
      if (rooms.length === 0) throw new Error(this._t("editor_climate_overview_notify_no_rooms"));
      const mode = cfg.notify_mode ?? "daily";
      const cardName = cfg.name || this._t("climate_overview_default_name");
      const automationId = resolveAutomationId("climate_mold", cfg.notify_automation_id);

      // One digest listing every room at risk, so a damp flat doesn't turn
      // into half a dozen separate pushes.
      const automation = {
        alias: `${cardName}: ${this._t("editor_climate_overview_notify_alias")}`,
        description: this._t("editor_climate_overview_notify_description"),
        mode: "single",
        variables: { mold_items: this._moldListTemplate(rooms) },
        triggers: [{ trigger: "time", at: cfg.notify_time || DEFAULT_NOTIFY_TIME }],
        conditions: [
          ...(mode === "weekly" ? [{ condition: "time", weekday: [cfg.notify_weekday || "mon"] }] : []),
          { condition: "template", value_template: "{{ mold_items | count > 0 }}" },
        ],
        actions: notifyActions(targets, cardName,
          `{{ mold_items | count }} ${this._t("editor_climate_overview_notify_digest")}\n• {{ mold_items | join('\n• ') }}`,
          { title: cfg.notify_title, message: cfg.notify_message, tokens: {
            anzahl: "{{ mold_items | count }}",
            liste: "{{ mold_items | join(', ') }}",
          } }),
      };

      await saveNotifyAutomation(this.hass, { id: automationId, ...automation } as NotifyAutomationSpec);
      if (cfg.notify_automation_id !== automationId) {
        this._config = { ...cfg, notify_automation_id: automationId };
        fireEvent(this, "config-changed", { config: this._config });
      }
      await setAutomationEnabled(this.hass, automationId, true);
      this._notifyStatus = "success";
      this._notifyDetail = `${rooms.length}`;
    } catch (e) {
      this._notifyStatus = "error";
      this._notifyDetail = e instanceof Error ? e.message : String(e);
    } finally {
      this._notifyBusy = false;
    }
  }

  // Free text as well as the four common states, so exotic states stay reachable.
  private _stateSelector() {
    return {
      select: {
        multiple: true,
        custom_value: true,
        options: [
          { value: "on", label: this._t("editor_climate_overview_state_on") },
          { value: "off", label: this._t("editor_climate_overview_state_off") },
          { value: "unavailable", label: this._t("editor_climate_overview_state_unavailable") },
          { value: "unknown", label: this._t("editor_climate_overview_state_unknown") },
        ],
      },
    };
  }

  private _actionSelector() {
    return {
      select: {
        mode: "dropdown" as const,
        options: [
          { value: "popup", label: this._t("editor_climate_overview_action_popup") },
          { value: "more-info", label: this._t("editor_climate_overview_action_more_info") },
          { value: "none", label: this._t("editor_climate_overview_action_none") },
        ],
      },
    };
  }

  private _modeSelector() {
    return {
      select: {
        mode: "dropdown" as const,
        options: [
          { value: "temperature", label: this._t("editor_climate_overview_mode_temperature") },
          { value: "thermostat", label: this._t("editor_climate_overview_mode_thermostat") },
          { value: "thermostat_only", label: this._t("editor_climate_overview_mode_thermostat_only") },
        ],
      },
    };
  }

  private _roomsMetaSchema(): SchemaEntry[] {
    return [
      { name: "auto_discover", selector: { boolean: {} } },
      { name: "mode", selector: this._modeSelector() },
      { name: "include_area", selector: { area: { multiple: true } } },
      { name: "exclude_area", selector: { area: { multiple: true } } },
      { name: "include_labels", selector: { label: { multiple: true } } },
      { name: "exclude_labels", selector: { label: { multiple: true } } },
      { name: "include_entities", selector: { entity: { domain: "sensor", multiple: true } } },
      { name: "exclude_entities", selector: { entity: { domain: "sensor", multiple: true } } },
      { name: "include_state", selector: this._stateSelector() },
      { name: "exclude_state", selector: this._stateSelector() },
    ];
  }

  private _roomSchema(): SchemaEntry[] {
    return [
      { name: "name", required: true, selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "temperature_entity", required: true, selector: { entity: { domain: "sensor", device_class: "temperature" } } },
      { name: "humidity_entity", selector: { entity: { domain: "sensor", device_class: "humidity" } } },
      { name: "climate_entity", selector: { entity: { domain: "climate" } } },
    ];
  }

  private _displaySchema(): SchemaEntry[] {
    return [
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "show_header", selector: { boolean: {} } },
      {
        name: "sort",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "area", label: this._t("editor_climate_overview_sort_area") },
              { value: "temp_desc", label: this._t("editor_climate_overview_sort_temp_desc") },
              { value: "temp_asc", label: this._t("editor_climate_overview_sort_temp_asc") },
              { value: "name", label: this._t("editor_climate_overview_sort_name") },
            ],
          },
        },
      },
      {
        name: "tile_tap_action",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "history", label: this._t("editor_climate_tap_history") },
              { value: "thermostat", label: this._t("editor_climate_tap_thermostat") },
            ],
          },
        },
      },
      { name: "max_visible", selector: { number: { min: 0, max: 60, mode: "box" } } },
      { name: "show_scale", selector: { boolean: {} } },
      { name: "show_scale_labels", selector: { boolean: {} } },
      { name: "show_outlier_chip", selector: { boolean: {} } },
      { name: "show_trend", selector: { boolean: {} } },
      { name: "show_mold_warning", selector: { boolean: {} } },
    ];
  }

  private _actionSchema(): SchemaEntry[] {
    return [
      { name: "tap_action", selector: this._actionSelector() },
      { name: "hold_action", selector: this._actionSelector() },
      { name: "double_tap_action", selector: this._actionSelector() },
      { name: "humidity_tap_action", selector: this._actionSelector() },
    ];
  }

  private _popupModeSelector() {
    return {
      select: {
        mode: "dropdown" as const,
        options: [
          { value: "default-grid", label: this._t("editor_climate_overview_popup_mode_default_grid") },
          { value: "default-detail", label: this._t("editor_climate_overview_popup_mode_default_detail") },
          { value: "custom", label: this._t("editor_climate_overview_popup_mode_custom") },
        ],
      },
    };
  }

  private _popupSchema(): SchemaEntry[] {
    return [
      { name: "title", selector: { text: {} } },
      { name: "inherit_filters", selector: { boolean: {} } },
      { name: "exclude_labels", selector: { label: { multiple: true } } },
      { name: "exclude_entities", selector: { entity: { domain: "sensor", multiple: true } } },
    ];
  }

  private _thresholdsSchema(): SchemaEntry[] {
    return [
      { name: "cold", selector: { number: { mode: "box", step: 0.5, unit_of_measurement: "°" } } },
      { name: "cool", selector: { number: { mode: "box", step: 0.5, unit_of_measurement: "°" } } },
      { name: "comfortable", selector: { number: { mode: "box", step: 0.5, unit_of_measurement: "°" } } },
      { name: "warm", selector: { number: { mode: "box", step: 0.5, unit_of_measurement: "°" } } },
    ];
  }

  private _humidityRangeSchema(): SchemaEntry[] {
    return [
      { name: "humidity_min", selector: { number: { min: 0, max: 100, mode: "box", unit_of_measurement: "%" } } },
      { name: "humidity_max", selector: { number: { min: 0, max: 100, mode: "box", unit_of_measurement: "%" } } },
    ];
  }

  private _scaleRangeSchema(): SchemaEntry[] {
    return [
      { name: "scale_min", selector: { number: { mode: "box", unit_of_measurement: "°" } } },
      { name: "scale_max", selector: { number: { mode: "box", unit_of_measurement: "°" } } },
    ];
  }

  private _notifySchema(): SchemaEntry[] {
    const schema: SchemaEntry[] = [
      notifyServiceSchema(this.hass),
      notifyModeSchema([
        { value: "daily", label: this._t("editor_climate_overview_notify_mode_daily") },
        { value: "weekly", label: this._t("editor_climate_overview_notify_mode_weekly") },
      ]),
      notifyTimeSchema(),
    ];
    if ((this._config?.notify_mode ?? "daily") === "weekly") {
      schema.push(notifyWeekdaySchema(this._language));
    }
    schema.push(notifyTitleSchema("notify_title"), notifyMessageSchema("notify_message"));
    return schema;
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

  private _computeHelper = (schema: SchemaEntry): string | undefined =>
    schema.name === "max_visible" ? this._t("editor_climate_max_visible_helper") : undefined;

  private _computeLabel = (schema: SchemaEntry): string => {
    const labelMap: Record<string, TranslationKey> = {
      auto_discover: "editor_climate_overview_auto_discover",
      mode: "editor_climate_overview_mode",
      include_area: "editor_climate_overview_include_area",
      exclude_area: "editor_climate_overview_exclude_area",
      include_labels: "editor_climate_overview_include_labels",
      exclude_labels: "editor_climate_overview_exclude_labels",
      include_entities: "editor_climate_overview_include_entities",
      exclude_entities: "editor_climate_overview_exclude_entities",
      include_state: "editor_climate_overview_include_state",
      exclude_state: "editor_climate_overview_exclude_state",
      name: "editor_name",
      icon: "editor_icon",
      show_header: "editor_show_header",
      temperature_entity: "editor_climate_overview_room_temp_entity",
      humidity_entity: "editor_climate_overview_room_humidity_entity",
      climate_entity: "editor_climate_room_climate",
      tile_tap_action: "editor_climate_tile_tap",
      max_visible: "editor_climate_max_visible",
      tap_action: "editor_climate_overview_tap_action",
      hold_action: "editor_climate_overview_hold_action",
      double_tap_action: "editor_climate_overview_double_tap_action",
      humidity_tap_action: "editor_climate_overview_humidity_tap_action",
      title: "editor_climate_overview_popup_title",
      inherit_filters: "editor_climate_overview_popup_inherit",
      sort: "editor_climate_overview_sort",
      show_scale: "editor_climate_overview_show_scale",
      show_scale_labels: "editor_climate_overview_show_scale_labels",
      show_outlier_chip: "editor_climate_overview_show_outlier_chip",
      show_trend: "editor_climate_overview_show_trend",
      show_mold_warning: "editor_climate_overview_show_mold_warning",
      cold: "editor_climate_overview_threshold_cold",
      cool: "editor_climate_overview_threshold_cool",
      comfortable: "editor_climate_overview_threshold_comfortable",
      warm: "editor_climate_overview_threshold_warm",
      humidity_min: "editor_climate_overview_humidity_min",
      humidity_max: "editor_climate_overview_humidity_max",
      scale_min: "editor_climate_overview_scale_min",
      scale_max: "editor_climate_overview_scale_max",
      notify_service: "editor_notify_service",
      notify_title: "editor_notify_title",
      notify_message: "editor_notify_message",
      notify_mode: "editor_notify_mode",
      notify_time: "editor_notify_time",
      notify_weekday: "editor_notify_weekday",
      animation: "editor_progress_animation",
      glass_background: "editor_glass_background",
      ...radiusLabelMap,
    };
    const key = labelMap[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    this._config = { ...this._config, ...ev.detail.value };
    fireEvent(this, "config-changed", { config: this._config });
  }

  // The form hands back bare action-kind strings; the config stores HA's
  // object form so navigate/url stay expressible in YAML.
  private _actionsChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const value = ev.detail.value as Record<string, string>;
    const patch: Partial<Record<(typeof ACTION_KEYS)[number], HaActionConfig>> = {};
    for (const key of ACTION_KEYS) {
      const action = value[key];
      if (action) patch[key] = { action } as HaActionConfig;
    }
    this._config = { ...this._config, ...patch };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _popupCardChanged(value: Record<string, unknown> | undefined): void {
    if (!this._config) return;
    this._config = { ...this._config, popup: { ...(this._config.popup ?? {}), card: value } };
    fireEvent(this, "config-changed", { config: this._config });
  }

  // Kept separate from _popupChanged: that ha-form's schema names its field
  // "mode" too (the auto-discovery mode, editor_climate_overview_mode), and
  // computeLabel is one shared dictionary keyed by schema name — reusing
  // "mode" here would show the wrong label on one of the two fields.
  private _popupModeChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const mode = (ev.detail.value as { mode: ClimateOverviewPopupMode }).mode;
    this._config = { ...this._config, popup: { ...(this._config.popup ?? {}), mode } };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _popupChanged(ev: CustomEvent): void {
    if (!this._config) return;
    this._config = { ...this._config, popup: { ...(this._config.popup ?? {}), ...ev.detail.value } };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _thresholdsChanged(ev: CustomEvent): void {
    if (!this._config) return;
    this._config = { ...this._config, temp_thresholds: { ...ev.detail.value } };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _humidityRangeChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const v = ev.detail.value as { humidity_min: number; humidity_max: number };
    this._config = { ...this._config, humidity_range: [v.humidity_min, v.humidity_max] };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _scaleRangeChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const v = ev.detail.value as { scale_min?: number; scale_max?: number };
    const config = { ...this._config };
    if (v.scale_min === undefined || v.scale_min === null || Number.isNaN(v.scale_min)) {
      delete config.scale_min;
    } else {
      config.scale_min = v.scale_min;
    }
    if (v.scale_max === undefined || v.scale_max === null || Number.isNaN(v.scale_max)) {
      delete config.scale_max;
    } else {
      config.scale_max = v.scale_max;
    }
    this._config = config;
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _colorChanged(field: ClimateOverviewColorField, value: string): void {
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

  private _nameStripChanged(values: string[]): void {
    if (!this._config) return;
    this._config = { ...this._config, name_strip: values };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _roomChanged(index: number, ev: CustomEvent): void {
    if (!this._config) return;
    const rooms = [...(this._config.rooms ?? [])];
    const value = ev.detail.value as ClimateOverviewRoomConfig;
    rooms[index] = {
      name: value.name ?? "",
      icon: value.icon || undefined,
      temperature_entity: value.temperature_entity ?? "",
      humidity_entity: value.humidity_entity || undefined,
      climate_entity: value.climate_entity || undefined,
      color: rooms[index]?.color,
    };
    this._config = { ...this._config, rooms };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _roomColorChanged(index: number, value: string): void {
    if (!this._config) return;
    const rooms = [...(this._config.rooms ?? [])];
    if (!rooms[index]) return;
    rooms[index] = { ...rooms[index], color: value || undefined };
    this._config = { ...this._config, rooms };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _addRoom(): void {
    if (!this._config) return;
    const rooms = [...(this._config.rooms ?? []), { name: "", temperature_entity: "" }];
    this._config = { ...this._config, rooms };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _removeRoom(index: number): void {
    if (!this._config) return;
    const rooms = [...(this._config.rooms ?? [])];
    rooms.splice(index, 1);
    this._config = { ...this._config, rooms };
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
      const { corners: _corners, ...rest } = this._config;
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

  protected render() {
    if (!this.hass || !this._config) return nothing;

    const roomsMetaData = {
      auto_discover: this._config.auto_discover ?? true,
      mode: this._config.mode ?? "temperature",
      include_area: this._config.include_area ?? [],
      exclude_area: this._config.exclude_area ?? [],
      include_labels: this._config.include_labels ?? [],
      exclude_labels: this._config.exclude_labels ?? [],
      include_entities: this._config.include_entities ?? [],
      exclude_entities: this._config.exclude_entities ?? [],
      include_state: this._config.include_state ?? [],
      exclude_state: this._config.exclude_state ?? [],
    };
    const rooms = this._config.rooms ?? [];

    const displayData = {
      name: this._config.name,
      icon: this._config.icon,
      show_header: this._config.show_header ?? true,
      sort: this._config.sort ?? "area",
      tile_tap_action: this._config.tile_tap_action ?? "history",
      max_visible: this._config.max_visible ?? 0,
      show_scale: this._config.show_scale ?? true,
      show_scale_labels: this._config.show_scale_labels ?? true,
      show_outlier_chip: this._config.show_outlier_chip ?? true,
      show_trend: this._config.show_trend ?? false,
      show_mold_warning: this._config.show_mold_warning ?? false,
    };

    const actionsData = {
      tap_action: this._config.tap_action?.action ?? "more-info",
      hold_action: this._config.hold_action?.action ?? "popup",
      double_tap_action: this._config.double_tap_action?.action ?? "none",
      humidity_tap_action: this._config.humidity_tap_action?.action ?? "more-info",
    };

    const popup = this._config.popup ?? {};
    const popupMode: ClimateOverviewPopupMode = popup.mode ?? "default-grid";
    const popupData = {
      title: popup.title ?? "",
      inherit_filters: popup.inherit_filters ?? true,
      exclude_labels: popup.exclude_labels ?? [],
      exclude_entities: popup.exclude_entities ?? [],
    };

    const t = this._config.temp_thresholds ?? {};
    const thresholdsData = {
      cold: t.cold ?? DEFAULT_CLIMATE_OVERVIEW_TEMP_THRESHOLDS.cold,
      cool: t.cool ?? DEFAULT_CLIMATE_OVERVIEW_TEMP_THRESHOLDS.cool,
      comfortable: t.comfortable ?? DEFAULT_CLIMATE_OVERVIEW_TEMP_THRESHOLDS.comfortable,
      warm: t.warm ?? DEFAULT_CLIMATE_OVERVIEW_TEMP_THRESHOLDS.warm,
    };
    const [humidityMin, humidityMax] = this._config.humidity_range ?? DEFAULT_CLIMATE_OVERVIEW_HUMIDITY_RANGE;
    const humidityRangeData = { humidity_min: humidityMin, humidity_max: humidityMax };
    const scaleRangeData = { scale_min: this._config.scale_min, scale_max: this._config.scale_max };
    const animationData = { animation: this._config.animation ?? "auto" };
    const notifyData = {
      notify_service: this._config.notify_service ?? [],
      notify_mode: this._config.notify_mode ?? "daily",
      notify_time: this._config.notify_time ?? DEFAULT_NOTIFY_TIME,
      notify_weekday: this._config.notify_weekday ?? "mon",
    };

    return html`
      <div class="editor">
        <ha-expansion-panel outlined .header=${this._t("editor_content")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:text-short"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${displayData}
              .schema=${this._displaySchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            ${listRow(
              this._t("editor_climate_overview_name_strip"),
              this._config.name_strip ?? DEFAULT_CLIMATE_OVERVIEW_NAME_STRIP,
              (v) => this._nameStripChanged(v),
            )}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_entities")}>
          <ha-icon slot="leading-icon" icon="mdi:home-search-outline"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${roomsMetaData}
              .schema=${this._roomsMetaSchema()}
              .computeLabel=${this._computeLabel}
              .computeHelper=${this._computeHelper}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_climate_overview_rooms_helper")}</div>
            ${rooms.map(
              (r, i) => html`
                <div class="override-row">
                  <div class="override-form">
                    <ha-form
                      .hass=${this.hass}
                      .data=${{
                        name: r.name,
                        icon: r.icon ?? "",
                        temperature_entity: r.temperature_entity,
                        humidity_entity: r.humidity_entity ?? "",
                        climate_entity: r.climate_entity ?? "",
                      }}
                      .schema=${this._roomSchema()}
                      .computeLabel=${this._computeLabel}
              .computeHelper=${this._computeHelper}
                      @value-changed=${(ev: CustomEvent) => this._roomChanged(i, ev)}
                    ></ha-form>
                    ${colorRow(this._t("editor_climate_overview_room_color"), r.color, (v) => this._roomColorChanged(i, v))}
                  </div>
                  <button class="remove-btn" @click=${() => this._removeRoom(i)}>
                    <ha-icon icon="mdi:close"></ha-icon>
                  </button>
                </div>
              `,
            )}
            <button class="add-btn" @click=${() => this._addRoom()}>
              <ha-icon icon="mdi:plus"></ha-icon>
              ${this._t("editor_climate_overview_add_room")}
            </button>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_behavior")}>
          <ha-icon slot="leading-icon" icon="mdi:gesture-tap"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${actionsData}
              .schema=${this._actionSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._actionsChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        ${[actionsData.tap_action, actionsData.hold_action, actionsData.double_tap_action].includes("popup")
          ? html`
              <ha-expansion-panel outlined .header=${this._t("editor_climate_overview_popup_section")}>
                <ha-icon slot="leading-icon" icon="mdi:open-in-new"></ha-icon>
                <div class="panel-content">
                  <ha-form
                    .hass=${this.hass}
                    .data=${{ mode: popupMode }}
                    .schema=${[{ name: "mode", selector: this._popupModeSelector() }]}
                    .computeLabel=${() => this._t("editor_climate_overview_popup_mode")}
                    @value-changed=${this._popupModeChanged}
                  ></ha-form>

                  ${popupMode === "default-detail"
                    ? html`<div class="hint">${this._t("editor_climate_overview_popup_mode_default_detail_hint")}</div>`
                    : nothing}

                  ${popupMode === "default-grid"
                    ? html`
                        <ha-form
                          .hass=${this.hass}
                          .data=${popupData}
                          .schema=${this._popupSchema()}
                          .computeLabel=${this._computeLabel}
                          @value-changed=${this._popupChanged}
                        ></ha-form>
                      `
                    : nothing}

                  ${popupMode === "custom"
                    ? renderDetailCardField({
                        hass: this.hass,
                        value: popup.card,
                        label: this._t("editor_climate_overview_popup_card"),
                        hint: this._t("editor_climate_overview_popup_card_hint"),
                        onChange: (v) => this._popupCardChanged(v),
                      })
                    : nothing}
                </div>
              </ha-expansion-panel>
            `
          : nothing}

        <ha-expansion-panel outlined .header=${this._t("editor_battery_thresholds")}>
          <ha-icon slot="leading-icon" icon="mdi:thermometer-lines"></ha-icon>
          <div class="panel-content">
            <div class="hint">${this._t("editor_climate_overview_thresholds_helper")}</div>
            <ha-form
              .hass=${this.hass}
              .data=${thresholdsData}
              .schema=${this._thresholdsSchema()}
              .computeLabel=${this._computeLabel}
              .computeHelper=${this._computeHelper}
              @value-changed=${this._thresholdsChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_climate_overview_humidity_range_helper")}</div>
            <ha-form
              .hass=${this.hass}
              .data=${humidityRangeData}
              .schema=${this._humidityRangeSchema()}
              .computeLabel=${this._computeLabel}
              .computeHelper=${this._computeHelper}
              @value-changed=${this._humidityRangeChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_climate_overview_scale_range_helper")}</div>
            <ha-form
              .hass=${this.hass}
              .data=${scaleRangeData}
              .schema=${this._scaleRangeSchema()}
              .computeLabel=${this._computeLabel}
              .computeHelper=${this._computeHelper}
              @value-changed=${this._scaleRangeChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_notify")}>
          <ha-icon slot="leading-icon" icon="mdi:bell-outline"></ha-icon>
          <div class="panel-content">
            <div class="hint">
              ${this._t("editor_climate_overview_notify_rule_hint")
                .replace("{h}", String(CLIMATE_OVERVIEW_MOLD_HUMIDITY_THRESHOLD))
                .replace("{t}", String(CLIMATE_OVERVIEW_MOLD_TEMP_THRESHOLD))}
            </div>
            <div class="hint">${this._t("editor_notify_hint")}</div>
            <ha-form
              .hass=${this.hass}
              .data=${notifyData}
              .schema=${this._notifySchema()}
              .computeLabel=${this._computeLabel}
              .computeHelper=${this._computeHelper}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_climate_overview_notify_rooms_hint")}</div>
            ${this._config.show_mold_warning
              ? nothing
              : html`<div class="hint">${this._t("editor_climate_overview_notify_warning_off_hint")}</div>`}
            <div class="hint">${notifyTokenHint(this._language, ["anzahl", "liste"])}</div>
            ${renderNotifyControls({
              hass: this.hass,
              enabled: this._config.notify_enabled ?? false,
              automationId: this._config.notify_automation_id,
              blockedReason: this._config.notify_service?.length ? undefined : this._t("editor_notify_missing"),
              language: this._language,
              busy: this._notifyBusy,
              status: this._notifyStatus,
              detail: this._notifyDetail,
              successText: `${this._t("editor_climate_overview_notify_success_prefix")} ${this._notifyDetail} ${this._t("editor_climate_overview_notify_success_suffix")}`,
              onToggle: (on) => this._toggleNotify(on),
              onSetup: () => this._setupNotify(),
            })}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_colors")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            ${colorRow(this._t("editor_climate_overview_cold_color"), this._config.cold_color, (v) => this._colorChanged("cold_color", v))}
            ${colorRow(this._t("editor_climate_overview_cool_color"), this._config.cool_color, (v) => this._colorChanged("cool_color", v))}
            ${colorRow(this._t("editor_climate_overview_comfortable_color"), this._config.comfortable_color, (v) => this._colorChanged("comfortable_color", v))}
            ${colorRow(this._t("editor_climate_overview_warm_color"), this._config.warm_color, (v) => this._colorChanged("warm_color", v))}
            ${colorRow(this._t("editor_climate_overview_hot_color"), this._config.hot_color, (v) => this._colorChanged("hot_color", v))}
            ${opacityRow(this._t("editor_climate_overview_tile_tint_opacity"), this._config.tile_tint_opacity, 12, (v) => this._opacityChanged("tile_tint_opacity", v))}
            ${colorRow(this._t("editor_climate_overview_humidity_warn_color"), this._config.humidity_warn_color, (v) => this._colorChanged("humidity_warn_color", v))}
            ${colorRow(
              this._t("editor_climate_overview_accent_color"),
              this._config.accent_color,
              (v) => this._colorChanged("accent_color", v),
              {
                label: this._t("editor_climate_overview_accent_opacity"),
                value: this._config.accent_opacity,
                defaultValue: 12,
                onChange: (v) => this._opacityChanged("accent_opacity", v),
              },
            )}
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
              .computeHelper=${this._computeHelper}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_progress_animation_reduced_motion_hint")}</div>
          </div>
        </ha-expansion-panel>

        ${renderAppearanceSection({
          hass: this.hass,
          language: this._language,
          config: this._config,
          defaultRadius: DEFAULT_CLIMATE_OVERVIEW_RADIUS,
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
    "m3-climate-overview-card-editor": M3ClimateOverviewCardEditor;
  }
}
