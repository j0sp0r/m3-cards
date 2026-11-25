import { describe, expect, it } from "vitest";
import type { HomeAssistant } from "../types";
import {
  dropEmptyEntities,
  resolveActiveList,
  todoListChoiceId,
  todoListMenuItems,
  todoLists,
} from "./todo-lists";

const hassWith = (states: Record<string, { friendly_name?: string }>) =>
  ({
    states: Object.fromEntries(
      Object.entries(states).map(([id, attributes]) => [id, { entity_id: id, state: "0", attributes }]),
    ),
  }) as unknown as HomeAssistant;

describe("todoLists", () => {
  it("is a single list for a plain entity, which means no picker", () => {
    expect(todoLists({ entity: "todo.shopping" })).toEqual(["todo.shopping"]);
  });

  it("offers the entities in the order configured", () => {
    expect(todoLists({ entities: ["todo.b", "todo.a", "todo.c"] })).toEqual(["todo.b", "todo.a", "todo.c"]);
  });

  it("adds the entity to the picker when the list leaves it out", () => {
    expect(todoLists({ entity: "todo.inbox", entities: ["todo.b", "todo.a"] })).toEqual([
      "todo.b",
      "todo.a",
      "todo.inbox",
    ]);
  });

  it("does not repeat a list", () => {
    expect(todoLists({ entity: "todo.a", entities: ["todo.a", "todo.b", "todo.a"] })).toEqual(["todo.a", "todo.b"]);
  });

  it("ignores empty and non-string entries from a hand-written config", () => {
    const config = { entities: ["todo.a", "", null, 7, "todo.b"] } as unknown as { entities: string[] };
    expect(todoLists(config)).toEqual(["todo.a", "todo.b"]);
  });

  it("is empty when nothing is configured", () => {
    expect(todoLists({})).toEqual([]);
    expect(todoLists({ entities: [] })).toEqual([]);
    expect(todoLists(undefined)).toEqual([]);
  });
});

describe("resolveActiveList", () => {
  const lists = ["todo.a", "todo.b", "todo.c"];
  const hass = hassWith({ "todo.a": {}, "todo.b": {}, "todo.c": {} });

  it("prefers the saved choice", () => {
    expect(resolveActiveList(lists, "todo.c", "todo.a", hass)).toBe("todo.c");
  });

  it("falls back to the configured entity when nothing was saved", () => {
    expect(resolveActiveList(lists, undefined, "todo.b", hass)).toBe("todo.b");
  });

  it("falls back to the first list when neither is set", () => {
    expect(resolveActiveList(lists, undefined, undefined, hass)).toBe("todo.a");
  });

  it("ignores a saved choice that is no longer offered", () => {
    expect(resolveActiveList(lists, "todo.gone", "todo.b", hass)).toBe("todo.b");
  });

  it("skips a list that no longer exists in Home Assistant", () => {
    const partial = hassWith({ "todo.b": {}, "todo.c": {} });
    expect(resolveActiveList(lists, "todo.a", "todo.a", partial)).toBe("todo.b");
  });

  it("names the first candidate when none exists, so the card can say what is missing", () => {
    expect(resolveActiveList(lists, "todo.b", undefined, hassWith({}))).toBe("todo.b");
  });

  it("works before hass has arrived", () => {
    expect(resolveActiveList(lists, undefined, "todo.c", undefined)).toBe("todo.c");
  });

  it("is undefined when no list is offered", () => {
    expect(resolveActiveList([], "todo.a", "todo.a", hass)).toBeUndefined();
  });
});

describe("dropEmptyEntities", () => {
  it("removes an emptied list, so the YAML does not keep `entities: []`", () => {
    expect(dropEmptyEntities({ entity: "todo.a", entities: [] })).toEqual({ entity: "todo.a" });
  });

  it("keeps a list that has entries, and returns the same object", () => {
    const config = { entity: "todo.a", entities: ["todo.b"] };
    expect(dropEmptyEntities(config)).toBe(config);
  });

  it("leaves a config without the key alone", () => {
    const config = { entity: "todo.a" };
    expect(dropEmptyEntities(config)).toBe(config);
  });
});

describe("todoListChoiceId", () => {
  it("is stable for the same lists and different when the lists change", () => {
    expect(todoListChoiceId(["todo.a", "todo.b"])).toBe(todoListChoiceId(["todo.a", "todo.b"]));
    expect(todoListChoiceId(["todo.a", "todo.b"])).not.toBe(todoListChoiceId(["todo.a", "todo.c"]));
  });
});

describe("todoListMenuItems", () => {
  it("labels each list with its name and marks the one shown", () => {
    const hass = hassWith({ "todo.a": { friendly_name: "Bills" }, "todo.b": { friendly_name: "Inbox" } });
    expect(todoListMenuItems(hass, ["todo.a", "todo.b"], "todo.b")).toEqual([
      { value: "todo.a", label: "Bills", selected: false },
      { value: "todo.b", label: "Inbox", selected: true },
    ]);
  });

  it("falls back to the entity id for a list without a name or that is missing", () => {
    const hass = hassWith({ "todo.a": {} });
    expect(todoListMenuItems(hass, ["todo.a", "todo.x"], undefined).map((i) => i.label)).toEqual([
      "todo.a",
      "todo.x",
    ]);
  });
});
