// The camera card's configuration, normalised.
//
// Every camera comes out as a full CameraConfig: a plain "camera.x" is short
// for `{ camera: camera.x }`, and the card-wide actions, door and talk fill in
// for a camera that has none of its own. The card then only ever reads one
// shape.

import type { CameraConfig, M3CameraCardConfig } from "../types";

export function normalizeCameras(config: M3CameraCardConfig | undefined): CameraConfig[] {
  if (!config) return [];
  const raw: Array<string | CameraConfig> = [
    ...(config.cameras ?? []),
    ...(config.camera && !(config.cameras ?? []).length ? [config.camera] : []),
  ];
  const seen = new Set<string>();
  const out: CameraConfig[] = [];
  for (const item of raw) {
    const cam: CameraConfig | undefined =
      typeof item === "string" ? { camera: item } : item && typeof item.camera === "string" ? { ...item } : undefined;
    if (!cam || !cam.camera || seen.has(cam.camera)) continue;
    seen.add(cam.camera);
    cam.actions ??= config.actions;
    cam.door_action ??= config.door_action;
    cam.talk_action ??= config.talk_action;
    out.push(cam);
  }
  return out;
}

/** The camera shown first: `default_camera` when it is one of them, else the first. */
export function initialCamera(cameras: readonly CameraConfig[], preferred?: string): string | undefined {
  if (preferred && cameras.some((c) => c.camera === preferred)) return preferred;
  return cameras[0]?.camera;
}

/** Every entity a camera reads, for shouldUpdate and the history request. */
export function cameraEntities(cam: CameraConfig): string[] {
  return [
    cam.camera,
    cam.battery,
    ...eventEntities(cam),
    cam.door_action?.feedback_entity,
  ].filter((e): e is string => !!e);
}

/** The entities whose changes are events, with the role each plays. */
export function eventEntities(cam: CameraConfig): string[] {
  return [...new Set([cam.doorbell, cam.person, cam.package, cam.motion, ...(cam.events ?? [])].filter((e): e is string => !!e))];
}
