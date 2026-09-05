---
title: M3 Todo Card
type: m3-todo-card
category: household
display: Todo
summary: Einkaufs- und Aufgabenlisten mit Schnell-Hinzufügen
table_order: 2
section_order: 22
---

Einkaufs- und Aufgabenlisten im Designsystem des Projekts, als Ersatz für die
eingebaute `todo-list`-Karte von Home Assistant. Eintragen in einer Zeile,
Abhaken per Tap, und Erledigtes verschwindet in einem Aufklappbereich.

<img src="docs/images/todo-card.png" alt="Todo Card" width="440">

<details>
<summary>Konfiguration, Beispiele & Optionen</summary>

```yaml
type: custom:m3-todo-card
entity: todo.einkaufsliste
name: Einkaufsliste
quick_add_mode: supplies
```

Eine To-do-Liste brauchst du zuerst: **Einstellungen → Geräte & Dienste →
Integration hinzufügen → Lokale To-do-Liste**. Jede To-do-Integration
funktioniert — die Karte liest die `todo.*`-Entität, auf die du sie zeigen
lässt.

### Schnellwahl-Chips

Optionale Ein-Tap-Knöpfe über der Liste, gespeist aus einer von drei Quellen
über `quick_add_mode`:

| Modus | Chips zeigen |
|---|---|
| `none` (Standard) | nichts |
| `fixed` | die Einträge aus `quick_add` |
| `recent` | zuvor abgehakte Einträge |
| `supplies` | die Einkaufstexte der M3 Supply Cards dieses Dashboards |

`supplies` ist die Brücke zwischen beiden Karten: was du bei einem Vorrat als
`shopping_item` hinterlegt hast, wird hier zum Chip — sortiert, sodass der
knappste Vorrat vorn steht. Was schon auf der Liste steht, fällt raus; es
würde nur die Dublettenwarnung auslösen.

### Bearbeiten

Ein Tap auf eine Zeile hakt sie ab. **Langes Drücken** öffnet sie zum
Umbenennen oder Löschen. Mit `reorderable: true` bekommt jede Zeile einen
Ziehgriff; das Umsortieren läuft über die Reihenfolge von Home Assistant
selbst, sofern das Backend sie unterstützt.

`group_by_category: true` gruppiert Einträge der Form `Kategorie: Artikel`
unter einer kleinen Überschrift und lässt das nun überflüssige Präfix in der
Zeile weg — aus „Obst: Äpfel" wird „Äpfel" unter der Überschrift „Obst".

| Option | Typ | Standard | Beschreibung |
|---|---|---|---|
| `entity` | string | – | Die `todo.*`-Liste (Pflicht) |
| `name` / `icon` | string | von der Entität | Name und Icon im Header |
| `add_position` | `top` \| `bottom` | `top` | Wo neue Einträge landen |
| `prevent_duplicates` | boolean | `true` | Vorhandenen Eintrag hervorheben statt doppelt anlegen |
| `quick_add_mode` | `none` \| `fixed` \| `recent` \| `supplies` | `none` | Quelle der Chips |
| `quick_add` | Liste | – | Chip-Einträge für `fixed` |
| `max_quick_add` | number | `4` | Höchstzahl der Chips |
| `show_completed` | boolean | `true` | Aufklappbereich für Erledigtes |
| `show_clear_completed` | boolean | `true` | „Erledigte löschen" anbieten |
| `group_by_category` | boolean | `false` | Nach `Kategorie:`-Präfix gruppieren |
| `reorderable` | boolean | `false` | Ziehgriff zum Umsortieren |
| `accent_color` | string | `#5dcaa5` | Akzent für Icon, Chip und Häkchen |
| `accent_opacity` | number | `18` | Stärke der Tönung |
| `text_color` / `secondary_text_color` | string | Theme-Standard | Name / Sekundärtext |
| `card_background` | string | Glas/Solid-Hintergrund | Kartenhintergrund |
| `animation` | `auto` \| `on` \| `off` | `auto` | Morph-Animationen |
| `glass_background` | boolean | `true` | Milchglas-Hintergrund |
| `radius` / `corners` | number / object | `28` | Eckenradius, optional je Ecke |

</details>
