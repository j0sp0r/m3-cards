import type { HomeAssistant, M3TodoCardConfig } from "../types";
import type { DropdownMenuItem } from "./dropdown-menu";
import { buildEntityFilterPredicate } from "./entity-filter";
import { isHiddenEntity } from "./ha-registry";

// Which todo list the Todo card shows when it is given several.
//
// `entities` is the set the picker offers. `entity` is the list shown first
// and is added to the picker if the list leaves it out, so the card can never
// sit on a list the picker cannot return to. A single list — `entity` alone,
// or an `entities` of one — means no picker at all, which is exactly how the
// card behaved before the option existed.

/** Where the picked list is remembered in the user's frontend data. */
export const TODO_LIST_CHOICE_KEY = "m3_todo_list_choice";

/** The lists the card offers, in the order configured, without repeats. */
export function todoLists(config: Pick<M3TodoCardConfig, "entity" | "entities"> | undefined): string[] {
  if (!config) return [];
  const listed = (config.entities ?? []).filter((e): e is string => typeof e === "string" && e !== "");
  if (listed.length === 0) return config.entity ? [config.entity] : [];
  return [...new Set(config.entity ? [...listed, config.entity] : listed)];
}

/** What the card needs to know to decide which lists to offer. */
export type TodoListsConfig = Pick<M3TodoCardConfig, "entity" | "entities"> &
  Pick<
    M3TodoCardConfig,
    | "include_area"
    | "exclude_area"
    | "exclude_entities"
    | "include_labels"
    | "exclude_labels"
  >;

const FILTER_KEYS = [
  "include_area",
  "exclude_area",
  "exclude_entities",
  "include_labels",
  "exclude_labels",
] as const;

/** Neither `entity` nor `entities`: the card offers every list it can find. */
export function isTodoDiscovery(config: TodoListsConfig | undefined): boolean {
  return todoLists(config).length === 0;
}

/**
 * Every `todo.*` list, narrowed by the shared include/exclude filter and
 * sorted by name. Read from the states and registries the frontend already
 * holds, so it needs no request and works for users without admin rights.
 *
 * A list the user has hidden is left out, as in the other discovering cards
 * (#33); naming it in `entities` shows it. An area comes from the entity or,
 * failing that, its device; labels come from both.
 */
export function discoverTodoLists(hass: HomeAssistant, filter: TodoListsConfig | undefined): string[] {
  // Only the documented keys count, so an include_entities left in hand-written
  // YAML does not quietly turn discovery into a fixed list.
  const matches = buildEntityFilterPredicate({
    include_area: filter?.include_area,
    exclude_area: filter?.exclude_area,
    include_labels: filter?.include_labels,
    exclude_labels: filter?.exclude_labels,
    exclude_entities: filter?.exclude_entities,
  });
  const entities = hass.entities as
    | Record<string, { area_id?: string | null; device_id?: string | null; labels?: string[] }>
    | undefined;
  const devices = hass.devices as Record<string, { area_id?: string | null; labels?: string[] }> | undefined;
  const nameOf = (id: string) => String(hass.states[id]?.attributes.friendly_name ?? id);

  return Object.keys(hass.states)
    .filter((id) => {
      if (!id.startsWith("todo.")) return false;
      if (isHiddenEntity(hass, id)) return false;
      const entry = entities?.[id];
      const device = entry?.device_id ? devices?.[entry.device_id] : undefined;
      return matches({
        entityId: id,
        areaId: entry?.area_id ?? device?.area_id ?? undefined,
        labels: [...(entry?.labels ?? []), ...(device?.labels ?? [])],
      });
    })
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: "base", numeric: true }));
}

/**
 * The editor's form hands back an emptied list as `[]` and a cleared entity as
 * an empty string. Neither belongs in the YAML: drop the key. Anything else
 * comes back untouched.
 */
export function dropEmptyLists<T extends object>(config: T): T {
  const out = { ...config } as Record<string, unknown>;
  let changed = false;
  for (const key of ["entities", ...FILTER_KEYS]) {
    if (Array.isArray(out[key]) && (out[key] as unknown[]).length === 0) {
      delete out[key];
      changed = true;
    }
  }
  if (out.entity === "" || out.entity === null) {
    delete out.entity;
    changed = true;
  }
  return changed ? (out as T) : config;
}

/**
 * The list to show: the user's saved choice if it is still offered, then the
 * configured `entity`, then the first one offered. A list that no longer
 * exists in Home Assistant is skipped in favour of one that does, so a
 * renamed or removed list does not leave the card showing an error with no
 * way to pick another. If none exists, the first candidate is returned so the
 * card can say which entity is missing.
 */
export function resolveActiveList(
  lists: readonly string[],
  chosen: string | undefined,
  preferred: string | undefined,
  hass?: HomeAssistant,
): string | undefined {
  const candidates = [chosen, preferred, ...lists].filter(
    (e, i, all): e is string => !!e && lists.includes(e) && all.indexOf(e) === i,
  );
  const present = hass ? candidates.find((e) => hass.states[e]) : undefined;
  return present ?? candidates[0];
}

/**
 * Identifies one picker among all the pickers a user has: two cards offering
 * the same lists share a choice, and changing the offered lists starts a fresh
 * one rather than carrying over a stale answer.
 *
 * A discovering card is identified by its filter and not by what the filter
 * finds today, so a list that appears later does not make the saved pick vanish.
 */
export function todoListChoiceId(config: TodoListsConfig | undefined, lists: readonly string[]): string {
  if (!isTodoDiscovery(config)) return lists.join("|");
  const parts = FILTER_KEYS.flatMap((key) => {
    const values = config?.[key];
    return values?.length ? [`${key}=${[...values].sort().join(",")}`] : [];
  });
  return parts.length ? `*|${parts.join("|")}` : "*";
}

/** The menu entries for the picker: each list's name, the shown one marked. */
export function todoListMenuItems(
  hass: HomeAssistant | undefined,
  lists: readonly string[],
  active: string | undefined,
): DropdownMenuItem[] {
  return lists.map((entityId) => ({
    value: entityId,
    label: (hass?.states[entityId]?.attributes.friendly_name as string | undefined) ?? entityId,
    selected: entityId === active,
  }));
}
