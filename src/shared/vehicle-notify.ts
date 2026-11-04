import type { M3VehicleCardConfig } from "../types";
import { notifyActions, type NotifyAutomationSpec } from "./notify-editor";
import { HELD_A_MINUTE } from "./printer-notify";
import { DEFAULT_CHARGING_STATES, slotConfig, slotEntity } from "./vehicle";

/**
 * The vehicle card's notification automation. Four reasons, each optional:
 * charging finished, battery or fuel below a level, unlocked for a while, and
 * an evening reminder when the car is low and not plugged in.
 *
 * Only entity slots can be watched. A slot filled by a template has no entity
 * an automation could trigger on, so a reason that needs it is left out rather
 * than written against a guess — the editor's hint says so.
 */

export interface VehicleNotifyTexts {
  chargeDone: string;
  low: string;
  unlocked: string;
  plug: string;
}

/** HA's states for "nothing to read", which a trigger must not count as a change. */
const NOT_READ = ["unavailable", "unknown"];

/** A value and its usual casings: "Charging", "charging", "CHARGING". */
function casings(values: string[]): string[] {
  const out = new Set<string>();
  for (const v of values) {
    const lower = v.toLowerCase();
    out.add(v);
    out.add(lower);
    out.add(lower.charAt(0).toUpperCase() + lower.slice(1));
    out.add(lower.toUpperCase());
  }
  return [...out].sort();
}

/** Which of the four reasons this config can actually watch. */
export function vehicleNotifyReasons(config: M3VehicleCardConfig): {
  chargeDone: boolean;
  low: boolean;
  unlocked: boolean;
  plug: boolean;
} {
  const e = config.energy ?? {};
  const electric = (config.drive ?? "ev") !== "fuel";
  const level = levelEntity(config);
  return {
    chargeDone: electric && config.notify_charge_done !== false && !!slotEntity(e.charging),
    low: config.notify_low_below !== undefined && config.notify_low_below !== null && !!level,
    unlocked: !!config.notify_unlocked_minutes && !!slotEntity(config.lock),
    plug: electric && !!config.notify_plug_time && !!slotEntity(e.plugged) && !!slotEntity(e.battery),
  };
}

/** The battery, or the tank on a combustion car — what "low" refers to. */
function levelEntity(config: M3VehicleCardConfig): string | undefined {
  const e = config.energy ?? {};
  return (config.drive ?? "ev") === "fuel" ? slotEntity(e.fuel_level) : (slotEntity(e.battery) ?? slotEntity(e.fuel_level));
}

export function buildVehicleNotifyAutomation(
  config: M3VehicleCardConfig,
  p: { targets: string[]; name: string; texts: VehicleNotifyTexts },
): Omit<NotifyAutomationSpec, "id" | "alias" | "description"> {
  const e = config.energy ?? {};
  const reasons = vehicleNotifyReasons(config);
  const level = levelEntity(config);
  const levelText = level ? `{{ states('${level}') | float(0) | round(0) | int }}` : "–";
  const say = (message: string) =>
    notifyActions(p.targets, p.name, message.replace("{name}", p.name).replace("{level}", levelText), {
      title: config.notify_title,
    });

  const triggers: Record<string, unknown>[] = [];
  const choose: Record<string, unknown>[] = [];

  if (reasons.chargeDone) {
    const entity = slotEntity(e.charging)!;
    const cfg = slotConfig(e.charging) as { charging_states?: string[] } | undefined;
    const binary = entity.startsWith("binary_sensor.");
    const charging = binary ? ["on"] : casings(cfg?.charging_states ?? DEFAULT_CHARGING_STATES);
    triggers.push({
      trigger: "state",
      id: "charge_done",
      entity_id: entity,
      from: charging,
      // A dropped connection is not the end of a charge.
      not_to: [...NOT_READ, ...charging],
    });
    choose.push({
      conditions: [{ condition: "trigger", id: "charge_done" }, HELD_A_MINUTE],
      sequence: say(p.texts.chargeDone),
    });
  }

  if (reasons.low) {
    triggers.push({ trigger: "numeric_state", id: "low", entity_id: level, below: config.notify_low_below });
    choose.push({ conditions: [{ condition: "trigger", id: "low" }], sequence: say(p.texts.low) });
  }

  if (reasons.unlocked) {
    const entity = slotEntity(config.lock)!;
    const minutes = config.notify_unlocked_minutes!;
    const open = entity.startsWith("binary_sensor.") ? ["on"] : ["unlocked", "open"];
    triggers.push({ trigger: "state", id: "unlocked", entity_id: entity, to: open, for: { minutes } });
    choose.push({
      conditions: [{ condition: "trigger", id: "unlocked" }],
      sequence: say(p.texts.unlocked.replace("{n}", String(minutes))),
    });
  }

  if (reasons.plug) {
    const plug = slotEntity(e.plugged)!;
    const battery = slotEntity(e.battery)!;
    const at = config.notify_plug_time!.length === 5 ? `${config.notify_plug_time}:00` : config.notify_plug_time;
    triggers.push({ trigger: "time", id: "plug", at });
    choose.push({
      conditions: [
        { condition: "trigger", id: "plug" },
        // Plugged reads on/true/connected depending on the integration; anything
        // else — including unavailable — is "not plugged" only when it is a
        // real off, so a car out of reach does not trigger a reminder.
        {
          condition: "template",
          value_template: `{{ states('${plug}') | lower in ['off', 'false', 'disconnected', 'unplugged', 'no'] }}`,
        },
        { condition: "numeric_state", entity_id: battery, below: config.notify_plug_below ?? 50 },
      ],
      sequence: say(p.texts.plug),
    });
  }

  return { mode: "queued", triggers, conditions: [], actions: [{ choose }] };
}
