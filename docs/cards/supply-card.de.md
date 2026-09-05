---
title: M3 Supply Card
type: m3-supply-card
category: household
display: Supply
summary: Vorräte: Restmenge, Reichweite, Nachfüllen per Tap
table_order: 1
section_order: 21
---

Verbrauchsmaterial — Waschmittel-Pods, Spülmaschinentabs, Filter, Tierfutter
— mit Restmenge, geschätzter Reichweite und Nachfüllen per Tap. Ein Vorrat
steht groß als Hero mit einem Punkt je verbleibender Einheit, der Rest folgt
als kompakte Zeilen; ein Tap darauf macht ihn zum Hero.

<img src="docs/images/supply-card.png" alt="Supply Card" width="440">

<details>
<summary>Konfiguration, Beispiele & Optionen</summary>

```yaml
type: custom:m3-supply-card
items:
  - entity: counter.waschmittel_pods
    name: Waschmittel-Pods
    icon: mdi:washing-machine
    unit: Pods
  - entity: counter.spulmaschinentabs
    name: Spülmaschinentabs
    icon: mdi:dishwasher
```

### Den Zähler anlegen

Jeder Vorrat braucht einen Helfer für die Restmenge: **Einstellungen → Geräte
& Dienste → Helfer → Helfer erstellen → Zähler**. Setze *Maximum* auf den
Inhalt einer Packung — Home Assistant speichert keinen höheren Wert, eine
60er-Packung Tabs braucht also Maximum 60. Genau deshalb wird `pack_size` in
der Karte auf dieses Maximum begrenzt.

Mehr braucht die Karte nicht: mit − herunterzählen und bei einer neuen
Packung auf *Packung nachgefüllt* tippen.

### Automatisch herunterzählen

Damit der Zähler dem Gerät folgt, legst du eine Automatisierung an, die ihn
nach jedem Durchlauf verringert:

```yaml
alias: Waschmittel-Pods herunterzählen
triggers:
  - trigger: state
    entity_id: sensor.waschmaschine_status
    to: "end"
actions:
  - action: counter.decrement
    target:
      entity_id: counter.waschmittel_pods
mode: single
```

Den Trigger ersetzt du durch das, was bei deiner Maschine das Ende markiert —
ein Status-Sensor, der auf `end`/`beenden` springt, eine Leistungsaufnahme
unter einem Schwellwert oder ein `binary_sensor`, der auf `off` geht.

### Reichweiten-Schätzung

Der Untertitel zeigt, wie lange ein Vorrat noch reicht — berechnet aus seiner
eigenen Historie: jede Verringerung zählt als Verbrauch, Nachfüllungen werden
ignoriert. Zwei Bedingungen müssen erfüllt sein, bevor eine Schätzung
erscheint: mindestens 3 Verringerungen und mindestens 2 Tage Beobachtung.
Sonst würden ein paar Taps beim Einrichten auf Hunderte pro Tag hochgerechnet.

Geteilt wird durch den Zeitraum, den die Historie **tatsächlich abdeckt**,
nicht durch `rate_window`. Der Recorder von Home Assistant bewahrt
standardmäßig 10 Tage auf, ein 30-Tage-Fenster liefert also meist ein Drittel
davon — durch das Fenster zu teilen würde die dreifache Reichweite
versprechen. Für mehr Daten `purge_keep_days` in der Recorder-Konfiguration
erhöhen.

Für einen Vorrat, der ein paar Mal im Jahr gewechselt wird — etwa ein
Aquarium-Filter — reicht die Historie nie aus. Dafür `usage_per_week` setzen,
dann rechnet die Karte direkt damit.

> Langzeitstatistik wird **nicht** verwendet: die gibt es nur für
> `sensor`-Entitäten mit `state_class`, und counter- oder
> input_number-Helfer tauchen dort nie auf.

### Benachrichtigungen

Die Karte legt auf Wunsch eine Home-Assistant-Automatisierung an, die dich an
zur Neige gehende Vorräte erinnert — täglich abends, wöchentlich oder sofort
beim Unterschreiten. Der Abend-Digest schickt eine Nachricht mit allen
Vorräten auf einmal statt einer Push je Artikel. Empfänger wählen,
entscheiden ob „leer", „kritisch" oder „knapp" meldenswert ist, Knopf
drücken — die Automatisierung erscheint unter *Einstellungen →
Automatisierungen*. Titel und Text akzeptieren `{anzahl}` und `{liste}`
(Digest) bzw. `{vorrat}` und `{rest}` (sofort).

Standardmäßig sind alle Vorräte der Karte erfasst. Mit `notify_items`
grenzt du das auf eine Auswahl ein — praktisch, wenn nur das Waschmittel
eine Push wert ist und die Ersatzfilter nicht.

### Einkaufsliste

Ist `todo_entity` gesetzt, zeigt ein kritischer Vorrat im Hero einen Chip
*Auf die Einkaufsliste*. `auto_add_to_list` erledigt das ungefragt als Teil
der Benachrichtigungs-Automatisierung — sie liest die Liste vorher aus und
überspringt, was schon draufsteht, damit eine tägliche Erinnerung keine
Dubletten anhäuft. Eine To-do-Liste brauchst du dafür zuerst:
**Einstellungen → Geräte & Dienste → Integration hinzufügen → Lokale
To-do-Liste**.

| Option | Typ | Standard | Beschreibung |
|---|---|---|---|
| `items` | Liste | – | Die Vorräte, siehe unten |
| `hero` | number \| string | geringste Reichweite | Index oder Entität für die große Darstellung |
| `layout` | `hero_and_list` \| `list_only` \| `hero_only` | `hero_and_list` | Layout |
| `refill_mode` | `set` \| `add` | `set` | Nachfüllen setzt auf, oder addiert, eine Packung |
| `list_tap_action` | `hero` \| `more-info` | `hero` | Verhalten beim Tap auf eine Zeile |
| `rate_window` | number | `30` | Tage Historie für die Verbrauchsrate |
| `usage_per_week` | number | – | Feste Rate, überspringt die Berechnung |
| `todo_entity` | string | – | To-do-Liste für die Einkaufseinträge |
| `notify_items` | Liste | alle | Benachrichtigung auf bestimmte Vorräte begrenzen |
| `auto_add_to_list` | boolean | `false` | Automatisch hinzufügen, wenn kritisch |
| `notify_*` | – | – | Siehe Benachrichtigungen oben |
| `ok_color` / `low_color` / `critical_color` / `unavailable_color` | string | siehe oben | Zustandsfarben |
| `accent_opacity` | number | `18` | Stärke der Tönung |
| `text_color` / `secondary_text_color` | string | Theme-Standard | Name / Sekundärtext |
| `card_background` | string | Glas/Solid-Hintergrund | Kartenhintergrund |
| `animation` | `auto` \| `on` \| `off` | `auto` | Animation beim Hero-Wechsel |
| `glass_background` | boolean | `true` | Milchglas-Hintergrund |
| `radius` / `corners` | number / object | `28` | Eckenradius, optional je Ecke |

Je Artikel:

| Option | Typ | Standard | Beschreibung |
|---|---|---|---|
| `entity` | string | – | `counter.*`- oder `input_number.*`-Helfer |
| `name` / `icon` / `color` | string | von der Entität | Name, Icon, Farbe bei ausreichendem Bestand |
| `pack_size` | number | Helfer-Maximum | Einheiten je Packung, begrenzt auf dieses Maximum |
| `unit` | string | – | Mehrzahlwort unter dem Wert, z.B. „Pods" |
| `low_threshold` | number | 25 % der Packung | Darunter: „knapp" |
| `critical_threshold` | number | 10 % der Packung, min. 1 | Darunter: „kritisch" |
| `shopping_item` | string | der Name | Text für die To-do-Liste |
| `usage_per_week` | number | – | Feste Rate für diesen Artikel |

</details>
