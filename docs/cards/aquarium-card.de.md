---
title: M3 Aquarium Card
type: m3-aquarium-card
category: special
display: Aquarium
summary: Aquarien-Geräte, Lichtbogen, Kamera und Wartung
table_order: 0
section_order: 18
---

Übersicht pro Aquarium: Wassertemperatur gegen einen Sollbereich, ein
festes Geräte-Raster (Taglicht, Nachtlicht, Pumpe, Heizer, CO2), ein
Tagesbogen-Beleuchtungsplan, optionale Kamera und Status-Chips für alles,
was Aufmerksamkeit braucht.

<img src="docs/images/aquarium-card.png" alt="M3 Aquarium Card" width="440">

<details>
<summary>Konfiguration, Beispiele & Optionen</summary>

```yaml
type: custom:m3-aquarium-card
water_temperature_entity: sensor.aquarium_water_temperature
light_day:
  entity: switch.aquarium_light_day
pump:
  entity: switch.aquarium_pump
heater:
  entity: switch.aquarium_heater
```

### Geräte-Raster

Fünf feste Slots (`light_day`, `light_night`, `pump`, `heater`, `co2`),
jeweils `entity` + optional `name`/`icon`/`color` — `entity` weglassen
blendet die Kachel aus. `extra_devices` fügt beliebig viele weitere
Kacheln (gleiche Form) für alles Weitere hinzu, das einen Schalter
verdient (UV-Klärer, Dosierpumpe, ...). Tippen auf eine Kachel schaltet
`light`/`switch`-Entities über `homeassistant.toggle`; momentane Domains
(`button`, `input_button`, `scene`, `script`) lösen stattdessen ihren
jeweiligen "aktivieren"-Service aus, und `input_datetime`-Entities werden
mit dem aktuellen Zeitstempel versehen (genutzt vom Wartungs-Chip, siehe
unten). `heater_power_entity` (ein Leistungssensor) zeigt die aktuelle
Leistungsaufnahme unter der Heizer-Kachel und speist den Warn-Chip
"Heizer ohne Leistung".

### Tagesbogen-Beleuchtungsplan

`show_schedule` (Standard an) zeichnet einen 24h-Bogen unter dem
Geräte-Raster, phasenweise eingefärbt, mit Markierung der aktuellen Zeit
und einer Statuszeile ("Tagphase · noch 3 Std." / "Nachtruhe · Licht ab
08:00"). Zwei Wege, ihn zu füllen:

- **`schedule`**: eine manuelle Liste von `{ device: "day" | "night",
  start, end, color? }`-Einträgen (`start`/`end` als `"HH:MM"`) — die
  einfache, empfohlene Option für einen festen Tageszyklus.
- **`schedule_entity`**: ein `schedule`-Domain-Helfer — liest die
  heutigen `[{from, to}]`-Bereiche als eine einzige generische
  "an"-Phase (weniger granular als eine manuelle Liste, bleibt dafür
  automatisch mit einem bestehenden HA-Zeitplan-Helfer synchron).

Eine manuelle `schedule` hat Vorrang vor `schedule_entity`, wenn beide
gesetzt sind.

### Kamera

`camera_entity` + `camera_style` legt fest, wie die Karte die
Becken-Kamera zeigt: `none` (Standard), `thumbnail` (kleines
Eck-Vorschaubild, tippen zum Aufklappen), `banner`
(Header-Bild in voller Breite) oder `live` (bettet
`<ha-camera-stream>` für echtes Video ein — fällt automatisch auf ein
Standbild zurück, wenn die Kamera-Integration kein Streaming
unterstützt). `camera_refresh` (Sekunden, `0` = aus) steuert, wie oft
die Standbild-Varianten ein neues Bild holen; `camera_live_on_tap`
(Standard an) öffnet bei den Nicht-`live`-Stilen den Live-Stream-Dialog
beim Tippen.

### Chips, Wartung und Farben

Status-Chips erscheinen in fester Prioritätsreihenfolge und nur, wenn
relevant: Temperaturabweichung vom `target_range`, Heizer an aber ohne
Leistungsaufnahme (braucht `heater_power_entity`), fällige Wartung
(siehe unten), Wasserstand (aus einem `binary_sensor`, "on" = niedrig),
pH/TDS außerhalb des Bereichs und aktuelle Leistungsaufnahme. Bis zu
`AQUARIUM_CHIP_MAX` Chips werden direkt angezeigt, der Rest klappt in
einen "+N"-Überlauf-Chip.

`cleaning_entity` (ein `input_datetime`-Helfer) + `cleaning_interval`
(Tage) speisen den Wartungs-Chip: Tippen auf die "Aquarium
säubern"-Kachel stempelt den Helfer mit jetzt, und der Chip zählt ab
diesem Zeitstempel hoch ("Reinigung fällig", "vor 3 T.", ...) — kein
Umweg über Telegram/Benachrichtigungen nötig, nur ein normaler Helfer,
dessen Verlauf sich auch im Entity-Verlauf ansehen lässt.

### Reinigungs-Erinnerung

Der Chip ist nur sichtbar, solange das Dashboard offen ist — deshalb kann
der Abschnitt **Wartung → Erinnerung** im Editor eine echte
Home-Assistant-Automatisierung anlegen, die auch benachrichtigt, wenn
nichts geöffnet ist. Ein oder mehrere Benachrichtigungsziele auswählen
(die Liste wird aus den eigenen `notify.*`-Diensten aufgebaut), eine
tägliche Prüfzeit setzen, dann "Erinnerung einrichten" drücken. Die Karte:

- legt einen `input_number`-Intervall-Helfer an, falls
  `cleaning_interval_entity` noch nicht gesetzt ist (Startwert ist das
  aktuelle `cleaning_interval`), und schreibt ihn in die Kartenkonfiguration
  zurück;
- legt eine Automatisierung an (oder aktualisiert sie), die täglich zur
  gewählten Uhrzeit auslöst und jedes ausgewählte Ziel benachrichtigt, wenn
  seit `cleaning_entity` mehr Tage vergangen sind als der Intervall-Helfer
  erlaubt.

Die Automatisierungs-ID wird aus `cleaning_entity` abgeleitet — ein
erneuter Druck auf den Button aktualisiert also dieselbe Automatisierung,
statt Duplikate anzulegen. Es ist eine ganz normale Automatisierung,
sichtbar und bearbeitbar unter Einstellungen → Automatisierungen. Da Chip
und Automatisierung denselben `cleaning_interval_entity`-Helfer lesen,
ändert eine Anpassung dort beide gleichzeitig.

`accent_color` (Header-Icon) und die temperaturabhängigen
Kachelfarben haben beide eine zugehörige `_opacity`-Option
(`accent_opacity`, `tile_tint_opacity`, 0–100), die steuert, wie stark
diese Farbe ihren Hintergrund einfärbt — dieselben "Farbstärke"-Regler,
die jetzt bei jeder Karte neben der Farbauswahl erscheinen (siehe
Changelog).

### Konfigurationsoptionen

| Option | Typ | Standard | Beschreibung |
|---|---|---|---|
| `name` / `icon` | string | Entity-Name / `mdi:fishbowl-outline` | Header |
| `water_temperature_entity` | string | – | `sensor` mit `device_class: temperature` |
| `target_range` | `[number, number]` | `[24, 26]` | Sollbereich der Wassertemperatur |
| `light_day` / `light_night` / `pump` / `heater` / `co2` | Objekt (`entity`, `name`, `icon`, `color`) | – | Feste Geräte-Slots; `entity` weglassen blendet aus |
| `extra_devices` | Liste in gleicher Form | – | Weitere Geräte-Kacheln |
| `heater_power_entity` | string | – | Leistungssensor unter der Heizer-Kachel |
| `ph_entity` / `tds_entity` / `power_entity` | string | – | Optionale Wasserwerte-/Leistungssensoren für ihre Chips |
| `water_level_entity` | string | – | `binary_sensor`, "on" = niedriger Wasserstand |
| `cleaning_entity` | string | – | `input_datetime`-Helfer, beim Tippen gestempelt |
| `cleaning_interval` | number | `14` | Tage, bevor der Wartungs-Chip warnt |
| `cleaning_interval_entity` | string | – | `input_number`-Helfer; hat Vorrang vor `cleaning_interval` und wird mit der Erinnerungs-Automatisierung geteilt |
| `cleaning_notify_service` | list\<string\> | – | Benachrichtigungsziele der Erinnerung (ohne `notify.`-Präfix) |
| `cleaning_notify_time` | string | `18:00:00` | Tägliche Uhrzeit, zu der die Erinnerung prüft, ob die Reinigung fällig ist |
| `camera_entity` | string | – | `camera`-Entity |
| `camera_style` | `none` \| `thumbnail` \| `banner` \| `live` | `none` | Wie die Kamera angezeigt wird |
| `camera_refresh` | number | `10` | Standbild-Aktualisierungsintervall in Sekunden (`0` = aus) |
| `camera_live_on_tap` | boolean | `true` | Tippen öffnet den Live-Stream-Dialog |
| `schedule` | Liste von `{device, start, end, color?}` | – | Manuelle Beleuchtungsphasen |
| `schedule_entity` | string | – | `schedule`-Domain-Helfer als Fallback-Quelle |
| `show_schedule` | boolean | `true` | Tagesbogen-Zeitplan-Balken |
| `accent_color` / `accent_opacity` | string / number | Theme-Standard / `12` | Farbe + Farbstärke des Header-Icons |
| `tile_tint_opacity` | number | `12` | Farbstärke für Geräte-/Raum-Kachelhintergründe |
| `text_color` / `secondary_text_color` | string | Theme-Standard | Name/Wert bzw. Sekundärtext |
| `card_background` | string | Glas-/Solid-Hintergrund | Kartenhintergrund |
| `animation` | `auto` \| `on` \| `off` | `auto` | Zeitplan-Marker-/Kachel-Animationen |
| `glass_background` | boolean | `true` | Milchiger Glashintergrund |
| `radius` / `corners` | number / object | `20` | Eckenradius, optional je Ecke |

</details>
