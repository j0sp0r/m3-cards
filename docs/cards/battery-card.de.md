---
title: M3 Battery Card
type: m3-battery-card
category: system
display: Battery
summary: Akkustände aller `device_class: battery`-Sensoren
table_order: 0
section_order: 13
---

Übersicht aller Batteriestand-Sensoren als sortierte Liste mit
Schwellwert-Einfärbung (kritisch/niedrig/mittel/ok), Balken pro Zeile und
Aufklappbereich für die restlichen Geräte.

<img src="docs/images/battery-card.png" alt="Battery Card" width="440">

<details>
<summary>Konfiguration, Beispiele & Optionen</summary>

```yaml
type: custom:m3-battery-card
auto_discover: true
```

### Entitätsquelle

- **`auto_discover: true`** (Standard): findet automatisch alle Entities mit
  `device_class: battery`, optional gefiltert über `include_area` /
  `include_label` / `exclude_entities`. Einträge in `entities` wirken in
  diesem Modus als Name-/Icon-Override pro Entity (nicht als vollständiger
  Ersatz der automatischen Liste).
- **`auto_discover: false`**: nur die explizit in `entities` gelistete
  Auswahl.

`name_strip` entfernt konfigurierbare Suffixe aus dem angezeigten Namen
(Standard: „ Battery Level“, „ Batteriestand“, „ Battery“, „ Batterie“) — der
Entity-Name „Schlafzimmer Batteriestand“ wird so zu „Schlafzimmer“.

### Sortierung, Schwellwerte, Anzeige

Zeilen sind immer `unavailable` zuerst, danach aufsteigend nach Ladestand
sortiert — damit stehen die Geräte, die am ehesten Aufmerksamkeit brauchen,
oben. `thresholds` (kritisch/niedrig/mittel) bestimmen Balken- und
Textfarbe; `max_visible` + `show_healthy_toggle` blenden gesunde Geräte
hinter einem „N weitere anzeigen“-Button aus, ähnlich der Power List Card.

### Benachrichtigung bei schwachen Batterien

Die Kachel warnt nur, solange man sie ansieht — deshalb kann der Abschnitt
**Benachrichtigung** im Editor eine Home-Assistant-Automatisierung anlegen,
die unabhängig davon benachrichtigt. Ein oder mehrere Ziele auswählen (aus
den eigenen `notify.*`-Diensten), Schwellwert setzen (`notify_threshold`,
Standard 1 %), Rhythmus wählen, dann „Benachrichtigung einrichten“:

- **`daily`** / **`weekly`** — eine Sammelnachricht zur Zeit `notify_time`
  mit allen schwachen Batterien („5 Batterien schwach: …“), damit aus zwölf
  leeren Geräten nicht zwölf Pushes werden. `weekly` löst zusätzlich nur am
  Tag `notify_weekday` aus.
- **`on_change`** — meldet sofort, sobald eine Batterie den Schwellwert
  unterschreitet, eine Nachricht pro Gerät. Scharf wird es von selbst
  wieder, sobald die Batterie wieder darüber liegt.

Überwacht werden genau die Geräte, die die Kachel auflistet — die manuelle
`entities`-Liste oder die Auto-Discovery inklusive Bereichs-/Label-Filter.
Diese Auswahl wird beim Drücken des Buttons aufgelöst und in die
Automatisierung geschrieben; **nach dem Hinzufügen neuer Geräte den Button
erneut drücken**, damit sie mit abgedeckt sind. `notify_exclude_entities`
schaltet einzelne Geräte stumm, ohne sie aus der Kachel zu entfernen —
praktisch für Sensoren, die dauerhaft 1 % melden.

### Konfigurationsoptionen

| Option | Typ | Standard | Beschreibung |
|---|---|---|---|
| `auto_discover` | boolean | `true` | Automatische Erkennung aller Batterie-Sensoren |
| `entities` | Liste | – | Manuelle Auswahl bzw. Overrides bei `auto_discover: true` |
| `include_area` / `include_label` | Liste\<string\> | – | Filter für die Auto-Discovery |
| `exclude_entities` | Liste\<string\> | – | Von der Auto-Discovery ausgeschlossene Entities |
| `name_strip` | Liste\<string\> | siehe oben | Zu entfernende Namens-Suffixe |
| `thresholds` | Objekt (`critical`/`low`/`medium`) | `10`/`20`/`50` | Prozent-Schwellwerte für die Einfärbung |
| `max_visible` | number | – | Anzahl direkt sichtbarer Zeilen, Rest hinter „mehr anzeigen“ |
| `show_healthy_toggle` | boolean | `true` | Aufklappbereich für Geräte über dem `medium`-Schwellwert |
| `notify_service` | Liste\<string\> | – | Benachrichtigungsziele (ohne `notify.`-Präfix) |
| `notify_threshold` | number | `1` | Prozentwert, ab dem eine Batterie als schwach gilt |
| `notify_mode` | `daily` \| `weekly` \| `on_change` | `daily` | Sammelnachricht zur festen Zeit, wöchentlich, oder sofort beim Unterschreiten |
| `notify_time` | string | `18:00:00` | Uhrzeit der Sammelnachricht (nur `daily`/`weekly`) |
| `notify_weekday` | string | `mon` | Wochentag der Sammelnachricht (nur `weekly`) |
| `notify_exclude_entities` | Liste\<string\> | – | Geräte, die keine Benachrichtigung auslösen |
| `name` / `icon` | string | „Batterien“ / `mdi:battery` | Header |
| `critical_color` / `low_color` / `medium_color` / `ok_color` / `unavailable_color` | string | Theme-Standard | Stufenfarben |
| `text_color` / `secondary_text_color` | string | Theme-Standard | Name / Werte |
| `card_background` | string | Glas-/Solid-Hintergrund | Kartenhintergrund |
| `animation` | `auto` \| `on` \| `off` | `auto` | Auf-/Zuklapp-Animation; `auto`/`on` respektieren `prefers-reduced-motion` |
| `glass_background` | boolean | `true` | Milchiger Glashintergrund |
| `radius` / `corners` | number / object | `28` | Eckenradius, optional je Ecke |

</details>
