import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  OptimisticActivity,
  activityColor,
  activityIcon,
  discoverVacuum,
  findDockDevice,
  fanSpeedKey,
  isVacuumError,
  pickMapCamera,
  optimisticActivity,
  primaryIntent,
  resolveActivity,
  supportsFeature,
} from "./vacuum";
import { PALETTE } from "./tokens";
import type { HomeAssistant } from "../types";

describe("resolveActivity", () => {
  it("passes through the states a vacuum entity reports", () => {
    expect(resolveActivity("cleaning")).toBe("cleaning");
    expect(resolveActivity("docked")).toBe("docked");
    expect(resolveActivity("paused")).toBe("paused");
    expect(resolveActivity("error")).toBe("error");
  });

  it("accepts the legacy returning_home spelling", () => {
    expect(resolveActivity("returning_home")).toBe("returning");
    expect(resolveActivity("returning")).toBe("returning");
  });

  it("treats a missing or unknown state as unavailable", () => {
    expect(resolveActivity(undefined)).toBe("unavailable");
    expect(resolveActivity("unknown")).toBe("unavailable");
    expect(resolveActivity("unavailable")).toBe("unavailable");
  });

  it("treats a vendor-specific state as idle, not as an error", () => {
    // A Valetudo or Dreame vacuum reporting its own vocabulary is not broken,
    // and painting the card red for it would be a lie.
    expect(resolveActivity("segment_cleaning")).toBe("idle");
    expect(resolveActivity("spot_cleaning")).toBe("idle");
  });
});

describe("activityColor", () => {
  it("uses the suite palette rather than its own hex values", () => {
    expect(activityColor("cleaning")).toBe(PALETTE.home);
    expect(activityColor("docked")).toBe(PALETTE.ok);
    expect(activityColor("paused")).toBe(PALETTE.solar);
    expect(activityColor("returning")).toBe(PALETTE.media);
    expect(activityColor("error")).toBe(PALETTE.heat);
    expect(activityColor("unavailable")).toBe(PALETTE.off);
  });
});

describe("primaryIntent", () => {
  it("offers the action that makes sense from each state", () => {
    expect(primaryIntent("docked")).toBe("start");
    expect(primaryIntent("idle")).toBe("start");
    expect(primaryIntent("cleaning")).toBe("pause");
    expect(primaryIntent("paused")).toBe("resume");
  });

  it("offers nothing while returning or errored", () => {
    expect(primaryIntent("returning")).toBe("none");
    expect(primaryIntent("error")).toBe("none");
    expect(primaryIntent("unavailable")).toBe("none");
  });
});

describe("optimisticActivity", () => {
  it("maps each command onto the state it produces", () => {
    expect(optimisticActivity("start", "docked")).toBe("cleaning");
    expect(optimisticActivity("resume", "paused")).toBe("cleaning");
    expect(optimisticActivity("pause", "cleaning")).toBe("paused");
    expect(optimisticActivity("return", "cleaning")).toBe("returning");
    expect(optimisticActivity("stop", "cleaning")).toBe("idle");
  });

  it("leaves the state alone when there is nothing to do", () => {
    expect(optimisticActivity("none", "error")).toBe("error");
  });
});

describe("OptimisticActivity", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the guess while the real state still lags", () => {
    const o = new OptimisticActivity();
    o.set("cleaning");
    expect(o.resolve("docked")).toEqual({ activity: "cleaning", pending: true });
  });

  it("stops guessing once the poll confirms it", () => {
    const o = new OptimisticActivity();
    o.set("cleaning");
    expect(o.resolve("cleaning")).toEqual({ activity: "cleaning", pending: false });
    // And stays settled afterwards, rather than re-arming on the next tick.
    expect(o.resolve("docked")).toEqual({ activity: "docked", pending: false });
  });

  it("lets an error through immediately, guess or no guess", () => {
    // The one state the user must not be kept from seeing for the sake of a
    // smooth animation.
    const o = new OptimisticActivity();
    o.set("cleaning");
    expect(o.resolve("error")).toEqual({ activity: "error", pending: false });
  });

  it("gives up when the confirmation never arrives", () => {
    const expired = vi.fn();
    const o = new OptimisticActivity(70_000, expired);
    o.set("cleaning");
    expect(o.resolve("docked").pending).toBe(true);
    vi.advanceTimersByTime(70_001);
    expect(expired).toHaveBeenCalledOnce();
    expect(o.resolve("docked")).toEqual({ activity: "docked", pending: false });
  });

  it("clear() drops the guess and its timer", () => {
    const expired = vi.fn();
    const o = new OptimisticActivity(70_000, expired);
    o.set("cleaning");
    o.clear();
    vi.advanceTimersByTime(70_001);
    expect(expired).not.toHaveBeenCalled();
    expect(o.resolve("docked").pending).toBe(false);
  });
});

describe("isVacuumError", () => {
  it("reads Valetudo's \"No error\" as healthy, like Roborock's none (#73)", () => {
    for (const s of ["No error", "no_error", "none", "ok"]) expect(isVacuumError(s)).toBe(false);
  });

  it("does not report a sensor it cannot read", () => {
    for (const s of [undefined, "", "unknown", "unavailable"]) expect(isVacuumError(s)).toBe(false);
  });

  it("reports real errors, including ones that merely start with no", () => {
    for (const s of ["water_empty", "Main brush jammed", "no_water_tank", "Dustbin missing"]) {
      expect(isVacuumError(s)).toBe(true);
    }
  });
});

describe("fanSpeedKey", () => {
  it("normalises the vendor spellings it knows", () => {
    expect(fanSpeedKey("Balanced")).toBe("balanced");
    expect(fanSpeedKey("Max+")).toBe("max_plus");
    expect(fanSpeedKey("max plus")).toBe("max_plus");
  });

  it("returns nothing for a speed it has no translation for", () => {
    expect(fanSpeedKey("Teppichboost")).toBeUndefined();
  });
});

// --- discovery ---------------------------------------------------------------

function fakeHass(
  entities: Record<
    string,
    { device_id?: string; translation_key?: string; device_class?: string }
  >,
  devices: Record<string, string> = {},
): HomeAssistant {
  const states: Record<string, unknown> = {};
  const registry: Record<string, unknown> = {};
  for (const [entityId, entry] of Object.entries(entities)) {
    states[entityId] = {
      state: "on",
      attributes: entry.device_class ? { device_class: entry.device_class } : {},
    };
    registry[entityId] = { entity_id: entityId, ...entry };
  }
  // devices maps device_id -> its roborock identifier
  const devs: Record<string, unknown> = {};
  for (const [id, duid] of Object.entries(devices)) {
    devs[id] = { id, identifiers: [["roborock", duid]] };
  }
  return { states, entities: registry, devices: devs } as unknown as HomeAssistant;
}

describe("discoverVacuum", () => {
  it("finds companions on the vacuum's own device", () => {
    const hass = fakeHass({
      "vacuum.sushi": { device_id: "dev1" },
      "select.sushi_mop_intensity": { device_id: "dev1", translation_key: "mop_intensity" },
      "sensor.sushi_cleaning_progress": { device_id: "dev1", translation_key: "cleaning_progress" },
      "image.sushi_downstairs": { device_id: "dev1" },
      "binary_sensor.sushi_mop_attached": { device_id: "dev1", translation_key: "mop_attached" },
      "switch.sushi_mop_washing": { device_id: "dev1", translation_key: "mop_washing" },
      "sensor.sushi_filter_time_left": { device_id: "dev1", translation_key: "filter_time_left" },
    });
    const found = discoverVacuum(hass, "vacuum.sushi");
    expect(found.deviceId).toBe("dev1");
    expect(found.mopIntensity).toBe("select.sushi_mop_intensity");
    expect(found.progress).toBe("sensor.sushi_cleaning_progress");
    expect(found.map).toBe("image.sushi_downstairs");
    expect(found.binary.mop_attached).toBe("binary_sensor.sushi_mop_attached");
    expect(found.switches.mop_washing).toBe("switch.sushi_mop_washing");
    expect(found.consumables.filter).toBe("sensor.sushi_filter_time_left");
  });

  it("takes Dreame's live map camera when there is no image entity (#77)", () => {
    const hass = fakeHass({
      "vacuum.l20": { device_id: "dev1" },
      "camera.l20_map_data": { device_id: "dev1", translation_key: "map_data" },
      "camera.l20_map": { device_id: "dev1", translation_key: "map" },
      "camera.l20_map_1": { device_id: "dev1", translation_key: "map_1" },
      "camera.l20_wifi_map_1": { device_id: "dev1", translation_key: "wifi_map_1" },
    });
    expect(discoverVacuum(hass, "vacuum.l20").map).toBe("camera.l20_map");
  });

  it("finds the live map camera by its entity_id, and never a saved or WiFi map", () => {
    expect(
      pickMapCamera([
        { entity_id: "camera.l20_wifi_map" },
        { entity_id: "camera.l20_map_1" },
        { entity_id: "camera.l20_map" },
      ]),
    ).toBe("camera.l20_map");
    expect(pickMapCamera([{ entity_id: "camera.l20_map_data" }, { entity_id: "camera.l20_map_2" }])).toBeUndefined();
    expect(pickMapCamera([{ entity_id: "camera.robot_floor" }])).toBe("camera.robot_floor");
  });

  it("prefers an image entity over a camera", () => {
    const hass = fakeHass({
      "vacuum.sushi": { device_id: "dev1" },
      "camera.sushi_map": { device_id: "dev1" },
      "image.sushi_downstairs": { device_id: "dev1" },
    });
    expect(discoverVacuum(hass, "vacuum.sushi").map).toBe("image.sushi_downstairs");
  });

  it("still finds a renamed entity, because it matches the translation key", () => {
    // The entity_id is the user's to change; the translation key is not.
    const hass = fakeHass({
      "vacuum.sushi": { device_id: "dev1" },
      "sensor.staubsauger_restlaufzeit_hauptbuerste": {
        device_id: "dev1",
        translation_key: "main_brush_time_left",
      },
    });
    const found = discoverVacuum(hass, "vacuum.sushi");
    expect(found.consumables.main_brush).toBe("sensor.staubsauger_restlaufzeit_hauptbuerste");
  });

  it("falls back to the entity_id suffix when no translation key is set", () => {
    const hass = fakeHass({
      "vacuum.sushi": { device_id: "dev1" },
      "select.sushi_mop_mode": { device_id: "dev1" },
    });
    expect(discoverVacuum(hass, "vacuum.sushi").mopMode).toBe("select.sushi_mop_mode");
  });

  it("ignores entities belonging to another device", () => {
    const hass = fakeHass({
      "vacuum.sushi": { device_id: "dev1" },
      "select.other_mop_mode": { device_id: "dev2", translation_key: "mop_mode" },
    });
    expect(discoverVacuum(hass, "vacuum.sushi").mopMode).toBeUndefined();
  });

  it("ignores a registry entry with no state behind it", () => {
    // Disabled entities stay in the registry; rendering a block for one would
    // produce a control that can never do anything.
    const hass = fakeHass({ "vacuum.sushi": { device_id: "dev1" } });
    (hass.entities as Record<string, unknown>)["button.sushi_reset_filter"] = {
      entity_id: "button.sushi_reset_filter",
      device_id: "dev1",
      translation_key: "reset_filter",
    };
    expect(discoverVacuum(hass, "vacuum.sushi").deviceId).toBe("dev1");
    expect(Object.keys(discoverVacuum(hass, "vacuum.sushi").consumables)).toHaveLength(0);
  });

  it("finds the buttons that zero a consumable's counter", () => {
    const hass = fakeHass({
      "vacuum.sushi": { device_id: "dev1" },
      "button.sushi_reset_main_brush_consumable": {
        device_id: "dev1",
        translation_key: "reset_main_brush_consumable",
      },
      "button.sushi_reset_air_filter_consumable": {
        device_id: "dev1",
        translation_key: "reset_air_filter_consumable",
      },
    });
    const found = discoverVacuum(hass, "vacuum.sushi");
    expect(found.resets.main_brush).toBe("button.sushi_reset_main_brush_consumable");
    expect(found.resets.filter).toBe("button.sushi_reset_air_filter_consumable");
    expect(found.resets.side_brush).toBeUndefined();
  });

  it("finds no reset while Home Assistant keeps the button disabled", () => {
    // Which is how it ships them. A disabled entity has no state, and the
    // card's greyed-out reset icon is drawn off exactly this absence.
    const hass = fakeHass({ "vacuum.sushi": { device_id: "dev1" } });
    expect(discoverVacuum(hass, "vacuum.sushi").resets).toEqual({});
  });

  it("returns nothing useful when the vacuum has no device", () => {
    const hass = fakeHass({ "vacuum.sushi": {} });
    const found = discoverVacuum(hass, "vacuum.sushi");
    expect(found.deviceId).toBeUndefined();
    expect(found.consumables).toEqual({});
  });

  it("does not let mop_mode swallow mop_intensity", () => {
    const hass = fakeHass({
      "vacuum.sushi": { device_id: "dev1" },
      "select.sushi_mop_mode": { device_id: "dev1", translation_key: "mop_mode" },
      "select.sushi_mop_intensity": { device_id: "dev1", translation_key: "mop_intensity" },
    });
    const found = discoverVacuum(hass, "vacuum.sushi");
    expect(found.mopMode).toBe("select.sushi_mop_mode");
    expect(found.mopIntensity).toBe("select.sushi_mop_intensity");
  });
});


describe("discoverVacuum — the dock is a second device", () => {
  // Roborock registers the dock separately and links it by neither
  // via_device nor parent_device. Everything below would be missing from the
  // card if the walk stopped at the vacuum's own device.
  const hass = () =>
    fakeHass(
      {
        "vacuum.dobby": { device_id: "vac" },
        "binary_sensor.dobby_dock_schmutzwassertank": {
          device_id: "dock",
          translation_key: "dirty_box_full",
        },
        "binary_sensor.dobby_dock_frischwassertank": {
          device_id: "dock",
          translation_key: "clean_box_empty",
        },
        "select.dobby_dock_entleerungsmodus": {
          device_id: "dock",
          translation_key: "dust_collection_mode",
        },
        "sensor.dobby_dock_burstenwartung": {
          device_id: "dock",
          translation_key: "cleaning_brush_time_left",
        },
        "sensor.dobby_dock_ladestation_fehler": {
          device_id: "dock",
          translation_key: "dock_error",
        },
        "switch.dobby_dock_moppwasche": { device_id: "dock", translation_key: "mop_washing" },
        "switch.dobby_kindersicherung": { device_id: "dock", translation_key: "child_lock" },
      },
      { vac: "ABC123", dock: "ABC123_dock" },
    );

  it("finds the dock through the <duid>_dock identifier", () => {
    expect(findDockDevice(hass(), "vac")).toBe("dock");
  });

  it("collects the dock's entities alongside the vacuum's own", () => {
    const found = discoverVacuum(hass(), "vacuum.dobby");
    expect(found.dockDeviceId).toBe("dock");
    expect(found.binary.dirty_water_box).toBe("binary_sensor.dobby_dock_schmutzwassertank");
    expect(found.binary.clean_water_box).toBe("binary_sensor.dobby_dock_frischwassertank");
    expect(found.emptyMode).toBe("select.dobby_dock_entleerungsmodus");
    expect(found.consumables.maintenance_brush).toBe("sensor.dobby_dock_burstenwartung");
    expect(found.dockError).toBe("sensor.dobby_dock_ladestation_fehler");
    expect(found.switches.mop_washing).toBe("switch.dobby_dock_moppwasche");
    expect(found.childLock).toBe("switch.dobby_kindersicherung");
  });

  it("does not claim another vacuum's dock", () => {
    const h = fakeHass(
      {
        "vacuum.dobby": { device_id: "vac" },
        "switch.other_dock_moppwasche": { device_id: "dock2", translation_key: "mop_washing" },
      },
      { vac: "ABC123", dock2: "XYZ789_dock" },
    );
    expect(findDockDevice(h, "vac")).toBeUndefined();
    expect(discoverVacuum(h, "vacuum.dobby").switches.mop_washing).toBeUndefined();
  });

  it("copes with a vacuum that has no dock", () => {
    const h = fakeHass({ "vacuum.dobby": { device_id: "vac" } }, { vac: "ABC123" });
    expect(findDockDevice(h, "vac")).toBeUndefined();
    expect(discoverVacuum(h, "vacuum.dobby").dockDeviceId).toBeUndefined();
  });
});

describe("discoverVacuum — the keys a real S7 Pro Ultra reports", () => {
  it("matches the ones that differ from the obvious guess", () => {
    const h = fakeHass(
      {
        "vacuum.dobby": { device_id: "vac" },
        "binary_sensor.dobby_reinigen": { device_id: "vac", translation_key: "in_cleaning" },
        "switch.dobby_nicht_storen": { device_id: "vac", translation_key: "dnd_switch" },
        "select.dobby_route": { device_id: "vac", translation_key: "mop_mode" },
        "select.dobby_reinigungsmodus": { device_id: "vac", translation_key: "cleaning_mode" },
        "sensor.dobby_aktueller_raum": { device_id: "vac", translation_key: "current_room" },
      },
      { vac: "ABC123" },
    );
    const found = discoverVacuum(h, "vacuum.dobby");
    expect(found.binary.cleaning).toBe("binary_sensor.dobby_reinigen");
    expect(found.dnd).toBe("switch.dobby_nicht_storen");
    expect(found.mopMode).toBe("select.dobby_route");
    expect(found.cleaningMode).toBe("select.dobby_reinigungsmodus");
    expect(found.currentRoom).toBe("sensor.dobby_aktueller_raum");
  });

  it("finds the charging sensor by device class, since it carries no key", () => {
    const h = fakeHass(
      {
        "vacuum.dobby": { device_id: "vac" },
        "binary_sensor.dobby_ladestatus": { device_id: "vac", device_class: "battery_charging" },
      },
      { vac: "ABC123" },
    );
    expect(discoverVacuum(h, "vacuum.dobby").binary.charging).toBe(
      "binary_sensor.dobby_ladestatus",
    );
  });
});

describe("supportsFeature", () => {
  // The real bitmask from a Roborock S7 Pro Ultra.
  const S7 = 30524;

  it("reads the bits an entity declares", () => {
    expect(supportsFeature(S7, "START")).toBe(true);
    expect(supportsFeature(S7, "PAUSE")).toBe(true);
    expect(supportsFeature(S7, "RETURN_HOME")).toBe(true);
    expect(supportsFeature(S7, "FAN_SPEED")).toBe(true);
    expect(supportsFeature(S7, "LOCATE")).toBe(true);
  });

  it("reports the ones it does not", () => {
    // Battery moved to its own sensor, so the bit is deliberately unset —
    // the card must not conclude the vacuum has no battery.
    expect(supportsFeature(S7, "BATTERY")).toBe(false);
    expect(supportsFeature(S7, "TURN_ON")).toBe(false);
    expect(supportsFeature(S7, "MAP")).toBe(false);
  });

  it("treats a silent entity as capable", () => {
    // Some integrations never set supported_features. Hiding every control
    // for them would be worse than offering one that errors.
    expect(supportsFeature(undefined, "PAUSE")).toBe(true);
  });
});

describe("primaryIntent with capabilities", () => {
  it("falls back to stop on a vacuum that cannot pause", () => {
    const noPause = 8192 + 8; // START + STOP
    expect(primaryIntent("cleaning", noPause)).toBe("stop");
  });

  it("offers nothing when it can neither pause nor stop", () => {
    expect(primaryIntent("cleaning", 8192)).toBe("none");
  });

  it("offers nothing to start when START is absent", () => {
    expect(primaryIntent("docked", 4)).toBe("none");
  });

  it("behaves as before when nothing is declared", () => {
    expect(primaryIntent("cleaning")).toBe("pause");
    expect(primaryIntent("docked")).toBe("start");
  });
});

describe("activityIcon", () => {
  it("is a robot vacuum in every ordinary state", () => {
    // It used to be a house in the dock and on the way back, so a vacuum spent
    // most of its life drawn as a house. The colour carries the state now.
    for (const activity of ["cleaning", "docked", "returning", "paused", "idle"] as const) {
      expect(activityIcon(activity)).toBe("mdi:robot-vacuum");
    }
  });

  it("keeps a mark for the two states worth noticing from across the room", () => {
    expect(activityIcon("error")).toBe("mdi:robot-vacuum-alert");
    expect(activityIcon("unavailable")).toBe("mdi:robot-vacuum-off");
  });
});
