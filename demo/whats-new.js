// The "New" view: what the latest release brought, shown on the pretend home.
//
// Update this with every release. `version` must match package.json — a unit
// test (src/demo-whats-new.test.ts) fails when a release bumps the version and
// this page still shows the release before.

export const WHATS_NEW = {
  version: "2.12.0",
  date: "2026-11-27",
  /** The release in a sentence or two, for the head of the page. */
  summary: {
    en: "Cameras and doorbells: card 60 shows any camera, rings with the doorbell and opens the door with a slide or a lock that springs open and shuts again. Bins fit in a row, a tile or a pill, a folded room still shows its sensors, and the cards now speak Dutch as well.",
    de: "Kameras und Türklingeln: Karte 60 zeigt jede Kamera, klingelt mit der Türklingel und öffnet die Tür per Schieber oder mit einem Schloss, das aufspringt und wieder zufällt. Die Müllabfuhr passt in eine Zeile, eine Kachel oder eine Pille, ein eingeklappter Raum zeigt weiter seine Sensoren, und die Karten sprechen jetzt auch Niederländisch.",
  },
  /** Counts for the chips beside the summary; a zero hides its chip. */
  counts: { cards: 1, features: 9 },
  /**
   * @param t (en, de) => the text in the demo's language
   * @param nav (view key) => that view's path
   */
  sections: (t) => {
    const frontDoor = (style) => ({
      camera: "camera.front_door", name: t("Front door", "Haustür"), icon: "mdi:doorbell-video",
      doorbell: "event.front_door_ding", person: "binary_sensor.front_door_person", package: "event.front_door_package",
      door_action: { style, tap_action: { action: "perform-action", perform_action: "lock.unlock", target: { entity_id: "lock.front_door" } }, feedback_entity: "lock.front_door" },
      talk_action: { tap_action: { action: "none" } },
    });
    const bins = ["sensor.waste_recycling", "sensor.waste_paper", "sensor.waste_organic", "sensor.waste_residual"];
    const waste = (layout, extra = {}) => ({ type: "custom:m3-waste-card", entities: bins, layout, variant: `layout: ${layout}`, ...extra });
    return [
      [t("Cameras and doorbells", "Kameras und Türklingeln"), [
        { type: "custom:m3-camera-card", cameras: [frontDoor("slide"), { camera: "camera.garden", name: t("Garden", "Garten"), icon: "mdi:flower-outline", motion: "binary_sensor.garden_motion" }],
          variant: "door_action.style: slide" },
        { type: "custom:m3-camera-card", cameras: [frontDoor("button")], variant: t("the door button", "der Türknopf") },
      ]],
      [t("Bins at a glance", "Müll auf einen Blick"), [
        waste("row"),
        waste("pill"),
      ]],
      [t("Rooms, folded", "Räume, eingeklappt"), [
        { type: "custom:m3-room-card", area: "living_room", collapsible: true, default_collapsed: true, folded_sensors: ["temperature", "humidity", "windows"], variant: "folded_sensors: [temperature, humidity, windows]" },
        { type: "custom:m3-room-card", area: "bedroom", collapsible: true, default_collapsed: true, folded_sensors: ["temperature"], variant: "folded_sensors: [temperature]" },
      ]],
      [t("Air conditioning: swing", "Klimaanlage: Lamellen"), [
        { type: "custom:m3-climate-card", entity: "climate.bedroom_ac", style: "expressive", show_fan_modes: true, show_swing_modes: true, show_swing_horizontal_modes: true, variant: "show_swing_modes" },
      ]],
    ];
  },
};
