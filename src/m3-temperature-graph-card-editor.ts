import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, LovelaceCardEditor, M3TemperatureGraphCardConfig, TempGraphRoomConfig } from "./types";
import {
  DEFAULT_CLIMATE_OVERVIEW_NAME_STRIP,
  DEFAULT_HUMIDITY_NAME_STRIP,
  DEFAULT_TEMP_GRAPH_DECIMALS,
  DEFAULT_TEMP_GRAPH_HEIGHT,
  DEFAULT_TEMP_GRAPH_RADIUS,
  DEFAULT_TEMP_GRAPH_RANGES,
  TEMP_GRAPH_PALETTE_TONAL,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import { fireEvent, colorRow, listRow, editorStyles, type SchemaEntry } from "./shared/editor-helpers";
import { radiusLabelMap } from "./shared/radius-editor";
import {
  initAppearanceState,
  radiusPresetPatch,
  cornerPresetPatch,
  renderAppearanceSection,
  type AppearanceState,
} from "./shared/appearance-editor";
import { discoverClimateRooms } from "./shared/ha-registry";
import type { EntityFilterConfig } from "./shared/entity-filter";
import { TEMP_GRAPH_RANGES, graphRooms, resolveFocus, resolveRanges, roomEntity } from "./shared/temperature-graph";

type ColorField = "accent_color" | "text_color" | "secondary_text_color" | "card_background";

/** Values left out of the YAML rather than written: empty, or the default. */
const DEFAULTS: Record<string, unknown> = {
  height: DEFAULT_TEMP_GRAPH_HEIGHT,
  show_extremes: true,
  show_header: true,
  show_chips: true,
  show_axis: true,
  show_focus_range: true,
  show_ranges: true,
  summary: "mean",
  sort: "area",
  animation: "auto",
};

interface Room {
  name: string;
  entity: string;
}

/**
 * The temperature graph card's editor, laid out as the climate overview
 * card's: what the header says, which rooms (discovery with its filters, or a
 * fixed list that can be reordered and coloured), then what the graph shows.
 */
@customElement("m3-temperature-graph-card-editor")
export class M3TemperatureGraphCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3TemperatureGraphCardConfig;
  @state() private _appearance: AppearanceState = { showCustomRadius: false, showCorners: false, cornerCustom: {} };
  /** What discovery finds with the current filters, for the count and the focus list. */
  @state() private _found?: Room[];
  private _foundKey = "";

  public setConfig(config: M3TemperatureGraphCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_TEMP_GRAPH_RADIUS);
    void this._refreshFound();
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private get _rooms(): TempGraphRoomConfig[] {
    return this._config?.rooms ?? [];
  }

  private get _auto(): boolean {
    return !this._rooms.length && this._config?.auto_discover !== false;
  }

  private _filter(): EntityFilterConfig {
    const c = this._config ?? ({} as M3TemperatureGraphCardConfig);
    return {
      include_area: c.include_area,
      exclude_area: c.exclude_area,
      include_entities: c.include_entities,
      exclude_entities: c.exclude_entities,
      include_labels: c.include_labels,
      exclude_labels: c.exclude_labels,
      include_state: c.include_state,
      exclude_state: c.exclude_state,
    };
  }

  private async _refreshFound(): Promise<void> {
    if (!this.hass || !this._config || !this._auto) {
      this._found = undefined;
      return;
    }
    const filter = this._filter();
    const nameStrip = this._config.name_strip ?? (this._config.measure === "humidity" ? DEFAULT_HUMIDITY_NAME_STRIP : DEFAULT_CLIMATE_OVERVIEW_NAME_STRIP);
    const key = JSON.stringify([filter, nameStrip, this._config.measure]);
    if (key === this._foundKey && this._found) return;
    this._foundKey = key;
    const rooms = await discoverClimateRooms(this.hass, { filter, nameStrip });
    if (key !== this._foundKey) return;
    this._found = graphRooms(rooms, filter.include_entities, this._config.measure);
  }

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has("hass") && !this._found) void this._refreshFound();
  }

  private _emit(config: M3TemperatureGraphCardConfig): void {
    this._config = config;
    fireEvent(this, "config-changed", { config });
    void this._refreshFound();
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
    // Discovery is the default without a room list, so only "off" is written.
    if (next.auto_discover === true) delete next.auto_discover;
    if (next.measure === "temperature") delete next.measure;
    if (next.decimals === (next.measure === "humidity" ? 0 : DEFAULT_TEMP_GRAPH_DECIMALS)) delete next.decimals;
    this._emit(next as unknown as M3TemperatureGraphCardConfig);
  }

  private _valueChanged(ev: CustomEvent): void {
    this._patch({ ...(ev.detail.value as Record<string, unknown>) });
  }

  /** The graph panel: the range and focus are stored only when they differ from what the card picks itself. */
  private _graphChanged(ev: CustomEvent): void {
    const value = { ...(ev.detail.value as Record<string, unknown>) };
    const ranges = value.ranges as string[] | undefined;
    if (
      Array.isArray(ranges) &&
      ranges.length === DEFAULT_TEMP_GRAPH_RANGES.length &&
      ranges.every((r, i) => r === DEFAULT_TEMP_GRAPH_RANGES[i])
    ) {
      value.ranges = undefined;
    }
    const offered = resolveRanges((value.ranges as string[] | undefined) ?? this._config?.ranges, DEFAULT_TEMP_GRAPH_RANGES).ranges;
    if (!offered.includes(value.default_range as never) || value.default_range === offered[0]) value.default_range = undefined;
    const curves = this._curves();
    if (!value.default_focus || value.default_focus === curves[0]?.entity) value.default_focus = undefined;
    this._patch(value);
  }

  // ---- rooms ------------------------------------------------------------------

  /** The curves as the editor knows them: the room list, or what discovery finds. */
  private _curves(): Room[] {
    if (!this._auto) {
      const measure = this._config?.measure;
      return this._rooms.filter((r) => roomEntity(r, measure)).map((r) => ({ name: r.name ?? "", entity: roomEntity(r, measure)! }));
    }
    return this._found ?? [];
  }

  private _setRooms(rooms: TempGraphRoomConfig[]): void {
    const clean = rooms.map((r) =>
      Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined && v !== "")) as unknown as TempGraphRoomConfig,
    );
    this._patch({ rooms: clean });
  }

  private _roomChanged(index: number, ev: CustomEvent): void {
    ev.stopPropagation();
    const rooms = [...this._rooms];
    rooms[index] = { ...rooms[index], ...(ev.detail.value as TempGraphRoomConfig) };
    this._setRooms(rooms);
  }

  private _roomColor(index: number, color: string): void {
    const rooms = [...this._rooms];
    rooms[index] = { ...rooms[index], color: color || undefined };
    this._setRooms(rooms);
  }

  private _addRoom(): void {
    this._setRooms([...this._rooms, { name: "", [this._roomField]: "" }]);
  }

  private _removeRoom(index: number): void {
    this._setRooms(this._rooms.filter((_, i) => i !== index));
  }

  private _moveRoom(index: number, by: -1 | 1): void {
    const rooms = [...this._rooms];
    const to = index + by;
    if (to < 0 || to >= rooms.length) return;
    [rooms[index], rooms[to]] = [rooms[to], rooms[index]];
    this._setRooms(rooms);
  }

  /** Turns what discovery finds into a fixed list, to reorder, rename and colour. */
  private _toManualList(): void {
    const found = this._found ?? [];
    if (!found.length) return;
    this._setRooms(found.map((r) => ({ name: r.name, [this._roomField]: r.entity })));
  }

  private _nameStripChanged(values: string[]): void {
    this._patch({ name_strip: values });
  }

  /** Units the sensors report, when they are not all the same. */
  private _mixedUnits(): { units: string[]; unit: string } | undefined {
    const units = this._curves()
      .map((c) => this.hass?.states[c.entity]?.attributes?.unit_of_measurement as string | undefined)
      .filter((u): u is string => !!u);
    const distinct = [...new Set(units)];
    return distinct.length > 1 ? { units: distinct, unit: units[0] } : undefined;
  }

  // ---- schemas ----------------------------------------------------------------

  private _stateSelector() {
    return {
      select: {
        multiple: true,
        custom_value: true,
        options: [
          { value: "unavailable", label: this._t("editor_climate_overview_state_unavailable") },
          { value: "unknown", label: this._t("editor_climate_overview_state_unknown") },
        ],
      },
    };
  }

  private get _humidity(): boolean {
    return this._config?.measure === "humidity";
  }

  /** The room field the measure reads, as the climate overview card names it. */
  private get _roomField(): "temperature_entity" | "humidity_entity" {
    return this._humidity ? "humidity_entity" : "temperature_entity";
  }

  private get _sensorSelector() {
    return { entity: { domain: "sensor", device_class: this._humidity ? "humidity" : "temperature" } };
  }

  private get _defaultDecimals(): number {
    return this._humidity ? 0 : DEFAULT_TEMP_GRAPH_DECIMALS;
  }

  private _contentSchema(): SchemaEntry[] {
    return [
      {
        name: "measure",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "temperature", label: this._t("editor_tempgraph_measure_temperature") },
              { value: "humidity", label: this._t("editor_tempgraph_measure_humidity") },
            ],
          },
        },
      },
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "show_header", selector: { boolean: {} } },
      {
        name: "sort",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "area", label: this._t("editor_climate_overview_sort_area") },
              { value: "temp_desc", label: this._t("editor_climate_overview_sort_temp_desc") },
              { value: "temp_asc", label: this._t("editor_climate_overview_sort_temp_asc") },
              { value: "name", label: this._t("editor_climate_overview_sort_name") },
            ],
          },
        },
      },
    ];
  }

  private _discoverySchema(): SchemaEntry[] {
    const schema: SchemaEntry[] = [{ name: "auto_discover", selector: { boolean: {} } }];
    if (this._config?.auto_discover !== false) {
      schema.push(
        { name: "include_area", selector: { area: { multiple: true } } },
        { name: "exclude_area", selector: { area: { multiple: true } } },
        { name: "include_labels", selector: { label: { multiple: true } } },
        { name: "exclude_labels", selector: { label: { multiple: true } } },
        { name: "include_entities", selector: { entity: { ...this._sensorSelector.entity, multiple: true } } },
        { name: "exclude_entities", selector: { entity: { ...this._sensorSelector.entity, multiple: true } } },
        { name: "include_state", selector: this._stateSelector() },
        { name: "exclude_state", selector: this._stateSelector() },
      );
    }
    return schema;
  }

  private _roomSchema(): SchemaEntry[] {
    return [
      { name: "name", selector: { text: {} } },
      { name: this._roomField, required: true, selector: this._sensorSelector },
    ];
  }

  private _graphSchema(): SchemaEntry[] {
    const cfg = this._config!;
    const rangeOptions = TEMP_GRAPH_RANGES.map((r) => ({ value: r, label: this._t(`tempgraph_range_${r}` as TranslationKey) }));
    const { ranges } = resolveRanges(cfg.ranges, DEFAULT_TEMP_GRAPH_RANGES);
    const curves = this._curves();
    const schema: SchemaEntry[] = [
      { name: "ranges", selector: { select: { multiple: true, mode: "list", options: rangeOptions } } },
      { name: "default_range", selector: { select: { mode: "dropdown", options: rangeOptions.filter((o) => ranges.includes(o.value)) } } },
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
    if (cfg.summary === "entity") schema.push({ name: "summary_entity", selector: this._sensorSelector });
    if (curves.length > 1) {
      schema.push({
        name: "default_focus",
        selector: {
          select: {
            mode: "dropdown",
            options: curves.map((c) => ({
              value: c.entity,
              label: c.name || (this.hass?.states[c.entity]?.attributes?.friendly_name as string | undefined) || c.entity,
            })),
          },
        },
      });
    }
    schema.push(
      { name: "decimals", selector: { number: { min: 0, max: 3, mode: "box" } } },
      { name: "show_chips", selector: { boolean: {} } },
      { name: "show_extremes", selector: { boolean: {} } },
      { name: "show_axis", selector: { boolean: {} } },
      { name: "show_focus_range", selector: { boolean: {} } },
      { name: "show_ranges", selector: { boolean: {} } },
      { name: "height", selector: { number: { min: 60, max: 400, step: 10, mode: "box", unit_of_measurement: "px" } } },
    );
    return schema;
  }

  private _computeLabel = (schema: SchemaEntry): string => {
    const map: Record<string, TranslationKey> = {
      name: "editor_name",
      icon: "editor_icon",
      show_header: "editor_show_header",
      sort: "editor_climate_overview_sort",
      auto_discover: "editor_climate_overview_auto_discover",
      include_area: "editor_climate_overview_include_area",
      exclude_area: "editor_climate_overview_exclude_area",
      include_labels: "editor_climate_overview_include_labels",
      exclude_labels: "editor_climate_overview_exclude_labels",
      include_entities: "editor_climate_overview_include_entities",
      exclude_entities: "editor_climate_overview_exclude_entities",
      include_state: "editor_climate_overview_include_state",
      exclude_state: "editor_climate_overview_exclude_state",
      temperature_entity: "editor_climate_overview_room_temp_entity",
      humidity_entity: "editor_climate_overview_room_humidity_entity",
      measure: "editor_tempgraph_measure",
      ranges: "editor_tempgraph_ranges",
      default_range: "editor_tempgraph_default_range",
      summary: "editor_tempgraph_summary",
      summary_entity: "editor_tempgraph_summary_entity_field",
      default_focus: "editor_tempgraph_default_focus",
      decimals: "editor_tempgraph_decimals",
      show_extremes: "editor_tempgraph_show_extremes",
      show_chips: "editor_tempgraph_show_chips",
      show_axis: "editor_tempgraph_show_axis",
      show_focus_range: "editor_tempgraph_show_focus_range",
      show_ranges: "editor_tempgraph_show_ranges",
      height: "editor_tempgraph_height",
      animation: "editor_progress_animation",
      glass_background: "editor_glass_background",
      ...radiusLabelMap,
    };
    const key = map[schema.name];
    return key ? this._t(key) : schema.name;
  };

  // ---- colours and appearance -------------------------------------------------

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

  // ---- render -----------------------------------------------------------------

  private _form(data: Record<string, unknown>, schema: SchemaEntry[], onChange: (ev: CustomEvent) => void = this._valueChanged) {
    return html`<ha-form
      .hass=${this.hass}
      .data=${data}
      .schema=${schema}
      .computeLabel=${this._computeLabel}
      @value-changed=${onChange.bind(this)}
    ></ha-form>`;
  }

  protected render() {
    if (!this.hass || !this._config) return nothing;
    const cfg = this._config;
    const rooms = this._rooms;
    const auto = this._auto;
    const mixed = this._mixedUnits();
    const { ranges, initial } = resolveRanges(cfg.ranges, DEFAULT_TEMP_GRAPH_RANGES, cfg.default_range);
    const curves = this._curves();
    const focusIndex = resolveFocus(cfg.default_focus, curves.map((c) => ({ entity: c.entity })));

    return html`
      <div class="editor">
        ${mixed
          ? html`<ha-alert alert-type="warning"
              >${this._t("editor_tempgraph_mixed_units").replace("{units}", mixed.units.join(", ")).replace("{unit}", mixed.unit)}</ha-alert
            >`
          : nothing}

        <ha-expansion-panel outlined .header=${this._t("editor_content")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:text-short"></ha-icon>
          <div class="panel-content">
            ${this._form(
              { measure: cfg.measure ?? "temperature", name: cfg.name, icon: cfg.icon, show_header: cfg.show_header ?? true, sort: cfg.sort ?? "area" },
              this._contentSchema(),
            )}
            ${listRow(this._t("editor_climate_overview_name_strip"), cfg.name_strip ?? (cfg.measure === "humidity" ? DEFAULT_HUMIDITY_NAME_STRIP : DEFAULT_CLIMATE_OVERVIEW_NAME_STRIP), (v) =>
              this._nameStripChanged(v),
            )}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_entities")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:home-search-outline"></ha-icon>
          <div class="panel-content">
            ${this._form(
              {
                auto_discover: cfg.auto_discover ?? true,
                include_area: cfg.include_area ?? [],
                exclude_area: cfg.exclude_area ?? [],
                include_labels: cfg.include_labels ?? [],
                exclude_labels: cfg.exclude_labels ?? [],
                include_entities: cfg.include_entities ?? [],
                exclude_entities: cfg.exclude_entities ?? [],
                include_state: cfg.include_state ?? [],
                exclude_state: cfg.exclude_state ?? [],
              },
              this._discoverySchema(),
            )}
            ${auto && this._found
              ? html`<div class="hint">
                  ${this._t("editor_tempgraph_found").replace("{n}", String(this._found.length))}
                  ${this._found.length
                    ? html`<button class="link-btn" @click=${() => this._toManualList()}>${this._t("editor_openings_to_manual")}</button>`
                    : nothing}
                </div>`
              : nothing}
            <div class="hint">${this._t("editor_climate_overview_rooms_helper")}</div>
            ${rooms.map(
              (room, index) => html`
                <div class="entry">
                  <div class="entry-row">
                    <ha-form
                      .hass=${this.hass}
                      .data=${{ name: room.name ?? "", [this._roomField]: room[this._roomField] ?? "" }}
                      .schema=${this._roomSchema()}
                      .computeLabel=${this._computeLabel}
                      @value-changed=${(ev: CustomEvent) => this._roomChanged(index, ev)}
                    ></ha-form>
                    <div class="entry-actions">
                      <button class="icon-btn" aria-label=${this._t("editor_tempgraph_move_up")} ?disabled=${index === 0} @click=${() => this._moveRoom(index, -1)}>
                        <ha-icon icon="mdi:arrow-up"></ha-icon>
                      </button>
                      <button
                        class="icon-btn"
                        aria-label=${this._t("editor_tempgraph_move_down")}
                        ?disabled=${index === rooms.length - 1}
                        @click=${() => this._moveRoom(index, 1)}
                      >
                        <ha-icon icon="mdi:arrow-down"></ha-icon>
                      </button>
                      <button class="icon-btn" aria-label=${this._t("editor_tempgraph_remove")} @click=${() => this._removeRoom(index)}>
                        <ha-icon icon="mdi:close"></ha-icon>
                      </button>
                    </div>
                  </div>
                  ${colorRow(
                    `${this._t("editor_tempgraph_color")} (${TEMP_GRAPH_PALETTE_TONAL[index % TEMP_GRAPH_PALETTE_TONAL.length]})`,
                    room.color,
                    (v) => this._roomColor(index, v),
                  )}
                </div>
              `,
            )}
            <button class="add-btn" @click=${() => this._addRoom()}>
              <ha-icon icon="mdi:plus"></ha-icon>${this._t("editor_climate_overview_add_room")}
            </button>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_tempgraph_section_graph")}>
          <ha-icon slot="leading-icon" icon="mdi:chart-bell-curve-cumulative"></ha-icon>
          <div class="panel-content">
            ${this._form(
              {
                ranges,
                default_range: initial,
                summary: cfg.summary ?? "mean",
                summary_entity: cfg.summary_entity,
                default_focus: curves[focusIndex]?.entity,
                decimals: cfg.decimals ?? this._defaultDecimals,
                show_extremes: cfg.show_extremes ?? true,
                show_chips: cfg.show_chips ?? true,
                show_axis: cfg.show_axis ?? true,
                show_focus_range: cfg.show_focus_range ?? true,
                show_ranges: cfg.show_ranges ?? true,
                height: cfg.height ?? DEFAULT_TEMP_GRAPH_HEIGHT,
              },
              this._graphSchema(),
              this._graphChanged,
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
    "m3-temperature-graph-card-editor": M3TemperatureGraphCardEditor;
  }
}
