import { describe, it, expect } from "vitest";
import { formatClock, formatDuration, formatSpan } from "./formatting";

describe("formatClock", () => {
  const now = Date.parse("2026-09-13T15:00:00Z");

  it("drops the date when the time is today", () => {
    // A chip saying when the print finishes needs the number, not nine words
    // of date around it.
    expect(formatClock("2026-09-13T15:55:00Z", "de-DE", now)).toMatch(/^\d{2}:\d{2}$/);
  });

  it("keeps a short date when the job runs past midnight", () => {
    const out = formatClock("2026-09-14T02:10:00Z", "de-DE", now)!;
    expect(out).toContain("14");
    expect(out).toMatch(/\d{2}:\d{2}$/);
  });

  it("returns nothing for a value that is not a timestamp", () => {
    expect(formatClock("unknown", "de-DE", now)).toBeUndefined();
    expect(formatClock(undefined, "de-DE", now)).toBeUndefined();
  });
});

describe("formatDuration", () => {
  const strings = { hm: "{h} Std. {m} Min.", m: "{m} Min." };

  it("reads Bambu's hours-as-a-float", () => {
    // The raw state of a job one minute from done, which is what the header
    // used to print verbatim.
    expect(formatDuration("0.0166666666666667", "h", strings)).toBe("1 Min.");
    expect(formatDuration("2.25", "h", strings)).toBe("2 Std. 15 Min.");
  });

  it("reads seconds, which is what OctoPrint and Moonraker report", () => {
    expect(formatDuration("90", "s", strings)).toBe("2 Min.");
    expect(formatDuration("5400", "s", strings)).toBe("1 Std. 30 Min.");
  });

  it("treats a bare number as minutes", () => {
    expect(formatDuration("45", undefined, strings)).toBe("45 Min.");
  });

  it("gives up on anything that is not a number, so the caller can fall back", () => {
    expect(formatDuration("2h 14m", undefined, strings)).toBeUndefined();
    expect(formatDuration("unknown", "h", strings)).toBeUndefined();
    expect(formatDuration("", "h", strings)).toBeUndefined();
    expect(formatDuration("5", "parsecs", strings)).toBeUndefined();
  });
});

describe("formatSpan", () => {
  it("uses at most two units, larger first, and drops an empty second one", () => {
    expect(formatSpan(12 * 60_000, "en")).toBe("12 min");
    expect(formatSpan(3 * 3_600_000 + 5 * 60_000, "en")).toBe("3 hr 5 min");
    expect(formatSpan(3 * 3_600_000, "en")).toBe("3 hr");
    expect(formatSpan(2 * 86_400_000 + 4 * 3_600_000 + 59 * 60_000, "en")).toBe("2 days 4 hr");
  });
});
