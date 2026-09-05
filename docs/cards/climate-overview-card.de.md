---
title: M3 Climate Overview Card
type: m3-climate-overview-card
category: climate
display: Climate Overview
summary: Raum-für-Raum Temperatur/Feuchte, nach Bereich gruppiert
table_order: 2
section_order: 17
---

Eine kompakte Übersicht aller Temperatur-/Feuchte-Sensoren, gruppiert nach
Raum: eine Kachel pro Raum (Temperatur + Feuchte zusammengeführt), eine
waagerechte Vergleichsskala mit einem Punkt pro Raum, und ein Hinweis-Chip
im Header für den Raum, der am weitesten vom Komfortbereich abweicht.

<img src="docs/images/climate-overview-card.png" alt="Climate Overview Card" width="440">

<details>
<summary>Konfiguration, Beispiele & Optionen</summary>

```yaml
type: custom:m3-climate-overview-card
auto_discover: true
```

### Entity-Quelle und Raumzuordnung

- **`auto_discover: true`** (Standard): findet alle `sensor`-Entities mit
  `device_class: temperature` oder `humidity` sowie jede `climate`-Entität —
  welche davon tatsächlich eine Kachel ergeben, entscheidet `mode`. Sensoren, die einem HA-
  **Bereich** zugeordnet sind, werden zu diesem Bereich gruppiert (Name/
  Icon aus der Bereichs-Registry); Sensoren ohne Bereich, die aber
  dasselbe **Gerät** teilen (z.B. ein Kombisensor für Temperatur+Feuchte),
  werden nach Gerät gruppiert; der Rest wird zu einer eigenen Kachel,
  benannt nach dem (bereinigten) Entity-Namen. Räume ohne
  Temperatursensor und ohne Thermostat werden übersprungen — Feuchte allein
  ergibt keinen Raum. Filterbar über `include_area` / `exclude_area` /
  `include_entities` / `exclude_entities` / `include_labels` /
  `exclude_labels` / `include_state` / `exclude_state`.
- **`mode`**: `temperature` (Standard) ist das bisherige Verhalten — nur
  eigene Sensoren, Räume ohne einen solchen entfallen. `thermostat` liest das
  Thermostat eines Raums, wenn er keinen eigenen Sensor hat (oder wenn das
  Thermostat ein Gerät der Stufe „group" ist, das mehrere echte vertritt),
  und fällt sonst auf den Sensor zurück. `thermostat_only` behält nur Räume,
  die überhaupt ein Thermostat haben, und liest immer aus ihm. Das so
  gefundene Thermostat ist zugleich das, was `tile_tap_action: thermostat`
  und der Standard-Tap des Popups öffnen — pro Raum über `climate_entity`
  unter `rooms` festlegbar, sonst automatisch als erste `climate`-Entität im
  Bereich des Raums.
- **`rooms`**: eine manuelle Liste (`name`, `icon`, `temperature_entity`,
  `humidity_entity`, `climate_entity`) statt Auto-Discovery — damit lässt
  sich die Übersicht von Hand aufbauen.

`name_strip` bereinigt Namen, die von einem Gerät statt einem Bereich
stammen (Standard entfernt die Suffixe "Temperature"/"Temperatur" sowie
die Präfixe "Thermometer N - "/"Thermostat ") — z.B. wird "Thermometer 6 -
Arbeitszimmer" zu "Arbeitszimmer". Da in den meisten echten Setups nur ein
Teil der Sensoren einem Bereich zugewiesen ist, entstehen dabei oft mehr
Kacheln als tatsächliche Räume (eine pro nicht zugeordnetem Gerät) —
entweder mit `exclude_entities` eingrenzen oder für ein sauberes Ergebnis
auf eine manuelle `rooms`-Liste umsteigen.

### Tap, Halten und das Popup

`tap_action` (Standard `more-info`) / `hold_action` (Standard `popup`) /
`double_tap_action` (Standard `none`) lösen `tile_tap_action` durch dasselbe
allgemeine Aktionssystem ab, das jede andere Karte benutzt, und ergänzen es um
die Aktionsart `popup`. `tile_tap_action: thermostat` funktioniert weiterhin
als der engere, ältere Schalter speziell für den Standard-Tap — eine
ausdrückliche `tap_action` sticht ihn.

`popup.mode` bestimmt, was die `popup`-Aktion öffnet: **`default-grid`**
(Standard) — dieselbe Karte noch einmal, eingegrenzt auf den Bereich des
angetippten Raums (bei einem von Hand konfigurierten Raum auf dessen
Entitäten); **`default-detail`** — HAs eigener More-Info-Dialog für die
angetippte Entität, ganz ohne eine Karte von uns; oder **`custom`** — eine
beliebige Lovelace-Karte aus `popup.card`, in der die Platzhalter
`[[area_id]]`, `[[device_id]]`, `[[entity_id]]`, `[[name]]`,
`[[temperature_entity]]` und `[[humidity_entity]]` gegen den angetippten Raum
aufgelöst werden, bevor die Karte gebaut wird. `popup.inherit_filters`
(Standard `true`) verengt den Filter der Karte um den des Popups, statt ihn
zu ersetzen.

### Farbstufen, Vergleichsskala, Hinweis-Chip

Die Temperatur jeder Kachel wird über `temp_thresholds` eingefärbt (vier
Grenzen → fünf Stufen: kalt/kühl/angenehm/warm/heiß); die Feuchte wechselt
außerhalb von `humidity_range` in die Warnfarbe. Die Vergleichsskala
(`show_scale`) trägt die Temperatur jedes Raums als Punkt auf demselben
Farbverlauf ein, mit alternierend ober-/unterhalb platzierten
Raumnamen (ab 9 Räumen nur noch Punkte mit Tooltip); bei weniger als 2
Räumen blendet sie sich aus. Der Hinweis-Chip (`show_outlier_chip`) hebt
den einen Raum hervor, der am weitesten außerhalb des Komfortbereichs
liegt — kältester bei Unterschreitung, wärmster bei Überschreitung — und
verschwindet, sobald alle Räume im Komfortbereich liegen.

`show_trend` zeigt einen kleinen Pfeil, wenn sich die Temperatur eines
Raums in der letzten Stunde um mehr als 0,5 K geändert hat (über die
History-API abgerufen, alle 15 Minuten aktualisiert). `show_mold_warning`
zeigt ein Warnsymbol auf Kacheln über 65 % Feuchte **und** unter 18 °C.

### Statt des Verlaufs das Thermostat öffnen

Ein Tap auf einen Raum öffnet den Dialog des Sensors — also seinen
Verlaufsgraphen. `tile_tap_action: thermostat` öffnet stattdessen das Thermostat
des Raums: das eigene `m3-climate-card-mini` der Suite, schwebend über der
Karte und dort direkt bedienbar.

```yaml
type: custom:m3-climate-overview-card
tile_tap_action: thermostat
```

Gesucht wird eine `climate`-Entität im selben Bereich wie der Raum. Räume
stammen meist aus einem Bereich, das trifft also weit öfter zu als nicht — ein
über das *Gerät* gruppierter Raum hat aber keinen Bereich, in dem gesucht
werden könnte. Dort benennt `climate_entity` es direkt:

```yaml
rooms:
  - name: Wohnzimmer
    temperature_entity: sensor.wohnzimmer_temperatur
    climate_entity: climate.wohnzimmer
```

Ein Raum ohne Thermostat verhält sich wie bisher und öffnet den Verlauf. Ein
Tap, der nichts öffnet, wäre schlimmer als einer, der das Falsche öffnet.

### Konfigurationsoptionen

| Option | Typ | Standard | Beschreibung |
|---|---|---|---|
| `auto_discover` | boolean | `true` | Automatische Erkennung von Temperatur-/Feuchte-Sensoren |
| `mode` | `temperature` \| `thermostat` \| `thermostat_only` | `temperature` | Worüber Auto-Discovery berichtet — siehe oben |
| `include_area` / `exclude_area` | list\<string\> | – | Bereichsfilter für Auto-Discovery |
| `include_entities` / `exclude_entities` | list\<string\> | – | Entitätsfilter für Auto-Discovery |
| `include_labels` / `exclude_labels` | list\<string\> | – | Labelfilter für Auto-Discovery |
| `include_state` / `exclude_state` | list\<string\> | – | Zustandsfilter (`unavailable`/`unknown` oder ein eigener Wert) |
| `rooms` | Liste (`name`, `icon`, `temperature_entity`, `humidity_entity`, `climate_entity`) | – | Manuelle Raumliste statt Auto-Discovery |
| `name_strip` | list\<string\> | siehe oben | Namens-Suffixe/-Präfixe, die aus automatisch erkannten Namen entfernt werden |
| `name` / `icon` | string | "Raumklima" / `mdi:thermometer` | Header |
| `show_header` | boolean | `true` | Kopfbereich der Karte |
| `tile_tap_action` | `history` \| `thermostat` | `history` | Engerer Altschalter für den Standard-Tap — eine ausdrückliche `tap_action` sticht ihn |
| `tap_action` / `hold_action` / `double_tap_action` | Aktionsobjekt | more-info / popup / none | Tap-/Halte-/Doppeltipp-Aktion; ergänzt die Aktionsart `popup` |
| `popup` | Objekt (`mode`, `title`, `inherit_filters`, `sort`, `show_header`, `card`, Filterfelder) | – | Popup der `popup`-Aktion — siehe oben |
| `sort` | `area` \| `temp_desc` \| `temp_asc` \| `name` | `area` | Kachel-Reihenfolge |
| `show_scale` | boolean | `true` | Vergleichsskala unter dem Kachelraster |
| `show_outlier_chip` | boolean | `true` | Header-Chip für den auffälligsten Raum |
| `show_trend` | boolean | `false` | Pfeil bei einer Änderung >0,5 K in der letzten Stunde |
| `show_mold_warning` | boolean | `false` | Warnsymbol über 65 % Feuchte und unter 18 °C |
| `temp_thresholds` | Objekt (`cold`/`cool`/`comfortable`/`warm`) | `19`/`20.5`/`23.5`/`25` | Grenzen zwischen den fünf Farbstufen |
| `humidity_range` | `[number, number]` | `[35, 65]` | Komfortbereich; außerhalb wird die Warnfarbe verwendet |
| `scale_min` / `scale_max` | number | automatisch aus den Messwerten | Fester Bereich der Vergleichsskala |
| `cold_color` / `cool_color` / `comfortable_color` / `warm_color` / `hot_color` | string | blau/türkis/grün/amber/rot | Temperatur-Farbstufen |
| `humidity_warn_color` | string | amber | Feuchtefarbe außerhalb von `humidity_range` |
| `accent_color` | string | Theme-Standard | Akzentfarbe des Header-Icons |
| `text_color` / `secondary_text_color` | string | Theme-Standard | Raumnamen/Werte bzw. Sekundärtext |
| `card_background` | string | Glas-/Solid-Hintergrund | Kartenhintergrund |
| `animation` | `auto` \| `on` \| `off` | `auto` | Animation der Vergleichsskala-Punkte; `auto`/`on` respektieren `prefers-reduced-motion` |
| `glass_background` | boolean | `true` | Milchiger Glashintergrund |
| `radius` / `corners` | number / object | `28` | Eckenradius, optional je Ecke |

</details>
