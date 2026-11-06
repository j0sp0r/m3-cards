---
title: M3 Temperature Graph Card
type: m3-temperature-graph-card
category: climate
display: Temperature Graph
summary: Several temperature sensors as one graph — one room in focus, the rest faint behind it, with a timeline you can scrub
table_order: 4
section_order: 51
---

Every room's temperature on one card. Each sensor is a curve on a shared
scale; the one in focus is drawn thick with an area beneath it and a dot at
now, the others thin and faint behind it. The chips are the legend — colour,
room, current value — and a tap on one brings its curve to the front. A
finger on the graph reads every curve at that moment: a line and a pill with
the time and the focused room's value, while the chips show what each room
read then.

<img src="docs/images/temperature-graph-card.png" alt="Temperature Graph Card" width="440">

<details>
<summary>Configuration, examples & options</summary>

### Find the rooms yourself

```yaml
type: custom:m3-temperature-graph-card
```

Without `rooms` the card finds one temperature sensor per room with the
climate overview card's discovery: one per area, named after the area, with
the same filters — `include_area` / `exclude_area`, `include_labels` /
`exclude_labels`, `include_entities` / `exclude_entities`, `include_state` /
`exclude_state`. Unlike the overview, a sensor without an area is left out:
there that becomes a room of its own, and on a real install that means the
system monitor, the router and every thermostat's built-in sensor as curves.
Name it in `include_entities` to draw it anyway. In the editor, "Turn into a
fixed list" copies what was found into `rooms`, to reorder, rename and
colour.

### Or list them

The room list is written as on the climate overview card, so it can be
copied over; `humidity_entity` and `climate_entity` are accepted and ignored.

```yaml
type: custom:m3-temperature-graph-card
name: Room temperature
icon: mdi:thermometer
rooms:
  - name: Living room
    temperature_entity: sensor.living_room_temperature
  - name: Hallway
    temperature_entity: sensor.hallway_temperature
  - name: Office
    temperature_entity: sensor.office_temperature
    color: "#f5b3a3"
  - temperature_entity: sensor.bathroom_temperature   # named after its area
  - temperature_entity: sensor.bedroom_temperature
sort: area               # area | temp_desc | temp_asc | name
ranges: [24h, 7d, 30d]
default_range: 24h
summary: mean            # mean | median | entity
# summary_entity: sensor.indoor_average   # with summary: entity
default_focus: sensor.office_temperature
decimals: 1
height: 130
```

### Just the graph

Every extra can be switched off, down to a header over the curves:

```yaml
type: custom:m3-temperature-graph-card
show_chips: false        # the focus stays on default_focus; a finger on the graph lists every room
show_extremes: false
show_axis: false
show_focus_range: false
show_ranges: false
height: 90
```

### What it shows

- **Header:** the room that is warmest right now ("Office warmest") and, on
  the right, the average of all sensors — or the median, or one sensor of
  your choice with `summary: entity`.
- **Chips:** one per sensor, wrapping onto more lines as needed. The focused
  one squares off and takes a tint of its colour. A sensor with no reading
  and no history is dimmed and shows "–".
- **Graph:** dashed guide lines, the lowest and highest value as pills at
  the left edge, and a few time labels — "0, 6, 12, 18, now" for a day,
  weekdays for a week, Mondays for a month.
- **Scrubbing:** tap or drag across the graph. With `show_chips: false`,
  which leaves nothing on the card naming the rooms, the pill becomes a list
  of every room with its colour and reading at that moment, warmest first. A drag up or down still
  scrolls the page; a tap shows the reading for two seconds. With the graph
  focused, the arrow keys move along it.
- **Footer:** the focused room's lowest and highest reading in the range,
  and the ranges to choose from.
- **Gaps:** where a sensor was `unavailable` or `unknown` its curve breaks
  instead of bridging the gap.

### Where the data comes from

Up to 48 hours the card reads the recorder's history — one request for all
sensors — so the curves are drawn from every reading. Longer ranges read
the hourly long-term statistics, which exist for sensors with a
`state_class`; a sensor without one falls back to its history for that
range. A range that has been loaded is kept, new readings are added to it
as they arrive, and it is read again after ten minutes. Switching the focus
loads nothing.

Each curve is reduced to about one point per 4 px of width, every point
the time-weighted mean of what the sensor read in that slice of time, and
the line is drawn smoothed. The values shown while scrubbing are those
means, unsmoothed.

The unit is the first sensor's `unit_of_measurement` (°C or °F). A sensor
in another unit keeps its chip but is left out of the graph and the
average; the editor warns about it.

### Options

| Option | Default | Description |
| --- | --- | --- |
| `auto_discover` | `true` without `rooms` | Find one temperature sensor per area |
| `include_area` / `exclude_area` | — | Area filter for discovery |
| `include_labels` / `exclude_labels` | — | Label filter for discovery |
| `include_entities` / `exclude_entities` | — | Entity filter for discovery; a sensor without an area is drawn only when named here |
| `include_state` / `exclude_state` | — | State filter (`unavailable`/`unknown`, or a custom value) |
| `rooms` | — | Fixed room list (`name`, `temperature_entity`, `color`) instead of discovery |
| `name_strip` | as on the climate overview card | Patterns removed from names found by discovery |
| `name` / `icon` | `Room temperature` / `mdi:thermometer` | Header |
| `show_header` | `true` | Card header |
| `sort` | `area` | Chip and curve order: `area`, `temp_desc`, `temp_asc`, `name` |
| `ranges` | `[24h, 7d]` | Ranges offered: `6h`, `12h`, `24h`, `48h`, `7d`, `30d` |
| `default_range` | first of `ranges` | Range shown when the card opens |
| `summary` | `mean` | The large value: `mean`, `median` or `entity` |
| `summary_entity` | — | The sensor shown large with `summary: entity` |
| `default_focus` | first room | Curve in focus at first: its sensor, or its position |
| `decimals` | `1` | Decimal places |
| `show_chips` | `true` | Room chips (legend and focus picker) |
| `show_extremes` | `true` | Lowest and highest value as pills at the left edge |
| `show_axis` | `true` | Time labels below the graph |
| `show_focus_range` | `true` | The focused room's lowest and highest reading in the footer |
| `show_ranges` | `true` | Range picker in the footer (hidden anyway with a single range) |
| `height` | `130` | Height of the graph in px |
| `accent_color` | theme primary | The large value and the active range |
| `text_color` / `secondary_text_color` | theme default | Title / subtitle and labels |
| `card_background` | glass/solid background | Card background |
| `animation` | `auto` | `auto`/`on`/`off`; `auto` and `on` respect `prefers-reduced-motion` |
| `glass_background` | `true` | Frosted glass background |
| `radius` / `corners` | `28` | Corner radius, optional per corner |

Each room's colour comes from a tonal palette that is lifted for dark
cards and darkened on light ones until it holds 3:1; `color` on a room
overrides it. A room keeps its colour when `sort` reorders the chips.

</details>
