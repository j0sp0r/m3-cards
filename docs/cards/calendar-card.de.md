---
title: M3 Calendar Card
type: m3-calendar-card
category: household
display: Calendar
summary: Agenda und Monatsraster für beliebig viele Kalender
table_order: 12
section_order: 33
---

Agenda und Monatsraster für beliebig viele Kalender, in der Designsprache dieser
Suite.

<img src="docs/images/calendar-card.png" alt="Calendar Card" width="440">

<details>
<summary>Konfiguration, Beispiele & Optionen</summary>

```yaml
type: custom:m3-calendar-card
entities:
  - calendar.familie
  - calendar.arbeit
```

Eine bloße Entity-ID wird neben der ausführlichen Form akzeptiert, weil man das
zuerst schreibt:

```yaml
entities:
  - entity: calendar.familie
    name: Familie
    color: "#85b7eb"
  - calendar.arbeit
```

Ohne Farbe bekommt jeder Kalender eine aus der Palette, der Reihe nach.

### Die zwei Ansichten

`view` ist `agenda` oder `month`; der Umschalter in der Kopfzeile wechselt,
`show_view_switch: false` legt die Ansicht fest.

Die **Agenda** gruppiert nach Tagen, mit „Heute" in der Akzentfarbe, dann
„Morgen", dann Wochentagsnamen. Jede Zeile trägt die Startzeit über der Endzeit,
einen Balken in der Farbe ihres Kalenders, den Titel und den Ort. Ein laufender
Termin ist getönt und trägt ein **Jetzt**-Abzeichen, ein beendeter verblasst.
`max_events` begrenzt die Liste und ergänzt eine Zeile „+n weitere".

<img src="docs/images/calendar-card-month.png" alt="Calendar Card, Monatsansicht" width="440">

Das **Monatsraster** zeichnet bis zu drei Punkte je Tag in den Kalenderfarben,
wobei der dritte zum „+" wird, wenn es mehr sind. Heute ist getönt, ein
angetippter Tag füllt sich mit der Akzentfarbe und listet seine Termine unter
dem Raster. Die Woche beginnt, wo `hass.locale.first_weekday` es sagt.

### Woher die Termine kommen

Aus `calendar.get_events`, nicht aus den Attributen der Entität — die tragen nur
den nächsten Termin und taugen für eine Liste nicht. Ergebnisse werden fünf
Minuten zwischengespeichert, von allen Karten gemeinsam genutzt und neu gelesen,
sobald eine Kalender-Entität ihren Zustand ändert.

Ein Kalender, der nicht erreichbar ist, wird in einer Zeile unter der Kopfzeile
benannt statt stillschweigend weggelassen: vier von fünf Kalendern zu zeigen,
ohne es zu sagen, wäre schlimmer.

### Mehrtägige und ganztägige Termine

Ein mehrtägiger Termin erscheint an **jedem** Tag, den er berührt, mit „Tag 2
von 3" dort, wo sonst der Ort steht — ein Dienstag, der nichts zeigt, während
eine dreitägige Reise läuft, wäre falsch. Im Monatsraster setzt er an jedem
seiner Tage einen Punkt.

Ein ganztägiger Termin zeigt **GANZTÄGIG** in der Farbe seines Kalenders statt
einer Uhrzeit. Er trägt nie das *Jetzt*-Abzeichen: „läuft gerade" braucht eine
Uhrzeit, und unter einer Überschrift, die schon „Heute" sagt, wäre das Abzeichen
ohne Aussage.

### Optionen

| Option | Vorgabe | Wirkung |
| --- | --- | --- |
| `entities` | — | Pflicht. Entity-IDs oder `{entity, name, color}` |
| `view` | `agenda` | `agenda` oder `month` |
| `show_view_switch` | `true` | Der Agenda/Monat-Umschalter in der Kopfzeile |
| `days_ahead` | `7` | Zeitraum der Agenda, 1–30 |
| `max_events` | `0` | 0 zeigt alles im Zeitraum |
| `hide_past_today` | `false` | Vergangene Termine von heute ausblenden statt blass |
| `show_adjacent_days` | `true` | Tage der Nachbarmonate im Raster zeichnen |
| `show_next_chip` | `false` | Chip in der Kopfzeile mit dem nächsten Termin |
| `tap_action` | `detail` | `detail`, `more-info`, `navigate`, `none` |
| `navigation_path` | `/calendar` | Ziel von `navigate` und des Knopfs im Detailfenster |

</details>
