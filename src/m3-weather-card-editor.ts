import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, LovelaceCardEditor, M3WeatherCardConfig, WeatherChipType } from "./types";
import { DEFAULT_WEATHER_RADIUS } from "./const";
import { localize, type TranslationKey } from "./localize";
import { fireEvent, colorRow, editorStyles, type SchemaEntry } from "./shared/editor-helpers";
import { radiusLabelMap } from "./shared/radius-editor";
import {
  initAppearanceState,
  radiusPresetPatch,
  cornerPresetPatch,
  renderAppearanceSection,
  type AppearanceState,
} from "./shared/appearance-editor";

const CHIP_ATTR: Record<WeatherChipType, string> = {
  apparent_temperature: "apparent_temperature",
  wind_speed: "wind_speed",
  humidity: "humidity",
  pressure: "pressure",
  uv_index: "uv_index",
  visibility: "visibility",
};

@customElement("m3-weather-card-editor")
export class M3WeatherCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3WeatherCardConfig;
  @state() private _appearance: AppearanceState = { showCustomRadius: false, showCorners: false, cornerCustom: {} };

  public setConfig(config: M3WeatherCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_WEATHER_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _entitySchema(): SchemaEntry[] {
    return [{ name: "entity", required: true, selector: { entity: { domain: "weather" } } }];
  }

  private get _hasWeatherEntity(): boolean {
    if (!this.hass) return true;
    return Object.keys(this.hass.states).some((id) => id.startsWith("weather."));
  }

  private _chipHasData(type: WeatherChipType): boolean {
    const entity = this._config?.entity ? this.hass?.states[this._config.entity] : undefined;
    if (!entity) return true;
    const value = entity.attributes[CHIP_ATTR[type]];
    return value !== undefined && value !== null;
  }

  private _chipLabel(type: WeatherChipType, key: TranslationKey): string {
    const label = this._t(key);
    return this._chipHasData(type) ? label : `${label} (${this._t("editor_weather_chip_no_data")})`;
  }

  private _contentSchema(): SchemaEntry[] {
    return [
      { name: "name", selector: { text: {} } },
      { name: "show_current", selector: { boolean: {} } },
      { name: "hours", selector: { number: { min: 0, max: 24, step: 1, mode: "box" } } },
      { name: "show_chart", selector: { boolean: {} } },
      { name: "show_hour_labels", selector: { boolean: {} } },
      { name: "show_hourly_icons", selector: { boolean: {} } },
      { name: "show_hourly_temperatures", selector: { boolean: {} } },
      { name: "show_temp_axis", selector: { boolean: {} } },
      { name: "days", selector: { number: { min: 0, max: 14, step: 1, mode: "box" } } },
      { name: "show_days_toggle", selector: { boolean: {} } },
      {
        name: "chips",
        selector: {
          select: {
            multiple: true,
            mode: "list",
            options: [
              { value: "apparent_temperature", label: this._chipLabel("apparent_temperature", "chip_apparent_temperature") },
              { value: "wind_speed", label: this._chipLabel("wind_speed", "chip_wind_speed") },
              { value: "humidity", label: this._chipLabel("humidity", "chip_humidity") },
              { value: "pressure", label: this._chipLabel("pressure", "chip_pressure") },
              { value: "uv_index", label: this._chipLabel("uv_index", "chip_uv_index") },
              { value: "visibility", label: this._chipLabel("visibility", "chip_visibility") },
            ],
          },
        },
      },
      { name: "show_sun", selector: { boolean: {} } },
    ];
  }

  private _animationSchema(): SchemaEntry[] {
    return [
      {
        name: "animation",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "auto", label: this._t("editor_progress_animation_auto") },
              { value: "on", label: this._t("editor_progress_animation_on") },
              { value: "off", label: this._t("editor_progress_animation_off") },
            ],
          },
        },
      },
    ];
  }

  private _computeLabel = (schema: SchemaEntry): string => {
    const labelMap: Record<string, TranslationKey> = {
      entity: "editor_entity",
      name: "editor_name",
      show_current: "editor_weather_show_current",
      hours: "editor_weather_hours",
      show_chart: "editor_weather_show_chart",
      show_hour_labels: "editor_weather_show_hour_labels",
      show_hourly_icons: "editor_weather_show_hourly_icons",
      show_hourly_temperatures: "editor_weather_show_hourly_temperatures",
      show_temp_axis: "editor_weather_show_temp_axis",
      days: "editor_weather_days",
      show_days_toggle: "editor_weather_show_days_toggle",
      chips: "editor_weather_chips",
      show_sun: "editor_weather_show_sun",
      animation: "editor_progress_animation",
      glass_background: "editor_glass_background",
      ...radiusLabelMap,
    };
    const key = labelMap[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _entityChanged(ev: CustomEvent): void {
    if (!this._config) return;
    this._config = { ...this._config, ...ev.detail.value };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    this._config = { ...this._config, ...ev.detail.value };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _colorChanged(
    field: "accent_color" | "precipitation_color" | "gradient_color" | "text_color" | "secondary_text_color" | "card_background",
    value: string,
  ): void {
    if (!this._config) return;
    if (value) {
      this._config = { ...this._config, [field]: value };
    } else {
      const { [field]: _removed, ...rest } = this._config;
      this._config = rest;
    }
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _opacityChanged(field: "accent_opacity", value: number): void {
    if (!this._config) return;
    this._config = { ...this._config, [field]: value };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _radiusPresetChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const patch = radiusPresetPatch(ev.detail.value.radius_preset as string);
    this._appearance = { ...this._appearance, showCustomRadius: patch.showCustomRadius };
    if (patch.radius !== undefined) {
      this._config = { ...this._config, radius: patch.radius };
      fireEvent(this, "config-changed", { config: this._config });
    }
  }

  private _cornersToggleChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const showCorners = ev.detail.value.use_corners as boolean;
    this._appearance = { ...this._appearance, showCorners };
    if (!showCorners) {
      const { corners: _corners, ...rest } = this._config;
      this._config = rest;
      fireEvent(this, "config-changed", { config: this._config });
    }
  }

  private _cornerPresetChanged(key: string, ev: CustomEvent): void {
    if (!this._config) return;
    const patch = cornerPresetPatch(ev.detail.value[key] as string);
    this._appearance = {
      ...this._appearance,
      cornerCustom: { ...this._appearance.cornerCustom, [key]: patch.custom },
    };
    if (patch.px !== undefined) {
      this._config = { ...this._config, corners: { ...(this._config.corners ?? {}), [key]: patch.px } };
      fireEvent(this, "config-changed", { config: this._config });
    }
  }

  private _cornerValueChanged(key: string, ev: CustomEvent): void {
    if (!this._config) return;
    const px = ev.detail.value[key] as number;
    this._config = { ...this._config, corners: { ...(this._config.corners ?? {}), [key]: px } };
    fireEvent(this, "config-changed", { config: this._config });
  }

  protected render() {
    if (!this.hass || !this._config) return nothing;

    const entityData = { entity: this._config.entity };
    const contentData = {
      name: this._config.name,
      show_current: this._config.show_current ?? true,
      hours: this._config.hours,
      show_chart: this._config.show_chart ?? true,
      show_hour_labels: this._config.show_hour_labels ?? true,
      show_hourly_icons: this._config.show_hourly_icons ?? true,
      show_hourly_temperatures: this._config.show_hourly_temperatures ?? true,
      show_temp_axis: this._config.show_temp_axis ?? false,
      days: this._config.days,
      show_days_toggle: this._config.show_days_toggle ?? true,
      chips: this._config.chips ?? [],
      show_sun: this._config.show_sun ?? true,
    };
    const animationData = { animation: this._config.animation ?? "auto" };

    return html`
      <div class="editor">
        <ha-expansion-panel outlined .header=${this._t("editor_entities")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:weather-partly-cloudy"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${entityData}
              .schema=${this._entitySchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._entityChanged}
            ></ha-form>
            ${!this._hasWeatherEntity ? html`<div class="hint">${this._t("editor_weather_no_entity_hint")}</div>` : nothing}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_content")}>
          <ha-icon slot="leading-icon" icon="mdi:text-short"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${contentData}
              .schema=${this._contentSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_weather_days_helper")}</div>
            <div class="hint">${this._t("editor_weather_chips_helper")}</div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_colors")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            ${colorRow(
              this._t("editor_weather_accent_color"),
              this._config.accent_color,
              (v) => this._colorChanged("accent_color", v),
              {
                label: this._t("editor_opacity"),
                value: this._config.accent_opacity,
                defaultValue: 18,
                onChange: (v) => this._opacityChanged("accent_opacity", v),
              },
            )}
            ${colorRow(this._t("editor_weather_precipitation_color"), this._config.precipitation_color, (v) => this._colorChanged("precipitation_color", v))}
            ${colorRow(this._t("editor_weather_gradient_color"), this._config.gradient_color, (v) => this._colorChanged("gradient_color", v))}
            ${colorRow(this._t("editor_progress_text_color"), this._config.text_color, (v) => this._colorChanged("text_color", v))}
            ${colorRow(this._t("editor_progress_secondary_text_color"), this._config.secondary_text_color, (v) => this._colorChanged("secondary_text_color", v))}
            ${colorRow(this._t("editor_progress_card_background"), this._config.card_background, (v) => this._colorChanged("card_background", v))}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_animation")}>
          <ha-icon slot="leading-icon" icon="mdi:wave"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${animationData}
              .schema=${this._animationSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_progress_animation_reduced_motion_hint")}</div>
          </div>
        </ha-expansion-panel>

        ${renderAppearanceSection({
          hass: this.hass,
          language: this._language,
          config: this._config,
          defaultRadius: DEFAULT_WEATHER_RADIUS,
          state: this._appearance,
          computeLabel: this._computeLabel,
          onValueChanged: this._valueChanged.bind(this),
          onRadiusPresetChanged: this._radiusPresetChanged.bind(this),
          onCornersToggleChanged: this._cornersToggleChanged.bind(this),
          onCornerPresetChanged: this._cornerPresetChanged.bind(this),
          onCornerValueChanged: this._cornerValueChanged.bind(this),
        })}
      </div>
    `;
  }

  static styles = [editorStyles];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-weather-card-editor": M3WeatherCardEditor;
  }
}
