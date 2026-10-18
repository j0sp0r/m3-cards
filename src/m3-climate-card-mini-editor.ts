import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  LovelaceCardEditor,
  M3ClimateCardMiniConfig,
  ModeColorOverrides,
} from "./types";
import {
  DEFAULT_MODE_COLORS,
  DEFAULT_MINI_RADIUS,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import {
  fireEvent,
  opacityRow,
  type SchemaEntry,
  type ColorOpacityOption,
} from "./shared/editor-helpers";
import {
  initAppearanceState,
  radiusPresetPatch,
  cornerPresetPatch,
  renderRadiusCornerFields,
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

@customElement("m3-climate-card-mini-editor")
export class M3ClimateCardMiniEditor
  extends LitElement
  implements LovelaceCardEditor
{
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3ClimateCardMiniConfig;
  @state() private _appearance: AppearanceState = { showCustomRadius: false, showCorners: false, cornerCustom: {} };

  public setConfig(config: M3ClimateCardMiniConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_MINI_RADIUS);
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
    return [
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "show_humidity", selector: { boolean: {} } },
      {
        name: "humidity_sensor",
        selector: { entity: { domain: "sensor", device_class: "humidity" } },
      },
    ];
  }

  private _appearanceSchema(): SchemaEntry[] {
    return [
      { name: "glass_background", selector: { boolean: {} } },
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
    ];
  }

  private _computeLabel = (schema: SchemaEntry): string => {
    const labelMap: Record<string, TranslationKey> = {
      entity: "editor_entity",
      name: "editor_name",
      icon: "editor_icon",
      show_humidity: "editor_mini_show_humidity",
      humidity_sensor: "editor_humidity_sensor",
      glass_background: "editor_glass_background",
      radius: "editor_radius",
      radius_preset: "editor_radius_preset",
      animation: "editor_progress_animation",
      unavailable_style: "editor_unavailable_style",
      use_corners: "editor_use_corners",
      top_left: "editor_corner_top_left",
      top_right: "editor_corner_top_right",
      bottom_right: "editor_corner_bottom_right",
      bottom_left: "editor_corner_bottom_left",
    };
    const key = labelMap[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _colorRow(
    label: string,
    value: string | undefined,
    onChange: (value: string) => void,
    opacity?: ColorOpacityOption,
  ) {
    const hexValue = /^#[0-9a-fA-F]{6}$/.test(value ?? "") ? (value as string) : "#888888";
    return html`
      <div class="color-row">
        <label class="color-label">${label}</label>
        <input
          type="text"
          class="color-text"
          .value=${value ?? ""}
          placeholder="z.B. red oder #6ba7dc"
          @input=${(e: Event) => onChange((e.target as HTMLInputElement).value)}
        />
        <input
          type="color"
          class="swatch"
          .value=${hexValue}
          @input=${(e: Event) => onChange((e.target as HTMLInputElement).value)}
        />
        ${opacity
          ? opacityRow(opacity.label, opacity.value, opacity.defaultValue, opacity.onChange)
          : nothing}
      </div>
    `;
  }

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
      | "power_active_color"
      | "power_inactive_color"
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
    field:
      | "icon_active_opacity"
      | "icon_inactive_opacity"
      | "power_active_opacity"
      | "power_inactive_opacity"
      | "plus_opacity"
      | "minus_opacity",
    value: number,
  ): void {
    if (!this._config) return;
    this._config = { ...this._config, [field]: value };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const newConfig = { ...this._config, ...ev.detail.value };
    this._config = newConfig;
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
      const { corners, ...rest } = this._config;
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

    const contentData = {
      name: this._config.name,
      icon: this._config.icon,
      show_humidity: this._config.show_humidity ?? false,
      humidity_sensor: this._config.humidity_sensor,
    };

    const appearanceData = {
      glass_background: this._config.glass_background ?? true,
      animation: this._config.animation ?? "auto",
      unavailable_style: this._config.unavailable_style ?? "dimmed",
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

        <ha-expansion-panel outlined .header=${this._t("editor_appearance")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${appearanceData}
              .schema=${this._appearanceSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            ${renderRadiusCornerFields({
              hass: this.hass,
              language: this._language,
              config: this._config,
              defaultRadius: DEFAULT_MINI_RADIUS,
              state: this._appearance,
              computeLabel: this._computeLabel,
              onValueChanged: this._valueChanged.bind(this),
              onRadiusPresetChanged: this._radiusPresetChanged.bind(this),
              onCornersToggleChanged: this._cornersToggleChanged.bind(this),
              onCornerPresetChanged: this._cornerPresetChanged.bind(this),
              onCornerValueChanged: this._cornerValueChanged.bind(this),
            })}
            <div class="hint">${this._t("editor_element_colors_helper")}</div>
            ${this._colorRow(
              this._t("editor_icon_active_color"),
              this._config?.icon_active_color,
              (v) => this._elementColorChanged("icon_active_color", v),
              {
                label: this._t("editor_opacity"),
                value: this._config?.icon_active_opacity,
                defaultValue: 22,
                onChange: (v) => this._opacityChanged("icon_active_opacity", v),
              },
            )}
            ${this._colorRow(
              this._t("editor_icon_inactive_color"),
              this._config?.icon_inactive_color,
              (v) => this._elementColorChanged("icon_inactive_color", v),
              {
                label: this._t("editor_opacity"),
                value: this._config?.icon_inactive_opacity,
                defaultValue: 14,
                onChange: (v) => this._opacityChanged("icon_inactive_opacity", v),
              },
            )}
            ${this._colorRow(
              this._t("editor_power_active_color"),
              this._config?.power_active_color,
              (v) => this._elementColorChanged("power_active_color", v),
              {
                label: this._t("editor_opacity"),
                value: this._config?.power_active_opacity,
                defaultValue: 30,
                onChange: (v) => this._opacityChanged("power_active_opacity", v),
              },
            )}
            ${this._colorRow(
              this._t("editor_power_inactive_color"),
              this._config?.power_inactive_color,
              (v) => this._elementColorChanged("power_inactive_color", v),
              {
                label: this._t("editor_opacity"),
                value: this._config?.power_inactive_opacity,
                defaultValue: 14,
                onChange: (v) => this._opacityChanged("power_inactive_opacity", v),
              },
            )}
            ${this._colorRow(
              this._t("editor_plus_active_color"),
              this._config?.plus_active_color,
              (v) => this._elementColorChanged("plus_active_color", v),
            )}
            ${this._colorRow(
              this._t("editor_plus_inactive_color"),
              this._config?.plus_inactive_color,
              (v) => this._elementColorChanged("plus_inactive_color", v),
            )}
            ${opacityRow(
              this._t("editor_plus_opacity"),
              this._config?.plus_opacity,
              20,
              (v) => this._opacityChanged("plus_opacity", v),
            )}
            ${this._colorRow(
              this._t("editor_minus_active_color"),
              this._config?.minus_active_color,
              (v) => this._elementColorChanged("minus_active_color", v),
            )}
            ${this._colorRow(
              this._t("editor_minus_inactive_color"),
              this._config?.minus_inactive_color,
              (v) => this._elementColorChanged("minus_inactive_color", v),
            )}
            ${opacityRow(
              this._t("editor_minus_opacity"),
              this._config?.minus_opacity,
              8,
              (v) => this._opacityChanged("minus_opacity", v),
            )}
            <div class="hint">${this._t("editor_color_helper")}</div>
            ${MODE_KEYS.map((mode) =>
              this._colorRow(
                `${this._t(mode as TranslationKey)} – ${this._t("editor_mode_color")}`,
                this._config?.mode_colors?.[mode] ?? DEFAULT_MODE_COLORS[mode],
                (v) => this._modeColorChanged(mode, v),
              ),
            )}
          </div>
        </ha-expansion-panel>
      </div>
    `;
  }

  static styles = css`
    .editor {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    ha-expansion-panel {
      border-radius: 12px;
      --expansion-panel-summary-padding: 0 8px;
      --ha-card-border-radius: 12px;
    }

    .panel-content {
      padding: 12px 16px 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    ha-form {
      display: block;
    }

    .hint {
      font-size: 12px;
      opacity: 0.6;
      color: var(--primary-text-color);
    }

    .color-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 8px;
    }

    .color-label {
      flex-basis: 100%;
      font-size: 13px;
      color: var(--secondary-text-color, var(--primary-text-color));
    }

    .color-text {
      flex: 1;
      min-width: 120px;
      height: 40px;
      box-sizing: border-box;
      padding: 0 12px;
      border-radius: 8px;
      border: 1px solid rgba(127, 127, 127, 0.4);
      background: transparent;
      color: var(--primary-text-color);
      font-size: 14px;
      font-family: inherit;
    }

    .swatch {
      flex-shrink: 0;
      width: 40px;
      height: 40px;
      border: none;
      border-radius: 8px;
      padding: 0;
      background: none;
      cursor: pointer;
    }

    .opacity-row {
      flex-basis: 100%;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .opacity-label {
      flex-shrink: 0;
      min-width: 90px;
      font-size: 12px;
      color: var(--secondary-text-color, var(--primary-text-color));
      opacity: 0.7;
    }

    .opacity-row input[type="range"] {
      flex: 1;
      accent-color: var(--primary-color);
    }

    .opacity-value {
      flex-shrink: 0;
      min-width: 32px;
      text-align: right;
      font-size: 12px;
      color: var(--secondary-text-color, var(--primary-text-color));
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-climate-card-mini-editor": M3ClimateCardMiniEditor;
  }
}
