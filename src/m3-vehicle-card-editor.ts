import { LitElement, html, css, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HaActionConfig,
  HomeAssistant,
  LovelaceCardEditor,
  M3VehicleCardConfig,
  VehicleActionConfig,
  VehicleAlertConfig,
  VehicleBlock,
  VehicleCondition,
  VehicleEnergyConfig,
  VehicleSlot,
} from "./types";
import { DEFAULT_VEHICLE_RADIUS } from "./const";
import { localize, type TranslationKey } from "./localize";
import { colorRow, editorStyles, fireEvent, type SchemaEntry } from "./shared/editor-helpers";
import { chipsEditorStyles, moveChip, renderChipsEditor } from "./shared/info-chips-editor";
import { collapseBlocksFor, keptWhenFolded } from "./shared/collapse-state";
import {
  notifyServiceSchema,
  notifyStyles,
  notifyTitleSchema,
  renderNotifyControls,
  resolveAutomationId,
  saveNotifyAutomation,
  setAutomationEnabled,
} from "./shared/notify-editor";
import { buildVehicleNotifyAutomation, vehicleNotifyReasons } from "./shared/vehicle-notify";
import { VEHICLE_BLOCKS, VEHICLE_DEFAULT_FOLD } from "./shared/vehicle";
import { radiusLabelMap } from "./shared/radius-editor";
import {
  initAppearanceState,
  radiusPresetPatch,
  cornerPresetPatch,
  renderAppearanceSection,
  type AppearanceState,
} from "./shared/appearance-editor";

/** The blocks the fold can take; alerts always stay. */
const FOLDABLE: readonly VehicleBlock[] = ["energy", "chips", "actions", "footer"];

/** One energy or status slot in the editor: its config key, label and picker. */
interface SlotField {
  key: string;
  label: TranslationKey;
  selector: Record<string, unknown>;
}

const NUMERIC = { entity: { filter: [{ domain: "sensor" }, { domain: "number" }, { domain: "input_number" }] } };

const ENERGY_EV: SlotField[] = [
  { key: "battery", label: "editor_vehicle_battery", selector: NUMERIC },
  { key: "range", label: "editor_vehicle_range", selector: NUMERIC },
  { key: "charging", label: "editor_vehicle_charging", selector: { entity: { filter: [{ domain: "binary_sensor" }, { domain: "sensor" }, { domain: "switch" }] } } },
  { key: "plugged", label: "editor_vehicle_plugged", selector: { entity: { filter: [{ domain: "binary_sensor" }, { domain: "sensor" }] } } },
  { key: "charge_power", label: "editor_vehicle_charge_power", selector: { entity: { filter: [{ domain: "sensor", device_class: "power" }] } } },
  { key: "charge_limit", label: "editor_vehicle_charge_limit", selector: NUMERIC },
  { key: "charge_end", label: "editor_vehicle_charge_end", selector: { entity: { filter: [{ domain: "sensor", device_class: "timestamp" }] } } },
];

const ENERGY_FUEL: SlotField[] = [
  { key: "fuel_level", label: "editor_vehicle_fuel_level", selector: NUMERIC },
  { key: "fuel_range", label: "editor_vehicle_fuel_range", selector: NUMERIC },
];

const STATUS: SlotField[] = [
  { key: "lock", label: "editor_vehicle_lock", selector: { entity: { filter: [{ domain: "lock" }, { domain: "binary_sensor", device_class: "lock" }] } } },
  { key: "location", label: "editor_vehicle_location", selector: { entity: { filter: [{ domain: "device_tracker" }, { domain: "person" }, { domain: "sensor" }] } } },
  { key: "last_updated", label: "editor_vehicle_last_updated", selector: { entity: {} } },
];

const LABELS: Record<string, TranslationKey> = {
  name: "editor_name",
  icon: "editor_icon",
  image: "editor_vehicle_image",
  drive: "editor_vehicle_drive",
  tap_action: "editor_tap_action",
  hold_action: "editor_hold_action",
  layout: "editor_vehicle_layout",
  capacity_kwh: "editor_vehicle_capacity",
  stale_after_minutes: "editor_vehicle_stale",
  collapsible: "editor_vacuum_collapsible",
  collapse_keep: "editor_vehicle_fold_keep",
  default_collapsed: "editor_vacuum_default_collapsed",
  collapse_memory: "editor_vacuum_collapse_memory",
  collapse_state_entity: "editor_appliance_collapse_state_entity",
  animation: "editor_progress_animation",
  glass_background: "editor_glass_background",
  notify_charge_done: "editor_vehicle_notify_charge_done",
  notify_low_below: "editor_vehicle_notify_low",
  notify_unlocked_minutes: "editor_vehicle_notify_unlocked",
  notify_plug_time: "editor_vehicle_notify_plug_time",
  notify_plug_below: "editor_vehicle_notify_plug_below",
  notify_title: "editor_appliance_notify_title",
  // action and alert entries
  primary: "editor_vehicle_action_primary",
  entity: "editor_vehicle_action_entity",
  visible_entity: "editor_vehicle_visible_entity",
  visible_value: "editor_vehicle_visible_value",
  text: "editor_vehicle_alert_text",
  severity: "editor_vehicle_alert_severity",
  when_entity: "editor_vehicle_alert_entity",
  when_value: "editor_vehicle_alert_value",
  when_below: "editor_vehicle_alert_below",
  when_above: "editor_vehicle_alert_above",
  when_for: "editor_vehicle_alert_for",
  action_name: "editor_vehicle_alert_action_name",
  action_entity: "editor_vehicle_alert_action_entity",
  action_tap: "editor_vehicle_alert_action_tap",
  ...radiusLabelMap,
};

/** Drops the keys a cleared field left behind, so defaults apply again. */
function prune<T extends object>(value: T): T {
  const out = { ...value } as Record<string, unknown>;
  for (const [k, v] of Object.entries(out)) {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) delete out[k];
  }
  return out as T;
}

/** A condition simple enough for the form: one entity, and at most a value, a threshold and a duration. */
function simpleCondition(when: VehicleCondition | VehicleCondition[] | undefined): VehicleCondition | undefined | false {
  if (when === undefined) return undefined;
  if (Array.isArray(when)) return when.length === 1 ? simpleCondition(when[0]) : false;
  if (when.template !== undefined || when.regex !== undefined || when.attribute !== undefined || Array.isArray(when.value)) {
    return false;
  }
  return when;
}

@customElement("m3-vehicle-card-editor")
export class M3VehicleCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3VehicleCardConfig;
  @state() private _notifyBusy = false;
  @state() private _notifyStatus: "idle" | "success" | "error" = "idle";
  @state() private _notifyDetail = "";
  @state() private _appearance: AppearanceState = { showCustomRadius: false, showCorners: false, cornerCustom: {} };

  public setConfig(config: M3VehicleCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_VEHICLE_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _label = (schema: SchemaEntry): string => {
    const key = LABELS[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _emit(config: M3VehicleCardConfig): void {
    this._config = config;
    fireEvent(this, "config-changed", { config });
  }

  /** Top-level fields from a form; a cleared one goes, so the card's default applies. */
  private _patch(change: Record<string, unknown>): void {
    if (!this._config) return;
    const next = { ...this._config, ...change } as Record<string, unknown>;
    for (const [k, v] of Object.entries(change)) {
      if (v === undefined || v === "" || v === null) delete next[k];
    }
    this._emit(next as unknown as M3VehicleCardConfig);
  }

  // ---- slots ----------------------------------------------------------------------

  /**
   * A slot is an entity id or an object. The picker writes the id; an object
   * the author wrote in YAML keeps its other keys, and a templated one is shown
   * as its template text, since there is no entity to pick.
   */
  private _slotSchema(fields: SlotField[], read: (key: string) => VehicleSlot | undefined): SchemaEntry[] {
    return fields.map((f) => {
      const slot = read(f.key);
      const templated = typeof slot === "object" && slot.template !== undefined;
      return { name: f.key, selector: templated ? { text: { multiline: true } } : f.selector };
    });
  }

  private _slotData(fields: SlotField[], read: (key: string) => VehicleSlot | undefined): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const f of fields) {
      const slot = read(f.key);
      data[f.key] = typeof slot === "string" ? slot : (slot?.template ?? slot?.entity ?? "");
    }
    return data;
  }

  private _slotValue(old: VehicleSlot | undefined, value: string | undefined): VehicleSlot | undefined {
    const v = (value ?? "").trim();
    if (typeof old === "object" && old.template !== undefined) {
      return v ? { ...old, template: v } : undefined;
    }
    if (typeof old === "object") {
      if (!v) return undefined;
      return { ...old, entity: v };
    }
    return v || undefined;
  }

  private _energyChanged = (ev: CustomEvent): void => {
    if (!this._config) return;
    const value = ev.detail.value as Record<string, unknown>;
    const energy: Record<string, unknown> = { ...(this._config.energy ?? {}) };
    for (const f of [...ENERGY_EV, ...ENERGY_FUEL]) {
      if (!(f.key in value)) continue;
      energy[f.key] = this._slotValue(energy[f.key] as VehicleSlot | undefined, value[f.key] as string | undefined);
    }
    if ("capacity_kwh" in value) energy.capacity_kwh = value.capacity_kwh || undefined;
    const cleaned = prune(energy) as VehicleEnergyConfig;
    this._patch({ energy: Object.keys(cleaned).length ? cleaned : undefined });
  };

  private _statusChanged = (ev: CustomEvent): void => {
    if (!this._config) return;
    const value = ev.detail.value as Record<string, unknown>;
    const change: Record<string, unknown> = {};
    for (const f of STATUS) {
      if (f.key in value) {
        change[f.key] = this._slotValue(
          (this._config as unknown as Record<string, VehicleSlot | undefined>)[f.key],
          value[f.key] as string | undefined,
        );
      }
    }
    if ("stale_after_minutes" in value) change.stale_after_minutes = value.stale_after_minutes || undefined;
    this._patch(change);
  };

  // ---- sections ---------------------------------------------------------------------

  private _renderGeneral() {
    const c = this._config!;
    const schema: SchemaEntry[] = [
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "image", selector: { text: {} } },
      {
        name: "drive",
        selector: {
          select: {
            mode: "list",
            options: (["ev", "fuel", "hybrid"] as const).map((d) => ({ value: d, label: this._t(`editor_vehicle_drive_${d}`) })),
          },
        },
      },
      { name: "tap_action", selector: { ui_action: {} } },
      {
        name: "layout",
        selector: {
          select: {
            multiple: true,
            reorder: true,
            mode: "list",
            options: VEHICLE_BLOCKS.map((b) => ({ value: b, label: this._t(`editor_vehicle_block_${b}`) })),
          },
        },
      },
    ];
    return this._panel("editor_vehicle_general", "mdi:car-info", true, html`
      <ha-form
        .hass=${this.hass}
        .data=${{
          name: c.name ?? "",
          icon: c.icon ?? "",
          image: c.image ?? "",
          drive: c.drive ?? "ev",
          tap_action: c.tap_action,
          layout: c.layout ?? [...VEHICLE_BLOCKS],
        }}
        .schema=${schema}
        .computeLabel=${this._label}
        @value-changed=${(ev: CustomEvent) => {
          const v = { ...(ev.detail.value as Record<string, unknown>) };
          if (v.drive === "ev") v.drive = undefined;
          const layout = v.layout as VehicleBlock[] | undefined;
          // The full default list in its default order is no layout at all.
          if (layout && layout.length === VEHICLE_BLOCKS.length && layout.every((b, i) => b === VEHICLE_BLOCKS[i])) {
            v.layout = undefined;
          }
          this._patch(v);
        }}
      ></ha-form>
      <div class="hint">${this._t("editor_vehicle_template_hint")}</div>
    `);
  }

  private _renderEnergy() {
    const c = this._config!;
    const drive = c.drive ?? "ev";
    const energy = (c.energy ?? {}) as Record<string, VehicleSlot | undefined>;
    const fields = [...(drive !== "fuel" ? ENERGY_EV : []), ...(drive !== "ev" ? ENERGY_FUEL : [])];
    const read = (k: string) => energy[k];
    const schema: SchemaEntry[] = [...this._slotSchema(fields, read)];
    if (drive !== "fuel") {
      schema.push({ name: "capacity_kwh", selector: { number: { min: 1, max: 250, step: 0.1, mode: "box", unit_of_measurement: "kWh" } } });
    }
    const labelled = (s: SchemaEntry) => {
      const f = fields.find((x) => x.key === s.name);
      if (!f) return this._label(s);
      const templated = typeof energy[f.key] === "object" && (energy[f.key] as { template?: string }).template !== undefined;
      return templated ? `${this._t(f.label)} · ${this._t("editor_vehicle_template")}` : this._t(f.label);
    };
    return this._panel("editor_vehicle_energy", "mdi:battery-charging-high", false, html`
      <ha-form
        .hass=${this.hass}
        .data=${{ ...this._slotData(fields, read), capacity_kwh: c.energy?.capacity_kwh }}
        .schema=${schema}
        .computeLabel=${labelled}
        @value-changed=${this._energyChanged}
      ></ha-form>
      ${drive !== "fuel" ? html`<div class="hint">${this._t("editor_vehicle_charge_hint")}</div>` : nothing}
    `);
  }

  private _renderStatus() {
    const c = this._config!;
    const read = (k: string) => (c as unknown as Record<string, VehicleSlot | undefined>)[k];
    const schema: SchemaEntry[] = [
      ...this._slotSchema(STATUS, read),
      { name: "stale_after_minutes", selector: { number: { min: 0, max: 10080, step: 5, mode: "box", unit_of_measurement: "min" } } },
    ];
    const labelled = (s: SchemaEntry) => {
      const f = STATUS.find((x) => x.key === s.name);
      return f ? this._t(f.label) : this._label(s);
    };
    return this._panel("editor_vehicle_status", "mdi:map-marker-radius", false, html`
      <ha-form
        .hass=${this.hass}
        .data=${{ ...this._slotData(STATUS, read), stale_after_minutes: c.stale_after_minutes ?? 0 }}
        .schema=${schema}
        .computeLabel=${labelled}
        @value-changed=${this._statusChanged}
      ></ha-form>
    `);
  }

  private _renderChips() {
    const c = this._config!;
    return this._panel("editor_vehicle_chips", "mdi:label-multiple-outline", false, html`
      ${renderChipsEditor({
        hass: this.hass,
        chips: c.chips,
        style: c.chip_style,
        t: (k) => this._t(k),
        computeLabel: this._label,
        onChange: (chips) => this._patch({ chips: chips as M3VehicleCardConfig["chips"] }),
        onStyleChange: (style) => this._patch({ chip_style: style }),
      })}
      <div class="hint">${this._t("editor_vehicle_chips_hint")}</div>
    `);
  }

  // ---- lists: actions and alerts ------------------------------------------------------

  private _listHead(title: string, index: number, length: number, move: (by: -1 | 1) => void): TemplateResult {
    return html`<div class="entry-head">
      <div class="entry-title">${title}</div>
      <ha-icon-button .label=${this._t("editor_vehicle_move_up")} .disabled=${index === 0} @click=${() => move(-1)}
        ><ha-icon icon="mdi:arrow-up"></ha-icon
      ></ha-icon-button>
      <ha-icon-button .label=${this._t("editor_vehicle_move_down")} .disabled=${index === length - 1} @click=${() => move(1)}
        ><ha-icon icon="mdi:arrow-down"></ha-icon
      ></ha-icon-button>
    </div>`;
  }

  private _setActions(list: VehicleActionConfig[]): void {
    this._patch({ actions: list.length ? list : undefined });
  }

  private _renderActions() {
    const list = this._config!.actions ?? [];
    return this._panel("editor_vehicle_actions", "mdi:gesture-tap-button", false, html`
      ${list.map((a, i) => {
        const cond = simpleCondition(a.visible);
        const schema: SchemaEntry[] = [
          { name: "name", selector: { text: {} } },
          { name: "icon", selector: { icon: {} } },
          ...(i === 0 ? [{ name: "primary", selector: { boolean: {} } }] : []),
          { name: "entity", selector: { entity: {} } },
          { name: "tap_action", selector: { ui_action: {} } },
          { name: "hold_action", selector: { ui_action: {} } },
          ...(cond === false
            ? []
            : [
                { name: "visible_entity", selector: { entity: {} } },
                { name: "visible_value", selector: { text: {} } },
              ]),
        ];
        const data = {
          ...a,
          primary: a.primary ?? false,
          visible_entity: cond ? cond.entity : undefined,
          visible_value: cond && typeof cond.value === "string" ? cond.value : undefined,
        };
        return html`<div class="entry-block">
          ${this._listHead(a.name || a.icon || `${this._t("editor_vehicle_action")} ${i + 1}`, i, list.length, (by) => {
            const next = moveChip(list, i, by);
            if (next) this._setActions(next);
          })}
          <ha-form
            .hass=${this.hass}
            .data=${data}
            .schema=${schema}
            .computeLabel=${this._label}
            @value-changed=${(ev: CustomEvent) => {
              const v = { ...(ev.detail.value as Record<string, unknown>) };
              const { visible_entity, visible_value, ...rest } = v as Record<string, unknown> & {
                visible_entity?: string;
                visible_value?: string;
              };
              const item = prune(rest) as unknown as VehicleActionConfig;
              if (!item.primary) delete item.primary;
              if (cond !== false) {
                if (visible_entity) item.visible = prune({ entity: visible_entity, value: visible_value || undefined });
                else delete item.visible;
              }
              const next = [...list];
              next[i] = item;
              this._setActions(next);
            }}
          ></ha-form>
          <ha-button class="remove" @click=${() => this._setActions(list.filter((_, j) => j !== i))}
            >${this._t("editor_vehicle_remove")}</ha-button
          >
        </div>`;
      })}
      <div class="chip-add">
        <ha-button raised @click=${() => this._setActions([...list, { icon: "mdi:gesture-tap", tap_action: { action: "more-info" } }])}
          >${this._t("editor_vehicle_add_action")}</ha-button
        >
      </div>
    `);
  }

  private _setAlerts(list: VehicleAlertConfig[]): void {
    this._patch({ alerts: list.length ? list : undefined });
  }

  private _renderAlerts() {
    const list = this._config!.alerts ?? [];
    return this._panel("editor_vehicle_alerts", "mdi:alert-outline", false, html`
      <div class="hint">${this._t("editor_vehicle_alert_hint")}</div>
      ${list.map((a, i) => {
        const cond = simpleCondition(a.when);
        const schema: SchemaEntry[] = [
          { name: "text", selector: { text: {} } },
          { name: "icon", selector: { icon: {} } },
          {
            name: "severity",
            selector: {
              select: {
                mode: "dropdown",
                options: [
                  { value: "warn", label: this._t("editor_vehicle_alert_warn") },
                  { value: "info", label: this._t("editor_vehicle_alert_info") },
                ],
              },
            },
          },
          ...(cond === false
            ? []
            : [
                { name: "when_entity", selector: { entity: {} } },
                { name: "when_value", selector: { text: {} } },
                { name: "when_below", selector: { number: { mode: "box", step: "any" } } },
                { name: "when_above", selector: { number: { mode: "box", step: "any" } } },
                { name: "when_for", selector: { number: { min: 0, max: 1440, mode: "box", unit_of_measurement: "min" } } },
              ]),
          { name: "action_name", selector: { text: {} } },
          { name: "action_entity", selector: { entity: {} } },
          { name: "action_tap", selector: { ui_action: {} } },
        ];
        const data = {
          text: a.text,
          icon: a.icon,
          severity: a.severity ?? "warn",
          when_entity: cond ? cond.entity : undefined,
          when_value: cond && typeof cond.value === "string" ? cond.value : undefined,
          when_below: cond ? cond.below : undefined,
          when_above: cond ? cond.above : undefined,
          when_for: cond ? cond.for_minutes : undefined,
          action_name: a.action?.name,
          action_entity: a.action?.entity,
          action_tap: a.action?.tap_action,
        };
        return html`<div class="entry-block">
          ${this._listHead(a.text || `${this._t("editor_vehicle_alert")} ${i + 1}`, i, list.length, (by) => {
            const next = moveChip(list, i, by);
            if (next) this._setAlerts(next);
          })}
          <ha-form
            .hass=${this.hass}
            .data=${data}
            .schema=${schema}
            .computeLabel=${this._label}
            @value-changed=${(ev: CustomEvent) => {
              const v = ev.detail.value as Record<string, unknown>;
              const item: VehicleAlertConfig = prune({
                text: (v.text as string) ?? "",
                icon: v.icon as string | undefined,
                severity: v.severity === "info" ? ("info" as const) : undefined,
                when:
                  cond === false
                    ? a.when
                    : prune({
                        entity: v.when_entity as string | undefined,
                        value: (v.when_value as string) || undefined,
                        below: v.when_below as number | undefined,
                        above: v.when_above as number | undefined,
                        for_minutes: (v.when_for as number) || undefined,
                      }),
              }) as VehicleAlertConfig;
              if (!item.when) item.when = {};
              if (v.action_name && v.action_tap) {
                item.action = prune({
                  name: v.action_name as string,
                  entity: v.action_entity as string | undefined,
                  tap_action: v.action_tap as HaActionConfig,
                });
              }
              const next = [...list];
              next[i] = item;
              this._setAlerts(next);
            }}
          ></ha-form>
          <ha-button class="remove" @click=${() => this._setAlerts(list.filter((_, j) => j !== i))}
            >${this._t("editor_vehicle_remove")}</ha-button
          >
        </div>`;
      })}
      <div class="chip-add">
        <ha-button raised @click=${() => this._setAlerts([...list, { when: { below: 20 }, text: "" }])}
          >${this._t("editor_vehicle_add_alert")}</ha-button
        >
      </div>
    `);
  }

  // ---- fold, notify, appearance ---------------------------------------------------------

  private _renderFold() {
    const c = this._config!;
    const schema: SchemaEntry[] = [
      { name: "collapsible", selector: { boolean: {} } },
      ...(c.collapsible
        ? [
            {
              name: "collapse_keep",
              selector: {
                select: {
                  multiple: true,
                  mode: "list",
                  options: FOLDABLE.map((b) => ({ value: b, label: this._t(`editor_vehicle_block_${b}`) })),
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
          ]
        : []),
    ];
    const folds = c.collapse_blocks ?? [...VEHICLE_DEFAULT_FOLD];
    return this._panel("editor_vehicle_fold", "mdi:unfold-less-horizontal", false, html`
      <ha-form
        .hass=${this.hass}
        .data=${{
          collapsible: c.collapsible ?? false,
          collapse_keep: keptWhenFolded(FOLDABLE, folds),
          default_collapsed: c.default_collapsed ?? false,
          collapse_memory: c.collapse_memory ?? "device",
          collapse_state_entity: c.collapse_state_entity ?? "",
        }}
        .schema=${schema}
        .computeLabel=${this._label}
        @value-changed=${(ev: CustomEvent) => {
          const v = { ...(ev.detail.value as Record<string, unknown>) };
          const keep = (v.collapse_keep ?? []) as VehicleBlock[];
          delete v.collapse_keep;
          const blocks = collapseBlocksFor(FOLDABLE, keep) ?? [...FOLDABLE];
          // The default fold needs no key.
          const isDefault = blocks.length === VEHICLE_DEFAULT_FOLD.length && blocks.every((b) => VEHICLE_DEFAULT_FOLD.includes(b));
          v.collapse_blocks = isDefault ? undefined : blocks;
          if (!v.collapsible) {
            v.collapsible = undefined;
            v.collapse_blocks = c.collapse_blocks;
          }
          if (!v.default_collapsed) v.default_collapsed = undefined;
          if (v.collapse_memory === "device") v.collapse_memory = undefined;
          this._patch(v);
        }}
      ></ha-form>
      <div class="hint">${this._t("editor_vehicle_fold_hint")}</div>
    `);
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
      const name = cfg.name || this._t("vehicle_default_name");
      const automationId = resolveAutomationId("vehicle", cfg.notify_automation_id);
      const body = buildVehicleNotifyAutomation(cfg, {
        targets,
        name,
        texts: {
          chargeDone: this._t("vehicle_notify_charge_done"),
          low: this._t("vehicle_notify_low"),
          unlocked: this._t("vehicle_notify_unlocked"),
          plug: this._t("vehicle_notify_plug"),
        },
      });
      await saveNotifyAutomation(this.hass, {
        id: automationId,
        alias: `${name}: ${this._t("editor_vehicle_notify_alias")}`,
        description: this._t("editor_vehicle_notify_description"),
        ...body,
      });
      if (cfg.notify_automation_id !== automationId) this._emit({ ...cfg, notify_automation_id: automationId });
      await setAutomationEnabled(this.hass, automationId, true);
      this._notifyStatus = "success";
    } catch (e) {
      this._notifyStatus = "error";
      this._notifyDetail = e instanceof Error ? e.message : String(e);
    } finally {
      this._notifyBusy = false;
    }
  }

  private _renderNotify() {
    const c = this._config!;
    const electric = (c.drive ?? "ev") !== "fuel";
    const schema: SchemaEntry[] = [
      notifyServiceSchema(this.hass),
      notifyTitleSchema("notify_title"),
      ...(electric ? [{ name: "notify_charge_done", selector: { boolean: {} } }] : []),
      { name: "notify_low_below", selector: { number: { min: 1, max: 99, mode: "box", unit_of_measurement: "%" } } },
      { name: "notify_unlocked_minutes", selector: { number: { min: 1, max: 1440, mode: "box", unit_of_measurement: "min" } } },
      ...(electric
        ? [
            { name: "notify_plug_time", selector: { time: {} } },
            { name: "notify_plug_below", selector: { number: { min: 1, max: 100, mode: "box", unit_of_measurement: "%" } } },
          ]
        : []),
    ];
    const reasons = vehicleNotifyReasons(c);
    const any = Object.values(reasons).some(Boolean);
    return this._panel("editor_notify", "mdi:bell-outline", false, html`
      <div class="hint">${this._t("editor_vehicle_notify_hint")}</div>
      <ha-form
        .hass=${this.hass}
        .data=${{
          notify_service: c.notify_service ?? [],
          notify_title: c.notify_title ?? "",
          notify_charge_done: c.notify_charge_done ?? true,
          notify_low_below: c.notify_low_below,
          notify_unlocked_minutes: c.notify_unlocked_minutes,
          notify_plug_time: c.notify_plug_time,
          notify_plug_below: c.notify_plug_below ?? 50,
        }}
        .schema=${schema}
        .computeLabel=${(s: SchemaEntry) => (s.name === "notify_service" ? this._t("editor_notify") : this._label(s))}
        @value-changed=${async (ev: CustomEvent) => {
          const v = { ...(ev.detail.value as Record<string, unknown>) };
          if (v.notify_charge_done === true) v.notify_charge_done = undefined;
          if (v.notify_plug_below === 50) v.notify_plug_below = undefined;
          if (Array.isArray(v.notify_service) && v.notify_service.length === 0) v.notify_service = undefined;
          this._patch(v);
          if (this._config?.notify_enabled) await this._setupNotify();
        }}
      ></ha-form>
      ${renderNotifyControls({
        hass: this.hass,
        enabled: c.notify_enabled ?? false,
        automationId: c.notify_automation_id,
        blockedReason: !c.notify_service?.length ? this._t("editor_notify_missing") : !any ? this._t("editor_vehicle_notify_hint") : undefined,
        language: this._language,
        busy: this._notifyBusy,
        status: this._notifyStatus,
        detail: this._notifyDetail,
        onToggle: (on) => this._toggleNotify(on),
        onSetup: () => this._setupNotify(),
      })}
    `);
  }

  private _renderAppearance() {
    const c = this._config!;
    const color = (field: "accent_color" | "text_color" | "secondary_text_color" | "card_background", v: string) =>
      this._patch({ [field]: v || undefined });
    return html`
      <ha-expansion-panel outlined .header=${this._t("editor_progress_colors")}>
        <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
        <div class="panel-content">
          ${colorRow(this._t("editor_light_accent_color"), c.accent_color, (v) => color("accent_color", v))}
          ${colorRow(this._t("editor_progress_text_color"), c.text_color, (v) => color("text_color", v))}
          ${colorRow(this._t("editor_progress_secondary_text_color"), c.secondary_text_color, (v) => color("secondary_text_color", v))}
          ${colorRow(this._t("editor_progress_card_background"), c.card_background, (v) => color("card_background", v))}
          <ha-form
            .hass=${this.hass}
            .data=${{ animation: c.animation ?? "auto" }}
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
            .computeLabel=${this._label}
            @value-changed=${(ev: CustomEvent) => {
              const a = (ev.detail.value as { animation?: string }).animation;
              this._patch({ animation: a === "auto" ? undefined : a });
            }}
          ></ha-form>
        </div>
      </ha-expansion-panel>
      ${renderAppearanceSection({
        hass: this.hass!,
        language: this._language,
        config: c,
        defaultRadius: DEFAULT_VEHICLE_RADIUS,
        state: this._appearance,
        computeLabel: this._label,
        onValueChanged: (ev: CustomEvent) => this._patch(ev.detail.value as Record<string, unknown>),
        onRadiusPresetChanged: (ev: CustomEvent) => {
          const patch = radiusPresetPatch(ev.detail.value.radius_preset as string);
          this._appearance = { ...this._appearance, showCustomRadius: patch.showCustomRadius };
          if (patch.radius !== undefined) this._patch({ radius: patch.radius });
        },
        onCornersToggleChanged: (ev: CustomEvent) => {
          const show = ev.detail.value.use_corners as boolean;
          this._appearance = { ...this._appearance, showCorners: show };
          if (!show) this._patch({ corners: undefined });
        },
        onCornerPresetChanged: (key: string, ev: CustomEvent) => {
          const patch = cornerPresetPatch(ev.detail.value[key] as string);
          this._appearance = { ...this._appearance, cornerCustom: { ...this._appearance.cornerCustom, [key]: patch.custom } };
          if (patch.px !== undefined) this._patch({ corners: { ...(this._config?.corners ?? {}), [key]: patch.px } });
        },
        onCornerValueChanged: (key: string, ev: CustomEvent) => {
          this._patch({ corners: { ...(this._config?.corners ?? {}), [key]: ev.detail.value[key] as number } });
        },
      })}
    `;
  }

  private _panel(header: TranslationKey, icon: string, expanded: boolean, body: TemplateResult): TemplateResult {
    return html`<ha-expansion-panel outlined .header=${this._t(header)} ?expanded=${expanded}>
      <ha-icon slot="leading-icon" icon=${icon}></ha-icon>
      <div class="panel-content">${body}</div>
    </ha-expansion-panel>`;
  }

  protected render() {
    if (!this.hass || !this._config) return nothing;
    return html`<div class="editor">
      ${this._renderGeneral()} ${this._renderEnergy()} ${this._renderStatus()} ${this._renderChips()}
      ${this._renderActions()} ${this._renderAlerts()} ${this._renderFold()} ${this._renderNotify()}
      ${this._renderAppearance()}
    </div>`;
  }

  static styles = [
    editorStyles,
    chipsEditorStyles,
    notifyStyles,
    css`
      .entry-block ha-form {
        display: block;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-vehicle-card-editor": M3VehicleCardEditor;
  }
}
