# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden hier dokumentiert.
Format angelehnt an [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
Versionierung folgt [SemVer](https://semver.org/lang/de/).

## [Unreleased]

### Added

- **Jinja2 templates in every card's own string fields.** A field containing
  `{{` or `{%` — a name, an icon, a colour, whatever that card reads out of its
  config — is now subscribed over Home Assistant's `render_template` websocket
  and pushed a new value whenever anything it reads changes. Until now a card
  could show a fixed string or one entity's raw state and nothing else, so a
  composed label meant a template-sensor helper in `configuration.yaml` for
  every card that wanted one, and a dashboard moved over from mushroom lost
  every templated label, icon and colour it had.

  Templates inside a **nested** card config — `cards:`, a popup action's
  content, a mushroom card in a slot — are deliberately left alone and handed
  to that card verbatim. It renders them itself, and it renders them live;
  resolving them here would freeze the field at whatever it said when the outer
  card was configured. The walk stops at any nested object carrying its own
  `type`.

  Nothing changes for a card that uses no templates, and it costs nothing: no
  walk, no subscription, no copy of its config. The nav card keeps its own
  per-entry templates, including the boolean `hidden` / `disabled` fields.

- **The room card's header can run an action**, via a card-level `tap_action`.
  Until now the header either folded the card or did nothing, and the only
  action the card offered was `detail_path` on a long press of a category tile
  — so a room card on an overview had no way to be the door into that room's
  own view. `tap_action` takes the standard Home Assistant action config and
  goes through the same handler the heading and status cards use, so
  `navigate` and `url` behave as they do elsewhere, and `perform-action` does
  too when it names its own `target`. `more-info` and `toggle` cannot work
  here: a room is an area, not an entity, so there is no implied target to
  hand them, and both do nothing without one.

  A tap cannot both fold the card and open a view, so a configured
  `tap_action` takes the header over from the fold and the chevron goes with
  it — it promises a fold the header no longer performs. Everything else about
  `collapsible` is untouched: the stored state is still read and applied, so
  `collapse_state_entity` and an automation can still fold a card whose header
  navigates. Leaving `tap_action` unset changes nothing at all.

  ```yaml
  type: custom:m3-room-card
  area: living_room
  tap_action:
    action: navigate
    navigation_path: /lovelace/living-room
  ```

- **The presence card's tap is configurable**, via a card-level `tap_action`.
  A tap on a person was hardcoded to more-info, so a card meant to be the way
  into a person's own dashboard view could not be one. `tap_action` takes the
  standard Home Assistant action config, sits alongside the `hold_action` the
  card already had, and targets the person actually tapped — `more-info`,
  `toggle` and a service call that names no target of its own all land on that
  row's `entity_id`. Unset, a tap opens more-info exactly as before.

  ```yaml
  type: custom:m3-presence-card
  tap_action:
    action: navigate
    navigation_path: /lovelace/people
  ```

- **`tap_action` and `hold_action` are in the presence card's editor**, under
  a new Interactions section. `hold_action` had been in the config all along
  with no field to set it from, so it was YAML-only.

- **`show_color_temp` for the light card.** The colour temperature row appeared
  on every light that reports `color_temp`, and nothing could take it away —
  `color_temp_style` only chooses between the three presets and the continuous
  slider, it does not hide the row. On a view carrying dozens of light cards
  that row is height on every one of them, paid for by people who only ever
  drag the brightness. `show_color_temp: false` leaves it out. It defaults to
  `true`, so existing dashboards look exactly as they did, and it only ever
  removes the row — a light without colour temperature support still never
  shows one. In the editor the switch sits at the top of the **Colour
  temperature** section, with the style and preset fields below it; they are
  hidden while it is off, since they have nothing left to describe.

- **A new card: M3 Search Card** (`custom:m3-search-card`). A Material 3 search
  bar that sits on the dashboard itself and opens Home Assistant's own quick
  bar — the entity search by default, the command palette with
  `mode: command` — plus an optional trailing Assist button. It reads no
  entity and needs no configuration at all: `type: custom:m3-search-card` is a
  working card.

  The gap it fills is that Home Assistant's only search entry point is in the
  header, and the header's search button is not rendered at all on a narrow
  screen. On a phone or a wall tablet there is no way to reach the entity
  search from a dashboard except by keyboard, which those devices do not have.
  The header's Assist button goes the same way, which is why this card can
  carry one.

  It opens the dialog by replaying Home Assistant's own keyboard shortcut
  rather than by firing `show-dialog`, and that is not a shortcut of its own
  taking: `ha-quick-bar` is code-split out of the frontend's main bundle, and
  the only thing that pulls it in is the frontend's own caller, which hands the
  dialog manager an `import()` callback alongside the tag. A card loaded as its
  own Lovelace resource cannot name that module path, so a bare `show-dialog`
  lands on a custom element that was never defined and fails with "Unknown
  dialog type loaded". Replaying the key hands the lazy import back to the
  handler that owns it, and leaves the card depending on a shortcut that is
  user-visible and listed in Home Assistant's own `Shift+?` dialog rather than
  on an internal module path.

  Everything that can take those shortcuts away is checked rather than assumed,
  because a control that silently does nothing is worse than one that is not
  drawn: the per-user "keyboard shortcuts" profile switch (the bar dims and
  says so), the `conversation` integration Assist needs (no integration, no
  Assist button), and the fact that the command palette is registered for
  admins only (a non-admin gets the entity search, which is at least a search).

  ```yaml
  type: custom:m3-search-card
  ```

### Changed

- **The presence card's `hold_action` now runs through the shared action
  handler**, like every other card's. It used to implement `navigate` and `url`
  itself and silently ignore the rest, so a `hold_action` of `more-info`,
  `toggle` or `perform-action` did nothing — and nothing said so, since the
  editor offered no field for it. Those now work, `confirmation` is honoured,
  and the two kinds that already worked are unchanged.

### Hinzugefügt

- **Jinja2-Templates in allen eigenen Textfeldern jeder Karte.** Ein Feld mit
  `{{` oder `{%` — Name, Icon, Farbe, was die Karte eben aus ihrer
  Konfiguration liest — wird jetzt über den `render_template`-Websocket von Home
  Assistant abonniert und bekommt einen neuen Wert gepusht, sobald sich etwas
  ändert, das das Template liest. Bisher konnte eine Karte einen festen Text
  oder den rohen Zustand einer Entität zeigen und sonst nichts: Für jede
  zusammengesetzte Beschriftung brauchte es einen Template-Sensor-Helfer in der
  `configuration.yaml`, und ein von Mushroom übernommenes Dashboard verlor jede
  getemplatete Beschriftung, jedes Icon und jede Farbe.

  Templates in **verschachtelten** Karten-Konfigurationen — `cards:`, der Inhalt
  eines Popup-Actions, eine Mushroom-Karte in einem Slot — bleiben bewusst
  unangetastet und gehen unverändert an diese Karte. Sie rendert sie selbst, und
  zwar live; würden sie hier aufgelöst, fröre das Feld auf dem Wert ein, den es
  beim Konfigurieren der äußeren Karte hatte. Der Durchlauf stoppt an jedem
  verschachtelten Objekt mit eigenem `type`.

  Für Karten ohne Templates ändert sich nichts, und es kostet nichts: kein
  Durchlauf, kein Abo, keine Kopie der Konfiguration. Die Nav-Karte behält ihre
  eigenen Templates pro Eintrag, samt der Wahrheitswert-Felder `hidden` /
  `disabled`.

- **Die Kopfzeile der Raumkarte kann eine Aktion ausführen**, über eine
  `tap_action` auf Kartenebene. Bisher klappte die Kopfzeile die Karte ein oder
  tat nichts, und die einzige Aktion der Karte war `detail_path` bei langem
  Druck auf eine Kategorie-Kachel — eine Raumkarte auf einer Übersicht konnte
  also nicht die Tür in die eigene Ansicht dieses Raums sein. `tap_action`
  nimmt die übliche Home-Assistant-Aktionskonfiguration und läuft über
  denselben Handler wie bei der Überschriften- und der Status-Karte: `navigate`
  und `url` verhalten sich wie überall sonst, `perform-action` ebenfalls, sofern
  es sein `target` selbst benennt. `more-info` und `toggle` können hier nicht
  greifen — ein Raum ist ein Bereich, keine Entität, es gibt also kein
  mitzugebendes Ziel, und ohne eines tun beide nichts.

  Ein Tap kann nicht zugleich einklappen und eine Ansicht öffnen, deshalb
  übernimmt eine gesetzte `tap_action` die Kopfzeile vom Einklappen, und der
  Pfeil geht mit — er verspricht ein Einklappen, das die Kopfzeile nicht mehr
  ausführt. Alles Übrige an `collapsible` bleibt unberührt: der gespeicherte
  Zustand wird weiter gelesen und angewendet, `collapse_state_entity` und eine
  Automatisierung können eine Karte also weiterhin einklappen, deren Kopfzeile
  navigiert. Ohne `tap_action` ändert sich nichts.

- **Der Tap der Anwesenheitskarte ist einstellbar**, über eine `tap_action` auf
  Kartenebene. Ein Tap auf eine Person war fest auf More-Info verdrahtet, eine
  Karte als Weg in die eigene Ansicht einer Person war also nicht möglich.
  `tap_action` nimmt die übliche Home-Assistant-Aktionskonfiguration, steht
  neben der bereits vorhandenen `hold_action` und zielt auf die tatsächlich
  angetippte Person — `more-info`, `toggle` und ein Dienstaufruf ohne eigenes
  Ziel landen alle auf deren `entity_id`. Ohne Eintrag öffnet ein Tap More-Info
  wie bisher.

- **`tap_action` und `hold_action` stehen im Editor der Anwesenheitskarte**,
  unter einem neuen Abschnitt „Interaktionen". `hold_action` steckte schon
  immer in der Konfiguration, ohne dass es ein Feld dafür gab — sie ließ sich
  nur in YAML setzen.

- **`show_color_temp` für die Light Card.** Die Farbtemperatur-Zeile erschien
  bei jeder Lampe mit `color_temp`, und nichts konnte sie wegnehmen —
  `color_temp_style` wählt nur zwischen den drei Voreinstellungen und dem
  stufenlosen Regler, ausblenden lässt sich die Zeile damit nicht. Auf einer
  Ansicht mit Dutzenden Light Cards ist das Höhe auf jeder einzelnen, bezahlt
  von denen, die ohnehin nur die Helligkeit ziehen. `show_color_temp: false`
  lässt sie weg. Standard ist `true`, bestehende Dashboards sehen also
  unverändert aus, und die Option nimmt nur weg — eine Lampe ohne
  Farbtemperatur-Unterstützung zeigt weiterhin keine. Im Editor steht der
  Schalter oben im Abschnitt **Farbtemperatur**, Stil- und Voreinstellungs-
  Felder darunter; sie verschwinden, solange er aus ist, weil sie dann nichts
  mehr beschreiben.

- **Eine neue Karte: M3 Search Card** (`custom:m3-search-card`). Eine
  Material-3-Suchleiste, die auf dem Dashboard selbst sitzt und Home Assistants
  eigene Schnellsuche öffnet — standardmäßig die Entitätssuche, mit
  `mode: command` die Befehlssuche — dazu optional ein Assist-Knopf am rechten
  Rand. Sie liest keine Entität und braucht überhaupt keine Konfiguration:
  `type: custom:m3-search-card` ist bereits eine funktionierende Karte.

  Die Lücke, die sie füllt: Home Assistants einziger Einstieg in die Suche
  sitzt in der Kopfzeile, und der Such-Knopf dort wird auf schmalen
  Bildschirmen gar nicht gezeichnet. Auf einem Telefon oder einem Wandtablet
  führt vom Dashboard aus also kein Weg zur Entitätssuche außer über eine
  Tastatur, die diese Geräte nicht haben. Dem Assist-Knopf der Kopfzeile geht
  es genauso — deshalb kann diese Karte einen mitbringen.

  Sie öffnet den Dialog, indem sie Home Assistants eigenes Tastenkürzel
  nachspielt, statt `show-dialog` zu feuern, und das ist keine selbstgewählte
  Abkürzung: `ha-quick-bar` liegt in einem eigenen Chunk außerhalb des
  Hauptbundles, und hereingeholt wird es einzig vom Aufrufer des Frontends
  selbst, der dem Dialog-Manager neben dem Tag auch einen `import()`-Callback
  mitgibt. Eine als eigene Lovelace-Ressource geladene Karte kann diesen
  Modulpfad nicht benennen; ein bloßes `show-dialog` landet deshalb auf einem
  nie definierten Custom Element und scheitert mit „Unknown dialog type
  loaded". Das Nachspielen der Taste gibt den Nachlade-Import an den Handler
  zurück, dem er gehört, und lässt die Karte an einem Tastenkürzel hängen, das
  sichtbar und in HAs eigenem `Shift+?`-Dialog aufgeführt ist, statt an einem
  internen Modulpfad.

  Alles, was diese Kürzel wegnehmen kann, wird geprüft statt angenommen, denn
  ein Bedienelement, das stillschweigend nichts tut, ist schlimmer als eines,
  das gar nicht da ist: der Profil-Schalter „Tastenkürzel" (die Leiste wird
  blass und sagt es), die von Assist benötigte Integration `conversation`
  (ohne sie kein Assist-Knopf) und der Umstand, dass die Befehlssuche nur für
  Administratoren registriert ist (ohne Admin-Rechte kommt die Entitätssuche —
  immerhin eine Suche).

  ```yaml
  type: custom:m3-search-card
  ```

### Geändert

- **Die `hold_action` der Anwesenheitskarte läuft nun über den gemeinsamen
  Aktions-Handler**, wie bei jeder anderen Karte. Bisher setzte sie `navigate`
  und `url` selbst um und überging den Rest stillschweigend, eine `hold_action`
  mit `more-info`, `toggle` oder `perform-action` tat also nichts — und nichts
  wies darauf hin, da der Editor gar kein Feld dafür anbot. Diese funktionieren
  jetzt, `confirmation` wird beachtet, und die beiden bisher funktionierenden
  Arten bleiben unverändert.

## [2.3.2]

Editor tidying for the nav card, following 2.3.1.

### Fixed

- **The round button's section still appeared on a pull-up sheet.** 2.3.1 stopped
  the card drawing one there — a sheet has a drawer instead — but the editor went
  on offering it, headed "Round button's menu" on a variant that has no round
  button. Editor and card agree again: only the floating bar has one. A sheet's
  menu entries fold into the drawer's own tiles, where they can be renamed and
  reordered; they were already drawn there, but lived in a part of the config the
  editor no longer showed.

### Changed

- **The round button and its menu moved from Appearance to Entries**, directly
  under the list. They hold the same kind of thing the bar does, and moving a
  page from the bar into the menu or back meant working across two panels.

### Behoben

- **Der Abschnitt des runden Knopfes erschien weiterhin beim Pull-up-Sheet.**
  Seit 2.3.1 zeichnet die Karte dort keinen mehr — ein Sheet hat stattdessen
  eine Schublade —, der Editor bot ihn aber weiter an, überschrieben mit „Menü
  des runden Knopfes" bei einer Variante ohne runden Knopf. Editor und Karte
  sind wieder einer Meinung: nur die schwebende Leiste hat einen. Die
  Menüeinträge eines Sheets gehen in die Kacheln der Schublade über, wo sie sich
  umbenennen und umsortieren lassen — gezeichnet wurden sie dort ohnehin schon,
  sie steckten nur in einem Teil der Konfiguration, den der Editor nicht mehr
  anzeigte.

### Geändert

- **Der runde Knopf und sein Menü sind von „Darstellung" zu „Einträge"
  gewandert**, direkt unter die Liste. Sie enthalten dieselbe Art von Dingen wie
  die Leiste, und eine Seite von der Leiste ins Menü zu schieben oder zurück
  hieß bisher, zwischen zwei Bereichen zu wechseln.

## [2.3.1]

A hotfix for the nav card. Everything here was found within hours of 2.3.0
by someone building their first navigation bar, and every one of it sat in
the way of doing exactly that.

### Fixed

- **The drawer stopped responding after the editor was saved.** A pull-up
  sheet would not open — by tap or by drag — until the page was reloaded.
  Saving re-renders the card and Lit hands the drawer fresh elements, but the
  gesture kept its listeners on the discarded ones, and the code that wires
  them up returned early because a gesture object already existed. Events
  arrived at nodes nobody was listening to. It now compares the grip it is
  bound to against the one on screen, and rebinds when they differ.

- **The target page had to be typed from memory.** Every entry meant recalling
  a path like `/lovelace/garten`. It is a list of this dashboard's own views
  now, labelled "Energie — /lovelace/energie", at all four places a path is
  asked for — entries, submenu entries, drawer tiles, action-menu entries. A
  path the list cannot know is still typeable. Choosing one also fills in the
  name and icon from that view, leaving anything already written alone.

- **The round action button appeared on variants that have no place for it.**
  It is a companion to a detached pill. On `header` and `footer`, which span a
  screen edge, and on `segmented`, which runs in the content flow, it read as a
  stray dot that had fallen off the bar. Those three no longer draw one and the
  editor stops offering it; what it would have held becomes ordinary entries at
  the end of the bar, which already scrolls rather than clipping. On `sheet` the
  entries go into the drawer instead, which is what the drawer is for.

- **The pull-up sheet spanned the whole screen.** Shut it hugged its entries;
  pulled up it snapped to the full width, which on a wide monitor spread its
  tiles across the glass and read as a different object from the one just
  tapped. It keeps the bar's width now, open or shut.

- **A docked bar spilled out of its frame in the editor.** There the bar is
  drawn in the flow, inside a frame the dashboard column sizes — eight entries
  are wider than that, and the bar simply ran out past the dashed edge. It
  scrolls inside the frame, as it already does on screen.

### Changed

- **A new nav card starts as a floating bar with its labels beside the icons**,
  rather than docked with them underneath — the shape a phone's own navigation
  uses. Only what a newly added card starts with changed; an existing card that
  never named a style still falls back to `footer`, so nothing moves on a
  dashboard that was already set up.

- **Every card's reference section folds behind a summary in the README**, not
  only the three adopted in 2.3.0. Each card keeps its description and its
  screenshot visible; the YAML, the sub-sections and the options table collapse.
  Those three cards were also missing from the card index entirely.

### Behoben

- **Die Schublade reagierte nach dem Speichern des Editors nicht mehr.** Ein
  Pull-up-Sheet ließ sich weder antippen noch hochziehen, bis die Seite neu
  geladen wurde. Beim Speichern zeichnet Lit die Karte neu und gibt der
  Schublade frische Elemente; die Geste behielt ihre Lauscher auf den
  weggeworfenen, und die Stelle, die sie anhängt, stieg vorzeitig aus, weil ja
  schon eine Geste existierte. Die Ereignisse kamen bei Knoten an, an denen
  niemand horchte. Die Karte vergleicht jetzt den Griff, an dem sie hängt, mit
  dem gerade gezeichneten, und bindet sich bei Abweichung neu.

- **Die Zielseite musste aus dem Gedächtnis getippt werden.** Jeder Eintrag
  hieß, einen Pfad wie `/lovelace/garten` zu erinnern. Jetzt ist es eine Liste
  der Ansichten dieses Dashboards, beschriftet als „Energie —
  /lovelace/energie", an allen vier Stellen, an denen ein Pfad gefragt wird —
  Einträge, Untermenü, Schubladen-Kacheln, Aktionsmenü. Ein Pfad, den die Liste
  nicht kennen kann, lässt sich weiterhin eintippen. Die Auswahl füllt zudem
  Beschriftung und Icon aus der Ansicht, ohne bereits Geschriebenes anzutasten.

- **Der runde Aktionsknopf erschien bei Varianten, die keinen Platz dafür
  haben.** Er ist der Begleiter einer freistehenden Pille. Bei `header` und
  `footer`, die an einer Bildschirmkante liegen, und bei `segmented`, das im
  Fluss der Seite steht, wirkte er wie ein Punkt, der von der Leiste abgefallen
  ist. Diese drei zeichnen ihn nicht mehr, und der Editor bietet ihn dort nicht
  an; was er enthalten hätte, wird zu normalen Einträgen am Ende der Leiste,
  die bei Überlauf ohnehin scrollt. Beim `sheet` wandern die Einträge
  stattdessen in die Schublade — wofür sie da ist.

- **Das Pull-up-Sheet spannte über den ganzen Bildschirm.** Zugeklappt
  schmiegte es sich an seine Einträge, hochgezogen sprang es auf die volle
  Breite und verteilte seine Kacheln auf einem breiten Monitor über die ganze
  Fläche — als wäre es ein anderes Ding als das eben angetippte. Es behält
  jetzt die Breite der Leiste, auf wie zu.

- **Eine angedockte Leiste lief im Editor aus ihrem Rahmen.** Dort wird sie im
  Fluss gezeichnet, in einem Rahmen, dessen Breite die Dashboard-Spalte
  bestimmt — acht Einträge sind breiter als das, und die Leiste lief schlicht
  über die gestrichelte Kante hinaus. Sie scrollt jetzt innerhalb des Rahmens,
  so wie sie es am Bildschirm längst tut.

### Geändert

- **Eine neu eingefügte Nav-Karte startet als schwebende Leiste mit den
  Beschriftungen neben den Icons** statt angedockt mit Text darunter — die
  Form, die die Navigation eines Telefons selbst verwendet. Geändert hat sich
  nur, womit eine **neue** Karte beginnt; eine bestehende ohne ausdrückliche
  Variante fällt weiterhin auf `footer` zurück, damit auf einem eingerichteten
  Dashboard nichts verrutscht.

- **Im README klappt der Referenzteil jeder Karte hinter eine Zusammenfassung**,
  nicht nur bei den drei aus 2.3.0 übernommenen. Beschreibung und Screenshot
  bleiben sichtbar; YAML, Unterabschnitte und Optionstabelle klappen weg. Jene
  drei Karten fehlten außerdem vollständig im Kartenverzeichnis.

## [2.3.0]

### Added

- **Three cards from the fork** (`m3-lights-overview-card`,
  `m3-chip-buttons-card`, `m3-group-card`), built by
  [UHaFnir](https://github.com/UHaFnir/m3-cards) and adopted here with the
  suite's own conventions applied.

  **Lights Overview** groups every `light.*` entity by Home Assistant area and
  gives each room a tile that switches it — or, in `view: entities`, drops the
  grouping and lists the lights themselves, optionally with the ones that are
  on sorted first. Two independent filters decide what a room *shows* and what
  a tap actually *switches*, so a room can display a light it does not toggle.
  `group_handling` drops one side of a `light.group` and its members, so a
  group and the lights inside it are not counted twice. A tap can open a popup
  scoped to that one room instead of HA's more-info dialog.

  **Chip Buttons** is a row of compact pills, each bound to an entity, that
  wraps rather than scrolls. A chip can show its state, take its colour from
  the entity's own state colour, hold a static colour regardless of state, or
  be marked read-only so it renders as a label rather than a button.

  **Group Card** puts several cards in one surface with a shared background and
  corner radius, so a set of related cards reads as one block instead of as
  separate tiles with gaps between them.

- **Weather card: the header and the chart switch independently.**
  `show_current` and `show_chart` were one decision before; a card can now be
  just the current conditions, just the forecast chart, or both. The hourly
  strip gained `show_hourly_icons`, `show_hourly_temperatures`,
  `show_hour_labels` and a `show_temp_axis`, and it now thins its labels to a
  round stride — every 2nd, 3rd, 4th hour — rather than crowding them when the
  card is narrow. Also from UHaFnir's fork.

- **M3 Nav Card** (`m3-nav-card`) — the headline of this release: a navigation
  bar for the dashboard, in five variants: `header` and `footer` dock to an
  edge, `segmented` is an inline pill group that scrolls with the page,
  `floating` detaches into a rounded bar, and `sheet` adds a drawer that pulls
  up over the view. The four docked variants take no row of the grid: their
  slot collapses and they position themselves against the screen.

  Configurable to the level of the community's Navbar Card, in this suite's own
  design language: per-entry badges (a template, an entity's state, or a count
  of entities that are on — hidden automatically at 0/off/empty/unavailable),
  popup submenus that grow out of the button that opened them, tap/hold/
  double-tap actions with Home Assistant's haptic event, and separate desktop
  and mobile layouts.

  The desktop/mobile switch measures the card's **own** box through a
  ResizeObserver rather than the window through a media query: a card in a
  narrow column on a wide screen is narrow, and a media query would get that
  wrong.

  `name`, `icon`, `color`, `hidden`, `disabled` and the badge accept Jinja2 and
  subscribe to it — Home Assistant pushes a new value whenever anything the
  template reads changes. Only fields that actually contain `{{` or `{%` open a
  subscription, and identical templates share one.

  The sheet is dragged, and the interesting part is not the drag but the
  conflict with the content scrolling inside it: the content scrolls normally,
  and the sheet only takes over when the content is already at the top and the
  finger is going down. A release goes to the nearest snap point unless it was a
  flick, which goes the way it was thrown whatever position the sheet was in.
  In edit mode the sheet renders inline and pinned open, because a drawer docked
  to the screen covers the card the editor is trying to show, and only the first
  sheet on a view docks itself.

  `preload_views` is accepted and stored but does nothing: Home Assistant gives
  a custom card no way to warm another view, and the only workaround would
  flicker and leave a bogus history entry. Kept as a reserved key so a future
  version can implement it without a breaking config change. Card-wide
  visibility by user, device or screen size is likewise **not** reimplemented —
  Home Assistant's own `visibility` feature already does that for every card,
  and the card's `hidden` is scoped to what only a template can answer.

- **Calendar and room cards: the panel that opens over them was see-through on
  a glass theme.** Reported against the calendar card's event details, where the
  agenda rows read straight through the title and the buttons. Both panels took
  their background from the theme's card colour, which is the right source for a
  card and the wrong one for something laid over it: a glass theme makes that
  colour translucent deliberately. The colour is still used, now painted over an
  opaque base, so the panel matches the theme and hides what is behind it. The
  cards' own surfaces are untouched — a card is supposed to let the wallpaper
  through.

- **Cost card: the projected bars shot off the top of the card when the month
  was changed.** For one frame the elapsed-day count already belonged to the new
  period while the total still belonged to the old one, so the daily average —
  one month's total over the other month's days — came out several times too
  large. That average is what the dashed future bars are drawn with, and it was
  the one value the scale did not take into account: the maximum was over the
  recorded days alone. The bars ran up over the amount and the comparison chip
  until the next render corrected them. The average is now part of the scale,
  and a bar's height is clamped to the chart on top of that. The row itself
  cannot clip, because the value bubble deliberately sits above it.

- **Nav card: a tap outside an open drawer shuts it.** Every sheet behaves this
  way and this one did not: the only way back was the grip or a drag. It is a
  surface of its own rather than a listener on the document, because the tap has
  to be consumed — left to reach the page, one tap outside would shut the drawer
  *and* press whatever was under it, switching something on for someone who was
  only putting the drawer away. The surface is invisible: a dimmed scrim is the
  other honest answer, but it changes what the dashboard looks like the moment
  the drawer opens, and that was not asked for. Edit mode keeps its drawer open
  and gets no surface, or the editor would be covered by the card it is editing.

- **Nav card: a new card arrives filled in from the dashboard it landed on.**
  It used to start with two invented entries pointing at views that may not
  exist, which is a worse start than an empty one: the reader has to work out
  what the shape means before replacing it. The views are in the dashboard's own
  config, so the card offers them — the first three as entries, the next five
  behind the round button, the arrangement a bar with more pages than fit ends
  up in anyway. Subviews are left out, since they are reached from another view
  rather than from the tab strip, and a first view with no path of its own is
  addressed by its index, the way a hand-written bar does it. It is a suggestion
  and nothing else: the entries become ordinary config on the spot, and nothing
  reads the dashboard again unless "Import views" is pressed.

- **Nav card: the default colour follows the theme.** It was a fixed blue from
  the suite's palette, which under a Material You theme made the bar the one
  thing on the dashboard not wearing the colour generated from the wallpaper.
  Navigation is the frame around everything else and has no hue of its own to
  argue for, so it defaults to `primary` now, like the button card.
  `accent_color` and per-entry `color` are unchanged.

- **Nav card: `page_transition_ms`** — how long that cross-fade runs, defaulting
  to 180ms rather than the browser's 250ms, which reads as slow for a change the
  reader just asked for. Written as a single style element on the document,
  because the pseudo-elements a view transition animates live on the root and
  cannot be reached from a shadow root.

- **Nav card: `page_transition: up`** — Material's fade-through, and the setting
  worth having. A plain cross-fade between two pages that share a wallpaper and
  a navigation bar is invisible: the pages look the same while they dissolve
  into each other, so the change still reads as a jump however long it takes.
  The old page leaves first and the new one rises a little into place, which is
  what makes the change legible at all.

- **Nav card: `page_transition`** — cross-fades the whole page when a navigation
  starts from the bar. The card cannot animate Home Assistant's view swap from
  the outside, but it is what starts the swap, and a view transition wraps
  whatever the DOM does inside its callback. Only navigations get it, and a
  browser without view transitions changes page exactly as before.

- **Nav card: `marker_motion`** — `slide` moves a single shape between entries
  instead of fading one out and another in. Arriving on a page never slides:
  the marker is simply already where it belongs.

- **Nav card: `pill_size`** — scales the marker around the active entry on its
  own. The variants mark different boxes, so the same number works on both: the
  shape around the icon in the stacked variants, the whole entry where the label
  sits beside it.

- **Nav card: `label_size`**, and a bigger default for a label beside the icon.
  11px is what Material gives a label stacked under an icon, where it is the
  secondary half of the pair; set next to a 22px glyph it read as a caption
  rather than the entry's name. Beside the icon the default is 14px now, and
  `label_size` overrides either.

- **Nav card: `label_position`** — whether an entry's text sits below, above,
  right or left of its icon. The two horizontal placements also move the active
  pill so it wraps icon and text together, because a pill around the icon alone
  with the label hanging outside it is not a shape anyone draws.

- **Nav card: `inactive_only`** for `label_visibility` and `icon_visibility` —
  the missing inverse of `active_only`. Together they express a bar whose
  selected page reads as text while every other page is just an icon.

- **Nav card: the action button can open a menu.** Give `action_button` a
  `menu` and tapping it raises a stack of labelled pills out of the button —
  each with its own text, icon, colour and action — while the button itself
  morphs from a circle into a rounded square showing `close_icon`. Without a
  `menu` it stays the plain shortcut it was. The entries are always in the DOM
  and shown by a class, so they fold back into the button on the way out
  instead of blinking away.

- **Nav card: `edge_distance`** — how far the bar keeps from the screen edge it
  docks to, in px, with a slider in the editor. It is added on top of the
  device's safe area rather than replacing it, so no value can push the bar
  onto a phone's gesture bar.

- **Button card: `icon_fill: solid`** — turns the active pairing inside out. The
  well takes the accent and the glyph is darkened against it, rather than a pale
  wash of the accent carrying an accent-coloured glyph. The bolder of the two,
  and the one that reads first from across a room.

- **Button card: `icon_off`** — a second icon for while the entity is off. Many
  symbols have a struck-through twin, and that reads as "not on" before any
  colour does. Falls back to `icon` when unset, which is most cards.

- **Button card: `shape_by_state`** — the outline follows the entity, the way a
  phone's quick settings do it: a capsule while it is off, the configured corner
  radius while it is on, and the icon well going from a circle to a rounded
  square alongside. Animated, and off by default. It puts the state in a second
  channel, so a glance from across the room reads the shape before the colour.
  The on-state radius defaults to 16px rather than the card's usual 28px, since
  28px on a card one grid row tall is half its height and therefore a capsule
  already — both states computed correctly and looked identical. An explicit
  `radius` still wins.

- **Room card: `scroll_on_expand` and `scroll_duration`** — brings the card into
  view after it unfolds. A collapsed card near the bottom of a view opens
  downwards, past the edge of the screen, so the thing you just asked to see is
  the thing you cannot see. It moves by the least it can, not at all when the
  card is already fully visible, and it leaves room for anything docked over the
  bottom of the window — a navigation bar from this suite included, found
  wherever in the shadow DOM it happens to live. `scroll_duration` sets how long
  that takes; the default of 240 ms is deliberately shorter than the browser's
  own smooth scroll, which picks its pace from the distance and reads as the
  page taking its time about a tap it has already answered.

- **Room card: `collapse_memory`** — how long a fold is remembered. It was
  always kept on the device, so a card left open stayed open for good; that
  suits a dashboard someone arranged once and gets in the way of one that should
  open on its overview every time. `session` keeps the fold only while the app
  is running: it still follows you around the dashboard, and the next start
  finds every card folded again. A configured `collapse_state_entity` still
  wins, since a helper is a deliberate answer to the same question.

- **Room card: `door_entities`** — contacts counted apart from the windows, with
  a chip of their own. A door standing open and a window standing open are
  different facts, and a room card that adds them together answers neither. It
  has to be an explicit list because Home Assistant labels almost every contact
  sensor `door` whatever it is fitted to, so the distinction cannot be
  discovered. An entity listed here never counts in the window chip as well.

- **Room card: `power_entities`** — several power sensors added together, chosen
  from an entity picker in the editor. A room's consumption is usually the sum
  of its plugs, and the card could previously only name one sensor: discovery
  picked the first in the area, which in a hallway holding a mains channel meant
  a chip reporting the whole phase as if it were that room. Unavailable readings
  are skipped rather than counted as zero.

- **Room card editor: each nested card opens its own editor.** Not a hand-picked
  handful of fields — the card class is asked for its editor, the same contract
  Home Assistant uses, so a nested button card offers exactly what it offers
  anywhere else: state colours, inverted colours, the lot. It follows any card
  in the suite, and cannot fall behind when one of them grows an option. The
  picker builds button, light, cover, media and compact climate cards from an
  entity; anything else added by hand gets its editor just the same.

- **Room card editor: the cards are editable in the UI.** Entities can be added
  as tiles from a picker, reordered, removed, and each one opens to its entity,
  name, icon and tap action — so a card that should open the details rather than
  switch something off by accident is a dropdown, not a YAML edit. Card types
  the picker does not create keep their order and removal controls and say they
  are edited in YAML.

- **Room card: `mode` and `cards`.** A room card can now hold Lovelace cards of
  its own. `auto` is what it has always done — discover the area's devices and
  draw a tile per category — and `manual` draws none of that, leaving the body
  to the cards you list. Either way `cards` renders inside the folding area, so
  a collapsible room card holding that room's sockets is a few lines of config
  rather than a heading card and a hand-built section.

- **Every colour field can take the theme's colour, and now says so.** A card's
  colour has always accepted `primary`, which resolves to the theme's accent —
  under Material You, the tone generated from the wallpaper. It was a token you
  had to know to type into a free-text field. Each colour row now carries a
  palette button that sets it, and shows itself as pressed while a colour is the
  theme's. One shared row, so all 36 cards gained it at once.

- **`src/shared/template-sub.ts`** — the `render_template` websocket
  subscription manager: one subscription per unique template, ref-counted and
  shared between fields, closed together when the card leaves the page. This is
  the live, pushed subscription, not the one-shot evaluator an automation uses;
  the two are easy to confuse and have different capabilities.

- **`src/shared/sheet-gesture.ts`** — pointer drag with a velocity estimate and
  snap-point resolution, plus the scroll-versus-sheet rule above. Nothing in the
  suite tracked pointer velocity before; the light card's sliders are position-
  follows-finger with no notion of a throw.

- **`src/shared/tap-hold.ts`** — tap, hold and double-tap told apart from each
  other and from a drag. `shared/actions.ts` has said since it was written that
  the next card needing this should not write a third copy; this is that module.
  The button card is deliberately left on its own copy for now — it is the
  most-used card in the suite and gains nothing from the change today.

- **`src/shared/card-helpers.ts`** — `loadCardHelpers()` / `createCardElement()`
  for hosting arbitrary Lovelace cards, with the two lifecycle rules that are
  easy to get wrong: build on a config change and never in the render path, and
  push a fresh `hass` into every nested card on every tick.

### Changed

- The suite registers **36 cards**.

### Fixed

- **Discovering cards fetched the entity registry once per card.** Each
  `discover*` helper made its own `config/entity_registry/list` call plus the
  device and area lists, so six discovering cards on one dashboard pulled the
  same 4,496-entry registry six times over the websocket, on every reconnect.
  The frontend already holds all three registries on `hass` — this file's own
  area functions have read them from there all along — so discovery now does
  too, keeping the websocket only for a frontend old enough to lack them. The
  snapshot leaves out disabled entities, which changes nothing: discovery
  starts from `hass.states`, and a disabled entity has no state.

- **Opening "Add card" ran a full-house scan nine times over.** Home Assistant
  builds a real, `hass`-wired element of every registered card type just to
  draw its preview thumbnail in the picker. For the eight auto-discovering
  cards that meant a complete entity scan each, and for the calendar card a
  live backend fetch of every configured calendar — all to fill a thumbnail.
  Those nine cards no longer offer a picker preview.

  Both fixes were found in [UHaFnir's fork](https://github.com/UHaFnir/m3-cards)
  and reimplemented here.

- **Editors: some settings showed their raw config key instead of a name.**
  The shared appearance block supplies the glass, corner-shape and per-corner
  fields, but labelling them was left to each card — and eight editors
  (calendar, clock, cover, humidifier, leak, NAS, room, waste) never mapped
  them, so `glass_background` and `radius_preset` appeared verbatim. The block
  now labels its own fields when a card offers nothing, which fixes all eight
  at once and means a new card cannot forget. A sweep of every schema field in
  all 35 editors then found five more falling through: the animation dropdown
  on the calendar and humidifier cards, an entry's colour and the badge source
  on the nav card, and a tile override's tap action on the room card. All 610
  fields now resolve to a translated label.

- **Nav card: the marker had more air above and below it than beside it.** The
  round action button sits next to the bar rather than inside it, so it never
  saw `--nav-scale` — that variable is set on the bar, and a sibling does not
  inherit from a sibling. It also counted its glass border outside its height
  while the bar counts its own inside. Both errors made the button taller than
  the bar, a stretching row passed the difference to the bar, and centring left
  the surplus as a margin above and below the marker: 9.5 px against 6.4 px at
  the sides on a scaled-down bar. The row now shares its variables, and the
  button takes its size from the row instead of naming a number — so it is a
  circle exactly as tall as the bar at any scale, and the marker sits with the
  same air on all four sides.

- **Nav card: the bar's default corner missed the capsule by a pixel.** 30 px
  against a bar 62 px tall leaves 1 px of straight edge in the middle of each
  end, and that does not read as a rounded rectangle — it reads as a capsule
  that has been squashed, which is exactly what someone comparing it against a
  reference bar sees. Scaling the bar made it worse, because the number stayed
  while the height moved. The default is now the shape rather than a
  measurement: a radius no bar can reach, which the browser clamps to half
  whatever the height turns out to be. A configured `radius` still wins — but a
  value just under half the bar's height buys the same squashed look
  deliberately.

- **Nav card editor: the page transition sat under Appearance.** What happens
  when the page changes is behaviour; only the marker's own movement is about
  how the bar looks. Its length now appears only once a transition is chosen,
  instead of asking for a number that governs nothing.

- **Nav card: the warning for a second drawer on one view was never shown.** The
  card has always rendered the second one inline rather than docking it; the
  text explaining why existed but nothing displayed it. It now appears in the
  card's edit frame, where the situation actually arises.

- **Nav card editor: the round button was filed under Behaviour.** It is a
  visible part of the bar, and someone looking for a button to add or remove
  goes to Appearance. Moved there, above the advanced panel, so it is in view
  without opening anything.

- **Nav card editor: the round button had no on/off switch.** It exists only
  when it has an icon, so adding one meant knowing to fill an icon field and
  removing it meant clearing that field again — neither of which the editor
  said anywhere. There is a switch for it now, and the button's own fields and
  its menu appear only while it is on.

- **Nav card: the plate behind an unselected entry did not match the marker.**
  With `item_background` the faint plate was always drawn on the whole entry,
  while in the stacked variants the active marker sits on the icon — so the
  quiet tiles were half again as wide as the selected one and carried a
  different corner radius. Both now sit on whichever box the variant marks.

- **Nav card: a docked bar spanned its own column, not the view.** The bar looks
  up the tree for the view's content area so it can dock without running under
  the sidebar, and gave up after twelve steps. Nearly every step crosses a
  shadow boundary — card wrapper, section, sections view, view container — so on
  a desktop the walk ran out inside the card's own grid column and took that for
  the content area: a glass panel a few hundred pixels wide, floating in the
  middle of the screen with an edge at each end.

- **Nav card: the marker on an icon-only bar was a circle.** It should be the
  same capsule the bars with labels wear, only without words under it. A circle
  is a different shape and a heavier one, and it made a compact dock look
  unrelated to the other variants.

- **Nav card: `max_width: fit` never actually capped the bar.** The cap was
  written as `min(var(--nav-max-width), 100%)`, and that variable holds the
  keyword `fit-content` — a keyword inside `min()` is invalid at computed-value
  time, so the browser threw the whole declaration away and fell back to `none`.
  The entries hugged, the bar did not: it stayed the full width with its
  contents spread across it, which is the opposite of what the option promises.
  Hugging is done with `width: fit-content` now, and the remaining cap is a real
  length. Beside a round action button the bar no longer grows to fill the row
  either.

- **Nav card: a docked bar (`header`/`footer`) shrank to its entries.** With a
  width cap the glass panel hugged the entries and left a visible edge at each
  end, mid-screen. A docked bar is now always the full width of what it docks
  to; the cap decides how far the entries spread inside it.

- **Nav card: returning to a page slid the marker off the wrong entry.** A card
  goes on rendering while it is still mounted but no longer the page you are on:
  it hears the navigation and moves its marker to the entry you just left for.
  Home Assistant caches the view in exactly that state, so it comes back marking
  the wrong entry — and the correction was animated, sliding the pill off a
  neighbour over the length of a transition. That is the flash: not the wrong
  page being marked, but the right one arriving late. The first paint after a
  card comes back on screen no longer animates its marker.

- **Nav card: tapping an entry could flash the page next to it.** The shield
  that keeps a dashboard swipe plugin out of the bar covered the start of a
  gesture but not its end. hass-swipe-navigation decides on `touchend`, and that
  handler reads no event at all — only the start and movement it recorded
  earlier. Swallowing the start and letting the end through left it deciding a
  tap on the bar from coordinates of some earlier touch elsewhere on the page,
  and navigating one view sideways on the strength of it. That is the box that
  appeared for an instant on the entry beside the one that was tapped, always a
  neighbour, never the same one twice. The shield now covers the whole gesture.

- **Nav card: the wrong entry could flash for a frame when navigating.** The
  card corrected a stale path in `updated()` — after the render. So a render
  that started with the old path painted the old entry and put it right on the
  next frame, which is exactly a box blinking on a neighbour of the page you
  opened. The correction happens before the render now.

- **Nav card: a docked bar stopped short of both screen edges.** `header` and
  `footer` match the width of the content area so they do not run under the
  sidebar — but a view is also padded away from the screen edges, and that
  padding went into the same measurement. On a phone, where there is no sidebar,
  padding was all it ever found, so the bar sat inside a gap on both sides. An
  inset smaller than the collapsed sidebar is now read as padding and ignored.

- **Nav card: the pill around a sideways entry was not a capsule.** The corner
  radius is shared with entries the width of an icon, where it reads as a
  rounded square; stretched around an icon and a label it left the ends
  visibly flattened. A pill that wraps both is now rounded by half its own
  height, as a pill is.

- **Nav card: an entry with its label beside the icon was lopsided.** The
  stacked variants size the glyph into a 56px indicator box, which is right
  when the label sits underneath it and wrong when it sits next to it: the icon
  floated in a box more than twice its width and pushed the label off centre.
  Sideways, the glyph is now the icon and nothing else, and the entry is padded
  tight on the icon side so both ends of the pill look even.

- **Nav card: the bar appeared to jump between pages.** Every view carries its
  own nav card, and a browser drops an element's scroll offset when it leaves
  the document — which Home Assistant does to cache a view. So each bar arrived
  scrolled hard left and then corrected itself, in whichever direction the
  active entry happened to lie. Bars showing the same entries now share the
  last offset, so the row picks up where the previous page left it, and the
  correction on top of that moves the smallest distance that brings the active
  entry fully into view. Neither is animated: animating a correction that
  starts from a position the reader never saw is what made it look like a
  swipe.

- **Nav card: the bar sat on the gesture bar, not above it.** The card asked
  for `env(safe-area-inset-bottom)`, which an Android WebView reports as 0 even
  on a phone with gesture navigation. Home Assistant publishes the real value
  as `--safe-area-inset-bottom`, fed by the companion app; the card reads that
  now and keeps `env()` as the fallback for a plain browser.

- **Nav card: the active entry could be scrolled out of sight.** A bar with
  more entries than fit scrolls, and every view carries its own card — so
  navigating built a fresh bar scrolled to the far left. If the entry for that
  page sat past the right edge, the bar looked like it had jumped back to the
  first entry and lost its highlight. The highlight was always correct, just
  off-screen. The bar scrolls it into view now, and only when the page actually
  changed, so scrolling through the entries by hand is never yanked back.

- **Nav card: the active entry was one navigation behind.** Home Assistant
  keeps view elements in a cache and puts the same card back when you return to
  a view, and the card read the current path once, at construction. A card
  coming back out of that cache still knew the path it was put away with, so it
  highlighted the page you had just left until something forced a re-render.
  The path is re-read on reconnect now.

- **Nav card: a dashboard swipe plugin stole sideways drags.** A bar with more
  entries than fit scrolls sideways, and `hass-swipe-navigation` read that
  scroll as "next view" and navigated away mid-gesture. The card shields itself
  the way the light card's sliders already do (`shared/swipe.ts`) — over the
  whole card, because nothing it draws is ever a request to change the view by
  swiping.

- **Button card: `static_color` made the tile look switched off.** It works by
  rendering the card as inactive, which was only ever about colour — but the new
  off icon and state shape read that same flag, so a fridge that was running
  showed a crossed-out icon and the off outline. Those two follow the entity
  now; `static_color` keeps meaning what its name says.

- **Button card editor: it had its own copy of the colour row.** Nearly the same
  as the shared one, but with a better swatch fallback — and it missed the new
  theme button entirely. The improvement moved into the shared row and the copy
  is gone.

- **Button card editor: `icon_off` showed empty even when set.** The field was
  in the form's schema but not in the data handed to it, so a configured off
  icon was invisible to the editor.

- **Button card editor: the shape and fill switches sat under Content.** Both
  decide how the tile looks — one of them decides which way round the accent
  and the glyph are used — so they belong beside the colours.

- **Button card: the tile's corners barely moved until the end.** The off state
  asked for a 999px radius, the idiom for a capsule. A browser clamps that when
  it paints — to half the height — but interpolates the number it was given, so
  a change to 16px spent 98% of its time above the clamp: the outline sat still
  and then squared off at the last moment, while the icon well moved the whole
  way. The off radius is now measured from the card, half its actual height, so
  both shapes travel a comparable distance and arrive together.

- **Button card: the icon well changed shape before the tile did.** The well
  transitions everything it has over 0.25s on an ease curve; the tile's corners
  were given 0.3s on Material's. The inner shape therefore arrived first and the
  two read as changing for separate reasons. Both corner changes now run on the
  same clock, while the well's colours keep their own.

- **Room card: a manual room always read "all off".** The summary line counted
  the area registry's entities, but manual mode exists precisely for rooms whose
  devices the registry does not know about — so a card showing six sockets, half
  of them on, said nothing was running. It now counts what it actually shows,
  nested stacks included, and re-renders when any of those entities changes.

- **Room card: the scroll into view came to rest under a docked bar.** Two
  faults, one symptom. The search for whatever covers the bottom of the window
  asked the point what was under it, and `elementsFromPoint` hands back a shadow
  host rather than what is inside it, so following it down one branch walked
  into the card being scrolled and never reached the navigation bar two sections
  away; the tree is now walked instead. And the plausibility check that rejects
  a "bar" taller than half the screen ran on the largest match rather than on
  each candidate, so a viewport-sized fixed layer — a dashboard has several —
  took the real bar down with it.

- **Room card: the scroll waited for the fold instead of running with it.** The
  furthest the page can be scrolled was worked out once, at the moment of the
  tap — when the card is still folded and that distance barely exists. The first
  movement was therefore whatever little room happened to be there, and the real
  travel only followed afterwards, once the card had finished growing: two
  movements, one after the other, for what should be a single gesture. The
  destination is now re-asked every frame, so the scroll follows the page as it
  grows and the two land together.

- **Room card: scrolling into view did nothing with animations switched off.**
  The path that skips the fold animation returned before the scroll, so a card
  opening past the bottom of the screen stayed there. A card without animations
  still has to be visible.

- **Room card: scrolling a card into view was late and stopped too low.** It
  waited for the fold to finish and then scrolled, which reads as two movements
  with a pause between them — the destination is known before the box grows into
  it, so the two run together now. And it scrolled flush to the bottom of the
  window, which on a dashboard with a docked navigation bar leaves the card's
  last row underneath it. Anything pinned across the bottom edge is measured and
  kept clear.

- **Room card editor: the window list was a text field.** Entity ids nobody
  types from memory were asked for as comma-separated text. It is the same
  picker the power list uses now, filtered to window, door and opening sensors.

- **Room card editor: one card type showed its translation key.** The label was
  derived from the type by string surgery, and `climate-card-mini` came out as a
  key that does not exist — with a cast in the way that stopped the compiler
  from saying so. Each type now carries its own key, checked at build time.

- **Room card editor: the category section showed in manual mode.** It
  configures tiles that manual mode does not draw, so it was a section of
  switches with no effect — including a list of discovered categories that
  looked active but governed nothing.

- **Room card: a fixed blue accent.** A room is a place, not a kind of data with
  a colour of its own, so it follows the dashboard's accent now — which under a
  Material You theme is the wallpaper's tone rather than the one thing on the
  screen that had not been told about the theme.

- **Energy card: a water or gas meter's month was off by a factor of a
  thousand.** Statistics were always requested in m³ for the volume device
  classes, while the value was labelled with the entity's own unit — so a litre
  meter's month read a thousandth of the truth: 57 L of watering appeared as
  "0.06 L". The daily chart was right, because that path asks for no unit at
  all, which made the two views of the same entity disagree. The unit asked for
  is now the one the number is printed with. Multiple sources in mixed units
  still add up: they normalize to the first entity's unit instead of to m³.

### Hinzugefügt

- **Drei Karten aus dem Fork** (`m3-lights-overview-card`,
  `m3-chip-buttons-card`, `m3-group-card`), gebaut von
  [UHaFnir](https://github.com/UHaFnir/m3-cards) und hier nach den
  Gepflogenheiten dieser Sammlung übernommen.

  **Lights Overview** fasst alle `light.*`-Entitäten nach Home-Assistant-Bereich
  zusammen und gibt jedem Raum eine Kachel, die ihn schaltet — oder listet in
  `view: entities` die Lichter einzeln auf, auf Wunsch die eingeschalteten
  zuerst. Zwei getrennte Filter entscheiden, was ein Raum *zeigt* und was ein
  Tippen tatsächlich *schaltet*; ein Raum kann also ein Licht anzeigen, das er
  nicht mitschaltet. `group_handling` lässt entweder eine `light.group` oder
  ihre Mitglieder weg, damit eine Gruppe und die Lichter darin nicht doppelt
  zählen. Ein Tippen kann statt HA's more-info-Dialog ein Popup öffnen, das nur
  diesen einen Raum zeigt.

  **Chip Buttons** ist eine Reihe kompakter Pillen, jede an eine Entität
  gebunden, die umbricht statt zu scrollen. Eine Pille kann ihren Zustand
  anzeigen, ihre Farbe aus der Zustandsfarbe der Entität nehmen, unabhängig vom
  Zustand eine feste Farbe tragen oder als reine Anzeige markiert werden — dann
  ist sie eine Beschriftung, kein Knopf.

  **Group Card** legt mehrere Karten auf eine gemeinsame Fläche mit einem
  Hintergrund und einer Eckenrundung, damit zusammengehörige Karten als ein
  Block gelesen werden statt als einzelne Kacheln mit Lücken dazwischen.

- **Wetterkarte: Kopfbereich und Diagramm schalten unabhängig voneinander.**
  `show_current` und `show_chart` waren vorher eine Entscheidung; eine Karte
  kann jetzt nur die aktuellen Werte zeigen, nur das Vorhersagediagramm oder
  beides. Die Stundenleiste hat `show_hourly_icons`,
  `show_hourly_temperatures`, `show_hour_labels` und eine `show_temp_axis`
  bekommen, und sie dünnt ihre Beschriftungen jetzt auf einen runden Takt aus —
  jede 2., 3., 4. Stunde — statt sie auf einer schmalen Karte zu drängen.
  Ebenfalls aus UHaFnirs Fork.

- **M3 Nav-Karte** (`m3-nav-card`) — das Hauptstück dieser Version: eine
  Navigationsleiste fürs Dashboard, in fünf Varianten. `header` und `footer`
  docken an einen Bildschirmrand, `segmented` ist eine Pillengruppe im Fluss der
  Seite, `floating` löst sich zu einer abgerundeten Leiste, und `sheet` ergänzt
  eine Schublade, die sich über die Ansicht ziehen lässt. Die vier angedockten
  Varianten belegen keine Zeile im Raster: ihr Platz fällt zusammen, sie stellen
  sich selbst an den Bildschirm.

  Einstellbar bis auf das Niveau der Navbar Card aus der Community, aber in der
  Designsprache dieser Sammlung: Abzeichen je Eintrag — eine Vorlage, der
  Zustand einer Entität oder die Anzahl eingeschalteter Entitäten, bei 0, aus,
  leer oder nicht verfügbar automatisch ausgeblendet —, Aufklappmenüs, die aus
  dem Knopf wachsen, der sie geöffnet hat, Aktionen für Tippen, Halten und
  Doppeltippen samt haptischer Rückmeldung von Home Assistant, und getrennte
  Layouts für Desktop und Handy.

  Ob Desktop oder Handy, misst ein ResizeObserver an der **eigenen** Box der
  Karte statt am Fenster per Media Query: eine Karte in einer schmalen Spalte
  auf einem breiten Bildschirm ist schmal, und eine Media Query läge da falsch.

  `name`, `icon`, `color`, `hidden`, `disabled` und das Abzeichen nehmen Jinja2
  und abonnieren es — Home Assistant schickt einen neuen Wert, sobald sich
  irgendetwas ändert, das die Vorlage liest. Nur Felder, die tatsächlich `{{`
  oder `{%` enthalten, öffnen ein Abonnement, und gleiche Vorlagen teilen sich
  eines.

  Die Schublade wird gezogen, und das Interessante daran ist nicht das Ziehen,
  sondern der Konflikt mit dem Scrollen ihres Inhalts: der Inhalt scrollt ganz
  normal, und die Schublade übernimmt erst, wenn er schon oben steht und der
  Finger nach unten geht. Beim Loslassen springt sie zum nächsten Rastpunkt —
  außer beim Schnippen, dann fliegt sie in die geworfene Richtung, gleich wo sie
  gerade stand. Im Bearbeitungsmodus wird sie eingebettet und offen gezeichnet,
  weil eine am Bildschirm angedockte Schublade genau die Karte verdeckt, die der
  Editor zeigen will; und nur die erste Schublade einer Ansicht dockt sich an.

  `preload_views` wird angenommen und gespeichert, tut aber nichts: Home
  Assistant gibt einer eigenen Karte keine Möglichkeit, eine andere Ansicht
  vorzuwärmen, und der einzige Behelf würde flackern und einen falschen
  Verlaufseintrag hinterlassen. Der Schlüssel bleibt reserviert, damit eine
  spätere Fassung ihn umsetzen kann, ohne bestehende Konfigurationen zu brechen.
  Sichtbarkeit der ganzen Karte nach Benutzer, Gerät oder Bildschirmgröße wird
  ebenfalls **nicht** nachgebaut — Home Assistants eigenes `visibility` kann das
  längst für jede Karte, und `hidden` bleibt auf das beschränkt, was nur eine
  Vorlage beantworten kann.

- **Kalender- und Raumkarte: Das Fenster, das sich über ihnen öffnet, war bei
  Glas-Themes durchsichtig.** Gemeldet an den Termindetails der Kalenderkarte,
  wo die Agenda-Zeilen mitten durch Titel und Knöpfe zu lesen waren. Beide
  Fenster nahmen ihren Hintergrund von der Kartenfarbe des Themes — die richtige
  Quelle für eine Karte und die falsche für etwas, das darüber liegt: Ein
  Glas-Theme macht genau diese Farbe absichtlich halbtransparent. Die Farbe wird
  weiterhin benutzt, jetzt aber über einem deckenden Untergrund, sodass das
  Fenster zum Theme passt und trotzdem verdeckt, was darunter liegt. Die
  Kartenflächen selbst bleiben unangetastet — eine Karte *soll* das
  Hintergrundbild durchscheinen lassen.

- **Kostenkarte: Beim Monatswechsel schossen die Prognosebalken oben aus der
  Karte heraus.** Für einen Frame gehörte die Zahl der vergangenen Tage schon
  zur neuen Periode, die Summe aber noch zur alten — der Tagesdurchschnitt war
  damit die Summe des einen Monats geteilt durch die Tage des anderen und um ein
  Vielfaches zu groß. Genau mit diesem Durchschnitt werden die gestrichelten
  Balken gezeichnet, und er war der einzige Wert, den die Skala nicht kannte:
  Das Maximum lief nur über die erfassten Tage. Die Balken liefen über Betrag
  und Vergleichs-Chip, bis der nächste Frame es richtigstellte. Der Durchschnitt
  gehört jetzt zur Skala, und zusätzlich wird die Balkenhöhe auf das Diagramm
  begrenzt. Die Reihe selbst kann nicht abschneiden, weil die Wertblase
  absichtlich über ihr sitzt.

- **Nav-Karte: Ein Tipp außerhalb schließt die geöffnete Schublade.** Jedes
  Sheet macht das, dieses nicht: zurück kam man nur über den Griff oder durch
  Ziehen. Es ist eine eigene Fläche und kein Listener am Dokument, weil der Tipp
  *verbraucht* werden muss — ließe man ihn zur Seite durch, würde ein Tipp
  daneben die Schublade schließen *und* drücken, was darunter liegt: etwas
  eingeschaltet von jemandem, der nur die Schublade wegräumen wollte. Die Fläche
  ist unsichtbar; ein abgedunkelter Scrim wäre die andere ehrliche Antwort,
  ändert aber das Aussehen des Dashboards in dem Moment, in dem sich die
  Schublade öffnet, und danach hat niemand gefragt. Im Bearbeitungsmodus bleibt
  die Schublade offen und bekommt keine Fläche — sonst läge sie zwischen dem
  Editor und der Karte, die er bearbeitet.

- **Nav-Karte: Eine neue Karte kommt ausgefüllt vom Dashboard, auf dem sie
  landet.** Bisher begann sie mit zwei erfundenen Einträgen auf Ansichten, die
  es vielleicht gar nicht gibt — ein schlechterer Anfang als gar keiner, denn
  erst muss man verstehen, was die Form bedeutet, bevor man sie ersetzen kann.
  Die Ansichten stehen in der Konfiguration des Dashboards, also bietet die
  Karte sie an: die ersten drei als Einträge, die nächsten fünf hinter dem
  runden Knopf — die Anordnung, in der eine Leiste mit mehr Seiten als Platz
  ohnehin endet. Unteransichten bleiben außen vor, weil sie aus einer anderen
  Ansicht geöffnet werden und nicht aus der Reiterleiste, und eine erste Ansicht
  ohne eigenen Pfad wird über ihren Index angesprochen, so wie es eine von Hand
  gebaute Leiste tut. Es ist ein Vorschlag und sonst nichts: Die Einträge sind
  sofort gewöhnliche Konfiguration, und niemand liest das Dashboard erneut,
  solange nicht „Ansichten übernehmen" gedrückt wird.

- **Nav-Karte: Die Standardfarbe folgt dem Theme.** Sie war ein festes Blau aus
  der Palette der Sammlung — unter einem Material-You-Theme also das einzige auf
  dem Dashboard, das nicht den aus dem Hintergrundbild erzeugten Ton trägt. Eine
  Navigation ist der Rahmen um alles andere und hat keinen eigenen Farbton zu
  vertreten; der Standard ist jetzt `primary`, wie bei der Button-Karte.
  `accent_color` und die Farbe je Eintrag bleiben unverändert.

- **Nav-Karte: `page_transition_ms`** — wie lange diese Überblendung läuft,
  standardmäßig 180 ms statt der 250 ms des Browsers, die für einen selbst
  ausgelösten Wechsel träge wirken. Als einzelnes Style-Element im Dokument
  hinterlegt, weil die Pseudo-Elemente einer View-Transition am Wurzelelement
  hängen und aus einem Shadow Root nicht erreichbar sind.

- **Nav-Karte: `page_transition: up`** — Materials Fade-Through, und die
  Einstellung, auf die es ankommt. Ein reines Überblenden zwischen zwei Seiten
  mit gleichem Hintergrundbild und gleicher Navigationsleiste ist unsichtbar: die
  Seiten sehen gleich aus, während sie ineinander übergehen, der Wechsel wirkt
  also weiterhin wie ein Sprung, egal wie lange er dauert. Jetzt geht erst die
  alte Seite, dann steigt die neue ein Stück herein — das macht den Wechsel
  überhaupt erst sichtbar.

- **Nav-Karte: `page_transition`** — blendet die ganze Seite über, wenn die
  Navigation von der Leiste ausgeht. Die Karte kann den Ansichtswechsel von Home
  Assistant nicht von außen animieren, sie stößt ihn aber an, und eine
  View-Transition umschließt alles, was innerhalb ihres Rückrufs im DOM passiert.
  Nur Navigationen bekommen sie; ein Browser ohne View-Transitions wechselt
  genau wie bisher.

- **Nav-Karte: `marker_motion`** — `slide` bewegt eine einzelne Fläche zwischen
  den Einträgen, statt eine aus- und eine einzublenden. Beim Ankommen auf einer
  Seite gleitet nichts: die Markierung steht schlicht schon richtig.

- **Nav-Karte: `pill_size`** — skaliert allein die Markierung um den aktiven
  Eintrag. Die Varianten markieren unterschiedliche Kästen, dieselbe Zahl wirkt
  aber auf beide: die Fläche ums Icon bei den gestapelten, den ganzen Eintrag,
  wo der Text daneben steht.

- **Nav-Karte: `label_size`**, und ein größerer Standard für Text neben dem Icon.
  11px ist die Größe, die Material einem Text *unter* einem Icon gibt, wo er die
  zweite Hälfte des Paars ist; neben einer 22px-Glyphe wirkte er wie eine
  Bildunterschrift statt wie der Name des Eintrags. Neben dem Icon sind es jetzt
  standardmäßig 14px, und `label_size` überschreibt beides.

- **Nav-Karte: `label_position`** — ob der Text eines Eintrags unter, über,
  rechts oder links neben seinem Icon steht. Die beiden waagerechten Varianten
  verschieben auch die aktive Pille, sodass sie Icon und Text gemeinsam
  umschließt: eine Pille nur ums Icon, mit dem Text daneben außerhalb, ist keine
  Form, die irgendwo so gezeichnet wird.

- **Nav-Karte: `inactive_only`** für `label_visibility` und `icon_visibility` —
  das fehlende Gegenstück zu `active_only`. Zusammen ergeben sie eine Leiste,
  in der die ausgewählte Seite als Text erscheint und alle anderen als Icon.

- **Nav-Karte: Der Aktionsknopf kann ein Menü öffnen.** Bekommt `action_button`
  ein `menu`, steigen beim Antippen beschriftete Pillen aus dem Knopf auf — jede
  mit eigenem Text, Icon, eigener Farbe und Aktion — während der Knopf selbst
  vom Kreis zum abgerundeten Quadrat wird und `close_icon` zeigt. Ohne `menu`
  bleibt er die schlichte Abkürzung, die er war. Die Einträge stehen immer im
  DOM und werden nur über eine Klasse gezeigt, damit sie beim Schließen in den
  Knopf zurückklappen statt zu verschwinden.

- **Nav-Karte: `edge_distance`** — wie weit die Leiste vom Bildschirmrand
  wegrückt, an dem sie klebt, in px, mit Schieberegler im Editor. Der Wert kommt
  zusätzlich zur Safe Area des Geräts, nicht statt ihr; kein Wert kann die
  Leiste also auf die Gestenleiste des Handys schieben.

- **Button-Karte: `icon_fill: solid`** — dreht das aktive Paar um. Die Fläche
  bekommt die Akzentfarbe, die Glyphe wird dagegen abgedunkelt, statt einer
  zarten Akzentfläche mit akzentfarbener Glyphe. Die kräftigere der beiden
  Varianten, und die, die man aus einigen Metern zuerst liest.

- **Button-Karte: `icon_off`** — ein zweites Icon für den Aus-Zustand. Viele
  Symbole haben ein durchgestrichenes Gegenstück, und das liest sich schneller
  als „nicht an" als jede Farbe. Ohne Angabe gilt weiterhin `icon`.

- **Button-Karte: `shape_by_state`** — der Umriss folgt der Entität, so wie es
  die Schnelleinstellungen eines Handys machen: Kapsel im Aus, der konfigurierte
  Eckenradius im An, und das Icon-Feld wandert dabei vom Kreis zum abgerundeten
  Quadrat. Animiert, standardmäßig aus. Der Zustand steht damit in einem zweiten
  Kanal: aus einiger Entfernung liest man die Form vor der Farbe. Der Radius im
  Ein-Zustand ist standardmäßig 16px statt der sonst üblichen 28px — 28px sind
  auf einer Kachel von einer Rasterzeile Höhe die halbe Höhe und damit bereits
  eine Kapsel, beide Zustände wurden also richtig berechnet und sahen doch gleich
  aus. Ein ausdrücklich gesetzter `radius` gilt weiterhin.

- **Raumkarte: `scroll_on_expand` und `scroll_duration`** — holt die Karte nach
  dem Aufklappen ins Sichtfeld. Eine eingeklappte Karte am unteren Rand öffnet
  sich nach unten aus dem Bild heraus; ausgerechnet das, was man sehen wollte,
  sieht man dann nicht. Gescrollt wird so wenig wie möglich, gar nicht, wenn die
  Karte ohnehin ganz zu sehen ist, und mit Platz für alles, was unten am
  Fensterrand klebt — auch für eine Navigationsleiste aus dieser Sammlung, egal
  wie tief im Shadow DOM sie sitzt. `scroll_duration` bestimmt, wie lange das
  dauert; die voreingestellten 240 ms sind bewusst kürzer als das weiche
  Scrollen des Browsers, das sein Tempo aus der Entfernung ableitet und so
  wirkt, als ließe sich die Seite Zeit mit einem längst beantworteten Tippen.

- **Raumkarte: `collapse_memory`** — wie lange ein Auf- oder Zugeklappt gemerkt
  wird. Bisher immer auf dem Gerät, eine offen gelassene Karte blieb also für
  immer offen; das passt zu einem einmal eingerichteten Dashboard und steht
  einem im Weg, das jedes Mal mit der Übersicht beginnen soll. `session` merkt
  sich den Zustand nur, solange die App läuft: er folgt dir weiterhin durchs
  Dashboard, und beim nächsten Start ist wieder alles eingeklappt. Ein
  eingetragenes `collapse_state_entity` sticht das weiterhin, denn ein Helfer
  ist eine bewusste Antwort auf dieselbe Frage.

- **Raumkarte: `door_entities`** — Kontakte, die getrennt von den Fenstern zählen,
  mit eigenem Chip. Eine offene Tür und ein offenes Fenster sind verschiedene
  Tatsachen, und eine Raumkarte, die beides zusammenzählt, beantwortet keine von
  beiden. Es muss eine ausdrückliche Liste sein, weil Home Assistant fast jeden
  Kontaktsensor als `door` führt, woran er auch hängt — die Unterscheidung ist
  nicht erkennbar. Was hier steht, zählt nie zusätzlich bei den Fenstern.

- **Raumkarte: `power_entities`** — mehrere Leistungssensoren, die zusammengezählt
  werden, im Editor über einen Entitätswähler auszuwählen. Der Verbrauch eines
  Raums ist meist die Summe seiner Steckdosen, und die Karte konnte bisher nur
  einen Sensor benennen: die automatische Suche nahm den ersten im Bereich, was
  in einem Flur mit Hausanschlusszähler einen Chip ergab, der die ganze Phase als
  Raumverbrauch auswies. Nicht verfügbare Messwerte werden übersprungen statt als
  Null gezählt.

- **Raumkarten-Editor: Jede eingebettete Karte öffnet ihren eigenen Editor.**
  Keine handverlesene Auswahl an Feldern — die Karte wird nach ihrem Editor
  gefragt, über denselben Vertrag, den Home Assistant selbst nutzt. Eine
  eingebettete Button-Karte bietet damit genau das, was sie überall sonst bietet:
  Zustandsfarben, invertierte Farben, alles. Das gilt für jede Karte der Sammlung
  und kann nicht veralten, wenn eine davon eine Option dazubekommt. Der Wähler
  legt Button-, Licht-, Rollladen-, Medien- und kompakte Klima-Karten aus einer
  Entität an; alles andere von Hand eingetragene bekommt seinen Editor ebenso.

- **Raumkarten-Editor: Die Karten sind in der Oberfläche bearbeitbar.** Entitäten
  lassen sich als Kacheln hinzufügen, sortieren, entfernen, und jede klappt zu
  Entität, Name, Icon und Tipp-Aktion auf — eine Kachel, die lieber die Details
  öffnet als versehentlich etwas abzuschalten, ist damit ein Auswahlfeld statt
  einer YAML-Änderung. Kartentypen, die der Wähler nicht anlegt, behalten
  Sortierung und Entfernen und sagen, dass sie im YAML bearbeitet werden.

- **Raumkarte: `mode` und `cards`.** Eine Raumkarte kann jetzt eigene
  Lovelace-Karten aufnehmen. `auto` ist, was sie immer getan hat — die Geräte des
  Bereichs erkennen und je Gerätetyp eine Kachel zeichnen — und `manual`
  zeichnet davon nichts, sondern überlässt den Inhalt den eingetragenen Karten.
  In beiden Fällen stehen sie im aufklappbaren Bereich; eine zusammenklappbare
  Raumkarte mit den Steckdosen dieses Raums sind damit ein paar Zeilen
  Konfiguration statt einer Heading-Karte mit handgebauter Sektion.

- **Jedes Farbfeld kann die Themefarbe übernehmen — und sagt das jetzt auch.**
  Die Farbe einer Karte akzeptiert seit jeher `primary`, was den Akzent des
  Themes bedeutet: unter Material You der aus dem Hintergrundbild erzeugte Ton.
  Nur musste man dieses Wort kennen und in ein Freitextfeld tippen. Jede
  Farbzeile hat jetzt einen Palettenknopf, der das setzt, und zeigt sich
  gedrückt, solange eine Farbe die des Themes ist. Eine geteilte Zeile — alle 36
  Karten haben es damit auf einen Schlag.

- **`src/shared/template-sub.ts`** — die Verwaltung der
  `render_template`-Abonnements über die Websocket-Verbindung: ein Abonnement je
  eindeutiger Vorlage, mit Referenzzählung, von mehreren Feldern geteilt und
  gemeinsam geschlossen, wenn die Karte die Seite verlässt. Das ist das lebende,
  geschobene Abonnement, nicht der einmalige Auswerter, den eine Automatisierung
  benutzt; die beiden werden leicht verwechselt und können Unterschiedliches.

- **`src/shared/sheet-gesture.ts`** — Zeigerbewegung mit Geschwindigkeits-
  schätzung und Auflösung der Rastpunkte, dazu die oben beschriebene Regel für
  Scrollen gegen Schublade. Vorher hat in der Sammlung nichts die Geschwindigkeit
  eines Zeigers verfolgt; die Schieber der Licht-Karte folgen dem Finger und
  kennen keinen Wurf.

- **`src/shared/tap-hold.ts`** — Tippen, Halten und Doppeltippen voneinander und
  vom Ziehen unterschieden. In `shared/actions.ts` steht seit seiner Entstehung,
  dass die nächste Karte, die das braucht, keine dritte Kopie schreiben soll;
  das ist dieses Modul. Die Button-Karte bleibt bewusst noch bei ihrer eigenen
  Kopie — sie ist die meistgenutzte Karte der Sammlung und gewinnt heute nichts
  durch den Umbau.

- **`src/shared/card-helpers.ts`** — `loadCardHelpers()` / `createCardElement()`
  zum Einbetten beliebiger Lovelace-Karten, mit den beiden Lebenszyklus-Regeln,
  die man leicht falsch macht: bei einer Konfigurationsänderung bauen und
  niemals im Render-Pfad, und in jedem Tick ein frisches `hass` in jede
  eingebettete Karte schieben.

### Geändert

- Die Sammlung registriert **36 Karten**.

### Behoben

- **Erkennende Karten holten die Entitäts-Registry einmal pro Karte.** Jede
  `discover*`-Funktion setzte ihren eigenen Aufruf von
  `config/entity_registry/list` ab, dazu Geräte- und Bereichsliste. Sechs
  erkennende Karten auf einem Dashboard zogen dieselbe Registry mit 4.496
  Einträgen also sechsmal über den Websocket, und das bei jedem Neuverbinden.
  Das Frontend hält alle drei Registries ohnehin auf `hass` — die
  Bereichsfunktionen derselben Datei lesen von dort seit jeher —, und die
  Erkennung tut es jetzt auch; der Websocket bleibt nur als Rückfall für ein
  Frontend, das die Snapshots noch nicht kennt. Im Snapshot fehlen
  deaktivierte Entitäten, was nichts ändert: Die Erkennung geht von
  `hass.states` aus, und eine deaktivierte Entität hat keinen Zustand.

- **„Karte hinzufügen“ löste neunmal eine Rundum-Erkennung aus.** Home
  Assistant erzeugt von jedem angemeldeten Kartentyp ein echtes, mit `hass`
  verbundenes Element, nur um im Auswahldialog das Vorschaubild zu zeichnen.
  Bei den acht selbsterkennenden Karten bedeutete das je einen vollständigen
  Durchlauf über alle Entitäten, bei der Kalenderkarte einen echten Abruf
  sämtlicher Termine — alles für ein Vorschaubild. Diese neun Karten haben im
  Auswahldialog jetzt keine Vorschau mehr.

  Beide Funde stammen aus [UHaFnirs Fork](https://github.com/UHaFnir/m3-cards)
  und wurden hier neu umgesetzt.

- **Editoren: Einige Einstellungen zeigten ihren Konfigurationsschlüssel statt
  eines Namens.** Der gemeinsame Abschnitt „Erscheinungsbild“ liefert die
  Felder für Glas, Eckenform und Einzelecken, das Beschriften blieb aber jeder
  Karte selbst überlassen — und acht Editoren (Kalender, Uhr, Cover,
  Luftbefeuchter, Leak, NAS, Raum, Waste) haben sie nie zugeordnet, sodass dort
  `glass_background` und `radius_preset` wörtlich standen. Der Abschnitt
  beschriftet seine eigenen Felder jetzt selbst, wenn die Karte nichts liefert:
  Das behebt alle acht auf einmal, und eine neue Karte kann es nicht mehr
  vergessen. Eine Prüfung sämtlicher Schemafelder in allen 35 Editoren fand
  danach fünf weitere: die Animationsauswahl bei Kalender- und
  Luftbefeuchter-Karte, Farbe und Badge-Inhalt eines Eintrags bei der
  Navigationskarte sowie die Tap-Aktion einer Kachel-Anpassung bei der
  Raumkarte. Alle 610 Felder haben jetzt eine übersetzte Beschriftung.

- **Nav-Karte: Über und unter der Markierung war mehr Luft als daneben.** Der
  runde Aktionsknopf steht neben der Leiste, nicht in ihr, und sah `--nav-scale`
  deshalb nie — die Variable sitzt auf der Leiste, und ein Geschwister erbt
  nicht vom Geschwister. Zudem rechnete er seinen Glasrand außerhalb seiner
  Höhe, während die Leiste ihren innerhalb zählt. Beides machte den Knopf höher
  als die Leiste, eine streckende Zeile reichte die Differenz an die Leiste
  weiter, und das Zentrieren legte den Überschuss als Rand über und unter die
  Markierung: 9,5 px gegen 6,4 px an den Seiten bei verkleinerter Leiste. Die
  Zeile teilt ihre Variablen jetzt, und der Knopf nimmt seine Größe aus der
  Zeile statt aus einer Zahl — er ist damit bei jeder Skalierung ein Kreis
  von exakt Leistenhöhe, und die Markierung hat auf allen vier Seiten
  denselben Abstand.

- **Nav-Karte: Die voreingestellte Ecke der Leiste verfehlte die Kapsel um einen
  Pixel.** 30 px bei einer 62 px hohen Leiste lassen in der Mitte jedes Endes
  1 px gerade Kante stehen, und das wirkt nicht wie ein abgerundetes Rechteck,
  sondern wie eine gestauchte Kapsel — genau das, was auffällt, wenn man
  daneben eine Vorbild-Leiste hält. Beim Skalieren wurde es schlimmer, weil die
  Zahl blieb und die Höhe sich bewegte. Voreingestellt ist jetzt die Form statt
  eines Maßes: ein Radius, den keine Leiste erreicht, den der Browser also auf
  die halbe tatsächliche Höhe begrenzt. Ein gesetztes `radius` sticht das
  weiterhin — ein Wert knapp unter der halben Leistenhöhe kauft dann aber
  denselben gestauchten Eindruck mit Absicht.

- **Nav-Karten-Editor: Der Seitenübergang lag unter Darstellung.** Was beim
  Seitenwechsel passiert, ist Verhalten; nur die Bewegung der Markierung
  betrifft das Aussehen der Leiste. Die Dauer erscheint jetzt erst, wenn ein
  Übergang gewählt ist, statt nach einer Zahl zu fragen, die nichts steuert.

- **Nav-Karte: Die Warnung bei einer zweiten Schublade auf einer Ansicht wurde
  nie angezeigt.** Die Karte zeichnet die zweite seit jeher im Kartenfluss statt
  angedockt; der erklärende Text existierte, nur zeigte ihn nichts an. Er steht
  jetzt im Bearbeitungsrahmen der Karte, wo der Fall auftritt.

- **Nav-Karten-Editor: Der runde Knopf lag unter Verhalten.** Er ist ein
  sichtbarer Teil der Leiste, und wer einen Knopf hinzufügen oder entfernen will,
  sucht unter Darstellung. Dorthin verschoben, über den erweiterten Bereich,
  damit er ohne Aufklappen zu sehen ist.

- **Nav-Karten-Editor: Für den runden Knopf gab es keinen Schalter.** Er
  existiert nur, wenn er ein Icon hat — ihn hinzuzufügen hieß also zu wissen,
  dass man ein Icon-Feld ausfüllen muss, und ihn zu entfernen, dieses Feld wieder
  zu leeren. Beides stand nirgends. Jetzt gibt es einen Schalter dafür, und die
  Felder des Knopfes samt seinem Menü erscheinen nur, solange er an ist.

- **Nav-Karte: Die Fläche hinter einem nicht gewählten Eintrag passte nicht zur
  Markierung.** Mit `item_background` wurde die dezente Fläche immer auf den
  ganzen Eintrag gezeichnet, während die aktive Markierung bei den gestapelten
  Varianten auf dem Icon sitzt — die ruhigen Kacheln waren dadurch um die Hälfte
  breiter als die gewählte und hatten einen anderen Eckenradius. Beide sitzen
  jetzt auf dem Kasten, den die jeweilige Variante markiert.

- **Nav-Karte: Eine angedockte Leiste war so breit wie ihre Spalte, nicht wie die
  Ansicht.** Die Leiste sucht im Baum nach dem Inhaltsbereich der Ansicht, um
  andocken zu können, ohne unter der Seitenleiste zu verschwinden — und gab nach
  zwölf Schritten auf. Fast jeder Schritt überquert eine Shadow-Grenze
  (Kartenhülle, Sektion, Sections-Ansicht, Ansichtscontainer), am Desktop endete
  die Suche also in der Rasterspalte der Karte und hielt diese für den
  Inhaltsbereich: eine Glasfläche von ein paar hundert Pixeln, mitten im Bild,
  mit einer Kante an jedem Ende.

- **Nav-Karte: Die Markierung auf einer reinen Icon-Leiste war ein Kreis.** Sie
  soll dieselbe liegende Kapsel sein, die die Leisten mit Text tragen, nur eben
  ohne Wörter darunter. Ein Kreis ist eine andere und schwerere Form und ließ ein
  kompaktes Dock aussehen, als gehöre es nicht zu den übrigen Varianten.

- **Nav-Karte: `max_width: fit` hat die Leiste nie begrenzt.** Die Begrenzung
  stand als `min(var(--nav-max-width), 100%)` da, und diese Variable enthält das
  Schlüsselwort `fit-content` — ein Schlüsselwort in `min()` ist zum Zeitpunkt
  der Wertberechnung ungültig, der Browser verwarf also die ganze Deklaration und
  fiel auf `none` zurück. Die Einträge schmiegten sich an, die Leiste nicht: sie
  blieb über die volle Breite, mit ihrem Inhalt darin verteilt — das Gegenteil
  dessen, was die Option verspricht. Das Anschmiegen macht jetzt `width:
  fit-content`, die verbleibende Begrenzung ist eine echte Länge. Neben einem
  runden Aktionsknopf dehnt sich die Leiste ebenfalls nicht mehr auf die Zeile.

- **Nav-Karte: Eine angedockte Leiste (`header`/`footer`) schrumpfte auf ihre
  Einträge.** Mit Breitenbegrenzung schmiegte sich die Glasfläche an die Einträge
  und ließ an beiden Enden mitten im Bild eine sichtbare Kante stehen. Eine
  angedockte Leiste ist jetzt immer so breit wie das, woran sie andockt; die
  Begrenzung entscheidet nur, wie weit die Einträge darin auseinanderrücken.

- **Nav-Karte: Beim Zurückkehren auf eine Seite glitt die Markierung vom
  falschen Eintrag weg.** Eine Karte rendert weiter, solange sie noch eingehängt
  ist, aber nicht mehr die Seite zeigt, auf der man ist: sie hört den
  Seitenwechsel und schiebt ihre Markierung auf den Eintrag, zu dem man gerade
  weggegangen ist. Home Assistant speichert die Ansicht genau in diesem Zustand
  zwischen — sie kommt also mit der falschen Markierung zurück, und die Korrektur
  wurde animiert: die Pille glitt über die Dauer eines Übergangs von einem
  Nachbarn weg. Das war das Aufblitzen — nicht die falsche Seite markiert,
  sondern die richtige zu spät. Der erste Bildaufbau nach der Rückkehr animiert
  die Markierung nicht mehr.

- **Nav-Karte: Ein Tipp auf einen Eintrag konnte kurz die Nachbarseite
  aufblitzen lassen.** Die Abschirmung, die ein Wisch-Plugin des Dashboards von
  der Leiste fernhält, deckte den Anfang einer Geste ab, aber nicht ihr Ende.
  `hass-swipe-navigation` entscheidet auf `touchend`, und dieser Handler liest
  überhaupt kein Event — nur den zuvor gemerkten Anfang und die Bewegung. Wer den
  Anfang verschluckt und das Ende durchlässt, lässt das Plugin einen Tipp auf die
  Leiste anhand der Koordinaten einer früheren Berührung irgendwo sonst auf der
  Seite bewerten — und daraufhin eine Ansicht zur Seite blättern. Das war die
  Box, die für einen Moment neben dem angetippten Eintrag auftauchte: immer ein
  Nachbar, nie zweimal derselbe. Die Abschirmung deckt jetzt die ganze Geste ab.

- **Nav-Karte: Beim Wechseln konnte für einen Frame der falsche Eintrag
  aufblitzen.** Die Karte hat einen veralteten Pfad in `updated()` korrigiert —
  also nach dem Rendern. Ein Rendern, das mit dem alten Pfad begann, zeichnete
  somit den alten Eintrag und korrigierte ihn erst im nächsten Frame: genau eine
  Box, die kurz auf einem Nachbarn der geöffneten Seite aufblitzt. Die Korrektur
  passiert jetzt vor dem Rendern.

- **Nav-Karte: Eine angedockte Leiste schloss links und rechts nicht ab.**
  `header` und `footer` richten sich nach der Breite des Inhaltsbereichs, damit
  sie nicht unter der Seitenleiste verschwinden — aber eine Ansicht hat auch
  eigenen Abstand zum Bildschirmrand, und der floss in dieselbe Messung ein. Auf
  dem Handy, wo es keine Seitenleiste gibt, war dieser Abstand alles, was die
  Messung je gefunden hat; die Leiste saß also beidseitig in einer Lücke. Ein
  Abstand, der kleiner ist als die eingeklappte Seitenleiste, gilt jetzt als
  Innenabstand und wird ignoriert.

- **Nav-Karte: Die Pille um einen seitwärts gesetzten Eintrag war keine Kapsel.**
  Der Eckenradius wird mit Einträgen von Icon-Breite geteilt, wo er als
  abgerundetes Quadrat wirkt; um Icon und Text gezogen ließ derselbe Wert die
  Enden sichtbar abgeflacht. Eine Pille, die beides umschließt, ist jetzt um die
  Hälfte ihrer eigenen Höhe gerundet — eben eine Kapsel.

- **Nav-Karte: Ein Eintrag mit Text neben dem Icon war unsymmetrisch.** Die
  gestapelten Varianten geben der Glyphe eine 56px breite Indikator-Box — richtig,
  solange der Text darunter steht, falsch, sobald er daneben steht: das Icon
  schwamm in einer Box von mehr als der doppelten Breite und schob den Text aus
  der Mitte. Seitwärts ist die Glyphe jetzt nur noch das Icon, und der Eintrag
  wird auf der Icon-Seite enger gepolstert, damit beide Enden der Pille gleich
  aussehen.

- **Nav-Karte: Die Leiste schien zwischen den Seiten zu springen.** Jede Ansicht
  bringt ihre eigene Nav-Karte mit, und ein Browser verwirft die Scroll-Position
  eines Elements, sobald es das Dokument verlässt — genau das tut Home Assistant,
  um eine Ansicht zwischenzuspeichern. Jede Leiste kam also ganz links an und
  korrigierte sich dann, in welche Richtung der aktive Eintrag gerade lag.
  Leisten mit denselben Einträgen teilen sich jetzt die zuletzt bekannte
  Position, die Reihe macht also dort weiter, wo die vorige Seite sie gelassen
  hat, und die Korrektur darüber rückt nur um das kleinstmögliche Maß. Beides
  ohne Animation: eine Korrektur zu animieren, die an einer nie gesehenen
  Position beginnt, war der Grund, warum es wie ein Wisch aussah.

- **Nav-Karte: Die Leiste saß auf dem Gestenbalken statt darüber.** Die Karte
  hat `env(safe-area-inset-bottom)` gefragt, und das meldet ein Android-WebView
  auch auf einem Handy mit Gestensteuerung als 0. Home Assistant veröffentlicht
  den echten Wert als `--safe-area-inset-bottom`, gespeist von der Companion-App;
  den liest die Karte jetzt, mit `env()` als Rückfall für einen normalen Browser.

- **Nav-Karte: Der aktive Eintrag konnte außerhalb des Bildes liegen.** Eine
  Leiste mit mehr Einträgen als Platz scrollt, und jede Ansicht bringt ihre
  eigene Karte mit — beim Navigieren entstand also eine frische Leiste, ganz
  links. Lag der Eintrag der Zielseite hinter dem rechten Rand, sah es aus, als
  wäre die Leiste zum ersten Eintrag zurückgesprungen und hätte ihre Markierung
  verloren. Die Markierung stimmte immer, sie war nur nicht zu sehen. Die Leiste
  scrollt sie jetzt ins Bild, und nur bei einem echten Seitenwechsel — wer von
  Hand durch die Einträge scrollt, wird nicht zurückgerissen.

- **Nav-Karte: Der aktive Eintrag hinkte einen Schritt hinterher.** Home
  Assistant hält Ansichten in einem Cache und hängt beim Zurückkehren dieselbe
  Karte wieder ein; die Karte hat den aktuellen Pfad aber nur einmal gelesen,
  bei ihrer Konstruktion. Eine Karte aus diesem Cache kannte deshalb noch den
  Pfad, mit dem sie weggelegt wurde, und markierte die eben verlassene Seite,
  bis irgendetwas ein neues Rendern auslöste. Der Pfad wird jetzt beim
  Wiedereinhängen neu gelesen.

- **Nav-Karte: Ein Wisch-Plugin des Dashboards hat seitliche Gesten
  abgefangen.** Eine Leiste mit mehr Einträgen als Platz scrollt seitlich, und
  `hass-swipe-navigation` hat dieses Scrollen als „nächste Ansicht" gelesen und
  mitten in der Geste weggeblättert. Die Karte schirmt sich jetzt so ab, wie es
  die Schieberegler der Light-Card längst tun (`shared/swipe.ts`) — über die
  ganze Karte, weil nichts, was sie zeichnet, je ein Wisch-Seitenwechsel ist.

- **Button-Karte: `static_color` ließ die Kachel ausgeschaltet aussehen.** Die
  Option arbeitet, indem sie die Karte als inaktiv zeichnet — was immer nur die
  Farbe betraf. Das neue Aus-Icon und die Zustandsform lasen aber dasselbe
  Merkmal, ein laufender Kühlschrank zeigte also durchgestrichenes Icon und
  Aus-Umriss. Diese beiden folgen jetzt der Entität; `static_color` bedeutet
  weiterhin, was sein Name sagt.

- **Button-Karten-Editor: eine eigene Kopie der Farbzeile.** Fast dieselbe wie
  die geteilte, aber mit besserer Swatch-Auflösung — und ohne den neuen
  Themefarben-Knopf. Die Verbesserung ist in die geteilte Zeile gewandert, die
  Kopie ist weg.

- **Button-Karten-Editor: `icon_off` blieb leer, obwohl gesetzt.** Das Feld
  stand im Schema des Formulars, aber nicht in den Daten, die es bekommt — ein
  konfiguriertes Aus-Icon war für den Editor damit unsichtbar.

- **Button-Karten-Editor: Form- und Füllungsschalter lagen unter Inhalt.** Beide
  entscheiden über das Aussehen der Kachel — einer davon, herum welche Farbe
  Fläche und Glyphe tragen — und gehören damit zu den Farben.

- **Button-Karte: Die Ecken der Kachel bewegten sich erst ganz am Ende.** Der
  Aus-Zustand verlangte 999px, die übliche Schreibweise für eine Kapsel. Ein
  Browser kappt das beim Zeichnen auf die halbe Höhe, interpoliert aber die
  angegebene Zahl — ein Wechsel auf 16px verbrachte also 98% seiner Zeit
  oberhalb der Kappung: der Umriss stand still und klappte zum Schluss um,
  während das Icon-Feld die ganze Strecke zurücklegte. Der Aus-Radius wird
  jetzt an der Kachel gemessen, als deren halbe tatsächliche Höhe, damit beide
  Formen eine vergleichbare Strecke laufen und gemeinsam ankommen.

- **Button-Karte: Das Icon-Feld hat seine Form vor der Kachel geändert.** Das
  Feld überblendet alles, was es hat, in 0,25 s auf einer Ease-Kurve; die Ecken
  der Kachel bekamen 0,3 s auf Materials Kurve. Die innere Form war damit zuerst
  fertig, und die beiden wirkten, als änderten sie sich aus verschiedenen
  Gründen. Beide Formwechsel laufen jetzt auf derselben Uhr, die Farben des
  Feldes behalten ihre eigene.

- **Raumkarte: Ein manueller Raum meldete immer „Alles aus".** Die Zusammen-
  fassung zählte die Entitäten aus der Bereichsverwaltung — den manuellen Modus
  gibt es aber gerade für Räume, deren Geräte dort nicht eingetragen sind. Eine
  Karte mit sechs Steckdosen, halb davon an, behauptete also, es laufe nichts.
  Gezählt wird jetzt, was tatsächlich angezeigt wird, verschachtelte Stapel
  eingeschlossen; und die Karte zeichnet neu, sobald sich eine davon ändert.

- **Raumkarte: Das Scrollen endete unter einer angedockten Leiste.** Zwei Fehler,
  ein Symptom. Die Suche nach dem, was den unteren Fensterrand verdeckt, fragte
  den Punkt — und `elementsFromPoint` liefert den Shadow-Host statt dessen
  Inhalt, sodass der Abstieg entlang eines Zweigs in der gerade gescrollten
  Karte landete und die Navigationsleiste zwei Abschnitte weiter nie erreichte;
  jetzt wird der Baum durchlaufen. Und die Plausibilitätsgrenze, die eine
  „Leiste" von mehr als halber Bildschirmhöhe verwirft, prüfte den größten
  Treffer statt jeden einzelnen — eine bildschirmhohe fixierte Ebene, und davon
  hat ein Dashboard mehrere, riss die echte Leiste mit sich.

- **Raumkarte: Das Scrollen wartete auf das Aufklappen, statt mitzulaufen.** Wie
  weit die Seite überhaupt gescrollt werden kann, wurde einmal ermittelt — im
  Moment des Tippens, wenn die Karte noch eingeklappt ist und es diese Strecke
  praktisch nicht gibt. Die erste Bewegung war deshalb nur der Rest an Platz,
  der zufällig da war, und der eigentliche Weg kam erst danach, als die Karte
  fertig gewachsen war: zwei Bewegungen nacheinander für das, was eine einzige
  Geste sein sollte. Das Ziel wird jetzt in jedem Frame neu erfragt, sodass das
  Scrollen der wachsenden Seite folgt und beides gemeinsam ankommt.

- **Raumkarte: Ohne Animationen wurde gar nicht ins Sichtfeld gescrollt.** Der
  Zweig, der die Faltanimation überspringt, kehrte vor dem Scrollen zurück — eine
  Karte, die sich unter den Bildrand öffnet, blieb also dort. Auch ohne
  Animationen muss sie zu sehen sein.

- **Raumkarte: Das Ins-Bild-Holen kam zu spät und hörte zu tief auf.** Es wartete
  das Aufklappen ab und scrollte dann — das wirkt wie zwei Bewegungen mit einer
  Pause dazwischen. Das Ziel steht schon fest, bevor die Karte hineinwächst, also
  laufen beide jetzt gemeinsam. Und es scrollte bündig zum Fensterrand, womit auf
  einem Dashboard mit angedockter Navigationsleiste die letzte Zeile darunter
  verschwand. Was über den unteren Rand gelegt ist, wird jetzt gemessen und
  freigehalten.

- **Raumkarten-Editor: Die Fensterliste war ein Textfeld.** Entitäts-IDs, die
  niemand auswendig tippt, wurden als kommagetrennter Text verlangt. Jetzt
  derselbe Wähler wie bei der Leistungsliste, gefiltert auf Fenster-, Tür- und
  Öffnungssensoren.

- **Raumkarten-Editor: Ein Kartentyp zeigte seinen Übersetzungsschlüssel.** Die
  Beschriftung wurde per Zeichenkettenoperation aus dem Typ abgeleitet, und aus
  `climate-card-mini` wurde ein Schlüssel, den es nicht gibt — mit einem Cast
  davor, der den Compiler daran hinderte, das zu sagen. Jeder Typ trägt jetzt
  seinen eigenen Schlüssel, zur Bauzeit geprüft.

- **Raumkarten-Editor: Der Kategorien-Bereich erschien auch im manuellen Modus.**
  Er konfiguriert Kacheln, die in diesem Modus niemand zeichnet — ein Abschnitt
  voller wirkungsloser Schalter, samt einer Liste erkannter Kategorien, die
  aktiv aussah und nichts steuerte.

- **Raumkarte: ein festes Blau als Akzent.** Ein Raum ist ein Ort und keine
  Datenart mit eigener Farbe; er folgt jetzt dem Akzent des Dashboards — unter
  einem Material-You-Theme also dem Ton des Hintergrundbilds statt als einziges
  Element auf dem Bildschirm nichts vom Theme zu wissen.

- **Energiekarte: Der Monatswert eines Wasser- oder Gaszählers lag um den
  Faktor tausend daneben.** Für die Volumen-Geräteklassen wurde die Statistik
  immer in m³ angefordert, beschriftet wurde der Wert aber mit der Einheit der
  Entität — ein Literzähler zeigte im Monat also ein Tausendstel: aus 57 L
  Gießwasser wurden „0,06 L". Die Tagesansicht stimmte, weil dieser Weg gar
  keine Einheit anfordert; dieselbe Entität widersprach sich also selbst.
  Angefordert wird jetzt die Einheit, in der die Zahl auch ausgegeben wird.
  Mehrere Quellen in gemischten Einheiten addieren sich weiterhin korrekt: sie
  werden auf die Einheit der ersten Entität normalisiert statt auf m³.

## [2.2.0]

### Added

- **M3 Humidifier Card** (`m3-humidifier-card`) — target humidity, mode, fan
  speed and a device's extras in one card. Home Assistant's own humidifier card
  cannot set a fan speed, so the usual answer is a second card beside it; this
  is the one card. Asked for by the community.

  It does not insist that `entity` is a `humidifier`. Plenty of dehumidifiers
  are exposed as a switch plus a number plus a sensor, so `current_entity`,
  `target_entity` and `action_entity` say where the readings come from when the
  main entity does not carry them. Modes come from `available_modes`, from a
  `select`, or from an explicit list with a name, icon and colour each. The fan
  row reads a fan's `preset_modes`, a fan's percentage, or a `select`'s options.
  `layout` sets the order of the four blocks and hides the ones left out — one
  mechanism rather than an array plus show_* flags that can disagree with it.

  `action` is optional in the humidifier contract and many integrations omit
  it; without it the card infers drying or humidifying from the direction
  between current and target rather than showing nothing.

- **M3 Calendar Card** (`m3-calendar-card`) — an agenda and a month grid for
  any number of calendars, replacing Home Assistant's built-in calendar card in
  this suite's design language. Asked for in the repo's feedback.

  Events come from `calendar.get_events`, not from the entity attributes, which
  carry only the next event. Multi-day events appear under every day they touch
  with "day 2 of 3", a running event is tinted and badged, past ones fade, and a
  calendar that cannot be reached is named rather than silently dropped —
  showing four of five calendars without saying so would be worse.

- **`src/shared/ha-calendar.ts`** — the fetching, with one cache for the page so
  a month view and an agenda view of the same calendars make one request between
  them rather than two.
- **`src/shared/drag-throttle.ts`** — the drag throttle the light card's three
  sliders used, moved out when the humidifier card's target slider became the
  second user rather than copied.

- **M3 Leak Card — `max_visible`.** The same "show N more" toggle the power
  list, battery, NAS, updates and occupancy cards already had; the leak card
  only had the all-or-nothing `collapse_ok`. The limit steps aside during an
  alarm, because whichever sensor is wet has to be on screen without another
  tap.

- **M3 Climate Overview — `tile_tap_action: thermostat`.** A tap on a room
  opened the sensor's dialog, which is its history graph; it can now open that
  room's thermostat instead — `m3-climate-card-mini`, floating over the card and
  adjustable there. The thermostat is found in the room's own Home Assistant
  area — or, for a room that has no area because its sensors group by device,
  on that same device, which is how a thermostat reporting its own room
  temperature is found — or named per room with `climate_entity`. A room with
  no thermostat keeps the graph rather than going dead. Asked for on Reddit;
  the default is unchanged.

- **M3 Room Card — folding.** `collapsible: true` puts a chevron in the header
  and folds the card down to it. The subtitle stays, because "occupied · 3
  devices on" is exactly what a folded room still needs to say. The state
  persists per browser, or across devices in an `input_boolean`.
- **`src/shared/collapse-state.ts`** — the fold-state rule, shared by the
  heading and room cards so the two cannot drift.

- **M3 Room Card** (`m3-room-card`) — one card per area. Point it at a Home
  Assistant area and it works out the rest: which kinds of device are in the
  room, what each of them is doing, the climate readings, and whether anyone is
  in there. Nine categories are built in, `extra_domains` adds more, and a tile
  appears only for a category that actually has an entity in the room.

  The badge under each tile is the point of it: with several devices it counts
  them (`2/4`), with one it says what that device is doing — the fan's step,
  the thermostat's target, the media title, the blind's position. Entities Home
  Assistant marks as configuration or diagnostic are left out, which is what
  makes the switch category usable at all: on the author's install a living
  room holds 32 switches, of which 2 are things a person would call a switch.

  A tile holding several devices opens a picker on tap rather than switching all
  of them: a room's four lights are four decisions, not one. "All off" and "All
  on" are there for when it really is one. Individual devices can also be
  excluded in the editor, which is where a plug's indicator light goes when its
  integration does not mark it as diagnostic. Each category picks what its
  second line says — count, state, or nothing.

  Everything is read from the registry snapshots the frontend already keeps on
  `hass`, so discovery costs no websocket round-trip and can run in the render
  path, memoised against the registry object so the walk happens once per tick
  no matter how many room cards are on the dashboard.

- **M3 Heading Card** (`m3-heading-card`) — section headings for the space
  between cards, in four variants: a plain icon and title, one with a count chip
  and an action button, a divider rule with a small-caps label, and a
  collapsible one that folds away the cards below it. It draws no card of its
  own — no frame, no glass, no shadow — so it reads as a label for what follows
  rather than as another tile.

  Collapsing hides the sibling cards in the browser and writes nothing to the
  dashboard configuration, so it is a view state and not an edit. That depends
  on Home Assistant's own DOM, so every step is a check rather than an
  assumption and an unrecognised layout falls back to the plain variant: an
  arrow that visibly does nothing is worse than no arrow. The state persists in
  `localStorage`, or in an `input_boolean` when one is configured, which also
  syncs it across devices.

- **M3 Status Card** (`m3-status-card`) — shows a value large and with meaning:
  a number, a piece of text, or a yes/no state, from any entity. The point of
  the card is the mapping in between: a `states` rule list turns `off` into a
  red "No" with a cross, or a number under 20 into a warning colour, without a
  template sensor to do it. Five presets (`yes_no`, `on_off`, `ok_problem`,
  `open_closed`, `traffic`) supply ready-made rule lists in the dashboard's own
  language, and a card's own rules are tried first, so a preset can be adjusted
  without being replaced.

  One value gets the large hero treatment, several get a grid or a row list. A
  `toggle` tap switches the shown state over at once instead of waiting for
  Home Assistant to confirm it, so a "medication given" card cannot be tapped
  twice by someone who thinks the first tap missed. An optional trend chip
  compares against the same entity 24 hours ago, with `trend_inverted` for the
  values where falling is the win.

- **`src/shared/actions.ts`** — the seven-branch tap/hold action handler, moved
  out of the button card so the status card's `toggle` and `call-service` use
  the same code rather than a second copy.

- **M3 Clock Card** (`m3-clock-card`) — a clock in five styles: rounded tiles,
  digits inside lobed shapes, lockscreen typography, an organic analogue dial,
  and a sixty-segment ring. It reads no entity, so it works on any dashboard
  without setting anything up; the optional alarm, sun, day-progress and
  second-time-zone extras are the only parts that need one.

  The card only redraws while it is on screen — a clock on a wall tablet would
  otherwise animate for weeks to an empty room — and styles with nothing moving
  between whole seconds drop to a timer that wakes on the minute. Measured on a
  35-card dashboard: 12 renders in 12 seconds against roughly 1440 frames, and
  zero ticks while scrolled out of view.

- **`src/shared/shapes.ts`** — the lobed-shape generator behind those styles.
  The cookie, clover, flower and scallop shapes Material 3 Expressive uses are
  one curve with different settings, so one generator covers the family. Useful
  to any card in the suite, not just the clock.

### Fixed

- **M3 Cost Card sent a wildly wrong number to your phone.** Its notification
  automation multiplied `states(entity)` by the price. For a
  `total_increasing` sensor that state is the *meter reading*, not the month's
  consumption — so on the author's install the card said **112.66 €** for
  August while its own notification said **26,844.38 €**: 72,926.89 kWh times
  36.81 ct. The card was right; it reads long-term statistics, which is
  precisely why nobody noticed the notification disagreeing with it.

  The automation now calls `recorder.get_statistics` and sums the same daily
  buckets the card sums, with the same statistic type and the same unit
  normalisation, so the two cannot disagree again. A template can reach neither
  statistics nor history, so this had to become an action rather than a
  variable — and the budget mode's trigger had to change with it, since a
  trigger's `value_template` cannot call a service. It checks every half hour
  instead and stays once-a-month by asking itself when it last fired.

  Two smaller things fell out of the same investigation. The notification's
  entity picker had no default, which invited exactly this: the card was
  reading one sensor while its own notification read another. It now defaults
  to the card's entity, and choosing a different one says why that is worth a
  second look. And the old check for a meter's reset cycle is gone — it needed
  both `last_reset` and `next_reset`, went quiet on a sensor carrying only the
  first, and no longer matters now that the month is summed from statistics.

  **An automation created before this fix keeps its old template.** Open the
  card's notification settings and save again, or check the automation by
  hand.

- **M3 Heading Card — the divider was barely visible, in four separate ways.**
  Found while photographing the card for the README, and each one had to be
  measured rather than eyeballed:

  - Its **rules** were a tint of 18, which is 1.78:1 against a dark card and
    1.43:1 against a light one — invisible. Every other tint in the suite (6–22)
    sits *behind an icon*, where the icon carries the contrast and the fill only
    hints; a rule has nothing on top of it and has to reach 3:1 by itself. Now
    52, giving 5.47:1 and 3.30:1.
  - Its **label** sat at `opacity: 0.42`: 4.02:1 dark, 2.58:1 light, against a
    target of 4.5:1. Now 0.65. The house value for a muted label is 0.6, which
    still misses a light card at 4.35:1, so this sits above it on purpose.
  - **`color` never reached the divider at all.** It drove the icon, badge,
    action and arrow, but the rules were hardcoded to `--primary-text-color`, so
    setting a colour on a divider silently did nothing. It now drives both parts,
    and the label takes the colour at full strength — someone who names a colour
    means that colour, not a muted version of it.
  - Its **label was 10px while the titles were 15**, which read as a different
    kind of element rather than as the same heading in another variant. Both now
    come from one place, so `title_size` moves them together.

- **M3 Light Card showed the brightness twice.** The percentage stood under the
  lamp's name and again above the slider handle. The subtitle is the live one —
  it already follows the value while the handle is being dragged — and it is
  what every other card puts in that spot, so the label on the slider is gone.

- **`tintOn` on a dark surface** returned a CSS `color-mix` string rather than a
  colour. `tintInk` feeds that back in as the surface to measure ink against,
  and an unparseable surface means the ink comes back unchanged — so `tintInk`
  has been a silent no-op in every dark theme since it was written. Benign
  until now, because a light accent on its own dark tint contrasts well by
  accident.

---

**Deutsche Fassung**

### Neu

- **M3 Humidifier Card** (`m3-humidifier-card`) — Zielfeuchte, Modus,
  Lüfterstufe und die Zusatzfunktionen eines Geräts in einer Karte. Die
  eingebaute humidifier-Karte von Home Assistant kann keine Lüftergeschwindigkeit,
  deshalb steht üblicherweise eine zweite Karte daneben; das hier ist die eine.
  Aus der Community gewünscht.

  Sie setzt nicht voraus, dass `entity` eine `humidifier`-Entität ist. Viele
  Entfeuchter erscheinen als Schalter plus `number` plus `sensor`, deshalb sagen
  `current_entity`, `target_entity` und `action_entity`, woher die Werte kommen,
  wenn die Hauptentität sie nicht trägt. Modi kommen aus `available_modes`, aus
  einem `select` oder aus einer eigenen Liste mit Name, Icon und Farbe je Modus.
  Die Lüfterzeile liest `preset_modes` eines Lüfters, dessen Prozentwerte oder
  die Optionen eines `select`. `layout` bestimmt die Reihenfolge der vier Blöcke
  und blendet die weggelassenen aus — ein Mechanismus statt einer Liste plus
  `show_*`-Schaltern, die sich widersprechen können.

  `action` ist im humidifier-Vertrag optional und wird von vielen Integrationen
  weggelassen; fehlt es, leitet die Karte Ent- oder Befeuchten aus der Richtung
  zwischen Ist und Ziel ab, statt nichts zu zeigen.

- **M3 Calendar Card** (`m3-calendar-card`) — Agenda und Monatsraster für
  beliebig viele Kalender, als Ersatz für die eingebaute Kalenderkarte in der
  Designsprache dieser Suite. Aus dem Repo-Feedback gewünscht.

  Die Termine kommen über `calendar.get_events`, nicht aus den Attributen der
  Entität — die tragen nur den nächsten Termin. Mehrtägige Termine erscheinen an
  jedem betroffenen Tag mit „Tag 2 von 3", ein laufender Termin ist getönt und
  mit Abzeichen versehen, vergangene verblassen, und ein nicht erreichbarer
  Kalender wird benannt statt stillschweigend weggelassen — vier von fünf
  Kalendern zu zeigen, ohne es zu sagen, wäre schlimmer.

- **`src/shared/ha-calendar.ts`** — der Datenabruf, mit einem Zwischenspeicher
  je Seite: Eine Monats- und eine Agenda-Ansicht derselben Kalender machen
  zusammen eine Anfrage statt zwei.
- **`src/shared/drag-throttle.ts`** — die Ziehdrosselung der drei Regler der
  Light Card, herausgelöst statt kopiert, als der Feuchte-Regler der zweite
  Nutzer wurde.

- **M3 Leak Card — `max_visible`.** Derselbe „N weitere anzeigen"-Umschalter,
  den Power-List, Batterie, NAS, Updates und Belegung längst haben; die
  Leak-Karte hatte nur das Alles-oder-nichts von `collapse_ok`. Im Alarmfall
  tritt die Begrenzung zurück, denn welcher Sensor nass ist, muss ohne zweiten
  Tap sichtbar sein.

- **M3 Climate Overview — `tile_tap_action: thermostat`.** Ein Tap auf einen
  Raum öffnete den Sensordialog, also dessen Verlaufsgraphen; er kann jetzt
  stattdessen das Thermostat des Raums öffnen — `m3-climate-card-mini`,
  schwebend über der Karte und dort bedienbar. Gefunden wird es im Bereich des
  Raums — oder, wenn ein Raum mangels Bereich über sein Gerät gruppiert wird,
  an ebendiesem Gerät, womit ein Thermostat gefunden wird, das seine eigene
  Raumtemperatur meldet — oder je Raum über `climate_entity` benannt. Ein Raum
  ohne Thermostat behält den Verlauf, statt tot zu sein. Auf Reddit gewünscht;
  die Vorgabe bleibt unverändert.

- **M3 Room Card — Einklappen.** `collapsible: true` setzt einen Pfeil in die
  Kopfzeile und klappt die Karte auf ebendiese zusammen. Der Untertitel bleibt
  stehen, denn „belegt · 3 Geräte aktiv" ist genau das, was ein eingeklappter
  Raum noch sagen muss. Der Zustand bleibt je Browser erhalten oder
  geräteübergreifend in einem `input_boolean`.
- **`src/shared/collapse-state.ts`** — die Regel für den eingeklappten Zustand,
  gemeinsam genutzt von Heading- und Room-Karte, damit beide nicht auseinanderlaufen.

- **M3 Room Card** (`m3-room-card`) — eine Karte je Bereich. Man gibt ihr einen
  Bereich aus Home Assistant, den Rest findet sie selbst: welche Gerätearten im
  Raum hängen, was jede davon tut, die Klimawerte und ob jemand da ist. Neun
  Kategorien sind eingebaut, `extra_domains` ergänzt weitere, und eine Kachel
  erscheint nur für eine Kategorie, die im Raum tatsächlich eine Entität hat.

  Der Text unter der Kachel ist der eigentliche Punkt: Bei mehreren Geräten
  zählt er (`2/4`), bei einem sagt er, was dieses Gerät tut — die Stufe des
  Lüfters, die Zieltemperatur, den Medientitel, die Rollo-Position. Entitäten,
  die Home Assistant als Konfiguration oder Diagnose markiert, bleiben draußen;
  erst das macht die Schalter-Kategorie überhaupt brauchbar: Im Wohnzimmer der
  Testinstallation liegen 32 Schalter, von denen 2 das sind, was ein Mensch
  einen Schalter nennt.

  Eine Kachel mit mehreren Geräten öffnet beim Tap eine Auswahl, statt alle
  umzuschalten: Die vier Lampen eines Raums sind vier Entscheidungen, nicht
  eine. „Alles aus“ und „Alle an“ stehen für die Fälle bereit, in denen es doch
  nur eine ist. Einzelne Geräte lassen sich außerdem im Editor abwählen — dort
  landet etwa die Status-LED einer Steckdose, wenn ihre Integration sie nicht
  als Diagnose markiert. Jede Kategorie bestimmt selbst, was ihre zweite Zeile
  zeigt: zählen, Zustand oder gar nichts.

  Alles kommt aus den Registry-Daten, die das Frontend ohnehin auf `hass`
  bereithält — die Erkennung kostet also keinen Websocket-Aufruf und darf im
  Render-Pfad laufen, memoisiert gegen das Registry-Objekt, sodass der
  Durchlauf einmal pro Tick passiert, egal wie viele Raumkarten auf dem
  Dashboard liegen.

- **M3 Heading Card** (`m3-heading-card`) — Abschnitts-Überschriften für den
  Raum zwischen den Karten, in vier Varianten: schlicht mit Icon und Titel, mit
  Zähler-Chip und Aktions-Button, als Trennstrich mit Label in Versalien und
  aufklappbar mit Einklappen der Karten darunter. Sie zeichnet keine eigene
  Karte — kein Rahmen, kein Glas, kein Schatten —, damit sie als Beschriftung
  für das Folgende gelesen wird und nicht als weitere Kachel.

  Das Einklappen blendet die Geschwisterkarten im Browser aus und schreibt
  nichts in die Dashboard-Konfiguration; es ist damit ein Anzeigezustand und
  keine Bearbeitung. Das hängt vom DOM von Home Assistant ab, deshalb ist jeder
  Schritt eine Prüfung und keine Annahme, und ein unbekanntes Layout fällt auf
  die schlichte Variante zurück: Ein Pfeil, der sichtbar nichts tut, ist
  schlimmer als gar keiner. Der Zustand bleibt im `localStorage` erhalten oder,
  wenn konfiguriert, in einem `input_boolean` — dann gilt er geräteübergreifend.

- **M3 Status Card** (`m3-status-card`) — zeigt einen Wert groß und mit
  Bedeutung: eine Zahl, einen Text oder einen Ja/Nein-Zustand, aus beliebigen
  Entitäten. Der eigentliche Punkt ist die Zuordnung dazwischen: Eine
  `states`-Regelliste macht aus `off` ein rotes „Nein“ mit Kreuz oder aus einer
  Zahl unter 20 eine Warnfarbe — ohne Template-Sensor. Fünf Vorlagen (`yes_no`,
  `on_off`, `ok_problem`, `open_closed`, `traffic`) liefern fertige Regellisten
  in der Sprache des Dashboards, und eigene Regeln werden zuerst geprüft: Eine
  Vorlage lässt sich anpassen, ohne sie zu ersetzen.

  Ein Wert bekommt die große Hero-Darstellung, mehrere ein Raster oder eine
  Zeilenliste. Ein `toggle`-Tap schaltet die Anzeige sofort um, statt auf die
  Bestätigung von Home Assistant zu warten — so tippt niemand ein zweites Mal,
  weil der erste Tap scheinbar nichts getan hat. Ein optionaler Trend-Chip
  vergleicht mit derselben Entität vor 24 Stunden, mit `trend_inverted` für die
  Werte, bei denen Fallen der Gewinn ist.

- **`src/shared/actions.ts`** — der Aktions-Handler mit seinen sieben Zweigen,
  aus der Button-Karte herausgelöst, damit `toggle` und `call-service` der
  Status-Karte denselben Code nutzen statt einer zweiten Kopie.

- **M3 Clock Card** (`m3-clock-card`) — eine Uhr in fünf Stilen: runde Kacheln,
  Ziffern in gelappten Formen, Sperrbildschirm-Typografie, ein organisches
  analoges Zifferblatt und ein Ring aus sechzig Segmenten. Sie liest keine
  Entität und läuft damit auf jedem Dashboard ohne Einrichtung; nur die
  optionalen Extras — Wecker, Sonne, Tagesfortschritt, Zweitzeitzonen —
  brauchen eine.

  Die Karte zeichnet nur neu, solange sie sichtbar ist — eine Uhr auf einem
  Wandtablet würde sonst wochenlang für einen leeren Raum animieren — und Stile
  ohne Bewegung zwischen den Sekunden schalten auf einen Minutentimer um. Auf
  einem Dashboard mit 35 Karten gemessen: 12 Renders in 12 Sekunden bei rund
  1440 Frames, und null Ticks außerhalb des Sichtbereichs.

- **`src/shared/shapes.ts`** — der Formengenerator dahinter. Cookie, Kleeblatt,
  Blüte und Scallop sind dieselbe Kurve mit anderen Werten, also deckt ein
  Generator die ganze Familie ab. Für jede Karte der Suite nutzbar, nicht nur
  für die Uhr.

### Behoben

- **M3 Cost Card schickte eine völlig falsche Zahl aufs Handy.** Ihre
  Benachrichtigungs-Automation multiplizierte `states(entity)` mit dem Preis.
  Bei einem `total_increasing`-Sensor ist dieser Zustand aber der
  *Zählerstand*, nicht der Verbrauch des Monats — auf der Testinstallation
  meldete die Karte für August **112,66 €**, ihre eigene Benachrichtigung
  dagegen **26 844,38 €**: 72 926,89 kWh mal 36,81 ct. Die Karte lag richtig,
  sie liest die Langzeitstatistik; genau deshalb fiel der Widerspruch nie auf.

  Die Automation ruft jetzt `recorder.get_statistics` auf und summiert
  dieselben Tageswerte wie die Karte, mit derselben Statistik-Art und derselben
  Einheiten-Normalisierung — beide können also nicht mehr auseinanderlaufen.
  Ein Template erreicht weder Statistiken noch Verlauf, deshalb musste daraus
  eine Aktion statt einer Variablen werden. Und der Auslöser des
  Budget-Modus musste mit: Das `value_template` eines Triggers kann keinen
  Dienst aufrufen. Er prüft nun halbstündlich und bleibt trotzdem einmal im
  Monat, indem er sich selbst fragt, wann er zuletzt ausgelöst hat.

  Zwei kleinere Dinge fielen dabei mit ab. Das Auswahlfeld für die Entität der
  Benachrichtigung hatte keine Vorgabe — genau die Einladung zu diesem Fehler:
  Die Karte las den einen Sensor, ihre eigene Meldung einen anderen. Es steht
  jetzt auf der Entität der Karte, und eine abweichende Wahl sagt, warum sie
  einen zweiten Blick verdient. Und die alte Prüfung des Zählerzyklus ist
  entfallen: Sie brauchte `last_reset` **und** `next_reset`, schwieg bei einem
  Sensor mit nur dem ersten, und ist gegenstandslos, seit der Monat aus
  Statistiken summiert wird.

  **Eine vor dieser Behebung angelegte Automation behält ihr altes Template.**
  Die Benachrichtigungs-Einstellungen der Karte erneut speichern oder die
  Automation von Hand prüfen.

- **M3 Heading Card — die Trennlinie war auf vier verschiedene Weisen kaum zu
  sehen.** Aufgefallen beim Fotografieren der Karte fürs README, und jeder Punkt
  musste gemessen werden statt geschätzt:

  - Ihre **Linien** hatten eine Tönung von 18, das sind 1,78:1 auf dunkler und
    1,43:1 auf heller Karte — unsichtbar. Alle übrigen Tönungswerte der Suite
    (6–22) liegen *hinter einem Icon*, wo das Icon den Kontrast trägt und die
    Fläche nur andeutet; eine Linie hat nichts über sich und muss die 3:1 selbst
    erreichen. Jetzt 52, also 5,47:1 und 3,30:1.
  - Ihre **Beschriftung** stand auf `opacity: 0.42`: 4,02:1 dunkel, 2,58:1 hell,
    bei einem Ziel von 4,5:1. Jetzt 0,65. Der Hauswert für gedämpfte
    Beschriftungen ist 0,6, der eine helle Karte mit 4,35:1 noch verfehlt —
    dieser Wert liegt also mit Absicht darüber.
  - **`color` erreichte die Trennlinie überhaupt nicht.** Die Option steuerte
    Icon, Zähler, Aktionsknopf und Pfeil, aber die Linien standen fest auf
    `--primary-text-color`; eine Farbe auf einer Trennlinie tat also stillschweigend
    nichts. Sie steuert jetzt beide Teile, und die Beschriftung übernimmt die
    Farbe in voller Stärke — wer eine Farbe nennt, meint diese Farbe und nicht
    eine gedämpfte Fassung davon.
  - Ihre **Beschriftung war 10px groß, die Titel 15px**, was sie als andere Art
    von Element erscheinen ließ statt als dieselbe Überschrift in einer anderen
    Variante. Beide kommen jetzt aus einer Quelle, `title_size` bewegt sie
    zusammen.

- **M3 Light Card zeigte die Helligkeit doppelt.** Die Prozentangabe stand
  unter dem Namen der Lampe und noch einmal über dem Reglergriff. Die
  Unterzeile ist die lebende Anzeige — sie folgt dem Wert schon während des
  Ziehens — und sie ist das, was jede andere Karte an dieser Stelle zeigt; die
  Marke am Regler ist deshalb entfallen.

- **`tintOn` auf dunkler Fläche** gab einen CSS-`color-mix`-String zurück statt
  einer Farbe. `tintInk` reicht genau das als Bezugsfläche zurück, und eine
  nicht auflösbare Fläche heißt: Die Tinte kommt unverändert zurück — `tintInk`
  war damit in jedem dunklen Theme still wirkungslos, seit es geschrieben
  wurde. Bis jetzt folgenlos, weil ein heller Akzent auf seiner eigenen dunklen
  Tönung zufällig gut kontrastiert.

## [2.1.0]

The light theme release. Accent colours are now corrected at render time
against the surface they are actually drawn on, so the palette reads as
deliberate rather than washed out. Alongside that: a large rendering-cost
reduction, a masonry layout fix, and calendar support for the waste card.

### Added

- **M3 Waste Card — `calendar_entity`.** Read the schedule from a calendar
  whose events name the bin, instead of (or alongside) one day-count sensor per
  bin. Streams from both sources are merged; a sensor wins over a calendar entry
  with the same name.
- **Contrast tooling.** `npm run test:contrast` unit-tests the colour maths, and
  `test/contrast-audit.js` measures the *rendered* page — paste it into the
  browser console on a dashboard and run it once per theme. See
  `docs/TESTING.md`.

### Fixed

- **Accent colours in a light theme.** The 2.0 known issue is resolved. The
  palette is built for dark backgrounds — all thirteen colours fall below 4.5:1
  on a light card and all thirteen pass on a dark one — so accents used as text
  or as a data fill are now moved to their target contrast at render time. The
  correction keeps the hue and lifts the saturation rather than blending toward
  black: `#85b7eb` becomes `#0b6ed5`, not a grey-blue. Measured on a live
  35-card dashboard, the light theme now reports three findings and the dark
  theme four, and all three of the light ones appear in the dark list too —
  they are long-standing design choices, not theme faults.
- **Content on tinted surfaces.** Chips, icon wells, expand toggles and count
  badges took their colour from the card while sitting on a tint of the same
  hue, which rendered `#81c784` on `#9cdc9f` — 1.26:1. Ink is now measured
  against the surface it actually sits on.
- **Tints no longer mix toward `transparent`.** 146 surfaces mixed into
  whatever was behind the card, which through a glass card is the dashboard
  wallpaper, so the same 8% wash looked different depending on the picture
  underneath. They mix into the card surface now. Gradients and deliberate
  overlays are unchanged.
- **M3 Button Card and M3 Climate Card Mini in a masonry view.** Both make
  their card a size container so paddings can scale with height, then took
  `height: 100%`. A masonry column imposes no height, the percentage fell back
  to `auto`, and `auto` on a size-contained box is zero: the button card
  rendered a squashed 37px of content inside a 0px card, and the climate-mini
  card disappeared entirely. Sections views were never affected.
- **M3 Occupancy Card — `max_visible`.** The option had no effect; the list now
  caps at the given number with the rest behind a toggle.

### Performance

- **Cards no longer re-render on unrelated state changes.** Home Assistant
  hands every card a fresh `hass` object whenever anything in the system
  changes, so one chatty power sensor re-rendered every card on the dashboard.
  Every card now declares what it reads. Cards that discover their entities by
  scanning also watch for the entity count changing, so a newly added sensor is
  still picked up.
- **M3 Power Summary — count-up animation.** The value lerp wrote to reactive
  state on every animation frame although the reading is rounded before it is
  shown, so most frames re-rendered identical text.
- Measured together on the same 35-card dashboard, 20 seconds:
  **370 renders → 12.**

### Behaviour changes

No configuration option was removed or renamed, and no default in `const.ts`
changed — existing configs load unchanged. These change what you *see*:

- **Every card in a light theme.** Accent-coloured text and data fills are
  distinctly darker and more saturated than in 2.0. This is the fix, not a side
  effect, but it is a visible change.
- **Every card.** Tinted inner fills are opaque now rather than letting the
  wallpaper through. The card itself stays translucent.
- **M3 Climate Card Mini** has a minimum height of 112px. A tile configured
  smaller than that is raised to it. 112px is the smallest height at which the
  compact layout fits without clipping, so a tile below it was cutting off its
  own content already.

---

**Deutsche Fassung**

Das Release für das helle Theme. Akzentfarben werden jetzt beim Rendern gegen
die Fläche korrigiert, auf der sie tatsächlich liegen — die Palette wirkt
dadurch gewollt statt ausgewaschen. Dazu: deutlich weniger Renderaufwand, ein
Layout-Fehler in der Masonry-Ansicht und Kalender-Unterstützung für die
Abfallkarte.

### Neu

- **M3 Waste Card — `calendar_entity`.** Abfuhrtermine aus einem Kalender
  lesen, dessen Einträge die Tonne benennen — statt oder zusätzlich zu je einem
  Tageszähler-Sensor pro Tonne. Beide Quellen werden zusammengeführt; bei
  gleichem Namen gewinnt der Sensor.
- **Werkzeuge für Kontrastprüfung.** `npm run test:contrast` testet die
  Farbmathematik, `test/contrast-audit.js` misst die *gerenderte* Seite — in die
  Browser-Konsole eines Dashboards einfügen und je Theme einmal ausführen.
  Siehe `docs/TESTING.md`.

### Behoben

- **Akzentfarben im hellen Theme.** Die bekannte Einschränkung aus 2.0 ist
  erledigt. Die Palette ist für dunkle Hintergründe gebaut — alle dreizehn
  Farben fallen auf heller Karte unter 4,5:1 und bestehen auf dunkler — deshalb
  werden Akzente als Text oder als Datenfläche jetzt zur Laufzeit auf ihren
  Zielkontrast gezogen. Die Korrektur hält den Farbton und hebt die Sättigung,
  statt Richtung Schwarz zu blenden: `#85b7eb` wird `#0b6ed5`, kein Graublau.
  Auf einem Dashboard mit 35 Karten gemessen meldet das helle Theme jetzt drei
  Funde, das dunkle vier — und alle drei hellen stehen auch in der dunklen
  Liste. Es sind also langjährige Gestaltungsentscheidungen, keine
  Theme-Fehler.
- **Inhalt auf getönten Flächen.** Chips, Icon-Felder, Aufklapp-Umschalter und
  Zähler-Badges nahmen ihre Farbe von der Karte, saßen aber auf einer Tönung
  desselben Farbtons — das ergab `#81c784` auf `#9cdc9f`, also 1,26:1. Die
  Schrift wird jetzt gegen die Fläche gemessen, auf der sie wirklich liegt.
- **Tönungen mischen nicht mehr gegen `transparent`.** 146 Flächen mischten
  gegen das, was hinter der Karte lag — durch eine Glaskarte also gegen die
  Hintergrundtapete, sodass derselbe 8-%-Schleier je nach Bild anders aussah.
  Sie mischen jetzt in die Kartenfläche. Gradienten und bewusste Überlagerungen
  bleiben unverändert.
- **M3 Button Card und M3 Climate Card Mini in der Masonry-Ansicht.** Beide
  machen ihre Karte zum Größen-Container, damit Polster mit der Höhe skalieren
  können, und nahmen dann `height: 100%`. Eine Masonry-Spalte gibt keine Höhe
  vor, der Prozentwert fiel auf `auto` zurück, und `auto` ist auf einem
  größen-kontenierten Element null: Die Button-Karte zeigte 37 px gequetschten
  Inhalt in einer 0-px-Karte, die Mini-Klimakarte verschwand ganz.
  Sections-Ansichten waren nie betroffen.
- **M3 Occupancy Card — `max_visible`.** Die Option hatte keine Wirkung; die
  Liste wird jetzt bei der angegebenen Zahl gekappt, der Rest liegt hinter
  einem Umschalter.

### Geschwindigkeit

- **Karten rendern nicht mehr bei fremden Zustandsänderungen.** Home Assistant
  übergibt jeder Karte ein frisches `hass`-Objekt, sobald sich irgendwo im
  System etwas ändert — ein einzelner geschwätziger Stromsensor rendert so das
  ganze Dashboard neu. Jede Karte deklariert jetzt, was sie liest. Karten, die
  ihre Entitäten selbst suchen, beobachten zusätzlich die Anzahl der Entitäten,
  damit ein neu hinzugefügter Sensor weiterhin gefunden wird.
- **M3 Power Summary — Zähl-Animation.** Die Interpolation schrieb pro
  Animationsframe in reaktiven Zustand, obwohl der Wert vor der Anzeige
  gerundet wird — die meisten Frames rendern also identischen Text.
- Zusammen gemessen, dasselbe Dashboard mit 35 Karten, 20 Sekunden:
  **370 Renders → 12.**

### Achtung beim Update

Keine Konfigurationsoption wurde entfernt oder umbenannt, kein Standardwert in
`const.ts` hat sich geändert — bestehende Configs laden unverändert. Diese
Punkte ändern aber, was man **sieht**:

- **Alle Karten im hellen Theme.** Akzentfarbener Text und Datenflächen sind
  deutlich dunkler und gesättigter als in 2.0. Das ist die Behebung, kein
  Nebeneffekt — aber eine sichtbare Änderung.
- **Alle Karten.** Getönte Innenflächen sind jetzt deckend, statt die Tapete
  durchscheinen zu lassen. Die Karte selbst bleibt durchscheinend.
- **M3 Climate Card Mini** hat eine Mindesthöhe von 112 px. Eine kleiner
  konfigurierte Kachel wird darauf angehoben. 112 px ist die kleinste Höhe, bei
  der das kompakte Layout ohne Abschneiden passt — eine kleinere Kachel schnitt
  ihren Inhalt vorher bereits ab.

## [2.0.0]

Großes Funktions-Release: sechs neue Karten (23 → 29), optionale
Benachrichtigungen für mehrere Karten, eine überarbeitete Media Card und eine
von Grund auf neu strukturierte README. Enthält alle seit 1.9.0 gesammelten
Arbeiten (die zwischenzeitliche 1.9.1 wurde nie separat veröffentlicht und ist
hier aufgegangen).

### Bekannte Einschränkungen

- **Akzentfarben im hellen Theme**: Die Palette ist für dunkle Hintergründe
  entworfen (`#a58fe8` erreicht auf Weiß nur 2,4:1, auf `#1c1c1c` dagegen
  6,2:1). Werte, die in der Akzentfarbe gesetzt sind, wirken im hellen Theme
  deshalb blass. Kartenflächen und getönte Flächen sind mit dieser Version
  korrigiert; die rund 155 Vordergrund-Stellen über 17 Karten folgen in
  2.0.1, zusammen mit einer Überarbeitung der Palette.

### Achtung beim Update

Keine Konfigurationsoption wurde entfernt oder umbenannt, und kein Standardwert
in `const.ts` hat sich geändert — bestehende Configs laden unverändert. Diese
Punkte ändern aber das **Verhalten**, ohne dass man etwas anpasst:

- **M3 Media Card**: Die rechte Zeitangabe zeigt jetzt die **Restzeit mit
  Minuszeichen** statt der Gesamtdauer. Zurück mit `time_display: total`.
- **M3 Media Card**: Führende Tracknummern verschwinden aus dem Titel. Zurück
  mit `strip_track_number: false`.
- **M3 Media Card**: Bei Playern mit `BROWSE_MEDIA` erscheint die
  Bibliothekszeile, und die Transportknöpfe sind größer — **die Karte wird
  höher** und kann Dashboard-Layouts verschieben. Die Zeile lässt sich mit
  `show_browser: false` abschalten.
- **M3 Media Card**: Der Fortschritt ist wieder ein Wellen-Indikator statt
  einer geraden Linie.
- **M3 Button Card mit `show_slider: true`**: Ein Tap setzt jetzt den Wert an
  der getippten Position, statt auf die Tap-Aktion durchzufallen. Zum Schalten
  dient jetzt das Icon, dessen Standardaktion im Slider-Modus von More-Info auf
  den Domänen-Toggle wechselt — zurück mit `icon_tap_action: more-info`. Karten
  **ohne** `show_slider` sind nicht betroffen.
- **M3 Light Card**: Die Wellen-Geometrie ist schlanker (Strichstärke 14 → 6).
- **Alle Karten**: Glas-Hintergrund und getönte Flächen (Icon-Felder,
  Kacheln, Zeilen) werden jetzt aus der Kartenfläche gemischt statt gegen
  `transparent`. Im dunklen Theme ist der Unterschied
  minimal (die Karten werden leicht blickdichter), im hellen ist er groß —
  siehe „Behoben".

### Neu
- **M3 Cover Card** (`custom:m3-cover-card`): Rollladen- und
  Abdeckungssteuerung, die sich an die Fähigkeiten der Entität anpasst —
  Position, Lamellen-Neigung oder nur Auf/Zu, je nach `supported_features`.
  Einzel- und Gruppenmodus. Für Geräte ohne eigene Cover-Entität — etwa
  FingerBot-Antriebe an getrennten Schaltern — gibt es den `switch_pair`-Modus
  mit Auf-/Ab-/(optional) Stopp-Schalter; wo das Gerät keine Rückmeldung
  liefert, zeigt ein kurzes Tastenfeedback den ausgelösten Befehl.
- **M3 Leak Card** (`custom:m3-leak-card`): Überblick über Feuchte- und
  Leck-Sensoren mit den Zuständen OK, Alarm und „veraltet" (kein aktuelles
  Update). Optionaler Absperr-Knopf, der die Domäne der Absperr-Entität
  erkennt (`valve` / `switch` / `cover`). Optionale Benachrichtigung bei
  Wasseralarm.
- **M3 Waste Card** (`custom:m3-waste-card`): Abfuhrtermine als Hero mit
  „nächste Abfuhr in N Tagen", einer Zeitleiste über die nächsten zwei Wochen
  und einer Zeile je Tonne. Info- und Erinnerungsmodus, Hero-Icon einzeln oder
  mehrfach („N Tonnen"). Optionale Erinnerung zum Rausstellen zur eingestellten
  Uhrzeit. Erwartet Sensoren mit den Tagen bis zur Abfuhr (z. B. aus der
  Integration Waste Collection Schedule).
- **M3 Occupancy Card** (`custom:m3-occupancy-card`): Belegung nach Räumen
  statt nach einzelnen Sensoren. Fasst Präsenz-/Bewegungssensoren je Raum
  zusammen, zeigt „X von Y Räumen belegt" und je Raum „belegt/frei seit …".
  Automatische Erkennung über Bereiche oder eine manuelle Sensorliste.
  Optionale Benachrichtigung, wenn ein überwachter Sensor auslöst.
- **M3 Time Card** (`custom:m3-time-card`): Bearbeitet `input_datetime`-Helfer
  im Designsystem des Projekts, in mehreren Darstellungsvarianten
  (Stepper-Felder oder Scroll-Räder). Die Sichtbarkeit des
  „Übernehmen"-Knopfs ist einstellbar.
- **M3 Todo Card** (`custom:m3-todo-card`): Einkaufs- und Aufgabenlisten im
  Designsystem des Projekts, als Ersatz für HAs eingebaute `todo-list`-Karte.
  Header mit Zähler-Chip, Eingabezeile mit Radius-Morph beim Fokus, Einträge
  mit Häkchen-Morph vom Ring zum gefüllten Squircle, und ein Aufklappbereich
  für Erledigtes samt „Erledigte löschen".
- Einträge landen wahlweise oben oder unten in der Liste (`add_position`), und
  doppelte Einträge werden abgefangen: statt einer zweiten identischen Zeile
  pulst der vorhandene Eintrag kurz auf (`prevent_duplicates`).
- Schnellwahl-Chips über der Todo-Liste, gespeist aus einer festen Liste, aus
  zuvor abgehakten Einträgen oder aus den M3 Supply Cards des Dashboards — dort
  hinterlegte Einkaufstexte erscheinen als Chip, der knappste Vorrat zuerst.
- Langes Drücken öffnet eine Todo-Zeile zum Umbenennen oder Löschen. Optional
  Gruppierung nach `Kategorie: Artikel` und Umsortieren per Ziehgriff.
- Gemeinsame Benachrichtigungs-Infrastruktur für Occupancy-, Leak- und
  Waste-Karte: ein „Benachrichtigung"-Panel im Editor mit Dienst-Auswahl,
  optionalem Titel/Text und einem Schalter. Es legt eine — standardmäßig
  deaktivierte — Automatisierung an; Occupancy und Leak lösen bei einem
  Sensorwechsel aus, Waste zeitgesteuert zur Erinnerungszeit.
- **M3 Media Card — Bibliothek und Warteschlange**: Meldet der Player
  `BROWSE_MEDIA`, öffnet eine Zeile am Fuß der Karte HAs Medienbrowser —
  Breadcrumb-Navigation, Vorschaubild oder `media_class`-Icon je Zeile, Ordner
  zum Hineinnavigieren, abspielbare Einträge per Tap. Ein zweiter Reiter zeigt
  die Warteschlange, sofern die Integration eine liefert; Cast und Spotify tun
  das nicht und bekommen den Reiter gar nicht erst. Ebenen mit tausenden
  Einträgen werden bei 100 Zeilen gekappt (`show_browser`, `default_tab`,
  `browse_height`).
- **M3 Media Card — Metadaten und Chips**: Titel zweizeilig, Interpretenzeile
  mit Radio-Fallback über `media_channel`, dritte Zeile mit Album und Jahr.
  Darunter Chips für Ausgabegerät und Quelle, optional Titelnummer, Jahr und
  Bitrate über `meta_chips`. Führende Tracknummern werden entfernt
  (`strip_track_number`), ohne Titel wie `1979` oder `365 Dreams` anzutasten.
- **M3 Media Card — Fortschritt**: Wellen-Indikator, der beim Pausieren flach
  ausläuft. Streams ohne Dauer zeigen ein wanderndes Wellensegment und einen
  „Live"-Chip. Restzeit mit Minuszeichen, umschaltbar über `time_display`.
  Spulen mit 200-ms-Drosselung.

### Geändert
- **M3 Media Card**: Transportleiste in der Reihenfolge Shuffle · Zurück ·
  Play/Pause · Vor · Repeat, mit neuen Größen. Der Play-Knopf ist der
  Zustandsanzeiger der Zeile — Kreis pausiert, Squircle beim Abspielen, mit
  überblendendem Symbol. Repeat läuft jetzt dreistufig (aus → alle → einer).
  Alle Knöpfe morphen beim Tippen kurz die Ecken ein.
- **M3 Media Card**: `FEATURE.STOP` fehlte in der Feature-Maske. Player, die
  nicht pausieren, aber stoppen können, zeigen jetzt ein Stopp-Symbol.
- **M3 Media Card**: Die Akzentfarbe aus dem Cover ist nicht mehr der
  Durchschnitt aller Pixel — der ergibt Hintergrund plus Motiv addiert, also
  meist einen entsättigten Braunton. Stattdessen wird die dominante gesättigte
  Farbe gewählt und danach auf mindestens 3,2:1 gegen die dunkle Tinte
  gebracht. Ein Cover, das vorher `#4c3d56` bei 1,71:1 lieferte (praktisch
  unsichtbares Symbol), landet jetzt bei einem lesbaren Violett. Farbwechsel
  blenden über 400 ms über.
- **M3 Button Card**: Der Slider übernimmt jetzt auch beim Tippen, nicht nur
  beim Ziehen, und bleibt bei ausgeschaltetem Licht bedienbar. Das Icon wird
  im Slider-Modus zum Schalter.
- Drags auf Slidern und Rädern werden von Swipe-Plugins des Dashboards
  abgeschirmt (`shared/swipe.ts`), damit ein seitlicher Wisch nicht die
  Ansicht wechselt.
- **M3 Counter Card**: Optionale Korrektur des Zählerstands direkt im Header
  (opt-in und mit Warnhinweis), plus Fix der ARIA-Bereichsangabe im
  12-Stunden-Format.
- Rad-Drags der neuen Zeit-/Wähl-Elemente werden von Swipe-Plugins des
  Dashboards abgeschirmt, damit ein Drehen am Rad nicht die Ansicht wechselt.
- README von Grund auf neu strukturiert: ein Einsteiger-Katalog nach
  Themenbereichen, je Karte Code, Erklärung und ein eigenes Bild sowie ein
  aktualisiertes Gesamtbild mit allen Karten. Beispiel-Entitäts-IDs
  anonymisiert.

### Behoben
- **Alle Karten im hellen Theme**: Der Glas-Hintergrund mischte seinen
  Schleier aus `--primary-text-color`. Im hellen Theme ist die dunkel, sodass
  die Fläche den Hintergrund zusätzlich verdunkelte — und darauf stand dann
  dunkler Text. Über einem dunklen Dashboard-Hintergrundbild waren die Karten
  praktisch unlesbar. Gemischt wird jetzt aus der Kartenfläche, die HA ohnehin
  themekorrekt liefert: hell im hellen Theme, dunkel im dunklen. Damit stimmt
  der Kontrast von selbst, ohne Theme-Erkennung und unabhängig davon, was
  hinter dem Dashboard liegt. Bestand seit 1.0.0.
- **Alle Karten im hellen Theme**: `tintBackground` mischte getönte Flächen
  ebenfalls gegen `transparent` — eine 14-%-Tönung war damit zu 86 %
  durchsichtig, und was durchschien, war der Schleier über dem
  Hintergrundbild. Icon-Felder, Kacheln und Balken waren dadurch kaum zu
  erkennen. Gemischt wird jetzt in die Kartenfläche, wodurch die Tönung
  definiert ist und in beiden Themes gleich stark wirkt.
- **M3 Light Card**: Die Wellenanimation rief bei jedem Frame
  `requestUpdate()` und baute damit die komplette Karte samt Farbrad neu auf,
  solange eine Lampe an war. Eine Instanz erzeugte 1820 Renders in 15 Sekunden
  — 73 % eines Dashboards mit 35 Karten. Der Frame schreibt jetzt nur noch das
  `d`-Attribut des einen Pfades: 1820 → 9.
- **M3 Media Card**: Dieselbe Ursache im Fortschrittsbalken — ein `@state`-Feld
  mit Millisekunden-Genauigkeit wurde in `updated()` neu berechnet, sodass
  jeder Render den nächsten auslöste. Die präzise Position ist jetzt entkoppelt,
  reaktiv ist nur noch die ganze Sekunde.
- **M3 Media Card**: Der Power-Knopf der Kompaktansicht trug den Icon-Namen als
  `aria-label`. Alle Icon-Knöpfe haben jetzt lokalisierte Beschriftungen.

### Leistung
- `shouldUpdate` in 15 von 29 Karten (`shared/should-update.ts`). HA weist
  `hass` bei jeder Zustandsänderung im gesamten System neu zu, sodass bisher
  jede Karte bei jedem fremden Sensor neu rendert. Umgestellte Karten rendern
  nur noch, wenn eine ihrer eigenen Entitäten sich ändert. Bewusst ausgenommen
  sind Karten mit Auto-Discovery und solche, deren Entitäten aus dem
  Energie-Dashboard, Statistiken oder der Registry stammen — dort ließe sich
  die Liste nicht vollständig ableiten, und eine unvollständige Liste würde
  eine Karte still aufhören lassen zu reagieren.
- Intl-Formatter werden zwischengespeichert statt bei jedem Aufruf neu gebaut
  (41 Stellen, teils pro Listenzeile pro Render).

### Aufgeräumt
- 27 ungenutzte Konstanten und 30 tote Übersetzungsschlüssel entfernt;
  `noUnusedLocals` und `noUnusedParameters` sind jetzt aktiv.
- Button- und Cover-Karte waren die einzigen zwei von 23 Karten mit Timern
  ohne `disconnectedCallback`; der Arm-Timeout der Leak-Karte wurde nie
  verfolgt. Alle drei räumen jetzt auf.
- Die neun kartenspezifischen `_formatNumber` nutzen jetzt die gemeinsame
  Funktion. Zwei davon fingen einen unbrauchbaren Locale-Tag ab, sieben nicht
  — der Schutz gilt jetzt für alle.

## [1.9.0]

### Neu
- **M3 Supply Card** (`custom:m3-supply-card`): Vorratsverwaltung für
  Verbrauchsmaterial. Ein Vorrat steht groß als Hero mit einem Punkt je
  verbleibender Einheit (ab 40 Stück ein Balken), Stepper mit Wiederholung
  beim Halten und ein „Packung nachgefüllt"-Knopf; weitere Vorräte folgen als
  Zeilen mit Füllstandsbalken, ein Tap macht sie zum Hero. Zustandsfarben und
  Schwellwerte sind pro Artikel einstellbar.
- Reichweiten-Schätzung aus der Historie des Helfers. Geteilt wird durch den
  Zeitraum, den die Daten tatsächlich abdecken, nicht durch das angefragte
  Fenster — der Recorder bewahrt standardmäßig nur 10 Tage auf, sonst
  verspräche die Karte die dreifache Reichweite. Eine Schätzung erscheint erst
  nach mindestens 3 Verbrauchsereignissen und 2 Tagen Beobachtung; wer sofort
  eine Zahl will, setzt `usage_per_week`.
- Benachrichtigung, wenn ein Vorrat zur Neige geht: als Abend-Digest mit allen
  Vorräten in einer Nachricht, wöchentlich oder sofort beim Unterschreiten.
  Auslöse-Niveau wählbar zwischen leer, kritisch und knapp, jeweils über die
  Schwellwerte des einzelnen Artikels. Über `notify_items` lässt sich die
  Meldung auf einzelne Vorräte begrenzen statt auf alle der Karte.
- Anbindung an die To-do-Listen von Home Assistant: ein Chip im Hero schreibt
  den Vorrat auf die Einkaufsliste, `auto_add_to_list` erledigt es ungefragt
  in der Automatisierung — inklusive Dublettenprüfung, damit eine tägliche
  Erinnerung die Liste nicht vollschreibt.

## [1.8.2]

### Behoben
- **Alle Karten mit Benachrichtigung** (Updates, Akku, Steckdosen, NAS): Die
  vom Editor erzeugte Automatisierung stürzte ab, sobald man sie im
  Automatisierungs-Menü von Hand ausführte — also genau bei dem Versuch, das
  Ankommen der Push zu testen. „Ausführen“ überspringt den Auslöser und
  startet die Aktionen ohne Auslöser-Kontext; jede Textvorlage las aber
  `trigger.to_state` und lief in einen `UndefinedError`, ohne dass eine
  Benachrichtigung rausging. Die Vorlagen greifen jetzt auf `s` zu — beim
  echten Auslöser die auslösende Entität, beim Handstart eine
  Beispiel-Entität. Bevorzugt wird eine, auf die die Bedingung gerade
  zutrifft, damit der Test die echte Formulierung mit echten Werten zeigt
  statt eines Geräts, dem nichts fehlt.
- **Versionsstempel**: `CARD_VERSION` stand seit dem ersten Release auf
  `1.0.0`. Die Konsolen-Zeile jeder Karte (`M3-BATTERY-CARD v1.0.0`) nannte
  damit eine Version, die es nie gab — ausgerechnet die Angabe, nach der man
  bei einer Fehlermeldung als Erstes fragt. Steht jetzt auf `1.8.2`.
- **Versionsstempel in der Konfiguration**: `stampVersion()` lief im
  `setConfig()` der Karte und beschrieb damit nur die Kopie im
  Arbeitsspeicher — gespeichert wurde der Stempel nie, kein einziges
  `card_version` landete je in einem Dashboard. Gestempelt wird jetzt beim
  Verlassen des Editors, also auf dem einzigen Weg, auf dem eine
  Konfiguration tatsächlich geschrieben wird.

- **M3 NAS Card**: Die Benachrichtigung ging nie raus — bei keinem Auslöser.
  Die Namenstabelle wurde als roher JSON-Text in `variables` geschrieben;
  Home Assistant reicht so etwas als Zeichenkette weiter, und der Zugriff
  `nas_names.get(...)` scheiterte an „NodeStrClass object has no attribute
  'get'“. In `{{ }}` gefasst rendert HA sie zu einem echten Dictionary.
- **M3 Updates Card**: Meldung und Liste sagten „Update“ doppelt („AdGuard
  Home Update: Update auf 6.2.1 verfügbar“, Zeile „M3 Cards Update“). Der
  `friendly_name` einer Update-Entität endet auf das Wort, das die Karte mit
  Überschrift und Versionsspalte ohnehin sagt. Add-ons und Integrationen
  liefern ein sauberes `title`-Attribut, HACS-Einträge nicht — dort wird die
  Endung jetzt abgeschnitten. Betrifft Einzelmeldung, Sammelmeldung, die
  Update-Liste und die Liste der nicht erreichbaren Komponenten, die einen
  Namen ab sofort alle gleich bilden.

## [1.8.1]

### Geändert
- Nur Dokumentation, keine Änderung am ausgelieferten `m3-cards.js` — das
  Bundle ist byte-identisch mit v1.8.0.
- Neues Übersichtsbild mit allen 22 Karten; das bisherige zeigte noch die
  ersten achtzehn.
- Eigene Screenshots für die M3 Updates Card, die M3 NAS Card und die
  M3 System Card in ihren jeweiligen Abschnitten.
- Die Bildunterschrift des Übersichtsbilds behauptete, alle Namen seien
  generische Demo-Daten. Das stimmte für die Aufnahme nicht; sie nennt jetzt
  die Karten, die für das Bild simulierte Zustände zeigen.

Grund für das Release: HACS rendert das README des veröffentlichten Stands,
nicht das des Standard-Branches. Die Bilder wurden nach dem Tag v1.8.0
ergänzt und waren dort deshalb nicht sichtbar.

## [1.8.0]

### Hinzugefügt
- **Neue Karte: M3 Updates Card** (`custom:m3-updates-card`). Übersicht aller
  verfügbaren Updates in einer Kachel.
  - **Header** in der gemeinsamen Designsprache der Listen-Karten: Icon
    links, Kartenname als Titel, Status als Untertitel („Alles aktuell“ /
    „{n} Updates verfügbar“ / „{name} wird installiert“) und ein Zähler-Chip
    rechts.
  - **Kern-Boxen** für Core, Betriebssystem und Supervisor mit
    `{installed} → {latest}`, MAJOR-Badge und Install-Button. Die
    MAJOR-Erkennung versteht beide Versionsschemata: bei
    HA-Kalenderversionen (`2026.8.1`) zählt der Wechsel von Jahr oder Monat,
    bei SemVer (`5.8.0`) die erste Zahl.
  - **Bestätigungsschritt** vor Kern-Updates (`require_confirm`, Standard an).
    Der Button entschärft sich nach fünf Sekunden von selbst — auf einem
    Wandtablet soll kein scharfer „startet-HA-neu“-Button liegenbleiben.
  - **Gruppierung über die Integration** statt über den `entity_id`-Namen. Bei
    eingebundener zweiter Instanz hätte eine Namensregel zwei
    ununterscheidbare Core-Boxen erzeugt; die zweite Instanz bekommt jetzt
    eine eigene Gruppe. Reihenfolge und Sichtbarkeit der Gruppen sind im
    Editor per Pfeiltasten bzw. `include_types` einstellbar.
  - **Backup-Chip** im Header (`backup_entity`), grün bis `backup_warn_days`,
    danach orange, ohne Zeitstempel rot.
  - **Übersprungene Updates** stehen gedimmt am Ende mit eigenem Button zum
    Wiederanzeigen — und zählen nicht mehr als „aktuell“.
  - **Aufklappbereich** für bereits aktuelle Komponenten, `max_visible` für
    die Update-Liste selbst.
  - **Benachrichtigung** sofort, täglich oder wöchentlich, mit denselben
    Freitextfeldern wie die übrigen Karten.
  - **Verbindungsverlust** während eines Core-Updates wird als solcher
    angezeigt statt als eingefrorenes Banner.
  - Nicht erreichbare Update-Entities zählen nicht als „aktuell“ und lassen
    sich unter den erreichbaren Komponenten aufklappen — mit Gruppe statt
    Version, damit sichtbar wird, welche Integration gerade nichts liefert.
- **Neue Karten: M3 NAS Card und M3 System Card** (`custom:m3-nas-card`,
  `custom:m3-system-card`). Speicherbelegung pro Volume mit Balken, darunter
  CPU, RAM, Temperatur und Netzwerk als Statuskacheln, dazu der Zustand der
  Syncthing-Ordner. Beide teilen sich eine Implementierung und unterscheiden
  sich nur in der Datenquelle: Glances für ein NAS, System Monitor für die
  eigene Instanz.
  - Entitäten werden über den `translation_key` der Entity-Registry erkannt,
    nicht über den Anzeigenamen — den übersetzt Home Assistant, eine
    Namensregel funktioniert nur in einer Sprache.
  - Fehlt ein Prozent-Sensor (System Monitor liefert `disk_use_percent`
    standardmäßig deaktiviert), wird die Belegung aus „belegt“ und „frei“
    berechnet, statt das Volume wegzulassen.
  - Laufwerkssensoren haben Vorrang vor SoC-Thermals — sonst zeigt die Karte
    49 °C, während die Platten bei 32 °C liegen.
  - Mount-Pfade werden gekürzt (`/rootfs` entfällt, UUID-Volumes werden zu
    „Volume a1b2c3d4“), `mount_names` überschreibt das.
  - **Benachrichtigungen** für Sync-Fehler (inklusive `pull_errors`, die auch
    bei Zustand `idle` auftreten), volle Platten und ausbleibende Daten.
    Pausierte Ordner lösen bewusst nichts aus.
- **Eigene Benachrichtigungstexte.** Jedes Benachrichtigungs-Panel hat jetzt
  zwei Freitextfelder für Titel und Nachricht. Leer lassen behält den
  bisherigen Text, sodass sich für bestehende Konfigurationen nichts ändert.
  Platzhalter in geschweiften Klammern werden beim Anlegen der
  Automatisierung durch die passende Vorlage ersetzt; welche es gibt, steht
  je Karte direkt unter den Feldern:
  - Energy: `{wert}`, `{einheit}`, `{zeitraum}`
  - Cost: `{betrag}`, `{waehrung}`, `{budget}`, `{zeitraum}`
  - Battery: `{anzahl}`, `{liste}`, `{geraet}`, `{wert}`
  - Progress: `{geraet}`
  - Power List: `{geraet}`, `{watt}`, `{stunden}`
  - Climate Overview / Top Consumers: `{anzahl}`, `{liste}`
  - Aquarium: `{tage}`
  Emoji sind möglich. Unbekannte Platzhalter bleiben sichtbar stehen, statt
  stillschweigend zu verschwinden — ein Tippfehler fällt so in der Nachricht
  auf, statt eine Lücke zu hinterlassen.

### Behoben
- **M3 Climate Overview Card**: Die Namen an der Vergleichsskala waren
  entweder alle weg oder unlesbar übereinander. Bis acht Räume wurde jeder
  Name gezeichnet — mittig auf seinem Punkt, ohne Prüfung, ob daneben schon
  einer steht; ab neun Räumen fiel die Beschriftung komplett weg. Liegen
  Räume dicht beieinander, überlagerten sich die Namen zu Buchstabensalat.
  Jetzt werden die Namen kollisionsfrei auf zwei Reihen verteilt: kältester
  und wärmster Raum zuerst, damit die Enden der Skala nie ihren Namen
  verlieren, der Rest von links nach rechts, solange Platz ist. Namen am
  Rand rutschen nach innen statt aus der Karte zu ragen. Neue Option
  `show_scale_labels`, falls nur die Punkte gewünscht sind.

## [1.7.0]

### Hinzugefügt
- **Benachrichtigungen direkt aus dem Kachel-Editor.** Acht Karten können
  jetzt eine echte Home-Assistant-Automatisierung anlegen, die auch
  benachrichtigt, wenn kein Dashboard geöffnet ist. Jede hat im Editor einen
  Abschnitt „Benachrichtigung" mit Ein/Aus-Schalter (standardmäßig aus),
  Empfängerauswahl aus den eigenen `notify.*`-Diensten und einer Statuszeile,
  die den tatsächlichen Zustand der Automatisierung anzeigt:
  - **M3 Battery Card** — schwache Batterien; täglich oder wöchentlich als
    Sammelnachricht, oder sofort beim Unterschreiten. Freier Schwellwert
    (Standard 1 %), plus `notify_exclude_entities`, um einzelne Geräte
    stummzuschalten, ohne sie aus der Kachel zu entfernen.
  - **M3 Energy Card** — Tagesertrag bzw. Monatsabschluss.
  - **M3 Cost Card** — Warnung bei fast erreichtem Budget (Standard 90 %)
    und Monatsabschluss.
  - **M3 Progress Card** — „Gerät ist fertig", ausgelöst nur beim echten
    Übergang von einem Lauf- in einen Fertig-Zustand.
  - **M3 Power List Card** — „Gerät läuft seit N Stunden", mit Schwellwert,
    Dauer und Ausschlussliste für Dauerläufer.
  - **M3 Climate Overview Card** — täglicher Digest zum Schimmelrisiko,
    exakt nach derselben Regel wie das Warnsymbol der Kachel.
  - **M3 Top Consumers Card** — Wochenrangliste, sofern die Verbraucher über
    wöchentliche `utility_meter`-Helfer laufen (siehe Einschränkung unten).
  - **M3 Aquarium Card** — die bestehende Reinigungs-Erinnerung nutzt jetzt
    dieselbe Basis und denselben Schalter.

### Geändert
- Die Benachrichtigungs-Mechanik liegt jetzt in einem gemeinsamen Modul
  (`shared/notify-editor.ts`) statt je Karte dupliziert zu sein.
- Das Empfängerfeld hieß „Benachrichtigung an", was sich im Deutschen wie
  ein Ein-Schalter liest. Es heißt jetzt „Empfänger".

### Behoben
- **M3 Power List Card**: Mit gesetztem `max_visible` wurden alle
  ausgeblendeten Geräte als inaktiv behandelt — auch die, die gerade Strom
  verbrauchen und nur wegen des Limits nach unten gerutscht sind. Sie
  erschienen ausgegraut mit durchgestrichenem Stecker-Symbol, und der Zähler
  am Umschalter zählte sie als „inaktive Geräte" mit. Aktive Geräte behalten
  jetzt auch aufgeklappt ihre normale Darstellung und stehen dort oben; der
  Umschalter heißt in dem Fall „N weitere Geräte anzeigen".
- **M3 Power List Card**: Die Balkenlängen richten sich jetzt nach dem
  stärksten Verbraucher insgesamt statt nur nach dem der sichtbaren Zeilen —
  bei Sortierung nach Name oder aufsteigender Leistung konnte der größte
  Verbraucher sonst aus der Skala fallen.
- **M3 Battery Card**: `notify_service` war als Konfigurationsfeld
  deklariert, wurde aber nirgends ausgewertet und hatte keine Wirkung.
- Automatisierungs-IDs wurden aus dem Kartennamen abgeleitet, wodurch zwei
  gleichnamige Karten dieselbe Automatisierung überschrieben. Sie werden
  jetzt einmalig erzeugt und in der Kartenkonfiguration abgelegt; bestehende
  Automatisierungen werden dabei übernommen, nicht verwaist.
- **M3 Energy Card**: Der Meldungstext behauptete „Heute verbraucht", sobald
  die Karte nicht ausdrücklich im Solar-Modus lief — falsch für den
  häufigen Fall, eine Standard-Karte auf einen Erzeugungszähler zu richten.
  Der Text ist jetzt neutral („Heute:"), im Solar-Modus weiterhin „Heute
  erzeugt:".

### Einschränkungen
Ein Jinja-Template in einer Automatisierung kann die Langzeitstatistik nicht
lesen — nur den aktuellen Zustand einer Entität. Energy, Cost und Top
Consumers beziehen ihre Zahlen aber genau daher. Diese drei funktionieren
deshalb nur, wenn eine Entität den Periodenwert bereits als Zustand hält,
also ein periodengebundener `utility_meter`. Ist das nicht der Fall, bleibt
der Schalter gesperrt und der Editor nennt den Grund, statt eine
Automatisierung zu erzeugen, die plausible, aber falsche Zahlen meldet.

## [1.6.0]

### Hinzugefügt
- **M3 Aquarium Card**: Reinigungs-Erinnerung direkt aus dem Kachel-Editor.
  Im Abschnitt „Wartung → Erinnerung“ lassen sich ein oder mehrere
  Benachrichtigungsziele (aus den eigenen `notify.*`-Diensten) und eine
  tägliche Prüfzeit wählen; ein Klick auf „Erinnerung einrichten“ legt eine
  echte Home-Assistant-Automatisierung an, die auch dann benachrichtigt,
  wenn kein Dashboard geöffnet ist. Fehlt ein Intervall-Helfer, wird er
  automatisch mit angelegt. Erneutes Klicken aktualisiert dieselbe
  Automatisierung, statt Duplikate zu erzeugen.
- **M3 Aquarium Card**: neue Option `cleaning_interval_entity` — ein
  `input_number`-Helfer als Reinigungsintervall. Hat Vorrang vor der festen
  Zahl und wird von Kachel-Chip und Erinnerungs-Automatisierung gemeinsam
  gelesen, sodass beide nicht auseinanderlaufen können.

## [1.5.0]

### Hinzugefügt
- **M3 Aquarium Card** (`custom:m3-aquarium-card`) — neue Karte:
  Geräte-Raster (Taglicht, Nachtlicht, Pumpe, Heizer, CO2 + beliebig
  viele weitere Geräte), Tagesbogen-Beleuchtungsplan (manuelle
  Phasenliste oder `schedule`-Helfer), optionale Kamera als Standbild,
  Banner oder echter Live-Stream, Status-Chips (Temperaturabweichung,
  Heizer ohne Leistung, Wasserstand, pH/TDS, fällige Reinigung) und
  vollständiger visueller Editor.
- **M3 Climate Overview Card**: individuelle Farbe pro Raum
  (`rooms[].color`) — überschreibt die automatische Temperatur-Einfärbung
  für einzelne Thermometer, statt nur die fünf globalen Farbstufen zu
  nutzen.
- **Farbstärke-Regler**: jede Karte, die eine Akzent-/Themenfarbe als
  Hintergrund-Tönung verwendet, hat jetzt einen 0–100-Regler direkt neben
  der Farbauswahl im Editor, der steuert, wie kräftig diese Farbe den
  Hintergrund einfärbt (ersetzt die bisher fest einprogrammierten
  Prozentwerte). Unveränderte Karten sehen dabei exakt wie vorher aus —
  der Regler startet immer beim bisherigen Standardwert.
- Deutsche Farbnamen (`grau`, `rot`, `blau`, `grün`, `gelb`, `lila`/
  `violett`, `rosa`, `braun`, `schwarz`, `weiß`, `türkis`, `hellblau`,
  `hellgrün`, `dunkelgrau`) werden jetzt in jedem Farbfeld erkannt, nicht
  nur die englischen Namen.

### Behoben
- **M3 Climate Overview Card**: die Editor-Option „Akzentfarbe“ hatte
  keinerlei Effekt — sie wurde beim Rendern der Karte nie ausgelesen.
  Färbt jetzt korrekt das Header-Icon ein.
- Ein deutscher Farbname wie `grau` in einem Farbfeld ergab bisher keine
  gültige CSS-Farbe und ließ den betroffenen Hintergrund komplett
  durchsichtig werden, statt eine sichtbare Fehlermeldung oder zumindest
  eine erkennbare Farbe zu liefern (siehe „Hinzugefügt“ oben).
- Energie-Statistiken (u.a. Energy-, Cost-, Power-Karten): ein negativer
  „Change“-Wert für einen Zeitraum wird jetzt auf 0 begrenzt, statt
  Balken/Durchschnitte/Summen zu verfälschen — trat vereinzelt auf, wenn
  der Recorder beim Neuladen einer Entität genau an einer Tagesgrenze die
  Kontinuität der Langzeitstatistik verliert und den Wert nach einem
  Zähler-Reset fälschlich als Abnahme statt als neuen Zyklus verbucht.

## [1.4.0]

### Hinzugefügt
- **M3 Counter Card**: neuer Editor-Abschnitt „Kalibrierung“ für
  `utility_meter`-Entitäten — Zählerstand direkt aus dem Dashboard-Editor
  auf einen neuen Wert setzen (z.B. um ihn an einen analogen Zähler
  anzugleichen), ohne Umweg über die Entwicklerwerkzeuge. Erscheint
  automatisch nur bei passenden Entitäten, die Statistik-Historie bleibt
  unangetastet.

### Geändert
- **M3 Energy Card**: die Monatsansicht zeigt jetzt immer alle 12 Monate
  (mit Null für Monate vor Erstellung der Entität) statt bei fehlender
  Historie komplett zu blockieren — verhält sich damit wie länger
  bestehende Zähler.
- **M3 Energy Card**: der Monats-Durchschnitt wird nur noch über Monate mit
  echten Daten gemittelt, statt durch Platzhalter-Nullen vor Erstellung der
  Entität verwässert zu werden.

## [1.3.0]

### Hinzugefügt
- **M3 Energy Card**: neue Option `unit`, um die angezeigte Einheit zu
  überschreiben — nötig für abgeleitete Zähler (z.B. Utility-Meter-Helfer),
  die keine eigene `unit_of_measurement` melden und sonst pauschal "kWh"
  anzeigen würden.

## [1.2.0]

### Hinzugefügt
- **M3 Cost Card**: neuer Preis-Einheit-Modus `custom` — frei definierbare
  Einheit (z.B. "€/m³") plus ein Mengen-Umrechnungsfaktor, damit die Karte
  auch für Wasser, Gas oder beliebige andere Zähler funktioniert, nicht nur
  für kWh-Strompreise.

## [1.1.0]

### Hinzugefügt
- **M3 Climate Overview Card** — raumweise Übersicht aller Temperatur-/
  Feuchte-Sensoren, automatisch gruppiert nach Bereich (Fallback: Gerät
  oder Entity-Name), mit Farbstufen, Vergleichsskala, Hinweis-Chip für
  den auffälligsten Raum sowie optionalen Trendpfeilen und
  Schimmel-Warnungen.
- **M3 Light Card**: echte Farbtemperatur-Steuerung (Presets + Slider),
  HS-Farbrad mit Palette, Szenen-Zeile und Gruppenmitglieder-Liste für
  Licht-Gruppen — inkl. vollständiger Editor-Unterstützung.
- **M3 Energy Flow Card**: Batterie-Knoten im Fluss-Diagramm, `battery_color`
  und `show_battery` sind jetzt tatsächlich wirksam.

### Geändert
- M3 Climate Card und M3 Energy Flow Card nutzen jetzt das gemeinsame
  Erscheinungsbild-Panel im Editor (Eckenradius-Presets, Ecken einzeln).
- Englisches README ist jetzt Standard, Deutsch liegt unter `README.de.md`.

## [1.0.0] — Erste Veröffentlichung (Beta)

Erste öffentliche Version.
