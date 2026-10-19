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
`value_template: '{{ value.daysTo }}'`). Two modes: **info** (bins are
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

### Configuration options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `mode` | `info` \| `reminder` | `info` | Information only, or escalate + acknowledge |
| `entities` | list | – | Sensors (days-until-collection): id or `{ entity, name, icon, color }` |
| `calendar_entity` | string | – | A calendar with one event per collection, the event summary naming the bin. Merged with `entities`. |
| `hero_primary` | `days` \| `weekday` | `days` | Hero shows "in 3 days" or "Monday" |
| `hero_icon` | `first` \| `multi` | `first` | Single icon or overlapping bin icons |
| `show_timeline` | boolean | `true` | Two-week timeline |
| `timeline_days` | number | `14` | Timeline span (7–28) |
| `max_rows` | number | `0` | Cap rows, rest collapsible (0 = all) |
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
