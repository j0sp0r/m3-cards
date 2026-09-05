---
title: M3 Updates Card
type: m3-updates-card
category: system
display: Updates
summary: Alle verfügbaren Updates (Core, OS, Add-ons, HACS, Firmware)
table_order: 1
section_order: 19
---

Übersicht aller verfügbaren Updates in einer Kachel: Status im Header, eigene
Boxen für Core/Betriebssystem/Supervisor mit Versionssprung und
Install-Button, Zeilen für Add-ons, HACS und Firmware, dazu ein
Aufklappbereich für alles, was bereits aktuell ist.

<img src="docs/images/updates-card.png" alt="M3 Updates Card" width="440">

<sub>Screenshot mit simulierten Update-Daten, damit Kern-Boxen, MAJOR-Badge
und laufende Installation gleichzeitig sichtbar sind.</sub>

<details>
<summary>Konfiguration, Beispiele & Optionen</summary>

```yaml
type: custom:m3-updates-card
auto_discover: true
max_visible: 5
```

### Entitätsquelle und Gruppierung

- **`auto_discover: true`** (Standard): nimmt alle Entities der Domain
  `update` auf, `exclude_entities` blendet einzelne aus.
- **`auto_discover: false`**: nur die explizit in `entities` gelistete
  Auswahl.

Die Gruppierung läuft primär über die **Integration** aus der
Entity-Registry, nicht über den `entity_id`-Namen. Das ist wichtig, sobald
eine zweite HA-Instanz eingebunden ist: die spiegelt Entities mit fast
identischen Namen (`home_assistant_core_update_2`), und eine Namensregel
würde daraus zwei ununterscheidbare Core-Boxen machen. Die zweite Instanz
bekommt deshalb eine eigene Gruppe („Zweite Instanz"). `type_patterns`
überschreibt die Zuordnung pro `entity_id`-Fragment, falls die Automatik
etwas falsch einsortiert.

Entities, die Home Assistant beim Start nicht erreichen konnte
(`restored`/`unavailable`), zählen nicht als „aktuell" — sonst würde die
Kachel eine Abdeckung behaupten, die sie nicht hat. Sie stehen stattdessen
hinter einem eigenen Aufklapper unter den erreichbaren Komponenten, mit
Gruppe statt Version, damit auf einen Blick erkennbar ist, *warum* etwas
fehlt (z.B. „52 × Zweite Instanz" = die Verbindung dorthin liefert gerade
nichts).

`include_types` beschränkt die Anzeige auf bestimmte Gruppen (leer = alle),
`group_order` bestimmt die Reihenfolge und damit auch, welche Updates bei
gesetztem `max_visible` zuerst sichtbar bleiben. Im Editor lässt sich die
Reihenfolge mit Pfeiltasten je Gruppe umsortieren.

### Kern-Updates und Installation

Core, Betriebssystem und Supervisor bekommen eigene Boxen mit
`{installed} → {latest}` und einem **MAJOR**-Badge bei einem großen Sprung.
Die Erkennung behandelt beide Versionsschemata: bei
Home-Assistant-Kalenderversionen (`2026.8.1`) zählt ein Wechsel von Jahr oder
Monat, bei SemVer (`5.8.0`) die erste Zahl.

Der Install-Button ruft `update.install`. Mit `require_confirm: true`
(Standard) fragt er einmal nach („Update" → „Sicher?"), und entschärft sich
nach fünf Sekunden von selbst wieder — ein versehentlicher Tap soll auf einem
Wandtablet keinen Button hinterlassen, der beim nächsten Antippen Home
Assistant neu startet. Während der Installation zeigt der Button den
Fortschritt, die Box bekommt einen Balken am unteren Rand.

`no_install_types` listet Gruppen nur an, ohne Button (Standard: `firmware`,
weil ein fehlgeschlagenes Zigbee-Firmware-Flashen Hardware unbrauchbar machen
kann — das gehört bewusst auf die Geräteseite). Entities mit `auto_update`
bekommen ein Auto-Icon statt eines Buttons: Home Assistant installiert die
ohnehin selbst.

Die übrigen Zeilen öffnen beim Antippen den more-info-Dialog mit Changelog
und HA-eigenem Install-Button; `inline_install: true` blendet stattdessen
einen kleinen Button direkt in die Zeile ein.

### Backup-Chip, Übersprungene, Aufklappbereich

`backup_entity` (ein Zeitstempel-Sensor, z.B.
`sensor.backup_last_successful_automatic_backup`) zeigt im Banner das Alter
des letzten Backups — grün bis `backup_warn_days` (Standard 7), danach orange,
ohne verwertbaren Zeitstempel rot mit „Kein Backup".

Per `skip` übersprungene Updates stehen gedimmt am Ende der Liste und lassen
sich über einen eigenen Button wieder anzeigen (`update.clear_skipped`). Sie
zählen nicht als „aktuell" — sonst würde die Kachel mehr aktuelle Komponenten
behaupten, als es gibt.

`show_uptodate` (Standard an) fasst alles Aktuelle hinter einem Aufklapper
zusammen, aufgeklappt als kompakte Zeilen mit installierter Version.

### Benachrichtigung bei neuen Updates

Der Abschnitt **Benachrichtigung** im Editor legt eine
Home-Assistant-Automatisierung an:

- **`on_change`** (Standard) — meldet sofort, sobald ein Update auftaucht,
  eine Nachricht pro Komponente.
- **`daily`** / **`weekly`** — eine Sammelnachricht zur Zeit `notify_time`
  mit allen offenen Updates, damit aus einer Add-on-Welle nicht fünfzehn
  Pushes werden.

Überwacht wird dieselbe Auswahl, die die Kachel anzeigt;
`notify_exclude_entities` schaltet einzelne Entities stumm, ohne sie aus der
Kachel zu entfernen. Titel und Text lassen sich frei überschreiben,
Platzhalter: `{anzahl}`, `{liste}`, `{komponente}`, `{version}`, `{aktuell}`.

### Laufendes Update und Verbindungsverlust

Ein Core-Update startet Home Assistant neu, die Websocket-Verbindung bricht
also mitten in der Installation weg. Statt auf einem eingefrorenen Banner
stehen zu bleiben, zeigt die Kachel dann „Verbindung getrennt – {name} läuft"
mit dem Hinweis, dass Home Assistant gleich neu startet.

### Konfigurationsoptionen

| Option | Typ | Standard | Beschreibung |
|---|---|---|---|
| `auto_discover` | boolean | `true` | Alle `update.*`-Entities automatisch aufnehmen |
| `entities` | Liste\<string\> | – | Manuelle Auswahl bei `auto_discover: false` |
| `exclude_entities` | Liste\<string\> | – | Von der Anzeige ausgeschlossene Entities |
| `include_types` | Liste\<string\> | – | Nur diese Gruppen anzeigen (leer = alle) |
| `group_order` | Liste\<string\> | siehe oben | Reihenfolge der Gruppen und damit die Priorität |
| `type_patterns` | Objekt | – | `entity_id`-Fragment → Gruppe, überschreibt die Automatik |
| `no_install_types` | Liste\<string\> | `["firmware"]` | Gruppen ohne Install-Button |
| `max_visible` | number | `5` | Direkt sichtbare Zeilen, Rest hinter „mehr anzeigen“ (`0` = alle) |
| `require_confirm` | boolean | `true` | Install-Button fragt einmal nach |
| `inline_install` | boolean | `false` | Kleiner Install-Button direkt in der Zeile |
| `show_uptodate` | boolean | `true` | Aufklappbereich für bereits aktuelle Komponenten |
| `show_skipped` | boolean | `true` | Übersprungene Updates gedimmt am Ende anzeigen |
| `show_release_notes` | boolean | `true` | Tap auf die Versionszeile öffnet more-info |
| `backup_entity` | string | – | Zeitstempel-Sensor des letzten Backups |
| `backup_warn_days` | number | `7` | Ab diesem Alter wird der Backup-Chip orange |
| `notify_service` | Liste\<string\> | – | Benachrichtigungsziele (ohne `notify.`-Präfix) |
| `notify_mode` | `on_change` \| `daily` \| `weekly` | `on_change` | Sofort, oder Sammelnachricht zur festen Zeit |
| `notify_time` | string | `18:00:00` | Uhrzeit der Sammelnachricht (nur `daily`/`weekly`) |
| `notify_weekday` | string | `mon` | Wochentag der Sammelnachricht (nur `weekly`) |
| `notify_exclude_entities` | Liste\<string\> | – | Entities, die keine Benachrichtigung auslösen |
| `notify_title` / `notify_message` | string | – | Eigener Titel/Text, leer = Standardtext |
| `name` / `icon` | string | „Updates“ / `mdi:package-up` | Header |
| `ok_color` / `update_color` | string | `#81c784` / `#85b7eb` | Statusfarben |
| `addon_color` / `hacs_color` / `firmware_color` / `remote_color` | string | siehe oben | Typfarben der Zeilen |
| `accent_opacity` | number | `14` | Intensität der Banner-Tönung in Prozent |
| `text_color` / `secondary_text_color` | string | Theme-Standard | Name / Sekundärtext |
| `card_background` | string | Glas-/Solid-Hintergrund | Kartenhintergrund |
| `animation` | `auto` \| `on` \| `off` | `auto` | Aufklapp- und Fortschrittsanimationen |
| `glass_background` | boolean | `true` | Milchiger Glashintergrund |
| `radius` / `corners` | number / object | `28` | Eckenradius, optional je Ecke |

</details>
