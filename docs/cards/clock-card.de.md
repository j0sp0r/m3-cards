---
title: M3 Clock Card
type: m3-clock-card
category: household
display: Clock
summary: Uhr in fünf Stilen, von runden Kacheln bis zum organischen Zifferblatt
table_order: 5
section_order: 28
---

Eine Uhr in fünf Stilen, alle in derselben Designsprache. Sie liest **keine
Entität** — die Zeit kommt aus dem Browser, die Zeitzone aus Home Assistant —
und läuft damit auf jedem Dashboard ohne Einrichtung. Nur die optionalen Extras
weiter unten brauchen Entitäten.

Die Karte zeichnet nur neu, solange sie tatsächlich sichtbar ist: Eine Uhr auf
einem Wandtablet würde sonst wochenlang für einen leeren Raum animieren. Stile
ohne Bewegung zwischen den Sekunden schalten auf einen Timer um, der erst zur
vollen Minute aufwacht.

<img src="docs/images/clock-card.png" alt="Clock Card" width="440">

<details>
<summary>Konfiguration, Beispiele & Optionen</summary>

```yaml
type: custom:m3-clock-card
style: tiles          # tiles | shapes | lockscreen | scallop | ring
show_seconds: true
show_date: true
```

### Die fünf Stile

| Stil | Aussehen |
| --- | --- |
| `tiles` | Zwei große abgerundete Kacheln, die Stunden in der Akzentfarbe getönt. Standard. |
| `shapes` | Jede Ziffer in einer gelappten Form — Cookie für die Stunden, Kleeblatt für die Minuten. Die zwei Ziffern eines Paares überlappen, damit „14" als eine Zahl liest. |
| `lockscreen` | Eine Zeile massiv gefüllt, die andere als Kontur, dazu eine Deko-Form, die über die Ecke hinausragt. |
| `scallop` | Ein analoges Zifferblatt aus zwei gegenläufig rotierenden Lappenformen, mit einer kleinen Blüte als Sekundenzeiger. |
| `ring` | Sechzig Segmente um die Zeit. Mit `show_seconds: false` wird daraus die laufende Stunde, ein Segment je Minute. |

### Konfigurationsoptionen

| Option | Typ | Standard | Beschreibung |
| --- | --- | --- | --- |
| `style` | string | `tiles` | `tiles`, `shapes`, `lockscreen`, `scallop`, `ring` |
| `size` | number | `1.0` | Skaliert alle Maße des Stils, 0,7–1,5 |
| `time_zone` | string | HA-Zone | IANA-Zone, z. B. `Europe/Berlin`. Unbekannte Zone → Systemzeit |
| `time_format` | `auto` \| `12` \| `24` | `auto` | Folgt standardmäßig der HA-Spracheinstellung |
| `show_date` | boolean | `true` | Datumszeile unter der Uhr |
| `date_format` | `auto` \| `short` \| `long` | `auto` | |
| `show_seconds` | boolean | `true` | |
| `seconds_style` | `bar` \| `dots` \| `none` | `bar` | Nur `tiles`: Darstellung der Sekunden |
| `show_seconds_tile` | boolean | `false` | Nur `tiles`: dritte Kachel für die Sekunden |
| `colon_blink` | boolean | `true` | Nur `tiles` |
| `ring_animation` | `reset` \| `drain` | `reset` | Nur `ring`: wie der Ring beim Umlauf leert |
| `shape_hours` / `shape_minutes` | string | `cookie` / `clover` | `cookie`, `clover`, `flower`, `scallop`, `squircle` |
| `digit_overlap` | number | `-12` | Nur `shapes`: Überlappung der Ziffern eines Paares, −20…0 |
| `shape_motion` | boolean | `true` | Langsame Drehung der Lappenformen |
| `shape_speed` | `slow` \| `normal` \| `fast` | `normal` | |
| `show_decor` | boolean | `true` | Nur `lockscreen`: Deko-Form in der Ecke |
| `outline_target` | `minutes` \| `hours` \| `none` | `minutes` | Nur `lockscreen`: welche Zeile konturiert wird |
| `layout` | `stacked` \| `inline` | `stacked` | Nur `lockscreen` |
| `tick_style` | `dots` \| `lines` \| `none` | `dots` | Nur `scallop`: Stundenmarken |
| `tile_color_mode` | `accent_hours` \| `both_accent` \| `neutral` | `accent_hours` | Nur `tiles` |
| `alarm_entity` | string | – | Chip mit dem nächsten Wecker, nur innerhalb von 24 Stunden |
| `sun_entity` | string | – | Chip mit Sonnenauf- oder -untergang, z. B. `sun.sun` |
| `show_day_progress` | boolean | `false` | Balken mit Tagesfortschritt und Restzeit |
| `progress_range` | `day` \| `custom` | `day` | `custom` nutzt `progress_start` und `progress_end` |
| `progress_start` / `progress_end` | string | – | `HH:MM`, z. B. Arbeitszeit |
| `secondary_zones` | Liste | – | Einträge `{ label, time_zone }` als kompakte Zeile |
| `accent_color` / `secondary_color` | string | – | |

`animation: off` — oder die Systemeinstellung für reduzierte Bewegung — lässt
die Formen **stillstehen statt verschwinden**, wechselt Ziffern ohne Pop und
lässt den Sekundenzeiger springen statt gleiten.

</details>
