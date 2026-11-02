import { describe, expect, it } from "vitest";
import type { HassEntity } from "../types";
import {
  latestClosed,
  normalizeEntries,
  numericState,
  openingIcon,
  openingStatus,
  openingWarning,
  resolveEntries,
  sortOpen,
} from "./openings";

const st = (state: string) => ({ entity_id: "binary_sensor.x", state, attributes: {}, last_changed: "" }) as unknown as HassEntity;

describe("normalizeEntries", () => {
  it("takes the short form and the long form", () => {
    expect(normalizeEntries(["binary_sensor.a", { entity: "binary_sensor.b", name: "Bad" }])).toEqual([
      { entity: "binary_sensor.a" },
      { entity: "binary_sensor.b", name: "Bad" },
    ]);
  });

  it("drops entries without an entity", () => {
    expect(normalizeEntries([{ entity: "" }, "" as string])).toEqual([]);
    expect(normalizeEntries(undefined)).toEqual([]);
  });
});

describe("resolveEntries", () => {
  const configured = [{ entity: "binary_sensor.b", name: "Bad" }, { entity: "binary_sensor.z" }];

  it("uses the configured list without discovery", () => {
    expect(resolveEntries(configured, undefined)).toBe(configured);
  });

  it("lets configured entries only override discovered ones", () => {
    expect(resolveEntries(configured, ["binary_sensor.a", "binary_sensor.b"])).toEqual([
      { entity: "binary_sensor.a" },
      { entity: "binary_sensor.b", name: "Bad" },
    ]);
  });
});

describe("openingStatus", () => {
  it("never counts a missing sensor as closed", () => {
    expect(openingStatus(st("on"))).toBe("open");
    expect(openingStatus(st("off"))).toBe("closed");
    expect(openingStatus(st("unavailable"))).toBe("missing");
    expect(openingStatus(st("unknown"))).toBe("missing");
    expect(openingStatus(undefined)).toBe("missing");
  });
});

describe("openingIcon", () => {
  it("picks a door or a window by device class", () => {
    expect(openingIcon("door", true)).toBe("mdi:door-open");
    expect(openingIcon("window", false)).toBe("mdi:window-closed-variant");
    expect(openingIcon("garage_door", true)).toBe("mdi:garage-open-variant");
    expect(openingIcon(undefined, true)).toBe("mdi:window-open-variant");
  });
});

describe("openingWarning", () => {
  const base = { warnAfterMinutes: 15, coldBelow: 10 };

  it("needs both thresholds with an outdoor sensor", () => {
    expect(openingWarning({ ...base, openMinutes: 48, outdoor: 6, hasOutdoorSensor: true })).toEqual({ highlight: true, pill: true });
    expect(openingWarning({ ...base, openMinutes: 48, outdoor: 14, hasOutdoorSensor: true })).toEqual({ highlight: false, pill: false });
    expect(openingWarning({ ...base, openMinutes: 5, outdoor: 6, hasOutdoorSensor: true })).toEqual({ highlight: false, pill: false });
  });

  it("highlights on time alone without one, and never shows the pill", () => {
    expect(openingWarning({ ...base, openMinutes: 48, outdoor: undefined, hasOutdoorSensor: false })).toEqual({ highlight: true, pill: false });
    expect(openingWarning({ ...base, openMinutes: 5, outdoor: undefined, hasOutdoorSensor: false })).toEqual({ highlight: false, pill: false });
  });

  it("treats a sensor without a number as none", () => {
    expect(openingWarning({ ...base, openMinutes: 48, outdoor: undefined, hasOutdoorSensor: true })).toEqual({ highlight: true, pill: false });
  });

  it("counts the threshold minute itself", () => {
    expect(openingWarning({ ...base, openMinutes: 15, outdoor: 9.9, hasOutdoorSensor: true }).pill).toBe(true);
    expect(openingWarning({ ...base, openMinutes: 15, outdoor: 10, hasOutdoorSensor: true }).pill).toBe(false);
  });
});

describe("sortOpen", () => {
  it("puts the longest open first and unknown starts last", () => {
    const rows = [
      { name: "Balkon", since: 300 },
      { name: "Bad", since: 100 },
      { name: "Keller", since: undefined },
      { name: "Arbeit", since: undefined },
    ];
    expect(sortOpen(rows, "de").map((r) => r.name)).toEqual(["Bad", "Balkon", "Arbeit", "Keller"]);
  });
});

describe("latestClosed", () => {
  it("names the one closed most recently", () => {
    const rows: Array<{ n: string; since?: number }> = [{ n: "a", since: 1 }, { n: "b", since: 5 }, { n: "c" }];
    expect(latestClosed(rows)?.n).toBe("b");
    expect(latestClosed<{ n: string; since?: number }>([{ n: "c" }])).toBeUndefined();
  });
});

describe("numericState", () => {
  it("reads a number or nothing", () => {
    expect(numericState(st("6.4"))).toBe(6.4);
    expect(numericState(st("unavailable"))).toBeUndefined();
    expect(numericState(undefined)).toBeUndefined();
  });
});
