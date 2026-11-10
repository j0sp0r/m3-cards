import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, LovelaceCardEditor, M3MediaCardConfig } from "./types";
import {
  DEFAULT_MEDIA_RADIUS,
  DEFAULT_MEDIA_BROWSE_HEIGHT,
  DEFAULT_MEDIA_COMPACT_BUTTONS,
  DEFAULT_MEDIA_MINI_BUTTONS,
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

@customElement("m3-media-card-editor")
export class M3MediaCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3MediaCardConfig;
  @state() private _appearance: AppearanceState = { showCustomRadius: false, showCorners: false, cornerCustom: {} };

  public setConfig(config: M3MediaCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_MEDIA_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _entitySchema(): SchemaEntry[] {
    return [{ name: "entity", required: true, selector: { entity: { domain: "media_player" } } }];
  }

  private _contentSchema(): SchemaEntry[] {
    return [
      { name: "name", selector: { text: {} } },
      {
        name: "playing_layout",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "full", label: localize("editor_media_layout_full", this._language) },
              { value: "compact", label: localize("editor_media_layout_compact", this._language) },
              { value: "mini", label: localize("editor_media_layout_mini", this._language) },
            ],
          },
        },
      },
      ...(this._config?.playing_layout === "compact" || this._config?.playing_layout === "mini"
        ? [
            {
              name: "compact_buttons",
              selector: {
                select: {
                  multiple: true,
                  mode: "list",
                  options: [
                    { value: "previous", label: localize("media_previous", this._language) },
                    { value: "play", label: localize("editor_media_button_play", this._language) },
                    { value: "next", label: localize("media_next", this._language) },
                    { value: "browse", label: localize("editor_media_button_browse", this._language) },
                  ],
                },
              },
            },
          ]
        : []),
      { name: "show_source_select", selector: { boolean: {} } },
      { name: "show_shuffle_repeat", selector: { boolean: {} } },
      { name: "show_volume", selector: { boolean: {} } },
      { name: "volume_down_action", selector: { ui_action: {} } },
      { name: "volume_up_action", selector: { ui_action: {} } },
      { name: "strip_track_number", selector: { boolean: {} } },
      {
        name: "time_display",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "remaining", label: localize("editor_media_time_remaining", this._language) },
              { value: "total", label: localize("editor_media_time_total", this._language) },
            ],
          },
        },
      },
      { name: "show_device_chip", selector: { boolean: {} } },
      { name: "show_source_chip", selector: { boolean: {} } },
      {
        name: "meta_chips",
        selector: {
          select: {
            multiple: true,
            mode: "list",
            options: [
              { value: "track", label: localize("editor_media_chip_track", this._language) },
              { value: "year", label: localize("editor_media_chip_year", this._language) },
              { value: "bitrate", label: localize("editor_media_chip_bitrate", this._language) },
            ],
          },
        },
      },
      { name: "show_browser", selector: { boolean: {} } },
      {
        name: "default_tab",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "queue", label: localize("editor_media_tab_queue", this._language) },
              { value: "library", label: localize("editor_media_tab_library", this._language) },
            ],
          },
        },
      },
      {
        name: "browse_height",
        selector: { number: { mode: "box", min: 80, max: 600, step: 10, unit_of_measurement: "px" } },
      },
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
      name: "editor_name",
      show_source_select: "editor_media_show_source_select",
      show_shuffle_repeat: "editor_media_show_shuffle_repeat",
      strip_track_number: "editor_media_strip_track_number",
      time_display: "editor_media_time_display",
      meta_chips: "editor_media_meta_chips",
      show_browser: "editor_media_show_browser",
      playing_layout: "editor_media_playing_layout",
      compact_buttons: "editor_media_compact_buttons",
      show_device_chip: "editor_media_show_device_chip",
      show_source_chip: "editor_media_show_source_chip",
      show_volume: "editor_media_show_volume",
      volume_down_action: "editor_media_volume_down_action",
      volume_up_action: "editor_media_volume_up_action",
      default_tab: "editor_media_default_tab",
      browse_height: "editor_media_browse_height",
      use_artwork_color: "editor_media_use_artwork_color",
      animation: "editor_progress_animation",
      glass_background: "editor_glass_background",
      ...radiusLabelMap,
    };
    const key = labelMap[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _entityChanged(ev: CustomEvent): void {
    if (!this._config) return;
    this._config = { ...this._config, ...ev.detail.value };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    this._config = { ...this._config, ...ev.detail.value };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _useArtworkColorChanged(ev: CustomEvent): void {
    if (!this._config) return;
    this._config = { ...this._config, use_artwork_color: ev.detail.value.use_artwork_color };
    fireEvent(this, "config-changed", { config: this._config });
  }

  private _colorChanged(
    field: "accent_color" | "text_color" | "secondary_text_color" | "card_background",
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

  private _opacityChanged(field: "accent_opacity", value: number): void {
    if (!this._config) return;
    this._config = { ...this._config, [field]: value };
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

    const entityData = { entity: this._config.entity };
    const contentData = {
      name: this._config.name,
      playing_layout: this._config.playing_layout ?? "full",
      compact_buttons:
        this._config.compact_buttons ??
        (this._config.playing_layout === "mini" ? [...DEFAULT_MEDIA_MINI_BUTTONS] : [...DEFAULT_MEDIA_COMPACT_BUTTONS]),
      show_source_select: this._config.show_source_select ?? false,
      show_shuffle_repeat: this._config.show_shuffle_repeat ?? false,
      show_volume: this._config.show_volume ?? true,
      volume_down_action: this._config.volume_down_action,
      volume_up_action: this._config.volume_up_action,
      show_device_chip: this._config.show_device_chip ?? true,
      show_source_chip: this._config.show_source_chip ?? true,
      strip_track_number: this._config.strip_track_number ?? true,
      time_display: this._config.time_display ?? "remaining",
      meta_chips: this._config.meta_chips ?? [],
      show_browser: this._config.show_browser ?? true,
      default_tab: this._config.default_tab ?? "library",
      browse_height: this._config.browse_height ?? DEFAULT_MEDIA_BROWSE_HEIGHT,
    };
    const useArtworkData = { use_artwork_color: this._config.use_artwork_color ?? true };
    const animationData = { animation: this._config.animation ?? "auto" };

    return html`
      <div class="editor">
        <ha-expansion-panel outlined .header=${this._t("editor_entities")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:play-circle-outline"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${entityData}
              .schema=${this._entitySchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._entityChanged}
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
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_colors")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${useArtworkData}
              .schema=${[{ name: "use_artwork_color", selector: { boolean: {} } }] as SchemaEntry[]}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._useArtworkColorChanged}
            ></ha-form>
            ${colorRow(
              this._t("editor_media_accent_color"),
              this._config.accent_color,
              (v) => this._colorChanged("accent_color", v),
              {
                label: this._t("editor_opacity"),
                value: this._config.accent_opacity,
                defaultValue: 18,
                onChange: (v) => this._opacityChanged("accent_opacity", v),
              },
            )}
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
          defaultRadius: DEFAULT_MEDIA_RADIUS,
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

  static styles = [editorStyles];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-media-card-editor": M3MediaCardEditor;
  }
}
