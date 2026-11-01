import type { PrinterStateMap } from "../types";
import { DEFAULT_PRINTER_STATE_MAP, type PrinterState } from "./printer";
import { notifyActions, type NotifyAutomationSpec } from "./notify-editor";

/**
 * The printer card's notification automation: a job finishing, a job failing,
 * and — on request — a job starting.
 *
 * The card resolves a raw status into one of six states in JavaScript, which an
 * automation cannot do. So the states are turned back into the raw values that
 * lead to them — the built-in table plus the card's own `state_map` — and the
 * triggers compare against those, in the casings an integration might use.
 * A value only the card's substring rules recognise is not covered; that is
 * what `state_map` is for, and the editor says so.
 */

/** Every raw value that resolves to one of `states`, in the usual casings. */
export function printerRawValues(states: PrinterState[], stateMap?: PrinterStateMap): string[] {
  const wanted = new Set(states);
  const raw = new Set<string>();
  for (const [value, state] of Object.entries(DEFAULT_PRINTER_STATE_MAP)) {
    if (wanted.has(state)) raw.add(value);
  }
  for (const [value, state] of Object.entries(stateMap ?? {})) {
    if (wanted.has(state)) raw.add(value);
    else raw.delete(value.toLowerCase());
  }
  const out = new Set<string>();
  for (const value of raw) {
    const lower = value.toLowerCase();
    out.add(value);
    out.add(lower);
    out.add(lower.charAt(0).toUpperCase() + lower.slice(1));
  }
  return [...out].sort();
}

/** The states HA itself reports for an entity it cannot read. */
const NOT_READ = ["unavailable", "unknown"];

export interface PrinterNotifyParams {
  entity: string;
  stateMap?: PrinterStateMap;
  targets: string[];
  name: string;
  /** Built-in sentences, already in the user's language, with the name filled in. */
  doneMessage: string;
  failedMessage: string;
  startMessage: string;
  /** "Done around", before the time in the start message. */
  untilText: string;
  /** User overrides, with `{geraet}` and (start only) `{ende}` tokens. */
  title?: string;
  message?: string;
  startText?: string;
  onStart?: boolean;
  /** A completion timestamp, preferred for the start message's end time. */
  endEntity?: string;
  /** Time left, in the unit its sensor states; the fallback for the end time. */
  remainingEntity?: string;
}

/** The time a job ends, as a Jinja prelude setting `t` to a timestamp or none. */
export function endTimePrelude(endEntity?: string, remainingEntity?: string): string {
  const future = "{% set t = t if t and t > now().timestamp() + 60 else none %}";
  if (endEntity) return `{% set t = as_timestamp(states('${endEntity}'), none) %}` + future;
  if (remainingEntity) {
    // Bambu states the time left in hours, OctoPrint and Moonraker in minutes
    // or seconds: the unit decides the factor.
    return (
      `{% set r = states('${remainingEntity}') %}` +
      `{% set u = state_attr('${remainingEntity}', 'unit_of_measurement') %}` +
      `{% set f = 3600 if u == 'h' else 1 if u == 's' else 60 %}` +
      `{% set t = (now().timestamp() + r | float * f) if is_number(r) else none %}` +
      future
    );
  }
  return "{% set t = none %}";
}

export function buildPrinterNotifyAutomation(
  p: PrinterNotifyParams,
): Omit<NotifyAutomationSpec, "id" | "alias" | "description"> {
  const finished = printerRawValues(["finished"], p.stateMap);
  const failed = printerRawValues(["error"], p.stateMap);
  const printing = printerRawValues(["printing"], p.stateMap);
  const resting = printerRawValues(["idle", "finished", "error"], p.stateMap);
  const texts = { title: p.title, tokens: { geraet: p.name } };

  const triggers: Record<string, unknown>[] = [
    // not_from leaves out a restart or a printer coming back online: only a
    // job that ends is announced, not a status that was already there.
    { trigger: "state", id: "done", entity_id: p.entity, to: finished, not_from: [...NOT_READ, ...finished] },
    { trigger: "state", id: "failed", entity_id: p.entity, to: failed, not_from: [...NOT_READ, ...failed] },
  ];
  const choose: Record<string, unknown>[] = [
    {
      conditions: [{ condition: "trigger", id: "done" }],
      sequence: notifyActions(p.targets, p.name, p.doneMessage, { ...texts, message: p.message }),
    },
    {
      conditions: [{ condition: "trigger", id: "failed" }],
      sequence: notifyActions(p.targets, p.name, p.failedMessage, texts),
    },
  ];

  if (p.onStart) {
    // From rest into work only: Bambu passes through `prepare` before
    // `running`, and that second step is the same job, not a new one.
    triggers.push({ trigger: "state", id: "start", entity_id: p.entity, from: resting, to: printing });
    const prelude = endTimePrelude(p.endEntity, p.remainingEntity);
    const message = `${p.startMessage}{% if t %} ${p.untilText} {{ t | timestamp_custom('%H:%M') }}.{% endif %}`;
    choose.push({
      conditions: [{ condition: "trigger", id: "start" }],
      sequence: [
        // The slicer's estimate arrives after the job does; waiting for it
        // beats announcing "done around now".
        ...(p.endEntity || p.remainingEntity ? [{ delay: { seconds: 90 } }] : []),
        ...notifyActions(p.targets, p.name, message, {
          ...texts,
          message: p.startText,
          prelude,
          tokens: { geraet: p.name, ende: "{{ t | timestamp_custom('%H:%M') if t else '–' }}" },
        }),
      ],
    });
  }

  return {
    // Queued rather than single: the start message waits a minute and a half,
    // and a job failing inside that time must still be reported.
    mode: "queued",
    triggers,
    conditions: [],
    actions: [{ choose }],
  };
}
