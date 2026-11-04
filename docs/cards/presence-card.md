---
title: M3 Presence Card
type: m3-presence-card
category: presence
display: Presence
summary: Who's home — avatar grid for `person`/`device_tracker`
table_order: 0
section_order: 15
---

A presence overview as an avatar grid for `person` and `device_tracker`
entities, with a status ring (home/away/zone/unknown), an initials avatar,
a relative time label ("since 5 min"), and an optional embedded map
(`hui-map-card`).

<img src="docs/images/presence-card.png" alt="Presence Card" width="440">

<details>
<summary>Configuration, examples & options</summary>

```yaml
type: custom:m3-presence-card
auto_discover: true
```

### Compact layout

`layout: compact` drops the header and the avatar grid for one tile per
person, built like a button card one row tall: the avatar in a 44px well, the
name, and one status line — the zone or "away", then how long, else the
distance. The well says the status: filled solid in the person's colour at
home, a tint with a coloured ring elsewhere, the way a button's icon well says
"on". The tiles share the row and wrap when the card is narrow, so two people
fit on one 80px card. With `shape_by_state: true` a tile and its well square
off while the person is home.

```yaml
type: custom:m3-presence-card
layout: compact
```

Actions, popups, sorting, colours and `show_map` work as in the grid; `name`
and `icon` have no header to go in.

### Entity source

- **`auto_discover: true`** (default): automatically finds every `person`
  entity, optionally filtered via `include_area` / `include_label` /
  `exclude_entities`.
- **`auto_discover: false`**: only the selection explicitly listed in
  `entities` (`person.*` or `device_tracker.*`).

### Interaction

Tapping a person opens their more-info dialog; a long press (500ms)
optionally triggers `hold_action` (e.g. navigating to a dashboard view).

`tap_action` replaces the more-info on a tap with any standard Home Assistant
action — `navigate`, `url`, `perform-action`, `toggle`, `more-info`, or `none`.
Like `hold_action` it is card-level, one setting for the whole grid, and the
person actually tapped is the target: `more-info`, `toggle` and a service call
that names no target of its own all land on that person's `entity_id`.

```yaml
type: custom:m3-presence-card
tap_action:
  action: navigate
  navigation_path: /lovelace/people
hold_action:
  action: more-info
```

Leaving `tap_action` unset keeps the more-info dialog a tap has always opened.

A service that takes no `entity_id` needs an empty `target` to say so —
otherwise the tapped person is passed along and the service call fails:

```yaml
hold_action:
  action: perform-action
  perform_action: persistent_notification.create
  target: {}
  data:
    message: Someone held a tile
```

### Per-person popups

`tap_action` is one setting for the whole grid, so it cannot give two people
two different destinations. `person_popups` can: it maps an `entity_id` to a
popup holding any Lovelace card, and a person listed there opens it on tap.

```yaml
type: custom:m3-presence-card
person_popups:
  person.jane:
    title: Jane            # optional; the person's name is used otherwise
    size: wide             # normal (default) | wide | fullscreen
    content:
      type: vertical-stack
      cards:
        - type: custom:m3-battery-card
          entity: sensor.jane_phone_battery
        - type: map
          entities: [person.jane]
```

It is keyed by entity rather than configured per entry because `entities` is a
plain list of ids — and is not written at all under `auto_discover` — so there
is no per-person object to hang a popup off.

Only the people listed get one. Everyone else keeps the more-info a tap has
always opened, so adding a popup for one person changes nothing for the rest,
and no `tap_action` is needed to switch it on. An explicit `tap_action` still
wins over the default, which is how the popup goes on the long press instead:

```yaml
tap_action:
  action: more-info
hold_action:
  action: popup
```

`[[entity_id]]` and `[[name]]` anywhere in `content` are replaced with the
tapped person's — the same placeholder syntax the other cards' popups use, and
deliberately distinct from card-mod's `[[[ ]]]` and Jinja's `{{ }}` so the
three do not collide. That means the same body can be repeated for everyone
without rewriting the entity into it each time:

```yaml
person_popups:
  person.jane:
    content:
      type: markdown
      content: "[[name]] is {{ states('[[entity_id]]') }}"
```

A person named in `person_popups` who is not on the card is simply never
tapped, and an `action: popup` on someone with no popup configured falls back
to their more-info rather than opening an empty dialog.


### Configuration options

| Option | Type | Default | Description |
|---|---|---|---|
| `auto_discover` | boolean | `true` | Automatic discovery of all `person` entities |
| `entities` | list\<string\> | – | Manual selection when `auto_discover: false` |
| `include_area` / `include_label` | list\<string\> | – | Filter for auto-discovery |
| `exclude_entities` | list\<string\> | – | Entities excluded from auto-discovery |
| `name` / `icon` | string | "Presence" / `mdi:account-group` | Header |
| `show_distance` | boolean | `false` | Distance to the home zone (if available) |
| `show_since` | boolean | `true` | Relative time since the last state change |
| `show_map` | boolean | `false` | Embedded map below the avatar grid |
| `layout` | `grid` \| `compact` | `grid` | `grid`: header and avatar grid. `compact`: one pill per person, no header |
| `shape_by_state` | boolean | `false` | The shape says who is home, as on the button card: at home the avatar is a rounded square (and the pill squarer in `compact`), away it is round. Animated |
| `sort` | `home_first` \| `name` | `home_first` | Sort order: home first or alphabetical |
| `home_color` / `not_home_color` / `zone_color` / `unknown_color` | string | green/blue/purple/gray | Status ring colors |
| `zone_colors` | object (zone name → color) | – | Override per named zone |
| `tap_action` | action object | more-info | Action on a tap on an avatar, targeting that person. Unset, a tap opens their more-info — or their `person_popups` entry, if they have one. Adds a `popup` action kind |
| `hold_action` | action object | – | Action on a long press (500ms) on an avatar, targeting that person |
| `person_popups` | object (`entity_id` → popup) | – | Per-person popup: `title`, `size` (`normal`/`wide`/`fullscreen`) and a `content` card. Listed people open theirs on tap |
| `text_color` / `secondary_text_color` | string | theme default | Names vs. status line |
| `card_background` | string | glass/solid background | Card background |
| `animation` | `auto` \| `on` \| `off` | `auto` | Status-change animation; `auto`/`on` respect `prefers-reduced-motion` |
| `glass_background` | boolean | `true` | Frosted glass background |
| `radius` / `corners` | number / object | `28` | Corner radius, optional per corner |

</details>
