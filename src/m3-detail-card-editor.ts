import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, LovelaceCardEditor, M3DetailCardConfig } from "./types";
import { DETAIL_DEFAULT_MAX_RELATED, DETAIL_DEFAULT_RANGES } from "./const";
import { RADIUS } from "./shared/tokens";
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

type ColorField = "color" | "text_color" | "secondary_text_color" | "card_background";

@customElement("m3-detail-card-editor")
export class M3DetailCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3DetailCardConfig;
  @state() private _appearance: AppearanceState = { showCustomRadius: false, showCorners: false, cornerCustom: {} };

  public setConfig(config: M3DetailCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, RADIUS.card);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _rangeOptions() {
    return DETAIL_DEFAULT_RANGES.map((r) => ({ value: r, label: this._t(`detail_range_${r}` as TranslationKey) }));
  }

  private _entitySchema(): SchemaEntry[] {
    return [
      { name: "entity", selector: { entity: {} } },
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
    ];
  }

  private _graphSchema(): SchemaEntry[] {
    return [
      { name: "range", selector: { select: { mode: "dropdown", options: this._rangeOptions() } } },
      { name: "ranges", selector: { select: { multiple: true, mode: "list", options: this._rangeOptions() } } },
      {
        name: "stats",
        selector: {
          select: {
            multiple: true,
            mode: "list",
            options: [
              { value: "min", label: this._t("detail_minimum") },
              { value: "mean", label: this._t("detail_mean") },
              { value: "max", label: this._t("detail_maximum") },
              { value: "sum", label: this._t("detail_sum") },
            ],
          },
        },
      },
      { name: "trend_inverted", selector: { boolean: {} } },
      { name: "show_tooltip", selector: { boolean: {} } },
      { name: "y_axis", selector: { boolean: {} } },
    ];
  }

  private _behaviorSchema(): SchemaEntry[] {
    const schema: SchemaEntry[] = [
      {
        name: "details",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "auto", label: this._t("editor_detail_details_auto") },
              { value: "expanded", label: this._t("editor_detail_details_expanded") },
              { value: "collapsed", label: this._t("editor_detail_details_collapsed") },
              { value: "hidden", label: this._t("editor_detail_details_hidden") },
            ],
          },
        },
      },
      { name: "show_related", selector: { boolean: {} } },
    ];
    if (this._config?.show_related !== false) {
      schema.push({ name: "max_related", selector: { number: { min: 1, max: 12, mode: "box" } } });
    }
    // A custom card is a config object, which only YAML can hold; the form
    // offers the two words and leaves an object alone.
    if (typeof this._config?.control_card !== "object") {
      schema.push({
        name: "control_card",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "auto", label: this._t("editor_detail_control_auto") },
              { value: "none", label: this._t("editor_detail_control_none") },
            ],
          },
        },
      });
    }
    schema.push({
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
    });
    return schema;
  }

  private _computeLabel = (schema: SchemaEntry): string => {
    const labelMap: Record<string, TranslationKey> = {
      entity: "editor_entity",
      name: "editor_name",
      icon: "editor_icon",
      range: "editor_detail_range",
      ranges: "editor_detail_ranges",
      stats: "editor_detail_stats",
      trend_inverted: "editor_detail_trend_inverted",
      show_tooltip: "editor_detail_show_tooltip",
      y_axis: "editor_detail_y_axis",
      show_related: "editor_detail_show_related",
      max_related: "editor_detail_max_related",
      control_card: "editor_detail_control_card",
      details: "editor_detail_details",
      animation: "editor_progress_animation",
      glass_background: "editor_glass_background",
      ...radiusLabelMap,
    };
    const key = labelMap[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _computeHelper = (schema: SchemaEntry): string | undefined => {
    const helpers: Record<string, TranslationKey> = {
      ranges: "editor_detail_ranges_helper",
      stats: "editor_detail_stats_helper",
      control_card: "editor_detail_control_card_helper",
    };
    const key = helpers[schema.name];
    return key ? this._t(key) : undefined;
  };

  private _emit(config: M3DetailCardConfig): void {
    this._config = config;
    fireEvent(this, "config-changed", { config });
  }

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const next = { ...this._config, ...(ev.detail.value as Partial<M3DetailCardConfig>) } as Record<string, unknown>;
    // An emptied list means "the default", not "none": no periods at all
    // would leave a graph with no window, and no tiles is what `show` toggles
    // are for. The key goes, so the default applies.
    for (const key of ["ranges", "stats"]) {
      if (Array.isArray(next[key]) && (next[key] as unknown[]).length === 0) delete next[key];
    }
    // "auto" is the absence of the option, not a fourth value.
    if (next.details === "auto") delete next.details;
    this._emit(next as unknown as M3DetailCardConfig);
  }

  private _colorChanged(field: ColorField, value: string): void {
    if (!this._config) return;
    if (value) {
      this._emit({ ...this._config, [field]: value });
    } else {
      const { [field]: _removed, ...rest } = this._config;
      void _removed;
      this._emit(rest as M3DetailCardConfig);
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
      const { corners: _corners, ...rest } = this._config;
      void _corners;
      this._emit(rest as M3DetailCardConfig);
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
      this._emit({ ...this._config, corners: { ...(this._config.corners ?? {}), [key]: patch.px } });
    }
  }

  private _cornerValueChanged(key: string, ev: CustomEvent): void {
    if (!this._config) return;
    const px = ev.detail.value[key] as number;
    this._emit({ ...this._config, corners: { ...(this._config.corners ?? {}), [key]: px } });
  }

  protected render() {
    if (!this.hass || !this._config) return nothing;
    const cfg = this._config;
    const entityData = { entity: cfg.entity, name: cfg.name, icon: cfg.icon };
    const graphData = {
      range: cfg.range ?? "24h",
      ranges: cfg.ranges ?? [...DETAIL_DEFAULT_RANGES],
      stats: cfg.stats ?? [],
      trend_inverted: cfg.trend_inverted ?? false,
      show_tooltip: cfg.show_tooltip ?? true,
      y_axis: cfg.y_axis ?? true,
    };
    const behaviorData = {
      details: cfg.details ?? "auto",
      show_related: cfg.show_related ?? true,
      max_related: cfg.max_related ?? DETAIL_DEFAULT_MAX_RELATED,
      control_card: typeof cfg.control_card === "object" ? undefined : (cfg.control_card ?? "auto"),
      animation: cfg.animation ?? "auto",
    };

    return html`
      <div class="editor">
        <ha-expansion-panel outlined .header=${this._t("editor_entity")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:database"></ha-icon>
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

        <ha-expansion-panel outlined .header=${this._t("editor_detail_graph")}>
          <ha-icon slot="leading-icon" icon="mdi:chart-bell-curve-cumulative"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${graphData}
              .schema=${this._graphSchema()}
              .computeLabel=${this._computeLabel}
              .computeHelper=${this._computeHelper}
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_behavior")}>
          <ha-icon slot="leading-icon" icon="mdi:gesture-tap"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${behaviorData}
              .schema=${this._behaviorSchema()}
              .computeLabel=${this._computeLabel}
              .computeHelper=${this._computeHelper}
              @value-changed=${this._valueChanged}
            ></ha-form>
            ${typeof cfg.control_card === "object"
              ? html`<div class="hint">${this._t("editor_detail_control_card_yaml")}</div>`
              : nothing}
            <div class="hint">${this._t("editor_progress_animation_reduced_motion_hint")}</div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_colors")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            ${colorRow(this._t("editor_color"), cfg.color, (v) => this._colorChanged("color", v))}
            <div class="hint">${this._t("editor_detail_color_helper")}</div>
            ${colorRow(this._t("editor_progress_text_color"), cfg.text_color, (v) => this._colorChanged("text_color", v))}
            ${colorRow(this._t("editor_progress_secondary_text_color"), cfg.secondary_text_color, (v) =>
              this._colorChanged("secondary_text_color", v),
            )}
            ${colorRow(this._t("editor_progress_card_background"), cfg.card_background, (v) =>
              this._colorChanged("card_background", v),
            )}
          </div>
        </ha-expansion-panel>

        ${renderAppearanceSection({
          hass: this.hass,
          language: this._language,
          config: cfg,
          defaultRadius: RADIUS.card,
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
    "m3-detail-card-editor": M3DetailCardEditor;
  }
}
