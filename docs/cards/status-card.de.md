---
title: M3 Status Card
type: m3-status-card
category: household
display: Status
summary: Große Zahlen, Texte und Ja/Nein-Zustände, mit einer Regelliste dahinter
table_order: 6
section_order: 29
---

Zeigt einen Wert groß und mit Bedeutung: eine Zahl, einen Text oder einen
Ja/Nein-Zustand. Sie liest jede Entität — einen Template-Sensor, ein
`input_boolean`, ein Attribut von etwas anderem — und der eigentliche Punkt der
Karte ist die Zuordnung dazwischen: eine Regelliste macht aus `off` ein rotes
„Nein“ mit Kreuz oder aus einer Zahl unter 20 eine Warnfarbe, ganz ohne
Template-Sensor.

<img src="docs/images/status-card.png" alt="Status Card" width="440">

<details>
<summary>Konfiguration, Beispiele & Optionen</summary>

```yaml
type: custom:m3-status-card
items:
  - entity: input_boolean.medikament_gegeben
    name: Medikament
    preset: yes_no
    tap_action:
      action: toggle
hero_style: badge
```

### Layouts

Ein Wert bekommt die große „Hero“-Darstellung, mehrere ein Raster. `layout`
erzwingt eines von beiden, dazu kommt eine kompakte Zeilenliste.

| Layout | Was es ist |
| --- | --- |
| `auto` | Hero bei einem Wert, Raster ab zwei. Der Standard. |
| `hero` | Ein Wert in 26–40px, die Farbe des Werts färbt die ganze Karte |
| `grid` | Kacheln, `repeat(auto-fit, minmax(96px, 1fr))` oder feste `columns` |
| `row` | 48px-Zeilen: Icon, Name, Wert — für kompakte Aufzählungen |

`hero_style: badge` ersetzt das kleine Kopfzeilen-Icon durch ein 52px großes
Statussymbol in voller Farbe, das bei jedem Zustandswechsel kurz morpht.

### Zustands-Mapping

Jeder Wert kann eine `states`-Liste tragen. Die erste passende Regel gewinnt;
was sie nicht setzt, kommt weiterhin vom Wert selbst. Eine Regel prüft genau
eine Bedingung — `value`, `regex`, `above` oder `below`. Eine Regel ganz ohne
Bedingung ist bewusst ein Auffangfall, so endet eine Liste mit „und sonst“.

```yaml
items:
  - entity: sensor.batterie
    states:
      - below: 20
        icon: mdi:battery-alert
        color: "#e57368"
      - below: 50
        color: "#f0c46e"
      - color: "#81c784"     # Auffangfall
```

`preset` liefert eine fertige Regelliste in der Sprache des Dashboards. Die
eigenen `states` werden zuerst geprüft, eine Vorlage lässt sich also anpassen,
ohne sie zu ersetzen.

| Vorlage | Bildet ab |
| --- | --- |
| `yes_no` | `on`/`true` → Ja (grün, Haken), `off`/`false` → Nein (rot, Kreuz) |
| `on_off` | An / Aus, der Aus-Zustand in Grau |
| `ok_problem` | `off`/`ok` → OK, `on`/`problem` → Problem |
| `open_closed` | Offen (Bernstein) / Geschlossen (grün) |
| `traffic` | Unter 33 rot, unter 66 gelb, darüber grün — mehr ist besser |

### Trend

`trend: true` vergleicht den Wert mit derselben Entität vor 24 Stunden (über die
History-API, Langzeitstatistiken sind nicht nötig) und zeigt einen Chip mit der
Veränderung. `trend_inverted` gehört überall dorthin, wo Fallen die gute
Richtung ist — Verbrauch, Kosten —, sonst bekäme der bestmögliche Wert die
Alarmfarbe. Unter 1% Veränderung gilt als unverändert.

### Konfigurationsoptionen

| Option | Typ | Standard | Beschreibung |
| --- | --- | --- | --- |
| `items` | Liste | – | Ein Eintrag je Wert, siehe unten |
| `title` | string | – | Überschrift über Raster oder Zeilen |
| `layout` | `auto` \| `hero` \| `grid` \| `row` | `auto` | |
| `columns` | number | automatisch | Feste Spaltenzahl im Raster |
| `hero_style` | `inline` \| `badge` | `inline` | |
| `value_size` | number \| `auto` | `auto` | 40px bei Zahlen, 34px bei kurzem Text, 26px ab 12 Zeichen |
| `tap_action` | action | `more-info` | Vorgabe für alle Werte |
| `accent_color` / `accent_opacity` | | | Ersatzfarbe und Farbstärke |

Je Wert:

| Option | Typ | Beschreibung |
| --- | --- | --- |
| `entity` | string | |
| `name` / `icon` / `color` | string | |
| `attribute` | string | Zeigt dieses Attribut statt des Zustands |
| `unit` | string | Überschreibt die Einheit der Entität |
| `prefix` / `suffix` | string | |
| `decimals` | number | Standard ist die Genauigkeit, die der Zustand selbst mitbringt |
| `secondary` | string | Zeile unter dem Wert — Text oder eine Entität, deren Zustand angezeigt wird |
| `preset` | string | Siehe Vorlagen-Tabelle |
| `states` | Liste | Die Regelliste |
| `tap_action` | action | `toggle` schaltet die Anzeige sofort um, bevor HA bestätigt |
| `trend` / `trend_hours` / `trend_inverted` | | |

Eine nicht verfügbare Entität zeigt „—“ in neutralem Grau statt ihre Farbe zu
behalten: ein toter Sensor, der weiter grün leuchtet, liest sich als „alles in
Ordnung“ — also genau falsch herum.

</details>
