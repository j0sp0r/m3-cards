---
title: M3 Energy Flow Card
type: m3-energy-flow-card
category: energy
display: Energy Flow
summary: Node diagram of today's solar/grid/home flows
table_order: 3
section_order: 6
---

A node diagram of today's energy flows between solar, grid, battery, and
home, with animated flow dots along the connection lines and a
self-sufficiency bar below.

<img src="docs/images/energy-flow-card.png" alt="Energy Flow Card" width="440">

<details>
<summary>Configuration, examples & options</summary>

```yaml
type: custom:m3-energy-flow-card
source: energy
```

### Data sources

- **`source: energy`** (default): reads solar, grid import/export, and
  battery statistics directly from the HA Energy dashboard.
- **`source: entities`**: `solar_entity`, `grid_import_entity`,
  `grid_export_entity`, `battery_entity` are freely chosen — useful when
  no full Energy dashboard is set up or individual sources need to be
  replaced. The values update as the sensors change.

### The battery

With your own sensors `battery_entity` follows Home Assistant's convention:
**positive discharges, negative charges**. A sensor that counts the other way
round (many balcony batteries report charging as positive) takes
`battery_invert: true`. Daily energy usually comes as two sensors, "charged
today" and "discharged today": put the first in `battery_charge_entity` and
the second in `battery_entity`.

The home is what comes in (solar, import, discharge) less what goes elsewhere
(export, charge). That holds with `show_battery: never` too: a hidden battery
still keeps its charge out of the home's figure. If you have a consumption
sensor of your own, `home_entity` shows it instead.

```yaml
type: custom:m3-energy-flow-card
source: entities
solar_entity: sensor.solar_power
grid_import_entity: sensor.grid_import_power
battery_entity: sensor.battery_power # +9 W while charging
battery_invert: true
battery_soc_entity: sensor.battery_level
```

### Export

The grid node shows whichever way the grid is running: while the house feeds
in, its number is the export, its icon points out and its name reads
"Export". Over a day both happen — then the larger one is the number and the
other a small line under the name ("Import 3.1"). A single grid sensor that
goes negative on export works as `grid_entity`.

### Consumers

`devices` adds your big consumers — a wallbox, a heat pump, a sauna — and
shows what the home's figure is made of. Up to four; "Other" is what the home
uses that none of them accounts for (`show_other: false` leaves it out).

In the classic diamond they appear underneath: their shares of the home as
one bar, then a row each with icon, name, the value and its share. A
`secondary` line under the name takes an entity's state ("Car battery · 58 %")
or a text of your own.

`layout: flow` draws them into the diagram instead: the sources in a column on
the left, the home large in the middle, the consumers on the right, every line
a curve through the home as thick as what flows. The battery charging or the
house feeding the grid runs from the home outwards, the dots showing the way.

With `source: energy` each device is an energy meter, shown as today's use
from its statistics, as the Energy dashboard does — the same meters as under
"Individual devices" there. With `source: entities` it is a sensor read as it
stands, power or energy like the other nodes. Name, icon and colour are
optional; the name and icon default to the sensor's own, the colour to one of
a palette in turn.

```yaml
type: custom:m3-energy-flow-card
source: energy
layout: flow        # or leave it out for the diamond with the list
devices:
  - entity: sensor.wallbox_energy
    icon: mdi:ev-station
    secondary: sensor.car_battery
  - entity: sensor.heat_pump_energy
    name: Heat pump
    icon: mdi:heat-pump
```

`layout: compact` leaves the devices out: there is no room for them in the row.

### Compact

`layout: compact` puts the nodes side by side — solar, grid, home, battery —
in one row about as tall as a weather or status tile, for a half-width slot.
A small arrow under each value says which way it runs relative to the home
tile, the home tile carries the self-sufficiency, and the battery icon fills
with its state of charge, the percentage under it. The header is off unless
`show_header: true`. On a card too narrow for the row — four tiles under
300px, three under 200px, as in a half-width slot on a phone — the tiles go
to two columns, each with its icon beside its value; the arrows give way
there, and the grid and battery icons say which way those run.

<img src="docs/images/energy-flow-compact.png" alt="Energy Flow Card, layout: compact — exporting and charging above, drawing from the grid below" width="400">

```yaml
type: custom:m3-energy-flow-card
layout: compact
source: entities
solar_entity: sensor.solar_power
grid_entity: sensor.grid_power        # negative while exporting
battery_entity: sensor.battery_power
battery_soc_entity: sensor.battery_level
```

### Energy or power

With your own sensors the card follows their unit. Energy sensors (Wh,
kWh, MWh) show the day: "Today", `· kWh`, "Self-sufficiency today". If
every sensor reports **power** (W or kW), the card shows the flow right
now instead: "Now", `· W` (`· kW` from 1000 W) and "Self-sufficiency now".

Names, unit and subtitle can be set yourself:

```yaml
type: custom:m3-energy-flow-card
source: entities
solar_entity: sensor.pv_power
grid_import_entity: sensor.grid_import_power
grid_export_entity: sensor.grid_export_power
pv_name: Roof
grid_name: Grid
home_name: Flat
subtitle: Live
unit: W              # W, kW, Wh, kWh, MWh convert the numbers; other text is a label
```

The battery node automatically appears only if a battery source is
configured (`show_battery: auto`, default) — `always`/`never` force its
visibility regardless.

### Animation

The flow dots run via a CSS animation along the lines
(`flow_speed: slow | normal | fast`) and are omitted entirely (not just
paused) when `animation: "off"` or `prefers-reduced-motion` is active.

### Configuration options

| Option | Type | Default | Description |
|---|---|---|---|
| `source` | `energy` \| `entities` | `energy` | Data source |
| `solar_entity` / `grid_import_entity` / `grid_export_entity` / `battery_entity` | string | – | Only for `source: entities`. See [The battery](#the-battery) for the sign of `battery_entity` |
| `grid_entity` | string | – | Only for `source: entities` — one signed grid sensor instead of the import/export pair: positive draws from the grid, negative feeds in |
| `grid_invert` | boolean | `false` | `grid_entity` counts export as positive |
| `layout` | `full` \| `compact` \| `flow` | `full` | `compact`: the nodes side by side in one row, about as tall as a tile. See [Compact](#compact). `flow`: sources left, home in the middle, consumers right. See [Consumers](#consumers) |
| `show_header` | boolean | `true`, `false` for `compact` | The header with name and subtitle |
| `battery_invert` | boolean | `false` | `battery_entity` counts charging as positive |
| `battery_charge_entity` | string | – | A separate charge sensor; `battery_entity` is then the discharge alone |
| `battery_soc_entity` | string | – | State of charge in %, shown with the battery's name (either source) |
| `home_entity` | string | – | Only for `source: entities` — the home's consumption from a sensor of its own, instead of calculated |
| `name` | string | "Energy Flow" | Displayed name |
| `subtitle` | string | "Today", or "Now" for power sensors | Line under the name |
| `pv_name` / `grid_name` / `home_name` / `battery_name` | string | Solar / Grid / Home / Battery | Node names |
| `unit` | string | kWh, or W/kW for power sensors | Unit under the nodes; W, kW, Wh, kWh and MWh also convert the numbers |
| `icon` | string | `mdi:transmission-tower` | Icon in the icon tile |
| `show_self_sufficiency` | boolean | `true` | Show the self-sufficiency bar |
| `tap_action` | action | – | What a tap on the card does, in both layouts — `navigate` to a popup's hash, say. Unset, a tap does nothing |
| `show_battery` | `auto` \| `always` \| `never` | `auto` | Battery node visibility |
| `devices` | list | – | Consumers, up to four: `entity`, and optionally `name`, `icon`, `color`, `secondary`. See [Consumers](#consumers) |
| `show_other` | boolean | `true` | "Other": what the home uses beyond the devices |
| `flow_speed` | `slow` \| `normal` \| `fast` | `normal` | Flow dot speed |
| `pv_color` / `grid_color` / `home_color` / `battery_color` | string | theme default | Node colors |
| `self_sufficiency_color` | string | `#81c784` | Self-sufficiency bar color |
| `text_color` / `secondary_text_color` | string | theme default | Name / node labels |
| `card_background` | string | glass/solid background | Card background |
| `animation` | `auto` \| `on` \| `off` | `auto` | Flow-dot animation; `auto`/`on` respect `prefers-reduced-motion` |
| `glass_background` | boolean | `true` | Frosted glass background |
| `radius` / `corners` | number / object | `28` | Corner radius, optional per corner |

</details>
