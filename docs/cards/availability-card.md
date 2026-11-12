---
title: M3 Availability Card
type: m3-availability-card
category: system
display: Availability
summary: Unreachable devices, one row per device, with mute and undo
table_order: 7
section_order: 54
---

The devices Home Assistant cannot reach right now — one row per **device**,
not per entity, so a dead plug is one line and not its eight sensors. Rows
that went offline within the last hour sit under "Just went offline", older
ones under "Offline for a while", and a device offline for more than a day
turns red. When everything answers, the card is a single line.

<img src="docs/images/availability-card.png" alt="Availability Card" width="440">

<details>
<summary>Configuration, examples & options</summary>

```yaml
type: custom:m3-availability-card
```

That watches every device in the install. A device counts as **offline**
when every entity that decides it is `unavailable`. Buttons, update and event
entities do not decide: several integrations keep them available while the
device itself is gone. With `ignore_diagnostic` (the default) neither do
config and diagnostic entities such as link quality.

**Offline since** survives a restart. A restart writes `unavailable` again
and resets the entity's `last_changed`, so a device that has been dead for a
week would read "for 3 min." afterwards; the card asks the history once per
outage when it really began.

Narrowing it down:

```yaml
type: custom:m3-availability-card
exclude:
  integrations: [mobile_app]
  areas: [garage]
  entities:
    - "sensor.*_linkquality"
    - binary_sensor.old_doorbell
recent_minutes: 30
critical_hours: 12
```

`include` takes the same four lists; when it is set, only that part of the
install is watched.

### Muting

The bell on a row mutes it for `mute_default` (24 hours unless set
otherwise); a long press, a right click, the context-menu key or
Shift+Enter offer 1 hour, 24 hours, 7 days, until the device is back, or
permanently. A snackbar offers to undo it. Muted devices collect behind a
small chip at the bottom, where each can be shown again.

A mute covers one outage: once the device is reachable again it is
forgotten. **Permanently** is for a device whose outages are expected — a TV
that is off whenever its plug is — and stays through every later outage until
it is lifted by hand. To leave a device out entirely, including from the
"of Y" count, use `exclude` instead. Mutes are stored in Home Assistant's per-user frontend data, so
they hold on every device you are signed in on (with the browser's own
storage as a fallback).

### Quiet devices

Some devices are never marked `unavailable` — Home Assistant restores their
last state on every restart and nothing ever says they are gone. For those,
`stale_hours` flags a device whose entities have not reported for that long.
It only applies to the integrations listed in `stale_integrations`: many
sensors report only when something changes, and silence from them means
nothing. A quiet device gets a clock badge and "quiet for …" instead of the
cross. A restart of Home Assistant starts that count over. For Zigbee2MQTT,
switching on its *availability* feature is the better fix: it marks a dead
device `unavailable`, and the card sees it as offline.

```yaml
type: custom:m3-availability-card
stale_hours: 26
stale_integrations: [zigbee2mqtt]
```

### Configuration options

| Option | Type | Default | Description |
|---|---|---|---|
| `title` | string | "Availability" | Card title |
| `icon` | string | `mdi:wifi-off` | Header icon while something is offline |
| `include` | object | – | `devices`, `integrations`, `areas`, `entities`: watch only this |
| `exclude` | object | – | The same four lists, left out. Entity ids accept `*` and `?` |
| `include_orphan_entities` | boolean | `false` | Entities without a device as rows of their own |
| `ignore_diagnostic` | boolean | `true` | Leave config and diagnostic entities out of the decision |
| `recent_minutes` | number | `60` | Up to here a device is "Just went offline" |
| `critical_hours` | number | `24` | From here a device is shown in the error colour |
| `stale_hours` | number | – (off) | Flag devices that have not reported for this long |
| `stale_integrations` | list | `[]` | The integrations `stale_hours` applies to |
| `show_filters` | boolean | `true` | Integration chips, when more than one integration is involved |
| `max_items` | number | `10` | Rows before "+N more"; `0` shows all |
| `mute_default` | `1h` \| `24h` \| `7d` \| `forever` \| `permanent` | `24h` | What a tap on the bell mutes for (`forever`: until back online) |
| `warn_color` / `critical_color` | string | amber / red | The two state colours |
| `accent_color` | string | green | The "All online" colour |
| `detail_mode` | `sheet` \| `more_info` | `more_info` | For users without admin rights a tap opens the device's main entity; admins go to the device page |
| `glass_background`, `radius`, `corners`, `text_color`, `secondary_text_color`, `card_background`, `animation` | | | As on every card |

A tap on a row opens the device page in Home Assistant's settings for an
administrator, the detail of its main entity for everyone else.

</details>
