---
title: M3 Multi Graph Card
type: m3-multi-graph-card
category: climate
display: Multi Graph
summary: Several sensors of one kind as one graph — temperature, humidity, CO₂, power … — one in focus, the rest faint behind it, with a timeline you can scrub
table_order: 4
section_order: 51
---

Several sensors of the same kind on one card: every room's temperature, its
humidity, CO₂, power — any sensor device class. Each sensor is a curve on a
shared scale; the one in focus is drawn thick with an area beneath it and a
dot at now, the others thinner behind it. The chips are the legend — colour,
name, current value — and a tap on one brings its curve to the front. A
finger on the graph reads every curve at that moment: a line and a pill with
the time and the focused sensor's value, while the chips show what each one
read then.

<img src="docs/images/multi-graph-card.png" alt="Multi Graph Card" width="440">

<details>
<summary>Configuration, examples & options</summary>

### Find the rooms yourself

```yaml
type: custom:m3-multi-graph-card
```

Without a list the card finds one sensor of its `device_class` per area —
temperature unless set otherwise — named after the area. Temperature and
humidity are found exactly as on the climate overview card, with the same
filters: `include_area` / `exclude_area`, `include_labels` /
`exclude_labels`, `include_entities` / `exclude_entities`, `include_state` /
`exclude_state`. Unlike the overview, a sensor without an area is left out:
there it becomes a room of its own, and on a real install that means the
system monitor, the router and every thermostat's built-in sensor as curves.
Name it in `include_entities` to draw it anyway. In the editor, "Turn into a
fixed list" copies what was found into `entities`, to reorder, rename and
colour.

### Other kinds of sensor

`device_class` says what is compared. Discovery looks for it, and the header
text, icon, unit and decimals follow it:

```yaml
type: custom:m3-multi-graph-card
device_class: humidity          # "Humidity", "Bathroom most humid", values in %
```

```yaml
type: custom:m3-multi-graph-card
device_class: carbon_dioxide    # "CO₂", values in ppm
summary: median
```

Power shows the total of its sensors as the large value, every other class
the average. Classes with their own header text: `temperature`, `humidity`,
`carbon_dioxide`, `power`, `illuminance`, `pm25`, `pressure`. Any other
device class works too, with "History" as the title and "<name> highest" as
the subtitle. The card suits measurements (`state_class: measurement`);
beyond 48 hours it reads the hourly mean, which a meter does not have, so a
meter's curve then comes from its raw history.

### Or list them

`entities` takes any sensors, of any class, and wins over discovery:

```yaml
type: custom:m3-multi-graph-card
device_class: power
name: Power by circuit
entities:
  - sensor.kitchen_power                 # the bare id works
  - entity: sensor.office_power
    name: Office
    color: "#f5b3a3"
  - sensor.living_room_power             # the header shows their total
```

A room list from the climate overview card can be copied in as `rooms`; the
card draws its `temperature_entity`, or its `humidity_entity` with
`device_class: humidity`, and the editor writes it back as `entities` once
it is changed.

```yaml
type: custom:m3-multi-graph-card
rooms:
  - name: Living room
    temperature_entity: sensor.living_room_temperature
    humidity_entity: sensor.living_room_humidity
  - name: Bathroom
    temperature_entity: sensor.bathroom_temperature
    humidity_entity: sensor.bathroom_humidity
sort: value_desc         # area | value_desc | value_asc | name
ranges: [24h, 7d, 30d]
default_focus: sensor.bathroom_temperature
```

### Just the graph

Every extra can be switched off, down to a header over the curves:

```yaml
type: custom:m3-multi-graph-card
show_chips: false        # the focus stays on default_focus; a finger on the graph lists every sensor
show_extremes: false
show_axis: false
show_focus_range: false
show_ranges: false
height: 90
```

### Grid lines and "now"

The other way, towards a chart with a scale: horizontal lines at round values
with their value at the left edge, vertical lines at the time marks, and a
dashed line where the readings end.

```yaml
type: custom:m3-multi-graph-card
grid_lines: both         # horizontal (default), vertical, both or none
y_ticks: 5               # about how many horizontal lines
show_y_labels: true
show_now_marker: true
```

A value that would sit on the high or low pill is left out; with
`show_extremes: false` every line carries one.

### What it shows

- **Header:** the sensor reading highest right now ("Office warmest",
  "Bathroom most humid", "Kitchen highest") and, on the right, the average
  of all sensors — or the median, the total, or one sensor of your choice
  with `summary: entity`.
- **Chips:** one per sensor, wrapping onto more lines as needed. The focused
  one squares off and takes a tint of its colour. A sensor with no reading
  and no history is dimmed and shows "–".
- **Graph:** dashed guide lines, the lowest and highest value as pills at
  the left edge, and a few time labels — "0, 6, 12, 18, now" for a day,
  weekdays for a week, Mondays for a month.
- **Scrubbing:** tap or drag across the graph. A drag up or down still
  scrolls the page; a tap shows the reading for two seconds. With the graph
  focused, the arrow keys move along it. With `show_chips: false`, which
  leaves nothing on the card naming the sensors, the pill becomes a list of
  every sensor with its colour and reading at that moment, highest first.
- **Footer:** the focused sensor's lowest and highest reading in the range,
  and the ranges to choose from.
- **Gaps:** where a sensor was `unavailable` or `unknown` its curve breaks
  instead of bridging the gap.

### Where the data comes from

Up to 48 hours the card reads the recorder's history — one request for all
sensors — so the curves are drawn from every reading. Longer ranges read
the hourly long-term statistics, which exist for sensors with a
`state_class`; a sensor without them falls back to its history for that
range. A range that has been loaded is kept, new readings are added to it
as they arrive, and it is read again after ten minutes. Switching the focus
loads nothing.

Each curve is reduced to about one point per 4 px of width, every point
the time-weighted mean of what the sensor read in that slice of time, and
the line is drawn smoothed. The values shown while scrubbing are those
means, unsmoothed.

The unit is the first sensor's `unit_of_measurement`. A sensor in another
unit keeps its chip but is left out of the graph and the summary; the
editor warns about it. Decimals follow the first sensor's display precision
in Home Assistant, else the device class (none for %, ppm, lx, W).

### Options

| Option | Default | Description |
| --- | --- | --- |
| `device_class` | `temperature` | What is compared: any sensor device class |
| `entities` | — | Any sensors, as ids or `{entity, name, color}`; wins over `rooms` and discovery |
| `rooms` | — | Room list in the climate overview card's format (`name`, `temperature_entity`, `humidity_entity`, `color`) |
| `auto_discover` | `true` without a list | Find one sensor of `device_class` per area |
| `include_area` / `exclude_area` | — | Area filter for discovery |
| `include_labels` / `exclude_labels` | — | Label filter for discovery |
| `include_entities` / `exclude_entities` | — | Entity filter for discovery; a sensor without an area is drawn only when named here |
| `include_state` / `exclude_state` | — | State filter (`unavailable`/`unknown`, or a custom value) |
| `name_strip` | the climate overview card's, plus humidity suffixes | Patterns removed from names found by discovery |
| `name` / `icon` | by device class | Header |
| `show_header` | `true` | Card header |
| `sort` | `area` | Chip and curve order: `area`, `value_desc`, `value_asc`, `name` (`temp_desc` / `temp_asc` are read too) |
| `ranges` | `[24h, 7d]` | Ranges offered: `6h`, `12h`, `24h`, `48h`, `7d`, `30d` |
| `default_range` | first of `ranges` | Range shown when the card opens |
| `summary` | `mean` (`sum` for power) | The large value: `mean`, `median`, `sum` or `entity` |
| `summary_entity` | — | The sensor shown large with `summary: entity` |
| `default_focus` | first sensor | Curve in focus at first: its sensor, or its position |
| `decimals` | display precision, else by class | Decimal places |
| `show_chips` | `true` | Chips (legend and focus picker) |
| `show_extremes` | `true` | Lowest and highest value as pills at the left edge |
| `show_axis` | `true` | Time labels below the graph |
| `grid_lines` | `horizontal` | `horizontal`, `vertical` (at the time marks), `both` or `none` |
| `y_ticks` | `3` | About how many horizontal lines (1–10) |
| `show_y_labels` | `false` | The value on each horizontal line, at the left edge |
| `show_now_marker` | `false` | A dashed line at now, where the readings end |
| `show_focus_range` | `true` | The focused sensor's lowest and highest reading in the footer |
| `show_ranges` | `true` | Range picker in the footer (hidden anyway with a single range) |
| `height` | `130` | Height of the graph in px |
| `accent_color` | theme primary | Header icon, the large value and the active range |
| `text_color` / `secondary_text_color` | theme default | Title / subtitle and labels |
| `card_background` | glass/solid background | Card background |
| `animation` | `auto` | `auto`/`on`/`off`; `auto` and `on` respect `prefers-reduced-motion` |
| `glass_background` | `true` | Frosted glass background |
| `radius` / `corners` | `28` | Corner radius, optional per corner |

Each curve's colour comes from a tonal palette that is lifted for dark cards
and darkened on light ones until it holds 3:1; `color` on an entry
overrides it. A curve keeps its colour when `sort` reorders the chips.

</details>
