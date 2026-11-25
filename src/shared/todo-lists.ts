import type { HomeAssistant, M3TodoCardConfig } from "../types";
import type { DropdownMenuItem } from "./dropdown-menu";

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

/**
 * An emptied picker list is no list at all: drop the key instead of keeping an
 * `entities: []` in the YAML. Anything else comes back untouched.
 */
export function dropEmptyEntities<T extends Pick<M3TodoCardConfig, "entity" | "entities">>(config: T): T {
  if (!Array.isArray(config.entities) || config.entities.length > 0) return config;
  const { entities: _removed, ...rest } = config;
  return rest as T;
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
 * Identifies one picker among all the pickers a user has, by the lists it
 * offers: two cards offering the same lists share a choice, and changing the
 * offered lists starts a fresh one rather than carrying over a stale answer.
 */
export function todoListChoiceId(lists: readonly string[]): string {
  return lists.join("|");
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
