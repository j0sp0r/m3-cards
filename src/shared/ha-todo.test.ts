import { describe, expect, it, vi } from "vitest";
import type { HomeAssistant } from "../types";
import { fetchTodoItems } from "./ha-todo";

const hassWith = (response: unknown) =>
  ({ callWS: vi.fn().mockResolvedValue(response), states: {} }) as unknown as HomeAssistant & {
    callWS: ReturnType<typeof vi.fn>;
  };

describe("fetchTodoItems", () => {
  // execute_script is admin-only; a non-admin user got nothing back (#32).
  it("asks through call_service with return_response, not execute_script", async () => {
    const hass = hassWith({ context: {}, response: { "todo.shopping": { items: [] } } });
    await fetchTodoItems(hass, "todo.shopping", ["needs_action"]);
    expect(hass.callWS).toHaveBeenCalledWith({
      type: "call_service",
      domain: "todo",
      service: "get_items",
      service_data: { status: ["needs_action"] },
      target: { entity_id: "todo.shopping" },
      return_response: true,
    });
  });

  it("sends no status filter when none is asked for", async () => {
    const hass = hassWith({ response: {} });
    await fetchTodoItems(hass, "todo.shopping");
    expect(hass.callWS.mock.calls[0][0].service_data).toEqual({});
  });

  it("returns the list's items, or none when the list is missing", async () => {
    const items = [{ uid: "1", summary: "Milk", status: "needs_action" }];
    expect(await fetchTodoItems(hassWith({ response: { "todo.shopping": { items } } }), "todo.shopping")).toEqual(items);
    expect(await fetchTodoItems(hassWith({ response: {} }), "todo.shopping")).toEqual([]);
  });
});
