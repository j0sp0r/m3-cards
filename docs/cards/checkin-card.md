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

### Style `status`

```yaml
type: custom:m3-checkin-card
entity: input_boolean.garden_presence
style: status
```

Leads with **how long**: the running time large, in tabular figures ("14 min",
"2:05 h", "3 days"), kept current every ten seconds while the card is on
screen. The subtitle says since when ("Checked in since 14:02"), and a dot on
the icon pulses while checked in. Below, **one** button that names the action
— "Check in" filled with the accent, "Check out" tonal and quiet — because
here pressing it does exactly what it says. It squares from a pill to 18px
under the finger. `button_label_in` / `button_label_out` rename it.

### Style `swipe`

```yaml
type: custom:m3-checkin-card
entity: input_boolean.garden_presence
style: swipe
```

For a phone in a pocket or a tablet by the door, where a brush of the hand
should not switch anything: a 54px track with a handle to **slide** — right
to check in, left to check out. Past three quarters of the way it counts;
short of that it springs back. The handle squares to 15px while held, and a
tap on it only nudges it the way it goes. Checking out is a warm orange
(`color_checkout`, default `#e0a05a`) — an act, not a fault. Only the handle
claims the touch, so the page still scrolls over the rest of the card.

With a keyboard it is a switch: Space or Enter does it. Under reduced motion
(or `animation: off`) there is nothing to slide and a tap does it.
`swipe_label_in` / `swipe_label_out` rename the track; `icon_in` / `icon_out`
replace the handle's chevrons.

### Several people on one card

```yaml
type: custom:m3-checkin-card
name: Office
user_entity_map:
  Josef: input_boolean.office_josef
  Anna: input_boolean.office_anna
```

`user_entity_map` maps a Home Assistant user — by name, ignoring case, or by
user id — to that person's entity. Each viewer's control switches their
**own**; a viewer the map does not name falls back to `entity`, which may
then be left out. Above the control, everyone checked in: 30px avatars from
their `person` entity's picture (matched by `user_id` or name), initials
where there is none, "+n" past five, and their names — or a count once there
are more than two. `show_people: false` hides the row.

### Confirmation

`confirm: double_tap` asks "Sure?" on the first tap and switches on a second
within three seconds; `confirm: hold` switches after 600 ms held, a fill
running across the control meanwhile, and says "Press and hold" if let go too
soon. With a keyboard, which cannot hold, Space or Enter confirms as a double
tap does. The swipe style ignores `confirm`: its slide is the confirmation.

### Options

| Option | Default | Description |
| --- | --- | --- |
| `entity` | — | **Required** unless `user_entity_map` names every viewer. input_boolean, switch, binary_sensor, person or device_tracker |
| `user_entity_map` | — | HA user (name or id) → that person's entity |
| `show_people` | `true` with a map | The avatars of everyone checked in |
| `confirm` | `none` | `double_tap` or `hold`; not for `swipe` |
| `style` | `segmented` | The control: `segmented`, `status` or `swipe` |
| `name`, `icon`, `icon_off` | entity name, `mdi:account-check`, `mdi:account-off` | Header |
| `state_on`, `home_state` | `on`, `home` | What counts as checked in |
| `checkin_action`, `checkout_action` | turn_on / turn_off | Any action |
| `since_entity` | — | Where "since" comes from instead of `last_changed` |
| `label_in`, `label_out`, `icon_in`, `icon_out` | "Checked in", "Checked out", `mdi:login`, `mdi:logout` | The halves |
| `button_label_in`, `button_label_out` | "Check in", "Check out" | Style `status`: the button |
| `swipe_label_in`, `swipe_label_out` | "Slide to check in", "Slide to check out" | Style `swipe`: the track |
| `color_checkout` | `#e0a05a` | Style `swipe`: the colour of checking out |
| `status_in`, `status_out` | see above | Status templates with `{duration}`, `{time}` |
| `color`, `color_off` | `#81c784`, `#8b909b` | Checked in / out |
| `optimistic_timeout` | `5000` | Milliseconds to wait for confirmation |
| `tap_action` | `more-info` | A tap on the header |
| `animation`, `haptics`, `glass_background`, `radius` | — | The usual shared options |

</details>
