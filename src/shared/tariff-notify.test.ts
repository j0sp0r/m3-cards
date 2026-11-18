import { describe, expect, it } from "vitest";
import { tariffNotifyParts } from "./tariff-notify";

const tariffs = [
  { name: "Hochtarif", short: "HT", price: 0.3216 },
  { name: "Niedertarif", short: "NT", price: "sensor.price_nt" },
];
const texts = { now: "Jetzt {tarif}, {preis}", until: ", bis {bis}", soon: "In {minuten} Min. beginnt {tarif}" };
const base = { tariffs, decimalComma: true, priceUnit: "€/kWh", texts, advance: 0 };

describe("tariffNotifyParts", () => {
  it("runs on the schedule's start times, with a warning ahead across midnight", () => {
    const p = tariffNotifyParts({ ...base, schedule: [{ tariff: "NT", from: "00:10", to: "06:00" }, { tariff: "HT", from: "06:00", to: "00:10" }], advance: 15 });
    expect(p.triggers).toEqual([
      { trigger: "time", at: "00:10:00", id: "now_0" },
      { trigger: "time", at: "23:55:00", id: "soon_0" },
      { trigger: "time", at: "06:00:00", id: "now_1" },
      { trigger: "time", at: "05:45:00", id: "soon_1" },
    ]);
    expect(p.variables.sched).toContain('"0":{"t":1,"to":"06:00","days":[]}');
    expect(p.message.startsWith("{% if soon %}")).toBe(true);
  });

  it("announces only the chosen tariffs", () => {
    const p = tariffNotifyParts({ ...base, schedule: [{ tariff: "NT", from: "22:00", to: "06:00" }, { tariff: "HT", from: "06:00", to: "22:00" }], announce: [1] });
    expect(p.triggers).toEqual([{ trigger: "time", at: "22:00:00", id: "now_0" }]);
  });

  it("follows the active-tariff entity when there is no schedule", () => {
    const p = tariffNotifyParts({ ...base, activeEntity: "select.tarif", untilEntity: "sensor.ende" });
    expect(p.triggers).toEqual([{ trigger: "state", entity_id: "select.tarif", not_from: ["unavailable", "unknown"], not_to: ["unavailable", "unknown"], id: "entity" }]);
    expect(p.variables.key).toContain("'entity'");
    expect(p.variables.until).toContain("states('sensor.ende')");
    expect(p.variables.tt).toContain('"pe":"sensor.price_nt"');
    expect(p.variables.tt).toContain('"p":0.3216');
    expect(p.variables.tt).toContain('"pe":none');
    expect(p.variables.tt).not.toContain("null");
  });

  it("words the price with a decimal comma and the end when known", () => {
    const p = tariffNotifyParts({ ...base, activeEntity: "select.tarif" });
    expect(p.variables.price).toContain("replace('.', ',')");
    expect(p.message).toBe("Jetzt {{ tt[idx | int].n }}, {% if price %}{{ price }} €/kWh{% endif %}{% if until %}, bis {{ until }}{% endif %}");
    expect(tariffNotifyParts({ ...base }).usable).toBe(false);
  });
});
