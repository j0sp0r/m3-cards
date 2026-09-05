---
title: M3 Nav Card
type: m3-nav-card
category: household
display: Nav
summary: Eine Navigationsleiste fürs Dashboard, in fünf Varianten, mit ausziehbarer Schublade
table_order: 8
section_order: 34
---

Eine Navigationsleiste fürs Dashboard: eine Reihe Einträge, von denen der zur
aktuellen Seite gehörende leuchtet. Fünf Varianten derselben Leiste, von einer
schlichten Kopfzeile bis zu einem Sheet, das man über die Ansicht zieht — dazu
Badges, Templates und Untermenüs je Eintrag. Der Funktionsumfang der Navbar
Card aus der Community, gezeichnet in der Formensprache dieser Sammlung statt
in ihrer.

Über die Kartenauswahl hinzugefügt, kommt sie bereits ausgefüllt: die ersten
drei Ansichten des Dashboards werden Einträge, die nächsten fünf wandern hinter
den runden Knopf — die Anordnung, in der eine Leiste mit mehr Seiten als Platz
ohnehin endet. Das ist ein Vorschlag und nicht mehr: Die Einträge sind ab
diesem Moment gewöhnliche Konfiguration zum Bearbeiten, Umsortieren oder
Löschen, und die Leiste liest das Dashboard von sich aus nie wieder.
„Ansichten übernehmen" im Editor wiederholt das Einlesen jederzeit.

<img src="docs/images/nav-card.png" alt="Nav Card — fünf Varianten derselben Leiste" width="440">
<img src="docs/images/nav-card-sheet-list.png" alt="Nav Card — offene Schublade, Kürzel als Zeilen" width="220">
<img src="docs/images/nav-card-sheet-grid.png" alt="Nav Card — offene Schublade, Kürzel als Kacheln" width="220">

<details>
<summary>Konfiguration, Beispiele & Optionen</summary>

```yaml
type: custom:m3-nav-card
style: footer          # header | footer | segmented | floating | sheet
items:
  - name: Home
    icon: mdi:home
    path: /lovelace/0
  - name: Energie
    icon: mdi:flash
    path: /lovelace/energie
  - name: Garten
    icon: mdi:sprout
    path: /lovelace/garten
```

### Die fünf Varianten

| Variante | Was sie ist | Wann sie die richtige ist |
| --- | --- | --- |
| `header` | Oben angedockt, volle Breite | Ein Desktop-Dashboard, wo die Leiste zum Titel gehört und nicht zum Daumen |
| `footer` | Unten angedockt, volle Breite | Die Vorgabe fürs Handy: dort, wo der Daumen ohnehin ist |
| `segmented` | Eine Pille im Kartenfluss | Ein Umschalter für einen Abschnitt, nicht fürs Dashboard — die einzige Variante, die mitscrollt |
| `floating` | Eine abgesetzte runde Leiste über dem Inhalt | Dieselbe Aufgabe wie `footer`, nur mit sichtbarem Inhalt darunter |
| `sheet` | `floating` plus aufziehbare Schublade | Wenn die Leiste auch etwas halten soll: Kurzbefehle, eine Szene, eine Karte |

`header`, `footer`, `floating` und `sheet` positionieren sich gegen den
Bildschirm; ihr Platz im Raster fällt zusammen, sie kosten also keine Zeile der
Ansicht. `segmented` ist eine ganz normale Karte und steht, wo sie steht.

Im Bearbeiten-Modus — und in der Vorschau des Karten-Wählers — wird jede
Variante stattdessen im Kartenfluss gezeichnet. Eine angedockte Leiste hat
keinen anklickbaren Platz mehr; ohne das ließe sich die Karte zwar anlegen,
aber nie wieder öffnen.

Standardmäßig nimmt eine angedockte Leiste die volle Inhaltsbreite ein. Am
Handy ist das richtig, am Desktop meistens deutlich zu viel — die Einträge
stehen dann weit auseinander. `max_width` begrenzt sie und setzt sie mittig:
eine Zahl in px, jede CSS-Länge, oder `fit` für genau so breit wie die Einträge
es brauchen.

```yaml
type: custom:m3-nav-card
style: footer
max_width: fit        # oder 600, oder "40rem"
items: [...]
```

### Die Reiter von Home Assistant

Die Karte fasst sie nicht an und kann es auch nicht: Eine Karte lebt in ihrem
eigenen Kasten, und Home Assistant bietet keinen unterstützten Weg, aus ihm
heraus die Kopfzeile auszublenden. Auf einem Dashboard, das seine Reiterleiste
noch zeigt, hat man also zwei Navigationen gleichzeitig. Zwei Wege heraus, die
sich kombinieren lassen:

**`subview: true` bei den Ansichten, zu denen die Leiste führt.** In Home
Assistant eingebaut, ohne Zusatzsoftware. Eine Unteransicht taucht in der
Reiterleiste gar nicht auf und wird nur über Navigation erreicht — genau das,
was diese Leiste tut. Ansichten, die man nie als Reiter wollte, sind dann keine.

**Die Kopfzeile mit [kiosk-mode](https://github.com/NemesisRE/kiosk-mode)
ausblenden.** Ganz oben in der Rohkonfiguration eines Dashboards, und es lohnt
sich, das auf die Breite zu begrenzen, die es braucht:

```yaml
kiosk_mode:
  mobile_settings:
    hide_header: true
```

Das passt zur Aufteilung Desktop/Handy von oben: Das Handy verliert die
Kopfzeile von Home Assistant und behält nur diese Leiste, der Desktop behält
seine Reiter. Wer die Kopfzeile überall ausblendet, verliert auch den Stift, der
den Editor öffnet — kiosk-mode beschreibt, wie man wieder hineinkommt, und
`?disable_km` an der URL ist die kurze Antwort.

Dass man eine zweite Erweiterung braucht, damit die erste richtig aussieht, ist
keine gute Antwort, und eine spätere Fassung sollte das selbst können: Die Karte
findet die Kopfzeile von ihrem Platz aus, und sie nur auszublenden, solange eine
Leiste auf der Ansicht liegt, träfe es genauer als jede Einstellung pro
Dashboard. In dieser Version steckt es nicht, weil der Zugriff auf HAs eigenes
DOM nicht unterstützt ist und nach dessen Zeitplan bricht — und weil eine
Kopfzeile, die nicht zurückkommt, den Editor mitnimmt. Bis dahin sind die beiden
Wege oben die ehrliche Antwort.

### Desktop und Handy

Die übliche Paarung ist Kopfzeile am großen Bildschirm, Fußzeile oder Sheet am
Handy — zwei Layouts einer Karte, nicht zwei Karten:

```yaml
type: custom:m3-nav-card
desktop:
  style: header
mobile:
  style: sheet
breakpoint: 768
items: [...]
```

Umgeschaltet wird anhand der **eigenen** Breite der Karte, nicht der des
Fensters. Eine Karte in einer schmalen Spalte auf einem breiten Bildschirm ist
schmal — genau das würde eine Media Query falsch beantworten. Beide Blöcke
können die Leiste auf ihrer Breite auch ganz ausblenden (`hidden: true`) und
`show_labels` überschreiben.

### Templates

`name`, `icon`, `color`, `hidden`, `disabled` und der Badge nehmen Jinja2 —
und abonnieren es: Home Assistant schiebt den neuen Wert, sobald sich etwas
ändert, das im Template vorkommt. Kein Pollen, kein Neurendern auf Verdacht:

```yaml
items:
  - name: "{{ states('sensor.gartenmodus') | title }}"
    icon: >-
      {{ 'mdi:water' if is_state('switch.bewaesserung', 'on') else 'mdi:sprout' }}
    path: /lovelace/garten
    hidden: "{{ not is_state('person.ich', 'home') }}"
```

Nur Felder, in denen wirklich `{{` oder `{%` steht, öffnen ein Abo, und zwei
Einträge mit identischem Template teilen sich eines. Alle werden geschlossen,
sobald die Karte die Seite verlässt.

### Badges

```yaml
items:
  - name: Meldungen
    icon: mdi:bell
    path: /lovelace/meldungen
    badge:
      count_entities: [binary_sensor.leck_kueche, binary_sensor.leck_bad]
    badge_style: count       # dot | count | text
```

Ein Badge nimmt ein `template`, eine `entity`, deren Zustand er zeigt, oder
`count_entities` — dann zählt er, wie viele davon an sind. In jedem Fall
blenden `0`, `off`, `unavailable`, `unknown` und ein leerer Wert ihn aus: eine
Leiste voller grauer Nullen wirkt kaputt, nicht ruhig. `show_if` hängt ihn an
ein zweites Template.

### Untermenüs

Ein Eintrag mit `submenu` öffnet ein schwebendes Menü, statt zu navigieren. Es
wächst aus dem Knopf heraus, der es geöffnet hat, und schließt bei Auswahl,
Klick daneben oder Escape.

```yaml
submenu_trigger: tap     # tap | hold
items:
  - name: Mehr
    icon: mdi:dots-horizontal
    submenu:
      - name: Drucker
        icon: mdi:printer-3d
        path: /lovelace/drucker
      - name: Netzwerk
        icon: mdi:lan
        path: /lovelace/netzwerk
```

Mit `submenu_trigger: hold` navigiert ein Tipp wie gewohnt und das Menü kommt
beim langen Drücken — herum, wie es sein sollte, wenn der Eintrag selbst ein
echtes Ziel ist und das Menü nur die Abkürzung zu seinen Nachbarn.

### Das Sheet

```yaml
type: custom:m3-nav-card
style: sheet
sheet_title: Schnellzugriff
sheet_action:
  icon: mdi:plus
  tap_action:
    action: navigate
    navigation_path: /lovelace/edit
sheet_default: collapsed   # collapsed | expanded | remember
sheet_max_height: 60       # vh, oder jede CSS-Länge als Text
snap_points: [0, 0.5, 1]   # optionale Zwischenstufe
sheet_cards:
  - type: custom:m3-button-card
    entity: light.wohnzimmer
items: [...]
```

Die Schublade nimmt zweierlei auf. `sheet_items` sind Kurzbefehl-Kacheln — genau
die Einträge, die sonst hinter einem „Mehr"-Untermenü verschwinden, hier aber
auf einen Blick sichtbar statt erst nach dem Öffnen eines Menüs. Sie lassen
sich auf zwei Arten zeichnen: `grid` bringt die meisten Ziele auf den
wenigsten Platz, Symbol mit Beschriftung darunter; `list` gibt jedem eine volle
Zeile mit Symbol, Namen, zweiter Zeile und Pfeil. Die zweite Zeile
(`secondary`) nimmt freien Text, ein Template oder eine Entity-ID, deren
Zustand sie zeigt — und genau das macht eine Zeile ihren Mehrplatz wert. Der Editor hat
einen Knopf, der ein bestehendes Untermenü direkt übernimmt. Darunter nimmt
`sheet_cards` beliebige Lovelace-Karten auf, jede M3-Karte eingeschlossen:

```yaml
sheet_title: Mehr
sheet_items:
  - name: Kameras
    icon: mdi:cctv
    path: /lovelace/kamera
  - name: Neustart
    icon: mdi:power
    tap_action:
      action: call-service
      service: homeassistant.restart
      confirmation:
        text: Home Assistant wirklich neu starten?
sheet_cards:
  - type: custom:m3-button-card
    entity: light.wohnzimmer
```

Vorsicht bei den Blöcken je Breite: der Wurzel-`style` gilt nur dort, wo kein
Block ihn überschreibt. Eine Karte auf `sheet` mit `mobile: { style: floating }`
hat eine volle Schublade und am Handy — dem Gerät, für das sie gedacht war —
keinen Griff. Es bricht nichts, die Schublade ist dort schlicht nicht
erreichbar. Der Editor weist jetzt darauf hin.

Eine Schublade ohne Inhalt — keine Kacheln, keine Karten, kein Titel — hat
nichts aufzuziehen. Die Karte zeichnet dann eine schlichte schwebende Leiste
statt eines Griffs, der ein leeres Fach öffnet, und der Editor sagt es, statt
es einen beim Ziehen herausfinden zu lassen.

Eine Aktion mit `confirmation` fragt vorher nach — gut zu wissen, bevor man
„Home Assistant neu starten" einen Tipp weit weg legt. Gezogen wird am Griff oder
mit einem Wisch von der Leiste nach oben; ein Tipp auf den Griff öffnet sie
ebenfalls. Beim Loslassen geht sie zum nächstgelegenen Rastpunkt — außer es
war ein Schwung, dann geht sie in die geworfene Richtung, egal wo sie gerade
stand.

Der interessante Fall ist das Ziehen **im** Inhalt: der scrollt ganz normal,
und das Sheet übernimmt die Geste nur dann, wenn der Inhalt schon ganz oben
steht und der Finger nach unten geht. Genau so verhält sich jedes native
Bottom Sheet — und deshalb bleibt das Scrollen des Browsers samt seiner
Trägheit, die keine JavaScript-Nachbildung trifft, überall sonst unangetastet.

`sheet_default: remember` merkt sich den Zustand je Browser, oder in einem
`input_boolean` über `sheet_state_entity` — dann synchron über Geräte hinweg,
und eine Automatisierung kann die Schublade öffnen. Unter 600px Fensterhöhe
(Handy im Querformat) sinkt die Höhenbegrenzung auf 50vh, sonst bliebe von der
Seite, für die die Schublade da ist, nichts übrig.

Zwei Grenzen sind wichtig. Im Bearbeiten-Modus wird das Sheet im Kartenfluss
und aufgeklappt gezeichnet, weil eine am Bildschirm angedockte Schublade genau
die Karte verdeckt, die der Editor gerade zeigen will. Und nur das erste Sheet
einer Ansicht dockt an: ein zweites läge über dem ersten, ohne dass man sähe,
welcher Griff zu welchem gehört — es wird deshalb inline gezeichnet.

### Sichtbarkeit

`hidden` nimmt ein Jinja2-Template und lässt die ganze Leiste weg, solange es
wahr ist. Für Sichtbarkeit nach Nutzer, Gerät oder Bildschirmgröße gibt es die
eingebaute Sichtbarkeits-Funktion von Home Assistant im Karten-Editor — die
kann das längst für jede Karte, und eine zweite Umsetzung in dieser hier würde
ihr nur in die Quere kommen.

### Umstieg von der Navbar Card

| Navbar Card | Hier |
| --- | --- |
| `routes` | `items` |
| `routes[].url` | `items[].path` |
| `routes[].label` | `items[].name` |
| `routes[].icon` / `icon_selected` | `items[].icon` (ein Template kann umschalten) |
| `routes[].badge.template` | `items[].badge.template` |
| `routes[].badge.color` | `items[].badge.color` |
| `routes[].submenu` | `items[].submenu` |
| `routes[].hidden` | `items[].hidden` |
| `routes[].tap_action` / `hold_action` | gleiche Namen |
| `desktop.position: top/bottom` | `desktop.style: header/footer` |
| `desktop.show_labels` | `desktop.show_labels`, oder `label_visibility` |
| `desktop.min_width` | `breakpoint` (Breite der Karte, nicht des Fensters) |
| `mobile.show_labels` | `mobile.show_labels` |
| `styles` (freies CSS) | `styles` (eine Eigenschaft/Wert-Zuordnung) |
| `template` für eine ganze Routenliste | — kein Gegenstück; Einträge werden konfiguriert und einzeln getemplatet |
| `haptic` | `haptics` |

`preload_views` wird angenommen und gespeichert, tut aber derzeit nichts: Home
Assistant bietet einer Karte keinen Weg, eine andere Ansicht vorzuwärmen, und
der einzige Behelf — unsichtbar hin- und zurücknavigieren — würde flackern und
einen falschen Verlaufseintrag hinterlassen. Die Option bleibt, damit eine
spätere Version sie ohne Konfigurationsbruch umsetzen kann.

### Optionen

| Option | Vorgabe | Wirkung |
| --- | --- | --- |
| `items` | — | Die Einträge. Je: `name`, `icon`, `path`, `match`, `color`, `badge`, `badge_style`, `hidden`, `disabled`, `submenu`, `tap_action`, `hold_action`, `double_tap_action` |
| `style` | `footer` | `header`, `footer`, `segmented`, `floating`, `sheet` |
| `position` | je Variante | `top` oder `bottom`, für die abgesetzten Varianten |
| `desktop` / `mobile` | — | Überschreibungen je Breite: `style`, `position`, `show_labels`, `hidden` |
| `breakpoint` | `768` | Kartenbreite, unter der `mobile` gilt |
| `label_visibility` | `always` | `always`, `active_only`, `never` |
| `icon_visibility` | `always` | `always`, `active_only`, `never` — dieselben drei Möglichkeiten wie bei den Beschriftungen, unabhängig davon |
| `item_background` | `false` | Eine zarte Fläche unter jedem Eintrag, nicht nur unter dem aktuellen |
| `active_style` | `tint` | `tint` (zarte Tönung in der Farbe des Eintrags) oder `solid` (voll gefüllt, dunkle Schrift darauf) |
| `action_button` | — | `{icon, tap_action, color}` — ein runder Knopf neben der Leiste, außerhalb ihrer Fläche |
| `max_width` | — | Breitenbegrenzung, mittig. Zahl = px, Text = CSS-Länge, `fit` = so breit wie die Einträge |
| `size` | `1` | Skaliert jedes Maß, 0,7–1,5 |
| `page_transition_ms` | `180` | Dauer dieser Überblendung. Die Browser-Voreinstellung von 250 ms wirkt träge für einen Wechsel, den man selbst ausgelöst hat |
| `marker_motion` | `none` | `none` oder `slide` — ob eine einzelne Fläche zwischen den Einträgen wandert statt zweier, die ein- und ausblenden |
| `page_transition` | `none` | `none`, `fade` oder `up` — `up` ist Materials Fade-Through: erst geht die alte Seite, dann steigt die neue leicht herein |
| `pill_size` | `1` | Skaliert allein die Markierung um den aktiven Eintrag, ohne Icon oder Text anzufassen |
| `label_size` | `11`, neben dem Icon `14` | Textgröße in px. Der Standard hängt an `label_position`: unter dem Icon ist der Text eine Bildunterschrift, daneben der Name des Eintrags |
| `label_position` | `below` | Wo der Text eines Eintrags relativ zum Icon sitzt: `below`, `above`, `right`, `left`. Bei den waagerechten umschließt die aktive Pille Icon und Text gemeinsam |
| `edge_distance` | `8` (angedockt `6`) | Abstand in px zwischen Leiste und dem Bildschirmrand, an dem sie klebt. Kommt **zusätzlich** zur Safe Area des Geräts, nicht statt ihr — die Leiste kann also nicht auf der Gestenleiste landen |
| `container_style` | `glass` | `glass`, `solid`, `transparent` |
| `container_opacity` | `100` | Deckkraft der Leiste in Prozent |
| `blur` | `20` | Weichzeichnen des Hintergrunds in px |
| `radius` | Kapsel | Eckenradius der Leiste. Ohne Angabe sind die Enden vollrund, egal wie hoch die Leiste ist — so machen es die Vorbilder; eine Zahl legt ihn stattdessen fest. Vorsicht bei Werten knapp unter der halben Leistenhöhe (unskaliert 31 px): das wirkt wie eine gestauchte Kapsel, nicht wie ein abgerundetes Rechteck |
| `submenu_trigger` | `tap` | `tap` oder `hold` |
| `haptics` | `true` | Haptik-Event von Home Assistant beim Tippen auslösen |
| `auto_hide_on_scroll` | `false` | Beim Runterscrollen ausblenden, beim Hochscrollen zurück |
| `hidden` | — | Jinja2-Boolean; blendet die ganze Karte aus |
| `styles` | — | Freies CSS für die Leiste. Für Fortgeschrittene |
| `sheet_items` | — | Kacheln in der Schublade: `name`, `icon`, `path`, `color`, `tap_action` |
| `sheet_item_style` | `grid` | `grid` (Symbole mit Beschriftung darunter) oder `list` (volle Zeilen) |
| `sheet_columns` | automatisch | Nur im Raster: Kacheln pro Zeile; leer füllt so viele, wie die Breite hergibt |
| `sheet_cards` | — | Karten in der Schublade, unter den Kacheln |
| `sheet_title` | — | Titelzeile über dem Inhalt der Schublade |
| `sheet_action` | — | `{icon, tap_action}`-Knopf rechts in dieser Zeile |
| `sheet_max_height` | `60` | vh als Zahl, oder jede CSS-Länge als Text |
| `sheet_default` | `collapsed` | `collapsed`, `expanded`, `remember` |
| `sheet_state_entity` | — | Ein `input_boolean` mit dem Offen-Zustand |
| `snap_points` | `[0, 1]` | Anteile, bei denen die Schublade einrastet |
| `collapse_on_navigate` | `true` | Schublade beim Seitenwechsel schließen |

Eine offene Schublade schließt außerdem bei einem Tipp irgendwo außerhalb. Die
Fläche, die diesen Tipp fängt, ist unsichtbar und verbraucht ihn — hinter der
Schublade reagiert also nichts darauf, dass sie weggetippt wurde.
| `preload_views` | `false` | Reserviert; tut derzeit nichts |

</details>
