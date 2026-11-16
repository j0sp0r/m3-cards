import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, LovelaceCardEditor, M3EnergyUsageCardConfig } from "./types";
import { DEFAULT_USAGE_RADIUS } from "./const";
import { localize, type TranslationKey } from "./localize";
import { fireEvent, editorStyles, type SchemaEntry } from "./shared/editor-helpers";
import { radiusLabelMap } from "./shared/radius-editor";
import {
  initAppearanceState,
  radiusPresetPatch,
  cornerPresetPatch,
  renderAppearanceSection,
  type AppearanceState,
} from "./shared/appearance-editor";

@customElement("m3-energy-usage-card-editor")
export class M3EnergyUsageCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3EnergyUsageCardConfig;
  @state() private _appearance: AppearanceState = { showCustomRadius: false, showCorners: false, cornerCustom: {} };

  public setConfig(config: M3EnergyUsageCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_USAGE_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _emit(config: M3EnergyUsageCardConfig): void {
    this._config = config;
    fireEvent(this, "config-changed", { config });
  }

  private _schema(): SchemaEntry[] {
    const kinds = (["day", "week", "month", "year"] as const).map((k) => ({ value: k, label: this._t(`usage_${k}` as TranslationKey) }));
    return [
      { name: "title", selector: { text: {} } },
      { name: "period", selector: { select: { mode: "dropdown", options: kinds } } },
      { name: "periods", selector: { select: { mode: "list", multiple: true, options: kinds } } },
      { name: "show_date", selector: { boolean: {} } },
      { name: "show_graph", selector: { boolean: {} } },
      { name: "show_table", selector: { boolean: {} } },
      { name: "show_devices", selector: { boolean: {} } },
      { name: "max_devices", selector: { number: { min: 1, max: 50, mode: "box" } } },
      { name: "collection_key", selector: { text: {} } },
    ];
  }

  private _computeLabel = (schema: SchemaEntry): string => {
    const map: Record<string, TranslationKey> = {
      title: "editor_avail_title",
      period: "editor_usage_period",
      periods: "editor_usage_periods",
      show_date: "editor_usage_show_date",
      show_graph: "editor_usage_show_graph",
      show_table: "editor_usage_show_table",
      show_devices: "editor_usage_show_devices",
      max_devices: "editor_usage_max_devices",
      collection_key: "editor_usage_key",
      ...radiusLabelMap,
    };
    const key = map[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const next: Record<string, unknown> = { ...this._config };
    for (const [k, v] of Object.entries(ev.detail.value as Record<string, unknown>)) {
      if (v === undefined || v === "" || v === null || (Array.isArray(v) && !v.length)) delete next[k];
      else next[k] = v;
    }
    this._emit(next as unknown as M3EnergyUsageCardConfig);
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
      this._emit(rest as M3EnergyUsageCardConfig);
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
    this._emit({ ...this._config, corners: { ...(this._config.corners ?? {}), [key]: ev.detail.value[key] as number } });
  }

  protected render() {
    if (!this.hass || !this._config) return nothing;
    const c = this._config;
    const data = {
      title: c.title ?? "",
      period: c.period ?? "day",
      periods: c.periods ?? ["day", "week", "month"],
      show_date: c.show_date !== false,
      show_graph: c.show_graph !== false,
      show_table: c.show_table !== false,
      show_devices: c.show_devices === true,
      max_devices: c.max_devices ?? 10,
      collection_key: c.collection_key ?? "",
    };
    return html`
      <div class="card-config">
        <ha-expansion-panel outlined .header=${this._t("editor_usage_parts")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:chart-bar-stacked"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${data}
              .schema=${this._schema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>
        ${renderAppearanceSection({
          hass: this.hass,
          language: this._language,
          config: this._config,
          defaultRadius: DEFAULT_USAGE_RADIUS,
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
    "m3-energy-usage-card-editor": M3EnergyUsageCardEditor;
  }
}
