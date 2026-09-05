---
title: M3 Group Card
type: m3-group-card
category: household
display: Group
summary: Mehrere Karten auf einer gemeinsamen Fläche, damit sie als ein Block gelesen werden
table_order: 9
section_order: 37
---

Fasst andere Karten — M3 oder nicht — in einem gemeinsamen Rahmen zusammen,
sodass ein Stapel mehrerer kleiner Karten (z.B. zwei oder drei Chip-Button-
Reihen) wie eine einzige Karte wirkt statt wie ein Haufen separat umrandeter
Kästen. Die Gruppe zeichnet selbst den äußeren Rahmen/Hintergrund; jede
verschachtelte Karte, die den Rahmen-Stil dieser Suite teilt, verliert
automatisch ihren eigenen Rahmen, Hintergrund und ihr Padding, sobald sie in
einer Gruppe steckt — ganz ohne Konfiguration an der verschachtelten Karte
selbst. `gap` allein steuert den Abstand zwischen den Reihen, `gap: 0` lässt
sie sich berühren.

Karten werden über dieselben visuellen Picker hinzugefügt, bearbeitet und
sortiert, die auch Home Assistants eigener `vertical-stack`-Editor nutzt —
inklusive Suche, Favoriten und Einfügen aus der Zwischenablage beim
Hinzufügen einer Karte.

<img src="docs/images/group-card.png" alt="Group Card" width="500">

<details>
<summary>Konfiguration, Beispiele & Optionen</summary>

```yaml
type: custom:m3-group-card
gap: 4
cards:
  - type: custom:m3-chip-buttons-card
    buttons:
      - entity: lock.haustuer
        name: Haustür
      - entity: binary_sensor.haustuer
        name: Haustür
  - type: custom:m3-chip-buttons-card
    buttons:
      - entity: lock.hintertuer
        name: Hintertür
      - entity: binary_sensor.hintertuer
        name: Hintertür
```

### Konfigurationsoptionen

| Option | Typ | Standard | Beschreibung |
|---|---|---|---|
| `cards` | Liste | `[]` | Die verschachtelten Karten, in Anzeigereihenfolge. Beliebige Lovelace-Karte — M3 oder nicht |
| `gap` | number (px) | `8` | Abstand zwischen den Reihen. `0` lässt sie sich berühren |
| `radius` | number (px) | `16` | Eckenradius der Karte |
| `corners` | object | – | Optionaler Override je Ecke, wie bei jeder anderen Karte |
| `glass_background` | boolean | `true` | Milchiger Glashintergrund |
| `card_background` | string | – | Hintergrundfarbe überschreiben |

</details>
