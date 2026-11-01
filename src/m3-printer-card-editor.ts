import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, LovelaceCardEditor, M3PrinterCardConfig } from "./types";
import {
  DEFAULT_PRINTER_ICON,
  DEFAULT_PRINTER_RADIUS,
  PRINTER_CAMERA_REFRESH_S,
  PRINTER_FILAMENT_WARN,
} from "./const";
import { collapseBlocksFor, keptWhenFolded } from "./shared/collapse-state";
import { localize, type TranslationKey } from "./localize";
import { colorRow, editorStyles, fireEvent, type SchemaEntry } from "./shared/editor-helpers";
import { chipsEditorStyles, renderChipsEditor } from "./shared/info-chips-editor";
import {
  notifyMessageSchema,
  notifyServiceSchema,
  notifyStyles,
  notifyTitleSchema,
  notifyTokenHint,
  renderNotifyControls,
  resolveAutomationId,
  saveNotifyAutomation,
  setAutomationEnabled,
} from "./shared/notify-editor";
import { buildPrinterNotifyAutomation } from "./shared/printer-notify";
import { discoverPrinter } from "./shared/printer";
import { radiusLabelMap } from "./shared/radius-editor";
import {
  initAppearanceState,
  radiusPresetPatch,
  cornerPresetPatch,
  renderAppearanceSection,
  type AppearanceState,
} from "./shared/appearance-editor";

const PRINTER_FOLD_BLOCKS = ["camera", "progress", "temps", "speed", "ams", "details", "chips"] as const;

@customElement("m3-printer-card-editor")
export class M3PrinterCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3PrinterCardConfig;
  @state() private _notifyBusy = false;
  @state() private _notifyStatus: "idle" | "success" | "error" = "idle";
  @state() private _notifyDetail = "";
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

  // ---- notifications -----------------------------------------------------------

  private get _cardName(): string {
    const entity = this._config?.entity;
    return (
      this._config?.name ||
      (entity ? ((this.hass?.states?.[entity]?.attributes?.friendly_name as string | undefined) ?? entity) : "")
    );
  }

  /** On creates the automation if needed and enables it; off pauses it, so nothing is lost. */
  private async _toggleNotify(enabled: boolean): Promise<void> {
    if (!this._config || !this.hass) return;
    this._emit({ ...this._config, notify_enabled: enabled });
    if (enabled) {
      await this._setupNotify();
      return;
    }
    const id = this._config.notify_automation_id;
    if (id) await setAutomationEnabled(this.hass, id, false);
  }

  /** Writes the automation from the card's config — see shared/printer-notify.ts. */
  private async _setupNotify(): Promise<void> {
    const cfg = this._config;
    if (!this.hass || !cfg) return;
    const targets = cfg.notify_service ?? [];
    if (targets.length === 0) {
      this._notifyStatus = "error";
      this._notifyDetail = this._t("editor_notify_missing");
      return;
    }
    this._notifyBusy = true;
    this._notifyStatus = "idle";
    this._notifyDetail = "";
    try {
      const name = this._cardName;
      const found = discoverPrinter(this.hass, cfg.entity);
      const automationId = resolveAutomationId("printer_done", cfg.notify_automation_id);
      const body = buildPrinterNotifyAutomation({
        entity: cfg.entity,
        stateMap: cfg.state_map,
        targets,
        name,
        doneMessage: this._t("editor_progress_notify_message").replace("{name}", name),
        failedMessage: this._t("editor_printer_notify_failed").replace("{name}", name),
        startMessage: this._t("editor_printer_notify_start_message").replace("{name}", name),
        untilText: this._t("editor_appliance_notify_start_until"),
        title: cfg.notify_title,
        message: cfg.notify_message,
        startText: cfg.notify_start_message,
        onStart: cfg.notify_on_start,
        endEntity: cfg.end_time_entity || found.endTime,
        remainingEntity: cfg.remaining_entity || found.remaining,
      });
      await saveNotifyAutomation(this.hass, {
        id: automationId,
        alias: `${name}: ${this._t("editor_progress_notify_alias")}`,
        description: this._t("editor_printer_notify_description"),
        ...body,
      });
      if (cfg.notify_automation_id !== automationId) {
        this._emit({ ...cfg, notify_automation_id: automationId });
      }
      await setAutomationEnabled(this.hass, automationId, true);
      this._notifyStatus = "success";
    } catch (e) {
      this._notifyStatus = "error";
      this._notifyDetail = e instanceof Error ? e.message : String(e);
    } finally {
      this._notifyBusy = false;
    }
  }

  /** The texts as they read when unchanged, with placeholders, so editing starts from them. */
  private _defaultText(key: "notify_title" | "notify_message" | "notify_start_message"): string {
    switch (key) {
      case "notify_title":
        return "{geraet}";
      case "notify_message":
        return this._t("editor_progress_notify_message").replace("{name}", "{geraet}");
      default:
        return `${this._t("editor_printer_notify_start_message").replace("{name}", "{geraet}")} ${this._t(
          "editor_appliance_notify_start_until",
        )} {ende}.`;
    }
  }

  /** A text left as prefilled, or emptied, leaves the config, so the built-in one applies. */
  private _notifyTextChanged = (ev: CustomEvent): void => {
    if (!this._config) return;
    const next = { ...this._config, ...(ev.detail.value as Partial<M3PrinterCardConfig>) };
    for (const key of ["notify_title", "notify_message", "notify_start_message"] as const) {
      if (!(key in (ev.detail.value as object))) continue;
      const text = (next[key] ?? "").trim();
      if (!text || text === this._defaultText(key)) delete next[key];
    }
    this._emit(next);
  };

  private _startChanged = async (ev: CustomEvent): Promise<void> => {
    if (!this._config) return;
    const on = !!(ev.detail.value as { notify_on_start?: boolean }).notify_on_start;
    const next = { ...this._config };
    if (on) next.notify_on_start = true;
    else delete next.notify_on_start;
    this._emit(next);
    if (next.notify_enabled) await this._setupNotify();
  };

  private _notifyLabel = (schema: SchemaEntry): string =>
    schema.name === "notify_title"
      ? this._t("editor_appliance_notify_title")
      : schema.name === "notify_message"
        ? this._t("editor_appliance_notify_done_text")
        : this._computeLabel(schema);

  private _renderNotify() {
    const cfg = this._config!;
    return html`
      <ha-expansion-panel outlined .header=${this._t("editor_notify")}>
        <ha-icon slot="leading-icon" icon="mdi:bell-outline"></ha-icon>
        <div class="panel-content">
          <div class="hint">${this._t("editor_printer_notify_hint")}</div>
          <ha-form
            .hass=${this.hass}
            .data=${{
              notify_service: cfg.notify_service ?? [],
              notify_title: cfg.notify_title ?? this._defaultText("notify_title"),
              notify_message: cfg.notify_message ?? this._defaultText("notify_message"),
            }}
            .schema=${[notifyServiceSchema(this.hass), notifyTitleSchema("notify_title"), notifyMessageSchema("notify_message")]}
            .computeLabel=${this._notifyLabel}
            @value-changed=${this._notifyTextChanged}
          ></ha-form>
          <ha-form
            .hass=${this.hass}
            .data=${{ notify_on_start: cfg.notify_on_start ?? false }}
            .schema=${[{ name: "notify_on_start", selector: { boolean: {} } }]}
            .computeLabel=${() => this._t("editor_appliance_notify_on_start")}
            @value-changed=${this._startChanged}
          ></ha-form>
          ${cfg.notify_on_start
            ? html`<ha-form
                  .hass=${this.hass}
                  .data=${{ notify_start_message: cfg.notify_start_message ?? this._defaultText("notify_start_message") }}
                  .schema=${[{ name: "notify_start_message", selector: { text: { multiline: true } } }]}
                  .computeLabel=${() => this._t("editor_appliance_notify_start_text")}
                  @value-changed=${this._notifyTextChanged}
                ></ha-form>
                <div class="hint">${this._t("editor_appliance_notify_start_text_hint")}</div>`
            : nothing}
          <div class="hint">${notifyTokenHint(this._language, ["geraet"])}</div>
          ${renderNotifyControls({
            hass: this.hass,
            enabled: cfg.notify_enabled ?? false,
            automationId: cfg.notify_automation_id,
            blockedReason: cfg.notify_service?.length ? undefined : this._t("editor_notify_missing"),
            language: this._language,
            busy: this._notifyBusy,
            status: this._notifyStatus,
            detail: this._notifyDetail,
            onToggle: (on) => this._toggleNotify(on),
            onSetup: () => this._setupNotify(),
          })}
        </div>
      </ha-expansion-panel>
    `;
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
      {
        name: "wave_style",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "wavy", label: this._t("editor_appliance_wave_style_wavy") },
              { value: "flat", label: this._t("editor_appliance_wave_style_flat") },
            ],
          },
        },
      },
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
        name: "collapse_keep",
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

  /** Sets a key, or removes it when the value is empty, so the default applies. */
  private _setOptional<K extends keyof M3PrinterCardConfig>(key: K, value: M3PrinterCardConfig[K] | undefined): void {
    if (!this._config) return;
    if (value === undefined) {
      const { [key]: _drop, ...rest } = this._config;
      this._emit(rest as M3PrinterCardConfig);
      return;
    }
    this._emit({ ...this._config, [key]: value });
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
      stage_entity: "editor_printer_l_stage_entity",
      progress_entity: "editor_printer_l_progress_entity",
      remaining_entity: "editor_printer_l_remaining_entity",
      layer_entity: "editor_printer_l_layer_entity",
      total_layers_entity: "editor_printer_l_total_layers_entity",
      job_name_entity: "editor_printer_l_job_name_entity",
      nozzle_temp_entity: "editor_printer_l_nozzle_temp_entity",
      nozzle_target_entity: "editor_printer_l_nozzle_target_entity",
      bed_temp_entity: "editor_printer_l_bed_temp_entity",
      bed_target_entity: "editor_printer_l_bed_target_entity",
      chamber_temp_entity: "editor_printer_l_chamber_temp_entity",
      speed_entity: "editor_printer_l_speed_entity",
      speed_state_entity: "editor_printer_l_speed_state_entity",
      start_time_entity: "editor_printer_l_start_time_entity",
      end_time_entity: "editor_printer_l_end_time_entity",
      online_entity: "editor_printer_l_online_entity",
      error_entity: "editor_printer_l_error_entity",
      power_entity: "editor_printer_l_power_entity",
      camera_entity: "editor_printer_l_camera_entity",
      light_entity: "editor_printer_l_light_entity",
      pause_action: "editor_printer_l_pause_action",
      resume_action: "editor_printer_l_resume_action",
      stop_action: "editor_printer_l_stop_action",
      start_action: "editor_printer_l_start_action",
      files_action: "editor_printer_l_files_action",
      filament_action: "editor_printer_l_filament_action",
      preheat_action: "editor_printer_l_preheat_action",
      notify_service: "editor_notify_service",
      show_camera: "editor_printer_show_camera",
      camera_live: "editor_printer_camera_live",
      camera_refresh: "editor_printer_camera_refresh",
      show_progress: "editor_printer_show_progress",
      show_temps: "editor_printer_show_temps",
      show_speed: "editor_printer_show_speed",
      show_ams: "editor_printer_show_ams",
      show_details: "editor_printer_show_details",
      wave_style: "editor_appliance_wave_style",
      collapsible: "editor_printer_collapsible",
      collapse_keep: "editor_fold_keep",
      default_collapsed: "editor_printer_default_collapsed",
      collapse_state_entity: "editor_appliance_collapse_state_entity",
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
    // The editor's list is what stays; the config keeps what folds.
    if ("collapse_keep" in next) {
      const blocks = collapseBlocksFor(PRINTER_FOLD_BLOCKS, ((next as Record<string, unknown>).collapse_keep ?? []) as never[]);
      delete (next as Record<string, unknown>).collapse_keep;
      if (blocks) next.collapse_blocks = blocks as never;
      else delete next.collapse_blocks;
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
      collapse_keep: keptWhenFolded(PRINTER_FOLD_BLOCKS, cfg.collapse_blocks),
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
      wave_style: cfg.wave_style ?? "wavy",
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

        <ha-expansion-panel outlined .header=${this._t("editor_appliance_chips")}>
          <ha-icon slot="leading-icon" icon="mdi:card-text-outline"></ha-icon>
          <div class="panel-content">
            ${renderChipsEditor({
              hass: this.hass,
              chips: cfg.chips,
              style: cfg.chip_style,
              t: (k) => this._t(k),
              computeLabel: this._computeLabel,
              onChange: (chips) => this._setOptional("chips", chips),
              onStyleChange: (style) => this._setOptional("chip_style", style),
            })}
          </div>
        </ha-expansion-panel>

        ${this._renderNotify()}

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

  static styles = [editorStyles, notifyStyles, chipsEditorStyles];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-printer-card-editor": M3PrinterCardEditor;
  }
}
