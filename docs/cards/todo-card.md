---
title: M3 Todo Card
type: m3-todo-card
category: household
display: Todo
summary: Shopping and task lists with quick-add chips
table_order: 2
section_order: 22
---

Shopping and task lists in the project's design system, as a replacement for
Home Assistant's built-in `todo-list` card. Add with one line, tick items off
with a tap, and keep completed entries tucked away behind a collapsible
block.

<img src="docs/images/todo-card.png" alt="Todo Card" width="440">

<details>
<summary>Configuration, examples & options</summary>

```yaml
type: custom:m3-todo-card
entity: todo.shopping_list
name: Shopping list
quick_add_mode: supplies
```

You need a to-do list first: **Settings → Devices & services → Add
integration → Local to-do**. Any todo integration works — the card reads
whatever `todo.*` entity you point it at.

### Several lists in one card

Name more than one list under `entities` and the header name becomes a
drop-down, so one card can show whichever list you pick — handy for a
dashboard with many projects.

```yaml
type: custom:m3-todo-card
entities:
  - todo.shopping_list
  - todo.chores
  - todo.projects
```

`entity` is the list shown first, and it is added to the drop-down if
`entities` leaves it out. The pick is remembered per user and follows them from
phone to tablet. Two cards offering the same lists share it. A list that no
longer exists is skipped in favour of one that does. With a single list the card
looks and behaves exactly as before, and a fixed `name` is ignored while the
drop-down is shown, since the header then names the list on screen.

### Every list, filtered

Leave out both `entity` and `entities` and the card offers every `todo.*` list
it can find, sorted by name. Narrow that by area or by label, and take single
lists out with `exclude_entities`. To show only lists you name, use `entities`
instead.

```yaml
type: custom:m3-todo-card
include_labels:
  - projects          # only lists carrying this label
exclude_entities:
  - todo.shopping_list
```

Labels come from the list's own entity and from its device. A list you have
hidden in Home Assistant is left out; name it in `entities` to show it. New
lists show up without reloading the dashboard. The state filters of the other
cards do not apply here: a list's state is just its open count. These options
only matter for discovery; with `entity` or `entities` set the card shows
exactly the lists you named. As with any card, the drop-down appears once two
or more lists are offered; if a filter leaves a single list, the card just shows
that list.

### Quick-add chips

Optional one-tap buttons above the list, filled from one of three sources via
`quick_add_mode`:

| Mode | Chips show |
|---|---|
| `none` (default) | nothing |
| `fixed` | the entries you list in `quick_add` |
| `recent` | entries you completed before |
| `supplies` | the shopping texts from the M3 Supply Cards on this dashboard |

`supplies` is the bridge between the two cards: whatever you set as
`shopping_item` on a supply becomes a chip here, ranked so the supply closest
to running out comes first. Anything already on the list is left out — it
would only trigger the duplicate warning.

### Editing

Tapping a row ticks it off. **Long-press** a row to rename it or delete it.
With `reorderable: true` each row grows a drag handle; dragging reorders the
list through Home Assistant's own ordering, on backends that support it.

`group_by_category: true` groups entries written as `Category: item` under a
small heading, and drops the redundant prefix from the row itself — an entry
stored as "Fruit: apples" reads as "apples" beneath a "Fruit" heading.

| Option | Type | Default | Description |
|---|---|---|---|
| `entity` | string | – | The `todo.*` list, shown first. Leave out with `entities` to pick from several, or with neither to discover every list |
| `entities` | list | – | `todo.*` lists to choose between: the header name becomes a drop-down. `entity` is the one shown first |
| `include_area` / `exclude_area` | list\<string\> | – | Area filter for auto-discovery |
| `include_labels` / `exclude_labels` | list\<string\> | – | Label filter for auto-discovery |
| `exclude_entities` | list\<string\> | – | Lists to leave out of auto-discovery |
| `name` / `icon` | string | entity's own | Header name and icon |
| `add_position` | `top` \| `bottom` | `top` | Where new entries land |
| `prevent_duplicates` | boolean | `true` | Pulse the existing entry instead of adding twice |
| `quick_add_mode` | `none` \| `fixed` \| `recent` \| `supplies` | `none` | Source of the chips |
| `quick_add` | list | – | Chip entries for `fixed` |
| `max_quick_add` | number | `4` | Maximum number of chips |
| `show_completed` | boolean | `true` | Show the completed block |
| `show_clear_completed` | boolean | `true` | Offer "clear completed" |
| `group_by_category` | boolean | `false` | Group by `Category:` prefix |
| `reorderable` | boolean | `false` | Drag handle for reordering |
| `accent_color` | string | `#5dcaa5`; `primary` on a card added from the card picker | Accent for icon, chip and checkmarks |
| `accent_opacity` | number | `18` | Tint strength |
| `text_color` / `secondary_text_color` | string | theme default | Name / secondary text |
| `card_background` | string | glass/solid background | Card background |
| `animation` | `auto` \| `on` \| `off` | `auto` | Morph animations |
| `glass_background` | boolean | `true` | Frosted glass background |
| `radius` / `corners` | number / object | `28` | Corner radius, optional per corner |

</details>
