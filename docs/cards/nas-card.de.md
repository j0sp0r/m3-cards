---
title: M3 NAS Card / M3 System Card
type: m3-nas-card
category: system
display: NAS
summary: NAS-Volumes, CPU, RAM, Netzwerk über Glances + Syncthing
table_order: 2
section_order: 20
also_type: m3-system-card
also_display: System
also_summary: Dasselbe, gespeist vom System-Monitor
also_table_order: 3
---

Zwei Kacheln mit derselben Implementierung: Speicherbelegung pro Volume,
darunter CPU, RAM, Temperatur und Netzwerk als kompakte Statuskacheln,
optional der Zustand der Syncthing-Ordner. Die NAS Card liest die
**Glances**-Integration, die System Card die **System-Monitor**-Integration —
sonst sind sie identisch.

<img src="docs/images/nas-card.png" alt="M3 NAS Card" width="440">

<img src="docs/images/system-card.png" alt="M3 System Card" width="440">

<sub>Oben die NAS Card mit zwei Volumes und den Syncthing-Ordnern, darunter
die System Card für die eigene Instanz. Die Laufwerksnamen stammen aus
`mount_names` — Glances meldet sonst Pfade wie
`/rootfs/srv/dev-disk-by-uuid-…`.</sub>

<details>
<summary>Konfiguration, Beispiele & Optionen</summary>

```yaml
type: custom:m3-nas-card
name: NAS

# oder, für die eigene HA-Instanz:
type: custom:m3-system-card
name: Home Assistant
```

### Datenquelle einrichten

Für die System Card genügt die mitgelieferte **System-Monitor**-Integration.

Für die NAS Card muss auf dem NAS **Glances** mit REST-API laufen; danach in
HA die Glances-Integration mit Host und Port `61208` hinzufügen. Im Container
ist ein Bind des Hosts nötig, sonst meldet Glances nur die Dateisysteme des
Containers statt der echten Volumes:

```yaml
services:
  glances:
    image: nicolargo/glances:latest-full
    network_mode: host
    pid: host
    restart: unless-stopped
    environment:
      - GLANCES_OPT=-w --disable-webui
    volumes:
      - /:/rootfs:ro
```

`--disable-webui` liefert nur die API, die HA braucht, ohne zusätzlich eine
unauthentifizierte Weboberfläche im Netz zu öffnen.

### Erkennung

Entitäten werden über den `translation_key` aus der Entity-Registry erkannt,
**nicht** über den Anzeigenamen — Home Assistant übersetzt den, eine
Namensregel würde nur in einer Sprache funktionieren. Das Label (Mount-Punkt,
Sensorname, Interface) stammt aus der `unique_id`.

Ist kein Prozent-Sensor aktiv — System Monitor liefert `disk_use_percent`
standardmäßig deaktiviert — rechnet die Karte die Belegung aus „belegt“ und
„frei“, statt das Volume wegzulassen.

Mount-Pfade werden für die Anzeige gekürzt (`/rootfs` entfällt,
UUID-Volumes werden zu „Volume a1b2c3d4“). `mount_names` überschreibt das
pro Pfad, `exclude_mounts` blendet einzelne aus.

### Temperatur

Glances meldet Platten- und SoC-Sensoren in einer Liste, und der SoC läuft
immer heißer. Die Karte bevorzugt deshalb Laufwerkssensoren, sobald welche
vorhanden sind — sonst stünde dort 49 °C, während die Platten bei 32 °C
liegen. `temperature_labels` legt die Auswahl bei Bedarf selbst fest.

### Synchronisation

Mit eingerichteter **Syncthing**-Integration listet die Karte jeden Ordner
mit Zustand und Größe; während einer Übertragung steht dort der Fortschritt
statt der Größe. Ohne die Integration bleibt der Abschnitt leer.

### Benachrichtigungen

Der Abschnitt **Benachrichtigung** legt eine Automatisierung mit bis zu drei
Auslösern an:

- **Sync-Fehler** — Ordner geht auf `error`, oder `errors` bzw. `pull_errors`
  steigt über 0. Letzteres ist wichtig: Syncthing sammelt Pull-Fehler,
  während der Ordner formal auf `idle` steht. **Pausierte Ordner lösen nichts
  aus** — das ist eine Einstellung, kein Fehler.
- **Platte voll** — Belegung über `notify_disk_threshold`.
- **Nicht erreichbar** — die Sensoren melden `unavailable`, standardmäßig
  aus, weil das bei jedem Neustart feuert.

Die Nachrichten nutzen die Namen, die auch die Kachel anzeigt. Die rohen
Entity-Namen wären unbrauchbar („Syncthing (http://…) ABCDEFG HA Share HA
Share“), deshalb wird die Zuordnung beim Einrichten in die Automatisierung
geschrieben.

### Konfigurationsoptionen

| Option | Typ | Standard | Beschreibung |
|---|---|---|---|
| `source` | `glances` \| `systemmonitor` | je nach Kacheltyp | Datenquelle |
| `config_entry_id` | string | – | Einschränkung auf eine Instanz, wenn mehrere existieren |
| `exclude_mounts` | Liste\<string\> | – | Auszublendende Mount-Punkte |
| `mount_names` | Objekt | – | Mount-Pfad → Anzeigename |
| `disks` | Liste | – | Explizite Reihenfolge und Benennung der Volumes |
| `disk_warn` / `disk_critical` | number | `80` / `90` | Prozent-Schwellwerte der Zeilenfarbe |
| `temp_warn` / `temp_critical` | number | `55` / `65` | Temperatur-Schwellwerte in °C |
| `temperature_labels` | Liste\<string\> | – | Zu berücksichtigende Temperatursensoren |
| `max_visible` | number | `4` | Direkt sichtbare Laufwerke, Rest hinter „mehr anzeigen“ |
| `show_cpu` / `show_memory` / `show_temperature` / `show_network` | boolean | `true` | Statuskacheln |
| `show_uptime` | boolean | `true` | Laufzeit im Untertitel |
| `show_sync` | boolean | `true` | Syncthing-Abschnitt |
| `sync_entities` | Liste\<string\> | – | Bestimmte Syncthing-Ordner statt aller |
| `notify_service` | Liste\<string\> | – | Benachrichtigungsziele (ohne `notify.`-Präfix) |
| `notify_sync_errors` | boolean | `true` | Bei Sync-Fehlern melden |
| `notify_disk_full` | boolean | `true` | Bei voller Platte melden |
| `notify_disk_threshold` | number | `90` | Schwellwert dafür |
| `notify_offline` | boolean | `false` | Melden, wenn die Quelle nichts mehr liefert |
| `notify_offline_minutes` | number | `10` | Wartezeit davor |
| `notify_title` / `notify_message` | string | – | Eigener Titel/Text, leer = Standardtext |
| `name` / `icon` | string | „NAS“ / `mdi:nas` | Header |
| `ok_color` / `warn_color` / `critical_color` / `offline_color` | string | siehe oben | Statusfarben |
| `accent_opacity` | number | `18` | Intensität der Kopfbereich-Tönung |
| `text_color` / `secondary_text_color` | string | Theme-Standard | Name / Sekundärtext |
| `card_background` | string | Glas-/Solid-Hintergrund | Kartenhintergrund |
| `animation` | `auto` \| `on` \| `off` | `auto` | Aufklapp-Animation |
| `glass_background` | boolean | `true` | Milchiger Glashintergrund |
| `radius` / `corners` | number / object | `28` | Eckenradius, optional je Ecke |

</details>
