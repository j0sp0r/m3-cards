import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, LovelaceCardEditor, M3VacuumCardConfig } from "./types";
import { DEFAULT_VACUUM_ICON, DEFAULT_VACUUM_RADIUS, VACUUM_MAP_HEIGHT } from "./const";
import { collapseBlocksFor, keptWhenFolded } from "./shared/collapse-state";
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
import { discoverVacuum, supportsFeature } from "./shared/vacuum";
import {
  notifyActions,
  notifyMessageSchema,
  notifyServiceSchema,
  notifyStyles,
  notifySampleEntity,
  notifyTitleSchema,
  notifyTokenHint,
  renderNotifyControls,
  resolveAutomationId,
  saveNotifyAutomation,
  setAutomationEnabled,
  triggerStatePrelude,
} from "./shared/notify-editor";

const VACUUM_FOLD_BLOCKS = ["map", "rooms", "fan_speed", "cleaning_mode", "mop", "buttons", "chips"] as const;

@customElement("m3-vacuum-card-editor")
export class M3VacuumCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3VacuumCardConfig;
  @state() private _notifyBusy = false;
  @state() private _notifyStatus: "idle" | "success" | "error" = "idle";
  @state() private _notifyDetail = "";
  @state() private _appearance: AppearanceState = {
    showCustomRadius: false,
    showCorners: false,
    cornerCustom: {},
  };

  public setConfig(config: M3VacuumCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_VACUUM_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _emit(config: M3VacuumCardConfig): void {
    this._config = config;
    fireEvent(this, "config-changed", { config });
  }

  private _notifySchema(): SchemaEntry[] {
    return [notifyServiceSchema(this.hass), notifyTitleSchema(), notifyMessageSchema()];
  }

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

  /**
   * Builds the automation that reports an error from the vacuum or its dock.
   *
   * Triggered on the error sensors rather than on the vacuum's own `error`
   * state, because those carry the reason — "water_empty" rather than just
   * "something is wrong" — and because the dock's errors never reach the
   * vacuum entity at all.
   *
   * `not_to` on the healthy values means it fires when an error appears and
   * stays quiet while the same one stands, instead of once per poll.
   */
  private async _setupNotify(): Promise<void> {
    const cfg = this._config;
    if (!this.hass || !cfg) return;
    const targets = cfg.notify_service ?? [];
    if (targets.length === 0) {
      this._notifyStatus = "error";
      this._notifyDetail = this._t("editor_vacuum_notify_missing");
      return;
    }
    this._notifyBusy = true;
    this._notifyStatus = "idle";
    this._notifyDetail = "";
    try {
      const found = discoverVacuum(this.hass, cfg.entity);
      const ids = [found.vacuumError, found.dockError].filter(Boolean) as string[];
      if (!ids.length) throw new Error("no error sensors on this vacuum");

      const healthy = ["ok", "none", "unknown", "unavailable"];
      const cardName =
        cfg.name || this.hass.states[cfg.entity]?.attributes.friendly_name || cfg.entity;
      const automationId = resolveAutomationId("vacuum_error", cfg.notify_automation_id);

      await saveNotifyAutomation(this.hass, {
        id: automationId,
        alias: `${cardName}: ${this._t("editor_vacuum_notify_error_alias")}`,
        description: this._t("editor_vacuum_notify_error_description"),
        mode: "single",
        triggers: [{ trigger: "state", entity_id: ids, not_to: healthy }],
        // A restart replays states; without this the first tick after one
        // would announce every error the machine was already in.
        conditions: [
          {
            condition: "template",
            value_template:
              "{{ trigger.from_state is not none and trigger.from_state.state != trigger.to_state.state }}",
          },
        ],
        actions: notifyActions(
          targets,
          cardName,
          this._t("editor_vacuum_notify_error_body")
            .replace("{geraet}", "{{ s.name }}")
            .replace("{fehler}", "{{ s.state }}"),
          {
            title: cfg.notify_title,
            message: cfg.notify_message,
            // A sensor already in an error state makes the better sample for
            // a hand-run than one that is fine.
            prelude: triggerStatePrelude(
              notifySampleEntity(this.hass, ids, (st) => !healthy.includes(st.state)),
            ),
            tokens: { geraet: "{{ s.name }}", fehler: "{{ s.state }}" },
          },
        ),
      });

      this._emit({ ...cfg, notify_automation_id: automationId, notify_enabled: true });
      await setAutomationEnabled(this.hass, automationId, true);
      this._notifyStatus = "success";
    } catch (e) {
      this._notifyStatus = "error";
      this._notifyDetail = String(e).slice(0, 160);
    } finally {
      this._notifyBusy = false;
    }
  }

  private _deviceSchema(): SchemaEntry[] {
    return [
      { name: "entity", selector: { entity: { domain: "vacuum" } } },
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "tap_action", selector: { ui_action: {} } },
    ];
  }

  /**
   * An area picker, because `vacuum.clean_area` takes area ids directly. The
   * card cannot read which of a home's areas the robot actually has a map
   * segment for, so this is the one thing it has to be told.
   */
  private _roomsSchema(): SchemaEntry[] {
    return [{ name: "rooms", selector: { area: { multiple: true } } }];
  }

  private _displaySchema(): SchemaEntry[] {
    return [
      { name: "show_map", selector: { boolean: {} } },
      {
        name: "map_height",
        selector: { number: { min: 120, max: 800, step: 20, mode: "slider", unit_of_measurement: "px" } },
      },
      { name: "map_zoom", selector: { boolean: {} } },
      {
        name: "map_fit",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "plan", label: this._t("editor_vacuum_map_fit_plan") },
              { value: "picture", label: this._t("editor_vacuum_map_fit_picture") },
            ],
          },
        },
      },
      { name: "map_tap_action", selector: { ui_action: {} } },
      { name: "show_fan_speed", selector: { boolean: {} } },
      { name: "show_cleaning_mode", selector: { boolean: {} } },
      { name: "show_mop_intensity", selector: { boolean: {} } },
      { name: "show_mop_mode", selector: { boolean: {} } },
      { name: "show_station_chips", selector: { boolean: {} } },
      { name: "max_chips", selector: { number: { min: 1, max: 10, mode: "box" } } },
    ];
  }

  private _behaviorSchema(): SchemaEntry[] {
    return [
      {
        name: "secondary_actions",
        selector: {
          select: {
            multiple: true,
            mode: "list",
            options: [
              { value: "return_to_base", label: this._t("vacuum_return") },
              { value: "locate", label: this._t("vacuum_locate") },
              { value: "stop", label: this._t("vacuum_stop") },
            ],
          },
        },
      },
      {
        name: "optimistic_timeout",
        selector: { number: { min: 5000, max: 300000, step: 5000, mode: "box", unit_of_measurement: "ms" } },
      },
      { name: "collapsible", selector: { boolean: {} } },
      {
        name: "collapse_keep",
        selector: {
          select: {
            multiple: true,
            mode: "list",
            options: [
              { value: "map", label: this._t("editor_vacuum_show_map") },
              { value: "rooms", label: this._t("vacuum_rooms") },
              { value: "fan_speed", label: this._t("vacuum_fan_speed") },
              { value: "cleaning_mode", label: this._t("vacuum_cleaning_mode") },
              { value: "mop", label: this._t("vacuum_mop_intensity") },
              { value: "buttons", label: this._t("editor_vacuum_buttons") },
              { value: "chips", label: this._t("editor_vacuum_show_chips") },
            ],
          },
        },
      },
      { name: "default_collapsed", selector: { boolean: {} } },
      {
        name: "collapse_memory",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "device", label: this._t("editor_vacuum_collapse_device") },
              { value: "session", label: this._t("editor_vacuum_collapse_session") },
            ],
          },
        },
      },
      { name: "collapse_state_entity", selector: { entity: { domain: "input_boolean" } } },
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
      entity: "editor_entity",
      name: "editor_name",
      icon: "editor_icon",
      tap_action: "editor_tap_action",
      rooms: "editor_vacuum_rooms_field",
      show_map: "editor_vacuum_show_map",
      map_height: "editor_vacuum_map_height",
      map_zoom: "editor_vacuum_map_zoom",
      map_tap_action: "editor_vacuum_map_tap_action",
      map_fit: "editor_vacuum_map_fit",
      show_fan_speed: "editor_vacuum_show_fan_speed",
      show_cleaning_mode: "editor_vacuum_show_cleaning_mode",
      show_mop_intensity: "editor_vacuum_show_mop_intensity",
      show_mop_mode: "editor_vacuum_show_mop_mode",
      show_station_chips: "editor_vacuum_show_chips",
      max_chips: "editor_vacuum_max_chips",
      secondary_actions: "editor_vacuum_secondary",
      optimistic_timeout: "editor_vacuum_optimistic",
      collapsible: "editor_vacuum_collapsible",
      collapse_keep: "editor_fold_keep",
      default_collapsed: "editor_vacuum_default_collapsed",
      collapse_state_entity: "editor_appliance_collapse_state_entity",
      collapse_memory: "editor_vacuum_collapse_memory",
      notify_service: "editor_notify_service",
      notify_title: "editor_notify_title",
      notify_message: "editor_notify_message",
      animation: "editor_progress_animation",
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
    // A cleared field means "use the default", not "show nothing".
    for (const key of ["name", "icon", "collapse_state_entity"]) {
      if (next[key] === "") delete next[key];
    }
    if (Array.isArray(next.rooms) && next.rooms.length === 0) delete next.rooms;
    // The editor's list is what stays; the config keeps what folds.
    if ("collapse_keep" in next) {
      const blocks = collapseBlocksFor(VACUUM_FOLD_BLOCKS, ((next as Record<string, unknown>).collapse_keep ?? []) as never[]);
      delete (next as Record<string, unknown>).collapse_keep;
      if (blocks) next.collapse_blocks = blocks as never;
      else delete next.collapse_blocks;
    }
    this._emit(next as unknown as M3VacuumCardConfig);
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
      this._emit(rest as M3VacuumCardConfig);
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
      this._emit(rest as M3VacuumCardConfig);
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
    const supported = cfg.entity
      ? (this.hass.states[cfg.entity]?.attributes?.supported_features as number | undefined)
      : undefined;

    const deviceData = {
      entity: cfg.entity ?? "",
      name: cfg.name ?? "",
      icon: cfg.icon ?? "",
      tap_action: cfg.tap_action,
    };
    const roomsData = { rooms: cfg.rooms ?? [] };
    const displayData = {
      show_map: cfg.show_map ?? true,
      map_height: cfg.map_height ?? VACUUM_MAP_HEIGHT,
      map_zoom: cfg.map_zoom ?? true,
      map_tap_action: cfg.map_tap_action,
      map_fit: cfg.map_fit ?? "plan",
      show_fan_speed: cfg.show_fan_speed ?? true,
      show_cleaning_mode: cfg.show_cleaning_mode ?? true,
      show_mop_intensity: cfg.show_mop_intensity ?? true,
      show_mop_mode: cfg.show_mop_mode ?? false,
      show_station_chips: cfg.show_station_chips ?? true,
      max_chips: cfg.max_chips ?? 4,
    };
    const notifyData = {
      notify_service: cfg.notify_service ?? [],
      notify_title: cfg.notify_title ?? "",
      notify_message: cfg.notify_message ?? "",
    };
    const behaviorData = {
      secondary_actions: cfg.secondary_actions ?? ["return_to_base", "locate"],
      optimistic_timeout: cfg.optimistic_timeout ?? 70000,
      collapsible: cfg.collapsible ?? false,
      collapse_keep: keptWhenFolded(VACUUM_FOLD_BLOCKS, cfg.collapse_blocks),
      default_collapsed: cfg.default_collapsed ?? false,
      collapse_memory: cfg.collapse_memory ?? "device",
      collapse_state_entity: cfg.collapse_state_entity ?? "",
      animation: cfg.animation ?? "auto",
    };

    return html`
      <div class="editor">
        <ha-expansion-panel outlined .header=${this._t("editor_vacuum_device")} expanded>
          <ha-icon slot="leading-icon" icon=${DEFAULT_VACUUM_ICON}></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${deviceData}
              .schema=${this._deviceSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_vacuum_entity_hint")}</div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_vacuum_rooms")}>
          <ha-icon slot="leading-icon" icon="mdi:floor-plan"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${roomsData}
              .schema=${this._roomsSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("vacuum_rooms_hint")}</div>
            ${cfg.entity && !supportsFeature(supported, "CLEAN_AREA")
              ? html`<div class="hint warn">${this._t("vacuum_rooms_none")}</div>`
              : nothing}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_vacuum_display")}>
          <ha-icon slot="leading-icon" icon="mdi:map-outline"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${displayData}
              .schema=${this._displaySchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_vacuum_map_zoom_hint")}</div>
            <div class="hint">${this._t("editor_vacuum_map_tap_action_hint")}</div>
            <div class="hint">${this._t("editor_vacuum_map_fit_hint")}</div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_vacuum_behavior")}>
          <ha-icon slot="leading-icon" icon="mdi:gesture-tap-button"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${behaviorData}
              .schema=${this._behaviorSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_vacuum_optimistic_hint")}</div>
            <div class="hint">${this._t("editor_vacuum_collapse_blocks_hint")}</div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_vacuum_notify")}>
          <ha-icon slot="leading-icon" icon="mdi:bell-outline"></ha-icon>
          <div class="panel-content">
            ${renderNotifyControls({
              hass: this.hass,
              language: this._language,
              enabled: cfg.notify_enabled ?? false,
              automationId: cfg.notify_automation_id,
              busy: this._notifyBusy,
              status: this._notifyStatus,
              detail: this._notifyDetail,
              onToggle: (enabled) => void this._toggleNotify(enabled),
              onSetup: () => void this._setupNotify(),
            })}
            <ha-form
              .hass=${this.hass}
              .data=${notifyData}
              .schema=${this._notifySchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_vacuum_notify_error_hint")}</div>
            <div class="hint">${notifyTokenHint(this._language, ["geraet", "fehler"])}</div>
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
            ${colorRow(
              this._t("editor_progress_secondary_text_color"),
              cfg.secondary_text_color,
              (v) => this._colorChanged("secondary_text_color", v),
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
          defaultRadius: DEFAULT_VACUUM_RADIUS,
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

  static styles = [editorStyles, notifyStyles];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-vacuum-card-editor": M3VacuumCardEditor;
  }
}
