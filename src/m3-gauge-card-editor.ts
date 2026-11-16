import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { GaugeSegmentConfig, HomeAssistant, LovelaceCardEditor, M3GaugeCardConfig } from "./types";
import { DEFAULT_GAUGE_RADIUS } from "./const";
import { localize, type TranslationKey } from "./localize";
import {
  fireEvent,
  colorRow,
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

@customElement("m3-gauge-card-editor")
export class M3GaugeCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3GaugeCardConfig;
  @state() private _appearance: AppearanceState = { showCustomRadius: false, showCorners: false, cornerCustom: {} };

  public setConfig(config: M3GaugeCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_GAUGE_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private get _needle(): boolean {
    return this._config?.style === "needle";
  }

  private _styleSchema(): SchemaEntry[] {
    return [
      {
        name: "style",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "default", label: this._t("editor_gauge_style_default") },
              { value: "needle", label: this._t("editor_gauge_style_needle") },
            ],
          },
        },
      },
    ];
  }

  private _needleSchema(): SchemaEntry[] {
    return [
      { name: "entity", selector: { entity: { domain: ["sensor", "number", "input_number"] } } },
      { name: "min", selector: { number: { mode: "box" } } },
      { name: "max", selector: { number: { mode: "box" } } },
      { name: "show_needle", selector: { boolean: {} } },
      { name: "show_value", selector: { boolean: {} } },
      { name: "show_unit", selector: { boolean: {} } },
      { name: "show_ticks", selector: { boolean: {} } },
      { name: "tick_count", selector: { number: { min: 2, max: 9, mode: "box" } } },
      { name: "secondary_entity", selector: { entity: {} } },
      { name: "secondary_name", selector: { text: {} } },
    ];
  }

  private _needleChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const v = ev.detail.value as Record<string, unknown>;
    const { secondary_entity, secondary_name, ...rest } = v;
    const next: M3GaugeCardConfig = { ...this._config, ...(rest as Partial<M3GaugeCardConfig>) };
    if (secondary_entity) next.secondary = { entity: secondary_entity as string, ...(secondary_name ? { name: secondary_name as string } : {}) };
    else delete next.secondary;
    this._config = next;
    fireEvent(this, "config-changed", { config: next });
  }

  private _segmentChanged(index: number, ev: CustomEvent): void {
    if (!this._config) return;
    const segments = [...(this._config.segments ?? [])];
    const v = ev.detail.value as GaugeSegmentConfig;
    segments[index] = { from: Number(v.from ?? 0), color: v.color || "primary", ...(v.label ? { label: v.label } : {}) };
    this._config = { ...this._config, segments };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _addSegment(): void {
    if (!this._config) return;
    const segments = [...(this._config.segments ?? [])];
    const last = segments[segments.length - 1];
    segments.push({ from: last ? last.from + 1 : (this._config.min ?? 0), color: "orange" });
    this._config = { ...this._config, segments };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _removeSegment(index: number): void {
    if (!this._config) return;
    const segments = (this._config.segments ?? []).filter((_, i) => i !== index);
    this._config = { ...this._config, segments };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _segmentSchema(): SchemaEntry[] {
    return [
      { name: "from", selector: { number: { mode: "box" } } },
      { name: "color", selector: { text: {} } },
      { name: "label", selector: { text: {} } },
    ];
  }

  private _renderNeedlePanels() {
    const c = this._config!;
    const sec = typeof c.secondary === "object" ? c.secondary : undefined;
    const data = {
      entity: c.entity,
      min: c.min ?? 0,
      max: c.max ?? 100,
      show_needle: c.show_needle !== false,
      show_value: c.show_value !== false,
      show_unit: c.show_unit !== false,
      show_ticks: c.show_ticks !== false,
      tick_count: c.tick_count ?? 5,
      secondary_entity: sec?.entity,
      secondary_name: sec?.name,
    };
    return html`
      <ha-expansion-panel outlined .header=${this._t("editor_entities")} expanded>
        <ha-icon slot="leading-icon" icon="mdi:gauge"></ha-icon>
        <div class="panel-content">
          <ha-form
            .hass=${this.hass}
            .data=${data}
            .schema=${this._needleSchema()}
            .computeLabel=${this._computeLabel}
            @value-changed=${this._needleChanged}
          ></ha-form>
        </div>
      </ha-expansion-panel>
      <ha-expansion-panel outlined .header=${this._t("editor_gauge_segments")} expanded>
        <ha-icon slot="leading-icon" icon="mdi:palette-swatch-outline"></ha-icon>
        <div class="panel-content">
          ${(c.segments ?? []).map(
            (seg, i) => html`<div class="seg-row">
              <ha-form
                .hass=${this.hass}
                .data=${seg}
                .schema=${this._segmentSchema()}
                .computeLabel=${this._computeLabel}
                @value-changed=${(e: CustomEvent) => this._segmentChanged(i, e)}
              ></ha-form>
              <ha-icon-button
                .label=${"×"}
                @click=${() => this._removeSegment(i)}
              ><ha-icon icon="mdi:delete-outline"></ha-icon></ha-icon-button>
            </div>`,
          )}
          <button class="add-btn" @click=${() => this._addSegment()}>
            <ha-icon icon="mdi:plus"></ha-icon>${this._t("editor_gauge_add_segment")}
          </button>
        </div>
      </ha-expansion-panel>
    `;
  }

  private _sourceSchema(): SchemaEntry[] {
    const schema: SchemaEntry[] = [
      {
        name: "source",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "energy", label: this._t("editor_gauge_source_energy") },
              { value: "entities", label: this._t("editor_gauge_source_entities") },
            ],
          },
        },
      },
    ];
    if (this._config?.source === "entities") {
      schema.push(
        { name: "value_a_entity", selector: { entity: { domain: "sensor" } } },
        { name: "value_b_entity", selector: { entity: { domain: "sensor" } } },
      );
    }
    return schema;
  }

  private _contentSchema(): SchemaEntry[] {
    return [
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "subtitle", selector: { text: {} } },
      { name: "label_positive", selector: { text: {} } },
      { name: "label_negative", selector: { text: {} } },
      { name: "label_a", selector: { text: {} } },
      { name: "label_b", selector: { text: {} } },
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
      source: "editor_gauge_source",
      style: "editor_gauge_style",
      entity: "editor_gauge_entity",
      min: "editor_gauge_min",
      max: "editor_gauge_max",
      show_needle: "editor_gauge_show_needle",
      show_value: "editor_gauge_show_value",
      show_unit: "editor_gauge_show_unit",
      show_ticks: "editor_gauge_show_ticks",
      tick_count: "editor_gauge_tick_count",
      secondary_entity: "editor_gauge_secondary_entity",
      secondary_name: "editor_gauge_secondary_name",
      from: "editor_gauge_segment_from",
      color: "editor_gauge_segment_color",
      label: "editor_gauge_segment_label",
      value_a_entity: "editor_gauge_value_a_entity",
      value_b_entity: "editor_gauge_value_b_entity",
      name: "editor_name",
      icon: "editor_icon",
      subtitle: "editor_energy_subtitle",
      label_positive: "editor_gauge_label_positive",
      label_negative: "editor_gauge_label_negative",
      label_a: "editor_gauge_label_a",
      label_b: "editor_gauge_label_b",
      animation: "editor_progress_animation",
      glass_background: "editor_glass_background",
      ...radiusLabelMap,
    };
    const key = labelMap[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _colorChanged(
    field:
      | "segment_a_color"
      | "segment_b_color"
      | "track_color"
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

  private _opacityChanged(field: "segment_a_opacity", value: number): void {
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

    const sourceData = {
      source: this._config.source ?? "energy",
      value_a_entity: this._config.value_a_entity,
      value_b_entity: this._config.value_b_entity,
    };
    const contentData = {
      name: this._config.name,
      icon: this._config.icon,
      subtitle: this._config.subtitle,
      label_positive: this._config.label_positive,
      label_negative: this._config.label_negative,
      label_a: this._config.label_a,
      label_b: this._config.label_b,
    };
    const animationData = { animation: this._config.animation ?? "auto" };

    return html`
      <div class="editor">
        <ha-form
          .hass=${this.hass}
          .data=${{ style: this._config.style ?? "default" }}
          .schema=${this._styleSchema()}
          .computeLabel=${this._computeLabel}
          @value-changed=${this._valueChanged}
        ></ha-form>
        ${this._needle
          ? this._renderNeedlePanels()
          : html`<ha-expansion-panel outlined .header=${this._t("editor_entities")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:database"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${sourceData}
              .schema=${this._sourceSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>`}

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
            <div class="hint">${this._t("editor_progress_colors_helper")}</div>
            ${colorRow(
              this._t("editor_gauge_segment_a_color"),
              this._config.segment_a_color,
              (v) => this._colorChanged("segment_a_color", v),
              {
                label: this._t("editor_opacity"),
                value: this._config.segment_a_opacity,
                defaultValue: 18,
                onChange: (v) => this._opacityChanged("segment_a_opacity", v),
              },
            )}
            ${colorRow(
              this._t("editor_gauge_segment_b_color"),
              this._config.segment_b_color,
              (v) => this._colorChanged("segment_b_color", v),
            )}
            ${colorRow(
              this._t("editor_gauge_track_color"),
              this._config.track_color,
              (v) => this._colorChanged("track_color", v),
            )}
            ${colorRow(
              this._t("editor_progress_text_color"),
              this._config.text_color,
              (v) => this._colorChanged("text_color", v),
            )}
            ${colorRow(
              this._t("editor_progress_secondary_text_color"),
              this._config.secondary_text_color,
              (v) => this._colorChanged("secondary_text_color", v),
            )}
            ${colorRow(
              this._t("editor_progress_card_background"),
              this._config.card_background,
              (v) => this._colorChanged("card_background", v),
            )}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_animation")}>
          <ha-icon slot="leading-icon" icon="mdi:gauge"></ha-icon>
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
          defaultRadius: DEFAULT_GAUGE_RADIUS,
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
      .seg-row {
        display: flex;
        align-items: flex-start;
        gap: 4px;
        margin-bottom: 8px;
      }
      .seg-row ha-form {
        flex: 1;
        min-width: 0;
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
        font: inherit;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-gauge-card-editor": M3GaugeCardEditor;
  }
}
