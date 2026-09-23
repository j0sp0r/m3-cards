import type { CornerRadiusConfig, HvacMode, WeatherChipType, ClimateOverviewTempThresholds } from "./types";
import { RADIUS, HEIGHT, SPACING, DURATION_MS, PALETTE } from "./shared/tokens";
import {
  LEVEL_EDGE_INSET,
  LEVEL_HANDLE_HEIGHT,
  LEVEL_HANDLE_RADIUS,
  LEVEL_HANDLE_WIDTH,
  LEVEL_TRACK_GAP,
  LEVEL_TRACK_HEIGHT,
  LEVEL_TRACK_RADIUS,
} from "./shared/level-slider";

export const CARD_VERSION = "2.4.0";

export const DEFAULT_CLIMATE_RADIUS = RADIUS.cardHero;
export const DEFAULT_MINI_RADIUS = RADIUS.card;

// ---- Climate action glow (heating/cooling equipment indicator) ------------
// A squared-off (not superellipse) edge glow around both climate cards,
// signalling that the thermostat is actively heating or cooling right now —
// inspired by reference/ecosee's equipment glow, but drawn as three stacked
// `box-shadow` layers on the existing rounded-rect card shape instead of an
// SVG silhouette, so it stays crisp/"eckig" in line with this suite's M3
// language rather than ecosee's rounded squircle.
export const ACTION_GLOW_COLOR_HEAT = PALETTE.heat;
export const ACTION_GLOW_COLOR_COOL = PALETTE.cool;
// Crisp inset line, soft inward bloom, faint outward halo — same 3-layer
// falloff idea as ecosee's stacked strokes (5.5/2.2/0.9 stroke-widths at
// 0.18/0.5/1 opacity), re-expressed as box-shadow blur/spread/opacity.
export const ACTION_GLOW_INSET_HALO_BLUR = 14;
export const ACTION_GLOW_INSET_HALO_OPACITY = 0.22;
export const ACTION_GLOW_INSET_BLOOM_BLUR = 4;
export const ACTION_GLOW_INSET_BLOOM_OPACITY = 0.55;
export const ACTION_GLOW_INSET_LINE_OPACITY = 0.9;
// The same frame at a fraction of the strength, for "heat/cool is selected but
// the equipment is not running right now". Many integrations (Homematic's
// eTRV/HEATING via hahomematic, for one) derive hvac_action from the physical
// valve, so they report "idle" for long stretches — through a whole summer, in
// fact — even with the mode set to heat. At full strength the frame would then
// be a lie; hidden entirely it loses the fact that heating is armed at all.
// Low enough to read as "standby" next to the running frame, high enough to
// survive the glass background.
export const ACTION_GLOW_ARMED_OPACITY = 0.3;
export const ACTION_GLOW_OUTER_BLUR = 10;
export const ACTION_GLOW_OUTER_OPACITY = 0.28;
export const ACTION_GLOW_TRANSITION_MS = 600;

// ---- Climate setpoint / hero temperature ---------------------------------
// The ecosee reference builds its Home Screen out of exactly two ink levels:
// one dominant, near-weightless current temperature, and small "ovals" that
// carry the heat/cool colour as a thin outline over a faint same-colour wash
// (`reference/ecosee/src/screens/home-screen.ts`, `.oval`). Nothing on that
// screen is a solid block of colour — the equipment glow is the only saturated
// element. These numbers are that recipe, shared by both climate cards so the
// setpoint pill in the full card and the setpoint segment in the mini card
// cannot drift apart.
//
// The wash percentages feed `tintOn()` rather than a raw
// `color-mix(..., transparent)`: ecosee only ever paints on its own near-black
// canvas, while these cards sit on whatever theme (and wallpaper) the user has,
// so the mix has to be measured against the real surface.
export const SETPOINT_WASH_PERCENT = 9;
export const MODE_PILL_WASH_PERCENT = 8;
// How much of the mode colour survives in the outline. ecosee draws its ovals
// at full accent strength against a near-black canvas that can carry it; on a
// Home Assistant surface a full-strength 1.5px ring around the setpoint read
// as the loudest thing on the card, ahead of the figure it sits under. Pulled
// back toward the surface so the ring states the mode without announcing it.
export const SETPOINT_LINE_PERCENT = 34;
export const MODE_PILL_LINE_PERCENT = 26;
export const SETPOINT_BORDER_PX = 1;
export const MODE_PILL_BORDER_PX = 1;
// What the wash's ink has to reach. The setpoint oval holds a numeral drawn at
// 22px, so the WCAG floor for large text/graphics applies; the mode pill holds
// a 13px label, where 4.5 applies instead. Correcting both to 3 is what
// `test/contrast-audit.js` caught on the mode button — its labels came back at
// 3.01–3.23 in the light theme, i.e. exactly on a target that was too low.
export const SETPOINT_INK_TARGET = 3;
export const MODE_PILL_INK_TARGET = 4.5;

// The dominant current-temperature figure. ecosee sizes it at 42cqw of a fixed
// 460px canvas with nothing above it but a humidity line; this card also
// carries a header, a preset pill, the setpoint row and the mode pill, so the
// share of the width is roughly half that, clamped so it stays legible in a
// narrow column and never turns into a billboard in a wide one.
export const HERO_TEMP_CQW = 22;
export const HERO_TEMP_MIN_PX = 44;
export const HERO_TEMP_MAX_PX = 76;
// The `expressive` style inverts the weight relationship the `ecosee`
// reference used: a light numeral read as a weather-widget figure rather than
// a control, so the hero temperature carries the heaviest weight on the card
// (Roboto tops out at 700 statically; the design intent is 800, which the
// static face clamps to 700) with tight tracking, and the unit beside it
// drops to a light weight instead — see HERO_TEMP_UNIT_WEIGHT below.
export const HERO_TEMP_WEIGHT = 800;
export const HERO_TEMP_TRACKING = "-0.05em";
export const HERO_TEMP_LINE_HEIGHT = 0.86;
export const HERO_TEMP_UNIT_WEIGHT = 300;

// The `expressive` setpoint stepper: one connected row (round on the outside,
// tight on the inside) rather than the `tiles` style's two circular buttons
// either side of a floating pill. Both end buttons keep one corner pair at
// the outer radius and square the inner pair off against the value field.
export const EXPRESSIVE_STEPPER_OUTER_RADIUS_PX = 21;
export const EXPRESSIVE_STEPPER_INNER_RADIUS_PX = 8;
export const EXPRESSIVE_STEPPER_HEIGHT_PX = 42;
export const EXPRESSIVE_STEPPER_GAP_PX = 4;

// The mode/preset control row's shape carries state: a tighter radius while
// pressed or while its dropdown is open, easing back to the resting shape on
// release — the Expressive "shape morph" idiom, applied to the button this
// PR already has rather than to a hypothetical always-visible row of pills.
export const EXPRESSIVE_PILL_RADIUS_RESTING_PX = 19;
export const EXPRESSIVE_PILL_RADIUS_PRESSED_PX = 12;
export const EXPRESSIVE_PILL_MORPH_MS = 350;

// Resolves a base radius + optional per-corner overrides into a CSS
// border-radius value ("TL TR BR BL"), enabling Material 3 Expressive-style
// asymmetric shapes.
export function resolveCornerRadius(
  base: number,
  corners?: CornerRadiusConfig,
): string {
  const tl = corners?.top_left ?? base;
  const tr = corners?.top_right ?? base;
  const br = corners?.bottom_right ?? base;
  const bl = corners?.bottom_left ?? base;
  return `${tl}px ${tr}px ${br}px ${bl}px`;
}

export const DEFAULT_MODE_COLORS: Record<HvacMode, string> = {
  off: PALETTE.off,
  heat: PALETTE.heat,
  cool: PALETTE.cool,
  dry: PALETTE.dryAuto,
  auto: PALETTE.dryAuto,
  fan_only: PALETTE.fan,
  heat_cool: "#e5a768",
};

export const MODE_ICONS: Record<HvacMode, string> = {
  off: "mdi:power",
  heat: "mdi:fire",
  cool: "mdi:snowflake",
  dry: "mdi:water-percent",
  fan_only: "mdi:fan",
  auto: "mdi:refresh-auto",
  heat_cool: "mdi:sun-snowflake-variant",
};

export const PRESET_ICONS: Record<string, string> = {
  eco: "mdi:leaf",
  sleep: "mdi:sleep",
  boost: "mdi:rocket-launch",
  away: "mdi:bag-suitcase-outline",
  home: "mdi:home",
  comfort: "mdi:sofa",
  activity: "mdi:run",
  none: "mdi:tune-variant",
};

export const PRESET_ICON_FALLBACK = "mdi:tune-variant";

export const WINDOW_OPEN_COLOR = PALETTE.home;

export const DEFAULT_BATTERY_THRESHOLD = 20;

export const DEFAULT_TEMP_STEP = 0.5;

// A thermostat in heat/cool holds a band, so the climate card draws two
// stepper rows instead of one. They are separated by the standard row gap
// rather than the card's own 10px, so the pair still reads as one control
// for one target and not as two unrelated rows.
export const CLIMATE_BAND_ROW_GAP = SPACING.rowGap;

// Curated HA/tile-card-style color tokens. Anything not found here is used
// verbatim as a CSS color (hex, rgb(), CSS name, var(...), ...).
export const THEME_COLOR_TOKENS: Record<string, string> = {
  primary: "var(--primary-color)",
  accent: "var(--accent-color)",
  red: "#e57373",
  pink: "#f06292",
  purple: "#ba68c8",
  "deep-purple": "#9575cd",
  indigo: "#7986cb",
  blue: "#64b5f6",
  "light-blue": "#4fc3f7",
  cyan: "#4dd0e1",
  teal: "#4db6ac",
  green: "#81c784",
  "light-green": "#aed581",
  lime: "#dce775",
  yellow: "#fff176",
  amber: "#ffd54f",
  orange: "#ffb74d",
  "deep-orange": "#ff8a65",
  brown: "#a1887f",
  grey: "#bdbdbd",
  "dark-grey": "#616161",
  "blue-grey": "#90a4ae",
  black: "#000000",
  white: "#ffffff",
  disabled: "var(--disabled-text-color)",
  // German aliases for the same tokens above — editor fields are labeled in
  // German, so "grau" is a natural first guess and, unlike a real CSS color
  // name, silently invalidates the color-mix() it's used in (rendering as
  // no background at all) rather than erroring visibly.
  rot: "#e57373",
  rosa: "#f06292",
  lila: "#ba68c8",
  violett: "#ba68c8",
  blau: "#64b5f6",
  hellblau: "#4fc3f7",
  türkis: "#4dd0e1",
  tuerkis: "#4dd0e1",
  grün: "#81c784",
  gruen: "#81c784",
  hellgrün: "#aed581",
  hellgruen: "#aed581",
  gelb: "#fff176",
  braun: "#a1887f",
  grau: "#bdbdbd",
  dunkelgrau: "#616161",
  schwarz: "#000000",
  weiß: "#ffffff",
  weiss: "#ffffff",
};

export const DEFAULT_BUTTON_COLOR = "primary";
export const DEFAULT_BUTTON_RADIUS = RADIUS.card;

/**
 * Corner radius a button takes while it is off, when its shape follows the
 * entity's state. Large enough to round out into a capsule at any card height.
 */
export const BUTTON_SHAPE_OFF_RADIUS = 999;
/**
 * Corner radius while it is on, when the shape follows the state.
 *
 * Its own number rather than the card's usual radius, because that one is 28px
 * — which on a card a single grid row tall is exactly half the height, and so
 * already a capsule. Both states then computed correctly and looked identical.
 * An explicit `radius` still wins; this is only the default while shaping.
 */
export const BUTTON_SHAPE_ON_RADIUS = 16;
/**
 * Corner radius of the icon well while the entity is on, as a share of its own
 * size. A circle when off, a rounded square when on — the same pair of shapes
 * a phone's quick settings use, where the shape says as much as the colour.
 */
export const BUTTON_SHAPE_ON_ICON_RADIUS = "28%";
/** How long a button takes to change between the two shapes. */
export const BUTTON_SHAPE_MS = 300;

export const CLIMATE_RADIUS_PRESETS: Record<string, number> = {
  eckig: 12,
  leicht_rund: 20,
  rund: 32,
};

// Domains without a meaningful persistent "off" state — always render active/colored.
export const STATELESS_DOMAINS = new Set([
  "button",
  "script",
  "scene",
  "input_button",
]);

export const ACTIVE_STATES = new Set([
  "on",
  "open",
  "opening",
  "home",
  "playing",
  "true",
  "heat",
  "cool",
  "auto",
  "dry",
  "fan_only",
  "heat_cool",
  "locked",
  "active",
  "detected",
  "wet",
]);

// Friendly radius presets shown in the editor; "custom" reveals a raw px field.
export const RADIUS_PRESETS: Record<string, number> = {
  eckig: 8,
  leicht_rund: 16,
  rund: 28,
};

// A curated subset of ACTIVE_STATES offered as individual override fields in
// the editor. Any state string is still accepted at runtime via YAML.
export const EDITABLE_STATE_COLOR_KEYS = [
  "on",
  "open",
  "locked",
  "home",
  "playing",
  "active",
  "detected",
  "wet",
];

// Domains that expose a controllable numeric value the optional slider can drive.
export const SLIDER_DOMAINS = new Set([
  "light",
  "cover",
  "fan",
  "input_number",
  "number",
]);

export const DEFAULT_PROGRESS_RADIUS = RADIUS.card;

export const DEFAULT_RUNNING_STATES = [
  "wash",
  "waschen",
  "spin",
  "schleudern",
  "rinse",
  "spülen",
];
export const DEFAULT_PREPARING_STATES = ["beladungserkennung"];
export const DEFAULT_DONE_STATES = ["end", "beenden"];

export const DEFAULT_PROGRESS_ACCENT = PALETTE.home;

// M3 Expressive wavy progress indicator geometry/timing.
export const WAVE_AMPLITUDE = 3.5;
export const WAVE_WAVELENGTH = 24;
export const WAVE_PHASE_SPEED = 0.09;
export const WAVE_GAP = 12;
export const WAVE_DOT_RADIUS = 3.5;
export const INDETERMINATE_SEGMENT_FRACTION = 0.3;
export const INDETERMINATE_CYCLE_MS = 3000;

export const DEFAULT_ENERGY_RADIUS = RADIUS.card;
export const DEFAULT_ENERGY_ACCENT = PALETTE.ok;
export const DEFAULT_ENERGY_ICON = "mdi:lightning-bolt";
// `mode: consumption` isn't electricity-specific — a gas or water meter
// entity works just as well. Picks a sensible default icon from the
// entity's device_class when the user hasn't set one explicitly.
export const ENERGY_ICON_BY_DEVICE_CLASS: Record<string, string> = {
  gas: "mdi:fire",
  water: "mdi:water",
  energy: DEFAULT_ENERGY_ICON,
};
export const DEFAULT_ENERGY_DAYS = 7;
export const ENERGY_MIN_DAYS = 3;
export const ENERGY_MAX_DAYS = 14;
export const ENERGY_BAR_TINT_PERCENT = 28;
export const ENERGY_REFRESH_MS = 15 * 60 * 1000;

export const DEFAULT_ENERGY_HOURS = 6;
export const ENERGY_MIN_HOURS = 3;
export const ENERGY_MAX_HOURS = 24;
export const ENERGY_REFRESH_HOUR_MS = 5 * 60 * 1000;
// Above this many bars, the value row and every-other x-axis label are
// dropped to avoid the hour view becoming unreadably cramped.
export const ENERGY_DENSE_BAR_THRESHOLD = 12;

export const ENERGY_SOLAR_BAR_TINT_PERCENT = 30;
export const ENERGY_FORECAST_OUTLINE_OPACITY = 55;
export const ENERGY_SOLAR_LABEL_STEP = 3;
export const ENERGY_SOLAR_COMPARISON_DAYS = 7;
export const DEFAULT_SOLAR_ICON = "mdi:solar-power-variant";

export const DEFAULT_ENERGY_MONTHS = 12;
export const ENERGY_MIN_MONTHS = 3;
export const ENERGY_MAX_MONTHS = 24;
export const ENERGY_REFRESH_MONTH_MS = 60 * 60 * 1000;
export const ENERGY_MONTH_BAR_MAX_HEIGHT = 110;
export const ENERGY_MONTH_BAR_MIN_HEIGHT = 6;
export const ENERGY_MONTH_BAR_GAP = 5;
export const ENERGY_MONTH_BAR_RADIUS = 8;
export const ENERGY_PROJECTION_OUTLINE_OPACITY = 50;
export const ENERGY_MONTH_COMPARISON_BETTER_COLOR = PALETTE.ok;
export const ENERGY_MONTH_COMPARISON_WORSE_COLOR = PALETTE.heat;

// Evening default for the energy report: late enough that "today" is nearly
// complete, early enough that the push still gets read the same day. Also
// used for the month report (which fires on the 1st and reports the *closed*
// previous month, so the time of day doesn't affect its correctness).
export const DEFAULT_ENERGY_NOTIFY_TIME = "21:00:00";
// A utility_meter's cycle is derived from next_reset - last_reset; these are
// the tolerance bands that map that span onto "daily" / "monthly".

export const DEFAULT_FLOW_RADIUS = RADIUS.card;
export const DEFAULT_FLOW_ICON = "mdi:home-lightning-bolt-outline";
export const FLOW_NODE_PV_COLOR = PALETTE.solar;
export const FLOW_NODE_GRID_COLOR = PALETTE.grid;
export const FLOW_NODE_HOME_COLOR = PALETTE.home;
export const FLOW_NODE_BATTERY_COLOR = PALETTE.ok;
export const FLOW_SELF_SUFFICIENCY_COLOR = PALETTE.ok;
export const FLOW_REFRESH_MS = 5 * 60 * 1000;
export const FLOW_NODE_SIZE = 72;
export const FLOW_NODE_RX = 26;
export const FLOW_MIN_STROKE = 4;
export const FLOW_MAX_STROKE = 20;

type FlowSpeedKey = "slow" | "normal" | "fast";
export const FLOW_DOT_DURATION_MS: Record<FlowSpeedKey, number> = {
  slow: 3600,
  normal: 2400,
  fast: 1200,
};

export const DEFAULT_GAUGE_RADIUS = RADIUS.card;
export const DEFAULT_GAUGE_SEGMENT_A = PALETTE.grid;
export const DEFAULT_GAUGE_SEGMENT_B = PALETTE.ok;
export const GAUGE_GAP_DEGREES = 7;
export const GAUGE_STROKE_WIDTH = 18;
export const GAUGE_BOX_WIDTH = 240;
export const GAUGE_BOX_HEIGHT = 140;

export const DEFAULT_COUNTER_RADIUS = RADIUS.card;
export const DEFAULT_COUNTER_ICON = "mdi:counter";
export const DEFAULT_COUNTER_ACCENT = PALETTE.home;
export const DEFAULT_COUNTER_DECIMALS = 2;
export const DEFAULT_COUNTER_MIN_DIGITS = 5;
export const COUNTER_CELL_WIDTH = 34;
export const COUNTER_CELL_HEIGHT = 52;
export const COUNTER_CELL_NARROW_WIDTH = 26;
export const COUNTER_CELL_NARROW_HEIGHT = 42;
export const COUNTER_CELL_GAP = 3;
export const COUNTER_CELL_RADIUS = 12;
export const COUNTER_DIGIT_FONT_SIZE = 24;
export const COUNTER_DIGIT_FONT_SIZE_NARROW = 18;
export const COUNTER_NARROW_BREAKPOINT = 340;
export const COUNTER_ROLL_DURATION_MS = DURATION_MS.roll;
export const COUNTER_ROLL_STAGGER_MS = 180;
export const COUNTER_POWER_CHIP_COLOR = PALETTE.ok;

export const DEFAULT_POWER_LIST_RADIUS = RADIUS.card;
export const DEFAULT_POWER_LIST_ICON = "mdi:power-socket-de";
export const DEFAULT_POWER_LIST_ACCENT = PALETTE.home;
export const DEFAULT_POWER_LIST_PRODUCER_COLOR = PALETTE.solar;
export const DEFAULT_POWER_LIST_THRESHOLD = 1;
export const DEFAULT_POWER_LIST_NOTIFY_THRESHOLD = 10;
export const DEFAULT_POWER_LIST_NOTIFY_DURATION_HOURS = 3;
export const POWER_LIST_ROW_HEIGHT = HEIGHT.rowStandard;
export const POWER_LIST_ROW_RADIUS = RADIUS.row;
export const POWER_LIST_ROW_RADIUS_ACTIVE = RADIUS.rowActive;
export const POWER_LIST_IDLE_ROW_HEIGHT = 40;
export const POWER_LIST_IDLE_ROW_RADIUS = 14;
export const POWER_LIST_TOGGLE_HEIGHT = HEIGHT.toggle;
export const POWER_LIST_TOGGLE_RADIUS = RADIUS.row;
export const POWER_LIST_TOGGLE_RADIUS_OPEN = 14;
export const POWER_LIST_ICON_SIZE = 32;
export const POWER_LIST_ICON_RADIUS = RADIUS.squircle32;
export const POWER_LIST_ROW_GAP = SPACING.rowGap;
export const POWER_LIST_FLIP_DURATION_MS = DURATION_MS.flip;

export const DEFAULT_SUMMARY_RADIUS = RADIUS.card;
export const DEFAULT_SUMMARY_EXPORT_COLOR = PALETTE.ok;
export const DEFAULT_SUMMARY_IMPORT_COLOR = PALETTE.grid;
export const DEFAULT_SUMMARY_PRODUCER_COLOR = PALETTE.solar;
export const DEFAULT_SUMMARY_NEUTRAL_COLOR = PALETTE.off;
export const DEFAULT_SUMMARY_ZERO_THRESHOLD = 10;
export const DEFAULT_SUMMARY_KW_THRESHOLD = 1000;
export const SUMMARY_MAIN_ICON_SIZE = 52;
export const SUMMARY_MAIN_ICON_RADIUS = RADIUS.squircle52;
export const SUMMARY_CHIP_RADIUS = RADIUS.chip;
export const SUMMARY_SPLIT_BAR_HEIGHT = 12;
export const SUMMARY_SPLIT_BAR_RADIUS = 6;
export const SUMMARY_SPLIT_BAR_GAP = 3;
export const SUMMARY_METRIC_RADIUS = RADIUS.row;
export const SUMMARY_METRIC_RADIUS_ACTIVE = RADIUS.rowActive;
export const SUMMARY_METRIC_ICON_SIZE = 28;
export const SUMMARY_METRIC_ICON_RADIUS = RADIUS.squircle28;
export const SUMMARY_METRIC_MIN_WIDTH = 96;
export const SUMMARY_VALUE_LERP_MS = DURATION_MS.flip;

export const DEFAULT_TOP_CONSUMERS_RADIUS = RADIUS.card;
export const DEFAULT_TOP_CONSUMERS_ICON = "mdi:trophy-outline";
export const DEFAULT_TOP_CONSUMERS_ACCENT = PALETTE.home;
export const DEFAULT_TOP_CONSUMERS_COUNT = 3;
export const TOP_CONSUMERS_MIN_COUNT = 3;
export const TOP_CONSUMERS_MAX_COUNT = 15;
export const TOP_CONSUMERS_ROW_HEIGHT = HEIGHT.rowStandard;
export const TOP_CONSUMERS_ROW_RADIUS = RADIUS.row;
export const TOP_CONSUMERS_ROW_RADIUS_ACTIVE = RADIUS.rowActive;
export const TOP_CONSUMERS_ICON_SIZE = 32;
export const TOP_CONSUMERS_ICON_RADIUS = RADIUS.squircle32;
export const TOP_CONSUMERS_ROW_GAP = SPACING.rowGap;
export const TOP_CONSUMERS_REST_ROW_HEIGHT = HEIGHT.toggle;
export const TOP_CONSUMERS_REST_ROW_RADIUS = RADIUS.row;
export const TOP_CONSUMERS_REST_ROW_RADIUS_OPEN = 12;
export const TOP_CONSUMERS_COMPACT_ROW_HEIGHT = HEIGHT.rowCompact;
export const TOP_CONSUMERS_COMPACT_ROW_RADIUS = 14;
export const TOP_CONSUMERS_FLIP_DURATION_MS = DURATION_MS.flip;
export const TOP_CONSUMERS_REFRESH_MS = 15 * 60 * 1000;
export const DEFAULT_TOP_CONSUMERS_NAME_STRIP = ["^Steckdose \\d+ - ", " Energie$"];
export const DEFAULT_TOP_CONSUMERS_PALETTE = [
  "#85b7eb",
  "#e57368",
  "#5dcaa5",
  "#8f79e0",
  "#f0a24a",
  "#e5a768",
  "#b8c4c9",
  "#dce775",
];

export const DEFAULT_COST_RADIUS = RADIUS.card;
export const DEFAULT_COST_ICON = "mdi:cash-multiple";
export const DEFAULT_COST_ACCENT = PALETTE.solar;
export const DEFAULT_COST_CURRENCY = "EUR";
// Warn at 90 % of the budget: early enough to still react, late enough not to
// cry wolf every month.
export const DEFAULT_COST_NOTIFY_PERCENT = 90;
// Late on the last day of the month — the month-to-date counter resets at
// midnight, so the report has to run before that.
export const DEFAULT_COST_NOTIFY_TIME = "23:55:00";
export const COST_MAIN_ICON_SIZE = 52;
export const COST_MAIN_ICON_RADIUS = RADIUS.squircle52;
export const COST_CHIP_RADIUS = RADIUS.chip;
export const COST_BETTER_COLOR = PALETTE.ok;
export const COST_WORSE_COLOR = PALETTE.heat;
export const COST_BAR_HEIGHT = 76;
export const COST_BAR_GAP = 3;
export const COST_BAR_RADIUS = 5;
export const COST_BAR_MIN_HEIGHT = 5;
export const COST_TARIFF_ROW_HEIGHT = HEIGHT.rowStandard;
export const COST_TARIFF_ROW_RADIUS = RADIUS.row;
export const COST_TARIFF_ICON_SIZE = 30;
export const COST_TARIFF_ICON_RADIUS = RADIUS.squircle30;
export const COST_STEPPER_WIDTH = 44;
export const COST_STEPPER_HEIGHT = 52;
export const COST_STEPPER_RADIUS_OUTER = 26;
export const COST_STEPPER_RADIUS_INNER = 10;
export const COST_REFRESH_MS = 15 * 60 * 1000;

export const DEFAULT_LIGHT_RADIUS = RADIUS.card;
export const DEFAULT_LIGHT_ICON = "mdi:lightbulb";
export const DEFAULT_LIGHT_ACCENT = "#ffc773";
export const LIGHT_OFF_COLOR = PALETTE.off;
export const LIGHT_POWER_BTN_SIZE = 44;
export const LIGHT_POWER_BTN_RADIUS_ON = 22;
export const LIGHT_POWER_BTN_RADIUS_OFF = 15;
export const LIGHT_WAVE_HEIGHT = 56;
// Wave geometry mirrors the progress-card ("washing machine") bar so it reads
// as a clean wave, not a thick lump: a slim 6px stroke over a 3.5px-amplitude,
// 24px-wavelength sine. (Was 14px/4.5/26 — the fat stroke swallowed the wave.)
export const LIGHT_WAVE_AMPLITUDE = 3.5;
export const LIGHT_WAVE_WAVELENGTH = 24;
export const LIGHT_WAVE_PHASE_SPEED = 0.09;
export const LIGHT_WAVE_STROKE = 6;
export const LIGHT_WAVE_GAP = 12;
export const LIGHT_WAVE_AMPLITUDE_LERP = 0.12;
export const LIGHT_HANDLE_WIDTH = 6;
export const LIGHT_HANDLE_HEIGHT = 34;
export const LIGHT_HANDLE_RADIUS = 3;
export const LIGHT_THROTTLE_MS = 200;
export const LIGHT_DRAG_SETTLE_MS = 500;
export const LIGHT_MIN_BRIGHTNESS_PCT = 1;

// Fallback kelvin range for entities that don't report
// min/max_color_temp_kelvin (rare, but some legacy integrations only expose
// mireds or nothing at all).
export const LIGHT_COLOR_TEMP_MIN_KELVIN = 2000;
export const LIGHT_COLOR_TEMP_MAX_KELVIN = 6500;
export const LIGHT_COLOR_TEMP_PRESET_WARM = 2700;
export const LIGHT_COLOR_TEMP_PRESET_NEUTRAL = 4000;
export const LIGHT_COLOR_TEMP_PRESET_COLD = 6500;

export const LIGHT_WHEEL_SIZE = 160;
export const LIGHT_WHEEL_HANDLE_SIZE = 22;
export const LIGHT_PALETTE_SWATCH_SIZE = 32;
export const LIGHT_SCENE_CHIP_HEIGHT = 34;
export const LIGHT_MEMBER_ROW_HEIGHT = 44;

export const DEFAULT_BATTERY_RADIUS = RADIUS.card;
export const DEFAULT_BATTERY_ICON_OK = "mdi:battery-70";
export const DEFAULT_BATTERY_ICON_CRITICAL = "mdi:battery-alert-variant-outline";
// Deliberately lower than the "critical" display stage: the card colors a
// battery red well before it dies, but a push notification should only fire
// when it actually needs swapping.
export const DEFAULT_BATTERY_NOTIFY_THRESHOLD = 1;
export const DEFAULT_BATTERY_THRESHOLD_CRITICAL = 10;
export const DEFAULT_BATTERY_THRESHOLD_LOW = 20;
export const DEFAULT_BATTERY_THRESHOLD_MEDIUM = 40;
export const BATTERY_COLOR_CRITICAL = PALETTE.heat;
export const BATTERY_COLOR_LOW = PALETTE.solar;
export const BATTERY_COLOR_MEDIUM = PALETTE.light;
export const BATTERY_COLOR_OK = PALETTE.ok;
export const BATTERY_COLOR_UNAVAILABLE = PALETTE.off;
export const BATTERY_ROW_HEIGHT = HEIGHT.rowTall;
export const BATTERY_ROW_RADIUS = RADIUS.row;
export const BATTERY_ROW_RADIUS_ACTIVE = RADIUS.rowActive;
export const BATTERY_ICON_SIZE = 32;
export const BATTERY_ICON_RADIUS = RADIUS.squircle32;
export const BATTERY_ROW_GAP = SPACING.rowGap;
export const BATTERY_BAR_HEIGHT = 6;
export const BATTERY_BAR_RADIUS = 3;
export const BATTERY_BAR_MIN_WIDTH = 6;
export const BATTERY_CHIP_RADIUS = RADIUS.chip;
export const BATTERY_COMPACT_ROW_HEIGHT = HEIGHT.rowCompact;
export const BATTERY_COMPACT_ROW_RADIUS = 14;
export const BATTERY_TOGGLE_HEIGHT = HEIGHT.toggle;
export const BATTERY_TOGGLE_RADIUS = RADIUS.row;
export const BATTERY_TOGGLE_RADIUS_OPEN = 14;
export const BATTERY_FLIP_DURATION_MS = DURATION_MS.flip;
export const DEFAULT_BATTERY_NAME_STRIP = [
  " Battery Level$",
  " Batteriestand$",
  " Battery$",
  " Batterie$",
];

// ---- Weather card -----------------------------------------------------------
export const DEFAULT_WEATHER_RADIUS = RADIUS.card;
export const DEFAULT_WEATHER_HOURS = 12;
export const DEFAULT_WEATHER_DAYS = 0;
export const DEFAULT_WEATHER_ACCENT = PALETTE.solar;
export const DEFAULT_WEATHER_PRECIPITATION_COLOR = "#6ba7dc";
export const DEFAULT_WEATHER_CHIPS: WeatherChipType[] = [
  "apparent_temperature",
  "wind_speed",
  "humidity",
];
export const WEATHER_HEADER_ICON_SIZE = 56;
export const WEATHER_HEADER_ICON_RADIUS = RADIUS.squircle56;
export const WEATHER_CHIP_RADIUS = RADIUS.chip;
export const WEATHER_DAY_ROW_HEIGHT = 44;
export const WEATHER_DAY_ROW_RADIUS = RADIUS.row;
export const WEATHER_PRECIP_BAR_MAX_HEIGHT = 28;
export const WEATHER_PRECIP_BAR_RADIUS = 6;
export const WEATHER_PRECIP_MIN_SCALE_MM = 1;
export const WEATHER_CURVE_STROKE = 2.5;
export const WEATHER_CURVE_DRAW_MS = 600;
export const WEATHER_HOUR_DOT_STRIDE = 3;
export const WEATHER_REFRESH_MS = 15 * 60 * 1000;
export const WEATHER_CHART_HEIGHT = 130;
export const WEATHER_DAILY_COLLAPSED_COUNT = 3;
export const WEATHER_DAYS_TOGGLE_HEIGHT = HEIGHT.toggle;
export const WEATHER_DAYS_TOGGLE_RADIUS = RADIUS.row;
export const WEATHER_DAYS_TOGGLE_RADIUS_OPEN = 14;

// ---- Presence card ------------------------------------------------------------
export const DEFAULT_PRESENCE_RADIUS = RADIUS.card;
export const DEFAULT_PRESENCE_ICON = "mdi:account-group";
export const PRESENCE_AVATAR_SIZE = 56;
export const PRESENCE_AVATAR_RADIUS = RADIUS.squircle56;
export const PRESENCE_DOT_SIZE = 14;
export const PRESENCE_RING_WIDTH = 2.5;
export const PRESENCE_GRID_GAP = 10;
export const PRESENCE_GRID_MIN_COL = 84;
export const PRESENCE_COLOR_HOME = PALETTE.ok;
export const PRESENCE_COLOR_NOT_HOME = PALETTE.home;
export const PRESENCE_COLOR_ZONE = PALETTE.media;
export const PRESENCE_COLOR_UNKNOWN = "#8f8b86";

// ---- Climate overview card --------------------------------------------------
export const DEFAULT_CLIMATE_OVERVIEW_RADIUS = RADIUS.card;
export const DEFAULT_CLIMATE_OVERVIEW_ICON = "mdi:thermometer";
export const CLIMATE_OVERVIEW_GRID_GAP = 8;
export const CLIMATE_OVERVIEW_GRID_MIN_COL = 104;
export const CLIMATE_OVERVIEW_TILE_RADIUS = 18;
export const DEFAULT_CLIMATE_OVERVIEW_TEMP_THRESHOLDS: Required<ClimateOverviewTempThresholds> = {
  cold: 19,
  cool: 20.5,
  comfortable: 23.5,
  warm: 25,
};
export const DEFAULT_CLIMATE_OVERVIEW_HUMIDITY_RANGE: [number, number] = [35, 65];
export const CLIMATE_OVERVIEW_COLOR_COLD = PALETTE.cool;
export const CLIMATE_OVERVIEW_COLOR_COOL = "#7fc4d6";
export const CLIMATE_OVERVIEW_COLOR_COMFORTABLE = PALETTE.dryAuto;
export const CLIMATE_OVERVIEW_COLOR_WARM = PALETTE.light;
export const CLIMATE_OVERVIEW_COLOR_HOT = PALETTE.heat;
export const CLIMATE_OVERVIEW_HUMIDITY_WARN_COLOR = PALETTE.solar;
export const DEFAULT_CLIMATE_OVERVIEW_NAME_STRIP = [
  " Temperature$",
  " Temperatur$",
  "^Thermometer\\s*\\d*\\s*-?\\s*",
  "^Thermostat\\s+",
];
export const CLIMATE_OVERVIEW_SCALE_MIN_SPAN = 8;
/**
 * Label sizing for the comparison scale. Widths are estimated rather than
 * measured per label: at 9px the average glyph is about 5px, and the estimate
 * only has to be good enough to decide whether two names collide.
 */
export const CLIMATE_OVERVIEW_LABEL_CHAR_PX = 5;
export const CLIMATE_OVERVIEW_LABEL_MAX_PX = 70;
export const CLIMATE_OVERVIEW_LABEL_GAP_PX = 8;
export const CLIMATE_OVERVIEW_DOT_SIZE = 14;
export const CLIMATE_OVERVIEW_DOT_RADIUS = 5;
export const CLIMATE_OVERVIEW_DOT_TRANSITION_MS = DURATION_MS.flip;
export const CLIMATE_OVERVIEW_CHIP_RADIUS = RADIUS.chip;
export const CLIMATE_OVERVIEW_TREND_REFRESH_MS = 15 * 60 * 1000;
export const CLIMATE_OVERVIEW_TREND_THRESHOLD_K = 0.5;
export const CLIMATE_OVERVIEW_MOLD_HUMIDITY_THRESHOLD = 65;
export const CLIMATE_OVERVIEW_MOLD_TEMP_THRESHOLD = 18;

// ---- Media card -----------------------------------------------------------
export const DEFAULT_MEDIA_RADIUS = RADIUS.card;
export const DEFAULT_MEDIA_ACCENT = PALETTE.media;
export const MEDIA_ARTWORK_SIZE = 88;
export const MEDIA_ARTWORK_RADIUS = 24;
// Transport bar. The play/pause button is the row's state indicator: a
// squircle while playing, morphing to a full circle when paused. Every icon is
// an inline SVG (see shared/icons.ts), so the icon sizes are explicit here
// rather than coming from --mdc-icon-size.
export const MEDIA_PLAY_BTN_SIZE = 62;
export const MEDIA_PLAY_BTN_RADIUS_PLAYING = 22;
export const MEDIA_PLAY_BTN_RADIUS_PAUSED = MEDIA_PLAY_BTN_SIZE / 2;
export const MEDIA_PLAY_ICON_SIZE = 30;
export const MEDIA_TRANSPORT_BTN_SIZE = 48;
export const MEDIA_TRANSPORT_BTN_RADIUS = 24;
export const MEDIA_TRANSPORT_ICON_SIZE = 24;
export const MEDIA_PILL_BTN_SIZE = 40;
export const MEDIA_PILL_BTN_RADIUS = 20;
export const MEDIA_PILL_ICON_SIZE = 20;
// The play/pause glyph cross-fades over the same duration as the radius morph,
// so the button reads as one gesture rather than two overlapping ones.
export const MEDIA_ICON_MORPH_MS = 350;
// Playback progress is a wavy indicator in the progress-card ("washing
// machine") form: a wave for the elapsed part, a gap, a straight track, and a
// dot at the far end. The wave flattens to a straight line when playback is
// paused, so the bar itself carries the play state.
export const MEDIA_PROGRESS_HEIGHT = 20;
export const MEDIA_PROGRESS_STROKE = 5;
export const MEDIA_PROGRESS_AMPLITUDE = 2.6;
export const MEDIA_PROGRESS_WAVELENGTH = 20;
export const MEDIA_PROGRESS_GAP = 8;
export const MEDIA_PROGRESS_DOT_RADIUS = 4;
export const MEDIA_PROGRESS_HANDLE_RADIUS = 6;
// Per-frame easing of the amplitude toward its target, matching the light
// card's wave. Low enough that pausing reads as the wave settling flat rather
// than snapping.
export const MEDIA_PROGRESS_AMPLITUDE_LERP = 0.1;
export const MEDIA_PROGRESS_PHASE_SPEED = 0.06;
// A stream with no duration cannot show a position, so a short segment of
// wave travels the bar instead.
export const MEDIA_INDETERMINATE_FRACTION = 0.28;
export const MEDIA_INDETERMINATE_CYCLE_MS = 2200;
// Seeks are throttled while dragging so a scrub does not flood the player.
export const MEDIA_SEEK_THROTTLE_MS = 200;
// Every transport button briefly morphs to this radius when tapped.
export const MEDIA_PRESS_RADIUS = 14;
export const MEDIA_VOLUME_WAVE_HEIGHT = 44;
// Wavy volume bar geometry, matching the progress-card ("washing machine")
// form: a visible wave, a gap, a straight track, and a round end-dot.
export const MEDIA_VOLUME_AMPLITUDE = 3.5;
export const MEDIA_VOLUME_WAVELENGTH = 24;
export const MEDIA_VOLUME_GAP = 10;
export const MEDIA_VOLUME_DOT_RADIUS = 4;
export const MEDIA_VOLUME_THROTTLE_MS = 200;
export const MEDIA_MUTE_BTN_HEIGHT = 40;
export const MEDIA_ARTWORK_COLOR_CACHE_SIZE = 20;
// Artwork is sampled at this resolution before the dominant colour is picked.
export const MEDIA_ARTWORK_SAMPLE_SIZE = 32;
// Hue is bucketed at 20° so shades of one colour count as the same hue.
export const MEDIA_ARTWORK_HUE_BUCKETS = 18;
// Pixels outside this lightness band are backdrop, not subject: near-black and
// near-white dominate most covers by area and say nothing about their colour.
export const MEDIA_ARTWORK_MIN_LIGHTNESS = 0.12;
export const MEDIA_ARTWORK_MAX_LIGHTNESS = 0.92;
// Below this saturation a pixel counts as grey and carries no hue vote.
export const MEDIA_ARTWORK_MIN_SATURATION = 0.15;
// The accent is distributed as a CSS variable; the properties that consume it
// cross-fade over this so buttons and waves never jump on a track change.
export const MEDIA_ACCENT_FADE_MS = 400;

// Meta chips under the title. Deliberately shorter than the suite's standard
// chip (RADIUS.chip / 15px) — these sit directly under two text lines and a
// full-height chip would crowd them.
export const MEDIA_CHIP_HEIGHT = 24;
export const MEDIA_CHIP_RADIUS = 9;

// Browser section (queue + library). The toggle row is the same shape as the
// list rows elsewhere in the suite; the tab pills morph to a tighter radius
// when active, like the todo card's chips.
export const MEDIA_BROWSE_TOGGLE_HEIGHT = 44;
export const MEDIA_BROWSE_TOGGLE_RADIUS = 19;
export const MEDIA_BROWSE_TAB_HEIGHT = 32;
export const MEDIA_BROWSE_TAB_RADIUS = 16;
export const MEDIA_BROWSE_TAB_RADIUS_ACTIVE = 10;
export const MEDIA_BROWSE_ROW_HEIGHT = 46;
export const MEDIA_BROWSE_ROW_RADIUS = 15;
export const MEDIA_BROWSE_ROW_ICON_SIZE = 32;
export const MEDIA_BROWSE_ROW_ICON_RADIUS = RADIUS.squircle32;
export const DEFAULT_MEDIA_BROWSE_HEIGHT = 190;
// Skeleton rows shown while a browse level loads — a fixed count reads as a
// list taking shape, where a spinner reads as "something might be wrong".
export const MEDIA_BROWSE_SKELETON_ROWS = 4;
// A directory can hold thousands of entries (a real library here has 2147
// artist folders); rendering them all locks the frame. Rows beyond this are
// reachable by drilling in, not by scrolling forever.
export const MEDIA_BROWSE_MAX_ROWS = 100;
// Minimum WCAG contrast the accent must reach against the dark on-accent ink.
// Artwork-derived accents are NOT guaranteed to be light pastels the way the
// built-in palette is, so the extracted color is lightened until a filled
// button's glyph is actually legible. 3:1 is the AA bar for large graphics.
export const MEDIA_ACCENT_MIN_CONTRAST = 3.2;

// ---- Aquarium card ----------------------------------------------------------
export const DEFAULT_AQUARIUM_RADIUS = RADIUS.card;
export const DEFAULT_AQUARIUM_ICON = "mdi:fishbowl-outline";
export const DEFAULT_AQUARIUM_ACCENT = PALETTE.dryAuto;
export const DEFAULT_AQUARIUM_TARGET_RANGE: [number, number] = [24, 26];
export const DEFAULT_AQUARIUM_CLEANING_INTERVAL_DAYS = 14;
export const DEFAULT_AQUARIUM_CAMERA_REFRESH_S = 10;
// Deliberately deviates from the shared squircle scale (tokens.ts only has
// 44/16) — the reference design's header icon is a size/radius pair unique
// to this card.
export const AQUARIUM_HEADER_ICON_SIZE = 46;
export const AQUARIUM_HEADER_ICON_RADIUS = 17;
export const AQUARIUM_TILE_GAP = 6;
export const AQUARIUM_TILE_MIN_COL = 64;
export const AQUARIUM_TILE_RADIUS_OFF = 19;
export const AQUARIUM_TILE_RADIUS_ON = 13;
export const AQUARIUM_TILE_ICON_BOX = 28;
export const AQUARIUM_TILE_ICON_RADIUS_OFF = 14;
export const AQUARIUM_TILE_ICON_RADIUS_ON = 9;
export const AQUARIUM_TILE_MORPH_MS = 350;
export const AQUARIUM_WATER_COLOR_OK = PALETTE.dryAuto;
export const AQUARIUM_WATER_COLOR_BELOW = PALETTE.cool;
export const AQUARIUM_WATER_COLOR_ABOVE = PALETTE.light;
export const AQUARIUM_WATER_COLOR_WARN = PALETTE.heat;
export const AQUARIUM_WATER_WARN_DEVIATION_K = 1;
// The schedule bar shares its shape with the Expressive level slider in
// shared/level-slider.ts — a thick track, a straight-line marker, and a gap
// either side of it. It is the same idea drawn twice (a position on a scale),
// so it takes the same numbers rather than a second set four pixels off.
export const AQUARIUM_SCHEDULE_TRACK_HEIGHT = LEVEL_TRACK_HEIGHT;
export const AQUARIUM_SCHEDULE_TRACK_RADIUS = LEVEL_TRACK_RADIUS;
export const AQUARIUM_SCHEDULE_MARKER_WIDTH = LEVEL_HANDLE_WIDTH;
export const AQUARIUM_SCHEDULE_MARKER_HEIGHT = LEVEL_HANDLE_HEIGHT;
export const AQUARIUM_SCHEDULE_MARKER_RADIUS = LEVEL_HANDLE_RADIUS;
/** Cut out of the phases either side of the marker, as on the slider. */
export const AQUARIUM_SCHEDULE_GAP = LEVEL_TRACK_GAP;
/** Keeps the marker inside the track at midnight and at midnight again. */
export const AQUARIUM_SCHEDULE_INSET = LEVEL_EDGE_INSET;
export const AQUARIUM_SCHEDULE_REFRESH_MS = 60 * 1000;
export const AQUARIUM_CAMERA_BANNER_RADIUS = 20;
export const AQUARIUM_CAMERA_BANNER_PADDING = 10;
export const AQUARIUM_CAMERA_THUMB_SIZE = 56;
export const AQUARIUM_CAMERA_THUMB_RADIUS = 19;
export const AQUARIUM_CAMERA_THUMB_RADIUS_ACTIVE = 13;
export const AQUARIUM_CAMERA_LIVE_DOT_SIZE = 8;
export const AQUARIUM_CAMERA_EXPAND_MS = 350;
export const AQUARIUM_CAMERA_BADGE_HEIGHT = 24;
export const AQUARIUM_CAMERA_BADGE_RADIUS = 9;
export const AQUARIUM_CAMERA_CHIP_HEIGHT = 28;
export const AQUARIUM_CAMERA_CHIP_RADIUS = 11;
export const AQUARIUM_CHIP_HEIGHT = 28;
export const AQUARIUM_CHIP_RADIUS = 14;
export const AQUARIUM_CHIP_MAX = 4;
export const DEFAULT_AQUARIUM_DEVICE_COLORS = {
  light_day: PALETTE.light,
  light_night: PALETTE.grid,
  pump: PALETTE.cool,
  heater: PALETTE.heat,
  co2: PALETTE.dryAuto,
  cleaning: PALETTE.cover,
  camera: PALETTE.media,
} as const;

export const DEFAULT_UPDATES_RADIUS = RADIUS.card;
export const DEFAULT_UPDATES_ICON = "mdi:package-up";
export const DEFAULT_UPDATES_MAX_VISIBLE = 5;
export const DEFAULT_UPDATES_BACKUP_WARN_DAYS = 7;

export const UPDATES_COLOR_OK = "#81c784";
export const UPDATES_COLOR_AVAILABLE = "#85b7eb";
export const UPDATES_COLOR_ADDON = "#a58fe8";
export const UPDATES_COLOR_HACS = "#5dcaa5";
export const UPDATES_COLOR_FIRMWARE = "#f0a24a";
export const UPDATES_COLOR_REMOTE = "#8fa3b8";
export const UPDATES_COLOR_BACKUP_WARN = "#f0a24a";
export const UPDATES_COLOR_BACKUP_MISSING = "#e57368";

export const UPDATES_CHIP_HEIGHT = 30;
export const UPDATES_CHIP_RADIUS = 15;
export const UPDATES_CORE_PADDING = 13;
export const UPDATES_CORE_RADIUS = 20;
export const UPDATES_CORE_ICON_SIZE = 38;
export const UPDATES_CORE_ICON_RADIUS = 14;
export const UPDATES_ROW_HEIGHT = 48;
export const UPDATES_ROW_RADIUS = 16;
export const UPDATES_ROW_ICON_SIZE = 30;
export const UPDATES_ROW_ICON_RADIUS = 11;
export const UPDATES_TOGGLE_HEIGHT = 44;
export const UPDATES_TOGGLE_RADIUS = 18;
export const UPDATES_COMPACT_ROW_HEIGHT = 36;
export const UPDATES_COMPACT_ROW_RADIUS = 14;
// ---- M3 NAS Card ----------------------------------------------------
export const DEFAULT_NAS_RADIUS = RADIUS.card;
export const DEFAULT_NAS_ICON = "mdi:nas";
export const DEFAULT_NAS_MAX_VISIBLE = 4;
/** Percent full at which a volume turns amber / red. */
export const DEFAULT_NAS_DISK_WARN = 80;
export const DEFAULT_NAS_DISK_CRITICAL = 90;
/** Drive temperature considered warm / hot, in °C. */
export const DEFAULT_NAS_TEMP_WARN = 55;
export const DEFAULT_NAS_TEMP_CRITICAL = 65;

export const NAS_COLOR_OK = "#81c784";
export const NAS_COLOR_WARN = "#f0a24a";
export const NAS_COLOR_CRITICAL = "#e57368";
export const NAS_COLOR_OFFLINE = "#8fa3b8";
export const NAS_COLOR_ACCENT = "#85b7eb";

export const NAS_ROW_HEIGHT = 52;
export const NAS_ROW_RADIUS = 18;
export const NAS_ROW_RADIUS_ACTIVE = 12;
export const NAS_ICON_SIZE = 34;
export const NAS_ICON_RADIUS = 12;
export const NAS_ROW_GAP = 6;
export const NAS_TILE_RADIUS = 16;
export const NAS_TILE_PADDING = 10;
export const NAS_TOGGLE_HEIGHT = 44;
export const NAS_TOGGLE_RADIUS = 18;
export const DEFAULT_NAS_NOTIFY_DISK = 90;
/** How long Glances must stay silent before the NAS counts as offline. */
export const DEFAULT_NAS_OFFLINE_MINUTES = 10;

export const UPDATES_BUTTON_SIZE = 38;
export const UPDATES_BUTTON_RADIUS = 19;
/** Radius the install button morphs to while it runs. */
export const UPDATES_BUTTON_RADIUS_BUSY = 12;
export const UPDATES_PROGRESS_HEIGHT = 3;
/** How long an armed "are you sure?" button stays armed. */
export const UPDATES_CONFIRM_TIMEOUT_MS = 5000;

// Default display order; group_order may override it.
export const UPDATES_GROUP_ORDER = [
  "core", "os", "supervisor", "addon", "hacs", "firmware", "remote", "other",
] as const;

// Zigbee/device firmware flashing can brick hardware, so these are listed
// read-only by default and installed deliberately from the device page.
export const DEFAULT_UPDATES_NO_INSTALL: string[] = ["firmware"];

// ---- Supply card ----------------------------------------------------------
export const DEFAULT_SUPPLY_RADIUS = RADIUS.card;
export const DEFAULT_SUPPLY_ICON = "mdi:package-variant-closed";
export const DEFAULT_SUPPLY_PACK_SIZE = 24;
// Reference design: the hero header uses a slightly larger squircle than the
// shared 44px card-header, matching the cost/summary "hero" scale.
export const SUPPLY_HERO_ICON_SIZE = 46;
export const SUPPLY_HERO_ICON_RADIUS = 17;
export const SUPPLY_ROW_HEIGHT = 48;
export const SUPPLY_ROW_RADIUS = 16;
export const SUPPLY_ICON_SIZE = 30;
export const SUPPLY_ICON_RADIUS = RADIUS.squircle30;
export const SUPPLY_ROW_GAP = SPACING.rowGap;
// Above this pack size a per-unit dot row stops being readable (dots get
// thinner than their gap), so the hero switches to a single filled bar.
export const SUPPLY_DOTS_MAX = 40;
export const SUPPLY_DOT_HEIGHT = 12;
export const SUPPLY_DOT_RADIUS = 4;
export const SUPPLY_DOT_GAP = 3;
export const SUPPLY_BAR_HEIGHT = 12;
export const SUPPLY_BAR_RADIUS = 6;
export const SUPPLY_ACTION_HEIGHT = 52;
export const SUPPLY_ACTION_GAP = 8;
export const SUPPLY_STEPPER_WIDTH = 56;
// Asymmetric stepper corners, mirrored left/right around the centre button —
// same shape language as the climate card's temperature stepper.
export const SUPPLY_STEPPER_RADIUS_OUTER = 26;
export const SUPPLY_STEPPER_RADIUS_INNER = 11;
export const SUPPLY_REFILL_RADIUS = 11;
export const SUPPLY_REFILL_RADIUS_ACTIVE = 22;
export const SUPPLY_REFILL_MORPH_MS = 400;
export const SUPPLY_REPEAT_MS = 300;
export const SUPPLY_COLOR_OK = PALETTE.home;
export const SUPPLY_COLOR_LOW = PALETTE.solar;
export const SUPPLY_COLOR_CRITICAL = PALETTE.heat;
export const SUPPLY_COLOR_UNAVAILABLE = PALETTE.off;
// Fractions of pack_size used when an item sets no explicit thresholds.
export const SUPPLY_LOW_FRACTION = 0.25;
export const SUPPLY_CRITICAL_FRACTION = 0.1;
// A floor of 1, not 3: with a floor of 3 every pack of 30 or fewer would sit
// at "critical" from the moment it is opened — a 4-filter pack would never
// leave the red state at all.
export const SUPPLY_CRITICAL_FLOOR = 1;
export const SUPPLY_DEFAULT_RATE_WINDOW_DAYS = 30;
// Below this many observed decrements the sample is too thin to extrapolate
// a range from, so the subtitle falls back to a plain "{n} of {max}".
export const SUPPLY_MIN_EVENTS = 3;
// Three taps on "−" in one sitting satisfy MIN_EVENTS but span minutes, and
// dividing by minutes yields a rate of hundreds per day. An estimate needs to
// have watched for at least this long before it means anything.
export const SUPPLY_MIN_SPAN_DAYS = 2;
// Consumption shifts over days, not minutes; the counter value itself already
// updates live via hass, so re-reading history hourly is more than enough.
export const SUPPLY_RATE_REFRESH_MS = 60 * 60 * 1000;
// Hero swap: rows glide to their new slot while the new hero fades in. Shares
// the suite's FLIP duration so reordering feels the same across every card.
export const SUPPLY_FLIP_DURATION_MS = DURATION_MS.flip;
export const SUPPLY_CHIP_RADIUS = RADIUS.chip;

// ---- Todo card ------------------------------------------------------------
export const DEFAULT_TODO_RADIUS = RADIUS.card;
export const DEFAULT_TODO_ICON = "mdi:cart-outline";
export const DEFAULT_TODO_ACCENT = PALETTE.dryAuto;
export const TODO_HEADER_ICON_SIZE = 46;
export const TODO_HEADER_ICON_RADIUS = 17;
export const TODO_COUNT_CHIP_SIZE = 30;
export const TODO_COUNT_CHIP_RADIUS = RADIUS.chip;
// Input field and its add button share a height so the row reads as one unit.
export const TODO_INPUT_HEIGHT = 50;
export const TODO_INPUT_RADIUS = 25;
export const TODO_INPUT_RADIUS_FOCUS = 16;
export const TODO_ADD_BUTTON_SIZE = 50;
export const TODO_ADD_BUTTON_RADIUS = 18;
export const TODO_ADD_BUTTON_RADIUS_ACTIVE = 12;
export const TODO_ROW_HEIGHT = 50;
export const TODO_ROW_RADIUS = 17;
export const TODO_ROW_GAP = SPACING.rowGap;
export const TODO_CHECK_SIZE = 24;
// The checkbox morphs from a ring (circle) to a filled squircle when ticked.
export const TODO_CHECK_RADIUS_OPEN = 12;
export const TODO_CHECK_RADIUS_DONE = 7;
export const TODO_CHECK_MORPH_MS = 350;
export const TODO_TOGGLE_HEIGHT = 42;
export const TODO_TOGGLE_RADIUS = 18;
export const TODO_TOGGLE_RADIUS_OPEN = 12;
export const TODO_DONE_ROW_HEIGHT = 40;
export const TODO_DONE_ROW_RADIUS = 14;
export const TODO_QUICK_CHIP_HEIGHT = 30;
export const TODO_QUICK_CHIP_RADIUS = RADIUS.chip;
export const TODO_QUICK_CHIP_RADIUS_ACTIVE = 9;
export const TODO_QUICK_MORPH_MS = 400;
export const TODO_DEFAULT_MAX_QUICK_ADD = 4;
// How long "clear completed" stays armed after the first tap before it
// quietly disarms itself again.
export const TODO_CLEAR_ARM_MS = 4000;
// Long press to rename. Long enough not to fire on a normal tap-to-tick,
// short enough not to feel like the card is ignoring you.
export const TODO_LONG_PRESS_MS = 500;

// ---- Time card ------------------------------------------------------------
export const DEFAULT_TIME_RADIUS = RADIUS.card;
export const DEFAULT_TIME_ICON = "mdi:clock-outline";
export const DEFAULT_TIME_ACCENT = PALETTE.home;
export const DEFAULT_TIME_MINUTE_STEP = 5;
export const TIME_MINUTE_STEPS = [1, 5, 10, 15, 30] as const;
export const TIME_HEADER_ICON_SIZE = 42;
export const TIME_HEADER_ICON_RADIUS = 15;
// Stepper column: a short button, a tall value field, a short button. The
// outer corners stay round while the inner ones tuck in, so the three read as
// one control rather than three separate buttons.
export const TIME_FIELD_WIDTH = 62;
export const TIME_FIELD_HEIGHT = 62;
export const TIME_FIELD_RADIUS = 20;
export const TIME_STEP_BUTTON_HEIGHT = 30;
export const TIME_STEP_RADIUS_OUTER = 15;
export const TIME_STEP_RADIUS_INNER = 8;
export const TIME_DIGIT_FONT_SIZE = 30;
export const TIME_SEPARATOR_FONT_SIZE = 26;
export const TIME_APPLY_HEIGHT = 46;
export const TIME_APPLY_RADIUS = 23;
export const TIME_APPLY_RADIUS_ACTIVE = 14;
export const TIME_APPLY_MORPH_MS = 400;
// Long press: steady at first, then faster once it is clearly a hold rather
// than a slow tap.
export const TIME_REPEAT_MS = 300;
export const TIME_REPEAT_FAST_MS = 120;
export const TIME_REPEAT_ACCELERATE_AFTER_MS = 1000;
// Below this width the 62px fields crowd the separator out.
export const TIME_NARROW_BREAKPOINT = 280;
export const TIME_FIELD_WIDTH_NARROW = 52;
// Typing digits into a field: how long a half-entered number waits for its
// second digit before it stands on its own.
export const TIME_DIGIT_BUFFER_MS = 900;
export const TIME_INSTANT_DEBOUNCE_MS = 800;
// Compact variant: header on the left, a minus/value/plus unit on the right.
// Outer corners round, inner ones tucked in, same shape logic as the stepper.
export const TIME_COMPACT_BUTTON_WIDTH = 38;
export const TIME_COMPACT_HEIGHT = 44;
export const TIME_COMPACT_RADIUS_OUTER = 22;
export const TIME_COMPACT_RADIUS_INNER = 9;
export const TIME_COMPACT_VALUE_FONT_SIZE = 20;
export const TIME_PRESET_HEIGHT = 34;
export const TIME_PRESET_RADIUS = 17;
export const TIME_PRESET_RADIUS_ACTIVE = 11;
// The compact variant defaults to a bigger jump: it is the "set it roughly"
// layout, where 5-minute steps would mean a lot of tapping.
export const DEFAULT_TIME_MINUTE_STEP_COMPACT = 15;
// Wheel variant: a 132px window over 40px entries, so three are visible and
// the middle one sits in the selection band. The 46px pads above and below
// let the first and last entry reach that band.
export const TIME_WHEEL_HEIGHT = 132;
export const TIME_WHEEL_RADIUS = 20;
export const TIME_WHEEL_ITEM_HEIGHT = 40;
export const TIME_WHEEL_PAD = 46;
export const TIME_WHEEL_BAND_RADIUS = 14;
export const TIME_WHEEL_ACTIVE_FONT_SIZE = 22;
export const TIME_WHEEL_IDLE_FONT_SIZE = 20;
// How long the wheel must sit still before its position counts as a choice.
export const TIME_WHEEL_SETTLE_MS = 140;
// Counter card: the inline "correct the reading" editor.
export const COUNTER_ADJUST_HEIGHT = 44;
export const COUNTER_ADJUST_RADIUS = 14;

// ---- Occupancy card -------------------------------------------------------
export const DEFAULT_OCCUPANCY_RADIUS = RADIUS.card;
export const DEFAULT_OCCUPANCY_ICON = "mdi:motion-sensor";
export const DEFAULT_OCCUPANCY_ACCENT = PALETTE.dryAuto;
// A dead presence sensor is worth more attention than a quiet room, so these
// strip patterns only tidy the common vendor prefixes/suffixes.
export const DEFAULT_OCCUPANCY_NAME_STRIP = [
  "^Präsenzsensor \\d+ ?",
  " Occupancy$",
  " Bewegung$",
];
export const OCCUPANCY_HEADER_ICON_SIZE = 44;
export const OCCUPANCY_TOGGLE_HEIGHT = HEIGHT.toggle;
export const OCCUPANCY_TOGGLE_RADIUS = RADIUS.row;
export const OCCUPANCY_HEADER_ICON_RADIUS = RADIUS.squircle44;
export const OCCUPANCY_ROW_RADIUS = RADIUS.row;
export const OCCUPANCY_ROW_RADIUS_ACTIVE = RADIUS.rowActive;
export const OCCUPANCY_ROW_PADDING_Y = 11;
export const OCCUPANCY_ROW_PADDING_X = 12;
export const OCCUPANCY_ROW_GAP = SPACING.rowGap;
export const OCCUPANCY_ICON_SIZE = 36;
export const OCCUPANCY_ICON_RADIUS = 13;
// The live dot that marks an occupied room, and its breathing animation.
export const OCCUPANCY_DOT_SIZE = 9;
export const OCCUPANCY_PULSE_MS = 2000;
export const OCCUPANCY_TINT_OCCUPIED = 9;
export const OCCUPANCY_TINT_FREE = 5;
/**
 * Ink for anything drawn on a row — a timeline segment, the well behind the
 * room icon — mixed into that row rather than into the card behind it.
 *
 * The segment used to be 7% ink over the card while the row was 5% over the
 * same card — two points apart, which is nothing in any theme, and inverted on
 * an occupied row at 9%: the marks came out lighter than what they lay on.
 * Building on the row instead makes the distance a fixed one, whatever the row
 * is doing and whatever the theme mixes underneath.
 */
export const OCCUPANCY_TINT_ON_ROW = 12;
export const OCCUPANCY_CHIP_RADIUS = RADIUS.chip;
export const DEFAULT_OCCUPANCY_TIMELINE_HOURS = 3;
export const DEFAULT_OCCUPANCY_TIMELINE_SEGMENTS = 24;
export const OCCUPANCY_TIMELINE_HOURS_MIN = 1;
export const OCCUPANCY_TIMELINE_HOURS_MAX = 24;
export const OCCUPANCY_SEGMENT_HEIGHT = 14;
export const OCCUPANCY_SEGMENT_RADIUS = 3;
export const OCCUPANCY_SEGMENT_GAP = 2;
export const OCCUPANCY_SEGMENT_FADED_OPACITY = 0.6;
// State changes are pushed by hass, but "seit 12 Min." only stays honest if
// the card re-renders on its own as the clock moves.
export const OCCUPANCY_TICK_MS = 60000;

// ---- Cover card -----------------------------------------------------------
export const DEFAULT_COVER_RADIUS = RADIUS.card;
export const DEFAULT_COVER_ACCENT = PALETTE.cover;
export const COVER_TILT_STEP = 15;
export const COVER_POSITION_THROTTLE_MS = 200;
export const COVER_DRAG_SETTLE_MS = 600;
export const COVER_MIN_FEEDBACK_MS = 1400;
// Cover supported_features bit flags (from HA's CoverEntityFeature).
export const COVER_FEATURE = {
  OPEN: 1,
  CLOSE: 2,
  SET_POSITION: 4,
  STOP: 8,
  OPEN_TILT: 16,
  CLOSE_TILT: 32,
  STOP_TILT: 64,
  SET_TILT_POSITION: 128,
} as const;
// device_class -> icon (open state); a "-closed" variant is not used, the
// preview carries the open/closed signal.
export const COVER_DEVICE_ICONS: Record<string, string> = {
  shutter: "mdi:window-shutter",
  blind: "mdi:blinds-horizontal",
  curtain: "mdi:curtains",
  awning: "mdi:awning-outline",
  shade: "mdi:roller-shade",
  garage: "mdi:garage",
  gate: "mdi:gate",
  door: "mdi:door",
  window: "mdi:window-closed-variant",
};
export const DEFAULT_COVER_ICON = "mdi:window-shutter";

// ---- Leak card ------------------------------------------------------------
export const DEFAULT_LEAK_RADIUS = RADIUS.card;
export const DEFAULT_LEAK_ACCENT = PALETTE.ok;
export const LEAK_ALARM_COLOR = PALETTE.heat;
export const LEAK_STALE_COLOR = PALETTE.solar;
export const DEFAULT_LEAK_STALE_HOURS = 6;
export const DEFAULT_LEAK_BATTERY_WARN = 40;
export const DEFAULT_LEAK_BATTERY_CRITICAL = 20;
export const LEAK_ROW_HEIGHT = 52;
export const LEAK_ROW_RADIUS = RADIUS.row;
export const LEAK_ROW_RADIUS_ACTIVE = RADIUS.rowActive;
export const LEAK_ICON_SIZE = 32;
export const LEAK_ICON_RADIUS = RADIUS.squircle32;
export const LEAK_ROW_GAP = SPACING.rowGap;
export const LEAK_TICK_MS = 60000;
// How long the shut-off button stays armed after the first tap, when
// confirm_shutoff is on.
export const LEAK_ARM_TIMEOUT_MS = 4000;
export const LEAK_DEFAULT_NAME_STRIP = [
  " Feuchte$",
  " Water Leak$",
  " Moisture$",
  " Wassermelder$",
  " Leak$",
];
// device_class-ish icons keyed by name hints for common leak spots.
export const LEAK_ICON_RULES: Array<[RegExp, string]> = [
  [/sp(ü|ue)le|k(ü|ue)che|kitchen|sink/i, "mdi:silverware-fork-knife"],
  [/wasch|washing|laundry/i, "mdi:washing-machine"],
  [/heiz|boiler|heating|furnace/i, "mdi:fire"],
  [/dusche|shower|bad|bath/i, "mdi:shower"],
  [/toilette|wc|toilet/i, "mdi:toilet"],
  [/keller|basement/i, "mdi:home-floor-b"],
  [/sp(ü|ue)lmaschine|dishwasher/i, "mdi:dishwasher"],
];
export const DEFAULT_LEAK_ICON = "mdi:water-outline";

// ---- Waste card -----------------------------------------------------------
export const DEFAULT_WASTE_RADIUS = RADIUS.card;
export const WASTE_TIMELINE_DAYS = 14;
// How far ahead a calendar is read. Longer than the timeline on purpose: a bin
// on a four-week cycle would otherwise be missing from the list entirely for
// most of the month, where a day-count sensor always knows its next date.
export const WASTE_CALENDAR_LOOKAHEAD_DAYS = 70;
export const WASTE_REMINDER_OFFSET = 1;
export const WASTE_REMINDER_TIME = "18:00";
export const WASTE_TICK_MS = 60000;
export const DEFAULT_WASTE_ICON = "mdi:trash-can-outline";
export const DEFAULT_WASTE_COLOR = "#9fb0c0";
export const WASTE_DEFAULT_NAME_STRIP = [
  " Abfuhr$",
  " Collection$",
  " Waste$",
  " Tonne$",
];
// Name -> icon / default colour for the common German waste streams.
export const WASTE_ICON_RULES: Array<[RegExp, string]> = [
  [/(alt)?papier|paper|karton/i, "mdi:newspaper-variant-outline"],
  [/bio|organic|grüngut|gruengut|compost/i, "mdi:leaf"],
  [/rest(müll|muell)?|general|residual|schwarz/i, "mdi:trash-can-outline"],
  [/wertstoff|gelb|plastik|plastic|verpackung|recycl|lvp/i, "mdi:recycle"],
  [/glas|glass/i, "mdi:bottle-soda-outline"],
  [/sperrm(ü|ue)ll|bulk/i, "mdi:sofa-outline"],
];
export const WASTE_COLOR_RULES: Array<[RegExp, string]> = [
  [/(alt)?papier|paper|karton/i, "#6ba7dc"],
  [/bio|organic|grüngut|gruengut|compost/i, "#81c784"],
  [/rest(müll|muell)?|general|residual|schwarz/i, "#888780"],
  [/wertstoff|gelb|plastik|plastic|verpackung|recycl|lvp/i, "#f0c46e"],
  [/glas|glass/i, "#7bc4b0"],
  [/sperrm(ü|ue)ll|bulk/i, "#b8946a"],
];

// ---------------------------------------------------------------------------
// M3 Clock Card
// ---------------------------------------------------------------------------

export const DEFAULT_CLOCK_RADIUS = RADIUS.card;
/** Blue, matching the reference designs' hour tiles. */
export const DEFAULT_CLOCK_ACCENT = PALETTE.home;
/** Warm amber for the minute pair, the second colour in the reference. */
export const DEFAULT_CLOCK_SECONDARY = PALETTE.light;

export const CLOCK_SIZE_MIN = 0.7;
export const CLOCK_SIZE_MAX = 1.5;

// ---- tiles style
export const CLOCK_TILE_WIDTH = 104;
export const CLOCK_TILE_HEIGHT = 108;
export const CLOCK_TILE_RADIUS = 30;
export const CLOCK_TILE_DIGIT_SIZE = 54;
/** Tint percentages, applied through tintOn so they resolve against the card
 *  surface in both themes rather than against whatever sits behind it. */
export const CLOCK_TILE_ACCENT_TINT = 18;
export const CLOCK_TILE_NEUTRAL_TINT = 8;
export const CLOCK_COLON_SIZE = 7;
export const CLOCK_COLON_RADIUS = 2;
export const CLOCK_COLON_DIM = 0.25;
export const CLOCK_SECONDS_BAR_HEIGHT = 6;
export const CLOCK_SECONDS_BAR_RADIUS = 3;
export const CLOCK_SECONDS_TRACK_TINT = 9;
/** Roll animation: the outgoing digit leaves, the incoming one follows late. */
export const CLOCK_ROLL_MS = 400;
export const CLOCK_ROLL_DELAY_MS = 200;

// ---- narrow layout
/** Below this the tiles shrink; measured against the card, not the viewport. */
export const CLOCK_NARROW_PX = 240;
export const CLOCK_TILE_WIDTH_NARROW = 84;
export const CLOCK_TILE_HEIGHT_NARROW = 88;

// ---- shape motion
/** Radians per second, not per frame: a 120Hz display must not spin twice as
 *  fast as a 60Hz one. */
export const CLOCK_SHAPE_SPEED_RAD_S = { slow: 0.12, normal: 0.24, fast: 0.5 } as const;

/** A jump larger than this means standby or a DST change, not the clock
 *  advancing — recompute rather than animate across it. */
export const CLOCK_TIME_JUMP_MS = 120_000;

// ---- shapes style
export const CLOCK_CELL = 72;
export const CLOCK_CELL_NARROW = 56;
export const CLOCK_CELL_DIGIT = 46;
/** Negative: the two digits of a pair overlap so "14" reads as one number
 *  rather than as two separate badges. */
export const CLOCK_DIGIT_OVERLAP = -12;
export const CLOCK_DIGIT_OVERLAP_MIN = -20;
export const CLOCK_DIGIT_OVERLAP_MAX = 0;
export const CLOCK_PAIR_GAP = 7;
export const CLOCK_SHAPES_MINUTE_TINT = 22;
export const CLOCK_DIGIT_POP_MS = 260;

// ---- lockscreen style
export const CLOCK_LOCK_DIGIT = 78;
export const CLOCK_LOCK_DIGIT_NARROW = 56;
export const CLOCK_LOCK_STROKE = 2;
export const CLOCK_LOCK_DECOR = 86;
export const CLOCK_LOCK_DECOR_OPACITY = 0.5;

// ---- scallop style
export const CLOCK_DIAL = 200;
export const CLOCK_DIAL_OUTER_TINT = 16;
export const CLOCK_DIAL_INNER_TINT = 10;
export const CLOCK_HAND_HOUR = 11;
export const CLOCK_HAND_MINUTE = 7;
export const CLOCK_TICK_MAJOR_R = 4.5;
export const CLOCK_TICK_MINOR_R = 2.2;
export const CLOCK_TICK_MAJOR_OPACITY = 0.7;
export const CLOCK_TICK_MINOR_OPACITY = 0.25;
export const CLOCK_HUB_R = 8;
export const CLOCK_SECOND_FLOWER_R = 9;

// ---- ring style
export const CLOCK_RING_SEGMENTS = 60;
export const CLOCK_RING_OUTER = 88;
export const CLOCK_RING_INNER = 78;
export const CLOCK_RING_STROKE = 4;
export const CLOCK_RING_TRACK_TINT = 9;
export const CLOCK_RING_PAST_OPACITY = 0.75;
export const CLOCK_RING_TIME_SIZE = 34;
export const CLOCK_RING_SECONDS_SIZE = 13;
export const CLOCK_RING_DRAIN_MS = 400;

/** Clearance between a lobed shape's outermost lobe and its cell, so two
 *  neighbours never touch and none of them clips the card edge. */
export const CLOCK_SHAPE_MARGIN = 3;

/** Left inset for the lockscreen block. Flush against the card padding the
 *  digits read as if they had slipped off the edge. */
export const CLOCK_LOCK_INSET = 16;

// ---- clock extras
export const CLOCK_CHIP_HEIGHT = 26;
export const CLOCK_CHIP_RADIUS = 13;
export const CLOCK_CHIP_TINT = 12;
/** An alarm further out than this is not what the card is for. */
export const CLOCK_ALARM_HORIZON_MS = 24 * 60 * 60 * 1000;
export const CLOCK_PROGRESS_HEIGHT = 5;
export const CLOCK_PROGRESS_RADIUS = 3;
export const CLOCK_PROGRESS_TINT = 9;

// ---- status card -----------------------------------------------------------
export const DEFAULT_STATUS_RADIUS = RADIUS.card;
export const DEFAULT_STATUS_ACCENT = PALETTE.home;
export const DEFAULT_STATUS_ICON = "mdi:information-outline";

/** Semantic colours the built-in presets map onto. */
export const STATUS_COLOR_GOOD = PALETTE.ok;
export const STATUS_COLOR_BAD = PALETTE.heat;
export const STATUS_COLOR_WARN = PALETTE.light;

/** How much of the item colour washes the card (hero) and a tile (grid). */
export const STATUS_CARD_TINT = 12;
export const STATUS_TILE_TINT = 9;
export const STATUS_ICON_TINT = 20;
export const STATUS_CHIP_TINT = 16;

// Hero
export const STATUS_HERO_ICON = 34;
export const STATUS_HERO_ICON_RADIUS = 12;
export const STATUS_HERO_LABEL_SIZE = 12;
export const STATUS_BADGE = 52;
export const STATUS_BADGE_RADIUS = 19;
/** The badge morphs to this on a state change, so the switch is felt. */
export const STATUS_BADGE_RADIUS_MORPH = 26;
export const STATUS_BADGE_MORPH_MS = 420;
export const STATUS_SECONDARY_SIZE = 11;

// Value sizing. "auto" walks down this ladder as the text gets longer, because
// a 40px setting that fits "8.412" turns "Wird geliefert" into two clipped
// lines. The thresholds are character counts of the *formatted* value.
export const STATUS_VALUE_SIZE_NUMBER = 40;
export const STATUS_VALUE_SIZE_TEXT = 34;
export const STATUS_VALUE_SIZE_LONG = 26;
export const STATUS_VALUE_LONG_CHARS = 12;
export const STATUS_VALUE_LETTER_SPACING = -1.2;
/** Unit and suffix, as a share of the value size they sit next to. */
export const STATUS_UNIT_RATIO = 0.4;

// Trend chip
export const STATUS_TREND_HEIGHT = 24;
export const STATUS_TREND_RADIUS = 9;
export const STATUS_TREND_DEFAULT_HOURS = 24;
/** Below this the two values count as unchanged — a 0.2% "rise" is noise. */
export const STATUS_TREND_DEADBAND_PCT = 1;

// Grid
export const STATUS_GRID_MIN = 96;
export const STATUS_GRID_GAP = 7;
export const STATUS_TILE_RADIUS = 16;
export const STATUS_TILE_RADIUS_ACTIVE = 10;
export const STATUS_TILE_MORPH_MS = DURATION_MS.roll;
export const STATUS_TILE_ICON = 24;
export const STATUS_TILE_ICON_RADIUS = 9;
export const STATUS_TILE_VALUE_SIZE = 18;
export const STATUS_TILE_LABEL_SIZE = 9;

// Row
export const STATUS_ROW_HEIGHT = 48;
export const STATUS_ROW_RADIUS = 16;

/** Under this width the hero drops a size step and the grid goes one column. */
export const STATUS_NARROW_PX = 200;

// ---- heading card ----------------------------------------------------------
// Deliberately no radius or glass constants: this card draws no card at all.
export const DEFAULT_HEADING_COLOR = PALETTE.home;
export const DEFAULT_HEADING_ICON = "mdi:format-title";
export const HEADING_ICON = 30;
export const HEADING_ICON_RADIUS = 11;
export const HEADING_ICON_GLYPH = 16;
export const HEADING_ICON_TINT = 20;
export const HEADING_TITLE_SIZE = 15;
export const HEADING_TITLE_SIZE_MIN = 12;
export const HEADING_TITLE_SIZE_MAX = 22;

export const HEADING_BADGE_HEIGHT = 24;
export const HEADING_BADGE_RADIUS = 9;
export const HEADING_BADGE_TINT = 18;

export const HEADING_ACTION_HEIGHT = 30;
export const HEADING_ACTION_RADIUS = 15;
export const HEADING_ACTION_RADIUS_ACTIVE = 9;
export const HEADING_ACTION_TINT = 8;
export const HEADING_ACTION_FEEDBACK_MS = 500;

export const HEADING_ARROW = 26;
export const HEADING_ARROW_RADIUS = 9;
export const HEADING_ARROW_RADIUS_COLLAPSED = 13;
export const HEADING_ARROW_TINT = 7;
export const HEADING_COLLAPSE_MS = 350;

export const HEADING_RULE_STUB = 14;
export const HEADING_RULE_HEIGHT = 2;
/** Mixed from the text colour, not from white: 18% white is invisible on a
 *  light theme, and the rule would vanish exactly where it is most needed. */
/**
 * Deliberately off the tint scale the rest of the suite uses (6–22). Those are
 * all *backgrounds behind an icon*, where the icon carries the contrast and the
 * fill only has to hint. A divider rule has nothing on top of it: it is the
 * graphic, so it has to reach the 3:1 non-text target on its own. 18 gave
 * 1.78:1 on a dark card and 1.43:1 on a light one — invisible, as reported.
 * 52 gives 5.47:1 and 3.30:1, landing on mid grey in both themes.
 */
export const HEADING_RULE_TINT = 52;

/** Below this the action button drops its label and keeps only the icon. */
export const HEADING_NARROW_PX = 260;

// ---- room card -------------------------------------------------------------
export const DEFAULT_ROOM_RADIUS = RADIUS.card;
/** Columns the cards inside a room card are laid out in. */
export const DEFAULT_ROOM_CARD_COLUMNS = 2;

/**
 * Card types the room card's editor can build from an entity alone.
 *
 * Not a limit on what a room card can hold — it renders any Lovelace card, and
 * each one gets its own editor once it is in the list. This is only what the
 * picker knows how to create in one step.
 */
export const ROOM_NESTED_CARD_TYPES = [
  { type: "custom:m3-button-card", label: "editor_room_card_type_button" },
  { type: "custom:m3-light-card", label: "editor_room_card_type_light" },
  { type: "custom:m3-cover-card", label: "editor_room_card_type_cover" },
  { type: "custom:m3-media-card", label: "editor_room_card_type_media" },
  {
    type: "custom:m3-climate-card-mini",
    label: "editor_room_card_type_climate_mini",
  },
] as const;
/**
 * A room is not a kind of data with a colour of its own — it is a place, and
 * the dashboard's own accent is the honest default. Under a Material You theme
 * that is the tone generated from the wallpaper, which is why a fixed blue read
 * as the one thing on the dashboard that had not been told about the theme.
 */
export const DEFAULT_ROOM_ACCENT = "primary";
export const ROOM_PRESENCE_COLOR = PALETTE.dryAuto;

export const ROOM_HEADER_ICON = 56;
export const ROOM_HEADER_ICON_RADIUS = RADIUS.squircle56;
export const ROOM_DOT = 10;
export const ROOM_DOT_PULSE_MS = 2200;

export const ROOM_CHIP_HEIGHT = 30;
export const ROOM_CHIP_RADIUS = RADIUS.chip;
export const ROOM_CHIP_TINT = 10;
/** Watts under which the power chip says nothing worth the room it takes. */
export const ROOM_POWER_THRESHOLD = 5;

export const ROOM_TILE_MIN = 74;
export const ROOM_TILE_GAP = 7;
export const ROOM_TILE_RADIUS = 16;
export const ROOM_TILE_RADIUS_ACTIVE = 10;
export const ROOM_TILE_TINT_ACTIVE = 14;
export const ROOM_TILE_TINT_IDLE = 6;
export const ROOM_TILE_ICON = 36;
export const ROOM_TILE_ICON_RADIUS = 13;
export const ROOM_TILE_ICON_TINT_IDLE = 12;
export const ROOM_TILE_MORPH_MS = DURATION_MS.roll;

/** Card wash and border while the room is occupied. */
export const ROOM_PRESENCE_TINT = 7;
export const ROOM_PRESENCE_BORDER = 25;

/** How long a press counts as a hold rather than a tap. */
export const ROOM_HOLD_MS = 500;

export interface RoomCategoryDef {
  domain: string;
  icon: string;
  color: string;
  /** Which service a tap uses. "none" means the tap opens more-info instead —
   *  a lock and a vacuum have no meaningful toggle, and inventing one would be
   *  the card guessing at something a person would rather decide. */
  toggle: "homeassistant" | "cover" | "none";
}

/** The built-in categories, in their default order. */
export const ROOM_CATEGORIES: RoomCategoryDef[] = [
  { domain: "light", icon: "mdi:lightbulb", color: PALETTE.light, toggle: "homeassistant" },
  { domain: "fan", icon: "mdi:fan", color: PALETTE.cool, toggle: "homeassistant" },
  { domain: "humidifier", icon: "mdi:air-humidifier", color: PALETTE.dryAuto, toggle: "homeassistant" },
  { domain: "climate", icon: "mdi:thermostat", color: PALETTE.home, toggle: "homeassistant" },
  { domain: "media_player", icon: "mdi:speaker", color: PALETTE.media, toggle: "homeassistant" },
  { domain: "cover", icon: "mdi:window-shutter", color: PALETTE.cover, toggle: "cover" },
  { domain: "switch", icon: "mdi:power-plug", color: "#d6a86f", toggle: "homeassistant" },
  { domain: "vacuum", icon: "mdi:robot-vacuum", color: PALETTE.fan, toggle: "none" },
  { domain: "lock", icon: "mdi:lock", color: PALETTE.heat, toggle: "none" },
];

/** A domain the user added via `extra_domains` gets this, so it still renders. */
export const ROOM_FALLBACK_CATEGORY: Omit<RoomCategoryDef, "domain"> = {
  icon: "mdi:shape-outline",
  color: PALETTE.home,
  toggle: "homeassistant",
};

// ---- room card: the device picker -------------------------------------------
export const ROOM_SHEET_RADIUS = 28;
export const ROOM_SHEET_ROW_HEIGHT = 52;
export const ROOM_SHEET_ROW_RADIUS = 18;
export const ROOM_SHEET_ROW_TINT = 6;
export const ROOM_SHEET_ICON = 32;
export const ROOM_SHEET_ICON_RADIUS = 12;
export const ROOM_SHEET_MS = 240;
/** Above this many devices the list scrolls rather than growing the sheet. */
export const ROOM_SHEET_MAX_HEIGHT = 60;

/** Folding a room card down to its header. */
export const ROOM_FOLD_MS = HEADING_COLLAPSE_MS;
/** How many elements the search for a docked bar is willing to look at. */
export const DOCK_SCAN_BUDGET = 4000;
/** A docked bar has to cover at least this share of the window's width. */
export const DOCK_MIN_WIDTH_SHARE = 0.34;
/** And at most this share of its height — above that it is a layer, not a bar. */
export const DOCK_MAX_HEIGHT_SHARE = 0.5;
/** How deep the scan for the entities behind manual cards nests. */
export const ROOM_CARD_SCAN_DEPTH = 4;
/** Air left around a card that has been scrolled into view. */
export const ROOM_SCROLL_MARGIN = 8;
/**
 * How long the scroll to a freshly opened card takes.
 *
 * The browser's own `behavior: "smooth"` picks a duration from the distance and
 * is generous about it — half a second and more on a long dashboard, which
 * reads as the page taking its time about a tap that was already answered. This
 * is short enough to feel like a response and long enough to stay a movement
 * the eye can follow, so nobody loses track of where the card went.
 */
export const ROOM_SCROLL_MS = 240;
/** The slowest `scroll_duration` the editor will offer. */
export const ROOM_SCROLL_MAX_MS = 1500;
export const ROOM_ARROW = HEADING_ARROW;
export const ROOM_ARROW_RADIUS = HEADING_ARROW_RADIUS;
export const ROOM_ARROW_RADIUS_FOLDED = HEADING_ARROW_RADIUS_COLLAPSED;
export const ROOM_ARROW_TINT = HEADING_ARROW_TINT;

/** The thermostat sheet the climate overview opens on a room tap. */
export const CLIMATE_SHEET_MS = ROOM_SHEET_MS;

// ---- m3-humidifier-card ---------------------------------------------------

export const DEFAULT_HUMIDIFIER_RADIUS = RADIUS.card;
export const HUMIDIFIER_ICON_TINT = 20;

/** Fallback range when the entity reports no min/max, which many do not. */
export const HUMIDIFIER_MIN_DEFAULT = 30;
export const HUMIDIFIER_MAX_DEFAULT = 80;
export const HUMIDIFIER_STEP_DEFAULT = 1;
/** Same interval the light card's sliders use; one service call per drag tick. */
export const HUMIDIFIER_THROTTLE_MS = 200;
/** How long the optimistic value holds after release, waiting for the echo. */
export const HUMIDIFIER_DRAG_SETTLE_MS = 500;
export const HUMIDIFIER_WAVE_AMPLITUDE_LERP = 0.12;

// Target slider. Its own numbers rather than the light card's, because this
// wave is wider and calmer: a humidity target moves in whole percent, not in
// 255 brightness steps, so a taller amplitude would read as busier than the
// value actually is.
export const HUMIDIFIER_SLIDER_HEIGHT = 44;
export const HUMIDIFIER_WAVE_STROKE = 11;
export const HUMIDIFIER_WAVE_AMPLITUDE = 3.2;
export const HUMIDIFIER_WAVE_WAVELENGTH = 24;
export const HUMIDIFIER_WAVE_GAP = 12;
export const HUMIDIFIER_HANDLE_WIDTH = 5;
export const HUMIDIFIER_HANDLE_HEIGHT = 26;
export const HUMIDIFIER_HANDLE_RADIUS = 2.5;
export const HUMIDIFIER_LABEL_SIZE = 11;
export const HUMIDIFIER_VALUE_SIZE = 26;
export const HUMIDIFIER_CAPTION_SIZE = 10;

// Mode row.
export const HUMIDIFIER_MODE_HEIGHT = 50;
export const HUMIDIFIER_MODE_RADIUS = 25;
export const HUMIDIFIER_MODE_RADIUS_ACTIVE = 15;
export const HUMIDIFIER_MODE_TINT = 8;
/** Above this many modes the row becomes a dropdown on its own. */
export const HUMIDIFIER_MODE_DROPDOWN_FROM = 5;

// Fan row.
export const HUMIDIFIER_FAN_HEIGHT = 44;
export const HUMIDIFIER_FAN_RADIUS = 22;
export const HUMIDIFIER_FAN_RADIUS_ACTIVE = 13;
export const HUMIDIFIER_FAN_TINT = 28;
export const HUMIDIFIER_BAR_WIDTH = 3;
export const HUMIDIFIER_BAR_RADIUS = 1.5;
export const HUMIDIFIER_BAR_HEIGHTS = [8, 11, 14] as const;

// Chips.
export const HUMIDIFIER_CHIP_HEIGHT = 32;
export const HUMIDIFIER_CHIP_RADIUS = RADIUS.chip + 1;
export const HUMIDIFIER_CHIP_RADIUS_ACTIVE = 10;
export const HUMIDIFIER_CHIP_GAP = SPACING.rowGap;
export const HUMIDIFIER_CHIP_TINT = 10;

export const HUMIDIFIER_TANK_WARN = 70;
export const HUMIDIFIER_TANK_FULL = 95;

/** Below this the mode pills drop their labels and the fan row wraps. */
export const HUMIDIFIER_NARROW_PX = 320;

// Mode colours. Keyed by the lowercased mode name HA reports, because those
// strings are integration-defined and vary; anything unmatched walks the
// palette below in order, so an unknown mode still looks deliberate.
export const HUMIDIFIER_MODE_COLORS: Record<string, string> = {
  off: PALETTE.off,
  normal: PALETTE.cool,
  comfort: PALETTE.cool,
  auto: PALETTE.dryAuto,
  boost: PALETTE.solar,
  turbo: PALETTE.solar,
  max: PALETTE.solar,
  sleep: PALETTE.grid,
  night: PALETTE.grid,
  baby: PALETTE.light,
  eco: PALETTE.ok,
  home: PALETTE.home,
  away: PALETTE.fan,
};
export const HUMIDIFIER_MODE_PALETTE = [
  PALETTE.cool,
  PALETTE.dryAuto,
  PALETTE.solar,
  PALETTE.grid,
  PALETTE.light,
  PALETTE.media,
  PALETTE.cover,
] as const;

// ---- m3-calendar-card -----------------------------------------------------

export const DEFAULT_CALENDAR_RADIUS = RADIUS.card;
export const DEFAULT_CALENDAR_ICON = "mdi:calendar-month";
export const CALENDAR_DAYS_AHEAD = 7;
export const CALENDAR_DAYS_AHEAD_MIN = 1;
export const CALENDAR_DAYS_AHEAD_MAX = 30;
/** How often the card re-reads, on top of reacting to calendar state changes. */
export const CALENDAR_REFRESH_MS = 5 * 60 * 1000;

// Colours handed out in order to calendars that configure none. Chosen so
// adjacent entries stay distinguishable side by side in a month cell's dots,
// where they appear as three 4px circles with nothing else to tell them apart.
export const CALENDAR_PALETTE = [
  PALETTE.home,
  PALETTE.media,
  PALETTE.dryAuto,
  PALETTE.solar,
  PALETTE.heat,
  PALETTE.light,
] as const;

// View switch.
export const CALENDAR_SWITCH_RADIUS = 16;
export const CALENDAR_SWITCH_PAD = 3;
export const CALENDAR_SWITCH_TINT = 6;
export const CALENDAR_SWITCH_BTN = 28;
export const CALENDAR_SWITCH_BTN_RADIUS = 13;
export const CALENDAR_SWITCH_BTN_RADIUS_ACTIVE = 10;

// Agenda.
export const CALENDAR_DAY_LABEL_SIZE = 12;
export const CALENDAR_DAY_DATE_SIZE = 10;
export const CALENDAR_ROW_RADIUS = 16;
export const CALENDAR_ROW_RADIUS_ACTIVE = 9;
export const CALENDAR_ROW_TINT = 5;
export const CALENDAR_TIME_COL = 44;
/** "10:30 AM" does not fit the 24-hour column, and wrapped onto two lines. */
export const CALENDAR_TIME_COL_12H = 62;
export const CALENDAR_TIME_SIZE = 12;
export const CALENDAR_TIME_END_SIZE = 9;
export const CALENDAR_BAR_WIDTH = 4;
export const CALENDAR_BAR_RADIUS = 2;
export const CALENDAR_TITLE_SIZE = 12;
export const CALENDAR_LOCATION_SIZE = 10;
export const CALENDAR_PAST_OPACITY = 0.45;
export const CALENDAR_RUNNING_TINT = 12;
export const CALENDAR_NOW_BADGE_HEIGHT = 22;
export const CALENDAR_NOW_BADGE_RADIUS = 8;

// Month grid.
export const CALENDAR_NAV_BTN = 32;
export const CALENDAR_NAV_RADIUS = 11;
export const CALENDAR_NAV_TINT = 7;
export const CALENDAR_MONTH_TITLE_SIZE = 13;
export const CALENDAR_WEEKDAY_SIZE = 9;
export const CALENDAR_GRID_GAP = 3;
export const CALENDAR_CELL_NUM_SIZE = 12;
export const CALENDAR_DOT_SIZE = 4;
export const CALENDAR_DOTS_MAX = 3;
export const CALENDAR_TODAY_TINT = 16;
export const CALENDAR_TODAY_RADIUS = 14;
export const CALENDAR_SELECTED_RADIUS = 10;
export const CALENDAR_ADJACENT_OPACITY = 0.3;
export const CALENDAR_DAY_ROW_HEIGHT = 40;
export const CALENDAR_DAY_ROW_RADIUS = 14;

// ---- nav card --------------------------------------------------------------
// A navigation bar rather than a data card: the numbers below are chrome
// measurements, so most of them are per-variant rather than derived from the
// row/chip scale in tokens.ts. `size` scales every one of them proportionally.
/**
 * Navigation chrome follows the dashboard's own accent rather than picking a
 * colour of its own.
 *
 * A data card is entitled to a hue that means something — solar yellow, grid
 * blue. A navigation bar means nothing in particular: it is the frame around
 * everything else, and the theme already says what colour that frame is. Under
 * a Material You theme this is the tone generated from the user's wallpaper,
 * which is why the bar was conspicuously the one blue thing on a green
 * dashboard. `accent_color` still overrides it, per card or per entry.
 */
export const DEFAULT_NAV_COLOR = "primary";
export const DEFAULT_NAV_RADIUS = RADIUS.card;
export const DEFAULT_NAV_ICON = "mdi:circle-outline";

/** Below this card width the `mobile` layout block applies. */
export const NAV_DEFAULT_BREAKPOINT = 768;
/** `size` is a multiplier on every measurement, clamped to this range. */
export const NAV_SIZE_MIN = 0.7;
export const NAV_SIZE_MAX = 1.5;

// The bar itself.
export const NAV_BAR_HEIGHT = 62;
export const NAV_BAR_PADDING = 6;
export const NAV_BAR_GAP = 2;
export const NAV_ITEM_MIN_WIDTH = 56;
export const NAV_ITEM_HEIGHT = 50;
export const NAV_ITEM_RADIUS = 17;
/** The pressed-state radius morph this suite uses instead of a ripple. */
export const NAV_ITEM_RADIUS_ACTIVE = 11;
export const NAV_ITEM_GLYPH = 22;
export const NAV_ITEM_LABEL_SIZE = 11;
/**
 * The same label when it sits beside the icon rather than under it.
 *
 * 11px is the size Material gives a label stacked under an icon, where it is
 * the secondary half of the pair. Set next to the icon it is the tab's name and
 * carries the entry, and at 11px against a 22px glyph it reads as a caption
 * somebody forgot to finish.
 */
export const NAV_ITEM_LABEL_SIZE_BESIDE = 14;
export const NAV_ITEM_TINT = 16;
/**
 * The active pill hugs the glyph rather than filling the whole entry — a bar
 * across a wide screen otherwise lights up a third of it. Material's own
 * bottom navigation sizes the indicator to the icon and leaves the label
 * outside it, which is what the reference designs show too.
 */
export const NAV_INDICATOR_WIDTH = 56;
export const NAV_INDICATOR_HEIGHT = 32;
export const NAV_INDICATOR_RADIUS = 16;
export const NAV_INDICATOR_RADIUS_ACTIVE = 10;

/**
 * Smallest inset a docked bar treats as chrome rather than padding.
 *
 * A docked bar keeps clear of the sidebar by matching the width of the content
 * area. But a view is also padded away from the screen edges, and that padding
 * is part of the same measurement — below this many pixels an inset is read as
 * the view's own padding, and the bar goes to the edge instead. The sidebar is
 * 56px collapsed, so nothing real falls in the gap.
 */
export const NAV_DOCK_MIN_INSET = 40;

/**
 * How far up the tree a docked bar looks for the view's content area.
 *
 * The walk crosses a shadow boundary at nearly every step — card wrapper,
 * section, sections view, view container — so the content area is a dozen or
 * so hops away from a card sitting in a grid. Stopping short leaves the widest
 * thing found so far as the answer, and that is the card's own column: the bar
 * then spans one column in the middle of the screen instead of the view.
 */
export const NAV_DOCK_MAX_DEPTH = 30;

/** Side padding of an entry whose label sits beside its icon. */
export const NAV_SIDE_PADDING = 16;
/** The same, for an entry that carries an icon as well as its label. */
export const NAV_ICON_SIDE_PADDING = 12;
export const NAV_ITEM_INACTIVE_OPACITY = 0.6;
export const NAV_PRESS_MS = 200;

/** How long the marker takes to travel from one entry to the next. */
export const NAV_MARKER_SLIDE_MS = 280;

/**
 * Default length of the page cross-fade.
 *
 * The browser's own default is 250ms, which reads as slow for a change the
 * reader asked for and expects to have happened already. Navigation should feel
 * immediate and merely not jump.
 */
export const NAV_PAGE_FADE_MS = 180;

/** How far the arriving page glides up in the `up` transition. */
export const NAV_PAGE_SLIDE_PX = 18;

/**
 * Share of the transition the outgoing page gets.
 *
 * Material's fade-through does not cross-fade: the old page is gone before the
 * new one starts, so the two never wash out over each other.
 */
export const NAV_PAGE_OUT_SHARE = 0.35;

/** `segmented` is one pill holding the entries, so its own frame is tighter. */
export const NAV_SEGMENT_HEIGHT = 44;
export const NAV_SEGMENT_RADIUS = 22;
export const NAV_SEGMENT_ITEM_RADIUS = 18;
export const NAV_SEGMENT_PADDING = 4;

/** `floating`/`sheet` detach from the view and keep this gap to its edges. */
export const NAV_FLOAT_INSET = 8;

/**
 * The bar's corner when nothing is configured: fully round ends, whatever the
 * bar turns out to be tall.
 *
 * Written as a number no bar can reach, so the browser clamps it to half the
 * height — the intent is a shape, not a measurement. It used to be a fixed 30
 * against a 62px bar, one pixel short of the capsule it was meant to be, and a
 * pixel short does not read as a rounded rectangle. It reads as a capsule that
 * has been squashed: the ends stop curving just before they should and leave a
 * flat sliver in the middle of each one. Scaling the bar made it worse, because
 * the number stayed while the height moved.
 */
export const NAV_BAR_RADIUS = 999;
/** What that capsule measures on an unscaled bar, for the editor's slider. */
export const NAV_BAR_RADIUS_UI = NAV_BAR_HEIGHT / 2;
/**
 * The drawer's corner, which cannot be the bar's.
 *
 * "Fully round ends" is the right instruction for a box wider than it is tall.
 * A drawer pulled open is the other way round, and the same instruction turns
 * it into an oval: the browser clamps the radius to half the *smaller* side, so
 * a panel 850 wide comes out with 425px corners and stops being a rectangle at
 * all. A panel wants a corner it can keep, not one derived from its height.
 */
export const NAV_SHEET_RADIUS = 30;

/**
 * How a freshly created nav card is filled in from the dashboard it lands on.
 *
 * A card that arrives empty asks the reader to type out what the dashboard
 * already knows. These two numbers shape the suggestion instead: the first few
 * views become entries, the next few go behind the round button, and everything
 * after that is left alone. A bar cannot usefully hold eighty views, and a
 * suggestion that tried would be worse than none — the point is something
 * recognisable to edit, not a complete transcription.
 */
export const NAV_STUB_BAR_ITEMS = 3;
export const NAV_STUB_MENU_ITEMS = 5;
/**
 * Below HA's dialog band (its dialogs sit far above this), above ordinary card
 * content. Exposed as `--nav-z` so a dashboard with an unusual stacking context
 * can move it without a card change.
 */
export const NAV_Z_INDEX = 500;
export const NAV_AUTOHIDE_MS = 220;
/** A scroll shorter than this does not count as a direction change. */
export const NAV_AUTOHIDE_THRESHOLD_PX = 12;

// Badges.
export const NAV_BADGE_DOT = 8;
export const NAV_BADGE_HEIGHT = 16;
export const NAV_BADGE_RADIUS = 8;
export const NAV_BADGE_FONT = 10;
export const NAV_BADGE_PADDING = 5;

// Popup submenu.
export const NAV_SUBMENU_RADIUS = 22;
export const NAV_SUBMENU_ROW_HEIGHT = 44;
export const NAV_SUBMENU_ROW_RADIUS = 15;
export const NAV_SUBMENU_PADDING = 6;
export const NAV_SUBMENU_MIN_WIDTH = 180;
export const NAV_SUBMENU_MS = 300;
export const NAV_SUBMENU_TINT = 10;

// ---- action button speed dial ----------------------------------------------
/** Gap between the trigger and the first entry, and between entries. */
export const NAV_MENU_GAP = 10;
/** Height of one labelled entry. */
export const NAV_MENU_ROW_HEIGHT = 48;
export const NAV_MENU_ROW_RADIUS = 24;
/** Diameter of the tinted circle carrying an entry's icon. */
export const NAV_MENU_GLYPH = 34;
/** Background tint of an entry, in percent. */
export const NAV_MENU_TINT = 22;
/** The stronger tint of the icon circle sitting on that entry. */
export const NAV_MENU_GLYPH_TINT = 34;
/** Delay between one entry appearing and the next, in ms. */
export const NAV_MENU_STAGGER_MS = 45;
/**
 * Corner radius the round trigger morphs to while the menu is open — a circle
 * turning into a rounded square is the Material shape change that says the
 * button now closes rather than opens.
 */
export const NAV_MENU_OPEN_RADIUS = 18;
/** How far the entries rise as they appear. */
export const NAV_MENU_RISE = 12;
export const NAV_MENU_SCRIM_OPACITY = 0.45;
export const NAV_MENU_MAX_WIDTH = 320;

// Sheet.
export const NAV_SHEET_HANDLE_WIDTH = 42;
export const NAV_SHEET_HANDLE_HEIGHT = 4;
export const NAV_SHEET_HANDLE_RADIUS = 2;
export const NAV_SHEET_HANDLE_OPACITY = 0.35;
/**
 * Air around the grip of a collapsed drawer.
 *
 * This band sits on top of the bar, so every pixel of it is a pixel the icons
 * are pushed down by while the text below them keeps the bar's own padding —
 * the drawer read as top-heavy for exactly that reason. Ten left a 24px strip
 * above a bar that is otherwise even top and bottom.
 *
 * Two leaves a strip of eight, near enough the bar's own six that the two ends
 * read as a pair. It cannot go to nothing: the grip has to be grabbable, and
 * the band is what is grabbed. The last couple of pixels are the price of
 * having a grip at all, and they are below the threshold where an eye picks a
 * difference out of a shape this size.
 */
export const NAV_SHEET_HANDLE_PADDING = 2;
export const NAV_SHEET_DEFAULT_MAX_VH = 60;

/** A phone in landscape: 60vh of drawer would leave nothing of the view. */
export const NAV_SHORT_VIEWPORT_PX = 600;
export const NAV_SHORT_VIEWPORT_MAX_VH = 50;
export const NAV_SHEET_TITLE_SIZE = 15;
export const NAV_SHEET_ACTION_SIZE = 34;
export const NAV_SHEET_ACTION_RADIUS = 12;
export const NAV_SHEET_SETTLE_MS = 320;

// Gestures.
/** Movement under this is a tap, not a drag — the button card's own threshold. */
export const NAV_DRAG_THRESHOLD_PX = 8;
export const NAV_HOLD_MS = 500;
export const NAV_DOUBLE_TAP_MS = 250;
/**
 * A release faster than this opens or closes outright, whatever the sheet's
 * position — a flick is an instruction, not a measurement.
 */
export const NAV_FLING_VELOCITY_PX_MS = 0.5;
/** Pointer samples kept for the velocity estimate at release. */
export const NAV_VELOCITY_SAMPLES = 5;
export const NAV_VELOCITY_WINDOW_MS = 100;
/** One transform write per frame is enough while a finger is down. */
export const NAV_DRAG_THROTTLE_MS = 16;

// ---- Chip Buttons, Lights Overview, Group -----------------------------------
// From UHaFnir/m3-cards, written against this file's own scale rather than
// copied with their literals: the fork derives the same three radii from
// RADIUS.card and the overview grid from the climate overview's, which is the
// point — a row of chips and a lights tile should measure like their siblings.

export const DEFAULT_CHIP_BUTTONS_RADIUS = RADIUS.card;
export const CHIP_BUTTON_HEIGHT = 34;
export const CHIP_BUTTON_ICON_SIZE = 18;

export const DEFAULT_LIGHTS_OVERVIEW_RADIUS = RADIUS.card;
export const DEFAULT_LIGHTS_OVERVIEW_ICON = "mdi:lightbulb-group";
export const LIGHTS_OVERVIEW_GRID_GAP = CLIMATE_OVERVIEW_GRID_GAP;
export const LIGHTS_OVERVIEW_GRID_MIN_COL = CLIMATE_OVERVIEW_GRID_MIN_COL;
// Wider than the room grid above it: this one holds individual lights with
// their names, not a room's summary.
export const LIGHTS_OVERVIEW_ENTITY_GRID_MIN_COL = 140;
export const LIGHTS_OVERVIEW_TILE_RADIUS = CLIMATE_OVERVIEW_TILE_RADIUS;
export const LIGHTS_OVERVIEW_COLOR_ON = PALETTE.light;
export const LIGHTS_OVERVIEW_COLOR_OFF = PALETTE.off;

export const DEFAULT_GROUP_RADIUS = RADIUS.card;
export const DEFAULT_GROUP_GAP = 8;

// Weather card: how wide an hour slot and its label need to be before the
// strip starts skipping hours, and the strides it is allowed to skip by —
// only divisors that keep the labels on a round clock.
export const WEATHER_HOUR_LABEL_MIN_WIDTH_PX = 44;
export const WEATHER_HOURLY_SLOT_MIN_WIDTH_PX = 28;
export const WEATHER_NICE_HOUR_STRIDES = [1, 2, 3, 4, 6, 8, 12, 24];

// ---- m3-appliance-card ----------------------------------------------------
// Deliberately the humidifier card's numbers rather than a new set: the two
// cards draw the same vocabulary — a squircle header, labelled blocks, pill
// rows and chips — and a second scale would show up as a seam wherever the two
// sit side by side on a dashboard.

export const DEFAULT_APPLIANCE_RADIUS = RADIUS.card;
export const DEFAULT_APPLIANCE_ICON = "mdi:washing-machine";
export const DEFAULT_APPLIANCE_ACCENT = PALETTE.home;
export const APPLIANCE_ICON_TINT = HUMIDIFIER_ICON_TINT;
export const APPLIANCE_LABEL_SIZE = HUMIDIFIER_LABEL_SIZE;
export const APPLIANCE_VALUE_SIZE = 22;
export const APPLIANCE_CAPTION_SIZE = HUMIDIFIER_CAPTION_SIZE;

/** Progress bar. Thinner than the humidifier's slider — it is read, not dragged. */
export const APPLIANCE_BAR_HEIGHT = 10;
export const APPLIANCE_BAR_RADIUS = 5;
/** How much of the track the indeterminate segment covers as it sweeps. */
export const APPLIANCE_INDETERMINATE_FRACTION = 0.35;
export const APPLIANCE_INDETERMINATE_MS = 1800;

/** Slider rows: the humidifier's handle on a plain track. */
export const APPLIANCE_SLIDER_HEIGHT = HUMIDIFIER_SLIDER_HEIGHT;
export const APPLIANCE_SLIDER_TRACK = HUMIDIFIER_WAVE_STROKE;
export const APPLIANCE_HANDLE_WIDTH = HUMIDIFIER_HANDLE_WIDTH;
export const APPLIANCE_HANDLE_HEIGHT = HUMIDIFIER_HANDLE_HEIGHT;
export const APPLIANCE_HANDLE_RADIUS = HUMIDIFIER_HANDLE_RADIUS;
export const APPLIANCE_SLIDER_THROTTLE_MS = HUMIDIFIER_THROTTLE_MS;
export const APPLIANCE_DRAG_SETTLE_MS = HUMIDIFIER_DRAG_SETTLE_MS;

/* Wave geometry, derived from the humidifier's like the rest of this scale
   rather than being a second set of numbers. The phase speed comes from the
   progress card so a wavy appliance bar and a wavy progress bar next to each
   other travel at the same rate. */
export const APPLIANCE_WAVE_AMPLITUDE = HUMIDIFIER_WAVE_AMPLITUDE;
export const APPLIANCE_WAVE_WAVELENGTH = HUMIDIFIER_WAVE_WAVELENGTH;
export const APPLIANCE_WAVE_GAP = HUMIDIFIER_WAVE_GAP;
export const APPLIANCE_WAVE_AMPLITUDE_LERP = HUMIDIFIER_WAVE_AMPLITUDE_LERP;
export const APPLIANCE_WAVE_PHASE_SPEED = WAVE_PHASE_SPEED;
export const APPLIANCE_WAVE_DOT_RADIUS = WAVE_DOT_RADIUS;
/* The bar is read rather than dragged, so its wave sits in a taller box than
   its flat self needs — the stroke has to fit the amplitude without clipping. */
export const APPLIANCE_BAR_SVG_HEIGHT = 20;

/** Segmented option pills. */
export const APPLIANCE_OPTION_HEIGHT = HUMIDIFIER_MODE_HEIGHT;
export const APPLIANCE_OPTION_RADIUS = HUMIDIFIER_MODE_RADIUS;
export const APPLIANCE_OPTION_RADIUS_ACTIVE = HUMIDIFIER_MODE_RADIUS_ACTIVE;
export const APPLIANCE_OPTION_TINT = HUMIDIFIER_MODE_TINT;
/** Above this many options the row becomes a dropdown on its own. */
export const APPLIANCE_OPTION_DROPDOWN_FROM = 6;

/** Action buttons: the fan row's proportions, which read as "press me". */
export const APPLIANCE_BUTTON_HEIGHT = HUMIDIFIER_FAN_HEIGHT;
export const APPLIANCE_BUTTON_RADIUS = HUMIDIFIER_FAN_RADIUS;
export const APPLIANCE_BUTTON_RADIUS_ACTIVE = HUMIDIFIER_FAN_RADIUS_ACTIVE;
export const APPLIANCE_BUTTON_TINT = HUMIDIFIER_FAN_TINT;

export const APPLIANCE_CHIP_HEIGHT = HUMIDIFIER_CHIP_HEIGHT;
export const APPLIANCE_CHIP_RADIUS = HUMIDIFIER_CHIP_RADIUS;
export const APPLIANCE_CHIP_RADIUS_ACTIVE = HUMIDIFIER_CHIP_RADIUS_ACTIVE;
export const APPLIANCE_CHIP_GAP = HUMIDIFIER_CHIP_GAP;
export const APPLIANCE_CHIP_TINT = HUMIDIFIER_CHIP_TINT;

/** Below this the option pills drop their labels and the button row wraps. */
export const APPLIANCE_NARROW_PX = HUMIDIFIER_NARROW_PX;

/** Colours handed to option pills and buttons that configure none. */
export const APPLIANCE_PALETTE = HUMIDIFIER_MODE_PALETTE;
// ---- Search -----------------------------------------------------------------
// Measurements from the Material 3 search bar in its resting state: a 56px-tall
// fully-rounded container, a 24px leading icon inset 16px from the edge, and
// trailing icon buttons on a 40px target so their 24px glyph lands on the same
// 16px inset at the other end. The pill shape falls out of the suite's own
// scale rather than being asserted: half of 56 is 28, which is RADIUS.card.
export const DEFAULT_SEARCH_RADIUS = RADIUS.card;
export const SEARCH_BAR_HEIGHT = 56;
export const SEARCH_ICON_SIZE = 24;
export const SEARCH_ACTION_SIZE = 40;
export const SEARCH_ACTION_RADIUS = SEARCH_ACTION_SIZE / 2;
export const DEFAULT_SEARCH_ICON = "mdi:magnify";
export const DEFAULT_SEARCH_ASSIST_ICON = "mdi:microphone";
/** Well behind the trailing Assist button — the same weight as the heading
 *  card's action button, which is the other "quiet button on a card" in the
 *  suite. */
export const SEARCH_ACTION_TINT = 8;
/** The bar's own wash while a finger is down. Below the action tint, because
 *  it covers the whole bar rather than a 40px button. */
export const SEARCH_PRESSED_TINT = 6;
/** How long the pressed wash stays after a tap that opens a dialog. The dialog
 *  takes the focus, so without a timer the bar would stay lit behind it. */
export const SEARCH_FEEDBACK_MS = 180;

// ---- m3-vacuum-card ---------------------------------------------------------
// The vacuum is a control surface first: a big primary button, a row of
// modes, and a state colour. Its sizes come from the appliance card, which is
// the other card in the suite built around "one device, several blocks".

export const DEFAULT_VACUUM_RADIUS = RADIUS.card;
export const DEFAULT_VACUUM_ICON = "mdi:robot-vacuum";

/* The header is the suite's shared one (shared/card-header.ts), so its
   swatch, name and subtitle sizes live there rather than here. Only the tint
   is the card's own, because the state colour it mixes is. */
export const VACUUM_ICON_TINT = 16;

/** Battery chip in the header's trailing slot. */
export const VACUUM_BATTERY_HEIGHT = 30;
export const VACUUM_BATTERY_RADIUS = 15;
/** Above this the chip is green, above the second it is amber, below it red.
 *  Not a vendor threshold — the point where a Roborock can still finish a
 *  room and the point where it will dock mid-run. */
export const VACUUM_BATTERY_OK = 40;
export const VACUUM_BATTERY_LOW = 15;

/** Primary action button. Tall enough to be the obvious target on a phone. */
export const VACUUM_PRIMARY_HEIGHT = 56;
export const VACUUM_PRIMARY_RADIUS = 18;
/** Pausing morphs the button rounder — the shape says "held", not "stopped". */
export const VACUUM_PRIMARY_RADIUS_PAUSED = 28;
export const VACUUM_SECONDARY_WIDTH = 60;
export const VACUUM_SECONDARY_RADIUS = 26;
export const VACUUM_SECONDARY_TINT = 8;
/** How far the primary button dims while it is showing a state the vacuum has
 *  not confirmed yet. Enough to read as "working on it", not as "disabled". */
export const VACUUM_PENDING_OPACITY = 0.62;

/** "Mop only" toggle beside the suction scale. The scale itself takes its
 *  geometry from shared/level-slider.ts, which owns the Expressive spec. */
export const VACUUM_MOP_ONLY_SIZE = 40;
export const VACUUM_MOP_ONLY_RADIUS = VACUUM_MOP_ONLY_SIZE / 2;
export const VACUUM_MOP_ONLY_RADIUS_ACTIVE = 12;

/** Room chips. */
export const VACUUM_ROOM_HEIGHT = 32;
export const VACUUM_ROOM_RADIUS = 16;
export const VACUUM_ROOM_RADIUS_ACTIVE = 10;

/** Mop-intensity pills. Slightly shorter than the fan row: it is the second
 *  choice on the card, not a competing one. */
export const VACUUM_MOP_HEIGHT = 40;
export const VACUUM_MOP_RADIUS = 20;
export const VACUUM_MOP_RADIUS_ACTIVE = 12;
export const VACUUM_MOP_TINT = 28;

/** Station chips. */
/** Status chips: kept visibly shorter than the 34px chip buttons beside them. */
export const VACUUM_CHIP_HEIGHT = 28;
export const VACUUM_CHIP_RADIUS = 14;
export const VACUUM_CHIP_GAP = 10;
export const VACUUM_MAX_CHIPS = 4;

/** Map preview. */
export const VACUUM_MAP_RADIUS = 20;
/**
 * How tall the map may get. The picture is letterboxed inside this — a
 * Roborock map is wider than it is tall and carries transparent margins of
 * its own — so this number, not the card's width, is what decides how big the
 * floor plan actually looks. 220px left it a stamp in the middle of a lot of
 * nothing; `map_height` tunes it per card.
 */
export const VACUUM_MAP_HEIGHT = 360;
/** How far a pinch may go before it stops being a map and starts being pixels. */
export const VACUUM_MAP_MAX_ZOOM = 4;
export const VACUUM_MAP_CHIP_RADIUS = 9;
/** Tied to the integration's own polling cadence — refreshing faster only
 *  re-fetches the same picture. */
export const VACUUM_MAP_REFRESH_MS = 30_000;

/** How long the card keeps showing a state it asked for. Two polls' worth, so
 *  a single missed update does not snap the button back. */
export const VACUUM_OPTIMISTIC_MS = 70_000;

/** Progress wave, matching the appliance card's bar so the two read as one
 *  family when they sit on the same dashboard. */
export const VACUUM_WAVE_STROKE = 6;
export const VACUUM_WAVE_AMPLITUDE = 2.4;
export const VACUUM_WAVE_WAVELENGTH = 20;
export const VACUUM_WAVE_GAP = 8;
export const VACUUM_WAVE_SVG_HEIGHT = 16;

// ---- m3-vacuum-maintenance-card ---------------------------------------------
// The list half of the vacuum pair. Its rows are the suite's list rows, so the
// numbers come from the battery and power-list cards rather than a new scale.

/** The robot itself, like the control card — the card is about the machine, not the toolbox. */
export const DEFAULT_VACUUM_MAINT_ICON = "mdi:robot-vacuum";
/* Swatch size and radius come from the shared header, as on every other card. */

export const VACUUM_PART_ROW_HEIGHT = 52;
export const VACUUM_PART_ROW_RADIUS = 17;
export const VACUUM_PART_ROW_TINT = 5;
export const VACUUM_PART_ICON_SIZE = 30;
export const VACUUM_PART_ICON_RADIUS = 11;
export const VACUUM_PART_BAR_HEIGHT = 5;
export const VACUUM_PART_BAR_RADIUS = 3;
/** So a part at 0.4% is still a visible sliver rather than nothing at all. */
export const VACUUM_PART_BAR_MIN_WIDTH = 5;

/** Percent of service life left. Below the first it warns, below the second
 *  it alerts — both configurable, because "soon" is a household opinion. */
export const VACUUM_PART_WARN_BELOW = 25;
export const VACUUM_PART_ALERT_BELOW = 10;

/**
 * Full service life per part, in hours, as Roborock documents it. Only used
 * to draw the bar: the sensors report hours *left*, not a percentage, so
 * without a total there is no fraction to fill. A part this table does not
 * know draws no bar rather than a made-up one.
 */
export const VACUUM_PART_MAX_HOURS: Record<string, number> = {
  main_brush: 300,
  side_brush: 200,
  filter: 150,
  sensor: 30,
  strainer: 150,
  maintenance_brush: 300,
};

/**
 * How wide a copy of the map the crop is measured on. Finding the edge of a
 * floor plan needs no more than this, and a full-size readback of a picture
 * that changes every few seconds during a run would cost real time.
 */
export const VACUUM_MAP_SAMPLE_PX = 240;

/**
 * Icons for the cleaning-mode options, so the menu reads at a glance. Keyed on
 * the values Roborock reports; anything else falls back to a neutral icon
 * rather than claiming to know what a vendor's own word means.
 */
export const VACUUM_CLEAN_MODE_ICONS: Record<string, string> = {
  vacuum: "mdi:robot-vacuum",
  mop: "mdi:water",
  vac_and_mop: "mdi:vacuum",
  vacmop: "mdi:vacuum",
  custom: "mdi:tune-variant",
};

export const VACUUM_MODE_ROW_HEIGHT = 48;
export const VACUUM_MODE_ROW_RADIUS = 16;
export const VACUUM_PICK_SHEET_RADIUS = 28;
export const VACUUM_PICK_OPTION_HEIGHT = 52;
export const VACUUM_PICK_OPTION_RADIUS = 16;

/**
 * The range of the `input_number` the editor creates for a reminder.
 *
 * It holds a *meter reading* — the lifetime run count, or hours of runtime, at
 * the moment the chore was last ticked off — not a count of anything itself.
 * So the ceiling has to clear whatever the machine will ever report: a vacuum
 * that has run four thousand times is a vacuum three years old, and hours of
 * runtime pass the same mark sooner.
 */
export const VACUUM_COUNTER_MAX = 100000;
/** How long the editor waits for a freshly created helper to turn up. */
export const VACUUM_COUNTER_WAIT_MS = 4000;

export const VACUUM_STATION_TILE_PADDING = 11;
export const VACUUM_STATION_TILE_RADIUS = 18;
export const VACUUM_STATION_TILE_RADIUS_ACTIVE = 11;
export const VACUUM_STATION_ICON_SIZE = 30;
export const VACUUM_STATION_ICON_RADIUS = 15;
export const VACUUM_STATION_ICON_RADIUS_ACTIVE = 9;
export const VACUUM_STATION_TINT = 11;

export const VACUUM_STAT_PADDING = 11;
export const VACUUM_STAT_RADIUS = 16;
export const VACUUM_STAT_TINT = 5;
export const VACUUM_STAT_VALUE_SIZE = 17;
export const VACUUM_STAT_LABEL_SIZE = 9;

// ---- m3-printer-card --------------------------------------------------------
// A printer is a control surface with a long-running job on it, so the sizes
// come from the appliance and vacuum cards rather than a new scale. The header
// itself is the suite's shared one.

export const DEFAULT_PRINTER_RADIUS = RADIUS.card;
export const DEFAULT_PRINTER_ICON = "mdi:printer-3d";
export const PRINTER_ICON_TINT = 16;

/** Primary/secondary control row. Taller than the vacuum's, because a printer
 *  has four buttons where the vacuum has three. */
export const PRINTER_BUTTON_HEIGHT = 50;
export const PRINTER_PRIMARY_RADIUS = 17;
export const PRINTER_SECONDARY_RADIUS = 25;
/** Both morph to this while pressed — the suite's "list row pressed" value. */
export const PRINTER_BUTTON_RADIUS_PRESSED = 12;
export const PRINTER_BUTTON_PRESS_MS = 400;
export const PRINTER_SECONDARY_TINT = 8;
export const PRINTER_STOP_TINT = 18;
/** How far a control dims while showing a state the printer has not confirmed. */
export const PRINTER_PENDING_OPACITY = 0.62;

/** MQTT is quicker than the vacuum's polling, but a pause still takes a few
 *  seconds to come back. Half the vacuum's window. */
export const PRINTER_OPTIMISTIC_MS = 35_000;

/** Camera preview. */
export const PRINTER_CAMERA_RADIUS = 20;
export const PRINTER_CAMERA_ASPECT = "16 / 10";
export const PRINTER_CAMERA_BUTTON = 32;
export const PRINTER_CAMERA_BUTTON_RADIUS = 16;
export const PRINTER_CAMERA_BUTTON_RADIUS_ACTIVE = 10;
export const PRINTER_CAMERA_BADGE_RADIUS = 9;
/** Seconds between still refreshes. A printed layer takes longer than this. */
export const PRINTER_CAMERA_REFRESH_S = 10;

/** Temperature tiles. */
export const PRINTER_TEMP_PADDING = 9;
export const PRINTER_TEMP_RADIUS = 16;
export const PRINTER_TEMP_TINT = 8;
export const PRINTER_TEMP_VALUE_SIZE = 15;
export const PRINTER_TEMP_LABEL_SIZE = 8;
/** Below this much of the target, the value pulses as "still heating". */
export const PRINTER_HEATING_DELTA = 5;

/** Speed-profile pills. */
export const PRINTER_SPEED_HEIGHT = 40;
export const PRINTER_SPEED_RADIUS = 20;
export const PRINTER_SPEED_RADIUS_ACTIVE = 12;

/** AMS tray tiles. */
export const PRINTER_AMS_PADDING = 9;
export const PRINTER_AMS_RADIUS = 16;
export const PRINTER_AMS_TINT = 5;
export const PRINTER_AMS_SWATCH = 26;
export const PRINTER_AMS_SWATCH_RADIUS = 10;
export const PRINTER_AMS_BAR_HEIGHT = 3;
/** Below this percentage the remaining-filament bar turns amber. */
export const PRINTER_FILAMENT_WARN = 40;

/** Details block. */
export const PRINTER_DETAIL_CHIP_HEIGHT = 28;
export const PRINTER_DETAIL_CHIP_RADIUS = 14;
export const PRINTER_ACCESSORY_HEIGHT = 46;
export const PRINTER_ACCESSORY_RADIUS = 16;
export const PRINTER_ACCESSORY_ICON = 30;
export const PRINTER_ACCESSORY_ICON_RADIUS = 14;
export const PRINTER_ACCESSORY_ICON_RADIUS_ON = 9;

/** Below this the temperatures stack and the speed pills lose their labels. */
export const PRINTER_NARROW_PX = 340;

/**
 * Progress wave. The light card's wave, not a lookalike — the same amplitude,
 * wavelength, stroke, gap and flow — so a print's progress and a lamp's
 * brightness read as one shape across the suite. It has no handle: a handle
 * says "drag me", and progress is not something anyone drags.
 *
 * It used to be drawn in a 100-unit viewBox stretched to the card's width, so a
 * 20-unit wavelength became ~80px on a phone: a long, lazy swell instead of a
 * wave. It is drawn in real pixels now, as the light card's is.
 */
export const PRINTER_WAVE_STROKE = LIGHT_WAVE_STROKE;
export const PRINTER_WAVE_AMPLITUDE = LIGHT_WAVE_AMPLITUDE;
export const PRINTER_WAVE_WAVELENGTH = LIGHT_WAVE_WAVELENGTH;
export const PRINTER_WAVE_GAP = LIGHT_WAVE_GAP;
export const PRINTER_WAVE_PHASE_SPEED = LIGHT_WAVE_PHASE_SPEED;
export const PRINTER_WAVE_AMPLITUDE_LERP = LIGHT_WAVE_AMPLITUDE_LERP;
/** Room for the amplitude and the stroke, with a little air either side. */
export const PRINTER_WAVE_SVG_HEIGHT = 20;

/**
 * The percentage pill in the header — the vacuum card's battery pill, so the
 * two cards' headers end the same way: a pill, then the fold chevron.
 */
export const PRINTER_PROGRESS_PILL_HEIGHT = VACUUM_BATTERY_HEIGHT;
export const PRINTER_PROGRESS_PILL_RADIUS = VACUUM_BATTERY_RADIUS;

// ---- confirm dialog ---------------------------------------------------------
// The shared "are you sure?" sheet. Sized like a small card rather than a
// system alert: it sits on top of a card, so it should look like it came from
// the same suite.

export const CONFIRM_DIALOG_RADIUS = RADIUS.card;
export const CONFIRM_DIALOG_WIDTH = 340;
export const CONFIRM_ICON = 44;
export const CONFIRM_ICON_RADIUS = RADIUS.squircle44;
export const CONFIRM_ICON_TINT = 16;
export const CONFIRM_BUTTON_HEIGHT = 48;
export const CONFIRM_BUTTON_RADIUS = 24;
/** Morphs to this while pressed, like every other button in the suite. */
export const CONFIRM_BUTTON_RADIUS_PRESSED = 12;
export const CONFIRM_BUTTON_PRESS_MS = 400;
export const CONFIRM_CANCEL_TINT = 8;
/** The red a destructive confirmation is painted in. */
export const CONFIRM_DESTRUCTIVE_COLOR = "#e57368";
