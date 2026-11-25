import { describe, expect, it } from "vitest";
import { homeZoneName, presenceStateFor } from "./presence-home";

describe("presenceStateFor", () => {
  it("leaves states alone without a home zone", () => {
    expect(presenceStateFor("home", undefined, "Home")).toBe("home");
    expect(presenceStateFor("Work", undefined, "Home")).toBe("Work");
  });
  it("reads the home zone as home and the real home as a zone", () => {
    expect(presenceStateFor("Holiday home", "Holiday home", "Home")).toBe("home");
    expect(presenceStateFor("home", "Holiday home", "Home")).toBe("Home");
    expect(presenceStateFor("not_home", "Holiday home", "Home")).toBe("not_home");
    expect(presenceStateFor("Work", "Holiday home", "Home")).toBe("Work");
  });
});

describe("homeZoneName", () => {
  const names: Record<string, string> = { "zone.holiday_home": "Holiday home" };
  const lookup = (id: string) => names[id];
  it("resolves a zone id to its name", () => expect(homeZoneName("zone.holiday_home", lookup)).toBe("Holiday home"));
  it("takes a plain name as is", () => expect(homeZoneName("Holiday home", lookup)).toBe("Holiday home"));
  it("treats zone.home and nothing as the usual home", () => {
    expect(homeZoneName("zone.home", lookup)).toBeUndefined();
    expect(homeZoneName(undefined, lookup)).toBeUndefined();
  });
  it("falls back to the usual home for a zone that does not exist", () =>
    expect(homeZoneName("zone.missing", lookup)).toBeUndefined());
});
