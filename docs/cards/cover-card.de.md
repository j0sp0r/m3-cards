---
title: M3 Cover Card
type: m3-cover-card
category: light
display: Cover
summary: Rollläden/Jalousien, die sich den Gerätefähigkeiten anpassen, plus Gruppenmodus
table_order: 3
section_order: 24
---

Steuerung für `cover`-Entitäten, die sich dem Gerät anpasst: Sie liest
`supported_features` und rendert nur, was die Entität wirklich kann —
Auf/Stopp/Zu-Tasten, einen Positions-Slider mit Fenstervorschau und
Lamellen-Steuerung. Geräte ohne `cover`-Integration (z. B. ein FingerBot auf
zwei Schaltern) laufen über `entity_type: switch_pair`. Ein `group`-Modus
fasst mehrere Rollläden — oder Schalterpaare — mit Sammelsteuerung in einer
Karte zusammen.

<img src="docs/images/cover-card.png" alt="Cover Card" width="440">

<details>
<summary>Konfiguration, Beispiele & Optionen</summary>

```yaml
# Einzeln
type: custom:m3-cover-card
entity: cover.wohnzimmer

# Schalterpaar (Auf/Ab-Relais, z. B. FingerBot)
# type: custom:m3-cover-card
# entity_type: switch_pair
# up_entity: switch.jalousie_hoch
# down_entity: switch.jalousie_runter

# Gruppe
# type: custom:m3-cover-card
# mode: group
# entities:
#   - cover.wohnzimmer
#   - { entity_type: switch_pair, up_entity: switch.kueche_hoch, down_entity: switch.kueche_runter, name: Küche }
```

### Konfigurationsoptionen

| Option | Typ | Standard | Beschreibung |
| --- | --- | --- | --- |
| `mode` | `single` \| `group` | `single` | Ein Cover im Detail oder eine Liste |
| `entity` | string | – | Das Cover (Einzelmodus) |
| `entity_type` | `cover` \| `switch_pair` | `cover` | Auf/Ab/Stopp-Schalter statt Cover |
| `up_entity` / `down_entity` / `stop_entity` | string | – | Schalter für `switch_pair` |
| `entities` | Liste | – | Gruppenzeilen: Cover-ID oder `switch_pair`-Objekt |
| `show_preview` | boolean | `true` | Fenstervorschau mit Füllstand |
| `slider_style` | `plain` \| `wavy` | `plain` | Stil des Positions-Sliders |
| `invert_position` | boolean | `false` | Für Integrationen mit umgekehrter Position |
| `tilt_step` | number | `15` | Lamellen-Schrittweite (°) |
| `travel_time` | number | `0` | Sekunden für positionslose Geräte (optimistisches Feedback) |
| `show_master` | boolean | `true` | Sammelsteuerung im Gruppenmodus |
| `row_tap_action` | `more-info` \| `toggle` | `more-info` | Tippen auf eine Gruppenzeile |

> **Keine Cover-Integration?** Ein Home-Assistant-Template-Cover bündelt zwei
> Schalter zu einer `cover`-Entität und schaltet damit Position/Vorschau frei.

</details>
