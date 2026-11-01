import { describe, expect, it } from "vitest";
import { buildPrinterNotifyAutomation, endTimePrelude, printerRawValues } from "./printer-notify";

const base = {
  entity: "sensor.p1s_druckstatus",
  targets: ["mobile_app_a", "mobile_app_b"],
  name: "3D Drucker",
  doneMessage: "3D Drucker ist fertig.",
  failedMessage: "3D Drucker: Der Druck ist fehlgeschlagen.",
  startMessage: "3D Drucker druckt.",
  untilText: "Fertig gegen",
};

type Trigger = { id: string; to?: string[]; from?: string[]; not_from?: string[] };

describe("printerRawValues", () => {
  it("collects the built-in values with their casings", () => {
    const v = printerRawValues(["finished"]);
    expect(v).toContain("finish");
    expect(v).toContain("Finish");
    expect(v).not.toContain("running");
  });

  it("follows state_map both ways", () => {
    const v = printerRawValues(["finished"], { done_ok: "finished", finish: "idle" });
    expect(v).toContain("done_ok");
    expect(v).not.toContain("finish");
  });
});

describe("buildPrinterNotifyAutomation", () => {
  it("announces done and failed, each to every phone, and not a restart", () => {
    const a = buildPrinterNotifyAutomation(base);
    const triggers = a.triggers as unknown as Trigger[];
    expect(triggers.map((t) => t.id)).toEqual(["done", "failed"]);
    expect(triggers[0].to).toContain("finish");
    expect(triggers[0].not_from).toContain("unavailable");
    expect(triggers[1].to).toContain("failed");
    const choose = (a.actions[0] as { choose: { sequence: { action: string }[] }[] }).choose;
    expect(choose[0].sequence.map((s) => s.action)).toEqual(["notify.mobile_app_a", "notify.mobile_app_b"]);
    expect(a.mode).toBe("queued");
  });

  it("announces a start only from rest into work", () => {
    const a = buildPrinterNotifyAutomation({ ...base, onStart: true, endEntity: "sensor.end" });
    const start = (a.triggers as unknown as Trigger[]).find((t) => t.id === "start")!;
    expect(start.from).toContain("idle");
    expect(start.from).toContain("finish");
    expect(start.from).not.toContain("prepare");
    expect(start.to).toContain("prepare");
    expect(start.to).toContain("running");
  });
});

describe("endTimePrelude", () => {
  it("prefers the end timestamp and reads the remaining time by its unit", () => {
    expect(endTimePrelude("sensor.end", "sensor.left")).toContain("as_timestamp(states('sensor.end')");
    const r = endTimePrelude(undefined, "sensor.left");
    expect(r).toContain("3600 if u == 'h'");
    expect(endTimePrelude()).toBe("{% set t = none %}");
  });
});
