import { describe, expect, it } from "vitest";
import { wasteDaysFromState, withoutDeviceName } from "./waste";

const now = new Date(2026, 10, 26, 21, 30); // 26 Nov 2026, evening

describe("wasteDaysFromState", () => {
  it("counts days for a date state instead of reading the year", () => {
    expect(wasteDaysFromState("2026-11-26", now)).toBe(0);
    expect(wasteDaysFromState("2026-12-01", now)).toBe(5);
    expect(wasteDaysFromState("2026-12-22", now)).toBe(26);
    expect(wasteDaysFromState("2027-01-02", now)).toBe(37);
  });

  it("goes negative for a date already past", () => {
    expect(wasteDaysFromState("2026-11-25", now)).toBe(-1);
  });

  it("reads a timestamp by the local day it falls on", () => {
    const at = new Date(2026, 10, 28, 7, 0);
    expect(wasteDaysFromState(at.toISOString(), now)).toBe(2);
  });

  it("still takes a plain day count", () => {
    expect(wasteDaysFromState("3", now)).toBe(3);
    expect(wasteDaysFromState("0", now)).toBe(0);
    expect(wasteDaysFromState("2.4", now)).toBe(2);
  });

  it("knows nothing for an unreadable state", () => {
    for (const s of [undefined, "", "unknown", "unavailable", "Restmüll"]) {
      expect(wasteDaysFromState(s, now)).toBeUndefined();
    }
  });
});

describe("withoutDeviceName", () => {
  it("drops the device's name in front of the entity's", () => {
    expect(withoutDeviceName("Rue Example 1, 1000 - Town Déchets ménagers résiduels", "Rue Example 1, 1000 - Town")).toBe(
      "Déchets ménagers résiduels",
    );
  });

  it("leaves a name alone that does not start with it, or is nothing else", () => {
    expect(withoutDeviceName("Restmüll", "Abfall")).toBe("Restmüll");
    expect(withoutDeviceName("Abfall", "Abfall")).toBe("Abfall");
    expect(withoutDeviceName("Restmüll", undefined)).toBe("Restmüll");
  });
});
