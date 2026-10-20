# M3 Cards 2.5.0

**Upgrading:** no option was removed or renamed, so existing configs load
unchanged. Three things look different without having been asked for, and one
of them is a reversal rather than an addition:

- **A lock chip swaps its colouring.** An *unlocked* lock is now the active,
  accent-coloured state and a locked one the quiet, inactive one. Before, it
  was the other way round. This is Home Assistant's own reading — a lock is
  "active" exactly when it is *not* locked — and it holds for the Chip Buttons
  Card, the M3 Button Card and the M3 Aquarium Card, which share one list of
  active states. If you prefer the old look, `state_colors` on a chip sets it
  back per state; on a button card, `inactive_color` does.
- **An inactive chip with `use_entity_color` follows the theme** instead of
  going straight to grey. A theme that defines, say, `--state-light-off-color`
  now colours switched-off light chips with it.
- **A single setpoint lost its caption.** The climate card wrote "target
  temperature" under the one number a thermostat has. A *band* keeps its
  captions — those name which of the two rows is which.

A fourth difference shows only on old hardware. Anything that stopped at
iOS 15 — an iPod touch 7, an iPad Air 2 — ran this suite badly enough to be
unusable, and now runs it. What those devices give up is the tint on a fill,
not the fill. Nothing changes on a current browser; see *Old hardware is still
a dashboard* below.

This release is mostly about the cards saying what they know, about the three
findings the HACS store review turned up on the way in, and — late, and after
a photograph of a very small screen — about the hardware that never got a
newer Safari.

The suite registers 44 cards.

## A second look for the climate card

`style: expressive` redraws the card around Material 3 Expressive: the
*current* temperature becomes one dominant, heavy figure; the setpoint becomes
a single connected control — round outside, tight inside — instead of two
circular buttons either side of a floating pill; the mode and preset buttons
morph their shape on press; and a heat/cool frame around the card reports the
equipment.

The frame has two strengths rather than one: full while the entity's
`hvac_action` reports heating or cooling, dimmed while heat or cool is the
selected mode but the equipment is idle. That second level is not decoration.
Many integrations derive `hvac_action` from the physical valve, so a Homematic
eTRV reports `idle` for an entire summer with the mode set to heat, and a frame
that only lit on `heating` was invisible on that hardware.

The default stays `tiles`, unchanged in every detail — this is an opt-in second
look, not a redesign of the existing one. Contributed by **@UHaFnir**, over
three review rounds.

Its mode button is the first consumer of `shared/dropdown-menu.ts`, a
body-level portal: `.card-inner.glass` establishes a containing block, so a
menu rendered inside the card can neither escape `ha-card`'s `overflow: hidden`
nor paint above a card that comes later in the dashboard. With only two modes
left, the button flips straight to the other one rather than opening a menu for
a binary switch.

## A reading opens the history it came from

Three cards drew numbers you could look at and not ask about.

- **The climate overview's room tiles** show two numbers from two sensors but
  tapped as one, so the humidity was the only number on the card you could not
  reach. The strip along the bottom is now its own tap target and opens the
  entity the percentage came from. It is the full width of the tile and
  everything below the temperature, not the 10px line of text, so it can be hit
  on a phone. A hold still runs `hold_action` anywhere on the tile — only the
  tap differs between the two zones.
- **The room card's sensor chips** open their own entity: temperature,
  humidity, extra sensors, a single power sensor, and a window or door chip
  with exactly one contact behind it. A power chip summed from `power_entities`
  and a window chip covering several contacts stay plain, because there is no
  single history to show and a chip that does nothing should not look like one
  that failed.
- **The mini climate card can show the humidity** in its status line:
  `21,2 °C · 59 % · Aus`. It stays off until it is switched on, in the card's
  own editor rather than YAML-only. Most thermostats report no
  `current_humidity` of their own, so `humidity_sensor` points at the room's
  sensor and naming one is itself the request to show it.

## Chip rows

Chip labels that do not fit now slide to their end and back instead of ending
in an ellipsis, and `stretch: smart` gives each chip its content width first,
sharing out only what is left — so a temperature or a percentage keeps its full
width while a long name gives up space. `show_name: false` hides a chip's name;
with `show_state` off as well it becomes a round icon button. Per-chip
`state_colors` colour one exact state.

The three measuring passes a chip row needs — edge fades, smart widths, sliding
labels — now sit behind one controller that the chip-buttons, button and vacuum
cards each drive with a single call, so no card can wire up half of it. The
passes run when a row is first seen, when it resizes and when the text on its
chips changes, rather than on every state tick: measured on a live instance at
207 state changes in 20 seconds for zero label measurements. Contributed by
**@UHaFnir**.

## The waste card says which bin

The reminder had no way of telling you what it covered. It watched every bin
on the card, and nothing in the editor said so — the natural reading was that
it watched the one bin you were looking at. `notify_entities` narrows it to
the bins you pick, and the panel now states the part that was never written
down: **one** notification goes out, naming every bin that is due, rather than
one per bin arriving in a row.

Three smaller things on the same card. A collection due today sat at 0% of the
timeline and one at the far end at 100%, each pulled back by half its own
width, so both hung over the edge of the track; they are inset by their radius
now. The timeline itself is optional — `show_timeline: false` — because it is
the part of the card you either read every day or never. And a reminder that
has started escalating is red rather than the colour of the bin: "put it out
now" on a grey Restmüll bin was washed in grey, which is what every card in
this suite looks like when it is switched off. The hero icon keeps the bin's
own colour, so it still says *which* bin.

## Old hardware is still a dashboard

A photograph of an iPod touch 7 started this. One icon covered half the screen,
the cards had no padding, and the tiles were holes with the wallpaper showing
through. The device is not the point — it is the last iOS 15 device, and so is
every iPad Air 2 still screwed to a kitchen wall.

Two features explain all of it. Safari learned container queries in 16.0 and
`color-mix()` in 16.2, and this suite uses both heavily.

The repair is not interesting in itself, but one thing about it is worth
knowing if you ever write CSS for this project. The ordinary way to fall back —
a plain declaration before the modern one — only works on a value the parser
can reject on sight. A declaration that contains `var()` anywhere is not
checked until after substitution, and one that fails *then* resolves to
`unset`, not to the declaration before it. That is the whole bug: the icon's
size arrived through a custom property, so its fallback never ran and an `<svg>`
at `width: auto` is 300×150 by definition. Every such value is now chosen in
script against a capability test, and the colour fallbacks live in an
`@supports not` block, which is the one place only those browsers look.

Nothing is detected about the device. There is no version check and no
user-agent string anywhere in this — a browser that has the feature gets
exactly what it got before, byte for byte, and a browser that does not gets a
solid fill instead of a tinted one. That ages better than a list of devices,
and it covers hardware nobody here has ever tested on.

What those browsers give up, concretely: fills are solid rather than tinted,
overlays that fade to transparent are simply not drawn, and the layouts that
adapt to a narrow *card* rather than a narrow screen keep their wide form.

## Security

Three findings from the HACS store review — thank you, **@frenck** — and a
fourth that his own reasoning led to. None was exploitable by the person
writing the card; they all turn on a value that person does not control, which
on a shared instance is the point.

- A `url` action was handed to `window.open` unchecked, and `window.open` runs
  a `javascript:` target in the page's own context with the user's session.
  Cards resolve templates anywhere in their config, so the value can come from
  an entity's state. It is now resolved against the current page and dropped
  unless it comes out `http:` or `https:`.
- An `entity_picture` and a media thumbnail went into `background-image: url()`
  unquoted, and a chip put a raw entity state into a CSS custom property
  *name*. A crafted value could close the declaration and add rules of its own.
  URLs now go through a checked, escaped `url("…")`, and anything reaching a
  property name is reduced to `[a-z0-9_]`.
- The review made its case about the `url` action by pointing out that a card
  renders templates anywhere in its config, so the value can come from an
  entity. That argument does not stop at one option: the same is true of every
  colour a card takes, and those went into inline styles as written. The limit
  is worth stating, because it is narrower than "CSS injection" sounds — a
  `style` attribute is a declaration list with no rule to escape, so no other
  element can be touched. What a crafted value *can* do is add declarations to
  the element it is on: cover the viewport with it, or make it fetch something.
  Colours are now checked where they are resolved and where they are assembled.
- A stored `notify_automation_id` was reused on trust, so a card config pasted
  from somewhere else could name any automation on the instance and have the
  editor overwrite it on save. It is reused only when it matches the shape this
  suite mints.

## Also fixed

- **The climate card's setpoint no longer breaks across two lines.** On a
  narrow card "18,0 °C" put the number on one line and dropped "°C" onto the
  next, where a unit reads as a second value. The number and the unit are one
  unbreakable reading now, and instead of wrapping, the number scales down with
  the width of the box it sits in — unchanged at its usual size wherever it
  fits.
- **The media card's indeterminate progress wave stays inside its bar.** A
  stream with no duration draws a short wave travelling along the track; it was
  drawn for the length of the whole bar and ran off the right edge, and the
  track line crossed it on its own midline, which made the animation look like
  it was running behind the bar.
- **A nav bar that scrolls starts at its first entry.** The bar spread its
  entries with `space-around`. On a bar too narrow for them that splits the
  overflow across both ends — and whatever lands before the scroll origin
  cannot be reached, because `scrollLeft` does not go below zero. The first
  entry sat half outside the bar and no amount of swiping brought it back.
  Current browsers resolve this themselves, which is why it took an iOS 15
  device to show it.
- **A picture the card refuses to load is a picture it does not have**, so the
  artwork falls back to its note and an avatar to its initials rather than
  leaving an empty box.
