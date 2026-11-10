---
title: M3 Solar Battery Card
type: m3-solar-battery-card
category: energy
display: Solar Battery
summary: A balcony solar battery with its own inverter: charge, forecast, solar → battery → house and the solar inputs
table_order: 8
section_order: 53
---

A balcony solar battery with an inverter of its own — EcoFlow STREAM, Anker
SOLIX, Zendure and the like — in the suite's frame. How full it is and how
much that is in kWh, whether it is charging or supplying the house and until
when, where the power goes (solar → battery → house) and what each solar
input brings. Nothing is assumed about the integration: every value is mapped
in the config. Grid import is left out on purpose — the power summary card
shows that.

<img src="docs/images/solar-battery-card.png" alt="Solar Battery Card, dark theme" width="440"> <img src="docs/images/solar-battery-card-light.png" alt="Solar Battery Card, light theme" width="440">

<details>
<summary>Configuration, examples & options</summary>

```yaml
type: custom:m3-solar-battery-card
name: Battery
soc: sensor.battery_level
battery_power: sensor.battery_power
```

### EcoFlow STREAM Ultra

With the EcoFlow Cloud integration (`ecoflow_cloud`). Its `power_battery`
is positive while charging, so no `invert`; reserve and charge limit are not
reported through every API, so they are fixed numbers here.

```yaml
type: custom:m3-solar-battery-card
name: STREAM Ultra
capacity_kwh: 1.92
soc: sensor.stream_ultra_battery_level
reserve: 10
battery_power: sensor.stream_ultra_power_battery
output_power: sensor.stream_ultra_power_ac
solar_power: sensor.stream_ultra_power_pv_sum
mppt:
  - entity: sensor.stream_ultra_power_pv_1
  - entity: sensor.stream_ultra_power_pv_2
  - entity: sensor.stream_ultra_power_pv_3
  - entity: sensor.stream_ultra_power_pv_4
chips:
  - entity: sensor.stream_ultra_battery_temperature
    icon: mdi:thermometer
  - entity: sensor.stream_ultra_cycles
    name: Cycles
    icon: mdi:sync
```

### With an expansion battery

The SoC in the hero and the forecast then use the total capacity and a
capacity-weighted state of charge; each extra battery gets a row of its own.
Separate charge and discharge sensors work in place of one signed sensor.

```yaml
type: custom:m3-solar-battery-card
name: Storage
capacity_kwh: 1.92
soc: sensor.main_soc
charge_power: sensor.main_charge_power
discharge_power: sensor.main_discharge_power
batteries:
  - soc: sensor.expansion_soc
    capacity_kwh: 1.92
    name: Expansion
```

### What it shows

| Part | Shows |
| --- | --- |
| Header | The battery icon (with a bolt while charging), the name, the mode or `subtitle` and the capacity; a pill: **Charging**, **Supplying** (discharging), **Ready** (below `idle_threshold_w`) or **Full** (at the charge limit) |
| Hero | The state of charge, "≈ X kWh stored"; while it moves, "full at HH:MM" or "lasts until about HH:MM" and the power |
| Bar | The charge, striped while charging; a marker at the reserve and, below 100 %, at the charge limit |
| Flow | Solar → Battery → House, dots running the way the power goes, a short dash where nothing flows. A battery that charges from the grid through its AC side runs the house link backwards. Solar is dimmed without sun |
| Solar inputs | A column per MPPT, scaled to its `max_watts`, and the peak |
| More batteries | A row per expansion battery |
| Chips | Free chips at the bottom |

The forecast is `(charge_limit − soc) / 100 × capacity / power` while
charging and `(soc − reserve) / 100 × capacity / power` while discharging,
rounded to five minutes and "over 24 h" beyond a day. It needs
`capacity_kwh` and disappears while idle.

A value that cannot be read — `unavailable`, `unknown` — shows as "–", never
as 0, and the forecast is left out. A value that is not configured leaves no
gap: a flow tile and its link are dropped, the rest share the width.

### Configuration options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `soc` | string | – | State of charge in %. Required |
| `name` / `icon` | string | "Solar battery" / by charge | |
| `mode` | string | – | An entity whose state (an operating mode) leads the subtitle |
| `subtitle` | string | – | Fixed text or a template, when there is no `mode` |
| `capacity_kwh` | number | – | Needed for "kWh stored" and the forecast |
| `reserve` | entity / number | `0` | The discharge floor: a marker on the bar, the end of the forecast |
| `charge_limit` | entity / number | `100` | Where "full" is |
| `battery_power` | string | – | One signed sensor, positive while charging |
| `invert` | boolean | `false` | For a sensor that is positive while discharging |
| `charge_power` / `discharge_power` | string | – | Two plain sensors instead of `battery_power` |
| `solar_power` | string | sum of `mppt` | Total solar power |
| `mppt` | list | – | `{ entity, name, max_watts, tap_action }`; `max_watts` (default 500) fills the column |
| `output_power` | string | – | What the inverter feeds into the house |
| `batteries` | list | – | `{ soc, capacity_kwh, name, tap_action }` |
| `chips` | list | – | `{ entity \| template, name, icon, unit, color, tap_action }` |
| `hide_mppt_without_sun` | boolean | `false` | Hides the inputs while all read 0 W |
| `idle_threshold_w` | number | `10` | Below this nothing flows |
| `kw_threshold` | number | `1000` | From here values read in kW |
| `show_bar` / `show_flow` / `show_mppt` / `show_forecast` | boolean | `true` | |
| `tap_action` | action | more-info on `soc` | The header icon |
| `solar_tap_action` / `battery_tap_action` / `output_tap_action` | action | more-info | The flow tiles |
| `solar_color` / `battery_color` / `house_color` | string | solar orange / green / violet | The colours of the power summary and energy flow cards |
| `flow_tint_opacity` | number | `14` | How strongly the tiles are tinted |
| `text_color` / `secondary_text_color` / `card_background` | string | theme | As on every card |
| `glass_background` | boolean | `true` | Frosted glass background |
| `radius` / `corners` | number / object | `28` | Corner radius, as on every card |
| `animation` | `auto` \| `on` \| `off` | `auto` | Dots, stripes and bars; `auto` respects `prefers-reduced-motion` |

</details>
