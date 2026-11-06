import { describe, expect, it } from "vitest";
import {
  appendLive,
  axisLabels,
  bucketCount,
  curveRuns,
  graphScale,
  mean,
  median,
  normalizeTempEntries,
  resolveFocus,
  resolveRanges,
  smoothCurve,
  statRowsToSteps,
  stepExtremes,
  stepMeans,
  warmestIndex,
} from "./temperature-graph";

const H = 3_600_000;

describe("entries, ranges, focus", () => {
  it("takes bare ids and objects, and drops empty rows", () => {
    expect(normalizeTempEntries(["sensor.a", { entity: "sensor.b", name: "B" }, { entity: "" }])).toEqual([
      { entity: "sensor.a" },
      { entity: "sensor.b", name: "B" },
    ]);
  });

  it("keeps known ranges in order and falls back to the default", () => {
    expect(resolveRanges(["7d", "bogus", "24h", "7d"], ["24h", "7d"])).toEqual({ ranges: ["7d", "24h"], initial: "7d" });
    expect(resolveRanges(undefined, ["24h", "7d"], "7d")).toEqual({ ranges: ["24h", "7d"], initial: "7d" });
    expect(resolveRanges(["24h"], ["24h", "7d"], "7d").initial).toBe("24h");
  });

  it("finds the focus by index or entity id", () => {
    const entries = [{ entity: "sensor.a" }, { entity: "sensor.b" }, { entity: "sensor.c" }];
    expect(resolveFocus(2, entries)).toBe(2);
    expect(resolveFocus("sensor.b", entries)).toBe(1);
    expect(resolveFocus("1", entries)).toBe(1);
    expect(resolveFocus(9, entries)).toBe(0);
    expect(resolveFocus("sensor.x", entries)).toBe(0);
  });
});

describe("stepMeans", () => {
  it("weights each reading by how long it held", () => {
    // 20° for the first half hour, 22° for the second: one bucket of an hour.
    const steps = [
      { t: 0, v: 20 },
      { t: H / 2, v: 22 },
    ];
    expect(stepMeans(steps, 0, H, 1)).toEqual([21]);
    expect(stepMeans(steps, 0, H, 2)).toEqual([20, 22]);
  });

  it("leaves a hole where the sensor read nothing numeric", () => {
    const steps = [
      { t: 0, v: 20 },
      { t: H, v: null },
      { t: 2 * H, v: 21 },
    ];
    expect(stepMeans(steps, 0, 3 * H, 3)).toEqual([20, null, 21]);
  });

  it("averages only the numeric part of a partly missing bucket", () => {
    const steps = [
      { t: 0, v: 20 },
      { t: H / 2, v: null },
    ];
    expect(stepMeans(steps, 0, H, 1)).toEqual([20]);
  });

  it("is empty before the first reading", () => {
    expect(stepMeans([{ t: 2 * H, v: 19 }], 0, 4 * H, 4)).toEqual([null, null, 19, 19]);
  });

  it("holds the last reading to the end of the window", () => {
    expect(stepMeans([{ t: -5 * H, v: 18 }], 0, 2 * H, 2)).toEqual([18, 18]);
  });
});

describe("statRowsToSteps", () => {
  it("holds each mean for its hour and breaks at a missing one", () => {
    const steps = statRowsToSteps(
      [
        { start: 0, mean: 20 },
        { start: H, mean: 21 },
        { start: 3 * H, mean: 22 },
      ],
      H,
    );
    expect(stepMeans(steps, 0, 4 * H, 4)).toEqual([20, 21, null, 22]);
  });

  it("reads ISO start times", () => {
    const steps = statRowsToSteps([{ start: new Date(0).toISOString(), mean: 20 }], H);
    expect(steps[0]).toEqual({ t: 0, v: 20 });
  });
});

describe("live readings and extremes", () => {
  it("adds a new reading and ignores a repeat", () => {
    const steps = [{ t: 0, v: 20 }];
    expect(appendLive(steps, 10, 20)).toBe(steps);
    expect(appendLive(steps, 10, 21)).toEqual([...steps, { t: 10, v: 21 }]);
    expect(appendLive(steps, 10, null)).toEqual([...steps, { t: 10, v: null }]);
  });

  it("counts a reading that was still holding when the window opened", () => {
    const steps = [
      { t: -H, v: 15 },
      { t: H, v: 20 },
      { t: 2 * H, v: 22 },
    ];
    expect(stepExtremes(steps, 0)).toEqual({ min: 15, max: 22 });
    expect(stepExtremes(steps, 1.5 * H)).toEqual({ min: 20, max: 22 });
  });
});

describe("summary figures", () => {
  it("mean, median, warmest", () => {
    expect(mean([20, 22, 24])).toBe(22);
    expect(median([24, 20, 22, 30])).toBe(23);
    expect(median([])).toBeUndefined();
    // A tie goes to the first in the list.
    expect(warmestIndex([21.9, 23.6, 23.6, null])).toBe(1);
    expect(warmestIndex([null, null])).toBe(-1);
  });
});

describe("drawing", () => {
  it("spends about one point per 4px", () => {
    expect(bucketCount(400, 4, 24, 240)).toBe(100);
    expect(bucketCount(40, 4, 24, 240)).toBe(24);
    expect(bucketCount(4000, 4, 24, 240)).toBe(240);
  });

  it("puts the highest value at the top pad and the lowest at the bottom", () => {
    const s = graphScale([[18, 20, null], [24]], 130, 10)!;
    expect(s.lo).toBe(18);
    expect(s.hi).toBe(24);
    expect(s.y(24)).toBe(10);
    expect(s.y(18)).toBe(120);
  });

  it("draws a flat line through the middle", () => {
    const s = graphScale([[20, 20]], 100, 10)!;
    expect(s.y(20)).toBe(50);
  });

  it("splits a curve at its holes", () => {
    const runs = curveRuns([1, 2, null, 3], (i) => i, (v) => v);
    expect(runs).toEqual([
      [
        { x: 0, y: 1 },
        { x: 1, y: 2 },
      ],
      [{ x: 3, y: 3 }],
    ]);
  });
});

describe("axisLabels", () => {
  it("labels a day on a six-hour clock grid and ends with now", () => {
    const t1 = new Date(2026, 10, 5, 23, 30).getTime();
    const labels = axisLabels("24h", t1 - 24 * H, t1, "de", "jetzt");
    expect(labels.map((l) => l.label)).toEqual(["0 Uhr", "6", "12", "18", "jetzt"]);
    expect(labels[labels.length - 1]).toMatchObject({ at: 1, align: "end" });
  });

  it("keeps AM/PM on every label of a 12-hour clock", () => {
    const t1 = new Date(2026, 10, 5, 23, 30).getTime();
    const labels = axisLabels("24h", t1 - 24 * H, t1, "en-US", "now");
    expect(labels.slice(0, -1).every((l) => /AM|PM/.test(l.label))).toBe(true);
  });

  it("labels a week with weekdays", () => {
    const t1 = new Date(2026, 10, 5, 12, 0).getTime();
    const labels = axisLabels("7d", t1 - 7 * 24 * H, t1, "de", "jetzt");
    const days = labels.slice(0, -1).map((l) => l.label);
    expect(days.length).toBeGreaterThanOrEqual(5);
    expect(days.every((d) => !d.endsWith("."))).toBe(true);
  });
});

describe("smoothCurve", () => {
  it("rounds off a step and keeps the level either side", () => {
    const out = smoothCurve([20, 20, 20, 21, 21, 21], 1);
    expect(out[0]).toBe(20);
    expect(out[5]).toBe(21);
    expect(out[2]).toBeGreaterThan(20);
    expect(out[3]).toBeLessThan(21);
  });

  it("never averages across a hole", () => {
    expect(smoothCurve([20, 20, null, 30, 30], 2)).toEqual([20, 20, null, 30, 30]);
  });
});
