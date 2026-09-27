---
title: M3 Chip Buttons Card
type: m3-chip-buttons-card
category: light
display: Chip Buttons
summary: A row of compact entity pills, each with its own actions
table_order: 5
section_order: 37
---

A horizontal row of tappable pill-shaped chips — one per entity — with
tap/hold/double-tap actions. This is the M3 answer to Bubble Card's
"sub-buttons only" card: same core idea (a row of icon chips), but flatter
configuration — one form per chip instead of several nested panels, and
explicit Up/Down buttons to reorder instead of a dropdown menu.

A chip can also be non-interactive (`interactive: false`), which turns it
into a read-only info readout (e.g. a temperature or humidity chip) — the M3
equivalent of Bubble Card's separate second row, without a second
positioning system to configure.

<img src="docs/images/chip-buttons-card.png" alt="Chip Buttons Card" width="700">

<details>
<summary>Configuration, examples & options</summary>

```yaml
type: custom:m3-chip-buttons-card
wrap: false
justify: start
buttons:
  - entity: input_select.home_mode
    name: Home
    icon: mdi:home
    tap_action:
      action: more-info
  - entity: lock.front_door
    name: Front door
    use_entity_color: true
    state_colors:
      unlocked: red
    tap_action:
      action: toggle
    hold_action:
      action: more-info
  - icon: mdi:magnify
    name: Search
    interactive: false
    tap_action:
      action: none
  - entity: sensor.living_room_temperature
    interactive: false
    show_state: true
glass_background: true
radius: 28
```

### Configuration options

| Option | Type | Default | Description |
|---|---|---|---|
| `buttons` | list | `[]` | The chips, in display order. Each entry supports the fields below |
| `buttons[].entity` | string | – (optional) | Any entity. Can be left empty for a pure action/display chip |
| `buttons[].name` | string | entity `friendly_name` | Displayed name |
| `buttons[].icon` | string | entity icon, otherwise a generic icon | Icon |
| `buttons[].show_name` | boolean | `true` | `false` hides the name; the state stays (see `show_state`). With both off the chip is a round icon button |
| `buttons[].color` | string | `primary` | HA color name or any CSS color for the chip in its **active** state. No editor field for this one — set `use_entity_color` and/or `state_colors` instead, or set it via YAML |
| `buttons[].inactive_color` | string | – (default theme grey) | Color for the chip in its **inactive** state. Same as `color`: YAML-only, no editor field |
| `buttons[].use_entity_color` | boolean | `false` | Color the chip from the entity's own HA state color instead of `color`/`inactive_color` |
| `buttons[].state_colors` | map | – | Per-state color overrides (e.g. `unlocked: red`), applied on top of `color`/`use_entity_color` for that exact state, whether HA counts it as active or not (e.g. `locked: green`) — the reliable way to color a state HA doesn't expose a color variable for |
| `buttons[].show_state` | boolean | `true` | Show the entity state next to the name |
| `buttons[].static_color` | boolean | `false` | Always render the chip as "active", regardless of the entity's actual state (e.g. for a status chip that should always stand out) |
| `buttons[].interactive` | boolean | `true` | `false` turns the chip into a read-only display — no tap/hold handlers, not keyboard-focusable |
| `buttons[].tap_action` | Action | depends on the domain | Tap action, same action picker as every other card. Left out, a script starts, a button or scene is pressed, a switch or light toggles, and anything else opens more-info. |
| `buttons[].hold_action` | Action | `none` | Long-press action |
| `buttons[].double_tap_action` | Action | `none` | Double-tap action |
| `stretch` | `false` \| `true` \| `smart` | `false` | Fill the row's full width. `true` gives every chip the same width; `smart` sizes each chip to its content and shares out only the leftover space; when the row is too narrow, short chips keep their full width and only the long ones give up room (their label then scrolls). Round icon chips keep their size. Ignores `wrap` and `justify` |
| `wrap` | boolean | `false` | Wrap chips onto multiple lines instead of scrolling horizontally |
| `justify` | `start` \| `center` \| `end` \| `space-between` | `start` | Horizontal alignment of the chip row |
| `radius` | number (px) | `28` | Card corner radius |
| `corners` | object | – | Optional per-corner override, same as every other card |
| `glass_background` | boolean | `true` | Frosted glass background |
| `card_background` | string | – | Override background color |
| `animation` | `auto` \| `on` \| `off` | `auto` | Press animation; `auto` respects `prefers-reduced-motion` |

</details>
