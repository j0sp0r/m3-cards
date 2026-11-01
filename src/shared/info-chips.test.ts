import { describe, expect, it } from "vitest";
import { chipStateText, isChipHeading } from "./info-chips";
import type { HassEntity } from "../types";

describe("isChipHeading", () => {
  it("tells a divider from a reading", () => {
    expect(isChipHeading({ heading: "AMS" })).toBe(true);
    expect(isChipHeading({ entity: "sensor.a" })).toBe(false);
  });

  it("treats an entry with an entity as a reading even if it names a heading", () => {
    expect(isChipHeading({ entity: "sensor.a", heading: "AMS" } as never)).toBe(false);
  });
});

describe("chipStateText", () => {
  const st = (state: string, unit?: string): HassEntity =>
    ({ entity_id: "sensor.x", state, attributes: unit ? { unit_of_measurement: unit } : {} }) as HassEntity;

  it("keeps the reading's own decimals and its unit", () => {
    expect(chipStateText(undefined, "de", st("23.62", "°C"), "23.62")).toBe("23,62 °C");
    expect(chipStateText(undefined, "de", st("32", "%"), "32")).toBe("32 %");
  });

  it("tidies a raw word when Home Assistant has no wording for it", () => {
    expect(chipStateText(undefined, "de", st("heavy_duty"), "heavy_duty")).toBe("Heavy duty");
  });
});

describe("moveChip", () => {
  it("swaps with the neighbour and refuses to leave the list", async () => {
    const { moveChip } = await import("./info-chips-editor");
    expect(moveChip(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveChip(["a", "b", "c"], 2, 1)).toBeUndefined();
    expect(moveChip(["a", "b", "c"], 0, -1)).toBeUndefined();
  });
});
