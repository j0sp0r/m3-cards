import { describe, it, expect } from "vitest";
import {
  prettifyOption,
  prettifyState,
  remainingMinutes,
  resolveSliderRange,
  snapToRange,
  splitDuration,
  visibleOptions,
  waveBarGeometry,
  waveSliderGeometry,
} from "./appliance";

describe("resolveSliderRange", () => {
  it("reads the entity's own min/max/step", () => {
    expect(resolveSliderRange({ min: 50, max: 250, step: 5 })).toEqual({
      min: 50,
      max: 250,
      step: 5,
    });
  });

  it("lets the config override each field on its own", () => {
    expect(resolveSliderRange({ min: 0, max: 100, step: 1 }, { max: 60 })).toEqual({
      min: 0,
      max: 60,
      step: 1,
    });
  });

  it("falls back when the entity reports nothing", () => {
    expect(resolveSliderRange(undefined)).toEqual({ min: 0, max: 100, step: 1 });
    expect(resolveSliderRange({})).toEqual({ min: 0, max: 100, step: 1 });
  });

  it("falls back on a degenerate range rather than drawing an unusable slider", () => {
    expect(resolveSliderRange({ min: 100, max: 20, step: 2 })).toEqual({
      min: 0,
      max: 100,
      step: 2,
    });
  });

  it("ignores a zero or negative step", () => {
    expect(resolveSliderRange({ min: 0, max: 10, step: 0 }).step).toBe(1);
  });
});

describe("snapToRange", () => {
  const range = { min: 50, max: 250, step: 5 };

  it("snaps onto the grid and clamps to the ends", () => {
    expect(snapToRange(123, range)).toBe(125);
    expect(snapToRange(10, range)).toBe(50);
    expect(snapToRange(999, range)).toBe(250);
  });

  it("keeps a fractional step clean", () => {
    expect(snapToRange(21.3, { min: 16, max: 30, step: 0.5 })).toBe(21.5);
  });

  it("respects a min that is not a multiple of the step", () => {
    expect(snapToRange(4, { min: 1, max: 10, step: 2 })).toBe(5);
  });
});

describe("remainingMinutes", () => {
  const now = Date.parse("2026-09-05T10:00:00Z");

  it("reads whole minutes", () => {
    expect(remainingMinutes("84", { unit_of_measurement: "min" }, now)).toBe(84);
    expect(remainingMinutes("84", undefined, now)).toBe(84);
  });

  it("converts seconds and hours", () => {
    expect(remainingMinutes("5040", { unit_of_measurement: "s" }, now)).toBe(84);
    expect(remainingMinutes("1.5", { unit_of_measurement: "h" }, now)).toBe(90);
  });

  it("reads a clock-style duration, two fields meaning h:mm", () => {
    expect(remainingMinutes("1:24:00", undefined, now)).toBe(84);
    expect(remainingMinutes("01:24", undefined, now)).toBe(84);
    expect(remainingMinutes("0:00:30", undefined, now)).toBe(0.5);
  });

  it("reads an absolute completion timestamp against the given clock", () => {
    expect(remainingMinutes("2026-09-05T11:24:00Z", { device_class: "timestamp" }, now)).toBe(84);
    // Undeclared device_class, which is what a template sensor usually has.
    expect(remainingMinutes("2026-09-05T11:24:00Z", undefined, now)).toBe(84);
  });

  it("never goes negative for a time that has already passed", () => {
    expect(remainingMinutes("2026-09-05T09:00:00Z", undefined, now)).toBe(0);
    expect(remainingMinutes("-5", undefined, now)).toBe(0);
  });

  it("gives up on anything it cannot read", () => {
    expect(remainingMinutes(undefined, undefined, now)).toBeUndefined();
    expect(remainingMinutes("", undefined, now)).toBeUndefined();
    expect(remainingMinutes("unavailable", undefined, now)).toBeUndefined();
    expect(remainingMinutes("soon", undefined, now)).toBeUndefined();
  });
});

describe("splitDuration", () => {
  it("splits into whole hours and minutes", () => {
    expect(splitDuration(84)).toEqual({ hours: 1, minutes: 24 });
    expect(splitDuration(24)).toEqual({ hours: 0, minutes: 24 });
    expect(splitDuration(120)).toEqual({ hours: 2, minutes: 0 });
  });

  it("rounds rather than truncating, and never goes negative", () => {
    expect(splitDuration(59.6)).toEqual({ hours: 1, minutes: 0 });
    expect(splitDuration(-3)).toEqual({ hours: 0, minutes: 0 });
  });
});

describe("prettifyOption", () => {
  it("turns an integration's option string into a label", () => {
    expect(prettifyOption("heavy_duty")).toBe("Heavy duty");
    expect(prettifyOption("Mixed-Load")).toBe("Mixed Load");
    expect(prettifyOption("  spin  1400 ")).toBe("Spin 1400");
    expect(prettifyOption("")).toBe("");
  });
});

describe("visibleOptions", () => {
  it("passes the entity's own options through when nothing is restricted", () => {
    expect(visibleOptions(["a", "b"], undefined)).toEqual(["a", "b"]);
    expect(visibleOptions(["a", "b"], [])).toEqual(["a", "b"]);
  });

  it("narrows and reorders to the allow-list", () => {
    expect(visibleOptions(["a", "b", "c"], ["c", "a"])).toEqual(["c", "a"]);
  });

  it("drops an allow-listed option the entity does not offer", () => {
    expect(visibleOptions(["a"], ["a", "z"])).toEqual(["a"]);
  });

  it("copes with an entity that has no options attribute at all", () => {
    expect(visibleOptions(undefined, ["a"])).toEqual([]);
    expect(visibleOptions("not a list", undefined)).toEqual([]);
  });
});

describe("waveBarGeometry", () => {
  // 200px rail, 12px gap, 3.5px dot => 200 - 12 - 7 = 181px of splittable width.
  const geom = (pct: number) => waveBarGeometry(200, pct, 12, 3.5);

  it("splits the rail into wave, gap and track", () => {
    const g = geom(50);
    expect(g.activeWidth).toBeCloseTo(90.5);
    expect(g.trackStartX).toBeCloseTo(102.5);
    expect(g.trackEndX).toBeCloseTo(196.5);
  });

  it("draws no wave at all below a pixel, rather than a stub", () => {
    const g = geom(0);
    expect(g.activeWidth).toBe(0);
    // With nothing done, the track starts at the very left — no leading gap.
    expect(g.trackStartX).toBe(0);
  });

  it("keeps the end dot inside the rail at 100%", () => {
    const g = geom(100);
    expect(g.trackEndX).toBeCloseTo(196.5);
    expect(g.activeWidth).toBeLessThanOrEqual(g.trackEndX);
  });

  it("clamps a percentage outside 0-100 instead of overflowing the rail", () => {
    expect(geom(140).activeWidth).toBeCloseTo(geom(100).activeWidth);
    expect(geom(-20).activeWidth).toBe(0);
  });

  it("does not produce negative geometry on a rail narrower than its own dot", () => {
    const g = waveBarGeometry(2, 50, 12, 3.5);
    expect(g.activeWidth).toBe(0);
    expect(g.trackEndX).toBeGreaterThanOrEqual(0);
  });
});

describe("waveSliderGeometry", () => {
  // 200px rail, 20px handle, 12px gap.
  const geom = (fraction: number) => waveSliderGeometry(200, fraction, 20, 12);

  it("insets the handle by half its width at each end, so it never overhangs", () => {
    expect(geom(0).handleX).toBe(10);
    expect(geom(1).handleX).toBe(190);
  });

  it("leaves half the gap on each side of the handle", () => {
    const g = geom(0.5);
    expect(g.handleX).toBe(100);
    expect(g.activeEnd).toBe(100 - 6 - 10);
    expect(g.trackStart).toBe(100 + 6 + 10);
  });

  it("never returns a negative wave length at the low end", () => {
    expect(geom(0).activeEnd).toBe(0);
  });

  it("never runs the track past the rail at the high end", () => {
    expect(geom(1).trackStart).toBeLessThanOrEqual(200);
  });

  it("clamps a fraction outside 0-1", () => {
    expect(geom(2).handleX).toBe(geom(1).handleX);
    expect(geom(-1).handleX).toBe(geom(0).handleX);
  });
});

describe("prettifyState", () => {
  it("prettifies a slug-shaped state, like the option strings it borrows from", () => {
    expect(prettifyState("heavy_duty")).toBe("Heavy duty");
    expect(prettifyState("run")).toBe("Run");
    expect(prettifyState("delayed-start")).toBe("Delayed start");
  });

  it("leaves a template sensor's free-form text exactly as written", () => {
    // The bug this guards: `-` read as a word separator turned a freezer at
    // -16 °C into one at 16 °C.
    expect(prettifyState("8 °C · -16 °C")).toBe("8 °C · -16 °C");
    expect(prettifyState("In funzione · 181 °C")).toBe("In funzione · 181 °C");
  });

  it("does not swallow a hyphen inside real words", () => {
    expect(prettifyState("Wi-Fi 6 connesso")).toBe("Wi-Fi 6 connesso");
  });

  it("leaves an already-capitalised single word alone rather than re-casing it", () => {
    expect(prettifyState("Pronta")).toBe("Pronta");
  });
});

describe("endTimeOf", () => {
  const now = Date.parse("2026-11-01T14:45:20Z");
  it("adds minutes left to now, to the minute", async () => {
    const { endTimeOf } = await import("./appliance");
    expect(endTimeOf("33", { unit_of_measurement: "min" }, now)).toBe(Date.parse("2026-11-01T15:18:00Z"));
  });
  it("takes a completion timestamp as it is", async () => {
    const { endTimeOf } = await import("./appliance");
    expect(endTimeOf("2026-11-01T15:18:00+00:00", { device_class: "timestamp" }, now)).toBe(
      Date.parse("2026-11-01T15:18:00Z"),
    );
  });
  it("has nothing to say without a reading", async () => {
    const { endTimeOf } = await import("./appliance");
    expect(endTimeOf("unknown", {}, now)).toBeUndefined();
  });
});

describe("sinceParts", () => {
  it("counts minutes below an hour and hours from there", async () => {
    const { sinceParts } = await import("./appliance");
    const t = Date.parse("2026-11-01T14:00:00Z");
    expect(sinceParts(t, t + 12 * 60000)).toEqual({ m: 12 });
    expect(sinceParts(t, t + 59 * 60000)).toEqual({ m: 59 });
    expect(sinceParts(t, t + 130 * 60000)).toEqual({ h: 2 });
  });
});
