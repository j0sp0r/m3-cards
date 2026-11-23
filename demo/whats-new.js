// The "New" view: what the latest release brought, shown on the pretend home.
//
// Update this with every release. `version` must match package.json — a unit
// test (src/demo-whats-new.test.ts) fails when a release bumps the version and
// this page still shows the release before.

export const WHATS_NEW = {
  version: "2.10.0",
  /** @param t (en, de) => the text in the demo's language */
  sections: (t) => [
    [t("New card in 2.10.0", "Neue Karte in 2.10.0"), [
      {
        type: "custom:m3-network-card",
        router: {
          name: "Router", status: "binary_sensor.router_online", uptime: "sensor.router_online_since",
          connection_type: "sensor.router_connection", download: "sensor.router_download", upload: "sensor.router_upload",
        },
        device_trackers: ["device_tracker.alex_phone", "device_tracker.mia_phone", "device_tracker.leo_tablet", "device_tracker.living_tv", "device_tracker.printer_wifi", "device_tracker.robo_wifi"],
        variant: t("new in 2.10", "neu in 2.10"),
      },
    ]],
    [t("Detail card", "Detailkarte"), [
      {
        type: "custom:m3-detail-card", entity: "sensor.living_room_temperature", secondary_entity: "sensor.living_room_humidity",
        show_related: false, details: "hidden", variant: "secondary_entity",
      },
    ]],
    [t("Smaller additions", "Kleinere Neuerungen"), [
      {
        type: "custom:m3-chip-buttons-card", frameless: true, wrap: true, variant: "frameless",
        buttons: [
          { entity: "scene.movie_night", name: t("Movie night", "Filmabend"), icon: "mdi:movie-open", tap_action: { action: "toggle" } },
          { entity: "scene.good_night", name: t("Good night", "Gute Nacht"), icon: "mdi:weather-night", tap_action: { action: "toggle" } },
          { entity: "input_boolean.guest_mode", name: t("Guests", "Gäste"), icon: "mdi:account-multiple", tap_action: { action: "toggle" } },
        ],
      },
      { type: "custom:m3-weather-card", entity: "weather.home", sensors: ["sensor.outdoor_temperature", "sensor.outdoor_humidity"], decimals: 1, variant: "decimals: 1" },
      {
        type: "custom:m3-room-card", area: "living_room", collapsible: true,
        categories: [{ domain: "light", entities: ["light.floor_lamp", "light.tv_strip"] }],
        variant: t("categories[].entities — only these lights", "categories[].entities — nur diese Lichter"),
      },
    ]],
  ],
};
