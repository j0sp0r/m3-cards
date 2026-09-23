import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  LovelaceCardEditor,
  M3ClimateCardConfig,
  ModeColorOverrides,
} from "./types";
import {
  DEFAULT_MODE_COLORS,
  DEFAULT_BATTERY_THRESHOLD,
  DEFAULT_CLIMATE_RADIUS,
  CLIMATE_RADIUS_PRESETS,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import { fireEvent, colorRow, opacityRow, editorStyles, type SchemaEntry } from "./shared/editor-helpers";
import { radiusLabelMap } from "./shared/radius-editor";
import {
  initAppearanceState,
  radiusPresetPatch,
  cornerPresetPatch,
  renderAppearanceSection,
  type AppearanceState,
} from "./shared/appearance-editor";

const MODE_KEYS: (keyof ModeColorOverrides)[] = [
  "off",
  "heat",
  "cool",
  "dry",
  "auto",
  "fan_only",
  "heat_cool",
];

@customElement("m3-climate-card-editor")
export class M3ClimateCardEditor
  extends LitElement
  implements LovelaceCardEditor
{
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3ClimateCardConfig;
  @state() private _appearance: AppearanceState = { showCustomRadius: false, showCorners: false, cornerCustom: {} };

  public setConfig(config: M3ClimateCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_CLIMATE_RADIUS, CLIMATE_RADIUS_PRESETS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _entitySchema(): SchemaEntry[] {
    return [
      {
        name: "entity",
        required: true,
        selector: { entity: { domain: "climate" } },
      },
    ];
  }

  private _contentSchema(): SchemaEntry[] {
    const expressive = (this._config?.style ?? "tiles") === "expressive";
    return [
      {
        name: "style",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "tiles", label: this._t("editor_climate_style_tiles") },
              { value: "expressive", label: this._t("editor_climate_style_expressive") },
            ],
          },
        },
      },
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "show_header_status", selector: { boolean: {} } },
      ...(expressive
        ? ([
            { name: "show_control_labels", selector: { boolean: {} } },
            { name: "show_action_glow", selector: { boolean: {} } },
          ] as SchemaEntry[])
        : []),
      { name: "show_presets", selector: { boolean: {} } },
      {
        name: "preset_style",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "chip", label: this._t("editor_preset_style_chip") },
              { value: "pill", label: this._t("editor_preset_style_pill") },
            ],
          },
        },
      },
      { name: "show_sensors", selector: { boolean: {} } },
      {
        name: "hidden_modes",
        selector: {
          select: {
            mode: "list",
            multiple: true,
            options: this._availableHvacModes().map((mode) => ({
              value: mode,
              label: this._t(mode as TranslationKey),
            })),
          },
        },
      },
    ];
  }

  private _availableHvacModes(): string[] {
    const entity = this._config?.entity
      ? this.hass?.states[this._config.entity]
      : undefined;
    const modes: string[] = Array.isArray(entity?.attributes.hvac_modes)
      ? entity!.attributes.hvac_modes
      : [];
    return modes.filter((m) => m !== "off");
  }

  private _sensorsSchema(): SchemaEntry[] {
    return [
      {
        name: "temperature_sensor",
        selector: { entity: { domain: "sensor", device_class: "temperature" } },
      },
      {
        name: "humidity_sensor",
        selector: { entity: { domain: "sensor", device_class: "humidity" } },
      },
      {
        name: "window_sensor",
        selector: { entity: { domain: "binary_sensor" } },
      },
      {
        name: "battery_sensor",
        selector: { entity: { domain: "sensor", device_class: "battery" } },
      },
      {
        name: "battery_threshold",
        selector: {
          number: { mode: "box", min: 0, max: 100, step: 1, unit_of_measurement: "%" },
        },
      },
      {
        name: "temperature_chip_placement",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              {
                value: "info_row",
                label: this._t("editor_temp_placement_info_row"),
              },
              {
                value: "header",
                label: this._t("editor_temp_placement_header"),
              },
            ],
          },
        },
      },
    ];
  }

  private _behaviorSchema(): SchemaEntry[] {
    return [
      { name: "animations", selector: { boolean: {} } },
      {
        name: "unavailable_style",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              {
                value: "dimmed",
                label: this._t("editor_unavailable_style_dimmed"),
              },
              {
                value: "normal",
                label: this._t("editor_unavailable_style_normal"),
              },
              {
                value: "hidden",
                label: this._t("editor_unavailable_style_hidden"),
              },
            ],
          },
        },
      },
      {
        name: "height",
        selector: {
          number: { mode: "box", min: 0, step: 1, unit_of_measurement: "px" },
        },
      },
    ];
  }

  private _computeLabel = (schema: SchemaEntry): string => {
    const labelMap: Record<string, TranslationKey> = {
      entity: "editor_entity",
      name: "editor_name",
      icon: "editor_icon",
      style: "editor_climate_style",
      show_header_status: "editor_show_header_status",
      show_control_labels: "editor_show_control_labels",
      show_action_glow: "editor_show_action_glow",
      show_presets: "editor_show_presets",
      show_sensors: "editor_show_sensors",
      temperature_sensor: "editor_temperature_sensor",
      humidity_sensor: "editor_humidity_sensor",
      window_sensor: "editor_window_sensor",
      battery_sensor: "editor_battery_sensor",
      battery_threshold: "editor_battery_threshold",
      glass_background: "editor_glass_background",
      preset_style: "editor_preset_style",
      hidden_modes: "editor_hidden_modes",
      temperature_chip_placement: "editor_temperature_chip_placement",
      height: "editor_height",
      animations: "editor_animations",
      unavailable_style: "editor_unavailable_style",
      ...radiusLabelMap,
    };
    const key = labelMap[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _modeColorChanged(mode: keyof ModeColorOverrides, value: string): void {
    if (!this._config) return;
    const mode_colors = { ...(this._config.mode_colors ?? {}) };
    if (value) mode_colors[mode] = value;
    else delete mode_colors[mode];
    this._config = { ...this._config, mode_colors };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _elementColorChanged(
    field:
      | "icon_active_color"
      | "icon_inactive_color"
      | "plus_active_color"
      | "plus_inactive_color"
      | "minus_active_color"
      | "minus_inactive_color",
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

  private _opacityChanged(
    field: "icon_opacity" | "plus_opacity" | "minus_opacity",
    value: number,
  ): void {
    if (!this._config) return;
    this._config = { ...this._config, [field]: value };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    this._config = { ...this._config, ...ev.detail.value };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _radiusPresetChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const patch = radiusPresetPatch(ev.detail.value.radius_preset as string, CLIMATE_RADIUS_PRESETS);
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
      const { corners, ...rest } = this._config;
      this._config = rest;
      fireEvent(this, "config-changed", { config: this._config });
    }
  }

  private _cornerPresetChanged(key: string, ev: CustomEvent): void {
    if (!this._config) return;
    const patch = cornerPresetPatch(ev.detail.value[key] as string, CLIMATE_RADIUS_PRESETS);
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
    this._config = {
      ...this._config,
      corners: { ...(this._config.corners ?? {}), [key]: px },
    };
    fireEvent(this, "config-changed", { config: this._config });
  }

  protected render() {
    if (!this.hass || !this._config) return nothing;

    const contentData = {
      style: this._config.style ?? "tiles",
      name: this._config.name,
      icon: this._config.icon,
      show_header_status: this._config.show_header_status ?? true,
      show_control_labels: this._config.show_control_labels ?? true,
      show_action_glow: this._config.show_action_glow ?? true,
      show_presets: this._config.show_presets ?? true,
      preset_style: this._config.preset_style ?? "chip",
      show_sensors: this._config.show_sensors ?? true,
      hidden_modes: this._config.hidden_modes ?? [],
    };

    const sensorsData = {
      temperature_sensor: this._config.temperature_sensor,
      humidity_sensor: this._config.humidity_sensor,
      window_sensor: this._config.window_sensor,
      battery_sensor: this._config.battery_sensor,
      battery_threshold:
        this._config.battery_threshold ?? DEFAULT_BATTERY_THRESHOLD,
      temperature_chip_placement:
        this._config.temperature_chip_placement ?? "info_row",
    };

    const behaviorData = {
      animations: this._config.animations ?? true,
      unavailable_style: this._config.unavailable_style ?? "dimmed",
      height: this._config.height,
    };

    return html`
      <div class="editor">
        <ha-form
          .hass=${this.hass}
          .data=${{ entity: this._config.entity }}
          .schema=${this._entitySchema()}
          .computeLabel=${this._computeLabel}
          @value-changed=${this._valueChanged}
        ></ha-form>

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
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_sensors")}>
          <ha-icon slot="leading-icon" icon="mdi:thermometer"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${sensorsData}
              .schema=${this._sensorsSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_colors")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            <div class="hint">${this._t("editor_element_colors_helper")}</div>
            ${colorRow(
              this._t("editor_icon_active_color"),
              this._config?.icon_active_color,
              (v) => this._elementColorChanged("icon_active_color", v),
            )}
            ${colorRow(
              this._t("editor_icon_inactive_color"),
              this._config?.icon_inactive_color,
              (v) => this._elementColorChanged("icon_inactive_color", v),
            )}
            ${opacityRow(
              this._t("editor_climate_icon_tint_opacity"),
              this._config?.icon_opacity,
              18,
              (v) => this._opacityChanged("icon_opacity", v),
            )}
            ${colorRow(
              this._t("editor_plus_active_color"),
              this._config?.plus_active_color,
              (v) => this._elementColorChanged("plus_active_color", v),
            )}
            ${colorRow(
              this._t("editor_plus_inactive_color"),
              this._config?.plus_inactive_color,
              (v) => this._elementColorChanged("plus_inactive_color", v),
            )}
            ${opacityRow(
              this._t("editor_climate_plus_tint_opacity"),
              this._config?.plus_opacity,
              20,
              (v) => this._opacityChanged("plus_opacity", v),
            )}
            ${colorRow(
              this._t("editor_minus_active_color"),
              this._config?.minus_active_color,
              (v) => this._elementColorChanged("minus_active_color", v),
            )}
            ${colorRow(
              this._t("editor_minus_inactive_color"),
              this._config?.minus_inactive_color,
              (v) => this._elementColorChanged("minus_inactive_color", v),
            )}
            ${opacityRow(
              this._t("editor_climate_minus_tint_opacity"),
              this._config?.minus_opacity,
              8,
              (v) => this._opacityChanged("minus_opacity", v),
            )}
            <div class="hint">${this._t("editor_color_helper")}</div>
            ${MODE_KEYS.map((mode) =>
              colorRow(
                `${this._t(mode as TranslationKey)} – ${this._t("editor_mode_color")}`,
                this._config?.mode_colors?.[mode] ?? DEFAULT_MODE_COLORS[mode],
                (v) => this._modeColorChanged(mode, v),
              ),
            )}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_behavior")}>
          <ha-icon slot="leading-icon" icon="mdi:tune"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${behaviorData}
              .schema=${this._behaviorSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        ${renderAppearanceSection({
          hass: this.hass,
          language: this._language,
          config: this._config,
          defaultRadius: DEFAULT_CLIMATE_RADIUS,
          presets: CLIMATE_RADIUS_PRESETS,
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

  static styles = editorStyles;
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-climate-card-editor": M3ClimateCardEditor;
  }
}
