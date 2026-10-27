---
title: M3 Counter Card
type: m3-counter-card
category: energy
display: Counter
summary: A meter reading as a rolling digit display
table_order: 7
section_order: 7
---

Replaces a `tile` card for meter readings: shows a cumulative sensor value
as an odometer-style digit display, each digit in its own cell. Integer and
decimal digits are colored separately (decimals in the accent color). Only
the digits that actually changed on the last update roll animated — the
rest stay put. Not limited to electricity: unit and decimal places come
from the entity, `power_entity` (power chip) is entirely optional — just as
suitable for gas or water meters (m³) as for electricity meters (kWh).

<img src="docs/images/counter-card.png" alt="Counter Card" width="440">

<details>
<summary>Configuration, examples & options</summary>

```yaml
type: custom:m3-counter-card
entity: sensor.virtual_electricity_meter
power_entity: sensor.total_power_consumption
name: Electricity Meter
```

### Digit display

- The number of integer digits (`digits`) grows automatically with the
  value (default: at least 5) and never shrinks back within a session,
  even if the value briefly drops — prevents the card width from
  "jumping". Alternatively, a fixed number can be configured; it too grows
  as needed to never truncate the value.
- The decimal separator and number format follow `hass.locale` (e.g. comma
  instead of period in German).
- If the card is narrower than 340px, the digit cells shrink automatically —
  measured on the card itself, so it works in a narrow column too.
- `unavailable`: cells show a dimmed "–", the power chip is hidden.

### Power chip and ticker

- `power_entity` (optional) shows a chip with a lightning-bolt icon and
  the current power in the header — default color green, switchable via
  `power_thresholds` (e.g. orange above 2000 W, red above 3500 W).
- `show_ticker` + `daily_entity` (both optional) show a thin "+X today"
  line below the digit display, fed from a separate daily sensor.

### Configuration options

| Option | Type | Default | Description |
|---|---|---|---|
| `entity` | string | – | Meter-reading sensor (required) |
| `power_entity` | string | – | Optional power sensor for the header chip |
| `power_entities` | list | – | Power sensors added together, for a room whose consumption is the sum of its plugs. Wins over `power_entity` and over discovery, both of which can only name one |
| `daily_entity` | string | – | Optional daily sensor for the ticker line |
| `name` | string | entity name | Displayed name |
| `icon` | string | `mdi:counter` | Icon in the icon tile |
| `subtitle` | string | "Total reading" | Subtitle override |
| `decimals` | number | `2` | Number of decimal places |
| `digits` | `auto` \| number | `auto` | Integer digits — automatic (min. 5, never shrinks back) or fixed |
| `show_ticker` | boolean | `false` | Show the "+X today" line (needs `daily_entity`) |
| `adjustable` | boolean | `false` | Offers a pencil for correcting the reading. See below — it needs somewhere to write |
| `adjust_entity` | string | `entity` | Where the correction goes when the displayed entity cannot take it |
| `accent_color` | string | theme primary | Color of the decimal-digit cells |
| `cell_background` | string | 8% `--primary-text-color` | Background of the integer-digit cells |
| `power_chip_color` | string | `#81c784` | Default power-chip color |
| `power_thresholds` | `{ above, color }[]` | – | Chip color change above the given power |
| `text_color` / `secondary_text_color` | string | theme default | Name / subtitle & ticker |
| `card_background` | string | glass/solid background | Card background |
| `animation` | `auto` \| `on` \| `off` | `auto` | Roll animation; `auto`/`on` respect `prefers-reduced-motion` |
| `glass_background` | boolean | `true` | Frosted glass background |
| `radius` / `corners` | number / object | `28` | Corner radius, optional per corner |

## Correcting the reading

A meter drifts, or a run gets counted twice, and the number on the wall stops
matching the number on the card. `adjustable: true` offers a pencil beside the
power chip for putting it right — deliberately small, because a correction is a
rare and deliberate act.

It needs somewhere to write, and there are three cases:

| The card shows | What the pencil does |
| --- | --- |
| an `input_number` or `number` | writes the value straight into it |
| a **`utility_meter`** | calls `utility_meter.calibrate`, behind a confirmation |
| anything else, with `adjust_entity` naming a helper | moves that helper by the difference, so a template sensor built as *sources + offset* lands on the wanted figure |

**A plain `sensor` with no `adjust_entity` can't be corrected at all** — there
is no service to write it with. The pencil is then drawn greyed with the reason
on it rather than left out, because `adjustable: true` that silently does
nothing is worse than no option.

**Never point `adjust_entity` at the source of a utility_meter.** The meter
reads a falling source as a meter change and adds the whole new value on the
next rise; measured once here as 18,899 → 40,793 in one five-minute row. That
is why the card checks the platform before the domain: a meter gets calibrated,
never shifted from below.

And calibrating is not free either. The statistics engine reads a downward step
as a meter change too, and adds the old reading to the running sum. Measured on
a throwaway meter: calibrated from 85 to 40, the state was right immediately and
the hourly `sum` went to **125** — the phantom consumption stays in the energy
dashboard until it is corrected.

Correcting it is **Developer tools → Statistics → "Adjust sum"**, with the
adjustment being the old reading negated (here −85) on the hour the calibration
happened. Note that `recorder.adjust_sum_statistics` is a *websocket command*,
not a service: calling it from an automation or from Developer tools → Actions
answers "Service recorder.adjust_sum_statistics not found". The confirmation the
card shows says where to go instead.

</details>
