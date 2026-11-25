import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, LovelaceCardEditor, M3TodoCardConfig } from "./types";
import { DEFAULT_TODO_RADIUS, TODO_DEFAULT_MAX_QUICK_ADD } from "./const";
import { localize, type TranslationKey } from "./localize";
import { fireEvent, colorRow, listRow, editorStyles, type SchemaEntry } from "./shared/editor-helpers";
import { radiusLabelMap } from "./shared/radius-editor";
import { dropEmptyEntities } from "./shared/todo-lists";
import {
  initAppearanceState,
  radiusPresetPatch,
  cornerPresetPatch,
  renderAppearanceSection,
  type AppearanceState,
} from "./shared/appearance-editor";

@customElement("m3-todo-card-editor")
export class M3TodoCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3TodoCardConfig;
  @state() private _appearance: AppearanceState = {
    showCustomRadius: false,
    showCorners: false,
    cornerCustom: {},
  };

  public setConfig(config: M3TodoCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_TODO_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _emit(config: M3TodoCardConfig): void {
    this._config = config;
    fireEvent(this, "config-changed", { config });
  }

  private _listSchema(): SchemaEntry[] {
    return [
      { name: "entity", required: true, selector: { entity: { domain: "todo" } } },
      { name: "entities", selector: { entity: { domain: "todo", multiple: true } } },
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
    ];
  }

  private _inputSchema(): SchemaEntry[] {
    const schema: SchemaEntry[] = [
      {
        name: "add_position",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "top", label: this._t("editor_todo_add_top") },
              { value: "bottom", label: this._t("editor_todo_add_bottom") },
            ],
          },
        },
      },
      { name: "prevent_duplicates", selector: { boolean: {} } },
      {
        name: "quick_add_mode",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "none", label: this._t("editor_todo_quick_none") },
              { value: "fixed", label: this._t("editor_todo_quick_fixed") },
              { value: "recent", label: this._t("editor_todo_quick_recent") },
              { value: "supplies", label: this._t("editor_todo_quick_supplies") },
            ],
          },
        },
      },
    ];
    if ((this._config?.quick_add_mode ?? "none") !== "none") {
      schema.push({
        name: "max_quick_add",
        selector: { number: { min: 1, max: 12, mode: "box" } },
      });
    }
    return schema;
  }

  private _displaySchema(): SchemaEntry[] {
    return [
      { name: "show_completed", selector: { boolean: {} } },
      { name: "show_clear_completed", selector: { boolean: {} } },
      { name: "group_by_category", selector: { boolean: {} } },
      { name: "reorderable", selector: { boolean: {} } },
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
    ];
  }

  private _computeLabel = (schema: SchemaEntry): string => {
    const labelMap: Record<string, TranslationKey> = {
      entity: "editor_entity",
      entities: "editor_todo_entities",
      name: "editor_name",
      icon: "editor_icon",
      add_position: "editor_todo_add_position",
      prevent_duplicates: "editor_todo_prevent_duplicates",
      quick_add_mode: "editor_todo_quick_add_mode",
      max_quick_add: "editor_todo_max_quick_add",
      show_completed: "editor_todo_show_completed",
      show_clear_completed: "editor_todo_show_clear_completed",
      group_by_category: "editor_todo_group_by_category",
      reorderable: "editor_todo_reorderable",
      animation: "editor_progress_animation",
      glass_background: "editor_glass_background",
      ...radiusLabelMap,
    };
    const key = labelMap[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    this._emit(
      dropEmptyEntities({ ...this._config, ...(ev.detail.value as Record<string, unknown>) } as M3TodoCardConfig),
    );
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
      this._emit(rest as M3TodoCardConfig);
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
      this._emit(rest as M3TodoCardConfig);
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

    const listData = {
      entity: this._config.entity,
      entities: this._config.entities ?? [],
      name: this._config.name,
      icon: this._config.icon,
    };
    const inputData = {
      add_position: this._config.add_position ?? "top",
      prevent_duplicates: this._config.prevent_duplicates ?? true,
      quick_add_mode: this._config.quick_add_mode ?? "none",
      max_quick_add: this._config.max_quick_add ?? TODO_DEFAULT_MAX_QUICK_ADD,
    };
    const displayData = {
      show_completed: this._config.show_completed ?? true,
      show_clear_completed: this._config.show_clear_completed ?? true,
      group_by_category: this._config.group_by_category ?? false,
      reorderable: this._config.reorderable ?? false,
    };
    const animationData = { animation: this._config.animation ?? "auto" };

    return html`
      <div class="editor">
        <ha-expansion-panel outlined .header=${this._t("editor_todo_list")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:format-list-checks"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${listData}
              .schema=${this._listSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_todo_input")}>
          <ha-icon slot="leading-icon" icon="mdi:playlist-plus"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${inputData}
              .schema=${this._inputSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            ${this._config.quick_add_mode === "fixed"
              ? listRow(this._t("editor_todo_quick_add"), this._config.quick_add ?? [], (v) =>
                  this._emit({ ...this._config!, quick_add: v }),
                )
              : nothing}
            ${this._config.quick_add_mode === "supplies"
              ? html`<div class="hint">${this._t("editor_todo_quick_supplies_hint")}</div>`
              : nothing}
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
              .data=${animationData}
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
          config: this._config,
          defaultRadius: DEFAULT_TODO_RADIUS,
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

  static styles = editorStyles;
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-todo-card-editor": M3TodoCardEditor;
  }
}
