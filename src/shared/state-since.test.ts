import { describe, expect, it } from "vitest";
import { durationSpan, formatHeldFor, realChange } from "./state-since";

describe("realChange", () => {
  const t = (iso: string) => Date.parse(iso) / 1000;
  const windowStart = Date.parse("2026-10-19T03:00:00Z");

  it("skips a restart that brought the same state back", () => {
    // The author's garden presence on 2026-11-01/02: out at 20:10, then two
    // reconnects of the mirrored entity.
    const rows = [
      { s: "on", lu: t("2026-11-01T19:09:42Z") },
      { s: "off", lu: t("2026-11-01T19:10:08Z") },
      { s: null, lu: t("2026-11-01T21:53:18Z") },
      { s: "off", lu: t("2026-11-01T21:54:03Z") },
      { s: "unavailable", lu: t("2026-11-02T03:00:01Z") },
      { s: "off", lu: t("2026-11-02T03:00:32Z") },
    ];
    expect(realChange(rows, "off", windowStart)).toEqual({ at: Date.parse("2026-11-01T19:10:08Z"), older: false });
  });

  it("takes the latest change when the state really changed", () => {
    const rows = [
      { s: "off", lc: t("2026-11-01T08:00:00Z") },
      { s: "on", lu: t("2026-11-01T09:00:00Z") },
    ];
    expect(realChange(rows, "on", windowStart).at).toBe(Date.parse("2026-11-01T09:00:00Z"));
  });

  it("is older than the window when the state was there at its start", () => {
    const rows = [
      { s: "off", lc: t("2026-10-19T03:00:00Z") },
      { s: "unavailable", lu: t("2026-11-02T03:00:01Z") },
      { s: "off", lu: t("2026-11-02T03:00:32Z") },
    ];
    expect(realChange(rows, "off", windowStart)).toEqual({ older: true });
  });

  it("starts with an entity newer than the window", () => {
    const rows = [{ s: "off", lc: t("2026-10-30T12:00:00Z") }, { s: "off", lu: t("2026-11-02T03:00:32Z") }];
    expect(realChange(rows, "off", windowStart)).toEqual({ at: Date.parse("2026-10-30T12:00:00Z"), older: false });
  });

  it("knows nothing without rows", () => {
    expect(realChange([], "off", windowStart)).toEqual({ older: false });
    expect(realChange([{ s: "unknown", lu: 1 }], "off", windowStart)).toEqual({ older: false });
  });
});

describe("durationSpan", () => {
  const t0 = Date.parse("2026-11-01T12:00:00Z");
  const after = (min: number) => durationSpan(t0, t0 + min * 60000 + 30000);

  it("moves from minutes to hours to days", () => {
    expect(after(14)).toEqual({ kind: "m", m: 14 });
    expect(after(23 * 60 + 59)).toEqual({ kind: "hm", h: 23, m: 59 });
    expect(after(24 * 60)).toEqual({ kind: "dh", h: 0 });
    expect(after(27 * 60 + 40)).toEqual({ kind: "dh", h: 3 });
    expect(after(48 * 60 + 5)).toEqual({ kind: "d", d: 2 });
    expect(after(7 * 24 * 60 + 12)).toEqual({ kind: "d", d: 7 });
  });
});

describe("formatHeldFor", () => {
  const t0 = Date.parse("2026-11-01T12:00:00Z");
  const at = (min: number) => t0 + min * 60000 + 30000;

  it("prints each span in German and English", () => {
    expect(formatHeldFor(t0, at(48), "de")).toBe("48 Min.");
    expect(formatHeldFor(t0, at(125), "de")).toBe("2 Std. 5 Min.");
    expect(formatHeldFor(t0, at(24 * 60), "de")).toBe("1 Tag");
    expect(formatHeldFor(t0, at(27 * 60), "de")).toBe("1 Tag 3 Std.");
    expect(formatHeldFor(t0, at(49 * 60), "en")).toBe("2 days");
  });
});
