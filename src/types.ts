import type { NotifyConfigBase } from "./shared/notify-editor";
import type { EntityFilterConfig } from "./shared/entity-filter";
import type { LightGroupHandling } from "./shared/ha-registry";
import type { QuickBarMode } from "./shared/quick-bar";
import type { CollapseMemory } from "./shared/collapse-state";
import type { AlarmMode, AlarmModeConfig } from "./shared/alarm";

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
    /**
     * The profile's date format: "language" (follow the language), "system"
     * (the browser's own), or an explicit "DMY", "MDY" or "YMD".
     */
    date_format?: string;
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
    id?: string;
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

/** Visual language of the full climate card.
 *
 *  - `tiles` (default) — the original layout: a row of mode pills above a
 *    sensor row and a −/target/+ stepper.
 *  - `expressive` — a Material 3 Expressive redraw: a dominant, heavy
 *    current-temperature figure, a single connected setpoint control (round
 *    on the outside, tight on the inside — one segmented row rather than two
 *    circles either side of a floating pill), a morphing mode/preset control
 *    row, and a heat/cool equipment frame. The always-visible mode row
 *    collapses into a single mode button backed by the shared dropdown menu.
 */
export type ClimateCardStyle = "tiles" | "expressive";

export interface M3ClimateCardConfig extends DetailModeConfig {
  type: string;
  entity: string;
  name?: string;
  icon?: string;
  /** @default "tiles" */
  style?: ClimateCardStyle;
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
  /** Style `expressive` only: show the text labels on the mode / preset
   *  buttons in the control row. `false` leaves both as icon-only circles. */
  show_control_labels?: boolean;
  /** Style `expressive` only: the heat/cool frame drawn while the equipment
   *  runs (or, dimmed, while heat/cool is selected but idle). @default true */
  show_action_glow?: boolean;
  /** Show the mode line under the card name in the header. @default true */
  show_header_status?: boolean;
  height?: number;
  radius?: number;
  corners?: CornerRadiusConfig;
  animation?: "auto" | "on" | "off";
  /** @deprecated use `animation` — kept for old-config migration only. */
  animations?: boolean;
  unavailable_style?: "dimmed" | "normal" | "hidden";
  card_version?: string;
}

export interface M3ClimateCardMiniConfig extends DetailModeConfig {
  type: string;
  entity: string;
  name?: string;
  icon?: string;
  /** A humidity reading for the status line. Most thermostats report none —
   * point this at the room's own sensor. Where the thermostat does carry
   * `current_humidity`, `show_humidity: true` is enough on its own. */
  humidity_sensor?: string;
  /** Show the humidity in the status line. Implied by `humidity_sensor`;
   * set it on its own to use the thermostat's `current_humidity`. */
  show_humidity?: boolean;
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
    // Opens Home Assistant's own sidebar — the drawer on a phone, where the
    // header that carries its button may be hidden behind a navbar.
    | "sidebar"
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

export interface M3ButtonCardConfig extends DetailModeConfig {
  type: string;
  entity?: string;
  name?: string;
  /** Let a long name take two lines instead of being cut off after one (#40). */
  name_wrap?: boolean;
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
  /** Chip buttons embedded in the card — see shared/chip-buttons.ts. Right-aligned
   * next to the content at normal card height; move to a bottom bar (aligned per
   * `chip_buttons_justify`) once the card is resized taller. */
  chip_buttons?: ChipButtonConfig[];
  chip_buttons_justify?: "start" | "center" | "end";
  /** How a chip row that is wider than the card behaves: `wrap` (default) lets
   * it break onto a second line, `scroll` keeps it on one line and scrolls it
   * horizontally, with edge fades marking what is still hidden. */
  chip_buttons_layout?: "wrap" | "scroll";
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
  wave_style?: WaveStyle;
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

export interface M3EnergyCardConfig extends NotifyConfigBase, DetailModeConfig {
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
  /** Header line under the name. Default "Today", or "Now" for power sensors. */
  subtitle?: string;
  /** Node names; default Solar, Grid, Home, Battery. */
  pv_name?: string;
  grid_name?: string;
  home_name?: string;
  battery_name?: string;
  /**
   * Unit under the nodes. W, kW, Wh, kWh or MWh also scale the numbers; any
   * other text is only a label. Default: kWh, or W/kW for power sensors.
   */
  unit?: string;
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

export interface M3CounterCardConfig extends DetailModeConfig {
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

export interface M3PowerListCardConfig extends NotifyConfigBase, DetailModeConfig {
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

export interface M3PowerSummaryCardConfig extends DetailModeConfig {
  type: string;
  grid_entity: string;
  grid_sign?: GridSignConvention;
  /**
   * `compact` (#45): one tile one row tall — the main value in the suite's
   * header and the other values on one line beneath it, for a half-width
   * slot. The split bar and the metric tiles are left out.
   */
  layout?: "full" | "compact";
  /** Which value is the large one in compact layout. Default `grid`. */
  main_value?: "grid" | "consumption";
  /** Tap on the main icon (full) or the whole tile (compact). Default more-info on the main value's entity. */
  tap_action?: HaActionConfig;
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

export interface M3TopConsumersCardConfig extends PricingConfig, NotifyConfigBase, DetailModeConfig {
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

export interface M3CostCardConfig extends PricingConfig, NotifyConfigBase, DetailModeConfig {
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

/**
 * Shape of a wavy indicator: an M3-Expressive sine wave, or a plain line.
 *
 * One vocabulary for every card that draws one — the progress card's bar, the
 * light card's sliders, and the appliance card's bar and sliders — so the same
 * key means the same thing wherever it appears.
 */
export type WaveStyle = "wavy" | "flat";

/** Historical name for {@link WaveStyle}, kept so existing configs and imports
 *  keep resolving. */
export type LightWaveStyle = WaveStyle;
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

export interface M3LightCardConfig extends DetailModeConfig {
  /** The outline follows the state: rounder while off, squarer while on. */
  shape_by_state?: boolean;
  type: string;
  entity: string;
  name?: string;
  icon?: string;
  transition?: number;
  show_members?: boolean;
  /**
   * Drops the power button and makes the header icon the toggle instead — the
   * split the native tile card makes. Narrows what the card needs horizontally,
   * which is the point when several sit side by side in a grid.
   */
  compact?: boolean;
  /**
   * Tap on the header (#42). Default `more-info`. A `toggle` switches the light
   * with the card's `transition`.
   */
  tap_action?: HaActionConfig;
  /**
   * Tap on the icon. Default: `toggle` in compact mode, nothing otherwise —
   * set one to give the full card's icon an action of its own.
   */
  icon_tap_action?: HaActionConfig;
  /** Long press on the header. Default: nothing. */
  hold_action?: HaActionConfig;
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

export interface M3BatteryCardConfig extends NotifyConfigBase, DetailModeConfig {
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

/**
 * Which companion entities the card was told about explicitly. Anything left
 * out is looked up on the vacuum's own device — see shared/vacuum.ts — so the
 * common case needs nothing but `entity`.
 */
export interface VacuumEntityOverrides {
  map_entity?: string;
  cleaning_mode_entity?: string;
  mop_mode_entity?: string;
  mop_intensity_entity?: string;
  empty_mode_entity?: string;
  progress_entity?: string;
  area_entity?: string;
  time_entity?: string;
  status_entity?: string;
  dnd_switch?: string;
  child_lock_switch?: string;
  volume_entity?: string;
}

export type VacuumMapFit = "plan" | "picture";

export interface M3VacuumCardConfig extends VacuumEntityOverrides, NotifyConfigBase, DetailModeConfig {
  type: string;
  /** The `vacuum` entity. Everything else is optional. */
  entity: string;
  name?: string;
  icon?: string;

  /** Blocks. Each also disappears on its own when its entities are missing. */
  /**
   * Folds everything below the primary buttons — the map, the scales, the
   * chips — leaving the state, the battery and Start/Pause in view. Same four
   * keys as the room and heading cards, and the same storage.
   */
  collapsible?: boolean;
  /**
   * Which blocks the fold actually hides. Left out, it hides all of them,
   * which is what `collapsible` did before this existed — so adding the key
   * narrows the fold rather than changing what a card without it does.
   *
   * Useful for keeping one thing in view that the fold would otherwise take
   * with it: the suction scale on a card whose map folds away, say.
   */
  collapse_blocks?: VacuumBlock[];
  default_collapsed?: boolean;
  collapse_state_entity?: string;
  collapse_memory?: CollapseMemory;

  /**
   * Custom status texts, first match wins, matched against the vacuum's own
   * state. The way a brand whose vocabulary this card does not know gets a
   * readable line — and the way anyone renames "docked" to something they
   * prefer.
   */
  states?: StatusRule[];

  show_map?: boolean;
  /** Height of the map preview in px. Defaults to 360. */
  map_height?: number;
  /**
   * The magnifier that opens the map full-screen, where it pinches, drags and
   * wheel-zooms. On by default — a Roborock map carries wide transparent
   * margins, so enlarging it is how the floor plan fills the space it was
   * given. `false` leaves a plain picture.
   */
  map_zoom?: boolean;
  /** How far it may be zoomed in that view. Defaults to 4×. */
  map_max_zoom?: number;
  /**
   * What a tap on the map does. Without one it opens the enlarged map, and
   * nothing at all when `map_zoom` is off. `{ action: "none" }` switches the
   * tap off while keeping the magnifier.
   */
  map_tap_action?: HaActionConfig;
  /**
   * `plan` (the default) crops the empty margin off the picture so the floor
   * plan fills the box it was given; `picture` shows the file as it comes,
   * margin and all.
   */
  map_fit?: VacuumMapFit;
  show_progress?: boolean;
  show_rooms?: boolean;
  /**
   * The areas the vacuum can be sent to, as Home Assistant area ids, in the
   * order they should be offered. Required for the block to appear: the
   * segment-to-area mapping lives inside the integration and is not readable
   * from here, so there is no honest way to guess which of a home's areas the
   * robot can actually reach.
   */
  rooms?: string[];
  show_fan_speed?: boolean;
  /**
   * The cleaning-mode row: vacuum only, mop only, or both. A menu rather than
   * a scale — its options are three different jobs, not three strengths of one,
   * and the vacuum's own app asks the same question the same way.
   */
  show_cleaning_mode?: boolean;
  show_mop_intensity?: boolean;
  show_mop_mode?: boolean;
  show_station_chips?: boolean;
  /**
   * Recurring chores. Only the ones that are due appear, as a chip — the tile
   * is for what needs doing, not for a list of what does not.
   */
  reminders?: VacuumReminderConfig[];

  /**
   * Which two controls sit beside the primary button. `rooms` turns the
   * second one into a toggle for the room chips rather than a service call.
   */
  secondary_actions?: VacuumSecondaryAction[];
  max_chips?: number;

  /**
   * Free buttons, for anything the vacuum's own integration exposes that this
   * card cannot know about — Roborock's app routines, a Valetudo script, a
   * scene. The same chips the button and chip-buttons cards use, so they get
   * state colours, hold actions and the scrolling row for free.
   */
  buttons?: ChipButtonConfig[];
  /** Layout of the button row, as on the chip-buttons card. */
  buttons_wrap?: boolean;
  buttons_stretch?: boolean;
  buttons_justify?: "start" | "center" | "end" | "space-between";

  /**
   * How long a tapped state is shown before the card gives up waiting for the
   * poll to confirm it. Only worth touching on an integration slower than
   * Roborock's 30 seconds.
   */
  optimistic_timeout?: number;

  tap_action?: HaActionConfig;
  /**
   * The card's own popup: any Lovelace card, in the shared popup chrome.
   * A tile is a summary; the full set of controls, the history and the
   * maintenance card belong one tap away rather than on the dashboard.
   */
  popup?: VacuumPopupConfig;
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

/**
 * A recurring chore the vacuum does not track itself — changing the mop pad,
 * wiping the sensors. Counted against the lifetime run or runtime totals.
 */
export interface VacuumReminderConfig {
  /** Shown on the chip, the row and in the notification. */
  name: string;
  icon?: string;
  /** Due every N runs. */
  every_runs?: number;
  /** …or every N hours of runtime. `every_runs` wins if both are set. */
  every_hours?: number;
  /**
   * An `input_number` holding the meter reading at the last acknowledgement.
   * With one the reminder becomes "N runs since you last did this" and can be
   * marked done from the card; without one it simply fires on every multiple.
   */
  counter_entity?: string;
}

export interface VacuumConsumableConfig {
  /** Which part. Defaults cover Roborock's six; any other key needs `entity`. */
  key?: string;
  entity?: string;
  name?: string;
  icon?: string;
  /** Full service life in hours, for the bar. Derived when the sensor says. */
  max_hours?: number;
}

/** The foldable parts of the maintenance card, below the header. */
export type VacuumMaintenanceBlock =
  | "parts"
  | "reminders"
  | "station"
  | "stats"
  | "settings";

export interface M3VacuumMaintenanceCardConfig extends NotifyConfigBase, DetailModeConfig {
  type: string;
  /** The vacuum. Everything else is found on its device and its dock. */
  entity: string;
  name?: string;
  icon?: string;

  /** Overrides the automatic list entirely. */
  consumables?: VacuumConsumableConfig[];
  /** Recurring chores counted against the lifetime totals. */
  reminders?: VacuumReminderConfig[];
  /** Percent of service life below which a part warns, then alerts. */
  warn_below?: number;
  alert_below?: number;

  show_station?: boolean;
  show_stats?: boolean;
  show_settings?: boolean;
  /**
   * Long-press a part to reset its counter. Off by default, and greyed out
   * when the reset button is disabled — which is how Home Assistant ships
   * them.
   */
  show_reset?: boolean;

  collapsible?: boolean;
  /**
   * Which blocks the fold hides. Left out, it hides all of them — so a card
   * that only sets `collapsible` behaves as it did before this existed.
   */
  collapse_blocks?: VacuumMaintenanceBlock[];
  default_collapsed?: boolean;
  collapse_state_entity?: string;
  collapse_memory?: CollapseMemory;

  tap_action?: HaActionConfig;
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

export interface VacuumPopupConfig {
  /** Shown in the popup's top bar. Falls back to the card's name. */
  title?: string;
  size?: PopupSize;
  /** `[[entity_id]]` and `[[name]]` in it resolve to this card's. */
  content: Record<string, unknown>;
}

/** The foldable parts of the control card, below the primary buttons. */
export type VacuumBlock =
  /** Start/Pause and its neighbours. Folds only when named: a list left out
   *  keeps them, as before the block existed. */
  | "controls"
  | "map"
  | "rooms"
  | "fan_speed"
  | "cleaning_mode"
  | "mop"
  | "buttons"
  | "chips";

export type VacuumSecondaryAction = "return_to_base" | "locate" | "rooms" | "stop";

/**
 * The printer card's foldable blocks. The header and the controls are not in
 * the list: like the vacuum's state and Start/Pause, they are what the card is
 * for at a glance and never fold.
 */
export type PrinterBlock = "camera" | "progress" | "temps" | "speed" | "ams" | "details" | "chips";

/** Raw status value → one of the six printer states. */
export type PrinterStateMap = Record<string, import("./shared/printer").PrinterState>;

export interface PrinterAccessoryConfig {
  entity: string;
  name?: string;
  icon?: string;
  color?: string;
  /** Shown on the right of the row instead of "On" when it reads watts. */
  power_entity?: string;
}

export interface PrinterAmsSlotConfig {
  type_entity?: string;
  color_entity?: string;
  remaining_entity?: string;
}

export type PrinterSecondaryAction = "stop" | "files" | "filament" | "preheat";

// ---- Vehicle card ----------------------------------------------------------

/**
 * One value the vehicle card reads: an entity id as the short form, or an
 * object. The card knows no manufacturer, only meanings, so every reading is a
 * slot that a config (and, later, a preset) fills.
 */
export type VehicleSlot = string | VehicleSlotConfig;

export interface VehicleSlotConfig {
  entity?: string;
  /**
   * Jinja2. Rendered live by the card's template subscription (TemplatedCard),
   * and preferred over `entity` for the value; `entity` still supplies the
   * timestamps and the more-info target when both are given.
   */
  template?: string;
  /** Read this attribute instead of the state. */
  attribute?: string;
  name?: string;
  icon?: string;
  /** Overrides the entity's unit_of_measurement. */
  unit?: string;
  /** Shown in the warning colour below or above these values. */
  warn_below?: number;
  warn_above?: number;
}

export interface VehicleChargingSlotConfig extends VehicleSlotConfig {
  /**
   * States that mean "charging" for an entity that is not a binary_sensor.
   * Compared case-insensitively. Default: charging, on, true.
   */
  charging_states?: string[];
}

export interface VehicleEnergyConfig {
  battery?: VehicleSlot;
  /** Electric range. */
  range?: VehicleSlot;
  charging?: string | VehicleChargingSlotConfig;
  /** Cable plugged in — tells "plugged in" from "parked" when not charging. */
  plugged?: VehicleSlot;
  /** Charging power; W is recognised by its unit and shown as kW. */
  charge_power?: VehicleSlot;
  /** Target state of charge in %. */
  charge_limit?: VehicleSlot;
  /** When charging ends, as a timestamp. Preferred over any estimate. */
  charge_end?: VehicleSlot;
  /**
   * Usable battery capacity. Only with it does the card estimate when
   * charging ends; without it, and without `charge_end`, it shows no time.
   */
  capacity_kwh?: number;
  fuel_level?: VehicleSlot;
  fuel_range?: VehicleSlot;
}

/**
 * A condition in the suite's rule vocabulary (`StatusRule`): an exact value,
 * a pattern, or a threshold — plus a template and a minimum duration. A
 * condition that names only an entity is met while the entity is on.
 */
export interface VehicleCondition {
  /** Default: the battery entity (fuel level on `drive: fuel`). */
  entity?: string;
  attribute?: string;
  value?: string | string[];
  regex?: string;
  above?: number;
  below?: number;
  /** Jinja2; met when it renders to true/on/yes/1. */
  template?: string;
  /** Only once the entity has held its state this long. */
  for_minutes?: number;
}

export interface VehicleActionConfig {
  name?: string;
  icon?: string;
  /** Only honoured on the first entry: a wide tonal button with its name. */
  primary?: boolean;
  /** Target of toggle / more-info / a service call without its own target. */
  entity?: string;
  tap_action?: HaActionConfig;
  hold_action?: HaActionConfig;
  /** Shown only while this holds — "stop charging" only while charging. */
  visible?: VehicleCondition | VehicleCondition[];
}

export interface VehicleAlertConfig {
  /** A list means every condition must hold. */
  when: VehicleCondition | VehicleCondition[];
  /** May be a template. */
  text: string;
  icon?: string;
  /** `warn` (default) is amber; `info` is neutral. */
  severity?: "warn" | "info";
  action?: { name: string; entity?: string; tap_action: HaActionConfig };
}

/** The blocks under the header, in the order they are drawn. */
export type VehicleBlock = "energy" | "alerts" | "chips" | "actions" | "footer";

export type VehicleDrive = "ev" | "fuel" | "hybrid";

export interface M3VehicleCardConfig extends NotifyConfigBase, DetailModeConfig {
  type: string;
  name?: string;
  /** Default mdi:car (mdi:car-electric is not used: the card is for every drive). */
  icon?: string;
  /** A cut-out picture in the header's icon well, instead of the icon. */
  image?: string;
  /** Which energy slots the card expects. Default `ev`. */
  drive?: VehicleDrive;
  energy?: VehicleEnergyConfig;
  /** A lock entity, or a binary_sensor with device_class lock (on = unlocked). */
  lock?: VehicleSlot;
  /** A device_tracker, person, or a sensor that names the place. */
  location?: VehicleSlot;
  /** When the car last reported. Default: the battery or fuel entity's last report. */
  last_updated?: VehicleSlot;
  /** After this many minutes without a report the footer warns. 0/unset = never. */
  stale_after_minutes?: number;
  chips?: ((ApplianceChipConfig & { warn_below?: number; warn_above?: number }) | InfoChipHeading)[];
  chip_style?: "pill" | "tile";
  actions?: VehicleActionConfig[];
  alerts?: VehicleAlertConfig[];
  /** Order and visibility of the blocks under the header. */
  layout?: VehicleBlock[];
  /** Header tap. Default: the battery's (or fuel level's) more-info. */
  tap_action?: HaActionConfig;

  /** Folding: the lock pill (or the round chevron without one) folds the card. */
  collapsible?: boolean;
  /** What the fold takes. Default: chips, actions and footer. Alerts always stay. */
  collapse_blocks?: VehicleBlock[];
  default_collapsed?: boolean;
  collapse_state_entity?: string;
  collapse_memory?: CollapseMemory;

  /** Notifications — written as an automation by the editor (shared/vehicle-notify.ts). */
  notify_charge_done?: boolean;
  /** Battery (or fuel) below this percentage. */
  notify_low_below?: number;
  /** Unlocked for this many minutes. */
  notify_unlocked_minutes?: number;
  /** "HH:MM": remind if the car is not plugged in and below `notify_plug_below`. */
  notify_plug_time?: string;
  notify_plug_below?: number;

  /** Reserved for integration presets; ignored for now. */
  preset?: string;

  accent_color?: string;
  accent_opacity?: number;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  glass_background?: boolean;
  animation?: "auto" | "on" | "off";
  radius?: number;
  corners?: CornerRadiusConfig;
  haptics?: boolean;
}

export interface M3PrinterCardConfig extends NotifyConfigBase, DetailModeConfig {
  /**
   * The entity whose state drives the layout — a status or stage sensor. Any
   * domain is accepted, because integrations disagree about which one holds
   * it, and `state_map` is what turns its value into something the card
   * understands.
   */
  entity: string;
  type: string;
  name?: string;
  icon?: string;

  /** Raw status values onto the six states. Wins over the built-in table. */
  state_map?: PrinterStateMap;

  camera_entity?: string;
  progress_entity?: string;
  remaining_entity?: string;
  layer_entity?: string;
  total_layers_entity?: string;
  job_name_entity?: string;
  stage_entity?: string;
  nozzle_temp_entity?: string;
  nozzle_target_entity?: string;
  bed_temp_entity?: string;
  bed_target_entity?: string;
  chamber_temp_entity?: string;
  speed_entity?: string;
  /** Read-only profile, used when `speed_entity` is unavailable. */
  speed_state_entity?: string;
  start_time_entity?: string;
  end_time_entity?: string;
  power_entity?: string;
  online_entity?: string;
  error_entity?: string;
  light_entity?: string;

  ams_slots?: PrinterAmsSlotConfig[];
  accessories?: PrinterAccessoryConfig[];
  /**
   * Further readings, as on the appliance card: any entity as a pill or a
   * tile, drawn at the foot of the card. Same keys as the appliance card's
   * `chips`.
   */
  chips?: (ApplianceChipConfig | InfoChipHeading)[];
  /** `pill` (the default) or `tile`, as on the appliance card. */
  chip_style?: "pill" | "tile";
  /** `wavy` (the default) or `flat`, as on the appliance card. */
  wave_style?: WaveStyle;
  /** How the tiles show themselves; see the appliance card's `tile_appearance`. */
  tile_appearance?: "auto" | "active" | "inactive";
  /** Also announce a job starting, as the appliance card can. */
  notify_on_start?: boolean;
  /** Custom start text; `{geraet}` and `{ende}` as on the appliance card. */
  notify_start_message?: string;

  show_camera?: boolean;
  camera_refresh?: number;
  camera_live?: boolean;
  show_progress?: boolean;
  show_temps?: boolean;
  show_speed?: boolean;
  show_ams?: boolean;
  show_details?: boolean;
  /**
   * Folds the card down to its header and controls, the same way — and with
   * the same keys — as the vacuum cards. See `collapse_blocks`.
   */
  collapsible?: boolean;
  /**
   * Which blocks the fold takes. Absent, it takes all of them. While the printer
   * is offline `details` is never folded whatever this says: the socket in it is
   * the one control that can bring the machine back.
   */
  collapse_blocks?: PrinterBlock[];
  default_collapsed?: boolean;
  collapse_state_entity?: string;
  collapse_memory?: CollapseMemory;
  /** Drops a `.3mf`/`.gcode` ending from the job name. */
  strip_extension?: boolean;
  filament_warn?: number;
  /** A stop is irreversible on a printer; asking first is the default. */
  confirm_stop?: boolean;
  /** So is cutting the power under a running job. Switching *on* never asks. */
  confirm_power_off?: boolean;
  secondary_actions?: PrinterSecondaryAction[];
  optimistic_timeout?: number;

  pause_action?: HaActionConfig;
  resume_action?: HaActionConfig;
  stop_action?: HaActionConfig;
  start_action?: HaActionConfig;
  preheat_action?: HaActionConfig;
  files_action?: HaActionConfig;
  filament_action?: HaActionConfig;

  tap_action?: HaActionConfig;
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

export interface M3WeatherCardConfig extends DetailModeConfig {
  type: string;
  entity: string;
  name?: string;
  hours?: number;
  days?: number;
  chips?: WeatherChipType[];
  /**
   * Own sensors instead of the weather entity's attributes (#46) — a weather
   * station's thermometer, a UV sensor. `temperature` is the large current
   * temperature; the other keys are the chips of the same name. A sensor that
   * is unavailable falls back to the weather entity's value.
   */
  sensors?: Partial<Record<"temperature" | WeatherChipType, string>>;
  /** Tap on the current conditions. Default: more-info on the weather entity. */
  tap_action?: HaActionConfig;
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

/**
 * How wide the shared popup chrome renders. `normal` is the width every
 * existing popup has had; the other two exist for content that needs more room
 * than a phone-width sheet.
 */
export type PopupSize = "normal" | "wide" | "fullscreen";

/**
 * One person's popup: any Lovelace card, shown in the shared popup chrome.
 *
 * Keyed by `entity_id` rather than configured per entry because `entities` is a
 * plain id list (and is not written at all under `auto_discover`), so there is
 * no per-person object to hang this off. A person with no entry here keeps
 * whatever `tap_action` says.
 */
export interface PresencePersonPopupConfig {
  /** Shown in the popup's top bar. Falls back to the person's name. */
  title?: string;
  size?: PopupSize;
  /**
   * The card to show. `[[entity_id]]` and `[[name]]` placeholders anywhere in
   * it are substituted with the tapped person's — see shared/card-template.ts.
   */
  content: Record<string, unknown>;
}

export interface M3PresenceCardConfig extends DetailModeConfig {
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
  /** Height of the map preview in px. Defaults to 360. */
  map_height?: number;
  /**
   * Pinch, drag and wheel zoom on the map. On by default — a Roborock map
   * carries wide transparent margins, so zooming in is how the floor plan
   * fills the space it was given.
   */
  map_zoom?: boolean;
  /** How far it may be zoomed. Defaults to 4×. */
  map_max_zoom?: number;
  sort?: PresenceSortMode;
  /**
   * `grid` (default): header plus an avatar grid. `compact`: no header, one
   * pill per person — avatar, name and status in a 44px row.
   */
  layout?: "grid" | "compact";
  /** The shape says who is home: a rounder pill and avatar while away, squarer at home. */
  shape_by_state?: boolean;
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
  /**
   * Per-person popups, keyed by `entity_id`. A person listed here opens their
   * popup on tap instead of more-info, so the common case needs no
   * `tap_action` at all; an explicit one still wins, and `action: popup` is
   * available to put the popup on `hold_action` instead.
   */
  person_popups?: Record<string, PresencePersonPopupConfig>;
  /**
   * Per-person actions, keyed by `entity_id` (#39): tapping one person opens
   * their page, tapping another opens theirs. Each wins over the card-level
   * `tap_action` / `hold_action` for that person only.
   */
  person_actions?: Record<string, { tap_action?: HaActionConfig; hold_action?: HaActionConfig }>;
  /**
   * Drops the card around the people (#39): no background, no border, no
   * padding, so compact pills sit straight in the dashboard grid instead of a
   * frame inside a frame.
   */
  frameless?: boolean;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  animation?: "auto" | "on" | "off";
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

export interface M3MediaCardConfig extends DetailModeConfig {
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
  /** The chip naming the player (#49). Default true. */
  show_device_chip?: boolean;
  /** The chip naming the source or app (#49). Default true. */
  show_source_chip?: boolean;
  /** The volume row (#49). Default true. */
  show_volume?: boolean;
  /**
   * Volume down / up as actions of their own (#49), e.g. a script sending IR
   * codes to a soundbar the player cannot set. Either one replaces the slider
   * with two step buttons.
   */
  volume_down_action?: HaActionConfig;
  volume_up_action?: HaActionConfig;
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

export interface M3ClimateOverviewCardConfig extends NotifyConfigBase, EntityFilterConfig, DetailModeConfig {
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
  /** What a tap on a tile's humidity strip does. A room tile shows two
   * numbers from two sensors, so the humidity opens its own entity rather
   * than the temperature's. `none` gives the strip back to the tile, which
   * then taps as one again. Ignored where the humidity is a thermostat's
   * `current_humidity` attribute — there is no humidity entity to open. */
  humidity_tap_action?: HaActionConfig;
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

export interface M3AquariumCardConfig extends NotifyConfigBase, DetailModeConfig {
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
  /** Holds the last feeding: an input_datetime (date and time) or an input_button. */
  feeding_entity?: string;
  /** Not fed by then counts as overdue; also when the reminder goes out. */
  feeding_due_time?: string;
  feeding_notify_service?: string[];
  feeding_notify_enabled?: boolean;
  /** Written back on first setup, like notify_automation_id for cleaning. */
  feeding_notify_automation_id?: string;
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
  /** Mount point as Glances reports it, e.g. "/rootfs/srv/dev-disk-by-uuid-...".
   *  With `source: synology_dsm` there is no mount point — this is the DSM
   *  volume id instead, e.g. "volume_1". */
  mount: string;
  name?: string;
  icon?: string;
}

export type HostSource = "glances" | "systemmonitor" | "synology_dsm";

export interface M3NasCardConfig extends NotifyConfigBase, DetailModeConfig {
  type: string;
  /** Which integration supplies the metrics. Defaults per card type. */
  source?: HostSource;
  /** Pick up every Glances entity of the chosen host automatically. */
  auto_discover?: boolean;
  /** Restrict discovery to one Glances config entry when several NAS exist. */
  config_entry_id?: string;
  /** Explicit volume list; overrides discovery order and naming. */
  disks?: NasDiskConfig[];
  /** Mount points to hide; DSM volume ids with `source: synology_dsm`. */
  exclude_mounts?: string[];
  /** Mount point → display name, applied on top of discovery. Keyed by the DSM
   *  volume id with `source: synology_dsm`. */
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

export interface M3UpdatesCardConfig extends NotifyConfigBase, DetailModeConfig {
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

export interface M3CoverCardConfig extends DetailModeConfig {
  /** The outline follows the state: rounder while off, squarer while on. */
  shape_by_state?: boolean;
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
  /** A timestamp sensor whose state is the device's last message (Zigbee2MQTT's `*_last_seen`). */
  last_seen_entity?: string;
}

/**
 * When a quiet sensor counts as unreachable:
 * - `proof` (default): only when a last-seen time proves silence
 * - `activity`: when nothing on the device has changed for `stale_hours`
 * - `off`: never; only `unavailable` warns
 */
export type LeakStaleCheck = "proof" | "activity" | "off";

export interface M3LeakCardConfig extends NotifyConfigBase, DetailModeConfig {
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
  stale_check?: LeakStaleCheck;
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

export interface M3WasteCardConfig extends NotifyConfigBase, DetailModeConfig {
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
  /** Rows shown at once, the rest behind "show more"; 0 = all. The name the
   *  other list cards use. */
  max_visible?: number;
  /** @deprecated The waste card's old name for `max_visible`; still read. */
  max_rows?: number;
  reminder_offset?: number;
  reminder_time?: string;
  /** Which bins the reminder watches. Unset means all of them, which is what
   * it did before the option existed. One notification is sent either way,
   * naming whichever of these bins are due — not one per bin. */
  notify_entities?: string[];
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
  | M3DetailCardConfig
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
  | M3RoomCardConfig
  | M3RouterCardConfig
  | M3RouterDiagnosticsCardConfig
  | M3RemoteCardConfig
  | M3VehicleCardConfig;

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

export interface M3SupplyCardConfig extends NotifyConfigBase, DetailModeConfig {
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

export interface M3OccupancyCardConfig extends NotifyConfigBase, DetailModeConfig {
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

export interface M3StatusCardConfig extends DetailModeConfig {
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

export interface M3RoomCardConfig extends DetailModeConfig {
  /** The outline follows the state: rounder while off, squarer while on. */
  shape_by_state?: boolean;
  type: string;
  /** HA area id. Everything else is discovered from it. */
  area: string;
  /**
   * The area's picture from its settings (#43): `icon` puts it in the icon
   * well in place of the icon, `banner` as a band across the top of the card.
   * Left out — or an area without a picture — the card is as before.
   */
  area_picture?: "icon" | "banner";
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
  /**
   * Name what is on under the room's name — "Kaffee, Radio, Licht" — instead
   * of counting it. Names come from the nested cards when they give one.
   */
  show_active_names?: boolean;
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

export interface M3CalendarCardConfig extends DetailModeConfig {
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
  /**
   * Accepts Jinja2. The icon while this entry is the current page — a filled
   * `mdi:home` beside an outlined `mdi:home-outline`, say (#38). Falls back to
   * `icon`.
   */
  active_icon?: string;
  /**
   * A round picture in place of the icon (#38): a `person.*` (or any entity
   * with an `entity_picture`), or an image URL. Falls back to the icon while
   * there is no picture.
   */
  picture?: string;
  /**
   * Shown only to these users (#38), by name or user id, case-insensitive.
   * Left out, everyone sees the entry.
   */
  users?: string[];
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

export type NavSwipeDirection = "follow" | "inverted";

export interface M3NavCardConfig extends DetailModeConfig {
  /**
   * Takes the bar from the nav card on another view of the same dashboard
   * (#38): its `path` (`start`) or its index (`0`). Anything set on this card
   * as well wins, so one view can still differ in a detail. Edit the bar in
   * one place; every view that points at it follows.
   */
  config_from?: string;
  type: string;
  /**
   * A sideways swipe along the bar goes to the neighbouring entry, with the
   * page sliding over where the browser can. Only on a bar that does not
   * scroll sideways itself.
   */
  swipe_navigation?: boolean;
  /**
   * Which way the swipe goes. `follow` (default): the pill follows the finger,
   * so a swipe to the left lands on the entry to the left. `inverted`: the
   * finger pulls the bar, so a swipe to the left brings the entry on the right.
   */
  swipe_direction?: NavSwipeDirection;
  /**
   * With `swipe_navigation`: `false` stops a bar wider than the screen from
   * scrolling under the finger, so a sideways swipe always changes the page;
   * the bar keeps the active entry in view by itself. Default `true`.
   */
  bar_scroll?: boolean;
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
  /**
   * Leaves the chip out while true (#37). Jinja2 or a plain `true`; renders to
   * true/on/yes/1. The same as `hidden` on a nav card entry.
   */
  hidden?: string | boolean;
  /**
   * Shows the chip only while every condition holds (#37) — the vehicle
   * card's vocabulary: `value`, `above`/`below`, `regex`, `attribute`,
   * `template`, or nothing but an entity (met while it is on). A condition
   * without an `entity` reads the chip's own.
   */
  visible?: VehicleCondition | VehicleCondition[];
  /** false hides the name; the state stays, governed by `show_state`. */
  show_name?: boolean;
  /** Active-state color (theme token, hex, or any CSS color). */
  color?: string;
  inactive_color?: string;
  /** Per-state color overrides (e.g. `{ unlocked: "red" }`), applied over
   * `color`/`use_entity_color` for that exact state. See
   * `EDITABLE_STATE_COLOR_KEYS` for the curated editor subset. */
  state_colors?: Record<string, string>;
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
  /** A chip squares off while its entity is on and is a capsule while off. */
  shape_by_state?: boolean;
  /** Wrap to a new line instead of scrolling the row sideways. */
  wrap?: boolean;
  justify?: "start" | "center" | "end" | "space-between";
  /** Fill the row's full width instead of sizing chips to their content.
   * `true` splits the width evenly; `"smart"` gives each chip its content
   * width first and shares out only what is left, so a long label keeps the
   * room it needs while short ones stay compact. */
  stretch?: boolean | "smart";
}

export interface M3ChipButtonsCardConfig extends ChipButtonsRowConfig, DetailModeConfig {
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

export interface M3LightsOverviewCardConfig extends EntityFilterConfig, DetailModeConfig {
  /** The outline follows the state: rounder while off, squarer while on. */
  shape_by_state?: boolean;
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

// ---- m3-checkin-card -----------------------------------------------------

export type CheckinStyle = "segmented" | "status" | "swipe";

/** One element that shows whether someone is checked in and switches it. */
/**
 * m3-alarm-card (#47): an alarm_control_panel — Alarmo, the manual platform,
 * any integration — in the suite's frame, following the theme in light and
 * dark without extra styling.
 */
/** A fixed number or an entity that reads one (reserve, charge limit). */
export type SolarBatteryNumberSource = string | number;

/** One solar input (MPPT) of a solar battery. */
export interface SolarBatteryMpptConfig {
  entity: string;
  name?: string;
  /** What fills the column to the top. Default 500 W. */
  max_watts?: number;
  tap_action?: HaActionConfig;
}

/** An expansion battery next to the main one. */
export interface SolarBatteryExtraConfig {
  soc: string;
  capacity_kwh?: number;
  name?: string;
  tap_action?: HaActionConfig;
}

/**
 * A free chip at the bottom: an entity's state, or a template's text (the
 * card renders `{{ }}` in any config string, so `template` arrives as text).
 */
export interface SolarBatteryChipConfig {
  entity?: string;
  template?: string;
  name?: string;
  icon?: string;
  /** Replaces the entity's own unit. */
  unit?: string;
  color?: string;
  tap_action?: HaActionConfig;
}

/**
 * A balcony solar battery with its own inverter (EcoFlow STREAM, Anker
 * SOLIX, Zendure, …), mapped entirely by config. Grid import is left to the
 * power summary card.
 */
export interface M3SolarBatteryCardConfig extends DetailModeConfig {
  type: string;
  name?: string;
  icon?: string;
  /** Fixed text or a template, after the mode. */
  subtitle?: string;
  /** An entity whose state (an operating mode) leads the subtitle. */
  mode?: string;
  /** Without it there is no "kWh stored" line and no forecast. */
  capacity_kwh?: number;
  soc: string;
  reserve?: SolarBatteryNumberSource;
  charge_limit?: SolarBatteryNumberSource;
  /** One signed sensor: positive charges (flip with `invert`)… */
  battery_power?: string;
  invert?: boolean;
  /** …or two plain ones. */
  charge_power?: string;
  discharge_power?: string;
  /** Total solar power; the sum of the inputs when left out. */
  solar_power?: string;
  mppt?: SolarBatteryMpptConfig[];
  /** What the inverter feeds into the house. */
  output_power?: string;
  batteries?: SolarBatteryExtraConfig[];
  chips?: SolarBatteryChipConfig[];
  hide_mppt_without_sun?: boolean;
  /** Below this many watts nothing flows. Default 10. */
  idle_threshold_w?: number;
  /** From this many watts values read in kW. Default 1000. */
  kw_threshold?: number;
  show_bar?: boolean;
  show_flow?: boolean;
  show_mppt?: boolean;
  show_forecast?: boolean;
  /** Header tap. Default more-info on `soc`. */
  tap_action?: HaActionConfig;
  solar_tap_action?: HaActionConfig;
  battery_tap_action?: HaActionConfig;
  output_tap_action?: HaActionConfig;
  solar_color?: string;
  battery_color?: string;
  house_color?: string;
  flow_tint_opacity?: number;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  animation?: "auto" | "on" | "off";
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

export interface M3AlarmCardConfig extends DetailModeConfig {
  type: string;
  /** An alarm_control_panel entity. Required. */
  entity: string;
  /** Default: the entity's friendly name. */
  name?: string;
  /**
   * The mode buttons, in this order; each a mode or `{ mode, name, icon }`.
   * Default: the modes the panel supports, at most four, "disarmed" first.
   */
  modes?: (AlarmMode | AlarmModeConfig)[];
  /**
   * binary_sensors for the status line, for integrations that do not list
   * open sensors themselves (Alarmo does, in `open_sensors`).
   */
  sensors?: string[];
  /** The open/ok sensor chips. Default true. */
  show_sensors?: boolean;
  /**
   * One row: the header and its pill. A tap opens the buttons; an entry
   * delay or a triggered alarm opens them by itself.
   */
  compact?: boolean;
  /** The armed colour. Default the theme's primary colour. */
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

export interface M3CheckinCardConfig extends DetailModeConfig {
  type: string;
  /**
   * input_boolean (switchable), binary_sensor (display), person or
   * device_tracker (by zone). May be left out when `user_entity_map` names
   * every viewer.
   */
  entity: string;
  /**
   * Several people on one card: Home Assistant user (name or id) → that
   * person's entity. The card switches the viewer's own, and shows everyone
   * checked in as avatars.
   */
  user_entity_map?: Record<string, string>;
  /** The avatars of everyone checked in; default true when there is a map. */
  show_people?: boolean;
  /**
   * Ask before switching: `double_tap` ("Sure?" for 3 s), `hold` (600 ms).
   * Not for the swipe style, whose slide is its own confirmation.
   */
  confirm?: "none" | "double_tap" | "hold";
  style?: CheckinStyle;
  name?: string;
  icon?: string;
  icon_off?: string;
  /** The state that means checked in; default `on`. */
  state_on?: string;
  /** For a person or tracker, the zone that means checked in; default `home`. */
  home_state?: string;
  checkin_action?: HaActionConfig;
  checkout_action?: HaActionConfig;
  /** An input_datetime or timestamp sensor holding the last change. */
  since_entity?: string;
  /** "Checked in" / "Checked out" — the state, never the verb. */
  label_in?: string;
  label_out?: string;
  icon_in?: string;
  icon_out?: string;
  /** Style `status`: the button names the action — "Check in" / "Check out". */
  button_label_in?: string;
  button_label_out?: string;
  /** Style `swipe`: the track's words — "Slide to check in" / "Slide to check out". */
  swipe_label_in?: string;
  swipe_label_out?: string;
  /** Style `swipe`: the colour of checking out; default a warm orange. */
  color_checkout?: string;
  /** Status templates; `{duration}` and `{time}`. */
  status_in?: string;
  status_out?: string;
  /** Colour while checked in; default the card accent green. */
  color?: string;
  /** Colour while checked out; neutral on purpose, so out is not an error. */
  color_off?: string;
  /** Milliseconds to wait for Home Assistant to confirm a tap. Default 5000. */
  optimistic_timeout?: number;
  tap_action?: HaActionConfig;
  animation?: "auto" | "on" | "off";
  haptics?: boolean;
  glass_background?: boolean;
  card_background?: string;
  text_color?: string;
  secondary_text_color?: string;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

// ---- m3-openings-card ----------------------------------------------------

export interface OpeningsEntityConfig {
  entity: string;
  name?: string;
  icon?: string;
  tap_action?: HaActionConfig;
}

/** Windows and doors: what is open, for how long, and whether it matters. */
export interface M3OpeningsCardConfig extends DetailModeConfig {
  type: string;
  /** binary_sensors of class door, window, opening or garage_door; the bare id works too. */
  entities?: Array<string | OpeningsEntityConfig>;
  /** Find the sensors by device class; on by default when `entities` is left out. */
  auto_discover?: boolean;
  include_area?: string[];
  include_label?: string[];
  exclude_entities?: string[];
  title?: string;
  icon?: string;
  outdoor_temperature?: string;
  /** Minutes open before a sensor counts as open too long. Default 15. */
  warn_after_minutes?: number;
  /** Below this outdoor temperature an open-too-long sensor warns. Default 10. */
  cold_below?: number;
  /** Closed and missing sensors shown as chips before "+N". Default 4. */
  max_chips?: number;
  /** Default action for every row and chip; an entry's own tap_action wins. */
  tap_action?: HaActionConfig;
  color_open?: string;
  color_warn?: string;
  color_closed?: string;
  animation?: "auto" | "on" | "off";
  haptics?: boolean;
  glass_background?: boolean;
  card_background?: string;
  text_color?: string;
  secondary_text_color?: string;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

// ---- m3-multi-graph-card -----------------------------------------------

export type MultiGraphRange = "6h" | "12h" | "24h" | "48h" | "7d" | "30d";
export type MultiGraphSummary = "mean" | "median" | "sum" | "entity";
/** How the curves are coloured. Only "tonal" for now; "by_value" is planned. */
export type MultiGraphPalette = "tonal";

/**
 * One room, written as on the climate overview card, so a room list can be
 * copied between the two. With `device_class: humidity` the humidity sensor
 * is drawn, otherwise the temperature sensor; `climate_entity` is accepted
 * and ignored.
 */
export interface MultiGraphRoomConfig {
  /** Default: the sensor's area, then its name with `name_strip` applied. */
  name?: string;
  icon?: string;
  temperature_entity?: string;
  humidity_entity?: string;
  climate_entity?: string;
  /** Overrides the palette. */
  color?: string;
}

/**
 * Chip and curve order. "area" keeps the order found or listed;
 * `temp_desc` / `temp_asc` are the climate overview card's names for the
 * value orders and are read as such.
 */
export type MultiGraphSort = "area" | "value_desc" | "value_asc" | "name" | "temp_desc" | "temp_asc";

/** One curve: listed under `entities`, or resolved from `rooms` or discovery. */
export interface MultiGraphEntityConfig {
  entity: string;
  /** Default: the sensor's area, then its name with `name_strip` applied. */
  name?: string;
  /** Overrides the palette. */
  color?: string;
}

export interface M3MultiGraphCardConfig extends EntityFilterConfig {
  type: string;
  /**
   * What is compared: a sensor device class — temperature (the default),
   * humidity, carbon_dioxide, power, illuminance … Discovery looks for it,
   * and the header text, icon, unit and decimals follow it.
   */
  device_class?: string;
  /** Default: by device class — "Raumtemperatur", "Luftfeuchtigkeit", … */
  name?: string;
  icon?: string;
  show_header?: boolean;
  /** Find one sensor of `device_class` per area; on by default without a list. */
  auto_discover?: boolean;
  /** Any sensors, as ids or `{entity, name, color}`; wins over `rooms` and discovery. */
  entities?: Array<string | MultiGraphEntityConfig>;
  /** A room list in the climate overview card's format (temperature and humidity). */
  rooms?: MultiGraphRoomConfig[];
  /** Patterns removed from names found by discovery. */
  name_strip?: string[];
  /** Order of the chips and curves. Default "area" (as found or listed). */
  sort?: MultiGraphSort;
  /** The ranges offered below the graph. Default ["24h", "7d"]. */
  ranges?: MultiGraphRange[];
  /** Default: the first of `ranges`. */
  default_range?: MultiGraphRange;
  /** The large value in the header. Default "mean". */
  summary?: MultiGraphSummary;
  /** The sensor shown large when `summary` is "entity". */
  summary_entity?: string;
  /** The curve in focus at first: its sensor, or its position. Default the first. */
  default_focus?: number | string;
  /** Default: the sensor's display precision, else by device class. */
  decimals?: number;
  /** The lowest and highest value as pills at the left edge. Default true. */
  show_extremes?: boolean;
  /** The chips (legend and focus picker). Default true. */
  show_chips?: boolean;
  /** The time labels below the graph. Default true. */
  show_axis?: boolean;
  /**
   * Grid lines (#36): `horizontal` (default) at round values, `vertical` at
   * the time labels' marks, `both`, or `none`.
   */
  grid_lines?: "horizontal" | "vertical" | "both" | "none";
  /** About how many horizontal lines. Default 3. */
  y_ticks?: number;
  /** The value on each horizontal line, at the left edge. Default false. */
  show_y_labels?: boolean;
  /** A line at "now", the right edge, labelled. Default false. */
  show_now_marker?: boolean;
  /** The focused curve's lowest and highest reading in the footer. Default true. */
  show_focus_range?: boolean;
  /** The range picker in the footer; hidden anyway with a single range. Default true. */
  show_ranges?: boolean;
  /** Height of the graph alone, in px. Default 130. */
  height?: number;
  palette?: MultiGraphPalette;
  /** The header icon, the large value and the active range. Default: the theme's primary colour. */
  accent_color?: string;
  animation?: "auto" | "on" | "off";
  haptics?: boolean;
  glass_background?: boolean;
  card_background?: string;
  text_color?: string;
  secondary_text_color?: string;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

// ---- m3-popup-card -------------------------------------------------------

export interface M3PopupCardConfig {
  type: string;
  /** The URL hash that opens it, e.g. `#remotes`; the leading # is optional. */
  hash: string;
  title?: string;
  icon?: string;
  cards: LovelaceCardConfig[];
  /** Frosted glass behind the cards; default true, as on every card. */
  glass_background?: boolean;
  card_background?: string;
  /** Set as the theme's text colours on the sheet, for every card on it. */
  text_color?: string;
  secondary_text_color?: string;
  /** `off` opens and closes the sheet in place, without the slide. */
  animation?: "auto" | "on" | "off";
  card_version?: string;
}

// ---- m3-appliance-card ----------------------------------------------------

/** The optional progress row: a bar, and a caption for what is left of the run. */
export interface ApplianceProgressConfig {
  /** 0-100. Without it the bar is indeterminate, or absent if nothing is running. */
  percentage_entity?: string;
  /**
   * Minutes left, seconds left, a "1:24:00" duration, or an absolute completion
   * timestamp — all four shapes are read, because integrations disagree.
   */
  remaining_entity?: string;
  label?: string;
  color?: string;
}

/** A `number` / `input_number` row, drawn as a labelled slider. */
export interface ApplianceSliderConfig {
  entity: string;
  label?: string;
  icon?: string;
  /** Overrides the entity's `unit_of_measurement`. */
  unit?: string;
  /** Each overrides the entity's own attribute; the entity is the default. */
  min?: number;
  max?: number;
  step?: number;
  color?: string;
}

/** A `select` / `input_select` row, drawn as a row of pills. */
export interface ApplianceSelectConfig {
  entity: string;
  label?: string;
  /** Show only these of the entity's options, in this order. */
  options?: string[];
  /** Per-option icon, keyed by the raw option string. */
  icons?: Record<string, string>;
  /** Per-option label, keyed by the raw option string. */
  names?: Record<string, string>;
  color?: string;
  style?: "icon_label" | "label" | "dropdown";
}

/** An action button. Without a `tap_action` the entity's domain decides. */
export interface ApplianceButtonConfig {
  entity?: string;
  name?: string;
  icon?: string;
  color?: string;
  tap_action?: HaActionConfig;
}

/** A small status pill. Read-only unless it is given a `tap_action`. */
/**
 * A divider between groups of chips: a small heading across the full width,
 * so readings from several devices — a printer, its AMS, a filament dryer —
 * stay apart in one list.
 */
export interface InfoChipHeading {
  heading: string;
  icon?: string;
}

export interface ApplianceChipConfig {
  entity: string;
  name?: string;
  icon?: string;
  color?: string;
  /** Fixed text, instead of the name and the state. */
  label?: string;
  /** Defaults to true, so a chip says what the entity actually reads. */
  show_state?: boolean;
  /** Same rule shape as the card's own `states`, for this chip's text/colour/icon. */
  states?: StatusRule[];
  tap_action?: HaActionConfig;
  /**
   * How a tile shows itself, as a room's button cards do. `active`: squared,
   * its well filled and the icon inverted; `inactive`: round. `auto` (the
   * default) follows an on/off entity's state and leaves a reading round.
   */
  appearance?: "auto" | "active" | "inactive";
}

/** The blocks the card can draw, in the order they should appear. */
export type ApplianceBlock = "progress" | "sliders" | "selects" | "buttons" | "chips" | "cards";

export interface AppliancePopupConfig {
  /** Shown in the popup's top bar. Falls back to the card's name. */
  title?: string;
  size?: PopupSize;
  /**
   * The card to show. `[[entity_id]]` and `[[name]]` placeholders in it resolve
   * to this card's — see shared/card-template.ts.
   */
  content: Record<string, unknown>;
}

export interface M3ApplianceCardConfig extends NotifyConfigBase, DetailModeConfig {
  type: string;
  /**
   * The entity that says what the appliance is doing. Usually a `sensor`
   * holding an operation state, but anything with a state works — a `switch`,
   * a `binary_sensor`, a `vacuum`. Optional: without one the card is a plain
   * tile with a name, an icon and an action (#41).
   */
  entity?: string;
  name?: string;
  /** Let a long name take two lines instead of being cut off after one (#40). */
  name_wrap?: boolean;
  icon?: string;
  /** Show this attribute instead of the state. */
  attribute?: string;
  /** First match wins; a rule with no condition is the catch-all. */
  states?: StatusRule[];
  /**
   * The states that mean "finished", for the notification. Left out, the
   * suite's defaults — `finished`, `finish`, `end`, `beenden` — which cover
   * Home Connect and SmartThings.
   */
  done_states?: string[];
  /** Also notify when a run starts, with its expected end when the card knows it. */
  notify_on_start?: boolean;
  /**
   * The start message, in place of the built-in one. `{geraet}` is the card's
   * name and `{ende}` the expected end as a time, or "–" while it is unknown.
   */
  notify_start_message?: string;
  /**
   * The states that mean "not running", for the start notification: a run
   * starts when the state leaves one of these. Left out, the suite's defaults,
   * which cover Home Connect (`ready`, `inactive`) and SmartThings (`none`).
   */
  idle_states?: string[];

  progress?: ApplianceProgressConfig;
  sliders?: ApplianceSliderConfig[];
  selects?: ApplianceSelectConfig[];
  buttons?: ApplianceButtonConfig[];
  chips?: (ApplianceChipConfig | InfoChipHeading)[];
  /**
   * How the chips are drawn: `pill` (the default) is a row of small pills,
   * `tile` a grid of tiles with the name above a larger value — for a card
   * that is mostly read, where the figures are the point.
   */
  chip_style?: "pill" | "tile";
  /**
   * How the tiles show themselves, as a room's button cards: `active` draws
   * the readings squared and filled, `inactive` draws every tile round, and
   * `auto` (the default) leaves readings round. Switches and binary sensors
   * follow their state under `auto` and `active`. A tile's own `appearance`
   * wins.
   */
  tile_appearance?: "auto" | "active" | "inactive";
  /**
   * The full-width button a finished machine shows — "Emptied". Any action:
   * a script, an input_boolean, an input_button that resets a derived status.
   * Without it there is no button.
   */
  finish_action?: HaActionConfig;
  /** The button's text; "Emptied" in the user's language by default. */
  finish_label?: string;
  /**
   * Other cards drawn inside this one, under its readings — the dishwasher's
   * tablet supply, say. Any card, written as in a view; they fold with the
   * rest under "Details" (the `cards` block).
   */
  cards?: Record<string, unknown>[];
  /** "done at 15:18" under the remaining time while a run is on. Default true. */
  show_end_time?: boolean;

  /**
   * Which blocks to draw and in what order. Leaving a block out hides it, so
   * this is both the ordering and the visibility control — one mechanism rather
   * than an array plus a set of show_* flags that can disagree with it.
   */
  layout?: ApplianceBlock[];
  /**
   * Shape of the progress bar and the sliders. Defaults to `wavy`, matching
   * `m3-progress-card` — this card's progress block is what replaces it, and
   * the humidifier slider this card's slider is modelled on is wavy too.
   */
  wave_style?: WaveStyle;

  /**
   * Folds the blocks away, leaving the header — name, state and remaining
   * time — in view. The same four keys and the same storage as the vacuum and
   * printer cards.
   */
  collapsible?: boolean;
  /** Which blocks the fold hides; left out, all of them. */
  collapse_blocks?: ApplianceBlock[];
  default_collapsed?: boolean;
  collapse_state_entity?: string;
  collapse_memory?: CollapseMemory;

  tap_action?: HaActionConfig;
  popup?: AppliancePopupConfig;
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

// ---- router cards -----------------------------------------------------------

/** One step of a configurable signal scale, as `rsrp_thresholds` takes it. */
export interface RouterThresholdConfig {
  min: number;
  grade: "excellent" | "good" | "fair" | "weak" | "bad";
}

/**
 * Every entity the connection card can draw, each overridable on its own.
 *
 * Split out from the config so the diagnostics card can share the ones it
 * needs without inheriting `show_sparkline` and friends.
 */
export interface RouterEntityOverrides {
  /**
   * Narrows discovery to one router's entities by their shared id prefix
   * (`zte` for `sensor.zte_*`). Guessed from the instance when left out.
   */
  entity_prefix?: string;
  /** Turns discovery off entirely; only what is named below is drawn. */
  auto_discover?: boolean;

  rsrp_entity?: string;
  rsrq_entity?: string;
  snr_entity?: string;
  rssi_entity?: string;
  /** The 5G radio, shown as a second signal row when it reports. */
  nr_rsrp_entity?: string;
  nr_snr_entity?: string;
  /** A fibre line's optical power, used when there is no radio at all. */
  optical_rx_entity?: string;
  optical_tx_entity?: string;

  band_entity?: string;
  nr_band_entity?: string;
  cell_id_entity?: string;
  pci_entity?: string;
  nr_pci_entity?: string;
  network_type_entity?: string;
  carrier_aggregation_entity?: string;

  download_entity?: string;
  upload_entity?: string;

  data_down_entity?: string;
  data_up_entity?: string;
  data_total_entity?: string;

  operator_entity?: string;
  sim_entity?: string;
  uptime_entity?: string;
  firmware_entity?: string;
  connected_devices_entity?: string;
}

export interface M3RouterCardConfig extends RouterEntityOverrides, NotifyConfigBase, DetailModeConfig {
  type: string;
  /**
   * The connection entity — a `binary_sensor` with a connectivity class, or a
   * status `sensor` carrying the modem's own vocabulary. Everything else is
   * discovered or named above.
   */
  entity?: string;
  name?: string;
  icon?: string;

  /** Blocks. Each also disappears on its own when its entities are missing. */
  show_signal?: boolean;
  show_signal_details?: boolean;
  show_throughput?: boolean;
  show_sparkline?: boolean;
  show_data?: boolean;
  /** The second signal row for the 5G carrier on an NSA connection. */
  show_nr_signal?: boolean;
  /** A chip carrying the highest throughput seen since the card loaded. */
  peak_chip?: boolean;

  /** How many readings the sparkline keeps. */
  spark_points?: number;
  /** How far back the first render prefills from the recorder, in minutes. */
  spark_history_minutes?: number;

  rsrp_thresholds?: RouterThresholdConfig[];
  nr_rsrp_thresholds?: RouterThresholdConfig[];
  snr_thresholds?: RouterThresholdConfig[];
  rsrq_thresholds?: RouterThresholdConfig[];
  optical_rx_thresholds?: RouterThresholdConfig[];
  /** Above this the optical receiver is overdriven; see shared/router.ts. */
  optical_rx_max?: number;

  /** A tariff allowance in GB; turns the volume bar into a budget. */
  data_limit?: number;
  /** Raw state → label, applied before the built-in vocabulary table. */
  value_map?: Record<string, string>;

  tap_action?: HaActionConfig;
  hold_action?: HaActionConfig;
  double_tap_action?: HaActionConfig;

  accent_color?: string;
  download_color?: string;
  upload_color?: string;
  online_color?: string;
  offline_color?: string;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

/** A temperature row on the diagnostics card. */
export interface RouterTemperatureConfig {
  entity: string;
  name?: string;
  /** Full-scale value for the bar. Defaults to DEFAULT_ROUTER_TEMP_MAX. */
  max?: number;
}

/** A label/value cell in the "cell & band" grid. */
export interface RouterInfoConfig {
  entity: string;
  label?: string;
  /** A state that should be drawn in the warning colour, e.g. `ca_deactivated`. */
  warn_value?: string;
}

/** A reachability tile. */
export interface RouterCheckConfig {
  entity: string;
  name?: string;
  /** The state that counts as healthy. Defaults to `on`. */
  ok_state?: string;
}

export interface M3RouterDiagnosticsCardConfig extends RouterEntityOverrides, NotifyConfigBase, DetailModeConfig {
  type: string;
  /** The connection entity, used to tell when a reboot has completed. */
  entity?: string;
  name?: string;
  icon?: string;

  temperature_entities?: RouterTemperatureConfig[];
  throttle_entities?: string[];
  info_entities?: RouterInfoConfig[];
  check_entities?: RouterCheckConfig[];

  show_temperatures?: boolean;
  show_throttle?: boolean;
  show_info?: boolean;
  show_checks?: boolean;
  show_reboot?: boolean;
  show_uptime?: boolean;
  show_firmware?: boolean;
  show_clients?: boolean;

  /** Warning and alarm temperature, in the sensors' own unit. */
  temp_warn?: number;
  temp_hot?: number;
  /** Full-scale value for a temperature bar without its own `max`. */
  temp_max?: number;

  /** What the reboot button does. Defaults to pressing the discovered button. */
  reboot_action?: HaActionConfig;
  confirm_reboot?: boolean;
  /** How long the armed button waits for the second tap, in milliseconds. */
  confirm_timeout?: number;

  value_map?: Record<string, string>;

  accent_color?: string;
  ok_color?: string;
  warn_color?: string;
  hot_color?: string;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  animation?: "auto" | "on" | "off";
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  card_version?: string;
}

// ---- m3-remote-card ---------------------------------------------------------

/** One app or source button. */
export interface RemoteAppConfig {
  name: string;
  icon?: string;
  color?: string;
  /** The app's own id, matched against `app_id` to mark it active. */
  app_id?: string;
  /** What a tap does. Defaults to `media_player.select_source` with `name`. */
  action?: HaActionConfig;
}

/** A freely configured button in the function row or the right column. */
export interface RemoteButtonConfig {
  /** A key the profile knows, e.g. `back`, or omitted when `action` is given. */
  key?: string;
  icon?: string;
  label?: string;
  action?: HaActionConfig;
}

export interface M3RemoteCardConfig extends DetailModeConfig {
  type: string;
  /** A `remote.*` or `media_player.*` entity. Everything else is found from it. */
  entity: string;
  /** The second entity, when commands and metadata live apart. */
  media_entity?: string;
  /** When power runs through something else, e.g. a smart plug. */
  power_entity?: string;
  /** Defaults from the integration; `generic` when it is not recognised. */
  profile?: string;
  name?: string;
  icon?: string;

  /** Per-key overrides, keyed by the card's own key names. */
  key_overrides?: Record<string, { command?: string; service?: string; domain?: string; data?: Record<string, unknown> }>;

  dpad_size?: number;
  keyboard_control?: boolean;
  /** Milliseconds between repeats while a direction is held. */
  repeat_interval?: number;

  right_column?: "auto" | "channel" | "assistant" | "custom" | "none";
  right_buttons?: RemoteButtonConfig[];
  show_rocker_labels?: boolean;
  assistant_timeout?: number;

  function_buttons?: RemoteButtonConfig[];
  show_transport?: boolean;
  show_numpad?: boolean;

  apps?: RemoteAppConfig[];
  app_style?: "chips" | "tiles";
  show_apps?: boolean;
  max_apps?: number;

  show_now_playing?: boolean;
  power_toggle?: boolean;
  haptics?: boolean;

  accent_color?: string;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
  animation?: "auto" | "on" | "off";
  card_version?: string;
}

export type DetailRangeOption = "1h" | "24h" | "7d" | "30d";
export type DetailStat = "min" | "mean" | "max" | "sum";

/** What a tap that would open more-info opens instead. See shared/entity-detail.ts. */
export type DetailMode = "more_info" | "sheet";

/**
 * Every card that opens an entity's details takes `detail_mode`: `more_info`
 * (Home Assistant's dialog, the default) or `sheet` (the suite's own detail
 * sheet). The cards that never open details — the list is
 * `NO_DETAIL_CARDS` in shared/appearance-editor.ts — do not extend this.
 */
export interface DetailModeConfig {
  detail_mode?: DetailMode;
}

export interface M3DetailCardConfig {
  type: string;
  entity: string;
  name?: string;
  icon?: string;
  /** The entity's colour. Defaults by device_class. */
  color?: string;
  /** The window the graph opens on, until the viewer picks another. */
  range?: DetailRangeOption;
  /** The windows offered above the graph, in this order. */
  ranges?: DetailRangeOption[];
  /** The tiles under the graph. Default: min, mean, max — plus sum for a meter. */
  stats?: DetailStat[];
  /**
   * The card at the top of a controllable entity's view. `auto` picks the
   * suite's own card for the domain, `none` shows none, and a card config is
   * used as given, with `[[entity]]` standing for this entity.
   */
  control_card?: "auto" | "none" | Record<string, unknown>;
  /** Layout per entity id or domain: numeric, binary, states, control, info. */
  type_overrides?: Record<string, string>;
  /** The other entities of the same device, under the view. Default true. */
  show_related?: boolean;
  /** At most this many of them. Default 5. */
  max_related?: number;
  /** The reading under a pointer on the curve. Default true. */
  show_tooltip?: boolean;
  /** A few round values up the side of the curve. Default true. */
  y_axis?: boolean;
  /**
   * History, tiles and the device's other entities: shown, folded behind a
   * button, or left out. Default: folded for a switch, shown for the rest.
   */
  details?: "expanded" | "collapsed" | "hidden";
  /** For readings where rising is bad news — a green arrow on a falling value. */
  trend_inverted?: boolean;
  text_color?: string;
  secondary_text_color?: string;
  card_background?: string;
  animation?: "auto" | "on" | "off";
  glass_background?: boolean;
  radius?: number;
  corners?: CornerRadiusConfig;
}
