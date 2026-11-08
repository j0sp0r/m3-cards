import type { HomeAssistant } from "../types";

// Home Assistant exposes a todo list's entries only through the
// `todo.get_items` service response, never as entity attributes — the entity
// state is just the number of open items. hass.callService drops the response,
// so the call goes over the websocket's `call_service` with `return_response`.
// Not `execute_script`: that one is admin-only, and a non-admin user got an
// empty list (#32).

export type TodoStatus = "needs_action" | "completed";

export interface TodoItem {
  uid: string;
  summary: string;
  status: TodoStatus;
  description?: string;
  due?: string;
}

// Bit flags from homeassistant/components/todo/const.py.
export const TODO_FEATURE = {
  create: 1,
  delete: 2,
  update: 4,
  move: 8,
  dueDate: 16,
  dueDatetime: 32,
  description: 64,
} as const;

export function todoSupports(
  hass: HomeAssistant | undefined,
  entityId: string,
  feature: number,
): boolean {
  const bits = hass?.states[entityId]?.attributes?.supported_features;
  return typeof bits === "number" && (bits & feature) !== 0;
}

export async function fetchTodoItems(
  hass: HomeAssistant,
  entityId: string,
  status?: TodoStatus[],
): Promise<TodoItem[]> {
  const result = await hass.callWS<{ response?: Record<string, { items?: TodoItem[] }> }>({
    type: "call_service",
    domain: "todo",
    service: "get_items",
    service_data: status?.length ? { status } : {},
    target: { entity_id: entityId },
    return_response: true,
  });
  const payload = result?.response;
  return payload?.[entityId]?.items ?? [];
}
