---
title: M3 Tariff Card
type: m3-tariff-card
category: energy
display: Tariff
summary: Use and cost over two or more tariffs (peak / off-peak), with the active one
table_order: 10
section_order: 55
---

Electricity use and cost split over two or more tariffs — the French
*Heures Pleines / Heures Creuses*, a day/night meter, or any number of
tariffs. The total cost in the header, the tariff in force right now with its
price, what it saves against the dearest one and until when it lasts, the
split of the day's use, a tile per tariff and the last days as stacked bars.
The tariffs share one hue, lighter for the dearer one: it is the same
electricity, at different prices.

<img src="docs/images/tariff-card.png" alt="Tariff Card" width="440">

<details>
<summary>Configuration, examples & options</summary>

Peak / off-peak with a `utility_meter` that has two tariffs (its `select`
names the active one):

```yaml
# configuration.yaml
utility_meter:
  electricity_daily:
    source: sensor.grid_import_energy
    cycle: daily
    tariffs: [peak, offpeak]
```

```yaml
type: custom:m3-tariff-card
title: Electricity cost
tariffs:
  - name: Heures pleines
    short: HP
    energy: sensor.electricity_daily_peak
    price: 0.2516
  - name: Heures creuses
    short: HC
    energy: sensor.electricity_daily_offpeak
    price: 0.1828
active_tariff: select.electricity_daily
schedule:            # only for "until HH:MM"; the select decides the tariff
  - { tariff: HC, from: "22:00", to: "06:00" }
  - { tariff: HP, from: "06:00", to: "22:00" }
```

Three tariffs from a schedule alone, prices from entities:

```yaml
type: custom:m3-tariff-card
tariffs:
  - { name: Peak, short: P, energy: sensor.meter_peak, price: sensor.price_peak }
  - { name: Normal, short: N, energy: sensor.meter_normal, price: sensor.price_normal }
  - { name: Night, short: NT, energy: sensor.meter_night, price: sensor.price_night }
schedule:
  - { tariff: NT, from: "22:00", to: "06:00" }
  - { tariff: P, from: "17:00", to: "20:00" }
  - { tariff: N, from: "06:00", to: "22:00" }
```

### Where the numbers come from

- **Use** per day is the change of each tariff's meter in the long-term
  statistics. The meters must be `total` or `total_increasing`.
- **Cost** is the tariff's `cost` entity where one is given (its change per
  day), otherwise use × price. A price **entity** that changes is averaged
  per day (its daily mean in the statistics); where it has no statistics,
  its current value is used.
- A meter that is `unavailable` shows "–", never 0.
- **The active tariff** comes from `active_tariff` (an entity whose state is
  the tariff's name, short name or 1-based number — a `utility_meter`
  select works as it is) or, without one, from `schedule`. Schedule windows
  may run past midnight and take `days` (0 = Sunday). `active_until` takes a
  timestamp sensor for "until HH:MM"; otherwise the schedule's end is used.

### Configuration options

| Option | Type | Default | Description |
|---|---|---|---|
| `tariffs` | list | **required** | `{ name, short, energy, price, cost, color, icon }` — `price` a number or an entity |
| `active_tariff` | string | – | Entity naming the active tariff |
| `schedule` | list | – | `{ tariff, from, to, days }` windows |
| `active_until` | string | – | Timestamp sensor for "until" |
| `period` | `day` \| `week` \| `month` | `day` | What the header, split and tiles sum |
| `history_days` | number | `7` | Days in the history bars |
| `show_history` | boolean | `true` | The history bars |
| `currency` | string | Home Assistant's | ISO currency code |
| `title`, `icon` | string | "Electricity cost", `mdi:receipt-text-outline` | Header |
| `accent_color` | string | blue | The hue the tariff tones are made from; `color` per tariff overrides |
| `glass_background`, `radius`, `corners`, `text_color`, `secondary_text_color`, `card_background`, `animation` | | | As on every card |

The card ships German and English. French (or any language) can be added
through `window.m3CardsTranslations` without a release; see the translation
section in the main README.

</details>
