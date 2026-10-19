import { describe, expect, it } from "vitest";
import { resolveAutomationId } from "./notify-editor";

/**
 * The id decides which automation the editor overwrites on save, and it
 * travels inside the card config — which is a document people paste around.
 * Raised in the HACS review.
 */
describe("resolveAutomationId", () => {
  it("mints an id in its own namespace when there is none", () => {
    const id = resolveAutomationId("climate overview");
    expect(id).toMatch(/^m3_climate_overview_[a-z0-9]+$/);
  });

  it("mints a different one each time, so two cards do not collide", () => {
    const ids = new Set(Array.from({ length: 50 }, () => resolveAutomationId("leak")));
    expect(ids.size).toBeGreaterThan(40);
  });

  it("reuses its own stored id, so re-saving updates in place", () => {
    expect(resolveAutomationId("leak", "m3_leak_ab12cd34")).toBe("m3_leak_ab12cd34");
  });

  it("reuses a short id minted before the suffix had a fixed shape", () => {
    // Math.random().toString(36) drops trailing zeros: one-character
    // suffixes are out there and must keep working.
    expect(resolveAutomationId("leak", "m3_leak_i")).toBe("m3_leak_i");
  });

  it("refuses to adopt an automation it did not create", () => {
    for (const foreign of [
      "automation.heizung_nacht",
      "1699999999999",
      "../../etc/passwd",
      "m3-leak-ab12",
      "notm3_leak_ab12",
      "",
    ]) {
      const id = resolveAutomationId("leak", foreign);
      expect(id, foreign).not.toBe(foreign);
      expect(id, foreign).toMatch(/^m3_leak_[a-z0-9]+$/);
    }
  });
});
