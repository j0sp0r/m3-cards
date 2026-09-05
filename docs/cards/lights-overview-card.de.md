---
title: M3 Lights Overview Card
type: m3-lights-overview-card
category: light
display: Lights Overview
summary: Alle Leuchten nach Bereich gruppiert, mit getrennten Filtern für Anzeige und Schalten
table_order: 4
section_order: 35
---

Eine Raum-für-Raum-Lichtübersicht, nach demselben Muster wie Climate Overview
oben (die beiden sind dafür gedacht, gestapelt auf einem Dashboard zu
sitzen): eine Kachel pro Raum mit An/Aus-Status und Anzahl, oder eine flache
Liste aller Lichter. Ein Tap schaltet die Lichter des Raums; Hold öffnet ein
Popup.

<img src="docs/images/lights-overview-card.png" alt="Lights Overview Card" width="440">
<img src="docs/images/lights-overview-card-popup.png" alt="Lights Overview Card, Popup" width="440">

<details>
<summary>Konfiguration, Beispiele & Optionen</summary>

```yaml
type: custom:m3-lights-overview-card
auto_discover: true
```

### Entity-Quelle und Raumzuordnung

- **`auto_discover: true`** (Standard): findet alle `light`-Entities, die
  einem HA-**Bereich** zugeordnet sind, und gruppiert sie zu dessen Kachel.
  Anders als bei Climate Overview wird ein Licht ohne Bereich verworfen statt
  zu einer eigenen Kachel zu werden — eine Raum-für-Raum-Übersicht hat für
  ein nicht zuordenbares Licht nichts Sinnvolles zu zeigen. Filterbar über
  `include_area` / `exclude_entities` / `include_labels` / `exclude_labels` /
  `include_state` / `exclude_state`.
- **`rooms`**: eine manuelle Liste (`name`, `icon`, `entities`,
  `toggle_entities`) statt Auto-Discovery.
- **`view`**: `rooms` (Standard, eine Kachel pro Raum) oder `entities` (eine
  Kachel pro Licht, mit dem Raumnamen als Unterzeile).
- **`group_handling`**: wenn eine `light.group` und ihre Mitglieder sonst
  beide als eigene Lichter im selben Raum zählen würden, eine Seite fallen
  lassen — `prefer_groups` zählt nur die Gruppe, `prefer_members` nur die
  Mitglieder. Standard `all` zählt beide.

### Was gezeigt wird vs. was ein Tap schaltet

Status und Anzahl einer Kachel spiegeln jedes Licht wider, das der
Anzeigefilter oben durchlässt. Was ein **Tap** tatsächlich schaltet, kann
enger sein: `toggle_filter` (dieselbe Syntax wie der Anzeigefilter) setzen,
um nur eine Teilmenge zu schalten, oder `exclude_toggle_entities` als
Kurzform für "zeigen, aber nicht schalten" bei bestimmten Entities — nützlich
für ein zeitgesteuertes Licht oder eine Szenen-Leuchte, die sichtbar sein
soll, aber nicht Teil des raumweiten Umschaltens. `toggle_inherit_filters:
false` lässt `toggle_filter` eigenständig stehen, statt den Anzeigefilter
einzugrenzen. Bei einem manuellen Raum ist `toggle_entities` standardmäßig
gleich `entities`.

### Tap, Hold und das Popup

Dasselbe Action-System wie bei Climate Overview: `tap_action` (Standard
`toggle`) / `hold_action` (Standard `popup`, oder `more-info` in der
`entities`-Ansicht) / `double_tap_action`, wobei `popup.mode` bestimmt, was
Hold öffnet — **`default-grid`** (dieselbe Karte noch einmal, eingegrenzt auf
den angetippten Raum), **`default-detail`** (HA's More-Info-Dialog) oder
**`custom`** (eine beliebige Lovelace-Karte aus `popup.card`, mit
`[[area_id]]`, `[[entity_id]]`, `[[name]]` aufgelöst gegen den angetippten
Raum).

### Konfigurationsoptionen

| Option | Typ | Standard | Beschreibung |
|---|---|---|---|
| `auto_discover` | boolean | `true` | Automatische Erkennung von Lichtern nach Bereich |
| `include_domains` | Liste | `["light"]` | Welche Domänen die Erkennung durchsucht. Eine Lampe an einer Funksteckdose ist ein `switch`, und nichts in Home Assistant sagt, welche Schalter Licht sind — `switch` ergänzen und mit den Include/Exclude-Filtern eingrenzen, oder die Entitäten stattdessen je Raum unter `rooms` aufzählen |
| `include_area` / `exclude_area` | list\<string\> | – | Filter für Auto-Discovery |
| `include_entities` / `exclude_entities` | list\<string\> | – | Entity-Filter für Auto-Discovery |
| `include_labels` / `exclude_labels` | list\<string\> | – | Label-Filter für Auto-Discovery |
| `include_state` / `exclude_state` | list\<string\> | – | Status-Filter (`on`/`off`/`unavailable`/`unknown`, oder ein eigener Wert) |
| `group_handling` | `all` \| `prefer_groups` \| `prefer_members` | `all` | Wie eine `light.group` und ihre Mitglieder gezählt werden |
| `rooms` | Liste (`name`, `icon`, `entities`, `toggle_entities`) | – | Manuelle Raumliste statt Auto-Discovery |
| `name` / `icon` | string | "Lights" / `mdi:lightbulb-group` | Header |
| `view` | `rooms` \| `entities` | `rooms` | Kachel pro Raum, oder eine flache Liste pro Licht |
| `sort` | `name` \| `area` \| `on_first` | `name` | Kachel-Reihenfolge |
| `show_header` | boolean | `true` | Kartenheader |
| `show_count` | boolean | `true` | "N/gesamt an" auf einer Mehrlicht-Kachel |
| `show_area` | boolean | `true` | Raumname als Unterzeile in der `entities`-Ansicht |
| `hide_empty_rooms` | boolean | `false` | Räume ohne passende Lichter verwerfen |
| `toggle_filter` | Objekt (dieselben Felder wie der Anzeigefilter) | – | Engerer Filter dafür, was ein Tap tatsächlich schaltet |
| `exclude_toggle_entities` | list\<string\> | – | Kurzform: zeigen, aber nie schalten |
| `toggle_inherit_filters` | boolean | `true` | Ob `toggle_filter` den Anzeigefilter eingrenzt oder eigenständig steht |
| `toggle_group_handling` | `all` \| `prefer_groups` \| `prefer_members` | `group_handling` | `group_handling`, angewendet auf die Schaltmenge |
| `tap_action` / `hold_action` / `double_tap_action` | Action-Config | toggle / popup / none | Tap-/Hold-/Doppeltap-Actions; ergänzt eine `popup`-Action |
| `popup` | Objekt (`mode`, `title`, `view`, `sort`, `show_area`, `show_header`, `card`, Filterfelder) | – | Popup der `popup`-Action — siehe oben |
| `on_color` / `off_color` | string | Theme-Standard | Kachelfarbe nach Status |
| `accent_color` / `accent_opacity` | string / number | Theme-Standard / `12` | Akzentfarbe des Header-Icons |
| `tile_tint_opacity` | number | – | Stärke der Kachel-Hintergrundtönung |
| `text_color` / `secondary_text_color` | string | Theme-Standard | Raumnamen/Werte bzw. Sekundärtext |
| `card_background` | string | Glas-/Solid-Hintergrund | Kartenhintergrund |
| `animation` | `auto` \| `on` \| `off` | `auto` | Respektiert `prefers-reduced-motion` |
| `glass_background` | boolean | `true` | Milchiger Glashintergrund |
| `radius` / `corners` | number / object | `28` | Eckenradius, optional je Ecke |

</details>
