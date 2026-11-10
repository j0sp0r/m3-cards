---
title: M3 Cover Card
type: m3-cover-card
category: light
display: Cover
summary: Blinds/shutters that adapt to the device's capabilities, plus a group mode
table_order: 3
section_order: 24
---

Control for `cover` entities that adapts to the device: it reads
`supported_features` and only renders the controls the entity actually
supports — open/stop/close buttons, a position slider with a window preview,
and tilt controls. Devices without a `cover` integration (e.g. a FingerBot on
two switches) work via `entity_type: switch_pair`. A `group` mode puts several
covers — or switch pairs — in one card with shared master controls.

<img src="docs/images/cover-card.png" alt="Cover Card" width="440">

<details>
<summary>Configuration, examples & options</summary>

```yaml
# Single cover
type: custom:m3-cover-card
entity: cover.living_room

# A switch pair (up/down relays, e.g. a FingerBot)
# type: custom:m3-cover-card
# entity_type: switch_pair
# up_entity: switch.blind_up
# down_entity: switch.blind_down

# Group
# type: custom:m3-cover-card
# mode: group
# entities:
#   - cover.living_room
#   - { entity_type: switch_pair, up_entity: switch.kitchen_up, down_entity: switch.kitchen_down, name: Kitchen }
```

### Configuration options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `mode` | `single` \| `group` | `single` | One cover in detail, or a list |
| `entity` | string | – | The cover (single mode) |
| `entity_type` | `cover` \| `switch_pair` | `cover` | Use up/down/stop switches instead of a cover |
| `up_entity` / `down_entity` / `stop_entity` | string | – | Switches for `switch_pair` |
| `entities` | list | – | Group rows: a cover id or a `switch_pair` object |
| `show_preview` | boolean | `true` | Window preview with fill level |
| `preview_style` | `auto` \| `shutter` \| `curtain` \| `curtain_split` | `auto` | How the preview draws the cover: `auto` by device class (a curtain from the side, everything else from the top), `shutter` from the top, `curtain` from one side, `curtain_split` two halves meeting in the middle. A curtain style also gives the curtain icon, and the open, stop and close buttons side by side, pointing to the side (`curtain`) or apart and together (`curtain_split`) |
| `device_class` | string | the entity's | Overrides the device class, which decides the wording and the default icon |
| `button_layout` | `auto` \| `stacked` \| `side` | `auto` | Open, stop and close above each other or side by side; `auto` puts them side by side with a curtain preview and stacks them otherwise |
| `slider_style` | `plain` \| `wavy` | `plain` | Position slider style |
| `invert_position` | boolean | `false` | For integrations with reversed position |
| `shape_by_state` | boolean | `false` | The header icon is a circle while closed and a rounded square while open (any position above 0); a group counts as open when one cover is |
| `tilt_step` | number | `15` | Tilt stepper size (°) |
| `travel_time` | number | `0` | Seconds end-to-end for position-less devices (optimistic feedback) |
| `show_master` | boolean | `true` | Master controls in group mode |
| `row_tap_action` | `more-info` \| `toggle` | `more-info` | Tap on a group row |

> **No cover integration?** A Home Assistant template cover can bundle two
> switches into one `cover` entity, unlocking the position/preview features.

</details>
