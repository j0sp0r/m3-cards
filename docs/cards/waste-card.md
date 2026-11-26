---
title: M3 Waste Card
type: m3-waste-card
category: household
display: Waste
summary: Bin-collection schedule with a two-week timeline and reminder mode
table_order: 3
section_order: 26
---

Bin-collection schedule: a hero with the next pickup, a two-week timeline, and
a row per bin. Feed it sensors whose state is the number of days until
collection (e.g. Waste Collection Schedule with
`value_template: '{{ value.daysTo }}'`) or the date itself (`2026-12-01`, or a
timestamp, as the Recycle! integration and other date sensors give it). A
sensor's name loses its device's name in front, which for a collection
schedule is often the street address. Two modes: **info** (bins are
collected automatically — pure information) and **reminder** (you put them out
yourself — escalates near the date with a "put out" acknowledge button).

<img src="docs/images/waste-card.png" alt="Waste Card" width="440">

<details>
<summary>Configuration, examples & options</summary>

```yaml
type: custom:m3-waste-card
mode: info            # or: reminder
entities:
  - sensor.paper
  - sensor.bio
  - { entity: sensor.recycling, name: Recycling, color: '#f0c46e' }
```

### Compact sizes

`layout` shows only the next collection, in three sizes from the same card:

- `row` — one line across: the bin, a short date ("Thu, 10 Dec") and a chip
  with the days ("14 d").
- `tile` — a square for a half-width slot: the bin's icon, the days large,
  the bin and date underneath.
- `pill` — a chip for a header or a row of chips: icon and days.

Days away, they stay quiet. Tomorrow the card takes the bin's tint and the
chip its colour; today — or once a reminder is due in `reminder` mode — the
chip is filled. Several bins on the same day overlap their icons. A tap opens
the bin's details — with several on that day, a menu asks which; in `reminder` mode `row` and `tile` carry the "put out"
button while it is due.

```yaml
type: custom:m3-waste-card
layout: row      # full (default) | row | tile | pill
entities:
  - sensor.paper
  - sensor.bio
```

A compact card follows whichever bin comes next among its `entities`. For one
bin alone — a pill that only ever shows the paper — give it just that one.

### Configuration options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `mode` | `info` \| `reminder` | `info` | Information only, or escalate + acknowledge |
| `layout` | `full` \| `row` \| `tile` \| `pill` | `full` | Everything, or only the next collection in one of three compact sizes. See [Compact sizes](#compact-sizes) |
| `entities` | list | – | Sensors (days-until-collection): id or `{ entity, name, icon, color }` |
| `calendar_entity` | string | – | A calendar with one event per collection, the event summary naming the bin. Merged with `entities`. |
| `show_entity_picture` | boolean | `false` | The sensor's own picture (`entity_picture`, e.g. the bin pictures some integrations bring) in place of the icon, wherever the card shows one |
| `hero_primary` | `days` \| `weekday` \| `date` | `days` | What leads: "in 3 days", "Monday" or "10 Dec" — in the hero and in the compact sizes, where the other goes underneath. Today and tomorrow stay words |
| `hero_icon` | `first` \| `multi` | `first` | Single icon or overlapping bin icons |
| `show_timeline` | boolean | `true` | Two-week timeline |
| `timeline_days` | number | `14` | Timeline span (7–28) |
| `max_visible` | number | `0` | Rows shown at once, the rest behind "show more" (0 = all), as on the other list cards. `max_rows`, the old name, still works. |
| `reminder_offset` | number | `1` | Days before pickup to start reminding (reminder mode) |
| `reminder_time` | string | `18:00` | Only remind after this time the day before |
| `ack_entity` | string | – | `input_boolean`/`input_datetime` storing "put out" |
| `notify_entities` | list | all bins | Which bins the reminder watches. **One** notification is sent either way, naming every bin that is due — not one per bin |
| `notify_service` / `notify_enabled` | – | – | Optional put-out reminder push (off by default) |


### What the reminder actually sends

One notification, once, at `reminder_time` the day before — not one per bin.
Its text names whichever bins are due, so an evening where the paper and the
bio bin both go out produces a single message naming both. `notify_entities`
narrows which bins can put the card into that state; leaving it unset means
all of them, which is what the card did before the option existed.

</details>
