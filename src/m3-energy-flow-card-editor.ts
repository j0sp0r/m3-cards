import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, LovelaceCardEditor, M3EnergyFlowCardConfig } from "./types";
import { DEFAULT_FLOW_RADIUS } from "./const";
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

@customElement("m3-energy-flow-card-editor")
export class M3EnergyFlowCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3EnergyFlowCardConfig;
  @state() private _appearance: AppearanceState = { showCustomRadius: false, showCorners: false, cornerCustom: {} };

  public setConfig(config: M3EnergyFlowCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_FLOW_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _entitiesSchema(): SchemaEntry[] {
    const source = this._config?.source ?? "energy";
    const fields: SchemaEntry[] = [
      {
        name: "source",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "energy", label: this._t("editor_flow_source_energy") },
              { value: "entities", label: this._t("editor_flow_source_entities") },
            ],
          },
        },
      },
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
    ];
    if (source === "entities") {
      fields.push(
        { name: "solar_entity", selector: { entity: { domain: "sensor" } } },
        { name: "grid_import_entity", selector: { entity: { domain: "sensor" } } },
        { name: "grid_export_entity", selector: { entity: { domain: "sensor" } } },
        { name: "battery_entity", selector: { entity: { domain: "sensor" } } },
      );
    }
    return fields;
  }

  private _contentSchema(): SchemaEntry[] {
    return [
      { name: "show_self_sufficiency", selector: { boolean: {} } },
      { name: "subtitle", selector: { text: {} } },
      { name: "pv_name", selector: { text: {} } },
      { name: "grid_name", selector: { text: {} } },
      { name: "home_name", selector: { text: {} } },
      { name: "battery_name", selector: { text: {} } },
      { name: "unit", selector: { text: {} } },
    ];
  }

  private _computeHelper = (schema: SchemaEntry): string | undefined =>
    schema.name === "unit" ? this._t("editor_flow_unit_helper") : undefined;

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
      {
        name: "flow_speed",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "slow", label: this._t("editor_flow_speed_slow") },
              { value: "normal", label: this._t("editor_flow_speed_normal") },
              { value: "fast", label: this._t("editor_flow_speed_fast") },
            ],
          },
        },
      },
    ];
  }

  private _computeLabel = (schema: SchemaEntry): string => {
    const labelMap: Record<string, TranslationKey> = {
      source: "editor_flow_source",
      name: "editor_name",
      icon: "editor_icon",
      solar_entity: "editor_flow_solar_entity",
      grid_import_entity: "editor_flow_grid_import_entity",
      grid_export_entity: "editor_flow_grid_export_entity",
      battery_entity: "editor_flow_battery_entity",
      show_self_sufficiency: "editor_flow_show_self_sufficiency",
      subtitle: "editor_flow_subtitle",
      pv_name: "editor_flow_pv_name",
      grid_name: "editor_flow_grid_name",
      home_name: "editor_flow_home_name",
      battery_name: "editor_flow_battery_name",
      unit: "editor_flow_unit",
      animation: "editor_progress_animation",
      flow_speed: "editor_flow_speed",
      glass_background: "editor_glass_background",
      ...radiusLabelMap,
    };
    const key = labelMap[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _colorChanged(
    field:
      | "pv_color"
      | "grid_color"
      | "home_color"
      | "self_sufficiency_color"
      | "text_color"
      | "secondary_text_color"
      | "card_background",
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

  private _opacityChanged(field: "text_opacity" | "node_tint_opacity", value: number): void {
    if (!this._config) return;
    this._config = { ...this._config, [field]: value };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const next: Record<string, unknown> = { ...this._config, ...ev.detail.value };
    // An emptied text field is an unset option, not an empty name.
    for (const k of ["subtitle", "pv_name", "grid_name", "home_name", "battery_name", "unit"]) if (next[k] === "") delete next[k];
    this._config = next as unknown as M3EnergyFlowCardConfig;
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

    const source = this._config.source ?? "energy";
    const entitiesData = {
      source,
      name: this._config.name,
      icon: this._config.icon,
      solar_entity: this._config.solar_entity,
      grid_import_entity: this._config.grid_import_entity,
      grid_export_entity: this._config.grid_export_entity,
      battery_entity: this._config.battery_entity,
    };
    const contentData = {
      show_self_sufficiency: this._config.show_self_sufficiency ?? true,
      subtitle: this._config.subtitle,
      pv_name: this._config.pv_name,
      grid_name: this._config.grid_name,
      home_name: this._config.home_name,
      battery_name: this._config.battery_name,
      unit: this._config.unit,
    };
    const animationData = {
      animation: this._config.animation ?? "auto",
      flow_speed: this._config.flow_speed ?? "normal",
    };

    return html`
      <div class="editor">
        <ha-expansion-panel outlined .header=${this._t("editor_entities")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:database"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${entitiesData}
              .schema=${this._entitiesSchema()}
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
              .computeHelper=${this._computeHelper}
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_colors")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            ${colorRow(this._t("editor_flow_pv_color"), this._config.pv_color, (v) => this._colorChanged("pv_color", v))}
            ${colorRow(this._t("editor_flow_grid_color"), this._config.grid_color, (v) => this._colorChanged("grid_color", v))}
            ${colorRow(this._t("editor_flow_home_color"), this._config.home_color, (v) => this._colorChanged("home_color", v))}
            ${colorRow(this._t("editor_flow_self_sufficiency_color"), this._config.self_sufficiency_color, (v) => this._colorChanged("self_sufficiency_color", v))}
            ${colorRow(this._t("editor_progress_text_color"), this._config.text_color, (v) => this._colorChanged("text_color", v), {
              label: this._t("editor_opacity"),
              value: this._config.text_opacity,
              defaultValue: 12,
              onChange: (v) => this._opacityChanged("text_opacity", v),
            })}
            ${colorRow(this._t("editor_progress_secondary_text_color"), this._config.secondary_text_color, (v) => this._colorChanged("secondary_text_color", v))}
            ${colorRow(this._t("editor_progress_card_background"), this._config.card_background, (v) => this._colorChanged("card_background", v))}
            ${opacityRow(this._t("editor_flow_node_tint_opacity"), this._config.node_tint_opacity, 18, (v) => this._opacityChanged("node_tint_opacity", v))}
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
          defaultRadius: DEFAULT_FLOW_RADIUS,
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
    "m3-energy-flow-card-editor": M3EnergyFlowCardEditor;
  }
}
