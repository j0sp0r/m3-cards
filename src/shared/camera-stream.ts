// When the camera card streams, and how.
//
// A live view costs a battery camera its charge and a phone its data, so it
// only runs on demand — "Watch live", a ring, motion if asked for — and stops
// by itself: after a spell without interaction, when the card leaves the
// screen, when the tab goes to the background, when another camera is picked.

import { CAMERA_IMAGE_RETRY_MS } from "../const";
import type { CameraLiveProvider } from "../types";

/** `CameraEntityFeature.STREAM` */
export const CAMERA_FEATURE_STREAM = 2;

export type LiveReason = "user" | "ring" | "motion";

/**
 * What the stage can show for a camera: "image" when it cannot stream (or is
 * told not to), else the provider asked for. A camera without the STREAM
 * feature has stills only, whatever the config says.
 */
export function liveMode(provider: CameraLiveProvider | undefined, supportedFeatures: number | undefined): CameraLiveProvider {
  if (provider === "image") return "image";
  if (((supportedFeatures ?? 0) & CAMERA_FEATURE_STREAM) === 0) return "image";
  return provider ?? "auto";
}

/** Something that may hold a picture: an element, its shadow root, a video or an image. */
interface PictureNode {
  tagName?: string;
  readyState?: number;
  videoWidth?: number;
  complete?: boolean;
  naturalWidth?: number;
  shadowRoot?: PictureNode | null;
  children?: ArrayLike<PictureNode>;
}

/**
 * Whether a live player shows a picture yet: a video with a frame, or an
 * image (MJPEG) that has loaded one, anywhere inside it, shadow roots
 * included. Until then the card keeps the still on top of it, so starting
 * live never flashes an empty stage.
 */
export function playerShowsPicture(node: PictureNode | null | undefined, depth = 0): boolean {
  if (!node || depth > 12) return false;
  const tag = node.tagName?.toLowerCase();
  if (tag === "video" && (node.readyState ?? 0) >= 2 && (node.videoWidth ?? 0) > 0) return true;
  if (tag === "img" && node.complete && (node.naturalWidth ?? 0) > 0) return true;
  if (node.shadowRoot && playerShowsPicture(node.shadowRoot, depth + 1)) return true;
  const kids = node.children;
  if (kids) for (let i = 0; i < kids.length; i++) if (playerShowsPicture(kids[i], depth + 1)) return true;
  return false;
}

/** The still image's URL with a cache-buster, so a refresh fetches a new frame. */
export function snapshotUrl(entityPicture: string | undefined, tick: number): string | undefined {
  if (!entityPicture) return undefined;
  // A picture carried inline has nothing to fetch again.
  if (entityPicture.startsWith("data:") || entityPicture.startsWith("blob:")) return entityPicture;
  const [path, query = ""] = entityPicture.split("?");
  const params = new URLSearchParams(query);
  params.set("_t", String(tick));
  return `${path}?${params.toString()}`;
}

/** How long to wait before trying a failed still again; undefined = stop trying until the next event. */
export function imageRetryDelay(failures: number): number | undefined {
  return failures >= 1 && failures <= CAMERA_IMAGE_RETRY_MS.length ? CAMERA_IMAGE_RETRY_MS[failures - 1] : undefined;
}

/**
 * Runs the live view's lifetime: started for a reason, stopped after
 * `idleMs` without a touch — except while a ring holds it, which ends when
 * the ring does — and paused while the card cannot be seen.
 */
export class LiveController {
  private _live = false;
  private _reason?: LiveReason;
  private _timer?: ReturnType<typeof setTimeout>;
  private _visible = true;

  constructor(
    private readonly _onChange: (live: boolean, reason?: LiveReason) => void,
    private _idleMs: number,
  ) {}

  get live(): boolean {
    return this._live;
  }
  get reason(): LiveReason | undefined {
    return this._reason;
  }

  setIdle(ms: number): void {
    this._idleMs = ms;
  }

  start(reason: LiveReason): void {
    if (!this._visible) return;
    // A ring outranks the others: it keeps the view until the ring ends.
    if (this._live && this._reason === "ring" && reason !== "ring") return;
    const changed = !this._live || this._reason !== reason;
    this._live = true;
    this._reason = reason;
    this._arm();
    if (changed) this._onChange(true, reason);
  }

  stop(): void {
    this._clear();
    if (!this._live) return;
    this._live = false;
    this._reason = undefined;
    this._onChange(false);
  }

  /** Any interaction with the view: starts the idle time again. */
  touch(): void {
    if (this._live) this._arm();
  }

  /** The card scrolled away or the tab went to the background: stop, do not resume by itself. */
  setVisible(visible: boolean): void {
    this._visible = visible;
    if (!visible) this.stop();
  }

  dispose(): void {
    this._clear();
  }

  private _arm(): void {
    this._clear();
    if (this._reason === "ring" || this._idleMs <= 0) return;
    this._timer = setTimeout(() => this.stop(), this._idleMs);
  }

  private _clear(): void {
    if (this._timer !== undefined) clearTimeout(this._timer);
    this._timer = undefined;
  }
}
