import { describe, expect, it } from "vitest";
import {
  bucketOf,
  bucketsOf,
  getSharedPeriod,
  haEnergyCollection,
  isFuture,
  kindFromRange,
  periodFor,
  periodLabel,
  setSharedPeriod,
  shiftPeriod,
  subscribeSharedPeriod,
} from "./energy-period";

const NOW = new Date(2026, 10, 16, 20, 30); // Monday 16 Nov 2026
const words = { today: "Heute", yesterday: "Gestern" };

describe("energy periods", () => {
  it("starts weeks on Monday and months on the first", () => {
    expect(periodFor("week", NOW).start).toEqual(new Date(2026, 10, 16));
    expect(periodFor("week", new Date(2026, 10, 15)).start).toEqual(new Date(2026, 10, 9));
    expect(periodFor("month", NOW).start).toEqual(new Date(2026, 10, 1));
    expect(periodFor("month", NOW).end).toEqual(new Date(2026, 11, 1));
  });

  it("steps back and forward and knows the future", () => {
    const m = periodFor("month", NOW);
    expect(shiftPeriod(m, -1).start).toEqual(new Date(2026, 9, 1));
    expect(isFuture(shiftPeriod(m, 1), NOW)).toBe(true);
    expect(isFuture(m, NOW)).toBe(false);
  });

  it("buckets by hour, day and month", () => {
    expect(bucketOf("day")).toBe("hour");
    expect(bucketsOf(periodFor("day", NOW))).toHaveLength(24);
    expect(bucketsOf(periodFor("month", NOW))).toHaveLength(30);
    expect(bucketsOf(periodFor("year", NOW))).toHaveLength(12);
  });

  it("names the period", () => {
    expect(periodLabel(periodFor("day", NOW), "de", NOW, words)).toBe("Heute, 16. Nov.");
    expect(periodLabel(periodFor("week", new Date(2026, 10, 12)), "de", NOW, words)).toBe("9. – 15. Nov.");
    expect(periodLabel(periodFor("month", NOW), "de", NOW, words)).toBe("November 2026");
    expect(periodLabel(periodFor("year", NOW), "en", NOW, words)).toBe("2026");
  });

  it("shares one period per key", () => {
    const seen: string[] = [];
    const unsub = subscribeSharedPeriod("t", () => periodFor("day", NOW), (p) => seen.push(p.kind));
    setSharedPeriod("t", periodFor("week", NOW));
    expect(getSharedPeriod("t", () => periodFor("day", NOW)).kind).toBe("week");
    unsub();
    setSharedPeriod("t", periodFor("month", NOW));
    expect(seen).toEqual(["week"]);
  });

  it("finds a native energy collection only where one exists", () => {
    expect(haEnergyCollection({})).toBeUndefined();
    const c = { start: new Date() };
    expect(haEnergyCollection({ _energy: c })).toBe(c);
    expect(haEnergyCollection({ _energy_x: c }, "x")).toBe(c);
    expect(kindFromRange(new Date(2026, 10, 1), new Date(2026, 10, 30, 23, 59))).toBe("month");
  });
});
