import type { NotifyConfigBase } from "./shared/notify-editor";
import type { EntityFilterConfig } from "./shared/entity-filter";
import type { LightGroupHandling } from "./shared/ha-registry";
import type { QuickBarMode } from "./shared/quick-bar";

export interface HomeAssistant {
  states: Record<string, HassEntity>;
  /** Registry snapshots the modern frontend keeps on `hass` itself, so a card
   *  can resolve areas without a websocket round-trip. Optional because an
   *  older frontend does not provide them. */
  areas?: Record<string, unknown>;
  devices?: Record<string, unknown>;
  entities?: Record<string, unknown>;
  locale: {
    language: string;
    number_format?: string;
    time_format?: string;
  };
  language: string;
  themes: Record<string, unknown>;
  config: {
    unit_system: {
      temperature: string;
      [key: string]: string;
    };
    /** IANA zone the Home Assistant instance runs in, e.g. "Europe/Berlin". */
    time_zone?: string;
    /** Integrations currently loaded, e.g. "conversation". Optional because an
     *  older frontend does not put the list on `hass`. */
    components?: string[];
  };
  /** The logged-in user. Optional for the same reason as the registries above:
   *  a card must work without it rather than assume it is there. */
  user?: {
    is_admin?: boolean;
    name?: string;
  };
  /** The profile's "keyboard shortcuts" switch. Home Assistant's own shortcut
   *  handlers return immediately when it is off — see shared/quick-bar.ts. */
  enableShortcuts?: boolean;
  callService: (
    domain: string,
    service: string,
    data?: Record<string, unknown>,
    target?: { entity_id?: string | string[]; device_id?: string | string[]; area_id?: string | string[] },
  ) => Promise<void>;
  callWS: <T = unknown>(msg: Record<string, unknown>) => Promise<T>;
  // REST fallback for endpoints with no websocket equivalent (e.g. writing an
  // automation config). Refreshes the access token on its own, unlike a plain
  // fetch() with hass.auth.data.access_token.
  callApi: <T = unknown>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    parameters?: Record<string, unknown>,
  ) => Promise<T>;
  services: Record<string, Record<string, unknown>>;
  /** False while the websocket is down — states are the last known ones. */
  connected?: boolean;
  formatEntityState?: (stateObj: HassEntity) => string;
}

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed: string;
  last_updated: string;
}

export type HvacMode =
  | "off"
  | "heat"
  | "cool"
  | "dry"
  | "auto"
  | "fan_only"
  | "heat_cool";

export interface CornerRadiusConfig {
  top_left?: number;
  top_right?: number;
  bottom_right?: number;
  bottom_left?: number;
}

export interface ModeColorOverrides {
  off?: string;
  heat?: string;
  cool?: string;
  dry?: string;
  auto?: string;
  fan_only?: string;
  heat_cool?: string;
}

export interface M3ClimateCardConfig {
  type: string;
  entity: string;
  name?: string;
  icon?: string;
  show_presets?: boolean;
  show_sensors?: boolean;
  temperature_sensor?: string;
  humidity_sensor?: string;
  window_sensor?: string;
  battery_sensor?: string;
  battery_threshold?: number;
  mode_colors?: ModeColorOverrides;
  icon_active_color?: string;
  icon_inactive_color?: string;
  icon_opacity?: number;
  plus_active_color?: string;
  plus_inactive_color?: string;
  plus_opacity?: number;
  minus_active_color?: string;
  minus_inactive_color?: string;
  minus_opacity?: number;
  glass_background?: boolean;
  preset_style?: "chip" | "pill";
  temperature_chip_placement?: "info_row" | "header";
  hidden_modes?: string[];
  height?: number;
  radius?: number;
  corners?: CornerRadiusConfig;
  animation?: "auto" | "on" | "off";
  /** @deprecated use `animation` — kept for old-config migration only. */
  animations?: boolean;
  unavailable_style?: "dimmed" | "normal" | "hidden";
  card_version?: string;
}

export interface M3ClimateCardMiniConfig {
  type: string;
  entity: string;
  name?: string;
  icon?: string;
  mode_colors?: ModeColorOverrides;
  icon_active_color?: string;
  icon_active_opacity?: number;
  icon_inactive_color?: string;
  icon_inactive_opacity?: number;
  power_active_color?: string;
  power_active_opacity?: number;
  power_inactive_color?: string;
  power_inactive_opacity?: number;
  plus_active_color?: string;
  plus_inactive_color?: string;
  plus_opacity?: number;
  minus_active_color?: string;
  minus_inactive_color?: string;
  minus_opacity?: number;
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  animation?: "auto" | "on" | "off";
  /** @deprecated use `animation` — kept for old-config migration only. */
  animations?: boolean;
  unavailable_style?: "dimmed" | "normal" | "hidden";
  card_version?: string;
}

export interface HaActionConfig {
  action:
    | "more-info"
    | "toggle"
    | "call-service"
    | "perform-action"
    | "navigate"
    | "url"
    | "assist"
    // A card-defined popup rather than HA's own more-info dialog —
    // see shared/actions.ts and shared/popup-card.ts.
    | "popup"
    | "none";
  service?: string;
  perform_action?: string;
  service_data?: Record<string, unknown>;
  data?: Record<string, unknown>;
  target?: Record<string, unknown>;
  navigation_path?: string;
  url_path?: string;
  new_tab?: boolean;
  /**
   * Ask before running. Home Assistant's own action editor offers this, and an
   * action that carries it must not run without asking — the whole point of
   * putting it on "restart Home Assistant" is that a stray tap does not.
   */
  confirmation?: boolean | { text?: string };
}

export interface M3ButtonCardConfig {
  type: string;
  entity?: string;
  name?: string;
  icon?: string;
  /**
   * Icon shown while the entity is off. Without one the same icon is used for
   * both states, which is the usual case — a struck-through or hollow variant
   * only exists for some symbols.
   */
  icon_off?: string;
  color?: string;
  color_opacity?: number;
  inactive_color?: string;
  inactive_opacity?: number;
  invert_colors?: boolean;
  state_colors?: Record<string, string>;
  show_state?: boolean;
  state_content?: "state" | "last_changed" | "last_updated";
  show_icon_background?: boolean;
  /**
   * How the well behind the icon is filled while the entity is on. `tint` is a
   * wash of the accent with the accent-coloured glyph on it; `solid` fills the
   * well with the accent and darkens the glyph, which is the louder of the two
   * and what a phone's quick settings use.
   */
  icon_fill?: "tint" | "solid";
  icon_size?: number;
  align_icons?: boolean;
  static_color?: boolean;
  unavailable_style?: "dimmed" | "normal" | "hidden";
  show_slider?: boolean;
  vertical?: boolean;
  /**
   * Lets the shape follow the entity: a capsule while it is off, the configured
   * corner radius while it is on, with the icon well going from a circle to a
   * rounded square alongside it.
   */
  shape_by_state?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  glass_background?: boolean;
  animation?: "auto" | "on" | "off";
  /** @deprecated use `animation` — kept for old-config migration only. */
  animations?: boolean;
  card_version?: string;
  tap_action?: HaActionConfig;
  hold_action?: HaActionConfig;
  double_tap_action?: HaActionConfig;
  icon_tap_action?: HaActionConfig;
  icon_hold_action?: HaActionConfig;
  icon_double_tap_action?: HaActionConfig;
}

export interface ProgressStateColors {
  running?: string;
  preparing?: string;
  done?: string;
}

export interface M3ProgressCardConfig extends NotifyConfigBase {
  // notify_service / notify_automation_id come from NotifyConfigBase — see
  // shared/notify-editor. The "appliance finished" automation needs no
  // schedule, so notify_mode/time/weekday stay unused here.
  type: string;
  entity: string;
  percentage_entity?: string;
  remaining_entity?: string;
  name?: string;
  icon?: string;
  status_text_running?: string;
  status_text_preparing?: string;
  status_text_done?: string;
  status_text_ready?: string;
  running_states?: string[];
  preparing_states?: string[];
  done_states?: string[];
  animation?: "auto" | "on" | "off";
  wave_style?: "wavy" | "flat";
  accent_color?: string;
  track_color?: string;
  dot_color?: string;
  icon_color?: string;
  icon_background?: string;
  icon_background_opacity?: number;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  state_colors?: ProgressStateColors;
  hide_when_ready?: boolean;
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

export type EnergyNotifyMode = "day_end" | "month_end";

export interface M3EnergyCardConfig extends NotifyConfigBase {
  type: string;
  entity?: string;
  unit?: string;
  // notify_service / notify_time / notify_automation_id come from
  // NotifyConfigBase — see shared/notify-editor. notify_weekday is unused
  // here (both report modes are date-driven, not weekday-driven).
  notify_mode?: EnergyNotifyMode;
  /**
   * Sensor the notification reads instead of `entity`. The chart's entity is
   * often a lifetime counter (correct for statistics-backed bars, useless in
   * a Jinja template); this lets the report point at a period-scoped
   * utility_meter of the same source without changing what the chart draws.
   */
  notify_entity?: string;
  statistic_type?: "change" | "state";
  mode?: "consumption" | "solar";
  source?: "entity" | "energy";
  forecast_entity?: string;
  full_day?: boolean;
  show_legend?: boolean;
  period?: "day" | "hour" | "month";
  days?: number;
  hours?: number;
  months?: number;
  show_values?: boolean;
  show_projection?: boolean;
  show_comparison?: boolean;
  show_average?: boolean;
  higher_is_better?: boolean;
  comparison_better_color?: string;
  comparison_worse_color?: string;
  comparison_tint_opacity?: number;
  name?: string;
  icon?: string;
  subtitle?: string;
  accent_color?: string;
  accent_opacity?: number;
  bar_tint_color?: string;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  animation?: "auto" | "on" | "off";
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

export type GaugeSource = "energy" | "entities";

export interface M3GaugeCardConfig {
  type: string;
  source?: GaugeSource;
  value_a_entity?: string;
  value_b_entity?: string;
  name?: string;
  icon?: string;
  subtitle?: string;
  label_positive?: string;
  label_negative?: string;
  label_a?: string;
  label_b?: string;
  segment_a_color?: string;
  segment_a_opacity?: number;
  segment_b_color?: string;
  track_color?: string;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  animation?: "auto" | "on" | "off";
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

export type EnergyFlowSource = "energy" | "entities";
export type FlowBatteryVisibility = "auto" | "always" | "never";
export type FlowSpeed = "slow" | "normal" | "fast";

export interface M3EnergyFlowCardConfig {
  type: string;
  source?: EnergyFlowSource;
  solar_entity?: string;
  grid_import_entity?: string;
  grid_export_entity?: string;
  battery_entity?: string;
  name?: string;
  icon?: string;
  show_self_sufficiency?: boolean;
  show_battery?: FlowBatteryVisibility;
  pv_color?: string;
  grid_color?: string;
  home_color?: string;
  battery_color?: string;
  self_sufficiency_color?: string;
  text_color?: string;
  text_opacity?: number;
  node_tint_opacity?: number;
  secondary_text_color?: string;
  card_background?: string;
  animation?: "auto" | "on" | "off";
  flow_speed?: FlowSpeed;
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

export interface PowerThreshold {
  above: number;
  color: string;
}

export interface M3CounterCardConfig {
  type: string;
  entity: string;
  power_entity?: string;
  daily_entity?: string;
  name?: string;
  icon?: string;
  subtitle?: string;
  decimals?: number;
  digits?: number | "auto";
  show_ticker?: boolean;
  /** Offers a control to correct the reading. */
  adjustable?: boolean;
  /**
   * The writable entity the correction goes to. Left unset it is `entity`
   * itself, which only works for a writable domain. Pointing it at a separate
   * helper switches to offset mode: the helper is moved by the same amount
   * the reading should move, which is what a template sensor needs.
   */
  adjust_entity?: string;
  accent_color?: string;
  accent_opacity?: number;
  cell_background?: string;
  power_chip_color?: string;
  power_chip_opacity?: number;
  power_thresholds?: PowerThreshold[];
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  animation?: "auto" | "on" | "off";
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

// One of the two places this project uses `type` for something that is not a
// card type. `NON_CARD_TYPES` in shared/config-templates.ts lists these so the
// template walk does not mistake such an entry for a nested card config.
export type PowerEntryType = "consumer" | "producer";

export interface PowerListEntity {
  entity: string;
  name?: string;
  icon?: string;
  type?: PowerEntryType;
}

export type PowerListSort = "power_desc" | "power_asc" | "name" | "config";

export interface M3PowerListCardConfig extends NotifyConfigBase {
  type: string;
  entities?: PowerListEntity[];
  auto_discover?: boolean;
  include_area?: string[];
  include_label?: string[];
  exclude_entities?: string[];
  threshold?: number;
  // notify_service / notify_mode / notify_time / notify_weekday /
  // notify_automation_id come from NotifyConfigBase — see shared/notify-editor.
  /** Watts a device must exceed before the "left running" clock starts. */
  notify_power_threshold?: number;
  /** How long it has to stay above that draw before notifying. */
  notify_duration_hours?: number;
  /** Devices that are meant to run around the clock (fridge, router, NAS). */
  notify_exclude_entities?: string[];
  sort?: PowerListSort;
  max_visible?: number;
  show_idle_toggle?: boolean;
  name?: string;
  icon?: string;
  subtitle?: string;
  accent_color?: string;
  accent_opacity?: number;
  producer_color?: string;
  producer_opacity?: number;
  bar_tint_color?: string;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  animation?: "auto" | "on" | "off";
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

export type GridSignConvention = "negative_is_export" | "positive_is_export";

export interface PowerMetricConfig {
  entity: string;
  name?: string;
  icon?: string;
  color?: string;
  type?: PowerEntryType;
}

export interface M3PowerSummaryCardConfig {
  type: string;
  grid_entity: string;
  grid_sign?: GridSignConvention;
  consumption_entity?: string;
  solar_entity?: string | string[];
  metrics?: PowerMetricConfig[];
  label_export?: string;
  label_import?: string;
  show_self_sufficiency?: boolean;
  show_split_bar?: boolean;
  zero_threshold?: number;
  kw_threshold?: number;
  export_color?: string;
  import_color?: string;
  producer_color?: string;
  flow_tint_opacity?: number;
  accent_color?: string;
  accent_opacity?: number;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  animation?: "auto" | "on" | "off";
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

export type TopConsumersPeriod = "today" | "yesterday" | "week" | "month";
export type TopConsumersRestMode = "collapse" | "hide" | "show_all";
export type TopConsumersSource = "energy" | "entities";

export interface TopConsumerEntityConfig {
  entity: string;
  name?: string;
  icon?: string;
  color?: string;
}

export type TopConsumersUnitMode = "energy" | "cost";

export interface M3TopConsumersCardConfig extends PricingConfig, NotifyConfigBase {
  // notify_service / notify_mode / notify_time / notify_weekday /
  // notify_automation_id come from NotifyConfigBase — see
  // shared/notify-editor. The weekly digest only works for utility_meter
  // helpers on a weekly cycle (see the editor for why), so notify_mode here
  // selects which cycle to report: "current" | "last_week".
  type: string;
  source?: TopConsumersSource;
  entities?: TopConsumerEntityConfig[];
  period?: TopConsumersPeriod;
  top_count?: number;
  rest_mode?: TopConsumersRestMode;
  name_strip?: string[];
  unit_mode?: TopConsumersUnitMode;
  name?: string;
  icon?: string;
  subtitle?: string;
  accent_color?: string;
  accent_opacity?: number;
  palette?: string[];
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  animation?: "auto" | "on" | "off";
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

// Shared by m3-cost-card and m3-top-consumers-card's unit_mode: "cost".
export type PriceSource = "energy_dashboard" | "input_number" | "fixed";
export type PriceUnit = "eur_per_kwh" | "ct_per_kwh" | "custom";

export interface PricingConfig {
  price_source?: PriceSource;
  price_entity?: string;
  price?: number;
  price_unit?: PriceUnit;
  // Only used when price_unit is "custom": a free-text unit label for
  // display (e.g. "€/m³", "$/gal"), and a factor the raw entity value is
  // multiplied by before pricing (e.g. 0.001 for a liter sensor priced per
  // m³) — lets any quantity/unit pairing work without hardcoding conversions
  // for every possible unit.
  price_unit_label?: string;
  price_quantity_factor?: number;
  base_fee?: number;
  currency?: string;
}

export type CostPeriod = "day" | "month" | "year";

export interface M3CostCardConfig extends PricingConfig, NotifyConfigBase {
  type: string;
  entity?: string;
  statistic_type?: "change" | "state";
  period?: CostPeriod;
  name?: string;
  icon?: string;
  subtitle?: string;
  show_projection?: boolean;
  show_comparison?: boolean;
  budget?: number;
  // notify_service / notify_mode / notify_time / notify_automation_id come
  // from NotifyConfigBase — see shared/notify-editor.
  // The card's own total comes from long-term statistics, which a Jinja
  // template can't read; the notification therefore needs an entity whose
  // *state* is the month-to-date value (a monetary one, or a consumption one
  // that gets multiplied by the configured price).
  notify_cost_entity?: string;
  /** Warn at this share of `budget` (%), so the warning arrives before the
   * budget is blown. Defaults to DEFAULT_COST_NOTIFY_PERCENT. */
  notify_budget_percent?: number;
  accent_color?: string;
  accent_opacity?: number;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  animation?: "auto" | "on" | "off";
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

export type LightWaveStyle = "wavy" | "flat";
export type LightColorTempStyle = "presets" | "slider";

export interface LightColorTempPresets {
  warm?: number;
  neutral?: number;
  cold?: number;
}

export interface LightSceneConfig {
  entity?: string;
  service?: string;
  service_data?: Record<string, unknown>;
  name?: string;
  icon?: string;
}

export interface M3LightCardConfig {
  type: string;
  entity: string;
  name?: string;
  icon?: string;
  transition?: number;
  show_members?: boolean;
  show_color_temp?: boolean;
  color_temp_style?: LightColorTempStyle;
  color_temp_presets?: LightColorTempPresets;
  color_palette?: string[];
  show_color_wheel?: boolean;
  scenes?: LightSceneConfig[];
  use_light_color?: boolean;
  accent_color?: string;
  accent_opacity?: number;
  track_color?: string;
  handle_color?: string;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  animation?: "auto" | "on" | "off";
  wave_style?: LightWaveStyle;
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

export interface BatteryEntityConfig {
  entity: string;
  name?: string;
  icon?: string;
}

export interface BatteryThresholds {
  critical?: number;
  low?: number;
  medium?: number;
}

export type BatteryNotifyMode = "daily" | "weekly" | "on_change";

export interface M3BatteryCardConfig extends NotifyConfigBase {
  type: string;
  entities?: BatteryEntityConfig[];
  auto_discover?: boolean;
  include_area?: string[];
  include_label?: string[];
  exclude_entities?: string[];
  name_strip?: string[];
  thresholds?: BatteryThresholds;
  max_visible?: number;
  show_healthy_toggle?: boolean;
  show_trend?: boolean;
  // notify_service / notify_mode / notify_time / notify_weekday /
  // notify_automation_id come from NotifyConfigBase — see shared/notify-editor.
  notify_mode?: BatteryNotifyMode;
  notify_threshold?: number;
  notify_exclude_entities?: string[];
  name?: string;
  icon?: string;
  critical_color?: string;
  low_color?: string;
  medium_color?: string;
  ok_color?: string;
  unavailable_color?: string;
  stage_tint_opacity?: number;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  animation?: "auto" | "on" | "off";
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

export type WeatherChipType =
  | "apparent_temperature"
  | "wind_speed"
  | "humidity"
  | "pressure"
  | "uv_index"
  | "visibility";

export interface M3WeatherCardConfig {
  type: string;
  entity: string;
  name?: string;
  hours?: number;
  days?: number;
  chips?: WeatherChipType[];
  show_current?: boolean;
  show_chart?: boolean;
  show_sun?: boolean;
  show_days_toggle?: boolean;
  show_hour_labels?: boolean;
  show_hourly_icons?: boolean;
  show_hourly_temperatures?: boolean;
  show_temp_axis?: boolean;
  accent_color?: string;
  accent_opacity?: number;
  precipitation_color?: string;
  gradient_color?: string;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  animation?: "auto" | "on" | "off";
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

export type PresenceSortMode = "home_first" | "name";

export interface M3PresenceCardConfig {
  type: string;
  entities?: string[];
  auto_discover?: boolean;
  include_area?: string[];
  include_label?: string[];
  exclude_entities?: string[];
  name?: string;
  icon?: string;
  show_distance?: boolean;
  show_since?: boolean;
  show_map?: boolean;
  sort?: PresenceSortMode;
  home_color?: string;
  not_home_color?: string;
  zone_color?: string;
  unknown_color?: string;
  zone_colors?: Record<string, string>;
  presence_tint_opacity?: number;
  /**
   * What a tap on a person does. Card-level, like `hold_action`: one setting
   * for every row, with the tapped person supplying the target. Unset, a tap
   * opens more-info for that person, which is what it has always done.
   */
  tap_action?: HaActionConfig;
  hold_action?: HaActionConfig;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  animation?: "auto" | "on" | "off";
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

export interface M3MediaCardConfig {
  type: string;
  entity: string;
  name?: string;
  show_source_select?: boolean;
  show_shuffle_repeat?: boolean;
  show_browser?: boolean;
  strip_track_number?: boolean;
  time_display?: "remaining" | "total";
  // Optional extra chips beside device + source. Only render when the player
  // actually reports the underlying attribute.
  meta_chips?: ("track" | "bitrate" | "year")[];
  default_tab?: "queue" | "library";
  browse_height?: number;
  use_artwork_color?: boolean;
  accent_color?: string;
  accent_opacity?: number;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  animation?: "auto" | "on" | "off";
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

export type ClimateOverviewSort = "area" | "temp_desc" | "temp_asc" | "name";
export type ClimateOverviewMode = "temperature" | "thermostat" | "thermostat_only";

export interface ClimateOverviewTempThresholds {
  cold?: number;
  cool?: number;
  comfortable?: number;
  warm?: number;
}

export interface ClimateOverviewRoomConfig {
  name: string;
  icon?: string;
  temperature_entity: string;
  humidity_entity?: string;
  /** The room's thermostat, for `tile_tap_action: thermostat` or `mode`
   *  thermostat discovery. Discovered from the room's area when unset. */
  climate_entity?: string;
  color?: string;
}

export type ClimateOverviewNotifyMode = "daily" | "weekly";

// A popup only needs to narrow (never widen) the card it's scoped from, so
// this is the same filter vocabulary rather than a separate schema — see
// LightsOverviewPopupConfig.
// "default-detail" — HA's own more-info dialog for the tapped entity, no
// card of ours involved at all.
// "default-grid" — today's original behaviour: this same card again,
// re-scoped to the tapped tile's area/entities (the fields below).
// "custom" — an arbitrary Lovelace card built from `card`.
export type ClimateOverviewPopupMode = "default-detail" | "default-grid" | "custom";

export interface ClimateOverviewPopupConfig extends EntityFilterConfig {
  mode?: ClimateOverviewPopupMode;
  title?: string;
  inherit_filters?: boolean;
  sort?: ClimateOverviewSort;
  show_header?: boolean;
  /** Only used when `mode` is "custom" — an arbitrary Lovelace card config
   * skeleton that replaces the popup entirely. Any string value inside may
   * reference `[[area_id]]`, `[[device_id]]`, `[[entity_id]]`, `[[name]]`,
   * `[[temperature_entity]]`, `[[humidity_entity]]`, resolved against the
   * tapped tile before the card is built — see shared/card-template.ts. */
  card?: Record<string, unknown>;
}

export interface M3ClimateOverviewCardConfig extends NotifyConfigBase, EntityFilterConfig {
  type: string;
  auto_discover?: boolean;
  /** Which entities auto-discovery reports on: dedicated temperature
   * sensors, thermostats (falling back to sensors where a room has no
   * thermostat), or thermostats only. Defaults to "temperature". */
  mode?: ClimateOverviewMode;
  rooms?: ClimateOverviewRoomConfig[];
  name_strip?: string[];
  name?: string;
  icon?: string;
  show_header?: boolean;
  sort?: ClimateOverviewSort;
  /**
   * Show only this many rooms, the rest behind a toggle. 0 or unset shows all.
   * The outlier chip and the comparison scale keep reading every room — a
   * summary of the first three would be a different, wronger statement.
   */
  max_visible?: number;
  /**
   * What a tap on a room does. `history` opens the sensor's own dialog, which
   * is the graph; `thermostat` opens that room's thermostat instead, which is
   * what people reach for when they tap a temperature.
   */
  tile_tap_action?: "history" | "thermostat";
  show_scale?: boolean;
  /** Room names along the comparison scale; off leaves only the dots. */
  show_scale_labels?: boolean;
  show_outlier_chip?: boolean;
  show_trend?: boolean;
  show_mold_warning?: boolean;
  // notify_service / notify_time / notify_weekday / notify_automation_id come
  // from NotifyConfigBase — see shared/notify-editor.
  notify_mode?: ClimateOverviewNotifyMode;
  temp_thresholds?: ClimateOverviewTempThresholds;
  humidity_range?: [number, number];
  scale_min?: number;
  scale_max?: number;
  cold_color?: string;
  cool_color?: string;
  comfortable_color?: string;
  warm_color?: string;
  hot_color?: string;
  humidity_warn_color?: string;
  tile_tint_opacity?: number;
  accent_color?: string;
  accent_opacity?: number;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  animation?: "auto" | "on" | "off";
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
  tap_action?: HaActionConfig;
  hold_action?: HaActionConfig;
  double_tap_action?: HaActionConfig;
  popup?: ClimateOverviewPopupConfig;
}

export interface AquariumDeviceConfig {
  entity: string;
  name?: string;
  icon?: string;
  color?: string;
}

export interface AquariumScheduleEntry {
  device: "day" | "night";
  start: string;
  end: string;
  color?: string;
}

export type AquariumCameraStyle = "none" | "thumbnail" | "banner" | "live";

export interface M3AquariumCardConfig extends NotifyConfigBase {
  type: string;
  name?: string;
  icon?: string;
  water_temperature_entity?: string;
  target_range?: [number, number];
  light_day?: AquariumDeviceConfig;
  light_night?: AquariumDeviceConfig;
  pump?: AquariumDeviceConfig;
  heater?: AquariumDeviceConfig;
  co2?: AquariumDeviceConfig;
  extra_devices?: AquariumDeviceConfig[];
  heater_power_entity?: string;
  ph_entity?: string;
  tds_entity?: string;
  power_entity?: string;
  water_level_entity?: string;
  cleaning_entity?: string;
  cleaning_interval?: number;
  cleaning_interval_entity?: string;
  cleaning_notify_service?: string[];
  cleaning_notify_time?: string;
  camera_entity?: string;
  camera_style?: AquariumCameraStyle;
  camera_refresh?: number;
  camera_live_on_tap?: boolean;
  schedule?: AquariumScheduleEntry[];
  schedule_entity?: string;
  show_schedule?: boolean;
  accent_color?: string;
  accent_opacity?: number;
  tile_tint_opacity?: number;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  animation?: "auto" | "on" | "off";
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}


export type UpdateGroup =
  | "core"
  | "os"
  | "supervisor"
  | "addon"
  | "hacs"
  | "firmware"
  | "remote"
  | "other";

/** One volume row on the NAS card. */
export interface NasDiskConfig {
  /** Mount point as Glances reports it, e.g. "/rootfs/srv/dev-disk-by-uuid-...". */
  mount: string;
  name?: string;
  icon?: string;
}

export type HostSource = "glances" | "systemmonitor";

export interface M3NasCardConfig extends NotifyConfigBase {
  type: string;
  /** Which integration supplies the metrics. Defaults per card type. */
  source?: HostSource;
  /** Pick up every Glances entity of the chosen host automatically. */
  auto_discover?: boolean;
  /** Restrict discovery to one Glances config entry when several NAS exist. */
  config_entry_id?: string;
  /** Explicit volume list; overrides discovery order and naming. */
  disks?: NasDiskConfig[];
  exclude_mounts?: string[];
  /** Mount point → display name, applied on top of discovery. */
  mount_names?: Record<string, string>;
  disk_warn?: number;
  disk_critical?: number;
  temp_warn?: number;
  temp_critical?: number;
  /** Temperature sensors to average/max over; empty = all discovered ones. */
  temperature_labels?: string[];
  show_cpu?: boolean;
  show_memory?: boolean;
  show_temperature?: boolean;
  show_network?: boolean;
  show_uptime?: boolean;
  /** Syncthing folder sensors; empty falls back to every discovered one. */
  sync_entities?: string[];
  show_sync?: boolean;
  /** Alert when a Syncthing folder errors out. Paused is never an alert. */
  notify_sync_errors?: boolean;
  notify_disk_full?: boolean;
  notify_disk_threshold?: number;
  /** Alert when Glances stops reporting, i.e. the NAS is unreachable. */
  notify_offline?: boolean;
  notify_offline_minutes?: number;
  max_visible?: number;
  name?: string;
  icon?: string;
  ok_color?: string;
  warn_color?: string;
  critical_color?: string;
  offline_color?: string;
  accent_opacity?: number;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  animation?: "auto" | "on" | "off";
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

export interface M3UpdatesCardConfig extends NotifyConfigBase {
  type: string;
  auto_discover?: boolean;
  entities?: string[];
  exclude_entities?: string[];
  include_types?: UpdateGroup[];
  /** Display order of the groups; anything omitted keeps the default order. */
  group_order?: UpdateGroup[];
  /** entity_id substring → group, overriding the platform-based mapping. */
  type_patterns?: Record<string, UpdateGroup>;
  /** Groups shown read-only — no install button. Defaults to firmware. */
  no_install_types?: UpdateGroup[];
  backup_entity?: string;
  backup_warn_days?: number;
  /** Update entities the notification ignores while the card still lists them. */
  notify_exclude_entities?: string[];
  require_confirm?: boolean;
  inline_install?: boolean;
  /**
   * How many pending updates are shown directly, most important first
   * (group_order decides what "important" means). The rest collapse behind
   * an expander, like the battery card's healthy-devices section.
   */
  max_visible?: number;
  show_uptodate?: boolean;
  show_skipped?: boolean;
  show_release_notes?: boolean;
  name?: string;
  icon?: string;
  ok_color?: string;
  update_color?: string;
  progress_color?: string;
  addon_color?: string;
  hacs_color?: string;
  firmware_color?: string;
  remote_color?: string;
  accent_opacity?: number;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  animation?: "auto" | "on" | "off";
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

export interface SwitchPairConfig {
  up_entity?: string;
  down_entity?: string;
  stop_entity?: string;
}

export interface CoverEntityConfig {
  entity?: string;
  entity_type?: "cover" | "switch_pair";
  up_entity?: string;
  down_entity?: string;
  stop_entity?: string;
  name?: string;
  icon?: string;
}

export interface M3CoverCardConfig {
  type: string;
  mode?: "single" | "group";
  /** single mode: the cover (or, with entity_type switch_pair, ignored). */
  entity?: string;
  /** group mode: one row per cover. */
  entities?: (string | CoverEntityConfig)[];
  /** "cover" (default) or "switch_pair" for up/down/stop switch relays. */
  entity_type?: "cover" | "switch_pair";
  up_entity?: string;
  down_entity?: string;
  stop_entity?: string;
  name?: string;
  icon?: string;
  device_class?: string;
  show_preview?: boolean;
  slider_style?: "plain" | "wavy";
  show_master?: boolean;
  row_tap_action?: "more-info" | "toggle";
  invert_position?: boolean;
  tilt_step?: number;
  /** Seconds a positionless cover takes end to end; drives optimistic UI. */
  travel_time?: number;
  accent_color?: string;
  accent_opacity?: number;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  animation?: "auto" | "on" | "off";
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

export interface LeakSensorConfig {
  entity: string;
  name?: string;
  icon?: string;
  area?: string;
  battery_entity?: string;
}

export interface M3LeakCardConfig extends NotifyConfigBase {
  type: string;
  auto_discover?: boolean;
  include_area?: string[];
  exclude_entities?: string[];
  sensors?: LeakSensorConfig[];
  name_strip?: string[];
  valve_entity?: string;
  siren_entity?: string;
  ack_entity?: string;
  confirm_shutoff?: boolean;
  stale_hours?: number;
  battery_warn?: number;
  battery_critical?: number;
  test_interval_days?: number;
  last_test_entity?: string;
  collapse_ok?: boolean;
  /** Show only this many sensors, the rest behind a toggle. 0 or unset shows all. */
  max_visible?: number;
  name?: string;
  icon?: string;
  accent_color?: string;
  alarm_color?: string;
  stale_color?: string;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  animation?: "auto" | "on" | "off";
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

export interface WasteEntityConfig {
  entity: string;
  name?: string;
  icon?: string;
  color?: string;
}

export interface M3WasteCardConfig extends NotifyConfigBase {
  type: string;
  mode?: "info" | "reminder";
  entities?: (string | WasteEntityConfig)[];
  /** A calendar holding one event per collection, the summary naming the bin.
   *  Waste Collection Schedule can produce this instead of, or alongside, the
   *  day-count sensors. Streams found here are merged with `entities`. */
  calendar_entity?: string;
  auto_discover?: boolean;
  name_strip?: string[];
  hero_primary?: "days" | "weekday";
  hero_icon?: "first" | "multi";
  show_timeline?: boolean;
  timeline_days?: number;
  max_rows?: number;
  reminder_offset?: number;
  reminder_time?: string;
  ack_entity?: string;
  name?: string;
  icon?: string;
  accent_color?: string;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  animation?: "auto" | "on" | "off";
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

export type ClockStyle = "shapes" | "lockscreen" | "scallop" | "tiles" | "ring";
export type ClockShape = "cookie" | "clover" | "flower" | "scallop" | "squircle";
export type ClockSecondsStyle = "bar" | "dots" | "none";
export type ClockTileColorMode = "accent_hours" | "both_accent" | "neutral";

export interface M3ClockCardConfig {
  type: string;
  style?: ClockStyle;
  /** Proportional scale for every measurement of the chosen style, 0.7–1.5. */
  size?: number;

  // ---- time and date
  /** IANA zone. Falls back to the Home Assistant instance's own zone. */
  time_zone?: string;
  time_format?: "auto" | "12" | "24";
  show_date?: boolean;
  date_format?: "auto" | "short" | "long" | "custom";
  date_custom?: string;

  // ---- seconds
  show_seconds?: boolean;
  seconds_style?: ClockSecondsStyle;
  show_seconds_tile?: boolean;
  colon_blink?: boolean;

  // ---- shapes (shapes / lockscreen / scallop)
  shape_hours?: ClockShape;
  shape_minutes?: ClockShape;
  /** Negative pulls the two digits of a pair together so they read as one
   *  number rather than as two separate tiles. */
  digit_overlap?: number;
  shape_motion?: boolean;
  shape_speed?: "slow" | "normal" | "fast";
  show_decor?: boolean;
  outline_target?: "minutes" | "hours" | "none";
  tick_style?: "dots" | "lines" | "none";
  layout?: "stacked" | "inline";

  // ---- tiles
  tile_color_mode?: ClockTileColorMode;

  // ---- ring
  ring_animation?: "reset" | "drain";

  // ---- extras
  alarm_entity?: string;
  sun_entity?: string;
  show_day_progress?: boolean;
  progress_range?: "day" | "custom";
  progress_start?: string;
  progress_end?: string;
  secondary_zones?: { label: string; time_zone: string }[];

  // ---- appearance (shared conventions)
  accent_color?: string;
  secondary_color?: string;
  digit_color?: string;
  card_background?: string;
  text_color?: string;
  secondary_text_color?: string;
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  animation?: "auto" | "on" | "off";
  tap_action?: unknown;
  card_version?: string;
}

export type M3CardConfig =
  | M3NavCardConfig
  | M3ClimateCardConfig
  | M3ClimateCardMiniConfig
  | M3ButtonCardConfig
  | M3ProgressCardConfig
  | M3EnergyCardConfig
  | M3GaugeCardConfig
  | M3EnergyFlowCardConfig
  | M3CounterCardConfig
  | M3PowerListCardConfig
  | M3PowerSummaryCardConfig
  | M3TopConsumersCardConfig
  | M3CostCardConfig
  | M3LightCardConfig
  | M3BatteryCardConfig
  | M3WeatherCardConfig
  | M3PresenceCardConfig
  | M3MediaCardConfig
  | M3ClimateOverviewCardConfig
  | M3AquariumCardConfig
  | M3UpdatesCardConfig
  | M3NasCardConfig
  | M3SupplyCardConfig
  | M3TodoCardConfig
  | M3TimeCardConfig
  | M3OccupancyCardConfig
  | M3CoverCardConfig
  | M3LeakCardConfig
  | M3WasteCardConfig
  | M3ClockCardConfig
  | M3StatusCardConfig
  | M3HeadingCardConfig
  | M3RoomCardConfig;

export interface SupplyItemConfig {
  /** A `counter.*` or `input_number.*` helper holding the remaining count. */
  entity: string;
  name?: string;
  icon?: string;
  color?: string;
  /** Units in one full pack. Defaults to the helper's own maximum, then to
   * DEFAULT_SUPPLY_PACK_SIZE. */
  pack_size?: number;
  /** Plural noun shown under the hero value, e.g. "Pods". */
  unit?: string;
  low_threshold?: number;
  critical_threshold?: number;
  /** Text added to the todo list when this item runs critical. */
  shopping_item?: string;
  /** Overrides the history-derived consumption rate for this item. */
  usage_per_week?: number;
}

export type SupplyLayout = "hero_and_list" | "list_only" | "hero_only";
export type SupplyRefillMode = "set" | "add";
export type SupplyListTapAction = "hero" | "more-info";

/** Which state an item must reach before it is worth notifying about. */
export type SupplyNotifyLevel = "empty" | "critical" | "low";

export interface M3SupplyCardConfig extends NotifyConfigBase {
  type: string;
  items?: SupplyItemConfig[];
  // notify_service / notify_mode / notify_time / notify_weekday /
  // notify_automation_id come from NotifyConfigBase — see shared/notify-editor.
  notify_level?: SupplyNotifyLevel;
  /** Which supplies the notification covers. Empty or unset means all of them. */
  notify_items?: string[];
  /** Index into `items`, or an entity id. Unset picks the item with the
   * shortest remaining range. */
  hero?: number | string;
  layout?: SupplyLayout;
  refill_mode?: SupplyRefillMode;
  list_tap_action?: SupplyListTapAction;
  /** Days of history to derive the consumption rate from. */
  rate_window?: number;
  usage_per_week?: number;
  todo_entity?: string;
  auto_add_to_list?: boolean;
  name?: string;
  icon?: string;
  ok_color?: string;
  low_color?: string;
  critical_color?: string;
  unavailable_color?: string;
  accent_opacity?: number;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  animation?: "auto" | "on" | "off";
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

export type TodoAddPosition = "top" | "bottom";
export type TodoQuickAddMode = "none" | "fixed" | "recent" | "supplies";

export interface M3TodoCardConfig {
  type: string;
  entity: string;
  name?: string;
  icon?: string;
  add_position?: TodoAddPosition;
  prevent_duplicates?: boolean;
  quick_add_mode?: TodoQuickAddMode;
  quick_add?: string[];
  max_quick_add?: number;
  show_completed?: boolean;
  show_clear_completed?: boolean;
  group_by_category?: boolean;
  reorderable?: boolean;
  accent_color?: string;
  accent_opacity?: number;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  animation?: "auto" | "on" | "off";
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

export type TimeCardStyle = "stepper" | "wheel" | "compact";
export type TimeApplyMode = "button" | "instant";
/** Whether the apply button is always on screen or only once something changed. */
export type TimeApplyVisibility = "always" | "when_changed";

export interface M3TimeCardConfig {
  type: string;
  entity: string;
  name?: string;
  icon?: string;
  subtitle?: string;
  style?: TimeCardStyle;
  minute_step?: number;
  apply_mode?: TimeApplyMode;
  apply_visibility?: TimeApplyVisibility;
  show_revert?: boolean;
  presets?: string[];
  show_date?: boolean;
  keep_seconds?: boolean;
  accent_color?: string;
  accent_opacity?: number;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  animation?: "auto" | "on" | "off";
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

export type OccupancySortMode = "occupied_first" | "name" | "last_active";

export interface OccupancySensorConfig {
  entity: string;
  name?: string;
  icon?: string;
  illuminance_entity?: string;
  battery_entity?: string;
  signal_entity?: string;
  timeout_entity?: string;
}

export interface M3OccupancyCardConfig extends NotifyConfigBase {
  type: string;
  auto_discover?: boolean;
  include_area?: string[];
  exclude_entities?: string[];
  sensors?: OccupancySensorConfig[];
  name_strip?: string[];
  show_timeline?: boolean;
  timeline_hours?: number;
  timeline_segments?: number;
  sort?: OccupancySortMode;
  max_visible?: number;
  show_timeout?: boolean;
  battery_warn?: number;
  battery_critical?: number;
  lqi_warn?: number;
  name?: string;
  icon?: string;
  accent_color?: string;
  accent_opacity?: number;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  animation?: "auto" | "on" | "off";
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

/** Which built-in rule set an item starts from before its own `states` apply. */
export type StatusPreset =
  | "yes_no"
  | "on_off"
  | "ok_problem"
  | "open_closed"
  | "traffic";

/**
 * One mapping rule: a condition plus what it changes.
 *
 * The condition forms are deliberately not combinable — a rule matches on
 * exactly one of value/regex/above/below. Allowing `above` *and* `value` on the
 * same rule reads as an AND to some people and an OR to others, and a mapping
 * table nobody can predict is worse than one extra rule.
 */
export interface StatusRule {
  /** Exact state match, compared case-insensitively. */
  value?: string;
  /** Matched against the raw state. An invalid pattern is ignored, not thrown. */
  regex?: string;
  /** Numeric state strictly greater than this. */
  above?: number;
  /** Numeric state strictly less than this. */
  below?: number;
  label?: string;
  icon?: string;
  color?: string;
}

export interface M3StatusItemConfig {
  entity?: string;
  name?: string;
  icon?: string;
  /** Show this attribute instead of the state. */
  attribute?: string;
  /** Overrides the entity's own unit_of_measurement. */
  unit?: string;
  color?: string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  /** Free text, or an entity id whose state is shown, under the hero value. */
  secondary?: string;
  preset?: StatusPreset;
  states?: StatusRule[];
  tap_action?: HaActionConfig;
  /** Compare against the value `trend_hours` ago and show a chip. */
  trend?: boolean;
  trend_hours?: number;
  /** For values where falling is the good direction (consumption, cost). */
  trend_inverted?: boolean;
}

export interface M3StatusCardConfig {
  type: string;
  /** Shown above the grid; ignored by the hero layout, which has its own label. */
  title?: string;
  items?: M3StatusItemConfig[];
  layout?: "auto" | "hero" | "grid" | "row";
  columns?: number;
  hero_style?: "inline" | "badge";
  /** A pixel size, or "auto" to pick one from the value's own length. */
  value_size?: number | "auto";
  tap_action?: HaActionConfig;
  accent_color?: string;
  accent_opacity?: number;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  glass_background?: boolean;
  animation?: "auto" | "on" | "off";
  unavailable_style?: "dimmed" | "normal" | "hidden";
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

export interface M3HeadingActionConfig {
  name?: string;
  icon?: string;
  tap_action?: HaActionConfig;
}

export interface M3HeadingCardConfig {
  type: string;
  style?: "simple" | "status" | "divider" | "collapsible";
  /** Required by every style but `divider`, which uses `label`. */
  title?: string;
  /** Divider only: the small caps text sitting between the two rules. */
  label?: string;
  icon?: string;
  show_icon?: boolean;
  color?: string;
  title_size?: number;
  /** Status only: fixed text, or an entity id whose state is shown. */
  badge?: string;
  /** Status only: the badge counts how many of these are on. */
  count_entities?: string[];
  action?: M3HeadingActionConfig;
  tap_action?: HaActionConfig;
  /** Collapsible only. */
  default_collapsed?: boolean;
  /** Collapsible only: an input_boolean holding the state, instead of localStorage. */
  collapse_state_entity?: string;
  animation?: "auto" | "on" | "off";
  card_version?: string;
}

export interface RoomCategoryConfig {
  /** The entity domain this overrides, e.g. "light". */
  domain: string;
  name?: string;
  icon?: string;
  color?: string;
  hidden?: boolean;
  /**
   * What the line under the name says. `auto` counts when the category holds
   * several devices and reports the one device's own state when it holds one.
   */
  badge?: "auto" | "count" | "state" | "none";
  tap_action?: HaActionConfig;
}

/**
 * How a room card decides what to show.
 *
 * `auto` discovers the area's devices and draws a tile per category, which is
 * what the card has always done. `manual` draws nothing of its own and leaves
 * the body to the cards listed in `cards` — a room card holding the sockets of
 * that room, say, rather than a summary of them.
 */
export type RoomCardMode = "auto" | "manual";

export interface M3RoomCardConfig {
  type: string;
  /** HA area id. Everything else is discovered from it. */
  area: string;
  mode?: RoomCardMode;
  /**
   * Lovelace cards drawn inside the room card's folding body. Shown below the
   * discovered tiles in `auto`, and on their own in `manual`.
   */
  cards?: Record<string, unknown>[];
  /** How many of those cards sit side by side. */
  cards_columns?: number;
  name?: string;
  icon?: string;
  /**
   * What a tap on the card's header does. Unset, the header toggles the fold
   * when `collapsible` is on and does nothing otherwise — the behaviour the
   * card has always had. Set, it runs the action instead, and the fold chevron
   * goes away because the header no longer folds anything.
   */
  tap_action?: HaActionConfig;
  /** Opened on hold; falls back to more-info of the category's first entity. */
  detail_path?: string;
  /** Domains beyond the built-in nine, e.g. ["water_heater"]. */
  extra_domains?: string[];
  /** Domains in the order they should appear; the rest follow in default order. */
  category_order?: string[];
  hidden_categories?: string[];
  categories?: RoomCategoryConfig[];
  /**
   * Strip the room's name out of a single device's name on its tile. Off by
   * default: it assumes a naming convention, and a card should not guess at
   * how someone names their devices. `categories[].name` is the answer that
   * always works.
   */
  strip_area_name?: boolean;
  /** Individual entities to leave out, whatever category they fall into. */
  excluded_entities?: string[];
  /** What a tap on a category holding several devices does. */
  category_tap?: "list" | "toggle";
  show_sensors?: boolean;
  temperature_entity?: string;
  humidity_entity?: string;
  power_entity?: string;
  /**
   * Several power sensors added together, for a room whose consumption is the
   * sum of its plugs rather than one meter. Wins over `power_entity` and over
   * discovery, both of which can only name one — and picking one gets it loudly
   * wrong in an area that also holds a mains channel.
   */
  power_entities?: string[];
  /** Watts below which the power chip is not worth the space. */
  power_threshold?: number;
  extra_sensors?: string[];
  /** Chip for open windows and doors in the area. */
  show_windows?: boolean;
  /** Leave unset to discover them from the area. */
  window_entities?: string[];
  /**
   * Contacts counted apart from the windows — a door, or something that is not
   * a way in at all, like a blind's position contact. Home Assistant labels
   * most contact sensors `door` whatever they are on, so which is which cannot
   * be discovered; it has to be said.
   */
  door_entities?: string[];
  /** Fold the card down to its header, like the heading card's variant. */
  collapsible?: boolean;
  default_collapsed?: boolean;
  /**
   * Scrolls the card into view after it is unfolded.
   *
   * A collapsed card near the bottom of a view opens downwards, off the screen
   * — so the thing you just asked to see is the thing you cannot see. Only ever
   * scrolls when part of the card is actually out of view, and by the least it
   * can.
   */
  scroll_on_expand?: boolean;
  scroll_duration?: number;
  collapse_memory?: "device" | "session";
  /** An `input_boolean` holding the folded state, instead of localStorage. */
  collapse_state_entity?: string;
  /** Leave unset to discover it from the area. */
  presence_entity?: string;
  presence_style?: "tint" | "dot_only" | "none";
  accent_color?: string;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  glass_background?: boolean;
  animation?: "auto" | "on" | "off";
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

export interface LovelaceCardEditor<
  T extends M3CardConfig = M3CardConfig,
> extends HTMLElement {
  hass?: HomeAssistant;
  setConfig(config: T): void;
}

export interface LovelaceGridOptions {
  columns?: number | "full";
  rows?: number | "auto";
  min_columns?: number;
  min_rows?: number;
  max_columns?: number;
  max_rows?: number;
}

export interface LovelaceCard<T extends M3CardConfig = M3CardConfig>
  extends HTMLElement {
  hass?: HomeAssistant;
  setConfig(config: T): void;
  getCardSize?: () => number | Promise<number>;
  getGridOptions?: () => LovelaceGridOptions;
}

// ---- m3-humidifier-card ---------------------------------------------------

/**
 * One entry in the mode row. `mode` is the value handed to
 * `humidifier.set_mode` (or written to a `select`), everything else is
 * presentation. A card with no `modes` list reads `available_modes` off the
 * entity, so the common case needs no configuration at all.
 */
export interface HumidifierModeConfig {
  mode: string;
  name?: string;
  icon?: string;
  color?: string;
  hidden?: boolean;
}

/**
 * One step of the fan row. Which field is used depends on what the fan is:
 * `preset` for a fan with `preset_modes`, `percentage` for a percentage fan,
 * `option` when the speed lives on a `select` instead of a `fan`. Setting more
 * than one is allowed — the card picks the field its entity understands.
 */
export interface HumidifierStepConfig {
  name?: string;
  icon?: string;
  preset?: string;
  percentage?: number;
  option?: string;
}

/** A free chip: a switch to toggle, a select/number to step, or a read-only sensor. */
export interface HumidifierChipConfig {
  entity: string;
  name?: string;
  icon?: string;
  color?: string;
  /** Shown instead of the state, e.g. "Filter ok". */
  label?: string;
}

/** The blocks the card can draw, in the order they should appear. */
export type HumidifierBlock = "slider" | "modes" | "fan" | "chips";

export interface M3HumidifierCardConfig {
  type: string;
  /**
   * The entity the card turns on and off. A `humidifier` is the normal case and
   * supplies everything else by itself. It may equally be a `switch` or `fan`,
   * because plenty of dehumidifiers are not exposed as a humidifier at all —
   * then `current_entity` and `target_entity` fill in what is missing.
   */
  entity: string;
  name?: string;
  icon?: string;
  /** Overrides the device_class, which decides wording and the default icon. */
  device_kind?: "humidifier" | "dehumidifier";

  /** Where the readings come from when `entity` does not carry them. */
  current_entity?: string;
  target_entity?: string;
  action_entity?: string;

  humidity_step?: number;
  min_humidity?: number;
  max_humidity?: number;

  /** Modes from a `select` instead of the humidifier's own `available_modes`. */
  mode_entity?: string;
  modes?: HumidifierModeConfig[];
  mode_style?: "icon_label" | "icon_only" | "dropdown";

  /** A `fan` (presets or percentage) or a `select` holding the speed. */
  fan_entity?: string;
  fan_steps?: HumidifierStepConfig[];

  tank_entity?: string;
  tank_warn?: number;
  tank_full?: number;
  tank_style?: "chip" | "bar";

  /** Toggled or stepped from the card. */
  controls?: HumidifierChipConfig[];
  /** Read-only. */
  sensors?: HumidifierChipConfig[];

  /**
   * Which blocks to draw and in what order. Leaving a block out hides it, so
   * this is both the ordering and the visibility control — one mechanism rather
   * than an array plus a set of show_* flags that can disagree with it.
   */
  layout?: HumidifierBlock[];

  accent_color?: string;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  glass_background?: boolean;
  animation?: "auto" | "on" | "off";
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

// ---- m3-calendar-card -----------------------------------------------------

export interface CalendarSourceConfig {
  entity: string;
  name?: string;
  color?: string;
}

export type CalendarView = "agenda" | "month";

export interface M3CalendarCardConfig {
  type: string;
  /**
   * Calendars to merge. A bare entity id is accepted alongside the full object,
   * because `entities: [calendar.a, calendar.b]` is what people write first and
   * there is no reason to reject it.
   */
  entities: Array<string | CalendarSourceConfig>;
  name?: string;
  icon?: string;

  view?: CalendarView;
  show_view_switch?: boolean;

  /** Agenda window, 1–30 days. */
  days_ahead?: number;
  /** 0 shows everything in the window. */
  max_events?: number;
  /** Hide today's finished events instead of dimming them. */
  hide_past_today?: boolean;
  /** Month grid: draw the days either side of the month. */
  show_adjacent_days?: boolean;
  /** Header chip with the next event and how far off it is. */
  show_next_chip?: boolean;

  tap_action?: "detail" | "more-info" | "navigate" | "none";
  /** Where `navigate` goes; also the target of the dialog's calendar button. */
  navigation_path?: string;

  accent_color?: string;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  glass_background?: boolean;
  animation?: "auto" | "on" | "off";
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

// ---- m3-nav-card ----------------------------------------------------------

/**
 * How the bar is drawn. `header`/`footer` dock to the top/bottom of the view,
 * `segmented` is an inline pill group that sits in the card flow like any other
 * card, `floating` detaches into a rounded bar over the content, and `sheet`
 * is `floating` plus a drawer that pulls up over it.
 */
export type NavVariant = "header" | "footer" | "segmented" | "floating" | "sheet";

/** Which edge a docked variant attaches to. Ignored by `segmented`. */
export type NavPosition = "top" | "bottom";

/**
 * `active_only` is the Google-Photos pattern — every entry an icon, the current
 * one an icon with its label — and is why this is not a boolean.
 */
export type NavLabelVisibility =
  | "always"
  | "active_only"
  | "inactive_only"
  | "never";

/**
 * Where an entry's text sits relative to its icon. The horizontal placements
 * also move the active pill: it wraps icon and text together rather than
 * sitting behind the icon alone, which is what a bar with side-by-side labels
 * looks like everywhere it is used.
 */
export type NavLabelPosition = "below" | "above" | "right" | "left";

export type NavBadgeStyle = "dot" | "count" | "text";

export type NavContainerStyle = "glass" | "solid" | "transparent";

export type NavSubmenuTrigger = "tap" | "hold";

export type NavSheetDefault = "collapsed" | "expanded" | "remember";

/**
 * A badge on one entry. The three sources are read in the order template,
 * entity, count_entities and the first one set wins. Whichever it is, a value
 * of 0 / "off" / "" / unavailable hides the badge rather than drawing an empty
 * or zero one — a nav bar covered in grey zeroes says nothing.
 */
export interface NavBadgeConfig {
  /** Jinja2, rendered live over the websocket. */
  template?: string;
  /** The entity's state is the badge. */
  entity?: string;
  /** Counts how many of these are `on`. */
  count_entities?: string[];
  color?: string;
  /** Jinja2 boolean; the badge is drawn only while this renders truthy. */
  show_if?: string;
}

/** One row of a popup submenu. */
export interface NavSubmenuEntry {
  name?: string;
  icon?: string;
  /** Shorthand for `tap_action: { action: navigate, navigation_path: … }`. */
  path?: string;
  tap_action?: HaActionConfig;
}

export interface NavItemConfig {
  /** Accepts Jinja2. */
  name?: string;
  /** Accepts Jinja2. */
  icon?: string;
  /** Where a tap goes, and what the active-state URL match compares against. */
  path?: string;
  /** Regex overriding the automatic active match when the path shape is unusual. */
  match?: string;
  /** Accepts Jinja2. The active state takes this colour. */
  color?: string;
  badge?: NavBadgeConfig;
  badge_style?: NavBadgeStyle;
  /** Overrides the per-variant default corner the badge sits in. */
  badge_position?: "top_right" | "top_left" | "inline";
  /** Jinja2 boolean: the entry is left out entirely while this is truthy. */
  hidden?: string;
  /** Jinja2 boolean: the entry stays visible but stops responding to taps. */
  disabled?: string;
  submenu?: NavSubmenuEntry[];
  tap_action?: HaActionConfig;
  hold_action?: HaActionConfig;
  double_tap_action?: HaActionConfig;
}

/**
 * A layout override for one width class. Anything left unset falls back to the
 * card's own top-level value, so configuring neither block keeps the card
 * behaving as one layout at every width.
 */
export interface NavLayoutConfig {
  style?: NavVariant;
  position?: NavPosition;
  /** Width cap for this width class, overriding the card's own. See `max_width`. */
  max_width?: number | string;
  /** Coarse switch; `label_visibility` is the finer one and wins when both are set. */
  show_labels?: boolean;
  /** Draws nothing at this width class. */
  hidden?: boolean;
  /** Only read from the `desktop` block. Width in px, below which `mobile` applies. */
  breakpoint?: number;
}

/**
 * How the current entry is marked. `tint` is a wash of its colour, which sits
 * quietly in a busy dashboard; `solid` fills the pill with the colour outright
 * and puts dark ink on it, which is what Material's own navigation does and
 * what the reference designs show.
 */
export type NavActiveStyle = "tint" | "solid";

export type NavMarkerMotion = "none" | "slide";

/**
 * `fade` cross-fades the two pages. `up` is Material's fade-through: the old
 * page only fades out, the new one fades in while gliding up a little, which
 * is what makes a change between two similar-looking pages legible at all.
 */
export type NavPageTransition = "none" | "fade" | "up";

/** A detached round button beside the bar — a search or an add, typically. */
/**
 * One entry of the action button's speed dial: a labelled pill that rises out
 * of the button when it is tapped.
 */
export interface NavActionMenuEntry {
  name?: string;
  icon?: string;
  /** Overrides the button's colour for this entry alone. */
  color?: string;
  path?: string;
  tap_action?: HaActionConfig;
}

export interface NavActionButton {
  icon?: string;
  color?: string;
  /** Shown in place of `icon` while the menu is open. Defaults to a cross. */
  close_icon?: string;
  tap_action?: HaActionConfig;
  /**
   * Entries of the speed dial. With entries the button opens the menu and
   * `tap_action` is ignored; without them it just runs `tap_action`.
   */
  menu?: NavActionMenuEntry[];
}

export interface NavSheetAction {
  icon?: string;
  tap_action?: HaActionConfig;
}

/**
 * One shortcut tile in the drawer.
 *
 * Deliberately the same shape as a submenu row plus a colour: the entries
 * people want in a drawer are the ones they already put behind a "more" entry,
 * and having to retype them in a different shape to move them there would be
 * the card's problem, not theirs.
 */
export interface NavSheetItem {
  name?: string;
  icon?: string;
  /** Shorthand for `tap_action: { action: navigate, navigation_path: … }`. */
  path?: string;
  color?: string;
  /**
   * The second line in `list` style: free text, an entity id whose state is
   * shown, or a template. Ignored by the grid, which has no room for it.
   */
  secondary?: string;
  tap_action?: HaActionConfig;
}

/**
 * How the drawer draws its shortcuts. `grid` is a wall of icon tiles — most
 * destinations in the least space. `list` gives each one a full-width row with
 * an icon, a name, a second line and a chevron, which is worth the space when
 * the second line actually says something.
 */
export type NavSheetItemStyle = "grid" | "list";

export interface M3NavCardConfig {
  type: string;
  style?: NavVariant;
  position?: NavPosition;
  items?: NavItemConfig[];

  // ---- per-width layouts
  desktop?: NavLayoutConfig;
  mobile?: NavLayoutConfig;
  /** Fallback for `desktop.breakpoint`. */
  breakpoint?: number;

  // ---- sheet (style: sheet only)
  /** Shortcut tiles in the drawer, drawn as a grid above the cards. */
  sheet_items?: NavSheetItem[];
  /** Tiles per row in `grid` style. Unset fits as many as the width allows. */
  sheet_columns?: number;
  sheet_item_style?: NavSheetItemStyle;
  /** Any Lovelace cards, rendered in the drawer below the shortcuts. */
  sheet_cards?: Record<string, unknown>[];
  sheet_title?: string;
  sheet_action?: NavSheetAction;
  /** A CSS length, or a number read as vh. */
  sheet_max_height?: string | number;
  sheet_default?: NavSheetDefault;
  /** An `input_boolean` holding the open state, instead of localStorage. */
  sheet_state_entity?: string;
  /** Fractions between 0 and 1; [0, 1] by default, [0, 0.5, 1] for a half stop. */
  snap_points?: number[];
  collapse_on_navigate?: boolean;

  // ---- behaviour
  submenu_trigger?: NavSubmenuTrigger;
  haptics?: boolean;
  auto_hide_on_scroll?: boolean;
  /**
   * Reserved. Home Assistant exposes no way for a card to warm another view,
   * so this is parsed and stored but does nothing — see the README.
   */
  preload_views?: boolean;
  /** Jinja2 boolean: the whole card draws nothing while this is truthy. */
  hidden?: string;

  // ---- appearance
  label_visibility?: NavLabelVisibility;
  /** Where the text sits relative to the icon. Default `below`. */
  label_position?: NavLabelPosition;
  /**
   * The same three choices for the icons, independently of the labels. The two
   * axes are what separate the reference designs from each other: labels always
   * with the icon only on the current entry is one bar, icons always with the
   * label only on the current entry is a different one.
   */
  icon_visibility?: NavLabelVisibility;
  active_style?: NavActiveStyle;
  /** A faint surface under every entry, not only the current one. */
  item_background?: boolean;
  /** A round button set beside the bar, outside its surface. */
  action_button?: NavActionButton;
  /**
   * Draw the icons at all. Off gives a bar of pure labels, which is what a
   * segmented control usually is — and the one shape `label_visibility` cannot
   * produce on its own.
   */
  show_icons?: boolean;
  /**
   * How wide the bar is allowed to get, centred in the space it docks to.
   * A number is px, a string is any CSS length, and `"fit"` makes it exactly
   * as wide as its entries need. Unset spans the whole width — which is right
   * for a phone and usually far too much for a desktop.
   */
  max_width?: number | string;
  /** Proportional scale for every measurement of the chosen variant, 0.7–1.5. */
  size?: number;
  /** Icon size in px, when only the glyphs should grow and not the whole bar. */
  icon_size?: number;
  /** Label size in px, when only the text should change and not the whole bar. */
  label_size?: number;
  /**
   * Scales the marker around the active entry — the pill — without touching
   * anything else. 1 is the Material size; `size` scales the whole bar instead.
   */
  pill_size?: number;
  /**
   * How the marker gets from one entry to the next. `none` simply appears on
   * the new entry; `slide` moves one shape across the bar.
   */
  marker_motion?: NavMarkerMotion;
  /**
   * Whether navigating from this card cross-fades the whole page. Uses the
   * browser's view-transition support and falls back to a plain navigation.
   */
  page_transition?: NavPageTransition;
  /** How long the page cross-fade runs, in ms. */
  page_transition_ms?: number;
  /**
   * Distance in px between the bar and the edge of the screen it docks to.
   * Added on top of the device's own safe area, never instead of it — the
   * gesture bar has to be cleared whatever this says.
   */
  edge_distance?: number;
  container_style?: NavContainerStyle;
  container_opacity?: number;
  blur?: number;
  /** Free CSS, applied to the bar. Advanced; the documented escape hatch. */
  styles?: Record<string, string>;

  // ---- appearance (shared conventions)
  name?: string;
  icon?: string;
  accent_color?: string;
  accent_opacity?: number;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  glass_background?: boolean;
  animation?: "auto" | "on" | "off";
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

// ---- Lights Overview, Chip Buttons, Group Card ----------------------------
// Config shapes from UHaFnir/m3-cards (MIT), for the three cards adopted
// from that fork.

/** An arbitrary Lovelace card config — the group's own cards, but also any
 * other custom or built-in card a user nests inside it. */
export interface LovelaceCardConfig {
  type: string;
  [key: string]: unknown;
}

export interface ChipButtonConfig {
  entity?: string;
  name?: string;
  icon?: string;
  /** Active-state color (theme token, hex, or any CSS color). */
  color?: string;
  inactive_color?: string;
  show_state?: boolean;
  /** Always render as "active", regardless of the entity's own state. */
  static_color?: boolean;
  /** Pull the color from the entity's own HA state color instead of `color`/`inactive_color`. */
  use_entity_color?: boolean;
  /** false = read-only chip (no tap/hold handlers, not a button role). */
  interactive?: boolean;
  tap_action?: HaActionConfig;
  hold_action?: HaActionConfig;
  double_tap_action?: HaActionConfig;
}

export interface ChipButtonsRowConfig {
  buttons: ChipButtonConfig[];
  /** Wrap to a new line instead of scrolling the row sideways. */
  wrap?: boolean;
  justify?: "start" | "center" | "end" | "space-between";
  /** Chips grow to equally fill the row's width instead of sizing to content. */
  stretch?: boolean;
}

export interface M3ChipButtonsCardConfig extends ChipButtonsRowConfig {
  type: string;
  glass_background?: boolean;
  animation?: "auto" | "on" | "off";
  radius?: number;
  corners?: CornerRadiusConfig;
  card_background?: string;
  card_version?: string;
}

export type LightsOverviewView = "rooms" | "entities";
export type LightsOverviewSort = "name" | "area" | "on_first";

export interface LightsOverviewManualRoomConfig {
  name: string;
  icon?: string;
  entities?: string[];
  /** Defaults to `entities` — set only when a subset of the shown lights
   * should actually be switched by a tap. */
  toggle_entities?: string[];
  exclude_toggle_entities?: string[];
}

// A popup only needs to narrow (never widen) the card it's scoped from, so
// this is the same filter vocabulary rather than a separate schema — see
// ClimateOverviewPopupConfig.
// "default-detail" — HA's own more-info dialog for the tapped tile's first
// entity, no card of ours involved at all.
// "default-grid" — today's original behaviour: this same card again,
// re-scoped to the tapped tile's area/entities (the fields below).
// "custom" — an arbitrary Lovelace card built from `card`.
export type LightsOverviewPopupMode = "default-detail" | "default-grid" | "custom";

export interface LightsOverviewPopupConfig extends EntityFilterConfig {
  mode?: LightsOverviewPopupMode;
  title?: string;
  inherit_filters?: boolean;
  view?: LightsOverviewView;
  sort?: LightsOverviewSort;
  show_area?: boolean;
  show_header?: boolean;
  group_handling?: LightGroupHandling;
  toggle_group_handling?: LightGroupHandling;
  /** Only used when `mode` is "custom" — an arbitrary Lovelace card config
   * skeleton that replaces the popup entirely. Any string value inside may
   * reference `[[area_id]]`, `[[entity_id]]`, `[[name]]`, resolved against
   * the tapped tile before the card is built — see shared/card-template.ts. */
  card?: Record<string, unknown>;
}

export interface M3LightsOverviewCardConfig extends EntityFilterConfig {
  type: string;
  auto_discover?: boolean;
  /** Domains auto-discovery sweeps, default `["light"]`. Add `switch` to pick
   *  up lamps on smart plugs, then narrow with the include/exclude filters. */
  include_domains?: string[];
  rooms?: LightsOverviewManualRoomConfig[];
  view?: LightsOverviewView;
  sort?: LightsOverviewSort;
  name?: string;
  icon?: string;
  show_header?: boolean;
  show_count?: boolean;
  show_area?: boolean;
  hide_empty_rooms?: boolean;
  group_handling?: LightGroupHandling;
  /** What a tap actually switches — defaults to the display filter above.
   * exclude_toggle_entities is a shorthand folded into this at read time. */
  toggle_filter?: EntityFilterConfig;
  exclude_toggle_entities?: string[];
  toggle_inherit_filters?: boolean;
  toggle_group_handling?: LightGroupHandling;
  tap_action?: HaActionConfig;
  hold_action?: HaActionConfig;
  double_tap_action?: HaActionConfig;
  popup?: LightsOverviewPopupConfig;
  on_color?: string;
  off_color?: string;
  accent_color?: string;
  accent_opacity?: number;
  tile_tint_opacity?: number;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  animation?: "auto" | "on" | "off";
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

export interface M3GroupCardConfig {
  type: string;
  cards: LovelaceCardConfig[];
  gap?: number;
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_background?: string;
  card_version?: string;
}

// ---- Search Card ------------------------------------------------------------

export interface M3SearchCardConfig {
  type: string;
  /** The resting text in the bar. Defaults to a localized string that follows
   *  `mode` — "Search Home Assistant" or "Run a command". */
  placeholder?: string;
  /** Alias for `placeholder`, for consistency with the cards that call their
   *  single piece of text a `label`. `placeholder` wins if both are set. */
  label?: string;
  icon?: string;
  /** Which of Home Assistant's two quick bars a tap opens. `command` needs an
   *  admin account; see shared/quick-bar.ts for what happens without one. */
  mode?: QuickBarMode;
  show_assist?: boolean;
  assist_icon?: string;
  /** Replaces the built-in "open the search dialog" behaviour entirely, and
   *  runs through the same handler every other card's tap_action does. */
  tap_action?: HaActionConfig;
  accent_color?: string;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  animation?: "auto" | "on" | "off";
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}
