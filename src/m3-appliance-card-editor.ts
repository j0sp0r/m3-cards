import { LitElement, html, css, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  ApplianceBlock,
  ApplianceChipConfig,
  ApplianceSelectConfig,
  HomeAssistant,
  LovelaceCardEditor,
  M3ApplianceCardConfig,
  StatusRule,
} from "./types";
import { DEFAULT_APPLIANCE_RADIUS, DEFAULT_DONE_STATES } from "./const";
import { localize, type TranslationKey } from "./localize";
import {
  colorRow,
  editorStyles,
  fireEvent,
  listRow,
  type SchemaEntry,
} from "./shared/editor-helpers";
import {
  initAppearanceState,
  radiusPresetPatch,
  cornerPresetPatch,
  renderAppearanceSection,
  type AppearanceState,
} from "./shared/appearance-editor";
import {
  notifyActions,
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

/** The four repeatable list sections, which all behave identically. */
type ListField = "sliders" | "selects" | "buttons" | "chips";

interface ListEntry {
  entity?: string;
  color?: string;
  states?: StatusRule[];
  [key: string]: unknown;
}

/** Which single condition a rule carries, derived from the keys it has. */
type ConditionKind = "value" | "regex" | "above" | "below" | "else";

const CONDITION_KEYS: Record<Exclude<ConditionKind, "else">, keyof StatusRule> = {
  value: "value",
  regex: "regex",
  above: "above",
  below: "below",
};

const ALL_BLOCKS: ApplianceBlock[] = ["progress", "sliders", "selects", "buttons", "chips"];

/** Drops the keys a cleared editor field left behind, so card defaults apply again. */
function pruned<T extends object>(value: T): T {
  const out = { ...value } as Record<string, unknown>;
  for (const [k, v] of Object.entries(out)) {
    // `false` and `0` are answers; only a blank is an absence.
    if (v === "" || v === undefined || v === null) delete out[k];
  }
  return out as T;
}

@customElement("m3-appliance-card-editor")
export class M3ApplianceCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3ApplianceCardConfig;
  @state() private _appearance: AppearanceState = {
    showCustomRadius: false,
    showCorners: false,
    cornerCustom: {},
  };
  @state() private _notifyBusy = false;
  @state() private _notifyStatus: "idle" | "success" | "error" = "idle";
  @state() private _notifyDetail = "";

  // ---- notification -----------------------------------------------------------

  private get _cardName(): string {
    const entity = this._config?.entity;
    return (
      this._config?.name ||
      (entity ? (this.hass?.states?.[entity]?.attributes?.friendly_name ?? entity) : "")
    );
  }

  /** A state trigger compares verbatim; the card does not. Emit the usual casings. */
  private _stateVariants(values: string[]): string[] {
    const out = new Set<string>();
    for (const raw of values) {
      const value = raw.trim();
      if (!value) continue;
      const lower = value.toLowerCase();
      out.add(value);
      out.add(lower);
      out.add(lower.charAt(0).toUpperCase() + lower.slice(1));
    }
    return [...out];
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

  /**
   * "Finished" has two witnesses, and the automation listens to both: the
   * status reaching a done state, and the progress reaching 100%. A dryer
   * needs the second — Home Connect holds it at `run` through the anti-crease
   * phase until someone opens the door — and a machine that reports both
   * would announce itself twice, so a run that already notified in the last
   * half hour stays quiet.
   */
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
      const done = this._stateVariants(cfg.done_states ?? DEFAULT_DONE_STATES);
      const cardName = this._cardName;
      const automationId = resolveAutomationId("appliance_done", cfg.notify_automation_id);
      const message = this._t("editor_progress_notify_message").replace("{name}", cardName);
      const triggers: Record<string, unknown>[] = [
        // not_from leaves out a restart or an entity coming back: only a run
        // that ends is announced.
        { trigger: "state", entity_id: cfg.entity, to: done, not_from: ["unavailable", "unknown", ...done] },
      ];
      if (cfg.progress?.percentage_entity) {
        triggers.push({ trigger: "numeric_state", entity_id: cfg.progress.percentage_entity, above: 99 });
      }
      await saveNotifyAutomation(this.hass, {
        id: automationId,
        alias: `${cardName}: ${this._t("editor_progress_notify_alias")}`,
        description: this._t("editor_appliance_notify_description"),
        mode: "single",
        triggers,
        conditions: [
          {
            condition: "template",
            value_template:
              "{{ this.attributes.last_triggered is none or " +
              "(now() - this.attributes.last_triggered).total_seconds() > 1800 }}",
          },
        ],
        actions: notifyActions(targets, cardName, message, {
          title: cfg.notify_title,
          message: cfg.notify_message,
          tokens: { geraet: cardName },
        }),
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

  private _notifySchema(): SchemaEntry[] {
    return [notifyServiceSchema(this.hass), notifyTitleSchema("notify_title"), notifyMessageSchema("notify_message")];
  }

  public setConfig(config: M3ApplianceCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_APPLIANCE_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _emit(config: M3ApplianceCardConfig): void {
    this._config = config;
    fireEvent(this, "config-changed", { config });
  }

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const patch = ev.detail.value as Record<string, unknown>;
    this._emit(pruned({ ...this._config, ...patch }) as M3ApplianceCardConfig);
  }

  /** An empty block list or helper leaves the config rather than staying as `[]` or "". */
  private _foldChanged = (ev: CustomEvent): void => {
    if (!this._config) return;
    const next = { ...this._config, ...(ev.detail.value as Partial<M3ApplianceCardConfig>) };
    if (!next.collapse_blocks?.length) delete next.collapse_blocks;
    if (!next.collapse_state_entity) delete next.collapse_state_entity;
    if (!next.collapsible) delete next.collapsible;
    this._emit(next);
  };

  private _colorChanged(
    field: "accent_color" | "text_color" | "secondary_text_color" | "card_background",
    value: string,
  ): void {
    if (!this._config) return;
    if (value) {
      this._emit({ ...this._config, [field]: value });
    } else {
      const { [field]: _drop, ...rest } = this._config;
      this._emit(rest as M3ApplianceCardConfig);
    }
  }

  // ---- appearance -----------------------------------------------------------

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
      this._emit(rest as M3ApplianceCardConfig);
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

  // ---- the four repeatable lists --------------------------------------------
  // One set of operations for all of them: the sections differ in their schema
  // and nothing else, so a slider row and a chip row are added, patched and
  // removed by the same four methods rather than by sixteen.

  private _list(field: ListField): ListEntry[] {
    return (this._config?.[field] ?? []) as ListEntry[];
  }

  private _setList(field: ListField, list: ListEntry[]): void {
    if (!this._config) return;
    if (list.length === 0) {
      const { [field]: _drop, ...rest } = this._config;
      this._emit(rest as M3ApplianceCardConfig);
      return;
    }
    this._emit({ ...this._config, [field]: list } as M3ApplianceCardConfig);
  }

  private _patchEntry(field: ListField, index: number, patch: Record<string, unknown>): void {
    const list = [...this._list(field)];
    list[index] = pruned({ ...list[index], ...patch });
    this._setList(field, list);
  }

  private _addEntry(field: ListField): void {
    this._setList(field, [...this._list(field), { entity: "" }]);
  }

  private _removeEntry(field: ListField, index: number): void {
    this._setList(
      field,
      this._list(field).filter((_, i) => i !== index),
    );
  }

  private _entryLabel(entry: ListEntry, index: number): string {
    const name = typeof entry.name === "string" ? entry.name : undefined;
    const label = typeof entry.label === "string" ? entry.label : undefined;
    if (name) return name;
    if (label) return label;
    if (entry.entity) {
      return (
        (this.hass?.states[entry.entity]?.attributes.friendly_name as string | undefined) ??
        entry.entity
      );
    }
    return `#${index + 1}`;
  }

  // ---- status rules ---------------------------------------------------------

  private _conditionKind(rule: StatusRule): ConditionKind {
    for (const kind of ["value", "regex", "above", "below"] as const) {
      if (rule[CONDITION_KEYS[kind]] !== undefined) return kind;
    }
    return "else";
  }

  private _ruleSchema(kind: ConditionKind): SchemaEntry[] {
    const condition: SchemaEntry[] =
      kind === "value"
        ? [{ name: "value", selector: { text: {} } }]
        : kind === "regex"
          ? [{ name: "regex", selector: { text: {} } }]
          : kind === "above"
            ? [{ name: "above", selector: { number: { mode: "box", step: "any" } } }]
            : kind === "below"
              ? [{ name: "below", selector: { number: { mode: "box", step: "any" } } }]
              : [];
    return [
      ...condition,
      { name: "label", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
    ];
  }

  /**
   * The rule list UI, shared by the card's own `states` and by every chip's.
   * Both are the same rule shape, so they get the same editor rather than two
   * that can drift apart.
   */
  private _renderRules(
    rules: StatusRule[],
    onChange: (rules: StatusRule[]) => void,
  ): TemplateResult {
    const setCondition = (index: number, kind: ConditionKind): void => {
      const next = [...rules];
      const rule: Record<string, unknown> = { ...next[index] };
      // Exactly one condition key survives a switch. Leaving the old one behind
      // would make the rule match on something the editor no longer shows.
      for (const key of Object.values(CONDITION_KEYS)) delete rule[key];
      if (kind === "value" || kind === "regex") rule[kind] = "";
      else if (kind !== "else") rule[kind] = 0;
      next[index] = rule as StatusRule;
      onChange(next);
    };

    return html`
      <div class="hint">${this._t("editor_appliance_states_hint")}</div>
      ${rules.map((rule, index) => {
        const kind = this._conditionKind(rule);
        return html`
          <div class="rule-block">
            <ha-select
              .label=${this._t("editor_status_rule_condition")}
              .value=${kind}
              naturalMenuWidth
              @selected=${(ev: Event) =>
                setCondition(index, (ev.target as HTMLSelectElement).value as ConditionKind)}
              @closed=${(ev: Event) => ev.stopPropagation()}
            >
              <mwc-list-item value="value">${this._t("editor_status_rule_value")}</mwc-list-item>
              <mwc-list-item value="regex">${this._t("editor_status_rule_regex")}</mwc-list-item>
              <mwc-list-item value="above">${this._t("editor_status_rule_above")}</mwc-list-item>
              <mwc-list-item value="below">${this._t("editor_status_rule_below")}</mwc-list-item>
              <mwc-list-item value="else">${this._t("editor_status_preset_none")}</mwc-list-item>
            </ha-select>
            <ha-form
              .hass=${this.hass}
              .data=${rule}
              .schema=${this._ruleSchema(kind)}
              .computeLabel=${this._computeLabel}
              @value-changed=${(ev: CustomEvent) => {
                const next = [...rules];
                next[index] = pruned({
                  ...next[index],
                  ...(ev.detail.value as Record<string, unknown>),
                }) as StatusRule;
                onChange(next);
              }}
            ></ha-form>
            ${colorRow(this._t("editor_mode_color"), rule.color, (v) => {
              const next = [...rules];
              const { color: _drop, ...rest } = next[index];
              next[index] = v ? { ...rest, color: v } : (rest as StatusRule);
              onChange(next);
            })}
            <ha-button
              class="remove"
              @click=${() => onChange(rules.filter((_, i) => i !== index))}
              >${this._t("editor_appliance_remove")}</ha-button
            >
          </div>
        `;
      })}
      <ha-button raised @click=${() => onChange([...rules, { value: "" }])}
        >${this._t("editor_status_add_rule")}</ha-button
      >
    `;
  }

  // ---- schemas --------------------------------------------------------------

  private _deviceSchema(): SchemaEntry[] {
    return [
      { name: "entity", selector: { entity: {} }, required: true },
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "attribute", selector: { text: {} } },
      { name: "tap_action", selector: { ui_action: {} } },
    ];
  }

  private _progressSchema(): SchemaEntry[] {
    return [
      {
        name: "percentage_entity",
        selector: { entity: { domain: ["sensor", "number", "input_number"] } },
      },
      { name: "remaining_entity", selector: { entity: { domain: ["sensor", "input_datetime"] } } },
      { name: "label", selector: { text: {} } },
    ];
  }

  private _entrySchema(field: ListField): SchemaEntry[] {
    switch (field) {
      case "sliders":
        return [
          { name: "entity", selector: { entity: { domain: ["number", "input_number"] } }, required: true },
          { name: "label", selector: { text: {} } },
          { name: "icon", selector: { icon: {} } },
          { name: "unit", selector: { text: {} } },
          { name: "min", selector: { number: { mode: "box", step: "any" } } },
          { name: "max", selector: { number: { mode: "box", step: "any" } } },
          { name: "step", selector: { number: { mode: "box", step: "any" } } },
        ];
      case "selects":
        return [
          { name: "entity", selector: { entity: { domain: ["select", "input_select"] } }, required: true },
          { name: "label", selector: { text: {} } },
          {
            name: "style",
            selector: {
              select: {
                mode: "dropdown",
                options: [
                  { value: "icon_label", label: this._t("editor_appliance_select_icon_label") },
                  { value: "label", label: this._t("editor_appliance_select_label") },
                  { value: "dropdown", label: this._t("editor_appliance_select_dropdown") },
                ],
              },
            },
          },
        ];
      case "buttons":
        return [
          {
            name: "entity",
            selector: {
              entity: {
                domain: ["button", "input_button", "script", "scene", "switch", "input_boolean", "automation"],
              },
            },
          },
          { name: "name", selector: { text: {} } },
          { name: "icon", selector: { icon: {} } },
          { name: "tap_action", selector: { ui_action: {} } },
        ];
      case "chips":
        return [
          { name: "entity", selector: { entity: {} }, required: true },
          { name: "name", selector: { text: {} } },
          { name: "icon", selector: { icon: {} } },
          { name: "label", selector: { text: {} } },
          { name: "show_state", selector: { boolean: {} } },
          { name: "tap_action", selector: { ui_action: {} } },
        ];
    }
  }

  private _layoutSchema(): SchemaEntry[] {
    return [
      {
        name: "layout",
        selector: {
          select: {
            multiple: true,
            mode: "list",
            options: [
              { value: "progress", label: this._t("editor_appliance_block_progress") },
              { value: "sliders", label: this._t("editor_appliance_block_sliders") },
              { value: "selects", label: this._t("editor_appliance_block_selects") },
              { value: "buttons", label: this._t("editor_appliance_block_buttons") },
              { value: "chips", label: this._t("editor_appliance_block_chips") },
            ],
          },
        },
      },
    ];
  }

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
              { value: "progress", label: this._t("editor_appliance_block_progress") },
              { value: "sliders", label: this._t("editor_appliance_block_sliders") },
              { value: "selects", label: this._t("editor_appliance_block_selects") },
              { value: "buttons", label: this._t("editor_appliance_block_buttons") },
              { value: "chips", label: this._t("editor_appliance_block_chips") },
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
      {
        // Always offered, unlike the progress card's, because here it decides
        // the shape whether or not anything is animating.
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
    ];
  }

  private _computeLabel = (schema: SchemaEntry): string => {
    const map: Record<string, TranslationKey> = {
      entity: "editor_appliance_entity",
      name: "editor_name",
      icon: "editor_icon",
      attribute: "editor_appliance_attribute",
      tap_action: "editor_tap_action",
      percentage_entity: "editor_appliance_percentage_entity",
      remaining_entity: "editor_appliance_remaining_entity",
      label: "editor_appliance_label",
      unit: "editor_appliance_unit",
      min: "editor_appliance_min",
      max: "editor_appliance_max",
      step: "editor_appliance_step",
      style: "editor_appliance_select_style",
      show_state: "editor_appliance_chip_show_state",
      layout: "editor_appliance_layout",
      notify_service: "editor_notify_service",
      notify_title: "editor_notify_title",
      notify_message: "editor_notify_message",
      collapsible: "editor_vacuum_collapsible",
      collapse_blocks: "editor_vacuum_collapse_blocks",
      default_collapsed: "editor_vacuum_default_collapsed",
      collapse_memory: "editor_vacuum_collapse_memory",
      collapse_state_entity: "editor_appliance_collapse_state_entity",
      animation: "editor_progress_animation",
      wave_style: "editor_appliance_wave_style",
      value: "editor_status_rule_value",
      regex: "editor_status_rule_regex",
      above: "editor_status_rule_above",
      below: "editor_status_rule_below",
      glass_background: "editor_glass_background",
    };
    const key = map[schema.name];
    return key ? this._t(key) : schema.name;
  };

  // ---- render ---------------------------------------------------------------

  private _renderList(field: ListField): TemplateResult {
    const list = this._list(field);
    const hint: TranslationKey = (
      {
        sliders: "editor_appliance_sliders_hint",
        selects: "editor_appliance_selects_hint",
        buttons: "editor_appliance_buttons_hint",
        chips: "editor_appliance_chips_hint",
      } as const
    )[field];
    const addLabel: TranslationKey = (
      {
        sliders: "editor_appliance_add_slider",
        selects: "editor_appliance_add_select",
        buttons: "editor_appliance_add_button",
        chips: "editor_appliance_add_chip",
      } as const
    )[field];

    return html`
      <div class="hint">${this._t(hint)}</div>
      ${list.map((entry, index) => {
        const data =
          field === "chips"
            ? { show_state: (entry as ApplianceChipConfig).show_state !== false, ...entry }
            : entry;
        return html`
          <div class="entry-block">
            <div class="entry-title">${this._entryLabel(entry, index)}</div>
            <ha-form
              .hass=${this.hass}
              .data=${data}
              .schema=${this._entrySchema(field)}
              .computeLabel=${this._computeLabel}
              @value-changed=${(ev: CustomEvent) =>
                this._patchEntry(field, index, ev.detail.value as Record<string, unknown>)}
            ></ha-form>
            ${field === "selects"
              ? listRow(
                  this._t("editor_appliance_select_options"),
                  ((entry as ApplianceSelectConfig).options ?? []) as string[],
                  (values) =>
                    this._patchEntry(field, index, { options: values.length ? values : undefined }),
                )
              : nothing}
            ${colorRow(this._t("editor_mode_color"), entry.color, (v) =>
              this._patchEntry(field, index, { color: v }),
            )}
            ${field === "chips"
              ? html`
                  <ha-expansion-panel
                    outlined
                    .header=${this._t("editor_appliance_chip_states")}
                  >
                    <div class="panel-content">
                      ${this._renderRules(entry.states ?? [], (rules) =>
                        this._patchEntry(field, index, {
                          states: rules.length ? rules : undefined,
                        }),
                      )}
                    </div>
                  </ha-expansion-panel>
                `
              : nothing}
            <ha-button class="remove" @click=${() => this._removeEntry(field, index)}
              >${this._t("editor_appliance_remove")}</ha-button
            >
          </div>
        `;
      })}
      <ha-button raised @click=${() => this._addEntry(field)}>${this._t(addLabel)}</ha-button>
    `;
  }

  protected render() {
    if (!this.hass || !this._config) return nothing;
    const cfg = this._config;

    return html`
      <div class="editor">
        <ha-expansion-panel outlined .header=${this._t("editor_appliance_device")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:washing-machine"></ha-icon>
          <div class="panel-content">
            <div class="hint">${this._t("editor_appliance_entity_hint")}</div>
            <ha-form
              .hass=${this.hass}
              .data=${{
                entity: cfg.entity ?? "",
                name: cfg.name ?? "",
                icon: cfg.icon ?? "",
                attribute: cfg.attribute ?? "",
                tap_action: cfg.tap_action,
              }}
              .schema=${this._deviceSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_appliance_popup_hint")}</div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_appliance_states")}>
          <ha-icon slot="leading-icon" icon="mdi:swap-horizontal"></ha-icon>
          <div class="panel-content">
            ${this._renderRules(cfg.states ?? [], (rules) =>
              this._emit(
                rules.length
                  ? { ...cfg, states: rules }
                  : ((({ states: _drop, ...rest }) => rest)(cfg) as M3ApplianceCardConfig),
              ),
            )}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_appliance_progress")}>
          <ha-icon slot="leading-icon" icon="mdi:progress-clock"></ha-icon>
          <div class="panel-content">
            <div class="hint">${this._t("editor_appliance_progress_hint")}</div>
            <ha-form
              .hass=${this.hass}
              .data=${{
                percentage_entity: cfg.progress?.percentage_entity ?? "",
                remaining_entity: cfg.progress?.remaining_entity ?? "",
                label: cfg.progress?.label ?? "",
              }}
              .schema=${this._progressSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${(ev: CustomEvent) => {
                const progress = pruned({
                  ...(cfg.progress ?? {}),
                  ...(ev.detail.value as Record<string, unknown>),
                });
                const hasAny = Object.keys(progress).length > 0;
                this._emit(
                  hasAny
                    ? { ...cfg, progress }
                    : ((({ progress: _drop, ...rest }) => rest)(cfg) as M3ApplianceCardConfig),
                );
              }}
            ></ha-form>
            ${colorRow(this._t("editor_mode_color"), cfg.progress?.color, (v) =>
              this._emit({
                ...cfg,
                progress: pruned({ ...(cfg.progress ?? {}), color: v }),
              }),
            )}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_appliance_sliders")}>
          <ha-icon slot="leading-icon" icon="mdi:tune-variant"></ha-icon>
          <div class="panel-content">${this._renderList("sliders")}</div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_appliance_selects")}>
          <ha-icon slot="leading-icon" icon="mdi:format-list-bulleted"></ha-icon>
          <div class="panel-content">${this._renderList("selects")}</div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_appliance_buttons")}>
          <ha-icon slot="leading-icon" icon="mdi:gesture-tap-button"></ha-icon>
          <div class="panel-content">${this._renderList("buttons")}</div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_appliance_chips")}>
          <ha-icon slot="leading-icon" icon="mdi:card-text-outline"></ha-icon>
          <div class="panel-content">${this._renderList("chips")}</div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_appliance_layout")}>
          <ha-icon slot="leading-icon" icon="mdi:view-dashboard-outline"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${{ layout: cfg.layout ?? ALL_BLOCKS }}
              .schema=${this._layoutSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_appliance_layout_hint")}</div>
            <ha-form
              .hass=${this.hass}
              .data=${{
                collapsible: cfg.collapsible ?? false,
                collapse_blocks: cfg.collapse_blocks ?? [],
                default_collapsed: cfg.default_collapsed ?? false,
                collapse_memory: cfg.collapse_memory ?? "device",
                collapse_state_entity: cfg.collapse_state_entity ?? "",
              }}
              .schema=${this._foldSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._foldChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_appliance_collapse_blocks_hint")}</div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_notify")}>
          <ha-icon slot="leading-icon" icon="mdi:bell-outline"></ha-icon>
          <div class="panel-content">
            <div class="hint">${this._t("editor_appliance_notify_hint")}</div>
            <ha-form
              .hass=${this.hass}
              .data=${{
                notify_service: cfg.notify_service ?? [],
                notify_title: cfg.notify_title ?? "",
                notify_message: cfg.notify_message ?? "",
              }}
              .schema=${this._notifySchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
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

        <ha-expansion-panel outlined .header=${this._t("editor_progress_colors")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            ${colorRow(this._t("editor_clock_accent_color"), cfg.accent_color, (v) =>
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

        <ha-expansion-panel outlined .header=${this._t("editor_progress_animation")}>
          <ha-icon slot="leading-icon" icon="mdi:wave"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${{ animation: cfg.animation ?? "auto", wave_style: cfg.wave_style ?? "wavy" }}
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
          config: cfg,
          defaultRadius: DEFAULT_APPLIANCE_RADIUS,
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
      .entry-block,
      .rule-block {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        border: 1px solid rgba(127, 127, 127, 0.3);
        border-radius: 12px;
      }

      .rule-block {
        border-style: dashed;
      }

      .entry-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--primary-text-color);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      ha-select {
        width: 100%;
      }

      .remove {
        align-self: flex-end;
        --mdc-theme-primary: var(--error-color, #e57368);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-appliance-card-editor": M3ApplianceCardEditor;
  }
}
