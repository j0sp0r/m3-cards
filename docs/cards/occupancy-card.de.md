---
title: M3 Occupancy Card
type: m3-occupancy-card
category: presence
display: Occupancy
summary: Raum-für-Raum Präsenz mit Aktivitäts-Zeitleiste
table_order: 1
section_order: 23
---

Präsenz Raum für Raum. Jede Zeile ist ein Raum; er gilt als belegt, sobald
einer seiner Sensoren `on` ist. Die Auto-Erkennung gruppiert `binary_sensor`
mit `device_class: occupancy`/`motion`/`presence` nach Bereich (Fallback:
Gerät, dann einzelner Sensor). Eine optionale Zeitleiste zeigt, wann ein Raum
in den letzten Stunden belegt war.

<img src="docs/images/occupancy-card.png" alt="Occupancy Card" width="440">

<details>
<summary>Konfiguration, Beispiele & Optionen</summary>

```yaml
type: custom:m3-occupancy-card
auto_discover: true
# oder manuelle Liste (auto_discover aus):
# sensors:
#   - entity: binary_sensor.wohnzimmer_presence
#     name: Wohnzimmer
```

### Konfigurationsoptionen

| Option | Typ | Standard | Beschreibung |
| --- | --- | --- | --- |
| `auto_discover` | boolean | `true` | Präsenz-/Bewegungssensoren automatisch finden |
| `include_area` | Liste | – | Nur diese Bereiche |
| `exclude_entities` | Liste | – | Diese Sensoren auslassen |
| `sensors` | Liste | – | Manuelle Räume: `{ entity, name, icon }` (schlägt Discovery) |
| `sort` | `occupied_first` \| `name` \| `last_active` | `occupied_first` | Reihenfolge |
| `show_timeline` | boolean | `true` | Aktivitäts-Zeitleiste unter den Zeilen |
| `timeline_hours` | number | `3` | Abgedeckte Stunden (1–24) |
| `max_visible` | number | – | Sichtbare Zeilen begrenzen, Rest aufklappbar |
| `notify_service` / `notify_enabled` | – | – | Optionale Push je Sensor bei Belegung (standardmäßig aus) |

</details>
