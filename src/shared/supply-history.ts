import type { HomeAssistant } from "../types";
import { SUPPLY_MAX_USE_STEP } from "../const";

// Consumption rate for the supply card.
//
// Deliberately NOT recorder/statistics_during_period: long-term statistics
// exist only for `sensor` entities carrying a state_class. The counter and
// input_number helpers a supply is built on never appear there — verified
// against a live instance where all 1124 statistic ids were sensor.*. The
// History API records plain state changes for every domain instead, which
// also happens to be the better fit: each decrement is exactly one
// consumption event.

interface HistoryPoint {
  s?: string;
  lu?: number;
}

export interface ConsumptionRate {
  /** Units consumed per day; undefined when the sample is too thin to trust. */
  perDay?: number;
  /** Number of observed decrements — refills are not counted. */
  events: number;
  /** Days the returned history actually spans, which is what perDay divides by. */
  spanDays: number;
}

const EMPTY: ConsumptionRate = { events: 0, spanDays: 0 };

// One request for every item, not one per item: the History API takes a list,
// and a card with six supplies should not open six round-trips per refresh.
export async function fetchConsumptionRates(
  hass: HomeAssistant,
  entityIds: string[],
  windowDays: number,
  minEvents: number,
  minSpanDays: number,
): Promise<Map<string, ConsumptionRate>> {
  const out = new Map<string, ConsumptionRate>();
  if (!entityIds.length) return out;

  const nowMs = Date.now();
  const startMs = nowMs - windowDays * 86400000;

  let response: Record<string, HistoryPoint[]> = {};
  try {
    response = await hass.callWS<Record<string, HistoryPoint[]>>({
      type: "history/history_during_period",
      start_time: new Date(startMs).toISOString(),
      end_time: new Date(nowMs).toISOString(),
      entity_ids: entityIds,
      minimal_response: true,
      no_attributes: true,
    });
  } catch (e) {
    console.warn("m3-supply-card: history_during_period failed", e);
    for (const id of entityIds) out.set(id, EMPTY);
    return out;
  }

  for (const id of entityIds) {
    out.set(id, summarizeConsumption(response[id] ?? [], startMs, nowMs, minEvents, minSpanDays));
  }
  return out;
}

/** The rate from one entity's history. Exported for its tests. */
export function summarizeConsumption(
  points: HistoryPoint[],
  startMs: number,
  nowMs: number,
  minEvents: number,
  minSpanDays: number,
): ConsumptionRate {
  const usable = points
    .filter((p) => p.lu !== undefined && !isNaN(parseFloat(p.s ?? "")))
    .map((p) => ({ t: p.lu! * 1000, v: parseFloat(p.s!) }))
    .sort((a, b) => a.t - b.t);
  if (usable.length < 2) return EMPTY;

  let consumed = 0;
  let events = 0;
  for (let i = 1; i < usable.length; i++) {
    const delta = usable[i].v - usable[i - 1].v;
    // Only small decreases are consumption. A refill or a correction upward is
    // not negative usage and must not cancel out real consumption; a large
    // drop is someone setting the count by hand, not a pack used in a minute.
    if (delta < 0 && -delta <= SUPPLY_MAX_USE_STEP) {
      consumed += -delta;
      events++;
    }
  }

  // The recorder keeps 10 days by default, so a 30-day window routinely comes
  // back with a third of that. Dividing by the requested window would then
  // understate consumption threefold and promise triple the range. Divide by
  // what the data actually covers: the window start when history reaches that
  // far back, otherwise the oldest point we did get.
  const coveredFromMs = Math.max(usable[0].t, startMs);
  const spanDays = (nowMs - coveredFromMs) / 86400000;
  if (spanDays < minSpanDays || events < minEvents || consumed <= 0) {
    return { events, spanDays: Math.max(0, spanDays) };
  }
  return { perDay: consumed / spanDays, events, spanDays };
}
