---
title: M3 Check-in Card
type: m3-checkin-card
category: presence
display: Check-in
summary: Checked in or out — one element that shows the state and switches it
table_order: 3
section_order: 48
---

Check-in and check-out as **one** element that shows whether someone is
checked in and switches it, on a card that tints itself by the state.

Two separate buttons, "check in" and "check out", say nothing about which is
true — and a subtitle "on" under one of them reads as if that button were on.
This card says which, and its control names **states** ("Checked in",
"Checked out"), never verbs, so it cannot be read the other way round.

<details>
<summary>Configuration, examples & options</summary>

### The simple case

```yaml
type: custom:m3-checkin-card
entity: input_boolean.garden_presence
name: Garden
icon: mdi:shovel
icon_off: mdi:shovel-off
```

An `input_boolean` (or a `switch`) is switched with its own turn_on/turn_off.
The card switches *to* a state rather than toggling, so a second tap on
"Checked in" cannot check anyone out.

### With actions of your own

```yaml
type: custom:m3-checkin-card
entity: input_boolean.garden_presence
checkout_action:
  action: perform-action
  perform_action: script.leave_garden   # turns the light and the watering off too
```

`checkin_action` and `checkout_action` take the full Home Assistant action
syntax. A `binary_sensor`, `person` or `device_tracker` without actions is
shown, not switched; a person or tracker is checked in while in `home_state`
(default `home`).

### What it shows

- **The card** takes the state's colour as a tint over the glass: the accent
  (`color`, default green) while checked in, a neutral grey (`color_off`)
  while out, so out never reads as a fault. Its rim is the suite's own.
- **The status line** says how long: "Checked in for 2 h 14 min", "Checked out
  · 6 min ago". `since_entity` (an input_datetime or a timestamp sensor) takes
  the place of the entity's `last_changed`; a time in the future is left out.
  `status_in` / `status_out` take `{duration}` and `{time}`.
- **The control** (style `segmented`, the default) is two halves, concentric
  with their track; the active one is filled. A tap moves it at once; if Home
  Assistant has not confirmed within `optimistic_timeout` (default 5000 ms) it
  goes back and says so.
- Unavailable dims the card; below 280px the halves show icons only.

### Options

| Option | Default | Description |
| --- | --- | --- |
| `entity` | — | **Required.** input_boolean, switch, binary_sensor, person or device_tracker |
| `style` | `segmented` | The control. `status` and `swipe` are planned |
| `name`, `icon`, `icon_off` | entity name, `mdi:account-check`, `mdi:account-off` | Header |
| `state_on`, `home_state` | `on`, `home` | What counts as checked in |
| `checkin_action`, `checkout_action` | turn_on / turn_off | Any action |
| `since_entity` | — | Where "since" comes from instead of `last_changed` |
| `label_in`, `label_out`, `icon_in`, `icon_out` | "Checked in", "Checked out", `mdi:login`, `mdi:logout` | The halves |
| `status_in`, `status_out` | see above | Status templates with `{duration}`, `{time}` |
| `color`, `color_off` | `#81c784`, `#8b909b` | Checked in / out |
| `optimistic_timeout` | `5000` | Milliseconds to wait for confirmation |
| `tap_action` | `more-info` | A tap on the header |
| `animation`, `haptics`, `glass_background`, `radius` | — | The usual shared options |

</details>
