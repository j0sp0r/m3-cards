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
rule, else the card's `accent_color`, else the theme's primary colour. Taking
the state's colour turned every reading grey whenever the machine stood idle.

On a card that is mostly read — the power draw, today's energy, the meter, the
water — small pills undersell the figures. `chip_style: tile` draws each chip
as a tile instead: the name small, the value large, in a grid of two columns on
a phone and more on a wide card.

```yaml
chip_style: tile   # pill (default) | tile
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
| `accent_color` | `#85b7eb` | Overridden by a matched rule's own `color`. Chips without a colour of their own use it, or the theme's primary colour when it is unset |
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
