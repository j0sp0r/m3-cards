import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRAFT_STALE_MS, HOLD_DELAY_MS, HOLD_FAST_AFTER, HOLD_FAST_MS, HOLD_REPEAT_MS, SETPOINT_COMMIT_MS, SetpointDraft, parseTarget } from "./setpoint-draft";

const host = { addController: () => {}, removeController: () => {}, requestUpdate: () => {}, updateComplete: Promise.resolve(true) };

describe("SetpointDraft", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("steps from the draft, not from the lagging state, and sends once", () => {
    const d = new SetpointDraft(host, () => {}, () => Date.now());
    const sent: number[] = [];
    const step = () => {
      const v = (d.get("t", 20) ?? 20) + 0.5;
      d.set({ t: v }, () => sent.push(v));
    };
    step();
    step();
    step();
    expect(d.get("t", 20)).toBe(21.5);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(SETPOINT_COMMIT_MS);
    expect(sent).toEqual([21.5]);
  });

  it("keeps showing the sent value until Home Assistant reports it, or a while has passed", () => {
    let now = 1000;
    const d = new SetpointDraft(host, () => {}, () => now);
    d.set({ t: 22 }, () => {}, true);
    expect(d.get("t", 20)).toBe(22);
    expect(d.get("t", 22)).toBe(22);
    expect(d.get("t", 20)).toBe(20); // confirmed once, the draft is gone
    d.set({ t: 23 }, () => {}, true);
    now += DRAFT_STALE_MS + 1;
    expect(d.get("t", 20)).toBe(20);
  });

  it("repeats a held button, slowly first, then faster", () => {
    const d = new SetpointDraft(host, () => {});
    let steps = 0;
    const h = d.hold(() => steps++);
    h.down({ button: 0 } as PointerEvent);
    expect(steps).toBe(1);
    vi.advanceTimersByTime(HOLD_DELAY_MS - 1);
    expect(steps).toBe(1);
    vi.advanceTimersByTime(1);
    expect(steps).toBe(2);
    vi.advanceTimersByTime(HOLD_REPEAT_MS * (HOLD_FAST_AFTER - 1));
    expect(steps).toBe(1 + HOLD_FAST_AFTER);
    vi.advanceTimersByTime(HOLD_REPEAT_MS);
    const before = steps;
    vi.advanceTimersByTime(HOLD_FAST_MS * 3);
    expect(steps).toBe(before + 3);
    h.up();
    vi.advanceTimersByTime(2000);
    expect(steps).toBe(before + 3);
  });

  it("takes a pointer's click as part of the press and a keyboard's click as a step", () => {
    const d = new SetpointDraft(host, () => {});
    let steps = 0;
    const h = d.hold(() => steps++);
    h.down({ button: 0 } as PointerEvent);
    h.up();
    h.click({ detail: 1 } as MouseEvent);
    expect(steps).toBe(1);
    h.click({ detail: 0 } as MouseEvent);
    expect(steps).toBe(2);
  });

  it("sends what is pending when the card goes away", () => {
    const d = new SetpointDraft(host, () => {});
    const sent: number[] = [];
    d.set({ t: 19 }, () => sent.push(19));
    d.hostDisconnected();
    expect(sent).toEqual([19]);
  });
});

describe("parseTarget", () => {
  const limits = { step: 0.5, min: 7, max: 30 };
  it("reads a comma or a point and holds the value to the limits and the step", () => {
    expect(parseTarget("21,3", limits)).toBe(21.5);
    expect(parseTarget("21.2", limits)).toBe(21);
    expect(parseTarget("40", limits)).toBe(30);
    expect(parseTarget("3", limits)).toBe(7);
    expect(parseTarget("", limits)).toBeUndefined();
    expect(parseTarget("abc", limits)).toBeUndefined();
  });
});
