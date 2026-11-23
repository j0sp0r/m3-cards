// A made-up family home: the Lindqvists — Alex, Mia and Leo — in a house with
// a garden, solar panels on the roof, a home battery and an electric car.
// Every entity, area and device here is invented; nothing comes from a real
// installation. The registry ties them together the way Home Assistant does,
// so the cards that discover their own entities find a coherent home.

const AREAS = [
  ["living_room", "Living Room", "mdi:sofa"],
  ["kitchen", "Kitchen", "mdi:silverware-fork-knife"],
  ["bedroom", "Bedroom", "mdi:bed-king"],
  ["kids_room", "Leo's Room", "mdi:teddy-bear"],
  ["office", "Office", "mdi:desk"],
  ["bathroom", "Bathroom", "mdi:shower"],
  ["hallway", "Hallway", "mdi:door"],
  ["utility", "Utility Room", "mdi:washing-machine"],
  ["garden", "Garden", "mdi:flower"],
  ["garage", "Garage", "mdi:garage"],
];

const T = (v) => ["temperature", "°C", v];
const H = (v) => ["humidity", "%", v];
const W = (v) => ["power", "W", v];
const B = (v) => ["battery", "%", v];

/** device id → [name, area, model, entities: [entity_id, state, attributes]] */
function devices() {
  const now = Date.now();
  const ago = (m) => new Date(now - m * 60e3).toISOString();
  const sensor = (id, [dc, unit, v], name, extra = {}) => [
    id,
    String(v),
    { friendly_name: name, device_class: dc, unit_of_measurement: unit, state_class: "measurement", ...extra },
  ];
  const ct = { supported_color_modes: ["color_temp"], color_mode: "color_temp", min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6500 };
  const rgb = { supported_color_modes: ["hs", "color_temp"], color_mode: "hs", min_color_temp_kelvin: 2000, max_color_temp_kelvin: 6500 };
  const dim = { supported_color_modes: ["brightness"], color_mode: "brightness" };
  const climate = (name, cur, target, action, hum) => ({
    friendly_name: name,
    current_temperature: cur,
    temperature: target,
    current_humidity: hum,
    hvac_modes: ["off", "heat", "auto"],
    hvac_action: action,
    preset_modes: ["comfort", "eco", "away", "boost"],
    preset_mode: "comfort",
    min_temp: 5,
    max_temp: 28,
    target_temp_step: 0.5,
    supported_features: 401,
  });
  return {
    // Living room
    living_ceiling: ["Ceiling Light", "living_room", "Hue White Ambiance", [["light.living_ceiling", "on", { friendly_name: "Ceiling Light", brightness: 180, color_temp_kelvin: 3000, ...ct }]]],
    floor_lamp: ["Floor Lamp", "living_room", "Hue Go", [["light.floor_lamp", "on", { friendly_name: "Floor Lamp", brightness: 140, hs_color: [28, 70], ...rgb }]]],
    tv_strip: ["TV Lightstrip", "living_room", "Hue Lightstrip", [["light.tv_strip", "off", { friendly_name: "TV Lightstrip", hs_color: [265, 60], ...rgb }]]],
    living_speaker: ["Living Room Speaker", "living_room", "Sonos Era 100", [["media_player.living_room", "playing", {
      friendly_name: "Living Room", media_title: "Golden Hour", media_artist: "The Northern Lakes", media_album_name: "Summer Tapes",
      media_content_type: "music", media_duration: 214, media_position: 63, media_position_updated_at: ago(0),
      volume_level: 0.35, is_volume_muted: false, source: "Radio", source_list: ["Radio", "Line-in", "TV"], shuffle: false, repeat: "off",
      supported_features: 152511,
    }]]],
    living_tv: ["Living Room TV", "living_room", "OLED 55", [["media_player.living_room_tv", "off", { friendly_name: "TV", source_list: ["HDMI 1", "Streaming", "Live TV"], supported_features: 20413 }]]],
    living_blinds: ["Living Room Blinds", "living_room", "Shutter motor", [["cover.living_room", "open", { friendly_name: "Living Room Blinds", current_position: 70, device_class: "shutter", supported_features: 15 }]]],
    living_thermostat: ["Living Room Thermostat", "living_room", "Radiator thermostat", [
      ["climate.living_room", "heat", climate("Living Room", 21.4, 21.5, "heating", 46)],
      sensor("sensor.living_thermostat_battery", B(64), "Living Room Thermostat Battery", { entity_category: "diagnostic" }),
    ]],
    living_climate: ["Living Room Sensor", "living_room", "Temperature & humidity sensor", [
      sensor("sensor.living_room_temperature", T(21.4), "Living Room Temperature"),
      sensor("sensor.living_room_humidity", H(46), "Living Room Humidity"),
      sensor("sensor.living_sensor_battery", B(82), "Living Room Sensor Battery"),
    ]],
    living_window: ["Terrace Door", "living_room", "Contact sensor", [
      ["binary_sensor.terrace_door", "off", { friendly_name: "Terrace Door", device_class: "door" }],
      sensor("sensor.terrace_door_battery", B(91), "Terrace Door Battery"),
    ]],
    living_motion: ["Living Room Presence", "living_room", "mmWave sensor", [["binary_sensor.living_room_presence", "on", { friendly_name: "Living Room Presence", device_class: "occupancy" }]]],
    tv_plug: ["TV Plug", "living_room", "Smart plug", [
      ["switch.tv_plug", "on", { friendly_name: "TV Plug", device_class: "outlet" }],
      sensor("sensor.tv_plug_power", W(4), "TV Plug Power"),
    ]],

    // Kitchen
    kitchen_light: ["Kitchen Light", "kitchen", "Ceiling panel", [["light.kitchen", "on", { friendly_name: "Kitchen", brightness: 230, color_temp_kelvin: 4000, ...ct }]]],
    counter_light: ["Counter Light", "kitchen", "LED strip", [["light.kitchen_counter", "off", { friendly_name: "Counter", ...dim }]]],
    kitchen_climate: ["Kitchen Sensor", "kitchen", "Temperature & humidity sensor", [
      sensor("sensor.kitchen_temperature", T(21.9), "Kitchen Temperature"),
      sensor("sensor.kitchen_humidity", H(51), "Kitchen Humidity"),
    ]],
    kitchen_leak: ["Sink Leak Sensor", "kitchen", "Water leak sensor", [
      ["binary_sensor.kitchen_leak", "off", { friendly_name: "Under the sink", device_class: "moisture" }],
      sensor("sensor.kitchen_leak_battery", B(77), "Sink Leak Sensor Battery"),
    ]],
    dishwasher: ["Dishwasher", "kitchen", "Dishwasher 60 cm", [
      ["sensor.dishwasher_state", "run", { friendly_name: "Dishwasher", device_class: "enum", options: ["off", "ready", "run", "finished"] }],
      ["sensor.dishwasher_remaining", "47", { friendly_name: "Dishwasher remaining", unit_of_measurement: "min", device_class: "duration" }],
      sensor("sensor.dishwasher_power", W(1850), "Dishwasher Power"),
    ]],
    fridge: ["Fridge", "kitchen", "Fridge plug", [sensor("sensor.fridge_power", W(68), "Fridge Power")]],

    // Bedroom
    bedroom_light: ["Bedroom Light", "bedroom", "Ceiling light", [["light.bedroom", "off", { friendly_name: "Bedroom", color_temp_kelvin: 2700, ...ct }]]],
    bedside: ["Bedside Lamp", "bedroom", "Table lamp", [["light.bedside", "off", { friendly_name: "Bedside", hs_color: [30, 60], ...rgb }]]],
    bedroom_thermostat: ["Bedroom Thermostat", "bedroom", "Radiator thermostat", [["climate.bedroom", "heat", climate("Bedroom", 18.6, 18.5, "idle", 54)]]],
    bedroom_climate: ["Bedroom Sensor", "bedroom", "Temperature & humidity sensor", [
      sensor("sensor.bedroom_temperature", T(18.6), "Bedroom Temperature"),
      sensor("sensor.bedroom_humidity", H(54), "Bedroom Humidity"),
    ]],
    bedroom_window: ["Bedroom Window", "bedroom", "Contact sensor", [
      ["binary_sensor.bedroom_window", "on", { friendly_name: "Bedroom Window", device_class: "window" }],
      sensor("sensor.bedroom_window_battery", B(12), "Bedroom Window Battery"),
    ]],
    bedroom_blinds: ["Bedroom Blinds", "bedroom", "Shutter motor", [["cover.bedroom", "closed", { friendly_name: "Bedroom Blinds", current_position: 0, device_class: "shutter", supported_features: 15 }]]],
    humidifier: ["Humidifier", "bedroom", "Humidifier", [["humidifier.bedroom", "off", { friendly_name: "Humidifier", humidity: 50, current_humidity: 54, min_humidity: 30, max_humidity: 70, mode: "normal", available_modes: ["normal", "eco", "sleep"], device_class: "humidifier", supported_features: 1 }]]],

    // Leo's room
    kids_light: ["Leo's Light", "kids_room", "Ceiling light", [["light.kids_room", "on", { friendly_name: "Leo's Room", brightness: 110, hs_color: [190, 50], ...rgb }]]],
    kids_thermostat: ["Leo's Thermostat", "kids_room", "Radiator thermostat", [["climate.kids_room", "heat", climate("Leo's Room", 20.2, 20.5, "heating", 49)]]],
    kids_climate: ["Leo's Sensor", "kids_room", "Temperature & humidity sensor", [
      sensor("sensor.kids_room_temperature", T(20.2), "Leo's Room Temperature"),
      sensor("sensor.kids_room_humidity", H(49), "Leo's Room Humidity"),
    ]],

    // Office
    desk_lamp: ["Desk Lamp", "office", "Desk lamp", [["light.desk", "on", { friendly_name: "Desk Lamp", brightness: 200, color_temp_kelvin: 4500, ...ct }]]],
    office_thermostat: ["Office Thermostat", "office", "Radiator thermostat", [["climate.office", "auto", climate("Office", 20.8, 21, "idle", 44)]]],
    office_climate: ["Office Sensor", "office", "Temperature & humidity sensor", [
      sensor("sensor.office_temperature", T(20.8), "Office Temperature"),
      sensor("sensor.office_humidity", H(44), "Office Humidity"),
    ]],
    office_plug: ["Desk Plug", "office", "Smart plug", [
      ["switch.desk_plug", "on", { friendly_name: "Desk Plug", device_class: "outlet" }],
      sensor("sensor.desk_plug_power", W(86), "Desk Power"),
    ]],

    // Bathroom
    bathroom_light: ["Bathroom Light", "bathroom", "Ceiling light", [["light.bathroom", "off", { friendly_name: "Bathroom", ...dim }]]],
    bathroom_climate: ["Bathroom Sensor", "bathroom", "Temperature & humidity sensor", [
      sensor("sensor.bathroom_temperature", T(22.6), "Bathroom Temperature"),
      sensor("sensor.bathroom_humidity", H(63), "Bathroom Humidity"),
    ]],
    bathroom_fan: ["Bathroom Fan", "bathroom", "Ventilation fan", [["fan.bathroom", "off", { friendly_name: "Bathroom Fan", percentage: 0, preset_modes: ["auto", "boost"], supported_features: 9 }]]],
    bathroom_leak: ["Bathroom Leak Sensor", "bathroom", "Water leak sensor", [
      ["binary_sensor.bathroom_leak", "off", { friendly_name: "Behind the washbasin", device_class: "moisture" }],
      sensor("sensor.bathroom_leak_battery", B(58), "Bathroom Leak Sensor Battery"),
    ]],

    // Hallway
    hallway_light: ["Hallway Light", "hallway", "Ceiling light", [["light.hallway", "off", { friendly_name: "Hallway", ...dim }]]],
    front_door: ["Front Door", "hallway", "Smart lock", [
      ["lock.front_door", "locked", { friendly_name: "Front Door", supported_features: 1 }],
      ["binary_sensor.front_door", "off", { friendly_name: "Front Door", device_class: "door" }],
      sensor("sensor.front_door_battery", B(43), "Front Door Battery"),
    ]],
    alarm: ["Alarm Panel", "hallway", "Alarm panel", [["alarm_control_panel.home", "disarmed", {
      friendly_name: "House", supported_features: 63, code_format: "number", code_arm_required: false, changed_by: null,
    }]]],
    smoke_hall: ["Smoke Detector", "hallway", "Smoke detector", [
      ["binary_sensor.smoke_hallway", "off", { friendly_name: "Smoke Detector", device_class: "smoke" }],
      sensor("sensor.smoke_hallway_battery", B(8), "Smoke Detector Battery"),
    ]],

    // Utility room
    washer: ["Washing Machine", "utility", "Washer 9 kg", [
      ["sensor.washer_state", "run", { friendly_name: "Washing Machine", device_class: "enum", options: ["off", "ready", "run", "finished"] }],
      ["sensor.washer_remaining", "38", { friendly_name: "Washer remaining", unit_of_measurement: "min", device_class: "duration" }],
      ["sensor.washer_progress", "62", { friendly_name: "Washer progress", unit_of_measurement: "%" }],
      sensor("sensor.washer_power", W(420), "Washer Power"),
    ]],
    dryer: ["Dryer", "utility", "Heat-pump dryer", [
      ["sensor.dryer_state", "ready", { friendly_name: "Dryer", device_class: "enum", options: ["off", "ready", "run", "finished"] }],
      sensor("sensor.dryer_power", W(2), "Dryer Power"),
    ]],
    utility_leak: ["Utility Leak Sensor", "utility", "Water leak sensor", [
      ["binary_sensor.utility_leak", "off", { friendly_name: "Next to the washer", device_class: "moisture" }],
      sensor("sensor.utility_leak_battery", B(96), "Utility Leak Sensor Battery"),
    ]],
    water_valve: ["Main Water Valve", "utility", "Motorised valve", [["valve.main_water", "open", { friendly_name: "Main water", device_class: "water", supported_features: 3 }]]],
    robo: ["Robo", "utility", "Robot vacuum", [["vacuum.robo", "docked", {
      friendly_name: "Robo", battery_level: 100, fan_speed: "balanced", fan_speed_list: ["quiet", "balanced", "turbo", "max"], status: "Charging", supported_features: 14204,
    }]]],

    // Garden and garage
    garden_light: ["Garden Lights", "garden", "Outdoor spots", [["light.garden", "off", { friendly_name: "Garden", ...dim }]]],
    outdoor: ["Weather Station", "garden", "Outdoor sensor", [
      sensor("sensor.outdoor_temperature", T(11.8), "Outdoor Temperature"),
      sensor("sensor.outdoor_humidity", H(72), "Outdoor Humidity"),
    ]],
    garage_door: ["Garage Door", "garage", "Door opener", [["cover.garage_door", "closed", { friendly_name: "Garage Door", device_class: "garage", current_position: 0, supported_features: 3 }]]],
    wallbox: ["Wallbox", "garage", "11 kW charger", [
      ["switch.wallbox", "on", { friendly_name: "Wallbox charging" }],
      sensor("sensor.wallbox_power", W(0), "Wallbox Power"),
    ]],

    // Energy system
    inverter: ["Inverter", "garage", "Hybrid inverter 8 kW", [
      sensor("sensor.solar_power", W(0), "Solar Power"),
      sensor("sensor.grid_power", W(0), "Grid Power"),
      sensor("sensor.house_power", W(0), "House Power"),
      sensor("sensor.battery_power", W(0), "Battery Power"),
      ["sensor.battery_soc", "64", { friendly_name: "Home Battery", device_class: "battery", unit_of_measurement: "%", state_class: "measurement" }],
      ["sensor.grid_import", "6214.3", { friendly_name: "Grid import", device_class: "energy", unit_of_measurement: "kWh", state_class: "total_increasing" }],
      ["sensor.grid_export", "2418.9", { friendly_name: "Grid export", device_class: "energy", unit_of_measurement: "kWh", state_class: "total_increasing" }],
      ["sensor.solar_energy", "7932.6", { friendly_name: "Solar production", device_class: "energy", unit_of_measurement: "kWh", state_class: "total_increasing" }],
      ["sensor.battery_energy_out", "1688.2", { friendly_name: "Battery discharge", device_class: "energy", unit_of_measurement: "kWh", state_class: "total_increasing" }],
      ["sensor.battery_energy_in", "1801.5", { friendly_name: "Battery charge", device_class: "energy", unit_of_measurement: "kWh", state_class: "total_increasing" }],
    ]],

    // People's phones (batteries) and remotes
    remote: ["Living Room Remote", "living_room", "Remote", [sensor("sensor.living_remote_battery", B(27), "Remote Battery")]],
  };
}

/** Entities that belong to no device: people, weather, the sun, lists, helpers. */
function loose() {
  const now = Date.now();
  const ago = (m) => new Date(now - m * 60e3).toISOString();
  return [
    ["person.alex", "home", { friendly_name: "Alex", entity_picture: null }],
    ["person.mia", "home", { friendly_name: "Mia", entity_picture: null }],
    ["person.leo", "School", { friendly_name: "Leo", entity_picture: null }],
    ["weather.home", "partlycloudy", {
      friendly_name: "Home", temperature: 11.8, humidity: 72, wind_speed: 14, wind_bearing: 240, pressure: 1014, uv_index: 2,
      temperature_unit: "°C", wind_speed_unit: "km/h", pressure_unit: "hPa", precipitation_unit: "mm", supported_features: 3,
    }],
    ["sun.sun", "above_horizon", { friendly_name: "Sun", next_rising: new Date(now + 16 * 3600e3).toISOString(), next_setting: new Date(now + 4 * 3600e3).toISOString() }],
    ["todo.shopping", "4", { friendly_name: "Shopping list", supported_features: 15 }],
    ["sensor.waste_paper", "2", { friendly_name: "Paper", icon: "mdi:newspaper-variant-outline", unit_of_measurement: "d" }],
    ["sensor.waste_organic", "5", { friendly_name: "Organic", icon: "mdi:leaf", unit_of_measurement: "d" }],
    ["sensor.waste_residual", "9", { friendly_name: "Residual", icon: "mdi:trash-can-outline", unit_of_measurement: "d" }],
    ["sensor.waste_recycling", "1", { friendly_name: "Recycling", icon: "mdi:recycle", unit_of_measurement: "d" }],
    ["input_boolean.guest_mode", "off", { friendly_name: "Guest mode", icon: "mdi:account-multiple" }],
    ["input_boolean.vacation", "off", { friendly_name: "Vacation", icon: "mdi:airplane" }],
    ["scene.movie_night", "2026-01-01T00:00:00", { friendly_name: "Movie night", icon: "mdi:movie-open" }],
    ["scene.good_night", "2026-01-01T00:00:00", { friendly_name: "Good night", icon: "mdi:weather-night" }],
    ["update.home_assistant_core_update", "on", { friendly_name: "Home Assistant Core", title: "Home Assistant Core", installed_version: "2026.11.0", latest_version: "2026.11.1", supported_features: 23 }],
    ["update.m3_cards_update", "off", { friendly_name: "M3 Cards", title: "M3 Cards", installed_version: "2.10.0", latest_version: "2.10.0", supported_features: 23 }],
    ["update.robo_firmware", "on", { friendly_name: "Robo firmware", title: "Robo", installed_version: "4.1.2", latest_version: "4.2.0", supported_features: 23 }],
    ["counter.coffee_capsules", "14", { friendly_name: "Coffee capsules", minimum: 0, maximum: 50, step: 1, icon: "mdi:coffee" }],
    ["input_datetime.alarm_clock", "06:45:00", { friendly_name: "Alarm clock", has_date: false, has_time: true, hour: 6, minute: 45, second: 0 }],
    ["binary_sensor.front_door_ring", "off", { friendly_name: "Doorbell", device_class: "occupancy", last_ring: ago(95) }],
  ];
}

/** German names, for the page in German: the cards translate themselves, the house does not. */
export const NAMES_DE = {
  areas: {
    living_room: "Wohnzimmer", kitchen: "Küche", bedroom: "Schlafzimmer", kids_room: "Leos Zimmer", office: "Büro",
    bathroom: "Bad", hallway: "Flur", utility: "Hauswirtschaft", garden: "Garten", garage: "Garage",
  },
  entities: {
    "light.living_ceiling": "Deckenlicht", "light.floor_lamp": "Stehlampe", "light.tv_strip": "TV-Lichtleiste",
    "media_player.living_room": "Wohnzimmer", "media_player.living_room_tv": "Fernseher", "cover.living_room": "Rollo Wohnzimmer",
    "climate.living_room": "Wohnzimmer", "sensor.living_room_temperature": "Temperatur Wohnzimmer", "sensor.living_room_humidity": "Luftfeuchte Wohnzimmer",
    "binary_sensor.terrace_door": "Terrassentür", "binary_sensor.living_room_presence": "Anwesenheit Wohnzimmer", "switch.tv_plug": "TV-Steckdose",
    "sensor.tv_plug_power": "Fernseher", "light.kitchen": "Küche", "light.kitchen_counter": "Arbeitsplatte",
    "sensor.kitchen_temperature": "Temperatur Küche", "sensor.kitchen_humidity": "Luftfeuchte Küche", "binary_sensor.kitchen_leak": "Unter der Spüle",
    "sensor.dishwasher_state": "Spülmaschine", "sensor.dishwasher_power": "Spülmaschine", "sensor.fridge_power": "Kühlschrank",
    "light.bedroom": "Schlafzimmer", "light.bedside": "Nachttisch", "climate.bedroom": "Schlafzimmer",
    "sensor.bedroom_temperature": "Temperatur Schlafzimmer", "sensor.bedroom_humidity": "Luftfeuchte Schlafzimmer",
    "binary_sensor.bedroom_window": "Schlafzimmerfenster", "cover.bedroom": "Rollo Schlafzimmer", "humidifier.bedroom": "Luftbefeuchter",
    "light.kids_room": "Leos Zimmer", "climate.kids_room": "Leos Zimmer", "sensor.kids_room_temperature": "Temperatur Leos Zimmer",
    "sensor.kids_room_humidity": "Luftfeuchte Leos Zimmer", "light.desk": "Schreibtischlampe", "climate.office": "Büro",
    "sensor.office_temperature": "Temperatur Büro", "sensor.office_humidity": "Luftfeuchte Büro", "switch.desk_plug": "Schreibtisch-Steckdose",
    "sensor.desk_plug_power": "Schreibtisch", "light.bathroom": "Bad", "sensor.bathroom_temperature": "Temperatur Bad",
    "sensor.bathroom_humidity": "Luftfeuchte Bad", "fan.bathroom": "Lüfter Bad", "binary_sensor.bathroom_leak": "Hinter dem Waschbecken",
    "light.hallway": "Flur", "lock.front_door": "Haustür", "binary_sensor.front_door": "Haustür", "alarm_control_panel.home": "Haus",
    "binary_sensor.smoke_hallway": "Rauchmelder", "sensor.smoke_hallway_battery": "Rauchmelder", "sensor.washer_state": "Waschmaschine",
    "sensor.washer_power": "Waschmaschine", "sensor.dryer_state": "Trockner", "sensor.dryer_power": "Trockner",
    "binary_sensor.utility_leak": "Neben der Waschmaschine", "valve.main_water": "Hauptwasser", "light.garden": "Garten",
    "sensor.outdoor_temperature": "Außentemperatur", "sensor.outdoor_humidity": "Luftfeuchte außen", "cover.garage_door": "Garagentor",
    "switch.wallbox": "Wallbox lädt", "sensor.wallbox_power": "Wallbox", "sensor.solar_power": "PV-Leistung", "sensor.grid_power": "Netz",
    "sensor.house_power": "Hausverbrauch", "sensor.battery_power": "Speicherleistung", "sensor.battery_soc": "Hausspeicher",
    "sensor.bedroom_window_battery": "Schlafzimmerfenster", "sensor.living_remote_battery": "Fernbedienung", "sensor.front_door_battery": "Haustür",
    "sensor.living_thermostat_battery": "Thermostat Wohnzimmer", "sensor.living_sensor_battery": "Sensor Wohnzimmer",
    "sensor.terrace_door_battery": "Terrassentür", "sensor.kitchen_leak_battery": "Wassersensor Küche", "sensor.bathroom_leak_battery": "Wassersensor Bad",
    "sensor.utility_leak_battery": "Wassersensor HWR", "todo.shopping": "Einkaufsliste", "sensor.waste_paper": "Papier",
    "sensor.waste_organic": "Bio", "sensor.waste_residual": "Restmüll", "sensor.waste_recycling": "Gelber Sack",
    "input_boolean.guest_mode": "Gäste", "input_boolean.vacation": "Urlaub", "scene.movie_night": "Filmabend", "scene.good_night": "Gute Nacht",
    "counter.coffee_capsules": "Kaffeekapseln", "input_datetime.alarm_clock": "Wecker", "weather.home": "Zuhause",
  },
};

export function buildHome() {
  const states = {};
  const areas = {};
  const deviceReg = {};
  const entityReg = {};
  for (const [id, name, icon] of AREAS) {
    areas[id] = { area_id: id, name, icon, picture: null, floor_id: null, labels: [], aliases: [] };
  }
  for (const [devId, [name, area, model, ents]] of Object.entries(devices())) {
    deviceReg[devId] = { id: devId, name, name_by_user: null, area_id: area, model, manufacturer: "Demo", entry_type: null, disabled_by: null, config_entries: ["demo"] };
    for (const [id, state, attrs] of ents) {
      const { entity_category, ...attributes } = attrs;
      states[id] = [state, attributes];
      entityReg[id] = { entity_id: id, device_id: devId, area_id: null, platform: "demo", entity_category: entity_category ?? null, hidden: false, disabled_by: null, labels: [], name: null, icon: null };
    }
  }
  for (const [id, state, attributes] of loose()) {
    states[id] = [state, attributes];
    entityReg[id] = { entity_id: id, device_id: null, area_id: null, platform: id.split(".")[0], entity_category: null, hidden: false, disabled_by: null, labels: [], name: null, icon: null };
  }
  // Each room's own climate sensor, for the cards that read it off the area.
  const sensorOf = (area, kind) => (states[`sensor.${area}_${kind}`] ? `sensor.${area}_${kind}` : null);
  for (const area of Object.values(areas)) {
    area.temperature_entity_id = sensorOf(area.area_id, "temperature");
    area.humidity_entity_id = sensorOf(area.area_id, "humidity");
  }
  return { states, areas, devices: deviceReg, entities: entityReg };
}
