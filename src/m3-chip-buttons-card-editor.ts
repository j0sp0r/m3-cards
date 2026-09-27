import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, LovelaceCardEditor, M3ChipButtonsCardConfig, ChipButtonConfig } from "./types";
import { DEFAULT_CHIP_BUTTONS_RADIUS } from "./const";
import { localize, type TranslationKey } from "./localize";
import { colorRow, editorStyles, fireEvent, type SchemaEntry } from "./shared/editor-helpers";
import {
  initAppearanceState,
  radiusPresetPatch,
  cornerPresetPatch,
  renderAppearanceSection,
  type AppearanceState,
} from "./shared/appearance-editor";
import { radiusLabelMap } from "./shared/radius-editor";
import {
  chipButtonLabelMap,
  renderChipButtonsListEditor,
} from "./shared/chip-buttons-editor";

@customElement("m3-chip-buttons-card-editor")
export class M3ChipButtonsCardEditor
  extends LitElement
  implements LovelaceCardEditor<M3ChipButtonsCardConfig>
{
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: M3ChipButtonsCardConfig;
  @state() private _appearance: AppearanceState = {
    showCustomRadius: false,
    showCorners: false,
    cornerCustom: {},
  };

  public setConfig(config: M3ChipButtonsCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_CHIP_BUTTONS_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _itemLabel(item: ChipButtonConfig, index: number): string {
    return (
      item.name ??
      (item.entity
        ? ((this.hass?.states[item.entity]?.attributes.friendly_name as string | undefined) ??
          item.entity)
        : `#${index + 1}`)
    );
  }

  private _emit(config: M3ChipButtonsCardConfig): void {
    this._config = config;
    fireEvent(this, "config-changed", { config });
  }

  private _layoutSchema(): SchemaEntry[] {
    return [
      {
        name: "stretch",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "off", label: this._t("editor_chip_buttons_stretch_off") },
              { value: "equal", label: this._t("editor_chip_buttons_stretch_equal") },
              { value: "smart", label: this._t("editor_chip_buttons_stretch_smart") },
            ],
          },
        },
      },
      { name: "wrap", selector: { boolean: {} } },
      {
        name: "justify",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "start", label: this._t("editor_chip_buttons_justify_start") },
              { value: "center", label: this._t("editor_chip_buttons_justify_center") },
              { value: "end", label: this._t("editor_chip_buttons_justify_end") },
              { value: "space-between", label: this._t("editor_chip_buttons_justify_space_between") },
            ],
          },
        },
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
      ...chipButtonLabelMap,
      ...radiusLabelMap,
      stretch: "editor_chip_buttons_stretch",
      wrap: "editor_chip_buttons_wrap",
      justify: "editor_chip_buttons_justify",
      glass_background: "editor_glass_background",
      animation: "editor_progress_animation",
    };
    const key = labelMap[schema.name];
    return key ? this._t(key) : schema.name;
  };

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const value = { ...(ev.detail.value as Record<string, unknown>) };
    // The dropdown speaks in names; the config keeps `true` for the even
    // split so existing YAML reads the same as before the third option.
    if (typeof value.stretch === "string" && value.stretch !== "smart") {
      value.stretch = value.stretch === "equal";
    }
    this._emit({ ...this._config, ...value });
  }

  private _buttonsChanged(buttons: ChipButtonConfig[]): void {
    if (!this._config) return;
    this._emit({ ...this._config, buttons });
  }

  private _colorChanged(field: "card_background", value: string): void {
    if (!this._config) return;
    if (value) {
      this._emit({ ...this._config, [field]: value });
    } else {
      const { [field]: _drop, ...rest } = this._config;
      this._emit(rest as M3ChipButtonsCardConfig);
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
      const { corners: _corners, ...rest } = this._config;
      this._emit(rest as M3ChipButtonsCardConfig);
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

    const layoutData = {
      stretch:
        this._config.stretch === "smart" ? "smart" : this._config.stretch ? "equal" : "off",
      wrap: this._config.wrap ?? false,
      justify: this._config.justify ?? "start",
    };
    const animationData = { animation: this._config.animation ?? "auto" };

    return html`
      <div class="editor">
        <ha-expansion-panel outlined .header=${this._t("editor_chip_buttons_chips")} expanded>
          <ha-icon slot="leading-icon" icon="mdi:gesture-tap-button"></ha-icon>
          <div class="panel-content">
            ${renderChipButtonsListEditor({
              hass: this.hass,
              language: this._language,
              items: this._config.buttons ?? [],
              onChange: (items) => this._buttonsChanged(items),
              computeLabel: this._computeLabel,
              addLabel: this._t("editor_chip_buttons_add"),
              removeLabel: this._t("editor_chip_buttons_remove"),
              moveUpLabel: this._t("editor_chip_buttons_move_up"),
              moveDownLabel: this._t("editor_chip_buttons_move_down"),
              itemLabel: (item, index) => this._itemLabel(item, index),
            })}
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_chip_buttons_layout")}>
          <ha-icon slot="leading-icon" icon="mdi:view-sequential-outline"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${layoutData}
              .schema=${this._layoutSchema()}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_colors")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            ${colorRow(
              this._t("editor_progress_card_background"),
              this._config.card_background,
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
          </div>
        </ha-expansion-panel>

        ${renderAppearanceSection({
          hass: this.hass,
          language: this._language,
          config: this._config,
          defaultRadius: DEFAULT_CHIP_BUTTONS_RADIUS,
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
      .chip-buttons-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .chip-buttons-row-actions {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .chip-buttons-row-actions .remove {
        margin-left: auto;
        --mdc-theme-primary: var(--error-color, #e57368);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-chip-buttons-card-editor": M3ChipButtonsCardEditor;
  }
}
