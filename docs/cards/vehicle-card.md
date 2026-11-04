---
title: M3 Vehicle Card
type: m3-vehicle-card
category: household
display: Vehicle
summary: One car — charge or tank, range, lock, location, alerts and actions — for any integration, electric, combustion or hybrid
table_order: 19
section_order: 50
---

One car on one card. It knows no manufacturer, only meanings — a battery, a
range, whether it is charging, the lock, where it stands — and every one of
them is a slot you fill with an entity or a template. A slot left empty is a
block that is not drawn, so a name and a battery make a whole card.

<img src="docs/images/vehicle-card.png" alt="Vehicle Card — charging at home, and parked at work with an open window" width="440">

**The charge is the layout.** Parked, the charge is one line: a figure, a bar
and the range. Charging, it becomes the hero — a large figure over the suite's
wave, the charge limit marked on the track, and underneath what it means:
"11 kW · full at 18:40" and "Limit 80 %". The change between the two eases.

<details>
<summary>Configuration, examples & options</summary>

### Minimal

```yaml
type: custom:m3-vehicle-card
name: Family car
energy:
  battery: sensor.car_battery
```

### Electric, everything mapped

```yaml
type: custom:m3-vehicle-card
name: Family car
energy:
  battery: sensor.car_battery
  range: sensor.car_range
  charging: binary_sensor.car_charging
  plugged: binary_sensor.car_plug
  charge_power: sensor.car_charging_power
  charge_limit: number.car_charge_limit
  charge_end: sensor.car_charging_end
  capacity_kwh: 77
lock: lock.car
location: device_tracker.car
stale_after_minutes: 180
chips:
  - entity: binary_sensor.car_doors
    icon: mdi:car-door
  - entity: sensor.car_inside_temperature
    icon: mdi:thermometer
  - entity: sensor.car_tyre_pressure_front_left
    icon: mdi:car-tire-alert
    warn_below: 2.2
actions:
  - name: Pre-condition
    icon: mdi:air-conditioner
    primary: true
    entity: climate.car
    tap_action:
      action: toggle
  - icon: mdi:ev-plug-type2
    entity: switch.car_charging
    tap_action:
      action: toggle
      confirmation:
        text: Stop charging?
    visible:
      entity: binary_sensor.car_charging
  - icon: mdi:map-marker
    entity: device_tracker.car
alerts:
  - when:
      entity: binary_sensor.car_window_rear_left
    text: Rear left window open
    action:
      name: Lock
      entity: lock.car
      tap_action:
        action: perform-action
        perform_action: lock.lock
  - when:
      below: 20
    text: Battery low
```

### Combustion

```yaml
type: custom:m3-vehicle-card
name: Estate
icon: mdi:car-estate
drive: fuel
energy:
  fuel_level: sensor.estate_fuel_level
  fuel_range: sensor.estate_fuel_range
lock: lock.estate
location: device_tracker.estate
```

### Plug-in hybrid

Two slim bars, battery and tank, each with its own range. While the battery
charges, its bar becomes the wave.

```yaml
type: custom:m3-vehicle-card
name: Plug-in
drive: hybrid
energy:
  battery: sensor.phev_battery
  range: sensor.phev_electric_range
  charging: sensor.phev_charging_status
  fuel_level: sensor.phev_fuel_level
  fuel_range: sensor.phev_fuel_range
```

### Templates

Every value slot takes an object as well as an entity id. `template` is
rendered live by Home Assistant and wins over `entity` for the value; `entity`
still supplies the timestamps and the more-info target.

```yaml
energy:
  battery: sensor.car_battery
  range:
    entity: sensor.car_range_miles
    template: "{{ (states('sensor.car_range_miles') | float(0) * 1.609) | round(0) }}"
    unit: km
  charging:
    entity: sensor.car_charging_state
    charging_states: [charging, fast_charging]
location:
  entity: device_tracker.car
  attribute: address
```

A slot object takes `entity`, `template`, `attribute`, `name`, `icon`, `unit`,
`warn_below` and `warn_above`.

### What the card never guesses

- **Unavailable is a dash, not 0 %.** The bar stays empty and grey, no
  threshold matches, no alert fires on it.
- **"Parked" needs a charging or plug sensor that says so.** Without one the
  subtitle names only the place.
- **The charge end** comes from `charge_end`. Without it the card estimates
  `(limit − battery) × capacity_kwh ÷ power` — but only when `capacity_kwh` is
  set, and it then says "full ≈ 18:40". Without either, it shows no time.
- **"Updated 3 min ago"** reads the battery's (or tank's) `last_reported`, which
  moves with every report, not only when the value changes. `last_updated`
  overrides it with a timestamp of your own.

### Alerts

An alert row is drawn only while its condition holds. A condition uses the
suite's rule vocabulary — `value` (one or a list), `regex`, `above`, `below` —
plus `template` and `for_minutes`. A condition with only an `entity` holds
while that entity is on (open, unlocked, plugged in), and a condition with no
entity refers to the battery (the tank on `drive: fuel`). A list under `when`
means every condition must hold.

```yaml
alerts:
  - when:
      - entity: lock.car
        value: unlocked
        for_minutes: 10
      - entity: device_tracker.car
        value: home
    text: Unlocked at home for 10 minutes
    action:
      name: Lock
      entity: lock.car
      tap_action:
        action: perform-action
        perform_action: lock.lock
  - when:
      template: "{{ states('sensor.car_service_days') | int(99) < 14 }}"
    text: Service due soon
    severity: info
```

### Actions

The first action can be `primary: true` — a wide tonal button with its name.
The others are round icon buttons; with no primary they share the row. Every
standard action works (`more-info`, `toggle`, `perform-action`, `navigate`,
`url`), `confirmation` included, and `hold_action` too. `entity` is the target
of a toggle or more-info, and a button whose entity is on (a switch, a climate)
shows it. `visible` takes the same conditions as an alert.

### Folding

`collapsible: true` folds the card to its header and charge. With a lock, the
lock pill is the fold button (with its chevron); without one, the round
chevron is. `collapse_blocks` names what folds (default: chips, actions,
footer); alerts always stay. `default_collapsed`, `collapse_memory` and
`collapse_state_entity` work as on the other folding cards.

### Notifications

The editor can write a Home Assistant automation for up to four reasons:
**charging finished** (a real change, held a minute — not a dropout),
**battery or fuel below** a level, **unlocked for** some minutes, and an
evening **reminder** when the car is low and not plugged in. Only slots mapped
to an entity can be watched; a templated slot has nothing an automation could
trigger on.

### Options

| Option | Default | Description |
|---|---|---|
| `name` / `icon` | "Vehicle" / `mdi:car` | Header |
| `image` | – | A cut-out picture in the icon well instead of the icon |
| `drive` | `ev` | `ev`, `fuel` or `hybrid` — which energy slots the card expects |
| `energy.battery` / `energy.range` | – | Charge in %, electric range |
| `energy.charging` | – | A binary_sensor, or a sensor with `charging_states` (default `charging`, `on`, `true`) |
| `energy.plugged` | – | Tells "plugged in" from "parked" when not charging |
| `energy.charge_power` | – | kW; a sensor in W is converted |
| `energy.charge_limit` | – | The marker on the track and "Limit 80 %" |
| `energy.charge_end` | – | Timestamp; preferred over any estimate |
| `energy.capacity_kwh` | – | Enables the charge-end estimate |
| `energy.fuel_level` / `energy.fuel_range` | – | Tank in %, fuel range |
| `lock` | – | A lock, or a binary_sensor of class lock (on = unlocked) |
| `location` | – | device_tracker, person or a sensor naming the place |
| `last_updated` | battery's last report | A timestamp of your own for the footer |
| `stale_after_minutes` | `0` (never) | After this long without a report the footer warns |
| `chips` | – | The suite's chips, plus `warn_below` / `warn_above` per chip |
| `chip_style` | `pill` | `pill` or `tile` |
| `actions` | – | Buttons — see above |
| `alerts` | – | Conditional rows — see above |
| `layout` | `[energy, alerts, chips, actions, footer]` | Order and visibility of the blocks |
| `tap_action` | more-info of the battery | Header tap |
| `collapsible`, `collapse_blocks`, `default_collapsed`, `collapse_memory`, `collapse_state_entity` | – | Folding |
| `accent_color`, `accent_opacity`, `text_color`, `secondary_text_color`, `card_background`, `glass_background`, `radius`, `corners`, `animation` | — | The usual shared appearance options |

Integration presets — one line that maps every slot for a given brand — are
not built yet. The slots are read in one place (`resolveVehicle`), so a preset
will be a function that fills the config before it gets there.

</details>
