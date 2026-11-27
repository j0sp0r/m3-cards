---
title: M3 Energy Usage Card
type: m3-energy-usage-card
category: energy
display: Energy usage
summary: The energy dashboard's use per day, week or month — date selection, stacked bars, sources with costs
table_order: 11
section_order: 56
---

The energy dashboard's view of a period, in one card: arrows and a segmented
day / week / month to choose it, the total the home used with how much of it
did not come from the grid, stacked bars per hour, day or month (grid at the
bottom, battery, solar on top) and a table of the sources with their costs.
It reads the energy dashboard's own configuration and statistics, so the
numbers are the dashboard's.

<img src="docs/images/energy-usage-card.png" alt="Energy Usage Card" width="440">

<details>
<summary>Configuration, examples & options</summary>

```yaml
type: custom:m3-energy-usage-card
period: month
```

Each part can be left out, so the card can be only the date selection on top
of a view and only the bars further down. Cards with the same
`collection_key` move their period together:

```yaml
- type: custom:m3-energy-usage-card
  show_graph: false
  show_table: false          # just the date selection
- type: custom:m3-energy-usage-card
  show_date: false           # follows the one above
  show_devices: true         # plus the dashboard's individual devices
```

### How it counts

- **Sources** come from the energy dashboard (`energy/get_prefs`): every
  grid import and export, solar and battery. `sources` overrides them with
  statistic ids of your own.
- **Use** follows the dashboard: solar first goes to the home, then into the
  battery, then out to the grid; a battery charged from the grid is not
  counted as use until it discharges. **Self-sufficient** is the share of the
  use that did not come from the grid.
- **Costs** are the dashboard's cost statistics — the ones you configured,
  or the ones Home Assistant computes from a price (`energy/info`). Without
  any the column shows "–".
- Values switch between Wh, kWh and MWh as the dashboard does.
- A tap on a bar shows its breakdown; a tap on a table row opens that
  source's meter.

### With Home Assistant's own energy cards

Home Assistant's energy cards keep their period in an object on the
connection that is not part of its public API. Where a native energy card on
the same view has created it, this card follows that period and moves it
along; where it has not, the card keeps its own. Nothing breaks if a Home
Assistant update changes that object — the cards just stop moving together.

### Report

The editor's *Report* section creates a Home Assistant automation that sends
you the use: every morning for yesterday, on Mondays for last week, or on the
first for last month — "Yesterday: 8.2 kWh used · 2.41 € · 3.1 kWh solar
direct · 38 % self-sufficient". It asks the recorder itself and counts hour by
hour (day by day for a week or a month) the way the card does, so the figures
match. It needs Home Assistant 2025.8 or later. Placeholders for your own
text: `{zeitraum}`, `{verbrauch}`, `{netz}`, `{solar}`, `{akku}`,
`{einspeisung}`, `{kosten}`, `{autark}`.

### Configuration options

| Option | Type | Default | Description |
|---|---|---|---|
| `period` | `day` \| `week` \| `month` \| `year` | `day` | The period on first load |
| `periods` | list | `[day, week, month]` | What the segmented button offers |
| `show_date` / `show_graph` / `show_table` | boolean | `true` | The three parts |
| `show_self_sufficiency` | boolean | `true` | The "self-sufficient" chip. It only appears with solar or a battery on the energy dashboard |
| `y_axis` | boolean | `false` | Values and dashed lines beside the bars, on round steps, the unit at the top |
| `show_devices` / `max_devices` | boolean / number | `false` / `10` | Rows for the dashboard's individual devices, largest first |
| `collection_key` | string | `default` | Cards with the same key share their period |
| `notify_enabled` | boolean | `false` | The report, set up from the editor. See [Report](#report) |
| `notify_mode` | `daily` \| `weekly` \| `monthly` | `daily` | Yesterday, last week (Mondays) or last month (on the 1st) |
| `notify_time` | time | `08:00` | When it is sent |
| `notify_service` | list | – | Recipients |
| `notify_title` / `notify_message` | string | – | Your own title and text |
| `sources` | object | from the dashboard | `grid_from`, `grid_to`, `solar`, `battery_from`, `battery_to`: lists of statistic ids |
| `grid_color` / `solar_color` / `battery_color` / `export_color` | string | purple / orange / green / grey | The colours of the sources |
| `title` | string | – | An optional title above the date |
| `glass_background`, `radius`, `corners`, `text_color`, `secondary_text_color`, `card_background`, `animation` | | | As on every card |

</details>
