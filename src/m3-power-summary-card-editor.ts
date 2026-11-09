import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, LovelaceCardEditor, M3PowerSummaryCardConfig, PowerMetricConfig } from "./types";
import { DEFAULT_SUMMARY_RADIUS, DEFAULT_SUMMARY_ZERO_THRESHOLD, DEFAULT_SUMMARY_KW_THRESHOLD } from "./const";
import { localize, type TranslationKey } from "./localize";
import {
  fireEvent,
  colorRow,
  opacityRow,
  editorStyles,
  type SchemaEntry,
} from "./shared/editor-helpers";
import { radiusLabelMap } from "./shared/radius-editor";
import {
  initAppearanceState,
  radiusPresetPatch,
  cornerPresetPatch,
  renderAppearanceSection,
  type AppearanceState,
} from "./shared/appearance-editor";

@customElement("m3-power-summary-card-editor")
export class M3PowerSummaryCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3PowerSummaryCardConfig;
  @state() private _appearance: AppearanceState = { showCustomRadius: false, showCorners: false, cornerCustom: {} };

  public setConfig(config: M3PowerSummaryCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_SUMMARY_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _entitiesSchema(): SchemaEntry[] {
    return [
      { name: "grid_entity", selector: { entity: { domain: "sensor", device_class: "power" } } },
      {
        name: "grid_sign",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "negative_is_export", label: this._t("editor_summary_grid_sign_negative") },
              { value: "positive_is_export", label: this._t("editor_summary_grid_sign_positive") },
            ],
          },
        },
      },
      { name: "consumption_entity", selector: { entity: { domain: "sensor", device_class: "power" } } },
      { name: "solar_entity", selector: { entity: { domain: "sensor", device_class: "power", multiple: true } } },
    ];
  }

  private _contentSchema(): SchemaEntry[] {
    return [
      {
        name: "layout",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "full", label: this._t("editor_summary_layout_full") },
              { value: "compact", label: this._t("editor_summary_layout_compact") },
            ],
          },
        },
      },
      {
        name: "main_value",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "grid", label: this._t("editor_summary_main_grid") },
              { value: "consumption", label: this._t("editor_summary_main_consumption") },
            ],
          },
        },
      },
      { name: "tap_action", selector: { ui_action: {} } },
      { name: "label_export", selector: { text: {} } },
      { name: "label_import", selector: { text: {} } },
      { name: "show_self_sufficiency", selector: { boolean: {} } },
      { name: "show_split_bar", selector: { boolean: {} } },
      {
        name: "zero_threshold",
        selector: { number: { min: 0, step: 1, mode: "box", unit_of_measurement: "W" } },
      },
      {
        name: "kw_threshold",
        selector: { number: { min: 100, step: 50, mode: "box", unit_of_measurement: "W" } },
      },
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
      grid_entity: "editor_summary_grid_entity",
      grid_sign: "editor_summary_grid_sign",
      consumption_entity: "editor_summary_consumption_entity",
      solar_entity: "editor_summary_solar_entity",
      layout: "editor_summary_layout",
      main_value: "editor_summary_main_value",
      tap_action: "editor_tap_action",
      label_export: "editor_summary_label_export",
      label_import: "editor_summary_label_import",
      show_self_sufficiency: "editor_summary_show_self_sufficiency",
      show_split_bar: "editor_summary_show_split_bar",
      zero_threshold: "editor_summary_zero_threshold",
      kw_threshold: "editor_summary_kw_threshold",
      animation: "editor_progress_animation",
      glass_background: "editor_glass_background",
      ...radiusLabelMap,
    };
    const key = labelMap[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _colorChanged(
    field: "export_color" | "import_color" | "producer_color" | "accent_color" | "text_color" | "secondary_text_color" | "card_background",
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

  private _opacityChanged(field: "flow_tint_opacity" | "accent_opacity", value: number): void {
    if (!this._config) return;
    this._config = { ...this._config, [field]: value };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    this._config = { ...this._config, ...ev.detail.value };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _metricsChanged(text: string): void {
    if (!this._config) return;
    const metrics: PowerMetricConfig[] = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const [entity, name, icon, type] = line.split("|").map((p) => p.trim());
        const metric: PowerMetricConfig = { entity };
        if (name) metric.name = name;
        if (icon) metric.icon = icon;
        if (type === "producer" || type === "consumer") metric.type = type;
        return metric;
      })
      .filter((m) => m.entity.length > 0);
    this._config = { ...this._config, metrics };
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

    const solarEntity = this._config.solar_entity;
    const entitiesData = {
      grid_entity: this._config.grid_entity,
      grid_sign: this._config.grid_sign ?? "negative_is_export",
      consumption_entity: this._config.consumption_entity,
      solar_entity: Array.isArray(solarEntity) ? solarEntity : solarEntity ? [solarEntity] : [],
    };
    const contentData = {
      layout: this._config.layout ?? "full",
      main_value: this._config.main_value ?? "grid",
      tap_action: this._config.tap_action,
      label_export: this._config.label_export,
      label_import: this._config.label_import,
      show_self_sufficiency: this._config.show_self_sufficiency ?? true,
      show_split_bar: this._config.show_split_bar ?? true,
      zero_threshold: this._config.zero_threshold ?? DEFAULT_SUMMARY_ZERO_THRESHOLD,
      kw_threshold: this._config.kw_threshold ?? DEFAULT_SUMMARY_KW_THRESHOLD,
    };
    const animationData = { animation: this._config.animation ?? "auto" };
    const metricsText = (this._config.metrics ?? [])
      .map((m) => [m.entity, m.name ?? "", m.icon ?? "", m.type ?? ""].join(" | "))
      .join("\n");

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

        <ha-expansion-panel outlined .header=${this._t("editor_summary_metrics")}>
          <ha-icon slot="leading-icon" icon="mdi:view-grid-outline"></ha-icon>
          <div class="panel-content">
            <div class="hint">${this._t("editor_summary_metrics_helper")}</div>
            <textarea
              class="metrics-textarea"
              rows="4"
              .value=${metricsText}
              @change=${(e: Event) => this._metricsChanged((e.target as HTMLTextAreaElement).value)}
            ></textarea>
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
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_colors")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            ${colorRow(this._t("editor_summary_export_color"), this._config.export_color, (v) => this._colorChanged("export_color", v))}
            ${colorRow(this._t("editor_summary_import_color"), this._config.import_color, (v) => this._colorChanged("import_color", v))}
            ${colorRow(this._t("editor_summary_producer_color"), this._config.producer_color, (v) => this._colorChanged("producer_color", v))}
            ${opacityRow(this._t("editor_summary_flow_tint_opacity"), this._config.flow_tint_opacity, 18, (v) => this._opacityChanged("flow_tint_opacity", v))}
            ${colorRow(
              this._t("editor_summary_accent_color"),
              this._config.accent_color,
              (v) => this._colorChanged("accent_color", v),
              {
                label: this._t("editor_opacity"),
                value: this._config.accent_opacity,
                defaultValue: 18,
                onChange: (v) => this._opacityChanged("accent_opacity", v),
              },
            )}
            ${colorRow(this._t("editor_progress_text_color"), this._config.text_color, (v) => this._colorChanged("text_color", v))}
            ${colorRow(this._t("editor_progress_secondary_text_color"), this._config.secondary_text_color, (v) => this._colorChanged("secondary_text_color", v))}
            ${colorRow(this._t("editor_progress_card_background"), this._config.card_background, (v) => this._colorChanged("card_background", v))}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_animation")}>
          <ha-icon slot="leading-icon" icon="mdi:transmission-tower"></ha-icon>
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
          defaultRadius: DEFAULT_SUMMARY_RADIUS,
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
      .metrics-textarea {
        width: 100%;
        box-sizing: border-box;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid rgba(127, 127, 127, 0.4);
        background: transparent;
        color: var(--primary-text-color);
        font-size: 13px;
        font-family: monospace;
        resize: vertical;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-power-summary-card-editor": M3PowerSummaryCardEditor;
  }
}
