import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  LovelaceCardEditor,
  M3RemoteCardConfig,
  RemoteAppConfig,
  RemoteButtonConfig,
} from "./types";
import {
  DEFAULT_REMOTE_ASSISTANT_TIMEOUT,
  DEFAULT_REMOTE_DPAD_SIZE,
  DEFAULT_REMOTE_RADIUS,
  DEFAULT_REMOTE_REPEAT_INTERVAL,
  REMOTE_DPAD_MAX,
  REMOTE_DPAD_MIN,
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
import {
  PROFILE_DEFAULTS,
  REMOTE_PROFILES,
  profileForPlatform,
  type RemoteProfile,
} from "./shared/remote-profiles";

type ColorField = "accent_color" | "text_color" | "secondary_text_color" | "card_background";

@customElement("m3-remote-card-editor")
export class M3RemoteCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3RemoteCardConfig;
  @state() private _appearance: AppearanceState = {
    showCustomRadius: false,
    showCorners: false,
    cornerCustom: {},
  };

  public setConfig(config: M3RemoteCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_REMOTE_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }
  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }
  private _emit(config: M3RemoteCardConfig): void {
    this._config = config;
    fireEvent(this, "config-changed", { config });
  }

  private get _apps(): RemoteAppConfig[] {
    return this._config?.apps ?? [];
  }
  private get _functionButtons(): RemoteButtonConfig[] {
    return this._config?.function_buttons ?? [];
  }

  /** The media entity whose `source_list` the import button reads. */
  private get _mediaEntity(): string | undefined {
    const cfg = this._config;
    if (cfg?.media_entity) return cfg.media_entity;
    const e = cfg?.entity;
    if (e?.startsWith("media_player.")) return e;
    if (!e || !this.hass) return undefined;
    const candidate = `media_player.${e.slice(e.indexOf(".") + 1)}`;
    return this.hass.states[candidate] ? candidate : undefined;
  }

  private get _sourceList(): string[] {
    const id = this._mediaEntity;
    if (!id || !this.hass) return [];
    return (this.hass.states[id]?.attributes.source_list as string[] | undefined) ?? [];
  }

  private get _effectiveProfile(): RemoteProfile {
    const p = this._config?.profile as RemoteProfile | undefined;
    if (p && p in PROFILE_DEFAULTS) return p;
    const e = this._config?.entity ?? "";
    if (/samsung/i.test(e)) return profileForPlatform("samsungtv");
    return "generic";
  }

  // ---- schemas --------------------------------------------------------------

  private _deviceSchema(): SchemaEntry[] {
    return [
      { name: "entity", required: true, selector: { entity: { domain: ["remote", "media_player"] } } },
      { name: "media_entity", selector: { entity: { domain: "media_player" } } },
      { name: "power_entity", selector: { entity: { domain: ["switch", "media_player", "remote", "input_boolean"] } } },
      {
        name: "profile",
        selector: {
          select: {
            mode: "dropdown",
            options: REMOTE_PROFILES.map((p) => ({
              value: p,
              label: this._t(
                ({
                  generic: "editor_remote_profile_generic",
                  samsung: "editor_remote_profile_samsung",
                  google_tv: "editor_remote_profile_google_tv",
                  lg_webos: "editor_remote_profile_lg",
                  appletv: "editor_remote_profile_appletv",
                  kodi: "editor_remote_profile_kodi",
                } as Record<RemoteProfile, TranslationKey>)[p],
              ),
            })),
          },
        },
      },
      { name: "name", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
    ];
  }

  private _dpadSchema(): SchemaEntry[] {
    return [
      {
        name: "dpad_size",
        selector: { number: { min: REMOTE_DPAD_MIN, max: REMOTE_DPAD_MAX, step: 2, mode: "slider" } },
      },
      { name: "keyboard_control", selector: { boolean: {} } },
      { name: "repeat_interval", selector: { number: { min: 80, max: 1000, step: 10, mode: "box", unit_of_measurement: "ms" } } },
    ];
  }

  private _columnsSchema(): SchemaEntry[] {
    const schema: SchemaEntry[] = [
      {
        name: "right_column",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "auto", label: this._t("editor_remote_right_auto") },
              { value: "channel", label: this._t("editor_remote_right_channel") },
              { value: "assistant", label: this._t("editor_remote_right_assistant") },
              { value: "custom", label: this._t("editor_remote_right_custom") },
              { value: "none", label: this._t("editor_remote_right_none") },
            ],
          },
        },
      },
      { name: "show_rocker_labels", selector: { boolean: {} } },
    ];
    const resolved =
      (this._config?.right_column ?? "auto") === "auto"
        ? PROFILE_DEFAULTS[this._effectiveProfile].rightColumn
        : this._config?.right_column;
    if (resolved === "assistant") {
      schema.push({
        name: "assistant_timeout",
        selector: { number: { min: 500, max: 10000, step: 100, mode: "box", unit_of_measurement: "ms" } },
      });
    }
    return schema;
  }

  private _rowsSchema(): SchemaEntry[] {
    return [
      { name: "show_transport", selector: { boolean: {} } },
      { name: "show_numpad", selector: { boolean: {} } },
    ];
  }

  private _appsSchema(): SchemaEntry[] {
    return [
      {
        name: "app_style",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "chips", label: this._t("editor_remote_app_style_chips") },
              { value: "tiles", label: this._t("editor_remote_app_style_tiles") },
            ],
          },
        },
      },
      { name: "max_apps", selector: { number: { min: 0, max: 30, mode: "box" } } },
      { name: "show_apps", selector: { boolean: {} } },
    ];
  }

  private _displaySchema(): SchemaEntry[] {
    return [
      { name: "show_now_playing", selector: { boolean: {} } },
      { name: "power_toggle", selector: { boolean: {} } },
      { name: "haptics", selector: { boolean: {} } },
    ];
  }

  private _appRowSchema(): SchemaEntry[] {
    return [
      { name: "name", required: true, selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "app_id", selector: { text: {} } },
    ];
  }

  private _buttonRowSchema(): SchemaEntry[] {
    return [
      { name: "key", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
      { name: "label", selector: { text: {} } },
    ];
  }

  private readonly _computeLabel = (schema: SchemaEntry): string => {
    const map: Record<string, TranslationKey> = {
      entity: "editor_remote_entity",
      media_entity: "editor_remote_media_entity",
      power_entity: "editor_remote_power_entity",
      profile: "editor_remote_profile",
      name: "editor_remote_app_name",
      icon: "editor_icon",
      label: "editor_name",
      key: "editor_remote_key",
      app_id: "editor_remote_app_id",
      dpad_size: "editor_remote_dpad_size",
      keyboard_control: "editor_remote_keyboard_control",
      repeat_interval: "editor_remote_repeat_interval",
      right_column: "editor_remote_right_column",
      show_rocker_labels: "editor_remote_rocker_labels",
      assistant_timeout: "editor_remote_assistant_timeout",
      show_transport: "editor_remote_show_transport",
      show_numpad: "editor_remote_show_numpad",
      app_style: "editor_remote_app_style",
      max_apps: "editor_remote_max_apps",
      show_apps: "editor_remote_show_now_playing",
      show_now_playing: "editor_remote_show_now_playing",
      power_toggle: "editor_remote_power_toggle",
      haptics: "editor_remote_haptics",
      glass_background: "editor_glass_background",
      animation: "editor_progress_animation",
      ...radiusLabelMap,
    };
    const key = map[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const patch = ev.detail.value as Record<string, unknown>;
    const next = { ...this._config, ...patch } as Record<string, unknown>;
    // An emptied optional entity must be removed, not stored as "": an empty
    // media_entity would otherwise beat the automatic lookup.
    for (const [k, v] of Object.entries(patch)) {
      if ((v === "" || v === undefined || v === null) && k !== "entity") delete next[k];
    }
    this._emit(next as unknown as M3RemoteCardConfig);
  }

  // ---- lists ----------------------------------------------------------------

  private _listChanged<T>(field: "apps" | "function_buttons" | "right_buttons", rows: T[], index: number, ev: CustomEvent): void {
    if (!this._config) return;
    const next = [...rows];
    const value = ev.detail.value as Record<string, unknown>;
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== "" && v !== undefined && v !== null) cleaned[k] = v;
    }
    next[index] = cleaned as unknown as T;
    this._emit({ ...this._config, [field]: next });
  }

  private _addRow(field: "apps" | "function_buttons" | "right_buttons", rows: unknown[], blank: unknown): void {
    if (!this._config) return;
    this._emit({ ...this._config, [field]: [...rows, blank] });
  }

  private _removeRow(field: "apps" | "function_buttons" | "right_buttons", rows: unknown[], index: number): void {
    if (!this._config) return;
    const next = rows.filter((_, i) => i !== index);
    if (next.length) this._emit({ ...this._config, [field]: next });
    else {
      const { [field]: _removed, ...rest } = this._config;
      this._emit(rest as M3RemoteCardConfig);
    }
  }

  private _renderList<T extends object>(
    field: "apps" | "function_buttons" | "right_buttons",
    rows: T[],
    schema: SchemaEntry[],
    blank: T,
    colorOf?: (row: T) => string | undefined,
    onColor?: (index: number, value: string) => void,
  ) {
    return html`
      ${rows.map(
        (row, i) => html`
          <div class="list-row">
            <ha-form
              .hass=${this.hass}
              .data=${row}
              .schema=${schema}
              .computeLabel=${this._computeLabel}
              @value-changed=${(ev: CustomEvent) => this._listChanged(field, rows, i, ev)}
            ></ha-form>
            <button
              type="button"
              class="remove-btn"
              aria-label=${this._t("editor_router_remove_row")}
              @click=${() => this._removeRow(field, rows, i)}
            >
              <ha-icon icon="mdi:close"></ha-icon>
            </button>
          </div>
          ${colorOf && onColor
            ? colorRow(this._t("editor_todo_accent_color"), colorOf(row), (v) => onColor(i, v))
            : nothing}
        `,
      )}
      <button
        type="button"
        class="add-btn"
        aria-label=${this._t("editor_router_add_row")}
        @click=${() => this._addRow(field, rows, blank)}
      >
        <ha-icon icon="mdi:plus"></ha-icon>
      </button>
    `;
  }

  private _appColorChanged(index: number, value: string): void {
    if (!this._config) return;
    const apps = [...this._apps];
    const { color: _c, ...rest } = apps[index];
    apps[index] = value ? { ...rest, color: value } : (rest as RemoteAppConfig);
    this._emit({ ...this._config, apps });
  }

  /**
   * Fills the app list from the entity's own `source_list`.
   *
   * The one thing the card genuinely cannot guess: which apps a TV has. The
   * entity already knows, and copying it beats typing six names by hand.
   */
  private _importSources(): void {
    if (!this._config) return;
    const sources = this._sourceList;
    if (!sources.length) return;
    const existing = new Set(this._apps.map((a) => a.name.toLowerCase()));
    const added = sources
      .filter((s) => !existing.has(s.toLowerCase()))
      .map((name) => ({ name }));
    if (!added.length) return;
    this._emit({ ...this._config, apps: [...this._apps, ...added] });
  }

  private _colorChanged(field: ColorField, value: string): void {
    if (!this._config) return;
    if (value) this._emit({ ...this._config, [field]: value });
    else {
      const { [field]: _removed, ...rest } = this._config;
      this._emit(rest as M3RemoteCardConfig);
    }
  }

  // ---- appearance plumbing --------------------------------------------------

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
      this._emit(rest as M3RemoteCardConfig);
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

  // ---- render ---------------------------------------------------------------

  protected render() {
    if (!this.hass || !this._config) return nothing;
    const cfg = this._config;
    const profile = this._effectiveProfile;
    const defaults = PROFILE_DEFAULTS[profile];
    const sources = this._sourceList;
    const rightMode = cfg.right_column ?? "auto";
    const resolvedRight = rightMode === "auto" ? defaults.rightColumn : rightMode;

    return html`
      <div class="editor">
        <ha-expansion-panel outlined .header=${this._t("editor_remote_device")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:remote-tv"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${{
                entity: cfg.entity ?? "",
                media_entity: cfg.media_entity ?? "",
                power_entity: cfg.power_entity ?? "",
                profile: cfg.profile ?? profile,
                name: cfg.name ?? "",
                icon: cfg.icon ?? "",
              }}
              .schema=${this._deviceSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_remote_entity_hint")}</div>
            <div class="hint">${this._t("editor_remote_profile_hint")}</div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_remote_dpad")}>
          <ha-icon slot="leading-icon" icon="mdi:circle-double"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${{
                dpad_size: cfg.dpad_size ?? DEFAULT_REMOTE_DPAD_SIZE,
                keyboard_control: cfg.keyboard_control ?? true,
                repeat_interval: cfg.repeat_interval ?? DEFAULT_REMOTE_REPEAT_INTERVAL,
              }}
              .schema=${this._dpadSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_remote_columns")}>
          <ha-icon slot="leading-icon" icon="mdi:view-column-outline"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${{
                right_column: rightMode,
                show_rocker_labels: cfg.show_rocker_labels ?? true,
                assistant_timeout: cfg.assistant_timeout ?? DEFAULT_REMOTE_ASSISTANT_TIMEOUT,
              }}
              .schema=${this._columnsSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            ${resolvedRight === "custom"
              ? this._renderList(
                  "right_buttons",
                  cfg.right_buttons ?? [],
                  this._buttonRowSchema(),
                  {} as RemoteButtonConfig,
                )
              : nothing}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_remote_rows")}>
          <ha-icon slot="leading-icon" icon="mdi:dots-grid"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${{
                show_transport: cfg.show_transport ?? defaults.showTransport,
                show_numpad: cfg.show_numpad ?? false,
              }}
              .schema=${this._rowsSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            <div class="hint">${this._t("editor_remote_function_buttons")}</div>
            ${this._functionButtons.length
              ? nothing
              : html`<div class="hint">${defaults.functionKeys.join(", ")}</div>`}
            ${this._renderList(
              "function_buttons",
              this._functionButtons,
              this._buttonRowSchema(),
              {} as RemoteButtonConfig,
            )}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_remote_apps")}>
          <ha-icon slot="leading-icon" icon="mdi:apps"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${{
                app_style: cfg.app_style ?? defaults.appStyle,
                max_apps: cfg.max_apps ?? 0,
                show_apps: cfg.show_apps ?? true,
              }}
              .schema=${this._appsSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
            ${sources.length
              ? html`<button type="button" class="add-btn wide" @click=${() => this._importSources()}>
                  <ha-icon icon="mdi:import"></ha-icon>
                  <span>${this._t("editor_remote_import_sources")} (${sources.length})</span>
                </button>`
              : html`<div class="hint">${this._t("editor_remote_import_none")}</div>`}
            ${this._renderList(
              "apps",
              this._apps,
              this._appRowSchema(),
              { name: "" } as RemoteAppConfig,
              (row) => row.color,
              (i, v) => this._appColorChanged(i, v),
            )}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_remote_display")}>
          <ha-icon slot="leading-icon" icon="mdi:view-dashboard-outline"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${{
                show_now_playing: cfg.show_now_playing ?? defaults.showNowPlaying,
                power_toggle: cfg.power_toggle ?? true,
                haptics: cfg.haptics ?? true,
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
            ${colorRow(this._t("editor_todo_accent_color"), cfg.accent_color, (v) => this._colorChanged("accent_color", v))}
            ${colorRow(this._t("editor_progress_text_color"), cfg.text_color, (v) => this._colorChanged("text_color", v))}
            ${colorRow(this._t("editor_progress_secondary_text_color"), cfg.secondary_text_color, (v) => this._colorChanged("secondary_text_color", v))}
            ${colorRow(this._t("editor_progress_card_background"), cfg.card_background, (v) => this._colorChanged("card_background", v))}
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
          config: cfg,
          defaultRadius: DEFAULT_REMOTE_RADIUS,
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
      .list-row {
        display: flex;
        align-items: flex-start;
        gap: 8px;
      }
      .list-row ha-form {
        flex: 1;
        min-width: 0;
      }
      .remove-btn {
        flex-shrink: 0;
        width: 40px;
        height: 40px;
        border: none;
        border-radius: 8px;
        background: rgba(127, 127, 127, 0.14);
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
        background: rgba(127, 127, 127, 0.14);
        color: var(--primary-text-color);
        font-family: inherit;
        font-size: 13px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-remote-card-editor": M3RemoteCardEditor;
  }
}
