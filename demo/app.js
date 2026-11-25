// The demo dashboard: views of cards over the pretend home, a router that
// swaps views the way Home Assistant does (a fresh view, its own nav bar), and
// the switches for theme and language.

import "./ha-shim.js";
import { buildHome, NAMES_DE } from "./home.js";
import { Sim } from "./sim.js";
import { setupNotifications } from "./notify.js";
import { WHATS_NEW } from "./whats-new.js";

// The released bundle sits next to the page on GitHub Pages; working in the
// repository, the page takes the local build.
const onPages = location.hostname.endsWith("github.io");
await import(onPages ? "./m3-cards.js" : "../dist/m3-cards.js");

const BASE = new URL("./", import.meta.url).pathname;
// Embedded in the phone frame of the page around it: no header of its own,
// the settings handed in by that page.
const params = new URLSearchParams(location.search);
const EMBED = params.get("embed") === "1";
if (EMBED) document.body.classList.add("embed");
// A phone opening the page itself gets the phone layout too: the bar as in
// the phone frame (four pages and a menu), not nine entries to scroll.
const narrowQuery = matchMedia("(max-width: 600px)");
const phoneLayout = () => EMBED || narrowQuery.matches;
const sim = new Sim(buildHome(), NAMES_DE);
if (["en", "de", "uk"].includes(params.get("lang"))) sim.setLanguage(params.get("lang"));
window.m3Demo = sim;
const notes = setupNotifications(sim, document.querySelector("header"));

// A view element by Home Assistant's name, so the nav card's page slide stops
// at it and leaves the background and the toolbar where they are.
if (!customElements.get("hui-view")) customElements.define("hui-view", class extends HTMLElement {});

// Every view at a path of its own, the start view too: a bar entry pointing at
// the bare base would count as a prefix of every other view and stay lit.
const nav = (key) => BASE + key;

/** Frosted cards, or solid ones to compare: one switch for every card. */
let glass = params.get("glass") !== "0";

const VIEWS = [
  { key: "home", title: "Home", icon: "mdi:home" },
  { key: "rooms", title: "Rooms", icon: "mdi:floor-plan" },
  { key: "climate", title: "Climate", icon: "mdi:thermostat" },
  { key: "energy", title: "Energy", icon: "mdi:lightning-bolt" },
  { key: "household", title: "Household", icon: "mdi:washing-machine" },
  { key: "security", title: "Security", icon: "mdi:shield-home" },
  { key: "tech", title: "Tech", icon: "mdi:chip" },
  { key: "shapes", title: "Shapes", icon: "mdi:shape-outline" },
  { key: "new", title: "New", icon: "mdi:new-box" },
];

const TITLES_DE = { home: "Start", new: "Neu", rooms: "Räume", climate: "Klima", energy: "Energie", household: "Haushalt", security: "Sicherheit", tech: "Technik", shapes: "Formen" };

const PHONE_BAR = 4;

/**
 * A room folded to one row that opens onto its buttons — the author's own
 * design for their socket overview: a room card in manual mode, collapsible,
 * closed to begin with, holding a button card per device.
 */
function foldedRoom(area, buttons, extra = {}) {
  return {
    type: "custom:m3-room-card", area, mode: "manual", collapsible: true, default_collapsed: true, ...extra,
    cards: buttons.map(([entity, icon]) => ({ type: "custom:m3-button-card", entity, icon, shape_by_state: true, icon_fill: "solid", show_state: false })),
  };
}

/**
 * The nav bar as the visitor has set it in the header's Navbar panel. Each
 * choice is a real option of the card; the panel's YAML button copies them.
 */
const NAV_DEFAULTS = { style: "floating", marker_motion: "stretch", page_transition: "slide", labels: "active", active_style: "solid" };
let navOpts = { ...NAV_DEFAULTS };
try {
  const fromUrl = params.get("nav");
  if (fromUrl) navOpts = { ...navOpts, ...JSON.parse(fromUrl) };
} catch {
  // A broken parameter keeps the defaults.
}

/** Label and icon settings per preset of the panel. */
const NAV_LABELS = {
  active: { label_position: "right", icon_visibility: "active_only", label_visibility: "always" },
  beside: { label_position: "right", icon_visibility: "always", label_visibility: "always" },
  below: { label_position: "below", icon_visibility: "always", label_visibility: "always" },
  current: { label_position: "right", icon_visibility: "always", label_visibility: "active_only" },
  icons: { icon_visibility: "always", label_visibility: "never" },
};

function navCard() {
  const de = sim.language === "de";
  const entry = (v) => ({ name: de ? TITLES_DE[v.key] : v.title, icon: v.icon, path: nav(v.key) });
  const { style, marker_motion, page_transition, labels, active_style } = navOpts;
  let labelling = NAV_LABELS[labels] ?? NAV_LABELS.active;
  // On a phone four entries with every name and the menu button do not fit
  // side by side: every icon, and only the active page's name.
  if (phoneLayout() && labelling.label_visibility === "always") labelling = NAV_LABELS.current;
  return {
    type: "custom:m3-nav-card",
    style,
    ...(style === "floating" || style === "sheet" ? { position: "bottom", max_width: "fit" } : {}),
    ...labelling,
    active_style,
    marker_motion,
    page_transition,
    ...(style === "sheet"
      ? {
          sheet_title: de ? "Schnellzugriff" : "Shortcuts",
          sheet_items: [
            { name: de ? "Filmabend" : "Movie night", icon: "mdi:movie-open", tap_action: { action: "toggle", entity: "scene.movie_night" } },
            { name: de ? "Gute Nacht" : "Good night", icon: "mdi:weather-night", tap_action: { action: "toggle", entity: "scene.good_night" } },
            { name: de ? "Licht" : "Lights", icon: "mdi:lightbulb-group", path: "#lights" },
            { name: de ? "Haushalt" : "Household", icon: "mdi:washing-machine", path: nav("household") },
          ],
        }
      : {}),
    swipe_navigation: true,
    container_style: glass ? "glass" : "solid",
    // On the phone the bar clears the gesture pill under it (and the status
    // bar when it docks at the top); on the desktop a header bar sits under
    // the demo's own header.
    ...(EMBED ? { edge_distance: style === "header" ? 40 : 22 } : style === "header" ? { edge_distance: document.querySelector("header")?.offsetHeight ?? 68 } : {}),
    blur: 20,
    items: (phoneLayout() ? VIEWS.slice(0, PHONE_BAR) : VIEWS).map(entry),
    // Seven pages do not fit a phone's width: there, four in the bar and the
    // rest in the round button's menu beside it, as on a phone dashboard.
    ...(phoneLayout() ? { action_button: { icon: "mdi:dots-horizontal", menu: VIEWS.slice(PHONE_BAR).map(entry) } } : {}),
  };
}

/** Each view: sections of cards, the way a sections dashboard lays them out. */
function views() {
  const de = sim.language === "de";
  const t = (en, deText) => (de ? deText : en);
  return {
    home: [
      [t("Today", "Heute"), [
        { type: "custom:m3-clock-card", style: "tiles", show_date: true },
        { type: "custom:m3-weather-card", entity: "weather.home", sensors: ["sensor.outdoor_temperature", "sensor.outdoor_humidity"] },
        { type: "custom:m3-presence-card", auto_discover: true },
      ]],
      [t("At a glance", "Auf einen Blick"), [
        { type: "custom:m3-energy-flow-card", source: "entities", solar_entity: "sensor.solar_power", grid_entity: "sensor.grid_power", battery_entity: "sensor.battery_power", battery_soc_entity: "sensor.battery_soc", home_entity: "sensor.house_power" },
        { type: "custom:m3-lights-overview-card", auto_discover: true },
      ]],
      [t("Scenes", "Szenen"), [
        { type: "custom:m3-chip-buttons-card", wrap: true, buttons: [
          { entity: "scene.movie_night", name: t("Movie night", "Filmabend"), icon: "mdi:movie-open", tap_action: { action: "toggle" } },
          { entity: "scene.good_night", name: t("Good night", "Gute Nacht"), icon: "mdi:weather-night", tap_action: { action: "toggle" } },
          { entity: "input_boolean.guest_mode", name: t("Guests", "Gäste"), icon: "mdi:account-multiple", tap_action: { action: "toggle" } },
          { entity: "lock.front_door", name: t("Front door", "Haustür"), use_entity_color: true, tap_action: { action: "toggle" } },
        ] },
        { type: "custom:m3-waste-card", entities: ["sensor.waste_recycling", "sensor.waste_paper", "sensor.waste_organic", "sensor.waste_residual"] },
      ]],
    ],
    rooms: [
      ["", [
        { type: "custom:m3-room-card", area: "living_room", collapsible: true },
        { type: "custom:m3-room-card", area: "kitchen", collapsible: true },
        { type: "custom:m3-room-card", area: "bedroom", collapsible: true },
      ]],
      ["", [
        { type: "custom:m3-room-card", area: "kids_room", collapsible: true },
        foldedRoom("office", [["light.desk", "mdi:desk-lamp"], ["switch.desk_plug", "mdi:power-socket-eu"]], { variant: t("folded, with buttons", "eingeklappt, mit Buttons") }),
        { type: "custom:m3-room-card", area: "bathroom", collapsible: true },
      ]],
      [t("Living room", "Wohnzimmer"), [
        { type: "custom:m3-light-card", entity: "light.floor_lamp" },
        { type: "custom:m3-media-card", entity: "media_player.living_room" },
        { type: "custom:m3-cover-card", entity: "cover.living_room" },
      ]],
    ],
    climate: [
      [t("Living room", "Wohnzimmer"), [
        { type: "custom:m3-climate-card", entity: "climate.living_room", temperature_sensor: "sensor.living_room_temperature", humidity_sensor: "sensor.living_room_humidity", show_presets: true },
        { type: "custom:m3-detail-card", entity: "sensor.living_room_temperature", secondary_entity: "sensor.living_room_humidity", show_related: false, details: "hidden" },
      ]],
      [t("Other rooms", "Weitere Räume"), [
        { type: "custom:m3-climate-card-mini", entity: "climate.bedroom" },
        { type: "custom:m3-climate-card-mini", entity: "climate.kids_room" },
        { type: "custom:m3-climate-card-mini", entity: "climate.office" },
        { type: "custom:m3-humidifier-card", entity: "humidifier.bedroom" },
      ]],
      [t("Overview", "Übersicht"), [
        { type: "custom:m3-climate-overview-card", auto_discover: true },
        { type: "custom:m3-multi-graph-card", entities: ["sensor.living_room_temperature", "sensor.bedroom_temperature", "sensor.kids_room_temperature", "sensor.office_temperature"] },
      ]],
    ],
    energy: [
      [t("Right now", "Gerade jetzt"), [
        { type: "custom:m3-energy-flow-card", source: "entities", solar_entity: "sensor.solar_power", grid_entity: "sensor.grid_power", battery_entity: "sensor.battery_power", battery_soc_entity: "sensor.battery_soc", home_entity: "sensor.house_power",
          devices: [
            { entity: "sensor.wallbox_power", icon: "mdi:ev-station" },
            { entity: "sensor.washer_power", icon: "mdi:washing-machine" },
            { entity: "sensor.dishwasher_power", icon: "mdi:dishwasher" },
          ] },
        { type: "custom:m3-gauge-card", style: "needle", entity: "sensor.house_power", name: t("House", "Haus"), min: 0, max: 6000, segments: [{ from: 0, color: "#b3d88a" }, { from: 2500, color: "#f0c987" }, { from: 4500, color: "#e8a08a" }] },
      ]],
      [t("Battery", "Speicher"), [
        { type: "custom:m3-solar-battery-card", name: t("Home battery", "Hausspeicher"), soc: "sensor.battery_soc", battery_power: "sensor.battery_power", solar_power: "sensor.solar_power" },
        { type: "custom:m3-power-list-card", name: t("Appliances", "Verbraucher"), entities: [
          "sensor.wallbox_power", "sensor.washer_power", "sensor.dishwasher_power", "sensor.dryer_power",
          "sensor.fridge_power", "sensor.desk_plug_power", "sensor.tv_plug_power",
        ].map((entity) => ({ entity })) },
      ]],
      [t("Usage", "Verbrauch"), [
        { type: "custom:m3-energy-usage-card", period: "day" },
        { type: "custom:m3-top-consumers-card", source: "energy", period: "today", top_count: 6 },
      ]],
      [t("Costs and tariffs", "Kosten und Tarife"), [
        { type: "custom:m3-tariff-card", show_history: false, active_tariff: "select.tariff",
          tariffs: [
            { name: t("High rate", "Hochtarif"), short: "HT", energy: "sensor.energy_day", price: "sensor.price_day" },
            { name: t("Low rate", "Niedertarif"), short: "NT", energy: "sensor.energy_night", price: "sensor.price_night" },
          ],
          schedule: [{ tariff: "NT", from: "22:00", to: "06:00" }] },
        { type: "custom:m3-cost-card", price_source: "energy_dashboard", period: "month" },
      ]],
      [t("Production", "Erzeugung"), [
        { type: "custom:m3-power-summary-card", grid_entity: "sensor.grid_power", consumption_entity: "sensor.house_power", solar_entity: "sensor.solar_power",
          metrics: [
            { entity: "sensor.house_power", name: t("House", "Haus"), icon: "mdi:home-lightning-bolt" },
            { entity: "sensor.solar_power", name: t("Solar", "PV"), icon: "mdi:solar-power-variant", type: "producer" },
            { entity: "sensor.wallbox_power", name: "Wallbox", icon: "mdi:ev-station" },
          ] },
        { type: "custom:m3-energy-card", entity: "sensor.solar_energy", name: t("Solar production", "PV-Erzeugung"), icon: "mdi:solar-power", accent_color: "#f0c46e", period: "day", days: 7 },
      ]],
    ],
    household: [
      [t("Appliances", "Geräte"), [
        { type: "custom:m3-appliance-card", entity: "sensor.washer_state", name: t("Washing machine", "Waschmaschine"), icon: "mdi:washing-machine",
          progress: { percentage_entity: "sensor.washer_progress", remaining_entity: "sensor.washer_remaining" },
          chips: [{ entity: "sensor.washer_power", name: t("Power", "Leistung"), icon: "mdi:flash", show_state: true }] },
        { type: "custom:m3-appliance-card", entity: "sensor.dishwasher_state", name: t("Dishwasher", "Spülmaschine"), icon: "mdi:dishwasher",
          progress: { remaining_entity: "sensor.dishwasher_remaining" },
          chips: [{ entity: "sensor.dishwasher_power", name: t("Power", "Leistung"), icon: "mdi:flash", show_state: true }] },
        { type: "custom:m3-appliance-card", entity: "sensor.dryer_state", name: t("Dryer", "Trockner"), icon: "mdi:tumble-dryer",
          progress: { percentage_entity: "sensor.dryer_progress", remaining_entity: "sensor.dryer_remaining" },
          chips: [{ entity: "sensor.dryer_power", name: t("Power", "Leistung"), icon: "mdi:flash", show_state: true }] },
        { type: "custom:m3-vacuum-card", entity: "vacuum.robo" },
      ]],
      [t("Lists", "Listen"), [
        { type: "custom:m3-todo-card", entity: "todo.shopping", name: t("Shopping list", "Einkaufsliste") },
        { type: "custom:m3-counter-card", entity: "counter.coffee_capsules" },
      ]],
      [t("Plans", "Planung"), [
        { type: "custom:m3-calendar-card", entities: ["calendar.family", "calendar.school"] },
        { type: "custom:m3-time-card", entity: "input_datetime.alarm_clock", name: t("Alarm clock", "Wecker") },
        { type: "custom:m3-status-card", items: [
          { entity: "input_boolean.plants_watered", name: t("Plants", "Pflanzen"), preset: "yes_no", tap_action: { action: "toggle" } },
          { entity: "input_boolean.fish_fed", name: t("Fish", "Fische"), preset: "yes_no", tap_action: { action: "toggle" } },
        ] },
      ]],
      [t("Supplies", "Vorräte"), [
        { type: "custom:m3-supply-card", items: [
          { entity: "counter.coffee_capsules", name: t("Coffee capsules", "Kaffeekapseln"), icon: "mdi:coffee" },
          { entity: "counter.dishwasher_tabs", name: t("Dishwasher tabs", "Spülmaschinentabs"), icon: "mdi:dishwasher" },
          { entity: "counter.detergent_pods", name: t("Detergent pods", "Waschmittel"), icon: "mdi:washing-machine" },
        ] },
        { type: "custom:m3-vacuum-maintenance-card", entity: "vacuum.robo", reminders: [{ name: t("Empty the bin", "Behälter leeren"), icon: "mdi:delete-empty", every_runs: 3 }] },
        { type: "custom:m3-updates-card" },
      ]],
    ],
    // The same cards in their other looks, each titled with the setting that
    // gives it that look.
    new: WHATS_NEW.sections(t, nav),
    shapes: (() => {
      const flow = { type: "custom:m3-energy-flow-card", source: "entities", solar_entity: "sensor.solar_power", grid_entity: "sensor.grid_power", battery_entity: "sensor.battery_power", battery_soc_entity: "sensor.battery_soc", home_entity: "sensor.house_power" };
      const climate = { type: "custom:m3-climate-card", entity: "climate.living_room", temperature_sensor: "sensor.living_room_temperature", humidity_sensor: "sensor.living_room_humidity", show_presets: true };
      const gauge = { type: "custom:m3-gauge-card", entity: "sensor.house_power", name: t("House", "Haus"), min: 0, max: 6000, segments: [{ from: 0, color: "#b3d88a" }, { from: 2500, color: "#f0c987" }, { from: 4500, color: "#e8a08a" }] };
      const checkin = { type: "custom:m3-checkin-card", entity: "input_boolean.home_office", name: t("Home office", "Homeoffice"), icon: "mdi:laptop", icon_off: "mdi:laptop-off" };
      const status = { type: "custom:m3-status-card", items: [
        { entity: "input_boolean.plants_watered", name: t("Plants", "Pflanzen"), preset: "yes_no", tap_action: { action: "toggle" } },
        { entity: "input_boolean.fish_fed", name: t("Fish", "Fische"), preset: "yes_no", tap_action: { action: "toggle" } },
        { entity: "binary_sensor.front_door", name: t("Front door", "Haustür"), preset: "open_closed" },
      ] };
      const supply = { type: "custom:m3-supply-card", items: [
        { entity: "counter.dishwasher_tabs", name: t("Dishwasher tabs", "Spülmaschinentabs"), icon: "mdi:dishwasher" },
        { entity: "counter.coffee_capsules", name: t("Coffee capsules", "Kaffeekapseln"), icon: "mdi:coffee" },
        { entity: "counter.detergent_pods", name: t("Detergent pods", "Waschmittel"), icon: "mdi:washing-machine" },
      ] };
      return [
        [t("Clocks", "Uhren"), ["tiles", "shapes", "lockscreen", "scallop", "ring"].map((style) => ({ type: "custom:m3-clock-card", style, show_date: true, variant: `style: ${style}` }))],
        [t("Thermostat", "Thermostat"), [
          { ...climate, style: "tiles", variant: "style: tiles" },
          { ...climate, style: "expressive", variant: "style: expressive" },
          { type: "custom:m3-climate-card-mini", entity: "climate.bedroom", variant: t("the small one", "die kleine") },
        ]],
        [t("Dials and energy", "Tacho und Energie"), [
          { ...gauge, variant: t("default: two values, net", "Standard: Bilanz zweier Werte") },
          { ...gauge, style: "needle", variant: "style: needle" },
          { ...flow, layout: "compact", variant: "layout: compact" },
          { type: "custom:m3-power-summary-card", grid_entity: "sensor.grid_power", consumption_entity: "sensor.house_power", solar_entity: "sensor.solar_power", layout: "compact", variant: "layout: compact" },
        ]],
        [t("Switches", "Schalter"), ["segmented", "status", "swipe"].map((style) => ({ ...checkin, style, variant: `style: ${style}` }))],
        [t("People and status", "Personen und Status"), [
          { type: "custom:m3-presence-card", auto_discover: true, layout: "compact", variant: "layout: compact" },
          ...["hero", "grid", "row"].map((layout) => ({ ...status, layout, variant: `layout: ${layout}` })),
        ]],
        [t("Lists", "Listen"), [
          { ...supply, layout: "hero_only", variant: "layout: hero_only" },
          { ...supply, layout: "list_only", variant: "layout: list_only" },
          { type: "custom:m3-calendar-card", entities: ["calendar.family", "calendar.school"], view: "month", variant: "view: month" },
          { type: "custom:m3-lights-overview-card", auto_discover: true, view: "entities", variant: "view: entities" },
        ]],
        // Rooms folded to one row each, opening onto their buttons — the way the
        // author's own socket overview is built.
        [t("Rooms, folded", "Räume, eingeklappt"), [
          ["living_room", [["light.living_ceiling", "mdi:ceiling-light"], ["light.floor_lamp", "mdi:floor-lamp"], ["light.tv_strip", "mdi:led-strip-variant"], ["switch.tv_plug", "mdi:power-socket-eu"]]],
          ["kitchen", [["light.kitchen", "mdi:ceiling-light"], ["light.kitchen_counter", "mdi:light-recessed"]]],
          ["office", [["light.desk", "mdi:desk-lamp"], ["switch.desk_plug", "mdi:power-socket-eu"]]],
          ["bedroom", [["light.bedroom", "mdi:ceiling-light"], ["light.bedside", "mdi:lamp"]]],
        ].map(([area, buttons], i) => foldedRoom(area, buttons, i === 0 ? { variant: "mode: manual · collapsible" } : { untitled: true }))],
        [t("Headings", "Überschriften"), ["simple", "status", "divider", "collapsible"].map((style) => ({
          type: "custom:m3-heading-card", style, title: t("Living room", "Wohnzimmer"), icon: "mdi:sofa", variant: `style: ${style}`,
          ...(style === "divider" ? { label: t("Living room", "Wohnzimmer") } : {}),
          ...(style === "status" ? { count_entities: ["light.living_ceiling", "light.floor_lamp", "light.tv_strip"], action: { name: t("All off", "Alle aus"), icon: "mdi:lightbulb-off-outline", tap_action: { action: "none" } } } : {}),
        }))],
      ];
    })(),
    security: [
      [t("Alarm", "Alarm"), [
        { type: "custom:m3-alarm-card", entity: "alarm_control_panel.home" },
      ]],
      [t("Doors and windows", "Türen und Fenster"), [
        { type: "custom:m3-openings-card", outdoor_temperature: "sensor.outdoor_temperature" },
        { type: "custom:m3-leak-card", auto_discover: true, valve_entity: "valve.main_water" },
      ]],
      [t("Devices", "Geräte"), [
        { type: "custom:m3-battery-card", auto_discover: true },
        { type: "custom:m3-availability-card" },
        { type: "custom:m3-occupancy-card", auto_discover: true },
      ]],
    ],
    tech: [
      [t("On the road", "Unterwegs"), [
        { type: "custom:m3-vehicle-card", name: t("Family car", "Familienauto"),
          energy: { battery: "sensor.car_battery", range: "sensor.car_range", charging: "binary_sensor.car_charging", plugged: "binary_sensor.car_plugged",
            charge_power: "sensor.car_charge_power", charge_limit: "sensor.car_charge_limit", capacity_kwh: 58 },
          lock: "lock.car", location: "device_tracker.car",
          chips: [{ entity: "sensor.car_tyre_front_left", icon: "mdi:car-tire-alert", warn_below: 2.2 }, { entity: "sensor.car_odometer", icon: "mdi:counter" }] },
        { type: "custom:m3-checkin-card", entity: "input_boolean.home_office", name: t("Home office", "Homeoffice"), icon: "mdi:laptop", icon_off: "mdi:laptop-off" },
      ]],
      [t("Gadgets", "Technik"), [
        { type: "custom:m3-printer-card", entity: "sensor.printer_status", progress_entity: "sensor.printer_progress", remaining_entity: "sensor.printer_remaining",
          layer_entity: "sensor.printer_layer", total_layers_entity: "sensor.printer_total_layers", job_name_entity: "sensor.printer_job",
          show_camera: false, show_ams: false },
        { type: "custom:m3-aquarium-card", name: "Aquarium", water_temperature_entity: "sensor.aquarium_temperature", target_range: [24.5, 26],
          light_day: { entity: "switch.aquarium_light" }, light_night: { entity: "switch.aquarium_moonlight" },
          pump: { entity: "switch.aquarium_pump" }, heater: { entity: "switch.aquarium_heater" },
          heater_power_entity: "sensor.aquarium_heater_power", ph_entity: "sensor.aquarium_ph" },
        // The author's own Google TV card: SmartTube, Netflix and Prime as
        // app buttons, started through the remote, lit while running.
        { type: "custom:m3-remote-card", entity: "remote.living_room_tv", name: "Google TV", detail_mode: "sheet",
          apps: [
            ["SmartTube", "mdi:youtube", "#ff0033", "org.smarttube.stable", "vnd.youtube://"],
            ["Netflix", "mdi:netflix", undefined, "com.netflix.ninja", "https://www.netflix.com/title"],
            ["Prime", "mdi:filmstrip", undefined, "com.amazon.amazonvideo.livingroom", "https://app.primevideo.com"],
          ].map(([name, icon, color, app_id, activity]) => ({
            name, icon, ...(color ? { color } : {}), app_id,
            action: { action: "perform-action", perform_action: "remote.turn_on", target: { entity_id: "remote.living_room_tv" }, data: { activity } },
          })) },
      ]],
      [t("Network", "Netzwerk"), [
        { type: "custom:m3-network-card", router: { name: "Router", status: "binary_sensor.router_online", uptime: "sensor.router_online_since",
            connection_type: "sensor.router_connection", download: "sensor.router_download", upload: "sensor.router_upload" },
          device_trackers: ["device_tracker.alex_phone", "device_tracker.mia_phone", "device_tracker.leo_tablet", "device_tracker.living_tv", "device_tracker.printer_wifi", "device_tracker.robo_wifi"] },
      ]],
      [t("Server", "Server"), [
        { type: "custom:m3-system-card", name: t("Home server", "Heimserver") },
        { type: "custom:m3-progress-card", entity: "sensor.washer_state", percentage_entity: "sensor.washer_progress", remaining_entity: "sensor.washer_remaining", name: t("Laundry", "Wäsche"), icon: "mdi:washing-machine" },
      ]],
      ["", [
        { type: "custom:m3-heading-card", style: "status", title: t("Toolbox", "Werkzeugkasten"), icon: "mdi:toolbox-outline" },
        { type: "custom:m3-search-card" },
        { type: "custom:m3-button-card", name: t("All lights", "Alle Lichter"), icon: "mdi:lightbulb-group", tap_action: { action: "navigate", navigation_path: "#lights" } },
        { type: "custom:m3-popup-card", hash: "#lights", width: "560px", cards: [{ type: "custom:m3-lights-overview-card", auto_discover: true }] },
        { type: "custom:m3-button-card", entity: "lock.front_door", name: t("Front door", "Haustür"), icon: "mdi:door-closed-lock", state_colors: { locked: "green", unlocked: "red" }, tap_action: { action: "toggle" } },
        { type: "custom:m3-group-card", gap: 4, cards: [
          { type: "custom:m3-chip-buttons-card", buttons: [
            { entity: "cover.garage_door", name: t("Garage", "Garage"), icon: "mdi:garage", tap_action: { action: "toggle" } },
            { entity: "light.garden", name: t("Garden", "Garten"), icon: "mdi:outdoor-lamp", tap_action: { action: "toggle" } },
            { entity: "input_boolean.vacation", name: t("Vacation", "Urlaub"), icon: "mdi:airplane", tap_action: { action: "toggle" } },
          ] },
        ] },
      ]],
    ],
  };
}

// ---- rendering ----------------------------------------------------------------

const root = document.getElementById("view-root");
let live = [];

function keyFromPath() {
  const asked = new URLSearchParams(location.search).get("view");
  if (asked && VIEWS.some((v) => v.key === asked)) {
    // A link to one view (or a server without a fallback): show it at its path.
    history.replaceState(null, "", nav(asked));
    return asked;
  }
  const rest = location.pathname.startsWith(BASE) ? location.pathname.slice(BASE.length) : "";
  const key = rest.replace(/\/.*$/, "");
  if (VIEWS.some((v) => v.key === key)) return key;
  history.replaceState(null, "", nav("home"));
  return "home";
}

function makeCard(config) {
  const tag = config.type.replace("custom:", "");
  // `variant` only names the look in the demo's title over the card.
  const { variant: _variant, untitled: _untitled, ...own } = config;
  config = tag !== "m3-nav-card" ? { ...withDetails(own), glass_background: glass } : own;
  const el = document.createElement(tag);
  try {
    el.setConfig(config);
  } catch (e) {
    const err = document.createElement("div");
    err.className = "card-error";
    err.textContent = `${tag}: ${e.message}`;
    return err;
  }
  el.hass = sim.hass;
  live.push(el);
  return el;
}

let shown;
let reelShown = false;
window.m3DemoView = () => shown?.key;
// A scenario that opens the household plays its own story there.
window.m3DemoNoReel = () => {
  reelShown = true;
};
window.m3DemoGo = (key) => {
  history.pushState(null, "", nav(key));
  window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
};
/**
 * A card with its own name over it — "M3 Climate Card · m3-climate-card" —
 * linking to its documentation, so a visitor always knows which card is which.
 * The popup has no place on the page until it opens, so it goes untitled.
 */
function withTitle(config, el) {
  const tag = config.type.replace("custom:", "");
  if (tag === "m3-popup-card" || config.untitled) return el;
  const info = (window.customCards ?? []).find((c) => c.type === tag);
  const wrap = document.createElement("div");
  wrap.className = "card-wrap";
  const title = document.createElement("div");
  title.className = "card-title";
  const link = document.createElement("a");
  link.href = info?.documentationURL ?? "https://github.com/j0sp0r/m3-cards#readme";
  link.target = "_blank";
  link.rel = "noopener";
  link.title = sim.language === "de" ? "Zur Dokumentation" : "Open the documentation";
  const name = document.createElement("span");
  name.textContent = info?.name ?? tag;
  const code = document.createElement("code");
  code.textContent = tag;
  link.append(name, code);
  title.append(link);
  if (config.variant) {
    const v = document.createElement("em");
    v.textContent = config.variant;
    title.append(v);
  }
  title.append(copyButton(config));
  wrap.append(title, el);
  return wrap;
}

/**
 * Every tap that would open Home Assistant's more-info opens the suite's own
 * detail sheet instead — the demo has no more-info dialog, and the sheet is
 * the part worth showing. Cards inside a card get it too.
 */
function withDetails(config) {
  if (!config || typeof config !== "object" || !String(config.type ?? "").startsWith("custom:m3-")) return config;
  if (config.type === "custom:m3-nav-card" || config.type === "custom:m3-popup-card") {
    return config.cards ? { ...config, cards: config.cards.map(withDetails) } : config;
  }
  return { detail_mode: "sheet", ...config, ...(Array.isArray(config.cards) ? { cards: config.cards.map(withDetails) } : {}) };
}

/** The card's configuration as YAML, the way it goes into a dashboard. */
function cardYaml(config) {
  const { variant: _v, untitled: _u, ...own } = config;
  return toYaml(withDetails(own));
}

function copyButton(config) {
  const de = sim.language === "de";
  const btn = document.createElement("button");
  btn.className = "copy-yaml";
  btn.type = "button";
  btn.title = de ? "YAML dieser Kachel kopieren" : "Copy this card's YAML";
  const icon = document.createElement("ha-icon");
  icon.icon = "mdi:content-copy";
  const label = document.createElement("span");
  label.textContent = "YAML";
  btn.append(icon, label);
  btn.addEventListener("click", async () => {
    const ok = await copyText(cardYaml(config));
    icon.icon = ok ? "mdi:check" : "mdi:alert-circle-outline";
    label.textContent = ok ? (de ? "Kopiert" : "Copied") : de ? "Fehler" : "Failed";
    btn.classList.toggle("done", ok);
    setTimeout(() => {
      icon.icon = "mdi:content-copy";
      label.textContent = "YAML";
      btn.classList.remove("done");
    }, 1600);
  });
  return btn;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // An older browser, or a page without clipboard access: the old way.
    const area = document.createElement("textarea");
    area.value = text;
    area.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

// ---- yaml -------------------------------------------------------------------------

/** A string as YAML wants it: bare where that reads back the same, quoted otherwise. */
function yamlString(v) {
  const plain =
    v !== "" &&
    !/^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(v) &&
    !/:\s|\s#|:$|\s$/.test(v) &&
    !/^(true|false|yes|no|on|off|null|~)$/i.test(v) &&
    !/^[-+]?(\d[\d_]*)?(\.\d+)?([eE][-+]?\d+)?$/.test(v) &&
    !/[\n\t]/.test(v);
  return plain ? v : JSON.stringify(v);
}

function yamlScalar(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return yamlString(v);
  return String(v);
}

/** Plain objects, lists and scalars to block-style YAML, two spaces a level. */
function toYaml(value, indent = "") {
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return value
      .map((item) => {
        if (item && typeof item === "object" && !Array.isArray(item) && Object.keys(item).length) {
          const body = toYaml(item, indent + "  ");
          return `${indent}- ${body.slice(indent.length + 2)}`;
        }
        if (Array.isArray(item) && item.length) return `${indent}-\n${toYaml(item, indent + "  ")}`;
        return `${indent}- ${item && typeof item === "object" ? (Array.isArray(item) ? "[]" : "{}") : yamlScalar(item)}`;
      })
      .join("\n");
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined);
    if (!keys.length) return "{}";
    return keys
      .map((k) => {
        const v = value[k];
        const key = `${indent}${yamlString(k)}:`;
        if (Array.isArray(v)) return v.length ? `${key}\n${toYaml(v, indent + "  ")}` : `${key} []`;
        if (v && typeof v === "object") return Object.keys(v).length ? `${key}\n${toYaml(v, indent + "  ")}` : `${key} {}`;
        return `${key} ${yamlScalar(v)}`;
      })
      .join("\n");
  }
  return yamlScalar(value);
}
window.m3DemoYaml = toYaml;

/** The head of the "New" view: which release, when, and what it brought. */
function whatsNewHead() {
  const de = sim.language === "de";
  const head = document.createElement("div");
  head.className = "whats-new";
  const date = new Date(`${WHATS_NEW.date}T12:00:00`).toLocaleDateString(de ? "de-DE" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
  const { cards, features } = WHATS_NEW.counts;
  const chip = (icon, text) => `<span class="wn-chip"><ha-icon icon="${icon}"></ha-icon>${text}</span>`;
  head.innerHTML = `
    <div class="wn-icon"><ha-icon icon="mdi:new-box"></ha-icon></div>
    <div class="wn-body">
      <div class="wn-kicker">${de ? "Neu im letzten Release" : "New in the latest release"}</div>
      <h1>M3 Cards ${WHATS_NEW.version}</h1>
      <div class="wn-meta">
        ${chip("mdi:calendar", date)}
        ${cards ? chip("mdi:card-plus-outline", de ? `${cards} neue ${cards === 1 ? "Karte" : "Karten"}` : `${cards} new card${cards === 1 ? "" : "s"}`) : ""}
        ${chip("mdi:creation-outline", de ? `${features} neue Funktionen` : `${features} new features`)}
      </div>
      <p></p>
      <a class="wn-link" target="_blank" rel="noopener" href="https://github.com/j0sp0r/m3-cards/releases/tag/v${WHATS_NEW.version}">
        ${de ? "Alle Änderungen in den Release-Notes" : "Everything in the release notes"}<ha-icon icon="mdi:arrow-top-right"></ha-icon>
      </a>
    </div>`;
  head.querySelector("p").textContent = de ? WHATS_NEW.summary.de : WHATS_NEW.summary.en;
  return head;
}

/**
 * The bar where its style puts it: a header or an inline segmented bar
 * first in the view, the others last (they position themselves on screen).
 */
function placeNav(view, el) {
  const top = navOpts.style === "header" || navOpts.style === "segmented";
  document.body.classList.toggle("nav-header", navOpts.style === "header");
  if (top) view.prepend(el);
  else view.appendChild(el);
}

/** A new bar after a change in the Navbar panel, the page left as it is. */
function refreshNav() {
  const view = root.querySelector("hui-view");
  if (!view) return;
  const old = view.querySelector(":scope > m3-nav-card");
  if (old) {
    live = live.filter((el) => el !== old);
    old.remove();
  }
  placeNav(view, makeCard(navCard()));
}

// ---- layout -------------------------------------------------------------------

/**
 * Sections into columns the way Home Assistant's masonry view does it: each
 * goes to the column that is shortest so far, in order, so the columns end
 * near the same height instead of leaving a gap under a short one. Cards
 * draw a moment after they are connected and some load data later, so the
 * layout is measured again once they have settled, and again on resize.
 */
const COLUMN_MIN = 340;
const COLUMN_GAP = 20;
let layoutState;

function masonry(grid, groups) {
  layoutState = { grid, groups, assignment: "" };
  // The first pass can only guess the heights; the cards draw a frame or two
  // later. The grid stays invisible until it is laid out by the real ones,
  // so a change of page shows no reshuffle.
  grid.classList.add("settling");
  arrange();
  const settle = () => {
    if (layoutState?.grid !== grid) return;
    arrange();
    grid.classList.remove("settling");
  };
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(settle, 60)));
  // A safety net: never hidden for long, whatever the cards do.
  setTimeout(() => grid.classList.remove("settling"), 600);
  // Cards that load data later (graphs, calendars) can still change height.
  for (const wait of [900, 2000]) setTimeout(() => layoutState?.grid === grid && arrange(), wait);
}

const CARD_GAP = 12;
const HEADING = 40;

/**
 * Columns that end near the same height. Sections go to the shortest column
 * in order; one taller than a column's even share on its own is split once,
 * and the rest carries on at the top of the next shortest column under the
 * same heading.
 */
function arrange() {
  const { grid, groups } = layoutState;
  // Hidden behind the phone frame the page has no width: measured then, it
  // would all go into one column. It is laid out again on coming back.
  const width = grid.clientWidth;
  if (!width) return;
  const cardCount = groups.reduce((n, g) => n + g.cards.length, 0);
  const most = Math.max(1, Math.min(cardCount, Math.floor((width + COLUMN_GAP) / (COLUMN_MIN + COLUMN_GAP))));
  // Before the first layout the cards are not on the page yet: a guess.
  const h = (el) => (el.isConnected && el.offsetHeight) || 300;
  const chunkHeight = (g, cards) => (g.title ? HEADING : 0) + cards.reduce((t, el) => t + h(el), 0) + CARD_GAP * Math.max(0, cards.length - 1);
  const total = groups.reduce((t, g) => t + chunkHeight(g, g.cards) + COLUMN_GAP, 0);

  const layout = (count) => {
    const share = total / count;
    const cols = Array.from({ length: count }, () => ({ height: 0, chunks: [] }));
    const queue = groups.map((g, i) => ({ g, i, cards: [...g.cards], cont: false }));
    let splits = 0;
    while (queue.length) {
      const item = queue.shift();
      const col = cols.reduce((a, b) => (b.height < a.height - 1 ? b : a));
      let take = item.cards.length;
      // Split only a section that is taller than a column's share on its own,
      // and only once, so headings do not repeat down the page.
      // Two cards under one heading stay together; a split would only repeat it.
      if (take > 2 && count > 1 && !item.cont && chunkHeight(item.g, item.cards) > share * 1.12) {
        take = 1;
        while (take < item.cards.length && chunkHeight(item.g, item.cards.slice(0, take + 1)) <= share * 1.05) take++;
      }
      const cards = item.cards.slice(0, take);
      col.chunks.push({ g: item.g, i: item.i, cards, cont: item.cont });
      col.height += chunkHeight(item.g, cards) + COLUMN_GAP;
      if (take < item.cards.length) {
        splits++;
        queue.unshift({ ...item, cards: item.cards.slice(take), cont: true });
      }
    }
    const heights = cols.map((c) => c.height);
    const tallest = Math.max(...heights);
    // How unevenly the columns end, plus a little for every heading that repeats.
    const score = (tallest - Math.min(...heights)) / tallest + splits * 0.08;
    return { cols, score };
  };
  // Every column the width allows, or one fewer when that ends more evenly:
  // a page with little on it reads better in three full columns than four
  // ragged ones.
  let best = layout(most);
  if (most > 2) {
    const fewer = layout(most - 1);
    if (fewer.score < best.score - 0.1) best = fewer;
  }
  const cols = best.cols;
  const all = groups.flatMap((g) => g.cards);
  const assignment = cols.map((c) => c.chunks.map((k) => `${k.i}:${k.cards.map((el) => all.indexOf(el)).join(".")}`).join(",")).join("|");
  if (assignment === layoutState.assignment) return;
  layoutState.assignment = assignment;
  const columns = cols.map((c) => {
    const col = document.createElement("div");
    col.className = "column";
    for (const k of c.chunks) {
      const section = document.createElement("div");
      section.className = "section";
      if (k.g.title) {
        const head = document.createElement("h2");
        head.textContent = k.g.title;
        section.appendChild(head);
      }
      section.append(...k.cards);
      col.appendChild(section);
    }
    return col;
  });
  grid.replaceChildren(...columns);
}

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => layoutState && arrange(), 150);
});

function render(force = false) {
  const key = keyFromPath();
  // A change of hash only (a popup opening) is not a change of view.
  // A change of hash (a popup) or of a path below the view (the New view's
  // demo bars, /new/x2) is not a change of view.
  if (!force && key === shown?.key) return;
  shown = { key, path: location.pathname };
  // The household runs once in fast forward the first time its page opens,
  // so the appliances move and their notifications come beside them.
  if (key === "household" && !reelShown) {
    reelShown = true;
    setTimeout(() => shown?.key === "household" && sim.showReel(), 1200);
  }
  live = [];
  const view = document.createElement("hui-view");
  view.dataset.view = key;
  const grid = document.createElement("div");
  grid.className = "sections";
  // Sections as data: the layout builds their containers, so a tall one can
  // be split across two columns.
  // A popup has no place on the page and opens as a modal dialog; moved by
  // the layout while open, a dialog drops out of the top layer and stays
  // behind the cards. So popups sit on the view itself, outside the columns.
  const isPopup = (c) => c.type === "custom:m3-popup-card";
  const popups = views()[key].flatMap(([, cards]) => cards.filter(isPopup)).map((c) => makeCard(c));
  const groups = views()[key]
    .map(([title, cards]) => ({ title, cards: cards.filter((c) => !isPopup(c)).map((c) => withTitle(c, makeCard(c))) }))
    .filter((g) => g.cards.length);
  if (key === "new") view.appendChild(whatsNewHead());
  view.appendChild(grid);
  view.append(...popups);
  placeNav(view, makeCard(navCard()));
  root.replaceChildren(view);
  masonry(grid, groups);
  document.title = `${(sim.language === "de" ? TITLES_DE[key] : VIEWS.find((v) => v.key === key).title)} · M3 Cards demo`;
}

sim.subscribe((hass) => {
  for (const el of live) el.hass = hass;
});

window.addEventListener("location-changed", () => render());
window.addEventListener("popstate", () => render());

// ---- switches -----------------------------------------------------------------

const themeBtn = document.getElementById("theme");
const glassBtn = document.getElementById("glass");
const titlesBtn = document.getElementById("titles");
const langBtn = document.getElementById("lang");
const phoneBtn = document.getElementById("phone");
let titles = params.get("titles") !== "0";
let dark = params.has("theme") ? params.get("theme") === "dark" : !matchMedia("(prefers-color-scheme: light)").matches;
let phone = false;
const de = () => sim.language === "de";

/** The settings as they stand, for the phone frame's page. */
const settings = () => ({ theme: dark ? "dark" : "light", lang: sim.language, glass, titles, nav: navOpts });

function paintSwitches() {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.body.classList.toggle("no-titles", !titles);
  themeBtn.querySelector("ha-icon").icon = dark ? "mdi:weather-sunny" : "mdi:weather-night";
  glassBtn.querySelector("ha-icon").icon = "mdi:blur";
  glassBtn.classList.toggle("on", glass);
  titlesBtn.classList.toggle("on", titles);
  phoneBtn.classList.toggle("on", phone);
  const label = (btn, text) => {
    btn.querySelector(".lbl").textContent = text;
  };
  label(phoneBtn, de() ? "Handy" : "Phone");
  label(navBtn, "Navbar");
  navBtn.title = de() ? "Navbar-Varianten ausprobieren" : "Try the navbar's variants";
  label(titlesBtn, de() ? "Kartennamen" : "Card names");
  label(glassBtn, de() ? "Glas" : "Glass");
  label(themeBtn, dark ? (de() ? "Hell" : "Light") : de() ? "Dunkel" : "Dark");
  label(langBtn, LANGUAGES.find((l) => l.code === sim.language)?.name ?? sim.language);
  langBtn.title = de() ? "Sprache" : "Language";
  glassBtn.title = de() ? (glass ? "Glas an — für deckende Kacheln tippen" : "Glas aus — für Glas tippen") : glass ? "Glass on — tap for solid cards" : "Glass off — tap for glass";
  titlesBtn.title = de() ? (titles ? "Kartennamen ausblenden" : "Kartennamen einblenden") : titles ? "Hide card names" : "Show card names";
  phoneBtn.title = de() ? (phone ? "Zurück zur Desktop-Ansicht" : "Als Smartphone ansehen") : phone ? "Back to the desktop view" : "View as a phone";
  themeBtn.title = dark ? (de() ? "Zum hellen Design" : "Switch to light") : de() ? "Zum dunklen Design" : "Switch to dark";
  notes.relabel();
}

/** Applies settings here — and, from the page around it, in the phone frame. */
function apply(next = {}, { rerender = false } = {}) {
  if (next.theme) dark = next.theme === "dark";
  if (next.lang && next.lang !== sim.language) {
    sim.setLanguage(next.lang);
    rerender = true;
  }
  if (next.glass !== undefined && next.glass !== glass) {
    glass = next.glass;
    rerender = true;
  }
  if (next.titles !== undefined) titles = next.titles;
  if (next.nav && JSON.stringify(next.nav) !== JSON.stringify(navOpts)) {
    navOpts = { ...next.nav };
    refreshNav();
  }
  sim.setDark(dark);
  paintSwitches();
  if (rerender) render(true);
  if (phone) frame?.contentWindow?.m3DemoApply?.(settings());
}
window.m3DemoApply = (s) => apply(s);

themeBtn.addEventListener("click", () => apply({ theme: dark ? "light" : "dark" }));
glassBtn.addEventListener("click", () => apply({ glass: !glass }));
titlesBtn.addEventListener("click", () => apply({ titles: !titles }));
// ---- language menu ----------------------------------------------------------------

/**
 * The languages the cards speak. Another one is a line here once a translation
 * for it exists (the cards take extra languages from window.m3CardsTranslations).
 */
const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "de", name: "Deutsch" },
  // The cards' own Ukrainian (#59); the demo's page texts stay English.
  { code: "uk", name: "Українська" },
];
const langMenu = document.createElement("div");
langMenu.className = "lang-menu";
langMenu.hidden = true;
document.body.appendChild(langMenu);
function paintLangMenu() {
  langMenu.replaceChildren(
    ...LANGUAGES.map(({ code, name }) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = code === sim.language ? "current" : "";
      const check = document.createElement("ha-icon");
      check.icon = "mdi:check";
      check.style.visibility = code === sim.language ? "visible" : "hidden";
      const label = document.createElement("span");
      label.textContent = name;
      b.append(check, label);
      b.addEventListener("click", () => {
        langMenu.hidden = true;
        apply({ lang: code });
      });
      return b;
    }),
  );
}
langBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  paintLangMenu();
  const r = langBtn.getBoundingClientRect();
  langMenu.style.top = `${r.bottom + 8}px`;
  langMenu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
  langMenu.hidden = !langMenu.hidden;
});
document.addEventListener("click", (e) => {
  if (!langMenu.hidden && !langMenu.contains(e.target)) langMenu.hidden = true;
});

// ---- navbar panel ---------------------------------------------------------------

/** The choices of the Navbar panel: an option of the card and its values. */
const NAV_CHOICES = [
  ["style", ["Style", "Stil"], [
    ["floating", ["Floating", "Schwebend"]], ["footer", ["Footer", "Fußleiste"]], ["header", ["Header", "Kopfleiste"]],
    ["segmented", ["Segmented", "Segmentiert"]], ["sheet", ["With a drawer", "Mit Schublade"]],
  ]],
  ["marker_motion", ["Marker", "Markierung"], [
    ["stretch", ["Stretch", "Dehnen"]], ["spring", ["Spring", "Federn"]], ["slide", ["Slide", "Gleiten"]], ["none", ["None", "Keine"]],
  ]],
  ["page_transition", ["Page change", "Seitenwechsel"], [
    ["slide", ["Slide", "Seitlich"]], ["up", ["Rise", "Aufsteigen"]], ["fade", ["Fade", "Überblenden"]], ["none", ["None", "Keiner"]],
  ]],
  ["labels", ["Labels", "Beschriftung"], [
    ["active", ["Icon on the active one", "Icon nur aktiv"]], ["beside", ["Icon and name", "Icon und Name"]], ["below", ["Name below", "Name darunter"]],
    ["current", ["Active name only", "Nur aktiver Name"]], ["icons", ["Icons only", "Nur Icons"]],
  ]],
  ["active_style", ["Active entry", "Aktiver Eintrag"], [["solid", ["Filled", "Gefüllt"]], ["tint", ["Tinted", "Getönt"]]]],
];

const navBtn = document.getElementById("navbar");
const navPanel = document.createElement("div");
navPanel.className = "nav-panel";
navPanel.hidden = true;
document.body.appendChild(navPanel);
// A choice repaints the panel, so its button is gone by the time the click
// reaches the document — which would read as a click outside.
navPanel.addEventListener("click", (e) => e.stopPropagation());

function setNav(change) {
  navOpts = { ...navOpts, ...change };
  refreshNav();
  paintNavPanel();
  if (phone) frame?.contentWindow?.m3DemoApply?.(settings());
}

function paintNavPanel() {
  const de = sim.language === "de";
  const pick = ([en, deText]) => (de ? deText : en);
  navPanel.replaceChildren();
  const head = document.createElement("h3");
  head.textContent = de ? "Navbar ausprobieren" : "Try the navbar";
  navPanel.appendChild(head);
  for (const [key, label, values] of NAV_CHOICES) {
    const row = document.createElement("div");
    row.className = "np-row";
    const name = document.createElement("div");
    name.className = "np-label";
    name.innerHTML = `${pick(label)} <code></code>`;
    name.querySelector("code").textContent = key === "labels" ? "label_* / icon_visibility" : key;
    const chips = document.createElement("div");
    chips.className = "np-chips";
    for (const [value, text] of values) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = pick(text);
      b.title = key === "labels" ? Object.entries(NAV_LABELS[value]).map(([k, v]) => `${k}: ${v}`).join("\n") : `${key}: ${value}`;
      b.classList.toggle("on", navOpts[key] === value);
      b.addEventListener("click", () => setNav({ [key]: value }));
      chips.appendChild(b);
    }
    row.append(name, chips);
    navPanel.appendChild(row);
  }
  const foot = document.createElement("div");
  foot.className = "np-foot";
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "np-reset";
  reset.textContent = de ? "Zurücksetzen" : "Reset";
  reset.addEventListener("click", () => setNav({ ...NAV_DEFAULTS }));
  // The bar's YAML as it stands, the demo's own glass switch left out.
  const { container_style: _c, blur: _b, ...yamlConfig } = navCard();
  foot.append(reset, copyButton(yamlConfig));
  navPanel.appendChild(foot);
}

navBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  paintNavPanel();
  const r = navBtn.getBoundingClientRect();
  navPanel.style.top = `${r.bottom + 8}px`;
  navPanel.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
  navPanel.hidden = !navPanel.hidden;
  navBtn.classList.toggle("open", !navPanel.hidden);
});
document.addEventListener("click", (e) => {
  if (!navPanel.hidden && !navPanel.contains(e.target) && e.target !== navBtn) {
    navPanel.hidden = true;
    navBtn.classList.remove("open");
  }
});

// ---- phone ----------------------------------------------------------------------

/**
 * The page at a phone's width, in a phone: an embedded copy of this page in a
 * 393 × 852 frame, so the nav bar docks to the phone's bottom edge, swipes
 * and notifications happen inside it, and nothing is squeezed by hand. The
 * settings and the scenarios here are handed to it.
 */
let frame;
const phoneHost = document.getElementById("phone-host");

/** The phone's status bar: the time on the left, signal, Wi-Fi and battery on the right. */
let statusTimer;
function statusBar() {
  const bar = document.createElement("div");
  bar.className = "phone-status";
  bar.innerHTML = `<span class="time"></span>
    <span class="icons"><ha-icon icon="mdi:signal-cellular-3"></ha-icon><ha-icon icon="mdi:wifi"></ha-icon>
      <span class="battery"><span>84</span><ha-icon icon="mdi:battery-80"></ha-icon></span></span>`;
  const time = bar.querySelector(".time");
  const tick = () => {
    time.textContent = new Date().toLocaleTimeString(sim.language === "de" ? "de-DE" : "en-GB", { hour: "2-digit", minute: "2-digit" });
  };
  tick();
  clearInterval(statusTimer);
  statusTimer = setInterval(tick, 10_000);
  return bar;
}
function setPhone(on) {
  phone = on;
  document.body.classList.toggle("phone-mode", on);
  if (on) {
    const q = new URLSearchParams({ embed: "1", view: shown?.key ?? "home", ...Object.fromEntries(Object.entries(settings()).map(([k, v]) => [k, typeof v === "boolean" ? (v ? "1" : "0") : typeof v === "object" ? JSON.stringify(v) : v])) });
    frame = document.createElement("iframe");
    frame.title = "M3 Cards demo on a phone";
    frame.src = `${BASE}index.html?${q}`;
    const bezel = document.createElement("div");
    bezel.className = "phone-frame";
    bezel.append(frame, statusBar(), Object.assign(document.createElement("div"), { className: "phone-pill" }));
    phoneHost.replaceChildren(bezel);
  } else {
    phoneHost.replaceChildren();
    frame = undefined;
  }
  // Back on the desktop, after the page is shown again.
  if (!on) requestAnimationFrame(() => layoutState && arrange());
  paintSwitches();
}
phoneBtn.addEventListener("click", () => setPhone(!phone));
window.m3DemoScenarioTarget = () => (phone ? frame?.contentWindow : null);

// On a phone the tools sit behind one button; a choice closes the list
// unless it opens a panel of its own.
const toolsBtn = document.getElementById("tools-btn");
const tools = document.getElementById("tools");
toolsBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  tools.classList.toggle("open");
  toolsBtn.classList.toggle("open", tools.classList.contains("open"));
});
document.addEventListener("click", (e) => {
  if (tools.classList.contains("open") && !tools.contains(e.target) && e.target !== toolsBtn) {
    tools.classList.remove("open");
    toolsBtn.classList.remove("open");
  }
});
for (const b of tools.querySelectorAll("#titles, #glass, #theme, a")) {
  b.addEventListener("click", () => {
    tools.classList.remove("open");
    toolsBtn.classList.remove("open");
  });
}

// Turning a tablet or resizing the window across the line swaps the bar.
narrowQuery.addEventListener("change", () => refreshNav());

paintSwitches();
sim.setDark(dark);
// The nav bar measures its entries to place its pill: wait for the type.
await document.fonts.ready;
render();

