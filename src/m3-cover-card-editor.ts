import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  LovelaceCardEditor,
  M3CoverCardConfig,
  CoverEntityConfig,
} from "./types";
import { DEFAULT_COVER_RADIUS } from "./const";
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

@customElement("m3-cover-card-editor")
export class M3CoverCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3CoverCardConfig;
  @state() private _appearance: AppearanceState = {
    showCustomRadius: false,
    showCorners: false,
    cornerCustom: {},
  };

  public setConfig(config: M3CoverCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_COVER_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }
  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _emit(config: M3CoverCardConfig): void {
    this._config = config;
    fireEvent(this, "config-changed", { config });
  }

  private get _entities(): CoverEntityConfig[] {
    return (this._config?.entities ?? []).map((e) =>
      typeof e === "string" ? { entity: e } : e,
    );
  }

  // ---- schemas -------------------------------------------------------------

  private _modeSchema(): SchemaEntry[] {
    return [
      {
        name: "mode",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "single", label: this._t("editor_cover_mode_single") },
              { value: "group", label: this._t("editor_cover_mode_group") },
            ],
          },
        },
      },
    ];
  }

  private _singleEntitySchema(): SchemaEntry[] {
    const schema: SchemaEntry[] = [
      {
        name: "entity_type",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "cover", label: this._t("editor_cover_type_cover") },
              { value: "switch_pair", label: this._t("editor_cover_type_switch") },
            ],
          },
        },
      },
    ];
    if (this._config?.entity_type === "switch_pair") {
      schema.push(
        { name: "up_entity", selector: { entity: { domain: ["switch", "input_boolean"] } } },
        { name: "down_entity", selector: { entity: { domain: ["switch", "input_boolean"] } } },
        { name: "stop_entity", selector: { entity: { domain: ["switch", "input_boolean"] } } },
      );
    } else {
      schema.push({ name: "entity", required: true, selector: { entity: { domain: "cover" } } });
    }
    return schema;
  }

  private _entityRowSchema(entry: CoverEntityConfig): SchemaEntry[] {
    const schema: SchemaEntry[] = [
      {
        name: "entity_type",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "cover", label: this._t("editor_cover_type_cover") },
              { value: "switch_pair", label: this._t("editor_cover_type_switch") },
            ],
          },
        },
      },
    ];
    if (entry.entity_type === "switch_pair") {
      schema.push(
        { name: "up_entity", selector: { entity: { domain: ["switch", "input_boolean"] } } },
        { name: "down_entity", selector: { entity: { domain: ["switch", "input_boolean"] } } },
        { name: "stop_entity", selector: { entity: { domain: ["switch", "input_boolean"] } } },
      );
    } else {
      schema.push({ name: "entity", required: true, selector: { entity: { domain: "cover" } } });
    }
    schema.push({ name: "name", selector: { text: {} } }, { name: "icon", selector: { icon: {} } });
    return schema;
  }

  private _displaySchema(): SchemaEntry[] {
    const schema: SchemaEntry[] = [
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
    ];
    if (this._config?.mode !== "group") {
      schema.push(
        { name: "show_preview", selector: { boolean: {} } },
        {
          name: "slider_style",
          selector: {
            select: {
              mode: "dropdown",
              options: [
                { value: "plain", label: this._t("editor_cover_slider_plain") },
                { value: "wavy", label: this._t("editor_cover_slider_wavy") },
              ],
            },
          },
        },
      );
    } else {
      schema.push(
        { name: "show_master", selector: { boolean: {} } },
        {
          name: "row_tap_action",
          selector: {
            select: {
              mode: "dropdown",
              options: [
                { value: "more-info", label: this._t("editor_cover_tap_moreinfo") },
                { value: "toggle", label: this._t("editor_cover_tap_toggle") },
              ],
            },
          },
        },
      );
    }
    return schema;
  }

  private _behaviorSchema(): SchemaEntry[] {
    return [
      { name: "invert_position", selector: { boolean: {} } },
      { name: "shape_by_state", selector: { boolean: {} } },
      { name: "tilt_step", selector: { number: { min: 1, max: 90, mode: "box" } } },
      { name: "travel_time", selector: { number: { min: 0, max: 300, mode: "box", unit_of_measurement: "s" } } },
    ];
  }

  private _computeLabel = (schema: SchemaEntry): string => {
    const map: Record<string, TranslationKey> = {
      shape_by_state: "editor_shape_by_state",
      mode: "editor_cover_mode",
      entity_type: "editor_cover_entity_type",
      entity: "editor_entity",
      up_entity: "editor_cover_up_entity",
      down_entity: "editor_cover_down_entity",
      stop_entity: "editor_cover_stop_entity",
      name: "editor_name",
      icon: "editor_icon",
      show_preview: "editor_cover_show_preview",
      slider_style: "editor_cover_slider_style",
      show_master: "editor_cover_show_master",
      row_tap_action: "editor_cover_row_tap",
      invert_position: "editor_cover_invert",
      tilt_step: "editor_cover_tilt_step",
      travel_time: "editor_cover_travel_time",
      animation: "editor_progress_animation",
      glass_background: "editor_glass_background",
      ...radiusLabelMap,
    };
    const key = map[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    this._emit({ ...this._config, ...(ev.detail.value as Record<string, unknown>) } as M3CoverCardConfig);
  }

  // ---- group entity list ---------------------------------------------------

  private _entityChanged(index: number, ev: CustomEvent): void {
    if (!this._config) return;
    const entities = [...this._entities];
    const value = ev.detail.value as CoverEntityConfig;
    const isSwitch = value.entity_type === "switch_pair";
    entities[index] = {
      ...(value.entity_type ? { entity_type: value.entity_type } : {}),
      ...(isSwitch
        ? {
            ...(value.up_entity ? { up_entity: value.up_entity } : {}),
            ...(value.down_entity ? { down_entity: value.down_entity } : {}),
            ...(value.stop_entity ? { stop_entity: value.stop_entity } : {}),
          }
        : { entity: value.entity }),
      ...(value.name ? { name: value.name } : {}),
      ...(value.icon ? { icon: value.icon } : {}),
    };
    this._emit({ ...this._config, entities });
  }

  private _addEntity(): void {
    if (!this._config) return;
    this._emit({ ...this._config, entities: [...this._entities, { entity: "" }] });
  }

  private _removeEntity(index: number): void {
    if (!this._config) return;
    this._emit({ ...this._config, entities: this._entities.filter((_, i) => i !== index) });
  }

  private _colorChanged(field: "accent_color" | "text_color" | "secondary_text_color" | "card_background", value: string): void {
    if (!this._config) return;
    if (value) this._emit({ ...this._config, [field]: value });
    else {
      const { [field]: _removed, ...rest } = this._config;
      this._emit(rest as M3CoverCardConfig);
    }
  }

  private _radiusPresetChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const patch = radiusPresetPatch(ev.detail.value.radius_preset as string);
    this._appearance = { ...this._appearance, showCustomRadius: patch.showCustomRadius };
    if (patch.radius !== undefined) this._emit({ ...this._config, radius: patch.radius });
  }
  private _cornersToggleChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const showCorners = ev.detail.value.use_corners as boolean;
    this._appearance = { ...this._appearance, showCorners };
    if (!showCorners) {
      const { corners: _removed, ...rest } = this._config;
      this._emit(rest as M3CoverCardConfig);
    }
  }
  private _cornerPresetChanged(key: string, ev: CustomEvent): void {
    if (!this._config) return;
    const patch = cornerPresetPatch(ev.detail.value[key] as string);
    this._appearance = { ...this._appearance, cornerCustom: { ...this._appearance.cornerCustom, [key]: patch.custom } };
    if (patch.px !== undefined) this._emit({ ...this._config, corners: { ...(this._config.corners ?? {}), [key]: patch.px } });
  }
  private _cornerValueChanged(key: string, ev: CustomEvent): void {
    if (!this._config) return;
    const px = ev.detail.value[key] as number;
    this._emit({ ...this._config, corners: { ...(this._config.corners ?? {}), [key]: px } });
  }

  protected render() {
    if (!this.hass || !this._config) return nothing;
    const mode = this._config.mode ?? "single";
    const modeData = { mode };
    const singleData = {
      entity_type: this._config.entity_type ?? "cover",
      entity: this._config.entity,
      up_entity: this._config.up_entity,
      down_entity: this._config.down_entity,
      stop_entity: this._config.stop_entity,
    };
    const displayData = {
      name: this._config.name,
      icon: this._config.icon,
      show_preview: this._config.show_preview ?? true,
      slider_style: this._config.slider_style ?? "plain",
      show_master: this._config.show_master ?? true,
      row_tap_action: this._config.row_tap_action ?? "more-info",
    };
    const behaviorData = {
      invert_position: this._config.invert_position ?? false,
      shape_by_state: this._config.shape_by_state ?? false,
      tilt_step: this._config.tilt_step ?? 15,
      travel_time: this._config.travel_time ?? 0,
    };

    return html`
      <div class="editor">
        <ha-expansion-panel outlined .header=${this._t("editor_cover_mode")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:window-shutter"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${modeData}
              .schema=${this._modeSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_cover_entities")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:window-open-variant"></ha-icon>
          <div class="panel-content">
            ${mode === "single"
              ? html`<ha-form
                  .hass=${this.hass}
                  .data=${singleData}
                  .schema=${this._singleEntitySchema()}
                  .computeLabel=${this._computeLabel}
                  @value-changed=${this._valueChanged}
                ></ha-form>`
              : html`
                  ${this._entities.map(
                    (e, index) => html`
                      <div class="sensor-row">
                        <ha-form
                          .hass=${this.hass}
                          .data=${{
                            entity_type: e.entity_type ?? "cover",
                            entity: e.entity ?? "",
                            up_entity: e.up_entity ?? "",
                            down_entity: e.down_entity ?? "",
                            stop_entity: e.stop_entity ?? "",
                            name: e.name ?? "",
                            icon: e.icon ?? "",
                          }}
                          .schema=${this._entityRowSchema(e)}
                          .computeLabel=${this._computeLabel}
                          @value-changed=${(ev: CustomEvent) => this._entityChanged(index, ev)}
                        ></ha-form>
                        <button class="remove-btn" @click=${() => this._removeEntity(index)}>
                          <ha-icon icon="mdi:close"></ha-icon>
                        </button>
                      </div>
                    `,
                  )}
                  <button class="add-btn" @click=${() => this._addEntity()}>
                    <ha-icon icon="mdi:plus"></ha-icon>
                    ${this._t("editor_cover_add_entity")}
                  </button>
                `}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_supply_display")}>
          <ha-icon slot="leading-icon" icon="mdi:view-dashboard-outline"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${displayData}
              .schema=${this._displaySchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_cover_behavior")}>
          <ha-icon slot="leading-icon" icon="mdi:tune"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${behaviorData}
              .schema=${this._behaviorSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_cover_travel_hint")}</div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_colors")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            ${colorRow(this._t("editor_todo_accent_color"), this._config.accent_color, (v) => this._colorChanged("accent_color", v))}
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
              .data=${{ animation: this._config.animation ?? "auto" }}
              .schema=${[
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
              ]}
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
          defaultRadius: DEFAULT_COVER_RADIUS,
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
      .sensor-row {
        display: flex;
        align-items: flex-start;
        gap: 8px;
      }
      .sensor-row ha-form {
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
    "m3-cover-card-editor": M3CoverCardEditor;
  }
}
