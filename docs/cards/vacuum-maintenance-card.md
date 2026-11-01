---
title: M3 Vacuum Maintenance Card
type: m3-vacuum-maintenance-card
category: household
display: Vacuum maintenance
summary: What is wearing out on a robot vacuum, what its dock can be told to do, and what it has done so far
table_order: 16
section_order: 41
---

The other half of the vacuum pair: wear counters, dock actions and lifetime
totals.

<img src="docs/images/vacuum-maintenance-card.png" alt="Vacuum Maintenance Card" width="440">

```yaml
type: custom:m3-vacuum-maintenance-card
entity: vacuum.dobby
```

Only the vacuum is named. The consumable sensors, the dock switches and the
totals are found from it — including the ones on the **dock**, which Roborock
registers as a second device linked by neither `via_device` nor
`parent_device`. The card follows the identifier instead, so the strainer and
the cleaning brush turn up beside the vacuum's own brushes rather than going
missing.

## Why this is a separate card

Wear counters are read once a month. Suction and Start are read every day.
Putting them on one card buries the daily thing under the monthly one — so
they are two, and the control card's `popup` is how they stay one tap apart:

```yaml
type: custom:m3-vacuum-card
entity: vacuum.dobby
popup:
  size: wide
  content:
    type: custom:m3-vacuum-maintenance-card
    entity: vacuum.dobby
```

## The bars need a total, and the sensors do not give one

Roborock reports hours *remaining*, never a percentage, so a bar needs a
service life to divide by. The card carries the documented ones — main brush
300 h, side brush 200 h, filter 150 h, sensors 30 h, dock strainer and cleaning
brush 150/300 h — and a part it has no figure for shows its hours **without** a
bar rather than a bar against an invented denominator. `max_hours` per
consumable overrides any of them.

A part past its life reports a negative number of hours. That reads as
"overdue", not as "−12 h".

## About the reset buttons

`show_reset: true` puts a small **reset** button at the end of every part row.
Pressing it asks first — the counter will read "new part" whether or not one was
fitted, and there is no undo — and then presses Home Assistant's own reset
button for that consumable.

Home Assistant ships Roborock's consumable-reset buttons **disabled**, and a
disabled entity is not in the frontend's registry at all, so the card cannot
tell "disabled" from "this vendor has none". Either way there is nothing to
press: the icon is drawn greyed with the reason on it, rather than left out.
Enable the buttons under *Settings → Devices → Entities* and it lights up.

The option is off by default, because a row of reset buttons is a row of
irreversible ones.

## Reminders for what the vacuum does not count

A mop pad wants changing every few runs, and no sensor tracks that. `reminders`
counts those against the lifetime run or runtime totals:

```yaml
type: custom:m3-vacuum-maintenance-card
entity: vacuum.dobby
reminders:
  - name: Wischmopp wechseln
    icon: mdi:hand-wash-outline
    every_runs: 3
```

"Every three runs" needs a reference point, and there are two ways to have one.

**Without a helper** the reminder fires on every multiple — run 3, 6, 9. Nothing
to set up, and nothing to acknowledge: change the mop after two runs and it will
still say so on the third.

**With `counter_entity`** — an `input_number` holding the meter reading at the
last acknowledgement — it becomes a real *"2 runs ago"*, the row can be ticked
off, and the state lives in Home Assistant rather than in one browser. The
reminder's editor has **Create counter helper**: it makes the `input_number`,
fills it in here and sets it to today's meter reading, which is the one value
that must not be left at zero — a helper at zero means "last done when the
machine was new", so a vacuum with 400 runs behind it would report the mop 397
runs overdue. (By hand it is *Settings → Devices & services → Helpers*, with a
range wide enough for the lifetime count.)

The tick-off is not only for a reminder that has come due: a mop changed after
two of its three runs still wants the count to start again. Due, the row carries
a **Done** button; before that, a quiet reset icon sits beside the figure.

`every_hours` counts against total runtime instead; if both are given, hours
wins.

Due reminders also show up as a chip on the **control card**, if you give it the
same `reminders` list — the tile then says what needs doing, and tapping the
chip ticks it off when a counter helper makes that meaningful.

## Telling you when something is due

The editor can build a Home Assistant automation that checks once a day and
reports the parts that have fallen below the warning threshold, together with
any reminders that have come due. It is a daily
digest rather than a trigger per sensor for a concrete reason: the sensors
report hours left against six different service lives, so "below 25 %" is six
different numbers — working that out once a day in one template is both simpler
and quieter than six triggers that each fire on their own.

Nothing due means nothing sent. Without that condition it would report an empty
list every morning, which is how a notification channel gets muted.

Turning the switch off pauses the automation rather than deleting it, so the
target and the wording survive. `{teile}` and `{anzahl}` are available in the
custom text.

## Folding it away

`collapsible` gives the header the suite's fold chevron. The header itself never folds — the
"3 parts due soon" line is the reason to look at the card — and
`collapse_blocks` decides what goes behind it:

```yaml
type: custom:m3-vacuum-maintenance-card
entity: vacuum.dobby
collapsible: true
default_collapsed: true
collapse_blocks: [stats, settings]
```

That keeps the parts, the reminders and the dock tiles in view and puts the
lifetime totals and the settings row away, which is the split that suits a card
you glance at for "does anything need doing". Leaving the key out folds
everything below the header.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `entity` | string | — | **Required.** The `vacuum` entity. Everything else is found from it. |
| `name` | string | "Maintenance" | Header title. |
| `icon` | string | `mdi:robot-vacuum` | Header icon. |
| `reminders` | list | — | Recurring chores: `name`, optional `icon`, `every_runs` or `every_hours`, optional `counter_entity`. |
| `consumables` | list | discovered | Replaces the automatic list. Each entry takes `key` or `entity`, plus `name`, `icon`, `max_hours`. |
| `warn_below` | number | `25` | Percent of service life at which a part turns amber. |
| `alert_below` | number | `10` | …and red. |
| `show_station` | boolean | `true` | The dock action tiles. |
| `show_stats` | boolean | `true` | Runtime, area and run count. |
| `show_settings` | boolean | `false` | Child lock, do-not-disturb and volume. |
| `show_reset` | boolean | `false` | A reset button on every part row, behind a confirmation. See above. |
| `collapsible`, `default_collapsed`, `collapse_state_entity`, `collapse_memory` | — | — | Folds the blocks below the header, as on the room and heading cards. |
| `collapse_blocks` | list | all | Which blocks the fold hides: `parts`, `reminders`, `station`, `stats`, `settings`. Left out, it hides all of them. |
| `notify_enabled`, `notify_service`, `notify_time`, `notify_title`, `notify_message` | — | — | The notification above. Off until switched on. |
| `accent_color`, `text_color`, `secondary_text_color`, `card_background`, `glass_background`, `radius`, `corners`, `card_version` | — | — | The usual shared appearance options. |

Only blocks whose entities exist are drawn, so a vacuum without a dock shows
its four own consumables and nothing else.
