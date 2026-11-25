import { describe, expect, it } from "vitest";
import { cameraEntities, initialCamera, normalizeCameras } from "./camera-config";

describe("normalizeCameras", () => {
  it("takes the short forms", () => {
    expect(normalizeCameras({ type: "x", camera: "camera.door" })).toEqual([{ camera: "camera.door" }]);
    expect(normalizeCameras({ type: "x", cameras: ["camera.a", { camera: "camera.b", name: "B" }] }).map((c) => c.camera)).toEqual([
      "camera.a",
      "camera.b",
    ]);
  });
  it("drops repeats and entries without a camera", () => {
    const out = normalizeCameras({ type: "x", cameras: ["camera.a", "camera.a", { name: "x" } as never] });
    expect(out.map((c) => c.camera)).toEqual(["camera.a"]);
  });
  it("fills in the card-wide door and actions, but keeps a camera's own", () => {
    const door = { tap_action: { action: "none" as const } };
    const own = { tap_action: { action: "toggle" as const } };
    const out = normalizeCameras({ type: "x", door_action: door, cameras: ["camera.a", { camera: "camera.b", door_action: own }] });
    expect(out[0].door_action).toBe(door);
    expect(out[1].door_action).toBe(own);
  });
});

describe("initialCamera / cameraEntities", () => {
  const cams = normalizeCameras({ type: "x", cameras: ["camera.a", { camera: "camera.b", doorbell: "event.ding", battery: "sensor.bat" }] });
  it("prefers default_camera when it is configured", () => {
    expect(initialCamera(cams, "camera.b")).toBe("camera.b");
    expect(initialCamera(cams, "camera.zzz")).toBe("camera.a");
    expect(initialCamera([], undefined)).toBeUndefined();
  });
  it("lists what a camera reads", () => {
    expect(cameraEntities(cams[1])).toEqual(["camera.b", "sensor.bat", "event.ding"]);
  });
});
