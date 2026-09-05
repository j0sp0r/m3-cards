# M3 Cards

> **⚠️ Beta:** Dieses Projekt ist neu und befindet sich in aktiver
> Entwicklung. Konfigurationsoptionen können sich zwischen Versionen noch
> ändern — bitte Issues melden, wenn dir etwas auffällt.

Material-3-inspirierte, native Lovelace-Karten für Home Assistant — gebaut mit
TypeScript + [Lit](https://lit.dev), **ohne** Abhängigkeit zu `button-card`,
`card-mod`, `mod-card` oder `stack-in-card`. Ein einziges Bundle
(`m3-cards.js`) registriert **{{CARD_COUNT}} Karten**, alle in derselben Designsprache.

Neu hier? Fang mit der Kategorie an, die zu dem passt, was du zeigen willst —
jede Karte verlinkt weiter unten auf ihre ausführliche Dokumentation.

{{CATEGORY_TABLES}}

*Alle Karten auf einen Blick:*

![Übersicht](docs/images/cards-overview.png)

<sub>Aufgenommen auf einer echten Home-Assistant-Instanz. Waschmaschine,
Stehlampe, Lautsprecher, Klimaanlage und die Updates zeigen simulierte
Zustände, damit die aktiven Darstellungen (Wellenindikator, Versionssprung,
laufende Installation) im Bild sichtbar sind — alles andere sind
Live-Werte.</sub>

🇬🇧 [English README](README.md)

## Features

- Milchige Glas-Karte (frei abschaltbar für solide Themes), gemeinsame Design-Sprache
- Modus-Pills mit Shape-Morph-Animation (rund → abgerundetes Rechteck)
- Temperatur-Stepper mit Schrittweite/Grenzen aus der Entity
- Optionale externe Temperatur-/Feuchte-Sensoren, Fenster- und Batterie-Chip
- Preset-Unterstützung (Tap zum Durchschalten, wahlweise als eigene Zeile oder
  als Button in der Modus-Zeile)
- Konfigurierbare Kartenhöhe + volle Höhen-Anpassung an `horizontal-stack`/Grid-Layouts
  für exakt gleich hohe Kacheln nebeneinander
- Vollständiger, grafischer Editor (kein YAML nötig) — Vorbild: nativer Tile-Card-Editor,
  einheitliches Erscheinungsbild-Panel (Eckenradius-Presets, Ecken einzeln) auf allen Karten
- `unavailable`-Handling ohne Crash: Werte als „–“, Controls gedimmt
- Deutsch/Englisch lokalisiert (folgt `hass.locale.language`)
- Barrierefreiheit: alle interaktiven Elemente per Tastatur erreichbar
  (Tab/Enter/Leertaste) mit sichtbarem Fokusring und `aria-label`
- Respektiert `prefers-reduced-motion` durchgängig, zusätzlich pro Karte über
  `animation: auto | on | off` erzwingbar
- Alte Configs (z.B. `animations: true/false`) werden beim Laden automatisch
  auf das aktuelle Schema migriert — kein manuelles Nachpflegen nötig
- [Jinja2-Templates](#templates) in allen eigenen Textfeldern jeder Karte, live
  über den Websocket — kein Template-Sensor-Helfer pro Karte mehr

## Installation

### HACS (empfohlen)

[![Dieses Repository in HACS öffnen.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=j0sp0r&repository=m3-cards&category=plugin)

Der Knopf öffnet das Repository direkt in deinem eigenen Home Assistant —
dort auf *Herunterladen* drücken, fertig. Von Hand geht es so:

1. HACS → Menü (⋮) oben rechts → *Benutzerdefinierte Repositories*
2. Repository-URL eintragen, als Typ **Dashboard** wählen, dann *Hinzufügen*
   (**nicht** *Integration* — das hier ist eine Lovelace-Karte, keine Integration)
3. „M3 Cards“ suchen, öffnen und auf *Herunterladen* klicken
4. Home Assistant neu laden

### Manuell

1. Lade die aktuelle `m3-cards.js` aus den [Releases](../../releases) herunter
2. Kopiere sie nach `config/www/m3-cards.js`
3. Füge die Ressource in Home Assistant hinzu:
   *Einstellungen → Dashboards → Ressourcen → Ressource hinzufügen*
   - URL: `/local/m3-cards.js`
   - Typ: JavaScript-Modul

## Templates

Jede Karte akzeptiert Jinja2 in **ihren eigenen Textfeldern** — Name, Icon,
Farbe, Einheit, was die jeweilige Karte eben aus ihrer Konfiguration liest. Ein
Feld gilt als Template, sobald es `{{` oder `{%` enthält; alles andere bleibt
unangetastet.

```yaml
type: custom:m3-button-card
entity: light.kitchen
name: "{{ states('sensor.kitchen_temperature') | round(1) }} °C"
icon: >-
  {{ 'mdi:lightbulb-on' if is_state('light.kitchen', 'on') else 'mdi:lightbulb' }}
```

Vorher konnte ein Feld nur ein fester Text oder der rohe Zustand einer Entität
sein. Für jede zusammengesetzte Beschriftung brauchte es einen
Template-Sensor-Helfer in der `configuration.yaml` — und ein Icon, das von einer
Entität abhängt, ließ sich überhaupt nicht ausdrücken:

```yaml
# configuration.yaml — einer davon pro Karte, jetzt nicht mehr nötig
template:
  - sensor:
      - name: Kitchen label
        state: "{{ states('sensor.kitchen_temperature') | round(1) }} °C"
```

Die Werte werden **gepusht**, nicht gepollt: Die Karte abonniert das Template
über den Websocket, und Home Assistant rendert es neu, sobald sich irgendetwas
ändert, das das Template liest. Ein Abo pro unterschiedlichem Template — zwei
Felder mit derselben Zeichenkette teilen sich eines —, und alle werden
geschlossen, sobald die Karte die Seite verlässt.

Eine Karte ohne Templates verhält sich exakt wie bisher und zahlt nichts dafür:
Es wird nichts durchlaufen, abonniert oder kopiert.

### Verschachtelte Karten bleiben unangetastet

Karten-Konfigurationen können andere Karten enthalten: `cards:` bei Gruppen- und
Raumkarte, der Inhalt eines Popup-Actions, eine Mushroom-Karte in einem Slot.
**Templates darin werden hier nicht gerendert** — sie gehen unverändert an die
Karte, der sie gehören.

```yaml
type: custom:m3-room-card
area: kitchen
name: "{{ states('sensor.kitchen_temperature') | round(1) }} °C"   # hier gerendert
cards:
  - type: custom:mushroom-template-card
    primary: "{{ states('sensor.kitchen_humidity') }} %"           # bleibt Mushroom
```

Der Grund: Die innere Karte rendert ihre Templates selbst, und zwar *live*.
Würde `primary` oben hier aufgelöst, bekäme Mushroom genau die eine Zeichenkette,
die zum Zeitpunkt der Konfiguration herauskam — das Feld würde auf diesem Wert
einfrieren und dem Sensor nie wieder folgen. Die Regel ist mechanisch: Der Durchlauf
stoppt an jedem verschachtelten Objekt mit eigenem `type`, denn so sieht eine
Karten-Konfiguration aus, egal für welche Karte.

Die Nav-Karte ist die Ausnahme in die andere Richtung: Ihre Einträge hatten
Templates schon vorher, mit `hidden` / `disabled` als Wahrheitswerte, und sie
funktionieren wie unter [M3 Nav Card](#m3-nav-card) beschrieben.

{{CARD_SECTIONS}}

## Entwicklung

```bash
npm install
npm run dev     # Watch-Build nach dist/m3-cards.js
npm run build    # Produktions-Build
npm run lint     # Typecheck
```

Zum lokalen Testen `dist/m3-cards.js` nach `config/www/` kopieren und als
Lovelace-Ressource (`/local/m3-cards.js`, Typ „JavaScript-Modul“) einbinden.

## Dank

**M3 Lights Overview**, **M3 Chip Buttons** und **M3 Group Card** stammen von
Fabian Wendel ([UHaFnir](https://github.com/UHaFnir/m3-cards)), der dieses
Projekt geforkt hat — ebenso die getrennten Schalter für Kopfbereich und
Diagramm der Wetterkarte und deren einstellbare Stundenleiste. Zwei
Performance-Fehler in Code, der hier schon lag, hat er ebenfalls gefunden: Jede
selbsterkennende Karte holte die gesamte Entitäts-Registry erneut, statt die
Kopie zu lesen, die das Frontend ohnehin hält, und das Öffnen des
Karten-Auswahldialogs löste neunmal eine Rundum-Erkennung aus.

Die Abschnitte zu diesen drei Karten oben sind weitgehend sein Text, leicht
angepasst.

## Lizenz

MIT
