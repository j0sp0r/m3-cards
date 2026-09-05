---
title: M3 Nav Card
type: m3-nav-card
category: household
display: Nav
summary: A navigation bar for the dashboard, in five variants, with a pull-up drawer
table_order: 8
section_order: 34
---

A navigation bar for the dashboard: one row of entries that light up for the
page you are on. Five variants of the same bar, from a plain header to a
drawer you pull up over the view, plus per-entry badges, templates and
submenus — the feature set of the community's Navbar Card, drawn in this
suite's own design language rather than in its.

Added from the card picker, it arrives already filled in from the dashboard it
landed on: the first three views become entries and the next five go behind the
round button, which is the arrangement a bar with more pages than fit ends up in
anyway. It is a suggestion and nothing more — the entries are ordinary config
from that moment on, to edit, reorder or delete, and the bar never reads the
dashboard again by itself. "Import views" in the editor repeats the reading at
any time.

<img src="docs/images/nav-card.png" alt="Nav Card — five variants of the same bar" width="440">
<img src="docs/images/nav-card-sheet-list.png" alt="Nav Card — the drawer open, shortcuts as rows" width="220">
<img src="docs/images/nav-card-sheet-grid.png" alt="Nav Card — the drawer open, shortcuts as tiles" width="220">

<details>
<summary>Configuration, examples & options</summary>

```yaml
type: custom:m3-nav-card
style: footer          # header | footer | segmented | floating | sheet
items:
  - name: Home
    icon: mdi:home
    path: /lovelace/0
  - name: Energy
    icon: mdi:flash
    path: /lovelace/energy
  - name: Garden
    icon: mdi:sprout
    path: /lovelace/garden
```

### The five variants

| Variant | What it is | When it is the right one |
| --- | --- | --- |
| `header` | Docked to the top edge, full width | A desktop dashboard where the bar belongs with the title, not with the thumb |
| `footer` | Docked to the bottom edge, full width | The phone default: where a thumb already is |
| `segmented` | An inline pill group, in the card flow | A view switcher for one section, not for the dashboard — the only variant that scrolls with the page |
| `floating` | A detached rounded bar over the content | The same job as `footer`, with the content visible underneath it |
| `sheet` | `floating` plus a drawer that pulls up | When the bar should also hold something: shortcuts, a scene, a card |

`header`, `footer`, `floating` and `sheet` position themselves against the
screen, so their slot in the grid collapses and they do not take a row of the
view. `segmented` is an ordinary card and sits wherever it is placed.

While the dashboard is being edited — and in the card picker's preview — every
variant renders in the flow instead. A docked bar has no slot to click on, so
without this the card could be added but never opened again.

By default a docked bar spans the whole content area, which is right on a phone
and usually far too much on a desktop, where the entries end up nowhere near
each other. `max_width` caps it and centres it: a number in px, any CSS length,
or `fit` to make it exactly as wide as its entries need.

```yaml
type: custom:m3-nav-card
style: footer
max_width: fit        # or 600, or "40rem"
items: [...]
```

### Home Assistant's own tabs

The card does not touch them, and cannot: a card lives inside its own box, and
Home Assistant offers no supported way to reach out of it and hide the header.
So a bar added to a dashboard that still shows its tab strip gives you two
navigations at once. Two ways out, and they combine:

**`subview: true` on the views you navigate to.** Built into Home Assistant, no
add-on. A subview is left out of the tab strip entirely and is reached by
navigating to it — which is exactly what this bar does. Views you never wanted
as tabs stop being tabs.

**Hide the header with [kiosk-mode](https://github.com/NemesisRE/kiosk-mode).**
At the top of a dashboard's raw config, and worth scoping to the width that
needs it:

```yaml
kiosk_mode:
  mobile_settings:
    hide_header: true
```

That pairs with the desktop/mobile split above: the phone drops Home Assistant's
header and keeps only this bar, the desktop keeps its tabs. Hiding the header
everywhere also hides the pencil that opens the editor — kiosk-mode documents
how to get back in, and `?disable_km` on the URL is the short answer.

Needing a second add-on to make the first one look right is not a good answer,
and a later version should carry it: the card can find the header from where it
sits, and hiding it only while a bar is on the view would scope it better than
any per-dashboard setting can. It is not in this release because reaching into
Home Assistant's own DOM is unsupported and breaks on its schedule, and because
a header that fails to come back takes the editor with it. Until then, the two
above are the honest answer.

### Desktop and mobile

The usual pairing is a header on a wide screen and a footer or sheet on a
phone, which is two layouts of one card rather than two cards:

```yaml
type: custom:m3-nav-card
desktop:
  style: header
mobile:
  style: sheet
breakpoint: 768
items: [...]
```

The switch is made by measuring the card's **own** box, not the window. A card
in a narrow column on a wide screen is narrow, which is what a media query
would get wrong. Either block can also hide the bar outright at that width
(`hidden: true`), and either can override `show_labels`.

### Templates

`name`, `icon`, `color`, `hidden`, `disabled` and the badge accept Jinja2, and
subscribe to it — the value is pushed by Home Assistant whenever anything the
template reads changes, rather than polled or re-rendered on a timer:

```yaml
items:
  - name: "{{ states('sensor.garden_mode') | title }}"
    icon: >-
      {{ 'mdi:water' if is_state('switch.irrigation', 'on') else 'mdi:sprout' }}
    path: /lovelace/garden
    hidden: "{{ not is_state('person.me', 'home') }}"
```

Only fields that actually contain `{{` or `{%` open a subscription, and two
entries using the identical template share one. They are all closed when the
card leaves the page.

### Badges

```yaml
items:
  - name: Alerts
    icon: mdi:bell
    path: /lovelace/alerts
    badge:
      count_entities: [binary_sensor.leak_kitchen, binary_sensor.leak_bath]
    badge_style: count       # dot | count | text
```

A badge takes a `template`, an `entity` whose state it shows, or
`count_entities` — how many of them are on. Whichever it is, `0`, `off`,
`unavailable`, `unknown` and an empty value hide it: a bar of grey zeroes
reads as broken rather than as quiet. `show_if` gates it on a second template.

### Submenus

An entry with a `submenu` opens a floating menu instead of navigating. It
grows out of the button that opened it and closes on a selection, a click
outside, or Escape.

```yaml
submenu_trigger: tap     # tap | hold
items:
  - name: More
    icon: mdi:dots-horizontal
    submenu:
      - name: Printer
        icon: mdi:printer-3d
        path: /lovelace/printer
      - name: Network
        icon: mdi:lan
        path: /lovelace/network
```

With `submenu_trigger: hold` the entry navigates on a tap as usual and the
menu comes up on a long press instead — which is the right way round when the
entry is a real destination and the menu is a shortcut to its neighbours.

### The sheet

```yaml
type: custom:m3-nav-card
style: sheet
sheet_title: Quick access
sheet_action:
  icon: mdi:plus
  tap_action:
    action: navigate
    navigation_path: /lovelace/edit
sheet_default: collapsed   # collapsed | expanded | remember
sheet_max_height: 60       # vh, or any CSS length as a string
snap_points: [0, 0.5, 1]   # optional half-open stop
sheet_cards:
  - type: custom:m3-button-card
    entity: light.living_room
items: [...]
```

The drawer holds two things. `sheet_items` are shortcut tiles — the same
entries people usually hide behind a "more" submenu, laid out where you can see
them at a glance instead of having to open a menu first. They draw two ways:
`grid` fits the most destinations in the least space, an icon with a label
under it; `list` gives each one a full-width row with an icon, a name, a second
line and a chevron. The second line (`secondary`) takes free text, a template,
or an entity id whose state it shows — which is what makes a row worth its
extra space. The editor has a
button that copies an item's submenu straight in. Below them, `sheet_cards`
takes any Lovelace cards at all, every M3 card included:

```yaml
sheet_title: More
sheet_items:
  - name: Cameras
    icon: mdi:cctv
    path: /lovelace/cameras
  - name: Restart
    icon: mdi:power
    tap_action:
      action: call-service
      service: homeassistant.restart
      confirmation:
        text: Really restart Home Assistant?
sheet_cards:
  - type: custom:m3-button-card
    entity: light.living_room
```

Careful with the per-width blocks here: the root `style` only applies where a
block does not override it. A card set to `sheet` with `mobile: { style:
floating }` has a drawer full of shortcuts and no grip on the phone — the one
device it was built for. Nothing errors; the drawer is simply not reachable
there. The editor now says so.

A drawer with nothing in it — no tiles, no cards, no title — has nothing to
pull open, so the card renders as a plain floating bar instead of a grip that
opens an empty box. The editor says so rather than leaving it to be discovered
by pulling.

An action carrying a `confirmation` asks before it runs — worth knowing before
putting "restart Home Assistant" one tap away. It is dragged by the grip, by a swipe up
from the bar, or opened with a tap on the grip. A release goes to the nearest
stop — unless it was a flick, which goes the way it was thrown whatever
position the sheet was in at the time.

Dragging **inside** the drawer is the interesting case: the content scrolls
normally, and the sheet only takes the gesture over when the content is
already scrolled to the top and the finger is going down. That is what every
native bottom sheet does, and it is the reason the browser's own scrolling —
including its momentum, which no JavaScript reimplementation matches — is left
alone everywhere else.

`sheet_default: remember` keeps the open state per browser, or in an
`input_boolean` via `sheet_state_entity`, which syncs it between devices and
lets an automation open the drawer. Under a 600px-tall viewport (a phone in
landscape) the height cap drops to 50vh, or the drawer would leave nothing of
the page it is a drawer for.

Two limits worth knowing. In edit mode the sheet renders inline and pinned
open, because a drawer docked to the screen covers the card the editor is
trying to show. And only the first sheet on a view docks itself: a second one
would sit on top of the first with no way to tell which grip belongs to which,
so it renders inline instead.

### Visibility

`hidden` takes a Jinja2 template and drops the whole bar while it is true. For
visibility by user, device or screen size, use Home Assistant's own visibility
feature in the card editor — it already does exactly that for every card, and
a second implementation inside this one would only fight it.

### Migrating from Navbar Card

| Navbar Card | Here |
| --- | --- |
| `routes` | `items` |
| `routes[].url` | `items[].path` |
| `routes[].label` | `items[].name` |
| `routes[].icon` / `icon_selected` | `items[].icon` (a template can switch it) |
| `routes[].badge.template` | `items[].badge.template` |
| `routes[].badge.color` | `items[].badge.color` |
| `routes[].submenu` | `items[].submenu` |
| `routes[].hidden` | `items[].hidden` |
| `routes[].tap_action` / `hold_action` | same names |
| `desktop.position: top/bottom` | `desktop.style: header/footer` |
| `desktop.show_labels` | `desktop.show_labels`, or `label_visibility` |
| `desktop.min_width` | `breakpoint` (the card's width, not the window's) |
| `mobile.show_labels` | `mobile.show_labels` |
| `styles` (free CSS) | `styles` (a property/value map) |
| `template` for a whole route list | — no equivalent; entries are configured, individually templated |
| `haptic` | `haptics` |

`preload_views` is accepted and stored but currently does nothing: Home
Assistant gives a custom card no way to warm another view, and the only
workaround — navigating there invisibly and back — would flicker and leave a
bogus history entry. The option is kept so a future version can implement it
without a breaking config change.

### Options

| Option | Default | What it does |
| --- | --- | --- |
| `items` | — | The entries. Each: `name`, `icon`, `path`, `match`, `color`, `badge`, `badge_style`, `hidden`, `disabled`, `submenu`, `tap_action`, `hold_action`, `double_tap_action` |
| `style` | `footer` | `header`, `footer`, `segmented`, `floating`, `sheet` |
| `position` | per variant | `top` or `bottom`, for the detached variants |
| `desktop` / `mobile` | — | Per-width overrides: `style`, `position`, `show_labels`, `hidden` |
| `breakpoint` | `768` | Card width below which `mobile` applies |
| `label_visibility` | `always` | `always`, `active_only`, `never` |
| `icon_visibility` | `always` | `always`, `active_only`, `never` — the same three choices as the labels, independently |
| `item_background` | `false` | A faint surface under every entry, not only the current one |
| `active_style` | `tint` | `tint` (a wash of the entry's colour) or `solid` (filled outright, dark ink on it) |
| `action_button` | — | `{icon, tap_action, color}` — a round button set beside the bar, outside its surface |
| `max_width` | — | Width cap, centred. A number is px, a string any CSS length, `fit` hugs the entries |
| `size` | `1` | Scales every measurement, 0.7–1.5 |
| `page_transition_ms` | `180` | Length of that cross-fade. The browser's own default of 250ms reads as slow for a change the reader just asked for |
| `marker_motion` | `none` | `none` or `slide` — whether one shape travels between entries instead of two fading |
| `page_transition` | `none` | `none`, `fade`, or `up` — `up` is Material's fade-through: the old page leaves, then the new one rises slightly into place |
| `pill_size` | `1` | Scales the marker around the active entry on its own, without touching the icon or the text |
| `label_size` | `11`, or `14` beside the icon | Label size in px. The default depends on `label_position`: a label under an icon is a caption, one next to it is the entry's name |
| `label_position` | `below` | Where an entry's text sits relative to its icon: `below`, `above`, `right`, `left`. The horizontal ones also make the active pill wrap icon and text together |
| `edge_distance` | `8` (`6` docked) | Distance in px between the bar and the screen edge it docks to. Added on top of the device's safe area, never instead of it, so the bar cannot end up on a phone's gesture bar |
| `container_style` | `glass` | `glass`, `solid`, `transparent` |
| `container_opacity` | `100` | Opacity of the bar, in percent |
| `blur` | `20` | Backdrop blur in px |
| `radius` | capsule | Corner radius of the bar. Left unset the ends are fully round whatever the bar's height, which is what the reference bars do; a number fixes it instead. Beware of a value just under half the bar's height (31 px unscaled) — that reads as a squashed capsule rather than as a rounded rectangle |
| `submenu_trigger` | `tap` | `tap` or `hold` |
| `haptics` | `true` | Fire Home Assistant's haptic event on a tap |
| `auto_hide_on_scroll` | `false` | Hide while scrolling down, show on the way up |
| `hidden` | — | Jinja2 boolean; hides the whole card |
| `styles` | — | Free CSS applied to the bar. Advanced |
| `sheet_items` | — | Shortcut tiles in the drawer: `name`, `icon`, `path`, `color`, `tap_action` |
| `sheet_item_style` | `grid` | `grid` (icons with labels under them) or `list` (full-width rows) |
| `sheet_columns` | auto | Grid only: tiles per row; unset fits as many as the width allows |
| `sheet_cards` | — | Cards rendered in the drawer, below the tiles |
| `sheet_title` | — | Title row above the drawer's content |
| `sheet_action` | — | `{icon, tap_action}` button on the right of that row |
| `sheet_max_height` | `60` | vh as a number, or any CSS length as a string |
| `sheet_default` | `collapsed` | `collapsed`, `expanded`, `remember` |
| `sheet_state_entity` | — | An `input_boolean` holding the open state |
| `snap_points` | `[0, 1]` | Fractions the drawer rests at |
| `collapse_on_navigate` | `true` | Close the drawer when the page changes |

An open drawer also closes on a tap anywhere outside it. The surface that
catches that tap is invisible and swallows it, so nothing behind the drawer
reacts to being tapped away.
| `preload_views` | `false` | Reserved; currently does nothing |

</details>
