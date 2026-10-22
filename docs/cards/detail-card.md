---
title: M3 Detail Card
type: m3-detail-card
category: system
display: Detail
summary: One entity large: its history as a smoothed curve or a timeline, its device's other entities — and the sheet that can replace more-info
table_order: 6
section_order: 46
---

One entity, large. A number gets its value, how far it moved, and where it
has been as a smoothed curve with its lowest and highest reading marked. A
door gets a timeline of when it was open. A lamp gets its own M3 card
with the timeline under it. Below all of these sit the other entities of
the same device, and a tap on one steps the view to it.

The same view can replace Home Assistant's more-info dialog for the suite's
own cards: set `detail_mode: sheet` on a card, and a tap that would have
opened more-info opens this as a bottom sheet instead. The sheet is frosted
glass like the card it opened from; a card with `glass_background: false`
opens a solid one.

<details>
<summary>Configuration, examples & options</summary>

```yaml
type: custom:m3-detail-card
entity: sensor.living_room_humidity
```

### Three ways to use it

Home Assistant does not let a custom card replace the more-info dialog for
the whole frontend. What there is, in order of how much it reaches:

| Way | Reaches | Needs |
| --- | --- | --- |
| **`detail_mode: sheet`** on any M3 card | Every tap in that card that would open more-info | Nothing |
| **The card itself** in a popup — browser_mod, bubble-card, or the suite's own `popup` with `mode: custom` | Any card that can open such a popup, the suite's or not | The popup's integration |
| **The card on a dashboard** | A view of its own, for one entity | Nothing |

`detail_mode` is in the appearance section of every M3 editor whose card
can open details. It defaults to `more_info`, so nothing changes until it is
set. Entities the view has nothing for keep opening the dialog: an `update`
(its release notes live there), a button, a script or a scene.

Restyling the real more-info dialog is deliberately not covered. It lives
outside every card and can only be reached through card-mod, which this suite
does not use.

**browser_mod** (version 2), from any card's tap action:

```yaml
tap_action:
  action: fire-dom-event
  browser_mod:
    service: browser_mod.popup
    data:
      content:
        type: custom:m3-detail-card
        entity: sensor.living_room_humidity
```

**The suite's own popup**, e.g. on the Lights Overview card, where
`[[entity_id]]` is the tapped light:

```yaml
hold_action:
  action: popup
popup:
  mode: custom
  card:
    type: custom:m3-detail-card
    entity: "[[entity_id]]"
```

### What it shows, by entity

| Layout | For | Shows |
| --- | --- | --- |
| `numeric` | `sensor`, `number`, `input_number`, `counter` with a number | Value with a trend chip, the curve, minimum / average / maximum, plus the total for a meter |
| `binary` | `binary_sensor`, `automation`, `schedule` | A timeline, time in each state, number of changes in the period |
| `states` | Text sensors, `select`, `input_select`, timestamps, anything else | A timeline and how long each state lasted; for a timestamp, when it was set and its last changes |
| `control` | `light`, `switch`, `fan`, `cover`, `climate`, `media_player`, `humidifier`, `vacuum`, `lock`, `input_boolean` | The matching M3 card, then the timeline |
| `info` | `weather`, `person`, `device_tracker`, `sun` | The value and, for weather, temperature, humidity, wind and pressure |

`type_overrides` changes the layout per entity id or per domain; the entity
id wins:

```yaml
type_overrides:
  sensor.washing_machine_power: numeric
  input_boolean: binary
```

Inside a `control` view, the embedded card's own "details" taps stay in the
view: one for an entity the view can show steps to it, and anything else
closes the sheet before Home Assistant's dialog opens, so the two never
stack.

### Where the history comes from

Long-term statistics when the entity has a `state_class`: five-minute
values for a day, hourly ones for a week or a month. They are aggregated on
the server, so thirty days of a chatty sensor stay light. Without
statistics, from the History API.
Either way the curve is thinned to at most 300 points, keeping the spikes
(Largest-Triangle-Three-Buckets), and it breaks where the entity was
unavailable rather than drawing across the gap.

The curve is a monotone cubic, not a Catmull-Rom spline: it rounds the
corners without ever swinging past a reading, so the rings for the minimum
and maximum always sit on the line.

A meter's total is read from its readings — every rise counts, a fall is
taken as a reset — and not from the statistics' `change`. That value takes
any short dip in a `total_increasing` sensor as a meter change and adds the
whole reading again. On a real group of meters one five-minute row carried
2,894.5 kWh for a day in which the meter rose by 13.

The period last picked is remembered per entity on that device.

### Configuration options

| Option | Type | Default | Description |
|---|---|---|---|
| `entity` | string | – | **Required.** The entity to show |
| `name` / `icon` / `color` | string | from the entity | Title, icon and accent. The default colour follows the device class (humidity blue, energy orange); a temperature takes its colour from its value, blue when cold through green to red when hot, on the climate overview's stages |
| `range` | `1h` \| `24h` \| `7d` \| `30d` | `24h` | Period on opening, until the viewer picks another |
| `ranges` | list | all four | The periods offered above the graph, in order |
| `stats` | list of `min` / `mean` / `max` / `sum` | min, mean, max (+ sum for a meter) | The tiles under the curve |
| `trend_inverted` | boolean | `false` | For readings where rising is bad news |
| `show_tooltip` | boolean | `true` | The reading under the pointer on the curve |
| `y_axis` | boolean | `true` | Three or four round values up the side of the curve, with faint guide lines |
| `show_related` / `max_related` | boolean / number | `true` / `5` | The device's other entities, including diagnostic ones such as battery |
| `control_card` | `auto` \| `none` \| card config | `auto` | The card at the top of a `control` view; `[[entity]]` stands for the entity |
| `type_overrides` | map | – | Layout per entity id or domain, see above |
| `details` | `expanded` \| `collapsed` \| `hidden` | `collapsed` | The extras beyond what Home Assistant's own dialog shows — tiles, lists, the device's other entities, and for a controllable device its history: shown, behind one "more details" button, or left out |
| `text_color` / `secondary_text_color` | string | theme default | Text colours |
| `card_background` | string | glass/solid background | Card background |
| `animation` | `auto` \| `on` \| `off` | `auto` | Respects `prefers-reduced-motion` |
| `glass_background` | boolean | `true` | Frosted glass background |
| `radius` / `corners` | number / object | `28` | Corner radius, optional per corner |

And on every other M3 card that can open details:

| Option | Type | Default | Description |
|---|---|---|---|
| `detail_mode` | `more_info` \| `sheet` | `more_info` | What a tap that would open more-info opens |

</details>
