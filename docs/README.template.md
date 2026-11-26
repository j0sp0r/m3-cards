# M3 Cards

![M3 Cards: Material 3 Expressive cards for Home Assistant](docs/images/hero.png)

> **⚠️ Beta:** This project is new and under active development.
> Configuration options may still change between versions — please file an
> issue if you run into something.

Material 3–inspired, native Lovelace cards for Home Assistant — built with
TypeScript + [Lit](https://lit.dev), **without** any dependency on
`button-card`, `card-mod`, `mod-card`, or `stack-in-card`. A single bundle
(`m3-cards.js`) registers **{{CARD_COUNT}} cards**, all sharing one design language.

**Try it live:** [every card on a made-up home](https://j0sp0r.github.io/m3-cards/), with
simulated values, scenarios and a phone view, in the browser. Nothing to install,
nothing connected, and every card's YAML a click away.

**Build your own with an AI assistant:** let Claude, Codex or another assistant
put together a first M3 dashboard from what your Home Assistant already has.
It is created as an *extra* dashboard: your existing ones stay untouched, and
if you don't like it, you delete it again.

<details>
<summary><b>The prompt</b> — copy it into your assistant</summary>

```text
Build me a new Home Assistant dashboard with the M3 Cards
(https://github.com/j0sp0r/m3-cards), from the devices and entities I already have.

Rules — these come first:
- Create ONE new dashboard (title "M3 Cards", URL path "m3-cards"). Never edit,
  overwrite or delete an existing dashboard, automation, script, entity, device,
  area or any other setting.
- Only read my setup. Do not switch, turn on or call any service on my devices.
- Use only entity ids that exist in my setup. Never invent one; leave a card out
  if nothing fits it.
- Use only card types and options from the card docs. Every card has one file,
  for example custom:m3-room-card is
  https://raw.githubusercontent.com/j0sp0r/m3-cards/main/docs/cards/room-card.md
  (the type without "m3-"). Read only the files of the cards you use; the README
  holds all of them and is too long to read whole.
- Show me the plan (views, the cards on each, and any question you have) and
  wait for my OK before you write anything. If you cannot create the dashboard yourself, give me the
  complete YAML for "Raw configuration editor" instead.

What I have:
- If you can reach my Home Assistant (for example through its MCP server or the
  API), read my areas, devices and entities from there.
- Otherwise I paste a list below: one section per area, one line per kind of
  entity, each entity as "id (name)". "area:" is the id m3-room-card needs.

How to build it:
1. Check that M3 Cards is installed as a dashboard resource. If you can't check,
   say how to install it through HACS in one line.
2. Use the sections layout. Views, each only if I have something for it:
   - Home: m3-clock-card, m3-weather-card, m3-presence-card,
     m3-lights-overview-card, and an m3-chip-buttons-card with a few lights,
     plugs or scenes you pick (name them in the plan so I can swap them).
   - Rooms: one m3-room-card per area (`area:` with the area id); it finds the
     area's devices by itself.
   - Climate: m3-climate-card per thermostat (if one shows up twice, for
     example as a Better Thermostat and as the device, take the one I'd set),
     m3-multi-graph-card for room temperatures.
   - Energy: m3-energy-flow-card and m3-energy-usage-card. They read the energy
     dashboard, so only if it is set up; ask me in the plan if you can't tell.
   - Household: m3-appliance-card for washer, dryer, dishwasher; m3-vacuum-card.
   - Security: m3-alarm-card, m3-openings-card, m3-leak-card, m3-battery-card,
     m3-availability-card, m3-updates-card.
3. Prefer the cards that find things on their own (room, lights overview,
   battery, leak, availability, updates) over long hand-made entity lists.
4. Give each section an m3-heading-card as its title. End every view with the
   same custom:m3-nav-card (style: floating) that links all views; its paths
   are /m3-cards/<view path>.
5. Labels in the language of my Home Assistant (the names in my list show it).

When you are done, tell me how to remove the dashboard again if I don't like it.

My areas and entities (if pasted):
```

No assistant with access to your Home Assistant? Paste this into **Developer
tools → Template** and copy the result under the prompt. It lists your areas
and the entities that suit a card, and only counts what the cards find on their
own (batteries, leak sensors, updates). It reads and changes nothing else. The
list holds your room and device names, so only share it with an assistant you
trust with them.

```jinja
{%- set groups = [
  ['light','light',none], ['switch','switch',none], ['fan','fan',none],
  ['climate','climate',none], ['humidifier','humidifier',none], ['cover','cover',none],
  ['valve','valve',none], ['lock','lock',none], ['media','media_player',none],
  ['remote','remote',none], ['vacuum','vacuum',none], ['camera','camera',none],
  ['alarm','alarm_control_panel',none], ['weather','weather',none], ['person','person',none],
  ['todo','todo',none], ['calendar','calendar',none],
  ['temperature','sensor',['temperature']], ['humidity','sensor',['humidity']],
  ['air','sensor',['carbon_dioxide','pm25']], ['power','sensor',['power']],
  ['appliance','sensor',['enum','duration']], ['running','binary_sensor',['running']],
  ['opening','binary_sensor',['door','window','opening','garage_door']],
  ['presence','binary_sensor',['motion','occupancy','presence']]
] -%}
{%- macro list(ids, inside) -%}
{%- for g in groups -%}
{%- set found = states[g[1]] | rejectattr('state', 'in', ['unavailable', 'unknown']) -%}
{%- set found = found | selectattr('entity_id', 'in', ids) if inside else found | rejectattr('entity_id', 'in', ids) -%}
{%- set found = (found | selectattr('attributes.device_class', 'in', g[2]) if g[2] else found) | list -%}
{%- if found %}
{{ g[0] }}: {% for s in found %}{{ s.entity_id }} ({{ s.name }}){{ ', ' if not loop.last }}{% endfor %}
{%- endif -%}
{%- endfor -%}
{%- endmacro -%}
{%- set ns = namespace(inside=[]) -%}
{%- for area in areas() %}
{%- set ids = area_entities(area) %}
{%- set ns.inside = ns.inside + ids %}
## {{ area_name(area) }} · area: {{ area }}
{{- list(ids, true) }}
{% endfor %}
## Without an area
{{- list(ns.inside, false) }}

## Found by the cards themselves
battery: {{ states.sensor | selectattr('attributes.device_class', 'eq', 'battery') | list | count }} · water/smoke: {{ states.binary_sensor | selectattr('attributes.device_class', 'in', ['moisture', 'smoke']) | list | count }} · connectivity: {{ states.binary_sensor | selectattr('attributes.device_class', 'eq', 'connectivity') | list | count }} · updates: {{ states.update | list | count }}
```

</details>

<p align="center">
  <a href="https://github.com/j0sp0r/m3-cards/releases/tag/v2.12.0"><img src="docs/images/release-2.12.jpg" alt="What's new in 2.12: a camera card that rings with the doorbell and opens the door with a slide, compact bins, folded rooms that show their sensors, and Dutch" width="880"></a>
</p>

<p align="center"><sub>
  Earlier: <a href="https://github.com/j0sp0r/m3-cards/releases/tag/v2.11.0">2.11</a> ·
  <a href="https://github.com/j0sp0r/m3-cards/releases/tag/v2.10.0">2.10</a> ·
  <a href="https://github.com/j0sp0r/m3-cards/releases/tag/v2.9.0">2.9</a> ·
  <a href="https://github.com/j0sp0r/m3-cards/releases/tag/v2.8.0">2.8</a> ·
  <a href="https://github.com/j0sp0r/m3-cards/releases/tag/v2.7.0">2.7</a> ·
  2.6 as a video: <a href="https://github.com/j0sp0r/m3-cards/releases/download/v2.6.0/m3-cards-2.6.mp4">landscape</a> ·
  <a href="https://github.com/j0sp0r/m3-cards/releases/download/v2.6.0/m3-cards-2.6-phone.mp4">phone</a>
</sub></p>

New here? Start with the category that matches what you want to show — every
card links to its full documentation further down.

{{CATEGORY_TABLES}}

*All cards at a glance:*

![Overview](docs/images/cards-overview.png)

<sub>Taken on a real Home Assistant instance. The washing machine, floor lamp,
speaker, air conditioner and the updates show simulated states so the active
renderings (wave indicator, version jump, running installation) are visible in
the image — everything else is live data.</sub>

## Features

- Frosted glass card look (can be turned off for solid themes), shared
  design language across all cards
- Mode pills with shape-morph animation (round → rounded rectangle)
- Temperature stepper with step size/limits taken from the entity
- Optional external temperature/humidity sensors, window and battery chips
- Preset support (tap to cycle, as its own row or as a pill in the mode
  row)
- Configurable card height + full height matching in
  `horizontal-stack`/grid layouts for tiles of exactly equal height
- Full graphical editor (no YAML required) — modeled after the native tile
  card editor, with a unified appearance panel (corner-radius presets,
  per-corner overrides) across every card
- `unavailable` handling without crashing: values shown as "–", controls
  dimmed
- Localized in German, English, Dutch (Belgium) and Ukrainian (follows `hass.locale.language`).
  Add other languages or override wording with [your own translations](#your-own-translations).
- Accessible: every interactive element is keyboard-reachable
  (Tab/Enter/Space) with a visible focus ring and `aria-label`
- Respects `prefers-reduced-motion` throughout, additionally overridable
  per card via `animation: auto | on | off`
- A short vibration in the companion app when a control on a card is tapped,
  as Home Assistant's own toggles do; `haptics: false` turns it off per card,
  and Home Assistant's "Vibrate" profile setting turns it off for the device
- Old configs (e.g. `animations: true/false`) are migrated to the current
  schema automatically on load — no manual dashboard edits needed
- [Jinja2 templates](#templates) in every card's own string fields, live over
  the websocket — no template-sensor helper per card

## Installation

### HACS (recommended)

[![Open this repository in HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=j0sp0r&repository=m3-cards&category=plugin)

M3 Cards is in the **default HACS store**, so there is nothing to add first:

1. Open HACS in Home Assistant
2. Search for **M3 Cards**
3. Open it and press *Download*
4. Reload Home Assistant

The button above does the same thing without the search — it opens the
repository straight in your own Home Assistant.

<details>
<summary>Not showing up in the search yet?</summary>

HACS refreshes its copy of the store list periodically rather than on every
open, so a recently added repository can take a few hours to appear. Until it
does, it can still be added by hand:

1. HACS → menu (⋮) in the top right → *Custom repositories*
2. Enter the repository URL, pick type **Dashboard**, then *Add*
   (**not** *Integration* — this is a Lovelace card, not an integration)
3. Search for "M3 Cards", open it and press *Download*
4. Reload Home Assistant

Adding it this way is harmless once it does appear: HACS treats it as the same
repository either way.

</details>

### Manual

1. Download the latest `m3-cards.js` from the
   [Releases](../../releases)
2. Copy it to `config/www/m3-cards.js`
3. Add the resource in Home Assistant:
   *Settings → Dashboards → Resources → Add resource*
   - URL: `/local/m3-cards.js`
   - Type: JavaScript module

## Templates

Every card accepts Jinja2 in **its own string fields** — name, icon, colour,
unit, whatever that card reads out of its config. A field is treated as a
template as soon as it contains `{{` or `{%`; everything else is left alone.

```yaml
type: custom:m3-button-card
entity: light.kitchen
name: "{{ states('sensor.kitchen_temperature') | round(1) }} °C"
icon: >-
  {{ 'mdi:lightbulb-on' if is_state('light.kitchen', 'on') else 'mdi:lightbulb' }}
```

Before, a field could only be a fixed string or one entity's raw state. A
composed label meant a template-sensor helper in `configuration.yaml` for every
card that wanted one — and an icon that depends on an entity had no way to be
expressed at all:

```yaml
# configuration.yaml — one of these per card, no longer needed
template:
  - sensor:
      - name: Kitchen label
        state: "{{ states('sensor.kitchen_temperature') | round(1) }} °C"
```

Values are **pushed**, not polled: the card subscribes to the template over
Home Assistant's websocket, and Home Assistant re-renders it whenever anything
the template reads changes. One subscription per distinct template — two fields
sharing the same string share one — and they are all closed when the card
leaves the page.

A card that uses no templates behaves exactly as it always has and pays nothing
for the feature: nothing is walked, subscribed or copied.

### Nested cards are left alone

Card configs can contain other cards: `cards:` on the group and room cards, the
content of a popup action, a mushroom card dropped into a slot. **Templates
inside those are not rendered here** — they are passed through untouched to the
card they belong to.

```yaml
type: custom:m3-room-card
area: kitchen
name: "{{ states('sensor.kitchen_temperature') | round(1) }} °C"   # rendered here
cards:
  - type: custom:mushroom-template-card
    primary: "{{ states('sensor.kitchen_humidity') }} %"           # left for mushroom
```

The reason is that the inner card renders its own templates, and it renders
them *live*. Resolving `primary` above would hand mushroom the one string it
happened to say at the moment the room card was configured — the field would
freeze at that value and never follow the sensor again. The rule is mechanical:
the walk stops at any nested object that carries its own `type`, which is what
a card config looks like whatever card it is for.

The nav card is the exception in the other direction: its entries had templates
before this existed, with `hidden` / `disabled` read as booleans, and they work
as documented under [M3 Nav Card](#m3-nav-card).

## Icons without a background

Every card draws its icons on a small tinted surface. A theme can take those
away for the whole dashboard — icons straight on the card, as the current
Google Home app draws them:

```yaml
# in your theme
m3-icon-background: none
```

Unset, nothing changes. Where a surface was filled solid with dark ink on it
(an active room tile, a button card with `icon_fill: solid`), the icon takes
its colour instead, so it still reads on the card. Buttons that are controls
rather than icons, such as a power button, keep their surface.

## Your own translations

The cards ship in German, English, Dutch (Belgian Dutch, used for every Dutch
setting) and Ukrainian. English is the fallback for other languages.
To change that, give the cards your own strings from a small file of your
own — any language, as many or as few strings as you like. Whatever the file
leaves out falls back to the built-in language, then to English.

1. Create `config/www/m3-cards-nl.js` (any name works):

   ```js
   // Only the keys listed here change; everything else stays as shipped.
   window.m3CardsTranslations = {
     ...window.m3CardsTranslations,
     nl: {
       energy_weekday_today: "Vandaag",
       energy_subtitle_days: "Afgelopen {days} dagen",
       multigraph_summary_mean: "Gemiddeld",
       openings_all_closed: "Alles dicht",
     },
   };
   window.dispatchEvent(new Event("m3-cards-translations-loaded"));
   ```

2. Add it as a resource next to `m3-cards.js`:
   *Settings → Dashboards → Resources → Add resource*
   - URL: `/local/m3-cards-nl.js`
   - Type: JavaScript module

The language is the one in your Home Assistant profile. A map is looked up by
the full tag first and then by its base language, so `nl` covers `nl-BE`
too, and an `nl-BE` map can override just the words that differ. A `de` or
`en` map works the same way, for when you only want to reword a few of the
built-in strings.

**Finding the keys.** [`docs/translations/template.js`](docs/translations/template.js)
is a ready file with every string the cards show, in English: save a copy,
change its `xx` to your language and translate as much as you like. It is
regenerated with each release. The strings themselves live in
[`src/localize.ts`](src/localize.ts); the `en` block is the complete list.
A finished translation is welcome as an issue attachment or a pull request,
to be built into the cards.
Keys starting with `editor_` belong to the visual editor. Keep placeholders
such as `{days}` or `{n}` exactly as they are — the card fills them in.

The last line of the file lets cards that were already on screen pick up the
new strings straight away: resources load in parallel, so the cards may draw
before your file has run. Leave it out and those cards switch on their next
update instead. Browsers cache resources hard; after editing the file, add
`?v=2` (and so on) to the resource URL or reload with the cache cleared.

{{CARD_SECTIONS}}

## Development

```bash
npm install
npm run dev     # watch build to dist/m3-cards.js
npm run build    # production build
npm run lint     # typecheck
```

For local testing, copy `dist/m3-cards.js` to `config/www/` and add
it as a Lovelace resource (`/local/m3-cards.js`, type "JavaScript
module").

## Credits

**M3 Lights Overview**, **M3 Chip Buttons** and **M3 Group Card** were built by
Fabian Wendel ([UHaFnir](https://github.com/UHaFnir/m3-cards)) in a fork of
this project, along with the weather card's independent header/chart toggles
and its configurable hourly strip. Two performance faults in code that was
already here were his finds as well: every auto-discovering card refetched the
whole entity registry instead of reading the copy the frontend already holds,
and opening Home Assistant's card picker ran a full-house scan nine times over.

The card and editor sections above for those three cards are largely his prose,
lightly adapted.

## License

MIT
