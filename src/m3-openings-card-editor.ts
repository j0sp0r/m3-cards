import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, LovelaceCardEditor, M3OpeningsCardConfig, OpeningsEntityConfig } from "./types";
import {
  DEFAULT_OPENINGS_COLD_BELOW,
  DEFAULT_OPENINGS_MAX_CHIPS,
  DEFAULT_OPENINGS_RADIUS,
  DEFAULT_OPENINGS_WARN_AFTER_MIN,
  OPENINGS_COLOR_CLOSED,
  OPENINGS_COLOR_OPEN,
  OPENINGS_COLOR_WARN,
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
import { discoverOpeningEntities } from "./shared/ha-registry";

type ColorField = "color_open" | "color_warn" | "color_closed" | "text_color" | "secondary_text_color" | "card_background";

const SENSOR_SELECTOR = {
  entity: { domain: "binary_sensor", device_class: ["door", "window", "opening", "garage_door"] },
};

/** Values left out of the YAML rather than written: empty, or the default. */
const DEFAULTS: Record<string, unknown> = {
  warn_after_minutes: DEFAULT_OPENINGS_WARN_AFTER_MIN,
  cold_below: DEFAULT_OPENINGS_COLD_BELOW,
  max_chips: DEFAULT_OPENINGS_MAX_CHIPS,
  animation: "auto",
};

/**
 * The openings card's editor. The sensor panel works as the battery card's
 * does: auto-discovery with area, label and exclusion filters, and a list of
 * entries that are the sensors when discovery is off and only rename or
 * re-icon them when it is on.
 */
@customElement("m3-openings-card-editor")
export class M3OpeningsCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3OpeningsCardConfig;
  @state() private _appearance: AppearanceState = { showCustomRadius: false, showCorners: false, cornerCustom: {} };
  @state() private _discoveredCount?: number;

  public setConfig(config: M3OpeningsCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_OPENINGS_RADIUS);
    void this._refreshCount();
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private get _auto(): boolean {
    return this._config?.auto_discover ?? !this._config?.entities?.length;
  }

  private _emit(config: M3OpeningsCardConfig): void {
    this._config = config;
    fireEvent(this, "config-changed", { config });
    void this._refreshCount();
  }

  private _patch(values: Record<string, unknown>): void {
    if (!this._config) return;
    const next: Record<string, unknown> = { ...this._config };
    for (const [key, value] of Object.entries(values)) {
      const unset =
        value === undefined ||
        value === "" ||
        (Array.isArray(value) && value.length === 0) ||
        (value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length === 0) ||
        DEFAULTS[key] === value;
      if (unset) delete next[key];
      else next[key] = value;
    }
    this._emit(next as unknown as M3OpeningsCardConfig);
  }

  private _valueChanged(ev: CustomEvent): void {
    this._patch(ev.detail.value as Record<string, unknown>);
  }

  private async _refreshCount(): Promise<void> {
    const cfg = this._config;
    if (!this.hass || !cfg || !this._auto) {
      this._discoveredCount = undefined;
      return;
    }
    const ids = await discoverOpeningEntities(this.hass, {
      includeAreas: cfg.include_area,
      includeLabels: cfg.include_label,
      excludeEntities: cfg.exclude_entities,
    });
    this._discoveredCount = ids.length;
  }

  // ---- entries --------------------------------------------------------------

  private get _entries(): OpeningsEntityConfig[] {
    return (this._config?.entities ?? []).map((e) => (typeof e === "string" ? { entity: e } : e));
  }

  /** Writes the list back, keeping the short form for an entry that is only an id. */
  private _setEntries(entries: OpeningsEntityConfig[]): void {
    const list = entries.map((e) => {
      const { entity, ...rest } = e;
      const extra = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined && v !== ""));
      return Object.keys(extra).length ? { entity, ...extra } : entity;
    });
    this._patch({ entities: list.length ? list : undefined });
  }

  private _entryChanged(index: number, ev: CustomEvent): void {
    ev.stopPropagation();
    const entries = [...this._entries];
    entries[index] = { ...(ev.detail.value as OpeningsEntityConfig) };
    this._setEntries(entries);
  }

  private _addEntry(): void {
    this._setEntries([...this._entries, { entity: "" }]);
  }

  private _removeEntry(index: number): void {
    this._setEntries(this._entries.filter((_, i) => i !== index));
  }

  /** Turns what discovery finds into a fixed list, keeping any overrides. */
  private async _toManualList(): Promise<void> {
    const cfg = this._config;
    if (!cfg || !this.hass) return;
    const ids = await discoverOpeningEntities(this.hass, {
      includeAreas: cfg.include_area,
      includeLabels: cfg.include_label,
      excludeEntities: cfg.exclude_entities,
    });
    const byEntity = new Map(this._entries.map((e) => [e.entity, e]));
    const entries = ids.map((id) => byEntity.get(id) ?? { entity: id });
    const { include_area: _a, include_label: _l, exclude_entities: _x, ...rest } = cfg;
    this._config = { ...rest, auto_discover: false };
    this._setEntries(entries);
  }

  // ---- schemas --------------------------------------------------------------

  private _discoverySchema(): SchemaEntry[] {
    const schema: SchemaEntry[] = [{ name: "auto_discover", selector: { boolean: {} } }];
    if (this._auto) {
      schema.push(
        { name: "include_area", selector: { area: { multiple: true } } },
        { name: "include_label", selector: { label: { multiple: true } } },
        { name: "exclude_entities", selector: { entity: { ...SENSOR_SELECTOR.entity, multiple: true } } },
      );
    }
    return schema;
  }

  private _entrySchema(): SchemaEntry[] {
    return [
      { name: "entity", required: true, selector: SENSOR_SELECTOR },
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "tap_action", selector: { ui_action: {} } },
    ];
  }

  private _computeLabel = (schema: SchemaEntry): string => {
    const map: Record<string, TranslationKey> = {
      auto_discover: "editor_battery_auto_discover",
      include_area: "editor_battery_include_area",
      include_label: "editor_battery_include_label",
      exclude_entities: "editor_battery_exclude_entities",
      entity: "editor_entity",
      name: "editor_name",
      icon: "editor_icon",
      title: "editor_openings_title",
      outdoor_temperature: "editor_openings_outdoor_temperature",
      warn_after_minutes: "editor_openings_warn_after_minutes",
      cold_below: "editor_openings_cold_below",
      max_chips: "editor_openings_max_chips",
      tap_action: "editor_tap_action",
      animation: "editor_progress_animation",
      glass_background: "editor_glass_background",
      ...radiusLabelMap,
    };
    const key = map[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _computeHelper = (schema: SchemaEntry): string | undefined => {
    const map: Record<string, TranslationKey> = {
      auto_discover: "editor_openings_auto_discover_helper",
      outdoor_temperature: "editor_openings_outdoor_temperature_helper",
      warn_after_minutes: "editor_openings_warn_after_minutes_helper",
      max_chips: "editor_openings_max_chips_helper",
    };
    const key = map[schema.name];
    return key ? this._t(key) : undefined;
  };

  // ---- colours and appearance ----------------------------------------------

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
      this._emit(rest as M3OpeningsCardConfig);
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

  // ---- render ---------------------------------------------------------------

  private _form(data: Record<string, unknown>, schema: SchemaEntry[]) {
    return html`<ha-form
      .hass=${this.hass}
      .data=${data}
      .schema=${schema}
      .computeLabel=${this._computeLabel}
      .computeHelper=${this._computeHelper}
      @value-changed=${this._valueChanged}
    ></ha-form>`;
  }

  protected render() {
    if (!this.hass || !this._config) return nothing;
    const cfg = this._config;
    const auto = this._auto;

    return html`
      <div class="editor">
        <ha-expansion-panel outlined .header=${this._t("editor_openings_section_sensors")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:window-closed-variant"></ha-icon>
          <div class="panel-content">
            ${this._form(
              {
                auto_discover: auto,
                include_area: cfg.include_area ?? [],
                include_label: cfg.include_label ?? [],
                exclude_entities: cfg.exclude_entities ?? [],
              },
              this._discoverySchema(),
            )}
            ${auto && this._discoveredCount !== undefined
              ? html`<div class="hint">
                  ${this._t("editor_openings_discovered").replace("{n}", String(this._discoveredCount))}
                  <button class="link-btn" @click=${() => this._toManualList()}>${this._t("editor_openings_to_manual")}</button>
                </div>`
              : nothing}
            <div class="sub-heading">
              ${this._t(auto ? "editor_openings_overrides" : "editor_openings_entities")}
            </div>
            ${this._entries.map(
              (entry, index) => html`
                <div class="entry-row">
                  <ha-form
                    .hass=${this.hass}
                    .data=${entry}
                    .schema=${this._entrySchema()}
                    .computeLabel=${this._computeLabel}
                    @value-changed=${(ev: CustomEvent) => this._entryChanged(index, ev)}
                  ></ha-form>
                  <button class="remove-btn" aria-label=${this._t("editor_openings_remove")} @click=${() => this._removeEntry(index)}>
                    <ha-icon icon="mdi:close"></ha-icon>
                  </button>
                </div>
              `,
            )}
            <button class="add-btn" @click=${() => this._addEntry()}>
              <ha-icon icon="mdi:plus"></ha-icon>${this._t("editor_openings_add")}
            </button>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_supply_display")}>
          <ha-icon slot="leading-icon" icon="mdi:view-dashboard-outline"></ha-icon>
          <div class="panel-content">
            ${this._form({ title: cfg.title, icon: cfg.icon, max_chips: cfg.max_chips ?? DEFAULT_OPENINGS_MAX_CHIPS }, [
              { name: "title", selector: { text: {} } },
              { name: "icon", selector: { icon: {} } },
              { name: "max_chips", selector: { number: { min: 0, max: 20, mode: "box" } } },
            ])}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_openings_section_warning")}>
          <ha-icon slot="leading-icon" icon="mdi:thermometer-alert"></ha-icon>
          <div class="panel-content">
            ${this._form(
              {
                outdoor_temperature: cfg.outdoor_temperature,
                warn_after_minutes: cfg.warn_after_minutes ?? DEFAULT_OPENINGS_WARN_AFTER_MIN,
                cold_below: cfg.cold_below ?? DEFAULT_OPENINGS_COLD_BELOW,
              },
              [
                { name: "outdoor_temperature", selector: { entity: { domain: "sensor", device_class: "temperature" } } },
                { name: "warn_after_minutes", selector: { number: { min: 1, max: 240, mode: "box", unit_of_measurement: "min" } } },
                { name: "cold_below", selector: { number: { min: -30, max: 30, step: 0.5, mode: "box" } } },
              ],
            )}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_behavior")}>
          <ha-icon slot="leading-icon" icon="mdi:tune"></ha-icon>
          <div class="panel-content">
            ${this._form({ tap_action: cfg.tap_action }, [{ name: "tap_action", selector: { ui_action: {} } }])}
            <div class="hint">${this._t("editor_openings_tap_hint")}</div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_colors")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            ${colorRow(`${this._t("editor_openings_color_open")} (${OPENINGS_COLOR_OPEN})`, cfg.color_open, (v) => this._colorChanged("color_open", v))}
            ${colorRow(`${this._t("editor_openings_color_warn")} (${OPENINGS_COLOR_WARN})`, cfg.color_warn, (v) => this._colorChanged("color_warn", v))}
            ${colorRow(`${this._t("editor_openings_color_closed")} (${OPENINGS_COLOR_CLOSED})`, cfg.color_closed, (v) => this._colorChanged("color_closed", v))}
            ${colorRow(this._t("editor_progress_text_color"), cfg.text_color, (v) => this._colorChanged("text_color", v))}
            ${colorRow(this._t("editor_progress_secondary_text_color"), cfg.secondary_text_color, (v) => this._colorChanged("secondary_text_color", v))}
            ${colorRow(this._t("editor_progress_card_background"), cfg.card_background, (v) => this._colorChanged("card_background", v))}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_animation")}>
          <ha-icon slot="leading-icon" icon="mdi:wave"></ha-icon>
          <div class="panel-content">
            ${this._form({ animation: cfg.animation ?? "auto" }, [
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
            ])}
            <div class="hint">${this._t("editor_progress_animation_reduced_motion_hint")}</div>
          </div>
        </ha-expansion-panel>

        ${renderAppearanceSection({
          hass: this.hass,
          language: this._language,
          config: cfg,
          defaultRadius: DEFAULT_OPENINGS_RADIUS,
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
      .sub-heading {
        margin-top: 8px;
        font-size: 14px;
        font-weight: 600;
      }
      .entry-row {
        display: flex;
        align-items: flex-start;
        gap: 8px;
      }
      .entry-row ha-form {
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
      .link-btn {
        border: none;
        background: none;
        padding: 0 0 0 4px;
        color: var(--primary-color);
        font: inherit;
        cursor: pointer;
        text-decoration: underline;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-openings-card-editor": M3OpeningsCardEditor;
  }
}
