---
title: M3 Openings Card
type: m3-openings-card
category: presence
display: Openings
summary: Windows and doors — what is open, for how long, and a warning when it is cold outside
table_order: 4
section_order: 49
---

Windows and doors on one card that changes with them. While something is
open it leads with it: the count beside the header, the open sensors as one
joined group with how long each has been open — longest first — and a red
pill with the outdoor temperature when one has been open too long on a cold
day. Everything closed shrinks it to a single line that names the last one
opened. A sensor that does not answer is shown as such and never counted as
closed.

<img src="docs/images/openings-card.png" alt="Openings Card" width="440">

<details>
<summary>Configuration, examples & options</summary>

### Find them yourself

```yaml
type: custom:m3-openings-card
outdoor_temperature: sensor.outdoor_temperature
```

Without `entities` the card finds every `binary_sensor` of class `door`,
`window`, `opening` or `garage_door` on its own, as the battery card finds
batteries. `include_area`, `include_label` and `exclude_entities` narrow it
down; entries under `entities` then only rename or re-icon single sensors.

### Or name them

```yaml
type: custom:m3-openings-card
title: Windows and doors
entities:
  - binary_sensor.bathroom_window          # the bare id works
  - entity: binary_sensor.balcony_door
    name: Balcony door
    icon: mdi:door-sliding
    tap_action:
      action: navigate
      navigation_path: /lovelace/balcony
outdoor_temperature: sensor.outdoor_temperature
warn_after_minutes: 15
cold_below: 10
max_chips: 4
```

A list turns discovery off; `auto_discover: true` turns it back on.

### What it shows

- **Something open:** the header icon in amber, "6 of 8 closed" and the
  count. Each open sensor is a row with a window or door icon (by device
  class) and "open for 48 min" — "2 h 5 min", "1 day 3 h", "2 days" as it
  grows. The start comes from the recorder, so a Home Assistant restart does
  not reset it to "2 min".
- **The warning:** open for `warn_after_minutes` *and* colder outside than
  `cold_below` — the duration turns amber and a red pill shows the outdoor
  temperature. Without `outdoor_temperature` there is no pill, and the
  duration is highlighted on time alone.
- **Closed sensors** are green chips with a check, at most `max_chips`; a
  "+N" chip opens the rest. Unreachable ones come first, neutral with a
  warning icon, and the subtitle counts them.
- **All closed:** one line — a green lock, "Last opened: Kitchen, until
  14:12", and an "All closed" pill.
- A tap on a row or chip opens its details, or runs `tap_action` — the
  entry's own, else the card's.

### Options

| Option | Default | Description |
| --- | --- | --- |
| `entities` | — | binary_sensors, as ids or `{entity, name, icon, tap_action}` |
| `auto_discover` | `true` without `entities` | Find the sensors by device class |
| `include_area`, `include_label`, `exclude_entities` | — | Narrow discovery |
| `title`, `icon` | "Windows and doors", by state | Header |
| `outdoor_temperature` | — | Temperature sensor for the cold warning |
| `warn_after_minutes` | `15` | Minutes open before a row warns |
| `cold_below` | `10` | Outdoor temperature below which it warns |
| `max_chips` | `4` | Chips before "+N" |
| `tap_action` | `more-info` | For every row and chip |
| `color_open`, `color_warn`, `color_closed` | amber, red, green | The three states |
| `card_background`, `text_color`, `secondary_text_color` | — | The card's own colours |
| `animation`, `haptics`, `glass_background`, `radius`, `corners`, `detail_mode` | — | The usual shared options |

</details>
