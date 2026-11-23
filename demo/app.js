// The demo dashboard: views of cards over the pretend home, a router that
// swaps views the way Home Assistant does (a fresh view, its own nav bar), and
// the switches for theme and language.

import "./ha-shim.js";
import { buildHome, NAMES_DE } from "./home.js";
import { Sim } from "./sim.js";

// The released bundle sits next to the page on GitHub Pages; working in the
// repository, the page takes the local build.
const onPages = location.hostname.endsWith("github.io");
await import(onPages ? "./m3-cards.js" : "../dist/m3-cards.js");

const BASE = new URL("./", import.meta.url).pathname;
const sim = new Sim(buildHome(), NAMES_DE);
window.m3Demo = sim;

// A view element by Home Assistant's name, so the nav card's page slide stops
// at it and leaves the background and the toolbar where they are.
if (!customElements.get("hui-view")) customElements.define("hui-view", class extends HTMLElement {});

// Every view at a path of its own, the start view too: a bar entry pointing at
// the bare base would count as a prefix of every other view and stay lit.
const nav = (key) => BASE + key;

const VIEWS = [
  { key: "home", title: "Home", icon: "mdi:home" },
  { key: "rooms", title: "Rooms", icon: "mdi:floor-plan" },
  { key: "climate", title: "Climate", icon: "mdi:thermostat" },
  { key: "energy", title: "Energy", icon: "mdi:lightning-bolt" },
  { key: "household", title: "Household", icon: "mdi:washing-machine" },
  { key: "security", title: "Security", icon: "mdi:shield-home" },
];

const TITLES_DE = { home: "Start", rooms: "Räume", climate: "Klima", energy: "Energie", household: "Haushalt", security: "Sicherheit" };

function navCard() {
  const de = sim.language === "de";
  return {
    type: "custom:m3-nav-card",
    style: "floating",
    position: "bottom",
    max_width: "fit",
    label_position: "right",
    icon_visibility: "active_only",
    label_visibility: "always",
    active_style: "solid",
    marker_motion: "stretch",
    page_transition: "slide",
    swipe_navigation: true,
    container_style: "glass",
    blur: 20,
    items: VIEWS.map((v) => ({ name: de ? TITLES_DE[v.key] : v.title, icon: v.icon, path: nav(v.key) })),
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
      [t("Updates", "Updates"), [
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

function render() {
  const key = keyFromPath();
  live = [];
  const view = document.createElement("hui-view");
  view.dataset.view = key;
  const grid = document.createElement("div");
  grid.className = "sections";
  for (const [title, cards] of views()[key]) {
    const section = document.createElement("div");
    section.className = "section";
    if (title) {
      const h = document.createElement("h2");
      h.textContent = title;
      section.appendChild(h);
    }
    for (const c of cards) section.appendChild(makeCard(c));
    grid.appendChild(section);
  }
  view.appendChild(grid);
  view.appendChild(makeCard(navCard()));
  root.replaceChildren(view);
  document.title = `${(sim.language === "de" ? TITLES_DE[key] : VIEWS.find((v) => v.key === key).title)} · M3 Cards demo`;
}

sim.subscribe((hass) => {
  for (const el of live) el.hass = hass;
});

window.addEventListener("location-changed", render);
window.addEventListener("popstate", render);

// ---- switches -----------------------------------------------------------------

const themeBtn = document.getElementById("theme");
const langBtn = document.getElementById("lang");
function applyTheme(dark) {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  themeBtn.querySelector("ha-icon").icon = dark ? "mdi:weather-sunny" : "mdi:weather-night";
  sim.setDark(dark);
}
themeBtn.addEventListener("click", () => applyTheme(document.documentElement.dataset.theme !== "dark"));
langBtn.addEventListener("click", () => {
  sim.setLanguage(sim.language === "de" ? "en" : "de");
  langBtn.textContent = sim.language === "de" ? "EN" : "DE";
  render();
});
langBtn.textContent = sim.language === "de" ? "EN" : "DE";
applyTheme(!matchMedia("(prefers-color-scheme: light)").matches);
// The nav bar measures its entries to place its pill: wait for the type.
await document.fonts.ready;
render();
