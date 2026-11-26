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

// Home Assistant's live camera view. The demo has no stream, so it paints the
// camera's picture into a real <video> (a canvas stream), with a slow pan
// that reads as "moving". A video, because the card waits for one with a
// frame before it fades the stream in, as it does with Home Assistant's.
class HaCameraStream extends HTMLElement {
  set stateObj(s) {
    this._pic = s?.attributes?.entity_picture;
    this._draw();
  }
  connectedCallback() {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" }).innerHTML =
        `<style>:host{display:block;overflow:hidden}video{width:100%;height:100%;object-fit:cover;animation:pan 9s ease-in-out infinite alternate}@keyframes pan{to{transform:scale(1.06) translateX(-1.5%)}}@media (prefers-reduced-motion:reduce){video{animation:none}}</style><video muted playsinline autoplay></video>`;
    }
    this._draw();
  }
  disconnectedCallback() {
    clearInterval(this._timer);
    this._timer = undefined;
  }
  _draw() {
    const video = this.shadowRoot?.querySelector("video");
    if (!video || !this._pic || this._drawn === this._pic) return;
    this._drawn = this._pic;
    const img = new Image();
    img.onload = () => {
      const canvas = this._canvas ?? (this._canvas = document.createElement("canvas"));
      canvas.width = img.naturalWidth || 640;
      canvas.height = img.naturalHeight || 360;
      const ctx = canvas.getContext("2d");
      const paint = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      paint();
      clearInterval(this._timer);
      // A stream only produces frames when the canvas is painted.
      this._timer = setInterval(paint, 200);
      if (!video.srcObject && canvas.captureStream) {
        video.srcObject = canvas.captureStream(5);
        video.play?.().catch(() => {});
      }
    };
    img.src = this._pic;
  }
}
customElements.define("ha-camera-stream", HaCameraStream);

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
