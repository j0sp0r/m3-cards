# Test-Matrix

Manuelle QA-Checkliste für die M3-Card-Suite. Es gibt keine automatisierten UI-Tests
(Lit-Komponenten mit `hass`/WebSocket-Abhängigkeiten lassen sich nur mit
unverhältnismäßigem Aufwand sinnvoll unit-testen) — vor jedem Release wird stattdessen
diese Liste live in einer echten Home-Assistant-Instanz durchgegangen.

`npx tsc --noEmit` und `npm run build` müssen davor beide sauber durchlaufen; das
ersetzt aber keinen manuellen Durchlauf, da beide nichts über Laufzeitverhalten,
WebSocket-Antworten oder visuelles Rendering aussagen.

## Kontrastprüfung

Zwei Prüfungen, die nicht am Auge hängen:

**`npm run test:contrast`** — Unit-Test für `src/shared/contrast.ts`. Reine
Funktionen ohne DOM, deshalb die einzige Ausnahme von „keine automatisierten
Tests". Prüft, dass jede Palettenfarbe ihr Ziel erreicht, dass der Farbton
dabei erhalten bleibt, und dass im dunklen Theme nichts angefasst wird.

**`test/contrast-audit.js`** — misst die *gerenderte* Seite. In die
Browser-Konsole eines Dashboards einfügen, dann:

```js
m3ContrastAudit({ gruppiert: true })   // Anzahl je Karte
m3ContrastAudit()                      // Einzelfunde, schlechtester zuerst
```

**Einmal je Theme ausführen und die beiden Listen vergleichen.** Das ist der
eigentliche Punkt: Eine Stelle, die nur in *einem* Theme auffällt, ist ein
Theme-Fehler. Eine, die in beiden auffällt, ist eine Gestaltungsentscheidung —
weiße Initialen auf dem Präsenz-Avatar und der gedämpfte „Unverändert"-Knopf
der Zeitkarte stehen dort dauerhaft und sollen so bleiben.

Stand 2.1.0: hell 3, dunkel 4, und alle drei hellen Funde stehen auch in der
dunklen Liste.

Warum als Datei und nicht als Konsolenschnipsel: Die Ad-hoc-Fassung hat sich an
einem Nachmittag zweimal geirrt — einmal maß sie den Hintergrund ab dem
*Elternelement* und übersah damit jedes Chip, das Tönung und Beschriftung
zugleich trägt (25 Funde sahen aus wie 0), einmal kannte ihr Parser die
`color(srgb …)`-Schreibweise nicht und übersprang getönte Flächen stillschweigend.
Beide Fehler ließen die Seite besser aussehen, als sie war.

## Voraussetzungen

- Eine HA-Testinstanz mit: mindestens einer `climate`-Entität, einem `light` mit
  `brightness`-Unterstützung, mehreren `sensor.battery`-artigen Entitäten (für
  Auto-Discovery), Energy-Dashboard-Konfiguration mit Solar/Grid/Battery-Quellen,
  sowie ein paar Power-Sensoren (`device_class: power`) für Power-List/Summary/
  Top-Consumers.
- Zugriff auf HA-Dev-Tools → Zustände (zum gezielten Setzen von `unavailable`/
  `unknown`) und auf die Browser-Konsole (für Fehler-Checks).
- Ein Handy oder ein per DevTools emuliertes Touch-Gerät für alle Drag-Interaktionen
  (Wave-Slider, Wischen) — Maus-Events allein decken `touch-action`-Konflikte nicht ab.

## Cross-Cutting-Checkliste (für jede der 40 Karten)

Diese Punkte gelten kartenübergreifend, weil sie über gemeinsame `shared/*`-Module
implementiert sind. Ein Fehlschlag hier betrifft potenziell alle Karten gleichzeitig.

| # | Test | Schritte | Erwartung |
|---|------|----------|-----------|
| C1 | Fehlende Entität | `entity` (bzw. `grid_entity` o. Ä.) auf eine nicht existierende Entity-ID setzen | Karte zeigt einen Platzhalter-Hinweis statt Absturz/leerer Fläche; keine Konsolenfehler |
| C2 | Entität `unavailable`/`unknown` | Betroffene Entität in Dev-Tools auf `unavailable` setzen | Karte zeigt „–“/gedimmten Zustand statt `NaN`, `undefined` oder falscher Zahl |
| C3 | Leere/minimale Config | Nur Pflichtfelder setzen, alles andere weglassen | Karte rendert mit sinnvollen Defaults, kein Crash |
| C4 | Legacy-Config-Migration | Alte Config mit `animations: true` (bzw. `false`) statt `animation` laden | Nach dem Laden: `animation` ist `"auto"`/`"off"`, `animations` ist entfernt, `card_version` ist gesetzt (per Konsole: `document.querySelector('...').constructor` → `_config` prüfen) |
| C5 | Sichtbarer Editor | Karte im Dashboard-Editor öffnen | Alle Abschnitte (inkl. „Erscheinungsbild“) klappen auf, keine leeren/kaputten `ha-form`-Felder |
| C6 | Editor-Live-Update | Im Editor einen Wert ändern (z. B. Name, Farbe) | Kartenvorschau aktualisiert sich sofort, ohne Reload |
| C7 | Eckenradius-Presets | Editor → Erscheinungsbild → Radius-Preset wechseln (Standard/Eckig/Rund/Benutzerdefiniert) | Kartenform ändert sich sichtbar; bei „Benutzerdefiniert“ erscheinen 4 Eckenfelder |
| C8 | Glass/Solid-Hintergrund | `glass_background: false` setzen | Karte wechselt von transparent/geblurrt zu solidem `card-background-color` |
| C9 | Tastatur-Fokus | Mit der Maus wegklicken, dann Tab drücken, bis die Karte erreicht ist | Sichtbarer Fokusring auf jedem klickbaren Element (Header, Zeilen, Buttons) |
| C10 | Tastatur-Aktivierung | Auf einem fokussierten klickbaren Element Enter bzw. Leertaste drücken | Löst dieselbe Aktion wie ein Klick aus (i. d. R. More-Info-Dialog) |
| C11 | `prefers-reduced-motion` | Chrome DevTools → Rendering → „Emulate CSS prefers-reduced-motion: reduce“ aktivieren, Karte neu laden | Keine Wachstums-/Wellen-/Rotations-Animationen; Werte erscheinen sofort in Endposition |
| C12 | `animation: "off"` | In der Config explizit `animation: "off"` setzen (ohne Reduced-Motion) | Gleiches Verhalten wie C11 |
| C13 | Sprachumschaltung | HA-Profil-Sprache zwischen Deutsch und Englisch wechseln | Alle Karten-Texte (inkl. Editor-Labels) wechseln vollständig, keine deutschen Reste im Englischen oder umgekehrt |
| C14 | Grid-Optionen (Sections-Dashboard) | Karte auf einem Sections-Dashboard platzieren, Größe ändern | Karte skaliert sinnvoll, `getGridOptions` liefert plausible Min/Max-Werte |
| C15 | Konsole sauber | Nach jedem der obigen Schritte | `read_console_messages`/DevTools zeigen keine Fehler mit `m3-cards.js` als Quelle |
| C16 | Jinja2-Template in einem Feld | `name: "{{ states('sensor.x') }}"` (o. ä. Textfeld) setzen, dann `sensor.x` in den Dev-Tools ändern | Feld zeigt den gerenderten Wert und aktualisiert sich beim Zustandswechsel ohne Reload; kein Abo-Aufbau bei jedem State-Tick (Netzwerk-Tab: eine `render_template`-Nachricht pro unterschiedlichem Template) |
| C17 | Template in verschachtelter Karte | In `cards:` (bzw. Popup-Inhalt) eine `custom:mushroom-template-card` mit eigenem Template legen | Die innere Karte rendert ihr Template weiterhin selbst und folgt ihrem Sensor — der Wert friert nicht auf dem Stand beim Laden ein |
| C18 | Karte ohne Templates | Beliebige Karte ohne `{{`/`{%` in der Config laden | Verhalten unverändert; im Netzwerk-Tab kein `render_template` für diese Karte |

## M3 Climate Card

| Test | Schritte | Erwartung |
|---|---|---|
| HVAC-Modi | Jeden verfügbaren Modus-Pill antippen | `climate.set_hvac_mode` wird korrekt aufgerufen, Pill-Farbe wechselt |
| Zieltemperatur | Plus/Minus antippen, danach direkt auf die Anzeige tippen | Stepper ändert Temperatur in `target_temp_step`-Schritten; Tippen auf die Anzeige öffnet More-Info |
| Presets (Pill-Style) | `preset_style: "pill"`, Preset wechseln | Zusätzlicher Pill erscheint, Klick zyklet durch `preset_modes` |
| Presets (Chip-Style) | `preset_style: "chip"` | Chip statt Pill, gleiche Funktion |
| Sensor-Chips | `show_sensors: true`, externe `temperature_sensor`/`humidity_sensor` konfigurieren | Chips zeigen externen statt internen Wert |
| Temp-Chip-Platzierung | `temperature_chip_placement: "header"` vs. `"info_row"` | Chip wandert sichtbar zwischen Header und Info-Zeile |
| Batterie-Warnchip | `battery_sensor` unter `battery_threshold` setzen | Warn-Chip erscheint im Header |
| `hidden_modes` | Einen Modus in `hidden_modes` eintragen, der aber in `hvac_modes` der Entität steckt | Pill für diesen Modus wird nicht gerendert |
| `unavailable_style: "hidden"` | Entität auf `unavailable`, Style auf `hidden` | Karte verschwindet komplett (kein leeres Gerüst) |
| Mode-Farben-Override | `mode_colors.heat` auf eigene Farbe setzen | Pill/Header-Akzent für „heat“ übernimmt die Farbe |

## M3 Climate Card Mini

| Test | Schritte | Erwartung |
|---|---|---|
| Power-Button | Antippen bei `off`/aktivem Modus | Schaltet zwischen `off` und letztem aktiven Modus, Radius morpht rund↔eckig |
| Icon/Text-Klick | Auf Icon-Swatch bzw. Namens-Block tippen | Öffnet More-Info (nicht den Power-Toggle) |
| Stepper | Plus/Minus/Wert-Anzeige antippen | Wie bei der großen Karte; Wert-Anzeige öffnet More-Info |
| Kompaktes Layout | Karte auf sehr schmaler Spaltenbreite (Handy) platzieren | Kein Text-Overflow, Buttons bleiben antippbar (min. 40×40px) |

## M3 Button Card

| Test | Schritte | Erwartung |
|---|---|---|
| Tap/Hold/Double-Tap-Actions | Alle drei `*_action`-Varianten konfigurieren (z. B. `toggle`, `more-info`, `navigate`) | Jede Geste löst die konfigurierte Aktion aus, keine Überschneidung |
| Icon-Tap-Action separat | `icon_tap_action` abweichend von `tap_action` setzen | Klick auf das Icon löst die eigene Aktion aus, Klick auf die restliche Karte die Haupt-Aktion |
| Slider-Modus | `show_slider: true` an einem `light`/`cover` mit Helligkeit/Position | Ziehen auf der Karte ändert den Wert live (optimistisch), `touch-action: none` verhindert Seiten-Scroll beim Wischen auf dem Handy |
| `state_colors` | Für einen benutzerdefinierten State (z. B. `media_player`-State) Farbe setzen | Icon-Hintergrund übernimmt die State-spezifische Farbe |
| `invert_colors` | Aktivieren bei einem `off`-Zustand | Aktiv-/Inaktiv-Farblogik dreht sich sichtbar um |
| Vertikales Layout | `vertical: true` | Icon über Text statt daneben, zentriert |
| Nested-ARIA-Grenzfall | Screenreader/Tab-Test bei aktivem `icon_tap_action` | Icon-Bereich ist bewusst *nicht* separat fokussierbar (vermeidet verschachtelte `role="button"`); Haupt-Tap-Ziel bleibt vollständig erreichbar |

## M3 Progress Card

| Test | Schritte | Erwartung |
|---|---|---|
| Status-Übergänge | Entität durch `running_states`/`preparing_states`/`done_states` durchschalten | Wellenfarbe/Text wechseln passend zum Status |
| `percentage_entity` getrennt von `entity` | Separate Prozent-Quelle konfigurieren | Fortschritt folgt der separaten Entität, Status weiter der Haupt-Entität |
| `hide_when_ready` | Status auf „ready“, Option aktiv | Karte blendet sich aus (Grid-Size 0) statt leer zu bleiben |
| `wave_style: "flat"` | Umschalten | Keine Wellenanimation, gerader Balken |
| Reduced-Motion-Sonderfall | `_reducedMotion` per OS/Browser aktivieren bei `wave_style: "wavy"` | Welle wird trotzdem flach gerendert (eigene Prüfung, nicht nur `shouldAnimate`) |

## M3 Energy Card

| Test | Schritte | Erwartung |
|---|---|---|
| `mode: consumption`, `period: day/hour/month` | Alle drei Perioden durchklicken | Balken, Achsenbeschriftung und Summen wechseln korrekt; keine hängenden Ladezustände |
| `mode: solar` | Mit `forecast_entity` | Balken zeigen Ist-Werte + gestrichelten Forecast-Rest korrekt übereinander |
| History-Fallback | Eine Entität ohne Long-Term-Statistics verwenden | Karte lädt trotzdem (über History-API), keine Fehlermeldung |
| Monats-Hochrechnung | `period: month`, `show_projection: true` | Hochrechnung erscheint plausibel (nicht negativ/riesig) |
| Vergleichs-Chip | `show_comparison: true`, `higher_is_better` in beide Richtungen testen | Farbe (besser/schlechter) und Pfeilrichtung stimmen zur Einstellung |
| Balken-Tap | Auf einen einzelnen Balken tippen | Value-Bubble mit exaktem Wert erscheint über dem Balken |
| Lade-Zustand | Periode wechseln, währenddessen beobachten | `.bars-row.loading`-Dimmung kurz sichtbar, dann normale Deckkraft |

## M3 Gauge Card

| Test | Schritte | Erwartung |
|---|---|---|
| `source: energy` | Mit Energy-Dashboard-Grid-Import/Export | A/B-Segmente summieren sich korrekt zu 100 % |
| `source: entities` | Zwei beliebige `sensor`-Entitäten mit unterschiedlichen Einheiten | Angezeigte Einheit folgt der tatsächlichen Entity-Einheit, kein hartkodiertes „kWh“ |
| Eine Entität `unavailable` | Nur `value_a_entity` auf `unavailable` | Segment A zeigt 0 statt Absturz, B bleibt korrekt |
| Lerp-Animation | Wert live ändern (Dev-Tools → Zustand setzen) | Zeiger/Segmente gleiten sanft zum neuen Wert statt zu springen |

## M3 Energy Flow Card

| Test | Schritte | Erwartung |
|---|---|---|
| `source: energy` vs. `entities` | Beide Quellmodi konfigurieren | Gleiches Diagramm-Layout, Werte stimmen mit der jeweiligen Quelle überein |
| `show_battery: "auto"` | Mit und ohne konfigurierte Batterie testen | Batterie-Knoten erscheint nur, wenn eine Battery-Quelle vorhanden ist |
| Flow-Punkte-Animation | Reduced-Motion aktivieren | Punkte-Animation (`.flow-dots`) wird komplett weggelassen (nicht nur pausiert) |
| `flow_speed` | `slow`/`normal`/`fast` durchschalten | Sichtbar unterschiedliche Punktgeschwindigkeit |
| Autarkie-Balken | `show_self_sufficiency: true` bei 0 % und 100 % Grenzfällen | Balkenbreite clamped korrekt auf 0–100 %, kein Überlauf |

## M3 Counter Card

| Test | Schritte | Erwartung |
|---|---|---|
| Ziffern-Roll-Animation | Entitätswert live ändern | Betroffene Ziffern rollen einzeln, unveränderte Ziffern bleiben stehen |
| `digits: "auto"` vs. fest | Beide testen mit unterschiedlich langen Werten | „auto“ passt Ziffernanzahl dynamisch an, fester Wert schneidet/padded konsistent |
| Leistungs-Chip + Schwellwerte | `power_entity` + `power_thresholds` mit mehreren Stufen | Chip-Farbe wechselt an den konfigurierten Schwellen |
| Ticker | `daily_entity` + `show_ticker: true` | „+X heute“-Zeile erscheint, Format nutzt korrekte Einheit |
| Reduced-Motion | Aktivieren, Wert ändern | Ziffern springen direkt zum neuen Wert, keine Roll-Animation |

## M3 Power List Card

| Test | Schritte | Erwartung |
|---|---|---|
| Auto-Discovery | `auto_discover: true` ohne `entities` | Alle passenden `power`-Sensoren erscheinen, sortiert nach `sort` |
| `include_area`/`include_label`/`exclude_entities` | Je einzeln testen | Filterung greift korrekt, ausgeschlossene Entität bleibt versteckt (auch im „mehr anzeigen“) |
| Erzeuger vs. Verbraucher | Eine Entität als `type: "producer"` markieren | Eigene Sektion/Farbe, wird nicht mit Verbrauchern vermischt |
| `threshold` + Idle-Toggle | Werte unter Threshold + `show_idle_toggle: true` | „N weitere“-Button klappt versteckte Zeilen mit FLIP-Animation auf/zu |
| `max_visible` | Mit mehr Entitäten als `max_visible` | Nur die Top-N sichtbar, Rest hinter Toggle |
| Manuelle Entity-Reihenfolge | `sort: "config"` mit expliziter `entities`-Liste | Zeilenreihenfolge entspricht exakt der Config-Reihenfolge |

## M3 Power Summary Card

| Test | Schritte | Erwartung |
|---|---|---|
| `grid_sign: "negative_is_export"` vs. `"positive_is_export"` | Beide mit demselben Sensor testen | Import/Export-Anzeige bleibt inhaltlich korrekt trotz invertiertem Vorzeichen |
| `consumption_entity` fehlt | Weglassen | Verbrauch wird aus `grid_import + solar` berechnet, kein Fehler |
| Split-Bar | `show_split_bar: true` bei Netzbezug 0 kW | Balken zeigt sinnvollen Leerzustand, nicht NaN-Breite |
| Metrik-Klick | Auf eine `metrics`-Kachel tippen | Öffnet More-Info der zugehörigen Entität |
| Autarkie bei Export | Zeitpunkt mit Solarüberschuss/Export | Autarkie-Anzeige zeigt 100 % bzw. sinnvollen Wert, kein negativer Prozentwert |

## M3 Top Consumers Card

| Test | Schritte | Erwartung |
|---|---|---|
| Zeiträume | `today`/`yesterday`/`week`/`month` durchklicken | Ranking und Summen aktualisieren sich korrekt pro Zeitraum |
| `rest_mode: "collapse"` | Mehr Geräte als `top_count` | „N weitere“-Button mit FLIP-Animation beim Auf-/Zuklappen |
| `unit_mode: "cost"` | Mit `price_source` konfiguriert | Ranking sortiert nach Kosten statt kWh, Währungsformat korrekt |
| `name_strip` | Entitätsnamen mit Suffix wie „ Steckdose“ | Suffix wird im Zeilennamen entfernt |
| Statistics-Cache | Zwei Top-Consumers-Karten mit identischer Config auf einem Dashboard | Nur eine WS-Anfrage im Netzwerk-Tab pro Zeitfenster (Cache-Dedup), beide Karten zeigen trotzdem korrekte Daten |

## M3 Cost Card

| Test | Schritte | Erwartung |
|---|---|---|
| `price_source: energy_dashboard/input_number/fixed` | Alle drei testen | Jede Quelle liefert einen plausiblen Tarif-Wert in der Tarif-Zeile |
| `price_entity` auf `unavailable` | Bei `price_source: "input_number"` | Tarif-Zeile zeigt „–“, **nicht** „NaN“ |
| Perioden-Navigation | Vor/Zurück-Buttons am Rand des verfügbaren Zeitraums | „Weiter“-Button deaktiviert sich korrekt an der Gegenwart (`atPresent`) |
| Budget-Überschreitung | `budget` unter den erwarteten Monatswert setzen | Hochrechnung/Anzeige markiert Budget-Überschreitung visuell |
| Balken-Tap | Einzelnen Tagesbalken antippen | Value-Bubble mit Betrag + Währungssymbol erscheint |
| `period: "day"` | Umschalten | Balkendiagramm wird ausgeblendet (`showBars = false`), nur Tageswert sichtbar |

## M3 Light Card

| Test | Schritte | Erwartung |
|---|---|---|
| Wave-Slider Drag (Maus) | Mit der Maus auf dem Slider ziehen | Helligkeit folgt optimistisch, `light.turn_on` mit `brightness_pct` wird gedrosselt (~200 ms) aufgerufen |
| Wave-Slider Drag (Touch, echtes Handy) | Auf dem Handy in HA öffnen, auf dem Slider vertikal wischen | Kein Seiten-Scroll während des Ziehens (`touch-action: none` greift) |
| Tastatur-Steuerung | Slider fokussieren, Pfeiltasten / Shift+Pfeiltasten | ±5 % bzw. ±1 % Helligkeit pro Tastendruck |
| Power-Button | Bei `on`/`off` antippen | Schaltet Licht, Button-Radius morpht |
| Ohne Helligkeitsunterstützung | Entität ohne `brightness` in `supported_color_modes` | Wave-Slider wird nicht gerendert, nur Header + Power-Button |
| Entität `unavailable` während Drag | Während des Ziehens Entität extern auf `unavailable` setzen | Kein Absturz, Drag-Session bricht sauber ab |
| Helligkeit nur einmal im Bild | Eingeschaltete Lampe ansehen, dann am Regler ziehen | Die Prozentangabe steht **ausschließlich** unter dem Namen und folgt dem Ziehen; am Reglergriff steht keine zweite |

## M3 Battery Card

| Test | Schritte | Erwartung |
|---|---|---|
| Auto-Discovery-Anzahl | `auto_discover: true`, Konsole/Editor prüfen | Anzahl gefundener Batterie-Entities plausibel (`device_class: battery` + `%`-Sensoren) |
| Namens-Override in Auto-Discover-Modus | `entities: [{entity: ..., name: "Custom"}]` **zusätzlich zu** `auto_discover: true` | Eintrag wirkt als Override (Name/Icon), ersetzt nicht die automatische Liste |
| `name_strip` | Entität mit „ Battery Level“-Suffix | Suffix verschwindet aus der Zeilenbeschriftung |
| Stufenfarben | Werte in critical/low/medium/ok-Bereiche verschieben | Balkenfarbe und Textfarbe wechseln an den `thresholds`-Grenzen |
| Sortierung | Mehrere Entitäten mit unterschiedlichen Werten + eine `unavailable` | `unavailable` immer zuerst, danach aufsteigend nach Wert |
| `max_visible` + Erweitern-Button | Mehr Entitäten als `max_visible` | „N weitere anzeigen“/„Einklappen“ toggelt kompakte Zusatzzeilen mit FLIP-Animation |
| Manuelle Ausschlüsse | `exclude_entities` mit einer Entity-ID aus der Auto-Discovery | Diese Entität erscheint nirgends, auch nicht hinter dem Erweitern-Button |

## M3 Media Card

| Test | Schritte | Erwartung |
|---|---|---|
| Feature-Erkennung | Player ohne `PREVIOUS_TRACK`/`NEXT_TRACK` (Chromecast mit lokaler Datei) gegen einen mit (derselbe Player über Spotify) | Fehlende Knöpfe fehlen ganz, kein ausgegrauter Platzhalter; über Spotify erscheinen sie |
| Play/Pause-Morph | Zwischen Wiedergabe und Pause umschalten | Fläche morpht Kreis ↔ Squircle, Symbol blendet über, kein Layout-Sprung |
| Ohne Pause-Feature | Player, der nur `STOP` meldet | Stopp-Symbol statt Pause, Aufruf geht an `media_stop` |
| Repeat dreistufig | Repeat mehrfach tippen | aus → alle → einer → aus, bei „einer" das `repeat-once`-Symbol |
| Fortschrittswelle | Wiedergabe pausieren | Welle ebbt animiert auf eine gerade Linie ab, springt nicht |
| Live-Stream | Radio-Stream ohne `media_duration` | Wanderndes Wellensegment, „Live"-Chip statt Restzeit |
| Restzeit | `time_display` umschalten | `remaining` zeigt `-2:21`, `total` die Gesamtdauer |
| Spulen | Auf dem Fortschritt ziehen | Zeitangabe links folgt dem Griff, nicht dem Player; höchstens ein `media_seek` je 200 ms |
| Ohne Metadaten | Chromecast mit lokaler Datei (Default Media Receiver) | Interpret/Album/Titel aus dem Pfad abgeleitet, Interpret nicht doppelt im Titel |
| Tracknummer | Titel `07 - Enjoy the Silence` und `365 Dreams - My Way` | Erster gekürzt, zweiter unangetastet |
| Cover-Farbe | Dunkles Cover mit kleinem farbigem Motiv | Akzent nimmt die Motivfarbe an, Symbol auf gefüllter Fläche bleibt lesbar |
| Ohne Cover | Player ohne `entity_picture` | Verlaufsfläche mit Album-/Noten-Symbol, keine leere Kachel |
| Bibliothek | Zeile aufklappen, zwei Ebenen tief navigieren, Breadcrumb zurück | Skeletons beim Laden, Breadcrumb stimmt, Zurück funktioniert |
| Bibliothek: große Ebene | Ordner mit >100 Einträgen öffnen | 100 Zeilen plus Hinweis „… und N weitere", Oberfläche bleibt flüssig |
| Bibliothek: abspielen | Abspielbaren Eintrag antippen | Wiedergabe startet, Karte übernimmt den neuen Titel |
| Warteschlange | Player mit und ohne Queue | Mit: zweiter Reiter und „Als Nächstes: …"; ohne: kein leerer Reiter, Zeile liest „Bibliothek durchsuchen" |
| `show_browser: false` | Option setzen | Bereich verschwindet vollständig |

## M3 Weather Card

| Test | Schritte | Erwartung |
|---|---|---|
| Vorhersagearten | Entität nur mit täglicher bzw. nur mit stündlicher Vorhersage | Kurve rendert oder fällt sauber weg, kein leerer Bereich |
| Sonnenmarker | `sun.sun` beobachten | Auf-/Untergangsmarker sitzen an der richtigen Stelle der Zeitachse |
| Niederschlagsbalken | Vorhersage ohne Niederschlagsdaten | Balkenreihe entfällt, Kurve bleibt |

## M3 Presence Card

| Test | Schritte | Erwartung |
|---|---|---|
| Auto-Discovery | Ohne `entities` konfigurieren | Alle `person`-Entitäten erscheinen |
| Ohne Bild | Person ohne `entity_picture` | Initialen statt Avatar |
| Kartenintegration | `show_map: true` | Karte lädt, keine Konsolenfehler bei fehlenden Koordinaten |

## M3 Climate Overview Card

| Test | Schritte | Erwartung |
|---|---|---|
| Bereichserkennung | `auto_discover: true` ohne Räume | Räume aus HA-Bereichen, Temperatur und Feuchte je Raum |
| Raum ohne Feuchtesensor | Raum mit nur Temperatur | Feuchtewert entfällt, Zeile bleibt intakt |
| Trend | Verlauf abwarten | Trendpfeil erscheint erst mit ausreichend Historie |

## M3 Aquarium Card

| Test | Schritte | Erwartung |
|---|---|---|
| Fehlende Slots | Nur `water_temperature_entity` gesetzt | Übrige Kacheln entfallen, kein Platzhalter mit „–" |
| Kamera | `camera_entity` gesetzt, Banner aufklappen | Bild lädt, Aufklappanimation ruckelt nicht |
| Reinigungsintervall | Datum in Vergangenheit und Zukunft | Fälligkeit korrekt, Zustandsfarbe wechselt |

## M3 Updates Card

| Test | Schritte | Erwartung |
|---|---|---|
| Ohne Updates | Alle `update.*` auf „aktuell" | Ruhezustand statt leerer Liste |
| Installation | Update auslösen | Knopf morpht in den Busy-Zustand, Fortschritt sichtbar |
| Backup-Warnung | Letztes Backup älter als `backup_warn_days` | Warnhinweis erscheint |

## M3 NAS Card

| Test | Schritte | Erwartung |
|---|---|---|
| Offline | NAS-Entitäten auf `unavailable` | Offline-Zustand nach `offline_minutes`, keine `NaN`-Werte |
| Schwellwerte | Disk-/Temperaturwerte über Warn- und Kritisch-Schwelle | Farbwechsel an beiden Schwellen |

## M3 System Card

| Test | Schritte | Erwartung |
|---|---|---|
| Reines Rendering | Karte platzieren | Rendert ohne `hass`-Zustand, keine Konsolenfehler |

## M3 Supply Card

| Test | Schritte | Erwartung |
|---|---|---|
| Hero-Wechsel | Zeile antippen | Angetippter Vorrat wird zum Hero, Animation sauber |
| Punkte vs. Balken | Vorrat unter und über 40 Einheiten | Unter 40 ein Punkt je Einheit, darüber ein Balken |
| Stepper-Wiederholung | +/- gedrückt halten | Wert läuft weiter, stoppt beim Loslassen |
| Nachfüllen | „Packung nachgefüllt" antippen | Zähler springt um die Packungsgröße |

## M3 Todo Card

| Test | Schritte | Erwartung |
|---|---|---|
| Hinzufügen | Eintrag oben und unten (`add_position`) | Landet an der konfigurierten Stelle |
| Duplikat | Vorhandenen Eintrag erneut eingeben | Bestehender Eintrag pulst, keine zweite Zeile |
| Abhaken | Häkchen antippen | Morph vom Ring zum gefüllten Squircle |
| Schnellwahl-Chips | Quelle auf Supply-Karten stellen | Knappster Vorrat zuerst als Chip |
| Umbenennen/Löschen | Zeile lange drücken | Dialog erscheint, beide Aktionen wirken |

## M3 Time Card

| Test | Schritte | Erwartung |
|---|---|---|
| Darstellungsvarianten | Stepper und Scroll-Räder durchschalten | Beide bedienbar, gleicher Wert |
| Rad-Drag vs. Swipe | Auf einem Dashboard mit Swipe-Plugin am Rad ziehen | Ansicht wechselt nicht |
| 12-Stunden-Format | HA-Locale auf 12h stellen | AM/PM korrekt, ARIA-Bereich passend |
| Übernehmen-Knopf | Sichtbarkeit umschalten | Wert wird sofort bzw. erst beim Übernehmen geschrieben |

## M3 Occupancy Card

| Test | Schritte | Erwartung |
|---|---|---|
| Auto-Discovery | Ohne Sensorliste | Räume aus HA-Bereichen, „X von Y Räumen belegt" |
| Zeitleiste | Sensor auslösen | Streifen aktualisiert sich ohne Wartezeit auf den Minutentakt |
| „belegt seit" | Sensor länger als eine Stunde aktiv | Wechsel von Minuten- auf Stundenangabe |

## M3 Cover Card

| Test | Schritte | Erwartung |
|---|---|---|
| Fähigkeiten | Cover mit Position, mit Lamellen, nur Auf/Zu | Nur die tatsächlich unterstützten Bedienelemente |
| `switch_pair` | FingerBot-artiges Paar ohne Rückmeldung | Tastenfeedback zeigt den ausgelösten Befehl |
| Gruppenmodus | Mehrere Zeilen, davon eine `switch_pair` | Jede Zeile eigenständig bedienbar |
| Drag | Position ziehen | Höchstens ein Aufruf je 200 ms, Wert setzt sich nach dem Loslassen |

## M3 Leak Card

| Test | Schritte | Erwartung |
|---|---|---|
| Alarm | Feuchtesensor auf `on` | Lauter Alarmzustand, Karte hebt sich ab |
| Veraltet | Sensor lange ohne Update | „veraltet"-Zustand statt fälschlich „OK" |
| Absperren | Mit `confirm_shutoff` zweimal tippen | Erster Tap schärft, zweiter löst aus; nach 4 s wieder entschärft |
| Absperr-Domänen | `valve`, `switch` und `cover` als Absperrentität | Jeweils korrekter Dienstaufruf |

## M3 Waste Card

| Test | Schritte | Erwartung |
|---|---|---|
| Hero | Sensor mit 0, 1 und mehreren Tagen | „nächste Abfuhr in N Tagen" korrekt, heute als Sonderfall |
| Mehrere Tonnen am selben Tag | Zwei Sensoren mit gleichem Tag | Hero zeigt „N Tonnen" mit Mehrfach-Icon |
| Zeitleiste | Zwei Wochen Vorschau | Marker an den richtigen Tagen |

## M3 Clock Card

Reine Anzeigekarte — sie liest keine Entität, nur die optionalen Extras tun das.

- [ ] Alle fünf Stile rendern: `tiles`, `shapes`, `lockscreen`, `scallop`, `ring`
- [ ] **Sichtbarkeit:** Karte aus dem Sichtbereich scrollen und in den
      Entwicklerwerkzeugen prüfen, dass keine Frames mehr laufen. Wieder
      hereinscrollen — die Uhr springt sofort auf die aktuelle Zeit, statt dort
      weiterzulaufen, wo sie stehengeblieben ist.
- [ ] **Takt:** Ohne Sekunden und ohne Formbewegung darf kein
      `requestAnimationFrame` mehr laufen; die Karte wacht nur zur vollen Minute auf.
- [ ] Minutenwechsel: bei `tiles` rollt **nur** die Kachel, die sich ändert;
      bei `shapes` poppt nur die geänderte Ziffer
- [ ] Stundenwechsel: `15:59 → 16:00` — die führende „1" bleibt stehen
- [ ] `ring` mit `ring_animation: drain`: beim Umlauf leeren sich die Segmente
      **rückwärts**, nicht alle gleichzeitig
- [ ] `ring` mit `show_seconds: false` wird zum Stundenring (ein Segment je Minute)
- [ ] `animation: off` und Systemeinstellung „Bewegung reduzieren": Formen
      **stehen still, verschwinden aber nicht**
- [ ] Zeitzone: gültige IANA-Zone wirkt; unsinnige Zone fällt auf Systemzeit
      zurück, ohne die Karte zu zerstören
- [ ] 12-Stunden-Format: führende Null der Stunde entfällt, AM/PM-Chip erscheint
- [ ] Karte schmaler als 240 px: Kacheln und Schriftgrößen schrumpfen
- [ ] **Masonry-Ansicht:** alle fünf Stile rendern mit Höhe > 0
- [ ] Editor: Sektion „Formen" nur bei shapes/lockscreen/scallop, „Kacheln" nur
      bei tiles, `ring_animation` nur bei ring
- [ ] Editor: Zeitzonenfeld leeren → die Option verschwindet aus der Konfiguration
      (statt als leerer String gespeichert zu werden)
- [ ] Extras: Sonnen-Chip zeigt Untergang, solange die Sonne steht, sonst Aufgang
- [ ] Extras: `progress_range: custom` mit `08:00`/`17:00` rechnet gegen diesen
      Bereich, nicht gegen den ganzen Tag

## M3 Status Card

Die Zuordnung ist der eigentliche Prüfgegenstand, nicht das Layout.

- [ ] Alle vier Layouts rendern: `auto` (Hero bei einem, Raster ab zwei),
      `hero`, `grid`, `row`
- [ ] **Regelreihenfolge:** eigene `states` gewinnen vor der `preset`-Liste;
      innerhalb der Liste gewinnt die erste passende Regel
- [ ] Regel ganz ohne Bedingung fängt alles ab — als letzter Eintrag gedacht,
      als erster Eintrag verdeckt sie absichtlich alles danach
- [ ] Kaputter regulärer Ausdruck (z. B. `[` im Editor halb getippt) zerstört
      die Karte nicht, die Regel greift einfach nicht
- [ ] `above`/`below` gegen einen nicht-numerischen Zustand greifen nicht,
      statt auf `NaN` hereinzufallen
- [ ] Vorlagen sprechen die Sprache des Dashboards (`yes_no` → „Ja"/„Yes"),
      eine selbst gesetzte `label` bleibt dagegen wörtlich stehen
- [ ] Getroffene Regel mit `label`: die Einheit verschwindet („Ja kWh" ist
      falsch), ein eigenes `suffix` bleibt stehen
- [ ] **Optimistischer Tap:** `tap_action: toggle` schaltet die Anzeige sofort
      um. Entität anschließend absichtlich unerreichbar machen — die Anzeige
      fällt nach 2,5 s auf den echten Zustand zurück, statt hängen zu bleiben
- [ ] Nicht verfügbare Entität: „—", alles auf 0.4 gedimmt, **neutrale** Farbe
      statt der grünen des letzten guten Werts
- [ ] Fehlendes `attribute`: verhält sich wie nicht verfügbar
- [ ] `value_size: auto` stuft herunter: Zahl 40 px, kurzer Text 34 px, ab 12
      Zeichen 26 px; Karte schmaler als 200 px eine Stufe tiefer und Raster
      einspaltig
- [ ] Trend: `trend_inverted` dreht die Farbe, nicht die Pfeilrichtung; unter
      1 % Änderung steht „unverändert" statt „+0 %"
- [ ] Trend ohne Verlaufsdaten (frisch angelegte Entität): kein Chip, keine
      Fehlermeldung
- [ ] Beide Themes mit `test/contrast-audit.js` prüfen — der Wert im Hero sitzt
      auf der **getönten** Karte, nicht auf der Kartenfarbe

## M3 Heading Card

Die Karte zeichnet keine Karte — geprüft wird, dass sie sich trotzdem sauber
in das Raster einfügt und das Einklappen nichts kaputt macht.

- [ ] Alle vier Varianten rendern: `simple`, `status`, `divider`, `collapsible`
- [ ] Kein Rahmen, kein Glas, kein Schatten — die Überschrift schwebt zwischen
      den Karten, statt wie eine weitere Kachel zu wirken
- [ ] `show_icon: false` rückt den Titel an den linken Rand
- [ ] Sehr langer Titel: Ellipsis, vollständiger Text im `title`-Attribut
- [ ] Karte schmaler als 260 px: der Aktions-Button behält nur sein Icon
- [ ] **Zähler:** `count_entities` mit einer nicht verfügbaren Entität — sie
      zählt weder als an noch als aus, der Chip zeigt die verbleibende Zahl
- [ ] Aktions-Button: nach dem Tap morphen die Ecken und die Tönung hebt sich
      für eine halbe Sekunde (die einzige Rückmeldung, die er geben kann)
- [ ] **Einklappen:** genau die Karten bis zur nächsten Überschrift
      verschwinden; die nächste Überschrift und alles darunter bleiben stehen
- [ ] Zwei aufklappbare Überschriften in einem Abschnitt: jede besitzt nur
      ihren eigenen Block
- [ ] Reload: der Zustand bleibt (localStorage), mit `collapse_state_entity`
      auch auf einem zweiten Gerät
- [ ] `collapse_state_entity` zeigt auf eine nicht verfügbare Entität: es gilt
      `default_collapsed`, nicht stillschweigend „ausgeklappt"
- [ ] **Bearbeitungsmodus:** im Dashboard-Editor wird nicht eingeklappt, sonst
      wären ausgeblendete Karten nicht mehr erreichbar
- [ ] Eingeklappte Überschrift löschen: die ausgeblendeten Karten kommen zurück
      (kein `display: none` bleibt zurück)
- [ ] Masonry-Ansicht: erkennt die Karte das Layout nicht, fällt sie still auf
      `simple` zurück — kein Pfeil, der nichts tut
- [ ] Beide Themes prüfen: die Karte sitzt auf dem **Ansichts**-Hintergrund,
      nicht auf einer Kartenfläche; der Trennstrich mischt aus der Textfarbe
      und muss in beiden Themes sichtbar sein

## M3 Room Card

Die Erkennung ist der Prüfgegenstand — was die Karte anzeigt, hat sie selbst
gefunden.

- [ ] **Rauschfilter:** In einem Raum mit vielen Zigbee-Geräten enthält die
      Schalter-Kachel nur echte Schalter, keine Kindersicherungen und
      Status-LEDs (Entitäten mit `entity_category`)
- [ ] Bereich ohne erkennbare Geräte: nur Header und Chips, dazu der Hinweis —
      keine leeren Kacheln
- [ ] Neues Gerät im Bereich: die Kachel erscheint ohne Reload der Karte
      (Registry-Änderung lässt den Tick durch)
- [ ] Badge bei mehreren Geräten `{an}/{gesamt}`, bei genau einem der konkrete
      Zustand — Lüfterstufe, Zieltemperatur, Medientitel, Rollo-Position
- [ ] Kategorie, in der **jede** Entität nicht verfügbar ist: Badge „—",
      gedimmt auf 0.4, kein `role="button"`, kein Tap möglich
- [ ] Kategorie mit teilweise nicht verfügbaren Entitäten: der Tap schaltet
      **nur** die erreichbaren; der Nenner im Badge bleibt die Gesamtzahl
- [ ] **Geräteauswahl:** Kachel mit mehreren Geräten öffnet beim Tap die Liste;
      ein Tap auf eine Zeile schaltet **nur** dieses Gerät
- [ ] In der Liste: nicht verfügbare Zeilen sind gedimmt und nicht antippbar,
      das Info-Icon öffnet die Detailansicht statt zu schalten
- [ ] „Alles aus" / „Alle an" wirken auf alle erreichbaren Geräte der Kategorie
- [ ] Liste schließt per Escape, per Klick auf den Hintergrund und per X —
      **mit** Ausblende-Animation, die Karte darunter bleibt bedienbar
- [ ] Zeilen laufen gestaffelt ein (26 ms Abstand), verlassen die Bühne aber
      gemeinsam; bei `animation: off` erscheint alles ohne Bewegung
- [ ] `badge`-Modus je Kategorie: `count` zählt immer, `state` zeigt immer den
      Zustand, `none` lässt die Zeile weg (nicht nur leer — sie fehlt)
- [ ] `category_tap: toggle` überspringt die Liste; eine Kachel mit genau einem
      Gerät schaltet immer direkt
- [ ] **Abgewählte Geräte** (`excluded_entities`) verschwinden aus der Kachel,
      aus dem Nenner im Badge und aus allem, was die Kachel schaltet
- [ ] Editor: die Geräteliste zeigt auch die abgewählten Geräte — sonst ließen
      sie sich nicht zurückholen
- [ ] Sauger und Schloss: der Tap öffnet die Detailansicht statt zu schalten
- [ ] Langer Druck öffnet `detail_path`, ohne dass beim Loslassen zusätzlich
      geschaltet wird
- [ ] Präsenz: Punkt pulsiert, Karte bekommt die Färbung, Untertitel „belegt · …"
- [ ] `presence_style: dot_only` — Punkt bleibt, Färbung weg; `none` — beides weg
- [ ] `animation: off` und „Bewegung reduzieren": der Punkt bleibt stehen,
      verschwindet aber nicht
- [ ] Temperatur-/Feuchte-Chip: eine in den HA-Bereichseinstellungen gesetzte
      Entität gewinnt gegen die device_class-Suche
- [ ] Verbrauchs-Chip erscheint erst über `power_threshold`
- [ ] Fenster-Chip: erscheint auch bei „alles zu"; bernstein mit Anzahl, sobald
      etwas offen ist; fehlt ganz, wenn der Bereich keinen solchen Sensor hat
- [ ] Fenstersensoren ohne Bereichszuordnung werden **nicht** erkannt —
      `window_entities` ist dafür da
- [ ] Kachel mit genau einem Gerät trägt dessen Namen, nicht die Gattung; der
      Raumname ist herausgestrichen, auch wenn er hinten oder in der Mitte steht
- [ ] Gerät, das genau wie der Raum heißt: die Kachel fällt auf den
      Kategorienamen zurück statt den Raumnamen zu wiederholen
- [ ] `strip_area_name` ist **aus** per Default — der Gerätename steht so da,
      wie er in HA heißt; die Beschriftung je Kachel überschreibt ihn immer
- [ ] `collapsible`: Pfeil in der Kopfzeile, Antippen der ganzen Kopfzeile
      klappt zusammen; der Untertitel bleibt sichtbar
- [ ] Eingeklappt bleibt kein toter Streifen unter der Kopfzeile stehen
- [ ] Zustand übersteht einen Reload; mit `collapse_state_entity` auch auf
      einem zweiten Gerät, und eine Automatisierung kann ihn setzen
- [ ] `animation: off`: klappt ohne Übergang, aber vollständig
- [ ] **Während** des Einklappens: die Sensor-Chips bleiben stehen, wo sie sind —
      kein Sprung nach oben in den ersten Frames
- [ ] Karte in einem Hintergrund-Tab einklappen, dann zurückwechseln: sie ist
      eingeklappt (ein gedrosselter Übergang friert sonst auf dem Startwert ein)
- [ ] Editor: die Kategorieliste zeigt genau die im Bereich erkannten Domains
      mit ihrer Anzahl; Auf/Ab schreibt `category_order`
- [ ] Editor: eine Kategorie-Überschreibung, die nur noch `domain` enthält,
      verschwindet wieder aus der Konfiguration
- [ ] Beide Themes mit `test/contrast-audit.js` prüfen — aktive Kacheln tragen
      Tinte auf einer Volltonfläche, inaktive auf einer neutralen Tönung

## M3 Climate Overview — Thermostat-Tap

- [ ] Ohne `tile_tap_action`: ein Tap öffnet wie bisher den Sensordialog
- [ ] `tile_tap_action: thermostat`: der Tap öffnet das Thermostat des Raums,
      das sich in der Karte bedienen lässt
- [ ] Raum ohne auffindbares Thermostat: fällt auf den Verlauf zurück, der Tap
      läuft **nicht** ins Leere
- [ ] Über das Gerät gruppierter Raum (ohne Bereich): ein Thermostat, das am
      selben Gerät hängt wie der Temperatursensor, wird gefunden
- [ ] Raum ohne Bereich, dessen Thermostat an einem **anderen** Gerät hängt:
      findet nichts automatisch, `climate_entity` je Raum ist dafür da
- [ ] `climate_entity` sticht beide Automatiken
- [ ] Schließen per X und per Klick auf den Hintergrund, mit Ausblenden
- [ ] Das X quittiert den Druck (Radius-Morph) und dreht sich beim Schließen
      eine Vierteldrehung mit heraus — in beiden Blättern gleich
- [ ] `animation: off`: öffnet und schließt ohne Übergang

## M3 Leak Card — Liste kürzen

- [ ] `max_visible: 3` zeigt drei Sensoren plus „N weitere anzeigen"; der
      Umschalter klappt auf und wieder zu
- [ ] Ohne `max_visible` (oder 0) stehen alle Sensoren da wie bisher
- [ ] **Im Alarmfall** greift die Begrenzung nicht — alle Sensoren sind ohne
      zweiten Tap sichtbar
- [ ] Mit `collapse_ok` zusammen: erst öffnet sich die OK-Liste, darin gilt
      dann die Begrenzung; beide Umschalter sind unabhängig
- [ ] Weniger Sensoren als `max_visible`: kein Umschalter

## Touch-Feedback (alle Karten)

- [ ] **Auf einem Touchgerät** eine Kachel, Zeile oder Kopfzeile gedrückt
      halten: es erscheint **kein** graues Rechteck über dem Element. Die
      Rückmeldung ist der Radius-Morph, sonst nichts
- [ ] Besonders dort prüfen, wo ein antippbares Element bis an eine gerundete
      Kartenkante reicht — dort trat es zuerst auf (Kopfzeile der Raumkarte)

## M3 Humidifier Card

Der Prüfaufbau steht auf `m3-neu` und läuft absichtlich **ohne** humidifier-Entität:
`input_boolean.m3_entfeuchter`, `input_number.m3_ziel`, `input_select.m3_modus`,
`input_select.m3_luefter`, `input_number.m3_tank`, `input_boolean.m3_ionisator`.
Genau das ist der Fall, für den die Karte offen gebaut ist.

- [ ] Regler ziehen: der Zielwert folgt sofort, `input_number.m3_ziel` zieht
      gedrosselt nach (~200 ms), der Endwert kommt beim Loslassen an
- [ ] Pfeiltasten auf dem fokussierten Regler: ±1 %, mit Shift ±5 %
- [ ] Welle animiert nur, solange das Gerät läuft; bei „Aus" flacht sie ab
- [ ] Modus-Pillen: Tap schaltet `input_select.m3_modus` wirklich um, die
      aktive Pille morpht auf Radius 15 und volle Modusfarbe
- [ ] „Aus"-Pille schaltet das Gerät aus, ohne einen Modus zu setzen
- [ ] Lüfterstufen: Balken-Icon füllt sich mit der Stufe, Tap schaltet
      `input_select.m3_luefter`
- [ ] Chips: Ionisator schaltet und morpht, Tank wird ab 70 % orange und ab
      95 % rot mit Text „Tank voll"
- [ ] Bei vollem Tank erscheint die Hinweiszeile „Tank leeren – Gerät pausiert"
- [ ] `layout: [slider, modes]` lässt Lüfterzeile und Chips wirklich weg
- [ ] Karte schmaler als 320 px: Modus-Pillen fallen auf reine Icons zurück
- [ ] Hauptentität auf `unavailable`: alles gedimmt, nichts bedienbar
- [ ] Mit einer echten `humidifier`-Entität (falls vorhanden): Modi kommen aus
      `available_modes`, Bereich aus `min_humidity`/`max_humidity`

## M3 Calendar Card

Prüfaufbau auf `m3-neu` mit `calendar.m3_testkalender` (angelegt für den Test),
`calendar.workday_sensor_kalender` und einem absichtlich **nicht erreichbaren**
dritten Kalender.

- [ ] Agenda: Gruppierung nach Tagen, „Heute" in Akzentfarbe, dann „Morgen",
      dann Wochentagsnamen
- [ ] Ein laufender Termin ist getönt und trägt das **Jetzt**-Abzeichen
- [ ] Ein ganztägiger Termin zeigt „GANZTÄGIG" und trägt **nie** das Abzeichen
- [ ] Vergangene Termine sind blass; mit `hide_past_today: true` verschwinden
      die von heute ganz
- [ ] Mehrtägiger Termin erscheint an jedem Tag mit „Tag 2 von 3"
- [ ] Zeitspalte bricht nicht um — besonders im 12-Stunden-Format („10:30 AM")
- [ ] Nicht erreichbarer Kalender: Hinweiszeile erscheint, die anderen liefern
      trotzdem
- [ ] `max_events`: Liste wird gekürzt, „+n weitere" steht am Ende
- [ ] Leerer Zeitraum: „Keine Termine in den nächsten n Tagen"
- [ ] Monatsraster: Wochenstart folgt `hass.locale.first_weekday`
- [ ] Bis zu drei Punkte je Tag, der dritte wird zum „+" bei mehr Terminen
- [ ] Heute getönt; ein angetippter Tag füllt sich und listet darunter
- [ ] Monatswechsel lädt nach; Tap auf den Monatsnamen springt zurück auf heute
- [ ] Tap auf einen Termin öffnet das Detailfenster; X und Hintergrund schließen
- [ ] Umschalter Agenda/Monat morpht; `show_view_switch: false` blendet ihn aus
- [ ] Beim Verlassen des Sichtbereichs hört der Minutentakt auf (VisibleTicker)

| Füllung hinter dem Icon | `icon_fill: solid` an einer eingeschalteten Entität | Die Fläche trägt die Akzentfarbe, die Glyphe wird dunkel. Mit `tint` (Standard) umgekehrt: zarte Fläche, farbige Glyphe |
| Icon je Zustand | `icon: mdi:power-plug` mit `icon_off: mdi:power-plug-off`, dann schalten | Aus zeigt das durchgestrichene Symbol, An das normale. Ohne `icon_off` bleibt es in beiden Zuständen dasselbe |
| Formwechsel legt den ganzen Weg zurück | Beim Schalten den Umriss beobachten | Die Ecken wandern gleichmäßig über die volle Dauer. Sie dürfen nicht fast stillstehen und am Ende umklappen — das passierte, solange der Aus-Radius eine große Zahl statt der tatsächlichen halben Kachelhöhe war |
| Beide Formen im Gleichschritt | Beim Schalten genau hinsehen | Icon-Feld und Kachelumriss verändern sich gemeinsam; die innere Form darf nicht früher fertig sein als die äußere |
| Feste Farbe blockiert den Zustand nicht | `static_color: true` zusammen mit `icon_off` und `shape_by_state` an einer eingeschalteten Entität | Farben bleiben unverändert, Icon und Form folgen aber dem Zustand — die Kachel darf nicht als ausgeschaltet erscheinen |
| Form auf flacher Kachel | `shape_by_state` auf einer Kachel mit `grid_options.rows: 1` | Beide Zustände sind unterscheidbar. Der Standardradius von 28px wäre auf 56px Höhe schon eine Kapsel gewesen und hätte im An genauso ausgesehen wie im Aus |
| Form folgt dem Zustand | `shape_by_state: true` an einer Steckdose, dann schalten | An: Kachel eckig (Standardradius), Icon auf abgerundetem Quadrat. Aus: Kachel als Kapsel, Icon rund. Der Wechsel wird weich animiert |
| Form ohne Animation | Dasselbe mit `animation: off` | Die beiden Formen stimmen weiterhin, der Wechsel springt aber ohne Übergang |
| Form abgeschaltet | Ohne `shape_by_state` | Der Eckenradius bleibt in beiden Zuständen der konfigurierte, das Icon bleibt rund |

| Themefarbe je Karte | In einem beliebigen Karten-Editor den Palettenknopf neben einem Farbfeld drücken | Das Feld steht auf `primary`, der Knopf ist markiert, die Karte trägt den Themeton. Nochmal drücken leert das Feld und stellt die Kartenfarbe wieder her |
| Raumkarte: Karten nebeneinander | `cards_columns` auf 1 und auf 2 | Eine bzw. zwei Karten je Zeile |
| Raumkarte: Karten im Editor | Im Editor Entitäten über „Entitäten als Kacheln hinzufügen" wählen | Für jede entsteht eine Kachel. Reihenfolge über die Pfeile, Entfernen im aufgeklappten Eintrag |
| Raumkarte: voller Karten-Editor | Einen Eintrag aufklappen | Der komplette Editor **dieser** Karte erscheint — bei einer Button-Kachel also auch Zustandsfarben, invertierte Farben und alles Weitere, nicht nur eine Auswahl |
| Raumkarte: gemischte Typen | Eine Button- und eine Licht-Kachel eintragen | Jeder Eintrag zeigt den Editor seines eigenen Kartentyps |
| Raumkarte: Schreiben trifft nur eine | In einem Eintrag etwas ändern | Nur diese Karte ändert sich; die übrigen und die Einstellungen der Raumkarte selbst bleiben unberührt |
| Raumkarte: Tipp-Aktion je Kachel | Einen Eintrag aufklappen und `tap_action` auf „Info anzeigen" stellen | Nur diese Kachel öffnet die Details statt zu schalten; die übrigen bleiben unverändert |
| Raumkarte: Kategorien im manuellen Modus | `mode: manual` und den Editor öffnen | Der Bereich „Kategorien" fehlt — er konfiguriert Kacheln, die in diesem Modus niemand zeichnet |
| Raumkarte: Scrollen ohne Animationen | `scroll_on_expand: true` zusammen mit `animation: off` | Die Karte springt ohne Übergang ins Sichtfeld — der Weg ohne Animation darf das Scrollen nicht überspringen |
| Raumkarte: Scrollen unter der Leiste | Mit angedockter Nav-Leiste eine Karte am unteren Rand aufklappen | Die letzte Zeile der Karte steht **über** der Leiste, nicht darunter. Das Scrollen läuft gleichzeitig mit dem Aufklappen, nicht danach |
| Raumkarte: ins Sichtfeld holen | `scroll_on_expand: true`, eingeklappte Karte am unteren Bildrand aufklappen | Die Seite scrollt nach dem Aufklappen so weit, dass die Karte ganz sichtbar ist. Eine bereits vollständig sichtbare Karte darf sich **nicht** bewegen |
| Raumkarte: Kontakte trennen | Einen Kontakt in `door_entities` eintragen | Er erscheint als eigener Chip mit Tür-Symbol und wird **nicht** mehr bei den Fenstern gezählt |
| Raumkarte: keine Doppelzählung | Denselben Kontakt in `window_entities` **und** `door_entities` | Er zählt nur bei den Türen |
| Raumkarte: Leistung summieren | Mehrere Leistungssensoren über den Wähler eintragen | Ein Chip mit der Summe. Nicht verfügbare Messwerte werden übersprungen, nicht als 0 gezählt |
| Raumkarte: Summe schlägt Einzelsensor | `power_entities` gesetzt, dazu ein Leistungssensor im Bereich | Die Summe gewinnt; der zufällig gefundene Einzelsensor wird nicht mehr angezeigt |
| Raumkarte: eigene Karten | `cards:` mit zwei `custom:m3-button-card` füllen | Beide erscheinen im aufklappbaren Bereich, zeigen echte Zustände und lassen sich bedienen — das beweist, dass `hass` bei ihnen ankommt |
| Raumkarte: manueller Modus | `mode: manual` | Keine automatisch erkannten Kacheln mehr, nur die eigenen Karten. Ohne `cards` steht dort ein Hinweis statt einer leeren Fläche |
| Raumkarte: beides zusammen | `mode: auto` **und** `cards:` | Erkannte Kacheln oben, eigene Karten darunter |

## M3 Lights Overview Card

Die Karte entdeckt selbst und hat zwei Filter, die leicht verwechselt werden:
einer entscheidet, was ein Raum **zeigt**, der andere, was ein Tippen
**schaltet**. Die meisten Fallen liegen dort.

| Test | Schritte | Erwartung |
|---|---|---|
| Erkennung | `auto_discover: true`, sonst nichts | Räume mit Lichtern erscheinen, jeder mit Name aus dem Bereich; Lichter ohne Bereich tauchen **nicht** als eigener Raum auf |
| Kopfzeile zählt richtig | Alle Lichter aus, dann eines anschalten | Die Kopfzeile zählt Räume **mit eingeschaltetem Licht**, nicht alle Räume — bei allem aus steht dort 0 |
| Zwei Ansichten | `view` auf `rooms` und `entities` | Einmal eine Kachel je Raum, einmal eine je Licht; in `entities` zeigt `show_area` den Bereich unter dem Namen |
| Sortierung | `sort` auf `name`, `area`, `on_first` | Bei `on_first` stehen eingeschaltete Lichter oben und rutschen beim Ausschalten nach unten |
| Anzeigen ≠ Schalten | `toggle_filter` enger als der Anzeigefilter setzen | Der Raum zeigt weiterhin alle Lichter, ein Tippen schaltet aber nur die des `toggle_filter` |
| Gruppen nicht doppelt | Eine `light.group` und ihre Mitglieder im selben Bereich, `group_handling` auf `prefer_groups` bzw. `prefer_members` | Einmal zählt nur die Gruppe, einmal nur die Mitglieder — nie beide |
| Zustand wirkt sofort | Ein Licht per Schalter außerhalb der Karte anschalten | Kachel färbt sich sofort um; die Erkennung läuft dabei **nicht** neu (Zustände sind bewusst nicht Teil des Erkennungsschlüssels) |
| Steckdosen als Licht | `include_domains: [light, switch]`, dann mit `include_entities` eingrenzen — oder die Entitäten je Raum unter `rooms` aufzählen | Die Steckdose erscheint in ihrer Raumkachel, zeigt ihren Zustand und **schaltet beim Tippen wirklich** (der Aufruf geht an `homeassistant`, nicht an `light`) |
| Popup | `popup` konfigurieren, eine Raumkachel antippen | Popup zeigt nur diesen Raum; Tippen darin öffnet **kein** zweites Popup |
| Leerer Zustand | Filter so setzen, dass nichts übrig bleibt | Hinweistext statt leerem Raster |

## M3 Chip Buttons Card

| Test | Schritte | Erwartung |
|---|---|---|
| Umbruch statt Scrollen | Mehr Pillen als in eine Zeile passen, Karte schmal machen | Die Reihe bricht um; sie scrollt **nicht** waagerecht |
| Zustandsfarbe | `use_entity_color: true` an einer farbigen Lampe | Pille nimmt die Farbe der Entität, nicht die aus `color` |
| Feste Farbe | `static_color: true` | Pille bleibt „aktiv" eingefärbt, auch wenn die Entität aus ist |
| Nur Anzeige | `interactive: false` | Kein Tipp-Feedback, kein Zeiger, keine Button-Rolle für Screenreader |
| Zustandstext | `show_state: true` | Zustand steht neben dem Namen und aktualisiert sich live |
| Ohne Entität | Pille nur mit `name` und `icon` | Rendert als Beschriftung, wirft nichts |

## M3 Group Card

| Test | Schritte | Erwartung |
|---|---|---|
| Eine Fläche | Zwei Karten in `cards` legen | Beide sitzen auf **einer** Fläche mit einer Rundung — keine zwei Kacheln mit Lücke |
| Abstand | `gap` auf 0 und auf 16 | Karten liegen aneinander bzw. deutlich getrennt, die äußere Fläche bleibt eine |
| Zustände kommen an | Eine interaktive Karte (z. B. Light-Card) einsetzen und bedienen | Sie reagiert und zeigt aktuelle Werte — beweist, dass `hass` an die Kindkarten weitergereicht wird |
| Kaputte Kindkarte | Eine Karte mit ungültigem `type` eintragen | HA's eigene Fehlerkarte erscheint an ihrer Stelle; die übrigen Karten rendern weiter |
| Leere Gruppe | `cards: []` | Karte rendert leer statt zu werfen |

## M3 Search Card

Die Karte ruft Dialoge des Frontends über dessen eigene Tastenkürzel auf.
Alles Interessante steckt darin, ob dieser Weg noch trägt — Testen also bitte
in der aktuellen HA-Version und mindestens einmal auf einem echten Telefon.

| Test | Schritte | Erwartung |
|---|---|---|
| Minimalkonfiguration | Nur `type: custom:m3-search-card` | Pille mit Lupe, Platzhaltertext und Assist-Knopf; ein Tipp öffnet die Entitätssuche |
| Befehlsmodus | `mode: command` als Administrator | Die Befehls-Schnellsuche öffnet sich, nicht die Entitätssuche |
| Ohne Admin-Rechte | `mode: command` mit einem Nicht-Admin-Konto | Ein Tipp öffnet die Entitätssuche statt gar nichts zu tun; der Editor weist darauf hin |
| Tastenkürzel aus | Profil → Tastenkürzel abschalten, Dashboard neu laden | Leiste ist blass, `aria-disabled="true"`, Tooltip erklärt es; kein Tipp öffnet etwas |
| Assist fehlt | Instanz ohne `conversation` | Kein Assist-Knopf — statt eines Knopfes, der nichts tut |
| Assist | Assist-Knopf antippen | Der Sprachdialog öffnet sich, nicht die Suche |
| Schmaler Bildschirm | Auf dem Telefon, wo die Kopfzeile keinen Such-Knopf zeichnet | Die Karte ist der einzige Weg zur Suche und funktioniert |
| Tastatur | Mit Tab auf die Leiste, dann Enter, dann Leertaste | Beide öffnen den Dialog; der Fokusring ist sichtbar; der Assist-Knopf ist ein eigenes Tab-Ziel |
| Tap-Aktion | `tap_action: {action: navigate, ...}` setzen | Es wird navigiert; die Suche öffnet **nicht** zusätzlich |
| Markierter Text | Text auf der Seite markieren, dann die Leiste antippen | Der Dialog öffnet trotzdem — die Auswahl wird vorher aufgehoben, sonst blockiert das Frontend jedes Kürzel |
| Druck-Feedback | Finger auf der Leiste halten | Die Ecken ziehen sich zusammen und federn zurück; mit `animation: off` und bei reduzierter Bewegung passiert nichts |
| Kontrast | In hellem und dunklem Theme, mit und ohne `accent_color` | Platzhalter und Icons bleiben lesbar |

## M3 Nav Card

Die Karte ist Navigations-Chrome statt Datenkachel: sie positioniert sich gegen
den Bildschirm, hängt an der URL und hört auf Gesten. Entsprechend liegen die
Fallen woanders als bei den übrigen Karten.

| Test | Schritte | Erwartung |
|---|---|---|
| Vier statische Varianten | `style` nacheinander auf `header`, `footer`, `segmented`, `floating` | `header`/`footer` kleben an der jeweiligen Kante über die volle Breite; `floating` schwebt mit 8px Abstand; `segmented` bleibt eine Pille im Kartenfluss und scrollt mit |
| Aktiver Eintrag | Zwischen den konfigurierten Seiten navigieren | Genau der Eintrag der aktuellen Seite ist eingefärbt; eine Unterseite (`/lovelace/garten/detail`) hält den Eintrag `/lovelace/garten` aktiv |
| Kein Aufblitzen beim Wechsel | Mehrfach zwischen benachbarten Seiten wechseln und die Leiste beobachten | Zu keinem Zeitpunkt ist kurz ein anderer Eintrag umrandet, auch nicht für einen Frame |
| Rückkehr auf eine besuchte Seite | Von A nach B wechseln, dann zurück auf A — mehrfach, und die Leiste dabei filmen | Die Markierung steht sofort auf A. Sie darf **nicht** von B nach A gleiten: die zwischengespeicherte Ansicht kommt mit der Markierung auf B zurück, und die Korrektur muss ohne Übergang passieren |
| Wisch-Plugin blättert nicht mit | Mit installiertem `hass-swipe-navigation` auf dem Handy: erst irgendwo auf der Seite wischen, dann einen Eintrag der Leiste antippen | Es wird nur die angetippte Seite geöffnet. Kein kurzes Aufblitzen der Nachbarseite, die das Plugin aus der vorherigen Wischgeste errechnet hätte |
| Aktiver Eintrag nach Rückkehr | Auf Seite A, dann B, dann über die Leiste zurück auf A — nicht neu laden | Die Markierung steht sofort auf A. Sie blieb einen Schritt zurück, solange die Karte aus dem Ansichts-Cache mit ihrem alten Pfad zurückkam |
| Regex-Override | `match` auf einem Eintrag setzen, das nicht zur `path` passt | Aktiv-Zustand folgt dem Regex; ein kaputtes Muster macht den Eintrag nie aktiv, wirft aber nichts |
| Template live | In zwei Browser-Tabs öffnen, in Tab A den Zustand einer im Template gelesenen Entität ändern | In Tab B ändert sich Name/Icon/Badge **ohne Reload** — das beweist das Abo statt eines einmaligen Renderns |
| Template-Abos schließen | Karte aus der Ansicht löschen, Netzwerk-Tab beobachten | Keine weiteren `render_template`-Nachrichten für diese Karte |
| Badge-Quellen | Je einmal `template`, `entity`, `count_entities` | Zeigt Text/Zustand/Anzahl; bei 0, `off`, leer, `unavailable` verschwindet der Badge ganz |
| Badge-Darstellung | `badge_style` auf `dot`, `count`, `text` | Punkt ohne Text, Zahl, freier Text — jeweils an der Ecke des Icons |
| Umschaltpunkt | Karte in eine schmale Dashboard-**Spalte** legen (nicht das Fenster verkleinern) | Mobil-Layout greift; das beweist die ResizeObserver-Messung statt einer Media Query |
| Beschriftungen | `label_visibility` auf `always`, `active_only`, `never` | Alle, nur am aktiven Eintrag, keine |
| Tap/Hold/Doppeltipp | Alle drei Aktionen auf einem Eintrag setzen | Jede löst genau einmal aus; ein Tipp ohne konfigurierte Doppeltipp-Aktion fühlt sich **nicht** verzögert an |
| Haptik | Auf dem Handy in der Companion-App tippen | Kurze Vibration; mit `haptics: false` keine |
| Ausblenden beim Scrollen | `auto_hide_on_scroll: true`, lange Ansicht scrollen | Leiste fährt beim Runterscrollen weg und beim Hochscrollen zurück |
| Untermenü öffnen | Eintrag mit `submenu` antippen | Menü wächst aus dem Knopf heraus; schließt bei Auswahl, Klick daneben und Escape |
| Untermenü am Rand | Denselben Eintrag ganz links und ganz rechts platzieren | Menü bleibt vollständig im Bild, statt über den Rand zu laufen |
| Untermenü per Halten | `submenu_trigger: hold` | Tipp navigiert, langes Drücken öffnet das Menü |
| Untermenü mit Tastatur | Menü öffnen, Tab drücken | Fokus erreicht die Menüzeilen; Escape schließt |
| Sheet: Tippen | `style: sheet`, auf den Griff tippen | Schublade fährt auf und zu |
| Sheet: Inhalt | `sheet_cards` mit einer **interaktiven** Karte füllen (z. B. Light-Card) | Karte rendert, reagiert auf Bedienung und zeigt aktuelle Zustände — beweist, dass `hass` weitergereicht wird |
| Sheet: Ziehen | Am Griff auf und ab ziehen | Schublade folgt dem Finger ohne Nachlauf |
| Sheet: Schwung | Schnell nach oben bzw. unten schnippen, aus halber Position | Öffnet bzw. schließt ganz, unabhängig von der Position beim Loslassen |
| Sheet: Rastpunkte | `snap_points: [0, 0.5, 1]`, langsam auf halbe Höhe ziehen und loslassen | Rastet auf halber Höhe ein |
| **Sheet: Scroll-Konflikt** | Schublade mit mehr Inhalt füllen, als hineinpasst. Dann: (a) mitten im Inhalt nach unten ziehen, (b) Inhalt ganz nach oben scrollen und weiter nach unten ziehen | (a) der Inhalt scrollt, das Sheet bewegt sich **nicht**; (b) das Sheet folgt dem Finger |
| Abstand einstellen | `edge_distance` auf 0 und auf 40 stellen | Leiste klebt am Rand bzw. schwebt deutlich höher. Auch bei 0 bleibt der Platz für die Gestenleiste erhalten |
| Abstand zur Bildschirmkante | `floating` auf einem Handy mit Gestensteuerung in der Companion-App | Die Leiste sitzt über dem Gestenbalken, nicht darauf. Im Android-WebView ist `env(safe-area-inset-bottom)` 0 — nur Home Assistants `--safe-area-inset-bottom` kennt den echten Wert |
| Aktiver Eintrag außer Sicht | Leiste mit mehr Einträgen als Platz (`max_width: fit`), auf den letzten Eintrag navigieren | Die Leiste scrollt den aktiven Eintrag von selbst ins Bild. Beim Scrollen von Hand darf sie **nicht** zurückspringen, auch wenn ein Badge-Template währenddessen aktualisiert |
| Scrollen bleibt ruhig | Zwischen zwei benachbarten Einträgen wechseln, die beide sichtbar sind | Die Leiste bewegt sich **gar nicht**, nur die Markierung wechselt den Platz |
| Leiste über Seiten hinweg | Ganz nach rechts scrollen, auf den letzten Eintrag wechseln, dann auf den vorletzten | Die Leiste steht auf jeder Seite dort, wo sie auf der vorigen stand; nur die Markierung wechselt. Kein Zurückspringen nach links, keine Animation |
| `fit` begrenzt wirklich | `max_width: fit` auf einem breiten Fenster | Die Leiste ist so breit wie ihre Einträge und mittig, **nicht** über die volle Breite mit auseinandergezogenen Einträgen |
| `fit` neben dem runden Knopf | Dasselbe mit `action_button` | Leiste und Knopf stehen zusammen in der Mitte; die Leiste dehnt sich nicht bis zum Knopf |
| Angedockt trotz `fit` | `header`/`footer` mit `max_width: fit` | Die Glasfläche geht über die volle Breite, nur die Einträge rücken zusammen — keine sichtbare Kante links und rechts der Einträge |
| Angedockt über die volle Breite | `header`/`footer` am Desktop, Karte in einer schmalen Spalte einer Sections-Ansicht | Die Glasfläche geht über den ganzen Inhaltsbereich, nicht nur über die Spalte, in der die Karte steckt |
| Angedockt bis an den Rand | `header` bzw. `footer` auf dem Handy | Die Leiste reicht links und rechts bis an den Bildschirmrand. Am Desktop mit ausgeklappter Seitenleiste beginnt sie weiterhin neben dieser, nicht darunter |
| Form der aktiven Pille | `label_position: right`, aktiven Eintrag ansehen | Die Pille ist eine Kapsel — die Enden sind vollständig rund, nicht abgeflacht. Das Icon sitzt ohne eigenen Kasten direkt darauf, links und rechts gleich viel Luft |
| Farbe folgt dem Theme | Ohne `accent_color` unter einem Material-You-Theme | Die Markierung trägt den Themeton (`--primary-color`), kein festes Blau. Mit `accent_color` gilt weiterhin die eigene Farbe |
| Größe der Markierung | `pill_size` auf 0,8 und auf 1,4 | Nur die Markierung wird kleiner bzw. größer; Icon- und Textgröße bleiben unverändert. Wirkt bei den gestapelten Varianten auf die Fläche ums Icon, bei waagerechtem Text auf den ganzen Eintrag |
| Kacheln und Markierung | `item_background: true`, einmal mit gestapelter Variante (`footer`/`floating`), einmal mit `header` | Die graue Kachel eines nicht gewählten Eintrags hat genau dieselbe Größe und denselben Radius wie die Markierung des gewählten — bei den gestapelten Varianten sitzen beide auf dem Icon, bei `header` beide auf dem Eintrag |
| Markierung ohne Text | Eine Leiste nur mit Icons (`label_visibility: never`) | Die Markierung ist eine liegende Kapsel wie bei den Leisten mit Text — **kein** Kreis um das Icon |
| Textgröße neben dem Icon | `label_position: right` und einmal ohne, einmal mit `label_size` | Neben dem Icon steht der Text auf 14px statt 11px; `label_size` überschreibt beides. Unter dem Icon bleibt es bei 11px |
| Markierung gleitet | `marker_motion: slide`, zwischen zwei Einträgen wechseln | Eine einzelne Fläche wandert sichtbar hinüber. Sie deckt den aktiven Eintrag danach exakt, auch wenn dieser durch sein Icon breiter wird |
| Markierung beim Ankommen | Mit `slide` eine Seite direkt über die URL aufrufen | Die Markierung steht sofort richtig und gleitet **nicht** von irgendwo herein |
| Seitenübergang | `page_transition: fade`, Eintrag antippen | Die alte Seite blendet weich in die neue über. In einem Browser ohne View-Transitions wechselt sie wie bisher, ohne Fehler |
| Einschweben | `page_transition: up` zwischen zwei ähnlich aussehenden Seiten | Die alte Seite blendet zuerst aus, dann steigt die neue leicht von unten ein. Kein gleichzeitiges Ineinanderblenden — genau das macht den Wechsel zwischen zwei Seiten mit gleichem Hintergrund überhaupt sichtbar |
| Dauer des Übergangs | `page_transition_ms` auf 80 und auf 500 | Sichtbar schneller bzw. träger. Ohne Angabe sind es 180 ms, nicht die 250 ms des Browsers |
| Übergang nur beim Navigieren | Mit `fade` einen Eintrag mit `toggle`-Aktion antippen | Kein Überblenden — nur Navigationen bekommen einen Seitenwechsel |
| Textposition | `label_position` auf `below`, `above`, `right`, `left` | Text sitzt unter, über, rechts bzw. links vom Icon. Bei `right`/`left` umschließt die aktive Pille **Icon und Text** zusammen, nicht nur das Icon |
| Umgekehrte Sichtbarkeit | `icon_visibility: inactive_only` mit `label_visibility: active_only` | Die aktive Seite zeigt nur Text, alle anderen nur ihr Icon |
| Knopf an- und abschalten | Im Editor unter Darstellung den Schalter „Runden Knopf neben der Leiste zeigen“ umlegen | Aus: Knopf und Menüfelder verschwinden, `action_button` ist aus der Konfiguration entfernt. An: der Knopf ist sofort da, mit einem Lupensymbol als Startwert |
| Knopf-Menü | `action_button.menu` mit drei Einträgen | Antippen lässt die Pillen nacheinander aufsteigen, der Knopf wird zum X, der Hintergrund dunkelt ab. Schließen per X, Tipp daneben, Escape oder Auswahl — die Pillen klappen in umgekehrter Reihenfolge zurück |
| Knopf ohne Menü | `action_button` ohne `menu` | Führt wie bisher direkt seine `tap_action` aus, kein Menü, kein X |
| Swipe-Navigation | Mit installiertem `hass-swipe-navigation` eine Leiste bauen, deren Einträge breiter sind als der Bildschirm, und sie seitlich scrollen | Die Leiste scrollt, die Ansicht wechselt **nicht**. Ohne die Abschirmung liest das Plugin den Wisch als Seitenwechsel |
| Sheet: Wisch von der Leiste | Von der Navigationsleiste nach oben wischen | Schublade öffnet; ein Tipp auf einen Eintrag navigiert weiterhin normal |
| Sheet: Zustand merken | `sheet_default: remember`, öffnen, Seite neu laden | Bleibt offen. Mit `sheet_state_entity` zusätzlich auf einem zweiten Gerät prüfen |
| Sheet: beim Navigieren | Schublade offen lassen, Eintrag antippen | Schublade schließt (außer `collapse_on_navigate: false`) |
| Sheet: Bearbeiten-Modus | Dashboard in den Bearbeiten-Modus schalten | Sheet wird **im Kartenfluss** und aufgeklappt gezeichnet, nicht am Bildschirm fixiert |
| Sheet: zwei Instanzen | Zwei Sheet-Karten auf eine Ansicht legen | Nur die erste dockt an; die zweite rendert inline |
| Sheet: kleines Fenster | Fenster auf unter 600px Höhe bringen (DevTools, Handy quer) | Höhe der Schublade ist auf 50vh begrenzt |
| Sheet: Safe Area | Auf einem iPhone in Safari öffnen | Leiste sitzt über der Home-Bar, nicht darunter |
| Reduced Motion | C11/C12 mit `style: sheet` | Schublade springt zwischen den Rastpunkten, ohne Nachfedern |
| Ganze Karte ausblenden | `hidden` auf ein Template setzen, das wahr wird | Leiste verschwindet vollständig |

## Bekannte Einschränkungen

Beide Punkte, die hier bis 2.0 standen — die Akzentfarben im hellen Theme und
der Masonry-Kollaps von `m3-climate-card-mini` und `m3-button-card` — sind mit
2.1.0 behoben. Was bewusst offen bleibt, steht in
[`light-theme-colors.md`](light-theme-colors.md) unter „Was bewusst offen
bleibt": drei Kontrastfunde, die in beiden Themes auftreten und damit
Gestaltungsentscheidungen sind, keine Fehler.

Für die Masonry-Ansicht gilt weiter: Beide Karten haben dort eine Mindesthöhe
(56 px beziehungsweise 112 px), weil ihre Karte ein Größen-Container ist und
eine Masonry-Spalte keine Höhe vorgibt. Beim Durchgang also prüfen, dass eine
kleiner konfigurierte Kachel angehoben und nicht abgeschnitten wird.

## Vor jedem Release

1. Alle Cross-Cutting-Punkte (C1–C15) auf mindestens 3 unterschiedlichen Karten
   durchgehen (eine einfache, eine mit Editor-Unterinhalten wie Battery/Power-List,
   eine mit Animation wie Progress/Light).
2. Jede der 40 Karten mindestens einmal mit einer Minimal-Config und einmal mit
   einer voll ausgereizten Config (alle Farben/Optionen gesetzt) rendern.
3. `CHANGELOG.md` gegen die tatsächlich getesteten Änderungen abgleichen.
4. Die Kartenzahl an allen fünf Stellen abgleichen, an denen sie steht: beide
   READMEs, `package.json`, die Punkte 1 und 2 dieser Liste — und die
   **Beschreibung des GitHub-Repos**, die in keiner Datei liegt und deshalb bei
   jedem Release übersehen wird. Sie stand bei 2.3 noch auf 29, sieben Karten
   und vier Releases zu spät:
   `gh repo edit j0sp0r/m3-cards --description "…"`
5. `CARD_VERSION` in `src/const.ts` und `version` in `package.json` auf die neue
   Nummer setzen. Beides passiert erst zum Release, nicht während der Arbeit.
