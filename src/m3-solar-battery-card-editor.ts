import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, LovelaceCardEditor, M3SolarBatteryCardConfig } from "./types";
import {
  DEFAULT_SOLAR_BATTERY_IDLE_W,
  DEFAULT_SOLAR_BATTERY_KW_THRESHOLD,
  DEFAULT_SOLAR_BATTERY_RADIUS,
  SOLAR_BATTERY_TILE_TINT,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import { fireEvent, colorRow, opacityRow, editorStyles, type SchemaEntry } from "./shared/editor-helpers";
import { radiusLabelMap } from "./shared/radius-editor";
import {
  initAppearanceState,
  radiusPresetPatch,
  cornerPresetPatch,
  renderAppearanceSection,
  type AppearanceState,
} from "./shared/appearance-editor";

type ColorField =
  | "solar_color"
  | "battery_color"
  | "house_color"
  | "text_color"
  | "secondary_text_color"
  | "card_background";

type ListKey = "mppt" | "batteries" | "chips";

/** Values the card treats as "not set": left out of the YAML. */
const DEFAULTS: Partial<Record<string, unknown>> = {
  invert: false,
  hide_mppt_without_sun: false,
  show_bar: true,
  show_flow: true,
  show_mppt: true,
  show_forecast: true,
  idle_threshold_w: DEFAULT_SOLAR_BATTERY_IDLE_W,
  kw_threshold: DEFAULT_SOLAR_BATTERY_KW_THRESHOLD,
  animation: "auto",
};

const POWER_SENSOR = { entity: { domain: "sensor", device_class: "power" } };
const NUMBER_ENTITY = { entity: { domain: ["sensor", "number", "input_number"] } };

/**
 * The solar battery card's editor: General, Battery, Power, Solar inputs,
 * More batteries, Chips, then the display switches, colours and the shared
 * appearance section every card has. The three lists are edited row by row —
 * an ha-form per entry with a remove button, and an add button below.
 */
@customElement("m3-solar-battery-card-editor")
export class M3SolarBatteryCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config?: M3SolarBatteryCardConfig;
  @state() private _appearance: AppearanceState = { showCustomRadius: false, showCorners: false, cornerCustom: {} };

  public setConfig(config: M3SolarBatteryCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_SOLAR_BATTERY_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _emit(config: M3SolarBatteryCardConfig): void {
    this._config = config;
    fireEvent(this, "config-changed", { config });
  }

  private _patch(values: Record<string, unknown>): void {
    if (!this._config) return;
    const next: Record<string, unknown> = { ...this._config };
    for (const [key, value] of Object.entries(values)) {
      const unset =
        value === undefined ||
        value === null ||
        value === "" ||
        (Array.isArray(value) && value.length === 0) ||
        DEFAULTS[key] === value;
      if (unset) delete next[key];
      else next[key] = value;
    }
    this._emit(next as unknown as M3SolarBatteryCardConfig);
  }

  private _valueChanged(ev: CustomEvent): void {
    this._patch(ev.detail.value as Record<string, unknown>);
  }

  /** Reserve and limit: an entity or a fixed number, in two fields, one value. */
  private _sourceChanged(ev: CustomEvent): void {
    const v = ev.detail.value as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const key of ["reserve", "charge_limit"] as const) {
      const entity = v[`${key}_entity`] as string | undefined;
      const fixed = v[`${key}_fixed`] as number | undefined;
      const current = this._config?.[key];
      const entityChanged = entity !== (typeof current === "string" ? current : undefined);
      patch[key] = entity && (entityChanged || typeof current === "string") ? entity : typeof fixed === "number" ? fixed : undefined;
    }
    if (patch.charge_limit === 100) patch.charge_limit = undefined;
    if (patch.reserve === 0) patch.reserve = undefined;
    this._patch(patch);
  }

  private _computeLabel = (schema: SchemaEntry): string => {
    const map: Record<string, TranslationKey> = {
      name: "editor_sb_name",
      icon: "editor_sb_chip_icon",
      subtitle: "editor_sb_subtitle",
      mode: "editor_sb_mode",
      soc: "editor_sb_soc",
      capacity_kwh: "editor_sb_capacity",
      reserve_entity: "editor_sb_reserve",
      reserve_fixed: "editor_sb_reserve_fixed",
      charge_limit_entity: "editor_sb_limit",
      charge_limit_fixed: "editor_sb_limit_fixed",
      battery_power: "editor_sb_battery_power",
      invert: "editor_sb_invert",
      charge_power: "editor_sb_charge_power",
      discharge_power: "editor_sb_discharge_power",
      solar_power: "editor_sb_solar_power",
      output_power: "editor_sb_output_power",
      idle_threshold_w: "editor_sb_idle",
      kw_threshold: "editor_sb_kw",
      hide_mppt_without_sun: "editor_sb_hide_mppt",
      show_bar: "editor_sb_show_bar",
      show_flow: "editor_sb_show_flow",
      show_mppt: "editor_sb_show_mppt",
      show_forecast: "editor_sb_show_forecast",
      entity: "editor_sb_entity",
      max_watts: "editor_sb_max_watts",
      template: "editor_sb_chip_template",
      unit: "editor_sb_chip_unit",
      animation: "editor_progress_animation",
      glass_background: "editor_glass_background",
      ...radiusLabelMap,
    };
    const key = map[schema.name];
    return key ? this._t(key) : schema.name;
  };

  // ---- lists ------------------------------------------------------------------

  private _listSchema(key: ListKey): SchemaEntry[] {
    if (key === "mppt") {
      return [
        { name: "entity", selector: POWER_SENSOR },
        { name: "name", selector: { text: {} } },
        { name: "max_watts", selector: { number: { min: 1, max: 5000, step: 10, mode: "box", unit_of_measurement: "W" } } },
      ];
    }
    if (key === "batteries") {
      return [
        { name: "soc", selector: { entity: { domain: "sensor" } } },
        { name: "capacity_kwh", selector: { number: { min: 0, max: 100, step: 0.01, mode: "box", unit_of_measurement: "kWh" } } },
        { name: "name", selector: { text: {} } },
      ];
    }
    return [
      { name: "entity", selector: { entity: {} } },
      { name: "template", selector: { text: {} } },
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "unit", selector: { text: {} } },
    ];
  }

  private _listItems(key: ListKey): Record<string, unknown>[] {
    return ((this._config?.[key] as unknown as Record<string, unknown>[] | undefined) ?? []).map((x) => ({ ...x }));
  }

  private _writeList(key: ListKey, items: Record<string, unknown>[]): void {
    const cleaned = items.map((item) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(item)) if (v !== undefined && v !== "" && v !== null) out[k] = v;
      return out;
    });
    this._patch({ [key]: cleaned });
  }

  private _itemChanged(key: ListKey, index: number, ev: CustomEvent): void {
    const items = this._listItems(key);
    items[index] = { ...items[index], ...(ev.detail.value as Record<string, unknown>) };
    this._writeList(key, items);
  }

  private _remove(key: ListKey, index: number): void {
    const items = this._listItems(key);
    items.splice(index, 1);
    this._writeList(key, items);
  }

  private _add(key: ListKey): void {
    // An empty entry stays in the YAML until filled; the card skips it.
    const items = this._listItems(key);
    items.push(key === "batteries" ? { soc: "" } : key === "mppt" ? { entity: "" } : { entity: "" });
    if (!this._config) return;
    this._emit({ ...this._config, [key]: items } as M3SolarBatteryCardConfig);
  }

  private _renderList(key: ListKey, hint: TranslationKey) {
    const items = this._listItems(key);
    const labelFor = (schema: SchemaEntry): string =>
      schema.name === "soc"
        ? this._t("editor_sb_extra_soc")
        : schema.name === "capacity_kwh"
          ? this._t("editor_sb_extra_capacity")
          : this._computeLabel(schema);
    return html`
      <div class="hint">${this._t(hint)}</div>
      ${items.map(
        (item, i) => html`
          <div class="list-item">
            <ha-form
              .hass=${this.hass}
              .data=${item}
              .schema=${this._listSchema(key)}
              .computeLabel=${labelFor}
              @value-changed=${(ev: CustomEvent) => this._itemChanged(key, i, ev)}
            ></ha-form>
            <button class="remove" aria-label=${this._t("editor_sb_remove")} @click=${() => this._remove(key, i)}>
              <ha-icon icon="mdi:delete-outline"></ha-icon>
            </button>
          </div>
        `,
      )}
      <button class="add" @click=${() => this._add(key)}>
        <ha-icon icon="mdi:plus"></ha-icon>${this._t("editor_sb_add")}
      </button>
    `;
  }

  // ---- colours & appearance ------------------------------------------------------

  private _colorChanged(field: ColorField, value: string): void {
    this._patch({ [field]: value || undefined });
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
      this._emit(rest as M3SolarBatteryCardConfig);
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

  // ---- render -----------------------------------------------------------------

  private _form(data: Record<string, unknown>, schema: SchemaEntry[], handler = this._valueChanged) {
    return html`<ha-form
      .hass=${this.hass}
      .data=${data}
      .schema=${schema}
      .computeLabel=${this._computeLabel}
      @value-changed=${handler.bind(this)}
    ></ha-form>`;
  }

  protected render() {
    if (!this.hass || !this._config) return html``;
    const cfg = this._config;
    return html`
      <div class="editor">
        <ha-expansion-panel outlined expanded .header=${this._t("editor_sb_general")}>
          <ha-icon slot="leading-icon" icon="mdi:home-battery-outline"></ha-icon>
          <div class="panel-content">
            ${this._form(
              { name: cfg.name ?? "", icon: cfg.icon ?? "", subtitle: cfg.subtitle ?? "", mode: cfg.mode ?? "" },
              [
                { name: "name", selector: { text: {} } },
                { name: "icon", selector: { icon: {} } },
                { name: "mode", selector: { entity: { domain: ["sensor", "select", "input_select"] } } },
                { name: "subtitle", selector: { text: {} } },
              ],
            )}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined expanded .header=${this._t("editor_sb_battery")}>
          <ha-icon slot="leading-icon" icon="mdi:battery-70"></ha-icon>
          <div class="panel-content">
            ${this._form({ soc: cfg.soc ?? "", capacity_kwh: cfg.capacity_kwh }, [
              { name: "soc", required: true, selector: { entity: { domain: "sensor" } } },
              { name: "capacity_kwh", selector: { number: { min: 0, max: 100, step: 0.01, mode: "box", unit_of_measurement: "kWh" } } },
            ])}
            ${this._form(
              {
                reserve_entity: typeof cfg.reserve === "string" ? cfg.reserve : "",
                reserve_fixed: typeof cfg.reserve === "number" ? cfg.reserve : undefined,
                charge_limit_entity: typeof cfg.charge_limit === "string" ? cfg.charge_limit : "",
                charge_limit_fixed: typeof cfg.charge_limit === "number" ? cfg.charge_limit : undefined,
              },
              [
                { name: "reserve_entity", selector: NUMBER_ENTITY },
                { name: "reserve_fixed", selector: { number: { min: 0, max: 100, step: 1, mode: "box", unit_of_measurement: "%" } } },
                { name: "charge_limit_entity", selector: NUMBER_ENTITY },
                { name: "charge_limit_fixed", selector: { number: { min: 0, max: 100, step: 1, mode: "box", unit_of_measurement: "%" } } },
              ],
              this._sourceChanged,
            )}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_sb_power")}>
          <ha-icon slot="leading-icon" icon="mdi:flash-outline"></ha-icon>
          <div class="panel-content">
            ${this._form(
              {
                battery_power: cfg.battery_power ?? "",
                invert: cfg.invert ?? false,
                charge_power: cfg.charge_power ?? "",
                discharge_power: cfg.discharge_power ?? "",
                solar_power: cfg.solar_power ?? "",
                output_power: cfg.output_power ?? "",
                idle_threshold_w: cfg.idle_threshold_w ?? DEFAULT_SOLAR_BATTERY_IDLE_W,
                kw_threshold: cfg.kw_threshold ?? DEFAULT_SOLAR_BATTERY_KW_THRESHOLD,
              },
              [
                { name: "battery_power", selector: POWER_SENSOR },
                { name: "invert", selector: { boolean: {} } },
                { name: "charge_power", selector: POWER_SENSOR },
                { name: "discharge_power", selector: POWER_SENSOR },
                { name: "solar_power", selector: POWER_SENSOR },
                { name: "output_power", selector: POWER_SENSOR },
                { name: "idle_threshold_w", selector: { number: { min: 0, max: 500, step: 1, mode: "box", unit_of_measurement: "W" } } },
                { name: "kw_threshold", selector: { number: { min: 100, max: 100000, step: 100, mode: "box", unit_of_measurement: "W" } } },
              ],
            )}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_sb_inputs")}>
          <ha-icon slot="leading-icon" icon="mdi:solar-panel"></ha-icon>
          <div class="panel-content">
            ${this._form({ hide_mppt_without_sun: cfg.hide_mppt_without_sun ?? false }, [
              { name: "hide_mppt_without_sun", selector: { boolean: {} } },
            ])}
            ${this._renderList("mppt", "editor_sb_inputs_hint")}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_sb_extras")}>
          <ha-icon slot="leading-icon" icon="mdi:battery-plus-outline"></ha-icon>
          <div class="panel-content">${this._renderList("batteries", "editor_sb_extras_hint")}</div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_sb_chips")}>
          <ha-icon slot="leading-icon" icon="mdi:label-multiple-outline"></ha-icon>
          <div class="panel-content">${this._renderList("chips", "editor_sb_chips_hint")}</div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_sb_display")}>
          <ha-icon slot="leading-icon" icon="mdi:view-dashboard-outline"></ha-icon>
          <div class="panel-content">
            ${this._form(
              {
                show_bar: cfg.show_bar ?? true,
                show_flow: cfg.show_flow ?? true,
                show_mppt: cfg.show_mppt ?? true,
                show_forecast: cfg.show_forecast ?? true,
              },
              [
                { name: "show_bar", selector: { boolean: {} } },
                { name: "show_flow", selector: { boolean: {} } },
                { name: "show_mppt", selector: { boolean: {} } },
                { name: "show_forecast", selector: { boolean: {} } },
              ],
            )}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_sb_colors")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            ${colorRow(this._t("editor_sb_solar_color"), cfg.solar_color, (v) => this._colorChanged("solar_color", v))}
            ${colorRow(this._t("editor_sb_battery_color"), cfg.battery_color, (v) => this._colorChanged("battery_color", v))}
            ${colorRow(this._t("editor_sb_house_color"), cfg.house_color, (v) => this._colorChanged("house_color", v))}
            ${opacityRow(this._t("editor_summary_flow_tint_opacity"), cfg.flow_tint_opacity, SOLAR_BATTERY_TILE_TINT, (v) =>
              this._patch({ flow_tint_opacity: v === SOLAR_BATTERY_TILE_TINT ? undefined : v }),
            )}
            ${colorRow(this._t("editor_progress_text_color"), cfg.text_color, (v) => this._colorChanged("text_color", v))}
            ${colorRow(this._t("editor_progress_secondary_text_color"), cfg.secondary_text_color, (v) => this._colorChanged("secondary_text_color", v))}
            ${colorRow(this._t("editor_progress_card_background"), cfg.card_background, (v) => this._colorChanged("card_background", v))}
          </div>
        </ha-expansion-panel>

        ${renderAppearanceSection({
          hass: this.hass,
          language: this._language,
          config: cfg,
          defaultRadius: DEFAULT_SOLAR_BATTERY_RADIUS,
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
      .list-item {
        display: flex;
        align-items: flex-start;
        gap: 4px;
        padding: 8px;
        margin-top: 8px;
        border-radius: 12px;
        background: color-mix(in srgb, var(--primary-text-color) 5%, transparent);
      }

      .list-item ha-form {
        flex: 1;
        min-width: 0;
      }

      .remove {
        border: none;
        background: none;
        color: var(--primary-text-color);
        width: 36px;
        height: 36px;
        border-radius: 18px;
        cursor: pointer;
        flex-shrink: 0;
        --mdc-icon-size: 20px;
      }

      .add {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-top: 10px;
        height: 36px;
        padding: 0 14px;
        border: 1px solid var(--divider-color);
        border-radius: 18px;
        background: none;
        color: var(--primary-color);
        font: inherit;
        cursor: pointer;
        --mdc-icon-size: 18px;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-solar-battery-card-editor": M3SolarBatteryCardEditor;
  }
}
