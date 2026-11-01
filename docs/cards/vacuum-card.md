---
title: M3 Vacuum Card
type: m3-vacuum-card
category: household
display: Vacuum
summary: A robot vacuum: state, battery, start/pause and suction, with every companion entity found on the device
table_order: 15
section_order: 40
---

A control surface for a robot vacuum, built against the Roborock integration
and usable with any `vacuum` entity.

Only `entity` is required. Everything else the card draws — the map, the
progress, the mop controls, the dock chips — is looked up on the vacuum's own
device and simply left out when it is not there, so a Valetudo, Dreame or
Xiaomi vacuum gets the header, the buttons and the suction row without being
asked to support anything it cannot.

<img src="docs/images/vacuum-card.png" alt="Vacuum Card" width="440">

```yaml
type: custom:m3-vacuum-card
entity: vacuum.sushi
```

## What it draws today

The header carries the state as a colour — cleaning blue, docked green, paused
amber, returning violet, an error red — with the vacuum's own status text
underneath and a battery chip on the trailing end. Under it the primary button
follows the state (**Start**, **Pause**, **Resume**), flanked by two smaller
ones, and below that a row of suction pills built from the entity's own
`fan_speed_list`.

The suction pills draw four rising bars rather than spelling the level out.
The names are vendor vocabulary — "Balanced", "Turbo", "Max+", "Custom" — which
does not sort, does not translate consistently and does not fit a 42px pill.

## Sending it to rooms

Pick one or more rooms and the primary button becomes **Clean N rooms**, calling
`vacuum.clean_area` with the areas in the order they were tapped. The service
takes a reorderable list, so that order is passed on rather than sorted behind
your back.

The areas have to be configured — the editor offers Home Assistant's own area
picker for it. That is not laziness: the mapping from a map's segments onto
areas lives inside the integration and is not readable from a card, so the
alternative would be offering every area in the house, with "Garden" and
"Terrace" sitting next to "Kitchen" and no way to tell which the robot can
reach.

Two things have to be true before a tap does anything: the vacuum must declare
`CLEAN_AREA` in its supported features, and the segments must be mapped to areas
on the vacuum entity itself — its gear icon, *"Map vacuum segments to areas"*.
Without the mapping the service is called and the robot ignores it.

## The map is cropped to the floor plan

A Roborock map is a picture of the robot's **whole coordinate space**, and a
flat fills a corner of it. `object-fit: contain` then fits the empty margin as
carefully as the rooms, which is why an uncropped map arrives as a stamp in the
middle of a 360-pixel box with air on every side.

So the card measures where anything is actually drawn and hands that to
`object-view-box`. Same box, same layout, a plan several times larger — what
you would otherwise get by pinching the enlarged map every time you looked at
it.

The measurement runs on the picture's `load`, once per version of it, against a
240-pixel-wide copy: plenty to find an edge, and cheap enough for a map that
changes every few seconds while the robot is out. A row of pixels counts as
content only when enough of it is opaque, so the path trace and a no-go line do
not pin the crop to the edge of the canvas — with one honest limit, that a
stroke running *along* an axis fills its own row or column and is kept.

`map_fit: picture` turns it off and shows the file as it comes. Browsers
without `object-view-box` (Firefox, at the time of writing) also show the whole
picture — the declaration is simply ignored, and nothing else changes.

## Zooming the map

Rather than crop the picture to fill the box — which would hide rooms — the map
can be enlarged:
**the magnifier in its bottom corner** opens the picture full-screen, and there
it pinches, drags and wheel-zooms. Double-tap toggles between 1× and 2×, and a
second button goes back to 1×.

**The card's own map does not take those gestures**, and that is the point of
the magnifier. Pinching an element needs `touch-action: none` on it, and that
also swallows the vertical swipe that scrolls the dashboard. The map is the
tallest thing on this card, so a phone was left with a few pixels beside it to
scroll on — and the picture sliding under the thumb on every attempt.

**A tap on the map opens the same enlarged view.** It used to open more-info on
the image entity, which is that same picture again with a history graph under
it — worth having while the map could be pinched in place, useless once it
cannot. `map_tap_action` takes it over: `{ action: "none" }` makes the picture
inert and leaves the magnifier, and `more-info` is still there for anyone who
wants it back.

Inside the full-screen view both shields are in place: `touch-action: none` so
the browser does not pan anything underneath, and every pointer is also handed
to `stopSwipe`, so `hass-swipe-navigation` does not read a sideways drag as
"next view". The CSS stops the browser, the shield stops the plugin's own
listeners.

## Vacuum, mop, or both

The cleaning mode is a **menu**, not a scale, and that is deliberate. Mop
intensity and route are three strengths of one thing, so a slider reads them
correctly. Vacuum / mop / both are three different jobs, and sliding from
"vacuum" to "mop" through "both" says something about them that is not true —
the machine's own app asks this question with a menu too.

The row sits at the **bottom** of the card, under the sliders and the chips.
It is the one control you set before sending the machine out and then leave
alone, so it belongs below the things read at a glance rather than between two
sliders that get nudged far more often.

It shows what the next run will do and opens the menu on a tap. Picking an
option sets the `select` and **starts nothing**: a vacuum leaves on one button,
the one that says Start. The card looks for `cleaning_mode` on the vacuum's
device; `cleaning_mode_entity` names it outright, and `show_cleaning_mode:
false` leaves it out.

## Folding it away

`collapsible: true` adds a "Details" row at the foot that folds the map, the scales,
the buttons and the chips. What stays is the line you actually glance at — the
state, the battery and Start/Pause — which is the split worth making on a
dashboard where the vacuum is not the main event.

`collapse_blocks` narrows what disappears. Folding the map away while the
suction scale stays put is a different card from folding everything, and both
are reasonable:

```yaml
type: custom:m3-vacuum-card
entity: vacuum.dobby
collapsible: true
default_collapsed: true
collapse_blocks: [map, mop, buttons]
```

That leaves the state, the battery, Start/Pause, the suction scale and the
status chips visible at all times, and puts the map and the mop controls behind
the row. Leaving the key out folds everything, which is what `collapsible`
alone has always done.

The fold is remembered the same way the room and heading cards remember theirs:
per device by default, per session with `collapse_memory: session`, or in an
`input_boolean` via `collapse_state_entity`, which survives a different browser
and lets an automation fold it.

## Everything else, one tap away

`popup` puts any Lovelace card behind the header — the maintenance card, the
history, every routine the vendor's app has. The tile stays a summary and the
detail stops competing with it for space.

```yaml
type: custom:m3-vacuum-card
entity: vacuum.dobby
popup:
  size: wide
  content:
    type: custom:m3-vacuum-maintenance-card
    entity: vacuum.dobby
```

With a popup configured, a tap on the header opens it instead of more-info; an
explicit `tap_action` still wins over both.

## Naming states yourself

`states` maps the vacuum's own state onto a label, an icon and a colour, first
match wins. It exists for two cases: a brand whose vocabulary this card has
never seen, and a word you simply want different.

```yaml
type: custom:m3-vacuum-card
entity: vacuum.dobby
collapsible: true
states:
  - value: docked
    label: Steht in der Station
    icon: mdi:sleep
  - regex: "clean"
    label: Unterwegs
    color: "#85b7eb"
```

A rule's label wins over the status sensor, which is what makes it useful as an
override rather than only as a fallback.

## Telling you when it goes wrong

The editor can build an automation that notifies on an error from the vacuum
**or its dock**. It watches the two error sensors rather than the vacuum's own
`error` state, for two reasons: those carry the reason — `water_empty` rather
than just "something is wrong" — and the dock's errors never reach the vacuum
entity at all.

It fires when an error appears and stays quiet while the same one stands, and a
restart does not replay errors the machine was already in. `{geraet}` and
`{fehler}` are available in the custom text.

## Three things worth knowing about Roborock

**It polls every 30 seconds and pushes nothing.** A tap on Start therefore
changes no state the card can see for up to half a minute. Rather than look
broken, the card paints the state it just asked for and reconciles on the next
poll, dimming the button slightly while it is showing something unconfirmed. If
the confirmation never comes — the dock was blocked, the command was lost — the
guess expires on its own after about two polls and the real state comes back.
`optimistic_timeout` changes that window for a slower integration.

**"Local polling" still needs the cloud.** The integration talks to the vacuum
over the local network, but it cannot log in without reaching Roborock's
servers, and the vacuum locks its own local API when it has no internet. An
offline install is not possible today.

**It disconnects briefly, often.** The card paints an unreachable vacuum grey
rather than red. Red is reserved for an actual error, so that it keeps meaning
something.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `entity` | string | — | **Required.** The `vacuum` entity. |
| `name` | string | entity name | Header title. |
| `icon` | string | `mdi:robot-vacuum` | Overrides the header icon. By default it stays a robot vacuum — the colour carries the state — and changes only to `robot-vacuum-alert` on an error and `robot-vacuum-off` when the vacuum cannot be reached. |
| `collapsible` | boolean | `false` | Folds the blocks below the primary buttons. State, battery and Start/Pause stay in view. |
| `collapse_blocks` | list | all | Which blocks the fold hides: `map`, `rooms`, `fan_speed`, `mop`, `buttons`, `chips`. Left out, it hides all of them. |
| `default_collapsed` | boolean | `false` | Whether it starts folded. |
| `collapse_state_entity` | string | — | An `input_boolean` holding the fold, so it survives a different browser and an automation can fold it. |
| `collapse_memory` | `device` \| `session` | `device` | Where the fold is remembered without a helper entity. |
| `states` | list | — | Custom status texts. First match wins; each rule takes `value`/`regex`/`above`/`below` plus `label`, `icon`, `color`. |
| `show_map` | boolean | `true` | The live map preview. |
| `map_height` | number | `360` | Height of the map preview in px. |
| `show_rooms` | boolean | `true` | The room chips. |
| `rooms` | list | — | Home Assistant area ids the vacuum can be sent to, in the order they should be offered. **Required for the block to appear** — see below. |
| `map_zoom` | boolean | `true` | The magnifier that opens the map full-screen, where it pinches, drags and wheel-zooms. `false` leaves the map a plain picture. |
| `map_max_zoom` | number | `4` | How far the pinch may go in that view. |
| `map_fit` | `plan` \| `picture` | `plan` | `plan` crops the empty margin off so the floor plan fills the box. See above. |
| `map_tap_action` | action | opens the enlarged map | What a tap on the map does. The suite's usual action grammar, so `none`, `more-info`, `navigate`, `call-service` and the rest all apply. |
| `show_mop_intensity` | boolean | `true` | The mop-intensity scale. |
| `show_mop_mode` | boolean | `false` | The mop-route scale. Off by default — it is rarely changed. |
| `show_station_chips` | boolean | `true` | The dock and mop status chips. Drawn with a rim and no fill, so they cannot be mistaken for the filled `buttons` above them; only a reminder you can tick off is filled. |
| `reminders` | list | — | Recurring chores; only the ones that are **due** appear, as a chip. Same shape as on the maintenance card. |
| `max_chips` | number | `4` | How many chips before the rest collapse into "+n". Errors are never collapsed. |
| `buttons` | list | — | Free buttons. The suite's chip buttons, so each takes `entity`, `name`, `icon`, `color`, `show_state`, `tap_action`, `hold_action`, `double_tap_action`. |
| `buttons_wrap`, `buttons_stretch`, `buttons_justify` | — | wrap | Layout of that row, as on the chip-buttons card. |
| `popup` | object | — | A popup with any card inside: `content`, optional `title` and `size` (`normal`, `wide`, `fullscreen`). A tap on the header opens it. |
| `show_fan_speed` | boolean | `true` | The suction row. Hidden anyway when the vacuum reports fewer than two speeds. |
| `show_cleaning_mode` | boolean | `true` | The cleaning-mode row — vacuum, mop, or both — as a menu. Hidden when the vacuum has no such select. |
| `cleaning_mode_entity` | string | discovered | Names the cleaning-mode `select` when discovery cannot. |
| `secondary_actions` | list | `[return_to_base, locate]` | The two buttons beside the primary one: `return_to_base`, `locate`, `stop`. |
| `optimistic_timeout` | number | `70000` | How long, in milliseconds, a tapped state is shown before the card stops waiting for confirmation. |
| `status_entity` | string | discovered | The status sensor whose text the header shows. |
| `notify_enabled`, `notify_service`, `notify_title`, `notify_message` | — | — | The error notification above. Off until switched on. |
| `accent_color` | string | the state colour | Pins the card to one colour instead of letting the state pick it. |
| `text_color`, `secondary_text_color`, `card_background`, `glass_background`, `radius`, `corners`, `card_version` | — | — | The usual shared appearance options. |

Every companion entity can also be named explicitly — `map_entity`,
`mop_mode_entity`, `mop_intensity_entity`, `empty_mode_entity`,
`progress_entity`, `area_entity`, `time_entity`, `volume_entity`,
`child_lock_switch`, `dnd_switch` — which is only needed when the automatic
lookup picks the wrong one, or when the entity lives on a different device.

The lookup matches on the entity registry's translation key before falling back
to the entity id, so renaming an entity does not hide it from the card.
