import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, LovelaceCardEditor, M3LightCardConfig, LightSceneConfig } from "./types";
import { DEFAULT_LIGHT_RADIUS } from "./const";
import { localize, type TranslationKey } from "./localize";
import { fireEvent, colorRow, listRow, editorStyles, type SchemaEntry } from "./shared/editor-helpers";
import { radiusLabelMap } from "./shared/radius-editor";
import {
  initAppearanceState,
  radiusPresetPatch,
  cornerPresetPatch,
  renderAppearanceSection,
  type AppearanceState,
} from "./shared/appearance-editor";

@customElement("m3-light-card-editor")
export class M3LightCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3LightCardConfig;
  @state() private _appearance: AppearanceState = { showCustomRadius: false, showCorners: false, cornerCustom: {} };

  public setConfig(config: M3LightCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_LIGHT_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _entitySchema(): SchemaEntry[] {
    return [{ name: "entity", required: true, selector: { entity: { domain: "light" } } }];
  }

  private _contentSchema(): SchemaEntry[] {
    return [
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "transition", selector: { number: { min: 0, step: 0.1, mode: "box", unit_of_measurement: "s" } } },
      { name: "compact", selector: { boolean: {} } },
      { name: "use_light_color", selector: { boolean: {} } },
      { name: "shape_by_state", selector: { boolean: {} } },
      {
        name: "wave_style",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "wavy", label: this._t("editor_light_wave_style_wavy") },
              { value: "flat", label: this._t("editor_light_wave_style_flat") },
            ],
          },
        },
      },
    ];
  }

  private _colorTempToggleSchema(): SchemaEntry[] {
    return [{ name: "show_color_temp", selector: { boolean: {} } }];
  }

  private _colorTempSchema(): SchemaEntry[] {
    return [
      {
        name: "color_temp_style",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "presets", label: this._t("editor_light_color_temp_style_presets") },
              { value: "slider", label: this._t("editor_light_color_temp_style_slider") },
            ],
          },
        },
      },
      { name: "warm", selector: { number: { min: 1000, max: 10000, step: 50, mode: "box", unit_of_measurement: "K" } } },
      { name: "neutral", selector: { number: { min: 1000, max: 10000, step: 50, mode: "box", unit_of_measurement: "K" } } },
      { name: "cold", selector: { number: { min: 1000, max: 10000, step: 50, mode: "box", unit_of_measurement: "K" } } },
    ];
  }

  private _colorSchema(): SchemaEntry[] {
    return [{ name: "show_color_wheel", selector: { boolean: {} } }];
  }

  private _membersSchema(): SchemaEntry[] {
    return [{ name: "show_members", selector: { boolean: {} } }];
  }

  private _sceneSchema(): SchemaEntry[] {
    return [
      { name: "entity", selector: { entity: { domain: "scene" } } },
      { name: "service", selector: { text: {} } },
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
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
      shape_by_state: "editor_shape_by_state",
      entity: "editor_entity",
      name: "editor_name",
      icon: "editor_icon",
      transition: "editor_light_transition",
      use_light_color: "editor_light_use_light_color",
      wave_style: "editor_light_wave_style",
      show_color_temp: "editor_light_show_color_temp",
      color_temp_style: "editor_light_color_temp_style",
      warm: "editor_light_color_temp_warm",
      neutral: "editor_light_color_temp_neutral",
      cold: "editor_light_color_temp_cold",
      compact: "editor_light_compact",
      show_color_wheel: "editor_light_show_color_wheel",
      show_members: "editor_light_show_members",
      service: "editor_light_scene_service",
      animation: "editor_progress_animation",
      glass_background: "editor_glass_background",
      ...radiusLabelMap,
    };
    const key = labelMap[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _colorChanged(
    field: "accent_color" | "track_color" | "handle_color" | "text_color" | "secondary_text_color" | "card_background",
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

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    this._config = { ...this._config, ...ev.detail.value };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _colorTempPresetChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const { color_temp_style, ...presetValues } = ev.detail.value;
    this._config = {
      ...this._config,
      color_temp_style,
      color_temp_presets: { ...this._config.color_temp_presets, ...presetValues },
    };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _paletteChanged(values: string[]): void {
    if (!this._config) return;
    this._config = { ...this._config, color_palette: values };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _sceneChanged(index: number, ev: CustomEvent): void {
    if (!this._config) return;
    const scenes = [...(this._config.scenes ?? [])];
    const value = ev.detail.value as LightSceneConfig;
    scenes[index] = {
      ...scenes[index],
      entity: value.entity || undefined,
      service: value.service || undefined,
      name: value.name || undefined,
      icon: value.icon || undefined,
    };
    this._config = { ...this._config, scenes };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _sceneServiceDataChanged(index: number, raw: string): void {
    if (!this._config) return;
    const scenes = [...(this._config.scenes ?? [])];
    try {
      scenes[index] = { ...scenes[index], service_data: raw.trim() ? JSON.parse(raw) : undefined };
    } catch {
      return;
    }
    this._config = { ...this._config, scenes };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _addScene(): void {
    if (!this._config) return;
    const scenes = [...(this._config.scenes ?? []), {}];
    this._config = { ...this._config, scenes };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _removeScene(index: number): void {
    if (!this._config) return;
    const scenes = [...(this._config.scenes ?? [])];
    scenes.splice(index, 1);
    this._config = { ...this._config, scenes };
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

    const entityData = { entity: this._config.entity };
    const contentData = {
      name: this._config.name,
      icon: this._config.icon,
      transition: this._config.transition,
      compact: this._config.compact ?? false,
      use_light_color: this._config.use_light_color ?? true,
      shape_by_state: this._config.shape_by_state ?? false,
      wave_style: this._config.wave_style ?? "wavy",
    };
    const showColorTemp = this._config.show_color_temp !== false;
    const colorTempToggleData = { show_color_temp: showColorTemp };
    const colorTempData = {
      color_temp_style: this._config.color_temp_style ?? "presets",
      warm: this._config.color_temp_presets?.warm,
      neutral: this._config.color_temp_presets?.neutral,
      cold: this._config.color_temp_presets?.cold,
    };
    const colorData = { show_color_wheel: this._config.show_color_wheel ?? false };
    const membersData = { show_members: this._config.show_members ?? false };
    const animationData = { animation: this._config.animation ?? "auto" };
    const scenes = this._config.scenes ?? [];

    return html`
      <div class="editor">
        <ha-expansion-panel outlined .header=${this._t("editor_entities")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:lightbulb-outline"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${entityData}
              .schema=${this._entitySchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
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
            <div class="hint">${this._t("editor_light_use_light_color_helper")}</div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("light_color_temp_label")}>
          <ha-icon slot="leading-icon" icon="mdi:thermometer"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${colorTempToggleData}
              .schema=${this._colorTempToggleSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_light_show_color_temp_helper")}</div>
            ${showColorTemp
              ? html`
                  <ha-form
                    .hass=${this.hass}
                    .data=${colorTempData}
                    .schema=${this._colorTempSchema()}
                    .computeLabel=${this._computeLabel}
                    @value-changed=${this._colorTempPresetChanged}
                  ></ha-form>
                `
              : nothing}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("light_color_wheel_label")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-swatch-outline"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${colorData}
              .schema=${this._colorSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            ${listRow(
              this._t("editor_light_color_palette"),
              this._config.color_palette ?? [],
              (v) => this._paletteChanged(v),
            )}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_scenes")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            <div class="hint">${this._t("editor_light_scenes_helper")}</div>
            ${scenes.map(
              (scene, i) => html`
                <div class="scene-row">
                  <ha-form
                    .hass=${this.hass}
                    .data=${{ entity: scene.entity ?? "", service: scene.service ?? "", name: scene.name ?? "", icon: scene.icon ?? "" }}
                    .schema=${this._sceneSchema()}
                    .computeLabel=${this._computeLabel}
                    @value-changed=${(ev: CustomEvent) => this._sceneChanged(i, ev)}
                  ></ha-form>
                  <input
                    type="text"
                    class="color-text"
                    .value=${scene.service_data ? JSON.stringify(scene.service_data) : ""}
                    placeholder=${this._t("editor_light_scene_service_data")}
                    @change=${(e: Event) => this._sceneServiceDataChanged(i, (e.target as HTMLInputElement).value)}
                  />
                  <button class="remove-btn" @click=${() => this._removeScene(i)}>
                    <ha-icon icon="mdi:close"></ha-icon>
                  </button>
                </div>
              `,
            )}
            <button class="add-btn" @click=${() => this._addScene()}>
              <ha-icon icon="mdi:plus"></ha-icon>
              ${this._t("editor_light_add_scene")}
            </button>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_light_show_members")}>
          <ha-icon slot="leading-icon" icon="mdi:lightbulb-group-outline"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${membersData}
              .schema=${this._membersSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_light_show_members_helper")}</div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_colors")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            ${colorRow(
              this._t("editor_light_accent_color"),
              this._config.accent_color,
              (v) => this._colorChanged("accent_color", v),
              {
                label: this._t("editor_opacity"),
                value: this._config.accent_opacity,
                defaultValue: 20,
                onChange: (v) => this._opacityChanged("accent_opacity", v),
              },
            )}
            ${colorRow(this._t("editor_light_track_color"), this._config.track_color, (v) => this._colorChanged("track_color", v))}
            ${colorRow(this._t("editor_light_handle_color"), this._config.handle_color, (v) => this._colorChanged("handle_color", v))}
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
          defaultRadius: DEFAULT_LIGHT_RADIUS,
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

  static styles = [
    editorStyles,
    css`
      .scene-row {
        display: flex;
        align-items: flex-start;
        gap: 8px;
      }

      .scene-row ha-form {
        flex: 1;
        min-width: 0;
      }

      .remove-btn {
        flex-shrink: 0;
        width: 40px;
        height: 40px;
        border: none;
        border-radius: 8px;
        background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
        color: var(--primary-text-color);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .add-btn {
        width: 100%;
        height: 40px;
        border: none;
        border-radius: 8px;
        background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
        color: var(--primary-text-color);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-size: 14px;
        font-family: inherit;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-light-card-editor": M3LightCardEditor;
  }
}
