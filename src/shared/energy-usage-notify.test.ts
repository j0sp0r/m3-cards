import { describe, expect, it } from "vitest";
import { energyReportParts } from "./energy-usage-notify";
import type { Sources } from "./energy-sources";

const sources: Sources = {
  gridFrom: ["sensor.in"],
  gridTo: ["sensor.out"],
  solar: ["sensor.pv"],
  batteryFrom: ["sensor.bat_out"],
  batteryTo: ["sensor.bat_in"],
  gridCost: ["sensor.cost"],
  exportCompensation: [],
  devices: [],
};
const texts = {
  period: { daily: "Gestern", weekly: "Letzte Woche", monthly: "Letzter Monat" },
  message: "{zeitraum}: {verbrauch} kWh · {kosten} · {autark} % autark",
};

describe("energyReportParts", () => {
  it("asks the recorder by the hour for a day and by the day for a month", () => {
    const day = energyReportParts({ sources, mode: "daily", time: "08:00", decimalComma: true, currency: "€", texts });
    expect(day.triggers).toEqual([{ trigger: "time", at: "08:00:00" }]);
    expect(day.conditions).toEqual([]);
    expect(day.actions[1]).toMatchObject({ action: "recorder.get_statistics", response_variable: "stats", data: { period: "hour", types: ["change"], units: { energy: "kWh" } } });
    expect((day.actions[1].data as { statistic_ids: string[] }).statistic_ids).toEqual(["sensor.in", "sensor.out", "sensor.pv", "sensor.bat_out", "sensor.bat_in", "sensor.cost"]);
    const month = energyReportParts({ sources, mode: "monthly", time: "07:30:00", decimalComma: true, currency: "€", texts });
    expect(month.conditions).toEqual([{ condition: "template", value_template: "{{ now().day == 1 }}" }]);
    expect((month.actions[1].data as { period: string }).period).toBe("day");
    expect(energyReportParts({ sources, mode: "weekly", time: "08:00", decimalComma: false, currency: "$", texts }).conditions).toEqual([{ condition: "time", weekday: ["mon"] }]);
  });

  it("splits like the energy dashboard, bucket by bucket", () => {
    const r = String((energyReportParts({ sources, mode: "daily", time: "08:00", decimalComma: true, currency: "€", texts }).actions[2].variables as { r: string }).r);
    expect(r).toContain("{% set us = [left, so] | min %}");
    expect(r).toContain("{% set b2g = [bo, go] | min %}");
    expect(r).toContain("'self': ((1 - ([1, t.gin / t.use] | min)) * 100) | round(0)");
  });

  it("words the message with a decimal comma and the cost only where there is one", () => {
    const p = energyReportParts({ sources, mode: "daily", time: "08:00", decimalComma: true, currency: "€", texts });
    expect(p.message).toBe(
      "Gestern: {{ ('%.1f' | format(r.use)) | replace('.', ',') }} kWh · {% if r.has_cost %}{{ ('%.2f' | format(r.cost)) | replace('.', ',') }} €{% else %}–{% endif %} · {{ r.self | int }} % autark",
    );
    const en = energyReportParts({ sources, mode: "daily", time: "08:00", decimalComma: false, currency: "$", texts: { ...texts, custom: "Used {verbrauch}" } });
    expect(en.message).toBe("Used {{ ('%.1f' | format(r.use)) }}");
  });
});
