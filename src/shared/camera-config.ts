// The camera card's configuration, normalised.
//
// Every camera comes out as a full CameraConfig: a plain "camera.x" is short
// for `{ camera: camera.x }`, and the card-wide actions, door and talk fill in
// for a camera that has none of its own. The card then only ever reads one
// shape.

import type { CameraConfig, M3CameraCardConfig } from "../types";

/**
 * A camera as the card works with it: the config plus `id`, which names it in
 * chips and caches — the camera entity, or the doorbell for one without a
 * camera (an intercom).
 */
export type CameraEntry = CameraConfig & { id: string };

export function normalizeCameras(config: M3CameraCardConfig | undefined): CameraEntry[] {
  if (!config) return [];
  const raw: Array<string | CameraConfig> = [
    ...(config.cameras ?? []),
    ...(config.camera && !(config.cameras ?? []).length ? [config.camera] : []),
  ];
  const seen = new Set<string>();
  const out: CameraEntry[] = [];
  for (const item of raw) {
    const base: CameraConfig | undefined = typeof item === "string" ? { camera: item } : item ? { ...item } : undefined;
    const id = base?.camera || base?.doorbell;
    if (!base || !id || seen.has(id)) continue;
    seen.add(id);
    const cam: CameraEntry = { ...base, id };
    cam.actions ??= config.actions;
    cam.door_action ??= config.door_action;
    cam.talk_action ??= config.talk_action;
    out.push(cam);
  }
  return out;
}

/** The camera shown first: `default_camera` when it is one of them, else the first. */
export function initialCamera(cameras: readonly CameraEntry[], preferred?: string): string | undefined {
  if (preferred && cameras.some((c) => c.id === preferred)) return preferred;
  return cameras[0]?.id;
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
