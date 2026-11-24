// A pretend Home Assistant for the demo: it holds the states, answers the
// websocket calls the cards make, carries out their service calls and moves
// the house along on its own — the sun rises over the roof, the washer counts
// down, rooms warm up towards their thermostats. Nothing leaves the page.

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const EPOCH = Date.UTC(2026, 0, 1);
const rand = (seed) => {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, d = 0) => Math.round(v * 10 ** d) / 10 ** d;

// The shape of a day, hour by hour (0–23, fractional).
const solarShape = (h) => (h < 6.5 || h > 19.5 ? 0 : Math.sin(((h - 6.5) / 13) * Math.PI) ** 1.5);
const houseShape = (h) => 0.45 + 0.5 * Math.exp(-((h - 7.5) ** 2) / 2.5) + 1.0 * Math.exp(-((h - 19) ** 2) / 5);

/** Energy statistics: kWh per day and the hour shape they follow. */
const ENERGY = {
  "sensor.grid_import": { perDay: 6.2, shape: (h) => houseShape(h) * (1 - solarShape(h)) + 0.05 },
  "sensor.grid_export": { perDay: 3.1, shape: (h) => solarShape(h) ** 2 },
  "sensor.solar_energy": { perDay: 14.8, shape: solarShape },
  "sensor.battery_energy_out": { perDay: 3.4, shape: (h) => (h > 18 || h < 7 ? 1 : 0.02) },
  "sensor.battery_energy_in": { perDay: 3.7, shape: (h) => (h > 9 && h < 15 ? 1 : 0.02) },
  // What the grid import cost, at 0.32 €/kWh: the statistic Home Assistant keeps once a price is set.
  "sensor.grid_cost": { perDay: 6.2 * 0.32, shape: (h) => houseShape(h) * (1 - solarShape(h)) + 0.05 },
  "sensor.energy_day": { perDay: 4.6, shape: (h) => (h >= 6 && h < 22 ? houseShape(h) : 0) },
  "sensor.energy_night": { perDay: 1.6, shape: (h) => (h < 6 || h >= 22 ? 1 : 0) },
  "sensor.wallbox_energy": { perDay: 9.5, shape: (h) => (h > 9 && h < 16 ? 1 : 0.01) },
  "sensor.washer_energy": { perDay: 0.9, shape: (h) => (h > 9 && h < 12 ? 1 : 0.01) },
  "sensor.dishwasher_energy": { perDay: 1.2, shape: (h) => (h > 19 && h < 22 ? 1 : 0.01) },
  "sensor.dryer_energy": { perDay: 0.7, shape: (h) => (h > 12 && h < 15 ? 1 : 0.01) },
  "sensor.fridge_energy": { perDay: 0.9, shape: () => 1 },
  "sensor.office_energy": { perDay: 1.6, shape: (h) => (h > 8 && h < 18 ? 1 : 0.08) },
  "sensor.tv_energy": { perDay: 0.5, shape: (h) => (h > 18 && h < 23 ? 1 : 0.03) },
};
const DEVICE_ENERGY = ["sensor.wallbox_energy", "sensor.washer_energy", "sensor.dishwasher_energy", "sensor.dryer_energy", "sensor.fridge_energy", "sensor.office_energy", "sensor.tv_energy"];

const STATE_LABELS = {
  en: {
    on: "On", off: "Off", home: "Home", not_home: "Away", open: "Open", closed: "Closed", opening: "Opening", closing: "Closing",
    playing: "Playing", paused: "Paused", idle: "Idle", heat: "Heat", auto: "Auto", locked: "Locked", unlocked: "Unlocked",
    disarmed: "Disarmed", armed_home: "Armed home", armed_away: "Armed away", armed_night: "Armed night", arming: "Arming", triggered: "Triggered",
    docked: "Docked", cleaning: "Cleaning", returning: "Returning", partlycloudy: "Partly cloudy", sunny: "Sunny", cloudy: "Cloudy",
    rainy: "Rainy", "clear-night": "Clear", run: "Running", ready: "Ready", finished: "Finished", above_horizon: "Above horizon", below_horizon: "Below horizon",
  },
  de: {
    on: "An", off: "Aus", home: "Zuhause", not_home: "Abwesend", open: "Offen", closed: "Geschlossen", opening: "Öffnet", closing: "Schließt",
    playing: "Spielt", paused: "Pausiert", idle: "Untätig", heat: "Heizen", auto: "Automatisch", locked: "Verriegelt", unlocked: "Entriegelt",
    disarmed: "Unscharf", armed_home: "Scharf (Zuhause)", armed_away: "Scharf (Abwesend)", armed_night: "Scharf (Nacht)", arming: "Wird scharf", triggered: "Ausgelöst",
    docked: "Angedockt", cleaning: "Reinigt", returning: "Kehrt zurück", partlycloudy: "Teilweise bewölkt", sunny: "Sonnig", cloudy: "Bewölkt",
    rainy: "Regnerisch", "clear-night": "Klar", run: "Läuft", ready: "Bereit", finished: "Fertig", above_horizon: "Über dem Horizont", below_horizon: "Unter dem Horizont",
  },
};

const TRACKS = [
  ["Golden Hour", "The Northern Lakes", "Summer Tapes", 214],
  ["Paper Planes", "Mira & the Tides", "Coastline", 198],
  ["Slow Morning", "Kettle Club", "Weekday", 241],
  ["City Lights", "Neon Harbour", "Night Drive", 226],
];

export class Sim {
  constructor(home, namesDe = { areas: {}, entities: {} }) {
    this.namesDe = namesDe;
    this._deCache = new WeakMap();
    this.areas = home.areas;
    this.devices = home.devices;
    this.entities = home.entities;
    const now = new Date().toISOString();
    this.states = {};
    for (const [id, [state, attributes]] of Object.entries(home.states)) {
      this.states[id] = { entity_id: id, state: String(state), attributes, last_changed: now, last_updated: now, context: { id: id } };
    }
    // Recorded changes since the page opened, for the history the cards ask for.
    this.changes = {};
    this.userData = {};
    this.listeners = new Set();
    /** Told of every change of state: (entity_id, before, after). */
    this.changeListeners = new Set();
    // English unless the visitor picks another language (or ?lang= asks for one).
    this.language = "en";
    this.dark = true;
    this.track = 0;
    this.todo = [
      { uid: "1", summary: "Oat milk", status: "needs_action" },
      { uid: "2", summary: "Coffee beans", status: "needs_action" },
      { uid: "3", summary: "Apples", status: "needs_action" },
      { uid: "4", summary: "Dishwasher tabs", status: "needs_action" },
      { uid: "5", summary: "Bread", status: "completed" },
    ];
    this._templateSubs = new Set();
    this._timers = [];
    this.tick(true);
    this._timers.push(setInterval(() => this.tick(), 3000));
    this._hass = this._build();
  }

  // ---- state ---------------------------------------------------------------

  get(id) {
    return this.states[id];
  }

  /** Changes an entity; the new object goes out with the next hass. */
  set(id, state, attrs = {}) {
    const old = this.states[id];
    if (!old) return;
    // The house moving on its own does not bring back a device that has
    // dropped out — only a scenario or a service call does.
    if (this._ticking && old.state === "unavailable") return;
    const nextState = state === undefined ? old.state : String(state);
    const attributes = { ...old.attributes, ...attrs };
    const changed = nextState !== old.state;
    const now = new Date().toISOString();
    this.states[id] = {
      ...old,
      state: nextState,
      attributes,
      last_changed: changed ? now : old.last_changed,
      last_updated: now,
    };
    if (changed) {
      (this.changes[id] ??= []).push({ s: nextState, lu: Date.now() / 1000 });
      for (const fn of this.changeListeners) fn(id, old.state, nextState);
    }
    this._dirty = true;
  }

  /** Sends the current states out to every card, if anything moved. */
  flush(force = false) {
    if (!this._dirty && !force) return;
    this._dirty = false;
    this._hass = this._build();
    for (const fn of this.listeners) fn(this._hass);
    for (const sub of this._templateSubs) sub();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get hass() {
    return this._hass;
  }

  setLanguage(lang) {
    this.language = lang;
    this.flush(true);
  }

  setDark(dark) {
    this.dark = dark;
    this.flush(true);
  }

  // ---- the house moving on its own ------------------------------------------

  tick(first = false) {
    this._ticking = true;
    try {
      this._tick(first);
    } finally {
      this._ticking = false;
    }
  }

  _tick(first) {
    const now = new Date();
    const h = now.getHours() + now.getMinutes() / 60;
    const n = (id) => Number(this.states[id]?.state) || 0;
    const on = (id) => this.states[id]?.state === "on";
    const jitter = (v, amount) => v * (1 + (Math.random() - 0.5) * amount);

    // Appliances count down a minute every tick — unless the show reel is
    // running them on its own clock.
    if (!this._reel && this.get("sensor.washer_state").state === "run") {
      const left = n("sensor.washer_remaining") - 1;
      if (left <= 0) {
        this.set("sensor.washer_state", "finished");
        this.set("sensor.washer_remaining", 0);
        this.set("sensor.washer_progress", 100);
      } else {
        this.set("sensor.washer_remaining", left);
        this.set("sensor.washer_progress", clamp(round(100 - (left / 100) * 100), 0, 100));
      }
    }
    if (!this._reel && this.get("sensor.dishwasher_state").state === "run") {
      const left = n("sensor.dishwasher_remaining") - 1;
      if (left <= 0) {
        this.set("sensor.dishwasher_state", "finished");
        this.set("sensor.dishwasher_remaining", 0);
      } else this.set("sensor.dishwasher_remaining", left);
    }
    const washer = this.get("sensor.washer_state").state === "run" ? jitter(left60(n("sensor.washer_remaining")), 0.2) : 1.5;
    const dish = this.get("sensor.dishwasher_state").state === "run" ? (n("sensor.dishwasher_remaining") % 20 < 8 ? 1900 : 90) : 0.8;
    const dryer = this.get("sensor.dryer_state").state === "run" ? jitter(750, 0.1) : 1.8;
    if (!this._reel) {
      this.set("sensor.washer_power", round(washer));
      this.set("sensor.dishwasher_power", round(dish));
      this.set("sensor.dryer_power", round(dryer));
    }
    this.set("sensor.fridge_power", now.getMinutes() % 20 < 7 ? round(jitter(72, 0.1)) : 1);
    this.set("sensor.desk_plug_power", on("switch.desk_plug") ? round(jitter(86, 0.15)) : 0);
    this.set("sensor.tv_plug_power", this.get("media_player.living_room_tv").state === "on" ? round(jitter(96, 0.05)) : on("switch.tv_plug") ? 4 : 0);

    // Rooms drift towards their thermostats while they heat, and cool off slowly otherwise.
    for (const room of ["living_room", "bedroom", "kids_room", "office"]) {
      const climate = this.get(`climate.${room}`);
      const sensor = `sensor.${room}_temperature`;
      if (!climate || !this.get(sensor)) continue;
      const cur = n(sensor);
      const target = Number(climate.attributes.temperature) || cur;
      const heating = climate.state !== "off" && cur < target - 0.1;
      const next = round(cur + (heating ? 0.05 : climate.state === "off" ? -0.01 : 0) + (Math.random() - 0.5) * 0.02, 1);
      this.set(sensor, next);
      this.set(`climate.${room}`, undefined, { current_temperature: next, hvac_action: climate.state === "off" ? "off" : heating ? "heating" : "idle" });
    }
    for (const id of ["sensor.living_room_humidity", "sensor.bedroom_humidity", "sensor.kids_room_humidity", "sensor.office_humidity", "sensor.kitchen_humidity", "sensor.bathroom_humidity"]) {
      this.set(id, round(clamp(n(id) + (Math.random() - 0.5) * 0.4, 30, 75)));
    }

    // Lights and media add up into the house's own draw.
    let lights = 0;
    for (const [id, s] of Object.entries(this.states)) {
      if (id.startsWith("light.") && s.state === "on") lights += 4 + ((Number(s.attributes.brightness) || 255) / 255) * 9;
    }
    const media = this.get("media_player.living_room").state === "playing" ? 18 : 3;
    const wallbox = on("switch.wallbox") && h > 9 && h < 16 ? 3600 : 0;
    this.set("sensor.wallbox_power", wallbox);
    const house =
      140 + lights + media + n("sensor.washer_power") + n("sensor.dishwasher_power") + n("sensor.dryer_power") +
      n("sensor.fridge_power") + n("sensor.desk_plug_power") + n("sensor.tv_plug_power") + wallbox;

    // The roof makes what the sun gives; the battery evens out; the grid takes the rest.
    const cloud = this.get("weather.home").state === "cloudy" ? 0.4 : this.get("weather.home").state === "rainy" ? 0.2 : 0.85;
    const solar = round(7400 * solarShape(h) * cloud * (0.9 + Math.random() * 0.1));
    let soc = n("sensor.battery_soc");
    let battery = 0; // positive: discharging into the house
    const surplus = solar - house;
    if (surplus > 0 && soc < 98) battery = -Math.min(surplus, 3200);
    else if (surplus < 0 && soc > 8) battery = Math.min(-surplus, 2600);
    soc = clamp(soc - (battery / 10000) * (3 / 3.6) * 0.5, 5, 100);
    const grid = round(house - solar - battery);
    this.set("sensor.solar_power", solar);
    this.set("sensor.house_power", round(house));
    this.set("sensor.battery_power", round(battery));
    this.set("sensor.grid_power", grid);
    this.set("sensor.battery_soc", round(soc, 1));

    // The car takes what the wallbox gives.
    const charging = wallbox > 0 && n("sensor.car_battery") < n("sensor.car_charge_limit");
    this.set("binary_sensor.car_charging", charging ? "on" : "off");
    this.set("sensor.car_charge_power", charging ? round(wallbox / 1000, 1) : 0);
    if (charging) {
      const soc2 = Math.min(n("sensor.car_charge_limit"), n("sensor.car_battery") + 0.2);
      this.set("sensor.car_battery", round(soc2, 1));
      this.set("sensor.car_range", Math.round(soc2 * 4.2));
    }
    // The printer works through its layers.
    if (this.get("sensor.printer_status").state === "printing") {
      const p = Math.min(100, n("sensor.printer_progress") + 1);
      this.set("sensor.printer_progress", p);
      this.set("sensor.printer_remaining", Math.max(0, Math.round((100 - p) * 1.1)));
      this.set("sensor.printer_layer", Math.round((p / 100) * n("sensor.printer_total_layers")));
      if (p >= 100) this.set("sensor.printer_status", "finished");
    }
    // The aquarium heater keeps the water at 25 °C.
    const water = n("sensor.aquarium_temperature");
    const heat = water < 24.9 || (on("switch.aquarium_heater") && water < 25.4);
    this.set("switch.aquarium_heater", heat ? "on" : "off");
    this.set("sensor.aquarium_heater_power", heat ? 75 : 0);
    this.set("sensor.aquarium_temperature", round(water + (heat ? 0.03 : -0.02), 2));
    // Night tariff from 22 to 6.
    this.set("select.tariff", h >= 22 || h < 6 ? "NT" : "HT");

    // Weather: it is a little cooler at night.
    const outdoor = round(9 + 5 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + (Math.random() - 0.5) * 0.1, 1);
    this.set("sensor.outdoor_temperature", outdoor);
    this.set("weather.home", h > 20 || h < 6.5 ? "clear-night" : this.get("weather.home").state === "clear-night" ? "partlycloudy" : undefined, { temperature: outdoor });
    this.set("sun.sun", h > 7 && h < 19 ? "above_horizon" : "below_horizon");

    // The vacuum makes its round and comes home.
    const vac = this.get("vacuum.robo");
    if (this._reel) {
      // The show reel drives the vacuum.
    } else if (vac.state === "cleaning") {
      const battery = Math.max(20, (Number(vac.attributes.battery_level) || 100) - 1);
      this.set("vacuum.robo", battery <= 25 ? "returning" : undefined, { battery_level: battery, status: battery <= 25 ? "Returning" : "Cleaning" });
    } else if (vac.state === "returning") {
      this.set("vacuum.robo", "docked", { status: "Charging" });
    } else if (vac.state === "docked") {
      const battery = Math.min(100, (Number(vac.attributes.battery_level) || 0) + 2);
      this.set("vacuum.robo", undefined, { battery_level: battery, status: battery >= 100 ? "Docked" : "Charging" });
    }

    // Music moves on.
    const mp = this.get("media_player.living_room");
    if (mp.state === "playing") {
      const pos = (Number(mp.attributes.media_position) || 0) + 3;
      if (pos >= (mp.attributes.media_duration || 200)) this._nextTrack(1);
      else this.set("media_player.living_room", undefined, { media_position: pos, media_position_updated_at: new Date().toISOString() });
    }
    if (!first) this.flush();
  }

  _nextTrack(step) {
    this.track = (this.track + step + TRACKS.length) % TRACKS.length;
    const [title, artist, album, duration] = TRACKS[this.track];
    this.set("media_player.living_room", undefined, {
      media_title: title, media_artist: artist, media_album_name: album, media_duration: duration,
      media_position: 0, media_position_updated_at: new Date().toISOString(),
    });
  }

  // ---- services --------------------------------------------------------------

  async callService(domain, service, data = {}, target = {}) {
    const ids = [].concat(target?.entity_id ?? data?.entity_id ?? []);
    for (const id of ids) this._service(domain, service, data, id);
    this.flush();
    return { context: { id: "demo" }, response: null };
  }

  _service(domain, service, data, id) {
    const s = this.states[id];
    if (!s) return;
    const d = id.split(".")[0];
    if (domain === "homeassistant") domain = d;
    const toggle = () => (s.state === "on" ? "off" : "on");
    switch (domain) {
      case "light": {
        const turnOn = service === "turn_on" || (service === "toggle" && s.state !== "on");
        if (!turnOn) return this.set(id, "off");
        const attrs = {};
        if (data.brightness !== undefined) attrs.brightness = data.brightness;
        if (data.brightness_pct !== undefined) attrs.brightness = Math.round((data.brightness_pct / 100) * 255);
        if (data.color_temp_kelvin !== undefined) Object.assign(attrs, { color_temp_kelvin: data.color_temp_kelvin, color_mode: "color_temp" });
        if (data.hs_color !== undefined) Object.assign(attrs, { hs_color: data.hs_color, color_mode: "hs" });
        if (attrs.brightness === undefined && !s.attributes.brightness) attrs.brightness = 200;
        return this.set(id, attrs.brightness === 0 ? "off" : "on", attrs);
      }
      case "switch":
      case "input_boolean":
        return this.set(id, service === "toggle" ? toggle() : service === "turn_on" ? "on" : "off");
      case "fan":
        if (service === "set_percentage") return this.set(id, data.percentage > 0 ? "on" : "off", { percentage: data.percentage });
        return this.set(id, service === "toggle" ? toggle() : service === "turn_on" ? "on" : "off", { percentage: service === "turn_off" ? 0 : 60 });
      case "humidifier":
        if (service === "set_humidity") return this.set(id, undefined, { humidity: data.humidity });
        if (service === "set_mode") return this.set(id, undefined, { mode: data.mode });
        return this.set(id, service === "toggle" ? toggle() : service === "turn_on" ? "on" : "off");
      case "media_player":
        switch (service) {
          case "media_play": return this.set(id, "playing");
          case "media_pause": return this.set(id, "paused");
          case "media_play_pause": return this.set(id, s.state === "playing" ? "paused" : "playing");
          case "media_next_track": return this._nextTrack(1);
          case "media_previous_track": return this._nextTrack(-1);
          case "volume_set": return this.set(id, undefined, { volume_level: data.volume_level });
          case "volume_mute": return this.set(id, undefined, { is_volume_muted: data.is_volume_muted });
          case "select_source": return this.set(id, undefined, { source: data.source });
          case "turn_on": return this.set(id, "on");
          case "turn_off": return this.set(id, "off");
          case "toggle": return this.set(id, s.state === "off" ? "on" : "off");
        }
        return;
      case "cover": {
        const pos = Number(s.attributes.current_position ?? (s.state === "open" ? 100 : 0));
        const to =
          service === "open_cover" ? 100 : service === "close_cover" ? 0 : service === "set_cover_position" ? data.position :
          service === "toggle" ? (pos > 0 ? 0 : 100) : service === "stop_cover" ? pos : pos;
        return this._moveCover(id, to);
      }
      case "climate":
        if (service === "set_temperature") {
          const attrs = { temperature: data.temperature };
          return this.set(id, data.hvac_mode ?? undefined, attrs);
        }
        if (service === "set_hvac_mode") return this.set(id, data.hvac_mode);
        if (service === "set_preset_mode") return this.set(id, undefined, { preset_mode: data.preset_mode });
        if (service === "turn_off") return this.set(id, "off");
        if (service === "turn_on") return this.set(id, "heat");
        return;
      case "lock":
        return this.set(id, service === "lock" ? "locked" : service === "unlock" ? "unlocked" : s.state === "locked" ? "unlocked" : "locked");
      case "alarm_control_panel": {
        if (service === "alarm_disarm") return this.set(id, "disarmed", { changed_by: "Alex" });
        const mode = service.replace("alarm_arm_", "armed_");
        this.set(id, "arming", { arm_mode: mode, delay: 10, changed_by: "Alex" });
        setTimeout(() => {
          if (this.states[id].state !== "arming") return;
          this.set(id, mode);
          this.flush();
        }, 10000);
        return;
      }
      case "vacuum":
        switch (service) {
          case "start": return this.set(id, "cleaning", { status: "Cleaning" });
          case "pause": return this.set(id, "paused", { status: "Paused" });
          case "stop": return this.set(id, "idle", { status: "Idle" });
          case "return_to_base": return this.set(id, "returning", { status: "Returning" });
          case "set_fan_speed": return this.set(id, undefined, { fan_speed: data.fan_speed });
        }
        return;
      case "valve":
        return this.set(id, service === "open_valve" ? "open" : service === "close_valve" ? "closed" : s.state === "open" ? "closed" : "open");
      case "scene":
        return this._scene(id);
      case "counter": {
        const v = Number(s.state);
        const step = Number(s.attributes.step) || 1;
        const next = service === "increment" ? v + step : service === "decrement" ? v - step : service === "reset" ? 0 : data.value ?? v;
        return this.set(id, clamp(next, s.attributes.minimum ?? -Infinity, s.attributes.maximum ?? Infinity));
      }
      case "todo":
        return this._todo(service, data);
      case "update":
        if (service === "install") return this.set(id, "off", { installed_version: s.attributes.latest_version });
        return;
      case "input_datetime":
        if (service === "set_datetime" && data.time) {
          const [hh, mm] = String(data.time).split(":").map(Number);
          return this.set(id, `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`, { hour: hh, minute: mm });
        }
        return;
      case "select":
      case "input_select":
        if (service === "select_option") return this.set(id, data.option);
        return;
      case "remote":
        // Android TV Remote starts an app from a link and then reports the
        // app's package as the current activity.
        if (service === "turn_on" && data.activity) return this.set(id, "on", { current_activity: APP_PACKAGES.find(([link]) => data.activity.startsWith(link))?.[1] ?? data.activity });
        return this.set(id, service === "turn_off" ? "off" : service === "turn_on" ? "on" : s.state === "on" ? "off" : "on");
      case "button":
      case "input_button":
        return this.set(id, new Date().toISOString());
    }
  }

  _moveCover(id, to) {
    clearInterval(this._coverTimers?.[id]);
    this._coverTimers ??= {};
    const from = Number(this.states[id].attributes.current_position ?? 0);
    if (from === to) return;
    const dir = to > from ? 1 : -1;
    this.set(id, dir > 0 ? "opening" : "closing");
    this._coverTimers[id] = setInterval(() => {
      const cur = Number(this.states[id].attributes.current_position ?? 0);
      const next = dir > 0 ? Math.min(to, cur + 4) : Math.max(to, cur - 4);
      const done = next === to;
      this.set(id, done ? (next === 0 ? "closed" : "open") : undefined, { current_position: next });
      this.flush();
      if (done) clearInterval(this._coverTimers[id]);
    }, 250);
  }

  _scene(id) {
    if (id === "scene.movie_night") {
      this._service("light", "turn_off", {}, "light.living_ceiling");
      this._service("light", "turn_on", { brightness: 60, hs_color: [265, 70] }, "light.tv_strip");
      this._service("light", "turn_on", { brightness: 40 }, "light.floor_lamp");
      this._service("media_player", "turn_on", {}, "media_player.living_room_tv");
      this._moveCover("cover.living_room", 0);
    } else if (id === "scene.good_night") {
      for (const l of Object.keys(this.states).filter((x) => x.startsWith("light."))) this._service("light", "turn_off", {}, l);
      this._service("lock", "lock", {}, "lock.front_door");
      this._service("media_player", "media_pause", {}, "media_player.living_room");
    }
    this.set(id, new Date().toISOString());
  }

  _todo(service, data) {
    if (service === "add_item") this.todo.push({ uid: String(Date.now()), summary: data.item, status: "needs_action" });
    else if (service === "update_item") {
      const it = this.todo.find((i) => i.uid === data.item || i.summary === data.item);
      if (it) Object.assign(it, data.status ? { status: data.status } : {}, data.rename ? { summary: data.rename } : {});
    } else if (service === "remove_item") {
      const gone = [].concat(data.item);
      this.todo = this.todo.filter((i) => !gone.includes(i.uid) && !gone.includes(i.summary));
    } else if (service === "remove_completed_items") this.todo = this.todo.filter((i) => i.status !== "completed");
    this.set("todo.shopping", this.todo.filter((i) => i.status === "needs_action").length);
  }

  // ---- websocket -------------------------------------------------------------

  async callWS(msg) {
    switch (msg.type) {
      case "config/entity_registry/list":
      case "config/entity_registry/list_for_display":
        return Object.values(this.entities);
      case "config/entity_registry/get":
        return this.entities[msg.entity_id] ?? {};
      case "config/device_registry/list":
        return Object.values(this.devices);
      case "config/area_registry/list":
        return Object.values(this.areas);
      case "config/category_registry/list":
      case "config/label_registry/list":
      case "config/floor_registry/list":
        return [];
      case "frontend/get_user_data":
        return { value: this.userData[msg.key] ?? null };
      case "frontend/set_user_data":
        this.userData[msg.key] = msg.value;
        return null;
      case "history/history_during_period":
        return this._history(msg);
      case "recorder/statistics_during_period":
        return this._statistics(msg);
      case "recorder/list_statistic_ids":
        return Object.keys(ENERGY).map((id) => ({ statistic_id: id, has_sum: true, unit_of_measurement: "kWh" }));
      case "energy/get_prefs":
        return {
          energy_sources: [
            {
              type: "grid",
              flow_from: [{ stat_energy_from: "sensor.grid_import", stat_cost: "sensor.grid_cost", entity_energy_price: null, number_energy_price: 0.32 }],
              flow_to: [{ stat_energy_to: "sensor.grid_export", number_energy_price: 0.08 }],
              stat_energy_from: "sensor.grid_import",
              stat_energy_to: "sensor.grid_export",
              stat_cost: "sensor.grid_cost",
              cost_adjustment_day: 0,
            },
            { type: "solar", stat_energy_from: "sensor.solar_energy", config_entry_solar_forecast: null },
            { type: "battery", stat_energy_from: "sensor.battery_energy_out", stat_energy_to: "sensor.battery_energy_in" },
          ],
          device_consumption: DEVICE_ENERGY.map((stat_consumption) => ({ stat_consumption })),
        };
      case "energy/info":
        return { cost_sensors: { "sensor.grid_import": "sensor.grid_cost" }, solar_forecast_domains: [] };
      case "energy/solar_forecast":
        return {};
      case "lovelace/config":
        return { views: [] };
      case "lovelace/dashboards/list":
        return [];
      case "media_player/browse_media":
        return { title: "Library", media_class: "directory", children: [], can_expand: true, can_play: false };
      case "todo/item/move":
        return null;
      case "call_service":
        return this._wsService(msg);
      default:
        return {};
    }
  }

  async _wsService(msg) {
    const id = [].concat(msg.target?.entity_id ?? [])[0];
    if (msg.domain === "weather" && msg.service === "get_forecasts") {
      return { response: { [id]: { forecast: forecast(msg.service_data?.type ?? "daily", this) } } };
    }
    if (msg.domain === "calendar" && msg.service === "get_events") {
      return { response: { [id]: { events: calendarEvents(id) } } };
    }
    if (msg.domain === "todo" && msg.service === "get_items") {
      const want = msg.service_data?.status;
      const items = want ? this.todo.filter((i) => want.includes(i.status)) : this.todo;
      return { response: { [id]: { items: items.map((i) => ({ ...i })) } } };
    }
    await this.callService(msg.domain, msg.service, msg.service_data, msg.target);
    return { response: null };
  }

  async subscribeMessage(cb, msg) {
    if (msg.type === "render_template") {
      const send = () => cb({ result: renderTemplate(msg.template, this) });
      send();
      this._templateSubs.add(send);
      return () => this._templateSubs.delete(send);
    }
    if (msg.type === "history/stream") {
      setTimeout(() => cb({ states: this._history(msg) }), 0);
      return () => {};
    }
    return () => {};
  }

  // ---- history and statistics -----------------------------------------------

  /** A plausible past for a number: daily rhythm plus a little noise. */
  _pastValue(id, t) {
    const s = this.states[id];
    const dc = s?.attributes?.device_class;
    const now = Number(s?.state);
    const h = new Date(t).getHours() + new Date(t).getMinutes() / 60;
    const seed = id.length * 13;
    const noise = (k) => rand(Math.floor(t / (10 * 60e3)) + seed + k) - 0.5;
    if (dc === "temperature") {
      if (id.includes("outdoor")) return round(9 + 5 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + noise(1) * 0.6, 1);
      return round(now + 0.8 * Math.sin(((h - 15) / 24) * 2 * Math.PI) + noise(2) * 0.25 - 0.3, 1);
    }
    if (dc === "humidity") return round(now + 4 * Math.sin(((h - 5) / 24) * 2 * Math.PI) + noise(3) * 1.5);
    if (dc === "battery") return round(Math.min(100, now + (Date.now() - t) / DAY * 0.4), 1);
    if (dc === "power") {
      if (id === "sensor.solar_power") return round(7400 * solarShape(h) * (0.75 + noise(4) * 0.3));
      if (id === "sensor.house_power") return round(450 + 900 * houseShape(h) * (0.8 + noise(5) * 0.6));
      if (id === "sensor.grid_power") return round(450 + 900 * houseShape(h) - 7400 * solarShape(h) * 0.8);
      if (id === "sensor.battery_power") return round(solarShape(h) > 0.4 ? -1800 : h > 18 || h < 7 ? 700 : 0);
      return round(Math.max(0, now * (0.7 + noise(6) * 0.6)));
    }
    return now;
  }

  _history(msg) {
    const out = {};
    const start = new Date(msg.start_time).getTime();
    const end = msg.end_time ? new Date(msg.end_time).getTime() : Date.now();
    for (const id of [].concat(msg.entity_ids ?? msg.entity_id ?? [])) {
      const s = this.states[id];
      if (!s) continue;
      const numeric = s.attributes.unit_of_measurement && Number.isFinite(Number(s.state));
      if (numeric) {
        const step = Math.max(5 * 60e3, (end - start) / 300);
        const rows = [];
        for (let t = start; t < end; t += step) rows.push({ s: String(this._pastValue(id, t)), lu: t / 1000 });
        rows.push({ s: s.state, lu: end / 1000 });
        out[id] = rows;
      } else {
        // A text or on/off entity: an invented morning, then what happened here.
        const rows = [{ s: pastState(id, s.state), lu: start / 1000 }];
        const flip = start + (end - start) * 0.6;
        if (rows[0].s !== s.state) rows.push({ s: s.state, lu: flip / 1000 });
        for (const c of this.changes[id] ?? []) if (c.lu * 1000 >= start) rows.push(c);
        out[id] = rows;
      }
    }
    return out;
  }

  _statistics(msg) {
    const out = {};
    const now = Date.now();
    const len = msg.period === "5minute" ? 5 * 60e3 : msg.period === "hour" ? HOUR : msg.period === "day" ? DAY : msg.period === "week" ? 7 * DAY : 30 * DAY;
    const start = new Date(msg.start_time).getTime();
    const end = msg.end_time ? new Date(msg.end_time).getTime() : now;
    for (const id of msg.statistic_ids ?? []) {
      const spec = ENERGY[id];
      const rows = [];
      if (spec) {
        let sum = (spec.perDay * (start - EPOCH)) / DAY;
        for (let t = start; t < Math.min(end, now); t += len) {
          const change = energyBetween(spec, t, Math.min(t + len, now));
          sum += change;
          rows.push({ start: t, end: t + len, change, sum, state: sum });
        }
      } else if (this.states[id]) {
        for (let t = start; t < Math.min(end, now); t += len) {
          const v = this._pastValue(id, t + len / 2);
          const spread = this.states[id].attributes.device_class === "power" ? Math.abs(v) * 0.5 : 0.6;
          rows.push({ start: t, end: t + len, mean: v, min: v - spread, max: v + spread, state: v });
        }
      }
      out[id] = rows;
    }
    return out;
  }

  // ---- hass ------------------------------------------------------------------

  _build() {
    const lang = this.language;
    const labels = STATE_LABELS[lang] ?? STATE_LABELS.en;
    const fmt = (v, d) => Number(v).toLocaleString(lang === "de" ? "de-DE" : "en-US", { maximumFractionDigits: d ?? 2 });
    const sim = this;
    const entities = {};
    for (const [id, e] of Object.entries(this.entities)) {
      const dev = e.device_id ? this.devices[e.device_id] : undefined;
      entities[id] = { ...e, area_id: e.area_id ?? dev?.area_id ?? null };
    }
    // In German the house speaks German too: names swapped on a copy, cached
    // per state object so an unchanged entity stays the same object.
    let states = { ...this.states };
    let areas = this.areas;
    if (lang === "de") {
      for (const [id, s] of Object.entries(states)) {
        const name = this.namesDe.entities[id];
        if (!name) continue;
        let de = this._deCache.get(s);
        if (!de) {
          de = { ...s, attributes: { ...s.attributes, friendly_name: name } };
          this._deCache.set(s, de);
        }
        states[id] = de;
      }
      areas = Object.fromEntries(Object.entries(this.areas).map(([id, a]) => [id, { ...a, name: this.namesDe.areas[id] ?? a.name }]));
    }
    return {
      states,
      entities,
      devices: this.devices,
      areas,
      floors: {},
      language: lang,
      selectedLanguage: lang,
      locale: { language: lang, number_format: "language", time_format: "24", date_format: "language", first_weekday: "monday", time_zone: "local" },
      config: {
        unit_system: { temperature: "°C", length: "km", mass: "kg", volume: "L", pressure: "hPa", wind_speed: "km/h" },
        time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        currency: "EUR",
        components: ["energy", "weather", "history", "recorder", "todo", "frontend"],
        version: "2026.11.1",
        location_name: "Lindqvist Home",
        latitude: 52.5,
        longitude: 13.4,
        state: "RUNNING",
      },
      themes: { darkMode: this.dark, default_theme: "default", themes: {}, theme: "default" },
      selectedTheme: { theme: "default", dark: this.dark },
      services: SERVICES,
      user: { id: "demo", name: "Alex", is_admin: true, is_owner: true },
      panels: {},
      connected: true,
      enableShortcuts: false,
      auth: { data: { hassUrl: location.origin } },
      hassUrl: (p = "") => location.origin + p,
      formatEntityState: (s, st) => {
        const v = st ?? s.state;
        if (labels[v]) return labels[v];
        const u = s.attributes.unit_of_measurement;
        return v !== "" && Number.isFinite(Number(v)) ? `${fmt(v)}${u ? (u === "%" ? " %" : " " + u) : ""}` : String(v);
      },
      formatEntityAttributeValue: (s, a) => String(s.attributes[a] ?? ""),
      formatEntityAttributeName: (_s, a) => a,
      formatEntityName: (s) => s?.attributes?.friendly_name ?? s?.entity_id,
      localize: (k) => k.split(".").pop() ?? k,
      loadBackendTranslation: async () => (k) => k,
      callService: (d, s, data, target) => sim.callService(d, s, data, target),
      callApi: async () => ({}),
      callWS: (msg) => sim.callWS(msg),
      connection: {
        subscribeMessage: (cb, msg) => sim.subscribeMessage(cb, msg),
        subscribeEvents: async () => () => {},
        sendMessagePromise: (msg) => sim.callWS(msg),
      },
    };
  }

  /**
   * The household in fast forward: washer, dishwasher and dryer run their
   * last stretch and finish one after another, the vacuum makes a round and
   * docks — a few seconds for what takes an hour, so the running cards move
   * and the "done" notifications come. Runs on opening and from the scenarios.
   */
  showReel() {
    clearInterval(this._reel);
    // One after another, a notification's length plus the pause apart (see
    // TOAST_MS in notify.js): the dryer's "started" comes first, then each "done"
    // in turn, so no two notifications ever meet.
    const gap = 8;
    const plan = [
      // entity prefix, minutes left at the start, seconds until done, draw while running
      ["washer", 38, gap, (f) => (f > 0.75 ? 480 + Math.random() * 120 : 180 + Math.random() * 40)],
      ["dishwasher", 47, 2 * gap, (f) => (Math.floor(f * 6) % 2 ? 90 : 1900)],
      ["dryer", 52, 3 * gap, () => 720 + Math.random() * 80],
    ];
    for (const [p, left] of plan) {
      // The time left first: the "started" notification reads it off the state change.
      this.set(`sensor.${p}_remaining`, left);
      // Washer and dishwasher pick up a run already under way; only the dryer
      // starts here, so only it announces itself.
      this.quiet = p !== "dryer";
      this.set(`sensor.${p}_state`, "run");
      this.quiet = false;
      if (this.states[`sensor.${p}_progress`]) this.set(`sensor.${p}_progress`, 100 - left);
    }
    this.set("vacuum.robo", "cleaning", { battery_level: 82, status: "Cleaning" });
    this.flush();
    const started = performance.now();
    const STEP = 200;
    this._reel = setInterval(() => {
      const s = (performance.now() - started) / 1000;
      let running = false;
      for (const [p, left, secs, draw] of plan) {
        if (this.get(`sensor.${p}_state`).state !== "run") continue;
        const f = Math.min(1, s / secs);
        if (f >= 1) {
          this.set(`sensor.${p}_state`, "finished");
          this.set(`sensor.${p}_remaining`, 0);
          if (this.states[`sensor.${p}_progress`]) this.set(`sensor.${p}_progress`, 100);
          this.set(`sensor.${p}_power`, 1);
          continue;
        }
        running = true;
        const now = Math.max(1, Math.round(left * (1 - f)));
        this.set(`sensor.${p}_remaining`, now);
        if (this.states[`sensor.${p}_progress`]) this.set(`sensor.${p}_progress`, Math.round(100 - now));
        this.set(`sensor.${p}_power`, Math.round(draw(f)));
      }
      const vac = this.get("vacuum.robo");
      if (s < 5) this.set("vacuum.robo", undefined, { battery_level: Math.round(82 - s * 2), status: "Cleaning" });
      else if (s < 7 && vac.state === "cleaning") this.set("vacuum.robo", "returning", { status: "Returning" });
      else if (s >= 7 && vac.state === "returning") this.set("vacuum.robo", "docked", { status: "Charging" });
      running ||= this.get("vacuum.robo").state !== "docked";
      this.flush();
      if (!running) {
        clearInterval(this._reel);
        this._reel = undefined;
      }
    }, STEP);
  }

  destroy() {
    for (const t of this._timers) clearInterval(t);
  }
}

/** App links as the Google TV remote card sends them, and the package each opens. */
const APP_PACKAGES = [
  ["vnd.youtube://", "org.smarttube.stable"],
  ["https://www.netflix.com", "com.netflix.ninja"],
  ["https://app.primevideo.com", "com.amazon.amazonvideo.livingroom"],
];

/** The washer's draw: heating at the start, spinning at the end, little between. */
function left60(minutesLeft) {
  if (minutesLeft > 70) return 1950;
  if (minutesLeft < 12) return 480;
  return 180;
}

function energyBetween(spec, from, to) {
  let total = 0;
  const sumShape = Array.from({ length: 24 }, (_, i) => spec.shape(i + 0.5)).reduce((a, b) => a + b, 0) || 1;
  for (let t = from; t < to; t += HOUR) {
    const part = Math.min(HOUR, to - t) / HOUR;
    const d = new Date(t);
    const h = d.getHours() + 0.5;
    const day = Math.floor(t / DAY);
    total += ((spec.perDay * spec.shape(h)) / sumShape) * part * (0.75 + 0.5 * rand(day + spec.perDay));
  }
  return total;
}

/** A week of family life, from today. */
function calendarEvents(id) {
  const day = (d, hh, mm = 0) => {
    const t = new Date();
    t.setDate(t.getDate() + d);
    t.setHours(hh, mm, 0, 0);
    return t.toISOString();
  };
  const date = (d) => {
    const t = new Date();
    t.setDate(t.getDate() + d);
    return t.toISOString().slice(0, 10);
  };
  if (id === "calendar.school") {
    return [
      { summary: "Swimming", start: day(1, 15), end: day(1, 16, 30), location: "Pool" },
      { summary: "Parents' evening", start: day(3, 19), end: day(3, 20, 30) },
      { summary: "School trip", start: date(5), end: date(6) },
    ];
  }
  return [
    { summary: "Dentist — Leo", start: day(0, 16, 30), end: day(0, 17, 15), location: "Dr. Berg" },
    { summary: "Football training", start: day(1, 17), end: day(1, 18, 30) },
    { summary: "Grandma's birthday", start: date(2), end: date(3) },
    { summary: "Car service", start: day(4, 8), end: day(4, 9) },
    { summary: "Dinner with the Okafors", start: day(6, 19), end: day(6, 22) },
  ];
}

function pastState(id, now) {
  const d = id.split(".")[0];
  if (d === "light") return now === "on" ? "off" : "on";
  if (d === "binary_sensor") return "off";
  if (d === "person") return id === "person.leo" ? "home" : "not_home";
  return now;
}

const COND = ["partlycloudy", "sunny", "sunny", "cloudy", "partlycloudy", "rainy", "partlycloudy", "sunny"];
function forecast(type, sim) {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  if (type === "hourly") {
    return Array.from({ length: 24 }, (_, i) => {
      const t = new Date(now.getTime() + i * HOUR);
      const h = t.getHours();
      return {
        datetime: t.toISOString(),
        temperature: round(9 + 5 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + rand(i) * 0.6, 1),
        condition: h < 7 || h > 19 ? "clear-night" : COND[i % COND.length],
        precipitation_probability: i > 14 && i < 18 ? 40 : 5,
        wind_speed: 10 + Math.round(rand(i + 3) * 10),
      };
    });
  }
  return Array.from({ length: 7 }, (_, i) => {
    const t = new Date(now.getTime() + i * DAY);
    return {
      datetime: t.toISOString(),
      temperature: 12 + Math.round(rand(i) * 6),
      templow: 4 + Math.round(rand(i + 9) * 4),
      condition: COND[(i + 2) % COND.length],
      precipitation_probability: i === 3 ? 60 : 10,
    };
  });
}

/** Just enough Jinja for card templates: states('…'), state_attr('…','…'). */
function renderTemplate(template, sim) {
  return String(template)
    .replace(/\{\{\s*states\(\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g, (_, id) => sim.states[id]?.state ?? "unknown")
    .replace(/\{\{\s*state_attr\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g, (_, id, a) => String(sim.states[id]?.attributes?.[a] ?? ""))
    .replace(/\{%.*?%\}|\{\{.*?\}\}/g, "");
}

const SERVICES = Object.fromEntries(
  [
    ["light", ["turn_on", "turn_off", "toggle"]],
    ["switch", ["turn_on", "turn_off", "toggle"]],
    ["input_boolean", ["turn_on", "turn_off", "toggle"]],
    ["fan", ["turn_on", "turn_off", "toggle", "set_percentage"]],
    ["climate", ["set_temperature", "set_hvac_mode", "set_preset_mode", "turn_on", "turn_off"]],
    ["cover", ["open_cover", "close_cover", "stop_cover", "set_cover_position", "toggle"]],
    ["media_player", ["media_play", "media_pause", "media_play_pause", "media_next_track", "media_previous_track", "volume_set", "volume_mute", "select_source", "turn_on", "turn_off", "toggle"]],
    ["lock", ["lock", "unlock", "open"]],
    ["vacuum", ["start", "pause", "stop", "return_to_base", "set_fan_speed"]],
    ["notify", ["mobile_app_alex", "mobile_app_mia"]],
    ["todo", ["add_item", "update_item", "remove_item", "get_items"]],
  ].map(([d, list]) => [d, Object.fromEntries(list.map((s) => [s, {}]))]),
);
