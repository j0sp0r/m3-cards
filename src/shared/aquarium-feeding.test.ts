import { describe, expect, it } from "vitest";
import { feedingStatus, minutesOfDay, parseFeedingState } from "./aquarium-feeding";

const at = (s: string) => new Date(s);

describe("minutesOfDay", () => {
  it("reads both time forms and refuses nonsense", () => {
    expect(minutesOfDay("19:00")).toBe(1140);
    expect(minutesOfDay("07:30:00")).toBe(450);
    expect(minutesOfDay("25:00")).toBeUndefined();
    expect(minutesOfDay(undefined)).toBeUndefined();
  });
});

describe("parseFeedingState", () => {
  it("reads an input_datetime and an input_button the same", () => {
    expect(parseFeedingState("2026-11-02 08:12:00")?.getHours()).toBe(8);
    expect(parseFeedingState("2026-11-02T08:12:00")?.getMinutes()).toBe(12);
    expect(parseFeedingState("unknown")).toBeUndefined();
    expect(parseFeedingState("not a date")).toBeUndefined();
  });
});

describe("feedingStatus", () => {
  it("counts the calendar day, not the last 24 hours", () => {
    expect(feedingStatus("2026-11-01 23:50:00", at("2026-11-02T00:10:00"), "19:00").fedToday).toBe(false);
    expect(feedingStatus("2026-11-02 00:05:00", at("2026-11-02T23:00:00"), "19:00").fedToday).toBe(true);
  });

  it("is overdue only once the day passes the time, and never when fed", () => {
    expect(feedingStatus("2026-11-01 08:00:00", at("2026-11-02T18:59:00"), "19:00").overdue).toBe(false);
    expect(feedingStatus("2026-11-01 08:00:00", at("2026-11-02T19:00:00"), "19:00").overdue).toBe(true);
    expect(feedingStatus("2026-11-02 08:00:00", at("2026-11-02T21:00:00"), "19:00").overdue).toBe(false);
  });

  it("is never overdue without a time to compare", () => {
    expect(feedingStatus(undefined, at("2026-11-02T22:00:00"), undefined)).toEqual({ at: undefined, fedToday: false, overdue: false });
  });
});
