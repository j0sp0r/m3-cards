// The few Home Assistant elements the cards render into, for a page that has
// no Home Assistant behind it: a card frame, icons by name and icons for an
// entity. Everything else the cards draw is their own.

import * as mdi from "https://cdn.jsdelivr.net/npm/@mdi/js@7.4.47/+esm";

const mdiName = (icon) =>
  "mdi" +
  String(icon)
    .replace(/^mdi:/, "")
    .split("-")
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : ""))
    .join("");

const svgFor = (icon) => mdi[mdiName(icon ?? "")] ?? mdi.mdiHelpCircleOutline;

const DOMAIN_ICONS = {
  light: "mdi:lightbulb",
  switch: "mdi:toggle-switch",
  climate: "mdi:thermostat",
  media_player: "mdi:speaker",
  cover: "mdi:window-shutter",
  fan: "mdi:fan",
  lock: "mdi:lock",
  vacuum: "mdi:robot-vacuum",
  humidifier: "mdi:air-humidifier",
  person: "mdi:account",
  weather: "mdi:weather-partly-cloudy",
  alarm_control_panel: "mdi:shield-home",
  input_boolean: "mdi:toggle-switch-outline",
  scene: "mdi:palette",
  script: "mdi:script-text",
  valve: "mdi:valve",
  todo: "mdi:clipboard-list",
  update: "mdi:package-up",
  sun: "mdi:white-balance-sunny",
  sensor: "mdi:eye",
  binary_sensor: "mdi:radiobox-blank",
  button: "mdi:gesture-tap-button",
};

const CLASS_ICONS = {
  temperature: "mdi:thermometer",
  humidity: "mdi:water-percent",
  power: "mdi:flash",
  energy: "mdi:lightning-bolt",
  battery: "mdi:battery",
  illuminance: "mdi:brightness-5",
  moisture: "mdi:water-alert",
  door: "mdi:door",
  window: "mdi:window-open-variant",
  garage_door: "mdi:garage",
  motion: "mdi:motion-sensor",
  occupancy: "mdi:home-account",
  smoke: "mdi:smoke-detector",
  connectivity: "mdi:wifi",
  plug: "mdi:power-plug",
  outlet: "mdi:power-socket-de",
  shutter: "mdi:window-shutter",
  blind: "mdi:blinds",
  water: "mdi:water",
};

class HaIcon extends HTMLElement {
  static get observedAttributes() {
    return ["icon"];
  }
  set icon(v) {
    this._icon = v;
    this._draw();
  }
  get icon() {
    return this._icon ?? this.getAttribute("icon");
  }
  attributeChangedCallback() {
    this._draw();
  }
  connectedCallback() {
    this._draw();
  }
  _draw() {
    const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>:host{display:inline-flex;align-items:center;justify-content:center;width:var(--mdc-icon-size,24px);height:var(--mdc-icon-size,24px);vertical-align:middle;fill:currentColor}svg{width:100%;height:100%;display:block}</style><svg viewBox="0 0 24 24"><path d="${svgFor(this.icon)}"></path></svg>`;
  }
}
customElements.define("ha-icon", HaIcon);

class HaStateIcon extends HaIcon {
  set stateObj(v) {
    this._state = v;
    this._draw();
  }
  set hass(_v) {}
  get icon() {
    const s = this._state;
    const dc = s?.attributes?.device_class;
    return (
      this._icon ||
      s?.attributes?.icon ||
      (dc && CLASS_ICONS[dc]) ||
      DOMAIN_ICONS[s?.entity_id?.split(".")[0]] ||
      "mdi:circle-outline"
    );
  }
  set icon(v) {
    this._icon = v;
    this._draw();
  }
}
customElements.define("ha-state-icon", HaStateIcon);

class HaCard extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>:host{display:block;background:var(--ha-card-background,var(--card-background-color));border-radius:var(--ha-card-border-radius,12px);color:var(--primary-text-color);overflow:hidden;box-sizing:border-box;height:100%}</style><slot></slot>`;
  }
}
customElements.define("ha-card", HaCard);

// Home Assistant's card factory, which the popup and the detail sheet use to
// build the cards they hold.
window.loadCardHelpers = async () => ({
  createCardElement(config) {
    const tag = String(config.type).replace(/^custom:/, "");
    const el = document.createElement(tag);
    el.setConfig?.(config);
    return el;
  },
});
