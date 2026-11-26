import { describe, expect, it } from "vitest";
import { buildCameraNotifyAutomation, cameraNotifySources } from "./camera-notify";
import type { HomeAssistant } from "../types";

const hass = {
  states: Object.fromEntries(
    [
      ["camera.front_door", { friendly_name: "Front door" }],
      ["event.front_door_ding", {}],
      ["event.front_door_package", {}],
      ["binary_sensor.front_door_person", {}],
      ["camera.garden", { friendly_name: "Garden" }],
      ["binary_sensor.garden_person", {}],
      ["event.intercom_ding", { friendly_name: "Intercom" }],
    ].map(([id, attributes]) => [id, { entity_id: id, state: "off", attributes }]),
  ),
} as unknown as HomeAssistant;

const cameras = [
  { camera: "camera.front_door", doorbell: "event.front_door_ding", person: "binary_sensor.front_door_person", package: "event.front_door_package" },
  { camera: "camera.garden", name: "Back garden", person: "binary_sensor.garden_person" },
  { doorbell: "event.intercom_ding" },
  { camera: "camera.front_door", doorbell: "event.front_door_ding" },
  { doorbell: "event.gone" },
];

const texts = {
  ring: "Someone is at the {kamera}",
  person: "Person at the {kamera}",
  package: "Parcel at the {kamera}",
  words: { ring: "Doorbell", person: "Person", package: "Parcel" },
};

describe("cameraNotifySources", () => {
  it("takes the doorbells only, once each, and skips entities that do not exist", () => {
    expect(cameraNotifySources(hass, cameras, false)).toEqual([
      { entity: "event.front_door_ding", camera: "camera.front_door", name: "Front door", kind: "ring" },
      { entity: "event.intercom_ding", camera: undefined, name: "Intercom", kind: "ring" },
    ]);
  });

  it("adds persons and parcels with detections", () => {
    const kinds = cameraNotifySources(hass, cameras, true).map((s) => `${s.kind}:${s.entity}:${s.name}`);
    expect(kinds).toEqual([
      "ring:event.front_door_ding:Front door",
      "person:binary_sensor.front_door_person:Front door",
      "package:event.front_door_package:Front door",
      "person:binary_sensor.garden_person:Back garden",
      "ring:event.intercom_ding:Intercom",
    ]);
  });
});

describe("buildCameraNotifyAutomation", () => {
  const build = (targets: string[], extra = {}) =>
    buildCameraNotifyAutomation({
      id: "m3_camera_ring_abc",
      alias: "Front door: doorbell",
      description: "test",
      sources: cameraNotifySources(hass, cameras, true),
      targets,
      texts,
      cooldownMinutes: 5,
      snapshot: true,
      ...extra,
    });

  it("triggers on the event entities and on binary sensors turning on", () => {
    const a = build(["mobile_app_pixel"]);
    expect(a.triggers).toEqual([
      { trigger: "state", entity_id: ["event.front_door_ding", "event.front_door_package", "event.intercom_ding"], id: "event" },
      { trigger: "state", entity_id: ["binary_sensor.front_door_person", "binary_sensor.garden_person"], to: "on", id: "binary" },
    ]);
    expect(a.mode).toBe("queued");
  });

  it("ignores restarts and an integration coming back, and holds detections for the cooldown", () => {
    const [restart, cooldown] = build(["mobile_app_pixel"]).conditions as { value_template: string }[];
    expect(restart.value_template).toContain("trigger.from_state is not none");
    expect(restart.value_template).toContain("trigger.from_state.state != 'unavailable'");
    expect(cooldown.value_template).toContain("== 'ring' or this.attributes.last_triggered is none");
    expect(cooldown.value_template).toContain("> 300");
  });

  it("words the message per kind and attaches the camera's picture for the companion app only", () => {
    const [phone, persistent] = build(["mobile_app_pixel", "persistent_notification"]).actions as {
      action: string;
      data: { title: string; message: string; data?: { image: string } };
    }[];
    expect(phone.action).toBe("notify.mobile_app_pixel");
    expect(phone.data.title).toMatch(/\{\{ src\[0\] \}\}$/);
    expect(phone.data.message).toContain("{% if src[2] == 'ring' %}Someone is at the {{ src[0] }}");
    expect(phone.data.message).toContain("Parcel at the {{ src[0] }}");
    expect(phone.data.data?.image).toContain("'/api/camera_proxy/' ~ src[1]");
    expect(persistent.data.data).toBeUndefined();
  });

  it("leaves the picture out when asked to", () => {
    const [phone] = build(["mobile_app_pixel"], { snapshot: false }).actions as { data: { data?: unknown } }[];
    expect(phone.data.data).toBeUndefined();
  });

  it("fills the placeholders of a message of your own", () => {
    const [phone] = build(["mobile_app_pixel"], { customMessage: "{ereignis}: {kamera}" }).actions as { data: { message: string } }[];
    expect(phone.data.message).toContain("{{ src[3] }}: {{ src[0] }}");
    expect(phone.data.message).toContain('"event.front_door_ding": ["Front door", "camera.front_door", "ring", "Doorbell"]'.replace(/: \[/, ":[").replace(/, /g, ","));
  });
});
