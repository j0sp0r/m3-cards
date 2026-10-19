import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  LovelaceCardEditor,
  M3WasteCardConfig,
  WasteEntityConfig,
} from "./types";
import { DEFAULT_WASTE_RADIUS } from "./const";
import { localize, type TranslationKey } from "./localize";
import { fireEvent, colorRow, listRow, editorStyles, type SchemaEntry } from "./shared/editor-helpers";
import { radiusLabelMap } from "./shared/radius-editor";
import {
  notifyServiceSchema,
  notifyTitleSchema,
  notifyMessageSchema,
  renderNotifyControls,
  notifyActions,
  notifyTokenHint,
  saveNotifyAutomation,
  resolveAutomationId,
  setAutomationEnabled,
  slugifyForId,
  notifyStyles,
  type NotifyAutomationSpec,
} from "./shared/notify-editor";
import {
  initAppearanceState,
  radiusPresetPatch,
  cornerPresetPatch,
  renderAppearanceSection,
  type AppearanceState,
} from "./shared/appearance-editor";

@customElement("m3-waste-card-editor")
export class M3WasteCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3WasteCardConfig;
  @state() private _appearance: AppearanceState = {
    showCustomRadius: false,
    showCorners: false,
    cornerCustom: {},
  };
  @state() private _notifyBusy = false;
  @state() private _notifyStatus: "idle" | "success" | "error" = "idle";
  @state() private _notifyDetail = "";

  public setConfig(config: M3WasteCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_WASTE_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }
  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }
  private _emit(config: M3WasteCardConfig): void {
    this._config = config;
    fireEvent(this, "config-changed", { config });
  }

  private get _entities(): WasteEntityConfig[] {
    return (this._config?.entities ?? []).map((e) => (typeof e === "string" ? { entity: e } : e));
  }

  private _modeSchema(): SchemaEntry[] {
    const schema: SchemaEntry[] = [
      {
        name: "mode",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "info", label: this._t("editor_waste_mode_info") },
              { value: "reminder", label: this._t("editor_waste_mode_reminder") },
            ],
          },
        },
      },
    ];
    if (this._config?.mode === "reminder") {
      schema.push(
        { name: "reminder_offset", selector: { number: { min: 0, max: 7, mode: "box", unit_of_measurement: "d" } } },
        { name: "reminder_time", selector: { time: {} } },
        { name: "calendar_entity", selector: { entity: { domain: "calendar" } } },
        { name: "ack_entity", selector: { entity: { domain: ["input_boolean", "input_datetime"] } } },
      );
    }
    return schema;
  }

  private _entityRowSchema(): SchemaEntry[] {
    return [
      { name: "entity", required: true, selector: { entity: { domain: "sensor" } } },
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
    ];
  }

  private _discoverSchema(): SchemaEntry[] {
    return [{ name: "auto_discover", selector: { boolean: {} } }];
  }

  private _displaySchema(): SchemaEntry[] {
    return [
      {
        name: "hero_primary",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "days", label: this._t("editor_waste_hero_days") },
              { value: "weekday", label: this._t("editor_waste_hero_weekday") },
            ],
          },
        },
      },
      {
        name: "hero_icon",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "first", label: this._t("editor_waste_icon_first") },
              { value: "multi", label: this._t("editor_waste_icon_multi") },
            ],
          },
        },
      },
      { name: "show_timeline", selector: { boolean: {} } },
      { name: "timeline_days", selector: { number: { min: 7, max: 28, mode: "box", unit_of_measurement: "d" } } },
      { name: "max_rows", selector: { number: { min: 0, max: 20, mode: "box" } } },
    ];
  }

  private _notifySchema(): SchemaEntry[] {
    // The bin picker is offered only once there are bins to pick from;
    // an empty multi-select above the service field is just furniture.
    const bins = this._wasteSensorIds();
    return [
      ...(bins.length > 1
        ? ([
            {
              name: "notify_entities",
              selector: {
                select: {
                  multiple: true,
                  mode: "list" as const,
                  options: bins.map((id) => ({
                    value: id,
                    label: this._nameMap(bins)[id] ?? id,
                  })),
                },
              },
            },
          ] as SchemaEntry[])
        : []),
      notifyServiceSchema(this.hass),
      notifyTitleSchema("notify_title"),
      notifyMessageSchema("notify_message"),
    ];
  }

  /** The bins the reminder watches: the chosen ones, or all of them when
   * nothing is chosen. A choice naming a bin that has since been removed from
   * the card is ignored rather than written into the automation. */
  private _notifyIds(): string[] {
    const all = this._wasteSensorIds();
    const chosen = this._config?.notify_entities;
    if (!chosen?.length) return all;
    const kept = all.filter((id) => chosen.includes(id));
    return kept.length ? kept : all;
  }

  private _wasteSensorIds(): string[] {
    const cfg = this._config;
    if (!cfg || !this.hass) return [];
    const configured = this._entities.map((e) => e.entity).filter(Boolean) as string[];
    if (configured.length) return configured;
    return Object.keys(this.hass.states).filter(
      (id) =>
        id.startsWith("sensor.") &&
        /waste|abfall|m(ü|ue)ll|tonne|collection|abfuhr/i.test(id) &&
        !isNaN(parseFloat(this.hass!.states[id].state)),
    );
  }

  private _nameMap(ids: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    const byEntity = new Map(this._entities.map((e) => [e.entity, e] as const));
    for (const id of ids) {
      const cfg = byEntity.get(id);
      out[id] = cfg?.name || (this.hass?.states[id]?.attributes?.friendly_name as string) || id;
    }
    return out;
  }

  private async _legacyAutomationId(id: string): Promise<string | undefined> {
    try {
      await this.hass!.callApi("GET", `config/automation/config/${id}`);
      return id;
    } catch {
      return undefined;
    }
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
      const ids = this._notifyIds();
      if (ids.length === 0) throw new Error(this._t("editor_waste_notify_empty"));
      const names = this._nameMap(ids);
      const offset = cfg.reminder_offset ?? 1;
      let at = cfg.reminder_time || "18:00";
      if (at.split(":").length === 2) at = `${at}:00`;
      const cardName = cfg.name || this._t("waste_next_label");
      const automationId =
        resolveAutomationId("waste_reminder", cfg.notify_automation_id) ??
        (await this._legacyAutomationId(`m3_waste_${slugifyForId(cardName)}`));
      // Bins due within the reminder offset (today or the day before).
      const dueList =
        "{% set ns = namespace(l=[]) %}{% for e in bins %}" +
        "{% if states(e)|int(99) <= (offset|int) %}{% set ns.l = ns.l + [names[e]] %}{% endif %}" +
        "{% endfor %}{{ ns.l | join(', ') }}";
      const dueCond =
        "{% set ns = namespace(d=false) %}{% for e in bins %}" +
        "{% if states(e)|int(99) <= (offset|int) %}{% set ns.d = true %}{% endif %}" +
        "{% endfor %}{{ ns.d }}";
      const message = this._t("editor_waste_notify_message").replace("{tonnen}", "{tonnen}");
      await saveNotifyAutomation(this.hass, {
        id: automationId,
        alias: `${cardName}: ${this._t("editor_waste_notify_alias")}`,
        description: this._t("editor_waste_notify_description"),
        mode: "single",
        variables: {
          bins: `{{ ${JSON.stringify(ids)} }}`,
          names: `{{ ${JSON.stringify(names)} }}`,
          offset: String(offset),
        },
        triggers: [{ trigger: "time", at }],
        conditions: [{ condition: "template", value_template: dueCond }],
        actions: notifyActions(targets, cardName, message, {
          title: cfg.notify_title,
          message: cfg.notify_message,
          tokens: { tonnen: dueList },
        }),
      } as NotifyAutomationSpec);
      if (cfg.notify_automation_id !== automationId) {
        this._emit({ ...cfg, notify_automation_id: automationId });
      }
      await setAutomationEnabled(this.hass, automationId, true);
      this._notifyStatus = "success";
      this._notifyDetail = `${ids.length}`;
    } catch (e) {
      this._notifyStatus = "error";
      this._notifyDetail = e instanceof Error ? e.message : String(e);
    } finally {
      this._notifyBusy = false;
    }
  }

  private _computeLabel = (schema: SchemaEntry): string => {
    const map: Record<string, TranslationKey> = {
      notify_entities: "editor_waste_notify_entities",
      notify_service: "editor_notify_service",
      notify_title: "editor_notify_title",
      notify_message: "editor_notify_message",
      mode: "editor_waste_mode",
      reminder_offset: "editor_waste_reminder_offset",
      reminder_time: "editor_waste_reminder_time",
      calendar_entity: "editor_waste_calendar_entity",
      ack_entity: "editor_waste_ack_entity",
      auto_discover: "editor_waste_auto_discover",
      entity: "editor_entity",
      name: "editor_name",
      icon: "editor_icon",
      hero_primary: "editor_waste_hero_primary",
      hero_icon: "editor_waste_hero_icon",
      show_timeline: "editor_waste_show_timeline",
      timeline_days: "editor_waste_timeline_days",
      max_rows: "editor_waste_max_rows",
      animation: "editor_progress_animation",
      glass_background: "editor_glass_background",
      ...radiusLabelMap,
    };
    const key = map[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    this._emit({ ...this._config, ...(ev.detail.value as Record<string, unknown>) } as M3WasteCardConfig);
  }

  private _entityChanged(index: number, ev: CustomEvent): void {
    if (!this._config) return;
    const entities = [...this._entities];
    const value = ev.detail.value as WasteEntityConfig;
    entities[index] = {
      entity: value.entity,
      ...(value.name ? { name: value.name } : {}),
      ...(value.icon ? { icon: value.icon } : {}),
      ...(entities[index]?.color ? { color: entities[index].color } : {}),
    };
    this._emit({ ...this._config, entities });
  }
  private _entityColorChanged(index: number, value: string): void {
    if (!this._config) return;
    const entities = [...this._entities];
    const { color: _c, ...rest } = entities[index];
    entities[index] = value ? { ...rest, color: value } : (rest as WasteEntityConfig);
    this._emit({ ...this._config, entities });
  }
  private _addEntity(): void {
    if (!this._config) return;
    this._emit({ ...this._config, entities: [...this._entities, { entity: "" }] });
  }
  private _removeEntity(index: number): void {
    if (!this._config) return;
    this._emit({ ...this._config, entities: this._entities.filter((_, i) => i !== index) });
  }

  private _colorChanged(field: "accent_color" | "text_color" | "secondary_text_color" | "card_background", value: string): void {
    if (!this._config) return;
    if (value) this._emit({ ...this._config, [field]: value });
    else {
      const { [field]: _removed, ...rest } = this._config;
      this._emit(rest as M3WasteCardConfig);
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
      this._emit(rest as M3WasteCardConfig);
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
    const px = ev.detail.value[key] as number;
    this._emit({ ...this._config, corners: { ...(this._config.corners ?? {}), [key]: px } });
  }

  protected render() {
    if (!this.hass || !this._config) return nothing;
    const modeData = {
      mode: this._config.mode ?? "info",
      reminder_offset: this._config.reminder_offset ?? 1,
      reminder_time: this._config.reminder_time ?? "18:00",
      ack_entity: this._config.ack_entity,
    };
    const displayData = {
      hero_primary: this._config.hero_primary ?? "days",
      hero_icon: this._config.hero_icon ?? "first",
      show_timeline: this._config.show_timeline ?? true,
      timeline_days: this._config.timeline_days ?? 14,
      max_rows: this._config.max_rows ?? 0,
    };

    return html`
      <div class="editor">
        <ha-expansion-panel outlined .header=${this._t("editor_waste_mode")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:trash-can-outline"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${modeData}
              .schema=${this._modeSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_waste_mode_hint")}</div>
            ${this._config.mode === "reminder" && !this._config.ack_entity
              ? html`<div class="hint">${this._t("editor_waste_ack_hint")}</div>`
              : nothing}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_waste_bins")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:delete-variant"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${{ auto_discover: this._config.auto_discover ?? true }}
              .schema=${this._discoverSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            ${this._entities.map(
              (e, index) => html`
                <div class="sensor-row">
                  <ha-form
                    .hass=${this.hass}
                    .data=${{ entity: e.entity, name: e.name ?? "", icon: e.icon ?? "" }}
                    .schema=${this._entityRowSchema()}
                    .computeLabel=${this._computeLabel}
                    @value-changed=${(ev: CustomEvent) => this._entityChanged(index, ev)}
                  ></ha-form>
                  <button class="remove-btn" @click=${() => this._removeEntity(index)}>
                    <ha-icon icon="mdi:close"></ha-icon>
                  </button>
                </div>
                ${colorRow(this._t("editor_waste_color"), e.color, (v) => this._entityColorChanged(index, v))}
              `,
            )}
            <button class="add-btn" @click=${() => this._addEntity()}>
              <ha-icon icon="mdi:plus"></ha-icon>
              ${this._t("editor_waste_add_bin")}
            </button>
            ${listRow(
              this._t("editor_occupancy_name_strip"),
              this._config.name_strip ?? [],
              (v) => this._emit({ ...this._config!, name_strip: v }),
            )}
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

        <ha-expansion-panel outlined .header=${this._t("editor_waste_notify")}>
          <ha-icon slot="leading-icon" icon="mdi:bell-outline"></ha-icon>
          <div class="panel-content">
            <div class="hint">${this._t("editor_waste_notify_hint")}</div>
            <div class="hint">${this._t("editor_waste_notify_scope_hint")}</div>
            <ha-form
              .hass=${this.hass}
              .data=${{
                notify_entities: this._config.notify_entities ?? [],
                notify_service: this._config.notify_service ?? [],
                notify_title: this._config.notify_title ?? "",
                notify_message: this._config.notify_message ?? "",
              }}
              .schema=${this._notifySchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${notifyTokenHint(this._language, ["tonnen"])}</div>
            ${renderNotifyControls({
              hass: this.hass,
              language: this._language,
              enabled: this._config.notify_enabled ?? false,
              automationId: this._config.notify_automation_id,
              busy: this._notifyBusy,
              status: this._notifyStatus,
              detail: this._notifyDetail,
              blockedReason: this._config.notify_service?.length ? undefined : this._t("editor_notify_missing"),
              successText: `${this._t("editor_waste_notify_success")} (${this._notifyDetail})`,
              onToggle: (on) => this._toggleNotify(on),
              onSetup: () => this._setupNotify(),
            })}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_colors")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            ${colorRow(this._t("editor_todo_accent_color"), this._config.accent_color, (v) => this._colorChanged("accent_color", v))}
            ${colorRow(this._t("editor_progress_text_color"), this._config.text_color, (v) => this._colorChanged("text_color", v))}
            ${colorRow(this._t("editor_progress_secondary_text_color"), this._config.secondary_text_color, (v) => this._colorChanged("secondary_text_color", v))}
            ${colorRow(this._t("editor_progress_card_background"), this._config.card_background, (v) => this._colorChanged("card_background", v))}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_animation")}>
          <ha-icon slot="leading-icon" icon="mdi:wave"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${{ animation: this._config.animation ?? "auto" }}
              .schema=${[
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
              ]}
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
          defaultRadius: DEFAULT_WASTE_RADIUS,
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
    notifyStyles,
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
        background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
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
        background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
        color: var(--primary-text-color);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-size: 14px;
        font-family: inherit;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-waste-card-editor": M3WasteCardEditor;
  }
}
