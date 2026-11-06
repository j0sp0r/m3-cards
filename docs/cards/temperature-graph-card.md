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

### Minimal

```yaml
type: custom:m3-temperature-graph-card
entities:
  - sensor.living_room_temperature
  - sensor.hallway_temperature
  - sensor.office_temperature
```

Each chip is named after the sensor's area, or its own name when it has none.

### Everything

```yaml
type: custom:m3-temperature-graph-card
title: Room temperature
icon: mdi:thermometer
entities:
  - sensor.living_room_temperature        # the bare id works
  - entity: sensor.hallway_temperature
    name: Hallway
  - entity: sensor.office_temperature
    name: Office
    color: "#f5b3a3"
  - sensor.bathroom_temperature
  - sensor.bedroom_temperature
ranges: [24h, 7d, 30d]
default_range: 24h
summary: mean            # mean | median | entity
# summary_entity: sensor.indoor_average   # with summary: entity
default_focus: sensor.office_temperature  # or its index, 2
decimals: 1
show_extremes: true
height: 130
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
- **Scrubbing:** tap or drag across the graph. A drag up or down still
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
| `entities` | — | Temperature sensors, as ids or `{entity, name, color}` |
| `title` | `Room temperature` | Card title |
| `icon` | `mdi:thermometer` | Header icon |
| `ranges` | `[24h, 7d]` | Ranges offered: `6h`, `12h`, `24h`, `48h`, `7d`, `30d` |
| `default_range` | first of `ranges` | Range shown when the card opens |
| `summary` | `mean` | The large value: `mean`, `median` or `entity` |
| `summary_entity` | — | The sensor shown large with `summary: entity` |
| `default_focus` | `0` | Curve in focus at first: index or entity id |
| `decimals` | `1` | Decimal places |
| `show_extremes` | `true` | Lowest and highest value as pills at the left edge |
| `height` | `130` | Height of the graph in px |
| `accent_color` | theme primary | The large value and the active range |
| `text_color` / `secondary_text_color` | theme default | Title / subtitle and labels |
| `card_background` | glass/solid background | Card background |
| `animation` | `auto` | `auto`/`on`/`off`; `auto` and `on` respect `prefers-reduced-motion` |
| `glass_background` | `true` | Frosted glass background |
| `radius` / `corners` | `28` | Corner radius, optional per corner |

Each sensor's colour comes from a tonal palette that is lifted for dark
cards and darkened on light ones until it holds 3:1; `color` on an entry
overrides it.

</details>
