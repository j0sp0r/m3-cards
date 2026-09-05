---
title: M3 Leak Card
type: m3-leak-card
category: presence
display: Leak
summary: Wassermelder-Übersicht mit ruhigem OK und lautem Alarm + Absperrung
table_order: 2
section_order: 25
---

Wassermelder-Übersicht mit zwei klar getrennten Zuständen: ruhig, wenn alles
trocken ist, unübersehbar im Alarm — inklusive direkter Absperrung. Erkennt
`binary_sensor` mit `device_class: moisture` automatisch, findet den
Batterie-Sensor jedes Melders und färbt die ganze Karte rot, sobald einer
Wasser meldet.

<img src="docs/images/leak-card.png" alt="Leak Card" width="440">

<details>
<summary>Konfiguration, Beispiele & Optionen</summary>

```yaml
type: custom:m3-leak-card
auto_discover: true
valve_entity: valve.hauptwasser      # optional: valve / switch / cover
# siren_entity: siren.alarm          # optional, für die Quittieren-Taste
```

`max_visible` hält die Liste kurz: Die ersten Sensoren stehen da, der Rest
liegt hinter einem „N weitere anzeigen". Im Alarmfall tritt die Begrenzung
zurück — welcher Sensor nass ist, muss ohne zweiten Tap sichtbar sein.

### Konfigurationsoptionen

| Option | Typ | Standard | Beschreibung |
| --- | --- | --- | --- |
| `auto_discover` | boolean | `true` | `device_class: moisture`-Sensoren finden |
| `include_area` / `exclude_entities` | Liste | – | Discovery eingrenzen |
| `sensors` | Liste | – | Manuelle Liste: `{ entity, name, icon, battery_entity }` |
| `valve_entity` | string | – | Absperrventil (valve/switch/cover) — nur dann erscheint die Absperr-Taste |
| `confirm_shutoff` | boolean | `false` | Vor dem Absperren nachfragen |
| `siren_entity` / `ack_entity` | string | – | Wird auf der Quittieren-Taste ausgeschaltet/gesetzt |
| `stale_hours` | number | `6` | Länger stiller Sensor gilt als „still" |
| `battery_warn` / `battery_critical` | number | `40` / `20` | Schwellen des Batterie-Chips |
| `test_interval_days` | number | `0` | „Test fällig"-Chip nach N Tagen (mit `last_test_entity`) |
| `max_visible` | number | – | Zeigt nur so viele Sensoren, der Rest hinter einem Umschalter |
| `collapse_ok` | boolean | `false` | Liste einklappen, solange alles trocken |
| `notify_service` / `notify_enabled` | – | – | Optionale Push bei Wasser (standardmäßig aus) |

> Die Karte ist die **Übersicht**, nicht der Alarm. Kombiniere sie mit einer
> Automation, die eine kritische Push sendet (`push: sound: critical` auf iOS,
> hochpriorisierter Kanal auf Android) — dann wirst du auch bei geschlossenem
> Dashboard benachrichtigt.

</details>
