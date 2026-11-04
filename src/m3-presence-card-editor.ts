import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, LovelaceCardEditor, M3PresenceCardConfig } from "./types";
import { DEFAULT_PRESENCE_RADIUS } from "./const";
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

@customElement("m3-presence-card-editor")
export class M3PresenceCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3PresenceCardConfig;
  @state() private _appearance: AppearanceState = { showCustomRadius: false, showCorners: false, cornerCustom: {} };

  public setConfig(config: M3PresenceCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_PRESENCE_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _entitiesSchema(): SchemaEntry[] {
    const schema: SchemaEntry[] = [{ name: "auto_discover", selector: { boolean: {} } }];
    if (this._config?.auto_discover ?? true) {
      schema.push(
        { name: "include_area", selector: { area: { multiple: true } } },
        { name: "include_label", selector: { label: { multiple: true } } },
        { name: "exclude_entities", selector: { entity: { domain: ["person"], multiple: true } } },
      );
    } else {
      schema.push({
        name: "entities",
        selector: { entity: { domain: ["person", "device_tracker"], multiple: true } },
      });
    }
    return schema;
  }

  private _contentSchema(): SchemaEntry[] {
    const compact = this._config?.layout === "compact";
    return [
      {
        name: "layout",
        selector: {
          select: {
            mode: "list",
            options: [
              { value: "grid", label: this._t("editor_presence_layout_grid") },
              { value: "compact", label: this._t("editor_presence_layout_compact") },
            ],
          },
        },
      },
      // The compact layout has no header to put a name or icon in.
      ...(compact
        ? []
        : [
            { name: "name", selector: { text: {} } },
            { name: "icon", selector: { icon: {} } },
          ]),
      { name: "shape_by_state", selector: { boolean: {} } },
      { name: "show_distance", selector: { boolean: {} } },
      { name: "show_since", selector: { boolean: {} } },
      { name: "show_map", selector: { boolean: {} } },
      {
        name: "sort",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "home_first", label: this._t("editor_presence_sort_home_first") },
              { value: "name", label: this._t("editor_presence_sort_name") },
            ],
          },
        },
      },
    ];
  }

  /**
   * `hold_action` has been in the config all along with no field to set it
   * from, so it joins `tap_action` here rather than staying YAML-only.
   */
  private _actionsSchema(): SchemaEntry[] {
    return [
      { name: "tap_action", selector: { ui_action: {} } },
      { name: "hold_action", selector: { ui_action: {} } },
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

  private _computeHelper = (schema: SchemaEntry): string | undefined =>
    schema.name === "shape_by_state" ? this._t("editor_presence_shape_by_state_helper") : undefined;

  private _computeLabel = (schema: SchemaEntry): string => {
    const labelMap: Record<string, TranslationKey> = {
      auto_discover: "editor_presence_auto_discover",
      include_area: "editor_battery_include_area",
      include_label: "editor_battery_include_label",
      exclude_entities: "editor_battery_exclude_entities",
      entities: "editor_entities",
      name: "editor_name",
      icon: "editor_icon",
      show_distance: "editor_presence_show_distance",
      show_since: "editor_presence_show_since",
      show_map: "editor_presence_show_map",
      sort: "editor_presence_sort",
      layout: "editor_presence_layout",
      shape_by_state: "editor_shape_by_state",
      tap_action: "editor_tap_action",
      hold_action: "editor_hold_action",
      animation: "editor_progress_animation",
      glass_background: "editor_glass_background",
      ...radiusLabelMap,
    };
    const key = labelMap[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const next = { ...this._config, ...ev.detail.value } as Record<string, unknown>;
    // `ui_action` clears to undefined rather than "", and a key explicitly set
    // to undefined is not the same as an absent one once the config is written
    // back out as YAML.
    for (const key of ["tap_action", "hold_action"]) {
      if (next[key] === undefined) delete next[key];
    }
    this._config = next as unknown as M3PresenceCardConfig;
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _colorChanged(
    field: "home_color" | "not_home_color" | "zone_color" | "unknown_color" | "text_color" | "secondary_text_color" | "card_background",
    value: string,
  ): void {
    if (!this._config) return;
    if (value) {
      this._config = { ...this._config, [field]: value };
    } else {
      const { [field]: _removed, ...rest } = this._config;
      this._config = rest;
    }
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _opacityChanged(field: "presence_tint_opacity", value: number): void {
    if (!this._config) return;
    this._config = { ...this._config, [field]: value };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _zoneEntries(): [string, string][] {
    return Object.entries(this._config?.zone_colors ?? {});
  }

  private _zoneNameChanged(index: number, name: string): void {
    if (!this._config) return;
    const entries = this._zoneEntries();
    entries[index] = [name, entries[index]?.[1] ?? "#a58fe8"];
    this._config = { ...this._config, zone_colors: Object.fromEntries(entries) };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _zoneColorChanged(index: number, color: string): void {
    if (!this._config) return;
    const entries = this._zoneEntries();
    entries[index] = [entries[index]?.[0] ?? "", color];
    this._config = { ...this._config, zone_colors: Object.fromEntries(entries) };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _removeZone(index: number): void {
    if (!this._config) return;
    const entries = this._zoneEntries();
    entries.splice(index, 1);
    this._config = { ...this._config, zone_colors: Object.fromEntries(entries) };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _addZone(): void {
    if (!this._config) return;
    const entries = this._zoneEntries();
    entries.push(["", "#a58fe8"]);
    this._config = { ...this._config, zone_colors: Object.fromEntries(entries) };
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
      const { corners, ...rest } = this._config;
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

    const autoDiscover = this._config.auto_discover ?? true;
    const entitiesData = {
      auto_discover: autoDiscover,
      include_area: this._config.include_area ?? [],
      include_label: this._config.include_label ?? [],
      exclude_entities: this._config.exclude_entities ?? [],
      entities: this._config.entities ?? [],
    };
    const contentData = {
      layout: this._config.layout ?? "grid",
      shape_by_state: this._config.shape_by_state ?? false,
      name: this._config.name,
      icon: this._config.icon,
      show_distance: this._config.show_distance ?? true,
      show_since: this._config.show_since ?? true,
      show_map: this._config.show_map ?? false,
      sort: this._config.sort ?? "home_first",
    };
    const animationData = { animation: this._config.animation ?? "auto" };
    const actionsData = {
      tap_action: this._config.tap_action,
      hold_action: this._config.hold_action,
    };

    return html`
      <div class="editor">
        <ha-expansion-panel outlined .header=${this._t("editor_entities")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:account-group"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${entitiesData}
              .schema=${this._entitiesSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_content")}>
          <ha-icon slot="leading-icon" icon="mdi:text-short"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${contentData}
              .schema=${this._contentSchema()}
              .computeLabel=${this._computeLabel}
              .computeHelper=${this._computeHelper}
              @value-changed=${this._valueChanged}
            ></ha-form>
            ${contentData.show_map ? html`<div class="hint">${this._t("editor_presence_show_map_helper")}</div>` : nothing}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_interactions")}>
          <ha-icon slot="leading-icon" icon="mdi:gesture-tap"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${actionsData}
              .schema=${this._actionsSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_presence_actions_hint")}</div>
            <div class="hint">${this._t("editor_presence_popups_hint")}</div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_colors")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            ${colorRow(this._t("editor_presence_home_color"), this._config.home_color, (v) => this._colorChanged("home_color", v))}
            ${colorRow(this._t("editor_presence_not_home_color"), this._config.not_home_color, (v) => this._colorChanged("not_home_color", v))}
            ${colorRow(this._t("editor_presence_zone_color"), this._config.zone_color, (v) => this._colorChanged("zone_color", v))}
            ${colorRow(this._t("editor_presence_unknown_color"), this._config.unknown_color, (v) => this._colorChanged("unknown_color", v))}
            ${opacityRow(this._t("editor_opacity"), this._config.presence_tint_opacity, 18, (v) => this._opacityChanged("presence_tint_opacity", v))}
            ${colorRow(this._t("editor_progress_text_color"), this._config.text_color, (v) => this._colorChanged("text_color", v))}
            ${colorRow(this._t("editor_progress_secondary_text_color"), this._config.secondary_text_color, (v) => this._colorChanged("secondary_text_color", v))}
            ${colorRow(this._t("editor_progress_card_background"), this._config.card_background, (v) => this._colorChanged("card_background", v))}
            ${this._zoneEntries().map(
              ([zoneName, color], i) => html`
                <div class="override-row">
                  <input
                    type="text"
                    class="color-text"
                    .value=${zoneName}
                    placeholder="Arbeit"
                    @input=${(e: Event) => this._zoneNameChanged(i, (e.target as HTMLInputElement).value)}
                  />
                  <input
                    type="color"
                    class="swatch"
                    .value=${/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#a58fe8"}
                    @input=${(e: Event) => this._zoneColorChanged(i, (e.target as HTMLInputElement).value)}
                  />
                  <button class="remove-btn" @click=${() => this._removeZone(i)}>
                    <ha-icon icon="mdi:close"></ha-icon>
                  </button>
                </div>
              `,
            )}
            <button class="add-btn" @click=${() => this._addZone()}>
              <ha-icon icon="mdi:plus"></ha-icon>
              ${this._t("editor_battery_add_override")}
            </button>
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
          defaultRadius: DEFAULT_PRESENCE_RADIUS,
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
        align-items: center;
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
    "m3-presence-card-editor": M3PresenceCardEditor;
  }
}
