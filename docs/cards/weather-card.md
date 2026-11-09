---
title: M3 Weather Card
type: m3-weather-card
category: climate
display: Weather
summary: Temperature curve, precipitation bars, sun markers
table_order: 3
section_order: 14
---

A weather card with a header (icon/temperature/condition/chips), a smoothed
temperature curve with gradient fill, hourly precipitation bars, sunrise/
sunset markers on the curve, and an optional daily overview.

<img src="docs/images/weather-card.png" alt="Weather Card" width="440">

<details>
<summary>Configuration, examples & options</summary>

```yaml
type: custom:m3-weather-card
entity: weather.forecast_home
```

### Setting up weather data

The card needs some `weather.*` entity — it doesn't generate its own
weather data. If you don't have a `weather` integration set up yet (the
editor shows a matching hint in that case), Home Assistant's built-in
**Met.no** integration works for most locations: free, no API key needed,
automatically uses your Home zone's coordinates.

**Settings → Devices & Services → Add Integration → search for "Met.no" →
confirm the location.** A new `weather.*` entity is then available to pick.

Other weather integrations (OpenWeatherMap, AccuWeather, Pirate Weather,
...) work the same way, but usually require a free API key from the
provider.

The hourly forecast is always loaded; the daily overview only if `days` is
set above 0. Both are fetched via the `weather.get_forecasts` service and
refreshed every 15 minutes. If the weather entity briefly goes
`unavailable` (e.g. a DNS/network hiccup in the integration), the card
keeps showing the last known reading with a "Last known reading · X min
ago" hint instead of going blank — "Unavailable" only appears if no data
was ever received. How many days are actually available depends on the
weather integration (Met.no delivers 6 days max); from 4 days on, the
daily list collapses by default and expands via a button.

Each day's bar runs from its low to its high and is coloured by the
temperature itself, on a fixed outdoor scale: blue up to 0 °C, cyan around
10 °C, green around 17 °C, yellow around 24 °C and red from 30 °C, blended
in between. A cold week stays blue and a hot one turns red, rather than every
week running from blue to red.

### Your own sensors

A weather entity does not always carry everything: many have no feels-like
temperature or UV index, while a weather station next door has a sensor for
each. `sensors` takes them instead. `temperature` is the large current
temperature; every other key is the chip of the same name. The forecast still
comes from the weather entity, and a sensor that is unavailable falls back to
the weather entity's value.

```yaml
type: custom:m3-weather-card
entity: weather.home
chips: [apparent_temperature, uv_index, humidity]
sensors:
  temperature: sensor.station_temperature
  apparent_temperature: sensor.station_feels_like
  uv_index: sensor.station_uv
tap_action:
  action: navigate
  navigation_path: /lovelace/weather
```

### Configuration options

| Option | Type | Default | Description |
|---|---|---|---|
| `entity` | string | – (required) | `weather` entity |
| `name` | string | entity's friendly name | Header title |
| `hours` | number | `12` | Number of hours in the curve |
| `days` | number | `0` | Number of days in the daily overview (`0` = hidden) |
| `show_days_toggle` | boolean | `true` | Collapsible from 4 days on with a "Show N more" button; `false` = always show all configured days directly |
| `sensors` | object | – | Own sensors: `temperature` and any chip key (`apparent_temperature`, `wind_speed`, `humidity`, `pressure`, `uv_index`, `visibility`). Each replaces the weather entity's value and brings its own unit |
| `tap_action` | action | `more-info` | Tap on the current conditions |
| `chips` | list (`apparent_temperature`\|`wind_speed`\|`humidity`\|`pressure`\|`uv_index`\|`visibility`) | apparent temp, wind, humidity | Header chips shown |
| `show_sun` | boolean | `true` | Sunrise/sunset markers on the curve (from `sun.sun`) |
| `show_current` | boolean | `true` | The header row: icon, temperature, condition and chips |
| `show_chart` | boolean | `true` | The temperature curve with its precipitation bars |
| `show_hourly_icons` | boolean | `true` | Condition icon per shown hour |
| `show_hourly_temperatures` | boolean | `true` | Temperature per shown hour |
| `show_hour_labels` | boolean | `true` | The hour under each column. Without it the temperatures say nothing about when they apply |
| `show_temp_axis` | boolean | `false` | Min/mid/max temperature marks along the curve |
| `accent_color` | string | solar yellow; `primary` on a card added from the card picker | Curve color |
| `precipitation_color` | string | `#6ba7dc` | Precipitation bar color |
| `gradient_color` | string | same as `accent_color` | Gradient fill under the curve |
| `text_color` / `secondary_text_color` | string | theme default | Temperature/title vs. chips/secondary values |
| `card_background` | string | glass/solid background | Card background |
| `animation` | `auto` \| `on` \| `off` | `auto` | Curve draw-in animation; `auto`/`on` respect `prefers-reduced-motion` |
| `glass_background` | boolean | `true` | Frosted glass background |
| `radius` / `corners` | number / object | `28` | Corner radius, optional per corner |

Icons, temperatures and hours share one rhythm: the card measures its own
width, decides how many columns fit, and then draws every 2nd, 3rd or 4th
hour — never a crowded row. A regular rhythm and a strip that ends flush at
both edges only both hold when that step divides the row evenly, so the row
is cut back to where it does. Ask for twelve hours in a narrow card and
eleven are drawn; the curve, the rain bars and the sun markers are cut to
the same length so nothing drifts apart.

</details>
