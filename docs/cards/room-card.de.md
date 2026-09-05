---
title: M3 Room Card
type: m3-room-card
category: household
display: Room
summary: Eine Karte je Bereich: alle gefundenen Gerätetypen, Klimawerte und Präsenz
table_order: 10
section_order: 31
---

Eine Karte pro Raum. Man gibt ihr einen Bereich aus Home Assistant, den Rest
findet sie selbst: welche Gerätearten dort hängen, was jede davon gerade tut,
die Klimawerte und ob jemand im Raum ist.

<img src="docs/images/room-card.png" alt="Raumkarte, die einen Bereich selbst auswertet" width="440">
<img src="docs/images/room-card-manual.png" alt="Raumkarte mit eigenen Karten" width="440">

<details>
<summary>Konfiguration, Beispiele & Optionen</summary>

```yaml
type: custom:m3-room-card
area: wohnzimmer
```

Das ist die vollständige Minimalkonfiguration. Alles Weitere überschreibt nur,
was die Karte ohnehin schon gefunden hat.

### Was erkannt wird

Jede Entität, die dem Bereich zugeordnet ist — direkt oder über ihr Gerät —,
nach Domain gruppiert in neun eingebaute Kategorien: Licht, Ventilator,
Befeuchter, Klima, Medien, Rollo, Schalter, Sauger, Schloss. Dazu alles, was
unter `extra_domains` steht. Eine Kachel erscheint nur für eine Kategorie, die
im Raum tatsächlich eine Entität hat; das Raster wächst also mit dem Haus,
statt leere Platzhalter zu zeigen.

Drei Arten von Entitäten bleiben draußen, und die erste zählt mehr, als es
klingt: alles, was Home Assistant als Konfiguration oder Diagnose markiert.
Eine einzelne smarte Steckdose steuert eine Kindersicherung, eine
Status-LED und ein Einschaltverhalten bei — alle in der Domain `switch`. Auf
einer echten Installation gemessen: Im Wohnzimmer liegen 32 Schalter, von denen
2 das sind, was ein Mensch einen Schalter nennt. Ausgeblendete und deaktivierte
Entitäten bleiben ebenfalls draußen, denn da hat der Nutzer bereits gesagt,
dass er sie nicht sehen will.

### Die Badges

Der Text unter jeder Kachel ist der eigentliche Punkt der Karte. Bei mehreren
Geräten zählt er — `2/4`. Bei genau einem sagt er, was dieses Gerät tut:

| Kategorie | Badge |
| --- | --- |
| `fan` | Preset oder die Stufe, abgeleitet aus dem `percentage_step` des Lüfters |
| `humidifier` | Die Zielfeuchte |
| `climate` | Die Zieltemperatur, sonst der HVAC-Modus |
| `media_player` | Titel oder Quelle, auf 16 Zeichen gekürzt |
| `cover` | Offen, Geschlossen oder die Position in Prozent |
| `lock` | Verriegelt / Entriegelt |
| alles andere | An / Aus |

Eine nicht verfügbare Entität zählt als nicht an; eine Kategorie, in der
*jede* Entität nicht verfügbar ist, zeigt `—`, wird auf 40% gedimmt und lässt
sich nicht antippen.

### Präsenz

Ein `binary_sensor` im Bereich mit device_class `occupancy`, `motion` oder
`presence` wird von allein gefunden. Solange der Raum belegt ist, pulsiert ein
Punkt am Raum-Icon, die Karte bekommt 7% Präsenzfarbe, und der Untertitel
lautet „belegt · 3 Geräte aktiv“ statt nur der Zahl.

`presence_style: dot_only` behält den Punkt und lässt die Färbung weg, `none`
schaltet beides ab. Der Puls respektiert `animation: off` und die
Systemeinstellung für reduzierte Bewegung.

### Sensor-Chips

Temperatur, Luftfeuchte und Verbrauch, aus dem Bereich erkannt. Temperatur und
Feuchte kommen zuerst aus den Bereichseinstellungen von Home Assistant, wenn
sie dort gesetzt sind — eine bewusste Zuordnung schlägt jede Vermutung der
Karte —, sonst aus der passenden `device_class`. Der Verbrauchs-Chip erscheint
erst ab `power_threshold` (Standard 5 W): Ein Raum mit 0,4 W ist ein Raum ohne
Verbrauch, und ein Chip, der das sagt, kostet eine Zeile auf jeder Karte, in
der eine Steckdose hängt.

### Auswählen, was erscheint

Jede Kategorie hat außerdem ihren eigenen `badge`-Modus: `auto` zählt bei
mehreren Geräten und zeigt bei einem dessen Zustand, `count` und `state`
erzwingen jeweils eines davon, `none` lässt die Zeile ganz weg.

Ganze Kategorien lassen sich ausblenden oder umsortieren, und einzelne Geräte
lassen sich im Editor abwählen — jede Kategorie listet dort alle gefundenen
Geräte mit einem Schalter. Ein abgewähltes Gerät verschwindet aus der Kachel,
aus ihrer Zählung und aus allem, was die Kachel schaltet. Dorthin gehört zum
Beispiel die Status-LED einer Steckdose, wenn ihre Integration sie nicht als
Diagnose-Entität markiert.

Für die Sensor-Chips gilt dasselbe: `temperature_entity`, `humidity_entity` und
`power_entity` überschreiben das Erkannte, `extra_sensors` ergänzt Chips in der
angegebenen Reihenfolge.

### Interaktion

Steht ein einzelnes Gerät hinter einer Kachel, schaltet ein Tap es um. Bei
mehreren öffnet ein Tap eine Auswahl, die jedes Gerät mit seinem Zustand
auflistet — die vier Lampen eines Raums sind vier Entscheidungen, nicht eine —
dazu „Alles aus“ und „Alle an“ für die Fälle, in denen es doch nur eine ist.
Mit `category_tap: toggle` entfällt die Auswahl und alles schaltet sofort.

In jedem Fall werden nur Geräte geschaltet, die auch antworten, damit das
Ergebnis zu dem passt, was die Kachel angezeigt hat. Ein langer Druck öffnet
`detail_path`, sonst die Detailansicht der ersten Entität. Sauger und Schlösser
haben kein sinnvolles Umschalten, dort öffnet ein Tap die Detailansicht, statt
dass die Karte etwas rät, das man lieber selbst entscheidet.

### Die Kopfzeile antippen

Die Kopfzeile ist die Titelleiste der Karte und klappt sie standardmäßig
entweder ein (mit `collapsible: true`) oder tut gar nichts. `tap_action` legt
stattdessen eine gewöhnliche Home-Assistant-Aktion darauf — am nützlichsten
`navigate`, womit die Raumkarte auf einer Übersicht zum Weg in die eigene
Ansicht dieses Raums wird.

```yaml
type: custom:m3-room-card
area: wohnzimmer
tap_action:
  action: navigate
  navigation_path: /lovelace/wohnzimmer
```

`navigate` und `url` verhalten sich wie überall, und `none` lässt die
Kopfzeile bewusst untätig. `perform-action` funktioniert, sofern die Aktion ihr
`target` selbst benennt.

`more-info` und `toggle` funktionieren hier **nicht**, und das gehört deutlich
gesagt: Eine Raumkarte ist ein Bereich, keine Entität, hat also kein
mitzugebendes Ziel — und beide tun ohne eines wortlos nichts. Dafür ist
`categories[].tap_action` einer Kachel da, hinter der eine Entität steht.

Ein Tap kann nicht zugleich einklappen und eine Ansicht öffnen, deshalb
übernimmt `tap_action` die Kopfzeile vom Einklappen — und der Pfeil geht mit,
denn er verspricht ein Einklappen, das die Kopfzeile nicht mehr ausführt. Der
Rest von `collapsible` bleibt unberührt: der gespeicherte Zustand wird weiter
gelesen und angewendet, `collapse_state_entity` und eine Automatisierung können
die Karte also weiterhin einklappen, während ihre Kopfzeile navigiert.

Das gilt für die ganze Karte und ist etwas anderes als `categories[].tap_action`
für einen Tap auf eine einzelne Kategorie-Kachel im Inhalt, und als
`detail_path`, das bei langem Druck auf eine Kachel öffnet.

### Konfigurationsoptionen

| Option | Typ | Standard | Beschreibung |
| --- | --- | --- | --- |
| `area` | string | – | Die Bereichs-ID aus HA. Pflicht |
| `mode` | `auto` \| `manual` | `auto` | `auto` erkennt die Geräte des Bereichs und zeigt je Gerätetyp eine Kachel; `manual` zeichnet davon nichts und zeigt nur `cards` |
| `cards` | Liste | – | Lovelace-Karten im aufklappbaren Bereich — unter den Kacheln bei `auto`, allein bei `manual`. Schreibweise wie in einer Ansicht |
| `cards_columns` | number | `2` | Wie viele dieser Karten nebeneinander stehen |
| `name` / `icon` | string | aus dem Bereich | Das Icon wird sonst aus dem Raumnamen geraten |
| `tap_action` | Aktion | – | Was ein Tap auf die Kopfzeile tut. Ohne Eintrag klappt sie die Karte ein, sofern `collapsible` aktiv ist. Mit Eintrag übernimmt die Aktion die Kopfzeile und der Pfeil entfällt |
| `detail_path` | string | – | Öffnet sich bei langem Druck |
| `extra_domains` | Liste | – | Domains über die neun eingebauten hinaus |
| `category_order` | Liste | – | Domains in gewünschter Reihenfolge, der Rest folgt dahinter |
| `hidden_categories` | Liste | – | |
| `excluded_entities` | Liste | – | Einzelne Geräte, die draußen bleiben, egal in welcher Kategorie |
| `category_tap` | `list` \| `toggle` | `list` | Was ein Tap tut, wenn hinter der Kachel mehrere Geräte stehen |
| `categories` | Liste | – | Je Kategorie: `{ domain, name, icon, color, hidden, badge, tap_action }` |
| `show_sensors` | boolean | `true` | |
| `temperature_entity` / `humidity_entity` / `power_entity` | string | erkannt | |
| `power_threshold` | number | `5` | Watt |
| `extra_sensors` | Liste | – | Weitere Chips, in dieser Reihenfolge |
| `show_windows` | boolean | `true` | Chip für Fenster und Türen |
| `window_entities` | Liste | – | Überschreibt die Erkennung |
| `door_entities` | Liste | – | Kontakte, die getrennt von den Fenstern zählen — eine Tür, oder etwas, das gar kein Weg hinein ist, etwa der Positionskontakt einer Jalousie. Home Assistant nennt fast jeden Kontaktsensor `door`, was welcher ist, lässt sich also nicht erkennen |
| `presence_entity` | string | erkannt | |
| `presence_style` | `tint` \| `dot_only` \| `none` | `tint` | |
| `collapsible` | boolean | `false` | Klappt die Karte auf ihre Kopfzeile zusammen |
| `default_collapsed` | boolean | `false` | |
| `collapse_state_entity` | string | – | `input_boolean` mit dem eingeklappten Zustand |
| `strip_area_name` | boolean | `false` | Entfernt den Raumnamen aus dem Namen eines einzelnen Geräts. Aus, weil es eine Konvention voraussetzt |

Der Editor legt Kacheln über einen Entitätswähler an — als Button-, Licht-, Rollladen-, Medien- oder kompakte Klima-Karte — und jeder Eintrag klappt zum Editor genau dieser Karte auf, eine eingebettete Karte ist also so einstellbar wie überall sonst. Jede andere Lovelace-Karte lässt sich von Hand eintragen und bekommt ebenfalls ihren Editor.

</details>
