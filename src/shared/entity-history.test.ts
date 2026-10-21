import { describe, expect, it, vi } from "vitest";
import {
  downsample,
  fetchEntitySeries,
  historyToPoints,
  seriesExtremes,
  seriesStats,
  bucketExtremes,
  statisticsToPoints,
  type SeriesPoint,
} from "./entity-history";
import type { HomeAssistant } from "../types";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);

function hassWith(attrs: Record<string, unknown>, state: string, callWS: (msg: Record<string, unknown>) => unknown) {
  return {
    states: { "sensor.h": { entity_id: "sensor.h", state, attributes: attrs, last_changed: "", last_updated: "" } },
    callWS: vi.fn(async (msg: Record<string, unknown>) => callWS(msg)),
  } as unknown as HomeAssistant & { callWS: ReturnType<typeof vi.fn> };
}

describe("historyToPoints", () => {
  it("turns non-numeric states into holes and pulls the opening row to the window start", () => {
    const start = NOW - HOUR;
    const pts = historyToPoints(
      [
        { s: "40", lu: (start - 5 * HOUR) / 1000 },
        { s: "unavailable", lu: (start + 600_000) / 1000 },
        { s: "42.5", lu: (start + 1_200_000) / 1000 },
      ],
      start,
    );
    expect(pts).toEqual([
      { t: start, v: 40 },
      { t: start + 600_000, v: null },
      { t: start + 1_200_000, v: 42.5 },
    ]);
  });
});

describe("statisticsToPoints", () => {
  it("reads mean, falls back to state, and breaks the line over missing buckets", () => {
    const step = 300_000;
    const t0 = NOW - 10 * step;
    const pts = statisticsToPoints(
      [
        { start: t0, mean: 1 },
        { start: t0 + step, mean: 2 },
        // three buckets missing
        { start: t0 + 5 * step, mean: null, state: 7 },
      ],
      step,
    );
    expect(pts.map((p) => p.v)).toEqual([1, 2, null, 7]);
    expect(pts[0].t).toBe(t0 + step / 2);
  });
});

describe("downsample", () => {
  it("keeps holes, keeps the spike, and stays within budget", () => {
    const pts: SeriesPoint[] = [];
    for (let i = 0; i < 1000; i++) pts.push({ t: i, v: i === 400 ? 999 : Math.sin(i / 50) });
    pts.splice(700, 0, { t: 699.5, v: null });
    const out = downsample(pts, 100);
    expect(out.length).toBeLessThanOrEqual(102);
    expect(out.some((p) => p.v === null)).toBe(true);
    expect(out.some((p) => p.v === 999)).toBe(true);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
  });
});

describe("seriesExtremes", () => {
  it("ignores holes", () => {
    const e = seriesExtremes([
      { t: 0, v: null },
      { t: 1, v: 5 },
      { t: 2, v: 2 },
      { t: 3, v: 9 },
    ]);
    expect(e.first?.v).toBe(5);
    expect(e.min?.v).toBe(2);
    expect(e.max?.v).toBe(9);
  });
});

describe("fetchEntitySeries", () => {
  it("does not ask for statistics when the sensor has no state_class", async () => {
    const hass = hassWith({}, "55", (msg) =>
      msg.type === "history/history_during_period"
        ? { "sensor.h": [{ s: "50", lu: (NOW - 2 * HOUR) / 1000 }] }
        : {},
    );
    const series = await fetchEntitySeries(hass, "sensor.h", "24h", NOW);
    expect(series.source).toBe("history");
    expect(hass.callWS.mock.calls.map((c) => (c[0] as { type: string }).type)).toEqual([
      "history/history_during_period",
    ]);
    // Ends on the live value, at now.
    expect(series.points[series.points.length - 1]).toEqual({ t: NOW, v: 55 });
  });

  it("falls back to history when statistics come back empty", async () => {
    const hass = hassWith({ state_class: "measurement" }, "55", (msg) =>
      msg.type === "history/history_during_period"
        ? { "sensor.h": [{ s: "50", lu: (NOW - 2 * HOUR) / 1000 }] }
        : { "sensor.h": [] },
    );
    const series = await fetchEntitySeries(hass, "sensor.h", "7d", NOW + 1);
    expect(series.source).toBe("history");
  });

  it("uses statistics when they are there", async () => {
    const hass = hassWith({ state_class: "measurement" }, "55", () => ({
      "sensor.h": [
        { start: NOW - 3 * HOUR, mean: 50 },
        { start: NOW - 2 * HOUR, mean: 52 },
      ],
    }));
    // A different hour, so the previous test's cached empty answer is not reused.
    const series = await fetchEntitySeries(hass, "sensor.h", "7d", NOW + 5 * HOUR);
    expect(series.source).toBe("statistics");
  });

  it("reports none when nothing at all was recorded", async () => {
    const hass = hassWith({}, "unavailable", () => ({}));
    const series = await fetchEntitySeries(hass, "sensor.h", "1h", NOW);
    expect(series).toEqual({ points: [], source: "none", range: "1h" });
  });
});

describe("seriesStats", () => {
  it("weights the mean by how long each value held, and skips holes", () => {
    const stats = seriesStats(
      [
        { t: 0, v: 20 },
        { t: 11, v: 25 },
        { t: 11.5, v: 26 },
        { t: 12, v: null },
        { t: 13, v: 20 },
      ],
      0,
      14,
    );
    // 20·11 + 25·0.5 + 26·0.5 + 20·1 over 13 held hours.
    expect(stats?.mean).toBeCloseTo((220 + 12.5 + 13 + 20) / 13, 6);
    expect(stats?.min).toBe(20);
    expect(stats?.max).toBe(26);
  });

  it("counts a value held into the window from before it", () => {
    const stats = seriesStats([{ t: -5, v: 7 }], 0, 10);
    expect(stats).toEqual({ min: 7, max: 7, mean: 7 });
  });

  it("has nothing to say about an empty series", () => {
    expect(seriesStats([{ t: 1, v: null }], 0, 10)).toBeUndefined();
  });
});

describe("fetchEntitySeries sum", () => {
  const rowsAt = (t: number, states: number[]) =>
    states.map((state, i) => ({ start: t - (states.length - i) * HOUR, state }));

  it("counts a meter's rises and ignores a fall, as a reset", async () => {
    const t = NOW + 9 * HOUR;
    const hass = hassWith({ state_class: "total_increasing" }, "4", () => ({
      // 100 → 104, reset to 0, → 3: seven units, whatever `sum` says.
      "sensor.h": rowsAt(t, [100, 102, 104, 0, 1, 3]),
    }));
    const series = await fetchEntitySeries(hass, "sensor.h", "7d", t);
    expect(series.sum).toBe(7);
  });

  it("takes last minus first for a total, which may fall", async () => {
    const t = NOW + 10 * HOUR;
    const hass = hassWith({ state_class: "total" }, "4", () => ({
      "sensor.h": rowsAt(t, [10, 14, 6]),
    }));
    const series = await fetchEntitySeries(hass, "sensor.h", "7d", t);
    expect(series.sum).toBe(-4);
  });

  it("has no sum for a measurement", async () => {
    const t = NOW + 11 * HOUR;
    const hass = hassWith({ state_class: "measurement" }, "4", () => ({
      "sensor.h": rowsAt(t, [1, 2]).map((r) => ({ ...r, mean: r.state })),
    }));
    const series = await fetchEntitySeries(hass, "sensor.h", "7d", t);
    expect(series.sum).toBeUndefined();
  });
});

describe("bucketExtremes", () => {
  it("takes the buckets' own min and max, not the extremes of their means", () => {
    const rows = [
      { start: 0, mean: 150, min: 140, max: 160 },
      { start: 1000, mean: 2946, min: 150, max: 14350 },
      { start: 2000, mean: 300, min: -232, max: 900 },
      { start: -5, mean: 1, min: -9999, max: 99999 },
    ];
    expect(bucketExtremes(rows, 0)).toEqual({ min: -232, max: 14350 });
  });

  it("has nothing for a meter, whose buckets carry neither", () => {
    expect(bucketExtremes([{ start: 0, state: 5 }], 0)).toBeUndefined();
  });
});
