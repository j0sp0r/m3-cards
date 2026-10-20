import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  LovelaceCardEditor,
  M3RouterCardConfig,
  RouterThresholdConfig,
} from "./types";
import {
  DEFAULT_ROUTER_SPARK_MINUTES,
  DEFAULT_ROUTER_SPARK_POINTS,
  DEFAULT_ROUTER_RADIUS,
} from "./const";
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
import {
  DEFAULT_NR_RSRP_THRESHOLDS,
  DEFAULT_RSRP_THRESHOLDS,
  DEFAULT_RSRQ_THRESHOLDS,
  DEFAULT_SNR_THRESHOLDS,
  discoverRouterEntities,
  guessRouterPrefix,
  type RouterSlot,
} from "./shared/router";

/** The colour fields this editor offers, as the config spells them. */
type ColorField =
  | "accent_color"
  | "download_color"
  | "upload_color"
  | "online_color"
  | "offline_color"
  | "text_color"
  | "secondary_text_color"
  | "card_background";

@customElement("m3-router-card-editor")
export class M3RouterCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3RouterCardConfig;
  @state() private _appearance: AppearanceState = {
    showCustomRadius: false,
    showCorners: false,
    cornerCustom: {},
  };

  public setConfig(config: M3RouterCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_ROUTER_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }
  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }
  private _emit(config: M3RouterCardConfig): void {
    this._config = config;
    fireEvent(this, "config-changed", { config });
  }

  /**
   * What discovery currently finds, so the entity fields can show it as a
   * placeholder rather than leaving the user guessing whether a blank field
   * means "nothing found" or "found, just not written down".
   */
  private _discovered(): Partial<Record<RouterSlot, string>> {
    if (!this.hass || this._config?.auto_discover === false) return {};
    const ids = Object.keys(this.hass.states);
    const prefix = this._config?.entity_prefix ?? guessRouterPrefix(ids);
    return discoverRouterEntities(ids, prefix);
  }

  private _sourceSchema(): SchemaEntry[] {
    return [
      { name: "entity", selector: { entity: { domain: ["binary_sensor", "sensor"] } } },
      { name: "entity_prefix", selector: { text: {} } },
      { name: "auto_discover", selector: { boolean: {} } },
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
    ];
  }

  private _signalSchema(): SchemaEntry[] {
    return [
      { name: "rsrp_entity", selector: { entity: { domain: "sensor" } } },
      { name: "rsrq_entity", selector: { entity: { domain: "sensor" } } },
      { name: "snr_entity", selector: { entity: { domain: "sensor" } } },
      { name: "nr_rsrp_entity", selector: { entity: { domain: "sensor" } } },
      { name: "nr_snr_entity", selector: { entity: { domain: "sensor" } } },
      { name: "band_entity", selector: { entity: { domain: "sensor" } } },
      { name: "nr_band_entity", selector: { entity: { domain: "sensor" } } },
      { name: "cell_id_entity", selector: { entity: { domain: "sensor" } } },
      { name: "network_type_entity", selector: { entity: { domain: "sensor" } } },
      { name: "show_signal", selector: { boolean: {} } },
      { name: "show_signal_details", selector: { boolean: {} } },
      { name: "show_nr_signal", selector: { boolean: {} } },
    ];
  }

  private _throughputSchema(): SchemaEntry[] {
    return [
      { name: "download_entity", selector: { entity: { domain: "sensor" } } },
      { name: "upload_entity", selector: { entity: { domain: "sensor" } } },
      { name: "show_throughput", selector: { boolean: {} } },
      { name: "show_sparkline", selector: { boolean: {} } },
      { name: "peak_chip", selector: { boolean: {} } },
      { name: "spark_points", selector: { number: { min: 8, max: 200, mode: "box" } } },
      {
        name: "spark_history_minutes",
        selector: { number: { min: 5, max: 720, mode: "box", unit_of_measurement: "min" } },
      },
    ];
  }

  private _dataSchema(): SchemaEntry[] {
    return [
      { name: "data_down_entity", selector: { entity: { domain: "sensor" } } },
      { name: "data_up_entity", selector: { entity: { domain: "sensor" } } },
      { name: "data_total_entity", selector: { entity: { domain: "sensor" } } },
      { name: "data_limit", selector: { number: { min: 0, max: 100000, mode: "box", unit_of_measurement: "GB" } } },
      { name: "show_data", selector: { boolean: {} } },
    ];
  }

  private readonly _computeLabel = (schema: SchemaEntry): string => {
    const map: Record<string, TranslationKey> = {
      entity: "editor_router_connection_entity",
      entity_prefix: "editor_router_prefix",
      auto_discover: "editor_router_auto_discover",
      name: "editor_name",
      icon: "editor_icon",
      rsrp_entity: "editor_router_rsrp_entity",
      rsrq_entity: "editor_router_rsrq_entity",
      snr_entity: "editor_router_snr_entity",
      rssi_entity: "editor_router_rssi_entity",
      nr_rsrp_entity: "editor_router_nr_rsrp_entity",
      nr_snr_entity: "editor_router_nr_snr_entity",
      band_entity: "editor_router_band_entity",
      nr_band_entity: "editor_router_nr_band_entity",
      cell_id_entity: "editor_router_cell_id_entity",
      network_type_entity: "editor_router_network_type_entity",
      download_entity: "editor_router_download_entity",
      upload_entity: "editor_router_upload_entity",
      data_down_entity: "editor_router_data_down_entity",
      data_up_entity: "editor_router_data_up_entity",
      data_total_entity: "editor_router_data_total_entity",
      data_limit: "editor_router_data_limit",
      show_signal: "editor_router_show_signal",
      show_signal_details: "editor_router_show_signal_details",
      show_nr_signal: "editor_router_show_nr_signal",
      show_throughput: "editor_router_show_throughput",
      show_sparkline: "editor_router_show_sparkline",
      show_data: "editor_router_show_data",
      peak_chip: "editor_router_peak_chip",
      spark_points: "editor_router_spark_points",
      spark_history_minutes: "editor_router_spark_minutes",
      glass_background: "editor_glass_background",
      ...radiusLabelMap,
    };
    const key = map[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const patch = ev.detail.value as Record<string, unknown>;
    // An emptied field has to be removed, not written back as "": an empty
    // string in `rsrp_entity` would beat discovery and blank the block.
    const next = { ...this._config, ...patch } as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) {
      if (v === "" || v === undefined || v === null) delete next[k];
    }
    this._emit(next as unknown as M3RouterCardConfig);
  }

  private _colorChanged(field: ColorField, value: string): void {
    if (!this._config) return;
    if (value) this._emit({ ...this._config, [field]: value });
    else {
      const { [field]: _removed, ...rest } = this._config;
      this._emit(rest as M3RouterCardConfig);
    }
  }

  // ---- thresholds -----------------------------------------------------------

  /**
   * The four scales as one editable text field each: `-80, -90, -100, -110`.
   *
   * A repeatable sub-form with a grade dropdown per row would be the thorough
   * version, and it would also be four taps to change one number. The grades
   * are fixed and ordered; only the boundaries are a decision.
   */
  private _thresholdRow(
    label: string,
    field: "rsrp_thresholds" | "nr_rsrp_thresholds" | "snr_thresholds" | "rsrq_thresholds",
    fallback: RouterThresholdConfig[],
  ) {
    const current = this._config?.[field]?.length ? this._config[field]! : fallback;
    const text = current.map((t) => t.min).join(", ");
    return html`
      <div class="color-row">
        <label class="color-label">${label}</label>
        <input
          type="text"
          class="color-text list-input"
          .value=${text}
          placeholder=${fallback.map((t) => t.min).join(", ")}
          @change=${(e: Event) => this._thresholdsChanged(field, (e.target as HTMLInputElement).value, fallback)}
        />
      </div>
    `;
  }

  private _thresholdsChanged(
    field: "rsrp_thresholds" | "nr_rsrp_thresholds" | "snr_thresholds" | "rsrq_thresholds",
    raw: string,
    fallback: RouterThresholdConfig[],
  ): void {
    if (!this._config) return;
    const numbers = raw
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
    // Back to the defaults rather than a half-written scale: fewer bounds than
    // grades would leave a step unreachable.
    if (numbers.length !== fallback.length) {
      const { [field]: _removed, ...rest } = this._config;
      this._emit(rest as M3RouterCardConfig);
      return;
    }
    const sorted = [...numbers].sort((a, b) => b - a);
    this._emit({
      ...this._config,
      [field]: sorted.map((min, i) => ({ min, grade: fallback[i].grade })),
    });
  }

  // ---- value map ------------------------------------------------------------

  private _valueMapText(): string {
    const map = this._config?.value_map ?? {};
    return Object.entries(map)
      .map(([k, v]) => `${k} = ${v}`)
      .join("\n");
  }

  private _valueMapChanged(raw: string): void {
    if (!this._config) return;
    const map: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const i = line.indexOf("=");
      if (i < 1) continue;
      const key = line.slice(0, i).trim();
      const value = line.slice(i + 1).trim();
      if (key && value) map[key] = value;
    }
    if (Object.keys(map).length) this._emit({ ...this._config, value_map: map });
    else {
      const { value_map: _removed, ...rest } = this._config;
      this._emit(rest as M3RouterCardConfig);
    }
  }

  // ---- appearance plumbing --------------------------------------------------

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
      this._emit(rest as M3RouterCardConfig);
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

  // ---- render ---------------------------------------------------------------

  protected render() {
    if (!this.hass || !this._config) return nothing;
    const cfg = this._config;
    const found = this._discovered();
    const foundCount = Object.keys(found).length;

    const sourceData = {
      entity: cfg.entity ?? "",
      entity_prefix: cfg.entity_prefix ?? "",
      auto_discover: cfg.auto_discover ?? true,
      name: cfg.name ?? "",
      icon: cfg.icon ?? "",
    };
    const signalData = {
      rsrp_entity: cfg.rsrp_entity ?? "",
      rsrq_entity: cfg.rsrq_entity ?? "",
      snr_entity: cfg.snr_entity ?? "",
      nr_rsrp_entity: cfg.nr_rsrp_entity ?? "",
      nr_snr_entity: cfg.nr_snr_entity ?? "",
      band_entity: cfg.band_entity ?? "",
      nr_band_entity: cfg.nr_band_entity ?? "",
      cell_id_entity: cfg.cell_id_entity ?? "",
      network_type_entity: cfg.network_type_entity ?? "",
      show_signal: cfg.show_signal ?? true,
      show_signal_details: cfg.show_signal_details ?? true,
      show_nr_signal: cfg.show_nr_signal ?? true,
    };
    const throughputData = {
      download_entity: cfg.download_entity ?? "",
      upload_entity: cfg.upload_entity ?? "",
      show_throughput: cfg.show_throughput ?? true,
      show_sparkline: cfg.show_sparkline ?? true,
      peak_chip: cfg.peak_chip ?? false,
      spark_points: cfg.spark_points ?? DEFAULT_ROUTER_SPARK_POINTS,
      spark_history_minutes: cfg.spark_history_minutes ?? DEFAULT_ROUTER_SPARK_MINUTES,
    };
    const dataData = {
      data_down_entity: cfg.data_down_entity ?? "",
      data_up_entity: cfg.data_up_entity ?? "",
      data_total_entity: cfg.data_total_entity ?? "",
      data_limit: cfg.data_limit ?? 0,
      show_data: cfg.show_data ?? true,
    };

    return html`
      <div class="editor">
        <ha-expansion-panel outlined .header=${this._t("editor_entities")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:router-wireless"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${sourceData}
              .schema=${this._sourceSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_router_connection_hint")}</div>
            <div class="hint">${this._t("editor_router_prefix_hint")}</div>
            ${cfg.auto_discover === false
              ? nothing
              : html`<div class="hint">
                  ${foundCount
                    ? `${foundCount} ×  ${Object.entries(found)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(" · ")}`
                    : this._t("router_no_data")}
                </div>`}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_router_signal")}>
          <ha-icon slot="leading-icon" icon="mdi:signal"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${signalData}
              .schema=${this._signalSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_router_throughput")}>
          <ha-icon slot="leading-icon" icon="mdi:swap-vertical"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${throughputData}
              .schema=${this._throughputSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_router_throughput_hint")}</div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_router_data")}>
          <ha-icon slot="leading-icon" icon="mdi:chart-donut"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${dataData}
              .schema=${this._dataSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_router_data_limit_hint")}</div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_router_thresholds")}>
          <ha-icon slot="leading-icon" icon="mdi:tune-variant"></ha-icon>
          <div class="panel-content">
            ${this._thresholdRow(
              this._t("editor_router_rsrp_thresholds"),
              "rsrp_thresholds",
              DEFAULT_RSRP_THRESHOLDS,
            )}
            ${this._thresholdRow(
              this._t("editor_router_nr_rsrp_thresholds"),
              "nr_rsrp_thresholds",
              DEFAULT_NR_RSRP_THRESHOLDS,
            )}
            ${this._thresholdRow(
              this._t("editor_router_snr_thresholds"),
              "snr_thresholds",
              DEFAULT_SNR_THRESHOLDS,
            )}
            ${this._thresholdRow(
              this._t("editor_router_rsrq_thresholds"),
              "rsrq_thresholds",
              DEFAULT_RSRQ_THRESHOLDS,
            )}
            <div class="hint">${this._t("editor_router_thresholds_hint")}</div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_router_value_map")}>
          <ha-icon slot="leading-icon" icon="mdi:rename-outline"></ha-icon>
          <div class="panel-content">
            <textarea
              class="map-input"
              rows="4"
              .value=${this._valueMapText()}
              placeholder="ca_deactivated = Aus"
              @change=${(e: Event) => this._valueMapChanged((e.target as HTMLTextAreaElement).value)}
            ></textarea>
            <div class="hint">${this._t("editor_router_value_map_hint")}</div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_colors")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            ${colorRow(this._t("editor_todo_accent_color"), cfg.accent_color, (v) => this._colorChanged("accent_color", v))}
            ${colorRow(this._t("editor_router_download_color"), cfg.download_color, (v) => this._colorChanged("download_color", v))}
            ${colorRow(this._t("editor_router_upload_color"), cfg.upload_color, (v) => this._colorChanged("upload_color", v))}
            ${colorRow(this._t("editor_router_online_color"), cfg.online_color, (v) => this._colorChanged("online_color", v))}
            ${colorRow(this._t("editor_router_offline_color"), cfg.offline_color, (v) => this._colorChanged("offline_color", v))}
            ${colorRow(this._t("editor_progress_text_color"), cfg.text_color, (v) => this._colorChanged("text_color", v))}
            ${colorRow(this._t("editor_progress_secondary_text_color"), cfg.secondary_text_color, (v) => this._colorChanged("secondary_text_color", v))}
            ${colorRow(this._t("editor_progress_card_background"), cfg.card_background, (v) => this._colorChanged("card_background", v))}
          </div>
        </ha-expansion-panel>

        ${renderAppearanceSection({
          hass: this.hass,
          language: this._language,
          config: cfg,
          defaultRadius: DEFAULT_ROUTER_RADIUS,
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
      .map-input {
        width: 100%;
        box-sizing: border-box;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid rgba(127, 127, 127, 0.4);
        background: transparent;
        color: var(--primary-text-color);
        font-size: 14px;
        font-family: inherit;
        resize: vertical;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-router-card-editor": M3RouterCardEditor;
  }
}
