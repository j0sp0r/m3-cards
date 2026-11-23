// The demo dashboard: views of cards over the pretend home, a router that
// swaps views the way Home Assistant does (a fresh view, its own nav bar), and
// the switches for theme and language.

import "./ha-shim.js";
import { buildHome, NAMES_DE } from "./home.js";
import { Sim } from "./sim.js";
import { setupNotifications } from "./notify.js";

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
const sim = new Sim(buildHome(), NAMES_DE);
if (params.get("lang") === "de" || params.get("lang") === "en") sim.setLanguage(params.get("lang"));
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
  { key: "more", title: "More", icon: "mdi:dots-grid" },
];

const TITLES_DE = { home: "Start", rooms: "Räume", climate: "Klima", energy: "Energie", household: "Haushalt", security: "Sicherheit", more: "Mehr" };

const PHONE_BAR = 4;

function navCard() {
  const de = sim.language === "de";
  const entry = (v) => ({ name: de ? TITLES_DE[v.key] : v.title, icon: v.icon, path: nav(v.key) });
  return {
    type: "custom:m3-nav-card",
    style: "floating",
    position: "bottom",
    max_width: "fit",
    label_position: "right",
    // On a phone every icon and only the active page's name, or four entries
    // and the menu button do not fit side by side.
    icon_visibility: EMBED ? "always" : "active_only",
    label_visibility: EMBED ? "active_only" : "always",
    active_style: "solid",
    marker_motion: "stretch",
    page_transition: "slide",
    swipe_navigation: true,
    container_style: glass ? "glass" : "solid",
    blur: 20,
    items: (EMBED ? VIEWS.slice(0, PHONE_BAR) : VIEWS).map(entry),
    // Seven pages do not fit a phone's width: there, four in the bar and the
    // rest in the round button's menu beside it, as on a phone dashboard.
    ...(EMBED ? { action_button: { icon: "mdi:dots-horizontal", menu: VIEWS.slice(PHONE_BAR).map(entry) } } : {}),
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
        { type: "custom:m3-room-card", area: "office", collapsible: true },
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
        { type: "custom:m3-energy-flow-card", source: "entities", solar_entity: "sensor.solar_power", grid_entity: "sensor.grid_power", battery_entity: "sensor.battery_power", battery_soc_entity: "sensor.battery_soc", home_entity: "sensor.house_power" },
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
    more: [
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
        { type: "custom:m3-remote-card", entity: "remote.living_room_tv" },
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
  if (tag !== "m3-nav-card") config = { ...config, glass_background: glass };
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
/**
 * A card with its own name over it — "M3 Climate Card · m3-climate-card" —
 * linking to its documentation, so a visitor always knows which card is which.
 * The popup has no place on the page until it opens, so it goes untitled.
 */
function withTitle(config, el) {
  const tag = config.type.replace("custom:", "");
  if (tag === "m3-popup-card") return el;
  const info = (window.customCards ?? []).find((c) => c.type === tag);
  const wrap = document.createElement("div");
  wrap.className = "card-wrap";
  const title = document.createElement("a");
  title.className = "card-title";
  title.href = info?.documentationURL ?? "https://github.com/j0sp0r/m3-cards#readme";
  title.target = "_blank";
  title.rel = "noopener";
  const name = document.createElement("span");
  name.textContent = info?.name ?? tag;
  const code = document.createElement("code");
  code.textContent = tag;
  title.append(name, code);
  wrap.append(title, el);
  return wrap;
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

function masonry(grid, sections) {
  layoutState = { grid, sections, assignment: "" };
  arrange();
  for (const wait of [250, 900, 2000]) setTimeout(() => layoutState?.grid === grid && arrange(), wait);
}

function arrange() {
  const { grid, sections } = layoutState;
  const width = grid.clientWidth || root.clientWidth;
  const count = Math.max(1, Math.min(sections.length, Math.floor((width + COLUMN_GAP) / (COLUMN_MIN + COLUMN_GAP))));
  // Heights as the sections stand now; before the first layout they all sit
  // in one column of the same width, so they compare fairly.
  const heights = sections.map((s) => s.offsetHeight || 300);
  const cols = Array.from({ length: count }, () => ({ height: 0, items: [] }));
  sections.forEach((s, i) => {
    const target = cols.reduce((a, b) => (b.height < a.height - 1 ? b : a));
    target.items.push(i);
    target.height += heights[i] + COLUMN_GAP;
  });
  const assignment = cols.map((c) => c.items.join(",")).join("|");
  if (assignment === layoutState.assignment) return;
  layoutState.assignment = assignment;
  const columns = cols.map((c) => {
    const col = document.createElement("div");
    col.className = "column";
    for (const i of c.items) col.appendChild(sections[i]);
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
  if (!force && key === shown?.key && location.pathname === shown?.path) return;
  shown = { key, path: location.pathname };
  live = [];
  const view = document.createElement("hui-view");
  view.dataset.view = key;
  const grid = document.createElement("div");
  grid.className = "sections";
  const sections = [];
  for (const [title, cards] of views()[key]) {
    const section = document.createElement("div");
    section.className = "section";
    if (title) {
      const h = document.createElement("h2");
      h.textContent = title;
      section.appendChild(h);
    }
    for (const c of cards) section.appendChild(withTitle(c, makeCard(c)));
    sections.push(section);
  }
  view.appendChild(grid);
  view.appendChild(makeCard(navCard()));
  root.replaceChildren(view);
  masonry(grid, sections);
  document.title = `${(sim.language === "de" ? TITLES_DE[key] : VIEWS.find((v) => v.key === key).title)} · M3 Cards demo`;
}

sim.subscribe((hass) => {
  for (const el of live) el.hass = hass;
});

window.addEventListener("location-changed", render);
window.addEventListener("popstate", render);

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
const settings = () => ({ theme: dark ? "dark" : "light", lang: sim.language, glass, titles });

function paintSwitches() {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.body.classList.toggle("no-titles", !titles);
  themeBtn.querySelector("ha-icon").icon = dark ? "mdi:weather-sunny" : "mdi:weather-night";
  glassBtn.querySelector("ha-icon").icon = glass ? "mdi:blur" : "mdi:square-rounded";
  glassBtn.classList.toggle("off", !glass);
  titlesBtn.classList.toggle("off", !titles);
  phoneBtn.classList.toggle("off", phone);
  langBtn.textContent = de() ? "EN" : "DE";
  glassBtn.title = de() ? (glass ? "Glas an — für deckende Kacheln tippen" : "Glas aus — für Glas tippen") : glass ? "Glass on — tap for solid cards" : "Glass off — tap for glass";
  titlesBtn.title = de() ? (titles ? "Kartennamen ausblenden" : "Kartennamen einblenden") : titles ? "Hide card names" : "Show card names";
  phoneBtn.title = de() ? (phone ? "Zurück zur Desktop-Ansicht" : "Als Smartphone ansehen") : phone ? "Back to the desktop view" : "View as a phone";
  themeBtn.title = de() ? "Hell / dunkel" : "Light / dark";
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
  sim.setDark(dark);
  paintSwitches();
  if (rerender) render(true);
  if (phone) frame?.contentWindow?.m3DemoApply?.(settings());
}
window.m3DemoApply = (s) => apply(s);

themeBtn.addEventListener("click", () => apply({ theme: dark ? "light" : "dark" }));
glassBtn.addEventListener("click", () => apply({ glass: !glass }));
titlesBtn.addEventListener("click", () => apply({ titles: !titles }));
langBtn.addEventListener("click", () => apply({ lang: de() ? "en" : "de" }));

// ---- phone ----------------------------------------------------------------------

/**
 * The page at a phone's width, in a phone: an embedded copy of this page in a
 * 393 × 852 frame, so the nav bar docks to the phone's bottom edge, swipes
 * and notifications happen inside it, and nothing is squeezed by hand. The
 * settings and the scenarios here are handed to it.
 */
let frame;
const phoneHost = document.getElementById("phone-host");
function setPhone(on) {
  phone = on;
  document.body.classList.toggle("phone-mode", on);
  if (on) {
    const q = new URLSearchParams({ embed: "1", view: shown?.key ?? "home", ...Object.fromEntries(Object.entries(settings()).map(([k, v]) => [k, typeof v === "boolean" ? (v ? "1" : "0") : v])) });
    frame = document.createElement("iframe");
    frame.title = "M3 Cards demo on a phone";
    frame.src = `${BASE}index.html?${q}`;
    const bezel = document.createElement("div");
    bezel.className = "phone-frame";
    bezel.appendChild(frame);
    phoneHost.replaceChildren(bezel);
  } else {
    phoneHost.replaceChildren();
    frame = undefined;
  }
  paintSwitches();
}
phoneBtn.addEventListener("click", () => setPhone(!phone));
window.m3DemoScenarioTarget = () => (phone ? frame?.contentWindow : null);

paintSwitches();
sim.setDark(dark);
// The nav bar measures its entries to place its pill: wait for the type.
await document.fonts.ready;
render();
