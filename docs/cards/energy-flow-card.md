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
| `show_battery` | `auto` \| `always` \| `never` | `auto` | Battery node visibility |
| `flow_speed` | `slow` \| `normal` \| `fast` | `normal` | Flow dot speed |
| `pv_color` / `grid_color` / `home_color` / `battery_color` | string | theme default | Node colors |
| `self_sufficiency_color` | string | `#81c784` | Self-sufficiency bar color |
| `text_color` / `secondary_text_color` | string | theme default | Name / node labels |
| `card_background` | string | glass/solid background | Card background |
| `animation` | `auto` \| `on` \| `off` | `auto` | Flow-dot animation; `auto`/`on` respect `prefers-reduced-motion` |
| `glass_background` | boolean | `true` | Frosted glass background |
| `radius` / `corners` | number / object | `28` | Corner radius, optional per corner |

</details>
