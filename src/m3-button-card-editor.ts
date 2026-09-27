import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  LovelaceCardEditor,
  M3ButtonCardConfig,
  ChipButtonConfig,
} from "./types";
import {
  DEFAULT_BUTTON_RADIUS,
  EDITABLE_STATE_COLOR_KEYS,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import {
  fireEvent,
  colorRow,
  type SchemaEntry,
} from "./shared/editor-helpers";
import {
  initAppearanceState,
  radiusPresetPatch,
  cornerPresetPatch,
  renderRadiusCornerFields,
  type AppearanceState,
} from "./shared/appearance-editor";
import {
  chipButtonLabelMap,
  renderChipButtonsListEditor,
} from "./shared/chip-buttons-editor";

@customElement("m3-button-card-editor")
export class M3ButtonCardEditor
  extends LitElement
  implements LovelaceCardEditor<M3ButtonCardConfig>
{
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3ButtonCardConfig;
  @state() private _appearance: AppearanceState = { showCustomRadius: false, showCorners: false, cornerCustom: {} };

  public setConfig(config: M3ButtonCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_BUTTON_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _entitySchema(): SchemaEntry[] {
    return [{ name: "entity", selector: { entity: {} } }];
  }

  private _contentSchema(): SchemaEntry[] {
    return [
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "show_state", selector: { boolean: {} } },
      {
        name: "state_content",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "state", label: this._t("editor_state_content_state") },
              {
                value: "last_changed",
                label: this._t("editor_state_content_last_changed"),
              },
              {
                value: "last_updated",
                label: this._t("editor_state_content_last_updated"),
              },
            ],
          },
        },
      },
      { name: "show_icon_background", selector: { boolean: {} } },
      {
        name: "icon_size",
        selector: {
          number: { mode: "box", min: 16, step: 1, unit_of_measurement: "px" },
        },
      },
      { name: "align_icons", selector: { boolean: {} } },
      { name: "vertical", selector: { boolean: {} } },
      { name: "icon_off", selector: { icon: {} } },
      { name: "show_slider", selector: { boolean: {} } },
    ];
  }

  private _chipButtonsLayoutSchema(): SchemaEntry[] {
    return [
      {
        name: "chip_buttons_layout",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "wrap", label: this._t("editor_chip_buttons_layout_wrap") },
              { value: "scroll", label: this._t("editor_chip_buttons_layout_scroll") },
            ],
          },
        },
      },
      {
        name: "chip_buttons_justify",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "start", label: this._t("editor_chip_buttons_justify_start") },
              { value: "center", label: this._t("editor_chip_buttons_justify_center") },
              { value: "end", label: this._t("editor_chip_buttons_justify_end") },
            ],
          },
        },
      },
    ];
  }

  private _chipItemLabel(item: ChipButtonConfig, index: number): string {
    return (
      item.name ??
      (item.entity
        ? ((this.hass?.states[item.entity]?.attributes.friendly_name as string | undefined) ??
          item.entity)
        : `#${index + 1}`)
    );
  }

  private _interactionsSchema(): SchemaEntry[] {
    return [
      { name: "tap_action", selector: { ui_action: {} } },
      { name: "icon_tap_action", selector: { ui_action: {} } },
      { name: "hold_action", selector: { ui_action: {} } },
      { name: "icon_hold_action", selector: { ui_action: {} } },
      { name: "double_tap_action", selector: { ui_action: {} } },
      { name: "icon_double_tap_action", selector: { ui_action: {} } },
    ];
  }

  private _appearanceSchema(): SchemaEntry[] {
    return [
      // Both belong beside the colours rather than with the content: they are
      // about how the tile looks, and one of them decides which way round the
      // accent and the glyph are used.
      { name: "shape_by_state", selector: { boolean: {} } },
      {
        name: "icon_fill",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "tint", label: this._t("editor_icon_fill_tint") },
              { value: "solid", label: this._t("editor_icon_fill_solid") },
            ],
          },
        },
      },
      { name: "invert_colors", selector: { boolean: {} } },
      { name: "static_color", selector: { boolean: {} } },
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
    ];
  }

  /** The two options whose effect is not obvious from the name alone. */
  private _computeHelper = (schema: SchemaEntry): string | undefined => {
    if (schema.name === "shape_by_state") return this._t("editor_shape_by_state_helper");
    return undefined;
  };

  private _computeLabel = (schema: SchemaEntry): string => {
    const labelMap: Record<string, TranslationKey> = {
      ...chipButtonLabelMap,
      chip_buttons_justify: "editor_chip_buttons_justify",
      chip_buttons_layout: "editor_chip_buttons_layout",
      entity: "editor_entity",
      name: "editor_name",
      icon: "editor_icon",
      show_state: "editor_show_state",
      state_content: "editor_state_content",
      show_icon_background: "editor_show_icon_background",
      icon_size: "editor_icon_size",
      align_icons: "editor_align_icons",
      show_slider: "editor_show_slider",
      vertical: "editor_vertical",
      shape_by_state: "editor_shape_by_state",
      icon_off: "editor_icon_off",
      icon_fill: "editor_icon_fill",
      tap_action: "editor_tap_action",
      icon_tap_action: "editor_icon_tap_action",
      hold_action: "editor_hold_action",
      icon_hold_action: "editor_icon_hold_action",
      double_tap_action: "editor_double_tap_action",
      icon_double_tap_action: "editor_icon_double_tap_action",
      color: "editor_color",
      invert_colors: "editor_invert_colors",
      static_color: "editor_static_color",
      unavailable_style: "editor_unavailable_style",
      radius: "editor_radius",
      radius_preset: "editor_radius_preset",
      glass_background: "editor_glass_background",
      animation: "editor_progress_animation",
      use_corners: "editor_use_corners",
      top_left: "editor_corner_top_left",
      top_right: "editor_corner_top_right",
      bottom_right: "editor_corner_bottom_right",
      bottom_left: "editor_corner_bottom_left",
    };
    const key = labelMap[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _stateKeyLabel(key: string): string {
    const stateLabelMap: Record<string, TranslationKey> = {
      on: "editor_state_on",
      open: "editor_state_open",
      locked: "editor_state_locked",
      home: "editor_state_home",
      playing: "editor_state_playing",
      active: "editor_state_active",
      detected: "editor_state_detected",
      wet: "editor_state_wet",
    };
    const translationKey = stateLabelMap[key];
    return translationKey
      ? this._t(translationKey)
      : key.charAt(0).toUpperCase() + key.slice(1);
  }

  private _colorChanged(value: string): void {
    if (!this._config) return;
    this._config = { ...this._config, color: value || undefined };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _inactiveColorChanged(value: string): void {
    if (!this._config) return;
    this._config = { ...this._config, inactive_color: value || undefined };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _opacityChanged(
    field: "color_opacity" | "inactive_opacity",
    value: number,
  ): void {
    if (!this._config) return;
    this._config = { ...this._config, [field]: value };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _stateColorChanged(key: string, value: string): void {
    if (!this._config) return;
    const state_colors = { ...(this._config.state_colors ?? {}) };
    if (value) state_colors[key] = value;
    else delete state_colors[key];
    this._config = { ...this._config, state_colors };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    this._config = { ...this._config, ...ev.detail.value };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _chipButtonsChanged(chip_buttons: ChipButtonConfig[]): void {
    if (!this._config) return;
    this._config = { ...this._config, chip_buttons };
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
      show_state: this._config.show_state ?? true,
      state_content: this._config.state_content ?? "state",
      show_icon_background: this._config.show_icon_background ?? true,
      icon_size: this._config.icon_size,
      align_icons: this._config.align_icons ?? false,
      icon_off: this._config.icon_off,
      vertical: this._config.vertical ?? false,
      show_slider: this._config.show_slider ?? false,
    };

    const interactionsData = {
      tap_action: this._config.tap_action ?? { action: "more-info" },
      icon_tap_action: this._config.icon_tap_action ?? { action: "more-info" },
      hold_action: this._config.hold_action ?? { action: "more-info" },
      icon_hold_action: this._config.icon_hold_action ?? { action: "none" },
      double_tap_action: this._config.double_tap_action ?? { action: "none" },
      icon_double_tap_action:
        this._config.icon_double_tap_action ?? { action: "none" },
    };

    const appearanceData = {
      shape_by_state: this._config.shape_by_state ?? false,
      icon_fill: this._config.icon_fill ?? "tint",
      invert_colors: this._config.invert_colors ?? false,
      static_color: this._config.static_color ?? false,
      unavailable_style: this._config.unavailable_style ?? "dimmed",
      glass_background: this._config.glass_background ?? true,
      animation: this._config.animation ?? "auto",
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
        <div class="hint">${this._t("editor_entity_helper")}</div>

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
            <div class="hint">${this._t("editor_icon_size_helper")}</div>
            <div class="hint">${this._t("editor_align_icons_helper")}</div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_interactions")}>
          <ha-icon slot="leading-icon" icon="mdi:gesture-tap"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${interactionsData}
              .schema=${this._interactionsSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_button_chip_buttons")}>
          <ha-icon slot="leading-icon" icon="mdi:gesture-tap-button"></ha-icon>
          <div class="panel-content">
            ${renderChipButtonsListEditor({
              hass: this.hass,
              items: this._config.chip_buttons ?? [],
              onChange: (items) => this._chipButtonsChanged(items),
              computeLabel: this._computeLabel,
              addLabel: this._t("editor_chip_buttons_add"),
              removeLabel: this._t("editor_chip_buttons_remove"),
              moveUpLabel: this._t("editor_chip_buttons_move_up"),
              moveDownLabel: this._t("editor_chip_buttons_move_down"),
              itemLabel: (item, index) => this._chipItemLabel(item, index),
            })}
            <ha-form
              .hass=${this.hass}
              .data=${{
                chip_buttons_layout: this._config.chip_buttons_layout ?? "wrap",
                chip_buttons_justify: this._config.chip_buttons_justify ?? "end",
              }}
              .schema=${this._chipButtonsLayoutSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_button_chip_buttons_justify_helper")}</div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_appearance")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            ${colorRow(
              this._t("editor_color"),
              this._config.color,
              (v) => this._colorChanged(v),
              {
                label: this._t("editor_opacity"),
                value: this._config.color_opacity,
                defaultValue: 20,
                onChange: (v) => this._opacityChanged("color_opacity", v),
              },
            )}
            <div class="hint">${this._t("editor_color_helper")}</div>
            ${colorRow(
              this._t("editor_inactive_color"),
              this._config.inactive_color,
              (v) => this._inactiveColorChanged(v),
              {
                label: this._t("editor_opacity"),
                value: this._config.inactive_opacity,
                defaultValue: 8,
                onChange: (v) => this._opacityChanged("inactive_opacity", v),
              },
            )}
            <div class="hint">${this._t("editor_inactive_color_helper")}</div>
            <ha-form
              .hass=${this.hass}
              .data=${appearanceData}
              .schema=${this._appearanceSchema()}
              .computeLabel=${this._computeLabel}
              .computeHelper=${this._computeHelper}
              @value-changed=${this._valueChanged}
            ></ha-form>
            ${renderRadiusCornerFields({
              hass: this.hass,
              language: this._language,
              config: this._config,
              defaultRadius: DEFAULT_BUTTON_RADIUS,
              state: this._appearance,
              computeLabel: this._computeLabel,
              onValueChanged: this._valueChanged.bind(this),
              onRadiusPresetChanged: this._radiusPresetChanged.bind(this),
              onCornersToggleChanged: this._cornersToggleChanged.bind(this),
              onCornerPresetChanged: this._cornerPresetChanged.bind(this),
              onCornerValueChanged: this._cornerValueChanged.bind(this),
            })}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_state_colors")}>
          <ha-icon slot="leading-icon" icon="mdi:format-color-fill"></ha-icon>
          <div class="panel-content">
            <div class="hint">${this._t("editor_state_colors_helper")}</div>
            ${EDITABLE_STATE_COLOR_KEYS.map((key) =>
              colorRow(
                this._stateKeyLabel(key),
                this._config?.state_colors?.[key],
                (v) => this._stateColorChanged(key, v),
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

    .chip-buttons-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .chip-buttons-row-actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .chip-buttons-row-actions .remove {
      margin-left: auto;
      --mdc-theme-primary: var(--error-color, #e57368);
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
    "m3-button-card-editor": M3ButtonCardEditor;
  }
}
