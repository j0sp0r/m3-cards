---
title: M3 Appliance Card
type: m3-appliance-card
category: household
display: Appliance
summary: Any appliance: status, progress, sliders, programme pills, action buttons and chips
table_order: 13
section_order: 33
---

One appliance, with its status and its everyday controls on the same card.

<img src="docs/images/appliance-card.png" alt="Appliance Card" width="440">

The suite already had a washing machine's progress bar
([progress](#m3-progress-card)) and a grid of readings
([status](#m3-status-card)), but neither can *do* anything: starting the
machine, picking the programme, turning the oven down. So an appliance on a
dashboard was a hand-built stack — a progress card, a couple of button cards,
an entities card for the programme select — rebuilt from scratch for the dryer,
the oven, the coffee machine and the litter robot.

The [humidifier card](#m3-humidifier-card) is the shape this wants: a header, a
labelled slider, rows of pills, a chip row. It is also locked to one kind of
device. This card is the same anatomy with nothing assumed about what is behind
it: every block is optional, and a block whose entities are not configured is
simply not drawn.

<details>
<summary>Configuration, examples & options</summary>

```yaml
type: custom:m3-appliance-card
entity: sensor.washer_machine_state
```

That is the whole configuration for a card that shows one appliance's state.
Everything else is a block you add.

### The five blocks

| Block | What it draws |
| --- | --- |
| `progress` | A bar, with the percentage beside its label. Without a percentage sensor it runs indeterminate for as long as a remaining time is known |
| `sliders` | One labelled slider per `number` / `input_number` entity, over the entity's own `min`/`max`/`step` |
| `selects` | One row of pills per `select` / `input_select` entity, from the entity's `options` |
| `buttons` | A row of action buttons — press, start, stop, toggle |
| `chips` | Small readings at the bottom: door open, power draw, filter status. Drawn with a rim and no fill, so they cannot be mistaken for the filled `buttons`; a chip with a `tap_action` is a control and is filled like one. |

`layout` sets both the order and what appears at all. Leaving a block out of
the list hides it — one mechanism rather than an array plus a set of `show_*`
flags that can contradict it.

```yaml
layout: [progress, buttons]   # no sliders, no selects, no chips
```

### Wave style

The progress bar and the sliders are drawn as an M3-Expressive sine wave, the
same one [`m3-progress-card`](#m3-progress-card) and
[`m3-light-card`](#m3-light-card) draw, from the same `shared/wave.ts`. The key
is the same on both blocks, because picking a shape per block would be a
setting nobody wants.

```yaml
wave_style: wavy   # wavy (default) | flat
```

`flat` is a look, not an animation setting: it draws straight lines whatever
`animation` says. The two are independent, and they compose —

| | `wave_style: wavy` | `wave_style: flat` |
| --- | --- | --- |
| `animation: auto` / `on` | Wave, travelling while there is progress left to make | Straight line, bar fills |
| `animation: off` | Wave, frozen | Straight line, no motion |

Under `prefers-reduced-motion` the wave keeps its shape and stops travelling —
the wave is the component's identity, its movement is the decoration.

### The status line

The line under the name is the entity's state, run through `states` — the same
rule shape the [status card](#m3-status-card) uses, and the same code behind
it. The first matching rule wins; a rule with no condition at all is the
catch-all. A matched rule may also replace the icon and set the card's accent
colour, so the whole card follows the machine.

```yaml
states:
  - { value: run, label: Washing, color: green, icon: mdi:washing-machine }
  - { value: pause, label: Paused, color: amber }
  - { regex: "finish|end", label: Done, color: blue }
  - { label: Ready, color: grey }          # everything else
```

With no rules at all the state is shown as it reads, tidied up: `heavy_duty`
becomes "Heavy duty", a number keeps its unit.

### Example: a washing machine

Status, progress and the two buttons that matter. `remaining_entity` takes
minutes, seconds, a `1:24:00` duration or an absolute completion timestamp —
integrations disagree about this, so all four are read.

```yaml
type: custom:m3-appliance-card
entity: sensor.washer_machine_state
name: Washing machine
icon: mdi:washing-machine
states:
  - { value: run, label: Washing, color: green }
  - { value: pause, label: Paused, color: amber }
  - { regex: "finish|end", label: Done, color: blue }
  - { label: Ready, color: grey }
progress:
  percentage_entity: sensor.washer_progress_percent
  remaining_entity: sensor.washer_completion_time
  label: Progress
selects:
  - entity: select.washer_cycle
    label: Programme
buttons:
  - { entity: button.washer_start, name: Start, icon: mdi:play, color: green }
  - entity: button.washer_stop
    name: Stop
    icon: mdi:stop
    color: red
    tap_action:
      action: perform-action
      perform_action: button.press
      target: { entity_id: button.washer_stop }
      confirmation:
        text: Stop the programme?
```

### Example: an oven

A slider for the setpoint and two option rows. `icons` gives an option its own
glyph; `options` narrows the row to a subset of what the entity offers, in the
order written.

```yaml
type: custom:m3-appliance-card
entity: sensor.oven_operation_state
name: Oven
icon: mdi:stove
states:
  - { value: run, label: Cooking, color: "#f0a24a" }
  - { above: 0, label: Preheating, color: amber }
  - { label: Off, color: grey }
sliders:
  - entity: number.oven_setpoint_temperature
    label: Temperature
    unit: "°C"
    icon: mdi:thermometer
selects:
  - entity: select.oven_program
    label: Programme
    options: [hot_air, top_bottom_heat, grill]
    icons:
      hot_air: mdi:fan
      grill: mdi:grill
  - entity: select.oven_duration
    label: Duration
chips:
  - { entity: binary_sensor.oven_door, name: Door, icon: mdi:door,
      states: [{ value: "on", label: Open, color: amber },
               { label: Closed, color: green }] }
  - { entity: sensor.oven_current_temperature, name: Now, icon: mdi:thermometer, color: red }
```

### Example: a fridge

Chips only. Nothing to control, so nothing is drawn but the readings — no empty
button row, no bar sitting at zero.

```yaml
type: custom:m3-appliance-card
entity: binary_sensor.fridge_door
name: Fridge
icon: mdi:fridge-outline
states:
  - { value: "on", label: Door open, color: red, icon: mdi:fridge-alert-outline }
  - { label: Closed, color: green }
layout: [chips]
chips:
  - { entity: sensor.fridge_temperature, name: Fridge, icon: mdi:fridge-outline, color: blue }
  - { entity: sensor.freezer_temperature, name: Freezer, icon: mdi:snowflake, color: cyan }
  - { entity: binary_sensor.freezer_door, name: Freezer door, icon: mdi:door }
```

### Example: an appliance on a smart plug

Most dishwashers, and plenty of washers and dryers, have no integration at all
— only a plug that measures power. The card does not mind where its status and
progress come from, so three template sensors in Home Assistant are enough to
give such a machine the same card as a connected one: a status, a progress in
percent and the minutes left.

**First, read your machine's numbers off its power history** (the plug's power
sensor, a week of it, in the history panel):

| What to look for | Typical dishwasher | Used for |
| --- | --- | --- |
| Standby draw | under 5 W | below this the machine is idle |
| Draw at the start of a run | 10–50 W | above this for 2 min, a run has started |
| Draw after the programme ends | under 1 W | the machine switching itself off is the end — see below |
| Longest pause inside a run | 3 min | a fallback only: quiet for 90 min also counts as done |
| Length of a run, per programme | 140 / 170 min | the estimate before anything better is known |
| Heater | over 1000 W | the last heating phase starts a fixed time before the end |

A dishwasher heats twice: once early, for the wash, and once late, for the
final rinse — about 50 minutes before the end on the machine below, because
the drying after it runs silently. That silence is the trap: for half an hour
the machine draws exactly what it draws in standby, while its own display
still counts down. "Quiet for 10 minutes" called it done 35 minutes early.
What marks the real end is the machine switching itself off: the draw falls
from about 3.5 W to nothing. Look for that drop in your history; a machine
that does not switch itself off needs the long quiet fallback instead.
The minutes left are therefore estimated from the programme's usual length
until the second heating starts, and counted down from that point after it —
which is what keeps the estimate honest on a programme that runs long. Two
programmes can often be told apart early by when the first heating starts; on
the machine below it is minute 9–10 for the short one and minute 13 for the
long one.

```yaml
# configuration.yaml — replace the three plug entities and the numbers
template:
  - triggers:
      - trigger: numeric_state
        entity_id: sensor.dishwasher_plug_power
        above: 8
        for: "00:02:00"
        id: active
      - trigger: numeric_state
        entity_id: sensor.dishwasher_plug_power
        above: 1000
        id: heat
      - trigger: numeric_state
        entity_id: sensor.dishwasher_plug_power
        below: 1
        for: "00:00:30"
        id: selfoff
      - trigger: numeric_state
        entity_id: sensor.dishwasher_plug_power
        below: 5
        for: "01:30:00"
        id: quiet
      - trigger: numeric_state
        entity_id: sensor.dishwasher_plug_power
        below: 5
        for: "03:00:00"
        id: emptied
      - trigger: state
        entity_id: switch.dishwasher_plug
        id: plug
      # After a restart the "for" timers are gone; this notices a run that
      # ended in the meantime.
      - trigger: time_pattern
        minutes: "/5"
        id: tick
    actions:
      - variables:
          # The state before this trigger, read by name: inside `variables`,
          # `this` belongs to none of the sensors below.
          prev: >
            {% set s = states('sensor.dishwasher_status') %}
            {{ s if s in ['off', 'idle', 'run', 'finished'] else 'idle' }}
          started: "{{ state_attr('sensor.dishwasher_status', 'started') }}"
          mins: >
            {{ ((now() - as_datetime(started)).total_seconds() / 60) | round(1)
               if started else 0 }}
          power: "{{ states('sensor.dishwasher_plug_power') | float(0) }}"
          quiet_for: >
            {{ (now() - states.sensor.dishwasher_plug_power.last_changed).total_seconds() / 60
               if states.sensor.dishwasher_plug_power is not none else 0 }}
          ended: >
            {{ prev == 'run' and (trigger.id in ['selfoff', 'quiet']
               or (trigger.id == 'tick' and power < 1 and quiet_for >= 1)
               or (trigger.id == 'tick' and power < 5 and quiet_for >= 90)) }}
          begun: "{{ trigger.id == 'active' and prev != 'run' }}"
          new: >
            {% if states('switch.dishwasher_plug') == 'off' %}off
            {% elif trigger.id == 'active' %}run
            {% elif ended %}{{ 'finished' if mins >= 30 else 'idle' }}
            {% elif trigger.id == 'emptied' and prev == 'finished' %}idle
            {% elif prev == 'off' %}idle
            {% else %}{{ prev }}{% endif %}
    sensor:
      - name: "Dishwasher status"
        unique_id: dishwasher_status
        icon: mdi:dishwasher
        state: "{{ new | trim }}"
        attributes:
          started: >
            {% if begun %}{{ (now() - timedelta(minutes=2)).isoformat() }}
            {% elif (new | trim) in ['off', 'idle'] %}{{ none }}
            {% else %}{{ started }}{% endif %}
          first_heat: >
            {% if begun or (new | trim) in ['off', 'idle'] %}{{ none }}
            {% elif trigger.id == 'heat' and prev == 'run' and state_attr('sensor.dishwasher_status', 'first_heat') is none %}{{ mins | round(0) | int }}
            {% else %}{{ state_attr('sensor.dishwasher_status', 'first_heat') }}{% endif %}
          final_heat: >
            {% if begun or (new | trim) in ['off', 'idle'] %}{{ none }}
            {% elif trigger.id == 'heat' and prev == 'run' and mins >= 60 and state_attr('sensor.dishwasher_status', 'final_heat') is none %}{{ now().isoformat() }}
            {% else %}{{ state_attr('sensor.dishwasher_status', 'final_heat') }}{% endif %}

  - sensor:
      - name: "Dishwasher minutes left"
        unique_id: dishwasher_minutes_left
        icon: mdi:timer-outline
        unit_of_measurement: "min"
        state: >
          {% set a = states.sensor.dishwasher_status.attributes if states.sensor.dishwasher_status is not none else {} %}
          {% if states('sensor.dishwasher_status') != 'run' or not a.get('started') %}0
          {% else %}
            {% set mins = (now() - as_datetime(a.started)).total_seconds() / 60 %}
            {% if a.get('final_heat') %}
              {{ [50 - (now() - as_datetime(a.final_heat)).total_seconds() / 60, 1] | max | round(0) | int }}
            {% else %}
              {% set fh = a.get('first_heat') %}
              {% set expected = 155 if fh is none else (170 if fh | int >= 12 else 142) %}
              {{ [expected - mins, 20] | max | round(0) | int }}
            {% endif %}
          {% endif %}

      - name: "Dishwasher progress"
        unique_id: dishwasher_progress
        icon: mdi:progress-clock
        unit_of_measurement: "%"
        state: >
          {% set s = states('sensor.dishwasher_status') %}
          {% set a = states.sensor.dishwasher_status.attributes if states.sensor.dishwasher_status is not none else {} %}
          {% if s == 'finished' %}100
          {% elif s != 'run' or not a.get('started') %}0
          {% else %}
            {% set mins = (now() - as_datetime(a.started)).total_seconds() / 60 %}
            {% set left = states('sensor.dishwasher_minutes_left') | float(0) %}
            {{ [(mins / (mins + left) * 100) if (mins + left) > 0 else 0, 99] | min | round(0) | int }}
          {% endif %}
```

The numbers to change are the thresholds in the triggers (8 W, 1000 W, 1 W,
5 W), the 90 minutes of quiet, and in *minutes left* the programme lengths
(142 and 170, 155 while unknown), the minute that separates them (12) and the
50 minutes after the last heating. Measure the lengths to the moment the
machine switches itself off, not to the moment it goes quiet. A machine with one programme can drop the
`first_heat` attribute and use one length. One without a heater worth the name
— most dryers heat throughout — can drop `final_heat` and live with the
estimate.

A restart of Home Assistant does not start a run: the status is restored, and
a run needs 2 minutes of real draw. The `finished` state clears itself after 3
hours of standby, or when the plug is switched off.

The card then reads these like any other appliance. `none`, `idle` and `off`
are idle states and `finished` a done state by default, so the bar, the
remaining time and the notifications work without rules for them:

```yaml
type: custom:m3-appliance-card
entity: sensor.dishwasher_status
name: Dishwasher
icon: mdi:dishwasher
chip_style: tile
collapsible: true
layout: [progress, chips]
states:
  - { value: run, label: Washing, color: "#85b7eb" }
  - { value: finished, label: Done, color: "#81c784" }
  - { value: idle, label: Ready, color: primary }
  - { value: "off", label: Plug off, color: primary }
progress:
  percentage_entity: sensor.dishwasher_progress
  remaining_entity: sensor.dishwasher_minutes_left
chips:
  - { entity: sensor.dishwasher_plug_power, name: Power, icon: mdi:flash, tap_action: { action: more-info } }
  - { entity: sensor.dishwasher_plug_energy, name: Meter, icon: mdi:counter, tap_action: { action: more-info } }
```

To count tablets down with the [supply card](#m3-supply-card), one automation
takes one off at the start of each run:

```yaml
alias: Dishwasher — one tablet per run
triggers:
  - trigger: state
    entity_id: sensor.dishwasher_status
    from: [idle, finished]
    to: run
actions:
  - action: counter.decrement
    target:
      entity_id: counter.dishwasher_tabs
mode: single
```

### Buttons

A button with no `tap_action` of its own gets the one its domain implies —
`button.press`, `script.turn_on`, `scene.turn_on`, `automation.trigger`, or a
toggle for a `switch` / `input_boolean` / `light`. A `switch` also shows its
state: the button fills with its colour while it is on.

Everything a button, a chip or the card header does runs through the same
action handler the rest of the suite uses, so the full Home Assistant action
config works — including `confirmation`, which asks before it acts.

### Chips

A chip is read-only until it is given a `tap_action`, and then it is tappable.
Each chip carries its own colour, icon and optional `states` rules, and a chip
whose entity is unavailable is left out rather than dimmed — a row of "—" says
nothing and pushes the ones that do say something off the edge.

A chip keeps its colour whatever the machine is doing. The state rules colour
the header icon, the status line and the bar; a chip uses its own `color` or
rule, else the card's `accent_color` or its default. Taking
the state's colour turned every reading grey whenever the machine stood idle.

On a card that is mostly read — the power draw, today's energy, the meter, the
water — small pills undersell the figures. `chip_style: tile` draws each chip
as a tile instead, in a grid of two columns on a phone and more on a wide
card. A tile is drawn as a button card is — same height, rim, corner and
round icon well, the name bold with the reading under it — so it sits beside
a room's buttons as one design. A switch's well is grey while off and a filled
rounded square while on.

```yaml
chip_style: tile   # pill (default) | tile
```

An entry with a `heading` and no `entity` is a divider: a small label across
the full width, for a list that gathers readings from more than one device.
The editor adds one with "Add divider"; it is left out when none of the
readings under it can be read. Entries move up and down with the arrows on
each.

```yaml
chips:
  - heading: Dryer
    icon: mdi:tumble-dryer
  - entity: sensor.dryer_power
```

### Folding it away

`collapsible: true` gives the header a chevron that folds the blocks away. What
stays is the header — name, state and remaining time — which is the part worth
keeping in view on a page with several machines. `collapse_blocks` narrows what
disappears:

```yaml
collapsible: true
default_collapsed: true
collapse_blocks: [chips]   # the bar stays, the readings fold
```

The fold is remembered the same way as on the vacuum and printer cards: per
device by default, per session with `collapse_memory: session`, or in an
`input_boolean` via `collapse_state_entity`. The chevron is left out while
folding would hide nothing — a dryer that drops off Wi-Fi takes every chip with
it, and an arrow that toggles an empty body reads as a broken one.

### Idle, running, done

The card knows three things about a run without being told:

- **Idle.** While the state is one of `idle_states` there is no programme to
  show the progress of, so the bar and the remaining time are left out. A
  Samsung keeps reporting 0 % and 0 minutes while it is off. The defaults are
  `none`, `ready`, `inactive`, `off`, `stop`, `standby` and `idle`, which cover
  SmartThings and Home Connect.
- **Done.** A state in `done_states` — by default `finished`, `finish`, `end`
  and `beenden` — is a finished run. So is a run at 100 % with under a minute
  left: a Home Connect dryer keeps reporting `run` through its anti-crease
  phase, long after the laundry is dry, and a matching rule for the done state
  is then used for the status line.
- **Unavailable.** Only `unavailable`, `unknown` or no state at all dim the
  card. SmartThings' idle `none` is a reading, not a missing entity.

Each of the three draws its own layout:

| | Running | Done | Idle |
| --- | --- | --- | --- |
| Top right | the time left, large, with "done at 15:18" under it | a tinted "✓ Done" pill | the state in a quiet grey pill |
| Status line | the state | "Done 12 min ago" | "For 2 h" |
| Below | the bar, its percentage on the same line | the "Emptied" button, when `finish_action` is set | nothing |

The end time comes from the remaining-time sensor: a completion timestamp as
it is, minutes left added to now. It is written in your locale and moves on
with the minute. `show_end_time: false` keeps the plain "left" under the time.

"Done … ago" counts from a `finished_at` attribute on the status entity when
there is one — a template sensor's `last_changed` is reset whenever Home
Assistant restarts or reloads it — else from the status turning done, or, for
a machine done in all but name, from the progress reaching 100 %.

`finish_action` is any action; the button runs it and shows `finish_label`,
"Emptied" by default. A machine whose integration clears "done" itself when the
door opens needs none. A status derived from a plug does, or it sits at
"finished" until its timeout:

```yaml
finish_action:
  action: perform-action
  perform_action: input_button.press
  target:
    entity_id: input_button.dishwasher_emptied
```

…with the button as one more trigger of the status sensor, turning `finished`
into `idle`.

On a collapsible card the fold is a quiet "Details" row at the foot, so the
top right holds only the time or a pill — the same row every card
in the suite that folds has.

### Notifications

The editor's **Notification** section sets up an automation that pushes to the
devices you pick when the machine is done. There are two ways a machine can say
so, and the automation listens for both: the state turning to one of
`done_states`, or the progress reaching 100 %. Each run sends one message,
whichever comes first, so a dryer's anti-crease phase does not send a second.

**Also on start** (`notify_on_start`) sends a message when the state leaves an
idle state, with the expected end when the card has a remaining time:

> Washing machine has started. Done around 18:02.

It waits 90 seconds before sending, because most machines report a completion
time only once they have weighed the load.

Both texts come prefilled in the editor and can be changed there. `{geraet}` is
the card's name and, in the start text, `{ende}` the expected end as a time.
Every card that creates a notification lets you file the automation under a
category, picked in the same section.

| Option | Default | What it does |
| --- | --- | --- |
| `notify_enabled` | `false` | Master switch |
| `notify_service` | — | The notify targets, e.g. `[notify.mobile_app_pixel]` |
| `notify_title` / `notify_message` | `{geraet}` / `{geraet} is done.` | Title and finished text |
| `notify_on_start` | `false` | Also notify when a run starts |
| `notify_start_message` | `{geraet} has started. Done around {ende}.` | The start text |

### The popup

The card is a summary: a state, a progress bar, a few buttons. The full set of
controls — every programme, every option, the history — does not belong on a
dashboard tile, but it does belong one tap away. `popup` is that.

```yaml
type: custom:m3-appliance-card
entity: sensor.washer_state
name: Washing machine
popup:
  title: Washing machine        # optional; the card's name is used otherwise
  size: normal                  # normal (default) | wide | fullscreen
  content:
    type: vertical-stack
    cards:
      - type: custom:m3-appliance-card
        entity: sensor.washer_state
      - type: history-graph
        entities: [sensor.washer_power]
```

A card with a popup configured opens it on tap, so the common case needs no
`tap_action` at all. An explicit one still wins, which is how the popup goes on
a different gesture, or how a card keeps its more-info:

```yaml
tap_action:
  action: more-info
hold_action:
  action: popup
```

`[[entity_id]]` and `[[name]]` anywhere in `content` resolve to this card's, so
one popup body can be reused across several appliances. An `action: popup` on a
card with no `popup` configured falls back to more-info rather than opening an
empty dialog.

### Options

| Option | Default | What it does |
| --- | --- | --- |
| `entity` | — | Required. The entity that says what the appliance is doing |
| `name` / `icon` | from the entity | Header name and icon |
| `attribute` | — | Read this attribute instead of the state |
| `states` | — | Rule list for the status line: `value` / `regex` / `above` / `below`, plus `label`, `icon`, `color` |
| `progress.percentage_entity` | — | 0–100. Without it the bar is indeterminate |
| `progress.remaining_entity` | — | Minutes, seconds, `1:24:00`, or a completion timestamp |
| `progress.label` / `progress.color` | "Progress" / accent | The row's label and bar colour |
| `sliders[]` | — | `entity`, `label`, `icon`, `unit`, `min`, `max`, `step`, `color` |
| `selects[]` | — | `entity`, `label`, `options`, `icons`, `names`, `style`, `color` |
| `buttons[]` | — | `entity`, `name`, `icon`, `color`, `tap_action` |
| `chips[]` | — | `entity`, `name`, `icon`, `label`, `show_state`, `states`, `color`, `tap_action` |
| `chip_style` | `pill` | `pill` or `tile` |
| `finish_action` | — | The "Emptied" button on a finished machine; without it there is none |
| `finish_label` | "Emptied" | The button's text |
| `show_end_time` | `true` | "done at HH:MM" under the remaining time |
| `layout` | all five | Which blocks, in which order |
| `collapsible` | `false` | A chevron in the header that folds the blocks away |
| `collapse_blocks` | all | Which blocks the fold hides |
| `default_collapsed` | `false` | Start folded |
| `collapse_state_entity` | — | An `input_boolean` holding the fold |
| `collapse_memory` | `device` | `device` or `session`, without a helper entity |
| `idle_states` | see above | States that mean "not running": no bar, and the start of a run |
| `done_states` | see above | States that mean "finished" |
| `tap_action` | `more-info`, or `popup` when one is configured | What a tap on the header does. Adds a `popup` action kind |
| `popup` | — | The card's own popup: `title`, `size` (`normal`/`wide`/`fullscreen`) and a `content` card |
| `accent_color` | `#85b7eb`; `primary` on a card added from the card picker | Overridden by a matched rule's own `color`. Chips without a colour of their own use it |
| `text_color` / `secondary_text_color` / `card_background` | theme | The usual colour overrides |
| `glass_background` | `true` | Frosted card surface |
| `animation` | `auto` | `auto`, `on`, `off` — also honours `prefers-reduced-motion` |
| `radius` / `corners` | `28` | Card shape |

Every text field — `name`, a rule's `label`, a chip's or button's `name` — goes
through the [template support](#templates), so a Jinja2 expression works in any
of them.

### What it does when things are missing

A slider or an option row whose entity is unavailable is not drawn: a dead
track invites a drag that goes nowhere, and pills with no options are not a
row. A button whose entity is unavailable stays visible but dimmed and
unclickable, because it is part of the card's layout. Chips are dropped. The
card as a whole dims when its own status entity is unavailable or unknown.

</details>
