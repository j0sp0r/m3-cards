---
title: M3 Camera Card
type: m3-camera-card
category: presence
display: Camera
summary: Cameras and doorbells, any vendor — a still at rest, live on demand, a ring that takes the card over
table_order: 6
section_order: 60
---

Cameras and video doorbells from any integration — Ring, Frigate, Reolink,
UniFi Protect, or any `camera` entity. At rest it shows a still with the time
it was taken; **Watch live** streams through Home Assistant's own player. When
the doorbell rings the card turns blue, switches to that camera, goes live and
offers **Talk**, **Open door** and **Ignore**. Underneath, the day's events as
a scrolling timeline, and chips to switch between cameras.

<img src="docs/images/camera-card.png" alt="Camera Card" width="440">

<details>
<summary>Configuration, examples & options</summary>

```yaml
type: custom:m3-camera-card
cameras:
  - camera.front_door
```

### States

- **At rest:** the camera's name, "Last: Doorbell at 14:12", a battery pill
  (red below 30 %) and the still with "Still · 14:12". The still is fetched
  again every `snapshot_refresh` seconds, but only while the card is on
  screen, and at once after an event.
- **Motion, a person, a parcel:** the icon takes the event's colour (green
  for a person, amber for a parcel), the line under the name says what was
  seen, and a pill on the picture names it. With `auto_live_on_motion: true`
  the card goes live by itself.
- **Ringing** (a doorbell event in the last `ring_timeout` seconds): the card
  becomes the blue info container, its icon pulses, and "Someone is at the
  door" is announced to screen readers. It switches to the ringing camera and
  goes live; the buttons become Talk (only with a `talk_action`), Open door
  (only with a `door_action`) and Ignore. Without Talk, Open door takes the
  whole width. Chips and timeline step aside. After Ignore or the timeout the
  card is back at rest; the next ring brings it back.

### Live view

Live only starts on demand — Watch live, a ring, or motion if you turn that
on — and stops by itself after `live_idle_timeout` seconds without a touch,
when the card leaves the screen, when the tab goes to the background, or when
you pick another camera. That spares a battery camera and a phone's data.

`live_provider: auto` uses `ha-camera-stream`, Home Assistant's own player,
which picks WebRTC or HLS for the camera. `webrtc` asks for Home Assistant's
WebRTC player where the frontend has it, `hls` leaves the choice to
`ha-camera-stream`, and `image` never streams. A camera without the stream
feature shows stills whatever is set. An unreachable camera shows a
placeholder; a still that fails to load is tried again after 10, 30 and 60
seconds, then not until the next event.

Switching never shows an empty picture: starting live, the still stays until
the stream shows a frame and then fades into it; stopping, the stream's last
frame becomes the still, until a fresh one has loaded.

The full-screen button uses the browser's full-screen mode, or opens the
camera's more-info where there is none (Safari on an iPhone).

### Open the door

`door_action` is any action: pressing a button, unlocking a lock, a switch
pulse, a script. It only ever runs from a tap on its button, and asks first
unless `confirmation: false`. The button follows the door: a closed lock at
rest; after the tap it turns squarer and the lock opens while the door takes
its moment ("Opening …"); then "Door opened" in a lighter tone, with a fill
that drains over the seconds left, until the lock snaps shut and the button
is a pill once more. Without a
`feedback_entity` "Door opened" shows for three seconds; with one, from the
moment it reports on, open or unlocked until it no longer does (an `event.*`
one: three seconds after its event). If the service call fails, a red
snackbar says why and the lock closes again.

`style: slide` makes it a lock to slide across a track instead: past the end
the door opens, with no question, since the slide is one; let go short of it
and the lock springs back. It then waits at the end while the door opens and
is open, and springs home as it locks again. On a card with a camera the
slider takes a row of its own under Watch live; while it rings, under Talk.
With reduced motion there is nothing to slide, and the button with its
question comes back; the keyboard gets the question too.

```yaml
door_action:
  style: slide
  tap_action:
    action: perform-action
    perform_action: button.press
    target:
      entity_id: button.hallway_open_door
```

### Talk

The card sends no audio itself. `talk_action` starts whatever does — an
integration's two-way audio service, a script, the vendor's app through a
URL — and the card shows "Two-way audio on" until Talk is tapped again, when
`stop_action` runs if there is one. Without a `talk_action` there is no Talk
button.

### Over the dashboard

`ring_overlay: fullscreen` also opens the ringing card over the dashboard:
centred with a dimmed background, as a sheet from the bottom on a phone. It
needs no Browser Mod.

> **This is not a notification.** The overlay only appears while the card is
> on the dashboard view that is open. A phone in a pocket, another view or a
> closed app sees nothing. For a ring you must not miss, use a notification
> automation as well.

### Events

The timeline reads the history of the camera's event entities over the last
`events_hours` (default 24): an `event.*` entity counts each new event, its
kind taken from `event_type`; a `binary_sensor.*` counts each time it turns
on. New events are added as they happen, without reading the history again.

Pictures per event need a source: `snapshot_url_template` with `{camera}`,
`{entity}`, `{event_type}`, `{timestamp}` (epoch seconds) and `{id}` (the
event's `event_id`, if it carries one). Without one, or when a picture fails,
each event shows a tonal tile with its icon. A tap opens the event's
more-info, a URL (`event_tap: { url_template: … }`) or a media browser path
(`event_tap: { media_path: … }`). `events_all_action` adds an "All" link over
the timeline — to your Frigate or media view, say.

### Examples

**Ring**, with the door opened through a separate relay:

```yaml
type: custom:m3-camera-card
cameras:
  - camera: camera.front_door_live_view
    name: Front door
    doorbell: event.front_door_ding
    motion: event.front_door_motion
    battery: sensor.front_door_battery
    door_action:
      tap_action:
        action: perform-action
        perform_action: switch.turn_on
        target:
          entity_id: switch.door_opener   # a relay that turns itself off
      feedback_entity: binary_sensor.front_door_contact
```

**Frigate**, with a picture per event:

```yaml
type: custom:m3-camera-card
cameras:
  - camera: camera.garden
    person: binary_sensor.garden_person_occupancy
    motion: binary_sensor.garden_motion
    snapshot_url_template: /api/frigate/notifications/{id}/thumbnail.jpg
events_all_action:
  action: navigate
  navigation_path: /frigate   # wherever your Frigate panel lives
```

The `{id}` needs an event entity that carries Frigate's `event_id`; for a
binary sensor alone, leave the template out and the tiles show icons.

**A generic RTSP camera through go2rtc**: add the stream to go2rtc (built
into Home Assistant), make it a camera — the Generic Camera integration with
the RTSP URL, say — and the card streams it through WebRTC:

```yaml
type: custom:m3-camera-card
cameras:
  - camera: camera.driveway
    motion: binary_sensor.driveway_motion
    live_provider: webrtc
snapshot_refresh: 30
```

**An intercom without a camera** — the Ring Intercom, say, which only rings
and opens the door. Leave `camera` out and give the doorbell: the card has no
picture then, Open door takes the wide button, and the rest — the ring, the
door with its confirmation, the timeline — works the same. An `event.*`
feedback entity (the intercom's "unlocked") shows "Door opened" for a moment
after each event.

```yaml
type: custom:m3-camera-card
cameras:
  - name: Hallway
    doorbell: event.hallway_ding
    battery: sensor.hallway_battery
    events:
      - event.hallway_intercom_unlock
    door_action:
      tap_action:
        action: perform-action
        perform_action: button.press
        target:
          entity_id: button.hallway_open_door
      feedback_entity: event.hallway_intercom_unlock
```

A doorbell without a camera can also sit among cameras, as one more chip.

**Several cameras**, with buttons of your own:

```yaml
type: custom:m3-camera-card
default_camera: camera.front_door
cameras:
  - camera: camera.front_door
    doorbell: event.front_door_ding
    person: binary_sensor.front_door_person
    actions:
      - name: Porch light
        icon: mdi:outdoor-lamp
        tap_action:
          action: perform-action
          perform_action: light.toggle
          target:
            entity_id: light.porch
      - name: Siren
        icon: mdi:bullhorn
        confirmation:
          text: Sound the siren?
        tap_action:
          action: perform-action
          perform_action: siren.turn_on
          target:
            entity_id: siren.outdoor
  - camera.garden
  - camera.driveway
```

Up to three round buttons sit beside Watch live; more go into a menu.
`primary: true` keeps an action in front.

### Configuration options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `cameras` | list | – | One or more cameras: a `camera.*` id, or an object with the fields below |
| `cameras[].camera` | entity | – | The camera. Leave it out for an intercom without one; `doorbell` is then required |
| `cameras[].name` / `icon` | string | the entity's | Name and icon for header and chip |
| `cameras[].battery` | entity | – | Battery level in %, as a pill in the header |
| `cameras[].doorbell` | entity | – | `event.*` or `binary_sensor.*` that rings |
| `cameras[].person` / `package` / `motion` | entity | – | `event.*` or `binary_sensor.*` per kind of detection |
| `cameras[].events` | list | – | Further event entities for the timeline |
| `cameras[].live_provider` | `auto` \| `webrtc` \| `hls` \| `image` | `auto` | How live video is shown. See [Live view](#live-view) |
| `cameras[].snapshot_url_template` | string | – | A picture per event. See [Events](#events) |
| `cameras[].event_tap` | `more-info` \| `{url_template}` \| `{media_path}` | `more-info` | Where a tap on an event goes |
| `cameras[].actions` | list | – | Buttons of your own: `name`, `icon`, `tap_action`, `confirmation`, `primary` |
| `cameras[].door_action` | object | – | `tap_action`, `style` (`button` \| `slide`, default `button`), `confirmation` (default `true`, never with `slide`), `feedback_entity`, `name`, `icon` |
| `cameras[].talk_action` | object | – | `tap_action`, `stop_action`, `name`, `icon` |
| `actions` / `door_action` / `talk_action` | | – | For every camera that has none of its own |
| `default_camera` | entity | the first | The camera shown first |
| `show_events` | boolean | `true` | The timeline |
| `events_hours` | number | `24` | How far back the timeline reaches |
| `max_events` | number | `10` | Events in the timeline |
| `events_all_action` | action | – | An "All" link over the timeline |
| `ring_overlay` | `card` \| `fullscreen` | `card` | Also open the ringing card over the dashboard. Not a notification |
| `ring_timeout` | number | `60` | Seconds a ring and a detection count as current |
| `auto_live_on_motion` | boolean | `false` | Go live on motion or a person |
| `live_idle_timeout` | number | `60` | Seconds without a touch before live stops |
| `snapshot_refresh` | number | `10` | Seconds between stills at rest; `0` only on an event |
| `detail_mode` | `more-info` \| `sheet` | `more-info` | Where the camera and event details open |

</details>
