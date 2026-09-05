---
title: M3 Presence Card
type: m3-presence-card
category: presence
display: Presence
summary: Wer ist zu Hause — Avatar-Raster für `person`/`device_tracker`
table_order: 0
section_order: 15
---

Anwesenheitsübersicht als Avatar-Raster für `person`- und
`device_tracker`-Entities mit Status-Ring (zuhause/abwesend/Zone/unbekannt),
Initialen-Avatar, relativer Zeitangabe („seit 5 Min.“) und optional
eingebetteter Karte (`hui-map-card`).

<img src="docs/images/presence-card.png" alt="Presence Card" width="440">

<details>
<summary>Konfiguration, Beispiele & Optionen</summary>

```yaml
type: custom:m3-presence-card
auto_discover: true
```

### Entitätsquelle

- **`auto_discover: true`** (Standard): findet automatisch alle
  `person`-Entities, optional gefiltert über `include_area` /
  `include_label` / `exclude_entities`.
- **`auto_discover: false`**: nur die explizit in `entities` gelistete
  Auswahl (`person.*` oder `device_tracker.*`).

### Interaktion

Ein Tap auf eine Person öffnet deren More-Info-Ansicht; langes Drücken (500ms)
löst optional `hold_action` aus (z.B. Navigation zu einer Karten-Ansicht).

`tap_action` ersetzt das More-Info beim Tap durch eine beliebige übliche
Home-Assistant-Aktion — `navigate`, `url`, `perform-action`, `toggle`,
`more-info` oder `none`. Wie `hold_action` gilt sie für die ganze Karte, und
Ziel ist die tatsächlich angetippte Person: `more-info`, `toggle` und ein
Dienstaufruf ohne eigenes Ziel landen alle auf deren `entity_id`.

```yaml
type: custom:m3-presence-card
tap_action:
  action: navigate
  navigation_path: /lovelace/personen
hold_action:
  action: more-info
```

Ohne `tap_action` öffnet ein Tap weiterhin die More-Info-Ansicht.

Ein Dienst, der kein `entity_id` verträgt, braucht ein leeres `target` als
Ansage — sonst wird die angetippte Person mitgegeben und der Aufruf schlägt
fehl:

```yaml
hold_action:
  action: perform-action
  perform_action: persistent_notification.create
  target: {}
  data:
    message: Jemand hat eine Kachel gedrückt
```


### Konfigurationsoptionen

| Option | Typ | Standard | Beschreibung |
|---|---|---|---|
| `auto_discover` | boolean | `true` | Automatische Erkennung aller `person`-Entities |
| `entities` | Liste\<string\> | – | Manuelle Auswahl bei `auto_discover: false` |
| `include_area` / `include_label` | Liste\<string\> | – | Filter für die Auto-Discovery |
| `exclude_entities` | Liste\<string\> | – | Von der Auto-Discovery ausgeschlossene Entities |
| `name` / `icon` | string | „Anwesenheit“ / `mdi:account-group` | Header |
| `show_distance` | boolean | `false` | Entfernung zur Home-Zone anzeigen (falls verfügbar) |
| `show_since` | boolean | `true` | Relative Zeit seit letzter Zustandsänderung |
| `show_map` | boolean | `false` | Eingebettete Karte unterhalb des Avatar-Rasters |
| `sort` | `home_first` \| `name` | `home_first` | Sortierung: zuhause zuerst oder alphabetisch |
| `home_color` / `not_home_color` / `zone_color` / `unknown_color` | string | Grün/Blau/Lila/Grau | Status-Ring-Farben |
| `zone_colors` | Objekt (Zonenname → Farbe) | – | Override je benannter Zone |
| `tap_action` | Aktionsobjekt | more-info | Aktion bei einem Tap auf einen Avatar, mit dieser Person als Ziel. Ohne Eintrag öffnet ein Tap deren More-Info-Ansicht |
| `hold_action` | Aktionsobjekt | – | Aktion bei langem Drücken (500ms) auf einen Avatar, mit dieser Person als Ziel |
| `text_color` / `secondary_text_color` | string | Theme-Standard | Namen bzw. Statuszeile |
| `card_background` | string | Glas-/Solid-Hintergrund | Kartenhintergrund |
| `animation` | `auto` \| `on` \| `off` | `auto` | Statuswechsel-Animation; `auto`/`on` respektieren `prefers-reduced-motion` |
| `glass_background` | boolean | `true` | Milchiger Glashintergrund |
| `radius` / `corners` | number / object | `28` | Eckenradius, optional je Ecke |

</details>
