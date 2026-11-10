---
title: M3 Media Card
type: m3-media-card
category: light
display: Media
summary: Media player with artwork colors, wave sliders and a library browser
table_order: 1
section_order: 16
---

A media player card with a compact view (off/idle) and a full playback
view: artwork with color extraction for the accent, a locally interpolated
progress wave slider, transport controls (shown/hidden per feature),
a volume wave slider, source selection, and a browser for the player's
media library and queue.

<img src="docs/images/media-card.png" alt="Media Card" width="440">

<details>
<summary>Configuration, examples & options</summary>

```yaml
type: custom:m3-media-card
entity: media_player.living_room
```

The playback position is interpolated client-side from `media_position` +
`media_position_updated_at`, so progress keeps advancing smoothly between the
player's own state updates. The wave flattens to a straight line when playback
is paused, so the bar carries the play state; a stream with no duration shows a
travelling wave segment and a **Live** chip instead of a remaining time.

Transport buttons, shuffle/repeat, seeking and the library all appear only when
the entity reports the matching `supported_features`. This matters more than it
sounds: a Chromecast playing a single local file reports neither
`PREVIOUS_TRACK` nor `NEXT_TRACK`, so those buttons are legitimately absent —
the card will not offer an action the player would reject. The same player over
Spotify does report them, and they appear.

Players that report no metadata at all (a Chromecast on the Default Media
Receiver, for instance) fall back to the file path behind `media_content_id`:
`…/<Artist>/<Album>/<Track>.mp3` becomes artist, album and title. Real metadata
always wins over this.

### Library and queue

Where the player supports `BROWSE_MEDIA`, a row at the bottom of the card opens
Home Assistant's own media browser: breadcrumb navigation, a thumbnail or a
`media_class` icon per row, folders to drill into and playable entries that
start on tap. Where the integration also exposes a queue, a second tab lists
what is coming up and the collapsed row reads "Up next: …" instead of "Browse
library"; integrations without one (Cast and Spotify among them) simply do not
get that tab rather than showing an empty one.

A level with thousands of entries is capped at 100 rows with a note pointing
further in — one real library here returns 2147 artist folders in a single
level, and rendering them all locks the frame.

### Compact playing layouts

For a home view where the full player is too tall, `playing_layout` shrinks
what is playing to a row:

- `compact` — cover, title (up to two lines) and artist, with previous,
  play/pause and next beside them, over the progress wave with its times; the
  music picker's button sits at the end of the wave. About 130 px tall.
- `mini` — the row alone, about 80 px: the progress is a thin bar under the
  title, and the buttons default to the music picker, play/pause and next.

`compact_buttons` picks the buttons (`previous`, `play`, `next`, `browse`);
each still appears only when the player supports it. Tapping the cover or the
title opens the player's detail. The queue and library open in a sheet from
below instead of growing the card; picking a track plays it and closes the
sheet. Volume, chips and source selection belong to the full layout.

```yaml
type: custom:m3-media-card
entity: media_player.living_room
playing_layout: compact
```

### Configuration options

| Option | Type | Default | Description |
|---|---|---|---|
| `entity` | string | – (required) | `media_player` entity |
| `name` | string | entity's friendly name | Title in the compact view |
| `playing_layout` | `full` \| `compact` \| `mini` | `full` | How the card shows what is playing; see *Compact playing layouts* |
| `compact_buttons` | list | `[previous, play, next, browse]`; `[browse, play, next]` for `mini` | The buttons of the compact layouts |
| `show_source_select` | boolean | `false` | Source-select pills (if supported by the entity) |
| `show_shuffle_repeat` | boolean | `false` | Shuffle/repeat buttons (if supported); repeat cycles off → all → one |
| `strip_track_number` | boolean | `true` | Drop a leading track number from the title (`07 - Enjoy the Silence` → `Enjoy the Silence`). Bounded to one or two digits, so `1979` and `365 Dreams` survive |
| `time_display` | `remaining` \| `total` | `remaining` | Right-hand time: remaining with a minus sign, or the total length |
| `show_device_chip` / `show_source_chip` | boolean | `true` | The chip naming the player and the one naming its source or app, each hideable |
| `meta_chips` | list | `[]` | Extra chips beside device and source: `track`, `year`, `bitrate`. Each is rendered only when the player actually reports the attribute — note that HA has no standard bitrate attribute, so most integrations never fill that one |
| `show_volume` | boolean | `true` | The volume row |
| `volume_down_action` / `volume_up_action` | action | – | Replace the slider with two step buttons running these actions, e.g. scripts sending IR codes to a soundbar. A player that can only step its volume gets the buttons without them, calling `volume_down` / `volume_up` |
| `show_browser` | boolean | `true` | The library/queue section (only ever shown for players reporting `BROWSE_MEDIA`) |
| `default_tab` | `queue` \| `library` | `library` | Which tab opens first, where both exist |
| `browse_height` | number | `190` | Max height of the browse list in px |
| `use_artwork_color` | boolean | `true` | Extract the accent color from the artwork instead of `accent_color` |
| `accent_color` | string | purple (media palette); `primary` on a card added from the card picker | Progress/volume color when `use_artwork_color: false` |
| `text_color` / `secondary_text_color` | string | theme default | Title vs. artist/album |
| `card_background` | string | glass/solid background | Card background |
| `animation` | `auto` \| `on` \| `off` | `auto` | Progress/volume animation; `auto`/`on` respect `prefers-reduced-motion` |
| `glass_background` | boolean | `true` | Frosted glass background |
| `radius` / `corners` | number / object | `28` | Corner radius, optional per corner |

</details>
