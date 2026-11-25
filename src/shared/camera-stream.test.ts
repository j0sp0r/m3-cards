import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveController, imageRetryDelay, liveMode, snapshotUrl } from "./camera-stream";

describe("liveMode", () => {
  it("falls back to stills without the stream feature or when told", () => {
    expect(liveMode("auto", 0)).toBe("image");
    expect(liveMode("webrtc", 2)).toBe("webrtc");
    expect(liveMode(undefined, 2)).toBe("auto");
    expect(liveMode("image", 2)).toBe("image");
  });
});

describe("snapshotUrl / imageRetryDelay", () => {
  it("adds a cache-buster and keeps the token", () => {
    expect(snapshotUrl("/api/camera_proxy/camera.x?token=abc", 5)).toBe("/api/camera_proxy/camera.x?token=abc&_t=5");
    expect(snapshotUrl("/api/camera_proxy/camera.x?token=abc&_t=4", 5)).toBe("/api/camera_proxy/camera.x?token=abc&_t=5");
    expect(snapshotUrl(undefined, 1)).toBeUndefined();
    expect(snapshotUrl("data:image/svg+xml,%3Csvg%3E", 3)).toBe("data:image/svg+xml,%3Csvg%3E");
  });
  it("backs off and then gives up", () => {
    expect([1, 2, 3, 4].map(imageRetryDelay)).toEqual([10_000, 30_000, 60_000, undefined]);
  });
});

describe("LiveController", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stops after the idle time, and a touch starts it again", () => {
    const changes: boolean[] = [];
    const c = new LiveController((live) => changes.push(live), 60_000);
    c.start("user");
    vi.advanceTimersByTime(50_000);
    c.touch();
    vi.advanceTimersByTime(50_000);
    expect(c.live).toBe(true);
    vi.advanceTimersByTime(11_000);
    expect(c.live).toBe(false);
    expect(changes).toEqual([true, false]);
  });
  it("keeps a ring's view until stopped, and motion cannot take it over", () => {
    const c = new LiveController(() => undefined, 1000);
    c.start("ring");
    c.start("motion");
    vi.advanceTimersByTime(10_000);
    expect(c.live).toBe(true);
    expect(c.reason).toBe("ring");
    c.stop();
    expect(c.live).toBe(false);
  });
  it("stops when the card is hidden and does not start while hidden", () => {
    const c = new LiveController(() => undefined, 1000);
    c.start("user");
    c.setVisible(false);
    expect(c.live).toBe(false);
    c.start("user");
    expect(c.live).toBe(false);
    c.setVisible(true);
    c.start("user");
    expect(c.live).toBe(true);
  });
});
