import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  LovelaceCardEditor,
  M3CalendarCardConfig,
  CalendarSourceConfig,
} from "./types";
import {
  DEFAULT_CALENDAR_RADIUS,
  CALENDAR_DAYS_AHEAD,
  CALENDAR_DAYS_AHEAD_MIN,
  CALENDAR_DAYS_AHEAD_MAX,
} from "./const";
import { localize, type TranslationKey } from "./localize";
import { fireEvent, colorRow, editorStyles, type SchemaEntry } from "./shared/editor-helpers";
import {
  initAppearanceState,
  radiusPresetPatch,
  cornerPresetPatch,
  renderAppearanceSection,
  type AppearanceState,
} from "./shared/appearance-editor";

@customElement("m3-calendar-card-editor")
export class M3CalendarCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3CalendarCardConfig;
  @state() private _appearance: AppearanceState = {
    showCustomRadius: false,
    showCorners: false,
    cornerCustom: {},
  };

  public setConfig(config: M3CalendarCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_CALENDAR_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }
  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }
  private _emit(config: M3CalendarCardConfig): void {
    this._config = config;
    fireEvent(this, "config-changed", { config });
  }

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    this._emit({
      ...this._config,
      ...(ev.detail.value as Record<string, unknown>),
    } as M3CalendarCardConfig);
  }

  private _colorChanged(
    field: "accent_color" | "text_color" | "secondary_text_color" | "card_background",
    value: string,
  ): void {
    if (!this._config) return;
    if (value) this._emit({ ...this._config, [field]: value });
    else {
      const { [field]: _drop, ...rest } = this._config;
      this._emit(rest as M3CalendarCardConfig);
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
      this._emit(rest as M3CalendarCardConfig);
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

  // ---- calendar list --------------------------------------------------------

  /** Normalises the bare-string form the card also accepts. */
  private get _sources(): CalendarSourceConfig[] {
    return (this._config?.entities ?? []).map((e) => (typeof e === "string" ? { entity: e } : e));
  }

  private _writeSources(list: CalendarSourceConfig[]): void {
    if (!this._config) return;
    this._emit({ ...this._config, entities: list });
  }

  private _sourceChanged(index: number, ev: CustomEvent): void {
    const list = [...this._sources];
    const value = ev.detail.value as CalendarSourceConfig;
    list[index] = {
      entity: value.entity,
      ...(value.name ? { name: value.name } : {}),
      ...(list[index]?.color ? { color: list[index].color } : {}),
      ...(list[index]?.text_color ? { text_color: list[index].text_color } : {}),
    };
    this._writeSources(list);
  }

  private _sourceColorChanged(index: number, value: string, field: "color" | "text_color" = "color"): void {
    const list = [...this._sources];
    const current = list[index];
    if (!current) return;
    if (value) list[index] = { ...current, [field]: value };
    else {
      const { [field]: _drop, ...rest } = current;
      list[index] = rest;
    }
    this._writeSources(list);
  }

  private _addSource(): void {
    this._writeSources([...this._sources, { entity: "" }]);
  }

  private _removeSource(index: number): void {
    this._writeSources(this._sources.filter((_, i) => i !== index));
  }

  // ---- schemas --------------------------------------------------------------

  private _sourceSchema(): SchemaEntry[] {
    return [
      { name: "entity", selector: { entity: { domain: "calendar" } }, required: true },
      { name: "name", selector: { text: {} } },
    ];
  }

  private _viewSchema(): SchemaEntry[] {
    return [
      {
        name: "view",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "agenda", label: this._t("editor_calendar_view_agenda") },
              { value: "month", label: this._t("editor_calendar_view_month") },
            ],
          },
        },
      },
      { name: "show_view_switch", selector: { boolean: {} } },
      {
        name: "days_ahead",
        selector: {
          number: {
            min: CALENDAR_DAYS_AHEAD_MIN,
            max: CALENDAR_DAYS_AHEAD_MAX,
            step: 1,
            mode: "box",
          },
        },
      },
      { name: "max_events", selector: { number: { min: 0, max: 50, step: 1, mode: "box" } } },
      { name: "hide_past_today", selector: { boolean: {} } },
      { name: "show_adjacent_days", selector: { boolean: {} } },
    ];
  }

  private _displaySchema(): SchemaEntry[] {
    const schema: SchemaEntry[] = [
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "show_next_chip", selector: { boolean: {} } },
      { name: "show_calendar_name", selector: { boolean: {} } },
      {
        name: "font_scale",
        selector: { number: { min: 0.75, max: 2, step: 0.05, mode: "slider" } },
      },
      {
        name: "tap_action",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "detail", label: this._t("editor_calendar_tap_detail") },
              { value: "more-info", label: this._t("editor_calendar_tap_more_info") },
              { value: "navigate", label: this._t("editor_calendar_tap_navigate") },
              { value: "none", label: this._t("editor_calendar_tap_none") },
            ],
          },
        },
      },
    ];
    // The path only matters for the two things that use it, so it appears only
    // then rather than sitting there inert.
    const action = this._config?.tap_action ?? "detail";
    if (action === "navigate" || action === "detail") {
      schema.push({ name: "navigation_path", selector: { text: {} } });
    }
    return schema;
  }

  private _computeLabel = (schema: SchemaEntry): string => {
    const map: Record<string, TranslationKey> = {
      animation: "editor_progress_animation",
      entity: "editor_calendar_entity",
      name: "editor_calendar_name",
      icon: "editor_humidifier_icon",
      view: "editor_calendar_view",
      show_view_switch: "editor_calendar_show_switch",
      days_ahead: "editor_calendar_days_ahead",
      max_events: "editor_calendar_max_events",
      hide_past_today: "editor_calendar_hide_past",
      show_adjacent_days: "editor_calendar_adjacent",
      show_next_chip: "editor_calendar_next_chip",
      show_calendar_name: "editor_calendar_show_calendar_name",
      font_scale: "editor_calendar_font_scale",
      tap_action: "editor_calendar_tap",
      navigation_path: "editor_calendar_path",
    };
    const key = map[schema.name];
    return key ? this._t(key) : schema.name;
  };

  // ---- render ---------------------------------------------------------------

  protected render() {
    if (!this.hass || !this._config) return nothing;
    const cfg = this._config;

    return html`
      <div class="editor">
        <ha-expansion-panel outlined .header=${this._t("editor_calendar_calendars")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:calendar-multiple"></ha-icon>
          <div class="panel-content">
            <div class="hint">${this._t("editor_calendar_hint")}</div>
            ${this._sources.map(
              (source, index) => html`
                <div class="source-row">
                  <ha-form
                    .hass=${this.hass}
                    .data=${{ entity: source.entity, name: source.name ?? "" }}
                    .schema=${this._sourceSchema()}
                    .computeLabel=${this._computeLabel}
                    @value-changed=${(e: CustomEvent) => this._sourceChanged(index, e)}
                  ></ha-form>
                  ${colorRow(this._t("editor_calendar_color"), source.color, (v) =>
                    this._sourceColorChanged(index, v),
                  )}
                  ${colorRow(this._t("editor_calendar_text_color"), source.text_color, (v) =>
                    this._sourceColorChanged(index, v, "text_color"),
                  )}
                  <button class="remove-btn" @click=${() => this._removeSource(index)}>
                    <ha-icon icon="mdi:close"></ha-icon>
                  </button>
                </div>
              `,
            )}
            <button class="add-btn" @click=${() => this._addSource()}>
              <ha-icon icon="mdi:plus"></ha-icon>
              ${this._t("editor_calendar_add")}
            </button>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_calendar_view")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:view-agenda-outline"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${{
                view: cfg.view ?? "agenda",
                show_view_switch: cfg.show_view_switch ?? true,
                days_ahead: cfg.days_ahead ?? CALENDAR_DAYS_AHEAD,
                max_events: cfg.max_events ?? 0,
                hide_past_today: cfg.hide_past_today ?? false,
                show_adjacent_days: cfg.show_adjacent_days ?? true,
              }}
              .schema=${this._viewSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_calendar_hide_past_hint")}</div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_calendar_display")}>
          <ha-icon slot="leading-icon" icon="mdi:format-text"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${{
                name: cfg.name ?? "",
                icon: cfg.icon ?? "",
                show_next_chip: cfg.show_next_chip ?? false,
                show_calendar_name: cfg.show_calendar_name ?? false,
                font_scale: cfg.font_scale ?? 1,
                tap_action: cfg.tap_action ?? "detail",
                navigation_path: cfg.navigation_path ?? "",
              }}
              .schema=${this._displaySchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_colors")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            ${colorRow(this._t("editor_todo_accent_color"), cfg.accent_color, (v) =>
              this._colorChanged("accent_color", v),
            )}
            ${colorRow(this._t("editor_progress_text_color"), cfg.text_color, (v) =>
              this._colorChanged("text_color", v),
            )}
            ${colorRow(this._t("editor_progress_secondary_text_color"), cfg.secondary_text_color, (v) =>
              this._colorChanged("secondary_text_color", v),
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
              .data=${{ animation: cfg.animation ?? "auto" }}
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
          </div>
        </ha-expansion-panel>

        ${renderAppearanceSection({
          hass: this.hass,
          language: this._language,
          config: this._config,
          defaultRadius: DEFAULT_CALENDAR_RADIUS,
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
      .source-row {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 10px 34px 10px 10px;
        border: 1px dashed rgba(127, 127, 127, 0.4);
        border-radius: 12px;
      }

      .remove-btn {
        position: absolute;
        top: 8px;
        right: 8px;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-calendar-card-editor": M3CalendarCardEditor;
  }
}
