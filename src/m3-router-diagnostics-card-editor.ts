import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  LovelaceCardEditor,
  M3RouterDiagnosticsCardConfig,
  RouterCheckConfig,
  RouterInfoConfig,
  RouterTemperatureConfig,
} from "./types";
import {
  DEFAULT_ROUTER_CONFIRM_TIMEOUT,
  DEFAULT_ROUTER_TEMP_HOT,
  DEFAULT_ROUTER_TEMP_MAX,
  DEFAULT_ROUTER_TEMP_WARN,
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
  discoverTemperatureEntities,
  discoverThrottleEntities,
  guessRouterPrefix,
} from "./shared/router";

type ColorField =
  | "accent_color"
  | "ok_color"
  | "warn_color"
  | "hot_color"
  | "text_color"
  | "secondary_text_color"
  | "card_background";

@customElement("m3-router-diagnostics-card-editor")
export class M3RouterDiagnosticsCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3RouterDiagnosticsCardConfig;
  @state() private _appearance: AppearanceState = {
    showCustomRadius: false,
    showCorners: false,
    cornerCustom: {},
  };

  public setConfig(config: M3RouterDiagnosticsCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_ROUTER_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }
  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }
  private _emit(config: M3RouterDiagnosticsCardConfig): void {
    this._config = config;
    fireEvent(this, "config-changed", { config });
  }

  private get _temperatures(): RouterTemperatureConfig[] {
    return this._config?.temperature_entities ?? [];
  }
  private get _infos(): RouterInfoConfig[] {
    return this._config?.info_entities ?? [];
  }
  private get _checks(): RouterCheckConfig[] {
    return this._config?.check_entities ?? [];
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

  private _tempSchema(): SchemaEntry[] {
    return [
      { name: "show_temperatures", selector: { boolean: {} } },
      { name: "temp_warn", selector: { number: { min: 0, max: 150, mode: "box", unit_of_measurement: "°C" } } },
      { name: "temp_hot", selector: { number: { min: 0, max: 150, mode: "box", unit_of_measurement: "°C" } } },
      { name: "temp_max", selector: { number: { min: 10, max: 200, mode: "box", unit_of_measurement: "°C" } } },
      { name: "show_throttle", selector: { boolean: {} } },
    ];
  }

  private _tempRowSchema(): SchemaEntry[] {
    return [
      { name: "entity", required: true, selector: { entity: { domain: "sensor" } } },
      { name: "name", selector: { text: {} } },
      { name: "max", selector: { number: { min: 10, max: 200, mode: "box", unit_of_measurement: "°C" } } },
    ];
  }

  private _infoRowSchema(): SchemaEntry[] {
    return [
      { name: "entity", required: true, selector: { entity: {} } },
      { name: "label", selector: { text: {} } },
      { name: "warn_value", selector: { text: {} } },
    ];
  }

  private _checkRowSchema(): SchemaEntry[] {
    return [
      { name: "entity", required: true, selector: { entity: { domain: ["binary_sensor", "sensor"] } } },
      { name: "name", selector: { text: {} } },
      { name: "ok_state", selector: { text: {} } },
    ];
  }

  private _displaySchema(): SchemaEntry[] {
    return [
      { name: "show_info", selector: { boolean: {} } },
      { name: "show_checks", selector: { boolean: {} } },
      { name: "show_uptime", selector: { boolean: {} } },
      { name: "show_firmware", selector: { boolean: {} } },
      { name: "show_clients", selector: { boolean: {} } },
    ];
  }

  private _rebootSchema(): SchemaEntry[] {
    const schema: SchemaEntry[] = [
      { name: "show_reboot", selector: { boolean: {} } },
      { name: "confirm_reboot", selector: { boolean: {} } },
    ];
    if (this._config?.confirm_reboot !== false) {
      schema.push({
        name: "confirm_timeout",
        selector: { number: { min: 1000, max: 30000, step: 500, mode: "box", unit_of_measurement: "ms" } },
      });
    }
    schema.push({ name: "reboot_action", selector: { ui_action: {} } });
    return schema;
  }

  private readonly _computeLabel = (schema: SchemaEntry): string => {
    const map: Record<string, TranslationKey> = {
      entity: "editor_router_connection_entity",
      entity_prefix: "editor_router_prefix",
      auto_discover: "editor_router_auto_discover",
      name: "editor_name",
      icon: "editor_icon",
      label: "editor_name",
      max: "editor_router_temp_max",
      warn_value: "editor_router_warn_color",
      ok_state: "editor_router_check_ok_state",
      show_temperatures: "editor_router_show_temperatures",
      show_throttle: "editor_router_show_throttle",
      show_info: "editor_router_show_info",
      show_checks: "editor_router_show_checks",
      show_reboot: "editor_router_show_reboot",
      show_uptime: "editor_router_show_uptime",
      show_firmware: "editor_router_show_firmware",
      show_clients: "editor_router_show_clients",
      temp_warn: "editor_router_temp_warn",
      temp_hot: "editor_router_temp_hot",
      temp_max: "editor_router_temp_max",
      confirm_reboot: "editor_router_confirm_reboot",
      confirm_timeout: "editor_router_confirm_timeout",
      reboot_action: "editor_router_reboot_action",
      glass_background: "editor_glass_background",
      ...radiusLabelMap,
    };
    const key = map[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const patch = ev.detail.value as Record<string, unknown>;
    const next = { ...this._config, ...patch } as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) {
      if (v === "" || v === undefined || v === null) delete next[k];
    }
    this._emit(next as unknown as M3RouterDiagnosticsCardConfig);
  }

  // ---- repeatable lists -----------------------------------------------------

  private _rowChanged<T extends { entity: string }>(
    field: "temperature_entities" | "info_entities" | "check_entities",
    rows: T[],
    index: number,
    ev: CustomEvent,
  ): void {
    if (!this._config) return;
    const next = [...rows];
    const value = ev.detail.value as Record<string, unknown>;
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== "" && v !== undefined && v !== null) cleaned[k] = v;
    }
    next[index] = cleaned as unknown as T;
    this._emit({ ...this._config, [field]: next });
  }

  private _addRow(field: "temperature_entities" | "info_entities" | "check_entities", rows: unknown[]): void {
    if (!this._config) return;
    this._emit({ ...this._config, [field]: [...rows, { entity: "" }] });
  }

  private _removeRow(
    field: "temperature_entities" | "info_entities" | "check_entities",
    rows: unknown[],
    index: number,
  ): void {
    if (!this._config) return;
    const next = rows.filter((_, i) => i !== index);
    if (next.length) this._emit({ ...this._config, [field]: next });
    else {
      const { [field]: _removed, ...rest } = this._config;
      this._emit(rest as M3RouterDiagnosticsCardConfig);
    }
  }

  private _renderRows<T extends { entity: string }>(
    field: "temperature_entities" | "info_entities" | "check_entities",
    rows: T[],
    schema: SchemaEntry[],
  ) {
    return html`
      ${rows.map(
        (row, i) => html`
          <div class="sensor-row">
            <ha-form
              .hass=${this.hass}
              .data=${row}
              .schema=${schema}
              .computeLabel=${this._computeLabel}
              @value-changed=${(ev: CustomEvent) => this._rowChanged(field, rows, i, ev)}
            ></ha-form>
            <button
              type="button"
              class="remove-btn"
              aria-label=${this._t("editor_router_remove_row")}
              @click=${() => this._removeRow(field, rows, i)}
            >
              <ha-icon icon="mdi:close"></ha-icon>
            </button>
          </div>
        `,
      )}
      <button
        type="button"
        class="add-btn"
        aria-label=${this._t("editor_router_add_row")}
        @click=${() => this._addRow(field, rows)}
      >
        <ha-icon icon="mdi:plus"></ha-icon>
      </button>
    `;
  }

  private _throttleChanged(raw: string): void {
    if (!this._config) return;
    const list = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length) this._emit({ ...this._config, throttle_entities: list });
    else {
      const { throttle_entities: _removed, ...rest } = this._config;
      this._emit(rest as M3RouterDiagnosticsCardConfig);
    }
  }

  private _colorChanged(field: ColorField, value: string): void {
    if (!this._config) return;
    if (value) this._emit({ ...this._config, [field]: value });
    else {
      const { [field]: _removed, ...rest } = this._config;
      this._emit(rest as M3RouterDiagnosticsCardConfig);
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
      this._emit(rest as M3RouterDiagnosticsCardConfig);
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
    const ids = Object.keys(this.hass.states);
    const prefix = cfg.entity_prefix ?? guessRouterPrefix(ids);
    const discoveredTemps = discoverTemperatureEntities(this.hass, ids, prefix);
    const discoveredThrottles = discoverThrottleEntities(ids, prefix);

    const sourceData = {
      entity: cfg.entity ?? "",
      entity_prefix: cfg.entity_prefix ?? "",
      auto_discover: cfg.auto_discover ?? true,
      name: cfg.name ?? "",
      icon: cfg.icon ?? "",
    };
    const tempData = {
      show_temperatures: cfg.show_temperatures ?? true,
      temp_warn: cfg.temp_warn ?? DEFAULT_ROUTER_TEMP_WARN,
      temp_hot: cfg.temp_hot ?? DEFAULT_ROUTER_TEMP_HOT,
      temp_max: cfg.temp_max ?? DEFAULT_ROUTER_TEMP_MAX,
      show_throttle: cfg.show_throttle ?? true,
    };
    const displayData = {
      show_info: cfg.show_info ?? true,
      show_checks: cfg.show_checks ?? true,
      show_uptime: cfg.show_uptime ?? false,
      show_firmware: cfg.show_firmware ?? false,
      show_clients: cfg.show_clients ?? false,
    };
    const rebootData = {
      show_reboot: cfg.show_reboot ?? true,
      confirm_reboot: cfg.confirm_reboot ?? true,
      confirm_timeout: cfg.confirm_timeout ?? DEFAULT_ROUTER_CONFIRM_TIMEOUT,
      reboot_action: cfg.reboot_action,
    };

    return html`
      <div class="editor">
        <ha-expansion-panel outlined .header=${this._t("editor_entities")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:stethoscope"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${sourceData}
              .schema=${this._sourceSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_router_prefix_hint")}</div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_router_temperatures")}>
          <ha-icon slot="leading-icon" icon="mdi:thermometer"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${tempData}
              .schema=${this._tempSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_router_temperature_entities")}</div>
            ${this._temperatures.length
              ? nothing
              : html`<div class="hint">
                  ${discoveredTemps.length
                    ? discoveredTemps.join(", ")
                    : this._t("router_no_data")}
                </div>`}
            ${this._renderRows("temperature_entities", this._temperatures, this._tempRowSchema())}
            <div class="color-row">
              <label class="color-label">${this._t("editor_router_throttle_entities")}</label>
              <input
                type="text"
                class="color-text list-input"
                .value=${(cfg.throttle_entities ?? []).join(", ")}
                placeholder=${discoveredThrottles.join(", ")}
                @change=${(e: Event) => this._throttleChanged((e.target as HTMLInputElement).value)}
              />
            </div>
            <div class="hint">${this._t("editor_router_throttle_hint")}</div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_router_info_entities")}>
          <ha-icon slot="leading-icon" icon="mdi:antenna"></ha-icon>
          <div class="panel-content">
            ${this._renderRows("info_entities", this._infos, this._infoRowSchema())}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_router_check_entities")}>
          <ha-icon slot="leading-icon" icon="mdi:lan-connect"></ha-icon>
          <div class="panel-content">
            ${this._renderRows("check_entities", this._checks, this._checkRowSchema())}
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

        <ha-expansion-panel outlined .header=${this._t("editor_router_reboot")}>
          <ha-icon slot="leading-icon" icon="mdi:restart"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${rebootData}
              .schema=${this._rebootSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            ${cfg.confirm_reboot === false
              ? html`<div class="hint warn">${this._t("editor_router_confirm_reboot_hint")}</div>`
              : nothing}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_colors")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            ${colorRow(this._t("editor_todo_accent_color"), cfg.accent_color, (v) => this._colorChanged("accent_color", v))}
            ${colorRow(this._t("editor_router_ok_color"), cfg.ok_color, (v) => this._colorChanged("ok_color", v))}
            ${colorRow(this._t("editor_router_warn_color"), cfg.warn_color, (v) => this._colorChanged("warn_color", v))}
            ${colorRow(this._t("editor_router_hot_color"), cfg.hot_color, (v) => this._colorChanged("hot_color", v))}
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
        background: rgba(127, 127, 127, 0.14);
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
        background: rgba(127, 127, 127, 0.14);
        color: var(--primary-text-color);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-router-diagnostics-card-editor": M3RouterDiagnosticsCardEditor;
  }
}
