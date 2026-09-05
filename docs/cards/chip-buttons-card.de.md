---
title: M3 Chip Buttons Card
type: m3-chip-buttons-card
category: light
display: Chip Buttons
summary: Eine Reihe kompakter Entitäts-Pillen, jede mit eigenen Aktionen
table_order: 5
section_order: 36
---

Eine horizontale Reihe antippbarer Pillen-Chips — einer pro Entity — mit
Tap-/Hold-/Doppeltipp-Aktionen. Das ist die M3-Antwort auf Bubble Cards
„sub-buttons only"-Karte: gleiche Grundidee (eine Reihe Icon-Chips), aber
flachere Konfiguration — ein Formular pro Chip statt mehrerer verschachtelter
Panels, und explizite Auf/Ab-Buttons zum Umsortieren statt eines Dropdown-Menüs.

Ein Chip kann auch nicht-interaktiv sein (`interactive: false`) — dann wird er
zu einer reinen Anzeige (z.B. ein Temperatur- oder Feuchte-Chip), das M3-
Äquivalent zu Bubble Cards separater zweiter Zeile, ohne ein zweites
Positionierungssystem konfigurieren zu müssen.

<img src="docs/images/chip-buttons-card.png" alt="Chip Buttons Card" width="700">

<details>
<summary>Konfiguration, Beispiele & Optionen</summary>

```yaml
type: custom:m3-chip-buttons-card
wrap: false
justify: start
buttons:
  - entity: input_select.home_mode
    name: Daheim
    icon: mdi:home
    tap_action:
      action: more-info
  - entity: lock.haustuer
    name: Abgeschlossen
    color: blue
    tap_action:
      action: toggle
    hold_action:
      action: more-info
  - icon: mdi:magnify
    name: Suche
    interactive: false
    tap_action:
      action: none
  - entity: sensor.wohnzimmer_temperatur
    interactive: false
    show_state: true
glass_background: true
radius: 28
```

### Konfigurationsoptionen

| Option | Typ | Standard | Beschreibung |
|---|---|---|---|
| `buttons` | Liste | `[]` | Die Chips, in Anzeigereihenfolge. Jeder Eintrag unterstützt die folgenden Felder |
| `buttons[].entity` | string | – (optional) | Beliebige Entity. Kann für einen reinen Aktions-/Anzeige-Chip leer gelassen werden |
| `buttons[].name` | string | `friendly_name` der Entity | Angezeigter Name |
| `buttons[].icon` | string | Entity-Icon, sonst ein generisches Icon | Icon |
| `buttons[].color` | string | `primary` | HA-Farbname oder beliebige CSS-Farbe für den Chip im **aktiven** Zustand |
| `buttons[].inactive_color` | string | – (Standard-Theme-Grau) | Farbe für den Chip im **inaktiven** Zustand |
| `buttons[].show_state` | boolean | `true` | Entity-Zustand neben dem Namen anzeigen |
| `buttons[].static_color` | boolean | `false` | Chip immer als „aktiv" darstellen, unabhängig vom tatsächlichen Entity-Zustand (z.B. für einen Status-Chip, der immer hervorstechen soll) |
| `buttons[].interactive` | boolean | `true` | `false` macht aus dem Chip eine reine Anzeige — keine Tap-/Hold-Handler, nicht per Tastatur fokussierbar |
| `buttons[].tap_action` | Action | `more-info` | Tap-Aktion, gleicher Aktions-Picker wie bei jeder anderen Karte |
| `buttons[].hold_action` | Action | `none` | Aktion bei langem Drücken |
| `buttons[].double_tap_action` | Action | `none` | Aktion bei Doppeltipp |
| `wrap` | boolean | `false` | Chips auf mehrere Zeilen umbrechen statt horizontal zu scrollen |
| `justify` | `start` \| `center` \| `end` \| `space-between` | `start` | Horizontale Ausrichtung der Chip-Reihe |
| `radius` | number (px) | `28` | Eckenradius der Karte |
| `corners` | object | – | Optionaler Override je Ecke, wie bei jeder anderen Karte |
| `glass_background` | boolean | `true` | Milchiger Glashintergrund |
| `card_background` | string | – | Hintergrundfarbe überschreiben |
| `animation` | `auto` \| `on` \| `off` | `auto` | Press-Animation; `auto` respektiert `prefers-reduced-motion` |

</details>
