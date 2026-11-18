import { describe, expect, it } from "vitest";
import { availabilityNotifyParts } from "./availability-notify";
import type { WatchedUnit } from "./availability";

const unit = (key: string, name: string, entities: string[]): WatchedUnit => ({ key, deviceId: key, name, entities, primary: entities[0] });
const texts = { offline: "{geraet} ist seit {minuten} Min. nicht erreichbar.", back: "{geraet} ist wieder erreichbar." };

describe("availabilityNotifyParts", () => {
  const units = [unit("d1", "Steckdose Balkon", ["switch.balkon", "sensor.balkon_power"]), unit("d2", "Kamera", ["camera.garten"]), unit("d3", "Fernseher", ["media_player.tv"])];

  it("watches every deciding entity, minus the skipped devices", () => {
    const p = availabilityNotifyParts({ units, skip: new Set(["d3"]), minutes: 30, back: false, texts });
    expect(p.devices).toBe(2);
    expect(p.entities).toBe(3);
    expect(p.triggers).toEqual([{ trigger: "state", entity_id: ["switch.balkon", "sensor.balkon_power", "camera.garten"], to: "unavailable", for: { minutes: 30 }, id: "off" }]);
    expect(p.variables.owner).toContain('"sensor.balkon_power":"u0"');
    expect(p.variables.units).toContain('"n":"Steckdose Balkon"');
  });

  it("adds the way back only when asked, and words both cases", () => {
    const p = availabilityNotifyParts({ units, minutes: 15, back: true, texts });
    expect(p.triggers[1]).toMatchObject({ from: "unavailable", not_to: ["unavailable", "unknown"], id: "back" });
    expect(p.message).toBe("{% if back %}{{ unit.n }} ist wieder erreichbar.{% else %}{{ unit.n }} ist seit {{ minutes }} Min. nicht erreichbar.{% endif %}");
    expect(availabilityNotifyParts({ units, minutes: 15, back: false, texts }).message).not.toContain("{% if back %}");
  });

  it("takes the user's own text with the placeholders", () => {
    const p = availabilityNotifyParts({ units, minutes: 5, back: false, texts: { ...texts, customOffline: "Weg: {geraet}" } });
    expect(p.message).toBe("Weg: {{ unit.n }}");
  });

  it("lets one trigger per outage through and keeps names out of Jinja's way", () => {
    const p = availabilityNotifyParts({ units: [unit("x", 'Lampe {{ "a" }}', ["light.a"])], minutes: 0, back: false, texts });
    const cond = String(p.conditions[0].value_template);
    expect(cond).toContain("rejectattr('state', 'eq', 'unavailable')");
    expect(cond).toContain("sort(attribute='last_changed') | last).entity_id == ent");
    expect(p.variables.units).not.toMatch(/\{\{ "a"/);
    expect(p.triggers[0]).toMatchObject({ for: { minutes: 1 } });
    expect(p.variables.ent).toContain("'light.a'");
  });
});
