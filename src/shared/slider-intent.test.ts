import { describe, it, expect, vi } from "vitest";
import { SliderIntent, sliderPointer, INTENT_SLOP_PX } from "./slider-intent";

const target = {};
function ev(type: "touch" | "mouse", x: number, y: number, pointerId = 1): PointerEvent {
  return { pointerType: type, clientX: x, clientY: y, pointerId, currentTarget: target } as unknown as PointerEvent;
}

describe("SliderIntent (#27)", () => {
  it("a mouse drags at once", () => {
    const i = new SliderIntent();
    expect(i.down(ev("mouse", 0, 0))).toBe(true);
    expect(i.move(ev("mouse", 1, 0))).toBe("drag");
    expect(i.up(ev("mouse", 1, 0))).toBe("drag");
  });

  it("a touch waits, then drags once it moves along the slider", () => {
    const i = new SliderIntent();
    expect(i.down(ev("touch", 0, 0))).toBe(false);
    expect(i.pending).toBe(true);
    expect(i.move(ev("touch", INTENT_SLOP_PX - 1, 0))).toBe("none");
    expect(i.move(ev("touch", INTENT_SLOP_PX + 2, 3))).toBe("start");
    expect(i.move(ev("touch", 30, 20))).toBe("drag");
    expect(i.up(ev("touch", 30, 20))).toBe("drag");
  });

  it("a touch that moves across the slider belongs to the page", () => {
    const i = new SliderIntent();
    i.down(ev("touch", 0, 0));
    expect(i.move(ev("touch", 3, INTENT_SLOP_PX + 2))).toBe("none");
    // Sideways later in the same gesture does not take it back.
    expect(i.move(ev("touch", 60, 12))).toBe("none");
    expect(i.dragging).toBe(false);
    expect(i.up(ev("touch", 60, 12))).toBe("none");
  });

  it("a touch that never moves is a tap", () => {
    const i = new SliderIntent();
    i.down(ev("touch", 5, 5));
    expect(i.up(ev("touch", 6, 5))).toBe("tap");
  });

  it("ignores a second finger", () => {
    const i = new SliderIntent();
    i.down(ev("touch", 0, 0, 1));
    expect(i.move(ev("touch", 40, 0, 2))).toBe("none");
    expect(i.up(ev("touch", 40, 0, 2))).toBe("none");
    expect(i.pending).toBe(true);
  });
});

describe("sliderPointer", () => {
  const handlers = () => ({ down: vi.fn(), move: vi.fn(), up: vi.fn() });

  it("a vertical swipe on a slider changes nothing, even when the browser cancels", () => {
    const h = handlers();
    const p = sliderPointer(h);
    p.down(ev("touch", 0, 0));
    p.move(ev("touch", 1, 20));
    p.move(ev("touch", 1, 80));
    p.cancel(ev("touch", 1, 80));
    expect(h.down).not.toHaveBeenCalled();
    expect(h.move).not.toHaveBeenCalled();
    expect(h.up).not.toHaveBeenCalled();
  });

  it("a horizontal drag starts with the event that decided it", () => {
    const h = handlers();
    const p = sliderPointer(h);
    p.down(ev("touch", 0, 0));
    const decided = ev("touch", 20, 2);
    p.move(decided);
    p.up(ev("touch", 40, 2));
    expect(h.down).toHaveBeenCalledWith(decided);
    expect(h.move).toHaveBeenCalledWith(decided);
    expect(h.up).toHaveBeenCalledOnce();
  });

  it("a tap sets the value on release", () => {
    const h = handlers();
    const p = sliderPointer(h);
    p.down(ev("touch", 10, 10));
    expect(h.down).not.toHaveBeenCalled();
    const release = ev("touch", 10, 10);
    p.up(release);
    expect(h.down).toHaveBeenCalledWith(release);
    expect(h.up).toHaveBeenCalledWith(release);
  });

  it("a mouse press goes straight through", () => {
    const h = handlers();
    const p = sliderPointer(h);
    const press = ev("mouse", 10, 10);
    p.down(press);
    expect(h.down).toHaveBeenCalledWith(press);
  });

  it("a cancelled drag still ends through up", () => {
    const h = handlers();
    const p = sliderPointer(h);
    p.down(ev("mouse", 0, 0));
    p.cancel(ev("mouse", 0, 0));
    expect(h.up).toHaveBeenCalledOnce();
  });
});
