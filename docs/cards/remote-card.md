---
title: M3 Remote Card
type: m3-remote-card
category: household
display: Remote
summary: A remote control for a TV or streaming box — a directional ring instead of a 3×3 grid, with per-brand key profiles
table_order: 18
section_order: 45
---

A remote control in the suite's design system. One card with profiles rather
than one card per brand, because these devices differ in what they call each
key, not in the shape of a remote control.

<img src="docs/images/remote-card.png" alt="M3 Remote Card" width="440">

```yaml
type: custom:m3-remote-card
entity: remote.samsung_q90_series_55
```

## Why a ring

The standard remote card draws a 3×3 grid. Two of its nine cells are empty,
and the four that matter do not look like they belong to each other.

A ring says what the control is before it is read: one shape, four ways out of
the middle. The sectors are SVG donut wedges with a gap between them, the OK
button sits inside the hole with a band of background all the way round it —
smaller than the hole, deliberately, because overlapping the ring welds the two
into one blob and loses the thing that makes it readable at a glance.

Pressing a sector fills it in the accent colour. Pressing OK morphs it from a
circle to a squircle and shrinks it slightly; that morph is the card's visual
anchor, and it is also the only acknowledgement these devices give — a TV does
not report that it received a key.

**Holding a direction repeats it.** There is a pause before the first repeat,
which is what separates "one step down the list" from "scroll"; without it
every tap sends two.

**Arrow keys work** when the card has focus, which makes it usable from a
keyboard or a Stream Deck. `keyboard_control: false` turns that off. Tab is
never swallowed, so focus can still leave the card.

`dpad_size` (140–220, default 168) scales the whole control — the hole, the OK
button and the arrows all keep their proportions.

## Profiles

`profile` sets the defaults for key names, which blocks appear, and the accent
colour. Every one of them stays overridable.

| | samsung | google_tv | lg_webos | appletv | kodi | generic |
| --- | --- | --- | --- | --- | --- | --- |
| Directional ring | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Volume rocker | ✓ | ✓ | ✓ | ✓ | ✓ | if supported |
| Right column | channel | assistant | channel | — | — | — |
| Now playing | — | ✓ | — | ✓ | ✓ | ✓ |
| Transport row | ✓ | — | ✓ | — | ✓ | ✓ |
| Apps | chips | tiles | chips | tiles | chips | chips |
| Text entry | — | ✓ | — | — | — | — |

A TV gets no now-playing bar because the title of what is on a broadcast
channel is not something the integration knows, and a permanently empty row is
worse than none. Google TV gets no separate transport row because its transport
already lives in the now-playing bar, and a second copy underneath is
furniture.

## Commands, per integration

The card never invents a key. Each profile is a table of what that integration
actually accepts:

| Profile | How keys are sent | Example |
| --- | --- | --- |
| samsung | `remote.send_command` with the TV's own websocket codes | `KEY_UP`, `KEY_RETURN`, `KEY_CH_LIST` |
| google_tv | `remote.send_command` with Android keycodes, prefix dropped | `DPAD_UP`, `BACK`, `MEDIA_PLAY_PAUSE` |
| lg_webos | `webostv.button` — **not** `remote.send_command` | `UP`, `BACK`, `CHANNELUP` |
| appletv | `remote.send_command`, lower case | `up`, `select`, `skip_forward` |
| kodi | `kodi.call_method` with a JSON-RPC method | `Input.Up`, `Input.Back` |
| generic | plain `media_player` services only | `media_play_pause`, `volume_up` |

Volume and transport are routed through the `media_player` wherever the
integration supports them, even on a profile that has keycodes for them. Those
are the calls that also move the slider in Home Assistant's own UI; a TV muted
by `KEY_MUTE` never tells the media_player about it.

`key_overrides` replaces a single key without restating the table:

```yaml
key_overrides:
  info: { command: KEY_TOOLS }
```

## Two entities, one device

`androidtv_remote` splits the job: `remote.*` takes the keys, `media_player.*`
knows what is playing. Name either as `entity` and the card looks for the other
on the same object id, so neither has to be written out. `media_entity` names
it explicitly when they do not match.

## It leaves out what the device cannot do

This is the part worth knowing before configuring it. The card asks the
entities what they support and **omits** the controls they do not, rather than
drawing a button whose every press is swallowed:

- No `remote` entity and no own service domain → no ring at all, and a line
  saying so.
- No volume feature → no volume rocker.
- Nothing usable in the function row → no function row.

A **Chromecast** is the case that forced this. `media_player.*` on the `cast`
platform has no `remote` entity, no `send_command`, no volume feature and no
source list; what it does have is play/pause, seek, next/previous and good
metadata. So it gets a now-playing bar and a transport row and nothing else —
which is the honest card for that device.

**A Chromecast with Google TV is not the google_tv profile.** The profile needs
the **Android TV Remote** integration, which is built into Home Assistant and
pairs with a code shown on the television. Without it there are no directional
keys, whatever the box is called.

## Now playing

A 52px bar with artwork, title, app and position. The position counts on from
the last report rather than being drawn raw: `media_position` only updates when
something changes, so a bar drawn from it alone sits frozen at the moment the
track started. The integration also says *when* it last measured, which is what
makes counting on from it correct instead of a guess.

The card only ticks while it is on screen.

## Apps

`apps` is a list of `{ name, icon, color, app_id, action }`. Without `action` a
tap calls `media_player.select_source` with the name. Brand colours for the
common services are filled in automatically; `color` overrides.

Whatever is in front gets an outline and a stronger tint, matched loosely
against `app_name`, `app_id` and `source` — loosely because a player reports
"YouTube Music" for a list entry called "YouTube", and an exact compare would
mark nothing.

Left empty, the card offers the entity's own `source_list`. The editor's
**"take the entity's own sources"** button copies that list into `apps` so it
can then be renamed, coloured and reordered.

### Launching an app on Android TV

`remote.turn_on` takes an `activity`, and **it has to be a URI the app itself
claims**. This was measured against a Google TV box rather than reasoned about,
because three of the four formats people pass look reasonable and do nothing at
all:

| `activity` | Result |
| --- | --- |
| `org.smarttube.stable` (bare package) | nothing happens, silently |
| `market://launch?id=org.smarttube.stable` | nothing happens, silently |
| `android-app://org.smarttube.stable` | nothing happens, silently |
| `https://www.netflix.com/title` | opens Netflix |
| `vnd.youtube://` | opens SmartTube |

A bare package is not a URI, so Android has nothing to resolve and the request
is dropped without an error — which is what makes this worth writing down.

The flip side is that a URI only reaches the app that registered for that
domain. On the device this was tested on, `https://www.youtube.com` opened the
television's **web browser**, because the official YouTube app was not
installed, and `https://www.disneyplus.com` opened **Settings** for the same
reason. A tile that launches the wrong thing is worse than no tile, so it is
worth pressing each one once after configuring it.

A custom scheme counts as a URI, so an app with no web address is not
necessarily out of reach: SmartTube registers `vnd.youtube://` and opens on it
in under a second, despite being sideloaded and despite `android-app://` and
`market://` doing nothing for the same package. The question is never whether
the app has a website — it is which URI the app registered for.

**A scheme with no content in it may still make the app complain.** SmartTube
opens on a bare `vnd.youtube://` and then shows its own toast — *"Can't process
intent"* — because what arrived names no video, channel or playlist. The app is
open and usable; the message is the app's, lasts a few seconds, and there is no
way around it from here. Adding content to the URI silences it but forces that
content on every launch, which is worse. There is no neutral "just open
yourself" URI, and the integration's options page does not provide one either:
it ends at the same call.

The Android TV Remote integration's own options page takes a name and a package
id per app, which then appear in `source_list`. That path ends at the same
`send_launch_app_command`, so it does not rescue a package that no URI reaches.

### How to find the one that works

Launch the app by hand, then read `current_activity` off the remote entity to
learn its package — that much is easy. Going the other way, from a package to a
URI that reaches it, is trial and error, so **watch the television while you
try**, and poll the entity rather than reading it once:

```yaml
# Developer tools → Actions
action: remote.turn_on
target: { entity_id: remote.google_tv }
data: { activity: "vnd.youtube://" }
```

`current_activity` is a laggy witness. A single read a few seconds after the
call reported "nothing happened" for a launch that had plainly succeeded on
screen — which is how `vnd.youtube://` came to be written off here before the
person in front of the television said otherwise.

### Switching inputs on a Samsung

`KEY_HDMI1` … `KEY_HDMI4` appear in every Samsung key list on the internet and
**do nothing** on a 2020 Tizen set. What works is the source bar, and that bar
is a list of *connected devices* — "TV", "Chromecast", "PlayStation 5" — not a
fixed HDMI 1–4, so a card cannot know the positions without being told them
once.

It also opens with the highlight on whatever input is **currently active**,
which means "press right three times" lands somewhere different depending on
where you started. The fix is to walk to the edge first: the row does not wrap,
so more LEFT presses than there are entries always ends on the leftmost one, and
the count from there is exact.

`remote.send_command` takes a list, so the whole thing is one action:

```yaml
apps:
  - name: PlayStation
    action:
      action: perform-action
      perform_action: remote.send_command
      target: { entity_id: remote.samsung_q90 }
      data:
        delay_secs: 0.3
        command:
          - KEY_SOURCE
          - KEY_LEFT   # ×8 — anchor on the leftmost entry
          - KEY_LEFT
          - KEY_LEFT
          - KEY_LEFT
          - KEY_LEFT
          - KEY_LEFT
          - KEY_LEFT
          - KEY_LEFT
          - KEY_RIGHT  # ×n — n is the entry's position, counted from 0
          - KEY_RIGHT
          - KEY_RIGHT
          - KEY_ENTER
```

Count the positions off the bar once, including entries for devices that are
switched off — they stay in the list and still take up a position. `delay_secs`
below about 0.25 starts dropping presses.

**In daily use this did not hold up.** On the author's set the HDMI buttons
built this way moved a few steps from wherever the highlight happened to be and
landed somewhere different each time. What works reliably is the plain
`KEY_HDMI`: it steps to the next HDMI input on every press, so it cannot jump to
a particular one, but it never lands anywhere unexpected. That is what the
author's dashboard uses now.

## Text entry

On Android TV this is the biggest everyday win. The integration types any
command it does not recognise as a keycode, so a search box on a television
becomes a phone keyboard instead of twenty-six presses of a d-pad. The keyboard
button appears only on a profile whose integration accepts it.

## The assistant button

It fills with Google's own four colours and squares off while it listens. That
is a **gesture, not a status**: nothing tells Home Assistant when the microphone
closed, so it runs for `assistant_timeout` (2.2 s) and resets. Configurable for
whoever finds the default out of step with their device.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `entity` | string | — | **Required.** A `remote.*` or `media_player.*` entity. |
| `media_entity` | string | same object id | The second entity, when commands and metadata live apart. |
| `power_entity` | string | — | When power runs through something else, e.g. a smart plug. |
| `profile` | string | from the entity | `generic`, `samsung`, `google_tv`, `lg_webos`, `appletv`, `kodi`. |
| `name`, `icon` | string | from the entity | Header title and icon. |
| `key_overrides` | map | — | Per-key replacements; see above. |
| `dpad_size` | number | `168` | 140–220. Scales the whole ring. |
| `keyboard_control` | boolean | `true` | Arrow keys and Enter drive the card while it has focus. |
| `repeat_interval` | number | `250` | Milliseconds between repeats while a direction is held. |
| `right_column` | string | by profile | `auto`, `channel`, `assistant`, `custom`, `none`. |
| `right_buttons` | list | — | With `right_column: custom`: `{ key, icon, label, action }`. |
| `show_rocker_labels` | boolean | `true` | The small VOL / CH captions. |
| `assistant_timeout` | number | `2200` | How long the assistant animation runs. |
| `function_buttons` | list | by profile | The five-button row; same shape as `right_buttons`. |
| `show_transport` | boolean | by profile | The previous / play-pause / next row. |
| `show_numpad` | boolean | `false` | A 3×4 number pad. |
| `apps` | list | `source_list` | `{ name, icon, color, app_id, action }`. |
| `app_style` | `chips` \| `tiles` | by profile | — |
| `show_apps` | boolean | `true` | — |
| `max_apps` | number | `0` | `0` shows all. |
| `show_now_playing` | boolean | by profile | — |
| `power_toggle` | boolean | `true` | One button that toggles, instead of two. |
| `haptics` | boolean | `true` | Haptic feedback on the companion app. |
| `accent_color`, `text_color`, `secondary_text_color`, `card_background`, `glass_background`, `radius`, `corners`, `animation`, `card_version` | — | — | The usual shared appearance options. |

## States

**Off is not unavailable.** Most of these devices still accept a key press in
standby, and the one that wakes them is on this card, so an off device is
dimmed rather than disabled. Only a genuinely unreachable entity has its
controls blocked, and even then the power button stays live.

Commands are fire-and-forget: there is no optimistic state, because there is
nothing to be optimistic about. Every button instead gives immediate visual
feedback, which is what stands in for the acknowledgement the device never
sends.
