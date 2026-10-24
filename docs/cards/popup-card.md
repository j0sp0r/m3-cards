---
title: M3 Popup Card
type: m3-popup-card
category: household
display: Popup
summary: Other cards in a bottom sheet, opened by a URL hash — in place of a Bubble Card pop-up
table_order: 11
section_order: 47
---

Other cards — M3 ones or any other — in a bottom sheet that slides up over
the dashboard. The sheet is the one the detail view opens in
(`detail_mode: sheet`): the same grip, the same motion, the same close
button, and on a desktop it is centred instead of climbing out of the
bottom edge.

<img src="docs/images/popup-card.png" alt="M3 Popup Card — the sheet, here as the Thermometer popup" width="440">

The card is invisible on the dashboard and takes no space there. It opens
when the page's address ends in its hash, so anything that navigates there
opens it:

```yaml
type: custom:m3-button-card
name: Remotes
icon: mdi:remote
tap_action:
  action: navigate
  navigation_path: "#remotes"
```

That is how Bubble Card's pop-ups work, so a dashboard built on them keeps its
buttons as they are: replace the `bubble-card` pop-up with this card under the
same hash and the buttons open it. Back closes it — Android's back gesture
included — and closing it any other way takes the hash back out of the
address. A link to the page with the hash opens the popup straight away.

The sheet is frosted glass by default, as every card in the suite is, and the
cards in it keep their own surface. Home Assistant's own cards (sensor, tile,
entities) get the thin rim the M3 cards draw, so they stay outlined even in a
theme that gives them none.

The cards sit on twelve columns, as in a sections view: a card with
`grid_options: { columns: 6 }` takes half the width, so two share a row. A card
that says nothing takes the full width.

The cards inside are built the first time the popup opens, not with the
dashboard, and kept from then on: ten popups cost nothing until used, and a
card keeps its state between openings.

In edit mode the card shows as a dashed placeholder naming its hash, so it can
be found and edited.

<details>
<summary>Configuration, examples & options</summary>

```yaml
type: custom:m3-popup-card
hash: "#remotes"
title: Remotes
icon: mdi:remote
cards:
  - type: custom:m3-remote-card
    entity: media_player.living_room_tv
  - type: tile
    entity: switch.tv_socket
```

### Configuration options

| Option | Type | Default | Description |
|---|---|---|---|
| `hash` | string | – | **Required.** The hash that opens it. The leading `#` is optional |
| `title` | string | – | Heading beside the close button |
| `icon` | string | – | Icon before the heading, and on the edit-mode placeholder |
| `glass_background` | boolean | `true` | Frosted glass behind the cards, as on every card. `false` makes the sheet the solid card colour |
| `card_background` | string | – | Override the sheet's background colour |
| `text_color` | string | – | Text colour on the sheet — set as the theme's text colour there, so the cards in it follow too |
| `secondary_text_color` | string | – | Secondary text colour on the sheet, for the cards in it as well |
| `animation` | string | `auto` | `auto`, `on` or `off`. `off` opens and closes the sheet in place, without the slide |
| `cards` | list | `[]` | The cards in the sheet, in display order. Any Lovelace card — M3 or otherwise. Each one's `grid_options.columns` (of 12) sets its width |

</details>
