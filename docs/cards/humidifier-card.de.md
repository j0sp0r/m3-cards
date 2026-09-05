---
title: M3 Humidifier Card
type: m3-humidifier-card
category: household
display: Humidifier
summary: Zielfeuchte, Modus, Lüfterstufe und Zusatzfunktionen — auch ohne humidifier-Entität
table_order: 11
section_order: 32
---

Zielfeuchte, Modus, Lüfterstufe und die Zusatzfunktionen eines Geräts in einer
Karte. Die eingebaute humidifier-Karte von Home Assistant kann keine
Lüftergeschwindigkeit, deshalb steht üblicherweise eine zweite Karte daneben —
das hier ist die eine.

Sie setzt außerdem nicht voraus, dass `entity` eine `humidifier`-Entität ist.
Viele Entfeuchter erscheinen als Schalter plus `number` plus `sensor`, und die
funktionieren hier ebenso; siehe „Geräte, die keine humidifier-Entität sind".

<img src="docs/images/humidifier-card.png" alt="Humidifier Card" width="440">

<sub>Dasselbe Gerät zweimal: alles, und darunter `layout: [slider, modes]`.</sub>

<details>
<summary>Konfiguration, Beispiele & Optionen</summary>

```yaml
type: custom:m3-humidifier-card
entity: humidifier.keller
```

Mehr braucht ein Gerät nicht, das sich ordentlich meldet: aktuelle und
Zielfeuchte, Modi und Bereich kommen alle von der Entität.

### Die vier Blöcke

| Block | Was er zeichnet |
| --- | --- |
| `slider` | Der Zielfeuchte-Regler, darüber Beschriftung und Wert. Seine Welle bewegt sich nur, solange das Gerät wirklich arbeitet; im Leerlauf flacht sie zum Balken ab — so wie im Bild oben |
| `modes` | Eine Pille je Modus, dazu eine Aus-Pille — Ausschalten ist kein Modus |
| `fan` | Eine Pille je Lüfterstufe, mit Balken-Icon, das mit der Stufe füllt |
| `chips` | Wassertank, schaltbare Zusatzfunktionen, reine Anzeigen |

`layout` bestimmt Reihenfolge **und** Sichtbarkeit. Was in der Liste fehlt, wird
nicht gezeichnet — ein Mechanismus statt einer Liste plus `show_*`-Schaltern,
die sich widersprechen können.

```yaml
type: custom:m3-humidifier-card
entity: humidifier.keller
layout: [slider, modes]     # keine Lüfterzeile, keine Chips
```

### Geräte, die keine humidifier-Entität sind

Ein Tuya- oder Zigbee-Entfeuchter ist oft ein `switch` fürs Ein und Aus, ein
`number` für das Ziel und ein `sensor` für den Messwert. Die Karte auf den
Schalter zeigen lassen und den Rest benennen:

```yaml
type: custom:m3-humidifier-card
entity: switch.keller_entfeuchter
device_kind: dehumidifier
current_entity: sensor.keller_luftfeuchte
target_entity: number.keller_ziel
mode_entity: select.keller_modus
fan_entity: select.keller_luefterstufe
tank_entity: sensor.keller_tank
controls:
  - entity: switch.keller_ionisator
    name: Ionisator
    icon: mdi:air-filter
    color: "#8f79e0"
sensors:
  - entity: sensor.keller_filter
    label: Filter ok
    icon: mdi:air-filter
```

`humidifier`, `switch`, `fan`, `select`, `input_select`, `number` und
`input_number` werden alle bedient; die Karte findet selbst heraus, welcher
Dienst zu welcher Domain gehört.

### Modi

Die Modi kommen aus `available_modes`, aus den Optionen von `mode_entity` oder
aus einer eigenen `modes`-Liste. Jeder Modus darf Name, Icon und Farbe tragen,
und ein unbekannter Modus bekommt trotzdem eine Farbe aus einer Palette statt
Grau.

```yaml
modes:
  - mode: sleep
    name: Nacht
    icon: mdi:weather-night
    color: "#8f79e0"
  - mode: turbo
    hidden: true
```

`mode_style` ist `icon_label`, `icon_only` oder `dropdown`; ab sechs Modi
schaltet die Karte selbst auf Auswahlliste, und eine schmale Karte lässt die
Beschriftungen weg.

### Lüfterstufe

Die Zeile liest, welche der drei Formen die Entität hat: `preset_modes` eines
Lüfters, dessen Prozentwerte (auf Aus / Niedrig / Mittel / Hoch abgebildet) oder
die Optionen eines `select`. `fan_steps` sticht alles:

```yaml
fan_steps:
  - { name: Aus }
  - { name: Leise, preset: sleep }
  - { name: Normal, percentage: 60 }
  - { name: Maximal, option: turbo }
```

### Optionen

| Option | Vorgabe | Wirkung |
| --- | --- | --- |
| `entity` | — | Pflicht. Das, was die Karte ein- und ausschaltet |
| `current_entity` | `current_humidity` der Entität | Woher der Messwert kommt |
| `target_entity` | `humidity` der Entität | Wo der Zielwert liegt |
| `action_entity` | `action` der Entität | Entfeuchtet / befeuchtet / bereit |
| `device_kind` | aus `device_class` | `humidifier` oder `dehumidifier` — Wortwahl und Icon |
| `min_humidity` / `max_humidity` | von der Entität, sonst 30 / 80 | Bereich des Reglers |
| `humidity_step` | `1` | Schrittweite beim Ziehen und für die Pfeiltasten |
| `mode_entity` | — | Ein `select`, das den Modus hält |
| `modes` | von der Entität | Eigene Liste mit Name, Icon, Farbe, `hidden` |
| `mode_style` | `icon_label` | `icon_label`, `icon_only`, `dropdown` |
| `fan_entity` | — | Ein `fan` oder `select`. Ohne Angabe entfällt die Zeile |
| `fan_steps` | abgeleitet | Eigene Stufen |
| `tank_entity` | — | Füllstandssensor oder `binary_sensor` |
| `tank_warn` / `tank_full` | `70` / `95` | Ab wann der Chip orange, dann rot wird |
| `tank_style` | `chip` | `chip` oder `bar` (ausgeblendet) |
| `controls` | — | Chips, die schalten: switch, button, select |
| `sensors` | — | Reine Anzeige-Chips |
| `layout` | alle vier | Welche Blöcke, in welcher Reihenfolge |

### Wenn Angaben fehlen

`action` ist im humidifier-Vertrag optional und wird von vielen Integrationen
weggelassen. Fehlt es, leitet die Karte Ent- oder Befeuchten aus der Richtung
zwischen Ist und Ziel ab, statt nichts zu zeigen. Ein Gerät ohne Modi bekommt
keine Modus-Zeile. Ein Tank, der nur ein `binary_sensor` ist, bekommt nur dann
einen Chip, wenn er voll ist — „nicht voll" ist keine Nachricht.

</details>
