import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  LovelaceCardEditor,
  M3LightsOverviewCardConfig,
  LightsOverviewManualRoomConfig,
  LightsOverviewPopupMode,
  HaActionConfig,
} from "./types";
import { DEFAULT_LIGHTS_OVERVIEW_RADIUS } from "./const";
import { localize, type TranslationKey } from "./localize";
import { fireEvent, colorRow, opacityRow, editorStyles, type SchemaEntry } from "./shared/editor-helpers";
import { renderDetailCardField } from "./shared/detail-card-editor";
import { radiusLabelMap } from "./shared/radius-editor";
import {
  initAppearanceState,
  radiusPresetPatch,
  cornerPresetPatch,
  renderAppearanceSection,
  type AppearanceState,
} from "./shared/appearance-editor";

type LightsOverviewColorField =
  | "on_color"
  | "off_color"
  | "accent_color"
  | "text_color"
  | "secondary_text_color"
  | "card_background";

const ACTION_KEYS = ["tap_action", "hold_action", "double_tap_action"] as const;

@customElement("m3-lights-overview-card-editor")
export class M3LightsOverviewCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3LightsOverviewCardConfig;
  @state() private _appearance: AppearanceState = { showCustomRadius: false, showCorners: false, cornerCustom: {} };

  public setConfig(config: M3LightsOverviewCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_LIGHTS_OVERVIEW_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _groupHandlingSelector() {
    return {
      select: {
        mode: "dropdown" as const,
        options: [
          { value: "all", label: this._t("editor_lights_groups_all") },
          { value: "prefer_groups", label: this._t("editor_lights_groups_prefer_groups") },
          { value: "prefer_members", label: this._t("editor_lights_groups_prefer_members") },
        ],
      },
    };
  }

  private _actionSelector() {
    return {
      select: {
        mode: "dropdown" as const,
        options: [
          { value: "toggle", label: this._t("editor_lights_action_toggle") },
          { value: "popup", label: this._t("editor_lights_action_popup") },
          { value: "more-info", label: this._t("editor_lights_action_more_info") },
          { value: "none", label: this._t("editor_lights_action_none") },
        ],
      },
    };
  }

  // Free text as well as the four common states, so exotic states stay reachable.
  private _stateSelector() {
    return {
      select: {
        multiple: true,
        custom_value: true,
        options: [
          { value: "on", label: this._t("editor_lights_state_on") },
          { value: "off", label: this._t("editor_lights_state_off") },
          { value: "unavailable", label: this._t("editor_lights_state_unavailable") },
          { value: "unknown", label: this._t("editor_lights_state_unknown") },
        ],
      },
    };
  }

  private _discoverySchema(): SchemaEntry[] {
    // The entity pickers follow the chosen domains: with `switch` added they
    // have to offer switches, or the filters cannot name the very entities
    // discovery just found.
    const domains = this._config?.include_domains?.length
      ? this._config.include_domains
      : ["light"];
    return [
      { name: "auto_discover", selector: { boolean: {} } },
      {
        name: "include_domains",
        selector: {
          select: {
            multiple: true,
            mode: "dropdown",
            options: [
              { value: "light", label: this._t("editor_lights_domain_light") },
              { value: "switch", label: this._t("editor_lights_domain_switch") },
              { value: "fan", label: this._t("editor_lights_domain_fan") },
              { value: "input_boolean", label: this._t("editor_lights_domain_input_boolean") },
            ],
          },
        },
      },
      { name: "include_area", selector: { area: { multiple: true } } },
      { name: "exclude_area", selector: { area: { multiple: true } } },
      { name: "include_labels", selector: { label: { multiple: true } } },
      { name: "exclude_labels", selector: { label: { multiple: true } } },
      { name: "include_entities", selector: { entity: { domain: domains, multiple: true } } },
      { name: "exclude_entities", selector: { entity: { domain: domains, multiple: true } } },
      { name: "include_state", selector: this._stateSelector() },
      { name: "exclude_state", selector: this._stateSelector() },
      { name: "group_handling", selector: this._groupHandlingSelector() },
    ];
  }

  private _roomSchema(): SchemaEntry[] {
    return [
      { name: "name", required: true, selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "entities", selector: { entity: { domain: "light", multiple: true } } },
      { name: "toggle_entities", selector: { entity: { domain: "light", multiple: true } } },
    ];
  }

  private _displaySchema(): SchemaEntry[] {
    return [
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      {
        name: "view",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "rooms", label: this._t("editor_lights_view_rooms") },
              { value: "entities", label: this._t("editor_lights_view_entities") },
            ],
          },
        },
      },
      {
        name: "sort",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "name", label: this._t("editor_lights_sort_name") },
              { value: "area", label: this._t("editor_lights_sort_area") },
              { value: "on_first", label: this._t("editor_lights_sort_on_first") },
            ],
          },
        },
      },
      { name: "show_header", selector: { boolean: {} } },
      { name: "show_count", selector: { boolean: {} } },
      { name: "shape_by_state", selector: { boolean: {} } },
      { name: "show_area", selector: { boolean: {} } },
      { name: "hide_empty_rooms", selector: { boolean: {} } },
    ];
  }

  private _toggleSchema(): SchemaEntry[] {
    return [
      { name: "exclude_toggle_entities", selector: { entity: { domain: "light", multiple: true } } },
      { name: "toggle_inherit_filters", selector: { boolean: {} } },
      { name: "toggle_group_handling", selector: this._groupHandlingSelector() },
      { name: "toggle_include_state", selector: this._stateSelector() },
    ];
  }

  private _actionSchema(): SchemaEntry[] {
    return [
      { name: "tap_action", selector: this._actionSelector() },
      { name: "hold_action", selector: this._actionSelector() },
      { name: "double_tap_action", selector: this._actionSelector() },
    ];
  }

  private _popupModeSelector() {
    return {
      select: {
        mode: "dropdown" as const,
        options: [
          { value: "default-grid", label: this._t("editor_lights_popup_mode_default_grid") },
          { value: "default-detail", label: this._t("editor_lights_popup_mode_default_detail") },
          { value: "custom", label: this._t("editor_lights_popup_mode_custom") },
        ],
      },
    };
  }

  private _popupSchema(): SchemaEntry[] {
    return [
      { name: "title", selector: { text: {} } },
      { name: "inherit_filters", selector: { boolean: {} } },
      { name: "exclude_labels", selector: { label: { multiple: true } } },
      { name: "exclude_entities", selector: { entity: { domain: "light", multiple: true } } },
      { name: "group_handling", selector: this._groupHandlingSelector() },
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
      shape_by_state: "editor_shape_by_state",
      auto_discover: "editor_lights_auto_discover",
      include_domains: "editor_lights_include_domains",
      include_area: "editor_lights_include_area",
      exclude_area: "editor_lights_exclude_area",
      include_labels: "editor_lights_include_labels",
      exclude_labels: "editor_lights_exclude_labels",
      include_entities: "editor_lights_include_entities",
      exclude_entities: "editor_lights_exclude_entities",
      include_state: "editor_lights_include_state",
      exclude_state: "editor_lights_exclude_state",
      toggle_include_state: "editor_lights_include_state",
      group_handling: "editor_lights_group_handling",
      name: "editor_name",
      icon: "editor_icon",
      entities: "editor_lights_room_entities",
      toggle_entities: "editor_lights_room_toggle_entities",
      view: "editor_lights_view",
      sort: "editor_lights_sort",
      show_header: "editor_show_header",
      show_count: "editor_lights_show_count",
      show_area: "editor_lights_show_area",
      hide_empty_rooms: "editor_lights_hide_empty_rooms",
      exclude_toggle_entities: "editor_lights_exclude_toggle",
      toggle_inherit_filters: "editor_lights_toggle_inherit",
      toggle_group_handling: "editor_lights_toggle_group_handling",
      tap_action: "editor_lights_tap_action",
      hold_action: "editor_lights_hold_action",
      double_tap_action: "editor_lights_double_tap_action",
      title: "editor_lights_popup_title",
      inherit_filters: "editor_lights_popup_inherit",
      animation: "editor_progress_animation",
      glass_background: "editor_glass_background",
      ...radiusLabelMap,
    };
    const key = labelMap[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    this._config = { ...this._config, ...ev.detail.value };
    fireEvent(this, "config-changed", { config: this._config });
  }

  // toggle_include_state is a UI-only field that writes into toggle_filter —
  // the config doesn't have a bare toggle_include_state key.
  private _toggleChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const value = { ...ev.detail.value } as Record<string, unknown>;
    const includeState = value.toggle_include_state as string[] | undefined;
    delete value.toggle_include_state;
    const toggleFilter = { ...(this._config.toggle_filter ?? {}) };
    if (includeState?.length) toggleFilter.include_state = includeState;
    else delete toggleFilter.include_state;
    this._config = {
      ...this._config,
      ...value,
      toggle_filter: Object.keys(toggleFilter).length ? toggleFilter : undefined,
    };
    fireEvent(this, "config-changed", { config: this._config });
  }

  // The form hands back bare action-kind strings; the config stores HA's
  // object form so navigate/url stay expressible in YAML.
  private _actionsChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const value = ev.detail.value as Record<string, string>;
    const patch: Partial<Record<(typeof ACTION_KEYS)[number], HaActionConfig>> = {};
    for (const key of ACTION_KEYS) {
      const action = value[key];
      if (action) patch[key] = { action } as HaActionConfig;
    }
    this._config = { ...this._config, ...patch };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _popupCardChanged(value: Record<string, unknown> | undefined): void {
    if (!this._config) return;
    this._config = { ...this._config, popup: { ...(this._config.popup ?? {}), card: value } };
    fireEvent(this, "config-changed", { config: this._config });
  }

  // Kept separate from _popupChanged: a dedicated ha-form so switching the
  // mode never wipes the other popup fields sitting in the second form.
  private _popupModeChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const mode = (ev.detail.value as { mode: LightsOverviewPopupMode }).mode;
    this._config = { ...this._config, popup: { ...(this._config.popup ?? {}), mode } };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _popupChanged(ev: CustomEvent): void {
    if (!this._config) return;
    this._config = { ...this._config, popup: { ...(this._config.popup ?? {}), ...ev.detail.value } };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _colorChanged(field: LightsOverviewColorField, value: string): void {
    if (!this._config) return;
    if (value) {
      this._config = { ...this._config, [field]: value };
    } else {
      const { [field]: _removed, ...rest } = this._config;
      this._config = rest;
    }
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _opacityChanged(field: "tile_tint_opacity" | "accent_opacity", value: number): void {
    if (!this._config) return;
    this._config = { ...this._config, [field]: value };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _roomChanged(index: number, ev: CustomEvent): void {
    if (!this._config) return;
    const rooms = [...(this._config.rooms ?? [])];
    const value = ev.detail.value as LightsOverviewManualRoomConfig;
    rooms[index] = {
      name: value.name ?? "",
      icon: value.icon || undefined,
      entities: value.entities?.length ? value.entities : undefined,
      toggle_entities: value.toggle_entities?.length ? value.toggle_entities : undefined,
      exclude_toggle_entities: rooms[index]?.exclude_toggle_entities,
    };
    this._config = { ...this._config, rooms };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _addRoom(): void {
    if (!this._config) return;
    const rooms = [...(this._config.rooms ?? []), { name: "" }];
    this._config = { ...this._config, rooms };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _removeRoom(index: number): void {
    if (!this._config) return;
    const rooms = [...(this._config.rooms ?? [])];
    rooms.splice(index, 1);
    this._config = { ...this._config, rooms };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _radiusPresetChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const patch = radiusPresetPatch(ev.detail.value.radius_preset as string);
    this._appearance = { ...this._appearance, showCustomRadius: patch.showCustomRadius };
    if (patch.radius !== undefined) {
      this._config = { ...this._config, radius: patch.radius };
      fireEvent(this, "config-changed", { config: this._config });
    }
  }

  private _cornersToggleChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const showCorners = ev.detail.value.use_corners as boolean;
    this._appearance = { ...this._appearance, showCorners };
    if (!showCorners) {
      const { corners: _corners, ...rest } = this._config;
      this._config = rest;
      fireEvent(this, "config-changed", { config: this._config });
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
      this._config = { ...this._config, corners: { ...(this._config.corners ?? {}), [key]: patch.px } };
      fireEvent(this, "config-changed", { config: this._config });
    }
  }

  private _cornerValueChanged(key: string, ev: CustomEvent): void {
    if (!this._config) return;
    const px = ev.detail.value[key] as number;
    this._config = { ...this._config, corners: { ...(this._config.corners ?? {}), [key]: px } };
    fireEvent(this, "config-changed", { config: this._config });
  }

  protected render() {
    if (!this.hass || !this._config) return nothing;
    const cfg = this._config;
    const rooms = cfg.rooms ?? [];

    const discoveryData = {
      auto_discover: cfg.auto_discover ?? true,
      include_domains: cfg.include_domains ?? ["light"],
      include_area: cfg.include_area ?? [],
      exclude_area: cfg.exclude_area ?? [],
      include_labels: cfg.include_labels ?? [],
      exclude_labels: cfg.exclude_labels ?? [],
      include_entities: cfg.include_entities ?? [],
      exclude_entities: cfg.exclude_entities ?? [],
      include_state: cfg.include_state ?? [],
      exclude_state: cfg.exclude_state ?? [],
      group_handling: cfg.group_handling ?? "all",
    };

    const displayData = {
      name: cfg.name,
      icon: cfg.icon,
      view: cfg.view ?? "rooms",
      sort: cfg.sort ?? "name",
      show_header: cfg.show_header ?? true,
      show_count: cfg.show_count ?? true,
      shape_by_state: cfg.shape_by_state ?? false,
      show_area: cfg.show_area ?? true,
      hide_empty_rooms: cfg.hide_empty_rooms ?? false,
    };

    const toggleData = {
      exclude_toggle_entities: cfg.exclude_toggle_entities ?? [],
      toggle_inherit_filters: cfg.toggle_inherit_filters ?? true,
      toggle_group_handling: cfg.toggle_group_handling ?? cfg.group_handling ?? "all",
      toggle_include_state: cfg.toggle_filter?.include_state ?? [],
    };

    const defaultHoldAction = (cfg.view ?? "rooms") === "entities" ? "more-info" : "popup";
    const actionsData = {
      tap_action: cfg.tap_action?.action ?? "toggle",
      hold_action: cfg.hold_action?.action ?? defaultHoldAction,
      double_tap_action: cfg.double_tap_action?.action ?? "none",
    };

    const popup = cfg.popup ?? {};
    const popupMode: LightsOverviewPopupMode = popup.mode ?? "default-grid";
    const popupData = {
      title: popup.title ?? "",
      inherit_filters: popup.inherit_filters ?? true,
      exclude_labels: popup.exclude_labels ?? [],
      exclude_entities: popup.exclude_entities ?? [],
      group_handling: popup.group_handling ?? cfg.group_handling ?? "all",
    };

    const animationData = { animation: cfg.animation ?? "auto" };

    return html`
      <div class="editor">
        <ha-expansion-panel outlined .header=${this._t("editor_content")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:text-short"></ha-icon>
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

        <ha-expansion-panel outlined .header=${this._t("editor_entities")}>
          <ha-icon slot="leading-icon" icon="mdi:home-search-outline"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${discoveryData}
              .schema=${this._discoverySchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            ${rooms.map(
              (r, i) => html`
                <div class="override-row">
                  <div class="override-form">
                    <ha-form
                      .hass=${this.hass}
                      .data=${{
                        name: r.name,
                        icon: r.icon ?? "",
                        entities: r.entities ?? [],
                        toggle_entities: r.toggle_entities ?? [],
                      }}
                      .schema=${this._roomSchema()}
                      .computeLabel=${this._computeLabel}
                      @value-changed=${(ev: CustomEvent) => this._roomChanged(i, ev)}
                    ></ha-form>
                  </div>
                  <button class="remove-btn" @click=${() => this._removeRoom(i)}>
                    <ha-icon icon="mdi:close"></ha-icon>
                  </button>
                </div>
              `,
            )}
            <button class="add-btn" @click=${() => this._addRoom()}>
              <ha-icon icon="mdi:plus"></ha-icon>
              ${this._t("editor_lights_add_room")}
            </button>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_behavior")}>
          <ha-icon slot="leading-icon" icon="mdi:gesture-tap"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${actionsData}
              .schema=${this._actionSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._actionsChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_lights_toggle_section")}>
          <ha-icon slot="leading-icon" icon="mdi:toggle-switch-outline"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${toggleData}
              .schema=${this._toggleSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._toggleChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        ${[actionsData.tap_action, actionsData.hold_action, actionsData.double_tap_action].includes("popup")
          ? html`
              <ha-expansion-panel outlined .header=${this._t("editor_lights_popup_section")}>
                <ha-icon slot="leading-icon" icon="mdi:open-in-new"></ha-icon>
                <div class="panel-content">
                  <ha-form
                    .hass=${this.hass}
                    .data=${{ mode: popupMode }}
                    .schema=${[{ name: "mode", selector: this._popupModeSelector() }]}
                    .computeLabel=${() => this._t("editor_lights_popup_mode")}
                    @value-changed=${this._popupModeChanged}
                  ></ha-form>

                  ${popupMode === "default-detail"
                    ? html`<div class="hint">${this._t("editor_lights_popup_mode_default_detail_hint")}</div>`
                    : nothing}

                  ${popupMode === "default-grid"
                    ? html`
                        <ha-form
                          .hass=${this.hass}
                          .data=${popupData}
                          .schema=${this._popupSchema()}
                          .computeLabel=${this._computeLabel}
                          @value-changed=${this._popupChanged}
                        ></ha-form>
                      `
                    : nothing}

                  ${popupMode === "custom"
                    ? renderDetailCardField({
                        hass: this.hass,
                        value: popup.card,
                        label: this._t("editor_lights_popup_card"),
                        hint: this._t("editor_lights_popup_card_hint"),
                        onChange: (v) => this._popupCardChanged(v),
                      })
                    : nothing}
                </div>
              </ha-expansion-panel>
            `
          : nothing}

        <ha-expansion-panel outlined .header=${this._t("editor_progress_colors")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            ${colorRow(this._t("editor_lights_on_color"), cfg.on_color, (v) => this._colorChanged("on_color", v))}
            ${colorRow(this._t("editor_lights_off_color"), cfg.off_color, (v) => this._colorChanged("off_color", v))}
            ${opacityRow(this._t("editor_lights_tile_tint_opacity"), cfg.tile_tint_opacity, 12, (v) =>
              this._opacityChanged("tile_tint_opacity", v),
            )}
            ${colorRow(
              this._t("editor_lights_accent_color"),
              cfg.accent_color,
              (v) => this._colorChanged("accent_color", v),
              {
                label: this._t("editor_lights_accent_opacity"),
                value: cfg.accent_opacity,
                defaultValue: 12,
                onChange: (v) => this._opacityChanged("accent_opacity", v),
              },
            )}
            ${colorRow(this._t("editor_progress_text_color"), cfg.text_color, (v) => this._colorChanged("text_color", v))}
            ${colorRow(
              this._t("editor_progress_secondary_text_color"),
              cfg.secondary_text_color,
              (v) => this._colorChanged("secondary_text_color", v),
            )}
            ${colorRow(
              this._t("editor_progress_card_background"),
              cfg.card_background,
              (v) => this._colorChanged("card_background", v),
            )}
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
          config: cfg,
          defaultRadius: DEFAULT_LIGHTS_OVERVIEW_RADIUS,
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
      .override-row {
        display: flex;
        align-items: flex-start;
        gap: 8px;
      }

      .override-form {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
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
    "m3-lights-overview-card-editor": M3LightsOverviewCardEditor;
  }
}
