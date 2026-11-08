import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HomeAssistant } from "../types";
import { clearCalendarCache, fetchCalendarEvents, localTimestamp } from "./ha-calendar";

describe("fetchCalendarEvents", () => {
  beforeEach(() => clearCalendarCache());

  // execute_script is admin-only; a non-admin user saw no events (#32).
  it("asks through call_service with return_response, not execute_script", async () => {
    const callWS = vi.fn().mockResolvedValue({
      context: {},
      response: { "calendar.home": { events: [{ start: "2026-11-09", end: "2026-11-10", summary: "Bins" }] } },
    });
    const hass = { callWS, states: {} } as unknown as HomeAssistant;
    const start = new Date(2026, 10, 9);
    const end = new Date(2026, 10, 16);

    const { events, failed } = await fetchCalendarEvents(hass, ["calendar.home"], start, end);

    expect(callWS).toHaveBeenCalledWith({
      type: "call_service",
      domain: "calendar",
      service: "get_events",
      service_data: { start_date_time: localTimestamp(start), end_date_time: localTimestamp(end) },
      target: { entity_id: "calendar.home" },
      return_response: true,
    });
    expect(failed).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ calendarId: "calendar.home", summary: "Bins", allDay: true });
  });

  it("reports a calendar whose call fails instead of failing the card", async () => {
    const hass = { callWS: vi.fn().mockRejectedValue(new Error("unauthorized")), states: {} } as unknown as HomeAssistant;
    const { events, failed } = await fetchCalendarEvents(hass, ["calendar.home"], new Date(), new Date());
    expect(events).toEqual([]);
    expect(failed).toEqual(["calendar.home"]);
  });
});
