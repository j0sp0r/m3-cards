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
- Use only card types and options documented in the README and in docs/cards/*.md
  of the repository above.
- Show me the plan (views and the cards on each) and wait for my OK before you
  write anything. If you cannot create the dashboard yourself, give me the
  complete YAML for "Raw configuration editor" instead.

What I have:
- If you can reach my Home Assistant (for example through its MCP server or the
  API), read my areas, devices and entities from there.
- Otherwise I will paste a list of my areas and entities below.

How to build it:
1. Check that M3 Cards is installed as a dashboard resource. If not, tell me how
   to install it through HACS and stop.
2. Use the sections layout. Views, each only if I have something for it:
   - Home: clock, weather, presence, lights overview, a few chip buttons for
     scenes or my most used switches.
   - One room card per area (custom:m3-room-card with `area:`); it finds the
     area's devices by itself.
   - Climate: climate cards for thermostats, multi graph for room temperatures.
   - Energy: energy flow, energy usage and tariff/cost cards, if the energy
     dashboard is set up.
   - Household: appliance cards for washer, dryer, dishwasher; vacuum; supplies.
   - Security: alarm, openings, leak, battery and availability cards.
3. Prefer the cards that find things on their own (room, lights overview,
   battery, leak, availability, updates with auto-discovery) over long hand-made
   entity lists.
4. End every view with the same custom:m3-nav-card (style: floating) that links
   all views.
5. Labels in the language of my Home Assistant.

When you are done, tell me how to remove the dashboard again if I don't like it.

My areas and entities (if pasted):
```

No assistant with access to your Home Assistant? Paste this into **Developer
tools → Template** and copy the result under the prompt. It lists your areas
and the entities in them; it does not change anything. The list holds your room
and device names, so only share it with an assistant you trust with them.

```jinja
{%- set domains = ['light','switch','fan','climate','humidifier','water_heater','cover','valve','lock','media_player','remote','vacuum','alarm_control_panel','camera','weather','person','todo','calendar','update','input_boolean','counter','select'] -%}
{%- set sensors = ['temperature','humidity','power','energy','battery','illuminance','carbon_dioxide','pm25','water','gas','monetary','duration','enum'] -%}
{%- set binaries = ['door','window','opening','garage_door','motion','occupancy','presence','moisture','smoke','connectivity','problem','running'] -%}
{%- macro wanted(e) -%}
{%- set d = e.split('.')[0] -%}
{{- states(e) not in ['unavailable','unknown'] and (d in domains or (d == 'sensor' and state_attr(e, 'device_class') in sensors) or (d == 'binary_sensor' and state_attr(e, 'device_class') in binaries)) -}}
{%- endmacro -%}
{%- set ns = namespace(seen=[]) -%}
{%- for area in areas() %}
## {{ area_name(area) }}
{%- for e in area_entities(area) if wanted(e) == 'True' %}
{%- set ns.seen = ns.seen + [e] %}
- {{ e }} · {{ state_attr(e, 'friendly_name') }} · {{ states(e) }} {{ state_attr(e, 'unit_of_measurement') or '' }}
{%- endfor %}
{% endfor %}
## Without an area
{%- for s in states if s.entity_id not in ns.seen and wanted(s.entity_id) == 'True' %}
- {{ s.entity_id }} · {{ s.name }} · {{ s.state }} {{ state_attr(s.entity_id, 'unit_of_measurement') or '' }}
{%- endfor %}
```

</details>

<p align="center">
  <a href="https://github.com/j0sp0r/m3-cards/releases/tag/v2.11.0"><img src="docs/images/release-2.11.jpg" alt="What's new in 2.11: pages that slide on a tap, a nav bar pill that springs or stretches, Ukrainian and a live demo" width="880"></a>
</p>

<p align="center"><sub>
  Earlier: <a href="https://github.com/j0sp0r/m3-cards/releases/tag/v2.10.0">2.10</a> ·
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
- Localized in German, English and Ukrainian (follows `hass.locale.language`).
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

The cards ship in German, English and Ukrainian. English is the fallback for
other languages.
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

**Finding the keys.** Every string the cards show is in
[`src/localize.ts`](src/localize.ts); the `en` block is the complete list.
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
