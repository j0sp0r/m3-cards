---
title: M3 Router Diagnostics Card
type: m3-router-diagnostics-card
category: system
display: Router diagnostics
summary: Modem temperatures, throttling, cell and band detail, reachability checks and a restart button that asks first
table_order: 5
section_order: 44
---

The other half of the router pair: what the modem is doing to itself, what cell
it is on, whether the internet is actually reachable, and one button to start
the thing again.

```yaml
type: custom:m3-router-diagnostics-card
entity: binary_sensor.zte_reachable
entity_prefix: zte
```

## A verdict, and what it counts

The header says "Everything in order" or "*n* findings", with a chip to match.
A finding is a temperature over the alarm threshold, active throttling, a
failed reachability check, or a value the config explicitly flagged.

**It is deliberately not everything that is highlighted.** Carrier aggregation
switches itself off whenever the link is idle or the cell is busy, so on a quiet
connection it reads `ca_deactivated` most of the time. That is worth colouring
amber in the grid, and it is not worth reporting as a fault in the header — a
verdict that is always amber has stopped being a verdict. Values from the
built-in vocabulary therefore colour but do not count. Name one in `warn_value`
and it counts, because then someone has said that for *this* router it is a
problem.

## Temperatures

One row per sensor, with a bar against `temp_max` (85 °C by default) and the
value in the grade's colour — blue below `temp_warn`, amber above it, red above
`temp_hot`.

The sensors are found by **unit**, not by name. The obvious filter — an id
containing "temp" — misses the one this was built against: the ZTE publishes
its 5G modem temperature as `sensor.zte_pm_modem_5g`, which carries "Temp" in
its friendly name and nowhere in its id, so a name filter silently drew one of
the two modem temperatures and dropped the other.

The unit is also what keeps the ZTE's `pm_sensor_pa1` out: it reads −40 on a
scale nobody has documented and publishes no unit at all, and drawing it as
40 °C below zero beside a modem at 52 °C is worse than leaving it out.

## Throttling is a chip, never a graph

Thermal throttle sensors read 0 the overwhelming majority of the time. A
24-hour bar chart of a value that is always zero is a picture of nothing, which
is exactly what the dashboard this replaces had.

What is worth drawing is one bit — is anything throttling right now — and if so,
which sensor said so. So the whole set collapses into a single chip: green and
naming the sensors it is watching, or red and naming the one that tripped.

## Cell & band

A two-column grid of label/value cells, each opening more-info on a tap. The
vocabulary is shortened and translated on the way out: `LTE BAND 3` becomes
`LTE B3`, `ca_deactivated` becomes `Aus`. `value_map` overrides any of it and
covers a brand this table has never seen.

Left unconfigured, the grid is built from whatever the PCI, band, carrier
aggregation and cell-id slots discovered.

## Reachability checks

Four tiles per row, each a filled tick or cross. These are the one block with
no discovery behind them, because what counts as "the internet works" is a
local question — a TCP probe, a DNS lookup against your own resolver, the same
lookup against a public one:

```yaml
check_entities:
  - { entity: binary_sensor.dns_tcp_reachable, name: Verbindung }
  - { entity: binary_sensor.dns_local_ok, name: AdGuard }
  - { entity: binary_sensor.dns_external_ok, name: Extern }
  - { entity: sensor.dns_check_status, name: Status, ok_state: OK }
```

`ok_state` names the healthy state for a sensor that is not a binary one.
Without it the usual on/connected vocabulary is accepted. A sensor that is not
reporting goes grey with a question mark rather than red: "no data" and "broken"
are different answers.

## The restart button asks first

A full-width button that takes **two taps**. The first fills it with the alarm
colour, squares off its corners and changes the label to "Really restart?"; the
second fires. Nothing happens on one tap.

If the second tap does not come, the button disarms itself after
`confirm_timeout` (4 seconds). That matters more than it sounds: an armed red
button left on a wall tablet is a trap for the next person who walks past it.

After firing, the card shows "Restarting…" with a turning icon until the
connection entity reports back. Watched rather than timed, because a ZTE is back
in about 50 seconds and a Fritzbox in three minutes and a fixed wait would be
wrong for both. A three-minute backstop ends it if the router never returns.

`reboot_action` takes the usual action grammar. Left out, the card looks for a
`button.*_reboot` or `button.*_restart` on the same prefix. Where the restart is
a service rather than an entity:

```yaml
reboot_action:
  action: perform-action
  perform_action: pyscript.zte_reboot_router
```

`confirm_reboot: false` makes a single tap fire immediately. The editor says
plainly what that means.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `entity` | string | discovered | The connection entity, used to tell when a restart has completed. |
| `entity_prefix` | string | guessed | Narrows discovery to one router's entities. |
| `auto_discover` | boolean | `true` | Off, only what is configured is drawn. |
| `name` | string | "Diagnostics" | Header title. |
| `icon` | string | `mdi:stethoscope` | Header icon. |
| `temperature_entities` | list | discovered | Each entry takes `entity`, `name`, `max`. |
| `throttle_entities` | list | discovered | Collapsed into one chip — see above. |
| `info_entities` | list | discovered | The cell/band grid. Each entry takes `entity`, `label`, `warn_value`. |
| `check_entities` | list | — | The reachability tiles. Each takes `entity`, `name`, `ok_state`. **Required for the block to appear.** |
| `temp_warn` | number | `60` | Amber above this. |
| `temp_hot` | number | `70` | Red above this, and counted as a finding. |
| `temp_max` | number | `85` | Full scale for a bar without its own `max`. |
| `show_temperatures`, `show_throttle`, `show_info`, `show_checks`, `show_reboot` | boolean | `true` | Block switches. |
| `show_uptime`, `show_firmware`, `show_clients` | boolean | `false` | Extra header chips, drawn when the entity exists. |
| `reboot_action` | action | the discovered reboot button | What the second tap does. |
| `confirm_reboot` | boolean | `true` | The two-tap confirmation. |
| `confirm_timeout` | number | `4000` | How long the armed button waits, in milliseconds. |
| `value_map` | map | — | Raw state → label for the cell/band grid. |
| `accent_color`, `ok_color`, `warn_color`, `hot_color` | string | — | Colour overrides. |
| `animation` | string | `auto` | `auto`, `on` or `off`. `off` stills the press shapes and the restart spinner. |
| `text_color`, `secondary_text_color`, `card_background`, `glass_background`, `radius`, `corners`, `card_version` | — | — | The usual shared appearance options. |

Its companion, [M3 Router Card](#m3-router-card), carries the connection, the
signal grading, the throughput and the monthly volume.
