---
title: M3 Climate Card Mini
type: m3-climate-card-mini
category: climate
display: Climate Mini
summary: Compact climate variant for narrow layouts
table_order: 1
section_order: 1
---

A compact companion card to the full climate card: icon tile + on/off
button on top, name + "current temperature · mode" below that, a
minus/target-temperature/plus stepper at the bottom (two numbers instead of
one when the thermostat holds a heat/cool band). No preset, sensor, or
mode-row support — in exchange, two tiles comfortably fit side by side on a
phone screen.

<img src="docs/images/climate-card-mini.png" alt="Climate Card Mini" width="440">

<details>
<summary>Configuration, examples & options</summary>

```yaml
type: custom:m3-climate-card-mini
entity: climate.bedroom
name: Bedroom
glass_background: true
mode_colors:
  heat: "#e57368"
  cool: "#6ba7dc"
```

### The humidity is off until you ask for it

The status line reads `21,2 °C · Aus`, and with a humidity it reads
`21,2 °C · 59 % · Aus` — the readings first, the mode last, however many
readings there turn out to be.

It stays off until you turn it on, and the switch is in the card's own editor
rather than YAML-only. A card that silently grew a third reading would be a
change to every dashboard using it that nobody asked for.

Where it comes from depends on the thermostat. Most report no
`current_humidity` at all, so point `humidity_sensor` at the room's own sensor
— naming one is itself the request to show it, no second switch needed. For a
thermostat that does report its own humidity, `show_humidity: true` alone is
enough. An unavailable sensor drops the segment rather than printing a dash.

## Configuration options

| Option | Type | Default | Description |
|---|---|---|---|
| `entity` | string | **Required** | `climate.*` entity |
| `name` | string | entity `friendly_name` | Displayed name |
| `icon` | string | `mdi:radiator` (heating only) / `mdi:air-conditioner` | Icon in the icon tile |
| `show_humidity` | boolean | `false` | Add the humidity to the status line, next to the temperature |
| `humidity_sensor` | string | – | Where that humidity comes from. Most thermostats report none of their own, so this is usually the room's sensor. Setting it turns the reading on by itself |
| `glass_background` | boolean | `true` | Frosted glass background (off for solid themes) |
| `animations` | boolean | `true` | Transitions for icon tile/on-off button/stepper; `false` disables them |
| `unavailable_style` | `dimmed` \| `normal` \| `hidden` | `dimmed` | Display when the entity is `unavailable`/`unknown` |
| `radius` | number (px) | `28` | Card corner radius (editor offers Square/Slightly rounded/Round/Custom) |
| `corners` | object | – | Optional per-corner override: `top_left`, `top_right`, `bottom_right`, `bottom_left` (px) |
| `mode_colors` | object | see [default mode colors](#default-mode-colors) | Color override per HVAC mode |
| `icon_active_color` | string | current mode's color | Icon color when heating/cooling is active (not "off") |
| `icon_inactive_color` | string | `mode_colors.off` | Icon color in the "off" state |
| `power_active_color` | string | current mode's color | On/off button color when active |
| `power_inactive_color` | string | `mode_colors.off` | On/off button color in the "off" state |
| `plus_active_color` | string | current mode's color | Plus button color when active |
| `plus_inactive_color` | string | `mode_colors.off` | Plus button color in the "off" state |
| `minus_active_color` | string | `var(--primary-text-color)` | Minus button color when active |
| `minus_inactive_color` | string | `var(--primary-text-color)` | Minus button color in the "off" state |

Icon, on/off button, and plus color follow `mode_colors` by default
(including "off"), so they can already be adjusted just via
`mode_colors.off`; minus stays neutral by default. `icon_active_color` /
`icon_inactive_color` / `power_active_color` / `power_inactive_color` /
`plus_active_color` / `plus_inactive_color` / `minus_active_color` /
`minus_inactive_color` additionally allow a fully independent color per
element and state.

### Auto (heat/cool): two setpoints

A thermostat in heat/cool mode has no single target temperature. It holds a
band — `target_temp_low` and `target_temp_high`, and no `temperature` at all —
so a card that reads `temperature` finds nothing and shows a dash. The card
reads the attributes rather than the mode: whichever a thermostat reports is
what it gets, which also keeps it right for the vendors that leave a band
attribute lying around in a single-setpoint mode.

When there is a band, both numbers are printed side by side where the single
target normally sits: heat-to on the left in the heat colour, cool-above on the
right in the cool one. There is no room for a label at this size, so the colour
is what says which end each number is — and it comes from the same
`mode_colors` as the mode row, so an override there reaches the band too.
Tapping one lights it and aims the minus/plus buttons at it: the lit bound sits
in a filled well of its own colour, the other stays coloured text at the same
size. The fill says which number the buttons move, the colour says which end it
is. One pair of buttons is all a tile this size has room for — a second pair
would halve both numbers, and this card exists to stay readable two-up on a
phone. There is nothing to configure: the band appears because the thermostat
reports one.

The two bounds can neither meet nor cross. Each stops one step short of the
other, since a thermostat told to heat to 21 and cool above 21 is being asked
to do both at once. Every adjustment sends both bounds together, because
`climate.set_temperature` treats an omitted bound as "no opinion" and several
integrations then reset it. A bound the thermostat has not reported, or an
unavailable entity, shows `–` and disables the buttons — exactly as a missing
single setpoint does.

The on/off button calls `homeassistant.toggle` on the entity. Tapping the
icon tile, the name/status, or the target-temperature display opens the
more-info dialog. With a band the two numbers select instead of opening it;
the icon tile and the name/status still do.

</details>
