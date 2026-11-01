---
title: M3 Printer Card
type: m3-printer-card
category: household
display: 3D printer
summary: A 3D printer as one card instead of sixteen tiles — state, job and controls, with the layout following what the machine is doing
table_order: 17
section_order: 42
---

A 3D printer spends most of its life idle, and a dashboard built from one tile
per sensor spends most of its life saying "unavailable" sixteen times. This
card is the other approach: **the state decides what is drawn.**

<img src="docs/images/printer-card.png" alt="Printer Card" width="440">

```yaml
type: custom:m3-printer-card
entity: sensor.p1s_print_status
```

Built against Bambu Lab's integration and not tied to it — every block beyond
the header and the buttons is optional and appears only when its entities
exist, and the one thing that would otherwise hard-code a vendor is
configurable. See `state_map` below.

## What the state changes

| State | What the card shows |
| --- | --- |
| **printing / paused** | Everything: job, progress, layer count, controls |
| **idle / finished** | No progress bar, no percentage, no layer count, and no primary button unless a `start_action` is configured |
| **error** | A red outline, and the primary button becomes *Acknowledge error* |
| **offline** | Dimmed, and **no controls at all** — nothing sent would arrive |

Offline is grey rather than red on purpose: a printer switched off at the wall
is a normal state, not a fault, and colouring it as one trains people to ignore
red. The way back is the socket switch in the details block — or a socket
given as a tile in `chips` — which is why those blocks stay live when
everything else does not, and why the fold never takes them while the printer
is offline, whatever `collapse_blocks` says.

## `state_map`, and why it exists

Every integration words this differently. Bambu Lab reports a *stage* with
dozens of values, OctoPrint reports `Printing`/`Operational`, Moonraker reports
Klipper's `printing`/`complete`/`standby`, Prusa Connect something else again.
There is no set of strings that covers all four.

So the card resolves a status in three passes: **your `state_map` first**, then
a table of values seen in the wild, then substring rules. That last pass is why
`heatbed_preheating`, `filament_loading` and `auto_bed_leveling` all read as
"printing" without being listed — a vendor adds more of those with every
firmware, and a list would guarantee missing one.

A value nothing recognises reads as **idle**, never as an error. A vague status
line is better than a red frame around a healthy machine.

```yaml
type: custom:m3-printer-card
entity: sensor.printer_status
state_map:
  beschaeftigt: printing
  wartet: paused
  bereit: idle
```

## Entity mapping per integration

Everything below is found automatically when the integration names things
recognisably; the table is what to put in the **Sensors** section when it does
not.

| What the card wants | Bambu Lab | OctoPrint | Moonraker / Klipper | Prusa Connect |
| --- | --- | --- | --- | --- |
| `entity` (drives the layout) | **print status** | `sensor.*_current_state` | `sensor.*_printer_state` | `sensor.*_printer_state` |
| `stage_entity` (the wording) | current stage | — | — | — |
| Progress | print progress | `sensor.*_job_percentage` | `sensor.*_progress` | `sensor.*_progress` |
| Remaining | remaining time | `sensor.*_time_remaining` | `sensor.*_print_time_left` | `sensor.*_remaining` |
| Job name | subtask name | `sensor.*_current_file` | `sensor.*_filename` | `sensor.*_filename` |
| Nozzle | nozzle temp / target nozzle temp | `sensor.*_tool0_temperature` | `sensor.*_extruder_temperature` | `sensor.*_nozzle_temperature` |
| Bed | bed temp / target bed temp | `sensor.*_bed_temperature` | `sensor.*_heater_bed_temperature` | `sensor.*_bed_temperature` |
| Camera | `camera.*` (the chamber) | `camera.*` | `camera.*` | — |
| Speed profile | `select.*_printing_speed` | — | — | — |
| AMS | one sensor per slot | — | — | — |

**Why the Bambu column has no entity ids in it.** Home Assistant creates an
entity id in the language the install was set up in, so the same P1S is
`sensor.*_print_progress` on an English system and
`sensor.*_druckfortschritt` on a German one. Nothing matched on the id would
survive that, which is why the registry's translation key is the first pass and
the id only the second. Pick the entity by what it *is* — the table names that
— and the card finds the rest itself.

**Use the print status, not the stage, as `entity`.** Bambu publishes both. The
status is a clean six-value enum (`running`, `pause`, `finish`, `idle`,
`failed`, `offline`); the stage is a list of eighty values describing what the
machine is physically doing this second — `waiting_for_heatbed_temperature`,
`cleaning_nozzle_tip`, `checking_extruder_temperature`. The substring rules
catch most of those, but "most" is not what should decide whether the progress
bar is on screen. The stage is found on its own and used for the status line,
where eighty values are an asset rather than a hazard.

OctoPrint sets no translation keys, so its temperatures are found by device
class instead — that third pass exists for exactly this case.

## The speed row reads one entity and writes another

Bambu publishes the print profile twice: a `select` that can change it, and a
sensor that only reports it. The select is `unavailable` in some connection
modes — hybrid MQTT on a P1S, for one — while the printer prints on perfectly
happily in Standard, and a row of four pills with none of them lit reads as "no
profile" rather than as "not changeable from here".

So the value comes from whichever of the two has one, and only the *changing*
needs the select. Without it the row still shows what the printer is doing,
with the other pills stepped back so it does not invite a tap it cannot honour.

## AMS trays

Bambu does not publish a tray as three entities. It publishes **one sensor per
slot**, whose state is the spool's product name and whose attributes carry
`type`, `color`, `remain` and `empty`. The card reads either shape: dedicated
entities where an integration splits them, the tray entity's own attributes
where it does not — so `ams_slots` usually needs nothing at all, and naming
only `type_entity` is enough when everything hangs off that one entity.

Each tray shows its material, how much is left as a number, and the same value
as a bar underneath — both turn amber below `filament_warn`. A spool that cannot
report how much is left reports `-1`, which is shown as neither rather than as
an empty one. Two AMS units stay two rows of four; they both
number their slots 1–4, and merging them would quietly hide half the filament.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `entity` | string | — | **Required.** The status or stage entity whose value drives the layout. |
| `state_map` | object | — | Raw status values onto `printing`, `paused`, `idle`, `finished`, `error`, `offline`. |
| `name` | string | job name | Header title. Falls back to the job name, then to "No job". |
| `strip_extension` | boolean | `true` | Drops `.3mf`/`.gcode` from the job name. |
| `icon` | string | follows the state | Overrides the header icon. |
| `secondary_actions` | list | `[stop]` | Which small buttons may appear: `stop`, `files`, `filament`, `preheat`. A button is only drawn when it has something to do — see below. |
| `confirm_stop` | boolean | `true` | Stop asks first, in a dialog. See below. |
| `confirm_power_off` | boolean | `true` | So does switching an accessory **off**. Switching one on never asks. |
| `pause_action`, `resume_action`, `stop_action`, `start_action`, `files_action`, `filament_action`, `preheat_action` | action | — | Full Home Assistant action syntax. Pause, resume and stop fall back to the integration's own buttons when it has them; `start_action` decides whether a Start button exists at all. |
| `stage_entity`, `progress_entity`, `remaining_entity`, `layer_entity`, `total_layers_entity`, `job_name_entity`, `online_entity`, `error_entity` | string | discovered | Override any entity the automatic lookup got wrong. |
| `optimistic_timeout` | number | `35000` | How long a tapped state is shown before the card stops waiting for confirmation. |
| `show_camera`, `camera_entity`, `camera_live`, `camera_refresh`, `light_entity` | — | — | The chamber view. A still by default — see below. |
| `show_progress`, `show_temps`, `show_speed`, `show_ams`, `show_details` | boolean | `true` | The blocks. Each also disappears on its own when its entities are missing. |
| `wave_style` | string | `wavy` | `wavy` or `flat`: the progress as a wave or a plain line, as on the appliance card. |
| `notify_enabled`, `notify_service`, `notify_title`, `notify_message`, `notify_on_start`, `notify_start_message` | — | — | Set in the editor's Notifications panel — see below. |
| `collapsible` | boolean | `false` | Folds the card to its header and controls, with the chevron the vacuum cards use. |
| `collapse_blocks` | list | all | Which blocks the fold takes: `camera`, `progress`, `temps`, `speed`, `ams`, `details`, `chips`. |
| `default_collapsed`, `collapse_state_entity`, `collapse_memory` | — | — | Same keys as the vacuum, room and heading cards: start folded, keep the state in an `input_boolean`, or remember it per device or per session. |
| `filament_warn` | number | `40` | Percent below which a tray's bar turns amber. |
| `ams_slots` | list | discovered | Per tray: `type_entity`, `color_entity`, `remaining_entity`. One entity carrying all three as attributes also works — see below. |
| `accessories` | list | — | Switches beside the printer: `entity`, `name`, `icon`, `color`, `power_entity`. |
| `chips` | list | — | Further readings as pills or tiles, with `heading` entries as dividers — see below. Same keys as the appliance card's `chips`. |
| `chip_style` | string | `pill` | `pill` or `tile` |
| `nozzle_temp_entity`, `nozzle_target_entity`, `bed_temp_entity`, `bed_target_entity`, `chamber_temp_entity`, `speed_entity`, `speed_state_entity`, `start_time_entity`, `end_time_entity`, `power_entity`, `camera_entity`, `light_entity` | string | discovered | Override any lookup that got it wrong. |
| `accent_color`, `text_color`, `card_background`, `glass_background`, `radius`, `corners`, `card_version` | — | — | The usual shared appearance options. |

## There is no Start button

Nobody starts a print from Home Assistant. A job is sliced, sent to the machine
and started at the machine or in the slicer; a dashboard has no file to print
and no way to pick one. An idle printer therefore gets **no primary button** —
the control row is its secondary buttons alone, which is the honest shape.

The exception is a setup where starting *does* mean something: a queue
integration, a Klipper macro, a "print the last file again" script. Configure
`start_action` and the button comes back.

```yaml
start_action:
  action: perform-action
  perform_action: script.print_last_job
```

## Progress, drawn as the light card draws brightness

The progress bar is the light card's wave, not a lookalike: the same amplitude,
wavelength, stroke and gap, flowing while the printer prints and flattening when
it pauses — the shape says "stopped" before the word does. It is drawn at the
card's real width. It used to be a 100-unit drawing stretched to fit, which
turned a tight wave into a long, lazy swell on a phone.

The header ends the way the vacuum card's does — a pill, then the fold chevron —
with the percentage in the pill. The layer and the time left sit under the wave
instead, left and right, where they describe the thing they are under; up in the
header they pushed the stage wording off the end of the line.

**Filled means press it, outlined means read it.** The chips in the details
block are status and have a rim and no fill; the accessory rows under them are
switches and are filled. The vacuum cards follow the same rule.

## Pause, resume and stop work without configuration

Bambu Lab publishes a button entity for each — pause, resume, stop — with a
translation key that says what it is, and so do OctoPrint and Moonraker by id.
The card finds them on the printer's device and presses them. A configured
`pause_action`, `resume_action` or `stop_action` still wins.

**The emergency stop is deliberately not one of them.** Moonraker publishes an
`emergency_stop` button that halts the firmware, drops the heaters and needs a
restart to recover from. Its id ends in `_stop`, so a lookup that matched on the
last word would take it for the job's stop — and the confirmation dialog would
then promise a cancelled print and deliver a dead printer. Anything that sounds
like a firmware, host or emergency action is excluded from the lookup, and the
exclusion has a test.

**A small button without anything behind it is not drawn.** Stop appears when
there is a `stop_action` or a stop button to press; files, filament and preheat
only with an action of their own. The default used to be stop, files and
filament — and with no action configured, files and filament both opened the
same details dialog: two buttons that looked different, did the same thing, and
on a phone had no label to say what either was for.

## Folding

`collapsible: true` puts the suite's fold chevron at the end of the header, the
same one the vacuum cards use, and a tap folds the card down to its header and
controls. The header still carries the percentage in its pill while a job runs,
so a folded card still answers "how far along is it".

`collapse_blocks` narrows what the fold takes — keep the AMS trays in view while
the camera folds, say:

```yaml
collapsible: true
collapse_blocks: [camera, temps, details]
```

This replaces the details block's own drawer. It used to open and close with a
chevron of its own, a second fold inside a card the suite folds from its header
— two gestures for the same thing. It is a block like the others now.

The chevron only appears when folding would take something. An idle printer
with no camera and every remaining block left out of `collapse_blocks` has
nothing to fold, and a chevron that does nothing reads as broken.

## Notifications

The editor's **Notifications** panel writes an automation, as the appliance
card's does: a message to every chosen phone when a print **finishes** and when
it **fails**, and — with "Also notify when it starts" — when one begins, with
the expected end time once the slicer's estimate has arrived. The end comes
from the printer's end-time sensor, or else from the time left, read in the
unit that sensor states (Bambu gives hours, others minutes or seconds).

The automation compares the raw status, since an automation cannot run the
card's own reading of it. It listens for every value the card counts as
finished, error or printing — the built-in table plus your `state_map`. A
value the card only recognises by its substring rules is not covered, so a
status your printer reports and the card has to guess at belongs in
`state_map`.

A printer coming back online, or Home Assistant restarting, is not announced:
the "finished" message needs the status to *change* to finished, not to have
been there already. Titles and texts can be changed in the panel, with
`{geraet}` and, in the start text, `{ende}`.

## Stop and power-off ask first

A stop throws away hours of work and a spool's worth of filament, and the
button sits next to Pause on a surface people tap while walking past it. So it
opens a dialog naming what is about to be lost, with Cancel under the thumb and
the red confirm beside it. `confirm_stop: false` removes the step.

Switching an accessory **off** asks the same way, because the accessory that
matters is the socket and cutting it mid-job ends the job.
`confirm_power_off: false` removes that one.

Switching an accessory **on** never asks, and that asymmetry is deliberate: it
costs nothing, and it is the one control that still works while the printer is
unreachable. Making the way back slower would be the wrong trade.

This replaced an older two-tap arm — tap once to turn the button red, again to
send. That is not a confirmation: it asks the same question twice and never
says what the answer costs, and two stray taps in the same spot still sent it.

## The camera is a still, not a stream

`camera_live` is off by default, and deliberately. A printer's camera runs on
the printer's own CPU and bandwidth, and a dashboard left open on a wall tablet
would hold a stream open for hours while the machine has better uses for both.
The still refreshes every ten seconds, and only while the card is actually on
screen — a layer takes longer than that anyway.

The badge on the picture says which of the two it is — a ten-second still
labelled *LIVE* is how a stopped print looks like a working one, because the
picture simply does not change and the badge insists it should.

An `image` entity is preferred over a `camera` one when the device offers both,
because an image entity's state is the timestamp of the picture: the browser
then refetches exactly when there is something new and never otherwise.

## Accessories, and why they outlive "offline"

`accessories` are the switches that belong *with* the printer but not *to* it —
the socket it is plugged into, the AMS heater, a filament dryer. They live in
the details block, which is the one block that stays usable — and unfolded —
while the printer is offline.

That is the whole point. Every other control is hidden when the machine is
unreachable, because nothing sent would arrive; the socket is how it comes
back.

```yaml
accessories:
  - entity: switch.drucker_steckdose
    name: Drucker-Steckdose
    icon: mdi:power-plug
    power_entity: sensor.drucker_steckdose_power
  - entity: switch.ams_heizung
    name: AMS-Heizung
    icon: mdi:radiator
```

## Finding the entities

Companion entities are looked up on the printer's own device, and on any device
registered *through* it — which is how an AMS unit is reached, since Bambu
registers those separately.

Three passes, because integrations differ in what they bother to declare: the
entity registry's translation key first, the entity id second, a device class
third. That last one is what finds OctoPrint's temperatures, which carry no
recognisable name but do say what they are.

## Further readings: `chips`

Anything else worth reading beside the printer — the enclosure, the AMS's own
humidity, a filament dryer, the sockets — goes in `chips`, the same option the
appliance card has. They sit at the foot of the card, as small pills or, with
`chip_style: tile`, as a grid of tiles: the name small, the value large.
The editor's **Status chips** panel edits them, dividers and order included.

An entry with a `heading` and no `entity` is a divider across the full width,
so readings from several devices stay apart in one list. A heading whose
readings are all unavailable is left out with them.

```yaml
chip_style: tile
show_details: false        # the tiles take the place of the details block
chips:
  - entity: sensor.drucker_druckfortschritt
    name: Fortschritt
    icon: mdi:percent
  - entity: switch.drucker_steckdose
    name: Steckdose
    icon: mdi:power-plug
    tap_action:
      action: more-info
  - heading: AMS
    icon: mdi:printer-3d-nozzle
  - entity: sensor.ams_temperatur
    name: Temperatur
    icon: mdi:thermometer
  - entity: sensor.ams_feuchtigkeit
    name: Feuchtigkeit
    icon: mdi:water-percent
```

A tile keeps the card's accent colour — `primary` unless `accent_color` says
otherwise — rather than the printer's state colour, so the readings do not turn
grey with the machine. A chip is read-only until it has a `tap_action`. A
socket as a tile does not ask before switching off, as an accessory does; give
it `more-info` rather than `toggle` when that matters. `chips` is also a fold
block, for `collapse_blocks`; like the details, it stays open while the
printer is offline, so a socket given as a tile can still bring it back.
