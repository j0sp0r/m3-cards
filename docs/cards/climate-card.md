---
title: M3 Climate Card
type: m3-climate-card
category: climate
display: Climate
summary: Full control for a `climate` entity (AC / thermostat)
table_order: 0
section_order: 0
---

Add the card via the dashboard editor (search for "M3 Climate Card") or via
YAML:

<img src="docs/images/climate-card.png" alt="Climate Card" width="440">
<img src="docs/images/climate-card-heating.png" alt="Climate Card (heating thermostat)" width="440">

<details>
<summary>Configuration, examples & options</summary>

```yaml
type: custom:m3-climate-card
entity: climate.living_room
name: Living Room
style: tiles # tiles | expressive
show_presets: true
preset_style: chip # chip | pill
show_sensors: true
temperature_chip_placement: info_row # info_row | header
temperature_sensor: sensor.living_room_temperature
humidity_sensor: sensor.living_room_humidity
window_sensor: binary_sensor.living_room_window
battery_sensor: sensor.thermostat_battery
battery_threshold: 20
glass_background: true
hidden_modes: []
height: 380
mode_colors:
  heat: "#e57368"
  cool: "#6ba7dc"
```

### Auto (heat/cool): a band, not one number

A thermostat in `heat_cool` — "Auto" on an Ecobee, and on most American
systems — does not hold one setpoint. It holds two: `target_temp_low`, the
temperature it heats up to, and `target_temp_high`, the one it starts cooling
above. In that mode there is no `temperature` attribute at all.

The card therefore reads the attributes, not the mode, and draws what is
actually there. A single setpoint gets the one stepper row it always had. A
band gets two of the same row stacked at the bottom of the card, labelled
"Heat to" and "Cool above", each with its own minus and plus. Nothing needs
to be configured — an entity that switches between `heat` and `heat_cool`
switches control with it.

Two rows rather than one slider with two handles: the card's target has
always been a large reading with a minus and a plus either side of it, and a
drag track would be a second idiom for the same job. On a six-column tile two
handles also sit close enough together to fight each other's touch targets.

The two bounds can neither cross nor meet — a thermostat asked to heat to 21
and cool above 21 is being asked to do both at once — so each one stops one
step short of the other. Every adjustment sends **both** bounds to
`climate.set_temperature`, even the one that did not move: several
integrations treat an omitted bound as "no opinion" and reset it to whatever
they had. If the entity reports only one of the two, both rows go inert
rather than guess at the other.

Earlier versions fell back to `target_temp_high` and presented it as if it
were a single setpoint — worse than showing nothing, because the plus and
minus then moved only the cooling bound while the label claimed it was the
target temperature (issue #22).

### The `expressive` style

<img src="docs/images/climate-card-expressive.png" alt="Climate Card: tiles vs expressive style (light theme)" width="640">
<img src="docs/images/climate-card-expressive-dark.png" alt="Climate Card: tiles vs expressive style (dark theme)" width="640">

`style: expressive` re-draws the same card around Material 3 Expressive:
instead of a row of mode pills over a sensor row and a stepper, the
**current** temperature becomes one dominant, heavy figure, the setpoint is a
single connected control, and the mode/preset controls morph their shape by
state.

```yaml
type: custom:m3-climate-card
entity: climate.living_room
style: expressive
```

What changes:

- **The current temperature is the card.** One large, heavy, tightly tracked
  figure with the humidity beside it. It stays theme ink and never takes the
  mode colour — the card says "it is 21.4°" first and "it is set to heat"
  second.
- **The setpoint becomes one connected control** — round on the outside,
  square on the inside — instead of a floating pill between two circular
  buttons: a single segmented row where the value takes the full width
  between the ± buttons. A band thermostat (`heat_cool`) gets two of these
  stacked, the same way the `tiles` style stacks its two stepper rows.
- **The mode row collapses into one mode button** that opens the shared
  dropdown menu. With only two modes left (say `off` and `auto`, or after
  `hidden_modes`) a tap just flips straight to the other one, since a menu for
  a binary switch is ceremony. The preset button moves up beside it into one
  control row, and both buttons morph their corner radius on press or while
  their dropdown is open — shape carrying state, the Expressive move this
  style leans on most.
- **A heat/cool frame around the card** reports the equipment, at two
  strengths — see below.

Everything else behaves the same: the same entity, the same sensors, the same
`mode_colors`, the same corner radius and glass background options.

#### The heat/cool frame

The frame has two strengths rather than one. Full while the entity's
`hvac_action` reports `heating`/`cooling`; dimmed while heat or cool is the
selected mode but the equipment is idle.

The second level is not cosmetic. Many integrations derive `hvac_action` from
the physical valve, so a Homematic eTRV reports `idle` for an entire summer
even with the mode set to heat — a frame that only ever lit on `heating` was
invisible on that hardware. Entities that expose no `hvac_action` at all keep
the full frame from their mode alone, so they do not sit permanently dimmed on
no evidence.

Set `show_action_glow: false` to turn the frame off entirely.

### Folding a room away

`collapsible: true` puts a chevron in the header and folds the card down to
that header when it is tapped. The subtitle stays — "occupied · 3 devices on"
is exactly what a folded room still needs to say, and a fold that hid it would
turn the card into a label.

The state persists per browser, or across devices in an `input_boolean` via
`collapse_state_entity` — which also lets an automation fold the guest room
away while nobody is in it.

```yaml
type: custom:m3-room-card
area: guest_room
collapsible: true
default_collapsed: true
```

Setting a header `tap_action` hands the header to that action and hides the
chevron, since the header no longer folds anything — see "Tapping the header".

### Configuration options

| Option | Type | Default | Description |
|---|---|---|---|
| `entity` | string | **Required** | `climate.*` entity |
| `style` | `tiles` \| `expressive` | `tiles` | Visual language: `tiles` is the mode-pill row over a sensor row and stepper; `expressive` makes the current temperature the card's dominant figure with a single connected setpoint control, a single mode button and a heat/cool frame. See [The `expressive` style](#the-expressive-style) |
| `name` | string | entity `friendly_name` | Displayed name |
| `icon` | string | `mdi:radiator` (heating only) / `mdi:air-conditioner` | Header icon |
| `show_header_status` | boolean | `true` | Show the mode line under the card name in the header |
| `show_control_labels` | boolean | `true` | `style: expressive` only — text labels on the mode and preset buttons; `false` leaves both as icon-only circles |
| `show_action_glow` | boolean | `true` | `style: expressive` only — the heat/cool frame around the card |
| `show_presets` | boolean | `true` | Show preset selector (if the entity supports `preset_modes`) |
| `preset_style` | `chip` \| `pill` | `chip` | Preset as its own wide row (`chip`) or as an extra pill in the mode row (`pill`) |
| `show_sensors` | boolean | `true` | Show sensor chips (temperature/humidity) |
| `temperature_chip_placement` | `info_row` \| `header` | `info_row` | Current temperature in the sensor row or as a chip top-right in the header |
| `temperature_sensor` | string | – | External temperature sensor, overrides `current_temperature` |
| `humidity_sensor` | string | – | External humidity sensor, overrides `current_humidity` |
| `window_sensor` | string | – | `binary_sensor`, shows an "Open" chip when `state: "on"` |
| `battery_sensor` | string | – | Sensor for battery level |
| `battery_threshold` | number | `20` | Threshold (%) below which the battery chip appears |
| `hidden_modes` | string[] | `[]` | HVAC modes that are hidden as a pill despite entity support |
| `glass_background` | boolean | `true` | Frosted glass background (off for solid themes) |
| `animations` | boolean | `true` | Shape-morph/press animations; `false` disables all transitions |
| `unavailable_style` | `dimmed` \| `normal` \| `hidden` | `dimmed` | Display when the entity is `unavailable`/`unknown`: `dimmed` (greyed out, not tappable, as before), `normal` (normal display, mode pills/stepper stay tappable), or `hidden` (card is fully hidden) |
| `height` | number (px) | – (automatic) | Fixed minimum card height. See [Equal-height tiles](#equal-height-tiles) |
| `radius` | number (px) | `32` | Card corner radius (editor offers Square/Slightly rounded/Round/Custom) |
| `corners` | object | – | Optional per-corner override: `top_left`, `top_right`, `bottom_right`, `bottom_left` (px) — for asymmetric Material 3 Expressive shapes, only overrides `radius` for the given corners |
| `mode_colors` | object | see below | Color override per HVAC mode. The editor shows a text field + color swatch; accepts hex/CSS **or** HA color names, same as the button card's `color` |
| `icon_active_color` | string | `var(--primary-color)` | Header icon color when active (not "off") |
| `icon_inactive_color` | string | `var(--primary-color)` | Header icon color in the "off" state |
| `plus_active_color` | string | current mode's color | Plus button color when active |
| `plus_inactive_color` | string | `mode_colors.off` | Plus button color in the "off" state |
| `minus_active_color` | string | `var(--primary-text-color)` | Minus button color when active |
| `minus_inactive_color` | string | `var(--primary-text-color)` | Minus button color in the "off" state |

Without any explicit setting, the icon stays in the theme accent color
(`--primary-color`) as before; minus stays neutral. `icon_active_color` /
`icon_inactive_color` / `plus_active_color` / `plus_inactive_color` /
`minus_active_color` / `minus_inactive_color` allow a fully independent
color per element and state ("off" vs. active).

#### Default mode colors

| Mode | Color |
|---|---|
| `off` | `#9e9e9e` |
| `heat` | `#e57368` |
| `cool` | `#6ba7dc` |
| `dry` | `#5dcaa5` |
| `auto` | `#5dcaa5` |
| `fan_only` | `#b8c4c9` |
| `heat_cool` | `#e5a768` |

### Equal-height tiles

HA's native masonry dashboard does **not** automatically equalize the
height of cards next to each other — every column grows independently
based on its own content. Two options:

1. **Use `horizontal-stack`** (recommended, no manual value needed): cards
   in a `horizontal-stack` are automatically stretched by Home Assistant
   via flexbox to the height of the tallest card — the M3 cards fill that
   height completely (including the stepper, which docks to the bottom):
   ```yaml
   type: horizontal-stack
   cards:
     - type: custom:m3-climate-card
       entity: climate.ac
     - type: custom:m3-climate-card
       entity: climate.living_room
   ```
2. **Set `height` manually**: if no `horizontal-stack` is used, a fixed
   pixel value (`height: 380`) can be set per card.

</details>
