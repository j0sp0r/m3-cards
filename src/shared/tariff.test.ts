import { describe, expect, it } from "vitest";
import { activeFromSchedule, savingsPercent, sharesOf, tariffFromState, tariffTones } from "./tariff";

const HPHC = [
  { name: "Heures pleines", short: "HP" },
  { name: "Heures creuses", short: "HC" },
];

describe("tariffFromState", () => {
  it("matches name, short name, part of the name or a 1-based index", () => {
    expect(tariffFromState("HC", HPHC)).toBe(1);
    expect(tariffFromState("heures pleines", HPHC)).toBe(0);
    expect(tariffFromState("creuses", HPHC)).toBe(1);
    expect(tariffFromState("2", HPHC)).toBe(1);
    expect(tariffFromState("unavailable", HPHC)).toBe(-1);
    expect(tariffFromState("nuit", HPHC)).toBe(-1);
  });
});

describe("activeFromSchedule", () => {
  const schedule = [
    { tariff: "HC", from: "22:00", to: "06:00" },
    { tariff: "HP", from: "06:00", to: "22:00" },
  ];
  const at = (h: number, m = 0) => new Date(2026, 10, 16, h, m);

  it("finds the window across midnight and when it ends", () => {
    const night = activeFromSchedule(schedule, HPHC, at(2, 30));
    expect(night.index).toBe(1);
    expect(night.until?.getHours()).toBe(6);
    expect(night.until?.getDate()).toBe(16);
    const late = activeFromSchedule(schedule, HPHC, at(23, 10));
    expect(late.index).toBe(1);
    expect(late.until?.getDate()).toBe(17);
    const day = activeFromSchedule(schedule, HPHC, at(14));
    expect(day.index).toBe(0);
    expect(day.until?.getHours()).toBe(22);
  });

  it("switches exactly at the boundary", () => {
    expect(activeFromSchedule(schedule, HPHC, at(6)).index).toBe(0);
    expect(activeFromSchedule(schedule, HPHC, at(5, 59)).index).toBe(1);
    expect(activeFromSchedule(schedule, HPHC, at(22)).index).toBe(1);
  });

  it("honours weekdays, for the day a window started on", () => {
    const weekend = [{ tariff: "HC", from: "00:00", to: "00:00", days: [0, 6] }, ...schedule];
    // Sunday 15 Nov 2026, midday: the all-day weekend window applies.
    expect(activeFromSchedule(weekend, HPHC, new Date(2026, 10, 15, 12)).index).toBe(1);
    // Monday 16 Nov midday: the weekday HP window.
    expect(activeFromSchedule(weekend, HPHC, at(12)).index).toBe(0);
  });
});

describe("prices and tones", () => {
  it("computes the saving against the dearest tariff", () => {
    expect(savingsPercent(0.1828, [0.2516, 0.1828])).toBe(27);
    expect(savingsPercent(0.2516, [0.2516, 0.1828])).toBeUndefined();
    expect(savingsPercent(undefined, [0.25])).toBeUndefined();
  });

  it("gives the dearest tariff the lightest tone", () => {
    const tones = tariffTones("#6ba7dc", [0.18, 0.25, 0.3]);
    expect(tones[2]).toContain("white");
    expect(tones[0]).toContain("black");
  });

  it("splits shares that add up to 100", () => {
    expect(sharesOf([7.8, 5.4])).toEqual([59, 41]);
    expect(sharesOf([1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(sharesOf([0, 0])).toEqual([0, 0]);
  });
});
