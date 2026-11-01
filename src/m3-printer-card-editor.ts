import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, LovelaceCardEditor, M3PrinterCardConfig } from "./types";
import {
  DEFAULT_PRINTER_ICON,
  DEFAULT_PRINTER_RADIUS,
  PRINTER_CAMERA_REFRESH_S,
  PRINTER_FILAMENT_WARN,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import { colorRow, editorStyles, fireEvent, type SchemaEntry } from "./shared/editor-helpers";
import { radiusLabelMap } from "./shared/radius-editor";
import {
  initAppearanceState,
  radiusPresetPatch,
  cornerPresetPatch,
  renderAppearanceSection,
  type AppearanceState,
} from "./shared/appearance-editor";

@customElement("m3-printer-card-editor")
export class M3PrinterCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3PrinterCardConfig;
  @state() private _appearance: AppearanceState = {
    showCustomRadius: false,
    showCorners: false,
    cornerCustom: {},
  };

  public setConfig(config: M3PrinterCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_PRINTER_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _emit(config: M3PrinterCardConfig): void {
    this._config = config;
    fireEvent(this, "config-changed", { config });
  }

  private _deviceSchema(): SchemaEntry[] {
    return [
      { name: "entity", selector: { entity: {} } },
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "tap_action", selector: { ui_action: {} } },
    ];
  }

  private _cameraSchema(): SchemaEntry[] {
    return [
      { name: "camera_entity", selector: { entity: { domain: ["camera", "image"] } } },
      { name: "light_entity", selector: { entity: { domain: ["light", "switch"] } } },
      { name: "show_camera", selector: { boolean: {} } },
      { name: "camera_live", selector: { boolean: {} } },
      {
        name: "camera_refresh",
        selector: { number: { min: 2, max: 120, mode: "box", unit_of_measurement: "s" } },
      },
    ];
  }

  private _displaySchema(): SchemaEntry[] {
    return [
      { name: "show_progress", selector: { boolean: {} } },
      { name: "show_temps", selector: { boolean: {} } },
      { name: "show_speed", selector: { boolean: {} } },
      { name: "show_ams", selector: { boolean: {} } },
      { name: "show_details", selector: { boolean: {} } },
      { name: "strip_extension", selector: { boolean: {} } },
      { name: "confirm_stop", selector: { boolean: {} } },
      { name: "confirm_power_off", selector: { boolean: {} } },
      {
        name: "filament_warn",
        selector: { number: { min: 0, max: 100, mode: "box", unit_of_measurement: "%" } },
      },
    ];
  }

  /** Every discovered entity, overridable. Only worth opening when the
   *  automatic lookup picked the wrong one. */
  private _sensorSchema(): SchemaEntry[] {
    return [
      { name: "stage_entity", selector: { entity: {} } },
      { name: "progress_entity", selector: { entity: { domain: "sensor" } } },
      { name: "remaining_entity", selector: { entity: { domain: "sensor" } } },
      { name: "layer_entity", selector: { entity: { domain: "sensor" } } },
      { name: "total_layers_entity", selector: { entity: { domain: "sensor" } } },
      { name: "job_name_entity", selector: { entity: { domain: "sensor" } } },
      { name: "nozzle_temp_entity", selector: { entity: { domain: "sensor" } } },
      { name: "nozzle_target_entity", selector: { entity: { domain: "sensor" } } },
      { name: "bed_temp_entity", selector: { entity: { domain: "sensor" } } },
      { name: "bed_target_entity", selector: { entity: { domain: "sensor" } } },
      { name: "chamber_temp_entity", selector: { entity: { domain: "sensor" } } },
      { name: "speed_entity", selector: { entity: { domain: "select" } } },
      { name: "speed_state_entity", selector: { entity: { domain: "sensor" } } },
      { name: "start_time_entity", selector: { entity: { domain: "sensor" } } },
      { name: "end_time_entity", selector: { entity: { domain: "sensor" } } },
      { name: "power_entity", selector: { entity: { domain: "sensor" } } },
      { name: "online_entity", selector: { entity: { domain: "binary_sensor" } } },
      { name: "error_entity", selector: { entity: {} } },
    ];
  }

  /**
   * Folding, with the same four keys and the same wording as the vacuum cards
   * — one suite, one way of folding a card.
   */
  private _foldSchema(): SchemaEntry[] {
    return [
      { name: "collapsible", selector: { boolean: {} } },
      {
        name: "collapse_blocks",
        selector: {
          select: {
            multiple: true,
            mode: "list",
            options: [
              { value: "camera", label: this._t("editor_printer_show_camera") },
              { value: "progress", label: this._t("editor_printer_show_progress") },
              { value: "temps", label: this._t("editor_printer_show_temps") },
              { value: "speed", label: this._t("editor_printer_show_speed") },
              { value: "ams", label: this._t("editor_printer_show_ams") },
              { value: "details", label: this._t("editor_printer_show_details") },
              { value: "chips", label: this._t("editor_appliance_block_chips") },
            ],
          },
        },
      },
      { name: "default_collapsed", selector: { boolean: {} } },
      { name: "collapse_state_entity", selector: { entity: { domain: "input_boolean" } } },
      {
        name: "collapse_memory",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "device", label: this._t("editor_printer_collapse_device") },
              { value: "session", label: this._t("editor_printer_collapse_session") },
            ],
          },
        },
      },
    ];
  }

  private _actionSchema(): SchemaEntry[] {
    return [
      { name: "pause_action", selector: { ui_action: {} } },
      { name: "resume_action", selector: { ui_action: {} } },
      { name: "stop_action", selector: { ui_action: {} } },
      { name: "start_action", selector: { ui_action: {} } },
      { name: "files_action", selector: { ui_action: {} } },
      { name: "filament_action", selector: { ui_action: {} } },
      { name: "preheat_action", selector: { ui_action: {} } },
    ];
  }

  private _accessorySchema(): SchemaEntry[] {
    return [
      { name: "entity", selector: { entity: { domain: ["switch", "light", "input_boolean"] } } },
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "power_entity", selector: { entity: { domain: "sensor" } } },
    ];
  }

  private _accessoryChanged(index: number, ev: CustomEvent): void {
    if (!this._config) return;
    const list = [...(this._config.accessories ?? [])];
    const next: Record<string, unknown> = { ...list[index], ...(ev.detail.value as object) };
    for (const key of Object.keys(next)) {
      if (next[key] === "" || next[key] === null) delete next[key];
    }
    list[index] = next as unknown as import("./types").PrinterAccessoryConfig;
    this._emit({ ...this._config, accessories: list });
  }

  private _addAccessory(): void {
    if (!this._config) return;
    this._emit({
      ...this._config,
      accessories: [...(this._config.accessories ?? []), { entity: "" }],
    });
  }

  private _removeAccessory(index: number): void {
    if (!this._config) return;
    const list = (this._config.accessories ?? []).filter((_, i) => i !== index);
    if (list.length) this._emit({ ...this._config, accessories: list });
    else {
      const { accessories: _drop, ...rest } = this._config;
      this._emit(rest as M3PrinterCardConfig);
    }
  }

  /**
   * The state map as YAML.
   *
   * A key/value list of arbitrary strings has no ha-form selector, and
   * inventing a two-column editor for something most people never touch would
   * be more to maintain than it is worth. The hint above it carries the six
   * target names.
   */
  private _stateMapChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const value = ev.detail.value?.state_map;
    if (!value || (typeof value === "object" && Object.keys(value).length === 0)) {
      const { state_map: _drop, ...rest } = this._config;
      this._emit(rest as M3PrinterCardConfig);
      return;
    }
    this._emit({ ...this._config, state_map: value as M3PrinterCardConfig["state_map"] });
  }

  private _computeLabel = (schema: SchemaEntry): string => {
    const labelMap: Record<string, TranslationKey> = {
      entity: "editor_entity",
      name: "editor_name",
      icon: "editor_icon",
      tap_action: "editor_tap_action",
      show_camera: "editor_printer_show_camera",
      camera_live: "editor_printer_camera_live",
      camera_refresh: "editor_printer_camera_refresh",
      show_progress: "editor_printer_show_progress",
      show_temps: "editor_printer_show_temps",
      show_speed: "editor_printer_show_speed",
      show_ams: "editor_printer_show_ams",
      show_details: "editor_printer_show_details",
      collapsible: "editor_printer_collapsible",
      collapse_blocks: "editor_printer_collapse_blocks",
      default_collapsed: "editor_printer_default_collapsed",
      collapse_state_entity: "editor_printer_collapse_entity",
      collapse_memory: "editor_printer_collapse_memory",
      strip_extension: "editor_printer_strip_extension",
      confirm_stop: "editor_printer_confirm_stop",
      confirm_power_off: "editor_printer_confirm_power_off",
      filament_warn: "editor_printer_filament_warn",
      glass_background: "editor_glass_background",
      ...radiusLabelMap,
    };
    const key = labelMap[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const next: Record<string, unknown> = {
      ...this._config,
      ...(ev.detail.value as Record<string, unknown>),
    };
    // A cleared field means "fall back to the automatic lookup", which is the
    // absent key — storing "" would pin the card to an entity that does not
    // exist.
    for (const [key, value] of Object.entries(next)) {
      if (value === "" || value === null) delete next[key];
    }
    // An empty selection means "fold everything", which is the absent key —
    // storing [] would silently make the fold hide nothing at all.
    if (Array.isArray(next.collapse_blocks) && next.collapse_blocks.length === 0) {
      delete next.collapse_blocks;
    }
    this._emit(next as unknown as M3PrinterCardConfig);
  }

  private _colorChanged(
    field: "accent_color" | "text_color" | "secondary_text_color" | "card_background",
    value: string,
  ): void {
    if (!this._config) return;
    if (value) {
      this._emit({ ...this._config, [field]: value });
    } else {
      const { [field]: _removed, ...rest } = this._config;
      this._emit(rest as M3PrinterCardConfig);
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
      this._emit(rest as M3PrinterCardConfig);
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

    const deviceData = {
      entity: cfg.entity ?? "",
      name: cfg.name ?? "",
      icon: cfg.icon ?? "",
      tap_action: cfg.tap_action,
    };
    const cameraData = {
      camera_entity: cfg.camera_entity ?? "",
      light_entity: cfg.light_entity ?? "",
      show_camera: cfg.show_camera ?? true,
      camera_live: cfg.camera_live ?? false,
      camera_refresh: cfg.camera_refresh ?? PRINTER_CAMERA_REFRESH_S,
    };
    const foldData = {
      collapsible: cfg.collapsible ?? false,
      collapse_blocks: cfg.collapse_blocks ?? [],
      default_collapsed: cfg.default_collapsed ?? false,
      collapse_state_entity: cfg.collapse_state_entity ?? "",
      collapse_memory: cfg.collapse_memory ?? "device",
    };
    const displayData = {
      show_progress: cfg.show_progress ?? true,
      show_temps: cfg.show_temps ?? true,
      show_speed: cfg.show_speed ?? true,
      show_ams: cfg.show_ams ?? true,
      show_details: cfg.show_details ?? true,
      strip_extension: cfg.strip_extension ?? true,
      confirm_stop: cfg.confirm_stop ?? true,
      confirm_power_off: cfg.confirm_power_off ?? true,
      filament_warn: cfg.filament_warn ?? PRINTER_FILAMENT_WARN,
    };
    const sensorData = Object.fromEntries(
      this._sensorSchema().map((s) => [
        s.name,
        (cfg as unknown as Record<string, unknown>)[s.name] ?? "",
      ]),
    );
    const actionData = Object.fromEntries(
      this._actionSchema().map((s) => [s.name, (cfg as unknown as Record<string, unknown>)[s.name]]),
    );

    const panel = (
      header: TranslationKey,
      icon: string,
      data: unknown,
      schema: SchemaEntry[],
      hint?: TranslationKey,
      expanded = false,
    ) => html`
      <ha-expansion-panel outlined .header=${this._t(header)} ?expanded=${expanded}>
        <ha-icon slot="leading-icon" icon=${icon}></ha-icon>
        <div class="panel-content">
          <ha-form
            .hass=${this.hass}
            .data=${data}
            .schema=${schema}
            .computeLabel=${this._computeLabel}
            @value-changed=${this._valueChanged}
          ></ha-form>
          ${hint ? html`<div class="hint">${this._t(hint)}</div>` : nothing}
        </div>
      </ha-expansion-panel>
    `;

    return html`
      <div class="editor">
        ${panel("editor_printer_device", DEFAULT_PRINTER_ICON, deviceData, this._deviceSchema(), "editor_printer_entity_hint", true)}
        ${panel("editor_printer_camera", "mdi:cctv", cameraData, this._cameraSchema(), "editor_printer_camera_live_hint")}
        ${panel("editor_printer_display", "mdi:view-dashboard-outline", displayData, this._displaySchema())}
        ${panel("editor_printer_fold", "mdi:unfold-less-horizontal", foldData, this._foldSchema(), "editor_printer_collapse_blocks_hint")}
        ${panel("editor_printer_sensors", "mdi:tune", sensorData, this._sensorSchema(), "editor_printer_sensors_hint")}
        ${panel("editor_printer_actions", "mdi:gesture-tap-button", actionData, this._actionSchema(), "editor_printer_actions_hint")}

        <ha-expansion-panel outlined .header=${this._t("editor_printer_accessories")}>
          <ha-icon slot="leading-icon" icon="mdi:power-plug-outline"></ha-icon>
          <div class="panel-content">
            <div class="hint">${this._t("editor_printer_accessories_hint")}</div>
            ${(cfg.accessories ?? []).map(
              (accessory, index) => html`
                <ha-expansion-panel outlined .header=${accessory.name || accessory.entity || `#${index + 1}`}>
                  <div class="panel-content">
                    <ha-form
                      .hass=${this.hass}
                      .data=${{
                        entity: accessory.entity ?? "",
                        name: accessory.name ?? "",
                        icon: accessory.icon ?? "",
                        power_entity: accessory.power_entity ?? "",
                      }}
                      .schema=${this._accessorySchema()}
                      .computeLabel=${this._computeLabel}
                      @value-changed=${(ev: CustomEvent) => this._accessoryChanged(index, ev)}
                    ></ha-form>
                    <button class="remove-btn" @click=${() => this._removeAccessory(index)}>
                      ${this._t("editor_appliance_remove")}
                    </button>
                  </div>
                </ha-expansion-panel>
              `,
            )}
            <button class="add-btn" @click=${() => this._addAccessory()}>
              <ha-icon icon="mdi:plus"></ha-icon>
            </button>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_printer_states")}>
          <ha-icon slot="leading-icon" icon="mdi:swap-horizontal"></ha-icon>
          <div class="panel-content">
            <div class="hint">${this._t("editor_printer_states_hint")}</div>
            <ha-form
              .hass=${this.hass}
              .data=${{ state_map: cfg.state_map ?? {} }}
              .schema=${[{ name: "state_map", selector: { object: {} } }]}
              .computeLabel=${() => this._t("editor_printer_states")}
              @value-changed=${this._stateMapChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_colors")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            ${colorRow(this._t("editor_search_accent_color"), cfg.accent_color, (v) =>
              this._colorChanged("accent_color", v),
            )}
            ${colorRow(this._t("editor_progress_text_color"), cfg.text_color, (v) =>
              this._colorChanged("text_color", v),
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
          defaultRadius: DEFAULT_PRINTER_RADIUS,
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
    "m3-printer-card-editor": M3PrinterCardEditor;
  }
}
