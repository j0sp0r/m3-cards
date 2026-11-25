import { describe, expect, it } from "vitest";
import type { HomeAssistant } from "../types";
import {
  type TodoListsConfig,
  discoverTodoLists,
  dropEmptyLists,
  isTodoDiscovery,
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

describe("isTodoDiscovery", () => {
  it("is on only when neither entity nor entities names a list", () => {
    expect(isTodoDiscovery({})).toBe(true);
    expect(isTodoDiscovery({ entities: [] })).toBe(true);
    expect(isTodoDiscovery({ entity: "" })).toBe(true);
    expect(isTodoDiscovery(undefined)).toBe(true);
    expect(isTodoDiscovery({ entity: "todo.a" })).toBe(false);
    expect(isTodoDiscovery({ entities: ["todo.a"] })).toBe(false);
  });
});

// A hass with the pieces discovery reads: names, the registry entries, devices.
interface Entry {
  area_id?: string | null;
  device_id?: string | null;
  labels?: string[];
  hidden?: boolean;
  hidden_by?: string | null;
}
const discoveryHass = (
  names: Record<string, string | undefined>,
  entities?: Record<string, Entry>,
  devices?: Record<string, { area_id?: string | null; labels?: string[] }>,
) =>
  ({
    states: Object.fromEntries(
      Object.entries(names).map(([id, name]) => [
        id,
        { entity_id: id, state: "0", attributes: name ? { friendly_name: name } : {} },
      ]),
    ),
    entities,
    devices,
  }) as unknown as HomeAssistant;

describe("discoverTodoLists", () => {
  const names = {
    "todo.inbox": "Inbox",
    "todo.bills": "bills",
    "todo.chores": "Chores",
    "light.kitchen": "Kitchen",
    "sensor.count": "Count",
  };

  it("finds every todo list and nothing else, sorted by name regardless of case", () => {
    expect(discoverTodoLists(discoveryHass(names), {})).toEqual(["todo.bills", "todo.chores", "todo.inbox"]);
  });

  it("sorts a list without a name by its entity id", () => {
    const hass = discoveryHass({ "todo.zeta": undefined, "todo.alpha": "Alpha" });
    expect(discoverTodoLists(hass, {})).toEqual(["todo.alpha", "todo.zeta"]);
  });

  it("works for a frontend without the registries", () => {
    expect(discoverTodoLists(discoveryHass(names, undefined, undefined), undefined)).toHaveLength(3);
  });

  it("leaves out a list the user has hidden, as the other discovering cards do", () => {
    const hass = discoveryHass(names, {
      "todo.inbox": { hidden: true },
      "todo.chores": { hidden_by: "user" },
    });
    expect(discoverTodoLists(hass, {})).toEqual(["todo.bills"]);
  });

  it("removes the lists exclude_entities names", () => {
    const hass = discoveryHass(names);
    expect(discoverTodoLists(hass, { exclude_entities: ["todo.chores", "todo.inbox"] })).toEqual(["todo.bills"]);
  });

  it("ignores an include_entities left in hand-written YAML, so discovery stays discovery", () => {
    const stray = { include_entities: ["todo.chores"] } as unknown as TodoListsConfig;
    expect(discoverTodoLists(discoveryHass(names), stray)).toEqual(["todo.bills", "todo.chores", "todo.inbox"]);
  });

  it("reads labels from the entity and from its device", () => {
    const hass = discoveryHass(
      names,
      {
        "todo.inbox": { labels: ["projects"] },
        "todo.bills": { device_id: "dev1" },
        "todo.chores": { labels: ["home"] },
      },
      { dev1: { labels: ["projects"] } },
    );
    expect(discoverTodoLists(hass, { include_labels: ["projects"] })).toEqual(["todo.bills", "todo.inbox"]);
    expect(discoverTodoLists(hass, { exclude_labels: ["projects"] })).toEqual(["todo.chores"]);
  });

  it("takes the area from the entity, or from its device when the entity has none", () => {
    const hass = discoveryHass(
      names,
      {
        "todo.inbox": { area_id: "office" },
        "todo.bills": { device_id: "dev1" },
        "todo.chores": { area_id: "kitchen", device_id: "dev1" },
      },
      { dev1: { area_id: "office" } },
    );
    expect(discoverTodoLists(hass, { include_area: ["office"] })).toEqual(["todo.bills", "todo.inbox"]);
    expect(discoverTodoLists(hass, { exclude_area: ["kitchen"] })).toEqual(["todo.bills", "todo.inbox"]);
  });

  it("finds nothing for a label filter when there is no registry to read labels from", () => {
    expect(discoverTodoLists(discoveryHass(names), { include_labels: ["projects"] })).toEqual([]);
  });
});

describe("dropEmptyLists", () => {
  it("removes an emptied list and the emptied filters, so the YAML does not keep `[]`", () => {
    expect(
      dropEmptyLists({ entity: "todo.a", entities: [], include_labels: [], exclude_entities: ["todo.b"] }),
    ).toEqual({ entity: "todo.a", exclude_entities: ["todo.b"] });
  });

  it("removes a cleared entity", () => {
    expect(dropEmptyLists({ entity: "", include_area: ["office"] })).toEqual({ include_area: ["office"] });
  });

  it("keeps lists that have entries, and returns the same object", () => {
    const config = { entity: "todo.a", entities: ["todo.b"] };
    expect(dropEmptyLists(config)).toBe(config);
  });

  it("leaves a config with nothing to drop alone", () => {
    const config = { entity: "todo.a", name: "x" };
    expect(dropEmptyLists(config)).toBe(config);
  });
});

describe("todoListChoiceId", () => {
  it("for named lists is stable for the same lists and different when they change", () => {
    const a = { entities: ["todo.a", "todo.b"] };
    const c = { entities: ["todo.a", "todo.c"] };
    expect(todoListChoiceId(a, ["todo.a", "todo.b"])).toBe(todoListChoiceId(a, ["todo.a", "todo.b"]));
    expect(todoListChoiceId(a, ["todo.a", "todo.b"])).not.toBe(todoListChoiceId(c, ["todo.a", "todo.c"]));
  });

  it("for discovery follows the filter, not what it finds, so a new list keeps the saved pick", () => {
    const filter = { include_labels: ["projects"] };
    expect(todoListChoiceId(filter, ["todo.a"])).toBe(todoListChoiceId(filter, ["todo.a", "todo.new"]));
  });

  it("for discovery differs by filter and ignores the order of the values", () => {
    expect(todoListChoiceId({ include_labels: ["b", "a"] }, [])).toBe(todoListChoiceId({ include_labels: ["a", "b"] }, []));
    expect(todoListChoiceId({ include_labels: ["a"] }, [])).not.toBe(todoListChoiceId({ exclude_labels: ["a"] }, []));
    expect(todoListChoiceId({}, ["todo.a"])).toBe("*");
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
