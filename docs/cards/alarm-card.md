---
title: M3 Alarm Card
type: m3-alarm-card
category: presence
display: Alarm
summary: An alarm panel with mode buttons, keypad and entry-delay countdown, in the theme's own colours
table_order: 5
section_order: 52
---

An `alarm_control_panel` — Alarmo, the `manual` platform or any other
integration — in the suite's frame. The header says the state in the theme's
own colours: neutral while disarmed, the accent while armed, the warning
colour while arming or counting down an entry delay, and the whole card in
the error colour once triggered. The mode buttons below switch it, asking for
a code only when the panel wants one. Every colour comes from the theme, so
light and dark both come out right without UIX or card-mod.

<img src="docs/images/alarm-card.png" alt="Alarm Card, dark theme" width="440"> <img src="docs/images/alarm-card-light.png" alt="Alarm Card, light theme" width="440">

<details>
<summary>Configuration, examples & options</summary>

```yaml
type: custom:m3-alarm-card
entity: alarm_control_panel.home
```

### With Alarmo

Alarmo lists the sensors that kept it from arming (`open_sensors`) and how
long a delay runs (`delay`); the card shows both — the open sensors as chips,
the delay as a countdown with a shrinking bar. Other integrations that do not
say how long get a running bar without a number rather than a guessed one.

```yaml
type: custom:m3-alarm-card
entity: alarm_control_panel.alarmo
name: House
modes:
  - disarmed
  - armed_home
  - mode: armed_away
    name: Out
  - mode: armed_night
    icon: mdi:weather-night
```

### What it shows

| State | Header | Below |
| --- | --- | --- |
| Disarmed | Neutral, "Disarmed · since 18:29" | The mode buttons; open sensors as chips, plus "3 sensors ok" |
| Arming | Warning colour, pulsing, "To: Away" | A countdown pill and bar when the delay is known; the target mode in the warning colour |
| Armed | Accent, "Armed · Home", a "Secured" pill | The mode buttons, the active one a full pill — switch between armed modes directly |
| Entry delay | Warning colour, countdown | The code entry opens by itself |
| Triggered | The whole card in the error colour, who or what triggered it and when | One wide "Disarm" button that opens the code entry |
| Unavailable | Neutral | The buttons, disabled |

### Codes

The card asks for a code only when the panel has a `code_format`: always to
disarm, and to arm only when the panel also says `code_arm_required`. A
number code gets a keypad, a text code a field. Nothing is submitted by
itself after some number of digits — codes differ in length — so there is a
confirm button, and Enter. Confirming with nothing typed sends the command
without a code, for panels that allow cancelling an arming without one. A
rejected code shakes the dots and says so. The code is cleared after every
attempt and is never logged or stored.

### Sensors

Alarmo's `open_sensors` wins when it lists anything. For other integrations,
`sensors` takes a list of `binary_sensor`s: open ones show as chips in the
warning colour (a tap opens them), the closed ones are counted.

### Compact

`compact: true` is one row: the header and its pill. A tap on it opens the
buttons; an entry delay or a triggered alarm opens them by itself.

### Configuration options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `entity` | string | – | An `alarm_control_panel` entity. Required |
| `name` | string | friendly name | Shown where the state does not take the header |
| `modes` | list | supported modes, max. 4 | The buttons, in order. Each a mode (`disarmed`, `armed_home`, `armed_away`, `armed_night`, `armed_vacation`, `armed_custom_bypass`) or `{ mode, name, icon }` |
| `sensors` | list | – | `binary_sensor`s for the status line, when the integration does not list open sensors itself |
| `show_sensors` | boolean | `true` | The open / ok sensor chips |
| `compact` | boolean | `false` | One row; a tap opens the buttons |
| `accent_color` | string | `primary` | The armed colour |
| `text_color` / `secondary_text_color` / `card_background` | string | theme | As on every card |
| `glass_background` | boolean | `true` | Frosted glass background |
| `radius` / `corners` | number / object | `28` | Corner radius, as on every card |
| `animation` | `auto` \| `on` \| `off` | `auto` | Pulse, morphs and the fold; `auto` respects `prefers-reduced-motion` |

</details>
