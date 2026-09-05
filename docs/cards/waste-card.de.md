---
title: M3 Waste Card
type: m3-waste-card
category: household
display: Waste
summary: Abfuhrtermine mit Zwei-Wochen-Zeitleiste und Erinnerungs-Modus
table_order: 3
section_order: 26
---

Abfuhrtermine: ein Hero mit der nächsten Abholung, eine Zwei-Wochen-Zeitleiste
und eine Zeile pro Tonne. Gib ihr Sensoren, deren Zustand die Tage bis zur
Abholung ist (z. B. Waste Collection Schedule mit
`value_template: '{{ value.daysTo }}'`). Zwei Modi: **info** (Tonnen werden
automatisch geleert — reine Information) und **reminder** (du stellst selbst
raus — eskaliert kurz vor dem Termin mit einem Rausgestellt-Knopf).

<img src="docs/images/waste-card.png" alt="Waste Card" width="440">

<details>
<summary>Konfiguration, Beispiele & Optionen</summary>

```yaml
type: custom:m3-waste-card
mode: info            # oder: reminder
entities:
  - sensor.altpapier
  - sensor.bio
  - { entity: sensor.wertstoff, name: Wertstoff, color: '#f0c46e' }
```

### Konfigurationsoptionen

| Option | Typ | Standard | Beschreibung |
| --- | --- | --- | --- |
| `mode` | `info` \| `reminder` | `info` | Nur Anzeige oder Eskalation + Quittieren |
| `entities` | Liste | – | Sensoren (Tage bis Abholung): ID oder `{ entity, name, icon, color }` |
| `calendar_entity` | string | – | Kalender mit einem Eintrag je Abholung, dessen Titel die Tonne benennt. Wird mit `entities` zusammengeführt. |
| `hero_primary` | `days` \| `weekday` | `days` | Hero zeigt „in 3 Tagen" oder „Montag" |
| `hero_icon` | `first` \| `multi` | `first` | Einzelnes oder überlappende Tonnen-Icons |
| `show_timeline` | boolean | `true` | Zwei-Wochen-Zeitleiste |
| `timeline_days` | number | `14` | Zeitleisten-Spanne (7–28) |
| `max_rows` | number | `0` | Zeilen begrenzen, Rest aufklappbar (0 = alle) |
| `reminder_offset` | number | `1` | Tage vor Abholung, ab denen erinnert wird (Reminder-Modus) |
| `reminder_time` | string | `18:00` | Am Vortag erst ab dieser Uhrzeit erinnern |
| `ack_entity` | string | – | `input_boolean`/`input_datetime` für „rausgestellt" |
| `notify_service` / `notify_enabled` | – | – | Optionale Rausstell-Erinnerung per Push (standardmäßig aus) |

</details>
