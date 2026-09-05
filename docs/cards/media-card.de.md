---
title: M3 Media Card
type: m3-media-card
category: light
display: Media
summary: Media-Player mit Cover-Farben, Wellen-Slidern und Bibliotheks-Browser
table_order: 1
section_order: 16
---

Medienplayer-Karte mit kompakter Ansicht (aus/idle) und voller
Wiedergabe-Ansicht: Cover mit Farbextraktion für den Akzent, lokal
interpolierter Fortschritts-Wellen-Slider, Transportsteuerung
(feature-abhängig ein-/ausgeblendet), Lautstärke-Wellen-Slider,
Quellenauswahl und ein Browser für Bibliothek und Warteschlange des Players.

<img src="docs/images/media-card.png" alt="Media Card" width="440">

<details>
<summary>Konfiguration, Beispiele & Optionen</summary>

```yaml
type: custom:m3-media-card
entity: media_player.wohnzimmer
```

Die Wiedergabeposition wird clientseitig aus `media_position` +
`media_position_updated_at` hochgerechnet, damit der Fortschritt auch zwischen
den State-Updates des Players flüssig weiterläuft. Beim Pausieren ebbt die
Welle auf eine gerade Linie ab, der Balken trägt den Wiedergabezustand also
selbst; ein Stream ohne Dauer zeigt ein wanderndes Wellensegment und einen
**Live**-Chip statt einer Restzeit.

Transport-Buttons, Shuffle/Repeat, Spulen und die Bibliothek erscheinen nur,
wenn die Entity das jeweilige `supported_features` meldet. Das ist relevanter,
als es klingt: Ein Chromecast, der eine einzelne lokale Datei abspielt, meldet
weder `PREVIOUS_TRACK` noch `NEXT_TRACK` — diese Knöpfe fehlen dann zu Recht,
denn die Karte bietet keine Aktion an, die der Player ablehnen würde. Derselbe
Player über Spotify meldet sie, und dann sind sie da.

Player ganz ohne Metadaten (etwa ein Chromecast mit dem Default Media Receiver)
greifen auf den Dateipfad hinter `media_content_id` zurück: aus
`…/<Interpret>/<Album>/<Titel>.mp3` werden Interpret, Album und Titel. Echte
Metadaten haben immer Vorrang davor.

### Bibliothek und Warteschlange

Meldet der Player `BROWSE_MEDIA`, öffnet eine Zeile am Fuß der Karte den
Medienbrowser von Home Assistant: Breadcrumb-Navigation, je Zeile ein
Vorschaubild oder ein Icon nach `media_class`, Ordner zum Hineinnavigieren und
abspielbare Einträge, die per Tap starten. Liefert die Integration zusätzlich
eine Warteschlange, zeigt ein zweiter Reiter die kommenden Titel und die
eingeklappte Zeile liest sich als „Als Nächstes: …" statt „Bibliothek
durchsuchen". Integrationen ohne Warteschlange (darunter Cast und Spotify)
bekommen den Reiter gar nicht erst, statt ihn leer anzuzeigen.

Eine Ebene mit tausenden Einträgen wird bei 100 Zeilen gekappt, mit einem
Hinweis, tiefer zu navigieren — eine echte Bibliothek liefert hier 2147
Interpreten-Ordner auf einer Ebene, und alle zu rendern blockiert den Frame.

### Konfigurationsoptionen

| Option | Typ | Standard | Beschreibung |
|---|---|---|---|
| `entity` | string | – (erforderlich) | `media_player`-Entity |
| `name` | string | Freundlicher Name der Entity | Titel in der kompakten Ansicht |
| `show_source_select` | boolean | `false` | Quellenauswahl-Pills (falls von der Entity unterstützt) |
| `show_shuffle_repeat` | boolean | `false` | Shuffle-/Repeat-Buttons (falls unterstützt); Repeat läuft aus → alle → einer |
| `strip_track_number` | boolean | `true` | Führende Tracknummer aus dem Titel entfernen (`07 - Enjoy the Silence` → `Enjoy the Silence`). Auf ein bis zwei Ziffern begrenzt, damit `1979` und `365 Dreams` unangetastet bleiben |
| `time_display` | `remaining` \| `total` | `remaining` | Rechte Zeitangabe: Restzeit mit Minuszeichen oder Gesamtdauer |
| `meta_chips` | list | `[]` | Zusätzliche Chips neben Gerät und Quelle: `track`, `year`, `bitrate`. Jeder erscheint nur, wenn der Player das Attribut tatsächlich liefert — HA kennt kein Standardattribut für die Bitrate, die meisten Integrationen füllen diesen Chip also nie |
| `show_browser` | boolean | `true` | Bereich für Bibliothek/Warteschlange (erscheint ohnehin nur bei Playern mit `BROWSE_MEDIA`) |
| `default_tab` | `queue` \| `library` | `library` | Welcher Reiter zuerst offen ist, wenn es beide gibt |
| `browse_height` | number | `190` | Maximale Höhe der Liste in px |
| `use_artwork_color` | boolean | `true` | Akzentfarbe aus dem Cover extrahieren statt `accent_color` |
| `accent_color` | string | Lila (Media-Palette) | Fortschritts-/Lautstärkefarbe, falls `use_artwork_color: false` |
| `text_color` / `secondary_text_color` | string | Theme-Standard | Titel bzw. Interpret/Album |
| `card_background` | string | Glas-/Solid-Hintergrund | Kartenhintergrund |
| `animation` | `auto` \| `on` \| `off` | `auto` | Fortschritts-/Lautstärke-Animation; `auto`/`on` respektieren `prefers-reduced-motion` |
| `glass_background` | boolean | `true` | Milchiger Glashintergrund |
| `radius` / `corners` | number / object | `28` | Eckenradius, optional je Ecke |

</details>
