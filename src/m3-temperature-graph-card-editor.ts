import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, LovelaceCardEditor, M3TemperatureGraphCardConfig, TempGraphEntityConfig } from "./types";
import {
  DEFAULT_TEMP_GRAPH_DECIMALS,
  DEFAULT_TEMP_GRAPH_HEIGHT,
  DEFAULT_TEMP_GRAPH_RADIUS,
  DEFAULT_TEMP_GRAPH_RANGES,
  TEMP_GRAPH_PALETTE_TONAL,
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
import { TEMP_GRAPH_RANGES, resolveFocus, resolveRanges } from "./shared/temperature-graph";

type ColorField = "accent_color" | "text_color" | "secondary_text_color" | "card_background";

const SENSOR_SELECTOR = { entity: { domain: "sensor", device_class: "temperature" } };

/** Values left out of the YAML rather than written: empty, or the default. */
const DEFAULTS: Record<string, unknown> = {
  decimals: DEFAULT_TEMP_GRAPH_DECIMALS,
  height: DEFAULT_TEMP_GRAPH_HEIGHT,
  show_extremes: true,
  summary: "mean",
  animation: "auto",
};

/**
 * The temperature graph card's editor: the sensors as a list that can be
 * added to, reordered and renamed, each with its own colour, and the card's
 * options below. Sensors in another unit than the first are flagged at the
 * top, since the card leaves them out of the graph.
 */
@customElement("m3-temperature-graph-card-editor")
export class M3TemperatureGraphCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3TemperatureGraphCardConfig;
  @state() private _appearance: AppearanceState = { showCustomRadius: false, showCorners: false, cornerCustom: {} };

  public setConfig(config: M3TemperatureGraphCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_TEMP_GRAPH_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _emit(config: M3TemperatureGraphCardConfig): void {
    this._config = config;
    fireEvent(this, "config-changed", { config });
  }

  private _patch(values: Record<string, unknown>): void {
    if (!this._config) return;
    const next: Record<string, unknown> = { ...this._config };
    for (const [key, value] of Object.entries(values)) {
      const unset =
        value === undefined ||
        value === "" ||
        (Array.isArray(value) && value.length === 0 && key !== "entities") ||
        (value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length === 0) ||
        DEFAULTS[key] === value;
      if (unset) delete next[key];
      else next[key] = value;
    }
    this._emit(next as unknown as M3TemperatureGraphCardConfig);
  }

  private _valueChanged(ev: CustomEvent): void {
    const value = { ...(ev.detail.value as Record<string, unknown>) };
    // The default range and focus are stored only when they differ from what
    // the card would pick on its own.
    if ("ranges" in value) {
      const ranges = value.ranges as string[] | undefined;
      const same =
        Array.isArray(ranges) &&
        ranges.length === DEFAULT_TEMP_GRAPH_RANGES.length &&
        ranges.every((r, i) => r === DEFAULT_TEMP_GRAPH_RANGES[i]);
      if (same) value.ranges = undefined;
    }
    if ("default_range" in value) {
      const offered = resolveRanges((value.ranges as string[] | undefined) ?? this._config?.ranges, DEFAULT_TEMP_GRAPH_RANGES).ranges;
      if (!offered.includes(value.default_range as never) || value.default_range === offered[0]) value.default_range = undefined;
    }
    if (value.default_focus === "0" || value.default_focus === 0) value.default_focus = undefined;
    else if (typeof value.default_focus === "string" && /^\d+$/.test(value.default_focus)) value.default_focus = Number(value.default_focus);
    this._patch(value);
  }

  // ---- entries --------------------------------------------------------------

  private get _entries(): TempGraphEntityConfig[] {
    return (this._config?.entities ?? []).map((e) => (typeof e === "string" ? { entity: e } : { ...e }));
  }

  /** Writes the list back, keeping the short form for an entry that is only an id. */
  private _setEntries(entries: TempGraphEntityConfig[]): void {
    const list = entries.map((e) => {
      const { entity, ...rest } = e;
      const extra = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined && v !== ""));
      return Object.keys(extra).length ? { entity, ...extra } : entity;
    });
    this._patch({ entities: list });
  }

  private _entryChanged(index: number, ev: CustomEvent): void {
    ev.stopPropagation();
    const entries = this._entries;
    entries[index] = { ...entries[index], ...(ev.detail.value as TempGraphEntityConfig) };
    this._setEntries(entries);
  }

  private _entryColor(index: number, color: string): void {
    const entries = this._entries;
    entries[index] = { ...entries[index], color: color || undefined };
    this._setEntries(entries);
  }

  private _addEntry(): void {
    this._setEntries([...this._entries, { entity: "" }]);
  }

  private _removeEntry(index: number): void {
    this._setEntries(this._entries.filter((_, i) => i !== index));
  }

  private _moveEntry(index: number, by: -1 | 1): void {
    const entries = this._entries;
    const to = index + by;
    if (to < 0 || to >= entries.length) return;
    [entries[index], entries[to]] = [entries[to], entries[index]];
    this._setEntries(entries);
  }

  /** Units the sensors report, when they are not all the same. */
  private _mixedUnits(): { units: string[]; unit: string } | undefined {
    const units = this._entries
      .map((e) => this.hass?.states[e.entity]?.attributes?.unit_of_measurement as string | undefined)
      .filter((u): u is string => !!u);
    const distinct = [...new Set(units)];
    return distinct.length > 1 ? { units: distinct, unit: units[0] } : undefined;
  }

  // ---- labels ---------------------------------------------------------------

  private _computeLabel = (schema: SchemaEntry): string => {
    const map: Record<string, TranslationKey> = {
      entity: "editor_entity",
      name: "editor_name",
      icon: "editor_icon",
      title: "editor_tempgraph_title",
      ranges: "editor_tempgraph_ranges",
      default_range: "editor_tempgraph_default_range",
      summary: "editor_tempgraph_summary",
      summary_entity: "editor_tempgraph_summary_entity_field",
      default_focus: "editor_tempgraph_default_focus",
      decimals: "editor_tempgraph_decimals",
      show_extremes: "editor_tempgraph_show_extremes",
      height: "editor_tempgraph_height",
      animation: "editor_progress_animation",
      glass_background: "editor_glass_background",
      ...radiusLabelMap,
    };
    const key = map[schema.name];
    return key ? this._t(key) : schema.name;
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
      this._emit(rest as M3TemperatureGraphCardConfig);
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
      @value-changed=${this._valueChanged}
    ></ha-form>`;
  }

  private _optionsSchema(): SchemaEntry[] {
    const cfg = this._config!;
    const rangeOptions = TEMP_GRAPH_RANGES.map((r) => ({ value: r, label: this._t(`tempgraph_range_${r}` as TranslationKey) }));
    const { ranges } = resolveRanges(cfg.ranges, DEFAULT_TEMP_GRAPH_RANGES);
    const entries = this._entries;
    const schema: SchemaEntry[] = [
      { name: "title", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "ranges", selector: { select: { multiple: true, mode: "list", options: rangeOptions } } },
      {
        name: "default_range",
        selector: { select: { mode: "dropdown", options: rangeOptions.filter((o) => ranges.includes(o.value)) } },
      },
      {
        name: "summary",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "mean", label: this._t("editor_tempgraph_summary_mean") },
              { value: "median", label: this._t("editor_tempgraph_summary_median") },
              { value: "entity", label: this._t("editor_tempgraph_summary_entity") },
            ],
          },
        },
      },
    ];
    if (cfg.summary === "entity") schema.push({ name: "summary_entity", selector: SENSOR_SELECTOR });
    if (entries.length > 1) {
      schema.push({
        name: "default_focus",
        selector: {
          select: {
            mode: "dropdown",
            options: entries.map((e, i) => ({
              value: String(i),
              label: e.name || (this.hass?.states[e.entity]?.attributes?.friendly_name as string | undefined) || e.entity || `#${i + 1}`,
            })),
          },
        },
      });
    }
    schema.push(
      { name: "decimals", selector: { number: { min: 0, max: 3, mode: "box" } } },
      { name: "show_extremes", selector: { boolean: {} } },
      { name: "height", selector: { number: { min: 60, max: 400, step: 10, mode: "box", unit_of_measurement: "px" } } },
    );
    return schema;
  }

  protected render() {
    if (!this.hass || !this._config) return nothing;
    const cfg = this._config;
    const entries = this._entries;
    const mixed = this._mixedUnits();
    const { ranges, initial } = resolveRanges(cfg.ranges, DEFAULT_TEMP_GRAPH_RANGES, cfg.default_range);

    return html`
      <div class="editor">
        ${mixed
          ? html`<ha-alert alert-type="warning"
              >${this._t("editor_tempgraph_mixed_units").replace("{units}", mixed.units.join(", ")).replace("{unit}", mixed.unit)}</ha-alert
            >`
          : nothing}
        <ha-expansion-panel outlined .header=${this._t("editor_tempgraph_section_sensors")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:thermometer-lines"></ha-icon>
          <div class="panel-content">
            ${entries.map(
              (entry, index) => html`
                <div class="entry">
                  <div class="entry-row">
                    <ha-form
                      .hass=${this.hass}
                      .data=${{ entity: entry.entity, name: entry.name }}
                      .schema=${[
                        { name: "entity", required: true, selector: SENSOR_SELECTOR },
                        { name: "name", selector: { text: {} } },
                      ]}
                      .computeLabel=${this._computeLabel}
                      @value-changed=${(ev: CustomEvent) => this._entryChanged(index, ev)}
                    ></ha-form>
                    <div class="entry-actions">
                      <button class="icon-btn" aria-label=${this._t("editor_tempgraph_move_up")} ?disabled=${index === 0} @click=${() => this._moveEntry(index, -1)}>
                        <ha-icon icon="mdi:arrow-up"></ha-icon>
                      </button>
                      <button
                        class="icon-btn"
                        aria-label=${this._t("editor_tempgraph_move_down")}
                        ?disabled=${index === entries.length - 1}
                        @click=${() => this._moveEntry(index, 1)}
                      >
                        <ha-icon icon="mdi:arrow-down"></ha-icon>
                      </button>
                      <button class="icon-btn" aria-label=${this._t("editor_tempgraph_remove")} @click=${() => this._removeEntry(index)}>
                        <ha-icon icon="mdi:close"></ha-icon>
                      </button>
                    </div>
                  </div>
                  ${colorRow(
                    `${this._t("editor_tempgraph_color")} (${TEMP_GRAPH_PALETTE_TONAL[index % TEMP_GRAPH_PALETTE_TONAL.length]})`,
                    entry.color,
                    (v) => this._entryColor(index, v),
                  )}
                </div>
              `,
            )}
            <button class="add-btn" @click=${() => this._addEntry()}>
              <ha-icon icon="mdi:plus"></ha-icon>${this._t("editor_tempgraph_add")}
            </button>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_supply_display")}>
          <ha-icon slot="leading-icon" icon="mdi:chart-bell-curve-cumulative"></ha-icon>
          <div class="panel-content">
            ${this._form(
              {
                title: cfg.title,
                icon: cfg.icon,
                ranges,
                default_range: initial,
                summary: cfg.summary ?? "mean",
                summary_entity: cfg.summary_entity,
                default_focus: String(resolveFocus(cfg.default_focus, entries)),
                decimals: cfg.decimals ?? DEFAULT_TEMP_GRAPH_DECIMALS,
                show_extremes: cfg.show_extremes ?? true,
                height: cfg.height ?? DEFAULT_TEMP_GRAPH_HEIGHT,
              },
              this._optionsSchema(),
            )}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_colors")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            ${colorRow(`${this._t("editor_tempgraph_accent")} (primary)`, cfg.accent_color, (v) => this._colorChanged("accent_color", v))}
            ${colorRow(this._t("editor_progress_text_color"), cfg.text_color, (v) => this._colorChanged("text_color", v))}
            ${colorRow(this._t("editor_progress_secondary_text_color"), cfg.secondary_text_color, (v) =>
              this._colorChanged("secondary_text_color", v),
            )}
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
          defaultRadius: DEFAULT_TEMP_GRAPH_RADIUS,
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
      ha-alert {
        display: block;
        margin-bottom: 8px;
      }
      .entry {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--divider-color, rgba(127, 127, 127, 0.2));
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
      .entry-actions {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .icon-btn {
        flex-shrink: 0;
        width: 36px;
        height: 36px;
        border: none;
        border-radius: 8px;
        background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
        color: var(--primary-text-color);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .icon-btn[disabled] {
        opacity: 0.35;
        cursor: default;
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
    "m3-temperature-graph-card-editor": M3TemperatureGraphCardEditor;
  }
}
