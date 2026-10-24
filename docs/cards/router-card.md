---
title: M3 Router Card
type: m3-router-card
category: system
display: Router
summary: An LTE/5G router's connection, signal quality, throughput and monthly data — graded, not just printed
table_order: 4
section_order: 43
---

A connection tile for an LTE or 5G router. Built against a ZTE MC801A fed by
REST sensors, and usable with a Fritzbox, a Huawei, a GL.iNet or anything else
that publishes the same quantities.

<img src="docs/images/router-card.png" alt="M3 Router Card" width="440">

Only the blocks whose entities exist are drawn, so a router that reports
throughput but no radio values gets the header, the rates and the volume bar
without being asked for an RSRP it does not have.

```yaml
type: custom:m3-router-card
entity: binary_sensor.zte_reachable
entity_prefix: zte
```

## It grades the value rather than printing it

−94 dBm means nothing to most people, and a history graph of it means less. The
card sorts every radio reading into one of five steps and says which:

| RSRP (LTE) | Verdict | Bars |
| --- | --- | --- |
| ≥ −80 dBm | Excellent | 5 |
| ≥ −90 dBm | Good | 4 |
| ≥ −100 dBm | Fair | 3 |
| ≥ −110 dBm | Weak | 2 |
| below | Very weak | 1 |

**5G is graded on its own scale**, about 5 dB stricter at every step. That is
not decoration: an NR carrier is wider, so the same transmitted power is spread
over more resource elements and each one measures lower for an equally good
connection — and the bands in use sit higher than LTE B3, where the same path
loss costs more. Judged on the LTE scale, NR reads one step too generous
throughout.

RSRQ, SNR and SINR get their own scales too, because they measure different
things. RSRQ is a ratio and lives between −3 and −20; SNR is a difference and
is perfectly normal at 0, which would be catastrophic as an RSRP. Each has its
own `*_thresholds` key, each is a list of lower bounds, and the first step a
value clears wins:

```yaml
rsrp_thresholds:
  - { min: -75, grade: excellent }
  - { min: -85, grade: good }
  - { min: -95, grade: fair }
  - { min: -105, grade: weak }
```

Some integrations publish RSRP with the sign stripped — `94` rather than `−94`.
The card flips it, because the quantity cannot be positive and grading `94` as
written would call a mediocre signal perfect. SNR is never flipped: it genuinely
can be positive, and usually is.

## Two radios, two rows

On a 5G non-standalone connection the router is on an LTE anchor **and** an NR
carrier at the same time — LTE B3 and n1, in the case this was built against.
Showing one of them is a choice about which half of the truth to print, so the
card shows both: the anchor full size, the NR carrier in a shorter row beneath
it, each graded on its own scale. `show_nr_signal: false` collapses it back to
one.

With only one radio reporting, there is only ever one row, and it is graded
against whichever scale fits what it is.

## Throughput, with a shape

The two rate tiles read their unit off the entity rather than assuming one. The
same reading arrives as `6106 bit/s` from one integration and `0.006 Mbit/s`
from the next, and guessing is wrong by six orders of magnitude. Byte units are
accepted and multiplied by 8, because `MB/s` is the same quantity and nobody
should do that conversion in their head.

Under each number is a sparkline of the last `spark_points` readings (40 by
default), scaled to its own maximum — the question it answers is "what has this
been doing lately", not "how close to the line rate is it". A freshly loaded
dashboard has no past to draw, so the first render asks the recorder once for
the last hour and prefills; two cards wanting the same sensor share the one
round-trip. No recorder, or an excluded entity, simply means no line: a
sparkline is an ornament on a number that is displayed anyway.

`peak_chip: true` adds the highest rate seen since the card loaded.

## Data volume

A two-colour bar split by direction, with the month's total in the accent
colour. Give it `data_limit` and the bar becomes a budget instead: the share of
the allowance used, amber from 80%, red from 95%, with the remainder spelled
out beside it.

## Finding the entities

`entity_prefix` narrows discovery to one router — `zte` for `sensor.zte_*`. Left
out, the card guesses it: the prefix owning the most router-shaped entities
wins.

Discovery matches on the **entity id**, not on the device. That is deliberate.
The sensors this was built against are published by a pyscript app with
`state.set()`, which never touches the entity registry — they have no device, no
unique id and no config entry, and a device-registry lookup finds nothing at
all. An integration that does register its entities is found by the same
patterns, because the id is the one thing every source has.

Every slot can be named outright when the guess is wrong, and a named entity
always beats a discovered one. `auto_discover: false` turns guessing off
entirely and draws only what is configured.

### What is actually verified

**One router.** The card was built against a ZTE MC801A and checked on it. The
patterns for other integrations are written from their published sensor
definitions and covered by unit tests, which is enough to catch a pattern that
stops matching and *not* enough to call them supported. If you have one of
these, the thing worth checking first is that the two throughput tiles show a
rate and not a monthly total.

| Source | Signal | Throughput | Volume |
| --- | --- | --- | --- |
| ZTE (REST/pyscript) | LTE + NR, verified | verified | verified |
| Huawei LTE | RSRP/RSRQ/SINR/RSSI/band/cell | `current_*_rate` | `current_month_*`, in bytes |
| AVM Fritz!Box | none — no radio values | `*_throughput` | `gb_received` / `gb_sent` |
| Fibre / ONT | optical RX, graded as a window | whatever it publishes | if it publishes one |

Two traps the tests exist for, both found by writing them:

- A Huawei publishes `current_month_download` **and** `current_download_rate`,
  and both end in a word a rate pattern wants. Claimed the wrong way round, the
  card showed 580 GB as a live throughput. Volumes are therefore matched before
  rates.
- A Fritzbox publishes `download_throughput` (what is flowing) **and**
  `max_connection_download_rate` (what the line synced at). The second is
  excluded by name, because putting a sync rate in the live tile is a
  plausible-looking lie.

### Fibre lines

A fibre router has no RSRP. What it has is **optical receive power**, and the
card grades that instead whenever no radio value is present at all.

It needs its own scale, because optical power is a **window, not a ramp**. An
ONT is specified from roughly −28 dBm, below which there is nothing left to
detect, up to roughly −8 dBm, above which the receiver saturates and the error
rate climbs again. "More signal is better" is true for RSRP and false here, so a
fibre line graded on the LTE ramp would call a dangerously hot one perfect — and
send whoever reads it looking in the wrong place, since the fix for that is an
attenuator.

```yaml
type: custom:m3-router-card
optical_rx_entity: sensor.ont_rx_power
optical_tx_entity: sensor.ont_tx_power
optical_rx_max: -8
```

The transmit level sits beside it as a chip. Both are discovered from the usual
names — `rx_power`, `optical_rx_power`, `ont_rx_power`, `optical_signal_level`
and their transmit counterparts.

**DSL is not covered.** SNR margin, line attenuation and sync rate are the
equivalent numbers there, and the Fritzbox integration does not expose them
without a custom TR-064 setup. Point `rsrp_entity` and `snr_entity` at whatever
your setup does publish and set `*_thresholds` to that line's own figures; the
grading machinery does not care what produced the number.

### Volumes are read in whatever unit they arrive in

The ZTE app divides into GB, a Fritzbox reports GB, a Huawei reports raw
**bytes**. The card reads the unit off each sensor, so the same configuration
does not show "414,6 GB" for one and "414.600.000.000 GB" for the next. Binary
units are honoured as binary: GiB is 2³⁰, not 10⁹, which is a 7% difference —
more than enough to put a tariff warning on the wrong side of the line.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `entity` | string | discovered | The connection entity — a `binary_sensor` with the `connectivity` class, or a status sensor carrying the modem's own vocabulary. |
| `entity_prefix` | string | guessed | Narrows discovery to one router's entities by their shared id prefix. |
| `auto_discover` | boolean | `true` | Off, only the entities named below are drawn. |
| `name` | string | `<PREFIX> Router` | Header title. The connection sensor's own name is not used: it is named after what it measures, not after the device. |
| `icon` | string | `mdi:router-wireless` | Overrides the header icon. Becomes `router-wireless-off` when the link is down. |
| `rsrp_entity`, `rsrq_entity`, `snr_entity`, `rssi_entity` | string | discovered | The LTE radio. |
| `nr_rsrp_entity`, `nr_snr_entity` | string | discovered | The 5G radio. |
| `optical_rx_entity`, `optical_tx_entity` | string | discovered | A fibre line's optical power, used when there is no radio value at all. |
| `band_entity`, `nr_band_entity`, `cell_id_entity`, `network_type_entity` | string | discovered | What the subtitle and the cell chip read. |
| `download_entity`, `upload_entity` | string | discovered | Throughput. The unit is read off the entity. |
| `data_down_entity`, `data_up_entity`, `data_total_entity` | string | discovered | Monthly volume, in GB. |
| `show_signal` | boolean | `true` | The graded signal block. |
| `show_signal_details` | boolean | `true` | The RSRQ / SNR / cell chip row. |
| `show_nr_signal` | boolean | `true` | The second signal row for the 5G carrier. |
| `show_throughput` | boolean | `true` | The two rate tiles. |
| `show_sparkline` | boolean | `true` | The line under each rate. |
| `show_data` | boolean | `true` | The volume bar. |
| `peak_chip` | boolean | `false` | The highest rate seen since the card loaded. |
| `spark_points` | number | `40` | How many readings the line keeps. |
| `spark_history_minutes` | number | `60` | How far back the first render prefills from the recorder. |
| `rsrp_thresholds`, `nr_rsrp_thresholds`, `snr_thresholds`, `rsrq_thresholds`, `optical_rx_thresholds` | list | see above | Each entry takes `min` and `grade`. |
| `optical_rx_max` | number | `-8` | Above this the optical receiver is overdriven and the reading is graded as a fault, not as a perfect signal. |
| `data_limit` | number | — | A tariff allowance in GB; turns the volume bar into a budget. |
| `value_map` | map | — | Raw state → label, applied before the built-in vocabulary table. |
| `tap_action` | action | `more-info` | What a tap on the header does. |
| `accent_color`, `download_color`, `upload_color`, `online_color`, `offline_color` | string | — | Colour overrides. |
| `text_color`, `secondary_text_color`, `card_background`, `glass_background`, `radius`, `corners`, `card_version` | — | — | The usual shared appearance options. |

## What is deliberately not here

**History graphs.** They are what this card replaces. A 24-hour plot of RSRP is
a band of noise between −88 and −95 that answers no question anyone asks of it;
the verdict and the current number do. Tap any value to get HA's own more-info
dialog, which has the graph.

The companion [M3 Router Diagnostics Card](#m3-router-diagnostics-card) carries
the temperatures, the cell and band detail, the reachability checks and the
restart button.
