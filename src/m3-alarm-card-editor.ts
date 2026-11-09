import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, LovelaceCardEditor, M3AlarmCardConfig } from "./types";
import { ALARM_MODE_ICONS, DEFAULT_ALARM_RADIUS } from "./const";
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
import { ALARM_MODES, supportedModes, type AlarmMode, type AlarmModeConfig } from "./shared/alarm";

type ColorField = "accent_color" | "text_color" | "secondary_text_color" | "card_background";

/** Values the card treats as "not set": left out of the YAML. */
const DEFAULTS: Partial<Record<keyof M3AlarmCardConfig, unknown>> = {
  show_sensors: true,
  compact: false,
  animation: "auto",
};

/**
 * The alarm card's editor (#47). The mode list is the one part ha-form cannot
 * do: tick which modes appear and move them into order. A mode's own name and
 * icon stay a YAML matter (`modes: [{ mode, name, icon }]`); ticking keeps
 * whatever was written there.
 */
@customElement("m3-alarm-card-editor")
export class M3AlarmCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config?: M3AlarmCardConfig;
  @state() private _appearance: AppearanceState = { showCustomRadius: false, showCorners: false, cornerCustom: {} };

  public setConfig(config: M3AlarmCardConfig): void {
    this._config = config;
    this._appearance = initAppearanceState(config, DEFAULT_ALARM_RADIUS);
  }

  private get _language(): string {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  private _t(key: TranslationKey): string {
    return localize(key, this._language);
  }

  private _emit(config: M3AlarmCardConfig): void {
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
        (Array.isArray(value) && value.length === 0) ||
        DEFAULTS[key as keyof M3AlarmCardConfig] === value;
      if (unset) delete next[key];
      else next[key] = value;
    }
    this._emit(next as unknown as M3AlarmCardConfig);
  }

  private _valueChanged(ev: CustomEvent): void {
    this._patch(ev.detail.value as Record<string, unknown>);
  }

  private _computeLabel = (schema: SchemaEntry): string => {
    const map: Record<string, TranslationKey> = {
      entity: "editor_alarm_entity",
      name: "editor_name",
      sensors: "editor_alarm_sensors",
      show_sensors: "editor_alarm_show_sensors",
      compact: "editor_alarm_compact",
      animation: "editor_progress_animation",
      glass_background: "editor_glass_background",
      ...radiusLabelMap,
    };
    const key = map[schema.name];
    return key ? this._t(key) : schema.name;
  };

  // ---- modes ------------------------------------------------------------------

  /** The configured entries, normalised, in their order. */
  private get _configured(): AlarmModeConfig[] {
    return (this._config?.modes ?? []).map((m) => (typeof m === "string" ? { mode: m } : m));
  }

  /** Every row the list shows: the ticked ones first, in order, then the rest the panel supports. */
  private get _rows(): { cfg: AlarmModeConfig; on: boolean }[] {
    const on = this._configured;
    const entity = this._config?.entity ? this.hass?.states[this._config.entity] : undefined;
    const offered = entity ? supportedModes(entity) : [...ALARM_MODES];
    const rest = offered.filter((m) => !on.some((o) => o.mode === m)).map((mode) => ({ mode }));
    return [...on.map((cfg) => ({ cfg, on: true })), ...rest.map((cfg) => ({ cfg, on: false }))];
  }

  private _writeModes(list: AlarmModeConfig[]): void {
    // A plain mode is written as its name; one with its own name or icon as an object.
    const modes = list.map((m) => (m.name || m.icon ? m : m.mode)) as (AlarmMode | AlarmModeConfig)[];
    this._patch({ modes });
  }

  private _toggle(mode: AlarmMode): void {
    const list = this._configured;
    const at = list.findIndex((m) => m.mode === mode);
    if (at >= 0) list.splice(at, 1);
    else list.push({ mode });
    this._writeModes(list);
  }

  private _move(mode: AlarmMode, by: -1 | 1): void {
    const list = this._configured;
    const at = list.findIndex((m) => m.mode === mode);
    const to = at + by;
    if (at < 0 || to < 0 || to >= list.length) return;
    [list[at], list[to]] = [list[to], list[at]];
    this._writeModes(list);
  }

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
      this._emit(rest as M3AlarmCardConfig);
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

  protected render() {
    if (!this.hass || !this._config) return html``;
    const cfg = this._config;
    const ticked = this._configured.length;
    return html`
      <div class="editor">
        <ha-expansion-panel outlined expanded .header=${this._t("editor_alarm_entity")}>
          <ha-icon slot="leading-icon" icon="mdi:shield-home-outline"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${{ entity: cfg.entity ?? "", name: cfg.name ?? "", compact: cfg.compact ?? false }}
              .schema=${[
                { name: "entity", selector: { entity: { domain: "alarm_control_panel" } } },
                { name: "name", selector: { text: {} } },
                { name: "compact", selector: { boolean: {} } },
              ]}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_alarm_modes")}>
          <ha-icon slot="leading-icon" icon="mdi:gesture-tap-button"></ha-icon>
          <div class="panel-content">
            <div class="hint">${this._t("editor_alarm_modes_hint")}</div>
            <div class="mode-list">
              ${this._rows.map(({ cfg: m, on }, i) => html`
                <div class="mode-row ${on ? "on" : ""}">
                  <label class="mode-pick">
                    <input type="checkbox" .checked=${on} @change=${() => this._toggle(m.mode)} />
                    <ha-icon icon=${m.icon ?? ALARM_MODE_ICONS[m.mode]}></ha-icon>
                    <span>${m.name ?? this._t(`alarm_mode_${m.mode}` as TranslationKey)}</span>
                  </label>
                  <button class="move" aria-label=${this._t("editor_alarm_move_up")} ?disabled=${!on || i === 0} @click=${() => this._move(m.mode, -1)}>
                    <ha-icon icon="mdi:arrow-up"></ha-icon>
                  </button>
                  <button class="move" aria-label=${this._t("editor_alarm_move_down")} ?disabled=${!on || i >= ticked - 1} @click=${() => this._move(m.mode, 1)}>
                    <ha-icon icon="mdi:arrow-down"></ha-icon>
                  </button>
                </div>
              `)}
            </div>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_alarm_sensors")}>
          <ha-icon slot="leading-icon" icon="mdi:door-open"></ha-icon>
          <div class="panel-content">
            <ha-form
              .hass=${this.hass}
              .data=${{ show_sensors: cfg.show_sensors ?? true, sensors: cfg.sensors ?? [] }}
              .schema=${[
                { name: "show_sensors", selector: { boolean: {} } },
                { name: "sensors", selector: { entity: { domain: "binary_sensor", multiple: true } } },
              ]}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined .header=${this._t("editor_progress_colors")}>
          <ha-icon slot="leading-icon" icon="mdi:palette-outline"></ha-icon>
          <div class="panel-content">
            ${colorRow(this._t("editor_light_accent_color"), cfg.accent_color, (v) => this._colorChanged("accent_color", v))}
            ${colorRow(this._t("editor_progress_text_color"), cfg.text_color, (v) => this._colorChanged("text_color", v))}
            ${colorRow(this._t("editor_progress_secondary_text_color"), cfg.secondary_text_color, (v) => this._colorChanged("secondary_text_color", v))}
            ${colorRow(this._t("editor_progress_card_background"), cfg.card_background, (v) => this._colorChanged("card_background", v))}
          </div>
        </ha-expansion-panel>

        ${renderAppearanceSection({
          hass: this.hass,
          language: this._language,
          config: cfg,
          defaultRadius: DEFAULT_ALARM_RADIUS,
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
      .mode-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-top: 8px;
      }

      .mode-row {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 2px 4px;
        border-radius: 12px;
      }

      .mode-row.on {
        background: color-mix(in srgb, var(--primary-color) 10%, transparent);
      }

      .mode-pick {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 10px;
        cursor: pointer;
        min-height: 40px;
      }

      .mode-pick input {
        width: 18px;
        height: 18px;
        accent-color: var(--primary-color);
      }

      .move {
        border: none;
        background: none;
        color: var(--primary-text-color);
        width: 36px;
        height: 36px;
        border-radius: 18px;
        cursor: pointer;
        --mdc-icon-size: 18px;
      }

      .move:disabled {
        opacity: 0.3;
        cursor: default;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "m3-alarm-card-editor": M3AlarmCardEditor;
  }
}
