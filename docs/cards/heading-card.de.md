---
title: M3 Heading Card
type: m3-heading-card
category: household
display: Heading
summary: Abschnitts-Überschriften zwischen den Karten: schlicht, mit Status, als Trenner oder aufklappbar
table_order: 7
section_order: 30
---

Eine Abschnitts-Überschrift für den Raum *zwischen* den Karten. Sie zeichnet
bewusst keine eigene Karte — kein Rahmen, kein Glas, kein Schatten —, damit sie
als Beschriftung für das Folgende gelesen wird und nicht als weitere Kachel im
Raster. Sie ersetzt die eingebaute heading-Karte von Home Assistant, die ihren
Zweck erfüllt, aber nicht in der Designsprache dieser Suite.

<img src="docs/images/heading-card.png" alt="Heading Card" width="440">

<details>
<summary>Konfiguration, Beispiele & Optionen</summary>

```yaml
type: custom:m3-heading-card
style: simple          # simple | status | divider | collapsible
title: Beleuchtung
icon: mdi:lightbulb
color: "#f0c46e"
```

### Die vier Varianten

| Variante | Was sie ist |
| --- | --- |
| `simple` | Squircle-Icon und Titel. Der Standard. |
| `status` | Zusätzlich ein Zähler-Chip und rechts ein Aktions-Button |
| `divider` | Ohne Icon und Titel: ein Strich, ein Label in Versalien, ein längerer Strich |
| `collapsible` | Zusätzlich ein Pfeil, der die Karten darunter einklappt |

### Status

Der Chip nimmt entweder festen Text, eine Entität, deren Zustand er zeigt, oder
`count_entities` — dann zählt er, wie viele davon an sind. Eine nicht
verfügbare Entität zählt in keine Richtung mit, denn sie als „aus“ zu melden
wäre eine Aussage, die die Karte nicht belegen kann.

```yaml
type: custom:m3-heading-card
style: status
title: Steckdosen
icon: mdi:power-plug
count_entities:
  - switch.schreibtisch
  - switch.tv
  - switch.lampe
action:
  name: Alle aus
  icon: mdi:power
  tap_action:
    action: call-service
    service: homeassistant.turn_off
    target:
      entity_id: [switch.schreibtisch, switch.tv, switch.lampe]
```

Der Button zieht nach einem Tap für eine halbe Sekunde seine Ecken zusammen und
hebt seine Tönung an. Er trägt keinen eigenen Zustand, das ist also die einzige
Rückmeldung, dass der Tap angekommen ist. Unter 260px entfällt die Beschriftung
und nur das Icon bleibt.

### Aufklappbar

Der Pfeil klappt alle Karten zwischen dieser Überschrift und der nächsten ein.
In die Dashboard-Konfiguration wird dabei nichts geschrieben — die Karten
werden im Browser ausgeblendet, Einklappen ist also ein Anzeigezustand und
keine Bearbeitung.

Drei andere Ansätze wurden geprüft und verworfen: die Lovelace-Konfiguration
bei jedem Tap umzuschreiben ist destruktiv und speichert einen reinen
UI-Zustand dauerhaft; jede Karte in eine `conditional` zu hüllen erfordert
Konfigurationsarbeit je Karte — also genau das, was diese Karte ersparen soll;
und eine Container-Karte, die ihre Kinder als Konfiguration bekommt, wäre ein
Stack und keine Überschrift und könnte im Sections-Grid nicht zwischen den
Karten stehen.

Der Preis für das Ausblenden der Geschwister ist eine Abhängigkeit vom DOM von
Home Assistant. Deshalb ist jeder Schritt eine Prüfung und keine Annahme, und
ein Layout, das die Karte nicht erkennt, fällt auf `simple` zurück — ein Pfeil,
der sichtbar nichts tut, ist schlimmer als gar keiner. Im Bearbeitungsmodus des
Dashboards wird ebenfalls nicht eingeklappt, dort ließen sich ausgeblendete
Karten sonst nicht mehr bearbeiten.

Der Zustand übersteht einen Reload: im `localStorage` je Browser, oder über
`collapse_state_entity` in einem `input_boolean` — dann gilt er geräteübergreifend
und eine Automatisierung kann einen Abschnitt einklappen.

```yaml
type: custom:m3-heading-card
style: collapsible
title: Medien
icon: mdi:speaker
default_collapsed: true
collapse_state_entity: input_boolean.medien_eingeklappt
```

### Konfigurationsoptionen

| Option | Typ | Standard | Beschreibung |
| --- | --- | --- | --- |
| `style` | string | `simple` | `simple`, `status`, `divider`, `collapsible` |
| `title` | string | – | Pflicht bei allen Varianten außer `divider` |
| `label` | string | – | Nur `divider`: der Text in Versalien zwischen den Strichen. Ohne ihn läuft der Strich durch |
| `icon` / `color` | string | | |
| `show_icon` | boolean | `true` | Ohne Icon rückt der Titel an den linken Rand |
| `title_size` | number | `15` | 12–22 |
| `tap_action` | action | `none` | Auf der ganzen Überschrift. Bei `collapsible` fest auf Einklappen |
| `badge` | string | – | Nur `status`: fester Text oder eine Entitäts-ID |
| `count_entities` | Liste | – | Nur `status`: der Chip zählt, wie viele an sind |
| `action` | Objekt | – | Nur `status`: `{ name, icon, tap_action }` |
| `default_collapsed` | boolean | `false` | Nur `collapsible` |
| `scroll_on_expand` | `false` | Holt die Karte nach dem Aufklappen ins Sichtfeld. Eine eingeklappte Karte am unteren Rand öffnet sich nach unten aus dem Bild heraus — ausgerechnet das, was man sehen wollte, sieht man dann nicht |
| `scroll_duration` | `240` | Wie lange dieses Scrollen dauert, in Millisekunden. `0` springt direkt. Das eingebaute weiche Scrollen des Browsers richtet sich nach der Entfernung und ist langsamer, als ein Tippen es erwarten lässt — deshalb steuert die Karte es selbst |
| `collapse_memory` | `device` | Wo der Zustand gemerkt wird. `device` behält ihn dauerhaft, eine offen gelassene Karte ist beim nächsten Mal wieder offen. `session` behält ihn nur, solange die App läuft: er folgt dir durchs Dashboard und ist beim nächsten Start weg, jeder Start zeigt also wieder die Übersicht. Wird ignoriert, wenn `collapse_state_entity` gesetzt ist — dann entscheidet der Helfer |
| `collapse_state_entity` | string | – | Nur `collapsible`: ein `input_boolean` mit dem Zustand |

</details>
