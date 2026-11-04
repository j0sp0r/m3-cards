import { describe, expect, it } from "vitest";
import type { M3VehicleCardConfig } from "../types";
import { buildVehicleNotifyAutomation, vehicleNotifyReasons } from "./vehicle-notify";

const texts = { chargeDone: "{name}: done", low: "{name}: {level} %", unlocked: "{name} open {n}", plug: "{name} plug {level}" };
const cfg = (c: Partial<M3VehicleCardConfig>): M3VehicleCardConfig => ({ type: "custom:m3-vehicle-card", ...c });

describe("vehicle notifications", () => {
  it("watches only what is mapped to an entity", () => {
    expect(vehicleNotifyReasons(cfg({ energy: { battery: { template: "{{ 1 }}" } }, notify_low_below: 20 })).low).toBe(false);
    expect(vehicleNotifyReasons(cfg({ energy: { battery: "sensor.soc", charging: "binary_sensor.c" } }))).toEqual({
      chargeDone: true,
      low: false,
      unlocked: false,
      plug: false,
    });
  });

  it("ends a charge only on a real change, not a dropout", () => {
    const a = buildVehicleNotifyAutomation(cfg({ energy: { battery: "sensor.soc", charging: "sensor.state" } }), {
      targets: ["mobile_app_x"],
      name: "Car",
      texts,
    });
    const t = a.triggers[0] as { from: string[]; not_to: string[] };
    expect(t.from).toContain("Charging");
    expect(t.not_to).toContain("unavailable");
    expect(t.not_to).toContain("charging");
  });

  it("writes all four reasons with the level filled in", () => {
    const a = buildVehicleNotifyAutomation(
      cfg({
        energy: { battery: "sensor.soc", charging: "binary_sensor.c", plugged: "binary_sensor.plug" },
        lock: "lock.car",
        notify_low_below: 20,
        notify_unlocked_minutes: 10,
        notify_plug_time: "21:00",
      }),
      { targets: ["mobile_app_x"], name: "Car", texts },
    );
    expect(a.triggers.map((t) => t.id)).toEqual(["charge_done", "low", "unlocked", "plug"]);
    expect(JSON.stringify(a.actions)).toContain("states('sensor.soc')");
    expect(JSON.stringify(a.triggers)).toContain("21:00:00");
  });
});
