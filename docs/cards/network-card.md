---
title: M3 Network Card
type: m3-network-card
category: system
display: Network
summary: The router and the devices on the network, with new devices and problems
table_order: 8
section_order: 59
---

The router at the top — online since when, the connection type, download,
upload and signal — and the devices on the network below it: what is **new**,
what has **problems**, what is offline. New devices and problems light up a
hint line; a tap on it filters to them. A new device is taken as known or
given a name right in the row, with undo.

<img src="docs/images/network-card.png" alt="Network Card" width="440">

<details>
<summary>Configuration, examples & options</summary>

```yaml
type: custom:m3-network-card
router:
  status: binary_sensor.fritz_box_connection
  uptime: sensor.fritz_box_last_restart
  download: sensor.fritz_box_download_throughput
  upload: sensor.fritz_box_upload_throughput
integrations: [fritz]
```

### Where the devices come from

The card does not depend on one integration. Devices come from any of these,
in this order — the first source wins where two disagree, later ones only fill
in what is missing — and are merged by their MAC address, so a device listed
by two sources is one row:

- `device_trackers`: a list of `device_tracker` entities;
- `integrations`: every `device_tracker` of these integrations — `fritz`,
  `unifi`, `openwrt`/`luci`, `nmap_tracker`, `ping` …;
- `clients_entity`: an entity whose attribute (`clients` by default) lists the
  devices as `[{mac, ip, host_name, connection, band, signal}]`. This is for a
  router whose integration has no trackers: a pyscript, REST or MQTT sensor
  that reads the router's client list will do.

From each device it reads what is there: IP, MAC, host name, wired or
wireless (SSID, band), the signal in dBm and when it was last seen. The name
is, in this order, an override, the Home Assistant device's name, the
entity's friendly name, the host name — or "Unknown device". The icon comes
from an override or a guess from the name and manufacturer.

### New devices

The card remembers every device it has met, per user (Home Assistant's user
data, so it follows you between devices). A device it has not met before is
**new**, with "new 12 min ago". On the very first run every device already
there is taken as known, so the card does not open with the whole network
as new. **Known** takes a device as known; **Name it** gives it a name and an
icon. Both can be undone, and the detail sheet (a tap on the row) can forget
a device again or hide it.

Phones and tablets use a **private, random MAC address** per network. The
card spots them (the second bit of the first octet) and, with
`random_mac_handling`, marks them (`flag`, the default — not a problem), folds
them into a device of the same name (`merge_by_name`) or hides them
(`ignore`).

`notify_new` sends a notification about a new device to `notify_service` — but
only while the card is open in a browser. For a notification you can rely on,
use an automation on the source itself.

### Problems

- `weak_signal_below` (−75 dBm): a wireless device with a weaker signal;
- `reconnects` (off by default): more than `reconnect_threshold` (10) switches
  between home and away in 24 hours, from the history — only for
  `device_tracker` sources;
- `ip_conflict` (on): two different MAC addresses with the same IP;
- `problem_template`: your own rule, rendered for each device with `device`
  set (`device.name`, `device.ip`, `device.mac`, `device.signal`,
  `device.online` …): a text is a problem, an empty result is none.

Several problems show as the first one and "+1".

### Examples

UniFi:

```yaml
type: custom:m3-network-card
integrations: [unifi]
reconnects: true
```

Nmap for the devices:

```yaml
type: custom:m3-network-card
integrations: [nmap_tracker]
random_mac_handling: merge_by_name
```

A mobile router without trackers (here a ZTE read by pyscript) for the status,
its client list as a list entity, and Nmap on top:

```yaml
type: custom:m3-network-card
router:
  name: Router
  status: binary_sensor.zte_reachable
  uptime: sensor.zte_online_since
  connection_type: sensor.zte_network_type
  download: sensor.zte_download_bps
  upload: sensor.zte_upload_bps
  signal: sensor.zte_5g_rsrp
  data_used: sensor.zte_monthly_total_gb
clients_entity: sensor.zte_clients
integrations: [nmap_tracker]
```

The MAC address shows in full only in the detail sheet, never in the list.

### Configuration options

| Option | Type | Default | Description |
|---|---|---|---|
| `router` | object | – | `name`, `status`, `uptime` (timestamp or seconds), `connection_type`, `download`, `upload`, `signal` (dBm), `signal_thresholds` (`good` −90, `fair` −105), `data_used`. Every entity is optional; tiles not mapped leave no gap |
| `device_trackers` | list | – | `device_tracker` entities |
| `integrations` | list | – | Every `device_tracker` of these integrations |
| `clients_entity` | entity | – | An entity listing the devices in an attribute |
| `clients_attribute` | string | `clients` | The attribute holding the list |
| `overrides` | list | – | Per device (`mac` or `entity`): `name`, `icon`, `signal` (an entity), `fixed_ip` (shows a pin) |
| `random_mac_handling` | `flag` \| `merge_by_name` \| `ignore` | `flag` | Private MAC addresses |
| `weak_signal_below` | number | `-75` | dBm |
| `reconnects` | boolean | `false` | Count reconnects from the history |
| `reconnect_threshold` | number | `10` | In 24 hours |
| `ip_conflict` | boolean | `true` | Two MACs with one IP |
| `problem_template` | template | – | A problem text per device, or empty |
| `notify_new` | boolean | `false` | Notify about a new device while the card is open |
| `notify_service` | list | – | Recipients |
| `show_search` / `show_filters` | boolean | `true` | Search field, filter chips |
| `show_offline` | boolean | `false` | Offline devices dimmed at the end of "All" |
| `max_items` | number | `6` | Rows before "show more" under "All" |
| `detail_mode` | `sheet` \| `more_info` | `sheet` | A tap: the card's sheet, or the tracker's more-info |
| `title`, `icon` | string | – | Header |
| `glass_background`, `accent_color`, `text_color`, `secondary_text_color`, `card_background`, `radius`, `corners`, `animation` | | | As on every card |

</details>
